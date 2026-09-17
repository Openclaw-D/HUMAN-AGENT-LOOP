// 任务三 C4·受控交付启动编排：预检 → 独立 PG（已登记容器，只 start 不 create）→
// A 内核迁移+启动（合成政策位，显式参数）→ 权限矩阵幂等播种 → Edge --live → 就绪报告。
// 纪律：
//   - 不抢占端口、不杀未知进程、不创建容器（容器建立见 Back/START.md，人工一次性动作）；
//   - A/Edge 都带启动标识（marker+pidfile+heartbeat）；停止一律用 delivery-down.mjs 三证复核；
//   - 身份目录/令牌来自被 Git 排除的 config/delivery-runtime.json（示例见 .example），
//     本脚本不内嵌任何真实凭据；缺配置即失败关闭。
// 用法：node scripts/delivery-up.mjs [--skip-frontend-hint] [--db-port 15442] [--kernel-port 48180] [--edge-port 48200]
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'delivery');
const DB_CONTAINER = 'jw-v01-pg';
const DB_PORT = 15442;
const KERNEL_PORT = 48180;
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

// ---- 0) 运行时配置（Git 排除；fail-closed） ----
const cfgPath = path.join(EDGE_ROOT, 'config', 'delivery-runtime.json');
if (!existsSync(cfgPath)) {
  fail(`缺少 ${path.relative(REPO_ROOT, cfgPath)}（复制 .example 并填入与 A 内核 --principal-tokens 一致的合成/获准令牌；本脚本不内嵌凭据）`);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['principalTokens', 'creditMatrix', 'creditConcentration', 'dbUser', 'dbPassword', 'dbName']) {
  if (typeof cfg[k] !== 'string' || cfg[k].length === 0) fail(`delivery-runtime.json 缺字段 ${k}`);
}

// ---- 1) 预检 ----
if (!process.version.startsWith('v22.')) fail(`需要 Node 22.x，当前 ${process.version}`);
const docker = await run('docker', ['ps'], 20000);
if (docker.err) fail('docker 不可达（真实 PG 需要）；先启动 Docker Desktop 再运行本脚本');
if (!existsSync(path.join(REPO_ROOT, 'Front', 'dist', 'index.html'))) fail('Front/dist 缺失：先在 Front/ 运行 npm run build');
ok('预检：node/docker/dist 就绪');

// ---- 2) 独立 PG：已登记容器只 start 不 create ----
const psA = await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}', '--filter', `name=^${DB_CONTAINER}$`]);
if (psA.err || !psA.stdout.includes(DB_CONTAINER)) {
  fail(`容器 ${DB_CONTAINER} 不存在。请按 Back/START.md 一次性创建（docker run jw-v01-pg ...）；本脚本不代建容器`);
}
if (!psA.stdout.includes('Up')) {
  const startR = await run('docker', ['start', DB_CONTAINER]);
  if (startR.err) fail(`启动 ${DB_CONTAINER} 失败: ${startR.stderr.slice(0, 120)}`);
  ok(`容器 ${DB_CONTAINER} 已启动（数据卷原样保留）`);
} else {
  ok(`容器 ${DB_CONTAINER} 已在运行`);
}
const pgReady = await (async () => {
  for (let i = 0; i < 30; i++) {
    const r = await run('docker', ['exec', DB_CONTAINER, 'pg_isready', '-U', cfg.dbUser, '-d', cfg.dbName]);
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
  const seed = await run('docker', ['exec', DB_CONTAINER, 'psql', '-U', cfg.dbUser, '-d', cfg.dbName, '-v', 'ON_ERROR_STOP=1', '-c', cfg.matrixSeedSql]);
  if (seed.err) fail(`矩阵播种失败: ${seed.stderr.slice(0, 200)}`);
  ok('权限矩阵播种完成（配置内 SQL，幂等）');
} else {
  console.log('[delivery-up] i delivery-runtime.json 未提供 matrixSeedSql：正式动作将 POLICY_PENDING fail-closed（如需演示批准流程请配置合成矩阵并标注非公司制度）');
}

// ---- 6) 启动 A 内核（marker+pidfile+heartbeat 由本脚本维护） ----
mkdirSync(RUN_DIR, { recursive: true });
const aMarker = `jw-delivery-a-${Date.now().toString(36)}`;
const aPidFile = path.join(RUN_DIR, 'kernel.pid');
const aLogFd = (await import('node:fs')).openSync(path.join(RUN_DIR, 'kernel.log'), 'w');
const aChild = spawn(process.execPath, [
  path.join(BACK_ROOT, 'A', 'src', 'index.ts'), '--port', String(kernelPort), '--db', dsn,
  '--principal-tokens', cfg.principalTokens, '--credit-matrix', cfg.creditMatrix, '--credit-concentration', cfg.creditConcentration,
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

// heartbeat 维护（与 edge-start 同纪律：停止前复核四证）。本脚本保持前台运行作为监督进程；
// Ctrl+C（SIGINT/SIGBREAK）= 停止 Edge+A 并清理（等价 delivery-down）。
// 子进程已退时不再续写心跳（delivery-down 的 heartbeat 证因此如实过期 → 拒绝盲杀）。
const hbTimer = setInterval(() => {
  let childAlive = true;
  try { process.kill(aChild.pid, 0); } catch { childAlive = false; }
  if (!childAlive) return;
  try {
    const j = JSON.parse(readFileSync(aPidFile, 'utf8'));
    j.heartbeatAt = new Date().toISOString();
    writeFileSync(aPidFile, JSON.stringify(j));
  } catch { }
}, 5000);

// ---- 7) 启动 Edge（--live，凭据映射=delivery-runtime 的 authEntries） ----
const authPath = path.join(EDGE_ROOT, 'config', 'edge-auth.json');
if (Array.isArray(cfg.authEntries) && cfg.authEntries.length > 0) {
  writeFileSync(authPath, JSON.stringify({ entries: cfg.authEntries }, null, 2));
  ok(`Edge 身份目录已写入（${cfg.authEntries.length} 条；服务端内存使用）`);
} else {
  console.log('[delivery-up] i delivery-runtime.json 未提供 authEntries：Edge 会话交换将失败关闭（无法登录演示身份）');
  if (existsSync(authPath)) {
    try { rmSync(authPath, { force: true }); } catch { }
  }
}
const edgeStart = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-start.mjs'),
  '--port', String(edgePort), '--live', '--kernel-port', String(kernelPort), '--db-port', String(dbPort),
  '--auth-file', authPath, '--marker', `jw-delivery-edge-${aMarker.slice(-8)}`,
  '--heartbeat', path.join(RUN_DIR, 'edge-heartbeat.json')], { timeout: 60000 });
if (edgeStart.err) fail(`Edge 启动失败: ${(edgeStart.stderr || edgeStart.err.message).slice(0, 300)}`);
console.log(edgeStart.stdout.trim());
ok('Edge（live 投影）已启动');

// ---- 8) 就绪报告 + 前台监督（Ctrl+C = 停止 Edge+A，等价 delivery-down） ----
const ready = await waitHealth(`http://127.0.0.1:${edgePort}/healthz/ready`, (j) => j.ok === true, 30000);
const vz = await fetch(`http://127.0.0.1:${edgePort}/versionz`).then((r) => r.json()).catch(() => ({}));
console.log('──────────────────────────────────────────────');
console.log(`[delivery-up] 就绪：${ready ? '是' : '否（查看 Edge /healthz/ready 逐依赖原因）'}`);
console.log(`  前端预览   : cd Front && node start-preview.mjs   → http://127.0.0.1:3618/`);
console.log(`  Edge       : http://127.0.0.1:${edgePort}/  (build ${vz.buildId ?? '?'}, /harness/ 操作验证页)`);
console.log(`  A 内核     : http://127.0.0.1:${kernelPort}/healthz`);
console.log(`  停止       : 本窗口 Ctrl+C（推荐）；或另开窗口 node scripts/delivery-down.mjs`);
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
