// /work 状态原语（Lane W4，2026-09-03）
// 全工作台复用的 Loading / Empty / Error / Stale / Connection / Feedback 呈现原语，无业务逻辑。
// 纪律：loading 不闪烁假成功；错误保留 exact code；状态不只靠颜色（文字+图形）；空态保持 Case 上下文。
// 注意：本文件不写 'use client'——由客户端 shell 统一引入。

import type { CommandFeedback, ConnectionState } from '../workspace-contract';
import styles from './inspection.module.css';

// ---------------------------------------------------------------------------
// 错误码中文描述（exact code 仍原样展示，不做归并）
// ---------------------------------------------------------------------------

const ERROR_DESCRIPTIONS: Record<string, string> = {
  INVALID_ENGINE_INPUT: '请求内容未通过校验',
  ACTOR_NOT_FOUND: '当前角色不存在或已失效',
  EVIDENCE_INVALID: '证据内容不完整或不合法',
  CASE_NOT_FOUND: '未找到该 Case',
  WORK_ITEM_NOT_FOUND: '未找到该工作事项',
  GATE_NOT_FOUND: '未找到该 Gate',
  ROLE_MISMATCH: '当前角色无权执行该动作',
  EVIDENCE_CONFLICT: '证据提交冲突',
  IDEMPOTENCY_CONFLICT: '同一命令 ID 被用于不同载荷，服务端已拒绝',
  VERSION_CONFLICT: '版本已变化，请刷新后基于最新状态重试',
  WORK_ITEM_NOT_ACTIVE: '该事项当前不可提交',
  GATE_NOT_OPEN: '该 Gate 当前未开启',
  GATE_ALREADY_DECIDED: '该 Gate 已有决定，不能重复决定',
  SEQ_CONFLICT: '事件序号冲突，请刷新后重试',
  INTERNAL_ERROR: '服务内部错误',
  NETWORK_ERROR: '网络传输失败，结果未知',
};

/** 由 exact code 派生中文描述；未知码回退为通用文案（code 本身仍展示）。 */
export function describeErrorCode(code: string): string {
  return ERROR_DESCRIPTIONS[code] ?? '请求未成功，请以错误码为准';
}

// ---------------------------------------------------------------------------
// Loading / Empty / Error / Stale
// ---------------------------------------------------------------------------

/** 读取中占位：只有 loading 语义，绝不渲染任何“看起来像成功”的内容。 */
export function LoadingBlock({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className={styles.loadingBlock} role="status" aria-live="polite">
      <span className={styles.loadingGlyph} aria-hidden="true">
        ◌
      </span>
      <span>{label}</span>
    </div>
  );
}

/** 空态：title 必填，建议携带 Case 上下文文案。 */
export function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={styles.emptyBlock}>
      <span className={styles.emptyGlyph} aria-hidden="true">
        ▢
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {hint ? <p className={styles.emptyHint}>{hint}</p> : null}
    </div>
  );
}

/** 错误态：中文描述 + exact code；仅当提供 onRetry 时出现重试按钮。 */
export function ErrorBlock({ code, message, onRetry }: { code: string; message?: string; onRetry?: () => void }) {
  return (
    <div className={styles.errorBlock} role="alert">
      <p className={styles.errorTitle}>
        <span className={styles.errorGlyph} aria-hidden="true">
          ✕
        </span>
        读取失败：{message ?? describeErrorCode(code)}
      </p>
      <p className={styles.errorCodeLine}>
        错误码 <code className={styles.mono}>{code}</code>
      </p>
      {onRetry ? (
        <button type="button" className={styles.smallButton} onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

/** 过期提示：本地显示的可能不是最新 Projection，可手动重读。 */
export function StaleBanner({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className={styles.staleBanner} role="status">
      <span className={styles.staleGlyph} aria-hidden="true">
        ▲
      </span>
      <span className={styles.staleText}>本地显示的状态已过期，可能不是最新 Projection。</span>
      {onRefresh ? (
        <button type="button" className={styles.smallButton} onClick={onRefresh}>
          重新读取
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectionDot：连接状态 = 图形 + 文字（不只靠颜色）
// ---------------------------------------------------------------------------

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  loading: '同步中',
  synced: '已同步',
  stale: '已过期',
  error: '读取失败',
};

const CONNECTION_GLYPH: Record<ConnectionState, string> = {
  loading: '◌',
  synced: '●',
  stale: '▲',
  error: '✕',
};

const CONNECTION_CLASS: Record<ConnectionState, string> = {
  loading: styles.connectionLoading,
  synced: styles.connectionSynced,
  stale: styles.connectionStale,
  error: styles.connectionError,
};

export function ConnectionDot({ connection }: { connection: ConnectionState }) {
  return (
    <span className={`${styles.connectionDot} ${CONNECTION_CLASS[connection]}`} role="status">
      <span className={styles.connectionGlyph} aria-hidden="true">
        {CONNECTION_GLYPH[connection]}
      </span>
      {CONNECTION_TEXT[connection]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FeedbackBanner：命令反馈三态（accepted / replayed / error），以服务端响应为准
// ---------------------------------------------------------------------------

export function FeedbackBanner({ feedback }: { feedback: CommandFeedback | null }) {
  if (!feedback) {
    return null;
  }

  if (feedback.status === 'error') {
    return (
      <div className={styles.feedbackError} role="alert">
        <p className={styles.feedbackLine}>
          <span className={styles.errorGlyph} aria-hidden="true">
            ✕
          </span>
          命令未生效：{feedback.message}
        </p>
        {feedback.errorCode ? (
          <p className={styles.errorCodeLine}>
            错误码 <code className={styles.mono}>{feedback.errorCode}</code>（{describeErrorCode(feedback.errorCode)}）
          </p>
        ) : null}
      </div>
    );
  }

  const replayed = feedback.status === 'replayed';
  return (
    <div className={replayed ? styles.feedbackReplayed : styles.feedbackAccepted} role="status">
      <p className={styles.feedbackLine}>
        <span className={styles.feedbackGlyph} aria-hidden="true">
          {replayed ? '⟳' : '✓'}
        </span>
        {replayed ? '重复命令已重放（未重复生效）' : '服务端已受理'}：{feedback.message}
      </p>
      {feedback.receipt ? (
        <p className={styles.feedbackReceipt}>
          Receipt <code className={styles.mono}>{feedback.receipt.receiptId}</code>
        </p>
      ) : null}
      {feedback.stoppedWorkItemIds && feedback.stoppedWorkItemIds.length > 0 ? (
        <p className={styles.feedbackReceipt}>
          受影响事项：
          {feedback.stoppedWorkItemIds.map((id) => (
            <code key={id} className={styles.mono}>
              {id}{' '}
            </code>
          ))}
        </p>
      ) : null}
    </div>
  );
}
