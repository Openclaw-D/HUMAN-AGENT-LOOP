import { resolve } from 'node:path';

import { RelayService } from '../../src/application/service.js';
import { MockExternalSystemAdapter } from '../../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../../src/config/scenario-loader.js';
import { EventStore } from '../../src/persistence/event-store.js';
import { envelope } from '../helpers.js';

const databasePath = resolve(process.argv[2]);
const store = new EventStore(databasePath);
const service = new RelayService({
  store,
  scenarioConfigs: loadScenarioConfigs(resolve('scenarios')),
  connector: new MockExternalSystemAdapter({ clock: () => '2026-08-26T01:00:00.000Z' }),
  clock: () => '2026-08-26T01:00:00.000Z',
});
const id = 'case-process-restart';

async function send(commandType, payload, actor = { kind: 'human', id: 'human-owner' }) {
  const expected = store.getProjection(id)?.projectionVersion ?? 0;
  return service.executeCommand(id, envelope(commandType, payload, expected, actor));
}

await send('workCase.create', { id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'process restart', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'seed', trigger: { id: 'restart-trigger', type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: 'supplyChain:restart', payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' } }, scenarioExtensions: { supplyChain: { supplierId: 'restart-supplier' } } });
await send('goal.propose', { id: 'restart-goal', statement: '重启后恢复完整连续性', constraints: ['receipt required'], evidenceIds: [] });
await send('goal.accept', { goalId: 'restart-goal' });
await send('evidence.attach', { evidence: { id: 'restart-evidence', sourceRef: { systemId: 'core-system' }, recordRef: { systemId: 'core-system', recordType: 'restart', recordId: id, observedVersion: '1' }, observedAt: '2026-08-26T00:00:00.000Z', contentHash: 'b'.repeat(64), classification: 'internal', summary: 'restart evidence' } });
await send('context.publish', { id: 'restart-context', evidenceIds: ['restart-evidence'], purpose: 'restart action', allowedDecisionUses: ['action.authorize'], freshnessPolicy: { maxAgeMinutes: 60 } });
await send('gate.open', { id: 'restart-gate', policyId: 'policy-default', question: '批准重启动作？', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: ['restart-evidence'] });
await send('gate.resolve', { gateId: 'restart-gate', decision: 'approved', rationale: '具名复核已完成', evidenceIds: ['restart-evidence'] }, { kind: 'human', id: 'human-reviewer' });
await send('action.propose', { id: 'restart-action', systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'unknown' }, requiredGateIds: ['restart-gate'], idempotencyKey: 'restart-external-action' });
await send('action.authorize', { actionIntentId: 'restart-action' }, { kind: 'human', id: 'human-reviewer' });
await send('action.execute', { actionIntentId: 'restart-action' }, { kind: 'human', id: 'human-reviewer' });
await send('handoff.offer', { id: 'restart-offer', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: { evidenceIds: ['restart-evidence'] }, expiresAt: '2099-01-01T00:00:00.000Z' });
const accepted = await send('handoff.accept', { offerId: 'restart-offer', reason: '完整接收', nextAction: '查询 unknown receipt' }, { kind: 'human', id: 'human-reviewer' });

store.checkpoint();
store.close();
process.stdout.write(`${JSON.stringify({ streamVersion: accepted.streamVersion, canonicalStateHash: accepted.canonicalStateHash })}\n`);
