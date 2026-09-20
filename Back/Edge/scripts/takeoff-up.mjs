// TAKEOFF-FA-1.0.0 路04 装配编排（与 delivery-up 同纪律的本轮独立形态）：
//   预检 → 独立 PG 容器 jw-takeoff-pg（本路登记资源：不存在则创建并打 owner 标签；
//   已存在但非本路 → 拒绝）→ A 内核迁移+启动 → 合成矩阵/必需域政策/本轮种子幂等播种 →
//   Connectors（常驻处理驱动+对象存储+A bridge）→ Edge --live（同源托管 Front/dist）→
//   就绪报告 + 资源台账（owner=takeoff-fa-04）。
// 纪律（与 delivery-up 一致，含本路收紧）：
//   - 不抢占端口（被占即 fail 报告归属核实路径）、不杀未知进程；
//   - 默认端口段为本轮专用：A 48194 / Connectors 48114 / Edge 48214 / PG 15446，
//     与旧 delivery 栈（48180/48100/48200/48210/15442）及孤儿实例完全隔离；
//   - 身份目录/令牌来自被 Git 排除的 config/takeoff-runtime.json（示例见 .example，
//     全部合成值并显式标注），缺配置失败关闭；
//   - 停止一律 takeoff-down.mjs 多证复核；--with-db 只停容器，数据卷永不动。
// A/Connectors 启动参数以 01/03 路冻结交付为准微调：cfg.a.extraArgs / cfg.connectors.extraArgs
// 透传，不改脚本本体。
// 用法：node scripts/takeoff-up.mjs [--config config/takeoff-runtime.json] [--serve-front Front/dist]
//           [--db-container jw-takeoff-pg] [--db-port 15446] [--kernel-port 48194]
//           [--connectors-port 48114] [--edge-port 48214] [--without-connectors]
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, openSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const CONNECTORS_ROOT = path.join(BACK_ROOT, 'Connectors');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'takeoff');
const DB_CONTAINER = 'jw-takeoff-pg';
const DB_PORT = 15446;
const KERNEL_PORT = 48194;
const CONNECTORS_PORT = 48114;
const EDGE_PORT = 48214;
const OWNER = 'takeoff-fa-04（TAKEOFF-FA-1.0.0 路04）';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function portBusy(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

const fail = (msg) => { console.error(`[takeoff-up] ✗ ${msg}`); process.exit(2); };
const ok = (msg) => console.log(`[takeoff-up] ✓ ${msg}`);

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const dbPort = Number(argOf('--db-port', process.env.JW_TAKEOFF_PG_PORT ?? DB_PORT));
const kernelPort = Number(argOf('--kernel-port', process.env.JW_TAKEOFF_A_PORT ?? KERNEL_PORT));
const edgePort = Number(argOf('--edge-port', process.env.JW_TAKEOFF_EDGE_PORT ?? EDGE_PORT));
const connectorsPort = Number(argOf('--connectors-port', process.env.JW_TAKEOFF_CONNECTORS_PORT ?? CONNECTORS_PORT));
const withoutConnectors = argv.includes('--without-connectors');
const dbContainer = argOf('--db-container', process.env.JW_TAKEOFF_PG_CONTAINER ?? DB_CONTAINER);
let serveFront = argOf('--serve-front', 'Front/dist');
if (serveFront && !path.isAbsolute(serveFront)) serveFront = path.join(REPO_ROOT, serveFront); // Edge 守护 cwd 非 repo 根：必须绝对路径

// ---- 0) 运行时配置（Git 排除；fail-closed；全部合成值并显式标注） ----
const cfgPath = path.resolve(EDGE_ROOT, (() => {
  const i = argv.indexOf('--config');
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : path.join('config', 'takeoff-runtime.json');
})());
if (!existsSync(cfgPath)) {
  fail(`缺少 ${path.relative(REPO_ROOT, cfgPath)}（复制 .example；principalTokens/authEntries 必须一致且为合成值）`);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['principalTokens', 'creditMatrix', 'creditConcentration', 'dbUser', 'dbPassword', 'dbName']) {
  if (typeof cfg[k] !== 'string' || cfg[k].length === 0) fail(`takeoff-runtime.json 缺字段 ${k}`);
}
if (cfg._synthetic !== true) fail('takeoff-runtime.json 必须显式声明 "_synthetic": true（合成配置标注；防止误当公司制度）');
let connectorsCfg = null;
if (!withoutConnectors) {
  connectorsCfg = cfg.connectors ?? null;
  if (!connectorsCfg || typeof connectorsCfg !== 'object') {
    fail('takeoff-runtime.json 缺 connectors 段。复制 takeoff-runtime.example.json；确要跳过请显式 --without-connectors（全链就绪结论降级 NOT_RUN）');
  }
  if (!connectorsCfg.wecom?.callbackToken) fail('connectors.wecom.callbackToken 必填（合成验收值；不启用真实出站）');
}

// ---- 1) 预检 ----
if (!process.version.startsWith('v22.')) fail(`需要 Node 22.x，当前 ${process.version}`);
const docker = await run('docker', ['ps'], 20000);
if (docker.err) fail('docker 不可达（真实 PG 需要）；先启动 Docker Desktop 再运行本脚本');
if (serveFront && !existsSync(path.join(serveFront, 'index.html'))) {
  fail(`同源前端构建缺失：${serveFront}/index.html 不存在（02路交付后 Front/ npm run build）`);
}
ok('预检：node/docker 就绪' + (serveFront ? '；dist 就绪' : '；--serve-front 未启用'));

// ---- 2) 独立 PG：本路登记资源，不存在则创建（带 owner 标签）；存在非本路 → 拒绝 ----
const psA = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}', '--filter', `name=^${dbContainer}$`]);
if (psA.err) fail(`docker ps 失败: ${psA.stderr.slice(0, 120)}`);
if (!psA.stdout.includes(dbContainer)) {
  const portFree = !(await (async () => {
    const psPort = await run('docker', ['ps', '--format', '{{.Ports}}', '--filter', `publish=${dbPort}`]);
    return Boolean(psPort.stdout.trim());
  })());
  if (!portFree) fail(`宿主端口 ${dbPort} 已被其他容器/进程占用：换 --db-port，不抢占`);
  const createR = await run('docker', ['run', '-d', '--name', dbContainer,
    '-p', `127.0.0.1:${dbPort}:5432`,
    '-v', 'jw_takeoff_pgdata:/var/lib/postgresql/data',
    '--label', `owner=${OWNER}`,
    '-e', `POSTGRES_USER=${cfg.dbUser}`, '-e', `POSTGRES_PASSWORD=${cfg.dbPassword}`, '-e', `POSTGRES_DB=${cfg.dbName}`,
    'postgres:16']);
  if (createR.err) fail(`创建容器 ${dbContainer} 失败: ${createR.stderr.slice(0, 160)}`);
  ok(`容器 ${dbContainer}@${dbPort} 已创建（本路登记资源；owner 标签=${OWNER}；数据卷 jw_takeoff_pgdata）`);
} else {
  const lbl = await run('docker', ['inspect', '--format', '{{index .Config.Labels "owner"}}', dbContainer]);
  if (lbl.err || String(lbl.stdout).trim() !== OWNER) {
    fail(`容器 ${dbContainer} 已存在且无本路 owner 标签（inspect=${String(lbl.stdout).trim() || '无'}）：非本路资源，拒绝使用`);
  }
  ok(`容器 ${dbContainer} 已存在且属本路（owner 标签相符）`);
}
if (!psA.stdout.includes('Up')) {
  const startR = await run('docker', ['start', dbContainer]);
  if (startR.err) fail(`启动 ${dbContainer} 失败: ${startR.stderr.slice(0, 120)}`);
  ok(`容器 ${dbContainer} 已启动（数据卷原样保留）`);
}
const pgReady = await (async () => {
  for (let i = 0; i < 30; i++) {
    const r = await run('docker', ['exec', dbContainer, 'pg_isready', '-U', cfg.dbUser, '-d', cfg.dbName]);
    if (!r.err) return true;
    await new Promise((x) => setTimeout(x, 800));
  }
  return false;
})();
if (!pgReady) fail('PG 未就绪（pg_isready 超时）');
ok('PG 就绪');

// ---- 3) 端口所有权（占用即停，不抢占；逐一给出归属核实提示） ----
if (await portBusy('127.0.0.1', kernelPort)) fail(`端口 ${kernelPort} 已被占用：先用 netstat -ano 核实归属；非本路资源不抢`);
if (await portBusy('127.0.0.1', edgePort)) fail(`端口 ${edgePort} 已被占用：可能已有 Edge 在跑；非本路资源不抢`);
if (connectorsCfg && await portBusy('127.0.0.1', connectorsPort)) fail(`端口 ${connectorsPort} 已被占用：非本路资源不抢`);

// ---- 4) 迁移（A 路唯一 writer 的 migrate-cli；经 V7NEXT_A_DB_URL 指库） ----
const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${dbPort}/${cfg.dbName}`;
const mig = await new Promise((resolve) => {
  execFile(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'db', 'migrate-cli.ts')], {
    windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, V7NEXT_A_DB_URL: dsn },
  }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
if (mig.err) fail(`迁移失败: ${(mig.stderr || mig.err.message || '').slice(0, 300)}`);
ok(`数据库迁移已应用（A 迁移簿记：${mig.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '完成'}）`);

// ---- 5) 合成矩阵 / 必需域政策 / 本轮 TAKEOFF 种子（全部幂等 SQL，须显式声明合成） ----
const seedSql = async (label, sql) => {
  const r = await run('docker', ['exec', dbContainer, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (r.err) fail(`${label} 播种失败: ${r.stderr.slice(0, 200)}`);
  ok(`${label} 播种完成（幂等）`);
};
if (typeof cfg.matrixSeedSql === 'string' && cfg.matrixSeedSql.length > 0) {
  await seedSql('权限矩阵（合成开发矩阵）', cfg.matrixSeedSql);
} else {
  console.log('[takeoff-up] i 未提供 matrixSeedSql：正式动作 POLICY_PENDING fail-closed');
}
const policyCfg = cfg.requiredDomainsPolicy ?? null;
if (policyCfg) {
  if (typeof policyCfg.version !== 'string' || !/^[a-z0-9-]{3,64}$/i.test(policyCfg.version)) fail('requiredDomainsPolicy.version 非法');
  if (typeof policyCfg.seedSql !== 'string' || !policyCfg.seedSql.includes('domain_requirement_policies')) fail('requiredDomainsPolicy.seedSql 必填且目标表须为 domain_requirement_policies');
  if (typeof policyCfg.annotation !== 'string' || !/非公司制度|经公司批准/.test(policyCfg.annotation)) {
    fail('requiredDomainsPolicy.annotation 必须显式标注"非公司制度（演示）"或"经公司批准"');
  }
  await seedSql(`必需域政策 ${policyCfg.version}（${policyCfg.annotation}）`, policyCfg.seedSql);
}
if (cfg.takeoffSeedSql) {
  if (typeof cfg.takeoffSeedSql !== 'string' || cfg.takeoffSeedSql.length === 0) fail('takeoffSeedSql 非法');
  await seedSql('TAKEOFF 本轮合成种子（受控合成规则/目录；非公司制度）', cfg.takeoffSeedSql);
}

// ---- 6) 启动 A 内核（marker+pidfile+heartbeat 由本脚本维护） ----
mkdirSync(RUN_DIR, { recursive: true });
const aMarker = `jw-takeoff-a-${Date.now().toString(36)}`;
const aPidFile = path.join(RUN_DIR, 'kernel.pid');
const aLogFd = openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
const aExtra = Array.isArray(cfg.a?.extraArgs) ? cfg.a.extraArgs.map(String) : [];
const aChild = spawn(process.execPath, [
  path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(kernelPort), '--db', dsn,
  '--principal-tokens', cfg.principalTokens, '--credit-matrix', cfg.creditMatrix, '--credit-concentration', cfg.creditConcentration,
  ...(policyCfg ? ['--required-domains-policy', policyCfg.version] : []),
  ...aExtra,
  '--delivery-marker', aMarker,
], { windowsHide: true, stdio: ['ignore', aLogFd, aLogFd] });
aChild.unref();
const waitHealth = async (url, extra, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.status === 200) {
        const j = await r.json();
        if (!extra || extra(j)) return true;
      }
    } catch { }
    await new Promise((x) => setTimeout(x, 600));
  }
  return false;
};
if (!await waitHealth(`http://127.0.0.1:${kernelPort}/healthz`, (j) => j.db === 'up')) {
  console.error(`[takeoff-up] A 内核未就绪（日志 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'kernel.log'))}）。进程保留供排障，停止用 takeoff-down。`);
  process.exit(2);
}
const nowIso = new Date().toISOString();
writeFileSync(aPidFile, JSON.stringify({ pid: aChild.pid, marker: aMarker, port: kernelPort, startedAt: nowIso, heartbeatAt: nowIso }));
ok(`A 内核运行中 pid=${aChild.pid} port=${kernelPort} marker=${aMarker.slice(0, 14)}…`);

// ---- 6.5) Connectors（同 delivery-up 流程；运行配置写入 .run/config.takeoff.json，不覆盖他人配置） ----
let connectorsChild = null;
const connectorsPidFile = path.join(RUN_DIR, 'connectors.pid');
let connectorsTokenFile = null;
let connectorsDbName = null;
if (connectorsCfg) {
  const cDb = typeof connectorsCfg.pg?.database === 'string' && connectorsCfg.pg.database ? connectorsCfg.pg.database : 'cnext_takeoff';
  if (!/^[a-z_][a-z0-9_]*$/i.test(cDb)) fail(`connectors.pg.database 非法：${cDb}`);
  const dbExists = await run('docker', ['exec', dbContainer, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${cDb}'`]);
  if (dbExists.err) fail(`检查 Connectors 库失败: ${dbExists.stderr.slice(0, 160)}`);
  if (dbExists.stdout.trim() !== '1') {
    const created = await run('docker', ['exec', dbContainer, 'psql', '-U', cfg.dbUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${cDb}`]);
    if (created.err) fail(`创建 Connectors 库 ${cDb} 失败: ${created.stderr.slice(0, 160)}`);
    ok(`Connectors 独立库 ${cDb} 已创建（实例 ${dbContainer}；与 A 业务库隔离）`);
  } else {
    ok(`Connectors 独立库 ${cDb} 已存在（数据原样保留）`);
  }
  connectorsDbName = cDb;

  const { randomBytes, randomInt } = await import('node:crypto');
  const genAlnum = (n) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[randomInt(62)]).join('');
  const signingSecret = typeof connectorsCfg.signingSecret === 'string' && connectorsCfg.signingSecret ? connectorsCfg.signingSecret : randomBytes(32).toString('hex');
  const serviceToken = typeof connectorsCfg.serviceToken === 'string' && connectorsCfg.serviceToken ? connectorsCfg.serviceToken : randomBytes(32).toString('hex');
  const encodingAESKey = typeof connectorsCfg.wecom.encodingAESKey === 'string' && connectorsCfg.wecom.encodingAESKey ? connectorsCfg.wecom.encodingAESKey : genAlnum(43);
  if (encodingAESKey.length !== 43) fail(`connectors.wecom.encodingAESKey 必须 43 字符（当前 ${encodingAESKey.length}）`);
  connectorsTokenFile = path.join(RUN_DIR, 'connectors-token.txt');
  writeFileSync(connectorsTokenFile, serviceToken);

  if (!connectorsCfg.a?.credentials || typeof connectorsCfg.a.credentials !== 'object') {
    fail('connectors.a.credentials 必填（service/registrar 合成令牌，须与 A --principal-tokens 一致）');
  }
  mkdirSync(path.join(CONNECTORS_ROOT, '.run'), { recursive: true });
  const objectRoot = typeof connectorsCfg.objectRoot === 'string' && connectorsCfg.objectRoot ? connectorsCfg.objectRoot : path.join(CONNECTORS_ROOT, '.run', 'objects-takeoff');
  mkdirSync(objectRoot, { recursive: true });
  const tenantId = typeof connectorsCfg.tenantId === 'string' && connectorsCfg.tenantId ? connectorsCfg.tenantId : 'tenant_takeoff';
  const connectorsRuntime = {
    _synthetic: `TAKEOFF-FA-1.0.0 路04 合成验收配置：takeoff-up 生成于 ${new Date().toISOString()}；真实凭据不入 Git；allowRealWecom 恒 false`,
    port: connectorsPort,
    defaultTenantId: tenantId,
    pg: { host: '127.0.0.1', port: dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cDb },
    objectRoot,
    signingSecret,
    serviceToken,
    wecom: { allowRealWecom: false, corpid: 'takeoff-synthetic-corpid', callbackToken: connectorsCfg.wecom.callbackToken, encodingAESKey },
    trtc: { callbackKey: signingSecret },
    a: {
      baseUrl: `http://127.0.0.1:${kernelPort}`,
      credential: connectorsCfg.a.credentials.registrar,
      tenantId,
      bridge: connectorsCfg.a?.bridge === false ? false : true,
      credentials: connectorsCfg.a.credentials,
      customerLinks: connectorsCfg.customerLinks ?? {},
      timeoutMs: connectorsCfg.a?.timeoutMs ?? 5000,
    },
    processing: {
      driverIntervalMs: connectorsCfg.driverIntervalMs ?? 2000,
      outboundPolicy: connectorsCfg.outboundPolicy ?? 'suggest_only',
      aCustomerLinks: connectorsCfg.customerLinks ?? {},
      // 03路 PROTOCOL v1.1：TAKEOFF 五域合成规则包启用入口（compose.mjs processing.rulePackPath）。
      rulePackPath: connectorsCfg.rulePackPath
        ?? path.join(BACK_ROOT, 'C', 'rules', 'takeoff-first-admission-rule-pack-v1.json'),
      // A 域注册白名单：01路已扩五域枚举（OBS-03-01 关闭，迁移 013）；配置含 business 即全量注册。
      ...(Array.isArray(connectorsCfg.aRegisterDomains) ? { aRegisterDomains: connectorsCfg.aRegisterDomains.map(String) } : {}),
    },
  };
  const connectorsCfgPath = path.join(CONNECTORS_ROOT, '.run', 'config.takeoff.json');
  writeFileSync(connectorsCfgPath, JSON.stringify(connectorsRuntime, null, 2));

  const cMarker = `jw-takeoff-conn-${Date.now().toString(36)}`;
  const cLogFd = openSync(path.join(RUN_DIR, 'connectors.log'), 'w');
  connectorsChild = spawn(process.execPath, [
    path.join(CONNECTORS_ROOT, 'scripts', 'start-connectors.mjs'), '--delivery-marker', cMarker,
  ], { cwd: CONNECTORS_ROOT, windowsHide: true, stdio: ['ignore', cLogFd, cLogFd], env: { ...process.env, CONNECTORS_CONFIG: connectorsCfgPath } });
  connectorsChild.unref();
  const cReady = await (async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${connectorsPort}/healthz`, { signal: AbortSignal.timeout(1500) });
        if (r.status === 200) { const j = await r.json(); if (j?.ok === true && j?.service === 'jw-connectors') return true; }
      } catch { }
      await new Promise((x) => setTimeout(x, 600));
    }
    return false;
  })();
  if (!cReady) {
    console.error(`[takeoff-up] Connectors 未就绪（日志 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'connectors.log'))}）。进程保留供排障，停止用 takeoff-down。`);
    process.exit(2);
  }
  writeFileSync(connectorsPidFile, JSON.stringify({ pid: connectorsChild.pid, marker: cMarker, port: connectorsPort, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), service: 'jw-connectors' }));
  ok(`Connectors 运行中 pid=${connectorsChild.pid} port=${connectorsPort}（常驻处理驱动+对象存储+A bridge→${connectorsRuntime.a.baseUrl}）`);
} else {
  console.log('[takeoff-up] i --without-connectors：处理通道未启动（全链就绪结论降级 NOT_RUN，不冒充完整启动）');
}

// heartbeat 维护 + 前台监督（Ctrl+C = takeoff-down）
const managedChildren = [{ pid: aChild.pid, pidFile: aPidFile }];
if (connectorsChild) managedChildren.push({ pid: connectorsChild.pid, pidFile: connectorsPidFile });
const hbTimer = setInterval(() => {
  for (const c of managedChildren) {
    let childAlive = true;
    try { process.kill(c.pid, 0); } catch { childAlive = false; }
    if (!childAlive) continue;
    try {
      const j = JSON.parse(readFileSync(c.pidFile, 'utf8'));
      j.heartbeatAt = new Date().toISOString();
      writeFileSync(c.pidFile, JSON.stringify(j));
    } catch { }
  }
}, 5000);

// ---- 7) Edge（--live + 本轮身份目录 + 消息持久库 + 同源前端） ----
const authPath = path.join(RUN_DIR, 'edge-auth.json');
if (Array.isArray(cfg.authEntries) && cfg.authEntries.length > 0) {
  // 每条身份补 tenantId=装配租户（Edge 会话透出；前端命令帧 tenantId 以此为准，不再硬编码）
  const authEntries = cfg.authEntries.map((e) => ({ ...e, tenantId: cfg.tenantId }));
  writeFileSync(authPath, JSON.stringify({ entries: authEntries }, null, 2));
  ok(`Edge 身份目录已写入 ${path.relative(REPO_ROOT, authPath)}（${cfg.authEntries.length} 条合成身份；服务端内存使用）`);
} else {
  console.log('[takeoff-up] i takeoff-runtime.json 未提供 authEntries：Edge 会话交换失败关闭');
  if (existsSync(authPath)) {
    try { rmSync(authPath, { force: true }); } catch { }
  }
}
const edgeStart = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
  '--port', String(edgePort), '--live', '--kernel-port', String(kernelPort), '--db-port', String(dbPort),
  '--auth-file', authPath, '--marker', `jw-takeoff-edge-${aMarker.slice(-8)}`,
  '--run-dir', RUN_DIR,
  ...(connectorsCfg && connectorsTokenFile
    ? ['--connectors-url', `http://127.0.0.1:${connectorsPort}`, '--connectors-token-file', connectorsTokenFile,
      '--connectors-tenant', String(connectorsCfg.tenantId ?? 'tenant_takeoff')]
    : []),
  '--messages-file', path.join(RUN_DIR, 'edge-messages.db'),
  // TAKEOFF（2026-09-20）：助手真实模型入口（可选）。takeoff-runtime.json 提供
  // assistantModel.configPath（Git 排除、形状同 Back/B/config/b-config.json 的 transport/budget
  // 段）时才接线；未提供 → 入口 503 not_configured（如实，不冒充已接通）。
    ...(typeof cfg.assistantModel?.registryPath === 'string' && cfg.assistantModel.registryPath.length > 0
      ? ['--model-profiles', path.resolve(EDGE_ROOT, cfg.assistantModel.registryPath), '--model-receipts-dir', path.join(RUN_DIR, 'model-receipts')]
      : typeof cfg.assistantModel?.configPath === 'string' && cfg.assistantModel.configPath.length > 0
    ? ['--model-config', (path.isAbsolute(cfg.assistantModel.configPath)
      ? cfg.assistantModel.configPath
      : path.resolve(EDGE_ROOT, cfg.assistantModel.configPath)),
    '--model-receipts-dir', path.join(RUN_DIR, 'model-receipts')]
    : []),
  ...(serveFront ? ['--serve-front', serveFront] : [])], { timeout: 60000 });
if (edgeStart.err) fail(`Edge 启动失败: ${(edgeStart.stderr || edgeStart.err.message).slice(0, 300)}`);
console.log(edgeStart.stdout.trim());
ok('Edge（live 投影）已启动');

// ---- 8) 就绪报告 + 资源台账 + 前台监督 ----
const ready = await waitHealth(`http://127.0.0.1:${edgePort}/healthz/ready`, (j) => j.ok === true, 30000);
const vz = await fetch(`http://127.0.0.1:${edgePort}/versionz`).then((r) => r.json()).catch(() => ({}));

let edgePid = null;
try { edgePid = JSON.parse(readFileSync(path.join(RUN_DIR, 'edge.pid'), 'utf8')).pid; } catch { }
const resources = {
  generatedAt: new Date().toISOString(),
  owner: OWNER,
  round: 'TAKEOFF-FA-1.0.0 路04（Edge装配/集中清理/全流程验收）',
  runDir: path.relative(REPO_ROOT, RUN_DIR),
  fullChainIntent: connectorsCfg ? 'PG + A 内核 + Connectors + Edge(--serve-front Front/dist)' : 'PG + A 内核 + Edge（--without-connectors：处理通道 NOT_RUN）',
  instances: [
    { name: dbContainer, kind: 'postgres-container', port: dbPort, volume: 'jw_takeoff_pgdata', owner: OWNER, note: '本路创建登记；takeoff-down --with-db 只停容器不删卷' },
    { name: 'a-kernel', kind: 'process', port: kernelPort, pid: aChild.pid, marker: aMarker, log: '.run/takeoff/kernel.log', owner: OWNER },
    ...(connectorsChild ? [{
      name: 'connectors', kind: 'process', port: connectorsPort, pid: connectorsChild.pid, log: '.run/takeoff/connectors.log',
      config: 'Back/Connectors/.run/config.takeoff.json', objects: 'Back/Connectors/.run/objects-takeoff', db: connectorsDbName, owner: OWNER,
    }] : []),
    { name: 'edge', kind: 'process', port: edgePort, pid: edgePid, log: '.run/takeoff/edge-daemon.log', messages: '.run/takeoff/edge-messages.db', owner: OWNER },
  ],
};
writeFileSync(path.join(RUN_DIR, 'resources.json'), JSON.stringify(resources, null, 2));
ok(`资源台账已写入 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'resources.json'))}`);

console.log('──────────────────────────────────────────────');
console.log(`[takeoff-up] 就绪：${ready ? '是' : '否（查看 Edge /healthz/ready 逐依赖原因）'}`);
if (serveFront) console.log(`  主入口     : http://127.0.0.1:${edgePort}/  ← ${serveFront}（同源托管）`);
console.log(`  Edge       : http://127.0.0.1:${edgePort}/  (build ${vz.buildId ?? '?'})`);
console.log(`  A 内核     : http://127.0.0.1:${kernelPort}/healthz`);
if (connectorsChild) console.log(`  Connectors : http://127.0.0.1:${connectorsPort}/healthz`);
console.log(`  停止       : 本窗口 Ctrl+C；或另开窗口 node scripts/takeoff-down.mjs`);
console.log(`  能力位     : ${JSON.stringify(vz.capabilities ?? {})}`);
console.log('──────────────────────────────────────────────');
if (!ready) process.exit(3);

const { execFile: execFileCb } = await import('node:child_process');
const shutdown = () => {
  console.log('\n[takeoff-up] 收到停止信号：执行 takeoff-down（多证复核）…');
  hbTimer.unref?.();
  execFileCb(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'takeoff-down.mjs')], { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
    console.log(String(stdout || '') + String(stderr || ''));
    if (err) console.error(`[takeoff-up] takeoff-down 异常: ${err.message}`);
    process.exit(err ? 1 : 0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
console.log('[takeoff-up] 监督进程运行中：保持本窗口开启；Ctrl+C 停止 Edge+Connectors+A。');
