import { createHash, randomUUID } from 'node:crypto';
import { OBJECTIVES, DEFAULT_LIMITS } from './scenarios.mjs';

export class InputError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.status = status; this.code = code; }
}
export function object(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${name} 必须是对象`);
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new InputError(`${name} 含未声明字段`);
  return value;
}
export function text(value, name, min = 2, max = 800) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new InputError(`${name}需要 ${min}–${max} 个字符`);
  return value.trim();
}
export function percentage(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new InputError(`${name}必须是 0–100 的有限数值`);
  return value;
}
export function validatePreferences(weights, limits) {
  object(weights, OBJECTIVES.map(o => o.id), '目标权重');
  for (const o of OBJECTIVES) percentage(weights[o.id], o.label);
  const total = Object.values(weights).reduce((sum, n) => sum + n, 0);
  if (total === 0) throw new InputError('至少为一个目标设置正权重');
  object(limits, Object.keys(DEFAULT_LIMITS), '方案边界');
  for (const key of Object.keys(DEFAULT_LIMITS)) percentage(limits[key], '方案边界');
  return { normalizedWeights: Object.fromEntries(OBJECTIVES.map(o => [o.id, weights[o.id] / total])), limits };
}
const known = n => typeof n === 'number' && Number.isFinite(n);
const round = n => Math.round(n * 100) / 100;
export function evaluate(state) {
  const { normalizedWeights, limits } = validatePreferences(state.weights, state.limits);
  const candidates = state.candidates.map(c => {
    const unknown = OBJECTIVES.filter(o => !known(c.metrics[o.metric])).map(o => o.label);
    const blockers = unknown.map(label => `${label}假设缺失`);
    if (!known(c.informationCompleteness) || c.informationCompleteness < limits.minInformationPct) blockers.push('信息完整度低于下限');
    if (known(c.metrics.effortPoints) && c.metrics.effortPoints > limits.maxEffortPoints) blockers.push('投入程度超过上限');
    if (known(c.metrics.flexibilityScore) && c.metrics.flexibilityScore < limits.minFlexibilityScore) blockers.push('可调整性低于下限');
    if (known(c.metrics.dependencyScore) && c.metrics.dependencyScore > limits.maxDependencyScore) blockers.push('依赖程度超过上限');
    const contributions = Object.fromEntries(OBJECTIVES.map(o => {
      const value = c.metrics[o.metric];
      if (!known(value)) return [o.id, null];
      const scaled = Math.max(0, Math.min(1, (value - o.scale[0]) / (o.scale[1] - o.scale[0])));
      return [o.id, round((o.direction === 'min' ? 1 - scaled : scaled) * normalizedWeights[o.id] * 100)];
    }));
    return { ...c, eligible: blockers.length === 0, blockers,
      score: unknown.length ? null : round(Object.values(contributions).reduce((s, n) => s + n, 0)), contributions, pareto: false };
  });
  const feasible = candidates.filter(c => c.eligible);
  for (const c of feasible) c.pareto = !feasible.some(other => other.id !== c.id &&
    OBJECTIVES.every(o => o.direction === 'max' ? other.metrics[o.metric] >= c.metrics[o.metric] : other.metrics[o.metric] <= c.metrics[o.metric]) &&
    OBJECTIVES.some(o => other.metrics[o.metric] !== c.metrics[o.metric]));
  candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
  return { id: randomUUID(), inputVersion: state.inputVersion, method: 'deterministic_weighted_utility', authority: 'none',
    generatedAt: new Date().toISOString(), normalizedWeights, limits: { ...limits }, candidates,
    recommendedId: candidates.find(c => c.eligible)?.id ?? null,
    inputDigest: createHash('sha256').update(JSON.stringify({ weights: state.weights, limits: state.limits, candidates: state.candidates })).digest('hex'),
    explanation: '先检查硬约束，再计算加权效用。分数不是概率或置信度；推荐不等于人工决定。Pareto 表示在四个目标上均无更优可行方案。' };
}
