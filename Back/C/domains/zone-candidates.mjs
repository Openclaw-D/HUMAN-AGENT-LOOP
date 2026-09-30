// 02-execution 轮 · 单区确定性候选生成（3–5 项，不足如实返回）。
// 全部候选只来自当前证据（assessment）与激活规则（ruleEvaluation）：
// - score = 确定性排序位次（scoreType=rule_rank），不是概率、不是校准置信度、不是模型估计；
// - HARD_BLOCK（不可豁免规则命中）排第一且 blocking=true，任何分数/置信度都不可覆盖；
// - 无足够真实素材时如实少于 3 项（asManyAsAvailable=true），绝不编造凑数。
// 纯确定性、无 IO、无模型调用；输入 assessment 必须已通过 validateDomainAnalysis。

import { evaluateGate } from '../rules/gate.mjs';

export const ZONE_CANDIDATES_VERSION = 'zone-candidates-v1';

const RULE_KIND_BY_ACTION = {
  verify_registration: 'verify',
  third_party_check: 'investigate',
  verify_order: 'verify',
};

/** 同一 targetFact 只保留排序最前的候选，避免同一事实刷屏。 */
function dedupeByTarget(options) {
  const seen = new Set();
  return options.filter(o => {
    const key = o.basis.targetFact ?? o.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param p.domain 'business'|'policy'|'credit'|'commerce'|'asset'
 * @param p.entry assessStage.analyses[domain]（{analysisRun,assessment}）
 * @param p.ruleEvaluation evaluateRules 产物（assessStage 返回值同源）
 * @param p.transaction 交易适用面（透传 gate）
 */
export function zoneCandidates({ domain, entry, ruleEvaluation, transaction = {} }) {
  if (!entry || !entry.assessment) return { ok: false, reason: 'ZONE_ENTRY_REQUIRED' };
  const a = entry.assessment;
  const gate = evaluateGate({
    domainAnalyses: { [domain]: entry },
    ruleEvaluation,
    requiredDomains: [domain],
    transaction,
  });
  const options = [];

  if (gate.result === 'HARD_BLOCK') {
    options.push({
      id: 'opt_hard_block',
      kind: 'hard_block',
      label: `不可豁免阻断：${gate.ruleIds.join('/')} 命中——只能事实纠正后重算或治理更新规则`,
      score: 0,
      blocking: true,
      basis: { ruleIds: [...gate.ruleIds], evidenceRefs: [...gate.evidenceRefs] },
      releaseConditions: [...gate.releaseConditions],
    });
  }

  for (const action of a.proposedActions ?? []) {
    options.push({
      id: `opt_action_${options.length + 1}`,
      kind: RULE_KIND_BY_ACTION[action.action] ?? 'verify',
      label: action.note,
      score: options.length + 1,
      basis: { targetFact: action.targetFact ?? null, evidenceRefs: [...(a.evidenceRefs ?? [])] },
    });
  }
  for (const q of a.proposedQuestions ?? []) {
    options.push({
      id: `opt_supplement_${options.length + 1}`,
      kind: 'supplement',
      label: `补证：${q.whyNeeded}`,
      score: options.length + 1,
      basis: { targetFact: q.targetFact ?? null, expectedEvidence: q.expectedEvidence ?? null, stopCondition: q.stopCondition ?? null },
    });
  }
  for (const c of a.contradictions ?? []) {
    options.push({
      id: `opt_conflict_${options.length + 1}`,
      kind: 'investigate',
      label: `来源冲突需第三方核验：${c.factKey}（保留各自定位，不合并）`,
      score: options.length + 1,
      basis: { targetFact: c.factKey, evidenceRefs: (c.values ?? []).map(v => ({ materialId: v.materialId, location: v.sourceRef ?? null })) },
    });
  }

  const materialized = dedupeByTarget(options).slice(0, 5);
  const asManyAsAvailable = materialized.length < 3;
  if (materialized.length < 5 && materialized.every(o => !o.blocking)) {
    materialized.push({
      id: 'opt_proceed_review',
      kind: 'proceed',
      label: '提交有权人类核验当前候选结论（核验/采用仍需人类确认，不自动生效）',
      score: materialized.length + 1,
      basis: { evidenceRefs: [...(a.evidenceRefs ?? [])], knownFacts: [...(a.knownFacts ?? [])] },
    });
  }
  materialized.forEach((o, i) => { o.score = o.blocking ? 0 : i; o.scoreType = 'rule_rank'; });
  materialized.sort((x, y) => x.score - y.score);
  for (let i = 0; i < materialized.length; i++) {
    if (!materialized[i].blocking) materialized[i].score = i + 1; // 阻断项恒为 0，其余 1..n
  }
  return {
    ok: true,
    candidatesVersion: ZONE_CANDIDATES_VERSION,
    domain,
    gate: { result: gate.result, reasonCodes: [...gate.reasonCodes], ruleIds: [...gate.ruleIds] },
    hardBlock: gate.result === 'HARD_BLOCK',
    scoreMeaning: '确定性排序位次：数字越小越靠前；非概率、非校准置信度、不可单独作为放行依据',
    options: materialized,
    asManyAsAvailable,
    totalFromEvidence: materialized.length,
  };
}
