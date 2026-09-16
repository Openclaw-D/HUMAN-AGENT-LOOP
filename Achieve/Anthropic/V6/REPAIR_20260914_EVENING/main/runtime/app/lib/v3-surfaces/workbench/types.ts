import type {
  V3AuthorityEvent,
  V3ContextRef,
  V3ProcessRun,
  V3Receipt,
} from '../../v3-authority-runtime.ts';
import type {
  V3CanonicalPrincipalId,
  V3RoleApplicationId,
} from '../../v3-role-authority.ts';
import type { V3ScenarioCase } from '../../v3-demo-scenario.ts';
import type { V3PersistedMessage } from '../shared/contracts.ts';
import type { V3StoredCase, V3StoredEvent, V3StoredReceipt } from '../../v3-runtime/sqlite-store.ts';

export const WORKBENCH_PERSPECTIVES = [
  'business',
  'policy',
  'credit',
  'commercial',
  'asset',
] as const;

export const PROFESSIONAL_PERSPECTIVES = [
  'policy',
  'credit',
  'commercial',
  'asset',
] as const;

export const PROFESSIONAL_PATH_STEP_IDS = [
  'material',
  'rule',
  'model',
  'human',
] as const;

export const BUSINESS_ACTION_TYPES = [
  'initiate',
  'organize',
  'assign',
  'remind',
  'request-supplement',
  'terminate',
] as const;

export const PROFESSIONAL_ACTION_TYPES = [
  'confirm',
  'return',
  'reject',
  'request-evidence',
] as const;

export type WorkbenchPerspective = (typeof WORKBENCH_PERSPECTIVES)[number];
export type ProfessionalPerspective = (typeof PROFESSIONAL_PERSPECTIVES)[number];
export type ProfessionalPathStepId = (typeof PROFESSIONAL_PATH_STEP_IDS)[number];
export type BusinessActionType = (typeof BUSINESS_ACTION_TYPES)[number];
export type ProfessionalActionType = (typeof PROFESSIONAL_ACTION_TYPES)[number];
export type WorkbenchActionType = BusinessActionType | ProfessionalActionType;
export type QuarterThreshold = 0 | 25 | 50 | 75 | 100;
export type Quadrant = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left';

export type WorkbenchSession = {
  sessionId: string;
  principalId: V3CanonicalPrincipalId;
  roleApplicationId: V3RoleApplicationId;
};

export type WorkbenchIntegrationState = {
  authorityRuntime: {
    status: 'connected';
    implementation: 'canonical-shared-sqlite';
    persistence: 'sqlite-local-demo';
  };
  chat: {
    status: 'connected';
    implementation: 'shared-v3-sqlite-chat';
  };
  sqlite: {
    status: 'connected';
    owner: 'V3 Shared Runtime';
    implementation: 'canonical-shared-sqlite';
  };
};

export type SharedWorkbenchSnapshot = {
  caseItem: V3ScenarioCase;
  runtimeEpoch: string | null;
  currentContext: V3ContextRef | null;
  processRuns: Array<V3ProcessRun>;
  receipts: Array<V3Receipt>;
  events: Array<V3AuthorityEvent>;
  sharedCase?: V3StoredCase;
  sharedMessages?: V3PersistedMessage[];
  sharedReceipts?: V3StoredReceipt[];
  sharedEvents?: V3StoredEvent[];
};

export type WorkbenchMaterialRequirement = {
  evidenceName: string;
  expectedSource: string;
};

export type WorkbenchProfessionalSpec = {
  perspective: ProfessionalPerspective;
  label: string;
  principalId: Extract<
    V3CanonicalPrincipalId,
    'risk-policy' | 'risk-credit' | 'risk-commercial' | 'risk-asset'
  >;
  quadrant: Quadrant;
  weightPercent: 25;
  evidenceRequirements: ReadonlyArray<WorkbenchMaterialRequirement>;
  ruleName: string;
  rulePurpose: string;
  modelTask: string;
  humanGateLabel: string;
};

export type WorkbenchEvidenceSource = {
  evidenceName: string;
  expectedSource: string;
  availability: 'available' | 'missing';
  sourceRef: string;
  evidenceReceiptId: string | null;
};

export type WorkbenchPathStep = {
  stepId: ProfessionalPathStepId;
  label: '材料' | '规则' | '模型' | '人审';
  completionPercent: number | null;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'failed';
  result: string;
  authority: 'none' | 'confirmed_human';
  contextVersion: string | null;
  receiptId: string | null;
};

export type WorkbenchRollup = {
  continuousPercent: number | null;
  quarterThreshold: QuarterThreshold | null;
  completedStepCount: number;
  totalStepCount: 4;
  weightPercent: 25;
  weightedContribution: number | null;
};

export type WorkbenchProfessionalProjection = {
  perspective: ProfessionalPerspective;
  label: string;
  quadrant: Quadrant;
  principalId: WorkbenchProfessionalSpec['principalId'];
  readOnly: boolean;
  runId: string | null;
  runStatus: V3ProcessRun['status'] | 'not_started';
  completionStatus: 'not_started' | 'in_progress' | 'completed';
  result: string;
  authority: 'none' | 'confirmed_human';
  professionalContent: {
    ruleName: string;
    rulePurpose: string;
    modelTask: string;
    humanGateLabel: string;
  };
  modelCandidate: {
    result: string;
    authority: 'none';
  };
  humanGate: {
    status: 'not_recorded' | 'confirmed' | 'rejected' | 'returned_for_evidence';
    result: string;
    contextVersion: string | null;
    receiptId: string | null;
    principalId: string | null;
    authority: 'none' | 'confirmed_human';
  };
  evidenceSources: Array<WorkbenchEvidenceSource>;
  path: Array<WorkbenchPathStep>;
  rollup: WorkbenchRollup;
};

export type WorkbenchReadModel = {
  schemaVersion: 'v3-case-workbench-1';
  businessItemType: 'FinancingLeasingCase';
  caseId: string;
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  defaultPerspective: WorkbenchPerspective;
  runtimeEpoch: string | null;
  contextVersion: string | null;
  provenance: {
    source: 'shared-v3-sqlite' | 'scenario-background-read-model';
    dataClass: 'synthetic_deidentified_demo';
    asOf: string;
    runtimeEpoch: string | null;
    contextVersion: string | null;
  };
  roleProjection: {
    principalId: string;
    roleApplicationId: V3RoleApplicationId;
    visiblePerspectives: Array<WorkbenchPerspective>;
    writablePerspectives: Array<WorkbenchPerspective>;
  };
  caseContext: {
    title: string;
    counterparty: string;
    industry: string;
    region: string;
    amount: string;
    lifecycleStatus: string;
    phase: string;
    nextMilestone: string;
  };
  businessOverview: {
    ownerPrincipalId: 'business-owner';
    professionalWeightPercent: 25;
    continuousPercent: number | null;
    quarterThreshold: QuarterThreshold | null;
    allowedActions: Array<BusinessActionType>;
    professionalQuadrants: Record<ProfessionalPerspective, Quadrant>;
  };
  professionalProjections: Record<ProfessionalPerspective, WorkbenchProfessionalProjection>;
  currentChatContext: {
    threadId: string;
    receiptIds: string[];
    candidateIds: string[];
    entries: Array<{
      eventId: string;
      principalId: string;
      processId: string | null;
      message: string;
      contextVersion: string | null;
      authority: 'none';
    }>;
  };
  integration: WorkbenchIntegrationState;
};

export type WorkbenchActionRequest = {
  requestId: string;
  expectedContextVersion: string;
  actionType: WorkbenchActionType;
  targetPrincipalId?: string;
  message?: string;
  rationale?: string;
  evidenceReceiptIds?: Array<string>;
};

export type SharedCoordinationActionInput = {
  requestId: string;
  caseId: string;
  contextVersion: string;
  actor: WorkbenchSession;
  perspective: WorkbenchPerspective;
  actionType: BusinessActionType | 'request-evidence';
  targetPrincipalId: string;
  message: string;
};

export type SharedProfessionalGateInput = {
  requestId: string;
  caseId: string;
  expectedContextVersion: string;
  actor: WorkbenchSession;
  processId: ProfessionalPerspective;
  decision: 'confirm' | 'reject' | 'return_for_evidence';
  rationale: string;
  evidenceReceiptIds: Array<string>;
};

export type SharedCoordinationRecord = {
  eventId: string;
  contextVersion: string;
  status: 'routed';
  authority: 'none';
};

export type SharedProfessionalGateRecord = {
  receiptId: string;
  eventId: string;
  contextVersion: string;
  principalId: string;
  processId: ProfessionalPerspective;
  status: 'confirm' | 'reject' | 'return_for_evidence';
};

export type WorkbenchActionResult = {
  requestId: string;
  caseId: string;
  contextVersion: string;
  perspective: WorkbenchPerspective;
  actionType: WorkbenchActionType;
  status: 'routed' | 'recorded';
  result: string;
  authority: 'none' | 'confirmed_human';
  authoritativeStateChanged: boolean;
  eventId: string;
  receiptId: string | null;
  route: {
    threadId: string;
    targetPrincipalId: string;
  };
  retry: {
    retryable: false;
  };
};

export interface SharedWorkbenchAdapter {
  readonly integration: WorkbenchIntegrationState;
  readCase(caseId: string): Promise<SharedWorkbenchSnapshot>;
  recordCoordinationAction(input: SharedCoordinationActionInput): Promise<SharedCoordinationRecord>;
  recordProfessionalGate(input: SharedProfessionalGateInput): Promise<SharedProfessionalGateRecord>;
}
