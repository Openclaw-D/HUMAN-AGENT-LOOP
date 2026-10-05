// V0.6-LT-02 行为测试：四页状态/原因/下一步一致性的两处局部修复。
// F2（case-brief.deriveCaseBrief）：arrow 轮次面缺失（如 Edge 侧数据面被清空）但 A 依据包
//   decisionStatus.basis.currency 仍有现行专业结论时，“办理进度”行不得只说“预评估尚未开始”
//   ——与同屏看板办结绿格（takeoff-projection 用同一 basis.currency 判 completed）矛盾。
//   修复后用与看板同词汇如实带出（≠正式批准）；无依据包数据时保持原文，不编造。
// F3（takeoff-detail）：已完成且无卡点的格子抽屉首节标题动态为“当前状态”，
//   不再出现“待处理/本项已完成”同节矛盾；未完成格保持“待处理”（既有断言不回归）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, act } from './harness.mjs';
const React = await import('react');
const { deriveCaseBrief } = await import('../../../site-mirror/lib/workbench/case-brief.ts');
const { TakeoffCellDetail } = await import('../../../site-mirror/app/takeoff/takeoff-detail.tsx');

// arrow 不可用 + 无评估 + A 依据包四区现行（博乐实栈形状：Edge 重启清轮次、A 依据包保留）
const settledSrc = (currency) => ({
  customerName: '博乐厂', currentMaterials: 18, factConflicts: 0,
  snapshot: {
    customer: { displayName: '博乐厂', status: 'active' },
    assessments: [],
    admission: null,
    decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency } },
    session: { openQuestions: 0 },
  },
});
const fourCurrent = [
  { domain: 'policy', currency: 'current', reasons: [] },
  { domain: 'credit', currency: 'current', reasons: [] },
  { domain: 'commerce', currency: 'current', reasons: [] },
  { domain: 'asset', currency: 'current', reasons: [] },
];

test('LT-02 F2：arrow缺失但依据包有现行结论时，进度行如实带出，不与看板办结绿格矛盾', () => {
  const brief = deriveCaseBrief(settledSrc(fourCurrent));
  const assess = brief.situation.find((s) => s.key === 'assess');
  assert.ok(assess, '办理进度行存在');
  assert.ok(assess.text.includes('预评估尚未开始'), '预评估链未开始仍如实保留');
  assert.ok(assess.text.includes('已有现行专业结论'), 'A 依据包现行结论如实带出（与看板同词汇）');
  assert.ok(assess.text.includes('政策') && assess.text.includes('资产'), '列明具体专业');
  assert.ok(assess.text.includes('≠正式批准'), '现行结论≠正式批准口径不丢');
});

test('LT-02 F2：无依据包数据时保持“预评估尚未开始”原文，不编造结论', () => {
  const brief = deriveCaseBrief(settledSrc([]));
  const assess = brief.situation.find((s) => s.key === 'assess');
  assert.equal(assess.text, '预评估尚未开始', '空 currency=原文，不加收口提示');
  const missing = deriveCaseBrief(settledSrc([
    { domain: 'policy', currency: 'missing', reasons: [] },
    { domain: 'credit', currency: 'changed', reasons: ['x'] },
  ]));
  assert.equal(missing.situation.find((s) => s.key === 'assess').text, '预评估尚未开始', 'missing/changed≠current，不冒充现行结论');
});

test('LT-02 F2：有评估时进度行仍跟随评估状态，不被收口提示覆盖', () => {
  const src = settledSrc(fourCurrent);
  src.snapshot.assessments = [{ status: 'collecting', stale: false }];
  const brief = deriveCaseBrief(src);
  const assess = brief.situation.find((s) => s.key === 'assess');
  assert.ok(assess.text.includes('正在收集材料'), '有评估时如实显示评估状态');
  assert.ok(!assess.text.includes('已有现行专业结论'), '收口提示只补“尚未开始”分支，不改写评估状态行');
});

const wbMock = { snapshot: null, customerId: 'c-lt2' };
const cell = (over) => ({
  domain: 'policy', row: 'closure', displayBucket: null, running: false,
  completed: false, needsReview: false, frozen: false, allowedActions: [],
  items: [], basis: 'test', responsible: 'policy', ...over,
});

test('LT-02 F3：已完成且无卡点的格子抽屉首节=当前状态，不再“待处理/已完成”同节矛盾', (t) => {
  t.after(cleanup);
  const done = cell({ completed: true, items: [{ key: 'cur', label: '本专业办理已完成', tone: 'green', detail: '绿=该格工作完成，≠支持融资' }] });
  render(React.createElement(TakeoffCellDetail, { wb: wbMock, cell: done, onOpenPanel: () => {} }));
  assert.ok(screen.getByText('当前状态'), '完成格首节标题=当前状态');
  assert.equal(screen.queryByText('待处理'), null, '完成格不再出现“待处理”标题');
  assert.ok(screen.getByText('本项已完成。'), '完成正文保留');
  cleanup();
  // 未完成格保持既有“待处理”（takeoff-board 既有断言不回归）
  const open = cell({ completed: false, items: [] });
  render(React.createElement(TakeoffCellDetail, { wb: wbMock, cell: open, onOpenPanel: () => {} }));
  assert.ok(screen.getByText('待处理'), '未完成格首节标题=待处理（不变）');
  assert.equal(screen.queryByText('当前状态'), null, '未完成格不出现“当前状态”标题');
  assert.ok(screen.getByText('本项尚未完成，已取得的结果见下方。'), '未完成正文保留');
});

test('LT-02 F3：有卡点/冻结的完成格不误标“当前状态”，卡点仍归待处理节', (t) => {
  t.after(cleanup);
  const conflicted = cell({ completed: false, items: [{ key: 'conf', label: '有 1 处材料内容需要核对', tone: 'red', detail: 'x' }] });
  render(React.createElement(TakeoffCellDetail, { wb: wbMock, cell: conflicted, onOpenPanel: () => {} }));
  assert.ok(screen.getByText('待处理'), '有卡点格保持待处理标题');
  assert.ok(screen.getByText(/有 1 处材料内容需要核对/), '卡点项可见');
  cleanup();
  const frozen = cell({ frozen: true, items: [] });
  render(React.createElement(TakeoffCellDetail, { wb: wbMock, cell: frozen, onOpenPanel: () => {} }));
  assert.ok(screen.getByText('待处理'), '冻结格保持待处理标题');
  assert.ok(screen.getByText(/依据有变化/), '冻结提示可见');
});

// ---- LT-02 UI-A/UI-B（Codex 阶段验收补充发现）----

const { factKeyLabel } = await import('../../../site-mirror/lib/workbench/material-labels.ts');
const { DecisionFeedbackPanel } = await import('../../../site-mirror/app/takeoff/decision-feedback-panel.tsx');
const { CaseBriefStrip: Strip2 } = await import('../../../site-mirror/app/takeoff/case-brief-strip.tsx');

test('UI-A：factKey→业务事实名映射；未知键如实返回null不编造', () => {
  assert.equal(factKeyLabel('revenue_annual_declared'), '年收入申报');
  assert.equal(factKeyLabel('equipment_deal_amount'), '设备对价');
  assert.equal(factKeyLabel('transaction_scope'), '交易范围');
  assert.equal(factKeyLabel('unknown_fact_xyz'), null, '未知键=null，回退类名');
  assert.equal(factKeyLabel(null), null);
});

test('UI-A：materialName 登记名缺失时用“类名·事实名”可区分；有登记名不动', async () => {
  const mod = await import('../../../site-mirror/app/takeoff/materials-desk.tsx');
  // materialName 未导出——经组件行为验证：渲染清单行含“财务报表·年收入申报”
  const wbCli = {
    read: async () => ({ artifacts: [
      { artifactId: 'art-aaaaaaaa1234', kind: 'material.financial_statement', factKey: 'revenue_annual_declared', current: true, createdAt: '2026-09-30T11:58:00Z' },
      { artifactId: 'art-bbbbbbbb5678', kind: 'material.financial_statement', factKey: 'total_assets_declared', current: true, createdAt: '2026-09-30T11:58:00Z' },
      { artifactId: 'art-cccccccc9012', kind: 'material.financial_statement', factKey: 'mystery_key', current: true },
      { artifactId: 'art-dddddddd3456', kind: 'material.financial_statement', materialFileMeta: { name: '年报原件.pdf' }, current: true },
    ] }),
  };
  const wb = { client: wbCli, customerId: 'c1', snapshot: null, snapshotVersion: 1 };
  await act(async () => render(React.createElement(mod.MaterialsDesk, { wb, customerId: 'c1', onUpload: () => {} })));
  const items = await screen.findAllByRole('button', { name: /财务报表/ });
  const texts = items.map((b) => b.textContent).join('|');
  assert.ok(texts.includes('财务报表·年收入申报'), '同名卡片按事实名区分');
  assert.ok(texts.includes('财务报表·总资产申报'), '第二份同样可区分');
  assert.ok(texts.includes('编号 aa1234'), '清单行带编号可寻址');
  assert.ok(!/·mystery|·未知/.test(texts), '未知事实键不编造标签');
  assert.ok(texts.includes('期间未标注'), '期间缺失如实保留不猜日期');
  const listText = document.querySelector('.tk-material-list')?.textContent ?? '';
  assert.ok(listText.includes('年报原件.pdf'), '有登记名的材料名不被覆盖');
});

test('UI-B：决策面板证据类失败按助手所属专业标域，不再泛写', async (t) => {
  t.after(cleanup); cleanup();
  const wbCli = {
    readDecisions: async () => { throw Object.assign(new Error('x'), { code: 'EVIDENCE_MISSING' }); },
  };
  const wb = { client: wbCli, customerId: 'c1', snapshot: { customer: { displayName: '甲' } }, snapshotVersion: 1 };
  await act(async () => render(React.createElement(DecisionFeedbackPanel, { wb, assistant: 'asset' })));
  const note = await screen.findByRole('status');
  assert.ok(note.textContent.includes('资产侧：'), '标明资产侧（不与其他域缺件混写）');
  assert.ok(note.textContent.includes('还有必要材料未收到'), '原文保留');
});

test('UI-B：简报条顶部下一步=短句，完整依据句收进展开区可达', () => {
  const conflicted = {
    customerName: '喀什纺织厂', currentMaterials: 6, factConflicts: 2,
    factConflictKeys: ['equipment_deal_amount'],
    snapshot: {
      customer: { displayName: '喀什纺织厂', status: 'active' }, assessments: [], admission: null,
      decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } },
    },
  };
  const brief = deriveCaseBrief(conflicted);
  assert.ok(brief.nextStep.short, '冲突分支提供短句');
  assert.ok(brief.nextStep.short.includes('互相矛盾'), '短句含原因');
  assert.ok(brief.nextStep.short.includes('登记更正'), '短句含一项动作');
  assert.ok(brief.nextStep.what.includes('不按最后上传自动采用'), '完整句保留（不自动采信依据不丢）');
  // 渲染层：顶部=短句；展开区=完整句
  const { container } = render(React.createElement(Strip2, { source: conflicted, customerName: '喀什纺织厂' }));
  const rows = [...container.querySelectorAll('.tk-brief-row')];
  const topNext = rows.find((r) => r.textContent.includes('下一步'));
  assert.ok(topNext && topNext.textContent.includes('登记更正'));
  const details = container.querySelector('details.tk-brief-more');
  assert.ok(details.textContent.includes('不按最后上传自动采用'), '完整依据句在展开区可达');
  assert.ok(details.textContent.includes('下一步依据'), '展开区有下一步依据行');
});

// ---- LT-02 FF-1（48531 新栈 FRONT_FOLLOWUP 实栈发现）：商机办结格与简报“业务现行结论”同源 ----

const { deriveTakeoffCells } = await import('../../../site-mirror/lib/workbench/takeoff-projection.ts');

test('FF-1：A依据包business结论现行时商机办结格如实收口（与简报同词汇）；无/changed不冒充完成', () => {
  const mk = (currency) => ({
    snapshot: { decisionStatus: { basis: { packageId: 'pkg', currency } }, assessments: [] },
    packageDetail: null, channelTasks: [], currentMaterials: 3, factConflicts: 0,
  });
  const allCurrent = ['business', 'policy', 'credit', 'commerce', 'asset'].map((domain) => ({ domain, currency: 'current' }));
  const opp = (cells) => cells.find((c) => c.domain === 'opportunity' && c.row === 'closure');
  const done = opp(deriveTakeoffCells(mk(allCurrent)));
  assert.equal(done.completed, true, '商机办结=已完成（消除与简报“业务已有现行结论”的同屏矛盾）');
  assert.ok(done.items.some((i) => i.label === '本专业办理已完成' && i.tone === 'green'), '绿格文案与四后端域同词汇');
  const none = opp(deriveTakeoffCells(mk([{ domain: 'policy', currency: 'current' }])));
  assert.equal(none.completed, false, '无business结论=保持尚未完成，不编造');
  assert.ok(none.items.some((i) => i.label === '业务办理尚未完成'), '原文案保留');
  const chg = opp(deriveTakeoffCells(mk([{ domain: 'business', currency: 'changed' }])));
  assert.equal(chg.completed, false, 'changed≠current，不冒充完成');
});

// ---- NIGHT-FF2（48531 C02 红线四页不可见）：advance-plan 计划面静态投影 ----

test('FF2：planBlock 静态投影→办理规则行置首+attention，下一步=规则句（顶部短句），不编造制度', () => {
  const pb = {
    domain: 'business', reason: 'CUSTOMER_REVENUE_REDLINE',
    text: '客户年收入超过5000万元准入红线：本次按规则不能推进，补件不能放行；仅人工核验原件后在材料页显式登记更正版收入事实（更正留痕，不覆盖历史），才能重新评估解除',
    next: '按准入规则本次不能推进：人工核验原件后，在材料页显式登记更正版收入事实（更正留痕，不覆盖历史），才能重新评估解除',
    short: '收入超5000万红线：本次不能推进，需登记更正版收入事实',
  };
  const src = {
    customerName: '佛山厂', currentMaterials: 4, factConflicts: 0,
    planBlock: pb,
    snapshot: { customer: { displayName: '佛山厂', status: 'active' }, assessments: [], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } } },
  };
  const brief = deriveCaseBrief(src);
  const rule = brief.situation.find((s) => s.key === 'plan_block');
  assert.ok(rule, '办理规则行存在');
  assert.equal(brief.situation[0].key, 'plan_block', '确定性阻断置现状首位（主导本次能否推进）');
  assert.ok(rule.attention, '红线需要人工注意');
  assert.ok(rule.text.includes('5000万') && rule.text.includes('更正版'), '规则句来自共享映射（不新增制度）');
  assert.equal(brief.nextStep.who, '业务人员');
  assert.ok(brief.nextStep.what.includes('不能推进') && brief.nextStep.what.includes('更正版收入事实'), '下一步=规则句（原因+解除路径）');
  assert.ok(brief.nextStep.short.includes('红线'), '顶部短句可读');
});

test('FF2：无 planBlock 时无办理规则行，既有简报行为零变化', () => {
  const src = {
    customerName: '正常厂', currentMaterials: 3, factConflicts: 0,
    snapshot: { customer: { displayName: '正常厂', status: 'active' }, assessments: [], admission: null, decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } } },
  };
  const brief = deriveCaseBrief(src);
  assert.equal(brief.situation.some((s) => s.key === 'plan_block'), false, '无计划阻断=无规则行');
  assert.ok(brief.nextStep.what.includes('提交材料并分析'), '常规下一步不受影响');
  // planBlock=null 显式传入同样无行
  const explicit = deriveCaseBrief({ ...src, planBlock: null });
  assert.equal(explicit.situation.some((s) => s.key === 'plan_block'), false);
});

// ---- NIGHT_GATE_0145 整改：计划面刷新/竞态/按钮消费静态阻断 ----

const { eventView, planBlockOf } = await import('../../../site-mirror/app/takeoff/column-advance.tsx');

test('GATE-FF2：planBlockOf 仅在 available:false+已知原因时给阻断；unknown原因/可读/无读不冒充', () => {
  const RED = 'CUSTOMER_REVENUE_REDLINE';
  const block = planBlockOf({ available: false, reason: RED }, 'business');
  assert.ok(block && block.domain === 'business' && block.reason === RED, '确定性阻断→阻断块');
  assert.ok(block.text.includes('5000万') && block.next && block.short, 'text/next/short 同源映射');
  assert.equal(planBlockOf({ available: true, reason: RED }, 'business'), null, '计划可用=不阻断');
  assert.equal(planBlockOf({ available: false, reason: 'MYSTERY_REASON' }, 'business'), null, '未知原因→null（不猜制度、不冒充可用）');
  assert.equal(planBlockOf({ available: false }, 'business'), null, '无原因→null');
  assert.equal(planBlockOf(null, 'business'), null, '读不到→null');
});

const fakeApi = { plan: async () => ({}) };
test('GATE-FF2：eventView 当前专业列阻断→blocked按钮（同原因不引导提交分析）；他列/无阻断走既有路径', () => {
  const pb = { domain: 'business', reason: 'CUSTOMER_REVENUE_REDLINE', text: '客户年收入超过5000万元准入红线：本次按规则不能推进', next: 'x', short: 'y' };
  const blocked = eventView({ api: fakeApi, working: false, domain: 'business', rows: [], planBlock: pb });
  assert.equal(blocked.kind, 'blocked', '当前列=blocked');
  assert.ok(blocked.label.includes('不能推进'), '按钮不再引导提交分析');
  assert.ok(blocked.title.includes('5000万'), '完整规则句在 title 可达');
  const other = eventView({ api: fakeApi, working: false, domain: 'policy', rows: [], planBlock: pb });
  assert.equal(other.kind, 'advance', '其他专业列不受当前列阻断影响');
  const none = eventView({ api: fakeApi, working: false, domain: 'business', rows: [] });
  assert.equal(none.kind, 'advance', '无阻断（未知/读失败=null）→按钮保持既有路径，不冒充不可用');
  const noApi = eventView({ api: undefined, working: false, domain: 'business', rows: [], planBlock: pb });
  assert.equal(noApi.kind, 'disabled', '服务未接通仍优先如实显示（既有行为不变）');
});

// ---- NIGHT_GATE_0215：计划面动态挂载行为测试（离线 jsdom，不动运行客户材料）----

test('GATE-FF2 动态挂载：版本/会话变化重读计划、旧客户响应晚回不写回、可用/读失败不冒充', async (t) => {
  t.after(() => cleanup());
  const React2 = React;
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  const deferred = [];
  const planCalls = [];
  const mkClient = () => ({
    read: async (path) => path.endsWith('/artifacts') ? { artifacts: [{ artifactId: 'a1', kind: 'invoice', current: true }] } : {},
    channelStatus: async () => ({ tasks: [], rulesetVersion: 'sim@1' }),
    packageDetail: async () => ({ package: { packageId: 'p1', revision: 1 }, domainResults: [] }),
    listMessages: async () => ({ messages: [], cursor: null }),
    sendMessage: async () => ({ ok: true }),
    action: async () => ({ ok: true }),
    confirmPreassessment: async () => ({ ok: true }),
    eventsPage: async () => ({ ok: true, events: [], nextAfterSeq: '1', hasMore: false }),
    advance: {
      plan: (cid, domain) => new Promise((resolve) => { planCalls.push({ cid, domain, resolve }); }),
      active: async () => ({ receipt: null }),
      history: async () => [],
      recover: async () => null,
    },
  });
  const mkWb = (over = {}) => {
    const w = {
      client: mkClient(), phase: 'live',
      session: { sessionId: 's1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 },
      customerId: 'c1', buildId: 't',
      snapshot: { customer: { customerId: 'c1', displayName: '甲客户', status: 'active' }, assessments: [], decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } }, session: { openQuestions: 0, followups: [] } },
      snapshotVersion: 1, error: null, setError: () => {}, refresh: () => {},
      ...over,
    };
    if (over.customerId && over.customerId !== 'c1') w.snapshot = { ...w.snapshot, customer: { customerId: over.customerId, displayName: '乙客户', status: 'active' } };
    return w;
  };
  const view = render(React2.createElement(Screen, { wb: mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(planCalls.length, 1, '挂载后恰一次计划读取');
  // 材料版本变化（snapshotVersion 前进）→ 重读
  await act(async () => { view.rerender(React2.createElement(Screen, { wb: mkWb({ snapshotVersion: 2 }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(planCalls.length, 2, 'snapshotVersion 前进→重读计划');
  // 换会话 → 重读
  await act(async () => { view.rerender(React2.createElement(Screen, { wb: mkWb({ session: { sessionId: 's2', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 } }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.ok(planCalls.length >= 3, '会话变化→重读计划');
  // 可用计划：规则行不出现、按钮常规
  const avail = planCalls[planCalls.length - 1];
  avail.resolve({ ok: true, customerId: 'c1', available: true, reason: null, allowedActions: [{ actionId: 'a', commandKind: 'k' }] });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(screen.queryByText('办理规则'), null, '计划可用=无规则行');
  // 旧客户响应晚回：切到 c2（plan 立即可用），再让 c1 的旧红线响应晚到
  await act(async () => { view.rerender(React2.createElement(Screen, { wb: mkWb({ customerId: 'c2' }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const stale = planCalls.find((c) => c.cid === 'c1' && !c.done);
  if (stale) {
    stale.done = true;
    await act(async () => {
      stale.resolve({ ok: true, customerId: 'c1', available: false, reason: 'CUSTOMER_REVENUE_REDLINE', allowedActions: [] });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    assert.equal(screen.queryByText('办理规则'), null, '旧客户红线响应晚回不得写回当前客户');
  }
  cleanup();
  // 读失败：不冒充阻断也不崩溃，按钮走既有路径
  const failing = mkWb();
  failing.client.advance.plan = async () => { throw Object.assign(new Error('x'), { status: 503 }); };
  const v2 = render(React2.createElement(Screen, { wb: failing, onBackToDirectory: () => {}, onLogout: () => {} }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(screen.queryByText('办理规则'), null, '读失败=无规则行（不冒充阻断）');
  v2.unmount();
  // 真实阻断出现态（挂载级）：available:false+已知原因 → 规则行+按钮禁用
  const blockedWb = mkWb();
  blockedWb.client.advance.plan = async () => ({ ok: true, customerId: 'c1', available: false, reason: 'CUSTOMER_REVENUE_REDLINE', allowedActions: [] });
  const v3 = render(React2.createElement(Screen, { wb: blockedWb, onBackToDirectory: () => {}, onLogout: () => {} }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.ok(screen.getByText('办理规则'), '阻断出现态=规则行');
  const btn = screen.getByRole('button', { name: '按办理规则暂不能推进' });
  assert.equal(btn.disabled, true, '办理按钮禁用，不引导提交分析');
  v3.unmount();
});
// NIGHT_GATE_0245 整改：因果隔离版（固定同一 client 实例，单变量重渲染，硬断言恰一次）。
// 0145 版缺陷（Codex 0245 复核）：mkWb 每次 mkClient() 生成新 client，effect 因 client 引用变化触发，
// snapshotVersion/session 独立因果未隔离——本组修正口径；0215 版报告保留作历史。

const REDLINE = 'CUSTOMER_REVENUE_REDLINE';
function mkFixedEnv() {
  const planCalls = [];
  let planReply = { ok: true, available: true, reason: null, allowedActions: [{ actionId: 'a', commandKind: 'k' }] };
  const client = {
    read: async (path) => path.endsWith('/artifacts') ? { artifacts: [{ artifactId: 'a1', kind: 'invoice', current: true }] } : {},
    channelStatus: async () => ({ tasks: [], rulesetVersion: 'sim@1' }),
    packageDetail: async () => ({ package: { packageId: 'p1', revision: 1 }, domainResults: [] }),
    listMessages: async () => ({ messages: [], cursor: null }),
    sendMessage: async () => ({ ok: true }),
    action: async () => ({ ok: true }),
    confirmPreassessment: async () => ({ ok: true }),
    eventsPage: async () => ({ ok: true, events: [], nextAfterSeq: '1', hasMore: false }),
    advance: {
      plan: (cid, domain) => { planCalls.push({ cid, domain }); return Promise.resolve({ ok: true, customerId: cid, ...planReply }); },
      active: async () => ({ receipt: null }),
      history: async () => [],
      recover: async () => null,
    },
  };
  const mkWb = (over = {}) => {
    const w = {
      client, phase: 'live',
      session: { sessionId: 's1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 },
      customerId: 'c1', buildId: 't',
      snapshot: { customer: { customerId: 'c1', displayName: '甲客户', status: 'active' }, assessments: [], decisionStatus: { basis: { gate: { result: 'pass' }, blockedActions: [], currency: [] } }, session: { openQuestions: 0, followups: [] } },
      snapshotVersion: 1, error: null, setError: () => {}, refresh: () => {},
      ...over,
    };
    if (over.customerId && over.customerId !== 'c1') w.snapshot = { ...w.snapshot, customer: { customerId: over.customerId, displayName: '乙客户', status: 'active' } };
    return w;
  };
  return { planCalls, client, mkWb, setPlanReply: (r) => { planReply = r; } };
}
const settleTwice = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test('GATE-0245 因果A：同一 client 仅 snapshotVersion 变化 → 恰一次重读计划', async (t) => {
  t.after(() => cleanup());
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  const env = mkFixedEnv();
  const view = render(React.createElement(Screen, { wb: env.mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  const before = env.planCalls.length;
  assert.equal(before, 1, '挂载恰一次');
  await act(async () => { view.rerender(React.createElement(Screen, { wb: env.mkWb({ snapshotVersion: 2 }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.equal(env.planCalls.length - before, 1, '仅版本变化→恰一次重读（排除 client 引用变化干扰）');
  await act(async () => { view.rerender(React.createElement(Screen, { wb: env.mkWb({ snapshotVersion: 3 }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.equal(env.planCalls.length - before, 2, '第二次仅版本变化→再恰一次（非每次渲染重读）');
});

test('GATE-0245 因果B：同一 client 仅 sessionId 变化 → 恰一次重读计划', async (t) => {
  t.after(() => cleanup());
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  const env = mkFixedEnv();
  const view = render(React.createElement(Screen, { wb: env.mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  const before = env.planCalls.length;
  assert.equal(before, 1, '挂载恰一次');
  await act(async () => { view.rerender(React.createElement(Screen, { wb: env.mkWb({ session: { sessionId: 's2', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3600_000 } }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.equal(env.planCalls.length - before, 1, '仅会话变化→恰一次重读');
});

test('GATE-0245 因果C：版本前进解除红线（残留清除+按钮恢复），解除恰一次重读', async (t) => {
  t.after(() => cleanup());
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  const env = mkFixedEnv();
  env.setPlanReply({ ok: true, available: false, reason: REDLINE, allowedActions: [] });
  const view = render(React.createElement(Screen, { wb: env.mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  assert.ok(screen.getByText('办理规则'), '红线出现态：规则行');
  assert.equal(screen.getByRole('button', { name: '按办理规则暂不能推进' }).disabled, true, '按钮禁用');
  env.setPlanReply({ ok: true, available: true, reason: null, allowedActions: [{ actionId: 'a', commandKind: 'k' }] });
  const before = env.planCalls.length;
  await act(async () => { view.rerender(React.createElement(Screen, { wb: env.mkWb({ snapshotVersion: 2 }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.equal(env.planCalls.length - before, 1, '解除重读恰一次');
  assert.equal(screen.queryByText('办理规则'), null, '红线残留清除');
  const btn = screen.getByRole('button', { name: '提交材料并分析' });
  assert.equal(btn.disabled, false, '按钮恢复常规（不再禁用）');
});

test('GATE-0245 因果D：旧客户/旧版本红线响应晚回不污染当前页', async (t) => {
  t.after(() => cleanup());
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  // D1 旧客户：c1 计划挂起，切 c2（立即可用），c1 红线响应晚到→不写回
  const c1Pending = [];
  const env1 = mkFixedEnv();
  env1.client.advance.plan = (cid, domain) => {
    if (cid === 'c1') return new Promise((resolve) => { c1Pending.push(resolve); });
    return Promise.resolve({ ok: true, customerId: cid, available: true, reason: null, allowedActions: [] });
  };
  const view1 = render(React.createElement(Screen, { wb: env1.mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  await act(async () => { view1.rerender(React.createElement(Screen, { wb: env1.mkWb({ customerId: 'c2' }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.ok(c1Pending.length > 0, 'c1 计划请求在途');
  await act(async () => {
    c1Pending[0]({ ok: true, customerId: 'c1', available: false, reason: REDLINE, allowedActions: [] });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  assert.equal(screen.queryByText('办理规则'), null, '旧客户红线响应晚回不写回当前客户');
  cleanup();
  // D2 旧版本：v1 计划挂起，版本前进 v2（可用已决），v1 红线晚到→不污染
  const pendingByVersion = [];
  const env2 = mkFixedEnv();
  env2.client.advance.plan = () => new Promise((resolve) => { pendingByVersion.push(resolve); });
  const view2 = render(React.createElement(Screen, { wb: env2.mkWb({ snapshotVersion: 1 }), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  assert.ok(pendingByVersion.length === 1, 'v1 挂起');
  await act(async () => { view2.rerender(React.createElement(Screen, { wb: env2.mkWb({ snapshotVersion: 2 }), onBackToDirectory: () => {}, onLogout: () => {} })); });
  await settleTwice();
  assert.equal(pendingByVersion.length, 2, 'v2 重读挂起');
  await act(async () => { pendingByVersion[1]({ ok: true, customerId: 'c1', available: true, reason: null, allowedActions: [] }); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(screen.queryByText('办理规则'), null, '新版本可用=无规则行');
  await act(async () => { pendingByVersion[0]({ ok: true, customerId: 'c1', available: false, reason: REDLINE, allowedActions: [] }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(screen.queryByText('办理规则'), null, '旧版本红线响应晚回不污染当前页');
});

test('GATE-0245 因果E：计划读取失败→无规则行（不冒充阻断），按钮走既有路径', async (t) => {
  t.after(() => cleanup());
  const { TakeoffScreen: Screen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');
  const env = mkFixedEnv();
  env.client.advance.plan = async () => { throw Object.assign(new Error('x'), { status: 503 }); };
  render(React.createElement(Screen, { wb: env.mkWb(), onBackToDirectory: () => {}, onLogout: () => {} }));
  await settleTwice();
  assert.equal(screen.queryByText('办理规则'), null, '读失败=无规则行（不冒充阻断）');
  assert.ok(screen.getByRole('button', { name: '提交材料并分析' }), '按钮保持既有路径');
});
