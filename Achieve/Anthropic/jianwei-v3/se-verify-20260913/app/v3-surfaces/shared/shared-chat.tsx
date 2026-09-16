'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  V3ContextReadModel,
  V3ContextSelector,
  V3PersistedMessage,
  V3RoleProjectionId,
  V3SendMessageResult,
} from '../../../lib/v3-surfaces/shared/contracts';
import styles from './shared-chat.module.css';

type SharedReceipt = {
  receiptId: string;
  status: string;
  authority: 'none' | 'confirmed_human';
  formal: boolean;
  createdAt: string;
};

type SharedChatSnapshot = {
  runtimeEpoch: string;
  context: V3ContextReadModel;
  messages: V3PersistedMessage[];
  candidates: V3PersistedMessage[];
  receipts: SharedReceipt[];
  provenance: { source: 'shared-v3-sqlite'; dataClass: string; asOf: string | null };
};

type PendingIntent = { requestId: string; text: string; originalMessageId: string | null };

const GOLDEN_CONTEXT: V3ContextSelector = {
  grain: 'case',
  portfolioId: 'PORTFOLIO-JW-DEMO',
  divisionId: 'DIV-EAST',
  caseId: 'FL-DEMO-001',
};

function query(role: V3RoleProjectionId, context: V3ContextSelector) {
  const params = new URLSearchParams({
    role,
    grain: context.grain,
    portfolioId: context.portfolioId,
  });
  if (context.divisionId) params.set('divisionId', context.divisionId);
  if (context.caseId) params.set('caseId', context.caseId);
  return params.toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Shared chat HTTP ${response.status}`);
  return body;
}

async function readSnapshot(role: V3RoleProjectionId, context: V3ContextSelector, signal?: AbortSignal) {
  return parseResponse<SharedChatSnapshot>(await fetch(`/api/v3/shared/messages?${query(role, context)}`, {
    cache: 'no-store', signal,
  }));
}

export function SharedChatPanel({
  actorRole,
  context = GOLDEN_CONTEXT,
  onContext,
}: {
  actorRole: V3RoleProjectionId;
  context?: V3ContextSelector;
  onContext?: (snapshot: SharedChatSnapshot) => void;
}) {
  const [snapshot, setSnapshot] = useState<SharedChatSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [routeResult, setRouteResult] = useState<V3SendMessageResult | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await readSnapshot(actorRole, context, signal);
    setSnapshot(next);
    setStatus('ready');
    onContext?.(next);
  }, [actorRole, context, onContext]);

  useEffect(() => {
    const controller = new AbortController();
    void readSnapshot(actorRole, context, controller.signal)
      .then((next) => { setSnapshot(next); setStatus('ready'); onContext?.(next); })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setSnapshot(null); setStatus('error');
        setError(caught instanceof Error ? caught.message : '共享群聊载入失败');
      });
    return () => controller.abort();
  }, [actorRole, context, onContext, attempt]);

  const retryable = routeResult?.routes.some((route) => route.retryable) ?? false;
  const timeline = useMemo(() => snapshot?.messages ?? [], [snapshot]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status === 'loading') return;
    const intent = pending?.text === text
      ? pending
      : { requestId: `v3-chat-${globalThis.crypto.randomUUID()}`, text, originalMessageId: null };
    setPending(intent);
    setStatus('loading');
    setError('');
    try {
      const result = await parseResponse<V3SendMessageResult>(await fetch('/api/v3/shared/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: intent.requestId, actorRole, context, text }),
      }));
      setRouteResult(result);
      setPending({ ...intent, originalMessageId: result.message.messageId });
      await load();
      setDraft('');
      if (!result.routes.some((route) => route.retryable)) setPending(null);
    } catch (caught) {
      setStatus('ready');
      setError(caught instanceof Error ? caught.message : '发送失败；相同 request id 可安全重试');
    }
  }

  async function retryCandidate() {
    if (!pending?.originalMessageId) return;
    setStatus('loading');
    setError('');
    const retryRequestId = `${pending.requestId}-retry`;
    try {
      const result = await parseResponse<V3SendMessageResult>(await fetch('/api/v3/shared/messages/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: retryRequestId, actorRole, originalMessageId: pending.originalMessageId }),
      }));
      setRouteResult(result);
      await load();
      if (!result.routes.some((route) => route.retryable)) setPending(null);
    } catch (caught) {
      setStatus('ready');
      setError(caught instanceof Error ? caught.message : '候选重试失败');
    }
  }

  return (
    <section className={styles.chat} aria-label="当前上下文群聊" data-chat-source="shared-v3-sqlite">
      <header>
        <div><span>CURRENT CONTEXT CHAT</span><h2>当前上下文群聊</h2></div>
        <em>{snapshot?.context.contextVersion ?? (status === 'loading' ? '载入中' : '未提供')}</em>
        <p>{snapshot?.context.label ?? 'FL-DEMO-001'}</p>
      </header>
      <div className={styles.provenance}>
        <b>{snapshot?.provenance.source ?? 'shared-v3-sqlite'}</b>
        <span>{snapshot?.receipts.length ?? 0} receipts · formal {snapshot?.receipts.filter((receipt) => receipt.formal).length ?? 0} · asOf {snapshot?.provenance.asOf ?? '未提供'}</span>
      </div>
      <div className={styles.log} aria-live="polite">
        {status === 'loading' && !snapshot ? <p className={styles.state}>正在载入 shared context…</p> : null}
        {status === 'error' ? <div className={styles.state} role="alert"><p>{error || '群聊 fail closed'}</p><button type="button" onClick={() => { setStatus('loading'); setError(''); setAttempt((value) => value + 1); }}>重试载入</button></div> : null}
        {status !== 'error' && timeline.length === 0 ? <p className={styles.state}>当前没有消息；缺失按“未提供”处理。</p> : null}
        {timeline.map((message) => (
          <article
            key={message.messageId}
            data-actor-kind={message.actorKind}
            data-authority={message.authority}
            data-message-id={message.messageId}
            data-request-id={message.requestId}
          >
            <b>{message.actorKind === 'agent' ? `${message.actorRole} Agent` : message.actorRole}</b>
            <p>{message.text}</p>
            <small>{message.actorKind === 'agent' ? 'candidate · authority none' : 'human message · authority none'} · {message.createdAt}</small>
          </article>
        ))}
      </div>
      <p className={styles.boundary}>AI reply 仅是 candidate / authority none；消息 Receipt 非正式，不形成 Human Gate。</p>
      <form onSubmit={submit}>
        <label htmlFor={`shared-chat-${actorRole}`}>群聊消息</label>
        <textarea
          id={`shared-chat-${actorRole}`}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(''); if (pending?.text !== event.target.value.trim()) setPending(null); }}
          placeholder="输入消息；可 @JW、@政策、@信审、@商务、@资产"
          maxLength={600}
          disabled={status === 'loading'}
          rows={3}
        />
        <div>
          <small>{error || (routeResult?.replayed ? 'idempotent replay · 未重复写入' : 'local shared SQLite · 不外发')}</small>
          {retryable ? <button type="button" onClick={() => void retryCandidate()} disabled={status === 'loading'}>重试 candidate</button> : null}
          <button type="submit" disabled={!draft.trim() || status === 'loading'}>{status === 'loading' && draft ? '发送中' : '发送'}</button>
        </div>
      </form>
    </section>
  );
}

export type { SharedChatSnapshot };
