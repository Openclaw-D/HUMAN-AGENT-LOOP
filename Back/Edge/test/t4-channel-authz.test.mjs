// 任务04 §三·处理通道逐资源授权反例（高优先风险 C-05 反例建立）：
// Connectors 上游只认服务令牌、不重验页面身份（问题5）——Edge 换权点必须在转发前裁决：
//   1) customer-only 会话不可执行内部处理动作（403 ROLE_FORBIDDEN，上游零触达）；
//   2) 目标客户对本会话不可读（改 body customerId / query cid）→ 不转发；
//   3) 仅持他人 taskId → 服务端归属预检后 404（不泄露存在性）；
//   4) 缺目标客户 → 400 失败关闭；
//   5) 归属成立 → 正常转发且浏览器凭据头不透传（服务令牌只在服务端附加）。
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

// 会话可读客户目录：tok-biz 可读 cust-1（业务全量形态的合成裁剪）；tok-cust 仅 cust-1。
const accessible = (credential, customerId) => credential === 'tok-cust' ? customerId === 'cust-1' : credential === 'tok-biz' ? customerId === 'cust-1' : false;

function stubChannel({ taskCustomerId = 'cust-1' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, token: req.headers['x-service-token'] ?? null });
      if (req.url.startsWith('/api/connectors/processing/tasks/')) {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, task: { task_id: 'tk-1', customer_id: taskCustomerId, tenant_id: 't1' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

async function buildEdge({ channelPort, taskCustomerId } = {}) {
  const channel = await stubChannel({ taskCustomerId });
  const sessionStore = createSessionStore({});
  const verifyCredential = async ({ credential }) => (credential === 'tok-biz'
    ? { ok: true, principalId: 'p-biz', roles: ['business'] }
    : credential === 'tok-cust'
      ? { ok: true, principalId: 'p-cust', roles: ['customer'] }
      : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' });
  const store = {
    // live 模拟：A 逐请求裁决（GET /api/v2/customers/:id 的语义等价物）。
    checkCustomer: async (customerId, { credential } = {}) => (accessible(credential, customerId) ? { ok: true } : { ok: false, status: 403, code: 'PERMISSION_DENIED' }),
  };
  const { writeAuthorize, readAuthorize } = createChannelAuthorizers({ store });
  const connectorsProxy = createUpstreamProxy({
    baseUrl: `http://127.0.0.1:${channel.port}`,
    credentialFor: () => 'svc-token-acceptance',
    headerName: 'X-Service-Token',
    routes: CONNECTORS_ACTION_ROUTES,
    authorize: writeAuthorize,
  });
  const connectorsReadProxy = createReadProxy({
    baseUrl: `http://127.0.0.1:${channel.port}`,
    credentialFor: () => 'svc-token-acceptance',
    headerName: 'X-Service-Token',
    routes: CONNECTORS_READ_ROUTES,
    authorize: readAuthorize,
  });
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-t4-authz', capabilities: { channel: 'wired (test)' } },
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

test('反例1：customer-only 会话调内部处理动作（暂停恢复/邀请签发/人工转录）→ 403 且上游零触达', async () => {
  const edge = await buildEdge();
  try {
    const cust = await login(edge.port, 'tok-cust');
    for (const [path, body] of [
      ['/api/jw/v2/actions/connectors/processing/pause', { requestId: 'x1', tenantId: 't1', customerId: 'cust-1', paused: true }],
      ['/api/jw/v2/actions/connectors/intake/invitations', { requestId: 'x2', tenantId: 't1', customerId: 'cust-1', role: 'customer_owner', allowedEvidenceKinds: ['invoice'] }],
      ['/api/jw/v2/actions/connectors/evidence/manual-entry', { requestId: 'x3', tenantId: 't1', customerId: 'cust-1' }],
      ['/api/jw/v2/actions/connectors/questions/verify', { requestId: 'x4', tenantId: 't1', customerId: 'cust-1', questionKey: 'q1' }],
    ]) {
      const r = await fetch(`http://127.0.0.1:${edge.port}${path}`, { method: 'POST', headers: { 'x-jw-session': cust, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(r.status, 403, `${path} 必须拒绝客户身份`);
      assert.equal((await r.json()).error, 'ROLE_FORBIDDEN');
    }
    assert.equal(edge.channel.seen.length, 0, '拒绝发生在 Edge：上游服务令牌面零触达');
  } finally {
    await edge.close();
  }
});

test('反例2：改 body customerId 指向不可读客户 → 不转发（403）；业务身份可读客户 → 正常转发', async () => {
  const edge = await buildEdge();
  try {
    const biz = await login(edge.port, 'tok-biz');
    const denied = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'u1', tenantId: 't1', customerId: 'cust-other', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'PERMISSION_DENIED');

    const okRes = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'u2', tenantId: 't1', customerId: 'cust-1', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(edge.channel.seen.length, 1, '归属成立才转发');
    assert.equal(edge.channel.seen[0].token, 'svc-token-acceptance', '服务令牌由服务端附加');
  } finally {
    await edge.close();
  }
});

test('反例2b：目标客户缺失 → 400 失败关闭；customer 会话上传本人客户 → 转发', async () => {
  const edge = await buildEdge();
  try {
    const cust = await login(edge.port, 'tok-cust');
    const missing = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST', headers: { 'x-jw-session': cust, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'u3', tenantId: 't1', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'CUSTOMER_REQUIRED');

    const own = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/evidence/upload`, {
      method: 'POST', headers: { 'x-jw-session': cust, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'u4', tenantId: 't1', customerId: 'cust-1', invitationId: 'inv-1', kind: 'invoice', contentBase64: 'aGk=' }),
    });
    assert.equal(own.status, 200, '客户身份上传本人客户（邀请范围由上游校验）→ 转发');
  } finally {
    await edge.close();
  }
});

test('反例3：仅持他人 taskId（query 无 cid）→ 服务端归属预检后 404，不泄露任务内容', async () => {
  const edge = await buildEdge({ taskCustomerId: 'cust-other' });
  try {
    const cust = await login(edge.port, 'tok-cust');
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/tasks/tk-1?tid=t1`, { headers: { 'x-jw-session': cust } });
    assert.equal(r.status, 404, '不可读任务统一 404（不泄露存在性）');
    assert.equal((await r.json()).error, 'NOT_FOUND');
  } finally {
    await edge.close();
  }
});

test('反例3b：本人 taskId → 预检通过正常返回；改 query cid 指向不可读客户（status/preview）→ 403', async () => {
  const edge = await buildEdge({ taskCustomerId: 'cust-1' });
  try {
    const cust = await login(edge.port, 'tok-cust');
    const okRes = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/tasks/tk-1?tid=t1`, { headers: { 'x-jw-session': cust } });
    assert.equal(okRes.status, 200);
    assert.equal((await okRes.json()).task.customer_id, 'cust-1');

    const denyStatus = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/status?tid=t1&cid=cust-other`, { headers: { 'x-jw-session': cust } });
    assert.equal(denyStatus.status, 403);
    const denyPreview = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/evidence/preview?tid=t1&eid=ev-1&cid=cust-other`, { headers: { 'x-jw-session': cust } });
    assert.equal(denyPreview.status, 403);

    const noCid = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/evidence/preview?tid=t1&eid=ev-1`, { headers: { 'x-jw-session': cust } });
    assert.equal(noCid.status, 400, '缺 cid 失败关闭');
  } finally {
    await edge.close();
  }
});

test('边界：无会话 401 先于一切；未配置裁决面 → 503 失败关闭（不静默放行）', async () => {
  const edge = await buildEdge();
  try {
    const anon = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/connectors/processing/status?tid=t1&cid=cust-1`);
    assert.equal(anon.status, 401);
    const anonPost = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/actions/connectors/processing/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonPost.status, 401);
  } finally {
    await edge.close();
  }

  const brokenStore = {}; // 无 checkCustomer
  const channel = await stubChannel();
  try {
    const sessionStore = createSessionStore({});
    const { writeAuthorize } = createChannelAuthorizers({ store: brokenStore });
    const connectorsProxy = createUpstreamProxy({ baseUrl: `http://127.0.0.1:${channel.port}`, credentialFor: () => 'svc', headerName: 'X-Service-Token', routes: CONNECTORS_ACTION_ROUTES, authorize: writeAuthorize });
    const started = await startEdgeServer({
      port: 0, seal: { buildId: 't', capabilities: {} }, probes: [], store: brokenStore, auth: async () => ({ ok: true }),
      sessionStore, verifyCredential: async () => ({ ok: true, principalId: 'p', roles: ['business'] }), connectorsProxy, auditSink: createAuditSink(),
    });
    try {
      const r = await fetch(`http://127.0.0.1:${started.port}/api/jw/v2/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'x' }) });
      const sid = (await r.json()).session.sessionId;
      const res = await fetch(`http://127.0.0.1:${started.port}/api/jw/v2/actions/connectors/evidence/upload`, { method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'z', customerId: 'cust-1' }) });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, 'AUTHZ_SOURCE_UNAVAILABLE');
    } finally {
      await started.close();
    }
  } finally {
    await channel.close();
  }
});
