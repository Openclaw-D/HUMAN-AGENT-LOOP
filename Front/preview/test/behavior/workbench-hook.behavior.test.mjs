// 任务01 行为测试·useWorkbench hook（用户旅程级）：
// 1) 切客户迟到响应：先开慢客户、再开快客户，慢的 workspace 响应迟到后不覆盖当前客户
//    （epoch 代际守卫——地图未来传入 customerId 复用同一入口的安全底座）。
// 2) 撤权（客户不可读）：workspace 404 → 终态清客户、如实报错，不以本地状态续命。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, act } from './harness.mjs';

const React = (await import('react')).default;
const { renderHook } = await import('@testing-library/react');
const { useWorkbench } = await import('../../../site-mirror/lib/workbench/use-workbench.ts');

const BASE = 'http://edge.test';
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 可编程 fake fetch：按路径分发；workspace 可指定每客户快照与延迟。 */
function installFakeFetch({ workspaceByCustomer, workspaceDelayMs = {}, workspaceStatus = {} }) {
  const original = globalThis.fetch;
  const calls = [];
  const fake = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET' });
    await new Promise((r) => setTimeout(r, 0)); // 保持微任务边界真实
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
      return jsonResponse({ ok: true, customerId: cid, snapshot: workspaceByCustomer[cid] ?? { customer: { displayName: cid } }, snapshotVersion: `v-${cid}`, eventCursor: 'c-1', projection: { notes: [] } });
    }
    if (u.includes('/events')) return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
    return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
  };
  globalThis.fetch = fake;
  return { calls, workspaceStatus, restore: () => { globalThis.fetch = original; } };
}

test('切客户迟到响应：慢客户的迟到 workspace 不覆盖快客户（epoch 守卫）', async (t) => {
  t.after(() => { cleanup(); fake.restore(); });
  const fake = installFakeFetch({
    workspaceByCustomer: { cus_slow: { customer: { displayName: '慢客户' } }, cus_fast: { customer: { displayName: '快客户' } } },
    workspaceDelayMs: { cus_slow: 250 },
  });
  const { result } = renderHook(() => useWorkbench(BASE));

  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  assert.equal(result.current.session?.principalId, 'biz-1');

  await act(async () => {
    const p1 = result.current.openCustomer('cus_slow'); // 慢：响应迟到
    const p2 = result.current.openCustomer('cus_fast'); // 快：立刻替换工作上下文
    assert.deepEqual(await p2, true);
    assert.deepEqual(await p1, false, '迟到方被代际守卫拒绝');
  });
  await new Promise((r) => setTimeout(r, 400)); // 等慢响应真正返回（若守卫失效会在此刻覆盖）

  assert.equal(result.current.customerId, 'cus_fast', '当前客户不被迟到响应改写');
  assert.equal(result.current.snapshot?.customer?.displayName, '快客户');
  assert.equal(result.current.snapshotVersion, 'v-cus_fast');
});

test('撤权（客户不可读）：workspace 404 → 终态清客户并如实报错，不伪装仍在线', async (t) => {
  t.after(() => { cleanup(); fake.restore(); });
  const fake = installFakeFetch({ workspaceByCustomer: { cus_gone: { customer: { displayName: '被撤权客户' } } } });
  const { result } = renderHook(() => useWorkbench(BASE));

  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  await act(async () => { assert.equal(await result.current.openCustomer('cus_gone'), true); });
  assert.equal(result.current.customerId, 'cus_gone');

  // 后台撤权后：workspace 变 404
  fake.workspaceStatus.cus_gone = 404;
  await act(async () => { await result.current.refresh(); });
  assert.equal(result.current.customerId, null, '客户上下文被清（终态）');
  assert.match(String(result.current.error), /已不可读/, '如实报错（可能已撤权或被删除）');
  assert.notEqual(result.current.phase, 'live', '不以本地状态伪装仍在线');
});

test('会话失效后重新选角色：先清旧客户与快照，不把前一身份内容带入新会话', async (t) => {
  const fake = installFakeFetch({ workspaceByCustomer: { old: { customer: { displayName: '旧身份客户' } } } });
  t.after(() => { cleanup(); fake.restore(); });
  const { result } = renderHook(() => useWorkbench(BASE));
  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  await act(async () => { await result.current.openCustomer('old'); });
  fake.workspaceStatus.old = 401;
  await act(async () => { await result.current.refresh(); });
  assert.equal(result.current.session, null);
  assert.equal(result.current.customerId, null);
  assert.equal(result.current.snapshot, null);
  assert.equal(result.current.snapshotVersion, 0);
  await act(async () => { await result.current.loginWithIdentity('biz-1'); });
  assert.ok(result.current.session);
  assert.equal(result.current.customerId, null, '重新进入必须通过新会话的授权目录');
  assert.equal(result.current.snapshot, null);
});
