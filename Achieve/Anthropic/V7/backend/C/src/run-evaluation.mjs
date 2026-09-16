// V7 Lane C · 评估入口（可复跑）：node src/run-evaluation.mjs [输出目录]
// 执行：加载规则包 → 跑全部合成用例 → 输出判断记录与能力评估报告（JSON）。
// 退出码：全部通过 0；有失败 1（供 CI/心跳判定）。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRulePack } from './rule-pack.mjs';
import { runCaseSet } from './case-runner.mjs';
import { buildEvalReport } from './eval-report.mjs';

const outDir = resolve(process.argv[2] ?? join(process.cwd(), '..', 'evidence'));
mkdirSync(outDir, { recursive: true });

const rulePack = loadRulePack();
const caseSet = JSON.parse(readFileSync(new URL('../cases/cases-v1.json', import.meta.url), 'utf8'));
const run = await runCaseSet(rulePack, caseSet);
const report = buildEvalReport(run, rulePack);

const recordsFile = join(outDir, `laneC-case-records-${run.caseSetId}-v${run.version}.json`);
const reportFile = join(outDir, `laneC-eval-report-${report.reportId}.json`);
writeFileSync(recordsFile, JSON.stringify(run, null, 2));
writeFileSync(reportFile, JSON.stringify(report, null, 2));

console.log(`cases: ${run.passed}/${run.records.length} passed (failed: ${run.failed})`);
console.log(`rulePack: ${rulePack.rulePackId}@${rulePack.version}  provider: simulation（真实通道 blocked，见 STATUS）`);
console.log(`records -> ${recordsFile}`);
console.log(`report  -> ${reportFile}`);
process.exit(run.failed === 0 ? 0 : 1);
