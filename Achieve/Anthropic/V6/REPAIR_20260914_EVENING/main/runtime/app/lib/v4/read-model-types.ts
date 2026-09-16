import type {
  CapabilityAdmissionOutcome,
  CapabilityAdmissionReasonCode,
  CapabilityGovernanceState,
  CapabilityOutputKind,
} from './capability-admission-types.ts';
import type { V4CaseClassification, V4LifecycleState } from './types.ts';

export type V4ReadServiceErrorCode =
  | 'INVALID_READ_INPUT'
  | 'SESSION_NOT_FOUND'
  | 'CASE_NOT_FOUND'
  | 'SCOPE_NOT_FOUND'
  | 'READ_DENIED'
  | 'PROJECTION_INVALID';

export class V4ReadServiceError extends Error {
  readonly code: V4ReadServiceErrorCode;

  constructor(code: V4ReadServiceErrorCode) {
    super(code);
    this.name = 'V4ReadServiceError';
    this.code = code;
  }
}

export type V4CapabilityAdmissionSummary = {
  capabilityId: string;
  version: string;
  governanceVersion: number;
  state: CapabilityGovernanceState;
  admissionOutcome: CapabilityAdmissionOutcome;
  admissionReasonCode: CapabilityAdmissionReasonCode;
  requestedOutputKind: CapabilityOutputKind;
  authority: 'none';
};

export type V4EvidenceSummary = {
  evidenceKind: string;
  evidenceId: string;
};

export type V4CandidateDraftSummary = {
  capabilityId: string;
  version: string;
  contextVersion: string;
  authority: 'none';
};

export type V4HumanGateSummary = {
  gateId: string;
  gateType: 'credit_professional_review';
  requiredActorId: string;
  status: 'pending';
};

export type V4DecisionReceiptSummary = {
  receiptId: string;
  decision: 'approved' | 'returned' | 'rejected' | 'vetoed';
} | null;

export type V4HandoffSummary = {
  handoffId: string;
  destinationAssignmentRef: string;
} | null;

export type V4WorkProjectionDto = {
  caseId: string;
  attemptId: string;
  contextVersion: string;
  classification: V4CaseClassification;
  lifecycle: V4LifecycleState;
  currentStage: 'business' | 'credit' | 'commercial' | 'asset' | 'commencement';
  organizationPath: string[];
  currentOwnerActorId: string;
  assignmentRefs: string[];
  evidence: V4EvidenceSummary[];
  candidateDraft: V4CandidateDraftSummary;
  currentHumanGate: V4HumanGateSummary;
  decisionReceipt: V4DecisionReceiptSummary;
  handoff: V4HandoffSummary;
  capabilityAdmission: V4CapabilityAdmissionSummary;
};

export type V4ManagementCaseSummary = {
  caseId: string;
  attemptId: string;
  contextVersion: string;
  currentStage: 'business' | 'credit' | 'commercial' | 'asset' | 'commencement';
  lifecycle: V4LifecycleState;
  anomalyCodes: string[];
};

export type V4ManagementProjectionDto = {
  scopeId: string;
  scopePath: string[];
  policyVersion: string;
  cases: V4ManagementCaseSummary[];
  capabilityAdmission: V4CapabilityAdmissionSummary;
};
