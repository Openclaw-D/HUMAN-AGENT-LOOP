import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within, fakeSession } from './harness.mjs';
const React = (await import('react')).default;
const { CustomerDirectory } = await import('../../../site-mirror/app/workbench/customer-directory.tsx');
const { RoleEntry, describeLoginFailure } = await import('../../../site-mirror/app/takeoff/role-entry.tsx');
const { TakeoffAssistants } = await import('../../../site-mirror/app/takeoff/takeoff-assistants.tsx');
const { HumanVerificationRegister } = await import('../../../site-mirror/app/takeoff/human-verification.tsx');
const { CyclesPanel } = await import('../../../site-mirror/app/takeoff/cycles-panel.tsx');

const TEN_CASES = {
  ok: true,
  manifestVersion: 'arrow-cases-v2',
  cases: [
    { caseId: 'case-08', customerId: 'cust-008', displayName: '郑州拓峰机械制造有限公司', scenarioLabel: '好', displayOrder: 8, summary: '首次预评估收口', checkpoint: '五区已有结果与依据，待最终人类确认', nextAction: '完成预评估结论确认', industry: '机械制造' },
    { caseId: 'case-01', customerId: 'cust-001', displayName: '金盛贸易发展有限公司', scenarioLabel: '差', displayOrder: 1, summary: '年收入超过5000万红线（准入反例）', checkpoint: '已分析，红线阻断', nextAction: '查看收入原件与规则依据', industry: '商贸' },
    { caseId: 'case-04', customerId: 'cust-004', displayName: '新乡恒达重工设备有限公司', scenarioLabel: '中', displayOrder: 4, summary: '现金流材料缺件', checkpoint: '已分析，信审待补件', nextAction: '补充现金流材料并重评' },
    { caseId: 'case-10', customerId: 'cust-010', displayName: '漯河食品机械有限公司', scenarioLabel: '好', displayOrder: 10, summary: '已结清，可演示返单', checkpoint: '已有结清与关闭的可追溯演练记录', nextAction: '开启返单新周期' },
    { caseId: 'case-06', customerId: 'cust-006', displayName: '洛阳涧西精密装备有限公司', scenarioLabel: '中', displayOrder: 6, summary: '人工核验未完成', checkpoint: '材料/分析已有，人工核验待办', nextAction: '完成收入/主体/权属核验' },
    // 其余五例（02/03 就绪后到达）——验证任意数量都可横向展列
    { caseId: 'case-02', customerId: 'cust-002', displayName: '恒昌精密部件有限公司', scenarioLabel: '差', displayOrder: 2, summary: '资产权属冲突', checkpoint: '已核验，明确不通过' },
    { caseId: 'case-03', customerId: 'cust-003', displayName: '蓝谷食联集团有限公司', scenarioLabel: '差', displayOrder: 3, summary: '偿债能力不足', checkpoint: '已分析，风险意见待决定' },
    { caseId: 'case-05', customerId: 'cust-005', displayName: '中州门窗科技有限公司', scenarioLabel: '中', displayOrder: 5, summary: '金额/期间口径冲突', checkpoint: '分析已识别冲突，待核实' },
    { caseId: 'case-07', customerId: 'cust-007', displayName: '宛城新能源材料有限公司', scenarioLabel: '中', displayOrder: 7, summary: '新证据使旧结论需复核', checkpoint: '历史判断已保存，当前标陈旧' },
    { caseId: 'case-09', customerId: 'cust-009', displayName: '汴梁纺机股份有限公司', scenarioLabel: '好', displayOrder: 9, summary: '履约等待外部回执', checkpoint: '已完成前序，履约后待回执' },
  ],
};

function demoWb(overrides = {}) {
  const calls = { read: [], history: [] };
  const client = {
    read: async (path) => { calls.read.push(path); if (overrides.readError) { const e = new Error('not found'); e.status = 404; e.code = 'NOT_FOUND'; throw e; } return JSON.parse(JSON.stringify(overrides.manifest ?? TEN_CASES)); },
    advance: { history: async (customerId) => { calls.history.push(customerId); return overrides.history?.[customerId] ?? []; } },
    directory: async () => ({ kind: 'ok', customers: [{ customerId: 'acc-cust-1', displayName: '青山机械（合成）' }] }),
    ...(overrides.client ?? {}),
  };
  const wb = { session: { ...fakeSession('biz1'), tenantId: 't1' }, error: null, setError() {}, logout() {}, client };
  return { wb, calls };
}

test('十案例目录：差→中→好横向展列，显示要点/阶段/下一动作，不挤一屏且无验收视图/调试开关', async t => {
  t.after(cleanup); localStorage.clear();
  const { wb, calls } = demoWb();
  const opened = [];
  render(React.createElement(CustomerDirectory, { wb, onOpen: id => opened.push(id) }));
  const strip = await screen.findByRole('list', { name: '案例列表（横向滚动）' });
  // 十例全部渲染、按 差→中→好 再 displayOrder 排序
  const items = within(strip).getAllByRole('listitem');
  assert.equal(items.length, 10);
  const names = items.map(x => x.textContent);
  assert.match(names[0], /金盛贸易发展有限公司/);
  assert.match(names[3], /新乡恒达重工设备有限公司/);
  assert.match(names[7], /郑州拓峰机械制造有限公司/);
  // 卡片内容：分类/要点/当前阶段/下一动作/模拟标识
  const first = items[0].textContent;
  assert.match(first, /差/);
  assert.match(first, /年收入超过5000万红线/);
  assert.match(first, /当前阶段/);
  assert.match(first, /已分析，红线阻断/);
  assert.match(first, /下一动作/);
  assert.match(first, /模拟案例/);
  // 横向滚动结构 + 步进按钮（不把十卡挤进一屏）
  assert.ok(screen.getByRole('button', { name: '向左滚动案例' }));
  assert.ok(screen.getByRole('button', { name: '向右滚动案例' }));
  // 打开案例：真实 customerId
  fireEvent.click(items[0].querySelector('[role="button"]'));
  assert.deepEqual(opened, ['cust-001']);
  // 业务入口无验收视图/搜索/新建/内部编号/夹具开关
  assert.equal(screen.queryByText(/验收视图：查看全部客户/), null);
  assert.equal(screen.queryByLabelText('搜索客户'), null);
  assert.equal(screen.queryByRole('button', { name: '＋ 新建客户' }), null);
  assert.equal(screen.queryByText(/cust-001/), null);
  assert.equal(screen.queryByText(/case-01/), null);
  // 逐客户只读进度
  await waitFor(() => assert.equal(calls.history.length, 10));
});

test('A实际目录契约：分类、对象检查点与数组下一动作显示真实状态', async t => {
  t.after(cleanup); localStorage.clear();
  const manifest = { ok:true, manifestVersion:'ten-cases', cases:[{
    caseId:'case-09',customerId:'cust-009',displayName:'制造业履约客户',category:'好',displayOrder:9,
    checkpoint:{type:'awaiting_external',label:'履约完成，等待外部回执',evidence:{kind:'cycle',cycleId:'cyc-09'}},
    nextActions:[{action:'external-receipt',label:'登记来源明确的回执',hint:'未确认前不能结清'}],
  }] };
  const {wb}=demoWb({manifest});
  render(React.createElement(CustomerDirectory,{wb,onOpen(){}}));
  const list=await screen.findByRole('list',{name:'案例列表（横向滚动）'});
  assert.match(list.textContent,/好/);assert.match(list.textContent,/履约完成，等待外部回执/);assert.match(list.textContent,/登记来源明确的回执/);
  assert.doesNotMatch(list.textContent,/尚未开始办理/);
});

test('演示目录未接通：诚实提示回退完整目录；?acceptance=1 才提供验收视图工程入口', async t => {
  t.after(cleanup); localStorage.clear();
  const { wb } = demoWb({ readError: true });
  render(React.createElement(CustomerDirectory, { wb, onOpen: () => {} }));
  assert.ok(await screen.findByText(/演示案例目录未接通/));
  assert.ok(screen.getByRole('button', { name: '重试演示目录' }));
  assert.ok(screen.getByLabelText('搜索客户'));
  // 夹具：十例布局可检验并显著标注
  window.history.replaceState(null, '', '/?demoFixture=1');
  cleanup();
  const fx = demoWb({ client: { read: async () => { throw new Error('fixture must not call server manifest'); } } });
  render(React.createElement(CustomerDirectory, { wb: fx.wb, onOpen: () => {} }));
  assert.ok(await screen.findByText(/开发夹具布局预览/));
  const strip = screen.getByRole('list', { name: '案例列表（横向滚动）' });
  assert.equal(strip.querySelectorAll('[role="listitem"]').length, 10);
  window.history.replaceState(null, '', '/');
});

test('卡片进度来自服务端回执；读取失败如实标注且不冒充未开始', async t => {
  t.after(cleanup); localStorage.clear();
  const { wb } = demoWb({ history: { 'cust-001': [
    { customerId: 'cust-001', roundId: 'r1', domain: 'business', current: true, roundNo: 1, version: 2, state: 'awaiting_confirmation' },
    { customerId: 'cust-001', roundId: 'r2', domain: 'credit', current: true, roundNo: 1, version: 1, state: 'running' },
  ], 'cust-004': [] } });
  render(React.createElement(CustomerDirectory, { wb: { ...wb, client: { ...wb.client, advance: { history: async (id) => id === 'cust-004' ? [] : wb.client.advance.history(id) } } }, onOpen: () => {} }));
  await waitFor(() => { const strip = document.querySelector('.tk-strip'); assert.match(strip.textContent, /业务·待确认/); });
  assert.match(document.querySelector('.tk-strip').textContent, /信审·处理中/);
});

test('角色入口：单角色身份自动进入（隐藏工程身份选择）；多单角色才出选择；内部代号不外显', async t => {
  t.after(cleanup); localStorage.clear();
  const ids = [];
  const wb = { identities: [
    { principalId: 'biz1', label: 'biz1', roles: ['business'] },
    { principalId: 'adv1', label: 'adv1', roles: ['business', 'policy', 'credit', 'commerce', 'asset'] },
  ], loginWithIdentity: async id => ids.push(id) };
  render(React.createElement(RoleEntry, { wb }));
  fireEvent.click(screen.getByRole('button', { name: /业务：精准识客/ }));
  await waitFor(() => assert.deepEqual(ids, ['biz1'])); // 直接进入唯一单业务身份，无工程身份选择
  assert.equal(screen.queryByText('adv1'), null);
  assert.equal(screen.queryByLabelText('选择工作身份'), null);
});

test('登录失败分类：数据库/上游不可用、角色未配置、权限、网络各有可理解的恢复提示', () => {
  assert.match(describeLoginFailure({ status: 503, code: 'CREDENTIAL_VERIFICATION_UNAVAILABLE', message: 'db down' }), /数据库或上游服务未启动/);
  assert.match(describeLoginFailure({ status: 503, code: 'CREDENTIAL_VERIFICATION_UNAVAILABLE' }), /重新选择角色/);
  assert.match(describeLoginFailure({ status: 504, code: 'GATEWAY_TIMEOUT', message: 'timeout' }), /数据库与办理服务已启动/);
  assert.match(describeLoginFailure({ code: 'PRINCIPAL_UNTRUSTED' }), /身份目录登记/);
  assert.match(describeLoginFailure({ status: 403, code: 'FORBIDDEN' }), /权限或凭据/);
  assert.match(describeLoginFailure(new TypeError('Failed to fetch')), /网络不可达/);
  assert.match(describeLoginFailure({ status: 500, code: 'INTERNAL' }), /登录未成功/);
});

test('DEF-03-05：核验登记调用既有授权接口（confirmed+registerArtifact+受影响区重评），勾选与依据必填', async t => {
  t.after(cleanup); localStorage.clear();
  const calls = { register: [], plan: [], advance: [] };
  const plan = { customerId: 'cust-006', domain: 'asset', available: true, planId: 'p1', planHash: 'h1', roundNo: 2, expectedVersion: { v: 1 }, summary: '重评计划', allowedActions: [{ actionId: 'a1', commandKind: 'advance' }] };
  const wb = {
    session: { ...fakeSession('asset1'), tenantId: 't1' }, customerId: 'cust-006',
    refresh: async () => {},
    client: {
      read: async () => ({artifacts:[{artifactId:'source-unique',factKey:'equipment_ownership_verified',current:true}]}),
      registerArtifact: async (cid, body) => { calls.register.push({ cid, body }); return { ok: true }; },
      advance: {
        plan: async (_c, d) => { calls.plan.push(d); return { ...plan, domain: d }; },
        advance: async (cid, p, requestId) => { calls.advance.push({ domain: p.domain, requestId }); return { customerId: cid, requestId, roundId: 'r9', domain: p.domain, current: true, version: 3, roundNo: 2, state: 'running', columnResults: [], downstream: [] }; },
        recover: async () => null,
      },
    },
  };
  render(React.createElement(HumanVerificationRegister, { wb, customerId: 'cust-006', domain: 'asset' }));
  const submit = () => fireEvent.click(screen.getByRole('button', { name: '提交核验结论并重评' }));
  // 未选结论/未填依据/未勾选：不发送
  submit();
  assert.ok(screen.getByRole('alert'));
  fireEvent.click(screen.getByRole('radio', { name: '通过' }));
  submit(); assert.ok(screen.getByRole('alert'));
  fireEvent.change(screen.getByLabelText('核验依据说明'), { target: { value: '动产融资统一登记核查无在先负担，与设备清单一致' } });
  submit(); assert.ok(screen.getByRole('alert'));
  fireEvent.click(screen.getByRole('checkbox'));
  submit();
  // 二次确认对话框
  const dlg = await screen.findByRole('dialog');
  fireEvent.click(within(dlg).getByRole('button', { name: '登记核验结论' }));
  await waitFor(() => assert.equal(calls.register.length, 1));
  const body = calls.register[0].body;
  assert.equal(body.factKey, 'equipment_ownership_verified');
  assert.equal(body.grade, 'confirmed');
  assert.equal(body.supersedes, 'source-unique');
  assert.equal(body.kind, 'document');
  assert.equal(body.content.value, true);
  assert.equal(body.content.sourceMode, 'human_verified_document');
  assert.equal(body.content.note, '动产融资统一登记核查无在先负担，与设备清单一致');
  assert.equal(body.materialMeta.subjectRef, 'cust-006');
  assert.ok(body.requestId);
  await waitFor(() => assert.deepEqual(calls.plan, ['asset']));
  assert.equal(calls.advance.length, 1);
  assert.ok(screen.getByText(/核验结论已登记/));
  // 差例路径：权属不通过 → value=false（如实登记，不刷绿）
  cleanup(); localStorage.clear();
  const calls2 = { register: [] };
  const wb2 = { ...wb, client: { ...wb.client, registerArtifact: async (cid, body) => { calls2.register.push(body); return { ok: true }; } } };
  render(React.createElement(HumanVerificationRegister, { wb: wb2, customerId: 'cust-006', domain: 'asset' }));
  fireEvent.click(screen.getByRole('radio', { name: /不通过/ }));
  fireEvent.change(screen.getByLabelText('核验依据说明'), { target: { value: '登记系统显示主设备存在在先租赁负担，申报"自有"被证伪' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交核验结论并重评' }));
  const dlg2 = await screen.findByRole('dialog');
  fireEvent.click(within(dlg2).getByRole('button', { name: '登记核验结论' }));
  await waitFor(() => assert.equal(calls2.register.length, 1));
  assert.equal(calls2.register[0].content.value, false);
});

test('履约·结清·返单面板：状态驱动动作；待外部回执不显示为完成、未确认不可结清、返单开新周期', async t => {
  t.after(cleanup); localStorage.clear();
  const calls = { actions: [] };
  const cycles = [
    { cycleId: 'cyc-aaa1', state: 'open' },
    { cycleId: 'cyc-bbb2', state: 'awaiting_external_receipt' },
    { cycleId: 'cyc-ccc3', state: 'awaiting_external_receipt', externalReceipt: { ref: 'SIM-READY-3', source: '受控模拟回执', recordedBy: '商务' } },
    { cycleId: 'cyc-ddd4', state: 'settled' },
  ];
  const wb = {
    session: { ...fakeSession('biz1'), tenantId: 't1' }, customerId: 'cust-009', refresh: async () => {},
    client: {
      listCycles: async () => ({ cycles }),
      advance: { plan: async () => ({available:true}) },
      fulfillCycle: async (c, id, r) => { calls.actions.push(['fulfill', id, r]); return { ok: true }; },
      recordExternalReceipt: async (c, id, body) => { calls.actions.push(['receipt', id, body.ref, body.source]); return { ok: true }; },
      settleCycle: async (c, id, r) => { calls.actions.push(['settle', id, r]); return { ok: true }; },
      closeCycle: async (c, id, r) => { calls.actions.push(['close', id, r]); return { ok: true }; },
      createCycle: async (c, body) => { calls.actions.push(['reorder', body.reorderOf]); return { ok: true, cycleId: 'cyc-new' }; },
    },
  };
  render(React.createElement(CyclesPanel, { wb, customerId: 'cust-009' }));
  await screen.findByText(/周期 cyc-aaa1/);
  assert.match(document.querySelector('[aria-label="履约·结清·返单"]').textContent, /待外部回执（外部收付款未连接）/);
  assert.match(document.querySelector('[aria-label="履约·结清·返单"]').textContent, /回执已登记，可结清/);
  // 各状态动作按钮正确
  assert.ok(screen.getByRole('button', { name: '履约完成' }));
  assert.ok(screen.getByRole('button', { name: '登记外部回执…' }));
  assert.ok(screen.getByRole('button', { name: '结清' }));
  assert.ok(screen.getByRole('button', { name: '返单（新周期）' }));
  // 履约（二次确认+幂等 requestId）
  const confirmInDialog = async (label) => { const d = await screen.findByRole('dialog'); fireEvent.click(within(d).getByRole('button', { name: label })); };
  fireEvent.click(screen.getByRole('button', { name: '履约完成' }));
  await confirmInDialog('履约完成');
  await waitFor(() => { assert.equal(calls.actions[0][0], 'fulfill'); assert.equal(calls.actions[0][1], 'cyc-aaa1'); assert.ok(calls.actions[0][2]); });
  // 回执登记：来源明确的模拟回执
  fireEvent.change(screen.getByLabelText('回执编号'), { target: { value: 'SIM-RECEIPT-0001' } });
  fireEvent.click(screen.getByRole('button', { name: '登记外部回执…' }));
  await confirmInDialog('登记回执');
  await waitFor(() => assert.deepEqual(calls.actions[1].slice(0,3), ['receipt', 'cyc-bbb2', 'SIM-RECEIPT-0001']));
  // 结清
  fireEvent.click(screen.getByRole('button', { name: '结清' }));
  await confirmInDialog('结清');
  await waitFor(() => { assert.equal(calls.actions[2][0], 'settle'); assert.equal(calls.actions[2][1], 'cyc-ccc3'); });
  // 返单=新周期
  fireEvent.click(screen.getByRole('button', { name: '返单（新周期）' }));
  await confirmInDialog('继续返单办理');
  await waitFor(() => assert.deepEqual(calls.actions[3], ['reorder', 'cyc-ddd4']));
});

test('助手无模型：提问得到"案例说明"确定性投影（来源清楚），而非空白或通用失败', async t => {
  t.after(cleanup); localStorage.clear();
  const wb = {
    session: { sessionId: 's1', roles: ['business'] }, customerId: 'cust-006',
    snapshot: { customer: { displayName: '洛阳涧西精密装备有限公司' }, decisionStatus: { basis: { gate: { result: 'blocked' }, blockedActions: ['facility.approve'] } } },
    client: { observeAssistantError: null },
  };
  wb.client.observeAssistant = async () => { const e = new Error('model not configured'); e.status = 503; e.code = 'MODEL_NOT_CONFIGURED'; throw e; };
  const source = { snapshot: wb.snapshot, packageDetail: null, channelTasks: [], currentMaterials: 4, factConflicts: 0 };
  render(React.createElement(TakeoffAssistants, { wb, customerId: 'cust-006', source, onOpenMaterials: () => {} }));
  const box = screen.getByLabelText('聊天消息');
  fireEvent.change(box, { target: { value: '@业务 现在办理到哪一步了？' } });
  fireEvent.submit(box.closest('form'));
  await screen.findByText(/案例说明 · 服务端读面组答/);
  assert.match(document.querySelector('[aria-label="助手对话"]').textContent, /非真实模型/);
  assert.match(document.querySelector('[aria-label="助手对话"]').textContent, /洛阳涧西精密装备有限公司/);
  assert.match(document.querySelector('[aria-label="助手对话"]').textContent, /现行材料 4 份/);
  // 未接通功能降噪：语音/电话/扫码按钮不在主流程
  assert.equal(screen.queryByRole('button', { name: /语音输入/ }), null);
  assert.equal(screen.queryByRole('button', { name: /电话/ }), null);
  assert.equal(screen.queryByRole('button', { name: /扫码/ }), null);
});
test('未确认核验恢复时展示并重发原内容，不能改变同一请求载荷', async t => {
 t.after(cleanup); localStorage.clear(); let sent;
 const registration={tenantId:'t1',requestId:'original-request',kind:'document',factKey:'revenue_annual_declared',grade:'confirmed',content:{value:18000000,unit:'CNY',note:'原件核对依据'},materialMeta:{subjectRef:'cust-retry'}};
 localStorage.setItem('jw:fact-verify:cust-retry:revenue_annual_declared',JSON.stringify({customerId:'cust-retry',factKey:'revenue_annual_declared',phase:'registering',requestId:'original-request',registration}));
 const wb={session:fakeSession('biz1'),refresh:async()=>{},client:{registerArtifact:async(_c,body)=>{sent=body;return {ok:true}}}};
 render(React.createElement(HumanVerificationRegister,{wb,customerId:'cust-retry',domain:'opportunity'}));
 const value=screen.getByLabelText('年收入核验数值（万元）');assert.equal(value.value,'1800');assert.equal(value.disabled,true);
 assert.equal(screen.getByLabelText('核验依据说明').value,'原件核对依据');
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'继续核对原核验登记'}));
 const dialog=await screen.findByRole('dialog');assert.match(dialog.textContent,/1800 万元/);assert.match(dialog.textContent,/原件核对依据/);
 fireEvent.click(within(dialog).getByRole('button',{name:'登记核验结论'}));await waitFor(()=>assert.deepEqual(sent,registration));
});
