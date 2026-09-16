import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { canonicalHash } from '../src/domain/canonical.js';
import { EventStore } from '../src/persistence/event-store.js';
import { createHarness, createWorkCase, envelope } from './helpers.js';

test('SQLite WAL persists events, projection and receipt across a real close/reopen', async () => {
  const harness = createHarness();
  const result = await createWorkCase(harness, { id: 'case-reopen' });
  assert.equal(harness.store.journalMode, 'wal');
  const path = harness.databasePath;
  const directory = harness.directory;
  harness.store.close();
  const reopened = new EventStore(path);
  assert.equal(reopened.getProjection('case-reopen').canonicalStateHash, result.canonicalStateHash);
  assert.equal(reopened.getEvents('case-reopen').length, 1);
  assert.equal(reopened.getStats().commandReceipts, 1);
  assert.equal(reopened.readiness().status, 'ready');
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test('event global/stream sequence and canonical hash chain are verified', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-chain-a' });
    await createWorkCase(harness, { id: 'case-chain-b' });
    const eventsA = harness.store.getEvents('case-chain-a');
    const eventsB = harness.store.getEvents('case-chain-b');
    assert.deepEqual([eventsA[0].globalSequence, eventsB[0].globalSequence], [1, 2]);
    assert.equal(eventsA[0].streamVersion, 1);
    assert.equal(eventsA[0].previousEventHash, '0'.repeat(64));
    assert.equal(eventsA[0].payloadHash, canonicalHash(eventsA[0].payload));
    assert.deepEqual(harness.store.verifyEventChain(), { status: 'verified', eventCount: 2, streamCount: 2, projectionCount: 2 });
  } finally { harness.close(); }
});

test('per-stream expectedVersion conflict creates no partial write', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-version' });
    const before = harness.store.getStats();
    const stale = envelope('goal.propose', { id: 'goal-stale', statement: 'stale', constraints: [], evidenceIds: [] }, 0);
    await assert.rejects(() => harness.service.executeCommand('case-version', stale), (error) => error.code === 'VERSION_CONFLICT');
    assert.deepEqual(harness.store.getStats(), before);
  } finally { harness.close(); }
});

test('two real child processes racing the same expectedVersion yield one commit and one conflict', async () => {
  const harness = createHarness();
  const runChild = (suffix) => new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [resolve('test/fixtures/concurrent-writer.mjs'), harness.databasePath, suffix], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectChild);
    child.on('close', (code) => code === 0 ? resolveChild(JSON.parse(stdout.trim())) : rejectChild(new Error(stderr)));
  });
  try {
    await createWorkCase(harness, { id: 'case-concurrent' });
    const results = await Promise.all([runChild('a'), runChild('b')]);
    assert.equal(results.filter((item) => item.ok).length, 1);
    assert.deepEqual(results.filter((item) => !item.ok).map((item) => item.code), ['VERSION_CONFLICT']);
    assert.equal(harness.store.getProjection('case-concurrent').projectionVersion, 2);
    assert.deepEqual(harness.store.getStats(), { streams: 1, events: 2, projections: 1, commandReceipts: 2 });
  } finally { harness.close(); }
});

test('idempotent command receipt wins before stale version and payload mismatch conflicts', async () => {
  const harness = createHarness();
  try {
    const firstEnvelope = envelope('workCase.create', { id: 'case-idem', organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'idempotent', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'next', trigger: { id: 'case-idem:trigger:1', type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: 'supplyChain:case-idem', payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: 'case-idem', observedVersion: '1' } }, scenarioExtensions: {} }, 0, { kind: 'human', id: 'human-owner' }, { commandId: 'cmd-idem', idempotencyKey: 'idem-idem' });
    const first = await harness.service.executeCommand('case-idem', firstEnvelope);
    const retry = { ...structuredClone(firstEnvelope), expectedStreamVersion: 999 };
    assert.deepEqual(await harness.service.executeCommand('case-idem', retry), first);
    const mismatch = structuredClone(retry);
    mismatch.payload.title = 'different';
    await assert.rejects(() => harness.service.executeCommand('case-idem', mismatch), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(harness.store.getStats(), { streams: 1, events: 1, projections: 1, commandReceipts: 1 });
  } finally { harness.close(); }
});

test('commandId canonical hash includes WorkCase route and cannot leak a receipt across streams', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-route-a' });
    await createWorkCase(harness, { id: 'case-route-b' });
    const shared = envelope('goal.propose', { id: 'shared-goal-id', statement: 'same payload', constraints: [], evidenceIds: [] }, 1, { kind: 'human', id: 'human-owner' }, { commandId: 'cmd-route-shared', idempotencyKey: 'idem-route-shared' });
    const resultA = await harness.service.executeCommand('case-route-a', shared);
    await assert.rejects(() => harness.service.executeCommand('case-route-b', structuredClone(shared)), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
    assert.equal(resultA.workCaseId, 'case-route-a');
    assert.equal(harness.store.getProjection('case-route-b').projectionVersion, 1);
  } finally { harness.close(); }
});

test('same stream idempotencyKey with a different canonical payload conflicts', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-key-conflict' });
    await harness.service.executeCommand('case-key-conflict', envelope('goal.propose', { id: 'goal-key-a', statement: 'first', constraints: [], evidenceIds: [] }, 1, { kind: 'human', id: 'human-owner' }, { commandId: 'cmd-key-a', idempotencyKey: 'shared-key' }));
    const before = harness.store.getStats();
    await assert.rejects(() => harness.service.executeCommand('case-key-conflict', envelope('goal.propose', { id: 'goal-key-b', statement: 'different', constraints: [], evidenceIds: [] }, 2, { kind: 'human', id: 'human-owner' }, { commandId: 'cmd-key-b', idempotencyKey: 'shared-key' })), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(harness.store.getStats(), before);
  } finally { harness.close(); }
});

test('configurationVersion conflict rolls back before decide/event append', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-config-version' });
    const before = harness.store.getStats();
    await assert.rejects(() => harness.service.executeCommand('case-config-version', envelope('goal.propose', { id: 'goal-config-stale', statement: 'config stale', constraints: [], evidenceIds: [] }, 1, { kind: 'human', id: 'human-owner' }, { configurationVersion: 2 })), (error) => error.code === 'CONFIGURATION_VERSION_CONFLICT');
    assert.deepEqual(harness.store.getStats(), before);
  } finally { harness.close(); }
});

for (const fault of ['after-event-append', 'after-projection-update', 'after-command-receipt']) {
  test(`fault ${fault} rolls back event/stream/projection/receipt`, async () => {
    const harness = createHarness({ faultInjector: (label) => { if (label === fault) throw new Error(`injected:${fault}`); } });
    try {
      await assert.rejects(() => createWorkCase(harness, { id: `case-${fault}` }), new RegExp(`injected:${fault}`));
      assert.deepEqual(harness.store.getStats(), { streams: 0, events: 0, projections: 0, commandReceipts: 0 });
    } finally { harness.close(); }
  });
}

test('projection can be deleted and rebuilt from BusinessEvent with the same canonical state hash', async () => {
  const harness = createHarness();
  try {
    const result = await createWorkCase(harness, { id: 'case-rebuild' });
    harness.store.db.exec('DELETE FROM work_case_projections');
    assert.equal(harness.store.getProjection('case-rebuild'), null);
    const rebuilt = harness.store.rebuildProjections();
    assert.equal(rebuilt.rebuilt, 1);
    assert.equal(rebuilt.projections[0].afterHash, result.canonicalStateHash);
    assert.equal(harness.store.getProjection('case-rebuild').canonicalStateHash, result.canonicalStateHash);
  } finally { harness.close(); }
});

test('direct event corruption fails closed in verification and readiness', async () => {
  const harness = createHarness();
  try {
    const original = envelope('workCase.create', { id: 'case-corrupt', organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'corrupt retry', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'next', trigger: { id: 'case-corrupt:trigger:1', type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: 'supplyChain:case-corrupt', payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: 'case-corrupt', observedVersion: '1' } }, scenarioExtensions: {} }, 0, { kind: 'human', id: 'human-owner' }, { commandId: 'cmd-corrupt-original', idempotencyKey: 'idem-corrupt-original' });
    await harness.service.executeCommand('case-corrupt', original);
    harness.store.db.prepare('UPDATE business_events SET payload_hash = ? WHERE stream_id = ? AND stream_version = 1').run('f'.repeat(64), 'case-corrupt');
    assert.throws(() => harness.store.verifyEventChain(), (error) => error.code === 'EVENT_CHAIN_CORRUPT');
    assert.equal(harness.store.readiness().status, 'error');
    const command = envelope('goal.propose', { id: 'goal-after-corruption', statement: 'must not write', constraints: [], evidenceIds: [] }, 1);
    await assert.rejects(() => harness.service.executeCommand('case-corrupt', command), (error) => error.code === 'EVENT_CORRUPTION');
    await assert.rejects(() => harness.service.executeCommand('case-corrupt', structuredClone(original)), (error) => error.code === 'EVENT_CORRUPTION');
    assert.equal(harness.store.getStats().events, 1);
  } finally { harness.close(); }
});

for (const [corruptionLabel, corruptionSql] of [
  ['previous event hash', "UPDATE business_events SET previous_event_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE stream_id = 'case-vector'"],
  ['event hash', "UPDATE business_events SET event_hash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' WHERE stream_id = 'case-vector'"],
  ['global sequence start', "UPDATE business_events SET global_sequence = 5 WHERE stream_id = 'case-vector'"],
  ['projection canonical hash', "UPDATE work_case_projections SET canonical_state_hash = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' WHERE stream_id = 'case-vector'"],
  ['projection state JSON', "UPDATE work_case_projections SET state_json = '{}' WHERE stream_id = 'case-vector'"],
  ['stream tail hash', "UPDATE event_streams SET last_event_hash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' WHERE stream_id = 'case-vector'"],
]) {
  test(`${corruptionLabel} corruption makes readiness error and next command fail closed`, async () => {
    const harness = createHarness();
    try {
      await createWorkCase(harness, { id: 'case-vector' });
      harness.store.db.exec(corruptionSql);
      assert.equal(harness.store.readiness().status, 'error');
      await assert.rejects(() => harness.service.executeCommand('case-vector', envelope('goal.propose', { id: 'goal-vector', statement: 'must fail closed', constraints: [], evidenceIds: [] }, 1)), (error) => error.code === 'EVENT_CORRUPTION');
      assert.equal(harness.store.getStats().events, 1);
    } finally { harness.close(); }
  });
}
