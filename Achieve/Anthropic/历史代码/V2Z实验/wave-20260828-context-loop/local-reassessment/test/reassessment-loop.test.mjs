import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ReassessmentLoopError,
  applyReassessmentCommand,
} from '../src/reassessment-loop.mjs';

function actor(type = 'HUMAN', actorId = 'human-credit-001', role = 'CREDIT_REVIEW') {
  return { type, actorId, role };
}

function openCommand(overrides = {}) {
  return {
    type: 'OPEN',
    loopId: 'loop-credit-to-dd-001',
    idempotencyKey: 'idem-open-credit-to-dd-001',
    sourceStage: 'CREDIT_REVIEW',
    targetStage: 'DUE_DILIGENCE',
    reason: '设备权属证据不足，需要补充核验',
    questions: ['设备当前权属人与发票主体是否一致？'],
    requiredEvidence: ['equipment-ownership-certificate'],
    affectedConclusionIds: ['credit-ownership-conclusion'],
    owner: actor('HUMAN', 'human-dd-001', 'DUE_DILIGENCE'),
    requestedBy: actor(),
    openedAt: '2026-08-28T10:00:00+08:00',
    ...overrides,
  };
}

function toOpenLoop(command, attempt = 1) {
  return {
    loopId: command.loopId,
    openIdempotencyKey: command.idempotencyKey,
    sourceStage: command.sourceStage,
    targetStage: command.targetStage,
    reason: command.reason,
    questions: [...command.questions],
    requiredEvidence: [...command.requiredEvidence],
    affectedConclusionIds: [...command.affectedConclusionIds],
    owner: { ...command.owner },
    requestedBy: { ...command.requestedBy },
    openedAt: command.openedAt,
    attempt,
    status: 'OPEN',
    closedAt: null,
    closedBy: null,
    resolution: null,
    closeIdempotencyKey: null,
    closeReceipt: null,
  };
}

function closeCommand(loopId = 'loop-credit-to-dd-001', overrides = {}) {
  return {
    type: 'CLOSE',
    loopId,
    idempotencyKey: `idem-close-${loopId}`,
    closedAt: '2026-08-28T11:00:00+08:00',
    closedBy: actor('HUMAN', 'human-credit-001', 'CREDIT_REVIEW'),
    resolution: '已收到并核验设备权属证明',
    closeReceipt: {
      receiptId: `receipt-${loopId}`,
      status: 'CONFIRMED',
      sourceSystem: 'synthetic-evidence-adapter',
      receivedAt: '2026-08-28T10:55:00+08:00',
      evidenceRefs: ['equipment-ownership-certificate'],
    },
    ...overrides,
  };
}

function toClosedLoop(open, close) {
  return {
    ...structuredClone(open),
    status: 'CLOSED',
    closedAt: close.closedAt,
    closedBy: { ...close.closedBy },
    resolution: close.resolution,
    closeIdempotencyKey: close.idempotencyKey,
    closeReceipt: structuredClone(close.closeReceipt),
  };
}

function makeInput(overrides = {}) {
  return {
    caseId: 'financing-lease-case-001',
    currentStage: 'CREDIT_REVIEW',
    loops: [],
    command: openCommand(),
    ...overrides,
  };
}

function assertLoopError(action, code) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected synchronous error');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ReassessmentLoopError);
  assert.equal(error.name, 'ReassessmentLoopError');
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

test('opens a local reassessment while preserving the macro stage', () => {
  const input = makeInput();
  const output = applyReassessmentCommand(input);
  const expectedLoop = toOpenLoop(input.command, 1);

  assert.equal(output instanceof Promise, false);
  assert.notEqual(typeof output?.then, 'function');
  assert.deepEqual(output, {
    schemaVersion: 'local-reassessment.lab.v0',
    caseId: input.caseId,
    status: 'OPENED',
    mainStage: 'CREDIT_REVIEW',
    loops: [expectedLoop],
    loop: expectedLoop,
    authority: {
      mainStageChanged: false,
      modelAuthority: 'NONE',
      automaticLooping: false,
      projectDecisionAuthority: 'NONE',
    },
  });
  assert.notStrictEqual(output.loop, output.loops[0]);
  assert.deepEqual(input.loops, []);
});

test('closes an open loop only with a human resolution and confirmed receipt', () => {
  const open = toOpenLoop(openCommand(), 1);
  const close = closeCommand(open.loopId);
  const input = makeInput({ loops: [open], command: close });
  const before = structuredClone(input);
  const output = applyReassessmentCommand(input);
  const expected = toClosedLoop(open, close);

  assert.equal(output.status, 'CLOSED');
  assert.equal(output.mainStage, 'CREDIT_REVIEW');
  assert.deepEqual(output.loop, expected);
  assert.deepEqual(output.loops, [expected]);
  assert.deepEqual(input, before);
});

test('open and close idempotent replay do not duplicate or re-close loops', () => {
  const openCommandValue = openCommand();
  const open = toOpenLoop(openCommandValue, 1);
  const openReplay = applyReassessmentCommand(makeInput({
    loops: [open],
    command: openCommandValue,
  }));
  assert.equal(openReplay.status, 'IDEMPOTENT_REPLAY');
  assert.equal(openReplay.loops.length, 1);

  const close = closeCommand(open.loopId);
  const closed = toClosedLoop(open, close);
  const closeReplay = applyReassessmentCommand(makeInput({
    loops: [closed],
    command: close,
  }));
  assert.equal(closeReplay.status, 'IDEMPOTENT_REPLAY');
  assert.equal(closeReplay.loops.length, 1);
  assert.deepEqual(closeReplay.loop, closed);
});

test('a close without resolution or confirmed receipt fails with zero mutation', () => {
  const open = toOpenLoop(openCommand(), 1);
  for (const command of [
    closeCommand(open.loopId, { resolution: '' }),
    closeCommand(open.loopId, {
      closeReceipt: {
        ...closeCommand(open.loopId).closeReceipt,
        status: 'UNKNOWN',
      },
    }),
  ]) {
    const input = makeInput({ loops: [open], command });
    const before = structuredClone(input);
    assertLoopError(() => applyReassessmentCommand(input), 'INVALID_INPUT');
    assert.deepEqual(input, before);
  }
});

test('model cannot open or close a loop with authority', () => {
  assertLoopError(
    () => applyReassessmentCommand(makeInput({
      command: openCommand({
        requestedBy: actor('MODEL', 'model-001', 'ADVISOR'),
      }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );

  const open = toOpenLoop(openCommand(), 1);
  assertLoopError(
    () => applyReassessmentCommand(makeInput({
      loops: [open],
      command: closeCommand(open.loopId, {
        closedBy: actor('MODEL', 'model-001', 'ADVISOR'),
      }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );
});

for (const [sourceStage, targetStage, currentStage] of [
  ['POLICY', 'OPPORTUNITY', 'POLICY'],
  ['CREDIT_REVIEW', 'POLICY', 'CREDIT_REVIEW'],
  ['ASSET', 'DUE_DILIGENCE', 'ASSET'],
  ['CREDIT_REVIEW', 'DUE_DILIGENCE', 'COMMERCIAL'],
]) {
  test(`invalid route/current-stage ${sourceStage}->${targetStage} at ${currentStage}`, () => {
    assertLoopError(
      () => applyReassessmentCommand(makeInput({
        currentStage,
        command: openCommand({ sourceStage, targetStage }),
      })),
      'INVALID_ROUTE',
    );
  });
}

test('an active same-route loop and a fourth attempt are bounded', () => {
  const active = toOpenLoop(openCommand(), 1);
  assertLoopError(
    () => applyReassessmentCommand(makeInput({
      loops: [active],
      command: openCommand({
        loopId: 'loop-second',
        idempotencyKey: 'idem-open-second',
      }),
    })),
    'ACTIVE_LOOP_EXISTS',
  );

  const closedLoops = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const openValue = openCommand({
      loopId: `loop-attempt-${attempt}`,
      idempotencyKey: `idem-open-attempt-${attempt}`,
      openedAt: `2026-08-28T0${attempt}:00:00Z`,
    });
    const openLoop = toOpenLoop(openValue, attempt);
    const closeValue = closeCommand(openValue.loopId, {
      idempotencyKey: `idem-close-attempt-${attempt}`,
      closedAt: `2026-08-28T0${attempt}:30:00Z`,
      closeReceipt: {
        receiptId: `receipt-attempt-${attempt}`,
        status: 'CONFIRMED',
        sourceSystem: 'synthetic-evidence-adapter',
        receivedAt: `2026-08-28T0${attempt}:20:00Z`,
        evidenceRefs: [`evidence-attempt-${attempt}`],
      },
    });
    closedLoops.push(toClosedLoop(openLoop, closeValue));
  }
  assertLoopError(
    () => applyReassessmentCommand(makeInput({
      loops: closedLoops,
      command: openCommand({ loopId: 'loop-attempt-4', idempotencyKey: 'idem-open-attempt-4' }),
    })),
    'LOOP_LIMIT_REACHED',
  );
});

test('duplicate IDs and idempotency conflicts are rejected', () => {
  const openValue = openCommand();
  const open = toOpenLoop(openValue, 1);
  assertLoopError(
    () => applyReassessmentCommand(makeInput({ loops: [open, structuredClone(open)] })),
    'DUPLICATE_ID',
  );

  assertLoopError(
    () => applyReassessmentCommand(makeInput({
      loops: [open],
      command: openCommand({ reason: '不同语义' }),
    })),
    'IDEMPOTENCY_CONFLICT',
  );
});

for (const [label, input] of [
  ['invalid stage', makeInput({ currentStage: 'UNKNOWN' })],
  ['invalid ISO time', makeInput({ command: openCommand({ openedAt: '2026-02-30T00:00:00Z' }) })],
  ['duplicate questions', makeInput({ command: openCommand({ questions: ['q', 'q'] }) })],
  ['duplicate evidence', makeInput({ command: openCommand({ requiredEvidence: ['e', 'e'] }) })],
  ['duplicate conclusions', makeInput({ command: openCommand({ affectedConclusionIds: ['c', 'c'] }) })],
  ['unknown field', makeInput({ command: { ...openCommand(), unexpected: true } })],
  ['reserved prototype field', makeInput({ command: { ...openCommand(), prototype: 'x' } })],
]) {
  test(`${label} is INVALID_INPUT`, () => {
    assertLoopError(() => applyReassessmentCommand(input), 'INVALID_INPUT');
  });
}

test('deeply frozen input works and output nested aliases are isolated', () => {
  const frozen = deepFreeze(makeInput());
  assert.doesNotThrow(() => applyReassessmentCommand(frozen));

  const input = makeInput();
  const output = applyReassessmentCommand(input);
  assert.notStrictEqual(output.loops, input.loops);
  assert.notStrictEqual(output.loop.questions, input.command.questions);
  output.loop.questions.push('output-only');
  assert.deepEqual(input.command.questions, ['设备当前权属人与发票主体是否一致？']);
  input.command.questions.push('input-only');
  assert.deepEqual(output.loop.questions, [
    '设备当前权属人与发票主体是否一致？',
    'output-only',
  ]);
});

test('__proto__ key is rejected without prototype pollution', () => {
  assert.equal(({}).polluted, undefined);
  const command = openCommand();
  Object.defineProperty(command, '__proto__', {
    value: { polluted: 'yes' },
    enumerable: true,
    configurable: true,
  });
  assertLoopError(
    () => applyReassessmentCommand(makeInput({ command })),
    'INVALID_INPUT',
  );
  assert.equal(Object.prototype.polluted, undefined);
});
