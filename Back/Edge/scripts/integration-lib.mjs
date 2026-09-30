// 集成轮 2026-09-25（docs/integration/2026-09-25/01-foundation）共享运行库：
// 真实启动/停止 A + Connectors + Edge + 独立 PG 的全部原语；integration-up/down/smoke 共用。
// 纪律（继承 delivery-up/down 与 START.md）：
//   - 只操作本集成轮自有容器/端口/pidfile；绝不抢占端口、不杀未知进程；
//   - 停止前多证复核（pidfile + heartbeat 新鲜 + 端口内容标识 + 命令行 marker）；
//   - readiness 只认真实依赖探测（A /healthz db=up、Connectors /healthz、Edge 逐依赖聚合），
//     无任何 mock 满足就绪；
//   - 身份/令牌来自 Git 排除的 config/delivery-runtime.json；缺字段失败关闭。
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
export const REPO_ROOT = path.resolve(BACK_ROOT, '..');
export const CONNECTORS_ROOT = path.join(BACK_ROOT, 'Connectors');
export const A_ROOT = path.join(BACK_ROOT, 'A');
// JW_INTEG_RUN_SUBDIR：并行验收路需要独立运行目录（pid/params/日志隔离），默认值保持原栈兼容。
export const RUN_DIR = path.join(EDGE_ROOT, '.run', process.env.JW_INTEG_RUN_SUBDIR ?? 'integration');
export const PARAMS_FILE = path.join(RUN_DIR, 'params.json');

export const DEFAULTS = {
  dbContainer: 'jw-integ-f-pg',
  dbPort: 25491,
  kernelPort: 48480,
  connectorsPort: 48400,
  edgePort: 48420,
  connectorsDb: 'cnext',
  tenantId: 't1',
};

export const HEARTBEAT_MAX_AGE_MS = 30000;

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000, maxBuffer: 16 * 1024 * 1024, ...(opts.execOpts ?? {}) }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export const ok = (m) => console.log(`[integration] ✓ ${m}`);
export const info = (m) => console.log(`[integration] i ${m}`);
export function fail(msg) { console.error(`[integration] ✗ ${msg}`); process.exit(2); }

export function argOf(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}

export function portBusy(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function waitHttp(url, pass, timeoutMs = 60000, intervalMs = 600) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.status === 200) {
        const j = await r.json();
        if (!pass || pass(j)) return true;
      }
    } catch { }
    await new Promise((x) => setTimeout(x, intervalMs));
  }
  return false;
}

// ---- 运行参数（同栈重启/停止共用；integration-up 写入，其余读取） ----

export function saveParams(p) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(PARAMS_FILE, JSON.stringify(p, null, 2));
}

export function loadParams() {
  if (!existsSync(PARAMS_FILE)) return null;
  try { return JSON.parse(readFileSync(PARAMS_FILE, 'utf8')); } catch { return null; }
}

// ---- 配置（Git 排除；fail-closed） ----

export function loadRuntimeConfig(cfgPath) {
  const p = path.resolve(EDGE_ROOT, cfgPath);
  if (!existsSync(p)) fail(`缺少 ${path.relative(REPO_ROOT, p)}（复制 config/delivery-runtime.example.json 并填入合成/获准令牌；本脚本不内嵌凭据）`);
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  for (const k of ['principalTokens', 'creditMatrix', 'creditConcentration', 'dbUser', 'dbPassword', 'dbName']) {
    if (typeof cfg[k] !== 'string' || cfg[k].length === 0) fail(`配置缺字段 ${k}（配置校验失败关闭）`);
  }
  if (!cfg.connectors || typeof cfg.connectors !== 'object') fail('配置缺 connectors 段（真实联调必需：常驻处理驱动+对象存储+A bridge）');
  if (!cfg.connectors.wecom?.callbackToken) fail('connectors.wecom.callbackToken 必填（合成验收值即可）');
  if (!cfg.connectors.a?.credentials || typeof cfg.connectors.a.credentials !== 'object') fail('connectors.a.credentials 必填（service/registrar）');
  return cfg;
}

// ---- PG 容器（只管自有容器：名字必须带 jw-integ- 前缀才允许创建/启动） ----

export async function ensureDbContainer({ container, port, user, password, db, init }) {
  const psA = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}', '--filter', `name=^${container}$`]);
  if (psA.err) fail('docker 不可达（真实 PG 需要）；先启动 Docker Desktop 再运行');
  const exists = psA.stdout.includes(container);
  if (!exists) {
    if (!init) fail(`容器 ${container} 不存在：以 --init 首次创建（本脚本只创建 jw-integ- 前缀的自有容器）`);
    if (!container.startsWith('jw-integ-')) fail(`拒绝创建容器 ${container}：只允许 jw-integ- 前缀的自有容器`);
    const made = await run('docker', ['run', '-d', '--name', container,
      '-e', `POSTGRES_USER=${user}`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${db}`,
      '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
    if (made.err) fail(`创建容器失败: ${made.stderr.slice(0, 200)}`);
    ok(`自有 PG 容器 ${container} 已创建 @127.0.0.1:${port}（仅 loopback）`);
  } else if (!psA.stdout.includes('Up')) {
    const started = await run('docker', ['start', container]);
    if (started.err) fail(`启动容器 ${container} 失败: ${started.stderr.slice(0, 160)}`);
    ok(`容器 ${container} 已启动（数据卷原样保留）`);
  } else {
    ok(`容器 ${container} 已在运行`);
  }
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    const r = await run('docker', ['exec', container, 'pg_isready', '-U', user, '-d', db]);
    ready = !r.err;
    if (!ready) await new Promise((x) => setTimeout(x, 800));
  }
  if (!ready) fail('PG 未就绪（pg_isready 超时）');
  ok('PG 就绪（真实依赖，非 mock）');
}

// ---- 迁移检查（A 迁移簿记 vs 磁盘文件；任何缺失即非零失败） ----

export async function runMigrations({ dsn }) {
  const mig = await run(process.execPath, [path.join(A_ROOT, 'src', 'db', 'migrate-cli.ts')], {
    timeout: 120000,
    execOpts: { env: { ...process.env, V7NEXT_A_DB_URL: dsn } },
  });
  if (mig.err) fail(`A 迁移失败: ${(mig.stderr || mig.err.message || '').slice(0, 300)}`);
  ok(`A 迁移已应用：${mig.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '完成'}`);
}

export async function verifyMigrationBookkeeping({ container, user, db }) {
  const files = (await import('node:fs')).readdirSync(path.join(A_ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const q = await run('docker', ['exec', container, 'psql', '-U', user, '-d', db, '-tAc', 'SELECT name FROM schema_migrations ORDER BY name']);
  if (q.err) fail(`迁移簿记查询失败: ${q.stderr.slice(0, 200)}`);
  const applied = new Set(q.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const missing = files.filter((f) => !applied.has(f));
  if (missing.length > 0) fail(`迁移簿记缺口：${missing.join(', ')}（迁移检查失败关闭）`);
  ok(`迁移簿记核对一致：${files.length}/${files.length} 已应用（schema_migrations）`);
  return files;
}

// ---- 服务启停（pidfile + heartbeat + marker；带多证停止） ----

function touchHeartbeat(pidFile) {
  try {
    const j = JSON.parse(readFileSync(pidFile, 'utf8'));
    j.heartbeatAt = new Date().toISOString();
    writeFileSync(pidFile, JSON.stringify(j));
  } catch { }
}

export function startHeartbeat(pidFiles) {
  const t = setInterval(() => { for (const f of pidFiles) touchHeartbeat(f); }, 5000);
  return t;
}

export async function spawnA({ dsn, port, cfg, policyVersion, marker, logPath }) {
  mkdirSync(RUN_DIR, { recursive: true });
  const pidFile = path.join(RUN_DIR, 'kernel.pid');
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(A_ROOT, 'src', 'index.ts'), '--port', String(port), '--db', dsn,
    '--principal-tokens', cfg.principalTokens, '--credit-matrix', cfg.creditMatrix, '--credit-concentration', cfg.creditConcentration,
    '--dispatch',
    ...(policyVersion ? ['--required-domains-policy', policyVersion] : []),
    '--delivery-marker', marker,
    // 04-acceptance：五域并行推进引擎接线（配置 opt-in；缺省不传，保持原单列行为）
    ...(cfg.parallelAdvance ? [
      '--parallel-advance',
      ...(cfg.advanceServiceCredential ? ['--service-credential', cfg.advanceServiceCredential] : []),
      ...(cfg.advanceMaxConcurrency ? ['--advance-max-concurrency', String(cfg.advanceMaxConcurrency)] : []),
      ...(cfg.advanceProgression ? ['--progression', cfg.advanceProgression] : []),
      ...(cfg.modelConfigPath ? ['--model-config', cfg.modelConfigPath] : []),
      ...(cfg.semanticReceiptsDir ? ['--semantic-receipts-dir', cfg.semanticReceiptsDir] : []),
    ] : []),
  ], { detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  const startedAt = new Date().toISOString();
  const ready = await waitHttp(`http://127.0.0.1:${port}/healthz`, (j) => j.db === 'up', 60000);
  if (!ready) fail(`A 内核未就绪（日志 ${path.relative(REPO_ROOT, logPath)}）`);
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, marker, port, startedAt, heartbeatAt: new Date().toISOString(), service: 'a-kernel' }));
  ok(`A 内核运行中 pid=${child.pid} port=${port}（db=up 真实探测）`);
  return child.pid;
}

export async function spawnConnectors({ cfg, connectorsCfg, dbPort, port, kernelPort, marker, logPath, tokenFile, paramsTenant }) {
  const { randomBytes, randomInt } = await import('node:crypto');
  const genAlnum = (n) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[randomInt(62)]).join('');
  const signingSecret = typeof connectorsCfg.signingSecret === 'string' && connectorsCfg.signingSecret ? connectorsCfg.signingSecret : randomBytes(32).toString('hex');
  // 服务令牌跨重启保持稳定（token 文件存在即复用）：Edge 守护持令牌文件内容，Connectors
  // 单独重启时轮换会破坏通道鉴权（readiness connectors-channel 探针 401）。首轮生成后固定；
  // 如需轮换：删除 token 文件并整栈重启。
  let serviceToken = null;
  if (existsSync(tokenFile)) serviceToken = readFileSync(tokenFile, 'utf8').trim() || null;
  if (!serviceToken) serviceToken = typeof connectorsCfg.serviceToken === 'string' && connectorsCfg.serviceToken ? connectorsCfg.serviceToken : randomBytes(32).toString('hex');
  const encodingAESKey = typeof connectorsCfg.wecom.encodingAESKey === 'string' && connectorsCfg.wecom.encodingAESKey ? connectorsCfg.wecom.encodingAESKey : genAlnum(43);
  if (encodingAESKey.length !== 43) fail(`connectors.wecom.encodingAESKey 必须 43 字符（当前 ${encodingAESKey.length}）`);
  // 集成轮 2026-09-25（装配校验，DEF-INTG-03）：材料登记（a_bridge registerArtifactOp）需要
  // 人类凭据映射（a.credentials.upload[role] 或 uploadFallback）；缺失时任务将诚实 blocked_a_unavailable。
  // 集成底座显式补齐 uploadFallback=registrar（human business，登记≠核验语义），并留痕。
  const credentials = { ...connectorsCfg.a.credentials };
  if (!credentials.upload && !credentials.uploadFallback) {
    if (!credentials.registrar) fail('connectors.a.credentials.registrar 必填（uploadFallback 自动补齐的前提）');
    credentials.uploadFallback = credentials.registrar;
    console.error('[integration] i connectors.a.credentials 缺 upload/uploadFallback：已补 uploadFallback=registrar（human business；登记≠核验）');
  }
  writeFileSync(tokenFile, serviceToken);
  mkdirSync(path.join(CONNECTORS_ROOT, '.run'), { recursive: true });
  const objectRoot = typeof connectorsCfg.objectRoot === 'string' && connectorsCfg.objectRoot ? connectorsCfg.objectRoot : path.join(CONNECTORS_ROOT, '.run', 'objects-integration');
  mkdirSync(objectRoot, { recursive: true });
  const tenantId = paramsTenant ?? (typeof connectorsCfg.tenantId === 'string' && connectorsCfg.tenantId ? connectorsCfg.tenantId : DEFAULTS.tenantId);
  const runtime = {
    _synthetic: `集成轮 2026-09-25 合成验收配置：integration-up 生成于 ${new Date().toISOString()}；真实凭据不入 Git；allowRealWecom 恒 false`,
    port,
    defaultTenantId: tenantId,
    pg: { host: '127.0.0.1', port: dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: connectorsCfg.pg?.database ?? DEFAULTS.connectorsDb },
    objectRoot,
    signingSecret,
    serviceToken,
    wecom: { allowRealWecom: false, corpid: 'synthetic-integration-corpid', callbackToken: connectorsCfg.wecom.callbackToken, encodingAESKey },
    trtc: { callbackKey: signingSecret },
    a: {
      baseUrl: `http://127.0.0.1:${kernelPort}`,
      credential: credentials.registrar,
      tenantId,
      bridge: connectorsCfg.a?.bridge === false ? false : true,
      credentials,
      customerLinks: connectorsCfg.customerLinks ?? {},
      timeoutMs: connectorsCfg.a?.timeoutMs ?? 5000,
    },
    processing: {
      driverIntervalMs: connectorsCfg.driverIntervalMs ?? 1500,
      outboundPolicy: connectorsCfg.outboundPolicy ?? 'suggest_only',
      aCustomerLinks: connectorsCfg.customerLinks ?? {},
      // 04-acceptance：容量参数透传（concurrency 等；缺省不传保持默认行为）
      ...(connectorsCfg.processing ?? {}),
    },
  };
  const cfgPath = path.join(CONNECTORS_ROOT, '.run', 'config.integration.json');
  writeFileSync(cfgPath, JSON.stringify(runtime, null, 2));
  const pidFile = path.join(RUN_DIR, 'connectors.pid');
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(CONNECTORS_ROOT, 'scripts', 'start-connectors.mjs'), '--delivery-marker', marker,
  ], { cwd: CONNECTORS_ROOT, detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, CONNECTORS_CONFIG: cfgPath } });
  child.unref();
  const ready = await waitHttp(`http://127.0.0.1:${port}/healthz`, (j) => j?.ok === true && j?.service === 'jw-connectors', 60000);
  if (!ready) fail(`Connectors 未就绪（日志 ${path.relative(REPO_ROOT, logPath)}）`);
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, marker, port, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), service: 'jw-connectors', config: cfgPath, objects: objectRoot }));
  ok(`Connectors 运行中 pid=${child.pid} port=${port}（常驻处理驱动+对象存储+A bridge）`);
  return child.pid;
}

// Edge 经既有 edge-start.mjs 守护化（端口预检/双开保护/pidfile 内建）；--connectors-url/
// --connectors-token-file/--connectors-tenant/--messages-file 由其透传（见 edge-start extraArgs）。
// connectorsPort 取自 params.json（integration-up 先写后启动 Edge，重启场景读同一参数）。
export async function startEdgeFull({ port, kernelPort, dbPort, authFile, tokenFile, tenant, runDir, messagesFile, marker, serveFront = null, modelConfig = null, modelReceiptsDir = null }) {
  const params = loadParams();
  const connectorsPort = params?.connectorsPort;
  if (!connectorsPort) throw new Error('params.json 缺 connectorsPort：先由 integration-up 写入运行参数');
  const r = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
    '--port', String(port), '--live', '--kernel-port', String(kernelPort), '--db-port', String(dbPort),
    '--auth-file', authFile, '--marker', marker, '--run-dir', runDir,
    '--connectors-url', `http://127.0.0.1:${connectorsPort}`,
    '--connectors-token-file', tokenFile, '--connectors-tenant', tenant,
    '--messages-file', messagesFile,
    // 04-acceptance：同源受控前端托管 + 助手模型/回执目录（配置 opt-in；缺省不传=默认关闭，语义不变）
    // （03路 arrow-cases fallback404 双来源已退役：收尾02 落地 A 权威目录）
    ...(serveFront ? ['--serve-front', serveFront] : []),
    ...(modelConfig ? ['--model-config', modelConfig] : []),
    ...(modelReceiptsDir ? ['--model-receipts-dir', modelReceiptsDir] : [])], { timeout: 60000 });
  return r;
}

// ---- 多证停止（pidfile 存活 + 端口内容标识 + 命令行 marker 三证强制；heartbeat 过期仅提示）----
// 说明（集成轮 2026-09-25）：本集成的重启/冒烟子操作在无监督进程时运行，pidfile heartbeat
// 不像 delivery-up 前台监督那样持续刷新；因此 heartbeat 不作为强制证据。强制三证=
// ① pidfile 记录的 pid 仍存活；② 该端口 /healthz 内容含本服务标识（端口内容与记录一致）；
// ③ 进程命令行含本脚本写入的 marker（防 PID 复用盲杀）。任一不符 → 拒绝 kill 并报告。
async function cmdlineOf(pid) {
  const ps = await run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], 15000);
  return String(ps.stdout || '');
}

export async function stopService({ name, pidFile, healthUrl, healthPass, contentNote }) {
  if (!existsSync(pidFile)) { info(`${name} pidfile 不存在（未启动或已停止；不采取动作）`); return { stopped: false, reason: 'no-pidfile' }; }
  let rec;
  try { rec = JSON.parse(readFileSync(pidFile, 'utf8')); } catch { throw new Error(`${name} pidfile 损坏（不可解析）；拒绝停止，请人工核实`); }
  let alive = false;
  try { process.kill(rec.pid, 0); alive = true; } catch { }
  if (!alive) { rmSync(pidFile, { force: true }); info(`${name} pid=${rec.pid} 已不存在：仅清理过期记录`); return { stopped: false, reason: 'dead' }; }
  const hbAge = rec.heartbeatAt ? Date.now() - Date.parse(rec.heartbeatAt) : Number.POSITIVE_INFINITY;
  if (hbAge > HEARTBEAT_MAX_AGE_MS) info(`${name} heartbeat ${Math.round(hbAge / 1000)}s 未刷新（无监督进程属预期；以下强制三证继续）`);
  if (healthUrl) {
    let contentOk = false;
    try { const r = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) }); const j = await r.json(); contentOk = healthPass(j); } catch { contentOk = false; }
    if (!contentOk) throw new Error(`${name} 端口 ${rec.port} 内容标识不符（${contentNote}）：端口内容与 pidfile 不符；拒绝停止`);
  }
  const markerOk = String(await cmdlineOf(rec.pid)).includes(String(rec.marker));
  if (!markerOk) throw new Error(`${name} 命令行复核未通过（不含 marker=${String(rec.marker).slice(0, 8)}…）：拒绝按 PID 盲杀`);
  process.kill(rec.pid);
  rmSync(pidFile, { force: true });
  ok(`${name} 已停止 pid=${rec.pid}（pid 存活+端口标识+命令行 marker 三证相符）`);
  return { stopped: true, pid: rec.pid };
}

export async function stopEdge({ runDir }) {
  const r = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', runDir], 30000);
  console.log((r.stdout || r.stderr || '').trim());
  return !r.err;
}

export async function stopDbContainer({ container }) {
  const r = await run('docker', ['stop', container]);
  if (r.err) fail(`停止容器 ${container} 失败: ${r.stderr.slice(0, 160)}`);
  ok(`容器 ${container} 已停止（数据卷保留）`);
}

// ---- 就绪/version/资源台账 ----

export async function edgeReadiness(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz/ready`, { signal: AbortSignal.timeout(4000) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export async function edgeVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/versionz`, { signal: AbortSignal.timeout(4000) });
    return await r.json();
  } catch { return {}; }
}

export function writeResources({ params, edgePid, fullChainReady, version }) {
  const resources = {
    generatedAt: new Date().toISOString(),
    owner: 'integration-up（docs/integration/2026-09-25/01-foundation）',
    runDir: path.relative(REPO_ROOT, RUN_DIR),
    fullChainIntent: 'PG(自有容器) + A内核(dispatch) + Connectors(常驻处理驱动/对象存储/A bridge) + Edge(live+恢复装配)',
    fullChainReady,
    version: version ?? null,
    instances: [
      { name: params.dbContainer, kind: 'postgres-container', port: params.dbPort, owner: 'integration-up --init 创建；只 start/stop，不动数据卷' },
      { name: 'a-kernel', kind: 'process', port: params.kernelPort, log: '.run/integration/kernel.log', owner: 'integration-up' },
      { name: 'connectors', kind: 'process', port: params.connectorsPort, log: '.run/integration/connectors.log', config: 'Back/Connectors/.run/config.integration.json', owner: 'integration-up' },
      { name: 'edge', kind: 'process', port: params.edgePort, pid: edgePid ?? null, log: path.relative(REPO_ROOT, path.join(RUN_DIR, 'edge-daemon.log')), messages: path.relative(REPO_ROOT, path.join(RUN_DIR, 'edge-messages.db')), owner: 'integration-up' },
    ],
  };
  writeFileSync(path.join(RUN_DIR, 'resources.json'), JSON.stringify(resources, null, 2));
  return resources;
}
