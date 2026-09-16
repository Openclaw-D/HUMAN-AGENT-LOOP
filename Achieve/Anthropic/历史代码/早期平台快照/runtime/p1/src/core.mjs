import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertWorkProjection } from './schema.mjs';

export class P1Error extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'P1Error';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const commandTypes = Object.freeze([
  'append_message', 'update_goal', 'request_agent_run', 'raise_challenge', 'resolve_challenge',
  'propose_handoff', 'accept_handoff', 'decide_gate', 'create_action_intent', 'record_receipt',
]);
const eventTypes = Object.freeze([
  'WorkCreated', 'MessageAppended', 'GoalUpdated', 'AgentRunRequested', 'ChallengeRaised',
  'ChallengeResolved', 'HandoffProposed', 'HandoffAccepted', 'GateDecided',
  'ActionIntentCreated', 'ReceiptRecorded', 'ArtifactRecorded', 'ProposalRecorded',
]);
const sampleEventTypes = Object.freeze(['ArtifactRecorded', 'ProposalRecorded']);
const scopeKinds = Object.freeze([
  'global', 'work', 'actor', 'stage', 'challenge', 'gate', 'action', 'receipt',
]);
const activeScenarioNames = new Set(['风控业务协同', '需求开发协同', '人机交互协同']);

function validationError(message, details = {}) {
  return new P1Error(400, 'VALIDATION_ERROR', message, details);
}

function actorRequired(message = 'A named known actor is required', details = {}) {
  return new P1Error(401, 'ACTOR_REQUIRED', message, details);
}

function authorityDenied(message, details = {}) {
  return new P1Error(403, 'AUTHORITY_DENIED', message, details);
}

function invalidTransition(message, details = {}) {
  return new P1Error(409, 'INVALID_TRANSITION', message, details);
}

function projectionUnavailable(details = {}) {
  return new P1Error(503, 'PROJECTION_UNAVAILABLE', 'WorkProjection is unavailable and must not fall back to fixture data', details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireString(value, name, { minLength = 1, maxLength = 4000 } = {}) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw validationError(`${name} must be a string of ${minLength}..${maxLength} characters`, { field: name });
  }
  return value;
}

function requireId(value, name) {
  return requireString(value, name, { minLength: 1, maxLength: 128 });
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) {
    throw validationError(`${name} must be one of ${values.join(', ')}`, { field: name, allowed: values });
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw validationError(`${name} must be an array`, { field: name });
  return value;
}

function assertKeys(value, required, optional, name) {
  if (!isPlainObject(value)) throw validationError(`${name} must be an object`, { field: name });
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw validationError(`${name}.${key} is required`, { field: `${name}.${key}` });
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validationError(`${name}.${key} is not allowed`, { field: `${name}.${key}` });
  }
}

function actorById(projection, actorId) {
  return projection.actors.find((actor) => actor.id === actorId) ?? null;
}

function currentStage(projection) {
  return projection.stages.find((stage) => stage.id === projection.work.stageId) ?? null;
}

function activityFor(projection, event, activity) {
  const receiptStatus = activity.type === 'receipt' ? activity.receiptStatus : null;
  projection.activities.push({
    id: event.eventId,
    type: activity.type,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    title: requireString(activity.title, 'activity.title'),
    body: typeof activity.body === 'string' ? activity.body.slice(0, 4000) : '',
    scope: activity.scope,
    authoritative: activity.authoritative,
    receiptStatus,
  });
}

function deriveAvailableCommands(projection) {
  const actor = actorById(projection, projection.currentActorId);
  if (!actor) return [];
  const commands = [];
  const owner = projection.work.ownerActorId === actor.id;
  const stage = currentStage(projection);

  if (actor.type === 'human') {
    commands.push({ type: 'append_message', label: 'Append message', requiresConfirmation: false });
    commands.push({ type: 'request_agent_run', label: 'Request agent run', requiresConfirmation: true });
  }
  if (actor.type === 'human' || ['propose', 'own', 'approve', 'authorize'].includes(actor.authority)) {
    commands.push({ type: 'raise_challenge', label: 'Raise challenge', requiresConfirmation: true });
  }
  if (owner) {
    commands.push({ type: 'update_goal', label: 'Update goal', requiresConfirmation: true });
    commands.push({ type: 'propose_handoff', label: 'Propose handoff', requiresConfirmation: true });
    if (projection.signals.challenges.some((challenge) => challenge.state === 'open')) {
      commands.push({ type: 'resolve_challenge', label: 'Resolve challenge', requiresConfirmation: true });
    }
  }
  if (stage?.responsibleActorIds.includes(actor.id)) {
    commands.push({ type: 'decide_gate', label: 'Decide gate', requiresConfirmation: true });
  }
  const pendingForActor = projection.relations.some((relation) =>
    relation.type === 'hands_off' && relation.state === 'pending' && relation.target.kind === 'actor' && relation.target.id === actor.id);
  if (pendingForActor) commands.push({ type: 'accept_handoff', label: 'Accept handoff', requiresConfirmation: true });
  if (actor.authority === 'authorize' && projection.signals.gate?.state === 'approved' && projection.signals.actionIntent === null) {
    commands.push({ type: 'create_action_intent', label: 'Create action intent', requiresConfirmation: true });
  }
  const action = projection.signals.actionIntent;
  if (actor.type === 'system' && actor.authority === 'receipt-only' && action?.targetActorId === actor.id && projection.signals.receipt === null) {
    commands.push({ type: 'record_receipt', label: 'Record receipt', requiresConfirmation: false });
  }
  return commands;
}

function normalizeStatusAfterSignals(projection) {
  const hasOpenChallenge = projection.signals.challenges.some((challenge) => challenge.state === 'open');
  if (hasOpenChallenge) {
    projection.work.status = 'blocked';
    return;
  }
  if (projection.work.status === 'blocked') projection.work.status = 'active';
  const gate = projection.signals.gate;
  if (gate && gate.state !== 'approved' && projection.work.status === 'active') {
    projection.work.status = 'awaiting_gate';
  } else if (gate?.state === 'approved' && projection.work.status === 'awaiting_gate') {
    projection.work.status = 'active';
  }
}

function normalizeLegacyInteractionSampleCopy(payload, stages, matrix) {
  if (payload.dataOrigin !== 'sample' || payload.scenario.id !== 'interaction') return;

  const runStage = stages.find((item) => item.id === 'interaction-run');
  if (runStage?.detail === 'One explicit Agent run produced a proposal') {
    runStage.detail = 'Explicit Agent runs produce proposals only on human request';
  }

  const agentRow = matrix.rows?.find((item) => item.actorId === 'interaction-agent');
  const runCell = agentRow?.cells?.find((item) => item.columnId === 'interaction-run');
  if (runCell?.label === 'One explicit run') {
    runCell.label = 'Explicit run on human request';
  }
}

function reduceEvent(previous, event) {
  if (!eventTypes.includes(event.type)) throw new Error(`Unknown event type: ${event.type}`);
  if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error(`Invalid event sequence: ${event.sequence}`);
  }
  if (previous && previous.projectionVersion + 1 !== event.sequence) {
    throw new Error(`Non-contiguous event sequence: ${event.sequence}`);
  }

  let projection;
  if (event.type === 'WorkCreated') {
    if (previous) throw new Error('WorkCreated is only valid as the first event');
    const payload = event.payload;
    const stages = clone(payload.stages);
    const matrix = clone(payload.matrix);
    normalizeLegacyInteractionSampleCopy(payload, stages, matrix);
    projection = {
      schemaVersion: 'work-projection.v1',
      fixture: false,
      dataOrigin: payload.dataOrigin,
      projectionIdentity: { workspaceId: event.workspaceId, workId: event.workId },
      projectionVersion: 1,
      eventCursor: 1,
      generatedAt: event.occurredAt,
      scenario: clone(payload.scenario),
      currentActorId: payload.work.ownerActorId,
      work: {
        id: event.workId,
        title: payload.work.title,
        goal: payload.work.goal,
        goalVersion: 1,
        stageId: payload.initialStageId,
        status: 'active',
        ownerActorId: payload.work.ownerActorId,
        nextStep: payload.work.nextStep,
        updatedAt: event.occurredAt,
      },
      actors: clone(payload.actors),
      relations: clone(payload.relations),
      stages,
      matrix,
      signals: { challenges: [], gate: null, actionIntent: null, receipt: null },
      activities: [],
      availableCommands: [],
    };
    activityFor(projection, event, {
      type: 'system',
      title: 'Work created',
      body: payload.work.goal,
      scope: { kind: 'work', id: event.workId },
      authoritative: true,
    });
  } else {
    if (!previous) throw new Error(`Event ${event.type} cannot initialize a Work`);
    projection = clone(previous);
    projection.generatedAt = event.occurredAt;
    projection.projectionVersion = event.sequence;
    projection.eventCursor = event.sequence;
  }

  const payload = event.payload;
  if (event.type === 'MessageAppended') {
    activityFor(projection, event, {
      type: 'message',
      title: 'Message appended',
      body: payload.body,
      scope: { kind: 'work', id: event.workId },
      authoritative: false,
    });
  } else if (event.type === 'GoalUpdated') {
    projection.work.goal = payload.goal;
    if (Object.hasOwn(payload, 'nextStep')) projection.work.nextStep = payload.nextStep;
    projection.work.goalVersion += 1;
    projection.work.updatedAt = event.occurredAt;
    activityFor(projection, event, {
      type: 'system', title: 'Goal updated', body: payload.goal,
      scope: { kind: 'work', id: event.workId }, authoritative: true,
    });
  } else if (event.type === 'AgentRunRequested') {
    activityFor(projection, event, {
      type: 'system',
      title: 'Agent run requested',
      body: `Explicit agent run for ${payload.agentActorId}.`,
      scope: { kind: 'actor', id: payload.agentActorId },
      authoritative: false,
    });
  } else if (sampleEventTypes.includes(event.type)) {
    activityFor(projection, event, {
      type: 'artifact',
      title: payload.title,
      body: payload.body,
      scope: payload.scope,
      authoritative: payload.authoritative,
    });
  } else if (event.type === 'ChallengeRaised') {
    projection.signals.challenges.push({
      id: payload.challengeId, title: payload.title, state: 'open', raisedByActorId: event.actorId,
    });
    activityFor(projection, event, {
      type: 'challenge', title: `Challenge: ${payload.title}`, body: payload.title,
      scope: { kind: 'challenge', id: payload.challengeId }, authoritative: true,
    });
    normalizeStatusAfterSignals(projection);
  } else if (event.type === 'ChallengeResolved') {
    const challenge = projection.signals.challenges.find((item) => item.id === payload.challengeId);
    if (!challenge || challenge.state !== 'open') throw new Error('Challenge is not open');
    challenge.state = payload.outcome;
    activityFor(projection, event, {
      type: 'challenge', title: `Challenge ${payload.outcome}`, body: challenge.title,
      scope: { kind: 'challenge', id: payload.challengeId }, authoritative: true,
    });
    normalizeStatusAfterSignals(projection);
  } else if (event.type === 'HandoffProposed') {
    projection.relations.push({
      id: payload.handoffRelationId,
      source: { kind: 'actor', id: projection.work.ownerActorId },
      target: { kind: 'actor', id: payload.recipientActorId },
      type: 'hands_off', state: 'pending', label: payload.label ?? 'Handoff proposed',
    });
    activityFor(projection, event, {
      type: 'handoff', title: 'Handoff proposed', body: `Recipient: ${payload.recipientActorId}.`,
      scope: { kind: 'actor', id: payload.recipientActorId }, authoritative: true,
    });
  } else if (event.type === 'HandoffAccepted') {
    const relation = projection.relations.find((item) => item.id === payload.handoffRelationId);
    if (!relation || relation.type !== 'hands_off' || relation.state !== 'pending') throw new Error('Handoff is not pending');
    relation.state = 'accepted';
    projection.work.ownerActorId = relation.target.id;
    projection.currentActorId = relation.target.id;
    projection.work.updatedAt = event.occurredAt;
    activityFor(projection, event, {
      type: 'handoff', title: 'Handoff accepted', body: `New owner: ${relation.target.id}.`,
      scope: { kind: 'actor', id: relation.target.id }, authoritative: true,
    });
  } else if (event.type === 'GateDecided') {
    projection.signals.gate = {
      id: payload.gateId,
      state: payload.decision,
      basis: payload.basis,
      impact: payload.impact,
      responsibleActorId: payload.responsibleActorId,
    };
    activityFor(projection, event, {
      type: 'gate', title: `Gate ${payload.decision}`, body: payload.basis,
      scope: { kind: 'gate', id: payload.gateId }, authoritative: true,
    });
    normalizeStatusAfterSignals(projection);
  } else if (event.type === 'ActionIntentCreated') {
    projection.signals.actionIntent = {
      id: payload.actionIntentId,
      state: 'created',
      actionType: payload.actionType,
      targetActorId: payload.targetActorId,
      authorizedByActorId: event.actorId,
    };
    activityFor(projection, event, {
      type: 'action', title: `Action intent created: ${payload.actionType}`, body: `Target: ${payload.targetActorId}.`,
      scope: { kind: 'action', id: payload.actionIntentId }, authoritative: true,
    });
  } else if (event.type === 'ReceiptRecorded') {
    const action = projection.signals.actionIntent;
    if (!action || action.id !== payload.actionIntentId) throw new Error('Receipt has no matching ActionIntent');
    if (projection.signals.receipt) throw new Error('Receipt already exists');
    projection.signals.receipt = {
      id: payload.receiptId,
      actionIntentId: payload.actionIntentId,
      status: payload.status,
      recordedAt: event.occurredAt,
    };
    action.state = 'finished';
    if (payload.status === 'succeeded') projection.work.status = 'completed';
    activityFor(projection, event, {
      type: 'receipt', title: `Receipt ${payload.status}`, body: `ActionIntent: ${payload.actionIntentId}.`,
      scope: { kind: 'receipt', id: payload.receiptId }, authoritative: true, receiptStatus: payload.status,
    });
  }

  projection.availableCommands = deriveAvailableCommands(projection);
  return projection;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(request) {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function validateCreateInput(input) {
  assertKeys(input, [
    'workspaceId', 'workId', 'scenario', 'dataOrigin', 'currentActorId', 'work', 'actors', 'relations', 'stages', 'matrix',
  ], [], 'input');
  const workspaceId = requireId(input.workspaceId, 'workspaceId');
  const workId = requireId(input.workId, 'workId');
  requireEnum(input.dataOrigin, ['sample', 'user', 'connector'], 'dataOrigin');
  requireId(input.currentActorId, 'currentActorId');
  assertKeys(input.scenario, ['id', 'name', 'defaultView'], [], 'scenario');
  requireId(input.scenario.id, 'scenario.id');
  requireString(input.scenario.name, 'scenario.name', { minLength: 1, maxLength: 100 });
  if (!activeScenarioNames.has(input.scenario.name)) {
    throw validationError('P1 can create works only for the three active scenarios', { field: 'scenario.name' });
  }
  requireEnum(input.scenario.defaultView, ['relation', 'progress', 'matrix'], 'scenario.defaultView');
  assertKeys(input.work, ['title', 'goal', 'ownerActorId', 'nextStep'], [], 'work');
  requireString(input.work.title, 'work.title', { minLength: 1, maxLength: 4000 });
  requireString(input.work.goal, 'work.goal', { minLength: 1, maxLength: 4000 });
  requireId(input.work.ownerActorId, 'work.ownerActorId');
  if (typeof input.work.nextStep !== 'string' || input.work.nextStep.length > 4000) {
    throw validationError('work.nextStep must be a string of at most 4000 characters', { field: 'work.nextStep' });
  }
  requireArray(input.actors, 'actors');
  requireArray(input.relations, 'relations');
  requireArray(input.stages, 'stages');
  if (!isPlainObject(input.matrix)) throw validationError('matrix must be an object', { field: 'matrix' });
  if (input.stages.length < 1) throw validationError('stages requires at least one item', { field: 'stages' });

  const actorIds = new Set(input.actors.map((actor) => actor?.id).filter((id) => typeof id === 'string'));
  if (!actorIds.has(input.currentActorId)) throw actorRequired('currentActorId must identify a known actor');
  if (!actorIds.has(input.work.ownerActorId)) throw validationError('work.ownerActorId must identify a known actor');
  for (const relation of input.relations) {
    for (const endpoint of [relation?.source, relation?.target]) {
      if (!isPlainObject(endpoint)) throw validationError('relation endpoints must be objects', { field: 'relations' });
      if (endpoint.kind === 'actor' && !actorIds.has(endpoint.id)) throw validationError('relation actor endpoint must be known', { field: 'relations' });
      if (endpoint.kind === 'stage' && !input.stages.some((stage) => stage.id === endpoint.id)) {
        throw validationError('relation stage endpoint must be known', { field: 'relations' });
      }
      if (endpoint.kind === 'work' && endpoint.id !== workId) throw validationError('relation work endpoint must identify this Work', { field: 'relations' });
    }
  }
  for (const stage of input.stages) {
    if (!isPlainObject(stage)) throw validationError('stage must be an object', { field: 'stages' });
    for (const actorId of stage.responsibleActorIds ?? []) {
      if (!actorIds.has(actorId)) throw validationError('stage responsible actor must be known', { field: 'stages.responsibleActorIds' });
    }
  }
  const columnIds = new Set(input.matrix.columns?.map((column) => column?.id) ?? []);
  for (const row of input.matrix.rows ?? []) {
    if (!actorIds.has(row?.actorId)) throw validationError('matrix row must reference a known actor', { field: 'matrix.rows.actorId' });
    for (const cell of row.cells ?? []) {
      if (!columnIds.has(cell?.columnId)) throw validationError('matrix cell must reference a known column', { field: 'matrix.rows.cells.columnId' });
    }
  }
  const currentStages = input.stages.filter((stage) => stage.state === 'current');
  if (currentStages.length > 1) throw validationError('only one stage may be current', { field: 'stages' });
  const initialStage = currentStages[0] ?? [...input.stages].sort((left, right) => left.order - right.order)[0];
  if (!initialStage || typeof initialStage.id !== 'string') throw validationError('an initial stage is required', { field: 'stages' });
  return { workspaceId, workId, initialStageId: initialStage.id };
}

function validateCommandEnvelope(command) {
  assertKeys(command, [
    'commandId', 'idempotencyKey', 'expectedProjectionVersion', 'type', 'payload',
  ], [], 'command');
  requireId(command.commandId, 'command.commandId');
  requireId(command.idempotencyKey, 'command.idempotencyKey');
  if (typeof command.expectedProjectionVersion !== 'number' || !Number.isInteger(command.expectedProjectionVersion) || command.expectedProjectionVersion < 0) {
    throw validationError('expectedProjectionVersion must be a non-negative integer', { field: 'expectedProjectionVersion' });
  }
  if (!commandTypes.includes(command.type)) throw validationError('Unsupported command type', { field: 'type', allowed: [...commandTypes] });
  if (!isPlainObject(command.payload)) throw validationError('payload must be an object', { field: 'payload' });
}

function validateCommandPolicy(projection, actorId, type, payload) {
  const actor = actorById(projection, actorId);
  if (!actor) throw actorRequired('Actor is not a named actor in this Work', { actorId });
  const owner = projection.work.ownerActorId === actor.id;

  if (type === 'append_message') {
    assertKeys(payload, ['body'], [], 'payload');
    requireString(payload.body, 'payload.body', { minLength: 1, maxLength: 4000 });
    if (actor.type !== 'human') throw authorityDenied('append_message requires a known Human actor');
    return { eventType: 'MessageAppended', payload: clone(payload) };
  }

  if (type === 'update_goal') {
    assertKeys(payload, ['goal'], ['nextStep'], 'payload');
    requireString(payload.goal, 'payload.goal', { minLength: 1, maxLength: 4000 });
    if ('nextStep' in payload && (typeof payload.nextStep !== 'string' || payload.nextStep.length > 4000)) {
      throw validationError('payload.nextStep must be a string of at most 4000 characters');
    }
    if (!owner) throw authorityDenied('update_goal requires the current owner');
    return { eventType: 'GoalUpdated', payload: clone(payload) };
  }

  if (type === 'request_agent_run') {
    assertKeys(payload, ['agentActorId'], [], 'payload');
    requireId(payload.agentActorId, 'payload.agentActorId');
    if (actor.type !== 'human') throw authorityDenied('request_agent_run requires an explicit Human request');
    const agent = actorById(projection, payload.agentActorId);
    if (!agent || agent.type !== 'agent') throw validationError('agentActorId must identify a known Agent');
    return { eventType: 'AgentRunRequested', payload: clone(payload) };
  }

  if (type === 'raise_challenge') {
    assertKeys(payload, ['challengeId', 'title'], [], 'payload');
    requireId(payload.challengeId, 'payload.challengeId');
    requireString(payload.title, 'payload.title', { minLength: 1, maxLength: 4000 });
    const allowedAgent = actor.type === 'agent' && ['propose', 'own', 'approve', 'authorize'].includes(actor.authority);
    if (actor.type !== 'human' && !allowedAgent) throw authorityDenied('raise_challenge requires a Human or authorized Agent');
    if (projection.signals.challenges.some((challenge) => challenge.id === payload.challengeId)) {
      throw invalidTransition('challengeId already exists');
    }
    return { eventType: 'ChallengeRaised', payload: clone(payload) };
  }

  if (type === 'resolve_challenge') {
    assertKeys(payload, ['challengeId', 'outcome'], [], 'payload');
    requireId(payload.challengeId, 'payload.challengeId');
    requireEnum(payload.outcome, ['resolved', 'dismissed'], 'payload.outcome');
    const challenge = projection.signals.challenges.find((item) => item.id === payload.challengeId);
    if (!challenge || challenge.state !== 'open') throw invalidTransition('Challenge is not open');
    const gateResponsible = projection.signals.gate?.responsibleActorId === actor.id;
    if (!owner && !gateResponsible) throw authorityDenied('resolve_challenge requires the owner or Gate responsible actor');
    return { eventType: 'ChallengeResolved', payload: clone(payload) };
  }

  if (type === 'propose_handoff') {
    assertKeys(payload, ['handoffRelationId', 'recipientActorId'], ['label'], 'payload');
    requireId(payload.handoffRelationId, 'payload.handoffRelationId');
    requireId(payload.recipientActorId, 'payload.recipientActorId');
    if ('label' in payload) requireString(payload.label, 'payload.label', { minLength: 1, maxLength: 500 });
    if (!owner) throw authorityDenied('propose_handoff requires the current owner');
    const recipient = actorById(projection, payload.recipientActorId);
    if (!recipient || recipient.id === projection.work.ownerActorId) throw validationError('recipientActorId must identify another known actor');
    if (projection.relations.some((relation) => relation.id === payload.handoffRelationId)) {
      throw invalidTransition('handoffRelationId already exists');
    }
    return { eventType: 'HandoffProposed', payload: clone(payload) };
  }

  if (type === 'accept_handoff') {
    assertKeys(payload, ['handoffRelationId'], [], 'payload');
    requireId(payload.handoffRelationId, 'payload.handoffRelationId');
    const relation = projection.relations.find((item) => item.id === payload.handoffRelationId);
    if (!relation || relation.type !== 'hands_off' || relation.state !== 'pending') throw invalidTransition('Handoff is not pending');
    if (relation.target.kind !== 'actor' || relation.target.id !== actor.id) {
      throw authorityDenied('accept_handoff requires the named handoff recipient');
    }
    return { eventType: 'HandoffAccepted', payload: clone(payload) };
  }

  if (type === 'decide_gate') {
    assertKeys(payload, ['gateId', 'decision', 'basis', 'impact', 'responsibleActorId'], [], 'payload');
    requireId(payload.gateId, 'payload.gateId');
    requireEnum(payload.decision, ['approved', 'rejected', 'needs_evidence'], 'payload.decision');
    requireString(payload.basis, 'payload.basis', { minLength: 1, maxLength: 4000 });
    requireString(payload.impact, 'payload.impact', { minLength: 1, maxLength: 4000 });
    requireId(payload.responsibleActorId, 'payload.responsibleActorId');
    const stage = currentStage(projection);
    const existingGate = projection.signals.gate;
    if (existingGate) {
      if (existingGate.id !== payload.gateId) throw invalidTransition('gateId does not match the current Gate');
      if (existingGate.responsibleActorId !== payload.responsibleActorId || actor.id !== existingGate.responsibleActorId) {
        throw authorityDenied('decide_gate requires the named Gate responsible actor');
      }
    } else {
      if (actor.id !== payload.responsibleActorId) throw authorityDenied('decide_gate requires the named Gate responsible actor');
      if (!stage?.responsibleActorIds.includes(payload.responsibleActorId)) {
        throw authorityDenied('Gate responsible actor must be named by the current stage');
      }
    }
    return { eventType: 'GateDecided', payload: clone(payload) };
  }

  if (type === 'create_action_intent') {
    assertKeys(payload, ['actionIntentId', 'actionType', 'targetActorId', 'gateId'], [], 'payload');
    requireId(payload.actionIntentId, 'payload.actionIntentId');
    requireId(payload.actionType, 'payload.actionType');
    requireId(payload.targetActorId, 'payload.targetActorId');
    requireId(payload.gateId, 'payload.gateId');
    if (actor.authority !== 'authorize') throw authorityDenied('create_action_intent requires a named authorizer');
    const gate = projection.signals.gate;
    if (!gate || gate.id !== payload.gateId || gate.state !== 'approved') {
      throw invalidTransition('ActionIntent requires its named Gate to be approved');
    }
    if (projection.signals.actionIntent) throw invalidTransition('ActionIntent already exists');
    const target = actorById(projection, payload.targetActorId);
    if (!target || target.type !== 'system' || target.authority !== 'receipt-only') {
      throw validationError('targetActorId must identify a connector/system receipt actor');
    }
    return { eventType: 'ActionIntentCreated', payload: clone(payload) };
  }

  if (type === 'record_receipt') {
    assertKeys(payload, ['receiptId', 'status'], [], 'payload');
    requireId(payload.receiptId, 'payload.receiptId');
    requireEnum(payload.status, ['succeeded', 'failed', 'unknown'], 'payload.status');
    const action = projection.signals.actionIntent;
    if (!action) throw invalidTransition('Receipt requires an ActionIntent');
    if (projection.signals.receipt) throw invalidTransition('Receipt already exists and cannot be reinterpreted');
    if (action.targetActorId !== actor.id || actor.type !== 'system' || actor.authority !== 'receipt-only') {
      throw authorityDenied('record_receipt requires the corresponding connector/system actor');
    }
    return {
      eventType: 'ReceiptRecorded',
      payload: { receiptId: payload.receiptId, status: payload.status, actionIntentId: action.id },
    };
  }

  throw validationError('Unsupported command type');
}

function validateSampleArtifactPayload(payload, eventName) {
  assertKeys(payload, ['title', 'body', 'scope', 'authoritative'], [], `${eventName}.payload`);
  requireString(payload.title, `${eventName}.payload.title`);
  if (typeof payload.body !== 'string' || payload.body.length < 1 || payload.body.length > 4000) {
    throw validationError(`${eventName}.payload.body must be a string of 1..4000 characters`, {
      field: `${eventName}.payload.body`,
    });
  }
  assertKeys(payload.scope, ['kind', 'id'], [], `${eventName}.payload.scope`);
  requireEnum(payload.scope.kind, scopeKinds, `${eventName}.payload.scope.kind`);
  requireId(payload.scope.id, `${eventName}.payload.scope.id`);
  if (typeof payload.authoritative !== 'boolean') {
    throw validationError(`${eventName}.payload.authoritative must be a boolean`, {
      field: `${eventName}.payload.authoritative`,
    });
  }
  return clone(payload);
}

export class P1Core {
  constructor({ dbPath, clock, idFactory } = {}) {
    if (typeof dbPath !== 'string' || dbPath.length === 0) throw validationError('dbPath is required');
    this.dbPath = dbPath;
    this.clock = typeof clock === 'function' ? clock : () => new Date().toISOString();
    this.idFactory = typeof idFactory === 'function' ? idFactory : () => randomUUID();
    this.closed = false;
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this._initializeDatabase();
  }

  _initializeDatabase() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS p1_events (
        workspace_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload)),
        command_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        PRIMARY KEY (workspace_id, work_id, sequence),
        UNIQUE (workspace_id, work_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS p1_events_work_type_idx
        ON p1_events (workspace_id, work_id, type);
      CREATE TABLE IF NOT EXISTS p1_command_idempotency (
        workspace_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        result_body TEXT NOT NULL CHECK (json_valid(result_body)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, work_id, idempotency_key)
      );

      CREATE TRIGGER IF NOT EXISTS p1_events_no_update
      BEFORE UPDATE ON p1_events
      BEGIN
        SELECT RAISE(ABORT, 'p1_events is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS p1_events_no_delete
      BEFORE DELETE ON p1_events
      BEGIN
        SELECT RAISE(ABORT, 'p1_events is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS p1_idempotency_no_update
      BEFORE UPDATE ON p1_command_idempotency
      BEGIN
        SELECT RAISE(ABORT, 'p1_command_idempotency is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS p1_idempotency_no_delete
      BEFORE DELETE ON p1_command_idempotency
      BEGIN
        SELECT RAISE(ABORT, 'p1_command_idempotency is append-only');
      END;
    `);
  }

  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
      this.db = null;
    }
  }

  _requireOpen() {
    if (this.closed || !this.db) throw projectionUnavailable({ reason: 'database is closed' });
  }

  _runTransaction(operation) {
    this._requireOpen();
    this.db.exec('BEGIN IMMEDIATE');
    let value;
    try {
      value = operation();
      this.db.exec('COMMIT');
      return { ok: true, value };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // COMMIT either succeeded before throwing, or the connection will surface its original failure.
      }
      return { ok: false, error };
    }
  }

  _readEvents(workspaceId, workId) {
    const rows = this.db.prepare(`
      SELECT workspace_id, work_id, sequence, event_id, type, actor_id, occurred_at, payload, command_id, idempotency_key
      FROM p1_events
      WHERE workspace_id = ? AND work_id = ?
      ORDER BY sequence
    `).all(workspaceId, workId);
    return rows.map((row) => {
      let payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        throw new Error(`Invalid event payload JSON at sequence ${row.sequence}`);
      }
      return {
        workspaceId: row.workspace_id,
        workId: row.work_id,
        sequence: row.sequence,
        eventId: row.event_id,
        type: row.type,
        actorId: row.actor_id,
        occurredAt: row.occurred_at,
        payload,
        commandId: row.command_id,
        idempotencyKey: row.idempotency_key,
      };
    });
  }

  _replayRows(rows, workspaceId, workId) {
    if (rows.length === 0) throw new P1Error(404, 'WORK_NOT_FOUND', 'Work not found', { workspaceId, workId });
    let projection = null;
    try {
      for (const event of rows) {
        if (event.workspaceId !== workspaceId || event.workId !== workId) throw new Error('Event identity mismatch');
        projection = reduceEvent(projection, event);
      }
      assertWorkProjection(projection);
      if (projection.projectionVersion !== projection.eventCursor || projection.eventCursor !== rows.at(-1).sequence) {
        throw new Error('Projection version and event cursor diverge');
      }
      return deepFreeze(projection);
    } catch (error) {
      throw projectionUnavailable({ reason: 'event replay or schema validation failed', detail: error.message });
    }
  }

  _insertEvent(event) {
    this.db.prepare(`
      INSERT INTO p1_events
        (workspace_id, work_id, sequence, event_id, type, actor_id, occurred_at, payload, command_id, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.workspaceId, event.workId, event.sequence, event.eventId, event.type, event.actorId,
      event.occurredAt, JSON.stringify(event.payload), event.commandId, event.idempotencyKey,
    );
  }

  createWork(input) {
    if (!isPlainObject(input)) throw validationError('input must be an object');
    const { workspaceId, workId, initialStageId } = validateCreateInput(input);
    const eventId = this.idFactory();
    const commandId = `create-${eventId}`;
    const event = {
      workspaceId,
      workId,
      sequence: 1,
      eventId,
      type: 'WorkCreated',
      actorId: input.currentActorId,
      occurredAt: this.clock(),
      payload: {
        scenario: input.scenario,
        dataOrigin: input.dataOrigin,
        currentActorId: input.currentActorId,
        work: input.work,
        actors: input.actors,
        relations: input.relations,
        stages: input.stages,
        matrix: input.matrix,
        initialStageId,
      },
      commandId,
      idempotencyKey: commandId,
    };
    requireId(event.eventId, 'eventId');
    const outcome = this._runTransaction(() => {
      const existing = this.db.prepare(
        'SELECT 1 FROM p1_events WHERE workspace_id = ? AND work_id = ? AND type = ? LIMIT 1',
      ).get(workspaceId, workId, 'WorkCreated');
      if (existing) throw invalidTransition('Work already exists', { workspaceId, workId });
      const projection = reduceEvent(null, event);
      assertWorkProjection(projection);
      this._insertEvent(event);
      return deepFreeze(projection);
    });
    if (outcome.ok) return outcome.value;
    if (outcome.error instanceof P1Error) throw outcome.error;
    throw projectionUnavailable({ reason: 'Work creation failed', detail: outcome.error.message });
  }

  getProjection(workspaceId, workId) {
    this._requireOpen();
    requireId(workspaceId, 'workspaceId');
    requireId(workId, 'workId');
    const outcome = this._runTransaction(() => this._replayRows(this._readEvents(workspaceId, workId), workspaceId, workId));
    if (outcome.ok) return outcome.value;
    if (outcome.error instanceof P1Error) throw outcome.error;
    throw projectionUnavailable({ reason: 'projection read failed', detail: outcome.error.message });
  }

  replayProjection(workspaceId, workId) {
    return this.getProjection(workspaceId, workId);
  }

  appendSampleEvents({ workspaceId, workId, events } = {}) {
    const request = { workspaceId, workId, events };
    assertKeys(request, ['workspaceId', 'workId', 'events'], [], 'request');
    requireId(workspaceId, 'workspaceId');
    requireId(workId, 'workId');
    requireArray(events, 'events');
    if (events.length < 1) throw validationError('events requires at least one item', { field: 'events' });

    const outcome = this._runTransaction(() => {
      const rows = this._readEvents(workspaceId, workId);
      if (rows.length === 0) {
        throw new P1Error(404, 'WORK_NOT_FOUND', 'Work not found', { workspaceId, workId });
      }
      let projection = this._replayRows(rows, workspaceId, workId);
      if (projection.dataOrigin !== 'sample') {
        throw authorityDenied('appendSampleEvents is restricted to sample Work', { workspaceId, workId });
      }
      const knownActors = new Set(projection.actors.map((actor) => actor.id));

      for (const [index, sampleEvent] of events.entries()) {
        assertKeys(sampleEvent, ['type', 'actorId', 'payload'], [], `events[${index}]`);
        if (!sampleEventTypes.includes(sampleEvent.type)) {
          throw validationError('sample events support only ArtifactRecorded and ProposalRecorded', {
            field: `events[${index}].type`,
            allowed: [...sampleEventTypes],
          });
        }
        if (typeof sampleEvent.actorId !== 'string' || sampleEvent.actorId.length < 1 || sampleEvent.actorId.length > 128) {
          throw actorRequired('A named known actor is required');
        }
        if (!knownActors.has(sampleEvent.actorId)) {
          throw actorRequired('Actor is not a named actor in this sample Work', { actorId: sampleEvent.actorId });
        }
        if (!isPlainObject(sampleEvent.payload)) {
          throw validationError(`events[${index}].payload must be an object`);
        }
        const payload = validateSampleArtifactPayload(sampleEvent.payload, `events[${index}]`);
        const eventId = this.idFactory();
        requireId(eventId, 'eventId');
        const commandId = `sample-${eventId}`;
        const event = {
          workspaceId,
          workId,
          sequence: projection.eventCursor + 1,
          eventId,
          type: sampleEvent.type,
          actorId: sampleEvent.actorId,
          occurredAt: this.clock(),
          payload,
          commandId,
          idempotencyKey: commandId,
        };
        projection = reduceEvent(projection, event);
        assertWorkProjection(projection);
        this._insertEvent(event);
      }
      return deepFreeze(projection);
    });

    if (outcome.ok) return outcome.value;
    if (outcome.error instanceof P1Error) throw outcome.error;
    throw projectionUnavailable({ reason: 'sample event append failed', detail: outcome.error.message });
  }

  listWorks(workspaceId, options = {}) {
    this._requireOpen();
    requireId(workspaceId, 'workspaceId');
    if (!isPlainObject(options)) throw validationError('options must be an object');
    assertKeys(options, [], ['scenarioId'], 'options');
    if ('scenarioId' in options) requireId(options.scenarioId, 'scenarioId');
    const outcome = this._runTransaction(() => {
      const identities = this.db.prepare(`
        SELECT workspace_id, work_id FROM p1_events
        WHERE workspace_id = ? AND type = 'WorkCreated'
        ORDER BY work_id
      `).all(workspaceId);
      const summaries = [];
      for (const identity of identities) {
        const projection = this._replayRows(this._readEvents(identity.workspace_id, identity.work_id), identity.workspace_id, identity.work_id);
        if (options.scenarioId && projection.scenario.id !== options.scenarioId) continue;
        summaries.push({
          workspaceId: projection.projectionIdentity.workspaceId,
          workId: projection.projectionIdentity.workId,
          scenarioId: projection.scenario.id,
          title: projection.work.title,
          status: projection.work.status,
          ownerActorId: projection.work.ownerActorId,
          projectionVersion: projection.projectionVersion,
          eventCursor: projection.eventCursor,
          updatedAt: projection.work.updatedAt,
        });
      }
      return summaries;
    });
    if (outcome.ok) return outcome.value;
    if (outcome.error instanceof P1Error) throw outcome.error;
    throw projectionUnavailable({ reason: 'work listing failed', detail: outcome.error.message });
  }

  executeCommand({ workspaceId, workId, actorId, command } = {}) {
    const request = { workspaceId, workId, actorId, command };
    try {
      assertKeys(request, ['workspaceId', 'workId', 'actorId', 'command'], [], 'request');
      requireId(workspaceId, 'workspaceId');
      requireId(workId, 'workId');
      if (typeof actorId !== 'string' || actorId.length < 1 || actorId.length > 128) {
        throw actorRequired('A named actorId is required');
      }
      validateCommandEnvelope(command);
    } catch (error) {
      if (error instanceof P1Error) return this._errorResponse(error);
      return this._errorResponse(validationError('Invalid command request', { detail: error.message }));
    }

    const hash = requestHash(request);
    const outcome = this._runTransaction(() => {
      const prior = this.db.prepare(`
        SELECT request_hash, status_code, result_body
        FROM p1_command_idempotency
        WHERE workspace_id = ? AND work_id = ? AND idempotency_key = ?
      `).get(workspaceId, workId, command.idempotencyKey);
      if (prior) {
        if (prior.request_hash !== hash) {
          throw new P1Error(409, 'IDEMPOTENCY_CONFLICT', 'idempotencyKey was already used for a different normalized request', {
            idempotencyKey: command.idempotencyKey,
          });
        }
        try {
          return { statusCode: prior.status_code, body: JSON.parse(prior.result_body), replayed: true };
        } catch {
          throw projectionUnavailable({ reason: 'idempotency result is corrupt' });
        }
      }

      const rows = this._readEvents(workspaceId, workId);
      if (rows.length === 0) {
        throw new P1Error(404, 'WORK_NOT_FOUND', 'Work not found', { workspaceId, workId });
      }
      let current = this._replayRows(rows, workspaceId, workId);
      if (current.projectionVersion !== command.expectedProjectionVersion) {
        throw new P1Error(409, 'PROJECTION_VERSION_CONFLICT', 'expectedProjectionVersion does not match the current projection', {
          expectedProjectionVersion: command.expectedProjectionVersion,
          currentProjectionVersion: current.projectionVersion,
        });
      }

      const decision = validateCommandPolicy(current, actorId, command.type, command.payload);
      const eventId = this.idFactory();
      requireId(eventId, 'eventId');
      const event = {
        workspaceId,
        workId,
        sequence: current.eventCursor + 1,
        eventId,
        type: decision.eventType,
        actorId,
        occurredAt: this.clock(),
        payload: decision.payload,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
      };
      const projection = reduceEvent(current, event);
      assertWorkProjection(projection);
      this._insertEvent(event);

      const result = {
        accepted: true,
        eventIds: [event.eventId],
        projection: deepFreeze(projection),
      };
      this.db.prepare(`
        INSERT INTO p1_command_idempotency
          (workspace_id, work_id, idempotency_key, request_hash, status_code, result_body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId, workId, command.idempotencyKey, hash, 200,
        JSON.stringify(result), event.occurredAt,
      );
      return { statusCode: 200, body: result, replayed: false };
    });

    if (outcome.ok) return { statusCode: outcome.value.statusCode, body: outcome.value.body };
    if (outcome.error instanceof P1Error) return this._errorResponse(outcome.error);
    return this._errorResponse(projectionUnavailable({ reason: 'command transaction failed', detail: outcome.error.message }));
  }

  _errorResponse(error) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? {},
        },
      },
    };
  }
}

export { commandTypes, eventTypes };
