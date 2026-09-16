'use client';

// 材料核验面板（Lane FE，2026-09-04）——/work 主工作区内的窄区域组件。
// 顶部固定标注：合成演示 / 候选岗位语义，非正式审批；
// 核验只是对材料可信度的文字标注，不构成、不替代任何正式权力动作。
//
// 命令纪律（与 §14.4 同源，ENG01 Control 审查修订版）：
//   1) 严格 envelope 成功判定：恰为 200/201 + 合法 JSON + status ∈ {accepted, replayed}
//      + evidence.evidenceId 与命令一致 + rev 为整数；其余成功形态一律视为结果未知；
//   2) 结果未知（5xx / 格式异常 / 网络异常）：保留原命令与重试通道，不清空、不伪造成功、
//      不允许绕过重试组装新命令；
//   3) 命令组装时冻结 caseId + actorId 绑定；发送前校验绑定，不一致进入显式「待确认」态：
//      重试与新提交都禁用并显示原绑定摘要；未决命令在收到明确结果前不清空、不被覆盖；
//   4) 409 VERSION_CONFLICT 只调用 onRefresh() 刷新 Projection，不自动用新 expectedRev 重新提交；
//      403 / 400 / 404 等确定性失败命令终结；一切结果以服务端响应为准，禁止 optimistic authority。

import { useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { V4LifeProjection } from './workspace-contract';
import type {
  V4LifeEvidenceKind,
  V4LifeVerificationStatus,
  V4LifeVerificationTarget,
} from '../../lib/v4life/types.ts';
import styles from './verification.module.css';

// <!-- ENG01-VERIFICATION-PURE-LOGIC-START -->
// 纯决策逻辑区：无 JSX、无 React 值依赖、无 fetch；TEST lane 直接执行本区导出函数。

/** 已组装的核验命令载荷（caseId/actorId/commandId/expectedRev 在组装时刻冻结）。 */
export interface VerificationCommand {
  commandId: string;
  caseId: string;
  evidenceId: string;
  actorId: string;
  verificationStatus: V4LifeVerificationTarget;
  reason: string;
  expectedRev: number;
}

/** 一次 HTTP 往返后的判定结论（errorCode 保留 exact code 或格式异常标记）。 */
export interface VerificationVerdict {
  outcome: 'accepted' | 'replayed' | 'version_conflict' | 'rejected' | 'unknown';
  errorCode?: string;
}

/** 目标状态只允许四值（'claimed' 是追加初始值，不可作为目标）。 */
export const TARGET_STATUS_ORDER: readonly V4LifeVerificationTarget[] = [
  'verified',
  'unverified',
  'contradicted',
  'stale',
];

/** 核验状态文字标签（灰阶线框：语义由文字承载，不依赖颜色）。 */
export const VERIFICATION_STATUS_LABELS: Record<V4LifeVerificationStatus, string> = {
  claimed: '已声明',
  unverified: '未核验',
  verified: '已核验',
  contradicted: '已矛盾',
  stale: '已过期',
};

/** 400/404 等确定性失败的 exact code → 简短中文说明。 */
export const ERROR_DETAIL_LABELS: Record<string, string> = {
  INVALID_ENGINE_INPUT: '提交内容未通过服务端校验，请检查后重试。',
  ACTOR_NOT_FOUND: '执行角色未知名，请刷新页面后重试。',
  CASE_NOT_FOUND: '案例不存在或未开放。',
  EVIDENCE_NOT_FOUND: '材料不存在或已被移除，请刷新后重试。',
  IDEMPOTENCY_CONFLICT: '命令编号冲突：同一编号对应了不同内容，请刷新页面后重试。',
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 组装命令时生成 commandId；无 randomUUID 环境退化为高熵 id（仅演示兜底）。 */
export function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 冻结一次命令：caseId/actorId 与载荷字段在组装时刻固化；理由 trim 后入库。
 * commandId 必须由调用方在组装时刻生成（每次组装唯一，重试不复用此函数）。
 */
export function composeVerificationCommand(args: {
  commandId: string;
  caseId: string;
  actorId: string;
  evidenceId: string;
  verificationStatus: V4LifeVerificationTarget;
  reason: string;
  expectedRev: number;
}): VerificationCommand {
  return {
    commandId: args.commandId,
    caseId: args.caseId,
    evidenceId: args.evidenceId,
    actorId: args.actorId,
    verificationStatus: args.verificationStatus,
    reason: args.reason.trim(),
    expectedRev: args.expectedRev,
  };
}

/** 冻结载荷 → POST body（重试时对同一命令逐字段原样重发）。 */
export function buildVerificationRequestBody(command: VerificationCommand): Record<string, unknown> {
  return {
    commandId: command.commandId,
    expectedRev: command.expectedRev,
    evidenceId: command.evidenceId,
    actorId: command.actorId,
    verificationStatus: command.verificationStatus,
    reason: command.reason,
  };
}

/** 理由必填：trim 后为空则不可提交。 */
export function isSubmittableReason(reason: string): boolean {
  return reason.trim().length > 0;
}

/** 第 2 条门控：存在未决（结果未知）命令期间，禁止组装/提交任何新命令。 */
export function canComposeCommand(args: { unknownCommand: VerificationCommand | null }): boolean {
  return args.unknownCommand === null;
}

/** 第 3 条绑定判定：当前 case/actor 与未决命令的冻结绑定一致才允许重试发送。 */
export function unknownCommandBinding(
  command: VerificationCommand,
  currentCaseId: string,
  currentActorId: string,
): 'match' | 'stale' {
  return command.caseId === currentCaseId && command.actorId === currentActorId ? 'match' : 'stale';
}

/** 待确认态展示用摘要：原命令的案例/身份/材料/目标/命令编号（全部事实，不虚构）。 */
export function unknownCommandSummary(command: VerificationCommand): string {
  return [
    `案例 ${command.caseId}`,
    `身份 ${command.actorId}`,
    `材料 ${command.evidenceId}`,
    `目标 ${VERIFICATION_STATUS_LABELS[command.verificationStatus]}`,
    `命令编号 ${command.commandId}`,
    `expectedRev ${String(command.expectedRev)}`,
  ].join(' · ');
}

/**
 * 严格 envelope 判定（第 1 条全矩阵）：
 *   - accepted/replayed：恰为 HTTP 200/201，且 bodyText 为合法 JSON，且
 *     body.status ∈ {'accepted','replayed'}，且 body.evidence.evidenceId === command.evidenceId，
 *     且 Number.isInteger(body.rev)；任一不满足 → 'unknown'（结果未知）。
 *   - 409 且 {error:'VERSION_CONFLICT'} → 'version_conflict'；409 其他 → 'rejected'（确定性冲突终结）。
 *   - 其余 4xx → 'rejected'（确定性拒绝终结；error code 缺失时标记 UNKNOWN_ERROR_CODE）。
 *   - 5xx / 非 200·201 的 2xx / 3xx·1xx / 空·非 JSON body / 结构不符 → 'unknown'。
 *   - 网络异常不进入本函数；若调用方以 httpStatus<=0 表达，亦判 'unknown'。
 * 'unknown' 一律保留原命令与重试通道，不得清空、不得伪造成功。
 */
export function parseVerificationOutcome(
  httpStatus: number,
  bodyText: string,
  command: VerificationCommand,
): VerificationVerdict {
  if (!Number.isInteger(httpStatus) || httpStatus <= 0) {
    return { outcome: 'unknown', errorCode: 'NETWORK_ERROR' };
  }
  if (httpStatus >= 500) {
    return { outcome: 'unknown', errorCode: 'INTERNAL_ERROR' };
  }

  let body: unknown = null;
  let bodyIsJson = false;
  const trimmedBody = typeof bodyText === 'string' ? bodyText.trim() : '';
  if (trimmedBody.length > 0) {
    try {
      body = JSON.parse(trimmedBody) as unknown;
      bodyIsJson = true;
    } catch {
      body = null;
      bodyIsJson = false;
    }
  }
  const errorCodeFromBody = (): string | undefined => {
    if (bodyIsJson && isRecord(body) && typeof body.error === 'string') {
      return body.error;
    }
    return undefined;
  };

  if (httpStatus === 409) {
    if (errorCodeFromBody() === 'VERSION_CONFLICT') {
      return { outcome: 'version_conflict', errorCode: 'VERSION_CONFLICT' };
    }
    // 409 是确定性冲突：命令终结；无法读取具体码时不臆断为版本冲突。
    return { outcome: 'rejected', errorCode: errorCodeFromBody() ?? 'UNKNOWN_ERROR_CODE' };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { outcome: 'rejected', errorCode: errorCodeFromBody() ?? 'UNKNOWN_ERROR_CODE' };
  }

  if (httpStatus !== 200 && httpStatus !== 201) {
    return { outcome: 'unknown', errorCode: 'UNEXPECTED_HTTP_STATUS' };
  }
  if (!bodyIsJson || !isRecord(body)) {
    return { outcome: 'unknown', errorCode: 'MALFORMED_RESPONSE' };
  }
  const status = body.status === 'accepted' || body.status === 'replayed' ? body.status : null;
  if (status === null) {
    return { outcome: 'unknown', errorCode: 'MALFORMED_RESPONSE' };
  }
  const evidence = body.evidence;
  if (!isRecord(evidence) || evidence.evidenceId !== command.evidenceId) {
    return { outcome: 'unknown', errorCode: 'MALFORMED_RESPONSE' };
  }
  if (!Number.isInteger(body.rev)) {
    return { outcome: 'unknown', errorCode: 'MALFORMED_RESPONSE' };
  }
  return { outcome: status, errorCode: undefined };
}

// <!-- ENG01-VERIFICATION-PURE-LOGIC-END -->

// ---------------------------------------------------------------------------
// 组件（UI 状态全部由上述纯函数驱动）
// ---------------------------------------------------------------------------

interface VerificationFeedback {
  tone: 'accepted' | 'replayed' | 'notice' | 'unknown' | 'error';
  title: string;
  detail: string;
  errorCode?: string;
}

export interface VerificationPanelProps {
  caseId: string;
  actorId: string;
  projection: V4LifeProjection;
  onRefresh: () => void;
  /** 未决（结果未知）命令：WorkShell 持有的单一共享状态，desktop/mobile 两实例共享，受控。 */
  pendingCommand: VerificationCommand | null;
  /** 未决命令唯一写入通道：设置或清空都经此回调上提，组件内不自持该 state。 */
  onPendingCommandChange: (next: VerificationCommand | null) => void;
}

const EVIDENCE_KIND_LABELS: Record<V4LifeEvidenceKind, string> = {
  upstream_context: '上游背景',
  financial_statement: '财务报表',
  contract_draft: '合同草案',
  asset_history_feedback: '资产历史反馈',
  supplement: '补充说明',
};

export function VerificationPanel(props: VerificationPanelProps): ReactElement {
  const {
    caseId,
    actorId,
    projection,
    onRefresh,
    // 未决命令为 WorkShell 持有的单一共享状态（受控）：读 prop、写经回调，双实例同步。
    pendingCommand: unknownCommand,
    onPendingCommandChange: setPendingCommand,
  } = props;

  const [evidenceId, setEvidenceId] = useState<string>('');
  const [targetStatus, setTargetStatus] = useState<V4LifeVerificationTarget>('unverified');
  const [reason, setReason] = useState<string>('');
  const [pending, setPending] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<VerificationFeedback | null>(null);

  // 选中材料：state 不匹配（首载/刷新后条目消失）时回退到第一条，不自备第二状态。
  const selectedEvidence =
    projection.evidence.find((entry) => entry.evidenceId === evidenceId) ?? projection.evidence[0];
  const selectedStatus: V4LifeVerificationStatus = selectedEvidence?.verificationStatus ?? 'claimed';

  const binding =
    unknownCommand !== null ? unknownCommandBinding(unknownCommand, caseId, actorId) : 'match';
  const canCompose = canComposeCommand({ unknownCommand });
  const canSubmit =
    !pending && canCompose && selectedEvidence !== undefined && isSubmittableReason(reason);

  const selectedActor = projection.actors.find((entry) => entry.actorId === actorId);
  const isBusinessActor = selectedActor?.role === 'business';

  async function sendVerification(command: VerificationCommand): Promise<void> {
    setPending(true);
    try {
      // 发送前绑定校验：case/actor 不一致时不发送，保持「待确认」态。
      if (unknownCommandBinding(command, caseId, actorId) !== 'match') {
        setPendingCommand(command);
        setFeedback({
          tone: 'notice',
          title: '待确认：未决核验命令绑定于其他案例或身份。',
          detail: '重试与新提交已停用；请切回原案例与原身份后重试同一命令。',
        });
        return;
      }
      const response = await fetch(
        `/api/v4life/cases/${encodeURIComponent(command.caseId)}/verification`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildVerificationRequestBody(command)),
        },
      );
      const bodyText = await response.text();
      const verdict = parseVerificationOutcome(response.status, bodyText, command);

      if (verdict.outcome === 'accepted' || verdict.outcome === 'replayed') {
        setPendingCommand(null);
        setFeedback({
          tone: verdict.outcome,
          title:
            verdict.outcome === 'replayed'
              ? '该核验此前已受理，本次为幂等重放，未产生新变化。'
              : '核验已受理，该材料的核验状态已更新。',
          detail: '正在刷新最新 Projection；材料状态请以下拉中的文字为准。',
        });
        setReason('');
        onRefresh();
        return;
      }
      if (verdict.outcome === 'version_conflict') {
        setPendingCommand(null);
        onRefresh();
        setFeedback({
          tone: 'notice',
          title: '版本已过期，已刷新最新状态，请确认后重试。',
          detail: '未自动重新提交；请确认材料与目标状态后再次手动提交（届时组装新命令编号）。',
          errorCode: verdict.errorCode,
        });
        return;
      }
      if (verdict.outcome === 'rejected') {
        setPendingCommand(null);
        const code = verdict.errorCode ?? 'UNKNOWN_ERROR_CODE';
        if (code === 'ROLE_MISMATCH' || response.status === 403) {
          setFeedback({
            tone: 'error',
            title: '权限不足：当前身份不能核验材料。',
            detail:
              code === 'ROLE_MISMATCH'
                ? '业务角色不得自核验；请切换到政策 / 信审 / 商务 / 资产身份后再试。'
                : '服务端拒绝了本次核验，请更换匹配身份后重试。',
            errorCode: code,
          });
          return;
        }
        setFeedback({
          tone: 'error',
          title: `核验提交失败（${code}）`,
          detail: ERROR_DETAIL_LABELS[code] ?? '服务端拒绝了本次核验，请稍后重试。',
          errorCode: code,
        });
        return;
      }
      // unknown：结果未知——保留原命令与重试通道，不清空、不伪造成功、不换新命令。
      setPendingCommand(command);
      setFeedback({
        tone: 'unknown',
        title: '核验结果未知：未收到可确认的受理响应。',
        detail: '原命令已保留；仅可重试同一命令编号与内容，不会静默更换命令编号。',
        errorCode: verdict.errorCode,
      });
    } catch {
      // 网络异常：结果未知——保留原命令与重试通道。
      setPendingCommand(command);
      setFeedback({
        tone: 'unknown',
        title: '网络异常：核验结果未知。',
        detail: '原命令已保留；仅可重试同一命令编号与内容，不会静默更换命令编号。',
        errorCode: 'NETWORK_ERROR',
      });
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(): void {
    if (pending || !canSubmit || selectedEvidence === undefined) {
      return;
    }
    // 组装一次命令：此刻生成 commandId，并连同 caseId/actorId/expectedRev 一起冻结在载荷里。
    const command = composeVerificationCommand({
      commandId: newCommandId(),
      caseId,
      actorId,
      evidenceId: selectedEvidence.evidenceId,
      verificationStatus: targetStatus,
      reason,
      expectedRev: projection.rev,
    });
    setPendingCommand(command);
    void sendVerification(command);
  }

  function handleRetry(): void {
    if (pending || unknownCommand === null) {
      return;
    }
    // 绑定一致才允许重试；同一原载荷原样重发（含原 caseId/actorId/commandId/expectedRev）。
    if (unknownCommandBinding(unknownCommand, caseId, actorId) !== 'match') {
      return;
    }
    void sendVerification(unknownCommand);
  }

  return (
    <section className={styles.panel} aria-label="材料核验">
      <header className={styles.head}>
        <h3 className={styles.title}>材料核验</h3>
        <span className={styles.demoBadge}>合成演示 / 候选岗位语义，非正式审批</span>
      </header>
      <p className={styles.note}>
        核验只是对材料可信度的文字标注，不构成、不替代任何正式权力动作；结果以服务端受理为准。
      </p>

      {unknownCommand !== null && binding === 'stale' ? (
        <div className={styles.pendingBlock} role="alert">
          <p className={styles.pendingTitle}>
            待确认：存在结果未知的核验命令，且绑定于其他案例或身份；重试与新提交已停用。
          </p>
          <p className={styles.pendingSummary}>{unknownCommandSummary(unknownCommand)}</p>
          <p className={styles.pendingNote}>
            请切回上述案例与原身份，即可重试同一未决命令；该命令在收到明确结果前不会被清除或覆盖。
          </p>
        </div>
      ) : null}

      {projection.evidence.length === 0 ? (
        <p className={styles.emptyNote}>该 Case 暂无材料，无可核验对象。</p>
      ) : (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>材料（含当前服务端核验状态）</span>
            <select
              className={styles.select}
              value={selectedEvidence?.evidenceId ?? ''}
              disabled={pending}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setEvidenceId(event.target.value)}
            >
              {projection.evidence.map((entry) => (
                <option key={entry.evidenceId} value={entry.evidenceId}>
                  {entry.title} · {EVIDENCE_KIND_LABELS[entry.kind]} · 当前：
                  {VERIFICATION_STATUS_LABELS[entry.verificationStatus ?? 'claimed']}
                </option>
              ))}
            </select>
          </label>

          <p className={styles.currentLine}>
            当前状态：<strong>{VERIFICATION_STATUS_LABELS[selectedStatus]}</strong>
            <span className={styles.currentMeta}>
              {' '}· {selectedEvidence?.evidenceId ?? '—'} · V{selectedEvidence?.version ?? '—'}
            </span>
          </p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>目标核验状态</span>
            <select
              className={styles.select}
              value={targetStatus}
              disabled={pending}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setTargetStatus(event.target.value as V4LifeVerificationTarget)
              }
            >
              {TARGET_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {VERIFICATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>核验理由（必填）</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={reason}
              placeholder="说明核验依据，例如比对口径、材料来源或矛盾点"
              disabled={pending}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
            />
          </label>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.submitBtn}
              disabled={!canSubmit}
              aria-busy={pending}
              onClick={handleSubmit}
            >
              {pending ? '提交中' : '提交核验'}
            </button>
            {unknownCommand !== null ? (
              <button
                type="button"
                className={styles.retryBtn}
                disabled={pending || binding !== 'match'}
                onClick={handleRetry}
              >
                重试（复用同一命令编号）
              </button>
            ) : null}
          </div>

          {unknownCommand !== null && binding === 'match' ? (
            <small className={styles.roleHint}>
              存在结果未知的核验命令，仅可重试同一命令；新提交已停用。
            </small>
          ) : null}
          {isBusinessActor && unknownCommand === null ? (
            <small className={styles.roleHint}>
              当前身份为业务：业务不得自核验，提交将被服务端拒绝（权限不足）。
            </small>
          ) : null}
          <small className={styles.hint}>
            状态仅取 已核验 / 未核验 / 已矛盾 / 已过期（已声明为追加初始值，不可作为目标）；
            重试复用同一命令编号；版本冲突只刷新、不自动重放。
          </small>
        </div>
      )}

      <div className={styles.liveArea} role="status" aria-live="polite">
        {feedback !== null ? (
          <p className={styles.banner} data-tone={feedback.tone}>
            <strong>
              {feedback.tone === 'accepted'
                ? '✓ 已受理'
                : feedback.tone === 'replayed'
                  ? '↻ 幂等重放（此前已受理）'
                  : feedback.tone === 'notice'
                    ? '△ 请确认'
                    : feedback.tone === 'unknown'
                      ? '？ 结果未知'
                      : '✕ 未受理'}
            </strong>
            <span>
              {feedback.title}
              {feedback.detail}
              {feedback.errorCode !== undefined ? `（代码 ${feedback.errorCode}）` : ''}
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default VerificationPanel;
