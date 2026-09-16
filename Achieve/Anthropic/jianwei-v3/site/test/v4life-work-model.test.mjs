// V4-LIFE /work 模型层测试（Lane W1：app/work/workspace-model.ts）。
// 进程内模式（同 v4life-lane-c-http.test.mjs）：fetchImpl 用桩直接调用真实 route handler，
// 不启动网络服务、不发起真实网络请求。selectors 用真实引擎（契约 §7 API）把 §11+§14.2 fixture
// 驱动到多状态后断言各 selector 输出。
//
// 未测项（如实标注）：useCaseProjection / useWorkspaceActions 两个 React hooks 需要 DOM renderer
// （react-dom/client + act 环境），本仓库不允许新增依赖，node:test 内建 runner 无此环境，故不测；
// 其逻辑极薄（轮询/pendingKeys/setFeedback），核心纪律（命令 client 的 retry/错误映射、selectors 纯派生）
// 已在本文件全量覆盖。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createV4LifeEngine } from '../lib/v4life/engine.ts';
import { createV4LifeDemoSeed, V4LIFE_DEMO_CASE_ID } from '../lib/v4life/seed.ts';
import { getOrCreateV4LifeDemoEngine, resetV4LifeRuntime } from '../lib/v4life/runtime.ts';
import { GET as getCaseProjection } from '../app/api/v4life/cases/[caseId]/route.ts';
import { GET as getEventsRoute } from '../app/api/v4life/cases/[caseId]/events/route.ts';
import { POST as postEvidence } from '../app/api/v4life/cases/[caseId]/evidence/route.ts';
import { POST as postWork } from '../app/api/v4life/cases/[caseId]/work/route.ts';
import { POST as postDecision } from '../app/api/v4life/cases/[caseId]/decisions/route.ts';
import { POST as postReset } from '../app/api/v4life/demo/reset/route.ts';
import {
  DOMAIN_LABELS,
  WorkspaceError,
} from '../app/work/workspace-contract.ts';
import {
  createWorkspaceClient,
  workspaceSelectors,
} from '../app/work/workspace-model.ts';

// ---------------------------------------------------------------------------
// selectors：真实引擎驱动 §11+§14.2 fixture
// ---------------------------------------------------------------------------

const {
  selectCaseMeta,
  selectActor,
  selectDomainViews,
  selectWorkItem,
  selectGate,
  selectSupplementRequests,
  selectEvidenceList,
  selectReceipts,
  selectContributions,
  selectCandidates,
  waitingReasonOf,
  canSubmitWork,
  canDecide,
} = workspaceSelectors;

function makeEngine() {
  return createV4LifeEngine(createV4LifeDemoSeed(), { now: () => '2026-09-04T08:00:00.000Z' });
}

let commandSeq = 0;

function cmd(engine, overrides = {}) {
  commandSeq += 1;
  return { commandId: `sel-cmd-${commandSeq}`, expectedRev: engine.rev, ...overrides };
}

function submitFinancial(engine) {
  return engine.appendEvidence(cmd(engine, {
    evidenceId: 'ev-financial-statement',
    kind: 'financial_statement',
    title: '2025 年度审计报告摘要',
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '营收同比下滑约 18%，经营现金流为负，账面货币资金约 320 万元。',
      tags: ['revenue_declining', 'audited'],
      amountCny: 3_200_000,
    },
  }));
}

function submitContract(engine) {
  return engine.appendEvidence(cmd(engine, {
    evidenceId: 'ev-contract-draft',
    kind: 'contract_draft',
    title: '设备采购合同草案',
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '设备采购与流动资金用途合同草案，金额与申请口径一致。',
      tags: ['draft_v1'],
      amountCny: 5_200_000,
    },
  }));
}

function doWork(engine, workItemId, actorId, summary) {
  return engine.submitWork(cmd(engine, { workItemId, actorId, outputSummary: summary }));
}

function decideGate(engine, gateId, actorId, outcome, reason) {
  return engine.recordDecision(cmd(engine, { gateId, actorId, outcome, reason }));
}

/** 驱动到「PG-1 已开启待决定」状态：财务+合同证据已受理，WI-C1/WI-C2/WI-B1 已完成或进行中，WI-P1 已提交。 */
function makeOpenGateEngine() {
  const engine = makeEngine();
  submitFinancial(engine);
  submitContract(engine);
  doWork(engine, 'WI-C1', 'actor-credit-zhang', '信审材料完整性核验完成，缺尽调标记已提补件。');
  doWork(engine, 'WI-C2', 'actor-credit-zhang', '客户偿付能力交叉核验完成。');
  doWork(engine, 'WI-P1', 'actor-policy-li', '政策准入规则符合性初核完成。');
  return engine;
}

test('selectors 基础：caseMeta/actor/workItem/gate/列表在种子初始态派生正确', () => {
  const engine = makeEngine();
  const projection = engine.getProjection();

  const meta = selectCaseMeta(projection);
  assert.equal(meta.caseId, V4LIFE_DEMO_CASE_ID);
  assert.equal(meta.eventCount, projection.eventCount);
  assert.equal(meta.evidenceCount, 1);
  assert.equal(meta.rev, projection.rev);
  assert.equal(meta.financingAmountCny, 5_000_000);

  const li = selectActor(projection, 'actor-policy-li');
  assert.equal(li.displayName, '李审（政策）');
  assert.equal(selectActor(projection, 'actor-nobody'), undefined);

  const c1 = selectWorkItem(projection, 'WI-C1');
  assert.equal(c1.status, 'in_progress');
  assert.equal(selectWorkItem(projection, 'WI-NOPE'), undefined);

  const pg1 = selectGate(projection, 'PG-1');
  assert.equal(pg1.status, 'pending');
  assert.equal(pg1.requiredRole, 'policy');
  assert.equal(selectGate(projection, 'NOPE'), undefined);

  assert.equal(selectEvidenceList(projection).length, 1);
  assert.equal(selectReceipts(projection).length, 0);
  assert.equal(selectContributions(projection).length, 0);
  const candidates = selectCandidates(projection);
  assert.equal(candidates.length, 1, '初始上游 Context 缺 due_diligence_report 标记，应有一条 R2 缺件 Candidate');
  assert.equal(candidates[0].kind, 'missing_document');
  assert.equal(candidates[0].authority, 'none');
  assert.equal(candidates[0].producedBy, 'deterministic-v1');
  assert.deepEqual(candidates[0].basis, ['ev-upstream-context']);
});

test('selectDomainViews 初始态：四域固定序、actor 映射、nextItemId 与汇总等待原因', () => {
  const projection = makeEngine().getProjection();
  const views = selectDomainViews(projection);

  assert.deepEqual(
    views.map((view) => view.domain),
    ['policy', 'credit', 'commerce', 'asset'],
    '四域固定序 policy/credit/commerce/asset',
  );
  assert.deepEqual(
    views.map((view) => view.label),
    ['政策', '信审', '商务', '资产'],
  );
  assert.deepEqual(
    views.map((view) => view.actor?.actorId),
    ['actor-policy-li', 'actor-credit-zhang', 'actor-commerce-wang', 'actor-asset-zhou'],
  );

  const byDomain = Object.fromEntries(views.map((view) => [view.domain, view]));
  assert.equal(byDomain.policy.openGate, undefined, '初始无 open Gate');
  assert.equal(byDomain.policy.nextItemId, 'WI-P1');
  assert.equal(byDomain.credit.nextItemId, 'WI-C1', 'credit 取第一个可操作 in_progress 项（WI-C2 仍受阻）');
  assert.equal(byDomain.commerce.nextItemId, undefined, '商务证据未到，无可操作项');
  assert.equal(byDomain.asset.nextItemId, 'WI-A1');

  assert.equal(byDomain.policy.waitingReason, '进行中 1 项。');
  assert.equal(byDomain.credit.waitingReason, '进行中 1 项；前置受阻 2 项。');
  assert.equal(byDomain.commerce.waitingReason, '前置受阻 2 项。');
  assert.equal(byDomain.asset.waitingReason, '进行中 1 项；前置受阻 1 项。');
});

test('selectSupplementRequests 初始态：blocked 缺证映射 financial/contract，R2 Candidate 映射 supplement', () => {
  const projection = makeEngine().getProjection();
  const requests = selectSupplementRequests(projection);

  assert.equal(requests.length, 3);
  assert.deepEqual(
    requests.map((request) => request.evidenceKind),
    ['financial_statement', 'contract_draft', 'supplement'],
  );

  const [financial, contract, supplement] = requests;
  assert.equal(financial.source, 'dependency');
  assert.deepEqual(financial.basis, ['WI-C2', 'ev-financial-statement']);
  assert.ok(financial.reason.includes('缺少证据 ev-financial-statement'), 'reason 来自真实依赖，不虚构');

  assert.equal(contract.source, 'dependency');
  assert.deepEqual(contract.basis, ['WI-B1', 'ev-contract-draft']);
  assert.equal(contract.evidenceKind, 'contract_draft');

  assert.equal(supplement.source, 'candidate');
  assert.deepEqual(supplement.basis, ['ev-upstream-context']);
  assert.ok(supplement.reason.includes('due_diligence_report'), 'reason 即引擎 Candidate summary');
});

test('waitingReasonOf 分档：blocked 逐条列缺项；in_progress 可提交', () => {
  const projection = makeEngine().getProjection();
  const c3 = selectWorkItem(projection, 'WI-C3');
  assert.equal(
    waitingReasonOf(projection, c3),
    '尚未开始：等待 Gate PG-1 的批准凭证；等待工作项 WI-C1 完成；等待工作项 WI-C2 完成。',
  );
  const p1 = selectWorkItem(projection, 'WI-P1');
  assert.equal(waitingReasonOf(projection, p1), '进行中，可提交工作成果。');
});

test('canSubmitWork/canDecide 初始态：允许与禁止分支（角色/状态/未知角色）', () => {
  const projection = makeEngine().getProjection();
  const c1 = selectWorkItem(projection, 'WI-C1');
  const c2 = selectWorkItem(projection, 'WI-C2');
  const pg1 = selectGate(projection, 'PG-1');

  assert.deepEqual(canSubmitWork(projection, 'actor-credit-zhang', c1), {
    allowed: true,
    reason: '可以提交工作成果。',
  });
  const mismatch = canSubmitWork(projection, 'actor-business-chen', c1);
  assert.equal(mismatch.allowed, false);
  assert.ok(mismatch.reason.includes('信审'), '角色不符提示指派角色');

  const blocked = canSubmitWork(projection, 'actor-credit-zhang', c2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reason.includes('缺少证据 ev-financial-statement'), 'blocked 项理由即 waitingReason');

  assert.equal(canSubmitWork(projection, 'actor-nobody', c1).allowed, false);
  assert.ok(canSubmitWork(projection, 'actor-nobody', c1).reason.includes('未知名角色'));

  const notOpen = canDecide(projection, 'actor-policy-li', pg1);
  assert.equal(notOpen.allowed, false);
  assert.ok(notOpen.reason.includes('尚未开启'));
});

test('驱动到 PG-1 open：openGate/nextItemId/awaiting_gate 理由/补件收敛/canDecide 允许与角色禁止', () => {
  const engine = makeOpenGateEngine();
  const projection = engine.getProjection();
  const views = selectDomainViews(projection);
  const byDomain = Object.fromEntries(views.map((view) => [view.domain, view]));

  assert.equal(byDomain.policy.openGate?.gateId, 'PG-1');
  assert.equal(byDomain.policy.nextItemId, undefined, 'WI-P1 已进入 awaiting_gate，无可操作项');
  assert.equal(byDomain.policy.waitingReason, '等待 Gate 决定 1 项。');
  assert.equal(byDomain.credit.nextItemId, undefined, 'C1/C2 已完成，C3 仍等 PG-1 Receipt');
  assert.equal(byDomain.commerce.nextItemId, 'WI-B1', '合同草案到达后商务有可操作项');
  assert.equal(byDomain.credit.waitingReason, '前置受阻 1 项；已完成 2 项。');

  const p1 = selectWorkItem(projection, 'WI-P1');
  assert.equal(
    waitingReasonOf(projection, p1),
    '等待「政策准入 Gate」（PG-1）由政策角色具名决定。',
  );

  const requests = selectSupplementRequests(projection);
  assert.equal(requests.length, 1, '财务/合同证据已到，仅剩 R2 缺件补件请求');
  assert.equal(requests[0].evidenceKind, 'supplement');
  assert.equal(requests[0].source, 'candidate');

  const candidates = selectCandidates(projection);
  assert.equal(candidates.length, 2, '财务+合同到达应另发一条 contradiction Candidate');
  assert.ok(candidates.some((candidate) => candidate.kind === 'contradiction'));

  assert.equal(selectContributions(projection).length, 3, '三次 submitWork 各记一条贡献');
  assert.equal(selectReceipts(projection).length, 0);

  assert.deepEqual(canDecide(projection, 'actor-policy-li', selectGate(projection, 'PG-1')), {
    allowed: true,
    reason: '可以对该 Gate 作出决定。',
  });
  const wrongRole = canDecide(projection, 'actor-credit-zhang', selectGate(projection, 'PG-1'));
  assert.equal(wrongRole.allowed, false);
  assert.ok(wrongRole.reason.includes('政策'));
});

test('PG-1 rejected：stopped_dependency 理由指明被否决 Gate，Receipt 入账且贡献保留', () => {
  const engine = makeOpenGateEngine();
  decideGate(engine, 'PG-1', 'actor-policy-li', 'rejected', '政策准入不符，否决。');
  const projection = engine.getProjection();

  const c3 = selectWorkItem(projection, 'WI-C3');
  assert.equal(c3.status, 'stopped_dependency');
  assert.equal(
    waitingReasonOf(projection, c3),
    '因上游 Gate PG-1 被否决而停止；已形成的贡献保留。',
  );

  const receipts = selectReceipts(projection);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].gateId, 'PG-1');
  assert.equal(receipts[0].decision.outcome, 'rejected');
  assert.equal(selectContributions(projection).length, 3, '否决后已形成贡献保留');

  const commerce = selectDomainViews(projection).find((view) => view.domain === 'commerce');
  assert.equal(commerce.waitingReason, '进行中 1 项；前置受阻 1 项。', '否决不影响无依赖的商务项');
});

test('happy path 到 CG-1/BG-1：Receipt 启动下游承接链，completed/decided 分支理由正确', () => {
  const engine = makeOpenGateEngine();
  decideGate(engine, 'PG-1', 'actor-policy-li', 'approved', '政策准入符合制度要求。');

  let projection = engine.getProjection();
  assert.equal(selectWorkItem(projection, 'WI-C3').status, 'in_progress', 'PG-1 批准后 WI-C3 启动');
  assert.equal(selectGate(projection, 'PG-1').status, 'decided');
  assert.equal(selectReceipts(projection)[0].decision.outcome, 'approved');

  doWork(engine, 'WI-B1', 'actor-commerce-wang', '商务方案与报价制式核对完成。');
  doWork(engine, 'WI-C3', 'actor-credit-zhang', '正式信审意见与签批完成。');
  projection = engine.getProjection();
  assert.equal(selectGate(projection, 'CG-1').status, 'open');

  assert.deepEqual(canDecide(projection, 'actor-credit-zhang', selectGate(projection, 'CG-1')).allowed, true);
  const wrongRole = canDecide(projection, 'actor-commerce-wang', selectGate(projection, 'CG-1'));
  assert.equal(wrongRole.allowed, false);
  assert.ok(wrongRole.reason.includes('信审'));

  decideGate(engine, 'CG-1', 'actor-credit-zhang', 'approved', '同意签批。');
  projection = engine.getProjection();

  const commerce = selectDomainViews(projection).find((view) => view.domain === 'commerce');
  assert.equal(commerce.nextItemId, 'WI-B2', 'CG-1 Receipt + WI-B1 完成后 WI-B2 启动');
  assert.equal(waitingReasonOf(projection, selectWorkItem(projection, 'WI-C3')), '已完成。');

  const bg1NotOpen = canDecide(projection, 'actor-commerce-wang', selectGate(projection, 'BG-1'));
  assert.equal(bg1NotOpen.allowed, false);
  assert.ok(bg1NotOpen.reason.includes('尚未开启'));
  const cg1Decided = canDecide(projection, 'actor-credit-zhang', selectGate(projection, 'CG-1'));
  assert.equal(cg1Decided.allowed, false);
  assert.ok(cg1Decided.reason.includes('已决定'));
});

test('DOMAIN_LABELS 契约与域视图标签一致（防 W2 硬编码第二副本）', () => {
  assert.equal(DOMAIN_LABELS.policy, '政策');
  assert.equal(DOMAIN_LABELS.credit, '信审');
  assert.equal(DOMAIN_LABELS.commerce, '商务');
  assert.equal(DOMAIN_LABELS.asset, '资产');
});

// ---------------------------------------------------------------------------
// 命令 client：桩内直调真实 route handler
// ---------------------------------------------------------------------------

async function routingFetch(url, init = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  const casesMatch = parsedUrl.pathname.match(/^\/api\/v4life\/cases\/([^/]+)(?:\/(evidence|work|decisions|events))?$/);
  if (casesMatch !== null) {
    const params = { params: Promise.resolve({ caseId: decodeURIComponent(casesMatch[1]) }) };
    const request = new Request(parsedUrl.href, init);
    const sub = casesMatch[2];
    if (sub === undefined) {
      return getCaseProjection(request, params);
    }
    if (sub === 'events') {
      return getEventsRoute(request, params);
    }
    if (sub === 'evidence') {
      return postEvidence(request, params);
    }
    if (sub === 'work') {
      return postWork(request, params);
    }
    return postDecision(request, params);
  }
  if (parsedUrl.pathname === '/api/v4life/demo/reset') {
    return postReset(new Request(parsedUrl.href, init));
  }
  return Response.json({ error: 'STUB_NOT_FOUND' }, { status: 404 });
}

/** 记录请求体；可选 mutate（在构造 Request 前改写 body，用于模拟服务端幂等冲突等场景）。 */
function recordingFetch(base, mutate) {
  const requests = [];
  const impl = async (url, init = {}) => {
    let parsed = null;
    if (typeof init.body === 'string') {
      parsed = JSON.parse(init.body);
    }
    requests.push({ url, body: parsed });
    let effective = init;
    if (parsed !== null && mutate !== undefined) {
      mutate(parsed);
      effective = { ...init, body: JSON.stringify(parsed) };
    }
    return base(url, effective);
  };
  return { requests, impl };
}

function financialDraft(overrides = {}) {
  return {
    evidenceId: 'ev-financial-statement',
    kind: 'financial_statement',
    title: '2025 年度审计报告摘要',
    payload: {
      summary: '营收同比下滑约 18%，经营现金流为负，账面货币资金约 320 万元。',
      tags: ['revenue_declining', 'audited'],
      amountCny: 3_200_000,
    },
    ...overrides,
  };
}

async function assertClientError(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WorkspaceError, `应抛 WorkspaceError，实际：${error}`);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test('client fetchProjection/fetchEvents：读取真实路由的 Projection 与事件分页', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const client = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, { fetchImpl: routingFetch });

  const projection = await client.fetchProjection();
  assert.equal(projection.case.caseId, V4LIFE_DEMO_CASE_ID);
  assert.equal(projection.rev, engine.rev);
  assert.equal(projection.actors.length, 5, '§14.1 actors 名册随 Projection 返回');

  const page1 = await client.fetchEvents(0, 2);
  assert.equal(page1.events.length, 2);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextSeq, engine.rev);

  const rest = await client.fetchEvents(engine.rev);
  assert.equal(rest.events.length, 0);
  assert.equal(rest.hasMore, false);
});

test('client 错误映射：404 CASE_NOT_FOUND / 网络异常 NETWORK_ERROR(0) / 未配置 actorId 失败关闭', async () => {
  resetV4LifeRuntime();
  getOrCreateV4LifeDemoEngine();

  const badClient = createWorkspaceClient('no-such-case', { fetchImpl: routingFetch });
  await assertClientError(badClient.fetchProjection(), 'CASE_NOT_FOUND', 404);

  const netClient = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    actorId: 'actor-business-chen',
  });
  await assertClientError(netClient.fetchProjection(), 'NETWORK_ERROR', 0);
  await assertClientError(
    netClient.submitEvidence(financialDraft(), 5),
    'NETWORK_ERROR',
    0,
    '网络异常保留 NETWORK_ERROR',
  );
  assert.equal(netClient.hasPendingRetry, true, '传输失败保留未完成命令');

  const noActorClient = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, { fetchImpl: routingFetch });
  await assertClientError(
    noActorClient.submitEvidence(financialDraft(), 5),
    'ACTOR_NOT_FOUND',
    0,
  );
});

test('client submitEvidence：accepted 201（含 startedWorkItemIds）→ 同证据同载荷自然键重放 replayed', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const client = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: routingFetch,
    actorId: 'actor-business-chen',
  });

  const revBefore = engine.rev;
  const accepted = await client.submitEvidence(financialDraft(), revBefore);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.rev, revBefore + 2, 'EVIDENCE_ACCEPTED + WI-C2 启动两条事件');
  assert.ok(accepted.startedWorkItemIds.includes('WI-C2'));
  assert.equal(client.hasPendingRetry, false, '成功即清除未完成记录');

  const replayed = await client.submitEvidence(financialDraft(), revBefore + 2);
  assert.equal(replayed.status, 'replayed');
  assert.equal(replayed.rev, accepted.rev, '自然键重放返回原接受 rev');
  assert.equal(engine.getProjection().evidenceCount, 2, '重放不追加证据');
});

test('client 各类错误码：400 INVALID/EVIDENCE_INVALID、403 ROLE_MISMATCH、404 WORK_ITEM_NOT_FOUND', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const chen = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: routingFetch,
    actorId: 'actor-business-chen',
  });
  const zhang = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: routingFetch,
    actorId: 'actor-credit-zhang',
  });

  await assertClientError(
    chen.submitEvidence(financialDraft({ title: '' }), engine.rev),
    'INVALID_ENGINE_INPUT',
    400,
  );
  await assertClientError(
    chen.submitEvidence({
      ...financialDraft(),
      evidenceId: 'ev-bad-tags',
      payload: { summary: '摘要', tags: ['ok', ''] },
    }, engine.rev),
    'EVIDENCE_INVALID',
    400,
  );
  await assertClientError(
    chen.submitWork('WI-C1', '越权提交。', engine.rev),
    'ROLE_MISMATCH',
    403,
  );
  await assertClientError(
    zhang.submitWork('WI-NOPE', '未知工作项。', engine.rev),
    'WORK_ITEM_NOT_FOUND',
    404,
  );
});

test('client 409 VERSION_CONFLICT：保留 exact code，且不自动重试、不进入 retry 通道', async () => {
  resetV4LifeRuntime();
  getOrCreateV4LifeDemoEngine();
  const { requests, impl } = recordingFetch(routingFetch);
  const zhang = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, { fetchImpl: impl, actorId: 'actor-credit-zhang' });

  await assertClientError(zhang.submitWork('WI-C1', '用过期版本提交。', 1), 'VERSION_CONFLICT', 409);
  const workRequests = requests.filter((entry) => entry.url.endsWith('/work'));
  assert.equal(workRequests.length, 1, 'VERSION_CONFLICT 不得自动重试');
  assert.equal(zhang.hasPendingRetry, false, '确定性失败不保留 retry 通道记录');
});

test('client 409 EVIDENCE_CONFLICT：同 evidenceId 异载荷（新 commandId）', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const chen = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: routingFetch,
    actorId: 'actor-business-chen',
  });

  const revBefore = engine.rev;
  const accepted = await chen.submitEvidence(financialDraft(), revBefore);
  assert.equal(accepted.status, 'accepted');
  await assertClientError(
    chen.submitEvidence(financialDraft({ title: '口径不同的另一份报表' }), revBefore + 2),
    'EVIDENCE_CONFLICT',
    409,
  );
});

test('client 409 IDEMPOTENCY_CONFLICT：同 commandId 异载荷（桩改写 commandId 模拟）', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  let firstCommandId = null;
  const { requests, impl } = recordingFetch(routingFetch, (body) => {
    if (body.title === '被冒名的第二份证据' && firstCommandId !== null) {
      body.commandId = firstCommandId;
    }
  });
  const chen = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, { fetchImpl: impl, actorId: 'actor-business-chen' });

  const first = await chen.submitEvidence({
    evidenceId: 'ev-a',
    kind: 'supplement',
    title: '补充说明一',
    payload: { summary: '补充说明。', tags: ['note'] },
  }, engine.rev);
  assert.equal(first.status, 'accepted');
  firstCommandId = requests[0].body.commandId;
  assert.ok(firstCommandId, 'client 每次命令生成 commandId');

  await assertClientError(
    chen.submitEvidence({
      evidenceId: 'ev-b',
      kind: 'supplement',
      title: '被冒名的第二份证据',
      payload: { summary: '另一份内容。', tags: ['note'] },
    }, engine.rev + 2),
    'IDEMPOTENCY_CONFLICT',
    409,
  );
});

test('client retryLast：响应丢失后复用同 commandId 同 payload 重发，服务端幂等返回 replayed', async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  let loseNextEvidenceResponse = false;
  const requests = [];
  const lossyFetch = async (url, init = {}) => {
    const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ url, body: parsed });
    const response = await routingFetch(url, init);
    if (loseNextEvidenceResponse && new URL(url, 'http://localhost').pathname.endsWith('/evidence')) {
      loseNextEvidenceResponse = false;
      await response.text();
      throw new TypeError('connection reset');
    }
    return response;
  };
  const chen = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, { fetchImpl: lossyFetch, actorId: 'actor-business-chen' });
  const revBefore = engine.rev;

  loseNextEvidenceResponse = true;
  await assertClientError(chen.submitEvidence(financialDraft(), revBefore), 'NETWORK_ERROR', 0);
  assert.equal(chen.hasPendingRetry, true, '响应丢失保留未完成命令');
  assert.equal(chen.pendingRetryKind, 'evidence');

  const evidenceRequests = () => requests.filter((entry) => entry.url.endsWith('/evidence'));
  assert.equal(evidenceRequests().length, 1);
  const first = evidenceRequests()[0].body;

  const retried = await chen.retryLast();
  assert.equal(retried.status, 'replayed', '服务端已受理首次命令，重试为幂等重放');
  assert.equal(retried.rev, revBefore + 2);
  assert.equal(evidenceRequests().length, 2);

  const second = evidenceRequests()[1].body;
  assert.equal(second.commandId, first.commandId, 'retryLast 复用同一 commandId');
  assert.deepEqual(second, first, 'retryLast 复用完全相同 payload');
  assert.equal(chen.hasPendingRetry, false, '重试完成后清除记录');

  await assertClientError(chen.retryLast(), 'NO_PENDING_COMMAND', 0);
  assert.equal(engine.getProjection().evidenceCount, 2, '引擎只受理一次，不产生重复证据');
});

test('client resetDemo：重建演示引擎并返回全新 canonical Projection', async () => {
  resetV4LifeRuntime();
  const client = createWorkspaceClient(V4LIFE_DEMO_CASE_ID, {
    fetchImpl: routingFetch,
    actorId: 'actor-business-chen',
  });
  await client.submitEvidence(financialDraft(), getOrCreateV4LifeDemoEngine().rev);
  assert.ok(getOrCreateV4LifeDemoEngine().getProjection().evidenceCount > 1);

  const result = await client.resetDemo();
  assert.equal(result.status, 'reset');
  assert.equal(result.projection.case.caseId, V4LIFE_DEMO_CASE_ID);
  assert.equal(result.projection.evidenceCount, 1, 'reset 后回到种子初始态');
  assert.equal(getOrCreateV4LifeDemoEngine().rev, result.projection.rev);
});
