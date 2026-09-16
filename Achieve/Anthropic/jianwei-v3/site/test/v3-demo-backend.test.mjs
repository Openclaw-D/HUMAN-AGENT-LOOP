import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceV3DemoProcessRun,
  createV3DemoSession,
  getV3CasePanel,
  getV3ContextVersions,
  getV3DemoRuntime,
  getV3PortfolioProjection,
  getV3Receipt,
  getV3RoleCaseProjection,
  resetV3DemoRuntime,
  resolveV3DemoSession,
} from '../lib/v3-demo-backend.ts';

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function runtimeActor(session) {
  return {
    roleApplicationId: session.roleApplicationId,
    principalId: session.principalId,
    ...(session.invitation ? { invitation: session.invitation } : {}),
  };
}

function acceptDemoEvidence(runtime, session, requestId, evidenceId, processId) {
  return runtime.acceptEvidence({
    ...runtimeActor(session),
    requestId,
    evidenceId,
    evidenceType: 'portfolio-provenance-test',
    sourceRef: `demo://portfolio/${evidenceId}`,
    contentHash: `sha256:${evidenceId}`,
    processId,
  });
}

function finishCurrentDemoRuns(runtime, label) {
  const snapshot = runtime.snapshot();
  const runs = snapshot.processRuns.filter((run) =>
    run.boundContextVersion === snapshot.currentContext.contextVersion && run.status !== 'superseded');
  for (const run of runs) {
    advanceV3DemoProcessRun({ requestId: `${label}-start-${run.processId}`, runId: run.runId, phase: 'start' });
    advanceV3DemoProcessRun({ requestId: `${label}-result-${run.processId}`, runId: run.runId, phase: 'result' });
  }
}

test.beforeEach(() => {
  resetV3DemoRuntime();
});

test('every legacy demo reset executes a fresh persisted reset operation', () => {
  const first = resetV3DemoRuntime();
  const second = resetV3DemoRuntime();

  assert.notEqual(second.runtimeEpoch, first.runtimeEpoch);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].type, 'SCENARIO_BASELINE_INITIALIZED');
});

test('creates server-owned canonical demo sessions and rejects unknown sessions', () => {
  const session = createV3DemoSession('leadership-observer');
  assert.equal(session.principalId, 'collaboration-manager');
  assert.equal(session.roleApplicationId, 'leadership');
  assert.deepEqual(resolveV3DemoSession(session.sessionId), session);
  expectCode(() => resolveV3DemoSession('missing'), 'DEMO_SESSION_NOT_FOUND');
});

test('derives different same-case projections and typed action capabilities', () => {
  const collaboration = getV3RoleCaseProjection(createV3DemoSession('collaboration-manager'), 'FL-DEMO-001');
  const business = getV3RoleCaseProjection(createV3DemoSession('business-owner'), 'FL-DEMO-001');
  const credit = getV3RoleCaseProjection(createV3DemoSession('risk-credit'), 'FL-DEMO-001');
  assert.equal(collaboration.caseId, business.caseId);
  assert.equal(collaboration.contextVersion, business.contextVersion);
  assert.ok(collaboration.allowedActions.some((item) => item.actionType === 'management_action'));
  assert.ok(!collaboration.allowedActions.some((item) => item.actionType === 'professional_gate'));
  assert.ok(!business.allowedActions.some((item) => item.actionType === 'professional_gate'));
  assert.deepEqual(credit.scope.professionalGateProcessIds, ['credit']);
  assert.equal(collaboration.processProjections.length, 0);
  assert.notDeepEqual(collaboration.allowedActions, business.allowedActions);
});

test('projects the internal five-thread collaboration read model without authority side effects', () => {
  const leadershipSession = createV3DemoSession('collaboration-manager');
  const businessSession = createV3DemoSession('business-owner');
  const runtime = getV3DemoRuntime();
  const before = runtime.snapshot();

  const initialProjection = getV3RoleCaseProjection(leadershipSession, 'FL-DEMO-001');
  const initial = initialProjection.collaborationProjection;
  assert.equal(initial.mode, 'internal-five-thread');
  assert.equal(initial.currentContextVersion, 'CTX-0000');
  assert.equal(initial.objective.status, 'active');
  assert.equal(initial.thread.threadId, 'FL-DEMO-001-INTERNAL');
  assert.deepEqual(initial.thread.members.map((item) => item.processId), [
    'opportunity', 'policy', 'credit', 'commercial', 'asset',
  ]);
  assert.equal(initial.thread.entries.length, 3);
  assert.ok(initial.thread.entries.every((entry) => entry.kind === 'scenario' && entry.authority === 'none'));
  assert.equal(initial.blockers.length, 3);
  assert.equal(initial.workItems.length, 5);
  assert.ok(initial.workItems.every((item) => item.runStatus === 'not_started' && item.gateState === 'not_ready'));
  assert.equal(Object.hasOwn(initialProjection, 'kpis'), false);
  assert.equal(Object.hasOwn(initialProjection, 'kpiWindows'), false);

  const messageInput = {
    roleApplicationId: businessSession.roleApplicationId,
    principalId: businessSession.principalId,
    requestId: 'collaboration-readback-message',
    message: '补充材料将在今天 17:00 前进入共享上下文。',
    processId: 'opportunity',
  };
  const event = runtime.recordMessage(messageInput);
  const replay = runtime.recordMessage(messageInput);
  assert.equal(event.type, 'MESSAGE_RECEIVED');
  assert.equal(event.actor.authority, 'none');
  assert.equal(replay.eventId, event.eventId);

  const after = runtime.snapshot();
  const projected = getV3RoleCaseProjection(leadershipSession, 'FL-DEMO-001').collaborationProjection;
  const matchingEntries = projected.thread.entries.filter((entry) => entry.entryId === event.eventId);
  assert.equal(matchingEntries.length, 1);
  assert.ok(projected.thread.entries.every((entry) => entry.authority === 'none'));
  assert.deepEqual(matchingEntries[0], {
    entryId: event.eventId,
    actorLabel: '业务 · 陈屿',
    processId: 'opportunity',
    text: messageInput.message,
    kind: 'human-message',
    contextVersion: 'CTX-0000',
    recordedAt: event.recordedAt,
    authority: 'none',
  });
  assert.equal(projected.currentContextVersion, before.currentContext.contextVersion);
  assert.equal(after.currentContext.contextVersion, before.currentContext.contextVersion);
  assert.equal(after.receipts.length, before.receipts.length);
  assert.equal(
    after.events.filter((item) => item.type === 'HUMAN_GATE_RECORDED').length,
    before.events.filter((item) => item.type === 'HUMAN_GATE_RECORDED').length,
  );
  assert.equal(after.events.length, before.events.length + 1);
});

test('keeps external projection invitation-scoped and background cases sparse', () => {
  const customerSession = createV3DemoSession('external-customer');
  const businessSession = createV3DemoSession('business-owner');
  const internalMessage = '只供内部五线程回读，不得进入外部邀请投影。';
  getV3DemoRuntime().recordMessage({
    roleApplicationId: businessSession.roleApplicationId,
    principalId: businessSession.principalId,
    requestId: 'external-scope-internal-message',
    message: internalMessage,
    processId: 'opportunity',
  });
  const customerPanel = getV3CasePanel(customerSession);
  assert.deepEqual(customerPanel.items.map((item) => item.caseId), ['FL-DEMO-001']);
  const customer = getV3RoleCaseProjection(customerSession, 'FL-DEMO-001');
  assert.deepEqual(customer.processProjections, []);
  assert.equal(customer.scope.externalTask.invitationId, 'INV-CUSTOMER-RISK-001');
  assert.equal(customer.collaborationProjection.mode, 'invitation-scoped');
  assert.deepEqual(Object.keys(customer.collaborationProjection).sort(), ['externalTask', 'mode']);
  assert.equal(JSON.stringify(customer).includes('SCENARIO-COLLAB'), false);
  assert.equal(JSON.stringify(customer).includes(internalMessage), false);
  assert.equal(Object.hasOwn(customer, 'kpis'), false);
  assert.equal(Object.hasOwn(customer, 'kpiWindows'), false);
  expectCode(() => getV3RoleCaseProjection(customerSession, 'FL-BG-001'), 'CASE_SCOPE_DENIED');

  const background = getV3RoleCaseProjection(businessSession, 'FL-BG-003');
  assert.equal(background.readOnly, true);
  assert.equal(background.contextVersion, null);
  assert.equal(background.commencementState.band, 5);
  assert.deepEqual(background.processProjections, []);
  assert.equal(background.collaborationProjection, null);
  assert.deepEqual(background.visibleReceiptRefs, []);
  assert.equal(Object.hasOwn(background, 'kpis'), false);
  assert.equal(Object.hasOwn(background, 'kpiWindows'), false);
});

test('returns role-scoped Portfolio, Context history and Receipt detail', () => {
  const collaborationSession = createV3DemoSession('collaboration-manager');
  const businessSession = createV3DemoSession('business-owner');
  const customerSession = createV3DemoSession('external-customer');
  const portfolio = getV3PortfolioProjection(collaborationSession);
  assert.equal(portfolio.northStar, '可验证净收入 / 单位资产产出效率');
  assert.deepEqual(portfolio.northStarDefinition, {
    primaryMetricClasses: ['net_income', 'unit_asset_net_income'],
    auxiliaryMetricClasses: ['full_cycle_profit'],
  });
  assert.equal(portfolio.viewMode, 'god-view');
  assert.equal(portfolio.runtimeEpoch, getV3DemoRuntime().snapshot().runtimeEpoch);
  assert.equal(portfolio.currentContextVersion, 'CTX-0000');
  assert.equal(portfolio.drilldown.focusCaseId, 'FL-DEMO-001');
  assert.deepEqual(Object.keys(portfolio.kpiWindows).sort(), ['day', 'half-year', 'month', 'quarter', 'week', 'year']);
  assert.deepEqual(portfolio.kpis, portfolio.kpiWindows.quarter);
  assert.notEqual(portfolio.kpiWindows.day[0].current, portfolio.kpiWindows.year[0].current);
  for (const [grain, window] of Object.entries(portfolio.kpiWindows)) {
    assert.equal(window.length, 3);
    assert.deepEqual(window.map((metric) => metric.metricClass), [
      'net_income', 'unit_asset_net_income', 'full_cycle_profit',
    ]);
    for (const metric of window) {
      assert.ok(metric.metricDefinitionId.startsWith('JW-'));
      assert.ok(metric.formulaVersion.endsWith('-v1'));
      assert.ok(metric.formula.length > 0);
      assert.ok(['current_period', 'current_year', 'full_lifecycle'].includes(metric.timeScope));
      assert.ok(['actual', 'forecast', 'scenario'].includes(metric.valueClass));
      assert.equal(metric.current, metric.value);
      assert.equal(metric.variance, Number((metric.value - metric.due).toFixed(1)));
      assert.equal(metric.deltaToDue, metric.variance);
      assert.equal(metric.currency, 'CNY');
      assert.equal(Number.isNaN(Date.parse(metric.asOf)), false);
      assert.equal(metric.dataCoverage.status, 'synthetic_demo_only');
      assert.equal(metric.dataCoverage.reconciliationStatus, 'not_connected');
      assert.ok(Array.isArray(metric.dataCoverage.includedFields));
      assert.ok(Array.isArray(metric.dataCoverage.missingSystems));
      assert.deepEqual(metric.sourceReceiptRefs, []);
    }
    assert.equal(window[0].timeScope, grain === 'year' ? 'current_year' : 'current_period');
    assert.equal(window[0].valueClass, 'scenario');
    assert.equal(window[1].valueClass, 'scenario');
    assert.equal(window[2].timeScope, 'full_lifecycle');
    assert.equal(window[2].valueClass, 'forecast');
    assert.ok(window[2].dataCoverage.missingSystems.includes('risk_provision'));
  }
  assert.equal(getV3PortfolioProjection(businessSession).kpis.length, 0);
  expectCode(() => getV3PortfolioProjection(customerSession), 'ACTION_SCOPE_DENIED');

  const receipt = getV3DemoRuntime().acceptEvidence({
    roleApplicationId: businessSession.roleApplicationId,
    principalId: businessSession.principalId,
    requestId: 'read-api-evidence',
    evidenceId: 'E-READ-001',
    evidenceType: 'opportunity_fact_pack',
    sourceRef: 'demo://read-api',
    contentHash: 'sha256:read-api',
    processId: 'opportunity',
  });
  assert.equal(getV3Receipt(businessSession, 'FL-DEMO-001', receipt.receiptId).receiptId, receipt.receiptId);
  expectCode(() => getV3Receipt(customerSession, 'FL-DEMO-001', receipt.receiptId), 'RECEIPT_SCOPE_DENIED');
  const internalHistory = getV3ContextVersions(businessSession, 'FL-DEMO-001');
  const externalHistory = getV3ContextVersions(customerSession, 'FL-DEMO-001');
  assert.equal(internalHistory.items.length, 1);
  assert.equal(internalHistory.items[0].receiptRefs.length, 1);
  assert.deepEqual(Object.keys(externalHistory.items[0]).sort(), ['contextSeq', 'contextVersion', 'isCurrent', 'transitionCode']);
});

test('binds Portfolio KPI provenance to the commencement Receipt without changing Context', () => {
  const runtime = getV3DemoRuntime();
  const collaboration = createV3DemoSession('collaboration-manager');
  const business = createV3DemoSession('business-owner');
  const customer = createV3DemoSession('external-customer');
  const supplier = createV3DemoSession('external-supplier');

  const t1Evidence = acceptDemoEvidence(runtime, business, 'portfolio-t1-evidence', 'PORTFOLIO-T1', 'opportunity');
  runtime.commitContext({
    ...runtimeActor(business),
    requestId: 'portfolio-t1-commit',
    transitionCode: 'T1',
    expectedContextVersion: 'CTX-0000',
    evidenceReceiptIds: [t1Evidence.receiptId],
    confirmedFactIds: ['portfolio-t1-fact'],
    rationale: '确认商机事实包',
  });
  finishCurrentDemoRuns(runtime, 'portfolio-t1');

  const t2Evidence = acceptDemoEvidence(runtime, customer, 'portfolio-t2-evidence', 'PORTFOLIO-T2', 'opportunity');
  runtime.commitContext({
    ...runtimeActor(customer),
    requestId: 'portfolio-t2-commit',
    transitionCode: 'T2',
    expectedContextVersion: 'CTX-0001',
    evidenceReceiptIds: [t2Evidence.receiptId],
    confirmedFactIds: ['portfolio-t2-fact'],
    rationale: '客户确认补充事实',
  });
  finishCurrentDemoRuns(runtime, 'portfolio-t2');

  const t3Customer = acceptDemoEvidence(runtime, customer, 'portfolio-t3-customer', 'PORTFOLIO-T3-C', 'opportunity');
  const t3Supplier = acceptDemoEvidence(runtime, supplier, 'portfolio-t3-supplier', 'PORTFOLIO-T3-S', 'commercial');
  runtime.commitContext({
    ...runtimeActor(business),
    requestId: 'portfolio-t3-commit',
    transitionCode: 'T3',
    expectedContextVersion: 'CTX-0002',
    evidenceReceiptIds: [t3Customer.receiptId, t3Supplier.receiptId],
    confirmedFactIds: ['portfolio-t3-fact'],
    rationale: '确认客户与供应商材料属于同一批次',
  });
  finishCurrentDemoRuns(runtime, 'portfolio-t3');

  const gateInputs = [
    ['policy', 'risk-policy', 'HUMAN_CONFIRM'],
    ['credit', 'risk-credit', 'HUMAN_DECIDE'],
    ['commercial', 'risk-commercial', 'HUMAN_CONFIRM'],
    ['asset', 'risk-asset', 'HUMAN_CONFIRM'],
  ];
  const gateReceipts = gateInputs.map(([processId, principalId, gateMode]) => {
    const session = createV3DemoSession(principalId);
    return runtime.recordHumanGate({
      ...runtimeActor(session),
      requestId: `portfolio-gate-${processId}`,
      expectedContextVersion: 'CTX-0003',
      processId,
      gateMode,
      decision: 'confirm',
      rationale: `${processId} 专业确认`,
      evidenceReceiptIds: [t3Customer.receiptId, t3Supplier.receiptId],
    });
  });
  const beforeCommencement = getV3PortfolioProjection(collaboration);
  assert.ok(beforeCommencement.kpis.every((metric) => metric.sourceReceiptRefs.length === 0));
  const contextCountBefore = runtime.snapshot().contexts.length;
  const commencement = runtime.recordCommencement({
    roleApplicationId: 'risk',
    principalId: 'risk-commercial',
    requestId: 'portfolio-commencement',
    expectedContextVersion: 'CTX-0003',
    conditionSetVersion: runtime.snapshot().commencement.conditionSetVersion,
    requiredReceiptIds: gateReceipts.map((receipt) => receipt.receiptId),
    rationale: '必要专业 Gate 与起租条件已满足',
  });
  const afterCommencement = getV3PortfolioProjection(collaboration);
  assert.equal(runtime.snapshot().contexts.length, contextCountBefore);
  assert.equal(afterCommencement.currentContextVersion, 'CTX-0003');
  for (const metric of afterCommencement.kpis) {
    assert.deepEqual(metric.sourceReceiptRefs, [{
      receiptId: commencement.receiptId,
      receiptType: 'commencement',
      caseId: 'FL-DEMO-001',
      contextVersion: 'CTX-0003',
      principalId: 'risk-commercial',
      processId: 'commercial',
      actionType: 'commencement_action',
      status: 'commenced',
      recordedAt: commencement.recordedAt,
    }]);
  }
});
