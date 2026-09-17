// 任务 03 · S2 确定性规则引擎：条件求值完全确定性，无模型判断。
// - 前提核验：requiredFacts 的事实必须达到声明核验等级，否则本规则 outcome=precondition_missing
//   （贡献 NEEDS_EVIDENCE），绝不在未知事实上“猜命中”。
// - 命中：激活规则的 condition 在达等级事实上成立 → outcome=hit（贡献 NEEDS_EVIDENCE/HOLD/HARD_BLOCK）。
// - 不命中：outcome=not_hit（在声明的输入范围与规则版本下未发现命中，不等于保证安全）。
// - 历史回放：同版本规则包 + 同 asOf 评估结果可重放（规则文件不可变，改版=新版本号）。
//
// 任务 02 · B2/W04 负例加固（PR#3 审核 W04：不静默不适用/不静默安全）：
// - 适用面缺失：规则 scope 限定具体维度而交易面未提供该维度 → outcome=applicability_unknown
//   （待核验），不再当作"不适用"静默跳过；交易面提供且不命中才是确定不适用。
// - 类型不符：数值比较遇非有限数/非数值、布尔判定遇非布尔、等值比较遇类型不同 →
//   outcome=condition_error（明确错误），不再转成 not_hit 安全结论。

import { activationStatus } from './rule-schema.mjs';
import { VERIFICATION_LEVELS } from '../domains/schema.mjs';

function levelRank(l) { return VERIFICATION_LEVELS.indexOf(l); }

/** 原子条件求值（确定性；未知值 → false 且标记 evaluatedOnUnknown；类型不符 → typeError）。 */
function evalAtomic(cond, facts) {
  const entries = facts[cond.fact];
  const best = entries && entries.length > 0
    ? entries.reduce((a, b) => (levelRank(b.verificationLevel) >= levelRank(a.verificationLevel) ? b : a))
    : null;
  if (!best) return { ok: false, evaluatedOnUnknown: true, present: false };
  const v = best.value;
  const typeError = (code) => ({ ok: false, evaluatedOnUnknown: false, present: true, typeError: code });
  let result = false;
  switch (cond.op) {
    case 'equals':
      if (typeof v !== typeof cond.value) return typeError('VALUE_TYPE_MISMATCH');
      result = v === cond.value;
      break;
    case 'not_equals':
      if (typeof v !== typeof cond.value) return typeError('VALUE_TYPE_MISMATCH');
      result = v !== cond.value;
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (typeof v !== 'number' || !Number.isFinite(v)) return typeError('NON_NUMERIC_VALUE');
      result = cond.op === 'gt' ? v > cond.value
        : cond.op === 'gte' ? v >= cond.value
          : cond.op === 'lt' ? v < cond.value
            : v <= cond.value;
      break;
    case 'in':
      if (!Array.isArray(cond.value)) return typeError('CONDITION_MALFORMED');
      result = cond.value.some((x) => JSON.stringify(x) === JSON.stringify(v));
      break;
    case 'not_in':
      if (!Array.isArray(cond.value)) return typeError('CONDITION_MALFORMED');
      result = !cond.value.some((x) => JSON.stringify(x) === JSON.stringify(v));
      break;
    case 'is_true':
      if (typeof v !== 'boolean') return typeError('NON_BOOLEAN_VALUE');
      result = v === true;
      break;
    case 'is_false':
      if (typeof v !== 'boolean') return typeError('NON_BOOLEAN_VALUE');
      result = v === false;
      break;
    default:
      return typeError('UNKNOWN_OPERATOR');
  }
  return { ok: result, evaluatedOnUnknown: best.verificationLevel === 'unknown', present: true };
}

function evalCondition(cond, facts) {
  if (Array.isArray(cond.allOf)) {
    const parts = cond.allOf.map((c) => evalCondition(c, facts));
    return {
      ok: parts.every((p) => p.ok),
      evaluatedOnUnknown: parts.some((p) => p.evaluatedOnUnknown),
      typeError: (parts.find((p) => p.typeError) ?? {}).typeError,
      factsMissing: parts.some((p) => (p.factsMissing ?? []).length > 0) ? parts.flatMap((p) => p.factsMissing ?? []) : [],
    };
  }
  const r = evalAtomic(cond, facts);
  return { ok: r.ok, evaluatedOnUnknown: r.evaluatedOnUnknown, typeError: r.typeError, factsMissing: r.present ? [] : [cond.fact] };
}

/**
 * 事实表构建：从域投影提取 factKey → 取值数组（含核验等级与材料定位）。
 * 冲突值全部保留：同 factKey 多个不同值时条件按“最高核验等级的取值”判定，
 * 同时在结果中标记 conflictsPresent（上游 Gate 据此升级 HOLD）。
 */
export function buildFactTable(projection) {
  const facts = {};
  for (const it of projection.items) {
    facts[it.factKey] = [...(facts[it.factKey] ?? []), {
      value: it.value, verificationLevel: it.verificationLevel,
      materialId: it.materialId, sourceRef: it.sourceRef,
    }];
  }
  return facts;
}

/**
 * 评估规则包（确定性，可重放）。
 * @param p.pack 已过 validateRulePack 的规则包
 * @param p.projection 域感知投影（buildFactTable 从中取事实）
 * @param p.asOf ISO 日期（生效窗口判定；历史回放=换 asOf 与/或旧版本包）
 * @param p.transaction {orgType?, region?, product?, customerRange?} 交易适用面
 * @param p.derivedFacts 派生事实 { factKey: {value, verificationLevel, formula} }（如覆盖率；
 *   等级取输入最低级，来源标注公式，可回溯）
 * @returns { rulesetVersion, asOf, results:[RuleResult], policyPending:boolean, facts }
 *   RuleResult = { ruleId, version, activated, inactiveReason?, outcome: hit|not_hit|precondition_missing,
 *                  missingFacts?, blockedActions?, nonWaivable?, scopeApplied }
 */
export function evaluateRules({ pack, projection, asOf, transaction = {}, derivedFacts = {} }) {
  const facts = buildFactTable(projection);
  for (const [key, d] of Object.entries(derivedFacts)) {
    facts[key] = [{ value: d.value, verificationLevel: d.verificationLevel ?? 'unknown', materialId: `derived:${key}`, sourceRef: { field: d.formula ?? 'derived' } }];
  }
  const results = [];
  let policyPending = false;
  for (const rule of pack.rules) {
    // 适用面判定：维度缺失=applicability_unknown（待核验）；提供且不命中=确定不适用
    const sd = scopeDecision(rule.scope, transaction);
    const scopeApplied = sd.applied && sd.unknownDims.length === 0;
    const act = activationStatus(rule, { asOf });
    if (!act.activated) {
      // 存在相关但未批准/来源未确认的规则 → policy_pending（不得自行推断适用后放行，C28）；
      // 过期/停用/否决规则属确定不适用，不产生 policy_pending
      if (scopeApplied && ['approval_pending', 'source_unconfirmed'].includes(act.inactiveReason)) policyPending = true;
      results.push({ ruleId: rule.ruleId, version: rule.version, activated: false, inactiveReason: act.inactiveReason, outcome: null, scopeApplied });
      continue;
    }
    // W04：适用面维度缺失 → 待核验，不当"不适用"跳过，也不在未知范围内评估命中
    if (sd.unknownDims.length > 0) {
      results.push({
        ruleId: rule.ruleId, version: rule.version, activated: true, inactiveReason: null,
        outcome: 'applicability_unknown', applicabilityUnknown: sd.unknownDims,
        scopeApplied: false, nonWaivable: rule.nonWaivable,
      });
      continue;
    }
    if (!sd.applied) {
      results.push({ ruleId: rule.ruleId, version: rule.version, activated: true, inactiveReason: null, outcome: null, scopeApplied: false });
      continue;
    }
    // 前提核验：等级不足 = 缺证（不猜命中）
    const missingFacts = [];
    for (const rf of rule.requiredFacts) {
      const entries = facts[rf.factKey] ?? [];
      const okLevel = entries.some((e) => levelRank(e.verificationLevel) >= levelRank(rf.minLevel));
      if (!okLevel) missingFacts.push({ factKey: rf.factKey, minLevel: rf.minLevel });
    }
    if (missingFacts.length > 0) {
      results.push({
        ruleId: rule.ruleId, version: rule.version, activated: true, inactiveReason: null,
        outcome: 'precondition_missing', missingFacts, scopeApplied: true,
        blockedActions: rule.effect.blockedActions, nonWaivable: rule.nonWaivable,
        evidenceRefs: requiredFactEvidence(facts, rule.requiredFacts),
      });
      continue;
    }
    const verdict = evalCondition(rule.condition, facts);
    // W04：类型不符/未知操作符 = 明确错误，不转 not_hit 安全结论
    if (verdict.typeError) {
      results.push({
        ruleId: rule.ruleId, version: rule.version, activated: true, inactiveReason: null,
        outcome: 'condition_error', errorCode: verdict.typeError,
        evaluatedOnUnknown: verdict.evaluatedOnUnknown, scopeApplied: true,
        blockedActions: rule.effect.blockedActions, nonWaivable: rule.nonWaivable,
        evidenceRefs: conditionEvidence(facts, rule),
      });
      continue;
    }
    results.push({
      ruleId: rule.ruleId, version: rule.version, activated: true, inactiveReason: null,
      outcome: verdict.ok ? 'hit' : 'not_hit',
      evaluatedOnUnknown: verdict.evaluatedOnUnknown,
      scopeApplied: true,
      blockedActions: rule.effect.blockedActions, nonWaivable: rule.nonWaivable,
      evidenceRefs: conditionEvidence(facts, rule),
      releaseWhen: [
        { type: 'fact_correction', note: `纠正 ${rule.requiredFacts.map((f) => f.factKey).join('/')} 等事实后重算（确定性重评）` },
        { type: 'governance_update', ruleId: rule.ruleId, note: '经治理流程更新或停用本规则版本' },
      ],
    });
  }
  return { rulesetVersion: pack.version, asOf, results, policyPending, facts };
}

/**
 * 适用面判定：返回 { applied:boolean, unknownDims:string[] }。
 * 规则限定具体值而交易面缺失该维度 → unknownDims 记录该维度（待核验，不当"不适用"）；
 * 交易面提供了值且不在范围内 → 确定不适用；scope 含 '*' 恒适用。
 */
function scopeDecision(scope, t) {
  const unknownDims = [];
  const decide = (list, v, key) => {
    if (Array.isArray(list) && list.includes('*')) return true;
    if (v === undefined || v === null || v === '') { unknownDims.push(key); return true; }
    return Array.isArray(list) ? list.includes(v) : list === v;
  };
  const orgOk = decide(scope.orgTypes, t.orgType, 'orgType');
  const regionOk = decide(scope.regions, t.region, 'region');
  const productOk = decide(scope.products, t.product, 'product');
  const cr = scope.customerRange;
  const crOk = Array.isArray(cr)
    ? decide(cr, t.customerRange, 'customerRange')
    : (cr === '*' ? true : decide([cr], t.customerRange, 'customerRange'));
  return { applied: orgOk && regionOk && productOk && crOk, unknownDims };
}

function factEvidence(facts, factKey) {
  return (facts[factKey] ?? []).map((e) => ({ materialId: e.materialId, location: e.sourceRef }));
}

function requiredFactEvidence(facts, requiredFacts) {
  const refs = [];
  for (const f of requiredFacts) refs.push(...factEvidence(facts, f.factKey));
  return refs;
}

/** 条件涉及事实的证据定位（关键发现必须可定位）。 */
function conditionEvidence(facts, rule) {
  const keys = new Set();
  const collect = (c) => {
    if (Array.isArray(c.allOf)) c.allOf.forEach(collect);
    else keys.add(c.fact);
  };
  collect(rule.condition);
  const refs = [];
  for (const k of keys) refs.push(...factEvidence(facts, k));
  return refs;
}
