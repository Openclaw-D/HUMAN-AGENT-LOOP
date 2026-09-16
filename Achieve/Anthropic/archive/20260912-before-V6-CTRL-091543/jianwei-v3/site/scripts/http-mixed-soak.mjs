import assert from 'node:assert/strict';

const baseUrl = process.env.JIANWEI_BASE_URL || 'http://127.0.0.1:3000';
const rounds = Number.parseInt(process.argv[2] || '20', 10);
const caseUrl = `${baseUrl}/api/cases/FL-DEMO-001`;
const runId = `${Date.now()}-${process.pid}`;
let requestCount = 0;
let unexpected5xx = 0;
const startedAt = performance.now();

async function call(path, body) {
  requestCount += 1;
  const response = await fetch(`${caseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.status >= 500 && !['EVIDENCE_PROCESSING_FAILED', 'ADAPTER_FAILURE', 'ADAPTER_TIMEOUT'].includes(payload?.error?.code)) {
    unexpected5xx += 1;
  }
  return { status: response.status, payload };
}

for (let round = 0; round < rounds; round += 1) {
  const suffix = `${runId}-${round}`;
  const evidence = {
    requestId: `soak-evidence-request-${suffix}`,
    evidenceId: `soak-evidence-${suffix}`,
    kind: 'synthetic_note',
    title: `混合稳定性证据 ${round}`,
    summary: '脱敏合成摘要，仅用于本地稳定性验证。',
    actor: '稳定性验证·周宁',
  };
  const accepted = await call('/evidence', evidence);
  const replay = await call('/evidence', evidence);
  const evidenceConflict = await call('/evidence', { ...evidence, title: `${evidence.title} 冲突` });
  const evidenceFailure = await call('/evidence', {
    ...evidence,
    requestId: `soak-evidence-failure-${suffix}`,
    evidenceId: `soak-evidence-failure-${suffix}`,
    summary: '[error]',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(replay.payload, accepted.payload);
  assert.equal(evidenceConflict.status, 409);
  assert.equal(evidenceFailure.status, 500);

  const message = {
    requestId: `soak-message-${suffix}`,
    stageId: 'credit',
    flowId: 'credit-review',
    message: '请给出当前证据缺口。',
  };
  const messageBatch = await Promise.all(Array.from({ length: 8 }, () => call('/messages', message)));
  assert.ok(messageBatch.every((item) => item.status === 200));
  assert.ok(messageBatch.every((item) => JSON.stringify(item.payload) === JSON.stringify(messageBatch[0].payload)));
  assert.equal((await call('/messages', { ...message, message: '冲突载荷' })).status, 409);
  assert.equal((await call('/messages', { ...message, requestId: `soak-message-error-${suffix}`, message: '[error]' })).status, 500);
  assert.equal((await call('/messages', { ...message, requestId: `soak-message-timeout-${suffix}`, message: '[timeout]' })).status, 504);
  assert.equal((await call('/messages', { ...message, requestId: `soak-message-mixed-${suffix}`, stageId: 'policy' })).status, 400);

  const decision = {
    requestId: `soak-decision-${suffix}`,
    stageId: 'commerce',
    flowId: 'commerce-contract',
    action: 'submit',
    actor: '商务复核·陈舟',
  };
  const decisionBatch = await Promise.all(Array.from({ length: 8 }, () => call('/decisions', decision)));
  assert.ok(decisionBatch.every((item) => item.status === 200));
  assert.ok(decisionBatch.every((item) => JSON.stringify(item.payload) === JSON.stringify(decisionBatch[0].payload)));
  assert.equal((await call('/decisions', { ...decision, action: 'reject' })).status, 409);
  assert.equal((await call('/decisions', { ...decision, stageId: 'policy' })).status, 400);

  const projection = await fetch(`${caseUrl}/projection`);
  requestCount += 1;
  assert.equal(projection.status, 200);
  const snapshot = await projection.json();
  assert.deepEqual(new Set(snapshot.stageRuns.map((stage) => stage.contextVersion)), new Set([snapshot.sharedContext.contextVersion]));
}

const durationMs = performance.now() - startedAt;
const health = await fetch(baseUrl);
requestCount += 1;
assert.equal(health.status, 200);
assert.equal(unexpected5xx, 0);

console.log(JSON.stringify({
  runId,
  rounds,
  requestCount,
  durationMs: Number(durationMs.toFixed(3)),
  throughputPerSec: Number((requestCount / (durationMs / 1000)).toFixed(2)),
  unexpected5xx,
  expectedInjectedFailures: rounds * 3,
  processHealthyAfterSoak: true,
}, null, 2));
