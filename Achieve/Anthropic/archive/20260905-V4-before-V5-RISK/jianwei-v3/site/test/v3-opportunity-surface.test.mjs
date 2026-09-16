import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  OPPORTUNITY_GOLDEN_CASE_ID,
  OPPORTUNITY_GOLDEN_ID,
  createOpportunityClient,
} from '../app/v3-surfaces/opportunity/opportunity-client.ts';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function caseItem(overrides = {}) {
  return {
    caseId: OPPORTUNITY_GOLDEN_CASE_ID,
    businessItemType: 'FinancingLeasingCase',
    caseTier: 'golden',
    readOnly: false,
    title: '智能产线设备直接租赁',
    counterparty: '华东智造科技有限公司',
    industry: '装备制造',
    region: '江苏 · 苏州',
    amount: '2,800 万',
    phase: '商机事实待确认',
    lifecycleStatus: 'pre_commencement',
    signal: 'attention',
    nextMilestone: 'T1 商机事实包确认',
    commencementBand: 0,
    roleScopedSummary: '固定直接租赁 Golden Case。',
    allowedEntryActions: ['view_summary', 'open_workbench'],
    ...overrides,
  };
}

function casePanel(backgroundCount = 4) {
  return {
    roleApplicationId: 'business',
    principalId: 'business-owner',
    scenarioRef: {
      scenarioId: 'JW-V3-DL-GOLDEN-001', scenarioVersion: '1.0.0-macro', seed: 'seed',
      businessItemType: 'FinancingLeasingCase', caseId: OPPORTUNITY_GOLDEN_CASE_ID,
      leaseMode: 'direct-lease', dataClass: 'synthetic_deidentified_demo',
    },
    items: [caseItem(), ...Array.from({ length: backgroundCount }, (_, index) => caseItem({
      caseId: `FL-BG-00${index + 1}`,
      caseTier: 'background',
      readOnly: true,
      title: `背景事项 ${index + 1}`,
      allowedEntryActions: ['view_summary'],
    }))],
  };
}

function readModel(entries = []) {
  return {
    projectionType: 'OpportunityReadModel',
    projectionVersion: 'epoch-1-0',
    grain: 'Opportunity',
    opportunityId: OPPORTUNITY_GOLDEN_ID,
    caseId: OPPORTUNITY_GOLDEN_CASE_ID,
    caseTier: 'golden',
    readOnly: false,
    scenarioRef: { scenarioId: 'JW-V3-DL-GOLDEN-001', scenarioVersion: '1.0.0-macro', seed: 'seed' },
    title: '智能产线设备直接租赁',
    stage: '商机事实待确认',
    nextAction: 'T1 商机事实包确认',
    relationships: {
      nodes: [
        { nodeId: 'CUSTOMER', kind: 'customer', label: '华东智造科技有限公司', availability: 'available', sourceRef: 'shared-case' },
        { nodeId: OPPORTUNITY_GOLDEN_ID, kind: 'opportunity', label: '智能产线设备直接租赁·商机', availability: 'available', sourceRef: 'shared-case' },
        { nodeId: 'SUPPLIER', kind: 'supplier', label: '未提供', availability: 'unavailable', sourceRef: 'shared-case' },
        { nodeId: 'CASE', kind: 'case', label: '智能产线设备直接租赁', availability: 'available', sourceRef: 'shared-case' },
      ],
      edges: [],
      unavailableRelationships: ['supplier'],
    },
    materials: {
      items: [{ materialId: 'M-1', label: '订单稳定性', status: 'needed', detail: '补充订单与回款说明', sourceRef: 'shared-blocker' }],
      completeness: { availability: 'unavailable', value: null, display: '未提供', unit: 'evidence-coverage-band', valueClass: null, source: null, provenance: [], asOf: null },
      emptyDisplay: null,
    },
    responsibilityMatrix: [
      ['business', 'orchestrates', false],
      ['policy', 'professional-judgment', true],
      ['credit', 'professional-judgment', true],
      ['commercial', 'professional-judgment', true],
      ['asset', 'professional-judgment', true],
    ].map(([role, responsibility, canSubmitProfessionalGate]) => ({ role, responsibility, canSubmitProfessionalGate })),
    allowedBusinessActions: ['initiate', 'organize', 'assign', 'remind', 'supplement', 'terminate'],
    forbiddenBusinessActions: ['professional_review', 'professional_gate'],
    chatContext: { availability: 'available', contextId: 'CTX-OPPORTUNITY', contextVersion: 'CTX-0000', messages: entries, source: 'shared-v3-sqlite-chat' },
  };
}

function readyState(entries = []) {
  return { status: 'ready', data: readModel(entries), error: null, empty: null };
}

test('loads the dedicated Opportunity read model with one Golden Case and four summaries', async () => {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, init });
    if (path.endsWith('/demo/session')) return jsonResponse({ session: { sessionId: 'SESSION-OPPORTUNITY', principalId: 'business-owner', roleApplicationId: 'business', invitation: null } });
    if (path.endsWith('/api/v3/cases')) return jsonResponse(casePanel());
    if (path.endsWith('/projection')) return jsonResponse(readyState());
    throw new Error(`unexpected path ${path}`);
  };
  const ready = await createOpportunityClient({ fetchImpl }).initialize();
  assert.equal(ready.readModel.grain, 'Opportunity');
  assert.equal(ready.readModel.opportunityId, OPPORTUNITY_GOLDEN_ID);
  assert.equal(ready.backgroundCases.length, 4);
  assert.deepEqual(ready.chatCapability, { enabled: true, denialCode: null });
  assert.deepEqual(JSON.parse(requests[0].init.body), { principalId: 'business-owner' });
  assert.ok(requests.some((request) => request.path.endsWith(`/opportunity/${OPPORTUNITY_GOLDEN_ID}/projection`)));
});

test('posts to the dedicated Opportunity chat and reconciles a non-formal authority-none candidate', async () => {
  const requests = [];
  let eventWritten = false;
  const message = {
    messageId: 'MESSAGE-OPPORTUNITY-1', contextId: 'CTX-OPPORTUNITY', contextVersion: 'CTX-0000', requestId: 'opportunity-fixed-id',
    actorKind: 'human', actorRole: 'business', authority: 'none', text: '@信审 Agent 请复核已补充的订单说明',
    replyToMessageId: null, scenarioRef: readModel().scenarioRef, createdAt: '2026-08-30T00:00:00.000Z',
  };
  const candidateReply = {
    candidateId: 'CANDIDATE-1', kind: 'ai_candidate', status: 'candidate', completion: 'not_formal_completion', authority: 'none',
    routedTo: 'credit', text: '信审 Agent 候选回复', result: { text: '信审 Agent 候选回复' },
    disclaimer: 'AI candidate · authority none', contextVersion: 'CTX-0000', createdAt: '2026-08-30T00:00:00.000Z',
  };
  const chatContext = { ...readModel([message]).chatContext };
  const fetchImpl = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, init });
    if (path.endsWith('/messages')) { eventWritten = true; return jsonResponse({
      status: 'accepted', completion: 'message_persisted', authority: 'none', message,
      routes: [{ target: 'credit', targetRole: 'credit', status: 'candidate_ready', retryable: false, error: null }],
      candidates: [candidateReply], receiptId: 'RECEIPT-1', replayed: false, chatContext,
    }); }
    if (path.endsWith('/api/v3/cases')) return jsonResponse(casePanel());
    if (path.endsWith('/projection')) return jsonResponse(readyState(eventWritten ? [message] : []));
    throw new Error(`unexpected path ${path}`);
  };
  const ready = await createOpportunityClient({ fetchImpl }).sendMessage({
    sessionId: 'SESSION-OPPORTUNITY', requestId: 'opportunity-fixed-id', message: '  @信审 Agent 请复核已补充的订单说明  ',
  });
  const messageRequest = requests.find((request) => request.path.endsWith('/messages'));
  assert.deepEqual(JSON.parse(messageRequest.init.body), {
    requestId: 'opportunity-fixed-id', message: '@信审 Agent 请复核已补充的订单说明',
  });
  assert.equal(ready.lastMessageEventId, message.messageId);
  assert.equal(ready.candidateReplies[0].status, 'candidate');
  assert.equal(ready.candidateReplies[0].authority, 'none');
  assert.equal(ready.candidateReplies[0].completion, 'not_formal_completion');
  assert.equal(ready.routeStates[0].status, 'candidate_ready');
});

test('fails closed when the shared scenario does not contain 4–6 background summaries', async () => {
  const fetchImpl = async (input) => {
    const path = String(input);
    if (path.endsWith('/demo/session')) return jsonResponse({ session: { sessionId: 'SESSION-OPPORTUNITY', principalId: 'business-owner', roleApplicationId: 'business', invitation: null } });
    if (path.endsWith('/api/v3/cases')) return jsonResponse(casePanel(3));
    if (path.endsWith('/projection')) return jsonResponse(readyState());
    throw new Error(`unexpected path ${path}`);
  };
  await assert.rejects(createOpportunityClient({ fetchImpl }).initialize(), (error) => error.code === 'INVALID_OPPORTUNITY_CASE_SET');
});

test('surface contract keeps three modes, explicit missing data, candidate authority, and the 80/20 adapter', async () => {
  const source = await readFile(new URL('../app/v3-surfaces/opportunity/opportunity-page-adapter.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/v3-surfaces/opportunity/opportunity-surface.module.css', import.meta.url), 'utf8');
  const sharedCss = await readFile(new URL('../app/v3-surfaces/shared/surface-shell.module.css', import.meta.url), 'utf8');
  assert.match(source, /SharedSurfaceShell/);
  assert.match(source, /activeMode === 'relationship'/);
  assert.match(source, /activeMode === 'path'/);
  assert.match(source, /activeMode === 'matrix'/);
  assert.match(source, /供应商未提供/);
  assert.match(source, /不以 0 代替缺失数据/);
  assert.match(source, /candidate · authority none/);
  assert.match(source, /与正式完成、专业结论和 Gate 分离/);
  assert.equal(source.match(/<h1\b/g)?.length, 1);
  assert.match(sharedCss, /grid-template-columns: minmax\(0, 4fr\) minmax\(320px, 1fr\)/);
  assert.match(sharedCss, /height: 104px/);
  assert.match(sharedCss, /\.progressDisc i\[data-filled="true"\]\s*\{\s*background: #FF8A3D;/i);
  for (const opacity of ['.25', '.5', '.75', '1']) assert.match(sharedCss, new RegExp(`opacity: ${opacity.replace('.', '\\.')}`));
  assert.match(css, /#ff8a3d/i);
});
