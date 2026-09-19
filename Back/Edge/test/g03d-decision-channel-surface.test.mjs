// goal-03d 决策链与处理通道面测试（本路非 e1）：
//   1) A 决策链读面：decision-status / domain-exemptions GET 透传（会话凭据映射、未登记 404）
//   2) A 写面：domain-exemptions POST、DELETE grants（IR-03-7 页面化撤权——requestId 纪律、CSRF 生效）
//   3) Connectors 读面（IR-02-C）：processing/status、tasks/:id、evidence/preview → X-Service-Token
//      服务端持有；浏览器请求头不透传；未配置时显式 503 CHANNEL_NOT_CONFIGURED（不伪造通道，也不落入 A 面误报 PROXY_ROUTE_NOT_DECLARED——任务04 问题3）
//   4) Connectors 写面：intake/upload/manual-entry/questions/pause 经 requestId 强制与白名单
// 全部自足（随机端口可控上游，无 docker/PG/A 实例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';
import { createUpstreamProxy, CONNECTORS_ACTION_ROUTES } from '../src/proxy.mjs';
import { createReadProxy, CONNECTORS_READ_ROUTES } from '../src/readproxy.mjs';

// 可控上游：记录 (method,path,identityHeader,body)；按需应答。
function startRecordingUpstream({ handler, identityHeader = 'x-principal-credential' } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rec = {
        method: req.method,
        path: req.url,
        identity: req.headers[identityHeader] || null,
        serviceToken: req.headers['x-service-token'] || null,
        body: body ? JSON.parse(body) : null,
      };
      received.push(rec);
      if (handler) return handler(req, res, rec);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echo: rec.body }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

async function buildEdge({ aPort, connectorsPort = null, connectorsToken = 'svc-token-123', serviceTokenHeader = 'X-Service-Token' } = {}) {
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-business'
    ? { ok: true, principalId: 'p-business', roles: ['business', 'admin'] }
    : credential === 'tok-credit'
      ? { ok: true, principalId: 'p-credit', roles: ['credit'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-g03d', capabilities: { note: 'test' } },
    probes: [],
    store: createFixtureStore(),
    auth: async () => ({ ok: true }),
    sessionStore,
    verifyCredential,
    proxy: createUpstreamProxy({ baseUrl: `http://127.0.0.1:${aPort}`, credentialFor: (s) => s.credential, timeoutMs: 500 }),
    readProxy: createReadProxy({ baseUrl: `http://127.0.0.1:${aPort}`, credentialFor: (s) => s.credential, timeoutMs: 500 }),
    ...(connectorsPort ? {
      connectorsProxy: createUpstreamProxy({
        baseUrl: `http://127.0.0.1:${connectorsPort}`, credentialFor: () => connectorsToken,
        headerName: serviceTokenHeader, routes: CONNECTORS_ACTION_ROUTES, timeoutMs: 500,
      }),
      connectorsReadProxy: createReadProxy({
        baseUrl: `http://127.0.0.1:${connectorsPort}`, credentialFor: () => connectorsToken,
        headerName: serviceTokenHeader, routes: CONNECTORS_READ_ROUTES, timeoutMs: 500,
      }),
    } : {}),
    identityDirectory: {
      list: [{ principalId: 'p-business', roles: ['business', 'admin'], label: '业务', demo: true }],
      byPrincipal: new Map([['p-business', { credential: 'tok-business' }]]),
    },
    auditSink: createAuditSink(),
  });
  return started;
}

async function session(edgePort, credential = 'tok-business') {
  const r = await fetch(`http://127.0.0.1:${edgePort}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  const j = await r.json();
  return j.session.sessionId;
}

test('决策链读面：decision-status / domain-exemptions 透传 A（会话凭据映射；未登记路径 404）', async () => {
  const a = await startRecordingUpstream();
  const edge = await buildEdge({ aPort: a.port });
  try {
    const sid = await session(edge.port);
    const h = { 'x-jw-session': sid };
    const r1 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/decision-status`, { headers: h });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/domain-exemptions`, { headers: h });
    assert.equal(r2.status, 200);
    const r3 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/grants`, { headers: h });
    assert.equal(r3.status, 404, '未登记 GET 路径显式 404（非任意代理）');
    const rec = a.received.filter((x) => x.method === 'GET');
    assert.ok(rec.some((x) => x.path === '/api/v2/customers/cust-1/decision-status' && x.identity === 'tok-business'));
    assert.ok(rec.some((x) => x.path === '/api/v2/customers/cust-1/domain-exemptions' && x.identity === 'tok-business'));
  } finally {
    await edge.close(); await a.close();
  }
});

test('IR-03-7 页面化撤权：DELETE grants 透传（requestId 必带）；缺 requestId 400；跨站 Origin 被 CSRF 拒绝', async () => {
  const a = await startRecordingUpstream();
  const edge = await buildEdge({ aPort: a.port });
  try {
    const sid = await session(edge.port);
    const base = `http://127.0.0.1:${edge.port}`;
    const url = `${base}/api/jw/v2/actions/customers/cust-1/grants/ci-123`;

    const ok = await fetch(url, {
      method: 'DELETE', headers: { 'x-jw-session': sid, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'wb-grv-1', tenantId: 't1' }),
    });
    assert.equal(ok.status, 200);
    const rec = a.received.find((x) => x.method === 'DELETE');
    assert.ok(rec, '上游收到 DELETE');
    assert.equal(rec.path, '/api/v2/customers/cust-1/grants/ci-123');
    assert.equal(rec.identity, 'tok-business');
    assert.equal(rec.body.requestId, 'wb-grv-1');

    const noId = await fetch(url, {
      method: 'DELETE', headers: { 'x-jw-session': sid, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 't1' }),
    });
    assert.equal(noId.status, 400, 'DELETE 同样强制 requestId');

    const csrf = await fetch(url, {
      method: 'DELETE', headers: {
        'x-jw-session': sid, 'content-type': 'application/json',
        origin: 'https://evil.example', 'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ requestId: 'wb-grv-2' }),
    });
    assert.equal(csrf.status, 403);
    assert.equal((await csrf.json()).error, 'CSRF_ORIGIN_REJECTED');
    assert.equal(a.received.filter((x) => x.method === 'DELETE').length, 1, 'CSRF 拒绝不触上游');
  } finally {
    await edge.close(); await a.close();
  }
});

test('豁免登记写面：POST domain-exemptions 透传；Body 带 requestId/tenantId', async () => {
  const a = await startRecordingUpstream();
  const edge = await buildEdge({ aPort: a.port });
  try {
    const sid = await session(edge.port);
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/customers/cust-1/domain-exemptions`, {
      method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'wb-ex-1', tenantId: 't1', domain: 'asset', reason: '演示：无设备融资', scopeDays: 30 }),
    });
    assert.equal(r.status, 200);
    const rec = a.received.find((x) => x.method === 'POST' && x.path === '/api/v2/customers/cust-1/domain-exemptions');
    assert.ok(rec);
    assert.equal(rec.body.domain, 'asset');
    assert.equal(rec.identity, 'tok-business');
  } finally {
    await edge.close(); await a.close();
  }
});

test('IR-03-3 工件单件读回（CONTRACT §11.2）：content 路由透传 A（会话凭据映射；上游 404 原样透传）', async () => {
  const a = await startRecordingUpstream({
    handler: (req, res, rec) => {
      if (rec.path === '/api/v2/customers/cust-1/artifacts/art-9/content') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, artifact: { artifactId: 'art-9', kind: 'invoice', materialFile: { name: 'f.png', mime: 'image/png', size: 4, encoding: 'base64', data: 'aGk=' } } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
    },
  });
  const edge = await buildEdge({ aPort: a.port });
  try {
    const sid = await session(edge.port);
    const h = { 'x-jw-session': sid };
    const r1 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/artifacts/art-9/content`, { headers: h });
    assert.equal(r1.status, 200);
    const j = await r1.json();
    assert.equal(j.artifact.materialFile.encoding, 'base64', '信封 v0 投影原样透传（Edge 不转码）');
    const r2 = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/artifacts/art-404/content`, { headers: h });
    assert.equal(r2.status, 404, 'A 404 原样透传（不包装不掩盖）');
    assert.ok(a.received.some((x) => x.path === '/api/v2/customers/cust-1/artifacts/art-9/content' && x.identity === 'tok-business'));
    const rogue = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/artifacts/art-9/blob`, { headers: h });
    assert.equal(rogue.status, 404, '白名单外读路径显式 404（非任意代理）');
  } finally {
    await edge.close(); await a.close();
  }
});

test('通道原件字节（goal-03e）：签名 URL 归一代理 /connectors/objects/:ref 按字节透传（content-type 保留；会话必需）', async () => {
  const PNG = Buffer.from('89504e470d0a1a0a000000', 'hex');
  const conn = await startRecordingUpstream({
    identityHeader: 'x-service-token',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    },
  });
  const a = await startRecordingUpstream();
  const edge = await buildEdge({ aPort: a.port, connectorsPort: conn.port });
  try {
    const noSession = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/objects/up_1?op=get&tid=t1&cid=c&exp=1&sig=x`);
    assert.equal(noSession.status, 401, '字节面同样会话必需');

    const sid = await session(edge.port);
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/objects/up_1?op=get&tid=t1&cid=c&exp=1&sig=x`, { headers: { 'x-jw-session': sid } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png', 'content-type 原样透传');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(buf.equals(PNG), '字节逐位一致（不经文本解码损坏）');
    const rec = conn.received.find((x) => x.path && x.path.startsWith('/objects/up_1'));
    assert.ok(rec, '上游收到 /objects/:ref（签名与有效期由 Connectors 验证）');
    assert.equal(rec.serviceToken, 'svc-token-123');
  } finally {
    await edge.close(); await conn.close(); await a.close();
  }
});

test('Connectors 读面：status/tasks/preview 以 X-Service-Token 转发（令牌服务端持有）；未配置 → 404 不伪造', async () => {
  const conn = await startRecordingUpstream({ identityHeader: 'x-service-token' });
  const a = await startRecordingUpstream();
  const edgeWith = await buildEdge({ aPort: a.port, connectorsPort: conn.port });
  const edgeWithout = await buildEdge({ aPort: a.port });
  try {
    const sid = await session(edgeWith.port);
    const h = { 'x-jw-session': sid };
    const r1 = await fetch(`http://127.0.0.1:${edgeWith.port}/api/jw/v2/connectors/processing/status?tid=t1&cid=cust-1`, { headers: h });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`http://127.0.0.1:${edgeWith.port}/api/jw/v2/connectors/processing/tasks/task-9`, { headers: h });
    assert.equal(r2.status, 200);
    const r3 = await fetch(`http://127.0.0.1:${edgeWith.port}/api/jw/v2/connectors/evidence/preview?tid=t1&eid=up-1&cid=cust-1`, { headers: h });
    assert.equal(r3.status, 200);
    assert.ok(conn.received.every((x) => x.serviceToken === 'svc-token-123'), '通道上游收到服务令牌');
    assert.ok(conn.received.every((x) => x.path.startsWith('/api/connectors/')), '上游路径为 Connectors 面');

    const rNone = await fetch(`http://127.0.0.1:${edgeWithout.port}/api/jw/v2/connectors/processing/status?tid=t1&cid=cust-1`, { headers: { 'x-jw-session': await session(edgeWithout.port) } });
    assert.equal(rNone.status, 503, '未配置通道：显式 503 CHANNEL_NOT_CONFIGURED（任务04 问题3 修复：不再落入 A 面误报 PROXY_ROUTE_NOT_DECLARED）');
  } finally {
    await edgeWith.close(); await edgeWithout.close(); await conn.close(); await a.close();
  }
});

test('Connectors 写面：intake/invitations、evidence/upload、questions/verify、processing/pause 经 requestId 门与白名单；未登记路径拒绝', async () => {
  const conn = await startRecordingUpstream({ identityHeader: 'x-service-token' });
  const a = await startRecordingUpstream();
  const edge = await buildEdge({ aPort: a.port, connectorsPort: conn.port });
  try {
    const sid = await session(edge.port);
    const base = `http://127.0.0.1:${edge.port}`;
    const post = (path, body) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    const inv = await post('/api/jw/v2/actions/connectors/intake/invitations', { requestId: 'c1', tenantId: 't1', customerId: 'cust-1', role: 'customer_owner', allowedEvidenceKinds: ['bank_statement'], ttlSec: 3600 });
    assert.equal(inv.status, 200);
    const up = await post('/api/jw/v2/actions/connectors/evidence/upload', { requestId: 'c2', tenantId: 't1', customerId: 'cust-1', invitationId: 'inv-1', kind: 'bank_statement', contentBase64: 'aGk=' });
    assert.equal(up.status, 200);
    const vfy = await post('/api/jw/v2/actions/connectors/questions/verify', { requestId: 'c3', tenantId: 't1', customerId: 'cust-1', questionKey: 'q1', verifiedBy: 'p-business', note: '原件可见' });
    assert.equal(vfy.status, 200);
    const noId = await post('/api/jw/v2/actions/connectors/evidence/manual-entry', { tenantId: 't1', customerId: 'cust-1', evidenceId: 'up-1', facts: [{ factKey: 'k', value: 'v' }], enteredBy: 'x', reason: 'y' });
    assert.equal(noId.status, 400, '通道写面同样强制 requestId');
    const rogue = await post('/api/jw/v2/actions/connectors/objects/wipe', { requestId: 'c4' });
    assert.equal(rogue.status, 404, '白名单外路径显式拒绝');

    assert.ok(conn.received.some((x) => x.path === '/api/connectors/intake/invitations' && x.serviceToken === 'svc-token-123'));
    assert.ok(conn.received.some((x) => x.path === '/api/connectors/evidence/upload'));
    assert.ok(conn.received.some((x) => x.path === '/api/connectors/questions/verify'));
    assert.equal(conn.received.filter((x) => x.method === 'POST').length, 3, 'requestId 缺失与白名单外请求不触上游');
  } finally {
    await edge.close(); await conn.close(); await a.close();
  }
});
