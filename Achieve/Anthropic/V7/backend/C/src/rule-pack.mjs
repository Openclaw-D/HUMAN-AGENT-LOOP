// V7 Lane C · 规则包加载与完整性校验（数据与代码分离；规则包为版本化 JSON）。
// 校验失败显式抛错（失败关闭），不静默降级。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULE_PACK_PATH = join(HERE, '..', 'rules', 'rule-pack-v1.json');

/**
 * 加载并校验规则包。
 * @param {string} [path] 默认 rule-pack-v1.json
 * @returns {object} rulePack（原样 JSON + 解析元数据）
 */
export function loadRulePack(path = RULE_PACK_PATH) {
  const raw = readFileSync(path, 'utf8');
  let pack;
  try {
    pack = JSON.parse(raw);
  } catch (e) {
    throw new Error(`规则包 JSON 损坏：${String(e.message)}`);
  }
  const problems = validateRulePack(pack);
  if (problems.length > 0) {
    throw new Error(`规则包不合格：${problems.join('；')}`);
  }
  return pack;
}

/** 结构校验：必需区块/字段；确认边界与实验假设分离；升级条件为类别而非数值阈值。 */
export function validateRulePack(pack) {
  const problems = [];
  if (pack === null || typeof pack !== 'object') return ['规则包必须为对象'];
  for (const key of ['rulePackId', 'version', 'status', 'confirmedBoundaries', 'experimentalAssumptions', 'scope', 'humanEscalation', 'outputBoundary', 'scenarioLeads']) {
    if (!(key in pack)) problems.push(`缺区块：${key}`);
  }
  if (problems.length > 0) return problems;

  if (!Array.isArray(pack.scope.indicators) || pack.scope.indicators.length === 0) problems.push('scope.indicators 必须为非空数组');
  if (!Array.isArray(pack.scope.allowedTools) || pack.scope.allowedTools.length === 0) problems.push('scope.allowedTools 必须为非空数组');
  if (pack.scope.inputCaliberRequired !== true) problems.push('scope.inputCaliberRequired 必须为 true（缺口径不得计算）');
  if (!Array.isArray(pack.scope.currencyAllowList) || pack.scope.currencyAllowList.length === 0) problems.push('scope.currencyAllowList 必须为非空数组');

  const esc = pack.humanEscalation;
  if (!Array.isArray(esc) || esc.length === 0) problems.push('humanEscalation 必须为非空数组');
  const reasons = new Set((esc ?? []).map((h) => h.reason));
  for (const required of ['rule_not_covered', 'missing_input', 'caliber_change', 'evidence_conflict', 'superseded_evidence_cited', 'model_output_invalid', 'call_not_sent', 'call_unknown', 'calc_mismatch', 'uncertainty_understatement']) {
    if (!reasons.has(required)) problems.push(`humanEscalation 缺升级类别：${required}`);
  }

  const candidateFields = pack.outputBoundary?.candidateFields;
  const expectedFields = ['observations', 'evidenceRefs', 'assumptions', 'uncertainty', 'recommendedHumanAction'];
  if (!Array.isArray(candidateFields) || candidateFields.join() !== expectedFields.join()) {
    problems.push(`outputBoundary.candidateFields 必须为 ${expectedFields.join('/')}`);
  }

  // 确认边界 vs 实验假设：两个区块都必须非空且可区分。
  if (!Array.isArray(pack.confirmedBoundaries) || pack.confirmedBoundaries.length === 0) problems.push('confirmedBoundaries 必须为非空数组');
  if (!Array.isArray(pack.experimentalAssumptions) || pack.experimentalAssumptions.length === 0) problems.push('experimentalAssumptions 必须为非空数组');

  // 场景线索不得自动成为规则：必须是 lead 声明，且不得出现在 scope.indicators。
  if (!Array.isArray(pack.scenarioLeads?.items)) problems.push('scenarioLeads.items 必须为数组');
  for (const lead of pack.scenarioLeads?.items ?? []) {
    if (pack.scope.indicators.includes(lead)) problems.push(`场景线索 ${lead} 不得进入 scope.indicators（未实读不得晋升）`);
  }

  // 不得包含数值阈值形态的键（本轮不发布任何真实金融政策阈值）。
  const forbidden = ['threshold', 'thresholds', 'minRatio', 'maxRatio', 'limit', 'limits', 'cutoff'];
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (forbidden.includes(k.toLowerCase())) problems.push(`出现阈值形态键：${path}.${k}（本轮禁止）`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}.${k}`);
    }
  };
  walk(pack.scope, 'scope');
  walk(pack.humanEscalation, 'humanEscalation');

  return problems;
}
