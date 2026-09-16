import { createSampleDefinition, getScenarioPack } from './v2-scenarios.mjs';
import { V2Error } from './v2-commands.mjs';

export const V2_EVENT_TYPES = Object.freeze([
  'WorkCreated',
  'MessageAppended',
  'GoalChanged',
  'EvidenceRequested',
  'EvidenceProvided',
  'ArtifactProposed',
  'ChallengeRaised',
  'GateDecided',
  'HandoffProposed',
  'HandoffAccepted',
  'ActionIntentRequested',
  'ReceiptRecorded',
  'WorkPaused',
  'WorkResumed',
  'WorkRolledBack',
  'ModelRunRequested',
  'ModelRunStarted',
  'ModelRunArtifactProduced',
  'ModelRunCompleted',
  'ModelRunFailed',
  'ModelRunUnknown',
  'ModelRunCancelRequested',
  'ModelRunCancelled',
]);

const V2_VIEW_TYPES = Object.freeze(['relation', 'progress', 'matrix']);
const V2_DATA_ORIGINS = Object.freeze(['sample', 'user', 'connector']);
const V2_ACTOR_TYPES = Object.freeze(['human', 'agent', 'system']);
const V2_EVENT_FIELDS = Object.freeze(['eventId', 'sequence', 'type', 'occurredAt', 'actorId', 'payload']);
const V2_GATE_DECISIONS = Object.freeze(['approved', 'rejected', 'needs_evidence']);
const V2_RECEIPT_STATUSES = Object.freeze(['succeeded', 'failed', 'unknown']);
const V2_MODEL_TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'unknown', 'cancelled']);
const WORK_STATUS_LABELS = Object.freeze({
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  blocked: '存在质疑',
  awaiting_evidence: '等待证据',
  awaiting_gate: '等待人工关口',
  awaiting_receipt: '等待外部回执',
  unknown: '状态待核验',
});

function invalid(message) {
  return new Error(`V2投影事件无效：${message}`);
}

function projectionValidationError(message, details) {
  return new V2Error(400, 'VALIDATION_ERROR', message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4000) {
    throw invalid(`${name}必须为1..4000个字符`);
  }
  return value;
}

function requireId(value, name) {
  return requireString(value, name);
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) throw invalid(`${name}不在允许范围内`);
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw invalid(`${name}必须为数组`);
  return value;
}

function validateIdentity(value, name = 'identity') {
  if (!isPlainObject(value)) throw invalid(`${name}必须为对象`);
  if (!isPlainObject(value.workspaceId) || !isPlainObject(value.workId)) {
    // 保留对象校验形状；实际下面逐字段检查。
  }
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) {
    throw invalid(`${name}.workspaceId必须为非空字符串`);
  }
  if (typeof value.workId !== 'string' || value.workId.length === 0) {
    throw invalid(`${name}.workId必须为非空字符串`);
  }
  return { workspaceId: value.workspaceId, workId: value.workId };
}

function sameIdentity(left, right) {
  return left.workspaceId === right.workspaceId && left.workId === right.workId;
}

function actorById(projection, actorId) {
  return projection.actors.find((actor) => actor.id === actorId) ?? null;
}

function requireKnownActor(projection, event) {
  const actor = actorById(projection, event.actorId);
  if (!actor) throw invalid(`事件actorId不是已知参与者：${event.actorId}`);
  return actor;
}

function requireActorType(projection, event, expectedType, label) {
  const actor = requireKnownActor(projection, event);
  if (actor.type !== expectedType) {
    throw invalid(`${label}要求具名${expectedType === 'human' ? '人类' : expectedType === 'agent' ? '智能体' : '系统'}参与者执行`);
  }
  return actor;
}

function requireOwnerActor(projection, event, label) {
  const actor = requireActorType(projection, event, 'human', label);
  if (projection.work.ownerActorId !== actor.id) throw invalid(`${label}要求当前负责人执行`);
  return actor;
}

function requireUniqueItem(collection, id, label) {
  if (collection.some((item) => item.id === id)) throw invalid(`${label}已存在：${id}`);
}

function findById(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) throw invalid(`${label}不存在：${id}`);
  return item;
}

function setWorkStatus(projection, status, nextStep) {
  projection.work.status = status;
  projection.work.statusLabel = WORK_STATUS_LABELS[status] ?? status;
  if (typeof nextStep === 'string' && nextStep.length > 0) projection.work.nextStep = nextStep;
  projection.work.updatedAt = projection.generatedAt;
}

function setCurrentStage(projection, stageId) {
  for (const stage of projection.stages) {
    stage.state = stage.id === stageId ? 'current' : stage.state === 'done' ? 'done' : 'pending';
    stage.stateLabel = stage.state === 'current' ? '当前阶段' : stage.state === 'done' ? '已完成' : '未开始';
  }
  projection.work.stageId = stageId;
}

function recordActivity(projection, event, title, body, authoritative) {
  projection.activities.push({
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    title,
    body: typeof body === 'string' ? body : '',
    authoritative,
  });
}

function validateWorkCreatedPayload(payload, event) {
  requireEnum(payload.dataOrigin, V2_DATA_ORIGINS, 'WorkCreated.payload.dataOrigin');
  const declaredWorkId = requireId(payload.workId, 'WorkCreated.payload.workId');
  if (declaredWorkId !== payload.identity.workId) {
    throw invalid('WorkCreated声明的工作标识与事件身份不一致');
  }
  if (!isPlainObject(payload.scenario)) throw invalid('WorkCreated.payload.scenario必须为对象');
  requireId(payload.scenario.id, 'WorkCreated.payload.scenario.id');
  requireString(payload.scenario.displayName, 'WorkCreated.payload.scenario.displayName');
  if (typeof payload.scenario.scope !== 'string' || payload.scenario.scope.length === 0) {
    throw invalid('WorkCreated.payload.scenario.scope必须为非空字符串');
  }
  requireEnum(payload.scenario.defaultView, V2_VIEW_TYPES, 'WorkCreated.payload.scenario.defaultView');

  const actors = requireArray(payload.actors, 'WorkCreated.payload.actors');
  if (actors.length < 3) throw invalid('WorkCreated至少需要人类、智能体和系统三类参与者');
  const actorIds = new Set();
  const actorTypes = new Set();
  for (const actor of actors) {
    if (!isPlainObject(actor)) throw invalid('WorkCreated.payload.actors项必须为对象');
    requireId(actor.id, 'actor.id');
    if (actorIds.has(actor.id)) throw invalid(`参与者重复：${actor.id}`);
    actorIds.add(actor.id);
    requireEnum(actor.type, V2_ACTOR_TYPES, `actor(${actor.id}).type`);
    requireString(actor.name, `actor(${actor.id}).name`);
    actorTypes.add(actor.type);
  }
  for (const requiredType of V2_ACTOR_TYPES) {
    if (!actorTypes.has(requiredType)) throw invalid(`WorkCreated缺少${requiredType}参与者`);
  }

  const stages = requireArray(payload.stages, 'WorkCreated.payload.stages');
  if (stages.length < 6) throw invalid('场景包至少需要六个阶段');
  const stageIds = new Set();
  stages.forEach((stage, index) => {
    if (!isPlainObject(stage)) throw invalid('WorkCreated.payload.stages项必须为对象');
    const id = requireId(stage.id, 'stage.id');
    if (stageIds.has(id)) throw invalid(`阶段重复：${id}`);
    stageIds.add(id);
    requireString(stage.displayName, `stage(${id}).displayName`);
    if (!Number.isInteger(stage.order) || stage.order !== index + 1) {
      throw invalid(`阶段顺序必须为连续正整数：${id}`);
    }
  });

  if (!isPlainObject(payload.work)) throw invalid('WorkCreated.payload.work必须为对象');
  requireString(payload.work.title, 'WorkCreated.payload.work.title');
  requireString(payload.work.goal, 'WorkCreated.payload.work.goal');
  const ownerId = requireId(payload.work.ownerActorId, 'WorkCreated.payload.work.ownerActorId');
  if (!actorIds.has(ownerId)) throw invalid('WorkCreated负责人必须是已知参与者');
  if (actorById({ actors }, ownerId)?.type !== 'human') throw invalid('WorkCreated负责人必须是人类');
  if (typeof payload.work.nextStep !== 'string' || payload.work.nextStep.length > 4000) {
    throw invalid('WorkCreated.payload.work.nextStep必须为字符串');
  }
  const initialStageId = requireId(payload.initialStageId, 'WorkCreated.payload.initialStageId');
  if (!stageIds.has(initialStageId)) throw invalid('WorkCreated初始阶段不存在');

  requireArray(payload.relations ?? [], 'WorkCreated.payload.relations');
  const matrix = payload.matrix;
  if (!isPlainObject(matrix)) throw invalid('WorkCreated.payload.matrix必须为对象');
  requireArray(matrix.columns, 'WorkCreated.payload.matrix.columns');
  requireArray(matrix.rows, 'WorkCreated.payload.matrix.rows');
  const columnIds = new Set(matrix.columns.map((column) => column?.id));
  if (columnIds.size !== matrix.columns.length) throw invalid('矩阵列标识重复');
  for (const row of matrix.rows) {
    if (!isPlainObject(row)) throw invalid('矩阵行必须为对象');
    if (!actorIds.has(row.actorId)) throw invalid('矩阵行引用了未知参与者');
    const cells = requireArray(row.cells, 'matrix.rows.cells');
    if (cells.length !== matrix.columns.length) throw invalid('矩阵单元格数量必须与列数量一致');
    for (const cell of cells) {
      if (!isPlainObject(cell) || !columnIds.has(cell.columnId)) throw invalid('矩阵单元格引用了未知列');
    }
  }
  requireArray(payload.loops ?? [], 'WorkCreated.payload.loops');
  return { actorIds, stageIds };
}

function applyWorkCreated(event) {
  const payload = clone(event.payload);
  const identity = payload.identity;
  validateWorkCreatedPayload(payload, event);
  const owner = payload.actors.find((actor) => actor.id === payload.work.ownerActorId);
  if (event.actorId !== owner.id) throw invalid('WorkCreated必须由具名负责人发起');

  const stages = payload.stages.map((stage, index) => ({
    ...clone(stage),
    state: index === 0 ? 'current' : 'pending',
    stateLabel: index === 0 ? '当前阶段' : '未开始',
  }));
  const projection = {
    schemaVersion: 'work-projection.v2',
    projectionIdentity: clone(identity),
    dataOrigin: payload.dataOrigin,
    scenario: clone(payload.scenario),
    work: {
      id: identity.workId,
      title: payload.work.title,
      goal: payload.work.goal,
      goalVersion: 1,
      ownerActorId: payload.work.ownerActorId,
      stageId: payload.initialStageId,
      status: 'active',
      statusLabel: WORK_STATUS_LABELS.active,
      nextStep: payload.work.nextStep,
      updatedAt: event.occurredAt,
    },
    projectionVersion: 1,
    eventCursor: 1,
    generatedAt: event.occurredAt,
    actors: clone(payload.actors),
    relations: clone(payload.relations ?? []),
    stages,
    loops: clone(payload.loops ?? []),
    matrix: clone(payload.matrix),
    evidence: [],
    artifacts: [],
    challenges: [],
    gates: [],
    handoffs: [],
    actions: [],
    receipts: [],
    modelRuns: [],
    activities: [],
    availableCommands: [],
  };
  recordActivity(projection, event, '创建协同事项', payload.work.goal, true);
  projection.availableCommands = availableCommandsFor(projection);
  return projection;
}

function applyGoalChanged(projection, event) {
  requireOwnerActor(projection, event, '目标变更');
  const payload = event.payload;
  requireString(payload.goal, 'GoalChanged.payload.goal');
  requireString(payload.reason, 'GoalChanged.payload.reason');
  const nextVersion = projection.work.goalVersion + 1;
  const previousStatus = projection.work.status;
  projection.work.goal = payload.goal;
  projection.work.goalVersion = nextVersion;
  projection.work.goalChange = {
    version: nextVersion,
    reason: payload.reason,
    changedByActorId: event.actorId,
    changedAt: event.occurredAt,
  };
  projection.work.updatedAt = event.occurredAt;
  if (typeof payload.nextStep === 'string' && payload.nextStep.length > 0) {
    projection.work.nextStep = payload.nextStep;
  } else {
    projection.work.nextStep = '目标已变更，旧候选、关口和动作需重新核对。';
  }
  if (previousStatus !== 'paused') {
    projection.work.status = 'active';
    projection.work.statusLabel = WORK_STATUS_LABELS.active;
  }

  for (const artifact of projection.artifacts) {
    artifact.state = 'pending_review';
    artifact.stateLabel = '待人工复核';
    artifact.pendingHumanReview = true;
    artifact.impactedByGoalVersion = nextVersion;
  }
  for (const gate of projection.gates) {
    gate.validAgainstGoalVersion = false;
    gate.stateLabel = '目标已变更，需重新核对';
    gate.impactedByGoalVersion = nextVersion;
  }
  for (const action of projection.actions) {
    action.state = 'blocked_by_goal_change';
    action.stateLabel = '目标变更后禁止执行';
    action.validAgainstGoalVersion = false;
    action.impactedByGoalVersion = nextVersion;
  }
  for (const challenge of projection.challenges) {
    if (challenge.state === 'open') challenge.impactedByGoalVersion = nextVersion;
  }
}

function applyEvidenceRequested(projection, event) {
  requireKnownActor(projection, event);
  const payload = event.payload;
  const evidenceId = requireId(payload.evidenceId, 'EvidenceRequested.payload.evidenceId');
  requireUniqueItem(projection.evidence, evidenceId, '证据');
  requireString(payload.subject, 'EvidenceRequested.payload.subject');
  requireString(payload.reason, 'EvidenceRequested.payload.reason');
  const fromActor = actorById(projection, requireId(payload.requestedFromActorId, 'EvidenceRequested.payload.requestedFromActorId'));
  if (!fromActor) throw invalid('证据提供者不是已知参与者');
  projection.evidence.push({
    id: evidenceId,
    subject: payload.subject,
    reason: payload.reason,
    status: 'requested',
    statusLabel: '等待证据',
    requestedByActorId: event.actorId,
    requestedFromActorId: payload.requestedFromActorId,
    goalVersion: projection.work.goalVersion,
    requestedAt: event.occurredAt,
  });
  if (projection.work.status !== 'paused') {
    setWorkStatus(projection, 'awaiting_evidence', `等待${fromActor.name}提供证据。`);
  }
}

function applyEvidenceProvided(projection, event) {
  requireKnownActor(projection, event);
  const payload = event.payload;
  const evidence = findById(projection.evidence, requireId(payload.evidenceId, 'EvidenceProvided.payload.evidenceId'), '证据');
  if (evidence.status !== 'requested') throw invalid('证据不是待提供状态');
  if (evidence.goalVersion !== projection.work.goalVersion) {
    throw projectionValidationError('证据请求属于旧目标版本。', {
      evidenceId: evidence.id,
      evidenceGoalVersion: evidence.goalVersion,
      currentGoalVersion: projection.work.goalVersion,
    });
  }
  requireString(payload.version, 'EvidenceProvided.payload.version');
  requireString(payload.summary, 'EvidenceProvided.payload.summary');
  evidence.status = 'provided';
  evidence.statusLabel = '已提供';
  evidence.version = payload.version;
  evidence.summary = payload.summary;
  evidence.providedByActorId = event.actorId;
  evidence.providedAt = event.occurredAt;
  if (projection.work.status === 'awaiting_evidence') {
    setWorkStatus(projection, 'active', '证据已提供，等待人工继续处理。');
  }
}

function applyArtifactProposed(projection, event) {
  const actor = requireKnownActor(projection, event);
  if (actor.type === 'system') throw invalid('系统连接器不能提出候选产物');
  const payload = event.payload;
  const artifactId = requireId(payload.artifactId, 'ArtifactProposed.payload.artifactId');
  requireUniqueItem(projection.artifacts, artifactId, '候选产物');
  requireString(payload.title, 'ArtifactProposed.payload.title');
  requireString(payload.body, 'ArtifactProposed.payload.body');
  let modelRunId = null;
  if (payload.modelRunId !== undefined) {
    modelRunId = requireId(payload.modelRunId, 'ArtifactProposed.payload.modelRunId');
    findById(projection.modelRuns, modelRunId, '模型运行');
  }
  projection.artifacts.push({
    id: artifactId,
    title: payload.title,
    body: payload.body,
    modelRunId,
    proposedByActorId: event.actorId,
    goalVersion: projection.work.goalVersion,
    state: 'pending_review',
    stateLabel: '待人工复核',
    pendingHumanReview: true,
    createdAt: event.occurredAt,
  });
  projection.work.nextStep = '候选产物等待人工复核，不能自动生效。';
}

function applyChallengeRaised(projection, event) {
  const actor = requireKnownActor(projection, event);
  if (actor.type === 'system') throw invalid('系统连接器不能提出质疑');
  const payload = event.payload;
  const challengeId = requireId(payload.challengeId, 'ChallengeRaised.payload.challengeId');
  requireUniqueItem(projection.challenges, challengeId, '质疑');
  requireString(payload.title, 'ChallengeRaised.payload.title');
  requireString(payload.reason, 'ChallengeRaised.payload.reason');
  projection.challenges.push({
    id: challengeId,
    title: payload.title,
    reason: payload.reason,
    severity: payload.severity ?? 'normal',
    state: 'open',
    stateLabel: '待回应',
    raisedByActorId: event.actorId,
    goalVersion: projection.work.goalVersion,
    raisedAt: event.occurredAt,
  });
  if (projection.work.status !== 'paused') {
    setWorkStatus(projection, 'blocked', '先回应质疑，再继续执行。');
  }
}

function applyGateDecided(projection, event) {
  requireActorType(projection, event, 'human', '人工关口决定');
  const payload = event.payload;
  const gateId = requireId(payload.gateId, 'GateDecided.payload.gateId');
  requireUniqueItem(projection.gates, gateId, '人工关口');
  const decision = requireEnum(payload.decision, V2_GATE_DECISIONS, 'GateDecided.payload.decision');
  requireString(payload.basis, 'GateDecided.payload.basis');
  requireString(payload.impact, 'GateDecided.payload.impact');
  projection.gates.push({
    id: gateId,
    state: decision,
    stateLabel: decision === 'approved' ? '已通过' : decision === 'rejected' ? '已拒绝' : '需补证据',
    decision,
    basis: payload.basis,
    impact: payload.impact,
    decidedByActorId: event.actorId,
    decidedAt: event.occurredAt,
    goalVersion: projection.work.goalVersion,
    validAgainstGoalVersion: true,
  });
  if (projection.work.status !== 'paused') {
    if (decision === 'needs_evidence') setWorkStatus(projection, 'awaiting_evidence', '人工关口要求补充证据。');
    else setWorkStatus(projection, 'active', decision === 'approved' ? '人工关口已通过，外部动作仍需显式请求。' : '人工关口已拒绝。');
  }
}

function applyHandoffProposed(projection, event) {
  requireOwnerActor(projection, event, '责任交接提出');
  const payload = event.payload;
  const handoffId = requireId(payload.handoffId, 'HandoffProposed.payload.handoffId');
  requireUniqueItem(projection.handoffs, handoffId, '责任交接');
  const recipient = actorById(projection, requireId(payload.recipientActorId, 'HandoffProposed.payload.recipientActorId'));
  if (!recipient) throw invalid('交接接收者不是已知参与者');
  if (recipient.id === projection.work.ownerActorId) throw invalid('不能交接给当前负责人');
  if (recipient.type !== 'human') throw invalid('责任交接接收者必须是人类');
  requireString(payload.context, 'HandoffProposed.payload.context');
  projection.handoffs.push({
    id: handoffId,
    fromActorId: event.actorId,
    toActorId: recipient.id,
    context: payload.context,
    state: 'pending',
    stateLabel: '等待接收',
    proposedAt: event.occurredAt,
  });
}

function applyHandoffAccepted(projection, event) {
  requireActorType(projection, event, 'human', '责任交接接收');
  const payload = event.payload;
  const handoff = findById(projection.handoffs, requireId(payload.handoffId, 'HandoffAccepted.payload.handoffId'), '责任交接');
  if (handoff.state !== 'pending') throw invalid('责任交接不是待接收状态');
  if (handoff.toActorId !== event.actorId) throw invalid('只有具名接收者能接受责任交接');
  handoff.state = 'accepted';
  handoff.stateLabel = '已接收';
  handoff.acceptedAt = event.occurredAt;
  projection.work.ownerActorId = handoff.toActorId;
  projection.work.updatedAt = event.occurredAt;
  projection.work.nextStep = '责任已由具名人类接收，继续处理当前事项。';
}

function applyActionIntentRequested(projection, event) {
  requireActorType(projection, event, 'human', '外部动作请求');
  const payload = event.payload;
  const actionId = requireId(payload.actionIntentId, 'ActionIntentRequested.payload.actionIntentId');
  requireUniqueItem(projection.actions, actionId, '外部动作');
  requireString(payload.actionLabel, 'ActionIntentRequested.payload.actionLabel');
  const target = actorById(projection, requireId(payload.targetActorId, 'ActionIntentRequested.payload.targetActorId'));
  if (!target || target.type !== 'system') throw invalid('外部动作目标必须是系统参与者');
  const gate = findById(projection.gates, requireId(payload.gateId, 'ActionIntentRequested.payload.gateId'), '人工关口');
  if (gate.state !== 'approved' || gate.validAgainstGoalVersion === false || gate.goalVersion !== projection.work.goalVersion) {
    throw invalid('外部动作必须依赖当前目标版本下已通过的人工关口');
  }
  projection.actions.push({
    id: actionId,
    actionLabel: payload.actionLabel,
    targetActorId: target.id,
    gateId: gate.id,
    requestedByActorId: event.actorId,
    state: 'awaiting_receipt',
    stateLabel: '等待外部回执',
    goalVersion: projection.work.goalVersion,
    validAgainstGoalVersion: true,
    createdAt: event.occurredAt,
  });
  if (projection.work.status !== 'paused') {
    setWorkStatus(projection, 'awaiting_receipt', '等待外部系统回执，未证实时不得视为成功。');
  }
}

function applyReceiptRecorded(projection, event) {
  const actor = requireActorType(projection, event, 'system', '外部回执记录');
  const payload = event.payload;
  const action = findById(projection.actions, requireId(payload.actionIntentId, 'ReceiptRecorded.payload.actionIntentId'), '外部动作');
  if (action.targetActorId !== actor.id) throw invalid('只有动作目标系统能记录回执');
  if (action.state !== 'awaiting_receipt') throw invalid('外部动作不是等待回执状态');
  const receiptId = requireId(payload.receiptId, 'ReceiptRecorded.payload.receiptId');
  requireUniqueItem(projection.receipts, receiptId, '外部回执');
  const status = requireEnum(payload.status, V2_RECEIPT_STATUSES, 'ReceiptRecorded.payload.status');
  projection.receipts.push({
    id: receiptId,
    actionIntentId: action.id,
    status,
    statusLabel: status === 'succeeded' ? '已证实的成功回执' : status === 'failed' ? '失败回执' : '未知回执',
    recordedByActorId: event.actorId,
    recordedAt: event.occurredAt,
    summary: requireString(payload.summary, 'ReceiptRecorded.payload.summary'),
  });
  action.state = status;
  action.stateLabel = status === 'succeeded' ? '成功' : status === 'failed' ? '失败' : '未知，待核验';
  if (status === 'succeeded') {
    setWorkStatus(projection, 'completed', '可信成功回执已核实。');
  } else if (status === 'unknown') {
    setWorkStatus(projection, 'unknown', '回执行未知，等待核验，不得重复执行或宣称成功。');
  } else {
    setWorkStatus(projection, 'active', '外部动作失败，等待人工决定下一步。');
  }
}

function applyWorkPaused(projection, event) {
  requireOwnerActor(projection, event, '工作暂停');
  if (projection.work.status === 'paused' || projection.work.status === 'completed') throw invalid('当前工作不能暂停');
  projection.work.previousStatus = projection.work.status;
  setWorkStatus(projection, 'paused', '工作已暂停，恢复前不推进权威状态。');
}

function applyWorkResumed(projection, event) {
  requireOwnerActor(projection, event, '工作恢复');
  if (projection.work.status !== 'paused') throw invalid('只有已暂停工作能恢复');
  const previous = WORK_STATUS_LABELS[projection.work.previousStatus] ? projection.work.previousStatus : 'active';
  delete projection.work.previousStatus;
  setWorkStatus(projection, previous, '工作已恢复，继续从权威阶段处理。');
}

function applyWorkRolledBack(projection, event) {
  requireOwnerActor(projection, event, '工作回退');
  const payload = event.payload;
  const stageId = requireId(payload.toStageId, 'WorkRolledBack.payload.toStageId');
  const stage = findById(projection.stages, stageId, '阶段');
  requireString(payload.reason, 'WorkRolledBack.payload.reason');
  if (projection.work.status === 'completed') throw invalid('已完成工作不能直接回退');
  setCurrentStage(projection, stage.id);
  setWorkStatus(projection, 'active', `已回退到${stage.displayName}，保留历史原因与责任。`);
  projection.work.lastRollback = {
    toStageId: stage.id,
    reason: payload.reason,
    byActorId: event.actorId,
    at: event.occurredAt,
  };
}

function findModelRun(projection, runId) {
  return findById(projection.modelRuns, requireId(runId, 'modelRunId'), '模型运行');
}

function applyModelRunRequested(projection, event) {
  requireActorType(projection, event, 'human', '显式模型请求');
  const payload = event.payload;
  const runId = requireId(payload.runId, 'ModelRunRequested.payload.runId');
  requireUniqueItem(projection.modelRuns, runId, '模型运行');
  const agent = actorById(projection, requireId(payload.agentActorId, 'ModelRunRequested.payload.agentActorId'));
  if (!agent || agent.type !== 'agent') throw invalid('模型运行目标必须是已知智能体');
  requireString(payload.task, 'ModelRunRequested.payload.task');
  requireString(payload.idempotencyIdentity, 'ModelRunRequested.payload.idempotencyIdentity');
  if (payload.goalVersion !== projection.work.goalVersion) throw invalid('模型请求目标版本与当前投影不一致');
  if (payload.projectionVersion !== projection.projectionVersion) throw invalid('模型请求投影版本与当前投影不一致');
  const evidenceIds = requireArray(payload.inputEvidenceIds ?? [], 'ModelRunRequested.payload.inputEvidenceIds');
  for (const evidenceId of evidenceIds) {
    requireId(evidenceId, 'ModelRunRequested.payload.inputEvidenceIds项');
    const evidence = projection.evidence.find((item) => item.id === evidenceId);
    if (!evidence) {
      throw projectionValidationError('模型输入证据不存在。', {
        evidenceId,
        currentGoalVersion: projection.work.goalVersion,
      });
    }
    if (evidence.status !== 'provided') {
      throw projectionValidationError('模型输入证据必须已提供。', {
        evidenceId: evidence.id,
        evidenceStatus: evidence.status,
        currentGoalVersion: projection.work.goalVersion,
      });
    }
    if (evidence.goalVersion !== projection.work.goalVersion) {
      throw projectionValidationError('模型输入证据必须属于当前目标版本。', {
        evidenceId: evidence.id,
        evidenceGoalVersion: evidence.goalVersion,
        currentGoalVersion: projection.work.goalVersion,
      });
    }
  }
  projection.modelRuns.push({
    id: runId,
    agentActorId: agent.id,
    requestedByActorId: event.actorId,
    task: payload.task,
    status: 'requested',
    statusLabel: '已请求',
    goalVersion: payload.goalVersion,
    projectionVersion: payload.projectionVersion,
    selectionContext: clone(payload.selectionContext ?? { kind: 'work', id: projection.projectionIdentity.workId }),
    inputEvidenceIds: clone(evidenceIds),
    idempotencyIdentity: payload.idempotencyIdentity,
    allowedScope: clone(payload.allowedScope ?? []),
    budgetLimit: clone(payload.budgetLimit ?? null),
    createdAt: event.occurredAt,
    outputs: [],
  });
}

function requireModelRunActor(projection, event, run, label) {
  const actor = requireActorType(projection, event, 'agent', label);
  if (actor.id !== run.agentActorId) throw invalid(`${label}必须由运行绑定的智能体执行`);
  return actor;
}

function applyModelRunStarted(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  requireModelRunActor(projection, event, run, '模型运行开始');
  if (run.status !== 'requested') throw invalid('模型运行不是已请求状态');
  run.status = 'running';
  run.statusLabel = '运行中';
  run.startedAt = event.occurredAt;
  run.modelVersion = event.payload.modelVersion ?? 'sample-model';
}

function applyModelRunArtifactProduced(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  requireModelRunActor(projection, event, run, '模型候选产物');
  if (run.status !== 'running') throw invalid('只有运行中的模型能产生候选产物');
  const payload = event.payload;
  const artifactId = requireId(payload.artifactId, 'ModelRunArtifactProduced.payload.artifactId');
  requireUniqueItem(projection.artifacts, artifactId, '候选产物');
  requireString(payload.title, 'ModelRunArtifactProduced.payload.title');
  requireString(payload.body, 'ModelRunArtifactProduced.payload.body');
  const artifact = {
    id: artifactId,
    modelRunId: run.id,
    title: payload.title,
    body: payload.body,
    proposedByActorId: event.actorId,
    goalVersion: run.goalVersion,
    state: 'pending_review',
    stateLabel: '待人工复核',
    pendingHumanReview: true,
    createdAt: event.occurredAt,
  };
  projection.artifacts.push(artifact);
  run.outputs.push({ kind: 'artifact', id: artifact.id, state: 'pending_review' });
}

function completeModelRun(projection, event, status, statusLabel, extra = {}) {
  const run = findModelRun(projection, event.payload.runId);
  requireModelRunActor(projection, event, run, `模型运行${status}`);
  if (run.status !== 'running') throw invalid('模型运行不是运行中状态');
  Object.assign(run, extra, { status, statusLabel, endedAt: event.occurredAt });
}

function applyModelRunCancelRequested(projection, event) {
  requireActorType(projection, event, 'human', '显式模型取消');
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'requested' && run.status !== 'running') throw invalid('模型运行不能取消');
  requireString(event.payload.reason, 'ModelRunCancelRequested.payload.reason');
  run.status = 'cancelling';
  run.statusLabel = '正在取消';
  run.cancelRequestedByActorId = event.actorId;
  run.cancelRequestedAt = event.occurredAt;
  run.cancelReason = event.payload.reason;
}

function applyModelRunCancelled(projection, event) {
  requireActorType(projection, event, 'human', '模型取消确认');
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'cancelling') throw invalid('模型运行不在取消中状态');
  run.status = 'cancelled';
  run.statusLabel = '已取消';
  run.cancelledAt = event.occurredAt;
}

function availableCommandsFor(projection) {
  const commands = [];
  const owner = actorById(projection, projection.work.ownerActorId);
  if (owner?.type === 'human') {
    commands.push(
      { type: 'append_message', label: '发送普通消息', requiresConfirmation: false },
      { type: 'request_model_run', label: '显式请求智能体运行', requiresConfirmation: true },
      { type: 'update_goal', label: '变更目标', requiresConfirmation: true },
    );
    if (projection.work.status === 'paused') commands.push({ type: 'resume_work', label: '恢复工作', requiresConfirmation: true });
    else commands.push({ type: 'pause_work', label: '暂停工作', requiresConfirmation: true });
    commands.push({ type: 'rollback_work', label: '回退到指定阶段', requiresConfirmation: true });
    const openGate = projection.gates.find((gate) => gate.state === 'needs_evidence');
    if (openGate || projection.challenges.some((challenge) => challenge.state === 'open')) {
      commands.push({ type: 'respond_challenge', label: '回应质疑或补证', requiresConfirmation: true });
    }
    const approvedGate = projection.gates.find((gate) => gate.state === 'approved' && gate.validAgainstGoalVersion !== false);
    if (approvedGate && !projection.actions.some((action) => action.gateId === approvedGate.id)) {
      commands.push({ type: 'request_action_intent', label: '请求外部动作', requiresConfirmation: true });
    }
  }
  for (const handoff of projection.handoffs.filter((item) => item.state === 'pending')) {
    const recipient = actorById(projection, handoff.toActorId);
    if (recipient?.type === 'human') {
      commands.push({ type: 'accept_handoff', label: `接收责任交接`, requiresConfirmation: true, handoffId: handoff.id });
    }
  }
  const agent = projection.actors.find((actor) => actor.type === 'agent');
  if (agent) commands.push({ type: 'append_message', label: '智能体追加普通消息', requiresConfirmation: false });
  const awaitingAction = projection.actions.find((action) => action.state === 'awaiting_receipt');
  if (awaitingAction) {
    commands.push({ type: 'record_receipt', label: '记录外部回执', requiresConfirmation: false, actionIntentId: awaitingAction.id });
  }
  return commands;
}

function reduceV2Event(previous, event) {
  const projection = clone(previous);
  projection.projectionVersion = event.sequence;
  projection.eventCursor = event.sequence;
  projection.generatedAt = event.occurredAt;
  const payload = event.payload;

  switch (event.type) {
    case 'MessageAppended': {
      const actor = requireKnownActor(projection, event);
      if (actor.type === 'system') throw invalid('系统连接器不能追加普通对话消息');
      requireString(payload.body, 'MessageAppended.payload.body');
      recordActivity(projection, event, '追加普通消息', payload.body, false);
      break;
    }
    case 'GoalChanged':
      applyGoalChanged(projection, event);
      recordActivity(projection, event, '变更目标', `${payload.reason} 新目标：${payload.goal}`, true);
      break;
    case 'EvidenceRequested':
      applyEvidenceRequested(projection, event);
      recordActivity(projection, event, '请求证据', payload.reason, true);
      break;
    case 'EvidenceProvided':
      applyEvidenceProvided(projection, event);
      recordActivity(projection, event, '提供证据', payload.summary, true);
      break;
    case 'ArtifactProposed':
      applyArtifactProposed(projection, event);
      recordActivity(projection, event, '提出候选产物', payload.body, true);
      break;
    case 'ChallengeRaised':
      applyChallengeRaised(projection, event);
      recordActivity(projection, event, '提出质疑', payload.reason, true);
      break;
    case 'GateDecided':
      applyGateDecided(projection, event);
      recordActivity(projection, event, '决定人工关口', payload.impact, true);
      break;
    case 'HandoffProposed':
      applyHandoffProposed(projection, event);
      recordActivity(projection, event, '提出责任交接', payload.context, true);
      break;
    case 'HandoffAccepted':
      applyHandoffAccepted(projection, event);
      recordActivity(projection, event, '接收责任交接', '责任已由具名人类接收。', true);
      break;
    case 'ActionIntentRequested':
      applyActionIntentRequested(projection, event);
      recordActivity(projection, event, '请求外部动作', payload.actionLabel, true);
      break;
    case 'ReceiptRecorded':
      applyReceiptRecorded(projection, event);
      recordActivity(projection, event, '记录外部回执', payload.summary, true);
      break;
    case 'WorkPaused':
      applyWorkPaused(projection, event);
      recordActivity(projection, event, '暂停工作', '负责人显式暂停。', true);
      break;
    case 'WorkResumed':
      applyWorkResumed(projection, event);
      recordActivity(projection, event, '恢复工作', '负责人显式恢复。', true);
      break;
    case 'WorkRolledBack':
      applyWorkRolledBack(projection, event);
      recordActivity(projection, event, '回退工作', payload.reason, true);
      break;
    case 'ModelRunRequested':
      applyModelRunRequested(projection, event);
      recordActivity(projection, event, '显式请求模型运行', payload.task, true);
      break;
    case 'ModelRunStarted':
      applyModelRunStarted(projection, event);
      recordActivity(projection, event, '模型运行开始', '运行只产生候选、提案、质疑或证据请求。', true);
      break;
    case 'ModelRunArtifactProduced':
      applyModelRunArtifactProduced(projection, event);
      recordActivity(projection, event, '模型产生候选产物', payload.body, true);
      break;
    case 'ModelRunCompleted':
      completeModelRun(projection, event, 'completed', '运行已完成', {
        usage: clone(event.payload.usage ?? null),
      });
      recordActivity(projection, event, '模型运行完成', '运行完成不代表候选通过或外部动作生效。', true);
      break;
    case 'ModelRunFailed':
      completeModelRun(projection, event, 'failed', '运行失败', {
        failureReason: requireString(event.payload.reason, 'ModelRunFailed.payload.reason'),
      });
      recordActivity(projection, event, '模型运行失败', event.payload.reason, true);
      break;
    case 'ModelRunUnknown':
      completeModelRun(projection, event, 'unknown', '状态待核验', {
        unknownReason: requireString(event.payload.reason, 'ModelRunUnknown.payload.reason'),
        verificationOwnerActorId: requireId(event.payload.verificationOwnerActorId, 'ModelRunUnknown.payload.verificationOwnerActorId'),
      });
      recordActivity(projection, event, '模型运行状态待核验', event.payload.reason, true);
      break;
    case 'ModelRunCancelRequested':
      applyModelRunCancelRequested(projection, event);
      recordActivity(projection, event, '请求取消模型运行', event.payload.reason, true);
      break;
    case 'ModelRunCancelled':
      applyModelRunCancelled(projection, event);
      recordActivity(projection, event, '取消模型运行', '运行已按人工边界取消。', true);
      break;
    default:
      throw invalid(`未知事件类型：${event.type}`);
  }

  projection.availableCommands = availableCommandsFor(projection);
  return projection;
}

function validateEventEnvelope(event, index, eventIds) {
  if (!isPlainObject(event)) throw invalid('事件必须为对象');
  const keys = Object.keys(event);
  if (keys.length !== V2_EVENT_FIELDS.length || keys.some((key, fieldIndex) => key !== V2_EVENT_FIELDS[fieldIndex])) {
    throw invalid('事件字段必须严格为eventId、sequence、type、occurredAt、actorId、payload');
  }
  requireId(event.eventId, `events[${index}].eventId`);
  if (eventIds.has(event.eventId)) throw invalid(`事件标识重复：${event.eventId}`);
  eventIds.add(event.eventId);
  if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
    throw invalid(`事件序号必须从1连续递增：${event.sequence}`);
  }
  if (!V2_EVENT_TYPES.includes(event.type)) throw invalid(`未知事件类型：${event.type}`);
  if (typeof event.occurredAt !== 'string' || event.occurredAt.length === 0) {
    throw invalid('事件occurredAt必须为非空字符串');
  }
  requireId(event.actorId, `events[${index}].actorId`);
  if (!isPlainObject(event.payload)) throw invalid('事件payload必须为对象');
  validateIdentity(event.payload.identity, `events[${index}].payload.identity`);
}

export function replayV2Events(events) {
  if (!Array.isArray(events) || events.length === 0) throw invalid('事件链必须为非空数组');
  let projection = null;
  const eventIds = new Set();
  events.forEach((event, index) => {
    validateEventEnvelope(event, index, eventIds);
    if (event.type === 'WorkCreated') {
      if (index !== 0) throw invalid('WorkCreated只能是第一个事件');
      if (projection) throw invalid('不能重复创建Work');
      projection = applyWorkCreated(event);
      return;
    }
    if (index === 0) throw invalid('第一个事件必须是WorkCreated');
    if (!projection) throw invalid('事件链缺少WorkCreated');
    if (!sameIdentity(projection.projectionIdentity, event.payload.identity)) throw invalid('事件工作身份不一致');
    projection = reduceV2Event(projection, event);
  });
  return projection;
}

function assertV2Projection(projection) {
  if (!isPlainObject(projection) || projection.schemaVersion !== 'work-projection.v2') {
    throw invalid('输入不是work-projection.v2投影');
  }
  validateIdentity(projection.projectionIdentity, 'projection.projectionIdentity');
  if (!Number.isInteger(projection.projectionVersion) || projection.projectionVersion < 1) {
    throw invalid('projectionVersion无效');
  }
  if (projection.eventCursor !== projection.projectionVersion) throw invalid('事件游标与投影版本不一致');
}

export function selectV2View(projection, view) {
  assertV2Projection(projection);
  if (!V2_VIEW_TYPES.includes(view)) throw invalid(`未知视图：${view}`);
  const source = clone(projection);
  const identity = {
    workspaceId: source.projectionIdentity.workspaceId,
    workId: source.projectionIdentity.workId,
    goalVersion: source.work.goalVersion,
    projectionVersion: source.projectionVersion,
    eventCursor: source.eventCursor,
    generatedAt: source.generatedAt,
  };
  const shared = {
    dataOrigin: source.dataOrigin,
    scenario: source.scenario,
    work: source.work,
    actors: source.actors,
    relations: source.relations,
    stages: source.stages,
    loops: source.loops,
    matrix: source.matrix,
    evidence: source.evidence,
    artifacts: source.artifacts,
    challenges: source.challenges,
    gates: source.gates,
    handoffs: source.handoffs,
    actions: source.actions,
    receipts: source.receipts,
    modelRuns: source.modelRuns,
    activities: source.activities,
    availableCommands: source.availableCommands,
  };

  if (view === 'relation') {
    const nodes = [
      { id: `work:${identity.workId}`, kind: 'work', label: source.work.title, state: source.work.statusLabel },
      ...source.actors.map((actor) => ({
        id: `actor:${actor.id}`, kind: 'actor', actorType: actor.type, label: actor.name, authority: actor.authority ?? 'none',
      })),
      ...source.stages.map((stage) => ({
        id: `stage:${stage.id}`, kind: 'stage', label: stage.displayName, state: stage.stateLabel ?? stage.state,
      })),
      ...source.evidence.map((item) => ({ id: `evidence:${item.id}`, kind: 'evidence', label: item.subject, state: item.statusLabel })),
      ...source.artifacts.map((item) => ({ id: `artifact:${item.id}`, kind: 'artifact', label: item.title, state: item.stateLabel })),
      ...source.challenges.map((item) => ({ id: `challenge:${item.id}`, kind: 'challenge', label: item.title, state: item.stateLabel })),
      ...source.gates.map((item) => ({ id: `gate:${item.id}`, kind: 'gate', label: '人工关口', state: item.stateLabel })),
      ...source.actions.map((item) => ({ id: `action:${item.id}`, kind: 'action', label: item.actionLabel, state: item.stateLabel })),
      ...source.receipts.map((item) => ({ id: `receipt:${item.id}`, kind: 'receipt', label: '外部回执', state: item.statusLabel })),
      ...source.modelRuns.map((item) => ({ id: `model-run:${item.id}`, kind: 'model-run', label: item.task, state: item.statusLabel })),
    ];
    const edges = source.relations.map((relation) => ({
      id: relation.id,
      source: `${relation.source.kind === 'work' ? 'work' : relation.source.kind}:${relation.source.id}`,
      target: `${relation.target.kind === 'work' ? 'work' : relation.target.kind}:${relation.target.id}`,
      label: relation.label,
      state: relation.state,
    }));
    edges.push({
      id: `owner:${identity.workId}`,
      source: `actor:${source.work.ownerActorId}`,
      target: `work:${identity.workId}`,
      label: '当前负责',
      state: 'active',
    });
    for (const artifact of source.artifacts) {
      edges.push({
        id: `artifact-source:${artifact.id}`,
        source: `actor:${artifact.proposedByActorId}`,
        target: `artifact:${artifact.id}`,
        label: '提出候选',
        state: artifact.pendingHumanReview ? 'pending' : 'recorded',
      });
    }
    for (const action of source.actions) {
      edges.push({
        id: `action-owner:${action.id}`,
        source: `actor:${action.requestedByActorId}`,
        target: `action:${action.id}`,
        label: '显式请求',
        state: action.state,
      });
    }
    return { view, identity, ...shared, nodes, edges };
  }

  if (view === 'progress') {
    const stages = source.stages.map((stage) => ({
      ...stage,
      blockers: stage.id === source.work.stageId ? source.challenges.filter((item) => item.state === 'open').map((item) => item.title) : [],
      missingItems: stage.id === source.work.stageId && source.evidence.some((item) => item.status === 'requested')
        ? source.evidence.filter((item) => item.status === 'requested').map((item) => item.subject)
        : [],
    }));
    return { view, identity, ...shared, stages, loops: source.loops, currentStageId: source.work.stageId };
  }

  return { view, identity, ...shared, matrix: source.matrix };
}

function occurredAt(sequence) {
  const minute = String(Math.floor((sequence - 1) / 60)).padStart(2, '0');
  const second = String((sequence - 1) % 60).padStart(2, '0');
  return `2026-01-01T00:${minute}:${second}.000Z`;
}

function event(sequence, type, actorId, payload) {
  return {
    eventId: '',
    sequence,
    type,
    occurredAt: occurredAt(sequence),
    actorId,
    payload,
  };
}

const SCENARIO_SAMPLE_COPY = Object.freeze({
  risk: {
    task: '汇总交易证据并生成风险复核建议',
    candidate: '高风险交易证据摘要与复核要点候选',
    challenge: '外部处置回执行未知，必须先核验且不得重复执行',
    action: '生成资金处置动作意图',
  },
  dev: {
    task: '根据目标新版本重新梳理需求影响候选',
    candidate: '目标变更影响分析与下一版方案候选',
    challenge: '目标在实现中途变化，旧候选不能继续评审',
    action: '生成部署动作意图',
  },
  interaction: {
    task: '整理对话上下文并提出澄清问题',
    candidate: '用户意图澄清与交接边界候选',
    challenge: '高风险意图缺少用户确认，不能直接交接执行',
    action: '生成工具调用前确认动作意图',
  },
  content: {
    task: '核对素材来源并生成审校候选',
    candidate: '带来源引用的内容修订候选',
    challenge: '素材授权状态不明确，稿件不能发布',
    action: '生成内容发布动作意图',
  },
  growth: {
    task: '复盘实验结果并提出下一轮策略候选',
    candidate: '策略假设复盘与实验调整候选',
    challenge: '指标回传缺失，归因结论不能扩量',
    action: '生成活动调整动作意图',
  },
  embodied: {
    task: '汇总智能网联汽车感知状态并生成规划候选',
    candidate: '智能网联汽车场景规划与安全限制候选',
    challenge: '感知前提与安全案例不一致，不能执行设备动作',
    action: '生成设备执行前确认动作意图',
  },
  knowledge: {
    task: '检索资料并生成带引用的答案候选',
    candidate: '带引用链的知识答案候选',
    challenge: '引用无法追溯到原始资料，不能正式写入知识库',
    action: '生成知识写入动作意图',
  },
  service: {
    task: '整理工单历史并生成服务方案候选',
    candidate: '客户答复与人工复核方案候选',
    challenge: '客户确认缺失，机器人不能循环承诺或赔付',
    action: '生成工单操作动作意图',
  },
  'supply-chain': {
    task: '分析物料缺口并生成异常处理候选',
    candidate: '物料替代与异常任务处理候选',
    challenge: '库存、在途和供应商口径冲突，不能自动切换方案',
    action: '生成异常任务处理动作意图',
  },
  healthcare: {
    task: '基于去标识摘要生成诊疗辅助与随访草稿候选',
    candidate: '诊疗辅助、质控与随访草稿候选',
    challenge: '医疗记录不完整或禁忌证据缺失，不能进入专业签署',
    action: '生成病历写入前核验动作意图',
  },
});

export function createV2SampleEvents(scenarioId) {
  const pack = getScenarioPack(scenarioId);
  const definition = createSampleDefinition(scenarioId);
  const copy = SCENARIO_SAMPLE_COPY[scenarioId];
  const identity = { workspaceId: 'p1-v2-sample-workspace', workId: definition.workId };
  const ownerId = `${scenarioId}-owner-human`;
  const gateHumanId = `${scenarioId}-gate-human`;
  const agentId = `${scenarioId}-assistant-agent`;
  const systemId = `${scenarioId}-state-system`;
  const evidenceId = `${scenarioId}-evidence-001`;
  const runId = `${scenarioId}-model-run-001`;
  const events = [];

  function add(type, actorId, payload) {
    const next = event(events.length + 1, type, actorId, { identity, ...payload });
    next.eventId = `${scenarioId}-event-${String(next.sequence).padStart(3, '0')}`;
    events.push(next);
  }

  const { title, goal, ...definitionWithoutWorkFields } = definition;
  add('WorkCreated', ownerId, {
    ...definitionWithoutWorkFields,
    work: {
      title,
      goal,
      ownerActorId: ownerId,
      nextStep: '等待负责人补充上下文；普通消息不会触发模型运行。',
    },
    initialStageId: definition.initialStageId,
  });
  add('MessageAppended', ownerId, {
    body: '我补充一条普通消息，只记录对话，不触发智能体运行。',
  });
  add('EvidenceRequested', ownerId, {
    evidenceId,
    subject: pack.evidenceScope[0],
    reason: `${pack.displayName}需要先固定本场景证据口径。`,
    requestedFromActorId: systemId,
    dueAt: '2026-01-01T01:00:00.000Z',
  });
  add('EvidenceProvided', systemId, {
    evidenceId,
    version: `${scenarioId}-evidence-v1`,
    summary: `示例${pack.evidenceScope[0]}已按最小必要范围提供。`,
  });
  add('ArtifactProposed', ownerId, {
    artifactId: `${scenarioId}-human-input-001`,
    title: `${pack.displayName}人工输入候选`,
    body: '负责人整理的输入材料，仍需人工复核后才能作为正式依据。',
    sourceEvidenceIds: [evidenceId],
  });
  add('ChallengeRaised', agentId, {
    challengeId: `${scenarioId}-challenge-001`,
    title: pack.negativePath.trigger,
    reason: copy.challenge,
    severity: 'high',
  });
  add('ModelRunRequested', ownerId, {
    runId,
    agentActorId: agentId,
    task: copy.task,
    goalVersion: 1,
    projectionVersion: 7,
    inputEvidenceIds: [evidenceId],
    selectionContext: { kind: 'work', id: definition.workId, label: '当前协同事项' },
    idempotencyIdentity: `${scenarioId}-model-run-once`,
    allowedScope: ['候选产物', '提案', '质疑', '证据请求'],
    budgetLimit: { label: '示例预算', tokenLimit: 2000, timeout: '10秒' },
  });
  add('ModelRunStarted', agentId, {
    runId,
    modelVersion: 'sample-assistant-v2',
  });
  add('ModelRunArtifactProduced', agentId, {
    runId,
    artifactId: `${scenarioId}-model-candidate-001`,
    title: copy.candidate,
    body: '模型候选仅绑定输入证据与当前目标版本，必须人工复核后才能使用。',
  });
  add('ModelRunUnknown', agentId, {
    runId,
    reason: '示例运行连接在结束时中断，最后已知事实是运行中，不能推断成功。',
    verificationOwnerActorId: ownerId,
  });
  add('GateDecided', gateHumanId, {
    gateId: `${scenarioId}-gate-001`,
    decision: 'approved',
    basis: '具名关口人已复核当前证据、候选限制和场景边界。',
    impact: '仅授权一个示例外部动作意图，模型候选仍未通过。',
  });
  add('ActionIntentRequested', ownerId, {
    actionIntentId: `${scenarioId}-action-001`,
    actionLabel: copy.action,
    targetActorId: systemId,
    gateId: `${scenarioId}-gate-001`,
  });
  add('ReceiptRecorded', systemId, {
    receiptId: `${scenarioId}-receipt-001`,
    actionIntentId: `${scenarioId}-action-001`,
    status: 'unknown',
    summary: '示例外部系统未返回可信回执，必须保持待核验且不得重复执行。',
  });
  if (scenarioId === 'dev') {
    add('GoalChanged', ownerId, {
      goal: '目标变更为：仅交付变更后的高优先级需求，并在新目标版本下重新评审候选方案。',
      reason: '需求负责人确认目标漂移，旧候选、关口和动作必须失效。',
      nextStep: '重新澄清背景并生成新目标版本候选。',
    });
  }
  add('WorkRolledBack', ownerId, {
    toStageId: pack.loops[0].toStageId,
    reason: pack.loops[0].reason,
  });
  return events;
}
