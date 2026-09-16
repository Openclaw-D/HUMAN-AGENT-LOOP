import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4WorkCommandHandler } from '../lib/v4/work-command-handler.ts';
import { V4WorkCommandHandlerError } from '../lib/v4/work-command-types.ts';
import { createInMemoryV4WorkStore } from '../lib/v4/work-store.ts';

const caseId = 'CTRL-03A-CASE';
const attemptId = 'CTRL-03A-ATTEMPT';
const operatorId = 'CTRL-03A-OPERATOR';
const reviewerId = 'CTRL-03A-REVIEWER';
const operatorSessionId = 'CTRL-03A-OPERATOR-SESSION';
const reviewerSessionId = 'CTRL-03A-REVIEWER-SESSION';
const policyVersion = 'CTRL-03A-POLICY';
const organizationPath = ['group', 'credit'];
const candidateRef = 'CTRL-03A-CANDIDATE-REF';
const capabilityId = 'credit.controller-03a';

function actor(actorId, kind = 'internal_human') {
  return { actorId, kind, organizationPath: [...organizationPath], externalInvitation: null };
}

function grant(actorId, action, grantId) {
  return {
    grantId,
    actorId,
    action,
    resourceType: 'case',
    resourceId: caseId,
    organizationScope: { mode: 'exact', organizationPath: [...organizationPath] },
    policyVersion,
    invitationId: null,
  };
}

function session(sessionId, identity, grants, overrides = {}) {
  return {
    sessionId,
    actor: identity,
    roleAssignments: [],
    grants,
    denies: [],
    presentedInvitationId: null,
    ...overrides,
  };
}

function opened() {
  return {
    eventId: 'CTRL-03A-EVENT-001', sequence: 1, eventType: 'case_opened', caseId, attemptId,
    contextVersion: 'CTRL-03A-CONTEXT-001', actorId: 'CTRL-03A-OPENER',
    organizationPath: [...organizationPath], rootAttemptId: attemptId,
    classification: {
      businessMode: 'direct', acquisitionSource: 'supplier_referral', reviewPath: 'exception',
      dueDiligenceMode: 'business_site',
    },
  };
}

function governanceHistory() {
  const base = (eventType, governanceVersion) => ({
    eventType, eventId: `CTRL-03A-GOV-${governanceVersion}`, capabilityId, version: '1.0.0',
    governanceVersion, actorId: 'CTRL-03A-GOVERNANCE', organizationScopePath: [...organizationPath],
  });
  return [
    {
      ...base('version_registered', 1),
      definition: { capabilityId, ownerActorId: 'CTRL-03A-OWNER', ownerOrganizationUnitId: 'credit', kind: 'Analyzer', authority: 'none' },
      capabilityVersion: {
        capabilityId, version: '1.0.0', definitionHash: 'sha256:ctrl-03a',
        supportedStages: ['credit'], supportedBusinessModes: ['direct'], supportedReviewPaths: ['exception'],
        requiredEvidenceKinds: ['business_license'], allowedOutputKinds: ['CandidateDraft'],
      },
    },
    { ...base('evaluation_passed', 2), evaluationId: 'CTRL-03A-EVALUATION' },
    { ...base('approval_granted', 3), approvalReceiptId: 'CTRL-03A-APPROVAL' },
    { ...base('shadow_released', 4), approvalReceiptId: 'CTRL-03A-APPROVAL' },
    { ...base('activated', 5), releaseReceiptId: 'CTRL-03A-RELEASE' },
  ];
}

function decisionInput(overrides = {}) {
  return {
    sessionId: reviewerSessionId,
    command: {
      requestId: 'CTRL-03A-DECISION-REQUEST',
      idempotencyKey: 'CTRL-03A-DECISION-IDEMPOTENCY',
      operation: 'submit_credit_decision',
      expectedContextVersion: 'V4-CONTEXT-000002',
      payload: { caseId, action: 'approve_credit', rationale: '  Credit evidence has been reviewed.  ' },
      ...overrides,
    },
  };
}

function assertCode(call, code) {
  assert.throws(call, (error) => {
    assert.equal(error instanceof V4WorkCommandHandlerError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function ready(options = {}) {
  const operator = actor(operatorId);
  const reviewer = options.reviewer ?? actor(reviewerId);
  const prepareGrants = [
    grant(operatorId, { family: 'prepare', name: 'prepare_evidence_draft' }, 'CTRL-03A-PREP-EVIDENCE'),
    grant(operatorId, { family: 'prepare', name: 'prepare_candidate_draft' }, 'CTRL-03A-PREP-CANDIDATE'),
  ];
  const decisionGrant = grant(
    reviewerId,
    { family: 'professional_decide', name: 'credit_decide' },
    'CTRL-03A-CREDIT-DECIDE',
  );
  const reviewerSession = session(
    reviewerSessionId,
    options.sessionActor ?? reviewer,
    options.decisionGrants ?? [decisionGrant],
    { roleAssignments: options.roleAssignments ?? [], denies: options.denies ?? [] },
  );
  const store = createInMemoryV4WorkStore({
    currentPolicyVersion: policyVersion,
    actors: options.actors ?? [operator, reviewer],
    sessions: [session(operatorSessionId, operator, prepareGrants), reviewerSession],
    cases: [{ caseId, events: [opened()] }],
    preparedCandidates: [{
      preparedCandidateRef: candidateRef, candidateId: 'CTRL-03A-CANDIDATE', capabilityId,
      capabilityVersion: '1.0.0', observedGovernanceVersion: 5, caseId, attemptId,
      contextVersion: 'V4-CONTEXT-000002', evidenceReceiptIds: ['V4-EVIDENCE-RECEIPT-000002'],
      outputKind: 'CandidateDraft', authority: 'none',
    }],
    capabilityGovernanceHistories: [{ capabilityId, capabilityVersion: '1.0.0', events: governanceHistory() }],
    creditReviewAssignments: [{ caseId, assignmentRef: 'CTRL-03A-ASSIGNMENT', requiredActorId: reviewerId }],
  });
  const execute = createV4WorkCommandHandler(store);
  execute({
    sessionId: operatorSessionId,
    command: {
      requestId: 'CTRL-03A-EVIDENCE-REQUEST', idempotencyKey: 'CTRL-03A-EVIDENCE-IDEMPOTENCY',
      operation: 'accept_evidence', expectedContextVersion: 'CTRL-03A-CONTEXT-001',
      payload: { caseId, evidenceId: 'CTRL-03A-EVIDENCE', evidenceKind: 'business_license' },
    },
  });
  if (!options.skipCandidate) {
    execute({
      sessionId: operatorSessionId,
      command: {
        requestId: 'CTRL-03A-CANDIDATE-REQUEST', idempotencyKey: 'CTRL-03A-CANDIDATE-IDEMPOTENCY',
        operation: 'record_candidate', expectedContextVersion: 'V4-CONTEXT-000002',
        payload: { caseId, preparedCandidateRef: candidateRef },
      },
    });
  }
  return { store, execute };
}

test('controller 03A: named Human credit decision atomically binds Event, stored Receipt, projection and replay', () => {
  const { store, execute } = ready();
  const before = store.readCase(caseId);
  const result = execute(decisionInput());
  const after = store.readCase(caseId);
  assert.equal(result instanceof Promise, false);
  assert.equal(result.receipt.operation, 'submit_credit_decision');
  assert.equal(result.receipt.rationale, 'Credit evidence has been reviewed.');
  assert.equal(after.events.length, before.events.length + 1);
  assert.equal(after.decisionReceipts.length, 1);
  assert.equal(after.decisionReceipts[0].decisionReceiptId, result.receipt.decisionReceiptId);
  assert.equal(after.decisionReceipts[0].eventId, result.receipt.eventId);
  assert.equal(after.decisionReceipts[0].authorityDecisionId, result.receipt.authorityDecisionId);
  assert.deepEqual(after.decisionReceipts[0].evidenceReceiptIds, ['V4-EVIDENCE-RECEIPT-000002']);
  assert.equal(result.projection.workflowStatus, 'credit_approved');
  assert.equal(result.projection.lifecycle.creditStatus, 'approved');
  assert.equal(result.projection.lifecycle.commercialStatus, 'not_started');
  assert.equal(result.projection.lifecycle.assetStatus, 'not_started');
  assert.equal(result.projection.lifecycle.commencementStatus, 'not_started');
  const replay = execute(decisionInput({ requestId: 'CTRL-03A-REPLAY' }));
  assert.deepEqual(replay, result);
  assert.equal(store.readCase(caseId).decisionReceipts.length, 1);
});

test('controller 03A: authority and active Gate checks fail closed before a Decision Receipt exists', () => {
  const wrongActorId = 'CTRL-03A-WRONG-ACTOR';
  const cases = [
    [ready({ decisionGrants: [] }), 'AUTHORITY_DENIED'],
    [ready({ sessionActor: actor(reviewerId, 'capability') }), 'AUTHORITY_DENIED'],
    [ready({
      sessionActor: actor(wrongActorId),
      decisionGrants: [grant(
        wrongActorId,
        { family: 'professional_decide', name: 'credit_decide' },
        'CTRL-03A-WRONG-ACTOR-GRANT',
      )],
    }), 'HUMAN_GATE_ACTOR_MISMATCH'],
  ];
  for (const [{ store, execute }, expected] of cases) {
    const before = store.readCase(caseId);
    assertCode(() => execute(decisionInput()), expected);
    assert.deepEqual(store.readCase(caseId), before);
  }
});

test('controller 03A: stale, malformed rationale, no Gate and transaction failure are zero-write', () => {
  const stale = ready();
  const staleBefore = stale.store.readCase(caseId);
  assertCode(() => stale.execute(decisionInput({ expectedContextVersion: 'STALE' })), 'STALE_CONTEXT');
  assert.deepEqual(stale.store.readCase(caseId), staleBefore);

  const malformed = ready();
  const malformedBefore = malformed.store.readCase(caseId);
  assertCode(() => malformed.execute(decisionInput({ payload: { caseId, action: 'approve_credit', rationale: '   ' } })), 'INVALID_COMMAND');
  assert.deepEqual(malformed.store.readCase(caseId), malformedBefore);

  const noGate = ready({ skipCandidate: true });
  const noGateBefore = noGate.store.readCase(caseId);
  assertCode(() => noGate.execute(decisionInput()), 'HUMAN_GATE_NOT_PENDING');
  assert.deepEqual(noGate.store.readCase(caseId), noGateBefore);

  const failed = ready();
  const failedBefore = failed.store.readCase(caseId);
  failed.store.__testOnlyFailNextTransaction();
  assertCode(() => failed.execute(decisionInput()), 'TRANSACTION_FAILED');
  assert.deepEqual(failed.store.readCase(caseId), failedBefore);
});

test('controller 03A: stored Decision Receipt and response are defensive clones', () => {
  const { store, execute } = ready();
  const first = execute(decisionInput());
  const canonical = structuredClone(first);
  first.receipt.rationale = 'MUTATED';
  first.projection.lifecycle.creditStatus = 'MUTATED';
  const read = store.readCase(caseId);
  read.decisionReceipts[0].rationale = 'MUTATED';
  read.decisionReceipts[0].evidenceReceiptIds[0] = 'MUTATED';
  assert.deepEqual(execute(decisionInput({ requestId: 'CTRL-03A-CLONE-REPLAY' })), canonical);
  assert.equal(store.readCase(caseId).decisionReceipts[0].rationale, 'Credit evidence has been reviewed.');
});
