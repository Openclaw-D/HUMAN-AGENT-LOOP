import test from 'node:test';
import assert from 'node:assert/strict';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { validateAdvisoryRequest } from '../src/providers/contract.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ResilientAdvisoryProvider } from '../src/providers/resilience.js';
import { ZaiGeneralProvider } from '../src/providers/zai-general-provider.js';
import { ProviderTelemetryRepository } from '../src/persistence/provider-telemetry.js';
import { advisoryRequest, createHarness, createWorkCase, seedGoalAndContext } from './helpers.js';

const KIND_BY_OPERATION = {
  'material.extract': 'extraction',
  'context.summarize': 'summary',
  'conflict.identify': 'conflict',
  'configuration.suggest': 'configuration',
  'action.suggest': 'action',
};

function fakeGeneralFetch() {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    const result = {
      authority: 'none', status: 'advisory', providerId: 'zai-general', model: body.model,
      outputSchemaVersion: request.outputSchemaVersion,
      recommendations: [{ kind: KIND_BY_OPERATION[request.operation], summary: 'General transport structured advisory.', evidenceIds: request.inputRefs, confidence: 0.91, requiresHumanReview: true }],
      traceId: request.traceId,
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, prompt_tokens_details: { cached_tokens: 3 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function runSharedContract(providerFactory) {
  for (const operation of Object.keys(KIND_BY_OPERATION)) {
    const harness = createHarness();
    const telemetry = new ProviderTelemetryRepository();
    try {
      const id = `case-provider-${operation.replace('.', '-')}`;
      await createWorkCase(harness, { id });
      await seedGoalAndContext(harness, id, { allowedDecisionUses: [operation] });
      const provider = new ResilientAdvisoryProvider(providerFactory());
      const service = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider, telemetry });
      const result = await service.suggest(advisoryRequest(id, operation));
      assert.equal(result.authority, 'none');
      assert.equal(result.status, 'advisory');
      assert.equal(result.recommendations[0].kind, KIND_BY_OPERATION[operation]);
      assert.equal(result.recommendations[0].requiresHumanReview, true);
      assert.equal(telemetry.count(), 1);
    } finally {
      telemetry.close();
      harness.close();
    }
  }
}

test('MockProvider passes the same five-operation AdvisoryProvider contract', async () => {
  await runSharedContract(() => new MockProvider());
});

test('ZaiGeneralProvider fake General transport passes the same five-operation contract', async () => {
  await runSharedContract(() => new ZaiGeneralProvider({ apiKey: 'runtime-test-only', baseUrl: 'http://127.0.0.1:49152/api/paas/v4/', model: 'glm-5.3', fetchImpl: fakeGeneralFetch() }));
});

test('AdvisoryRequest schema, version, Evidence, classification and permission fail closed locally', async () => {
  const harness = createHarness();
  try {
    const id = 'case-provider-local-validation';
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
    const raw = new MockProvider();
    const service = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider: new ResilientAdvisoryProvider(raw) });
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'conflict.identify', { goalVersion: 2 })), (error) => error.code === 'ADVISORY_GOAL_VERSION_STALE');
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'conflict.identify', { contextVersion: 2 })), (error) => error.code === 'ADVISORY_CONTEXT_VERSION_STALE');
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'conflict.identify', { inputRefs: ['evidence-out-of-scope'] })), (error) => error.code === 'ADVISORY_EVIDENCE_SCOPE_DENIED');
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'conflict.identify', { dataClassification: 'public' })), (error) => error.code === 'ADVISORY_DATA_CLASSIFICATION_DENIED');
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'action.suggest')), (error) => error.code === 'ADVISORY_SCOPE_DENIED');
    await assert.rejects(() => service.suggest(advisoryRequest(id, 'conflict.identify', { outputSchemaVersion: 2 })), (error) => error.code === 'ADVISORY_REQUEST_INVALID');
    assert.equal(raw.callCount, 0, 'local validation must happen before provider invocation');
  } finally { harness.close(); }
});

test('AdvisoryProvider contract exposes only suggest and receives no DB/domain command handle', () => {
  const mock = new MockProvider();
  const zai = new ZaiGeneralProvider({ apiKey: 'runtime-test-only', baseUrl: 'http://localhost:49152/api/paas/v4/', model: 'glm-5.3', fetchImpl: fakeGeneralFetch() });
  for (const provider of [mock, zai]) {
    assert.equal(typeof provider.suggest, 'function');
    for (const forbidden of ['store', 'db', 'eventStore', 'executeCommand', 'decideCommand']) assert.equal(Object.hasOwn(provider, forbidden), false);
  }
});

test('request validator enforces operation allowlist, exact keys and 3–30 second deadline', () => {
  const valid = advisoryRequest('case-validator');
  assert.equal(validateAdvisoryRequest(valid).deadlineMs, 15_000);
  assert.throws(() => validateAdvisoryRequest({ ...valid, operation: 'owner.change' }), (error) => error.category === 'request_invalid');
  assert.throws(() => validateAdvisoryRequest({ ...valid, deadlineMs: 2_999 }), (error) => error.category === 'request_invalid');
  assert.throws(() => validateAdvisoryRequest({ ...valid, deadlineMs: 30_001 }), (error) => error.category === 'request_invalid');
  assert.throws(() => validateAdvisoryRequest({ ...valid, extra: true }), (error) => error.category === 'request_invalid');
});
