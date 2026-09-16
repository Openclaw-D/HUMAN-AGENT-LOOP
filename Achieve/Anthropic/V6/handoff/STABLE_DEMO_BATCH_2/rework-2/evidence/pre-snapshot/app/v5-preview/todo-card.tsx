// V5 ROWS · 最重要待办卡："补充说明"展开补充说明表单（不含文件上传能力） → POST /api/v5-preview/notes。
// 409 VERSION_CONFLICT / 网络错误 / 业务错误（NO_OPEN_TODO 等）一律保留草稿；
// 只有提交成功（outcome === 'ok'）才清空输入——且按 R3 以草稿修订标识判定，
// 在途期间编辑出的新草稿不被迟到的成功回执清空（A→B→A 修订序列同样保留）。
// 提交是"补充说明"，不是审批通过：界面不提供任何批准/放款/结清按钮。
// V6 BATCH_2 rework-1：未确认说明请求的恢复行对所有待办状态可见（不依赖待补充/待复核/null）；
// 恢复受限（记录损坏/旧版哨兵）只提示 + 显式清除，无虚假确认按钮。
// 复核提示按待办相关域显示（relatedDomain），不写死信审。
import { useRef, useState, type FormEvent } from 'react';
import type { TodoItem } from '../../lib/v5-preview/shared-types';
import {
  pendingRequestRowText,
  recoveryLimitedNotice,
  recoveryResolveLabel,
  shouldClearDraftAfterConfirmation,
  type NoteRecoverySlot,
  type ResolveResult,
  type SubmitOutcome,
} from './rows-logic';
import styles from './preview.module.css';

interface TodoCardProps {
  todo: TodoItem | null;
  onSubmitNote: (todoId: string, text: string) => Promise<SubmitOutcome>;
  /** R1/R2：未确认说明请求的恢复槽位（完整原载荷记录 / 恢复受限）。 */
  pendingNote: NoteRecoverySlot;
  onResolvePendingNote: () => Promise<ResolveResult>;
  /** 恢复受限提示的显式清除（用户知情后手动放弃该条无法确认的记录）。 */
  onDismissPendingNote: () => void;
  /** 确认动作进行中：禁用按钮，连续点击不重复重放。 */
  resolvingPending: boolean;
  /** 恢复记录无法写入 sessionStorage：如实提示刷新后可能无法恢复。 */
  recoveryPersistFailed: boolean;
}

const DOMAIN_NAMES: Record<string, string> = {
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

export default function TodoCard({
  todo,
  onSubmitNote,
  pendingNote,
  onResolvePendingNote,
  onDismissPendingNote,
  resolvingPending,
  recoveryPersistFailed,
}: TodoCardProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [editKept, setEditKept] = useState(false);
  // R3：草稿修订标识——每次编辑自增；提交时冻结修订号，成功回执仅在修订未变时清空。
  const draftRevisionRef = useRef(0);
  const submittedRevisionRef = useRef<number | null>(null);

  // 清空草稿的唯一出口（便于断言"清空只此一处"）；仅在修订标识判定通过后调用。
  function clearDraft() {
    setDraft('');
    setFormOpen(false);
    setEditKept(false);
  }

  // R3：恢复入口重放成功后的草稿处置——仅当草稿仍停留在该请求提交时的修订才清空；
  // 修订已变（恢复期间编辑了新内容）→ 保留新草稿。
  function handleResolveSuccess() {
    if (shouldClearDraftAfterConfirmation(submittedRevisionRef.current, draftRevisionRef.current)) {
      clearDraft();
    }
  }

  if (todo === null) {
    return (
      <section className={styles.todoCard} aria-label="当前待办">
        <p className={styles.todoKicker}>当前待办</p>
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

  // 判空后立即捕获 todoId：提交闭包不依赖可空属性（TS 收窄不跨函数边界）。
  const todoId = todo.id;
  // 只有"待补充"才提供提交入口；待复核不再提供注定 404 的表单；
  // 已完成/已结清维持标题/说明/状态徽标展示，不加提交入口。
  const canSubmit = todo.status === '待补充';
  const pendingReview = todo.status === '待复核';
  // 复核主体按待办相关域显示；未知域回退"相关专业域"，不错误指认。
  const reviewerName = todo.relatedDomain !== null ? (DOMAIN_NAMES[todo.relatedDomain] ?? '相关专业域') : '相关专业域';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (busy || text === '') return;
    setBusy(true);
    setError(null);
    setConflictHint(null);
    const revisionAtSubmit = draftRevisionRef.current;
    submittedRevisionRef.current = revisionAtSubmit;
    const result = await onSubmitNote(todoId, text);
    setBusy(false);
    if (result.outcome === 'ok') {
      // R3：仅当草稿仍是提交时的修订才清空；在途编辑出的新草稿保留并如实提示。
      if (shouldClearDraftAfterConfirmation(revisionAtSubmit, draftRevisionRef.current)) {
        clearDraft();
      } else {
        setEditKept(true);
      }
      // 成功反馈 = 服务端返回的最新状态（待办转"待复核"后卡片显示复核中说明），无需本地成功横幅。
      return;
    }
    if (result.outcome === 'conflict') {
      // 409：草稿保留；页面级横幅全局告知，表单旁内联提示就近告知"可直接再次提交"。
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次提交`);
      return;
    }
    // 业务错误与网络错误：草稿保留，可修改后重试。文案已在 page 层统一映射为中文（CP2-4）。
    setError(result.message);
  }

  return (
    <section className={styles.todoCard} aria-label="当前待办">
      <p className={styles.todoKicker}>当前待办</p>
      <div className={styles.todoHead}>
        <div>
          <h2 className={styles.todoTitle}>{todo.title}</h2>
          <p className={styles.todoDetail}>{todo.detail}</p>
        </div>
        <div className={styles.todoActions}>
          <span className={styles.todoStatus}>{todo.status}</span>
          {canSubmit ? (
            <button
              type="button"
              className={styles.primaryBtn}
              aria-expanded={formOpen}
              aria-controls="v5-rows-note-form"
              onClick={() => {
                setFormOpen((v) => !v);
                setError(null);
                setConflictHint(null);
              }}
            >
              补充说明
            </button>
          ) : null}
        </div>
      </div>
      {pendingReview ? (
        <p className={styles.todoReviewNote} role="status">已提交补充说明，{reviewerName}复核中（合成）</p>
      ) : null}
      {canSubmit && formOpen ? (
        <form id="v5-rows-note-form" className={styles.todoForm} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel} htmlFor="v5-rows-note-text">
            补充说明（合成演示；提交后相关专业域转入待复核）
          </label>
          <textarea
            id="v5-rows-note-text"
            className={styles.textarea}
            value={draft}
            maxLength={2000}
            rows={4}
            placeholder="例：设备清单与报价要点说明（合成演示内容）。"
            onChange={(e) => {
              setDraft(e.target.value);
              draftRevisionRef.current += 1;
            }}
          />
          <div className={styles.formRow}>
            <span className={styles.fieldHint}>{draft.trim().length}/2000 字符</span>
            <button type="submit" className={styles.primaryBtn} disabled={busy || draft.trim() === ''}>
              {busy ? '提交中…' : '提交说明'}
            </button>
          </div>
          {error !== null ? <p className={styles.formError} role="alert">提交失败：{error}（草稿已保留，可修改后重试）</p> : null}
          {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
          {editKept ? (
            <p className={styles.formConflict} role="status">
              说明已提交；表单中保留的是提交之后的新编辑，未随本次发送（合成演示）。
            </p>
          ) : null}
        </form>
      ) : null}
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

/** 未确认说明请求恢复行（R1/R2）：
 *  - 有效记录：确认动作按完整原载荷重放一次（幂等安全）；重放成功且草稿仍是提交时修订才清空草稿。
 *  - 恢复受限（损坏/旧版哨兵）：明确提示无法自动确认，仅提供显式清除，无虚假确认按钮。 */
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
  onResolve: () => Promise<ResolveResult>;
  onDismiss: () => void;
  onResolveSuccess: () => void;
}) {
  const [resolveFailed, setResolveFailed] = useState(false);

  if (slot.status === 'limited') {
    return (
      <div className={styles.pendingRequestRow} role="status">
        <span>{recoveryLimitedNotice('note', slot.reason)}</span>
        <button type="button" className={styles.secondaryBtn} onClick={onDismiss}>
          清除该提示
        </button>
      </div>
    );
  }

  async function handleResolve() {
    setResolveFailed(false);
    const outcome = await onResolve();
    if (outcome === 'ok') {
      // 重放成功：草稿处置由卡片按"提交时修订标识"判定（该请求原样已确认）。
      onResolveSuccess();
    } else {
      setResolveFailed(true);
    }
  }

  return (
    <div className={styles.pendingRequestRow} role="status">
      <span>
        {pendingRequestRowText('note')}
        {persistFailed ? '（浏览器存储不可用：本页刷新后可能无法恢复该请求信息）' : ''}
      </span>
      {resolveFailed ? <span className={styles.pendingRowHint}>确认未完成：请稍后再次尝试（该请求已保留）。</span> : null}
      <button type="button" className={styles.secondaryBtn} disabled={resolving} onClick={() => void handleResolve()}>
        {resolving ? '确认中…' : recoveryResolveLabel('note')}
      </button>
    </div>
  );
}
