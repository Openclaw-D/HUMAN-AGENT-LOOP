// V0.3 zcode-real-loop · 隔离真实栈装配（2026-09-20）。
// 形态与 takeoff-up.mjs 同纪律：预检 → 独立 PG 容器（owner 标签，非本路拒绝）→ A 迁移+启动 →
// 合成矩阵/必需域政策播种 → Connectors（独立库/对象根/配置文件，不动 config.takeoff.json）→
// Edge --live（身份目录+模型 profile registry+同源前端）→ 就绪报告+资源台账 → 退出（守护进程留存）。
// 与共享栈（jw-takeoff-pg / 48194/48114/48214 / .run/takeoff）完全隔离：端口段
// 48304(A)/48284(Connectors)/48324(Edge)/15474(PG)，run-dir=.run/zloop，容器 jw-zloop-pg。
// 先运行 zloop-prep.mjs 生成运行配置/模型配置/profile registry/账本延续。
// 停止：node scripts/zloop-down.mjs（多证复核；--with-db 停容器，数据卷永不动）。
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const CONNECTORS_ROOT = path.join(BACK_ROOT, 'Connectors');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'zloop');
const DB_CONTAINER = 'jw-zloop-pg';
const DB_VOLUME = 'jw_zloop_pgdata';
const DB_PORT = 15474;
const KERNEL_PORT = 48304;
const CONNECTORS_PORT = 48284;
const EDGE_PORT = 48324;
const OWNER = 'zcode-real-loop（V0.3 真实模型业务闭环验收切片）';
const SERVE_FRONT = path.join(REPO_ROOT, 'Front', 'dist');

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000, maxBuffer: 16 * 1024 * 1024 },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const portBusy = (host, port, timeoutMs = 900) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
  s.setTimeout(timeoutMs, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});
const fail = (msg) => { console.error(`[zloop-up] ✗ ${msg}`); process.exit(2); };
const ok = (msg) => console.log(`[zloop-up] ✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfgPath = process.argv[2] ?? path.join(RUN_DIR, 'zloop-runtime.json');
if (!existsSync(cfgPath)) fail(`缺少 ${cfgPath}：先运行 node scripts/zloop-prep.mjs`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['principalTokens', 'creditMatrix', 'creditConcentration', 'dbUser', 'dbPassword', 'dbName']) {
  if (typeof cfg[k] !== 'string' || cfg[k].length === 0) fail(`zloop-runtime.json 缺字段 ${k}`);
}
if (cfg._synthetic !== true) fail('zloop-runtime.json 必须显式 "_synthetic": true');
if (!cfg.assistantModel?.configPath || !cfg.assistantModel?.registryPath) fail('zloop-runtime.json 缺 assistantModel.configPath/registryPath（先 zloop-prep）');
const connectorsCfg = cfg.connectors ?? null;
if (!connectorsCfg) fail('缺 connectors 段（本闭环必须全链）');

// ---- 0) 预检 ----
if (!process.version.startsWith('v22.')) fail(`需要 Node 22.x，当前 ${process.version}`);
const docker = await run('docker', ['ps'], 20000);
if (docker.err) fail('docker 不可达；先启动 Docker Desktop');
if (!existsSync(path.join(SERVE_FRONT, 'index.html'))) fail(`前端构建缺失：${SERVE_FRONT}`);
for (const [name, port] of [['A', KERNEL_PORT], ['Connectors', CONNECTORS_PORT], ['Edge', EDGE_PORT]]) {
  if (await portBusy('127.0.0.1', port)) fail(`端口 ${port}（${name}）已被占用：非本路资源不抢，换端口或核实归属`);
}
ok('预检通过（node/docker/dist/端口段空闲）');

// ---- 1) 独立 PG 容器（本路登记资源） ----
const psA = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}', '--filter', `name=^${DB_CONTAINER}$`]);
if (!psA.stdout.includes(DB_CONTAINER)) {
  const createR = await run('docker', ['run', '-d', '--name', DB_CONTAINER,
    '-p', `127.0.0.1:${DB_PORT}:5432`, '-v', `${DB_VOLUME}:/var/lib/postgresql/data`,
    '--label', `owner=${OWNER}`,
    '-e', `POSTGRES_USER=${cfg.dbUser}`, '-e', `POSTGRES_PASSWORD=${cfg.dbPassword}`, '-e', `POSTGRES_DB=${cfg.dbName}`,
    'postgres:16']);
  if (createR.err) fail(`创建容器失败: ${createR.stderr.slice(0, 160)}`);
  ok(`容器 ${DB_CONTAINER}@${DB_PORT} 已创建（owner=${OWNER}；卷 ${DB_VOLUME}）`);
} else {
  const lbl = await run('docker', ['inspect', '--format', '{{index .Config.Labels "owner"}}', DB_CONTAINER]);
  if (lbl.err || String(lbl.stdout).trim() !== OWNER) fail(`容器 ${DB_CONTAINER} 已存在且非本路（owner=${String(lbl.stdout).trim() || '无'}）：拒绝使用`);
  if (!psA.stdout.includes('Up')) {
    const startR = await run('docker', ['start', DB_CONTAINER]);
    if (startR.err) fail(`启动容器失败: ${startR.stderr.slice(0, 120)}`);
  }
  ok(`容器 ${DB_CONTAINER} 属本路，已运行`);
}
let pgReady = false;
for (let i = 0; i < 30 && !pgReady; i++) {
  pgReady = !(await run('docker', ['exec', DB_CONTAINER, 'pg_isready', '-U', cfg.dbUser, '-d', cfg.dbName])).err;
  if (!pgReady) await sleep(800);
}
if (!pgReady) fail('PG 未就绪');
ok('PG 就绪');

// ---- 2) A 迁移 + 播种 ----
const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${DB_PORT}/${cfg.dbName}`;
const mig = await new Promise((resolve) => {
  execFile(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'db', 'migrate-cli.ts')],
    { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, V7NEXT_A_DB_URL: dsn } },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
if (mig.err) fail(`迁移失败: ${(mig.stderr || mig.err.message || '').slice(0, 300)}`);
ok(`A 迁移完成（${mig.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'OK'}）`);
const seedSql = async (label, sql) => {
  const r = await run('docker', ['exec', DB_CONTAINER, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (r.err) fail(`${label} 播种失败: ${r.stderr.slice(0, 200)}`);
  ok(`${label} 播种完成（幂等）`);
};
if (typeof cfg.matrixSeedSql === 'string' && cfg.matrixSeedSql.length > 0) await seedSql('权限矩阵（合成开发矩阵）', cfg.matrixSeedSql);
if (cfg.requiredDomainsPolicy) await seedSql(`必需域政策 ${cfg.requiredDomainsPolicy.version}（合成标注）`, cfg.requiredDomainsPolicy.seedSql);
if (cfg.takeoffSeedSql) await seedSql('TAKEOFF 合成种子', cfg.takeoffSeedSql);

// ---- 3) A 内核（守护spawn，脚本退出后存活） ----
mkdirSync(RUN_DIR, { recursive: true });
const aMarker = `jw-zloop-a-${Date.now().toString(36)}`;
const aLogFd = openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
const aChild = spawn(process.execPath, [
  path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(KERNEL_PORT), '--db', dsn,
  '--principal-tokens', cfg.principalTokens, '--credit-matrix', cfg.creditMatrix, '--credit-concentration', cfg.creditConcentration,
  ...(cfg.requiredDomainsPolicy ? ['--required-domains-policy', cfg.requiredDomainsPolicy.version] : []),
  '--delivery-marker', aMarker,
], { windowsHide: true, detached: true, stdio: ['ignore', aLogFd, aLogFd] });
aChild.unref();
const waitHealth = async (url, extra, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.status === 200) { const j = await r.json(); if (!extra || extra(j)) return true; } } catch { }
    await sleep(600);
  }
  return false;
};
if (!await waitHealth(`http://127.0.0.1:${KERNEL_PORT}/healthz`, (j) => j.db === 'up')) {
  console.error(`[zloop-up] A 内核未就绪（日志 ${path.join(RUN_DIR, 'kernel.log')}）`);
  process.exit(2);
}
writeFileSync(path.join(RUN_DIR, 'kernel.pid'), JSON.stringify({ pid: aChild.pid, marker: aMarker, port: KERNEL_PORT, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }));
ok(`A 内核运行中 pid=${aChild.pid} port=${KERNEL_PORT}`);

// ---- 4) Connectors（独立库/对象根/配置文件） ----
const cDb = connectorsCfg.pg?.database ?? 'cnext_zloop';
const dbExists = await run('docker', ['exec', DB_CONTAINER, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${cDb}'`]);
if (dbExists.stdout.trim() !== '1') {
  const created = await run('docker', ['exec', DB_CONTAINER, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${cDb}`]);
  if (created.err) fail(`创建 Connectors 库失败: ${created.stderr.slice(0, 160)}`);
  ok(`Connectors 独立库 ${cDb} 已创建`);
}
const { randomBytes, randomInt } = await import('node:crypto');
const genAlnum = (n) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[randomInt(62)]).join('');
const signingSecret = randomBytes(32).toString('hex');
const serviceToken = randomBytes(32).toString('hex');
const encodingAESKey = genAlnum(43);
const connectorsTokenFile = path.join(RUN_DIR, 'connectors-token.txt');
writeFileSync(connectorsTokenFile, serviceToken);
const objectRoot = path.join(CONNECTORS_ROOT, '.run', 'objects-zloop');
mkdirSync(objectRoot, { recursive: true });
const connectorsRuntime = {
  _synthetic: `zcode-real-loop 合成验收配置：zloop-up 生成于 ${new Date().toISOString()}；allowRealWecom 恒 false`,
  port: CONNECTORS_PORT,
  defaultTenantId: connectorsCfg.tenantId ?? cfg.tenantId,
  pg: { host: '127.0.0.1', port: DB_PORT, user: cfg.dbUser, password: cfg.dbPassword, database: cDb },
  objectRoot,
  signingSecret,
  serviceToken,
  wecom: { allowRealWecom: false, corpid: 'zloop-synthetic-corpid', callbackToken: connectorsCfg.wecom?.callbackToken ?? genAlnum(32), encodingAESKey },
  trtc: { callbackKey: signingSecret },
  a: {
    baseUrl: `http://127.0.0.1:${KERNEL_PORT}`,
    credential: connectorsCfg.a.credentials.registrar,
    tenantId: connectorsCfg.tenantId ?? cfg.tenantId,
    bridge: true,
    credentials: connectorsCfg.a.credentials,
    customerLinks: connectorsCfg.customerLinks ?? {},
    timeoutMs: 5000,
  },
  processing: {
    driverIntervalMs: 1500,
    outboundPolicy: 'suggest_only',
    aCustomerLinks: connectorsCfg.customerLinks ?? {},
    rulePackPath: path.join(BACK_ROOT, 'C', 'rules', 'takeoff-first-admission-rule-pack-v1.json'),
    aRegisterDomains: ['business', 'policy', 'credit', 'commerce', 'asset'],
  },
};
const connectorsCfgPath = path.join(CONNECTORS_ROOT, '.run', 'config.zloop.json');
writeFileSync(connectorsCfgPath, JSON.stringify(connectorsRuntime, null, 2));
const cMarker = `jw-zloop-conn-${Date.now().toString(36)}`;
const cLogFd = openSync(path.join(RUN_DIR, 'connectors.log'), 'w');
const connectorsChild = spawn(process.execPath, [path.join(CONNECTORS_ROOT, 'scripts', 'start-connectors.mjs'), '--delivery-marker', cMarker],
  { cwd: CONNECTORS_ROOT, windowsHide: true, detached: true, stdio: ['ignore', cLogFd, cLogFd], env: { ...process.env, CONNECTORS_CONFIG: connectorsCfgPath } });
connectorsChild.unref();
let cReady = false;
const cDeadline = Date.now() + 60000;
while (Date.now() < cDeadline && !cReady) {
  try {
    const r = await fetch(`http://127.0.0.1:${CONNECTORS_PORT}/healthz`, { signal: AbortSignal.timeout(1500) });
    if (r.status === 200) { const j = await r.json(); cReady = j?.ok === true && j?.service === 'jw-connectors'; }
  } catch { }
  if (!cReady) await sleep(600);
}
if (!cReady) { console.error(`[zloop-up] Connectors 未就绪（日志 ${path.join(RUN_DIR, 'connectors.log')}）`); process.exit(2); }
writeFileSync(path.join(RUN_DIR, 'connectors.pid'), JSON.stringify({ pid: connectorsChild.pid, marker: cMarker, port: CONNECTORS_PORT, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), service: 'jw-connectors' }));
ok(`Connectors 运行中 pid=${connectorsChild.pid} port=${CONNECTORS_PORT}（A bridge→${KERNEL_PORT}）`);

// ---- 5) Edge 身份目录 + Edge --live（模型 profile registry 接线） ----
const authPath = path.join(RUN_DIR, 'edge-auth.json');
if (Array.isArray(cfg.authEntries) && cfg.authEntries.length > 0) {
  writeFileSync(authPath, JSON.stringify({ entries: cfg.authEntries.map((e) => ({ ...e, tenantId: cfg.tenantId })) }, null, 2));
  ok(`Edge 身份目录已写入（${cfg.authEntries.length} 条合成身份）`);
} else fail('zloop-runtime.json 缺 authEntries：Edge 会话将失败关闭');
const edgeStart = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
  '--port', String(EDGE_PORT), '--live', '--kernel-port', String(KERNEL_PORT), '--db-port', String(DB_PORT),
  '--auth-file', authPath, '--marker', `jw-zloop-edge-${aMarker.slice(-8)}`, '--run-dir', RUN_DIR,
  '--connectors-url', `http://127.0.0.1:${CONNECTORS_PORT}`, '--connectors-token-file', connectorsTokenFile,
  '--connectors-tenant', String(connectorsCfg.tenantId ?? cfg.tenantId),
  '--messages-file', path.join(RUN_DIR, 'edge-messages.db'),
  '--model-config', path.join(RUN_DIR, cfg.assistantModel.configPath),
  '--model-profiles', path.join(RUN_DIR, cfg.assistantModel.registryPath),
  '--model-receipts-dir', path.join(RUN_DIR, 'model-receipts'),
  '--serve-front', SERVE_FRONT], { timeout: 60000 });
if (edgeStart.err) fail(`Edge 启动失败: ${(edgeStart.stderr || edgeStart.err.message).slice(0, 300)}`);
console.log(edgeStart.stdout.trim());

// ---- 6) 就绪报告 + 资源台账 ----
const ready = await waitHealth(`http://127.0.0.1:${EDGE_PORT}/healthz/ready`, (j) => j.ok === true, 30000);
const vz = await fetch(`http://127.0.0.1:${EDGE_PORT}/versionz`).then((r) => r.json()).catch(() => ({}));
let edgePid = null;
try { edgePid = JSON.parse(readFileSync(path.join(RUN_DIR, 'edge.pid'), 'utf8')).pid; } catch { }
const resources = {
  generatedAt: new Date().toISOString(), owner: OWNER, runDir: path.relative(REPO_ROOT, RUN_DIR),
  fullChainIntent: 'PG(jw-zloop-pg) + A 内核 + Connectors + Edge(--serve-front Front/dist + 模型 glm-5.2 real)',
  instances: [
    { name: DB_CONTAINER, kind: 'postgres-container', port: DB_PORT, volume: DB_VOLUME, owner: OWNER },
    { name: 'a-kernel', kind: 'process', port: KERNEL_PORT, pid: aChild.pid, marker: aMarker, log: '.run/zloop/kernel.log', owner: OWNER },
    { name: 'connectors', kind: 'process', port: CONNECTORS_PORT, pid: connectorsChild.pid, marker: cMarker, log: '.run/zloop/connectors.log', config: 'Back/Connectors/.run/config.zloop.json', db: cDb, owner: OWNER },
    { name: 'edge', kind: 'process', port: EDGE_PORT, pid: edgePid, log: '.run/zloop/edge-daemon.log', messages: '.run/zloop/edge-messages.db', owner: OWNER },
  ],
};
writeFileSync(path.join(RUN_DIR, 'resources.json'), JSON.stringify(resources, null, 2));
console.log('──────────────────────────────────────────────');
console.log(`[zloop-up] 就绪：${ready ? '是' : '否（查 /healthz/ready 逐依赖原因）'}`);
console.log(`  主入口 : http://127.0.0.1:${EDGE_PORT}/  ← Front/dist（同源）`);
console.log(`  A      : http://127.0.0.1:${KERNEL_PORT}/healthz`);
console.log(`  Conn   : http://127.0.0.1:${CONNECTORS_PORT}/healthz`);
console.log(`  停止   : node Back/Edge/scripts/zloop-down.mjs（--with-db 停容器）`);
console.log(`  能力位 : ${JSON.stringify(vz.capabilities ?? {})}`);
console.log('──────────────────────────────────────────────');
if (!ready) process.exit(3);
