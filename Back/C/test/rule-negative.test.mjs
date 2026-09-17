// 任务 02 · B2/W04 规则负例测试：scope 维度缺失与数值类型错误不得静默转成"不适用"/安全结论。
// 判据（任务书 W04）：待核验或明确错误，不静默不适用/CLEAR。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRules } from '../rules/engine.mjs';
import { evaluateGate } from '../rules/gate.mjs';
import { planQuestions } from '../questions/planner.mjs';
import { buildPerceptionSnapshot, projectForDomain } from '../domains/perception.mjs';
import { defaultSimulationRegistry } from '../domains/capability-registry.mjs';
import { runFourDomainPipeline } from '../domains/pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pack = JSON.parse(readFileSync(path.join(root, 'rules', 'four-domain-rule-pack-v1.json'), 'utf8'));
const PROVIDER = { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' };

function material(id, facts, kind = 'document') {
  return {
    materialId: id, kind, content: `合成材料 ${id}`,
    sourceRef: { channel: '客户提交(合成)', capturedAt: '2026-09-10', field: '测试' },
    declaredFacts: facts, quality: {},
  };
}

test('W04-1 交易适用面缺失维度 → applicability_unknown，Gate NEEDS_EVIDENCE，不静默不适用', () => {
  const materials = [material('M1', [
    { factKey: 'monthly_operating_cash_flow', value: 50, unit: '万元', verificationLevel: 'source_supported' },
    { factKey: 'monthly_debt_service', value: 20, unit: '万元', verificationLevel: 'source_supported' },
  ])];
  const r = runFourDomainPipeline({
    tenantId: 'tenant-demo', customerId: 'w04-c1', materials,
    transaction: {}, asOf: '2026-09-17', rulePack: pack,
  });
  assert.equal(r.ok, true);
  const unknown = r.ruleEvaluation.results.filter((x) => x.outcome === 'applicability_unknown');
  assert.ok(unknown.length > 0, '存在 scope 限定规则时，缺失维度必须产生 applicability_unknown');
  const asset = unknown.find((x) => x.ruleId === 'SIM-ASSET-OWNERSHIP-01');
  assert.ok(asset, '商业租赁限定规则应受影响');
  assert.deepEqual([...asset.applicabilityUnknown].sort(), ['orgType', 'product']);
  assert.equal(r.gate.result, 'NEEDS_EVIDENCE');
  assert.ok(r.gate.reasonCodes.includes('RULE_APPLICABILITY_UNKNOWN'), `reasonCodes=${r.gate.reasonCodes.join(',')}`);
  // 解除条件与提问计划：内部澄清，不是客户负担
  const rc = r.gate.releaseConditions.find((x) => x.type === 'clarify_transaction_scope');
  assert.ok(rc, '应有 clarify_transaction_scope 解除条件');
  const q = r.questionPlan.questions.find((x) => x.audience === 'internal' && x.whyNeeded.type === 'transaction_scope_unknown');
  assert.ok(q, '应为内部受众生成适用面澄清问题');
});

test('W04-2 交易面提供且不命中 = 确定不适用（不误报 unknown）', () => {
  const materials = [material('M2', [
    { factKey: 'monthly_operating_cash_flow', value: 50, unit: '万元', verificationLevel: 'source_supported' },
    { factKey: 'monthly_debt_service', value: 20, unit: '万元', verificationLevel: 'source_supported' },
  ])];
  const r = runFourDomainPipeline({
    tenantId: 'tenant-demo', customerId: 'w04-c2', materials,
    transaction: { orgType: 'financial_leasing', region: 'hangzhou', product: 'direct_lease', customerRange: 'small_micro' },
    asOf: '2026-09-17', rulePack: pack,
  });
  assert.equal(r.ok, true);
  const asset = r.ruleEvaluation.results.find((x) => x.ruleId === 'SIM-ASSET-OWNERSHIP-01');
  assert.equal(asset.outcome, null, '商业租赁限定规则在金融租赁交易下=确定不适用');
  assert.equal(asset.scopeApplied, false);
  assert.equal(asset.applicabilityUnknown, undefined);
  assert.ok(!r.gate.reasonCodes.includes('RULE_APPLICABILITY_UNKNOWN'));
});

test('W04-3 派生覆盖率输入非数值 → 显式类型错误，不静默 not_hit', () => {
  const materials = [material('M3', [
    { factKey: 'monthly_operating_cash_flow', value: '约五十万', unit: '万元', verificationLevel: 'source_supported' },
    { factKey: 'monthly_debt_service', value: 20, unit: '万元', verificationLevel: 'source_supported' },
  ])];
  const r = runFourDomainPipeline({
    tenantId: 'tenant-demo', customerId: 'w04-c3', materials,
    transaction: { orgType: 'commercial_leasing', region: 'hangzhou', product: 'direct_lease', customerRange: 'small_micro' },
    asOf: '2026-09-17', rulePack: pack,
  });
  assert.equal(r.ok, true);
  const derived = r.ruleEvaluation.facts.cash_coverage_ratio ?? [];
  assert.ok(derived.some((x) => x.value === null), '不可计算必须产出 value=null 的显式派生事实');
  const cov = r.ruleEvaluation.results.find((x) => x.ruleId === 'SIM-CASH-COVERAGE-01');
  assert.equal(cov.outcome, 'condition_error', `outcome=${cov.outcome}`);
  assert.equal(cov.errorCode, 'NON_NUMERIC_VALUE');
  assert.equal(r.gate.result, 'NEEDS_EVIDENCE');
  assert.ok(r.gate.reasonCodes.includes('RULE_CONDITION_TYPE_ERROR'));
  const q = r.questionPlan.questions.find((x) => x.whyNeeded.type === 'rule_input_type_error');
  assert.ok(q, '应为数据质量纠正生成内部问题');
});

test('W04-4 布尔判定遇非布尔 → condition_error（is_false 不把字符串当 false）', () => {
  const snapshot = buildPerceptionSnapshot({
    tenantId: 'tenant-demo', customerId: 'w04-c4',
    materials: [material('M4', [{ factKey: 'materials_freshness_ok', value: 'false', verificationLevel: 'declared' }])],
    capabilities: defaultSimulationRegistry(), provider: PROVIDER,
  });
  assert.equal(snapshot.ok, true);
  const projection = projectForDomain(snapshot.snapshot, 'policy').projection;
  const r = evaluateRules({ pack, projection, asOf: '2026-09-17', transaction: {}, derivedFacts: {} });
  const freshness = r.results.find((x) => x.ruleId === 'SIM-MATERIAL-FRESHNESS-01');
  assert.equal(freshness.outcome, 'condition_error', `outcome=${freshness.outcome}`);
  assert.equal(freshness.errorCode, 'NON_BOOLEAN_VALUE');
});

test('W04-5 类型正常且未命中保持 not_hit（不误伤正常负例）', () => {
  const snapshot = buildPerceptionSnapshot({
    tenantId: 'tenant-demo', customerId: 'w04-c5',
    materials: [material('M5', [
      { factKey: 'monthly_operating_cash_flow', value: 50, unit: '万元', verificationLevel: 'source_supported' },
      { factKey: 'monthly_debt_service', value: 20, unit: '万元', verificationLevel: 'source_supported' },
    ])],
    capabilities: defaultSimulationRegistry(), provider: PROVIDER,
  });
  const projection = projectForDomain(snapshot.snapshot, 'policy').projection;
  const r = evaluateRules({
    pack, projection, asOf: '2026-09-17',
    transaction: { orgType: 'commercial_leasing', region: 'hangzhou', product: 'direct_lease', customerRange: 'small_micro' },
    derivedFacts: {},
  });
  const cov = r.results.find((x) => x.ruleId === 'SIM-CASH-COVERAGE-01');
  assert.equal(cov.outcome, 'not_hit', '覆盖率 2.5 对 lt 阈值=正常未命中');
  assert.equal(cov.errorCode, undefined);
});

test('W04-6 Gate 对 applicability_unknown/condition_error 的结构消费（含多规则叠加）', () => {
  const gate = evaluateGate({
    domainAnalyses: {
      policy: { analysisRun: { inputWatermark: { generation: 1 }, inputHash: 'x', domain: 'policy' }, assessment: { stale: false, findingsSuspicion: [], contradictions: [], evidenceRefs: [] } },
    },
    requiredDomains: ['policy'],
    ruleEvaluation: {
      rulesetVersion: pack.version, asOf: '2026-09-17', policyPending: false,
      results: [
        { ruleId: 'R-SCOPE', version: 1, activated: true, outcome: 'applicability_unknown', applicabilityUnknown: ['orgType'], scopeApplied: false, nonWaivable: false },
        { ruleId: 'R-TYPE', version: 1, activated: true, outcome: 'condition_error', errorCode: 'NON_NUMERIC_VALUE', scopeApplied: true, nonWaivable: false, evidenceRefs: [] },
        { ruleId: 'R-OK', version: 1, activated: true, outcome: 'not_hit', scopeApplied: true, nonWaivable: false },
      ],
    },
    transaction: {},
  });
  assert.equal(gate.result, 'NEEDS_EVIDENCE');
  assert.ok(gate.reasonCodes.includes('RULE_APPLICABILITY_UNKNOWN'));
  assert.ok(gate.reasonCodes.includes('RULE_CONDITION_TYPE_ERROR'));
  assert.ok(gate.ruleIds.includes('R-SCOPE') && gate.ruleIds.includes('R-TYPE'));
  assert.ok(!gate.ruleIds.includes('R-OK'), '正常未命中规则不进 ruleIds');
  const qs = planQuestions({ gate, projection: { items: [] }, minLevels: {} });
  const types = qs.questions.map((q) => q.whyNeeded.type);
  assert.ok(types.includes('transaction_scope_unknown') && types.includes('rule_input_type_error'));
});
