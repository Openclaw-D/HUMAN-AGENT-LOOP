import test from 'node:test';
import assert from 'node:assert/strict';

import { loadScenarioFixtures } from '../src/config/scenario-fixture-loader.js';
import { scenarioExtensionStats, validateScenarioConfig } from '../src/config/scenario-loader.js';
import { createHarness, createWorkCase } from './helpers.js';

test('all ten scenario configs use the exact same kernel and command handler', async () => {
  const harness = createHarness();
  try {
    const fixtures = loadScenarioFixtures('test/fixtures/scenarios', harness.scenarioConfigs);
    for (const [scenarioKey, config] of harness.scenarioConfigs) {
      const scenarioExtensions = fixtures.get(scenarioKey).scenarioExtensions;
      const result = await createWorkCase(harness, { id: `case-config-${scenarioKey}`, scenarioKey, extensions: scenarioExtensions });
      assert.equal(result.state.kernelVersion, 1);
      assert.equal(result.state.scenarioKey, scenarioKey);
      assert.equal(harness.store.getEvents(result.workCaseId)[0].eventType, 'work_case.created');
      assert.equal(scenarioExtensionStats(config).ratio <= 0.2, true);
    }
    assert.equal(harness.service.listScenarios().length, 10);
    assert.equal(new Set(harness.service.listScenarios().map((item) => item.kernelVersion)).size, 1);
  } finally { harness.close(); }
});

test('scenario config core additionalProperties fails closed', () => {
  const config = {
    schemaVersion: 1,
    scenarioKey: 'invalid',
    version: 1,
    displayNameZh: '非法配置',
    roles: [], humanPrincipals: [], routableAgents: [], externalSystems: [], controlObjects: [], authorityGrants: [], triggerPolicies: [], gatePolicies: [], metricDefinitions: [],
    extensionNamespace: 'scenarioExtensions.invalid', extensionFields: [],
    industryBranch: 'forbidden',
  };
  assert.throws(() => validateScenarioConfig(config), (error) => error.code === 'SCENARIO_CONFIG_INVALID' && error.details.unknown.includes('industryBranch'));
});

test('unknown scenario extension is rejected before any event write', async () => {
  const harness = createHarness();
  try {
    await assert.rejects(() => createWorkCase(harness, { id: 'case-invalid-extension', extensions: { supplyChain: { secretBranch: true } } }), (error) => error.code === 'SCENARIO_CONFIG_INVALID');
    assert.deepEqual(harness.store.getStats(), { streams: 0, events: 0, projections: 0, commandReceipts: 0 });
  } finally { harness.close(); }
});
