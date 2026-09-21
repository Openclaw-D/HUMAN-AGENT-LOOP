// 01 路独立运行器：PG 可达性门 → v04-upload 两套件 → 汇总退出码。
// 用法：node docs/v0.4/results/01-upload/run.mjs
// 环境变量（均有默认值，默认指向本路容器）：
//   JW_A_ADMIN_DB_URL  postgres://jwv04:jwv04@127.0.0.1:25451/postgres
// 退出码：0=全部通过；1=有断言失败；2=阻点（隔离PG不可达，跳过不计通过）。
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'Back', 'A');
const ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://jwv04:jwv04@127.0.0.1:25451/postgres';
const FILES = ['test/v04-upload-authz.test.mjs', 'test/v04-upload-failclosed.test.mjs'];

const ping = spawnSync('node', ['-e', `
import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DB, connectionTimeoutMillis: 8000 });
p.query('SELECT 1').then(() => { console.log('[run] postgres OK'); return p.end(); })
  .catch((e) => { console.error('[run] postgres 不可达:', e.message); process.exit(1); });
`], { env: { ...process.env, DB: ADMIN_DB }, cwd: A_ROOT, stdio: 'inherit' });
if (ping.status !== 0) {
  console.error('[run] 阻点：隔离PG不可达（本路容器 jw-v0401-upload-pg@25451）。跳过不计通过。');
  process.exit(2);
}

const child = spawn('node', ['--test', '--test-concurrency=1', ...FILES], {
  cwd: A_ROOT,
  env: { ...process.env, JW_A_ADMIN_DB_URL: ADMIN_DB },
  stdio: 'inherit',
});
child.on('exit', (code) => {
  console.log(`[run] v04-upload 套件退出码：${code}（0=全部通过）`);
  process.exit(code ?? 1);
});
