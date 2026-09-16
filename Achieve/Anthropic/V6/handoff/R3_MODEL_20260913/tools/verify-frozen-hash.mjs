#!/usr/bin/env node
// 冻结 hash 核验(R2,INTERFACE_R2 §4):读 MANIFEST.json,对 files[].path 逐个重算
// SHA256 并与清单比对,输出逐文件匹配表 + 汇总。
// 用法:node tools/verify-frozen-hash.mjs [--quiet]
//   退出码 0 = 全部匹配;1 = 清单不存在/不可读/存在差异(差异路径列出)。
//   --quiet:省略逐文件匹配表,仅输出汇总与差异行(差异必须始终可见)。
// 用途:验收方(Codex)复跑测试后,核验冻结交付源未被测试运行改写
// (R2 起测试可变输出只写 runtime/,不进清单)。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const manifestPath = path.join(root, 'MANIFEST.json');

if (!existsSync(manifestPath)) {
  console.error(`清单不存在:${manifestPath}`);
  console.error('请先运行 node tools/gen-manifest.mjs 生成 MANIFEST.json,再执行核验。');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`清单不可读(JSON 解析失败):${err && err.message ? err.message : err}`);
  process.exit(1);
}
if (!manifest || !Array.isArray(manifest.files)) {
  console.error('清单格式无效:缺少 files 数组,无法核验。');
  process.exit(1);
}

const rows = [];
const mismatches = [];
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
    mismatches.push('(清单内存在缺少 path/sha256 的条目)');
    rows.push({ path: '(无效条目)', expected: '', actual: '', missing: false, ok: false });
    continue;
  }
  const full = path.join(root, entry.path);
  const missing = !existsSync(full);
  const actual = missing ? null : createHash('sha256').update(readFileSync(full)).digest('hex');
  const ok = !missing && actual === entry.sha256;
  rows.push({ path: entry.path, expected: entry.sha256, actual, missing, ok });
  if (!ok) mismatches.push(missing ? `${entry.path}(文件缺失)` : entry.path);
}

if (!quiet) {
  console.log(`冻结 hash 核验:清单 ${path.relative(root, manifestPath)}(frozenAt=${manifest.frozenAt || '未记录'})`);
  console.log(`${'文件'.padEnd(46)} 状态  SHA256 前12位(清单→实际)`);
  for (const r of rows) {
    const status = r.ok ? 'OK  ' : (r.missing ? 'MISS' : 'DIFF');
    const pair = `${String(r.expected).slice(0, 12)}→${r.missing ? '(缺失)' : String(r.actual).slice(0, 12)}`;
    console.log(`${r.path.padEnd(46)} ${status}  ${pair}`);
  }
}

console.log(`核验汇总:共 ${rows.length} 个文件,匹配 ${rows.length - mismatches.length},不匹配 ${mismatches.length}`);
if (mismatches.length > 0) {
  console.error('不匹配文件(冻结源被改动或缺失):');
  for (const m of mismatches) console.error(`  - ${m}`);
  console.error('若为测试运行所致,属缺陷:R2 起测试可变输出必须只写 runtime/(见 INTERFACE_R2 §4)。');
  process.exit(1);
}
console.log('全部匹配:冻结源与 MANIFEST.json 一致。');
process.exit(0);
