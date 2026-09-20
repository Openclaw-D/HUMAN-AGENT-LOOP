// BQA-R2 包01 · 上传授权与撤权隔离 · 独立运行器
// 运行：node docs/v0.3/backend-qa-r2/results/auth-upload/run.mjs
// 退出码：0=全部通过；1=存在断言失败；2=阻点（专用PG不可达等，跳过不计通过）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// run.mjs → auth-upload → results → backend-qa-r2 → v0.3 → docs → JW（上跳5级）
const JW_ROOT = join(HERE, '..', '..', '..', '..', '..');
const CONN = (p) => `file:///${join(JW_ROOT, 'Back/Connectors', p).replace(/\\/g, '/')}`;

const PORT = process.env.CONNECTORS_TEST_PG_PORT ?? process.env.BQA_PG_PORT ?? 25443;
const PG = { host: '127.0.0.1', port: Number(PORT),
  user: process.env.CONNECTORS_TEST_PG_USER ?? process.env.BQA_PG_USER ?? 'cnext',
  password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? process.env.BQA_PG_PASSWORD ?? 'cnext',
  database: process.env.CONNECTORS_TEST_PG_DATABASE ?? process.env.BQA_PG_DATABASE ?? 'cnext' };

mkdirSync(join(HERE, 'logs'), { recursive: true });

// 门1：专用PG可达性。不可达=阻点，非零退出；跳过不得计通过。
try {
  const { makeStore } = await import(CONN('src/store/pg.mjs'));
  const probe = makeStore({ ...PG, connectionTimeoutMillis: 3000, max: 1 });
  try { await probe.query('SELECT 1'); } finally { await probe.close(); }
  console.log(`[runner] dedicated PostgreSQL reachable at ${PG.host}:${PG.port} (db=${PG.database})`);
} catch (err) {
  const msg = `[runner] BLOCKED: 专用测试PostgreSQL ${PG.host}:${PG.port} 不可达（${err.code ?? ''} ${err.message}）。真实SQL/事务/锁竞争未验证，不计通过。`;
  console.error(msg);
  writeFileSync(join(HERE, 'logs', 'blocked.txt'), `${new Date().toISOString()} ${msg}\n`);
  process.exit(2);
}

// 门2：本包测试。真实PG套件 + 独立HTTP适配器套件。
const files = ['tests/upload-context.pg-bqa.test.mjs', 'tests/upload-context.http-bqa.test.mjs'];
const child = spawnSync(process.execPath, ['--test', ...files], {
  cwd: HERE,
  env: { ...process.env, CONNECTORS_TEST_PG_PORT: String(PORT),
    CONNECTORS_TEST_PG_USER: PG.user, CONNECTORS_TEST_PG_PASSWORD: PG.password, CONNECTORS_TEST_PG_DATABASE: PG.database },
  encoding: 'utf8',
});
writeFileSync(join(HERE, 'logs', 'package-tests.log'), child.stdout ?? '');
if (child.stderr) writeFileSync(join(HERE, 'logs', 'package-tests.stderr.log'), child.stderr);
process.stdout.write(child.stdout ?? '');
process.stderr.write(child.stderr ?? '');

const summary = (child.stdout ?? '').match(/^# (tests|pass|fail|skipped)\s+\d+/gm)?.join(' | ') ?? 'no summary';
console.log(`\n[runner] node --test exit=${child.status} (${summary})`);
console.log('[runner] 提示：A上传权限投影缺失为单列阻点（见REPORT.md），本包只验候选service与独立HTTP适配器。');
process.exit(child.status ?? 1);
