import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { canonicalHash } from '../src/domain/canonical.js';
import { createRelayHttpServer } from '../src/http/server.js';
import { EventStore } from '../src/persistence/event-store.js';

const providerMode = process.env.ADVISORY_PROVIDER || 'mock';
if (providerMode === 'zai-general' && process.env.RUN_LIVE_ZAI !== '1') throw new Error('Live General provider smoke requires RUN_LIVE_ZAI=1.');

const directory = mkdtempSync(join(tmpdir(), 'relayos-p3-provider-smoke-'));
const store = new EventStore(join(directory, 'domain.db'));
const service = new RelayService({
  store,
  scenarioConfigs: loadScenarioConfigs(resolve('scenarios')),
  connector: new MockExternalSystemAdapter({ clock: () => '2026-08-26T04:00:00.000Z' }),
  clock: () => '2026-08-26T04:00:00.000Z',
});
const server = createRelayHttpServer({ service, env: process.env });
const id = 'case-provider-smoke';
let sequence = 0;

function command(commandType, payload, actor = { kind: 'human', id: 'human-owner' }) {
  sequence += 1;
  return {
    commandId: `provider-smoke-command-${sequence}`,
    idempotencyKey: `provider-smoke-idempotency-${sequence}`,
    expectedStreamVersion: store.getProjection(id)?.projectionVersion ?? 0,
    configurationVersion: 1,
    commandType,
    demoActorRef: actor,
    identityAssurance: 'demo_unverified',
    traceId: `trace-provider-smoke-domain-${sequence}`,
    payload,
  };
}

try {
  await service.executeCommand(id, command('workCase.create', {
    id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'P3 provider smoke', ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'request advisory',
    trigger: { id: 'provider-smoke-trigger', type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T04:00:00.000Z', dedupeKey: 'supplyChain:provider-smoke', payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' } },
    scenarioExtensions: { supplyChain: { supplierId: 'provider-smoke-supplier' } },
  }));
  await service.executeCommand(id, command('goal.propose', { id: 'provider-smoke-goal', statement: '获得只读 advisory', constraints: ['authority none'], evidenceIds: [] }));
  await service.executeCommand(id, command('goal.accept', { goalId: 'provider-smoke-goal' }));
  await service.executeCommand(id, command('evidence.attach', { evidence: { id: 'provider-smoke-evidence', sourceRef: { systemId: 'core-system' }, recordRef: { systemId: 'core-system', recordType: 'provider-smoke', recordId: id, observedVersion: '1' }, observedAt: '2026-08-26T04:00:00.000Z', contentHash: 'd'.repeat(64), classification: 'internal', summary: 'redacted provider smoke evidence' } }));
  await service.executeCommand(id, command('context.publish', { id: 'provider-smoke-context', evidenceIds: ['provider-smoke-evidence'], purpose: 'conflict advisory', allowedDecisionUses: ['conflict.identify'], freshnessPolicy: { maxAgeMinutes: 60 } }));

  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = {
    providerRequestId: `provider-smoke-${Date.now()}`.slice(0, 64),
    operation: 'conflict.identify', workCaseId: id, goalVersion: 1, contextVersion: 1,
    inputRefs: ['provider-smoke-evidence'], outputSchemaVersion: 1, promptVersion: 'prompt-v1', evaluationVersion: 'eval-v1',
    traceId: `trace-provider-smoke-${Date.now()}`, deadlineMs: 15_000, dataClassification: 'internal',
  };
  const before = { stats: store.getStats(), projectionHash: store.getProjection(id).canonicalStateHash };
  const startedAt = Date.now();
  const response = await fetch(`${base}/api/advisories`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-trace-id': request.traceId }, body: JSON.stringify(request) });
  const result = await response.json();
  if (response.status !== 200) throw new Error(`Provider smoke failed with ${response.status}/${result.error?.code ?? 'unknown'}.`);
  const after = { stats: store.getStats(), projectionHash: store.getProjection(id).canonicalStateHash };
  if (canonicalHash(before) !== canonicalHash(after) || result.authority !== 'none') throw new Error('Provider smoke violated zero-authoritative-write boundary.');
  process.stdout.write(`${JSON.stringify({
    provider: result.providerId, model: result.model, status: result.status, authority: result.authority,
    latencyMs: Date.now() - startedAt, schemaVersion: result.outputSchemaVersion, traceId: result.traceId,
    inputHash: canonicalHash(request), outputHash: canonicalHash(result), authoritativeSnapshotUnchanged: true,
  })}\n`);
} finally {
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  try { store.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
