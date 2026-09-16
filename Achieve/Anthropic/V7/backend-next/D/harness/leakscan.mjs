// 凭据标记泄漏扫描：在给定文件集（含二进制）中查找标记串。零依赖。
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_FILE = 100 * 1024 * 1024;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.log', '.txt', '.yml', '.yaml', '.sql', '.env', '.ini', '.xml', '.html', '.csv']);

export function scanMarkers(roots, markers, { maxDepth = 12 } = {}) {
  const hits = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (seen.has(p)) continue;
      seen.add(p);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (e.isFile()) {
        let st; try { st = statSync(p); } catch { continue; }
        if (st.size > MAX_FILE) continue;
        let buf; try { buf = readFileSync(p); } catch { continue; }
        for (const m of markers) {
          if (!m) continue;
          const mb = Buffer.from(m, 'utf8');
          let idx = buf.indexOf(mb);
          let count = 0;
          while (idx !== -1 && count < 50) {
            count++;
            idx = buf.indexOf(mb, idx + 1);
          }
          if (count > 0) {
            const line = TEXT_EXT.has(path.extname(p).toLowerCase()) ? lineOf(buf, buf.indexOf(mb)) : null;
            hits.push({ file: p, marker: m, count, line });
          }
        }
      }
    }
  };
  for (const r of roots) {
    let st; try { st = statSync(r); } catch { continue; }
    if (st.isDirectory()) walk(r, 0); else scanOne(r);
  }
  function scanOne(p) {
    let buf; try { buf = readFileSync(p); } catch { return; }
    for (const m of markers) {
      if (!m) continue;
      const mb = Buffer.from(m, 'utf8');
      let idx = buf.indexOf(mb), count = 0;
      while (idx !== -1 && count < 50) { count++; idx = buf.indexOf(mb, idx + 1); }
      if (count > 0) hits.push({ file: p, marker: m, count, line: lineOf(buf, buf.indexOf(mb)) });
    }
  }
  return hits;
}
function lineOf(buf, idx) {
  if (idx < 0) return null;
  let start = idx; while (start > 0 && buf[start - 1] !== 10) start--;
  let end = idx; while (end < buf.length && buf[end] !== 10) end++;
  return buf.slice(start, end).toString('utf8').slice(0, 300);
}
// 生成一次性标记
export function marker(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
