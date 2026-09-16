import test from 'node:test';
import assert from 'node:assert/strict';

import { validateScenarioConfig } from '../src/config/scenario-loader.js';
import { createHarness, createWorkCase } from './helpers.js';

test('three representative scenario configs use the exact same kernel and command handler', async () => {
  const harness = createHarness();
  try {
    const cases = [
      ['supplyChain', { supplyChain: { supplierId: 'supplier-demo' } }],
      ['finance', { finance: { transactionId: 'transaction-demo' } }],
      ['enterpriseAutomation', { enterpriseAutomation: { requestId: 'request-demo' } }],
    ];
    for (const [scenarioKey, scenarioExtensions] of cases) {
      const result = await createWorkCase(harness, { id: `case-config-${scenarioKey}`, scenarioKey, extensions: scenarioExtensions });
      assert.equal(result.state.kernelVersion, 1);
      assert.equal(result.state.scenarioKey, scenarioKey);
      assert.equal(harness.store.getEvents(result.workCaseId)[0].eventType, 'work_case.created');
    }
    assert.equal(harness.service.listScenarios().length, 3);
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
