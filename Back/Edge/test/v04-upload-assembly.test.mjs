// V0.4 R2-02 主套件：上传恢复装配链隔离 HTTP/PG 实证。
// 契约：docs/v0.4/results/r2-02-upload/CONTRACT.md。
// 链路：真实 A 内核进程（utils startKernel，真实 upload-authorization 投影 HTTP 面）
//       → 真实 Edge reader（upload-context.mjs，经装配工厂合成，隔离 HTTP 实例）
//       → 真实 Connectors 恢复模块（intake/upload-context.mjs read，真实隔离 PG store）。
// 环境：本路专有容器 jw-v04r2-upload-pg@25461（env 可覆盖；A 与 Connectors 各用独立测试库，自建自删）。
// 替身边界（仅 2 处，如实标注；其余零替身）：
//   ① Edge 会话 exchange 的 verifyCredential（会话建立层注入点，server.mjs S5 部署形态）——
//      真实授权不依赖它：凭据原样转交 A 逐请求复核，伪造/失效凭据被真实 A 拒绝（用例4）。
//   ② 歧义用例的行形状内存 store（真实 schema 唯一索引使歧义不可构造）——在边界套件 v04-upload-assembly-boundaries。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';

// A test/utils.mjs 在 import 时读取 JW_A_ADMIN_DB_URL —— 必须先定 env 再动态 import。
process.env.JW_A_ADMIN_DB_URL ??= 'postgres://jwv04r2:jwv04r2@127.0.0.1:25461/cnext';
const { startKernel, client, newId } = await import('../../A/test/utils.mjs');
const { createUploadContextAssembly, createFetchContextFromConnectors, createAuthorizeUploadViaA } =
  await import('../src/upload-context-assembly.mjs');
const { createSessionStore } = await import('../src/session.mjs');
const connPg = await import('../../Connectors/src/store/pg.mjs');
const { makeIntakeService } = await import('../../Connectors/src/intake/service.mjs');
const { makeBindingService } = await import('../../Connectors/src/wecom/binding.mjs');

const CONN_PG = {
  host: '127.0.0.1',
  port: Number(process.env.R2_UPLOAD_CONNECTORS_PG_PORT ?? 25461),
  user: process.env.R2_UPLOAD_CONNECTORS_PG_USER ?? 'jwv04r2',
  password: process.env.R2_UPLOAD_CONNECTORS_PG_PASSWORD ?? 'jwv04r2',
  database: process.env.R2_UPLOAD_CONNECTORS_PG_DATABASE ?? 'cnext',
};

const TOK = {
  admin: 'tok-admin',
  biz: 'tok-biz',     // bob  human business tenants=[t1] customers=all
  other: 'tok-other', // dave human business tenants=[t2]
};
const T1 = 't1', T2 = 't2';
const A_DOWN = 'http://127.0.0.1:9'; // 无监听端口：上游不可达注入

let k, store, connDbName, bindings, intake, connInvitationId, connBindingId;
let sessionStore, credMap;
let st1, sbiz, sother, sghost; // Edge 会话 id
let innerFetch, countedFetch, connReads, connIdentities;
let assembly, assemblyDirect, server, port;
let C1, C2, C3, ct1;
const asAdmin = () => client(k.base, TOK.admin);

async function snapshotDb(pool) {
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`))
    .rows.map((r) => r.tablename);
  const out = {};
  for (const t of tables) {
    const rows = (await pool.query(`SELECT * FROM "${t}"`)).rows;
    const norm = rows.map((r) => JSON.stringify(Object.entries(r).sort((a, b) => a[0].localeCompare(b[0])))).sort();
    out[t] = `${rows.length}:${createHash('sha256').update(norm.join('\n')).digest('hex')}`;
  }
  return out;
}

function httpServerFor(reader) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const result = await reader({ req, customerId: url.searchParams.get('customerId') });
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

const getMain = async (sessionId, customerId, extraQuery = '') => {
  const headers = {};
  if (sessionId !== null) headers['x-jw-session'] = sessionId;
  const res = await fetch(`http://127.0.0.1:${port}/upload-context?customerId=${encodeURIComponent(customerId)}${extraQuery}`, { headers });
  return { status: res.status, body: await res.json() };
};
const readerCall = (reader, sessionId, customerId) =>
  reader({ req: { headers: sessionId === null ? {} : { 'x-jw-session': sessionId } }, customerId });
const direct = async (reader, sessionId, customerId) => {
  const r = await readerCall(reader, sessionId, customerId);
  return { status: r.status, body: r.body };
};

test.before(async () => {
  k = await startKernel({
    principalSpec: [
      `${TOK.admin}=alice:human:admin:all`,
      `${TOK.biz}=bob:human:business:all:t1`,
      `${TOK.other}=dave:human:business:all:t2`,
    ].join(','),
  });
  const admin = asAdmin();
  // A 侧客户：C1/C2 ∈ t1，C3 ∈ t2
  for (const [tenantId, ref] of [[T1, 'c1'], [T1, 'c2'], [T2, 'c3']]) {
    const r = await admin('POST', '/api/v2/customers', {
      tenantId, requestId: newId('req'), legalEntityRef: `le-r2-${ref}`, displayName: `R2客户${ref.toUpperCase()}`,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const dir = await admin('GET', '/api/v2/customers?limit=100');
  const byRef = {};
  for (const c of dir.json.customers) byRef[c.customerId] = c.displayName;
  C1 = Object.keys(byRef).find((id) => byRef[id] === 'R2客户C1');
  C2 = Object.keys(byRef).find((id) => byRef[id] === 'R2客户C2');
  C3 = Object.keys(byRef).find((id) => byRef[id] === 'R2客户C3');
  assert.ok(C1 && C2 && C3);
  // A 侧受限联系人（C1）：customer_identities 白名单 invoice/bank_statement
  const inv = await admin('POST', `/api/v2/customers/${C1}/invitations`, {
    tenantId: T1, requestId: newId('req'), role: 'customer-finance', allowedKinds: ['invoice', 'bank_statement'],
  });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.json.invitation.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  ct1 = { credential: red.json.credential, principalId: red.json.principalId };

  // Connectors 侧：独立测试库 + 真实 intake 链（签发→接受→核验→active），provider_user_id=A 主体
  const created = await connPg.createTestDatabase(CONN_PG);
  connDbName = created.dbName;
  store = connPg.makeStore(created);
  await connPg.migrate(store);
  bindings = makeBindingService(store);
  intake = makeIntakeService(store, { bindings });
  const issued = await intake.issueInvitation({
    tenantId: T1, customerId: C1, role: 'customer_contact', allowedEvidenceKinds: ['invoice'], ttlSec: 3600, createdBy: 'r2-02-test',
  });
  connInvitationId = issued.invitationId;
  const accepted = await intake.acceptInvitation({
    tenantId: T1, token: issued.token, provider: 'jw_principal', providerUserId: ct1.principalId,
  });
  connBindingId = accepted.bindingId;
  await intake.verifyBinding({ tenantId: T1, bindingId: connBindingId, verifiedBy: 'r2-02-test', evidenceRefs: ['synthetic-proof'] });

  // Edge 侧：真实会话存储（替身边界①仅此 verifyCredential；真实授权逐请求走 A）
  sessionStore = createSessionStore({});
  credMap = new Map([
    [ct1.credential, { principalId: ct1.principalId, roles: ['customer'], tenantId: T1 }],
    [TOK.biz, { principalId: 'bob', roles: ['business'], tenantId: T1 }],
    [TOK.other, { principalId: 'dave', roles: ['business'], tenantId: T2 }],
    ['stale-cred-ghost', { principalId: 'ghost', roles: ['customer'], tenantId: T1 }],
  ]);
  const verifySessionCredential = async ({ credential }) => {
    const rec = credMap.get(String(credential));
    return rec ? { ok: true, ...rec } : { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  };
  const exchangeAll = async () => {
    st1 = (await sessionStore.exchange(verifySessionCredential, ct1.credential)).session.sessionId;
    sbiz = (await sessionStore.exchange(verifySessionCredential, TOK.biz)).session.sessionId;
    sother = (await sessionStore.exchange(verifySessionCredential, TOK.other)).session.sessionId;
    sghost = (await sessionStore.exchange(verifySessionCredential, 'stale-cred-ghost')).session.sessionId;
  };
  await exchangeAll();

  // 装配：真实 A HTTP 授权源 + 真实 Connectors 恢复模块（计数包装仅用于断言上游触达）
  innerFetch = await createFetchContextFromConnectors({ connectorsStore: store });
  connReads = 0;
  connIdentities = [];
  countedFetch = async (identity) => {
    connReads++;
    connIdentities.push(identity);
    return innerFetch(identity);
  };
  assembly = await createUploadContextAssembly({ sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']), aBaseUrl: k.base, fetchContext: countedFetch });
  // 直连注入形态（connectorsStore 分支，覆盖动态 import 组装路径）
  assemblyDirect = await createUploadContextAssembly({ sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']), aBaseUrl: k.base, connectorsStore: store });

  server = await httpServerFor(assembly.reader);
  port = server.address().port;
});

test.after(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  await k?.stop();
  await store?.close();
  if (connDbName) await connPg.dropTestDatabase(CONN_PG, connDbName);
});

test('授权正例：200 可用恢复上下文，响应 allowlist、租户与身份可信传递', async () => {
  const before = connReads;
  const r = await getMain(st1, C1, '&tenantId=forged-by-client');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(),
    ['allowedKinds', 'allowedObjects', 'bindingRef', 'customerId', 'expiresAt', 'invitationId', 'ok', 'reason', 'available'].sort());
  assert.equal(r.body.ok, true);
  assert.equal(r.body.available, true);
  assert.equal(r.body.reason, null);
  assert.equal(r.body.customerId, C1);
  assert.deepEqual(r.body.allowedKinds, ['invoice']);
  assert.deepEqual(r.body.allowedObjects, []);
  assert.equal(typeof r.body.bindingRef, 'string');
  assert.equal(typeof r.body.invitationId, 'string');
  assert.equal(typeof r.body.expiresAt, 'string');
  assert.equal(connReads, before + 1, '恰好一次 Connectors 上游读');
  // 可信身份传递：fetchContext 收到的是 A 权威租户 + 会话主体；客户端伪造租户参数无通道
  assert.deepEqual(connIdentities.at(-1), { tenantId: T1, customerId: C1, principalId: ct1.principalId });
  // 直连注入形态（工厂 connectorsStore 分支）同样可达
  const d = await direct(assemblyDirect.reader, st1, C1);
  assert.equal(d.status, 200);
  assert.equal(d.body.available, true);
});

test('A授权通过但无恢复绑定：available:false 诚实回报，不伪造上下文', async () => {
  const r = await getMain(sbiz, C2);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.available, false);
  assert.equal(r.body.reason, 'NO_ACTIVE_UPLOAD_BINDING');
  assert.equal(r.body.bindingRef, null);
  assert.equal(r.body.invitationId, null);
  assert.deepEqual(r.body.allowedKinds, []);
  assert.equal(r.body.expiresAt, null);
});

test('跨租户与跨客户：A 结构化拒绝 → 403 UPLOAD_FORBIDDEN，Connectors 零查询', async () => {
  const before = connReads;
  const crossTenant = await getMain(sother, C1); // dave(t2) 读 t1 客户
  assert.equal(crossTenant.status, 403);
  assert.equal(crossTenant.body.error, 'UPLOAD_FORBIDDEN');
  const crossCustomer = await getMain(st1, C2); // ct1 grant 仅 C1
  assert.equal(crossCustomer.status, 403);
  assert.equal(crossCustomer.body.error, 'UPLOAD_FORBIDDEN');
  const ownTenantNoBinding = await getMain(sother, C3); // dave 自己租户：A 过、Connectors 无绑定
  assert.equal(ownTenantNoBinding.status, 200);
  assert.equal(ownTenantNoBinding.body.available, false);
  assert.equal(connReads, before + 1, '仅 dave/C3 一次上游读；两条拒绝路径零上游触达');
  assert.deepEqual(connIdentities.at(-1), { tenantId: T2, customerId: C3, principalId: 'dave' });
});

test('会话凭据未被A信任：凭据原样转交复核，403 拒绝而非 503', async () => {
  const before = connReads;
  const r = await getMain(sghost, C1); // ghost 会话凭据 A 不认 → 403 PRINCIPAL_UNTRUSTED → 适配为授权拒绝
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error, 'UPLOAD_FORBIDDEN');
  assert.equal(connReads, before, '未过授权门不上游');
});

test('Connectors 侧过期与撤销：恢复读失败关闭并诚实回报不可用', async () => {
  // 过期（白盒时间操纵，仅本路自建库）
  await store.query(`UPDATE intake_invitations SET expires_at = now() - interval '1 hour' WHERE invitation_id=$1`, [connInvitationId]);
  const expired = await getMain(st1, C1);
  assert.equal(expired.status, 200);
  assert.equal(expired.body.available, false);
  assert.equal(expired.body.reason, 'NO_ACTIVE_UPLOAD_BINDING');
  await store.query(`UPDATE intake_invitations SET expires_at = now() + interval '1 hour' WHERE invitation_id=$1`, [connInvitationId]);
  const restored = await getMain(st1, C1);
  assert.equal(restored.body.available, true, '恢复后重新可用');
  // 撤销（真实 binding 服务）
  await bindings.setStatus({ tenantId: T1, bindingId: connBindingId, status: 'revoked', actor: 'r2-02-test' });
  const revoked = await getMain(st1, C1);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.available, false);
  assert.equal(revoked.body.reason, 'NO_ACTIVE_UPLOAD_BINDING');
  assert.equal(revoked.body.bindingRef, null, '撤销后不得泄露绑定引用');
  await store.query(`UPDATE participant_bindings SET status='active' WHERE binding_id=$1`, [connBindingId]);
});

test('读中会话变化：最终会话复查失败 → 401 SESSION_REQUIRED', async () => {
  const hookAssembly = await createUploadContextAssembly({
    sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']),
    aBaseUrl: k.base,
    fetchContext: async (identity) => {
      sessionStore.revoke(st1); // 上游读期间会话失效
      return countedFetch(identity);
    },
  });
  const r = await direct(hookAssembly.reader, st1, C1);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'SESSION_REQUIRED');
  // 重建 ct1 会话供后续用例（被撤销的是原会话 id）
  st1 = (await sessionStore.exchange(
    async ({ credential }) => ({ ok: true, ...credMap.get(String(credential)) }), ct1.credential,
  )).session.sessionId;
});

test('读中A侧撤权：最终授权复查失败 → 403 UPLOAD_FORBIDDEN（非503），拒绝后零写入', async () => {
  const artifactsBefore = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  const hookAssembly = await createUploadContextAssembly({
    sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']),
    aBaseUrl: k.base,
    fetchContext: async (identity) => {
      const rv = await asAdmin()('DELETE', `/api/v2/customers/${C1}/grants/${ct1.principalId}`, {});
      assert.equal(rv.status, 200, JSON.stringify(rv.json));
      return countedFetch(identity);
    },
  });
  const r = await direct(hookAssembly.reader, st1, C1);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error, 'UPLOAD_FORBIDDEN');
  const artifactsAfter = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  assert.equal(artifactsAfter, artifactsBefore, '读链拒绝零写入');
  const again = await getMain(st1, C1);
  assert.equal(again.status, 403, '撤权即刻生效（首次授权门即拒）');
});

test('上游不可用：A 不可达与 Connectors PG 关闭均 503 诚实故障', async () => {
  const aDown = await createUploadContextAssembly({
    sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']),
    aBaseUrl: A_DOWN, fetchContext: countedFetch,
  });
  const r1 = await direct(aDown.reader, sbiz, C1);
  assert.equal(r1.status, 503);
  assert.equal(r1.body.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
  const closedStore = connPg.makeStore({ ...CONN_PG, database: connDbName });
  await closedStore.close();
  const pgDown = await createUploadContextAssembly({
    sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']),
    aBaseUrl: k.base, connectorsStore: closedStore,
  });
  const r2 = await direct(pgDown.reader, sbiz, C1);
  assert.equal(r2.status, 503);
  assert.equal(r2.body.error, 'UPLOAD_CONTEXT_UNAVAILABLE');
});

test('GET 零写：A 库与 Connectors 库全表快照逐字节一致', async () => {
  const aBefore = await snapshotDb(k.pool);
  const cBefore = await snapshotDb(store.pool);
  const matrix = [
    await getMain(st1, C1),      // 403（ct1 已撤权）
    await getMain(sbiz, C2),     // 200 available:false
    await getMain(sother, C3),   // 200 available:false
    await getMain(sghost, C1),   // 403
    await getMain(null, C1),     // 401 无会话
    await direct((await createUploadContextAssembly({ sessionOf: (req) => sessionStore.resolve(req.headers['x-jw-session']), aBaseUrl: A_DOWN, fetchContext: countedFetch })).reader, sbiz, C1), // 503
  ];
  assert.deepEqual(matrix.map((r) => r.status), [403, 200, 200, 403, 401, 503], '矩阵状态码符合契约');
  const aAfter = await snapshotDb(k.pool);
  const cAfter = await snapshotDb(store.pool);
  assert.deepEqual(aAfter, aBefore, 'A 库被读链改变（违反零写）');
  assert.deepEqual(cAfter, cBefore, 'Connectors 库被读链改变（违反零写）');
});

test('不泄露秘密：响应无 token/凭据/哈希/provider 等字段与值', async () => {
  const samples = [await getMain(sbiz, C1), await getMain(st1, C1)];
  const banned = ['token', 'credential', 'sha256', 'secret', 'provideruserid', 'token_hash'];
  for (const r of samples) {
    const text = JSON.stringify(r.body).toLowerCase();
    for (const b of banned) assert.ok(!text.includes(b), `响应含敏感字段名：${b}`);
    assert.ok(!text.includes(String(ct1.credential).toLowerCase()), '响应不得出现联系人凭据');
    assert.ok(!text.includes('stale-cred-ghost'), '响应不得出现替身凭据');
  }
});

test('工厂配置校验：依赖缺失即拒绝装配（配置期失败关闭）', async () => {
  await assert.rejects(() => createUploadContextAssembly({}), TypeError);
  await assert.rejects(() => createUploadContextAssembly({ sessionOf: () => null }), TypeError);
  await assert.rejects(() => createUploadContextAssembly({ sessionOf: () => null, aBaseUrl: k.base }), TypeError);
  assert.throws(() => createAuthorizeUploadViaA({}), TypeError);
  await assert.rejects(() => createFetchContextFromConnectors({}), TypeError);
});
