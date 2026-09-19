// goal-01（四任务产品交付轮）· v2.4 验收：受限邀请 / 客户联系人身份 / 客户目录 / 材料处理状态。
// 契约：docs/product-delivery/goal-01/DESIGN.md、CONTRACT §11。
// V1 目录（grants 过滤/搜索/游标分页/匿名拒绝） V2 邀请生命周期（兑换恰一次/过期/撤销/requestId 对账）
// V3 撤权级联禁用身份+重放不借缓存 V4 邀请授予面（材料种类服务端强制/核验等级）
// V5 my/materials 获准披露白名单 V6 处理状态（service 专用/runRef 内单调/新尝试/失败须给下一动作）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';

const SPEC = [
  'tok-root=root:human:admin:all:all:all',
  'tok-biz=bob:human:business:all:t1',
  'tok-ag=wrk:agent:business:all:t1',
  'tok-svc=svc1:service:processing:all:t1',
  'tok-gb=gb:human:business:all:all:grant',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const biz = (k) => client(k.base, 'tok-biz');
const ag = (k) => client(k.base, 'tok-ag');
const svc = (k) => client(k.base, 'tok-svc');
const gb = (k) => client(k.base, 'tok-gb');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const k = await startKernel({ principalSpec: SPEC });
test.after(async () => { await k.stop(); });

let seq = 0;
async function mkCustomer(name) {
  seq += 1;
  const r = await root(k)('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId: T1,
    legalEntityRef: `LE-IDX-${Date.now()}-${seq}`, displayName: name,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function mkInvitation(c, customerId, role, kinds, extra = {}) {
  const r = await c('POST', `/api/v2/customers/${customerId}/invitations`, {
    requestId: rid('inv'), tenantId: T1, role, allowedKinds: kinds, ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.invitation;
}

async function registerArtifact(c, customerId, kind, extra = {}) {
  return c('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind,
    content: { source: 'invitations-directory.test', kind, seq: rid('s') }, ...extra,
  });
}

test('V1 客户目录：grants 过滤、搜索、游标分页、匿名拒绝', async () => {
  const c1 = await mkCustomer('目录甲公司');
  const c2 = await mkCustomer('目录乙公司');
  await mkCustomer('目录丙公司');

  const all = await root(k)('GET', '/api/v2/customers?search=' + encodeURIComponent('目录'));
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.json.customers.length, 3, JSON.stringify(all.json.customers));
  const names = all.json.customers.map((x) => x.displayName).sort();
  assert.deepEqual(names, ['目录丙公司', '目录乙公司', '目录甲公司']);

  // grant 模式内部身份只见获准客户
  const g = await root(k)('POST', `/api/v2/customers/${c1}/grants`, { requestId: rid('g'), tenantId: T1, principalId: 'gb' });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const gbView = await gb(k)('GET', '/api/v2/customers?search=' + encodeURIComponent('目录'));
  assert.equal(gbView.status, 200, JSON.stringify(gbView.json));
  assert.deepEqual(gbView.json.customers.map((x) => x.customerId), [c1]);

  // 搜索 + 游标分页（biz：t1 全量）
  const p1 = await biz(k)('GET', '/api/v2/customers?search=' + encodeURIComponent('目录') + '&limit=2');
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.equal(p1.json.customers.length, 2);
  assert.ok(p1.json.nextCursor, '应有下一页游标');
  const p2 = await biz(k)('GET', `/api/v2/customers?search=${encodeURIComponent('目录')}&limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  assert.equal(p2.status, 200, JSON.stringify(p2.json));
  assert.equal(p2.json.customers.length, 1);
  assert.equal(p2.json.nextCursor, null);
  const p1ids = p1.json.customers.map((x) => x.customerId);
  assert.ok(!p1ids.includes(p2.json.customers[0].customerId), '两页不重叠');

  // 边界：匿名 403；越权 limit/游标 400
  const anon = await client(k.base, null)('GET', '/api/v2/customers');
  assert.equal(anon.status, 403, JSON.stringify(anon.json));
  const badLimit = await biz(k)('GET', '/api/v2/customers?limit=0');
  assert.equal(badLimit.status, 400);
  const badCursor = await biz(k)('GET', '/api/v2/customers?cursor=%%%');
  assert.equal(badCursor.status, 400);
  void c2;
});

test('V2 邀请生命周期：创建/兑换恰一次/过期/撤销/requestId 对账；agent 不可创建', async () => {
  const ca = await mkCustomer('邀请生命周期客户');

  const inv = await mkInvitation(biz(k), ca, 'customer-owner', ['license', 'bank-statement'], { note: '首轮材料' });
  assert.ok(inv.code.length >= 32, '邀请码 ≥32 字符');
  assert.equal(inv.role, 'customer-owner');

  const list = await biz(k)('GET', `/api/v2/customers/${ca}/invitations`);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.equal(list.json.invitations[0].status, 'active');
  assert.equal(list.json.invitations[0].code, undefined, '列表不泄露邀请码');

  // agent（非人类）不可创建
  const agR = await ag(k)('POST', `/api/v2/customers/${ca}/invitations`, { requestId: rid('i'), tenantId: T1, role: 'customer-owner', allowedKinds: ['license'] });
  assert.equal(agR.status, 403, JSON.stringify(agR.json));

  // 未知码统一 404
  const bad = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: 'no-such-invitation-code-000' });
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error, 'INVITATION_NOT_FOUND');

  // 兑换（带 requestId 供对账）
  const rrid = rid('rdm');
  const ok1 = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code, requestId: rrid });
  assert.equal(ok1.status, 200, JSON.stringify(ok1.json));
  assert.ok(ok1.json.credential.startsWith('cit_'));
  assert.equal(ok1.json.customerId, ca);
  const credA = ok1.json.credential;
  const principalA = ok1.json.principalId;

  // 重复兑换 → 409；同 requestId 对账 → replayed（不重发凭据明文）
  const again = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'INVITATION_ALREADY_USED');
  const recon = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code, requestId: rrid });
  assert.equal(recon.status, 200, JSON.stringify(recon.json));
  assert.equal(recon.json.replayed, true);
  assert.equal(recon.json.principalId, principalA);
  assert.equal(recon.json.credential, undefined, '对账响应不再重发凭据');

  // 撤销 → 410；重复撤销 → 409
  const inv2 = await mkInvitation(biz(k), ca, 'customer-finance', ['financials']);
  const rv = await biz(k)('POST', `/api/v2/invitations/${inv2.invitationId}/revoke`, { requestId: rid('rv'), tenantId: T1 });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  const rvRedeem = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv2.code });
  assert.equal(rvRedeem.status, 410);
  assert.equal(rvRedeem.json.error, 'INVITATION_REVOKED');
  const rv2 = await biz(k)('POST', `/api/v2/invitations/${inv2.invitationId}/revoke`, { requestId: rid('rv2'), tenantId: T1 });
  assert.equal(rv2.status, 409);

  // 过期（白盒置过去时间）→ 410
  const inv3 = await mkInvitation(biz(k), ca, 'customer-plant', ['site-photo']);
  await k.pool.query(`UPDATE customer_invitations SET expires_at = now() - interval '1 hour' WHERE invitation_id=$1`, [inv3.invitationId]);
  const expRedeem = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv3.code });
  assert.equal(expRedeem.status, 410);
  assert.equal(expRedeem.json.error, 'INVITATION_EXPIRED');

  // grant 模式业务身份：获准客户可发邀请；未获准客户 404（不泄露存在性）
  const cb = await mkCustomer('邀请越权对照客户');
  const gcb = await root(k)('POST', `/api/v2/customers/${cb}/grants`, { requestId: rid('g'), tenantId: T1, principalId: 'gb' });
  assert.equal(gcb.status, 200, JSON.stringify(gcb.json));
  const gbOk = await gb(k)('POST', `/api/v2/customers/${cb}/invitations`, { requestId: rid('i'), tenantId: T1, role: 'customer-owner', allowedKinds: ['license'] });
  assert.equal(gbOk.status, 200, JSON.stringify(gbOk.json));
  const gbNo = await gb(k)('POST', `/api/v2/customers/${ca}/invitations`, { requestId: rid('i'), tenantId: T1, role: 'customer-owner', allowedKinds: ['license'] });
  assert.equal(gbNo.status, 404, JSON.stringify(gbNo.json));

  // 暴露给后续用例
  globalThis.__credA = credA;
});

test('V3 撤权级联：身份停用+重放不借缓存回执', async () => {
  const cb = await mkCustomer('撤权级联客户');
  const inv = await mkInvitation(biz(k), cb, 'customer-owner', ['license']);
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  const cred = red.json.credential;
  const principalId = red.json.principalId;
  const cust = client(k.base, cred);

  const rrid = rid('art-replay');
  const art1 = await cust('POST', `/api/v2/customers/${cb}/artifacts`, {
    requestId: rrid, tenantId: T1, kind: 'license', content: { source: 'v3' },
  });
  assert.equal(art1.status, 200, JSON.stringify(art1.json));

  // admin 撤销客户授权 → 身份级联停用
  const rv = await root(k)('DELETE', `/api/v2/customers/${cb}/grants/${principalId}`, { requestId: rid('rv'), tenantId: T1 });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));

  // 撤权后：同 requestId 重放不得借缓存（先鉴权后幂等）
  const replay = await cust('POST', `/api/v2/customers/${cb}/artifacts`, {
    requestId: rrid, tenantId: T1, kind: 'license', content: { source: 'v3' },
  });
  assert.equal(replay.status, 403, JSON.stringify(replay.json));

  // 身份已停用：my/materials 拒绝
  const mm = await cust('GET', '/api/v2/my/materials');
  assert.equal(mm.status, 403, JSON.stringify(mm.json));
});

test('V4 邀请授予面：材料种类服务端强制；核验等级不可自提', async () => {
  const ca = await mkCustomer('授予面客户');
  const inv = await mkInvitation(biz(k), ca, 'customer-owner', ['license', 'bank-statement']);
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  const cust = client(k.base, red.json.credential);

  const okKind = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('a'), tenantId: T1, kind: 'license', content: { source: 'v4' } });
  assert.equal(okKind.status, 200, JSON.stringify(okKind.json));

  // DEF-G04N-02：处理桥 `material.<kind>` 命名空间按剥离前缀比对（落库保持原样）
  const nsKind = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('ns'), tenantId: T1, kind: 'material.license', content: { source: 'v4-ns' } });
  assert.equal(nsKind.status, 200, JSON.stringify(nsKind.json));
  const lst = await biz(k)('GET', `/api/v2/customers/${ca}/artifacts`);
  const nsRow = lst.json.artifacts.find((a) => a.artifactId === nsKind.json.artifactId);
  assert.ok(nsRow, '登记成功且内部清单可见');
  assert.equal(nsRow.kind, 'material.license', '落库保持调用方原样');
  const nsNo = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('ns2'), tenantId: T1, kind: 'material.site-photo', content: { source: 'v4-ns' } });
  assert.equal(nsNo.status, 403, JSON.stringify(nsNo.json));

  const noKind = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('b'), tenantId: T1, kind: 'site-photo', content: { source: 'v4' } });
  assert.equal(noKind.status, 403, JSON.stringify(noKind.json));
  assert.equal(noKind.json.error, 'PERMISSION_DENIED');

  const gradeUp = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('c'), tenantId: T1, kind: 'license', grade: 'confirmed', content: { source: 'v4' } });
  assert.equal(gradeUp.status, 403, JSON.stringify(gradeUp.json));

  // 内部身份不受授予面限制
  const internal = await biz(k)('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('d'), tenantId: T1, kind: 'anything-internal', content: { source: 'v4' } });
  assert.equal(internal.status, 200, JSON.stringify(internal.json));
});

test('V5 my/materials：获准披露白名单；内部视图边界保持', async () => {
  const ca = await mkCustomer('获准披露客户');
  const inv = await mkInvitation(biz(k), ca, 'customer-finance', ['financials']);
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  const cust = client(k.base, red.json.credential);

  const art = await cust('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('a'), tenantId: T1, kind: 'financials', content: { source: 'v5' } });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  const artifactId = art.json.artifactId;

  const mm = await cust('GET', '/api/v2/my/materials');
  assert.equal(mm.status, 200, JSON.stringify(mm.json));
  assert.equal(mm.json.customerId, ca);
  const mine = mm.json.materials.find((m) => m.artifactId === artifactId);
  assert.ok(mine, '本人上传可见');
  assert.equal(mine.stage, 'registered', '未处理前如实显示 registered');
  assert.deepEqual(
    Object.keys(mine).sort(),
    ['artifactId', 'createdAt', 'duplicateOf', 'failureReason', 'kind', 'nextAction', 'stage'],
    '只暴露白名单字段',
  );

  // 服务身份推进状态 → 客户侧可见 parsed
  const pr = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, {
    requestId: rid('p'), tenantId: T1,
    stages: [{ stage: 'received', runRef: 'run-v5' }, { stage: 'parsed', runRef: 'run-v5' }],
  });
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  const mm2 = await cust('GET', '/api/v2/my/materials');
  const mine2 = mm2.json.materials.find((m) => m.artifactId === artifactId);
  assert.equal(mine2.stage, 'parsed');

  // 边界：内部身份不可用 my/materials；客户身份仍不可读内部证据清单（B13 保持）
  const bizMm = await biz(k)('GET', '/api/v2/my/materials');
  assert.equal(bizMm.status, 403, JSON.stringify(bizMm.json));
  const custList = await cust('GET', `/api/v2/customers/${ca}/artifacts`);
  assert.equal(custList.status, 403, JSON.stringify(custList.json));
});

test('V6 处理状态：service 专用、runRef 内单调、新尝试可重开、失败须给下一动作', async () => {
  const ca = await mkCustomer('处理状态客户');
  const art = await biz(k)('POST', `/api/v2/customers/${ca}/artifacts`, { requestId: rid('a'), tenantId: T1, kind: 'bank-statement', content: { source: 'v6' } });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  const artifactId = art.json.artifactId;

  // 非 service 身份一律 403（human 业务/客户联系人）
  const byBiz = await biz(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p'), tenantId: T1, stage: 'parsed', runRef: 'r0' });
  assert.equal(byBiz.status, 403, JSON.stringify(byBiz.json));

  // 单段与多段写入；runRef 内单调推进
  const s1 = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p1'), tenantId: T1, stage: 'received', runRef: 'run-1' });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  const s2 = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, {
    requestId: rid('p2'), tenantId: T1,
    stages: [{ stage: 'parsed', runRef: 'run-1' }, { stage: 'analyzed', runRef: 'run-1' }],
  });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  assert.equal(s2.json.current.stage, 'analyzed');

  // runRef 内回退/重复 → 409
  const reg = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p3'), tenantId: T1, stage: 'parsed', runRef: 'run-1' });
  assert.equal(reg.status, 409, JSON.stringify(reg.json));
  assert.equal(reg.json.error, 'PROCESSING_STAGE_REGRESSION');

  // 新 runRef = 新处理尝试，可从 parsed 重开
  const s3 = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p4'), tenantId: T1, stage: 'parsed', runRef: 'run-2' });
  assert.equal(s3.status, 200, JSON.stringify(s3.json));

  // failed 必须 explanation + nextAction
  const badFail = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p5'), tenantId: T1, stage: 'failed', runRef: 'run-2', failureReason: '坏行' });
  assert.equal(badFail.status, 400, JSON.stringify(badFail.json));
  const badNext = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, { requestId: rid('p6'), tenantId: T1, stage: 'failed', runRef: 'run-2', nextAction: 'x' });
  assert.equal(badNext.status, 400, JSON.stringify(badNext.json));
  const fail = await svc(k)('POST', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`, {
    requestId: rid('p7'), tenantId: T1, stage: 'failed', runRef: 'run-2',
    failureReason: '第3行金额无法解析', nextAction: '请重新上传更正后的流水或联系业务',
  });
  assert.equal(fail.status, 200, JSON.stringify(fail.json));

  // 内部读：current+history；未知材料 404
  const his = await biz(k)('GET', `/api/v2/customers/${ca}/artifacts/${artifactId}/processing`);
  assert.equal(his.status, 200, JSON.stringify(his.json));
  assert.equal(his.json.current.stage, 'failed');
  assert.equal(his.json.history.length, 5, JSON.stringify(his.json.history));
  const ghost = await biz(k)('GET', `/api/v2/customers/${ca}/artifacts/ghost-artifact/processing`);
  assert.equal(ghost.status, 404);
});
