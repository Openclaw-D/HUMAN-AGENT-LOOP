// soak-v04-data · 现有关键 PG 回归 runner：把既有测试指向本包隔离容器（不修改被测文件）。
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soakConfig } from './harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const conf = soakConfig();
const files = [
  'test/goal02-parsing.test.mjs',
  'test/goal02-blocked-recovery.test.mjs',
  'test/upload-context.pg.test.mjs',
  'test/v03-evidence-pg.test.mjs',
];
const outDir = join(conf.runDir);
mkdirSync(outDir, { recursive: true });
const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', f], {
    cwd: join(__dirname, '..', '..'),
    env: {
      ...process.env,
      CONNECTORS_TEST_PG_PORT: String(conf.pg.port),
      CONNECTORS_TEST_PG_USER: conf.pg.user,
      CONNECTORS_TEST_PG_PASSWORD: conf.pg.password,
      CONNECTORS_TEST_PG_DATABASE: conf.pg.database,
    },
    encoding: 'utf8', timeout: 8 * 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').filter(Boolean).slice(-8).join(' | ');
  const rec = { file: f, status: r.status, timedOut: r.signal === 'SIGTERM', ms: Date.now() - t0, tail: tail.slice(0, 800) };
  results.push(rec);
  console.log(`${f} → exit=${r.status} ${rec.ms}ms`);
  console.log(`  ${tail.slice(0, 400)}`);
}
writeFileSync(join(outDir, 'regression-results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((x) => x.status !== 0);
console.log(`REGRESSIONS: ${results.length - failed.length}/${results.length} pass; failed=${failed.map((x) => x.file).join(',') || 'none'}`);
process.exit(0);
