import test from 'node:test';
import assert from 'node:assert/strict';

import { createHarness, createWorkCase, dispatch, seedGoalAndContext } from './helpers.js';

test('graph projection answers five questions from projection/replay and keeps offered handoff owner unchanged', async () => {
  const harness = createHarness();
  const id = 'frontend-offered';
  try {
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id, { allowedDecisionUses: ['conflict.identify', 'action.authorize'] });
    await dispatch(harness, id, 'gate.open', { id: 'frontend-gate', policyId: 'policy-default', question: '是否允许受保护动作？', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: [`${id}:evidence:1`] });
    await dispatch(harness, id, 'action.propose', { id: 'frontend-action', systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: ['frontend-gate'], idempotencyKey: 'frontend-action-key' });
    await dispatch(harness, id, 'handoff.offer', { id: 'frontend-offer', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: { evidenceIds: [`${id}:evidence:1`] }, expiresAt: '2099-01-01T00:00:00.000Z' });

    const graph = harness.service.getContinuityGraph(id);
    assert.equal(graph.source.stale, false);
    assert.deepEqual(graph.source.derivedFrom, ['WorkCaseProjection', 'BusinessEvent', 'ReplayProjection']);
    assert.equal(graph.fiveQuestions.owner.actorRef.id, 'human-owner');
    assert.equal(graph.fiveQuestions.pendingHandoff.offerId, 'frontend-offer');
    assert.equal(graph.fiveQuestions.pendingHandoff.ownerUnchanged, true);
    assert.equal(graph.fiveQuestions.openGate.gates[0].assignedHumanId, 'human-reviewer');
    assert.match(graph.controls.protectedActions[0].disabledReason, /开放 Human Gate/);
    assert.equal(graph.edges.find((edge) => edge.type === 'current_owner').from, 'human:human-owner');
    assert.equal(graph.edges.find((edge) => edge.type === 'handoff_offered').line, 'dash');
    assert.match(graph.edges.find((edge) => edge.type === 'handoff_offered').label, /负责人未改变/);
    assert.ok(graph.fiveQuestions.goal.value.includes('恢复连续性'));
    assert.equal(graph.fiveQuestions.nextStep.value, '建立目标与上下文');
  } finally { harness.close(); }
});

test('accepted handoff changes backend owner edge and unknown receipt remains explicitly non-success', async () => {
  const harness = createHarness();
  const id = 'frontend-accepted';
  try {
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id);
    await dispatch(harness, id, 'gate.open', { id: 'accepted-gate', policyId: 'policy-default', question: '是否批准？', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: [`${id}:evidence:1`] });
    await dispatch(harness, id, 'gate.resolve', { gateId: 'accepted-gate', decision: 'approved', rationale: '具名复核完成', evidenceIds: [`${id}:evidence:1`] }, { kind: 'human', id: 'human-reviewer' });
    await dispatch(harness, id, 'action.propose', { id: 'accepted-action', systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'unknown' }, requiredGateIds: ['accepted-gate'], idempotencyKey: 'accepted-action-key' });
    await dispatch(harness, id, 'action.authorize', { actionIntentId: 'accepted-action' }, { kind: 'human', id: 'human-reviewer' });
    await dispatch(harness, id, 'action.execute', { actionIntentId: 'accepted-action' }, { kind: 'human', id: 'human-reviewer' });
    await dispatch(harness, id, 'handoff.offer', { id: 'accepted-offer', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: {}, expiresAt: '2099-01-01T00:00:00.000Z' });
    await dispatch(harness, id, 'handoff.accept', { offerId: 'accepted-offer', reason: '完整接受', nextAction: '先查询 unknown 回执' }, { kind: 'human', id: 'human-reviewer' });

    const graph = harness.service.getContinuityGraph(id);
    assert.equal(graph.fiveQuestions.owner.actorRef.id, 'human-reviewer');
    assert.equal(graph.fiveQuestions.pendingHandoff.offerId, null);
    assert.equal(graph.edges.find((edge) => edge.type === 'current_owner').from, 'human:human-reviewer');
    assert.equal(graph.edges.find((edge) => edge.type === 'handoff_accepted').line, 'solid');
    const actionEdge = graph.edges.find((edge) => edge.type === 'action_write');
    assert.equal(actionEdge.receiptStatus, 'unknown');
    assert.match(actionEdge.label, /unknown/);
    assert.deepEqual(graph.rawRefs.receiptStatuses, [{ id: 'accepted-action:receipt:mock', status: 'unknown' }]);
    assert.equal(graph.replay.sixQuestions.length, 6);
    assert.match(graph.replay.sixQuestions.find((item) => item.key === 'result').answer, /unknown/);
    assert.ok(graph.replay.timeline.some((item) => item.type === 'owner.changed'));
    assert.ok(graph.replay.timeline.every((item) => item.identityAssurance === 'demo_unverified'));
  } finally { harness.close(); }
});

test('WorkCase, HumanPrincipal, RoutableAgent and ExternalSystem are distinct while controls are not nodes', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'frontend-types', ownerActorRef: { kind: 'agent', id: 'agent-assistant' } });
    const graph = harness.service.getContinuityGraph('frontend-types');
    assert.deepEqual(new Set(graph.nodes.map((node) => node.type)), new Set(['WorkCase', 'HumanPrincipal', 'RoutableAgent', 'ExternalSystem']));
    assert.equal(graph.nodes.some((node) => ['HumanGate', 'ActionIntent', 'ExecutionReceipt', 'ControlObject', 'department'].includes(node.type)), false);
    assert.ok(graph.edges.some((edge) => edge.type === 'accountable_human' && edge.from === 'agent:agent-assistant' && edge.to === 'human:human-owner'));
    assert.ok(graph.edges.some((edge) => edge.type === 'authority' && edge.sourceRef.grantId));
  } finally { harness.close(); }
});

test('all ten configs use the same graph projector without scenario branches', async () => {
  const harness = createHarness();
  try {
    for (const scenarioKey of harness.scenarioConfigs.keys()) {
      const extensions = { [scenarioKey]: {} };
      const id = `frontend-shared-${scenarioKey}`;
      await createWorkCase(harness, { id, scenarioKey, extensions });
      const graph = harness.service.getContinuityGraph(id);
      assert.equal(graph.schemaVersion, 1);
      assert.equal(graph.scenarioKey, scenarioKey);
      assert.equal(graph.nodes.filter((node) => node.type === 'WorkCase').length, 1);
      assert.ok(graph.legend.nodeTypes.length >= 1);
      assert.ok(graph.details.evidence);
    }
  } finally { harness.close(); }
});
