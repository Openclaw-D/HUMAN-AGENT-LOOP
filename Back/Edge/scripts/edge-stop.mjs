// JW Edge 安全停止（任务04 S5 / D24 对应）：
//   只停止"启动标识可复核"的本实例进程：pidfile + heartbeat marker 双证一致，
//   且经 Get-CimInstance 复核该 PID 的命令行确实携带本 marker——PID 被复用/记录过期时拒绝动手。
//   绝不按端口杀进程、不删数据卷、不触碰其他项目或旧 Anthropic 实例。
//   退出码：0=已停止；4=未在运行（或已清理过期记录）；5=标识复核失败拒绝杀；2=执行错误。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 与 edge-start --run-dir 配对（隔离实例）；默认 .run 行为不变。
const argvIdx = process.argv.indexOf('--run-dir');
const RUN_DIR = argvIdx >= 0 && process.argv[argvIdx + 1]
  ? path.resolve(process.argv[argvIdx + 1])
  : path.join(EDGE_ROOT, '.run');
const PID_FILE = path.join(RUN_DIR, 'edge.pid');
const HEARTBEAT_FILE = path.join(RUN_DIR, 'edge-heartbeat.json');

const HEARTBEAT_MAX_AGE_MS = 60000;

function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function main() {
  if (!existsSync(PID_FILE)) {
    console.log('[edge-stop] 无启动记录，jw-edge 未在运行（exit 4）');
    process.exit(4);
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch (e) {
    console.error(`[edge-stop] 启动记录损坏（${e.message}）；仅清理记录文件，不动任何进程（exit 4）`);
    rmSync(PID_FILE, { force: true });
    process.exit(4);
  }
  if (!rec || typeof rec.pid !== 'number' || !rec.marker) {
    console.error('[edge-stop] 启动记录字段缺失，拒绝操作（exit 5）');
    process.exit(5);
  }

  if (!alive(rec.pid)) {
    console.log(`[edge-stop] 记录的 pid=${rec.pid} 已不存在（过期记录）。仅清理记录，未杀任何进程（exit 4）`);
    rmSync(PID_FILE, { force: true });
    rmSync(HEARTBEAT_FILE, { force: true });
    process.exit(4);
  }

  // 标识复核 1：heartbeat marker 与 pidfile 一致且未过期太久。
  if (existsSync(HEARTBEAT_FILE)) {
    try {
      const hb = JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf8'));
      const age = Date.now() - Date.parse(hb.heartbeatAt || '');
      if (hb.marker !== rec.marker) {
        console.error('[edge-stop] heartbeat 标识与启动记录不符，疑似 PID 复用，拒绝杀进程（exit 5）');
        process.exit(5);
      }
      if (Number.isFinite(age) && age > HEARTBEAT_MAX_AGE_MS) {
        console.error(`[edge-stop] heartbeat 已停跳 ${Math.round(age / 1000)}s（进程可能假死）。仍要求命令行复核通过才杀。`);
      }
    } catch {
      console.error('[edge-stop] heartbeat 文件不可读；继续命令行复核。');
    }
  } else {
    console.error('[edge-stop] 无 heartbeat 文件；继续命令行复核。');
  }

  // 标识复核 2：该 PID 的命令行确实携带本 marker。读不到或不含 marker → 拒绝。
  const probe = await run('powershell', [
    '-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process -Filter 'ProcessId=${rec.pid}').CommandLine`,
  ]);
  const cmdline = probe.stdout.trim();
  if (probe.err || !cmdline) {
    console.error(`[edge-stop] 无法读取 pid=${rec.pid} 的命令行（权限/进程退出竞态），拒绝杀进程（exit 5）。请人工确认后处理。`);
    process.exit(5);
  }
  if (!cmdline.includes(rec.marker)) {
    console.error('[edge-stop] 命令行不含本次启动标识——该 PID 极可能已被其他进程复用，拒绝杀进程（exit 5）');
    process.exit(5);
  }

  const kill = await run('taskkill', ['/F', '/PID', String(rec.pid), '/T']);
  if (kill.err) {
    console.error(`[edge-stop] taskkill 失败: ${(kill.stderr || kill.err.message).slice(0, 200)}（exit 5）`);
    process.exit(5);
  }
  rmSync(PID_FILE, { force: true });
  rmSync(HEARTBEAT_FILE, { force: true });
  console.log(`[edge-stop] jw-edge pid=${rec.pid} 已停止；未删除任何数据（exit 0）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[edge-stop] 执行错误: ${e.message}`);
  process.exit(2);
});
