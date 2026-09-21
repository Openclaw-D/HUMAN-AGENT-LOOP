// soak-v04-data · driver：长程测试编排（回归→基线→并发爬坡+故障窗口→收尾）。
// 硬边界：仅白名单三文件可修；零真实模型/API出站（A=本地可计数替身）；材料元数据总量≤1000；
// 每请求≤30s；平均请求速率远低于5req/s上限（受材料上限约束，如实报告口径）；
// 事件/指标JSONL留痕；宿主资源压力自动降载；control.json {stop:true} 可优雅停。
import { compose, FakeWecomTransport } from '../../src/compose.mjs';
import { startServer } from '../../src/http/server.mjs';
import pgPkg from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  soakConfig, mulberry32, pick, makeJsonlWriter, createAStandin, percentile,
  bankCsvVariate, declCsvVariate, declTxtVariate, emptyBytes, fakePdfBytes,
  truncatedCsvBytes, garbageBinaryBytes, hostileZipBytes, largeDeclBytes,
  checkIsolation, snapshotConfirmed, verifyPersisted, checkOrphanObjects,
  taskStatusCounts, connectionCounts, walkFiles, oldestQueuedAgeSec,
} from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const conf = soakConfig();
const MIN = 60_000;
const scale = conf.scale;
const SMOKE = process.env.SOAK04_SMOKE === '1';

// ---------- 事件/指标 ----------
const evW = makeJsonlWriter(join(conf.runDir, 'events'), 'events');
const m1 = makeJsonlWriter(join(conf.runDir, 'metrics'), 'metrics-1min');
const m5 = makeJsonlWriter(join(conf.runDir, 'metrics'), 'metrics-5min');
const aLog = makeJsonlWriter(join(conf.runDir, 'events'), 'astandin');
const ev = (kind, data = {}) => evW.write({ t: new Date().toISOString(), kind, ...data });

const counters = {
  uploads: { ok: 0, expectedReject: 0, unexpectedError: 0, infraFault: 0, total: 0, bytes: 0 },
  reads: { ok: 0, error: 0, total: 0 },
  tasks: { done: 0, skippedDuplicate: 0, needsFollowup: 0, failedExpected: 0, failedUnexpected: 0, waiting: 0, stillWaiting: 0 },
  latencies: { steady: [], fault: [] },
  faults: [], phases: [], unexpected: [], invariantChecks: [],
};
let materialCount = 0;
let loadFactor = 1;
let stopped = false;
const pending = new Map();
const customerLastDone = new Map();
const perClassCounts = {};
const SEED_BASE = 20260921;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function checkControl() {
  try {
    const p = join(conf.runDir, 'control.json');
    if (existsSync(p)) { const c = JSON.parse(readFileSync(p, 'utf8')); if (c.stop === true) return true; }
  } catch { /* 控制文件异常忽略 */ }
  return false;
}
function unexpected(kind, detail) {
  counters.unexpected.push({ t: new Date().toISOString(), kind, detail: String(detail).slice(0, 300) });
  ev('unexpected', { kind, detail: String(detail).slice(0, 300) });
}

// ---------- HTTP api ----------
let base = null;
async function api(path, body, { method = 'POST' } = {}) {
  try {
    const r = await fetch(`http://127.0.0.1${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-service-token': conf.serviceToken },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(28_000),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  } catch (e) {
    return { status: 0, json: {}, error: String(e?.message ?? e).slice(0, 120) };
  }
}

// ---------- worker 管理 ----------
const workers = new Map(); let workerSeq = 0;
let targetWorkers = 0; // 当前档位期望 worker 数（采样周期内自动补员）
function maintainWorkers() {
  reapWorkers();
  while (workers.size < targetWorkers) spawnWorker({});
}
let aStand = null; let customerLinksSeed = null;
function workerCfg(extra = {}) {
  return JSON.stringify({
    workerId: `w${++workerSeq}`,
    aBaseUrl: aStand.baseUrl,
    maxTasks: 2,
    tickIntervalMs: 2000,
    aCustomerLinks: customerLinksSeed,
    ...extra,
  });
}
function spawnWorker(extra = {}) {
  const id = workerSeq + 1;
  const child = spawn(process.execPath, [join(__dirname, 'worker.mjs')], {
    env: { ...process.env, SOAK04_WORKER_CFG: workerCfg(extra) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errTail = '';
  child.stderr.on('data', (d) => {
    errTail = (errTail + String(d)).slice(-2000);
    if (String(d).includes('[soak04-worker]')) {
      ev('worker-crash-signal', { pid: child.pid, workerId: id, detail: String(d).trim().slice(0, 600) });
    }
  });
  child.on('exit', (code, signal) => { if (signal !== 'SIGKILL' && signal !== 'SIGTERM' && code !== 0) ev('worker-exit-abnormal', { pid: child.pid, code, signal, errTail: errTail.slice(0, 300) }); });
  const rec = { child, workerId: id, spawnedAt: Date.now(), errTail: () => errTail };
  workers.set(child.pid, rec);
  ev('worker-spawn', { pid: child.pid, workerId: id, live: workers.size });
  return rec;
}
function killWorkers(n = 1, { reason = 'fault' } = {}) {
  const victims = [...workers.values()].slice(0, n);
  for (const v of victims) {
    try { v.child.kill('SIGKILL'); } catch { /* 已死 */ }
    workers.delete(v.child.pid);
    ev('worker-killed', { pid: v.child.pid, workerId: v.workerId, reason });
  }
  return victims.length;
}
function reapWorkers() {
  for (const [pid, w] of workers) {
    if (w.child.exitCode !== null || w.child.signalCode !== null) workers.delete(pid);
  }
}

// ---------- PG 故障注入 ----------
let faultActiveUntil = 0;
async function pgOutage(kind, downMs, label) {
  const downMsEff = Math.max(8000, Math.round(downMs * Math.min(scale, 1)));
  ev('pg-outage-start', { kind, downMs: downMsEff, label });
  const t0 = Date.now();
  const r1 = spawnSync('docker', kind === 'stop' ? ['stop', '-t', '2', conf.container] : ['kill', conf.container], { encoding: 'utf8', timeout: 60_000 });
  if (r1.status !== 0) unexpected('pg-outage-stop-failed', String(r1.stderr).slice(0, 200));
  await sleep(downMsEff);
  const r2 = spawnSync('docker', ['start', conf.container], { encoding: 'utf8', timeout: 120_000 });
  let ready = false; let readyMs = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 120_000) {
    const chk = spawnSync('docker', ['exec', conf.container, 'pg_isready', '-U', conf.pg.user], { encoding: 'utf8', timeout: 15_000 });
    if (chk.status === 0) { ready = true; readyMs = Date.now() - t1; break; }
    await sleep(2000);
  }
  const rec = { kind, label, stopped: r1.status === 0, restarted: r2.status === 0, pgReady: ready, readyMs, totalMs: Date.now() - t0 };
  counters.faults.push({ type: 'pg-outage', ...rec });
  ev('pg-outage-end', rec);
  return rec;
}

// ---------- 场景与上传 ----------
const CUSTOMERS = Array.from({ length: 10 }, (_, i) => `cust-soak-${String(i + 1).padStart(2, '0')}`);
const HOARDER = 'cust-soak-hoarder';
const CC_A = 'cust-soak-cca'; const CC_B = 'cust-soak-ccb'; const CANARY_CUST = 'cust-soak-canary';
const ALL_CUSTOMERS = [...CUSTOMERS, HOARDER, CC_A, CC_B, CANARY_CUST];
const invByCustomer = {};
let canary = null;
const canaryUnique = { bytes: null };

function buildFixture(rng, cls) {
  switch (cls) {
    case 'bank': return { bytes: bankCsvVariate(rng), kind: 'statement', expect: 'done' };
    case 'declCsv': return { bytes: declCsvVariate(rng), kind: 'document', expect: 'done' };
    case 'declTxt': return { bytes: declTxtVariate(rng), kind: 'document', expect: 'done' };
    case 'hoarderDecl': return { bytes: declCsvVariate(rng), kind: 'document', expect: 'done' };
    case 'empty': return { bytes: emptyBytes(), kind: 'document', expect: 'needs_followup' };
    case 'fakePdf': return { bytes: fakePdfBytes(), kind: 'document', expect: 'needs_followup' };
    case 'truncatedCsv': return { bytes: truncatedCsvBytes(rng), kind: 'statement', expect: 'needs_followup|done_flags' };
    case 'garbage': return { bytes: garbageBinaryBytes(rng), kind: 'document', expect: 'needs_followup' };
    case 'hostileZip': return { bytes: hostileZipBytes(), kind: 'document', expect: 'failed_zipunsafe' };
    case 'largeDecl': return { bytes: largeDeclBytes(rng), kind: 'document', expect: 'done' };
    default: return { bytes: declCsvVariate(rng), kind: 'document', expect: 'done' };
  }
}
async function uploadOne(rng, cls, { customerId = null, bytesOverride = null, kindOverride = null, supersedes = null, label = null } = {}) {
  if (materialCount >= conf.materialCap) return { skipped: 'material_cap' };
  const f = buildFixture(rng, cls);
  const bytes = bytesOverride ?? f.bytes;
  const kind = kindOverride ?? f.kind;
  const cid = customerId ?? (cls === 'hoarderDecl' ? HOARDER : pick(rng, CUSTOMERS));
  const t0 = Date.now();
  const r = await api('/api/connectors/evidence/upload', {
    tenantId: conf.tenantId, customerId: cid, invitationId: invByCustomer[cid], kind,
    contentBase64: bytes.toString('base64'), contentType: 'application/octet-stream',
    periodFrom: kind === 'statement' ? '2026-01-01' : null,
    periodTo: kind === 'statement' ? '2026-02-28' : null,
    currency: 'CNY',
    caliber: kind === 'statement' ? '收付实现' : '权责发生',
    ...(supersedes ? { supersedesEvidenceId: supersedes } : {}),
  });
  counters.uploads.total += 1;
  const inFault = faultActiveUntil > Date.now();
  if (r.status === 200 && r.json?.ok) {
    materialCount += 1;
    counters.uploads.ok += 1;
    counters.uploads.bytes += bytes.length;
    const evidenceId = r.json.evidenceId;
    const clsKey = label ?? cls;
    perClassCounts[clsKey] = (perClassCounts[clsKey] ?? 0) + 1;
    pending.set(evidenceId, { evidenceId, cid, cls: clsKey, expect: f.expect, bytesLen: bytes.length, t0, inFault, supersedesFrom: supersedes ?? null });
    if (!supersedes && ['bank', 'declCsv', 'declTxt'].includes(cls) && cid !== HOARDER) customerLastDone.set(cid, { evidenceId });
    return { ok: true, evidenceId, cid };
  }
  if (inFault) { counters.uploads.infraFault += 1; return { ok: false, infraFault: true, status: r.status, error: r.error ?? r.json?.error }; }
  if (r.status >= 400 && r.status < 500 && r.json?.error) { counters.uploads.expectedReject += 1; ev('upload-expected-reject', { status: r.status, error: r.json.error, cls }); return { ok: false, expectedReject: true }; }
  counters.uploads.unexpectedError += 1;
  unexpected('upload', `status=${r.status} err=${r.error ?? r.json?.error ?? '?'} cls=${cls}`);
  return { ok: false, status: r.status, error: r.error ?? r.json?.error };
}

// ---------- 终态监视 ----------
const TERMINAL = new Set(['done', 'skipped_duplicate', 'needs_followup', 'failed']);
const WAITING = new Set(['blocked_unknown', 'blocked_link', 'blocked_a_unavailable']);
const NEEDS_FOLLOWUP_EXPECTED = new Set(['empty', 'fakePdf', 'truncatedCsv', 'garbage', 'negative']);
async function watchTerminals(store) {
  if (pending.size === 0) return;
  const ids = [...pending.keys()].slice(0, 200);
  let rows = [];
  try {
    rows = (await store.query(
      `SELECT task_id, evidence_id, status, failure_code FROM processing_tasks WHERE tenant_id=$1 AND evidence_id = ANY($2::text[])`,
      [conf.tenantId, ids])).rows;
  } catch { return; } // DB 短暂不可用：下轮再查
  for (const row of rows) {
    const rec = pending.get(row.evidence_id);
    if (!rec) continue;
    if (TERMINAL.has(row.status)) {
      const latMs = Date.now() - rec.t0;
      (rec.inFault ? counters.latencies.fault : counters.latencies.steady).push(latMs);
      pending.delete(row.evidence_id);
      const lat = { evidenceId: row.evidence_id, cls: rec.cls, status: row.status, code: row.failure_code, ms: latMs, inFault: rec.inFault };
      ev('task-terminal', lat);
      if (row.status === 'done') counters.tasks.done += 1;
      else if (row.status === 'skipped_duplicate') counters.tasks.skippedDuplicate += 1;
      else if (row.status === 'needs_followup') {
        if (NEEDS_FOLLOWUP_EXPECTED.has(rec.cls) || rec.expect.startsWith('needs_followup')) counters.tasks.needsFollowup += 1;
        else { counters.tasks.failedUnexpected += 1; unexpected('needs_followup_unexpected', JSON.stringify(lat)); }
      } else if (row.status === 'failed') {
        if (rec.expect === 'failed_zipunsafe' && row.failure_code === 'ZIP_UNSAFE') counters.tasks.failedExpected += 1;
        else if (rec.inFault || faultActiveUntil > Date.now() - 120_000) { counters.tasks.failedExpected += 1; ev('task-failed-in-fault-window', lat); }
        else { counters.tasks.failedUnexpected += 1; unexpected('failed_unexpected', JSON.stringify(lat)); }
      }
    } else if (WAITING.has(row.status)) {
      rec.waitingSince = rec.waitingSince ?? Date.now();
      counters.tasks.waiting = pending.size;
      if (Date.now() - rec.waitingSince > 15 * MIN) {
        // 产品语义：从未到达 A 的 unknown 不自动重发（不换ID）→ 恢复后仍留等待属如实等待，单独计数报告
        pending.delete(row.evidence_id);
        counters.tasks.stillWaiting += 1;
        ev('task-still-waiting', { evidenceId: row.evidence_id, status: row.status, waitedMs: Date.now() - rec.t0, cls: rec.cls });
      }
    }
  }
}

// ---------- 读混合 ----------
let driverStore = null;
const readRng = mulberry32(SEED_BASE + 7);
async function readMix() {
  let rows;
  try {
    rows = (await driverStore.query(
      `SELECT a.evidence_id, a.customer_id FROM evidence_artifacts a
       JOIN processing_tasks t ON t.tenant_id=a.tenant_id AND t.evidence_id=a.evidence_id AND t.status='done'
       WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 5`, [conf.tenantId])).rows;
  } catch { return; }
  if (!rows.length) return;
  const s = rows[Math.floor(readRng() * rows.length)];
  const pv = await api(`/api/connectors/evidence/preview?tid=${encodeURIComponent(conf.tenantId)}&eid=${encodeURIComponent(s.evidence_id)}&cid=${encodeURIComponent(s.customer_id)}`, null, { method: 'GET' });
  counters.reads.total += 1;
  if (pv.status === 200 && pv.json?.ok) {
    counters.reads.ok += 1;
    if (pv.json.sha256 && pv.json.size != null) { /* 预览含对象读+嗅探；字节完整性由 get 内 hash 复核把关 */ }
  } else if (faultActiveUntil <= Date.now()) {
    counters.reads.error += 1;
    unexpected('preview', `status=${pv.status} ${JSON.stringify(pv.json).slice(0, 160)}`);
  }
  const st = await api(`/api/connectors/processing/status?tid=${encodeURIComponent(conf.tenantId)}&cid=${encodeURIComponent(pick(readRng, ALL_CUSTOMERS))}`, null, { method: 'GET' });
  counters.reads.total += 1;
  if (st.status === 200 && st.json?.ok) counters.reads.ok += 1;
  else if (faultActiveUntil <= Date.now()) { counters.reads.error += 1; unexpected('status-read', `status=${st.status}`); }
}

// ---------- 采样（1min 采样 + 5min 聚合） ----------
let cpuPrev = os.cpus().map((c) => c.times);
let recentSamples = [];
let highCpuSince = null; let lowMemSince = null; let downgradedAt = 0;
async function sampleMetrics(tag) {
  maintainWorkers();
  const s = { t: new Date().toISOString(), tag };
  try {
    s.tasks = Object.fromEntries((await taskStatusCounts(driverStore)).map((r) => [r.status, r.n]));
    s.conns = await connectionCounts(driverStore.pool);
    s.dbBytes = (await driverStore.query(`SELECT pg_database_size(current_database())::bigint AS n`)).rows[0].n;
    s.rows = {
      objects: (await driverStore.query(`SELECT count(*)::int AS n FROM objects`)).rows[0].n,
      materials: (await driverStore.query(`SELECT count(*)::int AS n FROM evidence_artifacts`)).rows[0].n,
      parse: (await driverStore.query(`SELECT count(*)::int AS n FROM parse_results`)).rows[0].n,
      auditEvents: (await driverStore.query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n,
      stages: (await driverStore.query(`SELECT count(*)::int AS n FROM processing_stage_runs`)).rows[0].n,
    };
    s.oldestQueuedAgeSec = await oldestQueuedAgeSec(driverStore, conf.tenantId);
    s.analyze10m = (await driverStore.query(
      `SELECT round(avg((detail->>'durationMs')::numeric),1)::float AS avgMs, count(*)::int AS n
       FROM processing_stage_runs WHERE tenant_id=$1 AND stage='analyze' AND status='done' AND created_at > now()-interval '10 minutes'`,
      [conf.tenantId])).rows[0];
  } catch (e) { s.dbError = String(e?.message ?? e).slice(0, 120); }
  try {
    const objs = walkFiles(conf.objectRoot);
    s.objectFiles = objs.length; s.objectBytes = objs.reduce((a, b) => a + b.size, 0);
  } catch { /* 目录统计失败忽略 */ }
  const cpuNow = os.cpus().map((c) => c.times);
  let busy = 0; let total = 0;
  cpuNow.forEach((t, i) => {
    const p = cpuPrev[i] ?? t;
    busy += (t.user - p.user) + (t.sys - p.sys);
    total += (t.user - p.user) + (t.sys - p.sys) + (t.idle - p.idle);
  });
  cpuPrev = cpuNow;
  const h = { freeMemGb: Math.round(os.freemem() / 1e8) / 10, totalMemGb: Math.round(os.totalmem() / 1e8) / 10, cpuBusyPct: total > 0 ? Math.round((busy / total) * 1000) / 10 : null };
  try { h.diskFreeGb = Math.round((Number((await statfs(conf.runDir)).bavail) * Number((await statfs(conf.runDir)).bsize)) / 1e9 * 10) / 10; } catch { /* statfs 不可用 */ }
  s.host = h;
  s.workers = [];
  try {
    for (const f of readdirSync(join(conf.runDir, 'status'))) {
      if (!f.startsWith('worker-')) continue;
      try { s.workers.push(JSON.parse(readFileSync(join(conf.runDir, 'status', f), 'utf8'))); } catch { /* 心跳读取失败 */ }
    }
  } catch { /* status 目录未建 */ }
  s.astandin = aStand?.summary();
  s.load = { uploads: { ...counters.uploads }, reads: { ...counters.reads }, tasks: { ...counters.tasks }, pendingTasks: pending.size, materialCount, loadFactor };
  m1.write(s);
  recentSamples.push(s);
  if (recentSamples.length >= 5) writeFiveMinAgg();
  return s;
}
function writeFiveMinAgg() {
  const xs = recentSamples; recentSamples = [];
  const avg = (f) => { const v = xs.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; };
  const max = (f) => { const v = xs.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? Math.max(...v) : null; };
  const agg = {
    t: xs[xs.length - 1]?.t, windowMin: 5,
    from: xs[0]?.t, to: xs[xs.length - 1]?.t,
    tasksQueuedAvg: avg((x) => x.tasks?.queued), tasksRunningMax: max((x) => x.tasks?.running),
    connsTotalAvg: avg((x) => x.conns?.total), connsTotalMax: max((x) => x.conns?.total),
    dbBytesLast: xs[xs.length - 1]?.dbBytes, objectBytesLast: xs[xs.length - 1]?.objectBytes,
    workerRssMbMax: max((x) => Math.max(0, ...(x.workers ?? []).map((w) => w.rssMb ?? 0))),
    workerLagMsMax: max((x) => Math.max(0, ...(x.workers ?? []).map((w) => w.lagMaxMs ?? 0))),
    workerTickErrorsSum: xs.reduce((a, x) => a + Math.max(0, ...(x.workers ?? []).map((w) => w.tickErrors ?? 0)), 0),
    hostCpuAvg: avg((x) => x.host?.cpuBusyPct), hostFreeMemMin: (() => { const v = xs.map((x) => x.host?.freeMemGb).filter((x) => x != null); return v.length ? Math.min(...v) : null; })(),
    uploadsDelta: xs[xs.length - 1]?.load?.uploads?.total - xs[0]?.load?.uploads?.total,
    oldestQueuedMax: max((x) => x.oldestQueuedAgeSec),
    astandinReqsLast: xs[xs.length - 1]?.astandin?.counters?.requests,
  };
  m5.write(agg);
  return agg;
}

// ---------- 资源守护 ----------
async function resourceGuardian(sample) {
  const h = sample.host ?? {};
  const lowMem = h.freeMemGb != null && (h.freeMemGb < 2 || h.freeMemGb < h.totalMemGb * 0.1);
  const lowDisk = h.diskFreeGb != null && h.diskFreeGb < 50;
  const highCpu = h.cpuBusyPct != null && h.cpuBusyPct > 80;
  const now = Date.now();
  if (lowMem) lowMemSince = lowMemSince ?? now; else lowMemSince = null;
  if (highCpu) highCpuSince = highCpuSince ?? now; else highCpuSince = null;
  const pressured = (lowMemSince && now - lowMemSince > 60_000) || (highCpuSince && now - highCpuSince > 5 * MIN) || lowDisk;
  if (pressured && loadFactor === 1) {
    loadFactor = 0.4; downgradedAt = now;
    ev('load-downgrade', { lowMem, lowDisk, highCpu, freeMemGb: h.freeMemGb, diskFreeGb: h.diskFreeGb, cpu: h.cpuBusyPct });
  } else if (loadFactor < 1 && !pressured && now - downgradedAt > 5 * MIN) {
    loadFactor = 1; ev('load-restore', {});
  }
  return pressured;
}

// ---------- 不变量 ----------
async function runInvariantCheck(tag, { preSnap = null } = {}) {
  const out = { tag, t: new Date().toISOString() };
  try { out.isolation = await checkIsolation(driverStore, conf.tenantId); } catch (e) { out.isolationError = String(e?.message ?? e).slice(0, 160); }
  try { out.orphans = await checkOrphanObjects(conf.objectRoot, driverStore); } catch (e) { out.orphanError = String(e?.message ?? e).slice(0, 160); }
  try { out.tasks = Object.fromEntries((await taskStatusCounts(driverStore)).map((r) => [r.status, r.n])); } catch { /* 下轮 */ }
  try { out.conns = await connectionCounts(driverStore.pool); } catch { /* 下轮 */ }
  if (preSnap) { try { out.persisted = await verifyPersisted(driverStore, preSnap); } catch (e) { out.persistedError = String(e?.message ?? e).slice(0, 160); } }
  if (canary && canary.firstEvidenceId) {
    try {
      out.canary = {
        parseRows: (await driverStore.query(
          `SELECT count(*)::int AS n FROM parse_results WHERE tenant_id=$1 AND customer_id=$2 AND sha256=$3`,
          [conf.tenantId, canary.customerId, canary.sha256])).rows[0].n,
        facts: (await driverStore.query(
          `SELECT count(*)::int AS n FROM fact_assertions WHERE tenant_id=$1 AND from_artifacts @> $2::jsonb`,
          [conf.tenantId, JSON.stringify([canary.firstEvidenceId])])).rows[0].n,
        observations: (await driverStore.query(
          `SELECT count(*)::int AS n FROM evidence_observations WHERE tenant_id=$1 AND segment_id=$2`,
          [conf.tenantId, `parse:${canary.firstEvidenceId}`])).rows[0].n,
        dupTasks: (await driverStore.query(
          `SELECT count(*)::int AS n FROM processing_tasks t JOIN evidence_artifacts a ON a.tenant_id=t.tenant_id AND a.evidence_id=t.evidence_id
           WHERE t.tenant_id=$1 AND t.status='skipped_duplicate' AND a.sha256=$2`, [conf.tenantId, canary.sha256])).rows[0].n,
      };
    } catch (e) { out.canaryError = String(e?.message ?? e).slice(0, 160); }
  }
  const bad =
    (out.isolation && (out.isolation.factCrossCustomer > 0 || out.isolation.aLinkCrossCustomer > 0 || !out.isolation.parseCrossOk)) ||
    (out.persisted && out.persisted.issues.length > 0) ||
    (out.orphans && (out.orphans.missingCount > 0 || out.orphans.orphanFiles.length > 0));
  out.verdict = bad ? 'FAIL' : 'PASS';
  counters.invariantChecks.push(out);
  ev('invariant-check', {
    tag, verdict: out.verdict,
    isolation: out.isolation, orphanSummary: out.orphans && { orphans: out.orphans.orphanFiles.length, missing: out.orphans.missingCount },
    persistedSummary: out.persisted && { checked: out.persisted.checked, issues: out.persisted.issues.length },
    canary: out.canary, tasks: out.tasks, conns: out.conns,
  });
  return out;
}

// ---------- 阶段引擎 ----------
const phaseTimings = [];
async function runPhase(name, mins, fn) {
  const t0 = Date.now();
  const start = new Date().toISOString();
  ev('phase-start', { phase: name, budgetMin: mins, scale });
  const out = await fn(mins * MIN * scale);
  const end = new Date().toISOString();
  const effectiveMin = Math.round(((Date.now() - t0) / MIN) * 100) / 100;
  phaseTimings.push({ phase: name, start, end, effectiveMin });
  ev('phase-end', { phase: name, start, end, effectiveMin });
  return out;
}

async function uploadLoop(rng, opts) {
  const { budget, ratePerMin, classes, weights, readsEveryMs = 8000, canaryEveryMs = 300_000, label } = opts;
  const t0 = Date.now();
  let nextUpload = t0; let nextRead = t0 + readsEveryMs; let nextCanary = t0 + canaryEveryMs;
  let canarySeq = 0; let inflight = 0;
  const procs = [];
  while (Date.now() - t0 < budget && !stopped && !checkControl()) {
    const now = Date.now();
    // smoke（scale<0.05）：相位只有秒级，速率等比补偿保持链路被真实驱动（仍≤5req/s）
    const rate = ratePerMin * loadFactor * (scale < 0.05 ? 120 : 1);
    if (now >= nextUpload && inflight < 8 && materialCount < conf.materialCap) {
      const cls = weightedPick(rng, classes, weights);
      inflight += 1;
      nextUpload = Math.max(nextUpload, now) + (60_000 / Math.max(rate, 0.01));
      procs.push(uploadOne(rng, cls).finally(() => { inflight -= 1; }));
      if (procs.length > 400) await Promise.allSettled(procs.splice(0).map((p) => p.catch(() => {})));
      if (cls === 'declCsv' && rng() < 0.125) { // supersedes 链
        const cid = CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)];
        const prev = customerLastDone.get(cid)?.evidenceId;
        if (prev) procs.push(uploadOne(rng, 'declCsv', { customerId: cid, supersedes: prev, label: 'supersedes' }).catch(() => {}));
      }
      if (rng() < 0.083) { // 跨客户同字节
        const cid = rng() < 0.5 ? CC_A : CC_B;
        const bytesBase = canary?.bytes ?? canaryUnique.bytes;
        procs.push(uploadOne(rng, 'declCsv', { customerId: cid, bytesOverride: bytesBase, kindOverride: 'statement', label: 'dup_cross_customer' }).catch(() => {}));
      }
    }
    if (now >= nextRead) { nextRead = now + readsEveryMs; procs.push(readMix().catch(() => {})); }
    if (canary && now >= nextCanary) {
      nextCanary = now + canaryEveryMs; canarySeq += 1;
      procs.push(uploadOne(rng, 'bank', { customerId: canary.customerId, bytesOverride: canary.bytes, kindOverride: 'statement', label: `canary_replay_${canarySeq}` }).catch(() => {}));
    }
    await watchTerminals(driverStore).catch(() => {});
    await sleep(Math.min(1000, Math.max(50, nextUpload - Date.now())));
  }
  await Promise.allSettled(procs);
  ev('upload-loop-end', { label, uploads: counters.uploads.total, materialCount, pending: pending.size });
}
function weightedPick(rng, classes, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < classes.length; i++) { r -= weights[i]; if (r <= 0) return classes[i]; }
  return classes[classes.length - 1];
}

// ---------- 汇总 ----------
function latencyStats(arr) {
  return { n: arr.length, p50: percentile(arr, 50), p95: percentile(arr, 95), p99: percentile(arr, 99), max: arr.length ? Math.max(...arr) : null };
}
function writeSummary(extra = {}) {
  const summary = {
    generatedAt: new Date().toISOString(),
    seedBase: SEED_BASE, scale,
    counters: {
      ...counters,
      latencies: { steady: latencyStats(counters.latencies.steady), fault: latencyStats(counters.latencies.fault) },
      unexpectedCount: counters.unexpected.length,
    },
    perClassCounts,
    phases: phaseTimings,
    effectiveSoakMin: Math.round(phaseTimings.filter((p) => !['setup', 'regression'].includes(p.phase)).reduce((a, b) => a + b.effectiveMin, 0) * 100) / 100,
    materialCount,
    astandin: aStand?.summary(),
    ...extra,
  };
  writeFileSync(join(conf.runDir, 'results-summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

// ---------- main ----------
async function waitPgReady() {
  console.error('[soak04-driver] waitPgReady:begin');
  for (let i = 0; i < 45; i++) {
    try {
      const c = new pgPkg.Client(conf.pg);
      await c.connect(); await c.query('SELECT 1'); await c.end();
      console.error('[soak04-driver] waitPgReady:ready');
      return true;
    } catch (e) { console.error(`[soak04-driver] waitPgReady:retry ${i} ${String(e?.message ?? e).slice(0, 100)}`); await sleep(2000); }
  }
  return false;
}

async function main() {
  const startedAt = new Date().toISOString();
  ev('driver-start', { startedAt, scale, runDir: conf.runDir });
  if (!(await waitPgReady())) {
    ev('pg-not-ready', {});
    writeFileSync(join(conf.runDir, 'DRIVER-FAILED.txt'), 'PG not ready');
    process.exit(2);
  }

  // 本包专用容器：启动时重置 schema 与对象目录（跨运行残留会污染不变量基线）
  {
    const r = spawnSync('docker', ['exec', conf.container, 'psql', '-U', conf.pg.user, '-d', conf.pg.database,
      '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) console.error(`[soak04-driver] schema-reset failed: ${String(r.stderr).slice(0, 200)}`);
    try { rmSync(conf.objectRoot, { recursive: true, force: true }); } catch { /* 目录可不存在 */ }
    ev('schema-reset', { ok: r.status === 0 });
  }

  aStand = await createAStandin({ tenantId: conf.tenantId, credentials: conf.aCredentials, logWriter: aLog });
  customerLinksSeed = Object.fromEntries(ALL_CUSTOMERS.map((c) => [c, { aCustomerId: `a-${c}` }]));

  const svcBundle = await compose({
    pg: conf.pg, objectRoot: conf.objectRoot, signingSecret: conf.signingSecret,
    wecomTransport: new FakeWecomTransport(),
    aBaseUrl: aStand.baseUrl,
    aCredential: conf.aCredentials.uploadFallback,
    a: { tenantId: conf.tenantId, bridge: true, credentials: conf.aCredentials },
    processing: { aCustomerLinks: customerLinksSeed, localOnlyCompletion: false, blockedBackoffSec: 15, aTimeoutMs: 5000 },
  });
  driverStore = svcBundle.store;
  const srv = await startServer(svcBundle, {
    port: 0,
    wecomConfig: { token: 'x', aesKey: 'x'.padEnd(32, 'x'), corpid: 'x', defaultTenantId: conf.tenantId },
    trtcCallbackKey: conf.signingSecret,
    serviceToken: conf.serviceToken,
  });
  base = `:${srv.server.address().port}`;
  ev('server-start', { port: srv.server.address().port, aStandinPort: aStand.port });

  // 邀请准备
  for (const cid of ALL_CUSTOMERS) {
    const r = await api('/api/connectors/intake/invitations', {
      tenantId: conf.tenantId, customerId: cid, role: 'customer_finance',
      allowedEvidenceKinds: ['statement', 'document'], objectRefs: [], ttlSec: 30 * 3600, createdBy: 'soak04',
    });
    if (r.status !== 200 || !r.json?.invitationId) { unexpected('invitation', `cid=${cid} status=${r.status}`); continue; }
    await api('/api/connectors/intake/accept', { tenantId: conf.tenantId, token: r.json.token, provider: 'wecom_kf', providerUserId: `wx-${r.json.invitationId}` });
    invByCustomer[cid] = r.json.invitationId;
  }
  ev('invitations-ready', { count: Object.keys(invByCustomer).length });

  // canary 初始化：固定字节内容首传（重放同字节同声明 → skipped_duplicate 幂等）
  const canaryBytes = bankCsvVariate(mulberry32(SEED_BASE + 2), {});
  const canaryFirst = await uploadOne(mulberry32(SEED_BASE + 1), 'bank', { customerId: CANARY_CUST, bytesOverride: canaryBytes, kindOverride: 'statement', label: 'canary_first' });
  if (canaryFirst.ok) {
    for (let i = 0; i < 60 && pending.size > 0; i++) { await svcBundle.processing.tick({ maxTasks: 3 }).catch(() => {}); await watchTerminals(driverStore).catch(() => {}); await sleep(500); }
    const row = (await driverStore.query(`SELECT sha256 FROM evidence_artifacts WHERE evidence_id=$1`, [canaryFirst.evidenceId])).rows[0];
    canary = { bytes: canaryBytes, customerId: CANARY_CUST, firstEvidenceId: canaryFirst.evidenceId, sha256: row?.sha256 ?? null };
    ev('canary-init', { evidenceId: canary.firstEvidenceId, sha256: canary.sha256 });
  }
  canaryUnique.bytes = declCsvVariate(mulberry32(SEED_BASE + 3));

  // driver 内 smoke：负例链路先验证（不 spawn worker）
  const smokeRng = mulberry32(SEED_BASE + 5);
  for (const cls of ['declCsv', 'empty', 'fakePdf']) await uploadOne(smokeRng, cls, { customerId: CUSTOMERS[0] });
  for (let i = 0; i < 40 && pending.size > 0; i++) {
    await svcBundle.processing.tick({ maxTasks: 3 }).catch(() => {});
    await watchTerminals(driverStore).catch(() => {});
    await sleep(500);
  }
  ev('smoke-done', { materialCount, pending: pending.size, tasks: { ...counters.tasks } });

  // ---------- 回归：现有 PG 关键测试指向本包容器 ----------
  await runPhase('regression', 0, async () => {
    if (process.env.SOAK04_SKIP_REGRESSION === '1') { ev('regression-skipped', {}); return []; }
    const files = [
      'test/goal02-parsing.test.mjs',
      'test/goal02-blocked-recovery.test.mjs',
      'test/upload-context.pg.test.mjs',
      'test/v03-evidence-pg.test.mjs',
    ];
    const results = [];
    for (const f of files) {
      const r = spawnSync(process.execPath, ['--test', f], {
        cwd: join(REPO_ROOT, 'Back', 'Connectors'),
        env: {
          ...process.env,
          CONNECTORS_TEST_PG_PORT: String(conf.pg.port),
          CONNECTORS_TEST_PG_USER: conf.pg.user,
          CONNECTORS_TEST_PG_PASSWORD: conf.pg.password,
          CONNECTORS_TEST_PG_DATABASE: conf.pg.database,
        },
        encoding: 'utf8', timeout: 8 * MIN, maxBuffer: 64 * 1024 * 1024,
      });
      const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter(Boolean).slice(-6).join(' | ');
      results.push({ file: f, status: r.status, timedOut: r.signal === 'SIGTERM', tail: tail.slice(0, 500) });
      ev('regression-file', { file: f, status: r.status, tail: tail.slice(0, 300) });
    }
    writeFileSync(join(conf.runDir, 'regression-results.json'), JSON.stringify(results, null, 2));
    ev('regression-done', { failed: results.filter((x) => x.status !== 0).length, total: results.length });
    return results;
  });

  // ---------- 基线（26min，c=1） ----------
  await runPhase('baseline', 26, async () => {
    targetWorkers = 1;
    spawnWorker({});
    const rng = mulberry32(SEED_BASE + 100);
    const sampler = setInterval(() => { sampleMetrics('baseline').then((s) => resourceGuardian(s)).catch(() => {}); }, 60_000);
    try {
      await uploadLoop(rng, {
        budget: 26 * MIN * scale, ratePerMin: 2, label: 'baseline',
        classes: ['bank', 'declCsv', 'declTxt'], weights: [4, 4, 2],
      });
    } finally { clearInterval(sampler); }
    await runInvariantCheck('baseline-end');
    return null;
  });

  // ---------- 爬坡（4 档 × 36min；故障按绝对偏移注入） ----------
  const tiers = [
    { c: 1, mins: 36, label: 'tier1-normal', rate: 2, classes: ['bank', 'declCsv', 'declTxt'], weights: [4, 4, 2] },
    { c: 2, mins: 36, label: 'tier2-dup-supersede', rate: 2.3, classes: ['bank', 'declCsv', 'declTxt'], weights: [3, 4, 2] },
    { c: 4, mins: 36, label: 'tier3-negative-longhist', rate: 4.5, classes: ['hoarderDecl', 'bank', 'declCsv', 'empty', 'fakePdf', 'truncatedCsv', 'garbage', 'hostileZip', 'largeDecl'], weights: [4, 2, 2, 1.2, 1.2, 1.2, 1.2, 0.8, 0.6] },
    { c: 8, mins: 36, label: 'tier4-mix', rate: 4.5, classes: ['hoarderDecl', 'bank', 'declCsv', 'empty', 'fakePdf', 'truncatedCsv', 'garbage', 'hostileZip', 'largeDecl'], weights: [4, 2, 2, 0.8, 0.8, 0.8, 0.8, 0.6, 0.4] },
  ];
  const RAMP_BUDGET = tiers.reduce((a, t) => a + t.mins, 0) * MIN * scale;
  const rampStart = Date.now();
  const faultSchedule = [
    { name: 'pg1-clean15s', atFrac: 0.07, run: () => pgOutage('stop', 15_000, 'PG#1-clean-15s') },
    { name: 'worker-kill-1', atFrac: 0.14, run: async () => { killWorkers(1, { reason: 'fault#1' }); await sleep(3000); spawnWorker({}); } },
    { name: 'worker-kill-2', atFrac: 0.22, run: async () => { killWorkers(1, { reason: 'fault#2' }); await sleep(3000); spawnWorker({}); } },
    { name: 'pg2-crash20s', atFrac: 0.30, run: () => pgOutage('kill', 20_000, 'PG#2-crash-20s') },
    { name: 'worker-kill-3', atFrac: 0.40, run: async () => { killWorkers(1, { reason: 'fault#3' }); await sleep(3000); spawnWorker({}); } },
    { name: 'pg3-clean30s', atFrac: 0.50, run: () => pgOutage('stop', 30_000, 'PG#3-clean-30s') },
    { name: 'worker-kill-4', atFrac: 0.61, run: async () => { killWorkers(1, { reason: 'fault#4' }); await sleep(3000); spawnWorker({}); } },
    { name: 'pg4-crash25s', atFrac: 0.72, run: () => pgOutage('kill', 25_000, 'PG#4-crash-25s') },
    { name: 'astandin-slow-4m', atFrac: 0.80, run: async () => { aStand.setMode('slow'); faultActiveUntil = Date.now() + 4 * MIN; await sleep(4 * MIN * Math.min(scale, 1)); aStand.setMode('normal'); } },
    { name: 'astandin-down-3m', atFrac: 0.90, run: async () => { aStand.setMode('down'); faultActiveUntil = Date.now() + 3 * MIN; await sleep(3 * MIN * Math.min(scale, 1)); aStand.setMode('normal'); } },
  ];
  let faultIdx = 0; let tierIdx = 0;
  await runPhase('ramp', tiers.reduce((a, t) => a + t.mins, 0), async () => {
    const sampler = setInterval(() => { sampleMetrics('ramp').then((s) => resourceGuardian(s)).catch(() => {}); }, 60_000);
    try {
      while (tierIdx < tiers.length && !stopped && !checkControl()) {
        const tier = tiers[tierIdx];
        reapWorkers();
        while (workers.size < tier.c) spawnWorker({});
        while (workers.size > tier.c) {
          const v = [...workers.values()].pop();
          try { v.child.kill('SIGTERM'); } catch { /* 已死 */ }
          workers.delete(v.child.pid);
        }
        ev('tier-start', { tier: tier.label, workers: tier.c, rate: tier.rate });
        targetWorkers = tier.c;
        const tierStart = Date.now();
        const tierBudget = tier.mins * MIN * scale;
        const rng = mulberry32(SEED_BASE + 200 + tierIdx);
        const inner = uploadLoop(rng, {
          budget: tierBudget, ratePerMin: tier.rate, label: tier.label,
          classes: tier.classes, weights: tier.weights,
        });
        while (Date.now() - tierStart < tierBudget && !stopped && !checkControl()) {
          const rampElapsed = Date.now() - rampStart;
          if (faultIdx < faultSchedule.length && rampElapsed >= faultSchedule[faultIdx].atFrac * RAMP_BUDGET) {
            const f = faultSchedule[faultIdx++];
            faultActiveUntil = Date.now() + 90_000;
            try {
              const pre = await snapshotConfirmed(driverStore, conf.tenantId);
              await f.run();
              await sleep(Math.max(15_000, 90_000 * Math.min(scale, 1))); // 恢复沉淀：租约回收/连接池重建/对账
              const inv = await runInvariantCheck(`after-${f.name}`, { preSnap: pre });
              ev('fault-recovered', { name: f.name, verdict: inv.verdict, workers: workers.size });
              if (workers.size < (tiers[tierIdx]?.c ?? 0)) spawnWorker({});
            } catch (e) { unexpected('fault-run', String(e?.message ?? e).slice(0, 200)); }
            continue;
          }
          await sleep(2000);
        }
        await inner;
        ev('tier-end', { tier: tier.label, materialCount, pending: pending.size });
        await runInvariantCheck(`tier-end-${tier.label}`);
        tierIdx += 1;
      }
    } finally { clearInterval(sampler); }
    for (let i = 0; i < 120 && pending.size > 0; i++) { await watchTerminals(driverStore).catch(() => {}); await sleep(5000); }
    return runInvariantCheck('ramp-end');
  });

  // ---------- 收尾（70min 稳定窗：无非预期错误 + 复验） ----------
  const closeout = await runPhase('closeout', 70, async () => {
    targetWorkers = 2;
    reapWorkers();
    while (workers.size > 2) {
      const v = [...workers.values()].pop();
      try { v.child.kill('SIGTERM'); } catch { /* 已死 */ }
      workers.delete(v.child.pid);
    }
    while (workers.size < 2) spawnWorker({});
    aStand.setMode('normal');
    const unexpectedAtStart = counters.unexpected.length;
    const startInv = await runInvariantCheck('closeout-start');
    const rng = mulberry32(SEED_BASE + 900);
    const sampler = setInterval(() => { sampleMetrics('closeout').then((s) => resourceGuardian(s)).catch(() => {}); }, 60_000);
    try {
      await uploadLoop(rng, {
        budget: 70 * MIN * scale, ratePerMin: 1.7, label: 'closeout',
        classes: ['hoarderDecl', 'bank', 'declCsv', 'declTxt', 'empty', 'fakePdf'], weights: [1.5, 3, 3, 1.5, 0.6, 0.6],
      });
    } finally { clearInterval(sampler); }
    for (let i = 0; i < 180 && pending.size > 0; i++) { await watchTerminals(driverStore).catch(() => {}); await sleep(5000); }
    const endInv = await runInvariantCheck('closeout-end');
    const newUnexpected = counters.unexpected.length - unexpectedAtStart;
    ev('closeout-done', { startVerdict: startInv.verdict, endVerdict: endInv.verdict, newUnexpected });
    return { startVerdict: startInv.verdict, endVerdict: endInv.verdict, newUnexpected };
  });

  // ---------- 汇总退出 ----------
  const summary = writeSummary({ startedAt, endedAt: new Date().toISOString(), closeout, finalStandin: aStand.summary() });
  ev('driver-end', { effectiveSoakMin: summary.effectiveSoakMin, unexpected: counters.unexpected.length, closeoutVerdict: closeout?.endVerdict });
  try { srv.server.closeAllConnections(); } catch { /* Node<18.2 无此方法 */ }
  await new Promise((r) => srv.close(r)).catch(() => {});
  setTimeout(() => { console.error('[soak04-driver] force-exit watchdog'); process.exit(0); }, 10_000).unref();
  for (const [, w] of workers) { try { w.child.kill('SIGTERM'); } catch { /* 已死 */ } }
  try { await svcBundle.close(); } catch { /* 已关 */ }
  try { await aStand.close(); } catch { /* 已关 */ }
  await sleep(1000);
  const pass = !SMOKE && counters.unexpected.length === 0 && summary.effectiveSoakMin >= 240 && closeout?.endVerdict === 'PASS' && closeout?.newUnexpected === 0;
  process.exit(pass ? 0 : 1);
}

process.on('unhandledRejection', (e) => { unexpected('unhandledRejection', String(e?.message ?? e).slice(0, 200)); });
process.on('uncaughtException', (e) => { unexpected('uncaughtException', String(e?.message ?? e).slice(0, 200)); });
process.on('exit', (code) => { console.error(`[soak04-driver] exit code=${code} at ${new Date().toISOString()}`); });
process.on('SIGTERM', () => { console.error('[soak04-driver] SIGTERM'); stopped = true; });
main().catch((e) => {
  ev('driver-crash', { error: String(e?.stack ?? e).slice(0, 800) });
  try { writeSummary({ crashed: true, crash: String(e?.message ?? e).slice(0, 300) }); } catch { /* 尽力 */ }
  process.exit(3);
});
