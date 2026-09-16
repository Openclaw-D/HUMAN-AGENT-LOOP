import type { V4CaseClassification } from './types.ts';

export type WorkEventType =
  | 'case_opened'
  | 'evidence_accepted'
  | 'candidate_recorded'
  | 'pending_human_review'
  | 'supplement_requested'
  | 'supplement_resubmitted'
  | 'credit_approved'
  | 'attempt_rejected'
  | 'new_attempt_started'
  | 'final_vetoed'
  | 'credit_handoff_recorded';

export type WorkEventEnvelope = {
  eventId: string;
  sequence: number;
  eventType: WorkEventType;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  actorId: string;
  organizationPath: string[];
};

export type CaseOpenedEvent = WorkEventEnvelope & {
  eventType: 'case_opened';
  rootAttemptId: string;
  classification: V4CaseClassification;
};

export type EvidenceAcceptedEvent = WorkEventEnvelope & {
  eventType: 'evidence_accepted';
  previousContextVersion: string;
  newContextVersion: string;
  evidenceId: string;
  evidenceKind: string;
  evidenceReceiptId: string;
};

export type CandidateRecordedEvent = WorkEventEnvelope & {
  eventType: 'candidate_recorded';
  candidateId: string;
  capabilityId: string;
  capabilityVersion: string;
  governanceVersion: number;
  admissionDecisionId: string;
  evidenceReceiptIds: string[];
  outputKind: 'CandidateDraft';
  authority: 'none';
};

export type PendingHumanReviewEvent = WorkEventEnvelope & {
  eventType: 'pending_human_review';
  gateId: string;
  requiredActorId: string;
};

export type NamedHumanDecisionFields = {
  authoritySource: 'named_human';
  authorityDecisionOutcome: 'allowed';
  authorityDecisionId: string;
  policyVersion: string;
  decisionReceiptId: string;
};

export type SupplementRequestedEvent = WorkEventEnvelope & NamedHumanDecisionFields & {
  eventType: 'supplement_requested';
  requiredItems: string[];
  ownerActorId: string;
  dueAt: string;
};

export type SupplementResubmittedEvent = WorkEventEnvelope & {
  eventType: 'supplement_resubmitted';
  previousContextVersion: string;
  newContextVersion: string;
  supplementalEvidenceReceiptIds: string[];
};

export type CreditApprovedEvent = WorkEventEnvelope & NamedHumanDecisionFields & {
  eventType: 'credit_approved';
  gateId: string;
  candidateId: string;
  evidenceReceiptIds: string[];
  rationale: string;
};

export type AttemptRejectedEvent = WorkEventEnvelope & NamedHumanDecisionFields & {
  eventType: 'attempt_rejected';
};

export type NewAttemptStartedEvent = WorkEventEnvelope & {
  eventType: 'new_attempt_started';
  rootAttemptId: string;
  previousAttemptId: string;
  newAttemptId: string;
  newContextVersion: string;
  inheritedEvidenceReceiptIds: string[];
};

export type FinalVetoedEvent = WorkEventEnvelope & NamedHumanDecisionFields & {
  eventType: 'final_vetoed';
};

export type CreditHandoffRecordedEvent = WorkEventEnvelope & {
  eventType: 'credit_handoff_recorded';
  handoffId: string;
  sourceDecisionReceiptId: string;
  destinationStage: 'commercial';
  destinationAssignmentRef: string;
};

export type WorkEvent =
  | CaseOpenedEvent
  | EvidenceAcceptedEvent
  | CandidateRecordedEvent
  | PendingHumanReviewEvent
  | SupplementRequestedEvent
  | SupplementResubmittedEvent
  | CreditApprovedEvent
  | AttemptRejectedEvent
  | NewAttemptStartedEvent
  | FinalVetoedEvent
  | CreditHandoffRecordedEvent;

export type WorkAggregateInvalidReason =
  | 'EMPTY_HISTORY'
  | 'MALFORMED_EVENT'
  | 'DUPLICATE_EVENT_ID'
  | 'NON_CONTIGUOUS_SEQUENCE'
  | 'FIRST_EVENT_NOT_CASE_OPENED'
  | 'IDENTITY_LINEAGE_MISMATCH'
  | 'ILLEGAL_TRANSITION'
  | 'PROVENANCE_MISMATCH'
  | 'HUMAN_AUTHORITY_VIOLATION'
  | 'RECEIPT_HANDOFF_LINEAGE_MISMATCH';

export type WorkAttemptStatus = 'active' | 'rejected' | 'final_vetoed';

export type WorkWorkflowStatus =
  | 'active'
  | 'pending_human_review'
  | 'supplement_requested'
  | 'credit_approved'
  | 'attempt_rejected'
  | 'final_vetoed'
  | 'credit_handed_off';

export type WorkLifecycleState = {
  creditStatus:
    | 'in_review'
    | 'pending_human_review'
    | 'supplement_requested'
    | 'approved'
    | 'rejected_current_attempt'
    | 'vetoed_final';
  commercialStatus: 'not_started' | 'pending';
  assetStatus: 'not_started';
  commencementStatus: 'not_started';
};

export type WorkEvidenceRef = {
  evidenceId: string;
  evidenceKind: string;
  evidenceReceiptId: string;
};

export type WorkCandidateDraft = {
  candidateId: string;
  capabilityId: string;
  capabilityVersion: string;
  governanceVersion: number;
  admissionDecisionId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  evidenceReceiptIds: string[];
  outputKind: 'CandidateDraft';
  authority: 'none';
};

export type WorkHumanGate = {
  gateId: string;
  requiredActorId: string;
  contextVersion: string;
};

export type WorkSupplementRequest = {
  requiredItems: string[];
  ownerActorId: string;
  dueAt: string;
  requestedByActorId: string;
  authorityDecisionId: string;
  decisionReceiptId: string;
};

export type WorkNamedHumanDecision = {
  action:
    | 'return_for_supplement'
    | 'approve_credit'
    | 'reject_current_attempt'
    | 'veto_final';
  actorId: string;
  authoritySource: 'named_human';
  authorityDecisionOutcome: 'allowed';
  authorityDecisionId: string;
  policyVersion: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
};

export type WorkHandoffRef = {
  handoffId: string;
  sourceDecisionReceiptId: string;
  destinationStage: 'commercial';
  destinationAssignmentRef: string;
};

export type WorkAggregateProjection = {
  state: 'valid' | 'invalid';
  invalidReason: WorkAggregateInvalidReason | null;
  invalidEventIndex: number | null;
  caseId: string | null;
  attemptId: string | null;
  rootAttemptId: string | null;
  previousAttemptId: string | null;
  contextVersion: string | null;
  organizationPath: string[];
  classification: V4CaseClassification | null;
  currentStage: 'credit' | 'commercial' | null;
  attemptStatus: WorkAttemptStatus | null;
  workflowStatus: WorkWorkflowStatus | null;
  lifecycle: WorkLifecycleState | null;
  acceptedEvidence: WorkEvidenceRef[];
  inheritedEvidenceReceiptIds: string[];
  candidateDraft: WorkCandidateDraft | null;
  currentHumanGate: WorkHumanGate | null;
  supplementRequest: WorkSupplementRequest | null;
  namedHumanDecision: WorkNamedHumanDecision | null;
  decisionReceiptId: string | null;
  handoff: WorkHandoffRef | null;
  eventCount: number;
  lastEventId: string | null;
};

export type V4AcceptEvidenceCommand = {
  requestId: string;
  idempotencyKey: string;
  operation: 'accept_evidence';
  expectedContextVersion: string;
  payload: {
    caseId: string;
    evidenceId: string;
    evidenceKind: string;
  };
};

export type V4RecordCandidateCommand = {
  requestId: string;
  idempotencyKey: string;
  operation: 'record_candidate';
  expectedContextVersion: string;
  payload: {
    caseId: string;
    preparedCandidateRef: string;
  };
};

export type V4SubmitCreditDecisionCommand = {
  requestId: string;
  idempotencyKey: string;
  operation: 'submit_credit_decision';
  expectedContextVersion: string;
  payload: {
    caseId: string;
    action: 'approve_credit';
    rationale: string;
  };
};

export type V4WorkCommand =
  | V4AcceptEvidenceCommand
  | V4RecordCandidateCommand
  | V4SubmitCreditDecisionCommand;

export type V4WorkCommandInput = {
  sessionId: string;
  command: V4WorkCommand;
};

export type V4EvidenceReceipt = {
  evidenceReceiptId: string;
  receiptType: 'evidence_accepted';
  status: 'committed';
  caseId: string;
  attemptId: string;
  actorId: string;
  evidenceId: string;
  evidenceKind: string;
  previousContextVersion: string;
  newContextVersion: string;
  eventId: string;
  sequence: number;
};

export type V4AcceptEvidenceCommandReceipt = {
  status: 'committed';
  requestId: string;
  idempotencyKey: string;
  operation: 'accept_evidence';
  caseId: string;
  attemptId: string;
  actorId: string;
  policyVersion: string;
  previousContextVersion: string;
  newContextVersion: string;
  eventId: string;
  evidenceReceiptId: string;
};

export type V4CandidateReceipt = {
  candidateReceiptId: string;
  receiptType: 'candidate_recorded';
  status: 'committed';
  caseId: string;
  attemptId: string;
  actorId: string;
  contextVersion: string;
  preparedCandidateRef: string;
  candidateId: string;
  capabilityId: string;
  capabilityVersion: string;
  governanceVersion: number;
  admissionDecisionId: string;
  evidenceReceiptIds: string[];
  candidateEventId: string;
  gateEventId: string;
  gateId: string;
  requiredActorId: string;
  assignmentRef: string;
};

export type V4RecordCandidateCommandReceipt = {
  status: 'committed';
  requestId: string;
  idempotencyKey: string;
  operation: 'record_candidate';
  caseId: string;
  attemptId: string;
  actorId: string;
  policyVersion: string;
  contextVersion: string;
  preparedCandidateRef: string;
  candidateId: string;
  capabilityId: string;
  capabilityVersion: string;
  governanceVersion: number;
  admissionDecisionId: string;
  candidateReceiptId: string;
  candidateEventId: string;
  gateEventId: string;
  gateId: string;
  requiredActorId: string;
  assignmentRef: string;
};

export type V4CreditDecisionReceipt = {
  decisionReceiptId: string;
  receiptType: 'credit_decision';
  status: 'committed';
  action: 'approve_credit';
  caseId: string;
  attemptId: string;
  actorId: string;
  contextVersion: string;
  authoritySource: 'named_human';
  authorityDecisionOutcome: 'allowed';
  authorityDecisionId: string;
  policyVersion: string;
  gateId: string;
  candidateId: string;
  evidenceReceiptIds: string[];
  rationale: string;
  eventId: string;
  sequence: number;
};

export type V4SubmitCreditDecisionCommandReceipt = {
  status: 'committed';
  requestId: string;
  idempotencyKey: string;
  operation: 'submit_credit_decision';
  caseId: string;
  attemptId: string;
  actorId: string;
  policyVersion: string;
  contextVersion: string;
  decisionReceiptId: string;
  authorityDecisionId: string;
  gateId: string;
  candidateId: string;
  evidenceReceiptIds: string[];
  rationale: string;
  eventId: string;
  sequence: number;
};

export type V4WorkCommandReceipt =
  | V4AcceptEvidenceCommandReceipt
  | V4RecordCandidateCommandReceipt
  | V4SubmitCreditDecisionCommandReceipt;

export type V4WorkCommandResult = {
  receipt: V4WorkCommandReceipt;
  projection: WorkAggregateProjection;
};

export type V4WorkCommandHandlerErrorCode =
  | 'INVALID_COMMAND'
  | 'SESSION_NOT_FOUND'
  | 'CASE_NOT_FOUND'
  | 'CORRUPT_HISTORY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'AUTHORITY_DENIED'
  | 'AUTHORITY_UNKNOWN'
  | 'STALE_CONTEXT'
  | 'PREPARED_CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_PROVENANCE_INVALID'
  | 'GOVERNANCE_INVALID'
  | 'GOVERNANCE_STALE'
  | 'ADMISSION_INELIGIBLE'
  | 'ADMISSION_DENIED'
  | 'ADMISSION_UNKNOWN'
  | 'HUMAN_GATE_ASSIGNMENT_MISSING'
  | 'HUMAN_GATE_NOT_PENDING'
  | 'HUMAN_GATE_ACTOR_MISMATCH'
  | 'DECISION_LINEAGE_INVALID'
  | 'TRANSACTION_FAILED';

export class V4WorkCommandHandlerError extends Error {
  readonly code: V4WorkCommandHandlerErrorCode;

  constructor(code: V4WorkCommandHandlerErrorCode) {
    super(code);
    this.name = 'V4WorkCommandHandlerError';
    this.code = code;
  }
}
