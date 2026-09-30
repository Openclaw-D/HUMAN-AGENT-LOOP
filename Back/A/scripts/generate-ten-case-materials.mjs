// 一次性材料包生成：十套 CSV（常见格式）+ MANIFEST（sha256）。种子器登记材料时引用同一 hash。
// 复跑安全：确定性渲染，同 fixtures 必产出同字节。用法（仓库根）：
//   node Back/A/scripts/generate-ten-case-materials.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, caseFacts, renderCsv, FINANCIAL_KEYS, EQUIPMENT_KEYS, TRANSACTION_SCOPE } from './ten-cases-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(repo, 'docs/integration/2026-09-30-final/materials');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const manifest = { generatedAt: new Date().toISOString(), sourceMode: 'synthetic（合成演示材料，非真实客户数据）', transactionScope: TRANSACTION_SCOPE, files: {}, cases: [] };

for (const c of CASES) {
  const facts = caseFacts(c);
  const dir = path.join(outDir, c.caseId);
  await mkdir(dir, { recursive: true });
  const files = [
    { name: 'financial_summary.csv', text: renderCsv(FINANCIAL_KEYS, facts) },
    { name: 'equipment_list.csv', text: renderCsv(EQUIPMENT_KEYS, facts) },
  ];
  if (c.extraConflict) {
    const rows = ['fact_key,value,unit,grade,source_note',
      `${c.extraConflict.factKey},${c.extraConflict.value},CNY,${c.extraConflict.grade},${c.extraConflict.source}`].join('\n') + '\n';
    files.push({ name: c.extraConflict.fileName, text: rows });
  }
  for (const f of files) {
    const buf = Buffer.from(f.text, 'utf8');
    await writeFile(path.join(dir, f.name), buf);
    manifest.files[`${c.caseId}/${f.name}`] = { sha256: sha256(buf), bytes: buf.length };
  }
  manifest.cases.push({ caseId: c.caseId, displayOrder: c.displayOrder, category: c.category, businessName: c.businessName,
    summary: c.summary, checkpointExpect: c.expectedCheckpoint ?? null,
    factCount: Object.keys(facts).length + (c.extraConflict ? 1 : 0), files: files.map(f => f.name) });
}
// 独立期望单独维护（EXPECTED.json，手工推导）；MANIFEST 只登记字节事实。
await writeFile(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ok: true, dir: outDir, files: Object.keys(manifest.files).length, cases: manifest.cases.length }));
