// 任务 03 · S3 跨进程文件互斥锁（wx 独占创建 + pid 存活探测 + token 校验释放）。
// 语义与 glm.mjs 内置预算锁一致（提取为通用件；glm 锁暂不迁移以免扰动已验收行为，
// 合并属可选后续）。硬规则：
//   - 抢占只针对已死 owner（pid 不存在）；活 PID 的锁绝不因超龄被删（不盲抢活锁）；
//   - 等待超 deadline → 返回 blocked（调用方失败关闭，不无限等）；
//   - owner 释放带 token 校验：仅当锁内容仍是自己的 token 才删除，防旧 owner 删新 owner 的锁；
//   - 半写锁（内容不可解析）：mtime 超过 staleMs 才抢占，否则等持锁者写完。

import { fs } from './deps.mjs';
import crypto from 'node:crypto';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * @param p.lockPath 锁文件路径（目录须存在）
 * @param p.fn 临界区函数
 * @param p.timeoutMs 等待上限（默认 8000；超时返回 {blocked} 不抛错）
 * @param p.staleMs 半写锁抢占阈值（默认 10000）
 * @returns {ok:true, value} | {ok:false, blocked:{code, messageZh}}
 */
export async function withFileLock({ lockPath, fn, timeoutMs = 8000, staleMs = 10000 }) {
  const deadline = Date.now() + timeoutMs;
  const ownToken = `${process.pid} ${Date.now()} ${crypto.randomBytes(8).toString('hex')}\n`;
  for (;;) {
    let fd;
    try {
      fd = await fs.open(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') {
        return { ok: false, blocked: { code: 'LOCK_IO', messageZh: `锁不可创建(${e.code}):失败关闭` } };
      }
      let stale = false;
      try {
        const raw = await fs.readFile(lockPath, 'utf8');
        const m = raw.match(/^(\d+) (\d+) ([0-9a-f]+)\s*$/);
        if (m) {
          stale = !pidAlive(Number(m[1])); // 仅死 owner 可抢；活 PID 不盲抢
        } else {
          const st = await fs.stat(lockPath);
          stale = Date.now() - st.mtimeMs > staleMs;
        }
      } catch (e2) {
        if (e2.code === 'ENOENT') continue; // 锁刚被释放
        return { ok: false, blocked: { code: 'LOCK_IO', messageZh: `锁不可读(${e2.code}):失败关闭` } };
      }
      if (stale) { await fs.unlink(lockPath).catch(() => {}); continue; }
      if (Date.now() >= deadline) {
        return { ok: false, blocked: { code: 'LOCK_TIMEOUT', messageZh: '锁等待超时:持锁进程仍在(不盲抢活锁)' } };
      }
      await sleepMs(50);
      continue;
    }
    try {
      await fd.writeFile(ownToken, 'utf8');
      const value = await fn();
      return { ok: true, value };
    } finally {
      try { await fd.close(); } catch { /* 已关 */ }
      // owner 校验：仅当锁内容仍是自己的 token 才删除；被抢占(新 owner)时不删别人的锁
      try {
        const cur = await fs.readFile(lockPath, 'utf8');
        if (cur === ownToken) await fs.unlink(lockPath).catch(() => {});
      } catch { /* 已被他人处理 */ }
    }
  }
}
