// MAIN用：对比baseline hash与当前源码，生成CHANGED_FILES.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const H = 'C:/Users/22673/Desktop/Anthropic/V6/handoff/SE_REBUILD_20260913';
const SITE = 'C:/Users/22673/Desktop/Anthropic/jianwei-v3/site/';
const baseline = JSON.parse(readFileSync(join(H, 'BASELINE.json'), 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tracked = [...Object.keys(baseline.files), ...baseline.newFiles];
const out = {};
for (const rel of tracked) {
  const cur = join(SITE, rel);
  const curHash = existsSync(cur) ? sha(cur) : null;
  const before = baseline.files[rel] ?? null; // new files: before=null
  out[rel] = {
    existedBefore: before !== null,
    beforeHash: before,
    afterHash: curHash,
    changed: before !== curHash,
    owner: rel.includes('remote-session') ? 'B' : rel === 'app/v5-preview/se-icons.tsx' ? 'A(MAIN创建后移交)' : rel.startsWith('app/v5-preview/') ? 'A' : 'MAIN',
  };
}
writeFileSync(join(H, 'CHANGED_FILES.json'), JSON.stringify(out, null, 2));
const changed = Object.entries(out).filter(([,v])=>v.changed).map(([k])=>k);
console.log('changed:', changed.length); console.log(changed.join('\n'));
