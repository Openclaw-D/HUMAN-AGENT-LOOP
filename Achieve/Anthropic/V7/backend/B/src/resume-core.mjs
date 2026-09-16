// V7-B 人工 resume 共享核心:thin 与 LangGraph 两个候选必须执行完全一致的
// 可信身份门(D-9) + 命令有效性校验(终态/事实版本/重试目标/note)。
// D-9 原则:
//   - 身份只来自注入的同步 principalVerifier(凭据, 上下文) 判定,**command.actor 字段不构成
//     任何授权依据**(可伪造);验证器缺省未配置/缺凭据/验证失败/role!=='human' → 一律失败关闭。
//   - 验证上下文带 {runId, projectId, action, stepId}:验证器/授权器可拒绝错项目或越权动作;
//     B 不发明真实岗位授权制度——authorizer 为可注入业务策略,缺省=已验证 human 可执行四动作。
//   - 凭据只在恢复入口边界出现,不写 journal/checkpoint/普通日志;入档的是 verdict 的 principalId。
//   - 事实/规则版本门、unknown 不自动重试、requestId 幂等均不受本改动影响。

import { HUMAN_ACTION, RUN_STATE, STEP_STATE, ERROR_CODES } from './codes.mjs';

const RETRYABLE_STEP_STATES = [STEP_STATE.UNKNOWN, STEP_STATE.FAILED, STEP_STATE.HUMAN_VIOLATION];

/** 运行是否处于可 resume 状态(completed 不可;running 不可)。 */
export function isResumable(terminalKind) {
  return ['waiting_evidence', 'human_required', 'unknown', 'failed'].includes(terminalKind);
}

/**
 * D-9 可信身份门(在恢复入口边界调用,先于任何状态变更)。
 * @param p.principalVerifier 注入的同步验证器 (credential, ctx) → {ok, principalId, role}
 *   缺省/未注入 = 失败关闭(无可信身份源);ctx = {runId, projectId, action, stepId}。
 * @param p.authorizer 可注入授权器 (verdict, ctx) → {ok:true} | {ok:false, reasonZh}
 *   缺省 = 已验证 human 放行(身份可信后是否允许该动作属业务策略,由 assembly 注入)。
 * @param p.command 恢复命令 {principalCredential, action, stepId?, payload?}
 *   (command.actor 即便存在也被忽略——自声明字段不可信)
 * @returns {ok:true, principalId, role} | {ok:false, code, messageZh}
 */
export function validateResumeAccess(p) {
  const { principalVerifier, authorizer, command, ctx } = p ?? {};
  if (typeof principalVerifier !== 'function') {
    return { ok: false, code: ERROR_CODES.PRINCIPAL_UNTRUSTED, messageZh: '未配置可信身份验证器:恢复失败关闭(缺省无身份源)' };
  }
  const credential = command?.principalCredential;
  if (typeof credential !== 'string' || credential.length === 0) {
    return { ok: false, code: ERROR_CODES.PRINCIPAL_UNTRUSTED, messageZh: '缺少 principalCredential:恢复需要可信身份凭据' };
  }
  if (!command?.action) {
    return { ok: false, code: ERROR_CODES.INVALID_RESUME, messageZh: '缺少 action' };
  }
  let verdict;
  try {
    verdict = principalVerifier(credential, ctx); // 同步验证器(失败关闭;异步身份源属后续升级项)
  } catch (e) {
    return { ok: false, code: ERROR_CODES.PRINCIPAL_UNTRUSTED, messageZh: `principal 验证器异常:${e instanceof Error ? e.message : String(e)}(失败关闭)` };
  }
  if (!verdict || verdict.ok !== true || verdict.role !== 'human' || !verdict.principalId) {
    return { ok: false, code: ERROR_CODES.PRINCIPAL_UNTRUSTED, messageZh: 'principal 凭据验证失败:恢复被拒绝' };
  }
  const trustedPrincipal = { principalId: String(verdict.principalId), role: String(verdict.role) };
  if (typeof authorizer === 'function') {
    let decision;
    try {
      decision = authorizer(trustedPrincipal, ctx);
    } catch (e) {
      return { ok: false, code: ERROR_CODES.AUTHORIZATION_DENIED, messageZh: `授权器异常:${e instanceof Error ? e.message : String(e)}(失败关闭)` };
    }
    if (!decision || decision.ok !== true) {
      return { ok: false, code: ERROR_CODES.AUTHORIZATION_DENIED, messageZh: decision?.reasonZh ?? '授权被拒绝(验证器/策略拒绝该项目或动作)' };
    }
  }
  return { ok: true, principalId: trustedPrincipal.principalId, role: trustedPrincipal.role };
}

/**
 * 命令有效性校验(身份门通过后;两个候选在各自执行上下文调用)。
 * @param p.trustedPrincipal 边界身份门的判定结果 {principalId, role};缺失 = 拒绝
 *   (防绕过边界直接构造命令——LangGraph 简历载荷只由编排器包装层盖章)。
 */
export function validateResumeCommand(p) {
  const { command, terminalKind, requiredVersions, currentVersions, trustedPrincipal } = p;
  if (!trustedPrincipal || !trustedPrincipal.principalId) {
    return { ok: false, code: ERROR_CODES.PRINCIPAL_UNTRUSTED, messageZh: '缺少边界可信身份判定:命令不能直接进入恢复执行' };
  }
  if (!terminalKind || !isResumable(terminalKind)) {
    if (terminalKind === RUN_STATE.COMPLETED) return { ok: false, code: ERROR_CODES.TERMINAL_STATE, messageZh: '运行已完成,无可恢复事项' };
    return { ok: false, code: ERROR_CODES.RUN_NOT_RESUMABLE, messageZh: '运行仍在执行中,不能并发 resume' };
  }
  const { action, stepId, payload = {} } = command ?? {};
  if (!Object.values(HUMAN_ACTION).includes(action)) {
    return { ok: false, code: ERROR_CODES.ACTION_NOT_ALLOWED, messageZh: `未知人工动作 ${action}` };
  }

  if (action !== HUMAN_ACTION.ABORT && currentVersions.factVersion !== requiredVersions.factVersion) {
    const reAnchorOk = action === HUMAN_ACTION.PROVIDE_EVIDENCE && payload.newFactVersion === currentVersions.factVersion;
    if (!reAnchorOk) {
      return {
        ok: false, code: ERROR_CODES.VERSION_CHANGED,
        messageZh: `事实版本已变化:中断时 ${requiredVersions.factVersion},当前 ${currentVersions.factVersion};必须以 provide_evidence 显式重锚定`,
      };
    }
  }
  if (action === HUMAN_ACTION.PROVIDE_EVIDENCE && !Array.isArray(payload.newEvidenceRefs)) {
    return { ok: false, code: ERROR_CODES.INVALID_RESUME, messageZh: 'provide_evidence 必须携带 newEvidenceRefs 数组' };
  }
  if (action === HUMAN_ACTION.RETRY_STEP) {
    const step = (p.steps ?? []).find((s) => s.id === stepId);
    if (!step) return { ok: false, code: ERROR_CODES.INVALID_RESUME, messageZh: `重试目标步 ${stepId} 不存在` };
    if (!RETRYABLE_STEP_STATES.includes(step.state)) return { ok: false, code: ERROR_CODES.INVALID_RESUME, messageZh: `步骤状态 ${step.state} 不可显式重试` };
  }
  if (action === HUMAN_ACTION.ACCEPT_AND_COMPLETE && !payload.note) {
    return { ok: false, code: ERROR_CODES.INVALID_RESUME, messageZh: 'accept_and_complete 必须携带 note(人工决定留痕)' };
  }
  return { ok: true };
}

/**
 * 计算批准后的 resume 效果(不改输入;两个候选各自落自己的存储)。
 * @returns {{ stepsDelta: Record<stepId, {state, attemptDelta?, error?}>, generationBump: boolean,
 *             evidenceRefs: array|null, requiredVersions: object|null, terminal: object|null }}
 */
export function computeResumeEffects({ action, stepId, payload = {}, currentVersions }) {
  const effects = { stepsDelta: {}, generationBump: false, evidenceRefs: null, requiredVersions: null, terminal: null };
  switch (action) {
    case HUMAN_ACTION.PROVIDE_EVIDENCE:
      effects.evidenceRefs = payload.newEvidenceRefs;
      effects.requiredVersions = { ...currentVersions };
      effects.generationBump = true;
      break;
    case HUMAN_ACTION.RETRY_STEP:
      effects.stepsDelta[stepId] = { state: STEP_STATE.PENDING, attemptDelta: 1, error: null };
      break;
    case HUMAN_ACTION.ACCEPT_AND_COMPLETE:
      effects.terminal = { kind: RUN_STATE.COMPLETED, reasonZh: '人工接受并关闭:剩余判断由人工承担,模型候选意见 authority=none', humanAccepted: true };
      break;
    case HUMAN_ACTION.ABORT:
      effects.terminal = { kind: RUN_STATE.FAILED, reasonZh: '人工中止', humanAborted: true };
      break;
    default:
      break;
  }
  return effects;
}

/** provide_evidence 时哪些步被重置(纯查询,供两个候选共用)。 */
export function evidenceWaitingStepIds(steps) {
  return steps.filter((s) => s.state === STEP_STATE.WAITING_EVIDENCE).map((s) => s.id);
}
