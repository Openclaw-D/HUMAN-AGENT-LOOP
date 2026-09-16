import { canonicalHash } from '../domain/canonical.js';
import { AppError, assert } from '../domain/errors.js';
import { decideCommand } from '../domain/kernel.js';
import { validateScenarioExtensions } from '../config/scenario-loader.js';
import { assertAdapterContract, validateExecutionReceipt } from '../connectors/contract.js';
import { projectContinuityGraph } from './graph-projection.js';

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
  constructor({
    store,
    scenarioConfigs,
    connector,
    clock = () => new Date().toISOString(),
    operationTracker = null,
    logger = null,
    connectorDeadlineMs = 5_000,
  }) {
    this.store = store;
    this.scenarioConfigs = scenarioConfigs;
    this.connector = assertAdapterContract(connector);
    this.clock = clock;
    this.operationTracker = operationTracker;
    this.logger = logger;
    this.connectorDeadlineMs = connectorDeadlineMs;
    this.streamLocks = new Map();
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

  getContinuityGraph(id) {
    const projection = this.getWorkCase(id);
    const replay = this.replay(id);
    const events = this.getEvents(id);
    return projectContinuityGraph({ projection, replay, events });
  }

  async executeCommand(workCaseId, rawEnvelope) {
    const commandOperation = this.operationTracker?.begin('command', { workCaseId, commandId: rawEnvelope?.commandId });
    const previous = this.streamLocks.get(workCaseId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.streamLocks.set(workCaseId, current);
    await previous;
    try {
      return await this.#executeCommandUnlocked(workCaseId, rawEnvelope);
    } finally {
      release();
      if (this.streamLocks.get(workCaseId) === current) this.streamLocks.delete(workCaseId);
      commandOperation?.end();
    }
  }

  async #executeCommandUnlocked(workCaseId, rawEnvelope) {
    const envelope = validateEnvelope(rawEnvelope);
    this.store.assertHealthy();
    // Temporal authority uses the application clock; callers cannot backdate commands.
    const occurredAt = this.clock();
    const existingProjection = envelope.commandType === 'workCase.create' ? null : this.getWorkCase(workCaseId);
    const scenarioKey = envelope.commandType === 'workCase.create'
      ? envelope.payload?.scenarioKey
      : existingProjection.state.scenarioKey;
    const config = this.scenarioConfigs.get(scenarioKey);
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
    const oldKeyReceipt = this.store.findIdempotencyReceipt(workCaseId, envelope.idempotencyKey);
    if (oldKeyReceipt) {
      assert(oldKeyReceipt.commandHash === hash, 'IDEMPOTENCY_CONFLICT', 'idempotencyKey 已用于不同 canonical payload。', 409);
      return structuredClone(oldKeyReceipt.response);
    }

    // External adapters must never run for an envelope that is already stale.
    this.store.assertCommandPreconditions(workCaseId, envelope);

    const command = { ...envelope, occurredAt, payload: structuredClone(envelope.payload ?? {}) };
    if (command.commandType === 'action.execute') {
      const projection = existingProjection ?? this.getWorkCase(workCaseId);
      const intent = projection.state.actionIntents.find((item) => item.id === command.payload.actionIntentId);
      assert(intent, 'ACTION_NOT_FOUND', 'ActionIntent 不存在。', 404);
      // Validate actor/state/authority before the mock adapter is invoked; transaction validation repeats afterward.
      decideCommand(projection.state, { ...command, payload: { ...command.payload, _connectorReceipt: { status: 'unknown' } } }, config);
      const controller = new AbortController();
      const connectorOperation = this.operationTracker?.begin('connector', {
        traceId: command.traceId, workCaseId, actionIntentId: intent.id,
      }, { abort: (reason) => controller.abort(reason) });
      const timer = setTimeout(() => controller.abort(Object.assign(new Error('Connector deadline exceeded.'), { code: 'CONNECTOR_DEADLINE' })), this.connectorDeadlineMs);
      timer.unref?.();
      this.logger?.log('info', 'adapter.execution.started', {
        traceId: command.traceId, commandId: command.commandId, workCaseId,
        component: 'adapter', operation: intent.operation, authority: 'deterministic_authorized',
        adapterStatus: 'executing', resultStatus: 'started',
      });
      try {
        const rawReceipt = await Promise.race([
          this.connector.execute(intent, { traceId: command.traceId, signal: controller.signal }),
          new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('Connector aborted.')), { once: true })),
        ]);
        command.payload._connectorReceipt = validateExecutionReceipt(rawReceipt, intent);
      } catch (error) {
        const attemptedAt = this.clock();
        const errorClass = controller.signal.reason?.code === 'CONNECTOR_DEADLINE'
          ? 'connector_deadline_unknown'
          : controller.signal.aborted ? 'shutdown_aborted_unknown' : 'connector_transport_unknown';
        command.payload._connectorReceipt = validateExecutionReceipt({
          id: `${intent.id}:receipt:unknown`,
          actionIntentId: intent.id,
          adapterId: this.connector.adapterId ?? 'unknown-adapter',
          externalRequestId: `unknown:${intent.idempotencyKey}`,
          status: 'unknown',
          externalRecordRefs: [],
          resultHash: canonicalHash({ actionIntentId: intent.id, status: 'unknown', errorClass }),
          attemptedAt,
          completedAt: null,
          errorClass,
        }, intent);
      } finally {
        clearTimeout(timer);
        connectorOperation?.end();
      }
      this.logger?.log(command.payload._connectorReceipt.status === 'succeeded' ? 'info' : 'warn', 'adapter.execution.completed', {
        traceId: command.traceId, commandId: command.commandId, workCaseId,
        component: 'adapter', operation: intent.operation, authority: 'deterministic_authorized',
        adapterStatus: command.payload._connectorReceipt.status,
        resultStatus: command.payload._connectorReceipt.status,
      });
    }
    try {
      const result = this.store.executeCommand({
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
      this.logger?.log('info', 'domain.command.committed', {
        traceId: command.traceId, commandId: command.commandId, workCaseId,
        eventIds: result.eventIds, streamVersion: result.streamVersion,
        component: 'domain', operation: command.commandType,
        authority: 'deterministic', resultStatus: 'committed',
      });
      return result;
    } catch (error) {
      this.logger?.log('warn', 'domain.command.failed', {
        traceId: command.traceId, commandId: command.commandId, workCaseId,
        component: 'domain', operation: command.commandType,
        authority: 'deterministic', resultStatus: 'failed',
        errorCode: error.code ?? 'INTERNAL_ERROR',
      });
      throw error;
    }
  }

  async readiness() {
    const persistence = this.store.readiness();
    let connector;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.connectorDeadlineMs, 2_000));
    timer.unref?.();
    try {
      connector = await Promise.race([
        this.connector.health({ signal: controller.signal }),
        new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('connector health deadline')), { once: true })),
      ]);
    } catch {
      connector = { status: 'degraded', adapterId: this.connector.adapterId ?? 'unknown-adapter', errorCode: 'CONNECTOR_HEALTH_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
    }
    return {
      status: persistence.status === 'ready' ? 'ready' : 'error',
      persistence,
      connector,
      advisoryProvider: { status: 'composed_at_http_boundary' },
      authentication: { status: 'not_implemented', identityAssurance: 'demo_unverified' },
    };
  }
}
