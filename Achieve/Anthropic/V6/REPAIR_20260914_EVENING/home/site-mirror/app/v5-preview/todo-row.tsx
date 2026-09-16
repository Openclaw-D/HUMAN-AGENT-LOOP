// B 候选 · 当前待办行（承接 TodoCard 行为语义，紧凑化）：标题+状态徽章（图标在文字左）；
// 右侧时间字段如实显示"未设置/暂无估计"（TodoItem 无时间字段，禁止伪造倒计时）。
// 展开 = 详情 + 复核说明 + 补充说明表单（仅"待补充"提供提交入口；提交是补充说明，
// 不是审批通过——界面不提供任何批准/放款/结清按钮）。409/网络错误一律保留草稿；
// 未确认说明请求恢复行在折叠区之外恒可达。恢复行文案/判定逻辑复用 site rows-logic。
import { useRef, useState, type FormEvent } from 'react';
import type { TodoItem, TodoStatus } from '../../lib/v5-preview/shared-types';
import {
  pendingRequestRowText,
  recoveryLimitedNotice,
  recoveryResolveLabel,
  shouldClearDraftForRequest,
  type DraftRequestAssociation,
  type NoteRecoverySlot,
  type ResolveOutcome,
  type SubmitOutcome,
} from './rows-logic';
import { CheckIcon, ChevronDownIcon, ClockIcon, WarnIcon } from './se-icons';
import styles from './home-overview.module.css';

const DOMAIN_NAMES: Record<string, string> = {
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

function TodoMark({ status }: { status: TodoStatus }) {
  if (status === '待补充') return <WarnIcon size={9} />;
  if (status === '待复核') return <span className={styles.judgmentDot} aria-hidden="true" />;
  return <CheckIcon size={9} />;
}

export function TodoRow({
  todo,
  onSubmitNote,
  pendingNote,
  onResolvePendingNote,
  onDismissPendingNote,
  resolvingPending,
  recoveryPersistFailed,
}: {
  todo: TodoItem | null;
  onSubmitNote: (todoId: string, text: string) => Promise<SubmitOutcome>;
  pendingNote: NoteRecoverySlot;
  onResolvePendingNote: () => Promise<ResolveOutcome>;
  onDismissPendingNote: () => void;
  resolvingPending: boolean;
  recoveryPersistFailed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => {
    try { return window.sessionStorage.getItem('jw:v5-preview:draft:todo') ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const draftRevisionRef = useRef(0);
  const draftAssocRef = useRef<DraftRequestAssociation | null>(null);

  function clearDraft() {
    setDraft('');
    try { window.sessionStorage.removeItem('jw:v5-preview:draft:todo'); } catch { /* 忽略 */ }
    setOpen(false);
    setError(null);
    setConflictHint(null);
  }

  function handleResolveSuccess(outcome: ResolveOutcome) {
    if (outcome.result !== 'ok') return;
    if (shouldClearDraftForRequest(draftAssocRef.current, outcome.requestId, draftRevisionRef.current)) {
      clearDraft();
    } else {
      setError(null);
      setConflictHint(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (busy || text === '') return;
    setBusy(true);
    setError(null);
    setConflictHint(null);
    const revisionAtSubmit = draftRevisionRef.current;
    const result = await onSubmitNote(todoId, text);
    setBusy(false);
    if (result.requestId !== undefined) {
      draftAssocRef.current = { requestId: result.requestId, revision: revisionAtSubmit };
    }
    if (result.outcome === 'ok') {
      setError(null);
      setConflictHint(null);
      if (shouldClearDraftForRequest(draftAssocRef.current, result.requestId, draftRevisionRef.current)) {
        clearDraft();
      }
      return;
    }
    if (result.outcome === 'conflict') {
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次提交`);
      return;
    }
    setError(result.message);
  }

  if (todo === null) {
    return (
      <section className={styles.todoSection} aria-label="当前待办">
        <p className={styles.todoEmpty}>当前演示情景无开放待办；项目沟通仍可留言留档（合成演示）。</p>
        {pendingNote !== null ? (
          <PendingNoteRow
            slot={pendingNote}
            resolving={resolvingPending}
            persistFailed={recoveryPersistFailed}
            onResolve={onResolvePendingNote}
            onDismiss={onDismissPendingNote}
            onResolveSuccess={handleResolveSuccess}
          />
        ) : null}
      </section>
    );
  }

  const todoId = todo.id;
  const canSubmit = todo.status === '待补充';
  const pendingReview = todo.status === '待复核';
  const reviewerName = todo.relatedDomain !== null ? (DOMAIN_NAMES[todo.relatedDomain] ?? '相关专业域') : '相关专业域';

  return (
    <section className={styles.todoSection} aria-label="当前待办">
      <button
        type="button"
        className={styles.todoRowBtn}
        aria-expanded={open}
        aria-controls="jw-home-todo-panel"
        aria-label={`当前待办：${todo.title}（${todo.status}）。预计剩余未设置；截止时间暂无估计。点击${open ? '收起' : '展开'}详情`}
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setConflictHint(null);
        }}
      >
        <span className={styles.todoTitleWrap}>
          <span className={styles.todoTitle} title={todo.title}>{todo.title}</span>
          <span className={styles.todoBadge} data-status={todo.status}>
            <TodoMark status={todo.status} />
            <span>{todo.status}</span>
          </span>
        </span>
        <span className={styles.todoTimes} title="演示数据不含时间字段；如实显示未设置，不提供倒计时或估计">
          <span className={styles.todoTimeLine}><ClockIcon size={10} />预计剩余：未设置</span>
          <span className={styles.todoTimeLine}>截止时间：暂无估计</span>
        </span>
        <span className={styles.chevron} data-open={open ? 'true' : 'false'} aria-hidden="true">
          <ChevronDownIcon size={11} />
        </span>
      </button>
      {pendingNote !== null ? (
        <PendingNoteRow
          slot={pendingNote}
          resolving={resolvingPending}
          persistFailed={recoveryPersistFailed}
          onResolve={onResolvePendingNote}
          onDismiss={onDismissPendingNote}
          onResolveSuccess={handleResolveSuccess}
        />
      ) : null}
      {open ? (
        <div id="jw-home-todo-panel" className={styles.todoExpanded}>
          <p className={styles.todoDetailText}>{todo.detail}</p>
          {pendingReview ? (
            <p className={styles.reviewNote} role="status">已提交补充说明，{reviewerName}复核中（合成）</p>
          ) : null}
          {canSubmit ? (
            <form className={styles.todoForm} onSubmit={handleSubmit}>
              <label className={styles.srOnly} htmlFor="jw-home-note-text">
                补充说明（合成演示；提交后相关专业域转入待复核）
              </label>
              <textarea
                id="jw-home-note-text"
                className={styles.textarea}
                value={draft}
                maxLength={2000}
                rows={3}
                placeholder="例：设备清单与报价要点说明（合成演示内容）。"
                onChange={(e) => {
                  setDraft(e.target.value);
                  draftRevisionRef.current += 1;
                  try { window.sessionStorage.setItem('jw:v5-preview:draft:todo', e.target.value); } catch { /* 忽略 */ }
                }}
              />
              <div className={styles.formRow}>
                <span className={styles.fieldHint}>{draft.trim().length}/2000 字符</span>
                <button type="submit" className={styles.btnPrimary} disabled={busy || draft.trim() === ''}>
                  {busy ? '提交中…' : '提交说明'}
                </button>
              </div>
              {error !== null ? <p className={styles.formError} role="alert">提交失败：{error}（草稿已保留，可修改后重试）</p> : null}
              {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PendingNoteRow({
  slot,
  resolving,
  persistFailed,
  onResolve,
  onDismiss,
  onResolveSuccess,
}: {
  slot: Exclude<NoteRecoverySlot, null>;
  resolving: boolean;
  persistFailed: boolean;
  onResolve: () => Promise<ResolveOutcome>;
  onDismiss: () => void;
  onResolveSuccess: (outcome: ResolveOutcome) => void;
}) {
  const [resolveFailed, setResolveFailed] = useState(false);

  if (slot.status === 'limited') {
    return (
      <div className={styles.pendingRow} role="status">
        <span>{recoveryLimitedNotice('note', slot.reason)}</span>
        <button type="button" className={styles.btnSecondary} onClick={onDismiss}>
          清除该提示
        </button>
      </div>
    );
  }

  async function handleResolve() {
    setResolveFailed(false);
    const outcome = await onResolve();
    if (outcome.result === 'ok') {
      onResolveSuccess(outcome);
    } else if (outcome.result === 'failed') {
      setResolveFailed(true);
    } else {
      // stale：陈旧确认（请求已作废/取代）静默——不产生新反馈、不改写关联。
    }
  }

  return (
    <div className={styles.pendingRow} role="status">
      <span>
        {pendingRequestRowText('note')}
        {persistFailed ? '（浏览器存储不可用：本页刷新后可能无法恢复该请求信息）' : ''}
      </span>
      {resolveFailed ? <span className={styles.pendingRowHint}>确认未完成：请稍后再次尝试（该请求已保留）。</span> : null}
      <button type="button" className={styles.btnSecondary} disabled={resolving} onClick={() => void handleResolve()}>
        {resolving ? '确认中…' : recoveryResolveLabel('note')}
      </button>
    </div>
  );
}
