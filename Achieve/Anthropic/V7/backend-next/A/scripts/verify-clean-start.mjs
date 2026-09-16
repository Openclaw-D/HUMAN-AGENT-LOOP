#!/usr/bin/env node
// verify-clean-start.mjs — D-29 预自验：把 manifest 列出的文件复制到干净临时目录，
// npm ci（按 lockfile 全新安装）→ 迁移 → 启动内核 → 健康检查 → 清理。
// 用法：node scripts/verify-clean-start.mjs
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(A_ROOT, 'assembly', 'manifest.json'), 'utf8'));
const workDir = path.join(A_ROOT, '.clean-start-verify');
const PORT = '48599';

console.log('[clean] 清理旧目录并复制 manifest 文件...');
try { rmSync(workDir, { recursive: true, force: true }); } catch { /* Windows 文件锁：残留由下次清理 */ }
mkdirSync(path.join(workDir, 'migrations'), { recursive: true });
for (const entry of manifest.sourceFiles) {
  const src = path.join(A_ROOT, entry.file);
  const dst = path.join(workDir, entry.file);
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst);
}
cpSync(path.join(A_ROOT, 'package.json'), path.join(workDir, 'package.json'));
cpSync(path.join(A_ROOT, 'package-lock.json'), path.join(workDir, 'package-lock.json'));

console.log('[clean] npm ci（全新按 lockfile 安装）...');
const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: workDir, encoding: 'utf8', shell: process.platform === 'win32' });
if (ci.status !== 0) {
  console.error('[clean] npm ci 失败：', (ci.stderr ?? ci.stdout ?? '').slice(-800));
  process.exit(1);
}

console.log('[clean] 启动内核（无凭据目录=敏感写失败关闭模式）...');
const child = spawn('node', ['src/index.ts', '--port', PORT], { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
child.stdout.on('data', (d) => logs.push(d.toString()));
child.stderr.on('data', (d) => logs.push(d.toString()));
let ok = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    if (res.status === 200) {
      const body = await res.json();
      console.log('[clean] healthz:', JSON.stringify(body));
      ok = body.ok === true && body.db === 'up';
      break;
    }
  } catch { /* 未起 */ }
  await new Promise((r) => setTimeout(r, 500));
}
child.kill();
await new Promise((r) => setTimeout(r, 800));
try { rmSync(workDir, { recursive: true, force: true }); } catch (e) { console.log('[clean] 清理临时目录暂被占用（无碍）：', e.code); }
console.log(ok ? '[clean] PASS：干净目录+lockfile 安装+启动+健康检查 全通' : '[clean] FAIL');
console.log((logs.join('')).split('\n').filter((l) => l.includes('[kernel]')).join('\n'));
process.exit(ok ? 0 : 1);
