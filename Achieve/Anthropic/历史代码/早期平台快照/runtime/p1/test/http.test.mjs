import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createP1HttpApp } from '../src/server.mjs';
import {
  ensureSampleData,
  sampleWorkspaceId,
  sampleWorkIds,
  scenarioCatalog,
  selectProjectionView,
} from '../src/scenarios.mjs';
import { validateWorkProjection } from '../src/schema.mjs';

const testRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.test-data');
const testDirectory = join(testRoot, `http-${process.pid}`);
const databasePath = join(testDirectory, 'http.sqlite');

function assertValidProjection(projection) {
  const validation = validateWorkProjection(projection);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(projection.schemaVersion, 'work-projection.v1');
  assert.equal(projection.fixture, false);
  assert.equal(projection.projectionVersion, projection.eventCursor);
  assert.equal(projection.activities.length, projection.eventCursor);
}

function assertErrorShape(body, code) {
  assert.equal(typeof body?.error?.code, 'string');
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.ok(body.error.message.length > 0);
  assert.equal(typeof body.error.details, 'object');
  assert.notEqual(body.error.details, null);
}

async function startApp(dbPath) {
  const app = createP1HttpApp({ dbPath, seedSamples: true });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  const address = app.server.address();
  app.baseUrl = `http://127.0.0.1:${address.port}`;
  return app;
}

async function requestJson(app, path, options = {}) {
  const response = await fetch(`${app.baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body, text };
}

function jsonInit(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function commandEnvelope(commandId, expectedProjectionVersion, type, payload) {
  return { commandId, idempotencyKey: commandId, expectedProjectionVersion, type, payload };
}

function explicitRunCount(projection) {
  return projection.activities.filter((activity) => activity.title === 'Agent run requested').length;
}

function newUserWork(workspaceId) {
  const workId = `user-http-${process.pid}`;
  const actors = [{
    id: 'http-owner',
    name: 'HTTP Owner',
    type: 'human',
    role: 'Work owner',
    authority: 'own',
    state: 'Active',
  }, {
    id: 'http-approver',
    name: 'HTTP Approver',
    type: 'human',
    role: 'Named gate owner',
    authority: 'approve',
    state: 'Active',
  }, {
    id: 'http-authorizer',
    name: 'HTTP Authorizer',
    type: 'human',
    role: 'Named action authorizer',
    authority: 'authorize',
    state: 'Active',
  }, {
    id: 'http-connector',
    name: 'HTTP Connector',
    type: 'system',
    role: 'External connector',
    authority: 'receipt-only',
    state: 'Unknown',
  }];
  const stages = [{
    id: 'http-stage',
    name: 'Input',
    order: 0,
    state: 'current',
    detail: 'Initial user-created work',
    responsibleActorIds: ['http-owner', 'http-approver'],
    blockers: [],
  }];
  return {
    workspaceId,
    workId,
    scenario: {
      id: 'risk',
      name: '风控业务协同',
      defaultView: 'progress',
    },
    dataOrigin: 'user',
    currentActorId: 'http-owner',
    work: {
      title: 'HTTP user work',
      goal: 'Verify that user Work creation writes its first Event',
      ownerActorId: 'http-owner',
      nextStep: 'Append follow-up context',
    },
    actors,
    relations: [{
      id: 'http-owner-owns',
      source: { kind: 'actor', id: 'http-owner' },
      target: { kind: 'work', id: workId },
      type: 'owns',
      state: 'active',
      label: 'Owner',
    }],
    stages,
    matrix: {
      columnKind: 'stage',
      columns: [{ id: 'http-stage', label: 'Input' }],
      rows: [{
        actorId: 'http-owner',
        cells: [{
          columnId: 'http-stage',
          responsibility: 'own',
          state: 'active',
          label: 'Owns input',
        }],
      }],
    },
  };
}

test('P1 HTTP exposes replayed samples, selectors, restart consistency, and frozen failures', async () => {
  mkdirSync(testDirectory, { recursive: true });
  let app;
  try {
    app = await startApp(databasePath);

    const expectedCatalog = [
      ['risk', '风控业务协同', 'progress', 'active'],
      ['dev', '需求开发协同', 'progress', 'active'],
      ['interaction', '人机交互协同', 'relation', 'active'],
      ['content', '内容生产协同', 'progress', 'catalog-only'],
      ['growth', '经营增长协同', 'matrix', 'catalog-only'],
      ['embodied', '物理智能协同', 'relation', 'catalog-only'],
      ['knowledge', '知识办公协同', 'progress', 'catalog-only'],
      ['service', '客户服务协同', 'progress', 'catalog-only'],
      ['supply-chain', '供应链履约协同', 'matrix', 'catalog-only'],
      ['healthcare', '医疗服务协同', 'progress', 'catalog-only'],
    ];
    assert.deepEqual(scenarioCatalog.map((item) => [
      item.scenarioId, item.name, item.defaultView, item.runtimeAvailability,
    ]), expectedCatalog);
    const scenariosResponse = await requestJson(app, '/api/v1/scenarios');
    assert.equal(scenariosResponse.response.status, 200);
    assert.equal(scenariosResponse.response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(scenariosResponse.body, scenarioCatalog);
    assert.equal(scenariosResponse.body.length, 10);

    const health = await requestJson(app, '/health');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: 'ok', storage: 'readable' });

    const workList = await requestJson(app, `/api/v1/workspaces/${sampleWorkspaceId}/works`);
    assert.equal(workList.response.status, 200);
    assert.equal(Array.isArray(workList.body), true);
    assert.equal(workList.body.length, 3);
    const riskList = await requestJson(app, `/api/v1/workspaces/${sampleWorkspaceId}/works?scenarioId=risk`);
    assert.equal(riskList.response.status, 200);
    assert.deepEqual(riskList.body.map((item) => item.workId), [sampleWorkIds.risk]);

    const projections = new Map();
    for (const scenarioId of ['risk', 'dev', 'interaction']) {
      const workId = sampleWorkIds[scenarioId];
      const result = await requestJson(app, `/api/v1/workspaces/${sampleWorkspaceId}/works/${workId}/projection`);
      assert.equal(result.response.status, 200);
      assertValidProjection(result.body);
      assert.equal(result.body.dataOrigin, 'sample');
      assert.equal(result.body.projectionIdentity.workspaceId, sampleWorkspaceId);
      assert.equal(result.body.projectionIdentity.workId, workId);
      assert.equal(result.body.scenario.id, scenarioId);
      projections.set(scenarioId, result.body);
    }

    const risk = projections.get('risk');
    assert.deepEqual(risk.activities.map((activity) => activity.type), [
      'system', 'artifact', 'challenge', 'challenge', 'gate', 'action', 'receipt',
    ]);
    assert.equal(risk.signals.gate.state, 'approved');
    assert.equal(risk.signals.receipt.status, 'unknown');
    assert.notEqual(risk.work.status, 'completed');
    assert.equal(risk.currentActorId, risk.work.ownerActorId);
    assert.equal(risk.currentActorId, 'risk-owner');
    assert.ok(risk.availableCommands.some((command) => command.type === 'append_message'));

    const dev = projections.get('dev');
    assert.deepEqual(dev.activities.map((activity) => activity.type), [
      'system', 'system', 'artifact', 'challenge', 'challenge', 'handoff', 'handoff', 'gate', 'action', 'receipt',
    ]);
    assert.equal(dev.work.goalVersion, 2);
    assert.equal(dev.work.ownerActorId, 'dev-recipient');
    assert.equal(dev.signals.receipt.status, 'failed');
    assert.notEqual(dev.work.status, 'completed');
    assert.equal(dev.currentActorId, dev.work.ownerActorId);
    assert.equal(dev.currentActorId, 'dev-recipient');

    const interaction = projections.get('interaction');
    assert.deepEqual(interaction.activities.map((activity) => activity.type), [
      'system', 'message', 'system', 'artifact', 'gate',
    ]);
    const runActivities = interaction.activities.filter((activity) => activity.title === 'Agent run requested');
    assert.equal(runActivities.length, 1);
    assert.ok(interaction.activities.findIndex((activity) => activity.type === 'message') <
      interaction.activities.findIndex((activity) => activity.title === 'Agent run requested'));
    assert.equal(interaction.signals.gate.state, 'needs_evidence');
    assert.equal(interaction.signals.receipt, null);
    assert.equal(interaction.currentActorId, interaction.work.ownerActorId);
    assert.equal(interaction.currentActorId, 'interaction-owner');
    const fixedRunCountPattern = /\b(one|exactly one)\b/i;
    for (const item of interaction.stages) {
      assert.equal(fixedRunCountPattern.test(item.detail), false, item.detail);
    }
    for (const row of interaction.matrix.rows) {
      for (const cell of row.cells) {
        assert.equal(fixedRunCountPattern.test(cell.label), false, cell.label);
      }
    }

    const interactionAfterSeed = structuredClone(interaction);
    const runCountAfterSeed = explicitRunCount(interactionAfterSeed);
    assert.ok(runCountAfterSeed >= 1);

    const interactionAppend = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/commands`,
      {
        ...jsonInit(commandEnvelope(
          `http-interaction-append-${process.pid}`,
          interactionAfterSeed.projectionVersion,
          'append_message',
          { body: 'A normal follow-up message must not implicitly create an Agent run.' },
        )),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'interaction-owner',
        },
      },
    );
    assert.equal(interactionAppend.response.status, 200);
    assert.equal(interactionAppend.body.accepted, true);
    assert.equal(interactionAppend.body.eventIds.length, 1);
    assert.equal(
      interactionAppend.body.projection.projectionVersion,
      interactionAfterSeed.projectionVersion + 1,
    );
    assert.equal(
      interactionAppend.body.projection.activities.length,
      interactionAfterSeed.activities.length + 1,
    );
    assert.equal(explicitRunCount(interactionAppend.body.projection), runCountAfterSeed);
    assert.equal(interactionAppend.body.projection.currentActorId, 'interaction-owner');
    assertValidProjection(interactionAppend.body.projection);

    const afterInteractionAppend = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/projection`,
    );
    assert.equal(afterInteractionAppend.response.status, 200);
    assert.deepEqual(afterInteractionAppend.body, interactionAppend.body.projection);

    const secondRunCommand = commandEnvelope(
      `http-interaction-second-run-${process.pid}`,
      afterInteractionAppend.body.projectionVersion,
      'request_agent_run',
      { agentActorId: 'interaction-agent' },
    );
    const secondRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/commands`,
      {
        ...jsonInit(secondRunCommand),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'interaction-owner',
        },
      },
    );
    assert.equal(secondRun.response.status, 200);
    assert.equal(secondRun.body.accepted, true);
    assert.equal(secondRun.body.eventIds.length, 1);
    assert.equal(
      secondRun.body.projection.projectionVersion,
      afterInteractionAppend.body.projectionVersion + 1,
    );
    assert.equal(
      secondRun.body.projection.activities.length,
      afterInteractionAppend.body.activities.length + 1,
    );
    assert.equal(explicitRunCount(secondRun.body.projection), runCountAfterSeed + 1);
    assert.equal(secondRun.body.projection.currentActorId, 'interaction-owner');
    assertValidProjection(secondRun.body.projection);

    const afterSecondRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/projection`,
    );
    assert.equal(afterSecondRun.response.status, 200);
    assert.deepEqual(afterSecondRun.body, secondRun.body.projection);

    const replayedSecondRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/commands`,
      {
        ...jsonInit(secondRunCommand),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'interaction-owner',
        },
      },
    );
    assert.equal(replayedSecondRun.response.status, 200);
    assert.equal(replayedSecondRun.text, secondRun.text);
    assert.deepEqual(replayedSecondRun.body, secondRun.body);

    const stableAfterReplay = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/projection`,
    );
    assert.equal(stableAfterReplay.response.status, 200);
    assert.deepEqual(stableAfterReplay.body, afterSecondRun.body);
    assert.equal(
      stableAfterReplay.body.projectionVersion,
      afterSecondRun.body.projectionVersion,
    );
    assert.equal(stableAfterReplay.body.eventCursor, afterSecondRun.body.eventCursor);
    assert.equal(
      stableAfterReplay.body.activities.length,
      afterSecondRun.body.activities.length,
    );
    assert.equal(explicitRunCount(stableAfterReplay.body), explicitRunCount(afterSecondRun.body));

    const thirdRunCommand = commandEnvelope(
      `http-interaction-third-run-${process.pid}`,
      stableAfterReplay.body.projectionVersion,
      'request_agent_run',
      { agentActorId: 'interaction-agent' },
    );
    const thirdRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/commands`,
      {
        ...jsonInit(thirdRunCommand),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'interaction-owner',
        },
      },
    );
    assert.equal(thirdRun.response.status, 200);
    assert.equal(thirdRun.body.accepted, true);
    assert.equal(thirdRun.body.eventIds.length, 1);
    assert.equal(
      thirdRun.body.projection.projectionVersion,
      stableAfterReplay.body.projectionVersion + 1,
    );
    assert.equal(explicitRunCount(thirdRun.body.projection), explicitRunCount(stableAfterReplay.body) + 1);
    assert.equal(thirdRun.body.projection.currentActorId, 'interaction-owner');
    assertValidProjection(thirdRun.body.projection);

    const replayedThirdRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/commands`,
      {
        ...jsonInit(thirdRunCommand),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'interaction-owner',
        },
      },
    );
    assert.equal(replayedThirdRun.response.status, 200);
    assert.equal(replayedThirdRun.text, thirdRun.text);
    assert.deepEqual(replayedThirdRun.body, thirdRun.body);

    const stableAfterThirdRun = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/projection`,
    );
    assert.equal(stableAfterThirdRun.response.status, 200);
    assert.deepEqual(stableAfterThirdRun.body, thirdRun.body.projection);
    assert.equal(explicitRunCount(stableAfterThirdRun.body), explicitRunCount(thirdRun.body.projection));

    projections.set('interaction', stableAfterThirdRun.body);
    for (const view of ['relation', 'progress', 'matrix']) {
      const selected = selectProjectionView(risk, view);
      assert.equal(selected.projectionIdentity.workspaceId, risk.projectionIdentity.workspaceId);
      assert.equal(selected.projectionIdentity.workId, risk.projectionIdentity.workId);
      assert.equal(selected.projectionVersion, risk.projectionVersion);
      assert.equal(selected.eventCursor, risk.eventCursor);
      assert.equal(selected.generatedAt, risk.generatedAt);
      assert.equal(selected.view, view);
    }

    const beforeRestart = new Map([...projections].map(([key, value]) => [key, structuredClone(value)]));
    await app.close();
    app = await startApp(databasePath);
    for (const scenarioId of ['risk', 'dev', 'interaction']) {
      const result = await requestJson(
        app,
        `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds[scenarioId]}/projection`,
      );
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, beforeRestart.get(scenarioId));
    }

    const ensuredSamples = ensureSampleData(app.core);
    for (const scenarioId of ['risk', 'dev', 'interaction']) {
      const snapshot = ensuredSamples.get(scenarioId);
      assert.deepEqual(snapshot, beforeRestart.get(scenarioId));
      assert.equal(snapshot.projectionVersion, snapshot.eventCursor);
      assert.equal(snapshot.activities.length, snapshot.eventCursor);
      assert.equal(snapshot.currentActorId, snapshot.work.ownerActorId);
    }
    assert.equal(
      explicitRunCount(ensuredSamples.get('interaction')),
      explicitRunCount(beforeRestart.get('interaction')),
    );

    const restartedInteraction = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.interaction}/projection`,
    );
    assert.equal(restartedInteraction.response.status, 200);
    assert.deepEqual(restartedInteraction.body, beforeRestart.get('interaction'));
    assert.equal(restartedInteraction.body.projectionVersion, stableAfterThirdRun.body.projectionVersion);
    assert.equal(restartedInteraction.body.eventCursor, stableAfterThirdRun.body.eventCursor);
    assert.equal(restartedInteraction.body.activities.length, stableAfterThirdRun.body.activities.length);
    assert.equal(explicitRunCount(restartedInteraction.body), explicitRunCount(stableAfterThirdRun.body));

    const currentRisk = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/projection`,
    );
    const append = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/commands`,
      {
        ...jsonInit(commandEnvelope(
          `http-append-${process.pid}`,
          currentRisk.body.projectionVersion,
          'append_message',
          { body: 'HTTP appends one ordinary human message.' },
        )),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'risk-owner',
        },
      },
    );
    assert.equal(append.response.status, 200);
    assert.equal(append.body.accepted, true);
    assert.equal(append.body.eventIds.length, 1);
    assert.equal(append.body.projection.projectionVersion, currentRisk.body.projectionVersion + 1);
    assertValidProjection(append.body.projection);
    const afterAppend = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/projection`,
    );
    assert.deepEqual(afterAppend.body, append.body.projection);

    const versionBeforeFailures = afterAppend.body.projectionVersion;
    const missingActor = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/commands`,
      jsonInit(commandEnvelope('http-missing-actor', versionBeforeFailures, 'append_message', {
        body: 'Must fail without an actor.',
      })),
    );
    assert.equal(missingActor.response.status, 401);
    assertErrorShape(missingActor.body, 'ACTOR_REQUIRED');

    const unknownActor = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/commands`,
      {
        ...jsonInit(commandEnvelope('http-unknown-actor', versionBeforeFailures, 'append_message', {
          body: 'Must fail for an unknown actor.',
        })),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'not-in-this-work',
        },
      },
    );
    assert.equal(unknownActor.response.status, 401);
    assertErrorShape(unknownActor.body, 'ACTOR_REQUIRED');

    const stale = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/commands`,
      {
        ...jsonInit(commandEnvelope('http-stale-version', versionBeforeFailures - 1, 'append_message', {
          body: 'Must fail on a stale projection version.',
        })),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Actor-Id': 'risk-owner',
        },
      },
    );
    assert.equal(stale.response.status, 409);
    assertErrorShape(stale.body, 'PROJECTION_VERSION_CONFLICT');

    const unchanged = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/projection`,
    );
    assert.equal(unchanged.body.projectionVersion, versionBeforeFailures);
    assert.equal(unchanged.body.eventCursor, versionBeforeFailures);

    const notFound = await requestJson(app, `/api/v1/workspaces/${sampleWorkspaceId}/works/missing-work/projection`);
    assert.equal(notFound.response.status, 404);
    assertErrorShape(notFound.body, 'WORK_NOT_FOUND');

    const badJson = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works/${sampleWorkIds.risk}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Actor-Id': 'risk-owner' },
        body: '{invalid',
      },
    );
    assert.equal(badJson.response.status, 400);
    assertErrorShape(badJson.body, 'VALIDATION_ERROR');

    const wrongContentType = await requestJson(
      app,
      `/api/v1/workspaces/${sampleWorkspaceId}/works`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Actor-Id': 'http-owner' },
        body: '{}',
      },
    );
    assert.equal(wrongContentType.response.status, 400);
    assertErrorShape(wrongContentType.body, 'VALIDATION_ERROR');

    const userWorkspace = `user-workspace-${process.pid}`;
    const createBody = newUserWork(userWorkspace);
    const unknownFieldBody = { ...createBody, unexpectedField: 'not-allowed' };
    const unknownField = await requestJson(app, `/api/v1/workspaces/${userWorkspace}/works`, {
      ...jsonInit(unknownFieldBody),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-owner',
      },
    });
    assert.equal(unknownField.response.status, 400);
    assertErrorShape(unknownField.body, 'VALIDATION_ERROR');

    const created = await requestJson(app, `/api/v1/workspaces/${userWorkspace}/works`, {
      ...jsonInit(createBody),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-owner',
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.accepted, true);
    assert.equal(created.body.eventIds.length, 1);
    assert.equal(created.body.eventIds[0], created.body.projection.activities[0].id);
    assertValidProjection(created.body.projection);
    assert.equal(created.body.projection.dataOrigin, 'user');
    assert.equal(created.body.projection.currentActorId, 'http-owner');
    assert.equal(created.body.projection.currentActorId, created.body.projection.work.ownerActorId);

    const userWorkCommands = `/api/v1/workspaces/${userWorkspace}/works/${createBody.workId}/commands`;
    const userWorkProjection = `/api/v1/workspaces/${userWorkspace}/works/${createBody.workId}/projection`;
    const userGate = await requestJson(app, userWorkCommands, {
      ...jsonInit(commandEnvelope(`http-user-gate-${process.pid}`, 1, 'decide_gate', {
        gateId: 'http-user-gate-001',
        decision: 'approved',
        basis: 'The named HTTP approver reviewed the created work',
        impact: 'Authorize a receipt-only connector intent',
        responsibleActorId: 'http-approver',
      })),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-approver',
      },
    });
    assert.equal(userGate.response.status, 200);
    assertValidProjection(userGate.body.projection);
    assert.equal(userGate.body.projection.signals.gate.state, 'approved');
    assert.equal(userGate.body.projection.currentActorId, 'http-owner');
    assert.equal(userGate.body.projection.currentActorId, userGate.body.projection.work.ownerActorId);

    const userAction = await requestJson(app, userWorkCommands, {
      ...jsonInit(commandEnvelope(`http-user-action-${process.pid}`, 2, 'create_action_intent', {
        actionIntentId: 'http-user-action-001',
        actionType: 'notify-connector',
        targetActorId: 'http-connector',
        gateId: 'http-user-gate-001',
      })),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-authorizer',
      },
    });
    assert.equal(userAction.response.status, 200);
    assertValidProjection(userAction.body.projection);
    assert.equal(userAction.body.projection.signals.actionIntent.state, 'created');
    assert.equal(userAction.body.projection.currentActorId, 'http-owner');

    const wrongUserReceipt = await requestJson(app, userWorkCommands, {
      ...jsonInit(commandEnvelope(`http-user-wrong-receipt-${process.pid}`, 3, 'record_receipt', {
        receiptId: 'http-user-receipt-001',
        status: 'succeeded',
      })),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-owner',
      },
    });
    assert.equal(wrongUserReceipt.response.status, 403);
    assertErrorShape(wrongUserReceipt.body, 'AUTHORITY_DENIED');
    const afterWrongUserReceipt = await requestJson(app, userWorkProjection);
    assert.equal(afterWrongUserReceipt.response.status, 200);
    assert.deepEqual(afterWrongUserReceipt.body, userAction.body.projection);
    assert.equal(afterWrongUserReceipt.body.projectionVersion, 3);

    const userReceiptCommand = commandEnvelope(
      `http-user-receipt-${process.pid}`,
      3,
      'record_receipt',
      { receiptId: 'http-user-receipt-001', status: 'succeeded' },
    );
    const userReceipt = await requestJson(app, userWorkCommands, {
      ...jsonInit(userReceiptCommand),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-connector',
      },
    });
    assert.equal(userReceipt.response.status, 200);
    assert.equal(userReceipt.body.accepted, true);
    assert.equal(userReceipt.body.eventIds.length, 1);
    assertValidProjection(userReceipt.body.projection);
    assert.equal(userReceipt.body.projection.signals.receipt.status, 'succeeded');
    assert.equal(userReceipt.body.projection.projectionVersion, 4);
    assert.equal(userReceipt.body.projection.currentActorId, 'http-owner');
    assert.equal(userReceipt.body.projection.currentActorId, userReceipt.body.projection.work.ownerActorId);
    assert.ok(userReceipt.body.projection.availableCommands.some((command) => command.type === 'append_message'));

    const replayedUserReceipt = await requestJson(app, userWorkCommands, {
      ...jsonInit(userReceiptCommand),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-connector',
      },
    });
    assert.equal(replayedUserReceipt.response.status, 200);
    assert.equal(replayedUserReceipt.text, userReceipt.text);
    const finalUserProjection = await requestJson(app, userWorkProjection);
    assert.deepEqual(finalUserProjection.body, userReceipt.body.projection);
    assert.equal(finalUserProjection.body.projectionVersion, 4);

    const tooLargeBody = { ...createBody, padding: 'x'.repeat(1024 * 1024) };
    const tooLarge = await requestJson(app, `/api/v1/workspaces/${userWorkspace}/works`, {
      ...jsonInit(tooLargeBody),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Actor-Id': 'http-owner',
      },
    });
    assert.equal(tooLarge.response.status, 400);
    assertErrorShape(tooLarge.body, 'VALIDATION_ERROR');

    await app.close();
    assert.equal(app.server.listening, false);
    assert.equal(app.core.closed, true);
    app = null;
  } finally {
    if (app) await app.close();
    rmSync(testDirectory, { recursive: true, force: true });
  }
});
