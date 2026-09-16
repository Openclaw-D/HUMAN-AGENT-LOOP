'use client';

import { type FormEvent, useEffect, useState } from 'react';

import {
  V3_COLLABORATION_CASE_ID,
  createV3CollaborationClient,
  type V3CollaborationReadyDto,
} from '../../lib/v3-collaboration-client';
import { JwIcon, VinextSafeAnchor } from '../jw-front';
import styles from './collaboration-shell.module.css';

type LoadState = 'loading' | 'ready' | 'error';
type ViewMode = 'relationship' | 'progress' | 'matrix';
type PendingMessageIntent = {
  message: string;
  requestId: string;
};

const COLLABORATION_STEPS = [
  ['01', '识别偏差'],
  ['02', '组织协同'],
  ['03', '专业判断'],
  ['04', '形成回执'],
] as const;

const VIEW_MODES: ReadonlyArray<{
  id: ViewMode;
  label: string;
  description: string;
  icon: string;
}> = [
  { id: 'relationship', label: '关系', description: '主体、工作项与 Gate 关系', icon: 'route' },
  { id: 'progress', label: '进度', description: '补证、回退与人工等待', icon: 'schedule' },
  { id: 'matrix', label: '矩阵', description: '责任主体 × 场景任务', icon: 'strategy' },
];

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '已排队',
  running: '处理中',
  partial: '部分完成',
  needs_input: '待补充',
  ready_for_gate: '待 Gate',
  completed: '已完成',
  failed: '失败',
  not_started: '未开始',
};

const BLOCKER_STATUS_LABELS: Record<string, string> = {
  'needs-evidence': '待补证',
  'in-preparation': '准备中',
  waiting: '等待中',
};

const collaborationClient = createV3CollaborationClient();

function ModeEmpty({ children }: { children: React.ReactNode }) {
  return <div className={styles.emptyState}><JwIcon name="database" size={24} /><p>{children}</p></div>;
}

function createMessageRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前环境无法生成唯一消息标识');
  }
  return `collaboration-${globalThis.crypto.randomUUID()}`;
}

export default function CollaborationShell() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [ready, setReady] = useState<V3CollaborationReadyDto | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeMode, setActiveMode] = useState<ViewMode>('relationship');
  const [message, setMessage] = useState('');
  const [pendingMessageIntent, setPendingMessageIntent] = useState<PendingMessageIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    void collaborationClient.initialize(controller.signal)
      .then((projection) => {
        setReady(projection);
        setLoadState('ready');
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setReady(null);
        setLoadState('error');
        setLoadError(caught instanceof Error ? caught.message : '协同投影载入失败');
      });

    return () => controller.abort();
  }, [loadAttempt]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy || !ready?.creditFlowAvailable) return;

    const controller = new AbortController();
    setBusy(true);
    setSendError('');
    try {
      const intent = pendingMessageIntent?.message === text
        ? pendingMessageIntent
        : { message: text, requestId: createMessageRequestId() };
      setPendingMessageIntent(intent);
      const next = await collaborationClient.sendMessage({
        sessionId: ready.sessionId,
        requestId: intent.requestId,
        message: text,
        signal: controller.signal,
      });
      setReady(next);
      setMessage('');
      setPendingMessageIntent(null);
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  }

  function changeMessage(nextMessage: string) {
    const normalizedIntent = nextMessage.trim();
    setMessage(nextMessage);
    setSendError('');
    setPendingMessageIntent((current) => (
      current && current.message !== normalizedIntent ? null : current
    ));
  }

  const contextLabel = loadState === 'loading'
    ? '载入中'
    : ready?.contextVersion ?? '投影不可用';

  return (
    <main className={styles.page} data-load-state={loadState}>
      <header className={styles.topShell}>
        <div className={styles.masthead}>
          <VinextSafeAnchor href="/" className={styles.brand} aria-label="返回见微总入口">见微</VinextSafeAnchor>
          <div className={styles.pageIdentity}>
            <strong>协同驾驶舱</strong>
            <small>当前项目 · {V3_COLLABORATION_CASE_ID}</small>
          </div>
          <div className={styles.objective}>
            <span>CURRENT OBJECTIVE</span>
            <h1>{ready?.objective.title ?? (loadState === 'loading' ? '正在载入当前协同目标' : '当前协同目标不可用')}</h1>
            {ready?.objective.description ? <small>{ready.objective.description}</small> : null}
          </div>
          <div className={styles.contextBadge} aria-live="polite">
            <span>共享上下文</span>
            <strong>{contextLabel}</strong>
          </div>
        </div>

        <div className={styles.guideFlow} aria-label="当前协同推进路径">
          {COLLABORATION_STEPS.map(([number, title], index) => (
            <div key={number} className={index === 1 ? styles.currentStep : undefined}>
              <span>{number}</span>
              <strong>{title}</strong>
            </div>
          ))}
          <p><JwIcon name="permission" size={14} />协同不替代专业判断</p>
        </div>
      </header>

      <div className={styles.workArea}>
        <section className={styles.dashboard} aria-labelledby="dashboard-title">
          <header className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>MAIN ARCHITECTURE · 当前项目</span>
              <h2 id="dashboard-title">经营协同主视图</h2>
            </div>
            <nav className={styles.modeSwitch} aria-label="协同主视图模式">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  data-view-mode={mode.id}
                  className={activeMode === mode.id ? styles.activeMode : undefined}
                  aria-pressed={activeMode === mode.id}
                  onClick={() => setActiveMode(mode.id)}
                >
                  <JwIcon name={mode.icon} size={18} />
                  <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
                </button>
              ))}
            </nav>
          </header>

          <div className={styles.modeContent} data-active-mode={activeMode}>
            {loadState === 'loading' ? (
              <div className={`${styles.statePanel} ${styles.loadingState}`} aria-live="polite">
                <i />
                <h3>正在载入协同 Projection</h3>
                <p>关系、进度与矩阵均以 adapter read model 为准。</p>
              </div>
            ) : loadState === 'error' ? (
              <div className={`${styles.statePanel} ${styles.errorState}`} role="alert">
                <JwIcon name="x" size={28} />
                <h3>当前协同视图不可用</h3>
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoadState('loading');
                    setLoadError('');
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                >
                  重试载入
                </button>
              </div>
            ) : activeMode === 'relationship' ? (
              <section className={styles.relationshipPanel} aria-label="协同关系视图">
                <header className={styles.contentHeading}>
                  <div><span>RELATIONSHIP VIEW</span><h3>当前目标与五路工作项的协同关系</h3></div>
                  <p>只呈现 Projection 已提供的主体与工作项；缺失的 Agent、Gate 或 Receipt 关系不补造。</p>
                </header>
                {ready?.workItems.length ? (
                  <div className={styles.relationshipMap}>
                    <article className={styles.objectiveNode}>
                      <span>共同目标</span>
                      <strong>{ready.objective.title}</strong>
                      <p>{ready.objective.description}</p>
                    </article>
                    <div className={styles.relationshipNodes}>
                      {ready.workItems.map((item) => (
                        <article key={item.processId}>
                          <span>{item.label}</span>
                          <strong>{item.task}</strong>
                          <small>{RUN_STATUS_LABELS[item.runStatus] ?? item.runStatus}</small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : <ModeEmpty>当前 Projection 尚无可呈现的主体与工作项关系。</ModeEmpty>}
              </section>
            ) : activeMode === 'progress' ? (
              <section className={styles.progressPanel} aria-label="非线性协同进度">
                <header className={styles.contentHeading}>
                  <div><span>NON-LINEAR PROGRESS</span><h3>{ready?.objective.title ?? '当前项目协同进度'}</h3></div>
                  <p>进度表达补证、准备、等待与 Gate，不压缩成单一百分比。</p>
                </header>
                {ready?.blockers.length ? (
                  <ol className={styles.blockerList}>
                    {ready.blockers.map((blocker, index) => (
                      <li key={blocker.blockerId}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div><strong>{blocker.title}</strong><p>{blocker.detail}</p></div>
                        <em>{BLOCKER_STATUS_LABELS[blocker.status] ?? blocker.status}</em>
                      </li>
                    ))}
                  </ol>
                ) : <ModeEmpty>当前 Projection 尚无需要上浮的项目阻断。</ModeEmpty>}
              </section>
            ) : (
              <section className={styles.matrixPanel} aria-label="责任主体与场景任务矩阵">
                <header className={styles.contentHeading}>
                  <div><span>SPARSE RESPONSIBILITY MATRIX</span><h3>责任主体 × 当前场景任务</h3></div>
                  <p>矩阵按 Projection 稀疏呈现；没有返回的数据明确标记为“— / 未提供”。</p>
                </header>
                {ready?.workItems.length ? (
                  <div className={styles.matrixWrap}>
                    <table>
                      <thead><tr><th>责任主体</th><th>当前场景任务</th><th>运行状态</th><th>Gate 状态</th><th>Receipt</th></tr></thead>
                      <tbody>
                        {ready.workItems.map((item) => (
                          <tr key={item.processId}>
                            <th scope="row">{item.label}</th>
                            <td>{item.task || '— / 未提供'}</td>
                            <td>{RUN_STATUS_LABELS[item.runStatus] ?? item.runStatus}</td>
                            <td>{item.gateState || '— / 未提供'}</td>
                            <td>— / 未提供</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <ModeEmpty>当前 Projection 尚无责任主体与场景任务数据。</ModeEmpty>}
              </section>
            )}
          </div>
        </section>

        <aside className={styles.chat} aria-labelledby="chat-title">
          <header className={styles.chatHead}>
            <div><span className={styles.eyebrow}>CURRENT PROJECT GROUP</span><h2 id="chat-title">当前项目群聊</h2></div>
            <span className={styles.memberCount}>{ready ? `${ready.memberCount} 人` : '—'}</span>
            <p>{ready?.thread.title ?? '当前 Case 的项目级沟通空间'}</p>
          </header>

          <div className={styles.memberRow} aria-label="当前协同成员">
            {ready?.thread.members.length
              ? ready.thread.members.map((member) => <span key={member.principalId}>{member.label}</span>)
              : <small>成员随 Projection 载入</small>}
          </div>

          <div className={styles.chatLog} aria-live="polite">
            {loadState === 'loading' ? <p className={styles.chatState}>正在载入项目群聊…</p> : null}
            {loadState === 'error' ? <p className={styles.chatState}>投影不可用，群聊已 fail closed。</p> : null}
            {loadState === 'ready' && !ready?.thread.entries.length
              ? <p className={`${styles.chatState} ${styles.emptyState}`}>当前 Thread 尚无消息。</p>
              : null}
            {ready?.thread.entries.map((entry) => (
              <article
                key={entry.entryId}
                className={`${styles.message} ${entry.kind === 'human-message' ? styles.mine : ''}`}
                data-authority={entry.authority}
              >
                <b>{entry.actorLabel}</b>
                <p>{entry.text}</p>
                <small>{entry.contextVersion}</small>
              </article>
            ))}
          </div>

          <p className={styles.authorityNote}>
            协同不替代专业判断；消息不产生 Gate/Receipt/confirmed state。
          </p>

          <form className={styles.chatForm} onSubmit={send}>
            <textarea
              value={message}
              onChange={(event) => changeMessage(event.target.value)}
              aria-label="项目群聊消息"
              placeholder="向当前项目群聊发送协同问题…"
              maxLength={600}
              disabled={loadState !== 'ready' || busy || !ready?.creditFlowAvailable}
            />
            <button type="submit" disabled={!message.trim() || busy || !ready?.creditFlowAvailable}>
              {busy ? '发送中' : '发送'}
            </button>
          </form>
          {sendError ? <p className={styles.chatError} role="alert">{sendError}</p> : null}
        </aside>
      </div>
    </main>
  );
}
