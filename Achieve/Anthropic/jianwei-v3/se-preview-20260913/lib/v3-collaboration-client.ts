import {
  V3ClientApiError,
  type V3ApiFetch,
  type V3AllowedActionDto,
  type V3CollaborationObjectiveDto,
  type V3CollaborationThreadEntryDto,
  type V3CollaborationThreadMemberDto,
  type V3DemoSessionDto,
  type V3InternalCollaborationProjectionDto,
  type V3KpiMetricDto,
  type V3PortfolioProjectionDto,
  type V3RoleProjectionDto,
  v3Api,
} from './v3-client.ts';

export const V3_COLLABORATION_CASE_ID = 'FL-DEMO-001' as const;

export type V3CollaborationMessageEventDto = {
  eventId: string;
  runtimeEpoch: string;
  sequence: number;
  caseId: typeof V3_COLLABORATION_CASE_ID;
  scenarioVersion: string;
  type: 'MESSAGE_RECEIVED';
  actor: {
    principalId: 'collaboration-manager';
    roleApplicationId: 'leadership';
    authority: 'none';
  };
  correlationId: string;
  causationId: null;
  contextVersion: string;
  recordedAt: string;
  payload: {
    message: string;
    processId: 'credit';
    invitationId: string | null;
  };
};

export type V3CollaborationReadyDto = {
  sessionId: string;
  caseId: typeof V3_COLLABORATION_CASE_ID;
  contextVersion: string;
  projectionVersion: string;
  objective: V3CollaborationObjectiveDto;
  metrics: V3KpiMetricDto[];
  blockers: V3InternalCollaborationProjectionDto['blockers'];
  workItems: V3InternalCollaborationProjectionDto['workItems'];
  thread: {
    threadId: string;
    title: string;
    members: V3CollaborationThreadMemberDto[];
    entries: V3CollaborationThreadEntryDto[];
  };
  memberCount: 5;
  messageCapability: {
    processId: 'credit';
    enabled: boolean;
    boundContextVersion: string | null;
    denialCode: string | null;
  };
  creditFlowAvailable: boolean;
  lastMessageEvent: V3CollaborationMessageEventDto | null;
};

export type V3CollaborationClient = {
  initialize(signal?: AbortSignal): Promise<V3CollaborationReadyDto>;
  reload(sessionId: string, signal?: AbortSignal): Promise<V3CollaborationReadyDto>;
  sendMessage(input: {
    sessionId: string;
    requestId?: string;
    message: string;
    signal?: AbortSignal;
  }): Promise<V3CollaborationReadyDto>;
};

type ClientOptions = {
  fetchImpl?: V3ApiFetch;
  createRequestId?: () => string;
};

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new V3ClientApiError({
      code: 'REQUEST_ID_UNAVAILABLE',
      message: '当前环境无法生成唯一请求标识',
      status: 0,
      retryable: false,
    });
  }
  return `collaboration-${globalThis.crypto.randomUUID()}`;
}

function internalProjection(roleProjection: V3RoleProjectionDto) {
  const collaboration = roleProjection.collaborationProjection;
  return collaboration?.mode === 'internal-five-thread' ? collaboration : null;
}

function invalidResponse(
  code: string,
  message: string,
  options: { requestId?: string; retryable?: boolean } = {},
): V3ClientApiError {
  return new V3ClientApiError({
    code,
    message,
    status: 200,
    requestId: options.requestId,
    retryable: options.retryable ?? false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const PROCESS_IDS = new Set(['opportunity', 'policy', 'credit', 'commercial', 'asset']);
const MEMBER_PRINCIPAL_IDS = new Set([
  'business-owner',
  'risk-policy',
  'risk-credit',
  'risk-commercial',
  'risk-asset',
]);
const ENTRY_KINDS = new Set(['scenario', 'human-message']);
const BLOCKER_STATUSES = new Set(['needs-evidence', 'in-preparation', 'waiting']);
const RUN_STATUSES = new Set([
  'queued',
  'running',
  'partial',
  'needs_input',
  'ready_for_gate',
  'completed',
  'failed',
  'not_started',
]);
const GATE_STATES = new Set(['not_ready', 'ready', 'confirmed', 'rejected', 'returned_for_evidence']);
const ACTION_TYPES = new Set([
  'chat',
  'submit_evidence',
  'confirm_fact',
  'professional_gate',
  'management_action',
  'commencement_action',
  'view_replay',
]);
const KPI_TRENDS = new Set(['improving', 'behind-plan', 'stable']);
const KPI_VALUE_CLASSES = new Set(['scenario', 'forecast']);
const KPI_METRIC_CLASSES = new Set(['net_income', 'unit_asset_net_income', 'full_cycle_profit']);
const KPI_TIME_SCOPES = new Set(['current_period', 'current_year', 'full_lifecycle']);
const TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'half-year', 'year'] as const;

function validateAllowedActions(value: unknown): asserts value is V3AllowedActionDto[] {
  if (!Array.isArray(value) || !value.every((action) =>
    isRecord(action) &&
    ACTION_TYPES.has(String(action.actionType)) &&
    typeof action.enabled === 'boolean' &&
    typeof action.requiresConfirmation === 'boolean' &&
    isNonEmptyString(action.boundContextVersion) &&
    isNonEmptyString(action.requiredPrincipalId) &&
    Array.isArray(action.requiredProcessIds) &&
    action.requiredProcessIds.every((processId) => PROCESS_IDS.has(String(processId))) &&
    isNullableString(action.invitationId) &&
    isNullableString(action.denialCode)
  )) {
    throw invalidResponse('INVALID_ALLOWED_ACTIONS_RESPONSE', '协同事项的可用动作结构无效');
  }
}

function validateInternalCollaboration(
  value: unknown,
  expectedContextVersion: string,
): asserts value is V3InternalCollaborationProjectionDto {
  if (!isRecord(value) || value.mode !== 'internal-five-thread' || value.memberCount !== 5) {
    throw invalidResponse('INVALID_COLLABORATION_PROJECTION_RESPONSE', '内部协同投影结构无效');
  }
  const objective = value.objective;
  const thread = value.thread;
  const members = isRecord(thread) ? thread.members : null;
  const entries = isRecord(thread) ? thread.entries : null;
  const memberProcesses = Array.isArray(members)
    ? new Set(members.map((member) => isRecord(member) ? member.processId : null))
    : new Set();
  const validMembers = Array.isArray(members) && members.length === 5 && members.every((member) =>
    isRecord(member) &&
    MEMBER_PRINCIPAL_IDS.has(String(member.principalId)) &&
    PROCESS_IDS.has(String(member.processId)) &&
    isNonEmptyString(member.label) &&
    isNonEmptyString(member.ownerLabel)
  ) && memberProcesses.size === 5;
  const validEntries = Array.isArray(entries) && entries.every((entry) =>
    isRecord(entry) &&
    isNonEmptyString(entry.entryId) &&
    isNonEmptyString(entry.actorLabel) &&
    (entry.processId === null || PROCESS_IDS.has(String(entry.processId))) &&
    isNonEmptyString(entry.text) &&
    ENTRY_KINDS.has(String(entry.kind)) &&
    isNonEmptyString(entry.contextVersion) &&
    isNullableString(entry.recordedAt) &&
    entry.authority === 'none'
  );
  const validBlockers = Array.isArray(value.blockers) && value.blockers.every((blocker) =>
    isRecord(blocker) &&
    isNonEmptyString(blocker.blockerId) &&
    isNonEmptyString(blocker.title) &&
    isNonEmptyString(blocker.detail) &&
    PROCESS_IDS.has(String(blocker.ownerProcessId)) &&
    BLOCKER_STATUSES.has(String(blocker.status))
  );
  const workItemProcesses = Array.isArray(value.workItems)
    ? new Set(value.workItems.map((item) => isRecord(item) ? item.processId : null))
    : new Set();
  const validWorkItems = Array.isArray(value.workItems) && value.workItems.length === 5 && value.workItems.every((item) =>
    isRecord(item) &&
    PROCESS_IDS.has(String(item.processId)) &&
    isNonEmptyString(item.label) &&
    isNonEmptyString(item.task) &&
    RUN_STATUSES.has(String(item.runStatus)) &&
    GATE_STATES.has(String(item.gateState))
  ) && workItemProcesses.size === 5;
  if (
    value.currentContextVersion !== expectedContextVersion ||
    !isRecord(objective) ||
    !isNonEmptyString(objective.title) ||
    !isNonEmptyString(objective.description) ||
    objective.status !== 'active' ||
    !isRecord(thread) ||
    thread.threadId !== 'FL-DEMO-001-INTERNAL' ||
    !isNonEmptyString(thread.title) ||
    !validMembers ||
    !validEntries ||
    !validBlockers ||
    !validWorkItems
  ) {
    throw invalidResponse('INVALID_COLLABORATION_PROJECTION_RESPONSE', '内部协同投影的嵌套字段无效');
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidSourceReceipt(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.receiptId) &&
    value.receiptType === 'commencement' &&
    isNonEmptyString(value.caseId) &&
    isNonEmptyString(value.contextVersion) &&
    isNonEmptyString(value.principalId) &&
    (value.processId === null || PROCESS_IDS.has(String(value.processId))) &&
    isNullableString(value.actionType) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.recordedAt);
}

function isValidDataCoverage(value: unknown): boolean {
  return isRecord(value) &&
    value.status === 'synthetic_demo_only' &&
    value.sourceMode === 'in_memory_demo' &&
    value.reconciliationStatus === 'not_connected' &&
    isStringArray(value.includedFields) &&
    isStringArray(value.excludedByDefinition) &&
    isStringArray(value.missingSystems);
}

function isValidKpi(value: unknown, expectedGrain?: typeof TIME_GRAINS[number]): boolean {
  if (!isRecord(value)) return false;
  const metricClass = String(value.metricClass);
  const periodGrain = String(value.periodGrain);
  const expectedPeriodGrain = metricClass === 'full_cycle_profit' ? 'full-lifecycle' : expectedGrain;
  const expectedTimeScope = metricClass === 'full_cycle_profit'
    ? 'full_lifecycle'
    : expectedGrain === 'year'
      ? 'current_year'
      : 'current_period';
  return isNonEmptyString(value.metricId) &&
    isNonEmptyString(value.metricDefinitionId) &&
    isNonEmptyString(value.formulaVersion) &&
    isNonEmptyString(value.formula) &&
    KPI_METRIC_CLASSES.has(metricClass) &&
    KPI_TIME_SCOPES.has(String(value.timeScope)) &&
    value.timeScope === expectedTimeScope &&
    periodGrain === expectedPeriodGrain &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.unit) &&
    isFiniteNumber(value.target) &&
    isFiniteNumber(value.due) &&
    isFiniteNumber(value.value) &&
    isFiniteNumber(value.variance) &&
    isNonEmptyString(value.asOf) &&
    !Number.isNaN(Date.parse(value.asOf)) &&
    value.currency === 'CNY' &&
    isValidDataCoverage(value.dataCoverage) &&
    Array.isArray(value.sourceReceiptRefs) &&
    value.sourceReceiptRefs.every(isValidSourceReceipt) &&
    isFiniteNumber(value.current) &&
    isFiniteNumber(value.deltaToTarget) &&
    isFiniteNumber(value.deltaToDue) &&
    value.current === value.value &&
    value.deltaToDue === value.variance &&
    KPI_TRENDS.has(String(value.trend)) &&
    KPI_VALUE_CLASSES.has(String(value.valueClass)) &&
    (metricClass === 'full_cycle_profit' ? value.valueClass === 'forecast' : value.valueClass === 'scenario');
}

function hasAllMetricClasses(value: unknown[]): boolean {
  const classes = new Set(value.map((metric) => isRecord(metric) ? metric.metricClass : null));
  return classes.size === KPI_METRIC_CLASSES.size &&
    [...KPI_METRIC_CLASSES].every((metricClass) => classes.has(metricClass));
}

function validateKpiProjection(value: unknown): asserts value is V3PortfolioProjectionDto {
  if (
    !isRecord(value) ||
    value.northStar !== '可验证净收入 / 单位资产产出效率' ||
    !isRecord(value.northStarDefinition) ||
    !Array.isArray(value.northStarDefinition.primaryMetricClasses) ||
    value.northStarDefinition.primaryMetricClasses.length !== 2 ||
    !value.northStarDefinition.primaryMetricClasses.includes('net_income') ||
    !value.northStarDefinition.primaryMetricClasses.includes('unit_asset_net_income') ||
    !Array.isArray(value.northStarDefinition.auxiliaryMetricClasses) ||
    value.northStarDefinition.auxiliaryMetricClasses.length !== 1 ||
    !value.northStarDefinition.auxiliaryMetricClasses.includes('full_cycle_profit') ||
    !Array.isArray(value.kpis) ||
    value.kpis.length !== 3 ||
    !hasAllMetricClasses(value.kpis) ||
    !value.kpis.every((metric) => isValidKpi(metric, 'quarter'))
  ) {
    throw invalidResponse('INVALID_KPI_PROJECTION_RESPONSE', '经营组合 KPI 结构无效');
  }
  const timeGrains = value.timeGrains;
  const kpiWindows = value.kpiWindows;
  if (
    !Array.isArray(timeGrains) ||
    timeGrains.length !== TIME_GRAINS.length ||
    !TIME_GRAINS.every((grain) => timeGrains.includes(grain)) ||
    !isRecord(kpiWindows) ||
    !TIME_GRAINS.every((grain) =>
      Array.isArray(kpiWindows[grain]) &&
      kpiWindows[grain].length === 3 &&
      hasAllMetricClasses(kpiWindows[grain]) &&
      kpiWindows[grain].every((metric) => isValidKpi(metric, grain)))
  ) {
    throw invalidResponse('INVALID_KPI_PROJECTION_RESPONSE', '经营组合 KPI 时间窗口结构无效');
  }
}

function messageCapability(
  roleProjection: V3RoleProjectionDto,
): V3CollaborationReadyDto['messageCapability'] {
  validateAllowedActions(roleProjection.allowedActions);
  if (
    !isRecord(roleProjection.scope) ||
    !Array.isArray(roleProjection.scope.visibleProcessIds) ||
    !roleProjection.scope.visibleProcessIds.every((processId) => PROCESS_IDS.has(String(processId)))
  ) {
    throw invalidResponse('INVALID_CASE_PROJECTION_RESPONSE', '协同事项的可见流程范围无效');
  }
  const chatAction = roleProjection.allowedActions.find((action) => action.actionType === 'chat');
  const visibleCredit = roleProjection.scope.visibleProcessIds.includes('credit');
  return {
    processId: 'credit',
    enabled: Boolean(
      chatAction?.enabled &&
      chatAction.boundContextVersion === roleProjection.contextVersion &&
      chatAction.requiredPrincipalId === roleProjection.principalId &&
      chatAction.denialCode === null &&
      visibleCredit
    ),
    boundContextVersion: chatAction?.boundContextVersion ?? null,
    denialCode: chatAction?.denialCode ?? null,
  };
}

function toReadyDto(input: {
  sessionId: string;
  roleProjection: V3RoleProjectionDto;
  portfolioProjection: V3PortfolioProjectionDto;
  lastMessageEvent?: V3CollaborationMessageEventDto | null;
}): V3CollaborationReadyDto {
  if (!isRecord(input.roleProjection)) {
    throw invalidResponse('INVALID_CASE_PROJECTION_RESPONSE', '协同事项投影结构无效');
  }
  const collaboration = internalProjection(input.roleProjection);
  if (
    input.roleProjection.caseId !== V3_COLLABORATION_CASE_ID ||
    input.roleProjection.caseTier !== 'golden' ||
    input.roleProjection.roleApplicationId !== 'leadership' ||
    input.roleProjection.principalId !== 'collaboration-manager' ||
    input.roleProjection.scenarioRef?.caseId !== V3_COLLABORATION_CASE_ID ||
    typeof input.roleProjection.contextVersion !== 'string' ||
    typeof input.roleProjection.projectionVersion !== 'string' ||
    !collaboration
  ) {
    throw invalidResponse('INVALID_CASE_PROJECTION_RESPONSE', '协同事项投影与当前领导会话不一致');
  }
  validateInternalCollaboration(collaboration, input.roleProjection.contextVersion);
  validateKpiProjection(input.portfolioProjection);
  if (
    input.portfolioProjection.roleApplicationId !== 'leadership' ||
    input.portfolioProjection.principalId !== 'collaboration-manager' ||
    input.portfolioProjection.viewMode !== 'god-view' ||
    input.portfolioProjection.scenarioRef?.caseId !== V3_COLLABORATION_CASE_ID ||
    !Array.isArray(input.portfolioProjection.kpis)
  ) {
    throw invalidResponse('INVALID_PORTFOLIO_PROJECTION_RESPONSE', '经营组合投影与当前领导会话不一致');
  }
  if (
    input.roleProjection.runtimeEpoch !== input.portfolioProjection.runtimeEpoch ||
    input.roleProjection.contextVersion !== input.portfolioProjection.currentContextVersion ||
    input.portfolioProjection.drilldown?.focusCaseId !== V3_COLLABORATION_CASE_ID
  ) {
    throw invalidResponse('INVALID_PROJECTION_COHERENCE', '事项投影与经营组合投影不属于同一运行时快照');
  }
  const capability = messageCapability(input.roleProjection);
  if (input.lastMessageEvent) {
    const reconciled = collaboration.thread.entries.some(
      (entry) => entry.entryId === input.lastMessageEvent?.eventId,
    );
    if (
      input.lastMessageEvent.runtimeEpoch !== input.roleProjection.runtimeEpoch ||
      input.lastMessageEvent.contextVersion !== input.roleProjection.contextVersion ||
      !reconciled
    ) {
      throw invalidResponse(
        'MESSAGE_RECONCILIATION_FAILED',
        '消息已写入，但最新协同投影尚未包含对应事件',
        { requestId: input.lastMessageEvent.correlationId, retryable: true },
      );
    }
  }
  return {
    sessionId: input.sessionId,
    caseId: V3_COLLABORATION_CASE_ID,
    contextVersion: input.roleProjection.contextVersion,
    projectionVersion: input.roleProjection.projectionVersion,
    objective: collaboration.objective,
    metrics: input.portfolioProjection.kpis,
    blockers: collaboration.blockers,
    workItems: collaboration.workItems,
    thread: collaboration.thread,
    memberCount: collaboration.memberCount,
    messageCapability: capability,
    creditFlowAvailable: capability.enabled,
    lastMessageEvent: input.lastMessageEvent ?? null,
  };
}

export function createV3CollaborationClient(options: ClientOptions = {}): V3CollaborationClient {
  const fetchImpl = options.fetchImpl;
  const createRequestId = options.createRequestId ?? defaultRequestId;

  async function readReady(
    sessionId: string,
    signal?: AbortSignal,
    lastMessageEvent?: V3CollaborationMessageEventDto | null,
  ): Promise<V3CollaborationReadyDto> {
    const [roleProjection, portfolioProjection] = await Promise.all([
      v3Api<V3RoleProjectionDto>(`/api/v3/cases/${V3_COLLABORATION_CASE_ID}/projection`, {
        sessionId,
        signal,
        fetchImpl,
      }),
      v3Api<V3PortfolioProjectionDto>('/api/v3/portfolio/projection', {
        sessionId,
        signal,
        fetchImpl,
      }),
    ]);
    return toReadyDto({ sessionId, roleProjection, portfolioProjection, lastMessageEvent });
  }

  return {
    async initialize(signal) {
      const payload = await v3Api<{ session?: V3DemoSessionDto }>('/api/v3/demo/session', {
        method: 'POST',
        body: { principalId: 'collaboration-manager' },
        signal,
        fetchImpl,
      });
      const session = payload?.session;
      if (
        !isRecord(session) ||
        !isNonEmptyString(session.sessionId) ||
        session.principalId !== 'collaboration-manager' ||
        session.roleApplicationId !== 'leadership'
      ) {
        throw new V3ClientApiError({
          code: 'INVALID_SESSION_RESPONSE',
          message: '协同会话身份与请求不一致',
          status: 200,
          retryable: false,
        });
      }
      return readReady(session.sessionId, signal);
    },

    reload(sessionId, signal) {
      return readReady(sessionId, signal);
    },

    async sendMessage({ sessionId, requestId: requestIdInput, message, signal }) {
      const normalizedMessage = typeof message === 'string' ? message.trim() : '';
      if (!normalizedMessage) {
        throw new V3ClientApiError({
          code: 'INVALID_MESSAGE',
          message: '消息不能为空',
          status: 0,
          retryable: false,
        });
      }
      const requestIdCandidate = requestIdInput ?? createRequestId();
      const requestId = typeof requestIdCandidate === 'string' ? requestIdCandidate.trim() : '';
      if (!requestId) {
        throw new V3ClientApiError({
          code: 'INVALID_REQUEST_ID',
          message: '请求标识不能为空',
          status: 0,
          retryable: false,
        });
      }
      const payload = await v3Api<{ event?: V3CollaborationMessageEventDto }>(
        `/api/v3/cases/${V3_COLLABORATION_CASE_ID}/messages`,
        {
          sessionId,
          method: 'POST',
          body: {
            requestId,
            message: normalizedMessage,
            processId: 'credit',
          },
          signal,
          fetchImpl,
        },
      );
      const event = payload?.event;
      if (
        !event ||
        event.type !== 'MESSAGE_RECEIVED' ||
        !isNonEmptyString(event.eventId) ||
        !isNonEmptyString(event.runtimeEpoch) ||
        !Number.isInteger(event.sequence) ||
        event.caseId !== V3_COLLABORATION_CASE_ID ||
        !isNonEmptyString(event.scenarioVersion) ||
        event.actor?.principalId !== 'collaboration-manager' ||
        event.actor.roleApplicationId !== 'leadership' ||
        event.actor.authority !== 'none' ||
        event.correlationId !== requestId ||
        event.causationId !== null ||
        !isNonEmptyString(event.contextVersion) ||
        !isNonEmptyString(event.recordedAt) ||
        event.payload?.message !== normalizedMessage ||
        event.payload.processId !== 'credit' ||
        event.payload.invitationId !== null
      ) {
        throw invalidResponse('INVALID_MESSAGE_RESPONSE', '消息写入回执与请求不一致');
      }
      return readReady(sessionId, signal, event);
    },
  };
}
