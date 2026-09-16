import { P2Error } from './errors.mjs';

export const P2_EVENT_TYPES = Object.freeze([
  'CaseCreated',
  'ContextPackRecorded',
  'MessageAppended',
  'ModelRunRequested',
  'ModelRunStarted',
  'CandidateRecorded',
  'ModelRunCompleted',
  'ModelRunFailed',
  'ModelRunUnknown',
  'DecisionDiffRecorded',
  'HandoffProposed',
  'HandoffAccepted',
  'GateDecided',
  'AgentResumed',
  'ActionIntentCreated',
  'ReceiptRecorded',
]);

export const P2_RECEIPT_STATUSES = Object.freeze(['succeeded', 'failed', 'unknown']);
export const P2_GATE_DECISIONS = Object.freeze(['approved', 'rejected', 'needs_evidence']);
export const P2_PHASE_IDS = Object.freeze(['requirement', 'analysis', 'handoff', 'continuation', 'receipt']);

const PHASE_LABELS = Object.freeze({
  requirement: '需求',
  analysis: '研判',
  handoff: '接力',
  continuation: '续跑',
  receipt: '回执',
});

const ACTOR_TYPES = Object.freeze(['human', 'model', 'system', 'connector']);
const MODEL_AUTHORITIES = Object.freeze(['none', 'propose']);
const RUN_TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'unknown']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function integrityError(message, details = {}) {
  return new P2Error(500, 'INTEGRITY_FAILURE', message, details);
}

function requireString(value, name, min = 1, max = 4000) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw integrityError(`${name}必须为${min}..${max}字符的字符串。`, { field: name });
  }
  return value;
}

function requireId(value, name) {
  return requireString(value, name, 1, 128);
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) {
    throw integrityError(`${name}不在允许范围内。`, { field: name, allowed: [...values] });
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw integrityError(`${name}必须为数组。`, { field: name });
  return value;
}

function findById(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) throw integrityError(`${label}不存在：${id}`, { collection: label, id });
  return item;
}

function phaseStateFor(projection) {
  const status = projection.case.status;
  const phaseId = projection.case.phase;
  const states = {};
  let passed = true;
  for (const p of P2_PHASE_IDS) {
    if (passed) {
      states[p] = p === phaseId ? 'active' : 'done';
      if (p === phaseId) passed = false;
    } else {
      states[p] = 'pending';
    }
  }
  if (status === 'completed') {
    for (const p of P2_PHASE_IDS) states[p] = 'done';
  }
  return states;
}

function computeMetrics(projection) {
  const cp = projection.contextPack;
  let rawChars = 0;
  let compactChars = 0;
  if (cp && cp.rawContent) {
    rawChars = cp.rawContent.length;
    compactChars = JSON.stringify({
      facts: cp.facts,
      gaps: cp.gaps,
      conflicts: cp.conflicts,
      sourceRefs: cp.sourceRefs,
    }).length;
  }
  const compression = rawChars > 0 ? 1 - compactChars / rawChars : 0;
  const candidates = projection.candidates;
  const terminalRuns = projection.modelRuns.filter((r) => RUN_TERMINAL_STATUSES.includes(r.status));
  return {
    contextCompression: {
      rawChars,
      compactChars,
      ratio: Math.round(compression * 10000) / 10000,
      formula: '1 - compactChars / rawChars',
    },
    candidateCount: candidates.length,
    runCompleted: terminalRuns.filter((r) => r.status === 'completed').length,
    runFailed: terminalRuns.filter((r) => r.status === 'failed').length,
    runUnknown: terminalRuns.filter((r) => r.status === 'unknown').length,
    receiptCount: projection.receipts.length,
    receiptSucceeded: projection.receipts.filter((r) => r.status === 'succeeded').length,
    receiptFailed: projection.receipts.filter((r) => r.status === 'failed').length,
    receiptUnknown: projection.receipts.filter((r) => r.status === 'unknown').length,
  };
}

function computeAvailableAction(projection) {
  const c = projection.case;
  const identity = { workspaceId: projection.identity.workspaceId, caseId: projection.identity.caseId };
  if (c.status === 'completed') {
    return null;
  }
  if (projection.pendingHandoff) {
    return {
      operation: 'accept_handoff',
      label: '接受接力',
      requiredActorId: projection.pendingHandoff.toActorId,
      commandType: 'accept_handoff',
      impact: '高',
    };
  }
  if (projection.gate && projection.gate.status === 'pending') {
    return {
      operation: 'decide_gate',
      label: '决定关口',
      requiredActorId: projection.gate.deciderActorId,
      commandType: 'decide_gate',
      impact: '高',
    };
  }
  if (c.status === 'awaiting_receipt') {
    return null;
  }
  if (c.status === 'agent_running') {
    return null;
  }
  if (c.phase === 'continuation' && !projection.pendingHandoff && projection.agentContinuity) {
    return null;
  }
  if (projection.decisionDiff) {
    return null;
  }
  return {
    operation: 'append_message',
    label: '补充信息',
    requiredActorId: c.ownerActorId,
    commandType: 'append_message',
    impact: '低',
  };
}

function buildViews(projection) {
  const identity = {
    workspaceId: projection.identity.workspaceId,
    caseId: projection.identity.caseId,
    schemaVersion: projection.schemaVersion,
    version: projection.version,
    eventCursor: projection.eventCursor,
    chainHead: projection.chainHead,
  };

  const relationNodes = [];
  const relationEdges = [];
  relationNodes.push({
    id: projection.identity.caseId,
    type: 'case',
    label: projection.case.title,
    status: projection.case.status,
  });
  for (const actor of projection.actors) {
    relationNodes.push({
      id: actor.id,
      type: actor.actorType,
      label: actor.displayName,
      role: actor.role,
      status: actor.authority ?? 'none',
    });
    relationEdges.push({
      source: actor.id,
      target: projection.identity.caseId,
      kind: actor.actorType === 'model' ? 'context' : actor.actorType === 'connector' ? 'receipt' : 'responsibility',
    });
  }

  const phases = P2_PHASE_IDS.map((id) => ({
    id,
    label: PHASE_LABELS[id],
    state: phaseStateFor(projection)[id],
    ownerActorId: projection.phaseOwners?.[id] ?? projection.case.ownerActorId,
  }));

  const responsibility = projection.actors.map((actor) => ({
    actorId: actor.id,
    displayName: actor.displayName,
    cells: P2_PHASE_IDS.map((phase) => {
      if (actor.actorType === 'model') {
        return phase === 'analysis' ? '建议' : '禁止';
      }
      if (actor.actorType === 'connector') {
        return phase === 'receipt' ? '执行' : '旁观';
      }
      return actor.roleMatrix?.[phase] ?? '旁观';
    }),
  }));

  return {
    relation: { ...identity, nodes: relationNodes, edges: relationEdges },
    progress: { ...identity, phases, caseStatus: projection.case.status },
    responsibility: { ...identity, rows: responsibility, columns: P2_PHASE_IDS.map((id) => ({ id, label: PHASE_LABELS[id] })) },
  };
}

function validateCaseCreatedPayload(payload) {
  const actors = requireArray(payload.actors, 'CaseCreated.payload.actors');
  const actorIds = new Set();
  for (const actor of actors) {
    if (!isPlainObject(actor)) throw integrityError('CaseCreated.actor必须为对象。');
    const id = requireId(actor.id, 'CaseCreated.actor.id');
    if (actorIds.has(id)) throw integrityError(`参与者标识重复：${id}`);
    actorIds.add(id);
    requireEnum(actor.actorType, ACTOR_TYPES, `CaseCreated.actor[${id}].actorType`);
    requireString(actor.displayName, `CaseCreated.actor[${id}].displayName`, 1, 200);
    if (actor.actorType === 'model') {
      requireEnum(actor.authority ?? 'propose', MODEL_AUTHORITIES, `CaseCreated.actor[${id}].authority`);
    }
  }
  const caseInfo = payload.case;
  if (!isPlainObject(caseInfo)) throw integrityError('CaseCreated.payload.case必须为对象。');
  requireString(caseInfo.title, 'CaseCreated.case.title', 1, 200);
  requireString(caseInfo.goal, 'CaseCreated.case.goal', 1, 4000);
  const ownerActorId = requireId(caseInfo.ownerActorId, 'CaseCreated.case.ownerActorId');
  if (!actorIds.has(ownerActorId)) throw integrityError('CaseCreated负责人必须是已知参与者。');
  const owner = actors.find((a) => a.id === ownerActorId);
  if (owner.actorType !== 'human') throw integrityError('CaseCreated负责人必须是人类。');
  requireString(caseInfo.nextStep, 'CaseCreated.case.nextStep', 1, 500);
  return { actorIds };
}

function applyCaseCreated(event) {
  const payload = clone(event.payload);
  validateCaseCreatedPayload(payload);
  const identity = payload.identity;
  const actors = payload.actors.map((a) => ({
    ...clone(a),
    authority: a.actorType === 'model' ? (a.authority ?? 'propose') : a.authority ?? null,
    roleMatrix: a.roleMatrix ?? null,
  }));
  const contextPack = payload.contextPack
    ? {
        snapshotId: payload.contextPack.snapshotId ?? 'initial',
        facts: payload.contextPack.facts ?? [],
        gaps: payload.contextPack.gaps ?? [],
        conflicts: payload.contextPack.conflicts ?? [],
        sourceRefs: payload.contextPack.sourceRefs ?? [],
        tokenBudget: payload.contextPack.tokenBudget ?? null,
        rawContent: payload.contextPack.rawContent ?? '',
        recordedAt: event.occurredAt,
      }
    : null;

  const projection = {
    identity: { workspaceId: identity.workspaceId, caseId: identity.caseId },
    schemaVersion: 'collaboration-case.v2',
    dataOrigin: payload.dataOrigin ?? 'sample',
    scenarioId: payload.scenarioId ?? null,
    version: 1,
    eventCursor: 1,
    chainHead: null,
    case: {
      title: payload.case.title,
      goal: payload.case.goal,
      goalVersion: 1,
      ownerActorId: payload.case.ownerActorId,
      phase: 'requirement',
      status: 'active',
      nextStep: payload.case.nextStep,
      updatedAt: event.occurredAt,
    },
    actors,
    phases: P2_PHASE_IDS.map((id, i) => ({
      id,
      label: PHASE_LABELS[id],
      state: i === 0 ? 'active' : 'pending',
    })),
    contextPack,
    modelRuns: [],
    candidates: [],
    decisionDiff: null,
    handoffs: [],
    pendingHandoff: null,
    gate: null,
    agentContinuity: null,
    actionIntents: [],
    receipts: [],
    activities: [],
    availableAction: null,
    views: null,
    metrics: null,
  };
  projection.activities.push({
    id: `act-${identity.caseId}-001`,
    type: event.type,
    actorId: event.actorId,
    summary: '创建协同事项',
    occurredAt: event.occurredAt,
    authoritative: true,
  });
  projection.views = buildViews(projection);
  projection.metrics = computeMetrics(projection);
  projection.availableAction = computeAvailableAction(projection);
  return projection;
}

function applyContextPackRecorded(projection, event) {
  const payload = event.payload;
  requireId(payload.snapshotId, 'ContextPackRecorded.snapshotId');
  projection.contextPack = {
    snapshotId: payload.snapshotId,
    facts: clone(payload.facts ?? []),
    gaps: clone(payload.gaps ?? []),
    conflicts: clone(payload.conflicts ?? []),
    sourceRefs: clone(payload.sourceRefs ?? []),
    tokenBudget: payload.tokenBudget ?? null,
    rawContent: payload.rawContent ?? '',
    recordedAt: event.occurredAt,
  };
  projection.case.updatedAt = event.occurredAt;
  projection.case.nextStep = payload.nextStep ?? projection.case.nextStep;
}

function applyMessageAppended(projection, event) {
  requireString(event.payload.body, 'MessageAppended.body', 1, 4000);
  projection.case.updatedAt = event.occurredAt;
}

function findModelRun(projection, runId) {
  return findById(projection.modelRuns, runId, '模型运行');
}

function applyModelRunRequested(projection, event) {
  const payload = event.payload;
  const runId = requireId(payload.runId, 'ModelRunRequested.runId');
  if (projection.modelRuns.some((r) => r.id === runId)) {
    throw integrityError(`模型运行已存在：${runId}`);
  }
  projection.modelRuns.push({
    id: runId,
    providers: clone(payload.providers ?? []),
    status: 'requested',
    requestedByActorId: event.actorId,
    goalVersion: projection.case.goalVersion,
    requestedAt: event.occurredAt,
  });
  projection.case.updatedAt = event.occurredAt;
}

function applyModelRunStarted(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'requested') throw integrityError(`模型运行状态不是requested：${run.status}`);
  run.status = 'running';
  run.startedAt = event.occurredAt;
}

function applyCandidateRecorded(projection, event) {
  const payload = event.payload;
  const run = findModelRun(projection, payload.runId);
  if (run.status !== 'running' && run.status !== 'requested') {
    throw integrityError(`模型运行已结束，不能追加候选：${run.status}`);
  }
  const candidateId = requireId(payload.candidateId, 'CandidateRecorded.candidateId');
  if (projection.candidates.some((c) => c.id === candidateId)) {
    throw integrityError(`候选已存在：${candidateId}`);
  }
  projection.candidates.push({
    id: candidateId,
    runId: payload.runId,
    provider: requireString(payload.provider, 'CandidateRecorded.provider', 1, 100),
    synthetic: payload.synthetic ?? false,
    summary: requireString(payload.summary, 'CandidateRecorded.summary', 1, 4000),
    sourceRefs: clone(payload.sourceRefs ?? []),
    assumptions: clone(payload.assumptions ?? []),
    risks: clone(payload.risks ?? []),
    missingEvidence: clone(payload.missingEvidence ?? []),
    usage: payload.usage ?? null,
    latencyMs: payload.latencyMs ?? null,
    goalVersion: projection.case.goalVersion,
    proposedAt: event.occurredAt,
    state: 'proposal',
  });
}

function applyModelRunCompleted(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'running') throw integrityError(`模型运行不在running状态：${run.status}`);
  run.status = 'completed';
  run.completedAt = event.occurredAt;
}

function applyModelRunFailed(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'running') throw integrityError(`模型运行不在running状态：${run.status}`);
  run.status = 'failed';
  run.failureReason = requireString(event.payload.reason, 'ModelRunFailed.reason', 1, 1000);
  run.completedAt = event.occurredAt;
}

function applyModelRunUnknown(projection, event) {
  const run = findModelRun(projection, event.payload.runId);
  if (run.status !== 'running') throw integrityError(`模型运行不在running状态：${run.status}`);
  run.status = 'unknown';
  run.unknownReason = requireString(event.payload.reason, 'ModelRunUnknown.reason', 1, 1000);
  run.completedAt = event.occurredAt;
}

function applyDecisionDiffRecorded(projection, event) {
  const payload = event.payload;
  const diffId = requireId(payload.diffId, 'DecisionDiffRecorded.diffId');
  if (projection.decisionDiff) {
    throw integrityError('DecisionDiff已存在。');
  }
  projection.decisionDiff = {
    id: diffId,
    convergence: clone(payload.convergence ?? []),
    disagreements: clone(payload.disagreements ?? []),
    unresolved: clone(payload.unresolved ?? []),
    recordedAt: event.occurredAt,
  };
  projection.case.updatedAt = event.occurredAt;
}

function applyHandoffProposed(projection, event) {
  const payload = event.payload;
  const handoffId = requireId(payload.handoffId, 'HandoffProposed.handoffId');
  if (projection.pendingHandoff) {
    throw integrityError('已有待接受的Handoff，不能重复提议。');
  }
  const toActorId = requireId(payload.toActorId, 'HandoffProposed.toActorId');
  const target = findById(projection.actors, toActorId, 'Handoff目标参与者');
  if (target.actorType !== 'human') {
    throw integrityError('Handoff目标必须是具名人类。');
  }
  projection.pendingHandoff = {
    id: handoffId,
    fromActorId: event.actorId,
    toActorId,
    goalVersion: projection.case.goalVersion,
    snapshotId: projection.contextPack?.snapshotId ?? null,
    facts: clone(payload.facts ?? projection.contextPack?.facts ?? []),
    gaps: clone(payload.gaps ?? projection.contextPack?.gaps ?? []),
    decisionNeeded: requireString(payload.decisionNeeded, 'HandoffProposed.decisionNeeded', 1, 2000),
    constraints: clone(payload.constraints ?? []),
    sourceRefs: clone(payload.sourceRefs ?? []),
    proposedAt: event.occurredAt,
    status: 'pending',
  };
  projection.case.phase = 'handoff';
  projection.case.updatedAt = event.occurredAt;
}

function applyHandoffAccepted(projection, event) {
  const pending = projection.pendingHandoff;
  if (!pending) throw integrityError('没有待接受的Handoff。');
  if (event.actorId !== pending.toActorId) {
    throw integrityError(`只有被点名的接收者才能接受Handoff。要求：${pending.toActorId}，实际：${event.actorId}`);
  }
  const actor = findById(projection.actors, event.actorId, '参与者');
  if (actor.actorType !== 'human') {
    throw integrityError('模型或系统不能接受Handoff。');
  }
  pending.status = 'accepted';
  pending.acceptedAt = event.occurredAt;
  projection.case.ownerActorId = event.actorId;
  projection.case.phase = 'handoff';
  projection.case.nextStep = event.payload.nextStep ?? '接力已接受，等待关口决定。';
  projection.case.updatedAt = event.occurredAt;
  projection.handoffs.push(clone(pending));
  projection.pendingHandoff = null;
}

function applyGateDecided(projection, event) {
  if (!projection.gate || projection.gate.status !== 'pending') {
    // Gate may be created inline
    if (!projection.gate) {
      const payload = event.payload;
      const deciderActorId = requireId(payload.deciderActorId, 'GateDecided.deciderActorId');
      const decider = findById(projection.actors, deciderActorId, '关口决定者');
      if (decider.actorType !== 'human') throw integrityError('关口决定者必须是具名人类。');
      projection.gate = {
        id: requireId(payload.gateId, 'GateDecided.gateId'),
        deciderActorId,
        basis: requireString(payload.basis ?? '', 'GateDecided.basis', 0, 4000),
        impact: requireString(payload.impact ?? '', 'GateDecided.impact', 0, 4000),
        goalVersion: projection.case.goalVersion,
        status: 'pending',
      };
    }
  }
  const gate = projection.gate;
  if (event.actorId !== gate.deciderActorId) {
    throw integrityError(`只有具名关口决定者才能决定。要求：${gate.deciderActorId}，实际：${event.actorId}`);
  }
  const actor = findById(projection.actors, event.actorId, '参与者');
  if (actor.actorType !== 'human') throw integrityError('模型或系统不能决定关口。');
  const decision = requireEnum(event.payload.decision, P2_GATE_DECISIONS, 'GateDecided.decision');
  gate.status = decision;
  gate.decidedAt = event.occurredAt;
  gate.basis = event.payload.basis ?? gate.basis;
  gate.impact = event.payload.impact ?? gate.impact;
  projection.case.updatedAt = event.occurredAt;
  if (decision === 'approved') {
    projection.case.phase = 'continuation';
    projection.case.nextStep = '关口已通过，Agent可以续跑。';
  } else if (decision === 'needs_evidence') {
    projection.case.nextStep = '关口需要更多证据。';
  } else {
    projection.case.nextStep = '关口被拒绝。';
  }
}

function applyAgentResumed(projection, event) {
  const payload = event.payload;
  if (projection.agentContinuity) {
    throw integrityError('AgentContinuity已存在。');
  }
  projection.agentContinuity = {
    caseId: projection.identity.caseId,
    goalVersion: projection.case.goalVersion,
    snapshotId: projection.contextPack?.snapshotId ?? null,
    restartCount: 0,
    contextSnapshot: clone(projection.contextPack),
    resumedAt: event.occurredAt,
    resumedByActorId: event.actorId,
  };
  projection.case.phase = 'continuation';
  projection.case.status = 'agent_running';
  projection.case.updatedAt = event.occurredAt;
}

function applyActionIntentCreated(projection, event) {
  const payload = event.payload;
  const intentId = requireId(payload.actionIntentId, 'ActionIntentCreated.actionIntentId');
  if (projection.actionIntents.some((a) => a.id === intentId)) {
    throw integrityError(`ActionIntent已存在：${intentId}`);
  }
  const gate = projection.gate;
  if (!gate || gate.status !== 'approved' || gate.goalVersion !== projection.case.goalVersion) {
    throw integrityError('外部动作必须依赖当前目标版本下仍有效且已通过的人工关口。');
  }
  projection.actionIntents.push({
    id: intentId,
    actionLabel: requireString(payload.actionLabel, 'ActionIntentCreated.actionLabel', 1, 500),
    targetActorId: requireId(payload.targetActorId, 'ActionIntentCreated.targetActorId'),
    gateId: gate.id,
    state: 'awaiting_receipt',
    createdAt: event.occurredAt,
    createdByActorId: event.actorId,
  });
  projection.case.status = 'awaiting_receipt';
  projection.case.updatedAt = event.occurredAt;
}

function applyReceiptRecorded(projection, event) {
  const payload = event.payload;
  const receiptId = requireId(payload.receiptId, 'ReceiptRecorded.receiptId');
  if (projection.receipts.some((r) => r.id === receiptId)) {
    throw integrityError(`回执已存在：${receiptId}`);
  }
  const intent = findById(projection.actionIntents, payload.actionIntentId, '外部动作');
  if (intent.state !== 'awaiting_receipt') {
    throw integrityError(`外部动作不是等待回执状态：${intent.state}`);
  }
  const status = requireEnum(payload.status, P2_RECEIPT_STATUSES, 'ReceiptRecorded.status');
  const actor = findById(projection.actors, event.actorId, '参与者');
  if (actor.actorType !== 'connector' && actor.actorType !== 'system') {
    throw integrityError('只有connector或system可以记录回执。');
  }
  projection.receipts.push({
    id: receiptId,
    actionIntentId: payload.actionIntentId,
    status,
    summary: requireString(payload.summary, 'ReceiptRecorded.summary', 1, 2000),
    recordedAt: event.occurredAt,
    recordedByActorId: event.actorId,
  });
  intent.state = `receipt_${status}`;
  if (status === 'succeeded') {
    projection.case.status = 'completed';
    projection.case.phase = 'receipt';
    projection.case.nextStep = '外部动作已确认成功。';
  } else if (status === 'failed') {
    projection.case.nextStep = '外部动作失败，需要人工核验。';
  } else {
    projection.case.nextStep = '外部回执未知，需要人工核验，不能重复执行。';
  }
  projection.case.updatedAt = event.occurredAt;
}

function recordActivity(projection, event, summary, authoritative = true) {
  projection.activities.push({
    id: `act-${projection.identity.caseId}-${String(projection.eventCursor).padStart(3, '0')}`,
    type: event.type,
    actorId: event.actorId,
    summary,
    occurredAt: event.occurredAt,
    authoritative,
  });
}

function invalidateStaleArtifacts(projection, reason) {
  for (const c of projection.candidates) {
    if (c.goalVersion !== projection.case.goalVersion) c.state = 'stale';
  }
  if (projection.pendingHandoff && projection.pendingHandoff.goalVersion !== projection.case.goalVersion) {
    projection.pendingHandoff.status = 'stale';
    projection.handoffs.push(clone(projection.pendingHandoff));
    projection.pendingHandoff = null;
  }
  if (projection.gate && projection.gate.goalVersion !== projection.case.goalVersion) {
    projection.gate.status = 'stale';
  }
  if (projection.decisionDiff) projection.decisionDiff.state = 'stale';
}

function reduceEvent(projection, event) {
  switch (event.type) {
    case 'ContextPackRecorded':
      applyContextPackRecorded(projection, event);
      recordActivity(projection, event, '记录上下文包');
      break;
    case 'MessageAppended':
      applyMessageAppended(projection, event);
      recordActivity(projection, event, '追加消息', false);
      break;
    case 'ModelRunRequested':
      applyModelRunRequested(projection, event);
      recordActivity(projection, event, '请求模型运行');
      break;
    case 'ModelRunStarted':
      applyModelRunStarted(projection, event);
      recordActivity(projection, event, '模型运行开始');
      break;
    case 'CandidateRecorded':
      applyCandidateRecorded(projection, event);
      recordActivity(projection, event, '模型产生候选');
      break;
    case 'ModelRunCompleted':
      applyModelRunCompleted(projection, event);
      recordActivity(projection, event, '模型运行完成');
      break;
    case 'ModelRunFailed':
      applyModelRunFailed(projection, event);
      recordActivity(projection, event, '模型运行失败');
      break;
    case 'ModelRunUnknown':
      applyModelRunUnknown(projection, event);
      recordActivity(projection, event, '模型运行状态待核验');
      break;
    case 'DecisionDiffRecorded':
      applyDecisionDiffRecorded(projection, event);
      recordActivity(projection, event, '记录Decision Diff');
      break;
    case 'HandoffProposed':
      applyHandoffProposed(projection, event);
      recordActivity(projection, event, '提议接力');
      break;
    case 'HandoffAccepted':
      applyHandoffAccepted(projection, event);
      recordActivity(projection, event, '接受接力');
      break;
    case 'GateDecided':
      applyGateDecided(projection, event);
      recordActivity(projection, event, '关口决定');
      break;
    case 'AgentResumed':
      applyAgentResumed(projection, event);
      recordActivity(projection, event, 'Agent续跑');
      break;
    case 'ActionIntentCreated':
      applyActionIntentCreated(projection, event);
      recordActivity(projection, event, '创建外部动作意图');
      break;
    case 'ReceiptRecorded':
      applyReceiptRecorded(projection, event);
      recordActivity(projection, event, '记录回执');
      break;
    default:
      throw integrityError(`未知事件类型：${event.type}`);
  }
  invalidateStaleArtifacts(projection);
  return projection;
}

function validateEventEnvelope(event, index, eventIds) {
  if (!isPlainObject(event)) throw integrityError('事件必须为对象。');
  const keys = Object.keys(event).sort();
  const expected = ['actorId', 'chainHash', 'eventId', 'occurredAt', 'payload', 'prevChainHash', 'sequence', 'type'];
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw integrityError('事件字段必须包含eventId,sequence,type,occurredAt,actorId,payload,prevChainHash,chainHash。', {
      actualFields: keys,
      expectedFields: expected,
    });
  }
  requireId(event.eventId, `events[${index}].eventId`);
  if (eventIds.has(event.eventId)) throw integrityError(`事件标识重复：${event.eventId}`);
  eventIds.add(event.eventId);
  if (!Number.isInteger(event.sequence) || event.sequence !== index + 1) {
    throw integrityError(`事件序号必须从1连续递增：${event.sequence}`);
  }
  if (!P2_EVENT_TYPES.includes(event.type)) throw integrityError(`未知事件类型：${event.type}`);
  if (typeof event.occurredAt !== 'string' || event.occurredAt.length === 0) {
    throw integrityError('事件occurredAt必须为非空字符串。');
  }
  requireId(event.actorId, `events[${index}].actorId`);
  if (!isPlainObject(event.payload)) throw integrityError('事件payload必须为对象。');
  const p = event.payload;
  if (!isPlainObject(p.identity) || p.identity.workspaceId !== event.payload?.identity?.workspaceId) {
    throw integrityError('事件payload.identity必须为对象。');
  }
}

export function replayEvents(events) {
  if (!Array.isArray(events) || events.length === 0) throw integrityError('事件链必须为非空数组。');
  let projection = null;
  const eventIds = new Set();
  events.forEach((event, index) => {
    validateEventEnvelope(event, index, eventIds);
    if (event.type === 'CaseCreated') {
      if (index !== 0) throw integrityError('CaseCreated只能是第一个事件。');
      projection = applyCaseCreated(event);
      return;
    }
    if (index === 0) throw integrityError('第一个事件必须是CaseCreated。');
    if (!projection) throw integrityError('事件链缺少CaseCreated。');
    if (event.payload.identity.workspaceId !== projection.identity.workspaceId
      || event.payload.identity.caseId !== projection.identity.caseId) {
      throw integrityError('事件身份与投影身份不一致。');
    }
    projection = reduceEvent(projection, event);
  });
  projection.eventCursor = events.length;
  projection.version = events.length;
  if (events.length > 0 && events[events.length - 1].chainHash) {
    projection.chainHead = events[events.length - 1].chainHash;
  }
  projection.views = buildViews(projection);
  projection.metrics = computeMetrics(projection);
  projection.availableAction = computeAvailableAction(projection);
  return projection;
}

export { PHASE_LABELS };
