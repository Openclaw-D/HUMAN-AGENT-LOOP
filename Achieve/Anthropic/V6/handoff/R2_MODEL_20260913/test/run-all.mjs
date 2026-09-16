#!/usr/bin/env node
// 一次命令运行全部测试:node test/run-all.mjs
// 仅用 Node 内置(node:test),零外部依赖;全部纯内存,不监听端口、不发真实模型请求。
// 说明:显式 readdir 列出测试文件(本环境 node --test 传目录参数会 MODULE_NOT_FOUND)。
// R2 新增(INTERFACE_R2 §4):结束后把"TAP 汇总+时间+node 版本"写入
// <运行时输出目录>/last-run-summary.txt(目录解析复用 helpers.testOutputDir():
// R2_MODEL_TEST_OUT_DIR 优先,缺省 <交付根>/runtime/<时间戳>-pid<pid>/);
// 控制台输出保留(逐段透传),子进程退出码透传。
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { testOutputDir } from './helpers.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const unitDir = path.join(dir, 'unit');
const files = readdirSync(unitDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join(unitDir, f));

if (files.length === 0) {
  console.error('未找到任何 *.test.mjs 测试文件');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: ['inherit', 'pipe', 'inherit'], // stdout 捕获(用于汇总),stderr 透传
  cwd: dir,
});
let tap = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  tap += text;
  process.stdout.write(text); // 控制台输出保留
});
const code = await new Promise((resolve) => {
  child.on('close', (c) => resolve(c ?? 1));
  child.on('error', () => resolve(1));
});

// 提取 TAP 汇总行(# tests / # pass / # fail / # duration_ms 等)。
const summaryLines = tap.split('\n').filter((line) => /^#\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line));

const summaryText = [
  'R2 模型适配器 · 测试运行汇总',
  '================================',
  `时间:${new Date().toISOString()}`,
  `node:${process.version}(${process.platform})`,
  `命令:node --test ${files.length} 个测试文件(test/unit/*.test.mjs 显式列出)`,
  `退出码:${code}`,
  '',
  'TAP 汇总:',
  ...(summaryLines.length > 0 ? summaryLines : ['(未捕获到 TAP 汇总行)']),
  '',
  '说明:测试可变输出只写运行时输出目录,不改冻结源与 MANIFEST.json;',
  '核验:node tools/verify-frozen-hash.mjs。',
  '',
].join('\n');
const summaryPath = path.join(testOutputDir(), 'last-run-summary.txt');
writeFileSync(summaryPath, summaryText, 'utf8');
console.log(`[run-all] 运行汇总已写入:${summaryPath}`);

process.exit(code);
