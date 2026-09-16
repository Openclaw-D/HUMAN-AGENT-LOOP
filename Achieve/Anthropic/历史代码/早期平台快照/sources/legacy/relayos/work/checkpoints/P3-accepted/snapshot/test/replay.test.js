import test from 'node:test';
import assert from 'node:assert/strict';

import { createHarness, createWorkCase, dispatch, seedGoalAndContext } from './helpers.js';

test('online projection and event-only replay remain byte-canonically equivalent through core objects', async () => {
  const harness = createHarness();
  try {
    const id = 'case-replay-complete';
    await createWorkCase(harness, { id, extensions: { supplyChain: { purchaseOrderId: 'po-demo' } } });
    await seedGoalAndContext(harness, id);
    await dispatch(harness, id, 'exception.open', { id: 'replay-exception', type: 'connector_failure', severity: 'medium', sourceRefs: [] });
    await dispatch(harness, id, 'exception.acknowledge', { exceptionId: 'replay-exception' });
    await dispatch(harness, id, 'exception.resolve', { exceptionId: 'replay-exception', resolution: { rationale: 'resolved' } });
    for (const category of ['business', 'risk', 'efficiency']) {
      await dispatch(harness, id, 'metric.observe', { id: `replay-${category}`, metricKey: `${category}Metric`, category, value: 1, unit: 'count', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', window: null, definitionVersion: 1 });
    }
    await dispatch(harness, id, 'workCase.complete', { resultEvidenceIds: [`${id}:evidence:1`] });
    await dispatch(harness, id, 'workCase.close', {});
    const online = harness.store.getProjection(id);
    const replay = harness.store.replayStream(id);
    assert.equal(replay.canonicalStateHash, online.canonicalStateHash);
    assert.deepEqual(replay.state, online.state);
    assert.equal(replay.state.status, 'closed');
  } finally { harness.close(); }
});

test('drop all projections and rebuild three streams solely from BusinessEvent', async () => {
  const harness = createHarness();
  try {
    for (const [scenarioKey, extensions] of [
      ['supplyChain', { supplyChain: { supplierId: 's-1' } }],
      ['finance', { finance: { transactionId: 't-1' } }],
      ['enterpriseAutomation', { enterpriseAutomation: { requestId: 'r-1' } }],
    ]) await createWorkCase(harness, { id: `case-rebuild-${scenarioKey}`, scenarioKey, extensions });
    const hashes = new Map(harness.store.listProjections().map((item) => [item.workCaseId, item.canonicalStateHash]));
    harness.store.db.exec('DELETE FROM work_case_projections');
    const result = harness.store.rebuildProjections();
    assert.equal(result.rebuilt, 3);
    for (const projection of harness.store.listProjections()) assert.equal(projection.canonicalStateHash, hashes.get(projection.workCaseId));
    assert.equal(harness.store.verifyEventChain().streamCount, 3);
  } finally { harness.close(); }
});

test('service replay remains available when the disposable projection is absent', async () => {
  const harness = createHarness();
  try {
    const result = await createWorkCase(harness, { id: 'case-service-replay' });
    harness.store.db.exec('DELETE FROM work_case_projections');
    assert.equal(harness.store.getProjection('case-service-replay'), null);
    const replay = harness.service.replay('case-service-replay');
    assert.equal(replay.canonicalStateHash, result.canonicalStateHash);
    assert.equal(replay.state.id, 'case-service-replay');
  } finally { harness.close(); }
});

test('rebuild projection transaction rolls back on corrupted event chain', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-rebuild-rollback' });
    const before = harness.store.getProjection('case-rebuild-rollback');
    harness.store.db.prepare('UPDATE business_events SET event_hash = ? WHERE stream_id = ?').run('f'.repeat(64), 'case-rebuild-rollback');
    assert.throws(() => harness.store.rebuildProjections(), (error) => error.code === 'EVENT_CHAIN_CORRUPT');
    assert.deepEqual(harness.store.getProjection('case-rebuild-rollback'), before);
  } finally { harness.close(); }
});

test('unknown event schema makes readiness error instead of using old projection', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-schema-corrupt' });
    harness.store.db.prepare('UPDATE business_events SET event_schema_version = 99 WHERE stream_id = ?').run('case-schema-corrupt');
    const ready = harness.store.readiness();
    assert.equal(ready.status, 'error');
    assert.equal(ready.eventChain.code, 'EVENT_SCHEMA_UNKNOWN');
  } finally { harness.close(); }
});
