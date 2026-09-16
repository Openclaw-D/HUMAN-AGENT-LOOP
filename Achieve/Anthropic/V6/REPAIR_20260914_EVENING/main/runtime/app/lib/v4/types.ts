export type BusinessMode = 'direct' | 'existing_return' | 'new_return';

export type AcquisitionSource =
  | 'supplier_referral'
  | 'existing_contract_list'
  | 'market_acquisition'
  | 'relationship_maintenance'
  | 'other';

export type ReviewPath = 'standard' | 'exception';

export type DueDiligenceMode =
  | 'business_site'
  | 'joint_business_credit_site'
  | 'remote_plus_site';

export type V4CaseClassification = {
  businessMode: BusinessMode;
  acquisitionSource: AcquisitionSource;
  reviewPath: ReviewPath;
  dueDiligenceMode: DueDiligenceMode;
};

export type CreditStatus =
  | 'not_started'
  | 'rule_screening'
  | 'pending_human_review'
  | 'returned_for_supplement'
  | 'resubmitted'
  | 'approved_by_rule'
  | 'approved_by_human'
  | 'rejected_current_attempt'
  | 'vetoed_final';

export type ReadinessStatus = 'not_started' | 'pending' | 'ready' | 'blocked';
export type CommencementStatus = 'not_started' | 'pending' | 'commenced' | 'failed' | 'unknown';

export type V4LifecycleState = {
  creditStatus: CreditStatus;
  commercialStatus: ReadinessStatus;
  assetStatus: ReadinessStatus;
  commencementStatus: CommencementStatus;
};

export type AuthoritySource = 'candidate_model' | 'authorized_rule' | 'confirmed_human';
export type V4DecisionAction =
  | 'approve_credit'
  | 'return_for_supplement'
  | 'reject_current_attempt'
  | 'veto_final';

export type V4NamedActor = {
  actorId: string;
  displayName: string;
};

export type V4AttemptLineage = {
  rootAttemptId: string;
  previousAttemptId: string | null;
  sourceDecisionId: string | null;
  terminalDecisionId: string | null;
  inheritedEvidenceReceiptIds: string[];
  status: 'active' | 'terminated' | 'final';
};

export type V4Case = {
  caseId: string;
  attemptId: string;
  classification: V4CaseClassification;
  lifecycle: V4LifecycleState;
  currentStage: 'business' | 'credit' | 'commercial' | 'asset' | 'commencement';
  contextVersion: string;
  authorityState: 'waiting' | 'candidate_ready' | 'gate_required' | 'decided';
  attemptLineage: V4AttemptLineage;
};

export type V4Candidate = {
  candidateId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  modelVersion: string;
  rationale: string;
  evidenceReceiptIds: string[];
  authoritySource: 'candidate_model';
  authority: 'none';
};

export type V4AuthorizedRule = {
  ruleId: string;
  version: string;
  deterministic: true;
  scope: {
    scopeId: string;
    businessModes: BusinessMode[];
    reviewPaths: ReviewPath[];
    actions: Array<'approve_credit'>;
  };
  approval: {
    approvalId: string;
    approvedByActorId: string;
    approvedAt: string;
  };
  rollback: {
    rollbackId: string;
    previousVersion: string;
    procedureRef: string;
  };
};

export type V4PolicyOutcome = 'allowed' | 'denied' | 'failure' | 'timeout' | 'unknown';

export type V4HumanDecisionPolicy = (input: {
  actor: V4NamedActor;
  action: V4DecisionAction;
  case: V4Case;
}) => {
  outcome: V4PolicyOutcome;
  policyVersion: string;
};

export type V4SupplementRequest = {
  requiredItems: string[];
  ownerActorId: string;
  dueAt: string;
  evidenceLineage: string[];
};

type V4DecisionCommandBase = {
  decisionId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  action: V4DecisionAction;
  rationale: string;
  evidenceReceiptIds: string[];
  receiptId: string;
  supplementRequest?: V4SupplementRequest;
};

export type V4DecisionCommand = V4DecisionCommandBase & (
  | {
      authoritySource: 'candidate_model';
      candidate: V4Candidate;
    }
  | {
      authoritySource: 'authorized_rule';
      rule: V4AuthorizedRule;
    }
  | {
      authoritySource: 'confirmed_human';
      actor: V4NamedActor;
      policy: V4HumanDecisionPolicy;
    }
);

export type V4Decision = {
  decisionId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  action: V4DecisionAction;
  authoritySource: Exclude<AuthoritySource, 'candidate_model'>;
  actorId: string;
  policyVersion: string;
  rationale: string;
  evidenceReceiptIds: string[];
  supplementRequest: V4SupplementRequest | null;
};

export type V4DecisionReceipt = {
  receiptId: string;
  receiptType: 'credit_decision';
  caseId: string;
  attemptId: string;
  contextVersion: string;
  status: 'succeeded';
  decision: V4Decision;
  resultingLifecycle: V4LifecycleState;
};

export type V4ResubmissionReceipt = {
  receiptId: string;
  receiptType: 'supplement_resubmitted';
  caseId: string;
  attemptId: string;
  previousContextVersion: string;
  contextVersion: string;
  actorId: string;
  evidenceReceiptIds: string[];
  status: 'succeeded';
};

export type V4AttemptReceipt = {
  receiptId: string;
  receiptType: 'attempt_started';
  caseId: string;
  previousAttemptId: string;
  attemptId: string;
  sourceDecisionId: string;
  contextVersion: string;
  inheritedEvidenceReceiptIds: string[];
  status: 'succeeded';
};

export type V4TransitionResult<TReceipt> = {
  case: V4Case;
  receipt: TReceipt;
};
