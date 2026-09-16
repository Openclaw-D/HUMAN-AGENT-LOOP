import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4WorkCommandHandler } from '../lib/v4/work-command-handler.ts';
import { V4WorkCommandHandlerError } from '../lib/v4/work-command-types.ts';
import {
  createInMemoryV4WorkStore as createBaseInMemoryV4WorkStore,
} from '../lib/v4/work-store.ts';

function createInMemoryV4WorkStore(seed) {
  if (!seed.actors?.some((candidate) => candidate.actorId === REVIEWER_ACTOR_ID)) {
    seed.actors = [
      ...(seed.actors ?? []),
      actor({ actorId: REVIEWER_ACTOR_ID }),
    ];
  }
  return createBaseInMemoryV4WorkStore(seed);
}

const CASE_ID = 'CASE-HANDLER-001';
const ATTEMPT_ID = 'ATTEMPT-HANDLER-001';
const CONTEXT_ID = 'CONTEXT-HANDLER-001';
const SESSION_ID = 'SESSION-HANDLER-001';
const ACTOR_ID = 'ACTOR-HANDLER-001';
const POLICY_VERSION = 'POLICY-HANDLER-001';
const ORGANIZATION_PATH = ['group', 'division-a', 'credit-team'];
const RECORD_CONTEXT_ID = 'V4-CONTEXT-000002';
const PREPARED_CANDIDATE_REF = 'PREPARED-CANDIDATE-001';
const CANDIDATE_ID = 'CANDIDATE-HANDLER-001';
const CAPABILITY_ID = 'credit.material-gap-analyzer';
const CAPABILITY_VERSION = '1.0.0';
const REVIEWER_ACTOR_ID = 'ACTOR-CREDIT-REVIEWER-001';
const ASSIGNMENT_REF = 'ASSIGNMENT-CREDIT-REVIEW-001';

function opened(overrides = {}) {
  return {
    eventId: 'WORK-OPENED-001',
    sequence: 1,
    eventType: 'case_opened',
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    contextVersion: CONTEXT_ID,
    actorId: 'ACTOR-CASE-OPENER',
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

function actor(overrides = {}) {
  return {
    actorId: ACTOR_ID,
    kind: 'internal_human',
    organizationPath: [...ORGANIZATION_PATH],
    externalInvitation: null,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grantId: 'GRANT-PREPARE-EVIDENCE-001',
    actorId: ACTOR_ID,
    action: { family: 'prepare', name: 'prepare_evidence_draft' },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    policyVersion: POLICY_VERSION,
    invitationId: null,
    ...overrides,
  };
}

function candidateGrant(overrides = {}) {
  return {
    ...grant(),
    grantId: 'GRANT-PREPARE-CANDIDATE-001',
    action: { family: 'prepare', name: 'prepare_candidate_draft' },
    ...overrides,
  };
}

function deny(overrides = {}) {
  return {
    denyId: 'DENY-PREPARE-EVIDENCE-001',
    actorId: ACTOR_ID,
    action: { family: 'prepare', name: 'prepare_evidence_draft' },
    resourceType: 'case',
    resourceId: CASE_ID,
    organizationScope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    policyVersion: POLICY_VERSION,
    invitationId: null,
    ...overrides,
  };
}

function roleAssignment(overrides = {}) {
  return {
    assignmentId: 'ASSIGNMENT-BUSINESS-001',
    actorId: ACTOR_ID,
    role: 'business_worker',
    scope: { mode: 'exact', organizationPath: [...ORGANIZATION_PATH] },
    ...overrides,
  };
}

function session(overrides = {}) {
  const resolvedActor = overrides.actor ?? actor();
  const resolvedActorId = resolvedActor.actorId;
  return {
    sessionId: SESSION_ID,
    actor: resolvedActor,
    roleAssignments: [],
    grants: [grant({ actorId: resolvedActorId })],
    denies: [],
    presentedInvitationId: null,
    ...overrides,
    actor: resolvedActor,
  };
}

function command(overrides = {}) {
  return {
    requestId: 'REQUEST-001',
    idempotencyKey: 'IDEMPOTENCY-001',
    operation: 'accept_evidence',
    expectedContextVersion: CONTEXT_ID,
    payload: {
      caseId: CASE_ID,
      evidenceId: 'EVIDENCE-001',
      evidenceKind: 'business_license',
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

function recordCommand(overrides = {}) {
  return {
    requestId: 'REQUEST-CANDIDATE-001',
    idempotencyKey: 'IDEMPOTENCY-CANDIDATE-001',
    operation: 'record_candidate',
    expectedContextVersion: RECORD_CONTEXT_ID,
    payload: {
      caseId: CASE_ID,
      preparedCandidateRef: PREPARED_CANDIDATE_REF,
    },
    ...overrides,
  };
}

function recordInput(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    command: recordCommand(),
    ...overrides,
  };
}

function preparedCandidate(overrides = {}) {
  return {
    preparedCandidateRef: PREPARED_CANDIDATE_REF,
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
    ...overrides,
  };
}

function governanceHistory({
  state = 'active',
  capabilityId = CAPABILITY_ID,
  version = CAPABILITY_VERSION,
  scope = ORGANIZATION_PATH,
  capabilityVersionOverrides = {},
} = {}) {
  const envelope = (eventType, governanceVersion) => ({
    eventType,
    eventId: `GOVERNANCE-EVENT-${String(governanceVersion).padStart(3, '0')}`,
    capabilityId,
    version,
    governanceVersion,
    actorId: 'ACTOR-GOVERNANCE-001',
    organizationScopePath: [...scope],
  });
  const events = [{
    ...envelope('version_registered', 1),
    definition: {
      capabilityId,
      ownerActorId: 'ACTOR-CAPABILITY-OWNER-001',
      ownerOrganizationUnitId: 'credit-team',
      kind: 'Analyzer',
      authority: 'none',
    },
    capabilityVersion: {
      capabilityId,
      version,
      definitionHash: 'sha256:handler-candidate-definition',
      supportedStages: ['credit'],
      supportedBusinessModes: ['direct'],
      supportedReviewPaths: ['exception'],
      requiredEvidenceKinds: ['business_license'],
      allowedOutputKinds: ['CandidateDraft'],
      ...capabilityVersionOverrides,
    },
  }];
  if (state === 'draft') return events;
  events.push({ ...envelope('evaluation_passed', 2), evaluationId: 'EVALUATION-001' });
  events.push({ ...envelope('approval_granted', 3), approvalReceiptId: 'APPROVAL-001' });
  events.push({ ...envelope('shadow_released', 4), approvalReceiptId: 'APPROVAL-001' });
  events.push({ ...envelope('activated', 5), releaseReceiptId: 'RELEASE-001' });
  if (state === 'active') return events;
  if (state === 'suspended') {
    events.push({ ...envelope('suspended', 6), reason: 'quality threshold' });
    return events;
  }
  throw new Error(`unsupported governance state: ${state}`);
}

function creditReviewAssignment(overrides = {}) {
  return {
    caseId: CASE_ID,
    assignmentRef: ASSIGNMENT_REF,
    requiredActorId: REVIEWER_ACTOR_ID,
    ...overrides,
  };
}

function harness({
  currentPolicyVersion = POLICY_VERSION,
  sessions = [session()],
  cases = [{ caseId: CASE_ID, events: [opened()] }],
  preparedCandidates = [],
  capabilityGovernanceHistories = [],
  creditReviewAssignments = [],
} = {}) {
  const store = createInMemoryV4WorkStore({
    currentPolicyVersion,
    sessions,
    cases,
    preparedCandidates,
    capabilityGovernanceHistories,
    creditReviewAssignments,
  });
  return {
    store,
    executeV4WorkCommand: createV4WorkCommandHandler(store),
  };
}

function recordHarness({
  preparedCandidates = [preparedCandidate()],
  governanceEvents = governanceHistory(),
  governanceKeyCapabilityId = CAPABILITY_ID,
  governanceKeyVersion = CAPABILITY_VERSION,
  creditReviewAssignments = [creditReviewAssignment()],
  sessions = [session({ grants: [grant(), candidateGrant()] })],
} = {}) {
  const result = harness({
    sessions,
    preparedCandidates,
    capabilityGovernanceHistories: [{
      capabilityId: governanceKeyCapabilityId,
      capabilityVersion: governanceKeyVersion,
      events: governanceEvents,
    }],
    creditReviewAssignments,
  });
  result.acceptEvidenceResult = result.executeV4WorkCommand(input());
  return result;
}

function assertHandlerError(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof V4WorkCommandHandlerError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
}

test('golden accept_evidence atomically binds Event, Evidence Receipt, command Receipt and projection', () => {
  const { store, executeV4WorkCommand } = harness();
  const before = store.readCase(CASE_ID);
  const result = executeV4WorkCommand(input());
  const after = store.readCase(CASE_ID);

  assert.equal(result instanceof Promise, false);
  assert.deepEqual(Object.keys(result), ['receipt', 'projection']);
  assert.deepEqual(Object.keys(result.receipt), [
    'status',
    'requestId',
    'idempotencyKey',
    'operation',
    'caseId',
    'attemptId',
    'actorId',
    'policyVersion',
    'previousContextVersion',
    'newContextVersion',
    'eventId',
    'evidenceReceiptId',
  ]);
  assert.deepEqual(result.receipt, {
    status: 'committed',
    requestId: 'REQUEST-001',
    idempotencyKey: 'IDEMPOTENCY-001',
    operation: 'accept_evidence',
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    actorId: ACTOR_ID,
    policyVersion: POLICY_VERSION,
    previousContextVersion: CONTEXT_ID,
    newContextVersion: 'V4-CONTEXT-000002',
    eventId: 'V4-WORK-EVENT-000002',
    evidenceReceiptId: 'V4-EVIDENCE-RECEIPT-000002',
  });
  assert.equal(result.projection.state, 'valid');
  assert.equal(result.projection.eventCount, 2);
  assert.equal(result.projection.lastEventId, result.receipt.eventId);
  assert.equal(result.projection.contextVersion, result.receipt.newContextVersion);
  assert.deepEqual(result.projection.acceptedEvidence, [{
    evidenceId: 'EVIDENCE-001',
    evidenceKind: 'business_license',
    evidenceReceiptId: result.receipt.evidenceReceiptId,
  }]);

  assert.equal(before.events.length, 1);
  assert.equal(before.evidenceReceipts.length, 0);
  assert.equal(before.idempotencyRecords.length, 0);
  assert.equal(after.events.length, 2);
  assert.equal(after.evidenceReceipts.length, 1);
  assert.equal(after.idempotencyRecords.length, 1);
  const event = after.events[1];
  const evidenceReceipt = after.evidenceReceipts[0];
  assert.equal(event.eventId, result.receipt.eventId);
  assert.equal(event.evidenceReceiptId, result.receipt.evidenceReceiptId);
  assert.equal(event.previousContextVersion, result.receipt.previousContextVersion);
  assert.equal(event.newContextVersion, result.receipt.newContextVersion);
  assert.equal(evidenceReceipt.eventId, event.eventId);
  assert.equal(evidenceReceipt.evidenceReceiptId, event.evidenceReceiptId);
  assert.equal(evidenceReceipt.sequence, event.sequence);
  assert.deepEqual(after.projection, result.projection);
  assert.deepEqual(after.idempotencyRecords[0].result, result);
});

test('exact bounded input rejects semantic drift and caller-supplied authority or canonical fields', () => {
  const { store, executeV4WorkCommand } = harness();
  const baseline = store.readCase(CASE_ID);
  const invalidInputs = [
    null,
    {},
    { ...input(), extra: true },
    input({ sessionId: '   ' }),
    input({ sessionId: 'x'.repeat(129) }),
    input({ command: command({ requestId: 'x'.repeat(129) }) }),
    input({ command: command({ idempotencyKey: '   ' }) }),
    input({ command: command({ operation: ' accept_evidence ' }) }),
    input({ command: command({ expectedContextVersion: 1 }) }),
    input({ command: command({ payload: { ...command().payload, evidenceKind: 'x'.repeat(65) } }) }),
    input({ command: command({ payload: { ...command().payload, evidenceId: '   ' } }) }),
    input({ command: { ...command(), actorId: ACTOR_ID } }),
    input({ command: { ...command(), organizationPath: ORGANIZATION_PATH } }),
    input({ command: { ...command(), policyVersion: POLICY_VERSION } }),
    input({ command: { ...command(), grants: [] } }),
    input({ command: { ...command(), authorityResult: 'allowed' } }),
    input({ command: { ...command(), attemptId: ATTEMPT_ID } }),
    input({ command: { ...command(), eventId: 'FORGED' } }),
    input({ command: { ...command(), sequence: 2 } }),
    input({ command: { ...command(), newContextVersion: 'FORGED' } }),
    input({ command: { ...command(), receiptId: 'FORGED' } }),
    input({ command: { ...command(), evidenceReceipt: {} } }),
  ];

  let getterReads = 0;
  const accessor = input();
  Object.defineProperty(accessor.command, 'requestId', {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      throw new Error('secret getter must not execute');
    },
  });
  invalidInputs.push(accessor);

  const symbol = input();
  symbol.command[Symbol('hidden')] = true;
  invalidInputs.push(symbol);

  const nonEnumerable = input();
  Object.defineProperty(nonEnumerable.command.payload, 'hidden', {
    value: true,
    enumerable: false,
  });
  invalidInputs.push(nonEnumerable);

  const dangerous = input();
  Object.defineProperty(dangerous.command.payload, '__proto__', {
    value: {},
    enumerable: true,
  });
  invalidInputs.push(dangerous);

  for (const value of invalidInputs) {
    assertHandlerError(() => executeV4WorkCommand(value), 'INVALID_COMMAND');
  }
  assert.equal(getterReads, 0);
  assert.deepEqual(store.readCase(CASE_ID), baseline);
});

test('opaque identifiers trim canonically while semantic operation remains exact', () => {
  const { executeV4WorkCommand } = harness();
  const result = executeV4WorkCommand({
    sessionId: ` ${SESSION_ID} `,
    command: command({
      requestId: ' REQUEST-PADDED ',
      idempotencyKey: ' IDEMPOTENCY-PADDED ',
      expectedContextVersion: ` ${CONTEXT_ID} `,
      payload: {
        caseId: ` ${CASE_ID} `,
        evidenceId: ' EVIDENCE-PADDED ',
        evidenceKind: ' business_license ',
      },
    }),
  });
  assert.equal(result.receipt.requestId, 'REQUEST-PADDED');
  assert.equal(result.receipt.idempotencyKey, 'IDEMPOTENCY-PADDED');
  assert.equal(result.receipt.caseId, CASE_ID);
  assert.deepEqual(result.projection.acceptedEvidence, [{
    evidenceId: 'EVIDENCE-PADDED',
    evidenceKind: 'business_license',
    evidenceReceiptId: result.receipt.evidenceReceiptId,
  }]);
});

test('prototype-shaped session and idempotency keys use Map semantics safely', () => {
  const ordinary = harness();
  assertHandlerError(
    () => ordinary.executeV4WorkCommand(input({ sessionId: '__proto__' })),
    'SESSION_NOT_FOUND',
  );
  assert.equal(ordinary.store.readCase(CASE_ID).events.length, 1);

  const prototypeActor = actor({ actorId: 'ACTOR-PROTOTYPE' });
  const prototypeSession = session({
    sessionId: '__proto__',
    actor: prototypeActor,
    grants: [grant({ actorId: prototypeActor.actorId })],
  });
  const special = harness({ sessions: [prototypeSession] });
  const specialInput = input({
    sessionId: '__proto__',
    command: command({ idempotencyKey: '__proto__' }),
  });
  const first = special.executeV4WorkCommand(specialInput);
  const second = special.executeV4WorkCommand(specialInput);
  assert.deepEqual(second, first);
  assert.equal(first.receipt.actorId, prototypeActor.actorId);
  assert.equal(special.store.readCase(CASE_ID).events.length, 2);
  assert.equal(special.store.readCase(CASE_ID).idempotencyRecords.length, 1);
});

test('missing session has priority over Case and missing Case remains zero-write', () => {
  const missingSession = harness({ cases: [] });
  assertHandlerError(
    () => missingSession.executeV4WorkCommand(input({ sessionId: 'SESSION-MISSING' })),
    'SESSION_NOT_FOUND',
  );

  const missingCase = harness({ cases: [] });
  assertHandlerError(
    () => missingCase.executeV4WorkCommand(input()),
    'CASE_NOT_FOUND',
  );
  assert.equal(missingCase.store.readCase(CASE_ID), null);
});

test('corrupt stored history is never repaired and produces no Receipt or idempotency state', () => {
  const corruptEvent = {
    ...opened(),
    eventId: 'CORRUPT-EVENT-002',
    sequence: 3,
  };
  const { store, executeV4WorkCommand } = harness({
    cases: [{ caseId: CASE_ID, events: [opened(), corruptEvent] }],
  });
  const before = store.readCase(CASE_ID);
  assert.equal(before.projection.state, 'invalid');
  assertHandlerError(() => executeV4WorkCommand(input()), 'CORRUPT_HISTORY');
  assert.deepEqual(store.readCase(CASE_ID), before);

  const mismatched = harness({
    cases: [{
      caseId: CASE_ID,
      events: [opened({ caseId: 'CASE-STORED-UNDER-WRONG-KEY' })],
    }],
  });
  const mismatchedBefore = mismatched.store.readCase(CASE_ID);
  assert.equal(mismatchedBefore.projection.state, 'valid');
  assertHandlerError(
    () => mismatched.executeV4WorkCommand(input()),
    'CORRUPT_HISTORY',
  );
  assert.deepEqual(mismatched.store.readCase(CASE_ID), mismatchedBefore);
});

test('role-only, explicit deny, out-of-scope and stale-policy sessions fail Authority closed', () => {
  const cases = [
    session({ roleAssignments: [roleAssignment()], grants: [] }),
    session({ denies: [deny()] }),
    session({
      grants: [grant({
        organizationScope: { mode: 'exact', organizationPath: ['group', 'division-b'] },
      })],
    }),
  ];
  for (const deniedSession of cases) {
    const { store, executeV4WorkCommand } = harness({ sessions: [deniedSession] });
    const before = store.readCase(CASE_ID);
    assertHandlerError(() => executeV4WorkCommand(input()), 'AUTHORITY_DENIED');
    assert.deepEqual(store.readCase(CASE_ID), before);
  }

  const stalePolicySession = session({
    grants: [grant({ policyVersion: 'POLICY-STALE' })],
  });
  const stalePolicy = harness({ sessions: [stalePolicySession] });
  assertHandlerError(
    () => stalePolicy.executeV4WorkCommand(input()),
    'AUTHORITY_DENIED',
  );
  assert.equal(stalePolicy.store.readCase(CASE_ID).events.length, 1);
});

test('authorized_rule and system_service authority remain unknown even with a matching grant', () => {
  for (const kind of ['authorized_rule', 'system_service']) {
    const unknownActor = actor({ actorId: `ACTOR-${kind}`, kind });
    const unknownSession = session({
      actor: unknownActor,
      grants: [grant({ actorId: unknownActor.actorId })],
    });
    const { store, executeV4WorkCommand } = harness({ sessions: [unknownSession] });
    const before = store.readCase(CASE_ID);
    assertHandlerError(() => executeV4WorkCommand(input()), 'AUTHORITY_UNKNOWN');
    assert.deepEqual(store.readCase(CASE_ID), before);
  }
});

test('Authority denial has priority over stale command Context and allowed stale Context is distinct', () => {
  const denied = harness({ sessions: [session({ grants: [] })] });
  assertHandlerError(
    () => denied.executeV4WorkCommand(input({
      command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
    })),
    'AUTHORITY_DENIED',
  );

  const allowed = harness();
  const before = allowed.store.readCase(CASE_ID);
  assertHandlerError(
    () => allowed.executeV4WorkCommand(input({
      command: command({ expectedContextVersion: 'CONTEXT-STALE' }),
    })),
    'STALE_CONTEXT',
  );
  assert.deepEqual(allowed.store.readCase(CASE_ID), before);
});

test('same scoped key and hash replays the original result before stale Context or Authority', () => {
  const { store, executeV4WorkCommand } = harness();
  const first = executeV4WorkCommand(input());
  const afterFirst = store.readCase(CASE_ID);
  const retryInput = input({ command: command({ requestId: 'REQUEST-RETRY' }) });
  const second = executeV4WorkCommand(retryInput);

  assert.deepEqual(second, first);
  assert.equal(second.receipt.requestId, 'REQUEST-001');
  assert.notEqual(second, first);
  assert.notEqual(second.receipt, first.receipt);
  assert.notEqual(second.projection, first.projection);
  assert.deepEqual(store.readCase(CASE_ID), afterFirst);
});

test('same scoped key with a different canonical request hash conflicts before stale Context', () => {
  const { store, executeV4WorkCommand } = harness();
  executeV4WorkCommand(input());
  const afterFirst = store.readCase(CASE_ID);
  assertHandlerError(
    () => executeV4WorkCommand(input({
      command: command({
        requestId: 'REQUEST-CONFLICT',
        payload: { ...command().payload, evidenceKind: 'tax_record' },
      }),
    })),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.deepEqual(store.readCase(CASE_ID), afterFirst);
});

test('eight synchronous re-entrant calls produce one Event, one Receipt and one idempotency record', () => {
  const { store, executeV4WorkCommand } = harness();
  const results = [];
  for (let index = 0; index < 8; index += 1) {
    results.push(executeV4WorkCommand(input()));
  }
  for (const result of results.slice(1)) {
    assert.deepEqual(result, results[0]);
    assert.notEqual(result, results[0]);
  }
  const snapshot = store.readCase(CASE_ID);
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.evidenceReceipts.length, 1);
  assert.equal(snapshot.idempotencyRecords.length, 1);
  assert.equal(snapshot.projection.eventCount, 2);
});

test('injected pre-commit transaction failure leaves zero partial writes and does not reserve idempotency', () => {
  const { store, executeV4WorkCommand } = harness();
  const before = store.readCase(CASE_ID);
  store.__testOnlyFailNextTransaction();
  assertHandlerError(() => executeV4WorkCommand(input()), 'TRANSACTION_FAILED');
  assert.deepEqual(store.readCase(CASE_ID), before);

  const retry = executeV4WorkCommand(input());
  assert.equal(retry.receipt.status, 'committed');
  const after = store.readCase(CASE_ID);
  assert.equal(after.events.length, 2);
  assert.equal(after.evidenceReceipts.length, 1);
  assert.equal(after.idempotencyRecords.length, 1);
});

test('input, result, seed and store reads are defensively isolated', () => {
  const seed = {
    currentPolicyVersion: POLICY_VERSION,
    sessions: [session()],
    cases: [{ caseId: CASE_ID, events: [opened()] }],
  };
  const store = createInMemoryV4WorkStore(seed);
  const executeV4WorkCommand = createV4WorkCommandHandler(store);
  const request = input();
  const requestBefore = structuredClone(request);
  const first = executeV4WorkCommand(request);
  const canonical = structuredClone(first);
  assert.deepEqual(request, requestBefore);

  seed.sessions[0].actor.actorId = 'MUTATED-SEED';
  seed.cases[0].events[0].caseId = 'MUTATED-SEED';
  request.command.payload.evidenceId = 'MUTATED-INPUT';
  first.receipt.actorId = 'MUTATED-OUTPUT';
  first.projection.acceptedEvidence[0].evidenceId = 'MUTATED-OUTPUT';

  const read = store.readCase(CASE_ID);
  read.events[1].evidenceId = 'MUTATED-READ';
  read.evidenceReceipts[0].evidenceId = 'MUTATED-READ';
  read.projection.acceptedEvidence[0].evidenceId = 'MUTATED-READ';
  read.idempotencyRecords[0].result.receipt.actorId = 'MUTATED-READ';

  const replayed = executeV4WorkCommand(input());
  assert.deepEqual(replayed, canonical);
  const freshRead = store.readCase(CASE_ID);
  assert.equal(freshRead.events[1].evidenceId, 'EVIDENCE-001');
  assert.equal(freshRead.evidenceReceipts[0].evidenceId, 'EVIDENCE-001');
  assert.equal(freshRead.projection.acceptedEvidence[0].evidenceId, 'EVIDENCE-001');
  assert.equal(freshRead.idempotencyRecords[0].result.receipt.actorId, ACTOR_ID);
});

test('golden record_candidate atomically records verified Candidate and pending named Human Gate', () => {
  const { store, executeV4WorkCommand } = recordHarness();
  const before = store.readCase(CASE_ID);
  const result = executeV4WorkCommand(recordInput());
  const after = store.readCase(CASE_ID);

  assert.equal(result instanceof Promise, false);
  assert.deepEqual(Object.keys(result), ['receipt', 'projection']);
  assert.deepEqual(Object.keys(result.receipt), [
    'status',
    'requestId',
    'idempotencyKey',
    'operation',
    'caseId',
    'attemptId',
    'actorId',
    'policyVersion',
    'contextVersion',
    'preparedCandidateRef',
    'candidateId',
    'capabilityId',
    'capabilityVersion',
    'governanceVersion',
    'admissionDecisionId',
    'candidateReceiptId',
    'candidateEventId',
    'gateEventId',
    'gateId',
    'requiredActorId',
    'assignmentRef',
  ]);
  assert.deepEqual(result.receipt, {
    status: 'committed',
    requestId: 'REQUEST-CANDIDATE-001',
    idempotencyKey: 'IDEMPOTENCY-CANDIDATE-001',
    operation: 'record_candidate',
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    actorId: ACTOR_ID,
    policyVersion: POLICY_VERSION,
    contextVersion: RECORD_CONTEXT_ID,
    preparedCandidateRef: PREPARED_CANDIDATE_REF,
    candidateId: CANDIDATE_ID,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: CAPABILITY_VERSION,
    governanceVersion: 5,
    admissionDecisionId: 'V4-ADMISSION-DECISION-000003',
    candidateReceiptId: 'V4-CANDIDATE-RECEIPT-000003',
    candidateEventId: 'V4-WORK-EVENT-000003',
    gateEventId: 'V4-WORK-EVENT-000004',
    gateId: 'V4-HUMAN-GATE-000004',
    requiredActorId: REVIEWER_ACTOR_ID,
    assignmentRef: ASSIGNMENT_REF,
  });
  assert.equal(result.projection.contextVersion, RECORD_CONTEXT_ID);
  assert.equal(result.projection.workflowStatus, 'pending_human_review');
  assert.equal(result.projection.lifecycle.creditStatus, 'pending_human_review');
  assert.deepEqual(result.projection.candidateDraft, {
    candidateId: CANDIDATE_ID,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: CAPABILITY_VERSION,
    governanceVersion: 5,
    admissionDecisionId: result.receipt.admissionDecisionId,
    caseId: CASE_ID,
    attemptId: ATTEMPT_ID,
    contextVersion: RECORD_CONTEXT_ID,
    evidenceReceiptIds: ['V4-EVIDENCE-RECEIPT-000002'],
    outputKind: 'CandidateDraft',
    authority: 'none',
  });
  assert.deepEqual(result.projection.currentHumanGate, {
    gateId: result.receipt.gateId,
    requiredActorId: REVIEWER_ACTOR_ID,
    contextVersion: RECORD_CONTEXT_ID,
  });

  assert.equal(before.events.length, 2);
  assert.equal(before.candidateReceipts.length, 0);
  assert.equal(before.idempotencyRecords.length, 1);
  assert.equal(after.events.length, 4);
  assert.equal(after.candidateReceipts.length, 1);
  assert.equal(after.idempotencyRecords.length, 2);
  const [candidateEvent, gateEvent] = after.events.slice(2);
  assert.equal(candidateEvent.eventType, 'candidate_recorded');
  assert.equal(candidateEvent.authority, 'none');
  assert.equal(candidateEvent.outputKind, 'CandidateDraft');
  assert.equal(candidateEvent.admissionDecisionId, result.receipt.admissionDecisionId);
  assert.equal(gateEvent.eventType, 'pending_human_review');
  assert.equal(gateEvent.requiredActorId, REVIEWER_ACTOR_ID);
  assert.equal(after.candidateReceipts[0].candidateEventId, candidateEvent.eventId);
  assert.equal(after.candidateReceipts[0].gateEventId, gateEvent.eventId);
  assert.equal(after.candidateReceipts[0].gateId, gateEvent.gateId);
  assert.deepEqual(after.projection, result.projection);
});

test('record_candidate generated IDs avoid complete historical and server-store identity state', () => {
  const candidateReceiptBase = 'V4-CANDIDATE-RECEIPT-000003';
  const candidateEventBase = 'V4-WORK-EVENT-000003';
  const gateEventBase = 'V4-WORK-EVENT-000004';
  const admissionBase = 'V4-ADMISSION-DECISION-000003';
  const gateBase = 'V4-HUMAN-GATE-000004';
  const governanceEvents = governanceHistory();
  governanceEvents[1].evaluationId = admissionBase;
  governanceEvents[4].eventId = gateEventBase;
  const { executeV4WorkCommand } = recordHarness({
    preparedCandidates: [preparedCandidate({
      preparedCandidateRef: candidateReceiptBase,
      candidateId: candidateEventBase,
    })],
    governanceEvents,
    creditReviewAssignments: [creditReviewAssignment({ assignmentRef: gateBase })],
  });
  const result = executeV4WorkCommand(recordInput({
    command: recordCommand({
      payload: { caseId: CASE_ID, preparedCandidateRef: candidateReceiptBase },
    }),
  }));

  assert.notEqual(result.receipt.candidateEventId, candidateEventBase);
  assert.notEqual(result.receipt.gateEventId, gateEventBase);
  assert.notEqual(result.receipt.admissionDecisionId, admissionBase);
  assert.notEqual(result.receipt.candidateReceiptId, candidateReceiptBase);
  assert.notEqual(result.receipt.gateId, gateBase);
});

test('record_candidate exact input rejects caller authority, provenance and canonical identity injection', () => {
  const { store, executeV4WorkCommand } = recordHarness();
  const baseline = store.readCase(CASE_ID);
  const invalidInputs = [
    recordInput({ command: recordCommand({ operation: ' record_candidate ' }) }),
    recordInput({ command: recordCommand({ requestId: 'x'.repeat(129) }) }),
    recordInput({ command: recordCommand({ idempotencyKey: '   ' }) }),
    recordInput({ command: recordCommand({ expectedContextVersion: 2 }) }),
    recordInput({ command: recordCommand({ payload: {
      caseId: CASE_ID,
      preparedCandidateRef: 'x'.repeat(129),
    } }) }),
    recordInput({ command: recordCommand({ payload: {
      caseId: CASE_ID,
      preparedCandidateRef: '   ',
    } }) }),
    recordInput({ command: { ...recordCommand(), candidateId: CANDIDATE_ID } }),
    recordInput({ command: { ...recordCommand(), capabilityId: CAPABILITY_ID } }),
    recordInput({ command: { ...recordCommand(), admissionDecision: { outcome: 'eligible' } } }),
    recordInput({ command: { ...recordCommand(), actorId: ACTOR_ID } }),
    recordInput({ command: { ...recordCommand(), requiredActorId: REVIEWER_ACTOR_ID } }),
    recordInput({ command: { ...recordCommand(), gateId: 'FORGED-GATE' } }),
    recordInput({ command: { ...recordCommand(), eventId: 'FORGED-EVENT' } }),
    recordInput({ command: { ...recordCommand(), receiptId: 'FORGED-RECEIPT' } }),
    recordInput({ command: recordCommand({ payload: {
      ...recordCommand().payload,
      authority: 'none',
    } }) }),
  ];

  let getterReads = 0;
  const accessor = recordInput();
  Object.defineProperty(accessor.command.payload, 'preparedCandidateRef', {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      throw new Error('secret getter must not execute');
    },
  });
  invalidInputs.push(accessor);

  const symbol = recordInput();
  symbol.command.payload[Symbol('hidden')] = true;
  invalidInputs.push(symbol);

  for (const value of invalidInputs) {
    assertHandlerError(() => executeV4WorkCommand(value), 'INVALID_COMMAND');
  }
  assert.equal(getterReads, 0);
  assert.deepEqual(store.readCase(CASE_ID), baseline);
});

test('record_candidate rejects wrong binding, authority/output drift and unaccepted Evidence provenance', () => {
  const cases = [
    [preparedCandidate({ caseId: 'CASE-WRONG' }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ attemptId: 'ATTEMPT-WRONG' }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ contextVersion: 'CONTEXT-WRONG' }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ outputKind: 'EvidenceDraft' }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ authority: 'named_human' }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ evidenceReceiptIds: [] }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ evidenceReceiptIds: [
      'V4-EVIDENCE-RECEIPT-000002',
      'V4-EVIDENCE-RECEIPT-000002',
    ] }), 'CANDIDATE_PROVENANCE_INVALID'],
    [preparedCandidate({ evidenceReceiptIds: ['EVIDENCE-RECEIPT-NOT-ACCEPTED'] }), 'CANDIDATE_PROVENANCE_INVALID'],
  ];
  for (const [record, expectedCode] of cases) {
    const { store, executeV4WorkCommand } = recordHarness({ preparedCandidates: [record] });
    const before = store.readCase(CASE_ID);
    assertHandlerError(() => executeV4WorkCommand(recordInput()), expectedCode);
    assert.deepEqual(store.readCase(CASE_ID), before);
  }
});

test('record_candidate independently rebuilds Governance and maps Admission outcomes fail closed', () => {
  const variants = [
    {
      options: { governanceEvents: [] },
      candidate: preparedCandidate(),
      code: 'GOVERNANCE_INVALID',
    },
    {
      options: { governanceEvents: governanceHistory({ capabilityId: 'CAPABILITY-WRONG' }) },
      candidate: preparedCandidate(),
      code: 'GOVERNANCE_INVALID',
    },
    {
      options: {},
      candidate: preparedCandidate({ observedGovernanceVersion: 4 }),
      code: 'GOVERNANCE_STALE',
    },
    {
      options: { governanceEvents: governanceHistory({ state: 'draft' }) },
      candidate: preparedCandidate({ observedGovernanceVersion: 1 }),
      code: 'ADMISSION_DENIED',
    },
    {
      options: { governanceEvents: governanceHistory({ state: 'suspended' }) },
      candidate: preparedCandidate({ observedGovernanceVersion: 6 }),
      code: 'ADMISSION_DENIED',
    },
    {
      options: { governanceEvents: governanceHistory({ scope: ['group', 'division-b'] }) },
      candidate: preparedCandidate(),
      code: 'ADMISSION_DENIED',
    },
    {
      options: { governanceEvents: governanceHistory({
        capabilityVersionOverrides: { allowedOutputKinds: ['EvidenceDraft'] },
      }) },
      candidate: preparedCandidate(),
      code: 'ADMISSION_DENIED',
    },
    {
      options: { governanceEvents: governanceHistory({
        capabilityVersionOverrides: { supportedBusinessModes: ['existing_return'] },
      }) },
      candidate: preparedCandidate(),
      code: 'ADMISSION_INELIGIBLE',
    },
  ];

  for (const variant of variants) {
    const ready = recordHarness({
      ...variant.options,
      preparedCandidates: [variant.candidate],
    });
    const before = ready.store.readCase(CASE_ID);
    assertHandlerError(
      () => ready.executeV4WorkCommand(recordInput()),
      variant.code,
    );
    assert.deepEqual(ready.store.readCase(CASE_ID), before);
  }
});

test('record_candidate requires an exact named Human Gate assignment distinct from Candidate authority', () => {
  const variants = [
    [],
    [creditReviewAssignment({ assignmentRef: '   ' })],
    [creditReviewAssignment({ requiredActorId: CAPABILITY_ID })],
    [creditReviewAssignment({ requiredActorId: CANDIDATE_ID })],
    [creditReviewAssignment({ caseId: 'CASE-WRONG' })],
  ];
  for (const assignments of variants) {
    const { store, executeV4WorkCommand } = recordHarness({
      creditReviewAssignments: assignments,
    });
    const before = store.readCase(CASE_ID);
    assertHandlerError(
      () => executeV4WorkCommand(recordInput()),
      'HUMAN_GATE_ASSIGNMENT_MISSING',
    );
    assert.deepEqual(store.readCase(CASE_ID), before);
  }
});

test('record_candidate idempotency replays after state advance and conflicts across operation or ref', () => {
  const exact = recordHarness();
  const first = exact.executeV4WorkCommand(recordInput());
  for (let index = 0; index < 7; index += 1) {
    const replay = exact.executeV4WorkCommand(recordInput({
      command: recordCommand({ requestId: `REQUEST-REPLAY-${index}` }),
    }));
    assert.deepEqual(replay, first);
    assert.notEqual(replay, first);
  }
  const exactSnapshot = exact.store.readCase(CASE_ID);
  assert.equal(exactSnapshot.events.length, 4);
  assert.equal(exactSnapshot.candidateReceipts.length, 1);
  assert.equal(exactSnapshot.idempotencyRecords.length, 2);

  const crossOperation = recordHarness();
  const crossBefore = crossOperation.store.readCase(CASE_ID);
  assertHandlerError(
    () => crossOperation.executeV4WorkCommand(recordInput({
      command: recordCommand({ idempotencyKey: 'IDEMPOTENCY-001' }),
    })),
    'IDEMPOTENCY_CONFLICT',
  );
  assert.deepEqual(crossOperation.store.readCase(CASE_ID), crossBefore);

  const differentRef = recordHarness({
    preparedCandidates: [
      preparedCandidate(),
      preparedCandidate({
        preparedCandidateRef: 'PREPARED-CANDIDATE-002',
        candidateId: 'CANDIDATE-HANDLER-002',
      }),
    ],
  });
  differentRef.executeV4WorkCommand(recordInput());
  assertHandlerError(
    () => differentRef.executeV4WorkCommand(recordInput({
      command: recordCommand({
        requestId: 'REQUEST-DIFFERENT-REF',
        payload: {
          caseId: CASE_ID,
          preparedCandidateRef: 'PREPARED-CANDIDATE-002',
        },
      }),
    })),
    'IDEMPOTENCY_CONFLICT',
  );
});

test('record_candidate Authority and stale priority remain before server Candidate resolution', () => {
  const denied = recordHarness({ sessions: [session({ grants: [grant()] })] });
  assertHandlerError(
    () => denied.executeV4WorkCommand(recordInput({
      command: recordCommand({ expectedContextVersion: 'CONTEXT-STALE' }),
    })),
    'AUTHORITY_DENIED',
  );

  const stale = recordHarness();
  const before = stale.store.readCase(CASE_ID);
  assertHandlerError(
    () => stale.executeV4WorkCommand(recordInput({
      command: recordCommand({ expectedContextVersion: 'CONTEXT-STALE' }),
    })),
    'STALE_CONTEXT',
  );
  assert.deepEqual(stale.store.readCase(CASE_ID), before);
});

test('record_candidate transaction failure leaves both Events, Receipt, Gate and idempotency zero-write', () => {
  const { store, executeV4WorkCommand } = recordHarness();
  const before = store.readCase(CASE_ID);
  store.__testOnlyFailNextTransaction();
  assertHandlerError(() => executeV4WorkCommand(recordInput()), 'TRANSACTION_FAILED');
  assert.deepEqual(store.readCase(CASE_ID), before);

  const retry = executeV4WorkCommand(recordInput());
  assert.equal(retry.receipt.operation, 'record_candidate');
  const after = store.readCase(CASE_ID);
  assert.equal(after.events.length, 4);
  assert.equal(after.candidateReceipts.length, 1);
  assert.equal(after.idempotencyRecords.length, 2);
});

test('record_candidate construction, transaction, output and prototype-key state are isolated', () => {
  const specialRef = '__proto__';
  const candidates = [preparedCandidate({ preparedCandidateRef: specialRef })];
  const histories = [{
    capabilityId: CAPABILITY_ID,
    capabilityVersion: CAPABILITY_VERSION,
    events: governanceHistory(),
  }];
  const assignments = [creditReviewAssignment()];
  const ready = harness({
    sessions: [session({ grants: [grant(), candidateGrant()] })],
    preparedCandidates: candidates,
    capabilityGovernanceHistories: histories,
    creditReviewAssignments: assignments,
  });
  ready.executeV4WorkCommand(input());

  candidates[0].candidateId = 'MUTATED-SEED';
  histories[0].events[0].capabilityId = 'MUTATED-SEED';
  assignments[0].requiredActorId = 'MUTATED-SEED';
  const request = recordInput({
    command: recordCommand({
      idempotencyKey: 'constructor',
      payload: { caseId: CASE_ID, preparedCandidateRef: specialRef },
    }),
  });
  const requestBefore = structuredClone(request);
  const first = ready.executeV4WorkCommand(request);
  const canonical = structuredClone(first);
  assert.deepEqual(request, requestBefore);

  first.receipt.requiredActorId = 'MUTATED-OUTPUT';
  first.projection.currentHumanGate.requiredActorId = 'MUTATED-OUTPUT';
  const read = ready.store.readCase(CASE_ID);
  read.events[2].candidateId = 'MUTATED-READ';
  read.candidateReceipts[0].candidateId = 'MUTATED-READ';
  read.projection.candidateDraft.candidateId = 'MUTATED-READ';
  const replay = ready.executeV4WorkCommand(request);
  assert.deepEqual(replay, canonical);
  const fresh = ready.store.readCase(CASE_ID);
  assert.equal(fresh.events[2].candidateId, CANDIDATE_ID);
  assert.equal(fresh.candidateReceipts[0].candidateId, CANDIDATE_ID);
  assert.equal(fresh.projection.candidateDraft.candidateId, CANDIDATE_ID);
});

test('server construction rejects duplicate canonical Candidate, Governance and assignment keys', () => {
  assert.throws(() => createInMemoryV4WorkStore({
    currentPolicyVersion: POLICY_VERSION,
    sessions: [],
    cases: [],
    preparedCandidates: [
      preparedCandidate(),
      preparedCandidate({ preparedCandidateRef: ` ${PREPARED_CANDIDATE_REF} ` }),
    ],
  }), /DUPLICATE_WORK_STORE_KEY/);

  assert.throws(() => createInMemoryV4WorkStore({
    currentPolicyVersion: POLICY_VERSION,
    sessions: [],
    cases: [],
    capabilityGovernanceHistories: [
      { capabilityId: CAPABILITY_ID, capabilityVersion: CAPABILITY_VERSION, events: [] },
      { capabilityId: ` ${CAPABILITY_ID} `, capabilityVersion: CAPABILITY_VERSION, events: [] },
    ],
  }), /DUPLICATE_WORK_STORE_KEY/);

  assert.throws(() => createInMemoryV4WorkStore({
    currentPolicyVersion: POLICY_VERSION,
    sessions: [],
    cases: [],
    creditReviewAssignments: [
      creditReviewAssignment(),
      creditReviewAssignment({ caseId: ` ${CASE_ID} ` }),
    ],
  }), /DUPLICATE_WORK_STORE_KEY/);
});
