import assert from 'node:assert/strict';
import test from 'node:test';

import {
  V3_COLLABORATION_CASE_ID,
  createV3CollaborationClient,
} from '../lib/v3-collaboration-client.ts';
import { V3ClientApiError } from '../lib/v3-client.ts';
import {
  createV3DemoSession,
  getV3DemoRuntime,
  getV3PortfolioProjection,
  getV3RoleCaseProjection,
  resetV3DemoRuntime,
  resolveV3DemoSession,
} from '../lib/v3-demo-backend.ts';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionPayload() {
  return {
    session: {
      sessionId: 'SESSION-COLLABORATION',
      principalId: 'collaboration-manager',
      roleApplicationId: 'leadership',
      invitation: null,
    },
  };
}

function scenarioRef() {
  return {
    scenarioId: 'V3-DEMO',
    scenarioVersion: 'V3-DEMO-001',
    seed: 'fixed-demo-seed',
    businessItemType: 'FinancingLeasingCase',
    caseId: V3_COLLABORATION_CASE_ID,
    leaseMode: 'direct-lease',
    dataClass: 'synthetic_deidentified_demo',
  };
}

function roleProjection(entries = []) {
  return {
    caseId: V3_COLLABORATION_CASE_ID,
    businessItemType: 'FinancingLeasingCase',
    caseTier: 'golden',
    readOnly: false,
    roleApplicationId: 'leadership',
    principalId: 'collaboration-manager',
    scenarioRef: scenarioRef(),
    runtimeEpoch: 'RUNTIME-001',
    contextVersion: 'CTX-001',
    projectionVersion: 'PROJECTION-001',
    caseSummary: 'demo',
    scope: {
      visibleProcessIds: ['opportunity', 'policy', 'credit', 'commercial', 'asset'],
      professionalGateProcessIds: [],
      invitationId: null,
      externalTask: null,
    },
    commencementState: { band: 0, lifecycleStatus: 'pre-commencement' },
    allowedActions: [{
      actionType: 'chat',
      enabled: true,
      requiresConfirmation: false,
      boundContextVersion: 'CTX-001',
      requiredPrincipalId: 'collaboration-manager',
      requiredProcessIds: [],
      invitationId: null,
      denialCode: null,
    }],
    processProjections: [],
    collaborationProjection: {
      mode: 'internal-five-thread',
      memberCount: 5,
      currentContextVersion: 'CTX-001',
      objective: {
        title: '补齐关键证据',
        description: '推动项目具备正式起租条件',
        status: 'active',
      },
      thread: {
        threadId: 'FL-DEMO-001-INTERNAL',
        title: '当前项目群聊',
        members: [
          { principalId: 'business-owner', processId: 'opportunity', label: '@业务', ownerLabel: '业务' },
          { principalId: 'risk-policy', processId: 'policy', label: '@政策', ownerLabel: '政策' },
          { principalId: 'risk-credit', processId: 'credit', label: '@信审', ownerLabel: '信审' },
          { principalId: 'risk-commercial', processId: 'commercial', label: '@商务', ownerLabel: '商务' },
          { principalId: 'risk-asset', processId: 'asset', label: '@资产', ownerLabel: '资产' },
        ],
        entries,
      },
      blockers: [
        {
          blockerId: 'BLOCKER-001',
          title: '订单稳定性',
          detail: '补充交付与回款说明',
          ownerProcessId: 'credit',
          status: 'needs-evidence',
        },
      ],
      workItems: [
        {
          processId: 'opportunity',
          label: '业务',
          task: '补充订单与回款说明',
          runStatus: 'needs_input',
          gateState: 'not_ready',
        },
        {
          processId: 'policy',
          label: '政策',
          task: '核对例外适用条件',
          runStatus: 'not_started',
          gateState: 'not_ready',
        },
        {
          processId: 'credit',
          label: '信审',
          task: '复核订单稳定性',
          runStatus: 'needs_input',
          gateState: 'not_ready',
        },
        {
          processId: 'commercial',
          label: '商务',
          task: '等待设备一致性回执',
          runStatus: 'not_started',
          gateState: 'not_ready',
        },
        {
          processId: 'asset',
          label: '资产',
          task: '准备到货现场查验',
          runStatus: 'not_started',
          gateState: 'not_ready',
        },
      ],
    },
    visibleReceiptRefs: [],
  };
}

function metricCoverage(metricClass) {
  return {
    status: 'synthetic_demo_only',
    sourceMode: 'in_memory_demo',
    reconciliationStatus: 'not_connected',
    includedFields: metricClass === 'net_income'
      ? ['total_income', 'funding_cost', 'channel_cost', 'surtax']
      : metricClass === 'unit_asset_net_income'
        ? ['net_income', 'commencement_amount']
        : ['synthetic_lifecycle_revenue', 'synthetic_financial_cost'],
    excludedByDefinition: [],
    missingSystems: ['finance_ledger_reconciliation'],
  };
}

function portfolioMetrics(grain = 'quarter') {
  const asOf = '2026-08-30T00:00:00.000Z';
  return [
    {
      metricId: 'net-income',
      metricDefinitionId: 'JW-NET-INCOME',
      formulaVersion: 'net-income-v1',
      formula: 'total_income - funding_cost - channel_cost - surtax',
      metricClass: 'net_income',
      timeScope: grain === 'year' ? 'current_year' : 'current_period',
      periodGrain: grain,
      valueClass: 'scenario',
      label: '可验证净收入',
      unit: '万元',
      target: 0,
      due: 0,
      value: -730,
      variance: -730,
      asOf,
      currency: 'CNY',
      dataCoverage: metricCoverage('net_income'),
      sourceReceiptRefs: [],
      current: -730,
      deltaToTarget: -730,
      deltaToDue: -730,
      trend: 'behind-plan',
    },
    {
      metricId: 'unit-asset-net-income',
      metricDefinitionId: 'JW-UNIT-ASSET-NET-INCOME',
      formulaVersion: 'unit-asset-net-income-v1',
      formula: 'net_income / commencement_amount',
      metricClass: 'unit_asset_net_income',
      timeScope: grain === 'year' ? 'current_year' : 'current_period',
      periodGrain: grain,
      valueClass: 'scenario',
      label: '单位资产产出效率',
      unit: '%',
      target: 8.4,
      due: 8.1,
      value: 7.9,
      variance: -0.2,
      asOf,
      currency: 'CNY',
      dataCoverage: metricCoverage('unit_asset_net_income'),
      sourceReceiptRefs: [],
      current: 7.9,
      deltaToTarget: -0.5,
      deltaToDue: -0.2,
      trend: 'behind-plan',
    },
    {
      metricId: 'full-cycle-profit',
      metricDefinitionId: 'JW-FULL-CYCLE-PROFIT',
      formulaVersion: 'full-cycle-profit-v1',
      formula: 'lifecycle_revenue - financial_cost - channel_cost - surtax - labor_cost - non_labor_cost - risk_cost - risk_provision',
      metricClass: 'full_cycle_profit',
      timeScope: 'full_lifecycle',
      periodGrain: 'full-lifecycle',
      valueClass: 'forecast',
      label: '全周期利润（辅助）',
      unit: '万元',
      target: 4380,
      due: 4020,
      value: 3650,
      variance: -370,
      asOf,
      currency: 'CNY',
      dataCoverage: metricCoverage('full_cycle_profit'),
      sourceReceiptRefs: [],
      current: 3650,
      deltaToTarget: -730,
      deltaToDue: -370,
      trend: 'behind-plan',
    },
  ];
}

function portfolioProjection() {
  const kpiWindows = Object.fromEntries(
    ['day', 'week', 'month', 'quarter', 'half-year', 'year'].map((grain) => [grain, portfolioMetrics(grain)]),
  );
  return {
    projectionType: 'PortfolioProjection',
    roleApplicationId: 'leadership',
    principalId: 'collaboration-manager',
    scenarioRef: scenarioRef(),
    runtimeEpoch: 'RUNTIME-001',
    projectionVersion: 'RUNTIME-001-PORTFOLIO-0',
    currentContextVersion: 'CTX-001',
    northStar: '可验证净收入 / 单位资产产出效率',
    northStarDefinition: {
      primaryMetricClasses: ['net_income', 'unit_asset_net_income'],
      auxiliaryMetricClasses: ['full_cycle_profit'],
    },
    timeGrains: ['day', 'week', 'month', 'quarter', 'half-year', 'year'],
    caseCount: 1,
    signalCounts: { attention: 1 },
    cases: [{
      caseId: V3_COLLABORATION_CASE_ID,
      title: '精密零件产线融资租赁',
      phase: '起租前',
      signal: 'attention',
      nextMilestone: '补齐证据',
      commencementBand: 0,
      lifecycleStatus: 'pre_commencement',
      readOnly: false,
    }],
    viewMode: 'god-view',
    organizationPath: ['租赁公司', '小微事业部'],
    kpis: kpiWindows.quarter,
    kpiWindows,
    drilldown: {
      portfolioId: 'SME-LEASE-PORTFOLIO',
      businessUnitId: 'SME-BU',
      largestDeviation: '正式起租数量与净利润预测低于目标',
      focusCaseId: V3_COLLABORATION_CASE_ID,
    },
  };
}

test('creates the leadership session and loads case plus portfolio projections in parallel', async () => {
  const requests = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  const controller = new AbortController();
  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, init });
    if (path === '/api/v3/demo/session') return jsonResponse(sessionPayload());
    activeReads += 1;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    await new Promise((resolve) => setImmediate(resolve));
    activeReads -= 1;
    if (path.endsWith('/projection') && path.includes('/cases/')) return jsonResponse(roleProjection());
    return jsonResponse(portfolioProjection());
  };

  const ready = await createV3CollaborationClient({ fetchImpl }).initialize(controller.signal);

  assert.equal(requests.length, 3);
  assert.equal(maxActiveReads, 2);
  assert.deepEqual(JSON.parse(requests[0].init.body), { principalId: 'collaboration-manager' });
  assert.equal(requests[0].init.signal, controller.signal);
  for (const request of requests.slice(1)) {
    assert.equal(new Headers(request.init.headers).get('x-jw-demo-session'), 'SESSION-COLLABORATION');
    assert.equal(request.init.signal, controller.signal);
  }
  assert.equal(ready.sessionId, 'SESSION-COLLABORATION');
  assert.equal(ready.objective.title, '补齐关键证据');
  assert.equal(ready.metrics[0].current, -730);
  assert.equal(ready.blockers.length, 1);
  assert.equal(ready.workItems.find((item) => item.processId === 'credit').processId, 'credit');
  assert.equal(ready.thread.members.find((member) => member.processId === 'credit').principalId, 'risk-credit');
  assert.deepEqual(ready.messageCapability, {
    processId: 'credit',
    enabled: true,
    boundContextVersion: 'CTX-001',
    denialCode: null,
  });
  assert.equal(ready.creditFlowAvailable, true);
});

test('posts only the real V3 message contract and reloads the thread after success', async () => {
  const requests = [];
  const controller = new AbortController();
  const entry = {
    entryId: 'EVENT-002',
    actorLabel: '协同 · 管理者',
    processId: 'credit',
    text: '请复核订单稳定性',
    kind: 'human-message',
    contextVersion: 'CTX-001',
    recordedAt: '2026-08-30T00:00:00.000Z',
    authority: 'none',
  };
  const event = {
    eventId: 'EVENT-002',
    runtimeEpoch: 'RUNTIME-001',
    sequence: 2,
    caseId: V3_COLLABORATION_CASE_ID,
    scenarioVersion: 'V3-DEMO-001',
    type: 'MESSAGE_RECEIVED',
    actor: { principalId: 'collaboration-manager', roleApplicationId: 'leadership', authority: 'none' },
    correlationId: 'collaboration-fixed-id',
    causationId: null,
    contextVersion: 'CTX-001',
    recordedAt: entry.recordedAt,
    payload: { message: entry.text, processId: 'credit', invitationId: null },
  };
  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, init });
    if (path.endsWith('/messages')) return jsonResponse({ event });
    if (path.includes('/cases/')) return jsonResponse(roleProjection([entry]));
    return jsonResponse(portfolioProjection());
  };

  const ready = await createV3CollaborationClient({ fetchImpl }).sendMessage({
    sessionId: 'SESSION-COLLABORATION',
    requestId: 'collaboration-fixed-id',
    message: '  请复核订单稳定性  ',
    signal: controller.signal,
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].path, `/api/v3/cases/${V3_COLLABORATION_CASE_ID}/messages`);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    requestId: 'collaboration-fixed-id',
    message: '请复核订单稳定性',
    processId: 'credit',
  });
  for (const request of requests) assert.equal(request.init.signal, controller.signal);
  assert.deepEqual(
    requests.slice(1).map((request) => request.path).sort(),
    [
      `/api/v3/cases/${V3_COLLABORATION_CASE_ID}/projection`,
      '/api/v3/portfolio/projection',
    ].sort(),
  );
  assert.equal(ready.thread.entries.at(-1).entryId, 'EVENT-002');
  assert.equal(ready.thread.entries.at(-1).authority, 'none');
  assert.equal(ready.lastMessageEvent.eventId, 'EVENT-002');
});

test('fails closed when a 2xx case projection is not the internal leadership read model', async () => {
  const external = {
    ...roleProjection(),
    contextVersion: 'CTX-EXTERNAL',
    scope: {
      visibleProcessIds: [],
      professionalGateProcessIds: [],
      invitationId: 'INV-001',
      externalTask: {
        invitationId: 'INV-001',
        workstepProcessId: 'opportunity',
        status: 'active',
        allowedActionTypes: ['chat'],
      },
    },
    collaborationProjection: {
      mode: 'invitation-scoped',
      externalTask: {
        invitationId: 'INV-001',
        workstepProcessId: 'opportunity',
        status: 'active',
        allowedActionTypes: ['chat'],
      },
    },
  };
  const fetchImpl = async (input) => String(input).includes('/cases/')
    ? jsonResponse(external)
    : jsonResponse(portfolioProjection());

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).reload('SESSION-EXTERNAL'),
    (error) => {
      assert.ok(error instanceof V3ClientApiError);
      assert.equal(error.code, 'INVALID_CASE_PROJECTION_RESPONSE');
      assert.equal(error.status, 200);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('rejects case and portfolio projections from different runtime snapshots', async (t) => {
  const cases = [
    {
      name: 'runtime epoch mismatch',
      mutate(role, portfolio) {
        portfolio.runtimeEpoch = `${role.runtimeEpoch}-OTHER`;
      },
    },
    {
      name: 'context version mismatch',
      mutate(_role, portfolio) {
        portfolio.currentContextVersion = 'CTX-OTHER';
      },
    },
    {
      name: 'focus case mismatch',
      mutate(_role, portfolio) {
        portfolio.drilldown.focusCaseId = 'FL-BG-001';
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const role = roleProjection();
      const portfolio = portfolioProjection();
      scenario.mutate(role, portfolio);
      const fetchImpl = async (input) => String(input).includes('/cases/')
        ? jsonResponse(role)
        : jsonResponse(portfolio);

      await assert.rejects(
        createV3CollaborationClient({ fetchImpl }).reload('SESSION-INCOHERENT'),
        (error) => error instanceof V3ClientApiError && error.code === 'INVALID_PROJECTION_COHERENCE',
      );
    });
  }
});

test('rejects malformed nested collaboration and KPI provenance fields', async (t) => {
  await t.test('collaboration objective is incomplete', async () => {
    const role = roleProjection();
    delete role.collaborationProjection.objective.title;
    const fetchImpl = async (input) => String(input).includes('/cases/')
      ? jsonResponse(role)
      : jsonResponse(portfolioProjection());

    await assert.rejects(
      createV3CollaborationClient({ fetchImpl }).reload('SESSION-BAD-COLLABORATION'),
      (error) => error instanceof V3ClientApiError && error.code === 'INVALID_COLLABORATION_PROJECTION_RESPONSE',
    );
  });

  await t.test('quarter KPI omits provenance', async () => {
    const portfolio = portfolioProjection();
    delete portfolio.kpis[0].metricDefinitionId;
    const fetchImpl = async (input) => String(input).includes('/cases/')
      ? jsonResponse(roleProjection())
      : jsonResponse(portfolio);

    await assert.rejects(
      createV3CollaborationClient({ fetchImpl }).reload('SESSION-BAD-KPI'),
      (error) => error instanceof V3ClientApiError && error.code === 'INVALID_KPI_PROJECTION_RESPONSE',
    );
  });

  await t.test('KPI window has invalid coverage status', async () => {
    const portfolio = portfolioProjection();
    portfolio.kpiWindows.month[0].dataCoverage.status = 'connected_without_evidence';
    const fetchImpl = async (input) => String(input).includes('/cases/')
      ? jsonResponse(roleProjection())
      : jsonResponse(portfolio);

    await assert.rejects(
      createV3CollaborationClient({ fetchImpl }).reload('SESSION-BAD-KPI-COVERAGE'),
      (error) => error instanceof V3ClientApiError && error.code === 'INVALID_KPI_PROJECTION_RESPONSE',
    );
  });
});

test('derives message capability from allowedActions before visible process scope', async (t) => {
  const scenarios = [
    {
      name: 'backend denial is preserved',
      configure(role) {
        const chat = role.allowedActions.find((action) => action.actionType === 'chat');
        chat.enabled = false;
        chat.denialCode = 'CHAT_TEMPORARILY_DISABLED';
      },
      expected: { enabled: false, boundContextVersion: 'CTX-001', denialCode: 'CHAT_TEMPORARILY_DISABLED' },
    },
    {
      name: 'stale action binding disables send',
      configure(role) {
        role.allowedActions.find((action) => action.actionType === 'chat').boundContextVersion = 'CTX-STALE';
      },
      expected: { enabled: false, boundContextVersion: 'CTX-STALE', denialCode: null },
    },
    {
      name: 'visible credit without chat action stays disabled',
      configure(role) {
        role.allowedActions = [];
      },
      expected: { enabled: false, boundContextVersion: null, denialCode: null },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const role = roleProjection();
      scenario.configure(role);
      const fetchImpl = async (input) => String(input).includes('/cases/')
        ? jsonResponse(role)
        : jsonResponse(portfolioProjection());
      const ready = await createV3CollaborationClient({ fetchImpl }).reload('SESSION-CAPABILITY');

      assert.deepEqual(ready.messageCapability, { processId: 'credit', ...scenario.expected });
      assert.equal(ready.creditFlowAvailable, false);
    });
  }
});

test('surfaces backend error code, status and request id without fallback success', async () => {
  const fetchImpl = async () => jsonResponse({
    error: {
      code: 'ACTION_SCOPE_DENIED',
      message: '当前身份无权访问',
      requestId: 'REQ-401',
      retryable: false,
    },
  }, 403);

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).reload('SESSION-DENIED'),
    (error) => {
      assert.ok(error instanceof V3ClientApiError);
      assert.equal(error.code, 'ACTION_SCOPE_DENIED');
      assert.equal(error.status, 403);
      assert.equal(error.requestId, 'REQ-401');
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('turns a non-JSON non-2xx response into a structured client failure', async () => {
  const fetchImpl = async () => new Response('upstream unavailable', { status: 502 });

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).reload('SESSION-UPSTREAM-FAILURE'),
    (error) => {
      assert.ok(error instanceof V3ClientApiError);
      assert.equal(error.code, 'INVALID_API_RESPONSE');
      assert.equal(error.status, 502);
      assert.equal(error.requestId, null);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('rejects a malformed successful message response without reloading projections', async () => {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    requests.push({ path: String(input), init });
    return jsonResponse({});
  };

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).sendMessage({
      sessionId: 'SESSION-COLLABORATION',
      requestId: 'collaboration-missing-event',
      message: '请复核订单稳定性',
    }),
    (error) => {
      assert.ok(error instanceof V3ClientApiError);
      assert.equal(error.code, 'INVALID_MESSAGE_RESPONSE');
      assert.equal(error.status, 200);
      return true;
    },
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /\/messages$/);
});

test('rejects a successful message event that is absent from the reloaded thread', async () => {
  const event = {
    eventId: 'EVENT-NOT-PROJECTED',
    runtimeEpoch: 'RUNTIME-001',
    sequence: 2,
    caseId: V3_COLLABORATION_CASE_ID,
    scenarioVersion: 'V3-DEMO-001',
    type: 'MESSAGE_RECEIVED',
    actor: { principalId: 'collaboration-manager', roleApplicationId: 'leadership', authority: 'none' },
    correlationId: 'collaboration-reconcile-missing',
    causationId: null,
    contextVersion: 'CTX-001',
    recordedAt: '2026-08-30T00:00:00.000Z',
    payload: { message: '请复核回读', processId: 'credit', invitationId: null },
  };
  const fetchImpl = async (input) => {
    const path = String(input);
    if (path.endsWith('/messages')) return jsonResponse({ event });
    if (path.includes('/cases/')) return jsonResponse(roleProjection());
    return jsonResponse(portfolioProjection());
  };

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).sendMessage({
      sessionId: 'SESSION-COLLABORATION',
      requestId: event.correlationId,
      message: event.payload.message,
    }),
    (error) => {
      assert.ok(error instanceof V3ClientApiError);
      assert.equal(error.code, 'MESSAGE_RECONCILIATION_FAILED');
      assert.equal(error.requestId, event.correlationId);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('reuses a caller-owned requestId after post-success reload failure without creating another Event', async (t) => {
  resetV3DemoRuntime();
  t.after(() => resetV3DemoRuntime());
  let failNextCaseProjection = false;
  let failedProjectionCount = 0;
  const requestId = 'collaboration-stable-retry';
  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    const headers = new Headers(init.headers);
    if (path === '/api/v3/demo/session') {
      const body = JSON.parse(String(init.body));
      return jsonResponse({ session: createV3DemoSession(body.principalId) });
    }
    const session = resolveV3DemoSession(headers.get('x-jw-demo-session'));
    if (path.endsWith('/messages')) {
      const body = JSON.parse(String(init.body));
      const event = getV3DemoRuntime().recordMessage({
        roleApplicationId: session.roleApplicationId,
        principalId: session.principalId,
        requestId: body.requestId,
        message: body.message,
        processId: body.processId,
      });
      failNextCaseProjection = true;
      return jsonResponse({ event });
    }
    if (path.includes('/cases/')) {
      if (failNextCaseProjection && failedProjectionCount === 0) {
        failedProjectionCount += 1;
        return jsonResponse({
          error: {
            code: 'PROJECTION_TEMPORARILY_UNAVAILABLE',
            message: 'projection reload failed after write',
            retryable: true,
          },
        }, 503);
      }
      return jsonResponse(getV3RoleCaseProjection(session, V3_COLLABORATION_CASE_ID));
    }
    return jsonResponse(getV3PortfolioProjection(session));
  };
  const client = createV3CollaborationClient({ fetchImpl });
  const initialized = await client.initialize();
  const input = {
    sessionId: initialized.sessionId,
    requestId,
    message: '请在 reload 失败后安全重试',
  };

  await assert.rejects(
    client.sendMessage(input),
    (error) => error instanceof V3ClientApiError && error.code === 'PROJECTION_TEMPORARILY_UNAVAILABLE',
  );
  assert.equal(
    getV3DemoRuntime().snapshot().events.filter((event) => event.type === 'MESSAGE_RECEIVED').length,
    1,
  );

  const retried = await client.sendMessage(input);
  assert.equal(retried.lastMessageEvent.correlationId, requestId);
  assert.equal(retried.thread.entries.filter((entry) => entry.entryId === retried.lastMessageEvent.eventId).length, 1);
  assert.equal(
    getV3DemoRuntime().snapshot().events.filter((event) => event.type === 'MESSAGE_RECEIVED').length,
    1,
  );
});

test('integrates with the real V3 session and Back read models without synthesizing an Agent answer', async (t) => {
  resetV3DemoRuntime();
  t.after(() => resetV3DemoRuntime());

  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    const headers = new Headers(init.headers);
    if (path === '/api/v3/demo/session') {
      const body = JSON.parse(String(init.body));
      return jsonResponse({ session: createV3DemoSession(body.principalId) });
    }

    const session = resolveV3DemoSession(headers.get('x-jw-demo-session'));
    if (path === `/api/v3/cases/${V3_COLLABORATION_CASE_ID}/projection`) {
      return jsonResponse(getV3RoleCaseProjection(session, V3_COLLABORATION_CASE_ID));
    }
    if (path === '/api/v3/portfolio/projection') {
      return jsonResponse(getV3PortfolioProjection(session));
    }
    if (path === `/api/v3/cases/${V3_COLLABORATION_CASE_ID}/messages`) {
      const body = JSON.parse(String(init.body));
      const event = getV3DemoRuntime().recordMessage({
        roleApplicationId: session.roleApplicationId,
        principalId: session.principalId,
        requestId: body.requestId,
        message: body.message,
        processId: body.processId,
      });
      return jsonResponse({ event });
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'unexpected test path' } }, 404);
  };

  const client = createV3CollaborationClient({ fetchImpl });
  const initialized = await client.initialize();
  const sent = await client.sendMessage({
    sessionId: initialized.sessionId,
    requestId: 'collaboration-real-back-read-model',
    message: '请信审复核订单稳定性',
  });

  assert.equal(initialized.thread.members.length, 5);
  assert.equal(initialized.metrics.length, 3);
  assert.equal(initialized.metrics[0].valueClass, 'scenario');
  assert.equal(initialized.metrics[0].dataCoverage.status, 'synthetic_demo_only');
  assert.equal(initialized.metrics.at(-1).valueClass, 'forecast');
  assert.equal(sent.thread.entries.at(-1).text, '请信审复核订单稳定性');
  assert.equal(sent.thread.entries.at(-1).authority, 'none');
  assert.equal(sent.lastMessageEvent.type, 'MESSAGE_RECEIVED');
  assert.equal('candidate' in sent.lastMessageEvent, false);
});

test('rejects empty messages before mutation', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse({});
  };

  await assert.rejects(
    createV3CollaborationClient({ fetchImpl }).sendMessage({
      sessionId: 'SESSION-COLLABORATION',
      requestId: 'collaboration-empty-message',
      message: '   ',
    }),
    (error) => error instanceof V3ClientApiError && error.code === 'INVALID_MESSAGE',
  );
  assert.equal(called, false);
});
