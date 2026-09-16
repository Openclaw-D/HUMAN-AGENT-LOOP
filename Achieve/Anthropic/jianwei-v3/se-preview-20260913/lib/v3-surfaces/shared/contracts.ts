export const V3_SHARED_SCHEMA_VERSION = 'v3.shared-read-model.1' as const;

export const V3_ROLE_PROJECTION_IDS = [
  'leadership',
  'business',
  'policy',
  'credit',
  'commercial',
  'asset',
  'customer',
  'supplier',
] as const;

export type V3RoleProjectionId = (typeof V3_ROLE_PROJECTION_IDS)[number];
export type V3ProfessionalRole = Extract<
  V3RoleProjectionId,
  'policy' | 'credit' | 'commercial' | 'asset'
>;
export type V3ContextGrain = 'portfolio' | 'division' | 'case';
export type V3FrontendQuarterThreshold = 0 | 25 | 50 | 75 | 100;
export type V3SurfaceStatus = 'loading' | 'ready' | 'empty' | 'error';
export type V3MissingDisplayValue = '未提供';

export type V3ScenarioRef = {
  scenarioId: string;
  scenarioVersion: string;
  dataClass: 'synthetic_deidentified_demo';
};

export type V3ContextSelector = {
  grain: V3ContextGrain;
  portfolioId: string;
  divisionId: string | null;
  caseId: string | null;
};

export type V3ContextReadModel = V3ContextSelector & {
  contextId: string;
  contextVersion: string;
  label: string;
  parentContextId: string | null;
  scenarioRef: V3ScenarioRef;
};

export type V3SurfaceError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type V3SurfaceState<T> =
  | { status: 'loading'; data: null; error: null; empty: null }
  | { status: 'ready'; data: T; error: null; empty: null }
  | { status: 'empty'; data: null; error: null; empty: { message: string } }
  | { status: 'error'; data: null; error: V3SurfaceError; empty: null };

export type V3ChartProvenance = {
  sourceKind: 'scenario' | 'receipt' | 'derived' | 'external_system';
  sourceRefs: string[];
  observedAt: string | null;
  asOf: string | null;
  dataClass: 'synthetic_deidentified_demo' | 'unverified' | 'verified';
  connectionStatus: 'scenario_only' | 'not_connected' | 'connected';
  availability: 'provided' | 'not_provided';
};

export type V3ChartDatum = {
  datumId: string;
  label: string;
  value: number | null;
  displayValue: string | number | V3MissingDisplayValue;
  unit: string | null;
  provenance: V3ChartProvenance;
};

export type V3ChartSeries = {
  chartId: string;
  title: string;
  chartKind: 'bar' | 'line' | 'matrix' | 'relationship';
  data: V3ChartDatum[];
};

export type V3ProfessionalPath = {
  role: V3ProfessionalRole;
  steps: readonly ['material', 'rule', 'model', 'human_review'];
  stepLabels: readonly ['材料', '规则', '模型', '人审'];
  backendContinuousProgress: number | null;
  frontendQuarterThreshold: V3FrontendQuarterThreshold | null;
  missingDisplay: V3MissingDisplayValue | null;
};

export type V3RolePolicy = {
  role: V3RoleProjectionId;
  defaultGrain: V3ContextGrain;
  visibleGrains: V3ContextGrain[];
  coordinationActions: string[];
  canConfirmProfessionalGate: boolean;
  professionalGateRole: V3ProfessionalRole | null;
};

export type V3CandidateReply = {
  candidateId: string;
  kind: 'ai_candidate';
  status: 'candidate';
  completion: 'not_formal_completion';
  authority: 'none';
  routedTo: 'jw' | V3ProfessionalRole;
  text: string;
  result: { text: string };
  disclaimer: 'AI candidate · authority none';
  contextVersion: string;
  createdAt: string;
};

export type V3ChatRouteState = {
  target: 'group' | 'human_role' | 'jw' | V3ProfessionalRole;
  targetRole: V3RoleProjectionId | 'jw' | null;
  status: 'delivered' | 'busy' | 'error' | 'candidate_ready';
  retryable: boolean;
  error: V3SurfaceError | null;
};

export type V3PersistedMessage = {
  messageId: string;
  contextId: string;
  contextVersion: string;
  requestId: string;
  actorKind: 'human' | 'agent';
  actorRole: V3RoleProjectionId | 'jw';
  authority: 'none';
  text: string;
  replyToMessageId: string | null;
  scenarioRef: V3ScenarioRef;
  createdAt: string;
};

export type V3SendMessageResult = {
  status: 'accepted';
  completion: 'message_persisted';
  authority: 'none';
  message: V3PersistedMessage;
  routes: V3ChatRouteState[];
  candidates: V3CandidateReply[];
  receiptId: string;
  replayed: boolean;
};

export type V3SharedReadModel = {
  schemaVersion: typeof V3_SHARED_SCHEMA_VERSION;
  scenarioRef: V3ScenarioRef;
  context: V3ContextReadModel;
  roleProjection: V3RolePolicy;
  professionalPaths: V3ProfessionalPath[];
  charts: V3ChartSeries[];
  messages: V3PersistedMessage[];
};

export const V3_PROFESSIONAL_PATH_STEPS = Object.freeze([
  'material',
  'rule',
  'model',
  'human_review',
] as const);

export const V3_PROFESSIONAL_PATH_LABELS = Object.freeze([
  '材料',
  '规则',
  '模型',
  '人审',
] as const);

export const V3_BUSINESS_COORDINATION_ACTIONS = Object.freeze([
  'initiate',
  'organize',
  'assign',
  'remind',
  'supplement',
  'terminate',
  'chat',
] as const);

export function toFrontendQuarterThreshold(
  backendContinuousProgress: number | null,
): V3FrontendQuarterThreshold | null {
  if (backendContinuousProgress === null) return null;
  if (!Number.isFinite(backendContinuousProgress) || backendContinuousProgress < 0 || backendContinuousProgress > 100) {
    throw Object.assign(new Error('backendContinuousProgress 必须介于 0 与 100'), {
      code: 'INVALID_PROGRESS',
    });
  }
  if (backendContinuousProgress >= 100) return 100;
  if (backendContinuousProgress >= 75) return 75;
  if (backendContinuousProgress >= 50) return 50;
  if (backendContinuousProgress >= 25) return 25;
  return 0;
}

export function createSurfaceLoading<T>(): V3SurfaceState<T> {
  return { status: 'loading', data: null, error: null, empty: null };
}

export function createSurfaceReady<T>(data: T): V3SurfaceState<T> {
  return { status: 'ready', data, error: null, empty: null };
}

export function createSurfaceEmpty<T>(message = '未提供'): V3SurfaceState<T> {
  return { status: 'empty', data: null, error: null, empty: { message } };
}

export function createSurfaceError<T>(error: V3SurfaceError): V3SurfaceState<T> {
  return { status: 'error', data: null, error, empty: null };
}

export function missingChartDatum(
  datumId: string,
  label: string,
  sourceRefs: string[] = [],
): V3ChartDatum {
  return {
    datumId,
    label,
    value: null,
    displayValue: '未提供',
    unit: null,
    provenance: {
      sourceKind: 'scenario',
      sourceRefs: [...sourceRefs],
      observedAt: null,
      asOf: null,
      dataClass: 'synthetic_deidentified_demo',
      connectionStatus: 'scenario_only',
      availability: 'not_provided',
    },
  };
}
