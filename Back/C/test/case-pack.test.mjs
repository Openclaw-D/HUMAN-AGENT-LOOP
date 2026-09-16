// 案例包/模板/规则包结构与抽象性测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCaseSetStructure, detectTurnState, validateCalcInput } from '../src/case-checker.mjs';
import { calculateRatio } from '../src/ratio-tool.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const mainSet = load('scenarios/leasing-cases-v1.json');
const leasingTemplate = load('templates/commercial-leasing-v1.json');
const nonLeasingTemplate = load('templates/non-leasing-counterexample-v1.json');
const rulePack = load('rules/rule-pack-v2.json');

test('主案例包：8 案、≥2 多轮、结构全过', () => {
  assert.equal(mainSet.cases.length, 8, '必须恰好 8 个差异化案例');
  const multi = mainSet.cases.filter((c) => c.multiTurn === true);
  assert.ok(multi.length >= 2, `多轮案例须 ≥2，实际 ${multi.length}`);
  assert.deepEqual(multi.map((c) => c.caseId), ['L3-injection-new-rough-statements', 'L4-casting-hidden-debt']);
  for (const m of multi) assert.ok(m.turns.length >= 2);
  assert.deepEqual(validateCaseSetStructure(mainSet), [], '结构校验零问题');
  // 每案风险机制互异（caseId 唯一 + riskMechanism 非空）
  const mechanisms = new Set(mainSet.cases.map((c) => c.riskMechanism));
  assert.equal(mechanisms.size, 8);
  // 固定 seed 记录在案
  assert.equal(typeof mainSet.seed, 'string');
});

test('证据纪律：数值证据五级齐全；unknown 级不得进计算输入', () => {
  for (const c of mainSet.cases) {
    for (const t of c.turns) {
      const st = detectTurnState(t);
      const cv = validateCalcInput(t);
      for (const p of cv.problems) assert.fail(`${c.caseId} turn${t.turn}: ${p}`);
      if (cv.present) {
        const unknownIds = new Set(st.unknownGradeNumerics);
        for (const side of ['monthlyOperatingCashFlow', 'monthlyDebtService']) {
          const input = t.calcInput?.[side];
          if (input) assert.ok(!unknownIds.has(input.source.evidenceId), `${c.caseId}: unknown 级证据不得作计算输入`);
        }
      }
    }
  }
});

test('目标模板（租赁）：六角色固定 roleId、人工终门、失效映射指标在范围内', () => {
  const roleIds = leasingTemplate.roles.map((r) => r.roleId);
  assert.deepEqual([...roleIds].sort(), ['asset', 'business', 'commerce', 'credit', 'jianwei', 'policy']);
  const humanGates = leasingTemplate.goalTypes.filter((g) => g.executorType === 'human_only');
  assert.ok(humanGates.length >= 1, '必须有 human_only 终门');
  assert.ok(leasingTemplate.authorityNote.includes('authority=none'));
  const indicators = new Set(rulePack.scope.indicators);
  for (const m of leasingTemplate.invalidationMap) {
    assert.ok(indicators.has(m.indicator), `失效映射指标 ${m.indicator} 必须在规则包范围内`);
  }
});

test('抽象反例（非租赁）：无租赁概念字段 + 租赁专用工具被门禁 + 通用工具复用', () => {
  const leaseRe = /租金|租赁|回租|直租|现金流覆盖|债务偿付|lease/i;
  const json = JSON.stringify(nonLeasingTemplate.goalTypes);
  assert.ok(!leaseRe.test(json), `非租赁模板 goalTypes 不得含租赁概念：${leaseRe.exec(json)?.[0] ?? ''}`);
  assert.ok(!nonLeasingTemplate.goalTypes.some((g) => (g.allowedTools ?? []).includes('calc:cash-flow-coverage@1')), '租赁专用工具不得出现在非租赁模板');
  // 工具门禁：对非租赁模板，现金流覆盖工具触发 rule_not_covered（抽象反例的可判定检验）
  const gate = (template, toolId) => template.goalTypes.some((g) => (g.allowedTools ?? []).includes(toolId));
  assert.equal(gate(nonLeasingTemplate, 'calc:cash-flow-coverage@1'), false, '→ 套用即 rule_not_covered 升级');
  assert.equal(gate(nonLeasingTemplate, 'calc:ratio@1'), true, '通用比值工具两侧通用');
  assert.equal(gate(leasingTemplate, 'calc:ratio@1'), true);
  // 通用工具在非租赁输入上正常工作
  const r = calculateRatio({
    label: 'price_benchmark',
    numerator: { value: 12, caliber: '年度报价（万元）', source: { evidenceId: 'nl-quote', version: 1 } },
    denominator: { value: 10, caliber: '市场基准（万元）', source: { evidenceId: 'nl-bench', version: 1 } },
  });
  assert.equal(r.ok, true);
});

test('规则包 v2：用户约束七条 + v1 升级理由全保留 + 新增理由', () => {
  assert.equal(rulePack.version, '2.0.0');
  const constraintIds = new Set(rulePack.userConstraints.map((c) => c.id));
  for (const id of ['incomplete_not_auto_reject', 'high_interest_not_risk_coverage', 'no_fabricated_net_income', 'region_not_label', 'question_limit_3', 'evidence_five_grades', 'tendency_is_candidate_not_approval']) {
    assert.ok(constraintIds.has(id), `缺用户约束 ${id}`);
  }
  const reasons = new Set(rulePack.humanEscalation.map((h) => h.reason));
  for (const r of ['rule_not_covered', 'missing_input', 'caliber_change', 'evidence_conflict', 'superseded_evidence_cited', 'model_output_invalid', 'call_not_sent', 'call_unknown', 'calc_mismatch', 'uncertainty_understatement']) {
    assert.ok(reasons.has(r), `v1 升级理由 ${r} 必须保留`);
  }
  for (const r of ['ownership_dispute', 'unknown_cost_in_income', 'high_rate_as_risk_coverage', 'region_label_reject', 'over_question_limit']) {
    assert.ok(reasons.has(r), `缺新增升级理由 ${r}`);
  }
  assert.deepEqual(rulePack.scope.allowedTools, ['calc:cash-flow-coverage@1', 'calc:ratio@1']);
});
