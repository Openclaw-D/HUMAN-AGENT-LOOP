import assert from 'node:assert/strict';
import test from 'node:test';

import { replayWorkAggregate } from '../lib/v4/work-aggregate.ts';

const classification = {
  businessMode: 'direct',
  acquisitionSource: 'supplier_referral',
  reviewPath: 'exception',
  dueDiligenceMode: 'business_site',
};

function envelope(eventType, sequence, contextVersion, overrides = {}) {
  return {
    eventId: `CTRL-EVENT-${sequence}`,
    sequence,
    eventType,
    caseId: 'CTRL-CASE-001',
    attemptId: 'CTRL-ATTEMPT-001',
    contextVersion,
    actorId: 'CTRL-RECORDER',
    organizationPath: ['group', 'credit'],
    ...overrides,
  };
}

const opened = () => ({
  ...envelope('case_opened', 1, 'CTRL-CONTEXT-001'),
  rootAttemptId: 'CTRL-ATTEMPT-001',
  classification: { ...classification },
});

const evidence = () => ({
  ...envelope('evidence_accepted', 2, 'CTRL-CONTEXT-002'),
  previousContextVersion: 'CTRL-CONTEXT-001',
  newContextVersion: 'CTRL-CONTEXT-002',
  evidenceId: 'CTRL-EVIDENCE-001',
  evidenceKind: 'business_license',
  evidenceReceiptId: 'CTRL-EVIDENCE-RECEIPT-001',
});

function candidate(overrides = {}) {
  return {
    ...envelope('candidate_recorded', 3, 'CTRL-CONTEXT-002', {
      actorId: 'CTRL-CAPABILITY-001',
    }),
    candidateId: 'CTRL-CANDIDATE-001',
    capabilityId: 'CTRL-CAPABILITY-001',
    capabilityVersion: '1.0.0',
    governanceVersion: 5,
    admissionDecisionId: 'CTRL-ADMISSION-001',
    evidenceReceiptIds: ['CTRL-EVIDENCE-RECEIPT-001'],
    outputKind: 'CandidateDraft',
    authority: 'none',
    ...overrides,
  };
}

const pending = () => ({
  ...envelope('pending_human_review', 4, 'CTRL-CONTEXT-002'),
  gateId: 'CTRL-GATE-001',
  requiredActorId: 'CTRL-HUMAN-001',
});

function approved(overrides = {}) {
  return {
    ...envelope('credit_approved', 5, 'CTRL-CONTEXT-002', {
      actorId: 'CTRL-HUMAN-001',
    }),
    authoritySource: 'named_human',
    authorityDecisionOutcome: 'allowed',
    authorityDecisionId: 'CTRL-AUTHORITY-001',
    policyVersion: 'CTRL-POLICY-001',
    decisionReceiptId: 'CTRL-DECISION-RECEIPT-001',
    ...overrides,
  };
}

function handoff(overrides = {}) {
  return {
    ...envelope('credit_handoff_recorded', 6, 'CTRL-CONTEXT-002', {
      actorId: 'CTRL-HUMAN-001',
    }),
    handoffId: 'CTRL-HANDOFF-001',
    sourceDecisionReceiptId: 'CTRL-DECISION-RECEIPT-001',
    destinationStage: 'commercial',
    destinationAssignmentRef: 'CTRL-ASSIGNMENT-001',
    ...overrides,
  };
}

function assertFailClosed(history) {
  const result = replayWorkAggregate(history);
  assert.equal(result.state, 'invalid');
  assert.equal(result.eventCount, 0);
  assert.equal(result.caseId, null);
  assert.equal(result.decisionReceiptId, null);
  assert.equal(result.handoff, null);
}

test('semantic enum tokens are exact and cannot be normalized into valid Candidate authority', () => {
  for (const overrides of [
    { outputKind: ' CandidateDraft ' },
    { authority: ' none ' },
  ]) {
    assertFailClosed([opened(), evidence(), candidate(overrides)]);
  }
});

test('formal authority tokens and destination stage must be exact canonical literals', () => {
  const throughGate = [opened(), evidence(), candidate(), pending()];
  for (const overrides of [
    { authoritySource: ' named_human ' },
    { authorityDecisionOutcome: ' allowed ' },
  ]) {
    assertFailClosed([...throughGate, approved(overrides)]);
  }
  assertFailClosed([...throughGate, approved(), handoff({ destinationStage: ' commercial ' })]);
});
