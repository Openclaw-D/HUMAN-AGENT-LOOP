// BQA-R2 包01 · 独立HTTP适配器与显式代理校验
// createUploadContextReader 为候选读适配器（未装配共享Edge实例）；本文件用真实本地回环HTTP端口验证其拒绝矩阵。
// 授权面为合成替身（A上传权限投影缺失，属单列阻点）；此处只验适配器行为，不伪装整链。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const JW_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const EDGE = (p) => `file:///${join(JW_ROOT, 'Back/Edge', p).replace(/\\/g, '/')}`;
const CONN = (p) => `file:///${join(JW_ROOT, 'Back/Connectors', p).replace(/\\/g, '/')}`;

const { createUploadContextReader } = await import(EDGE('src/upload-context.mjs'));
const { delegatedUploadPrincipal } = await import(CONN('src/intake/upload-context.mjs'));

test('BQA delegation gate: ordinary token, forged actor and missing tenant whitelist all rejected', () => {
  const input = { callerBindings: [{ token: 'delegated', mayDelegateActor: true, tenantIds: ['t-allow'] }],
    serviceToken: 'delegated', tenantId: 't-allow', actorPrincipal: 'human-1' };
  assert.equal(delegatedUploadPrincipal(input), 'human-1');
  const cases = [
    [{ callerBindings: null }, 'ACTOR_NOT_DELEGABLE'],                                  // 无显式代理配置
    [{ serviceToken: 'ordinary-service-token' }, 'ACTOR_NOT_DELEGABLE'],                 // 普通服务token不在代理清单
    [{ tenantId: 't-other' }, 'TENANT_SCOPE_MISMATCH'],                                  // 缺租户白名单
    [{ actorPrincipal: '' }, 'CALLER_NOT_TRUSTED'],                                      // 伪造/空actor
    [{ actorPrincipal: '   ' }, 'CALLER_NOT_TRUSTED'],
    [{ callerBindings: [{ token: 'delegated', mayDelegateActor: false, tenantIds: ['t-allow'] }] }, 'ACTOR_NOT_DELEGABLE'],
    [{ callerBindings: [{ token: 'delegated', mayDelegateActor: true }] }, 'TENANT_SCOPE_MISMATCH'],
  ];
  for (const [patch, key] of cases)
    assert.throws(() => delegatedUploadPrincipal({ ...input, ...patch }), e => e.key === key, JSON.stringify(patch));
});

function makeReaderFixture(t, overrides = {}) {
  const state = { active: true, allowed: true, reads: 0, grants: 0, onRead: null,
    context: { customerId: 'c', available: true, reason: null, bindingRef: 'opaque-b', invitationId: 'opaque-i',
      allowedKinds: ['invoice'], allowedObjects: [], expiresAt: '2030-01-01T00:00:00Z',
      token: 'do-not-expose', providerUserId: 'do-not-expose' } };
  const reader = createUploadContextReader({
    sessionOf: req => req.headers['x-jw-session'] === 'session' && state.active
      ? { sessionId: 'session', principalId: 'human-1', credential: 'server-only' } : null,
    authorizeUpload: async () => { state.grants++;
      return { ok: state.allowed, canRead: true, canUpload: state.allowed, tenantId: 't-trusted', customerId: 'c', principalId: 'human-1' }; },
    fetchContext: async identity => { state.reads++; await state.onRead?.();
      return { customerId: identity.customerId, ...state.context }; },
    ...overrides,
  });
  return { state, reader };
}

async function withServer(t, reader, query = 'cid=c') {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const result = await reader({ req, customerId: url.searchParams.get('cid') });
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); // 系统分配空闲回环端口
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const port = server.address().port;
  return async (headers = { 'x-jw-session': 'session' }) => {
    const res = await fetch(`http://127.0.0.1:${port}/?${query}`, { headers });
    return { status: res.status, ...(await res.json()) };
  };
}

test('BQA HTTP adapter: happy path uses server-side identity; forged actor header and secrets ignored', async t => {
  const { state, reader } = makeReaderFixture(t);
  const get = await withServer(t, reader);
  const result = await get({ 'x-jw-session': 'session', 'x-jw-actor-principal': 'forged-actor' });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.token, undefined);
  assert.equal(result.providerUserId, undefined);
  assert.equal(state.reads, 1);
});

test('BQA HTTP adapter: missing session or upload grant fails closed before any upstream read', async t => {
  const { state, reader } = makeReaderFixture(t);
  const get = await withServer(t, reader);
  assert.equal((await get({})).status, 401);
  assert.equal(state.reads, 0, '无会话不得触达上游');
  state.allowed = false;
  const denied = await get();
  assert.equal(denied.status, 403);
  assert.equal(denied.error, 'UPLOAD_FORBIDDEN');
  assert.equal(state.reads, 0, '授权缺失不得触达上游');
  const noAuthz = createUploadContextReader({ sessionOf: () => ({ sessionId: 's', principalId: 'p', credential: 'c' }) });
  assert.equal((await noAuthz({ req: {}, customerId: 'c' })).status, 503);
});

test('BQA HTTP adapter: upstream context contract violations yield 502 and bad grants yield 403', async t => {
  { // 上游上下文customerId不符 → 502（不伪装为可上传）
    const { reader } = makeReaderFixture(t, { fetchContext: async () => ({ customerId: 'other-customer', available: true }) });
    const get = await withServer(t, reader);
    const result = await get();
    assert.equal(result.status, 502);
    assert.equal(result.error, 'UPLOAD_CONTEXT_INVALID');
  }
  { // 上游available非布尔 → 502
    const { reader } = makeReaderFixture(t, { fetchContext: async () => ({ customerId: 'c', available: 'yes' }) });
    const get = await withServer(t, reader);
    assert.equal((await get()).status, 502);
  }
  { // 两次授权租户漂移 → 403（读前后重验，不给跨租户窗口）
    let flip = false;
    const { reader } = makeReaderFixture(t, { authorizeUpload: async () => {
      flip = !flip;
      return { ok: true, canRead: true, canUpload: true, tenantId: flip ? 't-trusted' : 't-drift', customerId: 'c', principalId: 'human-1' };
    } });
    const get = await withServer(t, reader);
    const result = await get();
    assert.equal(result.status, 403);
    assert.equal(result.error, 'UPLOAD_FORBIDDEN');
  }
  { // 授权的principalId与会话身份不符 → 403
    const { reader } = makeReaderFixture(t, { authorizeUpload: async ({ principalId }) => ({
      ok: true, canRead: true, canUpload: true, tenantId: 't-trusted', customerId: 'c', principalId: 'someone-else' }) });
    const get = await withServer(t, reader);
    const result = await get();
    assert.equal(result.status, 403);
  }
});

test('BQA HTTP adapter: revocation or session loss during read suppresses recovered context', async t => {
  const { state, reader } = makeReaderFixture(t);
  const get = await withServer(t, reader);
  state.onRead = () => { state.allowed = false; }; // 读取期间授权被撤
  const revoked = await get();
  assert.equal(revoked.status, 403);
  assert.equal(revoked.error, 'UPLOAD_FORBIDDEN');
  state.allowed = true;
  state.onRead = () => { state.active = false; }; // 读取期间会话失效
  const stale = await get();
  assert.equal(stale.status, 401);
  assert.equal(stale.error, 'SESSION_REQUIRED');
});

test('BQA HTTP adapter: upstream throw degrades to 503 service unavailable, never a fake no-binding', async t => {
  const { reader } = makeReaderFixture(t, { fetchContext: async () => { throw new Error('db down'); } });
  const get = await withServer(t, reader);
  const result = await get();
  assert.equal(result.status, 503);
  assert.equal(result.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
});
