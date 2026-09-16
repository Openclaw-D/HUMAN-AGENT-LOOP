// V7-B adapter 桥:把既有模型适配器(V6 PARALLEL_MODEL_ADAPTER_20260913 契约 v1)的
// 七状态结果映射为编排步结果。三分原则不可破坏:
//   未发送(not_configured/cancelled/sent=false) ≠ 失败(failed) ≠ 发送后未知(unknown)。
// 不自动重试;不回退伪模拟;模型意见只保留白名单字段,authority 恒为 none。

import { CANDIDATE_FIELDS } from './codes.mjs';
import { stableJson } from './graph-def.mjs';

/**
 * B 内部规范 candidate(A/C 边界转换前的单一形状):
 *   observations/assumptions/uncertainty: 非空字符串数组(A、C 双方一致的子集);
 *   evidenceRefs: [{id, version, hash}](B 内部三元组;A 边界转 "id@vN" 字符串,C 边界转
 *     {evidenceId,version});recommendedHumanAction: 'accept_candidate'|'return_for_evidence'|
 *     'take_over'|'need_more_evidence'|'none'(none=B 内部"无建议"哨兵;A 枚举与 C v1.1.0
 *     枚举已一致为前四者,分歧仅剩合同文本未记录,见 interface-change-request.md)。
 */

/** A 合同 v0 candidate 边界转换(数组→字符串;'none' 省略)。 */
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

/**
 * C candidate-schema 边界转换(evidenceRefs→{evidenceId,version})。
 * C v1.1.0 枚举无 none 且字段必填:内部 'none'/缺失 由 whenNone 投影(缺省
 * need_more_evidence=保守"人应过目");调用方明确无建议语义时应避免走 C 校验。
 */
export function toCCandidate(cand, { whenNone = 'need_more_evidence' } = {}) {
  return {
    observations: [...(cand.observations ?? [])],
    evidenceRefs: (cand.evidenceRefs ?? []).map((e) => ({ evidenceId: e.id, version: Number(e.version) })),
    assumptions: [...(cand.assumptions ?? [])],
    uncertainty: [...(cand.uncertainty ?? [])],
    recommendedHumanAction: (!cand.recommendedHumanAction || cand.recommendedHumanAction === 'none')
      ? whenNone
      : cand.recommendedHumanAction,
  };
}

/** 从 adapter costLedger 推断"外部调用是否已发生":true/false/null(不可判定)。 */
function sentFlagFromLedger(result) {
  const st = result?.costLedger?.reservationState;
  if (st === 'released' || st === 'rejected') return false; // 确定未发生
  if (st === 'committed') return true;                       // 已发生并结算
  return null; // reserved/unknown_hold/缺失 → 不可判定,不得声称未发生
}

/** 越权/结构违规错误码 → 需人工处理(不是普通失败,人工要看违规详情)。 */
const VIOLATION_CODES = new Set([
  'MALFORMED_OUTPUT', 'EMPTY_OUTPUT', 'FINDING_TEXT_MISSING',
  'UNSOURCED_FINDING', 'EVIDENCE_DANGLING', 'UNAUTHORIZED_OUTPUT',
]);

/**
 * adapter 输出 → 白名单候选意见。findings→observations;questions→uncertainty(问题即
 * 不确定/需人补充点);recommendedHumanAction 为 A 合同/C 枚举单字符串(有未答问题→
 * return_for_evidence,否则 none);任何 approval 形态字段到不了这里(adapter §4 已拒,B 再白名单)。
 */
export function toWhitelistedCandidate(adapterResult) {
  const questions = adapterResult.questions ?? [];
  const cand = {
    observations: (adapterResult.findings ?? []).map((f) => String(f.text ?? '')),
    evidenceRefs: [...(adapterResult.evidenceRefs ?? [])],
    assumptions: [],
    uncertainty: questions.map((q) => String(q.text ?? '')),
    recommendedHumanAction: questions.length > 0 ? 'return_for_evidence' : 'none',
  };
  for (const key of Object.keys(cand)) {
    if (!CANDIDATE_FIELDS.includes(key)) throw new Error(`INTERNAL: candidate field ${key} 不在白名单`);
  }
  return cand;
}

/**
 * 桥接主函数。
 * @param adapterResult adapter.analyze 的七状态结果(契约 v1)
 * @param opts.escalation { noFindings: 'waiting_evidence'|'succeeded' } 缺省 waiting_evidence:
 *        模型未产出任何观察(仅提问)→ 补证等待,不由编排层替模型下结论。
 * @returns {{ state, sentFlag: boolean|null, candidate: object|null,
 *             error: {code,messageZh}|null, deduped: boolean, simulated: boolean }}
 */
export function bridgeAdapterResult(adapterResult, opts = {}) {
  const noFindingsPolicy = opts.escalation?.noFindings ?? 'waiting_evidence';
  const base = {
    sentFlag: sentFlagFromLedger(adapterResult),
    candidate: null,
    error: null,
    deduped: adapterResult.deduped === true,
    simulated: false,
  };
  switch (adapterResult.status) {
    case 'succeeded':
    case 'simulated': {
      const candidate = toWhitelistedCandidate(adapterResult);
      const simulated = adapterResult.status === 'simulated';
      if ((adapterResult.findings ?? []).length === 0 && noFindingsPolicy === 'waiting_evidence') {
        return { ...base, state: 'waiting_evidence', candidate, simulated };
      }
      return { ...base, state: simulated ? 'simulated' : 'succeeded', candidate, simulated };
    }
    case 'not_configured':
      return { ...base, state: 'not_configured', sentFlag: false, error: { code: 'PROVIDER_NOT_CONFIGURED', messageZh: '模型服务未配置,调用未发送' } };
    case 'cancelled':
      // adapter 只在能证明未送达时才返回 cancelled
      return { ...base, state: 'cancelled', sentFlag: false, error: adapterResult.error ?? null };
    case 'unknown':
      return { ...base, state: 'unknown', sentFlag: null, error: { code: 'RESULT_UNKNOWN', messageZh: '请求可能已送达外部,结果不可知,禁止自动重试' } };
    case 'stale':
      return { ...base, state: 'stale', sentFlag: true, candidate: null, error: adapterResult.error ?? { code: 'STALE', messageZh: '结果已取回但版本已变化,不得当现行' } };
    case 'failed': {
      const code = adapterResult.error?.code ?? 'TRANSPORT_ERROR';
      if (VIOLATION_CODES.has(code)) {
        return { ...base, state: 'human_violation', error: { code, messageZh: `模型输出未通过校验(${code}),需人工处理`, details: adapterResult.error?.details } };
      }
      return { ...base, state: 'failed', error: { code, messageZh: adapterResult.error?.message ?? '模型调用失败' } };
    }
    default:
      return { ...base, state: 'failed', error: { code: 'ADAPTER_UNKNOWN_STATUS', messageZh: `适配器返回未知状态 ${adapterResult.status}` } };
  }
}

/**
 * 构造 adapter 请求(确定性:同 runId+stepId+attempt+捕获输入 → 逐字节同载荷,
 * 保证重放时 adapter 端 REQUEST_MISMATCH 不误伤、幂等去重命中)。
 * text 只含合成/去标识内容;证据引用三元组原样传递。
 */
export function buildModelRequest({ runId, stepId, attempt, role, purpose, projectId, eventType, eventLabel, factVersion, evidenceRefs, extraContext, generation = 1 }) {
  const text = [
    `[${eventLabel ?? eventType}] 项目 ${projectId}`,
    `事件类型 ${eventType},证据版本 ${factVersion}。`,
    `请以 ${role} 角色做 ${purpose} 复核:只依据给定证据清单提出观察与问题;`,
    `不输出审批、额度、价格、批准结论(模型意见 authority=none)。`,
    extraContext ? `补充上下文:${extraContext}` : '',
  ].filter(Boolean).join('');
  const request = {
    requestId: `${runId}::${stepId}::a${attempt}`,
    projectId,
    sessionId: runId,           // 编排运行即会话;暂停/代次由编排层 checkpoint 管
    generation,                 // 编排层在 provide_evidence 时递增
    contextVersion: String(factVersion), // V6 adapter 边界:contextVersion 为非空字符串
    role, purpose, text,
    // V6 adapter 边界:id/version/hash 必须为非空字符串(A 合同 version:int 在此转换)
    evidenceRefs: (evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: String(e.version), hash: String(e.hash) })),
  };
  return { request, payloadHash: stableJson(request) };
}

/** 工具步输出 → 与模型候选同构的候选片段(authority=none,纯计算结果;规范形状)。 */
export function toolOutcomeToCandidate(toolResult, stepId) {
  if (!toolResult.ok) return null;
  return {
    observations: [
      `计算结果 ${JSON.stringify(toolResult.output)}(工具版本 ${toolResult.toolVersion},输入指纹 ${toolResult.inputHash})`,
    ],
    evidenceRefs: [],
    assumptions: [...(toolResult.assumptions ?? [])],
    uncertainty: [],
    recommendedHumanAction: 'none',
  };
}
