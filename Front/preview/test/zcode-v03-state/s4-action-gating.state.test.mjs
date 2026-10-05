// V0.3-Z4 场景4 独立回归（ZCODE 并行QA·只读产品源码）：
// 1) 无有效上传授权（通道绑定缺失）时，上传按钮不得因处理链已有 completed（done）任务而解锁；
//    无绑定点上传=本地诚实阻断+零请求；
// 2) 导航"下一步"及全部页内导航（详情下一步区/顶栏四页/待办回格子/办理菜单/结束对话框/撤回确认）
//    不得偷偷发审批、上传或模型请求：审批（confirm-preassessment/decide/facility）、
//    上传（evidence/upload/originals）、模型（observe/analyze/feedback POST）计数全程为零；
//    候选只读 GET 计数在导航前后不变（导航不触发模型侧读数）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '../behavior/harness.mjs';

const React = (await import('react')).default;
const { TakeoffScreen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
const { OriginalsPanel } = await import('../../../site-mirror/app/workbench/originals-panel.tsx');

// ---- 共享替身 ----

const CURRENCY_PARTIAL = [
  { domain: 'credit', currency: 'current' },
  { domain: 'asset', currency: 'changed', reasons: ['new_evidence'] },
];

const CID = 'cus_kash_1';

function validDecision() {
  const text = 'D01 设备权属登记证明 主体：喀什客户';
  return {
    ok: true, authority: 'none', customerId: CID, assistant: 'credit', revision: 3, pending: null,
    latest: {
      id: 'ds_1', question: '基于当前材料，下一步优先核对什么？', current: true, valid: true, at: '2026-09-21T01:00:00.000Z',
      candidates: [
        { id: 'c1', label: '补齐设备权属登记', confidence: 0.7, impact: '触发条件：权属材料到件', evidenceRefIds: ['e1'], confidenceKind: 'model_estimate_uncalibrated' },
      ],
      evidenceRefs: [{ id: 'e1', artifactId: 'art_1', hash: 'ab'.repeat(32), parserVersion: 'pdf-v1', text, locator: { kind: 'page_text', page: 1, start: 0, end: text.length } }],
      omitted: [], feedback: null, feedbackUsed: null,
      model: { status: 'succeeded', contextVersion: '3', requestId: 'r1', source: { model: 'glm-5.2', mode: 'live' }, error: null },
    },
  };
}

/** 全量记录型 client：读面放行，全部写面（审批/上传/模型POST）计数且不落任何业务效果。 */
function recordingClient(snapshot) {
  const calls = {
    read: [], channelStatus: [], packageDetail: [], listMessages: [], eventsPage: [], workspace: 0,
    action: [], confirmPreassessment: [], sendMessage: [], channelAction: [], observeAssistant: [],
    readDecisions: 0, analyzeDecisions: [], saveDecisionFeedback: [],
  };
  const client = {
    session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    async read(path) {
      calls.read.push(path);
      if (path.endsWith('/artifacts')) return { artifacts: [{ artifactId: 'art_1', kind: 'invoice', current: true }], factConflicts: [] };
      if (path.endsWith('/reports')) return { reports: [] };
      if (path.includes('/api/jw/v2/assessments/')) {
        return { ok: true, assessment: { assessmentId: 'asm_1', customerId: CID, version: 7, status: 'candidate_ready', request: null } };
      }
      return {};
    },
    channelStatus: async () => { calls.channelStatus.push(1); return { tasks: [{ task_id: 't1', evidence_id: 'e1', kind: 'invoice', status: 'done', stage_cursor: 'analyzed', attempts: 1, updated_at: '2026-09-20T02:00:00Z', aRegistered: true, bridgeState: 'registered' }], pause: { paused: false } }; },
    packageDetail: async () => { calls.packageDetail.push(1); return { package: { packageId: 'pkg_1', revision: 3 }, domainResults: [{ domain: 'credit', opinionVersion: 2, adoption: { adopted: true } }] }; },
    listMessages: async () => { calls.listMessages.push(1); return { messages: [], cursor: null }; },
    sendMessage: async (cid, body) => { calls.sendMessage.push(body); return { ok: true, requestId: body.requestId, delivery: { messageId: 'm1', state: 'sent' } }; },
    action: async (path, body) => { calls.action.push({ path, body }); return { ok: true }; },
    confirmPreassessment: async (id, body) => { calls.confirmPreassessment.push({ id, body }); return { ok: true, confirmationId: 'pac_x', scope: 'preassessment_only', outcome: body.outcome, status: 'preassessment_confirmed', assessmentVersion: body.assessmentVersion + 1 }; },
    eventsPage: async () => { calls.eventsPage.push(1); return { ok: true, events: [], nextAfterSeq: '9', hasMore: false }; },
    workspace: async () => { calls.workspace += 1; return { snapshot, snapshotVersion: 1, projection: { notes: [] } }; },
    observeAssistant: async (...a) => { calls.observeAssistant.push(a); return validDecision(); },
    readDecisions: async () => { calls.readDecisions += 1; return validDecision(); },
    analyzeDecisions: async (cid, body) => { calls.analyzeDecisions.push(body); return validDecision(); },
    saveDecisionFeedback: async (cid, body) => { calls.saveDecisionFeedback.push(body); return { ok: true }; },
  };
  return { client, calls };
}

function makeWb(client) {
  return {
    client, phase: 'live',
    session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    customerId: CID, buildId: 'edge-test',
    snapshot: {
      customer: { customerId: CID, displayName: '喀什客户（合成案例）', status: 'active' },
      openItems: [{ kind: 'followup', needRole: 'credit', detail: '补充 7 月流水' }],
      decisionStatus: {
        basis: { packageId: 'pkg_1', revision: 3, basisVersion: 'v1', status: 'frozen', decisionReadiness: false, blockedActions: [], gate: { result: 'approved', rulePackVersion: 'sim-pack@7' }, currency: CURRENCY_PARTIAL },
        facilityTotalsMinor: { proposed: 0, approvedInactive: 0, active: 0, suspended: 0, available: 0 },
        reviewQueue: [],
      },
      facilities: [],
      assessments: [{
        assessmentId: 'asm_1', status: 'candidate_ready', stale: false, ruleVersion: 'sim-pack@7',
        version: 7, candidateRevision: 2, inputVersion: 3, requestedAmountMinor: 80_000_000_00,
        candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' },
      }],
      financingRequests: [],
      totalsMinor: { exposureNow: 0, outstanding: 0 },
      session: { runStatus: 'in_progress', openQuestions: 0, followups: [], coverage: { total: 3, required: 2, verified: 1, open: 1 } },
      admission: null,
      refsExhaustive: true,
    },
    snapshotVersion: 1,
    error: null, notes: [], identities: null, lastEvent: null, buildId: 'edge-test',
    setError: () => {}, refresh: () => Promise.resolve(),
  };
}

const zeroMutations = (calls, tag) => {
  assert.deepEqual({
    审批确认: calls.confirmPreassessment.length,
    通用动作: calls.action.length,
    消息发送: calls.sendMessage.length,
    通道动作含上传: calls.channelAction.length,
    模型观察: calls.observeAssistant.length,
    模型分析POST: calls.analyzeDecisions.length,
    反馈POST: calls.saveDecisionFeedback.length,
  }, { 审批确认: 0, 通用动作: 0, 消息发送: 0, 通道动作含上传: 0, 模型观察: 0, 模型分析POST: 0, 反馈POST: 0 }, `导航过程中不得发出写/模型请求：${tag}`);
};

test('导航"下一步"与页内导航：全程零审批/零上传/零模型POST；候选读数不因导航增加', async (t) => {
  t.after(cleanup);
  const { client, calls } = recordingClient(null);
  const wb = makeWb(client);
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));

  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  // FINAL-02 对照现行契约更新：候选只读读取面已从“全局聊天助手”迁移到“决策页专业列”
  // （平台页助手改为聊天形态，不再挂载候选面板自动读取）。平台页挂载读取=0 是现行设计；
  // 读取发生在下方进入决策页之后（见 readsOnFlow 断言）。
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.readDecisions, 0, '平台页聊天助手不自动读候选（读取面迁移至决策页）');
  const readsAtStart = calls.readDecisions;
  zeroMutations(calls, '挂载后');

  // 1) 格子详情"下一步"区：只做展示与入口跳转
  fireEvent.click(screen.getByRole('button', { name: /信审，输入，/ }));
  const detailDlg = await screen.findByRole('dialog', { name: /信审 · 材料/ });
  // FINAL-02：顶部简报条常驻“下一步”行后，页面出现多个“下一步”文本——此处断言详情弹窗内的
  // “下一步”区，须以弹窗为查询范围（R3 收敛引入的顶部行为不属于本断言目标）。
  assert.ok(within(detailDlg).getByText('下一步'), '详情含"下一步"区');
  fireEvent.click(within(detailDlg).getByRole('button', { name: '查看材料原件' })); // 导航到材料清单页
  await waitFor(() => assert.ok(screen.getByRole('region', { name: '材料全景工作台' }), '材料页到达'));
  zeroMutations(calls, '详情下一步→材料页');
  // FINAL-02：平台页助手为聊天形态，点选格子/材料页导航不触发候选读取（读取面在决策页）
  const readsAfterFocus = calls.readDecisions;
  assert.equal(readsAfterFocus, readsAtStart, '格子聚焦与材料页导航不触发候选读取');

  // 2) 顶栏四页往返（FINAL-02 对照现行契约：导航可见名=平台/决策/流程/材料）
  fireEvent.click(screen.getByRole('button', { name: '平台' }));
  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  fireEvent.click(screen.getByRole('button', { name: '决策' }));
  await waitFor(() => assert.ok(screen.getByText(/四阶段 · 拖动空白处平移/), '决策画布页到达'));
  fireEvent.click(screen.getByRole('button', { name: '流程' }));
  await waitFor(() => assert.ok(screen.getByText('定位最新'), '时间轴页到达'));
  fireEvent.click(screen.getByRole('button', { name: '材料' }));
  await waitFor(() => assert.ok(screen.getByRole('region', { name: '材料全景工作台' })));
  fireEvent.click(screen.getByRole('button', { name: '平台' }));
  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  // 进入过"角色流程"页：决策页专业列按设计完成候选只读读取（只读GET，非模型POST）；
  // 往返结束后读取计数应稳定，不再随后续导航增加（见末尾断言）。
  const readsAfterRoundTrip = calls.readDecisions;
  assert.ok(readsAfterRoundTrip >= 1, '决策页按设计完成候选只读读取');
  zeroMutations(calls, '顶栏四页往返');

  // 3) 更多菜单→待办→回原格子（渐进导航；FINAL-02 对照现行契约：待办入口在“更多”菜单内）
  await act(async () => { fireEvent.click(screen.getByText('更多')); });
  fireEvent.click(screen.getByRole('button', { name: '待办事项' }));
  await screen.findByRole('dialog', { name: '待办事项' });
  fireEvent.click(screen.getByRole('button', { name: /回原格子（信审·人工）/ }));
  await screen.findByRole('dialog', { name: /信审 · 核验/ });
  fireEvent.click(within(await screen.findByRole('dialog', { name: /信审 · 核验/ })).getByRole('button', { name: '关闭' }));
  zeroMutations(calls, '待办回原格子');

  // 4) 更多菜单：需求与申请/建议方案（面板挂载只读；FINAL-02 对照现行契约：入口在“更多”菜单）
  await act(async () => { fireEvent.click(screen.getByText('更多')); });
  fireEvent.click(screen.getByRole('button', { name: '需求与申请' }));
  await waitFor(() => assert.ok(screen.getByRole('dialog', { name: '首次回租需求登记' }), '需求登记面板到达'));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '首次回租需求登记' })).getByRole('button', { name: '关闭' }));
  await act(async () => { fireEvent.click(screen.getByText('更多')); });
  fireEvent.click(screen.getByRole('button', { name: '建议方案' }));
  await waitFor(() => assert.ok(screen.getByRole('dialog', { name: '建议方案' }), '方案面板到达'));
  fireEvent.click(within(screen.getByRole('dialog', { name: '建议方案' })).getByRole('button', { name: '关闭' }));
  zeroMutations(calls, '办理菜单两个面板');

  // 5) "确认预评估结论"对话框与撤回确认：打开均不发请求，确认才发（此处只验证打开零请求）
  await act(async () => { fireEvent.click(screen.getByText('更多')); });
  fireEvent.click(screen.getByRole('button', { name: '确认预评估结论' }));
  const endDlg = await screen.findByRole('dialog', { name: /结束本次预评估/ });
  assert.ok(endDlg, '结束对话框到达');
  zeroMutations(calls, '结束对话框打开');
  fireEvent.click(screen.getByRole('button', { name: '撤回本轮' }));
  await screen.findByRole('dialog', { name: /行政撤回本轮/ });
  zeroMutations(calls, '撤回确认打开');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '取消（继续办理）' }));

  assert.equal(calls.readDecisions, readsAfterRoundTrip, '候选只读GET计数不因后续导航增加');
  zeroMutations(calls, '全程');
});

test('无有效上传授权：completed任务不解锁上传按钮；点上传=本地阻断零请求', async (t) => {
  t.after(cleanup);
  const { client, calls } = recordingClient(null);
  const wb = makeWb(client);
  render(React.createElement(OriginalsPanel, { key: 'sess-1:cus_kash_1', wb, customerId: CID }));

  // 通道回执里已有 done（completed）任务
  await waitFor(() => assert.ok(screen.getByText('已完成工作'), '处理链 done 任务在列'));
  const upload = screen.getByRole('button', { name: '上传材料（≤512KB）' });
  assert.equal(upload.disabled, true, '无绑定时completed任务不得解锁上传');
  assert.ok(screen.getByText('通道未绑定（上传暂不可用）'));

  const input = screen.getByLabelText('选择上传的材料');
  fireEvent.change(input, { target: { files: [new NodeFile(['x'], 'flow.csv', { type: 'text/csv' })] } });
  fireEvent.click(upload); // disabled 按钮不派发 click：本地硬阻断
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(upload.disabled, true, '点后仍锁定');
  assert.equal(calls.channelAction.length, 0, '无绑定上传零请求');
  assert.equal(calls.action.length, 0);
});
