// 任务 03 · 四域模块单元测试：S1 契约/能力注册/感知、S2 规则/引擎/Gate/阈值、
// S4 提问/金额/协调。全部确定性，零网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  validateAnalysisRun, validateDomainAssessment, validateDomainAnalysis, validateEvidenceRef,
} from '../domains/schema.mjs';
import { createCapabilityRegistry, defaultSimulationRegistry } from '../domains/capability-registry.mjs';
import { buildPerceptionSnapshot, projectForDomain, readFact, independentSourceCount } from '../domains/perception.mjs';
import { validateRule, validateRulePack, activationStatus } from '../rules/rule-schema.mjs';
import { evaluateRules } from '../rules/engine.mjs';
import { evaluateGate, attemptWaiver, applyStaleReviewAck } from '../rules/gate.mjs';
import { createThresholds } from '../rules/thresholds.mjs';
import { planQuestions } from '../questions/planner.mjs';
import { computeAmountCandidate } from '../amount/candidate.mjs';
import { coordinateNextStep } from '../coordination/next-step.mjs';
import { runFourDomainPipeline, applyPackOverride } from '../domains/pipeline.mjs';
import { ASSESSORS } from '../domains/assessors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(path.join(here, '../rules/four-domain-rule-pack-v1.json'), 'utf8'));

const doc = (id, facts, extra = {}) => ({
  materialId: id, kind: 'document', content: `${id} 合成`, sourceRef: { channel: '合成', capturedAt: '2026-08-01', field: '测试' },
  declaredFacts: facts, quality: {}, ...extra,
});
const BASE = [
  doc('M1', [{ factKey: 'entity_identity_verified', value: true, verificationLevel: 'verified' }]),
  doc('M2', [{ factKey: 'equipment_ownership_verified', value: true, verificationLevel: 'verified' }]),
  doc('M3', [{ factKey: 'monthly_operating_cash_flow', value: 78, unit: '万元', caliber: '租金后', verificationLevel: 'source_supported' }]),
  doc('M4', [{ factKey: 'monthly_debt_service', value: 60, unit: '万元', caliber: '租金+利息', verificationLevel: 'source_supported' }]),
  doc('M5', [{ factKey: 'top1_customer_revenue_share', value: 55, unit: '%', verificationLevel: 'source_supported' }]),
];
const TXN = { orgType: 'commercial_leasing', region: '华东', product: 'direct_lease', customerRange: 'standard' };
const pipe = (over = {}) => runFourDomainPipeline({
  tenantId: 't1', customerId: 'c1', materials: BASE, transaction: TXN, asOf: '2026-09-16', rulePack: pack, ...over,
});

// ---------- S1 契约 ----------
test('S1: authority 恒为 none——任何非 none 声明被结构拒绝', () => {
  const r = validateDomainAssessment({ findingType: 'x', summary: 'x', domain: 'policy', stale: false, authority: 'admin', evidenceRefs: [], knownFacts: [], unknowns: [], contradictions: [], proposedQuestions: [], proposedActions: [] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'AUTHORITY_VIOLATION'));
});
test('S1: confidence 字段被拒（置信度不是风险概率）', () => {
  const r = validateDomainAssessment({ findingType: 'x', summary: 'x', domain: 'policy', stale: false, authority: 'none', confidence: 0.9, evidenceRefs: [], knownFacts: [], unknowns: [], contradictions: [], proposedQuestions: [], proposedActions: [] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'CONFIDENCE_FORBIDDEN'));
});
test('S1: 无定位 evidenceRef 只能作假设（located=false）', () => {
  const r = validateEvidenceRef({ materialId: 'M1' });
  assert.equal(r.located, false);
  const r2 = validateEvidenceRef({ materialId: 'M1', location: { timeSpan: '00:01:00-00:02:00' } });
  assert.equal(r2.located, true);
});
test('S1: 四域分析必须绑定同一快照（SNAPSHOT_MISMATCH）', () => {
  const p = pipe();
  const run = { ...p.analyses.policy.analysisRun, inputHash: 'deadbeef' };
  const r = validateDomainAnalysis({ analysisRun: run, assessment: p.analyses.policy.assessment }, p.snapshot);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.code === 'SNAPSHOT_MISMATCH'));
});
test('S1: 能力注册表——未登记 provider/模态按不可处理，不假设', () => {
  const caps = defaultSimulationRegistry();
  const video = { materialId: 'V', kind: 'video', content: 'x', declaredFacts: [] };
  const v = caps.checkMaterial({ providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3', material: video });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'MODALITY_UNSUPPORTED');
  const un = caps.checkMaterial({ providerMode: 'simulation', modelVersion: 'no-such-model', material: video });
  assert.equal(un.code, 'PROVIDER_NOT_REGISTERED');
  // 非法注册项构造即拒绝
  assert.throws(() => createCapabilityRegistry([{ providerMode: 'simulation', modelVersion: 'm', input: ['hologram'] }]));
});
test('S1: 媒体超尺寸按不可处理', () => {
  const caps = createCapabilityRegistry([
    { providerMode: 'simulation', modelVersion: 'm1', input: ['text'], maxMediaBytes: { text: 10 } },
  ]);
  const r = caps.checkMaterial({ providerMode: 'simulation', modelVersion: 'm1', material: { materialId: 'B', kind: 'document', content: 'x'.repeat(100), declaredFacts: [], bytes: 100 } });
  assert.equal(r.code, 'MEDIA_TOO_LARGE');
});

// ---------- S1 感知 ----------
test('感知: 重复内容归同源组，独立佐证只计一次（C01）', () => {
  const caps = defaultSimulationRegistry();
  const s = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' },
    materials: [doc('A', [{ factKey: 'k', value: 1, verificationLevel: 'declared' }]), { ...doc('B', [{ factKey: 'k', value: 1, verificationLevel: 'declared' }]), content: 'A 合成' }],
  });
  assert.equal(s.snapshot.duplicateGroups.length, 1);
  const pr = projectForDomain(s.snapshot, 'credit').projection;
  assert.equal(independentSourceCount(pr, 'k'), 1);
});
test('感知: 版本取代与快照代次推进（C08）', () => {
  const caps = defaultSimulationRegistry();
  const s = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' },
    materials: [doc('A', [{ factKey: 'k', value: 1, verificationLevel: 'declared' }]), doc('A@v2', [{ factKey: 'k', value: 2, verificationLevel: 'source_supported' }], { version: 2 })],
  });
  assert.equal(s.snapshot.supersededItems.length, 1);
  assert.equal(s.snapshot.items[0].value, 2);
  assert.ok(s.snapshot.watermark.generation >= 2);
});
test('感知: 冲突保留且跨口径也判（S11 语义），同值跨口径不判（S13 语义）', () => {
  const caps = defaultSimulationRegistry();
  const prov = { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' };
  const s1 = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: prov,
    materials: [doc('A', [{ factKey: 'm', value: 'X', caliber: '铭牌', verificationLevel: 'declared' }]), doc('B', [{ factKey: 'm', value: 'Y', caliber: '合同', verificationLevel: 'declared' }])],
  });
  assert.equal(s1.snapshot.conflicts.length, 1);
  assert.equal(s1.snapshot.conflicts[0].values.length, 2);
  assert.ok(s1.snapshot.conflicts[0].values.every((v) => 'caliber' in v));
  const s2 = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: prov,
    materials: [doc('A', [{ factKey: 'm', value: 300, caliber: '含税', verificationLevel: 'declared' }]), doc('B', [{ factKey: 'm', value: 300, caliber: '不含税', verificationLevel: 'declared' }])],
  });
  assert.equal(s2.snapshot.conflicts.length, 0);
});
test('感知: 低置信转写不产出事实、不补全（C17）', () => {
  const caps = defaultSimulationRegistry();
  const s = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' },
    materials: [{
      materialId: 'T', kind: 'transcript', content: '低置信', sourceRef: { channel: '转写', capturedAt: '2026-09-01', timeSpan: '00:00:10-00:00:20' },
      declaredFacts: [{ factKey: 'k', value: '识别出的铭牌号(猜)', verificationLevel: 'declared' }], quality: { asrConfidence: 0.3 },
    }],
  });
  assert.equal(s.snapshot.items.length, 0);
  assert.equal(s.snapshot.unreadable[0].reasonCode, 'QUALITY_INSUFFICIENT');
});
test('感知: 域投影最小化（越权切片不出现在投影内）', () => {
  const p = pipe();
  const pr = projectForDomain(p.snapshot, 'asset', { asset: { factKeys: ['equipment_ownership_verified'], materialKinds: '*', note: 'test' } }).projection;
  assert.ok(pr.items.every((i) => i.factKey === 'equipment_ownership_verified'));
  assert.equal(projectForDomain(p.snapshot, 'alien').ok, false);
});

// ---------- S2 规则 ----------
test('S2: 规则缺任一必填字段即校验失败（不默认补齐）', () => {
  const base = JSON.parse(JSON.stringify(pack.rules[0]));
  for (const key of ['ruleId', 'version', 'scope', 'effectiveFrom', 'sourceRef', 'approvalStatus', 'requiredFacts', 'condition', 'effect', 'nonWaivable', 'review']) {
    const r = JSON.parse(JSON.stringify(base));
    delete r[key];
    assert.equal(validateRule(r).ok, false, `删除 ${key} 应失败`);
  }
});
test('S2: 未批准/过期/来源不明不激活（C28/C12/C11）', () => {
  assert.equal(activationStatus({ approvalStatus: 'pending_approval' }, { asOf: '2026-09-16' }).inactiveReason, 'approval_pending');
  assert.equal(activationStatus({ approvalStatus: 'approved', effectiveTo: '2026-06-30' }, { asOf: '2026-09-16' }).inactiveReason, 'out_of_window');
  assert.equal(activationStatus({ approvalStatus: 'approved', sourceRef: { kind: 'web_article' } }, { asOf: '2026-09-16' }).inactiveReason, 'source_unconfirmed');
});
test('S2: 前提等级不足 → precondition_missing（不猜命中）', () => {
  const caps = defaultSimulationRegistry();
  const s = buildPerceptionSnapshot({
    tenantId: 't', customerId: 'c', capabilities: caps, provider: { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' },
    materials: [doc('F', [{ factKey: 'equipment_ownership_verified', value: false, verificationLevel: 'declared' }])],
  });
  const pr = projectForDomain(s.snapshot, 'policy').projection;
  const ev = evaluateRules({ pack, projection: pr, asOf: '2026-09-16', transaction: TXN });
  const r = ev.results.find((x) => x.ruleId === 'SIM-ASSET-OWNERSHIP-01');
  assert.equal(r.outcome, 'precondition_missing');
  assert.deepEqual(r.missingFacts, [{ factKey: 'equipment_ownership_verified', minLevel: 'verified' }]);
});
test('S2: 历史回放——旧 asOf + 旧版本包可重放（C11）', () => {
  const p = pipe();
  // 当前 asOf：登记规则过期不激活
  const now = evaluateRules({ pack, projection: p.projections.policy, asOf: '2026-09-16', transaction: TXN });
  assert.equal(now.results.find((x) => x.ruleId === 'SIM-LEASE-REGISTER-01').inactiveReason, 'out_of_window');
  // 历史 asOf：同一规则当时激活且可评估
  const hist = evaluateRules({ pack, projection: p.projections.policy, asOf: '2026-03-01', transaction: TXN });
  const h = hist.results.find((x) => x.ruleId === 'SIM-LEASE-REGISTER-01');
  assert.equal(h.activated, true);
  // 登记事实缺失 → 前提缺失（与当前 asOf 同一机械语义，只是窗口不同）
  assert.equal(h.outcome, 'precondition_missing');
  // 历史回放带当时事实：登记完成 verified=false？不——登记完成=true → not_hit；false → hit
  const withReg = { ...p.projections.policy, items: [...p.projections.policy.items, { factKey: 'lease_registration_done', value: false, verificationLevel: 'verified', materialId: 'R1', sourceRef: { page: '2' } }] };
  const hist2 = evaluateRules({ pack, projection: withReg, asOf: '2026-03-01', transaction: TXN });
  assert.equal(hist2.results.find((x) => x.ruleId === 'SIM-LEASE-REGISTER-01').outcome, 'hit');
});
test('S2: 规则包 boundary 必须 simulation_only', () => {
  const bad = JSON.parse(JSON.stringify(pack));
  bad.boundary = 'company_policy';
  assert.equal(validateRulePack(bad).ok, false);
});

// ---------- S2 Gate ----------
function gateFixture(overrides = {}) {
  const p = pipe();
  const assessments = {};
  for (const d of ['policy', 'credit', 'commerce', 'asset']) assessments[d] = p.analyses[d];
  return evaluateGate({
    domainAnalyses: { ...assessments, ...overrides },
    ruleEvaluation: evaluateRules({ pack, projection: p.projections.policy, asOf: '2026-09-16', transaction: TXN }),
    transaction: TXN,
  });
}
test('S2: 必需域缺失/超时 → HOLD（不默认通过，也不判高风险）（C14）', () => {
  const g1 = gateFixture({ asset: { status: 'missing' } });
  assert.equal(g1.result, 'HOLD_FOR_REVIEW');
  assert.ok(g1.reasonCodes.includes('REQUIRED_DOMAIN_INCOMPLETE') || g1.reasonCodes.includes('DOMAIN_NOT_COMPLETED'));
  assert.equal(g1.domainStatus.asset.status, 'missing');
  const g2 = gateFixture({ policy: { status: 'timeout', reasonCode: 'DOMAIN_TIMEOUT' } });
  assert.equal(g2.result, 'HOLD_FOR_REVIEW');
  assert.equal(g2.domainStatus.policy.reasonCode, 'DOMAIN_TIMEOUT');
});
test('S2: 不可豁免硬门不被 staleReviewAck/豁免覆盖（C02 边界）', () => {
  const g = gateFixture();
  assert.equal(g.result, 'CLEAR');
  // 构造硬门命中：第三方权属
  const p2 = pipe();
  const doc = { materialId: 'X', kind: 'document', content: 'x', sourceRef: { channel: 'c', capturedAt: '2026-08-01', page: '1' }, declaredFacts: [{ factKey: 'equipment_ownership_verified', value: false, verificationLevel: 'verified' }], quality: {} };
  const s2 = p2; // 复用断言辅助：直接构造规则结果
  void doc;
  const ev = evaluateRules({ pack, projection: s2.projections.policy, asOf: '2026-09-16', transaction: TXN });
  const hit = ev.results.find((r) => r.ruleId === 'SIM-ASSET-OWNERSHIP-01' && r.outcome === 'hit');
  void hit;
  const gate = evaluateGate({
    domainAnalyses: {
      policy: p2.analyses.policy, credit: p2.analyses.credit, commerce: p2.analyses.commerce,
      asset: {
        analysisRun: p2.analyses.asset.analysisRun,
        assessment: { ...p2.analyses.asset.assessment, contradictions: [] },
      },
    },
    ruleEvaluation: evaluateRules({
      pack,
      projection: {
        ...s2.projections.policy,
        items: [...s2.projections.policy.items.filter((i) => i.factKey !== 'equipment_ownership_verified'),
          { factKey: 'equipment_ownership_verified', value: false, verificationLevel: 'verified', materialId: 'X', sourceRef: { page: '1' } }],
        conflicts: s2.projections.policy.conflicts,
      },
      asOf: '2026-09-16', transaction: TXN,
    }),
    transaction: TXN,
  });
  assert.equal(gate.result, 'HARD_BLOCK');
  assert.deepEqual(gate.scope.blockedActions, ['approve_facility', 'disburse']);
  assert.equal(applyStaleReviewAck({ gate, nonWaivableRuleIds: ['SIM-ASSET-OWNERSHIP-01'], ack: { note: '管理员确认放行' } }).code, 'NON_WAIVABLE_BLOCK');
  assert.equal(attemptWaiver({ gate, rulePack: pack, request: {} }).code, 'NO_EXCEPTION_POLICY');
  assert.ok(gate.releaseConditions.every((rc) => rc.type === 'fact_correction' || rc.type === 'governance_update' || rc.type === 'provide_evidence'));
});
test('S2: 模型凭空规则引用 → unsupported 不激活（C12）', () => {
  const p = pipe();
  const fake = { ...p.analyses.policy.assessment, ruleRefs: ['COMPANY-SECRET-RULE-99'] };
  const g = evaluateGate({
    domainAnalyses: { policy: { analysisRun: p.analyses.policy.analysisRun, assessment: fake }, credit: p.analyses.credit, commerce: p.analyses.commerce, asset: p.analyses.asset },
    ruleEvaluation: evaluateRules({ pack, projection: p.projections.policy, asOf: '2026-09-16', transaction: TXN }),
    transaction: TXN,
  });
  assert.equal(g.result, 'HOLD_FOR_REVIEW');
  assert.ok(g.unsupportedRuleRefs.includes('policy:COMPANY-SECRET-RULE-99'));
  assert.ok(g.ruleIds.every((id) => pack.rules.some((r) => r.ruleId === id)));
});
test('S2: 阈值两包分离，禁止合成压力指数（构造即校验）', () => {
  const th = createThresholds({ business: pack.businessThresholds, system: pack.systemThresholds });
  assert.notEqual(th.versions.business, th.versions.system);
  assert.equal(th.classifySystemSignal({ key: 'model_timeout' }).status, 'unknown');
  assert.equal(th.classifySystemSignal({ key: 'alien' }).reasonCode, 'SYSTEM_SIGNAL_UNRECOGNIZED');
  assert.throws(() => createThresholds({ business: { version: 'x', thresholds: [{ key: 'k', value: 'nan', unit: '', source: '' }] }, system: pack.systemThresholds }));
});

// ---------- S2 packOverride（C28）----------
test('S2: packOverride 置 pending → policy_pending，不放行也不阻断（C28）', () => {
  const ov = applyPackOverride(pack, { 'SIM-ASSET-OWNERSHIP-01': { approvalStatus: 'pending_approval' } });
  assert.equal(ov.ok, true);
  const r = runFourDomainPipeline({
    tenantId: 't', customerId: 'c', materials: BASE, transaction: TXN, asOf: '2026-09-16', rulePack: pack, packOverrides: { 'SIM-ASSET-OWNERSHIP-01': { approvalStatus: 'pending_approval' } },
  });
  assert.equal(r.ruleEvaluation.policyPending, true);
  assert.equal(r.gate.result, 'HOLD_FOR_REVIEW');
  assert.ok(r.gate.reasonCodes.includes('POLICY_PENDING'));
  assert.equal(applyPackOverride(pack, { 'NO-SUCH-RULE': {} }).ok, false);
});

// ---------- 四域边界 ----------
test('四域: 政策域不引用包外规则；信审 unknown 不补造；商务缺成本不产净收益；资产看视频不等权属', () => {
  const p = pipe();
  for (const d of ['policy', 'credit', 'commerce', 'asset']) {
    const a = p.analyses[d].assessment;
    assert.equal(a.authority, 'none');
    for (const id of a.ruleRefs ?? []) assert.ok(pack.rules.some((r) => r.ruleId === id), `${d} 引用了包外规则 ${id}`);
  }
  const mats = BASE.filter((m) => !['M3', 'M4'].includes(m.materialId));
  const r2 = runFourDomainPipeline({ tenantId: 't', customerId: 'c', materials: mats, transaction: TXN, asOf: '2026-09-16', rulePack: pack });
  assert.ok(r2.analyses.credit.assessment.unknowns.some((u) => u.includes('不补造')));
  assert.ok(r2.analyses.commerce.assessment.unknowns.some((u) => u.includes('不产出数值') || u.includes('等待商务条件材料')));
  const vmat = [{
    materialId: 'V1', kind: 'transcript', content: '看到设备', sourceRef: { channel: '转写', capturedAt: '2026-09-01', timeSpan: '00:01:00-00:01:30' },
    declaredFacts: [{ factKey: 'equipment_exists_observed', value: true, verificationLevel: 'declared' }], quality: {},
  }];
  const r3 = runFourDomainPipeline({ tenantId: 't', customerId: 'c', materials: [...BASE, ...vmat], transaction: TXN, asOf: '2026-09-16', rulePack: pack });
  assert.ok(r3.analyses.asset.assessment.knownFacts.some((k) => k.includes('不证明权属')));
});

// ---------- S4 ----------
test('S4: 已核验事实不重复索要（C16）；客户负担字段齐备', () => {
  const p = pipe();
  const g = { ...p.gate, releaseConditions: [...p.gate.releaseConditions, { type: 'provide_evidence', factKey: 'equipment_ownership_verified', minLevel: 'verified' }] };
  const plan = planQuestions({ gate: g, projection: p.projections.policy });
  assert.equal(plan.questions.filter((q) => q.targetFact === 'equipment_ownership_verified').length, 0);
  assert.ok(plan.dedupedCount >= 1);
  for (const q of plan.questions) {
    for (const k of ['whyNeeded', 'expectedEvidence', 'targetFact', 'priority', 'optional', 'customerBurden', 'stopCondition']) {
      assert.ok(k in q, `提问缺 ${k}`);
    }
  }
});
test('S4: 金额候选——新增负债降低候选；资产冲突置零；数字带版本锚（C07）', () => {
  const th = { versions: { business: 'sim-business@0.3' }, business: (k) => (k === 'sim_min_cash_coverage' ? { value: 1.0, unit: '倍(x)', source: 'sim' } : null) };
  const a1 = computeAmountCandidate({
    productCap: { value: 10000000, currency: 'CNY', source: 'demo' }, thresholds: th,
    facts: {
      monthlyOperatingCashFlow: { value: 78, verificationLevel: 'source_supported', materialId: 'M3' },
      monthlyDebtService: { value: 60, verificationLevel: 'source_supported', materialId: 'M4' },
    }, inputWatermark: { generation: 1 }, rulesetVersion: '1.0.0',
  });
  assert.equal(a1.candidateRange.max, 648);
  const a2 = computeAmountCandidate({
    productCap: { value: 10000000, currency: 'CNY', source: 'demo' }, thresholds: th,
    facts: {
      monthlyOperatingCashFlow: { value: 78, verificationLevel: 'source_supported', materialId: 'M3' },
      monthlyDebtService: { value: 60, verificationLevel: 'source_supported', materialId: 'M4' },
      newDebtMonthlyPayment: { value: 20, verificationLevel: 'declared', materialId: 'M9' },
    }, inputWatermark: { generation: 2 }, rulesetVersion: '1.0.0',
  });
  assert.equal(a2.candidateRange.max, 0);
  assert.ok(a2.adverseSignals.newDebtApplied > 0);
  const a3 = computeAmountCandidate({
    productCap: { value: 10000000, currency: 'CNY', source: 'demo' }, thresholds: th,
    facts: {
      monthlyOperatingCashFlow: { value: 78, verificationLevel: 'source_supported', materialId: 'M3' },
      monthlyDebtService: { value: 60, verificationLevel: 'source_supported', materialId: 'M4' },
      newDebtMonthlyPayment: { value: 20, verificationLevel: 'declared', materialId: 'M9' },
    }, inputWatermark: { generation: 2 }, rulesetVersion: '1.0.0', amountModelConfigured: false,
  });
  assert.equal(a3.evaluable, false);
});
test('S4: 四域分歧呈现不表决（C19）；客户/内部受众分离', () => {
  const p = pipe();
  const doc2 = { materialId: 'Z', kind: 'document', content: 'z', sourceRef: { channel: 'c', capturedAt: '2026-08-01', page: '1' }, declaredFacts: [{ factKey: 'equipment_deal_amount', value: 999, verificationLevel: 'source_supported' }], quality: {} };
  const r = runFourDomainPipeline({
    tenantId: 't', customerId: 'c', materials: [...BASE, doc2, { ...doc2, materialId: 'Z2', declaredFacts: [{ factKey: 'equipment_deal_amount', value: 111, verificationLevel: 'source_supported' }] }],
    transaction: TXN, asOf: '2026-09-16', rulePack: pack,
  });
  const ns = coordinateNextStep({ domainAnalyses: r.analyses, gate: r.gate, questionPlan: r.questionPlan, amountCandidate: r.amountCandidate });
  assert.ok(ns.audienceQueues.internal.escalations.length >= 1);
  assert.ok(ns.customerInstructionBoundary.includes('不能修改政策、角色或审批'));
  assert.equal(ns.jianweiRole.includes('不自动拥有'), true);
});

// ---------- 评估器直接调用 ----------
test('评估器: 全域输出过 schema 且绑定同快照', () => {
  const p = pipe();
  const r = ASSESSORS.policy({ snapshot: p.snapshot, projection: p.projections.policy, ruleEvaluation: p.ruleEvaluation });
  assert.equal(r.ok, true);
  // 空规则版本 → schema 失败关闭（规则版本锚不可缺失）
  const bad = ASSESSORS.policy({ snapshot: p.snapshot, projection: p.projections.policy, ruleEvaluation: { ...p.ruleEvaluation, rulesetVersion: '' } });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.code === 'MISSING_FIELD'));
});
test('S1: readFact 冲突值全部返回（不悄悄择一）', () => {
  const p = pipe();
  const mats = [...BASE,
    doc('Z1', [{ factKey: 'equipment_deal_amount', value: 320, verificationLevel: 'source_supported' }]),
    doc('Z2', [{ factKey: 'equipment_deal_amount', value: 280, verificationLevel: 'source_supported' }])];
  const r = runFourDomainPipeline({ tenantId: 't', customerId: 'c', materials: mats, transaction: TXN, asOf: '2026-09-16', rulePack: pack });
  assert.equal(r.snapshot.conflicts.length, 1);
  assert.equal(readFact(r.projections.asset, 'equipment_deal_amount').length, 2);
});
