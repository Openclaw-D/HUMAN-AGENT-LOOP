// V7 backend-next Lane C · 统一测试入口（显式文件清单；本环境 node --test <目录> 会 MODULE_NOT_FOUND）。
// 断言数量与失败计数落 stdout；任何用例失败 → 进程退出码非 0。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'mock-server.test.mjs',
  'calculation-tool.test.mjs',
  'ratio-tool.test.mjs',
  'case-pack.test.mjs',
  'contract-adapter.test.mjs',
  'four-domain.test.mjs',
  'four-domain-matrix.test.mjs',
  'rule-negative.test.mjs',
  'gate-adapter.test.mjs',
  'intake-normalize.test.mjs',
  'parse-adapters.test.mjs',
  'parse-adapters-v2.test.mjs',
  'parse-material-v03.test.mjs',
  'pdf-async.test.mjs',
  'eval-discipline.test.mjs',
  'takeoff-five-domain.test.mjs',
].map((f) => path.join(here, f));

const only = process.argv.slice(2);
const targets = only.length > 0 ? only.map((f) => path.join(here, f)) : files;

console.log(`[test] 运行 ${targets.length} 个测试文件：`);
for (const f of targets) console.log(`  - ${path.basename(f)}`);

const r = spawnSync(process.execPath, ['--test', ...targets], { stdio: 'inherit' });
process.exit(r.status ?? 1);
