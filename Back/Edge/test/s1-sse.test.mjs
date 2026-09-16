// S2 E0 独立测试：SSE 传输语义（任务04 §4）。
//   D03 种子：快照与订阅之间的写入不漏、不双重推进；
//   D04 种子：重放事件保序、eventId 稳定（客户端按其去重）；
//   D05 种子：游标失效显式 resync，绝不静默续播；
//   D16 种子：无权限不允许回放；未知客户对合法身份 404（不向无权者泄漏存在性）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFixtureStore } from '../src/store.mjs';

const allowAll = async ({ customerId, action }) => ({ ok: true, principalId: 'tester' });
const denyAll = async () => ({ ok: false, reason: 'PRINCIPAL_UNTRUSTED' });

async function withServer({ auth = allowAll, store }, fn) {
  const { startEdgeServer } = await import('../src/server.mjs');
  const started = await startEdgeServer({ port: 0, seal: { buildId: 't', capabilities: {} }, probes: [], store, auth });
  try {
    return await fn(started.port);
  } finally {
    await started.close();
  }
}

// 最小 SSE 客户端：收集帧直到 predicate 满足或超时；非 200 时返回 status+body。
function sseGet(port, pathname, { headers = {}, timeoutMs = 4000, until } = {}) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let buf = '';
    let done = false;
    const req = http.get({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
        return;
      }
      res.setEncoding('utf8');
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { res.destroy(); } catch { }
        resolve({ status: 200, frames });
      };
      const timer = setTimeout(finish, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const frame = {};
          for (const line of raw.split('\n')) {
            const ci = line.indexOf(':');
            if (ci === -1) continue;
            const k = line.slice(0, ci);
            const v = line.slice(ci + 1).replace(/^ /, '');
            if (k === 'data') frame.data = frame.data ? frame.data + '\n' + v : v;
            else if (k === 'id' || k === 'event' || k === 'retry') frame[k] = v;
          }
          if (Object.keys(frame).length) frames.push(frame);
          if (until && until(frames)) return finish();
        }
      });
      res.on('end', finish);
    });
    req.on('error', (e) => { if (frames.length) { done = true; resolve({ status: 200, frames }); } else reject(e); });
  });
}

const business = (frames) => frames.filter((f) => f.event === 'business').map((f) => ({ id: f.id, ...JSON.parse(f.data) }));

test('信封字段完备：eventId/scope/aggregateVersion/schemaVersion/occurredAt/payloadRef', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: '合成客户一' });
  const env = store.appendEvent('c1', { type: 'evidence.submitted', payload: { kind: 'invoice' } });
  assert.match(env.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(env.scope.customer, 'c1');
  assert.equal(env.scope.tenant, 'local');
  assert.equal(env.aggregateVersion, 1);
  assert.equal(env.schemaVersion, 'jw.event.v1');
  assert.ok(!Number.isNaN(Date.parse(env.occurredAt)));
  assert.equal(env.payloadRef.type, 'evidence.submitted');
});

test('快照→事件订阅之间的写入不漏（D03 种子）', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  const ws = store.getWorkspace('c1');
  assert.equal(ws.eventCursor, null, '尚无事件时游标为 null');
  store.appendEvent('c1', { type: 'a', payload: {} });
  const ws2 = store.getWorkspace('c1');
  const e2 = store.appendEvent('c1', { type: 'b', payload: {} });

  await withServer({ store }, async (port) => {
    const r = await sseGet(port, `/api/jw/v2/customers/c1/events?cursor=${ws2.eventCursor}`, {
      until: (fs) => business(fs).some((e) => e.payloadRef.type === 'b'),
    });
    assert.equal(r.status, 200);
    const got = business(r.frames);
    assert.deepEqual(got.map((e) => e.payloadRef.type), ['b'], '只补取游标之后的 1 条，不漏也不重推进');
    assert.equal(got[0].id, e2.eventId, 'SSE id 行=eventId（客户端按其去重/续传）');
  });
});

test('Last-Event-ID 头补取：断线重连不丢事件（D04/D05 种子）', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  const e1 = store.appendEvent('c1', { type: 'a', payload: {} });
  const e2 = store.appendEvent('c1', { type: 'b', payload: {} });

  await withServer({ store }, async (port) => {
    const r = await sseGet(port, `/api/jw/v2/customers/c1/events`, {
      headers: { 'Last-Event-ID': e1.eventId },
      until: (fs) => business(fs).some((e) => e.eventId === e2.eventId),
    });
    const got = business(r.frames);
    assert.deepEqual(got.map((e) => e.eventId), [e2.eventId], 'Last-Event-ID 等价于 cursor 查询参数');
  });
});

test('重放严格晚于游标；同游标重放一致保序；落后游标重连会重复投递同 eventId（至少一次）', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  const e0 = store.appendEvent('c1', { type: 'z', payload: {} });
  const e1 = store.appendEvent('c1', { type: 'a', payload: {} });
  const e2 = store.appendEvent('c1', { type: 'b', payload: {} });

  await withServer({ store }, async (port) => {
    const q = (cursor) => sseGet(port, `/api/jw/v2/customers/c1/events?cursor=${encodeURIComponent(cursor)}`, {
      until: (fs) => business(fs).length >= 2,
    });
    // 同一游标两次重放：结果一致且保序
    const [r1, r2] = await Promise.all([q(e0.eventId), q(e0.eventId)]);
    for (const r of [r1, r2]) {
      assert.deepEqual(business(r.frames).map((e) => e.eventId), [e1.eventId, e2.eventId], '同一游标重放结果一致且保序');
    }
    // 落后客户端：已处理到 e2 却用旧游标 e0 重连 → 服务器再次投递 e2，eventId 不变。
    // 这就是至少一次语义的重复场景：客户端必须按 eventId 去重，服务端只保证不漏。
    const lag = await q(e0.eventId);
    assert.ok(business(lag.frames).some((e) => e.eventId === e2.eventId && e2.eventId === business(r1.frames).at(-1).eventId));
    // 严格晚于：cursor=e1 只补 e2，不重发 e1（正常续传零重复）
    const resume = await sseGet(port, `/api/jw/v2/customers/c1/events?cursor=${encodeURIComponent(e1.eventId)}`, {
      until: (fs) => business(fs).length >= 1,
    });
    assert.deepEqual(business(resume.frames).map((e) => e.eventId), [e2.eventId]);
  });
});

test('游标失效 → 显式 resync 事件并结束流，绝不静默续播（D05 硬判据）', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  store.appendEvent('c1', { type: 'a', payload: {} });
  const e2 = store.appendEvent('c1', { type: 'b', payload: {} });
  store.forgetBefore('c1', 2); // 两条都挤出保留窗口

  await withServer({ store }, async (port) => {
    const r = await sseGet(port, `/api/jw/v2/customers/c1/events?cursor=${encodeURIComponent(e2.eventId)}`, {
      timeoutMs: 3000,
    });
    assert.equal(r.status, 200);
    const resync = r.frames.find((f) => f.event === 'resync');
    assert.ok(resync, '必须发出 resync 事件');
    assert.equal(JSON.parse(resync.data).reason, 'cursor_expired');
    assert.equal(business(r.frames).length, 0, 'resync 后不得再投递业务事件（防止半新半旧）');

    const unknown = await sseGet(port, '/api/jw/v2/customers/c1/events?cursor=does-not-exist', { timeoutMs: 3000 });
    assert.ok(unknown.frames.some((f) => f.event === 'resync'), '完全未知的游标同样 resync（安全默认）');
  });
});

test('无权限订阅：403 且零回放（D16 种子）；合法身份查未知客户：404', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  store.appendEvent('c1', { type: 'a', payload: { secret: 'internal' } });

  await withServer({ store, auth: denyAll }, async (port) => {
    const base = `http://127.0.0.1:${port}`;
    const ev = await fetch(`${base}/api/jw/v2/customers/c1/events`);
    assert.equal(ev.status, 403);
    assert.equal((await ev.json()).error, 'PRINCIPAL_UNTRUSTED');
    const ws = await fetch(`${base}/api/jw/v2/customers/c1/workspace`);
    assert.equal(ws.status, 403, 'workspace 同样失败关闭');
  });

  await withServer({ store, auth: allowAll }, async (port) => {
    const nf = await fetch(`http://127.0.0.1:${port}/api/jw/v2/customers/ghost/workspace`);
    assert.equal(nf.status, 404);
  });
});

test('无游标订阅：先发 cursor 基线，再实时推送（不默认回放历史）', async () => {
  const store = createFixtureStore();
  store.upsertCustomer('c1', { name: 'x' });
  store.appendEvent('c1', { type: 'old', payload: {} });

  await withServer({ store }, async (port) => {
    const pending = sseGet(port, '/api/jw/v2/customers/c1/events', {
      timeoutMs: 4000,
      until: (fs) => business(fs).some((e) => e.payloadRef.type === 'live'),
    });
    await new Promise((r) => setTimeout(r, 300)); // 等订阅建立
    store.appendEvent('c1', { type: 'live', payload: {} });
    const r = await pending;
    const baseline = r.frames.find((f) => f.event === 'cursor');
    assert.ok(baseline, '必须先发 cursor 基线事件');
    assert.ok(JSON.parse(baseline.data).eventCursor, '基线携带可续传游标');
    const got = business(r.frames);
    assert.deepEqual(got.map((e) => e.payloadRef.type), ['live'], '无游标时不回放历史，只收订阅后事件');
  });
});
