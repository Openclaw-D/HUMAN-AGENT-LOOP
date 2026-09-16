export type CapabilityAuthority = 'none';

export type CapabilityStage =
  | 'business'
  | 'credit'
  | 'commercial'
  | 'asset'
  | 'commencement';

export type CapabilityBusinessMode = 'direct' | 'existing_return' | 'new_return';

export type CapabilityReviewPath = 'standard' | 'exception';

export type CapabilityOutputKind = 'EvidenceDraft' | 'CandidateDraft';

export type CapabilityDefinition = {
  capabilityId: string;
  ownerActorId: string;
  ownerOrganizationUnitId: string;
  kind: string;
  authority: CapabilityAuthority;
};

export type CapabilityVersion = {
  capabilityId: string;
  version: string;
  definitionHash: string;
  supportedStages: CapabilityStage[];
  supportedBusinessModes: CapabilityBusinessMode[];
  supportedReviewPaths: CapabilityReviewPath[];
  requiredEvidenceKinds: string[];
  allowedOutputKinds: CapabilityOutputKind[];
};

export type CapabilityGovernanceState =
  | 'draft'
  | 'evaluated'
  | 'approved'
  | 'shadow'
  | 'active'
  | 'suspended'
  | 'rolled_back'
  | 'retired'
  | 'invalid';

export type CapabilityGovernanceEventEnvelope = {
  eventId: string;
  capabilityId: string;
  version: string;
  governanceVersion: number;
  actorId: string;
  organizationScopePath: string[];
};

export type CapabilityVersionRegisteredEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'version_registered';
  definition: CapabilityDefinition;
  capabilityVersion: CapabilityVersion;
};

export type CapabilityEvaluationPassedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'evaluation_passed';
  evaluationId: string;
};

export type CapabilityApprovalGrantedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'approval_granted';
  approvalReceiptId: string;
};

export type CapabilityShadowReleasedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'shadow_released';
  approvalReceiptId: string;
};

export type CapabilityActivatedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'activated';
  releaseReceiptId: string;
};

export type CapabilitySuspendedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'suspended';
  reason: string;
};

export type CapabilityResumedEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'resumed';
  releaseReceiptId: string;
};

export type CapabilityRolledBackEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'rolled_back';
  rollbackReceiptId: string;
  targetVersion: string;
};

export type CapabilityRetiredEvent = CapabilityGovernanceEventEnvelope & {
  eventType: 'retired';
  retirementReceiptId: string;
};

export type CapabilityGovernanceEvent =
  | CapabilityVersionRegisteredEvent
  | CapabilityEvaluationPassedEvent
  | CapabilityApprovalGrantedEvent
  | CapabilityShadowReleasedEvent
  | CapabilityActivatedEvent
  | CapabilitySuspendedEvent
  | CapabilityResumedEvent
  | CapabilityRolledBackEvent
  | CapabilityRetiredEvent;

export type CapabilityGovernanceInvalidReason =
  | 'EMPTY_HISTORY'
  | 'MALFORMED_EVENT'
  | 'FIRST_EVENT_NOT_REGISTERED'
  | 'DUPLICATE_EVENT_ID'
  | 'NON_CONTIGUOUS_GOVERNANCE_VERSION'
  | 'IDENTITY_MISMATCH'
  | 'SCOPE_MISMATCH'
  | 'INVALID_DEFINITION'
  | 'INVALID_VERSION_SNAPSHOT'
  | 'OUTPUT_BOUNDARY_VIOLATION'
  | 'SNAPSHOT_IDENTITY_MISMATCH'
  | 'ILLEGAL_TRANSITION'
  | 'LINEAGE_MISMATCH'
  | 'SAME_VERSION_ROLLBACK';

export type CapabilityGovernanceProjection = {
  state: CapabilityGovernanceState;
  invalidReason: CapabilityGovernanceInvalidReason | null;
  invalidEventIndex: number | null;
  capabilityId: string | null;
  version: string | null;
  governanceVersion: number;
  organizationScopePath: string[];
  definition: CapabilityDefinition | null;
  capabilityVersion: CapabilityVersion | null;
  evaluationId: string | null;
  approvalReceiptId: string | null;
  releaseReceiptId: string | null;
  suspensionReason: string | null;
  rollbackReceiptId: string | null;
  rollbackTargetVersion: string | null;
  retirementReceiptId: string | null;
  lastEventId: string | null;
  eventCount: number;
};

export type CapabilityAdmissionRequest = {
  caseId: string;
  attemptId: string;
  contextVersion: string;
  currentContextVersion: string;
  businessMode: CapabilityBusinessMode;
  reviewPath: CapabilityReviewPath;
  currentStage: CapabilityStage;
  caseOrganizationPath: string[];
  availableEvidenceKinds: string[];
  requestedOutputKind: CapabilityOutputKind;
  expectedCapabilityId: string;
  expectedCapabilityVersion: string;
  expectedGovernanceVersion: number;
  governanceProjection: CapabilityGovernanceProjection;
};

export type CapabilityAdmissionOutcome =
  | 'eligible'
  | 'ineligible'
  | 'denied'
  | 'unknown';

export type CapabilityAdmissionReasonCode =
  | 'INVALID_ADMISSION_INPUT'
  | 'INVALID_GOVERNANCE_PROJECTION'
  | 'STALE_GOVERNANCE'
  | 'CAPABILITY_SUSPENDED'
  | 'CAPABILITY_RETIRED'
  | 'CAPABILITY_INACTIVE'
  | 'CASE_CONTEXT_MISMATCH'
  | 'ORGANIZATION_SCOPE_DENIED'
  | 'STAGE_NOT_SUPPORTED'
  | 'BUSINESS_MODE_NOT_SUPPORTED'
  | 'REVIEW_PATH_NOT_SUPPORTED'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'OUTPUT_NOT_ALLOWED'
  | 'ELIGIBLE';

export type CapabilityAdmissionDecision = {
  outcome: CapabilityAdmissionOutcome;
  reasonCode: CapabilityAdmissionReasonCode;
  caseId: string | null;
  attemptId: string | null;
  contextVersion: string | null;
  capabilityId: string | null;
  version: string | null;
  governanceVersion: number;
  requestedOutputKind: CapabilityOutputKind | null;
  authority: CapabilityAuthority;
  missingEvidenceKinds: string[];
};
