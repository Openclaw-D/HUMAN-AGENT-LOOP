// V7 backend-next B transport 桥:七状态结果 → 编排步结果。
// 三分原则不可破坏:未发送(not_configured/cancelled/sent=false) ≠ 失败(failed)
// ≠ 发送后未知(unknown)。不自动重试;不回退伪模拟;模型意见只保留白名单字段,
// authority 恒为 none。继承 V7/backend/B adapter-bridge 已验证语义。

import { CANDIDATE_FIELDS } from '../codes.mjs';
import { assertCandidateWhitelist } from '../graph/decision.mjs';

/** A 合同 candidate 边界转换(evidenceRefs 三元组→"id@vN";'none' 哨兵省略)。 */
export function toACandidate(cand) {
  const out = {
    observations: [...(cand.observations ?? [])],
    evidenceRefs: (cand.evidenceRefs ?? []).map((e) => `${e.id}@v${e.version}`),
    assumptions: [...(cand.assumptions ?? [])],
    uncertainty: [...(cand.uncertainty ?? [])],
  };
  if (cand.recommendedHumanAction && cand.recommendedHumanAction !== 'none') {
    out.recommendedHumanAction = cand.recommendedHumanAction;
  }
  return out;
}

/** 越权/结构违规错误码 → 需人工处理(不是普通失败,人工要看违规详情)。 */
const VIOLATION_CODES = new Set([
  'MALFORMED_OUTPUT', 'EMPTY_OUTPUT', 'FINDING_TEXT_MISSING',
  'UNSOURCED_FINDING', 'EVIDENCE_DANGLING', 'UNAUTHORIZED_OUTPUT',
]);

/** transport 结果 → 白名单候选意见。findings→observations;questions→uncertainty。 */
export function toWhitelistedCandidate(transportResult) {
  const questions = transportResult.questions ?? [];
  const cand = {
    observations: (transportResult.findings ?? []).map((f) => String(f.text ?? '')),
    evidenceRefs: [...(transportResult.evidenceRefs ?? [])],
    assumptions: [],
    uncertainty: questions.map((q) => String(q.text ?? '')),
    recommendedHumanAction: questions.length > 0 ? 'return_for_evidence' : 'none',
  };
  assertCandidateWhitelist(cand);
  return cand;
}

/**
 * 桥接主函数。
 * @param result transport.complete 的七状态结果
 * @param opts.escalation { noFindings: 'waiting_evidence'|'succeeded' } 缺省 waiting_evidence:
 *        模型未产出任何观察(仅提问)→ 补证等待,不由编排层替模型下结论。
 * @returns {{ state, sentFlag: boolean|null, candidate: object|null,
 *             error: {code,messageZh}|null, deduped: boolean, simulated: boolean,
 *             sourceMode: string }}
 */
export function bridgeTransportResult(result, opts = {}) {
  const noFindingsPolicy = opts.escalation?.noFindings ?? 'waiting_evidence';
  const base = {
    sentFlag: result.sentFlag ?? null,
    candidate: null,
    error: result.error ?? null,
    deduped: result.deduped === true,
    simulated: false,
    sourceMode: result.source?.mode ?? 'none',
  };
  switch (result.status) {
    case 'succeeded':
    case 'simulated': {
      const candidate = toWhitelistedCandidate(result);
      const simulated = result.status === 'simulated';
      if ((result.findings ?? []).length === 0 && noFindingsPolicy === 'waiting_evidence') {
        return { ...base, state: 'waiting_evidence', candidate, simulated };
      }
      return { ...base, state: simulated ? 'simulated' : 'succeeded', candidate, simulated };
    }
    case 'not_configured':
      return { ...base, state: 'not_configured', sentFlag: false, error: result.error ?? { code: 'PROVIDER_NOT_CONFIGURED', messageZh: '模型服务未配置,调用未发送' } };
    case 'cancelled':
      // transport 只在能证明未送达时才返回 cancelled
      return { ...base, state: 'cancelled', sentFlag: false, error: result.error ?? null };
    case 'unknown':
      return { ...base, state: 'unknown', sentFlag: null, error: result.error ?? { code: 'RESULT_UNKNOWN', messageZh: '请求可能已送达外部,结果不可知,禁止自动重试' } };
    case 'stale':
      return { ...base, state: 'stale', sentFlag: true, candidate: null, error: result.error ?? { code: 'STALE', messageZh: '结果已取回但版本已变化,不得当现行' } };
    case 'failed': {
      const code = result.error?.code ?? 'TRANSPORT_ERROR';
      if (VIOLATION_CODES.has(code)) {
        return { ...base, state: 'human_violation', error: { code, messageZh: `输出未通过校验(${code}),需人工处理`, details: result.error?.details } };
      }
      return { ...base, state: 'failed', error: { code, messageZh: result.error?.message ?? '调用失败' } };
    }
    default:
      return { ...base, state: 'failed', error: { code: 'TRANSPORT_UNKNOWN_STATUS', messageZh: `transport 返回未知状态 ${result.status}` } };
  }
}
