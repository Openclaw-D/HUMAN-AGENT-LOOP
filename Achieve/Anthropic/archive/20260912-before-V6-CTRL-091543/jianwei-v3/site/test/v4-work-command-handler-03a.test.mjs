import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4WorkCommandHandler } from '../lib/v4/work-command-handler.ts';
import { V4WorkCommandHandlerError } from '../lib/v4/work-command-types.ts';
import { createInMemoryV4WorkStore } from '../lib/v4/work-store.ts';

const CASE_ID = 'CASE-CREDIT-DECISION-001';
const ATTEMPT_ID = 'ATTEMPT-CREDIT-DECISION-001';
const OPEN_CONTEXT_ID = 'V4-CONTEXT-000001';
const CONTEXT_ID = 'V4-CONTEXT-000002';
const SESSION_ID = 'SESSION-CREDIT-DECIDER-001';
const ACTOR_ID = 'ACTOR-CREDIT-REVIEWER-001';
const OTHER_ACTOR_ID = 'ACTOR-CREDIT-REVIEWER-002';
const POLICY_VERSION = 'POLICY-CREDIT-001';
const ORGANIZATION_PATH = ['group', 'division', 'credit'];
const CANDIDATE_ID = 'CANDIDATE-CREDIT-001';
const EVIDENCE_RECEIPT_ID = 'V4-EVIDENCE-RECEIPT-000002';
const OPERATOR_ID = 'ACTOR-CREDIT-OPERATOR-001';
const OPERATOR_SESSION_ID = 'SESSION-CREDIT-OPERATOR-001';

function caseEvents() {
  return [
    {
      eventId: 'V4-WORK-EVENT-000001',
      sequence: 1,
      eventType: 'case_opened',
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: OPEN_CONTEXT_ID,
      actorId: 'ACTOR-CASE-OPENER',
      organizationPath: [...ORGANIZATION_PATH],
      rootAttemptId: ATTEMPT_ID,
      classification: {
        businessMode: 'direct',
        acquisitionSource: 'supplier_referral',
        reviewPath: 'exception',
        dueDiligenceMode: 'business_site',
      },
    },
    {
      eventId: 'V4-WORK-EVENT-000002',
      sequence: 2,
      eventType: 'evidence_accepted',
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_ID,
      actorId: 'ACTOR-CASE-OPENER',
      organizationPath: [...ORGANIZATION_PATH],
      previousContextVersion: OPEN_CONTEXT_ID,
      newContextVersion: CONTEXT_ID,
      evidenceId: 'EVIDENCE-001',
      evidenceKind: 'business_license',
      evidenceReceiptId: EVIDENCE_RECEIPT_ID,
    },
    {
      eventId: 'V4-WORK-EVENT-000003',
      sequence: 3,
      eventType: 'candidate_recorded',
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_ID,
      actorId: 'ACTOR-CASE-OPENER',
      organizationPath: [...ORGANIZATION_PATH],
      candidateId: CANDIDATE_ID,
      capabilityId: 'credit.material-gap-analyzer',
      capabilityVersion: '1.0.0',
      governanceVersion: 1,
      admissionDecisionId: 'V4-ADMISSION-DECISION-000001',
      evidenceReceiptIds: [EVIDENCE_RECEIPT_ID],
      outputKind: 'CandidateDraft',
      authority: 'none',
    },
    {
      eventId: 'V4-WORK-EVENT-000004',
      sequence: 4,
      eventType: 'pending_human_review',
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_ID,
      actorId: 'ACTOR-CASE-OPENER',
      organizationPath: [...ORGANIZATION_PATH],
      gateId: 'V4-HUMAN-GATE-000004',
      requiredActorId: ACTOR_ID,
    },
  ];
}

function actor(actorId = ACTOR_ID) {
  return {
    actorId,
    kind: 'internal_human',
    organizationPath: [...ORGANIZATION_PATH],
    externalInvitation: null,
  };
}

function roleAssignment(actorId = ACTOR_ID) {
  return {
    assignmentId: `ASSIGNMENT-${actorId}`,
    actorId,
    role: 'credit_professional',
    scope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
  };
}

function creditGrant(actorId = ACTOR_ID) {
  return {
    grantId: `GRANT-${actorId}`,
    actorId,
    action: { family: 'professional_decide', name: 'credit_decide' },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    policyVersion: POLICY_VERSION,
    invitationId: null,
  };
}

function prepareGrant(actorId, name) {
  return {
    grantId: `PREPARE-${name}-${actorId}`,
    actorId,
    action: { family: 'prepare', name },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    policyVersion: POLICY_VERSION,
    invitationId: null,
  };
}

function governanceHistory() {
  const base = (eventType, governanceVersion) => ({
    eventType, eventId: `GOV-03A-${governanceVersion}`, capabilityId: 'credit.material-gap-analyzer',
    version: '1.0.0', governanceVersion, actorId: 'ACTOR-GOV',
    organizationScopePath: [...ORGANIZATION_PATH],
  });
  return [
    {
      ...base('version_registered', 1),
      definition: { capabilityId: 'credit.material-gap-analyzer', ownerActorId: 'ACTOR-OWNER', ownerOrganizationUnitId: 'credit', kind: 'Analyzer', authority: 'none' },
      capabilityVersion: { capabilityId: 'credit.material-gap-analyzer', version: '1.0.0', definitionHash: 'sha256:03a', supportedStages: ['credit'], supportedBusinessModes: ['direct'], supportedReviewPaths: ['exception'], requiredEvidenceKinds: ['business_license'], allowedOutputKinds: ['CandidateDraft'] },
    },
    { ...base('evaluation_passed', 2), evaluationId: 'EVAL-03A' },
    { ...base('approval_granted', 3), approvalReceiptId: 'APPROVAL-03A' },
    { ...base('shadow_released', 4), approvalReceiptId: 'APPROVAL-03A' },
    { ...base('activated', 5), releaseReceiptId: 'RELEASE-03A' },
  ];
}

function session(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    actor: actor(),
    roleAssignments: [roleAssignment()],
    grants: [creditGrant()],
    denies: [],
    presentedInvitationId: null,
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    requestId: 'REQUEST-CREDIT-001',
    idempotencyKey: 'IDEMPOTENCY-CREDIT-001',
    operation: 'submit_credit_decision',
    expectedContextVersion: CONTEXT_ID,
    payload: {
      caseId: CASE_ID,
      action: 'approve_credit',
      rationale: ' Exception policy approved by the named credit professional. ',
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    command: command(),
    ...overrides,
  };
}

function createStore(seedOverrides = {}) {
  const { sessions: requestedReviewerSessions, ...otherSeedOverrides } = seedOverrides;
  const operator = actor(OPERATOR_ID);
  const reviewerSessions = requestedReviewerSessions ?? [session()];
  const store = createInMemoryV4WorkStore({
    currentPolicyVersion: POLICY_VERSION,
    actors: [operator, actor(), actor(OTHER_ACTOR_ID)],
    sessions: [{
      sessionId: OPERATOR_SESSION_ID,
      actor: operator,
      roleAssignments: [],
      grants: [
        prepareGrant(OPERATOR_ID, 'prepare_evidence_draft'),
        prepareGrant(OPERATOR_ID, 'prepare_candidate_draft'),
      ],
      denies: [],
      presentedInvitationId: null,
    }, ...reviewerSessions],
    cases: [{ caseId: CASE_ID, events: [caseEvents()[0]] }],
    preparedCandidates: [{
      preparedCandidateRef: 'PREPARED-CREDIT-001', candidateId: CANDIDATE_ID,
      capabilityId: 'credit.material-gap-analyzer', capabilityVersion: '1.0.0',
      observedGovernanceVersion: 5, caseId: CASE_ID, attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_ID, evidenceReceiptIds: ['V4-EVIDENCE-RECEIPT-000002'],
      outputKind: 'CandidateDraft', authority: 'none',
    }],
    capabilityGovernanceHistories: [{ capabilityId: 'credit.material-gap-analyzer', capabilityVersion: '1.0.0', events: governanceHistory() }],
    creditReviewAssignments: [{
      caseId: CASE_ID,
      assignmentRef: 'ASSIGNMENT-CREDIT-001',
      requiredActorId: ACTOR_ID,
    }],
    ...otherSeedOverrides,
  });
  const bootstrap = createV4WorkCommandHandler(store);
  bootstrap({ sessionId: OPERATOR_SESSION_ID, command: {
    requestId: 'BOOTSTRAP-EVIDENCE', idempotencyKey: 'BOOTSTRAP-EVIDENCE', operation: 'accept_evidence',
    expectedContextVersion: OPEN_CONTEXT_ID,
    payload: { caseId: CASE_ID, evidenceId: 'EVIDENCE-001', evidenceKind: 'business_license' },
  } });
  bootstrap({ sessionId: OPERATOR_SESSION_ID, command: {
    requestId: 'BOOTSTRAP-CANDIDATE', idempotencyKey: 'BOOTSTRAP-CANDIDATE', operation: 'record_candidate',
    expectedContextVersion: CONTEXT_ID,
    payload: { caseId: CASE_ID, preparedCandidateRef: 'PREPARED-CREDIT-001' },
  } });
  return store;
}

function assertError(execute, request, code) {
  assert.throws(() => execute(request), (error) => {
    assert.ok(error instanceof V4WorkCommandHandlerError);
    assert.equal(error.code, code);
    return true;
  });
}

function withTransactionMutation(store, mutateTransaction) {
  return {
    transact(sessionId, caseId, operation) {
      return store.transact(sessionId, caseId, (transaction) => {
        mutateTransaction(transaction);
        return operation(transaction);
      });
    },
    readCase: store.readCase.bind(store),
    __testOnlyFailNextTransaction: store.__testOnlyFailNextTransaction.bind(store),
  };
}

function assertZeroWrite(store, before) {
  assert.deepEqual(store.readCase(CASE_ID), before);
}

test('submit_credit_decision commits Event, canonical Receipt, Projection and idempotency atomically', () => {
  const store = createStore();
  const execute = createV4WorkCommandHandler(store);
  const request = input();
  const requestBefore = structuredClone(request);
  const result = execute(request);
  assert.deepEqual(request, requestBefore);

  assert.equal(result.receipt.status, 'committed');
  assert.equal(result.receipt.operation, 'submit_credit_decision');
  assert.equal(result.receipt.decisionReceiptId, 'V4-DECISION-RECEIPT-000005');
  assert.equal(result.receipt.rationale, result.receipt.rationale.trim());

  const snapshot = store.readCase(CASE_ID);
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.decisionReceipts.length, 1);
  assert.deepEqual(snapshot.projection, result.projection);
  assert.equal(snapshot.projection.workflowStatus, 'credit_approved');
  assert.equal(snapshot.projection.currentHumanGate, null);
  assert.equal(snapshot.projection.lifecycle.creditStatus, 'approved');
  assert.equal(snapshot.projection.lifecycle.commercialStatus, 'not_started');
  assert.equal(snapshot.projection.lifecycle.assetStatus, 'not_started');
  assert.equal(snapshot.projection.lifecycle.commencementStatus, 'not_started');
  assert.equal(snapshot.evidenceReceipts.length, 1);
  assert.equal(snapshot.candidateReceipts.length, 1);

  const event = snapshot.events.at(-1);
  assert.equal(event.eventType, 'credit_approved');
  assert.equal(event.gateId, 'V4-HUMAN-GATE-000004');
  assert.equal(event.candidateId, CANDIDATE_ID);
  assert.deepEqual(event.evidenceReceiptIds, [EVIDENCE_RECEIPT_ID]);
  assert.equal(event.rationale, result.receipt.rationale);

  const canonical = {
    decisionReceiptId: 'V4-DECISION-RECEIPT-000005',
    receiptType: 'credit_decision',
    status: 'committed',
    action: 'approve_credit',
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    actorId: ACTOR_ID,
    contextVersion: CONTEXT_ID,
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: 'V4-AUTHORITY-DECISION-000005',
    policyVersion: POLICY_VERSION,
    gateId: 'V4-HUMAN-GATE-000004',
    candidateId: CANDIDATE_ID,
    evidenceReceiptIds: [EVIDENCE_RECEIPT_ID],
    rationale: result.receipt.rationale,
    eventId: event.eventId,
    sequence: 5,
  };
  assert.deepEqual(snapshot.decisionReceipts[0], canonical);
  assert.notDeepEqual(result.receipt, canonical);

  const replay = execute(input());
  assert.deepEqual(replay, result);
  const afterReplay = store.readCase(CASE_ID);
  assert.equal(afterReplay.events.length, 5);
  assert.equal(afterReplay.decisionReceipts.length, 1);
  assert.equal(afterReplay.idempotencyRecords.length, 3);
});

test('submit_credit_decision rejects missing or duplicate canonical lineage and active assignment drift with zero writes', () => {
  const corruptions = [
    ['missing Evidence Receipt', (transaction) => { transaction.caseState.evidenceReceipts = []; }],
    ['duplicate Evidence Receipt', (transaction) => {
      transaction.caseState.evidenceReceipts.push(structuredClone(transaction.caseState.evidenceReceipts[0]));
    }],
    ['missing Candidate Receipt', (transaction) => { transaction.caseState.candidateReceipts = []; }],
    ['duplicate Candidate Receipt', (transaction) => {
      transaction.caseState.candidateReceipts.push(structuredClone(transaction.caseState.candidateReceipts[0]));
    }],
    ['missing active assignment', (transaction) => { transaction.creditReviewAssignments.delete(CASE_ID); }],
    ['drifted active assignment', (transaction) => {
      transaction.creditReviewAssignments.set(CASE_ID, {
        caseId: CASE_ID, assignmentRef: 'ASSIGNMENT-DRIFTED', requiredActorId: ACTOR_ID,
      });
    }],
  ];
  for (const [label, mutateTransaction] of corruptions) {
    const store = createStore();
    const before = store.readCase(CASE_ID);
    const execute = createV4WorkCommandHandler(withTransactionMutation(store, mutateTransaction));
    assertError(execute, input(), 'DECISION_LINEAGE_INVALID');
    assertZeroWrite(store, before);
    assert.ok(label);
  }
});

test('submit_credit_decision canonicalizes bounded rationale and rejects hostile exact payload shapes', () => {
  for (const rationale of ['x', 'x'.repeat(2000)]) {
    const result = createV4WorkCommandHandler(createStore())(input({
      command: command({ payload: { caseId: CASE_ID, action: 'approve_credit', rationale } }),
    }));
    assert.equal(result.receipt.rationale, rationale);
  }
  for (const rationale of ['   ', 'x'.repeat(2001)]) {
    const store = createStore();
    const before = store.readCase(CASE_ID);
    assertError(createV4WorkCommandHandler(store), input({
      command: command({ payload: { caseId: CASE_ID, action: 'approve_credit', rationale } }),
    }), 'INVALID_COMMAND');
    assertZeroWrite(store, before);
  }
  for (const defineHostileKey of [
    (payload) => { Object.defineProperty(payload, Symbol('unexpected'), { value: true }); },
    (payload) => { Object.defineProperty(payload, 'hidden', { value: true, enumerable: false }); },
    (payload) => { Object.defineProperty(payload, 'computed', { enumerable: true, get() { return true; } }); },
    (payload) => { Object.defineProperty(payload, '__proto__', { value: null, enumerable: true }); },
  ]) {
    const store = createStore();
    const before = store.readCase(CASE_ID);
    const payload = { caseId: CASE_ID, action: 'approve_credit', rationale: 'valid rationale' };
    defineHostileKey(payload);
    assertError(createV4WorkCommandHandler(store), input({ command: command({ payload }) }), 'INVALID_COMMAND');
    assertZeroWrite(store, before);
  }
});

test('submit_credit_decision enforces exact command shape and frozen authority priority', () => {
  const store = createStore();
  const execute = createV4WorkCommandHandler(store);
  assertError(execute, input({
    command: command({
      operation: ' submit_credit_decision',
      payload: { caseId: CASE_ID, action: 'approve_credit', rationale: 'valid' },
    }),
  }), 'INVALID_COMMAND');
  assertError(execute, input({
    command: command({
      payload: { caseId: CASE_ID, action: ' approve_credit', rationale: 'valid' },
    }),
  }), 'INVALID_COMMAND');

  const deniedStore = createStore({
    sessions: [session({ grants: [] })],
  });
  const denied = createV4WorkCommandHandler(deniedStore);
  assertError(denied, input({
    command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
  }), 'AUTHORITY_DENIED');

  const staleStore = createStore();
  const stale = createV4WorkCommandHandler(staleStore);
  assertError(stale, input({
    command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
  }), 'STALE_CONTEXT');
});

test('submit_credit_decision freezes authority, stale Context and pending Gate priority with zero writes', () => {
  const cases = [
    ['role only', createStore({ sessions: [session({ grants: [] })] }), 'AUTHORITY_DENIED'],
    ['capability actor', createStore({ sessions: [session({ actor: {
      actorId: ACTOR_ID, kind: 'capability', organizationPath: [...ORGANIZATION_PATH], externalInvitation: null,
    } })] }), 'AUTHORITY_DENIED'],
    ['system service actor', createStore({ sessions: [session({ actor: {
      actorId: ACTOR_ID, kind: 'system_service', organizationPath: [...ORGANIZATION_PATH], externalInvitation: null,
    } })] }), 'AUTHORITY_UNKNOWN'],
  ];
  for (const [, store, expected] of cases) {
    const before = store.readCase(CASE_ID);
    assertError(createV4WorkCommandHandler(store), input({
      command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
    }), expected);
    assertZeroWrite(store, before);
  }

  const staleStore = createStore();
  const staleBefore = staleStore.readCase(CASE_ID);
  assertError(createV4WorkCommandHandler(staleStore), input({
    command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
  }), 'STALE_CONTEXT');
  assertZeroWrite(staleStore, staleBefore);

  const noGateStore = createStore();
  const noGateBefore = noGateStore.readCase(CASE_ID);
  assertError(createV4WorkCommandHandler(withTransactionMutation(noGateStore, (transaction) => {
    transaction.caseState.events.pop();
  })), input(), 'HUMAN_GATE_NOT_PENDING');
  assertZeroWrite(noGateStore, noGateBefore);
});

test('submit_credit_decision fails closed for actor mismatch and transaction failure', () => {
  const mismatchStore = createStore({
    sessions: [{
      ...session(),
      actor: actor(OTHER_ACTOR_ID),
      roleAssignments: [roleAssignment(OTHER_ACTOR_ID)],
      grants: [creditGrant(OTHER_ACTOR_ID)],
    }],
  });
  const mismatch = createV4WorkCommandHandler(mismatchStore);
  assertError(mismatch, input(), 'HUMAN_GATE_ACTOR_MISMATCH');

  const store = createStore();
  const execute = createV4WorkCommandHandler(store);
  store.__testOnlyFailNextTransaction();
  const before = store.readCase(CASE_ID);
  assertError(execute, input(), 'TRANSACTION_FAILED');
  assert.deepEqual(store.readCase(CASE_ID), before);
});

test('submit_credit_decision rejects same idempotency key with different canonical payload', () => {
  const store = createStore();
  const execute = createV4WorkCommandHandler(store);
  const first = execute(input());
  assertError(execute, input({
    command: command({
      payload: {
        caseId: CASE_ID,
        action: 'approve_credit',
        rationale: 'Different rationale',
      },
    }),
  }), 'IDEMPOTENCY_CONFLICT');
  const snapshot = store.readCase(CASE_ID);
  assert.equal(snapshot.decisionReceipts.length, 1);
  assert.equal(snapshot.decisionReceipts[0].eventId, first.receipt.eventId);
});

test('submit_credit_decision generated identities avoid store collisions and all public results are defensive synchronous clones', () => {
  const collisionStore = createStore();
  const collisionExecute = createV4WorkCommandHandler(withTransactionMutation(collisionStore, (transaction) => {
    transaction.caseState.decisionReceipts.push({ reserved: [
      'V4-WORK-EVENT-000005',
      'V4-AUTHORITY-DECISION-000006',
      'V4-DECISION-RECEIPT-000007',
    ] });
  }));
  const collisionResult = collisionExecute(input());
  assert.equal(collisionResult instanceof Promise, false);
  assert.notEqual(collisionResult.receipt.eventId, 'V4-WORK-EVENT-000005');
  assert.notEqual(collisionResult.receipt.authorityDecisionId, 'V4-AUTHORITY-DECISION-000006');
  assert.notEqual(collisionResult.receipt.decisionReceiptId, 'V4-DECISION-RECEIPT-000007');

  const store = createStore();
  const execute = createV4WorkCommandHandler(store);
  assert.equal(execute instanceof Function, true);
  const result = execute(input());
  assert.equal(result instanceof Promise, false);
  result.receipt.evidenceReceiptIds.push('MUTATED');
  result.projection.acceptedEvidence[0].evidenceReceiptId = 'MUTATED';
  const snapshot = store.readCase(CASE_ID);
  assert.deepEqual(snapshot.decisionReceipts[0].evidenceReceiptIds, [EVIDENCE_RECEIPT_ID]);
  assert.equal(snapshot.projection.acceptedEvidence[0].evidenceReceiptId, EVIDENCE_RECEIPT_ID);
  const replay = execute(input());
  replay.receipt.evidenceReceiptIds.push('MUTATED-REPLAY');
  assert.deepEqual(store.readCase(CASE_ID).decisionReceipts[0].evidenceReceiptIds, [EVIDENCE_RECEIPT_ID]);
});
