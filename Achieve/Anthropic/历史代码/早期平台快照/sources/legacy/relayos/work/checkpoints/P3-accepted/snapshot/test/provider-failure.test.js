import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { validateAdvisoryResult } from '../src/providers/contract.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { CircuitBreaker, ResilientAdvisoryProvider } from '../src/providers/resilience.js';
import { PROVIDER_TELEMETRY, ZaiGeneralProvider } from '../src/providers/zai-general-provider.js';
import { advisoryRequest, createHarness, createWorkCase, seedGoalAndContext } from './helpers.js';

async function seededService(rawProvider, options = {}) {
  const harness = createHarness();
  const id = options.id ?? 'case-provider-failure';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
  const provider = new ResilientAdvisoryProvider(rawProvider, { sleep: async () => {}, random: () => 0, ...options.resilience });
  return { harness, id, provider, service: new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider }) };
}

test('MockProvider deterministically reproduces timeout/network/429/5xx/4xx/invalid JSON/schema/ambiguity/unsafe failures', async () => {
  const cases = [
    ['timeout', 'timeout', 1], ['network', 'network', 2], ['429', 'rate_limit', 2], ['5xx', 'server_error', 2],
    ['4xx', 'client_error', 1], ['invalid-json', 'invalid_json', 1], ['schema-mismatch', 'schema_mismatch', 1],
    ['ambiguity', 'ambiguity', 1], ['unsafe', 'authority_violation', 1],
  ];
  for (const [mode, category, calls] of cases) {
    const raw = new MockProvider({ mode });
    const seeded = await seededService(raw, { id: `case-failure-${mode.replace(/[^a-z0-9]/g, '-')}` });
    try {
      await assert.rejects(() => seeded.service.suggest(advisoryRequest(seeded.id)), (error) => error.code === 'ADVISORY_UNAVAILABLE' && error.details.category === category);
      assert.equal(raw.callCount, calls, `${mode} retry count`);
    } finally { seeded.harness.close(); }
  }
});

test('only transient network/429/recoverable 5xx retry once and may recover', async () => {
  for (const mode of ['network', '429', '5xx']) {
    const raw = new MockProvider({ script: [mode, 'success'] });
    const seeded = await seededService(raw, { id: `case-retry-${mode}` });
    try {
      const result = await seeded.service.suggest(advisoryRequest(seeded.id));
      assert.equal(result.authority, 'none');
      assert.equal(raw.callCount, 2);
    } finally { seeded.harness.close(); }
  }
});

test('five transient failures in 60 seconds open for 30 seconds, then a successful half-open probe closes', async () => {
  let now = 10_000;
  const raw = new MockProvider({ mode: 'network' });
  const breaker = new CircuitBreaker({ clock: () => now });
  const provider = new ResilientAdvisoryProvider(raw, { clock: () => now, breaker, sleep: async () => {}, random: () => 0 });
  const request = advisoryRequest('case-breaker');
  for (let index = 0; index < 5; index += 1) await assert.rejects(() => provider.suggest(request), (error) => error.category === 'network');
  assert.equal(provider.health().circuit.state, 'open');
  const callsAtOpen = raw.callCount;
  await assert.rejects(() => provider.suggest(request), (error) => error.category === 'circuit_open');
  assert.equal(raw.callCount, callsAtOpen);
  now += 30_000;
  raw.setMode('success');
  assert.equal((await provider.suggest(request)).authority, 'none');
  assert.equal(provider.health().circuit.state, 'closed');
});

test('half-open admits only one concurrent probe', async () => {
  let now = 0;
  let mode = 'network';
  let release;
  const raw = {
    providerId: 'probe-provider', model: 'probe-v1',
    async suggest() {
      if (mode === 'network') throw Object.assign(new Error('network'), { name: 'TypeError' });
      return new Promise((resolve) => { release = resolve; });
    },
  };
  const provider = new ResilientAdvisoryProvider(raw, { clock: () => now, sleep: async () => {}, random: () => 0 });
  const request = advisoryRequest('case-half-open');
  for (let index = 0; index < 5; index += 1) await assert.rejects(() => provider.suggest(request));
  now += 30_000;
  mode = 'hold';
  const probe = provider.suggest(request);
  await Promise.resolve();
  await assert.rejects(() => provider.suggest(request), (error) => error.category === 'circuit_open');
  release({ authority: 'none' });
  await probe;
  assert.equal(provider.health().circuit.state, 'closed');
});

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}/api/paas/v4/`;
}

test('local fake General server verifies request/response, retry and usage without external network', async () => {
  let calls = 0;
  let observed = null;
  const server = createServer(async (request, response) => {
    calls += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed = { url: request.url, authorizationPresent: typeof request.headers.authorization === 'string', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    if (calls === 1) {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 1302 } }));
      return;
    }
    const requestBody = JSON.parse(observed.body.messages.at(-1).content);
    const result = { authority: 'none', status: 'advisory', providerId: 'zai-general', model: observed.body.model, outputSchemaVersion: 1, recommendations: [{ kind: 'conflict', summary: 'Local fake server advisory.', evidenceIds: requestBody.inputRefs, confidence: 0.9, requiresHumanReview: true }], traceId: requestBody.traceId };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 21, completion_tokens: 13, total_tokens: 34, prompt_tokens_details: { cached_tokens: 5 } } }));
  });
  const baseUrl = await listen(server);
  try {
    const raw = new ZaiGeneralProvider({ apiKey: 'runtime-test-only', baseUrl, model: 'glm-5.3' });
    const provider = new ResilientAdvisoryProvider(raw, { sleep: async () => {}, random: () => 0 });
    const request = advisoryRequest('case-local-general');
    const result = await provider.suggest(request);
    validateAdvisoryResult(result, request, { providerId: 'zai-general', model: 'glm-5.3' });
    assert.equal(calls, 2);
    assert.equal(observed.url, '/api/paas/v4/chat/completions');
    assert.equal(observed.authorizationPresent, true);
    assert.equal(observed.body.response_format.type, 'json_object');
    assert.equal(observed.body.model, 'glm-5.3');
    assert.deepEqual(result[PROVIDER_TELEMETRY], { promptTokens: 21, completionTokens: 13, totalTokens: 34, cachedTokens: 5, cost: null });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('General transport abort is timeout and never retries', async () => {
  const server = createServer((_request, _response) => {});
  const baseUrl = await listen(server);
  try {
    const raw = new ZaiGeneralProvider({ apiKey: 'runtime-test-only', baseUrl, model: 'glm-5.3' });
    const provider = new ResilientAdvisoryProvider(raw, {
      timeoutSignalFactory() { const controller = new AbortController(); controller.abort(); return { signal: controller.signal, cancel() {} }; },
      sleep: async () => {},
    });
    await assert.rejects(() => provider.suggest(advisoryRequest('case-local-timeout')), (error) => error.category === 'timeout' && error.retryable === false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
