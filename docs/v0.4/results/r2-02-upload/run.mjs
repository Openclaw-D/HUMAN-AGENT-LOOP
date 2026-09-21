// R2-02 独立运行器：PG 可达性门 → v04-upload-assembly 两套件 → 汇总退出码。
// 用法：node docs/v0.4/results/r2-02-upload/run.mjs
// 环境变量（均有默认值，默认指向本路容器 jw-v04r2-upload-pg@25461）：
//   JW_A_ADMIN_DB_URL                                 A 内核隔离库管理连接
//   R2_UPLOAD_CONNECTORS_PG_PORT/USER/PASSWORD/DATABASE  Connectors 侧（同容器、独立测试库）
// 退出码：0=全部通过；1=有断言失败；2=阻点（隔离PG不可达，跳过不计通过）。
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const A_ROOT = path.join(ROOT, 'Back', 'A');
const EDGE_ROOT = path.join(ROOT, 'Back', 'Edge');
const ADMIN_DB = process.env.JW_A_ADMIN_DB_URL ?? 'postgres://jwv04r2:jwv04r2@127.0.0.1:25461/cnext';
const FILES = ['test/v04-upload-assembly.test.mjs', 'test/v04-upload-assembly-boundaries.test.mjs'];

const ping = spawnSync('node', ['-e', `
import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DB, connectionTimeoutMillis: 8000 });
p.query('SELECT 1').then(() => { console.log('[run] postgres OK'); return p.end(); })
  .catch((e) => { console.error('[run] postgres 不可达:', e.message); process.exit(1); });
`], { env: { ...process.env, DB: ADMIN_DB }, cwd: A_ROOT, stdio: 'inherit' });
if (ping.status !== 0) {
  console.error('[run] 阻点：隔离PG不可达（本路容器 jw-v04r2-upload-pg@25461）。跳过不计通过。');
  process.exit(2);
}

const child = spawn('node', ['--test', '--test-concurrency=1', ...FILES], {
  cwd: EDGE_ROOT,
  env: {
    ...process.env,
    JW_A_ADMIN_DB_URL: ADMIN_DB,
    R2_UPLOAD_CONNECTORS_PG_PORT: process.env.R2_UPLOAD_CONNECTORS_PG_PORT ?? '25461',
    R2_UPLOAD_CONNECTORS_PG_USER: process.env.R2_UPLOAD_CONNECTORS_PG_USER ?? 'jwv04r2',
    R2_UPLOAD_CONNECTORS_PG_PASSWORD: process.env.R2_UPLOAD_CONNECTORS_PG_PASSWORD ?? 'jwv04r2',
    R2_UPLOAD_CONNECTORS_PG_DATABASE: process.env.R2_UPLOAD_CONNECTORS_PG_DATABASE ?? 'cnext',
  },
  stdio: 'inherit',
});
child.on('exit', (code) => {
  console.log(`[run] v04-upload-assembly 套件退出码：${code}（0=全部通过）`);
  process.exit(code ?? 1);
});
