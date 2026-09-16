// Edge E0 测试入口（对齐 D 路判定语义：串行、每文件至少 1 断言、退出码 0/1/2/3）。
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(__dirname, f));
if (files.length === 0) {
  console.error('[edge-test] 未找到测试文件');
  process.exit(1);
}

// 零断言不得 PASS（D 路规则 2）：静态检查每文件至少声明 1 个 test()。
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const count = (src.match(/\btest\s*\(/g) || []).length;
  if (count === 0) {
    console.error(`[edge-test] ${path.basename(f)} 声明了 0 个 test —— 零断言不得 PASS（exit 3）`);
    process.exit(3);
  }
}

console.log(`[edge-test] ${files.length} 个测试文件（串行）:\n  ${files.map((f) => path.basename(f)).join('\n  ')}`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
