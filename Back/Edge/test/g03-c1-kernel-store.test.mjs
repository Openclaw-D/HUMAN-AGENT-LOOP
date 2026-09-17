// goal-03 C1 单元测试：kernel-store 明细缓存（事件失效 + TTL）、同请求合并、查询计数。
// 以 stub fetch 模拟 A 内核（无网络）；缓存键含授权上下文的行为由既有任务03修复轮测试覆盖，此处不重复。
// JW_EDGE_DETAIL_CACHE_MS=0：关闭 TTL，仅事件失效（本文件确定性验证失效钩子）。
process.env.JW_EDGE_DETAIL_CACHE_MS = '0';
import test from 'node:test';
import assert from 'node:assert/strict';

const CRED = 'tok-test';
const CUST = 'cust-cache-1';

function makeKernelStub() {
  const calls = [];
  let events = [];
  const assessments = new Map();
  const frs = new Map();
  const handler = async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push(path);
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    await Promise.resolve();
    if (path === `/api/v2/customers/${CUST}`) return json({ ok: true, customer: { customerId: CUST, displayName: '缓存测试客户' } });
    if (path === `/api/v2/customers/${CUST}/exposure`) return json({ ok: true, facilities: [], totalsMinor: { exposureNow: 0 } });
    if (path === `/api/v2/customers/${CUST}/decision-status`) return json({ ok: true, basis: null, reviewQueue: [], reportRefs: [] });
    if (path === `/api/v2/customers/${CUST}/findings`) return json({ ok: true, findings: [] });
    if (path === `/api/v2/customers/${CUST}/object-inventory`) return json({ ok: true, objects: [] });
    if (path.startsWith(`/api/v2/customers/${CUST}/events`)) return json({ ok: true, events: events.splice(0, events.length) });
    const mAss = path.match(/^\/api\/v2\/assessments\/([^/]+)$/);
    if (mAss) {
      const a = assessments.get(decodeURIComponent(mAss[1]));
      return a ? json({ ok: true, assessment: a }) : new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), { status: 404 });
    }
    const mFr = path.match(/^\/api\/v2\/financing-requests\/([^/]+)$/);
    if (mFr) {
      const f = frs.get(decodeURIComponent(mFr[1]));
      return f ? json({ ok: true, financingRequest: f }) : new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), { status: 404 });
    }
    return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), { status: 404 });
  };
  let seq = 100n;
  const pushEvent = (eventType, payload) => {
    seq += 1n;
    events.push({ seq: seq.toString(), eventId: `ev-${seq}`, at: new Date().toISOString(), eventType, customerId: CUST, payload });
  };
  return { handler, calls, pushEvent, assessments, frs, seqNow: () => seq };
}

// 可变委托包装：store 创建时捕获的是 delegate（稳定引用），测试通过替换 current 改变上游行为。
function delegating(stub) {
  const delegate = (url, opts) => stub.current(url, opts);
  stub.current = stub.handler;
  return { ...stub, handler: delegate };
}

const detailCounts = (calls) => calls.filter((p) => p.startsWith('/api/v2/assessments/') || p.startsWith('/api/v2/financing-requests/')).length;

test('C1 明细缓存：热读取命中缓存（查询数下降 + freshness.cached 如实标注）', async () => {
  const { createKernelStore } = await import('../src/kernel-store.mjs');
  const stub = makeKernelStub();
  stub.assessments.set('ass-1', { assessmentId: 'ass-1', status: 'awaiting_human_review' });
  stub.frs.set('fr-1', { frId: 'fr-1', status: 'reserved' });
  stub.pushEvent('ASSESSMENT_CREATED', { assessmentId: 'ass-1' });
  stub.pushEvent('FR_CREATED', { frId: 'fr-1' });
  const store = createKernelStore({ baseUrl: 'http://kernel.test', fetchImpl: stub.handler });
  const ctx = { credential: CRED, principalId: 'p1' };
  const w1 = await store.getWorkspace(CUST, ctx);
  assert.equal(w1.snapshot.assessments.length, 1);
  const coldDetails = detailCounts(stub.calls);
  assert.equal(coldDetails, 2);
  const w2 = await store.getWorkspace(CUST, ctx);
  assert.equal(detailCounts(stub.calls), coldDetails); // 无新增明细查询
  assert.equal(w2.projection.freshness['assessment:ass-1'].cached, true);
  assert.equal(w2.projection.freshness['fr:fr-1'].cached, true);
  // 计数器与 stub 一致（events/snapshot/detail 分类总和=total）
  const q = store._qCounters();
  assert.equal(q.total, stub.calls.length);
  assert.equal(q.total, q.snapshot + q.events + q.detail + q.other);
  await store._dropDetailCaches();
  await store.getWorkspace(CUST, ctx);
  assert.equal(detailCounts(stub.calls), coldDetails + 2); // 清缓存后重取
});

test('C1 失效钩子：新事件引用该 id → 下次读取权威重取（不缓存旧值）', async () => {
  const { createKernelStore } = await import('../src/kernel-store.mjs');
  const stub = makeKernelStub();
  stub.assessments.set('ass-1', { assessmentId: 'ass-1', status: 'awaiting_human_review', rev: 1 });
  stub.pushEvent('ASSESSMENT_CREATED', { assessmentId: 'ass-1' });
  const store = createKernelStore({ baseUrl: 'http://kernel.test', fetchImpl: stub.handler });
  const ctx = { credential: CRED, principalId: 'p1' };
  await store.getWorkspace(CUST, ctx);
  const before = detailCounts(stub.calls);
  // 上游对象更新 + 引用它的事件到达（本桶轮询/下次补取可见）
  stub.assessments.set('ass-1', { assessmentId: 'ass-1', status: 'approved', rev: 2 });
  stub.pushEvent('ASSESSMENT_APPROVED', { assessmentId: 'ass-1' });
  const w3 = await store.getWorkspace(CUST, ctx);
  assert.equal(detailCounts(stub.calls), before + 1); // 事件失效 → 重取
  assert.equal(w3.snapshot.assessments[0].rev, 2);
  assert.notEqual(w3.projection.freshness['assessment:ass-1'].cached, true);
  // 无关事件（不含该 id）不触发失效
  const before2 = detailCounts(stub.calls);
  stub.pushEvent('CUSTOMER_NOTE', { note: 'unrelated' });
  await store.getWorkspace(CUST, ctx);
  assert.equal(detailCounts(stub.calls), before2);
});

test('C1 撤权断流（404 语义）：曾可读的桶遇上游 404 → onAuthFail 断流销桶；首次即 404 不误伤', async () => {
  const { createKernelStore } = await import('../src/kernel-store.mjs');
  const stub = makeKernelStub();
  stub.assessments.set('ass-1', { assessmentId: 'ass-1', status: 'awaiting_human_review' });
  stub.pushEvent('ASSESSMENT_CREATED', { assessmentId: 'ass-1' });
  const dstub = delegating(stub); // store 捕获稳定委托；撤权行为经 stub.current 替换注入
  const store = createKernelStore({ baseUrl: 'http://kernel.test', fetchImpl: dstub.handler, pollIntervalMs: 20 });
  const ctx = { credential: CRED, principalId: 'p1' };
  const onAuthFailCodes = [];
  let eventsAfter = 0;
  const unsubscribe = store.subscribe(CUST, () => { eventsAfter += 1; }, { ...ctx, onAuthFail: (code) => onAuthFailCodes.push(code) });
  for (let i = 0; i < 200 && store._stats(CUST).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 60));
  // A 侧撤权（grant 模式越权统一 404，不泄露存在性）：事件端点开始回 404
  const originHandler = stub.handler;
  stub.current = async (url, opts) => {
    if (String(url).includes('/events?')) return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), { status: 404 });
    return originHandler(url, opts);
  };
  for (let i = 0; i < 200 && onAuthFailCodes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(onAuthFailCodes.length, 1);
  assert.equal(onAuthFailCodes[0], 'CUSTOMER_ACCESS_REVOKED');
  assert.equal(store._stats(CUST).length, 0); // 桶已销毁
  unsubscribe();
  // 全新客户（从未读过）首次轮询 404：不是撤权信号，不触发 CUSTOMER_ACCESS_REVOKED（保持原错误透传）
  const codes2 = [];
  store.subscribe('cust-never-read', () => { }, { credential: CRED, principalId: 'p1', onAuthFail: (c) => codes2.push(c) });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(codes2, []);
});

test('C1 同请求合并：同 (客户×身份×凭据) 在途 workspace 共享一次上游读取', async () => {
  const { createKernelStore } = await import('../src/kernel-store.mjs');
  const stub = makeKernelStub();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowHandler = async (url, opts) => {
    if (String(url).includes('/exposure')) await gate; // 首个在途请求挂起，制造合并窗口
    return stub.handler(url, opts);
  };
  const store = createKernelStore({ baseUrl: 'http://kernel.test', fetchImpl: slowHandler });
  const ctx = { credential: CRED, principalId: 'p1' };
  const p1 = store.getWorkspace(CUST, ctx);
  const p2 = store.getWorkspace(CUST, ctx);
  const p3 = store.getWorkspace(CUST, ctx);
  const snapCallsMidFlight = stub.calls.filter((p) => p === `/api/v2/customers/${CUST}`).length;
  assert.ok(snapCallsMidFlight <= 1, '合并窗口内客户主体查询不得放大'); // 在途合并生效
  release();
  await Promise.all([p1, p2, p3]);
  // 不同凭据上下文不合并（各自读一次客户主体）
  stub.assessments.clear(); stub.frs.clear();
  await store.getWorkspace(CUST, { credential: 'tok-other', principalId: 'p2' });
  assert.ok(stub.calls.filter((p) => p === `/api/v2/customers/${CUST}`).length >= 2);
});

test('C1 合并不跨失败传播窗口之外：一次失败不缓存，下次读取重新直查', async () => {
  const { createKernelStore } = await import('../src/kernel-store.mjs');
  const stub = makeKernelStub();
  let failExposure = true;
  const flaky = async (url, opts) => {
    if (String(url).includes('/exposure') && failExposure) {
      return new Response(JSON.stringify({ ok: false, error: 'UPSTREAM_ERROR' }), { status: 500 });
    }
    return stub.handler(url, opts);
  };
  const store = createKernelStore({ baseUrl: 'http://kernel.test', fetchImpl: flaky });
  const ctx = { credential: CRED, principalId: 'p1' };
  const bad = await store.getWorkspace(CUST, ctx);
  assert.deepEqual(bad.snapshot.facilities, []); // best-effort 组件失败 → 空列表 + freshness 如实记录
  assert.equal(bad.projection.freshness.exposure.ok, false);
  failExposure = false;
  const good = await store.getWorkspace(CUST, ctx);
  assert.equal(good.projection.freshness.exposure.ok, true); // 失败未被缓存
});
