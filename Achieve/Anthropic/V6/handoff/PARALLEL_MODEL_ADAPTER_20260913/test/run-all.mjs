#!/usr/bin/env node
// 一次命令运行全部测试:node test/run-all.mjs
// 仅用 Node 内置(node:test),零外部依赖;全部纯内存,不监听端口、不发真实模型请求。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const unitDir = path.join(dir, 'unit');
const files = readdirSync(unitDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => path.join(unitDir, f));

if (files.length === 0) {
  console.error('未找到任何 *.test.mjs 测试文件');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: dir,
});
process.exit(result.status ?? 1);
