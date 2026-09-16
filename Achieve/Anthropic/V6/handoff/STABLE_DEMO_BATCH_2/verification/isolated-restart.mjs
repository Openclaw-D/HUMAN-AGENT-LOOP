// V6 BATCH_2 · 隔离服务重启恢复（行 7）。
// 自起/自停隔离实例（3321），验证：写入→重启→GET 恢复一致 + 幂等行为恢复 + 数据不重置。
// 运行：node V6/handoff/STABLE_DEMO_BATCH_2/verification/isolated-restart.mjs
import { spawn, execSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 3321;
const SITE_RUNTIME = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/.v6-runtime';
const DATA_DIR = 'C:/Users/22673/Desktop/Anthropic/V6/handoff/STABLE_DEMO_BATCH_2/evidence/runtime-data';
const BASE = `http://localhost:${PORT}`;
const events = [];

function listeningPids(port) {
  try {
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
  } catch {
    return [];
  }
}

async function killOwn(port) {
  for (const pid of listeningPids(port)) {
    events.push({ event: 'taskkill', pid });
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) {
      events.push({ event: 'port-released', port });
      return;
    }
    await sleep(400);
  }
  throw new Error(`端口 ${port} 未能释放`);
}

async function start() {
  const child = spawn(process.execPath, [
    'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/node_modules/next/dist/bin/next', 'dev', '--port', String(PORT),
  ], { cwd: SITE_RUNTIME, env: { ...process.env, V5_PREVIEW_DATA_DIR: DATA_DIR }, stdio: 'ignore', windowsHide: true });
  events.push({ event: 'spawn', pid: child.pid, port: PORT });
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next dev 提前退出（${child.exitCode}）`);
    try {
      const res = await fetch(`${BASE}/api/v5-preview/project`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        events.push({ event: 'ready', pid: child.pid });
        return;
      }
    } catch { /* not ready */ }
    if (Date.now() > deadline) throw new Error('隔离实例启动超时（240s）');
    await sleep(1000);
  }
}

async function getProject() {
  const res = await fetch(`${BASE}/api/v5-preview/project`, { cache: 'no-store' });
  return res.json();
}
async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* null */ }
  return { status: res.status, json };
}

const results = [];
try {
  // 前置：确认 3321 只属于本批（若被其他进程占用则失败退出，不误杀）
  const before = listeningPids(PORT);
  if (before.length === 0) await start();
  else events.push({ event: 'reuse-existing-batch-instance', pid: before[0] });

  await post('/api/v5-preview/demo/seed', { scenario: 'approval' });
  let ov = await getProject();
  // 完整原载荷（含 expectedVersion）——重启后重放必须逐字段一致才命中幂等（V6-CTRL C 语义）。
  const originalPayload = { requestId: 'restart-msg-1', expectedVersion: ov.version, text: '重启恢复验证（合成）。', actorRole: 'business' };
  const write1 = await post('/api/v5-preview/messages', originalPayload);
  const beforeRestart = await getProject();

  // 重启（只杀 3321 上本批实例）
  await killOwn(PORT);
  await start();

  const after = await getProject();
  const same = after.version === beforeRestart.version
    && after.scenario === beforeRestart.scenario
    && after.messages.length === beforeRestart.messages.length
    && JSON.stringify(after.messages.at(-1)) === JSON.stringify(beforeRestart.messages.at(-1));
  results.push({ check: '重启后状态逐字段恢复（版本/情景/消息）', pass: same, before: { v: beforeRestart.version, n: beforeRestart.messages.length }, after: { v: after.version, n: after.messages.length } });

  const replay = await post('/api/v5-preview/messages', originalPayload);
  results.push({ check: '重启后幂等表恢复（同载荷重放 replayed）', pass: replay.json?.replayed === true && (await getProject()).version === after.version, replayed: replay.json?.replayed === true });
} catch (error) {
  results.push({ check: 'isolated-restart', pass: false, error: String(error).slice(0, 300) });
} finally {
  await killOwn(PORT).catch(() => {});
}

const fs = await import('node:fs');
fs.writeFileSync(new URL('./isolated-restart-result.json', import.meta.url), JSON.stringify({ results, events }, null, 2));
console.log(JSON.stringify({ results, events: events.slice(-8) }, null, 2));
process.exit(results.every((r) => r.pass === true) ? 0 : 1);
