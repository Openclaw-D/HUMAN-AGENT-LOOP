#!/usr/bin/env node
// W13 多进程子进程:对同一锁路径竞争 withFileLock,临界区内持有 holdMs 并把
// enter/exit 事件写进本进程独立日志(避免多进程同文件追加交错),结果 JSON 打到 stdout 末行。
// 用法: node test/fs-lock-child.mjs <lockPath> <logPath> <holdMs>
import { fs } from '../src/deps.mjs';
import { withFileLock } from '../src/fs-lock.mjs';

const [, , lockPath, logPath, holdMsArg] = process.argv;
const holdMs = Number(holdMsArg ?? 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function append(event) {
  await fs.appendFile(logPath, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...event })}\n`, 'utf8');
}

const run = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let entered = false;
const r = await withFileLock({
  lockPath,
  watchdogMs: 50,
  fn: async () => {
    entered = true;
    await append({ event: 'enter', run });
    await sleep(holdMs);
    await append({ event: 'exit', run, outcome: 'ok' });
    return 'done';
  },
});
if (r.ok) {
  console.log(JSON.stringify({ pid: process.pid, ok: true }));
} else {
  // 被夺:临界区结果作废——若曾 enter,补一条非 ok 终态供父进程对账
  if (entered) await append({ event: 'exit', run, outcome: r.blocked.code });
  console.log(JSON.stringify({ pid: process.pid, ok: false, code: r.blocked.code }));
}
