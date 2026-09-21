// V0.4 R2-02 边界套件：A 适配层状态映射 / 工厂配置校验 / 歧义分支（无 PG、无内核进程）。
// 契约：docs/v0.4/results/r2-02-upload/CONTRACT.md。
// 替身边界（全部单列，如实标注；主套件 v04-upload-assembly 承担真实链）：
//   · fetchImpl 替身：模拟 A HTTP 状态（200/4xx/5xx/畸形/网络错误），验证适配层映射。
//   · 内存 store 替身（仅歧义用例）：喂给真实 makeUploadContextService 的行形状替身——
//     真实 schema 的唯一索引 uq_binding_scope 使「同租户同主体同客户双 active 绑定」在真库不可构造，
//     AMBIGUOUS_UPLOAD_BINDING 是 Connectors 防御分支；本用例只验证装配链对该分支的行为
//     （200 available:false、不泄露绑定引用），不验证 SQL。
//   · sessionOf/fetchContext 替身：reader 既有注入点（upload-context.test.mjs 同惯例）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { createAuthorizeUploadViaA, createUploadContextAssembly, createFetchContextFromConnectors } =
  await import('../src/upload-context-assembly.mjs');

const SESSION = { sessionId: 's1', principalId: 'p1', credential: 'server-only-cred' };
const sessionOf = (req) => (req.headers['x-jw-session'] === 's1' ? SESSION : null);

/** 组装最小 reader：注入 A 替身 + fetchContext 计数替身。 */
function buildReader({ aStatus, aBody, aRaw, aThrow, grant }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, header: init.headers['x-principal-credential'] });
    if (aThrow) throw aThrow;
    if (aRaw !== undefined) return { status: aStatus, json: async () => { throw new SyntaxError('bad json'); }, text: async () => aRaw };
    return { status: aStatus, json: async () => aBody };
  };
  const authz = createAuthorizeUploadViaA({ aBaseUrl: 'http://a.test', fetchImpl });
  let upstreamReads = 0;
  const readerPromise = createUploadContextAssembly({
    sessionOf,
    authorizeUpload: grant === undefined ? authz : async (q) => grant(q),
    fetchContext: async (identity) => { upstreamReads++; return { customerId: identity.customerId, available: true, reason: null, bindingRef: 'b', invitationId: 'i', allowedKinds: ['invoice'], allowedObjects: [], expiresAt: '2030-01-01T00:00:00Z' }; },
  });
  return { calls, readerPromise, upstream: () => upstreamReads };
}
const call = async (assembled, customerId = 'c1') => {
  const r = await assembled.reader({ req: { headers: { 'x-jw-session': 's1' } }, customerId });
  return { status: r.status, body: r.body };
};

test('A 200+ok:false（跨客户拒绝）→ 403 UPLOAD_FORBIDDEN，上游恢复读零触达', async () => {
  const { readerPromise, upstream } = buildReader({
    aStatus: 200,
    aBody: { ok: false, principalId: 'p1', customerId: 'c1', tenantId: null, canRead: false, canUpload: false, kind: null, kindRestricted: true, allowedKinds: null, kindAllowed: null, reason: 'CUSTOMER_SCOPE_VIOLATION' },
  });
  const r = await call(await readerPromise);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'UPLOAD_FORBIDDEN');
  assert.equal(upstream(), 0, '未过授权门不上游');
});

test('A 403 PRINCIPAL_UNTRUSTED（凭据失效）→ 403 拒绝，不落入 503', async () => {
  const { readerPromise } = buildReader({ aStatus: 403, aBody: { ok: false, error: 'PRINCIPAL_UNTRUSTED' } });
  const r = await call(await readerPromise);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'UPLOAD_FORBIDDEN');
});

test('A 500 → 503 UPLOAD_CONTEXT_UNAVAILABLE（上游故障如实上抛）', async () => {
  const { readerPromise } = buildReader({ aStatus: 500, aBody: { ok: false, error: 'INTERNAL' } });
  const r = await call(await readerPromise);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
});

test('A 网络不可达 → 503', async () => {
  const { readerPromise } = buildReader({ aThrow: new Error('connect ECONNREFUSED') });
  const r = await call(await readerPromise);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
});

test('A 200 畸形 JSON → 503（不伪装成授权判断）', async () => {
  const { readerPromise } = buildReader({ aStatus: 200, aRaw: 'not-json' });
  const r = await call(await readerPromise);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
});

test('适配层直测：credential 原样入头、principalId 进查询、200 授权原样返回', async () => {
  const calls = [];
  const okGrant = { ok: true, principalId: 'p1', customerId: 'c1', tenantId: 't1', canRead: true, canUpload: true, kind: null, kindRestricted: false, allowedKinds: null, kindAllowed: null, reason: 'OK' };
  const fetchImpl = async (url, init) => {
    calls.push({ url, header: init.headers['x-principal-credential'] });
    return { status: 200, json: async () => okGrant };
  };
  const authz = createAuthorizeUploadViaA({ aBaseUrl: 'http://a.test/', fetchImpl });
  const grant = await authz({ credential: 'SECRET-CRED', principalId: 'p1', customerId: 'c1' });
  assert.deepEqual(grant, okGrant, '200 投影结果逐字段透传，适配层不改写授权判断');
  assert.equal(calls[0].header, 'SECRET-CRED');
  assert.ok(calls[0].url.includes('/api/v2/customers/c1/upload-authorization'), calls[0].url);
  assert.ok(calls[0].url.includes('principalId=p1'), calls[0].url);
  await assert.rejects(() => authz({ credential: 'x', customerId: '' }), TypeError);
});

test('歧义绑定（行形状内存 store 替身）：200 available:false，不泄露绑定引用', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  const row = (b, i) => ({ binding_id: b, binding_status: 'active', invitation_id: i, invitation_status: 'accepted', allowed_evidence_kinds: ['invoice'], object_refs: [], expires_at: future });
  const stubStore = { query: async () => ({ rows: [row('bd-a', 'iv-a'), row('bd-b', 'iv-b')] }) };
  const fetchContext = await createFetchContextFromConnectors({ connectorsStore: stubStore });
  const assembly = await createUploadContextAssembly({
    sessionOf,
    authorizeUpload: async (q) => ({ ok: true, principalId: 'p1', customerId: q.customerId, tenantId: 't1', canRead: true, canUpload: true }),
    fetchContext,
  });
  const r = await call(assembly);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.available, false);
  assert.equal(r.body.reason, 'AMBIGUOUS_UPLOAD_BINDING');
  assert.equal(r.body.bindingRef, null);
  assert.equal(r.body.invitationId, null);
  assert.deepEqual(r.body.allowedKinds, []);
});

test('上游恢复读返回畸形上下文 → 502 UPLOAD_CONTEXT_INVALID（reader 既有分支保持）', async () => {
  const assembly = await createUploadContextAssembly({
    sessionOf,
    authorizeUpload: async (q) => ({ ok: true, principalId: 'p1', customerId: q.customerId, tenantId: 't1', canRead: true, canUpload: true }),
    fetchContext: async () => ({ customerId: 'other', foo: true }),
  });
  const r = await call(assembly);
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'UPLOAD_CONTEXT_INVALID');
});

test('工厂配置校验：缺任一必需依赖即拒绝装配；store 缺 query 拒绝', async () => {
  await assert.rejects(() => createUploadContextAssembly({}), TypeError);
  await assert.rejects(() => createUploadContextAssembly({ sessionOf }), TypeError);
  await assert.rejects(() => createUploadContextAssembly({ sessionOf, aBaseUrl: 'http://a.test' }), TypeError);
  await assert.rejects(() => createUploadContextAssembly({ sessionOf, authorizeUpload: async () => ({}) }), TypeError);
  assert.throws(() => createAuthorizeUploadViaA({ aBaseUrl: '' }), TypeError);
  assert.throws(() => createAuthorizeUploadViaA({ aBaseUrl: 'http://a.test', fetchImpl: 'no' }), TypeError);
  await assert.rejects(() => createFetchContextFromConnectors({ connectorsStore: {} }), TypeError);
  await assert.rejects(() => createFetchContextFromConnectors({}), TypeError);
});
