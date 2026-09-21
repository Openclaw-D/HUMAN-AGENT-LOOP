// soak-v04-system 长测驱动：单进程编排被测子进程（Edge 同构装配）+ 外发替身 sink，
// 按任务书 01_SYSTEM 矩阵执行：低载基线 → 并发 1→2→4→8 混合负载 → 稳定窗口；
// ≥8 个受控崩溃/恢复周期分散各时段；出站计数与服务回执逐条对账。
// 限速：令牌桶 ≤4 req/s（上限 5）；并发信号量 ≤ 档位上限（最高 8）；单请求超时 30s。
// 全部端口系统分配绑定 127.0.0.1；无真实外发、无凭据、无共享资源启停。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSink, writeJournalHeader } from './sink.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const PLAN = arg('plan', 'full');
const SEED = Number(arg('seed', 20260921) || 20260921);
const RUN_DIR = path.resolve(arg('run-dir', path.join('C:', 'Users', '22673', 'Desktop', 'JW', '.local', 'soak-v04-system', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const SNAPSHOT = path.resolve(arg('snapshot', path.join('C:', 'Users', '22673', 'Desktop', 'JW', '.local', 'soak-v04-system', 'snapshot', 'src')));
const RESUME = process.argv.includes('--resume');
const LEASE_MS = Number(arg('lease-ms', 8000));

// ── 计划（有效时长合计 250 分钟 ≈ 4h10m；cycles 为各档内相对分钟偏移）──
const CY = (at, type, extra = {}) => ({ atMin: at, type, ...extra });
const PLANS = {
  full: [
    { name: 'baseline', min: 30, conc: 1, sinkLatencyMs: 0, mix: { send: 70, read: 20, replay: 10 }, cycles: [] },
    { name: 't1', min: 30, conc: 2, sinkLatencyMs: 100, mix: { send: 45, replay: 15, read: 15, neg: 15, aud: 5, history: 5 },
      cycles: [CY(6, 'crash_before'), CY(15, 'error'), CY(24, 'crash_after')] },
    { name: 't2', min: 35, conc: 4, sinkLatencyMs: 300, mix: { send: 40, replay: 15, read: 15, neg: 12, aud: 6, history: 7, crossproc: 5 },
      cycles: [CY(5, 'disconnect'), CY(12, 'twoprocess'), CY(20, 'sigkill'), CY(29, 'crash_before')] },
    { name: 't3', min: 35, conc: 8, sinkLatencyMs: 600, mix: { send: 38, replay: 15, read: 15, neg: 12, aud: 6, history: 9, crossproc: 5 },
      cycles: [CY(6, 'crash_after'), CY(14, 'sigkill'), CY(22, 'twoprocess'), CY(30, 'error')] },
    { name: 'stable', min: 120, conc: 4, sinkLatencyMs: 200, mix: { send: 40, replay: 20, read: 25, neg: 10, history: 5 }, cycles: [] },
  ],
  pilot: [
    { name: 'pilot-baseline', min: 2, conc: 1, mix: { send: 70, read: 20, replay: 10 }, cycles: [] },
    { name: 'pilot-mixed', min: 4, conc: 4, mix: { send: 40, replay: 15, read: 15, neg: 12, aud: 6, history: 7, crossproc: 5 },
      cycles: [CY(0.5, 'crash_before'), CY(1.5, 'crash_after'), CY(3, 'twoprocess')] },
  ],
};

// ── 可复现随机 ──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const weighted = (mix) => {
  const entries = Object.entries(mix);
  let r = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
  return entries[entries.length - 1][0];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pctl = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// ── HTTP 客户端（30s 上限；断连场景用外部 abort）──
function httpJson(url, { method = 'GET', body, timeoutMs = 30_000, signal } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(url, {
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch { /* 非JSON响应 */ }
        resolve({ status: res.statusCode, body: parsed, raw: b, ms: Date.now() - started });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('client timeout 30s')); });
    if (signal) {
      if (signal.aborted) req.destroy(new Error('aborted before send'));
      else signal.addEventListener('abort', () => req.destroy(new Error('aborted by driver')), { once: true });
    }
    req.on('error', (e) => resolve({ status: 0, body: null, error: String(e?.message ?? e), ms: Date.now() - started }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── 全局状态 ──
const state = {
  runId: `soak-${SEED}-${Date.now()}`,
  startISO: null, endISO: null,
  children: { A: null, B: null }, // {proc, port, pid, instance}
  counts: {},                    // phase -> class -> n
  lat: {},                       // phase -> class -> [ms]
  classes: ['sent', 'replay', 'conflict', 'refused', 'inflight', 'unknown502', 'legacy_closed', 'legacy_evicted', 'bad_request', 'target_refused', 'disconnect_abort', 'expected_conn_refused', 'unexpected'],
  cycles: [],                    // 崩溃/恢复周期记录
  findings: [],                  // 缺陷/调查信号
  ledgerFile: null, metricsFile: null, eventsFile: null, stateFile: null,
  sinkBase: null, sinkCtl: null, sinkJournal: null, sinkClose: null,
  dbFile: null, auditFile: null,
  opsDone: 0, replayPool: [], legacyIds: [], trackIds: [], // trackIds: 抽样验证线程留档
  inFlight: 0, maxConcObserved: 0,
  degradedUntil: 0, degradedNote: null,
  phaseIdx: 0,
};

const CUST = Array.from({ length: 24 }, (_, i) => `soak-c${i + 1}`);
const HIST_CUST = ['soak-hist-1', 'soak-hist-2'];
const unreadable = () => `x-soak-${Math.floor(rng() * 1e6)}`;
const sessionOf = (i) => ({ principalId: `p${i}`, tenantId: `t${i}`, roles: ['business'] });

function logEvent(obj) {
  try { appendFileSync(state.eventsFile, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n'); } catch { /* 尽力 */ }
}
function classifyCount(phase, cls, ms) {
  state.counts[phase] ??= {};
  state.counts[phase][cls] = (state.counts[phase][cls] ?? 0) + 1;
  state.lat[phase] ??= {};
  (state.lat[phase][cls] ??= []).push(ms);
  state.opsDone += 1;
}
function ledger(rec) {
  try { appendFileSync(state.ledgerFile, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); } catch { /* 尽力 */ }
}

// ── 子进程管理 ──
const childEnv = (instance) => ({
  ...process.env,
  SOAK_SNAPSHOT_DIR: SNAPSHOT,
  SOAK_DB: state.dbFile,
  SOAK_SINK: state.sinkBase,
  SOAK_INSTANCE: instance,
  SOAK_LEASE_MS: String(LEASE_MS),
  SOAK_AUDIT_FILE: path.join(RUN_DIR, `audit-${instance}.jsonl`),
  SOAK_STORE_OPTS: JSON.stringify({ maxPerCustomer: 500, maxReceipts: 4096 }),
});
// 崩溃窗口：窗口内的连接拒绝/进程死亡属预期故障，不计非预期错误。
state.crashWindow = null; // {from, to}
const inCrashWindow = () => state.crashWindow && Date.now() >= state.crashWindow.from && (state.crashWindow.to === null || Date.now() <= state.crashWindow.to);

// 子进程启动互斥：崩溃周期与负载自动恢复并发时只允许一个 startChild 在飞。
const starting = new Map();
function ensureChildStarted(instance) {
  if (state.children[instance]) return Promise.resolve(state.children[instance]);
  if (!starting.has(instance)) {
    starting.set(instance, startChild(instance).finally(() => starting.delete(instance)));
  }
  return starting.get(instance);
}

function spawnChild(instance) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(HERE, 'child-server.mjs')], {
      env: childEnv(instance), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const to = setTimeout(() => reject(new Error(`child ${instance} ready timeout`)), 15_000);
    const onData = (d) => {
      out += d.toString();
      const line = out.split('\n').find((l) => l.includes('"ready"'));
      if (line) {
        clearTimeout(to);
        try {
          const info = JSON.parse(line);
          resolve({ proc, port: info.port, pid: info.pid, instance });
        } catch (e) { reject(e); }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('[fault]') || s.includes('CHILD_INTERNAL') || s.includes('SQLITE_BUSY')) logEvent({ kind: 'child-stderr', instance, line: s.trim().slice(0, 500) });
    });
    proc.on('exit', (code, sig) => {
      if (state.children[instance] && state.children[instance].pid === proc.pid) {
        logEvent({ kind: 'child-exit', instance, code, sig, expected: state.children[instance].expectedDown === true });
        state.children[instance] = null;
      }
    });
  });
}
async function startChild(instance, { expectDown = false } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const c = await spawnChild(instance);
      c.expectedDown = false;
      state.children[instance] = c;
      logEvent({ kind: 'child-start', instance, pid: c.pid, port: c.port, attempt });
      return c;
    } catch (e) {
      logEvent({ kind: 'child-start-retry', instance, attempt, error: String(e?.message ?? e) });
      await sleep(600 * attempt);
    }
  }
  throw new Error(`child ${instance} 无法启动（expectDown=${expectDown}）`);
}
function killChild(instance, sig = 'SIGKILL') {
  const c = state.children[instance];
  if (!c) return false;
  try { c.expectedDown = true; process.kill(c.pid, sig); } catch { /* 已退出 */ }
  state.children[instance] = null;
  return true;
}
const childBase = (instance) => `http://127.0.0.1:${state.children[instance]?.port}`;
const requireChild = (instance) => {
  if (!state.children[instance]) throw new Error(`child ${instance} 未运行`);
  return childBase(instance);
};

// ── 限速：令牌桶 4 req/s（突发 8）+ 并发信号量 ──
let tokens = 8;
let lastRefill = Date.now();
async function acquireToken() {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(8, tokens + ((now - lastRefill) / 1000) * 3); // 3 op/s 均值（含子请求折算后 HTTP ≤5req/s），突发上限=并发档
    lastRefill = now;
    if (tokens >= 1) { tokens -= 1; return; }
    if (Date.now() < state.degradedUntil) await sleep(500); else await sleep(60);
  }
}
async function acquireSlot(cap) {
  while (state.inFlight >= cap) await sleep(15);
  state.inFlight += 1;
  state.maxConcObserved = Math.max(state.maxConcObserved, state.inFlight);
  state.concMaxByPhase ??= {};
  state.concMaxByPhase[state.currentPhase] = Math.max(state.concMaxByPhase[state.currentPhase] ?? 0, state.inFlight);
}

// ── 业务操作 ──
let sendSeq = 0;
const newRequestId = (phase) => `r-${SEED}-${phase}-${++sendSeq}`;
async function opSend(phase, { requestId = newRequestId(phase), customerId = pick(CUST), session = sessionOf(1 + Math.floor(rng() * 4)), text = `soak msg ${Date.now()}-${Math.floor(rng() * 1e9)}`, audience = 'customer', internalContent, confirmExternalSend } = {}) {
  const body = { requestId, audience, text };
  if (internalContent !== undefined) body.internalContent = internalContent;
  if (confirmExternalSend !== undefined) body.confirmExternalSend = confirmExternalSend;
  const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId, session, body } });
  if (r.status === 200 && r.body?.ok && !r.body.replayed) {
    state.replayPool.push({ requestId, customerId, session, body, messageId: r.body.delivery?.messageId });
    if (state.replayPool.length > 200) state.replayPool.shift();
    if (state.trackIds.length < 60 && !HIST_CUST.includes(customerId)) state.trackIds.push({ requestId, customerId, messageId: r.body.delivery?.messageId });
  }
  return r;
}
async function opReplay(phase) {
  const e = state.replayPool[Math.max(0, state.replayPool.length - 1 - Math.floor(rng() * Math.min(state.replayPool.length, 50)))];
  if (!e) return null;
  const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: e.customerId, session: e.session, body: e.body } });
  // 期望：200 原回执 replayed=true（同 messageId）。若 receipt 被裁剪（有界窗口）则成为新发送——按设计记录。
  if (r.status === 200 && r.body?.replayed && r.body.delivery?.messageId !== e.messageId) {
    state.findings.push({ id: 'REPLAY_MISMATCH', at: new Date().toISOString(), phase, requestId: e.requestId, detail: `重放返回他人/不同回执 messageId=${r.body.delivery?.messageId} 期望=${e.messageId}`, severity: 'HIGH' });
    return { ...r, __cls: 'unexpected' };
  }
  if (r.status === 200 && r.body?.replayed) return { ...r, __cls: 'replay' };
  if (r.status === 200 && !r.body?.replayed) return { ...r, __cls: 'unexpected' }; // 同ID同载荷不该再发送
  if (r.status === 409) return { ...r, __cls: r.body?.error === 'REQUEST_ID_IN_FLIGHT' ? 'inflight' : 'conflict' };
  return { ...r, __cls: 'unexpected' };
}
async function opNeg(phase) {
  // 从近期回执池取 ID 做跨作用域/跨载荷负例（409、零出站、不披露）。
  const e = state.replayPool[Math.floor(rng() * Math.max(1, state.replayPool.length - 20))] ?? state.replayPool[0];
  const kind = weighted({ crossCustomer: 3, crossPrincipal: 2, crossTenant: 2, crossFingerprint: 2, legacy: 3, unreadableTarget: 2, badPayload: 2 });
  if (kind === 'legacy') {
    const lid = pick(state.legacyIds);
    if (!lid) return null;
    const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: lid, audience: 'customer', text: 'legacy probe' } } });
    if (r.status === 409 && r.body?.error === 'REQUEST_ID_CONFLICT' && !r.body?.delivery) return { ...r, __cls: 'legacy_closed' };
    // 旧回执行被有界裁剪逐出：成为新发送（设计内有界窗口），重新播种并记录。
    if (r.status === 200) {
      await seedLegacy(lid);
      return { ...r, __cls: 'legacy_evicted' };
    }
    return { ...r, __cls: 'unexpected' };
  }
  if (kind === 'unreadableTarget') {
    const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: unreadable(), session: sessionOf(1), body: { requestId: newRequestId(phase), audience: 'customer', text: 'target refused' } } });
    if (r.status === 403 && !r.body?.delivery) return { ...r, __cls: 'target_refused' };
    return { ...r, __cls: 'unexpected' };
  }
  if (kind === 'badPayload') {
    const variants = [
      { body: { requestId: '', audience: 'customer', text: 'x' } },
      { body: { requestId: newRequestId(phase), audience: 'both', text: 'x' } },
      { body: { requestId: newRequestId(phase), audience: 'customer', text: '' } },
      { body: { requestId: 'x'.repeat(129), audience: 'customer', text: 'x' } },
    ];
    const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), ...pick(variants) } });
    if (r.status === 400) return { ...r, __cls: 'bad_request' };
    return { ...r, __cls: 'unexpected' };
  }
  if (!e) return null;
  const variants = {
    crossCustomer: { customerId: `soak-cx-${Math.floor(rng() * 1000)}`, session: e.session, body: e.body },
    crossPrincipal: { customerId: e.customerId, session: sessionOf(90 + Math.floor(rng() * 9)), body: e.body },
    crossTenant: { customerId: e.customerId, session: { ...e.session, tenantId: `tx-${Math.floor(rng() * 1000)}` }, body: e.body },
    crossFingerprint: { customerId: e.customerId, session: e.session, body: { ...e.body, text: `${e.body.text}-mutated` } },
  };
  const v = variants[kind];
  const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: v });
  if (r.status === 409 && r.body?.error === 'REQUEST_ID_CONFLICT' && r.body?.delivery === undefined) return { ...r, __cls: 'conflict' };
  if (r.status === 409 && r.body?.error === 'REQUEST_ID_IN_FLIGHT') return { ...r, __cls: 'inflight' };
  state.findings.push({ id: 'SCOPE_LEAK', at: new Date().toISOString(), phase, kind, requestId: e.requestId, status: r.status, body: r.body, severity: 'CRITICAL' });
  return { ...r, __cls: 'unexpected' };
}
async function opAudience(phase) {
  const rid = newRequestId(phase);
  const internalFirst = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: 'internal content probe', internalContent: true } } });
  if (!(internalFirst.status === 403 && internalFirst.body?.error === 'AUDIENCE_MISMATCH' && !internalFirst.body?.delivery)) {
    state.findings.push({ id: 'AUDIENCE_GATE_LOOSE', at: new Date().toISOString(), phase, requestId: rid, status: internalFirst.status, body: internalFirst.body, severity: 'HIGH' });
    return { ...internalFirst, __cls: 'unexpected' };
  }
  // 拒绝不落回执：修正载荷后同 ID 可正常发送。
  const confirmed = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: 'internal content probe', internalContent: true, confirmExternalSend: true } } });
  if (confirmed.status !== 200) return { ...confirmed, __cls: 'unexpected' };
  const internal = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: newRequestId(phase), audience: 'internal', text: 'internal only' } } });
  return { ...confirmed, __cls: internal.status === 200 ? 'sent' : 'unexpected', __extra: 1 };
}
async function opRead(phase) {
  const cid = pick([...CUST, ...HIST_CUST]);
  const mode = weighted({ tail: 3, walk: 2, audienceSplit: 1 });
  if (mode === 'tail') {
    const r = await httpJson(`${requireChild('A')}/messages?customerId=${cid}&limit=50`);
    if (r.status !== 200) return { ...r, __cls: 'unexpected' };
    const msgs = r.body.messages ?? [];
    const seqs = msgs.map((m) => m.seq);
    for (let i = 1; i < seqs.length; i++) if (seqs[i] <= seqs[i - 1]) {
      state.findings.push({ id: 'READ_ORDER', at: new Date().toISOString(), phase, customerId: cid, detail: `尾部读非严格升序 seq=${seqs[i - 1]}>${seqs[i]}`, severity: 'HIGH' });
      return { ...r, __cls: 'unexpected' };
    }
    if (r.body.truncated && !(r.body.retentionBase > 0)) {
      state.findings.push({ id: 'TRUNCATED_NO_BASE', phase, customerId: cid, severity: 'MEDIUM' });
    }
    return { ...r, __cls: 'sent' };
  }
  if (mode === 'walk') {
    const seen = new Set(); let pages = 0;
    const base = `${requireChild('A')}/messages?customerId=${cid}&limit=120&after=`;
    let cur = '0';
    let gaps = 0; let prev = null; let ok = true;
    while (pages < 3) {
      const r = await httpJson(`${base}${cur}`);
      if (r.status !== 200) { ok = false; break; }
      const msgs = r.body.messages ?? [];
      for (const m of msgs) {
        if (seen.has(m.seq)) { state.findings.push({ id: 'PAGE_DUP', phase, customerId: cid, seq: m.seq, severity: 'HIGH' }); ok = false; break; }
        seen.add(m.seq);
        if (prev !== null && m.seq !== prev + 1) gaps += 1;
        prev = m.seq;
      }
      if (!ok) break;
      pages += 1;
      if (msgs.length === 0) break;
      cur = r.body.cursor;
      if (pages >= 3) break;
    }
    if (gaps > 0 && ok) { /* 走读中途有并发追加造成的表观跳跃属正常；仅重复/倒序为缺陷 */ }
    return { status: ok ? 200 : 500, __cls: ok ? 'sent' : 'unexpected', ms: 0 };
  }
  // audienceSplit：internal 与 customer 读集必须互斥。
  const rc = await httpJson(`${requireChild('A')}/messages?customerId=${cid}&audience=customer&limit=200`);
  const ri = await httpJson(`${requireChild('A')}/messages?customerId=${cid}&audience=internal&limit=200`);
  if (rc.status !== 200 || ri.status !== 200) return { status: 500, __cls: 'unexpected', ms: 0 };
  const idsC = new Set((rc.body.messages ?? []).map((m) => m.messageId));
  for (const m of ri.body.messages ?? []) if (idsC.has(m.messageId)) {
    state.findings.push({ id: 'AUDIENCE_SPLIT_FAIL', phase, customerId: cid, messageId: m.messageId, severity: 'HIGH' });
    return { status: 500, __cls: 'unexpected', ms: 0 };
  }
  return { status: 200, __cls: 'sent', ms: 0 };
}
async function opHistory(phase) {
  const cid = pick(HIST_CUST);
  const r = await opSend(phase, { customerId: cid, requestId: newRequestId(phase) });
  if (r.status === 200) {
    // 每累计 ~40 次追加做一次裁剪面检查：base>0 时 truncated 必须显式。
    if (rng() < 0.025) {
      const tail = await httpJson(`${requireChild('A')}/messages?customerId=${cid}&limit=10`);
      if (tail.status === 200 && (tail.body.truncated || (tail.body.retentionBase ?? 0) > 0) && tail.body.truncated !== true) {
        state.findings.push({ id: 'TRUNCATION_MISSING', phase, customerId: cid, body: { truncated: tail.body.truncated, retentionBase: tail.body.retentionBase }, severity: 'MEDIUM' });
        return { ...r, __cls: 'unexpected' };
      }
    }
  }
  return r;
}
async function opCrossProc(phase) {
  // 同 requestId 并发打到共享同库的两个子进程：恰一次真实发送；败者 409 不披露。
  if (!state.children.B) return null;
  const rid = newRequestId(phase);
  const payload = { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: `cross ${Date.now()}` } };
  const [ra, rb] = await Promise.all([
    httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: payload }),
    httpJson(`${requireChild('B')}/messages`, { method: 'POST', body: payload }),
  ]);
  const okA = ra.status === 200 && ra.body?.ok && !ra.body?.replayed;
  const okB = rb.status === 200 && rb.body?.ok && !rb.body?.replayed;
  const cnt = (okA ? 1 : 0) + (okB ? 1 : 0);
  // 败者合法结果：409（IN_FLIGHT/CONFLICT，不披露）或 200 replayed（到达时胜者已完成=顺序重放）。
  const loserOk = (r) => (r.status === 409 && r.body?.delivery === undefined) || (r.status === 200 && r.body?.replayed === true);
  const loser = okA ? rb : ra;
  if (cnt === 1 && loserOk(loser)) {
    const win = okA ? ra : rb;
    state.replayPool.push({ requestId: rid, customerId: 'soak-c1', session: sessionOf(1), body: payload.body, messageId: win.body?.delivery?.messageId });
    if (state.replayPool.length > 200) state.replayPool.shift();
    return { status: 200, __cls: 'sent', __extra: loser.status === 200 ? 0 : 1, ms: Math.max(ra.ms, rb.ms) };
  }
  if (ra.status === 0 || rb.status === 0) return { status: 0, __cls: 'unexpected', ms: 0 };
  state.findings.push({ id: 'CROSSPROC_RACE', at: new Date().toISOString(), phase, requestId: rid, ra: { s: ra.status, b: ra.body }, rb: { s: rb.status, b: rb.body }, severity: 'HIGH' });
  return { status: 500, __cls: 'unexpected', ms: 0 };
}

// ── 崩溃/恢复周期 ──
async function arm(requestId, mode, hangMs = 3000, instance = 'A') {
  await httpJson(`${requireChild(instance)}/__ctl/arm`, { method: 'POST', body: { requestId, mode, hangMs } });
}
async function sinkCount(requestId) {
  const r = await httpJson(`${state.sinkCtl}/__ctl/count`);
  return r.body?.byRequest?.[requestId] ?? 0;
}
async function receiptOf(requestId, instance = 'A') {
  const r = await httpJson(`${requireChild(instance)}/__ctl/receipt?requestId=${encodeURIComponent(requestId)}`);
  return r.body?.record ?? null;
}
async function cycle({ type, phase }) {
  const rid = newRequestId(phase);
  const started = new Date().toISOString();
  const rec = { type, phase, requestId: rid, started, steps: [] };
  state.children.A.expectedDown = type !== 'twoprocess' && type !== 'disconnect';
  state.crashWindow = { from: Date.now(), to: null };
  try {
    if (type === 'crash_before' || type === 'crash_after') {
      const bodyText = `cycle ${type} ${Date.now()}`;
      await arm(rid, type);
      const r = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: bodyText } }, timeoutMs: 8000 });
      rec.steps.push({ step: 'crash-post', status: r.status, err: r.error ?? null });
      await sleep(400);
      killChild('A');
      await ensureChildStarted('A');
      rec.restartedAt = new Date().toISOString();
      // 租约内：同 scope 同载荷 → 409 IN_FLIGHT 零发送（重放必须用与原始请求完全一致的载荷）。
      const post = { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: bodyText } };
      const inLease = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: post });
      rec.inLease = { status: inLease.status, error: inLease.body?.error ?? null };
      const sc = await sinkCount(rid);
      rec.sinkAfterCrash = sc;
      // 租约到期收敛 unknown 后重放零二次发送。
      await sleep(LEASE_MS + 1500);
      const afterLease = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: post });
      rec.afterLease = { status: afterLease.status, replayed: afterLease.body?.replayed ?? null, state: afterLease.body?.delivery?.state ?? null };
      rec.sinkFinal = await sinkCount(rid);
      rec.recoveredAt = new Date().toISOString();
      // 断言
      const wantSink = type === 'crash_after' ? 1 : 0;
      if (rec.sinkFinal !== wantSink) state.findings.push({ id: 'CYCLE_SINK_COUNT', ...rec, severity: 'CRITICAL', detail: `期望出站${wantSink} 实际${rec.sinkFinal}` });
      if (inLease.status !== 409 || inLease.body?.error !== 'REQUEST_ID_IN_FLIGHT') state.findings.push({ id: 'CYCLE_INFLIGHT', ...rec, severity: 'HIGH', detail: `租约内期望IN_FLIGHT 实际${inLease.status}/${inLease.body?.error}` });
      if (afterLease.status !== 200 || afterLease.body?.replayed !== true || afterLease.body?.delivery?.state !== 'unknown') state.findings.push({ id: 'CYCLE_UNKNOWN_CONVERGE', ...rec, severity: 'HIGH', detail: JSON.stringify(rec.afterLease) });
      if (sc > 0 && type === 'crash_before') state.findings.push({ id: 'CYCLE_EARLY_SINK', ...rec, severity: 'CRITICAL' });
    }
    if (type === 'error') {
      const bodyText = `cycle error ${Date.now()}`;
      await arm(rid, 'error');
      const r = await opSend(phase, { requestId: rid, customerId: 'soak-c1', session: sessionOf(1), text: bodyText });
      rec.deliverError = { status: r.status, error: r.body?.error ?? null };
      rec.sinkFinal = await sinkCount(rid);
      const replay = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c1', session: sessionOf(1), body: { requestId: rid, audience: 'customer', text: bodyText } } });
      rec.replay = { status: replay.status, replayed: replay.body?.replayed ?? null, state: replay.body?.delivery?.state ?? null };
      rec.sinkFinal2 = await sinkCount(rid);
      rec.recoveredAt = new Date().toISOString();
      if (r.status !== 502 || r.body?.error !== 'DELIVERY_UNKNOWN') state.findings.push({ id: 'CYCLE_ERROR_502', ...rec, severity: 'HIGH' });
      if (rec.sinkFinal !== 0 || rec.sinkFinal2 !== 0) state.findings.push({ id: 'CYCLE_ERROR_SINK', ...rec, severity: 'CRITICAL', detail: `error注入不应出站：${rec.sinkFinal}/${rec.sinkFinal2}` });
      if (replay.status !== 200 || replay.body?.replayed !== true || replay.body?.delivery?.state !== 'unknown') state.findings.push({ id: 'CYCLE_ERROR_REPLAY', ...rec, severity: 'HIGH' });
    }
    if (type === 'sigkill') {
      const bodyText = `cycle sigkill ${Date.now()}`;
      await arm(rid, 'hang_ms', 6000);
      const post = { customerId: 'soak-c2', session: sessionOf(2), body: { requestId: rid, audience: 'customer', text: bodyText } };
      httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: post, timeoutMs: 25_000 });
      await sleep(700);
      killChild('A', 'SIGKILL');
      rec.killedAt = new Date().toISOString();
      await ensureChildStarted('A');
      rec.restartedAt = new Date().toISOString();
      const inLease = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: post });
      rec.inLease = { status: inLease.status, error: inLease.body?.error ?? null };
      rec.sinkFinal = await sinkCount(rid);
      if (inLease.status !== 409 || inLease.body?.error !== 'REQUEST_ID_IN_FLIGHT') state.findings.push({ id: 'SIGKILL_INFLIGHT', ...rec, severity: 'HIGH', detail: `SIGKILL后intent应IN_FLIGHT，实际${inLease.status}/${inLease.body?.error}` });
      if (rec.sinkFinal !== 0) state.findings.push({ id: 'SIGKILL_SINK', ...rec, severity: 'CRITICAL', detail: `hang在出站前被杀不应出站，实际${rec.sinkFinal}` });
      // 租约后收敛检查
      await sleep(LEASE_MS + 1500);
      const afterLease = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: post });
      rec.afterLease = { status: afterLease.status, state: afterLease.body?.delivery?.state ?? null, replayed: afterLease.body?.replayed ?? null };
      if (afterLease.status !== 200 || afterLease.body?.replayed !== true || afterLease.body?.delivery?.state !== 'unknown') state.findings.push({ id: 'SIGKILL_CONVERGE', ...rec, severity: 'HIGH', detail: JSON.stringify(rec.afterLease) });
      rec.recoveredAt = new Date().toISOString();
    }
    if (type === 'disconnect') {
      const bodyText = `cycle disconnect ${Date.now()}`;
      await arm(rid, 'hang_ms', 2500);
      const ac = new AbortController();
      const r = httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c3', session: sessionOf(3), body: { requestId: rid, audience: 'customer', text: bodyText } }, signal: ac.signal });
      await sleep(300);
      ac.abort(); // terminal 前断连
      await r; // 客户端侧必然 error
      rec.clientAbort = true;
      await sleep(3200); // 服务端完成 deliver+finalize
      rec.sinkFinal = await sinkCount(rid);
      const rec2 = await receiptOf(rid);
      rec.receipt = { status: rec2?.status, state: rec2?.state };
      const replay = await httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c3', session: sessionOf(3), body: { requestId: rid, audience: 'customer', text: bodyText } } });
      rec.replay = { status: replay.status, replayed: replay.body?.replayed ?? null, messageId: replay.body?.delivery?.messageId ?? null };
      rec.recoveredAt = new Date().toISOString();
      if (rec.sinkFinal !== 1) state.findings.push({ id: 'DISCONNECT_SINK', ...rec, severity: 'HIGH', detail: `断连后服务端应恰好完成一次出站，实际${rec.sinkFinal}` });
      if (rec2?.status !== 'terminal' || rec2?.state !== 'sent') state.findings.push({ id: 'DISCONNECT_RECEIPT', ...rec, severity: 'HIGH' });
      if (replay.body?.replayed !== true) state.findings.push({ id: 'DISCONNECT_REPLAY', ...rec, severity: 'HIGH' });
    }
    if (type === 'twoprocess') {
      if (!state.children.B) await ensureChildStarted('B');
      // B 进程视角：A 有 pending intent（hang）时 B 同 ID 提交 → 409 不进入发送。
      const rid2 = newRequestId(phase);
      await arm(rid2, 'hang_ms', 4000);
      const slow = httpJson(`${requireChild('A')}/messages`, { method: 'POST', body: { customerId: 'soak-c4', session: sessionOf(4), body: { requestId: rid2, audience: 'customer', text: 'in-flight hold' } }, timeoutMs: 20_000 });
      await sleep(250);
      const fromB = await httpJson(`${requireChild('B')}/messages`, { method: 'POST', body: { customerId: 'soak-c4', session: sessionOf(4), body: { requestId: rid2, audience: 'customer', text: 'in-flight hold' } } });
      await slow;
      rec.b = { status: fromB.status, error: fromB.body?.error ?? null };
      rec.sinkFinal = await sinkCount(rid2);
      if (fromB.status !== 409) state.findings.push({ id: 'CROSSPROC_INFLIGHT', ...rec, severity: 'HIGH', detail: `跨进程pending应409，实际${fromB.status}` });
      if (rec.sinkFinal !== 1) state.findings.push({ id: 'CROSSPROC_SINK', ...rec, severity: 'CRITICAL', detail: `in-flight持有者应恰好1次出站，实际${rec.sinkFinal}` });
      rec.recoveredAt = new Date().toISOString();
    }
    rec.finished = new Date().toISOString();
    rec.ok = !state.findings.some((f) => f.requestId === rid || (f.phase === phase && f.id.startsWith('CYCLE') === false && f.requestId === rid));
  } catch (e) {
    rec.error = String(e?.message ?? e);
    state.findings.push({ id: 'CYCLE_HARNESS_ERROR', ...rec, severity: 'MEDIUM' });
    // 尽力恢复子进程再继续长测
    await ensureChildStarted('A');
  } finally {
    state.children.A.expectedDown = false;
    state.crashWindow.to = Date.now();
  }
  state.cycles.push(rec);
  logEvent({ kind: 'cycle', ...rec });
  await sleep(500);
}

// ── 采样与资源守卫 ──
let sampleN = 0;
const latWindow = { t: Date.now(), byClass: {} };
async function sample(phaseName) {
  sampleN += 1;
  const m = {
    at: new Date().toISOString(), phase: phaseName, sample: sampleN, opsDone: state.opsDone,
    inFlight: state.inFlight, driverRss: process.memoryUsage().rss, hostFreeMem: os.freemem(),
    children: {}, sinkTotal: null,
  };
  for (const inst of ['A', 'B']) {
    if (!state.children[inst]) continue;
    const r = await httpJson(`${childBase(inst)}/__ctl/stats`, { timeoutMs: 5000 });
    if (r.status === 200) m.children[inst] = { rss: r.body.rss, heapUsed: r.body.heapUsed, lag: r.body.eventLoopLagMs, store: r.body.store, uptime: r.body.uptimeSec };
  }
  const sc = await httpJson(`${state.sinkCtl}/__ctl/count`, { timeoutMs: 5000 });
  if (sc.status === 200) m.sinkTotal = sc.body.total;
  appendFileSync(state.metricsFile, JSON.stringify(m) + '\n');
  if (m.hostFreeMem < 2 * 1024 ** 3) {
    state.degradedUntil = Date.now() + 5 * 60_000;
    state.degradedNote = 'hostFreeMem<2GB → 降载5分钟';
    logEvent({ kind: 'degrade', freeMem: m.hostFreeMem });
  }
  // 每5分钟聚合一帧
  if (sampleN % 5 === 0) {
    const agg = { at: m.at, phase: phaseName, windowMin: 5, counts: state.counts[phaseName] ?? {}, latP: {} };
    for (const [cls, arr] of Object.entries(state.lat[phaseName] ?? {})) {
      agg.latP[cls] = { n: arr.length, p50: pctl(arr, 50), p95: pctl(arr, 95), p99: pctl(arr, 99) };
    }
    writeFileSync(path.join(RUN_DIR, `summary-${String(sampleN).padStart(4, '0')}.json`), JSON.stringify(agg, null, 1));
  }
  checkpoint(phaseName);
}
function checkpoint(phaseName) {
  writeFileSync(state.stateFile, JSON.stringify({
    runId: state.runId, seed: SEED, plan: PLAN, phaseIdx: state.phaseIdx, phaseName,
    opsDone: state.opsDone, sendSeq, cyclesDone: state.cycles.length, at: new Date().toISOString(),
  }));
}

// ── legacy 播种 ──
async function seedLegacy(rid) {
  await httpJson(`${requireChild('A')}/__ctl/seed-legacy`, { method: 'POST', body: { requestId: rid, fingerprint: JSON.stringify({ audience: 'customer', text: 'legacy probe', threadId: null, internalContent: false }), result: { ok: true, legacy: true, delivery: { messageId: 'legacy-private' } }, customerId: 'soak-old' } });
}

// ── 单相执行 ──
async function runPhase(phaseDef, phaseIdx) {
  state.phaseIdx = phaseIdx;
  const phase = phaseDef.name;
  state.currentPhase = phase;
  state.counts[phase] = {}; state.lat[phase] = {};
  // 本档外发延迟注入：抬升真实在途并发（限速不变，仍 ≤3op/s），检验档位并发下的排队与一致。
  await httpJson(`${state.sinkCtl}/__ctl/sink`, { method: 'POST', body: { latencyMaxMs: phaseDef.sinkLatencyMs ?? 0 } });
  const endAt = Date.now() + phaseDef.min * 60_000;
  const cycleQueue = [...phaseDef.cycles];
  logEvent({ kind: 'phase-start', phase, conc: phaseDef.conc, min: phaseDef.min, sinkLatencyMs: phaseDef.sinkLatencyMs ?? 0 });
  const sampler = setInterval(() => { sample(phase).catch(() => {}); }, 60_000);
  let nextCycle = cycleQueue.shift();
  try {
    while (Date.now() < endAt) {
      const elapsedMin = (Date.now() - (endAt - phaseDef.min * 60_000)) / 60_000;
      if (nextCycle && elapsedMin >= nextCycle.atMin) {
        await acquireSlot(8);
        try { await cycle({ ...nextCycle, phase }); } finally { state.inFlight -= 1; }
        nextCycle = cycleQueue.shift();
        continue;
      }
      const op = weighted(phaseDef.mix);
      await acquireToken();
      await acquireSlot(phaseDef.conc);
      const t0 = Date.now();
      let r = null;
      try {
        if (op === 'send') r = await opSend(phase);
        else if (op === 'replay') r = await opReplay(phase);
        else if (op === 'neg') r = await opNeg(phase);
        else if (op === 'aud') r = await opAudience(phase);
        else if (op === 'read') r = await opRead(phase);
        else if (op === 'history') r = await opHistory(phase);
        else if (op === 'crossproc') r = await opCrossProc(phase);
        if (!r) { state.inFlight -= 1; continue; }
        const cls = r.__cls ?? (r.status === 200 ? 'sent' : 'unexpected');
        if (r.__extra) classifyCount(phase, 'sent', 0);
        classifyCount(phase, cls, r.ms ?? (Date.now() - t0));
        if (cls === 'unexpected') {
          logEvent({ kind: 'unexpected', phase, op, status: r.status, error: r.error ?? null, body: r.body ?? null, requestId: r?.body?.requestId ?? null });
          // 崩溃窗口内 ECONNREFUSED 已由周期流程吸收；负载途中连接被拒=意外
          if (r.status === 0 && !String(r.error ?? '').includes('aborted')) {
            if (!state.children.A) { await ensureChildStarted('A'); logEvent({ kind: 'auto-restart', phase }); }
          }
        }
      } catch (e) {
        classifyCount(phase, 'unexpected', Date.now() - t0);
        logEvent({ kind: 'op-throw', phase, op, error: String(e?.message ?? e) });
        await ensureChildStarted('A');
      } finally {
        state.inFlight -= 1;
      }
    }
  } finally {
    clearInterval(sampler);
  }
  logEvent({ kind: 'phase-end', phase, counts: state.counts[phase] });
}

// ── 收尾对账 ──
async function reconcile() {
  const out = { at: new Date().toISOString(), hardInvariants: {}, targeted: [], notes: [] };
  // 1) sink 日志逐条：同 requestId 出站 ≤1。
  const lines = readFileSync(state.sinkJournal, 'utf8').split('\n').filter(Boolean);
  const perId = new Map();
  for (const l of lines) {
    const rec = JSON.parse(l);
    perId.set(rec.requestId, (perId.get(rec.requestId) ?? 0) + 1);
  }
  const dup = [...perId.entries()].filter(([, c]) => c > 1);
  out.hardInvariants.noDuplicateExternalSend = dup.length === 0;
  out.journalLines = lines.length;
  out.distinctRequestIds = perId.size;
  if (dup.length) {
    out.hardInvariants.dupExamples = dup.slice(0, 20);
    state.findings.push({ id: 'DUP_SEND', severity: 'CRITICAL', detail: `同requestId多次出站 ${dup.length} 例`, examples: dup.slice(0, 10) });
  }
  // 2) 定向回执 ↔ 出站对账：崩溃周期、unknown、replay 抽样、track 样本。
  const targets = new Set();
  for (const c of state.cycles) targets.add(c.requestId);
  for (const e of state.replayPool.slice(-40)) targets.add(e.requestId);
  for (const t of state.trackIds) targets.add(t.requestId);
  for (const rid of targets) {
    const record = await receiptOf(rid).catch(() => null);
    const cnt = perId.get(rid) ?? 0;
    const row = { requestId: rid, sink: cnt, receipt: record ? { status: record.status, state: record.state, scope: record.scope } : null };
    if (record?.status === 'terminal' && record?.state === 'sent' && cnt !== 1) {
      row.violation = 'SENT_WITHOUT_SINK_OR_EXTRA';
      state.findings.push({ id: 'RECON_SENT_MISMATCH', severity: 'CRITICAL', ...row });
    }
    if (record?.state === 'unknown' && cnt > 1) {
      row.violation = 'UNKNOWN_RESENT';
      state.findings.push({ id: 'RECON_UNKNOWN_RESENT', severity: 'CRITICAL', ...row });
    }
    if (!record && cnt > 0) {
      row.violation = 'SINK_WITHOUT_RECEIPT';
      state.findings.push({ id: 'RECON_ORPHAN_SINK', severity: 'HIGH', ...row });
    }
    out.targeted.push(row);
  }
  // 3) 已确认持久数据不丢：track 样本 messageId 在最终重启后仍可读（低量客户，未触裁剪）。
  if (state.children.A) killChild('A');
  await sleep(400);
  await ensureChildStarted('A'); // 干净重启后再验
  let missing = 0;
  for (const t of state.trackIds) {
    const r = await httpJson(`${requireChild('A')}/messages?customerId=${t.customerId}&limit=500`);
    const found = (r.body?.messages ?? []).some((m) => m.messageId === t.messageId);
    if (!found) missing += 1;
  }
  out.confirmedDataMissing = missing;
  out.hardInvariants.noLostConfirmedData = missing === 0;
  if (missing > 0) state.findings.push({ id: 'CONFIRMED_DATA_MISSING', severity: 'CRITICAL', detail: `${missing} 条已确认200的消息重启后不可读` });
  // 4) 最终 store 统计
  const st = await httpJson(`${requireChild('A')}/__ctl/stats`);
  out.finalStoreStats = st.body?.store ?? null;
  return out;
}

// ── 主流程 ──
async function main() {
  mkdirSync(RUN_DIR, { recursive: true });
  state.runId = `soak-${PLAN}-${SEED}`;
  state.dbFile = path.join(RUN_DIR, 'messages.db');
  state.auditFile = path.join(RUN_DIR, 'audit-driver.jsonl');
  state.ledgerFile = path.join(RUN_DIR, 'ledger.jsonl');
  state.metricsFile = path.join(RUN_DIR, 'metrics.jsonl');
  state.eventsFile = path.join(RUN_DIR, 'events.jsonl');
  state.stateFile = path.join(RUN_DIR, 'state.json');
  state.sinkJournal = path.join(RUN_DIR, 'sink-journal.jsonl');
  state.startISO = new Date().toISOString();
  writeJournalHeader(state.sinkJournal);
  logEvent({ kind: 'run-start', plan: PLAN, seed: SEED, runDir: RUN_DIR, snapshot: SNAPSHOT, leaseMs: LEASE_MS, node: process.version });

  const phases = PLANS[PLAN];
  if (!phases) throw new Error(`未知计划 ${PLAN}`);

  // sink 启动 + 主子进程启动
  const sink = await startSink({ journalFile: state.sinkJournal, chaos: { latencyMaxMs: 0, errorRate: 0 } });
  state.sinkBase = sink.baseUrl;
  state.sinkCtl = sink.baseUrl;
  state.sinkClose = sink.close;
  logEvent({ kind: 'sink-ready', port: sink.port });
  await startChild('A');
  // legacy 种子（旧无作用域回执负例，20 个）
  for (let i = 0; i < 20; i++) {
    const rid = `legacy-${SEED}-${i}`;
    await seedLegacy(rid);
    state.legacyIds.push(rid);
  }

  // 阶段推进（--resume：跳过 state.json 中已完成的相位索引）
  if (RESUME && existsSync(state.stateFile)) {
    try {
      const s = JSON.parse(readFileSync(state.stateFile, 'utf8'));
      state.opsDone = s.opsDone ?? 0; sendSeq = s.sendSeq ?? 0;
      state.phaseIdx = s.phaseIdx ?? 0;
      logEvent({ kind: 'resume', from: s });
    } catch { state.phaseIdx = 0; }
  }
  const phaseResults = [];
  for (let i = 0; i < phases.length; i++) {
    if (i < state.phaseIdx) { phaseResults.push({ name: phases[i].name, skipped: 'done-before-resume' }); continue; }
    const t0 = new Date().toISOString();
    await runPhase(phases[i], i);
    phaseResults.push({
      name: phases[i].name, min: phases[i].min, conc: phases[i].conc,
      startedAt: t0, endedAt: new Date().toISOString(),
      counts: state.counts[phases[i].name],
      latP: Object.fromEntries(Object.entries(state.lat[phases[i].name] ?? {}).map(([k, arr]) => [k, { n: arr.length, p50: pctl(arr, 50), p95: pctl(arr, 95), p99: pctl(arr, 99) }])),
    });
    writeFileSync(path.join(RUN_DIR, `phase-${phases[i].name}-result.json`), JSON.stringify(phaseResults[phaseResults.length - 1], null, 1));
  }

  // 收尾对账
  const recon = await reconcile();
  state.endISO = new Date().toISOString();
  const results = {
    runId: state.runId, plan: PLAN, seed: SEED,
    startISO: state.startISO, endISO: state.endISO,
    wallMinutes: Math.round((Date.now() - new Date(state.startISO).getTime()) / 60_000),
    effectiveMinutes: phases.reduce((s, p) => s + p.min, 0),
    node: process.version, snapshotDir: SNAPSHOT,
    leaseMs: LEASE_MS,
    opsTotal: state.opsDone, maxConcObserved: state.maxConcObserved,
    concMaxByPhase: state.concMaxByPhase ?? {},
    phases: phaseResults,
    cycles: state.cycles,
    cycleCount: state.cycles.length,
    findings: state.findings,
    recon,
    degraded: state.degradedNote,
  };
  writeFileSync(path.join(RUN_DIR, 'RESULTS.json'), JSON.stringify(results, null, 1));
  logEvent({ kind: 'run-end', cycles: state.cycles.length, findings: state.findings.length });
  // 清理本包资源
  killChild('A'); killChild('B');
  await sink.close();
  const critical = state.findings.filter((f) => f.severity === 'CRITICAL').length;
  console.log(JSON.stringify({ done: true, resultsFile: path.join(RUN_DIR, 'RESULTS.json'), cycles: state.cycles.length, findings: state.findings.length, critical }));
  // 有硬不变量违反（CRITICAL）→ 退出码 2，供自动化判定
  if (critical > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error('DRIVER_FATAL', e);
  logEvent({ kind: 'driver-fatal', error: String(e?.stack ?? e) });
  killChild('A'); killChild('B');
  process.exit(1);
});
