// R4:对产品内相机控制器副本(jianwei-v3/site/lib/...)运行105项回归。
// 生成副本仅改import为产品文件file://URL(runtime生成,不入冻结件);语义必须与R3候选一致(产品副本仅多1行JSDoc)。
// 用法: node tools/run-product-regression.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]+$/, '');
const batchDir = join(root, '..');
const outDir = join(batchDir, 'runtime', 'regression-product');
const productController = join(batchDir, '..', '..', '..', 'jianwei-v3', 'site', 'lib', 'v5-preview', 'camera', 'camera-controller.mjs');
const r3Tests = join(batchDir, '..', 'R3_CAMERA_20260913', 'test');
const r3Controller = join(batchDir, '..', 'R3_CAMERA_20260913', 'src', 'camera-controller.mjs');

const files = [
  'regression-generated/camera-controller.test.mjs',
  'regression-generated/resource-tracking.test.mjs',
  'regression-generated/adversarial.test.mjs',
  'regression-generated/stress-loop.test.mjs',
  'regression-generated/metadata-integrity.test.mjs',
  'r3-contract.test.mjs',
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
import { createHash } from 'node:crypto';

if (!existsSync(productController)) {
  console.error('PRODUCT_CONTROLLER_NOT_FOUND: ' + productController);
  process.exit(2);
}

// 语义一致性核对:产品副本 vs R3候选(允许块注释差异;逐行剥离后必须为0)
const r3Src = readFileSync(r3Controller, 'utf8');
const prodSrc = readFileSync(productController, 'utf8');
const stripLines = (s) => s.split(/\r?\n/)
  .filter((l) => !/^\s*\/\*\*/.test(l))
  .filter((l) => !/^\s*\*/.test(l))
  .map((l) => l.replace(/\s+$/, ''));
const semanticDiffLines = (() => {
  const a = stripLines(r3Src);
  const b = stripLines(prodSrc);
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d += 1;
  return d;
})();
const semanticDiff = semanticDiffLines === 0;

mkdirSync(outDir, { recursive: true });
const productUrl = pathToFileURL(productController).href;
const generated = [];
for (const f of files) {
  const src = readFileSync(join(r3Tests, f), 'utf8');
  const out = src.replace(/(['"])(\.\.\/)+src\/camera-controller\.mjs\1/g, JSON.stringify(productUrl));
  const outFile = join(outDir, f.replace(/[\\/]/g, '__'));
  writeFileSync(outFile, out);
  generated.push(outFile);
}

const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...generated], {
  cwd: outDir,
  encoding: 'utf8',
  timeout: 240000,
});
const tap = r.stdout ?? '';
const totals = tap.match(/^# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/m);
const result = {
  schema: 'r4-product-regression/v1',
  productController,
  productSha256: sha256(Buffer.from(prodSrc)),
  r3CandidateSha256: sha256(Buffer.from(r3Src)),
  semanticDiffLines,
  semanticDiffAfterStrippingComments: semanticDiff,
  note: '产品副本与R3候选唯一差异为1行JSDoc注释;本回归直接以产品文件为被测对象',
  totals: { tests: totals ? Number(totals[1]) : null, pass: totals ? Number(totals[2]) : null, fail: totals ? Number(totals[3]) : null, exitCode: r.status },
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(result, null, 2));
writeFileSync(join(outDir, 'tap-output.log'), tap);
console.log(JSON.stringify(result.totals));
console.log('semanticDiffAfterStrippingComments=' + semanticDiff);
console.log('log=' + join(outDir, 'tap-output.log'));
process.exit(r.status === 0 ? 0 : 1);
