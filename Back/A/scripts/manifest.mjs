#!/usr/bin/env node
// manifest.mjs — 最终交付清单（旧 D-11 教训：必须覆盖传递源文件 + lockfile，全部带 sha256）。
// 用法：node scripts/manifest.mjs   → assembly/manifest.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_ROOT = path.resolve(__dirname, '..');
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (['node_modules', '.pgdata', 'evidence'].includes(entry)) continue; // 依赖目录与证据快照不入源清单
      walk(full, base, out);
    } else {
      out.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

// 清单不含自身；任意路径段以 '.' 开头（.b-final-runtime 等运行时产物）均排除
const sources = walk(A_ROOT)
  .filter((f) => !f.split('/').some((seg) => seg.startsWith('.')))
  .filter((f) => f !== 'assembly/manifest.json')
  .sort();
const manifest = {
  manifestVersion: '1.0.0',
  lane: 'V7/backend-next/A',
  contract: { file: '../CONTRACT.md', version: 'v1.3 (v1.2及之前FROZEN;新增候选语义PENDING-USER-RULING)', sha256: sha256(path.join(A_ROOT, '..', 'CONTRACT.md')) },
  lockfile: { file: 'package-lock.json', sha256: sha256(path.join(A_ROOT, 'package-lock.json')) },
  packageJson: { file: 'package.json', sha256: sha256(path.join(A_ROOT, 'package.json')) },
  generatedAt: new Date().toISOString(),
  sourceFiles: sources.map((f) => ({ file: f, sha256: sha256(path.join(A_ROOT, f)) })),
  note: '传递源清单：src/ test/ scripts/ assembly/ migrations/ templates/ + 配置；验证方按 sha256 复算即可发现漂移。',
};
writeFileSync(path.join(A_ROOT, 'assembly', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[manifest] ${manifest.sourceFiles.length} 个源文件 + lockfile + package.json → assembly/manifest.json`);
for (const f of manifest.sourceFiles) console.log(`  ${f.sha256.slice(0, 12)}…  ${f.file}`);
