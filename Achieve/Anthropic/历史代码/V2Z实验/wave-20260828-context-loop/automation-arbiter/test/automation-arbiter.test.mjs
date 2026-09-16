import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AutomationArbiterError,
  arbitrateAutomation,
} from '../src/automation-arbiter.mjs';

function step(overrides = {}) {
  return {
    stepId: 'step-extract-equipment-info-001',
    kind: 'INFORMATION_EXTRACTION',
    evidenceStatus: 'COMPLETE',
    evidenceRefs: ['synthetic-device-photo-001'],
    permissionStatus: 'AUTHORIZED',
    policyStatus: 'CLEAR',
    externalReceiptRequirement: 'NOT_REQUIRED',
    externalReceiptStatus: 'NOT_REQUIRED',
    humanInputRequired: false,
    requestedBy: {
      type: 'SYSTEM',
      subjectId: 'system-orchestrator-001',
      role: 'ORCHESTRATOR',
      claimedAuthority: 'EXECUTE',
    },
    modelConfidence: null,
    ...overrides,
  };
}

function makeInput(overrides = {}) {
  return {
    caseId: 'financing-lease-case-001',
    evaluatedAt: '2026-08-28T14:00:00+08:00',
    stage: 'DUE_DILIGENCE',
    step: step(),
    ...overrides,
  };
}

function assertArbiterError(action, code) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected synchronous error');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof AutomationArbiterError);
  assert.equal(error.name, 'AutomationArbiterError');
  assert.equal(error.code, code);
  assert.equal(Object.getPrototypeOf(error.details), Object.prototype);
  return error;
}

function expectedBase(input, overrides = {}) {
  return {
    schemaVersion: 'automation-arbiter.lab.v0',
    caseId: input.caseId,
    evaluatedAt: input.evaluatedAt,
    stage: input.stage,
    stepId: input.step.stepId,
    disposition: 'AUTO',
    reasons: ['LOW_RISK_DETERMINISTIC_AUTOMATION'],
    consideredEvidenceRefs: [...input.step.evidenceRefs],
    requiredHumanGate: null,
    authority: {
      modelAuthority: 'NONE',
      projectDecisionAuthority: 'NONE',
      externalActionCompleted: false,
      deterministicRuleOnly: true,
    },
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('low-risk deterministic work returns AUTO without business authority', () => {
  const input = makeInput();
  const output = arbitrateAutomation(input);
  assert.equal(output instanceof Promise, false);
  assert.notEqual(typeof output?.then, 'function');
  assert.deepEqual(output, expectedBase(input));
});

test('non-authoritative missing human input returns ASK_HUMAN', () => {
  const input = makeInput({
    step: step({ kind: 'DRAFTING', humanInputRequired: true }),
  });
  assert.deepEqual(arbitrateAutomation(input), expectedBase(input, {
    disposition: 'ASK_HUMAN',
    reasons: ['HUMAN_INPUT_REQUIRED'],
  }));
});

for (const [kind, gateType, role, reason] of [
  ['POLICY_EXCEPTION', 'POLICY_EXCEPTION_OR_RULE_CONFLICT', 'POLICY', 'POLICY_HUMAN_GATE'],
  ['RULE_CONFLICT', 'POLICY_EXCEPTION_OR_RULE_CONFLICT', 'POLICY', 'POLICY_HUMAN_GATE'],
  ['FINAL_CREDIT_DECISION', 'FINAL_CREDIT_DECISION_OR_TERMS', 'CREDIT_REVIEW', 'CREDIT_HUMAN_GATE'],
  ['CORE_CREDIT_TERMS', 'FINAL_CREDIT_DECISION_OR_TERMS', 'CREDIT_REVIEW', 'CREDIT_HUMAN_GATE'],
  ['CONTRACT_EFFECTIVE', 'COMMERCIAL_ACTIVATION', 'COMMERCIAL', 'COMMERCIAL_HUMAN_GATE'],
  ['FUND_DISBURSEMENT', 'COMMERCIAL_ACTIVATION', 'COMMERCIAL', 'COMMERCIAL_HUMAN_GATE'],
  ['LEASE_START', 'COMMERCIAL_ACTIVATION', 'COMMERCIAL', 'COMMERCIAL_HUMAN_GATE'],
  ['COLLECTION_ESCALATION', 'ASSET_HIGH_IMPACT_ACTION', 'ASSET', 'ASSET_HUMAN_GATE'],
  ['RESTRUCTURING', 'ASSET_HIGH_IMPACT_ACTION', 'ASSET', 'ASSET_HUMAN_GATE'],
  ['LITIGATION', 'ASSET_HIGH_IMPACT_ACTION', 'ASSET', 'ASSET_HUMAN_GATE'],
  ['ASSET_DISPOSAL', 'ASSET_HIGH_IMPACT_ACTION', 'ASSET', 'ASSET_HUMAN_GATE'],
]) {
  test(`${kind} always returns its named Human Gate`, () => {
    const input = makeInput({ step: step({ kind }) });
    assert.deepEqual(arbitrateAutomation(input), expectedBase(input, {
      disposition: 'HUMAN_GATE',
      reasons: [reason],
      requiredHumanGate: { gateType, requiredRole: role },
    }));
  });
}

test('policy exception on an otherwise low-risk step has gate priority', () => {
  const input = makeInput({
    step: step({ kind: 'ROUTING', policyStatus: 'EXCEPTION' }),
  });
  const output = arbitrateAutomation(input);
  assert.equal(output.disposition, 'HUMAN_GATE');
  assert.deepEqual(output.reasons, ['POLICY_HUMAN_GATE']);
  assert.deepEqual(output.requiredHumanGate, {
    gateType: 'POLICY_EXCEPTION_OR_RULE_CONFLICT',
    requiredRole: 'POLICY',
  });
});

test('missing, conflicting, unknown evidence and permission fail closed in fixed reason order', () => {
  const input = makeInput({
    step: step({
      evidenceStatus: 'CONFLICT',
      permissionStatus: 'UNKNOWN',
      policyStatus: 'UNKNOWN',
      externalReceiptRequirement: 'REQUIRED',
      externalReceiptStatus: 'UNKNOWN',
    }),
  });
  const output = arbitrateAutomation(input);
  assert.equal(output.disposition, 'BLOCK');
  assert.deepEqual(output.reasons, [
    'EVIDENCE_CONFLICT',
    'PERMISSION_UNKNOWN',
    'POLICY_UNKNOWN',
    'RECEIPT_UNKNOWN',
  ]);
  assert.equal(output.requiredHumanGate, null);
  assert.equal(output.authority.externalActionCompleted, false);
});

for (const [label, overrides, expectedReason] of [
  ['missing evidence', { evidenceStatus: 'MISSING' }, 'EVIDENCE_MISSING'],
  ['unknown evidence', { evidenceStatus: 'UNKNOWN' }, 'EVIDENCE_UNKNOWN'],
  ['unauthorized permission', { permissionStatus: 'UNAUTHORIZED' }, 'PERMISSION_UNAUTHORIZED'],
  ['missing required receipt', { externalReceiptRequirement: 'REQUIRED', externalReceiptStatus: 'MISSING' }, 'RECEIPT_MISSING'],
  ['invalid receipt state', { externalReceiptRequirement: 'REQUIRED', externalReceiptStatus: 'NOT_REQUIRED' }, 'RECEIPT_STATE_INVALID'],
]) {
  test(`${label} returns BLOCK`, () => {
    const input = makeInput({ step: step(overrides) });
    const output = arbitrateAutomation(input);
    assert.equal(output.disposition, 'BLOCK');
    assert.ok(output.reasons.includes(expectedReason));
  });
}

test('model confidence cannot grant authority or bypass a Human Gate', () => {
  const input = makeInput({
    stage: 'CREDIT_REVIEW',
    step: step({
      kind: 'FINAL_CREDIT_DECISION',
      requestedBy: {
        type: 'MODEL',
        subjectId: 'model-001',
        role: 'ADVISOR',
        claimedAuthority: 'NONE',
      },
      modelConfidence: 1,
    }),
  });
  const output = arbitrateAutomation(input);
  assert.equal(output.disposition, 'HUMAN_GATE');
  assert.equal(output.authority.modelAuthority, 'NONE');
  assert.equal(output.authority.projectDecisionAuthority, 'NONE');
});

test('model claiming execute authority is rejected before arbitration', () => {
  assertArbiterError(
    () => arbitrateAutomation(makeInput({
      step: step({
        requestedBy: {
          type: 'MODEL',
          subjectId: 'model-001',
          role: 'ADVISOR',
          claimedAuthority: 'EXECUTE',
        },
      }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );
});

test('pure deterministic arbitration is idempotent and does not mutate frozen input', () => {
  const input = deepFreeze(makeInput());
  const first = arbitrateAutomation(input);
  const second = arbitrateAutomation(input);
  assert.deepEqual(first, second);
});

test('considered evidence is deeply isolated from input', () => {
  const input = makeInput();
  const output = arbitrateAutomation(input);
  assert.notStrictEqual(output.consideredEvidenceRefs, input.step.evidenceRefs);
  output.consideredEvidenceRefs.push('output-only');
  assert.deepEqual(input.step.evidenceRefs, ['synthetic-device-photo-001']);
  input.step.evidenceRefs.push('input-only');
  assert.deepEqual(output.consideredEvidenceRefs, [
    'synthetic-device-photo-001',
    'output-only',
  ]);
});

for (const [label, input, code] of [
  ['invalid stage', makeInput({ stage: 'UNKNOWN' }), 'INVALID_INPUT'],
  ['invalid kind', makeInput({ step: step({ kind: 'APPROVE_PROJECT' }) }), 'INVALID_INPUT'],
  ['invalid ISO time', makeInput({ evaluatedAt: '2026-02-30T00:00:00Z' }), 'INVALID_INPUT'],
  ['invalid confidence', makeInput({ step: step({ modelConfidence: 1.1 }) }), 'INVALID_INPUT'],
  ['duplicate evidence ID', makeInput({ step: step({ evidenceRefs: ['e1', 'e1'] }) }), 'DUPLICATE_ID'],
  ['unknown field', makeInput({ step: { ...step(), unexpected: true } }), 'INVALID_INPUT'],
  ['reserved prototype field', makeInput({ step: { ...step(), prototype: 'x' } }), 'INVALID_INPUT'],
]) {
  test(`${label} fails with ${code}`, () => {
    assertArbiterError(() => arbitrateAutomation(input), code);
  });
}

test('__proto__ key is rejected without prototype pollution', () => {
  assert.equal(({}).polluted, undefined);
  const stepValue = step();
  Object.defineProperty(stepValue, '__proto__', {
    value: { polluted: 'yes' },
    enumerable: true,
    configurable: true,
  });
  assertArbiterError(
    () => arbitrateAutomation(makeInput({ step: stepValue })),
    'INVALID_INPUT',
  );
  assert.equal(Object.prototype.polluted, undefined);
});
