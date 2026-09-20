// V0.3 zcode-real-loop · 停止本路隔离栈（2026-09-20）。
// 只停"标识可复核"的本路进程：pidfile marker 与该 PID 命令行复核一致才动手（防 PID 复用误杀）。
// Edge 走 edge-stop.mjs --run-dir（同为多证复核）。数据卷永不删除；--with-db 只停容器。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'zloop');
const WITH_DB = process.argv.includes('--with-db');
const ok = (m) => console.log(`[zloop-down] ✓ ${m}`);
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 60000 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

async function cmdlineOf(pid) {
  const r = await run('powershell', ['-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
  return r.stdout.trim();
}

async function stopByPidfile(name, file) {
  if (!existsSync(file)) { console.log(`[zloop-down] i ${name}: 无 pidfile（可能未运行）`); return; }
  let rec = null;
  try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch { rmSync(file, { force: true }); return; }
  if (typeof rec.pid !== 'number' || !rec.marker) { rmSync(file, { force: true }); return; }
  const cmdline = await cmdlineOf(rec.pid);
  if (!cmdline || !cmdline.includes(rec.marker)) {
    console.error(`[zloop-down] ✗ ${name}: PID ${rec.pid} 命令行不含本路 marker（可能已退出或 PID 被复用）——不动手，请人工核实`);
    return;
  }
  try { process.kill(rec.pid); } catch (e) { console.error(`[zloop-down] ✗ ${name}: kill 失败 ${e.message}`); return; }
  await new Promise((r) => setTimeout(r, 1200));
  ok(`${name} pid=${rec.pid} 已停止（marker 复核通过）`);
  rmSync(file, { force: true });
}

await stopByPidfile('A 内核', path.join(RUN_DIR, 'kernel.pid'));
await stopByPidfile('Connectors', path.join(RUN_DIR, 'connectors.pid'));

const edgeStop = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', RUN_DIR]);
console.log((edgeStop.stdout + edgeStop.stderr).trim());

if (WITH_DB) {
  const r = await run('docker', ['stop', 'jw-zloop-pg']);
  console.log(r.err ? `[zloop-down] ✗ 停容器失败: ${r.stderr.slice(0, 120)}` : '[zloop-down] ✓ 容器 jw-zloop-pg 已停止（卷 jw_zloop_pgdata 保留）');
}
console.log('[zloop-down] 完成（数据卷/账本/回执/反馈记录原样保留）');
