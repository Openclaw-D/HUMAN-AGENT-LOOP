import assert from 'node:assert/strict';

const baseUrl = process.env.JIANWEI_BASE_URL || 'http://127.0.0.1:3000';
const assertFixed = process.argv.includes('--assert-fixed');
const runId = `${Date.now()}-${process.pid}`;

async function request(path, init) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, latencyMs: performance.now() - started };
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function benchmark(total, concurrency, factory) {
  let cursor = 0;
  const latencies = [];
  let errors = 0;
  const started = performance.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= total) return;
      const result = await factory(index);
      latencies.push(result.latencyMs);
      if (result.status < 200 || result.status >= 300) errors += 1;
    }
  });
  await Promise.all(workers);
  const elapsedMs = performance.now() - started;
  return {
    samples: total,
    concurrency,
    p50Ms: Number(percentile(latencies, 0.5).toFixed(3)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
    throughputPerSec: Number((total / (elapsedMs / 1000)).toFixed(2)),
    errorRate: Number((errors / total).toFixed(6)),
  };
}

function summarize(runs) {
  return {
    repeats: runs.length,
    samplesPerRepeat: runs[0].samples,
    medianP50Ms: Number(median(runs.map((run) => run.p50Ms)).toFixed(3)),
    medianP95Ms: Number(median(runs.map((run) => run.p95Ms)).toFixed(3)),
    medianThroughputPerSec: Number(median(runs.map((run) => run.throughputPerSec)).toFixed(2)),
    errorRate: Number((runs.reduce((sum, run) => sum + run.errorRate, 0) / runs.length).toFixed(6)),
    runs,
  };
}

const root = await request('/');
const projectionBefore = await request('/api/cases/FL-DEMO-001/projection');
assert.equal(root.status, 200);
assert.equal(projectionBefore.status, 200);

const evidenceBase = {
  requestId: `quality-evidence-${runId}`,
  evidenceId: `quality-canonical-${runId}`,
  kind: 'synthetic_note',
  title: '质量审计合成证据',
  summary: '只用于本地质量审计的脱敏合成摘要。',
  actor: '质量审计·林澈',
};
const evidenceNormal = await post('/api/cases/FL-DEMO-001/evidence', evidenceBase);
const evidenceReplay = await post('/api/cases/FL-DEMO-001/evidence', evidenceBase);
const contextAfterFirstEvidence = (await request('/api/cases/FL-DEMO-001/projection')).body.sharedContext.contextVersion;
const evidenceSameIdNewRequest = await post('/api/cases/FL-DEMO-001/evidence', {
  ...evidenceBase,
  requestId: `${evidenceBase.requestId}-new-request`,
});
const contextAfterSameEvidence = (await request('/api/cases/FL-DEMO-001/projection')).body.sharedContext.contextVersion;
const evidenceRequestConflict = await post('/api/cases/FL-DEMO-001/evidence', { ...evidenceBase, title: '冲突标题' });
const evidenceIdConflict = await post('/api/cases/FL-DEMO-001/evidence', {
  ...evidenceBase,
  requestId: `${evidenceBase.requestId}-evidence-conflict`,
  title: '不同证据内容',
});
const evidenceInvalid = await post('/api/cases/FL-DEMO-001/evidence', { ...evidenceBase, requestId: `${evidenceBase.requestId}-invalid`, actor: ' ' });
const beforeEvidenceFailure = (await request('/api/cases/FL-DEMO-001/projection')).body.sharedContext.contextVersion;
const evidenceFailure = await post('/api/cases/FL-DEMO-001/evidence', { ...evidenceBase, requestId: `${evidenceBase.requestId}-failure`, evidenceId: `${evidenceBase.evidenceId}-failure`, summary: '[error]' });
const afterEvidenceFailure = (await request('/api/cases/FL-DEMO-001/projection')).body.sharedContext.contextVersion;
const evidenceX32Input = { ...evidenceBase, requestId: `${evidenceBase.requestId}-x32`, evidenceId: `${evidenceBase.evidenceId}-x32` };
const evidenceX32 = await Promise.all(Array.from({ length: 32 }, () => post('/api/cases/FL-DEMO-001/evidence', evidenceX32Input)));

assert.equal(evidenceNormal.status, 200);
assert.deepEqual(evidenceReplay.body, evidenceNormal.body);
assert.equal(evidenceRequestConflict.status, 409);
assert.equal(evidenceIdConflict.status, 409);
assert.equal(evidenceInvalid.status, 400);
assert.equal(evidenceFailure.status, 500);
assert.equal(afterEvidenceFailure, beforeEvidenceFailure);
assert.ok(evidenceX32.every((item) => item.status === 200 && JSON.stringify(item.body) === JSON.stringify(evidenceX32[0].body)));

const evidenceDuplicateAdvanced = contextAfterSameEvidence !== contextAfterFirstEvidence;
if (assertFixed) {
  assert.deepEqual(evidenceSameIdNewRequest.body, evidenceNormal.body);
  assert.equal(evidenceDuplicateAdvanced, false);
}

const messageBase = {
  message: '请说明当前证据缺口',
  requestId: `quality-message-${runId}`,
  stageId: 'credit',
  flowId: 'credit-fact',
};
const messagesPath = '/api/cases/FL-DEMO-001/messages';
const oversizedMessageText = JSON.stringify({
  ...messageBase,
  message: 'x'.repeat(17_000),
  requestId: `${messageBase.requestId}-oversized`,
});
const oversizedBytes = new TextEncoder().encode(oversizedMessageText);
const messageHeaderOversize = await request(messagesPath, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-length': String(oversizedBytes.byteLength),
  },
  body: oversizedMessageText,
});
const messageChunkedOversize = await request(messagesPath, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(oversizedBytes.subarray(0, 9_000));
      controller.enqueue(oversizedBytes.subarray(9_000));
      controller.close();
    },
  }),
  duplex: 'half',
});
const message600 = await post(messagesPath, {
  ...messageBase,
  message: '甲'.repeat(600),
  requestId: `${messageBase.requestId}-600`,
});
const message601 = await post(messagesPath, {
  ...messageBase,
  message: '甲'.repeat(601),
  requestId: `${messageBase.requestId}-601`,
});
const messageInvalidJson = await request(messagesPath, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{',
});
assert.equal(messageHeaderOversize.status, 413);
assert.equal(messageHeaderOversize.body?.error?.code, 'REQUEST_BODY_TOO_LARGE');
assert.equal(messageChunkedOversize.status, 413);
assert.equal(messageChunkedOversize.body?.error?.code, 'REQUEST_BODY_TOO_LARGE');
assert.equal(message600.status, 200);
assert.equal(message601.status, 400);
assert.equal(message601.body?.error?.code, 'MESSAGE_TOO_LONG');
assert.equal(messageInvalidJson.status, 400);
assert.equal(messageInvalidJson.body?.error?.code, 'INVALID_JSON');

const messageNormal = await post('/api/cases/FL-DEMO-001/messages', messageBase);
const messageReplay = await post('/api/cases/FL-DEMO-001/messages', messageBase);
const messageConflict = await post('/api/cases/FL-DEMO-001/messages', { ...messageBase, message: '不同内容' });
const messageMixed = await post('/api/cases/FL-DEMO-001/messages', { ...messageBase, requestId: `${messageBase.requestId}-mixed`, stageId: 'policy' });
const messageInvalid = await post('/api/cases/FL-DEMO-001/messages', { ...messageBase, requestId: `${messageBase.requestId}-invalid`, message: ' ' });
const messageError = await post('/api/cases/FL-DEMO-001/messages', { ...messageBase, requestId: `${messageBase.requestId}-error`, message: '[error]' });
const messageTimeout = await post('/api/cases/FL-DEMO-001/messages', { ...messageBase, requestId: `${messageBase.requestId}-timeout`, message: '[timeout]' });
const messageX32Input = { ...messageBase, requestId: `${messageBase.requestId}-x32` };
const messageX32 = await Promise.all(Array.from({ length: 32 }, () => post('/api/cases/FL-DEMO-001/messages', messageX32Input)));
assert.equal(messageNormal.status, 200);
assert.deepEqual(messageReplay.body, messageNormal.body);
assert.equal(messageConflict.status, 409);
assert.equal(messageMixed.status, 400);
assert.equal(messageInvalid.status, 400);
assert.equal(messageError.status, 500);
assert.equal(messageTimeout.status, 504);
assert.ok(messageX32.every((item) => item.status === 200 && JSON.stringify(item.body) === JSON.stringify(messageX32[0].body)));

const decisionBase = {
  action: 'submit',
  actor: '质量审计·林澈',
  requestId: `quality-decision-${runId}`,
  stageId: 'asset',
  flowId: 'asset-warning',
};
const decisionNormal = await post('/api/cases/FL-DEMO-001/decisions', decisionBase);
const decisionReplay = await post('/api/cases/FL-DEMO-001/decisions', decisionBase);
const decisionConflict = await post('/api/cases/FL-DEMO-001/decisions', { ...decisionBase, action: 'reject' });
const decisionMixed = await post('/api/cases/FL-DEMO-001/decisions', { ...decisionBase, requestId: `${decisionBase.requestId}-mixed`, stageId: 'policy' });
const decisionInvalid = await post('/api/cases/FL-DEMO-001/decisions', { ...decisionBase, requestId: `${decisionBase.requestId}-invalid`, actor: ' ' });
const decisionX32Input = { ...decisionBase, requestId: `${decisionBase.requestId}-x32` };
const decisionX32 = await Promise.all(Array.from({ length: 32 }, () => post('/api/cases/FL-DEMO-001/decisions', decisionX32Input)));
assert.equal(decisionNormal.status, 200);
assert.deepEqual(decisionReplay.body, decisionNormal.body);
assert.equal(decisionConflict.status, 409);
assert.equal(decisionMixed.status, 400);
assert.equal(decisionInvalid.status, 400);
assert.ok(decisionX32.every((item) => item.status === 200 && JSON.stringify(item.body) === JSON.stringify(decisionX32[0].body)));

const allFacts = projectionBefore.body.materials.flatMap((material) => material.facts);
const confirmFact = allFacts.find((fact) => fact.status === 'candidate') || allFacts[0];
const confirmActor = confirmFact.confirmedBy || '质量审计·林澈';
const confirmPath = `/api/cases/FL-DEMO-001/facts/${encodeURIComponent(confirmFact.id)}/confirm`;
const confirmBase = { actor: confirmActor, requestId: `quality-confirm-${runId}` };
const confirmNormal = await post(confirmPath, confirmBase);
const confirmReplay = await post(confirmPath, confirmBase);
const confirmConflict = await post(confirmPath, { ...confirmBase, actor: '质量审计·其他人' });
const confirmInvalid = await post(confirmPath, { ...confirmBase, requestId: `${confirmBase.requestId}-invalid`, actor: ' ' });
const confirmX32Input = { actor: confirmActor, requestId: `${confirmBase.requestId}-x32` };
const confirmX32 = await Promise.all(Array.from({ length: 32 }, () => post(confirmPath, confirmX32Input)));
assert.equal(confirmNormal.status, 200);
assert.deepEqual(confirmReplay.body, confirmNormal.body);
assert.equal(confirmConflict.status, 409);
assert.equal(confirmInvalid.status, 400);
assert.ok(confirmX32.every((item) => item.status === 200 && JSON.stringify(item.body) === JSON.stringify(confirmX32[0].body)));

const projectionRuns = [];
const messageRuns = [];
for (let repeat = 0; repeat < 3; repeat += 1) {
  projectionRuns.push(await benchmark(240, 16, () => request('/api/cases/FL-DEMO-001/projection')));
  messageRuns.push(await benchmark(120, 12, (index) => post('/api/cases/FL-DEMO-001/messages', {
    ...messageBase,
    requestId: `quality-bench-message-${runId}-${repeat}-${index}`,
  })));
}

const projectionAfter = await request('/api/cases/FL-DEMO-001/projection');
const rootAfter = await request('/');
assert.equal(rootAfter.status, 200);
assert.equal(projectionAfter.status, 200);

const authorityEvents = [];
let eventCursor = 0;
for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
  const page = await request(`/api/cases/FL-DEMO-001/events?afterSequence=${eventCursor}&limit=100`);
  assert.equal(page.status, 200);
  assert.equal(page.body.persistence, 'in_memory_demo');
  assert.equal(page.body.authority, 'server_derived');
  authorityEvents.push(...page.body.items);
  if (!page.body.hasMore) break;
  assert.ok(Number.isSafeInteger(page.body.nextCursor) && page.body.nextCursor > eventCursor);
  eventCursor = page.body.nextCursor;
}
const eventsOrdered = authorityEvents.every((event, index) => (
  index === 0 || event.sequence === authorityEvents[index - 1].sequence + 1
));
const eventIdsUnique = new Set(authorityEvents.map((event) => event.eventId)).size === authorityEvents.length;
assert.equal(eventsOrdered, true);
assert.equal(eventIdsUnique, true);
assert.equal(authorityEvents.length, projectionAfter.body.runtimeAudit.authorityEventCount);
const eventsInvalidCursor = await request('/api/cases/FL-DEMO-001/events?afterSequence=-1');
const eventsInvalidLimit = await request('/api/cases/FL-DEMO-001/events?limit=101');
const eventsWrongCase = await request('/api/cases/UNKNOWN/events');
const eventsWriteAttempt = await post('/api/cases/FL-DEMO-001/events', {});
assert.equal(eventsInvalidCursor.status, 400);
assert.equal(eventsInvalidLimit.status, 400);
assert.equal(eventsWrongCase.status, 404);
assert.equal(eventsWriteAttempt.status, 405);

const output = {
  runId,
  baseUrl,
  assertions: {
    root: root.status,
    projection: projectionBefore.status,
    events: {
      count: authorityEvents.length,
      countMatchesProjection: authorityEvents.length === projectionAfter.body.runtimeAudit.authorityEventCount,
      ordered: eventsOrdered,
      uniqueIds: eventIdsUnique,
      invalidCursor: eventsInvalidCursor.status,
      invalidLimit: eventsInvalidLimit.status,
      wrongCase: eventsWrongCase.status,
      writeAttempt: eventsWriteAttempt.status,
    },
    evidence: {
      normal: evidenceNormal.status,
      replayExact: JSON.stringify(evidenceReplay.body) === JSON.stringify(evidenceNormal.body),
      requestConflict: evidenceRequestConflict.status,
      evidenceIdConflict: evidenceIdConflict.status,
      invalid: evidenceInvalid.status,
      failure: evidenceFailure.status,
      failureDidNotAdvance: afterEvidenceFailure === beforeEvidenceFailure,
      x32Exact: evidenceX32.every((item) => JSON.stringify(item.body) === JSON.stringify(evidenceX32[0].body)),
      sameEvidenceIdNewRequestStatus: evidenceSameIdNewRequest.status,
      sameEvidenceIdReplayedCanonicalReceipt: JSON.stringify(evidenceSameIdNewRequest.body) === JSON.stringify(evidenceNormal.body),
      sameEvidenceIdAdvancedContext: evidenceDuplicateAdvanced,
    },
    messages: {
      normal: messageNormal.status,
      replayExact: JSON.stringify(messageReplay.body) === JSON.stringify(messageNormal.body),
      conflict: messageConflict.status,
      mixed: messageMixed.status,
      invalid: messageInvalid.status,
      error: messageError.status,
      timeout: messageTimeout.status,
      x32Exact: messageX32.every((item) => JSON.stringify(item.body) === JSON.stringify(messageX32[0].body)),
      boundedBody: {
        contentLengthOversize: messageHeaderOversize.status,
        contentLengthCode: messageHeaderOversize.body?.error?.code,
        chunkedOversize: messageChunkedOversize.status,
        chunkedCode: messageChunkedOversize.body?.error?.code,
        message600: message600.status,
        message601: message601.status,
        message601Code: message601.body?.error?.code,
        invalidJson: messageInvalidJson.status,
        invalidJsonCode: messageInvalidJson.body?.error?.code,
        serviceHealthyAfter: rootAfter.status === 200 && projectionAfter.status === 200,
      },
    },
    decisions: { normal: decisionNormal.status, replayExact: JSON.stringify(decisionReplay.body) === JSON.stringify(decisionNormal.body), conflict: decisionConflict.status, mixed: decisionMixed.status, invalid: decisionInvalid.status, x32Exact: decisionX32.every((item) => JSON.stringify(item.body) === JSON.stringify(decisionX32[0].body)) },
    confirm: { normal: confirmNormal.status, replayExact: JSON.stringify(confirmReplay.body) === JSON.stringify(confirmNormal.body), conflict: confirmConflict.status, invalid: confirmInvalid.status, x32Exact: confirmX32.every((item) => JSON.stringify(item.body) === JSON.stringify(confirmX32[0].body)) },
    finalContextVersion: projectionAfter.body.sharedContext.contextVersion,
    stageRunVersions: projectionAfter.body.stageRuns.map((run) => run.contextVersion),
  },
  performance: {
    note: '本机 production、同一构建、仅用于 before/after；不得外推为生产 SLA。',
    projection: summarize(projectionRuns),
    messages: summarize(messageRuns),
  },
};

console.log(JSON.stringify(output, null, 2));
