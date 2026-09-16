'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { JwIcon } from '../../jw-front';
import { SharedSurfaceShell } from '../shared/surface-shell';
import type { SurfaceMode, V3QuarterProgress } from '../shared/surface-model';
import {
  createOpportunityClient,
  type OpportunityReadyDto,
} from './opportunity-client';
import styles from './opportunity-surface.module.css';

type ViewMode = SurfaceMode;
type LoadState = 'loading' | 'ready' | 'error';
type PendingMessageIntent = { message: string; requestId: string };

const MENTION_LABELS = ['@JW', '@政策 Agent', '@信审 Agent', '@商务 Agent', '@资产 Agent'] as const;
const ROLE_LABELS: Record<string, string> = {
  business: '业务',
  policy: '政策',
  credit: '信审',
  commercial: '商务',
  asset: '资产',
};
const opportunityClient = createOpportunityClient();
const EMPTY_PROFESSIONAL_PROGRESS: V3QuarterProgress = {
  policy: null,
  credit: null,
  commercial: null,
  asset: null,
};
const OPPORTUNITY_ROLE_OPTIONS = [{ principalId: 'business-owner', label: '业务', application: 'Case Owner' }] as const;

function makeRequestId(): string {
  return `opportunity-ui-${globalThis.crypto.randomUUID()}`;
}

function display(value: string | null | undefined): string {
  return value?.trim() || '未提供';
}

function isAiActor(actorLabel: string): boolean {
  return /AI|见微|智能/i.test(actorLabel);
}

function LoadingPanel() {
  return <div className={styles.statePanel} aria-live="polite">
    <span className={styles.spinner} aria-hidden="true" />
    <b>正在载入 Opportunity context</b>
    <p>读取商机列表、Golden Case 投影与当前群聊。</p>
  </div>;
}

function RelationshipView({ ready }: { ready: OpportunityReadyDto }) {
  const golden = ready.goldenCase;
  const model = ready.readModel;
  const supplier = model.relationships.nodes.find((node) => node.kind === 'supplier');
  return <section className={styles.relationshipView} aria-labelledby="relationship-title">
    <header className={styles.panelHeading}>
      <div><span>RELATIONSHIP GRAPH</span><h2 id="relationship-title">Opportunity 关系图</h2></div>
      <p>关系为当前 synthetic scenario projection，不是 production fact。</p>
    </header>
    <div className={styles.relationshipCanvas}>
      <svg className={styles.relationshipLines} viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker id="opportunity-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10Z" />
          </marker>
        </defs>
        <line x1="225" y1="170" x2="425" y2="250" />
        <line x1="775" y1="170" x2="575" y2="250" />
        <line x1="500" y1="326" x2="500" y2="410" />
      </svg>
      <article className={`${styles.graphNode} ${styles.customerNode}`}>
        <span>客户 CUSTOMER</span><strong>{display(golden.counterparty)}</strong><small>{display(golden.region)}</small>
      </article>
      <article className={`${styles.graphNode} ${styles.supplierNode}`}>
        <span>供应商 SUPPLIER</span><strong>{display(supplier?.label)}</strong><small>等待合法来源补充</small>
      </article>
      <article className={`${styles.graphNode} ${styles.caseNode}`}>
        <span>GOLDEN CASE · SYNTHETIC</span><strong>{golden.title}</strong><small>{golden.caseId} · {golden.amount}</small>
      </article>
      <article className={`${styles.graphNode} ${styles.actionNode}`}>
        <span>NEXT ACTION</span><strong>{display(golden.nextMilestone)}</strong><small>{display(golden.phase)}</small>
      </article>
    </div>
    <div className={styles.relationshipFacts}>
      <article><span>材料完整度</span><strong>{model.materials.completeness.display}</strong><small>{model.materials.completeness.availability === 'available' ? 'Scenario 粗粒档位' : '不以 0 代替缺失数据'}</small></article>
      <article><span>当前阶段</span><strong>{display(model.stage)}</strong><small>{display(model.materials.items[0]?.detail)}</small></article>
      <article><span>行业 / 区域</span><strong>{display(golden.industry)}</strong><small>{display(golden.region)}</small></article>
      <article><span>关联对象</span><strong>客户 · Case</strong><small>供应商未提供</small></article>
    </div>
  </section>;
}

function PathView({ ready }: { ready: OpportunityReadyDto }) {
  const golden = ready.goldenCase;
  const model = ready.readModel;
  const contextVersion = model.chatContext.contextVersion;
  return <section className={styles.pathView} aria-labelledby="path-title">
    <header className={styles.panelHeading}>
      <div><span>OPPORTUNITY PATH</span><h2 id="path-title">阶段与下一动作</h2></div>
      <p>这是 Opportunity 的事实推进路径，不是四专业内部“材料→规则→模型→人审”路径。</p>
    </header>
    <div className={styles.pathLane}>
      <article data-step="1"><span>当前输入</span><strong>{display(model.title)}</strong><p>{display(golden.roleScopedSummary)}</p></article>
      <i aria-hidden="true">→</i>
      <article data-step="2"><span>当前阶段</span><strong>{display(model.stage)}</strong><p>材料完整度：{model.materials.completeness.display}</p></article>
      <i aria-hidden="true">→</i>
      <article data-step="3" className={styles.pathAttention}><span>当前待补</span><strong>{display(model.materials.items[0]?.label)}</strong><p>{display(model.materials.items[0]?.detail)}</p></article>
      <i aria-hidden="true">→</i>
      <article data-step="4"><span>下一动作</span><strong>{display(model.nextAction)}</strong><p>由业务组织，不替代专业 Gate</p></article>
    </div>
    <div className={styles.pathDetails}>
      <article><span>业务可组织动作</span><h3>发起 · 组织 · 分派 · 提醒 · 补充 · 终止</h3><p>professional_review / professional_gate 明确禁止。</p></article>
      <article><span>材料状态</span><h3>{model.materials.completeness.display}</h3><p>{model.materials.items.length ? `${model.materials.items.length} 个 sourced 待补项` : '未提供'}</p></article>
      <article><span>Context</span><h3>{contextVersion}</h3><p>Projection {model.projectionVersion}</p></article>
    </div>
    <section className={styles.backgroundStrip} aria-labelledby="background-title">
      <div><span>BACKGROUND SUMMARY</span><h3 id="background-title">组合对照 · 只读</h3></div>
      {ready.backgroundCases.map((item) => <article key={item.caseId} data-signal={item.signal}>
        <span>{item.caseId}</span><strong>{item.title}</strong><small>{item.phase} · {item.nextMilestone}</small>
      </article>)}
    </section>
  </section>;
}

function MatrixView({ ready }: { ready: OpportunityReadyDto }) {
  const rows = ready.readModel.responsibilityMatrix;
  return <section className={styles.matrixView} aria-labelledby="matrix-title">
    <header className={styles.panelHeading}>
      <div><span>SPARSE RESPONSIBILITY MATRIX</span><h2 id="matrix-title">当前责任矩阵</h2></div>
      <p>业务负责组织推进；政策、信审、商务、资产保留各自专业判断。</p>
    </header>
    <div className={styles.matrixWrap}>
      <table>
        <thead><tr><th>角色</th><th>当前责任</th><th>运行状态</th><th>专业 Gate</th><th>边界</th></tr></thead>
        <tbody>{rows.map((item) => <tr key={item.role} data-process={item.role === 'business' ? 'opportunity' : item.role}>
          <th scope="row">{ROLE_LABELS[item.role] ?? item.role}</th>
          <td>{item.responsibility === 'orchestrates' ? '组织推进 Opportunity' : '独立专业判断'}</td>
          <td><span className={styles.statusChip}>未提供</span></td>
          <td>{item.canSubmitProfessionalGate ? '由具名专业人员提交' : '无专业 Gate 权限'}</td>
          <td>{item.role === 'business' ? '发起 / 组织 / 分派 / 提醒 / 补充 / 终止' : '业务不得替代'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className={styles.matrixNote}>
      <JwIcon name="shield" size={22} />
      <p><b>Authority boundary</b>：业务不代替政策、信审、商务或资产人审，不强迫 Gate 结论；AI candidate 的 authority 始终为 none。</p>
    </div>
  </section>;
}

function ChatPanel({
  loadState,
  ready,
  loadError,
  onReload,
  onReadyChange,
}: {
  loadState: LoadState;
  ready: OpportunityReadyDto | null;
  loadError: string;
  onReload: () => void;
  onReadyChange: (next: OpportunityReadyDto) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [pendingIntent, setPendingIntent] = useState<PendingMessageIntent | null>(null);
  async function submitIntent(intent: PendingMessageIntent) {
    if (!ready || busy || !ready.chatCapability.enabled) return;
    setBusy(true);
    setSendError('');
    setPendingIntent(intent);
    try {
      const next = await opportunityClient.sendMessage({
        sessionId: ready.sessionId,
        requestId: intent.requestId,
        message: intent.message,
      });
      onReadyChange(next);
      const blockedRoute = next.routeStates.find((route) => route.status === 'busy' || route.status === 'error');
      if (blockedRoute) {
        setSendError(blockedRoute.error?.message ?? `${blockedRoute.target} 当前繁忙${blockedRoute.retryable ? '，可使用相同 requestId 重试' : ''}。`);
        if (!blockedRoute.retryable) {
          setMessage('');
          setPendingIntent(null);
        }
      } else {
        setMessage('');
        setPendingIntent(null);
      }
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const normalized = message.trim();
    if (!normalized) return;
    const intent = pendingIntent?.message === normalized
      ? pendingIntent
      : { message: normalized, requestId: makeRequestId() };
    void submitIntent(intent);
  }

  function insertMention(label: string) {
    setMessage((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${label} `);
  }

  const entries = ready?.readModel.chatContext.messages ?? [];
  const capabilityLabel = ready?.chatCapability.enabled ? 'API READY' : 'FAIL CLOSED';
  const contextVersion = ready?.readModel.chatContext.contextVersion ?? 'Context 未提供';

  return <div className={styles.chatPanel} aria-labelledby="opportunity-chat-title">
    <header className={styles.chatHeader}>
      <div><span>CURRENT OPPORTUNITY GROUP</span><h2 id="opportunity-chat-title">当前上下文群聊</h2></div>
      <b data-ready={ready?.chatCapability.enabled ?? false}>{capabilityLabel}</b>
    </header>
    <div className={styles.chatContext}>
      <span>Opportunity</span><strong>{ready?.goldenCase.title ?? '正在载入'}</strong>
      <small>{contextVersion}</small>
    </div>
    <div className={styles.mentionRow} aria-label="可提及成员">
      {MENTION_LABELS.map((label) => <button key={label} type="button" onClick={() => insertMention(label)} disabled={loadState !== 'ready' || busy}>{label}</button>)}
    </div>
    <div className={styles.chatLog} aria-live="polite">
      {loadState === 'loading' ? <p className={styles.chatState}>正在载入项目群聊…</p> : null}
      {loadState === 'error' ? <div className={styles.chatState} role="alert"><p>{loadError || '投影不可用，群聊已 fail closed。'}</p><button type="button" onClick={onReload}>重试载入</button></div> : null}
      {loadState === 'ready' && entries.length === 0 ? <p className={styles.chatState}>当前 Thread 尚无消息。</p> : null}
      {entries.map((entry) => {
        const actorLabel = ROLE_LABELS[entry.actorRole] ?? entry.actorRole;
        const ai = entry.actorKind === 'agent' || isAiActor(actorLabel);
        return <article key={entry.messageId} className={`${styles.message} ${entry.actorKind === 'human' ? styles.humanMessage : ''}`}>
          <header><b>{actorLabel}</b><span>{ai ? 'candidate · authority none' : 'recorded · authority none'}</span></header>
          <p>{entry.text}</p>
          <small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }) : entry.contextVersion}</small>
        </article>;
      })}
      {ready?.candidateReplies.map((candidate) => <article key={candidate.candidateId} className={`${styles.message} ${styles.candidateMessage}`} data-completion={candidate.completion}>
        <header><b>{ROLE_LABELS[candidate.routedTo] ?? candidate.routedTo}</b><span>candidate · authority none</span></header>
        <p>{candidate.text}</p>
        <small>shared candidate record · {candidate.completion}</small>
      </article>)}
      {busy ? <p className={styles.chatState}>消息写入中，正在等待 API reconciliation…</p> : null}
    </div>
    <p className={styles.candidateNotice}><b>AI reply policy</b>：任何 AI 内容均为 candidate · authority none，并与正式完成、专业结论和 Gate 分离。</p>
    <form className={styles.chatForm} onSubmit={send}>
      <label htmlFor="opportunity-message">发送到当前 Opportunity context</label>
      <textarea
        id="opportunity-message"
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
          if (pendingIntent?.message !== event.target.value.trim()) setPendingIntent(null);
        }}
        placeholder="@相关角色 补充事实或组织下一动作"
        disabled={loadState !== 'ready' || busy || !ready?.chatCapability.enabled}
      />
      <button type="submit" disabled={!message.trim() || busy || !ready?.chatCapability.enabled}>{busy ? '发送中' : '发送'}</button>
    </form>
    {sendError ? <div className={styles.sendError} role="alert"><span>{sendError}</span>{pendingIntent ? <button type="button" disabled={busy} onClick={() => void submitIntent(pendingIntent)}>重试发送</button> : null}</div> : null}
  </div>;
}

export default function OpportunityPageAdapter() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [ready, setReady] = useState<OpportunityReadyDto | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [activeMode, setActiveMode] = useState<ViewMode>('relationship');

  useEffect(() => {
    const controller = new AbortController();
    void opportunityClient.initialize(controller.signal)
      .then((next) => {
        setReady(next);
        setLoadState('ready');
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setReady(null);
        setLoadError(caught instanceof Error ? caught.message : 'Opportunity 投影载入失败');
        setLoadState('error');
      });
    return () => controller.abort();
  }, [attempt]);

  const contextTitle = useMemo(() => ready?.goldenCase.title ?? 'Opportunity context', [ready]);
  const contextVersion = ready?.readModel.chatContext.contextVersion ?? (loadState === 'loading' ? '载入中' : '未提供');
  const objective = ready?.readModel.nextAction ?? (loadState === 'loading' ? '正在载入下一动作' : '未提供');
  const retryLoad = () => {
    setLoadState('loading');
    setLoadError('');
    setReady(null);
    setAttempt((value) => value + 1);
  };

  const mainContent = <section className={styles.mainView} aria-label="商机主视图">
        <h1 className={styles.srOnly}>商机 · Opportunity 工作面</h1>
        {loadState === 'loading' ? <LoadingPanel /> : null}
        {loadState === 'error' ? <div className={styles.statePanel} role="alert"><JwIcon name="x" size={28} /><b>Opportunity 投影不可用</b><p>{loadError}</p><button type="button" onClick={retryLoad}>重试载入</button></div> : null}
        {loadState === 'ready' && ready && activeMode === 'relationship' ? <RelationshipView ready={ready} /> : null}
        {loadState === 'ready' && ready && activeMode === 'path' ? <PathView ready={ready} /> : null}
        {loadState === 'ready' && ready && activeMode === 'matrix' ? <MatrixView ready={ready} /> : null}
      </section>;
  const chat = <ChatPanel loadState={loadState} ready={ready} loadError={loadError} onReload={retryLoad} onReadyChange={setReady} />;

  return <SharedSurfaceShell
    entryId="opportunity"
    family="opportunity"
    pageTitle={`商机 · ${contextTitle}`}
    currentObjective={objective}
    defaultMode={activeMode}
    quarterProgress={EMPTY_PROFESSIONAL_PROGRESS}
    context={{ label: 'Opportunity context', value: contextVersion }}
    role={{
      principalId: 'business-owner',
      label: 'Role Projection',
      options: OPPORTUNITY_ROLE_OPTIONS,
      busy: loadState === 'loading',
      onChange: () => undefined,
    }}
    boundaryNote="业务只组织推进 · 专业 Gate 由具名人完成 · AI candidate / authority none"
    onModeChange={setActiveMode}
    mainContent={mainContent}
    chat={chat}
  />;
}
