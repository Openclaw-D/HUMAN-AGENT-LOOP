import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import { createRelayHttpServer } from '../src/http/server.js';
import { shutdownRelayServer } from '../src/http/shutdown.js';
import { EventStore } from '../src/persistence/event-store.js';
import { createHarness, envelope } from './helpers.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function createBody(id = 'case-http') {
  return envelope('workCase.create', { id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'HTTP contract', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'next', trigger: { id: `${id}:trigger:1`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: `supplyChain:${id}`, payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' } }, scenarioExtensions: {} }, 0);
}

test('foreign Origin is denied before body read and creates zero writes', async () => {
  const harness = createHarness();
  let bodyReads = 0;
  const server = createRelayHttpServer({ service: harness.service, onBodyRead: () => { bodyReads += 1; } });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/work-cases`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify(createBody()) });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, 'ORIGIN_DENIED');
    assert.equal(bodyReads, 0);
    assert.deepEqual(harness.store.getStats(), { streams: 0, events: 0, projections: 0, commandReceipts: 0 });
  } finally { await close(server); harness.close(); }
});

test('body limit and invalid JSON use the unified error envelope', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service, bodyLimit: 128 });
  const base = await listen(server);
  try {
    const tooLarge = await fetch(`${base}/api/work-cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createBody('x'.repeat(300))) });
    const tooLargeBody = await tooLarge.json();
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(Object.keys(tooLargeBody), ['error']);
    assert.equal(tooLargeBody.error.code, 'BODY_TOO_LARGE');
    assert.ok(Object.hasOwn(tooLargeBody.error, 'traceId'));

    const invalid = await fetch(`${base}/api/work-cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  } finally { await close(server); harness.close(); }
});

test('health/readiness and WorkCase/replay HTTP routes report honest P2 state', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service });
  const base = await listen(server);
  try {
    const live = await (await fetch(`${base}/health/live`)).json();
    assert.deepEqual(live, { status: 'live', service: 'relayos', gate: 'P2' });
    const readyResponse = await fetch(`${base}/health/ready`);
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.persistence.journalMode, 'wal');
    assert.equal(ready.persistence.eventChain.status, 'verified');
    assert.equal(ready.advisoryProvider.status, 'ready');
    assert.equal(ready.advisoryProvider.providerId, 'mock');
    assert.equal(ready.authentication.identityAssurance, 'demo_unverified');

    const createdResponse = await fetch(`${base}/api/work-cases`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(createBody('case-http-routes')) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.state.ownerActorRef.id, 'human-owner');
    const projection = await (await fetch(`${base}/api/work-cases/case-http-routes`)).json();
    const replay = await (await fetch(`${base}/api/work-cases/case-http-routes/replay`)).json();
    assert.equal(replay.canonicalStateHash, projection.canonicalStateHash);
    assert.equal((await (await fetch(`${base}/api/work-cases/case-http-routes/events?after=0`)).json()).events.length, 1);
  } finally { await close(server); harness.close(); }
});

test('shared SIGINT/SIGTERM shutdown path closes listener, checkpoints WAL and closes DB', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service });
  const base = await listen(server);
  try {
    assert.equal((await (await fetch(`${base}/health/live`)).json()).status, 'live');
    const outcome = await shutdownRelayServer(server, harness.store, { signal: 'SIGTERM', timeoutMs: 10_000 });
    assert.equal(outcome.signal, 'SIGTERM');
    assert.equal(server.listening, false);
    const store = new EventStore(harness.databasePath);
    try {
      assert.equal(store.journalMode, 'wal');
      assert.equal(store.readiness().status, 'ready');
    } finally { store.close(); }
  } finally {
    if (server.listening) await close(server);
    try { harness.store.close(); } catch { /* already closed by shutdown path */ }
    rmSync(harness.directory, { recursive: true, force: true });
  }
});
