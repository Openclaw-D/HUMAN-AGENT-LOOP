const PUBLIC_COMMAND_TYPES = Object.freeze([
  'append_message',
  'change_goal',
  'request_evidence',
  'provide_evidence',
  'propose_artifact',
  'raise_challenge',
  'decide_gate',
  'propose_handoff',
  'accept_handoff',
  'pause_work',
  'resume_work',
  'rollback_work',
  'request_action',
  'record_receipt',
]);

const DEFERRED_COMMAND_TYPES = Object.freeze(['request_model_run']);
const INTERNAL_COMMAND_TYPES = Object.freeze(['append_model_run_events']);
const GATE_DECISIONS = Object.freeze(['approved', 'rejected', 'needs_evidence']);
const RECEIPT_STATUSES = Object.freeze(['succeeded', 'failed', 'unknown']);
const CHALLENGE_SEVERITIES = Object.freeze(['low', 'normal', 'high', 'critical']);
const COMMAND_FIELDS = Object.freeze([
  'commandId',
  'idempotencyKey',
  'expectedProjectionVersion',
  'type',
  'payload',
]);

export class V2Error extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'V2Error';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const V2_COMMAND_TYPES = PUBLIC_COMMAND_TYPES;
export const V2_REQUESTABLE_COMMAND_TYPES = Object.freeze([
  ...PUBLIC_COMMAND_TYPES,
  ...DEFERRED_COMMAND_TYPES,
]);

function validationError(message, details = {}) {
  return new V2Error(400, 'VALIDATION_ERROR', message, details);
}

function authorityDenied(message, details = {}) {
  return new V2Error(403, 'AUTHORITY_DENIED', message, details);
}

function invalidTransition(message, details = {}) {
  return new V2Error(409, 'INVALID_TRANSITION', message, details);
}

function modelRuntimeRequired(details = {}) {
  return new V2Error(
    409,
    'MODEL_RUNTIME_REQUIRED',
    '模型运行生命周期由后续运行时分区实现，本分区必须失败关闭。',
    details,
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw validationError('输入必须为对象。', { field: name });
}

function assertKeys(value, required, name) {
  const keys = Object.keys(value);
  const requiredSet = new Set(required);
  if (keys.length !== requiredSet.size || keys.some((key) => !requiredSet.has(key))) {
    throw validationError('输入字段与契约不一致。', {
      field: name,
      expectedFields: [...required],
      actualFields: keys,
    });
  }
}

function requireString(value, name, { minLength = 1, maxLength = 4000 } = {}) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw validationError('输入文本长度不在允许范围内。', { field: name });
  }
  return value;
}

function requireId(value, name) {
  return requireString(value, name, { minLength: 1, maxLength: 128 });
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) {
    throw validationError('输入取值不在允许范围内。', { field: name, allowed: [...values] });
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw validationError('输入必须为数组。', { field: name });
  return value;
}

function requirePayloadKeys(payload, required, optional = []) {
  assertPlainObject(payload, 'command.payload');
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(payload, key)) {
      throw validationError('命令载荷缺少必要字段。', { field: `command.payload.${key}` });
    }
  }
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw validationError('命令载荷包含未授权字段。', { field: `command.payload.${key}` });
    }
  }
}

export function validateV2Identity(identity, name = 'identity') {
  assertPlainObject(identity, name);
  assertKeys(identity, ['workspaceId', 'workId'], name);
  return {
    workspaceId: requireId(identity.workspaceId, `${name}.workspaceId`),
    workId: requireId(identity.workId, `${name}.workId`),
  };
}

function canonicalize(value, name = 'request') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationError('输入包含无效数字。', { field: name });
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${name}[${index}]`));
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key], `${name}.${key}`);
    return result;
  }
  throw validationError('输入包含不可序列化的值。', { field: name });
}

export function canonicalV2Json(value) {
  return JSON.stringify(canonicalize(value));
}

export function validateV2CommandEnvelope(
  command,
  { allowedTypes = V2_REQUESTABLE_COMMAND_TYPES } = {},
) {
  assertPlainObject(command, 'command');
  assertKeys(command, COMMAND_FIELDS, 'command');
  requireId(command.commandId, 'command.commandId');
  requireId(command.idempotencyKey, 'command.idempotencyKey');
  if (
    !Number.isInteger(command.expectedProjectionVersion) ||
    command.expectedProjectionVersion < 1
  ) {
    throw validationError('期望投影版本必须是正整数', {
      field: 'command.expectedProjectionVersion',
    });
  }
  requireEnum(command.type, allowedTypes, 'command.type');
  assertPlainObject(command.payload, 'command.payload');
  const serialized = canonicalV2Json(command.payload);
  if (serialized.length > 1_000_000) {
    throw validationError('命令载荷过大，已拒绝处理', { field: 'command.payload' });
  }
  return {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    expectedProjectionVersion: command.expectedProjectionVersion,
    type: command.type,
    payload: clone(command.payload),
  };
}

export function validateV2InternalCommandEnvelope(command) {
  return validateV2CommandEnvelope(command, { allowedTypes: INTERNAL_COMMAND_TYPES });
}

function actorById(projection, actorId) {
  return projection.actors.find((actor) => actor.id === actorId) ?? null;
}

function findById(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) throw validationError(`指定${label}不存在。`, { objectId: id, objectType: label });
  return item;
}

function requireUnique(collection, id, label) {
  if (collection.some((item) => item.id === id)) {
    throw invalidTransition(`指定${label}已存在，不能重复创建。`, {
      objectId: id,
      objectType: label,
    });
  }
}

function requireProjection(projection) {
  assertPlainObject(projection, 'projection');
  if (projection.schemaVersion !== 'work-projection.v2') {
    throw validationError('输入不是当前版本的权威工作投影。', {
      field: 'projection.schemaVersion',
    });
  }
  validateV2Identity(projection.projectionIdentity, 'projection.projectionIdentity');
  if (!Number.isInteger(projection.projectionVersion) || projection.projectionVersion < 1) {
    throw validationError('投影版本无效', { field: 'projection.projectionVersion' });
  }
  if (projection.eventCursor !== projection.projectionVersion) {
    throw validationError('事件游标与投影版本不一致', {
      eventCursor: projection.eventCursor,
      projectionVersion: projection.projectionVersion,
    });
  }
  requireArray(projection.actors, 'projection.actors');
  assertPlainObject(projection.work, 'projection.work');
  requireString(projection.work.status, 'projection.work.status');
}

function requireKnownActor(projection, actorId, commandType) {
  const actor = actorById(projection, actorId);
  if (!actor) {
    throw authorityDenied('命令执行者必须是当前投影的已知参与者。', {
      commandType,
      actorId,
    });
  }
  return actor;
}

function requireActorType(actor, type, commandType) {
  const labels = { human: '人类', agent: '智能体', system: '系统' };
  if (actor.type !== type) {
    throw authorityDenied(`该命令必须由具名${labels[type]}参与者执行。`, {
      commandType,
      actorId: actor.id,
      actorType: actor.type,
      requiredActorType: type,
    });
  }
}

function requireOwnerActor(projection, actor, commandType) {
  requireActorType(actor, 'human', commandType);
  if (projection.work.ownerActorId !== actor.id) {
    throw authorityDenied('该命令只能由当前负责人执行。', {
      commandType,
      actorId: actor.id,
      ownerActorId: projection.work.ownerActorId,
    });
  }
}

function hasGateAuthority(actor) {
  if (actor.type !== 'human') return false;
  return typeof actor.authority === 'string' && actor.authority.includes('关口');
}

function requireGateActor(projection, actor, commandType) {
  requireActorType(actor, 'human', commandType);
  if (!hasGateAuthority(actor)) {
    throw authorityDenied('人工关口决定必须由具备关口责任的具名人类执行。', {
      commandType,
      actorId: actor.id,
      actorAuthority: actor.authority ?? '',
    });
  }
}

function requireOperational(projection, commandType, { allowPaused = false } = {}) {
  const status = projection.work.status;
  if (status === 'completed' || status === 'unknown' || (!allowPaused && status === 'paused')) {
    throw invalidTransition('当前工作状态不允许执行该命令，必须先完成核验或恢复到可操作状态。', {
      commandType,
      workStatus: status,
    });
  }
}

function requireEvidenceRefs(projection, evidenceIds, commandType) {
  for (const evidenceId of evidenceIds) {
    findById(projection.evidence, requireId(evidenceId, 'sourceEvidenceIds项'), '证据');
  }
}

function draftEvent(projection, type, actorId, payload) {
  return [{
    type,
    actorId,
    payload: {
      identity: clone(projection.projectionIdentity),
      ...payload,
    },
  }];
}

export function planV2Command(projection, actorId, command, context = {}) {
  requireProjection(projection);
  requireId(actorId, 'actorId');
  const envelope = validateV2CommandEnvelope(command);
  assertPlainObject(context, 'context');

  const actor = requireKnownActor(projection, actorId, envelope.type);
  const payload = envelope.payload;
  const type = envelope.type;

  if (type === 'request_model_run') {
    throw modelRuntimeRequired({
      commandType: type,
      actorId,
      projectionVersion: projection.projectionVersion,
    });
  }

  switch (type) {
    case 'append_message': {
      requirePayloadKeys(payload, ['body']);
      requireString(payload.body, 'command.payload.body');
      if (actor.type === 'system') {
        throw authorityDenied('系统连接器不能追加普通对话消息。', { commandType: type, actorId });
      }
      return draftEvent(projection, 'MessageAppended', actorId, { body: payload.body });
    }

    case 'change_goal': {
      requirePayloadKeys(payload, ['goal', 'reason'], ['nextStep']);
      requireString(payload.goal, 'command.payload.goal');
      requireString(payload.reason, 'command.payload.reason');
      if (payload.nextStep !== undefined) requireString(payload.nextStep, 'command.payload.nextStep');
      requireOwnerActor(projection, actor, type);
      requireOperational(projection, type);
      const eventPayload = { goal: payload.goal, reason: payload.reason };
      if (payload.nextStep !== undefined) eventPayload.nextStep = payload.nextStep;
      return draftEvent(projection, 'GoalChanged', actorId, eventPayload);
    }

    case 'request_evidence': {
      requirePayloadKeys(
        payload,
        ['evidenceId', 'subject', 'reason', 'requestedFromActorId'],
        ['dueAt'],
      );
      requireId(payload.evidenceId, 'command.payload.evidenceId');
      requireString(payload.subject, 'command.payload.subject');
      requireString(payload.reason, 'command.payload.reason');
      requireId(payload.requestedFromActorId, 'command.payload.requestedFromActorId');
      if (payload.dueAt !== undefined) requireString(payload.dueAt, 'command.payload.dueAt');
      requireActorType(actor, 'human', type);
      if (projection.work.ownerActorId !== actor.id && !hasGateAuthority(actor)) {
        throw authorityDenied('只有负责人或关口人能请求证据。', { commandType: type, actorId });
      }
      requireOperational(projection, type);
      const target = actorById(projection, payload.requestedFromActorId);
      if (!target) throw validationError('证据提供者不是已知参与者', {
        field: 'command.payload.requestedFromActorId',
      });
      requireUnique(projection.evidence, payload.evidenceId, '证据');
      const eventPayload = {
        evidenceId: payload.evidenceId,
        subject: payload.subject,
        reason: payload.reason,
        requestedFromActorId: payload.requestedFromActorId,
      };
      if (payload.dueAt !== undefined) eventPayload.dueAt = payload.dueAt;
      return draftEvent(projection, 'EvidenceRequested', actorId, eventPayload);
    }

    case 'provide_evidence': {
      requirePayloadKeys(payload, ['evidenceId', 'version', 'summary']);
      requireId(payload.evidenceId, 'command.payload.evidenceId');
      requireString(payload.version, 'command.payload.version');
      requireString(payload.summary, 'command.payload.summary');
      requireOperational(projection, type);
      const evidence = findById(projection.evidence, payload.evidenceId, '证据');
      if (evidence.status !== 'requested') {
        throw invalidTransition('证据不是待提供状态。', {
          commandType: type,
          evidenceStatus: evidence.status,
        });
      }
      if (evidence.requestedFromActorId !== actorId) {
        throw authorityDenied('只有被指定的证据提供者能提供该证据。', {
          commandType: type,
          actorId,
          requestedFromActorId: evidence.requestedFromActorId,
        });
      }
      return draftEvent(projection, 'EvidenceProvided', actorId, {
        evidenceId: payload.evidenceId,
        version: payload.version,
        summary: payload.summary,
      });
    }

    case 'propose_artifact': {
      requirePayloadKeys(
        payload,
        ['artifactId', 'title', 'body'],
        ['sourceEvidenceIds'],
      );
      requireId(payload.artifactId, 'command.payload.artifactId');
      requireString(payload.title, 'command.payload.title');
      requireString(payload.body, 'command.payload.body');
      const evidenceIds = payload.sourceEvidenceIds === undefined
        ? []
        : requireArray(payload.sourceEvidenceIds, 'command.payload.sourceEvidenceIds');
      requireOwnerActor(projection, actor, type);
      requireOperational(projection, type);
      requireUnique(projection.artifacts, payload.artifactId, '候选产物');
      requireEvidenceRefs(projection, evidenceIds, type);
      const eventPayload = {
        artifactId: payload.artifactId,
        title: payload.title,
        body: payload.body,
      };
      if (payload.sourceEvidenceIds !== undefined) {
        eventPayload.sourceEvidenceIds = clone(evidenceIds);
      }
      return draftEvent(projection, 'ArtifactProposed', actorId, eventPayload);
    }

    case 'raise_challenge': {
      requirePayloadKeys(payload, ['challengeId', 'title', 'reason'], ['severity']);
      requireId(payload.challengeId, 'command.payload.challengeId');
      requireString(payload.title, 'command.payload.title');
      requireString(payload.reason, 'command.payload.reason');
      if (payload.severity !== undefined) {
        requireEnum(payload.severity, CHALLENGE_SEVERITIES, 'command.payload.severity');
      }
      if (actor.type === 'system') {
        throw authorityDenied('系统连接器不能提出质疑。', { commandType: type, actorId });
      }
      requireOperational(projection, type);
      requireUnique(projection.challenges, payload.challengeId, '质疑');
      const eventPayload = {
        challengeId: payload.challengeId,
        title: payload.title,
        reason: payload.reason,
      };
      if (payload.severity !== undefined) eventPayload.severity = payload.severity;
      return draftEvent(projection, 'ChallengeRaised', actorId, eventPayload);
    }

    case 'decide_gate': {
      requirePayloadKeys(payload, ['gateId', 'decision', 'basis', 'impact']);
      requireId(payload.gateId, 'command.payload.gateId');
      requireEnum(payload.decision, GATE_DECISIONS, 'command.payload.decision');
      requireString(payload.basis, 'command.payload.basis');
      requireString(payload.impact, 'command.payload.impact');
      requireGateActor(projection, actor, type);
      requireOperational(projection, type);
      requireUnique(projection.gates, payload.gateId, '人工关口');
      return draftEvent(projection, 'GateDecided', actorId, {
        gateId: payload.gateId,
        decision: payload.decision,
        basis: payload.basis,
        impact: payload.impact,
      });
    }

    case 'propose_handoff': {
      requirePayloadKeys(payload, ['handoffId', 'recipientActorId', 'context']);
      requireId(payload.handoffId, 'command.payload.handoffId');
      requireId(payload.recipientActorId, 'command.payload.recipientActorId');
      requireString(payload.context, 'command.payload.context');
      requireOwnerActor(projection, actor, type);
      requireOperational(projection, type);
      requireUnique(projection.handoffs, payload.handoffId, '责任交接');
      const recipient = actorById(projection, payload.recipientActorId);
      if (!recipient) {
        throw validationError('交接接收者不是已知参与者', {
          field: 'command.payload.recipientActorId',
        });
      }
      if (recipient.type !== 'human' || recipient.id === projection.work.ownerActorId) {
        throw invalidTransition('责任只能交接给另一位具名人类参与者。', {
          commandType: type,
          recipientActorId: recipient.id,
        });
      }
      return draftEvent(projection, 'HandoffProposed', actorId, {
        handoffId: payload.handoffId,
        recipientActorId: payload.recipientActorId,
        context: payload.context,
      });
    }

    case 'accept_handoff': {
      requirePayloadKeys(payload, ['handoffId']);
      requireId(payload.handoffId, 'command.payload.handoffId');
      requireActorType(actor, 'human', type);
      const handoff = findById(projection.handoffs, payload.handoffId, '责任交接');
      if (handoff.state !== 'pending') {
        throw invalidTransition('责任交接不是待接收状态。', {
          commandType: type,
          handoffState: handoff.state,
        });
      }
      if (handoff.toActorId !== actorId) {
        throw authorityDenied('只有具名接收者能接受责任交接。', {
          commandType: type,
          actorId,
          recipientActorId: handoff.toActorId,
        });
      }
      return draftEvent(projection, 'HandoffAccepted', actorId, {
        handoffId: payload.handoffId,
      });
    }

    case 'pause_work': {
      requirePayloadKeys(payload, []);
      requireOwnerActor(projection, actor, type);
      if (['paused', 'completed', 'unknown'].includes(projection.work.status)) {
        throw invalidTransition('当前工作不能暂停。', {
          commandType: type,
          workStatus: projection.work.status,
        });
      }
      return draftEvent(projection, 'WorkPaused', actorId, {});
    }

    case 'resume_work': {
      requirePayloadKeys(payload, []);
      requireOwnerActor(projection, actor, type);
      if (projection.work.status !== 'paused') {
        throw invalidTransition('只有已暂停工作能恢复。', {
          commandType: type,
          workStatus: projection.work.status,
        });
      }
      return draftEvent(projection, 'WorkResumed', actorId, {});
    }

    case 'rollback_work': {
      requirePayloadKeys(payload, ['toStageId', 'reason']);
      requireId(payload.toStageId, 'command.payload.toStageId');
      requireString(payload.reason, 'command.payload.reason');
      requireOwnerActor(projection, actor, type);
      if (projection.work.status === 'completed') {
        throw invalidTransition('已完成工作不能直接回退。', {
          commandType: type,
          workStatus: projection.work.status,
        });
      }
      findById(projection.stages, payload.toStageId, '阶段');
      return draftEvent(projection, 'WorkRolledBack', actorId, {
        toStageId: payload.toStageId,
        reason: payload.reason,
      });
    }

    case 'request_action': {
      requirePayloadKeys(
        payload,
        ['actionIntentId', 'actionLabel', 'targetActorId', 'gateId'],
      );
      requireId(payload.actionIntentId, 'command.payload.actionIntentId');
      requireString(payload.actionLabel, 'command.payload.actionLabel');
      requireId(payload.targetActorId, 'command.payload.targetActorId');
      requireId(payload.gateId, 'command.payload.gateId');
      requireOwnerActor(projection, actor, type);
      requireOperational(projection, type);
      requireUnique(projection.actions, payload.actionIntentId, '外部动作');
      const target = actorById(projection, payload.targetActorId);
      if (!target || target.type !== 'system') {
        throw validationError('外部动作目标必须是已知系统参与者。', {
          field: 'command.payload.targetActorId',
        });
      }
      const gate = findById(projection.gates, payload.gateId, '人工关口');
      if (
        gate.state !== 'approved' ||
        gate.validAgainstGoalVersion === false ||
        gate.goalVersion !== projection.work.goalVersion
      ) {
        throw invalidTransition('外部动作必须依赖当前目标版本下仍有效且已通过的人工关口。', {
          commandType: type,
          gateId: gate.id,
          gateState: gate.state,
          gateGoalVersion: gate.goalVersion,
          currentGoalVersion: projection.work.goalVersion,
        });
      }
      if (projection.actions.some((action) => action.gateId === gate.id)) {
        throw invalidTransition('同一人工关口已绑定外部动作；回执未知时必须先核验，不能重复执行。', {
          commandType: type,
          gateId: gate.id,
          existingActionIntentIds: projection.actions
            .filter((action) => action.gateId === gate.id)
            .map((action) => action.id),
        });
      }
      if (projection.actions.some((action) => (
        action.targetActorId === target.id
        && action.actionLabel === payload.actionLabel
        && action.state === 'unknown'
      ))) {
        throw invalidTransition('同名外部动作已有未知回执，必须先完成核验，不能重复执行。', {
          commandType: type,
          targetActorId: target.id,
          actionLabel: payload.actionLabel,
        });
      }
      return draftEvent(projection, 'ActionIntentRequested', actorId, {
        actionIntentId: payload.actionIntentId,
        actionLabel: payload.actionLabel,
        targetActorId: payload.targetActorId,
        gateId: payload.gateId,
      });
    }

    case 'record_receipt': {
      requirePayloadKeys(
        payload,
        ['receiptId', 'actionIntentId', 'status', 'summary'],
      );
      requireId(payload.receiptId, 'command.payload.receiptId');
      requireId(payload.actionIntentId, 'command.payload.actionIntentId');
      requireEnum(payload.status, RECEIPT_STATUSES, 'command.payload.status');
      requireString(payload.summary, 'command.payload.summary');
      requireActorType(actor, 'system', type);
      const action = findById(projection.actions, payload.actionIntentId, '外部动作');
      if (action.targetActorId !== actorId) {
        throw authorityDenied('只有动作目标系统能记录该外部回执。', {
          commandType: type,
          actorId,
          targetActorId: action.targetActorId,
        });
      }
      if (action.state !== 'awaiting_receipt') {
        throw invalidTransition('外部动作不是等待回执状态；未知回执必须先人工核验，不能重复执行。', {
          commandType: type,
          actionIntentId: action.id,
          actionState: action.state,
        });
      }
      requireUnique(projection.receipts, payload.receiptId, '外部回执');
      return draftEvent(projection, 'ReceiptRecorded', actorId, {
        receiptId: payload.receiptId,
        actionIntentId: payload.actionIntentId,
        status: payload.status,
        summary: payload.summary,
      });
    }

    default:
      throw validationError('未知命令类型', { field: 'command.type', commandType: type });
  }
}

export const V2_INTERNAL_COMMAND_TYPES = INTERNAL_COMMAND_TYPES;
