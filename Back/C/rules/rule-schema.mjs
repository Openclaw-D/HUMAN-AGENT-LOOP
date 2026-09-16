// 任务 03 · S2 版本化规则 Schema。每条规则必须具备任务书 §4 全部字段；
// 本环境只接受 sourceRef.kind='simulation_rule'（显式合成规则，不冒充公司制度）；
// 未批准 / 过期 / 生效窗口外 / 来源不可确认的规则一律不激活为正式硬门（C28/C12）。
// 公司内规与监管规则分层：本包不含任何真实监管阈值；适用机构类型必须显式声明，
// 不得把金融租赁公司规定不加区分套到商业融资租赁（C 路既定边界）。

import { VERIFICATION_LEVELS } from '../domains/schema.mjs';

export const RULE_STATUSES = Object.freeze(['approved', 'pending_approval', 'rejected', 'retired']);
export const SOURCE_KINDS = Object.freeze(['simulation_rule']); // 本环境唯一合法来源；公司制度/监管条文待治理流程
export const CONDITION_OPS = Object.freeze(['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_true', 'is_false']);
export const EFFECT_KINDS = Object.freeze(['hard_block']);

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateCondition(cond, path, reasons) {
  if (cond === null || typeof cond !== 'object') { reasons.push(`${path} 必须为对象`); return; }
  if (Array.isArray(cond.allOf)) {
    if (cond.allOf.length === 0) reasons.push(`${path}.allOf 不能为空`);
    cond.allOf.forEach((c, i) => validateCondition(c, `${path}.allOf[${i}]`, reasons));
    if (cond.op !== undefined || cond.fact !== undefined) reasons.push(`${path} 组合节点不得带 op/fact`);
    return;
  }
  if (!isStr(cond.fact)) { reasons.push(`${path}.fact 必填（原子条件）`); return; }
  if (!CONDITION_OPS.includes(cond.op)) reasons.push(`${path}.op 必须为 ${CONDITION_OPS.join('/')}`);
  if (!['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'].includes(cond.op)) {
    if (cond.value !== undefined) reasons.push(`${path} ${cond.op} 不得带 value`);
  } else if (!('value' in cond)) {
    reasons.push(`${path} 缺 value`);
  }
}

/**
 * 校验单条规则。返回 { ok, problems[] }。任何缺失字段都是失败（不默认补齐）。
 */
export function validateRule(rule) {
  const problems = [];
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return { ok: false, problems: ['规则必须为对象'] };
  if (!isStr(rule.ruleId)) problems.push('ruleId 必填');
  if (!Number.isInteger(rule.version) || rule.version < 1) problems.push('version 必须为 ≥1 整数');
  // 适用范围：机构类型/地区/产品/客户范围必须显式声明（可为 '*'，但不得缺失）
  const sc = rule.scope;
  if (!sc || typeof sc !== 'object') problems.push('scope 必填（适用机构类型/地区/产品/客户范围）');
  else {
    for (const k of ['orgTypes', 'regions', 'products', 'customerRange']) {
      if (!(k in sc)) problems.push(`scope.${k} 必填（'*' 表示显式全量）`);
    }
    if (Array.isArray(sc.orgTypes) && sc.orgTypes.length === 0) problems.push('scope.orgTypes 不能为空数组（用 ["*"] 显式声明全量）');
  }
  // 生效窗口
  for (const k of ['effectiveFrom', 'effectiveTo']) {
    if (rule[k] !== null && !isStr(rule[k])) problems.push(`${k} 必须为 ISO 日期字符串或 null`);
  }
  if (isStr(rule.effectiveFrom) && isStr(rule.effectiveTo) && rule.effectiveFrom > rule.effectiveTo) {
    problems.push('effectiveFrom 晚于 effectiveTo');
  }
  // 来源与审批：本环境只接受 simulation_rule；approvalStatus 枚举校验
  const sr = rule.sourceRef;
  if (!sr || typeof sr !== 'object' || !SOURCE_KINDS.includes(sr.kind)) {
    problems.push(`sourceRef.kind 必须为 ${SOURCE_KINDS.join('/')}（公司制度/监管条文的接入须治理流程批准后扩展）`);
  }
  if (!sr?.id) problems.push('sourceRef.id 必填');
  if (!RULE_STATUSES.includes(rule.approvalStatus)) problems.push(`approvalStatus 必须为 ${RULE_STATUSES.join('/')}`);
  // 所需事实与核验等级
  if (!Array.isArray(rule.requiredFacts)) problems.push('requiredFacts 必须为数组');
  else rule.requiredFacts.forEach((f, i) => {
    if (!f || !isStr(f.factKey)) problems.push(`requiredFacts[${i}].factKey 必填`);
    if (!VERIFICATION_LEVELS.includes(f.minLevel)) problems.push(`requiredFacts[${i}].minLevel 非法`);
  });
  validateCondition(rule.condition, 'condition', problems);
  // 效果与阻断动作
  const ef = rule.effect;
  if (!ef || typeof ef !== 'object' || !EFFECT_KINDS.includes(ef.kind)) problems.push(`effect.kind 必须为 ${EFFECT_KINDS.join('/')}`);
  if (!Array.isArray(ef?.blockedActions) || ef.blockedActions.length === 0) problems.push('effect.blockedActions 必须为非空数组');
  if (typeof rule.nonWaivable !== 'boolean') problems.push('nonWaivable 必须为布尔');
  // 复核/升级责任人
  const rv = rule.review;
  if (!rv || !isStr(rv?.role)) problems.push('review.role（复核责任人）必填');
  if (rv && !isStr(rv.escalateRole)) problems.push('review.escalateRole（升级责任人）必填');
  if (rule.alternativeVersions !== undefined && !Array.isArray(rule.alternativeVersions)) {
    problems.push('alternativeVersions 必须为数组');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 校验规则包：包级版本 + 逐条校验 + ruleId 唯一。
 */
export function validateRulePack(pack) {
  const problems = [];
  if (!pack || typeof pack !== 'object') return { ok: false, problems: ['规则包必须为对象'] };
  if (!isStr(pack.rulePackId)) problems.push('rulePackId 必填');
  if (!isStr(pack.version)) problems.push('version 必填（语义化版本字符串）');
  if (!Array.isArray(pack.rules) || pack.rules.length === 0) problems.push('rules 必须为非空数组');
  const seen = new Set();
  (pack.rules ?? []).forEach((r, i) => {
    const v = validateRule(r);
    if (!v.ok) problems.push(...v.problems.map((p) => `rules[${i}](${r?.ruleId ?? '?'}): ${p}`));
    if (seen.has(r?.ruleId)) problems.push(`rules[${i}]: ruleId ${r.ruleId} 重复`);
    seen.add(r?.ruleId);
  });
  if (pack.boundary !== 'simulation_only') {
    problems.push('boundary 必须为 "simulation_only"（显式声明本包不冒充公司制度）');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 激活判定（确定性）：返回 { activated:boolean, inactiveReason?:code }。
 * inactiveReason ∈ approval_pending | rejected | retired | out_of_window | source_unconfirmed。
 * 激活的规则才有资格产生 Gate 结果；未激活规则的信息以 policy_pending 语义透出，不放行也不阻断。
 */
export function activationStatus(rule, { asOf }) {
  if (rule.approvalStatus === 'pending_approval') return { activated: false, inactiveReason: 'approval_pending' };
  if (rule.approvalStatus === 'rejected') return { activated: false, inactiveReason: 'rejected' };
  if (rule.approvalStatus === 'retired') return { activated: false, inactiveReason: 'retired' };
  if (rule.effectiveFrom && asOf < rule.effectiveFrom) return { activated: false, inactiveReason: 'out_of_window' };
  if (rule.effectiveTo && asOf > rule.effectiveTo) return { activated: false, inactiveReason: 'out_of_window' };
  if (!rule.sourceRef || rule.sourceRef.kind !== 'simulation_rule') return { activated: false, inactiveReason: 'source_unconfirmed' };
  return { activated: true };
}
