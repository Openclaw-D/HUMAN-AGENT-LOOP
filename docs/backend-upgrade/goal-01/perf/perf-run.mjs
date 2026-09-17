// goal-01 性能基线/复测工具（Back/A 内核；专用容器 jw-goal01-pg@15446，pg_stat_statements 计查询数）。
// 用法：node perf-run.mjs --label before|after --out <results.json>
// 流程：重建 goal01_perf 库 → 起内核（合成开发矩阵，与测试同参）→ 种子数据（金额受客户级上限约束）→
//       顺序写相位 → 读相位 → 受控屏障并发相位（release-promise 屏障 + 锁等待采样）→ pg_stat_statements 差值 → JSON 报告。
// 边界：只写本任务自有容器与 docs/backend-upgrade/goal-01/；不触碰 jw-cc-kernel-pg 等共享资源。
import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'Back', 'A');
// pg 复用 Back/A 的锁版依赖（本目录无独立 node_modules）
const pg = (await import(pathToFileURL(path.join(A_ROOT, 'node_modules', 'pg', 'lib', 'index.js')))).default;

// ---- 参数 ----
const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const LABEL = argOf('label', 'before');
const OUT = argOf('out', path.join(__dirname, `results-${LABEL}.json`));
const PERF_PORT_HTTP = 17930; // 本工具专用 HTTP 端口（登记于 HANDOFF；避让 48080/48100+ 测试段/17919/17921）
const ADMIN = 'postgres://goal01:goal01-local@127.0.0.1:15446/postgres';
const DB_NAME = 'goal01_perf';
const DB_URL = `postgres://goal01:goal01-local@127.0.0.1:15446/${DB_NAME}`;

// ---- 负载参数（before/after 完全一致）----
const N_CUSTOMERS = 4;          // 常规客户（各 1 设施）
const N_FRS_EACH = 60;          // 每常规客户 submitted 申请数
const N_FACILITIES_BIG = 20;    // 大客户已激活设施数（读相位 exposure 观测点）
const BIG_FAC_AMOUNT = 40_000_000;     // 大客户单设施 40 万分（20×40万=800万 ≤ 客户级 1000 万上限）
const PROPOSE_N = 40;           // 审批相位 propose→approve→activate 次数（大客户，单笔 1 万分）
const PROPOSE_AMOUNT = 1_000_000;
const FR_AMOUNT = 1_000_00;     // 每申请 1000 元
const CYCLES = 60;              // 写相位：reserve→commit→disburse→settle 完整链次数（用客户0的申请）
const READ_N = 100;             // 读相位每端点次数
const CONC_DISTINCT = 24;       // 并发相位：不同申请共同占同一设施（全部应成功）
const CONC_SAME_FR = 12;        // 并发相位：同申请异 requestId（恰一成功）；同 requestId 重放（全 200 单效应）

const CAP = 1_000_000_000;
const TENANT = 't1';
const PRINCIPAL_SPEC = [
  'tok-biz1=biz1:human:business:all:t1',
  'tok-cred1=cred1:human:credit:all:t1',
  'tok-app1=app1:human:approver:all:t1',
].join(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = (p) => `${p}-${randomBytes(6).toString('hex')}`;

function client(base, token) {
  return async (method, p, body) => {
    const t0 = performance.now();
    const res = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', 'x-principal-credential': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, json, ms: performance.now() - t0 };
  };
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return Math.round(s[i] * 1000) / 1000;
}
function stats(arr) {
  return { n: arr.length,
    mean: arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 1000) / 1000 : null,
    p50: pct(arr, 50), p90: pct(arr, 90), p95: pct(arr, 95), p99: pct(arr, 99), max: pct(arr, 100) };
}

// ---- DB 生命周期与统计 ----
async function recreateDb() {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  const ext = new pg.Pool({ connectionString: DB_URL });
  await ext.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
  await ext.end();
  await admin.end();
}
async function resetStats(db) {
  await db.query('SELECT pg_stat_statements_reset()');
  await db.query('SELECT pg_stat_reset()');
}
async function statsSnapshot(db) {
  const stmts = await db.query(`SELECT query, calls, total_exec_time FROM pg_stat_statements`);
  const dbst = await db.query(
    `SELECT xact_commit, xact_rollback, deadlocks, blks_hit, blks_read FROM pg_stat_database WHERE datname=$1`, [DB_NAME]);
  return { stmts: stmts.rows, db: dbst.rows[0] };
}
function diffStats(before, after) {
  const map = new Map(before.stmts.map((r) => [r.query, r]));
  const out = [];
  for (const r of after.stmts) {
    const b = map.get(r.query);
    const calls = Number(r.calls) - (b ? Number(b.calls) : 0);
    const total = Number(r.total_exec_time) - (b ? Number(b.total_exec_time) : 0);
    if (calls > 0) out.push({ query: r.query.replace(/\s+/g, ' ').slice(0, 140), calls, totalMs: Math.round(total * 1000) / 1000, avgMs: Math.round((total / calls) * 1000) / 1000 });
  }
  out.sort((a, b) => b.totalMs - a.totalMs);
  const b = before.db, a = after.db;
  return {
    topByTime: out.slice(0, 25),
    topByCalls: [...out].sort((x, y) => y.calls - x.calls).slice(0, 25),
    totalQueries: out.reduce((s, x) => s + x.calls, 0),
    xactCommit: Number(a.xact_commit) - Number(b.xact_commit),
    xactRollback: Number(a.xact_rollback) - Number(b.xact_rollback),
    deadlocks: Number(a.deadlocks) - Number(b.deadlocks),
    blksRead: Number(a.blks_read) - Number(b.blks_read),
  };
}
// 锁等待采样（10ms；并发相位期间）
async function sampleLockWaits(pool, stopFlag, sink) {
  while (!stopFlag.stop) {
    try {
      const r = await pool.query(`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'`, [DB_NAME]);
      sink.samples += 1;
      const w = Number(r.rows[0].waiting);
      sink.totalWaiting += w;
      if (w > sink.maxWaiting) sink.maxWaiting = w;
    } catch { /* 采样失败不计 */ }
    await sleep(10);
  }
}
function lockSummary(sink, wallMs) {
  return { intervalMs: 10, samples: sink.samples,
    avgWaiting: sink.samples ? Math.round((sink.totalWaiting / sink.samples) * 1000) / 1000 : 0,
    maxWaiting: sink.maxWaiting,
    waitSampleMs: sink.totalWaiting * 10,
    approxWaitRatio: sink.samples ? Math.round((Math.min(1, (sink.totalWaiting * 10) / wallMs)) * 10000) / 10000 : 0 };
}

// ---- 内核进程 ----
async function startKernel() {
  const args = ['src/index.ts', '--port', String(PERF_PORT_HTTP), '--db', DB_URL,
    '--principal-tokens', PRINCIPAL_SPEC, '--lease-seconds', '90',
    '--credit-matrix', 'matrix-dev-synthetic-1', '--credit-concentration', 'conc-dev-synthetic-1', '--allow-legacy-basis'];
  const child = spawn('node', args, { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const base = `http://127.0.0.1:${PERF_PORT_HTTP}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.status === 200) return { child, base, logs };
    } catch { /* 未起 */ }
    await sleep(250);
  }
  child.kill('SIGKILL');
  throw new Error(`kernel 启动失败：\n${logs.join('')}`);
}

async function main() {
  const gitCommit = execSync('git rev-parse --short HEAD', { cwd: A_ROOT, encoding: 'utf8' }).trim();
  const nodeVersion = process.version;
  await recreateDb();
  const kernel = await startKernel();
  const biz = client(kernel.base, 'tok-biz1');
  const cred = client(kernel.base, 'tok-cred1');
  const app = client(kernel.base, 'tok-app1');
  const db = new pg.Pool({ connectionString: DB_URL });
  const report = { label: LABEL, at: new Date().toISOString(), gitCommit, nodeVersion,
    httpPort: PERF_PORT_HTTP, dbUrl: DB_URL.replace(/:[^:@/]+@/, ':***@'),
    kernelArgs: '合成开发矩阵 matrix-dev-synthetic-1 / conc-dev-synthetic-1 / --allow-legacy-basis',
    load: { N_CUSTOMERS, N_FRS_EACH, N_FACILITIES_BIG, BIG_FAC_AMOUNT, PROPOSE_N, PROPOSE_AMOUNT, FR_AMOUNT, CYCLES, READ_N, CONC_DISTINCT, CONC_SAME_FR },
    phases: {}, errors: [] };
  const must = async (r, what) => {
    if (r.status !== 200) {
      console.error(`[perf][must-fail] ${what} → ${r.status} ${JSON.stringify(r.json)}`);
      report.errors.push({ what, status: r.status, json: r.json });
      throw new Error(`${what} → ${r.status} ${JSON.stringify(r.json)}`);
    }
    return r.json;
  };

  try {
    const pgv = await db.query('SHOW server_version');
    report.pgVersion = pgv.rows[0].server_version;

    // ============ 种子（不计入测量） ============
    await db.query(
      `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
         ('matrix-dev-synthetic-1','approver','facility.approve',true,$1),
         ('matrix-dev-synthetic-1','approver','facility.activate',true,$1),
         ('matrix-dev-synthetic-1','approver','facility.suspend',true,NULL),
         ('matrix-dev-synthetic-1','approver','facility.reduce',true,NULL),
         ('matrix-dev-synthetic-1','business','fr.confirm-external',true,$1)
       ON CONFLICT DO NOTHING`, [CAP]);
    const proposeOnly = async (cid, amountMinor) => {
      const artRes = await biz('POST', `/api/v2/customers/${cid}/artifacts`,
        { requestId: newId('r'), tenantId: TENANT, kind: 'customer_profile', factKey: `profile-${cid}-${newId('k')}`, content: { rev: 1 }, grade: 'source_supported' });
      const art = await must(artRes, 'artifact');
      const ass = await must(await cred('POST', `/api/v2/customers/${cid}/assessments`,
        { requestId: newId('r'), tenantId: TENANT, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.artifactId }] }), 'assessment');
      await must(await cred('POST', `/api/v2/assessments/${ass.assessmentId}/candidate`,
        { requestId: newId('r'), tenantId: TENANT, candidate: { tendency: 'do', supportableAmountMinor: amountMinor, currency: 'CNY', rationale: '', producedBy: 'perf', conditions: [], warnings: [] } }), 'candidate');
      await must(await cred('POST', `/api/v2/assessments/${ass.assessmentId}/submit-review`, { requestId: newId('r'), tenantId: TENANT }), 'submit-review');
      const prop = await must(await cred('POST', `/api/v2/customers/${cid}/facilities`,
        { requestId: newId('r'), tenantId: TENANT, assessmentId: ass.assessmentId, approvedAmountMinor: amountMinor, currency: 'CNY' }), 'propose');
      return prop.facilityId;
    };
    const approveActivate = async (facilityId) => {
      await must(await app('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: TENANT, rationale: 'perf' }), 'approve');
      await must(await app('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: newId('r'), tenantId: TENANT, rationale: 'perf' }), 'activate');
    };
    const seedFacility = async (cid, amountMinor) => {
      const fid = await proposeOnly(cid, amountMinor);
      await approveActivate(fid);
      return fid;
    };
    const customers = [];
    for (let i = 0; i < N_CUSTOMERS; i++) {
      const c = await must(await biz('POST', '/api/v2/customers',
        { requestId: newId('r'), tenantId: TENANT, legalEntityRef: `LE-PERF-${LABEL}-${i}`, displayName: `perf-c-${i}` }), 'createCustomer');
      customers.push(c.customerId);
      await seedFacility(c.customerId, CAP); // 常规客户单设施 = 满额（内含候选→提案→批准→激活）
    }
    const big = await must(await biz('POST', '/api/v2/customers',
      { requestId: newId('r'), tenantId: TENANT, legalEntityRef: `LE-PERF-BIG-${LABEL}`, displayName: 'perf-big' }), 'createCustomer-big');
    const bigFacilities = [];
    for (let f = 0; f < N_FACILITIES_BIG; f++) bigFacilities.push(await seedFacility(big.customerId, BIG_FAC_AMOUNT));
    const proposedIds = [];
    for (let p = 0; p < PROPOSE_N; p++) proposedIds.push(await proposeOnly(big.customerId, PROPOSE_AMOUNT));
    for (const cid of customers) {
      const facilityId = (await must(await cred('GET', `/api/v2/customers/${cid}/exposure`), 'exposure')).facilities[0].facilityId;
      for (let j = 0; j < N_FRS_EACH; j++) {
        await must(await biz('POST', `/api/v2/customers/${cid}/financing-requests`,
          { requestId: newId('r'), tenantId: TENANT, facilityId, productType: 'direct_lease', amountMinor: FR_AMOUNT, currency: 'CNY' }), 'fr-seed');
      }
    }
    // FR 分配：按客户分组；客户0 前段给写相位链，客户1 前段给并发相位，其余给并行相位
    const frRows = await db.query(`SELECT fr_id, customer_id, facility_id FROM financing_requests WHERE status='submitted' ORDER BY created_at`);
    const byCustomer = new Map();
    for (const r of frRows.rows) { if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []); byCustomer.get(r.customer_id).push(r); }
    const c0 = byCustomer.get(customers[0]), c1 = byCustomer.get(customers[1]);
    const chainFrs = c0.slice(0, CYCLES);
    const concFrs = c1.slice(0, CONC_DISTINCT);            // C1：同设施不同申请
    const sameFrA = c1[CONC_DISTINCT];                      // C2a：同 requestId 重放
    const sameFrB = c1[CONC_DISTINCT + 1];                  // C2b：同申请异 requestId
    const parallelFrs = [
      ...byCustomer.get(customers[2]).slice(0, 12),
      ...byCustomer.get(customers[3]).slice(0, 12),
      ...byCustomer.get(customers[2]).slice(12, 24),
      ...byCustomer.get(customers[3]).slice(12, 24),
    ];
    const bigFacilityId = bigFacilities[0];

    // ============ 测量 ============
    await resetStats(db);

    // W1：逐笔用信链 ×CYCLES
    {
      const lat = { reserve: [], commit: [], disburse: [], settle: [] };
      let errs = 0;
      const t0 = performance.now();
      for (const fr of chainFrs) {
        const p = (cmd) => `/api/v2/financing-requests/${fr.fr_id}/${cmd}`;
        for (const cmd of ['reserve', 'commit', 'disburse', 'settle']) {
          const r = await biz('POST', p(cmd), { requestId: newId('r'), tenantId: TENANT });
          if (r.status !== 200) { errs += 1; report.errors.push({ phase: 'W1', cmd, fr: fr.fr_id, status: r.status, json: r.json }); }
          else lat[cmd].push(r.ms);
        }
      }
      report.phases.w1_use_chain = { chains: chainFrs.length, wallMs: Math.round(performance.now() - t0),
        latencies: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, stats(v)])), errors: errs };
    }

    // W2：审批链 approve→activate ×PROPOSE_N
    {
      const lat = { approve: [], activate: [] };
      let errs = 0;
      for (const fid of proposedIds) {
        const r1 = await app('POST', `/api/v2/facilities/${fid}/approve`, { requestId: newId('r'), tenantId: TENANT, rationale: 'perf' });
        if (r1.status !== 200) { errs += 1; report.errors.push({ phase: 'W2', cmd: 'approve', status: r1.status, json: r1.json }); } else lat.approve.push(r1.ms);
        const r2 = await app('POST', `/api/v2/facilities/${fid}/activate`, { requestId: newId('r'), tenantId: TENANT, rationale: 'perf' });
        if (r2.status !== 200) { errs += 1; report.errors.push({ phase: 'W2', cmd: 'activate', status: r2.status, json: r2.json }); } else lat.activate.push(r2.ms);
      }
      report.phases.w2_approve_activate = { latencies: { approve: stats(lat.approve), activate: stats(lat.activate) }, errors: errs };
    }

    const wEnd = await statsSnapshot(db);

    // R：读端点 ×READ_N
    {
      const targets = [
        ['customer_get', () => cred('GET', `/api/v2/customers/${customers[0]}`)],
        ['exposure_normal_1fac', () => cred('GET', `/api/v2/customers/${customers[0]}/exposure`)],
        ['exposure_big_20fac', () => cred('GET', `/api/v2/customers/${big.customerId}/exposure`)],
        ['artifacts_list_big', () => cred('GET', `/api/v2/customers/${big.customerId}/artifacts`)],
        ['facility_get', () => cred('GET', `/api/v2/facilities/${bigFacilityId}`)],
        ['use_readiness', () => cred('GET', `/api/v2/financing-requests/${byCustomer.get(customers[2])[0].fr_id}/use-readiness`)],
        ['decision_status', () => cred('GET', `/api/v2/customers/${customers[0]}/decision-status`)],
      ];
      const reads = {};
      for (const [name, call] of targets) {
        const lat = []; let errs = 0;
        for (let i = 0; i < READ_N; i++) {
          const r = await call();
          if (r.status !== 200) { errs += 1; if (errs <= 2) report.errors.push({ phase: 'R', name, status: r.status, json: r.json }); } else lat.push(r.ms);
        }
        reads[name] = { ...stats(lat), errors: errs };
      }
      report.phases.r_reads = reads;
    }
    report.phases.db_writes_total = diffStats({ stmts: [], db: { xact_commit: 0, xact_rollback: 0, deadlocks: 0, blks_hit: 0, blks_read: 0 } }, wEnd);

    // C1：受控屏障——CONC_DISTINCT 并发不同申请共同占同一设施（应全部成功，桶守恒）
    {
      const stopFlag = { stop: false };
      const lockSink = { samples: 0, totalWaiting: 0, maxWaiting: 0 };
      const sampler = sampleLockWaits(db, stopFlag, lockSink);
      const before = await statsSnapshot(db);
      let release;
      const gate = new Promise((res) => { release = res; });
      const lat = [];
      const t0 = performance.now();
      const ps = concFrs.map(async (fr) => {
        await gate;
        const r = await biz('POST', `/api/v2/financing-requests/${fr.fr_id}/reserve`, { requestId: newId('r'), tenantId: TENANT });
        lat.push(r.ms);
        return r.status;
      });
      release();
      const outcomes = await Promise.all(ps);
      const wallMs = performance.now() - t0;
      stopFlag.stop = true;
      await sampler;
      const after = await statsSnapshot(db);
      report.phases.c1_barrier_distinct_fr = { workers: CONC_DISTINCT, wallMs: Math.round(wallMs * 1000) / 1000,
        outcomes: outcomes.reduce((m, s) => { m[String(s)] = (m[s] ?? 0) + 1; return m; }, {}),
        reserveLatency: stats(lat), lockSampling: lockSummary(lockSink, wallMs), db: diffStats(before, after) };
    }

    // C2a：受控屏障——同申请同 requestId 并发重放（应全 200，业务效果恰一）
    {
      const stopFlag = { stop: false };
      const lockSink = { samples: 0, totalWaiting: 0, maxWaiting: 0 };
      const sampler = sampleLockWaits(db, stopFlag, lockSink);
      const before = await statsSnapshot(db);
      let release;
      const gate = new Promise((res) => { release = res; });
      const lat = [];
      const t0 = performance.now();
      const ps = Array.from({ length: CONC_SAME_FR }, () => (async () => {
        await gate;
        const r = await biz('POST', `/api/v2/financing-requests/${sameFrA.fr_id}/reserve`, { requestId: 'perf-conc-same-request-id', tenantId: TENANT });
        lat.push(r.ms);
        return r.status;
      })());
      release();
      const outcomes = await Promise.all(ps);
      const wallMs = performance.now() - t0;
      stopFlag.stop = true;
      await sampler;
      const after = await statsSnapshot(db);
      const entries = await db.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [sameFrA.fr_id]);
      report.phases.c2a_barrier_same_request_id = { workers: CONC_SAME_FR, wallMs: Math.round(wallMs * 1000) / 1000,
        outcomes: outcomes.reduce((m, s) => { m[String(s)] = (m[s] ?? 0) + 1; return m; }, {}),
        reserveEntries: entries.rows[0].n, reserveLatency: stats(lat), lockSampling: lockSummary(lockSink, wallMs), db: diffStats(before, after) };
    }

    // C2b：受控屏障——同申请异 requestId 并发（恰一 200，余 409 NOT_READY）
    {
      const stopFlag = { stop: false };
      const lockSink = { samples: 0, totalWaiting: 0, maxWaiting: 0 };
      const sampler = sampleLockWaits(db, stopFlag, lockSink);
      const before = await statsSnapshot(db);
      let release;
      const gate = new Promise((res) => { release = res; });
      const lat = [];
      const t0 = performance.now();
      const ps = Array.from({ length: CONC_SAME_FR }, (_v, i) => (async () => {
        await gate;
        const r = await biz('POST', `/api/v2/financing-requests/${sameFrB.fr_id}/reserve`, { requestId: `perf-conc-samefr-${i}`, tenantId: TENANT });
        lat.push(r.ms);
        return r.status;
      })());
      release();
      const outcomes = await Promise.all(ps);
      const wallMs = performance.now() - t0;
      stopFlag.stop = true;
      await sampler;
      const after = await statsSnapshot(db);
      const entries = await db.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [sameFrB.fr_id]);
      report.phases.c2b_barrier_same_fr_distinct_req = { workers: CONC_SAME_FR, wallMs: Math.round(wallMs * 1000) / 1000,
        outcomes: outcomes.reduce((m, s) => { m[String(s)] = (m[s] ?? 0) + 1; return m; }, {}),
        reserveEntries: entries.rows[0].n, maxLatencyMs: stats(lat).max, lockSampling: lockSummary(lockSink, wallMs), db: diffStats(before, after) };
    }

    // C3：多客户并行（48 链 reserve→commit→disburse，分散 4 客户/4 设施）
    {
      const before = await statsSnapshot(db);
      const t0 = performance.now();
      const outcomes = await Promise.all(parallelFrs.map(async (fr) => {
        for (const cmd of ['reserve', 'commit', 'disburse']) {
          const r = await biz('POST', `/api/v2/financing-requests/${fr.fr_id}/${cmd}`, { requestId: newId('r'), tenantId: TENANT });
          if (r.status !== 200) return `${cmd}:${r.status}`;
        }
        return '200';
      }));
      const wallMs = performance.now() - t0;
      const after = await statsSnapshot(db);
      report.phases.c3_parallel_customers = { chains: parallelFrs.length, wallMs: Math.round(wallMs * 1000) / 1000,
        outcomes: outcomes.reduce((m, s) => { m[String(s)] = (m[s] ?? 0) + 1; return m; }, {}), db: diffStats(before, after) };
    }

    // 汇总桶守恒断言（并发相位后统一校验客户1设施账目）
    {
      const facId = concFrs[0].facility_id;
      const v = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN entry_type='reserve' THEN amount_minor WHEN entry_type IN ('reserve_release','reserve_expire','reserve_commit') THEN -amount_minor ELSE 0 END),0) AS reserved,
           count(*)::int AS entries
         FROM exposure_entries WHERE facility_id=$1`, [facId]);
      report.phases.conservation_customer1 = { facilityId: facId, reservedMinor: Number(v.rows[0].reserved), entries: v.rows[0].entries };
    }
  } finally {
    kernel.child.kill('SIGTERM');
    await sleep(300);
    if (!kernel.child.killed) kernel.child.kill('SIGKILL');
    report.kernelLogTail = kernel.logs.join('').split('\n').slice(-15).join('\n');
    try { await db.end(); } catch { /* 已断 */ }
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`[perf] ${LABEL} 报告已写：${OUT}`);
  const p = report.phases;
  if (p.w1_use_chain) console.log(`[perf] w1 reserve p50/p95=${p.w1_use_chain.latencies.reserve.p50}/${p.w1_use_chain.latencies.reserve.p95}ms settle p95=${p.w1_use_chain.latencies.settle.p95}ms errors=${p.w1_use_chain.errors}`);
  if (p.r_reads) console.log(`[perf] exposure_big p50/p95=${p.r_reads.exposure_big_20fac.p50}/${p.r_reads.exposure_big_20fac.p95}ms readiness p95=${p.r_reads.use_readiness.p95}ms`);
  if (p.c1_barrier_distinct_fr) console.log(`[perf] c1 wall=${p.c1_barrier_distinct_fr.wallMs}ms outcomes=${JSON.stringify(p.c1_barrier_distinct_fr.outcomes)} maxLockWaiters=${p.c1_barrier_distinct_fr.lockSampling.maxWaiting}`);
  if (p.c2a_barrier_same_request_id) console.log(`[perf] c2a wall=${p.c2a_barrier_same_request_id.wallMs}ms outcomes=${JSON.stringify(p.c2a_barrier_same_request_id.outcomes)} entries=${p.c2a_barrier_same_request_id.reserveEntries}`);
  if (p.c2b_barrier_same_fr_distinct_req) console.log(`[perf] c2b wall=${p.c2b_barrier_same_fr_distinct_req.wallMs}ms outcomes=${JSON.stringify(p.c2b_barrier_same_fr_distinct_req.outcomes)} entries=${p.c2b_barrier_same_fr_distinct_req.reserveEntries}`);
  if (p.c3_parallel_customers) console.log(`[perf] c3 wall=${p.c3_parallel_customers.wallMs}ms outcomes=${JSON.stringify(p.c3_parallel_customers.outcomes)}`);
  if (report.errors.length > 0) console.log(`[perf] 非预期错误 ${report.errors.length} 条（详见报告 errors）`);
}

main().catch((e) => { console.error('[perf] 失败：', e); process.exit(1); });
