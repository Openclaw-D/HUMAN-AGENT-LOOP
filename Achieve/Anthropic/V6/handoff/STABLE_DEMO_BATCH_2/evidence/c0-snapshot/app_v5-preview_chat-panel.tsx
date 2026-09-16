// V5 ROWS · "项目沟通"轻量可展开面板：消息列表（fromKind 区分 + marks 标签）+ 输入框
// → POST /api/v5-preview/messages。409 冲突/网络错误保留输入内容；只有成功才清空。
// 聊天不能解除红线：待复核等状态只随服务端数据变化，聊天仅留档沟通。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OverviewMessage } from '../../lib/v5-preview/shared-types';
import { formatMessageTime, fromKindLabel, type SubmitOutcome } from './rows-logic';
import styles from './preview.module.css';

interface ChatPanelProps {
  messages: OverviewMessage[];
  onSendMessage: (text: string) => Promise<SubmitOutcome>;
}

function kindClass(kind: OverviewMessage['fromKind']): string {
  if (kind === 'business') return styles.kindBusiness;
  if (kind === 'domain') return styles.kindDomain;
  return styles.kindSystem;
}

export default function ChatPanel({ messages, onSendMessage }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

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
    const result = await onSendMessage(text);
    setBusy(false);
    if (result.outcome === 'ok') {
      setInput('');
      return;
    }
    if (result.outcome === 'conflict') {
      // 409：输入保留；页面级横幅全局告知，输入行旁内联提示就近告知"可直接再次发送"。
      setConflictHint(`版本已更新至 v${result.toVersion}，可直接再次发送`);
      return;
    }
    setError(result.message);
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
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className={styles.primaryBtn} disabled={busy || input.trim() === ''}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
            {error !== null ? <p className={styles.formError} role="alert">发送失败：{error}（内容已保留，可重试）</p> : null}
            {conflictHint !== null ? <p className={styles.formConflict} role="status">{conflictHint}</p> : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
