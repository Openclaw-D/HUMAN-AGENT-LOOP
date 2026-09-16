// 测试入口：显式文件列表（本机 node --test <dir> 会 MODULE_NOT_FOUND，见 memory）。
// 用法：npm test 或 node --test test/integration-core.test.mjs test/integration-flows.test.mjs
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(__dirname, f));
if (files.length === 0) {
  console.error('未找到测试文件');
  process.exit(1);
}
console.log(`[test] ${files.length} 个测试文件（串行执行：crash 套件会重启共享 PG 容器，并行会互扰）：\n  ${files.join('\n  ')}`);
// 前置：PostgreSQL 必须可达（隔离容器 v7next-a-pg @127.0.0.1:15432）
const ping = spawnSync('node', ['-e', `
import pg from 'pg';
const p = new pg.Pool({connectionString:'postgres://v7next:v7next@127.0.0.1:15432/postgres'});
p.query('SELECT 1').then(()=>{console.log('[test] postgres OK');return p.end()}).catch(e=>{console.error('[test] postgres 不可达:',e.message);process.exit(1)});
`], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
if (ping.status !== 0) process.exit(1);

const child = spawn('node', ['--test', '--test-concurrency=1', ...files], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
