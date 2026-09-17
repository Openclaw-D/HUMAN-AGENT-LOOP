// 任务 03 · S3 跨进程文件互斥锁（wx 独占创建 + pid 存活探测 + token 校验释放）。
// 语义与 glm.mjs 内置预算锁一致（提取为通用件；glm 锁暂不迁移以免扰动已验收行为，
// 合并属可选后续）。硬规则：
//   - 获取唯一原子点 = wx 独占创建（O_EXCL）；活 PID 的锁绝不因超龄被删（不盲抢活锁）；
//   - 等待超 deadline → 返回 blocked（调用方失败关闭，不无限等）；
//   - owner 释放带 token 校验：仅当锁内容仍是自己的 token 才删除，防旧 owner 删新 owner 的锁；
//   - 半写锁（内容不可解析）：mtime 超过 staleMs 才抢占，否则等持锁者写完。
//
// 任务 02 · B4/W13 死锁回收重写（PR#3 审核 F12）：
//   旧实现"读到死 token 后直接 unlink"不是原子比较删除——多个竞争者基于同一次过期观察
//   各自 unlink，会把观察窗口之后 wx 创建的新 owner 锁删掉，造成静默双持。新协议：
//   a) 回收 = 把自己 token 写入唯一临时文件后 rename 原子覆盖锁文件（内容级替换），
//      全程不 unlink 任何非本人创建的锁文件；rename 前立即复核内容仍是观察到的死 token，
//      已变化则放弃本次回收重新排队（不覆盖新 owner）。
//   b) rename 后复读：内容是自己 token 才算持有；被并发替换者（输家）不动文件重新排队。
//   c) 入临界区前二次复核 + 持有期看门狗（默认 500ms）：内容被他人替换 → 检出即
//      LOCK_STOLEN 失败关闭，不返回临界区结果、不删除文件——并发违规从"静默无限双持"
//      变为"有界窗口内必被检出并失败关闭"。残留窗口由两个原子点（rename 覆盖、wx 创建）
//      与复核间隔界定，Windows 无内容 CAS 原语下为可证最强约束，已在模块头如实声明。

import { fs } from './deps.mjs';
import crypto from 'node:crypto';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const EPERM_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function blockedErr(code, messageZh) {
  return { blocked: { code, messageZh } };
}

/** 读锁内容：{kind:'token', raw, pid} | {kind:'corrupt', raw} | null(锁不存在)。 */
async function readLockToken(lockPath) {
  let raw;
  try {
    raw = await fs.readFile(lockPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw Object.assign(new Error(`锁不可读(${e.code}):失败关闭`), { code: 'LOCK_IO' });
  }
  const m = raw.match(/^(\d+) (\d+) ([0-9a-f]+)\s*$/);
  return m ? { kind: 'token', raw, pid: Number(m[1]) } : { kind: 'corrupt', raw };
}

/** 过期判定：token 型看 pid 存活；corrupt 型看 mtime 超龄（半写保护窗口）。 */
async function isStaleObservation(obs, lockPath, staleMs) {
  if (obs.kind === 'token') return !pidAlive(obs.pid);
  const st = await fs.stat(lockPath);
  return Date.now() - st.mtimeMs > staleMs;
}

/**
 * 死锁回收：rename 原子覆盖（不 unlink 任何非本人创建的锁）。
 * @returns 'won' 持有 | 'retry' 放弃重排（观察已变化/被并发替换/锁已消失）
 */
async function takeoverByReplace({ lockPath, ownToken, observed, staleMs, hooks = null }) {
  // 测试观察点：观察到死锁之后、动手复核之前（注入并发变化，验证复核保护）
  if (hooks?.afterObserve) await hooks.afterObserve({ observed });
  // rename 前立即复核：观察到的仍是同一份死锁才动手（防基于过期观察覆盖新 owner）
  const cur = await readLockToken(lockPath);
  if (cur === null || cur.raw !== observed.raw) return 'retry';
  if (await isStaleObservation(cur, lockPath, staleMs) === false) return 'retry';
  if (hooks?.beforeReplace) await hooks.beforeReplace({ observed });
  const tmp = `${lockPath}.tk-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, ownToken, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tmp, lockPath); // 原子覆盖：POSIX/Windows 都替换目标（目标不存在=直接创建）
        break;
      } catch (e) {
        if (EPERM_RETRYABLE.has(e.code) && attempt < 3) { await sleepMs(40 * (attempt + 1)); continue; }
        throw e;
      }
    }
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (e.code === 'ENOENT') return 'retry'; // 锁在我们动手前消失：重新走正常获取
    throw Object.assign(new Error(`锁回收替换失败(${e.code}):失败关闭`), { code: 'LOCK_IO' });
  }
  // rename 后复读：内容是自己才认持有；被并发替换（输家）绝不动文件，重新排队
  const after = await readLockToken(lockPath);
  return after !== null && after.raw === ownToken ? 'won' : 'retry';
}

/**
 * @param p.lockPath 锁文件路径（目录须存在）
 * @param p.fn 临界区函数
 * @param p.timeoutMs 等待上限（默认 8000；超时返回 {blocked} 不抛错）
 * @param p.staleMs 半写锁抢占阈值（默认 10000）
 * @param p.watchdogMs 持有期被夺检出间隔（默认 500）
 * @param p.hooks 测试专用观察点（afterObserve=观察到死锁后/动手复核前；产品路径不传）
 * @returns {ok:true, value} | {ok:false, blocked:{code, messageZh}}
 */
export async function withFileLock({ lockPath, fn, timeoutMs = 8000, staleMs = 10000, watchdogMs = 500, hooks = null }) {
  const deadline = Date.now() + timeoutMs;
  const ownToken = `${process.pid} ${Date.now()} ${crypto.randomBytes(8).toString('hex')}\n`;

  /** 收敛到"锁文件内容=ownToken"；返回 'held' | 'retry' | blocked 对象。 */
  async function acquire() {
    let fd = null;
    try {
      fd = await fs.open(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') return blockedErr('LOCK_IO', `锁不可创建(${e.code}):失败关闭`);
      // ---- 慢路径：观察 → 死锁回收 ----
      let obs;
      try {
        obs = await readLockToken(lockPath);
      } catch (e2) {
        return blockedErr(e2.code ?? 'LOCK_IO', e2.message ?? '锁不可读:失败关闭');
      }
      if (obs === null) return 'retry'; // 锁刚被释放
      let stale = false;
      try {
        stale = await isStaleObservation(obs, lockPath, staleMs);
      } catch (e3) {
        if (e3.code === 'ENOENT') return 'retry';
        return blockedErr('LOCK_IO', `锁状态不可判定(${e3.code}):失败关闭`);
      }
      if (!stale) {
        if (Date.now() >= deadline) return blockedErr('LOCK_TIMEOUT', '锁等待超时:持锁进程仍在(不盲抢活锁)');
        await sleepMs(50);
        return 'retry';
      }
      try {
        const took = await takeoverByReplace({ lockPath, ownToken, observed: obs, staleMs, hooks });
        return took === 'won' ? { held: true, fd: null } : 'retry';
      } catch (e4) {
        return blockedErr(e4.code ?? 'LOCK_IO', e4.message ?? '锁回收失败:失败关闭');
      }
    }
    try {
      await fd.writeFile(ownToken, 'utf8');
      return { held: true, fd };
    } catch (e) {
      await fd.close().catch(() => {});
      return blockedErr('LOCK_IO', `锁初始化写失败(${e.code}):失败关闭`);
    }
  }

  for (;;) {
    if (Date.now() > deadline) return { ok: false, blocked: { code: 'LOCK_TIMEOUT', messageZh: '锁等待超时:获取窗口耗尽(失败关闭)' } };
    const got = await acquire();
    if (got.blocked) return { ok: false, blocked: got.blocked };
    if (got !== 'held' && !got.held) continue; // 'retry'
    let fd = got.held ? got.fd : null;

    // 入临界区前二次复核：内容被抢先替换 = 零副作用退回排队（不进入 fn）
    const pre = await readLockToken(lockPath);
    if (pre === null || pre.raw !== ownToken) {
      if (fd) await fd.close().catch(() => {});
      continue;
    }

    // 持有期看门狗：内容被替换/消失 → LOCK_STOLEN 失败关闭（不返回临界区结果，不删文件）
    let stolen = null;
    const timer = setInterval(() => {
      if (stolen) return;
      readLockToken(lockPath).then((cur) => {
        if (cur === null || cur.raw !== ownToken) stolen = { code: 'LOCK_STOLEN', messageZh: '持有期间锁被他人替换:临界区互斥不可证,结果作废(失败关闭)' };
      }).catch((e) => {
        if (e.code === 'ENOENT') stolen = { code: 'LOCK_STOLEN', messageZh: '持有期间锁文件消失:临界区互斥不可证,结果作废(失败关闭)' };
        // EPERM 等瞬时不可读：本轮跳过（不把杀软扫描误判为被夺）
      });
    }, Math.max(50, watchdogMs));

    let value;
    let fnErr = null;
    try {
      value = await fn();
    } catch (e) {
      fnErr = e; // 临界区抛错也要先释放锁再上抛，否则锁泄漏到进程死亡（同进程重入只能等超时）
    } finally {
      clearInterval(timer);
    }

    // 释放：仅当锁内容仍是自己的 token 才删除；被抢占时不删别人的锁
    try {
      const cur = await readLockToken(lockPath);
      if (cur !== null && cur.raw === ownToken) await fs.unlink(lockPath).catch(() => {});
    } catch { /* 已被他人处理 */ }
    if (fd) await fd.close().catch(() => {});

    if (stolen) return { ok: false, blocked: stolen };
    if (fnErr) throw fnErr;
    return { ok: true, value };
  }
}
