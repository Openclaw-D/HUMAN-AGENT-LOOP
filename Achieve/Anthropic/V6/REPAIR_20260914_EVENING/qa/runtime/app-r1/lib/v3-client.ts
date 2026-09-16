import type {
  V3ActionType,
  V3CanonicalPrincipalId,
  V3ProcessId,
  V3RoleApplicationId,
} from './v3-role-authority.ts';

export type V3ClientRoleId = V3RoleApplicationId;
export type V3ClientProcessId = V3ProcessId;
export type V3ClientPrincipalId = V3CanonicalPrincipalId;
export type V3ClientActionType = V3ActionType;

export type V3ScenarioRefDto = {
  scenarioId: string;
  scenarioVersion: string;
  seed: string;
  businessItemType: 'FinancingLeasingCase';
  caseId: string;
  leaseMode: 'direct-lease';
  dataClass: 'synthetic_deidentified_demo';
};

export type V3InvitationDto = {
  invitationId: string;
  caseId: string;
  principalId: 'external-customer' | 'external-supplier';
  workstepProcessId: V3ClientProcessId;
  allowedActionTypes: Array<'chat' | 'submit_evidence' | 'confirm_fact'>;
  status: 'active' | 'expired' | 'revoked' | 'completed';
  expiresAt?: string;
};

export type V3DemoSessionDto = {
  sessionId: string;
  principalId: V3ClientPrincipalId;
  roleApplicationId: V3ClientRoleId;
  invitation: V3InvitationDto | null;
};

export type V3CasePanelItemDto = {
  caseId: string;
  businessItemType: 'FinancingLeasingCase';
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  title: string;
  counterparty: string;
  industry: string;
  region: string;
  amount: string;
  phase: string;
  lifecycleStatus: string;
  signal: 'normal' | 'attention' | 'elevated';
  nextMilestone: string;
  commencementBand: 0 | 1 | 2 | 3 | 4 | 5;
  roleScopedSummary: string;
  allowedEntryActions: Array<'view_summary' | 'open_workbench'>;
};

export type V3CasePanelDto = {
  roleApplicationId: V3ClientRoleId;
  principalId: V3ClientPrincipalId;
  scenarioRef: V3ScenarioRefDto;
  items: V3CasePanelItemDto[];
};

export type V3ProcessProjectionDto = {
  processId: V3ClientProcessId;
  runId: string;
  boundContextVersion: string;
  runStatus: 'queued' | 'running' | 'partial' | 'needs_input' | 'ready_for_gate' | 'completed' | 'failed';
  readinessBand: 0 | 1 | 2 | 3 | 4;
  riskBand: 'unknown' | 'low' | 'medium' | 'high';
  evidenceCoverageBand: 0 | 1 | 2 | 3 | 4;
  gateState: 'not_ready' | 'ready' | 'confirmed' | 'rejected' | 'returned_for_evidence';
  freshness: 'current';
  needsHuman: boolean;
  updatedAt: string;
};

export type V3ReceiptRefDto = {
  receiptId: string;
  receiptType: string;
  caseId: string;
  contextVersion: string;
  principalId: string;
  processId: V3ClientProcessId | null;
  actionType: string | null;
  invitationId: string | null;
  status: string;
  evidenceReceiptIds: string[];
  recordedAt: string;
};

export type V3AllowedActionDto = {
  actionType: V3ClientActionType;
  enabled: boolean;
  requiresConfirmation: boolean;
  boundContextVersion: string;
  requiredPrincipalId: string;
  requiredProcessIds: V3ClientProcessId[];
  invitationId: string | null;
  denialCode: string | null;
};

export type V3RoleProjectionDto = {
  caseId: string;
  businessItemType: 'FinancingLeasingCase';
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  roleApplicationId: V3ClientRoleId;
  principalId: V3ClientPrincipalId;
  scenarioRef?: V3ScenarioRefDto;
  runtimeEpoch?: string;
  contextVersion: string | null;
  contextSeq?: number;
  projectionVersion?: string;
  caseSummary: string;
  goal?: string;
  blocker?: string;
  owner?: string;
  scope?: {
    visibleProcessIds: V3ClientProcessId[];
    professionalGateProcessIds: V3ClientProcessId[];
    invitationId: string | null;
    externalTask: V3ExternalTaskDto | null;
  };
  commencementState: {
    band: 0 | 1 | 2 | 3 | 4 | 5;
    status?: 'pre_commencement' | 'commenced';
    lifecycleStatus: string;
    conditionSetVersion?: string;
    commencementReceiptId?: string | null;
  };
  allowedActions: V3AllowedActionDto[];
  processProjections: V3ProcessProjectionDto[];
  collaborationProjection?: V3CollaborationProjectionDto | null;
  visibleReceiptRefs: V3ReceiptRefDto[];
};

export type V3ContextHistoryDto = {
  caseId: string;
  currentContextVersion: string | null;
  items: Array<{
    runtimeEpoch?: string;
    contextSeq: number;
    contextVersion: string;
    previousContextVersion?: string | null;
    transitionCode: 'BASELINE' | 'T1' | 'T2' | 'T3';
    diffId?: string;
    isCurrent: boolean;
    sourceReceiptIds?: string[];
    receiptRefs?: Array<{
      receiptId: string;
      receiptType: string;
      contextVersion: string;
      principalId: string;
      processId: V3ClientProcessId | null;
      actionType: string | null;
      status: string;
    }>;
    processRuns?: Array<{
      runId: string;
      processId: V3ClientProcessId;
      status: string;
      readinessBand: number;
      riskBand: string;
      evidenceCoverageBand: number;
      gateState: string;
      supersededByContextVersion: string | null;
    }>;
  }>;
};

export type V3KpiMetricDto = {
  metricId: string;
  metricDefinitionId: string;
  formulaVersion: string;
  formula: string;
  metricClass: 'net_income' | 'unit_asset_net_income' | 'full_cycle_profit';
  timeScope: 'current_period' | 'current_year' | 'full_lifecycle';
  periodGrain: 'day' | 'week' | 'month' | 'quarter' | 'half-year' | 'year' | 'full-lifecycle';
  valueClass: 'scenario' | 'forecast';
  label: string;
  unit: string;
  target: number;
  due: number;
  value: number;
  variance: number;
  asOf: string;
  currency: 'CNY';
  dataCoverage: {
    status: 'synthetic_demo_only';
    sourceMode: 'in_memory_demo';
    reconciliationStatus: 'not_connected';
    includedFields: string[];
    excludedByDefinition: string[];
    missingSystems: string[];
  };
  sourceReceiptRefs: Array<{
    receiptId: string;
    receiptType: 'commencement';
    caseId: string;
    contextVersion: string;
    principalId: string;
    processId: V3ClientProcessId | null;
    actionType: string | null;
    status: string;
    recordedAt: string;
  }>;
  current: number;
  deltaToTarget: number;
  deltaToDue: number;
  trend: 'improving' | 'behind-plan' | 'stable';
};

export type V3PortfolioCaseDto = {
  caseId: string;
  title: string;
  phase: string;
  signal: 'normal' | 'attention' | 'elevated';
  nextMilestone: string;
  commencementBand: 0 | 1 | 2 | 3 | 4 | 5;
  lifecycleStatus: string;
  readOnly: boolean;
};

export type V3PortfolioProjectionDto = {
  projectionType: 'PortfolioProjection';
  roleApplicationId: 'leadership';
  principalId: 'collaboration-manager';
  scenarioRef: V3ScenarioRefDto;
  runtimeEpoch: string;
  projectionVersion: string;
  currentContextVersion: string;
  northStar: '可验证净收入 / 单位资产产出效率';
  northStarDefinition: {
    primaryMetricClasses: Array<'net_income' | 'unit_asset_net_income'>;
    auxiliaryMetricClasses: Array<'full_cycle_profit'>;
  };
  timeGrains: Array<'day' | 'week' | 'month' | 'quarter' | 'half-year' | 'year'>;
  caseCount: number;
  signalCounts: Record<string, number>;
  cases: V3PortfolioCaseDto[];
  viewMode: 'god-view';
  organizationPath: string[];
  kpis: V3KpiMetricDto[];
  kpiWindows: Record<'day' | 'week' | 'month' | 'quarter' | 'half-year' | 'year', V3KpiMetricDto[]>;
  drilldown: {
    portfolioId: string;
    businessUnitId: string;
    largestDeviation: string;
    focusCaseId: string;
  };
};

export type V3CollaborationObjectiveDto = {
  title: string;
  description: string;
  status: 'active';
};

export type V3CollaborationThreadMemberDto = {
  principalId: 'business-owner' | 'risk-policy' | 'risk-credit' | 'risk-commercial' | 'risk-asset';
  processId: V3ClientProcessId;
  label: string;
  ownerLabel: string;
};

export type V3CollaborationThreadEntryDto = {
  entryId: string;
  actorLabel: string;
  processId: V3ClientProcessId | null;
  text: string;
  kind: 'scenario' | 'human-message';
  contextVersion: string;
  recordedAt: string | null;
  authority: 'none';
};

export type V3ExternalTaskDto = {
  invitationId: string;
  workstepProcessId: V3ClientProcessId;
  status: V3InvitationDto['status'];
  allowedActionTypes: V3InvitationDto['allowedActionTypes'];
};

export type V3InternalCollaborationProjectionDto = {
  mode: 'internal-five-thread';
  memberCount: 5;
  currentContextVersion: string;
  objective: V3CollaborationObjectiveDto;
  thread: {
    threadId: 'FL-DEMO-001-INTERNAL';
    title: string;
    members: V3CollaborationThreadMemberDto[];
    entries: V3CollaborationThreadEntryDto[];
  };
  blockers: Array<{
    blockerId: string;
    title: string;
    detail: string;
    ownerProcessId: V3ClientProcessId;
    status: 'needs-evidence' | 'in-preparation' | 'waiting';
  }>;
  workItems: Array<{
    processId: V3ClientProcessId;
    label: string;
    task: string;
    runStatus: V3ProcessProjectionDto['runStatus'] | 'not_started';
    gateState: V3ProcessProjectionDto['gateState'];
  }>;
};

export type V3ExternalCollaborationProjectionDto = {
  mode: 'invitation-scoped';
  externalTask: V3ExternalTaskDto | null;
};

export type V3CollaborationProjectionDto =
  | V3InternalCollaborationProjectionDto
  | V3ExternalCollaborationProjectionDto;

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    retryable?: boolean;
  };
};

export class V3ClientApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = 'V3ClientApiError';
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable ?? input.status >= 500;
  }
}

export type V3ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function v3Api<T>(
  path: string,
  options: {
    sessionId?: string;
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    fetchImpl?: V3ApiFetch;
  } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.sessionId) headers.set('x-jw-demo-session', options.sessionId);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await (options.fetchImpl ?? fetch)(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
    signal: options.signal,
  });
  let payload: ApiErrorPayload & T;
  try {
    payload = await response.json() as ApiErrorPayload & T;
  } catch {
    throw new V3ClientApiError({
      code: 'INVALID_API_RESPONSE',
      message: '服务返回了无法识别的响应',
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  if (!response.ok) {
    throw new V3ClientApiError({
      code: payload.error?.code ?? `HTTP_${response.status}`,
      message: payload.error?.message || `请求失败（${response.status}）`,
      status: response.status,
      requestId: payload.error?.requestId,
      retryable: payload.error?.retryable,
    });
  }
  return payload;
}

export async function createV3ClientSession(principalId: V3ClientPrincipalId, signal?: AbortSignal) {
  return v3Api<{ session: V3DemoSessionDto }>('/api/v3/demo/session', {
    method: 'POST',
    body: { principalId },
    signal,
  });
}
