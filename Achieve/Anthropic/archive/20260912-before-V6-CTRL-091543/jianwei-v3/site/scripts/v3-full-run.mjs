import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const CASE_ID = 'FL-DEMO-001';
const PRINCIPALS = [
  'collaboration-manager',
  'business-owner',
  'risk-policy',
  'risk-credit',
  'risk-commercial',
  'risk-asset',
  'external-customer',
  'external-supplier',
];
const PROCESS_IDS = ['opportunity', 'policy', 'credit', 'commercial', 'asset'];

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function jsonRequest(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.sessionId) headers.set('x-jw-demo-session', options.sessionId);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(endpoint(baseUrl, path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  const expectedStatus = options.expectedStatus ?? 200;
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method ?? 'GET'} ${path}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function createSessions(baseUrl) {
  const entries = await Promise.all(PRINCIPALS.map(async (principalId) => {
    const payload = await jsonRequest(baseUrl, '/api/v3/demo/session', {
      method: 'POST',
      body: { principalId },
    });
    assert.equal(payload.session.principalId, principalId);
    return [principalId, payload.session];
  }));
  return Object.fromEntries(entries);
}

async function projection(baseUrl, sessionId) {
  return jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/projection`, { sessionId });
}

async function advanceRuns(baseUrl, controllerSessionId, runs, label) {
  assert.deepEqual(runs.map((run) => run.processId).sort(), [...PROCESS_IDS].sort());
  for (const run of runs) {
    await jsonRequest(baseUrl, '/api/v3/demo/process-runs/advance', {
      method: 'POST',
      sessionId: controllerSessionId,
      body: { requestId: `${label}-start-${run.processId}`, runId: run.runId, phase: 'start' },
    });
  }
  const partialSnapshots = [];
  const completionOrder = ['policy', 'opportunity', 'commercial', 'credit', 'asset'];
  for (const processId of completionOrder) {
    const run = runs.find((item) => item.processId === processId);
    await jsonRequest(baseUrl, '/api/v3/demo/process-runs/advance', {
      method: 'POST',
      sessionId: controllerSessionId,
      body: { requestId: `${label}-result-${processId}`, runId: run.runId, phase: 'result' },
    });
    if (partialSnapshots.length < 2) {
      partialSnapshots.push(await projection(baseUrl, controllerSessionId));
    }
  }
  return partialSnapshots;
}

async function collectAllEvents(baseUrl, sessionId) {
  const items = [];
  let afterSequence = 0;
  do {
    const page = await jsonRequest(
      baseUrl,
      `/api/v3/cases/${CASE_ID}/events?afterSequence=${afterSequence}&limit=7`,
      { sessionId },
    );
    items.push(...page.items);
    if (!page.hasMore) break;
    assert.ok(page.nextSequence > afterSequence, 'event pagination cursor must advance');
    afterSequence = page.nextSequence;
  } while (true);
  assert.deepEqual(items.map((item) => item.sequence), items.map((_, index) => index + 1));
  assert.equal(new Set(items.map((item) => item.eventId)).size, items.length);
  return items;
}

function normalizedStructure({ scenario, contexts, events, receipts, finalProjection, portfolioBefore, portfolioAfter }) {
  const receiptIds = new Map(receipts.map((receipt, index) => [receipt.receiptId, `R${index + 1}`]));
  const beforeNetIncome = portfolioBefore.kpis.find((metric) => metric.metricClass === 'net_income');
  const afterNetIncome = portfolioAfter.kpis.find((metric) => metric.metricClass === 'net_income');
  return {
    scenario: {
      scenarioId: scenario.scenarioRef.scenarioId,
      scenarioVersion: scenario.scenarioRef.scenarioVersion,
      seed: scenario.scenarioRef.seed,
      caseId: scenario.scenarioRef.caseId,
      processIds: scenario.processIds,
    },
    contexts: contexts.items.map((context) => ({
      contextSeq: context.contextSeq,
      contextVersion: context.contextVersion,
      transitionCode: context.transitionCode,
      isCurrent: context.isCurrent,
      processRuns: (context.processRuns ?? []).map((run) => ({
        processId: run.processId,
        status: run.status,
        readinessBand: run.readinessBand,
        riskBand: run.riskBand,
        evidenceCoverageBand: run.evidenceCoverageBand,
        gateState: run.gateState,
        supersededByContextVersion: run.supersededByContextVersion,
      })),
    })),
    events: events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      principalId: event.actor.principalId,
      authority: event.actor.authority,
      contextVersion: event.contextVersion,
      transitionCode: event.payload.transitionCode ?? null,
      processId: event.payload.processId ?? null,
      status: event.payload.status ?? null,
      decision: event.payload.decision ?? null,
      actionCode: event.payload.actionCode ?? null,
      conditionSetVersion: event.payload.conditionSetVersion ?? null,
    })),
    receipts: receipts.map((receipt) => ({
      receiptId: receiptIds.get(receipt.receiptId),
      receiptType: receipt.receiptType,
      contextVersion: receipt.contextVersion,
      principalId: receipt.principalId,
      processId: receipt.processId ?? null,
      actionType: receipt.actionType ?? null,
      status: receipt.status,
      evidenceReceiptIds: receipt.evidenceReceiptIds.map((id) => receiptIds.get(id) ?? 'UPSTREAM'),
    })),
    commencement: {
      band: finalProjection.commencementState.band,
      status: finalProjection.commencementState.status,
      lifecycleStatus: finalProjection.commencementState.lifecycleStatus,
      conditionSetVersion: finalProjection.commencementState.conditionSetVersion,
      commencementReceiptId: receiptIds.get(finalProjection.commencementState.commencementReceiptId),
    },
    portfolioDiff: {
      beforeBand: portfolioBefore.cases.find((item) => item.caseId === CASE_ID).commencementBand,
      afterBand: portfolioAfter.cases.find((item) => item.caseId === CASE_ID).commencementBand,
      beforeNetIncome: beforeNetIncome.value,
      afterNetIncome: afterNetIncome.value,
      metricDefinitionId: afterNetIncome.metricDefinitionId,
      formulaVersion: afterNetIncome.formulaVersion,
      metricClass: afterNetIncome.metricClass,
      timeScope: afterNetIncome.timeScope,
      valueClass: afterNetIncome.valueClass,
      sourceReceiptRefs: afterNetIncome.sourceReceiptRefs.map((ref) => receiptIds.get(ref.receiptId) ?? 'UNRESOLVED'),
    },
  };
}

export async function runV3FullScenario({ baseUrl = 'http://localhost:3000', runLabel = 'run-1' } = {}) {
  const scenario = await jsonRequest(baseUrl, '/api/v3/demo/scenario');
  assert.equal(scenario.scenarioRef.scenarioId, 'JW-V3-DL-GOLDEN-001');
  assert.deepEqual(scenario.processIds, PROCESS_IDS);
  const sessions = await createSessions(baseUrl);
  const sid = Object.fromEntries(Object.entries(sessions).map(([key, value]) => [key, value.sessionId]));

  const reset = await jsonRequest(baseUrl, '/api/v3/demo/reset', {
    method: 'POST',
    sessionId: sid['collaboration-manager'],
    body: {},
  });
  assert.equal(reset.eventCount, 1);
  assert.equal(reset.receiptCount, 0);
  assert.equal(reset.processRunCount, 0);
  assert.equal(reset.currentContext.contextVersion, 'CTX-0000');
  const portfolioBefore = await jsonRequest(baseUrl, '/api/v3/portfolio/projection', {
    sessionId: sid['collaboration-manager'],
  });

  await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/projection`, {
    sessionId: sid['external-customer'],
  });
  await jsonRequest(baseUrl, '/api/v3/portfolio/projection', {
    sessionId: sid['external-customer'],
    expectedStatus: 403,
  });
  await jsonRequest(baseUrl, '/api/v3/cases/FL-BG-001/projection', {
    sessionId: sid['external-customer'],
    expectedStatus: 403,
  });

  const messageBody = {
    requestId: `${runLabel}-message`,
    message: '@信审 请关注设备采购动机与现金流假设',
    processId: 'opportunity',
  };
  const messageResponse = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/messages`, {
    method: 'POST',
    sessionId: sid['business-owner'],
    body: messageBody,
  });
  const messageReplay = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/messages`, {
    method: 'POST',
    sessionId: sid['business-owner'],
    body: messageBody,
  });
  assert.equal(messageReplay.event.eventId, messageResponse.event.eventId);
  assert.equal(messageResponse.event.type, 'MESSAGE_RECEIVED');
  assert.equal(messageResponse.event.actor.authority, 'none');
  const messageReadback = await projection(baseUrl, sid['business-owner']);
  assert.equal(messageReadback.contextVersion, 'CTX-0000');
  assert.equal(messageReadback.collaborationProjection.mode, 'internal-five-thread');
  const projectedMessage = messageReadback.collaborationProjection.thread.entries.filter(
    (entry) => entry.entryId === messageResponse.event.eventId,
  );
  assert.equal(projectedMessage.length, 1);
  assert.equal(projectedMessage[0].text, messageBody.message);
  assert.equal(projectedMessage[0].kind, 'human-message');
  assert.equal(projectedMessage[0].authority, 'none');
  assert.equal(projectedMessage[0].contextVersion, 'CTX-0000');

  const t1EvidenceBody = {
    requestId: `${runLabel}-t1-evidence`,
    evidenceId: 'E-T1-OPPORTUNITY-001',
    evidenceType: 'opportunity_fact_pack',
    sourceRef: 'demo://golden/t1/opportunity',
    contentHash: 'sha256:t1-opportunity',
    processId: 'opportunity',
  };
  const t1Evidence = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST', sessionId: sid['business-owner'], body: t1EvidenceBody,
  });
  const t1Replay = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST', sessionId: sid['business-owner'], body: t1EvidenceBody,
  });
  assert.equal(t1Replay.receipt.receiptId, t1Evidence.receipt.receiptId);
  await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST',
    sessionId: sid['business-owner'],
    expectedStatus: 409,
    body: { ...t1EvidenceBody, contentHash: 'sha256:conflict' },
  });
  assert.equal((await projection(baseUrl, sid['business-owner'])).contextVersion, 'CTX-0000');
  const t1CommitBody = {
    requestId: `${runLabel}-t1-commit`,
    transitionCode: 'T1',
    expectedContextVersion: 'CTX-0000',
    evidenceReceiptIds: [t1Evidence.receipt.receiptId],
    confirmedFactIds: ['customer-intent', 'device-purpose'],
    rationale: '业务确认商机事实包，触发五路首轮处理',
  };
  const t1 = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/context-commits`, {
    method: 'POST', sessionId: sid['business-owner'], body: t1CommitBody,
  });
  const t1CommitReplay = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/context-commits`, {
    method: 'POST', sessionId: sid['business-owner'], body: t1CommitBody,
  });
  assert.equal(t1CommitReplay.context.contextVersion, 'CTX-0001');
  assert.equal(t1.runs.length, 5);
  await advanceRuns(baseUrl, sid['collaboration-manager'], t1.runs, `${runLabel}-t1`);

  const t2Evidence = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST',
    sessionId: sid['external-customer'],
    body: {
      requestId: `${runLabel}-t2-evidence`,
      evidenceId: 'E-T2-LITIGATION-001',
      evidenceType: 'litigation_risk_fact',
      sourceRef: 'demo://golden/t2/customer-confirmation',
      contentHash: 'sha256:t2-litigation',
      processId: 'opportunity',
    },
  });
  const t2 = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/context-commits`, {
    method: 'POST',
    sessionId: sid['external-customer'],
    body: {
      requestId: `${runLabel}-t2-commit`,
      transitionCode: 'T2',
      expectedContextVersion: 'CTX-0001',
      evidenceReceiptIds: [t2Evidence.receipt.receiptId],
      confirmedFactIds: ['material-litigation-risk'],
      rationale: '客户在受邀步骤确认重大涉诉事实',
    },
  });
  await advanceRuns(baseUrl, sid['collaboration-manager'], t2.runs, `${runLabel}-t2`);
  const t2Projection = await projection(baseUrl, sid['risk-credit']);
  const t2Credit = t2Projection.processProjections.find((item) => item.processId === 'credit');
  assert.equal(t2Credit.runStatus, 'needs_input');
  assert.equal(t2Credit.readinessBand, 2);

  const t3CustomerEvidence = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST',
    sessionId: sid['external-customer'],
    body: {
      requestId: `${runLabel}-t3-customer-evidence`,
      evidenceId: 'E-T3-CUSTOMER-001',
      evidenceType: 'customer_remediation_pack',
      sourceRef: 'demo://golden/t3/customer',
      contentHash: 'sha256:t3-customer',
      processId: 'opportunity',
    },
  });
  const t3SupplierEvidence = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/evidence`, {
    method: 'POST',
    sessionId: sid['external-supplier'],
    body: {
      requestId: `${runLabel}-t3-supplier-evidence`,
      evidenceId: 'E-T3-SUPPLIER-001',
      evidenceType: 'device_delivery_pack',
      sourceRef: 'demo://golden/t3/supplier',
      contentHash: 'sha256:t3-supplier',
      processId: 'commercial',
    },
  });
  const t3 = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/context-commits`, {
    method: 'POST',
    sessionId: sid['business-owner'],
    body: {
      requestId: `${runLabel}-t3-commit`,
      transitionCode: 'T3',
      expectedContextVersion: 'CTX-0002',
      evidenceReceiptIds: [t3CustomerEvidence.receipt.receiptId, t3SupplierEvidence.receipt.receiptId],
      confirmedFactIds: ['risk-remediated', 'device-delivery-confirmed'],
      rationale: '业务将客户与供应商两份独立 Evidence 合并为唯一 T3 ContextCommit',
    },
  });
  await advanceRuns(baseUrl, sid['collaboration-manager'], t3.runs, `${runLabel}-t3`);

  const beforeDeniedGate = await collectAllEvents(baseUrl, sid['collaboration-manager']);
  await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/gates/policy/decisions`, {
    method: 'POST',
    sessionId: sid['business-owner'],
    expectedStatus: 403,
    body: {
      requestId: `${runLabel}-denied-business-gate`, expectedContextVersion: 'CTX-0003',
      gateMode: 'HUMAN_CONFIRM', decision: 'confirm', rationale: '越权请求应失败',
      evidenceReceiptIds: [t3CustomerEvidence.receipt.receiptId],
    },
  });
  assert.equal((await collectAllEvents(baseUrl, sid['collaboration-manager'])).length, beforeDeniedGate.length);

  const gateInputs = [
    ['policy', 'risk-policy', 'HUMAN_CONFIRM'],
    ['credit', 'risk-credit', 'HUMAN_DECIDE'],
    ['commercial', 'risk-commercial', 'HUMAN_CONFIRM'],
    ['asset', 'risk-asset', 'HUMAN_CONFIRM'],
  ];
  const gateReceipts = [];
  for (const [processId, principalId, gateMode] of gateInputs) {
    const response = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/gates/${processId}/decisions`, {
      method: 'POST',
      sessionId: sid[principalId],
      body: {
        requestId: `${runLabel}-gate-${processId}`,
        expectedContextVersion: 'CTX-0003',
        gateMode,
        decision: 'confirm',
        rationale: `${processId} 专业人员确认当前候选`,
        evidenceReceiptIds: [t3CustomerEvidence.receipt.receiptId, t3SupplierEvidence.receipt.receiptId],
      },
    });
    gateReceipts.push(response.receipt);
  }

  const collaborationProjection = await projection(baseUrl, sid['collaboration-manager']);
  const management = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/actions/management`, {
    method: 'POST',
    sessionId: sid['collaboration-manager'],
    body: {
      requestId: `${runLabel}-management`,
      expectedContextVersion: 'CTX-0003',
      actionCode: 'PRIORITIZE_COMMENCEMENT',
      targetPrincipalIds: ['business-owner', 'risk-commercial'],
      rationale: '请业务与商务优先完成正式起租复核，不替代专业 Gate',
      evidenceOrProjectionRefs: [collaborationProjection.projectionVersion],
    },
  });
  assert.equal(management.receipt.receiptType, 'management_action');

  const commencement = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/actions/commencement`, {
    method: 'POST',
    sessionId: sid['risk-commercial'],
    body: {
      requestId: `${runLabel}-commencement`,
      expectedContextVersion: 'CTX-0003',
      conditionSetVersion: collaborationProjection.commencementState.conditionSetVersion,
      requiredReceiptIds: gateReceipts.map((receipt) => receipt.receiptId),
      rationale: '必要专业 Gate、合同、设备交付与付款条件已满足，正式起租',
    },
  });
  assert.equal(commencement.receipt.status, 'commenced');
  const finalProjection = await projection(baseUrl, sid['collaboration-manager']);
  assert.equal(finalProjection.commencementState.band, 5);
  assert.equal(finalProjection.commencementState.lifecycleStatus, 'active_lease');
  assert.equal(finalProjection.contextVersion, 'CTX-0003');

  const portfolioAfter = await jsonRequest(baseUrl, '/api/v3/portfolio/projection', {
    sessionId: sid['collaboration-manager'],
  });
  assert.equal(portfolioAfter.cases.find((item) => item.caseId === CASE_ID).commencementBand, 5);
  assert.equal(portfolioAfter.northStar, '可验证净收入 / 单位资产产出效率');
  assert.deepEqual(portfolioAfter.northStarDefinition, {
    primaryMetricClasses: ['net_income', 'unit_asset_net_income'],
    auxiliaryMetricClasses: ['full_cycle_profit'],
  });
  const beforeNetIncome = portfolioBefore.kpis.find((metric) => metric.metricClass === 'net_income');
  const afterNetIncome = portfolioAfter.kpis.find((metric) => metric.metricClass === 'net_income');
  const afterUnitAsset = portfolioAfter.kpis.find((metric) => metric.metricClass === 'unit_asset_net_income');
  const afterFullCycle = portfolioAfter.kpis.find((metric) => metric.metricClass === 'full_cycle_profit');
  assert.ok(beforeNetIncome && afterNetIncome && afterUnitAsset && afterFullCycle);
  assert.ok(afterNetIncome.value > beforeNetIncome.value);
  assert.equal(afterNetIncome.valueClass, 'scenario');
  assert.equal(afterUnitAsset.valueClass, 'scenario');
  assert.equal(afterFullCycle.valueClass, 'forecast');
  assert.equal(afterFullCycle.timeScope, 'full_lifecycle');
  for (const metric of portfolioAfter.kpis) {
    assert.ok(metric.metricDefinitionId.startsWith('JW-'));
    assert.ok(metric.formulaVersion.endsWith('-v1'));
    assert.equal(metric.currency, 'CNY');
    assert.equal(metric.current, metric.value);
    assert.equal(metric.variance, metric.deltaToDue);
    assert.equal(metric.dataCoverage.status, 'synthetic_demo_only');
    assert.equal(metric.dataCoverage.reconciliationStatus, 'not_connected');
    assert.ok(metric.sourceReceiptRefs.some((ref) => ref.receiptId === commencement.receipt.receiptId));
  }

  const contexts = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/context-versions`, {
    sessionId: sid['business-owner'],
  });
  assert.deepEqual(contexts.items.map((item) => item.transitionCode), ['BASELINE', 'T1', 'T2', 'T3']);
  assert.ok(contexts.items[1].processRuns.every((run) => run.status === 'superseded'));
  assert.ok(contexts.items[2].processRuns.every((run) => run.status === 'superseded'));
  const events = await collectAllEvents(baseUrl, sid['collaboration-manager']);
  const receiptRefs = [...new Map([
    ...contexts.items.flatMap((context) => context.receiptRefs ?? []),
    ...finalProjection.visibleReceiptRefs,
  ].map((ref) => [ref.receiptId, ref])).values()];
  const receipts = [];
  for (const ref of receiptRefs) {
    const response = await jsonRequest(baseUrl, `/api/v3/cases/${CASE_ID}/receipts/${encodeURIComponent(ref.receiptId)}`, {
      sessionId: sid['business-owner'],
    });
    receipts.push(response.receipt);
  }
  const externalReceiptRead = await jsonRequest(
    baseUrl,
    `/api/v3/cases/${CASE_ID}/receipts/${encodeURIComponent(t3SupplierEvidence.receipt.receiptId)}`,
    { sessionId: sid['external-customer'], expectedStatus: 403 },
  );
  assert.equal(externalReceiptRead.error.code, 'RECEIPT_SCOPE_DENIED');

  return {
    runLabel,
    runtimeEpoch: reset.runtimeEpoch,
    eventCount: events.length,
    receiptCount: receiptRefs.length,
    negativeChecks: 5,
    normalized: normalizedStructure({
      scenario, contexts, events, receipts, finalProjection, portfolioBefore, portfolioAfter,
    }),
  };
}

function parseBaseUrl(argv) {
  const index = argv.indexOf('--base-url');
  return index >= 0 ? argv[index + 1] : process.env.V3_BASE_URL ?? 'http://localhost:3000';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runV3FullScenario({ baseUrl: parseBaseUrl(process.argv) });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runLabel: result.runLabel,
    runtimeEpoch: result.runtimeEpoch,
    eventCount: result.eventCount,
    receiptCount: result.receiptCount,
    negativeChecks: result.negativeChecks,
  }, null, 2)}\n`);
}
