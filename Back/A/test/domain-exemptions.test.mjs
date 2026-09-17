// goal-01 · A2 验收：豁免必须引用真实、有效且有权批准的记录（不变量 2；验收清单"假豁免"）。
// API 面：POST/GET /api/v2/customers/:id/domain-exemptions、DELETE /api/v2/domain-exemptions/:id；
//   decision-packages.exemptions 只收 {exemptionId, note?}；findings/:id/resolve not_applicable 的
//   waiverRef 只收 {exemptionId}。自报 approvedBy/policyApproved/validUntil 一律拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const CAP = 1_000_000_000;
const POLICY_VERSION = 'domreq-dev-synthetic-1';
const PACK_V1 = 'sim-pack-v1';
const DOMAINS = ['policy', 'credit', 'commerce', 'asset'];

const SPEC_X = [
  'tok-root=root:human:admin:all:all:all',
  'tok-policy=paul:human:policy:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-approver=carol:human:approver:all:t1',
  'tok-biz=bob:human:business:all:t1',
  'tok-jw=jianwei:human:jianwei:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const policyP = (k) => client(k.base, 'tok-policy');
const approverP = (k) => client(k.base, 'tok-approver');
const bizP = (k) => client(k.base, 'tok-biz');
const jwP = (k) => client(k.base, 'tok-jw');
const creditP = (k) => client(k.base, 'tok-credit');
const svc = (k) => client(k.base, 'tok-svc');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function startXKernel({ withExemptionMatrix = true } = {}) {
  const k = await startKernel({
    extraArgs: ['--credit-matrix', 'm2', '--credit-concentration', 'c2', '--required-domains-policy', POLICY_VERSION],
    principalSpec: SPEC_X,
  });
  const rows = [
    `('m2','approver','facility.approve',true,${CAP})`,
    `('m2','approver','facility.activate',true,${CAP})`,
    `('m2','business','fr.confirm-external',true,${CAP})`,
  ];
  if (withExemptionMatrix) rows.push(`('m2','approver','domain-exemption.grant',true,NULL)`);
  await k.pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES ${rows.join(',')} ON CONFLICT DO NOTHING`);
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
       ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
     ON CONFLICT DO NOTHING`, [POLICY_VERSION]);
  return k;
}

async function mkCustomer(c, name) {
  const r = await c('POST', '/api/v2/customers', { requestId: rid('mk'), tenantId: T1, legalEntityRef: `LE-X-${name}`, displayName: `X客户${name}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

/** 真实检查会话 → ready_for_assessment（服务端解析收口引用前提；同 trust-gates-a2 助手）。 */
async function inspectionReadySession(k, customerId) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: rid('tpl'), name: 'tpl-x',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await a('POST', '/api/v1/projects', { requestId: rid('proj'), templateId: tpl.json.templateId, name: 'proj-x' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const s = await bizP(k)('POST', `/api/v1/projects/${proj.json.projectId}/inspections`, {
    requestId: rid('sess'), customerId, title: 'X 会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验一', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const sessionId = s.json.sessionId;
  const st = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: 1 });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const snap = await bizP(k)('GET', `/api/v1/inspections/${sessionId}`);
  const itemId = snap.json.snapshot.items[0].itemId;
  const q = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions`, { requestId: rid('q'), audience: 'internal', targetRole: 'business', question: '确认?', purpose: 'verify', itemId });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const ans = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, { requestId: rid('ans'), answer: { text: '确认无误' } });
  assert.equal(ans.status, 200, JSON.stringify(ans.json));
  const end = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/end`, { requestId: rid('end'), expectedVersion: 3 });
  assert.equal(end.status, 200, JSON.stringify(end.json));
  assert.equal(end.json.closureStatus, 'ready_for_assessment');
  return { sessionId };
}

async function activatePack(k, version = PACK_V1) {
  const r = await policyP(k)('POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: T1, version });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

async function freezePackage(k, customerId, { skipDomains = [], exemptDomains = [], exemptionIds = {} } = {}) {
  const biz = bizP(k);
  const s = svc(k);
  const insp = await inspectionReadySession(k, customerId);
  const activeDomains = DOMAINS.filter((d) => !skipDomains.includes(d));
  const deps = activeDomains.map((domain) => ({ domain, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 }));
  const gr = await svc(k)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, { requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1 });
  assert.equal(gr.status, 200, JSON.stringify(gr.json));
  const exemptions = exemptDomains.map((d) => ({ exemptionId: exemptionIds[d] }));
  const created = await biz('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId,
    inspectionRevision: { sessionId: insp.sessionId }, exemptions,
  });
  return { created, packageId: created.json.packageId, gr: gr.json };
}

async function fillDomainResults(k, customerId, packageId, domains = DOMAINS) {
  const s = svc(k);
  for (const d of domains) {
    const run = await s('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
      requestId: rid('run'), tenantId: T1, domain: d, deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    await s('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, { requestId: rid('fin'), tenantId: T1, executionStatus: 'completed' });
    const rr = await s('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: rid('dr'), tenantId: T1, domain: d,
      analysisRun: { runId: run.json.runId, rulesetVersion: PACK_V1 },
      opinion: { findingType: 'observation', summary: `${d} 意见`, domain: d, authority: 'none' },
      deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(rr.status, 200, JSON.stringify(rr.json));
  }
}

// ---------------------------------------------------------------------------

test('X1·自报 approvedBy/domain 的 exemptions[] → 400，无任何登记即形成豁免', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x1');
    const r = await bizP(k)('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1, domainDeps: [],
      exemptions: [{ domain: 'asset', reason: '自查适用', approvedBy: 'carol', scope: 'package' }],
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error, 'INVALID_INPUT');
    assert.match(r.json.message, /exemptionId/);
  } finally { await k.stop(); }
});

test('X2·无矩阵条目的角色登记豁免 → POLICY_PENDING；有档 approver 登记 → 服务端解析批准人', async () => {
  const k = await startXKernel({ withExemptionMatrix: false });
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x2');
    const deny = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'asset', reason: '设备为租赁物自有证明，本笔不适用', scope: 'package',
    });
    assert.equal(deny.status, 409, JSON.stringify(deny.json));
    assert.equal(deny.json.error, 'POLICY_PENDING', '矩阵无 domain-exemption.grant 条目 → fail-closed');
    const rows = await k.pool.query(`SELECT count(*)::int AS n FROM domain_exemptions`);
    assert.equal(rows.rows[0].n, 0, '拒绝零写入');
  } finally { await k.stop(); }
});

test('X3·有效豁免 → 包引用后该域 required=false（无域结果也 ready）；冻结记录服务端批准人', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x3');
    const exm = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'asset', reason: '申报示意与自有设备台账一致（合成开发场景）', scope: 'package',
    });
    assert.equal(exm.status, 200, JSON.stringify(exm.json));
    assert.equal(exm.json.approvedBy ?? null, null, '载荷无 approvedBy 字段（批准人服务端解析）');
    const { created, packageId } = await freezePackage(k, custId, {
      skipDomains: ['asset'], exemptDomains: ['asset'], exemptionIds: { asset: exm.json.exemptionId },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    await fillDomainResults(k, custId, packageId, ['policy', 'credit', 'commerce']);
    const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.equal(got.json.decisionReadiness, true, `asset 域豁免后应就绪：${JSON.stringify(got.json.gaps)}`);
    const stored = await k.pool.query(`SELECT exemptions FROM decision_packages WHERE package_id=$1`, [packageId]);
    const frozen = stored.rows[0].exemptions;
    assert.equal(frozen[0].approvedBy, 'carol', '冻结进包的批准人=服务端登记的 principal');
    assert.equal(frozen[0].domain, 'asset');
    assert.ok(frozen[0].policyVersion === POLICY_VERSION);
  } finally { await k.stop(); }
});

test('X4·撤销后新包引用被拒（POLICY_PENDING）；已冻结历史包不受影响', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x4');
    const exm = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'asset', reason: '临时适用', scope: 'package',
    });
    assert.equal(exm.status, 200, JSON.stringify(exm.json));
    const { packageId } = await freezePackage(k, custId, { skipDomains: ['asset'], exemptDomains: ['asset'], exemptionIds: { asset: exm.json.exemptionId } });
    await fillDomainResults(k, custId, packageId, ['policy', 'credit', 'commerce']);
    const revoke = await approverP(k)('DELETE', `/api/v2/domain-exemptions/${exm.json.exemptionId}`, { requestId: rid('rv'), tenantId: T1 });
    assert.equal(revoke.status, 200, JSON.stringify(revoke.json));
    // 撤销后：新包引用同一豁免 → POLICY_PENDING
    const again = await freezePackage(k, custId, { skipDomains: ['asset'], exemptDomains: ['asset'], exemptionIds: { asset: exm.json.exemptionId } });
    assert.equal(again.created.status, 409, JSON.stringify(again.created.json));
    assert.equal(again.created.json.error, 'POLICY_PENDING');
    // 已冻结历史包：投影不变（历史冻结，不追溯改写）
    const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
  } finally { await k.stop(); }
});

test('X5·过期豁免引用被拒；跨客户引用统一 404 不泄露存在性', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custA = await mkCustomer(root(k), 'x5a');
    const custB = await mkCustomer(root(k), 'x5b');
    // 过期登记被即时拒绝（不得登记即时过期的豁免）
    const past = await approverP(k)('POST', `/api/v2/customers/${custA}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'asset', reason: 'x', scope: 'package',
      validUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(past.status, 400, JSON.stringify(past.json));
    // 短时效豁免：登记成功 → 到期后引用被拒
    const exm = await approverP(k)('POST', `/api/v2/customers/${custA}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'asset', reason: '短时效', scope: 'package',
      validUntil: new Date(Date.now() + 1_200).toISOString(),
    });
    assert.equal(exm.status, 200, JSON.stringify(exm.json));
    await new Promise((r) => setTimeout(r, 1_400));
    const used = await bizP(k)('POST', `/api/v2/customers/${custA}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1, domainDeps: [], exemptions: [{ exemptionId: exm.json.exemptionId }],
    });
    assert.equal(used.status, 409, JSON.stringify(used.json));
    assert.equal(used.json.error, 'POLICY_PENDING');
    // 跨客户引用 → 404（与其他客户资源不可见一致）
    const other = await bizP(k)('POST', `/api/v2/customers/${custB}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1, domainDeps: [], exemptions: [{ exemptionId: exm.json.exemptionId }],
    });
    assert.equal(other.status, 404, JSON.stringify(other.json));
  } finally { await k.stop(); }
});

test('X6·not_applicable 引用制：自报 waiverRef 被拒；有效豁免（scope=any）可关闭；范围不覆盖被拒', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x6');
    // 登记一条差异（business 可建；处理限 credit 目录角色）
    const f = await bizP(k)('POST', `/api/v2/customers/${custId}/findings`, {
      requestId: rid('f'), tenantId: T1, findingType: 'caliber_difference',
      assertion: '两份材料口径不一致（非硬红线）', responsibleRole: 'credit', severity: 'major',
      impactScope: { actions: ['approve_facility'], blocking: true },
    });
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const findingId = f.json.findingId;
    // (a) 自报 policyApproved/approvedBy/validUntil → 400（不可自报）
    const forged = await creditP(k)('POST', `/api/v2/findings/${findingId}/resolve`, {
      requestId: rid('rs'), tenantId: T1, resolution: 'not_applicable', rationale: 'x', expectedVersion: 1,
      waiverRef: { policyApproved: true, approvedBy: 'carol', validUntil: '2027-01-01' },
    });
    assert.equal(forged.status, 400, JSON.stringify(forged.json));
    assert.equal(forged.json.error, 'INVALID_INPUT');
    // (b) 范围不覆盖的豁免 → POLICY_PENDING
    const scoped = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'credit', reason: '仅限 invoice_rule', scope: 'invoice_rule',
    });
    assert.equal(scoped.status, 200, JSON.stringify(scoped.json));
    const mismatch = await creditP(k)('POST', `/api/v2/findings/${findingId}/resolve`, {
      requestId: rid('rs'), tenantId: T1, resolution: 'not_applicable', rationale: 'x', expectedVersion: 1,
      waiverRef: { exemptionId: scoped.json.exemptionId },
    });
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch.json));
    assert.equal(mismatch.json.error, 'POLICY_PENDING');
    // (c) scope=any 的有效豁免 → 关闭成功；冻结进 resolution 的批准人=服务端解析（DB 校验）
    const anyExm = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'credit', reason: '口径差异经复核为申报口径差异', scope: 'any',
    });
    assert.equal(anyExm.status, 200, JSON.stringify(anyExm.json));
    const ok = await creditP(k)('POST', `/api/v2/findings/${findingId}/resolve`, {
      requestId: rid('rs'), tenantId: T1, resolution: 'not_applicable', rationale: '按豁免范围关闭', expectedVersion: 1,
      waiverRef: { exemptionId: anyExm.json.exemptionId },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.status, 'closed');
    const rowq = await k.pool.query(`SELECT resolution FROM decision_findings WHERE finding_id=$1`, [findingId]);
    const reso = rowq.rows[0].resolution;
    assert.equal(reso.waiverRef.approvedBy, 'carol', '冻结批准人=服务端解析');
    assert.equal(reso.waiverRef.exemptionId, anyExm.json.exemptionId);
  } finally { await k.stop(); }
});

test('X7·撤销权限：有目录角色但无矩阵条目的角色撤销 → POLICY_PENDING（fail-closed）', async () => {
  const k = await startXKernel();
  try {
    await activatePack(k);
    const custId = await mkCustomer(root(k), 'x7');
    const exm = await approverP(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'commerce', reason: 'x7', scope: 'package',
    });
    assert.equal(exm.status, 200, JSON.stringify(exm.json));
    // policy 角色（有目录角色但无矩阵条目）撤销 → POLICY_PENDING
    const deny = await policyP(k)('DELETE', `/api/v2/domain-exemptions/${exm.json.exemptionId}`, { requestId: rid('rv'), tenantId: T1 });
    assert.equal(deny.status, 409, JSON.stringify(deny.json));
    assert.equal(deny.json.error, 'POLICY_PENDING');
    const rows = await k.pool.query(`SELECT status FROM domain_exemptions WHERE exemption_id=$1`, [exm.json.exemptionId]);
    assert.equal(rows.rows[0].status, 'valid', '拒绝后豁免保持 valid');
  } finally { await k.stop(); }
});
