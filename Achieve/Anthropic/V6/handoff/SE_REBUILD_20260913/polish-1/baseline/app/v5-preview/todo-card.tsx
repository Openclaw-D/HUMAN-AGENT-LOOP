// V6 SE_REBUILD · 状态/待办紧凑行（约 52px 两行）：左动作名称+状态徽章（图标在状态文字左侧），
// 右侧两行如实显示"预计剩余：未设置 / 截止时间：暂无估计"（TodoItem 无任何时间字段，
// 禁止伪造倒计时）。整行可点击/键盘展开：详情、复核说明与补充说明表单在当前界面内展开。
// 409 VERSION_CONFLICT / 网络错误 / 业务错误（NO_OPEN_TODO 等）一律保留草稿；
// 只有提交成功（outcome === 'ok'）才清空输入——清空资格由"草稿-请求关联"判定：
// 请求真正发出时冻结 {requestId, 发送时修订}，被阻断的新提交不改写关联（rework-2 F1），
// 在途编辑出的新草稿不被迟到的成功回执清空（A→B→A 修订序列同样保留）。
// 提交是"补充说明"，不是审批通过：界面不提供任何批准/放款/结清按钮。
// 未确认说明请求的恢复行对所有待办状态可见（不依赖待补充/待复核/null，且在折叠区之外）；
// 恢复受限（记录损坏/旧版哨兵）只提示 + 显式清除，无虚假确认按钮。
// 复核提示按待办相关域显示（relatedDomain），不写死信审。
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
import styles from './se-overview.module.css';

interface TodoCardProps {
  todo: TodoItem | null;
  onSubmitNote: (todoId: string, text: string) => Promise<SubmitOutcome>;
  /** R1/R2：未确认说明请求的恢复槽位（完整原载荷记录 / 恢复受限）。 */
  pendingNote: NoteRecoverySlot;
  onResolvePendingNote: () => Promise<ResolveOutcome>;
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

/** 状态徽章图标（在状态文字左侧）：待补充=叹号黄 / 待复核=灰点 / 已完成·已结清=对号绿。 */
function TodoMark({ status }: { status: TodoStatus }) {
  if (status === '待补充') return <WarnIcon size={9} />;
  if (status === '待复核') return <span className={styles.judgmentDot} aria-hidden="true" />;
  return <CheckIcon size={9} />;
}

export default function TodoCard({
  todo,
  onSubmitNote,
  pendingNote,
  onResolvePendingNote,
  onDismissPendingNote,
  resolvingPending,
  recoveryPersistFailed,
}: TodoCardProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => {
    try { return window.sessionStorage.getItem('jw:v5-preview:draft:todo') ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [editKept, setEditKept] = useState(false);
  // R3/F1：草稿修订标识——每次编辑自增；请求真正发出时冻结 {requestId, 修订} 关联。
  const draftRevisionRef = useRef(0);
  const draftAssocRef = useRef<DraftRequestAssociation | null>(null);

  // 清空草稿的唯一出口（便于断言"清空只此一处"）；仅在草稿-请求关联判定通过后调用。
  // 同时清理旧内联反馈：输入已清空时不得残留"内容已保留/请先确认"式过时提示（F2 一致性）。
  function clearDraft() {
    setDraft('');
    try { window.sessionStorage.removeItem('jw:v5-preview:draft:todo'); } catch { /* 忽略 */ }
    setOpen(false);
    setEditKept(false);
    setError(null);
    setConflictHint(null);
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
            onClearedStaleFeedback={() => {
              setError(null);
              setConflictHint(null);
            }}
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

  /** F1：确认成功的草稿处置——只有当确认的 requestId 与"发送时关联"一致、
   *  且草稿修订自该请求发送以来未变时才清空；被阻断的新草稿（未建立自己的关联、
   *  修订已前进）永远不能被旧请求的确认清空。 */
  function handleResolveSuccess(outcome: ResolveOutcome) {
    if (outcome.result !== 'ok') return;
    if (shouldClearDraftForRequest(draftAssocRef.current, outcome.requestId, draftRevisionRef.current)) {
      clearDraft();
    } else {
      // 未清空（保留的是未随请求发送的新草稿）：旧请求已确认，同步撤下过时的阻断/失败提示。
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
    // F1：只有请求真正发出（结果携带 requestId）才建立/更新"草稿-请求关联"；
    // 被阻断的新提交（PENDING_REQUEST_EXISTS，无 requestId）不得改写旧请求的关联。
    if (result.requestId !== undefined) {
      draftAssocRef.current = { requestId: result.requestId, revision: revisionAtSubmit };
    }
    if (result.outcome === 'ok') {
      // 成功后撤下旧错误（无论是否清空草稿）：旧的"内容已保留/请先确认"不再适用。
      setError(null);
      setConflictHint(null);
      // R3/F1：仅当草稿仍是本次请求发送时的修订才清空；在途编辑出的新草稿保留并如实提示。
      if (shouldClearDraftForRequest(draftAssocRef.current, result.requestId, draftRevisionRef.current)) {
        clearDraft();
      } else {
        setEditKept(true);
      }
      // 成功反馈 = 服务端返回的最新状态（待办转"待复核"后展开区显示复核中说明），无需本地成功横幅。
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
    <section className={styles.todoSection} aria-label="当前待办">
      <button
        type="button"
        className={styles.todoRow}
        aria-expanded={open}
        aria-controls="v5-se-todo-panel"
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
        {/* TodoItem 无任何时间字段：如实显示未设置/暂无估计，不伪造倒计时。 */}
        <span className={styles.todoTimes} title="演示数据不含时间字段；如实显示未设置，不提供倒计时或估计">
          <span className={styles.todoTimeLine}><ClockIcon size={10} />预计剩余：未设置</span>
          <span className={styles.todoTimeLine}>截止时间：暂无估计</span>
        </span>
        <span className={styles.chevron} data-open={open ? 'true' : 'false'} aria-hidden="true">
          <ChevronDownIcon size={11} />
        </span>
      </button>
      {/* 恢复行在折叠区之外：任何待办状态（含无待办）都可见。 */}
      {pendingNote !== null ? (
        <PendingNoteRow
          slot={pendingNote}
          resolving={resolvingPending}
          persistFailed={recoveryPersistFailed}
          onResolve={onResolvePendingNote}
          onDismiss={onDismissPendingNote}
          onClearedStaleFeedback={() => {
            setError(null);
            setConflictHint(null);
          }}
          onResolveSuccess={handleResolveSuccess}
        />
      ) : null}
      {open ? (
        <div id="v5-se-todo-panel" className={styles.todoExpanded}>
          <h2 className={styles.srOnly}>{todo.title}</h2>
          <p className={styles.todoDetailText}>{todo.detail}</p>
          {pendingReview ? (
            <p className={styles.reviewNote} role="status">已提交补充说明，{reviewerName}复核中（合成）</p>
          ) : null}
          {canSubmit ? (
            <form id="v5-rows-note-form" className={styles.todoForm} onSubmit={handleSubmit}>
              <label className={styles.srOnly} htmlFor="v5-rows-note-text">
                补充说明（合成演示；提交后相关专业域转入待复核）
              </label>
              <textarea
                id="v5-rows-note-text"
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
              {editKept ? (
                <p className={styles.formConflict} role="status">
                  说明已提交；表单中保留的是提交之后的新编辑，未随本次发送（合成演示）。
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 未确认说明请求恢复行（R1/R2）：
 *  - 有效记录：确认动作按完整原载荷重放一次（幂等安全）；重放成功且草稿关联匹配才清空草稿。
 *  - 恢复受限（损坏/旧版哨兵）：明确提示无法自动确认，仅提供显式清除，无虚假确认按钮。 */
function PendingNoteRow({
  slot,
  resolving,
  persistFailed,
  onResolve,
  onDismiss,
  onClearedStaleFeedback,
  onResolveSuccess,
}: {
  slot: Exclude<NoteRecoverySlot, null>;
  resolving: boolean;
  persistFailed: boolean;
  onResolve: () => Promise<ResolveOutcome>;
  onDismiss: () => void;
  /** 确认成功（无论是否清空草稿）后撤下过时的阻断/失败内联提示。 */
  onClearedStaleFeedback: () => void;
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
      // 确认成功：草稿按"草稿-请求关联"处置；同时撤下过时的阻断/失败提示（F2 一致性）。
      onClearedStaleFeedback();
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
