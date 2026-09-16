import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLatestCandidateStageRuns,
  listCandidateStageRuns,
  recordCandidateStageRuns,
  resetCandidateStageRuns,
} from '../lib/stage-run-runtime.ts';

const flowIdsByStage = {
  policy: [
    'policy-material',
    'policy-rules',
    'policy-quant',
    'policy-prereview',
    'policy-update',
  ],
  credit: [
    'credit-parse',
    'credit-fact',
    'credit-link',
    'credit-coordinate',
    'credit-review',
  ],
  commerce: [
    'commerce-contract',
    'commerce-logistics',
    'commerce-funding',
    'commerce-payment-check',
    'commerce-final-payment',
  ],
  asset: [
    'asset-onboard',
    'asset-rent',
    'asset-warning',
    'asset-collection',
    'asset-litigation',
  ],
};
const stages = ['policy', 'credit', 'commerce', 'asset'];

function buildInput({
  caseId = 'FL-DEMO-001',
  contextVersion = 'CTX-9000',
  sourceEventId = ' evidence-event-0001 ',
  counts = { policy: 0, credit: 1, commerce: 2, asset: 3 },
  extraKey,
} = {}) {
  const input = {
    caseId,
    contextVersion,
    sourceEventId,
    completedStepCountByStage: counts,
  };
  if (extraKey !== undefined) input[extraKey] = 'extra';
  return input;
}

function assertError(input, code) {
  const before = listCandidateStageRuns().length;
  assert.throws(() => recordCandidateStageRuns(input), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, code);
    return true;
  });
  assert.equal(listCandidateStageRuns().length, before);
}

test('records all twenty frozen stage/count variants from the shared projection', () => {
  resetCandidateStageRuns();

  let versionNumber = 1000;
  const expectations = [];
  for (const stageId of stages) {
    for (let count = 1; count <= 5; count += 1) {
      const counts = { policy: 0, credit: 0, commerce: 0, asset: 0, [stageId]: count };
      const contextVersion = `CTX-${versionNumber}`;
      const result = recordCandidateStageRuns(buildInput({ contextVersion, counts }));
      const actual = result.find((record) => record.stageId === stageId);
      assert.equal(actual.completedStepCount, count);
      assert.equal(actual.prepProgressPercent, count * 20);
      assert.equal(actual.currentFlowId, flowIdsByStage[stageId][Math.min(count, 4)]);
      expectations.push([stageId, contextVersion, count, actual.processRunId]);
      versionNumber += 1;
    }
  }

  assert.equal(expectations.length, 20);
  assert.equal(listCandidateStageRuns().length, 80);
  for (const [stageId, contextVersion, count, processRunId] of expectations) {
    assert.equal(processRunId, `run-${stageId}-${contextVersion}`);
    assert.equal(count > 0, true);
  }
});

test('atomically records four same-version stage runs in frozen order', () => {
  resetCandidateStageRuns();
  const recordedAtBefore = new Date().toISOString();
  const result = recordCandidateStageRuns(buildInput());
  const recordedAtAfter = new Date().toISOString();

  assert.deepEqual(result.map((record) => record.stageId), stages);
  assert.ok(result.every((record) => record.caseId === 'FL-DEMO-001'));
  assert.ok(result.every((record) => record.contextVersion === 'CTX-9000'));
  assert.ok(result.every((record) => record.sourceEventId === 'evidence-event-0001'));
  assert.ok(result.every((record) => record.status === 'candidate_ready'));
  assert.equal(new Set(result.map((record) => record.recordedAt)).size, 1);
  assert.ok(result[0].recordedAt >= recordedAtBefore);
  assert.ok(result[0].recordedAt <= recordedAtAfter);
  assert.equal(new Set(result.map((record) => record.processRunId)).size, 4);
  assert.deepEqual(result.map((record) => record.completedStepCount), [0, 1, 2, 3]);
  assert.deepEqual(result.map((record) => record.currentFlowId), stages.map(
    (stageId) => flowIdsByStage[stageId][Math.min(result.find((record) => record.stageId === stageId).completedStepCount, 4)],
  ));
  assert.equal(getLatestCandidateStageRuns().length, 4);
  assert.equal(listCandidateStageRuns().length, 4);
});

test('exact normalized payload replay returns clones without appending', () => {
  resetCandidateStageRuns();
  const first = recordCandidateStageRuns(buildInput());
  const replay = recordCandidateStageRuns(buildInput({
    contextVersion: '  CTX-9000  ',
    sourceEventId: 'evidence-event-0001',
    counts: {
      asset: 3,
      commerce: 2,
      credit: 1,
      policy: 0,
    },
  }));

  assert.deepEqual(replay, first);
  assert.notEqual(replay, first);
  assert.notEqual(replay[0], first[0]);
  assert.equal(replay[0].recordedAt, first[0].recordedAt);
  assert.equal(listCandidateStageRuns().length, 4);
});

test('same version with different payload conflicts and failure does not write', () => {
  resetCandidateStageRuns();
  recordCandidateStageRuns(buildInput());

  assertError(buildInput({ sourceEventId: 'evidence-event-0002' }), 'CONTEXT_VERSION_CONFLICT');
  assertError(buildInput({ counts: { policy: 1, credit: 1, commerce: 2, asset: 3 } }), 'CONTEXT_VERSION_CONFLICT');
  assertError(buildInput({ caseId: 'FL-DEMO-002' }), 'CASE_NOT_FOUND');
  assertError(buildInput({ contextVersion: 'CTX-900' }), 'INVALID_CONTEXT_VERSION');
  assertError(buildInput({ sourceEventId: '   ' }), 'INVALID_SOURCE_EVENT_ID');
  assertError(buildInput({ counts: { policy: 0, credit: 1, commerce: 2 } }), 'INVALID_STAGE_COUNTS');
  assertError(buildInput({ counts: { policy: 6, credit: 1, commerce: 2, asset: 3 } }), 'INVALID_COMPLETED_STEP_COUNT');
  assert.equal(listCandidateStageRuns().length, 4);
  assert.deepEqual(getLatestCandidateStageRuns().map((record) => record.sourceEventId), Array(4).fill('evidence-event-0001'));
});

test('validates context and source normalization boundaries with priority', () => {
  resetCandidateStageRuns();
  assertError(buildInput({ contextVersion: 'ctx-0001' }), 'INVALID_CONTEXT_VERSION');
  assertError(buildInput({ contextVersion: 'CTX-000' }), 'INVALID_CONTEXT_VERSION');
  assert.equal(recordCandidateStageRuns(buildInput({ contextVersion: 'CTX-00000' }))[0].contextVersion, 'CTX-00000');
  resetCandidateStageRuns();

  assertError(buildInput({ sourceEventId: 1 }), 'INVALID_SOURCE_EVENT_ID');
  assertError(buildInput({ sourceEventId: 'x'.repeat(161) }), 'INVALID_SOURCE_EVENT_ID');
  assert.equal(recordCandidateStageRuns(buildInput({ sourceEventId: 'x'.repeat(160) }))[0].sourceEventId.length, 160);
});

test('requires exact input and stage-count keys, including symbol and prototype extras', () => {
  resetCandidateStageRuns();
  assertError(buildInput({ extraKey: 'unexpected' }), 'INVALID_STAGE_COUNTS');

  const missing = buildInput();
  Reflect.deleteProperty(missing, 'sourceEventId');
  assertError(missing, 'INVALID_SOURCE_EVENT_ID');

  const symbolExtra = buildInput();
  symbolExtra[Symbol('extra')] = 1;
  assertError(symbolExtra, 'INVALID_STAGE_COUNTS');

  const hiddenExtra = buildInput();
  Object.defineProperty(hiddenExtra, 'hidden', {
    value: 1,
    enumerable: false,
    configurable: true,
  });
  assertError(hiddenExtra, 'INVALID_STAGE_COUNTS');

  const countSymbolExtra = buildInput({
    counts: (() => {
      const counts = { policy: 0, credit: 1, commerce: 2, asset: 3 };
      counts[Symbol('extra')] = 0;
      return counts;
    })(),
  });
  assertError(countSymbolExtra, 'INVALID_STAGE_COUNTS');

  const countHiddenExtra = buildInput({
    counts: (() => {
      const counts = { policy: 0, credit: 1, commerce: 2, asset: 3 };
      Object.defineProperty(counts, 'hidden', {
        value: 0,
        enumerable: false,
        configurable: true,
      });
      return counts;
    })(),
  });
  assertError(countHiddenExtra, 'INVALID_STAGE_COUNTS');

  const pollutedPrototypeCounts = buildInput({
    counts: (() => {
      const counts = { policy: 0, credit: 1, commerce: 2, asset: 3 };
      Object.setPrototypeOf(counts, { extra: 1 });
      return counts;
    })(),
  });
  assertError(pollutedPrototypeCounts, 'INVALID_STAGE_COUNTS');

  const nullPrototypeCounts = Object.assign(Object.create(null), {
    policy: 0,
    credit: 1,
    commerce: 2,
    asset: 3,
  });
  assert.equal(recordCandidateStageRuns(buildInput({
    contextVersion: 'CTX-9500',
    counts: nullPrototypeCounts,
  })).length, 4);
});

test('all reads are deep clones and input or output mutation cannot pollute the ledger', () => {
  resetCandidateStageRuns();
  const counts = { policy: 0, credit: 1, commerce: 2, asset: 3 };
  const first = recordCandidateStageRuns(buildInput({ counts }));
  counts.policy = 5;

  assert.equal(listCandidateStageRuns()[0].completedStepCount, 0);
  first[0].caseId = 'changed';
  first[0].contextVersion = 'changed';
  first[0].stageId = 'changed';
  first[0].processRunId = 'changed';
  first[0].completedStepCount = 99;
  assert.equal(listCandidateStageRuns()[0].caseId, 'FL-DEMO-001');
  assert.equal(listCandidateStageRuns()[0].contextVersion, 'CTX-9000');
  assert.equal(listCandidateStageRuns()[0].stageId, 'policy');
  assert.equal(listCandidateStageRuns()[0].processRunId, 'run-policy-CTX-9000');
  assert.equal(listCandidateStageRuns()[0].completedStepCount, 0);

  const latest = getLatestCandidateStageRuns();
  latest[1].stageId = 'changed';
  const listed = listCandidateStageRuns();
  listed[2].stageId = 'changed';
  assert.equal(getLatestCandidateStageRuns()[1].stageId, 'credit');
  assert.equal(listCandidateStageRuns()[2].stageId, 'commerce');
  assert.notEqual(latest[1], listCandidateStageRuns()[1]);
});

test('reset completely clears the append-only ledger', () => {
  resetCandidateStageRuns();
  recordCandidateStageRuns(buildInput());
  assert.equal(listCandidateStageRuns().length, 4);
  resetCandidateStageRuns();

  assert.deepEqual(getLatestCandidateStageRuns(), []);
  assert.deepEqual(listCandidateStageRuns(), []);
  const result = recordCandidateStageRuns(buildInput());
  assert.equal(result[0].processRunId, 'run-policy-CTX-9000');
  assert.equal(listCandidateStageRuns().length, 4);
});

test('record, read, list, and reset are synchronous and not Promises', () => {
  resetCandidateStageRuns();
  const result = recordCandidateStageRuns(buildInput());
  assert.ok(!(result instanceof Promise));
  assert.equal(typeof result, 'object');
  assert.ok(!(getLatestCandidateStageRuns() instanceof Promise));
  assert.ok(!(listCandidateStageRuns() instanceof Promise));
  assert.ok(!(resetCandidateStageRuns() instanceof Promise));
});
