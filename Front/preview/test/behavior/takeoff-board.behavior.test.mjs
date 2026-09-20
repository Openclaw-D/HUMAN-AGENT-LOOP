// TAKEOFF-FA-1.0.0 · 02路 行为测试（接替退休 board.behavior 的覆盖位置）：
// 1) T01 范围：五列四行+右侧助手铺满；默认路径无提款/租后/结清/合作历程/总进度/额度使用率/底部演示卡；
//    无正式额度与融资操作入口（facility/fr 系列按钮不存在）。
// 2) 顶部摘要：申请金额=待补、无候选=待评估（不是0）、期限待评估、价格口径未配置、预计待估；方案标记同版。
// 3) T13 视觉语义：currency=current → 完成格绿（aria「已完成…≠批准」）；changed → 冻结+卡点（白霜语义可读）。
// 4) 点格打开真实事项分层（当前问题→依据→需要谁→允许动作→输出与历史）；动作打开复用面板；关闭后看板仍在。
// 5) T14 辅助页：流程只读 SVG、记录时间轴消费服务端事件、待办回原格子。
// 6) 六助手：六个入口一个消息区；草稿切换保留；@插入；Enter 发送/Shift+Enter 换行/输入法候选不误发；
//    未接入工具明确禁用；上传打开材料面板。
// 7) 结束对话框：三类确认走 A confirm-preassessment（状态门/版本绑定如实；服务端硬门重查）；行政撤回走既有 decide（二次确认+幂等），不调用 facility.approve。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within } from './harness.mjs';

const React = (await import('react')).default;
const { TakeoffScreen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');

test('状态动效不推进业务，快速失败打断解锁，重进不重播', async (t) => {
  t.after(() => cleanup());
  const { StatusObject } = await import('../../../site-mirror/app/takeoff/status-object.tsx');
  const { act } = await import('./harness.mjs');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = render(React.createElement(StatusObject, { kind: 'lock' }));
  const scene = () => view.container.querySelector('.tk-status-scene');
  assert.equal(scene().dataset.transition, undefined);
  view.rerender(React.createElement(StatusObject, { kind: 'wrench' }));
  assert.equal(scene().dataset.transition, 'unlock');
  assert.ok(view.container.querySelector('.tk-unlock-key'));
  act(() => t.mock.timers.tick(3000));
  assert.equal(scene().dataset.state, 'wrench', '视觉计时器不能制造已完成');
  assert.equal(scene().dataset.transition, undefined);
  view.rerender(React.createElement(StatusObject, { kind: 'check' }));
  assert.equal(scene().dataset.transition, 'finish');
  view.rerender(React.createElement(StatusObject, { kind: 'lock' }));
  view.rerender(React.createElement(StatusObject, { kind: 'wrench' }));
  view.rerender(React.createElement(StatusObject, { kind: 'cross' }));
  assert.equal(scene().dataset.transition, 'fail');
  assert.equal(view.container.querySelector('.tk-unlock-key'), null);
  act(() => t.mock.timers.tick(3000));
  assert.equal(scene().dataset.state, 'cross', '旧解锁计时器不能覆盖失败');
  view.unmount();
  const fresh = render(React.createElement(StatusObject, { kind: 'check' }));
  assert.equal(fresh.container.querySelector('.tk-status-scene').dataset.transition, undefined);
});

function makeScreen({ tasks = [], currency = [], candidate = null, openItems = [], followups = [], messages = [], events = [], admission = null, assessmentStatus = 'candidate_ready', confirmedAt = null } = {}) {
  const calls = { action: [], send: [], refresh: 0, confirm: [] };
  const client = {
    read: async (path) => {
      if (path.endsWith('/artifacts')) return { artifacts: [{ artifactId: 'art_1', kind: 'invoice', current: true }], factConflicts: [] };
      if (path.endsWith('/reports')) return { reports: [] };
      return {};
    },
    channelStatus: async () => ({ tasks, rulesetVersion: 'sim-pack@7' }),
    packageDetail: async () => ({ package: { packageId: 'pkg_1', revision: 3 }, domainResults: [{ domain: 'credit', opinionVersion: 2, adoption: { adopted: true } }] }),
    listMessages: async () => ({ messages, cursor: null }),
    sendMessage: async (_cid, body) => { calls.send.push(body); return { ok: true, requestId: body.requestId, delivery: { messageId: 'm1', state: 'sent' } }; },
    action: async (path, body) => { calls.action.push({ path, body }); return { ok: true }; },
    confirmPreassessment: async (id, body) => { calls.confirm.push({ id, body }); return { ok: true, confirmationId: 'pac_test_1', scope: 'preassessment_only', outcome: body.outcome, status: 'preassessment_confirmed', assessmentVersion: body.assessmentVersion + 1 }; },
    eventsPage: async () => ({ ok: true, events, nextAfterSeq: '9', hasMore: false }),
  };
  const wb = {
    client,
    phase: 'live',
    session: { sessionId: 's1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 },
    customerId: 'cus_kash_1',
    buildId: 'edge-test',
    snapshot: {
      customer: { customerId: 'cus_kash_1', displayName: '喀什客户（合成案例）', status: 'active' },
      openItems,
      decisionStatus: {
        basis: { packageId: 'pkg_1', revision: 3, basisVersion: 'v1', status: 'frozen', decisionReadiness: false, blockedActions: [], gate: { result: 'approved', rulePackVersion: 'sim-pack@7' }, currency },
        facilityTotalsMinor: { proposed: 0, approvedInactive: 0, active: 0, suspended: 0, available: 0 },
        reviewQueue: [],
      },
      facilities: [],
      assessments: candidate ? [{
        assessmentId: 'asm_1', status: assessmentStatus, stale: false, ruleVersion: 'sim-pack@7',
        version: 7, candidateRevision: 2, inputVersion: 3, requestedAmountMinor: 80_000_000_00,
        ...(confirmedAt ? { preassessment: { confirmationId: 'pac_r1', outcome: 'support', scope: 'preassessment_only', conditions: [], rationale: 'r', confirmedBy: 'cred1', confirmedAt, needsReview: true, reviewReason: 'snapshot superseded' } } : {}),
        candidate,
      }] : [],
      financingRequests: [],
      totalsMinor: { exposureNow: 0, outstanding: 0 },
      session: { runStatus: 'in_progress', openQuestions: 0, followups, coverage: { total: 3, required: 2, verified: 1, open: 1 } },
      admission,
      refsExhaustive: true,
    },
    snapshotVersion: 1,
    error: null,
    setError: () => {},
    refresh: () => { calls.refresh += 1; return Promise.resolve(); },
  };
  return { wb, calls };
}

const CURRENCY_PARTIAL = [
  { domain: 'credit', currency: 'current' },
  { domain: 'asset', currency: 'changed', reasons: ['new_evidence'] },
];

test('T01 范围：二十格+六助手结构齐备；默认路径无退休展示与正式额度/融资入口', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));

  assert.ok(screen.getByRole('grid', { name: /二十格看板/ }));
  for (const col of ['业务', '政策', '信审', '商务', '资产']) {
    assert.ok(screen.getByRole('columnheader', { name: new RegExp(col) }), `列头 ${col}`);
  }
  for (const row of ['材料', '分析', '核验', '办结']) {
    assert.ok(screen.getByRole('rowheader', { name: new RegExp(row) }), `行头 ${row}`);
  }
  for (const tab of ['业务', '政策', '信审', '商务', '资产', '见微']) {
    assert.ok(screen.getByRole('tab', { name: tab }), `助手 ${tab}`);
  }
  // 退休展示不在默认路径（T01 反例）
  for (const banned of [/合作历程/, /额度使用/, /总进度/, /结清·合同/, /敞口合计/]) {
    assert.equal(screen.queryByText(banned), null, `不得出现 ${banned}`);
  }
  // 正式额度/融资操作入口不在页面（ADAPTATION_MAP 停用行）
  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  cleanup();
});

test('方案面板无正式额度/融资操作按钮（停用说明可见；冻结依据包办理保留）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  fireEvent.click(screen.getByRole('button', { name: /信审，完成，/ }));
  fireEvent.click(await screen.findByRole('button', { name: '查看建议方案' }));
  await waitFor(() => assert.ok(screen.getByText('本次办理')), '业务办理摘要可见');
  for (const banned of ['正式批准', '激活', '暂停', '提交额度提案（候选）', '创建用信申请', '预占额度', '承诺用信', '出账（模拟）']) {
    assert.equal(screen.queryByRole('button', { name: banned }), null, `不得存在按钮：${banned}`);
  }
  assert.ok(screen.getByText('保存本次材料依据'), '受控办理（冻结依据包）保留');
  cleanup();
});

test('顶部摘要：待补/待评估/待估如实；有候选=同版金额+倾向标记（≠批准）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL, candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' } });
  // 此用例验证缺失需求；旧 fixture 实际含 8000 万元，只是首次空渲染掩盖了矛盾。
  wb.snapshot.assessments[0].requestedAmountMinor = null;
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  assert.ok(screen.getByText('待补'), '申请金额=待补（首次回租需求登记未录入，未知≠0）');
  await waitFor(() => assert.ok(screen.getByText('50 万元')), '建议额度=候选可支持金额');
  assert.ok(screen.getByText('待评估'), '建议期限待评估（候选未登记期限字段，不是0）');
  assert.ok(screen.getByText('口径未配置'), '参考价格不编造');
  assert.equal(screen.queryByText('预计'), null, 'UI-R2 不展示无法估计的完成时间，不给假倒计时');
  assert.equal(screen.queryByTitle(/authority=none/),null,'前台不展示技术标记');
  cleanup();
});

test('T13 视觉语义：current=完成绿（aria ≠批准）；changed=冻结+卡点；同轮测试 T03 部分并行', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  const done = await screen.findByRole('button', { name: /信审，完成，已完成/ });
  assert.ok(done, '信审完成格=绿（工作完成语义）');
  const frozen = screen.getByRole('button', { name: /资产，完成，.*(待复核|前序事项)/ });
  assert.ok(frozen, '资产完成格=白霜冻结（可读状态，不只靠颜色）');
  const policyClosure = screen.getByRole('button', { name: /政策，完成，尚未开始/ });
  assert.ok(policyClosure, '无判定域=未知档位（不硬补进度）');
  assert.equal(frozen.getAttribute('aria-selected'), 'false', '圆不是手工切换器');
  const grid = screen.getByRole('grid');
  assert.equal(grid.querySelectorAll('button .tk-status-icon img').length,20);
  assert.equal(grid.querySelectorAll('.tk-ring,.tk-flag,.tk-cell-caption,.tk-frozen').length,0,'每格仅中央一个状态图标，无圆环角标和重复文案');
  cleanup();
});

test('点格→真实事项分层详情；允许动作打开复用面板；关闭后看板仍在', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: /信审，输入，/ }));
  const drawer = await screen.findByRole('dialog', { name: /信审 · 材料/ });
  assert.equal(document.activeElement, drawer, '打开抽屉后焦点进入详情');
  assert.ok(screen.getByText('待处理'));
  assert.ok(screen.getByText('下一步'));
  assert.ok(screen.getByText('已取得的结果'));
  assert.ok(within(drawer).getByRole('button', { name: '查看材料原件' }), '依据可以直接打开原件');
  assert.ok(!drawer.textContent.includes('evidence_artifacts'), '不展示内部表名');

  fireEvent.click(within(drawer).getByRole('button', { name: '补充材料' }));
  await waitFor(() => assert.ok(screen.getByText(/已收到的材料/)), '材料面板=复用 OriginalsPanel');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  assert.ok(screen.getByRole('grid', { name: /二十格看板/ }), '关闭后看板仍在');
  // 放大/还原
  fireEvent.click(screen.getByRole('button', { name: /信审，完成，/ }));
  fireEvent.click(await screen.findByRole('button', { name: '放大' }));
  assert.ok(screen.getByRole('button', { name: '还原' }));
  fireEvent.click(screen.getByRole('button', { name: '还原' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog'), null, 'Escape 关闭抽屉');
  cleanup();
});

test('辅助页：流程只读 SVG+缩放；记录消费服务端事件；待办可回原格子', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({
    currency: CURRENCY_PARTIAL,
    openItems: [{ kind: 'followup', needRole: 'credit', detail: '补充 7 月流水' }],
    events: [{ eventId: 'e1', payloadRef: { type: 'artifact_registered' }, payload: { at: '2026-09-20T08:00:00Z' }, aggregateVersion: '3' }],
  });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));

  fireEvent.click(screen.getByRole('button', { name: '角色流程' }));
  assert.ok(await screen.findByRole('img', { name: /首次预评估只读流程图/ }));
  fireEvent.click(screen.getByRole('button', { name: '放大流程图' }));
  fireEvent.click(screen.getByRole('button', { name: '时间轴' }));
  await waitFor(() => assert.ok(screen.getByText('收到一份材料')), '记录页消费服务端事件类型');
  fireEvent.click(screen.getByRole('button', { name: '工作台' }));

  fireEvent.click(screen.getByRole('button', { name: '待办' }));
  await waitFor(() => assert.ok(screen.getByText(/补充 7 月流水/)));
  fireEvent.click(screen.getByRole('button', { name: /回原格子（信审·人工）/ }));
  assert.ok(await screen.findByRole('dialog', { name: /信审 · 核验/ }), '待办回原格子');
  cleanup();
});

test('长按助手只插入@，打开团队消息并聚焦；不会同时切换助手',async t=>{
  t.after(cleanup);const {wb}=makeScreen();render(React.createElement(TakeoffScreen,{wb,onBackToDirectory:()=>{},onLogout:()=>{}}));
  const credit=screen.getByRole('tab',{name:'信审'});
  fireEvent.pointerDown(credit);
  await waitFor(()=>assert.match(screen.getByLabelText('消息草稿').value,/@信审/));
  fireEvent.pointerUp(credit);fireEvent.click(credit);
  assert.equal(screen.getByRole('tab',{name:'业务'}).getAttribute('aria-selected'),'true');
  assert.equal(screen.getByLabelText('消息草稿').closest('details').open,true);
});

test('六助手：草稿跨切换保留；@插入；Enter 发送内部线程；Shift+Enter 换行不发送；输入法候选不误发', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  const input = screen.getByLabelText('消息草稿');
  fireEvent.change(input, { target: { value: '信审材料已补齐' } });

  fireEvent.click(screen.getByRole('tab', { name: '见微' }));
  assert.equal(screen.getByLabelText('消息草稿').value, '信审材料已补齐', '切换助手草稿保留');

  fireEvent.click(screen.getByRole('tab', { name: '资产' }));
  fireEvent.click(screen.getByRole('button', { name: '@' }));
  assert.match(screen.getByLabelText('消息草稿').value, /@资产/, '@入口插入');

  fireEvent.keyDown(screen.getByLabelText('消息草稿'), { key: 'Enter', shiftKey: true });
  assert.equal(calls.send.length, 0, 'Shift+Enter 换行不发送');
  fireEvent.keyDown(screen.getByLabelText('消息草稿'), { key: 'Enter', keyCode: 229 });
  assert.equal(calls.send.length, 0, '输入法候选确认不误发送');
  assert.ok(screen.getByText('输入法候选确认不会误发送。'));

  fireEvent.keyDown(screen.getByLabelText('消息草稿'), { key: 'Enter' });
  await waitFor(() => assert.equal(calls.send.length, 1));
  assert.equal(calls.send[0].audience, 'internal', '默认内部线程');

  // 未接入工具明确禁用
  assert.equal(screen.queryByRole('button', { name: '⋯ 更多' }), null, 'UI-R2 隐藏未接入工具菜单，不保留死入口');
  cleanup();
});

test('结束对话框：状态门如实——candidate_ready 下正/附条件禁用（须先提交复核）；撤回可用', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL, candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' }, assessmentStatus: 'candidate_ready' });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  const dlg = await screen.findByRole('dialog', { name: /结束本次预评估/ });
  assert.match(dlg.textContent, /不批准正式额度/);
  const all = screen.getAllByRole('button', { name: '发起确认' });
  assert.equal(all.length, 3);
  assert.equal(all[0].disabled, true, '支持：须先提交人工审阅');
  assert.match(all[0].title, /提交复核/);
  assert.equal(all[1].disabled, true, '附条件：同状态门');
  assert.equal(all[2].disabled, false, '不支持：candidate_ready 可记录负面结论');
  assert.match(dlg.textContent, /本次仅确认预评估结论/);
  assert.equal(screen.getByRole('button', { name: '撤回本轮' }).disabled, false);
  cleanup();
});

test('结束对话框：awaiting_human_review 下三类可发起；not_support 提交绑定版本走 confirm-preassessment', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeScreen({ currency: [{ domain: 'credit', currency: 'current' }], candidate: { tendency: 'do_not', supportableAmountMinor: null, currency: 'CNY' }, assessmentStatus: 'awaiting_human_review' });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  await screen.findByRole('dialog', { name: /结束本次预评估/ });
  const all = screen.getAllByRole('button', { name: '发起确认' });
  assert.ok(all.every((b) => !b.disabled), '状态门通过：三类均可发起');
  fireEvent.click(all[2]); // not_support
  fireEvent.change(screen.getByLabelText('确认理由'), { target: { value: '两处事实冲突未解决且有 Gate 依据：记录负面预评估结论' } });
  fireEvent.click(screen.getByRole('button', { name: '进入二次确认' }));
  const confirmDlg = await screen.findByRole('dialog', { name: /预评估结论——不支持/ });
  assert.match(confirmDlg.textContent, /不批准正式额度/);
  fireEvent.click(screen.getByRole('button', { name: '确认预评估结论' }));
  await waitFor(() => assert.equal(calls.confirm.length, 1));
  assert.equal(calls.confirm[0].id, 'asm_1');
  assert.equal(calls.confirm[0].body.outcome, 'not_support');
  assert.equal(calls.confirm[0].body.assessmentVersion, 7);
  assert.equal(calls.confirm[0].body.candidateRevision, 2);
  assert.match(calls.confirm[0].body.rationale, /负面预评估结论/);
  assert.ok(calls.action.every((a) => !a.path.includes('facility')), '不调用 facility.approve');
  cleanup();
});

test('结束对话框：附条件支持必须给条件（缺失本地拦截）；补齐后提交带 conditions 数组', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeScreen({
    currency: [{ domain: 'credit', currency: 'current' }],
    candidate: { tendency: 'do_with_adjusted_terms', supportableAmountMinor: 50_000_000, currency: 'CNY' },
    assessmentStatus: 'awaiting_human_review',
  });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  await screen.findByRole('dialog', { name: /结束本次预评估/ });
  const all = screen.getAllByRole('button', { name: '发起确认' });
  fireEvent.click(all[1]); // support_with_conditions
  fireEvent.change(screen.getByLabelText('确认理由'), { target: { value: '现金流可覆盖但需设备权属补齐' } });
  fireEvent.click(screen.getByRole('button', { name: '进入二次确认' }));
  assert.ok(await screen.findByRole('alert'), '缺失条件=本地拦截业务提示');
  assert.match(screen.getByRole('alert').textContent, /至少给出一条条件/);
  assert.equal(calls.confirm.length, 0, '未提交');
  fireEvent.change(screen.getByLabelText('确认条件'), { target: { value: '补齐设备权属登记后生效\n首期租金按季支付' } });
  fireEvent.click(screen.getByRole('button', { name: '进入二次确认' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认预评估结论' }));
  await waitFor(() => assert.equal(calls.confirm.length, 1));
  assert.deepEqual(calls.confirm[0].body.conditions, ['补齐设备权属登记后生效', '首期租金按季支付']);
  cleanup();
});

test('结束对话框：已确认结论读回=终态（三类+撤回全禁用，显示需复核卡）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({
    currency: CURRENCY_PARTIAL,
    candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' },
    assessmentStatus: 'preassessment_confirmed',
    confirmedAt: '2026-09-20T09:00:00Z',
  });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  const dlg = await screen.findByRole('dialog', { name: /结束本次预评估/ });
  assert.match(dlg.textContent, /已确认结论/);
  assert.match(dlg.textContent, /需复核/);
  assert.match(dlg.textContent, /旧确认保留/);
  assert.ok(screen.getAllByRole('button', { name: '发起确认' }).every((b) => b.disabled));
  assert.equal(screen.getByRole('button', { name: '撤回本轮' }).disabled, true);
  cleanup();
});

test('admission 投影合并：到件数/失败卡点入格；requestedAmount/期限/价格同版上顶栏', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({
    currency: CURRENCY_PARTIAL,
    candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY', suggestedTermMonths: 36, referencePriceMinor: 780_000_000, priceUnit: '元/年', priceBasis: '固定租金口径' },
    assessmentStatus: 'awaiting_human_review',
    admission: {
      scope: { assessmentId: 'asm_1', revision: 7 },
      request: { requestedAmount: 80_000_000_00 },
      assessmentState: 'awaiting_human_review',
      inputVersion: 3,
      candidateRevision: 2,
      candidate: { version: 2, suggestedAmount: 50_000_000, suggestedTermMonths: 36, referencePriceMinor: 780_000_000, priceUnit: '元/年', priceBasis: '固定租金口径', tendency: 'do', inputVersion: 3, isCurrent: true },
      preassessment: null,
      frozen: { active: false, reasons: [], scope: [] },
      cells: [
        { domain: 'asset', row: 'input', satisfiedItemCount: 3, running: true, blockers: [{ scope: 'artifact', reason: 'PROCESSING_FAILED', detail: '解析失败：非PDF', requiredAction: 'retry_or_manual' }] },
      ],
      blockers: [],
    },
  });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByText('8,000 万元')), '申请金额=admission 权威需求金额');
  assert.ok(screen.getByText('36 个月'), '建议期限=候选同版字段');
  assert.ok(screen.getByText(/780 万元 \/ 年/), '参考价格保留期间，货币单位不重复');
  assert.equal(screen.queryByTitle(/候选 r2 · 输入 v3/),null,'版本绑定保留在后台，前台不堆修订编号');
  await screen.findByRole('button', { name: /资产，输入，待补齐条件/ });
  fireEvent.click(screen.getByRole('button', { name: /资产，输入，/ }));
  const drawer = await screen.findByRole('dialog', { name: /资产 · 材料/ });
  assert.match(drawer.textContent, /按域可推导到件 3 件/);
  assert.match(drawer.textContent, /处理失败/, 'PROCESSING_FAILED 入卡点');
  cleanup();
});

test('助手工具栏上传入口打开材料面板（客户联系人门户分支保留在屏内）', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await waitFor(() => assert.ok(screen.getByRole('grid', { name: /二十格看板/ })));
  fireEvent.click(screen.getByRole('button', { name: '上传' }));
  await waitFor(() => assert.ok(screen.getByText(/已收到的材料/)), '工具栏上传→材料面板');
  cleanup();
});

test('顶部摘要：已有申请金额首屏直接展示，不以加载占位冒充缺失', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' } });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  assert.ok(screen.getByText('8,000 万元'));
  await waitFor(() => assert.ok(screen.getByText('50 万元')));
  assert.ok(screen.getByText('8,000 万元'));
});
