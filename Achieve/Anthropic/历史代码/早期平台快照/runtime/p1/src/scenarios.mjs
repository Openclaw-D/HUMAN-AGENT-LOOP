import { P1Error } from './core.mjs';
import { assertWorkProjection } from './schema.mjs';

export const scenarioCatalog = Object.freeze([
  Object.freeze({ scenarioId: 'risk', name: '风控业务协同', defaultView: 'progress', runtimeAvailability: 'active' }),
  Object.freeze({ scenarioId: 'dev', name: '需求开发协同', defaultView: 'progress', runtimeAvailability: 'active' }),
  Object.freeze({ scenarioId: 'interaction', name: '人机交互协同', defaultView: 'relation', runtimeAvailability: 'active' }),
  Object.freeze({ scenarioId: 'content', name: '内容生产协同', defaultView: 'progress', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'growth', name: '经营增长协同', defaultView: 'matrix', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'embodied', name: '物理智能协同', defaultView: 'relation', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'knowledge', name: '知识办公协同', defaultView: 'progress', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'service', name: '客户服务协同', defaultView: 'progress', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'supply-chain', name: '供应链履约协同', defaultView: 'matrix', runtimeAvailability: 'catalog-only' }),
  Object.freeze({ scenarioId: 'healthcare', name: '医疗服务协同', defaultView: 'progress', runtimeAvailability: 'catalog-only' }),
]);

export const sampleWorkspaceId = 'sample-p1';
export const sampleWorkIds = Object.freeze({
  risk: 'risk-sample-001',
  dev: 'dev-sample-001',
  interaction: 'interaction-sample-001',
});

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

function actor(id, name, type, role, authority, state) {
  return { id, name, type, role, authority, state };
}

function stage(id, name, order, state, detail, responsibleActorIds) {
  return { id, name, order, state, detail, responsibleActorIds, blockers: [] };
}

function relation(id, sourceId, target, type, state, label) {
  return {
    id,
    source: sourceId.kind === 'actor' ? sourceId : { kind: 'actor', id: sourceId },
    target,
    type,
    state,
    label,
  };
}

function matrixRow(actorId, stages, responsibilities) {
  return {
    actorId,
    cells: stages.map((currentStage) => responsibilities[currentStage.id] ?? {
      columnId: currentStage.id,
      responsibility: 'none',
      state: 'none',
      label: 'Not involved',
    }),
  };
}

function matrix(stages, rows) {
  return {
    columnKind: 'stage',
    columns: stages.map((currentStage) => ({ id: currentStage.id, label: currentStage.name })),
    rows,
  };
}

function scenarioFor(scenarioId) {
  const entry = scenarioCatalog.find((item) => item.scenarioId === scenarioId);
  if (!entry) throw new Error(`Unknown sample scenario: ${scenarioId}`);
  return { id: entry.scenarioId, name: entry.name, defaultView: entry.defaultView };
}

function workInput({ scenarioId, workId, title, goal, nextStep }, actors, stages, relations, rows) {
  return {
    workspaceId: sampleWorkspaceId,
    workId,
    scenario: scenarioFor(scenarioId),
    dataOrigin: 'sample',
    currentActorId: actors[0].id,
    work: { title, goal, ownerActorId: actors[0].id, nextStep },
    actors,
    relations,
    stages,
    matrix: matrix(stages, rows),
  };
}

function riskInput() {
  const actors = [
    actor('risk-owner', 'Risk Owner', 'human', 'Business risk owner', 'own', 'Active'),
    actor('risk-agent', 'Risk Evidence Agent', 'agent', 'Evidence assistant', 'propose', 'Available'),
    actor('risk-approver', 'Risk Approver', 'human', 'Named risk gate owner', 'approve', 'Active'),
    actor('risk-authorizer', 'Risk Action Authorizer', 'human', 'Named external action authorizer', 'authorize', 'Active'),
    actor('risk-connector', 'Risk Connector', 'system', 'External action connector', 'receipt-only', 'Unknown'),
  ];
  const stages = [
    stage('risk-evidence', 'Evidence', 0, 'done', 'Evidence has been replayed from sample events', ['risk-owner', 'risk-agent']),
    stage('risk-review', 'Human review', 1, 'current', 'Named human gate controls the external action', ['risk-owner', 'risk-approver']),
    stage('risk-action', 'External action', 2, 'pending', 'Connector outcome remains unknown', ['risk-authorizer', 'risk-connector']),
  ];
  const relations = [
    relation('risk-owner-owns', 'risk-owner', { kind: 'work', id: sampleWorkIds.risk }, 'owns', 'active', 'Owner'),
    relation('risk-agent-assists', 'risk-agent', { kind: 'actor', id: 'risk-owner' }, 'assists', 'active', 'Evidence assistance'),
    relation('risk-approver-reviews', 'risk-approver', { kind: 'actor', id: 'risk-owner' }, 'reviews', 'active', 'Gate review'),
  ];
  const rows = [
    matrixRow('risk-owner', stages, {
      'risk-evidence': { columnId: 'risk-evidence', responsibility: 'own', state: 'done', label: 'Owns evidence' },
      'risk-review': { columnId: 'risk-review', responsibility: 'prepare', state: 'active', label: 'Prepares gate evidence' },
      'risk-action': { columnId: 'risk-action', responsibility: 'observe', state: 'none', label: 'Observes outcome' },
    }),
    matrixRow('risk-agent', stages, {
      'risk-evidence': { columnId: 'risk-evidence', responsibility: 'assist', state: 'done', label: 'Prepared evidence artifact' },
      'risk-review': { columnId: 'risk-review', responsibility: 'review', state: 'pending', label: 'Proposes evidence' },
    }),
    matrixRow('risk-approver', stages, {
      'risk-review': { columnId: 'risk-review', responsibility: 'approve', state: 'active', label: 'Named gate owner' },
    }),
    matrixRow('risk-authorizer', stages, {
      'risk-action': { columnId: 'risk-action', responsibility: 'authorize', state: 'pending', label: 'Authorizes intent only' },
    }),
    matrixRow('risk-connector', stages, {
      'risk-action': { columnId: 'risk-action', responsibility: 'receipt-only', state: 'unknown', label: 'Receipt unknown' },
    }),
  ];
  return workInput({
    scenarioId: 'risk',
    workId: sampleWorkIds.risk,
    title: 'Risk case coordination sample',
    goal: 'Coordinate one flagged risk case with named human control and an unknown external outcome',
    nextStep: 'Named approver decides the risk gate',
  }, actors, stages, relations, rows);
}

function devInput() {
  const actors = [
    actor('dev-owner', 'Product Owner', 'human', 'Initial requirement owner', 'own', 'Active'),
    actor('dev-agent', 'Development Agent', 'agent', 'Requirement analysis assistant', 'propose', 'Available'),
    actor('dev-reviewer', 'Development Reviewer', 'human', 'Requirement reviewer', 'observe', 'Active'),
    actor('dev-recipient', 'Tech Lead', 'human', 'Named handoff recipient', 'own', 'Active'),
    actor('dev-approver', 'Development Approver', 'human', 'Named development gate owner', 'approve', 'Active'),
    actor('dev-authorizer', 'Release Authorizer', 'human', 'Named release action authorizer', 'authorize', 'Active'),
    actor('dev-connector', 'Delivery Connector', 'system', 'Delivery connector', 'receipt-only', 'Failed'),
  ];
  const stages = [
    stage('dev-requirement', 'Requirement', 0, 'done', 'Requirement version is explicit', ['dev-owner', 'dev-agent']),
    stage('dev-review', 'Review and handoff', 1, 'current', 'Named recipient and gate control implementation', ['dev-recipient', 'dev-approver']),
    stage('dev-delivery', 'Delivery', 2, 'pending', 'Connector receipt records a failed delivery', ['dev-authorizer', 'dev-connector']),
  ];
  const relations = [
    relation('dev-owner-owns', 'dev-owner', { kind: 'work', id: sampleWorkIds.dev }, 'owns', 'active', 'Initial owner'),
    relation('dev-agent-assists', 'dev-agent', { kind: 'actor', id: 'dev-owner' }, 'assists', 'active', 'Analysis assistance'),
    relation('dev-reviewer-reviews', 'dev-reviewer', { kind: 'actor', id: 'dev-owner' }, 'reviews', 'active', 'Requirement review'),
  ];
  const rows = [
    matrixRow('dev-owner', stages, {
      'dev-requirement': { columnId: 'dev-requirement', responsibility: 'own', state: 'done', label: 'Owns goal version' },
      'dev-review': { columnId: 'dev-review', responsibility: 'prepare', state: 'done', label: 'Proposed handoff' },
    }),
    matrixRow('dev-agent', stages, {
      'dev-requirement': { columnId: 'dev-requirement', responsibility: 'assist', state: 'done', label: 'Produced artifact' },
      'dev-review': { columnId: 'dev-review', responsibility: 'review', state: 'pending', label: 'Proposal only' },
    }),
    matrixRow('dev-reviewer', stages, {
      'dev-requirement': { columnId: 'dev-requirement', responsibility: 'review', state: 'done', label: 'Raised review challenge' },
    }),
    matrixRow('dev-recipient', stages, {
      'dev-review': { columnId: 'dev-review', responsibility: 'own', state: 'active', label: 'Accepted named handoff' },
    }),
    matrixRow('dev-approver', stages, {
      'dev-review': { columnId: 'dev-review', responsibility: 'approve', state: 'active', label: 'Named gate owner' },
    }),
    matrixRow('dev-authorizer', stages, {
      'dev-delivery': { columnId: 'dev-delivery', responsibility: 'authorize', state: 'pending', label: 'Authorizes intent only' },
    }),
    matrixRow('dev-connector', stages, {
      'dev-delivery': { columnId: 'dev-delivery', responsibility: 'receipt-only', state: 'blocked', label: 'Failed receipt' },
    }),
  ];
  return workInput({
    scenarioId: 'dev',
    workId: sampleWorkIds.dev,
    title: 'Requirement development sample',
    goal: 'Turn one requirement change into a reviewed, accepted, and traceable delivery decision',
    nextStep: 'Named development approver decides the gate',
  }, actors, stages, relations, rows);
}

function interactionInput() {
  const actors = [
    actor('interaction-owner', 'Interaction Owner', 'human', 'Interaction work owner', 'own', 'Active'),
    actor('interaction-agent', 'Interaction Agent', 'agent', 'Explicitly invoked assistant', 'propose', 'Available'),
    actor('interaction-approver', 'Interaction Approver', 'human', 'Named interaction gate owner', 'approve', 'Needs evidence'),
  ];
  const stages = [
    stage('interaction-context', 'Context', 0, 'done', 'Normal message does not invoke an Agent', ['interaction-owner']),
    stage('interaction-run', 'Explicit run', 1, 'done', 'Explicit Agent runs produce proposals only on human request', ['interaction-owner', 'interaction-agent']),
    stage('interaction-gate', 'Human continuation', 2, 'current', 'Human gate requests evidence before continuation', ['interaction-owner', 'interaction-approver']),
  ];
  const relations = [
    relation('interaction-owner-owns', 'interaction-owner', { kind: 'work', id: sampleWorkIds.interaction }, 'owns', 'active', 'Owner'),
    relation('interaction-agent-assists', 'interaction-agent', { kind: 'actor', id: 'interaction-owner' }, 'assists', 'active', 'Runs only when explicit'),
    relation('interaction-approver-reviews', 'interaction-approver', { kind: 'actor', id: 'interaction-owner' }, 'reviews', 'active', 'Continuation gate'),
  ];
  const rows = [
    matrixRow('interaction-owner', stages, {
      'interaction-context': { columnId: 'interaction-context', responsibility: 'own', state: 'done', label: 'Sent normal message' },
      'interaction-run': { columnId: 'interaction-run', responsibility: 'prepare', state: 'done', label: 'Requested explicit run' },
      'interaction-gate': { columnId: 'interaction-gate', responsibility: 'prepare', state: 'active', label: 'Provides evidence' },
    }),
    matrixRow('interaction-agent', stages, {
      'interaction-run': { columnId: 'interaction-run', responsibility: 'assist', state: 'done', label: 'Explicit run on human request' },
      'interaction-gate': { columnId: 'interaction-gate', responsibility: 'challenge', state: 'pending', label: 'Proposal awaits human' },
    }),
    matrixRow('interaction-approver', stages, {
      'interaction-gate': { columnId: 'interaction-gate', responsibility: 'approve', state: 'blocked', label: 'Needs evidence' },
    }),
  ];
  return workInput({
    scenarioId: 'interaction',
    workId: sampleWorkIds.interaction,
    title: 'Human-agent interaction sample',
    goal: 'Continue an explicit human-agent interaction only after evidence is supplied',
    nextStep: 'Owner supplies the evidence requested by the named gate',
  }, actors, stages, relations, rows);
}

function executeSampleCommand(core, scenarioId, workId, index, actorId, type, payload, expectedProjectionVersion) {
  const result = core.executeCommand({
    workspaceId: sampleWorkspaceId,
    workId,
    actorId,
    command: {
      commandId: `${scenarioId}-sample-${index}`,
      idempotencyKey: `${scenarioId}-sample-${index}`,
      expectedProjectionVersion,
      type,
      payload,
    },
  });
  if (result.statusCode !== 200 || result.body?.accepted !== true) {
    throw new Error(`Sample command ${scenarioId}/${type} failed: ${JSON.stringify(result.body)}`);
  }
  return result.body.projection;
}

function appendSampleEvent(core, workId, type, actorId, title, body) {
  return core.appendSampleEvents({
    workspaceId: sampleWorkspaceId,
    workId,
    events: [{
      type,
      actorId,
      payload: {
        title,
        body,
        scope: { kind: 'work', id: workId },
        authoritative: false,
      },
    }],
  });
}

function seedRisk(core) {
  let projection = core.createWork(riskInput());
  projection = appendSampleEvent(
    core,
    sampleWorkIds.risk,
    'ArtifactRecorded',
    'risk-agent',
    'Evidence artifact recorded',
    'The sample evidence summary is replayed from Event storage and has no external truth claim.',
  );
  projection = executeSampleCommand(core, 'risk', sampleWorkIds.risk, 3, 'risk-agent', 'raise_challenge', {
    challengeId: 'risk-sample-challenge',
    title: 'One control question must be resolved before the gate',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'risk', sampleWorkIds.risk, 4, 'risk-owner', 'resolve_challenge', {
    challengeId: 'risk-sample-challenge',
    outcome: 'resolved',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'risk', sampleWorkIds.risk, 5, 'risk-approver', 'decide_gate', {
    gateId: 'risk-sample-gate',
    decision: 'approved',
    basis: 'The named approver reviewed the sample evidence artifact and resolved challenge',
    impact: 'Authorize one connector action intent without claiming its external outcome',
    responsibleActorId: 'risk-approver',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'risk', sampleWorkIds.risk, 6, 'risk-authorizer', 'create_action_intent', {
    actionIntentId: 'risk-sample-action',
    actionType: 'freeze-account',
    targetActorId: 'risk-connector',
    gateId: 'risk-sample-gate',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'risk', sampleWorkIds.risk, 7, 'risk-connector', 'record_receipt', {
    receiptId: 'risk-sample-receipt',
    status: 'unknown',
  }, projection.eventCursor);
  return projection;
}

function seedDev(core) {
  let projection = core.createWork(devInput());
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 2, 'dev-owner', 'update_goal', {
    goal: 'Deliver requirement v2 with a named handoff, human gate, and traceable failed receipt',
    nextStep: 'Reviewer resolves the requirement challenge',
  }, projection.eventCursor);
  projection = appendSampleEvent(
    core,
    sampleWorkIds.dev,
    'ArtifactRecorded',
    'dev-agent',
    'Requirement analysis artifact recorded',
    'The Agent records analysis as a non-authoritative sample artifact; humans retain decision authority.',
  );
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 4, 'dev-reviewer', 'raise_challenge', {
    challengeId: 'dev-sample-challenge',
    title: 'Acceptance criteria need one clarification',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 5, 'dev-owner', 'resolve_challenge', {
    challengeId: 'dev-sample-challenge',
    outcome: 'resolved',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 6, 'dev-owner', 'propose_handoff', {
    handoffRelationId: 'dev-sample-handoff',
    recipientActorId: 'dev-recipient',
    label: 'Named Tech Lead accepts implementation',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 7, 'dev-recipient', 'accept_handoff', {
    handoffRelationId: 'dev-sample-handoff',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 8, 'dev-approver', 'decide_gate', {
    gateId: 'dev-sample-gate',
    decision: 'approved',
    basis: 'The named approver reviewed goal v2, the Agent artifact, and the accepted handoff',
    impact: 'Authorize a traceable delivery attempt without treating failure as success',
    responsibleActorId: 'dev-approver',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 9, 'dev-authorizer', 'create_action_intent', {
    actionIntentId: 'dev-sample-action',
    actionType: 'dispatch-delivery',
    targetActorId: 'dev-connector',
    gateId: 'dev-sample-gate',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'dev', sampleWorkIds.dev, 10, 'dev-connector', 'record_receipt', {
    receiptId: 'dev-sample-receipt',
    status: 'failed',
  }, projection.eventCursor);
  return projection;
}

function seedInteraction(core) {
  let projection = core.createWork(interactionInput());
  projection = executeSampleCommand(core, 'interaction', sampleWorkIds.interaction, 2, 'interaction-owner', 'append_message', {
    body: 'This normal message intentionally creates zero Agent runs.',
  }, projection.eventCursor);
  projection = executeSampleCommand(core, 'interaction', sampleWorkIds.interaction, 3, 'interaction-owner', 'request_agent_run', {
    agentActorId: 'interaction-agent',
  }, projection.eventCursor);
  projection = appendSampleEvent(
    core,
    sampleWorkIds.interaction,
    'ProposalRecorded',
    'interaction-agent',
    'Interaction proposal recorded',
    'The explicitly invoked Agent proposes a continuation path and cites the evidence still required.',
  );
  projection = executeSampleCommand(core, 'interaction', sampleWorkIds.interaction, 5, 'interaction-approver', 'decide_gate', {
    gateId: 'interaction-sample-gate',
    decision: 'needs_evidence',
    basis: 'The proposal needs one missing usage trace before human continuation',
    impact: 'Pause continuation until the named owner supplies evidence',
    responsibleActorId: 'interaction-approver',
  }, projection.eventCursor);
  return projection;
}

function startsWith(values, prefix) {
  return values.length >= prefix.length && prefix.every((value, index) => values[index] === value);
}

function sampleConflict(message, details) {
  return new P1Error(409, 'INVALID_TRANSITION', `Sample Work fails its required terminal state: ${message}`, details);
}

function verifyRisk(projection) {
  const prefix = ['system', 'artifact', 'challenge', 'challenge', 'gate', 'action', 'receipt'];
  if (!startsWith(projection.activities.map((activity) => activity.type), prefix)) throw sampleConflict('Event chain diverges', {});
  if (projection.signals.gate?.state !== 'approved') throw sampleConflict('Risk Gate is not approved', {});
  if (!projection.signals.actionIntent) throw sampleConflict('Risk ActionIntent is missing', {});
  if (projection.signals.receipt?.status !== 'unknown') throw sampleConflict('Risk Receipt is not unknown', {});
  if (projection.work.status === 'completed') throw sampleConflict('Unknown Receipt completed the Work', {});
}

function verifyDev(projection) {
  const prefix = ['system', 'system', 'artifact', 'challenge', 'challenge', 'handoff', 'handoff', 'gate', 'action', 'receipt'];
  if (!startsWith(projection.activities.map((activity) => activity.type), prefix)) throw sampleConflict('Event chain diverges', {});
  if (projection.work.goalVersion < 2) throw sampleConflict('Development Goal version is missing', {});
  if (projection.work.ownerActorId !== 'dev-recipient') throw sampleConflict('Named handoff was not accepted', {});
  if (projection.signals.gate?.state !== 'approved') throw sampleConflict('Development Gate is not approved', {});
  if (projection.signals.receipt?.status !== 'failed') throw sampleConflict('Development Receipt is not failed', {});
  if (projection.work.status === 'completed') throw sampleConflict('Failed Receipt completed the Work', {});
}

function verifyInteraction(projection) {
  const types = projection.activities.map((activity) => activity.type);
  const prefix = ['system', 'message', 'system', 'artifact', 'gate'];
  if (!startsWith(types, prefix)) throw sampleConflict('Event chain diverges', {});
  const messageIndex = types.indexOf('message');
  const firstRun = projection.activities.findIndex((activity) => activity.title === 'Agent run requested');
  if (firstRun < 0 || messageIndex < 0 || messageIndex > firstRun) throw sampleConflict('Normal message preceded no explicit run', {});
  if (projection.signals.gate?.state !== 'needs_evidence') throw sampleConflict('Continuation Gate does not request evidence', {});
  if (projection.signals.receipt !== null) throw sampleConflict('Interaction must not claim an external Receipt', {});
}

const sampleVerifiers = {
  risk: verifyRisk,
  dev: verifyDev,
  interaction: verifyInteraction,
};

function verifySample(scenarioId, workId, projection) {
  if (projection.dataOrigin !== 'sample' || projection.fixture !== false) {
    throw sampleConflict('Work is not an Event-replayed sample', { workId });
  }
  if (projection.projectionIdentity.workspaceId !== sampleWorkspaceId || projection.projectionIdentity.workId !== workId) {
    throw sampleConflict('Work identity diverges', { workId });
  }
  if (projection.currentActorId !== projection.work.ownerActorId) {
    throw sampleConflict('currentActorId diverges from the owner operation context', { workId });
  }
  if (projection.scenario.id !== scenarioId) throw sampleConflict('Scenario identity diverges', { workId });
  assertWorkProjection(projection);
  sampleVerifiers[scenarioId](projection);
  return projection;
}

export function ensureSampleData(core) {
  const existing = new Map();
  for (const scenarioId of ['risk', 'dev', 'interaction']) {
    const workId = sampleWorkIds[scenarioId];
    let projection;
    try {
      projection = core.getProjection(sampleWorkspaceId, workId);
    } catch (error) {
      if (error instanceof P1Error && error.code === 'WORK_NOT_FOUND') {
        projection = scenarioId === 'risk' ? seedRisk(core) : scenarioId === 'dev' ? seedDev(core) : seedInteraction(core);
      } else {
        throw error;
      }
    }
    existing.set(scenarioId, verifySample(scenarioId, workId, projection));
  }
  return Object.freeze(existing);
}

export function selectProjectionView(projection, view) {
  if (!['relation', 'progress', 'matrix'].includes(view)) {
    throw new P1Error(400, 'VALIDATION_ERROR', 'view must be one of relation, progress, matrix', { field: 'view' });
  }
  assertWorkProjection(projection);
  if (projection.projectionVersion !== projection.eventCursor) {
    throw new P1Error(503, 'PROJECTION_UNAVAILABLE', 'Projection version and event cursor diverge', {});
  }
  const common = {
    schemaVersion: projection.schemaVersion,
    fixture: projection.fixture,
    dataOrigin: projection.dataOrigin,
    projectionIdentity: clone(projection.projectionIdentity),
    projectionVersion: projection.projectionVersion,
    eventCursor: projection.eventCursor,
    generatedAt: projection.generatedAt,
    scenario: clone(projection.scenario),
    currentActorId: projection.currentActorId,
    view,
  };
  let selected;
  if (view === 'relation') {
    selected = {
      actors: clone(projection.actors),
      work: clone(projection.work),
      relations: clone(projection.relations),
    };
  } else if (view === 'progress') {
    selected = {
      work: clone(projection.work),
      stages: clone(projection.stages),
      signals: clone(projection.signals),
    };
  } else {
    selected = {
      actors: clone(projection.actors),
      matrix: clone(projection.matrix),
    };
  }
  return deepFreeze({ ...common, ...selected });
}
