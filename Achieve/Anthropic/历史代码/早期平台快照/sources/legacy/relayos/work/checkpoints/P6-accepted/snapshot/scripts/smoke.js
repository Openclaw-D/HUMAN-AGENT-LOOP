import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { EventStore } from '../src/persistence/event-store.js';

const directory = mkdtempSync(join(tmpdir(), 'relayos-p2-smoke-'));
const databasePath = join(directory, 'smoke.db');
let store = new EventStore(databasePath);
const service = new RelayService({ store, scenarioConfigs: loadScenarioConfigs(resolve('scenarios')), connector: new MockExternalSystemAdapter({ clock: () => '2026-08-26T03:00:00.000Z' }), clock: () => '2026-08-26T03:00:00.000Z' });
const server = createRelayHttpServer({ service });
let sequence = 0;
let version = 0;

function command(commandType, payload, actor = { kind: 'human', id: 'human-owner' }) {
  sequence += 1;
  return {
    commandId: `smoke-command-${sequence}`,
    idempotencyKey: `smoke-idempotency-${sequence}`,
    expectedStreamVersion: version,
    configurationVersion: 1,
    commandType,
    demoActorRef: actor,
    identityAssurance: 'demo_unverified',
    traceId: `smoke-trace-${sequence}`,
    payload,
  };
}

async function post(base, path, body, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  const result = await response.json();
  if (response.status !== expectedStatus) throw new Error(`Smoke ${path} failed ${response.status}: ${JSON.stringify(result)}`);
  version = result.streamVersion;
  return result;
}

try {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const id = 'case-smoke';
  await post(base, '/api/work-cases', command('workCase.create', { id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'P2 smoke', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'run full deterministic flow', trigger: { id: 'smoke-trigger', type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T03:00:00.000Z', dedupeKey: 'supplyChain:smoke', payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' } }, scenarioExtensions: { supplyChain: { supplierId: 'smoke-supplier' } } }), 201);
  await post(base, `/api/work-cases/${id}/commands`, command('goal.propose', { id: 'smoke-goal', statement: '完成确定性 P2 smoke', constraints: ['no model'], evidenceIds: [] }));
  await post(base, `/api/work-cases/${id}/commands`, command('goal.accept', { goalId: 'smoke-goal' }));
  await post(base, `/api/work-cases/${id}/commands`, command('evidence.attach', { evidence: { id: 'smoke-evidence', sourceRef: { systemId: 'core-system' }, recordRef: { systemId: 'core-system', recordType: 'smoke', recordId: id, observedVersion: '1' }, observedAt: '2026-08-26T03:00:00.000Z', contentHash: 'c'.repeat(64), classification: 'internal', summary: 'smoke evidence' } }));
  await post(base, `/api/work-cases/${id}/commands`, command('context.publish', { id: 'smoke-context', evidenceIds: ['smoke-evidence'], purpose: 'authorize smoke action', allowedDecisionUses: ['action.authorize'], freshnessPolicy: { maxAgeMinutes: 60 } }));
  await post(base, `/api/work-cases/${id}/commands`, command('gate.open', { id: 'smoke-gate', policyId: 'policy-default', question: '批准 mock 动作？', assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: ['smoke-evidence'] }));
  await post(base, `/api/work-cases/${id}/commands`, command('gate.resolve', { gateId: 'smoke-gate', decision: 'approved', rationale: '具名 demo human 已复核', evidenceIds: ['smoke-evidence'] }, { kind: 'human', id: 'human-reviewer' }));
  await post(base, `/api/work-cases/${id}/commands`, command('action.propose', { id: 'smoke-action', systemId: 'core-system', operation: 'update', inputRef: { simulateStatus: 'unknown' }, requiredGateIds: ['smoke-gate'], idempotencyKey: 'smoke-external-action' }));
  await post(base, `/api/work-cases/${id}/commands`, command('action.authorize', { actionIntentId: 'smoke-action' }, { kind: 'human', id: 'human-reviewer' }));
  await post(base, `/api/work-cases/${id}/commands`, command('action.execute', { actionIntentId: 'smoke-action' }, { kind: 'human', id: 'human-reviewer' }));
  await post(base, `/api/work-cases/${id}/commands`, command('handoff.offer', { id: 'smoke-offer', toActorRef: { kind: 'human', id: 'human-reviewer' }, package: { evidenceIds: ['smoke-evidence'] }, expiresAt: '2099-01-01T00:00:00.000Z' }));
  const accepted = await post(base, `/api/work-cases/${id}/commands`, command('handoff.accept', { offerId: 'smoke-offer', reason: '完整接收', nextAction: '查询 unknown receipt' }, { kind: 'human', id: 'human-reviewer' }));
  const replay = await (await fetch(`${base}/api/work-cases/${id}/replay`)).json();
  const ready = await (await fetch(`${base}/health/ready`)).json();
  if (replay.canonicalStateHash !== accepted.canonicalStateHash || ready.status !== 'ready') throw new Error('Smoke replay/readiness mismatch.');
  await new Promise((resolveClose) => server.close(resolveClose));
  store.checkpoint();
  store.close();
  store = new EventStore(databasePath);
  const recovered = store.getProjection(id);
  if (recovered.canonicalStateHash !== accepted.canonicalStateHash) throw new Error('Smoke restart hash mismatch.');
  process.stdout.write(`${JSON.stringify({ status: 'passed', port: 0, journalMode: store.journalMode, streamVersion: recovered.projectionVersion, owner: recovered.state.ownerActorRef.id, handoff: recovered.state.handoffOffers[0].status, gate: recovered.state.humanGates[0].status, receipt: recovered.state.executionReceipts[0].status, canonicalStateHash: recovered.canonicalStateHash })}\n`);
} finally {
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  try { store.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
