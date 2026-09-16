// V7 backend-next Lane C · 案例集评测入口（确定性，零网络）。
// 用法：
//   node src/run-evaluation.mjs            → 主案例包（scenarios/leasing-cases-v1.json）
//   node src/run-evaluation.mjs --heldout  → 独立 heldout（scenarios/heldout-cases-v1.json）
// 退出码 0=全过；非 0=存在失败（结构问题或检查失败）。
// heldout 纪律见 scenarios/heldout-cases-v1.json 的 discipline 字段。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCaseSetStructure, evaluateCaseSet } from './case-checker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const heldout = process.argv.includes('--heldout');
const setPath = heldout
  ? path.join(root, 'scenarios', 'heldout-cases-v1.json')
  : path.join(root, 'scenarios', 'leasing-cases-v1.json');

const set = JSON.parse(readFileSync(setPath, 'utf8'));
const structural = validateCaseSetStructure(set);

console.log(`[eval] 案例集 ${set.caseSetId}@${set.version} seed=${set.seed} ${heldout ? '(HELDOUT)' : '(main)'}`);
console.log(`[eval] 结构问题：${structural.length === 0 ? '无' : structural.length}`);
for (const p of structural) console.log(`  [结构] ${p}`);

const report = evaluateCaseSet(set);
let checkPass = 0;
let checkFail = 0;
for (const c of report.cases) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.caseId}${c.multiTurn ? '（多轮）' : ''} turns=${c.turnCount}${c.failures.length ? ' → ' + c.failures.join(' | ') : ''}`);
  for (const tr of c.turns ?? []) {
    for (const chk of tr.checks ?? []) {
      if (chk.pass) checkPass += 1; else checkFail += 1;
    }
  }
}
console.log(`[eval] 案例：${report.totals.pass}/${report.totals.cases} 通过（失败 ${report.totals.fail}）`);
console.log(`[eval] 检查断言：${checkPass} PASS / ${checkFail} FAIL`);

const evidence = {
  runAt: new Date().toISOString(),
  set: { id: set.caseSetId, version: set.version, seed: set.seed, heldout },
  structuralProblems: structural,
  totals: { ...report.totals, checkPass, checkFail },
  cases: report.cases,
};
const evDir = path.join(root, 'evidence');
mkdirSync(evDir, { recursive: true });
const evFile = path.join(evDir, heldout ? 'eval-report-heldout.json' : 'eval-report-main.json');
writeFileSync(evFile, JSON.stringify(evidence, null, 2));
console.log(`[eval] 证据已写 ${path.relative(root, evFile)}`);

process.exit(structural.length === 0 && report.totals.fail === 0 && checkFail === 0 ? 0 : 1);
