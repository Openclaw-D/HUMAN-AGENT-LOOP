// S3 E0 独立测试：thin Edge 动作代理（任务04 §5）。
//   D13 种子：requestId 必带、不代生成；上游未知 → 502+原ID，同 ID 重试安全；
//   D15 种子：上游再鉴权结果原样透传（Edge 不提权不掩盖）；
//   D17 种子：白名单外路径明确拒绝（无任意 URL 代理）；浏览器伪造凭据头不透传；
//   D09 种子：受众分离守卫 + 可审计副作用（拒绝与确认外发都留审计）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureUpstream, buildEdge } from './helpers.mjs';

const ACTION = (goalId, act) => `/api/jw/v2/actions/goals/${goalId}/${act}`;

async function login(port, credential) {
  const res = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  return { status: res.status, body: await res.json() };
}

test('会话换取：凭据错误失败关闭；成功只返回不透明会话，响应不含凭据原文', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const bad = await login(edge.port, 'wrong-cred');
    assert.equal(bad.status, 403);
    assert.equal(bad.body.error, 'PRINCIPAL_UNTRUSTED');

    const good = await login(edge.port, 'tok-demo');
    assert.equal(good.status, 200);
    assert.match(good.body.session.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(good.body.session.principalId, 'demo-user');
    assert.equal(JSON.stringify(good.body).includes('tok-demo'), false, '凭据原文不得回显');
  } finally {
    await edge.close();
    await up.close();
  }
});

test('动作代理：无会话 401 先于路由表披露；已认证时白名单外路径明确拒绝；转发路径/凭据映射正确', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    // 已登记路径但无会话：401 优先（不向未认证者披露路由表）
    const r2 = await fetch(`${base}${ACTION('g1', 'claim')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'rq-1' }) });
    assert.equal(r2.status, 401);
    assert.equal((await r2.json()).error, 'SESSION_REQUIRED');

    // 已认证 + 未登记路径：明确拒绝代理（不得变成任意 URL 转发）
    const { body: sess } = await login(edge.port, 'tok-demo');
    const r1 = await fetch(`${base}/api/jw/v2/actions/evil/http://attacker.example`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sess.session.sessionId }, body: '{}' });
    assert.equal(r1.status, 404);
    assert.equal((await r1.json()).error, 'PROXY_ROUTE_NOT_DECLARED');

    // 换会话后转发：上游路径=CONTRACT 面板，凭据=服务端映射值
    const r3 = await fetch(`${base}${ACTION('g1', 'claim')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jw-session': sess.session.sessionId },
      body: JSON.stringify({ requestId: 'rq-2', expectedVersion: 3 }),
    });
    assert.equal(r3.status, 200);
    const b3 = await r3.json();
    assert.equal(b3.ok, true);
    assert.equal(up.received.length, 1);
    assert.equal(up.received[0].path, '/api/v1/goals/g1/claim');
    assert.equal(up.received[0].credential, 'cred-for-demo-user');
    assert.equal(up.received[0].body.requestId, 'rq-2');
  } finally {
    await edge.close();
    await up.close();
  }
});

test('requestId 必带且不代生成；浏览器伪造凭据头不透传；响应不泄漏会话 ID', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    const { body: sess } = await login(edge.port, 'tok-demo');
    const H = { 'content-type': 'application/json', 'x-jw-session': sess.session.sessionId };

    const r1 = await fetch(`${base}${ACTION('g1', 'claim')}`, { method: 'POST', headers: H, body: JSON.stringify({ expectedVersion: 1 }) });
    assert.equal(r1.status, 400);
    assert.equal((await r1.json()).error, 'REQUEST_ID_REQUIRED');
    assert.equal(up.received.length, 0, '缺 requestId 的动作不得到达上游');

    // 浏览器伪造上游凭据头——不得透传；Edge 自身也不得把会话 ID 加进响应
    const r2 = await fetch(`${base}${ACTION('g2', 'decide')}`, {
      method: 'POST',
      headers: { ...H, 'x-principal-credential': 'browser-forged-tok' },
      body: JSON.stringify({ requestId: 'rq-3', decision: 'approved', note: 'normal body' }),
    });
    assert.equal(r2.status, 200);
    assert.equal(up.received[0].credential, 'cred-for-demo-user', '上游只应见到服务端映射凭据');
    const text = await r2.text();
    assert.equal(text.includes(sess.session.sessionId), false, '响应不得包含会话 ID');
  } finally {
    await edge.close();
    await up.close();
  }
});

test('上游未知（超时）：502 UPSTREAM_UNKNOWN 回显原 requestId，不自动重试（D13 种子）', async () => {
  const hang = await startFixtureUpstream({ hang: true });
  const edge = await buildEdge({ upstreamPort: hang.port, proxyTimeoutMs: 250 });
  try {
    const { body: sess } = await login(edge.port, 'tok-demo');
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${edge.port}${ACTION('g9', 'complete')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jw-session': sess.session.sessionId },
      body: JSON.stringify({ requestId: 'rq-unknown', fencingToken: 1, result: { provider: 'simulation', output: '{}' } }),
    });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 502);
    const b = await r.json();
    assert.equal(b.error, 'UPSTREAM_UNKNOWN');
    assert.equal(b.requestId, 'rq-unknown', '必须回显原 requestId（同 ID 重试安全，换新 ID 危险）');
    assert.equal(hang.received.length, 1, '代理不得自动重试（上游只见一次请求）');
    assert.ok(elapsed < 5000, '超时快速失败，不挂死调用方');
  } finally {
    await edge.close();
    await hang.close();
  }
});

test('消息受众守卫（D09 种子）：内部内容外发默认 403 并留审计；显式确认放行且审计可查', async () => {
  const up = await startFixtureUpstream();
  const edge = await buildEdge({ upstreamPort: up.port });
  try {
    const base = `http://127.0.0.1:${edge.port}`;
    const { body: sess } = await login(edge.port, 'tok-demo');
    const H = { 'content-type': 'application/json', 'x-jw-session': sess.session.sessionId };

    // 非法受众 / 缺 requestId
    assert.equal((await (await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'a', audience: 'boss', text: 'x' }) })).json()).error, 'INVALID_AUDIENCE');
    assert.equal((await (await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ audience: 'customer', text: 'x' }) })).json()).error, 'REQUEST_ID_REQUIRED');

    // 正常客户消息
    const ok1 = await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'm1', audience: 'customer', text: '请补充发票' }) });
    assert.equal(ok1.status, 200);
    const ok1b = await ok1.json();
    assert.equal(ok1b.delivery.state, 'sent_local_sink');

    // 内部内容 → 客户：默认拒绝
    const refused = await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'm2', audience: 'customer', text: '内部风险意见：…', internalContent: true }) });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'AUDIENCE_MISMATCH');

    // 显式确认外发：放行 + 审计标记确认
    const confirmed = await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'm3', audience: 'customer', text: '内部风险意见：…', internalContent: true, confirmExternalSend: true }) });
    assert.equal(confirmed.status, 200);

    // 内部消息正常发送
    const internal = await fetch(`${base}/api/jw/v2/customers/cust-1001/messages`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'm4', audience: 'internal', text: '内部讨论' }) });
    assert.equal(internal.status, 200);

    // 审计：拒绝、确认外发、普通发送全部留痕
    const audit = await (await fetch(`${base}/api/jw/v2/audit`, { headers: { 'x-jw-session': sess.session.sessionId } })).json();
    const actions = audit.entries.map((e) => e.action);
    assert.ok(actions.includes('message.external_send_refused'), '拒绝必须留审计');
    assert.ok(actions.includes('message.sent.customer'), '发送必须留审计');
    const confirmedEntry = audit.entries.find((e) => e.detail && e.detail.requestId === 'm3');
    assert.equal(confirmedEntry.detail.confirmed, true, '确认外发的审计必须记录 confirmed');
  } finally {
    await edge.close();
    await up.close();
  }
});
