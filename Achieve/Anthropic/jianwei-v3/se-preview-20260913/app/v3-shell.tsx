'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  V3_CASES,
  V3_PROCESS_THREADS,
  buildAiRoute,
  buildRoleProjection,
  type V3PrincipalId,
  type V3ProcessId,
  type V3RoleId,
} from '../lib/v3-shell-model';

type BackendStageId = 'policy' | 'credit' | 'commerce' | 'asset';
type PrepState = 'completed' | 'active' | 'locked';
type BackendProjection = {
  caseId: string;
  sharedContext: { contextVersion: string; evidenceEventId: string };
  stageRuns: Array<{ stageId: BackendStageId; currentFlowId: string; processRunId: string }>;
  stages: Array<{
    id: BackendStageId;
    authorityState: 'waiting_dependency' | 'ready_for_gate' | 'approved';
    flows: Array<{ id: string; prepState: PrepState }>;
  }>;
  latestReceipt?: { receiptId: string };
  latestEvidenceReceipt?: { receiptId: string; contextVersion: string };
};
type ApiErrorPayload = { error?: { message?: string } };
type BackendPortfolio = {
  northStar: string;
  timeGrains: Array<'day' | 'week' | 'month' | 'quarter' | 'half-year' | 'year'>;
  kpis: Array<{
    metricId: string;
    label: string;
    unit: string;
    target: number;
    due: number;
    current: number;
    deltaToTarget: number;
    deltaToDue: number;
    trend: string;
    valueClass: string;
  }>;
};
type DockEntry = {
  processId: V3ProcessId;
  actor: string;
  text: string;
  tone: 'system' | 'agent' | 'human';
  time?: string;
};
type CaseView = 'phase' | 'industry' | 'signal';

const ROLE_COPY: Record<V3RoleId, { label: string; title: string; subtitle: string }> = {
  leadership: { label: '协同', title: '协同驾驶舱', subtitle: '围绕净利润、关键偏差与正式起租组织共同判断' },
  business: { label: '业务', title: '业务工作台', subtitle: '以完整 Case Context 组织商机、材料与跨专业接续' },
  risk: { label: '风控', title: '风控工作台', subtitle: '五路信息全局可见，专业 Gate 按账号权限隔离' },
  external: { label: '外联', title: '外联工作台', subtitle: '客户与供应商只看到受邀任务、进度与待解决问题' },
};

const PROCESS_COPY: Record<V3ProcessId, { label: string; kicker: string; title: string; summary: string }> = {
  opportunity: { label: '商机', kicker: 'OPPORTUNITY', title: '商机事实与协同容器', summary: '承接购机动机、项目背景、材料导入与进入专业判断前的关键事实。' },
  policy: { label: '政策', kicker: 'POLICY', title: '规则、准入与例外', summary: '解释当前 Context 命中的规则、例外与需要确认的政策影响。' },
  credit: { label: '信审', kicker: 'CREDIT', title: 'Evidence 与专业判断', summary: '组织材料、事实冲突、补件与需要有权人员完成的 Human Gate。' },
  commercial: { label: '商务', kicker: 'COMMERCIAL', title: '起租条件执行线', summary: '跟踪交易条件、付款前提与正式起租的可验证结果。' },
  asset: { label: '资产', kicker: 'ASSET', title: '资产辅助预判', summary: '形成查验建议、未来风险窗口与租后观察，不复制信审流程。' },
};

const PROCESS_WORK: Record<V3ProcessId, { result: string; action: string; owner: string; handoff: string }> = {
  opportunity: { result: '购机动机、设备清单与供应商报价已进入共享上下文。', action: '确认下游订单是否足以支撑本次扩产。', owner: '陈屿 · 业务', handoff: '确认后同步政策、信审、商务与资产。' },
  policy: { result: '主体准入未见硬阻断，保留一项首次合作厂商例外。', action: '核对例外适用条件与所需补充依据。', owner: '林澄 · 政策', handoff: '形成政策意见后交由信审引用。' },
  credit: { result: '现有材料支持项目继续推进，但订单稳定性证据不足。', action: '补充最近六个月交付与回款说明。', owner: '周岚 · 信审', handoff: '人工确认后释放商务付款条件预检。' },
  commercial: { result: '首次合作厂商采用货到付款，付款前提已预置。', action: '取得物流查验与设备一致性回执。', owner: '顾衡 · 商务', handoff: '付款完成并满足条件后形成正式起租。' },
  asset: { result: '已形成到货查验窗口与首个租后风险观察建议。', action: '确认设备到货后 48 小时现场查验安排。', owner: '许棠 · 资产', handoff: '查验结果回流商务并保留租后观察。' },
};

const BACKEND_STAGE: Partial<Record<V3ProcessId, BackendStageId>> = {
  policy: 'policy',
  credit: 'credit',
  commercial: 'commerce',
  asset: 'asset',
};

const ROLE_DEFAULT_PROCESS: Record<V3RoleId, V3ProcessId> = {
  leadership: 'credit',
  business: 'opportunity',
  risk: 'credit',
  external: 'opportunity',
};

const ROLE_DEFAULT_PRINCIPAL: Record<V3RoleId, V3PrincipalId> = {
  leadership: 'leadership-observer',
  business: 'business-owner',
  risk: 'risk-credit',
  external: 'external-customer',
};

const PRINCIPAL_COPY: Partial<Record<V3RoleId, Array<{ id: V3PrincipalId; label: string; processId: V3ProcessId }>>> = {
  risk: [
    { id: 'risk-policy', label: '政策账号', processId: 'policy' },
    { id: 'risk-credit', label: '信审账号', processId: 'credit' },
    { id: 'risk-commercial', label: '商务账号', processId: 'commercial' },
    { id: 'risk-asset', label: '资产账号', processId: 'asset' },
  ],
  external: [
    { id: 'external-customer', label: '客户协同', processId: 'opportunity' },
    { id: 'external-supplier', label: '供应商协同', processId: 'commercial' },
  ],
};

const ROLE_METRICS: Record<V3RoleId, Array<[string, string]>> = {
  leadership: [['净利偏差', '-730 万'], ['起租待办', '02'], ['风险上升', '01']],
  business: [['待确认事实', '03'], ['并行协同', '05 路'], ['最近更新', '刚刚']],
  risk: [['政策例外', '01'], ['信审补件', '02'], ['待专业确认', '01']],
  external: [['待补材料', '02'], ['已收回执', '01'], ['当前范围', '受邀']],
};

const COLLABORATION_MEMBERS: Array<{
  processId: V3ProcessId;
  person: string;
  status: string;
  state: 'done' | 'working' | 'waiting' | 'attention';
}> = [
  { processId: 'opportunity', person: '陈屿 · 业务', status: '事实已同步', state: 'done' },
  { processId: 'policy', person: '林澄 · 政策', status: '例外核验中', state: 'working' },
  { processId: 'credit', person: '周岚 · 信审', status: '需要补件', state: 'attention' },
  { processId: 'commercial', person: '顾衡 · 商务', status: '并行预检', state: 'working' },
  { processId: 'asset', person: '许棠 · 资产', status: '建议已形成', state: 'done' },
];

const INITIAL_DOCK: DockEntry[] = [
  { processId: 'opportunity', actor: '商机 Agent', text: '购机动机、设备清单与供应商报价已写入共享上下文。', tone: 'agent', time: '14:06' },
  { processId: 'policy', actor: '林澄 · 政策', text: '主体准入没有硬阻断；厂商首次合作例外需要商务一并核验。', tone: 'human', time: '14:08' },
  { processId: 'credit', actor: '周岚 · 信审', text: '下游订单稳定性证据不足，请业务补充最近六个月交付与回款说明。', tone: 'human', time: '14:12' },
  { processId: 'commercial', actor: '商务 Agent', text: '已根据首次合作模式预置货到付款检查项，等待物流查验回执。', tone: 'agent', time: '14:13' },
  { processId: 'asset', actor: '资产 Agent', text: '建议在设备到货后 48 小时内完成一次现场查验。', tone: 'agent', time: '14:14' },
];

const SIGNAL_LABEL = { normal: '平稳', attention: '关注', elevated: '上升' } as const;
const LIFECYCLE_LABEL: Record<string, string> = {
  'pre-commencement': '起租前',
  'material-collection': '材料形成中',
  'active-lease': '正常在租',
  closed: '已关闭',
};

function backendStageFor(processId: V3ProcessId) {
  return BACKEND_STAGE[processId];
}

async function readProjection(): Promise<BackendProjection> {
  const response = await fetch('/api/cases/FL-DEMO-001/projection', { cache: 'no-store' });
  if (!response.ok) throw new Error('项目 Projection 载入失败');
  return response.json();
}

export default function V3Shell() {
  const [roleId, setRoleId] = useState<V3RoleId>('leadership');
  const [principalId, setPrincipalId] = useState<V3PrincipalId>('leadership-observer');
  const [caseId, setCaseId] = useState('FL-DEMO-001');
  const [caseView, setCaseView] = useState<CaseView>('phase');
  const [processId, setProcessId] = useState<V3ProcessId>('credit');
  const [projection, setProjection] = useState<BackendProjection | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dockEntries, setDockEntries] = useState<DockEntry[]>(INITIAL_DOCK);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceReview, setEvidenceReview] = useState(false);
  const [evidenceTitle, setEvidenceTitle] = useState('下游订单稳定性补充说明');
  const [evidenceSummary, setEvidenceSummary] = useState('补充订单持续性、交付节奏与回款安排的事实摘要。');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [gateReview, setGateReview] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [portfolio, setPortfolio] = useState<BackendPortfolio | null>(null);
  const [timeGrain, setTimeGrain] = useState<BackendPortfolio['timeGrains'][number]>('quarter');

  const refreshProjection = useCallback(async () => {
    const data = await readProjection();
    setProjection(data);
    setLoadState('ready');
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    void readProjection().then((data) => {
      if (!active) return;
      setProjection(data);
      setLoadState('ready');
    }).catch(() => { if (active) setLoadState('error'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/v3/demo/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: 'collaboration-manager' }),
    }).then(async (response) => {
      const payload = await response.json() as ApiErrorPayload & { session?: { sessionId: string } };
      if (!response.ok || !payload.session) throw new Error(payload.error?.message || '协同视图载入失败');
      return fetch('/api/v3/portfolio/projection', {
        cache: 'no-store',
        headers: { 'x-jw-demo-session': payload.session.sessionId },
      });
    }).then(async (response) => {
      const payload = await response.json() as ApiErrorPayload & BackendPortfolio;
      if (!response.ok) throw new Error(payload.error?.message || '经营视图载入失败');
      if (active) setPortfolio(payload);
    }).catch(() => { if (active) setPortfolio(null); });
    return () => { active = false; };
  }, []);

  const selectedCase = V3_CASES.find((item) => item.caseId === caseId) ?? V3_CASES[0];
  const contextVersion = selectedCase.isGolden
    ? projection?.sharedContext.contextVersion ?? 'context-loading'
    : `summary-${selectedCase.caseId.toLowerCase()}-v1`;
  const roleProjection = buildRoleProjection({ caseId: selectedCase.caseId, roleId, principalId, contextVersion });
  const visibleProcesses = roleProjection.scope.visibleProcessIds;

  const sortedCases = useMemo(() => [...V3_CASES].sort((left, right) => {
    if (caseView === 'phase') return left.display.phase.localeCompare(right.display.phase, 'zh-CN');
    if (caseView === 'industry') return left.display.industry.localeCompare(right.display.industry, 'zh-CN');
    const rank = { elevated: 0, attention: 1, normal: 2 };
    return rank[left.display.signal] - rank[right.display.signal];
  }), [caseView]);

  const processThread = V3_PROCESS_THREADS.find((item) => item.processId === processId)!;
  const processCopy = PROCESS_COPY[processId];
  const mappedStageId = backendStageFor(processId);
  const backendStage = projection?.stages.find((stage) => stage.id === mappedStageId);
  const backendRun = projection?.stageRuns.find((stage) => stage.stageId === mappedStageId);
  const route = buildAiRoute({
    caseId: selectedCase.caseId,
    roleId,
    principalId,
    processId,
    contextVersion,
    task: `Open ${processId} workspace`,
  });
  const dockFeed = dockEntries.filter((entry) => visibleProcesses.includes(entry.processId));
  const collaborationMembers = COLLABORATION_MEMBERS.filter((member) => visibleProcesses.includes(member.processId));
  const activeMember = COLLABORATION_MEMBERS.find((member) => member.processId === processId);
  const processWork = PROCESS_WORK[processId];
  const canUseGoldenBackend = selectedCase.isGolden && loadState === 'ready';
  const canWriteEvidence = canUseGoldenBackend && roleId !== 'leadership';
  const canConfirmGate = canUseGoldenBackend && route.canSubmitHumanGate && Boolean(mappedStageId && backendRun);
  const metricEntries = roleId === 'leadership' && portfolio?.kpis.length
    ? portfolio.kpis.slice(0, 4).map((metric) => [
        metric.label,
        `${metric.current}${metric.unit} / 目标 ${metric.target}${metric.unit}`,
      ] as [string, string])
    : ROLE_METRICS[roleId];

  const slotState = (index: number): PrepState | 'neutral' => {
    if (!backendStage) return 'neutral';
    return backendStage.flows[index]?.prepState ?? 'neutral';
  };

  const processState = (candidateProcessId: V3ProcessId) => {
    if (candidateProcessId === 'opportunity') return selectedCase.commencementBand > 0 ? 'done' : 'waiting';
    const candidateStageId = backendStageFor(candidateProcessId);
    const candidateStage = projection?.stages.find((stage) => stage.id === candidateStageId);
    if (candidateStage?.authorityState === 'approved') return 'done';
    if (candidateStage?.authorityState === 'ready_for_gate') return 'attention';
    if (candidateStage?.flows.some((flow) => flow.prepState === 'active')) return 'working';
    return 'waiting';
  };

  const mentionProcess = (targetProcessId: V3ProcessId) => {
    setProcessId(targetProcessId);
    setChatInput(`@${PROCESS_COPY[targetProcessId].label} `);
  };

  const changeRole = (nextRole: V3RoleId) => {
    setRoleId(nextRole);
    setPrincipalId(ROLE_DEFAULT_PRINCIPAL[nextRole]);
    setProcessId(ROLE_DEFAULT_PROCESS[nextRole]);
    setNotice('');
    setGateReview(false);
  };

  const changePrincipal = (nextPrincipalId: V3PrincipalId, nextProcessId: V3ProcessId) => {
    setPrincipalId(nextPrincipalId);
    setProcessId(nextProcessId);
    setNotice('');
    setGateReview(false);
  };

  const sendMessage = async () => {
    const message = chatInput.trim();
    if (!message || chatBusy || !canUseGoldenBackend || !mappedStageId || !backendRun) return;
    setChatBusy(true);
    setNotice('');
    setChatInput('');
    setDockEntries((items) => [...items, { processId, actor: '我', text: message, tone: 'human' }]);
    try {
      const response = await fetch('/api/cases/FL-DEMO-001/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          requestId: `v3-message-${crypto.randomUUID()}`,
          stageId: mappedStageId,
          flowId: backendRun.currentFlowId,
        }),
      });
      const data = await response.json() as ApiErrorPayload & { answer?: string };
      if (!response.ok || !data.answer) throw new Error(data.error?.message || '候选路由未完成');
      setDockEntries((items) => [...items, { processId, actor: `${processCopy.label} Agent`, text: data.answer!, tone: 'agent' }]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '候选路由未完成');
    } finally {
      setChatBusy(false);
    }
  };

  const confirmEvidence = async () => {
    if (!canWriteEvidence || evidenceBusy) return;
    setEvidenceBusy(true);
    setNotice('');
    try {
      const token = crypto.randomUUID();
      const response = await fetch('/api/cases/FL-DEMO-001/evidence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: `v3-evidence-${token}`,
          evidenceId: `synthetic-${token}`,
          kind: 'synthetic_note',
          title: evidenceTitle.trim(),
          summary: evidenceSummary.trim(),
          actor: roleId === 'external' ? '外联用户' : `${ROLE_COPY[roleId].label}人员`,
        }),
      });
      const data = await response.json() as ApiErrorPayload & { receipt?: { receiptId: string; contextVersion: string } };
      if (!response.ok || !data.receipt) throw new Error(data.error?.message || 'Evidence 写入失败');
      await refreshProjection();
      setDockEntries((items) => [...items, { processId, actor: 'Authority Kernel', text: `已生成 ${data.receipt!.receiptId}，Context 更新为 ${data.receipt!.contextVersion}。`, tone: 'system' }]);
      setEvidenceOpen(false);
      setEvidenceReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Evidence 写入失败');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const confirmGate = async () => {
    if (!canConfirmGate || gateBusy || !mappedStageId || !backendRun) return;
    setGateBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/cases/FL-DEMO-001/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          actor: `${ROLE_COPY[roleId].label}人员`,
          requestId: `v3-gate-${crypto.randomUUID()}`,
          stageId: mappedStageId,
          flowId: backendRun.currentFlowId,
        }),
      });
      const data = await response.json() as ApiErrorPayload & { receipt?: { receiptId: string } };
      if (!response.ok || !data.receipt) throw new Error(data.error?.message || 'Human Gate 未完成');
      await refreshProjection();
      setDockEntries((items) => [...items, { processId, actor: 'Authority Kernel', text: `Human Gate 已记录，Receipt ${data.receipt!.receiptId}。`, tone: 'system' }]);
      setGateReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Human Gate 未完成');
    } finally {
      setGateBusy(false);
    }
  };

  return <main className="v3-shell">
    <header className="v3-topbar">
      <div className="v3-brand"><span>见微</span><small>小微融资租赁 · AI-Native</small></div>
      <nav className="v3-role-tabs" aria-label="角色应用">
        {(Object.keys(ROLE_COPY) as V3RoleId[]).map((role) => <button key={role} type="button" className={role === roleId ? 'active' : ''} onClick={() => changeRole(role)}><span>{ROLE_COPY[role].label}</span><small>{ROLE_COPY[role].title}</small></button>)}
      </nav>
      <div className="v3-context-pill"><i className={loadState} /><span>共享上下文</span><b>{contextVersion}</b></div>
    </header>

    <div className="v3-layout">
      <aside className="v3-case-panel">
        <div className="v3-panel-head"><div><span>CASE PANEL</span><h1>项目池</h1><p>同一批融资租赁 Case</p></div><b>{V3_CASES.length}</b></div>
        <div className="v3-view-tabs" role="group" aria-label="项目查看维度">
          {([['phase', '阶段'], ['industry', '行业'], ['signal', '异常']] as Array<[CaseView, string]>).map(([id, label]) => <button key={id} type="button" className={caseView === id ? 'active' : ''} onClick={() => setCaseView(id)}>{label}</button>)}
        </div>
        <div className="v3-case-list">
          {sortedCases.map((item) => <button type="button" key={item.caseId} className={`v3-case-card${item.caseId === selectedCase.caseId ? ' selected' : ''}`} onClick={() => { setCaseId(item.caseId); setNotice(''); setGateReview(false); }}>
            <span className="v3-case-card-top"><em>{item.isGolden ? '核心演示' : item.display.phase}</em><i data-signal={item.display.signal}>{SIGNAL_LABEL[item.display.signal]}</i></span>
            <strong>{item.display.title}</strong>
            <small>{item.display.company}</small>
            <span className="v3-case-meta"><b>{item.display.industry}</b><b>{item.display.amount}</b></span>
            <span className="v3-mini-band" aria-label={`起租就绪 ${item.commencementBand} 格`}>
              {[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < item.commencementBand ? 'filled' : ''} />)}
            </span>
            <span className="v3-case-next">下一步 · {item.display.nextMilestone}</span>
          </button>)}
        </div>
      </aside>

      <section className="v3-workspace">
        <section className="v3-case-hero">
          <div className="v3-case-hero-main">
            <div className="v3-hero-tags"><span>{ROLE_COPY[roleId].title}</span><span>小微事业部</span><span>{selectedCase.isGolden ? '直接租赁' : '背景 Case'}</span></div>
            <h2>{selectedCase.display.title}</h2>
            <p>{selectedCase.display.company} · {selectedCase.display.region} · {selectedCase.display.amount}</p>
          </div>
          <div className="v3-case-identity"><span>{selectedCase.caseId}</span><b>{selectedCase.display.phase}</b><small>{SIGNAL_LABEL[selectedCase.display.signal]}信号</small></div>
        </section>

        {selectedCase.isBackground ? <section className="v3-background-summary">
          <div className="v3-background-summary-head"><span>只读项目摘要</span><h3>{selectedCase.readOnlySummary}</h3><p>背景 Case 仅用于组合对比、阶段分布与异常排序，不进入 Golden Case 的完整证据链。</p></div>
          <div className="v3-background-summary-grid">
            <article><span>当前阶段</span><b>{selectedCase.display.phase}</b></article>
            <article><span>下一里程碑</span><b>{selectedCase.display.nextMilestone}</b></article>
            <article><span>起租状态</span><b>{LIFECYCLE_LABEL[selectedCase.leaseLifecycleStatus] ?? selectedCase.leaseLifecycleStatus}</b></article>
          </div>
          <div className="v3-background-band"><span>起租就绪</span><div>{[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < selectedCase.commencementBand ? 'filled' : ''} />)}</div><small>{selectedCase.commencementBand} / 5 档</small></div>
        </section> : <>
        {PRINCIPAL_COPY[roleId] ? <div className="v3-principal-tabs" role="group" aria-label={`${ROLE_COPY[roleId].label}账号权限`}>
          <span>{roleId === 'risk' ? '专业账号' : '协同对象'}</span>
          {PRINCIPAL_COPY[roleId]!.map((principal) => <button key={principal.id} type="button" className={principal.id === principalId ? 'active' : ''} onClick={() => changePrincipal(principal.id, principal.processId)}>{principal.label.replace('账号', '').replace('协同', '')}</button>)}
          <small>{roleId === 'risk' ? '全局可见 · 本专业可确认' : '仅见受邀任务与材料'}</small>
        </div> : null}

        <section className="v3-goal-card">
          <div><span>当前协同目标</span><h3>补齐订单稳定性证据，推动项目具备正式起租条件</h3><p>五路共享同一事实版本；新信息确认后，各路独立更新候选结果。</p></div>
          <div className="v3-goal-state"><span>当前阻断</span><b>{selectedCase.display.nextMilestone}</b><small>{activeMember?.person ?? '协同 Agent'} 正在处理</small></div>
        </section>

        {roleId === 'leadership' && portfolio ? <div className="v3-time-grains" role="group" aria-label="经营时间颗粒度">
          <span>{portfolio.northStar} · 时间口径</span>
          {portfolio.timeGrains.map((grain) => <button type="button" key={grain} className={timeGrain === grain ? 'active' : ''} onClick={() => setTimeGrain(grain)}>{({ day: '日', week: '周', month: '月', quarter: '季', 'half-year': '半年', year: '年' } as const)[grain]}</button>)}
        </div> : null}
        <section className={`v3-metric-strip${roleId === 'leadership' ? ' god-view' : ''}`} aria-label={`${ROLE_COPY[roleId].label}关键指标`}>
          {metricEntries.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
        </section>

        <section className="v3-commencement-section">
          <div className="v3-section-label"><div><span>起租主线</span><h3>{selectedCase.commencementBand === 5 ? '正式起租已完成' : '五路并行汇入同一结果'}</h3></div><p>{LIFECYCLE_LABEL[selectedCase.leaseLifecycleStatus] ?? selectedCase.leaseLifecycleStatus}</p></div>
          <div className={`v3-commencement-line role-${roleId}`}>
            {V3_PROCESS_THREADS.filter((thread) => visibleProcesses.includes(thread.processId)).map((thread) => {
              const copy = PROCESS_COPY[thread.processId];
              const state = processState(thread.processId);
              return <button type="button" key={thread.processId} className={`${state}${thread.processId === processId ? ' selected' : ''}`} onClick={() => { setProcessId(thread.processId); setGateReview(false); setNotice(''); }}>
                <i /><span>{copy.label}</span><small>{COLLABORATION_MEMBERS.find((member) => member.processId === thread.processId)?.status ?? '等待更新'}</small>
              </button>;
            })}
            <div className={`v3-commencement-target${selectedCase.commencementBand === 5 ? ' done' : ''}`}><i /><span>正式起租</span><small>{selectedCase.commencementBand === 5 ? '已起息' : '共同目标'}</small></div>
          </div>
        </section>

        <section className="v3-focus-card">
          <div className="v3-focus-head">
            <div><span>{processCopy.label} · 当前工作</span><h3>{processCopy.title}</h3><p>{processCopy.summary}</p></div>
            <span className={`v3-authority-badge ${roleProjection.readOnly ? 'read-only' : ''}`}>{roleProjection.readOnly ? '只读视图' : '角色工作区'}</span>
          </div>
          <div className="v3-focus-body">
            <article className="v3-situation-card"><span>目前结论</span><b>{processWork.result}</b><small>来源 · {contextVersion}</small></article>
            <article className="v3-action-card"><span>现在要做</span><b>{processWork.action}</b><small>Owner · {processWork.owner}</small></article>
            <article className="v3-handoff-card"><span>完成以后</span><b>{processWork.handoff}</b><small>{canConfirmGate ? '需要具名人工确认并生成回执' : '系统持续观察后续更新'}</small></article>
          </div>
          <div className="v3-readiness-row">
            <div><span>{processCopy.label}准备度</span><small>只显示五档，不显示精确百分比</small></div>
            <div className="v3-neutral-grid">
              {processThread.slots.map((slot, index) => <i key={slot.slotId} className={slotState(index)} aria-label={`第 ${index + 1} 档 ${slotState(index)}`} />)}
            </div>
            {canConfirmGate ? <button type="button" className="v3-primary-action" onClick={() => setGateReview(true)}>人工确认</button> : <span className="v3-observe-note">{roleProjection.readOnly ? '可追问、可协调，不替专业人员作决定' : '等待当前条件满足'}</span>}
          </div>
          {gateReview ? <div className="v3-confirm-box"><div><span>确认权威写入</span><b>提交 {processCopy.label} 当前候选</b><p>关联 {selectedCase.caseId} / {contextVersion}；聊天本身不会触发正式动作。</p></div><button type="button" onClick={() => setGateReview(false)}>返回</button><button type="button" className="confirm" disabled={gateBusy} onClick={() => void confirmGate()}>{gateBusy ? '记录中…' : '确认并生成回执'}</button></div> : null}
        </section>
        </>}
      </section>

      <aside className="v3-dock">
        <div className="v3-dock-head"><div><span>{selectedCase.isGolden ? 'CASE GROUP' : 'CASE SUMMARY'}</span><h2>{selectedCase.isGolden ? '项目群聊' : '项目摘要'}</h2><p>{selectedCase.display.title}</p></div><div className="v3-live"><i className={loadState} /><span>{selectedCase.isGolden ? `${collaborationMembers.length} 路在线` : '只读'}</span></div></div>
        {selectedCase.isBackground ? <section className="v3-background-dock">
          <span>READ-ONLY PROJECTION</span>
          <h3>{selectedCase.display.phase}</h3>
          <p>{selectedCase.readOnlySummary}</p>
          <dl><div><dt>行业</dt><dd>{selectedCase.display.industry}</dd></div><div><dt>区域</dt><dd>{selectedCase.display.region}</dd></div><div><dt>金额</dt><dd>{selectedCase.display.amount}</dd></div></dl>
          <div><span>下一里程碑</span><b>{selectedCase.display.nextMilestone}</b></div>
          <small>切回核心演示 Case 可进入完整五路协同与项目群聊。</small>
        </section> : <>
        <div className="v3-dock-goal"><span>协同目标</span><b>补齐关键证据，推动正式起租</b><small>{contextVersion} · 信息确认后触发五路更新</small></div>
        <div className="v3-member-list" aria-label="当前协同成员">
          {collaborationMembers.map((member) => <button type="button" key={member.processId} className={`${member.state}${member.processId === processId ? ' active' : ''}`} onClick={() => mentionProcess(member.processId)}>
            <span>{PROCESS_COPY[member.processId].label}</span><div><b>{member.person}</b><small>{member.status}</small></div><i />
          </button>)}
        </div>
        <div className="v3-chat-divider"><span>最新进展</span><small>{ROLE_COPY[roleId].label}视角 · 按需共享上下文</small></div>
        <div className="v3-dock-log">
          {dockFeed.map((entry, index) => <article key={`${entry.actor}-${index}`} className={entry.tone}>
            <div className="v3-message-avatar">{PROCESS_COPY[entry.processId].label}</div>
            <div><span>{entry.actor}<time>{entry.time ?? '刚刚'}</time></span><p>{entry.text}</p></div>
          </article>)}
        </div>

        {evidenceOpen ? <section className="v3-evidence-draft">
          <span>{roleId === 'external' ? '受邀材料提交' : '共享信息接入'}</span>
          <label>标题<input value={evidenceTitle} onChange={(event) => { setEvidenceTitle(event.target.value); setEvidenceReview(false); }} /></label>
          <label>事实摘要<textarea value={evidenceSummary} onChange={(event) => { setEvidenceSummary(event.target.value); setEvidenceReview(false); }} /></label>
          {!evidenceReview ? <button type="button" disabled={!evidenceTitle.trim() || !evidenceSummary.trim()} onClick={() => setEvidenceReview(true)}>检查后确认</button> : <div className="v3-evidence-review"><b>确认后将：</b><p>写入 {selectedCase.caseId} / {contextVersion}，生成 Event 与 Receipt，并触发共享 Context 更新。</p><button type="button" onClick={() => setEvidenceReview(false)}>修改</button><button type="button" className="confirm" disabled={evidenceBusy} onClick={() => void confirmEvidence()}>{evidenceBusy ? '写入中…' : '确认并触发'}</button></div>}
        </section> : null}

        {notice ? <p className="v3-notice" role="alert">{notice}</p> : null}
        <div className="v3-dock-actions">
          {canWriteEvidence ? <button type="button" onClick={() => { setEvidenceOpen((open) => !open); setEvidenceReview(false); }}>{evidenceOpen ? '收起材料' : '上传材料 / 确认事实'}</button> : null}
          {selectedCase.isGolden && !mappedStageId ? <small>当前消息路由尚未接入；材料确认仍可正常进入共享上下文。</small> : null}
        </div>
        <div className="v3-mention-row" aria-label="快速提及">
          {collaborationMembers.map((member) => <button key={member.processId} type="button" onClick={() => mentionProcess(member.processId)}>@{PROCESS_COPY[member.processId].label}</button>)}
        </div>
        <form className="v3-chat-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={`向 ${processCopy.label} 人员与 Agent 提问…`} />
          <button type="submit" disabled={!chatInput.trim() || chatBusy || !canUseGoldenBackend || !mappedStageId}>{chatBusy ? '处理中' : '发送'}</button>
        </form>
        </>}
      </aside>
    </div>
  </main>;
}
