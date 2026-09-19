// 任务04 · 可信调用上下文与新通道路由（本轮 board-round-02 增量）：
//   1) IR-04-2A-3 冻结约定（token→调用方绑定，Connectors 侧已落地）：Edge 令牌是 mayDelegateActor
//      网关，body 自报 actor 会被上游采信——Edge 转发前必须用会话派生 principal 覆写路由的
//      actorField，浏览器伪造值不得经网关流入审计；同时附加 x-jw-actor-principal/roles 服务端头。
//   2) IR-T01-3 receipts 读面实际代理 + 回执归属预检：命中他人客户回执 → 404（不泄露存在性），
//      未命中 → 原样 found:false；回执不能凭 requestId 越权查询。
//   3) customers/link 受控映射登记写面实际代理：internal 角色 + 目标客户可读才转发；
//      customer-only 403 零触达；缺 customerId 400 失败关闭。
// 全部自足：随机端口 stub 上游 + 会话店，无 docker/PG/A。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEdgeServer } from '../src/server.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createUpstreamProxy, CONNECTORS_ACTION_ROUTES } from '../src/proxy.mjs';
import { createReadProxy, CONNECTORS_READ_ROUTES } from '../src/readproxy.mjs';
import { createChannelAuthorizers } from '../src/channel-authz.mjs';
import { createAuditSink } from '../src/audit.mjs';

// 会话可读客户目录：tok-biz / tok-cust 均仅可读 cust-1（cust-2 对两者不可读）。
const accessible = (credential, customerId) => customerId === 'cust-1' && (credential === 'tok-biz' || credential === 'tok-cust');

function stubChannel({ receipts = {} } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { /* 非 JSON 记 null */ }
      seen.push({
        path: req.url,
        method: req.method,
        token: req.headers['x-service-token'] ?? null,
        actorPrincipal: req.headers['x-jw-actor-principal'] ?? null,
        actorRoles: req.headers['x-jw-actor-roles'] ?? null,
        body: parsed,
      });
      const mReceipt = req.url.match(/^\/api\/connectors\/processing\/receipts\/([^?]+)/);
      if (mReceipt) {
        const id = decodeURIComponent(mReceipt[1]);
        const row = receipts[id];
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(row
          ? { ok: true, found: true, requestId: id, receipt: row }
          : { ok: true, found: false, requestId: id }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, echo: parsed }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

async function buildEdge({ receipts } = {}) {
  const channel = await stubChannel({ receipts });
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-biz'
    ? { ok: true, principalId: 'p-biz', roles: ['business'] }
    : credential === 'tok-cust'
      ? { ok: true, principalId: 'p-cust', roles: ['customer'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });
  const store = {
    checkCustomer: async (customerId, { credential } = {}) => (accessible(credential, customerId) ? { ok: true } : { ok: false, status: 403, code: 'PERMISSION_DENIED' }),
  };
  const { writeAuthorize, readAuthorize } = createChannelAuthorizers({ store });
  const connectorsProxy = createUpstreamProxy({
    baseUrl: `http://127.0.0.1:${channel.port}`,
    credentialFor: () => 'svc-token-actor',
    headerName: 'X-Service-Token',
    routes: CONNECTORS_ACTION_ROUTES,
    authorize: writeAuthorize,
  });
  const connectorsReadProxy = createReadProxy({
    baseUrl: `http://127.0.0.1:${channel.port}`,
    credentialFor: () => 'svc-token-actor',
    headerName: 'X-Service-Token',
    routes: CONNECTORS_READ_ROUTES,
    authorize: readAuthorize,
  });
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-t4-actor', capabilities: { channel: 'wired (test)' } },
    probes: [],
    store,
    auth: async () => ({ ok: true }),
    sessionStore,
    verifyCredential,
    connectorsProxy,
    connectorsReadProxy,
    auditSink: createAuditSink(),
  });
  return { ...started, channel, close: async () => { await started.close(); await channel.close(); } };
}

const login = async (port, credential) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
  return (await r.json()).session.sessionId;
};

test('可信上下文：转发头由会话派生（principal/roles），浏览器伪造 actor 头不透传', async () => {
  const edge = await buildEdge();
  try {
    const biz = await login(edge.port, 'tok-biz');
    // 浏览器伪造同名身份头：Edge 上游只应看到会话派生值。
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST',
      headers: {
        'x-jw-session': biz,
        'content-type': 'application/json',
        'x-jw-actor-principal': 'p-attacker',
        'x-jw-actor-roles': 'admin,service',
      },
      body: JSON.stringify({ requestId: 'a1', tenantId: 't1', customerId: 'cust-1', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(r.status, 200);
    assert.equal(edge.channel.seen.length, 1, '归属成立才转发');
    assert.equal(edge.channel.seen[0].actorPrincipal, 'p-biz', 'principal 必须来自服务端会话，非浏览器自报');
    assert.equal(edge.channel.seen[0].actorRoles, 'business', 'roles 必须来自服务端会话');
    assert.equal(edge.channel.seen[0].token, 'svc-token-actor', '服务令牌由服务端附加');

    const cust = await login(edge.port, 'tok-cust');
    const r2 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/questions/answer`, {
      method: 'POST',
      headers: { 'x-jw-session': cust, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'a2', tenantId: 't1', customerId: 'cust-1', questionKey: 'q1', answerText: 'ok' }),
    });
    assert.equal(r2.status, 200);
    assert.equal(edge.channel.seen[1].actorPrincipal, 'p-cust');
    assert.equal(edge.channel.seen[1].actorRoles, 'customer');
  } finally {
    await edge.close();
  }
});

test('actor 归属覆写：body 自报 actor 被会话 principal 覆写（correct-fact/manual-entry/pause），伪造值不流入上游', async () => {
  const edge = await buildEdge();
  try {
    const biz = await login(edge.port, 'tok-biz');
    const call = async (path, body) => {
      const r = await fetch(`http://127.0.0.1:${edge.port}${path}`, {
        method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: `x-${Math.random().toString(36).slice(2, 8)}`, tenantId: 't1', customerId: 'cust-1', ...body }),
      });
      assert.equal(r.status, 200, `${path} 应转发成功`);
      return r;
    };
    await call('/api/jw/v2/actions/connectors/evidence/correct-fact', { correctsFactId: 'f-1', reason: '录入笔误', correctedBy: 'p-attacker' });
    await call('/api/jw/v2/actions/connectors/evidence/manual-entry', { enteredBy: 'p-attacker' });
    await call('/api/jw/v2/actions/connectors/processing/pause', { actor: 'p-attacker', paused: true });

    const cf = edge.channel.seen.find((s) => s.path === '/api/connectors/evidence/correct-fact');
    assert.equal(cf.body.correctedBy, 'p-biz', 'correctedBy 必须被会话 principal 覆写');
    const me = edge.channel.seen.find((s) => s.path === '/api/connectors/evidence/manual-entry');
    assert.equal(me.body.enteredBy, 'p-biz', 'enteredBy 必须被会话 principal 覆写');
    const ps = edge.channel.seen.find((s) => s.path === '/api/connectors/processing/pause');
    assert.equal(ps.body.actor, 'p-biz', 'pause actor 必须被会话 principal 覆写');
    for (const s of [cf, me, ps]) assert.ok(!JSON.stringify(s.body).includes('p-attacker'), '浏览器伪造值不得出现在转发载荷');
  } finally {
    await edge.close();
  }
});

test('customer 会话 actor 覆写：questions/answer 的 answerer 覆写为客户会话 principal', async () => {
  const edge = await buildEdge();
  try {
    const cust = await login(edge.port, 'tok-cust');
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/questions/answer`, {
      method: 'POST', headers: { 'x-jw-session': cust, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'ans-1', tenantId: 't1', customerId: 'cust-1', questionKey: 'q1', answerText: '补传说明', answerer: 'p-impersonator' }),
    });
    assert.equal(r.status, 200);
    const seen = edge.channel.seen.find((s) => s.path === '/api/connectors/questions/answer');
    assert.equal(seen.body.answerer, 'p-cust', '客户联系人回答也以服务端会话归属，不接受自报');
  } finally {
    await edge.close();
  }
});

test('receipts 读面实际代理：本人客户回执 200；他人客户回执 404 不泄露；未命中 found:false；缺 tid 400', async () => {
  const edge = await buildEdge({
    receipts: {
      'r-own': { link_id: 'al-1', tenant_id: 't1', customer_id: 'cust-1', request_id: 'r-own', status: 'registered' },
      'r-other': { link_id: 'al-2', tenant_id: 't1', customer_id: 'cust-2', request_id: 'r-other', status: 'registered' },
    },
  });
  try {
    const cust = await login(edge.port, 'tok-cust');
    const own = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/receipts/r-own?tid=t1`, { headers: { 'x-jw-session': cust } });
    assert.equal(own.status, 200);
    const ownBody = await own.json();
    assert.equal(ownBody.found, true);
    assert.equal(ownBody.receipt.customer_id, 'cust-1');

    const other = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/receipts/r-other?tid=t1`, { headers: { 'x-jw-session': cust } });
    assert.equal(other.status, 404, '他人客户回执必须 404（回执不能凭 requestId 越权查询）');
    assert.equal((await other.json()).error, 'NOT_FOUND');

    const unknown = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/receipts/r-unknown?tid=t1`, { headers: { 'x-jw-session': cust } });
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).found, false, '未命中原样透传 found:false');

    const noTid = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/receipts/r-own`, { headers: { 'x-jw-session': cust } });
    assert.equal(noTid.status, 400);
    assert.equal((await noTid.json()).error, 'TENANT_REQUIRED');
    // 归属预检 = 每次真实取回上游回执行裁决，而非缓存/推断。
    const receiptsHits = edge.channel.seen.filter((s) => s.path.includes('/receipts/'));
    assert.ok(receiptsHits.length >= 3, '预检与转发均为真实上游请求');
  } finally {
    await edge.close();
  }
});

test('customers/link 受控映射写面：customer-only 403 零触达；内部可读客户转发；不可读客户 403；缺 customerId 400', async () => {
  const edge = await buildEdge();
  try {
    const cust = await login(edge.port, 'tok-cust');
    const forbidden = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/customers/link`, {
      method: 'POST', headers: { 'x-jw-session': cust, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'l1', tenantId: 't1', customerId: 'cust-1', aCustomerId: 'a-cust-1' }),
    });
    assert.equal(forbidden.status, 403, '客户身份不可执行受控映射登记');
    assert.equal((await forbidden.json()).error, 'ROLE_FORBIDDEN');

    const biz = await login(edge.port, 'tok-biz');
    const missing = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/customers/link`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'l2', tenantId: 't1', aCustomerId: 'a-cust-1' }),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'CUSTOMER_REQUIRED');

    const unreadable = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/customers/link`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'l3', tenantId: 't1', customerId: 'cust-2', aCustomerId: 'a-cust-2' }),
    });
    assert.equal(unreadable.status, 403);
    assert.equal((await unreadable.json()).error, 'PERMISSION_DENIED');

    const okRes = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/customers/link`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'l4', tenantId: 't1', customerId: 'cust-1', aCustomerId: 'a-cust-1', legalEntityRef: 'USCC-X', requestedBy: 'p-attacker' }),
    });
    assert.equal(okRes.status, 200);
    const forwarded = edge.channel.seen.find((s) => s.path === '/api/connectors/customers/link');
    assert.ok(forwarded, '归属成立才转发');
    assert.equal(forwarded.body.requestedBy, 'p-biz', 'requestedBy 自报不采信，归属以会话覆写为准');
  } finally {
    await edge.close();
  }
});
