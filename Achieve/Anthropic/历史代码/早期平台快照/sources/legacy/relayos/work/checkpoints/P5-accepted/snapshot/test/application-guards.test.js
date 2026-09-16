import test from 'node:test';
import assert from 'node:assert/strict';

import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { createHarness, createWorkCase, dispatch, envelope, seedGoalAndContext } from './helpers.js';

class CountingAdapter extends MockExternalSystemAdapter {
  constructor() {
    super({ clock: () => '2026-08-26T00:10:00.000Z' });
    this.executeCount = 0;
  }

  async execute(intent, options) {
    this.executeCount += 1;
    return super.execute(intent, options);
  }
}

test('non-create payload cannot redirect config selection to another scenario', async () => {
  const harness = createHarness({ scenarioKey: 'supplyChain' });
  try {
    await createWorkCase(harness, { id: 'case-config-confusion' });
    const result = await harness.service.executeCommand('case-config-confusion', envelope('goal.propose', {
      id: 'goal-config-confusion', statement: 'payload scenarioKey 不是配置选择权威',
      constraints: [], evidenceIds: [], scenarioKey: 'finance',
    }, 1));
    assert.equal(result.state.scenarioKey, 'supplyChain');
    assert.equal(result.state.goalVersions[0].statement, 'payload scenarioKey 不是配置选择权威');
  } finally { harness.close(); }
});

test('stale action is rejected before connector and idempotent retry does not repeat external call', async () => {
  const adapter = new CountingAdapter();
  const harness = createHarness({ connector: adapter });
  const id = 'case-action-preflight';
  try {
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id);
    await dispatch(harness, id, 'action.propose', {
      id: 'action-preflight', systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: [], idempotencyKey: 'action-preflight-key',
    });
    await dispatch(harness, id, 'action.authorize', { actionIntentId: 'action-preflight' });
    const version = harness.store.getProjection(id).projectionVersion;
    await assert.rejects(
      () => harness.service.executeCommand(id, envelope('action.execute', { actionIntentId: 'action-preflight' }, version - 1)),
      (error) => error.code === 'VERSION_CONFLICT',
    );
    assert.equal(adapter.executeCount, 0);

    const original = envelope('action.execute', { actionIntentId: 'action-preflight' }, version, { kind: 'human', id: 'human-owner' }, {
      commandId: 'cmd-action-preflight-original', idempotencyKey: 'idem-action-preflight-execute',
    });
    const first = await harness.service.executeCommand(id, original);
    const retry = { ...structuredClone(original), commandId: 'cmd-action-preflight-retry' };
    const second = await harness.service.executeCommand(id, retry);
    assert.deepEqual(second, first);
    assert.equal(adapter.executeCount, 1);
  } finally { harness.close(); }
});
