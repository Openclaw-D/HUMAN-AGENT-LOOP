// R2-04 唯一可执行入口（任务书要求"交一条可执行入口"）：
//   从仓库根目录：node Back/Edge/test/v04-recovery/run.mjs
//   从 Back/Edge： node test/v04-recovery/run.mjs
// 职责：
//   1) 记录本轮输入源码 SHA256 到 .local/v04-r2-04/last-run-hashes.txt，并与验收冻结快照
//      docs/v0.4/results/r2-04-recovery/hashes-pinned.txt 逐行比对——不一致时打印"待复验"
//      提示（冻结轮结果对该版本失效），不阻断执行；
//   2) 清理上次异常残留的 run-* 临时目录（保留 logs）；
//   3) 以 --test-concurrency=1 串行运行本目录验收测试，输出同步落盘
//      .local/v04-r2-04/logs/recovery-run-<时间戳>.log；
//   4) 以测试进程退出码退出（0=全绿）。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const EDGE_ROOT = path.resolve(HERE, '..', '..');
const JW_ROOT = path.resolve(EDGE_ROOT, '..', '..');
const TMP = path.join(JW_ROOT, '.local', 'v04-r2-04');
const LOGS = path.join(TMP, 'logs');
const PINNED = path.join(JW_ROOT, 'docs', 'v0.4', 'results', 'r2-04-recovery', 'hashes-pinned.txt');

const PINNED_INPUTS = [
  'Back/Edge/src/message-store.mjs',
  'Back/Edge/src/messages.mjs',
  'Back/Edge/src/assistant-receipts.mjs',
  'Back/Edge/src/customer-activity.mjs',
  'Back/Edge/src/server.mjs',
  'Back/Edge/src/kernel-store.mjs',
  'Back/Edge/src/session.mjs',
  'docs/v0.4/results/04-activity/CONTRACT.md',
  'docs/v0.4/results/04-activity/REPORT.md',
  'docs/V0.4_KANBAN.md',
];

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
mkdirSync(LOGS, { recursive: true });

// 1) 残留清理：仅本任务临时区的 run-* 目录（logs 保留）
for (const name of readdirSync(TMP)) {
  if (name.startsWith('run-')) {
    try { rmSync(path.join(TMP, name), { recursive: true, force: true }); } catch { /* 占用即留给下轮 */ }
  }
}

// 2) 输入 hash 快照与冻结轮比对
const lines = PINNED_INPUTS.map((rel) => `${sha256(path.join(JW_ROOT, rel))} *${rel}`);
writeFileSync(path.join(TMP, 'last-run-hashes.txt'), lines.join('\n') + '\n');
let drift = [];
if (existsSync(PINNED)) {
  const pinned = new Map(readFileSync(PINNED, 'utf8').trim().split('\n').map((l) => {
    const [h, f] = l.split(' *');
    return [f, h];
  }));
  drift = lines.filter((l) => { const [h, f] = l.split(' *'); return pinned.get(f) !== h; }).map((l) => l.split(' *')[1]);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(LOGS, `recovery-run-${stamp}.log`);
const log = (s) => { process.stdout.write(s + '\n'); appendFileSync(logFile, s + '\n'); };

log(`[r2-04] 输入hash已记录：.local/v04-r2-04/last-run-hashes.txt`);
if (drift.length > 0) {
  log(`[r2-04] !! 输入hash与验收冻结快照（docs/v0.4/results/r2-04-recovery/hashes-pinned.txt）不一致，冻结结果标待复验：`);
  for (const f of drift) log(`[r2-04]    - ${f}`);
} else {
  log(`[r2-04] 输入hash与冻结轮快照逐一相同（零漂移）`);
}

// 3) 串行运行验收测试（显式传测试文件：Windows 下 node --test 目录参数会按模块解析而失败）
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'test/v04-recovery/v04-recovery.test.mjs'], {
  cwd: EDGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
let passthrough = '';
const tee = (chunk, out) => {
  passthrough += chunk;
  for (const line of passthrough.split('\n').slice(0, -1)) appendFileSync(logFile, line + '\n');
  passthrough = passthrough.split('\n').at(-1);
  out.write(chunk);
};
child.stdout.on('data', (c) => tee(c, process.stdout));
child.stderr.on('data', (c) => tee(c, process.stderr));
child.on('exit', (code, signal) => {
  if (passthrough) appendFileSync(logFile, passthrough + '\n');
  log(`[r2-04] 测试退出码=${code}${signal ? ` signal=${signal}` : ''}；日志=${path.relative(JW_ROOT, logFile)}`);
  process.exitCode = code ?? 1;
});
