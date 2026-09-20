// V0.3-Z4 场景3 独立回归（ZCODE 并行QA·只读产品源码）：
// 1) 切客户迟到响应不得把旧客户的候选/材料带入新客户上下文（epoch 代际守卫，带候选载荷）；
// 2) 退出登录：会话/客户/快照终态清空、最近访问按身份整桶清理（他身份桶保留）、退出后打开客户被拒；
// 3) 撤权（401）：终态清理不留可操作旧状态（client 置空，页面组件不可再操作）；
// 4) 材料清单：切客户后在途旧响应不得写回新客户视图；按屏内 key=sessionId:customerId 换挂载后旧材料不残留；
// 5) 上传绑定：绑定只对本客户挂载生效，换客户换挂载后回到未绑定（不能因旧绑定上传），已有 completed 任务不解锁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import { render, screen, fireEvent, waitFor, cleanup, act } from '../behavior/harness.mjs';

const React = (await import('react')).default;
const { renderHook } = await import('@testing-library/react');
const { useWorkbench } = await import('../../../site-mirror/lib/workbench/use-workbench.ts');
const { rememberCustomer, loadRecent } = await import('../../../site-mirror/lib/workbench/recent-store.ts');
const { MaterialsDesk } = await import('../../../site-mirror/app/takeoff/materials-desk.tsx');
const { OriginalsPanel } = await import('../../../site-mirror/app/workbench/originals-panel.tsx');

const BASE = 'http://edge.test';
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 可编程 fake fetch（网络替身：仅本地内存，严格不访问外网/48214）。 */
function installFakeFetch({ workspaceByCustomer = {}, workspaceDelayMs = {}, workspaceStatus = {} } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const fake = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET' });
    await new Promise((r) => setTimeout(r, 0));
    if (u.endsWith('/api/jw/v2/auth/identities')) return jsonResponse({ ok: false }, 404);
    if (u.endsWith('/versionz')) return jsonResponse({ ok: false }, 404);
    if (u.endsWith('/api/jw/v2/session') && init.method === 'POST') {
      return jsonResponse({ ok: true, session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 } });
    }
    const m = u.match(/\/api\/jw\/v2\/customers\/([^/]+)\/workspace$/);
    if (m) {
      const cid = decodeURIComponent(m[1]);
      const status = workspaceStatus[cid] ?? 200;
      if (status !== 200) return jsonResponse({ ok: false, error: 'NOT_FOUND' }, status);
      const delay = workspaceDelayMs[cid] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return jsonResponse({ ok: true, customerId: cid, snapshot: workspaceByCustomer[cid] ?? { customer: { customerId: cid, displayName: cid } }, snapshotVersion: `v-${cid}`, eventCursor: 'c-1', projection: { notes: [] } });
    }
    if (u.includes('/events')) return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
    return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
  };
  globalThis.fetch = fake;
  return { calls, workspaceStatus, restore: () => { globalThis.fetch = original; } };
}

test('切客户迟到响应：慢客户的候选/材料载荷迟到后不覆盖新客户（不可串用）', async (t) => {
  t.after(() => { cleanup(); fake.restore(); });
  const fake = installFakeFetch({
    workspaceByCustomer: {
      cus_slow: {
        customer: { customerId: 'cus_slow', displayName: '慢客户' },
        admission: { candidate: { version: 9, suggestedAmount: 777_000_000, tendency: 'do' } },
        artifacts: [{ artifactId: 'art_slow', kind: 'material.invoice', current: true }],
      },
      cus_fast: { customer: { customerId: 'cus_fast', displayName: '快客户' } },
    },
    workspaceDelayMs: { cus_slow: 250 },
  });
  const { result } = renderHook(() => useWorkbench(BASE));
  await act(async () => { await result.current.loginWithIdentity('biz-1'); });

  await act(async () => {
    const p1 = result.current.openCustomer('cus_slow');
    const p2 = result.current.openCustomer('cus_fast');
    assert.equal(await p2, true, '快客户先落地');
    assert.equal(await p1, false, '迟到方被代际守卫拒绝');
  });
  await new Promise((r) => setTimeout(r, 400)); // 等慢载荷真正返回（守卫失效则会此刻覆盖）

  assert.equal(result.current.customerId, 'cus_fast');
  assert.equal(result.current.snapshot?.customer?.customerId, 'cus_fast');
  assert.equal(result.current.snapshot?.admission, undefined, '慢客户的候选投影不得出现在快客户上下文');
  assert.equal(result.current.snapshot?.artifacts, undefined, '慢客户的材料不得出现在快客户上下文');
});

test('退出登录：终态清空+最近访问按身份清理（他身份桶保留）+退出后不可操作旧客户', async (t) => {
  t.after(() => { cleanup(); fake.restore(); sessionStorage.clear(); });
  const fake = installFakeFetch({ workspaceByCustomer: { cus_a: { customer: { customerId: 'cus_a', displayName: '客户A' } } } });
  const { result } = renderHook(() => useWorkbench(BASE));
  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  await act(async () => { assert.equal(await result.current.openCustomer('cus_a'), true); });
  assert.ok(result.current.snapshot, '打开后有快照');

  rememberCustomer('biz-1', 'cus_a');
  rememberCustomer('biz-2', 'cus_b');
  assert.deepEqual(loadRecent('biz-1'), ['cus_a']);

  await act(async () => { result.current.logout(); });
  assert.equal(result.current.session, null, '会话清空');
  assert.equal(result.current.customerId, null, '客户上下文清空');
  assert.equal(result.current.snapshot, null, '快照清空');
  assert.equal(result.current.phase, 'off');
  assert.deepEqual(loadRecent('biz-1'), [], '本身份最近访问整桶清理');
  assert.deepEqual(loadRecent('biz-2'), ['cus_b'], '其他身份桶不受影响');

  await act(async () => { assert.equal(await result.current.openCustomer('cus_a'), false, '退出后打开旧客户被拒'); });
  assert.match(String(result.current.error), /请先登录/, '无可操作旧状态，必须重新登录');
});

test('撤权（会话失效401）：终态清理后client置空，页面组件拿不到可操作旧状态', async (t) => {
  t.after(() => { cleanup(); fake.restore(); sessionStorage.clear(); });
  const fake = installFakeFetch({ workspaceByCustomer: { cus_a: { customer: { customerId: 'cus_a', displayName: '客户A' } } } });
  const { result } = renderHook(() => useWorkbench(BASE));
  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  await act(async () => { assert.equal(await result.current.openCustomer('cus_a'), true); });

  fake.workspaceStatus.cus_a = 401;
  await act(async () => { await result.current.refresh(); });
  assert.equal(result.current.session, null, '会话终止');
  assert.equal(result.current.customerId, null);
  assert.equal(result.current.snapshot, null, '旧客户快照不残留');
  assert.equal(result.current.snapshotVersion, 0);
  assert.equal(result.current.client, null, 'client置空：组件无法再发起旧上下文操作');
  assert.equal(result.current.phase, 'off');
  assert.match(String(result.current.error), /重新登录/);
});

// ---- 组件层：材料清单与上传绑定的客户边界 ----

function wbMock(client, customerId) {
  return {
    client, phase: 'live',
    session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    customerId, snapshot: { customer: { customerId, displayName: '客户' } }, snapshotVersion: 1,
    notes: [], error: null, identities: null, buildId: 'test',
    setError: () => {}, refresh: async () => {},
  };
}

const artifact = (id, name, cid) => ({
  artifactId: id, kind: 'material.bank_statement', current: true,
  materialFileMeta: { name }, createdAt: '2026-09-20T01:00:00Z', _cid: cid,
});

function artifactsClient() {
  const calls = { reads: [] };
  const client = {
    session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    async read(path) {
      calls.reads.push(path);
      await new Promise((r) => setTimeout(r, 0));
      if (path.includes('/customers/cus_a/artifacts')) {
        await new Promise((r) => setTimeout(r, 150)); // A 慢：构造迟到写回风险
        return { artifacts: [artifact('art_a1', 'A客户-银行流水', 'cus_a')], factConflicts: [] };
      }
      if (path.includes('/customers/cus_b/artifacts')) {
        return { artifacts: [artifact('art_b1', 'B客户-购销合同', 'cus_b')], factConflicts: [] };
      }
      return { artifacts: [], factConflicts: [] };
    },
  };
  return { client, calls };
}

const anyText = (t) => screen.queryAllByText(t).length > 0;
const noText = (t) => assert.equal(screen.queryAllByText(t).length, 0, `「${t}」不应出现在当前视图`);

test('材料清单：切客户后在途旧响应不得写回新客户视图', async (t) => {
  t.after(cleanup);
  const { client } = artifactsClient();
  const view = render(React.createElement(MaterialsDesk, { wb: wbMock(client, 'cus_a'), customerId: 'cus_a', onUpload: () => {} }));
  // 未等 A 读回立即切到 B（同组件实例，props 换客户）
  view.rerender(React.createElement(MaterialsDesk, { wb: wbMock(client, 'cus_b'), customerId: 'cus_b', onUpload: () => {} }));
  await waitFor(() => assert.ok(anyText('B客户-购销合同'), '新客户材料读回'));
  await new Promise((r) => setTimeout(r, 300)); // A 的迟到响应此刻到达
  noText('A客户-银行流水');
  assert.ok(anyText('B客户-购销合同'), '视图保持新客户');
});

test('材料清单：按屏内 key=sessionId:customerId 换挂载后旧材料不残留', async (t) => {
  t.after(cleanup);
  const { client } = artifactsClient();
  const view = render(React.createElement(MaterialsDesk, { key: 'sess-1:cus_a', wb: wbMock(client, 'cus_a'), customerId: 'cus_a', onUpload: () => {} }));
  await waitFor(() => assert.ok(anyText('A客户-银行流水')));
  view.rerender(React.createElement(MaterialsDesk, { key: 'sess-1:cus_b', wb: wbMock(client, 'cus_b'), customerId: 'cus_b', onUpload: () => {} }));
  await waitFor(() => assert.ok(anyText('B客户-购销合同'), '换挂载后读回新客户材料'));
  noText('A客户-银行流水');
});

// ---- 上传绑定：绑定不跨客户串用；completed 任务不解锁 ----

const doneTasks = (cid) => ({
  tasks: [
    { task_id: `t1-${cid}`, evidence_id: 'e1', kind: 'bank_statement', status: 'done', stage_cursor: 'analyzed', attempts: 1, updated_at: '2026-09-20T02:00:00Z', aRegistered: true, bridgeState: 'registered' },
    { task_id: `t2-${cid}`, evidence_id: 'e2', kind: 'invoice', status: 'done', stage_cursor: 'analyzed', attempts: 1, updated_at: '2026-09-20T03:00:00Z', aRegistered: true, bridgeState: 'registered' },
  ],
  pause: { paused: false },
});

function channelClient() {
  const calls = { channelAction: [] };
  const client = {
    session: { sessionId: 'sess-1', principalId: 'biz-1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    async read(path) {
      if (path.includes('/customers/cus_a/artifacts')) return { artifacts: [artifact('art_a1', 'A客户-银行流水', 'cus_a')], factConflicts: [] };
      if (path.includes('/customers/cus_b/artifacts')) return { artifacts: [], factConflicts: [] };
      return { artifacts: [], factConflicts: [] };
    },
    async channelStatus(cid) { return doneTasks(cid); },
    async channelTask(id) { return { task: { stages: [], aOps: [] } }; },
    async channelAction(path, body) {
      calls.channelAction.push({ path, body });
      if (path === 'intake/accept') return { invitationId: `inv_${body.customerId}` };
      return { ok: true };
    },
  };
  return { client, calls };
}

const uploadBtn = () => screen.getByRole('button', { name: '上传材料（≤512KB）' });
const selectFile = async (name) => {
  const input = screen.getByLabelText('选择上传的材料');
  // jsdom 的 File 无 arrayBuffer()（统一提交链要读字节）；替身用 Node 原生 File
  const file = new NodeFile(['col1\nv1'], name, { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [file] } });
};

test('上传绑定：有completed任务但无绑定=上传锁定；绑定只对本客户生效，换客户换挂载不串用', async (t) => {
  t.after(cleanup);
  const { client, calls } = channelClient();
  const view = render(React.createElement(OriginalsPanel, { key: 'sess-1:cus_a', wb: wbMock(client, 'cus_a'), customerId: 'cus_a' }));

  // 已有 completed（done）任务在列，但无有效绑定：上传按钮必须保持锁定
  await waitFor(() => assert.ok(screen.getByText('已完成工作'), '处理链 done 任务在列'));
  assert.equal(uploadBtn().disabled, true, 'completed任务不能解锁上传');
  assert.ok(screen.getByText('通道未绑定（上传暂不可用）'));
  await selectFile('flow.csv');
  fireEvent.click(uploadBtn()); // disabled 按钮不派发 click：本地硬阻断
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(uploadBtn().disabled, true, '点击后仍锁定');
  assert.equal(calls.channelAction.length, 0, '无绑定时不发出任何上传请求');

  // 建立绑定（cus_a）：上传解锁，真实走一次统一提交链（正对照）
  fireEvent.change(screen.getByLabelText('通道令牌'), { target: { value: 'tok-a' } });
  fireEvent.click(screen.getByRole('button', { name: '接受绑定' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认提交' }));
  await waitFor(() => assert.equal(uploadBtn().disabled, false, 'cus_a 绑定后上传解锁'));
  await selectFile('flow-a.csv');
  fireEvent.click(uploadBtn());
  fireEvent.click(await screen.findByRole('button', { name: '确认提交' }));
  await waitFor(() => assert.ok(calls.channelAction.some((c) => c.path === 'evidence/upload' && c.body.customerId === 'cus_a'), 'cus_a 上传成功'));
  const uploadsAfterA = calls.channelAction.filter((c) => c.path === 'evidence/upload').length;
  assert.equal(uploadsAfterA, 1);

  // 换客户=换挂载（takeoff-screen 的 key=sessionId:customerId 纪律）：回到未绑定，旧绑定不可串用
  view.rerender(React.createElement(OriginalsPanel, { key: 'sess-1:cus_b', wb: wbMock(client, 'cus_b'), customerId: 'cus_b' }));
  await waitFor(() => assert.ok(screen.getByText('已完成工作'), 'cus_b 也有 done 任务'));
  assert.equal(uploadBtn().disabled, true, '旧绑定不得跨客户解锁上传');
  assert.ok(screen.getByText('通道未绑定（上传暂不可用）'));
  await selectFile('flow-b.csv');
  fireEvent.click(uploadBtn()); // disabled：不派发 click，零请求
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.channelAction.filter((c) => c.path === 'evidence/upload').length, uploadsAfterA, 'cus_b 零上传请求');
  assert.ok(calls.channelAction.every((c) => c.body.customerId !== 'cus_b' || c.path !== 'evidence/upload'));
});
