import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAuthorityEvent,
  getAuthorityEvent,
  getAuthorityEventCount,
  listAuthorityEvents,
  resetAuthorityEventLedger,
} from '../lib/authority-event-ledger.ts';

const ALL_EVENT_TYPES = [
  'EVIDENCE_ACCEPTED',
  'FACT_CONFIRMED',
  'HUMAN_DECISION_RECORDED',
  'MESSAGE_RECEIVED',
  'CANDIDATE_ANSWER_RECORDED',
  'STAGE_RUNS_STARTED',
];

function makeInput(eventId, overrides = {}) {
  return {
    eventId,
    caseId: 'FL-DEMO-001',
    type: 'EVIDENCE_ACCEPTED',
    actor: { kind: 'system', id: 'intake-agent', authority: 'none' },
    correlationId: `corr-${eventId}`,
    causationId: `cause-${eventId}`,
    contextVersion: 'CTX-0001',
    payload: { source: 'synthetic', title: 'nameplate' },
    ...overrides,
  };
}

function assertThrowsCode(operation, code, message) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  }, message);
}

test.beforeEach(() => {
  resetAuthorityEventLedger();
});

test('accepts all six event types with monotonic sequences and ISO timestamps', () => {
  const actors = [
    { kind: 'system', id: 'evidence-agent', authority: 'none' },
    { kind: 'human', id: '张工', authority: 'confirmed' },
    { kind: 'human', id: '李工', authority: 'none' },
    { kind: 'system', id: 'message-agent', authority: 'none' },
    { kind: 'agent', id: 'answer-agent', authority: 'none' },
    { kind: 'system', id: 'stage-agent', authority: 'none' },
  ];

  const events = ALL_EVENT_TYPES.map((type, index) => {
    const event = appendAuthorityEvent(makeInput(`event-${index + 1}`, {
      type,
      actor: actors[index],
    }));
    assert.equal(event.sequence, index + 1);
    assert.equal(event.caseId, 'FL-DEMO-001');
    assert.equal(event.type, type);
    assert.equal(Number.isNaN(Date.parse(event.recordedAt)), false);
    assert.match(event.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    return event;
  });

  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(getAuthorityEvent('event-4')?.type, 'MESSAGE_RECEIVED');
  assert.equal(getAuthorityEventCount(), 6);
  assert.equal(getAuthorityEvent('missing') === undefined, true);
});

test('enforces actor shape and authority constraints', () => {
  assert.equal(
    appendAuthorityEvent(makeInput('human-confirmed', {
      actor: { kind: 'human', id: ' 王审 ', authority: 'confirmed' },
    })).actor.id,
    '王审',
  );
  assert.equal(
    appendAuthorityEvent(makeInput('human-none', {
      actor: { kind: 'human', id: '赵工', authority: 'none' },
    })).actor.authority,
    'none',
  );
  assert.equal(
    appendAuthorityEvent(makeInput('agent-none', {
      actor: { kind: 'agent', id: 'agent', authority: 'none' },
    })).actor.authority,
    'none',
  );

  const invalidActors = [
    undefined,
    null,
    'system',
    { kind: 'robot', id: 'actor', authority: 'none' },
    { kind: 'system', id: 'actor', authority: 'confirmed' },
    { kind: 'agent', id: 'actor', authority: 'confirmed' },
    { kind: 'human', id: '', authority: 'confirmed' },
    { kind: 'human', id: 'x'.repeat(81), authority: 'none' },
    { kind: 'human', id: 'actor' },
    { kind: 'human', id: 'actor', authority: 'none', extra: 'no' },
  ];
  for (const [index, actor] of invalidActors.entries()) {
    assertThrowsCode(
      () => appendAuthorityEvent(makeInput(`bad-actor-${index}`, { actor })),
      'INVALID_ACTOR',
    );
  }
});

test('follows the frozen validation priority', () => {
  const invalidEverywhere = makeInput('priority', {
    caseId: 'OTHER',
    eventId: '  ',
    type: 'UNKNOWN',
    actor: { kind: 'system', id: '', authority: 'confirmed' },
    correlationId: '',
    causationId: '',
    contextVersion: 'BAD',
    payload: { value: 1 },
  });
  assertThrowsCode(() => appendAuthorityEvent(invalidEverywhere), 'CASE_NOT_FOUND');

  const cases = [
    ['INVALID_EVENT_ID', { eventId: '' }],
    ['INVALID_EVENT_TYPE', { eventId: 'priority-event', type: 'BAD_TYPE' }],
    ['INVALID_ACTOR', { eventId: 'priority-event', type: 'FACT_CONFIRMED', actor: null }],
    ['INVALID_CORRELATION_ID', { eventId: 'priority-event', type: 'FACT_CONFIRMED', actor: { kind: 'human', id: '人员', authority: 'confirmed' }, correlationId: ' ' }],
    ['INVALID_CAUSATION_ID', { eventId: 'priority-event', type: 'FACT_CONFIRMED', actor: { kind: 'human', id: '人员', authority: 'confirmed' }, correlationId: 'corr', causationId: '' }],
    ['INVALID_CONTEXT_VERSION', { eventId: 'priority-event', type: 'FACT_CONFIRMED', actor: { kind: 'human', id: '人员', authority: 'confirmed' }, correlationId: 'corr', causationId: 'cause', contextVersion: 'CTX-001' }],
    ['INVALID_PAYLOAD', { eventId: 'priority-event', type: 'FACT_CONFIRMED', actor: { kind: 'human', id: '人员', authority: 'confirmed' }, correlationId: 'corr', causationId: 'cause', contextVersion: 'CTX-0001', payload: [] }],
  ];
  for (const [code, overrides] of cases) {
    assertThrowsCode(
      () => appendAuthorityEvent(makeInput('priority-event', {
        type: 'BAD_TYPE',
        actor: null,
        correlationId: '',
        causationId: '',
        contextVersion: 'BAD',
        payload: null,
        ...overrides,
      })),
      code,
    );
  }
});

test('same event id and normalized payload replays, while conflicts and failures do not advance', () => {
  const originalInput = makeInput(' replay-1 ', {
    payload: { b: 'second', a: 'first' },
  });
  const first = appendAuthorityEvent(originalInput);

  originalInput.payload.a = 'changed after append';
  originalInput.actor.id = 'changed actor';
  const replayInput = makeInput('replay-1', {
    correlationId: 'corr- replay-1 ',
    causationId: 'cause- replay-1 ',
    payload: { a: 'first', b: 'second' },
  });
  const replay = appendAuthorityEvent(replayInput);

  assert.deepEqual(replay, first);
  assert.equal(replay.sequence, 1);
  assert.equal(replay.recordedAt, first.recordedAt);
  assert.equal(first.payload.a, 'first');
  assert.equal(first.actor.id, 'intake-agent');

  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('replay-1', { payload: { a: 'first' } })),
    'EVENT_ID_CONFLICT',
  );
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('invalid-new', { payload: { count: 1 } })),
    'INVALID_PAYLOAD',
  );

  const next = appendAuthorityEvent(makeInput('valid-next'));
  assert.equal(next.sequence, 2);
  assert.equal(listAuthorityEvents({ caseId: 'FL-DEMO-001' }).items.length, 2);
});

test('normalizes whitespace and key order for exact event replay', () => {
  const first = appendAuthorityEvent(makeInput(' identity-1 ', {
    actor: { kind: 'human', id: '  审核人员  ', authority: 'confirmed' },
    correlationId: '  correlation-1  ',
    causationId: '  causation-1  ',
    contextVersion: '  CTX-0001  ',
    payload: { b: 'second', a: 'first' },
  }));

  const replayInput = {
    contextVersion: 'CTX-0001',
    causationId: ' causation-1 ',
    payload: { a: 'first', b: 'second' },
    correlationId: ' correlation-1 ',
    actor: { authority: 'confirmed', id: '审核人员', kind: 'human' },
    type: 'EVIDENCE_ACCEPTED',
    caseId: 'FL-DEMO-001',
    eventId: 'identity-1',
  };
  const replay = appendAuthorityEvent(replayInput);

  assert.deepEqual(replay, first);
  assert.equal(listAuthorityEvents({ caseId: 'FL-DEMO-001' }).items.length, 1);
  assert.equal(appendAuthorityEvent(makeInput('identity-next')).sequence, 2);
});

test('every canonical identity field conflicts independently without advancing sequence', () => {
  appendAuthorityEvent(makeInput('identity-fields', {
    type: 'EVIDENCE_ACCEPTED',
    actor: { kind: 'human', id: '人员', authority: 'confirmed' },
    correlationId: 'correlation',
    causationId: 'causation',
    contextVersion: 'CTX-0001',
    payload: { a: 'first', b: 'second' },
  }));

  const conflictingInputs = [
    ['type', { type: 'FACT_CONFIRMED' }],
    ['actor kind', { actor: { kind: 'system', id: '人员', authority: 'none' } }],
    ['actor id', { actor: { kind: 'human', id: '另一个人', authority: 'confirmed' } }],
    ['actor authority', { actor: { kind: 'human', id: '人员', authority: 'none' } }],
    ['correlationId', { correlationId: 'another-correlation' }],
    ['causationId', { causationId: 'another-causation' }],
    ['contextVersion value', { contextVersion: 'CTX-0002' }],
    ['payload value', { payload: { a: 'changed', b: 'second' } }],
  ];

  for (const [label, overrides] of conflictingInputs) {
    assertThrowsCode(
      () => appendAuthorityEvent(makeInput('identity-fields', overrides)),
      'EVENT_ID_CONFLICT',
      `${label} must conflict`,
    );
    assert.equal(
      listAuthorityEvents({ caseId: 'FL-DEMO-001' }).items.length,
      1,
      `${label} conflict must not append`,
    );
  }

  assert.equal(getAuthorityEvent('identity-fields').contextVersion, 'CTX-0001');
});

test('conflicts compare contextVersion presence and failures do not advance sequence', () => {
  const first = appendAuthorityEvent(makeInput('context-presence', {
    correlationId: 'corr-context-presence',
    causationId: 'cause-context-presence',
  }));
  assert.equal(first.contextVersion, 'CTX-0001');

  const replayWithoutContext = makeInput('context-presence', {
    correlationId: 'corr-context-presence',
    causationId: 'cause-context-presence',
  });
  delete replayWithoutContext.contextVersion;
  assertThrowsCode(
    () => appendAuthorityEvent(replayWithoutContext),
    'EVENT_ID_CONFLICT',
  );

  const invalidNext = makeInput('invalid-next', { payload: { invalid: true } });
  assertThrowsCode(() => appendAuthorityEvent(invalidNext), 'INVALID_PAYLOAD');
  assert.equal(listAuthorityEvents({ caseId: 'FL-DEMO-001' }).items.length, 1);

  const next = appendAuthorityEvent(makeInput('valid-after-conflicts'));
  assert.equal(next.sequence, 2);
});

test('paginates in ascending sequence order with exact boundaries', () => {
  for (let index = 1; index <= 5; index += 1) {
    appendAuthorityEvent(makeInput(`page-${index}`));
  }

  const page1 = listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: 0, limit: 2 });
  assert.deepEqual(page1.items.map((event) => event.sequence), [1, 2]);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextCursor, 2);

  const page2 = listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: page1.nextCursor, limit: 2 });
  assert.deepEqual(page2.items.map((event) => event.sequence), [3, 4]);
  assert.equal(page2.nextCursor, 4);

  const page3 = listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: page2.nextCursor, limit: 2 });
  assert.deepEqual(page3.items.map((event) => event.sequence), [5]);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.nextCursor, null);

  const empty = listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: 999 });
  assert.deepEqual(empty, { items: [], nextCursor: null, hasMore: false });

  const defaults = listAuthorityEvents({ caseId: 'FL-DEMO-001' });
  assert.equal(defaults.items.length, 5);

  assertThrowsCode(() => listAuthorityEvents({ caseId: 'FL-DEMO-001', limit: 0 }), 'INVALID_LIMIT');
  assertThrowsCode(() => listAuthorityEvents({ caseId: 'FL-DEMO-001', limit: 101 }), 'INVALID_LIMIT');
  assertThrowsCode(() => listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: -1 }), 'INVALID_AFTER_SEQUENCE');
  assertThrowsCode(() => listAuthorityEvents({ caseId: 'FL-DEMO-001', afterSequence: 1.5 }), 'INVALID_AFTER_SEQUENCE');
  assertThrowsCode(() => listAuthorityEvents({ caseId: 'OTHER' }), 'CASE_NOT_FOUND');
});

test('clones inputs and outputs and resists nested mutation', () => {
  const input = makeInput('clone-event', {
    actor: { kind: 'human', id: '原始人员', authority: 'confirmed' },
  });
  const appended = appendAuthorityEvent(input);

  input.eventId = 'changed';
  input.actor.id = 'changed';
  input.payload.title = 'changed';
  appended.actor.id = 'output changed';
  appended.payload.source = 'output changed';
  appended.caseId = 'changed';

  const stored = getAuthorityEvent('clone-event');
  assert.equal(stored.actor.id, '原始人员');
  assert.equal(stored.payload.source, 'synthetic');
  assert.equal(stored.payload.title, 'nameplate');
  assert.equal(stored.caseId, 'FL-DEMO-001');

  stored.actor.id = 'query changed';
  stored.payload.title = 'query changed';
  assert.equal(getAuthorityEvent('clone-event').actor.id, '原始人员');
  assert.equal(getAuthorityEvent('clone-event').payload.title, 'nameplate');

  const page = listAuthorityEvents({ caseId: 'FL-DEMO-001' });
  page.items[0].payload.source = 'page changed';
  assert.equal(listAuthorityEvents({ caseId: 'FL-DEMO-001' }).items[0].payload.source, 'synthetic');
});

test('rejects prototype-dangerous keys, symbols, accessors, and non-string values', () => {
  const protoPayload = Object.create(null);
  Object.defineProperty(protoPayload, '__proto__', {
    value: 'dangerous',
    enumerable: true,
    writable: true,
    configurable: true,
  });
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('proto-event', { payload: protoPayload })),
    'INVALID_PAYLOAD',
  );

  const constructorPayload = { constructor: 'dangerous' };
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('constructor-event', { payload: constructorPayload })),
    'INVALID_PAYLOAD',
  );

  const symbolPayload = { normal: 'value' };
  Object.defineProperty(symbolPayload, 'hidden', {
    value: Symbol('symbol value'),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('symbol-event', { payload: symbolPayload })),
    'INVALID_PAYLOAD',
  );

  const accessorPayload = { normal: 'value' };
  Object.defineProperty(accessorPayload, 'computed', {
    enumerable: true,
    get() {
      return 'accessor value';
    },
    configurable: true,
  });
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('accessor-event', { payload: accessorPayload })),
    'INVALID_PAYLOAD',
  );

  const accessorActor = { kind: 'system', id: 'actor' };
  Object.defineProperty(accessorActor, 'authority', {
    enumerable: true,
    get() {
      return 'none';
    },
    configurable: true,
  });
  assertThrowsCode(
    () => appendAuthorityEvent(makeInput('actor-accessor-event', { actor: accessorActor })),
    'INVALID_ACTOR',
  );
});

test('reset clears events and restarts sequences from one', () => {
  const before = appendAuthorityEvent(makeInput('before-reset'));
  assert.equal(before.sequence, 1);

  resetAuthorityEventLedger();
  assert.deepEqual(listAuthorityEvents({ caseId: 'FL-DEMO-001' }), {
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  assert.equal(getAuthorityEvent('before-reset') === undefined, true);

  const after = appendAuthorityEvent(makeInput('after-reset'));
  assert.equal(after.sequence, 1);
});

test('public operations are synchronous and non-Promise', () => {
  const appended = appendAuthorityEvent(makeInput('sync-event'));
  assert.equal(appended instanceof Promise, false);
  assert.equal(typeof appended.then, 'undefined');
  assert.equal(Object.prototype.toString.call(appended), '[object Object]');

  const queried = getAuthorityEvent('sync-event');
  assert.equal(queried instanceof Promise, false);
  assert.equal(typeof queried.then, 'undefined');

  const listed = listAuthorityEvents({ caseId: 'FL-DEMO-001' });
  assert.equal(listed instanceof Promise, false);
  assert.equal(typeof listed.then, 'undefined');
  assert.equal(getAuthorityEventCount(), 1);

  const reset = resetAuthorityEventLedger();
  assert.equal(reset, undefined);
});
