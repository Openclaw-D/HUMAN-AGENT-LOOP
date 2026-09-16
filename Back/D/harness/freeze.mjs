// 版本冻结：对 A/B/C/CONTRACT 源文件做sha256快照（排除 node_modules/.run/.next/dist 等产物）。
// 用法：node harness/freeze.mjs <evidenceDir> [label]
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const D_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_NEXT = path.dirname(D_ROOT);
const SKIP = new Set(['node_modules', '.run', 'dist', '.next', 'build', 'coverage', '.git', '__pycache__', '.venv']);
const MAX = 20 * 1024 * 1024;

// 源码文件均<20MB，一次读入即可
function sha256Sync(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

function walk(dir, base, out) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = path.join(base, e.name);
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, rel, out);
    else if (st.isFile() && st.size <= MAX) {
      try { out[rel.split(path.sep).join('/')] = sha256Sync(abs); } catch { }
    }
  }
}

const evDir = process.argv[2];
const label = process.argv[3] || '';
if (!evDir) { console.error('usage: node harness/freeze.mjs <evidenceDir> [label]'); process.exit(2); }
const files = {};
for (const seg of ['A', 'B', 'C']) {
  const p = path.join(BACKEND_NEXT, seg);
  if (existsSync(p)) walk(p, seg, files);
  else files[`__missing__/${seg}`] = 'DIR_NOT_PRESENT';
}
const contract = path.join(BACKEND_NEXT, 'CONTRACT.md');
if (existsSync(contract)) files['CONTRACT.md'] = sha256Sync(contract);
else files['__missing__/CONTRACT.md'] = 'NOT_PRESENT';

const combined = createHash('sha256').update(Object.keys(files).sort().map(k => `${k}:${files[k]}`).join('\n')).digest('hex');
const snap = { frozenAt: new Date().toISOString(), label, combinedHash: combined, fileCount: Object.keys(files).length, files };
writeFileSync(path.join(evDir, 'SUT_VERSION.json'), JSON.stringify(snap, null, 2));
const lines = Object.keys(files).sort().map(k => `${files[k]}  ${k}`);
writeFileSync(path.join(evDir, 'sha256sums.txt'), lines.join('\n') + '\n');
console.log(`[freeze] label=${label} files=${snap.fileCount} combined=${combined.slice(0, 16)}…`);
