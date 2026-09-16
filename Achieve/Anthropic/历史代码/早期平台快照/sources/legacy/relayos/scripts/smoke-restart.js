import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PRODUCTION_CHILD = resolve(ROOT, 'src', 'index.js');
const FIXTURE_CHILD = resolve(ROOT, 'test', 'fixtures', 'ops-runtime-child.mjs');
const DEADLINE_MS = 10_000;
const activeChildren = new Set();

function safeChildEnvironment(overrides = {}) {
  const allowed = [
    'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'PATH',
    'Path', 'PATHEXT', 'WINDIR', 'windir', 'NODE_NO_WARNINGS',
  ];
  const environment = {};
  for (const key of allowed) if (process.env[key] !== undefined) environment[key] = process.env[key];
  return { ...environment, NODE_NO_WARNINGS: '1', ...overrides };
}

function createChild(modulePath, args, env = safeChildEnvironment()) {
  const child = fork(modulePath, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  activeChildren.add(child);
  let stdout = '';
  let stderr = '';
  const queued = [];
  const waiters = [];
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('message', (message) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else queued.push(message);
  });
  const exit = new Promise((resolveExit) => child.once('exit', (code, signal) => {
    activeChildren.delete(child);
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Child exited before expected IPC message: code=${code} signal=${signal}; stderr=${stderr}`));
    }
    resolveExit({ code, signal, stdout, stderr });
  }));
  return {
    child,
    exit,
    output: () => ({ stdout, stderr }),
    waitFor(predicate, label, timeoutMs = DEADLINE_MS) {
      const index = queued.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolveWait, reject) => {
        const waiter = { predicate, resolve: resolveWait, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const position = waiters.indexOf(waiter);
          if (position >= 0) waiters.splice(position, 1);
          reject(new Error(`Timed out waiting for ${label}; stderr=${stderr}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    sendShutdown(signal = 'SIGTERM') {
      child.send({ type: 'relayos.shutdown', signal });
    },
    async forceStop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return exit;
    },
  };
}

function fixture(mode, databasePath, logPath) {
  return createChild(FIXTURE_CHILD, [mode, databasePath, logPath]);
}

function production(databasePath, logPath, secretCanary) {
  return createChild(PRODUCTION_CHILD, [], safeChildEnvironment({
    PORT: '0',
    RELAYOS_DB_PATH: databasePath,
    RELAYOS_SCENARIO_DIR: resolve(ROOT, 'scenarios'),
    RELAYOS_PUBLIC_DIR: resolve(ROOT, 'public'),
    RELAYOS_LOG_PATH: logPath,
    RELAYOS_LOG_LEVEL: 'info',
    RELAYOS_CONNECTOR: 'mock',
    RELAYOS_DEMO_MODE: 'true',
    RELAYOS_SCHEMA_MIGRATION: 'auto',
    RELAYOS_SHUTDOWN_TIMEOUT_MS: String(DEADLINE_MS),
    ADVISORY_PROVIDER: 'mock',
    RELAYOS_PROVIDER_TELEMETRY_PATH: ':memory:',
    RELAYOS_ZAI_GENERAL_API_KEY: secretCanary,
  }));
}

async function jsonRequest(baseUrl, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? { origin: baseUrl } : { origin: baseUrl, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  return { status: response.status, body: contentType.includes('json') ? await response.json() : await response.text() };
}

function createEnvelope(id, suffix = 'create') {
  return {
    commandId: `smoke-${id}-${suffix}`,
    idempotencyKey: `smoke-${id}-${suffix}-idempotency`,
    expectedStreamVersion: 0,
    configurationVersion: 1,
    commandType: 'workCase.create',
    demoActorRef: { kind: 'human', id: 'human-owner' },
    identityAssurance: 'demo_unverified',
    traceId: `trace-smoke-${id}-${suffix}`,
    payload: {
      id,
      organizationId: 'org-demo',
      scenarioKey: 'supplyChain',
      title: `P6 ${suffix} smoke`,
      ownerActorRef: { kind: 'human', id: 'human-owner' },
      nextAction: 'verify shutdown',
      trigger: {
        id: `${id}:trigger`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
        observedAt: '2026-08-26T09:00:00.000Z', dedupeKey: `supplyChain:${id}`,
        payloadRef: { systemId: 'core-system', recordType: 'ops-smoke', recordId: id, observedVersion: '1' },
      },
      scenarioExtensions: {},
    },
  };
}

async function awaitChildExit(controller, label, timeoutMs = DEADLINE_MS) {
  let timer;
  try {
    return await Promise.race([
      controller.exit,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label} process exit.`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopGracefully(controller, stoppedType) {
  const startedAt = Date.now();
  controller.sendShutdown('SIGTERM');
  const stopped = await controller.waitFor((message) => message?.type === stoppedType, stoppedType, DEADLINE_MS);
  const wallMs = Date.now() - startedAt;
  assert.equal(stopped.status, 'completed', JSON.stringify(stopped));
  assert.equal(stopped.checkpointBusy, 0, JSON.stringify(stopped));
  assert.equal(stopped.storeClosed, true, JSON.stringify(stopped));
  assert.equal(stopped.advisoryClosed, true, JSON.stringify(stopped));
  assert.equal(stopped.loggerClosed, true, JSON.stringify(stopped));
  assert(wallMs < DEADLINE_MS, `Shutdown wall time exceeded ${DEADLINE_MS}ms.`);
  const exited = await awaitChildExit(controller, stoppedType, Math.max(1, DEADLINE_MS - wallMs));
  assert.equal(exited.code, 0, exited.stderr);
  return { ...stopped, wallMs };
}

function assertEphemeralReady(ready) {
  assert.equal(ready.host, '127.0.0.1');
  assert(Number.isInteger(ready.port) && ready.port > 0);
  assert.notEqual(ready.port, 4177);
}

async function freshAndRestart(directory, secretCanary) {
  const databasePath = join(directory, 'restart.db');
  const logPath = join(directory, 'restart.jsonl');
  const id = 'ops-restart-case';
  let child = production(databasePath, logPath, secretCanary);
  const firstReady = await child.waitFor((message) => message?.type === 'relayos.ready', 'production fresh ready');
  assertEphemeralReady(firstReady);
  assert.equal(firstReady.gate, 'P6');
  const firstBase = `http://${firstReady.host}:${firstReady.port}`;
  const ready = await jsonRequest(firstBase, '/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.persistence.schemaVersion, 2);
  assert.equal(ready.body.persistence.journalMode, 'wal');
  const created = await jsonRequest(firstBase, '/api/work-cases', { method: 'POST', body: createEnvelope(id) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const before = await jsonRequest(firstBase, `/api/work-cases/${id}`);
  const beforeReplay = await jsonRequest(firstBase, `/api/work-cases/${id}/replay`);
  assert.equal(before.status, 200);
  assert.equal(before.body.canonicalStateHash, beforeReplay.body.canonicalStateHash);
  const firstStop = await stopGracefully(child, 'relayos.stopped');

  child = production(databasePath, logPath, secretCanary);
  const secondReady = await child.waitFor((message) => message?.type === 'relayos.ready', 'production restart ready');
  assertEphemeralReady(secondReady);
  const secondBase = `http://${secondReady.host}:${secondReady.port}`;
  const restartedReady = await jsonRequest(secondBase, '/health/ready');
  const after = await jsonRequest(secondBase, `/api/work-cases/${id}`);
  const afterReplay = await jsonRequest(secondBase, `/api/work-cases/${id}/replay`);
  assert.equal(restartedReady.status, 200);
  assert.equal(restartedReady.body.persistence.schemaVersion, 2);
  assert.equal(restartedReady.body.persistence.journalMode, 'wal');
  assert.deepEqual(after.body, before.body);
  assert.equal(afterReplay.body.canonicalStateHash, beforeReplay.body.canonicalStateHash);
  const secondStop = await stopGracefully(child, 'relayos.stopped');
  return {
    host: firstReady.host,
    portsWereEphemeral: firstReady.port !== 4177 && secondReady.port !== 4177,
    schemaVersion: ready.body.persistence.schemaVersion,
    journalMode: ready.body.persistence.journalMode,
    canonicalStateHash: before.body.canonicalStateHash,
    firstShutdownMs: firstStop.wallMs,
    secondShutdownMs: secondStop.wallMs,
    databasePath,
    logPath,
  };
}

function slowJsonRequest(baseUrl, path, body, waitForBodyStarted, onStarted) {
  const payload = Buffer.from(JSON.stringify(body));
  const split = Math.max(1, Math.floor(payload.length / 2));
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveRequest, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        origin: baseUrl,
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolveRequest({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.write(payload.subarray(0, split));
    waitForBodyStarted.then(() => {
      onStarted();
      request.end(payload.subarray(split));
    }, reject);
  });
}

async function normalInFlight(directory) {
  const databasePath = join(directory, 'normal.db');
  const logPath = join(directory, 'normal.jsonl');
  const child = fixture('normal', databasePath, logPath);
  const ready = await child.waitFor((message) => message?.type === 'fixture.ready', 'normal fixture ready');
  assertEphemeralReady(ready);
  const base = `http://${ready.host}:${ready.port}`;
  const bodyStarted = child.waitFor((message) => message?.type === 'normal.body_started', 'normal body started');
  let shutdownStartedAt = 0;
  const responsePromise = slowJsonRequest(base, '/api/work-cases', createEnvelope('ops-normal-case', 'normal'), bodyStarted, () => {
    shutdownStartedAt = Date.now();
    child.sendShutdown('SIGTERM');
  });
  const response = await responsePromise;
  const stopped = await child.waitFor((message) => message?.type === 'fixture.stopped', 'normal fixture stopped');
  const wallMs = Date.now() - shutdownStartedAt;
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.checkpointBusy, 0);
  assert.equal(stopped.storeClosed, true);
  assert.equal(stopped.advisoryClosed, true);
  assert.equal(stopped.loggerClosed, true);
  assert(wallMs < DEADLINE_MS);
  const exited = await awaitChildExit(child, 'normal fixture', Math.max(1, DEADLINE_MS - wallMs));
  assert.equal(exited.code, 0, exited.stderr);
  return { status: response.status, streamVersion: response.body.streamVersion, shutdownWallMs: wallMs, databasePath, logPath };
}

async function transactionInFlight(directory) {
  const databasePath = join(directory, 'transaction.db');
  const logPath = join(directory, 'transaction.jsonl');
  const child = fixture('transaction', databasePath, logPath);
  const ready = await child.waitFor((message) => message?.type === 'fixture.ready', 'transaction fixture ready');
  assertEphemeralReady(ready);
  const base = `http://${ready.host}:${ready.port}`;
  const responsePromise = jsonRequest(base, '/api/work-cases', { method: 'POST', body: createEnvelope('ops-transaction-case', 'transaction') });
  await child.waitFor((message) => message?.type === 'transaction.inside', 'transaction in-flight');
  const shutdownStartedAt = Date.now();
  child.sendShutdown('SIGTERM');
  const response = await responsePromise;
  const stopped = await child.waitFor((message) => message?.type === 'fixture.stopped', 'transaction fixture stopped');
  const wallMs = Date.now() - shutdownStartedAt;
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.streamVersion, 1);
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.checkpointBusy, 0);
  assert.equal(stopped.storeClosed, true);
  assert.equal(stopped.advisoryClosed, true);
  assert.equal(stopped.loggerClosed, true);
  assert(wallMs < DEADLINE_MS);
  assert.equal((await awaitChildExit(child, 'transaction fixture', Math.max(1, DEADLINE_MS - wallMs))).code, 0);

  const reopened = fixture('normal', databasePath, join(directory, 'transaction-restart.jsonl'));
  const reopenedReady = await reopened.waitFor((message) => message?.type === 'fixture.ready', 'transaction restart ready');
  assertEphemeralReady(reopenedReady);
  assert.equal(reopenedReady.audit.counts.streams, 1);
  assert.equal(reopenedReady.audit.counts.events, 1);
  assert.equal(reopenedReady.audit.counts.commandReceipts, 1);
  await stopGracefully(reopened, 'fixture.stopped');
  return { outcome: 'fully_committed', shutdownWallMs: wallMs, audit: reopenedReady.audit, logPath };
}

async function providerInFlight(directory) {
  const databasePath = join(directory, 'provider.db');
  const logPath = join(directory, 'provider.jsonl');
  const child = fixture('provider', databasePath, logPath);
  const ready = await child.waitFor((message) => message?.type === 'fixture.ready', 'provider fixture ready');
  assertEphemeralReady(ready);
  const before = ready.audit;
  const base = `http://${ready.host}:${ready.port}`;
  const responsePromise = jsonRequest(base, '/api/advisories', { method: 'POST', body: ready.seed.request });
  await child.waitFor((message) => message?.type === 'provider.started', 'provider in-flight');
  const shutdownStartedAt = Date.now();
  child.sendShutdown('SIGTERM');
  const response = await responsePromise;
  const stopped = await child.waitFor((message) => message?.type === 'fixture.stopped', 'provider fixture stopped');
  const wallMs = Date.now() - shutdownStartedAt;
  assert.equal(response.status, 503, JSON.stringify(response.body));
  assert.equal(response.body.error.code, 'ADVISORY_UNAVAILABLE');
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.checkpointBusy, 0);
  assert.equal(stopped.storeClosed, true);
  assert.equal(stopped.advisoryClosed, true);
  assert.equal(stopped.loggerClosed, true);
  assert(wallMs < DEADLINE_MS);
  assert.equal((await awaitChildExit(child, 'provider fixture', Math.max(1, DEADLINE_MS - wallMs))).code, 0);
  const reopened = fixture('normal', databasePath, join(directory, 'provider-restart.jsonl'));
  const reopenedReady = await reopened.waitFor((message) => message?.type === 'fixture.ready', 'provider restart ready');
  assertEphemeralReady(reopenedReady);
  assert.deepEqual(reopenedReady.audit, before);
  await stopGracefully(reopened, 'fixture.stopped');
  return { httpStatus: response.status, errorCode: response.body.error.code, authorityWrites: 0, shutdownWallMs: wallMs, logPath };
}

async function connectorInFlight(directory) {
  const databasePath = join(directory, 'connector.db');
  const logPath = join(directory, 'connector.jsonl');
  const child = fixture('connector', databasePath, logPath);
  const ready = await child.waitFor((message) => message?.type === 'fixture.ready', 'connector fixture ready');
  assertEphemeralReady(ready);
  const base = `http://${ready.host}:${ready.port}`;
  const responsePromise = jsonRequest(base, `/api/work-cases/${ready.seed.id}/commands`, { method: 'POST', body: ready.seed.executeEnvelope });
  await child.waitFor((message) => message?.type === 'connector.started', 'connector in-flight');
  const shutdownStartedAt = Date.now();
  child.sendShutdown('SIGTERM');
  const response = await responsePromise;
  const stopped = await child.waitFor((message) => message?.type === 'fixture.stopped', 'connector fixture stopped');
  const wallMs = Date.now() - shutdownStartedAt;
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const receipt = response.body.state.executionReceipts.at(-1);
  assert.equal(receipt.status, 'unknown');
  assert.equal(receipt.completedAt, null);
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.checkpointBusy, 0);
  assert.equal(stopped.storeClosed, true);
  assert.equal(stopped.advisoryClosed, true);
  assert.equal(stopped.loggerClosed, true);
  assert.equal(stopped.connectorExecuteCount, 1);
  assert(wallMs < DEADLINE_MS);
  assert.equal((await awaitChildExit(child, 'connector fixture', Math.max(1, DEADLINE_MS - wallMs))).code, 0);

  const retryChild = fixture('connector-retry', databasePath, join(directory, 'connector-retry.jsonl'));
  const retryReady = await retryChild.waitFor((message) => message?.type === 'fixture.ready', 'connector retry ready');
  assertEphemeralReady(retryReady);
  const retryBase = `http://${retryReady.host}:${retryReady.port}`;
  const retryEnvelope = {
    ...ready.seed.executeEnvelope,
    commandId: `${ready.seed.executeEnvelope.commandId}:retry`,
    expectedStreamVersion: 999,
    traceId: 'trace-ops-child-connector-retry',
  };
  const retry = await jsonRequest(retryBase, `/api/work-cases/${ready.seed.id}/commands`, { method: 'POST', body: retryEnvelope });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.deepEqual(retry.body, response.body);
  const retryStopped = await stopGracefully(retryChild, 'fixture.stopped');
  assert.equal(retryStopped.connectorExecuteCount, 0);
  return {
    status: receipt.status,
    completedAt: receipt.completedAt,
    restartQueryable: retryReady.audit.counts.streams === 1,
    idempotentRetryConnectorCalls: retryStopped.connectorExecuteCount,
    shutdownWallMs: wallMs,
    logPath,
  };
}

async function abruptTransactionRecovery(directory) {
  const databasePath = join(directory, 'transaction-crash.db');
  const logPath = join(directory, 'transaction-crash.jsonl');
  const child = fixture('transaction-crash', databasePath, logPath);
  const ready = await child.waitFor((message) => message?.type === 'fixture.ready', 'transaction crash fixture ready');
  assertEphemeralReady(ready);
  const base = `http://${ready.host}:${ready.port}`;
  const responsePromise = jsonRequest(base, '/api/work-cases', { method: 'POST', body: createEnvelope('ops-crash-case', 'crash') }).catch((error) => ({ error }));
  await child.waitFor((message) => message?.type === 'transaction.inside', 'crash transaction in-flight');
  const deliveredSignal = process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL';
  const killed = child.child.kill(deliveredSignal);
  assert.equal(killed, true);
  const exit = await awaitChildExit(child, 'abrupt transaction fixture');
  assert.notEqual(exit.code, 0);
  await responsePromise;

  const reopened = fixture('normal', databasePath, join(directory, 'transaction-crash-restart.jsonl'));
  const reopenedReady = await reopened.waitFor((message) => message?.type === 'fixture.ready', 'crash restart ready');
  assertEphemeralReady(reopenedReady);
  assert.deepEqual(reopenedReady.audit.counts, { streams: 0, events: 0, projections: 0, commandReceipts: 0 });
  await stopGracefully(reopened, 'fixture.stopped');
  return {
    delivery: process.platform === 'win32' ? 'windows_process_kill_SIGTERM_uncatchable' : 'process_kill_SIGKILL',
    transactionOutcome: 'fully_rolled_back',
    audit: reopenedReady.audit,
    logPath,
  };
}

function verifyLogs(directory, secretCanary) {
  const paths = [
    'restart.jsonl', 'normal.jsonl', 'transaction.jsonl', 'transaction-restart.jsonl',
    'provider.jsonl', 'provider-restart.jsonl', 'connector.jsonl', 'connector-retry.jsonl',
    'transaction-crash.jsonl', 'transaction-crash-restart.jsonl',
  ].map((name) => join(directory, name)).filter(existsSync);
  let records = 0;
  let bytes = 0;
  for (const path of paths) {
    const text = readFileSync(path, 'utf8');
    bytes += Buffer.byteLength(text);
    assert.equal(text.includes(secretCanary), false, `Secret canary leaked to ${path}.`);
    assert.doesNotMatch(text, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\bsk-[A-Za-z0-9_-]{20,}/i);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line);
      const inspectKeys = (value) => {
        if (Array.isArray(value)) return value.forEach(inspectKeys);
        if (!value || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
          assert.equal(/^(?:authorization|api[_-]?key|prompt|response|cookie|password|secret|token)$/i.test(key), false, `Forbidden JSONL key ${key}.`);
          inspectKeys(nested);
        }
      };
      inspectKeys(record);
      assert.equal(record.service, 'relayos');
      assert.equal(typeof record.event, 'string');
      assert.equal(typeof record.authority, 'string');
      assert.equal(typeof record.resultStatus, 'string');
      assert.equal(typeof record.latencyMs, 'number');
      records += 1;
    }
  }
  assert(records > 0);
  return { files: paths.length, records, bytes, secretCredentialPromptResponseMatches: 0 };
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p6-restart-'));
  const secretCanary = `p6_canary_${createHash('sha256').update(randomUUID()).digest('hex')}`;
  const startedAt = Date.now();
  try {
    const restart = await freshAndRestart(directory, secretCanary);
    assert.equal(restart.portsWereEphemeral, true);
    const normal = await normalInFlight(directory);
    const transaction = await transactionInFlight(directory);
    const provider = await providerInFlight(directory);
    const connector = await connectorInFlight(directory);
    const abrupt = await abruptTransactionRecovery(directory);
    const logs = verifyLogs(directory, secretCanary);
    const evidence = {
      status: 'PASS',
      platform: process.platform,
      nodeVersion: process.versions.node,
      hostDefaultVerified: restart.host,
      allRequestedPortsWereZero: true,
      gracefulDelivery: 'real_child_ipc_to_production_SIGTERM_shutdown_entry',
      literalPosixSigtermVerified: process.platform !== 'win32' && false,
      restart, normal, transaction, provider, connector, abrupt, logs,
      elapsedMs: Date.now() - startedAt,
      cleanup: 'temporary DB/WAL/SHM/JSONL directory removed after verification',
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await Promise.allSettled([...activeChildren].map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (child.exitCode === null && child.signalCode === null) await new Promise((resolveExit) => child.once('exit', resolveExit));
    }));
    const tempRoot = resolve(tmpdir());
    const relative = resolve(directory).slice(tempRoot.length);
    assert(relative.startsWith('\\') || relative.startsWith('/'), 'Refusing to clean a directory outside the OS temp root.');
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[P6 restart smoke] FAIL ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
