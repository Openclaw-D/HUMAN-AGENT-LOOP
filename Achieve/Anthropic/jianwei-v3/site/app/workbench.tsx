'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import GlobalGraphCanvas from './global-graph-canvas';

type StageId = 'policy' | 'credit' | 'commerce' | 'asset';
type PrepState = 'completed' | 'active' | 'locked';
type AuthorityState = 'waiting_dependency' | 'ready_for_gate' | 'approved';
type DecisionAction = 'reject' | 'submit';
type DecisionReceipt = { gateId: string; receiptId: string; stageId: StageId; flowId: string; action: DecisionAction; actor: string; status: 'recorded'; requestId: string };
type EvidenceReceipt = { receiptId: string; evidenceEventId: string; evidenceId: string; contextVersion: string; title: string; actor: string; status: 'accepted'; consumerCount: 4 };
type ContextPacket = {
  caseId: string; caseTitle: string; contextVersion: string; evidenceEventId: string;
  stageId: string; stageLabel: string; flowId: string; flowLabel: string; from: string; previousResult: string;
  ruleVersion: string; confirmedFacts: string[]; evidenceGaps: string[]; automatedWork: string[]; humanDecision: string; handoffTo: string;
};
type FlowWorkspace = {
  id: string; type: string; headline: string; objective: string;
  visualization: { type: string; title: string; description: string; items: Array<{ id: string; label: string; value: string; status: string }> };
  matrix: { title: string; columns: Array<{ key: string; label: string }>; rows: Array<{ id: string; cells: Record<string, string> }> };
  graph: { nodes: Array<{ id: string; label: string; kind: string; active: boolean }>; edges: Array<{ id: string; source: string; target: string; label: string }> };
  indicators: Array<{ label: string; value: string; note: string }>;
  evidenceGaps: string[]; nextActions: string[]; currentSituation: string; whyMe: string; aiCompleted: string[];
  primaryHumanAction: { action: string; owner: string; evidenceGap: string; humanGate: string };
  nextHandoff: { target: string; receiver: string; contextPacket: string[] };
  successReceiptCondition: string;
};
type PublicFlow = {
  id: string; label: string; owner: string; prepState: PrepState; progressPercent: number; status: string;
  evidence: string; output: string; previousResult: string; handoffTo: string; workspace: FlowWorkspace;
};
type PublicStage = {
  id: StageId; label: string; summary: string; ruleVersion: string; completedStepCount: number; prepProgressPercent: number;
  authorityState: AuthorityState; processRunId: string; contextVersion: string; currentFlowId: string; flows: PublicFlow[];
};
type GlobalGraph = {
  width: number; height: number;
  clusters: Array<{ stageId: StageId; label: string; x: number; y: number; width: number; height: number }>;
  nodes: Array<{ id: string; label: string; stageId: StageId | 'shared'; kind: 'context' | 'flow'; prepState: PrepState | 'shared'; x: number; y: number }>;
  edges: Array<{ id: string; source: string; target: string; label: string; kind: 'shared' | 'sequence' | 'handoff' }>;
};
type PublicProjection = {
  caseId: string; caseTitle: string;
  sharedContext: { contextVersion: string; evidenceEventId: string; consumerCount: 4 };
  stageRuns: Array<{ stageId: StageId; processRunId: string; contextVersion: string; currentFlowId: string; prepProgressPercent: number }>;
  stages: PublicStage[]; globalGraph: GlobalGraph;
  creditDimensions: Array<{ id: string; label: string; signal: string }>;
  materials: Array<{ id: string; title: string; imageUrl: string; disclosure: string; facts: Array<{ id: string; label: string; value: string; status: 'candidate' | 'confirmed'; confirmedBy?: string }> }>;
  modelRuntime: { mode: 'local_candidate' | 'live_unverified'; label: string };
  latestReceipt?: DecisionReceipt; latestEvidenceReceipt?: EvidenceReceipt;
};

type ChatEntry = { role: 'user' | 'assistant'; text: string };
type ApiErrorPayload = { error?: { message?: string } };
const CASE_ID = 'FL-DEMO-001';
const ACTOR = '业务人员·林澈';
const PROGRESS_TONES: Record<number, string> = { 0: '#ffffff', 20: '#eeeeee', 40: '#d4d4d4', 60: '#a9a9a9', 80: '#686868', 100: '#000000' };
const AUTHORITY_LABELS: Record<AuthorityState, string> = { waiting_dependency: '等待前序依赖', ready_for_gate: '候选就绪·待人工', approved: '已取得正式回执' };
const PREP_LABELS: Record<PrepState, string> = { completed: '候选完成', active: '当前处理', locked: '等待前序' };

async function requestProjection(): Promise<PublicProjection> {
  const response = await fetch(`/api/cases/${CASE_ID}/projection`, { cache: 'no-store' });
  if (!response.ok) throw new Error('load failed');
  return response.json();
}

export function progressTone(percent: number): string {
  const tone = PROGRESS_TONES[percent];
  if (!tone) throw new Error('INVALID_PREP_PROGRESS');
  return tone;
}

function progressStyle(percent: number): CSSProperties {
  return { '--progress-tone': progressTone(percent), '--progress-ink': percent >= 80 ? '#ffffff' : '#171717' } as CSSProperties;
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  return <div className="percent-row"><div><span>{label}</span><strong>{value}%</strong></div><div className="percent-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${value}%` }} /></div></div>;
}

export default function Workbench() {
  const [projection, setProjection] = useState<PublicProjection | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stageId, setStageId] = useState<StageId>('policy');
  const [flowId, setFlowId] = useState('policy-material');
  const [view, setView] = useState<'graph' | 'matrix'>('graph');
  const [dimensionId, setDimensionId] = useState('production');
  const [panelWidth, setPanelWidth] = useState(420);
  const [resizing, setResizing] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  const [lastContext, setLastContext] = useState<ContextPacket | null>(null);
  const [confirmingFactId, setConfirmingFactId] = useState<string | null>(null);
  const [factError, setFactError] = useState('');
  const [pendingAction, setPendingAction] = useState<DecisionAction | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceTitle, setEvidenceTitle] = useState('设备检验说明（脱敏）');
  const [evidenceSummary, setEvidenceSummary] = useState('候选设备检验页摘要，仅用于本地协同演示。');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [evidenceReceipt, setEvidenceReceipt] = useState<EvidenceReceipt | null>(null);

  const loadProjection = useCallback(async () => {
    const data = await requestProjection();
    setProjection(data);
    setReceipt(data.latestReceipt ?? null);
    setEvidenceReceipt(data.latestEvidenceReceipt ?? null);
    setLoadState('ready');
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    void requestProjection().then((data) => {
      if (!alive) return;
      setProjection(data);
      setReceipt(data.latestReceipt ?? null);
      setEvidenceReceipt(data.latestEvidenceReceipt ?? null);
      setLoadState('ready');
    }).catch(() => { if (alive) setLoadState('error'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => setPanelWidth(Math.min(620, Math.max(320, window.innerWidth - event.clientX)));
    const stop = () => setResizing(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, [resizing]);

  const currentStage = useMemo(() => projection?.stages.find((stage) => stage.id === stageId) ?? projection?.stages[0], [projection, stageId]);
  const currentFlow = currentStage?.flows.find((flow) => flow.id === flowId) ?? currentStage?.flows[0];
  const currentDimension = projection?.creditDimensions.find((dimension) => dimension.id === dimensionId) ?? projection?.creditDimensions[0];
  const currentReceipt = useMemo(() => receipt && receipt.stageId === currentStage?.id && receipt.flowId === currentFlow?.id ? receipt : null, [currentFlow?.id, currentStage?.id, receipt]);

  const selectFlow = useCallback((nextFlowId: string, nextStageId?: StageId) => {
    if (nextStageId) setStageId(nextStageId);
    setFlowId(nextFlowId);
    setView('graph');
    setLastContext(null);
    setPendingAction(null);
    setDecisionError('');
  }, []);
  const switchStage = useCallback((nextStageId: StageId) => {
    const stage = projection?.stages.find((item) => item.id === nextStageId);
    if (stage) selectFlow(stage.currentFlowId, nextStageId);
  }, [projection, selectFlow]);

  const confirmFact = useCallback(async (factId: string) => {
    if (confirmingFactId) return;
    setConfirmingFactId(factId); setFactError('');
    try {
      const response = await fetch(`/api/cases/${CASE_ID}/facts/${encodeURIComponent(factId)}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: ACTOR, requestId: `confirm-${crypto.randomUUID()}` }) });
      const data = await response.json() as ApiErrorPayload; if (!response.ok) throw new Error(data.error?.message || '确认未完成'); await loadProjection(); setLastContext(null);
    } catch (error) { setFactError(error instanceof Error ? error.message : '确认未完成'); } finally { setConfirmingFactId(null); }
  }, [confirmingFactId, loadProjection]);

  const sendMessage = useCallback(async () => {
    const message = chatInput.trim();
    if (!message || chatBusy || !currentStage || !currentFlow) return;
    setChatBusy(true); setChatError(''); setChatInput(''); setChatLog((entries) => [...entries, { role: 'user', text: message }]);
    try {
      const response = await fetch(`/api/cases/${CASE_ID}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, requestId: `message-${crypto.randomUUID()}`, stageId: currentStage.id, flowId: currentFlow.id }) });
      const data = await response.json() as ApiErrorPayload & { contextPacket: ContextPacket; answer: string }; if (!response.ok) throw new Error(data.error?.message || '请求未完成'); setLastContext(data.contextPacket); setChatLog((entries) => [...entries, { role: 'assistant', text: data.answer }]);
    } catch (error) { setChatError(error instanceof Error ? error.message : '请求未完成'); } finally { setChatBusy(false); }
  }, [chatBusy, chatInput, currentFlow, currentStage]);

  const recordDecision = useCallback(async () => {
    if (!pendingAction || !currentStage || !currentFlow || currentFlow.prepState === 'locked' || decisionBusy) return;
    setDecisionBusy(true); setDecisionError('');
    try {
      const response = await fetch(`/api/cases/${CASE_ID}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: pendingAction, actor: ACTOR, requestId: `decision-${crypto.randomUUID()}`, stageId: currentStage.id, flowId: currentFlow.id }) });
      const data = await response.json() as ApiErrorPayload & { receipt: DecisionReceipt }; if (!response.ok) throw new Error(data.error?.message || 'Human Gate 未完成'); setReceipt(data.receipt); setPendingAction(null); await loadProjection();
    } catch (error) { setDecisionError(error instanceof Error ? error.message : 'Human Gate 未完成'); } finally { setDecisionBusy(false); }
  }, [currentFlow, currentStage, decisionBusy, loadProjection, pendingAction]);

  const submitEvidence = useCallback(async () => {
    if (evidenceBusy || !evidenceTitle.trim() || !evidenceSummary.trim()) return;
    setEvidenceBusy(true); setEvidenceError('');
    try {
      const token = crypto.randomUUID();
      const response = await fetch(`/api/cases/${CASE_ID}/evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `evidence-${token}`, evidenceId: `synthetic-${token}`, kind: 'synthetic_note', title: evidenceTitle, summary: evidenceSummary, actor: ACTOR }) });
      const data = await response.json() as ApiErrorPayload & { receipt: EvidenceReceipt }; if (!response.ok) throw new Error(data.error?.message || 'Evidence 接入失败'); setEvidenceReceipt(data.receipt); await loadProjection(); setEvidenceOpen(false);
    } catch (error) { setEvidenceError(error instanceof Error ? error.message : 'Evidence 接入失败'); } finally { setEvidenceBusy(false); }
  }, [evidenceBusy, evidenceSummary, evidenceTitle, loadProjection]);

  if (loadState === 'loading') return <main className="state-page">正在载入融资租赁事项……</main>;
  if (loadState === 'error' || !projection || !currentStage || !currentFlow) return <main className="state-page">载入失败。请刷新页面重试。</main>;

  const workspace = currentFlow.workspace;
  const nextFlow = projection.stages.flatMap((stage) => stage.flows).find((flow) => flow.id === workspace.nextHandoff.target);
  const nextHandoffLabel = nextFlow?.label ?? workspace.nextHandoff.target;
  const contextPacket = lastContext && lastContext.stageId === currentStage.id && lastContext.flowId === currentFlow.id ? lastContext : null;
  const shellStyle = { '--continuation-width': `${panelWidth}px` } as CSSProperties;

  return <main className="workbench" style={shellStyle}>
    <header className="topbar">
      <div className="identity"><strong>见微</strong><span>{projection.caseId}</span></div>
      <nav className="stage-spine" aria-label="政策到资产主接续">
        {projection.stages.map((stage, index) => <div className="stage-link" key={stage.id}>
          <button type="button" data-testid={`stage-${stage.id}`} data-progress={stage.prepProgressPercent} className={`stage-button${stage.id === currentStage.id ? ' selected' : ''}`} style={progressStyle(stage.prepProgressPercent)} onClick={() => switchStage(stage.id)} aria-current={stage.id === currentStage.id ? 'step' : undefined}>
            <span className="stage-name"><b>{stage.label}</b><em>{stage.prepProgressPercent}%</em></span>
            <span className="stage-authority">{AUTHORITY_LABELS[stage.authorityState]}</span>
            <span className="progress-cells">{stage.flows.map((flow) => <i key={flow.id} data-prep-state={flow.prepState} title={`${flow.label} · ${PREP_LABELS[flow.prepState]}`} />)}</span>
          </button>{index < projection.stages.length - 1 ? <span className="spine-arrow" aria-hidden="true">→</span> : null}
        </div>)}
      </nav>
      <div className="top-divider" aria-hidden="true" />
      <div className="top-actions"><button type="button" className="decision-button reject" disabled={currentFlow.prepState === 'locked'} title={currentFlow.prepState === 'locked' ? '等待前序流程完成' : '否决当前页面'} onClick={() => setPendingAction('reject')}>否决</button><button type="button" className="decision-button submit" disabled={currentFlow.prepState === 'locked'} title={currentFlow.prepState === 'locked' ? '等待前序流程完成' : '提交当前页面'} onClick={() => setPendingAction('submit')}>提交</button></div>
    </header>

    <div className="workspace-grid">
      <aside className="flow-rail" aria-label={`${currentStage.label}五流程`}>
        <div className="flow-spine">{currentStage.flows.map((flow) => <button key={flow.id} type="button" data-flow-id={flow.id} data-prep-state={flow.prepState} className={`flow-button ${flow.prepState}${flow.id === currentFlow.id ? ' selected' : ''}`} style={progressStyle(flow.progressPercent)} onClick={() => selectFlow(flow.id)} aria-current={flow.id === currentFlow.id ? 'step' : undefined}><b>{flow.label}</b><small>{PREP_LABELS[flow.prepState]}</small></button>)}</div>
      </aside>

      <section className="main-stage">
        <div className="stage-heading">
          <div><span className="eyebrow">{projection.caseTitle} · {currentStage.label}/{currentFlow.label}</span><h1>{workspace.headline}</h1><p>{workspace.objective}</p></div>
          <div className="heading-actions"><button type="button" className="evidence-button" onClick={() => setEvidenceOpen((open) => !open)}>接入共享信息</button><div className="view-switch" role="group" aria-label="当前流程视图"><button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>关系图谱</button><button type="button" className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>业务矩阵</button></div></div>
        </div>

        {evidenceOpen ? <section className="evidence-ingress" aria-label="唯一共享信息接入"><div><span>CANONICAL EVIDENCE / EVENT</span><strong>一次接入，四路共享</strong><p>只接收合成/脱敏摘要，不上传真实集团材料。</p></div><label>标题<input value={evidenceTitle} onChange={(event) => setEvidenceTitle(event.target.value)} maxLength={120} /></label><label>摘要<textarea value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} maxLength={1200} /></label><button type="button" disabled={evidenceBusy} onClick={() => void submitEvidence()}>{evidenceBusy ? '接入中…' : '生成唯一 Evidence/Event'}</button>{evidenceError ? <p className="error-text" role="alert">{evidenceError}</p> : null}</section> : null}

        <section className="context-strip"><div><span>共享 Context Version</span><strong>{projection.sharedContext.contextVersion}</strong></div><div><span>Evidence Event</span><strong>{projection.sharedContext.evidenceEventId}</strong></div><div><span>四路消费者</span><strong>{projection.sharedContext.consumerCount} / 4 同版</strong></div>{evidenceReceipt ? <div><span>最近接入回执</span><strong>{evidenceReceipt.receiptId}</strong></div> : null}</section>

        <section className="flow-continuity" aria-label="当前流程接续链"><article><span>上一步结果</span><strong>{currentFlow.previousResult}</strong></article><i>→</i><article className="current"><span>当前工作</span><strong>{workspace.visualization.title}</strong><small>{workspace.primaryHumanAction.owner}</small></article><i>→</i><article><span>Human Gate</span><strong>{workspace.primaryHumanAction.humanGate}</strong></article><i>→</i><article><span>下一接续</span><strong>{nextHandoffLabel}</strong><small>{workspace.nextHandoff.receiver}</small></article></section>

        <div className="indicator-grid">{workspace.indicators.map((indicator) => <article key={indicator.label}><span>{indicator.label}</span><strong>{indicator.value}</strong><small>{indicator.note}</small></article>)}</div>
        <section className="visualization-summary"><div><span>{workspace.visualization.type}</span><h2>{workspace.visualization.title}</h2><p>{workspace.visualization.description}</p></div><div className="visualization-items">{workspace.visualization.items.map((item) => <article key={item.id}><b>{item.label}</b><strong>{item.value}</strong><small>{item.status}</small></article>)}</div></section>

        {view === 'graph' ? <GlobalGraphCanvas caseId={projection.caseId} contextVersion={projection.sharedContext.contextVersion} graph={projection.globalGraph} currentFlowId={currentFlow.id} onSelectFlow={(nextFlowId, nextStageId) => selectFlow(nextFlowId, nextStageId)} /> : <section className="matrix-wrap" aria-label={`${currentFlow.label}业务矩阵`}><div className="matrix-title"><span>当前流程实际业务信息</span><h2>{workspace.matrix.title}</h2></div><table className="business-matrix"><thead><tr>{workspace.matrix.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{workspace.matrix.rows.map((row) => <tr key={row.id}>{workspace.matrix.columns.map((column) => <td key={column.key}>{row.cells[column.key]}</td>)}</tr>)}</tbody></table></section>}

        <div className="flow-detail-grid"><section><span>证据缺口</span>{workspace.evidenceGaps.map((item) => <p key={item}>{item}</p>)}</section><section><span>下一步动作</span>{workspace.nextActions.map((item) => <p key={item}>{item}</p>)}</section></div>
        {currentStage.id === 'credit' ? <section className="credit-only" aria-label="信审现场材料"><div className="dimension-tabs">{projection.creditDimensions.map((dimension) => <button key={dimension.id} type="button" className={dimension.id === currentDimension?.id ? 'active' : ''} onClick={() => setDimensionId(dimension.id)}>{dimension.label}</button>)}<p>{currentDimension?.signal}</p></div><div className="material-grid">{projection.materials.map((material) => <article key={material.id} className="material-card"><img src={material.imageUrl} alt={material.title} /><div><span>{material.disclosure}</span><h3>{material.title}</h3>{material.facts.map((fact) => <div key={fact.id} className="fact-row"><p>{fact.label}：{fact.value}</p><button type="button" disabled={fact.status === 'confirmed' || confirmingFactId !== null} onClick={() => void confirmFact(fact.id)}>{fact.status === 'confirmed' ? `已确认 · ${fact.confirmedBy}` : confirmingFactId === fact.id ? '确认中…' : '人工确认'}</button></div>)}</div></article>)}</div>{factError ? <p className="error-text" role="alert">{factError}</p> : null}</section> : null}
      </section>

      <div className={`resize-handle${resizing ? ' dragging' : ''}`} role="separator" aria-label="调整接续台宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={620} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth((width) => Math.min(620, Math.max(320, width + (event.key === 'ArrowLeft' ? 16 : -16)))); } }}><span /></div>

      <aside className="continuation-desk" aria-label="接续台">
        <div className="desk-head"><div><span className="eyebrow">CONTINUATION DESK</span><h2>{currentStage.label} · {currentFlow.label}</h2></div><span className="runtime-badge">{projection.modelRuntime.label}</span></div>
        <section className="shared-card"><div><span>共享 Context Version</span><strong>{projection.sharedContext.contextVersion}</strong><small>{projection.sharedContext.evidenceEventId}</small></div><div className="run-grid">{projection.stageRuns.map((run) => <span key={run.stageId}><b>{projection.stages.find((stage) => stage.id === run.stageId)?.label}</b><em>{run.prepProgressPercent}% · 同版</em></span>)}</div></section>
        <section className="handoff-lane"><div><span>来自</span><b>{currentFlow.previousResult}</b></div><i>→</i><div className="current"><span>当前</span><b>{currentFlow.label}</b></div><i>→</i><div><span>下一</span><b>{nextHandoffLabel}</b></div></section>
        <section className="summary-card situation-card"><div className="card-label"><span>当前情况</span><em>{AUTHORITY_LABELS[currentStage.authorityState]}</em></div><h3>{workspace.currentSituation}</h3><p>{workspace.whyMe}</p><div className="progress-summary"><ProgressBar label={`${currentStage.label}板块准备度`} value={currentStage.prepProgressPercent} /><ProgressBar label={`${currentFlow.label}流程准备度`} value={currentFlow.progressPercent} /></div></section>
        <section className="summary-card ai-card"><span>AI 已完成 · authority=none</span>{workspace.aiCompleted.map((item) => <p key={item}>✓ {item}</p>)}</section>
        <section className="summary-card action-card"><span>待我处理 · 一个首要动作</span><h3>{workspace.primaryHumanAction.action}</h3><dl><div><dt>Owner</dt><dd>{workspace.primaryHumanAction.owner}</dd></div><div><dt>证据缺口</dt><dd>{workspace.primaryHumanAction.evidenceGap}</dd></div><div><dt>Human Gate</dt><dd>{workspace.primaryHumanAction.humanGate}</dd></div></dl></section>
        <section className="summary-card next-card"><span>下一接续</span><h3>{nextHandoffLabel}</h3><p>{workspace.nextHandoff.receiver}</p><div className="packet-list"><b>受控 Context Packet</b>{workspace.nextHandoff.contextPacket.map((item) => <small key={item}>{item}</small>)}</div><div className="receipt-condition"><b>成功回执条件</b><p>{workspace.successReceiptCondition}</p></div></section>
        {pendingAction ? <section className="gate-card" aria-label="具名 Human Gate"><span>具名 Human Gate</span><h3>{pendingAction === 'reject' ? '确认否决当前页面' : '确认提交当前页面'}</h3><p>{ACTOR} · {currentStage.label}/{currentFlow.label}</p><div><button type="button" onClick={() => setPendingAction(null)}>返回</button><button type="button" className="gate-confirm" disabled={decisionBusy} onClick={() => void recordDecision()}>{decisionBusy ? '记录中…' : pendingAction === 'reject' ? '具名确认否决' : '具名确认提交'}</button></div>{decisionError ? <p className="error-text" role="alert">{decisionError}</p> : null}</section> : null}
        {currentReceipt ? <section className="receipt-card" aria-label="Human Gate Receipt"><span>RECEIPT · {currentReceipt.status}</span><strong>{currentReceipt.action === 'reject' ? '已记录否决' : '已记录提交'} · {currentReceipt.actor}</strong><p>{currentReceipt.receiptId} · {currentReceipt.gateId}</p></section> : null}
        <section className="chatbox" aria-label="候选沟通"><div className="chat-label"><span>补充沟通</span><small>{contextPacket ? contextPacket.contextVersion : projection.sharedContext.contextVersion} · 仅候选解释</small></div><div className="chat-log" aria-live="polite">{chatLog.length === 0 ? <div className="chat-entry assistant"><b>候选助手</b><p>可询问当前节点的证据缺口。</p></div> : chatLog.map((entry, index) => <div key={`${entry.role}-${index}`} className={`chat-entry ${entry.role}`}><b>{entry.role === 'user' ? '我' : '候选助手'}</b><p>{entry.text}</p></div>)}</div>{chatError ? <p className="error-text" role="alert">{chatError}</p> : null}<form className="chat-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="询问当前节点…" disabled={chatBusy} maxLength={600} /><button type="submit" disabled={chatBusy || !chatInput.trim()}>{chatBusy ? '处理中…' : '发送'}</button></form></section>
      </aside>
    </div>
  </main>;
}
