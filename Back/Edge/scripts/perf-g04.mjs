// goal-04 性能驱动（D1/D2/D3 三档，按 BASELINE.md §2 冻结档位执行）。
// 每轮独立 bootStack（隔离 PG 15438 / A 内核 17923 / live Edge），用后即毁；
// 全部结果（含失败轮）落 docs/backend-upgrade/goal-04/evidence/perf-g04-<ts>/。
// 用法：node scripts/perf-g04.mjs [--tiers D1,D2,D3] [--rounds 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { bootG04, runFullChain, readSse } from '../test/e1/g04-chain.mjs';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TIERS = (argOf('--tiers', 'D1,D2,D3')).split(',');
const ROUNDS = Number(argOf('--rounds', '3'));
const T1 = 't1';
const wan = (n) => n * 1_000_000;
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'backend-upgrade', 'goal-04', 'evidence', `perf-g04-${STAMP}`);
mkdirSync(OUT_DIR, { recursive: true });

const pct = (arr, q) => {
  const a = [...arr].sort((x, y) => x - y);
  if (a.length === 0) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1));
  return Math.round(a[idx]);
};
const summarize = (arr) => {
  if (!arr || arr.length === 0) return { n: 0 };
  const s = { n: arr.length, min: pct(arr, 0), median: pct(arr, 0.5), max: pct(arr, 1) };
  if (arr.length >= 20) { s.p50 = pct(arr, 0.5); s.p95 = pct(arr, 0.95); s.note = 'n>=20'; }
  else s.note = 'n<20：不出高分位数（BASELINE §3 纪律）';
  return s;
};
async function timed(arr, fn) {
  const t = performance.now();
  try { return await fn(); } finally { arr.push(performance.now() - t); }
}
async function rssOf(pid) {
  try {
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`], { windowsHide: true }, (e, so) => res(e ? '' : String(so).trim())));
    const v = Number(out);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
/** 轮前预清理：销毁上一轮遗留、绑定 15438 的 v7d-pg-* 家族容器（身份匹配：前缀+精确端口），
 *  并等待 17923 内核端口释放（上一轮清理是异步 kill，需等其退出再起下一轮）。 */
async function precleanPort() {
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('docker', ['ps', '-a', '--format', '{{.Names}} {{.Ports}}'], { windowsHide: true }, (e, so) => res(e ? '' : String(so))));
  const victims = out.split('\n').filter((l) => /^v7d-pg-/.test(l) && l.includes('15438')).map((l) => l.split(' ')[0]);
  for (const name of victims) {
    await new Promise((res) => execFile('docker', ['rm', '-f', name], { windowsHide: true }, () => res()));
    console.log(`[preclean] removed leftover ${name}`);
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const listening = await new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', 'if (Get-NetTCPConnection -LocalPort 17923 -State Listen -ErrorAction SilentlyContinue) { "Y" } else { "N" }'], { windowsHide: true }, (e, so) => res(String(so).trim())));
    if (listening === 'N') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('[preclean] WARN: 17923 仍被占用（本轮预期失败并如实记录）');
}

/** 速通检查会话到 ready_for_assessment（每客户一个，收口引用必需）。 */
async function quickInspection(B, projectId, customerId, who, artifactIdsOut) {
  const sess = await B.aCall(who, 'POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: `sess-${rid('d')}`, customerId, title: 'D 尽调',
    roles: [{ roleKey: 'business', kind: 'human' }, { roleKey: 'finance', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'fin', title: '财务', required: true, responsibleRole: 'business', targetRole: 'finance', requiresHumanVerification: false, expectedEvidenceKinds: ['bank_flow'] }],
  });
  assert.equal(sess.status, 200, JSON.stringify(sess.json));
  const sessionId = sess.json.sessionId;
  let snap = (await B.aCall(who, 'GET', `/api/v1/inspections/${sessionId}`)).json;
  await B.aCall(who, 'POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: snap.snapshot.version, acceptedPlanVersion: snap.snapshot.planVersion });
  snap = (await B.aCall(who, 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const item = snap.snapshot.items[0];
  const q = await B.aCall(who, 'POST', `/api/v1/inspections/${sessionId}/questions`, { requestId: rid('q'), itemId: item.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow', question: '口径？' });
  const ans = await B.aCall('fin1', 'POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, { requestId: rid('a'), answer: { text: '财务口径确认' } });
  assert.equal(ans.status, 200, `财务应答: ${JSON.stringify(ans.json)}`);
  assert.equal(q.status, 200, JSON.stringify(q.json));
  await B.aCall(who, 'POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, { requestId: rid('a'), answer: { text: '确认' } });
  const bank = artifactIdsOut.bank;
  const late = await B.aCall(who, 'POST', `/api/v1/inspections/${sessionId}/evidence`, { requestId: rid('ev'), artifactId: bank });
  assert.equal(late.status, 200, JSON.stringify(late.json));
  snap = (await B.aCall(who, 'GET', `/api/v1/inspections/${sessionId}`)).json;
  const end = await B.aCall(who, 'POST', `/api/v1/inspections/${sessionId}/end`, { requestId: rid('end'), expectedVersion: snap.snapshot.version });
  assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));
  return { sessionId };
}

/** D2 速通链（无检查细项/负例）：进件→材料→四域包→批准→激活→两笔并发预占。 */
async function miniChain(B, idx, setup, lat) {
  const who = 'biz1'; const cred = 'cred1';
  const errs = [];
  const safe = async (label, fn) => { try { return await timed(lat[`w_${label}`] ??= [], fn); } catch (e) { errs.push({ label, msg: String(e).slice(0, 200) }); throw e; } };

  const c = await safe('create', () => B.call(who, 'POST', '/api/jw/v2/actions/customers', { requestId: rid('cust'), tenantId: T1, legalEntityRef: `USCC-D2-${idx}-${rid('e')}`, displayName: `D2客户${idx}` }));
  assert.equal(c.status, 200); const customerId = c.json.customerId;
  const art = await safe('artifact', () => B.call(who, 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, { requestId: rid('art'), tenantId: T1, kind: 'purchase_contract', factKey: 'profile', content: { v: idx }, grade: 'source_supported' }));
  assert.equal(art.status, 200);
  const bank = await safe('artifact', () => B.call(who, 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, { requestId: rid('art'), tenantId: T1, kind: 'bank_flow', factKey: 'cashflow', content: { p: 1 }, grade: 'source_supported' }));
  assert.equal(bank.status, 200);

  const insp = await safe('inspection', () => quickInspection(B, setup.projectId, customerId, who, { bank: bank.json.artifactId }));
  const gr = await safe('gate', () => B.aCall('svc1', 'POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, { requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: setup.rulePack }));
  assert.equal(gr.status, 200, JSON.stringify(gr.json));
  const deps = ['policy', 'credit', 'commerce', 'asset'].map((domain) => ({ domain, artifactIds: domain === 'credit' ? [art.json.artifactId] : [], factKeys: [], rulePackVersion: setup.rulePack }));
  const pkg = await safe('package', async () => {
    const created = await B.aCall(who, 'POST', `/api/v2/customers/${customerId}/decision-packages`, {
      requestId: `pkg-${rid('d')}`, tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: insp.sessionId },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    for (const domain of ['policy', 'credit', 'commerce', 'asset']) {
      const run2 = await B.aCall('svc1', 'POST', `/api/v2/customers/${customerId}/analysis-runs/start`, { requestId: rid('run'), tenantId: T1, domain, deps: deps.find((d) => d.domain === domain) });
      assert.equal(run2.status, 200);
      await B.aCall('svc1', 'POST', `/api/v2/analysis-runs/${run2.json.runId}/finish`, { requestId: rid('fin'), tenantId: T1, executionStatus: 'completed' });
      const rr = await B.aCall('svc1', 'POST', `/api/v2/decision-packages/${created.json.packageId}/domain-results`, {
        requestId: rid('dr'), tenantId: T1, domain, analysisRun: { runId: run2.json.runId, rulesetVersion: setup.rulePack },
        opinion: { findingType: 'observation', summary: `${domain}（synthetic）`, domain, authority: 'none' }, deps: deps.find((d) => d.domain === domain),
      });
      assert.equal(rr.status, 200, JSON.stringify(rr.json));
    }
    return created.json.packageId;
  });

  const ass = await safe('assess', () => B.call(cred, 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, { requestId: rid('as'), tenantId: T1, ruleVersion: setup.rulePack, evidenceSnapshot: [{ artifactId: art.json.artifactId }] }));
  assert.equal(ass.status, 200);
  await safe('candidate', () => B.call(cred, 'POST', `/api/jw/v2/actions/assessments/${ass.json.assessmentId}/candidate`, { requestId: rid('cd'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: wan(300), producedBy: 'perf-d2' } }));
  await safe('review', () => B.call(cred, 'POST', `/api/jw/v2/actions/assessments/${ass.json.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 }));
  const prop = await safe('propose', () => B.call(cred, 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, { requestId: rid('pf'), tenantId: T1, assessmentId: ass.json.assessmentId, approvedAmountMinor: wan(300), currency: 'CNY', packageId: pkg }));
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  await safe('approve', () => B.call('app1', 'POST', `/api/jw/v2/actions/facilities/${prop.json.facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: 'd2' }));
  await safe('activate', () => B.call('app1', 'POST', `/api/jw/v2/actions/facilities/${prop.json.facilityId}/activate`, { requestId: rid('ac'), tenantId: T1, rationale: 'd2' }));
  const fr1 = await safe('fr', () => B.call(who, 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, { requestId: rid('fr'), tenantId: T1, facilityId: prop.json.facilityId, productType: 'direct_lease', amountMinor: wan(60), currency: 'CNY', equipmentRefs: ['DEV-1'] }));
  const fr2 = await safe('fr', () => B.call(who, 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, { requestId: rid('fr'), tenantId: T1, facilityId: prop.json.facilityId, productType: 'sale_leaseback', amountMinor: wan(50), currency: 'CNY', equipmentRefs: ['DEV-2'] }));
  await safe('reserve2', () => Promise.all([
    B.call(who, 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 }),
    B.call(cred, 'POST', `/api/jw/v2/actions/financing-requests/${fr2.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 }),
  ]).then(async ([r1, r2]) => { assert.equal(r1.status, 200, JSON.stringify(r1.json)); assert.equal(r2.status, 200, JSON.stringify(r2.json)); }));
  const ws = await safe('read', () => B.call(who, 'GET', `/api/jw/v2/customers/${customerId}/workspace`));
  const fac = ws.json.snapshot.facilities.find((f) => f.facilityId === prop.json.facilityId);
  assert.equal(fac.reservedMinor, wan(110), `D2 客户${idx} 预占合计`);
  return { customerId, errs };
}

/** D3：历史规模 + 压力窗 + 断线重连 + 双重启。 */
async function d3Scenario(B, lat, errs) {
  lat.read ??= []; lat.write ??= []; lat.replay ??= [];
  const setupCustomers = [];
  // 一次 setup：模板/项目/规则激活
  const tpl = await B.aCall('adm1', 'POST', '/api/v1/templates', {
    requestId: `tpl-${rid('d3')}`, name: 'tpl-d3', industry: null,
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await B.aCall('adm1', 'POST', '/api/v1/projects', { requestId: `proj-${rid('d3')}`, templateId: tpl.json.templateId, name: 'proj-d3' });
  const setup = { projectId: proj.json.projectId, rulePack: 'sim-pack-g04-d3' };
  await B.aCall('pol1', 'POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: T1, version: setup.rulePack });

  // 3 客户 × 历史规模（40 件/客，含 8 条取代链）
  for (let i = 0; i < 3; i++) {
    const c = await B.call('biz1', 'POST', '/api/jw/v2/actions/customers', { requestId: rid('cust'), tenantId: T1, legalEntityRef: `USCC-D3-${i}-${rid('e')}`, displayName: `D3客户${i}` });
    assert.equal(c.status, 200);
    const customerId = c.json.customerId;
    let supersedeTarget = null;
    for (let a = 0; a < 40; a++) {
      const r = await B.call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
        requestId: rid('art'), tenantId: T1, kind: a % 5 === 0 ? 'litigation_record' : 'customer_profile', factKey: `f${a % 7}`,
        content: { seq: a, note: 'x'.repeat(200) }, grade: 'unverified', ...(supersedeTarget && a % 5 === 0 ? { supersedes: supersedeTarget } : {}),
      });
      if (r.status !== 200) { errs.push({ label: 'seed-artifact', msg: JSON.stringify(r.json).slice(0, 150) }); break; }
      if (a % 5 === 0) supersedeTarget = r.json.artifactId;
    }
    setupCustomers.push({ customerId });
  }

  // 压力窗 60s：8 读 + 4 写
  const deadline = Date.now() + 60_000;
  const rssSamples = [];
  const stopRss = setInterval(() => { rssOf(B.api.pid).then((v) => v && rssSamples.push({ at: Date.now(), kernelRss: v, edgeRss: process.memoryUsage().rss })); }, 3000);
  // 数据库段指标（BASELINE §3）：pg_stat_database 事务/元组增量=查询负载近似（未装 pg_stat_statements，
  // 以 xact_commit/tup_* 差值替代查询计数，标 synthetic-approx）；锁等待=pg_stat_activity 周期采样
  const pgctlMod = await import('../../D/harness/pgctl.mjs');
  const dbSnap = async () => {
    const r = await pgctlMod.psql(B.pg.name, B.dbName, `SELECT xact_commit, tup_inserted, tup_fetched, deadlocks FROM pg_stat_database WHERE datname = current_database()`, 'v7next');
    if (r.err) throw new Error(r.err);
    const parts = r.out.trim().split('|').map((x) => Number(x.trim()));
    return { xact_commit: parts[0], tup_inserted: parts[1], tup_fetched: parts[2], deadlocks: parts[3] };
  };
  const dbBefore = await dbSnap();
  const lockSamples = [];
  const stopLocks = setInterval(() => {
    pgctlMod.psql(B.pg.name, B.dbName, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'`, 'v7next').then((r) => {
      if (!r.err) lockSamples.push({ at: Date.now(), lockWaiting: Number(r.out.trim()) });
    }).catch(() => { });
  }, 3000);
  const workers = [];
  for (let r = 0; r < 8; r++) {
    const cust = setupCustomers[r % 3].customerId;
    workers.push((async () => {
      while (Date.now() < deadline) {
        try { await timed(lat.read, () => B.call(r % 2 ? 'biz1' : 'jw1', 'GET', `/api/jw/v2/customers/${cust}/workspace`)); } catch (e) { errs.push({ label: 'read', msg: String(e).slice(0, 120) }); }
        await sleep(250);
      }
    })());
  }
  for (let w = 0; w < 4; w++) {
    const cust = setupCustomers[w % 3].customerId;
    workers.push((async () => {
      while (Date.now() < deadline) {
        try {
          await timed(lat.write, () => B.call('biz1', 'POST', `/api/jw/v2/actions/customers/${cust}/artifacts`, { requestId: rid('art'), tenantId: T1, kind: 'customer_profile', factKey: 'stress', content: { w, t: Date.now() }, grade: 'unverified' }));
        } catch (e) { errs.push({ label: 'write', msg: String(e).slice(0, 120) }); }
        await sleep(400);
      }
    })());
  }
  await Promise.all(workers);
  clearInterval(stopRss);
  clearInterval(stopLocks);
  const dbAfter = await dbSnap();
  const dbSegment = {
    method: 'pg_stat_database deltas + pg_stat_activity lock-wait sampling（synthetic-approx，未装 pg_stat_statements）',
    xactCommitDelta: dbAfter.xact_commit - dbBefore.xact_commit,
    tupInsertedDelta: dbAfter.tup_inserted - dbBefore.tup_inserted,
    tupFetchedDelta: dbAfter.tup_fetched - dbBefore.tup_fetched,
    deadlocks: dbAfter.deadlocks,
    lockWaitSamples: lockSamples,
    lockWaitPeak: lockSamples.length ? Math.max(...lockSamples.map((x) => x.lockWaiting)) : null,
  };

  // 重复提交 ×20（幂等）与异载荷 ×5
  const cust0 = setupCustomers[0].customerId;
  const repRid = rid('rep');
  await B.call('biz1', 'POST', `/api/jw/v2/actions/customers/${cust0}/artifacts`, { requestId: repRid, tenantId: T1, kind: 'customer_profile', factKey: 'replay', content: { v: 1 }, grade: 'unverified' });
  lat.replay = lat.replay || [];
  for (let i = 0; i < 20; i++) {
    const r = await timed(lat.replay, () => B.call('biz1', 'POST', `/api/jw/v2/actions/customers/${cust0}/artifacts`, { requestId: repRid, tenantId: T1, kind: 'customer_profile', factKey: 'replay', content: { v: 1 }, grade: 'unverified' }));
    if (!(r.json && r.json.replayed === true)) errs.push({ label: 'replay-not-idempotent', msg: JSON.stringify(r.json).slice(0, 120) });
  }

  // 慢请求注入（BASELINE §2 D3 冻结方式：独立反代探针进程注入 120ms，不改 Edge/src），逐轮记录采用方式
  const slow = await (async () => {
    const http = await import('node:http');
    const proxy = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        setTimeout(() => {
          const up = http.request(`${B.base}${req.url}`, { method: req.method, headers: { ...req.headers, host: '127.0.0.1' } }, (ur) => {
            res.writeHead(ur.statusCode, ur.headers);
            ur.pipe(res);
          });
          up.on('error', () => { try { res.writeHead(502); res.end(); } catch { } });
          if (body) up.write(body);
          up.end();
        }, 120);
      });
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    return proxy;
  })();
  lat.slowRead = [];
  try {
    const slowPort = slow.address().port;
    const slowUrl = `http://127.0.0.1:${slowPort}/api/jw/v2/customers/${cust0}/workspace`;
    const sDeadline = Date.now() + 15_000;
    while (Date.now() < sDeadline) {
      await timed(lat.slowRead, async () => {
        const r = await fetch(slowUrl, { headers: { 'x-jw-session': B.sessions.biz1.sessionId } });
        await r.json();
      });
      await sleep(150);
    }
  } finally { await new Promise((r) => slow.close(r)); }

  // SSE 断线 → Last-Event-ID 续传（3 次）；cursor 帧携带 eventCursor（data 字段），作为续传游标
  const sseHeaders = { 'x-jw-session': B.sessions.biz1.sessionId, accept: 'text/event-stream' };
  let lastId = null; let resumed = 0; const cursorSeen = [];
  for (let conn = 0; conn < 3; conn++) {
    const h = { ...sseHeaders, ...(lastId ? { 'last-event-id': lastId } : {}) };
    const frames = await readSse(B.base, `/api/jw/v2/customers/${cust0}/events`, h, { timeoutMs: 2500 });
    const cursor = frames.find((f) => f.event === 'cursor');
    const biz = frames.filter((f) => f.event === 'business');
    if (biz.length > 0) lastId = biz[biz.length - 1].id;
    else if (cursor) {
      try { lastId = JSON.parse(cursor.data).eventCursor ?? lastId; } catch { }
      cursorSeen.push(lastId);
    }
    if (conn > 0 && !frames.some((f) => f.event === 'resync')) resumed += 1;
    await sleep(300);
  }
  return { customers: setupCustomers.map((c) => c.customerId), rssSamples, dbSegment, sse: { reconnects: 3, resumedWithoutResync: resumed, lastId, cursorSeen } };
}

/** D3 重启恢复计时。 */
async function restartCycle(B) {
  const tKill = performance.now();
  B.killKernel();
  let downAt = null;
  const dl1 = Date.now() + 25000;
  while (Date.now() < dl1) {
    try { const r = await (await fetch(`${B.base}/healthz/ready`)).json(); if (r.ok === false) { downAt = performance.now(); break; } } catch { }
    await sleep(400);
  }
  await B.restartKernel();
  const dl2 = Date.now() + 30000;
  let upAt = null;
  while (Date.now() < dl2) {
    try { const r = await (await fetch(`${B.base}/healthz/ready`)).json(); if (r.ok === true) { upAt = performance.now(); break; } } catch { }
    await sleep(500);
  }
  return { detectDownMs: downAt ? Math.round(downAt - tKill) : null, recoverOkMs: upAt ? Math.round(upAt - tKill) : null };
}

async function main() {
  const summary = { at: new Date().toISOString(), head: '1ec0ee4 (见 baseline-HEAD.txt)', tiers: {} };
  for (const tier of TIERS) {
    summary.tiers[tier] = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const label = `${tier}-r${round}`;
      const rec = { tier, round, startedAt: new Date().toISOString() };
      let B = null;
      try {
        await precleanPort();
        const tBoot = performance.now();
        B = await bootG04({ runName: `perf-${tier.toLowerCase()}-r${round}` });
        rec.bootMs = Math.round(performance.now() - tBoot);
        const lat = {};
        if (tier === 'D1') {
          const t = {};
          const meta = await runFullChain(B, assert, { timers: t, notes: [] });
          rec.chainTimersMs = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
          rec.totalMs = Object.values(t).reduce((a, b) => a + b, 0).toFixed ? Math.round(Object.values(t).reduce((a, b) => a + b, 0)) : null;
          rec.meta = { customerId: meta.customerId, facilityId: meta.facilityId, sseFrames: meta.sseFrames };
        } else if (tier === 'D2') {
          const tpl = await B.aCall('adm1', 'POST', '/api/v1/templates', {
            requestId: `tpl-${rid('d2')}`, name: 'tpl-d2', industry: null,
            roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
            goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
          });
          assert.equal(tpl.status, 200);
          const proj = await B.aCall('adm1', 'POST', '/api/v1/projects', { requestId: `proj-${rid('d2')}`, templateId: tpl.json.templateId, name: 'proj-d2' });
          assert.equal(proj.status, 200);
          const setup = { projectId: proj.json.projectId, rulePack: 'sim-pack-g04-d2' };
          const act = await B.aCall('pol1', 'POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: T1, version: setup.rulePack });
          assert.equal(act.status, 200, JSON.stringify(act.json));
          const tPar = performance.now();
          const results = await Promise.all([miniChain(B, 1, setup, lat), miniChain(B, 2, setup, lat), miniChain(B, 3, setup, lat)]);
          rec.parallel3CustomersMs = Math.round(performance.now() - tPar);
          rec.customers = results.map((r) => r.customerId);
        } else if (tier === 'D3') {
          const tSeed = performance.now();
          const d3 = await d3Scenario(B, lat, rec.errors ??= []);
          rec.seedAndStressMs = Math.round(performance.now() - tSeed);
          rec.sse = d3.sse;
          rec.dbSegment = d3.dbSegment;
          rec.slowRequestMethod = 'standalone-proxy-120ms（BASELINE §2 D3 冻结首选方式）';
          rec.rssPeakKernel = d3.rssSamples.length ? Math.max(...d3.rssSamples.map((s) => s.kernelRss)) : null;
          rec.rssPeakEdge = d3.rssSamples.length ? Math.max(...d3.rssSamples.map((s) => s.edgeRss)) : null;
          rec.restart1 = await restartCycle(B);
          rec.restart2 = await restartCycle(B);
          const wsFinal = await B.call('biz1', 'GET', `/api/jw/v2/customers/${d3.customers[0]}/workspace`);
          assert.equal(wsFinal.status, 200, 'D3 恢复后 workspace 可用');
        }
        rec.latencies = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, summarize(v)]));
        rec.errors = rec.errors ?? [];
        rec.result = rec.errors.length === 0 ? 'PASS' : 'PASS_WITH_ERRORS';
        rec.finishedAt = new Date().toISOString();
      } catch (e) {
        rec.result = 'FAIL';
        rec.error = String(e && e.stack ? e.stack : e).slice(0, 2000);
        rec.finishedAt = new Date().toISOString();
      } finally {
        if (B) { try { await B.cleanup(); } catch { } }
      }
      writeFileSync(path.join(OUT_DIR, `${label}.json`), JSON.stringify(rec, null, 2));
      summary.tiers[tier].push({ round, result: rec.result, bootMs: rec.bootMs, totalMs: rec.totalMs, parallel3CustomersMs: rec.parallel3CustomersMs, errors: (rec.errors ?? []).length });
      console.log(`[${label}] ${rec.result} boot=${rec.bootMs}ms`);
      await sleep(800);
    }
  }
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`EVIDENCE_DIR=${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
