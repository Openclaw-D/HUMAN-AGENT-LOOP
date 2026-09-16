"use client";

// V5 PREVIEW · 聊天面板（合成预览）：@域选择、人/Agent 身份标识、模拟回复与模拟人接手。
// 不接真实模型、不伪造真人在线；所有回复明确标记【模拟回复】。
import { useState, type FormEvent } from 'react';
import styles from './preview.module.css';
import { DOMAIN_NAMES, ROLE_LABELS, WORK_STATE_LABELS, usePreview, type RoleKey } from './preview-state';

const CHAT_TARGETS: Array<{ key: 'all' | RoleKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'business', label: '@业务' },
  { key: 'policy', label: '@政策' },
  { key: 'credit', label: '@信审' },
  { key: 'commerce', label: '@商务' },
  { key: 'asset', label: '@资产' },
];

export default function ChatPanel({ defaultOpen = true, collapsible = true }: { defaultOpen?: boolean; collapsible?: boolean }) {
  const { state, sendChatMessage, dispatch } = usePreview();
  const [open, setOpen] = useState(defaultOpen);
  const [target, setTarget] = useState<'all' | RoleKey>('all');
  const [text, setText] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === '') return;
    sendChatMessage(text, target);
    setText('');
  }

  const lastNeedsHuman = [...state.messages].reverse().find((m) => m.marks.includes('模拟回复') && m.text.includes('模拟提示'));

  return (
    <section className={styles.chatPanel} aria-label="协作聊天（合成预览）">
      <div className={styles.chatHead}>
        <h3>协作聊天</h3>
        {collapsible ? (
          <button type="button" className={styles.ghostBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '收起' : '展开'}
          </button>
        ) : null}
      </div>
      {open ? (
        <>
          <p className={styles.chatNote}>
            合成预览：Agent 回复为<b>模拟回复</b>，不接真实模型；需人接手时使用「模拟人接手」，不代表真人在线。
          </p>
          <ul className={styles.chatList}>
            {state.messages.map((m) => (
              <li key={m.id} className={m.fromKind === 'system' ? styles.chatItemSystem : styles.chatItem}>
                <span className={styles.chatMeta}>
                  {m.fromKind === 'human' ? <b className={styles.chatHumanTag}>人</b> : null}
                  {m.fromKind === 'agent' ? <b className={styles.chatAgentTag}>Agent·模拟</b> : null}
                  <span>{m.fromName}</span>
                  {m.to !== 'all' ? <span className={styles.chatTo}>→ {ROLE_LABELS[m.to]}</span> : null}
                  {m.marks.map((mk) => (
                    <em key={mk} className={styles.chatMark}>[{mk}]</em>
                  ))}
                </span>
                <span className={styles.chatText}>{m.text}</span>
                {lastNeedsHuman !== undefined && m.id === lastNeedsHuman.id ? (
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => dispatch({ type: 'chat-human-takeover', text: `（模拟人接手·${ROLE_LABELS[state.role]}视角演示）该点由人工确认后继续。` })}
                  >
                    模拟人接手（以当前视角具名发言）
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <form className={styles.chatForm} onSubmit={handleSubmit}>
            <label className={styles.chatTargetLabel}>
              发送到
              <select value={target} onChange={(e) => setTarget(e.target.value as 'all' | RoleKey)}>
                {CHAT_TARGETS.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.chatInputLabel}>
              消息
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={target === 'all' ? '输入消息（合成预览）' : `输入发给${target === 'business' ? '业务' : DOMAIN_NAMES[target]}的消息`}
              />
            </label>
            <button type="submit" className={styles.primaryBtn} disabled={text.trim() === ''}>
              发送
            </button>
          </form>
          <p className={styles.chatFootnote}>
            状态词说明：{Object.values(WORK_STATE_LABELS).join(' / ')}——均为演示口径，不构成制度。
          </p>
        </>
      ) : (
        <p className={styles.chatCollapsedNote}>聊天已收起（详情页不强制固定聊天区）。</p>
      )}
    </section>
  );
}
