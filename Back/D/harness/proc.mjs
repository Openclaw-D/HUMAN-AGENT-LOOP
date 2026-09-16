// D路子进程管理：只跟踪并只杀死 D 自己 spawn 的进程。零依赖。
// Windows: spawn 不经 shell（避免 cmd.exe 包装导致 taskkill /T 断链），杀树用 taskkill /T /F <pid>。
import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const registry = new Map(); // pid -> {proc, label, outPath}

export function listOwn() { return [...registry.entries()].map(([pid, v]) => ({ pid, label: v.label })); }

export function spawnOwn(label, cmd, args, { cwd, env, stdoutPath, readyProbe, readyTimeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const out = stdoutPath ? createWriteStream(stdoutPath, { flags: 'a' }) : null;
    const proc = spawn(cmd, args, {
      cwd, env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', out ? 'pipe' : 'ignore', out ? 'pipe' : 'ignore'],
      windowsHide: true,
    });
    registry.set(proc.pid, { proc, label, outPath: stdoutPath });
    if (out) {
      proc.stdout.on('data', (d) => out.write(d));
      proc.stderr.on('data', (d) => out.write(d));
    }
    const onExit = () => registry.delete(proc.pid);
    proc.once('exit', onExit);
    proc.once('error', (e) => { onExit(); reject(new Error(`spawn ${label} failed: ${e.message}`)); });
    const finish = () => resolve({ pid: proc.pid, label, proc });
    if (!readyProbe) { proc.once('spawn', finish); setTimeout(finish, 300); return; }
    (async () => {
      const deadline = Date.now() + readyTimeoutMs;
      while (Date.now() < deadline) {
        if (proc.exitCode !== null) return reject(new Error(`${label} exited early code=${proc.exitCode}; log=${stdoutPath || 'none'}`));
        if (await readyProbe()) return finish();
        await sleep(300);
      }
      await stopOwn({ pid: proc.pid });
      reject(new Error(`${label} not healthy within ${readyTimeoutMs}ms; log=${stdoutPath || 'none'}`));
    })();
  });
}

export async function waitProbe(probe, timeoutMs = 30000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await probe()) return true; await sleep(intervalMs); }
  return false;
}

export function stopOwn({ pid }) {
  return new Promise((resolve) => {
    const rec = registry.get(pid);
    if (!rec || rec.proc.exitCode !== null) return resolve(false);
    // 直接杀目标pid树；不碰 registry 之外的任何进程
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve(true));
  });
}

export async function stopAllOwn() {
  const pids = [...registry.keys()];
  for (const pid of pids) await stopOwn({ pid });
  await sleep(500);
  return pids.length;
}

export function installExitCleanup() {
  const cleanup = async () => { try { await stopAllOwn(); } catch { /* 尽力清理 */ } };
  process.on('exit', () => { for (const [pid] of registry) { try { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { } } });
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
  process.on('unhandledRejection', async (e) => { console.error('[D-harness] unhandledRejection:', e); await cleanup(); process.exit(2); });
  process.on('uncaughtException', async (e) => { console.error('[D-harness] uncaughtException:', e); await cleanup(); process.exit(2); });
}
