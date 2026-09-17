// 任务 03 · S2 业务 Gate 汇总：CLEAR / NEEDS_EVIDENCE / HOLD_FOR_REVIEW / HARD_BLOCK。
// 语义边界（任务书 §4）：
// - 这些是业务门结果，不是模型运行状态，更不是最终人工授信决定；正式权威仍在人类体系。
// - CLEAR=在声明的输入范围和规则版本下未发现命中，不等于保证安全（输出必须带此声明）。
// - 不可豁免规则的 HARD_BLOCK 不能被 staleReviewAck、商务高收益、多 Agent 好评或管理员
//   随意确认覆盖；解除只能是事实纠正后重算，或治理流程更新规则——不提供通用“强制放行”。
// - 可豁免例外须记录合法授权/条件/有效期/理由；没有批准的例外政策时默认不实现放行。
// - 模型凭空引用的规则（不在激活包内）一律 unsupported，不激活、不采信（C12）。

import { GATE_RESULTS, DOMAINS } from '../domains/schema.mjs';
import { stableHash } from '../domains/util.mjs';

const SEVERITY = Object.freeze({ CLEAR: 0, NEEDS_EVIDENCE: 1, HOLD_FOR_REVIEW: 2, HARD_BLOCK: 3 });

function pushUnique(list, v) { if (!list.includes(v)) list.push(v); return list; }

/**
 * 汇总业务门。
 * @param p.domainAnalyses { policy?:{analysisRun,assessment}|{status:'timeout'|...}, ... }
 *   每域要么给完整分析包，要么给显式异常状态（timeout/not_configured/pending），不给 = 未完成。
 * @param p.ruleEvaluation evaluateRules 产物
 * @param p.requiredDomains 必需域清单（默认四域全量）
 * @param p.transaction 交易适用面（透传到输出 scope）
 */
export function evaluateGate({
  domainAnalyses = {},
  ruleEvaluation,
  requiredDomains = [...DOMAINS],
  transaction = {},
  now = () => new Date().toISOString(),
}) {
  const reasonCodes = [];
  const ruleIds = [];
  const evidenceRefs = [];
  const blockedActions = [];
  const releaseConditions = [];
  const unsupportedRuleRefs = [];
  const domainStatus = {};
  let severity = 0; // CLEAR

  const bump = (code, sev, refs = [], rules = []) => {
    severity = Math.max(severity, sev);
    pushUnique(reasonCodes, code);
    for (const r of refs) if (!evidenceRefs.some((x) => JSON.stringify(x) === JSON.stringify(r))) evidenceRefs.push(r);
    for (const r of rules) pushUnique(ruleIds, r);
  };

  // 1) 必需域完成性：缺/超时/未配置 → HOLD（不得默认通过；超时=未知待核验，不判高风险）
  for (const d of requiredDomains) {
    const entry = domainAnalyses[d] ?? null;
    if (!entry) {
      domainStatus[d] = { status: 'missing', stale: true, watermark: null };
      bump('REQUIRED_DOMAIN_INCOMPLETE', SEVERITY.HOLD_FOR_REVIEW);
      continue;
    }
    if (entry.status && entry.status !== 'completed') {
      domainStatus[d] = { status: entry.status, stale: true, watermark: null, reasonCode: entry.reasonCode ?? `${entry.status.toUpperCase()}` };
      bump(entry.reasonCode ?? 'DOMAIN_NOT_COMPLETED', SEVERITY.HOLD_FOR_REVIEW);
      continue;
    }
    const run = entry.analysisRun;
    const assessment = entry.assessment;
    domainStatus[d] = { status: 'completed', stale: assessment.stale === true, watermark: run.inputWatermark, inputHash: run.inputHash };
    if (assessment.stale === true) bump('ASSESSMENT_STALE', SEVERITY.HOLD_FOR_REVIEW, assessment.evidenceRefs ?? []);
    // 分析内的实质冲突/疑点 → HOLD（保留冲突与各自定位，不做多数表决）
    if (Array.isArray(assessment.contradictions) && assessment.contradictions.length > 0) {
      bump('EVIDENCE_CONFLICT', SEVERITY.HOLD_FOR_REVIEW,
        assessment.contradictions.flatMap((c) => (c.values ?? []).map((v) => ({ materialId: v.materialId, location: v.sourceRef ?? null }))));
    }
    for (const f of assessment.findingsSuspicion ?? []) bump('SUSPECTED_RISK_FLAGGED', SEVERITY.HOLD_FOR_REVIEW, f.evidenceRefs ?? []);
  }

  // 2) 规则结果
  if (ruleEvaluation) {
    if (ruleEvaluation.policyPending) {
      // 相关规则未批准/适用性不明：policy_pending，不得自行推断适用后放行（C28）
      bump('POLICY_PENDING', SEVERITY.HOLD_FOR_REVIEW);
    }
    for (const r of ruleEvaluation.results) {
      // W04：适用面维度缺失 → 待核验（不静默不适用），需澄清交易范围后重算
      if (r.outcome === 'applicability_unknown') {
        bump('RULE_APPLICABILITY_UNKNOWN', SEVERITY.NEEDS_EVIDENCE, [], [r.ruleId]);
        releaseConditions.push({ type: 'clarify_transaction_scope', ruleId: r.ruleId, dims: r.applicabilityUnknown ?? [], then: 'recompute' });
        continue;
      }
      // W04：条件类型不符 → 明确错误（不转 not_hit 安全结论），需纠正输入后重算
      if (r.outcome === 'condition_error') {
        bump('RULE_CONDITION_TYPE_ERROR', SEVERITY.NEEDS_EVIDENCE, r.evidenceRefs ?? [], [r.ruleId]);
        releaseConditions.push({ type: 'correct_rule_input', ruleId: r.ruleId, errorCode: r.errorCode ?? 'UNKNOWN', then: 'recompute' });
        continue;
      }
      if (!r.activated || !r.scopeApplied) continue;
      if (r.outcome === 'precondition_missing') {
        bump('NEEDS_EVIDENCE_RULE_PRECONDITION', SEVERITY.NEEDS_EVIDENCE, r.evidenceRefs ?? [], [r.ruleId]);
        for (const mf of r.missingFacts ?? []) {
          releaseConditions.push({ type: 'provide_evidence', factKey: mf.factKey, minLevel: mf.minLevel, then: 'recompute' });
        }
      } else if (r.outcome === 'hit') {
        for (const ba of r.blockedActions ?? []) pushUnique(blockedActions, ba);
        if (r.nonWaivable === true) {
          // 不可豁免硬门：结构上最高severity，且解除路径只有事实纠正重算/治理更新
          bump('HARD_BLOCK_RULE_HIT', SEVERITY.HARD_BLOCK, r.evidenceRefs ?? [], [r.ruleId]);
          for (const rc of r.releaseWhen ?? []) releaseConditions.push(rc);
        } else {
          bump('RULE_HIT_REVIEW', SEVERITY.HOLD_FOR_REVIEW, r.evidenceRefs ?? [], [r.ruleId]);
          for (const rc of r.releaseWhen ?? []) releaseConditions.push(rc);
        }
      }
    }
  }

  // 3) 评估中引用的未知规则（模型/分析凭空政策条文）：标 unsupported，不激活
  for (const d of Object.keys(domainAnalyses)) {
    const entry = domainAnalyses[d];
    if (!entry || !entry.assessment) continue;
    for (const ref of entry.assessment.ruleRefs ?? []) {
      const known = ruleEvaluation?.results?.some((r) => r.ruleId === ref);
      if (!known) {
        pushUnique(unsupportedRuleRefs, `${d}:${ref}`);
        bump('UNSUPPORTED_RULE_REF', SEVERITY.HOLD_FOR_REVIEW);
      }
    }
  }

  const result = Object.entries(SEVERITY).find(([k, v]) => v === severity)?.[0];
  const gate = {
    gateId: `gate-${stableHash({ ruleEvaluation: ruleEvaluation?.rulesetVersion, domainStatus, result }).slice(0, 16)}`,
    result,
    reasonCodes,
    ruleIds,
    evidenceRefs,
    scope: {
      transaction,
      blockedActions: severity >= SEVERITY.HARD_BLOCK ? blockedActions : [],
      blockedActionsProposed: severity < SEVERITY.HARD_BLOCK ? blockedActions : [],
    },
    releaseConditions,
    unsupportedRuleRefs,
    domainStatus,
    rulesetVersion: ruleEvaluation?.rulesetVersion ?? null,
    asOf: ruleEvaluation?.asOf ?? null,
    evaluatedAt: now(),
    // 声明边界（输出必带，防“CLEAR=安全”的过度解读）
    disclaimers: [
      'CLEAR 仅表示在声明输入范围与规则版本下未发现命中，不等于保证安全',
      'Gate 是业务门结果，不是模型运行状态，也不是最终人工授信决定',
    ],
  };
  return gate;
}

/**
 * 尝试豁免（保守实现）：当前不存在已批准的例外政策 → 一律拒绝，无通用强制放行接口。
 * 就算未来开放，不可豁免规则也永不经过本入口（调用前先判 nonWaivable）。
 */
export function attemptWaiver({ gate, rulePack, request }) {
  if (!gate || gate.result !== 'HARD_BLOCK' && gate.result !== 'HOLD_FOR_REVIEW') {
    return { ok: false, code: 'NOTHING_TO_WAIVE', messageZh: '当前 Gate 无需豁免' };
  }
  const exceptionPolicy = rulePack?.exceptionPolicy ?? null;
  if (!exceptionPolicy || exceptionPolicy.approved !== true) {
    return {
      ok: false, code: 'NO_EXCEPTION_POLICY',
      messageZh: '未配置已批准的例外政策：默认不实现放行。硬门解除只能是事实纠正后重算，或治理流程更新规则',
      requestRecorded: request !== undefined,
    };
  }
  return { ok: false, code: 'NOT_IMPLEMENTED', messageZh: '例外政策存在但放行执行未实现（本轮边界）' };
}

/** staleReviewAck 覆盖尝试：仅对 HOLD 可留痕放行（v1.3 语义），对不可豁免 HARD_BLOCK 结构性无效。 */
export function applyStaleReviewAck({ gate, nonWaivableRuleIds, ack }) {
  if (!ack || typeof ack.note !== 'string' || ack.note.trim() === '') {
    return { ok: false, code: 'ACK_REQUIRED', messageZh: 'staleReviewAck 必须带 note' };
  }
  if (gate.result === 'HARD_BLOCK') {
    const hitNonWaivable = gate.ruleIds.some((r) => nonWaivableRuleIds.includes(r));
    if (hitNonWaivable) {
      return { ok: false, code: 'NON_WAIVABLE_BLOCK', messageZh: '不可豁免规则命中：staleReviewAck、商务高收益、多 Agent 好评或管理员确认均不能覆盖；只能事实纠正重算或治理更新规则' };
    }
  }
  if (gate.result === 'CLEAR' || gate.result === 'NEEDS_EVIDENCE') {
    return { ok: false, code: 'NOT_APPLICABLE', messageZh: '当前 Gate 结果不适用 staleReviewAck' };
  }
  return { ok: true, code: 'ACK_RECORDED', messageZh: 'HOLD 复核留痕（不改变 Gate 结果记录，正式性时刻另按 A 权限体系执行）' };
}
