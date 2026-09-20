// 真实 WbClient → 独占随机端口 HTTP 替身；零共享服务/数据库/模型出站。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { render, screen, fireEvent, waitFor, cleanup, act } from './harness.mjs';
const React = (await import('react')).default;
const { createWbClient } = await import('../../../site-mirror/lib/workbench/wb-client.ts');
const { AdmissionRequestPanel } = await import('../../../site-mirror/app/takeoff/admission-request-panel.tsx');
const { AssistantObservationPanel } = await import('../../../site-mirror/app/takeoff/assistant-observation.tsx');
const { TakeoffScreen } = await import('../../../site-mirror/app/takeoff/takeoff-screen.tsx');

async function fixture(t, roles = ['business']) {
  const a = { assessmentId: 'asm-test', customerId: 'cust-test', version: 1, status: 'collecting', request: null };
  const snapshot = () => ({ customer: { customerId: 'cust-test', displayName: '合成客户' }, assessments: [structuredClone(a)], admission: { inputVersion: 3, candidate: null } });
  const calls = [];
  const config = { saveError: null, readError: false, modelHttp: null, modelStatus: 'succeeded', sent: true, replayed: false, modelError: null, hold: null, drop: false, mismatch: false };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url: req.url, method: req.method, body, session: req.headers['x-jw-session'], authorization: req.headers.authorization });
    const send = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.url.endsWith('/session')) return send(200, { ok: true, session: { sessionId: 'test-session', principalId: 'biz', tenantId: 'tenant-test', roles, expiresAt: Date.now() + 60000 } });
    if (req.headers['x-jw-session'] !== 'test-session') return send(401, { ok: false, error: 'SESSION_REQUIRED' });
    if (req.url.endsWith('/admission-request')) {
      if (config.saveError) return send(config.saveError === 'UPSTREAM_UNKNOWN' ? 502 : config.saveError === 'FORBIDDEN' ? 403 : 409, { ok: false, error: config.saveError });
      assert.equal(body.assessmentVersion, a.version);
      a.version++; a.request = { ...body.request, revision: (a.request?.revision ?? 0) + 1 };
      return send(200, { ok: true, assessmentId: a.assessmentId, assessmentVersion: a.version, revision: a.request.revision });
    }
    if (req.url.endsWith('/assessments/asm-test')) return send(config.readError ? 503 : 200, config.readError ? { error: 'READ_FAILED' } : { ok: true, assessment: a });
    if (req.url.endsWith('/assistant/observe')) {
      if (config.hold) await config.hold;
      if (config.drop) return req.socket.destroy();
      if (config.modelHttp) return send(config.modelHttp[0], { ok: false, error: config.modelHttp[1] });
      return send(200, { ok: true, authority: 'none', scope: 'preassessment_only', customerId: config.mismatch ? 'other-customer' : 'cust-test', assistant: body.assistant,
        model: { ...(config.legacy ? {} : { receiptVersion: 2, contextHash: 'a'.repeat(64), configHash: 'b'.repeat(64), current: config.current !== false }), ...(config.proof ?? {}), status: config.modelStatus, sent: config.sent, replayed: config.replayed, requestId: 'model-test', contextVersion: '3', source: { mode: 'mock', model: 'offline-test' }, error: config.modelError ? { code: config.modelError } : null },
        observations: [{ text: '合成观察：金额尚未明确。' }], questions: [{ text: '请核验设备范围。' }], evidenceRefs: config.refs ?? [] });
    }
    if (req.url.endsWith('/workspace')) return send(200, { ok: true, snapshot: snapshot(), snapshotVersion: a.version });
    return send(200, { ok: true, artifacts: [], messages: [], tasks: [] });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { cleanup(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 产品 API 仍为同源相对路径；适配器只把测试请求送到本测试拥有的 loopback 端口。
  const client = createWbClient({ baseUrl: '', fetchImpl: (url, opts) => { assert.ok(String(url).startsWith('/')); return fetch(origin + url, opts); } });
  await client.exchangeByPrincipal('biz');
  const wb = { client, session: client.session, phase: 'live', customerId: 'cust-test', snapshot: snapshot(), snapshotVersion: 1, error: null, setError() {}, async refresh() { wb.snapshot = snapshot(); wb.snapshotVersion = a.version; } };
  return { a, wb, config, calls, snapshot, modelCalls: () => calls.filter((c) => c.url.endsWith('/assistant/observe')), saveCalls: () => calls.filter((c) => c.url.endsWith('/admission-request')) };
}
const form = (f) => React.createElement(AdmissionRequestPanel, { wb: f.wb, onOpenProposal() {} });
const model = (f, assistant = 'credit') => React.createElement(AssistantObservationPanel, { key: `${f.wb.session.sessionId}:${f.wb.customerId}`, wb: f.wb, assistant });
async function readyForm() { await screen.findByText('已读取服务端当前登记；空白字段仍为待补。'); }
function ask(text = '当前有哪些待补项？') { fireEvent.change(screen.getByLabelText('模型观察问题'), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: '获取模型观察' })); }

test('需求：真实 HTTP 保存/读回、金额精度、租户与版本、重开保留、不创建融资', async (t) => {
  const f = await fixture(t); const view = render(form(f)); await readyForm();
  fireEvent.change(screen.getByLabelText('申请金额（元）'), { target: { value: '12345.67' } });
  fireEvent.change(screen.getByLabelText('申请期限（月）'), { target: { value: '36' } });
  fireEvent.change(screen.getByLabelText('设备范围（每行一项）'), { target: { value: '车床\n磨床' } });
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' }));
  await screen.findByText('已从服务端读回登记内容。');
  const c = f.saveCalls()[0]; assert.equal(c.body.request.requestedAmountMinor, 1234567); assert.equal(c.body.assessmentVersion, 1); assert.equal(c.body.tenantId, 'tenant-test');
  assert.equal(c.session, 'test-session'); assert.equal(c.authorization, undefined); assert.equal(f.saveCalls().length, 1);
  assert.ok(!f.calls.some((c) => /financing|facilities|exposure/.test(c.url)));
  view.unmount(); render(form(f)); await readyForm(); assert.equal(screen.getByLabelText('申请金额（元）').value, '12345.67');
});

test('需求：空字段保持 null；零/超精度/非法期限不发送', async (t) => {
  const f = await fixture(t); render(form(f)); await readyForm();
  for (const value of ['0', '-1', '1.001', '9e9']) {
    fireEvent.change(screen.getByLabelText('申请金额（元）'), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: '保存需求登记' }));
    assert.equal(f.saveCalls().length, 0);
  }
  fireEvent.change(screen.getByLabelText('申请金额（元）'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('申请期限（月）'), { target: { value: '241' } });
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' })); assert.equal(f.saveCalls().length, 0);
  fireEvent.change(screen.getByLabelText('申请期限（月）'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' })); await screen.findByText('已从服务端读回登记内容。');
  assert.equal(f.a.request.requestedAmountMinor, null); assert.equal(f.a.request.purpose, null);
});

test('需求：409 保留草稿、必须显式读新版本；403 和终态可见', async (t) => {
  const f = await fixture(t); render(form(f)); await readyForm();
  f.config.saveError = 'VERSION_CONFLICT';
  fireEvent.change(screen.getByLabelText('资金用途'), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' })); await screen.findByText(/版本已变化。草稿仍保留/);
  assert.equal(screen.getByLabelText('资金用途').value, '保留草稿'); assert.ok(screen.getByRole('button', { name: '保存需求登记' }).disabled);
  f.config.saveError = 'FORBIDDEN';
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' })); await readyForm();
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' })); await screen.findByText(/当前身份无权限/);
  f.a.status = 'preassessment_confirmed';
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' })); await screen.findByText(/预评估已确认或已终结/);
  assert.ok(screen.getByRole('button', { name: '保存需求登记' }).closest('fieldset').disabled);
});

test('需求：未知结果关闭重开仍禁重发，服务端读回匹配才解除', async (t) => {
  const f = await fixture(t); f.config.saveError = 'UPSTREAM_UNKNOWN'; const view = render(form(f)); await readyForm();
  fireEvent.click(screen.getByRole('button', { name: '保存需求登记' })); await screen.findByText(/提交结果未知/);
  const body = f.saveCalls()[0].body; view.unmount(); render(form(f)); await screen.findByText(/当前读回与提交内容不同/);
  assert.ok(screen.getByRole('button', { name: '保存需求登记' }).disabled); assert.equal(f.saveCalls().length, 1);
  f.a.request = { ...body.request, revision: 1 }; f.a.version++;
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' })); await screen.findByText('已从服务端读回登记内容。');
});

test('需求：只读角色、不存在评估、读面失败都不冒充登记', async (t) => {
  const f = await fixture(t, ['asset']); const view = render(form(f)); await readyForm();
  assert.ok(screen.getByText(/当前角色只读/)); assert.ok(screen.getByRole('button', { name: '保存需求登记' }).closest('fieldset').disabled);
  f.wb.snapshot = { ...f.wb.snapshot, assessments: [] }; view.rerender(form(f)); assert.ok(screen.getByText(/当前客户尚无预评估/));
  f.wb.snapshot = f.snapshot(); f.config.readError = true; view.rerender(form(f)); await screen.findByText(/读回未完成/); assert.equal(f.saveCalls().length, 0);
});

test('六助手：仅显式触发；真实 HTTP/同源会话；无原件引用；同问不重复发送', async (t) => {
  const f = await fixture(t); f.config.modelStatus = 'simulated'; const view = render(model(f));
  assert.equal(f.modelCalls().length, 0);
  fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' }));
  for (const assistant of ['business', 'policy', 'credit', 'commerce', 'asset', 'jianwei']) {
    view.rerender(model(f, assistant)); ask();
    await waitFor(() => assert.equal(screen.getByRole('button', { name: '获取模型观察' }).disabled, false));
    await screen.findByText('模拟输出（离线替身）');
    assert.equal(f.modelCalls().at(-1).body.assistant, assistant);
  }
  assert.equal(f.modelCalls().length, 6); f.config.replayed = true; ask(); await waitFor(() => assert.equal(f.modelCalls().length, 7)); await screen.findByText('合成观察：金额尚未明确。');
  assert.ok(screen.getByText(/无原件证据引用/)); assert.ok(screen.getByText(/正式结论由有权人员确认/));
  for (const c of f.modelCalls()) { assert.equal(c.session, 'test-session'); assert.equal(c.authorization, undefined); assert.deepEqual(Object.keys(c.body).sort(), ['assistant', 'question']); }
});

test('核验引用可展开对应原文；旧接口或伪造引用不出现证据入口', async (t) => {
  const f = await fixture(t);
  f.config.refs = [{ id: 'ref1', artifactId: 'original-1', hash: 'c'.repeat(64), parserVersion: 'v2', text: '合成原文', locator: { kind: 'page_text', page: 2, start: 0, end: 4 } }];
  const view = render(model(f));
  fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask();
  await screen.findByText('合成观察：金额尚未明确。');
  assert.equal(screen.queryByText(/查看引用片段/), null);
  f.config.proof = { analysisRunId: 'graph-1', citationChecks: [{ valid: true, evidenceRefIds: ['ref1'], reason: 'SOURCE_BOUND' }] };
  ask('核验引用');
  const toggle = await screen.findByText(/查看引用片段/); fireEvent.click(toggle);
  assert.ok(screen.getByText('合成原文')); assert.ok(screen.getByText(/第 2 页/));
  f.wb.snapshot = { ...f.wb.snapshot, artifacts: [{ artifactId: 'replacement' }] }; view.rerender(model(f));
  assert.equal(screen.queryByText(/查看引用片段/), null);
});

test('模型：非流式等待单并发；返回中客户切换不泄漏', async (t) => {
  const f = await fixture(t); let release; f.config.hold = new Promise((r) => { release = r; });
  const view = render(model(f)); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask();
  await screen.findByText(/正在等待完整结果（非流式）/); assert.ok(screen.getByRole('button', { name: '等待模型结果…' }).disabled);
  await waitFor(() => assert.equal(f.modelCalls().length, 1));
  f.wb = { ...f.wb, customerId: 'other', snapshot: { customer: { customerId: 'other' } } }; view.rerender(model(f));
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 40)); });
  assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null); assert.equal(screen.queryByLabelText('模型观察回执'), null);
});

for (const [label, config, expected] of [
  ['预算门', { modelStatus: 'failed', sent: false, modelError: 'BUDGET_EXCEEDED' }, /模型预算门已关闭/],
  ['未配置', { modelHttp: [503, 'MODEL_NOT_CONFIGURED'] }, /模型未配置/],
  ['无权限', { modelHttp: [403, 'FORBIDDEN'] }, /当前身份无权限/],
  ['会话过期', { modelHttp: [401, 'SESSION_REQUIRED'] }, /会话已失效/],
  ['客户不可读', { modelHttp: [404, 'NOT_FOUND'] }, /当前客户或评估不可读/],
  ['上下文读取失败', { modelHttp: [502, 'UPSTREAM_UNKNOWN'] }, /模型未发起/],
]) test(`模型：${label}不冒充观察成功`, async (t) => {
  const f = await fixture(t); Object.assign(f.config, config); render(model(f)); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask();
  await screen.findByText(expected); assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null); assert.equal(f.modelCalls().length, 1);
});

for (const [label, config] of [
  ['服务端超时', { modelStatus: 'unknown', sent: null, modelError: 'RESULT_UNKNOWN_TIMEOUT' }],
  ['网络中断', { drop: true }],
  ['归属不匹配', { mismatch: true }],
]) test(`模型：${label}未知不重发，切助手和重新挂载不能解除`, async (t) => {
  const f = await fixture(t); Object.assign(f.config, config); const view = render(model(f)); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask();
  await screen.findByText(/已停止再次触发/); assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null);
  view.unmount(); render(model(f, 'asset')); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' }));
  assert.ok(screen.getByRole('button', { name: '获取模型观察' }).disabled); assert.equal(f.modelCalls().length, 1);
});

test('模型：需求/候选变化即使 inputVersion 不变也隐藏；未校验重放不展示', async (t) => {
  const f = await fixture(t); const view = render(model(f)); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask(); await screen.findByText('合成观察：金额尚未明确。');
  f.a.request = { purpose: '新需求' }; f.a.version++; f.wb.snapshot = f.snapshot(); view.rerender(model(f));
  assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null); assert.ok(screen.getByText(/旧观察不再展示/));
  f.config.replayed = true; f.config.legacy = true; ask('核对新需求'); await screen.findByText(/收到未核验回执/); assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null);
});

test('模型：等待时证据/候选变化，成功回执也不能作为当前依据', async (t) => {
  const f = await fixture(t); let release; f.config.hold = new Promise((r) => { release = r; });
  render(model(f)); fireEvent.click(screen.getByText('模型辅助观察', { selector: 'summary' })); ask(); await waitFor(() => assert.equal(f.modelCalls().length, 1));
  f.a.version++; f.a.candidate = { tendency: 'cautious_do' }; await act(async () => release());
  await screen.findByText(/本次输出已隐藏/); assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null);
});

test('页面入口：五区四行保留，需求抽屉与观察入口共存', async (t) => {
  const f = await fixture(t); render(React.createElement(TakeoffScreen, { wb: f.wb, onBackToDirectory() {}, onLogout() {} }));
  assert.ok(screen.getByRole('grid', { name: /二十格看板/ })); assert.equal(screen.getAllByRole('tab').length, 6);
  fireEvent.click(screen.getByRole('button', { name: '需求登记' })); await readyForm(); assert.ok(screen.getByRole('dialog', { name: '首次回租需求登记' }));
  assert.equal(f.modelCalls().length, 0);
});

test('模型：服务端已判失效即使页面未变化也不展示', async (t) => {
  const f = await fixture(t); f.config.current = false; render(model(f)); ask();
  await screen.findByText(/服务端确认依据已变化/);
  assert.equal(screen.queryByText('合成观察：金额尚未明确。'), null);
});
