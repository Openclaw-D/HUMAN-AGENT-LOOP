import type {
  V4AccessGrant,
  V4ActorIdentity,
  V4ExplicitDeny,
  V4RoleAssignment,
} from './authority-types.ts';
import type {
  CapabilityGovernanceEvent,
  CapabilityOutputKind,
} from './capability-admission-types.ts';
import type { V4Case } from './types.ts';

export type ServerReadSession = {
  actor: V4ActorIdentity;
  roleAssignments: V4RoleAssignment[];
  grants: V4AccessGrant[];
  denies: V4ExplicitDeny[];
  policyVersion: string;
};

export type ServerEvidenceRecord = {
  evidenceId: string;
  evidenceKind: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  status: 'accepted';
};

export type ServerCandidateDraftRecord = {
  capabilityId: string;
  version: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  authority: 'none';
};

export type ServerHumanGateRecord = {
  gateId: string;
  gateType: 'credit_professional_review';
  requiredActorId: string;
  caseId: string;
  attemptId: string;
  contextVersion: string;
  status: 'pending';
};

export type ServerCaseRecord = {
  case: V4Case;
  organizationPath: string[];
  currentOwnerActorId: string;
  assignmentRefs: string[];
  evidence: ServerEvidenceRecord[];
  candidateDraft: ServerCandidateDraftRecord;
  currentHumanGate: ServerHumanGateRecord;
  decisionReceipt: null;
  handoff: null;
  anomalyCodes: string[];
  availableEvidenceKinds: string[];
  requestedOutputKind: CapabilityOutputKind;
};

export type ServerManagementScope = {
  scopeId: string;
  scopePath: string[];
};

export type ServerReadSnapshot = {
  currentPolicyVersion: string;
  managementScope: ServerManagementScope;
  caseRecord: ServerCaseRecord;
  governanceEvents: CapabilityGovernanceEvent[];
};

type TestCorruptionMode = 'case_identity_drift' | 'invalid_governance' | null;

const CASE_ID = 'CASE-V4-SYNTH-001';
const ATTEMPT_ID = 'ATTEMPT-V4-SYNTH-001';
const CONTEXT_VERSION = 'CONTEXT-V4-007';
const CAPABILITY_ID = 'credit.material-gap-analyzer';
const CAPABILITY_VERSION = '1.0.0';
const POLICY_VERSION = 'POLICY-V4-001';
const CASE_ORGANIZATION_PATH = ['group', 'division-a', 'credit-team', 'portfolio-a'];
const CAPABILITY_ORGANIZATION_PATH = ['group', 'division-a', 'credit-team'];
const MANAGEMENT_SCOPE_PATH = ['group', 'division-a'];
const MANAGEMENT_SCOPE_ID = 'ORG-DIVISION-A';

const BASE_SNAPSHOT: ServerReadSnapshot = {
  currentPolicyVersion: POLICY_VERSION,
  managementScope: {
    scopeId: MANAGEMENT_SCOPE_ID,
    scopePath: MANAGEMENT_SCOPE_PATH,
  },
  caseRecord: {
    case: {
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_VERSION,
      classification: {
        businessMode: 'direct',
        acquisitionSource: 'supplier_referral',
        reviewPath: 'exception',
        dueDiligenceMode: 'business_site',
      },
      lifecycle: {
        creditStatus: 'pending_human_review',
        commercialStatus: 'not_started',
        assetStatus: 'not_started',
        commencementStatus: 'not_started',
      },
      currentStage: 'credit',
      authorityState: 'gate_required',
      attemptLineage: {
        rootAttemptId: ATTEMPT_ID,
        previousAttemptId: null,
        sourceDecisionId: null,
        terminalDecisionId: null,
        inheritedEvidenceReceiptIds: [],
        status: 'active',
      },
    },
    organizationPath: CASE_ORGANIZATION_PATH,
    currentOwnerActorId: 'actor-credit-professional-001',
    assignmentRefs: ['QUEUE-CREDIT-EXCEPTION', 'ASSIGN-CREDIT-001'],
    evidence: [
      {
        evidenceId: 'EVIDENCE-TAX-001',
        evidenceKind: 'tax_record',
        caseId: CASE_ID,
        attemptId: ATTEMPT_ID,
        contextVersion: CONTEXT_VERSION,
        status: 'accepted',
      },
      {
        evidenceId: 'EVIDENCE-LICENSE-001',
        evidenceKind: 'business_license',
        caseId: CASE_ID,
        attemptId: ATTEMPT_ID,
        contextVersion: CONTEXT_VERSION,
        status: 'accepted',
      },
    ],
    candidateDraft: {
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_VERSION,
      authority: 'none',
    },
    currentHumanGate: {
      gateId: 'GATE-CREDIT-001',
      gateType: 'credit_professional_review',
      requiredActorId: 'actor-credit-professional-001',
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_VERSION,
      status: 'pending',
    },
    decisionReceipt: null,
    handoff: null,
    anomalyCodes: ['HUMAN_GATE_PENDING', 'CAPABILITY_DRAFT_NON_AUTHORITATIVE'],
    availableEvidenceKinds: ['tax_record', 'business_license'],
    requestedOutputKind: 'CandidateDraft',
  },
  governanceEvents: [
    {
      eventType: 'version_registered',
      eventId: 'CAP-EVENT-001',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      governanceVersion: 1,
      actorId: 'actor-capability-owner-001',
      organizationScopePath: CAPABILITY_ORGANIZATION_PATH,
      definition: {
        capabilityId: CAPABILITY_ID,
        ownerActorId: 'actor-capability-owner-001',
        ownerOrganizationUnitId: 'credit-team',
        kind: 'Analyzer',
        authority: 'none',
      },
      capabilityVersion: {
        capabilityId: CAPABILITY_ID,
        version: CAPABILITY_VERSION,
        definitionHash: 'sha256:synthetic-capability-definition',
        supportedStages: ['credit'],
        supportedBusinessModes: ['direct'],
        supportedReviewPaths: ['exception'],
        requiredEvidenceKinds: ['tax_record', 'business_license'],
        allowedOutputKinds: ['CandidateDraft'],
      },
    },
    {
      eventType: 'evaluation_passed',
      eventId: 'CAP-EVENT-002',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      governanceVersion: 2,
      actorId: 'actor-capability-evaluator-001',
      organizationScopePath: CAPABILITY_ORGANIZATION_PATH,
      evaluationId: 'CAP-EVALUATION-001',
    },
    {
      eventType: 'approval_granted',
      eventId: 'CAP-EVENT-003',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      governanceVersion: 3,
      actorId: 'actor-release-approver-001',
      organizationScopePath: CAPABILITY_ORGANIZATION_PATH,
      approvalReceiptId: 'CAP-APPROVAL-001',
    },
    {
      eventType: 'shadow_released',
      eventId: 'CAP-EVENT-004',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      governanceVersion: 4,
      actorId: 'actor-release-approver-001',
      organizationScopePath: CAPABILITY_ORGANIZATION_PATH,
      approvalReceiptId: 'CAP-APPROVAL-001',
    },
    {
      eventType: 'activated',
      eventId: 'CAP-EVENT-005',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      governanceVersion: 5,
      actorId: 'actor-release-approver-001',
      organizationScopePath: CAPABILITY_ORGANIZATION_PATH,
      releaseReceiptId: 'CAP-RELEASE-001',
    },
  ],
};

function internalActor(actorId: string, organizationPath: string[]): V4ActorIdentity {
  return {
    actorId,
    kind: 'internal_human',
    organizationPath,
    externalInvitation: null,
  };
}

function roleAssignment(
  assignmentId: string,
  actorId: string,
  role: V4RoleAssignment['role'],
  organizationPath: string[],
): V4RoleAssignment {
  return {
    assignmentId,
    actorId,
    role,
    scope: { mode: 'subtree', organizationPath },
  };
}

function caseGrant(actorId: string, grantId: string, organizationPath: string[]): V4AccessGrant {
  return {
    grantId,
    actorId,
    action: { family: 'observe', name: 'observe_case' },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'subtree', organizationPath },
    policyVersion: POLICY_VERSION,
    invitationId: null,
  };
}

const CASE_ACTOR_ID = 'actor-credit-reader-001';
const MANAGEMENT_ACTOR_ID = 'actor-management-reader-001';
const DENY_ACTOR_ID = 'actor-denied-reader-001';
const ROLE_ONLY_ACTOR_ID = 'actor-role-only-reader-001';
const OUT_OF_SCOPE_ACTOR_ID = 'actor-out-of-scope-reader-001';

const SESSIONS: ReadonlyMap<string, ServerReadSession> = new Map(Object.entries({
  'SESSION-CASE-ALLOWED': {
    actor: internalActor(CASE_ACTOR_ID, CAPABILITY_ORGANIZATION_PATH),
    roleAssignments: [roleAssignment(
      'ROLE-CASE-001',
      CASE_ACTOR_ID,
      'credit_professional',
      CAPABILITY_ORGANIZATION_PATH,
    )],
    grants: [caseGrant(CASE_ACTOR_ID, 'GRANT-CASE-001', CAPABILITY_ORGANIZATION_PATH)],
    denies: [],
    policyVersion: POLICY_VERSION,
  },
  'SESSION-MANAGEMENT-ALLOWED': {
    actor: internalActor(MANAGEMENT_ACTOR_ID, MANAGEMENT_SCOPE_PATH),
    roleAssignments: [roleAssignment(
      'ROLE-MANAGEMENT-001',
      MANAGEMENT_ACTOR_ID,
      'organization_director',
      MANAGEMENT_SCOPE_PATH,
    )],
    grants: [{
      grantId: 'GRANT-MANAGEMENT-001',
      actorId: MANAGEMENT_ACTOR_ID,
      action: { family: 'observe', name: 'observe_organization' },
      resourceType: 'organization',
      resourceId: MANAGEMENT_SCOPE_ID,
      organizationScope: { mode: 'subtree', organizationPath: MANAGEMENT_SCOPE_PATH },
      policyVersion: POLICY_VERSION,
      invitationId: null,
    }],
    denies: [],
    policyVersion: POLICY_VERSION,
  },
  'SESSION-EXPLICIT-DENY': {
    actor: internalActor(DENY_ACTOR_ID, CAPABILITY_ORGANIZATION_PATH),
    roleAssignments: [roleAssignment(
      'ROLE-DENY-001',
      DENY_ACTOR_ID,
      'credit_professional',
      CAPABILITY_ORGANIZATION_PATH,
    )],
    grants: [caseGrant(DENY_ACTOR_ID, 'GRANT-DENY-001', CAPABILITY_ORGANIZATION_PATH)],
    denies: [{
      denyId: 'DENY-CASE-001',
      actorId: DENY_ACTOR_ID,
      action: { family: 'observe', name: 'observe_case' },
      resourceType: 'case',
      resourceId: CASE_ID,
      organizationScope: { mode: 'subtree', organizationPath: CAPABILITY_ORGANIZATION_PATH },
      policyVersion: POLICY_VERSION,
      invitationId: null,
    }],
    policyVersion: POLICY_VERSION,
  },
  'SESSION-ROLE-ONLY': {
    actor: internalActor(ROLE_ONLY_ACTOR_ID, CAPABILITY_ORGANIZATION_PATH),
    roleAssignments: [roleAssignment(
      'ROLE-ONLY-001',
      ROLE_ONLY_ACTOR_ID,
      'credit_professional',
      CAPABILITY_ORGANIZATION_PATH,
    )],
    grants: [],
    denies: [],
    policyVersion: POLICY_VERSION,
  },
  'SESSION-OUT-OF-SCOPE': {
    actor: internalActor(OUT_OF_SCOPE_ACTOR_ID, ['group', 'division-b']),
    roleAssignments: [],
    grants: [caseGrant(OUT_OF_SCOPE_ACTOR_ID, 'GRANT-OUT-OF-SCOPE-001', ['group', 'division-b'])],
    denies: [],
    policyVersion: POLICY_VERSION,
  },
} satisfies Record<string, ServerReadSession>));

let testCorruptionMode: TestCorruptionMode = null;

export function resolveServerReadSession(sessionId: string): ServerReadSession | null {
  const session = SESSIONS.get(sessionId);
  return session === undefined ? null : structuredClone(session);
}

export function getServerReadSnapshot(): ServerReadSnapshot {
  const snapshot = structuredClone(BASE_SNAPSHOT);
  if (testCorruptionMode === 'case_identity_drift') {
    snapshot.caseRecord.candidateDraft.contextVersion = 'CONTEXT-FORGED';
  }
  if (testCorruptionMode === 'invalid_governance') {
    snapshot.governanceEvents[4].governanceVersion = 1;
  }
  return snapshot;
}

export function __testOnlySetServerReadCorruption(mode: Exclude<TestCorruptionMode, null>): void {
  testCorruptionMode = mode;
}

export function __testOnlyResetServerReadContext(): void {
  testCorruptionMode = null;
}
