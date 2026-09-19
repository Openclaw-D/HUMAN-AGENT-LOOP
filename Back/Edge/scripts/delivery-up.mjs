// 任务三 C4·受控交付启动编排：预检 → 独立 PG（已登记容器，只 start 不 create）→
// A 内核迁移+启动（合成政策位，显式参数）→ 权限矩阵幂等播种 → Connectors（常驻处理驱动 +
// 对象存储 + A bridge；任务04 §三补齐）→ Edge --live（含处理通道透传与消息持久库）→ 就绪报告。
// 纪律：
//   - 不抢占端口、不杀未知进程、不创建容器（容器建立见 Back/START.md，人工一次性动作；
//     Connectors 库为同实例独立 database，由本脚本幂等创建并记录归属）；
//   - A/Connectors/Edge 都带启动标识（marker+pidfile+heartbeat）；停止一律用 delivery-down.mjs
//     三证+命令行复核，覆盖新纳入的 Connectors；
//   - 身份目录/令牌来自被 Git 排除的 config/delivery-runtime.json（示例见 .example），
//     本脚本不内嵌任何真实凭据；缺配置即失败关闭。Connectors 合成运行配置写入
//     Connectors/.run/config.delivery.json（CONNECTORS_CONFIG 指向，绝不覆盖既有 .run/config.json）。
//   - B 执行器不常驻：当前页面旅程的目标执行均由人类角色经 Edge 完成、材料处理由 Connectors
//     驱动承担，无 agent 执行器消费面（判定依据见 task-04 TEST_RESULTS；不多开重复执行器）。
// 用法：node scripts/delivery-up.mjs [--skip-frontend-hint] [--db-port 15442] [--kernel-port 48180] [--edge-port 48200] [--db-container jw-v01-pg] [--serve-front <dir>] [--without-connectors]
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const CONNECTORS_ROOT = path.join(BACK_ROOT, 'Connectors');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'delivery');
const DB_CONTAINER = 'jw-v01-pg';
const DB_PORT = 15442;
const KERNEL_PORT = 48180;
const CONNECTORS_PORT = 48100;
const EDGE_PORT = 48200;

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

const fail = (msg) => { console.error(`[delivery-up] ✗ ${msg}`); process.exit(2); };
const ok = (msg) => console.log(`[delivery-up] ✓ ${msg}`);

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const dbPort = Number(argOf('--db-port', process.env.JW_PG_PORT ?? DB_PORT));
const kernelPort = Number(argOf('--kernel-port', process.env.JW_A_PORT ?? KERNEL_PORT));
const edgePort = Number(argOf('--edge-port', process.env.JW_EDGE_PORT ?? EDGE_PORT));
const connectorsPort = Number(argOf('--connectors-port', process.env.JW_CONNECTORS_PORT ?? CONNECTORS_PORT));
// 任务四 §三：完整启动必需 Connectors；显式豁免时全链就绪结论如实降级（NOT_RUN，不冒充 PASS）。
const withoutConnectors = argv.includes('--without-connectors');
// 任务四 D2：支持本轮专用容器（默认 jw-v01-pg 不变，向后兼容）；容器本体仍须按 START.md 一次性人工创建
const dbContainer = argOf('--db-container', process.env.JW_PG_CONTAINER ?? DB_CONTAINER);
// 任务四 D3：--serve-front <dir> 透传给 edge-start（同源托管前端构建产物；goal-03 C3 交付形态）。
// 省略时维持旧行为：前端用独立预览壳（start-preview.mjs，backendConnected:false 的本地模拟）。
const serveFront = argOf('--serve-front', null);

// ---- 0) 运行时配置（Git 排除；fail-closed）。--config 可指向独立验收配置（如
//         config/delivery-runtime.acceptance.json，合成值、明确标注），路径相对 Edge 根；默认仍为
//         config/delivery-runtime.json。
const cfgPath = path.resolve(EDGE_ROOT, (() => {
  const i = argv.indexOf('--config');
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : path.join('config', 'delivery-runtime.json');
})());
if (!existsSync(cfgPath)) {
  fail(`缺少 ${path.relative(REPO_ROOT, cfgPath)}（复制 .example 并填入与 A 内核 --principal-tokens 一致的合成/获准令牌；本脚本不内嵌凭据）`);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['principalTokens', 'creditMatrix', 'creditConcentration', 'dbUser', 'dbPassword', 'dbName']) {
  if (typeof cfg[k] !== 'string' || cfg[k].length === 0) fail(`delivery-runtime.json 缺字段 ${k}`);
}
// 任务04 §三：Connectors 运行段（完整启动必需；--without-connectors 显式豁免并如实降级）。
// signingSecret/serviceToken/encodingAESKey 可省略 → 本脚本随机生成（通道间只经服务端传递；
// 每次重新 up 轮换，验收形态不启用真实企微回调，不受影响）。
let connectorsCfg = null;
if (!withoutConnectors) {
  connectorsCfg = cfg.connectors ?? null;
  if (!connectorsCfg || typeof connectorsCfg !== 'object') {
    fail('delivery-runtime.json 缺 connectors 段（完整启动必需：常驻处理驱动+对象存储+A bridge）。'
      + '复制 delivery-runtime.example.json 的 connectors 段（合成验收值）；确要跳过请显式 --without-connectors（全链就绪结论降级 NOT_RUN）');
  }
  if (!connectorsCfg.wecom?.callbackToken) fail('connectors.wecom.callbackToken 必填（合成验收值即可：企微回调验签本地必需；不启用真实出站）');
}

// ---- 1) 预检 ----
if (!process.version.startsWith('v22.')) fail(`需要 Node 22.x，当前 ${process.version}`);
const docker = await run('docker', ['ps'], 20000);
if (docker.err) fail('docker 不可达（真实 PG 需要）；先启动 Docker Desktop 再运行本脚本');
if (!existsSync(path.join(REPO_ROOT, 'Front', 'dist', 'index.html'))) fail('Front/dist 缺失：先在 Front/ 运行 npm run build');
ok('预检：node/docker/dist 就绪');

// ---- 2) 独立 PG：已登记容器只 start 不 create ----
const psA = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}', '--filter', `name=^${dbContainer}$`]);
if (psA.err || !psA.stdout.includes(dbContainer)) {
  fail(`容器 ${dbContainer} 不存在。请按 Back/START.md 一次性创建（docker run jw-v01-pg ...）；本脚本不代建容器`);
}
if (!psA.stdout.includes('Up')) {
  const startR = await run('docker', ['start', dbContainer]);
  if (startR.err) fail(`启动 ${dbContainer} 失败: ${startR.stderr.slice(0, 120)}`);
  ok(`容器 ${dbContainer} 已启动（数据卷原样保留）`);
} else {
  ok(`容器 ${dbContainer} 已在运行`);
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

// ---- 3) 端口所有权（占用即停，不抢占） ----
if (await portBusy('127.0.0.1', kernelPort)) fail(`端口 ${kernelPort} 已被占用：可能已有 A 内核在跑（先用 delivery-down 或核实归属）`);
if (await portBusy('127.0.0.1', edgePort)) fail(`端口 ${edgePort} 已被占用：可能已有 Edge 在跑（node scripts/edge-stop.mjs 或核实归属）`);

// ---- 4) 迁移（A 路唯一 writer 的 migrate-cli；经 V7NEXT_A_DB_URL 指库，见 Back/START.md） ----
const dsn = `postgres://${cfg.dbUser}:${cfg.dbPassword}@127.0.0.1:${dbPort}/${cfg.dbName}`;
const mig = await new Promise((resolve) => {
  execFile(process.execPath, [path.join(BACK_ROOT, 'A', 'src', 'db', 'migrate-cli.ts')], {
    windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, V7NEXT_A_DB_URL: dsn },
  }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
if (mig.err) fail(`迁移失败: ${(mig.stderr || mig.err.message || '').slice(0, 300)}`);
ok(`数据库迁移已应用（A 迁移簿记：${mig.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '完成'}）`);

// ---- 5) 权限矩阵幂等播种（合成开发矩阵；生产矩阵须公司批准录入） ----
if (cfg.matrixSeedSql && typeof cfg.matrixSeedSql === 'string' && cfg.matrixSeedSql.length > 0) {
  const seed = await run('docker', ['exec', dbContainer, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', cfg.matrixSeedSql]);
  if (seed.err) fail(`矩阵播种失败: ${seed.stderr.slice(0, 200)}`);
  ok('权限矩阵播种完成（配置内 SQL，幂等）');
} else {
  console.log('[delivery-up] i delivery-runtime.json 未提供 matrixSeedSql：正式动作将 POLICY_PENDING fail-closed（如需演示批准流程请配置合成矩阵并标注非公司制度）');
}

// ---- 5.5) 必需域政策受控入口（任务04 收口：决策链 POLICY_PENDING 的唯一合法解除路径）----
// 政策内容属公司制度：仅当运行配置显式声明（annotation 必须标注"非公司制度（演示）"或"经公司批准"）
// 才播种 domain_requirement_policies 并向 A 透传 --required-domains-policy；未声明 → 维持 fail-closed
// （依据包冻结 409 POLICY_PENDING）。本入口只配置"必需域"规则，不 SQL 补业务状态、不伪造 Gate 回执、
// 不预填分析——域结果/Gate 仍只能来自真实处理链登记。
let policyCfg = cfg.requiredDomainsPolicy ?? null;
if (policyCfg) {
  if (typeof policyCfg.version !== 'string' || !/^[a-z0-9-]{3,64}$/i.test(policyCfg.version)) fail('requiredDomainsPolicy.version 非法（3..64 位字母数字-）');
  if (typeof policyCfg.seedSql !== 'string' || !policyCfg.seedSql.includes('domain_requirement_policies')) fail('requiredDomainsPolicy.seedSql 必填且目标表须为 domain_requirement_policies');
  if (typeof policyCfg.annotation !== 'string' || !/非公司制度|经公司批准/.test(policyCfg.annotation)) {
    fail('requiredDomainsPolicy.annotation 必须显式标注"非公司制度（演示）"或"经公司批准"——政策内容属公司制度，无标注不播种');
  }
  const seed = await run('docker', ['exec', dbContainer, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', policyCfg.seedSql]);
  if (seed.err) fail(`必需域政策播种失败: ${seed.stderr.slice(0, 200)}`);
  ok(`必需域政策 ${policyCfg.version} 播种完成（${policyCfg.annotation}）`);
} else {
  console.log('[delivery-up] i 未配置 requiredDomainsPolicy：依据包冻结维持 POLICY_PENDING fail-closed（如需演示决策链请在配置显式声明政策位并标注）');
}

// ---- 6) 启动 A 内核（marker+pidfile+heartbeat 由本脚本维护） ----
mkdirSync(RUN_DIR, { recursive: true });
const aMarker = `jw-delivery-a-${Date.now().toString(36)}`;
const aPidFile = path.join(RUN_DIR, 'kernel.pid');
const aLogFd = (await import('node:fs')).openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
const aChild = spawn(process.execPath, [
  path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(kernelPort), '--db', dsn,
  '--principal-tokens', cfg.principalTokens, '--credit-matrix', cfg.creditMatrix, '--credit-concentration', cfg.creditConcentration,
  ...(policyCfg ? ['--required-domains-policy', policyCfg.version] : []),
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
  console.error(`[delivery-up] A 内核未就绪（日志 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'kernel.log'))}）。进程保留供排障，停止用 delivery-down。`);
  process.exit(2);
}
const nowIso = new Date().toISOString();
writeFileSync(aPidFile, JSON.stringify({ pid: aChild.pid, marker: aMarker, port: kernelPort, startedAt: nowIso, heartbeatAt: nowIso }));
ok(`A 内核运行中 pid=${aChild.pid} port=${kernelPort} marker=${aMarker.slice(0, 12)}…`);

// ---- 6.5) Connectors 常驻处理驱动 + 对象存储 + A bridge（任务04 §三补齐完整启动） ----
let connectorsChild = null;
const connectorsPidFile = path.join(RUN_DIR, 'connectors.pid');
let connectorsTokenFile = null;
let connectorsDbName = null;
if (connectorsCfg) {
  if (await portBusy('127.0.0.1', connectorsPort)) fail(`端口 ${connectorsPort} 已被占用：可能已有 Connectors 在跑（先 delivery-down 或核实归属）`);

  // 独立 database（同 PG 实例；幂等创建；schema 由 Connectors 启动 migrate 自举）。库标识符白名单校验。
  const cDb = typeof connectorsCfg.pg?.database === 'string' && connectorsCfg.pg.database ? connectorsCfg.pg.database : 'cnext';
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

  // 令牌/密钥：cfg 提供则原样；缺省随机生成。encodingAESKey 须为 43 个 [A-Za-z0-9]
  // （Connectors 验签 /^[A-Za-z0-9]{43}$/，base64 解码得 32B）——base64url 的 -/_ 不合其校验。
  const { randomBytes, randomInt } = await import('node:crypto');
  const genAlnum = (n) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[randomInt(62)]).join('');
  const signingSecret = typeof connectorsCfg.signingSecret === 'string' && connectorsCfg.signingSecret ? connectorsCfg.signingSecret : randomBytes(32).toString('hex');
  const serviceToken = typeof connectorsCfg.serviceToken === 'string' && connectorsCfg.serviceToken ? connectorsCfg.serviceToken : randomBytes(32).toString('hex');
  const encodingAESKey = typeof connectorsCfg.wecom.encodingAESKey === 'string' && connectorsCfg.wecom.encodingAESKey ? connectorsCfg.wecom.encodingAESKey : genAlnum(43);
  if (encodingAESKey.length !== 43) fail(`connectors.wecom.encodingAESKey 必须 43 字符（当前 ${encodingAESKey.length}）`);
  connectorsTokenFile = path.join(RUN_DIR, 'connectors-token.txt');
  writeFileSync(connectorsTokenFile, serviceToken);

  // 合成验收运行配置（Git 排除；CONNECTORS_CONFIG 指向独立文件，绝不覆盖既有 .run/config.json）。
  if (!connectorsCfg.a?.credentials || typeof connectorsCfg.a.credentials !== 'object') {
    fail('connectors.a.credentials 必填（service=Gate 回执/分析运行专用；registrar=派生工件登记）：合成令牌须与 A --principal-tokens 一致');
  }
  mkdirSync(path.join(CONNECTORS_ROOT, '.run'), { recursive: true });
  const objectRoot = typeof connectorsCfg.objectRoot === 'string' && connectorsCfg.objectRoot ? connectorsCfg.objectRoot : path.join(CONNECTORS_ROOT, '.run', 'objects-delivery');
  mkdirSync(objectRoot, { recursive: true });
  const tenantId = typeof connectorsCfg.tenantId === 'string' && connectorsCfg.tenantId ? connectorsCfg.tenantId : 't1';
  const connectorsRuntime = {
    _synthetic: `任务04 §三合成验收配置：delivery-up 生成于 ${new Date().toISOString()}；真实凭据不入 Git；allowRealWecom 恒 false`,
    port: connectorsPort,
    defaultTenantId: tenantId,
    pg: { host: '127.0.0.1', port: dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cDb },
    objectRoot,
    signingSecret,
    serviceToken,
    wecom: { allowRealWecom: false, corpid: 'synthetic-acceptance-corpid', callbackToken: connectorsCfg.wecom.callbackToken, encodingAESKey },
    trtc: { callbackKey: signingSecret },
    a: {
      baseUrl: `http://127.0.0.1:${kernelPort}`,
      // legacy v1 aRegister（e1 集成路径仍用）读顶层 credential；v2 bridge 读 credentials.*。
      // 两者都供齐：credential=registrar 令牌（派生工件登记）。
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
    },
  };
  const connectorsCfgPath = path.join(CONNECTORS_ROOT, '.run', 'config.delivery.json');
  writeFileSync(connectorsCfgPath, JSON.stringify(connectorsRuntime, null, 2));

  const cMarker = `jw-delivery-conn-${Date.now().toString(36)}`;
  const cLogFd = (await import('node:fs')).openSync(path.join(RUN_DIR, 'connectors.log'), 'w');
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
    console.error(`[delivery-up] Connectors 未就绪（日志 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'connectors.log'))}）。进程保留供排障，停止用 delivery-down。`);
    process.exit(2);
  }
  writeFileSync(connectorsPidFile, JSON.stringify({ pid: connectorsChild.pid, marker: cMarker, port: connectorsPort, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), service: 'jw-connectors' }));
  ok(`Connectors 运行中 pid=${connectorsChild.pid} port=${connectorsPort}（常驻处理驱动+对象存储+A bridge→${connectorsRuntime.a.baseUrl}）`);
} else {
  console.log('[delivery-up] i --without-connectors：处理通道/对象存储/A bridge 未启动（全链就绪结论降级 NOT_RUN，不冒充完整启动）');
}

// heartbeat 维护（与 edge-start 同纪律：停止前复核多证）。本脚本保持前台运行作为监督进程；
// Ctrl+C（SIGINT/SIGBREAK）= 停止 Edge+Connectors+A 并清理（等价 delivery-down）。
// 子进程已退时不再续写其心跳（delivery-down 的 heartbeat 证因此如实过期 → 拒绝盲杀）。
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

// ---- 7) 启动 Edge（--live，凭据映射=delivery-runtime 的 authEntries） ----
// 任务04 整改：身份目录写入运行态 RUN_DIR/edge-auth.json（Git 排除、随实例隔离），
// 不再覆盖 config/edge-auth.json 私有运行配置（历史行为会静默改写他人配置）。
const authPath = path.join(RUN_DIR, 'edge-auth.json');
if (Array.isArray(cfg.authEntries) && cfg.authEntries.length > 0) {
  writeFileSync(authPath, JSON.stringify({ entries: cfg.authEntries }, null, 2));
  ok(`Edge 身份目录已写入 ${path.relative(REPO_ROOT, authPath)}（${cfg.authEntries.length} 条；服务端内存使用）`);
} else {
  console.log('[delivery-up] i delivery-runtime.json 未提供 authEntries：Edge 会话交换将失败关闭（无法登录演示身份）');
  if (existsSync(authPath)) {
    try { rmSync(authPath, { force: true }); } catch { }
  }
}
const edgeStart = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
  '--port', String(edgePort), '--live', '--kernel-port', String(kernelPort), '--db-port', String(dbPort),
  '--auth-file', authPath, '--marker', `jw-delivery-edge-${aMarker.slice(-8)}`,
  '--run-dir', RUN_DIR,
  // 任务04 §三/§四：处理通道透传（问题1/2 修复）+ 消息与幂等回执持久库（重启可恢复）。
  ...(connectorsCfg && connectorsTokenFile
    ? ['--connectors-url', `http://127.0.0.1:${connectorsPort}`, '--connectors-token-file', connectorsTokenFile,
      '--connectors-tenant', String(connectorsCfg.tenantId ?? 't1')]
    : []),
  '--messages-file', path.join(RUN_DIR, 'edge-messages.db'),
  ...(serveFront ? ['--serve-front', serveFront] : [])], { timeout: 60000 });
if (edgeStart.err) fail(`Edge 启动失败: ${(edgeStart.stderr || edgeStart.err.message).slice(0, 300)}`);
console.log(edgeStart.stdout.trim());
ok('Edge（live 投影）已启动');

// ---- 8) 就绪报告 + 资源台账 + 前台监督（Ctrl+C = 停止 Edge+Connectors+A，等价 delivery-down） ----
const ready = await waitHealth(`http://127.0.0.1:${edgePort}/healthz/ready`, (j) => j.ok === true, 30000);
const vz = await fetch(`http://127.0.0.1:${edgePort}/versionz`).then((r) => r.json()).catch(() => ({}));

// 资源台账（任务04 §三）：实例名称/端口/PID/归属——排障与受控停止的唯一依据。
let edgePid = null;
try { edgePid = JSON.parse(readFileSync(path.join(RUN_DIR, 'edge.pid'), 'utf8')).pid; } catch { }
const resources = {
  generatedAt: new Date().toISOString(),
  owner: 'delivery-up（任务04 §三）',
  runDir: path.relative(REPO_ROOT, RUN_DIR),
  fullChainIntent: connectorsCfg ? 'PG + A 内核 + Connectors（常驻处理驱动/对象存储/A bridge）+ Edge' : 'PG + A 内核 + Edge（--without-connectors：处理通道 NOT_RUN）',
  bExecutor: { resident: false, reason: '页面旅程无 agent 执行器消费面：目标执行由人类角色经 Edge 完成，材料处理由 Connectors 常驻驱动承担（判定依据见 task-04/TEST_RESULTS.md）' },
  instances: [
    { name: dbContainer, kind: 'postgres-container', port: dbPort, owner: 'Back/START.md 人工一次性创建；delivery-up 只 start/stop，不动数据卷' },
    { name: 'a-kernel', kind: 'process', port: kernelPort, pid: aChild.pid, marker: aMarker, log: '.run/delivery/kernel.log', owner: 'delivery-up' },
    ...(connectorsChild ? [{
      name: 'connectors', kind: 'process', port: connectorsPort, pid: connectorsChild.pid, log: '.run/delivery/connectors.log',
      config: 'Back/Connectors/.run/config.delivery.json', objects: 'Back/Connectors/.run/objects-delivery', db: connectorsDbName, owner: 'delivery-up',
    }] : []),
    { name: 'edge', kind: 'process', port: edgePort, pid: edgePid, log: '.run/delivery/edge-daemon.log', messages: '.run/delivery/edge-messages.db', owner: 'delivery-up' },
  ],
};
writeFileSync(path.join(RUN_DIR, 'resources.json'), JSON.stringify(resources, null, 2));
ok(`资源台账已写入 ${path.relative(REPO_ROOT, path.join(RUN_DIR, 'resources.json'))}`);

console.log('──────────────────────────────────────────────');
console.log(`[delivery-up] 就绪：${ready ? '是' : '否（查看 Edge /healthz/ready 逐依赖原因）'}`);
if (serveFront) {
  console.log(`  前端(同源) : http://127.0.0.1:${edgePort}/  ← ${serveFront}（Edge 同源托管，工作本走同源 API）`);
  console.log(`  前端(预览) : cd Front && node start-preview.mjs --port=3628（本地模拟形态，不连后台）`);
} else {
  console.log(`  前端预览   : cd Front && node start-preview.mjs   → http://127.0.0.1:3618/`);
}
console.log(`  Edge       : http://127.0.0.1:${edgePort}/  (build ${vz.buildId ?? '?'}, /harness/ 操作验证页)`);
console.log(`  A 内核     : http://127.0.0.1:${kernelPort}/healthz`);
if (connectorsChild) {
  console.log(`  Connectors : http://127.0.0.1:${connectorsPort}/healthz（常驻处理驱动；对象存储 ${resources.instances[2].objects}）`);
} else {
  console.log('  Connectors : 未启动（--without-connectors）；页面处理通道将显式 503 CHANNEL_NOT_CONFIGURED');
}
console.log(`  B 执行器   : 不常驻（无 agent 执行器消费面；判定见资源台账 bExecutor）`);
console.log(`  停止       : 本窗口 Ctrl+C（推荐，含 Connectors）；或另开窗口 node scripts/delivery-down.mjs`);
console.log(`  能力位     : ${JSON.stringify(vz.capabilities ?? {})}`);
console.log('──────────────────────────────────────────────');
if (!ready) process.exit(3);

const { execFile: execFileCb } = await import('node:child_process');
const shutdown = () => {
  console.log('\n[delivery-up] 收到停止信号：执行 delivery-down（三证复核）…');
  hbTimer.unref?.();
  execFileCb(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'delivery-down.mjs')], { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
    console.log(String(stdout || '') + String(stderr || ''));
    if (err) console.error(`[delivery-up] delivery-down 异常: ${err.message}`);
    process.exit(err ? 1 : 0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
console.log('[delivery-up] 监督进程运行中：保持本窗口开启；Ctrl+C 停止 Edge+A。');
