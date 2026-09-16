import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptCanonicalEvidence, getProjection, resetSyntheticRuntime } from '../lib/domain.ts';

function input(overrides = {}) {
  return {
    caseId: 'FL-DEMO-001',
    requestId: 'evidence-req-1',
    evidenceId: 'synthetic-equipment-note-1',
    kind: 'synthetic_note',
    title: '设备检验说明（脱敏）',
    summary: '候选设备检验页摘要，仅用于本地演示。',
    actor: '材料接入·周宁',
    ...overrides,
  };
}

test('one canonical evidence advances one context version shared by all four stage runs', () => {
  resetSyntheticRuntime();
  const before = getProjection('FL-DEMO-001');
  assert.equal(before.sharedContext.contextVersion, 'CTX-0001');
  const receipt = acceptCanonicalEvidence(input());
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.consumerCount, 4);
  assert.equal(receipt.contextVersion, 'CTX-0002');
  const after = getProjection('FL-DEMO-001');
  assert.equal(after.sharedContext.contextVersion, receipt.contextVersion);
  assert.equal(after.sharedContext.evidenceEventId, receipt.evidenceEventId);
  assert.equal(after.sharedContext.consumerCount, 4);
  assert.deepEqual(new Set(after.stageRuns.map((run) => run.contextVersion)), new Set([receipt.contextVersion]));
  assert.equal(after.stageRuns.length, 4);
  assert.deepEqual(after.stageRuns.map((run) => run.prepProgressPercent), [20, 40, 60, 80]);
});

test('same request replays exactly and x8 calls create only one event/version', () => {
  resetSyntheticRuntime();
  const first = acceptCanonicalEvidence(input());
  const replay = acceptCanonicalEvidence(input());
  assert.deepEqual(replay, first);
  const concurrent = Array.from({ length: 8 }, () => acceptCanonicalEvidence(input({ requestId: 'evidence-x8', evidenceId: 'synthetic-x8' })));
  assert.ok(concurrent.every((value) => JSON.stringify(value) === JSON.stringify(concurrent[0])));
  assert.equal(concurrent[0].contextVersion, 'CTX-0003');
  assert.equal(getProjection('FL-DEMO-001').sharedContext.contextVersion, 'CTX-0003');
  concurrent[0].title = '污染';
  const cleanReplay = acceptCanonicalEvidence(input({ requestId: 'evidence-x8', evidenceId: 'synthetic-x8' }));
  assert.notEqual(cleanReplay.title, '污染');
});

test('same request with different payload conflicts and does not advance version', () => {
  resetSyntheticRuntime();
  acceptCanonicalEvidence(input());
  const before = getProjection('FL-DEMO-001').sharedContext;
  assert.throws(() => acceptCanonicalEvidence(input({ title: '不同标题' })), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(getProjection('FL-DEMO-001').sharedContext, before);
});

test('invalid and injected failure paths fail closed without version advancement', () => {
  resetSyntheticRuntime();
  const before = getProjection('FL-DEMO-001').sharedContext;
  const invalid = [
    input({ requestId: ' ' }), input({ evidenceId: ' ' }), input({ kind: ' ' }),
    input({ title: ' ' }), input({ summary: ' ' }), input({ actor: ' ' }),
  ];
  for (const value of invalid) assert.throws(() => acceptCanonicalEvidence(value));
  assert.throws(() => acceptCanonicalEvidence(input({ requestId: 'failed', summary: '[error]' })), { code: 'EVIDENCE_PROCESSING_FAILED' });
  assert.deepEqual(getProjection('FL-DEMO-001').sharedContext, before);
});

test('projection reads independent deep clones of evidence receipt and stage runs', () => {
  resetSyntheticRuntime();
  acceptCanonicalEvidence(input());
  const projection = getProjection('FL-DEMO-001');
  projection.sharedContext.contextVersion = '污染';
  projection.stageRuns[0].contextVersion = '污染';
  projection.latestEvidenceReceipt.title = '污染';
  const clean = getProjection('FL-DEMO-001');
  assert.equal(clean.sharedContext.contextVersion, 'CTX-0002');
  assert.equal(clean.stageRuns[0].contextVersion, 'CTX-0002');
  assert.notEqual(clean.latestEvidenceReceipt.title, '污染');
});

test('same evidence id with a new request replays the canonical receipt without advancing context', () => {
  resetSyntheticRuntime();
  const first = acceptCanonicalEvidence(input());
  const before = getProjection('FL-DEMO-001');
  const replayByNewRequest = acceptCanonicalEvidence(input({ requestId: 'evidence-req-2' }));
  assert.deepEqual(replayByNewRequest, first);
  assert.equal(replayByNewRequest.requestId, 'evidence-req-1');
  assert.deepEqual(getProjection('FL-DEMO-001'), before);

  replayByNewRequest.title = '污染';
  assert.deepEqual(acceptCanonicalEvidence(input()), first);
  assert.deepEqual(acceptCanonicalEvidence(input({ requestId: 'evidence-req-3' })), first);
  assert.deepEqual(getProjection('FL-DEMO-001'), before);
});

test('same evidence id with different payload conflicts without advancing context', () => {
  resetSyntheticRuntime();
  acceptCanonicalEvidence(input());
  const before = getProjection('FL-DEMO-001');
  assert.throws(
    () => acceptCanonicalEvidence(input({ requestId: 'evidence-req-conflict', title: '不同标题' })),
    { code: 'EVIDENCE_ID_CONFLICT' },
  );
  assert.deepEqual(getProjection('FL-DEMO-001'), before);
});

test('evidence runtime ignores own prototype-shaped keys and polluting fields', () => {
  resetSyntheticRuntime();
  const before = getProjection('FL-DEMO-001');
  const prototypeKeyInput = input({ requestId: '__proto__', evidenceId: '__proto__' });
  Object.defineProperty(prototypeKeyInput, '__proto__', {
    value: { title: '污染' },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const receipt = acceptCanonicalEvidence(prototypeKeyInput);
  assert.notEqual(receipt.title, '污染');
  assert.equal(receipt.evidenceId, '__proto__');
  assert.deepEqual(acceptCanonicalEvidence(prototypeKeyInput), receipt);
  assert.equal(({}).polluted, undefined);
  assert.notDeepEqual(getProjection('FL-DEMO-001'), before);
});

test('canonical idempotency survives a long in-process sequence without reaccepting an old evidence id', () => {
  resetSyntheticRuntime();
  const first = acceptCanonicalEvidence(input());
  for (let index = 0; index < 300; index += 1) {
    acceptCanonicalEvidence(input({
      requestId: `bounded-request-${index}`,
      evidenceId: `bounded-evidence-${index}`,
      title: `bounded-${index}`,
    }));
  }
  const beforeReplay = getProjection('FL-DEMO-001').sharedContext;
  assert.deepEqual(acceptCanonicalEvidence(input({ requestId: 'late-replay-request' })), first);
  assert.deepEqual(getProjection('FL-DEMO-001').sharedContext, beforeReplay);
});
