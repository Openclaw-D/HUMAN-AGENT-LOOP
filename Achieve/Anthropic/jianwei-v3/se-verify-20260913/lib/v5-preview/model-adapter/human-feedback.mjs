// 人工纠偏记录与规则提升判定候选协议(R2 工作包6)。纯函数、零依赖、不发网络。
// 结构化表达"模型不自升权限":decidedBy 仅允许 'human',传 'model'/'ai' 一律 TypeError。
// 局部纠偏与全局规则分离:单例不能触发规则替换(样本≥2、不同情形≥2、反例非空才可提交评审)。
// 本模块没有任何自动训练、自动规则替换或自动执行入口;预案 status 恒为 awaiting_human_decision。
// 规则表与样例见 PROTOCOL_NOTES.md。

export const GENERATED_BY = 'candidate-protocol-v0';
export const CORRECTION_SCOPES = Object.freeze(['local', 'global']);
export const HUMAN_DECIDER = 'human';
export const AWAITING_HUMAN_DECISION = 'awaiting_human_decision';

/** 全局规则提升的最低条件(必要非充分;生效另需 decidedBy='human' 的人工决策记录并由人签发)。 */
export const MIN_SAMPLES_FOR_GLOBAL_RULE = 2;
export const MIN_DISTINCT_CASES = 2;

const REQUIRED_RECORD_FIELDS = Object.freeze([
  'id', 'scope', 'targetKind', 'targetId', 'reason', 'sample', 'impact', 'decidedBy',
]);

function fail(message) {
  throw new TypeError(message);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} 必须为非空字符串`);
}

function requireNonEmptyArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) fail(`${name} 必须为非空数组`);
}

function requireCount(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${name} 必须为非负整数(收到 ${JSON.stringify(value)})`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** 深拷贝并深冻结:记录/预案不可篡改,且与调用方输入对象解耦(冻结不改调用方原件)。 */
function frozenClone(value, name) {
  let copied;
  try {
    copied = structuredClone(value);
  } catch {
    fail(`${name} 必须为可结构化克隆的纯数据(不含函数、DOM 等)`);
  }
  return deepFreeze(copied);
}

/**
 * createCorrectionRecord({ id, scope, targetKind, targetId, reason, sample,
 *                          counterExample?, impact, decidedBy }) → 冻结的纠偏记录
 *
 * - 缺必填字段 / 空串 / 非法 scope / decidedBy 非 'human' → TypeError;
 * - decidedBy='model' 抛 TypeError 正是"模型不自升权限"的结构化表达:
 *   纠偏与规则变更只能由人决定,模型/AI 一律不得作为 decidedBy;
 * - reason/impact 按约定用中文书写(不强制校验字符集,便于夹带协议标识);
 * - 返回对象深冻结:任何字段篡改(ESM 严格模式赋值)抛 TypeError;
 * - 不含时间戳/随机数:同输入两次调用 JSON 相等(确定性)。
 */
export function createCorrectionRecord(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('入参必须为对象');
  for (const field of REQUIRED_RECORD_FIELDS) {
    if (input[field] === undefined) fail(`缺少必填字段:${field}`);
  }
  requireNonEmptyString(input.id, 'id');
  if (!CORRECTION_SCOPES.includes(input.scope)) {
    fail(`scope 非法:${JSON.stringify(input.scope)};仅允许 'local'(局部纠偏)或 'global'(全局规则候选)`);
  }
  requireNonEmptyString(input.targetKind, 'targetKind');
  requireNonEmptyString(input.targetId, 'targetId');
  requireNonEmptyString(input.reason, 'reason'); // 约定中文书写,见 PROTOCOL_NOTES.md
  if (input.sample === null) fail('sample 不能为 null:纠偏记录必须保留样本');
  requireNonEmptyString(input.impact, 'impact');
  if (input.counterExample !== undefined && input.counterExample === null) {
    fail('counterExample 不能为 null:如无反例请省略该字段');
  }
  if (input.decidedBy !== HUMAN_DECIDER) {
    fail(`decidedBy 必须为 'human'(收到 ${JSON.stringify(input.decidedBy)}):`
      + '模型/AI 不得作为纠偏决策者,纠偏与规则变更只能由人决定');
  }

  return deepFreeze({
    protocol: GENERATED_BY,
    type: 'correction_record',
    id: input.id,
    scope: input.scope,
    targetKind: input.targetKind,
    targetId: input.targetId,
    reason: input.reason,
    sample: frozenClone(input.sample, 'sample'),
    counterExample: input.counterExample === undefined
      ? null
      : frozenClone(input.counterExample, 'counterExample'),
    impact: input.impact,
    decidedBy: HUMAN_DECIDER,
    status: 'recorded',
  });
}

/**
 * canPromoteToGlobalRule({ scope, sampleCount, distinctCases, counterExamples })
 *   → { allowed: boolean, reason(中文) }
 *
 * 四个 false 条件(按序判定),单例不能触发规则替换:
 *   1. scope !== 'global'(局部纠偏不触发全局规则替换);
 *   2. sampleCount < 2;
 *   3. distinctCases < 2(同一情形的重复样本不构成普遍规则);
 *   4. counterExamples 为空(null/undefined/[]——缺少反例无法界定适用边界)。
 *
 * allowed=true 仅表示"达到提交人工评审的最低条件",不等于规则生效;
 * 生效前置条件是存在 decidedBy='human' 的人工决策记录并由人签发,本协议不执行自动替换。
 */
export function canPromoteToGlobalRule({ scope, sampleCount, distinctCases, counterExamples } = {}) {
  if (scope === undefined) fail('缺少必填字段:scope');
  if (!CORRECTION_SCOPES.includes(scope)) {
    fail(`scope 非法:${JSON.stringify(scope)};仅允许 'local' 或 'global'`);
  }
  requireCount(sampleCount, 'sampleCount');
  requireCount(distinctCases, 'distinctCases');
  if (counterExamples !== null && counterExamples !== undefined && !Array.isArray(counterExamples)) {
    fail('counterExamples 必须为数组;无反例时请传空数组或 null');
  }

  const no = (reason) => Object.freeze({ allowed: false, reason });
  if (scope !== 'global') {
    return no(`scope 为 ${JSON.stringify(scope)} 而非 'global':局部纠偏不触发全局规则替换,`
      + '须待同类问题在其他情形复现后再评估');
  }
  if (sampleCount < MIN_SAMPLES_FOR_GLOBAL_RULE) {
    return no(`样本数 ${sampleCount} 低于最低要求 ${MIN_SAMPLES_FOR_GLOBAL_RULE}:单例不能触发规则替换`);
  }
  if (distinctCases < MIN_DISTINCT_CASES) {
    return no(`不同情形数 ${distinctCases} 低于最低要求 ${MIN_DISTINCT_CASES}:同一情形的重复样本不构成普遍规则`);
  }
  if (!Array.isArray(counterExamples) || counterExamples.length === 0) {
    return no('未提供反例:缺少反例无法界定规则适用边界,须补充至少一个反例后再评估');
  }
  return Object.freeze({
    allowed: true,
    reason: `满足提交评审的最低条件(scope='global'、样本 ${sampleCount}、不同情形 ${distinctCases}、`
      + `反例 ${counterExamples.length} 个);allowed 仅表示可提交人工评审,规则生效另需 `
      + "decidedBy='human' 的人工决策记录并由人签发,本协议不执行自动替换",
  });
}

/**
 * buildImprovementPlan({ ruleId, samples, counterExamples, impact, humanDecision })
 *   → 冻结的改进预案
 *
 * 预案四要素:样本(samples)/ 反例(counterExamples)/ 影响(impact)/ 人工决策(humanDecision)。
 * - 四要素任一缺失/为空 → TypeError;
 * - status 恒为 'awaiting_human_decision':即使 humanDecision 传入"同意"字样,
 *   状态也不会变化——本层没有任何自动训练/自动执行入口,一切等人决策;
 * - planId = 'improvement-plan:' + ruleId,确定性派生,不引入随机数/时间戳;
 * - 返回对象深冻结:篡改抛 TypeError。
 */
export function buildImprovementPlan({ ruleId, samples, counterExamples, impact, humanDecision } = {}) {
  requireNonEmptyString(ruleId, 'ruleId');
  requireNonEmptyArray(samples, 'samples');                   // 要素一:样本
  requireNonEmptyArray(counterExamples, 'counterExamples');   // 要素二:反例
  requireNonEmptyString(impact, 'impact');                    // 要素三:影响
  requireNonEmptyString(humanDecision, 'humanDecision');      // 要素四:人工决策安排(中文说明)

  return deepFreeze({
    protocol: GENERATED_BY,
    type: 'improvement_plan',
    planId: `improvement-plan:${ruleId}`,
    ruleId,
    samples: frozenClone(samples, 'samples'),
    counterExamples: frozenClone(counterExamples, 'counterExamples'),
    impact,
    humanDecision,
    // 恒定状态:本层没有自动训练/自动执行入口;status 不可经任何输入变为"已执行"。
    status: AWAITING_HUMAN_DECISION,
  });
}
