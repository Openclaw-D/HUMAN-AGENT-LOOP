// goal-01 补充测量：getCustomerExposure 每请求 DB 查询数（before/after 同脚本对照）。
// 用法：node supp-query-count.mjs --root <A目录> --out <json路径>
// 流程：独立测试库 → 起内核（1 客户 × 20 已激活设施）→ pg_stat_statements 重置 →
//       100 次 GET exposure → 快照差值 → 每请求查询数 + 语句分布。
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argOf = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const A_ROOT = path.resolve(argOf('root', process.cwd()));
const OUT = argOf('out', 'supp.json');
const pg = (await import(pathToFileURL(path.join(A_ROOT, 'node_modules', 'pg', 'lib', 'index.js')))).default;
const PORT = 17931;
const ADMIN = 'postgres://goal01:goal01-local@127.0.0.1:15446/postgres';
const DB_URL = 'postgres://goal01:goal01-local@127.0.0.1:15446/goal01_supp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = new pg.Pool({ connectionString: ADMIN });
await admin.query('DROP DATABASE IF EXISTS goal01_supp WITH (FORCE)');
await admin.query('CREATE DATABASE goal01_supp');
await admin.end();
const ext = new pg.Pool({ connectionString: DB_URL });
await ext.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
await ext.end();

const child = spawn('node', ['src/index.ts', '--port', String(PORT), '--db', DB_URL,
  '--principal-tokens', 'tok-cred1=cred1:human:credit:all:t1,tok-app1=app1:human:approver:all:t1,tok-biz1=biz1:human:business:all:t1',
  '--credit-matrix', 'm2', '--credit-concentration', 'c2', '--allow-legacy-basis'],
  { cwd: A_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
child.stdout.on('data', (d) => logs.push(d.toString()));
child.stderr.on('data', (d) => logs.push(d.toString()));
const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { const r = await fetch(`${base}/healthz`); up = r.status === 200; } catch { /* 未起 */ }
  if (!up) await sleep(250);
}
if (!up) { child.kill('SIGKILL'); throw new Error('kernel 启动失败：\n' + logs.join('')); }

const db = new pg.Pool({ connectionString: DB_URL });
db.on('error', () => { /* 清理期连接被终止：忽略 */ });
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-principal-credential': 'tok-cred1' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const CAP = 1_000_000_000;
await db.query(`INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
  ('m2','approver','facility.approve',true,$1),('m2','approver','facility.activate',true,$1) ON CONFLICT DO NOTHING`, [CAP]);
const cust = (await call('POST', '/api/v2/customers', { requestId: 's1', tenantId: 't1', legalEntityRef: 'LE-SUPP', displayName: 'supp' })).json.customerId;
const art = (await call('POST', `/api/v2/customers/${cust}/artifacts`, { requestId: 's2', tenantId: 't1', kind: 'customer_profile', factKey: 'p1', content: { rev: 1 }, grade: 'source_supported' })).json;
let lastFid = null;
for (let f = 0; f < 20; f++) {
  const ass = (await call('POST', `/api/v2/customers/${cust}/assessments`, { requestId: `a${f}`, tenantId: 't1', ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.artifactId }] })).json;
  await call('POST', `/api/v2/assessments/${ass.assessmentId}/candidate`, { requestId: `c${f}`, tenantId: 't1', candidate: { tendency: 'do', supportableAmountMinor: 10_000_000, currency: 'CNY', rationale: '', producedBy: 'supp', conditions: [], warnings: [] } });
  await call('POST', `/api/v2/assessments/${ass.assessmentId}/submit-review`, { requestId: `sr${f}`, tenantId: 't1' });
  const prop = (await call('POST', `/api/v2/customers/${cust}/facilities`, { requestId: `p${f}`, tenantId: 't1', assessmentId: ass.assessmentId, approvedAmountMinor: 40_000_000, currency: 'CNY' })).json;
  await call('POST', `/api/v2/facilities/${prop.facilityId}/approve`, { requestId: `ap${f}`, tenantId: 't1', rationale: 'x' });
  await call('POST', `/api/v2/facilities/${prop.facilityId}/activate`, { requestId: `ac${f}`, tenantId: 't1', rationale: 'x' });
  lastFid = prop.facilityId;
}
const N = 100;
await db.query('SELECT pg_stat_statements_reset()');
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const r = await call('GET', `/api/v2/customers/${cust}/exposure`);
  if (r.status !== 200) throw new Error('exposure 失败: ' + JSON.stringify(r.json).slice(0, 200));
}
const wallMs = performance.now() - t0;
const stmts = (await db.query('SELECT query, calls FROM pg_stat_statements')).rows
  .map((r) => ({ query: r.query.replace(/\s+/g, ' ').slice(0, 120), calls: Number(r.calls) }));
const total = stmts.reduce((s, r) => s + r.calls, 0);
// 认证/健康等无关查询按语句模式剔除（本轮测量段只有 exposure 调用；pg_stat_statements 自身查询计入前先减 1）
const ownQuery = 1;
const report = { root: A_ROOT, at: new Date().toISOString(), requests: N, wallMs: Math.round(wallMs * 1000) / 1000,
  queriesPerRequest: Math.round(((total - ownQuery) / N) * 100) / 100,
  totalQueries: total - ownQuery,
  statements: stmts.filter((s) => !s.query.includes('pg_stat_statements')).sort((x, y) => y.calls - x.calls) };
child.kill('SIGTERM');
await sleep(300);
if (!child.killed) child.kill('SIGKILL');
await db.end();
const admin2 = new pg.Pool({ connectionString: ADMIN });
await admin2.query('DROP DATABASE IF EXISTS goal01_supp WITH (FORCE)');
await admin2.end();
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`[supp] ${A_ROOT}`);
console.log(`[supp] ${N} 次 exposure：每请求查询数 = ${report.queriesPerRequest}（总 ${report.totalQueries}）；wall=${report.wallMs}ms`);
for (const s of report.statements.slice(0, 6)) console.log(`  ${s.calls}x  ${s.query}`);
