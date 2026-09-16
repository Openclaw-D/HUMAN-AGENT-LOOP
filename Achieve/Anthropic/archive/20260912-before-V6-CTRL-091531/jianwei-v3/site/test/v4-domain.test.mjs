import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyV4CreditDecision,
  createV4Candidate,
  createV4Case,
  createV4P0LiveCell,
  markV4PendingHumanReview,
  resubmitV4Supplement,
  startV4AttemptAfterRejection,
  validateV4CaseClassification,
} from '../lib/v4/index.ts';

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function classification(businessMode = 'direct', reviewPath = 'exception') {
  return {
    businessMode,
    acquisitionSource: businessMode === 'direct' ? 'supplier_referral' : 'relationship_maintenance',
    reviewPath,
    dueDiligenceMode: businessMode === 'new_return'
      ? 'joint_business_credit_site'
      : 'business_site',
  };
}

function v4Case(businessMode = 'direct', reviewPath = 'exception') {
  return createV4Case({
    caseId: `CASE-${businessMode}-${reviewPath}`,
    attemptId: 'ATTEMPT-001',
    contextVersion: 'CTX-V4-001',
    classification: classification(businessMode, reviewPath),
  });
}

const ACTOR = { actorId: 'actor-credit-001', displayName: '具名信审人员' };
const ALLOW_POLICY = () => ({ outcome: 'allowed', policyVersion: 'POLICY-V4-001' });

function humanCommand(current, action, overrides = {}) {
  return {
    decisionId: `DEC-${action}-001`,
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    action,
    authoritySource: 'confirmed_human',
    actor: ACTOR,
    policy: ALLOW_POLICY,
    rationale: '基于当前 Evidence 作出具名决定',
    evidenceReceiptIds: ['RCP-EVIDENCE-001'],
    receiptId: `RCP-${action}-001`,
    ...overrides,
  };
}

function authorizedRule(overrides = {}) {
  return {
    ruleId: 'RULE-CREDIT-001',
    version: 'RULE-V4-2026-08-31',
    deterministic: true,
    scope: {
      scopeId: 'SCOPE-STANDARD-CREDIT',
      businessModes: ['direct', 'existing_return', 'new_return'],
      reviewPaths: ['standard'],
      actions: ['approve_credit'],
    },
    approval: {
      approvalId: 'APPROVAL-001',
      approvedByActorId: 'actor-governance-001',
      approvedAt: '2026-08-31T08:00:00.000Z',
    },
    rollback: {
      rollbackId: 'ROLLBACK-001',
      previousVersion: 'RULE-V4-2026-08-01',
      procedureRef: 'runbook://credit-rule/rollback',
    },
    ...overrides,
  };
}

function ruleCommand(current, overrides = {}) {
  return {
    decisionId: 'DEC-RULE-001',
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    action: 'approve_credit',
    authoritySource: 'authorized_rule',
    rule: authorizedRule(),
    rationale: '组织授权的确定性规则命中',
    evidenceReceiptIds: ['RCP-EVIDENCE-001'],
    receiptId: 'RCP-RULE-001',
    ...overrides,
  };
}

test('V4-C-03/D-01/D-02/R-07: freezes the first live cell and keeps the 3x2 classification matrix orthogonal', () => {
  const liveCell = createV4P0LiveCell({
    caseId: 'CASE-LIVE-001',
    attemptId: 'ATTEMPT-LIVE-001',
    contextVersion: 'CTX-V4-001',
    acquisitionSource: 'supplier_referral',
    dueDiligenceMode: 'business_site',
  });
  assert.equal(liveCell.classification.businessMode, 'direct');
  assert.equal(liveCell.classification.reviewPath, 'exception');

  const combinations = [];
  for (const businessMode of ['direct', 'existing_return', 'new_return']) {
    for (const reviewPath of ['standard', 'exception']) {
      const created = v4Case(businessMode, reviewPath);
      combinations.push(`${created.classification.businessMode}:${created.classification.reviewPath}`);
      assert.deepEqual(created.classification, classification(businessMode, reviewPath));
      assert.equal(created.lifecycle.creditStatus, 'rule_screening');
    }
  }
  assert.deepEqual(combinations, [
    'direct:standard',
    'direct:exception',
    'existing_return:standard',
    'existing_return:exception',
    'new_return:standard',
    'new_return:exception',
  ]);
});

test('V4-D-03: new_return preserves the joint_business_credit_site constraint', () => {
  const valid = validateV4CaseClassification(classification('new_return', 'exception'));
  assert.equal(valid.dueDiligenceMode, 'joint_business_credit_site');
  expectCode(
    () => validateV4CaseClassification({
      ...classification('new_return', 'exception'),
      dueDiligenceMode: 'remote_plus_site',
    }),
    'DUE_DILIGENCE_CONSTRAINT_VIOLATION',
  );
});

test('V4-D-04/D-05: rule and human credit approval never advance commercial, asset or commencement', () => {
  const standard = v4Case('direct', 'standard');
  const byRule = applyV4CreditDecision(standard, ruleCommand(standard));
  assert.equal(byRule.case.lifecycle.creditStatus, 'approved_by_rule');
  assert.deepEqual(byRule.case.lifecycle, {
    creditStatus: 'approved_by_rule',
    commercialStatus: 'not_started',
    assetStatus: 'not_started',
    commencementStatus: 'not_started',
  });
  assert.equal(byRule.case.currentStage, 'credit');
  assert.equal(byRule.receipt.status, 'succeeded');
  assert.deepEqual(byRule.receipt.resultingLifecycle, byRule.case.lifecycle);

  const exception = markV4PendingHumanReview(v4Case('direct', 'exception'));
  const byHuman = applyV4CreditDecision(exception, humanCommand(exception, 'approve_credit'));
  assert.deepEqual(byHuman.case.lifecycle, {
    creditStatus: 'approved_by_human',
    commercialStatus: 'not_started',
    assetStatus: 'not_started',
    commencementStatus: 'not_started',
  });
  assert.equal(byHuman.case.currentStage, 'credit');
  assert.equal(byHuman.receipt.decision.actorId, ACTOR.actorId);

  const independent = {
    ...standard,
    lifecycle: {
      creditStatus: 'rule_screening',
      commercialStatus: 'pending',
      assetStatus: 'blocked',
      commencementStatus: 'unknown',
    },
  };
  const preserved = applyV4CreditDecision(independent, ruleCommand(independent));
  assert.deepEqual(preserved.case.lifecycle, {
    creditStatus: 'approved_by_rule',
    commercialStatus: 'pending',
    assetStatus: 'blocked',
    commencementStatus: 'unknown',
  });
});

test('V4-D-06/D-07: return, reject and veto have distinct terminality and attempt lineage', () => {
  const pending = markV4PendingHumanReview(v4Case());
  const returned = applyV4CreditDecision(pending, humanCommand(pending, 'return_for_supplement', {
    supplementRequest: {
      requiredItems: ['补充设备合同'],
      ownerActorId: 'actor-business-001',
      dueAt: '2026-09-02T09:00:00.000Z',
      evidenceLineage: ['RCP-EVIDENCE-001'],
    },
  }));
  assert.equal(returned.case.lifecycle.creditStatus, 'returned_for_supplement');
  assert.equal(returned.case.attemptId, pending.attemptId);
  assert.equal(returned.case.attemptLineage.status, 'active');
  assert.equal(returned.receipt.decision.supplementRequest.ownerActorId, 'actor-business-001');

  const resubmitted = resubmitV4Supplement({
    current: returned.case,
    expectedContextVersion: returned.case.contextVersion,
    newContextVersion: 'CTX-V4-002',
    actor: { actorId: 'actor-business-001', displayName: '具名业务人员' },
    evidenceReceiptIds: ['RCP-EVIDENCE-002'],
    receiptId: 'RCP-RESUBMIT-001',
  });
  assert.equal(resubmitted.case.lifecycle.creditStatus, 'resubmitted');
  assert.equal(resubmitted.case.attemptId, pending.attemptId);
  assert.equal(resubmitted.receipt.status, 'succeeded');

  const rejected = applyV4CreditDecision(pending, humanCommand(pending, 'reject_current_attempt'));
  assert.equal(rejected.case.lifecycle.creditStatus, 'rejected_current_attempt');
  assert.equal(rejected.case.attemptLineage.status, 'terminated');
  const restarted = startV4AttemptAfterRejection({
    current: rejected.case,
    newAttemptId: 'ATTEMPT-002',
    newContextVersion: 'CTX-V4-RESTART-001',
    sourceDecisionId: rejected.receipt.decision.decisionId,
    inheritedEvidenceReceiptIds: rejected.receipt.decision.evidenceReceiptIds,
    receiptId: 'RCP-ATTEMPT-002',
  });
  assert.equal(restarted.case.caseId, rejected.case.caseId);
  assert.equal(restarted.case.attemptId, 'ATTEMPT-002');
  assert.equal(restarted.case.attemptLineage.rootAttemptId, pending.attemptId);
  assert.equal(restarted.case.attemptLineage.previousAttemptId, pending.attemptId);
  assert.equal(restarted.case.attemptLineage.sourceDecisionId, rejected.receipt.decision.decisionId);
  assert.deepEqual(restarted.case.attemptLineage.inheritedEvidenceReceiptIds, ['RCP-EVIDENCE-001']);
  assert.equal(restarted.receipt.status, 'succeeded');

  const vetoed = applyV4CreditDecision(pending, humanCommand(pending, 'veto_final'));
  assert.equal(vetoed.case.lifecycle.creditStatus, 'vetoed_final');
  assert.equal(vetoed.case.attemptLineage.status, 'final');
  expectCode(() => startV4AttemptAfterRejection({
    current: vetoed.case,
    newAttemptId: 'ATTEMPT-NEVER',
    newContextVersion: 'CTX-NEVER',
    sourceDecisionId: vetoed.receipt.decision.decisionId,
    inheritedEvidenceReceiptIds: ['RCP-EVIDENCE-001'],
    receiptId: 'RCP-NEVER',
  }), 'CASE_VETOED_FINAL');
});

test('V4-A-01/A-04: candidate authority is always none and cannot create formal success', () => {
  const current = v4Case('direct', 'standard');
  const candidate = createV4Candidate({
    candidateId: 'CANDIDATE-001',
    caseId: current.caseId,
    attemptId: current.attemptId,
    contextVersion: current.contextVersion,
    modelVersion: 'MODEL-001',
    rationale: '候选解释，不是决定',
    evidenceReceiptIds: ['RCP-EVIDENCE-001'],
  });
  assert.equal(candidate.authoritySource, 'candidate_model');
  assert.equal(candidate.authority, 'none');
  const before = structuredClone(current);
  expectCode(() => applyV4CreditDecision(current, {
    ...ruleCommand(current),
    authoritySource: 'candidate_model',
    candidate,
  }), 'CANDIDATE_HAS_NO_AUTHORITY');
  assert.deepEqual(current, before);
});

test('V4-A-02: authorized_rule fails closed unless version, scope, approval and rollback are complete', () => {
  const current = v4Case('direct', 'standard');
  for (const rule of [
    authorizedRule({ version: '' }),
    authorizedRule({ scope: { ...authorizedRule().scope, scopeId: '' } }),
    authorizedRule({ approval: { ...authorizedRule().approval, approvalId: '' } }),
    authorizedRule({ rollback: { ...authorizedRule().rollback, procedureRef: '' } }),
  ]) {
    expectCode(
      () => applyV4CreditDecision(current, ruleCommand(current, { rule })),
      'RULE_AUTHORIZATION_INVALID',
    );
  }
  expectCode(
    () => applyV4CreditDecision(current, ruleCommand(current, {
      rule: authorizedRule({
        scope: { ...authorizedRule().scope, businessModes: ['existing_return'] },
      }),
    })),
    'RULE_SCOPE_DENIED',
  );
  const exception = markV4PendingHumanReview(v4Case('direct', 'exception'));
  expectCode(
    () => applyV4CreditDecision(exception, ruleCommand(exception)),
    'RULE_SCOPE_DENIED',
  );
});

test('V4-A-03/A-06: confirmed_human requires a named Actor and an injectable policy without a hard-coded role matrix', () => {
  const current = markV4PendingHumanReview(v4Case());
  const observed = [];
  const result = applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    actor: { actorId: 'identity-from-upstream-001', displayName: '外部身份源具名人员' },
    policy(input) {
      observed.push({ actor: input.actor, action: input.action, caseId: input.case.caseId });
      return { outcome: 'allowed', policyVersion: 'INJECTED-POLICY-9' };
    },
  }));
  assert.deepEqual(observed, [{
    actor: { actorId: 'identity-from-upstream-001', displayName: '外部身份源具名人员' },
    action: 'approve_credit',
    caseId: current.caseId,
  }]);
  assert.equal(result.receipt.decision.policyVersion, 'INJECTED-POLICY-9');
  assert.equal(Object.hasOwn(result.receipt.decision, 'role'), false);
  expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    actor: { actorId: '', displayName: '' },
  })), 'INVALID_INPUT');
  expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    evidenceReceiptIds: [],
  })), 'INVALID_INPUT');
});

test('V4-A-05: denied, failure, timeout, unknown and stale Context all fail closed', () => {
  const current = markV4PendingHumanReview(v4Case());
  const before = structuredClone(current);
  const outcomes = [
    ['denied', 'ACTION_SCOPE_DENIED'],
    ['failure', 'POLICY_FAILURE'],
    ['timeout', 'POLICY_TIMEOUT'],
    ['unknown', 'POLICY_UNKNOWN'],
  ];
  for (const [outcome, code] of outcomes) {
    expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
      policy: () => ({ outcome, policyVersion: 'POLICY-V4-001' }),
    })), code);
  }
  expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    policy: () => { throw new Error('upstream policy unavailable'); },
  })), 'POLICY_FAILURE');
  expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    policy: () => undefined,
  })), 'POLICY_UNKNOWN');
  expectCode(() => applyV4CreditDecision(current, humanCommand(current, 'approve_credit', {
    contextVersion: 'CTX-STALE',
  })), 'STALE_CONTEXT');
  expectCode(() => resubmitV4Supplement({
    current: {
      ...current,
      lifecycle: { ...current.lifecycle, creditStatus: 'returned_for_supplement' },
    },
    expectedContextVersion: 'CTX-STALE',
    newContextVersion: 'CTX-V4-002',
    actor: ACTOR,
    evidenceReceiptIds: ['RCP-EVIDENCE-002'],
    receiptId: 'RCP-RESUBMIT-STALE',
  }), 'STALE_CONTEXT');
  assert.deepEqual(current, before);
});
