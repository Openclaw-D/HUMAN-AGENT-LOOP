import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { containsCredential, isAllowedSyntheticCredential } from '../src/observability/credential-scan.js';
import assert from 'node:assert/strict';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { createJsonlLogger } from '../src/observability/jsonl-logger.js';
import { OperationTracker } from '../src/ops/operation-tracker.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { CircuitBreaker, ResilientAdvisoryProvider } from '../src/providers/resilience.js';
import { advisoryRequest, createHarness, createWorkCase, dispatch, envelope, seedGoalAndContext } from './helpers.js';

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
  server.advisoryRuntime?.close?.();
}

test('credential scanner catches common credential forms without embedding fixtures in source', () => {
  const candidates = [
    `${'bear'}${'er'} ${'a'.repeat(24)}`,
    `${'Bas'}${'ic'} ${'b'.repeat(24)}`,
    `gh${'p_'}${'c'.repeat(36)}`,
    `eyJ${'d'.repeat(24)}.${'e'.repeat(12)}.${'f'.repeat(12)}`,
    `AI${'za'}${'g'.repeat(32)}`,
    `AS${'IA'}${'J'.repeat(16)}`,
    `api_${'key'}=${'h'.repeat(24)}`,
    `pass${'word'}="correct horse battery staple 2026"`,
  ];
  for (const candidate of candidates) assert.equal(containsCredential(candidate), true);
  assert.equal(containsCredential('providerStatus=degraded; credential values are excluded'), false);
});

test('credential scanner has zero false positives across the accepted source set', () => {
  const projectRoot = resolve('.');
  const accepted = [
    'PRODUCT_CONSTITUTION.md', 'SCENARIO_MATRIX.md', 'ARCHITECTURE_CONTRACT.md', 'DELIVERY_GATES.md',
    'P5_ACCEPTANCE.md', 'P5_VISUAL_ACCEPTANCE.md', 'P6_ACCEPTANCE.md', 'OPS.md', 'README.md', 'package.json',
    'src', 'scenarios', 'public', 'scripts', 'test',
  ];
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? [child] : [];
  });
  const files = accepted.flatMap((entry) => {
    const path = resolve(projectRoot, entry);
    if (!existsSync(path)) return [];
    return readdirSafe(path) ? walk(path) : [path];
  });
  const flagged = files.filter((path) => containsCredential(readFileSync(path), { allowSynthetic: isAllowedSyntheticCredential }))
    .map((path) => relative(projectRoot, path).replaceAll('\\', '/'));
  assert.deepEqual(flagged, []);
});

function readdirSafe(path) {
  try { readdirSync(path); return true; } catch { return false; }
}

test('JSONL logger recursively removes sensitive nested keys', () => {
  const lines = [];
  const logger = createJsonlLogger({ sink: (line) => lines.push(line) });
  const nested = {};
  for (const [parts, value] of [
    [['author', 'ization'], 'plain-sensitive-value'],
    [['api', 'Key'], 'plain-sensitive-value'],
    [['pro', 'mpt'], 'complete model input'],
    [['res', 'ponse'], 'complete model output'],
    [['cook', 'ie'], 'session material'],
    [['access', 'Token'], 'plain-sensitive-value'],
  ]) nested[parts.join('')] = value;
  logger.log('info', 'ops.sanitizer.probe', {
    inFlight: { active: 2, nested },
  });
  logger.close();
  const record = JSON.parse(lines[0]);
  assert.deepEqual(record.inFlight, { active: 2, nested: {} });
  const serialized = JSON.stringify(record);
  for (const forbidden of ['authorization', 'apiKey', 'prompt', 'response', 'cookie', 'accessToken', 'plain-sensitive-value', 'complete model']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('JSONL logger redacts credential-shaped strings in trace and core fields', () => {
  const lines = [];
  const logger = createJsonlLogger({ sink: (line) => lines.push(line) });
  const github = `gh${'p_'}${'q'.repeat(36)}`;
  const jwt = `eyJ${'r'.repeat(24)}.${'s'.repeat(12)}.${'t'.repeat(12)}`;
  const basic = `${'Bas'}${'ic'} ${'u'.repeat(24)}`;
  logger.log('error', github, {
    traceId: github,
    authority: basic,
    resultStatus: jwt,
    errorCode: github,
    httpPath: `/probe/${jwt}`,
  });
  logger.close();
  const record = JSON.parse(lines[0]);
  for (const key of ['event', 'traceId', 'authority', 'resultStatus', 'errorCode', 'httpPath']) assert.equal(record[key], '[REDACTED]');
  assert.equal(containsCredential(JSON.stringify(record)), false);
});

test('JSONL traces connect HTTP to provider and HTTP to adapter/domain receipt without sensitive payloads', async () => {
  const lines = [];
  const logger = createJsonlLogger({ sink: (line) => lines.push(line), clock: () => '2026-08-26T07:00:00.000Z' });
  const tracker = new OperationTracker();
  const harness = createHarness({ operationTracker: tracker, logger });
  const id = 'case-ops-trace';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify', 'action.authorize'] });
  const provider = new ResilientAdvisoryProvider(new MockProvider(), { sleep: async () => {}, random: () => 0 });
  const advisoryService = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider, logger });
  const server = createRelayHttpServer({ service: harness.service, advisoryService, operationTracker: tracker, logger });
  const base = await listen(server);
  try {
    const providerTrace = 'trace-ops-provider-chain';
    const advisory = advisoryRequest(id, 'conflict.identify', { traceId: providerTrace });
    const advisoryResponse = await fetch(`${base}/api/advisories`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-trace-id': providerTrace }, body: JSON.stringify(advisory),
    });
    assert.equal(advisoryResponse.status, 200);
    assert.equal((await advisoryResponse.json()).authority, 'none');

    await dispatch(harness, id, 'action.propose', {
      id: 'trace-action', systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'unknown' }, requiredGateIds: [], idempotencyKey: 'trace-external-key',
    });
    await dispatch(harness, id, 'action.authorize', { actionIntentId: 'trace-action' });
    const actionTrace = 'trace-ops-action-chain';
    const actionEnvelope = envelope('action.execute', { actionIntentId: 'trace-action' }, harness.store.getProjection(id).projectionVersion, { kind: 'human', id: 'human-owner' }, { traceId: actionTrace });
    const actionResponse = await fetch(`${base}/api/work-cases/${id}/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-trace-id': actionTrace }, body: JSON.stringify(actionEnvelope),
    });
    assert.equal(actionResponse.status, 200);
    assert.equal((await actionResponse.json()).state.executionReceipts.at(-1).status, 'unknown');

    logger.log('info', 'test.redaction.probe', {
      traceId: 'trace-redaction-probe', authorization: 'Bearer runtime-secret-canary',
      prompt: 'complete prompt runtime-secret-canary', response: 'complete response runtime-secret-canary',
    });
    const records = lines.map((line) => JSON.parse(line));
    for (const record of records) {
      for (const key of ['timestamp', 'level', 'serviceVersion', 'event', 'authority', 'resultStatus', 'latencyMs', 'errorCode']) assert(Object.hasOwn(record, key), `${record.event}/${key}`);
    }
    const providerEvents = records.filter((record) => record.traceId === providerTrace).map((record) => record.event);
    assert(providerEvents.includes('http.request.accepted'));
    assert(providerEvents.includes('provider.invocation.started'));
    assert(providerEvents.includes('provider.invocation.completed'));
    assert(providerEvents.includes('http.request.completed'));
    const actionEvents = records.filter((record) => record.traceId === actionTrace).map((record) => record.event);
    assert(actionEvents.includes('http.request.accepted'));
    assert(actionEvents.includes('adapter.execution.started'));
    assert(actionEvents.includes('adapter.execution.completed'));
    assert(actionEvents.includes('domain.command.committed'));
    assert(actionEvents.includes('http.request.completed'));
    const text = lines.join('');
    assert.equal(text.includes('runtime-secret-canary'), false);
    assert.equal(text.includes('SENSITIVE_BUSINESS_PAYLOAD'), false);
    assert.equal(/"prompt"|"response"|"authorization"/i.test(text), false);
  } finally {
    await close(server);
    harness.close();
    logger.close();
  }
});

test('log sink failure never changes domain result and readiness reports observability degraded', async () => {
  const logger = createJsonlLogger({ sink: () => { throw new Error('sink unavailable'); } });
  const tracker = new OperationTracker();
  const harness = createHarness({ operationTracker: tracker, logger });
  const server = createRelayHttpServer({ service: harness.service, operationTracker: tracker, logger });
  const base = await listen(server);
  try {
    const created = await createWorkCase(harness, { id: 'case-log-sink-failure' });
    assert.equal(created.streamVersion, 1);
    assert.equal(harness.store.getStats().events, 1);
    const readyResponse = await fetch(`${base}/health/ready`);
    assert.equal(readyResponse.status, 200);
    assert.equal((await readyResponse.json()).observability.status, 'degraded');
  } finally {
    await close(server);
    harness.close();
    logger.close();
  }
});

test('open provider circuit degrades advisory only while core reads and deterministic commands stay available', async () => {
  const harness = createHarness();
  const id = 'case-provider-degraded-core';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
  const raw = new MockProvider({ mode: 'network' });
  const breaker = new CircuitBreaker({ failureThreshold: 1 });
  const provider = new ResilientAdvisoryProvider(raw, { breaker, sleep: async () => {}, random: () => 0 });
  const advisoryService = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider });
  const server = createRelayHttpServer({ service: harness.service, advisoryService });
  const base = await listen(server);
  try {
    const advisoryResponse = await fetch(`${base}/api/advisories`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(advisoryRequest(id)),
    });
    assert.equal(advisoryResponse.status, 503);
    const readyResponse = await fetch(`${base}/health/ready`);
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.advisoryProvider.status, 'degraded');
    assert.equal((await fetch(`${base}/api/work-cases/${id}`)).status, 200);

    const nextId = 'case-core-while-provider-degraded';
    const body = envelope('workCase.create', {
      id: nextId, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'SENSITIVE_BUSINESS_PAYLOAD',
      ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'deterministic core',
      trigger: {
        id: `${nextId}:trigger`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
        observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: `supplyChain:${nextId}`,
        payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: nextId, observedVersion: '1' },
      }, scenarioExtensions: {},
    }, 0);
    assert.equal((await fetch(`${base}/api/work-cases`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) })).status, 201);
  } finally {
    await close(server);
    harness.close();
  }
});
