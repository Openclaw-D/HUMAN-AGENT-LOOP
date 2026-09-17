// 任务01·A3 提交边界测试：台账交易竞态与后续用信门（审核 F04/F10/F12；验收 K12–K18）。
// 并发一律真实 PG + 客户行锁屏障（pg_locks 轮询等待），不以随机 sleep 代替屏障。
// API 面由本文件冻结：
//   POST /api/v2/customers/:id/limit-increase-requests        （human business/credit；客户级提额请求）
//   POST /api/v2/limit-increase-requests/:requestId/resolve   （human credit/approver；resolve → next_eligible_at）
//   commit/disburse 提交点：设施状态 + 依据包当前性 + 未决差异 机械复查
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const CAP = 1_000_000_000;
const wan = (n) => n * 1_000_000;

const SPEC_A3 = [
  'tok-root=root:human:admin:all:all:all',
  'tok-biz1=biz1:human:business:all:t1',
  'tok-biz2=biz2:human:business:all:t1',
  'tok-credit=cred:human:credit:all:t1',
  'tok-approver=app:human:approver:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
].join(',');

const POLICY_A3 = 'domreq-a3';
const PACK_V1 = 'pack-a3-v1';
const PACK_V2 = 'pack-a3-v2';

function root(k) { return client(k.base, 'tok-root'); }
function biz1(k) { return client(k.base, 'tok-biz1'); }
function biz2(k) { return client(k.base, 'tok-biz2'); }
function creditP(k) { return client(k.base, 'tok-credit'); }
function approver(k) { return client(k.base, 'tok-approver'); }
function svc(k) { return client(k.base, 'tok-svc'); }

async function startA3Kernel(extra = [], opts = {}) {
  const k = await startKernel({
    extraArgs: [
      '--credit-matrix', 'm3', '--credit-concentration', 'c3',
      '--credit-cooling-seconds', '3600',
      '--limit-increase-max-per-window', '2',
      '--limit-increase-window-days', '30',
      '--limit-increase-retry-hours', '24',
      '--required-domains-policy', POLICY_A3,
      ...extra,
    ],
    principalSpec: SPEC_A3,
    ...opts,
  });
  await k.pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
       ('m3','approver','facility.approve',true,$1),
       ('m3','approver','facility.activate',true,$1),
       ('m3','approver','facility.suspend',true,NULL),
       ('m3','business','fr.confirm-external',true,$1)
     ON CONFLICT DO NOTHING`, [CAP]);
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES ($1,'credit',true)
     ON CONFLICT DO NOTHING`, [POLICY_A3]);
  return k;
}

async function mkCustomer(k, name) {
  const r = await root(k)('POST', '/api/v2/customers', {
    requestId: `mk-${name}-${Date.now()}`, tenantId: T1, legalEntityRef: `LE-A3-${name}`, displayName: `A3客户${name}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function mkFr(k, customerId, facilityId, amountMinor = wan(2)) {
  const r = await biz1(k)('POST', `/api/v2/customers/${customerId}/financing-requests`, {
    requestId: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, tenantId: T1,
    facilityId, productType: 'direct_lease', amountMinor, currency: 'CNY',
    equipmentRefs: ['eq-1'], contractRefs: ['ct-1'],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.frId;
}

/** 活跃设施（legacy 通道：本文件内核显式 --allow-legacy-basis）。 */
async function activeFacility(k, customerId, amountMinor = wan(5)) {
  const c = creditP(k);
  const art = await c('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: `art-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
  });
  const ass = await c('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: `ass-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  const cand = await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: `cand-${Date.now()}`, tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: amountMinor, producedBy: 'a3' },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev-${Date.now()}`, tenantId: T1 });
  const prop = await c('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: `prop-${Date.now()}`, tenantId: T1, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: amountMinor, currency: 'CNY',
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  const facilityId = prop.json.facilityId;
  const apr = await approver(k)('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: `apr-${Date.now()}`, tenantId: T1, rationale: 'a3' });
  assert.equal(apr.status, 200, JSON.stringify(apr.json));
  const act = await approver(k)('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: `act-${Date.now()}`, tenantId: T1, rationale: 'a3' });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  return facilityId;
}

/** 屏障：持客户行锁，等 kernel 侧出现 >= n 个锁等待，再放行。 */
async function withCustomerBarrier(k, customerId, n, fn) {
  const client1 = await k.pool.connect();
  try {
    await client1.query('BEGIN');
    await client1.query(`SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE`, [customerId]);
    const p = fn();
    const deadline = Date.now() + 8000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const r = await client1.query(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE NOT l.granted AND a.datname = current_database()`,
      );
      waiting = r.rows[0].n;
      if (waiting >= n) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    assert.ok(waiting >= n, `屏障未达成：仅 ${waiting}/${n} 个锁等待`);
    await client1.query('ROLLBACK');
    return await p;
  } finally {
    client1.release();
  }
}

/** 绑定依据包的活跃设施（A2 机器：规则版本 + Gate 回执 + 运行 + 真实收口）。 */
async function packageBoundActiveFacility(k, customerId, amountMinor = wan(5)) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: `tpl-${Date.now()}`, name: 'tpl-a3',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  const proj = await a('POST', '/api/v1/projects', { requestId: `proj-${Date.now()}`, templateId: tpl.json.templateId, name: 'proj-a3' });
  const projectId = proj.json.projectId;
  const sess = await biz1(k)('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: `sess-${Date.now()}`, customerId, title: 'A3 会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] }],
  });
  const sessionId = sess.json.sessionId;
  await biz1(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: `st-${Date.now()}`, expectedVersion: 1 });
  const snap = await biz1(k)('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(snap.status, 200, JSON.stringify(snap.json));
  const itemId = snap.json.snapshot.items[0].itemId;
  const q = await biz1(k)('POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: `q-${Date.now()}`, audience: 'internal', targetRole: 'business', question: '确认?', purpose: 'verify', itemId,
  });
  await biz1(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, { requestId: `ans-${Date.now()}`, answer: { text: 'ok' } });
  const end = await biz1(k)('POST', `/api/v1/inspections/${sessionId}/end`, { requestId: `end-${Date.now()}`, expectedVersion: 3 });
  assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));

  const rp = await root(k)('POST', '/api/v2/rule-pack-versions/activate', { requestId: `rp-${Date.now()}`, tenantId: T1, version: PACK_V1 });
  assert.equal(rp.status, 200, JSON.stringify(rp.json));
  const gr = await svc(k)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: `gr-${Date.now()}`, tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1,
  });
  assert.equal(gr.status, 200, JSON.stringify(gr.json));
  const created = await biz1(k)('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: `pkg-${Date.now()}`, tenantId: T1, gateReceiptId: gr.json.receiptId,
    inspectionRevision: { sessionId },
    domainDeps: [{ domain: 'credit', artifactIds: [], factKeys: ['revenue_2025'], rulePackVersion: PACK_V1 }],
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const packageId = created.json.packageId;
  const run = await svc(k)('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
    requestId: `run-${Date.now()}`, tenantId: T1, domain: 'credit',
    deps: { artifactIds: [], factKeys: ['revenue_2025'], rulePackVersion: PACK_V1 },
  });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  await svc(k)('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, { requestId: `fin-${Date.now()}`, tenantId: T1, executionStatus: 'completed' });
  const rr = await svc(k)('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
    requestId: `dr-${Date.now()}`, tenantId: T1, domain: 'credit',
    analysisRun: { runId: run.json.runId, rulesetVersion: PACK_V1 },
    opinion: { findingType: 'observation', summary: 'credit ok', domain: 'credit', authority: 'none' },
    deps: { artifactIds: [], factKeys: ['revenue_2025'], rulePackVersion: PACK_V1 },
  });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));

  const c = creditP(k);
  const art = await c('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: `art-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
  });
  const ass = await c('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: `ass-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: `cand-${Date.now()}`, tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: amountMinor, producedBy: 'a3' },
  });
  await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev-${Date.now()}`, tenantId: T1 });
  const prop = await c('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: `prop-${Date.now()}`, tenantId: T1, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: amountMinor, currency: 'CNY', packageId,
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  const apr = await approver(k)('POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, { requestId: `apr-${Date.now()}`, tenantId: T1, rationale: 'a3' });
  assert.equal(apr.status, 200, `包绑定批准（应就绪）：${JSON.stringify(apr.json)}`);
  const act = await approver(k)('POST', `/api/v2/facilities/${prop.json.facilityId}/activate`, { requestId: `act-${Date.now()}`, tenantId: T1, rationale: 'a3' });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  return { facilityId: prop.json.facilityId, packageId };
}

async function bucketsOf(k, facilityId) {
  const r = await k.pool.query(
    `SELECT entry_type, SUM(amount_minor)::text AS total FROM exposure_entries WHERE facility_id=$1 GROUP BY entry_type`,
    [facilityId],
  );
  const sum = {};
  for (const row of r.rows) sum[row.entry_type] = Number(row.total);
  return {
    reserved: (sum.reserve ?? 0) - (sum.reserve_release ?? 0) - (sum.reserve_expire ?? 0) - (sum.reserve_commit ?? 0),
    committed: (sum.reserve_commit ?? 0) - (sum.commit_cancel ?? 0) - (sum.disburse ?? 0),
    outstanding: (sum.disburse ?? 0) - (sum.settle ?? 0),
  };
}

// ---------------------------------------------------------------------------

test('K12: 同 frId 不同 requestId 并发 reserve（额度足够两次）→ 单次业务迁移、单次占用', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(k, 'k12');
    const facilityId = await activeFacility(k, custId, wan(5));
    const frId = await mkFr(k, custId, facilityId);
    const [r1, r2] = await withCustomerBarrier(k, custId, 2, () => Promise.all([
      biz1(k)('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: `r1-${Date.now()}`, tenantId: T1 }),
      biz2(k)('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: `r2-${Date.now()}`, tenantId: T1 }),
    ]));
    const ok = [r1, r2].filter((r) => r.status === 200);
    const rejected = [r1, r2].filter((r) => r.status !== 200);
    assert.equal(ok.length, 1, `恰好一次成功：${JSON.stringify([r1.json, r2.json])}`);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].json?.error ?? ''), /NOT_READY/, `后到者应报状态冲突：${JSON.stringify(rejected[0].json)}`);
    const cnt = await k.pool.query(
      `SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [frId],
    );
    assert.equal(cnt.rows[0].n, 1, '同申请只允许一笔预占账目');
    const b = await bucketsOf(k, facilityId);
    assert.equal(b.reserved, wan(2), `预占恰好一次：${JSON.stringify(b)}`);
    const fr = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [frId]);
    assert.equal(fr.rows[0].status, 'reserved');
  } finally { await k.stop(); }
});

test('K13: release 与 commit 屏障交错 → 状态与桶守恒，无负桶无双效应', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(k, 'k13');
    const facilityId = await activeFacility(k, custId, wan(5));
    const frId = await mkFr(k, custId, facilityId);
    const r0 = await biz1(k)('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: `r0-${Date.now()}`, tenantId: T1 });
    assert.equal(r0.status, 200, JSON.stringify(r0.json));
    const [rel, com] = await withCustomerBarrier(k, custId, 2, () => Promise.all([
      biz1(k)('POST', `/api/v2/financing-requests/${frId}/release`, { requestId: `rel-${Date.now()}`, tenantId: T1 }),
      biz1(k)('POST', `/api/v2/financing-requests/${frId}/commit`, { requestId: `com-${Date.now()}`, tenantId: T1 }),
    ]));
    const okCount = [rel, com].filter((r) => r.status === 200).length;
    assert.equal(okCount, 1, `释放/承诺恰好一个成功：${JSON.stringify([rel.json, com.json])}`);
    const b = await bucketsOf(k, facilityId);
    assert.ok(b.reserved >= 0 && b.committed >= 0 && b.outstanding >= 0, `无非负性破坏：${JSON.stringify(b)}`);
    const frState = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [frId]);
    const status = frState.rows[0].status;
    if (status === 'committed') {
      assert.equal(b.reserved, 0, '承诺后预占清零');
      assert.equal(b.committed, wan(2), '承诺恰好一次');
      const relEntries = await k.pool.query(
        `SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve_release'`, [frId]);
      assert.equal(relEntries.rows[0].n, 0, '承诺后不得再出现释放账目');
    } else if (status === 'cancelled') {
      assert.equal(b.reserved, 0);
      assert.equal(b.committed, 0, '释放后不得残留承诺');
    } else {
      assert.fail(`意外终态 ${status}`);
    }
  } finally { await k.stop(); }
});

test('K14: reserve 后设施暂停 / 规则换版 / unknown 出账 → 无新非法业务效果，模拟与实际明确区分', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(k, 'k14');
    // (a) reserve 后 suspend：commit/disburse 被设施状态门阻断
    const facilityId = await activeFacility(k, custId, wan(5));
    const frId = await mkFr(k, custId, facilityId);
    const r0 = await biz1(k)('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: `r0-${Date.now()}`, tenantId: T1 });
    assert.equal(r0.status, 200, JSON.stringify(r0.json));
    const susp = await approver(k)('POST', `/api/v2/facilities/${facilityId}/suspend`, { requestId: `susp-${Date.now()}`, tenantId: T1, rationale: 'k14' });
    assert.equal(susp.status, 200, JSON.stringify(susp.json));
    const com1 = await biz1(k)('POST', `/api/v2/financing-requests/${frId}/commit`, { requestId: `c1-${Date.now()}`, tenantId: T1 });
    assert.equal(com1.status, 409, `暂停下承诺应 409：${JSON.stringify(com1.json)}`);
    assert.match(String(com1.json?.error ?? ''), /FACILITY_NOT_ACTIVE/);
    // (b) 规则正式换版：绑定包的设施其后续 commit 被依据当前性阻断
    const custP = await mkCustomer(k, 'k14b'); // 包绑定设施放第二客户：避免同客户向上批准触发提额冷却（冷却叙事在 K18）
    const { facilityId: fac2, packageId } = await packageBoundActiveFacility(k, custP, wan(9));
    const fr2 = await mkFr(k, custP, fac2);
    const r2 = await biz1(k)('POST', `/api/v2/financing-requests/${fr2}/reserve`, { requestId: `r2-${Date.now()}`, tenantId: T1 });
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    const com0 = await biz1(k)('POST', `/api/v2/financing-requests/${fr2}/commit`, { requestId: `c0-${Date.now()}`, tenantId: T1 });
    assert.equal(com0.status, 200, `换版前承诺应成功：${JSON.stringify(com0.json)}`);
    const fr3 = await mkFr(k, custP, fac2);
    const r3 = await biz1(k)('POST', `/api/v2/financing-requests/${fr3}/reserve`, { requestId: `r3-${Date.now()}`, tenantId: T1 });
    assert.equal(r3.status, 200, JSON.stringify(r3.json));
    const fr4 = await mkFr(k, custP, fac2);
    const r4 = await biz1(k)('POST', `/api/v2/financing-requests/${fr4}/reserve`, { requestId: `r4-${Date.now()}`, tenantId: T1 });
    assert.equal(r4.status, 200, JSON.stringify(r4.json));
    const rp2 = await root(k)('POST', '/api/v2/rule-pack-versions/activate', { requestId: `rp2-${Date.now()}`, tenantId: T1, version: PACK_V2 });
    assert.equal(rp2.status, 200, JSON.stringify(rp2.json));
    const com3 = await biz1(k)('POST', `/api/v2/financing-requests/${fr3}/commit`, { requestId: `c3-${Date.now()}`, tenantId: T1 });
    assert.equal(com3.status, 409, `换版后承诺应被依据门阻断：${JSON.stringify(com3.json)}`);
    assert.match(String(com3.json?.error ?? ''), /STALE_BASIS|GATE_BLOCKED/);
    void packageId;
    // (c) unknown 出账：不产生账目、占用保持，等待对账（模拟与实际资金明确区分）
    void fr3; void com3;
    const before = await bucketsOf(k, fac2);
    const dis1 = await biz1(k)('POST', `/api/v2/financing-requests/${fr2}/disburse`, { requestId: `d1-${Date.now()}`, tenantId: T1, simulationMode: 'unknown' });
    assert.equal(dis1.status, 200, `unknown 出账受理：${JSON.stringify(dis1.json)}`);
    assert.equal(dis1.json.status, 'disbursing_unknown');
    const after = await bucketsOf(k, fac2);
    assert.equal(after.outstanding, before.outstanding, 'unknown 出账不得移动桶');
    const frRow = await k.pool.query(`SELECT status, external_state FROM financing_requests WHERE fr_id=$1`, [fr2]);
    assert.equal(frRow.rows[0].status, 'disbursing_unknown');
    assert.equal(frRow.rows[0].external_state, 'unknown');
  } finally { await k.stop(); }
});

test('K15: 审批与风险两种提交次序 → 线性化一致，历史不被回写，后续未完成动作被限制', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const mkFinding = (customerId) => (patch = {}) => biz1(k)('POST', `/api/v2/customers/${customerId}/findings`, {
      requestId: `fnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, tenantId: T1,
      findingType: 'verification_gap', assertion: '关键事实未经核验', responsibleRole: 'credit',
      impactScope: { actions: ['approve_facility', 'use_of_funds'], domains: ['credit'], blocking: true },
      requiredAction: { kind: 'verify', requiredEvidenceKinds: ['site_verification'], minGrade: 'confirmed' },
      ...patch,
    });
    // 次序一：风险先落 → 用信被阻断
    const custA = await mkCustomer(k, 'k15a');
    const facilityA = await activeFacility(k, custA, wan(5));
    const frA = await mkFr(k, custA, facilityA);
    const f1 = await mkFinding(custA)({ impactScope: { actions: ['use_of_funds'], domains: ['credit'], blocking: true } });
    assert.equal(f1.status, 200, JSON.stringify(f1.json));
    const rsvA = await biz1(k)('POST', `/api/v2/financing-requests/${frA}/reserve`, { requestId: `ra-${Date.now()}`, tenantId: T1 });
    assert.equal(rsvA.status, 409, `风险未决时用信应 409：${JSON.stringify(rsvA.json)}`);
    assert.match(String(rsvA.json?.error ?? ''), /REVIEW_REQUIRED/);
    // 次序二（另一客户：差异为客户级）：动作先完成 → 历史保留，风险落地后限制尚未完成的动作
    const custB = await mkCustomer(k, 'k15b');
    const facilityB = await activeFacility(k, custB, wan(5));
    const frB = await mkFr(k, custB, facilityB);
    const rsvB = await biz1(k)('POST', `/api/v2/financing-requests/${frB}/reserve`, { requestId: `rb-${Date.now()}`, tenantId: T1 });
    assert.equal(rsvB.status, 200, JSON.stringify(rsvB.json));
    const f2 = await mkFinding(custB)();
    assert.equal(f2.status, 200, JSON.stringify(f2.json));
    const comB = await biz1(k)('POST', `/api/v2/financing-requests/${frB}/commit`, { requestId: `cb-${Date.now()}`, tenantId: T1 });
    assert.equal(comB.status, 409, `风险落地后未完成动作被限制：${JSON.stringify(comB.json)}`);
    // 历史不被回写：已成功预占的账目仍在，原决定/账目不被改写
    const entriesB = await k.pool.query(
      `SELECT count(*)::int AS n FROM exposure_entries WHERE fr_id=$1 AND entry_type='reserve'`, [frB]);
    assert.equal(entriesB.rows[0].n, 1, '已发生的合法预占保留');
    // 关闭差异（需证据）后恢复
    const ev = await creditP(k)('POST', `/api/v2/customers/${custB}/artifacts`, {
      requestId: `ev-${Date.now()}`, tenantId: T1, kind: 'site_verification', factKey: 'site', content: { ok: true }, grade: 'confirmed',
    });
    const res2 = await creditP(k)('POST', `/api/v2/findings/${f2.json.findingId}/resolve`, {
      requestId: `rs2-${Date.now()}`, tenantId: T1, expectedVersion: 1, resolution: 'explained_verified',
      evidenceRefs: [{ artifactId: ev.json.artifactId }], rationale: '已核验',
    });
    assert.equal(res2.status, 200, JSON.stringify(res2.json));
    const comB2 = await biz1(k)('POST', `/api/v2/financing-requests/${frB}/commit`, { requestId: `cb2-${Date.now()}`, tenantId: T1 });
    assert.equal(comB2.status, 200, `差异关闭后承诺恢复：${JSON.stringify(comB2.json)}`);
  } finally { await k.stop(); }
});

test('K16: 大数/币种/过期预占/循环恢复 → 无精度损失、无错误恢复、不默许过期支用', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(k, 'k16');
    const facilityId = await activeFacility(k, custId, wan(5));
    // 币种不一致
    const frBad = await biz1(k)('POST', `/api/v2/customers/${custId}/financing-requests`, {
      requestId: `frbad-${Date.now()}`, tenantId: T1, facilityId, productType: 'direct_lease',
      amountMinor: 100, currency: 'USD', equipmentRefs: ['e'], contractRefs: ['c'],
    });
    assert.equal(frBad.status, 409, `币种不一致应 409：${JSON.stringify(frBad.json)}`);
    assert.match(String(frBad.json?.error ?? ''), /CURRENCY_MISMATCH/);
    // 大数：白盒注入超安全整数账目 → 聚合不得无条件转 Number（显式报错，不静默舍入）
    const frBig = await mkFr(k, custId, facilityId, wan(1));
    await k.pool.query(
      `INSERT INTO exposure_entries (entry_id, tenant_id, customer_id, facility_id, fr_id, entry_type, amount_minor, currency, request_scope, request_id, tx_id)
       VALUES ('le-big','t1',$1,$2,$3,'reserve',9007199254740993,'CNY','s','r','t')`,
      [custId, facilityId, frBig],
    );
    const bigView = await biz1(k)('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(bigView.status, 500, `超安全整数聚合应显式失败：${JSON.stringify(bigView.json)}`);
    assert.equal(bigView.json?.error, 'INTERNAL');
    await k.pool.query(`DELETE FROM exposure_entries WHERE entry_id='le-big'`);
    // 过期预占：fr 预占被白盒回拨到过去（external=none）→ 下一笔写惰性过期，可用额恢复
    const frE = await mkFr(k, custId, facilityId, wan(2));
    const rsv = await biz1(k)('POST', `/api/v2/financing-requests/${frE}/reserve`, { requestId: `re-${Date.now()}`, tenantId: T1 });
    assert.equal(rsv.status, 200, JSON.stringify(rsv.json));
    await k.pool.query(
      `UPDATE financing_requests SET reserved_until = now() - interval '1 second' WHERE fr_id=$1`, [frE]);
    const frE2 = await mkFr(k, custId, facilityId, wan(2));
    const rsv2 = await biz1(k)('POST', `/api/v2/financing-requests/${frE2}/reserve`, { requestId: `re2-${Date.now()}`, tenantId: T1 });
    assert.equal(rsv2.status, 200, `过期预占清理后新预占应成功：${JSON.stringify(rsv2.json)}`);
    const frERow = await k.pool.query(`SELECT status FROM financing_requests WHERE fr_id=$1`, [frE]);
    assert.equal(frERow.rows[0].status, 'cancelled', '过期预占应被惰性清理');
    // 循环恢复：settle 后可用额恢复（revolving）
    const cust2 = await mkCustomer(k, 'k16b');
    const c = creditP(k);
    const art = await c('POST', `/api/v2/customers/${cust2}/artifacts`, {
      requestId: `art2-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
    });
    const ass = await c('POST', `/api/v2/customers/${cust2}/assessments`, {
      requestId: `ass2-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
      requestId: `cand2-${Date.now()}`, tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: wan(5), producedBy: 'a3' },
    });
    await c('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev2-${Date.now()}`, tenantId: T1 });
    const prop = await c('POST', `/api/v2/customers/${cust2}/facilities`, {
      requestId: `prop2-${Date.now()}`, tenantId: T1, assessmentId: ass.json.assessmentId,
      approvedAmountMinor: wan(5), currency: 'CNY', revolving: true,
    });
    const fac2 = prop.json.facilityId;
    await approver(k)('POST', `/api/v2/facilities/${fac2}/approve`, { requestId: `a2-${Date.now()}`, tenantId: T1, rationale: 'x' });
    await approver(k)('POST', `/api/v2/facilities/${fac2}/activate`, { requestId: `ac2-${Date.now()}`, tenantId: T1, rationale: 'x' });
    const frR = await mkFr(k, cust2, fac2, wan(2));
    for (const [path, body] of [
      [`/reserve`, { requestId: `rr-${Date.now()}` }],
      [`/commit`, { requestId: `rc-${Date.now()}` }],
      [`/disburse`, { requestId: `rd-${Date.now()}` }],
      [`/settle`, { requestId: `rs-${Date.now()}` }],
    ]) {
      const r = await biz1(k)('POST', `/api/v2/financing-requests/${frR}${path}`, { tenantId: T1, ...body });
      assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
    }
    const view = await biz1(k)('GET', `/api/v2/facilities/${fac2}`);
    assert.equal(view.json.exposure.availableForNewDrawMinor, wan(5), `循环额度还款后可用额恢复：${JSON.stringify(view.json.exposure)}`);
  } finally { await k.stop(); }
});

test('K17: 提额请求客户级限制——多业务员/窗口边界/实质新证据/重启保持/失败不误扣', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis'], { keepDb: true });
  const dbUrl = k.dbUrl;
  let k2 = null;
  try {
    const custId = await mkCustomer(k, 'k17');
    const e1 = await biz1(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `e1-${Date.now()}`, tenantId: T1, kind: 'financials', factKey: 'revenue_2025', content: { rev: 1 }, grade: 'unverified',
    });
    assert.equal(e1.status, 200, JSON.stringify(e1.json));
    const submit = (c, payload) => c('POST', `/api/v2/customers/${custId}/limit-increase-requests`, {
      tenantId: T1, requestedAmountMinor: wan(8), currency: 'CNY', ...payload,
    });
    // 首笔成功（open）
    const r1 = await submit(biz1(k), { requestId: `li1-${Date.now()}`, evidenceRefs: [e1.json.artifactId] });
    assert.equal(r1.status, 200, `首笔提额请求：${JSON.stringify(r1.json)}`);
    // 另一业务员在途再提 → 409（客户级，跨渠道/业务员不可绕行）
    const r2 = await submit(biz2(k), { requestId: `li2-${Date.now()}`, evidenceRefs: [e1.json.artifactId] });
    assert.equal(r2.status, 409, `在途唯一应 409：${JSON.stringify(r2.json)}`);
    assert.match(String(r2.json?.error ?? ''), /LIMIT_INCREASE_IN_FLIGHT/);
    // 系统失败不误扣次数：非法载荷 400，不产生新行
    const bad = await submit(biz1(k), { requestId: `lib-${Date.now()}`, requestedAmountMinor: -5 });
    assert.equal(bad.status, 400);
    // 驳回 → next_eligible_at
    const res1 = await creditP(k)('POST', `/api/v2/limit-increase-requests/${r1.json.requestId}/resolve`, {
      requestId: `rs1-${Date.now()}`, tenantId: T1, outcome: 'rejected', note: '证据不足',
    });
    assert.equal(res1.status, 200, JSON.stringify(res1.json));
    assert.ok(res1.json.nextEligibleAt, '驳回应给出 nextEligibleAt');
    // 立即重提 → 窗口/冷却 409
    const r3 = await submit(biz1(k), { requestId: `li3-${Date.now()}`, evidenceRefs: [e1.json.artifactId] });
    assert.equal(r3.status, 409, `nextEligibleAt 内重提应 409：${JSON.stringify(r3.json)}`);
    // 白盒回拨 next_eligible_at → 重提需"实质新证据"
    await k.pool.query(`UPDATE credit_limit_requests SET next_eligible_at = now() - interval '1 hour' WHERE request_id=$1`, [r1.json.requestId]);
    const r4 = await submit(biz1(k), { requestId: `li4-${Date.now()}`, evidenceRefs: [e1.json.artifactId] });
    assert.equal(r4.status, 409, `无实质新证据应 409：${JSON.stringify(r4.json)}`);
    assert.match(String(r4.json?.error ?? ''), /LIMIT_INCREASE_NO_NEW_EVIDENCE/);
    const e2 = await biz1(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `e2-${Date.now()}`, tenantId: T1, kind: 'financials', factKey: 'revenue_2025', content: { rev: 2 }, grade: 'unverified',
    });
    const r5 = await submit(biz1(k), { requestId: `li5-${Date.now()}`, evidenceRefs: [e2.json.artifactId] });
    assert.equal(r5.status, 200, `实质新证据后重提应成功：${JSON.stringify(r5.json)}`);
    // 窗口边界：窗口内已有 2 笔（li1/li5）→ 驳回 li5 后重提第三笔被窗口拒绝
    await creditP(k)('POST', `/api/v2/limit-increase-requests/${r5.json.requestId}/resolve`, {
      requestId: `rs5-${Date.now()}`, tenantId: T1, outcome: 'rejected', note: 'x',
    });
    await k.pool.query(`UPDATE credit_limit_requests SET next_eligible_at = now() - interval '1 hour' WHERE request_id=$1`, [r5.json.requestId]);
    const e3 = await biz1(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `e3-${Date.now()}`, tenantId: T1, kind: 'financials', factKey: 'revenue_2025', content: { rev: 3 }, grade: 'unverified',
    });
    const r6 = await submit(biz1(k), { requestId: `li6-${Date.now()}`, evidenceRefs: [e3.json.artifactId] });
    assert.equal(r6.status, 409, `窗口次数（2/30d）用尽应 409：${JSON.stringify(r6.json)}`);
    assert.match(String(r6.json?.error ?? ''), /LIMIT_INCREASE_WINDOW/);
    assert.ok(r6.json.nextEligibleAt, '窗口拒绝应给出 nextEligibleAt');
    // 重启后限制保持（持久化；首启 keepDb 使 stop 不删库）
    await k.stop();
    k2 = await startKernel({
      dbUrl,
      keepDb: true,
      extraArgs: [
        '--credit-matrix', 'm3', '--credit-concentration', 'c3',
        '--limit-increase-max-per-window', '2', '--limit-increase-window-days', '30',
        '--limit-increase-retry-hours', '24', '--required-domains-policy', POLICY_A3,
      ],
      principalSpec: SPEC_A3,
    });
    try {
      const r7 = await submit(biz1(k2), { requestId: `li7-${Date.now()}`, evidenceRefs: [e3.json.artifactId] });
      assert.equal(r7.status, 409, `重启后窗口限制保持：${JSON.stringify(r7.json)}`);
    } finally { await k2.stop(); }
  } finally {
    if (k2 === null) { try { await k.stop(); } catch { /* 已停 */ } }
  }
});

test('K18: 冷却内新负面材料 → 正常核验与阻断；既有合同不被自动改写', async () => {
  const k = await startA3Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(k, 'k18');
    const facilityId = await activeFacility(k, custId, wan(5));
    const before = await k.pool.query(
      `SELECT approved_amount_minor, status, version FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
    // 激活冷却（模拟提额批准后的冷却窗口）
    await k.pool.query(`UPDATE credit_facilities SET cooling_until = now() + interval '1 hour' WHERE facility_id=$1`, [facilityId]);
    // 冷却不阻挡负面材料登记与核验
    const adverse = await creditP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `adv-${Date.now()}`, tenantId: T1, kind: 'credit_adverse_note', factKey: 'adverse', content: { note: '诉讼' }, grade: 'source_supported',
    });
    assert.equal(adverse.status, 200, `冷却内核验登记不受阻：${JSON.stringify(adverse.json)}`);
    const fnd = await biz1(k)('POST', `/api/v2/customers/${custId}/findings`, {
      requestId: `fnd-${Date.now()}`, tenantId: T1, findingType: 'adverse_fact', assertion: '新增诉讼',
      responsibleRole: 'credit', impactScope: { actions: ['approve_facility', 'use_of_funds'], domains: ['credit'], blocking: true },
    });
    assert.equal(fnd.status, 200, JSON.stringify(fnd.json));
    // 冷却内差异复核优先阻断正式动作（报 REVIEW_REQUIRED 而非 COOLING_ACTIVE）
    const fr = await mkFr(k, custId, facilityId);
    const rsv = await biz1(k)('POST', `/api/v2/financing-requests/${fr}/reserve`, { requestId: `r-${Date.now()}`, tenantId: T1 });
    assert.equal(rsv.status, 409, `未决差异阻断用信：${JSON.stringify(rsv.json)}`);
    assert.match(String(rsv.json?.error ?? ''), /REVIEW_REQUIRED/);
    // 关闭差异后：既有活跃设施的用信不因冷却被无说明冻结（冷却只影响向上申请/发布）
    const ev = await creditP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `ev-${Date.now()}`, tenantId: T1, kind: 'site_verification', factKey: 'adverse', content: { resolved: true }, grade: 'confirmed',
    });
    const res = await creditP(k)('POST', `/api/v2/findings/${fnd.json.findingId}/resolve`, {
      requestId: `rs-${Date.now()}`, tenantId: T1, expectedVersion: 1, resolution: 'explained_verified',
      evidenceRefs: [{ artifactId: ev.json.artifactId }], rationale: '已核实',
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const rsv2 = await biz1(k)('POST', `/api/v2/financing-requests/${fr}/reserve`, { requestId: `r2-${Date.now()}`, tenantId: T1 });
    assert.equal(rsv2.status, 200, `既有合法用信不受冷却扩大限制：${JSON.stringify(rsv2.json)}`);
    // 冷却仍阻断"发布"（激活）与向上申请
    const liReq = await biz1(k)('POST', `/api/v2/customers/${custId}/limit-increase-requests`, {
      requestId: `li-${Date.now()}`, tenantId: T1, requestedAmountMinor: wan(8), currency: 'CNY',
      evidenceRefs: [adverse.json.artifactId],
    });
    assert.equal(liReq.status, 409, `冷却内向上申请应 409：${JSON.stringify(liReq.json)}`);
    assert.match(String(liReq.json?.error ?? ''), /COOLING_ACTIVE/);
    // 既有合同不被自动改写
    const after = await k.pool.query(
      `SELECT approved_amount_minor, status, version FROM credit_facilities WHERE facility_id=$1`, [facilityId]);
    assert.equal(after.rows[0].approved_amount_minor, before.rows[0].approved_amount_minor, '批准额不变');
    assert.equal(after.rows[0].status, before.rows[0].status, '状态不变');
  } finally { await k.stop(); }
});
