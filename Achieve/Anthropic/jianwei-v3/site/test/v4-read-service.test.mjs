import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readV4CaseProjection,
  readV4ManagementProjection,
} from '../lib/v4/read-service.ts';
import {
  __testOnlyResetServerReadContext,
  __testOnlySetServerReadCorruption,
} from '../lib/v4/server-read-context.ts';

const CASE_ID = 'CASE-V4-SYNTH-001';
const ATTEMPT_ID = 'ATTEMPT-V4-SYNTH-001';
const CONTEXT_VERSION = 'CONTEXT-V4-007';
const SCOPE_ID = 'ORG-DIVISION-A';

function caseInput(overrides = {}) {
  return {
    sessionId: 'SESSION-CASE-ALLOWED',
    caseId: CASE_ID,
    ...overrides,
  };
}

function managementInput(overrides = {}) {
  return {
    sessionId: 'SESSION-MANAGEMENT-ALLOWED',
    scopeId: SCOPE_ID,
    ...overrides,
  };
}

function assertCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('allowed Case and management sessions return exact DTOs with one canonical identity', () => {
  const work = readV4CaseProjection(caseInput());
  const management = readV4ManagementProjection(managementInput());

  assert.deepEqual(work, {
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
    organizationPath: ['group', 'division-a', 'credit-team', 'portfolio-a'],
    currentOwnerActorId: 'actor-credit-professional-001',
    assignmentRefs: ['ASSIGN-CREDIT-001', 'QUEUE-CREDIT-EXCEPTION'],
    evidence: [
      { evidenceKind: 'business_license', evidenceId: 'EVIDENCE-LICENSE-001' },
      { evidenceKind: 'tax_record', evidenceId: 'EVIDENCE-TAX-001' },
    ],
    candidateDraft: {
      capabilityId: 'credit.material-gap-analyzer',
      version: '1.0.0',
      contextVersion: CONTEXT_VERSION,
      authority: 'none',
    },
    currentHumanGate: {
      gateId: 'GATE-CREDIT-001',
      gateType: 'credit_professional_review',
      requiredActorId: 'actor-credit-professional-001',
      status: 'pending',
    },
    decisionReceipt: null,
    handoff: null,
    capabilityAdmission: {
      capabilityId: 'credit.material-gap-analyzer',
      version: '1.0.0',
      governanceVersion: 5,
      state: 'active',
      admissionOutcome: 'eligible',
      admissionReasonCode: 'ELIGIBLE',
      requestedOutputKind: 'CandidateDraft',
      authority: 'none',
    },
  });

  assert.deepEqual(management, {
    scopeId: SCOPE_ID,
    scopePath: ['group', 'division-a'],
    policyVersion: 'POLICY-V4-001',
    cases: [{
      caseId: CASE_ID,
      attemptId: ATTEMPT_ID,
      contextVersion: CONTEXT_VERSION,
      currentStage: 'credit',
      lifecycle: {
        creditStatus: 'pending_human_review',
        commercialStatus: 'not_started',
        assetStatus: 'not_started',
        commencementStatus: 'not_started',
      },
      anomalyCodes: ['CAPABILITY_DRAFT_NON_AUTHORITATIVE', 'HUMAN_GATE_PENDING'],
    }],
    capabilityAdmission: work.capabilityAdmission,
  });
  assert.deepEqual(
    [management.cases[0].caseId, management.cases[0].attemptId, management.cases[0].contextVersion],
    [work.caseId, work.attemptId, work.contextVersion],
  );
});

test('server-resolved Authority denies role-only, explicit-deny, out-of-scope and wrong-surface sessions', () => {
  for (const sessionId of [
    'SESSION-ROLE-ONLY',
    'SESSION-EXPLICIT-DENY',
    'SESSION-OUT-OF-SCOPE',
    'SESSION-MANAGEMENT-ALLOWED',
  ]) {
    assertCode(
      () => readV4CaseProjection(caseInput({ sessionId })),
      'READ_DENIED',
    );
  }
  assertCode(
    () => readV4ManagementProjection(managementInput({ sessionId: 'SESSION-CASE-ALLOWED' })),
    'READ_DENIED',
  );
});

test('invalid input, session and resource lookup follow one deterministic error priority', () => {
  assertCode(
    () => readV4CaseProjection({ ...caseInput({ sessionId: 'SESSION-UNKNOWN', caseId: 'CASE-UNKNOWN' }), extra: true }),
    'INVALID_READ_INPUT',
  );
  assertCode(
    () => readV4CaseProjection(caseInput({ sessionId: 'SESSION-UNKNOWN', caseId: 'CASE-UNKNOWN' })),
    'SESSION_NOT_FOUND',
  );
  assertCode(
    () => readV4CaseProjection(caseInput({ caseId: 'CASE-UNKNOWN' })),
    'CASE_NOT_FOUND',
  );
  assertCode(
    () => readV4ManagementProjection(managementInput({ scopeId: 'ORG-UNKNOWN' })),
    'SCOPE_NOT_FOUND',
  );

  for (const sessionId of ['__proto__', 'constructor', 'prototype', 'toString']) {
    assertCode(
      () => readV4CaseProjection(caseInput({ sessionId })),
      'SESSION_NOT_FOUND',
    );
  }
});

test('caller cannot inject Actor, grant, policy, scope or projection fields', () => {
  for (const extra of [
    { actor: { actorId: 'attacker' } },
    { grants: [{ grantId: 'forged' }] },
    { policyVersion: 'POLICY-FORGED' },
    { governanceProjection: { state: 'active' } },
    { capabilityAdmission: { outcome: 'eligible' } },
    { organizationPath: ['group'] },
  ]) {
    assertCode(() => readV4CaseProjection({ ...caseInput(), ...extra }), 'INVALID_READ_INPUT');
  }
});

test('capability summary is replayed and admitted without Routing, execution or Receipt side effects', () => {
  const first = readV4CaseProjection(caseInput());
  const second = readV4CaseProjection(caseInput());
  assert.deepEqual(first.capabilityAdmission, second.capabilityAdmission);
  assert.deepEqual(Object.keys(first.capabilityAdmission).sort(), [
    'admissionOutcome',
    'admissionReasonCode',
    'authority',
    'capabilityId',
    'governanceVersion',
    'requestedOutputKind',
    'state',
    'version',
  ]);
  assert.equal(first.capabilityAdmission.authority, 'none');
  assert.equal(first.decisionReceipt, null);
  assert.equal(first.handoff, null);
  assert.equal('routing' in first, false);
  assert.equal('adapter' in first, false);
  assert.equal(JSON.stringify(first).includes('candidate_model'), false);
});

test('reads are synchronous, deterministic, zero-write and return defensive deep clones', () => {
  const input = caseInput({ sessionId: ' SESSION-CASE-ALLOWED ', caseId: ` ${CASE_ID} ` });
  const before = structuredClone(input);
  const first = readV4CaseProjection(input);
  const second = readV4CaseProjection(input);

  assert.equal(first instanceof Promise, false);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.classification, second.classification);
  assert.notEqual(first.lifecycle, second.lifecycle);
  assert.notEqual(first.evidence, second.evidence);
  assert.notEqual(first.capabilityAdmission, second.capabilityAdmission);
  assert.deepEqual(input, before);

  first.organizationPath.push('mutated-output');
  first.assignmentRefs.push('mutated-output');
  first.evidence[0].evidenceId = 'mutated-output';
  first.lifecycle.creditStatus = 'vetoed_final';
  first.capabilityAdmission.capabilityId = 'mutated-output';
  assert.deepEqual(readV4CaseProjection(caseInput()), second);

  const managementFirst = readV4ManagementProjection(managementInput());
  const managementSecond = readV4ManagementProjection(managementInput());
  assert.deepEqual(managementFirst, managementSecond);
  assert.notEqual(managementFirst.cases, managementSecond.cases);
  assert.notEqual(managementFirst.cases[0].lifecycle, managementSecond.cases[0].lifecycle);
  managementFirst.cases[0].anomalyCodes.push('mutated-output');
  managementFirst.scopePath.push('mutated-output');
  assert.deepEqual(readV4ManagementProjection(managementInput()), managementSecond);
});

test('all projected collection fields use stable ordinal sorting', () => {
  const work = readV4CaseProjection(caseInput());
  const management = readV4ManagementProjection(managementInput());
  assert.deepEqual(work.assignmentRefs, [...work.assignmentRefs].sort());
  assert.deepEqual(work.evidence, [...work.evidence].sort((left, right) => (
    left.evidenceKind.localeCompare(right.evidenceKind)
      || left.evidenceId.localeCompare(right.evidenceId)
  )));
  assert.deepEqual(management.cases[0].anomalyCodes, [...management.cases[0].anomalyCodes].sort());
  assert.deepEqual(management.cases, [...management.cases].sort((left, right) => (
    left.caseId.localeCompare(right.caseId) || left.attemptId.localeCompare(right.attemptId)
  )));
});

test('exact input shape rejects missing, coercion, symbols, non-enumerable and dangerous keys', () => {
  const candidates = [
    null,
    {},
    { sessionId: 1, caseId: CASE_ID },
    { sessionId: 'SESSION-CASE-ALLOWED', caseId: '   ' },
    { ...caseInput(), extra: true },
  ];
  const symbol = caseInput();
  symbol[Symbol('hidden')] = true;
  candidates.push(symbol);
  const nonEnumerable = caseInput();
  Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
  candidates.push(nonEnumerable);
  const dangerous = caseInput();
  Object.defineProperty(dangerous, '__proto__', { value: true, enumerable: true });
  candidates.push(dangerous);

  for (const candidate of candidates) {
    assertCode(() => readV4CaseProjection(candidate), 'INVALID_READ_INPUT');
  }

  let reads = 0;
  const accessor = caseInput();
  Object.defineProperty(accessor, 'sessionId', {
    enumerable: true,
    get() {
      reads += 1;
      return 'SESSION-CASE-ALLOWED';
    },
  });
  assertCode(() => readV4CaseProjection(accessor), 'INVALID_READ_INPUT');
  assert.equal(reads, 0);
});

test('internal Case identity drift and corrupt Governance fail closed without partial DTO', () => {
  try {
    __testOnlySetServerReadCorruption('case_identity_drift');
    assertCode(() => readV4CaseProjection(caseInput()), 'PROJECTION_INVALID');
    assertCode(() => readV4ManagementProjection(managementInput()), 'PROJECTION_INVALID');
  } finally {
    __testOnlyResetServerReadContext();
  }

  try {
    __testOnlySetServerReadCorruption('invalid_governance');
    assertCode(() => readV4CaseProjection(caseInput()), 'PROJECTION_INVALID');
    assertCode(() => readV4ManagementProjection(managementInput()), 'PROJECTION_INVALID');
  } finally {
    __testOnlyResetServerReadContext();
  }
  assert.equal(readV4CaseProjection(caseInput()).caseId, CASE_ID);
});
