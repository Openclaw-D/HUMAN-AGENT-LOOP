// goal-03c 工作本新增面测试（本路非 e1）：
//   1) 受控身份目录：identities 只出元数据不出凭据；{principalId} 受控登录；未配置 404 失败关闭
//   2) 受限原件上传（IR-03-3 临时约定 v0）：载荷转换/上限/编码校验；requestId 语义不变
//   3) 只读透传：白名单 GET 按会话凭据转发；未登记 404；无会话 401
//   4) 客户目录前向兼容：上游无清单端点 → 501 显式缺口(IR-03-1)；上游有 → 原样透传
// 全部自足（随机端口可控上游，无 docker/PG/A 实例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';
import { createUpstreamProxy } from '../src/proxy.mjs';
import { createReadProxy } from '../src/readproxy.mjs';

// 可控上游：记录 (method,path,credential,body)；按需应答。
function startRecordingUpstream({ handler } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rec = {
        method: req.method,
        path: req.url,
        credential: req.headers['x-principal-credential'] || null,
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

// 工作本形态 Edge：live 式接线（会话必需 + 受控身份目录 + 读写代理），上游可控。
async function buildWorkbenchEdge({ upstreamPort, identities = null, verify } = {}) {
  const sessionStore = createSessionStore({});
  const verifyCredential = verify ?? (async ({ credential }) => (credential === 'tok-business'
    ? { ok: true, principalId: 'p-business', roles: ['business', 'admin'] }
    : credential === 'tok-customer'
      ? { ok: true, principalId: 'p-customer', roles: ['customer'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' }));
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-g03c', capabilities: { note: 'test' } },
    probes: [],
    store: createFixtureStore(),
    auth: async () => ({ ok: true }),
    sessionStore,
    verifyCredential,
    proxy: createUpstreamProxy({
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      credentialFor: (s) => s.credential,
      timeoutMs: 500,
    }),
    readProxy: createReadProxy({
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      credentialFor: (s) => s.credential,
      timeoutMs: 500,
    }),
    identityDirectory: identities,
    auditSink: createAuditSink(),
  });
  return started;
}

async function exchangeSession(edgePort, body) {
  const r = await fetch(`http://127.0.0.1:${edgePort}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

const SMALL_PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]).toString('base64');

test('受控身份目录：identities 只出元数据；principalId 受控登录成功；未知 principalId 403', async () => {
  const upstream = await startRecordingUpstream();
  const edge = await buildWorkbenchEdge({
    upstreamPort: upstream.port,
    identities: {
      list: [{ principalId: 'p-business', roles: ['business', 'admin'], label: '业务办理人（演示）', demo: true }],
      byPrincipal: new Map([['p-business', { credential: 'tok-business' }]]),
    },
  });
  try {
    const idRes = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/auth/identities`);
    const idJson = await idRes.json();
    assert.equal(idRes.status, 200);
    assert.equal(idJson.identities.length, 1);
    assert.equal(idJson.identities[0].principalId, 'p-business');
    assert.ok(!('credential' in idJson.identities[0]), '目录响应不得含凭据字段');
    assert.equal(idJson.identities[0].label, '业务办理人（演示）');

    const okLogin = await exchangeSession(edge.port, { principalId: 'p-business' });
    assert.equal(okLogin.status, 200);
    assert.equal(okLogin.json.session.principalId, 'p-business');
    assert.ok(okLogin.json.session.sessionId);

    const badLogin = await exchangeSession(edge.port, { principalId: 'p-unknown' });
    assert.equal(badLogin.status, 403);
    assert.equal(badLogin.json.error, 'PRINCIPAL_UNTRUSTED');

    // 受控登录换得的会话可正常走透传（凭据服务端查得）
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-9/artifacts`, {
      headers: { 'x-jw-session': okLogin.json.session.sessionId },
    });
    assert.equal(r.status, 200);
    assert.equal(upstream.received[0].path, '/api/v2/customers/cust-9/artifacts');
    assert.equal(upstream.received[0].credential, 'tok-business', '透传用服务端查得的凭据');
  } finally {
    await edge.close();
    await upstream.close();
  }
});

test('未配置身份目录：identities 404 失败关闭；principalId 登录拒绝；手输凭据仍可用', async () => {
  const upstream = await startRecordingUpstream();
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const idRes = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/auth/identities`);
    assert.equal(idRes.status, 404);
    assert.equal((await idRes.json()).error, 'IDENTITY_DIRECTORY_NOT_CONFIGURED');

    const pick = await exchangeSession(edge.port, { principalId: 'p-business' });
    assert.equal(pick.status, 403);

    const manual = await exchangeSession(edge.port, { credential: 'tok-business' });
    assert.equal(manual.status, 200);
  } finally {
    await edge.close();
    await upstream.close();
  }
});

test('受限原件上传：转换为 materialFile 信封登记载荷；业务字段并列透传；上游路径映射 artifacts', async () => {
  const upstream = await startRecordingUpstream();
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const { json } = await exchangeSession(edge.port, { credential: 'tok-business' });
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/customers/cust-9/originals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jw-session': json.session.sessionId },
      body: JSON.stringify({
        requestId: 'req-orig-1',
        kind: 'invoice',
        factKey: 'invoice_total',
        materialMeta: { subjectRef: '主体A', period: '2026-07' },
        file: { name: '发票.jpg', mime: 'image/jpeg', dataBase64: SMALL_PNG_B64 },
      }),
    });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.ok, true);
    const rec = upstream.received[0];
    assert.equal(rec.path, '/api/v2/customers/cust-9/artifacts', '转换为既有工件登记端点');
    assert.equal(rec.body.requestId, 'req-orig-1');
    assert.equal(rec.body.kind, 'invoice');
    assert.equal(rec.body.factKey, 'invoice_total');
    assert.deepEqual(rec.body.materialMeta, { subjectRef: '主体A', period: '2026-07' });
    assert.equal(rec.body.content.materialFile.name, '发票.jpg');
    assert.equal(rec.body.content.materialFile.mime, 'image/jpeg');
    assert.equal(rec.body.content.materialFile.encoding, 'base64');
    assert.equal(rec.body.content.materialFile.size, Buffer.from(SMALL_PNG_B64, 'base64').length);
    assert.equal(rec.body.content.materialFile.data, SMALL_PNG_B64);
  } finally {
    await edge.close();
    await upstream.close();
  }
});

test('受限原件上传：缺 file/坏 base64/超上限/缺 requestId 分别 400 且不触上游', async () => {
  const upstream = await startRecordingUpstream();
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const { json } = await exchangeSession(edge.port, { credential: 'tok-business' });
    const post = (body) => fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/customers/cust-9/originals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jw-session': json.session.sessionId },
      body: JSON.stringify(body),
    });
    const cases = [
      [{ requestId: 'r1' }, 'FILE_REQUIRED'],
      [{ requestId: 'r2', file: { name: 'a.bin', dataBase64: 'not+valid!!' } }, 'FILE_ENCODING_INVALID'],
      [{ requestId: 'r3', file: { name: 'big.bin', dataBase64: Buffer.alloc(512 * 1024 + 1, 7).toString('base64') } }, 'FILE_TOO_LARGE'],
      [{ file: { name: 'a.bin', dataBase64: SMALL_PNG_B64 } }, 'REQUEST_ID_REQUIRED'],
    ];
    for (const [body, err] of cases) {
      const r = await post(body);
      const j = await r.json();
      assert.equal(r.status, 400, `${err} 应 400`);
      assert.equal(j.error, err);
    }
    assert.equal(upstream.received.length, 0, '转换失败不得触达上游');
  } finally {
    await edge.close();
    await upstream.close();
  }
});

test('只读透传：白名单命中按会话凭据转发并透传状态；未登记 404；无会话 401', async () => {
  const upstream = await startRecordingUpstream({
    handler: (req, res, rec) => {
      // 仅 artifacts 读口模拟上游拒绝（验证 403 透传）；其余读口正常应答
      if (rec.path.startsWith('/api/v2/customers/') && rec.path.includes('/artifacts')) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'PERMISSION_DENIED' }));
        return;
      }
      if (rec.path.startsWith('/api/v2/reports/rep-1')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reportId: 'rep-1', audience: 'internal' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echo: rec.path }));
    },
  });
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const { json } = await exchangeSession(edge.port, { credential: 'tok-business' });
    const h = { 'x-jw-session': json.session.sessionId };

    const rep = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/reports/rep-1?format=json`, { headers: h });
    assert.equal(rep.status, 200);
    assert.equal((await rep.json()).reportId, 'rep-1');
    assert.ok(upstream.received.some((r) => r.path === '/api/v2/reports/rep-1?format=json'), '查询串原样转发');

    const denied = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-9/artifacts`, { headers: h });
    assert.equal(denied.status, 403, '上游 403 原样透传，Edge 不掩盖');
    assert.equal((await denied.json()).error, 'PERMISSION_DENIED');

    const unknown = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/not-a-route`, { headers: h });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'PROXY_ROUTE_NOT_DECLARED');

    const noSession = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-9/artifacts`);
    assert.equal(noSession.status, 401);

    const summary = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/inspections/insp-1/summary?audience=customer`, { headers: h });
    assert.equal(summary.status, 200);
    assert.ok(upstream.received.some((r) => r.path === '/api/v1/inspections/insp-1/summary?audience=customer'));
  } finally {
    await edge.close();
    await upstream.close();
  }
});

test('客户目录前向兼容：上游无清单端点(404)→501 显式 IR-03-1；上游有(200)→原样透传', async () => {
  const upstream = await startRecordingUpstream({
    handler: (req, res, rec) => {
      if (rec.path.startsWith('/api/v2/customers?') || rec.path === '/api/v2/customers') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, customers: [{ customerId: 'cust-1' }], total: 1 }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
    },
  });
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const { json } = await exchangeSession(edge.port, { credential: 'tok-business' });
    const h = { 'x-jw-session': json.session.sessionId };

    // 上游对 /api/v2/customers 返回 200 → 透传
    const ok = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers?search=%E8%BF%9C%E5%B1%B1`, { headers: h });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).total, 1);

    // 上游对单客户 404 —— 但目录端点只认 /api/v2/customers 本身的响应；这里验证清单 200 分支即可
    assert.ok(upstream.received.some((r) => r.path.startsWith('/api/v2/customers?')));
  } finally {
    await edge.close();
    await upstream.close();
  }

  const upstream404 = await startRecordingUpstream({
    handler: (req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
    },
  });
  const edge2 = await buildWorkbenchEdge({ upstreamPort: upstream404.port });
  try {
    const { json } = await exchangeSession(edge2.port, { credential: 'tok-business' });
    const r = await fetch(`http://127.0.0.1:${edge2.port}/api/jw/v2/customers`, { headers: { 'x-jw-session': json.session.sessionId } });
    assert.equal(r.status, 501);
    const j = await r.json();
    assert.equal(j.error, 'UPSTREAM_DIRECTORY_NOT_AVAILABLE');
    assert.equal(j.interfaceRequest, 'IR-03-1');
  } finally {
    await edge2.close();
    await upstream404.close();
  }
});

test('受限邀请（G2）：创建/撤销经白名单代理；redeem 匿名透传（无会话，凭据不落日志/响应外）', async () => {
  const upstream = await startRecordingUpstream({
    handler: (req, res, rec) => {
      if (rec.path === '/api/v2/invitations/redeem') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, credential: 'cit_xxx', principalId: 'ci_1', customerId: 'cust-9', role: 'customer-owner', allowedKinds: ['invoice'] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echo: rec.body }));
    },
  });
  const edge = await buildWorkbenchEdge({ upstreamPort: upstream.port });
  try {
    const { json } = await exchangeSession(edge.port, { credential: 'tok-business' });
    const h = { 'content-type': 'application/json', 'x-jw-session': json.session.sessionId };

    const create = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/customers/cust-9/invitations`, {
      method: 'POST', headers: h, body: JSON.stringify({ requestId: 'r-inv-1', role: 'customer-owner', allowedKinds: ['invoice'] }),
    });
    assert.equal(create.status, 200);
    assert.equal(upstream.received[0].path, '/api/v2/customers/cust-9/invitations');

    const revoke = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/invitations/inv-1/revoke`, {
      method: 'POST', headers: h, body: JSON.stringify({ requestId: 'r-inv-2' }),
    });
    assert.equal(revoke.status, 200);
    assert.equal(upstream.received[1].path, '/api/v2/invitations/inv-1/revoke');

    // 匿名兑换：无会话可用；CSRF 无头客户端放行；请求体透传
    const redeem = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/invitations/redeem`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'JWINVITE-1234' }),
    });
    const rj = await redeem.json();
    assert.equal(redeem.status, 200);
    assert.equal(rj.principalId, 'ci_1');
    assert.equal(upstream.received[2].path, '/api/v2/invitations/redeem');

    // 坏 code：Edge 先行拒绝，不触上游
    const bad = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/invitations/redeem`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'short' }),
    });
    assert.equal(bad.status, 400);
    assert.equal(upstream.received.length, 3);
  } finally {
    await edge.close();
    await upstream.close();
  }
});
