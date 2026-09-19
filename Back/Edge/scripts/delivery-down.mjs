// 任务三 C4·受控交付停止编排（与 delivery-up 配对）：
//   Edge 用既有 edge-stop.mjs（三证复核）；A 用本脚本三证复核（pidfile + heartbeat 新鲜 + 端口内容标识=healthz.contractVersion）。
//   纪律：任何一证不符 → 拒绝 kill（exit 5），只报告；绝不按 PID 盲杀；不删数据卷；
//   --with-db 才停止数据库容器（数据卷保留，仅停库；容器名随 --db-container，默认 jw-v01-pg）。
// 用法：node scripts/delivery-down.mjs [--with-db] [--db-container jw-v01-pg]
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'delivery');
const aPidFile = path.join(RUN_DIR, 'kernel.pid');
const HEARTBEAT_MAX_AGE_MS = 30000;

const argv = process.argv.slice(2);
const withDb = argv.includes('--with-db');
// 与 delivery-up --db-container 配对；默认 jw-v01-pg 不变
const dbContainer = argv.includes('--db-container') && argv[argv.indexOf('--db-container') + 1] ? argv[argv.indexOf('--db-container') + 1] : 'jw-v01-pg';

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
const ok = (m) => console.log(`[delivery-down] ✓ ${m}`);
const refuse = (m) => { console.error(`[delivery-down] ✗ 拒绝停止：${m}（exit 5；请人工核实归属）`); process.exit(5); };

// ---- 1) Edge（既有安全停止：三证复核在 edge-stop.mjs 内；run-dir 与 delivery-up 隔离实例配对） ----
const edgeStop = await run(process.execPath, [path.join(EDGE_ROOT, 'scripts', 'edge-stop.mjs'), '--run-dir', RUN_DIR], 30000);
console.log(edgeStop.stdout.trim() || edgeStop.stderr.trim() || '[delivery-down] edge-stop 无输出');

// ---- 2) A 内核（三证：pidfile 存在且 pid 存活；heartbeat 新鲜；端口 /healthz 带 contractVersion） ----
if (!existsSync(aPidFile)) {
  console.log('[delivery-down] A 内核 pidfile 不存在：可能未由 delivery-up 启动（不采取任何动作）');
} else {
  let rec = null;
  try { rec = JSON.parse(readFileSync(aPidFile, 'utf8')); } catch { refuse('pidfile 损坏（不可解析）'); }
  let alive = false;
  try { process.kill(rec.pid, 0); alive = true; } catch { alive = false; }
  if (!alive) {
    rmSync(aPidFile, { force: true });
    console.log(`[delivery-down] pidfile 记录的 pid=${rec.pid} 已不存在：仅清理过期记录，未杀任何进程`);
  } else {
    const hbAge = rec.heartbeatAt ? Date.now() - Date.parse(rec.heartbeatAt) : Number.POSITIVE_INFINITY;
    if (hbAge > HEARTBEAT_MAX_AGE_MS) refuse(`heartbeat 过期（${Math.round(hbAge / 1000)}s 前）：不像是本脚本管理的实例在心跳`);
    let contentOk = false;
    try {
      const r = await fetch(`http://127.0.0.1:${rec.port}/healthz`, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      // 内容标识：A 内核 /healthz 恒带 contractVersion（其值随上游版本演进，如 v1.3+v2.1-...），
      // 只判存在与形态，不绑定具体版本串（漂移不作为拒绝停机的理由——停机只防误杀）。
      contentOk = typeof j.contractVersion === 'string' && /^v\d/.test(j.contractVersion);
    } catch { contentOk = false; }
    if (!contentOk) refuse(`端口 ${rec.port} 的 /healthz 不含 A 内核标识（contractVersion）：端口内容与 pidfile 不符`);
    // 第四证：命令行含本脚本写入的 --delivery-marker（防同端口另一 A 实例被误杀；T5-⑤ 整改）
    let markerOk = false;
    try {
      const ps = await run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${rec.pid}").CommandLine`], 15000);
      markerOk = String(ps.stdout || '').includes(String(rec.marker));
    } catch { markerOk = false; }
    if (!markerOk) refuse('命令行复核未通过：进程命令行不含本脚本写入的 --delivery-marker 标识');
    process.kill(rec.pid);
    ok(`A 内核已停止 pid=${rec.pid}（pid+heartbeat+端口标识+命令行 marker 四证相符）`);
    rmSync(aPidFile, { force: true });
  }
}

// ---- 3) 数据库（默认保留运行；--with-db 才停容器，数据卷永不动） ----
if (withDb) {
  const r = await run('docker', ['stop', dbContainer], 90000);
  if (r.err) console.error(`[delivery-down] 停止 ${dbContainer} 失败: ${r.stderr.slice(0, 160)}`);
  else ok(`容器 ${dbContainer} 已停止（数据卷原样保留；再次启动 docker start ${dbContainer}）`);
} else {
  console.log('[delivery-down] 数据库容器保持运行（--with-db 可停库；不删卷）');
}
console.log('[delivery-down] 完成');
