import { resolve } from 'node:path';

import { AdvisoryService } from '../../src/application/advisory-service.js';
import { RelayService } from '../../src/application/service.js';
import { MockExternalSystemAdapter } from '../../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../../src/config/scenario-loader.js';
import { createRelayHttpServer } from '../../src/http/server.js';
import { registerShutdownSignals, shutdownRelayServer } from '../../src/http/shutdown.js';
import { createJsonlLogger } from '../../src/observability/jsonl-logger.js';
import { OperationTracker } from '../../src/ops/operation-tracker.js';
import { EventStore } from '../../src/persistence/event-store.js';

const [mode, databasePath, logPath] = process.argv.slice(2);
if (!mode || !databasePath || !logPath) throw new Error('Usage: ops-runtime-child.mjs <mode> <db> <log>');

let sequence = 0;
function command(commandType, payload, expectedStreamVersion, actor = { kind: 'human', id: 'human-owner' }, overrides = {}) {
  sequence += 1;
  return {
    commandId: overrides.commandId ?? `ops-child-command-${sequence}`,
    idempotencyKey: overrides.idempotencyKey ?? `ops-child-idempotency-${sequence}`,
    expectedStreamVersion,
    configurationVersion: 1,
    commandType,
    demoActorRef: actor,
    identityAssurance: 'demo_unverified',
    traceId: overrides.traceId ?? `trace-ops-child-${sequence}`,
    payload,
  };
}

class DelayedConnector extends MockExternalSystemAdapter {
  constructor({ delayed = false } = {}) {
    super({ clock: () => '2026-08-26T09:00:00.000Z' });
    this.delayed = delayed;
    this.executeCount = 0;
  }

  async execute(intent, options = {}) {
    this.executeCount += 1;
    process.send?.({ type: 'connector.started', actionIntentId: intent.id, executeCount: this.executeCount });
    if (!this.delayed) return super.execute(intent, options);
    return new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('connector result uncertain'), { code: 'CONNECTOR_ABORTED' }));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

const tracker = new OperationTracker();
const logger = createJsonlLogger({ path: logPath });
let barrierTriggered = false;
const store = new EventStore(databasePath, {
  faultInjector(label) {
    if (!['transaction', 'transaction-crash'].includes(mode) || label !== 'after-event-append' || barrierTriggered) return;
    barrierTriggered = true;
    process.send?.({ type: 'transaction.inside' });
    const waitMs = mode === 'transaction-crash' ? 10_000 : 350;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  },
});
const connector = new DelayedConnector({ delayed: mode === 'connector' });
const service = new RelayService({
  store,
  scenarioConfigs: loadScenarioConfigs(resolve('scenarios')),
  connector,
  operationTracker: tracker,
  logger,
  connectorDeadlineMs: 10_000,
  clock: () => '2026-08-26T09:00:00.000Z',
});

async function seedProviderCase() {
  const id = 'ops-child-provider-case';
  await service.executeCommand(id, command('workCase.create', {
    id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'provider shutdown case',
    ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'request advisory',
    trigger: {
      id: `${id}:trigger`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
      observedAt: '2026-08-26T09:00:00.000Z', dedupeKey: `supplyChain:${id}`,
      payloadRef: { systemId: 'core-system', recordType: 'provider', recordId: id, observedVersion: '1' },
    }, scenarioExtensions: {},
  }, 0));
  await service.executeCommand(id, command('goal.propose', { id: `${id}:goal`, statement: '保持 provider 零权威写', constraints: [], evidenceIds: [] }, 1));
  await service.executeCommand(id, command('goal.accept', { goalId: `${id}:goal` }, 2));
  await service.executeCommand(id, command('evidence.attach', { evidence: {
    id: `${id}:evidence`, sourceRef: { systemId: 'core-system' },
    recordRef: { systemId: 'core-system', recordType: 'provider', recordId: id, observedVersion: '1' },
    observedAt: '2026-08-26T09:00:00.000Z', contentHash: 'a'.repeat(64), classification: 'internal', summary: 'synthetic provider evidence',
  } }, 3));
  await service.executeCommand(id, command('context.publish', {
    id: `${id}:context`, evidenceIds: [`${id}:evidence`], purpose: 'provider shutdown',
    allowedDecisionUses: ['conflict.identify'], freshnessPolicy: { maxAgeMinutes: 60 },
  }, 4));
  return {
    id,
    request: {
      providerRequestId: 'ops-child-provider-request', operation: 'conflict.identify', workCaseId: id,
      goalVersion: 1, contextVersion: 1, inputRefs: [`${id}:evidence`], outputSchemaVersion: 1,
      promptVersion: 'ops-v1', evaluationVersion: 'ops-eval-v1', traceId: 'trace-ops-child-provider',
      deadlineMs: 15_000, dataClassification: 'internal',
    },
  };
}

async function seedConnectorCase() {
  const id = 'ops-child-connector-case';
  await service.executeCommand(id, command('workCase.create', {
    id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'connector shutdown case',
    ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'execute connector',
    trigger: {
      id: `${id}:trigger`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
      observedAt: '2026-08-26T09:00:00.000Z', dedupeKey: `supplyChain:${id}`,
      payloadRef: { systemId: 'core-system', recordType: 'connector', recordId: id, observedVersion: '1' },
    }, scenarioExtensions: {},
  }, 0));
  await service.executeCommand(id, command('goal.propose', { id: `${id}:goal`, statement: '持久化 unknown receipt', constraints: [], evidenceIds: [] }, 1));
  await service.executeCommand(id, command('goal.accept', { goalId: `${id}:goal` }, 2));
  await service.executeCommand(id, command('evidence.attach', { evidence: {
    id: `${id}:evidence`, sourceRef: { systemId: 'core-system' },
    recordRef: { systemId: 'core-system', recordType: 'connector', recordId: id, observedVersion: '1' },
    observedAt: '2026-08-26T09:00:00.000Z', contentHash: 'b'.repeat(64), classification: 'internal', summary: 'synthetic connector evidence',
  } }, 3));
  await service.executeCommand(id, command('context.publish', {
    id: `${id}:context`, evidenceIds: [`${id}:evidence`], purpose: 'connector shutdown',
    allowedDecisionUses: ['action.authorize'], freshnessPolicy: { maxAgeMinutes: 60 },
  }, 4));
  await service.executeCommand(id, command('action.propose', {
    id: `${id}:action`, systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'succeeded' },
    requiredGateIds: [], idempotencyKey: `${id}:external-idempotency`,
  }, 5));
  await service.executeCommand(id, command('action.authorize', { actionIntentId: `${id}:action` }, 6));
  return {
    id,
    executeEnvelope: command('action.execute', { actionIntentId: `${id}:action` }, 7, { kind: 'human', id: 'human-owner' }, {
      commandId: `${id}:execute`, idempotencyKey: `${id}:command-idempotency`, traceId: 'trace-ops-child-connector',
    }),
  };
}

let seed = null;
let advisoryService = null;
if (mode === 'provider') {
  seed = await seedProviderCase();
  const provider = {
    providerId: 'ops-delayed-provider', model: 'ops-delayed-v1',
    async suggest(_request, { signal } = {}) {
      process.send?.({ type: 'provider.started' });
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('provider aborted'), { name: 'AbortError' }));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    },
    health() { return { status: 'ready', providerId: this.providerId, model: this.model }; },
  };
  advisoryService = new AdvisoryService({ getWorkCase: (id) => service.getWorkCase(id), provider, logger });
} else if (['connector', 'connector-retry'].includes(mode)) {
  if (mode === 'connector') seed = await seedConnectorCase();
}

const server = createRelayHttpServer({
  service,
  ...(advisoryService ? { advisoryService } : {}),
  operationTracker: tracker,
  logger,
  onBodyRead: mode === 'normal' ? () => process.send?.({ type: 'normal.body_started' }) : null,
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const address = server.address();

let shutdownPromise = null;
async function requestShutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = shutdownRelayServer(server, store, {
    signal, timeoutMs: 10_000, operationTracker: tracker, advisoryRuntime: server.advisoryRuntime, logger,
  });
  try {
    const result = await shutdownPromise;
    process.send?.({
      type: 'fixture.stopped', status: 'completed', signal, elapsedMs: result.elapsedMs,
      connectorExecuteCount: connector.executeCount, checkpointBusy: result.checkpoint.busy,
      storeClosed: store.closed, advisoryClosed: server.advisoryRuntime?.closed ?? true,
      loggerClosed: logger.closed,
    });
    process.exitCode = 0;
    process.disconnect?.();
    return result;
  } catch (error) {
    process.send?.({ type: 'fixture.stopped', status: 'failed', signal, errorCode: error.code ?? 'SHUTDOWN_FAILED', connectorExecuteCount: connector.executeCount });
    process.exitCode = 1;
    process.disconnect?.();
    throw error;
  }
}

const removeSignals = registerShutdownSignals((signal) => { requestShutdown(signal).catch(() => {}); });
process.on('message', (message) => {
  if (message?.type === 'relayos.shutdown') requestShutdown(message.signal ?? 'SIGTERM').catch(() => {});
});
process.on('exit', () => removeSignals());

process.send?.({
  type: 'fixture.ready', mode, host: '127.0.0.1', port: address.port,
  audit: store.auditSnapshot(), seed,
});
