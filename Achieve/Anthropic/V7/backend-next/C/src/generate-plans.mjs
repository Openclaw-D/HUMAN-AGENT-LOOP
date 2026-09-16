// 生成 A assembly 可直接消费的项目实例化计划（每案例一个 JSON，含证据提交顺序/HumanRequest 草稿）。
// 用法：node src/generate-plans.mjs   （写 scenarios/plans/*.json；确定性输出）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCaseProjectPlan as toPlan } from './contract-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const mainSet = JSON.parse(readFileSync(path.join(root, 'scenarios', 'leasing-cases-v1.json'), 'utf8'));
const leasing = JSON.parse(readFileSync(path.join(root, 'templates', 'commercial-leasing-v1.json'), 'utf8'));

const dir = path.join(root, 'scenarios', 'plans');
mkdirSync(dir, { recursive: true });

const summary = [];
for (const c of mainSet.cases) {
  const plan = toPlan(c, { templateId: leasing.templateId });
  if (!plan.steps || plan.stepCount === 0) { console.error(`FAIL plan ${c.caseId}`); process.exit(1); }
  const file = path.join(dir, `${c.caseId}.plan.json`);
  writeFileSync(file, JSON.stringify({
    planVersion: '1.0.0',
    contractRef: 'A CONTRACT v0.1',
    templateRef: { templateId: leasing.templateId, note: 'A 落库后以实际 templateId 回填实例化' },
    ...plan,
  }, null, 2));
  summary.push(`${c.caseId}: ${plan.stepCount} steps`);
}
console.log(`[plans] 已生成 ${mainSet.cases.length} 份实例化计划 → scenarios/plans/`);
for (const s of summary) console.log('  ' + s);
