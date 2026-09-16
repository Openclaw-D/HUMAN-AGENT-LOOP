import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  acceptCanonicalEvidence,
  confirmCandidateFact,
  getProjection,
  handleCandidateMessage,
  resetSyntheticRuntime,
} from '../lib/domain.ts';
import { recordHumanDecision } from '../lib/decision-runtime.ts';
import { getAuthorityEventCount, listAuthorityEvents } from '../lib/authority-event-ledger.ts';
import { getLatestCandidateStageRuns, listCandidateStageRuns } from '../lib/stage-run-runtime.ts';

const CASE_ID = 'FL-DEMO-001';

describe('backend authority integration', () => {
test.beforeEach(() => {
  delete process.env.JIANWEI_MODEL_API_KEY;
  resetSyntheticRuntime();
});

test('bootstrap creates one authority event and four same-version candidate runs', () => {
  const projection = getProjection(CASE_ID);
  const events = listAuthorityEvents({ caseId: CASE_ID }).items;
  const runs = listCandidateStageRuns();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'STAGE_RUNS_STARTED');
  assert.equal(events[0].contextVersion, 'CTX-0001');
  assert.equal(events[0].actor.authority, 'none');
  assert.equal(runs.length, 4);
  assert.deepEqual(runs.map((run) => run.stageId), ['policy', 'credit', 'commerce', 'asset']);
  assert.ok(runs.every((run) => run.contextVersion === projection.sharedContext.contextVersion));
  assert.equal(projection.runtimeAudit.authorityEventCount, 1);
  assert.equal(projection.runtimeAudit.stageRunRecordCount, 4);
});

test('canonical evidence appends one evidence event and one four-run batch; replay is exact', () => {
  const input = {
    caseId: CASE_ID,
    requestId: 'integration-evidence-request',
    evidenceId: 'integration-evidence',
    kind: 'synthetic-note',
    title: '合成设备补充说明',
    summary: '仅用于外网演示的去标识摘要',
    actor: '集成测试·周宁',
  };
  const receipt = acceptCanonicalEvidence(input);
  const afterFirstEvents = listAuthorityEvents({ caseId: CASE_ID }).items;
  const afterFirstRuns = listCandidateStageRuns();

  assert.equal(afterFirstEvents.length, 3);
  assert.deepEqual(afterFirstEvents.map((event) => event.type), [
    'STAGE_RUNS_STARTED',
    'EVIDENCE_ACCEPTED',
    'STAGE_RUNS_STARTED',
  ]);
  assert.equal(afterFirstRuns.length, 8);
  assert.ok(getLatestCandidateStageRuns().every((run) => run.contextVersion === receipt.contextVersion));
  assert.equal(afterFirstEvents[1].actor.kind, 'human');
  assert.equal(afterFirstEvents[1].actor.authority, 'confirmed');

  assert.deepEqual(acceptCanonicalEvidence(input), receipt);
  assert.equal(getAuthorityEventCount(), 3);
  assert.equal(listCandidateStageRuns().length, 8);
});

test('fact confirmation advances context once and appends fact plus stage-run events once', async () => {
  const first = await confirmCandidateFact({
    caseId: CASE_ID,
    factId: 'fact-workshop-line',
    actor: '集成测试·林澈',
    requestId: 'integration-fact-1',
  });
  assert.equal(first.authority, 'confirmed');
  assert.equal(getAuthorityEventCount(), 3);
  assert.equal(listCandidateStageRuns().length, 8);
  const version = getProjection(CASE_ID).sharedContext.contextVersion;
  assert.ok(getLatestCandidateStageRuns().every((run) => run.contextVersion === version));

  const replayByFact = await confirmCandidateFact({
    caseId: CASE_ID,
    factId: 'fact-workshop-line',
    actor: '集成测试·林澈',
    requestId: 'integration-fact-2',
  });
  assert.deepEqual(replayByFact, first);
  assert.equal(getAuthorityEventCount(), 3);
  assert.equal(listCandidateStageRuns().length, 8);
});

test('human decision records one named authority event and replay does not duplicate it', () => {
  const input = {
    caseId: CASE_ID,
    stageId: 'policy',
    flowId: 'policy-material',
    action: 'submit',
    actor: '集成测试·徐朔',
    requestId: 'integration-decision-1',
  };
  const receipt = recordHumanDecision(input);
  const events = listAuthorityEvents({ caseId: CASE_ID }).items;
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'HUMAN_DECISION_RECORDED');
  assert.equal(events[1].actor.id, input.actor);
  assert.equal(events[1].actor.authority, 'confirmed');
  assert.equal(events[1].payload.receiptId, receipt.receiptId);

  assert.deepEqual(recordHumanDecision(input), receipt);
  assert.equal(getAuthorityEventCount(), 2);
});

test('candidate chat records received and answer events with zero model authority', async () => {
  const input = {
    caseId: CASE_ID,
    stageId: 'credit',
    flowId: 'credit-fact',
    message: '当前证据缺口是什么？',
    requestId: 'integration-message-1',
  };
  const response = await handleCandidateMessage(input);
  const events = listAuthorityEvents({ caseId: CASE_ID }).items;
  const messageEvents = events.filter((event) => [
    'MESSAGE_RECEIVED',
    'CANDIDATE_ANSWER_RECORDED',
  ].includes(event.type));

  assert.equal(response.status, 'candidate');
  assert.deepEqual(messageEvents.map((event) => event.type), [
    'MESSAGE_RECEIVED',
    'CANDIDATE_ANSWER_RECORDED',
  ]);
  assert.ok(messageEvents.every((event) => event.actor.authority === 'none'));
  assert.equal(messageEvents[1].payload.runtime, 'local_candidate');

  assert.deepEqual(await handleCandidateMessage(input), response);
  assert.equal(getAuthorityEventCount(), 3);
});
});
