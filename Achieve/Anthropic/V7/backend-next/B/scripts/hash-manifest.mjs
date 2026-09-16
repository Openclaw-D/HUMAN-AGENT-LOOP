#!/usr/bin/env node
// 固定发布清单:对 B 全部交付文件算 sha256,写 evidence/b-release-manifest.json。
// 覆盖:src/test/scripts/config/spike + package.json + package-lock.json(旧 D-11 教训:
// 清单必须覆盖传递源与 lockfile)。D 以此核对所测字节。
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INCLUDE_DIRS = ['src', 'test', 'scripts', 'config', 'spike'];
const EXCLUDE = ['node_modules', '.tmp', 'deliveries.jsonl'];

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

async function main() {
  const files = [];
  for (const d of INCLUDE_DIRS) {
    try { await walk(path.join(ROOT, d), files); } catch { /* 目录不存在 */ }
  }
  for (const f of ['package.json', 'package-lock.json']) {
    try { files.push(path.join(ROOT, f)); } catch { /* 无 */ }
  }
  const manifest = { generatedAt: new Date().toISOString(), lane: 'backend-next/B', algorithm: 'sha256', files: {} };
  files.sort();
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    manifest.files[rel] = createHash('sha256').update(await fs.readFile(f)).digest('hex');
  }
  manifest.fileCount = Object.keys(manifest.files).length;
  const out = path.join(ROOT, 'evidence/b-release-manifest.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`manifest 写入 ${out}:${manifest.fileCount} 文件`);
}

main().catch((e) => { console.error(e); process.exit(1); });
