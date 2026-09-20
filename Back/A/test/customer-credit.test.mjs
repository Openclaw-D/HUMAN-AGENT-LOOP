// 任务01 · 客户授信内核 A01–A24 集成测试（E1：隔离 PG + 真实 HTTP + 双客户端）。
// 运行前提：JW_A_ADMIN_DB_URL 指向本任务隔离容器（jw-cc-kernel-pg@15444）。
// 权限矩阵为合成开发矩阵（matrix-dev-synthetic-1），明确不是公司制度。
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, createTestDb, dropTestDb, newId, simpleTemplate, sleep, startKernel } from './utils.mjs';

const T1 = 't1';
const T2 = 't2';
const CAP = 1_000_000_000;          // 1,000 万元 = 1e9 分
const wan = (n) => n * 1_000_000;   // 万元 → 分

// v2 合成身份（第5段 = 租户范围；生产目录必须显式列出，'all' 仅测试目录）
const V2_SPEC = [
  'tok-root=root:human:admin:all:all',
  'tok-biz1=biz1:human:business:all:t1',
  'tok-biz3=biz3:human:business:all:t1',
  'tok-biz2=biz2:human:business:all:t2',
  'tok-cred1=cred1:human:credit:all:t1',
  'tok-app1=app1:human:approver:all:t1',
  'tok-agent1=agent1:agent:business:all:t1',
  'tok-jw=jianwei:human:jianwei:all:t1',
].join(',');

async function startCreditKernel(opts = {}) {
  const extra = ['--credit-matrix', 'matrix-dev-synthetic-1', '--credit-concentration', 'conc-dev-synthetic-1', '--allow-legacy-basis'];
  if (opts.groupCap !== undefined) extra.push('--credit-group-cap-minor', String(opts.groupCap));
  if (opts.dispatch) extra.push('--dispatch');
  return startKernel({ extraArgs: extra, principalSpec: V2_SPEC, keepDb: opts.keepDb ?? false, dbUrl: opts.dbUrl ?? null });
}

async function seedMatrix(pool) {
  // 合成开发矩阵：明确标注非公司制度；仅用于证明矩阵机制，生产矩阵须公司批准录入
  await pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
       ('matrix-dev-synthetic-1','approver','facility.approve',true,$1),
       ('matrix-dev-synthetic-1','approver','facility.activate',true,$1),
       ('matrix-dev-synthetic-1','approver','facility.suspend',true,NULL),
       ('matrix-dev-synthetic-1','approver','facility.reduce',true,NULL),
       ('matrix-dev-synthetic-1','business','fr.confirm-external',true,$1)
     ON CONFLICT (matrix_version, role, action) DO NOTHING`, [CAP]);
}

/** 标准链：客户 → 工件 → 评估 → 候选 → 待审 → 提案 → 批准 → 激活。 */
async function buildActiveFacility(k, { customerId, amountMinor, tenantId = T1, biz, cred, app, facilityOpts = {} }) {
  const art = await biz('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: newId('r'), tenantId, kind: 'customer_profile', factKey: 'profile',
    content: { rev: 1 }, grade: 'source_supported',
  });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  const ass = await cred('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: newId('r'), tenantId, ruleVersion: 'rules-dev-1',
    evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const assessmentId = ass.json.assessmentId;
  await submitCandidateApproved(k, { assessmentId, amountMinor, tenantId, cred });
  const prop = await cred('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: newId('r'), tenantId, assessmentId, approvedAmountMinor: amountMinor, currency: 'CNY', ...facilityOpts,
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  const facilityId = prop.json.facilityId;
  const ap = await app('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId, rationale: 'dev-matrix' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const ac = await app('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: newId('r'), tenantId, rationale: 'dev-matrix' });
  assert.equal(ac.status, 200, JSON.stringify(ac.json));
  return { facilityId, assessmentId };
}

async function submitCandidateApproved(_k, { assessmentId, amountMinor, tenantId, cred, by = null, extraCandidate = {} }) {
  const r = await cred('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
    requestId: newId('r'), tenantId,
    candidate: { tendency: 'do', supportableAmountMinor: amountMinor, currency: 'CNY', rationale: '', producedBy: 'test-harness', conditions: [], warnings: [], ...extraCandidate },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = await cred('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  return r.json;
}

async function makeCustomer(biz, tenantId = T1, ref = null) {
  const r = await biz('POST', '/api/v2/customers', {
    requestId: newId('r'), tenantId,
    legalEntityRef: ref ?? `USCC-${newId('e')}`,
    displayName: '合成金属加工有限公司',
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function makeFR(biz, customerId, facilityId, amountMinor, productType = 'direct_lease') {
  const r = await biz('POST', `/api/v2/customers/${customerId}/financing-requests`, {
    requestId: newId('r'), tenantId: T1, facilityId, productType, amountMinor, currency: 'CNY',
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.frId;
}

async function reserve(biz, frId, requestId = null) {
  return biz('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: requestId ?? newId('r'), tenantId: T1 });
}

// ---------------------------------------------------------------------------

test('A01 同一客户两个渠道创建申请：合并约束，新建项目不产生额度', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const biz3 = client(k.base, 'tok-biz3');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const root = client(k.base, 'tok-root');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: wan(500), biz: biz1, cred: cred1, app: app1 });

    // 渠道一（biz1）：预占 400 万；渠道二（biz3）：同时只有 100 万可用
    const frA = await makeFR(biz1, custId, facilityId, wan(400));
    const ra = await reserve(biz1, frA);
    assert.equal(ra.status, 200);
    const frB = await makeFR(biz3, custId, facilityId, wan(400));
    const rb = await reserve(biz3, frB);
    assert.equal(rb.status, 409);
    assert.equal(rb.json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');

    // 新建 v1 项目并走完目标（claim→complete→accept→decide），敞口必须纹丝不动
    const tpl = await root('POST', '/api/v1/templates', simpleTemplate('tpl-a01'));
    assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
    const proj = await biz1('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'a01-proj' });
    assert.equal(proj.status, 200);
    const pid = proj.json.projectId;
    await biz1('POST', `/api/v1/projects/${pid}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { v: 1 } });
    const g = await biz1('POST', `/api/v1/projects/${pid}/goals`, { requestId: newId('r'), goalKey: 'review' });
    const goalId = g.json.goal.goalId;
    await biz1('POST', `/api/v1/projects/${pid}/human-requests`, { requestId: newId('r'), kind: 'clarification', question: 'q', requestedRole: 'approver' });
    void goalId;

    const before = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    // 再建一个挂到同一客户的项目：同样不产生额度
    const proj2 = await biz1('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'a01-proj-2' });
    const pid2 = proj2.json.projectId;
    await biz1('POST', `/api/v2/customers/${custId}/financing-requests`, { requestId: newId('r'), facilityId, productType: 'direct_lease', amountMinor: wan(1), currency: 'CNY', projectId: pid2 });
    const after = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.deepEqual(after.json.totalsMinor, before.json.totalsMinor);
    assert.equal(after.json.totalsMinor.exposureNow, wan(400));
  } finally { await k.stop(); }
});

test('A02 同名不同企业不自动合并；同法定主体拒绝重复建档', async () => {
  const k = await startCreditKernel();
  try {
    const biz1 = client(k.base, 'tok-biz1');
    const sameName = '同名工业有限公司';
    const c1 = await biz1('POST', '/api/v2/customers', { requestId: newId('r'), tenantId: T1, legalEntityRef: 'USCC-AAA', displayName: sameName });
    const c2 = await biz1('POST', '/api/v2/customers', { requestId: newId('r'), tenantId: T1, legalEntityRef: 'USCC-BBB', displayName: sameName });
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
    assert.notEqual(c1.json.customerId, c2.json.customerId);
    const dup = await biz1('POST', '/api/v2/customers', { requestId: newId('r'), tenantId: T1, legalEntityRef: 'USCC-AAA', displayName: sameName });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, 'CUSTOMER_EXISTS');
    const g1 = await biz1('GET', `/api/v2/customers/${c1.json.customerId}`);
    const g2 = await biz1('GET', `/api/v2/customers/${c2.json.customerId}`);
    assert.equal(g1.json.customer.legalEntityRef, 'USCC-AAA');
    assert.equal(g2.json.customer.legalEntityRef, 'USCC-BBB');
  } finally { await k.stop(); }
});

test('A03 同一联系人代表两企业：联系人关联不导致企业合并', async () => {
  const k = await startCreditKernel();
  try {
    const biz1 = client(k.base, 'tok-biz1');
    const c1 = await makeCustomer(biz1, T1, 'USCC-C1');
    const c2 = await makeCustomer(biz1, T1, 'USCC-C2');
    const r1 = await biz1('POST', `/api/v2/customers/${c1}/relationships`, { requestId: newId('r'), tenantId: T1, type: 'contact', contactRef: 'wecom-wx-007' });
    const r2 = await biz1('POST', `/api/v2/customers/${c2}/relationships`, { requestId: newId('r'), tenantId: T1, type: 'contact', contactRef: 'wecom-wx-007' });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const g1 = await biz1('GET', `/api/v2/customers/${c1}`);
    const g2 = await biz1('GET', `/api/v2/customers/${c2}`);
    assert.equal(g1.json.customer.legalEntityRef, 'USCC-C1');
    assert.equal(g2.json.customer.legalEntityRef, 'USCC-C2');
    const rel1 = await biz1('GET', `/api/v2/customers/${c1}/relationships`);
    assert.equal(rel1.json.relationships.length, 1);
  } finally { await k.stop(); }
});

test('A04 重复提交100份同一材料：去重关联，不产生额外证明力或额度', async () => {
  const k = await startCreditKernel();
  try {
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const custId = await makeCustomer(biz1);
    const content = { invoiceNo: 'INV-1', amountMinor: wan(372) };
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const r = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
        requestId: newId('r'), tenantId: T1, kind: 'invoice', factKey: 'equipment_price', content, grade: 'confirmed',
      });
      assert.equal(r.status, 200);
      ids.push(r.json);
    }
    assert.equal(ids[0].duplicateOf, null);
    for (let i = 1; i < 100; i++) {
      assert.equal(ids[i].duplicateOf, ids[0].artifactId, `第${i + 1}份应关联首件`);
    }
    // 评估快照按工件去重：100 个 id 只计 1 件
    const ass = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1',
      evidenceSnapshot: ids.map((x) => ({ artifactId: x.artifactId })),
    });
    assert.equal(ass.status, 200);
    assert.equal(ass.json.snapshotCount, 1);
    const exp = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(exp.json.totalsMinor.exposureNow, 0);
  } finally { await k.stop(); }
});

test('A05 有利资料后新增不利证据：可降级/暂停，金额非单调', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: wan(500), biz: biz1, cred: cred1, app: app1 });

    // 不利证据 → 新评估给更低金额（服务器不保证单调增加）
    const bad = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'litigation', factKey: 'risk_event',
      content: { event: 'major_lawsuit' }, grade: 'confirmed',
    });
    assert.equal(bad.status, 200);
    const ass2 = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1',
      evidenceSnapshot: [{ artifactId: bad.json.artifactId }],
    });
    const cand2 = await cred1('POST', `/api/v2/assessments/${ass2.json.assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: { tendency: 'no_do', supportableAmountMinor: wan(50), currency: 'CNY', rationale: '重大诉讼', producedBy: 'test-harness', conditions: [], warnings: [] },
    });
    assert.equal(cand2.status, 200); // 低金额候选被正常接受：金额不随资料单调增加
    await cred1('POST', `/api/v2/assessments/${ass2.json.assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
    // 不利证据触发暂停（人类正式动作）
    const susp = await app1('POST', `/api/v2/facilities/${facilityId}/suspend`, { requestId: newId('r'), tenantId: T1, rationale: '重大诉讼风险' });
    assert.equal(susp.status, 200);
    const fr = await makeFR(biz1, custId, facilityId, wan(10));
    const r = await reserve(biz1, fr);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'FACILITY_NOT_ACTIVE');
  } finally { await k.stop(); }
});

test('A06 上限外加1分被拒；币种与单位明确；跨币种拒绝', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    // 纯提案阶段即被上限拦截（提案不拦，批准拦——正式效力在批准）
    const over = await buildProposal(k, { custId, cred1, biz1, amountMinor: CAP + 1 });
    const apOver = await app1('POST', `/api/v2/facilities/${over.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(apOver.status, 409);
    assert.equal(apOver.json.error, 'PRODUCT_CAP_EXCEEDED');
    assert.equal(apOver.json.currency, 'CNY');
    assert.ok(apOver.json.message.includes('分'));

    const usd = await buildProposal(k, { custId, cred1, biz1, amountMinor: wan(500), currency: 'USD' });
    const apUsd = await app1('POST', `/api/v2/facilities/${usd.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(apUsd.status, 409);
    assert.equal(apUsd.json.error, 'CURRENCY_MISMATCH');
  } finally { await k.stop(); }
});

async function buildProposal(k, { custId, cred1, biz1, amountMinor, currency = 'CNY' }) {
  const art = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
    requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { rev: 1 }, grade: 'source_supported',
  });
  const ass = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
    requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  await submitCandidateApproved(k, { assessmentId: ass.json.assessmentId, amountMinor, tenantId: T1, cred: cred1 });
  const prop = await cred1('POST', `/api/v2/customers/${custId}/facilities`, {
    requestId: newId('r'), tenantId: T1, assessmentId: ass.json.assessmentId, approvedAmountMinor: amountMinor, currency,
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  return { facilityId: prop.json.facilityId, assessmentId: ass.json.assessmentId };
}

test('A07 已用900万，并发预占两笔各80万：恰一笔成功，总额不超上限', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const biz3 = client(k.base, 'tok-biz3');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    // 已用 900 万（非循环：disburse 进入 outstanding）
    const fr1 = await makeFR(biz1, custId, facilityId, wan(900));
    await reserve(biz1, fr1);
    await biz1('POST', `/api/v2/financing-requests/${fr1}/commit`, { requestId: newId('r'), tenantId: T1 });
    await biz1('POST', `/api/v2/financing-requests/${fr1}/disburse`, { requestId: newId('r'), tenantId: T1 });
    // 并发两笔 80 万（两个独立客户端/渠道）
    const fr2 = await makeFR(biz1, custId, facilityId, wan(80));
    const fr3 = await makeFR(biz3, custId, facilityId, wan(80));
    const [r2, r3] = await Promise.all([reserve(biz1, fr2), reserve(biz3, fr3)]);
    const ok = [r2, r3].filter((x) => x.status === 200);
    const rejected = [r2, r3].filter((x) => x.status === 409);
    assert.equal(ok.length, 1, `应恰一笔成功：${JSON.stringify([r2.json, r3.json])}`);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');
    const exp = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(exp.json.totalsMinor.outstanding, wan(900));
    assert.equal(exp.json.totalsMinor.reserved, wan(80));
    assert.ok(exp.json.totalsMinor.exposureNow <= CAP);
  } finally { await k.stop(); }
});

test('A08 100次并发重复同 requestId：仅一条账目与一次业务效应', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const fr = await makeFR(biz1, custId, facilityId, wan(80));
    const rid = `rid-a08-${newId('x')}`;
    const reqBody = { requestId: rid, tenantId: T1 };
    const responses = await Promise.all(Array.from({ length: 100 }, () => biz1('POST', `/api/v2/financing-requests/${fr}/reserve`, { ...reqBody })));
    for (const r of responses) {
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    const entries = await k.pool.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [fr]);
    assert.equal(entries.rows[0].n, 1);
    const frRow = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [fr]);
    assert.equal(frRow.rows[0].status, 'reserved');
    const exp = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(exp.json.totalsMinor.reserved, wan(80));
  } finally { await k.stop(); }
});

test('A09 相同 requestId 不同金额：冲突且原数据零副作用', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const frA = await makeFR(biz1, custId, facilityId, wan(80));
    const rid = `rid-a09-${newId('x')}`;
    const ok = await reserve(biz1, frA, rid);
    assert.equal(ok.status, 200);
    const frB = await makeFR(biz1, custId, facilityId, wan(60));
    const clash = await reserve(biz1, frB, rid); // 同 requestId，不同资源/载荷
    assert.equal(clash.status, 409);
    assert.equal(clash.json.error, 'IDEMPOTENCY_REPLAY_CONFLICT');
    const frBRow = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [frB]);
    assert.equal(frBRow.rows[0].status, 'submitted'); // 零副作用
    const entries = await k.pool.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE request_id=$1`, [rid]);
    assert.equal(entries.rows[0].n, 1);
  } finally { await k.stop(); }
});

test('A10 跨租户猜客户ID/回执ID：读取、写入、事件、回执全部拒绝', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const biz2 = client(k.base, 'tok-biz2');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const fr = await makeFR(biz1, custId, facilityId, wan(80));
    const rid = `rid-a10-${newId('x')}`;
    await reserve(biz1, fr, rid);

    assert.equal((await biz2('GET', `/api/v2/customers/${custId}`)).status, 404);
    assert.equal((await biz2('POST', `/api/v2/customers/${custId}/artifacts`, { requestId: newId('r'), tenantId: T2, kind: 'x', content: {} })).status, 404);
    assert.equal((await biz2('GET', `/api/v2/customers/${custId}/exposure`)).status, 404);
    assert.equal((await biz2('GET', `/api/v2/customers/${custId}/events`)).status, 404);
    assert.equal((await biz2('GET', `/api/v2/facilities/${facilityId}`)).status, 404);
    assert.equal((await biz2('POST', `/api/v2/financing-requests/${fr}/reserve`, { requestId: newId('r'), tenantId: T2 })).status, 404);
    // 回执：他人猜 requestId 不可见
    const foreignReceipt = await biz2('GET', `/api/v2/receipts/${rid}`);
    assert.equal(foreignReceipt.status, 200);
    assert.equal(foreignReceipt.json.found, false);
    const ownReceipt = await biz1('GET', `/api/v2/receipts/${rid}`);
    assert.equal(ownReceipt.json.found, true);
    // 无凭据匿名同样拒绝
    const anon = client(k.base, null);
    assert.equal((await anon('GET', `/api/v2/customers/${custId}`)).status, 403);
  } finally { await k.stop(); }
});

test('A11 预占成功后响应丢失：重放返回原效应，不重复占用', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const fr = await makeFR(biz1, custId, facilityId, wan(80));
    const rid = `rid-a11-${newId('x')}`;
    const first = await reserve(biz1, fr, rid);
    assert.equal(first.status, 200);
    const replay = await reserve(biz1, fr, rid);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.replayed, true);
    assert.equal(replay.json.frId, first.json.frId);
    const entries = await k.pool.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE entry_type='reserve'`, []);
    assert.equal(entries.rows[0].n, 1);
    const exp = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(exp.json.totalsMinor.reserved, wan(80));
  } finally { await k.stop(); }
});

test('A12 模拟付款结果未知：不盲重发、不自动释放预占，须对账确认', async () => {
  const k = await startCreditKernel({ });
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, {
      customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1,
      facilityOpts: { reserveTtlSeconds: 1 }, // 预占1秒即过期；但 unknown 占用绝不过期
    });
    const fr = await makeFR(biz1, custId, facilityId, wan(80));
    await reserve(biz1, fr);
    await biz1('POST', `/api/v2/financing-requests/${fr}/commit`, { requestId: newId('r'), tenantId: T1 });
    const unk = await biz1('POST', `/api/v2/financing-requests/${fr}/disburse`, { requestId: newId('r'), tenantId: T1, simulationMode: 'unknown' });
    assert.equal(unk.status, 200);
    assert.equal(unk.json.status, 'disbursing_unknown');
    // 直接释放被拒绝
    const rel = await biz1('POST', `/api/v2/financing-requests/${fr}/release`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(rel.status, 409);
    assert.equal(rel.json.error, 'RESERVATION_IRREVERSIBLE_STATE');
    // 等待超过 TTL：unknown 占用不被自动清理（A12 核心）
    await sleep(1800);
    const buckets = await k.pool.query(
      `SELECT entry_type, count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 GROUP BY entry_type`, [fr]);
    const types = Object.fromEntries(buckets.rows.map((r) => [r.entry_type, r.n]));
    assert.equal(types['reserve_expire'] ?? 0, 0, 'unknown 占用不得自动过期');
    assert.equal(types['commit_cancel'] ?? 0, 0, 'unknown 占用不得自动取消');
    assert.equal(types['disburse'] ?? 0, 0, '结果未知不得产生出账账目');
    // 不盲重发：再次出账被状态门拒绝
    const again = await biz1('POST', `/api/v2/financing-requests/${fr}/disburse`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(again.status, 409);
    // 对账确认（矩阵授权）后恰好一笔出账
    const conf = await biz1('POST', `/api/v2/financing-requests/${fr}/confirm-external`, { requestId: newId('r'), tenantId: T1, outcome: 'confirmed', rationale: '银行回单已核' });
    assert.equal(conf.status, 200, JSON.stringify(conf.json));
    const after = await k.pool.query(
      `SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='disburse'`, [fr]);
    assert.equal(after.rows[0].n, 1);
  } finally { await k.stop(); }
});

test('A13 重复结算回调：幂等，不重复扣减', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const fr = await makeFR(biz1, custId, facilityId, wan(900));
    await reserve(biz1, fr);
    await biz1('POST', `/api/v2/financing-requests/${fr}/commit`, { requestId: newId('r'), tenantId: T1 });
    await biz1('POST', `/api/v2/financing-requests/${fr}/disburse`, { requestId: newId('r'), tenantId: T1 });
    const sid = `settle-${newId('x')}`;
    const s1 = await biz1('POST', `/api/v2/financing-requests/${fr}/settle`, { requestId: sid, tenantId: T1 });
    assert.equal(s1.status, 200);
    const s2 = await biz1('POST', `/api/v2/financing-requests/${fr}/settle`, { requestId: sid, tenantId: T1 }); // 重复回调
    assert.equal(s2.status, 200);
    assert.equal(s2.json.replayed, true);
    const s3 = await biz1('POST', `/api/v2/financing-requests/${fr}/settle`, { requestId: newId('r'), tenantId: T1 }); // 不同 requestId 再结算
    assert.equal(s3.status, 409);
    const entries = await k.pool.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='settle'`, [fr]);
    assert.equal(entries.rows[0].n, 1);
    const exp = await biz1('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(exp.json.exposure.outstandingMinor, 0);
    assert.equal(exp.json.exposure.lifetimeDisbursedMinor, wan(900));
  } finally { await k.stop(); }
});

test('A14 暂停与支用并发：提交点统一裁决，不绕过 Gate', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    for (let round = 0; round < 10; round++) {
      const fr = await makeFR(biz1, custId, facilityId, wan(10));
      // 预占与暂停并发：由客户/设施行锁在提交点串行裁决
      const [res, susp] = await Promise.all([
        reserve(biz1, fr),
        app1('POST', `/api/v2/facilities/${facilityId}/suspend`, { requestId: newId('r'), tenantId: T1, rationale: `round-${round}` }),
      ]);
      assert.equal(susp.status, 200);
      if (res.status === 200) {
        // 预占在暂停生效前成交：占用保留、历史不篡改，设施随后进入 suspended
        const frRow = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [fr]);
        assert.equal(frRow.rows[0].status, 'reserved');
      } else {
        assert.equal(res.json.error, 'FACILITY_NOT_ACTIVE', `round${round}: ${JSON.stringify(res.json)}`);
        const entries = await k.pool.query(`SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1`, [fr]);
        assert.equal(entries.rows[0].n, 0, '被拒预占不得留下账目');
      }
      const view = await biz1('GET', `/api/v2/facilities/${facilityId}`);
      assert.equal(view.json.exposure.availableForNewDrawMinor, 0, '暂停后新增支用可用额必须为 0');
      // 恢复 active 进入下一轮
      const re = await app1('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'next-round' });
      assert.equal(re.status, 200, JSON.stringify(re.json));
    }
  } finally { await k.stop(); }
});

test('A15 批准前依据更新：旧版本批准被拒或要求重新评估', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    // 先顺序负例：取代快照工件后（批准前），批准必须 STALE_BASIS
    const art0 = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { rev: 'a15-pre' }, grade: 'source_supported',
    });
    const ass0 = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art0.json.artifactId }],
    });
    await submitCandidateApproved(k, { assessmentId: ass0.json.assessmentId, amountMinor: wan(100), tenantId: T1, cred: cred1 });
    const prop0 = await cred1('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId: ass0.json.assessmentId, approvedAmountMinor: wan(100), currency: 'CNY',
    });
    await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile',
      content: { rev: 'a15-pre-corrected' }, grade: 'source_supported', supersedes: art0.json.artifactId,
    });
    const ap0 = await app1('POST', `/api/v2/facilities/${prop0.json.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'a15-seq' });
    assert.equal(ap0.status, 409);
    assert.equal(ap0.json.error, 'STALE_BASIS');
    void custId;
    const custId2 = await makeCustomer(biz1, T1);
    const art = await biz1('POST', `/api/v2/customers/${custId2}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { rev: 'a15' }, grade: 'source_supported',
    });
    const ass = await cred1('POST', `/api/v2/customers/${custId2}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    await submitCandidateApproved(k, { assessmentId: ass.json.assessmentId, amountMinor: wan(100), tenantId: T1, cred: cred1 });
    const prop = await cred1('POST', `/api/v2/customers/${custId2}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId: ass.json.assessmentId, approvedAmountMinor: wan(100), currency: 'CNY',
    });
    const facilityId = prop.json.facilityId;
    // 依据更新（取代唯一快照工件）与批准并发
    const [sup, ap] = await Promise.all([
      biz1('POST', `/api/v2/customers/${custId2}/artifacts`, {
        requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile',
        content: { rev: 'a15-corrected' }, grade: 'source_supported', supersedes: art.json.artifactId,
      }),
      app1('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'a15' }),
    ]);
    assert.equal(sup.status, 200);
    assert.ok([200, 409].includes(ap.status), `批准结果异常：${ap.status}`);
    if (ap.status === 409) {
      assert.equal(ap.json.error, 'STALE_BASIS');
    } else {
      // 批准在提交点先成交：依据随后被取代 → 评估必须可见 stale，后续激活仍被拦
      const act = await app1('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'a15' });
      assert.equal(act.status, 409);
      assert.equal(act.json.error, 'STALE_BASIS');
    }
    // 顺序负例：已取代的快照下，二次批准尝试一律 STALE_BASIS
    const ap2 = await app1('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'a15-2' });
    assert.equal(ap2.status, 409);
  } finally { await k.stop(); }
});

test('A16 降额低于存量敞口：保留敞口、显示超额、禁止新增支用', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    const fr = await makeFR(biz1, custId, facilityId, wan(900));
    await reserve(biz1, fr);
    await biz1('POST', `/api/v2/financing-requests/${fr}/commit`, { requestId: newId('r'), tenantId: T1 });
    await biz1('POST', `/api/v2/financing-requests/${fr}/disburse`, { requestId: newId('r'), tenantId: T1 });
    const red = await app1('POST', `/api/v2/facilities/${facilityId}/reduce`, { requestId: newId('r'), tenantId: T1, approvedAmountMinor: wan(500), rationale: '风险收敛' });
    assert.equal(red.status, 200, JSON.stringify(red.json));
    assert.equal(red.json.exposure.overLimit, true);
    const view = await biz1('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(view.json.exposure.overLimit, true);
    assert.equal(view.json.exposure.outstandingMinor, wan(900), '存量敞口不得被改写');
    assert.equal(view.json.facility.approvedAmountMinor, wan(500));
    assert.equal(view.json.exposure.availableForNewDrawMinor, 0);
    const fr2 = await makeFR(biz1, custId, facilityId, wan(10));
    const r2 = await reserve(biz1, fr2);
    assert.equal(r2.status, 409);
  } finally { await k.stop(); }
});

test('A17 非循环额度收到还款：不擅自恢复为可循环可用额度', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1, facilityOpts: { revolving: false } });
    const fr = await makeFR(biz1, custId, facilityId, wan(900));
    await reserve(biz1, fr);
    await biz1('POST', `/api/v2/financing-requests/${fr}/commit`, { requestId: newId('r'), tenantId: T1 });
    await biz1('POST', `/api/v2/financing-requests/${fr}/disburse`, { requestId: newId('r'), tenantId: T1 });
    await biz1('POST', `/api/v2/financing-requests/${fr}/settle`, { requestId: newId('r'), tenantId: T1 });
    const view = await biz1('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(view.json.exposure.outstandingMinor, 0);
    assert.equal(view.json.exposure.availableForNewDrawMinor, wan(100), '还款不得恢复非循环额度');
    const fr2 = await makeFR(biz1, custId, facilityId, wan(200));
    const r2 = await reserve(biz1, fr2);
    assert.equal(r2.status, 409);
    assert.equal(r2.json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');
  } finally { await k.stop(); }
});

test('A18 模型输出额度/批准字段：可为合法候选，但不能激活额度', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const agent1 = client(k.base, 'tok-agent1');
    const custId = await makeCustomer(biz1);
    const art = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { rev: 1 }, grade: 'source_supported',
    });
    const ass = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    const assessmentId = ass.json.assessmentId;
    // agent（模型执行者）提交含金额的候选：合法，authority 服务端强制 none
    const cand = await agent1('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: { tendency: 'cautious_do', supportableAmountMinor: wan(300), currency: 'CNY', rationale: '模型测算', producedBy: 'glm-calc', conditions: [], warnings: [] },
    });
    assert.equal(cand.status, 200, JSON.stringify(cand.json));
    assert.equal(cand.json.candidate.authority, 'none');
    await cred1('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
    // 携带 authority 字段 / 未声明字段：拒绝
    const bad1 = await agent1('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: { tendency: 'do', supportableAmountMinor: wan(1), currency: 'CNY', rationale: '', producedBy: 'x', conditions: [], warnings: [], authority: 'approved' },
    });
    assert.equal(bad1.status, 400);
    const bad2 = await agent1('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: { tendency: 'do', supportableAmountMinor: wan(1), currency: 'CNY', rationale: '', producedBy: 'x', conditions: [], warnings: [], approvedAmount: wan(1) },
    });
    assert.equal(bad2.status, 400);
    // 候选永远不能激活额度：agent 无人类命令通道
    const proposal = await cred1('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId, approvedAmountMinor: wan(300), currency: 'CNY',
    });
    const ap = await agent1('POST', `/api/v2/facilities/${proposal.json.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(ap.status, 403);
    assert.equal(ap.json.error, 'PERMISSION_DENIED');
  } finally { await k.stop(); }
});

test('A19 假人类角色/切前端角色：后端拒绝，审计记录不含秘密', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const agent1 = client(k.base, 'tok-agent1');
    const jw = client(k.base, 'tok-jw');
    const custId = await makeCustomer(biz1);
    const { facilityId, assessmentId } = await buildActiveFacility(k, {
      customerId: custId, amountMinor: wan(100), biz: biz1, cred: cred1,
      app: client(k.base, 'tok-app1'),
    });
    // agent 冒充人类角色：载荷声明无效
    const fake = await agent1('POST', `/api/v2/facilities/${facilityId}/approve`, {
      requestId: newId('r'), tenantId: T1, rationale: 'x', roles: ['approver'], requestedRole: 'approver',
    });
    assert.equal(fake.status, 403);
    // jianwei 不默认是额度审批人（矩阵无条目 → policy_pending 拒绝）
    const jwTry = await jw('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.ok([403, 409].includes(jwTry.status), 'jianwei 必须被拒绝');
    // 评估层正式动作同样只认目录角色
    const jwDecide = await jw('POST', `/api/v2/assessments/${assessmentId}/decide`, { requestId: newId('r'), tenantId: T1, decision: 'reject_assessment' });
    assert.equal(jwDecide.status, 403);
    // 审计不含凭据/令牌
    const audit = await k.pool.query(
      `SELECT actor_principal_id, action, payload_sha256, summary FROM audit_events ORDER BY seq DESC LIMIT 50`);
    for (const row of audit.rows) {
      const text = `${row.actor_principal_id}|${row.action}|${row.payload_sha256}|${row.summary}`;
      assert.ok(!text.includes('tok-'), `审计含令牌字样：${text}`);
    }
    const decisions = await k.pool.query(`SELECT actor_principal FROM decision_records`);
    for (const row of decisions.rows) {
      assert.ok(!String(row.actor_principal).includes('tok-'));
    }
    void facilityId;
  } finally { await k.stop(); }
});

test('A20 发票金额与合同金额冲突：两份证据都可追溯，冲突不被掩盖', async () => {
  const k = await startCreditKernel();
  try {
    const biz1 = client(k.base, 'tok-biz1');
    const custId = await makeCustomer(biz1);
    const inv = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'invoice', factKey: 'equipment_price',
      content: { source: 'invoice', amountMinor: wan(372) }, grade: 'confirmed',
    });
    const contract = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'purchase_contract', factKey: 'equipment_price',
      content: { source: 'contract', amountMinor: wan(380) }, grade: 'confirmed',
    });
    assert.equal(inv.status, 200);
    assert.equal(contract.status, 200);
    const list = await biz1('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.equal(list.json.artifacts.filter((a) => a.current).length, 2, '发票与合同并存');
    const conflict = list.json.factConflicts.find((c) => c.factKey === 'equipment_price');
    assert.ok(conflict, '同事实键双断言必须显式报冲突');
    assert.equal(conflict.assertionCount, 2);
    // 更正发票：显式 supersede，链路可追溯；合同不受影响
    const inv2 = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'invoice', factKey: 'equipment_price',
      content: { source: 'invoice', amountMinor: wan(372), corrected: true }, grade: 'confirmed', supersedes: inv.json.artifactId,
    });
    assert.equal(inv2.status, 200);
    const list2 = await biz1('GET', `/api/v2/customers/${custId}/artifacts`);
    const invOld = list2.json.artifacts.find((a) => a.artifactId === inv.json.artifactId);
    assert.equal(invOld.current, false);
    assert.equal(invOld.supersededBy, inv2.json.artifactId);
    assert.equal(list2.json.artifacts.find((a) => a.artifactId === contract.json.artifactId).current, true);
  } finally { await k.stop(); }
});

test('A21 accepted 且结论 rejected：工作完成状态不映射为风险通过', async () => {
  const k = await startCreditKernel();
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const custId = await makeCustomer(biz1);
    const art = await biz1('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { rev: 1 }, grade: 'source_supported',
    });
    const ass = await cred1('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    const assessmentId = ass.json.assessmentId;
    // 候选"做"——工作产物完成 ≠ 风险通过
    await cred1('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: { tendency: 'do', supportableAmountMinor: wan(500), currency: 'CNY', rationale: '', producedBy: 'test-harness', conditions: [], warnings: [] },
    });
    await cred1('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
    const rej = await cred1('POST', `/api/v2/assessments/${assessmentId}/decide`, {
      requestId: newId('r'), tenantId: T1, decision: 'reject_assessment', rationale: '实质风险未通过',
    });
    assert.equal(rej.status, 200);
    const after = await cred1('GET', `/api/v2/assessments/${assessmentId}`);
    assert.equal(after.json.assessment.status, 'rejected');
    // 拒绝结论下不得提案/批准任何额度
    const prop = await cred1('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId, approvedAmountMinor: wan(500), currency: 'CNY',
    });
    assert.equal(prop.status, 409);
    const exp = await biz1('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(exp.json.facilities.length, 0);
    assert.equal(exp.json.totalsMinor.exposureNow, 0);
  } finally { await k.stop(); }
});

test('A22 迁移中断/重复运行：可恢复，不损毁旧项目/证据/审计', async () => {
  // 手工建库：先只应用 001，再模拟 002 中断（BEGIN…ROLLBACK），最后正常迁移+重跑
  const db = await createTestDb('v7next_a_test_cc');
  let k = null;
  try {
    const { migrate } = await import('../src/db/db.ts');
    const { openPool } = await import('../src/config.ts');
    const pool = openPool(db.url);
    // 只应用 001（模拟旧版本存量库）
    const { readdirSync, readFileSync } = await import('node:fs');
    const migDir = new URL('../migrations/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    // 任务02 集成：迁移清单已扩展（003=任务一检查会话，004=决策闭环）；本用例核心是"中断可恢复"
    assert.deepEqual(files, ['001_init.sql', '002_customer_credit.sql', '003_inspection_sessions.sql', '004_decision_loop.sql', '005_trust_gates_a1.sql', '006_a2_a3_authority.sql', '007_ledger_once.sql', '008_domain_exemptions.sql', '009_customer_invitations.sql', '010_service_identities.sql', '011_authoritative_reads.sql', '012_takeoff_preassessment.sql', '013_five_domain_vocab.sql', '014_admission_request.sql']); // 005–007=任务01 审核修复增量；008=goal-01 豁免登记；009=四任务轮 v2.4 邀请/身份/处理状态；010=§11.1 交付运行时服务身份；011=任务03 权威清单排序索引；012=TAKEOFF-FA-1.0.0 预评估确认
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query('BEGIN');
    await pool.query(readFileSync(`${migDir}001_init.sql`, 'utf8'));
    await pool.query(`INSERT INTO schema_migrations(name) VALUES ('001_init.sql')`);
    await pool.query('COMMIT');
    // 旧数据：项目/证据/审计
    await pool.query(`INSERT INTO goal_templates (template_id, version, name, roles, goals) VALUES ('tpl-a22',1,'t','[]','[]')`);
    await pool.query(`INSERT INTO projects (project_id, template_id, template_version, name) VALUES ('p-a22','tpl-a22',1,'legacy')`);
    await pool.query(`INSERT INTO evidence (evidence_id, project_id, kind, content, sha256, input_version) VALUES ('ev-a22','p-a22','doc','{}','h',1)`);
    await pool.query(`INSERT INTO audit_events (actor_principal_id, action, target_type, target_id, summary, payload_sha256) VALUES ('u','x','project','p-a22','legacy audit','h')`);
    // 模拟 002 中断：事务内执行后回滚
    await pool.query('BEGIN');
    await pool.query(readFileSync(`${migDir}002_customer_credit.sql`, 'utf8'));
    await pool.query('ROLLBACK');
    const afterInterrupt = await pool.query(`SELECT to_regclass('public.customers') AS t`);
    assert.equal(afterInterrupt.rows[0].t, null, '中断回滚后不得留下半套新表');
    const projCount = await pool.query(`SELECT count(*)::int AS n FROM projects`);
    assert.equal(projCount.rows[0].n, 1);
    // 正常迁移 + 重复运行
    const ran1 = await migrate(pool);
    // 任务02 集成 + 任务01 审核修复 + 任务03：一次 migrate 依序补齐 002–011
    assert.deepEqual(ran1, ['002_customer_credit.sql', '003_inspection_sessions.sql', '004_decision_loop.sql', '005_trust_gates_a1.sql', '006_a2_a3_authority.sql', '007_ledger_once.sql', '008_domain_exemptions.sql', '009_customer_invitations.sql', '010_service_identities.sql', '011_authoritative_reads.sql', '012_takeoff_preassessment.sql', '013_five_domain_vocab.sql', '014_admission_request.sql']);
    const ran2 = await migrate(pool);
    assert.deepEqual(ran2, []);
    const projAfter = await pool.query(`SELECT customer_id FROM projects WHERE project_id='p-a22'`);
    assert.equal(projAfter.rows[0].customer_id, null, '旧项目不得被改写');
    const evAfter = await pool.query(`SELECT count(*)::int AS n FROM evidence`);
    assert.equal(evAfter.rows[0].n, 1);
    await pool.end();
    // 内核带完整 schema 正常起停（重跑路径）
    k = await startKernel({ dbUrl: db.url, keepDb: true });
    const health = await client(k.base, 'tok-root')('GET', '/healthz');
    assert.equal(health.status, 200);
    await k.stop();
    k = null;
    const pool2 = openPool(db.url);
    const migCount = await pool2.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    assert.equal(migCount.rows[0].n, 14); // 001–013（008=goal-01 豁免登记；009=四任务轮 v2.4；010=§11.1 服务身份；011=任务03 权威清单索引；012=TAKEOFF-FA 预评估确认；013=五域词表）
    await pool2.end();
  } finally {
    if (k !== null) await k.stop().catch(() => {});
    await dropTestDb(db.name);
  }
});

test('A23 业务提交成功、outbox 发布失败：恢复后可投递，不丢事件', async () => {
  const HOOK_PORT = 49991;
  process.env.V7NEXT_A_OUTBOX_MAX_ATTEMPTS = '500'; // 提高重试上限：避免失败场景下事件过早置 dead（子进程继承）
  const k = await startCreditKernel({ dispatch: true });
  let hookServer = null;
  try {
    await seedMatrix(k.pool);
    const root = client(k.base, 'tok-root');
    const biz1 = client(k.base, 'tok-biz1');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    const { facilityId } = await buildActiveFacility(k, { customerId: custId, amountMinor: CAP, biz: biz1, cred: cred1, app: app1 });
    // 订阅指向尚未启动的端口：发布必然失败重试
    const sub = await root('POST', '/api/v1/subscriptions', { requestId: newId('r'), name: 'a23', url: `http://127.0.0.1:${HOOK_PORT}/hook` });
    assert.equal(sub.status, 200);
    const fr = await makeFR(biz1, custId, facilityId, wan(80));
    const res = await reserve(biz1, fr);
    assert.equal(res.status, 200, '业务写必须成功（与 outbox 同事务，独立于投递结果）');
    await sleep(1600); // 让 dispatcher 重试若干轮（全部失败）
    const pending = await k.pool.query(
      `SELECT seq, event_id, dispatch_state FROM outbox_events WHERE customer_id=$1 AND event_type='RESERVATION_PLACED'`, [custId]);
    assert.equal(pending.rows.length, 1);
    assert.equal(pending.rows[0].dispatch_state, 'pending');
    // 投递簿记：失败重试应留下尝试记录（dispatcher 在 outbox_deliveries 计数）
    const delivery = await k.pool.query(
      `SELECT attempts FROM outbox_deliveries WHERE seq=$1`, [pending.rows[0].seq]);
    assert.equal(delivery.rows.length, 1);
    assert.ok(Number(delivery.rows[0].attempts) >= 1, '应有投递尝试');
    // 恢复：启动接收端 → 事件最终投递且按 eventId 幂等
    const http = await import('node:http');
    const received = [];
    hookServer = http.createServer((req, res$) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(JSON.parse(body || '{}'));
        res$.writeHead(200).end('ok');
      });
    });
    await new Promise((resolve) => hookServer.listen(HOOK_PORT, '127.0.0.1', resolve));
    let delivered = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const st = await k.pool.query(`SELECT dispatch_state FROM outbox_events WHERE seq=$1`, [pending.rows[0].seq]);
      if (st.rows[0].dispatch_state === 'delivered') { delivered = true; break; }
    }
    assert.ok(delivered, '恢复后事件应最终投递');
    const eventIds = received.map((e) => e.eventId);
    assert.equal(new Set(eventIds).size, eventIds.length, '接收端按 eventId 去重后应无重复投递');
    // 业务与事件同事务的原子性：账目行与事件行同时存在
    const entry = await k.pool.query(`SELECT tx_id FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [fr]);
    const ev = await k.pool.query(`SELECT payload FROM outbox_events WHERE seq=$1`, [pending.rows[0].seq]);
    assert.equal(ev.rows[0].payload.txId, entry.rows[0].tx_id);
  } finally {
    if (hookServer) hookServer.close();
    await k.stop();
  }
});

test('A24 单客户多子额度/直租回租并发：受客户主上限与关联组约束', async () => {
  const k = await startCreditKernel({ groupCap: wan(800) });
  try {
    await seedMatrix(k.pool);
    const biz1 = client(k.base, 'tok-biz1');
    const biz3 = client(k.base, 'tok-biz3');
    const cred1 = client(k.base, 'tok-cred1');
    const app1 = client(k.base, 'tok-app1');
    const custId = await makeCustomer(biz1);
    // 两个子额度：直租 600 万 + 回租 400 万（合计恰为主上限）
    const f1 = await buildActiveFacility(k, {
      customerId: custId, amountMinor: wan(600), biz: biz1, cred: cred1, app: app1,
      facilityOpts: { productScope: ['direct_lease'] },
    });
    const f2 = await buildActiveFacility(k, {
      customerId: custId, amountMinor: wan(400), biz: biz1, cred: cred1, app: app1,
      facilityOpts: { productScope: ['sale_leaseback'] },
    });
    // 第三个提案 500 万：客户合计超主上限 → 批准拒绝
    const p3 = await buildProposal(k, { custId, cred1, biz1, amountMinor: wan(500) });
    const ap3 = await app1('POST', `/api/v2/facilities/${p3.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(ap3.status, 409);
    assert.equal(ap3.json.error, 'PRODUCT_CAP_EXCEEDED');
    // 直租与回租跨设施并发预占：客户主上限统一约束
    const frA = await makeFR(biz1, custId, f1.facilityId, wan(500), 'direct_lease');
    const frB = await makeFR(biz3, custId, f2.facilityId, wan(500), 'sale_leaseback');
    const [ra, rb] = await Promise.all([reserve(biz1, frA), reserve(biz3, frB)]);
    const okCount = [ra, rb].filter((x) => x.status === 200).length;
    assert.equal(okCount, 1, `跨设施并发只能成交一笔：${JSON.stringify([ra.json, rb.json])}`);
    // 关联组：G1/G2 同组，组上限 800 万；G1 批 600 万 → G2 批 300 万被集中度拦截（600+300>800）
    const g1 = await makeCustomer(biz1, T1, 'USCC-G1');
    const g2 = await makeCustomer(biz1, T1, 'USCC-G2');
    await biz1('POST', `/api/v2/customers/${g1}/relationships`, { requestId: newId('r'), tenantId: T1, type: 'related_group', toCustomerId: g2 });
    await buildActiveFacility(k, { customerId: g1, amountMinor: wan(600), biz: biz1, cred: cred1, app: app1 });
    const g2p = await buildProposal(k, { custId: g2, cred1, biz1, amountMinor: wan(300) });
    const g2ap = await app1('POST', `/api/v2/facilities/${g2p.facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(g2ap.status, 409);
    assert.equal(g2ap.json.error, 'CONCENTRATION_BLOCKED');
  } finally { await k.stop(); }
});
