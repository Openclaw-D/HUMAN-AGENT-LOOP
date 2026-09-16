import { canonicalHash } from '../domain/canonical.js';
import { AppError, assert } from '../domain/errors.js';
import { decideCommand } from '../domain/kernel.js';
import { validateScenarioExtensions } from '../config/scenario-loader.js';
import { assertAdapterContract, validateExecutionReceipt } from '../connectors/contract.js';

const ENVELOPE_KEYS = new Set(['commandId', 'idempotencyKey', 'expectedStreamVersion', 'configurationVersion', 'commandType', 'demoActorRef', 'identityAssurance', 'traceId', 'payload']);

function validateEnvelope(envelope) {
  assert(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'COMMAND_INVALID', 'command envelope 必须是对象。');
  const unknown = Object.keys(envelope).filter((key) => !ENVELOPE_KEYS.has(key));
  assert(unknown.length === 0, 'COMMAND_INVALID', 'command envelope 含未知字段。', 400, { unknown });
  for (const key of ['commandId', 'idempotencyKey', 'commandType', 'identityAssurance']) {
    assert(typeof envelope[key] === 'string' && envelope[key].trim(), 'COMMAND_INVALID', `${key} 必须是非空字符串。`);
  }
  assert(Number.isInteger(envelope.expectedStreamVersion) && envelope.expectedStreamVersion >= 0, 'EXPECTED_VERSION_REQUIRED', 'expectedStreamVersion 必须是非负整数。');
  assert(Number.isInteger(envelope.configurationVersion) && envelope.configurationVersion >= 1, 'CONFIGURATION_VERSION_INVALID', 'configurationVersion 必须是正整数。');
  assert(envelope.demoActorRef && typeof envelope.demoActorRef.id === 'string', 'ACTOR_REF_INVALID', 'demoActorRef 缺失。');
  return structuredClone(envelope);
}

function commandPayloadHash(workCaseId, envelope) {
  return canonicalHash({
    workCaseId,
    commandType: envelope.commandType,
    configurationVersion: envelope.configurationVersion,
    demoActorRef: envelope.demoActorRef,
    identityAssurance: envelope.identityAssurance,
    payload: envelope.payload ?? {},
  });
}

export class RelayService {
  constructor({ store, scenarioConfigs, connector, clock = () => new Date().toISOString() }) {
    this.store = store;
    this.scenarioConfigs = scenarioConfigs;
    this.connector = assertAdapterContract(connector);
    this.clock = clock;
  }

  listScenarios() {
    return [...this.scenarioConfigs.values()].map(({ scenarioKey, version, displayNameZh, extensionNamespace }) => ({ scenarioKey, version, displayNameZh, extensionNamespace, kernelVersion: 1 }));
  }

  listWorkCases(filters = {}) {
    return this.store.listProjections(filters);
  }

  getWorkCase(id) {
    const projection = this.store.getProjection(id);
    if (!projection) throw new AppError('WORK_CASE_NOT_FOUND', `WorkCase ${id} 不存在。`, 404);
    return projection;
  }

  getEvents(id, afterGlobalSequence = 0) {
    this.getWorkCase(id);
    return this.store.getEvents(id, { afterGlobalSequence });
  }

  replay(id) {
    return this.store.replayStream(id);
  }

  async executeCommand(workCaseId, rawEnvelope) {
    const envelope = validateEnvelope(rawEnvelope);
    this.store.assertHealthy();
    // Temporal authority uses the application clock; callers cannot backdate commands.
    const occurredAt = this.clock();
    const config = this.scenarioConfigs.get(envelope.payload?.scenarioKey ?? this.store.getProjection(workCaseId)?.state.scenarioKey);
    assert(config, 'SCENARIO_NOT_FOUND', '找不到 scenario config。', 404);
    if (envelope.commandType === 'workCase.create') {
      assert(workCaseId === envelope.payload?.id, 'WORK_CASE_ID_MISMATCH', 'route id 与 payload.id 不一致。');
      envelope.payload.scenarioExtensions = validateScenarioExtensions(config, envelope.payload.scenarioExtensions ?? {});
    }
    const hash = commandPayloadHash(workCaseId, envelope);
    const oldReceipt = this.store.findCommandReceipt(envelope.commandId);
    if (oldReceipt) {
      assert(oldReceipt.commandHash === hash, 'IDEMPOTENCY_CONFLICT', 'commandId 已用于不同 canonical payload。', 409);
      return structuredClone(oldReceipt.response);
    }

    const command = { ...envelope, occurredAt, payload: structuredClone(envelope.payload ?? {}) };
    if (command.commandType === 'action.execute') {
      const projection = this.getWorkCase(workCaseId);
      const intent = projection.state.actionIntents.find((item) => item.id === command.payload.actionIntentId);
      assert(intent, 'ACTION_NOT_FOUND', 'ActionIntent 不存在。', 404);
      // Validate actor/state/authority before the mock adapter is invoked; transaction validation repeats afterward.
      decideCommand(projection.state, { ...command, payload: { ...command.payload, _connectorReceipt: { status: 'unknown' } } }, config);
      command.payload._connectorReceipt = validateExecutionReceipt(await this.connector.execute(intent, { traceId: command.traceId }), intent);
    }

    return this.store.executeCommand({
      streamId: workCaseId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandHash: hash,
      expectedStreamVersion: command.expectedStreamVersion,
      configurationVersion: command.configurationVersion,
      occurredAt,
      metadata: {
        commandId: command.commandId,
        traceId: command.traceId ?? null,
        demoActorRef: structuredClone(command.demoActorRef),
        identityAssurance: command.identityAssurance,
      },
      decide: (state) => decideCommand(state, command, config),
    });
  }

  async readiness() {
    const persistence = this.store.readiness();
    const connector = await this.connector.health();
    return {
      status: persistence.status === 'ready' ? 'ready' : 'error',
      persistence,
      connector,
      advisoryProvider: { status: 'not_implemented', gate: 'P3' },
      authentication: { status: 'not_implemented', identityAssurance: 'demo_unverified' },
    };
  }
}
