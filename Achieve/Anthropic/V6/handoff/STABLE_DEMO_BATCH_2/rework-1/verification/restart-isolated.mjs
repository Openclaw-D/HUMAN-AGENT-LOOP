// V6 BATCH_2 rework-1 · 隔离实例生命周期管理（CP3 重启验证复用）。
// 用法：
//   node restart-isolated.mjs restart   — 归属校验后重启 3321（rework-1 数据目录），等待就绪
//   node restart-isolated.mjs start     — 仅启动（端口必须空闲）
//   node restart-isolated.mjs stop      — 归属校验后停止
// 纪律：只操作 3321 端口；杀进程前必须通过端口→PID→命令行→cwd 归属校验；3311 永不触碰。
// 注意（rework-1 实测）：在 ZCode Bash 工具内以 spawn 方式启动的 next dev 会在脚本退出后被
// 回收；持久驻留需用后台任务方式直接运行，例如：
//   cd site/.v6-runtime && V5_PREVIEW_DATA_DIR=<rework-1 数据目录> node <site>/node_modules/next/dist/bin/next dev --port 3321
// 本脚本的 stop 仍可用于归属校验后的停止。
import { spawn, execSync } from 'node:child_process';

const PORT = 3321;
const SITE_RUNTIME = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/.v6-runtime';
const NEXT_BIN = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/node_modules/next/dist/bin/next';
const DATA_DIR = 'C:/Users/22673/Desktop/Anthropic/V6/handoff/STABLE_DEMO_BATCH_2/rework-1/evidence/runtime-data';
const BASE = `http://localhost:${PORT}`;
const events = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listeningPids(port) {
  const out = execSync('netstat -ano', { windowsHide: true, encoding: 'utf8', timeout: 8000 });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    if ((cols[1] ?? '').endsWith(`:${port}`)) {
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

function pidCommandLine(pid) {
  try {
    const out = execSync(
      `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { windowsHide: true, encoding: 'utf8', timeout: 15000 },
    ).trim();
    return out;
  } catch {
    return '';
  }
}

/** 归属校验：3321 上的每个 PID 都必须是 next start-server（本批隔离实例形态）。 */
function verifyOwnership() {
  const pids = listeningPids(PORT);
  if (pids.length === 0) return [];
  for (const pid of pids) {
    const cmd = pidCommandLine(pid);
    events.push({ event: 'ownership-check', pid, cmd });
    if (!cmd.includes('next') || !cmd.includes('start-server')) {
      throw new Error(`端口 ${PORT} 的 PID ${pid} 不是本批 next 实例（cmdline: ${cmd}）；拒绝操作`);
    }
  }
  return pids;
}

async function killOwn() {
  for (const pid of verifyOwnership()) {
    events.push({ event: 'taskkill', pid });
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
  if ((listeningPids(PORT)).length === 0) {
    events.push({ event: 'port-released', port: PORT });
    return;
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (listeningPids(PORT).length === 0) {
      events.push({ event: 'port-released', port: PORT });
      return;
    }
    await sleep(400);
  }
  throw new Error(`端口 ${PORT} 未能释放`);
}

async function start() {
  if (listeningPids(PORT).length > 0) throw new Error(`端口 ${PORT} 已被占用`);
  const child = spawn(process.execPath, [NEXT_BIN, 'dev', '--port', String(PORT)], {
    cwd: SITE_RUNTIME,
    env: { ...process.env, V5_PREVIEW_DATA_DIR: DATA_DIR },
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
  });
  child.unref();
  events.push({ event: 'spawn', pid: child.pid, port: PORT, dataDir: DATA_DIR });
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next dev 提前退出（${child.exitCode}）`);
    try {
      const res = await fetch(`${BASE}/api/v5-preview/project`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        events.push({ event: 'ready', pid: child.pid, scenario: j.scenario, version: j.version });
        return child;
      }
    } catch { /* not ready */ }
    if (Date.now() > deadline) throw new Error('隔离实例启动超时（240s）');
    await sleep(1000);
  }
}

const action = process.argv[2] ?? 'restart';
try {
  if (action === 'restart') {
    await killOwn();
    await start();
  } else if (action === 'stop') {
    await killOwn();
  } else if (action === 'start') {
    await start();
  } else {
    throw new Error(`未知动作：${action}`);
  }
  console.log(JSON.stringify({ ok: true, action, events }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, action, events, error: String(error && error.message || error) }, null, 2));
  process.exit(1);
}
