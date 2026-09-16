import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { P1Core } from '../src/core.mjs';
import { validateWorkProjection } from '../src/schema.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const testDataDirectory = join(testDirectory, '..', '.test-data', `core-${process.pid}`);
const databasePath = join(testDataDirectory, 'core.test.sqlite');

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

function matrixCell(columnId, responsibility, state, label) {
  return { columnId, responsibility, state, label };
}

function createWorkInput() {
  const actors = [
    { id: 'owner-human', name: 'Owner Human', type: 'human', role: 'Business owner', authority: 'own', state: 'Active' },
    { id: 'assistant-agent', name: 'Assistant Agent', type: 'agent', role: 'Evidence assistant', authority: 'propose', state: 'Available' },
    { id: 'gate-approver', name: 'Gate Approver', type: 'human', role: 'Risk approver', authority: 'approve', state: 'Active' },
    { id: 'action-authorizer', name: 'Action Authorizer', type: 'human', role: 'Action authorizer', authority: 'authorize', state: 'Active' },
    { id: 'risk-connector', name: 'Risk Connector', type: 'system', role: 'External connector', authority: 'receipt-only', state: 'Connected' },
  ];
  const stages = [
    { id: 'stage-evidence', name: 'Evidence', order: 0, state: 'done', detail: 'Evidence collected', responsibleActorIds: ['owner-human'], blockers: [] },
    { id: 'stage-review', name: 'Review', order: 1, state: 'current', detail: 'Human gate review', responsibleActorIds: ['gate-approver'], blockers: [] },
    { id: 'stage-action', name: 'Action', order: 2, state: 'pending', detail: 'External action pending', responsibleActorIds: ['action-authorizer'], blockers: [] },
  ];
  return {
    workspaceId: 'workspace-p1',
    workId: 'work-risk-001',
    scenario: { id: 'risk-cooperation', name: '风控业务协同', defaultView: 'relation' },
    dataOrigin: 'user',
    currentActorId: 'owner-human',
    work: {
      title: 'Risk case coordination',
      goal: 'Review the flagged transaction with named human control',
      ownerActorId: 'owner-human',
      nextStep: 'Prepare gate evidence',
    },
    actors,
    relations: [
      {
        id: 'relation-owns',
        source: { kind: 'actor', id: 'owner-human' },
        target: { kind: 'work', id: 'work-risk-001' },
        type: 'owns', state: 'active', label: 'Owner',
      },
      {
        id: 'relation-assists',
        source: { kind: 'actor', id: 'assistant-agent' },
        target: { kind: 'actor', id: 'owner-human' },
        type: 'assists', state: 'active', label: 'Evidence assistance',
      },
    ],
    stages,
    matrix: {
      columnKind: 'stage',
      columns: [
        { id: 'stage-evidence', label: 'Evidence' },
        { id: 'stage-review', label: 'Review' },
        { id: 'stage-action', label: 'Action' },
      ],
      rows: [
        {
          actorId: 'owner-human',
          cells: [
            matrixCell('stage-evidence', 'own', 'done', 'Collected'),
            matrixCell('stage-review', 'prepare', 'active', 'Prepared'),
            matrixCell('stage-action', 'observe', 'none', 'Observes'),
          ],
        },
        {
          actorId: 'assistant-agent',
          cells: [
            matrixCell('stage-evidence', 'assist', 'done', 'Assisted'),
            matrixCell('stage-review', 'review', 'pending', 'Reviews'),
            matrixCell('stage-action', 'none', 'none', 'Not involved'),
          ],
        },
      ],
    },
  };
}

function legacyInteractionSampleInput() {
  const input = createWorkInput();
  input.workspaceId = 'legacy-sample-workspace';
  input.workId = 'legacy-interaction-work';
  input.scenario = { id: 'interaction', name: '人机交互协同', defaultView: 'relation' };
  input.dataOrigin = 'sample';
  input.work.title = 'Legacy interaction sample';
  input.relations[0].target.id = input.workId;
  input.stages[1].id = 'interaction-run';
  input.stages[1].detail = 'One explicit Agent run produced a proposal';
  input.matrix.columns[1].id = 'interaction-run';
  for (const row of input.matrix.rows) row.cells[1].columnId = 'interaction-run';
  input.matrix.rows.find((row) => row.actorId === 'assistant-agent').cells[1].label = 'One explicit run';
  for (const relation of input.relations) {
    for (const endpoint of [relation.source, relation.target]) {
      if (endpoint.kind === 'actor' && endpoint.id === 'assistant-agent') endpoint.id = 'interaction-agent';
    }
  }
  input.actors.find((actor) => actor.id === 'assistant-agent').id = 'interaction-agent';
  input.matrix.rows.find((row) => row.actorId === 'assistant-agent').actorId = 'interaction-agent';
  return input;
}

test('legacy interaction sample copy is normalized during Event-only replay', () => {
  const core = new P1Core({ dbPath: ':memory:' });
  try {
    const created = core.createWork(legacyInteractionSampleInput());
    const replayed = core.replayProjection('legacy-sample-workspace', 'legacy-interaction-work');
    assert.deepEqual(replayed, created);
    assert.equal(
      replayed.stages.find((stage) => stage.id === 'interaction-run').detail,
      'Explicit Agent runs produce proposals only on human request',
    );
    assert.equal(
      replayed.matrix.rows.find((row) => row.actorId === 'interaction-agent')
        .cells.find((cell) => cell.columnId === 'interaction-run').label,
      'Explicit run on human request',
    );
    assert.equal(replayed.currentActorId, replayed.work.ownerActorId);
  } finally {
    core.close();
  }
});

test('P1 core persists events and enforces projection command policy', () => {
  rmSync(testDataDirectory, { recursive: true, force: true });
  let timeTick = 0;
  let idTick = 0;
  let core;
  let commandTick = 0;

  function nextCommand(type, payload, expectedProjectionVersion, keyOverride) {
    commandTick += 1;
    return {
      commandId: `cmd-${commandTick}`,
      idempotencyKey: keyOverride ?? `key-${commandTick}`,
      expectedProjectionVersion,
      type,
      payload,
    };
  }

  function execute(actorId, command) {
    return core.executeCommand({
      workspaceId: 'workspace-p1',
      workId: 'work-risk-001',
      actorId,
      command,
    });
  }

  function checkProjection(projection) {
    const validation = validateWorkProjection(projection);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    assert.equal(projection.projectionVersion, projection.eventCursor);
    assert.equal(projection.fixture, false);
  }

  function runCount(projection) {
    return projection.activities.filter((activity) => activity.type === 'system' && activity.title === 'Agent run requested').length;
  }

  function assertOwnerContext(projection, expectedActorId) {
    assert.equal(projection.currentActorId, expectedActorId);
    assert.equal(projection.currentActorId, projection.work.ownerActorId);
  }

  function assertRejectedAtVersion(response, statusCode, code, projection) {
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.body.error.code, code);
    assert.deepEqual(core.getProjection('workspace-p1', 'work-risk-001'), projection);
  }

  try {
    core = new P1Core({
      dbPath: databasePath,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++timeTick)).toISOString(),
      idFactory: () => `generated-${++idTick}`,
    });
    const created = core.createWork(createWorkInput());
    checkProjection(created);
    assert.equal(created.projectionVersion, 1);
    assert.equal(created.eventCursor, 1);
    assert.equal(created.work.goalVersion, 1);
    assert.equal(created.work.status, 'active');
    assertOwnerContext(created, 'owner-human');
    assert.deepEqual(core.listWorks('workspace-p1'), [{
      workspaceId: 'workspace-p1',
      workId: 'work-risk-001',
      scenarioId: 'risk-cooperation',
      title: 'Risk case coordination',
      status: 'active',
      ownerActorId: 'owner-human',
      projectionVersion: 1,
      eventCursor: 1,
      updatedAt: '2026-01-01T00:00:01.000Z',
    }]);
    let duplicateWorkError;
    assert.throws(() => core.createWork(createWorkInput()), (error) => {
      duplicateWorkError = error;
      return true;
    });
    assert.equal(duplicateWorkError.statusCode, 409);
    assert.equal(duplicateWorkError.code, 'INVALID_TRANSITION');
    assert.equal(duplicateWorkError.message, 'Work already exists');
    assert.deepEqual(duplicateWorkError.details, { workspaceId: 'workspace-p1', workId: 'work-risk-001' });
    const unchangedAfterDuplicateWork = core.getProjection('workspace-p1', 'work-risk-001');
    assert.deepEqual(unchangedAfterDuplicateWork, created);
    assert.equal(unchangedAfterDuplicateWork.projectionVersion, 1);
    assert.equal(unchangedAfterDuplicateWork.eventCursor, 1);

    const beforeReopen = core.getProjection('workspace-p1', 'work-risk-001');
    const replayedBeforeReopen = core.replayProjection('workspace-p1', 'work-risk-001');
    assert.deepEqual(replayedBeforeReopen, beforeReopen);
    core.close();
    core = new P1Core({
      dbPath: databasePath,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++timeTick)).toISOString(),
      idFactory: () => `generated-${++idTick}`,
    });
    const afterReopen = core.getProjection('workspace-p1', 'work-risk-001');
    assert.deepEqual(afterReopen, beforeReopen);
    assert.deepEqual(core.replayProjection('workspace-p1', 'work-risk-001'), afterReopen);

    const messageCommand = nextCommand('append_message', { body: 'A normal human message does not invoke an agent.' }, 1, 'message-once');
    const firstMessage = execute('owner-human', messageCommand);
    assert.equal(firstMessage.statusCode, 200);
    assert.equal(firstMessage.body.accepted, true);
    assert.equal(firstMessage.body.eventIds.length, 1);
    checkProjection(firstMessage.body.projection);
    assert.equal(firstMessage.body.projection.projectionVersion, 2);
    assert.equal(runCount(firstMessage.body.projection), 0);
    assertOwnerContext(firstMessage.body.projection, 'owner-human');
    const replayedMessage = execute('owner-human', messageCommand);
    assert.equal(replayedMessage.statusCode, 200);
    assert.deepEqual(replayedMessage.body, firstMessage.body);
    assert.equal(core.getProjection('workspace-p1', 'work-risk-001').projectionVersion, 2);
    const changedMessage = { ...messageCommand, payload: { body: 'Different normalized request.' } };
    assertRejectedAtVersion(execute('owner-human', changedMessage), 409, 'IDEMPOTENCY_CONFLICT', firstMessage.body.projection);
    const versionConflict = nextCommand('append_message', { body: 'Stale request.' }, 999);
    assertRejectedAtVersion(execute('owner-human', versionConflict), 409, 'PROJECTION_VERSION_CONFLICT', firstMessage.body.projection);

    const runCommand = nextCommand('request_agent_run', { agentActorId: 'assistant-agent' }, 2, 'explicit-run-once');
    const firstRun = execute('owner-human', runCommand);
    assert.equal(firstRun.statusCode, 200);
    checkProjection(firstRun.body.projection);
    assert.equal(firstRun.body.projection.projectionVersion, 3);
    assert.equal(runCount(firstRun.body.projection), 1);
    assertOwnerContext(firstRun.body.projection, 'owner-human');
    assert.deepEqual(execute('owner-human', runCommand).body, firstRun.body);
    const secondRun = nextCommand('request_agent_run', { agentActorId: 'assistant-agent' }, 3, 'explicit-run-again');
    const secondRunAccepted = execute('owner-human', secondRun);
    assert.equal(secondRunAccepted.statusCode, 200);
    assert.equal(secondRunAccepted.body.eventIds.length, 1);
    checkProjection(secondRunAccepted.body.projection);
    assert.equal(secondRunAccepted.body.projection.projectionVersion, 4);
    assert.equal(runCount(secondRunAccepted.body.projection), 2);
    assertOwnerContext(secondRunAccepted.body.projection, 'owner-human');

    const handoff = nextCommand('propose_handoff', {
      handoffRelationId: 'relation-handoff-001',
      recipientActorId: 'assistant-agent',
      label: 'Transfer ownership after evidence preparation',
    }, 4);
    const proposed = execute('owner-human', handoff);
    assert.equal(proposed.statusCode, 200);
    checkProjection(proposed.body.projection);
    assert.equal(proposed.body.projection.work.ownerActorId, 'owner-human');
    assertOwnerContext(proposed.body.projection, 'owner-human');
    const proposedRelation = proposed.body.projection.relations.find((relation) => relation.id === 'relation-handoff-001');
    assert.equal(proposedRelation.state, 'pending');
    const nonRecipientAccept = nextCommand('accept_handoff', { handoffRelationId: 'relation-handoff-001' }, 5);
    assertRejectedAtVersion(execute('owner-human', nonRecipientAccept), 403, 'AUTHORITY_DENIED', proposed.body.projection);
    const recipientAccept = nextCommand('accept_handoff', { handoffRelationId: 'relation-handoff-001' }, 5);
    const accepted = execute('assistant-agent', recipientAccept);
    assert.equal(accepted.statusCode, 200);
    checkProjection(accepted.body.projection);
    assert.equal(accepted.body.projection.work.ownerActorId, 'assistant-agent');
    assertOwnerContext(accepted.body.projection, 'assistant-agent');

    const goalUpdate = nextCommand('update_goal', {
      goal: 'Complete named gate review and external receipt',
      nextStep: 'Request explicit gate review',
    }, 6);
    const goalUpdated = execute('assistant-agent', goalUpdate);
    assert.equal(goalUpdated.statusCode, 200);
    checkProjection(goalUpdated.body.projection);
    assert.equal(goalUpdated.body.projection.work.goalVersion, 2);
    assert.equal(goalUpdated.body.projection.work.goal, 'Complete named gate review and external receipt');
    assertOwnerContext(goalUpdated.body.projection, 'assistant-agent');

    const challenge = nextCommand('raise_challenge', {
      challengeId: 'challenge-001',
      title: 'Evidence requires one clarification',
    }, 7);
    const challengeRaised = execute('assistant-agent', challenge);
    assert.equal(challengeRaised.statusCode, 200);
    checkProjection(challengeRaised.body.projection);
    assert.equal(challengeRaised.body.projection.work.status, 'blocked');
    const challengeResolution = nextCommand('resolve_challenge', {
      challengeId: 'challenge-001',
      outcome: 'resolved',
    }, 8);
    const challengeResolved = execute('assistant-agent', challengeResolution);
    assert.equal(challengeResolved.statusCode, 200);
    checkProjection(challengeResolved.body.projection);
    assert.equal(challengeResolved.body.projection.signals.challenges[0].state, 'resolved');
    assert.equal(challengeResolved.body.projection.work.status, 'active');

    const nonResponsibleGate = nextCommand('decide_gate', {
      gateId: 'gate-001',
      decision: 'approved',
      basis: 'Claimed sufficient evidence',
      impact: 'Dispatch external action',
      responsibleActorId: 'gate-approver',
    }, 9);
    assertRejectedAtVersion(execute('owner-human', nonResponsibleGate), 403, 'AUTHORITY_DENIED', challengeResolved.body.projection);
    const actionBeforeGate = nextCommand('create_action_intent', {
      actionIntentId: 'action-001',
      actionType: 'freeze-account',
      targetActorId: 'risk-connector',
      gateId: 'gate-001',
    }, 9);
    assertRejectedAtVersion(execute('action-authorizer', actionBeforeGate), 409, 'INVALID_TRANSITION', challengeResolved.body.projection);
    const gateDecision = nextCommand('decide_gate', {
      gateId: 'gate-001',
      decision: 'approved',
      basis: 'Named reviewer verified the evidence and controls',
      impact: 'One external account freeze is authorized',
      responsibleActorId: 'gate-approver',
    }, 9);
    const gateApproved = execute('gate-approver', gateDecision);
    assert.equal(gateApproved.statusCode, 200);
    checkProjection(gateApproved.body.projection);
    assert.equal(gateApproved.body.projection.signals.gate.state, 'approved');
    assert.equal(gateApproved.body.projection.signals.actionIntent, null);
    assertOwnerContext(gateApproved.body.projection, 'assistant-agent');

    const actionByNonAuthorizer = nextCommand('create_action_intent', {
      actionIntentId: 'action-001',
      actionType: 'freeze-account',
      targetActorId: 'risk-connector',
      gateId: 'gate-001',
    }, 10);
    assertRejectedAtVersion(execute('assistant-agent', actionByNonAuthorizer), 403, 'AUTHORITY_DENIED', gateApproved.body.projection);
    const actionIntent = nextCommand('create_action_intent', {
      actionIntentId: 'action-001',
      actionType: 'freeze-account',
      targetActorId: 'risk-connector',
      gateId: 'gate-001',
    }, 10);
    const actionCreated = execute('action-authorizer', actionIntent);
    assert.equal(actionCreated.statusCode, 200);
    checkProjection(actionCreated.body.projection);
    assert.equal(actionCreated.body.projection.signals.actionIntent.state, 'created');
    assert.equal(actionCreated.body.projection.signals.receipt, null);
    assertOwnerContext(actionCreated.body.projection, 'assistant-agent');

    const wrongReceiptActor = nextCommand('record_receipt', {
      receiptId: 'receipt-001',
      status: 'succeeded',
    }, 11);
    assertRejectedAtVersion(execute('owner-human', wrongReceiptActor), 403, 'AUTHORITY_DENIED', actionCreated.body.projection);
    const unknownReceiptCommand = nextCommand('record_receipt', {
      receiptId: 'receipt-001',
      status: 'unknown',
    }, 11, 'receipt-unknown-once');
    const unknownReceipt = execute('risk-connector', unknownReceiptCommand);
    assert.equal(unknownReceipt.statusCode, 200);
    checkProjection(unknownReceipt.body.projection);
    assert.equal(unknownReceipt.body.projection.signals.receipt.status, 'unknown');
    assert.notEqual(unknownReceipt.body.projection.work.status, 'completed');
    assertOwnerContext(unknownReceipt.body.projection, 'assistant-agent');
    assert.deepEqual(execute('risk-connector', unknownReceiptCommand).body, unknownReceipt.body);
    const reinterpretUnknown = nextCommand('record_receipt', {
      receiptId: 'receipt-002',
      status: 'succeeded',
    }, 12);
    assertRejectedAtVersion(execute('risk-connector', reinterpretUnknown), 409, 'INVALID_TRANSITION', unknownReceipt.body.projection);
    assert.equal(core.getProjection('workspace-p1', 'work-risk-001').signals.receipt.status, 'unknown');
    assert.equal(runCount(core.getProjection('workspace-p1', 'work-risk-001')), 2);

    const missingActor = core.executeCommand({
      workspaceId: 'workspace-p1',
      workId: 'work-risk-001',
      actorId: '',
      command: nextCommand('append_message', { body: 'Missing actor.' }, 12),
    });
    assert.equal(missingActor.statusCode, 401);
    assert.equal(missingActor.body.error.code, 'ACTOR_REQUIRED');
    assert.equal(core.getProjection('workspace-p1', 'work-risk-001').projectionVersion, 12);
  } finally {
    core?.close();
    rmSync(testDataDirectory, { recursive: true, force: true });
  }
});
