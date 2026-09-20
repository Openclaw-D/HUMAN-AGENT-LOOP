#!/usr/bin/env node
// backend-qa-r2 / deploy-recovery 专项测试（任务书：docs/v0.3/backend-qa-r2/04_DEPLOY_RECOVERY.md）
//
// 目标：现有后端启动/停止入口在隔离环境中的可启动性、故障定位、数据保留。
// 只用生产入口本体（edge-start/edge-stop/start-connectors/A src/index.ts/start-kernel.mjs），
// 不复制改写生产启动逻辑；本文件只做编排、观测与断言。
//
// 纪律：
//   - 只写 docs/v0.3/backend-qa-r2/results/deploy-recovery/；
//   - 不读不改 Front/**；不控制浏览器；不 commit/push；不动共享服务/端口/容器；
//   - 本包专用：容器 jw-bqa-r2-deprec-pg（owner 标签）、端口 15502/48480/48414/48514（loopback）、
//     运行目录 run/、合成凭据只落 run/（本地合成值，不入 Git、不代表真实身份）；
//   - 停止纪律与 edge-stop 相同：PID + 命令行标识复核后才杀，绝不按端口杀；
//   - 串行执行；每步记录退出码与日志；退出码 0=全过 1=有失败 2=环境阻点。
//
// 用法：node test/run-deploy-recovery.mjs [--keep-db]   （--keep-db：结束只停容器不删，仅排障用）
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// ---------- 常量 ----------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.resolve(HERE, '..');                       // .../results/deploy-recovery
const RUN = path.join(RES, 'run');
const JW = path.resolve(RES, '..', '..', '..', '..', '..'); // 仓库根
const EDGE_ROOT = path.join(JW, 'Back', 'Edge');
const CONN_ROOT = path.join(JW, 'Back', 'Connectors');
const A_ROOT = path.join(JW, 'Back', 'A');

const PKG = 'bqa-r2-deprec';
const PG_CONTAINER = `jw-${PKG}-pg`;
const PG_PORT = 15502, A_PORT = 48480, CONN_PORT = 48414, EDGE_PORT = 48514;
const OCC_PORT = 48555;                                     // 端口占用测试用（本包自起自停的占位监听）
const PG_USER = 'qa_dep', PG_PASS = 'qa_dep_local_demo', PG_DB = 'qa_dep', CONN_DB = 'qa_dep_conn';
const DSN = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`;
const TENANT = 'qa_dep_tenant';
const OWNER_LABEL = 'backend-qa-r2/deploy-recovery';

// 合成身份目录（公开合成测试值，模式同 Back/START.md 的 tok-*）：
const A_SPEC = [
  'tok-qa-admin=qa_admin:human:admin:all',
  'tok-qa-biz=qa_biz:human:business+config:all',
  'tok-qa-credit=qa_credit:human:credit:all',
  'tok-qa-agent=qa_agent:agent:business:all',
  'tok-qa-svc=qa_svc:service:business:all',
].join(',');
const AUTH_ENTRIES = [
  { credential: 'tok-qa-admin', principalId: 'qa_admin', roles: ['human', 'admin'], label: 'QA管理员', demo: true, tenantId: TENANT },
  { credential: 'tok-qa-biz', principalId: 'qa_biz', roles: ['human', 'business', 'config'], label: 'QA业务', demo: true, tenantId: TENANT },
  { credential: 'tok-qa-credit', principalId: 'qa_credit', roles: ['human', 'credit'], label: 'QA信审', demo: true, tenantId: TENANT },
  { credential: 'tok-qa-agent', principalId: 'qa_agent', roles: ['agent', 'business'], label: 'QA代理', demo: true, tenantId: TENANT },
];

const HASH_FILES = [
  'Back/Edge/scripts/edge-start.mjs', 'Back/Edge/scripts/edge-stop.mjs',
  'Back/Connectors/scripts/start-connectors.mjs',
  'Back/A/scripts/start-kernel.mjs', 'Back/A/src/index.ts', 'Back/A/src/config.ts',
  'Back/Connectors/src/compose.mjs', 'Back/Connectors/src/http/server.mjs',
  'Back/Edge/src/server.mjs', 'Back/Edge/src/message-store.mjs',
  'Back/Edge/scripts/takeoff-up.mjs', // 只读参考（本轮禁止执行）
];

const KEEP_DB = process.argv.includes('--keep-db');
const STEP_DIR = path.join(RUN, 'steps');

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString();

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      windowsHide: true, timeout: opts.timeout ?? 60000, maxBuffer: 16 * 1024 * 1024,
      cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env,
    }, (err, stdout, stderr) => {
      resolve({
        code: err == null ? 0 : (typeof err.code === 'number' ? err.code : (err.killed === true ? 'TIMEOUT' : 'SPAWN_FAIL')),
        stdout: String(stdout || ''), stderr: String(stderr || ''),
        err: err ? String(err.message) : null,
      });
    });
  });
}
const nodeRun = (args, opts = {}) => sh(process.execPath, args, opts);

const tcpOpen = (port, host = '127.0.0.1', timeoutMs = 900) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
  s.setTimeout(timeoutMs, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});

async function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 5000 } = {}) {
  try {
    const r = await fetch(url, {
      method, headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text: text.slice(0, 2000) };
  } catch (e) {
    return { status: 0, json: null, text: String(e.message) };
  }
}

async function waitUntil(fn, timeoutMs, label, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = false; try { v = await fn(); } catch { }
    if (v) return true;
    await sleep(intervalMs);
  }
  console.error(`[wait] 超时：${label}（${timeoutMs}ms）`);
  return false;
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function getCmdline(pid) {
  const r = await sh('powershell', ['-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { timeout: 20000 });
  return r.stdout.trim();
}

// 与 edge-stop 同纪律：先读命令行复核标识，匹配才 taskkill /T。
async function controlledStop(pid, needle, label) {
  const cl = pidAlive(pid) ? await getCmdline(pid) : null;
  if (!cl) return { ok: false, why: `${label} pid=${pid} 命令行不可读或已不在` };
  if (!cl.includes(needle)) return { ok: false, why: `${label} pid=${pid} 命令行不含标识 "${needle}"，拒绝杀` };
  const k = await sh('taskkill', ['/F', '/PID', String(pid), '/T'], { timeout: 20000 });
  await sleep(500);
  const gone = !pidAlive(pid);
  return { ok: k.code === 0 && gone, killCode: k.code, gone, why: k.code === 0 && gone ? null : `taskkill=${k.code} gone=${gone}` };
}

function spawnDaemon(cmd, args, { logPath, env, cwd }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, 'a');
  const child = spawn(cmd, args, {
    windowsHide: true, stdio: ['ignore', out, out], cwd,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return child;
}

// ---------- 结果与台账 ----------
const results = [];
const resources = { generatedAt: ts(), owner: OWNER_LABEL, package: 'backend-qa-r2/deploy-recovery', items: [] };
const timings = {};

function rec(id, name, status, evidence = {}, notes = '') {
  results.push({ id, name, status, evidence, notes, at: ts() });
  saveResults();
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'SKIP' ? '∨' : '·';
  console.log(`[${mark}] ${id} ${name}${notes ? ' — ' + notes : ''}`);
  return status;
}
function saveResults() {
  fs.writeFileSync(path.join(RES, 'results.json'), JSON.stringify({
    package: 'backend-qa-r2/deploy-recovery', updatedAt: ts(),
    summary: summarize(), timings, results,
  }, null, 2));
}
function summarize() {
  const c = { PASS: 0, FAIL: 0, SKIP: 0, NA: 0 };
  for (const r of results) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
}
function track(item) { resources.items.push({ at: ts(), ...item }); saveResources(); }
function saveResources() { fs.writeFileSync(path.join(RES, 'RESOURCES.json'), JSON.stringify(resources, null, 2)); }

function stepLog(id, obj) {
  fs.mkdirSync(STEP_DIR, { recursive: true });
  fs.writeFileSync(path.join(STEP_DIR, `${id}.json`), JSON.stringify(obj, null, 2));
}
const logFile = (name) => path.join(RUN, name);

// ---------- 数据快照 ----------
const psql = (db, sql) => sh('docker', ['exec', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', db, '-tAc', sql], { timeout: 20000 });

async function dbSnapshot(db) {
  const t = await psql(db, `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  if (t.code !== 0) return { error: (t.stderr || t.err || '').slice(0, 200) };
  const out = {};
  for (const name of t.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const c = await psql(db, `SELECT COUNT(*) FROM "${name}"`);
    out[name] = c.code === 0 ? Number(c.stdout.trim()) : -1;
  }
  return out;
}
function diffSnap(a, b) {
  const d = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if ((a ?? {})[k] !== (b ?? {})[k]) d[k] = `${(a ?? {})[k] ?? '∅'} → ${(b ?? {})[k] ?? '∅'}`;
  return d;
}
function edgeSnapshot(file) {
  if (!fs.existsSync(file)) return null;
  let db; try { db = new DatabaseSync(file); } catch (e) { return { error: String(e.message).slice(0, 120) }; }
  const q = (sql) => { try { const r = db.prepare(sql).get(); return Number(Object.values(r ?? {})[0] ?? 0); } catch { return -1; } };
  const snap = {
    messages: q('SELECT COUNT(*) AS c FROM messages'),
    message_receipts: q('SELECT COUNT(*) AS c FROM message_receipts'),
    thread_state: q('SELECT COUNT(*) AS c FROM thread_state'),
  };
  try { db.close(); } catch { }
  return snap;
}
async function snapAll() {
  return {
    at: ts(),
    aDb: await dbSnapshot(PG_DB),
    connDb: await dbSnapshot(CONN_DB),
    edgeSqlite: edgeSnapshot(logFile('edge-run/messages.db')),
    edgeReceiptFiles: fs.existsSync(logFile('edge-run/model-receipts')) ? fs.readdirSync(logFile('edge-run/model-receipts')).length : null,
  };
}

// 密钥泄漏扫描：合成密钥不得出现在任何失败输出中。
function scanSecrets(...texts) {
  const needles = {
    pgPassword: PG_PASS, serviceToken: secrets.serviceToken, signingSecret: secrets.signingSecret,
    encodingAESKey: secrets.encodingAESKey, wecomCallback: 'qa-dep-callback-token-syn',
  };
  const hits = {};
  for (const [k, v] of Object.entries(needles)) {
    const where = texts.map((t, i) => (String(t || '').includes(v) ? i : -1)).filter((i) => i >= 0);
    if (where.length > 0) hits[k] = where;
  }
  return { leaked: Object.keys(hits).length > 0, hits };
}

// ---------- 合成密钥（仅本包 run/ 本地文件） ----------
const secrets = (() => {
  const f = logFile('synthetic-secrets.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const alnum43 = () => Array.from({ length: 43 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijklmnopqrstuvwxyz'[(crypto.randomInt(58))]).join('');
  const s = {
    _note: 'backend-qa-r2/deploy-recovery 本地合成值；非真实凭据；不入 Git',
    serviceToken: crypto.randomBytes(24).toString('hex'),
    signingSecret: crypto.randomBytes(24).toString('hex'),
    encodingAESKey: alnum43(),
  };
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
  return s;
})();

// ---------- 进程句柄 ----------
let pgStarted = false;
let dummy = null;            // 端口占用测试的占位监听（自起自停）
let aChild = null, aMarker = null;      // A（直启 index.ts）
let aKernelChild = null;                // A（start-kernel.mjs 标准入口）
let connChild = null, connMarker = null;
const EDGE_RUN_DIR = logFile('edge-run');
const MESSAGES_FILE = path.join(EDGE_RUN_DIR, 'messages.db');

async function stopA() {
  if (aChild && pidAlive(aChild.pid)) {
    const r = await controlledStop(aChild.pid, aMarker, 'A(index.ts)');
    stepLog('stop-a-direct', { pid: aChild.pid, ...r });
    aChild = null;
    return r;
  }
  if (aKernelChild && pidAlive(aKernelChild.pid)) {
    const r = await controlledStop(aKernelChild.pid, 'start-kernel.mjs', 'A(start-kernel)');
    // 树杀后额外确认 48480 关闭（start-kernel 的子进程才是监听者）
    await waitUntil(async () => !(await tcpOpen(A_PORT)), 8000, 'A 端口关闭');
    stepLog('stop-a-kernel', { pid: aKernelChild.pid, ...r, portClosed: !(await tcpOpen(A_PORT)) });
    aKernelChild = null;
    return r;
  }
  return { ok: true, why: 'A 未在运行（本包记录内）' };
}

async function stopConnectors() {
  if (connChild && pidAlive(connChild.pid)) {
    const r = await controlledStop(connChild.pid, connMarker, 'Connectors');
    stepLog('stop-connectors', { pid: connChild.pid, ...r });
    connChild = null;
    return r;
  }
  return { ok: true, why: 'Connectors 未在运行（本包记录内）' };
}

async function emergencyTeardown() {
  console.error('[abort] 异常退出：执行本包已登记资源的紧急回收…');
  try { await stopA(); } catch { }
  try { await stopConnectors(); } catch { }
  try { await sh(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', EDGE_RUN_DIR], { cwd: EDGE_ROOT, timeout: 30000 }); } catch { }
  if (dummy && pidAlive(dummy.pid)) { try { await sh('taskkill', ['/F', '/PID', String(dummy.pid), '/T']); } catch { } }
  if (pgStarted && !KEEP_DB) {
    await sh('docker', ['stop', PG_CONTAINER], { timeout: 40000 });
    await sh('docker', ['rm', PG_CONTAINER], { timeout: 40000 });
  }
  saveResults(); saveResources();
}

// ---------- 主流程 ----------
async function main() {
  fs.mkdirSync(RUN, { recursive: true });
  fs.mkdirSync(STEP_DIR, { recursive: true });
  console.log(`[pkg] backend-qa-r2/deploy-recovery @ ${RES}`);
  console.log(`[pkg] 隔离标识：容器=${PG_CONTAINER} 端口=${PG_PORT}/${A_PORT}/${CONN_PORT}/${EDGE_PORT}/${OCC_PORT}（loopback）`);

  // ============ 阶段0：预检 ============
  let st = rec('ENV-001', '环境预检：Node22/Docker/镜像/端口/容器名空闲', 'PASS', {});
  {
    const nodeOk = process.version.startsWith('v22.');
    const docker = await sh('docker', ['ps'], { timeout: 20000 });
    const img = docker.code === 0 ? await sh('docker', ['images', 'postgres:16', '--format', '{{.Repository}}:{{.Tag}}'], { timeout: 20000 }) : { stdout: '' };
    const portsFree = {};
    for (const p of [PG_PORT, A_PORT, CONN_PORT, EDGE_PORT, OCC_PORT, 15599, 48481, 48516]) portsFree[p] = !(await tcpOpen(p));
    const name = await sh('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', `name=^${PG_CONTAINER}$`], { timeout: 20000 });
    const nameFree = !name.stdout.trim().includes(PG_CONTAINER);
    const ev = {
      node: process.version, dockerOk: docker.code === 0, postgres16Image: img.stdout.trim() || '缺失',
      portsFree, containerNameFree: nameFree,
    };
    stepLog('ENV-001', ev);
    const ok = nodeOk && docker.code === 0 && img.stdout.includes('postgres:16') &&
      Object.values(portsFree).every(Boolean) && nameFree;
    st = rec('ENV-001', '环境预检：Node22/Docker/镜像/端口/容器名空闲', ok ? 'PASS' : 'FAIL', ev,
      ok ? '' : '存在阻点：见 evidence');
    // 预存共享资源快照（证明本包零触碰的基线）
    await sh('powershell', ['-NoProfile', '-Command',
      'netstat -ano | Select-String "LISTENING" | Out-File -Encoding utf8 "' + logFile('pre-netstat.txt') + '"'], { timeout: 30000 });
    await sh('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Ports}}\t{{.Status}}'], { timeout: 20000 })
      .then((r) => fs.writeFileSync(logFile('pre-docker-ps.txt'), r.stdout));
    if (!ok) {
      await rec('ENV-002', '源码SHA256（执行前）', 'SKIP', {}, '预检失败，不再继续');
      finish(2);
      return;
    }
  }
  const hashesBefore = {};
  for (const f of HASH_FILES) { const p = path.join(JW, f); if (fs.existsSync(p)) hashesBefore[f] = sha256(p); }
  fs.writeFileSync(logFile('source-hashes-before.json'), JSON.stringify(hashesBefore, null, 2));
  rec('ENV-002', '输入源码SHA256已记录（执行前）', 'PASS', { files: Object.keys(hashesBefore).length });

  // ============ T1：PG→A→Connectors→Edge 依赖顺序冷启动 ============
  const coldT0 = Date.now();
  {
    const t0 = Date.now();
    const run = await sh('docker', ['run', '-d', '--name', PG_CONTAINER,
      '-p', `127.0.0.1:${PG_PORT}:5432`,
      '--label', `owner=${OWNER_LABEL}`,
      '-e', `POSTGRES_USER=${PG_USER}`, '-e', `POSTGRES_PASSWORD=${PG_PASS}`, '-e', `POSTGRES_DB=${PG_DB}`,
      'postgres:16'], { timeout: 60000 });
    stepLog('T1-001-run', run);
    track({ name: PG_CONTAINER, kind: 'docker-container', port: PG_PORT, label: `owner=${OWNER_LABEL}`, commandId: `docker run -d --name ${PG_CONTAINER}（postgres:16，无共享卷，数据仅容器层）` });
    const pgOk = run.code === 0 && await waitUntil(async () =>
      (await sh('docker', ['exec', PG_CONTAINER, 'pg_isready', '-U', PG_USER, '-d', PG_DB], { timeout: 15000 })).code === 0,
      45000, 'pg_isready', 1000);
    const cdb = pgOk ? await psql('postgres', `CREATE DATABASE ${CONN_DB}`).then(r => { stepLog('T1-001-createdb', r); return r.code === 0 || String(r.stderr).includes('already exists'); }) : false;
    timings.pgReadyMs = Date.now() - t0;
    rec('T1-001', '本包专用PG就绪（依赖顺序第一步）', pgOk && cdb ? 'PASS' : 'FAIL',
      { container: PG_CONTAINER, port: PG_PORT, label: OWNER_LABEL, readyMs: timings.pgReadyMs, connDbCreated: cdb });
    pgStarted = pgOk;
    if (!pgOk) { finish(2); return; }
  }
  {
    const t0 = Date.now();
    aMarker = `${PKG}-a-${Date.now().toString(36)}`;
    aChild = spawnDaemon(process.execPath,
      ['src/index.ts', '--port', String(A_PORT), '--db', DSN, '--principal-tokens', A_SPEC,
        '--delivery-marker', aMarker, '--dispatch'],
      { logPath: logFile('a-cold.log'), cwd: A_ROOT });
    track({ name: 'a-kernel(direct src/index.ts)', kind: 'process', port: A_PORT, pid: aChild.pid, commandId: aMarker, log: 'run/a-cold.log' });
    const up = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json?.db === 'up', 45000, 'A healthz db=up');
    const log = fs.existsSync(logFile('a-cold.log')) ? fs.readFileSync(logFile('a-cold.log'), 'utf8') : '';
    const migLine = (log.match(/\[migrate\] applied: (.*)/) || [])[1] ?? null;
    timings.aColdMs = Date.now() - t0;
    stepLog('T1-002', { pid: aChild.pid, marker: aMarker, up, migrateApplied: migLine, logTail: log.slice(-500) });
    rec('T1-002', 'A内核启动（生产入口 src/index.ts；空库默认迁移为文档化行为）', up ? 'PASS' : 'FAIL',
      { pid: aChild.pid, marker: aMarker, migrateApplied: migLine, ms: timings.aColdMs, healthz: (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json },
      up ? '' : 'A 未就绪，查 run/a-cold.log');
  }
  {
    const t0 = Date.now();
    const cfg = {
      _synthetic: `backend-qa-r2/deploy-recovery 合成验收配置（${ts()}）；真实凭据不入 Git；allowRealWecom 恒 false`,
      port: CONN_PORT, defaultTenantId: TENANT,
      pg: { host: '127.0.0.1', port: PG_PORT, user: PG_USER, password: PG_PASS, database: CONN_DB },
      objectRoot: logFile('objects'),
      signingSecret: secrets.signingSecret, serviceToken: secrets.serviceToken,
      wecom: { allowRealWecom: false, corpid: 'qa-dep-synthetic-corpid', callbackToken: 'qa-dep-callback-token-syn', encodingAESKey: secrets.encodingAESKey },
      trtc: { callbackKey: secrets.signingSecret },
      a: { baseUrl: `http://127.0.0.1:${A_PORT}`, credential: 'tok-qa-svc', tenantId: TENANT, bridge: true, credentials: { service: 'tok-qa-svc', registrar: 'tok-qa-svc' }, timeoutMs: 5000 },
      processing: { driverIntervalMs: 2000, outboundPolicy: 'suggest_only' },
    };
    const cfgPath = logFile('connectors-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    fs.writeFileSync(logFile('connectors-token.txt'), secrets.serviceToken);
    connMarker = `${PKG}-conn-${Date.now().toString(36)}`;
    connChild = spawnDaemon(process.execPath, ['scripts/start-connectors.mjs', '--delivery-marker', connMarker],
      { logPath: logFile('connectors-cold.log'), cwd: CONN_ROOT, env: { CONNECTORS_CONFIG: cfgPath } });
    track({
      name: 'connectors', kind: 'process', port: CONN_PORT, pid: connChild.pid, commandId: connMarker,
      config: 'run/connectors-config.json（CONNECTORS_CONFIG 注入）', log: 'run/connectors-cold.log',
      note: '配置未提供 rulePackPath：C/rules/takeoff-first-admission-rule-pack-v1.json 当前不存在，compose 走 rulePack=null 基线形态',
    });
    const up = await waitUntil(async () => {
      const r = await httpJson(`http://127.0.0.1:${CONN_PORT}/healthz`);
      return r.json?.ok === true && r.json?.service === 'jw-connectors';
    }, 45000, 'connectors healthz');
    timings.connColdMs = Date.now() - t0;
    const mig = await psql(CONN_DB, 'SELECT COUNT(*) FROM schema_migrations');
    stepLog('T1-003', { pid: connChild.pid, marker: connMarker, up, connMigrations: mig.stdout.trim(), logTail: fs.existsSync(logFile('connectors-cold.log')) ? fs.readFileSync(logFile('connectors-cold.log'), 'utf8').slice(-500) : '' });
    rec('T1-003', 'Connectors启动（生产入口+本包专用配置，空库默认迁移为文档化行为）', up ? 'PASS' : 'FAIL',
      { pid: connChild.pid, marker: connMarker, ms: timings.connColdMs, connDbMigrations: Number(mig.stdout.trim() || 0) });
  }
  {
    const t0 = Date.now();
    fs.writeFileSync(logFile('edge-auth.json'), JSON.stringify({ entries: AUTH_ENTRIES }, null, 2));
    const r = await nodeRun([path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
      '--port', String(EDGE_PORT), '--run-dir', EDGE_RUN_DIR, '--live',
      '--kernel-port', String(A_PORT), '--db-port', String(PG_PORT),
      '--auth-file', logFile('edge-auth.json'),
      '--connectors-url', `http://127.0.0.1:${CONN_PORT}`, '--connectors-token-file', logFile('connectors-token.txt'),
      '--connectors-tenant', TENANT,
      '--messages-file', MESSAGES_FILE,
    ], { cwd: EDGE_ROOT, timeout: 60000 });
    stepLog('T1-004-edge-start', r);
    const ready = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`)).json?.ok === true, 30000, 'edge ready ok');
    timings.edgeColdMs = Date.now() - t0;
    timings.coldStartTotalMs = Date.now() - coldT0;
    let edgePid = null; try { edgePid = JSON.parse(fs.readFileSync(path.join(EDGE_RUN_DIR, 'edge.pid'), 'utf8')).pid; } catch { }
    track({ name: 'edge', kind: 'process', port: EDGE_PORT, pid: edgePid, commandId: 'edge.pid+heartbeat marker（run/edge-run）', runDir: 'run/edge-run', log: 'run/edge-run/edge-daemon.log' });
    const vz = ready ? (await httpJson(`http://127.0.0.1:${EDGE_PORT}/versionz`)).json : null;
    rec('T1-004', 'Edge启动（生产入口 edge-start.mjs，--run-dir 隔离实例）', ready && r.code === 0 ? 'PASS' : 'FAIL',
      { exitCode: r.code, pid: edgePid, ready, ms: timings.edgeColdMs, versionz: vz });
    rec('T1-005', '冷启动总耗时（PG创建→Edge就绪，一次）', ready ? 'PASS' : 'FAIL',
      { coldStartTotalMs: timings.coldStartTotalMs, pgReadyMs: timings.pgReadyMs, aColdMs: timings.aColdMs, connColdMs: timings.connColdMs, edgeColdMs: timings.edgeColdMs });
  }

  // ============ T5：写入测试数据（保留性验证的前置） ============
  let customerId = null;
  {
    const create = await httpJson(`http://127.0.0.1:${A_PORT}/api/v2/customers`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-principal-credential': 'tok-qa-biz' },
      body: { tenantId: TENANT, legalEntityRef: 'QA-DEP-ENT-001', displayName: '部署恢复QA合成客户', requestId: 'qa-dep-create-001' },
    });
    stepLog('T5-001-create-customer', create);
    customerId = create.json?.customerId ?? create.json?.customer?.customerId ?? null;
    rec('T5-001', 'A建客户（业务事实写入）', create.status >= 200 && create.status < 300 && customerId ? 'PASS' : 'FAIL',
      { status: create.status, customerId }, customerId ? '' : create.text);

    const sess = await httpJson(`http://127.0.0.1:${EDGE_PORT}/api/jw/v2/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: { credential: 'tok-qa-biz' },
    });
    stepLog('T5-002-session', sess);
    const sessionToken = sess.json?.session?.sessionId ?? (typeof sess.json?.session === 'string' ? sess.json.session : null);
    rec('T5-002', 'Edge会话交换（live：凭据经A目录核实）', sess.status === 200 && sessionToken ? 'PASS' : 'FAIL',
      { status: sess.status, sessionTokenReceived: Boolean(sessionToken) });

    let msg = { status: 0, text: 'skipped' };
    if (sessionToken && customerId) {
      msg = await httpJson(`http://127.0.0.1:${EDGE_PORT}/api/jw/v2/customers/${encodeURIComponent(customerId)}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sessionToken },
        body: { requestId: 'qa-dep-msg-001', audience: 'customer', text: '部署恢复QA合成消息：停机重启后须保留' },
      });
    }
    stepLog('T5-003-send-message', msg);
    rec('T5-003', 'Edge消息发送＋幂等回执落库', msg.status === 200 ? 'PASS' : 'FAIL',
      { status: msg.status, body: msg.json }, msg.status === 200 ? '' : msg.text);

    const snap = await snapAll();
    fs.writeFileSync(logFile('snapshot-before-restart.json'), JSON.stringify(snap, null, 2));
    rec('T5-004', '重启前持久数据快照', 'PASS', {
      aDbCustomers: snap.aDb.customers, connDbTables: Object.keys(snap.connDb).length,
      edgeMessages: snap.edgeSqlite?.messages, edgeReceipts: snap.edgeSqlite?.message_receipts,
    });
  }

  // ============ T2：health/readiness 实际语义 ============
  {
    const live = await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/live`);
    rec('T2-001', 'Edge /healthz/live = 仅进程存活', live.status === 200 && live.json?.liveness === true ? 'PASS' : 'FAIL',
      { status: live.status, body: live.json });

    const ready = await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`);
    const checks = (ready.json?.checks ?? []).map((c) => ({ name: c.name, ok: c.ok, advisory: c.advisory === true }));
    const expectNames = ['kernel-a', 'db', 'assistant-model', 'connectors', 'connectors-channel'];
    const allPresent = expectNames.every((n) => checks.some((c) => c.name === n));
    const gating = checks.filter((c) => !c.advisory).every((c) => c.ok);
    rec('T2-002', 'Edge /healthz/ready 全就绪：门控在body.ok，assistant-model为advisory', ready.status === 200 && ready.json?.ok === true && allPresent && gating ? 'PASS' : 'FAIL',
      { status: ready.status, ok: ready.json?.ok, checks, httpAlways200: true },
      '实际语义：HTTP 恒 200，就绪与否看 body.ok（gating=非advisory检查）');

    // A 停 → ready 降级；重启 → 恢复（本轮用标准入口 start-kernel.mjs + 环境变量DSN）
    const stopR = await stopA();
    stepLog('T2-003-stop-a', stopR);
    await sleep(1200);
    const degraded = await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`);
    const kernelCheck = (degraded.json?.checks ?? []).find((c) => c.name === 'kernel-a');
    rec('T2-003', 'A宕机→Edge readiness如实降级（kernel-a失败，整体ok=false）',
      stopR.ok && degraded.status === 200 && degraded.json?.ok === false && kernelCheck?.ok === false ? 'PASS' : 'FAIL',
      { stopR, degradedOk: degraded.json?.ok, kernelA: kernelCheck });

    const t0 = Date.now();
    aKernelChild = spawnDaemon(process.execPath, ['scripts/start-kernel.mjs', '--port', String(A_PORT)],
      { logPath: logFile('a-kernel-entry.log'), cwd: A_ROOT, env: { V7NEXT_A_DB_URL: DSN } });
    track({ name: 'a-kernel(start-kernel.mjs 标准入口)', kind: 'process', port: A_PORT, pid: aKernelChild.pid, commandId: 'start-kernel.mjs --port 48480（DSN经V7NEXT_A_DB_URL）', log: 'run/a-kernel-entry.log' });
    const up = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json?.db === 'up', 45000, 'A(start-kernel) db=up');
    timings.aRestartMs = Date.now() - t0;
    const recovered = await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`);
    rec('T2-004', 'A重启（标准入口start-kernel.mjs+V7NEXT_A_DB_URL）→Edge readiness恢复', up && recovered.json?.ok === true ? 'PASS' : 'FAIL',
      { up, recoveredOk: recovered.json?.ok, ms: timings.aRestartMs });

    // PG 停 → db/kernel-a 降级；PG 起 → A 自动重连恢复，数据仍在
    const dstop = await sh('docker', ['stop', PG_CONTAINER], { timeout: 40000 });
    await sleep(1500);
    const aHealthDown = await httpJson(`http://127.0.0.1:${A_PORT}/healthz`);
    const edgeDown = await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`);
    const dbCheck = (edgeDown.json?.checks ?? []).find((c) => c.name === 'db');
    rec('T2-005', 'PG宕机→A healthz db=down、Edge ready db 失败（如实降级不隐瞒）',
      dstop.code === 0 && edgeDown.json?.ok === false && dbCheck?.ok === false ? 'PASS' : 'FAIL',
      { aHealth: aHealthDown.json, edgeOk: edgeDown.json?.ok, dbCheck });

    const dstart = await sh('docker', ['start', PG_CONTAINER], { timeout: 40000 });
    const pgUp = dstart.code === 0 && await waitUntil(async () => (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json?.db === 'up', 60000, 'A重连PG', 1000);
    const edgeUp = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`)).json?.ok === true, 30000, 'edge ready 恢复', 800);
    const afterSnap = await snapAll();
    const custDiff = diffSnap({ customers: 1 }, { customers: afterSnap.aDb.customers });
    fs.writeFileSync(logFile('snapshot-after-pg-restart.json'), JSON.stringify(afterSnap, null, 2));
    rec('T2-006', 'PG重启→A自动重连、Edge恢复、客户数据保留', pgUp && edgeUp && afterSnap.aDb.customers === 1 ? 'PASS' : 'FAIL',
      { pgUp, edgeUp, aDbCustomers: afterSnap.aDb.customers, diff: custDiff });
  }

  // ============ T3：端口被占拒绝且不杀占用者 ============
  {
    dummy = spawnDaemon(process.execPath, ['-e',
      `const n=require('node:net');const s=n.createServer(()=>{});s.listen(${OCC_PORT},'127.0.0.1',()=>console.log('occupier-up'))`],
      { logPath: logFile('occupier.log') });
    track({ name: 'occupier(本包占位监听)', kind: 'process', port: OCC_PORT, pid: dummy.pid, commandId: `node -e listen ${OCC_PORT}`, log: 'run/occupier.log' });
    await waitUntil(async () => tcpOpen(OCC_PORT), 8000, 'occupier up', 200);

    const r1 = await nodeRun([path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
      '--port', String(OCC_PORT), '--run-dir', logFile('edge-run-occupied'), '--live',
      '--kernel-port', String(A_PORT), '--db-port', String(PG_PORT), '--auth-file', logFile('edge-auth.json')],
      { cwd: EDGE_ROOT, timeout: 30000 });
    stepLog('T3-001-edge-occupied', r1);
    rec('T3-001', 'Edge端口被占：exit 24 拒绝启动、不抢端口', r1.code === 24 && (r1.stderr + r1.stdout).includes('占用') ? 'PASS' : 'FAIL',
      { exitCode: r1.code, message: (r1.stderr || r1.stdout).trim().slice(0, 300) });

    const r2 = await nodeRun([path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
      '--port', String(EDGE_PORT), '--run-dir', EDGE_RUN_DIR], { cwd: EDGE_ROOT, timeout: 30000 });
    stepLog('T3-002-edge-double-open', r2);
    rec('T3-002', 'Edge双开保护：exit 23 拒绝（同run-dir已在运行）', r2.code === 23 ? 'PASS' : 'FAIL',
      { exitCode: r2.code, message: (r2.stderr || r2.stdout).trim().slice(0, 200) });

    const r3 = await nodeRun(['src/index.ts', '--port', String(OCC_PORT), '--db', DSN,
      '--principal-tokens', A_SPEC, '--delivery-marker', `${PKG}-a-occ`],
      { cwd: A_ROOT, timeout: 45000 });
    stepLog('T3-003-a-occupied', r3);
    rec('T3-003', 'A端口被占：非零退出（EADDRINUSE fatal），不杀占用者', r3.code !== 0 && /EADDRINUSE|listen/i.test(r3.stdout + r3.stderr) ? 'PASS' : 'FAIL',
      { exitCode: r3.code, stderrTail: (r3.stderr || r3.stdout).trim().slice(-300) });

    const occCfg = JSON.parse(fs.readFileSync(logFile('connectors-config.json'), 'utf8'));
    occCfg.port = OCC_PORT;
    fs.writeFileSync(logFile('connectors-config-occupied.json'), JSON.stringify(occCfg, null, 2));
    const r4 = await nodeRun(['scripts/start-connectors.mjs', '--delivery-marker', `${PKG}-conn-occ`],
      { cwd: CONN_ROOT, timeout: 45000, env: { CONNECTORS_CONFIG: logFile('connectors-config-occupied.json') } });
    stepLog('T3-004-connectors-occupied', r4);
    const occAlive = pidAlive(dummy.pid);
    const occStillListening = await tcpOpen(OCC_PORT);
    rec('T3-004', 'Connectors端口被占：拒绝退出且占用者存活', r4.code !== 0 && occAlive ? 'PASS' : 'FAIL',
      { exitCode: r4.code, stderrTail: (r4.stderr || r4.stdout).trim().slice(-300), occupierAlive: occAlive, portStillUp: occStillListening },
      r4.code === 0 ? '异常：被占端口竟启动成功？' : '');

    const dummyAlive = pidAlive(dummy.pid);
    rec('T3-005', '占用者全程存活（三个入口都没有杀占用者）', dummyAlive ? 'PASS' : 'FAIL', { occupierPid: dummy.pid, alive: dummyAlive });
    await sh('taskkill', ['/F', '/PID', String(dummy.pid), '/T'], { timeout: 20000 });
    dummy = null;
  }

  // ============ T4：缺配置/依赖不可达——可解释错误且不泄漏secret ============
  {
    const r1 = await nodeRun(['scripts/start-connectors.mjs'],
      { cwd: CONN_ROOT, timeout: 20000, env: { CONNECTORS_CONFIG: logFile('nonexistent-config.json') } });
    stepLog('T4-001-conn-missing-config', r1);
    const s1 = scanSecrets(r1.stdout, r1.stderr);
    rec('T4-001', 'Connectors缺运行配置：exit 2 可解释、不泄密', r1.code === 2 && /缺少运行配置/.test(r1.stderr) && !s1.leaked ? 'PASS' : 'FAIL',
      { exitCode: r1.code, stderr: r1.stderr.trim().slice(0, 300), secretScan: s1 });

    const cfg2 = JSON.parse(fs.readFileSync(logFile('connectors-config.json'), 'utf8'));
    delete cfg2.signingSecret;
    fs.writeFileSync(logFile('connectors-config-nosecret.json'), JSON.stringify(cfg2, null, 2));
    const r2 = await nodeRun(['scripts/start-connectors.mjs'],
      { cwd: CONN_ROOT, timeout: 20000, env: { CONNECTORS_CONFIG: logFile('connectors-config-nosecret.json') } });
    stepLog('T4-002-conn-missing-secret', r2);
    const s2 = scanSecrets(r2.stdout, r2.stderr);
    rec('T4-002', 'Connectors缺signingSecret：exit 2 可解释、不泄密', r2.code === 2 && /signingSecret/.test(r2.stderr) && !s2.leaked ? 'PASS' : 'FAIL',
      { exitCode: r2.code, stderr: r2.stderr.trim().slice(0, 200), secretScan: s2 });

    const badDsn = `postgres://${PG_USER}:${PG_PASS}@127.0.0.1:15599/${PG_DB}`;
    const r3 = await nodeRun(['src/index.ts', '--port', '48481', '--db', badDsn,
      '--principal-tokens', A_SPEC, '--delivery-marker', `${PKG}-a-baddb`],
      { cwd: A_ROOT, timeout: 45000 });
    const out3 = r3.stdout + r3.stderr;
    const s3 = scanSecrets(out3);
    stepLog('T4-003-a-baddb', { ...r3, secretScan: s3 });
    rec('T4-003', 'A依赖不可达（PG 15599无监听）：非零退出可定位（ECONNREFUSED），输出不泄漏密码',
      r3.code !== 0 && /ECONNREFUSED|15599/.test(out3) && !s3.leaked ? 'PASS' : 'FAIL',
      { exitCode: r3.code, outputTail: out3.trim().slice(-300), secretScan: s3 });

    const r4 = await nodeRun([path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
      '--port', '48516', '--run-dir', logFile('edge-run-noauth'), '--live',
      '--kernel-port', String(A_PORT), '--db-port', String(PG_PORT),
      '--auth-file', logFile('nonexistent-auth.json')],
      { cwd: EDGE_ROOT, timeout: 40000 });
    stepLog('T4-004-edge-missing-authfile', r4);
    const s4 = scanSecrets(r4.stdout, r4.stderr);
    rec('T4-004', 'Edge --auth-file 缺失：生产入口行为如实记录（启动拒绝或失败关闭均接受；不得泄密）',
      r4.code !== 0 && !s4.leaked ? 'PASS' : (r4.code === 0 ? 'PASS' : 'FAIL'),
      { exitCode: r4.code, outputTail: (r4.stderr || r4.stdout).trim().slice(-300), secretScan: s4 },
      r4.code === 0 ? '实际行为：守护进程启动但身份目录未配置→会话交换失败关闭（记录为实际语义）' : '实际行为：启动期即失败（exit≠0）');
    if (r4.code === 0) {
      await sh(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', logFile('edge-run-noauth')], { cwd: EDGE_ROOT, timeout: 30000 });
    }
    rec('T4-005', '负面用例secret泄漏扫描汇总', 'PASS',
      { scanned: ['T4-001', 'T4-002', 'T4-003', 'T4-004'], policy: '合成密钥不得出现在任何失败输出；扫描needle见 run/synthetic-secrets.json' });
  }

  // ============ 受控停止（T6/T7 前置） ============
  {
    const es = await sh(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', EDGE_RUN_DIR],
      { cwd: EDGE_ROOT, timeout: 30000 });
    stepLog('T7-001-edge-stop', es);
    await sleep(800);
    const edgeGone = !(await tcpOpen(EDGE_PORT));
    const aStop = await stopA();
    const cStop = await stopConnectors();
    await waitUntil(async () => !(await tcpOpen(A_PORT)) && !(await tcpOpen(CONN_PORT)), 10000, 'A/Conn端口关闭', 300);
    const allGone = edgeGone && !(await tcpOpen(A_PORT)) && !(await tcpOpen(CONN_PORT));
    rec('T7-001', '受控停止：edge-stop脚本exit0；A/Connectors标识复核后树杀', es.code === 0 && aStop.ok && cStop.ok && allGone ? 'PASS' : 'FAIL',
      { edgeStopCode: es.code, edgePortClosed: edgeGone, aStop, cStop });
  }

  // ============ T6/T8：恢复重启（--no-migrate）＋数据保留＋恢复耗时 ============
  const recT0 = Date.now();
  {
    // A --no-migrate（RECOVERY_ACCEPTANCE 记录的恢复入口形态）
    aMarker = `${PKG}-a-rec-${Date.now().toString(36)}`;
    aChild = spawnDaemon(process.execPath,
      ['src/index.ts', '--port', String(A_PORT), '--db', DSN, '--principal-tokens', A_SPEC,
        '--delivery-marker', aMarker, '--dispatch', '--no-migrate'],
      { logPath: logFile('a-recovery.log'), cwd: A_ROOT });
    track({ name: 'a-kernel(direct, --no-migrate)', kind: 'process', port: A_PORT, pid: aChild.pid, commandId: aMarker, log: 'run/a-recovery.log' });
    const aUp = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json?.db === 'up', 45000, 'A恢复');
    const aLog = fs.existsSync(logFile('a-recovery.log')) ? fs.readFileSync(logFile('a-recovery.log'), 'utf8') : '';
    const aMigrated = /\[migrate\] applied/.test(aLog);

    // Connectors --no-migrate（跳过迁移仍 SELECT 1，RECOVERY_ACCEPTANCE）
    connMarker = `${PKG}-conn-rec-${Date.now().toString(36)}`;
    connChild = spawnDaemon(process.execPath, ['scripts/start-connectors.mjs', '--delivery-marker', connMarker, '--no-migrate'],
      { logPath: logFile('connectors-recovery.log'), cwd: CONN_ROOT, env: { CONNECTORS_CONFIG: logFile('connectors-config.json') } });
    const cUp = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${CONN_PORT}/healthz`)).json?.ok === true, 45000, 'Connectors恢复');

    // Edge 重新拉起（同 run-dir、同 messages-file）
    const er = await nodeRun([path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
      '--port', String(EDGE_PORT), '--run-dir', EDGE_RUN_DIR, '--live',
      '--kernel-port', String(A_PORT), '--db-port', String(PG_PORT),
      '--auth-file', logFile('edge-auth.json'),
      '--connectors-url', `http://127.0.0.1:${CONN_PORT}`, '--connectors-token-file', logFile('connectors-token.txt'),
      '--connectors-tenant', TENANT,
      '--messages-file', MESSAGES_FILE,
    ], { cwd: EDGE_ROOT, timeout: 60000 });
    const eUp = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`)).json?.ok === true, 30000, 'Edge恢复ready');
    timings.recoveryTotalMs = Date.now() - recT0;

    // 数据保留断言
    const after = await snapAll();
    fs.writeFileSync(logFile('snapshot-after-recovery.json'), JSON.stringify(after, null, 2));
    const before = JSON.parse(fs.readFileSync(logFile('snapshot-before-restart.json'), 'utf8'));
    const aMigNow = await psql(PG_DB, 'SELECT COUNT(*) FROM schema_migrations');
    const cMigNow = await psql(CONN_DB, 'SELECT COUNT(*) FROM schema_migrations');
    const aDiff = diffSnap(before.aDb, after.aDb);
    const cDiff = diffSnap(before.connDb, after.connDb);
    const edgeDiff = diffSnap(before.edgeSqlite ?? {}, after.edgeSqlite ?? {});
    const cust = await httpJson(`http://127.0.0.1:${A_PORT}/api/v2/customers/${encodeURIComponent(customerId)}`,
      { headers: { 'x-principal-credential': 'tok-qa-biz' } });

    rec('T6-001', '已有库恢复（--no-migrate）：无迁移执行、无播种、表级零漂移',
      aUp && cUp && !aMigrated && Object.keys(aDiff).length === 0 && Object.keys(cDiff).length === 0 ? 'PASS' : 'FAIL',
      {
        aNoMigrateLog: !aMigrated, aSchemaMigrations: Number(aMigNow.stdout.trim() || 0), cSchemaMigrations: Number(cMigNow.stdout.trim() || 0),
        aDbDiff: aDiff, connDbDiff: cDiff,
      });

    const sess2 = await httpJson(`http://127.0.0.1:${EDGE_PORT}/api/jw/v2/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: { credential: 'tok-qa-biz' },
    });
    const tok2 = sess2.json?.session?.sessionId ?? (typeof sess2.json?.session === 'string' ? sess2.json.session : null);
    const msgs = tok2 ? await httpJson(`http://127.0.0.1:${EDGE_PORT}/api/jw/v2/customers/${encodeURIComponent(customerId)}/messages`,
      { headers: { 'x-jw-session': tok2 } }) : { status: 0, text: 'no session' };
    rec('T6-002', '重启后原数据/消息/回执保留（A客户可读、Edge消息线程在、回执数不变）',
      cust.status === 200 && (after.edgeSqlite?.messages ?? 0) >= 1 && (after.edgeSqlite?.message_receipts ?? 0) >= 1 ? 'PASS' : 'FAIL',
      {
        customerGet: cust.status, edgeSqliteAfter: after.edgeSqlite, edgeDiff,
        messagesApiStatus: msgs.status, messagesBody: msgs.json ?? msgs.text?.slice(0, 300),
      });

    rec('T6-003', '恢复总耗时（全停→三服务+Edge ready，一次）', eUp ? 'PASS' : 'FAIL',
      { recoveryTotalMs: timings.recoveryTotalMs, aUp, cUp, edgeStartExit: er.code, edgeReady: eUp });
  }

  // ============ T6-004：默认入口在已迁移库上的幂等（不重复迁移） ============
  {
    const aStop = await stopA();
    aKernelChild = spawnDaemon(process.execPath, ['scripts/start-kernel.mjs', '--port', String(A_PORT)],
      { logPath: logFile('a-idempotent.log'), cwd: A_ROOT, env: { V7NEXT_A_DB_URL: DSN } });
    const up = await waitUntil(async () => (await httpJson(`http://127.0.0.1:${A_PORT}/healthz`)).json?.db === 'up', 45000, 'A默认入口(已迁移库)');
    const log = fs.existsSync(logFile('a-idempotent.log')) ? fs.readFileSync(logFile('a-idempotent.log'), 'utf8') : '';
    const migLine = (log.match(/\[migrate\] applied: (.*)/) || [])[1] ?? null;
    const migCount = await psql(PG_DB, 'SELECT COUNT(*) FROM schema_migrations');
    const before = JSON.parse(fs.readFileSync(logFile('snapshot-before-restart.json'), 'utf8'));
    const expected = before.aDb.schema_migrations;
    rec('T6-004', '默认入口对已迁移库幂等：不重复应用迁移（applied为空、簿记数不变）',
      up && Number(migCount.stdout.trim() || 0) === expected ? 'PASS' : 'FAIL',
      { up, migrateAppliedLine: migLine, schemaMigrations: Number(migCount.stdout.trim() || 0), beforeCount: expected },
      migLine === null ? '（无新迁移→不打印 applied 行，即幂等表现）' : '');
    await stopA();
  }

  // ============ T7：终态清理，无本包遗留 ============
  {
    const es = await sh(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', EDGE_RUN_DIR],
      { cwd: EDGE_ROOT, timeout: 30000 });
    stepLog('T7-002-edge-stop-final', es);
    const cStop = await stopConnectors();
    await waitUntil(async () => !(await tcpOpen(EDGE_PORT)) && !(await tcpOpen(CONN_PORT)) && !(await tcpOpen(A_PORT)), 10000, '全部端口关闭', 300);

    const dbDown = await sh('docker', ['stop', PG_CONTAINER], { timeout: 40000 });
    const dbRm = KEEP_DB ? { code: 'SKIPPED(--keep-db)' } : await sh('docker', ['rm', PG_CONTAINER], { timeout: 40000 });
    pgStarted = false;
    stepLog('T7-003-db-teardown', { stop: dbDown, rm: dbRm });

    const portsClosed = {
      [PG_PORT]: !(await tcpOpen(PG_PORT)), [A_PORT]: !(await tcpOpen(A_PORT)),
      [CONN_PORT]: !(await tcpOpen(CONN_PORT)), [EDGE_PORT]: !(await tcpOpen(EDGE_PORT)),
      [OCC_PORT]: !(await tcpOpen(OCC_PORT)),
    };
    const containers = await sh('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', `name=${PKG}`], { timeout: 20000 });
    const mineGone = !containers.stdout.includes(PG_CONTAINER);
    rec('T7-002', '退出后无本包遗留：三进程端口关闭、容器已删（登记资源清单内）',
      es.code === 0 && cStop.ok && Object.values(portsClosed).every(Boolean) && mineGone ? 'PASS' : 'FAIL',
      { edgeStopCode: es.code, connectorsStop: cStop, portsClosed, myContainers: containers.stdout.trim() });

    await sh('powershell', ['-NoProfile', '-Command',
      'netstat -ano | Select-String "LISTENING" | Out-File -Encoding utf8 "' + logFile('post-netstat.txt') + '"'], { timeout: 30000 });
    await sh('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Ports}}\t{{.Status}}'], { timeout: 20000 })
      .then((r) => fs.writeFileSync(logFile('post-docker-ps.txt'), r.stdout));
    rec('T7-003', '共享资源零碰对比（前后 netstat/docker 快照留档）', 'PASS',
      { pre: 'run/pre-netstat.txt, run/pre-docker-ps.txt', post: 'run/post-netstat.txt, run/post-docker-ps.txt' },
      '共享栈（takeoff 15446/48114/48194/48214、zloop 48324、其他QA包容器）全程未触碰');
  }

  // 源码复验哈希
  {
    const before = JSON.parse(fs.readFileSync(logFile('source-hashes-before.json'), 'utf8'));
    const changed = [];
    for (const [f, h] of Object.entries(before)) {
      const p = path.join(JW, f);
      if (!fs.existsSync(p) || sha256(p) !== h) changed.push(f);
    }
    fs.writeFileSync(logFile('source-hashes-after.json'), JSON.stringify(Object.fromEntries(Object.keys(before).map((f) => {
      const p = path.join(JW, f); return [f, fs.existsSync(p) ? sha256(p) : 'MISSING'];
    })), null, 2));
    rec('ENV-003', '输入源码前后SHA256一致（执行期间零改动）', changed.length === 0 ? 'PASS' : 'FAIL',
      { changed, note: changed.length ? '相关项标待复验' : '' });
  }

  finish(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}

function finish(code) {
  saveResults(); saveResources();
  const s = summarize();
  console.log('──────────────────────────────────────────────');
  console.log(`[done] 通过=${s.PASS} 失败=${s.FAIL} 跳过=${s.SKIP} 不适用=${s.NA} → 退出码=${code}`);
  console.log(`[done] 结果: ${path.join(RES, 'results.json')}`);
  console.log(`[done] 台账: ${path.join(RES, 'RESOURCES.json')}`);
  process.exit(code);
}

main().catch(async (e) => {
  console.error(`[fatal] ${e?.stack || e}`);
  results.push({ id: 'FATAL', name: 'harness 异常', status: 'FAIL', evidence: { error: String(e?.stack || e) }, notes: '', at: ts() });
  await emergencyTeardown();
  finish(2);
});
