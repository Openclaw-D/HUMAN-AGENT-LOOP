import assert from 'node:assert/strict';
import test from 'node:test';

import { replayWorkAggregate } from '../lib/v4/work-aggregate.ts';

const CASE_ID = 'CASE-V4-WORK-001';
const ATTEMPT_1 = 'ATTEMPT-001';
const ATTEMPT_2 = 'ATTEMPT-002';
const CONTEXT_1 = 'CONTEXT-001';
const CONTEXT_2 = 'CONTEXT-002';
const CONTEXT_3 = 'CONTEXT-003';
const CONTEXT_4 = 'CONTEXT-004';
const HUMAN_ID = 'ACTOR-CREDIT-001';
const OWNER_ID = 'ACTOR-BUSINESS-001';
const ORGANIZATION_PATH = ['group', 'division-a', 'credit-team'];
const EVIDENCE_RECEIPT_1 = 'EVIDENCE-RECEIPT-001';
const EVIDENCE_RECEIPT_2 = 'EVIDENCE-RECEIPT-002';
const DECISION_RECEIPT_1 = 'DECISION-RECEIPT-001';

function classification(overrides = {}) {
  return {
    businessMode: 'direct',
    acquisitionSource: 'supplier_referral',
    reviewPath: 'exception',
    dueDiligenceMode: 'business_site',
    ...overrides,
  };
}

function envelope(eventType, sequence, contextVersion, overrides = {}) {
  return {
    eventId: `WORK-EVENT-${String(sequence).padStart(3, '0')}`,
    sequence,
    eventType,
    caseId: CASE_ID,
    attemptId: ATTEMPT_1,
    contextVersion,
    actorId: 'ACTOR-SYSTEM-RECORDER',
    organizationPath: [...ORGANIZATION_PATH],
    ...overrides,
  };
}

function opened(overrides = {}) {
  return {
    ...envelope('case_opened', 1, CONTEXT_1),
    rootAttemptId: ATTEMPT_1,
    classification: classification(),
    ...overrides,
  };
}

function evidence(sequence, previousContextVersion, newContextVersion, overrides = {}) {
  return {
    ...envelope('evidence_accepted', sequence, newContextVersion),
    previousContextVersion,
    newContextVersion,
    evidenceId: sequence === 2 ? 'EVIDENCE-001' : `EVIDENCE-${sequence}`,
    evidenceKind: sequence === 2 ? 'business_license' : 'supplemental_material',
    evidenceReceiptId: sequence === 2 ? EVIDENCE_RECEIPT_1 : EVIDENCE_RECEIPT_2,
    ...overrides,
  };
}

function candidate(sequence, contextVersion, evidenceReceiptIds = [EVIDENCE_RECEIPT_1], overrides = {}) {
  return {
    ...envelope('candidate_recorded', sequence, contextVersion, {
      actorId: 'CAPABILITY-CREDIT-ANALYZER',
    }),
    candidateId: `CANDIDATE-${sequence}`,
    capabilityId: 'credit.material-gap-analyzer',
    capabilityVersion: '1.0.0',
    governanceVersion: 5,
    admissionDecisionId: `ADMISSION-${sequence}`,
    evidenceReceiptIds,
    outputKind: 'CandidateDraft',
    authority: 'none',
    ...overrides,
  };
}

function pending(sequence, contextVersion, overrides = {}) {
  return {
    ...envelope('pending_human_review', sequence, contextVersion),
    gateId: `GATE-${sequence}`,
    requiredActorId: HUMAN_ID,
    ...overrides,
  };
}

function formal(eventType, sequence, contextVersion, overrides = {}) {
  const base = {
    ...envelope(eventType, sequence, contextVersion, { actorId: HUMAN_ID }),
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: `AUTHORITY-DECISION-${sequence}`,
    policyVersion: 'POLICY-V4-001',
    decisionReceiptId: `DECISION-RECEIPT-${sequence}`,
  };
  if (eventType === 'supplement_requested') {
    return {
      ...base,
      requiredItems: ['bank_statement', 'tax_record'],
      ownerActorId: OWNER_ID,
      dueAt: '2030-01-02T03:04:05.000Z',
      ...overrides,
    };
  }
  if (eventType === 'credit_approved') {
    return {
      ...base,
      gateId: 'GATE-4',
      candidateId: 'CANDIDATE-3',
      evidenceReceiptIds: [EVIDENCE_RECEIPT_1],
      rationale: 'Credit evidence reviewed by the named professional.',
      ...overrides,
    };
  }
  return { ...base, ...overrides };
}

function resubmitted(sequence, previousContextVersion, newContextVersion, overrides = {}) {
  return {
    ...envelope('supplement_resubmitted', sequence, newContextVersion, { actorId: OWNER_ID }),
    previousContextVersion,
    newContextVersion,
    supplementalEvidenceReceiptIds: [EVIDENCE_RECEIPT_2],
    ...overrides,
  };
}

function newAttempt(sequence, overrides = {}) {
  return {
    ...envelope('new_attempt_started', sequence, CONTEXT_3, {
      attemptId: ATTEMPT_2,
      actorId: OWNER_ID,
    }),
    rootAttemptId: ATTEMPT_1,
    previousAttemptId: ATTEMPT_1,
    newAttemptId: ATTEMPT_2,
    newContextVersion: CONTEXT_3,
    inheritedEvidenceReceiptIds: [EVIDENCE_RECEIPT_1],
    ...overrides,
  };
}

function handoff(sequence, contextVersion, overrides = {}) {
  return {
    ...envelope('credit_handoff_recorded', sequence, contextVersion, { actorId: HUMAN_ID }),
    handoffId: 'HANDOFF-001',
    sourceDecisionReceiptId: DECISION_RECEIPT_1,
    destinationStage: 'commercial',
    destinationAssignmentRef: 'ASSIGNMENT-COMMERCIAL-001',
    ...overrides,
  };
}

function throughGate() {
  return [
    opened(),
    evidence(2, CONTEXT_1, CONTEXT_2),
    candidate(3, CONTEXT_2),
    pending(4, CONTEXT_2),
  ];
}

function approvedHistory() {
  return [
    ...throughGate(),
    formal('credit_approved', 5, CONTEXT_2, { decisionReceiptId: DECISION_RECEIPT_1 }),
  ];
}

function goldenHistory() {
  return [...approvedHistory(), handoff(6, CONTEXT_2)];
}

function assertInvalid(events, reason, index = undefined) {
  const projection = replayWorkAggregate(events);
  assert.equal(projection.state, 'invalid');
  assert.equal(projection.invalidReason, reason);
  if (index !== undefined) assert.equal(projection.invalidEventIndex, index);
  assert.equal(projection.caseId, null);
  assert.equal(projection.attemptId, null);
  assert.equal(projection.classification, null);
  assert.equal(projection.lifecycle, null);
  assert.deepEqual(projection.organizationPath, []);
  assert.deepEqual(projection.acceptedEvidence, []);
  assert.equal(projection.candidateDraft, null);
  assert.equal(projection.namedHumanDecision, null);
  assert.equal(projection.decisionReceiptId, null);
  assert.equal(projection.handoff, null);
  assert.equal(projection.eventCount, 0);
  assert.equal(projection.lastEventId, null);
  return projection;
}

test('golden path rebuilds exact credit decision and handoff without completing downstream stages', () => {
  const result = replayWorkAggregate(goldenHistory());

  assert.equal(result instanceof Promise, false);
  assert.equal(result.state, 'valid');
  assert.equal(result.invalidReason, null);
  assert.equal(result.caseId, CASE_ID);
  assert.equal(result.attemptId, ATTEMPT_1);
  assert.equal(result.rootAttemptId, ATTEMPT_1);
  assert.equal(result.previousAttemptId, null);
  assert.equal(result.contextVersion, CONTEXT_2);
  assert.deepEqual(result.organizationPath, ORGANIZATION_PATH);
  assert.deepEqual(result.classification, classification());
  assert.equal(result.currentStage, 'commercial');
  assert.equal(result.attemptStatus, 'active');
  assert.equal(result.workflowStatus, 'credit_handed_off');
  assert.deepEqual(result.lifecycle, {
    creditStatus: 'approved',
    commercialStatus: 'pending',
    assetStatus: 'not_started',
    commencementStatus: 'not_started',
  });
  assert.deepEqual(result.acceptedEvidence, [{
    evidenceId: 'EVIDENCE-001',
    evidenceKind: 'business_license',
    evidenceReceiptId: EVIDENCE_RECEIPT_1,
  }]);
  assert.equal(result.candidateDraft.authority, 'none');
  assert.equal(result.candidateDraft.contextVersion, CONTEXT_2);
  assert.deepEqual(result.candidateDraft.evidenceReceiptIds, [EVIDENCE_RECEIPT_1]);
  assert.deepEqual(result.namedHumanDecision, {
    action: 'approve_credit',
    actorId: HUMAN_ID,
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: 'AUTHORITY-DECISION-5',
    policyVersion: 'POLICY-V4-001',
    caseId: CASE_ID,
    attemptId: ATTEMPT_1,
    contextVersion: CONTEXT_2,
  });
  assert.equal(result.decisionReceiptId, DECISION_RECEIPT_1);
  assert.deepEqual(result.handoff, {
    handoffId: 'HANDOFF-001',
    sourceDecisionReceiptId: DECISION_RECEIPT_1,
    destinationStage: 'commercial',
    destinationAssignmentRef: 'ASSIGNMENT-COMMERCIAL-001',
  });
  assert.equal(result.eventCount, 6);
  assert.equal(result.lastEventId, 'WORK-EVENT-006');
});

test('supplement keeps the Attempt, resubmits to a new Context and requires a new candidate and Gate', () => {
  const requested = [
    ...throughGate(),
    formal('supplement_requested', 5, CONTEXT_2),
  ];
  const requestProjection = replayWorkAggregate(requested);
  assert.equal(requestProjection.attemptId, ATTEMPT_1);
  assert.equal(requestProjection.contextVersion, CONTEXT_2);
  assert.equal(requestProjection.workflowStatus, 'supplement_requested');
  assert.equal(requestProjection.candidateDraft, null);
  assert.equal(requestProjection.currentHumanGate, null);
  assert.deepEqual(requestProjection.supplementRequest.requiredItems, ['bank_statement', 'tax_record']);

  const withSupplementEvidence = [
    ...requested,
    evidence(6, CONTEXT_2, CONTEXT_3),
  ];
  const replayed = [
    ...withSupplementEvidence,
    resubmitted(7, CONTEXT_3, CONTEXT_4),
  ];
  const resubmittedProjection = replayWorkAggregate(replayed);
  assert.equal(resubmittedProjection.state, 'valid');
  assert.equal(resubmittedProjection.attemptId, ATTEMPT_1);
  assert.equal(resubmittedProjection.contextVersion, CONTEXT_4);
  assert.equal(resubmittedProjection.workflowStatus, 'active');
  assert.equal(resubmittedProjection.supplementRequest, null);
  assert.equal(resubmittedProjection.candidateDraft, null);
  assert.equal(resubmittedProjection.currentHumanGate, null);

  const refreshed = [
    ...replayed,
    candidate(8, CONTEXT_4, [EVIDENCE_RECEIPT_1, EVIDENCE_RECEIPT_2]),
    pending(9, CONTEXT_4),
  ];
  const refreshedProjection = replayWorkAggregate(refreshed);
  assert.equal(refreshedProjection.workflowStatus, 'pending_human_review');
  assert.equal(refreshedProjection.candidateDraft.contextVersion, CONTEXT_4);
  assert.equal(refreshedProjection.currentHumanGate.contextVersion, CONTEXT_4);
});

test('supplement resubmission accepts only Evidence Receipts appended after the supplement request', () => {
  const requested = [
    ...throughGate(),
    formal('supplement_requested', 5, CONTEXT_2),
  ];
  assertInvalid(
    [...requested, resubmitted(6, CONTEXT_2, CONTEXT_3, {
      supplementalEvidenceReceiptIds: [EVIDENCE_RECEIPT_1],
    })],
    'PROVENANCE_MISMATCH',
    5,
  );
});

test('reject then new Attempt preserves root and selected Evidence lineage while clearing old formal state', () => {
  const rejected = [
    ...throughGate(),
    formal('attempt_rejected', 5, CONTEXT_2),
  ];
  const rejectedProjection = replayWorkAggregate(rejected);
  assert.equal(rejectedProjection.attemptStatus, 'rejected');
  assert.equal(rejectedProjection.workflowStatus, 'attempt_rejected');
  assert.equal(rejectedProjection.handoff, null);

  const restarted = replayWorkAggregate([...rejected, newAttempt(6)]);
  assert.equal(restarted.state, 'valid');
  assert.equal(restarted.caseId, CASE_ID);
  assert.equal(restarted.rootAttemptId, ATTEMPT_1);
  assert.equal(restarted.previousAttemptId, ATTEMPT_1);
  assert.equal(restarted.attemptId, ATTEMPT_2);
  assert.equal(restarted.contextVersion, CONTEXT_3);
  assert.equal(restarted.attemptStatus, 'active');
  assert.equal(restarted.workflowStatus, 'active');
  assert.deepEqual(restarted.inheritedEvidenceReceiptIds, [EVIDENCE_RECEIPT_1]);
  assert.deepEqual(restarted.acceptedEvidence.map((entry) => entry.evidenceReceiptId), [
    EVIDENCE_RECEIPT_1,
  ]);
  assert.equal(restarted.candidateDraft, null);
  assert.equal(restarted.currentHumanGate, null);
  assert.equal(restarted.namedHumanDecision, null);
  assert.equal(restarted.decisionReceiptId, null);
});

test('final veto is terminal and blocks both new Attempt and handoff', () => {
  const vetoed = [
    ...throughGate(),
    formal('final_vetoed', 5, CONTEXT_2),
  ];
  const result = replayWorkAggregate(vetoed);
  assert.equal(result.attemptStatus, 'final_vetoed');
  assert.equal(result.workflowStatus, 'final_vetoed');
  assert.equal(result.lifecycle.creditStatus, 'vetoed_final');
  assert.equal(result.handoff, null);

  assertInvalid([...vetoed, newAttempt(6)], 'ILLEGAL_TRANSITION', 5);
  assertInvalid([...vetoed, handoff(6, CONTEXT_2)], 'ILLEGAL_TRANSITION', 5);
});

test('Candidate provenance is exact, authority remains none and stale input fails closed', () => {
  const base = [opened(), evidence(2, CONTEXT_1, CONTEXT_2)];
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, ['EVIDENCE-RECEIPT-UNKNOWN'])],
    'PROVENANCE_MISMATCH',
    2,
  );
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, [EVIDENCE_RECEIPT_1], { authority: 'candidate_model' })],
    'MALFORMED_EVENT',
    2,
  );
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, [EVIDENCE_RECEIPT_1], { outputKind: 'ActionIntent' })],
    'MALFORMED_EVENT',
    2,
  );
  assertInvalid(
    [...base, candidate(3, CONTEXT_1)],
    'IDENTITY_LINEAGE_MISMATCH',
    2,
  );
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, [EVIDENCE_RECEIPT_1], { admissionDecisionId: '   ' })],
    'MALFORMED_EVENT',
    2,
  );
});

test('named Human Gate never routes a capability as required actor', () => {
  const base = [opened(), evidence(2, CONTEXT_1, CONTEXT_2)];
  const currentCandidate = candidate(3, CONTEXT_2);
  assertInvalid(
    [...base, currentCandidate, pending(4, CONTEXT_2, {
      requiredActorId: currentCandidate.capabilityId,
    })],
    'HUMAN_AUTHORITY_VIOLATION',
    3,
  );
  assertInvalid(
    [...base, currentCandidate, pending(4, CONTEXT_2, {
      requiredActorId: currentCandidate.candidateId,
    })],
    'HUMAN_AUTHORITY_VIOLATION',
    3,
  );
});

test('every formal disposition enforces named_human, allowed outcome and exact Gate actor', () => {
  for (const eventType of [
    'supplement_requested',
    'credit_approved',
    'attempt_rejected',
    'final_vetoed',
  ]) {
    assertInvalid(
      [...throughGate(), formal(eventType, 5, CONTEXT_2, { authoritySource: 'candidate_model' })],
      'MALFORMED_EVENT',
      4,
    );
    assertInvalid(
      [...throughGate(), formal(eventType, 5, CONTEXT_2, { authoritySource: 'authorized_rule' })],
      'MALFORMED_EVENT',
      4,
    );
    assertInvalid(
      [...throughGate(), formal(eventType, 5, CONTEXT_2, {
        authorityDecisionOutcome: 'denied',
      })],
      'MALFORMED_EVENT',
      4,
    );
    assertInvalid(
      [...throughGate(), formal(eventType, 5, CONTEXT_2, { actorId: 'ACTOR-OTHER' })],
      'HUMAN_AUTHORITY_VIOLATION',
      4,
    );
  }
});

test('unsupported transitions fail before provenance, authority or receipt interpretation', () => {
  const active = [opened()];
  const unsupported = [
    candidate(2, CONTEXT_1, ['UNKNOWN']),
    pending(2, CONTEXT_1),
    formal('supplement_requested', 2, CONTEXT_1),
    formal('credit_approved', 2, CONTEXT_1),
    formal('attempt_rejected', 2, CONTEXT_1),
    resubmitted(2, CONTEXT_1, CONTEXT_2),
    newAttempt(2, { previousAttemptId: ATTEMPT_1 }),
    formal('final_vetoed', 2, CONTEXT_1),
    handoff(2, CONTEXT_1),
  ];
  for (const event of unsupported) {
    assertInvalid([...active, event], 'ILLEGAL_TRANSITION', 1);
  }
  assertInvalid([...active, opened({ sequence: 2, eventId: 'WORK-EVENT-002' })], 'ILLEGAL_TRANSITION', 1);

  const approved = approvedHistory();
  assertInvalid(
    [...approved, evidence(6, CONTEXT_2, CONTEXT_3)],
    'ILLEGAL_TRANSITION',
    5,
  );
});

test('duplicate Evidence identity and canonical receipt reuse fail with zero partial state', () => {
  const first = [opened(), evidence(2, CONTEXT_1, CONTEXT_2)];
  assertInvalid(
    [...first, evidence(3, CONTEXT_2, CONTEXT_3, {
      evidenceId: ' EVIDENCE-001 ',
      evidenceReceiptId: EVIDENCE_RECEIPT_2,
    })],
    'PROVENANCE_MISMATCH',
    2,
  );
  assertInvalid(
    [...first, evidence(3, CONTEXT_2, CONTEXT_3, {
      evidenceId: 'EVIDENCE-OTHER',
      evidenceReceiptId: ` ${EVIDENCE_RECEIPT_1} `,
    })],
    'PROVENANCE_MISMATCH',
    2,
  );
  assertInvalid(
    [...throughGate(), formal('credit_approved', 5, CONTEXT_2, {
      decisionReceiptId: EVIDENCE_RECEIPT_1,
    })],
    'RECEIPT_HANDOFF_LINEAGE_MISMATCH',
    4,
  );
});

test('receipt and handoff lineage must match the accepted Human Decision exactly', () => {
  assertInvalid(
    [...approvedHistory(), handoff(6, CONTEXT_2, {
      sourceDecisionReceiptId: 'DECISION-RECEIPT-WRONG',
    })],
    'RECEIPT_HANDOFF_LINEAGE_MISMATCH',
    5,
  );
  assertInvalid(
    [...approvedHistory(), handoff(6, CONTEXT_2, { destinationStage: 'asset' })],
    'MALFORMED_EVENT',
    5,
  );

  const supplement = [
    ...throughGate(),
    formal('supplement_requested', 5, CONTEXT_2, { decisionReceiptId: DECISION_RECEIPT_1 }),
    evidence(6, CONTEXT_2, CONTEXT_3),
    resubmitted(7, CONTEXT_3, CONTEXT_4),
    candidate(8, CONTEXT_4, [EVIDENCE_RECEIPT_1, EVIDENCE_RECEIPT_2]),
    pending(9, CONTEXT_4),
  ];
  assertInvalid(
    [...supplement, formal('credit_approved', 10, CONTEXT_4, {
      decisionReceiptId: DECISION_RECEIPT_1,
      gateId: 'GATE-9',
      candidateId: 'CANDIDATE-8',
      evidenceReceiptIds: [EVIDENCE_RECEIPT_1, EVIDENCE_RECEIPT_2],
    })],
    'RECEIPT_HANDOFF_LINEAGE_MISMATCH',
    9,
  );
});

test('duplicate event, sequence and Case/Attempt/Context/organization drift follow fixed priority', () => {
  const first = opened({ eventId: ' EVENT-ONE ' });
  assertInvalid(
    [first, evidence(2, CONTEXT_1, CONTEXT_2, { eventId: 'EVENT-ONE' })],
    'DUPLICATE_EVENT_ID',
    1,
  );
  assertInvalid(
    [opened(), evidence(2, CONTEXT_1, CONTEXT_2, { sequence: 3 })],
    'NON_CONTIGUOUS_SEQUENCE',
    1,
  );
  assertInvalid([opened({ rootAttemptId: ATTEMPT_2 })], 'IDENTITY_LINEAGE_MISMATCH', 0);

  for (const overrides of [
    { caseId: 'CASE-OTHER' },
    { attemptId: ATTEMPT_2 },
    { previousContextVersion: 'CONTEXT-WRONG' },
    { contextVersion: 'CONTEXT-WRONG' },
    { organizationPath: ['group', 'division-b'] },
  ]) {
    assertInvalid(
      [opened(), evidence(2, CONTEXT_1, CONTEXT_2, overrides)],
      'IDENTITY_LINEAGE_MISMATCH',
      1,
    );
  }
});

test('new Attempt identity and inherited Evidence require exact root, previous and subset lineage', () => {
  const rejected = [...throughGate(), formal('attempt_rejected', 5, CONTEXT_2)];
  for (const overrides of [
    { rootAttemptId: 'ATTEMPT-WRONG' },
    { previousAttemptId: 'ATTEMPT-WRONG' },
    { attemptId: 'ATTEMPT-WRONG' },
    { contextVersion: 'CONTEXT-WRONG' },
    { newContextVersion: CONTEXT_2 },
  ]) {
    assertInvalid(
      [...rejected, newAttempt(6, overrides)],
      'IDENTITY_LINEAGE_MISMATCH',
      5,
    );
  }
  assertInvalid(
    [...rejected, newAttempt(6, { inheritedEvidenceReceiptIds: ['EVIDENCE-UNKNOWN'] })],
    'PROVENANCE_MISMATCH',
    5,
  );

  const withoutInheritance = [...rejected, newAttempt(6, { inheritedEvidenceReceiptIds: [] })];
  assertInvalid(
    [...withoutInheritance, evidence(7, CONTEXT_3, CONTEXT_4, {
      attemptId: ATTEMPT_2,
      evidenceId: ' EVIDENCE-001 ',
      evidenceReceiptId: 'EVIDENCE-RECEIPT-NEW',
    })],
    'PROVENANCE_MISMATCH',
    6,
  );
  assertInvalid(
    [...withoutInheritance, evidence(7, CONTEXT_3, CONTEXT_4, {
      attemptId: ATTEMPT_2,
      evidenceId: 'EVIDENCE-NEW',
      evidenceReceiptId: ` ${EVIDENCE_RECEIPT_1} `,
    })],
    'PROVENANCE_MISMATCH',
    6,
  );
});

test('exact data shapes reject extras, symbols, accessors, non-enumerable and dangerous keys', () => {
  const extra = { ...opened(), extra: true };

  const symbol = opened();
  symbol[Symbol('hidden')] = true;

  const nonEnumerable = opened();
  Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });

  let getterReads = 0;
  const accessor = opened();
  Object.defineProperty(accessor, 'eventId', {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      throw new Error('must not execute');
    },
  });

  const dangerous = opened();
  Object.defineProperty(dangerous, '__proto__', { value: {}, enumerable: true });

  const nestedExtra = opened({ classification: classification({ extra: true }) });

  const pathExtra = opened();
  pathExtra.organizationPath.extra = true;

  const listExtra = candidate(3, CONTEXT_2);
  listExtra.evidenceReceiptIds.extra = true;

  for (const history of [
    [extra],
    [symbol],
    [nonEnumerable],
    [accessor],
    [dangerous],
    [nestedExtra],
    [pathExtra],
    [opened(), evidence(2, CONTEXT_1, CONTEXT_2), listExtra],
  ]) {
    assertInvalid(history, 'MALFORMED_EVENT');
  }
  assert.equal(getterReads, 0);
});

test('numeric coercion, whitespace fields and canonical list duplicates are malformed', () => {
  assertInvalid([opened({ sequence: '1' })], 'MALFORMED_EVENT', 0);
  assertInvalid([opened({ contextVersion: '   ' })], 'MALFORMED_EVENT', 0);
  assertInvalid([opened({ organizationPath: ['group', '   '] })], 'MALFORMED_EVENT', 0);
  assertInvalid([opened({ classification: classification({ reviewPath: ' exception ' }) })], 'MALFORMED_EVENT', 0);

  const base = [opened(), evidence(2, CONTEXT_1, CONTEXT_2)];
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, [EVIDENCE_RECEIPT_1, ` ${EVIDENCE_RECEIPT_1} `])],
    'MALFORMED_EVENT',
    2,
  );
  assertInvalid(
    [...base, candidate(3, CONTEXT_2, [EVIDENCE_RECEIPT_1], { governanceVersion: '5' })],
    'MALFORMED_EVENT',
    2,
  );
  assertInvalid(
    [...throughGate(), formal('supplement_requested', 5, CONTEXT_2, {
      dueAt: '2030-02-31T03:04:05.000Z',
    })],
    'MALFORMED_EVENT',
    4,
  );
});

test('canonical opaque identifiers are trimmed while path order and immutable classification are retained', () => {
  const history = [
    opened({
      eventId: ' WORK-EVENT-001 ',
      caseId: ` ${CASE_ID} `,
      attemptId: ` ${ATTEMPT_1} `,
      contextVersion: ` ${CONTEXT_1} `,
      actorId: ' ACTOR-OPEN-001 ',
      rootAttemptId: ` ${ATTEMPT_1} `,
      organizationPath: ORGANIZATION_PATH.map((entry) => ` ${entry} `),
    }),
    evidence(2, ` ${CONTEXT_1} `, ` ${CONTEXT_2} `, {
      eventId: ' WORK-EVENT-002 ',
      caseId: ` ${CASE_ID} `,
      attemptId: ` ${ATTEMPT_1} `,
      contextVersion: ` ${CONTEXT_2} `,
      actorId: ' ACTOR-EVIDENCE-001 ',
      organizationPath: ORGANIZATION_PATH.map((entry) => ` ${entry} `),
      evidenceId: ' EVIDENCE-001 ',
      evidenceKind: ' business_license ',
      evidenceReceiptId: ` ${EVIDENCE_RECEIPT_1} `,
    }),
  ];
  const result = replayWorkAggregate(history);
  assert.equal(result.state, 'valid');
  assert.equal(result.caseId, CASE_ID);
  assert.equal(result.attemptId, ATTEMPT_1);
  assert.equal(result.contextVersion, CONTEXT_2);
  assert.deepEqual(result.organizationPath, ORGANIZATION_PATH);
  assert.deepEqual(result.classification, classification());
  assert.deepEqual(result.acceptedEvidence, [{
    evidenceId: 'EVIDENCE-001',
    evidenceKind: 'business_license',
    evidenceReceiptId: EVIDENCE_RECEIPT_1,
  }]);
});

test('replay is synchronous, deterministic, defensive and never mutates event history', () => {
  const history = goldenHistory();
  const pristine = structuredClone(history);
  const first = replayWorkAggregate(history);
  const second = replayWorkAggregate(history);

  assert.equal(first instanceof Promise, false);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.organizationPath, history[0].organizationPath);
  assert.notEqual(first.classification, history[0].classification);
  assert.notEqual(first.acceptedEvidence, second.acceptedEvidence);
  assert.notEqual(first.candidateDraft, second.candidateDraft);
  assert.deepEqual(history, pristine);

  first.organizationPath.push('mutated-output');
  first.classification.businessMode = 'new_return';
  first.acceptedEvidence[0].evidenceId = 'mutated-output';
  first.candidateDraft.evidenceReceiptIds.push('mutated-output');
  first.handoff.destinationAssignmentRef = 'mutated-output';
  assert.deepEqual(replayWorkAggregate(pristine), second);

  history[0].organizationPath.push('mutated-input');
  history[0].classification.businessMode = 'new_return';
  assert.deepEqual(replayWorkAggregate(pristine), second);
});

test('empty and corrupt histories are deterministic invalid and cannot be repaired later', () => {
  const emptyFirst = replayWorkAggregate([]);
  const emptySecond = replayWorkAggregate([]);
  assert.deepEqual(emptyFirst, emptySecond);
  assert.equal(emptyFirst instanceof Promise, false);
  assert.equal(emptyFirst.invalidReason, 'EMPTY_HISTORY');
  assert.equal(emptyFirst.invalidEventIndex, null);

  assertInvalid(null, 'MALFORMED_EVENT');
  assertInvalid([null], 'MALFORMED_EVENT', 0);
  assertInvalid([{}], 'MALFORMED_EVENT', 0);
  assertInvalid([evidence(1, CONTEXT_1, CONTEXT_2)], 'FIRST_EVENT_NOT_CASE_OPENED', 0);
  assertInvalid(
    [evidence(1, CONTEXT_1, CONTEXT_2), opened({ sequence: 2, eventId: 'WORK-EVENT-002' })],
    'FIRST_EVENT_NOT_CASE_OPENED',
    0,
  );
});
