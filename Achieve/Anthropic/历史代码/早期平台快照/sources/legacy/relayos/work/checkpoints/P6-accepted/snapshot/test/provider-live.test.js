import test from 'node:test';
import assert from 'node:assert/strict';

import { AdvisoryService } from '../src/application/advisory-service.js';
import { loadProviderRuntimeConfig, createConfiguredProvider } from '../src/config/provider-runtime.js';
import { ProviderTelemetryRepository } from '../src/persistence/provider-telemetry.js';
import { advisoryRequest, authoritativeSnapshot, createHarness, createWorkCase, seedGoalAndContext } from './helpers.js';

const liveEnabled = process.env.RUN_LIVE_ZAI === '1'
  && process.env.ADVISORY_PROVIDER === 'zai-general'
  && typeof process.env.RELAYOS_ZAI_GENERAL_API_KEY === 'string'
  && process.env.RELAYOS_ZAI_GENERAL_API_KEY.length > 0;

test('live Z.AI General advisory smoke is opt-in and redacted', { skip: !liveEnabled }, async () => {
  const harness = createHarness();
  const telemetry = new ProviderTelemetryRepository();
  const id = 'case-live-zai-general';
  try {
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify'] });
    const before = authoritativeSnapshot(harness.store, id);
    const provider = createConfiguredProvider(loadProviderRuntimeConfig(process.env));
    const service = new AdvisoryService({ getWorkCase: (workCaseId) => harness.service.getWorkCase(workCaseId), provider, telemetry });
    const result = await service.suggest(advisoryRequest(id, 'conflict.identify', { providerRequestId: `live-${Date.now()}`.slice(0, 64), traceId: `trace-live-${Date.now()}` }));
    assert.equal(result.authority, 'none');
    assert.equal(result.providerId, 'zai-general');
    assert.equal(result.model, 'glm-5.3');
    assert.deepEqual(authoritativeSnapshot(harness.store, id), before);
    assert.equal(telemetry.count(), 1);
  } finally { telemetry.close(); harness.close(); }
});
