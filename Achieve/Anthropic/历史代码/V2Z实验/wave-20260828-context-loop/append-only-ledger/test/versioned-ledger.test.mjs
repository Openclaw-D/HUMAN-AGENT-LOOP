import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VersionedLedgerError,
  appendVersionedLedger,
} from '../src/versioned-ledger.mjs';

const STAGES = [
  'OPPORTUNITY',
  'DUE_DILIGENCE',
  'POLICY',
  'CREDIT_REVIEW',
  'COMMERCIAL',
  'ASSET',
];

function makeCommand(overrides = {}) {
  return {
    entryId: 'entry-customer-name-v1',
    idempotencyKey: 'idem-customer-name-v1',
    recordId: 'record-customer-name',
    kind: 'CLAIM',
    content: {
      value: '上海示例设备有限公司',
      evidenceRefs: ['evidence-site-note-001'],
    },
    source: {
      type: 'HUMAN',
      sourceId: 'source-business-interview',
    },
    recordedAt: '2026-08-28T09:30:00+08:00',
    subject: {
      type: 'HUMAN',
      subjectId: 'human-business-001',
      role: 'BUSINESS',
    },
    applicability: {
      stages: ['CREDIT_REVIEW', 'DUE_DILIGENCE', 'POLICY'],
      scopeRef: 'scope-whole-case',
    },
    previousEntryId: null,
    changeReason: '首次采集客户名称陈述',
    affectedConclusionIds: ['conclusion-policy', 'conclusion-credit'],
    ...overrides,
  };
}

function normalizedStages(stages) {
  return STAGES.filter((stage) => stages.includes(stage));
}

function toEntry(command, version) {
  return {
    entryId: command.entryId,
    idempotencyKey: command.idempotencyKey,
    recordId: command.recordId,
    kind: command.kind,
    content: {
      value: command.content.value,
      evidenceRefs: [...command.content.evidenceRefs],
    },
    source: { ...command.source },
    recordedAt: command.recordedAt,
    subject: { ...command.subject },
    applicability: {
      stages: normalizedStages(command.applicability.stages),
      scopeRef: command.applicability.scopeRef,
    },
    previousEntryId: command.previousEntryId,
    changeReason: command.changeReason,
    version,
    versionLabel: `V${version}`,
  };
}

function makeInput(overrides = {}) {
  return {
    caseId: 'financing-lease-case-001',
    ledger: [],
    command: makeCommand(),
    ...overrides,
  };
}

function assertLedgerError(action, code) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected synchronous error');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof VersionedLedgerError);
  assert.equal(error.name, 'VersionedLedgerError');
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

test('appends V1, normalizes stage order, and emits non-authoritative affected candidates', () => {
  const input = makeInput();
  const output = appendVersionedLedger(input);
  const expectedEntry = toEntry(input.command, 1);

  assert.equal(output instanceof Promise, false);
  assert.notEqual(typeof output?.then, 'function');
  assert.deepEqual(output, {
    schemaVersion: 'versioned-ledger.lab.v0',
    caseId: input.caseId,
    status: 'APPENDED',
    appendedEntry: expectedEntry,
    ledger: [expectedEntry],
    affectedConclusionCandidates: [
      {
        conclusionId: 'conclusion-credit',
        reason: 'LEDGER_VERSION_CHANGED',
        recordId: input.command.recordId,
        fromEntryId: null,
        toEntryId: input.command.entryId,
      },
      {
        conclusionId: 'conclusion-policy',
        reason: 'LEDGER_VERSION_CHANGED',
        recordId: input.command.recordId,
        fromEntryId: null,
        toEntryId: input.command.entryId,
      },
    ],
    authority: {
      modelAuthority: 'NONE',
      automaticConclusionRewrite: false,
      projectDecisionAuthority: 'NONE',
    },
  });
  assert.notStrictEqual(output.appendedEntry, output.ledger[0]);
  assert.deepEqual(input.ledger, []);
});

test('appends V2 without deleting or overwriting V1', () => {
  const v1Command = makeCommand();
  const v1 = toEntry(v1Command, 1);
  const v2Command = makeCommand({
    entryId: 'entry-customer-name-v2',
    idempotencyKey: 'idem-customer-name-v2',
    content: {
      value: '上海示例智能设备有限公司',
      evidenceRefs: ['evidence-license-002'],
    },
    recordedAt: '2026-08-28T10:00:00.123+08:00',
    previousEntryId: v1.entryId,
    changeReason: '营业执照核验后更新名称',
    affectedConclusionIds: ['conclusion-credit'],
  });
  const input = makeInput({ ledger: [v1], command: v2Command });
  const before = structuredClone(input);
  const output = appendVersionedLedger(input);

  assert.equal(output.status, 'APPENDED');
  assert.equal(output.appendedEntry.version, 2);
  assert.equal(output.appendedEntry.versionLabel, 'V2');
  assert.equal(output.appendedEntry.previousEntryId, v1.entryId);
  assert.deepEqual(output.ledger[0], v1);
  assert.deepEqual(output.ledger[1], toEntry(v2Command, 2));
  assert.deepEqual(input, before);
});

test('same idempotency key and semantics replay without appending or re-triggering candidates', () => {
  const command = makeCommand();
  const entry = toEntry(command, 1);
  const output = appendVersionedLedger(makeInput({ ledger: [entry], command }));

  assert.equal(output.status, 'IDEMPOTENT_REPLAY');
  assert.equal(output.ledger.length, 1);
  assert.deepEqual(output.appendedEntry, entry);
  assert.deepEqual(output.affectedConclusionCandidates, []);
});

test('same idempotency key with changed semantics fails closed', () => {
  const command = makeCommand();
  const input = makeInput({
    ledger: [toEntry(command, 1)],
    command: makeCommand({
      content: { value: '不同值', evidenceRefs: ['evidence-other'] },
    }),
  });
  const before = structuredClone(input);

  assertLedgerError(() => appendVersionedLedger(input), 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(input, before);
});

test('duplicate entry ID and invalid predecessor are rejected', () => {
  const command = makeCommand();
  const entry = toEntry(command, 1);
  assertLedgerError(
    () => appendVersionedLedger(makeInput({
      ledger: [entry],
      command: makeCommand({ idempotencyKey: 'idem-new' }),
    })),
    'DUPLICATE_ID',
  );
  assertLedgerError(
    () => appendVersionedLedger(makeInput({
      ledger: [entry],
      command: makeCommand({
        entryId: 'entry-v2',
        idempotencyKey: 'idem-v2',
        previousEntryId: 'not-latest',
      }),
    })),
    'VERSION_CONFLICT',
  );
});

test('existing ledger duplicate IDs and broken version chains are rejected', () => {
  const command = makeCommand();
  const entry = toEntry(command, 1);
  assertLedgerError(
    () => appendVersionedLedger(makeInput({ ledger: [entry, structuredClone(entry)] })),
    'DUPLICATE_ID',
  );

  const broken = { ...entry, version: 2, versionLabel: 'V2', previousEntryId: null };
  assertLedgerError(
    () => appendVersionedLedger(makeInput({ ledger: [broken] })),
    'INVALID_LEDGER_CHAIN',
  );
});

test('subject authority is explicit and model authority remains none', () => {
  const modelCommand = makeCommand({
    kind: 'MODEL_CANDIDATE',
    source: { type: 'MODEL', sourceId: 'model-risk-candidate' },
    subject: { type: 'MODEL', subjectId: 'model-001', role: 'ADVISOR' },
  });
  const modelOutput = appendVersionedLedger(makeInput({ command: modelCommand }));
  assert.equal(modelOutput.authority.modelAuthority, 'NONE');

  assertLedgerError(
    () => appendVersionedLedger(makeInput({
      command: makeCommand({
        kind: 'HUMAN_DECISION',
        source: { type: 'MODEL', sourceId: 'model-001' },
        subject: { type: 'MODEL', subjectId: 'model-001', role: 'ADVISOR' },
      }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );

  assertLedgerError(
    () => appendVersionedLedger(makeInput({
      command: makeCommand({ kind: 'EXTERNAL_RECEIPT' }),
    })),
    'UNAUTHORIZED_SUBJECT',
  );
});

for (const [label, input] of [
  ['unknown kind', makeInput({ command: makeCommand({ kind: 'FACT' }) })],
  ['invalid stage', makeInput({ command: makeCommand({ applicability: { stages: ['UNKNOWN_STAGE'], scopeRef: 'scope' } }) })],
  ['invalid ISO time', makeInput({ command: makeCommand({ recordedAt: '2026-02-30T10:00:00Z' }) })],
  ['duplicate evidence ref', makeInput({ command: makeCommand({ content: { value: 'x', evidenceRefs: ['e1', 'e1'] } }) })],
  ['duplicate affected conclusion', makeInput({ command: makeCommand({ affectedConclusionIds: ['c1', 'c1'] }) })],
  ['empty required string', makeInput({ command: makeCommand({ changeReason: '' }) })],
  ['unknown command field', makeInput({ command: { ...makeCommand(), unexpected: true } })],
  ['reserved constructor field', makeInput({ command: { ...makeCommand(), constructor: 'pollute' } })],
]) {
  test(`${label} is INVALID_INPUT`, () => {
    assertLedgerError(() => appendVersionedLedger(input), 'INVALID_INPUT');
  });
}

test('deeply frozen input works and output aliases are isolated in both directions', () => {
  const frozenInput = deepFreeze(makeInput());
  assert.doesNotThrow(() => appendVersionedLedger(frozenInput));

  const input = makeInput();
  const output = appendVersionedLedger(input);
  assert.notStrictEqual(output.ledger, input.ledger);
  assert.notStrictEqual(output.appendedEntry.content, input.command.content);
  assert.notStrictEqual(
    output.appendedEntry.content.evidenceRefs,
    input.command.content.evidenceRefs,
  );

  output.appendedEntry.content.evidenceRefs.push('output-only');
  assert.deepEqual(input.command.content.evidenceRefs, ['evidence-site-note-001']);
  input.command.content.evidenceRefs.push('input-only');
  assert.deepEqual(output.appendedEntry.content.evidenceRefs, [
    'evidence-site-note-001',
    'output-only',
  ]);
});

test('__proto__ key is rejected without prototype pollution', () => {
  assert.equal(({}).polluted, undefined);
  const command = makeCommand();
  Object.defineProperty(command, '__proto__', {
    value: { polluted: 'yes' },
    enumerable: true,
    configurable: true,
  });
  assertLedgerError(
    () => appendVersionedLedger(makeInput({ command })),
    'INVALID_INPUT',
  );
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
});
