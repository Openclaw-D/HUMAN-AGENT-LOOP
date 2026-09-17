// 任务 03 · 四域评估流水线（确定性编排；E1：四域用同一可追溯输入产出候选，Gate 与正式权威分离）。
// 编排序：共享感知快照 → 四域投影 → 派生事实（覆盖率等，等级取输入最低）→ 规则评估 →
//          四域评估 → Gate 汇总 → 提问计划 → 金额候选 → 单一下一步。
// 单助手对照模式（任务书 §8）：同一规则包，单遍评估——不做跨来源冲突保留/域完成性/
// 质量传播，用于最小可证伪对照实验；两臂均为确定性实现，比较的是管线设计差异，不是模型质量。

import { createThresholds } from '../rules/thresholds.mjs';
import { validateRulePack } from '../rules/rule-schema.mjs';
import { evaluateRules } from '../rules/engine.mjs';
import { evaluateGate } from '../rules/gate.mjs';
import { buildPerceptionSnapshot, projectForDomain, readFact } from './perception.mjs';
import { defaultSimulationRegistry } from './capability-registry.mjs';
import { ASSESSORS } from './assessors.mjs';
import { planQuestions } from '../questions/planner.mjs';
import { computeAmountCandidate } from '../amount/candidate.mjs';
import { coordinateNextStep } from '../coordination/next-step.mjs';
import { stableHash } from './util.mjs';

const PROVIDER = Object.freeze({ providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' });
const ASSET_CONFLICT_KEYS = ['equipment_deal_amount', 'equipment_model', 'nameplate_serial'];

function levelRank(l) { return ['unknown', 'declared', 'source_supported', 'verified'].indexOf(l); }

const FRESHNESS_MAX_AGE_DAYS = 365; // 演示值：与规则包 SIM-MATERIAL-FRESHNESS-01 同源声明

/** 派生事实：覆盖率（等级取输入最低）与材料新鲜度（任一过期限材料 → false；演示阈值 365 天）。 */
function deriveFacts(projection, asOf) {
  const out = {};
  const op = readFact(projection, 'monthly_operating_cash_flow');
  const ds = readFact(projection, 'monthly_debt_service');
  const nd = readFact(projection, 'new_debt_monthly_payment');
  const pickBest = (arr) => (arr.length > 0 ? arr.reduce((a, b) => (levelRank(b.verificationLevel) >= levelRank(a.verificationLevel) ? b : a)) : null);
  const o = pickBest(op);
  const d = pickBest(ds);
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  if (o && d) {
    // W02/W04：两侧事实都在（达级）但任一非有限数值 → 产出 value=null 的显式派生事实，
    // 由规则引擎按类型错误拒绝（不静默不产出让规则走 not_hit 安全结论），单位/口径原样透出
    const minLevel = levelRank(o.verificationLevel) <= levelRank(d.verificationLevel) ? o.verificationLevel : d.verificationLevel;
    if (isNum(o.value) && isNum(d.value)) {
      if (d.value > 0) {
      out.cash_coverage_ratio = {
        value: Number((o.value / d.value).toFixed(6)),
        verificationLevel: minLevel,
        formula: 'cash_coverage_ratio = monthly_operating_cash_flow / monthly_debt_service (sim-cf-coverage@1)',
      };
      // 压力口径：叠加声明级新增债务（存在才产出；等级=各输入最低级）
      const n = pickBest(nd);
      if (n && isNum(n.value) && (d.value + n.value) > 0) {
        const lvl = [o.verificationLevel, d.verificationLevel, n.verificationLevel]
          .reduce((a, b) => (levelRank(b) < levelRank(a) ? b : a));
        out.cash_coverage_ratio_stressed = {
          value: Number((o.value / (d.value + n.value)).toFixed(6)),
          verificationLevel: lvl,
          formula: 'cash_coverage_ratio_stressed = monthly_operating_cash_flow / (monthly_debt_service + new_debt_monthly_payment) (sim-cf-stress@1)',
        };
      }
      } else {
        out.cash_coverage_ratio = {
          value: null,
          verificationLevel: minLevel,
          formula: 'cash_coverage_ratio = UNCOMPUTABLE_NON_POSITIVE_DEBT_SERVICE (sim-cf-coverage@1)',
        };
      }
    } else {
      out.cash_coverage_ratio = {
        value: null,
        verificationLevel: minLevel,
        formula: 'cash_coverage_ratio = UNCOMPUTABLE_NON_NUMERIC_INPUT (sim-cf-coverage@1)',
        inputUnits: { operating: o.unit, debtService: d.unit },
      };
    }
  }
  // 新鲜度：有日期的材料中任一超期 → false（等级 declared=派生）；无日期材料 → 不产出（无证据不判过期）
  const asOfMs = Date.parse(asOf);
  if (Number.isFinite(asOfMs)) {
    const stale = projection.items.filter((it) => {
      if (!it.capturedAt) return false;
      const t = Date.parse(it.capturedAt);
      return Number.isFinite(t) && (asOfMs - t) / 86400000 > FRESHNESS_MAX_AGE_DAYS;
    });
    if (projection.items.some((it) => it.capturedAt)) {
      out.materials_freshness_ok = {
        value: stale.length === 0,
        verificationLevel: 'declared',
        formula: `materials_freshness_ok = all(capturedAt within ${FRESHNESS_MAX_AGE_DAYS}d of asOf) (sim-freshness@1)`,
        staleMaterialIds: stale.map((it) => it.materialId),
      };
    }
  }
  return out;
}

function projectionFacts(projection) {
  const best = (key) => {
    const arr = readFact(projection, key);
    return arr.length > 0 ? arr.reduce((a, b) => (levelRank(b.verificationLevel) >= levelRank(a.verificationLevel) ? b : a)) : null;
  };
  return { best };
}

/**
 * 场景级规则覆审（packOverride）：把 {ruleId: {字段补丁}} 应用到规则包副本并重新全量校验。
 * 用途：C28（规则置 pending_approval 演示 policy_pending）等；规则文件本身不可变。
 */
export function applyPackOverride(pack, overrides = {}) {
  const cloned = JSON.parse(JSON.stringify(pack));
  for (const [ruleId, patch] of Object.entries(overrides)) {
    const rule = cloned.rules.find((r) => r.ruleId === ruleId);
    if (!rule) return { ok: false, problems: [`packOverride 指向未知规则: ${ruleId}`] };
    Object.assign(rule, patch);
  }
  const check = validateRulePack(cloned);
  return check.ok ? { ok: true, pack: cloned } : { ok: false, problems: check.problems };
}

/**
 * 四域流水线（全部确定性，零外部调用）。
 * @param p.domainOverrides { domain: {status:'timeout'|'not_configured'|..., reasonCode?} }（C14 演示）
 * @param p.packOverrides { ruleId: {字段补丁} }（C28 演示；应用后整包重校验）
 */
export function effectiveRulePack(rulePack, packOverrides = null) {
  let effectivePack = rulePack;
  if (packOverrides) {
    const ov = applyPackOverride(rulePack, packOverrides);
    if (!ov.ok) return { ok: false, stage: 'pack_override', problems: ov.problems };
    effectivePack = ov.pack;
  }
  const packCheck = validateRulePack(effectivePack);
  if (!packCheck.ok) return { ok: false, stage: 'rule_pack', problems: packCheck.problems };
  return { ok: true, pack: effectivePack };
}

/**
 * 阶段 1｜感知：一次规范化，产出可追溯快照（四域共享，不重复上传/重复解析）。
 */
export function perceptionStage({ tenantId, customerId, materials, rulePack, registry = null }) {
  const packCheck = validateRulePack(rulePack);
  if (!packCheck.ok) return { ok: false, stage: 'rule_pack', problems: packCheck.problems };
  const caps = registry ?? defaultSimulationRegistry();
  const snap = buildPerceptionSnapshot({ tenantId, customerId, materials, capabilities: caps, provider: PROVIDER });
  if (!snap.ok) return { ok: false, stage: 'perception', problems: snap.problems };
  return { ok: true, snapshot: snap.snapshot };
}

/**
 * 阶段 2｜评估：投影 + 派生事实 + 规则评估 + 指定域评估。
 * @param p.domains 要实际评估的域（选择性重算基础：只算受影响域，其余以 override 形式缺省）
 */
export function assessStage({
  snapshot, transaction = {}, asOf, rulePack,
  domainOverrides = {},
  domains = ['policy', 'credit', 'commerce', 'asset'],
  packOverrides = null,
  now = () => new Date().toISOString(),
}) {
  const eff = effectiveRulePack(rulePack, packOverrides);
  if (!eff.ok) return eff;
  const effectivePack = eff.pack;
  const thresholds = createThresholds({ business: effectivePack.businessThresholds, system: effectivePack.systemThresholds });

  const projections = {};
  const analyses = {};
  for (const domain of ['policy', 'credit', 'commerce', 'asset']) {
    const pr = projectForDomain(snapshot, domain);
    projections[domain] = pr.projection;
    const ov = domainOverrides[domain];
    if (ov) { analyses[domain] = { status: ov.status, reasonCode: ov.reasonCode ?? 'DOMAIN_NOT_COMPLETED' }; continue; }
    analyses[domain] = domains.includes(domain) ? null : { status: 'skipped', reasonCode: 'DOMAIN_SKIPPED' };
  }

  const derived = deriveFacts(projections.policy, asOf);
  const ruleEvaluation = evaluateRules({
    pack: effectivePack, projection: projections.policy, asOf, transaction, derivedFacts: derived,
  });

  const evalInputs = {
    policy: { snapshot, projection: projections.policy, ruleEvaluation, now },
    credit: { snapshot, projection: projections.credit, thresholds, now, coverageRuleApplied: ruleEvaluation.results.find((x) => x.ruleId === 'SIM-CASH-COVERAGE-01')?.scopeApplied === true },
    commerce: { snapshot, projection: projections.commerce, thresholds, now },
    asset: { snapshot, projection: projections.asset, ruleEvaluation, now },
  };
  for (const domain of Object.keys(evalInputs)) {
    if (analyses[domain] !== null) continue; // 已被 override/skip
    const r = ASSESSORS[domain](evalInputs[domain]);
    if (!r.ok) return { ok: false, stage: `assess:${domain}`, problems: r.reasons };
    analyses[domain] = { analysisRun: r.analysisRun, assessment: r.assessment };
  }
  return { ok: true, pack: effectivePack, thresholds, projections, analyses, ruleEvaluation, derived };
}

/**
 * 阶段 3｜收口：Gate 汇总 + 提问计划（含新鲜度刷新提示）+ 金额候选 + 单一下一步。
 * @param p.projections 四域投影（提问计划“已核验”判定与金额候选事实来源）
 */
export function finalizeStage({
  snapshot, transaction = {},
  pack, thresholds,
  assessments, ruleEvaluation, derived = {}, projections,
  amountModelConfigured = true,
  approvedAmount = null,
  now = () => new Date().toISOString(),
}) {
  const gate = evaluateGate({ domainAnalyses: assessments, ruleEvaluation, transaction, now });

  const minLevels = {};
  for (const r of ruleEvaluation.results) {
    for (const mf of r.missingFacts ?? []) minLevels[mf.factKey] = mf.minLevel;
  }
  const questionPlan = planQuestions({ gate, projection: projections.policy, minLevels });
  // 新鲜度失守：补充内部刷新提示（材料再采集是客户负担，由人工决定是否外发）
  if (derived.materials_freshness_ok?.value === false) {
    questionPlan.questions.unshift({
      questionId: 'q-internal-refresh-stale-materials',
      audience: 'internal',
      whyNeeded: { type: 'stale_materials', detail: `材料超过演示新鲜期（365 天）：${(derived.materials_freshness_ok.staleMaterialIds ?? []).join('/')}` },
      expectedEvidence: { kind: 'document', note: '重新采集过期材料' },
      targetFact: null,
      priority: 'high',
      optional: false,
      customerBurden: 'none',
      stopCondition: 'materials_refreshed',
    });
  }

  const { best } = projectionFacts(projections.credit);
  const amountCandidate = computeAmountCandidate({
    productCap: pack.productCap,
    amountModelConfigured,
    facts: {
      monthlyOperatingCashFlow: best('monthly_operating_cash_flow'),
      monthlyDebtService: best('monthly_debt_service'),
      newDebtMonthlyPayment: best('new_debt_monthly_payment'),
      assetConflict: snapshot.conflicts.some((c) => ASSET_CONFLICT_KEYS.includes(c.factKey)),
    },
    approvedAmount,
    thresholds,
    inputWatermark: snapshot.watermark,
    rulesetVersion: ruleEvaluation.rulesetVersion,
  });

  const nextStep = coordinateNextStep({ domainAnalyses: assessments, gate, questionPlan, amountCandidate });
  return { ok: true, gate, questionPlan, amountCandidate, nextStep };
}

/**
 * 四域流水线（阶段组合：感知 → 全域评估 → 收口；全部确定性，零外部调用）。
 * @param p.domainOverrides { domain: {status:'timeout'|...} }（C14 演示）
 * @param p.packOverrides { ruleId: {字段补丁} }（C28 演示；应用后整包重校验）
 */
export function runFourDomainPipeline({
  tenantId, customerId, materials, transaction = {}, asOf,
  rulePack,
  domainOverrides = {},
  packOverrides = null,
  amountModelConfigured = true,
  approvedAmount = null,
  registry = null,
  now = () => new Date().toISOString(),
}) {
  const ps = perceptionStage({ tenantId, customerId, materials, rulePack, registry });
  if (!ps.ok) return ps;
  const snapshot = ps.snapshot;

  const as = assessStage({ snapshot, transaction, asOf, rulePack, domainOverrides, packOverrides, now });
  if (!as.ok) return as;

  const fin = finalizeStage({
    snapshot, transaction, pack: as.pack, thresholds: as.thresholds,
    assessments: as.analyses, ruleEvaluation: as.ruleEvaluation, derived: as.derived,
    projections: as.projections, amountModelConfigured, approvedAmount, now,
  });
  if (!fin.ok) return fin;

  return {
    ok: true,
    snapshot, projections: as.projections, analyses: as.analyses, ruleEvaluation: as.ruleEvaluation,
    gate: fin.gate, questionPlan: fin.questionPlan, amountCandidate: fin.amountCandidate, nextStep: fin.nextStep,
    pipelineVersion: 'four-domain-pipeline@1',
    pipelineFingerprint: stableHash({ rulePack: as.pack.version, thresholds: as.thresholds.versions }),
  };
}

/**
 * 单助手对照臂（§8 最小可证伪实验）：同一规则包 + 单遍评估。
 * 刻意保留的实现差异（诚实声明，写进实验报告的 limitations）：
 * - 不做跨来源冲突保留（snapshot.conflicts 不进入任何门/意见）；
 * - 不做域完成性检查（无必需域概念，超时=无产出）；
 * - 重复来源材料按独立佐证读入（不按内容去重）——即“单助手容易把同一份材料的三份复述
 *   当三份独立证明”这一具体失败模式被结构化复现；
 * 其余（规则引擎、阈值、unknown 传播）与四域臂完全相同，避免制造稻草人。
 */
export function runSingleAssistantPipeline({
  tenantId, customerId, materials, transaction = {}, asOf, rulePack,
  now = () => new Date().toISOString(),
}) {
  const packCheck = validateRulePack(rulePack);
  if (!packCheck.ok) return { ok: false, stage: 'rule_pack', problems: packCheck.problems };
  const thresholds = createThresholds({ business: rulePack.businessThresholds, system: rulePack.systemThresholds });
  // 重复内容不去重：每份材料的事实都进表（对照臂的已知弱点）
  const fakeCaps = defaultSimulationRegistry();
  const items = [];
  for (const m of materials) {
    const cap = fakeCaps.checkMaterial({ providerMode: PROVIDER.providerMode, modelVersion: PROVIDER.modelVersion, material: m });
    if (!cap.ok) continue;
    for (const f of m.declaredFacts ?? []) {
      items.push({
        factKey: f.factKey, value: f.value, verificationLevel: f.verificationLevel,
        materialId: m.materialId, sourceRef: m.sourceRef ?? null, caliber: f.caliber ?? null, unit: f.unit ?? null,
      });
    }
  }
  const projection = { items, supersededItems: [], unreadable: [], duplicateGroups: [], conflicts: [] };
  const derived = deriveFacts(projection, asOf);
  const ruleEvaluation = evaluateRules({ pack: rulePack, projection, asOf, transaction, derivedFacts: derived });

  // 单域“综合意见”：只聚合 unknown，不做冲突/疑点发现
  const unknowns = [];
  const has = (k) => projection.items.some((it) => it.factKey === k);
  for (const k of ['monthly_operating_cash_flow', 'monthly_debt_service', 'equipment_ownership_verified', 'entity_identity_verified']) {
    if (!has(k)) unknowns.push(`${k} 缺失`);
  }
  const singleAssessment = { domain: 'credit', findingsSuspicion: [], contradictions: [], evidenceRefs: [], stale: false };
  const gate = evaluateGate({
    domainAnalyses: { credit: { analysisRun: { inputWatermark: { generation: 1 }, inputHash: 'single', domain: 'credit' }, assessment: singleAssessment } },
    ruleEvaluation,
    requiredDomains: ['credit'],
    transaction, now,
  });
  gate.limitations = ['单助手对照臂：无跨来源冲突保留、无域完成性检查、重复来源未去重（见 runSingleAssistantPipeline 注释）'];
  void unknowns; void thresholds;
  return { ok: true, ruleEvaluation, gate, pipelineVersion: 'single-assistant-pipeline@1' };
}
