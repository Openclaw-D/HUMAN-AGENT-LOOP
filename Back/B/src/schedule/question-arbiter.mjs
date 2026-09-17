// 任务 02 · B3 问题绑定与调度规划层（纯函数；A 是唯一事实源，本层只产出"派发计划"）。
// 纪律（任务书 B3 / 验收 W07–W09）：
// - 绑定：每个问题绑定 customer/session、事实或对象、依据版本、目标回答者、必要证据、
//   受众与回答权限；重复问题按 去重键=对象或事实|期间|目的|受众|回答权限 合并（同键合并
//   返回原问，任一不同保留差异）。
// - 单语音仲裁：同一公共通话时刻至多一个 customer 受众的语音问题处于 active，其余排队，
//   不抢话；内部受众与授权线程（财务/厂长并行回答）不受语音仲裁阻塞。
// - 外发分级：常规核验=自动外发；敏感指控/正式授信承诺/内部评分参数=转人工；敏感度未知
//   =转人工（失败关闭，不默认自动）。
// - 暂停：会话暂停或代际失效 → 零新派发（W09）；answered ≠ 材料取得 ≠ 核验完成——
//   计划中如实标注各推进语义，不以"已回答"冒充"已核验"。

import { sha256hex } from '../ports.mjs';
import { stableJson } from '../graph/decision.mjs';

export const QUESTION_ARBITER_VERSION = 'question-arbiter@1';

export const OUTBOUND_TIERS = Object.freeze({
  AUTO: 'auto_outbound',
  HUMAN: 'human_gate',
});

/** 自动外发许可的常规核验目的（白名单制；清单外一律转人工）。 */
const AUTO_PURPOSES = new Set([
  'fact_verification',       // 常规事实核验
  'evidence_request',        // 补件请求
  'clarification',           // 一般澄清
  'site_recheck',            // 现场补拍/复核
]);

function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }

/**
 * 归并问题绑定：规范化字段 + 去重键合并。
 * @param p.questions 候选问题数组（来自四域问题计划/检查会话快照投影），每项：
 *   { questionId, factKey?, objectId?, period?, purpose, audience, targetAnswerer?,
 *     requiredEvidence?, answerPermission?, basisVersion?, sensitivity? }
 * @returns {ok, bindings, mergedCount, problems}
 */
export function bindQuestions({ sessionId, customerId, questions = [] }) {
  const problems = [];
  if (!isStr(sessionId)) problems.push('sessionId 必填');
  if (!isStr(customerId)) problems.push('customerId 必填（问题必须绑定客户主档）');
  if (!Array.isArray(questions)) return { ok: false, bindings: [], mergedCount: 0, problems: [...problems, 'questions 必须为数组'] };
  if (problems.length > 0) return { ok: false, bindings: [], mergedCount: 0, problems };

  const byKey = new Map();
  const bindings = [];
  let mergedCount = 0;
  for (const q of questions) {
    if (q === null || typeof q !== 'object') { problems.push('问题必须为对象'); continue; }
    if (!isStr(q.questionId)) { problems.push(`问题缺 questionId: ${JSON.stringify(q).slice(0, 80)}`); continue; }
    if (!isStr(q.purpose)) { problems.push(`${q.questionId}: purpose 必填（去重键组成部分）`); continue; }
    if (!isStr(q.audience)) { problems.push(`${q.questionId}: audience 必填`); continue; }
    const objectRef = q.objectId ?? q.factKey ?? null;
    if (objectRef === null) { problems.push(`${q.questionId}: 必须绑定 factKey 或 objectId（无锚点问题不可外发）`); continue; }
    const key = [
      objectRef, q.period ?? '*', q.purpose, q.audience,
      q.answerPermission ?? (q.audience === 'customer' ? 'customer_thread' : 'internal'),
    ].join('|');
    const existing = byKey.get(key);
    if (existing) {
      // 同键合并：保留原问；来源域记录合并痕迹（差异问题不会落进同一键）
      existing.mergedFrom.push(q.questionId);
      existing.domainSources.push(q.domain ?? 'unknown');
      mergedCount += 1;
      continue;
    }
    const binding = {
      questionKey: `qk-${sha256hex(stableJson([objectRef, q.period ?? null, q.purpose, q.audience, q.answerPermission ?? null])).slice(0, 12)}`,
      dedupKey: key,
      questionId: q.questionId,
      sessionId,
      customerId,
      objectRef,
      objectRefKind: q.objectId ? 'objectId' : 'factKey',
      period: q.period ?? null,
      purpose: q.purpose,
      audience: q.audience,
      targetAnswerer: q.targetAnswerer ?? null,
      requiredEvidence: q.requiredEvidence ?? null,
      answerPermission: q.answerPermission ?? (q.audience === 'customer' ? 'customer_thread' : 'internal'),
      basisVersion: q.basisVersion ?? null,
      priority: q.priority ?? 'normal',
      mode: q.mode ?? (q.audience === 'customer' ? 'voice' : 'thread'),
      mergedFrom: [],
      domainSources: [q.domain ?? 'unknown'],
    };
    byKey.set(key, binding);
    bindings.push(binding);
  }
  return { ok: problems.length === 0, bindings, mergedCount, problems };
}

/** 外发分级（B3.2）：白名单目的 + 非敏感 → 自动；敏感类或未知 → 转人工。 */
export function classifyOutboundTier(binding) {
  const sensitive =
    binding.purpose === 'sensitive_accusation'
    || binding.purpose === 'formal_credit_commitment'
    || binding.purpose === 'internal_score_exposure'
    || binding.sensitivity === 'sensitive';
  if (sensitive) {
    return { tier: OUTBOUND_TIERS.HUMAN, reasonCode: 'SENSITIVE_CONTENT_HUMAN_GATE', autoOutboundAllowed: false };
  }
  if (!AUTO_PURPOSES.has(binding.purpose)) {
    return { tier: OUTBOUND_TIERS.HUMAN, reasonCode: 'PURPOSE_NOT_IN_AUTO_WHITELIST', autoOutboundAllowed: false };
  }
  return { tier: OUTBOUND_TIERS.AUTO, reasonCode: null, autoOutboundAllowed: true };
}

/**
 * 派发计划（单语音仲裁 + 分级 + 暂停语义）。
 * @param p.bindings bindQuestions 产物
 * @param p.session {outboundPaused:boolean, dispatchGeneration:number}
 * @param p.callState {activeCallId:string|null, currentSpeakingQuestionId?:string|null}
 *   公共通话时刻状态；null=无进行中通话（语音问题全部排队等下一通话窗口）。
 * @returns {ok, plan:{outbound:[], queued:[], blocked:[]}, paused:boolean, note}
 */
export function planDispatch({ bindings = [], session = {}, callState = { activeCallId: null } }) {
  const outbound = [];
  const queued = [];
  const blocked = [];
  const paused = session.outboundPaused === true;

  // 已在进行中通话里的语音问题：占住唯一的"当前说话"槽（不抢话）
  const speakingQuestionId = callState.currentSpeakingQuestionId ?? null;
  let voiceSlotTaken = speakingQuestionId !== null;

  // 优先级排序（blocking > high > normal > low），同优先级按 questionKey 稳定排序
  const rankOf = (p) => ({ blocking: 0, high: 1, normal: 2, low: 3 })[p] ?? 2;
  const ordered = [...bindings].sort((a, b) => rankOf(a.priority) - rankOf(b.priority) || (a.questionKey < b.questionKey ? -1 : 1));

  for (const b of ordered) {
    if (paused) {
      // W09：暂停后不得产生新外发授权；计划只登记不派发
      blocked.push({ ...b, blockedCode: 'OUTBOUND_PAUSED', tier: classifyOutboundTier(b).tier });
      continue;
    }
    const tierInfo = classifyOutboundTier(b);
    if (tierInfo.tier === OUTBOUND_TIERS.HUMAN) {
      queued.push({ ...b, tier: tierInfo.tier, queueReason: tierInfo.reasonCode });
      continue;
    }
    // 单语音仲裁：customer 受众 + voice 模式，每个通话时刻至多一个 active
    if (b.audience === 'customer' && b.mode === 'voice') {
      if (b.questionId === speakingQuestionId) {
        outbound.push({ ...b, tier: tierInfo.tier, dispatchMode: 'voice_active', activeCallId: callState.activeCallId });
        continue;
      }
      if (!voiceSlotTaken && callState.activeCallId) {
        voiceSlotTaken = true;
        outbound.push({ ...b, tier: tierInfo.tier, dispatchMode: 'voice_active', activeCallId: callState.activeCallId });
        continue;
      }
      queued.push({ ...b, tier: tierInfo.tier, queueReason: callState.activeCallId ? 'VOICE_SLOT_BUSY' : 'NO_ACTIVE_CALL' });
      continue;
    }
    // 内部受众 / 非语音线程：不受语音槽限制；不同授权线程可并行（财务/厂长各自线程）
    outbound.push({ ...b, tier: tierInfo.tier, dispatchMode: b.audience === 'customer' ? 'customer_thread' : `internal_thread:${b.targetAnswerer ?? 'staff'}` });
  }

  return {
    ok: true,
    arbiterVersion: QUESTION_ARBITER_VERSION,
    paused,
    plan: { outbound, queued, blocked },
    progressionNote: 'answered=已回答；材料取得=waiting_evidence 解除；核验完成=人工 verify。三者分别推进：已回答不冒充已核验；仅有某 kind 材料不证明指定设备/期间条件已满足。',
    note: '重复问题已按 对象|期间|目的|受众|回答权限 合并；同一公共通话时刻至多一个主动语音提问；财务/厂长可在各自授权线程并行回答。',
  };
}
