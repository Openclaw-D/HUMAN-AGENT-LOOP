import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StageRollbackError,
  applyStageRollback,
} from '../src/stage-rollback.mjs';

function human(actorId = 'human-credit-001', role = 'CREDIT_REVIEW') {
  return { type: 'HUMAN', actorId, role };
}

function command(overrides = {}) {
  return {
    eventId: 'rollback-credit-to-dd-001',
    idempotencyKey: 'idem-rollback-credit-to-dd-001',
    targetStage: 'DUE_DILIGENCE',
    reason: '关键设备权属需要重新尽调',
    triggeredAt: '2026-08-28T12:00:00+08:00',
    triggeredBy: human(),
    ...overrides,
  };
}

function enteredEvent(overrides = {}) {
  return {
    eventId: 'entered-credit-001',
    idempotencyKey: 'idem-entered-credit-001',
    type: 'STAGE_ENTERED',
    fromStage: 'POLICY',
    toStage: 'CREDIT_REVIEW',
    reason: '政策产物齐备，进入信审',
    occurredAt: '2026-08-28T11:00:00+08:00',
    actor: human('human-credit-001', 'CREDIT_REVIEW'),
    ...overrides,
  };
}

function rollbackEvent(currentStage, value = command()) {
  return {
    eventId: value.eventId,
    idempotencyKey: value.idempotencyKey,
    type: 'STAGE_ROLLBACK',
    fromStage: currentStage,
    toStage: value.targetStage,
    reason: value.reason,
    occurredAt: value.triggeredAt,
    actor: { ...value.triggeredBy },
  };
}

function decision(overrides = {}) {
  return {
    decisionId: 'decision-opportunity-001',
    stage: 'OPPORTUNITY',
    decisionType: 'CREDIT',
    result: '候选客户值得继续尽调',
    decidedAt: '2026-08-28T08:00:00Z',
    decidedBy: human('human-business-001', 'BUSINESS'),
    ...overrides,
  };
}

function work(overrides = {}) {
  return {
    workId: 'work-commercial-001',
    stage: 'COMMERCIAL',
    status: 'OPEN',
    ownerId: 'human-commercial-001',
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    actionId: 'action-contract-effective-001',
    stage: 'COMMERCIAL',
    kind: 'CONTRACT_EFFECTIVE',
    receiptId: 'receipt-contract-effective-001',
    completedAt: '2026-08-28T13:00:00+08:00',
    ...overrides,
  };
}

function makeInput(overrides = {}) {
  return {
    caseId: 'financing-lease-case-001',
    currentStage: 'CREDIT_REVIEW',
    stageHistory: [enteredEvent()],
    decisions: [decision()],
    parallelWork: [],
    completedActions: [],
    command: command(),
    ...overrides,
  };
}

function assertRollbackError(actionFn, code) {
  let error;
  try {
    actionFn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected synchronous error');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof StageRollbackError);
  assert.equal(error.name, 'StageRollbackError');
  assert.equal(error.code, code);
  assert.equal(Object.getPrototypeOf(error.details), Object.prototype);
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('clean whole-stage rollback appends history and preserves all prior records', () => {
  const input = makeInput();
  const before = structuredClone(input);
  const expectedRollback = rollbackEvent(input.currentStage, input.command);
  const output = applyStageRollback(input);

  assert.equal(output instanceof Promise, false);
  assert.notEqual(typeof output?.then, 'function');
  assert.deepEqual(output, {
    schemaVersion: 'stage-rollback.lab.v0',
    caseId: input.caseId,
    status: 'APPLIED',
    previousStage: 'CREDIT_REVIEW',
    currentStage: 'DUE_DILIGENCE',
    stageHistory: [...before.stageHistory, expectedRollback],
    decisions: before.decisions,
    parallelWork: [],
    completedActions: [],
    rollbackEvent: expectedRollback,
    conflicts: [],
    requiresHumanResolution: false,
    authority: {
      modelAuthority: 'NONE',
      automaticExternalReversal: false,
      projectDecisionAuthority: 'NONE',
      candidateOnly: true,
    },
  });
  assert.notStrictEqual(output.rollbackEvent, output.stageHistory.at(-1));
  assert.deepEqual(input, before);
});

test('commercial rollback exposes parallel, decision, and completed-action conflicts and fails closed', () => {
  const commercialEntered = enteredEvent({
    eventId: 'entered-commercial-001',
    idempotencyKey: 'idem-entered-commercial-001',
    fromStage: 'CREDIT_REVIEW',
    toStage: 'COMMERCIAL',
    reason: '信审决定完成，进入商务',
  });
  const downstreamDecision = decision({
    decisionId: 'decision-credit-001',
    stage: 'CREDIT_REVIEW',
    decisionType: 'CREDIT',
    result: '附条件通过候选',
  });
  const input = makeInput({
    currentStage: 'COMMERCIAL',
    stageHistory: [commercialEntered],
    decisions: [downstreamDecision],
    parallelWork: [work()],
    completedActions: [action()],
    command: command({
      eventId: 'rollback-commercial-to-dd-001',
      idempotencyKey: 'idem-rollback-commercial-to-dd-001',
    }),
  });
  const before = structuredClone(input);
  const output = applyStageRollback(input);

  assert.equal(output.status, 'BLOCKED_BY_CONFLICTS');
  assert.equal(output.currentStage, 'COMMERCIAL');
  assert.equal(output.requiresHumanResolution, true);
  assert.deepEqual(output.conflicts, [
    { type: 'OPEN_PARALLEL_WORK', refId: 'work-commercial-001', stage: 'COMMERCIAL' },
    { type: 'PRESERVED_DOWNSTREAM_DECISION', refId: 'decision-credit-001', stage: 'CREDIT_REVIEW' },
    { type: 'COMPLETED_COMMERCIAL_ACTION', refId: 'action-contract-effective-001', stage: 'COMMERCIAL' },
  ]);
  assert.deepEqual(output.stageHistory, before.stageHistory);
  assert.deepEqual(output.decisions, before.decisions);
  assert.deepEqual(output.completedActions, before.completedActions);
  assert.deepEqual(input, before);
});

test('asset rollback exposes active asset period and downstream external actions', () => {
  const assetEntered = enteredEvent({
    eventId: 'entered-asset-001',
    idempotencyKey: 'idem-entered-asset-001',
    fromStage: 'COMMERCIAL',
    toStage: 'ASSET',
    reason: '正式起租后进入资产存续',
  });
  const assetAction = action({
    actionId: 'action-collection-001',
    stage: 'ASSET',
    kind: 'COLLECTION_ESCALATION',
    receiptId: 'receipt-collection-001',
  });
  const input = makeInput({
    currentStage: 'ASSET',
    stageHistory: [assetEntered],
    decisions: [],
    completedActions: [assetAction],
    command: command({
      eventId: 'rollback-asset-to-policy-001',
      idempotencyKey: 'idem-rollback-asset-to-policy-001',
      targetStage: 'POLICY',
    }),
  });
  const output = applyStageRollback(input);

  assert.equal(output.status, 'BLOCKED_BY_CONFLICTS');
  assert.deepEqual(output.conflicts, [
    { type: 'ASSET_PERIOD_ACTIVE', refId: input.caseId, stage: 'ASSET' },
    { type: 'COMPLETED_DOWNSTREAM_ACTION', refId: 'action-collection-001', stage: 'ASSET' },
  ]);
  assert.equal(output.currentStage, 'ASSET');
  assert.equal(output.authority.automaticExternalReversal, false);
});

test('same rollback command replays idempotently without another history event', () => {
  const value = command();
  const existingRollback = rollbackEvent('CREDIT_REVIEW', value);
  const input = makeInput({
    currentStage: 'DUE_DILIGENCE',
    stageHistory: [existingRollback],
    command: value,
  });
  const output = applyStageRollback(input);

  assert.equal(output.status, 'IDEMPOTENT_REPLAY');
  assert.equal(output.stageHistory.length, 1);
  assert.deepEqual(output.rollbackEvent, existingRollback);
  assert.deepEqual(output.conflicts, []);
});

test('same idempotency key with different semantics and duplicate event IDs fail', () => {
  const value = command();
  const existingRollback = rollbackEvent('CREDIT_REVIEW', value);
  assertRollbackError(
    () => applyStageRollback(makeInput({
      currentStage: 'DUE_DILIGENCE',
      stageHistory: [existingRollback],
      command: command({ reason: '不同原因' }),
    })),
    'IDEMPOTENCY_CONFLICT',
  );
  assertRollbackError(
    () => applyStageRollback(makeInput({
      stageHistory: [enteredEvent({ eventId: value.eventId })],
      command: command({ idempotencyKey: 'different-key' }),
    })),
    'DUPLICATE_ID',
  );
});

test('model cannot trigger whole-stage rollback', () => {
  assertRollbackError(
    () => applyStageRollback(makeInput({
      command: command({
        triggeredBy: { type: 'MODEL', actorId: 'model-001', role: 'ADVISOR' },
      }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );
});

for (const [label, input] of [
  ['same-stage target', makeInput({ command: command({ targetStage: 'CREDIT_REVIEW' }) })],
  ['forward target', makeInput({ command: command({ targetStage: 'COMMERCIAL' }) })],
  ['unknown target', makeInput({ command: command({ targetStage: 'UNKNOWN' }) })],
]) {
  test(`${label} is rejected as invalid rollback`, () => {
    assertRollbackError(() => applyStageRollback(input), label === 'unknown target' ? 'INVALID_INPUT' : 'INVALID_ROLLBACK');
  });
}

for (const [label, input, code] of [
  ['invalid ISO time', makeInput({ command: command({ triggeredAt: '2026-02-30T00:00:00Z' }) }), 'INVALID_INPUT'],
  ['duplicate decision ID', makeInput({ decisions: [decision(), structuredClone(decision())] }), 'DUPLICATE_ID'],
  ['history mismatch', makeInput({ stageHistory: [enteredEvent({ toStage: 'POLICY' })] }), 'INVALID_HISTORY'],
  ['unknown command field', makeInput({ command: { ...command(), unexpected: true } }), 'INVALID_INPUT'],
  ['reserved constructor field', makeInput({ command: { ...command(), constructor: 'x' } }), 'INVALID_INPUT'],
]) {
  test(`${label} fails with ${code}`, () => {
    assertRollbackError(() => applyStageRollback(input), code);
  });
}

test('deeply frozen input works and all returned history structures are cloned', () => {
  const frozen = deepFreeze(makeInput());
  assert.doesNotThrow(() => applyStageRollback(frozen));

  const input = makeInput();
  const output = applyStageRollback(input);
  assert.notStrictEqual(output.stageHistory, input.stageHistory);
  assert.notStrictEqual(output.decisions, input.decisions);
  assert.notStrictEqual(output.decisions[0], input.decisions[0]);
  output.decisions[0].result = 'output-only';
  assert.equal(input.decisions[0].result, '候选客户值得继续尽调');
  input.decisions[0].result = 'input-only';
  assert.equal(output.decisions[0].result, 'output-only');
});

test('__proto__ key is rejected without prototype pollution', () => {
  assert.equal(({}).polluted, undefined);
  const value = command();
  Object.defineProperty(value, '__proto__', {
    value: { polluted: 'yes' },
    enumerable: true,
    configurable: true,
  });
  assertRollbackError(
    () => applyStageRollback(makeInput({ command: value })),
    'INVALID_INPUT',
  );
  assert.equal(Object.prototype.polluted, undefined);
});
