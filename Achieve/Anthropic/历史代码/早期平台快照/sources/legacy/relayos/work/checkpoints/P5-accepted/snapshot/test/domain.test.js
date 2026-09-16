import test from 'node:test';
import assert from 'node:assert/strict';

import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createHarness, createWorkCase, dispatch, seedGoalAndContext } from './helpers.js';

test('HumanPrincipal, RoutableAgent, ExternalSystem and ControlObject remain distinct', async () => {
  const harness = createHarness();
  try {
    await assert.rejects(() => createWorkCase(harness, { id: 'case-system-owner', ownerActorRef: { kind: 'system', id: 'core-system' } }), (error) => error.code === 'ACTOR_REF_INVALID');
    const result = await createWorkCase(harness, { id: 'case-types', ownerActorRef: { kind: 'agent', id: 'agent-assistant' } });
    assert.equal(result.state.ownerActorRef.kind, 'agent');
    assert.equal(result.state.accountableHumanId, 'human-owner');
    assert.equal(result.state.externalSystems[0].id, 'core-system');
    assert.equal(result.state.controlObjects[0].kind, 'policy');
    assert.equal(result.state.actors.some((item) => item.id === 'core-system'), false);
  } finally { harness.close(); }
});

test('Accepted Handoff changes owner only for recipient explicit accept', async () => {
  const harness = createHarness();
  try {
    const id = 'case-handoff';
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id);

    await dispatch(harness, id, 'handoff.offer', { id: 'offer-clarify', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: { evidenceIds: [`${id}:evidence:1`] }, expiresAt: '2099-01-01T00:00:00.000Z' });
    const beforeUnauthorized = harness.store.getStats();
    await assert.rejects(() => dispatch(harness, id, 'handoff.accept', { offerId: 'offer-clarify', reason: 'wrong recipient', nextAction: 'none' }), (error) => error.code === 'HANDOFF_RECIPIENT_REQUIRED');
    assert.deepEqual(harness.store.getStats(), beforeUnauthorized);
    await dispatch(harness, id, 'handoff.clarify', { offerId: 'offer-clarify', reason: '需要明确风险边界' }, { kind: 'human', id: 'human-reviewer' });
    assert.equal(harness.store.getProjection(id).state.ownerActorRef.id, 'human-owner');

    await dispatch(harness, id, 'handoff.offer', { id: 'offer-reject', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: {}, expiresAt: '2099-01-01T00:00:00.000Z', supersedesOfferId: 'offer-clarify' });
    await dispatch(harness, id, 'handoff.reject', { offerId: 'offer-reject', reason: '当前上下文不足' }, { kind: 'human', id: 'human-reviewer' });
    assert.equal(harness.store.getProjection(id).state.ownerActorRef.id, 'human-owner');

    await dispatch(harness, id, 'handoff.offer', { id: 'offer-accept', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: { commitments: ['continue'] }, expiresAt: '2099-01-01T00:00:00.000Z', supersedesOfferId: 'offer-reject' });
    const accepted = await dispatch(harness, id, 'handoff.accept', { offerId: 'offer-accept', reason: '目标和上下文完整', nextAction: '继续受控动作' }, { kind: 'human', id: 'human-reviewer' });
    assert.equal(accepted.eventIds.length, 2);
    assert.equal(accepted.state.ownerActorRef.id, 'human-reviewer');
    assert.equal(accepted.state.handoffAcceptances.length, 1);
  } finally { harness.close(); }
});

test('handoff accept fails closed after goal/context version changes', async () => {
  const harness = createHarness();
  try {
    const id = 'case-stale-offer';
    await createWorkCase(harness, { id });
    await seedGoalAndContext(harness, id);
    await dispatch(harness, id, 'handoff.offer', { id: 'offer-stale', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: {}, expiresAt: '2099-01-01T00:00:00.000Z' });
    await dispatch(harness, id, 'goal.propose', { id: `${id}:goal:2`, statement: '新目标', constraints: [], evidenceIds: [`${id}:evidence:1`] });
    await dispatch(harness, id, 'goal.accept', { goalId: `${id}:goal:2` });
    const before = harness.store.getStats();
    await assert.rejects(() => dispatch(harness, id, 'handoff.accept', { offerId: 'offer-stale', reason: 'stale', nextAction: 'none' }, { kind: 'human', id: 'human-reviewer' }), (error) => error.code === 'HANDOFF_OFFER_STALE');
    assert.equal(harness.store.getProjection(id).state.ownerActorRef.id, 'human-owner');
    assert.deepEqual(harness.store.getStats(), before);
  } finally { harness.close(); }
});

test('Human Gate requires named HumanPrincipal and active temporal grant', async () => {
  const harness = createHarness();
  try {
    const id = 'case-gate';
    await createWorkCase(harness, { id });
    await dispatch(harness, id, 'gate.open', { id: 'gate-1', policyId: 'policy-default', question: '是否批准？', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: [] });
    await dispatch(harness, id, 'authority.grant', { grant: { id: 'grant-agent-illegal-gate', principalRef: { kind: 'agent', id: 'agent-assistant' }, actions: ['gate.resolve'], scope: { workCaseId: '*' }, validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2100-01-01T00:00:00.000Z', reason: 'test type boundary' } });
    await assert.rejects(() => dispatch(harness, id, 'gate.resolve', { gateId: 'gate-1', decision: 'approved', rationale: 'agent cannot decide', evidenceIds: [] }, { kind: 'agent', id: 'agent-assistant' }), (error) => error.code === 'HUMAN_PRINCIPAL_REQUIRED');
    const resolved = await dispatch(harness, id, 'gate.resolve', { gateId: 'gate-1', decision: 'approved', rationale: '具名复核完成', evidenceIds: [], nextAction: '继续' }, { kind: 'human', id: 'human-reviewer' });
    assert.equal(resolved.state.humanGates[0].status, 'approved');
    assert.equal(resolved.state.humanGates[0].resolution.decidedBy.id, 'human-reviewer');
  } finally { harness.close(); }

  const configs = loadScenarioConfigs('scenarios');
  const modified = structuredClone(configs.get('supplyChain'));
  modified.authorityGrants.find((grant) => grant.id === 'grant-reviewer').validUntil = '2025-01-01T00:00:00.000Z';
  const expiredHarness = createHarness({ configs: new Map([['supplyChain', modified]]) });
  try {
    await createWorkCase(expiredHarness, { id: 'case-expired-gate' });
    await dispatch(expiredHarness, 'case-expired-gate', 'gate.open', { id: 'gate-expired', policyId: 'policy-default', question: 'expired?', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: [] });
    await assert.rejects(() => dispatch(expiredHarness, 'case-expired-gate', 'gate.resolve', { gateId: 'gate-expired', decision: 'approved', rationale: 'expired', evidenceIds: [] }, { kind: 'human', id: 'human-reviewer' }), (error) => error.code === 'AUTHORITY_DENIED');
  } finally { expiredHarness.close(); }
});

test('authority, capability, context and evidence are orthogonal controls', async () => {
  async function expectAuthorizationFailure(kind, mutateConfig, allowedDecisionUses, expectedCode) {
    const configs = loadScenarioConfigs('scenarios');
    const config = structuredClone(configs.get('supplyChain'));
    mutateConfig(config);
    const harness = createHarness({ configs: new Map([['supplyChain', config]]) });
    try {
      const id = `case-orthogonal-${kind}`;
      await createWorkCase(harness, { id });
      await seedGoalAndContext(harness, id, { allowedDecisionUses });
      await dispatch(harness, id, 'action.propose', { id: `${id}:action`, systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: [], idempotencyKey: `${id}:external` });
      const before = harness.store.getStats();
      await assert.rejects(() => dispatch(harness, id, 'action.authorize', { actionIntentId: `${id}:action` }), (error) => error.code === expectedCode);
      assert.deepEqual(harness.store.getStats(), before);
      assert.equal(harness.store.getProjection(id).state.evidence.length, 1);
    } finally { harness.close(); }
  }
  await expectAuthorizationFailure('authority', (config) => { config.authorityGrants.find((grant) => grant.id === 'grant-owner').actions = config.authorityGrants.find((grant) => grant.id === 'grant-owner').actions.filter((action) => action !== 'action.authorize'); }, ['action.authorize'], 'AUTHORITY_DENIED');
  await expectAuthorizationFailure('capability', (config) => { config.humanPrincipals.find((human) => human.id === 'human-owner').capabilities = []; }, ['action.authorize'], 'CAPABILITY_DENIED');
  await expectAuthorizationFailure('context', () => {}, [], 'CONTEXT_USE_DENIED');
});

test('ActionIntent is separate from succeeded/failed/unknown ExecutionReceipt', async () => {
  const harness = createHarness();
  try {
    for (const status of ['succeeded', 'failed', 'unknown']) {
      const id = `case-action-${status}`;
      const actionId = `${id}:action`;
      await createWorkCase(harness, { id });
      await seedGoalAndContext(harness, id);
      await dispatch(harness, id, 'action.propose', { id: actionId, systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: status }, requiredGateIds: [], idempotencyKey: `${id}:external` });
      assert.equal(harness.store.getProjection(id).state.actionIntents[0].status, 'proposed');
      await dispatch(harness, id, 'action.authorize', { actionIntentId: actionId });
      const executed = await dispatch(harness, id, 'action.execute', { actionIntentId: actionId });
      assert.equal(executed.state.executionReceipts[0].status, status);
      assert.equal(executed.state.actionIntents[0].status, status);
      if (status !== 'succeeded') assert.equal(executed.state.executionReceipts[0].completedAt, null);
      if (status === 'unknown') {
        await assert.rejects(() => dispatch(harness, id, 'workCase.complete', { resultEvidenceIds: [`${id}:evidence:1`], succeededActionIds: [actionId] }), (error) => error.code === 'ACTION_RECEIPT_UNRESOLVED');
      }
    }
  } finally { harness.close(); }
});

test('Exception, Escalation and three MetricObservation categories replay as typed state', async () => {
  const harness = createHarness();
  try {
    const id = 'case-exception';
    await createWorkCase(harness, { id });
    await dispatch(harness, id, 'exception.open', { id: 'exception-1', type: 'evidence_conflict', severity: 'high', sourceRefs: [{ systemId: 'core-system' }] });
    await dispatch(harness, id, 'escalation.offer', { id: 'escalation-1', exceptionId: 'exception-1', assignedHumanId: 'human-reviewer', reason: '具名复核', dueAt: '2099-01-01T00:00:00.000Z' });
    await assert.rejects(() => dispatch(harness, id, 'escalation.acknowledge', { escalationId: 'escalation-1' }), (error) => error.code === 'ESCALATION_ASSIGNEE_REQUIRED');
    await dispatch(harness, id, 'escalation.acknowledge', { escalationId: 'escalation-1' }, { kind: 'human', id: 'human-reviewer' });
    await dispatch(harness, id, 'exception.acknowledge', { exceptionId: 'exception-1' });
    await dispatch(harness, id, 'exception.resolve', { exceptionId: 'exception-1', resolution: { rationale: 'evidence reconciled' } });
    for (const category of ['business', 'risk', 'efficiency']) {
      await dispatch(harness, id, 'metric.observe', { id: `metric-${category}`, metricKey: `${category}Metric`, category, value: 1, unit: 'count', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', window: { from: '2026-08-25', to: '2026-08-26' }, definitionVersion: 1 });
    }
    const replay = harness.store.replayStream(id);
    assert.equal(replay.state.exceptions[0].status, 'resolved');
    assert.equal(replay.state.escalations[0].status, 'acknowledged');
    assert.deepEqual(new Set(replay.state.metricObservations.map((item) => item.category)), new Set(['business', 'risk', 'efficiency']));
  } finally { harness.close(); }
});

test('all demo command/event state preserves demo_unverified and never claims authentication', async () => {
  const harness = createHarness();
  try {
    await createWorkCase(harness, { id: 'case-demo' });
    const event = harness.store.getEvents('case-demo')[0];
    assert.equal(event.metadata.identityAssurance, 'demo_unverified');
    await assert.rejects(() => dispatch(harness, 'case-demo', 'goal.propose', { id: 'goal-auth', statement: 'invalid assurance', constraints: [], evidenceIds: [] }, { kind: 'human', id: 'human-owner' }, { identityAssurance: 'authenticated' }), (error) => error.code === 'IDENTITY_ASSURANCE_INVALID');
  } finally { harness.close(); }
});
