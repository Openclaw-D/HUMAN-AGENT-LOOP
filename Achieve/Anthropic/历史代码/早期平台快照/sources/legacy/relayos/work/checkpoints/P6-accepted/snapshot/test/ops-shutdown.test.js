import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { registerShutdownSignals, shutdownRelayServer } from '../src/http/shutdown.js';
import { OperationTracker } from '../src/ops/operation-tracker.js';
import { EventStore } from '../src/persistence/event-store.js';
import { advisoryRequest, createHarness, createWorkCase, dispatch, envelope, seedGoalAndContext } from './helpers.js';

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

class DelayedConnector extends MockExternalSystemAdapter {
  constructor() {
    super({ clock: () => '2026-08-26T08:00:00.000Z' });
    this.executeCount = 0;
    this.started = new Promise((resolve) => { this.resolveStarted = resolve; });
  }

  async execute(_intent, { signal } = {}) {
    this.executeCount += 1;
    this.resolveStarted();
    return new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('connector dispatch result uncertain'), { code: 'CONNECTOR_ABORTED' }));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

test('SIGINT and SIGTERM registration uses one shared shutdown callback', () => {
  const emitter = new EventEmitter();
  const observed = [];
  const remove = registerShutdownSignals((signal) => observed.push(signal), emitter);
  emitter.emit('SIGINT');
  emitter.emit('SIGTERM');
  assert.deepEqual(observed, ['SIGINT', 'SIGTERM']);
  remove();
  emitter.emit('SIGINT');
  assert.deepEqual(observed, ['SIGINT', 'SIGTERM']);
});

test('connector interrupted by graceful SIGTERM path persists unknown before DB close and retry is side-effect free', async () => {
  const tracker = new OperationTracker();
  const connector = new DelayedConnector();
  const harness = createHarness({ connector, operationTracker: tracker, connectorDeadlineMs: 10_000 });
  const id = 'case-shutdown-connector';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id);
  await dispatch(harness, id, 'action.propose', {
    id: 'shutdown-action', systemId: 'core-system', operation: 'update',
    inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: [], idempotencyKey: 'shutdown-external-key',
  });
  await dispatch(harness, id, 'action.authorize', { actionIntentId: 'shutdown-action' });
  const executeEnvelope = envelope('action.execute', { actionIntentId: 'shutdown-action' }, harness.store.getProjection(id).projectionVersion, { kind: 'human', id: 'human-owner' }, {
    commandId: 'shutdown-connector-command', idempotencyKey: 'shutdown-connector-idempotency', traceId: 'trace-shutdown-connector',
  });
  const server = createRelayHttpServer({ service: harness.service, operationTracker: tracker });
  const base = await listen(server);
  let reopened;
  try {
    const responsePromise = fetch(`${base}/api/work-cases/${id}/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(executeEnvelope),
    });
    await connector.started;
    const startedAt = Date.now();
    const shutdownPromise = shutdownRelayServer(server, harness.store, { signal: 'SIGTERM', timeoutMs: 10_000, operationTracker: tracker, advisoryRuntime: server.advisoryRuntime });
    const response = await responsePromise;
    const executed = await response.json();
    const shutdown = await shutdownPromise;
    assert.equal(response.status, 200);
    assert.equal(executed.state.executionReceipts.at(-1).status, 'unknown');
    assert.equal(executed.state.executionReceipts.at(-1).completedAt, null);
    assert.equal(shutdown.elapsedMs < 10_000, true);
    assert.equal(Date.now() - startedAt < 10_000, true);
    assert.equal(connector.executeCount, 1);
    await assert.rejects(() => fetch(`${base}/health/live`));

    reopened = new EventStore(harness.databasePath, { migrationMode: 'verify-only' });
    const projection = reopened.getProjection(id);
    assert.equal(projection.state.executionReceipts.at(-1).status, 'unknown');
    const retryConnector = new DelayedConnector();
    const retryService = new RelayService({ store: reopened, scenarioConfigs: loadScenarioConfigs('scenarios'), connector: retryConnector, clock: () => '2026-08-26T08:00:00.000Z' });
    const retry = { ...structuredClone(executeEnvelope), commandId: 'shutdown-connector-retry', expectedStreamVersion: 999 };
    assert.deepEqual(await retryService.executeCommand(id, retry), executed);
    assert.equal(retryConnector.executeCount, 0);
  } finally {
    reopened?.close();
    try { harness.store.close(); } catch { /* shutdown already closed it */ }
    harness.close();
  }
});

test('provider interrupted by graceful SIGTERM path returns unavailable and creates zero authoritative writes', async () => {
  const tracker = new OperationTracker();
  const harness = createHarness({ operationTracker: tracker });
  const id = 'case-shutdown-provider';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  const provider = {
    providerId: 'delayed-provider', model: 'delayed-v1',
    async suggest(_request, { signal } = {}) {
      resolveStarted();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('provider aborted'), { name: 'AbortError' }));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    },
    health() { return { status: 'ready', providerId: this.providerId, model: this.model }; },
  };
  const advisoryService = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider });
  const server = createRelayHttpServer({ service: harness.service, advisoryService, operationTracker: tracker });
  const base = await listen(server);
  const before = harness.store.auditSnapshot();
  let reopened;
  try {
    const responsePromise = fetch(`${base}/api/advisories`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(advisoryRequest(id)),
    });
    await started;
    const shutdownPromise = shutdownRelayServer(server, harness.store, { signal: 'SIGTERM', timeoutMs: 10_000, operationTracker: tracker });
    const response = await responsePromise;
    const body = await response.json();
    const shutdown = await shutdownPromise;
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'ADVISORY_UNAVAILABLE');
    assert.equal(shutdown.elapsedMs < 10_000, true);
    reopened = new EventStore(harness.databasePath, { migrationMode: 'verify-only' });
    assert.deepEqual(reopened.auditSnapshot(), before);
  } finally {
    reopened?.close();
    try { harness.store.close(); } catch { /* shutdown already closed it */ }
    harness.close();
  }
});

test('shutdown hard deadline rejects with pending operation evidence instead of reporting success', async () => {
  const tracker = new OperationTracker();
  const harness = createHarness({ operationTracker: tracker });
  const server = createRelayHttpServer({ service: harness.service, operationTracker: tracker });
  await listen(server);
  const pending = tracker.begin('transaction', { workCaseId: 'case-pending' });
  try {
    await assert.rejects(() => shutdownRelayServer(server, harness.store, { signal: 'SIGTERM', timeoutMs: 50, operationTracker: tracker }), (error) => error.code === 'SHUTDOWN_TIMEOUT' && error.details.pending === 1);
    assert.equal(harness.store.closed, true);
  } finally {
    pending.end();
    try { server.closeAllConnections?.(); } catch { /* already closed */ }
    harness.close();
  }
});

test('shutdown drain stops accepting new request bodies and creates zero authority writes', async () => {
  const tracker = new OperationTracker();
  const harness = createHarness({ operationTracker: tracker });
  let bodyReads = 0;
  const server = createRelayHttpServer({ service: harness.service, operationTracker: tracker, onBodyRead: () => { bodyReads += 1; } });
  const base = await listen(server);
  const pending = tracker.begin('transaction', { workCaseId: 'case-draining' });
  const before = harness.store.getStats();
  try {
    const shutdown = shutdownRelayServer(server, harness.store, { signal: 'SIGTERM', timeoutMs: 10_000, operationTracker: tracker, advisoryRuntime: server.advisoryRuntime });
    assert.equal(tracker.accepting, false);
    await assert.rejects(() => fetch(`${base}/api/work-cases`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ payload: { id: 'must-not-read' } }),
    }));
    assert.equal(bodyReads, 0);
    assert.deepEqual(harness.store.getStats(), before);
    pending.end();
    const result = await shutdown;
    assert.equal(result.checkpoint.busy, 0);
    assert.equal(harness.store.closed, true);
  } finally {
    pending.end();
    try { harness.store.close(); } catch { /* shutdown already closed */ }
    harness.close();
  }
});

test('production signal entry forces nonzero child exit at the hard timeout despite a non-cooperative handle', { timeout: 5_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-hard-timeout-'));
  const databasePath = join(directory, 'hard-timeout.db');
  const logPath = join(directory, 'hard-timeout.jsonl');
  const child = fork(resolve('test/fixtures/ops-hard-timeout-child.mjs'), [databasePath, logPath], {
    cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const ready = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`hard-timeout child did not become ready: ${stderr}`)), 2_000);
      child.on('message', (message) => {
        if (message?.type === 'hard-timeout.ready') { clearTimeout(timer); resolveReady(message); }
      });
    });
    assert.equal(ready.host, '127.0.0.1');
    assert.notEqual(ready.port, 4177);
    const startedAt = Date.now();
    child.send({ type: 'hard-timeout.trigger' });
    const exited = await new Promise((resolveExit, reject) => {
      const timer = setTimeout(() => reject(new Error('hard-timeout child survived beyond the process boundary')), 3_000);
      child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
    });
    assert.equal(exited.code, 1, stderr);
    assert(Date.now() - startedAt < 3_000);
    const records = readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const timeout = records.find((record) => record.event === 'runtime.shutdown.timed_out');
    assert(timeout);
    assert.equal(timeout.errorCode, 'SHUTDOWN_TIMEOUT');
    assert.equal(timeout.inFlight.transaction, 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await new Promise((resolveExit) => child.exitCode === null && child.signalCode === null ? child.once('exit', resolveExit) : resolveExit());
    rmSync(directory, { recursive: true, force: true });
  }
});
