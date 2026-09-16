// C → A CONTRACT v0.1 投影适配测试（纯函数；对契约文本的硬约束做本地预检断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  scanForbiddenKeys, toGoalTemplateSubmission, toEvidenceSubmission,
  toCalculationComplete, toCandidateComplete, toAEvidenceRefs,
  toHumanRequestDrafts, buildCaseProjectPlan,
} from '../src/contract-adapter.mjs';
import { calculateCashFlowCoverage } from '../src/calculation-tool.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const leasing = load('templates/commercial-leasing-v1.json');
const nonLeasing = load('templates/non-leasing-counterexample-v1.json');
const mainSet = load('scenarios/leasing-cases-v1.json');

test('FORBIDDEN_KEY 扫描：嵌套命中 + 适配载荷零命中', () => {
  assert.deepEqual(scanForbiddenKeys({ priceNotes: 1 }), ['priceNotes']);
  assert.deepEqual(scanForbiddenKeys({ a: { APPROVED: 2 } }), ['a.APPROVED']);
  assert.deepEqual(scanForbiddenKeys({ pricingNotes: 1 }), [], '"pricing" 不含 "price"（按契约正则不命中）');
  assert.deepEqual(scanForbiddenKeys({ ratio: 1, observations: ['x'] }), []);
  assert.deepEqual(scanForbiddenKeys({ recommendedHumanAction: 'accept_candidate', inputs: { period: { unit: 'month' } } }), []);
});

test('租赁模板 → A GoalTemplate 投影：形状/角色/枚举/DAG/禁键全过', () => {
  const r = toGoalTemplateSubmission(leasing, { requestId: 'req-c-lease-1' });
  assert.equal(r.ok, true, r.problems?.join(';'));
  const s = r.submission;
  assert.equal(s.roles.length, 6);
  assert.ok(s.roles.every((x) => x.isHumanRole === true));
  assert.ok(s.goals.every((g) => ['agent', 'human'].includes(g.executorKind)));
  assert.ok(s.goals.every((g) => s.roles.some((x) => x.roleKey === g.responsibleRole)));
  assert.ok(s.goals.some((g) => g.executorKind === 'agent'), '计算/汇总 goal 为 agent 执行');
  const keys = new Set(s.goals.map((g) => g.goalKey));
  for (const g of s.goals) for (const d of g.dependsOn) assert.ok(keys.has(d));
  // 禁键范围=契约 §3.1：仅 params（模板 schema 自身键名 decisionRole 等不算）
  const paramHits = s.goals.flatMap((g) => scanForbiddenKeys(g.params));
  assert.deepEqual(paramHits, []);
});

test('非租赁模板 → A GoalTemplate 投影：同一适配器可配置（核心无行业硬编码）', () => {
  const r = toGoalTemplateSubmission(nonLeasing);
  assert.equal(r.ok, true, r.problems?.join(';'));
  assert.ok(r.submission.goals.some((g) => g.goalKey === 'price_benchmark' && g.executorKind === 'agent'));
  assert.ok(!JSON.stringify(r.submission.goals.map((g) => g.goalKey)).includes('cash_flow_coverage'));
});

test('案例证据 → A evidence 投影：kind=indicator，content 带五级与口径', () => {
  const ev = mainSet.cases[0].turns[0].evidence[1];
  const r = toEvidenceSubmission(ev);
  assert.equal(r.ok, true);
  assert.equal(r.submission.kind, ev.indicator);
  assert.equal(r.submission.content.grade, ev.grade);
  assert.equal(r.submission.content.caliber, ev.caliber);
  assert.equal(r.submission.content.value, ev.value);
});

test('计算结果/候选 → A complete result：provider 标记 + refs 字符串化 + 禁键零命中', () => {
  const calc = calculateCashFlowCoverage({
    currency: 'CNY',
    monthlyOperatingCashFlow: { value: 84, caliber: '经营现金流·租金后', source: { evidenceId: 'e1', version: 1 } },
    monthlyDebtService: { value: 60, caliber: '月度租金+利息', source: { evidenceId: 'e2', version: 1 } },
  });
  const cr = toCalculationComplete(calc, [{ evidenceId: 'e1', version: 1 }, { evidenceId: 'e2', version: 1 }]);
  assert.equal(cr.ok, true);
  assert.equal(cr.result.provider, 'calculation');
  assert.deepEqual(cr.result.evidenceRefs, ['e1@1', 'e2@1']);
  assert.equal(scanForbiddenKeys(cr.result).length, 0);

  const candidate = mainSet.cases[0].turns[0].scriptedCandidate;
  const pr = toCandidateComplete(candidate);
  assert.equal(pr.ok, true, pr.problems?.join(';'));
  assert.equal(pr.result.provider, 'simulation');
  assert.deepEqual(pr.result.evidenceRefs, toAEvidenceRefs(candidate.evidenceRefs));
  assert.equal(scanForbiddenKeys(pr.result).length, 0);

  const bad = toCandidateComplete({ ...candidate, extra: 1 });
  assert.equal(bad.ok, false, 'schema 不过的候选不得投影');
});

test('案例 → 项目实例化计划：提交去重、supersede 步骤、取代者不重复提交、分歧记录', () => {
  const l4 = mainSet.cases.find((c) => c.caseId === 'L4-casting-hidden-debt');
  const plan = buildCaseProjectPlan(l4);
  assert.ok(plan.stepCount > 0);

  // 每个活跃证据只提交一次；被取代证据不得出现 submitEvidence；取代者是 supersede 创建的
  const submittedKeys = plan.steps.filter((s) => s.step === 'submitEvidence').map((s) => `${s.evidenceId}@${s.version}`);
  assert.equal(new Set(submittedKeys).size, submittedKeys.length, '证据不得重复提交');
  for (const s of plan.steps.filter((x) => x.step === 'submitEvidence')) {
    const turn = l4.turns.find((t) => t.turn === s.turn);
    const ev = turn.evidence.find((e) => e.evidenceId === s.evidenceId && e.version === s.version);
    assert.ok(ev && ev.supersededBy === null, `被取代证据 ${s.evidenceId}@${s.version} 不得走 submitEvidence`);
  }
  // L4 turn2：两个旧实体被 contract@2 取代 → 恰好 2 条 supersedeEvidence，内容=取代者
  const sup = plan.steps.filter((s) => s.step === 'supersedeEvidence');
  assert.equal(sup.length, 2);
  assert.ok(sup.every((s) => s.successorLabel === 'L4-ev-contract@2' && s.payload.content.grade === 'confirmed'));
  // 取代者 contract@2 不作为新证据提交（由 supersede 创建）
  assert.ok(!submittedKeys.includes('L4-ev-contract@2'));
  // 跨 id 取代分歧必须如实记录
  assert.ok(plan.divergences.length >= 2, '两个旧实体的跨 id 取代各记一条 divergence');

  const t1 = plan.steps.filter((s) => s.turn === 1);
  assert.ok(t1.some((s) => s.step === 'submitEvidence'));
  const hrDrafts = toHumanRequestDrafts({ providerNotCalled: true, scriptedSummary: { questions: ['差额10万的流向与性质？'] } });
  assert.equal(hrDrafts[0].kind, 'missing_evidence');
});
