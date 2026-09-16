'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createV3ClientSession,
  v3Api,
  type V3CasePanelDto,
  type V3CasePanelItemDto,
  type V3ClientPrincipalId,
  type V3ClientProcessId,
  type V3ClientRoleId,
  type V3ContextHistoryDto,
  type V3DemoSessionDto,
  type V3PortfolioProjectionDto,
  type V3ProcessProjectionDto,
  type V3ReceiptRefDto,
  type V3RoleProjectionDto,
} from '../lib/v3-client';

type LoadState = 'loading' | 'ready' | 'error';
type CaseView = 'phase' | 'industry' | 'signal';
type LeadershipMode = 'portfolio' | 'case';
type DockEntry = {
  caseId: string;
  contextVersion: string;
  processId: V3ClientProcessId;
  actor: string;
  text: string;
  kind: 'ordinary' | 'candidate' | 'evidence' | 'context-commit' | 'gate' | 'action';
  tone: 'system' | 'agent' | 'human';
  time?: string;
};

const PROCESS_IDS: V3ClientProcessId[] = ['opportunity', 'policy', 'credit', 'commercial', 'asset'];
const ROLE_IDS: V3ClientRoleId[] = ['leadership', 'business', 'risk', 'external'];
const ROLE_COPY: Record<V3ClientRoleId, { label: string; title: string; subtitle: string }> = {
  leadership: { label: '协同', title: '协同驾驶舱', subtitle: '围绕净利润、关键偏差与正式起租组织共同判断' },
  business: { label: '业务', title: '业务工作台', subtitle: '以完整 Case Context 组织商机、材料与跨专业接续' },
  risk: { label: '风控', title: '风控工作台', subtitle: '五路信息全局可见，专业 Gate 按账号权限隔离' },
  external: { label: '外联', title: '外联工作台', subtitle: '客户与供应商只看到受邀任务、进度与待解决问题' },
};
const PROCESS_COPY: Record<V3ClientProcessId, { label: string; title: string; summary: string; owner: string; result: string; action: string; handoff: string }> = {
  opportunity: { label: '商机', title: '商机事实与协同容器', summary: '承接购机动机、项目背景、材料导入与进入专业判断前的关键事实。', owner: '陈屿 · 业务', result: '购机动机、设备清单与供应商报价已进入共享上下文。', action: '确认下游订单是否足以支撑本次扩产。', handoff: '具名确认后，五路同时读取新的 Context。' },
  policy: { label: '政策', title: '规则、准入与例外', summary: '解释当前 Context 命中的规则、例外与需要确认的政策影响。', owner: '林澄 · 政策', result: '主体准入未见硬阻断，保留一项首次合作厂商例外。', action: '核对例外适用条件与所需补充依据。', handoff: '形成政策候选，等待政策账号确认。' },
  credit: { label: '信审', title: 'Evidence 与专业判断', summary: '组织材料、事实冲突、补件与需要有权人员完成的 Human Gate。', owner: '周岚 · 信审', result: '当前材料支持继续推进，涉诉事实出现后需要补件复核。', action: '核验最近六个月交付、回款与涉诉化解材料。', handoff: '信审账号确认后释放商务起租条件复核。' },
  commercial: { label: '商务', title: '起租条件执行线', summary: '跟踪交易条件、付款前提与正式起租的可验证结果。', owner: '顾衡 · 商务', result: '首次合作厂商采用货到付款，付款前提已预置。', action: '取得物流查验与设备一致性回执。', handoff: '必要 Gate 齐备后，由商务正式记录起租。' },
  asset: { label: '资产', title: '资产辅助预判', summary: '形成查验建议、未来风险窗口与租后观察，不复制信审流程。', owner: '许棠 · 资产', result: '已形成到货查验窗口与首个租后风险观察建议。', action: '确认设备到货后 48 小时现场查验安排。', handoff: '查验结果回流商务，并保留后续风险观察。' },
};
const ROLE_DEFAULT_PRINCIPAL: Record<V3ClientRoleId, V3ClientPrincipalId> = {
  leadership: 'collaboration-manager', business: 'business-owner', risk: 'risk-credit', external: 'external-customer',
};
const ROLE_DEFAULT_PROCESS: Record<V3ClientRoleId, V3ClientProcessId> = {
  leadership: 'credit', business: 'opportunity', risk: 'credit', external: 'opportunity',
};
const PRINCIPALS: Partial<Record<V3ClientRoleId, Array<{ id: V3ClientPrincipalId; label: string; processId: V3ClientProcessId }>>> = {
  risk: [
    { id: 'risk-policy', label: '政策', processId: 'policy' },
    { id: 'risk-credit', label: '信审', processId: 'credit' },
    { id: 'risk-commercial', label: '商务', processId: 'commercial' },
    { id: 'risk-asset', label: '资产', processId: 'asset' },
  ],
  external: [
    { id: 'external-customer', label: '客户', processId: 'opportunity' },
    { id: 'external-supplier', label: '供应商', processId: 'commercial' },
  ],
};
const SIGNAL_LABEL = { normal: '平稳', attention: '关注', elevated: '上升' } as const;
const LIFECYCLE_LABEL: Record<string, string> = { pre_commencement: '起租前', material_collection: '材料形成中', active_lease: '正常在租', closed: '已关闭' };
const GRAIN_LABEL = { day: '日', week: '周', month: '月', quarter: '季', 'half-year': '半年', year: '年' } as const;
const INITIAL_DOCK: DockEntry[] = [
  { caseId: 'FL-DEMO-001', contextVersion: 'CTX-0000', processId: 'opportunity', actor: '商机 Agent', text: '购机动机、设备清单与供应商报价已形成候选事实包。', kind: 'candidate', tone: 'agent', time: '14:06' },
  { caseId: 'FL-DEMO-001', contextVersion: 'CTX-0000', processId: 'policy', actor: '林澄 · 政策', text: '主体准入没有硬阻断；首次合作厂商例外需要商务一并核验。', kind: 'ordinary', tone: 'human', time: '14:08' },
  { caseId: 'FL-DEMO-001', contextVersion: 'CTX-0000', processId: 'credit', actor: '周岚 · 信审', text: '请业务补充订单持续性与回款安排，确认后再进入权威 Context。', kind: 'ordinary', tone: 'human', time: '14:12' },
];

function stateForRun(run: V3ProcessProjectionDto | undefined) {
  if (!run) return 'waiting';
  if (run.gateState === 'confirmed' || run.runStatus === 'completed') return 'done';
  if (run.runStatus === 'needs_input' || run.runStatus === 'failed') return 'attention';
  if (['running', 'partial', 'ready_for_gate'].includes(run.runStatus)) return 'working';
  return 'waiting';
}

function labelForRun(run: V3ProcessProjectionDto | undefined) {
  if (!run) return '尚未触发';
  if (run.gateState === 'confirmed') return '专业已确认';
  const labels: Record<string, string> = { queued: '已触发', running: 'Agent 处理中', partial: '候选已更新', needs_input: '需要补件', ready_for_gate: '等待人工确认', completed: '本轮完成', failed: '处理失败' };
  return labels[run.runStatus] ?? run.runStatus;
}

function externalWork(principalId: V3ClientPrincipalId) {
  return principalId === 'external-supplier'
    ? { result: '设备交付与付款相关信息正在协同核验。', action: '提交设备、物流或到货查验材料。', owner: '供应商项目联系人', handoff: '材料被接收后等待业务合并确认。' }
    : { result: '租赁公司正在核验本项目的商机事实与风险材料。', action: '按当前问题提交客户事实或补充材料。', owner: '客户项目联系人', handoff: '材料被接收后等待租赁公司具名确认。' };
}

export default function V3LiveShell() {
  const [roleId, setRoleId] = useState<V3ClientRoleId>('leadership');
  const [principalId, setPrincipalId] = useState<V3ClientPrincipalId>('collaboration-manager');
  const [session, setSession] = useState<V3DemoSessionDto | null>(null);
  const [panel, setPanel] = useState<V3CasePanelDto | null>(null);
  const [caseId, setCaseId] = useState('FL-DEMO-001');
  const [caseView, setCaseView] = useState<CaseView>('phase');
  const [leadershipMode, setLeadershipMode] = useState<LeadershipMode>('portfolio');
  const [processId, setProcessId] = useState<V3ClientProcessId>('credit');
  const [projection, setProjection] = useState<V3RoleProjectionDto | null>(null);
  const [contexts, setContexts] = useState<V3ContextHistoryDto | null>(null);
  const [portfolio, setPortfolio] = useState<V3PortfolioProjectionDto | null>(null);
  const [timeGrain, setTimeGrain] = useState<V3PortfolioProjectionDto['timeGrains'][number]>('quarter');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [notice, setNotice] = useState('');
  const [dockEntries, setDockEntries] = useState<DockEntry[]>(INITIAL_DOCK);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceReview, setEvidenceReview] = useState(false);
  const [evidenceTitle, setEvidenceTitle] = useState('下游订单稳定性补充说明');
  const [evidenceSummary, setEvidenceSummary] = useState('补充订单持续性、交付节奏与回款安排的事实摘要。');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [gateReview, setGateReview] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [managementReview, setManagementReview] = useState(false);
  const [commencementReview, setCommencementReview] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const sessionCache = useRef(new Map<V3ClientPrincipalId, V3DemoSessionDto>());
  const controllerSessionRef = useRef<string | null>(null);
  const requestEpoch = useRef(0);
  const caseIdRef = useRef(caseId);

  useEffect(() => {
    caseIdRef.current = caseId;
  }, [caseId]);

  const clearScopedUi = useCallback(() => {
    setProjection(null);
    setContexts(null);
    setNotice('');
    setChatInput('');
    setEvidenceOpen(false);
    setEvidenceReview(false);
    setGateReview(false);
    setManagementReview(false);
    setCommencementReview(false);
  }, []);

  const readProjectionSet = useCallback(async (activeSession: V3DemoSessionDto, activeCaseId: string, signal?: AbortSignal) => {
    const [nextProjection, nextContexts] = await Promise.all([
      v3Api<V3RoleProjectionDto>(`/api/v3/cases/${activeCaseId}/projection`, { sessionId: activeSession.sessionId, signal }),
      v3Api<V3ContextHistoryDto>(`/api/v3/cases/${activeCaseId}/context-versions`, { sessionId: activeSession.sessionId, signal }),
    ]);
    return { nextProjection, nextContexts };
  }, []);

  const refreshCurrent = useCallback(async () => {
    if (!session) return null;
    const { nextProjection, nextContexts } = await readProjectionSet(session, caseId);
    setProjection(nextProjection);
    setContexts(nextContexts);
    setPanel(await v3Api<V3CasePanelDto>('/api/v3/cases', { sessionId: session.sessionId }));
    if (session.roleApplicationId === 'leadership') setPortfolio(await v3Api<V3PortfolioProjectionDto>('/api/v3/portfolio/projection', { sessionId: session.sessionId }));
    return nextProjection;
  }, [caseId, readProjectionSet, session]);

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    const controller = new AbortController();
    void (async () => {
      try {
        let nextSession = sessionCache.current.get(principalId);
        if (!nextSession) {
          const created = await createV3ClientSession(principalId, controller.signal);
          nextSession = created.session;
          sessionCache.current.set(principalId, nextSession);
        }
        const nextPanel = await v3Api<V3CasePanelDto>('/api/v3/cases', { sessionId: nextSession.sessionId, signal: controller.signal });
        const requestedCaseId = caseIdRef.current;
        const nextCaseId = nextPanel.items.some((item) => item.caseId === requestedCaseId) ? requestedCaseId : nextPanel.items[0]?.caseId;
        if (!nextCaseId) throw new Error('当前账号没有可见 Case');
        const [{ nextProjection, nextContexts }, nextPortfolio] = await Promise.all([
          readProjectionSet(nextSession, nextCaseId, controller.signal),
          nextSession.roleApplicationId === 'leadership' ? v3Api<V3PortfolioProjectionDto>('/api/v3/portfolio/projection', { sessionId: nextSession.sessionId, signal: controller.signal }) : Promise.resolve(null),
        ]);
        if (epoch !== requestEpoch.current) return;
        setSession(nextSession);
        setPanel(nextPanel);
        setCaseId(nextCaseId);
        setProjection(nextProjection);
        setContexts(nextContexts);
        setPortfolio(nextPortfolio);
        setLoadState('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError' && epoch === requestEpoch.current) {
          setLoadState('error');
          setNotice(error instanceof Error ? error.message : '角色视图载入失败');
        }
      }
    })();
    return () => controller.abort();
  }, [principalId, readProjectionSet, retryNonce]);

  const cases = useMemo(() => panel?.items ?? [], [panel]);
  const activeKpis = portfolio?.kpiWindows?.[timeGrain] ?? portfolio?.kpis ?? [];
  const selectedCase = cases.find((item) => item.caseId === caseId) ?? cases[0];
  const contextVersion = projection?.contextVersion ?? (selectedCase?.caseTier === 'background' ? `summary-${caseId.toLowerCase()}` : 'context-loading');
  const externalProcess = projection?.scope?.externalTask?.workstepProcessId;
  const visibleProcesses = selectedCase?.caseTier === 'background' ? [] : roleId === 'external' && externalProcess ? [externalProcess] : projection?.scope?.visibleProcessIds ?? [];
  const currentRun = projection?.processProjections.find((run) => run.processId === processId);
  const allowed = (actionType: string) => projection?.allowedActions.some((item) => item.actionType === actionType && item.enabled) ?? false;
  const canUseGolden = selectedCase?.caseTier === 'golden' && loadState === 'ready' && Boolean(session);
  const canStageEvidence = canUseGolden && allowed('submit_evidence') && (
    (principalId === 'business-owner' && contextVersion === 'CTX-0000') ||
    (principalId === 'external-customer' && ['CTX-0001', 'CTX-0002'].includes(contextVersion)) ||
    (principalId === 'external-supplier' && contextVersion === 'CTX-0002')
  );
  const currentEvidence = projection?.visibleReceiptRefs.filter((receipt) => receipt.receiptType === 'evidence' && receipt.contextVersion === contextVersion) ?? [];
  const currentContext = contexts?.items.find((item) => item.isCurrent);
  const gateEvidenceReceiptIds = currentContext?.sourceReceiptIds ?? currentEvidence.map((receipt) => receipt.receiptId);
  const externalEvidenceAccepted = roleId === 'external' && currentEvidence.some((receipt) => receipt.principalId === principalId);
  const externalBand = roleId !== 'external' ? 0 : projection?.commencementState.band === 5 ? 5 : contextVersion === 'CTX-0003' ? 4 : contextVersion === 'CTX-0002' ? (externalEvidenceAccepted ? 3 : 2) : contextVersion === 'CTX-0001' ? 1 : 0;
  const externalStatus = externalBand === 5 ? '项目已起租' : externalEvidenceAccepted ? '材料已接收' : contextVersion === 'CTX-0002' ? '等待补充材料' : contextVersion === 'CTX-0003' ? '租赁公司处理中' : '等待租赁公司发起';
  const customerReceipt = [...currentEvidence].reverse().find((receipt) => receipt.principalId === 'external-customer');
  const supplierReceipt = [...currentEvidence].reverse().find((receipt) => receipt.principalId === 'external-supplier');
  const canCommitT3 = principalId === 'business-owner' && contextVersion === 'CTX-0002' && Boolean(customerReceipt && supplierReceipt);
  const canConfirmGate = canUseGolden && allowed('professional_gate') && currentRun?.runStatus === 'ready_for_gate' && currentRun.gateState !== 'confirmed' && gateEvidenceReceiptIds.length > 0;
  const gateReceipts = projection?.visibleReceiptRefs.filter((receipt) => receipt.receiptType === 'human_gate' && receipt.status === 'confirm' && receipt.contextVersion === contextVersion) ?? [];
  const canCommence = principalId === 'risk-commercial' && allowed('commencement_action') && ['policy', 'credit', 'commercial'].every((required) => gateReceipts.some((receipt) => receipt.processId === required));
  const processCopy = PROCESS_COPY[processId];
  const work = roleId === 'external' ? externalWork(principalId) : processCopy;
  const latestReceipts = projection?.visibleReceiptRefs.slice(-3).reverse() ?? [];
  const scopedDock = dockEntries.filter((entry) => entry.caseId === caseId && visibleProcesses.includes(entry.processId));

  const groupedCases = useMemo(() => {
    const groups = new Map<string, V3CasePanelItemDto[]>();
    for (const item of cases) {
      const key = caseView === 'phase' ? item.phase : caseView === 'industry' ? item.industry : SIGNAL_LABEL[item.signal];
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [caseView, cases]);

  const openCase = async (nextCaseId: string) => {
    if (!session) return;
    if (nextCaseId === caseId) {
      if (roleId === 'leadership') setLeadershipMode('case');
      return;
    }
    setLoadState('loading');
    clearScopedUi();
    setCaseId(nextCaseId);
    try {
      const { nextProjection, nextContexts } = await readProjectionSet(session, nextCaseId);
      setProjection(nextProjection);
      setContexts(nextContexts);
      if (roleId === 'leadership') setLeadershipMode('case');
      setLoadState('ready');
    } catch (error) {
      setLoadState('error');
      setNotice(error instanceof Error ? error.message : 'Case 载入失败');
    }
  };

  const switchRole = (nextRole: V3ClientRoleId) => {
    setLoadState('loading');
    clearScopedUi();
    setRoleId(nextRole);
    setPrincipalId(ROLE_DEFAULT_PRINCIPAL[nextRole]);
    setProcessId(ROLE_DEFAULT_PROCESS[nextRole]);
    setLeadershipMode(nextRole === 'leadership' ? 'portfolio' : 'case');
    setDockEntries(nextRole === 'external' ? [] : INITIAL_DOCK);
  };

  const switchPrincipal = (nextPrincipalId: V3ClientPrincipalId, nextProcessId: V3ClientProcessId) => {
    setLoadState('loading');
    clearScopedUi();
    setPrincipalId(nextPrincipalId);
    setProcessId(nextProcessId);
    setDockEntries([]);
  };

  const ensureControllerSession = async () => {
    if (controllerSessionRef.current) return controllerSessionRef.current;
    const cached = sessionCache.current.get('collaboration-manager');
    if (cached) {
      controllerSessionRef.current = cached.sessionId;
      return cached.sessionId;
    }
    const created = await createV3ClientSession('collaboration-manager');
    sessionCache.current.set('collaboration-manager', created.session);
    controllerSessionRef.current = created.session.sessionId;
    return created.session.sessionId;
  };

  const simulateRuns = async (runs: Array<{ runId: string; processId: V3ClientProcessId }>, label: string) => {
    const controllerSessionId = await ensureControllerSession();
    await Promise.all(runs.map((run) => v3Api('/api/v3/demo/process-runs/advance', { method: 'POST', sessionId: controllerSessionId, body: { requestId: `${label}-start-${run.processId}-${crypto.randomUUID()}`, runId: run.runId, phase: 'start' } })));
    await refreshCurrent();
    for (const candidate of ['policy', 'opportunity', 'commercial', 'credit', 'asset'] as V3ClientProcessId[]) {
      const run = runs.find((item) => item.processId === candidate);
      if (!run) continue;
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      await v3Api('/api/v3/demo/process-runs/advance', { method: 'POST', sessionId: controllerSessionId, body: { requestId: `${label}-result-${candidate}-${crypto.randomUUID()}`, runId: run.runId, phase: 'result' } });
      await refreshCurrent();
    }
  };

  const sendMessage = async () => {
    const message = chatInput.trim();
    if (!message || chatBusy || !session || !canUseGolden || !allowed('chat')) return;
    setChatBusy(true);
    setNotice('');
    setChatInput('');
    setDockEntries((items) => [...items, { caseId, contextVersion, processId, actor: '我', text: message, kind: 'ordinary', tone: 'human' }]);
    try {
      await v3Api(`/api/v3/cases/${caseId}/messages`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-message-${crypto.randomUUID()}`, message, processId } });
      setDockEntries((items) => [...items, { caseId, contextVersion, processId, actor: `${processCopy.label} Agent`, text: '已按当前角色最小 Context 接收问题；这是候选协同，不产生业务 Authority。', kind: 'candidate', tone: 'agent' }]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '消息发送失败');
    } finally {
      setChatBusy(false);
    }
  };

  const acceptEvidence = async () => {
    if (!canStageEvidence || evidenceBusy || !session) return;
    setEvidenceBusy(true);
    setNotice('');
    try {
      const token = crypto.randomUUID();
      const evidence = await v3Api<{ receipt: V3ReceiptRefDto }>(`/api/v3/cases/${caseId}/evidence`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-evidence-${token}`, evidenceId: `E-UI-${token}`, evidenceType: principalId === 'external-supplier' ? 'device_delivery_pack' : principalId === 'external-customer' ? 'customer_fact_pack' : 'opportunity_fact_pack', sourceRef: `demo://ui/${principalId}/${token}`, contentHash: `sha256:${token.replaceAll('-', '')}`, processId: principalId === 'external-supplier' ? 'commercial' : 'opportunity' } });
      setDockEntries((items) => [...items, { caseId, contextVersion, processId, actor: 'Authority Kernel', text: `Evidence 已接收：${evidence.receipt.receiptId}。已进入 pending batch，尚未自动更新 Context。`, kind: 'evidence', tone: 'system' }]);
      let commit: null | { context: { contextVersion: string }; runs: Array<{ runId: string; processId: V3ClientProcessId }> } = null;
      if (principalId === 'business-owner' && contextVersion === 'CTX-0000') {
        commit = await v3Api(`/api/v3/cases/${caseId}/context-commits`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-t1-${token}`, transitionCode: 'T1', expectedContextVersion: contextVersion, evidenceReceiptIds: [evidence.receipt.receiptId], confirmedFactIds: ['customer-intent', 'device-purpose'], rationale: '业务具名确认商机事实包' } });
      } else if (principalId === 'external-customer' && contextVersion === 'CTX-0001') {
        commit = await v3Api(`/api/v3/cases/${caseId}/context-commits`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-t2-${token}`, transitionCode: 'T2', expectedContextVersion: contextVersion, evidenceReceiptIds: [evidence.receipt.receiptId], confirmedFactIds: ['material-litigation-risk'], rationale: '客户在受邀步骤具名确认风险事实' } });
      }
      if (commit) {
        setDockEntries((items) => [...items, { caseId, contextVersion: commit!.context.contextVersion, processId, actor: 'Authority Kernel', text: `${commit!.context.contextVersion} 已形成，五路异步运行已触发。`, kind: 'context-commit', tone: 'system' }]);
        await simulateRuns(commit.runs, `ui-${commit.context.contextVersion}`);
      } else await refreshCurrent();
      setEvidenceOpen(false);
      setEvidenceReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Evidence 接收失败');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const commitT3 = async () => {
    if (!canCommitT3 || !session || !customerReceipt || !supplierReceipt) return;
    setEvidenceBusy(true);
    try {
      const commit = await v3Api<{ context: { contextVersion: string }; runs: Array<{ runId: string; processId: V3ClientProcessId }> }>(`/api/v3/cases/${caseId}/context-commits`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-t3-${crypto.randomUUID()}`, transitionCode: 'T3', expectedContextVersion: contextVersion, evidenceReceiptIds: [customerReceipt.receiptId, supplierReceipt.receiptId], confirmedFactIds: ['risk-remediated', 'device-delivery-confirmed'], rationale: '业务具名合并客户与供应商 Evidence，形成唯一 T3' } });
      setDockEntries((items) => [...items, { caseId, contextVersion: commit.context.contextVersion, processId: 'opportunity', actor: 'Authority Kernel', text: '客户与供应商 Evidence 已合并为 T3，五路基于同一 Context 重新运行。', kind: 'context-commit', tone: 'system' }]);
      await simulateRuns(commit.runs, 'ui-t3');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'T3 确认失败');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const confirmGate = async () => {
    if (!canConfirmGate || !session) return;
    setGateBusy(true);
    try {
      const result = await v3Api<{ receipt: V3ReceiptRefDto }>(`/api/v3/cases/${caseId}/gates/${processId}/decisions`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-gate-${processId}-${crypto.randomUUID()}`, expectedContextVersion: contextVersion, gateMode: processId === 'credit' ? 'HUMAN_DECIDE' : 'HUMAN_CONFIRM', decision: 'confirm', rationale: `${processCopy.label}专业人员确认当前候选`, evidenceReceiptIds: gateEvidenceReceiptIds } });
      await refreshCurrent();
      setDockEntries((items) => [...items, { caseId, contextVersion, processId, actor: 'Authority Kernel', text: `${processCopy.label} Gate 已具名确认：${result.receipt.receiptId}`, kind: 'gate', tone: 'system' }]);
      setGateReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Human Gate 未完成');
    } finally {
      setGateBusy(false);
    }
  };

  const confirmManagement = async () => {
    if (!session || !projection?.projectionVersion || !allowed('management_action')) return;
    setActionBusy(true);
    try {
      const result = await v3Api<{ receipt: V3ReceiptRefDto }>(`/api/v3/cases/${caseId}/actions/management`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-management-${crypto.randomUUID()}`, expectedContextVersion: contextVersion, actionCode: 'REQUEST_CROSS_FUNCTION_REVIEW', targetPrincipalIds: ['business-owner', 'risk-credit'], rationale: '请业务与信审围绕当前阻断形成可执行复核意见', evidenceOrProjectionRefs: [projection.projectionVersion] } });
      await refreshCurrent();
      setDockEntries((items) => [...items, { caseId, contextVersion, processId, actor: 'Authority Kernel', text: `协同要求已记录：${result.receipt.receiptId}。它不会改写专业 Gate。`, kind: 'action', tone: 'system' }]);
      setManagementReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '协同要求记录失败');
    } finally {
      setActionBusy(false);
    }
  };

  const confirmCommencement = async () => {
    if (!session || !projection?.commencementState.conditionSetVersion || !canCommence) return;
    setActionBusy(true);
    try {
      const result = await v3Api<{ receipt: V3ReceiptRefDto }>(`/api/v3/cases/${caseId}/actions/commencement`, { method: 'POST', sessionId: session.sessionId, body: { requestId: `ui-commencement-${crypto.randomUUID()}`, expectedContextVersion: contextVersion, conditionSetVersion: projection.commencementState.conditionSetVersion, requiredReceiptIds: gateReceipts.map((receipt) => receipt.receiptId), rationale: '必要 Gate、合同、交付与付款条件已满足，正式起租' } });
      await refreshCurrent();
      setDockEntries((items) => [...items, { caseId, contextVersion, processId: 'commercial', actor: 'Authority Kernel', text: `正式起租已记录：${result.receipt.receiptId}。Case、Portfolio 与净利润预测同源更新。`, kind: 'action', tone: 'system' }]);
      setCommencementReview(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '正式起租未完成');
    } finally {
      setActionBusy(false);
    }
  };

  const slotState = (index: number) => {
    if (roleId === 'external') {
      if (index < externalBand) return 'completed';
      if (index === externalBand && externalBand < 5) return 'active';
      return 'locked';
    }
    if (!currentRun) return 'locked';
    if (index < currentRun.readinessBand) return 'completed';
    if (index === currentRun.readinessBand && ['running', 'partial', 'needs_input', 'ready_for_gate'].includes(currentRun.runStatus)) return 'active';
    return 'locked';
  };

  const renderGodView = () => <section className="v3-god-view" data-testid="god-view">
    <div className="v3-god-head"><div><span>GOD VIEW · 小微事业部</span><h2>净利润偏差从哪里来，下一步组织谁行动</h2><p>Portfolio → 小微事业部 → FinancingLeasingCase；只下发协同要求，不替专业人员决策。</p></div><button type="button" onClick={() => setLeadershipMode('case')}>进入 Golden Case</button></div>
    <div className="v3-time-grains" role="group" aria-label="经营时间颗粒度" data-testid="kpi-granularity"><span>{portfolio?.northStar ?? '净利润'} · 时间口径</span>{(['year', 'half-year', 'quarter', 'month', 'week', 'day'] as V3PortfolioProjectionDto['timeGrains']).map((grain) => <button type="button" key={grain} data-granularity={grain} className={timeGrain === grain ? 'active' : ''} onClick={() => setTimeGrain(grain)}>{GRAIN_LABEL[grain]}</button>)}</div>
    <div className="v3-kpi-board">{activeKpis.map((metric) => <article key={metric.metricId} data-kpi-id={metric.metricId}><div><span>{metric.label}</span><i data-trend={metric.trend}>{metric.trend === 'improving' ? '改善' : metric.trend === 'stable' ? '稳定' : '低于计划'}</i></div><strong data-field="actual">{metric.current}<small>{metric.unit}</small></strong><dl><div><dt>目标</dt><dd data-field="target">{metric.target}{metric.unit}</dd></div><div><dt>应达</dt><dd data-field="due">{metric.due}{metric.unit}</dd></div><div><dt>差值</dt><dd data-field="delta">{metric.deltaToDue > 0 ? '+' : ''}{metric.deltaToDue}{metric.unit}</dd></div></dl><small data-field="trend">{metric.valueClass === 'forecast' ? '预测口径' : '运营投影'} · {GRAIN_LABEL[timeGrain]}</small></article>)}</div>
    <section className="v3-deviation-chart" data-testid="kpi-deviation-chart"><div><span>经营偏差谱 · {GRAIN_LABEL[timeGrain]}</span><b>实际 / 应达 / 目标同口径</b></div>{activeKpis.map((metric) => { const ceiling = Math.max(metric.target, metric.due, metric.current, 1); return <article key={metric.metricId}><span>{metric.label}</span><div><i style={{ width: `${Math.max(4, Math.min(100, metric.current / ceiling * 100))}%` }} /><b style={{ left: `${Math.min(100, metric.due / ceiling * 100)}%` }} /></div><small>{metric.current}{metric.unit} / 应达 {metric.due}{metric.unit}</small></article>; })}</section>
    <section className="v3-portfolio-projection" data-testid="portfolio-projection"><div><span>最大经营偏差</span><h3>{portfolio?.drilldown?.largestDeviation ?? '正在定位偏差来源'}</h3><p>系统只聚合超期、偏差、风险上升与关键假设失效。</p></div><div className="v3-portfolio-cases">{cases.map((item) => <button type="button" key={item.caseId} data-case-id={item.caseId} onClick={() => void openCase(item.caseId)}><span data-signal={item.signal}>{SIGNAL_LABEL[item.signal]}</span><b>{item.title}</b><small>{item.phase} · {item.nextMilestone}</small></button>)}</div></section>
  </section>;

  const renderCaseWorkspace = () => {
    if (!selectedCase) return <div className="v3-state-card">当前账号没有可见 Case。</div>;
    if (selectedCase.caseTier === 'background') return <section className="v3-background-summary"><div className="v3-background-summary-head"><span>只读项目摘要</span><h3>{selectedCase.roleScopedSummary}</h3><p>背景 Case 仅用于组合对比、阶段分布与异常排序，不进入 Golden Case 的完整证据链。</p></div><div className="v3-background-summary-grid"><article><span>当前阶段</span><b>{selectedCase.phase}</b></article><article><span>下一里程碑</span><b>{selectedCase.nextMilestone}</b></article><article><span>起租状态</span><b>{LIFECYCLE_LABEL[selectedCase.lifecycleStatus] ?? selectedCase.lifecycleStatus}</b></article></div><div className="v3-background-band"><span>起租就绪</span><div data-testid="readiness-band">{[0, 1, 2, 3, 4].map((index) => <i key={index} data-band-cell className={index < selectedCase.commencementBand ? 'filled' : ''} />)}</div><small>{selectedCase.commencementBand === 5 ? '已起租' : '推进中'}</small></div></section>;
    const metrics = roleId === 'leadership' && activeKpis.length ? activeKpis.slice(0, 4).map((metric) => [metric.label, `${metric.current}${metric.unit} / 应达 ${metric.due}${metric.unit}`]) : roleId === 'business' ? [['待确认事实', '03'], ['并行协同', '05 路'], ['最近更新', '刚刚']] : roleId === 'risk' ? [['政策例外', '01'], ['信审补件', '02'], ['待专业确认', '01']] : [['当前任务', '01'], ['回执', '可追溯'], ['信息范围', '受邀']];
    return <>
      {roleId === 'leadership' ? <button className="v3-back-to-portfolio" type="button" onClick={() => setLeadershipMode('portfolio')}>← 返回经营组合</button> : null}
      {PRINCIPALS[roleId] ? <div className="v3-principal-tabs" data-testid={roleId === 'risk' ? 'risk-principals' : 'external-principals'}><span>{roleId === 'risk' ? '专业账号' : '受邀对象'}</span>{PRINCIPALS[roleId]!.map((principal) => <button type="button" key={principal.id} data-principal-id={principal.id} className={principal.id === principalId ? 'active' : ''} onClick={() => switchPrincipal(principal.id, principal.processId)}>{principal.label}</button>)}<small>{roleId === 'risk' ? '全局可见 · 本专业可确认' : '客户与供应商严格隔离'}</small></div> : null}
      <section className="v3-goal-card"><div><span>当前协同目标</span><h3>{projection?.goal ?? '推动项目具备正式起租条件'}</h3><p>Evidence 先进入 pending batch；只有具名 ContextCommit 才触发五路更新。</p></div><div className="v3-goal-state"><span>当前阻断</span><b>{projection?.blocker ?? selectedCase.nextMilestone}</b><small>Owner · {projection?.owner ?? work.owner}</small></div></section>
      <section className={`v3-metric-strip${roleId === 'leadership' ? ' god-view' : ''}`}>{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
      <section className="v3-commencement-section"><div className="v3-section-label"><div><span>五路并行 · 起租主线</span><h3>{projection?.commencementState.band === 5 ? '正式起租已完成' : '同一 Context 同时驱动五路，再汇入正式起租'}</h3></div><p>{LIFECYCLE_LABEL[projection?.commencementState.lifecycleStatus ?? selectedCase.lifecycleStatus]}</p></div><div className={`v3-commencement-map role-${roleId}`} data-testid="process-lanes"><div className="v3-context-source"><span>共享 Context</span><b>{contextVersion}</b><small>一次确认 · 五路触发</small></div><div className="v3-process-lanes">{PROCESS_IDS.filter((candidate) => visibleProcesses.includes(candidate)).map((candidate) => { const run = projection?.processProjections.find((item) => item.processId === candidate); const displayState = roleId === 'external' ? (externalEvidenceAccepted ? 'done' : 'working') : stateForRun(run); const displayLabel = roleId === 'external' ? externalStatus : labelForRun(run); return <button type="button" key={candidate} data-process-id={candidate} data-direction={contextVersion === 'CTX-0002' && candidate === 'credit' ? 'regressed' : 'independent'} className={`${displayState}${candidate === processId ? ' selected' : ''}`} onClick={() => setProcessId(candidate)}><i /><span>{PROCESS_COPY[candidate].label}</span><b>{displayLabel}</b><small>{PROCESS_COPY[candidate].owner}</small></button>; })}</div><div className={`v3-commencement-target${projection?.commencementState.band === 5 ? ' done' : ''}`} data-testid="commencement-target"><i /><span>正式起租</span><small>{projection?.commencementState.band === 5 ? '已起息' : '共同端点'}</small></div></div>{contexts?.items.some((item) => item.transitionCode !== 'BASELINE') ? <div className="v3-context-history" data-testid="context-history">{contexts.items.filter((item) => item.transitionCode !== 'BASELINE').map((item) => { const credit = item.processRuns?.find((run) => run.processId === 'credit'); return <div key={item.contextVersion} data-context-turn={item.transitionCode} data-direction={item.transitionCode === 'T2' && credit?.riskBand === 'high' ? 'regressed' : 'updated'} className={item.isCurrent ? 'current' : ''}><span>{item.transitionCode}</span><b>{item.contextVersion}</b><small>{item.transitionCode === 'T2' ? '信审回退 · 补件' : item.isCurrent ? '当前版本' : '历史快照'}</small></div>; })}</div> : null}</section>
      <section className="v3-focus-card" data-testid="role-workbench" data-workbench-kind={roleId}><div className="v3-focus-head"><div><span>{processCopy.label} · 当前工作</span><h3>{processCopy.title}</h3><p>{roleId === 'external' ? '只展示受邀任务、有限进度与您需要处理的问题。' : processCopy.summary}</p></div><span className={`v3-authority-badge ${projection?.readOnly ? 'read-only' : ''}`}>{projection?.readOnly ? '只读视图' : roleId === 'external' ? '受邀工作区' : '角色工作区'}</span></div><div className="v3-focus-body"><article data-testid="current-situation"><span>目前结论</span><b>{work.result}</b><small>来源 · {contextVersion}</small></article><article className="v3-action-card" data-testid="current-action"><span>现在要做</span><b>{work.action}</b><small data-testid="current-owner">Owner · {work.owner}</small></article><article data-testid="current-handoff"><span>完成以后</span><b>{work.handoff}</b><small>所有正式状态都需要 Receipt</small></article></div><div className="v3-readiness-row"><div><span>{processCopy.label}准备度</span><small>{labelForRun(currentRun)}</small></div><div className="v3-neutral-grid" data-testid="readiness-band">{[0, 1, 2, 3, 4].map((index) => <i key={index} data-band-cell className={slotState(index)} />)}</div>{canConfirmGate ? <button type="button" className="v3-primary-action" onClick={() => setGateReview(true)}>人工确认</button> : allowed('management_action') ? <button type="button" className="v3-primary-action" onClick={() => setManagementReview(true)}>形成协同要求</button> : canCommence ? <button type="button" className="v3-primary-action" onClick={() => setCommencementReview(true)}>确认正式起租</button> : <span className="v3-observe-note">{roleId === 'external' ? '等待租赁公司确认' : '等待当前条件满足'}</span>}</div>{gateReview ? <div className="v3-confirm-box"><div><span>Human Gate</span><b>由 {principalId} 确认 {processCopy.label} 当前候选</b><p>绑定 {caseId} / {contextVersion}；不会创建新 Context。</p></div><button type="button" onClick={() => setGateReview(false)}>返回</button><button type="button" className="confirm" disabled={gateBusy} onClick={() => void confirmGate()}>{gateBusy ? '记录中…' : '确认并生成 Receipt'}</button></div> : null}{managementReview ? <div className="v3-confirm-box"><div><span>Management Action</span><b>请求业务与信审围绕当前阻断复核</b><p>只组织共同目标，不改写专业 Gate。</p></div><button type="button" onClick={() => setManagementReview(false)}>返回</button><button type="button" className="confirm" disabled={actionBusy} onClick={() => void confirmManagement()}>{actionBusy ? '记录中…' : '具名确认并下发'}</button></div> : null}{commencementReview ? <div className="v3-confirm-box"><div><span>Commencement Action</span><b>记录正式起租并开始起息</b><p>引用必要 Gate Receipt；不代表租后全周期结清。</p></div><button type="button" onClick={() => setCommencementReview(false)}>返回</button><button type="button" className="confirm" disabled={actionBusy} onClick={() => void confirmCommencement()}>{actionBusy ? '记录中…' : '确认正式起租'}</button></div> : null}</section>
    </>;
  };

  const renderDock = () => {
    if (roleId === 'leadership' && leadershipMode === 'portfolio') return <><div className="v3-dock-head"><div><span>MANAGEMENT GROUP</span><h2>经营协同</h2><p>小微事业部 · 净利润偏差处置</p></div><div className="v3-live"><i className={loadState} /><span>实时投影</span></div></div><div className="v3-dock-goal"><span>当前协同目标</span><b>定位偏差最大的 Case，并形成可执行复核要求</b><small>模型给候选 · 人确认 Action</small></div><section className="v3-portfolio-dock"><article><span>净利润差值</span><b>{activeKpis[0]?.deltaToDue ?? '—'} 万元</b><small>{GRAIN_LABEL[timeGrain]}度预测口径，不冒充已实现利润</small></article><article><span>最需关注</span><b>{portfolio?.drilldown?.largestDeviation ?? '载入中'}</b><small>只上浮偏差、风险上升与假设失效</small></article><button type="button" onClick={() => void openCase('FL-DEMO-001')}>下钻 Golden Case →</button></section></>;
    if (!selectedCase) return <div className="v3-state-card">当前没有可见 Case。</div>;
    if (selectedCase.caseTier === 'background') return <><div className="v3-dock-head"><div><span>CASE SUMMARY</span><h2>项目摘要</h2><p>{selectedCase.title}</p></div></div><section className="v3-background-dock"><span>READ-ONLY PROJECTION</span><h3>{selectedCase.phase}</h3><p>{selectedCase.roleScopedSummary}</p><div><span>下一里程碑</span><b>{selectedCase.nextMilestone}</b></div><small>背景 Case 不包含 Golden Case 的 Context、Evidence、群聊或 Receipt。</small></section></>;
    const members = visibleProcesses.map((candidate) => { const run = projection?.processProjections.find((item) => item.processId === candidate); return { processId: candidate, state: roleId === 'external' ? (externalEvidenceAccepted ? 'done' : 'working') : stateForRun(run), status: roleId === 'external' ? externalStatus : labelForRun(run) }; });
    return <><div className="v3-dock-head"><div><span>{roleId === 'external' ? 'INVITATION' : 'CASE GROUP'}</span><h2>{roleId === 'external' ? '受邀协同' : '项目群聊'}</h2><p>{selectedCase.title}</p></div><div className="v3-live"><i className={loadState} /><span>{members.length} 路在线</span></div></div><div className="v3-dock-goal" data-testid="collaboration-goal"><span>{roleId === 'external' ? '受邀任务' : '协同目标'}</span><b>{roleId === 'external' ? work.action : '补齐关键证据，推动正式起租'}</b><small>{contextVersion} · 信息确认后触发五路</small></div><div className="v3-thread-pill" data-testid="collaboration-thread" data-thread-id="pre-commencement-evidence"><span>当前 Thread</span><b>订单稳定性与起租条件</b><small>{roleId === 'external' ? 'invitation-scoped' : 'case-scoped'}</small></div><div className="v3-member-list" data-testid="collaboration-members">{members.map((member) => <button type="button" key={member.processId} data-member-role={member.processId} className={`${member.state}${member.processId === processId ? ' active' : ''}`} onClick={() => { setProcessId(member.processId); setChatInput(`@${PROCESS_COPY[member.processId].label} `); }}><span>{PROCESS_COPY[member.processId].label}</span><div><b>{PROCESS_COPY[member.processId].owner}</b><small>人员在线 · Agent {member.status}</small></div><i /></button>)}</div><div className="v3-chat-divider"><span>最新进展</span><small>{ROLE_COPY[roleId].label}视角 · 按需共享上下文</small></div><div className="v3-dock-log">{scopedDock.length ? scopedDock.map((entry, index) => <article key={`${entry.actor}-${index}`} className={entry.tone} data-message-kind={entry.kind}><div className="v3-message-avatar">{PROCESS_COPY[entry.processId].label}</div><div><span>{entry.actor}<time>{entry.time ?? entry.contextVersion}</time></span><p>{entry.text}</p></div></article>) : <p className="v3-empty-state">当前范围尚无新消息。</p>}</div>{latestReceipts.length ? <div className="v3-receipt-list">{latestReceipts.map((receipt) => <div key={receipt.receiptId} data-testid="current-receipt" data-case-id={caseId} data-context-version={receipt.contextVersion} data-action={receipt.actionType ?? receipt.receiptType}><span>{receipt.receiptType}</span><b>{receipt.receiptId}</b><small>{receipt.status}</small></div>)}</div> : null}{evidenceOpen ? <section className="v3-evidence-draft" data-testid="pending-evidence-batch"><span>{roleId === 'external' ? '受邀材料提交' : '共享信息接入'}</span><label>标题<input value={evidenceTitle} onChange={(event) => { setEvidenceTitle(event.target.value); setEvidenceReview(false); }} /></label><label>事实摘要<textarea value={evidenceSummary} onChange={(event) => { setEvidenceSummary(event.target.value); setEvidenceReview(false); }} /></label>{!evidenceReview ? <button type="button" disabled={!evidenceTitle.trim() || !evidenceSummary.trim()} onClick={() => setEvidenceReview(true)}>检查后确认</button> : <div className="v3-evidence-review"><b>本次确认包含：</b><p>{(principalId === 'business-owner' && contextVersion === 'CTX-0000') || (principalId === 'external-customer' && contextVersion === 'CTX-0001') ? '先接收 Evidence，再由当前有权主体具名形成 ContextCommit；成功后触发五路。' : '只接收 Evidence 并生成 Receipt；尚不更新 Context。'}</p><button type="button" onClick={() => setEvidenceReview(false)}>修改</button><button type="button" className="confirm" disabled={evidenceBusy} onClick={() => void acceptEvidence()}>{evidenceBusy ? '处理中…' : '确认接收'}</button></div>}</section> : null}{notice ? <p className="v3-notice" role="alert">{notice}</p> : null}<div className="v3-dock-actions">{canStageEvidence ? <button type="button" onClick={() => { setEvidenceOpen((open) => !open); setEvidenceReview(false); }}>{evidenceOpen ? '收起材料' : '上传材料 / 确认事实'}</button> : null}{canCommitT3 ? <button type="button" data-testid="context-commit-action" disabled={evidenceBusy} onClick={() => void commitT3()}>{evidenceBusy ? '合并中…' : '确认外部材料并触发 T3'}</button> : null}</div>{roleId !== 'external' ? <div className="v3-mention-row">{members.map((member) => <button key={member.processId} type="button" onClick={() => { setProcessId(member.processId); setChatInput(`@${PROCESS_COPY[member.processId].label} `); }}>@{PROCESS_COPY[member.processId].label}</button>)}</div> : null}<form className="v3-chat-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} aria-label="协同消息" placeholder={`向 ${processCopy.label} 人员与 Agent 提问…`} /><button type="submit" disabled={!chatInput.trim() || chatBusy || !canUseGolden || !allowed('chat')}>{chatBusy ? '处理中' : '发送'}</button></form></>;
  };

  return <main className="v3-shell" data-testid="v3-shell" data-role-id={roleId} data-case-id={caseId} data-context-version={contextVersion} data-load-state={loadState}>
    <header className="v3-topbar"><div className="v3-brand"><span>见微</span><small>小微融资租赁 · AI-Native</small></div><nav className="v3-role-tabs" aria-label="角色应用" data-testid="role-nav">{ROLE_IDS.map((role) => <button key={role} type="button" data-role-id={role} className={role === roleId ? 'active' : ''} disabled={loadState === 'loading'} onClick={() => switchRole(role)}><span>{ROLE_COPY[role].label}</span><small>{ROLE_COPY[role].title}</small></button>)}</nav><div className="v3-context-pill"><i className={loadState} /><span>共享上下文</span><b>{contextVersion}</b></div></header>
    <div className="v3-layout">
      <aside className="v3-case-panel" data-testid="case-panel"><div className="v3-panel-head"><div><span>CASE PANEL</span><h1>{roleId === 'external' ? '受邀项目' : '项目池'}</h1><p>{roleId === 'external' ? '当前账号可见范围' : '同一批融资租赁 Case'}</p></div><b>{cases.length}</b></div><div className="v3-view-tabs" role="group" data-testid="case-view-tabs">{([['phase', '阶段'], ['industry', '行业'], ['signal', '异常']] as Array<[CaseView, string]>).map(([id, label]) => <button type="button" key={id} data-view-id={id} className={caseView === id ? 'active' : ''} onClick={() => setCaseView(id)}>{label}</button>)}</div><div className="v3-case-list">{loadState === 'loading' && !panel ? <div className="v3-case-skeleton">正在载入角色项目池…</div> : groupedCases.map(([group, items]) => <section className="v3-case-group" key={group}><h2>{group}<small>{items.length}</small></h2>{items.map((item) => <button type="button" key={item.caseId} data-case-id={item.caseId} className={`v3-case-card${item.caseId === caseId ? ' selected' : ''}`} onClick={() => void openCase(item.caseId)}><span className="v3-case-card-top"><em>{item.caseTier === 'golden' ? '核心演示' : item.phase}</em><i data-signal={item.signal}>{SIGNAL_LABEL[item.signal]}</i></span><strong>{item.title}</strong><small>{item.counterparty}</small><span className="v3-case-meta"><b>{item.industry}</b><b>{item.amount}</b></span><span className="v3-mini-band" aria-label="起租就绪">{[0, 1, 2, 3, 4].map((index) => <i key={index} className={index < item.commencementBand ? 'filled' : ''} />)}</span><span className="v3-case-next">下一步 · {item.nextMilestone}</span></button>)}</section>)}</div></aside>
      <section className="v3-workspace">{loadState === 'error' && !projection ? <div className="v3-state-card error"><span>ROLE PROJECTION ERROR</span><h2>当前角色视图未能载入</h2><p>{notice}</p><button type="button" onClick={() => { setLoadState('loading'); clearScopedUi(); setRetryNonce((value) => value + 1); }}>重试</button></div> : <><section className="v3-case-hero"><div className="v3-case-hero-main"><div className="v3-hero-tags"><span>{ROLE_COPY[roleId].title}</span><span>小微事业部</span><span>{roleId === 'leadership' && leadershipMode === 'portfolio' ? '经营组合' : selectedCase?.caseTier === 'golden' ? '直接租赁' : '背景 Case'}</span></div><h2>{roleId === 'leadership' && leadershipMode === 'portfolio' ? '小微事业部经营组合' : selectedCase?.title ?? '正在载入'}</h2><p>{roleId === 'leadership' && leadershipMode === 'portfolio' ? '净利润 North Star · Portfolio / 事业部 / Case 同口径下钻' : `${selectedCase?.counterparty ?? '—'} · ${selectedCase?.region ?? '—'} · ${selectedCase?.amount ?? '—'}`}</p></div><div className="v3-case-identity"><span>{roleId === 'leadership' && leadershipMode === 'portfolio' ? 'SME-LEASE-PORTFOLIO' : caseId}</span><b>{roleId === 'leadership' && leadershipMode === 'portfolio' ? '经营归因' : selectedCase?.phase ?? '载入中'}</b><small>{roleId === 'leadership' && leadershipMode === 'portfolio' ? '净利润导向' : selectedCase ? `${SIGNAL_LABEL[selectedCase.signal]}信号` : '—'}</small></div></section>{roleId === 'leadership' && leadershipMode === 'portfolio' ? renderGodView() : renderCaseWorkspace()}</>}</section>
      <aside className="v3-dock" data-testid="collaboration-dock">{renderDock()}</aside>
    </div>
  </main>;
}
