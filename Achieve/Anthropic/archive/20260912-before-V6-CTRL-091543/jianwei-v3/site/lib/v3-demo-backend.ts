import {
  randomUUID,
} from 'node:crypto';
import {
  V3_SCENARIO_COLLABORATION,
  V3_SCENARIO_PROCESS_IDS,
  V3_SCENARIO_REF,
  type V3ScenarioProcessId,
} from './v3-demo-scenario.ts';
import { getV3SharedRuntime } from './v3-runtime/index.ts';
import { lookupV3DemoSession, persistV3DemoSession } from './v3-runtime/sqlite-store.ts';
import {
  getV3PrincipalPolicy,
  normalizeV3PrincipalId,
  type V3CanonicalPrincipalId,
  type V3InvitationScope,
  type V3PrincipalId,
  type V3RoleApplicationId,
} from './v3-role-authority.ts';

export type V3DemoSession = {
  sessionId: string;
  principalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
  invitation: V3InvitationScope | null;
};

const V3_DEMO_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const INVITATIONS: Record<'external-customer' | 'external-supplier', V3InvitationScope> = {
  'external-customer': {
    invitationId: 'INV-CUSTOMER-RISK-001',
    caseId: 'FL-DEMO-001',
    principalId: 'external-customer',
    workstepProcessId: 'opportunity',
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
    status: 'active',
  },
  'external-supplier': {
    invitationId: 'INV-SUPPLIER-DEVICE-001',
    caseId: 'FL-DEMO-001',
    principalId: 'external-supplier',
    workstepProcessId: 'commercial',
    allowedActionTypes: ['chat', 'submit_evidence', 'confirm_fact'],
    status: 'active',
  },
};

const runtime = {
  snapshot: () => getV3SharedRuntime().authorityRuntime.snapshot(),
  listEvents: (afterSequence = 0, limit = 100) =>
    getV3SharedRuntime().authorityRuntime.listEvents(afterSequence, limit),
  acceptEvidence: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['acceptEvidence']>[0]) =>
    getV3SharedRuntime().authorityRuntime.acceptEvidence(input),
  commitContext: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['commitContext']>[0]) =>
    getV3SharedRuntime().authorityRuntime.commitContext(input),
  updateProcessRun: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['updateProcessRun']>[0]) =>
    getV3SharedRuntime().authorityRuntime.updateProcessRun(input),
  recordHumanGate: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['recordHumanGate']>[0]) =>
    getV3SharedRuntime().authorityRuntime.recordHumanGate(input),
  recordManagementAction: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['recordManagementAction']>[0]) =>
    getV3SharedRuntime().authorityRuntime.recordManagementAction(input),
  recordMessage: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['recordMessage']>[0]) =>
    getV3SharedRuntime().authorityRuntime.recordMessage(input),
  recordCommencement: (input: Parameters<ReturnType<typeof getV3SharedRuntime>['authorityRuntime']['recordCommencement']>[0]) =>
    getV3SharedRuntime().authorityRuntime.recordCommencement(input),
  reset: () => {
    getV3SharedRuntime().demoReset({
      // A process-local counter can collide with a persisted reset id after restart,
      // turning a requested reset into an idempotent replay of an old operation.
      requestId: `legacy-canonical-reset-${randomUUID()}`,
      actorRole: 'leadership',
      confirmation: 'RESET_DEMO',
    });
    return getV3SharedRuntime().authorityRuntime.snapshot();
  },
};

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createV3DemoSession(principalInput: V3PrincipalId): V3DemoSession {
  const principalId = normalizeV3PrincipalId(principalInput);
  const policy = getV3PrincipalPolicy(principalId);
  const invitation = principalId === 'external-customer' || principalId === 'external-supplier'
    ? INVITATIONS[principalId]
    : null;
  const session: V3DemoSession = {
    sessionId: `V3-DEMO-SESSION-${randomUUID()}`,
    principalId,
    roleApplicationId: policy.roleApplicationId,
    invitation: invitation ? clone(invitation) : null,
  };
  const createdAt = new Date();
  persistV3DemoSession({
    ...session,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + V3_DEMO_SESSION_TTL_MS).toISOString(),
  });
  return clone(session);
}

export function resolveV3DemoSession(sessionId: unknown): V3DemoSession {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw failure('DEMO_SESSION_REQUIRED', '需要选择演示账号');
  }
  const stored = lookupV3DemoSession(sessionId.trim(), new Date().toISOString());
  let policy: ReturnType<typeof getV3PrincipalPolicy>;
  try {
    policy = getV3PrincipalPolicy(stored.principalId);
  } catch {
    throw failure('DEMO_SESSION_MISMATCH', '演示会话授权记录不一致');
  }
  const expectedInvitation = stored.principalId === 'external-customer' || stored.principalId === 'external-supplier'
    ? INVITATIONS[stored.principalId]
    : null;
  if (
    policy.principalId !== stored.principalId ||
    policy.roleApplicationId !== stored.roleApplicationId ||
    JSON.stringify(expectedInvitation) !== JSON.stringify(stored.invitation)
  ) {
    throw failure('DEMO_SESSION_MISMATCH', '演示会话授权记录不一致');
  }
  return clone({
    sessionId: stored.sessionId,
    principalId: stored.principalId,
    roleApplicationId: stored.roleApplicationId,
    invitation: stored.invitation,
  });
}

export function getV3DemoRuntime() {
  return runtime;
}

export function resetV3DemoRuntime() {
  return runtime.reset();
}

export function getV3DemoScenario() {
  return clone({
    scenarioRef: V3_SCENARIO_REF,
    persistence: 'sqlite_local_demo',
    securityMode: 'local_synthetic_principal',
    processIds: V3_SCENARIO_PROCESS_IDS,
    invitations: Object.values(INVITATIONS).map((item) => ({
      invitationId: item.invitationId,
      principalId: item.principalId,
      caseId: item.caseId,
      workstepProcessId: item.workstepProcessId,
      status: item.status,
    })),
  });
}

function roleScopedSummary(roleApplicationId: V3RoleApplicationId, summary: string): string {
  if (roleApplicationId === 'leadership') return `经营归因：${summary}`;
  if (roleApplicationId === 'business') return `项目运营：${summary}`;
  if (roleApplicationId === 'risk') return `专业协同：${summary}`;
  return `受邀事项：${summary}`;
}

export function getV3CasePanel(session: V3DemoSession) {
  const items = getV3SharedRuntime().store.listCases()
    .filter((item) => session.roleApplicationId !== 'external' || session.invitation?.caseId === item.caseId)
    .map((item) => ({
      caseId: item.caseId,
      businessItemType: item.businessItemType,
      caseTier: item.caseTier,
      readOnly: item.readOnly || session.roleApplicationId === 'external',
      title: item.title,
      counterparty: item.counterparty,
      industry: item.industry,
      region: item.region,
      amount: item.amount,
      phase: item.phase,
      lifecycleStatus: item.lifecycleStatus,
      signal: item.signal,
      nextMilestone: item.nextMilestone,
      commencementBand: item.caseId === V3_SCENARIO_REF.caseId
        ? runtime.snapshot().commencement.band || item.commencementBand
        : item.commencementBand,
      roleScopedSummary: roleScopedSummary(session.roleApplicationId, item.summary),
      allowedEntryActions: item.caseTier === 'background' ? ['view_summary'] : ['open_workbench'],
    }));
  return clone({
    roleApplicationId: session.roleApplicationId,
    principalId: session.principalId,
    scenarioRef: V3_SCENARIO_REF,
    items,
  });
}

const PORTFOLIO_WINDOW_VALUES = {
  day: { netIncome: [20, 17.5, 16.2, 17.4], unitAssetNetIncome: [8.4, 8.1, 7.8, 8.0] },
  week: { netIncome: [98, 88, 81, 89], unitAssetNetIncome: [8.4, 8.1, 7.9, 8.0] },
  month: { netIncome: [430, 383, 352, 384], unitAssetNetIncome: [8.4, 8.1, 7.9, 8.0] },
  quarter: { netIncome: [1280, 1150, 1060, 1092], unitAssetNetIncome: [8.4, 8.1, 7.9, 8.0] },
  'half-year': { netIncome: [2560, 2300, 2120, 2152], unitAssetNetIncome: [8.4, 8.1, 7.9, 8.0] },
  year: { netIncome: [5120, 4600, 4240, 4272], unitAssetNetIncome: [8.4, 8.1, 7.9, 8.0] },
} as const;

const FULL_CYCLE_PROFIT_VALUES = [4380, 4020, 3650, 3890] as const;

function roundedDelta(left: number, right: number) {
  return Number((left - right).toFixed(1));
}

function portfolioSourceReceiptRefs(snapshot: ReturnType<typeof runtime.snapshot>) {
  return snapshot.receipts
    .filter((receipt) => receipt.receiptType === 'commencement')
    .map((receipt) => ({
      receiptId: receipt.receiptId,
      receiptType: receipt.receiptType,
      caseId: receipt.caseId,
      contextVersion: receipt.contextVersion,
      principalId: receipt.principalId,
      processId: receipt.processId ?? null,
      actionType: receipt.actionType ?? null,
      status: receipt.status,
      recordedAt: receipt.recordedAt,
    }));
}

function metricDataCoverage(metricClass: 'net_income' | 'unit_asset_net_income' | 'full_cycle_profit') {
  const shared = {
    status: 'synthetic_demo_only' as const,
    sourceMode: 'in_memory_demo' as const,
    reconciliationStatus: 'not_connected' as const,
  };
  if (metricClass === 'net_income') {
    return {
      ...shared,
      includedFields: ['total_income', 'funding_cost', 'channel_cost', 'surtax'],
      excludedByDefinition: ['project_labor_cost', 'non_labor_cost', 'risk_cost', 'risk_provision'],
      missingSystems: ['finance_ledger_reconciliation'],
    };
  }
  if (metricClass === 'unit_asset_net_income') {
    return {
      ...shared,
      includedFields: ['net_income', 'commencement_amount'],
      excludedByDefinition: [],
      missingSystems: ['finance_ledger_reconciliation', 'asset_ledger_reconciliation'],
    };
  }
  return {
    ...shared,
    includedFields: ['synthetic_lifecycle_revenue', 'synthetic_financial_cost'],
    excludedByDefinition: [],
    missingSystems: ['finance_ledger', 'expense_reimbursement', 'labor_cost', 'risk_cost', 'risk_provision'],
  };
}

function buildPortfolioKpis(
  timeGrain: keyof typeof PORTFOLIO_WINDOW_VALUES,
  commenced: boolean,
  asOf: string,
  sourceReceiptRefs: ReturnType<typeof portfolioSourceReceiptRefs>,
) {
  const window = PORTFOLIO_WINDOW_VALUES[timeGrain];
  const [netIncomeTarget, netIncomeDue, netIncomeBefore, netIncomeAfter] = window.netIncome;
  const [unitTarget, unitDue, unitBefore, unitAfter] = window.unitAssetNetIncome;
  const [cycleTarget, cycleDue, cycleBefore, cycleAfter] = FULL_CYCLE_PROFIT_VALUES;
  const netIncomeValue = commenced ? netIncomeAfter : netIncomeBefore;
  const unitValue = commenced ? unitAfter : unitBefore;
  const cycleValue = commenced ? cycleAfter : cycleBefore;
  const periodTimeScope = timeGrain === 'year' ? 'current_year' as const : 'current_period' as const;
  return [
    {
      metricId: 'net-income',
      metricDefinitionId: 'JW-NET-INCOME',
      formulaVersion: 'net-income-v1',
      formula: 'total_income - funding_cost - channel_cost - surtax',
      metricClass: 'net_income' as const,
      timeScope: periodTimeScope,
      periodGrain: timeGrain,
      valueClass: 'scenario' as const,
      label: '可验证净收入',
      unit: '万元',
      target: netIncomeTarget,
      due: netIncomeDue,
      value: netIncomeValue,
      variance: roundedDelta(netIncomeValue, netIncomeDue),
      asOf,
      currency: 'CNY' as const,
      dataCoverage: metricDataCoverage('net_income'),
      sourceReceiptRefs: sourceReceiptRefs.map((receipt) => ({ ...receipt })),
      current: netIncomeValue,
      deltaToTarget: roundedDelta(netIncomeValue, netIncomeTarget),
      deltaToDue: roundedDelta(netIncomeValue, netIncomeDue),
      trend: commenced ? 'improving' as const : 'behind-plan' as const,
    },
    {
      metricId: 'unit-asset-net-income',
      metricDefinitionId: 'JW-UNIT-ASSET-NET-INCOME',
      formulaVersion: 'unit-asset-net-income-v1',
      formula: 'net_income / commencement_amount',
      metricClass: 'unit_asset_net_income' as const,
      timeScope: periodTimeScope,
      periodGrain: timeGrain,
      valueClass: 'scenario' as const,
      label: '单位资产产出效率',
      unit: '%',
      target: unitTarget,
      due: unitDue,
      value: unitValue,
      variance: roundedDelta(unitValue, unitDue),
      asOf,
      currency: 'CNY' as const,
      dataCoverage: metricDataCoverage('unit_asset_net_income'),
      sourceReceiptRefs: sourceReceiptRefs.map((receipt) => ({ ...receipt })),
      current: unitValue,
      deltaToTarget: roundedDelta(unitValue, unitTarget),
      deltaToDue: roundedDelta(unitValue, unitDue),
      trend: commenced ? 'improving' as const : 'behind-plan' as const,
    },
    {
      metricId: 'full-cycle-profit',
      metricDefinitionId: 'JW-FULL-CYCLE-PROFIT',
      formulaVersion: 'full-cycle-profit-v1',
      formula: 'lifecycle_revenue - financial_cost - channel_cost - surtax - labor_cost - non_labor_cost - risk_cost - risk_provision',
      metricClass: 'full_cycle_profit' as const,
      timeScope: 'full_lifecycle' as const,
      periodGrain: 'full-lifecycle' as const,
      valueClass: 'forecast' as const,
      label: '全周期利润（辅助）',
      unit: '万元',
      target: cycleTarget,
      due: cycleDue,
      value: cycleValue,
      variance: roundedDelta(cycleValue, cycleDue),
      asOf,
      currency: 'CNY' as const,
      dataCoverage: metricDataCoverage('full_cycle_profit'),
      sourceReceiptRefs: sourceReceiptRefs.map((receipt) => ({ ...receipt })),
      current: cycleValue,
      deltaToTarget: roundedDelta(cycleValue, cycleTarget),
      deltaToDue: roundedDelta(cycleValue, cycleDue),
      trend: commenced ? 'improving' as const : 'behind-plan' as const,
    },
  ];
}

export function getV3PortfolioProjection(session: V3DemoSession) {
  if (session.roleApplicationId === 'external') {
    throw failure('ACTION_SCOPE_DENIED', '外联账号无权访问经营组合视图');
  }
  const snapshot = runtime.snapshot();
  const commenced = snapshot.commencement.status === 'commenced';
  const asOf = snapshot.events.at(-1)?.recordedAt ?? new Date(0).toISOString();
  const sourceReceiptRefs = portfolioSourceReceiptRefs(snapshot);
  const casePanel = getV3CasePanel(session);
  const signalCounts = casePanel.items.reduce<Record<string, number>>((counts, item) => {
    counts[item.signal] = (counts[item.signal] ?? 0) + 1;
    return counts;
  }, {});
  const common = {
    projectionType: 'PortfolioProjection',
    roleApplicationId: session.roleApplicationId,
    principalId: session.principalId,
    scenarioRef: snapshot.scenarioRef,
    runtimeEpoch: snapshot.runtimeEpoch,
    projectionVersion: `${snapshot.runtimeEpoch}-PORTFOLIO-${snapshot.events.length}`,
    currentContextVersion: snapshot.currentContext.contextVersion,
    northStar: '可验证净收入 / 单位资产产出效率',
    northStarDefinition: {
      primaryMetricClasses: ['net_income', 'unit_asset_net_income'],
      auxiliaryMetricClasses: ['full_cycle_profit'],
    },
    timeGrains: ['day', 'week', 'month', 'quarter', 'half-year', 'year'],
    caseCount: casePanel.items.length,
    signalCounts,
    cases: casePanel.items.map((item) => ({
      caseId: item.caseId,
      title: item.title,
      phase: item.phase,
      signal: item.signal,
      nextMilestone: item.nextMilestone,
      commencementBand: item.commencementBand,
      lifecycleStatus: item.lifecycleStatus,
      readOnly: item.readOnly,
    })),
  };
  if (session.roleApplicationId !== 'leadership') {
    return clone({
      ...common,
      viewMode: session.roleApplicationId === 'business' ? 'case-operations' : 'professional-risk',
      kpis: [],
      organizationPath: ['租赁公司', '小微事业部'],
    });
  }
  const kpiWindows = Object.fromEntries(
    Object.keys(PORTFOLIO_WINDOW_VALUES).map((timeGrain) => [
      timeGrain,
      buildPortfolioKpis(
        timeGrain as keyof typeof PORTFOLIO_WINDOW_VALUES,
        commenced,
        asOf,
        sourceReceiptRefs,
      ),
    ]),
  );
  return clone({
    ...common,
    viewMode: 'god-view',
    organizationPath: ['租赁公司', '小微事业部'],
    kpis: kpiWindows.quarter,
    kpiWindows,
    drilldown: {
      portfolioId: 'SME-LEASE-PORTFOLIO',
      businessUnitId: 'SME-BU',
      focusCaseId: V3_SCENARIO_REF.caseId,
      largestDeviation: commenced ? '单位资产产出效率仍低于目标' : '可验证净收入与单位资产产出效率低于应达',
    },
  });
}

export function getV3ContextVersions(session: V3DemoSession, caseId: string) {
  if (caseId !== V3_SCENARIO_REF.caseId) {
    const caseItem = getV3SharedRuntime().store.listCases().find((item) => item.caseId === caseId);
    if (!caseItem) throw failure('CASE_NOT_FOUND', '事项不存在');
    if (session.roleApplicationId === 'external') throw failure('CASE_SCOPE_DENIED', '外联账号无权访问该事项');
    return clone({ caseId, currentContextVersion: null, items: [] });
  }
  const snapshot = runtime.snapshot();
  if (session.roleApplicationId === 'external') {
    return clone({
      caseId,
      currentContextVersion: snapshot.currentContext.contextVersion,
      items: [{
        contextSeq: snapshot.currentContext.contextSeq,
        contextVersion: snapshot.currentContext.contextVersion,
        transitionCode: snapshot.currentContext.transitionCode,
        isCurrent: true,
      }],
    });
  }
  return clone({
    caseId,
    currentContextVersion: snapshot.currentContext.contextVersion,
    items: snapshot.contexts.map((context) => ({
      ...context,
      isCurrent: context.contextVersion === snapshot.currentContext.contextVersion,
      receiptRefs: snapshot.receipts
        .filter((receipt) =>
          receipt.contextVersion === context.contextVersion || context.sourceReceiptIds.includes(receipt.receiptId))
        .map((receipt) => ({
          receiptId: receipt.receiptId,
          receiptType: receipt.receiptType,
          contextVersion: receipt.contextVersion,
          principalId: receipt.principalId,
          processId: receipt.processId ?? null,
          actionType: receipt.actionType ?? null,
          status: receipt.status,
        })),
      processRuns: snapshot.processRuns
        .filter((run) => run.boundContextVersion === context.contextVersion)
        .map((run) => ({
          runId: run.runId,
          processId: run.processId,
          status: run.status,
          readinessBand: run.readinessBand,
          riskBand: run.riskBand,
          evidenceCoverageBand: run.evidenceCoverageBand,
          gateState: run.gateState,
          supersededByContextVersion: run.supersededByContextVersion ?? null,
        })),
    })),
  });
}

export function getV3Receipt(session: V3DemoSession, caseId: string, receiptId: string) {
  if (caseId !== V3_SCENARIO_REF.caseId) {
    const caseItem = getV3SharedRuntime().store.listCases().find((item) => item.caseId === caseId);
    if (!caseItem) throw failure('CASE_NOT_FOUND', '事项不存在');
    throw failure('RECEIPT_NOT_FOUND', '背景事项不包含 Receipt');
  }
  const receipt = runtime.snapshot().receipts.find((item) => item.receiptId === receiptId);
  if (!receipt) throw failure('RECEIPT_NOT_FOUND', 'Receipt 不存在');
  if (session.roleApplicationId === 'external' && receipt.principalId !== session.principalId) {
    throw failure('RECEIPT_SCOPE_DENIED', '外联账号无权读取该 Receipt');
  }
  return clone(receipt);
}

function allowedActions(session: V3DemoSession, caseTier: 'golden' | 'background') {
  if (caseTier === 'background') return [];
  const policy = getV3PrincipalPolicy(session.principalId);
  const currentContextVersion = runtime.snapshot().currentContext.contextVersion;
  const actions = policy.allowedActionTypes.map((actionType) => ({
    actionType,
    enabled: true,
    requiresConfirmation: ['confirm_fact', 'professional_gate', 'management_action', 'commencement_action'].includes(actionType),
    boundContextVersion: currentContextVersion,
    requiredPrincipalId: policy.principalId,
    requiredProcessIds: actionType === 'professional_gate'
      ? [...policy.professionalGateProcessIds]
      : actionType === 'commencement_action'
        ? ['commercial']
        : [],
    invitationId: session.invitation?.invitationId ?? null,
    denialCode: null,
  }));
  return actions;
}

function visibleReceiptRefs(session: V3DemoSession, snapshot: ReturnType<typeof runtime.snapshot>) {
  const currentSourceReceiptIds = new Set(snapshot.currentContext.sourceReceiptIds);
  return snapshot.receipts
    .filter((receipt) =>
      receipt.contextVersion === snapshot.currentContext.contextVersion ||
      currentSourceReceiptIds.has(receipt.receiptId))
    .filter((receipt) => session.roleApplicationId !== 'external' || receipt.principalId === session.principalId)
    .map((receipt) => ({
      receiptId: receipt.receiptId,
      receiptType: receipt.receiptType,
      caseId: receipt.caseId,
      contextVersion: receipt.contextVersion,
      principalId: receipt.principalId,
      processId: receipt.processId ?? null,
      actionType: receipt.actionType ?? null,
      invitationId: receipt.invitationId ?? null,
      status: receipt.status,
      evidenceReceiptIds: [...receipt.evidenceReceiptIds],
      recordedAt: receipt.recordedAt,
    }));
}

const COLLABORATION_ACTOR_LABELS: Record<string, string> = {
  'collaboration-manager': '协同 · 管理者',
  'business-owner': '业务 · 陈屿',
  'risk-policy': '政策 · 林澄',
  'risk-credit': '信审 · 周岚',
  'risk-commercial': '商务 · 顾衡',
  'risk-asset': '资产 · 许棠',
  'external-customer': '客户 · 外联',
  'external-supplier': '供应商 · 外联',
};

function isV3ScenarioProcessId(value: unknown): value is V3ScenarioProcessId {
  return typeof value === 'string' && V3_SCENARIO_PROCESS_IDS.includes(value as V3ScenarioProcessId);
}

function internalCollaborationProjection(
  snapshot: ReturnType<typeof runtime.snapshot>,
  currentRuns: ReturnType<typeof runtime.snapshot>['processRuns'],
) {
  const runtimeEntries = snapshot.events
    .filter((event) => event.type === 'MESSAGE_RECEIVED' && typeof event.payload.message === 'string')
    .map((event) => ({
      entryId: event.eventId,
      actorLabel: COLLABORATION_ACTOR_LABELS[event.actor.principalId] ?? event.actor.principalId,
      processId: isV3ScenarioProcessId(event.payload.processId) ? event.payload.processId : null,
      text: event.payload.message as string,
      kind: 'human-message' as const,
      contextVersion: event.contextVersion ?? snapshot.currentContext.contextVersion,
      recordedAt: event.recordedAt,
      authority: 'none' as const,
    }));
  return {
    mode: 'internal-five-thread' as const,
    memberCount: V3_SCENARIO_COLLABORATION.thread.members.length,
    currentContextVersion: snapshot.currentContext.contextVersion,
    objective: V3_SCENARIO_COLLABORATION.objective,
    thread: {
      ...V3_SCENARIO_COLLABORATION.thread,
      entries: [...V3_SCENARIO_COLLABORATION.thread.entries, ...runtimeEntries],
    },
    blockers: V3_SCENARIO_COLLABORATION.blockers,
    workItems: V3_SCENARIO_COLLABORATION.workItems.map((item) => {
      const run = currentRuns.find((candidate) => candidate.processId === item.processId);
      return {
        ...item,
        runStatus: run?.status ?? 'not_started',
        gateState: run?.gateState ?? 'not_ready',
      };
    }),
  };
}

export function getV3RoleCaseProjection(session: V3DemoSession, caseId: string) {
  const caseItem = getV3SharedRuntime().store.listCases().find((item) => item.caseId === caseId);
  if (!caseItem) throw failure('CASE_NOT_FOUND', '事项不存在');
  if (session.roleApplicationId === 'external' && session.invitation?.caseId !== caseId) {
    throw failure('CASE_SCOPE_DENIED', '外联账号无权访问该事项');
  }
  if (caseItem.caseTier === 'background') {
    return clone({
      caseId: caseItem.caseId,
      businessItemType: caseItem.businessItemType,
      caseTier: caseItem.caseTier,
      readOnly: true,
      roleApplicationId: session.roleApplicationId,
      principalId: session.principalId,
      contextVersion: null,
      caseSummary: roleScopedSummary(session.roleApplicationId, caseItem.summary),
      commencementState: { band: caseItem.commencementBand, lifecycleStatus: caseItem.lifecycleStatus },
      allowedActions: [],
      processProjections: [],
      collaborationProjection: null,
      visibleReceiptRefs: [],
    });
  }

  const snapshot = runtime.snapshot();
  const policy = getV3PrincipalPolicy(session.principalId);
  const currentRuns = snapshot.processRuns.filter((run) =>
    run.boundContextVersion === snapshot.currentContext.contextVersion && run.status !== 'superseded');
  const processProjections = session.roleApplicationId === 'external'
    ? []
    : currentRuns.map((run) => ({
        processId: run.processId,
        runId: run.runId,
        boundContextVersion: run.boundContextVersion,
        runStatus: run.status,
        freshness: 'current',
        readinessBand: run.readinessBand,
        riskBand: run.riskBand,
        evidenceCoverageBand: run.evidenceCoverageBand,
        gateState: run.gateState,
        needsHuman: ['needs_input', 'ready_for_gate'].includes(run.status),
        updatedAt: run.updatedAt,
      }));
  const externalTask = session.invitation
    ? {
        invitationId: session.invitation.invitationId,
        workstepProcessId: session.invitation.workstepProcessId,
        status: session.invitation.status,
        allowedActionTypes: [...session.invitation.allowedActionTypes],
      }
    : null;

  return clone({
    caseId: caseItem.caseId,
    businessItemType: caseItem.businessItemType,
    caseTier: caseItem.caseTier,
    readOnly: false,
    scenarioRef: snapshot.scenarioRef,
    runtimeEpoch: snapshot.runtimeEpoch,
    contextVersion: snapshot.currentContext.contextVersion,
    contextSeq: snapshot.currentContext.contextSeq,
    roleApplicationId: session.roleApplicationId,
    principalId: session.principalId,
    projectionVersion: `${snapshot.runtimeEpoch}-${snapshot.events.length}`,
    caseSummary: roleScopedSummary(session.roleApplicationId, caseItem.summary),
    goal: '让固定直接租赁 Case 在证据、专业 Gate 和权限受控前提下正式起租',
    blocker: snapshot.currentContext.transitionCode === 'T2' ? '信审补件待完成' : '按当前 Context 完成下一有权动作',
    owner: session.roleApplicationId === 'external' ? session.principalId : 'business-owner',
    commencementState: snapshot.commencement,
    scope: {
      visibleProcessIds: session.roleApplicationId === 'external' ? [] : [...policy.visibleProcessIds],
      professionalGateProcessIds: [...policy.professionalGateProcessIds],
      invitationId: session.invitation?.invitationId ?? null,
      externalTask,
    },
    allowedActions: allowedActions(session, caseItem.caseTier),
    processProjections,
    collaborationProjection: session.roleApplicationId === 'external'
      ? { mode: 'invitation-scoped', externalTask }
      : internalCollaborationProjection(snapshot, currentRuns),
    visibleReceiptRefs: visibleReceiptRefs(session, snapshot),
  });
}

const RUN_RESULTS = {
  T1: {
    opportunity: ['partial', 2, 'medium', 2],
    policy: ['partial', 2, 'medium', 2],
    credit: ['partial', 3, 'medium', 2],
    commercial: ['partial', 1, 'unknown', 1],
    asset: ['partial', 1, 'unknown', 1],
  },
  T2: {
    opportunity: ['partial', 2, 'medium', 2],
    policy: ['partial', 2, 'medium', 2],
    credit: ['needs_input', 2, 'high', 2],
    commercial: ['partial', 1, 'medium', 1],
    asset: ['partial', 1, 'medium', 1],
  },
  T3: {
    opportunity: ['completed', 4, 'medium', 4],
    policy: ['ready_for_gate', 4, 'medium', 4],
    credit: ['ready_for_gate', 4, 'medium', 4],
    commercial: ['ready_for_gate', 4, 'medium', 4],
    asset: ['ready_for_gate', 4, 'medium', 4],
  },
} as const;

export function advanceV3DemoProcessRun(input: {
  requestId: string;
  runId: string;
  phase: 'start' | 'result';
}) {
  if (!['start', 'result'].includes(input.phase)) throw failure('INVALID_INPUT', 'Process Run phase 无效');
  const snapshot = runtime.snapshot();
  const run = snapshot.processRuns.find((item) => item.runId === input.runId);
  if (!run) throw failure('RUN_NOT_FOUND', 'Process Run 不存在');
  const transition = snapshot.contexts.find((item) => item.contextVersion === run.boundContextVersion)?.transitionCode;
  if (transition !== 'T1' && transition !== 'T2' && transition !== 'T3') {
    throw failure('INVALID_TRANSITION', 'Process Run 未绑定 T1/T2/T3');
  }
  if (input.phase === 'start') {
    return runtime.updateProcessRun({
      requestId: input.requestId,
      runId: input.runId,
      status: 'running',
      readinessBand: 0,
      riskBand: 'unknown',
      evidenceCoverageBand: 0,
      summary: `${run.processId} 正在基于 ${transition} 更新`,
    });
  }
  const [status, readinessBand, riskBand, evidenceCoverageBand] = RUN_RESULTS[transition][run.processId];
  return runtime.updateProcessRun({
    requestId: input.requestId,
    runId: input.runId,
    status,
    readinessBand,
    riskBand,
    evidenceCoverageBand,
    summary: `${run.processId} 已形成 ${transition} 候选结果`,
  });
}
