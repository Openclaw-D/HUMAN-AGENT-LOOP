import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { createConfiguredProvider, defaultDeadlineForOperation, loadProviderRuntimeConfig } from '../src/config/provider-runtime.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { ProviderTelemetryRepository } from '../src/persistence/provider-telemetry.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ResilientAdvisoryProvider } from '../src/providers/resilience.js';
import { ZaiGeneralProvider } from '../src/providers/zai-general-provider.js';
import { advisoryRequest, authoritativeSnapshot, createHarness, createWorkCase, seedGoalAndContext } from './helpers.js';

async function seed(id = 'case-zero-write') {
  const harness = createHarness();
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
  return harness;
}

function advisoryService(harness, rawProvider, telemetry = null, options = {}) {
  const provider = new ResilientAdvisoryProvider(rawProvider, { sleep: async () => {}, random: () => 0, ...options });
  return new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider, telemetry });
}

test('successful advisory changes only telemetry and leaves all authoritative counters/hash unchanged', async () => {
  const id = 'case-zero-write-success';
  const harness = await seed(id);
  const telemetry = new ProviderTelemetryRepository();
  try {
    const before = authoritativeSnapshot(harness.store, id);
    const result = await advisoryService(harness, new MockProvider(), telemetry).suggest(advisoryRequest(id));
    assert.equal(result.authority, 'none');
    assert.deepEqual(authoritativeSnapshot(harness.store, id), before);
    assert.equal(telemetry.count(), 1);
    assert.equal(harness.store.replayStream(id).canonicalStateHash, before.projectionHash);
  } finally { telemetry.close(); harness.close(); }
});

test('every provider failure class leaves streamVersion/events/projection/command receipts exactly unchanged', async () => {
  const modes = ['timeout', 'network', '429', '5xx', '4xx', 'invalid-json', 'schema-mismatch', 'ambiguity', 'unsafe'];
  for (const mode of modes) {
    const id = `case-zero-${mode.replace(/[^a-z0-9]/g, '-')}`;
    const harness = await seed(id);
    const telemetry = new ProviderTelemetryRepository();
    try {
      const before = authoritativeSnapshot(harness.store, id);
      await assert.rejects(() => advisoryService(harness, new MockProvider({ mode }), telemetry).suggest(advisoryRequest(id)), (error) => error.code === 'ADVISORY_UNAVAILABLE');
      assert.deepEqual(authoritativeSnapshot(harness.store, id), before, mode);
      assert.equal(telemetry.count(), 1);
      assert.equal(telemetry.list()[0].status, 'failed');
    } finally { telemetry.close(); harness.close(); }
  }
});

test('telemetry write failure cannot alter domain or turn a valid advisory into failure', async () => {
  const id = 'case-telemetry-failure';
  const harness = await seed(id);
  const telemetry = { record() { throw new Error('injected telemetry failure'); }, health() { return { status: 'error' }; } };
  try {
    const before = authoritativeSnapshot(harness.store, id);
    const service = advisoryService(harness, new MockProvider(), telemetry);
    assert.equal((await service.suggest(advisoryRequest(id))).authority, 'none');
    assert.deepEqual(authoritativeSnapshot(harness.store, id), before);
    assert.equal(service.health().telemetry.status, 'degraded');
  } finally { harness.close(); }
});

test('sanitized telemetry stores usage and hashes but no secret, Authorization, prompt, response, or recommendation body', async () => {
  const id = 'case-telemetry-redaction';
  const harness = await seed(id);
  const telemetry = new ProviderTelemetryRepository();
  const secret = 'dedicated-runtime-secret-test-only';
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    const result = { authority: 'none', status: 'advisory', providerId: 'zai-general', model: 'glm-5.3', outputSchemaVersion: 1, recommendations: [{ kind: 'conflict', summary: 'Sensitive complete response body that must not be stored.', evidenceIds: request.inputRefs, confidence: 0.9, requiresHumanReview: true }], traceId: request.traceId };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const raw = new ZaiGeneralProvider({ apiKey: secret, baseUrl: 'http://127.0.0.1:49152/api/paas/v4/', model: 'glm-5.3', fetchImpl: fakeFetch });
    await advisoryService(harness, raw, telemetry).suggest(advisoryRequest(id));
    const serialized = JSON.stringify(telemetry.list());
    for (const forbidden of [secret, 'Bearer ', 'Sensitive complete response body', 'messages', 'recommendations', 'complete prompt']) assert.equal(serialized.includes(forbidden), false, forbidden);
    const row = telemetry.list()[0];
    assert.deepEqual([row.promptTokens, row.completionTokens, row.totalTokens], [7, 9, 16]);
    assert.match(row.inputHash, /^[0-9a-f]{64}$/);
    assert.match(row.outputHash, /^[0-9a-f]{64}$/);
  } finally { telemetry.close(); harness.close(); }
});

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP advisory failure uses unified unavailable envelope, never fallback-to-Mock, and core readiness stays healthy', async () => {
  const id = 'case-http-advisory-failure';
  const harness = await seed(id);
  const raw = new MockProvider({ mode: 'network' });
  const advisory = advisoryService(harness, raw);
  const server = createRelayHttpServer({ service: harness.service, advisoryService: advisory });
  const base = await listen(server);
  try {
    const before = authoritativeSnapshot(harness.store, id);
    const response = await fetch(`${base}/api/advisories`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-trace-id': 'trace-http-provider' }, body: JSON.stringify(advisoryRequest(id)) });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'ADVISORY_UNAVAILABLE');
    assert.equal(body.error.details.category, 'network');
    assert.equal(body.error.traceId, 'trace-http-provider');
    assert.equal(raw.callCount, 2);
    assert.deepEqual(authoritativeSnapshot(harness.store, id), before);
    for (let index = 0; index < 4; index += 1) await assert.rejects(() => advisory.suggest(advisoryRequest(id, 'conflict.identify', { providerRequestId: `provider-http-breaker-${index}` })));
    const readyResponse = await fetch(`${base}/health/ready`);
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.persistence.eventChain.status, 'verified');
    assert.equal(ready.advisoryProvider.status, 'degraded');
  } finally { await new Promise((resolve) => server.close(resolve)); harness.close(); }
});

test('runtime config defaults to mock, zai-general fails closed without dedicated secret, and deadlines stay in range', () => {
  const mock = loadProviderRuntimeConfig({});
  assert.equal(mock.providerMode, 'mock');
  assert.equal(createConfiguredProvider(mock).providerId, 'mock');
  assert.equal(defaultDeadlineForOperation('material.extract', mock), 8_000);
  assert.equal(defaultDeadlineForOperation('context.summarize', mock), 8_000);
  assert.equal(defaultDeadlineForOperation('conflict.identify', mock), 15_000);
  assert.throws(() => loadProviderRuntimeConfig({ ADVISORY_PROVIDER: 'zai-general' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
  assert.throws(() => loadProviderRuntimeConfig({ ADVISORY_PROVIDER: 'zai-general', RELAYOS_ZAI_GENERAL_API_KEY: 'test-only', RELAYOS_ZAI_GENERAL_BASE_URL: 'https://example.invalid/api/paas/v4/' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
  assert.throws(() => loadProviderRuntimeConfig({ ADVISORY_PROVIDER: 'zai-general', RELAYOS_ZAI_GENERAL_API_KEY: 'test-only', RELAYOS_ZAI_GENERAL_MODEL: 'glm-5' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
  assert.throws(() => loadProviderRuntimeConfig({ RELAYOS_ADVISORY_FAST_DEADLINE_MS: '2999' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
  assert.throws(() => loadProviderRuntimeConfig({ RELAYOS_ADVISORY_STANDARD_DEADLINE_MS: '30001' }), (error) => error.code === 'ADVISORY_CONFIGURATION_INVALID');
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
}

test('provider runtime source has no development credential name, dedicated endpoint, development adapter, or automatic fallback', () => {
  const files = [...walk(resolve('src/providers')), ...walk(resolve('src/config')), resolve('src/application/advisory-service.js'), resolve('src/http/advisory-runtime.js')];
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const developmentCredentialName = ['ZAI', 'API', 'KEY'].join('_');
  const dedicatedPath = ['api', 'coding', 'paas', 'v4'].join('/');
  const developmentAdapter = ['glm53', 'coding', 'agent'].join('-');
  assert.equal(source.includes(developmentCredentialName), false);
  assert.equal(source.includes(dedicatedPath), false);
  assert.equal(source.includes(developmentAdapter), false);
  assert.equal(source.includes('fallback-to-mock'), false);
});
