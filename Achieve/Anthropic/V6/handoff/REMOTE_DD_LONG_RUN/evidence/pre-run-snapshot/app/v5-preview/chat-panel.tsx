// V5 ROWS · "项目沟通"轻量可展开面板：消息列表（fromKind 区分 + marks 标签）+ 输入框
// → POST /api/v5-preview/messages。409 冲突/网络错误保留输入内容；只有成功才清空——
// 清空资格由"草稿-请求关联"判定：请求真正发出时冻结 {requestId, 发送时修订}，
// 被阻断的新提交不改写关联（rework-2 F1），在途期间编辑出的新内容不被迟到的成功回执清空
//（A→B→A 修订序列同样保留）。
// V6 BATCH_2 rework-1：消息的未确认请求恢复行独立于说明通道（互不误清），且不依赖
// 面板折叠状态（折叠时仍可见）；恢复受限（记录损坏/旧版哨兵）只提示 + 显式清除。
// V6 rework-2：确认成功后同步清理旧内联错误/冲突提示（不残留"内容已保留"式过时反馈）。
// 聊天不能解除红线：待复核等状态只随服务端数据变化，聊天仅留档沟通。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OverviewMessage } from '../../lib/v5-preview/shared-types';
import {
  formatMessageTime,
  fromKindLabel,
  pendingRequestRowText,
  recoveryLimitedNotice,
  recoveryResolveLabel,
  shouldClearDraftForRequest,
  type DraftRequestAssociation,
  type MessageRecoverySlot,
  type ResolveOutcome,
  type SubmitOutcome,
} from './rows-logic';
import styles from './preview.module.css';

interface ChatPanelProps {
  messages: OverviewMessage[];
  onSendMessage: (text: string) => Promise<SubmitOutcome>;
  /** R1/R2：未确认消息请求的恢复槽位（完整原载荷记录 / 恢复受限）。 */
  pendingMessage: MessageRecoverySlot;
  onResolvePendingMessage: () => Promise<ResolveOutcome>;
  /** 恢复受限提示的显式清除。 */
  onDismissPendingMessage: () => void;
  /** 确认动作进行中：禁用按钮。 */
  resolvingPending: boolean;
  /** 恢复记录无法写入 sessionStorage：如实提示。 */
  recoveryPersistFailed: boolean;
}

function kindClass(kind: OverviewMessage['fromKind']): string {
  if (kind === 'business') return styles.kindBusiness;
  if (kind === 'domain') return styles.kindDomain;
  return styles.kindSystem;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  pendingMessage,
  onResolvePendingMessage,
  onDismissPendingMessage,
  resolvingPending,
  recoveryPersistFailed,
}: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [editKept, setEditKept] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  // R3/F1：输入修订标识——每次编辑自增；请求真正发出时冻结 {requestId, 修订} 关联。
  const inputRevisionRef = useRef(0);
  const draftAssocRef = useRef<DraftRequestAssociation | null>(null);

  // 清空输入的唯一出口；仅在草稿-请求关联判定通过后调用。
  // 同时清理旧内联反馈：输入已清空时不得残留"内容已保留/请先确认"式过时提示（F2 一致性）。
  function clearInput() {
    setInput('');
    setEditKept(false);
    setError(null);
    setConflictHint(null);
  }

  /** F1：确认成功的输入处置——只有当确认的 requestId 与"发送时关联"一致、
   *  且输入修订自该请求发送以来未变时才清空；被阻断的新草稿永远不能被旧请求的确认清空。 */
  function handleResolveSuccess(outcome: ResolveOutcome) {
    if (outcome.result !== 'ok') return;
    if (shouldClearDraftForRequest(draftAssocRef.current, outcome.requestId, inputRevisionRef.current)) {
      clearInput();
    } else {
      // 未清空（保留的是未随请求发送的新草稿）：旧请求已确认，同步撤下过时的阻断/失败提示。
      setError(null);
      setConflictHint(null);
    }
  }

  // 新消息到达时滚动到底部（reduced-motion 下无动画，直接定位）。
  useEffect(() => {
    const list = listRef.current;
    if (open && list !== null) list.scrollTop = list.scrollHeight;
  }, [open, messages.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (busy || text === '') return;
    setBusy(true);
    setError(null);
    setConflictHint(null);
    const revisionAtSubmit = inputRevisionRef.current;
    const result = await onSendMessage(text);
    setBusy(false);
    // F1：只有请求真正发出（结果携带 requestId）才建立/更新"草稿-请求关联"；
    // 被阻断的新提交（PENDING_REQUEST_EXISTS，无 requestId）不得改写旧请求的关联。
    if (result.requestId !== undefined) {
      draftAssocRef.current = { requestId: result.requestId, revision: revisionAtSubmit };
    }
    if (result.outcome === 'ok') {
      // 成功后撤下旧错误（无论是否清空输入）：旧的"内容已保留/请先确认"不再适用。
      setError(null);
      setConflictHint(null);
      // R3/F1：仅当输入仍是本次请求发送时的修订才清空；在途编辑出的新内容保留并如实提示。
      if (shouldClearDraftForRequest(draftAssocRef.current, result.requestId, inputRevisionRef.current)) {
        clearInput();
      } else {
        setEditKept(true);
      }
      return;
    }
    if (result.outcome === 'conflict') {
      // 409：输入保留；页面级横幅全局告知，输入行旁内联提示就近告知"可直接再次发送"。
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次发送`);
      return;
    }
    setError(result.message); // 文案已在 page 层统一映射为中文（CP2-4）
  }

  return (
    <section className={styles.chatPanel} aria-label="项目沟通">
      <button
        type="button"
        className={styles.chatToggle}
        aria-expanded={open}
        aria-controls="v5-rows-chat-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.chatToggleTitle}>项目沟通</span>
        <span className={styles.chatToggleSub}>业务与风控共同跟进 · {messages.length} 条（合成）</span>
        <span className={styles.chatToggleHint}>{open ? '收起' : '展开'}</span>
      </button>
      {/* R2：消息恢复行在折叠区之外——面板收起时仍可达，且与说明通道互相独立。 */}
      {pendingMessage !== null ? (
        <PendingMessageRow
          slot={pendingMessage}
          resolving={resolvingPending}
          persistFailed={recoveryPersistFailed}
          onResolve={onResolvePendingMessage}
          onDismiss={onDismissPendingMessage}
          onResolveSuccess={handleResolveSuccess}
        />
      ) : null}
      {open ? (
        <div id="v5-rows-chat-body" className={styles.chatBody}>
          <ol className={styles.msgList} ref={listRef} role="log" tabIndex={0} aria-label="项目沟通消息列表">
            {messages.map((m) => (
              <li key={m.id} className={styles.msgItem}>
                <div className={styles.msgHead}>
                  <span className={styles.msgWho}>{m.fromName}</span>
                  <span className={`${styles.msgKind} ${kindClass(m.fromKind)}`}>{fromKindLabel(m.fromKind)}</span>
                  {m.marks.map((mark) => (
                    <em key={mark} className={styles.mark}>{mark}</em>
                  ))}
                  <time className={styles.msgTime} dateTime={m.at}>{formatMessageTime(m.at)}</time>
                </div>
                <p className={styles.msgText}>{m.text}</p>
              </li>
            ))}
          </ol>
          <form className={styles.chatForm} onSubmit={handleSubmit}>
            <label className={styles.fieldLabel} htmlFor="v5-rows-chat-input">
              发送项目沟通（合成演示）
            </label>
            <div className={styles.chatFormRow}>
              <input
                id="v5-rows-chat-input"
                className={styles.chatInput}
                value={input}
                maxLength={2000}
                placeholder="向项目各专业域留言（合成演示）。"
                onChange={(e) => {
                  setInput(e.target.value);
                  inputRevisionRef.current += 1;
                }}
              />
              <button type="submit" className={styles.primaryBtn} disabled={busy || input.trim() === ''}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
            {error !== null ? <p className={styles.formError} role="alert">发送失败：{error}（内容已保留，可重试）</p> : null}
            {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
            {editKept ? (
              <p className={styles.formConflict} role="status">
                消息已发送；输入框保留的是发送之后的新内容，未随本次发送（合成演示）。
              </p>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}

/** 未确认消息请求恢复行（R1/R2）：有效记录 → 按完整原载荷重放确认；恢复受限 → 提示 + 显式清除。 */
function PendingMessageRow({
  slot,
  resolving,
  persistFailed,
  onResolve,
  onDismiss,
  onResolveSuccess,
}: {
  slot: Exclude<MessageRecoverySlot, null>;
  resolving: boolean;
  persistFailed: boolean;
  onResolve: () => Promise<ResolveOutcome>;
  onDismiss: () => void;
  onResolveSuccess: (outcome: ResolveOutcome) => void;
}) {
  const [resolveFailed, setResolveFailed] = useState(false);

  if (slot.status === 'limited') {
    return (
      <div className={styles.pendingRequestRow} role="status">
        <span>{recoveryLimitedNotice('message', slot.reason)}</span>
        <button type="button" className={styles.secondaryBtn} onClick={onDismiss}>
          清除该提示
        </button>
      </div>
    );
  }

  async function handleResolve() {
    setResolveFailed(false);
    const outcome = await onResolve();
    if (outcome.result === 'ok') {
      // 确认成功：输入按"草稿-请求关联"处置（面板内部判定）。
      onResolveSuccess(outcome);
    } else if (outcome.result === 'failed') {
      setResolveFailed(true);
    } else {
      // stale：陈旧确认（请求已作废/取代）静默——不产生新反馈、不改写关联。
    }
  }

  return (
    <div className={styles.pendingRequestRow} role="status">
      <span>
        {pendingRequestRowText('message')}
        {persistFailed ? '（浏览器存储不可用：本页刷新后可能无法恢复该请求信息）' : ''}
      </span>
      {resolveFailed ? <span className={styles.pendingRowHint}>确认未完成：请稍后再次尝试（该请求已保留）。</span> : null}
      <button type="button" className={styles.secondaryBtn} disabled={resolving} onClick={() => void handleResolve()}>
        {resolving ? '确认中…' : recoveryResolveLabel('message')}
      </button>
    </div>
  );
}
