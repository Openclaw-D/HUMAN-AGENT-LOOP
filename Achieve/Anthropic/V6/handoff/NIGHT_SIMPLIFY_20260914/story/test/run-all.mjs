// 测试运行器：本机环境 node --test <dir> 会 MODULE_NOT_FOUND，必须显式文件列表。
// 用法：node test/run-all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, 'story-data.test.mjs'),
  path.join(here, 'state-machine.test.mjs'),
  path.join(here, 'a-shape.test.mjs'),
];
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
