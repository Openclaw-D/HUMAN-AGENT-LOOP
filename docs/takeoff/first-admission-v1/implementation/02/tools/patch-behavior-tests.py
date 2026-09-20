import io
p='preview/test/behavior/takeoff-board.behavior.test.mjs'
s=io.open(p,encoding='utf-8').read()

old='''function makeScreen({ tasks = [], currency = [], candidate = null, openItems = [], followups = [], messages = [], events = [] } = {}) {
  const calls = { action: [], send: [], refresh: 0 };'''
new='''function makeScreen({ tasks = [], currency = [], candidate = null, openItems = [], followups = [], messages = [], events = [], admission = null, assessmentStatus = 'candidate_ready', confirmedAt = null } = {}) {
  const calls = { action: [], send: [], refresh: 0, confirm: [] };'''
assert old in s; s=s.replace(old,new)

old='''    action: async (path, body) => { calls.action.push({ path, body }); return { ok: true }; },
    eventsPage: async () => ({ ok: true, events, nextAfterSeq: '9', hasMore: false }),'''
new='''    action: async (path, body) => { calls.action.push({ path, body }); return { ok: true }; },
    confirmPreassessment: async (id, body) => { calls.confirm.push({ id, body }); return { ok: true, confirmationId: 'pac_test_1', scope: 'preassessment_only', outcome: body.outcome, status: 'preassessment_confirmed', assessmentVersion: body.assessmentVersion + 1 }; },
    eventsPage: async () => ({ ok: true, events, nextAfterSeq: '9', hasMore: false }),'''
assert old in s; s=s.replace(old,new)

old='''      assessments: candidate ? [{ assessmentId: 'asm_1', status: 'candidate_ready', stale: false, ruleVersion: 'sim-pack@7', candidate }] : [],'''
new='''      assessments: candidate ? [{
        assessmentId: 'asm_1', status: assessmentStatus, stale: false, ruleVersion: 'sim-pack@7',
        version: 7, candidateRevision: 2, inputVersion: 3, requestedAmountMinor: 80_000_000_00,
        ...(confirmedAt ? { preassessment: { confirmationId: 'pac_r1', outcome: 'support', scope: 'preassessment_only', conditions: [], rationale: 'r', confirmedBy: 'cred1', confirmedAt, needsReview: true, reviewReason: 'snapshot superseded' } } : {}),
        candidate,
      }] : [],'''
assert old in s; s=s.replace(old,new)

old='''      session: { runStatus: 'in_progress', openQuestions: 0, followups, coverage: { total: 3, required: 2, verified: 1, open: 1 } },
      refsExhaustive: true,
    },'''
new='''      session: { runStatus: 'in_progress', openQuestions: 0, followups, coverage: { total: 3, required: 2, verified: 1, open: 1 } },
      admission,
      refsExhaustive: true,
    },'''
assert old in s; s=s.replace(old,new)

i=s.index("test('结束对话框：三类正面/负面确认待01禁用；行政撤回走既有 decide（withdraw）二次确认', async (t) => {")
j=s.index("test('助手工具栏上传入口打开材料面板（客户联系人门户分支保留在屏内）', async (t) => {")

T = u"""test('结束对话框：状态门如实——candidate_ready 下正/附条件禁用（须先提交复核）；撤回可用', async (t) => {
  t.after(() => cleanup());
  const { wb } = makeScreen({ currency: CURRENCY_PARTIAL, candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY' }, assessmentStatus: 'candidate_ready' });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  const dlg = await screen.findByRole('dialog', { name: /结束本次预评估/ });
  assert.match(dlg.textContent, /确认≠正式授信批准≠额度激活≠可提款/);
  const all = screen.getAllByRole('button', { name: '发起确认' });
  assert.equal(all.length, 3);
  assert.equal(all[0].disabled, true, '支持：须先提交人工审阅');
  assert.match(all[0].title, /人工审阅/);
  assert.equal(all[1].disabled, true, '附条件：同状态门');
  assert.equal(all[2].disabled, false, '不支持：candidate_ready 可记录负面结论');
  assert.match(dlg.textContent, /scope=preassessment_only/);
  assert.equal(screen.getByRole('button', { name: '撤回本轮' }).disabled, false);
  cleanup();
});

test('结束对话框：awaiting_human_review 下三类可发起；not_support 提交绑定版本走 confirm-preassessment', async (t) => {
  t.after(() => cleanup());
  const { wb, calls } = makeScreen({ currency: CURRENCY_PARTIAL, candidate: { tendency: 'do_not', supportableAmountMinor: null, currency: 'CNY' }, assessmentStatus: 'awaiting_human_review' });
  render(React.createElement(TakeoffScreen, { wb, onBackToDirectory: () => {}, onLogout: () => {} }));
  fireEvent.click(screen.getByRole('button', { name: '结束' }));
  await screen.findByRole('dialog', { name: /结束本次预评估/ });
  const all = screen.getAllByRole('button', { name: '发起确认' });
  assert.ok(all.every((b) => !b.disabled), '状态门通过：三类均可发起');
  fireEvent.click(all[2]); // not_support
  fireEvent.change(screen.getByLabelText('确认理由'), { target: { value: '两处事实冲突未解决且有 Gate 依据：记录负面预评估结论' } });
  fireEvent.click(screen.getByRole('button', { name: '进入二次确认' }));
  const confirmDlg = await screen.findByRole('dialog', { name: /预评估结论——不支持/ });
  assert.match(confirmDlg.textContent, /不创建\\/激活\\/预占任何额度/);
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
    currency: CURRENCY_PARTIAL,
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
  assert.ok(await screen.findByRole('dialog', { name: /预评估结论——附条件支持/ }), '缺失条件不阻断打开确认框');
  assert.equal(calls.confirm.length, 0, '但本地拦截：未提交');
  fireEvent.click(screen.getByRole('button', { name: '知道了' }));
  fireEvent.change(screen.getByLabelText('确认条件'), { target: { value: '补齐设备权属登记后生效\\n首期租金按季支付' } });
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
    candidate: { tendency: 'do', supportableAmountMinor: 50_000_000, currency: 'CNY', suggestedTermMonths: 36, referencePriceMinor: 7_800_000, priceUnit: '元/年', priceBasis: '固定租金口径' },
    assessmentStatus: 'awaiting_human_review',
    admission: {
      scope: { assessmentId: 'asm_1', revision: 7 },
      request: { requestedAmount: 80_000_000_00 },
      assessmentState: 'awaiting_human_review',
      inputVersion: 3,
      candidateRevision: 2,
      candidate: { version: 2, suggestedAmount: 50_000_000, suggestedTermMonths: 36, referencePriceMinor: 7_800_000, priceUnit: '元/年', priceBasis: '固定租金口径', tendency: 'do', inputVersion: 3, isCurrent: true },
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
  assert.ok(screen.getByText(/780 万元 \\/ 元\\/年/), '参考价格=数值+单位');
  assert.ok(screen.getByText(/候选 r2 · 输入 v3/), '方案标记带候选修订与输入版本');
  await screen.findByRole('button', { name: /资产，输入，.*运行中/ });
  fireEvent.click(screen.getByRole('button', { name: /资产，输入，/ }));
  const drawer = await screen.findByRole('dialog', { name: /资产 · 输入 格事项/ });
  assert.match(drawer.textContent, /按域可推导到件 3 件/);
  assert.match(drawer.textContent, /处理失败/, 'PROCESSING_FAILED 入卡点');
  cleanup();
});

"""
s=s[:i]+T+s[j:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('behavior tests ok')
