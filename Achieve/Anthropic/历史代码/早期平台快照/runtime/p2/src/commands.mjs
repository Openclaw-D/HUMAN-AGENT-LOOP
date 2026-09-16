import {
  P2Error,
  validationError,
  authorityDenied,
  invalidTransition,
} from './errors.mjs';
import { P2_GATE_DECISIONS, P2_RECEIPT_STATUSES } from './projection.mjs';

export const P2_COMMAND_TYPES = Object.freeze([
  'append_message',
  'accept_handoff',
  'decide_gate',
  'resume_agent',
  'create_action_intent',
  'record_receipt',
]);

const COMMAND_FIELDS = Object.freeze([
  'commandId',
  'idempotencyKey',
  'expectedVersion',
  'type',
  'payload',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, name, min = 1, max = 4000) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw validationError('输入文本长度不在允许范围内。', { field: name, min, max });
  }
  return value;
}

function requireId(value, name) {
  return requireString(value, name, 1, 128);
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) {
    throw validationError('输入取值不在允许范围内。', { field: name, allowed: [...values] });
  }
  return value;
}

function requirePayloadKeys(payload, required) {
  if (!isPlainObject(payload)) {
    throw validationError('命令载荷必须为对象。', { field: 'command.payload' });
  }
  for (const key of required) {
    if (!Object.hasOwn(payload, key)) {
      throw validationError('命令载荷缺少必要字段。', { field: `command.payload.${key}` });
    }
  }
  const allowed = new Set(required);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw validationError('命令载荷包含未授权字段。', { field: `command.payload.${key}` });
    }
  }
}

export function validateIdentity(identity, name = 'identity') {
  if (!isPlainObject(identity)) {
    throw validationError('身份必须为对象。', { field: name });
  }
  return {
    workspaceId: requireId(identity.workspaceId, `${name}.workspaceId`),
    caseId: requireId(identity.caseId, `${name}.caseId`),
  };
}

export function validateCommandEnvelope(command) {
  if (!isPlainObject(command)) {
    throw validationError('命令必须为对象。', { field: 'command' });
  }
  const keys = Object.keys(command);
  const requiredSet = new Set(COMMAND_FIELDS);
  if (keys.length !== requiredSet.size || keys.some((key) => !requiredSet.has(key))) {
    throw validationError('命令字段与契约不一致。', {
      field: 'command',
      expectedFields: [...COMMAND_FIELDS],
      actualFields: keys,
    });
  }
  return {
    commandId: requireId(command.commandId, 'command.commandId'),
    idempotencyKey: requireId(command.idempotencyKey, 'command.idempotencyKey'),
    expectedVersion: (typeof command.expectedVersion === 'number' && Number.isInteger(command.expectedVersion) && command.expectedVersion >= 0)
      ? command.expectedVersion
      : (() => { throw validationError('expectedVersion必须为非负整数。', { field: 'command.expectedVersion' }); })(),
    type: requireEnum(command.type, P2_COMMAND_TYPES, 'command.type'),
    payload: command.payload,
  };
}

function actorById(projection, actorId) {
  return projection.actors.find((a) => a.id === actorId) ?? null;
}

function requireKnownActor(projection, actorId, commandType) {
  const actor = actorById(projection, actorId);
  if (!actor) {
    throw authorityDenied('未知参与者，所有公开写入必须有已知X-Actor-Id。', {
      commandType, actorId,
    });
  }
  return actor;
}

function requireHumanActor(projection, actorId, commandType) {
  const actor = requireKnownActor(projection, actorId, commandType);
  if (actor.actorType !== 'human') {
    throw authorityDenied('只有具名人类参与者可以执行此命令。', {
      commandType, actorId, actorType: actor.actorType,
    });
  }
  return actor;
}

function draftEvent(projection, type, actorId, payload) {
  return {
    type,
    actorId,
    payload: {
      identity: { workspaceId: projection.identity.workspaceId, caseId: projection.identity.caseId },
      ...payload,
    },
  };
}

export function planCommand(projection, actorId, envelope) {
  const type = envelope.type;
  const payload = envelope.payload;
  const actor = requireKnownActor(projection, actorId, type);

  switch (type) {
    case 'append_message': {
      requirePayloadKeys(payload, ['body']);
      requireString(payload.body, 'command.payload.body', 1, 4000);
      return [draftEvent(projection, 'MessageAppended', actorId, { body: payload.body })];
    }

    case 'accept_handoff': {
      requirePayloadKeys(payload, []);
      requireHumanActor(projection, actorId, type);
      if (!projection.pendingHandoff) {
        throw invalidTransition('没有待接受的Handoff。', { commandType: type });
      }
      if (projection.pendingHandoff.toActorId !== actorId) {
        throw authorityDenied('只有被点名的接收者才能接受Handoff。', {
          commandType: type,
          requiredActorId: projection.pendingHandoff.toActorId,
          actualActorId: actorId,
        });
      }
      return [draftEvent(projection, 'HandoffAccepted', actorId, {
        nextStep: payload.nextStep ?? '接力已接受，等待关口决定。',
      })];
    }

    case 'decide_gate': {
      requirePayloadKeys(payload, ['decision', 'gateId', 'deciderActorId']);
      requireEnum(payload.decision, P2_GATE_DECISIONS, 'command.payload.decision');
      requireId(payload.gateId, 'command.payload.gateId');
      requireId(payload.deciderActorId, 'command.payload.deciderActorId');
      requireHumanActor(projection, actorId, type);
      if (payload.deciderActorId !== actorId) {
        throw authorityDenied('deciderActorId必须等于X-Actor-Id。', {
          commandType: type,
          deciderActorId: payload.deciderActorId,
          actualActorId: actorId,
        });
      }
      const gate = projection.gate;
      if (gate) {
        if (gate.status !== 'pending') {
          throw invalidTransition('关口已经决定。', { commandType: type, gateStatus: gate.status });
        }
        if (gate.deciderActorId !== actorId) {
          throw authorityDenied('只有具名关口决定者才能决定关口。', {
            commandType: type,
            requiredActorId: gate.deciderActorId,
            actualActorId: actorId,
          });
        }
      } else {
        // Inline gate creation by the named decider
        const target = actorById(projection, payload.deciderActorId);
        if (!target || target.actorType !== 'human') {
          throw authorityDenied('关口决定者必须是已知具名人类。', {
            commandType: type, deciderActorId: payload.deciderActorId,
          });
        }
      }
      return [draftEvent(projection, 'GateDecided', actorId, {
        gateId: payload.gateId,
        decision: payload.decision,
        deciderActorId: payload.deciderActorId,
        basis: payload.basis ?? '',
        impact: payload.impact ?? '',
      })];
    }

    case 'resume_agent': {
      requirePayloadKeys(payload, ['agentActorId']);
      requireId(payload.agentActorId, 'command.payload.agentActorId');
      requireHumanActor(projection, actorId, type);
      const gate = projection.gate;
      if (!gate || gate.status !== 'approved' || gate.goalVersion !== projection.case.goalVersion) {
        throw invalidTransition('Agent续跑必须依赖当前目标版本下已通过的人工关口。', {
          commandType: type,
          gateStatus: gate?.status ?? null,
          gateGoalVersion: gate?.goalVersion ?? null,
          currentGoalVersion: projection.case.goalVersion,
        });
      }
      const agent = actorById(projection, payload.agentActorId);
      if (!agent || (agent.actorType !== 'model' && agent.actorType !== 'system')) {
        throw validationError('resume_agent目标必须是已知模型或系统参与者。', {
          field: 'command.payload.agentActorId',
        });
      }
      if (projection.agentContinuity) {
        throw invalidTransition('AgentContinuity已存在，不能重复续跑。', { commandType: type });
      }
      return [draftEvent(projection, 'AgentResumed', actorId, {
        agentActorId: payload.agentActorId,
      })];
    }

    case 'create_action_intent': {
      requirePayloadKeys(payload, ['actionIntentId', 'actionLabel', 'targetActorId']);
      requireId(payload.actionIntentId, 'command.payload.actionIntentId');
      requireString(payload.actionLabel, 'command.payload.actionLabel', 1, 500);
      requireId(payload.targetActorId, 'command.payload.targetActorId');
      requireHumanActor(projection, actorId, type);
      if (projection.actionIntents.some((a) => a.id === payload.actionIntentId)) {
        throw invalidTransition('外部动作已存在。', { commandType: type, actionIntentId: payload.actionIntentId });
      }
      const gate = projection.gate;
      if (!gate || gate.status !== 'approved' || gate.goalVersion !== projection.case.goalVersion) {
        throw invalidTransition('外部动作必须依赖当前目标版本下已通过的人工关口。', {
          commandType: type,
          gateStatus: gate?.status ?? null,
          currentGoalVersion: projection.case.goalVersion,
        });
      }
      const target = actorById(projection, payload.targetActorId);
      if (!target || (target.actorType !== 'system' && target.actorType !== 'connector')) {
        throw validationError('外部动作目标必须是已知system或connector参与者。', {
          field: 'command.payload.targetActorId',
        });
      }
      return [draftEvent(projection, 'ActionIntentCreated', actorId, {
        actionIntentId: payload.actionIntentId,
        actionLabel: payload.actionLabel,
        targetActorId: payload.targetActorId,
      })];
    }

    case 'record_receipt': {
      requirePayloadKeys(payload, ['receiptId', 'actionIntentId', 'status', 'summary']);
      requireId(payload.receiptId, 'command.payload.receiptId');
      requireId(payload.actionIntentId, 'command.payload.actionIntentId');
      requireEnum(payload.status, P2_RECEIPT_STATUSES, 'command.payload.status');
      requireString(payload.summary, 'command.payload.summary', 1, 2000);
      const actor = requireKnownActor(projection, actorId, type);
      if (actor.actorType !== 'connector' && actor.actorType !== 'system') {
        throw authorityDenied('只有connector或system可以记录回执。', {
          commandType: type, actorType: actor.actorType,
        });
      }
      const intent = projection.actionIntents.find((a) => a.id === payload.actionIntentId);
      if (!intent) {
        throw invalidTransition('外部动作不存在。', { commandType: type, actionIntentId: payload.actionIntentId });
      }
      if (intent.state !== 'awaiting_receipt') {
        throw invalidTransition('外部动作不是等待回执状态。', { commandType: type, actionState: intent.state });
      }
      return [draftEvent(projection, 'ReceiptRecorded', actorId, {
        receiptId: payload.receiptId,
        actionIntentId: payload.actionIntentId,
        status: payload.status,
        summary: payload.summary,
      })];
    }

    default:
      throw validationError('未知命令类型。', { field: 'command.type', commandType: type });
  }
}
