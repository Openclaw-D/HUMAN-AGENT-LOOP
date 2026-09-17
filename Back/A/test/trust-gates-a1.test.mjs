// 任务01·A1 提交边界测试：权限与幂等绕行关闭（审核 F01；验收 K01–K04 + v1 读口/回执/事件）。
// 必须先失败（RED）后通过（GREEN）：不以原作者绿色取代反例。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startKernel, client, TOKENS, sleep } from './utils.mjs';

// 客户级授权模型：customers='grant' → 仅 principal_customer_grants 内客户可见（缺省 'all' 保持旧行为）。
const SPEC_A1 = [
  `${TOKENS.admin}=alice:human:admin:all:all:all`,
  'tok-biz-a=boba:human:business:all:all:grant',
  'tok-biz-b=bobb:human:business:all:all:grant',
  'tok-credit-a=cindy:human:credit:all:all:grant',
  'tok-approver-a=carol:human:approver:all:all:grant',
  'tok-cust-role=chun:human:customer:all:all:grant',
  'tok-agent-a=worker1:agent:business:all:all:grant',
  'tok-svc-a=svca:service:policy+credit+commerce+asset:all:all:grant',
].join(',');

let k;
const admin = () => client(k.base, TOKENS.admin);
const bizA = () => client(k.base, 'tok-biz-a');
const bizB = () => client(k.base, 'tok-biz-b');
const creditA = () => client(k.base, 'tok-credit-a');
const approverA = () => client(k.base, 'tok-approver-a');
const custRole = () => client(k.base, 'tok-cust-role');
const agentA = () => client(k.base, 'tok-agent-a');
const anon = () => client(k.base, null);

let tenantId, custA, custB, projectId, sessionId;

async function mkCustomer(c, name) {
  const r = await admin()('POST', '/api/v2/customers', {
    requestId: `mk-${name}-${Date.now()}`, tenantId: 't1', legalEntityRef: `LE-${name}`, displayName: `客户${name}`,
  });
  assert.equal(r.status, 200, `建档 ${name}: ${JSON.stringify(r.json)}`);
  return r.json.customerId;
}
async function grant(c, customerId) {
  const r = await admin()('POST', `/api/v2/customers/${customerId}/grants`, {
    requestId: `grant-${customerId}-${Math.random()}`, tenantId: 't1', principalId: principalOf(c),
  });
  assert.equal(r.status, 200, `授权: ${JSON.stringify(r.json)}`);
}
function principalOf(c) {
  return { 'tok-biz-a': 'boba', 'tok-biz-b': 'bobb', 'tok-credit-a': 'cindy', 'tok-approver-a': 'carol', 'tok-cust-role': 'chun', 'tok-agent-a': 'worker1', 'tok-svc-a': 'svca' }[c];
}

before(async () => {
  k = await startKernel({
    principalSpec: SPEC_A1,
    extraArgs: ['--credit-matrix', 'm1', '--credit-concentration', 'c1', '--allow-legacy-basis', '--required-domains-policy', 'p1'],
  });
  const pd = k.pool;
  await pd.query(`INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
    ('m1','approver','facility.approve',true,1000000000),
    ('m1','approver','facility.activate',true,1000000000),
    ('m1','business','fr.confirm-external',true,NULL)`);
  await pd.query(`INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
    ('p1','policy',true),('p1','credit',true),('p1','commerce',true),('p1','asset',true)
    ON CONFLICT DO NOTHING`);
  tenantId = 't1';
  custA = await mkCustomer(null, 'A');
  custB = await mkCustomer(null, 'B');
  for (const c of ['tok-biz-a', 'tok-credit-a', 'tok-approver-a', 'tok-cust-role', 'tok-agent-a', 'tok-svc-a']) await grant(c, custA);
  await grant('tok-biz-b', custB);
  const tpl = await admin()('POST', '/api/v1/templates', {
    requestId: `tpl-${Date.now()}`, name: 'tpl-a1',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }, { roleKey: 'customer', title: '客户', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200);
  const proj = await admin()('POST', '/api/v1/projects', { requestId: `proj-${Date.now()}`, templateId: tpl.json.templateId, name: 'proj-a1' });
  assert.equal(proj.status, 200);
  projectId = proj.json.projectId;
  const sess = await bizA()('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: `sess-${Date.now()}`, customerId: custA, title: 'A1 会话',
    roles: [{ roleKey: 'business', kind: 'human' }, { roleKey: 'customer', kind: 'human' }],
    ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验一', required: true, responsibleRole: 'business', targetRole: 'customer', requiresHumanVerification: true, expectedEvidenceKinds: ['doc'] }],
  });
  assert.equal(sess.status, 200, `建会话: ${JSON.stringify(sess.json)}`);
  sessionId = sess.json.sessionId;
});

after(async () => { if (k) await k.stop(); });

// ---------- K01 匿名/越权 GET 检查面 ----------
test('K01: 匿名 GET 检查会话/next-actions/summary → 403，不返回内容', async () => {
  for (const path of [
    `/api/v1/inspections/${sessionId}`,
    `/api/v1/inspections/${sessionId}/next-actions`,
    `/api/v1/inspections/${sessionId}/summary`,
  ]) {
    const r = await anon()('GET', path);
    assert.equal(r.status, 403, `${path} 匿名应 403，实际 ${r.status}`);
    assert.match(String(r.json?.error ?? ''), /PRINCIPAL_UNTRUSTED/);
  }
});

test('K01: 已验证但非名册/未授权 principal → 404 不泄露存在性；名册可读', async () => {
  const r1 = await bizB()('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(r1.status, 404, `非名册跨会话读应 404，实际 ${r1.status}`);
  const r2 = await bizB()('GET', `/api/v1/inspections/${sessionId}/next-actions`);
  assert.equal(r2.status, 404);
  const r3 = await bizA()('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(r3.status, 200);
  assert.equal(r3.json.snapshot.sessionId, sessionId);
  const r4 = await custRole()('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(r4.status, 200, '名册内客户角色可读会话快照');
});

test('K01: v1 项目/事件/回执读口不再匿名', async () => {
  const p1 = await anon()('GET', `/api/v1/projects/${projectId}`);
  assert.equal(p1.status, 403);
  const p2 = await anon()('GET', '/api/v1/events?after=0&limit=100');
  assert.equal(p2.status, 403);
  // 客户级事件隔离：cust-role 只授权 custA，事件流不得出现 custB
  const ev = await custRole()('GET', '/api/v1/events?after=0&limit=500');
  assert.equal(ev.status, 200);
  const leaked = (ev.json.events ?? []).filter((e) => e.customerId === custB);
  assert.equal(leaked.length, 0, '未授权客户的事件不得出现在事件流');
});

// ---------- K02 幂等不借缓存绕权 ----------
async function buildFacilityChain() {
  const art = await creditA()('POST', `/api/v2/customers/${custA}/artifacts`, {
    requestId: `art-${Date.now()}`, tenantId, kind: 'invoice', factKey: 'price', content: { amount: 1 }, grade: 'unverified',
  });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  const ass = await creditA()('POST', `/api/v2/customers/${custA}/assessments`, {
    requestId: `ass-${Date.now()}`, tenantId, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const cand = await creditA()('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: `cand-${Date.now()}`, tenantId, candidate: { tendency: 'do', supportableAmountMinor: 100000, producedBy: 'test' },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const rev = await creditA()('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev-${Date.now()}`, tenantId });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const prop = await creditA()('POST', `/api/v2/customers/${custA}/facilities`, {
    requestId: `prop-${Date.now()}`, tenantId, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: 100000, currency: 'CNY',
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  const apr = await approverA()('POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, { requestId: `apr-${Date.now()}`, tenantId, rationale: 'ok' });
  assert.equal(apr.status, 200, JSON.stringify(apr.json));
  const act = await approverA()('POST', `/api/v2/facilities/${prop.json.facilityId}/activate`, { requestId: `act-${Date.now()}`, tenantId, rationale: 'ok' });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  return prop.json.facilityId;
}

test('K02: 同 requestId 跨 principal 重放不产生第二次业务效果；撤权后重放不借缓存', async () => {
  const facilityId = await buildFacilityChain();
  const fr = await bizA()('POST', `/api/v2/customers/${custA}/financing-requests`, {
    requestId: `fr-${Date.now()}`, tenantId, facilityId, productType: 'direct_lease', amountMinor: 60000, currency: 'CNY',
    equipmentRefs: ['eq-1'], contractRefs: ['ct-1'],
  });
  assert.equal(fr.status, 200, JSON.stringify(fr.json));
  const frId = fr.json.frId;
  const reqId = `k02-reserve-${Date.now()}`;
  const frame = { requestId: reqId, tenantId };
  const r1 = await bizA()('POST', `/api/v2/financing-requests/${frId}/reserve`, frame);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const r2 = await bizA()('POST', `/api/v2/financing-requests/${frId}/reserve`, frame);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.replayed, true, '同主体同载荷重放返回原回执');
  let cnt = await k.pool.query(`SELECT COUNT(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [frId]);
  assert.equal(cnt.rows[0].n, 1, '同申请只允许一次预占账目');
  // 跨 principal 同 requestId：不得命中他人缓存，也不得二次执行
  const r3 = await creditA()('POST', `/api/v2/financing-requests/${frId}/reserve`, frame);
  assert.notEqual(r3.status, 200, `跨主体重放不得成功：${JSON.stringify(r3.json)}`);
  cnt = await k.pool.query(`SELECT COUNT(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [frId]);
  assert.equal(cnt.rows[0].n, 1);
  // 撤权（删除授权）后原主体重放：不得借缓存绕权
  try {
    await k.pool.query(`DELETE FROM principal_customer_grants WHERE principal_id=$1 AND customer_id=$2`, ['boba', custA]);
    const r4 = await bizA()('POST', `/api/v2/financing-requests/${frId}/reserve`, frame);
    assert.equal(r4.status, 404, `撤权后重放应 404，实际 ${r4.status}`);
    cnt = await k.pool.query(`SELECT COUNT(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [frId]);
    assert.equal(cnt.rows[0].n, 1);
  } finally {
    // 恢复授权，供后续用例使用
    await k.pool.query(
      `INSERT INTO principal_customer_grants (tenant_id, principal_id, customer_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tenantId, 'boba', custA],
    );
  }
});

test('K02b: 检查会话命令幂等键绑定主体：跨主体同 requestId → REQUEST_MISMATCH', async () => {
  const reqId = `k02b-plan-${Date.now()}`;
  const frame = { requestId: reqId, planSnapshot: { note: 'v1' }, items: [{ itemKey: 'it2', title: '增补', responsibleRole: 'business', targetRole: 'customer', expectedEvidenceKinds: ['doc2'] }] };
  const c1 = await bizA()('POST', `/api/v1/inspections/${sessionId}/plan`, frame);
  assert.equal(c1.status, 200, JSON.stringify(c1.json));
  const c2 = await bizB()('POST', `/api/v1/inspections/${sessionId}/plan`, frame);
  assert.equal(c2.status, 409, `跨主体重放应 409，实际 ${c2.status}`);
  assert.match(String(c2.json?.error ?? ''), /REQUEST_MISMATCH/);
});

// ---------- K03 同租户跨客户隔离 ----------
test('K03: 同租户客户甲 principal 访问客户乙 package/事件/对象/exposure → 一律 404 且不泄字段', async () => {
  const paths = [
    `/api/v2/customers/${custB}`,
    `/api/v2/customers/${custB}/artifacts`,
    `/api/v2/customers/${custB}/events?after=0&limit=10`,
    `/api/v2/customers/${custB}/exposure`,
    `/api/v2/customers/${custB}/decision-status`,
    `/api/v2/customers/${custB}/findings`,
  ];
  for (const p of paths) {
    const r = await bizA()('GET', p);
    assert.equal(r.status, 404, `${p} 应 404，实际 ${r.status} ${JSON.stringify(r.json)}`);
    const body = JSON.stringify(r.json);
    assert.ok(!body.includes(custB), '响应体不得回显目标客户 ID');
  }
  // 反向：只有乙授权的 biz2 访问甲 → 404
  const rev = await bizB()('GET', `/api/v2/customers/${custA}`);
  assert.equal(rev.status, 404);
  // 匿名 v2 读 → 403
  const an = await anon()('GET', `/api/v2/customers/${custA}`);
  assert.equal(an.status, 403);
});

// ---------- K04 客户自报/越域写不提升等级或权限 ----------
test('K04: 客户角色上传 grade=confirmed → 403；agent 登记其他域结果 → 403', async () => {
  const up = await custRole()('POST', `/api/v2/customers/${custA}/artifacts`, {
    requestId: `cust-art-${Date.now()}`, tenantId, kind: 'statement', content: { say: 'confirmed' }, grade: 'confirmed',
  });
  assert.equal(up.status, 403, `客户角色自报 confirmed 应 403，实际 ${up.status}`);
  // 客户角色上传不声明 grade → 允许，但恒为 unverified（声明性材料）
  const up2 = await custRole()('POST', `/api/v2/customers/${custA}/artifacts`, {
    requestId: `cust-art2-${Date.now()}`, tenantId, kind: 'statement', content: { say: 'hello' },
  });
  assert.equal(up2.status, 200, JSON.stringify(up2.json));
  assert.equal(up2.json.grade ?? 'unverified', 'unverified', '客户上传默认 unverified');
  // agent（roles=business）登记 credit 域结果：需要对应域角色 → 403（域角色校验先于运行登记查询）
  await admin()('POST', '/api/v2/rule-pack-versions/activate', { requestId: `rp-k04-${Date.now()}`, tenantId, version: 'rp1' });
  const gr = await client(k.base, 'tok-svc-a')('POST', `/api/v2/customers/${custA}/rule-gate-receipts`, {
    requestId: `gr-k04-${Date.now()}`, tenantId, result: 'CLEAR', rulesetVersion: 'rp1',
  });
  assert.equal(gr.status, 200, JSON.stringify(gr.json));
  const pkg = await bizA()('POST', `/api/v2/customers/${custA}/decision-packages`, {
    requestId: `pkg-k04-${Date.now()}`, tenantId, gateReceiptId: gr.json.receiptId,
    inspectionRevision: { sessionId }, // A1 会话收口 open → 包为 draft（本用例只用于域角色拒绝路径）
    domainDeps: [{ domain: 'credit', artifactIds: [], factKeys: [], rulePackVersion: 'rp1' }],
  });
  assert.equal(pkg.status, 200, JSON.stringify(pkg.json));
  const dr = await agentA()('POST', `/api/v2/decision-packages/${pkg.json.packageId}/domain-results`, {
    requestId: `dr-k04-${Date.now()}`, tenantId, domain: 'credit',
    analysisRun: { runId: 'run-x', inputHash: 'h', inputWatermark: 'w', rulesetVersion: 'rp1', executionStatus: 'completed' },
    opinion: { tendency: 'do' }, deps: { artifactIds: [], factKeys: [] },
  });
  assert.equal(dr.status, 403, `agent 无 credit 域角色应 403，实际 ${dr.status} ${JSON.stringify(dr.json)}`);
});
