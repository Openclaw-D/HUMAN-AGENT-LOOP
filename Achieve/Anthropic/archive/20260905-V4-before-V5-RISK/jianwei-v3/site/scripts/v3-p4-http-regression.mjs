import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, '..');
const evidenceDir = path.join(siteRoot, 'evidence', 'v3-p4-final');
const statePath = path.join(evidenceDir, 'g2-restart-state.json');

const CASE_CONTEXT = {
  grain: 'case',
  portfolioId: 'PORTFOLIO-JW-DEMO',
  divisionId: 'DIV-EAST',
  caseId: 'FL-DEMO-001',
};

const FORMAL_ROUTES = [
  '/',
  '/collaboration',
  '/value',
  '/opportunity',
  '/insight',
  '/business',
  '/policy',
  '/credit',
  '/commercial',
  '/asset',
];

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = argument('--base-url', process.env.V3_BASE_URL ?? 'http://localhost:4311');
const phase = argument('--phase', 'pre-restart');

function endpoint(pathname) {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.sessionId) headers.set('x-jw-demo-session', options.sessionId);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(endpoint(pathname), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  assert.ok(expected.includes(response.status), `${options.method ?? 'GET'} ${pathname}: expected ${expected.join('/')}, got ${response.status}: ${JSON.stringify(payload)}`);
  return { status: response.status, payload };
}

async function createSession(principalId) {
  const { payload } = await request('/api/v3/demo/session', {
    method: 'POST',
    body: { principalId },
  });
  assert.equal(payload.session.principalId, principalId);
  return payload.session;
}

function contextQuery() {
  const params = new URLSearchParams({
    role: 'business',
    grain: CASE_CONTEXT.grain,
    portfolioId: CASE_CONTEXT.portfolioId,
    divisionId: CASE_CONTEXT.divisionId,
    caseId: CASE_CONTEXT.caseId,
  });
  return params.toString();
}

async function verifyRoutes() {
  const results = [];
  for (const pathname of FORMAL_ROUTES) {
    const response = await fetch(endpoint(pathname), { redirect: 'manual' });
    results.push({ pathname, status: response.status });
    assert.equal(response.status, 200, `${pathname} must return 200`);
  }
  return results;
}

async function preRestart() {
  await mkdir(evidenceDir, { recursive: true });
  const routes = await verifyRoutes();
  const { payload: scenario } = await request('/api/v3/demo/scenario');
  assert.equal(scenario.persistence, 'sqlite_local_demo');

  const leadership = await createSession('collaboration-manager');
  const business = await createSession('business-owner');
  const policy = await createSession('risk-policy');
  const asset = await createSession('risk-asset');
  const customer = await createSession('external-customer');

  const { payload: sqliteContext } = await request(`/api/v3/shared/context?${contextQuery()}`, {
    sessionId: business.sessionId,
  });
  assert.equal(sqliteContext.current.caseId, 'FL-DEMO-001');

  const { payload: golden } = await request('/api/v3/asset/cases/FL-DEMO-001/workbench', {
    sessionId: asset.sessionId,
  });
  assert.equal(golden.provenance.source, 'shared-v3-sqlite');

  const { payload: background } = await request('/api/v3/asset/cases/FL-BG-001/workbench', {
    sessionId: asset.sessionId,
  });
  assert.equal(background.professionalProjections.asset.rollup.continuousPercent, null);
  assert.equal(background.professionalProjections.asset.rollup.quarterThreshold, null);
  assert.equal(background.professionalProjections.asset.result, '未提供');

  const stamp = Date.now();
  const singleflightBody = {
    requestId: `G2-SINGLEFLIGHT-${stamp}`,
    context: CASE_CONTEXT,
    text: '@见微 G2 并发同键候选检查',
  };
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => request('/api/v3/shared/messages', {
    method: 'POST',
    sessionId: business.sessionId,
    body: singleflightBody,
  })));
  const messageIds = concurrent.map(({ payload }) => payload.message.messageId);
  const candidateIds = concurrent.map(({ payload }) => payload.candidate?.messageId ?? null);
  assert.equal(new Set(messageIds).size, 1);
  assert.equal(new Set(candidateIds).size, 1);
  const { payload: internalAfterSingleflight } = await request(`/api/v3/shared/messages?${contextQuery()}`, {
    sessionId: business.sessionId,
  });
  assert.equal(internalAfterSingleflight.messages.filter((item) => item.requestId === singleflightBody.requestId && item.actorKind === 'human').length, 1);

  const internalRequestId = `G2-INTERNAL-${stamp}`;
  const invitedRequestId = `G2-CUSTOMER-${stamp}`;
  await request('/api/v3/shared/messages', {
    method: 'POST', sessionId: business.sessionId,
    body: { requestId: internalRequestId, context: CASE_CONTEXT, text: '@政策 内部专业讨论' },
  });
  await request('/api/v3/shared/messages', {
    method: 'POST', sessionId: business.sessionId,
    body: { requestId: invitedRequestId, context: CASE_CONTEXT, text: '@客户 请补充邀请范围材料' },
  });
  const { payload: customerProjection } = await request(`/api/v3/shared/messages?${contextQuery()}`, {
    sessionId: customer.sessionId,
  });
  assert.equal(customerProjection.messages.some((item) => item.requestId === internalRequestId), false);
  assert.equal(customerProjection.messages.some((item) => item.requestId === invitedRequestId), true);
  assert.equal(customerProjection.receipts.some((item) => item.formal || item.receiptType === 'human_gate'), false);

  const invalidLineage = await request('/api/v3/policy/cases/FL-DEMO-001/actions', {
    method: 'POST',
    sessionId: policy.sessionId,
    expectedStatus: 404,
    body: {
      requestId: `G2-INVALID-LINEAGE-${stamp}`,
      expectedContextVersion: golden.contextVersion,
      actionType: 'reject',
      rationale: 'invalid candidate receipt must fail closed',
      evidenceReceiptIds: ['candidate-not-a-canonical-evidence-receipt'],
    },
  });
  assert.equal(invalidLineage.payload.error.code, 'EVIDENCE_RECEIPT_NOT_FOUND');

  const crossCase = await request('/api/v3/policy/cases/FL-BG-001/actions', {
    method: 'POST',
    sessionId: policy.sessionId,
    expectedStatus: 403,
    body: {
      requestId: `G2-CROSS-CASE-${stamp}`,
      expectedContextVersion: golden.contextVersion,
      actionType: 'reject',
      rationale: 'cross-case write must fail closed',
      evidenceReceiptIds: ['candidate-not-a-canonical-evidence-receipt'],
    },
  });
  assert.equal(crossCase.payload.error.code, 'BACKGROUND_CASE_READ_ONLY');

  const unauthorizedReset = await request('/api/v3/shared/demo-reset', {
    method: 'POST',
    sessionId: business.sessionId,
    expectedStatus: 403,
    body: { requestId: `G2-UNAUTHORIZED-RESET-${stamp}`, confirmation: 'RESET_DEMO' },
  });
  assert.equal(unauthorizedReset.payload.error.code, 'ACTION_SCOPE_DENIED');

  const authorizedReset = await request('/api/v3/shared/demo-reset', {
    method: 'POST',
    sessionId: leadership.sessionId,
    body: { requestId: `G2-AUTHORIZED-RESET-${stamp}`, confirmation: 'RESET_DEMO' },
  });
  assert.equal(authorizedReset.payload.messageCount, 0);
  const { payload: cleared } = await request(`/api/v3/shared/messages?${contextQuery()}`, {
    sessionId: business.sessionId,
  });
  assert.equal(cleared.messages.length, 0);
  assert.equal(cleared.candidates.length, 0);

  const evidence = {
    phase: 'pre-restart',
    baseUrl,
    routes,
    persistence: scenario.persistence,
    runtimeEpoch: authorizedReset.payload.runtimeEpoch,
    checks: {
      sqliteReadiness: 'PASS',
      crossRouteSession: 'PASS',
      nullProgress: 'PASS',
      sameKeyConcurrentCount: concurrent.length,
      sameKeyUniqueMessageIds: new Set(messageIds).size,
      sameKeyUniqueCandidateIds: new Set(candidateIds).size,
      invalidLineageCode: invalidLineage.payload.error.code,
      crossCaseCode: crossCase.payload.error.code,
      externalInternalMessageVisible: false,
      externalFormalReceiptVisible: false,
      unauthorizedResetCode: unauthorizedReset.payload.error.code,
      authorizedResetCleared: true,
    },
  };
  await writeFile(statePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function postRestart() {
  const before = JSON.parse(await readFile(statePath, 'utf8'));
  const routes = await verifyRoutes();
  const business = await createSession('business-owner');
  const { payload: context } = await request(`/api/v3/shared/context?${contextQuery()}`, {
    sessionId: business.sessionId,
  });
  const { payload: conversation } = await request(`/api/v3/shared/messages?${contextQuery()}`, {
    sessionId: business.sessionId,
  });
  assert.equal(context.runtimeEpoch, before.runtimeEpoch);
  assert.equal(conversation.runtimeEpoch, before.runtimeEpoch);
  assert.equal(conversation.messages.length, 0);
  assert.equal(conversation.candidates.length, 0);
  const evidence = {
    phase: 'post-restart',
    baseUrl,
    routes,
    runtimeEpochBefore: before.runtimeEpoch,
    runtimeEpochAfter: context.runtimeEpoch,
    messagesAfterRestart: conversation.messages.length,
    candidatesAfterRestart: conversation.candidates.length,
    resetPersistence: 'PASS',
  };
  await writeFile(path.join(evidenceDir, 'g2-post-restart.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function advanceRuns(sessionId, runs, label) {
  for (const run of runs) {
    await request('/api/v3/demo/process-runs/advance', {
      method: 'POST', sessionId,
      body: { requestId: `${label}-start-${run.processId}`, runId: run.runId, phase: 'start' },
    });
  }
  for (const run of runs) {
    await request('/api/v3/demo/process-runs/advance', {
      method: 'POST', sessionId,
      body: { requestId: `${label}-result-${run.processId}`, runId: run.runId, phase: 'result' },
    });
  }
}

async function acceptEvidence(sessionId, body) {
  const { payload } = await request('/api/v3/cases/FL-DEMO-001/evidence', {
    method: 'POST', sessionId, body,
  });
  return payload.receipt;
}

async function prepareBrowser() {
  const leadership = await createSession('collaboration-manager');
  const business = await createSession('business-owner');
  const policy = await createSession('risk-policy');
  const customer = await createSession('external-customer');
  const supplier = await createSession('external-supplier');
  const stamp = Date.now();

  const { payload: reset } = await request('/api/v3/demo/reset', {
    method: 'POST', sessionId: leadership.sessionId, body: {},
  });
  assert.equal(reset.currentContext.contextVersion, 'CTX-0000');

  const t1Evidence = await acceptEvidence(business.sessionId, {
    requestId: `G3-T1-EVIDENCE-${stamp}`,
    evidenceId: `G3-T1-EV-${stamp}`,
    evidenceType: 'opportunity_fact_pack',
    sourceRef: 'synthetic://g3/t1/opportunity',
    contentHash: `sha256:g3-t1-${stamp}`,
    processId: 'opportunity',
  });
  const { payload: t1 } = await request('/api/v3/cases/FL-DEMO-001/context-commits', {
    method: 'POST', sessionId: business.sessionId,
    body: {
      requestId: `G3-T1-COMMIT-${stamp}`,
      transitionCode: 'T1', expectedContextVersion: 'CTX-0000',
      evidenceReceiptIds: [t1Evidence.receiptId],
      confirmedFactIds: ['g3-customer-intent'],
      rationale: 'G3 browser fixture T1',
    },
  });
  await advanceRuns(leadership.sessionId, t1.runs, `G3-T1-${stamp}`);

  const t2Evidence = await acceptEvidence(customer.sessionId, {
    requestId: `G3-T2-EVIDENCE-${stamp}`,
    evidenceId: `G3-T2-EV-${stamp}`,
    evidenceType: 'customer_risk_fact',
    sourceRef: 'synthetic://g3/t2/customer',
    contentHash: `sha256:g3-t2-${stamp}`,
    processId: 'opportunity',
  });
  const { payload: t2 } = await request('/api/v3/cases/FL-DEMO-001/context-commits', {
    method: 'POST', sessionId: customer.sessionId,
    body: {
      requestId: `G3-T2-COMMIT-${stamp}`,
      transitionCode: 'T2', expectedContextVersion: 'CTX-0001',
      evidenceReceiptIds: [t2Evidence.receiptId],
      confirmedFactIds: ['g3-customer-risk'],
      rationale: 'G3 browser fixture T2',
    },
  });
  await advanceRuns(leadership.sessionId, t2.runs, `G3-T2-${stamp}`);

  const t3Customer = await acceptEvidence(customer.sessionId, {
    requestId: `G3-T3-CUSTOMER-${stamp}`,
    evidenceId: `G3-T3-CUSTOMER-EV-${stamp}`,
    evidenceType: 'customer_remediation_pack',
    sourceRef: 'synthetic://g3/t3/customer',
    contentHash: `sha256:g3-t3-customer-${stamp}`,
    processId: 'opportunity',
  });
  const t3Supplier = await acceptEvidence(supplier.sessionId, {
    requestId: `G3-T3-SUPPLIER-${stamp}`,
    evidenceId: `G3-T3-SUPPLIER-EV-${stamp}`,
    evidenceType: 'device_delivery_pack',
    sourceRef: 'synthetic://g3/t3/supplier',
    contentHash: `sha256:g3-t3-supplier-${stamp}`,
    processId: 'commercial',
  });
  const t3Policy = await acceptEvidence(business.sessionId, {
    requestId: `G3-T3-POLICY-${stamp}`,
    evidenceId: `G3-T3-POLICY-EV-${stamp}`,
    evidenceType: 'policy_rule_pack',
    sourceRef: 'synthetic://g3/t3/policy',
    contentHash: `sha256:g3-t3-policy-${stamp}`,
    processId: 'policy',
  });
  const { payload: t3 } = await request('/api/v3/cases/FL-DEMO-001/context-commits', {
    method: 'POST', sessionId: business.sessionId,
    body: {
      requestId: `G3-T3-COMMIT-${stamp}`,
      transitionCode: 'T3', expectedContextVersion: 'CTX-0002',
      evidenceReceiptIds: [t3Customer.receiptId, t3Supplier.receiptId, t3Policy.receiptId],
      confirmedFactIds: ['g3-risk-remediated', 'g3-delivery-confirmed', 'g3-policy-ready'],
      rationale: 'G3 browser fixture T3 with policy Evidence lineage',
    },
  });
  await advanceRuns(leadership.sessionId, t3.runs, `G3-T3-${stamp}`);

  const { payload: model } = await request('/api/v3/policy/cases/FL-DEMO-001/workbench', {
    sessionId: policy.sessionId,
  });
  const evidenceIds = model.professionalProjections.policy.evidenceSources
    .flatMap((source) => source.evidenceReceiptId ? [source.evidenceReceiptId] : []);
  assert.equal(model.contextVersion, 'CTX-0003');
  assert.equal(model.professionalProjections.policy.runStatus, 'ready_for_gate');
  assert.equal(model.professionalProjections.policy.humanGate.status, 'not_recorded');
  assert.ok(evidenceIds.includes(t3Policy.receiptId));
  const evidence = {
    phase: 'prepare-browser',
    baseUrl,
    runtimeEpoch: model.runtimeEpoch,
    contextVersion: model.contextVersion,
    policyRunStatus: model.professionalProjections.policy.runStatus,
    policyEvidenceReceiptId: t3Policy.receiptId,
    policyGateStatus: model.professionalProjections.policy.humanGate.status,
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'g3-browser-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (phase === 'pre-restart') await preRestart();
else if (phase === 'post-restart') await postRestart();
else if (phase === 'prepare-browser') await prepareBrowser();
else throw new Error('phase must be pre-restart, post-restart, or prepare-browser');
