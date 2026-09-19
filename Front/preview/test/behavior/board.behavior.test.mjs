// board-round-02 任务01 行为测试·业务视角横屏二维看板（用户行为级）：
// 1) 默认=事项卡看板+阶段概览条（职责可并行；结清如实标"未支持"）+顶部金额分列（融资≠授信额度）。
// 2) 点事项卡进入对应面板（复用原面板，不造第二套状态机）；右栏切换为该事项依据/动作；可返回看板。
// 3) 沟通默认收起为一条栏（不固定吃掉半屏），可展开/收起。
// 4) 事项卡摘要消费通道任务真实状态（blocked 等待态等），不编造进度。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from './harness.mjs';

const React = (await import('react')).default;
const { CustomerWorkbench } = await import('../../../site-mirror/app/workbench/customer-workbench.tsx');

function makeBoard({ tasks = [] } = {}) {
  const calls = { refresh: 0, messages: 0 };
  const client = {
    read: async (path) => {
      if (path.endsWith('/artifacts')) return { artifacts: [{ artifactId: 'art_1', kind: 'invoice', current: true }] };
      if (path.endsWith('/reports')) return { reports: [{ reportId: 'rep_1', kind: 'internal_summary', version: 1 }] };
      return {};
    },
    channelStatus: async () => ({ tasks, rulesetVersion: 'sim-pack@7', pause: { paused: false } }),
    listInvitations: async () => ({ invitations: [{ invitationId: 'inv_1', status: 'active' }] }),
    listMessages: async () => { calls.messages += 1; return { messages: [], cursor: null }; },
    sendMessage: async () => ({}),
  };
  const wb = {
    client,
    phase: 'live',
    session: { sessionId: 's1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 },
    customerId: 'cus_kash_1',
    buildId: 'edge-test',
    snapshot: {
      customer: { customerId: 'cus_kash_1', displayName: '喀什客户（合成案例）', status: 'active' },
      openItems: [{ kind: 'followup', text: '补证：提供 2026-07 银行流水原件' }],
      decisionStatus: {
        basis: { packageId: 'pkg_1', revision: 2, basisVersion: 'v1', status: 'active', decisionReadiness: false, blockedActions: [], gate: { result: 'approved', rulePackVersion: 'sim-pack@7' } },
        facilityTotalsMinor: { proposed: 0, approvedInactive: 0, active: 0, suspended: 0, available: 0 },
        reviewQueue: [],
      },
      facilities: [],
      assessments: [],
      financingRequests: [{ frId: 'fr_1', amountMinor: 500_000_000, status: 'submitted' }],
      totalsMinor: { exposureNow: 0, outstanding: 0 },
      session: null,
      refsExhaustive: true,
    },
    snapshotVersion: 1,
    error: null,
    setError: () => {},
    refresh: () => { calls.refresh += 1; return Promise.resolve(); },
  };
  return { wb, calls };
}

test('看板默认：事项卡齐备+阶段概览（并行职责/结清未支持）+顶部融资与额度分列', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeBoard({ tasks: [{ task_id: 't1', kind: 'bank_statement', status: 'blocked_link', failure_code: 'A_CUSTOMER_NOT_IN_A', aRegistered: false, bridgeState: 'none' }] });
  render(React.createElement(CustomerWorkbench, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));

  // 事项卡（非表格主界面；点开才进入办理面板）
  for (const label of ['材料·处理', '核验', '问题·补证', '方案·决定', '结果·对账', '受限邀请']) {
    assert.ok(screen.getByText(label, { selector: 'strong' }), `事项卡 ${label} 可见`);
  }
  // 阶段概览：七段 + 结清未支持 + 并行说明
  assert.ok(screen.getByLabelText('阶段概览（职责可并行，非强制流水线）'));
  assert.ok(screen.getByText('商机·建档'));
  assert.ok(screen.getByText('结清·合同'));
  assert.ok(screen.getByText('未支持'), '结清段如实标注未支持');
  assert.ok(screen.getByText(/阶段按当前职责呈现，可并行推进/));
  // 顶部摘要：融资金额与授信额度分列；采购金额不以授信额度冒充
  assert.ok(screen.getByText('融资申请'));
  assert.ok(screen.getByText('授信额度'));
  assert.ok(screen.getByText(/不用授信额度冒充/));
  // 事项卡摘要消费通道真实状态（blocked 等待态）
  await waitFor(() => assert.ok(screen.getByText(/被阻断等待恢复 1（自动续跑，勿重复提交）/, { exact: false })));
  cleanup();
});

test('点事项卡进入面板（复用原面板）；右栏切换为该事项依据；返回看板恢复卡片', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeBoard();
  render(React.createElement(CustomerWorkbench, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('材料·处理', { selector: 'strong' })));

  fireEvent.click(screen.getByText('材料·处理', { selector: 'strong' }));
  assert.ok(await waitFor(() => screen.getByText(/材料提交与处理链（统一通道/)), '材料面板（统一链）展开');
  assert.ok(screen.getByText('← 返回看板'), '可返回');
  assert.ok(screen.getByText('材料·处理：依据与动作'), '右栏=选中事项的依据/版本/动作');
  assert.ok(screen.queryByText('受限邀请', { selector: 'strong' }) === null, '卡片视图暂替为面板');

  fireEvent.click(screen.getByText('← 返回看板'));
  await waitFor(() => assert.ok(screen.getByText('受限邀请', { selector: 'strong' })), '返回后卡片视图恢复');
  cleanup();
});

test('沟通默认收起为一条栏（不固定吃掉半屏），展开后可收起', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeBoard();
  render(React.createElement(CustomerWorkbench, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByLabelText('沟通（收起）')));
  assert.ok(screen.getByText('沟通 ▸ 展开'), '默认收起');
  assert.ok(screen.queryByText('内部协作') === null, '收起时不占主区空间');

  fireEvent.click(screen.getByText('沟通 ▸ 展开'));
  assert.ok(screen.getByLabelText('沟通（展开）'));
  assert.ok(screen.getByText('内部协作'), '展开后双列沟通可见');
  fireEvent.click(screen.getByText('沟通 ▴ 收起'));
  await waitFor(() => assert.ok(screen.getByLabelText('沟通（收起）')));
  cleanup();
});

test('客户联系人身份仍进入受限门户（保留受限客户门户）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeBoard();
  wb.session = { sessionId: 's2', principalId: 'cit-1', roles: ['customer'], expiresAt: Date.now() + 3600_000 };
  render(React.createElement(CustomerWorkbench, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('客户材料门户')), 'customer-only 会话进入门户视图');
  assert.ok(screen.queryByText('材料·处理') === null, '不呈现内部看板');
  cleanup();
});
