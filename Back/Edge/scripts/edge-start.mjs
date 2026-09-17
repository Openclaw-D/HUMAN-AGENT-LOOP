// JW Edge 安全启动（任务04 S5 部分）：
//   - 端口预检：被占用即提示退出（exit 24），绝不抢占、不杀任何进程；
//   - 已在运行（pidfile+heartbeat 标识匹配）→ 拒绝双开（exit 23）；
//   - 以守护子进程运行 src/server.mjs，随机 marker 放在其命令行上；pidfile+heartbeat 记录
//     同一 marker，供 edge-stop 做“命令行复核”防 PID 复用误杀（任务04 D24）；
//   - 不删除任何数据；停止请用 scripts/edge-stop.mjs。
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run');
const PID_FILE = path.join(RUN_DIR, 'edge.pid');
const HEARTBEAT_FILE = path.join(RUN_DIR, 'edge-heartbeat.json');
const SERVER_ENTRY = path.join(EDGE_ROOT, 'src', 'server.mjs');
const DAEMON_LOG = path.join(RUN_DIR, 'edge-daemon.log');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

function portOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { try { s.destroy(); } catch { } resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitLive(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz/live`, { signal: AbortSignal.timeout(800) });
      if (r.status === 200) return true;
    } catch { /* 未就绪继续等 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const port = Number(arg('port', process.env.JW_EDGE_PORT || 48200));

  // 双开保护：已有健康实例 → 不再启动第二个。
  if (existsSync(PID_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(PID_FILE, 'utf8'));
      if (alive(prev.pid) && existsSync(HEARTBEAT_FILE)) {
        const hb = JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf8'));
        if (hb.marker === prev.marker) {
          console.error(`[edge-start] jw-edge 已在运行 pid=${prev.pid} port=${prev.port}，拒绝双开（exit 23）`);
          process.exit(23);
        }
      }
      console.error(`[edge-start] 发现过期启动记录（pid=${prev.pid} 已不在或标识不符），覆盖。不杀任何进程。`);
    } catch { /* 损坏的 pidfile 按无记录处理 */ }
  }

  // 端口预检：占用即退出。注意：不查询占用者、不提示杀进程，由用户自行处置（可能是旧实例）。
  if (await portOpen('127.0.0.1', port)) {
    console.error(`[edge-start] 端口 ${port} 已被占用。按边界不抢占、不停未知服务。请换端口：--port <其他端口>（exit 24）`);
    process.exit(24);
  }

  const marker = randomUUID();
  rmSync(DAEMON_LOG, { force: true });
  // readiness 探针目标=JW 自有部署形态（Back/START.md）：A 内核 48180、独立 PG 15442。
  const kernelPort = arg('kernel-port', process.env.JW_A_PORT || 48180);
  const dbPort = arg('db-port', process.env.JW_PG_PORT || 15442);
  // live 模式（任务三 C2）：透传 --live/--auth-file/--allowed-origin；fixture-auth 仅非 live 时启用。
  // goal-03 C3：透传 --serve-front <dir>（同源受控前端托管，默认关闭）。
  const live = process.argv.includes('--live');
  const extraArgs = [];
  if (live) {
    extraArgs.push('--live');
    const authFile = arg('auth-file', null);
    if (authFile) extraArgs.push('--auth-file', authFile);
    for (let i = 0; i < process.argv.length; i++) {
      if (process.argv[i] === '--allowed-origin' && process.argv[i + 1]) extraArgs.push('--allowed-origin', process.argv[i + 1]);
    }
  }
  const serveFront = arg('serve-front', null);
  if (serveFront) extraArgs.push('--serve-front', serveFront);
  const { spawn } = await import('node:child_process');
  const out = openSync(DAEMON_LOG, 'a');
  const child = spawn(process.execPath, [
    SERVER_ENTRY, '--port', String(port), '--marker', marker, '--heartbeat', HEARTBEAT_FILE,
    '--kernel-port', String(kernelPort), '--db-port', String(dbPort),
    ...(live ? extraArgs : ['--fixture-auth']), // 非 live：仅启用合成演示身份 harness-demo-cred（公开合成值），不用于真实身份
  ], { cwd: EDGE_ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();

  if (!(await waitLive(port))) {
    console.error('[edge-start] 守护进程未在 15s 内就绪。日志尾部：');
    try { console.error(readFileSync(DAEMON_LOG, 'utf8').slice(-800)); } catch { }
    // 仅清理本次自己拉起的子进程（marker 在其命令行上，pid 由本次 spawn 返回）。
    const { execFileSync } = await import('node:child_process');
    try { execFileSync('taskkill', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore' }); } catch { }
    process.exit(2);
  }

  writeFileSync(PID_FILE, JSON.stringify({
    pid: child.pid, marker, port, startedAt: new Date().toISOString(), service: 'jw-edge',
    daemonLog: '.run/edge-daemon.log',
  }, null, 2));

  console.log(`[edge-start] jw-edge 守护进程运行中 pid=${child.pid} port=${port} marker=${marker.slice(0, 8)}…`);
  console.log('  GET /versionz        版本封存');
  console.log('  GET /healthz/live    liveness（仅进程存活）');
  console.log('  GET /healthz/ready   readiness（逐依赖独立结果）');
  console.log('  停止：node scripts/edge-stop.mjs（先复核启动标识，绝不误杀）');
}

main().catch((e) => {
  console.error(`[edge-start] 启动失败: ${e.message}`);
  process.exit(2);
});
