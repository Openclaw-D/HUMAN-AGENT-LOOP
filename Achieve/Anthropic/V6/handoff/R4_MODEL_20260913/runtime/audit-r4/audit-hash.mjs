// 审计用:独立核对 evidence/r3-baseline-input-hashes.txt(40 文件)是否与工作区现状一致。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lines = readFileSync(join(root, 'evidence', 'r3-baseline-input-hashes.txt'), 'utf8').trim().split(/\r?\n/);
let ok = 0, bad = 0, missing = 0;
for (const line of lines) {
  const m = line.match(/^([0-9a-f]{64}) \*(.+)$/);
  if (!m) continue;
  const want = m[1];
  const file = m[2];
  try {
    const got = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
    if (got === want) ok += 1;
    else { bad += 1; console.log('MISMATCH', file); }
  } catch {
    missing += 1;
    console.log('MISSING', file);
  }
}
console.log(`baseline files checked: ${ok + bad + missing} | match: ${ok} | mismatch: ${bad} | missing: ${missing}`);
process.exit(bad + missing > 0 ? 1 : 0);
