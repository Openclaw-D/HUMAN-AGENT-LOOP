// V0.3-Z2-REQUEST-QA 候选回归测试（独立运行，不由 Front/package.json 集成；CTRL 决定是否并入）。
// 范围：需求登记（AdmissionRequestPanel）前端行为与权限边界补遗；不碰模型观察。
// 基建复用既有 harness/tsx-loader；替身为本文件自有的 127.0.0.1 随机端口 HTTP 服务，零共享服务/数据库/模型出站。
// 运行（JW 根目录）：node --experimental-strip-types --test docs/v0.3/zcode/request-qa/test/request-boundary.behavior.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { render, screen, fireEvent, cleanup, act } from '../../../../../Front/preview/test/behavior/harness.mjs';
// react 解析基准与既有行为测试一致：以 harness 同目录为起点向上查 Front/node_modules。
const frontRequire = createRequire(new URL('../../../../../Front/preview/test/behavior/harness.mjs', import.meta.url));
const React = frontRequire('react');
const { createWbClient } = await import('../../../../../Front/site-mirror/lib/workbench/wb-client.ts');
const { AdmissionRequestPanel } = await import('../../../../../Front/site-mirror/app/takeoff/admission-request-panel.tsx');

const form = (f) => React.createElement(AdmissionRequestPanel, { wb: f.wb, onOpenProposal() {} });
const readyForm = () => screen.findByText('已读取服务端当前登记；空白字段仍为待补。');
const savedToast = () => screen.findByText('已从服务端读回登记内容。');
const setField = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const clickSave = () => fireEvent.click(screen.getByRole('button', { name: '保存需求登记' }));
const tick = () => new Promise((r) => setTimeout(r, 30));
// 提交链完整收尾（busy 文案消失）后再继续操作：消息文本可能先于 busy 状态清理出现。
// 注意：此处刻意不用 RTL waitFor——本场景下 waitFor 触发同步内存风暴（3 秒耗尽 256MB 堆、
// 待发 fetch 被卡在 undici 队列），sleep 轮询经对照实验稳定（详见 evidence/ 与 REPORT.md）。
const idle = async () => {
  for (let i = 0; i < 250; i++) {
    if (screen.queryByText('正在提交与读回…') === null) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('等待提交链收尾超时：busy 文案 5 秒未消失');
};

async function fixture(t, { roles = ['business'], customerId = 'cust-test', presetRequest = null } = {}) {
  const store = {
    'asm-test': { assessmentId: 'asm-test', customerId, version: 1, status: 'collecting', request: presetRequest ? structuredClone(presetRequest) : null },
    // 客户 B 的评估：客户切换防串入用例使用；内容与客户 A 不同以辨认串扰。
    'asm-b': { assessmentId: 'asm-b', customerId: 'cust-b', version: 1, status: 'collecting',
      request: { productType: 'sale_leaseback', requestedAmountMinor: 250000, currency: 'CNY', requestedTermMonths: 24, purpose: null, equipmentScope: [], note: '客户B已有登记', revision: 1 } },
  };
  const snapshot = () => ({ customer: { customerId, displayName: '合成客户' }, assessments: [structuredClone(store['asm-test'])], admission: { inputVersion: 3, candidate: null } });
  const calls = [];
  const sessions = ['test-session'];
  // saveError: [status, code]；serverAdvanced: 409 返回前服务端已被他人推进（真实版本冲突形态）。
  const config = { saveError: null, serverAdvanced: false, holdSave: null, readError: false, readMismatch: false };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url: req.url, method: req.method, body, session: req.headers['x-jw-session'], authorization: req.headers.authorization });
    const send = (code, payload) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.url.endsWith('/session')) return send(200, { ok: true, session: { sessionId: sessions[0], principalId: 'biz', tenantId: 'tenant-test', roles, expiresAt: Date.now() + 60000 } });
    if (!sessions.includes(req.headers['x-jw-session'])) return send(401, { ok: false, error: 'SESSION_REQUIRED' });
    const saveMatch = req.url.match(/\/assessments\/([^/]+)\/admission-request$/);
    if (saveMatch) {
      const a = store[saveMatch[1]];
      if (!a) return send(404, { ok: false, error: 'NOT_FOUND' });
      if (config.holdSave) await config.holdSave;
      if (config.saveError) {
        if (config.serverAdvanced) {
          a.version++;
          a.request = { productType: 'sale_leaseback', requestedAmountMinor: 990000, currency: 'CNY', requestedTermMonths: 60, purpose: '服务端已登记', equipmentScope: ['服务器'], note: null, revision: (a.request?.revision ?? 0) + 1 };
        }
        return send(config.saveError[0], { ok: false, error: config.saveError[1] });
      }
      assert.equal(body.assessmentVersion, a.version);
      a.version++; a.request = { ...body.request, revision: (a.request?.revision ?? 0) + 1 };
      return send(200, { ok: true, assessmentId: a.assessmentId, assessmentVersion: a.version, revision: a.request.revision });
    }
    const readMatch = req.url.match(/\/assessments\/([^/]+)$/);
    if (readMatch) {
      const a = store[readMatch[1]];
      if (!a) return send(404, { ok: false, error: 'NOT_FOUND' });
      if (config.readError) return send(503, { ok: false, error: 'READ_FAILED' });
      return send(200, { ok: true, assessment: config.readMismatch ? { ...structuredClone(a), customerId: 'cust-other' } : a });
    }
    if (req.url.endsWith('/workspace')) return send(200, { ok: true, snapshot: snapshot(), snapshotVersion: store['asm-test'].version });
    return send(200, { ok: true, artifacts: [], messages: [], tasks: [] });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { cleanup(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 产品 API 保持同源相对路径；仅测试 fetch 被定向到本测试拥有的 loopback 端口。
  const client = createWbClient({ baseUrl: '', fetchImpl: (url, opts) => { assert.ok(String(url).startsWith('/')); return fetch(origin + url, opts); } });
  await client.exchangeByPrincipal('biz');
  const wb = { client, session: client.session, phase: 'live', customerId, snapshot: snapshot(), snapshotVersion: 1, error: null, setError() {}, async refresh() { wb.snapshot = snapshot(); wb.snapshotVersion = store['asm-test'].version; } };
  return {
    store, wb, config, calls, snapshot,
    saveCalls: () => calls.filter((c) => c.url.endsWith('/admission-request')),
    readCalls: () => calls.filter((c) => /\/assessments\/[^/]+$/.test(c.url)),
    adoptSession: (id) => {
      sessions.push(id);
      client.inner.adoptSession({ sessionId: id, principalId: 'biz', roles, tenantId: 'tenant-test', expiresAt: Date.now() + 60000 });
      wb.session = client.session;
    },
  };
}

test('金额：安全整数恰好最大可发送、超界拒绝不发送、0.00 与前导零', async (t) => {
  const f = await fixture(t); render(form(f)); await readyForm();
  // Number.MAX_SAFE_INTEGER 分 = 90071992547409.91 元：十进制拆分后恰好安全，必须放行。
  setField('申请金额（元）', '90071992547409.91');
  clickSave(); await savedToast(); await idle();
  const c1 = f.saveCalls()[0];
  assert.equal(c1.body.request.requestedAmountMinor, 9007199254740991);
  assert.equal(Number.isSafeInteger(c1.body.request.requestedAmountMinor), true);
  // +0.01 元即越界：拒绝并给出可读消息，不发送。
  for (const value of ['90071992547409.92', '999999999999999.99']) {
    setField('申请金额（元）', value);
    clickSave();
    await screen.findByText(/申请金额须大于零且不超过可精确登记范围/);
    assert.equal(f.saveCalls().length, 1);
  }
  // 0.00 元 = 0 分：非法（须大于零）。
  setField('申请金额（元）', '0.00');
  clickSave(); await screen.findByText(/申请金额须大于零且不超过可精确登记范围/);
  assert.equal(f.saveCalls().length, 1);
  // 前导零属合法十进制表述：00012.5 元 = 1250 分，放行。
  setField('申请金额（元）', '00012.5');
  clickSave(); await savedToast(); await idle();
  assert.equal(f.saveCalls()[1].body.request.requestedAmountMinor, 1250);
  assert.equal(f.saveCalls().length, 2);
});

test('payload：currency 继承既有评估、全空字段发 null/空数组、term 宽松空白合法', async (t) => {
  const preset = { productType: 'sale_leaseback', requestedAmountMinor: null, currency: 'USD', requestedTermMonths: null, purpose: null, equipmentScope: [], note: null, revision: 0 };
  const f = await fixture(t, { presetRequest: preset }); render(form(f)); await readyForm();
  assert.ok(screen.getByText(/首次回租 · USD（空白项为待补）/));
  clickSave(); await savedToast(); await idle();
  const c = f.saveCalls()[0];
  assert.match(c.body.requestId, /^admission-[0-9a-f-]{36}$/);
  assert.equal(c.body.assessmentVersion, 1);
  assert.equal(c.body.tenantId, 'tenant-test');
  assert.equal(c.session, 'test-session');
  assert.equal(c.authorization, undefined);
  assert.deepEqual(c.body.request, { productType: 'sale_leaseback', requestedAmountMinor: null, currency: 'USD', requestedTermMonths: null, purpose: null, equipmentScope: [], note: null });
  // 0.01 元 = 1 分（最小合法金额）；期限两侧空白 trim 后合法。
  setField('申请金额（元）', '0.01');
  setField('申请期限（月）', ' 36 ');
  clickSave(); await savedToast(); await idle();
  const c2 = f.saveCalls()[1];
  assert.equal(c2.body.request.requestedAmountMinor, 1);
  assert.equal(c2.body.request.requestedTermMonths, 36);
  assert.notEqual(c2.body.requestId, c.body.requestId);
  // 期限 '0'、非数字、小数形态均不发送。
  for (const term of ['0', 'abc', '36.0']) {
    setField('申请期限（月）', term);
    clickSave();
    await screen.findByText(/申请期限须为 1–240 的整数月/);
    assert.equal(f.saveCalls().length, 2);
  }
});

test('重复点击：保存等待期间再次点击只发一次请求', async (t) => {
  const f = await fixture(t);
  let release; f.config.holdSave = new Promise((r) => { release = r; });
  render(form(f)); await readyForm();
  setField('申请金额（元）', '500.00');
  clickSave();
  await screen.findByText('正在提交与读回…');
  // 等待期间提交通道必须关闭：fieldset 因 busy 禁用，按钮禁用且文案切换。
  const busyBtn = screen.getByRole('button', { name: '正在提交与读回…' });
  assert.ok(busyBtn.disabled);
  assert.ok(busyBtn.closest('fieldset').disabled);
  // busy 中继续点击不得追加请求。
  fireEvent.click(busyBtn); fireEvent.click(busyBtn);
  await act(async () => { release(); await tick(); });
  await savedToast(); await idle();
  assert.equal(f.saveCalls().length, 1);
  assert.equal(f.readCalls().length, 2); // 初始读回 + 保存后读回
});

test('409 闭环：草稿保留、显式读回取得服务端新版本、再次保存用新版本成功', async (t) => {
  const f = await fixture(t);
  f.config.saveError = [409, 'VERSION_CONFLICT'];
  f.config.serverAdvanced = true;
  render(form(f)); await readyForm();
  setField('申请金额（元）', '100.00');
  setField('补充说明', '我的草稿');
  clickSave(); await idle();
  await screen.findByText(/版本已变化。草稿仍保留/);
  assert.equal(screen.getByLabelText('申请金额（元）').value, '100.00');
  assert.equal(screen.getByLabelText('补充说明').value, '我的草稿');
  assert.ok(screen.getByRole('button', { name: '保存需求登记' }).disabled);
  assert.equal(f.store['asm-test'].version, 2); // 服务端已被他人推进
  // 显式读取最新登记（替换草稿语义）：表单被服务端内容覆盖，按钮恢复可用。
  await idle();
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' }));
  await readyForm();
  assert.equal(screen.getByLabelText('申请金额（元）').value, '9900.00');
  assert.equal(screen.getByLabelText('申请期限（月）').value, '60');
  assert.equal(screen.getByLabelText('资金用途').value, '服务端已登记');
  assert.equal(screen.getByLabelText('补充说明').value, '');
  assert.equal(screen.getByLabelText('设备范围（每行一项）').value, '服务器');
  assert.ok(!screen.getByRole('button', { name: '保存需求登记' }).disabled);
  // 以读回的版本 2 直接再保存：成功，不再 409。
  f.config.saveError = null; f.config.serverAdvanced = false;
  clickSave(); await savedToast(); await idle();
  assert.equal(f.saveCalls().length, 2);
  assert.equal(f.saveCalls()[1].body.assessmentVersion, 2);
  assert.equal(f.saveCalls()[1].body.request.requestedAmountMinor, 990000);
});

test('401 会话失效：消息可读、不冒充成功、恢复后可重试', async (t) => {
  const f = await fixture(t);
  f.config.saveError = [401, 'SESSION_REQUIRED'];
  render(form(f)); await readyForm();
  setField('补充说明', '会话将失效');
  clickSave();
  await screen.findByText(/会话已失效/);
  assert.ok(screen.getByText(/SESSION_REQUIRED/));
  assert.equal(screen.queryByText('已从服务端读回登记内容。'), null);
  assert.equal(f.saveCalls().length, 1);
  // 实测行为记录：401 属明确失败（非未知结果），不得留下“结果未知”锁。
  f.config.saveError = null;
  await idle();
  clickSave(); await savedToast(); await idle();
  assert.equal(f.saveCalls().length, 2);
  assert.equal(f.saveCalls()[1].body.request.note, '会话将失效');
});

test('保存回执成功但读回失败：不报已保存、保留待对账锁、恢复读回后解除', async (t) => {
  const f = await fixture(t);
  f.config.readError = true;
  render(form(f));
  await screen.findByText(/读回未完成/);
  f.config.readError = false;
  await idle();
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' }));
  await readyForm();
  f.config.readError = true;
  setField('补充说明', '已受理待核实');
  clickSave();
  // 保存 200 但读回 503：不得出现“已保存/已读回”成功表述。
  await screen.findByText(/读回未完成/);
  assert.equal(screen.queryByText('已从服务端读回登记内容。'), null);
  // 提交回执已取得、读回未完成：未知锁保留，按钮禁用，请求编号可见待对账。
  assert.ok(screen.getByText(/已取得提交回执，待读回/));
  assert.ok(screen.getByRole('button', { name: '保存需求登记' }).disabled);
  assert.equal(f.saveCalls().length, 1);
  // 读回恢复：显式读取且内容匹配后锁解除。
  f.config.readError = false;
  await idle();
  fireEvent.click(screen.getByRole('button', { name: '读取最新登记（替换草稿）' }));
  await savedToast();
  assert.ok(!screen.getByRole('button', { name: '保存需求登记' }).disabled);
  assert.equal(screen.queryByText(/已取得提交回执，待读回/), null);
});

test('客户切换：等待中的旧保存结果不串入新客户表单', async (t) => {
  const f = await fixture(t);
  let release; f.config.holdSave = new Promise((r) => { release = r; });
  const view = render(form(f)); await readyForm();
  setField('补充说明', '客户A的提交');
  clickSave();
  await screen.findByText('正在提交与读回…');
  // 切到客户 B：key（sessionId:customerId:assessmentId）变化，表单整体重挂载。
  f.wb = { ...f.wb, customerId: 'cust-b', snapshot: { customer: { customerId: 'cust-b', displayName: '客户B' }, assessments: [structuredClone(f.store['asm-b'])], admission: { inputVersion: 3, candidate: null } } };
  view.rerender(form(f));
  await screen.findByText('已读取服务端当前登记；空白字段仍为待补。');
  assert.equal(screen.getByLabelText('补充说明').value, '客户B已有登记');
  assert.equal(screen.getByLabelText('申请金额（元）').value, '2500.00');
  // 释放客户 A 的悬挂响应：不得把 A 的成功结果写进 B 的表单。
  await act(async () => { release(); await tick(); });
  await tick();
  assert.equal(screen.queryByText('已从服务端读回登记内容。'), null);
  assert.equal(screen.getByLabelText('补充说明').value, '客户B已有登记');
  // B 的服务端登记未被 A 的提交触碰。
  assert.equal(f.store['asm-b'].request.note, '客户B已有登记');
  assert.equal(f.store['asm-b'].version, 1);
});

test('读回归属不匹配：他人客户的评估不装入表单且不可提交', async (t) => {
  const f = await fixture(t);
  f.config.readMismatch = true;
  render(form(f));
  await screen.findByText(/读回未完成：评估读回不完整或归属不匹配/);
  assert.equal(screen.getByLabelText('申请金额（元）').value, '');
  assert.ok(screen.getByRole('button', { name: '保存需求登记' }).closest('fieldset').disabled);
  assert.equal(f.saveCalls().length, 0);
});

test('会话切换：同客户换会话后表单重挂载并以新会话重新读回', async (t) => {
  const f = await fixture(t);
  const view = render(form(f)); await readyForm();
  assert.equal(f.readCalls().length, 1);
  f.adoptSession('session-2');
  view.rerender(form(f));
  await screen.findByText('已读取服务端当前登记；空白字段仍为待补。');
  assert.ok(f.readCalls().length >= 2);
  assert.equal(f.readCalls().at(-1).session, 'session-2');
  // 提交走新会话头。
  setField('补充说明', '新会话提交');
  clickSave(); await savedToast();
  assert.equal(f.saveCalls().at(-1).session, 'session-2');
});
