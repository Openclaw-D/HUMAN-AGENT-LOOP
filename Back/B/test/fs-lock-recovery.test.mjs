// 任务 02 · B4/W13 文件锁死锁回收竞态测试（PR#3 审核 F12 的回归防线）。
// 覆盖：
//   1) 死 owner 锁被正常回收：rename 原子替换后内容=自己 token，释放清干净；
//   2) 过期观察与并发新 owner 竞争：动手前复核到内容已变即放弃（不覆盖新 owner 的锁）；
//   3) 持有期被夺：看门狗检出 → LOCK_STOLEN 失败关闭，且被夺者绝不删除新持者的锁；
//   4) 半写锁：新鲜 corrupt 不抢；超龄 corrupt 才回收；
//   5) 多进程同时回收同一死 owner 锁（真实子进程）：对账不变量=任何重叠区间内
//      在先持有者必须以 LOCK_STOLEN 失败关闭作废，不存在两个 ok 重叠。
//   6) 临界区抛错：锁先释放再上抛（不泄漏到进程死亡），同进程可立即重入。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fs } from '../src/deps.mjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from '../src/fs-lock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmpDir(name) {
  const dir = path.join(here, '.tmp', `${name}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function deadToken(pid) { return `${pid} 1 deadbeefdeadbeef\n`; }

/** 造一个"死 owner"锁：spawn 一个即退子进程拿其 pid，确认已死。 */
function makeDeadPid() {
  for (let i = 0; i < 5; i += 1) {
    const c = spawnSync(process.execPath, ['-e', ''], { timeout: 15000 });
    const pid = c.pid;
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (!alive && pid) return pid;
  }
  throw new Error('无法取得已退出 pid');
}

async function readRaw(p) {
  try { return await fs.readFile(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

test('W13-1 死 owner 锁被回收：rename 替换后持有，释放清干净', async () => {
  const dir = await tmpDir('w13-recover');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, deadToken(makeDeadPid()), 'utf8');
  const r = await withFileLock({ lockPath, fn: () => 'v1', watchdogMs: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.value, 'v1');
  assert.equal(await readRaw(lockPath), null, '释放后锁文件应删除');
});

test('W13-2 过期观察已变化：放弃回收，不覆盖新 owner 的锁', async () => {
  const dir = await tmpDir('w13-abort');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, deadToken(makeDeadPid()), 'utf8');
  const newOwnerToken = `${process.pid} 999999 newowner00000000\n`;
  const r = await withFileLock({
    lockPath,
    timeoutMs: 400,
    watchdogMs: 50,
    hooks: { afterObserve: async () => { await fs.writeFile(lockPath, newOwnerToken, 'utf8'); } },
    fn: () => 'should-not-run',
  });
  // 回收动手前复核到内容已变 → 放弃；活 owner 在 → 等待超时失败关闭
  assert.equal(r.ok, false);
  assert.equal(r.blocked.code, 'LOCK_TIMEOUT');
  assert.equal(await readRaw(lockPath), newOwnerToken, '新 owner 的锁不得被删除或覆盖');
});

test('W13-3 持有期被夺：看门狗 LOCK_STOLEN 失败关闭，且不删新持者的锁', async () => {
  const dir = await tmpDir('w13-stolen');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, deadToken(makeDeadPid()), 'utf8');

  let victimEntered;
  const victimEnteredPromise = new Promise((res) => { victimEntered = res; });
  let releaseVictim;
  const releaseVictimPromise = new Promise((res) => { releaseVictim = res; });

  // 受害者：正常回收死锁并进入临界区；看门狗 40ms，测试在 150ms 后放行其 fn
  const victim = withFileLock({
    lockPath, watchdogMs: 40,
    fn: async () => { victimEntered(); await releaseVictimPromise; return 'victim-value'; },
  });
  await victimEnteredPromise;
  const victimRaw = await readRaw(lockPath);
  assert.ok(victimRaw && victimRaw.trim().length > 0, '受害者应已写入自己的 token');

  // 攻击者：在受害者已入临界区后强制 rename 覆盖（复现理论竞态窗口），token 用死 pid
  const attackerToken = deadToken(makeDeadPid());
  const tmp = `${lockPath}.atk-${process.pid}.tmp`;
  await fs.writeFile(tmp, attackerToken, 'utf8');
  await fs.rename(tmp, lockPath);

  setTimeout(releaseVictim, 150); // 40ms 看门狗先检出被夺，fn 恢复后整体失败关闭
  const vr = await victim;
  assert.equal(vr.ok, false, '被夺者必须失败关闭');
  assert.equal(vr.blocked.code, 'LOCK_STOLEN');
  assert.equal(await readRaw(lockPath), attackerToken, '被夺者不得删除新持者的锁');

  // 后续获取者：攻击者 token 是死 pid → 正常回收 → 持有 → 释放清干净
  const ar = await withFileLock({ lockPath, watchdogMs: 50, fn: () => 'next-value' });
  assert.equal(ar.ok, true);
  assert.equal(ar.value, 'next-value');
  assert.equal(await readRaw(lockPath), null);
});

test('W13-4 半写锁：新鲜不抢、超龄回收', async () => {
  const dir = await tmpDir('w13-halfwrite');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, '{"partial": ', 'utf8');
  const fresh = await withFileLock({ lockPath, timeoutMs: 250, fn: () => 'x' });
  assert.equal(fresh.ok, false);
  assert.equal(fresh.blocked.code, 'LOCK_TIMEOUT');
  assert.equal(await readRaw(lockPath), '{"partial": ', '新鲜半写锁原样保留');

  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, old, old);
  const took = await withFileLock({ lockPath, timeoutMs: 4000, fn: () => 'y' });
  assert.equal(took.ok, true);
  assert.equal(await readRaw(lockPath), null, '超龄半写锁被回收后释放干净');
});

test('W13-6 临界区抛错：锁先释放再上抛，同进程可立即重入', async () => {
  const dir = await tmpDir('w13-fnthrow');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, deadToken(makeDeadPid()), 'utf8');
  const boom = new Error('临界区业务失败');
  await assert.rejects(
    withFileLock({ lockPath, fn: () => { throw boom; } }),
    (e) => e === boom,
    '应原样上抛临界区错误',
  );
  assert.equal(await readRaw(lockPath), null, '抛错路径不得泄漏锁文件');
  // 同进程立即重入：若锁泄漏，这里会因自己 pid 存活而等到 LOCK_TIMEOUT
  const r = await withFileLock({ lockPath, timeoutMs: 1500, fn: () => 'reentered' });
  assert.equal(r.ok, true);
  assert.equal(r.value, 'reentered');
  assert.equal(await readRaw(lockPath), null);
});

test('W13-5 多进程并发回收同一死 owner 锁：无静默双持（对账不变量）', async () => {
  const dir = await tmpDir('w13-multiproc');
  const lockPath = path.join(dir, 'job.lock');
  await fs.writeFile(lockPath, deadToken(makeDeadPid()), 'utf8');

  const n = 4;
  const runs = [];
  for (let i = 0; i < n; i += 1) {
    const logPath = path.join(dir, `log-${i}.jsonl`);
    const child = spawn(process.execPath, [path.join(here, 'fs-lock-child.mjs'), lockPath, logPath, '120']);
    runs.push({ logPath, child, stdout: '' });
  }
  const events = [];
  const outcomes = [];
  await Promise.all(runs.map((r) => new Promise((res) => {
    r.child.stdout.on('data', (d) => { r.stdout += d; });
    r.child.on('close', async (code) => {
      assert.equal(code, 0, `子进程异常退出 code=${code}`);
      const last = r.stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
      const parsed = JSON.parse(last);
      outcomes.push(parsed);
      const text = await fs.readFile(r.logPath, 'utf8').catch(() => '');
      for (const line of text.trim().split('\n').filter(Boolean)) events.push(JSON.parse(line));
      res();
    });
  })));
  assert.equal(outcomes.length, n, '全部参与者收尾（无挂死）');
  for (const o of outcomes) {
    if (!o.ok) assert.ok(['LOCK_TIMEOUT', 'LOCK_STOLEN', 'LOCK_IO'].includes(o.code), `非预期失败码 ${o.code}`);
  }

  // 对账：任何 enter 落在别的持有者仍 open 时，该在先持有者的终局必须是非 ok（失败关闭作废）；
  // 即不存在两个都报 ok 的重叠临界区。
  const exitByRun = new Map();
  for (const ev of events) if (ev.event === 'exit') exitByRun.set(ev.run, ev.outcome);
  events.sort((a, b) => a.at - b.at || (a.event === 'enter' ? -1 : 1));
  const open = [];
  for (const ev of events) {
    if (ev.event === 'enter') {
      for (const holder of open) {
        assert.notEqual(exitByRun.get(holder.run), 'ok',
          `静默双持：${ev.run} 进入时 ${holder.run} 仍持有且以 ok 收尾`);
      }
      open.push(ev);
    } else {
      const idx = open.findIndex((x) => x.run === ev.run);
      if (idx >= 0) open.splice(idx, 1);
    }
  }

  // 终态：锁文件要么已释放，要么内容是某个成功持有者写入的 token 格式
  const finalRaw = await readRaw(lockPath);
  if (finalRaw !== null) assert.match(finalRaw, /^\d+ \d+ [0-9a-f]+\n$/, '残留锁必须是合法 token 格式');
});
