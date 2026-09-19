// goal-03e 页内消息线程面测试（本路非 e1，DEF-G04N-05 页面侧修复的 Edge 配套）：
//   1) 双向线程：biz→客户 与 客户→biz 互发后双方 GET /customers/:id/messages 均可见（此前 deliver
//      只进一次性 sink——发送有回执、对端永不渲染）；sender 归属如实回传。
//   2) 受众边界（服务端强制）：customer-only 会话默认只见 audience=customer；显式 internal → 403。
//   3) 增量游标：?after=cursor 严格续拉不漏不重；requestId 幂等重放不二次入栈。
//   4) 失败关闭：无会话 401；未配置线程存储 501；非法 audience 400；checkCustomer 拒绝按状态映射。
// 全部自足（随机端口，无 docker/PG/A 实例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';
import { createMessageRouter } from '../src/messages.mjs';
import { createMessageStore } from '../src/message-store.mjs';

async function buildEdge({ withStore = true, storeOverride = null } = {}) {
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-business'
    ? { ok: true, principalId: 'p-business', roles: ['business'] }
    : credential === 'tok-customer'
      ? { ok: true, principalId: 'cit-1', roles: ['customer'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });
  const auditSink = createAuditSink();
  const messageStore = withStore ? createMessageStore({}) : null;
  const deliverLog = [];
  const messages = createMessageRouter({
    deliver: async (msg) => {
      const messageId = `fx-${deliverLog.length + 1}`;
      deliverLog.push({ ...msg, messageId });
      return { messageId, state: 'sent_local_sink' };
    },
    auditSink,
    threadStore: messageStore,
  });
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-g03e', capabilities: { note: 'test' } },
    probes: [],
    store: storeOverride ?? createFixtureStore(),
    auth: async () => ({ ok: true }),
    sessionStore,
    verifyCredential,
    messages,
    messageStore,
    auditSink,
  });
  return { ...started, deliverLog, messageStore };
}

async function session(edgePort, credential) {
  const r = await fetch(`http://127.0.0.1:${edgePort}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  const j = await r.json();
  return j.session.sessionId;
}

const send = (base, sid, body) => fetch(`${base}/api/jw/v2/customers/cust-1/messages`, {
  method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('双向线程：互发后双方读面均可见；sender 归属与受众如实回传', async () => {
  const edge = await buildEdge();
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await session(edge.port, 'tok-business');
    const cust = await session(edge.port, 'tok-customer');
    const s1 = await send(base, biz, { requestId: 'm-1', audience: 'customer', text: '请补传银行流水' });
    assert.equal(s1.status, 200);
    const s2 = await send(base, cust, { requestId: 'm-2', audience: 'customer', text: '今天下午补传' });
    assert.equal(s2.status, 200);

    const asBiz = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': biz } })).json();
    assert.equal(asBiz.ok, true);
    assert.equal(asBiz.messages.length, 2);
    assert.equal(asBiz.messages[0].senderPrincipalId, 'p-business');
    assert.equal(asBiz.messages[1].senderPrincipalId, 'cit-1');
    assert.equal(asBiz.messages[1].text, '今天下午补传');

    // 客户会话读同一线程（无 audience 参数 → 服务端强制 customer 受众）：
    const asCust = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': cust } })).json();
    assert.equal(asCust.audience, 'customer');
    assert.equal(asCust.messages.length, 2, '客户可见对客户受众的全部双向消息');
  } finally {
    await edge.close();
  }
});

test('受众边界（服务端强制）：customer 显式请求 internal → 403；internal 消息不对客户可见', async () => {
  const edge = await buildEdge();
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await session(edge.port, 'tok-business');
    const cust = await session(edge.port, 'tok-customer');
    await send(base, biz, { requestId: 'm-i1', audience: 'internal', text: '内部：此客户负债偏高' });
    await send(base, biz, { requestId: 'm-c1', audience: 'customer', text: '材料齐全后进入复核' });

    const forbidden = await fetch(`${base}/api/jw/v2/customers/cust-1/messages?audience=internal`, { headers: { 'x-jw-session': cust } });
    assert.equal(forbidden.status, 403, '客户身份读内部协作 → 403（不以静默过滤掩盖越权）');

    const asCust = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': cust } })).json();
    assert.equal(asCust.messages.length, 1, '内部消息不进客户视图');
    assert.equal(asCust.messages[0].text, '材料齐全后进入复核');

    const asBiz = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages?audience=internal`, { headers: { 'x-jw-session': biz } })).json();
    assert.equal(asBiz.messages.length, 1);
    assert.equal(asBiz.messages[0].text, '内部：此客户负债偏高');
  } finally {
    await edge.close();
  }
});

test('增量游标与幂等：?after 严格续拉；requestId 重放不二次入栈', async () => {
  const edge = await buildEdge();
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await session(edge.port, 'tok-business');
    await send(base, biz, { requestId: 'm-a', audience: 'customer', text: '第一条' });
    const first = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': biz } })).json();
    assert.equal(first.messages.length, 1);
    const cursor = first.cursor;
    assert.ok(cursor && cursor !== '0');

    await send(base, biz, { requestId: 'm-b', audience: 'customer', text: '第二条' });
    const inc = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages?after=${cursor}`, { headers: { 'x-jw-session': biz } })).json();
    assert.equal(inc.messages.length, 1, '增量只回游标之后的消息');
    assert.equal(inc.messages[0].text, '第二条');
    assert.equal(Number(inc.cursor) > Number(cursor), true, '游标单调前进');

    const replayRes = await send(base, biz, { requestId: 'm-b', audience: 'customer', text: '第二条' });
    assert.equal(replayRes.status, 200);
    assert.equal((await replayRes.json()).replayed, true, '同 ID 同载荷 → 重放回执');
    const all = await (await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': biz } })).json();
    assert.equal(all.messages.length, 2, '幂等重放不在线程二次入栈');
  } finally {
    await edge.close();
  }
});

test('失败关闭：无会话 401；未配置线程存储 501；非法 audience 400；checkCustomer 拒绝按状态映射', async () => {
  const edge = await buildEdge({ withStore: false });
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await session(edge.port, 'tok-business');
    const noStore = await fetch(`${base}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': biz } });
    assert.equal(noStore.status, 501, '线程存储未配置显式 501（不伪造空线程）');

    const noSession = await fetch(`${base}/api/jw/v2/customers/cust-1/messages`);
    assert.equal(noSession.status, 401);

    const edge2 = await buildEdge();
    try {
      const biz2 = await session(edge2.port, 'tok-business');
      const badAud = await fetch(`http://127.0.0.1:${edge2.port}/api/jw/v2/customers/cust-1/messages?audience=everyone`, { headers: { 'x-jw-session': biz2 } });
      assert.equal(badAud.status, 400);
    } finally {
      await edge2.close();
    }
  } finally {
    await edge.close();
  }

  // live 形态纪律：store.checkCustomer 拒绝 → 读面同样拒绝（与发送面同源校验）。
  const refusingStore = { checkCustomer: async () => ({ ok: false, code: 'PERMISSION_DENIED', status: 403 }) };
  const edge3 = await buildEdge({ storeOverride: refusingStore });
  try {
    const biz3 = await session(edge3.port, 'tok-business');
    const denied = await fetch(`http://127.0.0.1:${edge3.port}/api/jw/v2/customers/cust-1/messages`, { headers: { 'x-jw-session': biz3 } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'PERMISSION_DENIED');
  } finally {
    await edge3.close();
  }
});

test('线程存储有界：超出上限裁最旧，base 前进后 seq 仍单调', async () => {
  const store = createMessageStore({ maxPerCustomer: 3 });
  for (let i = 1; i <= 5; i++) {
    store.append({ customerId: 'c', audience: 'customer', text: `t${i}`, requestId: `r${i}`, senderPrincipalId: 'p' });
  }
  const all = store.list('c');
  assert.equal(all.messages.length, 3);
  assert.deepEqual(all.messages.map((m) => m.text), ['t3', 't4', 't5'], '最旧被裁剪');
  assert.equal(all.cursor, '5', 'cursor 含被裁剪前的高位 seq');
  const after = store.list('c', { afterSeq: Number(all.cursor) - 1 });
  assert.equal(after.messages.length, 1);
});
