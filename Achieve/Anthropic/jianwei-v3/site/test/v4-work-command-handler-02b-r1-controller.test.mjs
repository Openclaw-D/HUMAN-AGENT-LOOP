import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4WorkCommandHandler } from '../lib/v4/work-command-handler.ts';
import { V4WorkCommandHandlerError } from '../lib/v4/work-command-types.ts';
import { createInMemoryV4WorkStore } from '../lib/v4/work-store.ts';

const CASE_ID = 'CASE-HANDLER-R1-001';
const ATTEMPT_ID = 'ATTEMPT-HANDLER-R1-001';
const CONTEXT_ID = 'CONTEXT-HANDLER-R1-001';
const RECORD_CONTEXT_ID = 'V4-CONTEXT-000002';
const SESSION_ID = 'SESSION-HANDLER-R1-001';
const ACTOR_ID = 'ACTOR-HANDLER-R1-001';
const REVIEWER_ID = 'ACTOR-CREDIT-REVIEWER-R1-001';
const POLICY_VERSION = 'POLICY-HANDLER-R1-001';
const ORGANIZATION_PATH = ['group', 'division-a', 'credit-team'];
const PREPARED_REF = 'PREPARED-CANDIDATE-R1-001';
const CANDIDATE_ID = 'CANDIDATE-HANDLER-R1-001';
const CAPABILITY_ID = 'credit.material-gap-analyzer';
const CAPABILITY_VERSION = '1.0.0';

function opened(overrides = {}) {
  return {
    eventId: 'WORK-OPENED-R1-001',
    sequence: 1,
    eventType: 'case_opened',
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    contextVersion: CONTEXT_ID,
    actorId: 'ACTOR-CASE-OPENER-R1',
    organizationPath: [...ORGANIZATION_PATH],
    rootAttemptId: ATTEMPT_ID,
    classification: {
      businessMode: 'direct',
      acquisitionSource: 'supplier_referral',
      reviewPath: 'exception',
      dueDiligenceMode: 'business_site',
    },
    ...overrides,
  };
}

function internalHuman(actorId = REVIEWER_ID, overrides = {}) {
  return {
    actorId,
    kind: 'internal_human',
    organizationPath: [...ORGANIZATION_PATH],
    externalInvitation: null,
    ...overrides,
  };
}

function externalHuman(caseId = CASE_ID, overrides = {}) {
  return {
    actorId: REVIEWER_ID,
    kind: 'external_human',
    organizationPath: null,
    externalInvitation: {
      invitationId: 'INVITATION-REVIEWER-R1-001',
      caseId,
      organizationPath: [...ORGANIZATION_PATH],
    },
    ...overrides,
  };
}

function nonHuman(kind) {
  return {
    actorId: REVIEWER_ID,
    kind,
    organizationPath: [...ORGANIZATION_PATH],
    externalInvitation: null,
  };
}

function grant(name) {
  return {
    grantId: `GRANT-${name}-R1-001`,
    actorId: ACTOR_ID,
    action: { family: 'prepare', name },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    policyVersion: POLICY_VERSION,
    invitationId: null,
  };
}

function session(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    actor: internalHuman(ACTOR_ID),
    roleAssignments: [],
    grants: [grant('prepare_evidence_draft'), grant('prepare_candidate_draft')],
    denies: [],
    presentedInvitationId: null,
    ...overrides,
  };
}

function preparedCandidate() {
  return {
    preparedCandidateRef: PREPARED_REF,
    candidateId: CANDIDATE_ID,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: CAPABILITY_VERSION,
    observedGovernanceVersion: 5,
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    contextVersion: RECORD_CONTEXT_ID,
    evidenceReceiptIds: ['V4-EVIDENCE-RECEIPT-000002'],
    outputKind: 'CandidateDraft',
    authority: 'none',
  };
}

function governanceHistory() {
  const envelope = (eventType, governanceVersion) => ({
    eventType,
    eventId: `GOVERNANCE-R1-${String(governanceVersion).padStart(3, '0')}`,
    capabilityId: CAPABILITY_ID,
    version: CAPABILITY_VERSION,
    governanceVersion,
    actorId: 'ACTOR-GOVERNANCE-R1-001',
    organizationScopePath: [...ORGANIZATION_PATH],
  });
  return [
    {
      ...envelope('version_registered', 1),
      definition: {
        capabilityId: CAPABILITY_ID,
        ownerActorId: 'ACTOR-CAPABILITY-OWNER-R1-001',
        ownerOrganizationUnitId: 'credit-team',
        kind: 'Analyzer',
        authority: 'none',
      },
      capabilityVersion: {
        capabilityId: CAPABILITY_ID,
        version: CAPABILITY_VERSION,
        definitionHash: 'sha256:handler-r1-definition',
        supportedStages: ['credit'],
        supportedBusinessModes: ['direct'],
        supportedReviewPaths: ['exception'],
        requiredEvidenceKinds: ['business_license'],
        allowedOutputKinds: ['CandidateDraft'],
      },
    },
    { ...envelope('evaluation_passed', 2), evaluationId: 'EVALUATION-R1-001' },
    { ...envelope('approval_granted', 3), approvalReceiptId: 'APPROVAL-R1-001' },
    { ...envelope('shadow_released', 4), approvalReceiptId: 'APPROVAL-R1-001' },
    { ...envelope('activated', 5), releaseReceiptId: 'RELEASE-R1-001' },
  ];
}

function seed({ actors = [internalHuman()], sessions = [session()], cases } = {}) {
  return {
    currentPolicyVersion: POLICY_VERSION,
    actors,
    sessions,
    cases: cases ?? [{ caseId: CASE_ID, events: [opened()] }],
    preparedCandidates: [preparedCandidate()],
    capabilityGovernanceHistories: [{
      capabilityId: CAPABILITY_ID,
      capabilityVersion: CAPABILITY_VERSION,
      events: governanceHistory(),
    }],
    creditReviewAssignments: [{
      caseId: CASE_ID,
      assignmentRef: 'ASSIGNMENT-CREDIT-REVIEW-R1-001',
      requiredActorId: REVIEWER_ID,
    }],
  };
}

function acceptEvidenceInput() {
  return {
    sessionId: SESSION_ID,
    command: {
      requestId: 'REQUEST-EVIDENCE-R1-001',
      idempotencyKey: 'IDEMPOTENCY-EVIDENCE-R1-001',
      operation: 'accept_evidence',
      expectedContextVersion: CONTEXT_ID,
      payload: {
        caseId: CASE_ID,
        evidenceId: 'EVIDENCE-R1-001',
        evidenceKind: 'business_license',
      },
    },
  };
}

function recordCandidateInput(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    command: {
      requestId: 'REQUEST-CANDIDATE-R1-001',
      idempotencyKey: 'IDEMPOTENCY-CANDIDATE-R1-001',
      operation: 'record_candidate',
      expectedContextVersion: RECORD_CONTEXT_ID,
      payload: { caseId: CASE_ID, preparedCandidateRef: PREPARED_REF },
      ...overrides,
    },
  };
}

function readyHarness(options = {}) {
  const store = createInMemoryV4WorkStore(seed(options));
  const execute = createV4WorkCommandHandler(store);
  execute(acceptEvidenceInput());
  return { store, execute };
}

function assertHandlerError(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof V4WorkCommandHandlerError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test('controller R1: missing and non-human assignee identities fail closed with zero writes', () => {
  const variants = [
    [],
    [nonHuman('capability')],
    [nonHuman('system_service')],
    [nonHuman('authorized_rule')],
    [internalHuman(REVIEWER_ID, { extra: 'forbidden' })],
  ];
  for (const actors of variants) {
    const { store, execute } = readyHarness({ actors });
    const before = store.readCase(CASE_ID);
    assertHandlerError(() => execute(recordCandidateInput()), 'HUMAN_GATE_ASSIGNMENT_MISSING');
    assert.deepEqual(store.readCase(CASE_ID), before);
  }
});

test('controller R1: internal and Case-bound external humans are valid Gate assignees', () => {
  for (const reviewer of [internalHuman(), externalHuman(CASE_ID)]) {
    const { store, execute } = readyHarness({ actors: [reviewer] });
    const result = execute(recordCandidateInput());
    assert.equal(result instanceof Promise, false);
    assert.equal(result.receipt.requiredActorId, REVIEWER_ID);
    assert.equal(result.projection.workflowStatus, 'pending_human_review');
    assert.equal(result.projection.currentHumanGate.requiredActorId, REVIEWER_ID);
    assert.equal(store.readCase(CASE_ID).events.length, 4);
  }

  const wrongCase = readyHarness({ actors: [externalHuman('CASE-WRONG')] });
  const before = wrongCase.store.readCase(CASE_ID);
  assertHandlerError(
    () => wrongCase.execute(recordCandidateInput()),
    'HUMAN_GATE_ASSIGNMENT_MISSING',
  );
  assert.deepEqual(wrongCase.store.readCase(CASE_ID), before);
});

test('controller R1: canonical duplicate Actor, Session and Case keys fail construction closed', () => {
  assert.throws(() => createInMemoryV4WorkStore(seed({
    actors: [internalHuman(), internalHuman(` ${REVIEWER_ID} `)],
  })), /DUPLICATE_WORK_STORE_KEY/);

  assert.throws(() => createInMemoryV4WorkStore(seed({
    sessions: [session(), session({ sessionId: ` ${SESSION_ID} ` })],
  })), /DUPLICATE_WORK_STORE_KEY/);

  assert.throws(() => createInMemoryV4WorkStore(seed({
    cases: [
      { caseId: CASE_ID, events: [opened()] },
      { caseId: ` ${CASE_ID} `, events: [opened()] },
    ],
  })), /DUPLICATE_WORK_STORE_KEY/);
});

test('controller R1: blank Actor, Session and Case construction keys are invalid seeds', () => {
  assert.throws(() => createInMemoryV4WorkStore(seed({
    actors: [internalHuman('   ')],
  })), /INVALID_WORK_STORE_SEED/);
  assert.throws(() => createInMemoryV4WorkStore(seed({
    sessions: [session({ sessionId: '   ' })],
  })), /INVALID_WORK_STORE_SEED/);
  assert.throws(() => createInMemoryV4WorkStore(seed({
    cases: [{ caseId: '   ', events: [opened()] }],
  })), /INVALID_WORK_STORE_SEED/);
});

test('controller R1: transaction Actor Map and returned identities are defensively isolated', () => {
  const { store, execute } = readyHarness();
  const first = store.transact(SESSION_ID, CASE_ID, (transaction) => ({
    value: transaction.actors.get(REVIEWER_ID),
    commit: false,
  }));
  first.actorId = 'MUTATED-RETURN';
  first.organizationPath[0] = 'MUTATED-RETURN';

  store.transact(SESSION_ID, CASE_ID, (transaction) => {
    transaction.actors.clear();
    return { value: null, commit: false };
  });

  const second = store.transact(SESSION_ID, CASE_ID, (transaction) => ({
    value: transaction.actors.get(REVIEWER_ID),
    commit: false,
  }));
  assert.equal(second.actorId, REVIEWER_ID);
  assert.deepEqual(second.organizationPath, ORGANIZATION_PATH);

  const original = execute(recordCandidateInput());
  for (let index = 0; index < 7; index += 1) {
    const replay = execute(recordCandidateInput({ requestId: `REQUEST-REPLAY-R1-${index}` }));
    assert.deepEqual(replay, original);
  }
  const snapshot = store.readCase(CASE_ID);
  assert.equal(snapshot.events.length, 4);
  assert.equal(snapshot.candidateReceipts.length, 1);
  assert.equal(snapshot.idempotencyRecords.length, 2);
});
