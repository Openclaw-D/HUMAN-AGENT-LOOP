import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { EventStore } from '../src/persistence/event-store.js';

let sequence = 0;

export function envelope(commandType, payload, expectedStreamVersion, actor = { kind: 'human', id: 'human-owner' }, overrides = {}) {
  sequence += 1;
  return {
    commandId: overrides.commandId ?? `cmd-${process.pid}-${sequence}`,
    idempotencyKey: overrides.idempotencyKey ?? `idem-${process.pid}-${sequence}`,
    expectedStreamVersion,
    configurationVersion: overrides.configurationVersion ?? 1,
    commandType,
    demoActorRef: actor,
    identityAssurance: overrides.identityAssurance ?? 'demo_unverified',
    traceId: overrides.traceId ?? `trace-${process.pid}-${sequence}`,
    payload,
  };
}

export function createHarness({
  scenarioKey = 'supplyChain', faultInjector = null, configs = null, connector = null,
  operationTracker = null, logger = null, connectorDeadlineMs = 5_000,
  storeOptions = {},
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relayos-p2-test-'));
  const databasePath = join(directory, 'relayos.db');
  const scenarioConfigs = configs ?? loadScenarioConfigs(resolve('scenarios'));
  const store = new EventStore(databasePath, { ...storeOptions, faultInjector });
  const service = new RelayService({
    store, scenarioConfigs,
    connector: connector ?? new MockExternalSystemAdapter({ clock: () => '2026-08-26T00:10:00.000Z' }),
    clock: () => '2026-08-26T00:00:00.000Z', operationTracker, logger, connectorDeadlineMs,
  });
  return {
    directory,
    databasePath,
    scenarioKey,
    scenarioConfigs,
    store,
    service,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function createWorkCase(harness, { id = `case-${process.pid}-${++sequence}`, scenarioKey = harness.scenarioKey, ownerActorRef = { kind: 'human', id: 'human-owner' }, extensions = {} } = {}) {
  return harness.service.executeCommand(id, envelope('workCase.create', {
    id,
    organizationId: 'org-demo',
    scenarioKey,
    title: `P2 ${scenarioKey} representative case`,
    ownerActorRef,
    nextAction: '建立目标与上下文',
    trigger: { id: `${id}:trigger:1`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' }, observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: `${scenarioKey}:${id}`, payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' } },
    scenarioExtensions: extensions,
  }, 0));
}

export async function dispatch(harness, workCaseId, commandType, payload, actor = { kind: 'human', id: 'human-owner' }, overrides = {}) {
  const version = overrides.expectedStreamVersion ?? harness.store.getProjection(workCaseId)?.projectionVersion ?? 0;
  return harness.service.executeCommand(workCaseId, envelope(commandType, payload, version, actor, overrides));
}

export async function seedGoalAndContext(harness, workCaseId, { allowedDecisionUses = ['action.authorize'] } = {}) {
  await dispatch(harness, workCaseId, 'goal.propose', { id: `${workCaseId}:goal:1`, statement: '恢复连续性并完成受控动作', constraints: ['不得越权'], evidenceIds: [] });
  await dispatch(harness, workCaseId, 'goal.accept', { goalId: `${workCaseId}:goal:1` });
  await dispatch(harness, workCaseId, 'evidence.attach', { evidence: { id: `${workCaseId}:evidence:1`, sourceRef: { systemId: 'core-system' }, recordRef: { systemId: 'core-system', recordType: 'case', recordId: workCaseId, observedVersion: '1' }, observedAt: '2026-08-26T00:00:00.000Z', contentHash: 'a'.repeat(64), classification: 'internal', summary: 'deterministic evidence' } });
  await dispatch(harness, workCaseId, 'context.publish', { id: `${workCaseId}:context:1`, evidenceIds: [`${workCaseId}:evidence:1`], purpose: 'P2 authority decision', allowedDecisionUses, freshnessPolicy: { maxAgeMinutes: 60 } });
}

export function advisoryRequest(workCaseId, operation = 'conflict.identify', overrides = {}) {
  return {
    providerRequestId: overrides.providerRequestId ?? `provider-${workCaseId}-${operation.replace('.', '-')}`.slice(0, 64),
    operation,
    workCaseId,
    goalVersion: overrides.goalVersion ?? 1,
    contextVersion: overrides.contextVersion ?? 1,
    inputRefs: overrides.inputRefs ?? [`${workCaseId}:evidence:1`],
    outputSchemaVersion: overrides.outputSchemaVersion ?? 1,
    promptVersion: overrides.promptVersion ?? 'prompt-v1',
    evaluationVersion: overrides.evaluationVersion ?? 'eval-v1',
    traceId: overrides.traceId ?? `trace-provider-${workCaseId}`,
    deadlineMs: overrides.deadlineMs ?? (['material.extract', 'context.summarize'].includes(operation) ? 8_000 : 15_000),
    dataClassification: overrides.dataClassification ?? 'internal',
  };
}

export function authoritativeSnapshot(store, workCaseId) {
  const projection = store.getProjection(workCaseId);
  const stats = store.getStats();
  return {
    streamVersion: projection.projectionVersion,
    eventCount: stats.events,
    projectionHash: projection.canonicalStateHash,
    successfulCommandReceiptCount: stats.commandReceipts,
  };
}
