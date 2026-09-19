// §11.1/§11.2（2026-09-19 路B=任务01）验收：交付运行时服务身份（DEF-G04N-04 A 侧）+ 工件单件读回（IR-03-3）。
// W1 签发与鉴权（admin 人类专用/明文一次/列表无凭据） W2 停用即刻失效+重放不借缓存+跨租户 404
// W3 页面消费链冒烟（svc Gate 回执 → human 冻结包 → 提案带 packageId 不再 409；无包仍 409 门不变）
// C1 信封 v0 读回投影 C2 非信封件 content 原样 C3 越权面（cit_*/匿名/跨客户/不存在） C4 被取代件可读。
// 运行：cd Back/A && JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres' node --test test/service-identity-artifact-content.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const T2 = 't2';
const POLICY_VERSION = 'domreq-si-1';
const PACK_V1 = 'sim-pack-si-1';

// 关键设定：合成目录**不含** service 主体——复现交付运行时形态（DEF-G04N-04 前提）。
const SPEC = [
  'tok-root=root:human:admin:all:all:all',
  'tok-biz=bob:human:business:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-policy=paul:human:policy:all:t1',
  'tok-ag=wrk:agent:business:all:t1',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const biz = (k) => client(k.base, 'tok-biz');
const credit = (k) => client(k.base, 'tok-credit');
const policy = (k) => client(k.base, 'tok-policy');
const ag = (k) => client(k.base, 'tok-ag');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const k = await startKernel({ principalSpec: SPEC, extraArgs: ['--required-domains-policy', POLICY_VERSION] });
test.after(async () => { await k.stop(); });

beforeAllPolicies();
async function beforeAllPolicies() {
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
       ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
     ON CONFLICT DO NOTHING`, [POLICY_VERSION]);
}

let seq = 0;
async function mkCustomer(name, tenantId = T1) {
  seq += 1;
  const r = await root(k)('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId, legalEntityRef: `LE-SI-${Date.now()}-${seq}`, displayName: name,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function registerArtifact(c, customerId, kind, content, extra = {}) {
  const r = await c('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind, content, ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.artifactId;
}

test('W1 服务身份签发：admin 人类专用；凭据明文仅一次；svc 凭据可达 service 专用写口', async () => {
  const c1 = await mkCustomer('服务身份签发客户');

  // 非 admin 人类 / agent 一律 403
  const bizR = await biz(k)('POST', '/api/v2/service-identities', { requestId: rid('si'), tenantId: T1, displayName: 'x' });
  assert.equal(bizR.status, 403, JSON.stringify(bizR.json));
  const agR = await ag(k)('POST', '/api/v2/service-identities', { requestId: rid('si'), tenantId: T1, displayName: 'x' });
  assert.equal(agR.status, 403, JSON.stringify(agR.json));

  // admin 签发：svc_ 前缀明文、principalId svc-*（requestId 暂存供 W2 幂等重放断言）
  const siReqId = rid('si');
  const cr = await root(k)('POST', '/api/v2/service-identities', {
    requestId: siReqId, tenantId: T1, displayName: 'connectors-engine',
  });
  assert.equal(cr.status, 200, JSON.stringify(cr.json));
  assert.ok(cr.json.principalId.startsWith('svc-'), `principalId 形如 svc-*：${cr.json.principalId}`);
  assert.ok(cr.json.credential.startsWith('svc_'), '凭据 svc_ 前缀');
  assert.equal(cr.json.tenantId, T1);
  assert.equal(cr.json.status, 'active');
  const svcCred = cr.json.credential;
  const svcPrincipal = cr.json.principalId;
  const svc = client(k.base, svcCred);

  // 列表：admin 可见且无凭据派生字段；非 admin 403
  const list = await root(k)('GET', '/api/v2/service-identities');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const row = list.json.identities.find((x) => x.principalId === svcPrincipal);
  assert.ok(row, '列表包含新签发身份');
  assert.equal(row.credential, undefined, '列表不泄露凭据');
  assert.equal(row.credentialSha256, undefined, '列表不泄露凭据哈希');
  const bizList = await biz(k)('GET', '/api/v2/service-identities');
  assert.equal(bizList.status, 403, JSON.stringify(bizList.json));

  // svc 凭据真实可达 service 专用写口（交付形态此前不可达的核心点）
  const artId = await registerArtifact(biz(k), c1, 'bank_statement', { source: 'si-w1' });
  const proc = await svc('POST', `/api/v2/customers/${c1}/artifacts/${artId}/processing`, {
    requestId: rid('proc'), tenantId: T1, stage: 'received', runRef: 'si-w1-run1',
  });
  assert.equal(proc.status, 200, `svc 处理状态写口: ${JSON.stringify(proc.json)}`);

  // 规则版本激活（policy 人类）后 svc 可登记 Gate 回执
  const act = await policy(k)('POST', '/api/v2/rule-pack-versions/activate', {
    requestId: rid('rp'), tenantId: T1, version: PACK_V1,
  });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  const gr = await svc('POST', `/api/v2/customers/${c1}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'NEEDS_EVIDENCE', rulesetVersion: PACK_V1,
  });
  assert.equal(gr.status, 200, `svc Gate 回执: ${JSON.stringify(gr.json)}`);

  globalThis.__siSvcCred = svcCred;
  globalThis.__siSvcPrincipal = svcPrincipal;
  globalThis.__siCustomer = c1;
  globalThis.__siReqId = siReqId;
});

test('W2 服务身份重放幂等/停用即刻失效/跨租户 404', async () => {
  const c1 = globalThis.__siCustomer;
  const svcPrincipal = globalThis.__siSvcPrincipal;
  const svcCred = globalThis.__siSvcCred;

  // 同 requestId 同载荷重放：原响应回执 + replayed:true（幂等创建，不重复签发）
  const createReplay = await root(k)('POST', '/api/v2/service-identities', {
    requestId: globalThis.__siReqId, tenantId: T1, displayName: 'connectors-engine',
  });
  assert.equal(createReplay.status, 200, JSON.stringify(createReplay.json));
  assert.equal(createReplay.json.replayed, true);
  assert.equal(createReplay.json.principalId, svcPrincipal, '重放返回原主体（不新签发）');

  // 跨租户 404：t2 租户身份经 t1 管理面不可见
  const t2mk = await root(k)('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId: T2, legalEntityRef: `LE-SI-T2-${Date.now()}`, displayName: 't2客户',
  });
  assert.equal(t2mk.status, 200, JSON.stringify(t2mk.json));
  const t2si = await root(k)('POST', '/api/v2/service-identities', { requestId: rid('si'), tenantId: T2, displayName: 't2-engine' });
  assert.equal(t2si.status, 200, JSON.stringify(t2si.json));
  const cross = await root(k)('POST', `/api/v2/service-identities/${t2si.json.principalId}/disable`, {
    requestId: rid('dis'), tenantId: T1,
  });
  assert.equal(cross.status, 404, JSON.stringify(cross.json));

  // 停用：非 admin 403；admin 停用 → 即刻不可认证；重复停用 409；未知 404
  const bizDis = await biz(k)('POST', `/api/v2/service-identities/${t2si.json.principalId}/disable`, {
    requestId: rid('dis'), tenantId: T2,
  });
  assert.equal(bizDis.status, 403, JSON.stringify(bizDis.json));
  const dis = await root(k)('POST', `/api/v2/service-identities/${t2si.json.principalId}/disable`, {
    requestId: rid('dis'), tenantId: T2,
  });
  assert.equal(dis.status, 200, JSON.stringify(dis.json));
  const t2svc = client(k.base, t2si.json.credential);
  const dead = await t2svc('GET', '/api/v2/my/materials');
  assert.equal(dead.status, 403, '停用后原凭据即刻不可认证');
  const dis2 = await root(k)('POST', `/api/v2/service-identities/${t2si.json.principalId}/disable`, {
    requestId: rid('dis2'), tenantId: T2,
  });
  assert.equal(dis2.status, 409);
  assert.equal(dis2.json.error, 'NOT_READY');
  const disUnknown = await root(k)('POST', '/api/v2/service-identities/svc-nonexistent/disable', {
    requestId: rid('dis'), tenantId: T1,
  });
  assert.equal(disUnknown.status, 404);

  // W1 签发的 svc 身份仍可用（隔离验证：只停了 t2 那枚）
  const svc = client(k.base, svcCred);
  const still = await svc('GET', `/api/v2/customers/${c1}/artifacts`);
  void svcPrincipal;
  assert.equal(still.status, 200, `未停用身份仍可用: ${JSON.stringify(still.json)}`);
});

test('W3 页面消费链冒烟：svc Gate 回执 → human 冻结包 → 提案带 packageId 通过 BASIS 门；无包仍 409', async () => {
  const c1 = await mkCustomer('页面消费链客户');
  const svc = client(k.base, globalThis.__siSvcCred);

  // 评估 → 候选 → 提交审阅（proposeFacility 的前置状态 awaiting_human_review）
  const ass = await credit(k)('POST', `/api/v2/customers/${c1}/assessments`, {
    requestId: rid('ass'), tenantId: T1, ruleVersion: PACK_V1, evidenceSnapshot: [],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const cand = await ag(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: rid('cand'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: 5_000_000_00, producedBy: 'si-test-runner', rationale: '链路冒烟' },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const rev = await credit(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, {
    requestId: rid('rev'), tenantId: T1,
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));

  // 无包提案：既有权威门语义不变 → 409 BASIS_PACKAGE_REQUIRED
  const noPkg = await credit(k)('POST', `/api/v2/customers/${c1}/facilities`, {
    requestId: rid('prop'), tenantId: T1, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: 5_000_000_00, currency: 'CNY',
  });
  assert.equal(noPkg.status, 409, JSON.stringify(noPkg.json));
  assert.equal(noPkg.json.error, 'BASIS_PACKAGE_REQUIRED');

  // svc Gate 回执（CLEAR）→ human（business）冻结依据包
  const gr = await svc('POST', `/api/v2/customers/${c1}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1,
  });
  assert.equal(gr.status, 200, `svc Gate 回执: ${JSON.stringify(gr.json)}`);
  const pkg = await biz(k)('POST', `/api/v2/customers/${c1}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1, gateReceiptId: gr.json.receiptId,
    candidate: { producedBy: 'si-chain', rationale: '链路冒烟冻结' },
  });
  assert.equal(pkg.status, 200, `冻结依据包: ${JSON.stringify(pkg.json)}`);
  assert.ok(pkg.json.packageId);

  // 提案显式携带 packageId：通过 BASIS 门（DEF-G04N-04 阻断点解除）
  const prop = await credit(k)('POST', `/api/v2/customers/${c1}/facilities`, {
    requestId: rid('prop2'), tenantId: T1, assessmentId: ass.json.assessmentId, packageId: pkg.json.packageId,
    approvedAmountMinor: 5_000_000_00, currency: 'CNY',
  });
  assert.equal(prop.status, 200, `提案带 packageId: ${JSON.stringify(prop.json)}`);
  assert.ok(prop.json.facilityId, '提案响应含 facilityId');
});

test('C1 信封 v0 单件读回：materialFile 投影 + 元数据', async () => {
  const c1 = await mkCustomer('读回信封客户');
  const envelope = {
    name: '营业执照.png', mime: 'image/png', size: 11, encoding: 'base64',
    data: Buffer.from('hello-bytes').toString('base64'),
  };
  const artId = await registerArtifact(biz(k), c1, 'material.license', { materialFile: envelope, source: 'edge-envelope' });
  const r = await biz(k)('GET', `/api/v2/customers/${c1}/artifacts/${artId}/content`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = r.json.artifact;
  assert.equal(a.artifactId, artId);
  assert.equal(a.customerId, c1);
  assert.equal(a.kind, 'material.license');
  assert.ok(a.sha256, 'sha256 在场');
  assert.equal(a.supersededBy, null);
  assert.deepEqual(a.materialFile, envelope, '信封 v0 原样投影');
});

test('C2 非信封件：materialFile=null，content 原样返回', async () => {
  const c1 = await mkCustomer('读回结构化客户');
  const content = { declaredRevenueMinor: 1234500, period: '2026-08', source: 'structured' };
  const artId = await registerArtifact(biz(k), c1, 'bank_statement', content);
  const r = await biz(k)('GET', `/api/v2/customers/${c1}/artifacts/${artId}/content`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.artifact.materialFile, null);
  assert.deepEqual(r.json.artifact.content, content);
});

test('C3 读回越权面：cit_* 403 / 匿名 403 / 跨客户与不存在 404', async () => {
  const c1 = await mkCustomer('读回越权甲');
  const c2 = await mkCustomer('读回越权乙');
  const artId = await registerArtifact(biz(k), c1, 'license', { source: 'c3' });

  // 客户联系人身份（cit_*）403（B13 口径：客户角色不授予内部读面）
  const inv = await biz(k)('POST', `/api/v2/customers/${c1}/invitations`, {
    requestId: rid('inv'), tenantId: T1, role: 'customer-owner', allowedKinds: ['license'],
  });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.json.invitation.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  const cit = client(k.base, red.json.credential);
  const citR = await cit('GET', `/api/v2/customers/${c1}/artifacts/${artId}/content`);
  assert.equal(citR.status, 403, JSON.stringify(citR.json));

  const anonR = await client(k.base, null)('GET', `/api/v2/customers/${c1}/artifacts/${artId}/content`);
  assert.equal(anonR.status, 403, JSON.stringify(anonR.json));

  // 路径客户 ≠ 工件归属客户 → 404（不泄露存在性）；未知 artifactId → 404
  const cross = await biz(k)('GET', `/api/v2/customers/${c2}/artifacts/${artId}/content`);
  assert.equal(cross.status, 404, JSON.stringify(cross.json));
  const missing = await biz(k)('GET', `/api/v2/customers/${c1}/artifacts/art-nonexistent/content`);
  assert.equal(missing.status, 404);
});

test('C4 被取代件可读：supersededBy 如实携带（历史可审计）', async () => {
  const c1 = await mkCustomer('读回取代客户');
  const oldId = await registerArtifact(biz(k), c1, 'ledger_book', { source: 'c4', v: 1 });
  const newId = await registerArtifact(biz(k), c1, 'ledger_book', { source: 'c4', v: 2 }, { supersedes: oldId });
  const oldR = await biz(k)('GET', `/api/v2/customers/${c1}/artifacts/${oldId}/content`);
  assert.equal(oldR.status, 200, JSON.stringify(oldR.json));
  assert.equal(oldR.json.artifact.supersededBy, newId);
  const newR = await biz(k)('GET', `/api/v2/customers/${c1}/artifacts/${newId}/content`);
  assert.equal(newR.status, 200);
  assert.equal(newR.json.artifact.supersededBy, null);
});
