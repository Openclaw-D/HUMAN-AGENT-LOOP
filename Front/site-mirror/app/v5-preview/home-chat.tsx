// B 候选 · 项目沟通（R-03）：消息压成 1–2 句视觉高度（A 供给 summary 时显示摘要+"原文"展开；
// 无摘要时正文至多两行折叠、完整原文恒可展开——DOM 不删字，不改变风险含义）。
// 来源精确标注：人工 / 模型（演示）/ 预设——origin 由 A 供给；缺省保守推导
//（business→人工，system→预设，domain→预设），绝不把预设标成真实模型。
// 输入+发送常驻底部；409 冲突/网络错误保留输入；草稿-请求关联判定复用 site rows-logic。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OverviewMessage } from '../../lib/v5-preview/shared-types';
import {
  formatMessageTime,
  pendingRequestRowText,
  recoveryLimitedNotice,
  recoveryResolveLabel,
  shouldClearDraftForRequest,
  type DraftRequestAssociation,
  type MessageRecoverySlot,
  type ResolveOutcome,
  type SubmitOutcome,
} from './rows-logic';
import { ChevronSmallIcon } from './home-icons';
import type { HomeMessage, MessageOrigin } from './home-contract';
import { VideoIcon } from './se-icons';
import styles from './home-overview.module.css';

/** 来源标注（缺省保守推导；"模型（演示）"仅在 A 明确 origin='model' 时出现）。 */
export function originLabel(m: HomeMessage): { text: string; kind: MessageOrigin } {
  const origin = m.origin ?? (m.fromKind === 'business' ? 'human' : 'preset');
  if (origin === 'human') return { text: '人工', kind: 'human' };
  if (origin === 'model') return { text: '模型（演示）', kind: 'model' };
  return { text: '预设', kind: 'preset' };
}

function mergeExtras(messages: readonly OverviewMessage[], extras: HomeOverviewExtras): HomeMessage[] {
  return messages.map((m) => {
    const extra = extras[m.id];
    return extra === undefined ? (m as HomeMessage) : { ...m, origin: extra.origin, summary: extra.summary };
  });
}

type HomeOverviewExtras = NonNullable<import('./home-contract').HomeOverviewProps['messageExtras']>;

export function HomeChat({
  messages,
  messageExtras,
  onSendMessage,
  pendingMessage,
  onResolvePendingMessage,
  onDismissPendingMessage,
  resolvingPending,
  recoveryPersistFailed,
  remoteHref,
  inputPlaceholder,
}: {
  messages: readonly OverviewMessage[];
  messageExtras?: HomeOverviewExtras;
  onSendMessage: (text: string) => Promise<SubmitOutcome>;
  pendingMessage: MessageRecoverySlot;
  onResolvePendingMessage: () => Promise<ResolveOutcome>;
  onDismissPendingMessage: () => void;
  resolvingPending: boolean;
  recoveryPersistFailed: boolean;
  remoteHref?: string;
  /** F 轮：随所选角色变化的输入提示（只改提示文案，不改变消息归属逻辑）。 */
  inputPlaceholder?: string;
}) {
  // R1：沟通/待办由下半底部页签切换，面板内不再提供折叠开关（旧 chat-open 持久化删除）。
  const [input, setInput] = useState(() => {
    try { return window.sessionStorage.getItem('jw:v5-preview:draft:chat') ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const inputRevisionRef = useRef(0);
  const draftAssocRef = useRef<DraftRequestAssociation | null>(null);

  const homeMessages = mergeExtras(messages, messageExtras ?? {});

  function clearInput() {
    setInput('');
    try { window.sessionStorage.removeItem('jw:v5-preview:draft:chat'); } catch { /* 忽略 */ }
    setError(null);
    setConflictHint(null);
  }

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

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
    if (result.requestId !== undefined) {
      draftAssocRef.current = { requestId: result.requestId, revision: revisionAtSubmit };
    }
    if (result.outcome === 'ok') {
      setError(null);
      setConflictHint(null);
      if (shouldClearDraftForRequest(draftAssocRef.current, result.requestId, inputRevisionRef.current)) {
        clearInput();
      }
      return;
    }
    if (result.outcome === 'conflict') {
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次发送`);
      return;
    }
    setError(result.message);
  }

  return (
    <section className={styles.chatSection} aria-label="项目沟通">
      <div className={styles.chatToolbar}>
        <span className={styles.chatToggleCount}>业务与风控共同跟进 · {messages.length} 条（合成）</span>
        {remoteHref !== undefined ? (
          <a className={styles.remoteLink} href={remoteHref}>
            <VideoIcon size={11} />
            远程尽调访谈
          </a>
        ) : null}
      </div>
      {pendingMessage !== null ? (
        <PendingMessageRow
          slot={pendingMessage}
          resolving={resolvingPending}
          persistFailed={recoveryPersistFailed}
          onResolve={onResolvePendingMessage}
          onDismiss={onDismissPendingMessage}
          onResolveSuccess={(outcome) => {
            if (outcome.result === 'ok' && shouldClearDraftForRequest(draftAssocRef.current, outcome.requestId, inputRevisionRef.current)) {
              clearInput();
            }
          }}
        />
      ) : null}
      <div className={styles.chatBody}>
        <ol className={styles.msgList} ref={listRef} role="log" tabIndex={0} aria-label="项目沟通消息列表">
          {homeMessages.map((m) => (
            <ChatMessageItem key={m.id} message={m} />
          ))}
        </ol>
        <form className={styles.chatForm} onSubmit={handleSubmit}>
          <label className={styles.srOnly} htmlFor="jw-home-chat-input">
            发送项目沟通（合成演示）
          </label>
          <div className={styles.chatFormRow}>
            <input
              id="jw-home-chat-input"
              className={styles.chatInput}
              value={input}
              maxLength={2000}
              placeholder={inputPlaceholder ?? '向项目各专业域留言（合成演示）。'}
              onChange={(e) => {
                setInput(e.target.value);
                inputRevisionRef.current += 1;
                try { window.sessionStorage.setItem('jw:v5-preview:draft:chat', e.target.value); } catch { /* 忽略 */ }
              }}
            />
            <button type="submit" className={styles.btnPrimary} disabled={busy || input.trim() === ''}>
              {busy ? '发送中…' : '发送'}
            </button>
          </div>
          {error !== null ? <p className={styles.formError} role="alert">发送失败：{error}（内容已保留，可重试）</p> : null}
          {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
        </form>
      </div>
    </section>
  );
}

/** 单条消息：头部（姓名+来源标注+marks+时间）+ 精简正文（摘要或两行折叠）+ 原文展开。 */
function ChatMessageItem({ message }: { message: HomeMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const origin = originLabel(message);
  const hasSummary = typeof message.summary === 'string' && message.summary.trim() !== '';

  // 无摘要时检测正文是否超过两行（视觉折叠，DOM 全文保留；摘要模式不检测——摘要+展开即入口）。
  useEffect(() => {
    if (hasSummary) return;
    const el = textRef.current;
    if (el === null) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [hasSummary, message.text]);

  const showToggle = hasSummary || overflowing;

  return (
    <li className={styles.msgItem}>
      <div className={styles.msgHead}>
        <span className={styles.msgWho}>{message.fromName}</span>
        <span className={styles.originBadge} data-origin={origin.kind}>{origin.text}</span>
        {message.marks.map((mark) => (
          <em key={mark} className={styles.mark}>{mark}</em>
        ))}
        <time className={styles.msgTime} dateTime={message.at}>{formatMessageTime(message.at)}</time>
      </div>
      {hasSummary ? (
        <>
          <p className={styles.msgText}>{message.summary}</p>
          {expanded ? <p className={styles.msgOriginal}>{message.text}</p> : null}
        </>
      ) : (
        <p
          ref={textRef}
          className={expanded ? styles.msgText : `${styles.msgText} ${styles.msgClamp}`}
        >
          {message.text}
        </p>
      )}
      {showToggle ? (
        <button
          type="button"
          className={styles.msgToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '原文'}
          <span className={styles.msgToggleChevron} data-open={expanded ? 'true' : 'false'} aria-hidden="true">
            <ChevronSmallIcon size={10} />
          </span>
        </button>
      ) : null}
    </li>
  );
}

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
      <div className={styles.pendingRow} role="status">
        <span>{recoveryLimitedNotice('message', slot.reason)}</span>
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
      // stale：静默。
    }
  }

  return (
    <div className={styles.pendingRow} role="status">
      <span>
        {pendingRequestRowText('message')}
        {persistFailed ? '（浏览器存储不可用：本页刷新后可能无法恢复该请求信息）' : ''}
      </span>
      {resolveFailed ? <span className={styles.pendingRowHint}>确认未完成：请稍后再次尝试（该请求已保留）。</span> : null}
      <button type="button" className={styles.btnSecondary} disabled={resolving} onClick={() => void handleResolve()}>
        {resolving ? '确认中…' : recoveryResolveLabel('message')}
      </button>
    </div>
  );
}
