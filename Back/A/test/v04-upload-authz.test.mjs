// V0.4 01 路主套件：上传授权只读投影 ↔ registerArtifact 写门正反例对照 + 零副作用。
// 契约：docs/v0.4/results/01-upload/CONTRACT.md（V0.4-UPLOAD-AUTHZ-PROJ-1.0）。
// 环境：真实隔离 PG（JW_A_ADMIN_DB_URL 指向本路容器）+ 真实 HTTP 内核进程（utils startKernel）。
// 每轮自建独立数据库、自删；无替身（DB 故障替身用例在 v04-upload-failclosed.test.mjs 单列）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startKernel, client, newId } from './utils.mjs';

const TOK = {
  admin: 'tok-admin',
  biz: 'tok-biz',     // bob  human business tenants=[t1] customers=all
  agent: 'tok-agent', // worker1 agent
  clerk: 'tok-clerk', // carl  human business tenants=[t1] customers=grant
  other: 'tok-other', // dave  human business tenants=[t2]
};

const T1 = 't1', T2 = 't2';
let k; // { base, pool, stop, ... }
let C1, C2, C3; // 客户：C1/C2∈t1，C3∈t2
let ct1, ct2, svc; // 客户联系人×2（邀请兑换）、服务身份
let ci1Id; // 联系人1 principalId（撤权用）

const authed = () => client(k.base, TOK.admin);
const as = (token) => client(k.base, token);
const anon = () => client(k.base, null);

/** GET 投影（拒绝是 200+ok:false；凭据失败 403）。credential=null 表示无会话。 */
async function proj(credential, customerId, { kind, principalId } = {}) {
  const q = new URLSearchParams();
  if (kind !== undefined) q.set('kind', kind);
  if (principalId !== undefined) q.set('principalId', principalId);
  const qs = q.toString();
  const c = credential === null ? anon() : as(credential);
  return c('GET', `/api/v2/customers/${customerId}/upload-authorization${qs ? `?${qs}` : ''}`);
}

/** registerArtifact 真实写门调用（同凭据、同 kind、tenantId=指定声明）。 */
async function regArtifact(credential, customerId, kind, tenantId) {
  return as(credential)('POST', `/api/v2/customers/${customerId}/artifacts`, {
    tenantId, requestId: newId('req'), kind,
    content: { note: 'v04-upload-authz 对照用例' },
  });
}

async function dbSnapshot(pool) {
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

/** 正反例对照核心断言：投影 canUpload ⟺ 写门放行（契约 §3.1）。expect=拒绝时的期望 reason。 */
function assertPair(projection, write, expect) {
  assert.equal(projection.status, 200, `投影应 200：${JSON.stringify(projection.json)}`);
  const g = projection.json;
  assert.equal(typeof g.canRead, 'boolean');
  assert.equal(typeof g.canUpload, 'boolean');
  assert.equal(g.canUpload, write.status === 200, `读写不一致：canUpload=${g.canUpload}，写门=${write.status} ${JSON.stringify(write.json)}`);
  assert.equal(g.ok, write.status === 200);
  if (!g.ok) {
    assert.equal(g.tenantId, null, '拒绝路径不得泄露租户');
    assert.match(g.reason, /^(PRINCIPAL_MISMATCH|CUSTOMER_NOT_FOUND|CUSTOMER_SCOPE_VIOLATION|NOT_HUMAN|KIND_NOT_ALLOWED)$/);
    if (expect !== undefined) assert.equal(g.reason, expect, `reason 不符：${g.reason} ≠ ${expect}`);
  } else {
    assert.equal(g.reason, 'OK');
    assert.equal(typeof g.tenantId, 'string');
  }
  return g;
}

test.before(async () => {
  // 字面量 SPEC（键名错位曾产生空目录 → 全部凭据不可验证；保持显式）：
  const principalSpec = [
    `${TOK.admin}=alice:human:admin:all`,
    `${TOK.biz}=bob:human:business:all:t1`,
    `${TOK.agent}=worker1:agent:business:all`,
    `${TOK.clerk}=carl:human:business:all:t1:grant`,
    `${TOK.other}=dave:human:business:all:t2`,
  ].join(',');
  k = await startKernel({ principalSpec });
  const admin = authed();
  // 客户：C1/C2 ∈ t1，C3 ∈ t2
  for (const [tenantId, ref] of [[T1, 'c1'], [T1, 'c2'], [T2, 'c3']]) {
    const r = await admin('POST', '/api/v2/customers', {
      tenantId, requestId: newId('req'), legalEntityRef: `le-${ref}`, displayName: `客户${ref.toUpperCase()}`,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const dir = await admin('GET', '/api/v2/customers?limit=100');
  const byRef = {};
  for (const c of dir.json.customers) byRef[c.customerId] = c.displayName;
  C1 = Object.keys(byRef).find((id) => byRef[id] === '客户C1');
  C2 = Object.keys(byRef).find((id) => byRef[id] === '客户C2');
  C3 = Object.keys(byRef).find((id) => byRef[id] === '客户C3');
  assert.ok(C1 && C2 && C3);
  // 受限联系人（C1）：invoice/bank_statement 白名单
  const inv1 = await admin('POST', `/api/v2/customers/${C1}/invitations`, {
    tenantId: T1, requestId: newId('req'), role: 'customer-finance', allowedKinds: ['invoice', 'bank_statement'],
  });
  assert.equal(inv1.status, 200, JSON.stringify(inv1.json));
  const red1 = await anon()('POST', '/api/v2/invitations/redeem', { code: inv1.json.invitation.code });
  assert.equal(red1.status, 200, JSON.stringify(red1.json));
  ct1 = { credential: red1.json.credential, principalId: red1.json.principalId };
  ci1Id = ct1.principalId;
  // 联系人（C2，过期用例）：photo
  const inv2 = await admin('POST', `/api/v2/customers/${C2}/invitations`, {
    tenantId: T1, requestId: newId('req'), role: 'customer-owner', allowedKinds: ['photo'],
  });
  const red2 = await anon()('POST', '/api/v2/invitations/redeem', { code: inv2.json.invitation.code });
  assert.equal(red2.status, 200);
  ct2 = { credential: red2.json.credential, principalId: red2.json.principalId, invitationId: inv2.json.invitation.invitationId };
  // 服务身份（t1）：kind=service
  const s = await admin('POST', '/api/v2/service-identities', { tenantId: T1, requestId: newId('req'), displayName: 'v04-conn' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  svc = { credential: s.json.credential, principalId: s.json.principalId };
  // 内部 grant 模式 principal（carl）→ C1
  const g = await admin('POST', `/api/v2/customers/${C1}/grants`, { tenantId: T1, requestId: newId('req'), principalId: 'carl' });
  assert.equal(g.status, 200, JSON.stringify(g.json));
});

test.after(async () => { await k.stop(); });

test('正反例矩阵：投影判定与 registerArtifact 写门逐例一致', async () => {
  const cases = [
    // [名, 凭据, 客户, kind, 写门租户声明, 期望拒绝reason]
    ['本人授权·受限联系人在白名单内', ct1.credential, C1, 'invoice', T1, undefined],
    ['material.前缀别名与写门同规则', ct1.credential, C1, 'material.invoice', T1, undefined],
    ['第二白名单种类', ct1.credential, C1, 'bank_statement', T1, undefined],
    ['种类不在清单→投影拒+写门403', ct1.credential, C1, 'tax_record', T1, 'KIND_NOT_ALLOWED'],
    ['租户内内部角色不受种类限制', TOK.biz, C1, 'invoice', T1, undefined],
    ['agent非人类→不可上传可读', TOK.agent, C1, 'invoice', T1, 'NOT_HUMAN'],
    ['service非人类→不可上传可读', svc.credential, C1, 'invoice', T1, 'NOT_HUMAN'],
    ['grant模式内部human已登记', TOK.clerk, C1, 'invoice', T1, undefined],
    ['跨客户→grant缺失拒绝', ct1.credential, C2, 'invoice', T1, 'CUSTOMER_SCOPE_VIOLATION'],
    ['跨租户→拒绝且不泄露租户', TOK.other, C1, 'invoice', T2, 'CUSTOMER_SCOPE_VIOLATION'],
  ];
  for (const [name, credential, customerId, kind, tenantId, expect] of cases) {
    const p = await proj(credential, customerId, { kind });
    const w = await regArtifact(credential, customerId, kind, tenantId);
    const g = assertPair(p, w, expect);
    if (g.ok) assert.equal(typeof w.json.artifactId, 'string');
    if (name.includes('受限联系人在白名单')) {
      assert.deepEqual(g.allowedKinds, ['invoice', 'bank_statement']);
      assert.equal(g.kindRestricted, true);
      assert.equal(g.tenantId, T1);
    }
    if (name.includes('前缀别名')) {
      assert.equal(g.kindAllowed, true);
      assert.deepEqual(g.allowedKinds, ['invoice', 'bank_statement']);
    }
    if (name.includes('不在清单')) {
      assert.equal(g.canRead, true, '种类拒绝只挡上传，不挡读取');
      assert.equal(g.kindAllowed, false);
      assert.equal(w.json.error, 'PERMISSION_DENIED');
    }
    if (name.includes('非人类')) {
      assert.equal(g.canRead, true, 'agent/service 在授权范围内可读（现有读口同语义）');
      assert.equal(w.json.error, 'PERMISSION_DENIED');
    }
    if (name.includes('grant模式')) {
      assert.equal(g.kindRestricted, false, '内部身份不受种类白名单限制');
      assert.equal(g.allowedKinds, null);
    }
    if (name.includes('跨租户')) {
      assert.equal(w.status, 404, 't2 主体以 t2 声明写 t1 客户 → 写门 lockCustomer 404');
    }
  }
});

test('无 kind 投影=回答"能否上传某类材料"，与写门实际放行一致', async () => {
  const g1 = await proj(ct1.credential, C1);
  assert.equal(g1.json.canUpload, true);
  assert.equal(g1.json.kind, null);
  assert.equal(g1.json.kindAllowed, null);
  const w = await regArtifact(ct1.credential, C1, 'invoice', T1);
  assert.equal(w.status, 200);
  const g2 = await proj(TOK.agent, C1);
  assert.equal(g2.json.canUpload, false);
  assert.equal(g2.json.reason, 'NOT_HUMAN');
});

test('写门租户声明越界被拒、投影（无声明）按客户行租户判定——契约 §1.3 口径差实证', async () => {
  const before = await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1]);
  // tok-biz（tenants=[t1]）以错误声明 t2 写 C1 → 写门 authorizeTenant 403
  const wrong = await regArtifact(TOK.biz, C1, 'invoice', T2);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.error, 'CUSTOMER_SCOPE_VIOLATION');
  // 同一主体以正确声明（客户真实租户）写 → 放行；投影无声明同样可上传（一致性命题）
  const right = await regArtifact(TOK.biz, C1, 'invoice', T1);
  assert.equal(right.status, 200);
  const p = await proj(TOK.biz, C1, { kind: 'invoice' });
  assert.equal(p.json.canUpload, true);
  // 声明与客户行租户错位（t2 主体以 t2 声明写 t1 客户）→ lockCustomer 404
  const cross = await regArtifact(TOK.other, C1, 'invoice', T2);
  assert.equal(cross.status, 404);
  const afterDenied = await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1]);
  assert.equal(afterDenied.rows[0].n, before.rows[0].n + 1, '仅正确声明那一笔落库；两次拒绝零写入');
});

test('无会话/伪造凭据：投影与写门同闭（403 失败关闭，不泄露凭据，拒绝后零写入）', async () => {
  const n0 = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts')).rows[0].n;
  for (const credential of [null, 'forged-token-xyz']) {
    const p = await proj(credential, C1, { kind: 'invoice' });
    assert.equal(p.status, 403, `凭据=${credential}`);
    assert.equal(p.json.error, 'PRINCIPAL_UNTRUSTED');
    assert.ok(!JSON.stringify(p.json).includes(credential ?? '\u0000'), '错误体不得回显凭据');
    const w = await regArtifact(credential ?? 'forged-token-xyz', C1, 'invoice', T1);
    assert.equal(w.status, 403);
    assert.equal(w.json.error, 'PRINCIPAL_UNTRUSTED');
    assert.ok(!JSON.stringify(w.json).includes(credential ?? '\u0000'));
  }
  const n1 = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts')).rows[0].n;
  assert.equal(n1, n0, '权限拒绝后写入零发生');
});

test('伪造 principalId 声明：投影显式拒绝；写门只认凭据（body 同名字段被忽略）', async () => {
  const forged = await proj(ct1.credential, C1, { kind: 'invoice', principalId: 'alice' });
  assert.equal(forged.status, 200);
  assert.equal(forged.json.ok, false);
  assert.equal(forged.json.reason, 'PRINCIPAL_MISMATCH');
  assert.equal(forged.json.canUpload, false);
  assert.equal(forged.json.principalId, ci1Id, '返回凭据派生主体，不是声明');
  const honest = await proj(ct1.credential, C1, { kind: 'invoice', principalId: ci1Id });
  assert.equal(honest.json.ok, true, '声明=真实主体时无影响');
  const n0 = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  const w = await as(ct1.credential)('POST', `/api/v2/customers/${C1}/artifacts`, {
    tenantId: T1, requestId: newId('req'), kind: 'invoice', principalId: 'alice',
    content: { note: 'body 伪造主体声明不影响写门（契约 §3.2）' },
  });
  assert.equal(w.status, 200, '写门只认凭据；principalId 声明是投影专属防混淆门');
  const n1 = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  assert.equal(n1, n0 + 1);
});

test('过期：邀请过期只能挡兑换（410）；已兑换身份读写一致不受影响（现有写门口径）', async () => {
  const inv = await authed()('POST', `/api/v2/customers/${C3}/invitations`, {
    tenantId: T2, requestId: newId('req'), role: 'customer-owner', allowedKinds: ['report'],
  });
  assert.equal(inv.status, 200);
  await k.pool.query(`UPDATE customer_invitations SET expires_at = now() - interval '1 hour' WHERE invitation_id=$1`, [inv.json.invitation.invitationId]);
  const late = await anon()('POST', '/api/v2/invitations/redeem', { code: inv.json.invitation.code });
  assert.equal(late.status, 410);
  assert.equal(late.json.error, 'INVITATION_EXPIRED');
  // 已兑换身份（CT2）：邀请行置为过期后，投影仍可上传、写门仍放行 —— 投影未自造"邀请过期"新政策
  await k.pool.query(`UPDATE customer_invitations SET expires_at = now() - interval '1 hour' WHERE invitation_id=$1`, [ct2.invitationId]);
  const p = await proj(ct2.credential, C2, { kind: 'photo' });
  assert.equal(p.json.ok, true, '投影不得比写门更严（现有写门只以撤权为活控制）');
  const w = await regArtifact(ct2.credential, C2, 'photo', T1);
  assert.equal(w.status, 200, '读写一致：写门同样放行');
});

test('撤权：内部 grant 行删除 → 投影拒+写门404；联系人级联停用 → 双侧403；拒绝后零写入', async () => {
  // ① carl 的 grant 删除（撤权即刻生效）
  const rv = await authed()('DELETE', `/api/v2/customers/${C1}/grants/carl`, {});
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  const p1 = await proj(TOK.clerk, C1, { kind: 'invoice' });
  assert.equal(p1.json.ok, false);
  assert.equal(p1.json.reason, 'CUSTOMER_SCOPE_VIOLATION');
  assert.equal(p1.json.tenantId, null);
  const w1 = await regArtifact(TOK.clerk, C1, 'invoice', T1);
  assert.equal(w1.status, 404, '写门 requireCustomerScope → NOT_FOUND（A10 不区分语义）');
  assert.equal(w1.json.error, 'NOT_FOUND');
  // ② 联系人 CI1 撤权 → customer_identities 停用 → 凭据本身失效
  const rv2 = await authed()('DELETE', `/api/v2/customers/${C1}/grants/${ci1Id}`, {});
  assert.equal(rv2.status, 200);
  const p2 = await proj(ct1.credential, C1, { kind: 'invoice' });
  assert.equal(p2.status, 403);
  assert.equal(p2.json.error, 'PRINCIPAL_UNTRUSTED');
  const w2 = await regArtifact(ct1.credential, C1, 'invoice', T1);
  assert.equal(w2.status, 403);
  // 拒绝后写入零发生（对照撤权前的既成事实数）
  const n = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  assert.ok(n >= 1, '撤权前正例已登记');
  const again = await regArtifact(ct1.credential, C1, 'invoice', T1);
  assert.equal(again.status, 403);
  const n2 = (await k.pool.query('SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE customer_id=$1', [C1])).rows[0].n;
  assert.equal(n2, n, '撤权后重复上传零写入');
});

test('零副作用：GET 矩阵前后全库逐表快照逐字节一致（含审计/幂等/邀请/身份/工件表）', async () => {
  const before = await dbSnapshot(k.pool);
  const gets = [
    proj(TOK.biz, C1, { kind: 'invoice' }),                 // 200 OK
    proj(TOK.biz, C1),                                      // 200 OK 无 kind
    proj(ct2.credential, C2, { kind: 'photo' }),            // 200 OK
    proj(ct2.credential, C2, { kind: 'tax_record' }),       // 200 KIND_NOT_ALLOWED
    proj(svc.credential, C1, { kind: 'invoice' }),          // 200 NOT_HUMAN
    proj(ct1.credential, C1),                               // 403（已撤权凭据）
    proj(null, C1),                                         // 403 无会话
    proj('forged-abc', C1),                                 // 403 伪造
    proj(TOK.biz, C1, { principalId: 'someone-else' }),     // 200 PRINCIPAL_MISMATCH
    proj(TOK.biz, 'cust-missing'),                          // 200 CUSTOMER_NOT_FOUND
    proj(TOK.other, C1),                                    // 200 跨租户拒绝
    proj(TOK.biz, C1, { kind: '' }),                        // 400 kind 非法
  ];
  const results = await Promise.all(gets);
  const after = await dbSnapshot(k.pool);
  assert.deepEqual(after, before, '读矩阵改变数据库状态（违反零副作用）');
  for (const t of ['audit_events', 'outbox_events', 'v2_idempotency', 'idempotency', 'customer_invitations', 'customer_identities', 'evidence_artifacts']) {
    assert.ok(t in before, `快照应包含 ${t}`);
  }
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 403, 403, 403, 200, 200, 200, 400], '矩阵状态码符合契约 §2');
});

test('响应不含秘密字段（凭据/哈希/邀请码/token/provider）', async () => {
  const samples = [
    await proj(TOK.biz, C1, { kind: 'invoice' }),
    await proj(ct2.credential, C2, { kind: 'photo' }),
    await proj(svc.credential, C1),
  ];
  const banned = ['credential', 'sha256', 'code', 'token', 'secret', 'provideruserid'];
  for (const r of samples) {
    const text = JSON.stringify(r.json).toLowerCase();
    for (const b of banned) assert.ok(!text.includes(b), `响应含敏感字段名：${b}`);
    assert.ok(!text.includes(ct2.credential.toLowerCase()));
  }
});
