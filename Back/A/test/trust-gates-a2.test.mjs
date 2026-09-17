// 任务01·A2 提交边界测试：Gate/检查收口/分析来源不可自证（审核 F02/F03/F06；验收 K05–K11）。
// 必须先失败（RED）后通过（GREEN）。API 面由本文件冻结：
//   POST /api/v2/rule-pack-versions/activate                 （policy 人类；激活规则版本）
//   POST /api/v2/customers/:id/rule-gate-receipts            （service 身份；登记 Gate 回执）
//   POST /api/v2/customers/:id/analysis-runs/start|finish    （service 身份；运行开止登记）
//   createPackage/revisePackage: gateReceiptId + inspectionRevision.sessionId + 政策必需域 + exemptions
//   recordGateResult: {gateReceiptId}；recordDomainResult: analysisRun.runId 必须命中运行登记
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const CAP = 1_000_000_000;

// service 身份（C 路运行器）；kind=service 在 A2 落地后由 config 接受。
// 服务身份同时持有四域目录角色：域结果登记按"获准服务身份或相应域权限"两种语义下均可登记。
const SPEC_A2 = [
  'tok-root=root:human:admin:all:all:all',
  'tok-policy=paul:human:policy:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-approver=carol:human:approver:all:t1',
  'tok-biz=bob:human:business:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
].join(',');

const POLICY_VERSION = 'domreq-dev-synthetic-1';
const PACK_V1 = 'sim-pack-v1';
const PACK_V2 = 'sim-pack-v2';

function root(k) { return client(k.base, 'tok-root'); }
function policyP(k) { return client(k.base, 'tok-policy'); }
function creditP(k) { return client(k.base, 'tok-credit'); }
function bizP(k) { return client(k.base, 'tok-biz'); }
function svc(k) { return client(k.base, 'tok-svc'); }

async function startA2Kernel(extra = [], principalSpec = SPEC_A2) {
  const k = await startKernel({
    extraArgs: ['--credit-matrix', 'm2', '--credit-concentration', 'c2', '--required-domains-policy', POLICY_VERSION, ...extra],
    principalSpec,
  });
  await k.pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
       ('m2','approver','facility.approve',true,$1),
       ('m2','approver','facility.activate',true,$1),
       ('m2','approver','facility.suspend',true,NULL),
       ('m2','business','fr.confirm-external',true,$1)
     ON CONFLICT DO NOTHING`, [CAP]);
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
       ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
     ON CONFLICT DO NOTHING`, [POLICY_VERSION]);
  return k;
}

async function mkCustomer(c, name) {
  const r = await c('POST', '/api/v2/customers', {
    requestId: `mk-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: T1, legalEntityRef: `LE-A2-${name}`, displayName: `A2客户${name}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function activatePack(c, version) {
  const r = await c('POST', '/api/v2/rule-pack-versions/activate', { requestId: `rp-${version}-${Date.now()}`, tenantId: T1, version });
  assert.equal(r.status, 200, `激活规则版本 ${version}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function gateReceipt(k, customerId, result, version = PACK_V1, patch = {}) {
  const r = await svc(k)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: `gr-${result}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: T1, result, rulesetVersion: version, ...patch,
  });
  return r;
}

/** 真实检查会话走到 ready_for_assessment（服务端解析收口引用的前提）。 */
async function inspectionReadySession(k, customerId) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: 'tpl-a2',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await a('POST', '/api/v1/projects', { requestId: `proj-${Date.now()}`, templateId: tpl.json.templateId, name: 'proj-a2' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const projectId = proj.json.projectId;
  const s = await bizP(k)('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: `sess-${Date.now()}`, customerId, title: 'A2 会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验一', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] }],
  });
  assert.equal(s.status, 200, `建会话: ${JSON.stringify(s.json)}`);
  const sessionId = s.json.sessionId;
  const st = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: `st-${Date.now()}`, expectedVersion: 1 });
  assert.equal(st.status, 200, `开始会话: ${JSON.stringify(st.json)}`);
  const snap = await bizP(k)('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(snap.status, 200, JSON.stringify(snap.json));
  const itemId = snap.json.snapshot.items[0].itemId;
  const q = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: `q-${Date.now()}`, audience: 'internal', targetRole: 'business', question: '确认?', purpose: 'verify', itemId,
  });
  assert.equal(q.status, 200, `提问: ${JSON.stringify(q.json)}`);
  const ans = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: `ans-${Date.now()}`, answer: { text: '确认无误' },
  });
  assert.equal(ans.status, 200, `回答: ${JSON.stringify(ans.json)}`);
  const end = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/end`, { requestId: `end-${Date.now()}`, expectedVersion: 3 });
  assert.equal(end.status, 200, `结束: ${JSON.stringify(end.json)}`);
  assert.equal(end.json.closureStatus, 'ready_for_assessment', `收口应 ready_for_assessment: ${JSON.stringify(end.json)}`);
  return { sessionId, closureRevision: end.json.closureRevision ?? 1 };
}

const DOMAINS = ['policy', 'credit', 'commerce', 'asset'];

/** 完整走完 A2 语义的包（四必需域 + Gate 回执 + 真实收口引用 + 各域运行结果），返回 packageId。 */
async function freezeCompletePackage(k, customerId, { gateResult = 'CLEAR', packVersion = PACK_V1, inspection = null, gatePatch = {} } = {}) {
  const biz = bizP(k);
  const s = svc(k);
  const insp = inspection ?? (await inspectionReadySession(k, customerId));
  const deps = DOMAINS.map((domain) => ({ domain, artifactIds: [], factKeys: [], rulePackVersion: packVersion }));
  const gr = await gateReceipt(k, customerId, gateResult, packVersion, gatePatch);
  assert.equal(gr.status, 200, `Gate 回执: ${JSON.stringify(gr.json)}`);
  const created = await biz('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: insp.sessionId },
  });
  assert.equal(created.status, 200, `冻结: ${JSON.stringify(created.json)}`);
  const packageId = created.json.packageId;
  for (const d of DOMAINS) {
    const run = await s('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
      requestId: `run-${d}-${Date.now()}`, tenantId: T1, domain: d,
      deps: { artifactIds: [], factKeys: [], rulePackVersion: packVersion },
    });
    assert.equal(run.status, 200, `运行开始 ${d}: ${JSON.stringify(run.json)}`);
    const fin = await s('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, {
      requestId: `fin-${d}-${Date.now()}`, tenantId: T1, executionStatus: 'completed',
    });
    assert.equal(fin.status, 200, `运行完成 ${d}: ${JSON.stringify(fin.json)}`);
    const rr = await s('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: `dr-${d}-${Date.now()}`, tenantId: T1, domain: d,
      analysisRun: { runId: run.json.runId, rulesetVersion: packVersion },
      opinion: { findingType: "observation", summary: `${d} 域意见`, domain: d, authority: "none" },
      deps: { artifactIds: [], factKeys: [], rulePackVersion: packVersion },
    });
    assert.equal(rr.status, 200, `域结果 ${d}: ${JSON.stringify(rr.json)}`);
  }
  const got = await biz('GET', `/api/v2/decision-packages/${packageId}`);
  return { packageId, got: got.json };
}

// ---------------------------------------------------------------------------

test('K05: 自报 gate JSON / []domains / 假收口引用 不可形成有效 ready', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k05');
    const biz = bizP(k);
    // (a) 自由 JSON gate 被拒：必须引用可信回执
    const a = await biz('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `k05a-${Date.now()}`, tenantId: T1,
      gate: { result: 'CLEAR', rulePackVersion: PACK_V1 }, domainDeps: [],
    });
    assert.equal(a.status, 400, `自由 JSON gate 应 400：${JSON.stringify(a.json)}`);
    // (b) 假会话引用被拒（服务端解析：不存在的会话 404，不泄露其它信息）
    const b = await biz('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `k05b-${Date.now()}`, tenantId: T1,
      inspectionRevision: { sessionId: 'sess-not-exist', closureStatus: 'closed', closureRevision: 99 }, domainDeps: [],
    });
    assert.equal(b.status, 404, `假收口引用应 404：${JSON.stringify(b.json)}`);
    // (c) 即便收口真实，[]domains 也不 ready：必需域来自政策，缺失 → draft + 具体缺口
    const gr = await gateReceipt(k, custId, 'CLEAR');
    assert.equal(gr.status, 200, JSON.stringify(gr.json));
    const insp = await inspectionReadySession(k, custId);
    const c = await biz('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `k05c-${Date.now()}`, tenantId: T1,
      gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: insp.sessionId }, domainDeps: [],
    });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.status, 'draft', '[]domains 不得 ready');
    assert.ok(c.json.gaps.some((g) => g.code === 'REQUIRED_DOMAIN_MISSING'), `缺必需域缺口：${JSON.stringify(c.json.gaps)}`);
    // (d) HOLD 回执即使域齐也不 ready（K06 交叉在 K06 详测；此处锁"自报 CLEAR 无效"后的对照）
    const full = await freezeCompletePackage(k, custId, { gateResult: 'HOLD_FOR_REVIEW' });
    assert.equal(full.got.decisionReadiness, false, 'HOLD 不得 ready');
    assert.ok(full.got.gaps.some((g) => g.code === 'GATE_HOLD_FOR_REVIEW'), `HOLD 缺口：${JSON.stringify(full.got.gaps)}`);
  } finally { await k.stop(); }
});

test('K06: Gate 四状态 × 正式动作 交叉表（HOLD/NEEDS_EVIDENCE/HARD_BLOCK 均不得产生正式效果）', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k06');
    for (const result of ['NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK']) {
      const { packageId, got } = await freezeCompletePackage(k, custId, { gateResult: result });
      assert.equal(got.decisionReadiness, false, `${result} 不得 ready：${JSON.stringify(got.gaps)}`);
      // 提交点：批准被 GATE_BLOCKED 拒绝且零正式效果
      const art = await bizP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
        requestId: `art-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
      });
      assert.equal(art.status, 200, JSON.stringify(art.json));
      const ass = await creditP(k)('POST', `/api/v2/customers/${custId}/assessments`, {
        requestId: `ass-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
      });
      assert.equal(ass.status, 200, JSON.stringify(ass.json));
      const cand = await creditP(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
        requestId: `cand-${Date.now()}`, tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: 100000, producedBy: 'k06' },
      });
      assert.equal(cand.status, 200, JSON.stringify(cand.json));
      const rev = await creditP(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev-${Date.now()}`, tenantId: T1 });
      assert.equal(rev.status, 200, JSON.stringify(rev.json));
      const prop = await creditP(k)('POST', `/api/v2/customers/${custId}/facilities`, {
        requestId: `prop-${Date.now()}`, tenantId: T1, assessmentId: ass.json.assessmentId,
        approvedAmountMinor: 100000, currency: 'CNY', packageId,
      });
      assert.equal(prop.status, 200, `提案（绑定 ${result} 包）: ${JSON.stringify(prop.json)}`);
      const apr = await client(k.base, 'tok-approver')('POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, {
        requestId: `apr-${Date.now()}`, tenantId: T1, rationale: 'k06',
      });
      assert.equal(apr.status, 409, `${result} 下批准应 409：${JSON.stringify(apr.json)}`);
      assert.match(String(apr.json?.error ?? ''), /GATE_BLOCKED/, `${result} 应报 GATE_BLOCKED`);
    }
    // CLEAR 对照：同一构造应就绪且批准可行
    const clear = await freezeCompletePackage(k, custId, { gateResult: 'CLEAR' });
    assert.equal(clear.got.decisionReadiness, true, `CLEAR 应 ready：${JSON.stringify(clear.got.gaps)}`);
  } finally { await k.stop(); }
});

test('K07: 正式路径必须绑定依据包——无包提案被拒；旧数据只读、批准/用信被阻断；legacy 通道显式开启才可用', async () => {
  // 严格核（默认）：提案必须带 packageId
  const k1 = await startA2Kernel();
  try {
    await activatePack(policyP(k1), PACK_V1);
    const custId = await mkCustomer(root(k1), 'k07a');
    const art = await creditP(k1)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `art-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
    });
    const ass = await creditP(k1)('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: `ass-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    const noPkg = await creditP(k1)('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: `prop-${Date.now()}`, tenantId: T1, assessmentId: ass.json.assessmentId,
      approvedAmountMinor: 100000, currency: 'CNY',
    });
    assert.equal(noPkg.status, 409, `无包提案应 409：${JSON.stringify(noPkg.json)}`);
    assert.match(String(noPkg.json?.error ?? ''), /BASIS_PACKAGE_REQUIRED/);
    // 旧数据（无包 basis 的存量行）白盒注入：批准/激活被阻断，行只读保留
    const legacyFac = `fac-legacy-${Date.now()}`;
    await k1.pool.query(
      `INSERT INTO credit_facilities (facility_id, tenant_id, customer_id, approved_amount_minor, currency, basis, status, created_by)
       VALUES ($1,$2,$3,100000,'CNY',$4::jsonb,'proposed','legacy-import')`,
      [legacyFac, T1, custId, JSON.stringify({ assessmentId: ass.json.assessmentId, legacy: true })],
    );
    const aprLegacy = await client(k1.base, 'tok-approver')('POST', `/api/v2/facilities/${legacyFac}/approve`, {
      requestId: `apr-${Date.now()}`, tenantId: T1, rationale: 'k07',
    });
    assert.equal(aprLegacy.status, 409, `旧数据批准应被阻断：${JSON.stringify(aprLegacy.json)}`);
    const still = await k1.pool.query(`SELECT status FROM credit_facilities WHERE facility_id=$1`, [legacyFac]);
    assert.equal(still.rows[0].status, 'proposed', '旧数据不被改写（只读可解释）');
  } finally { await k1.stop(); }
  // 兼容核（显式 --allow-legacy-basis）：旧数据可按评估复查路径批准（兼容策略；契约记录截止窗口）
  const k2 = await startA2Kernel(['--allow-legacy-basis']);
  try {
    const custId = await mkCustomer(root(k2), 'k07b');
    const art = await creditP(k2)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `art2-${Date.now()}`, tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
    });
    const ass = await creditP(k2)('POST', `/api/v2/customers/${custId}/assessments`, {
      requestId: `ass2-${Date.now()}`, tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
    });
    const cand = await creditP(k2)('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
      requestId: `cand2-${Date.now()}`, tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: 100000, producedBy: 'k07' },
    });
    assert.equal(cand.status, 200, JSON.stringify(cand.json));
    const rev = await creditP(k2)('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: `rev2-${Date.now()}`, tenantId: T1 });
    assert.equal(rev.status, 200, JSON.stringify(rev.json));
    const legacyFac = `fac-legacy2-${Date.now()}`;
    await k2.pool.query(
      `INSERT INTO credit_facilities (facility_id, tenant_id, customer_id, approved_amount_minor, currency, basis, status, created_by)
       VALUES ($1,$2,$3,100000,'CNY',$4::jsonb,'proposed','legacy-import')`,
      [legacyFac, T1, custId, JSON.stringify({ assessmentId: ass.json.assessmentId, legacy: true })],
    );
    const apr = await client(k2.base, 'tok-approver')('POST', `/api/v2/facilities/${legacyFac}/approve`, {
      requestId: `apr2-${Date.now()}`, tenantId: T1, rationale: 'legacy lane',
    });
    assert.equal(apr.status, 200, `显式兼容核应可批准：${JSON.stringify(apr.json)}`);
  } finally { await k2.stop(); }
});

test('K08: Run 用旧输入，期间补不利材料，晚到旧结果 → 保留并标失效，不重新盖章 current', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k08');
    const biz = bizP(k);
    const insp = await inspectionReadySession(k, custId);
    const gr = await gateReceipt(k, custId, 'CLEAR');
    const deps = DOMAINS.map((domain) => ({ domain, artifactIds: [], factKeys: domain === 'credit' ? ['revenue_2025'] : [], rulePackVersion: PACK_V1 }));
    const created = await biz('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `pkg-${Date.now()}`, tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId,
      inspectionRevision: { sessionId: insp.sessionId },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const packageId = created.json.packageId;
    // credit 域：声明依赖事实键 revenue_2025 → 运行开始（A 盖章当时输入摘要 D1）
    const s = svc(k);
    const run = await s('POST', `/api/v2/customers/${custId}/analysis-runs/start`, {
      requestId: `run-${Date.now()}`, tenantId: T1, domain: 'credit',
      deps: { artifactIds: [], factKeys: ['revenue_2025'], rulePackVersion: PACK_V1 },
    });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    // 期间补不利材料（同一事实键新增断言 → 当前摘要变为 D2）
    const adverse = await biz('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `adv-${Date.now()}`, tenantId: T1, kind: 'credit_adverse_note', factKey: 'revenue_2025',
      content: { note: '收入下修' }, grade: 'source_supported',
    });
    assert.equal(adverse.status, 200, JSON.stringify(adverse.json));
    // 运行完成并登记晚到结果：允许登记（历史事实），但不得标为 current
    const fin = await s('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, {
      requestId: `fin-${Date.now()}`, tenantId: T1, executionStatus: 'completed',
    });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    const rr = await s('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: `dr-${Date.now()}`, tenantId: T1, domain: 'credit',
      analysisRun: { runId: run.json.runId, rulesetVersion: PACK_V1 },
      opinion: { findingType: 'observation', summary: '晚到的 credit 意见', domain: 'credit', authority: 'none' },
      deps: { artifactIds: [], factKeys: ['revenue_2025'], rulePackVersion: PACK_V1 },
    });
    assert.equal(rr.status, 200, `晚到结果可登记（历史事实）：${JSON.stringify(rr.json)}`);
    const got = await biz('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200);
    const creditVerdict = got.json.currency.find((v) => v.domain === 'credit');
    assert.equal(creditVerdict.currency, 'changed', `旧结果不得视为 current：${JSON.stringify(creditVerdict)}`);
    assert.ok(creditVerdict.reasons.includes('deps_changed'), `失效原因：${JSON.stringify(creditVerdict.reasons)}`);
    assert.equal(got.json.decisionReadiness, false, '含失效域的包不得 ready');
    assert.equal(got.json.domainResults.filter((r) => r.domain === 'credit').length, 1, '旧结果保留可追溯');
  } finally { await k.stop(); }
});

test('K09: failed/timeout/not_configured 运行不得满足必需域', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k09');
    const insp = await inspectionReadySession(k, custId);
    const gr = await gateReceipt(k, custId, 'CLEAR');
    const deps = DOMAINS.map((domain) => ({ domain, artifactIds: [], factKeys: domain === 'credit' ? ['revenue_2025'] : [], rulePackVersion: PACK_V1 }));
    const created = await bizP(k)('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `pkg-${Date.now()}`, tenantId: T1, domainDeps: deps, gateReceiptId: gr.json.receiptId,
      inspectionRevision: { sessionId: insp.sessionId },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const packageId = created.json.packageId;
    const s = svc(k);
    for (const [domain, status] of [['policy', 'failed'], ['commerce', 'timeout'], ['asset', 'not_configured']]) {
      const run = await s('POST', `/api/v2/customers/${custId}/analysis-runs/start`, {
        requestId: `run-${domain}-${Date.now()}`, tenantId: T1, domain,
        deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
      });
      assert.equal(run.status, 200, JSON.stringify(run.json));
      const fin = await s('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, {
        requestId: `fin-${domain}-${Date.now()}`, tenantId: T1, executionStatus: status,
      });
      assert.equal(fin.status, 200, JSON.stringify(fin.json));
      const rr = await s('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
        requestId: `dr-${domain}-${Date.now()}`, tenantId: T1, domain,
        analysisRun: { runId: run.json.runId, rulesetVersion: PACK_V1 },
        opinion: { findingType: 'observation', summary: `${domain} ${status}`, domain, authority: 'none' },
        deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
      });
      assert.equal(rr.status, 409, `${status} 运行登记应 409：${JSON.stringify(rr.json)}`);
      assert.match(String(rr.json?.error ?? ''), /ANALYSIS_RUN_NOT_COMPLETED/);
    }
    const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    const missing = got.json.currency.filter((v) => ['policy', 'commerce', 'asset'].includes(v.domain));
    for (const v of missing) {
      assert.equal(v.currency, 'missing', `无 completed 运行的必需域不得视为完成：${JSON.stringify(v)}`);
      assert.equal(v.opinionVersion, 0, `不得产生意见版本：${JSON.stringify(v)}`);
    }
  } finally { await k.stop(); }
});

test('K10: 规则正式换版 → 旧意见/Gate 失效（仅适用域），无关域不滥重算', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k10');
    // credit/policy 域声明 v1；commerce/asset 域声明 v2（换版后仍现行）
    const insp = await inspectionReadySession(k, custId);
    const gr = await gateReceipt(k, custId, 'CLEAR', PACK_V1);
    const deps = [
      { domain: 'policy', artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
      { domain: 'credit', artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
      { domain: 'commerce', artifactIds: [], factKeys: [], rulePackVersion: PACK_V2 },
      { domain: 'asset', artifactIds: [], factKeys: [], rulePackVersion: PACK_V2 },
    ];
    // commerce/asset 的 v2 声明需要 v2 已激活才能通过运行登记 → 先临时激活 v2 再回到 v1？——
    // 语义约束：运行 rulePackVersion 必须 = 当前激活版本。因此本用例改为：全部 v1 冻结就绪后换版 v2，
    // 断言 v1 域 changed、Gate 失效；"无关域不滥重算"以 evidence 未变的 commerce 域在 v2 下重跑后保持 current 证明。
    void deps;
    const base = await freezeCompletePackage(k, custId, { packVersion: PACK_V1, inspection: insp });
    assert.equal(base.got.decisionReadiness, true, `v1 应就绪：${JSON.stringify(base.got.gaps)}`);
    // 正式换版
    await activatePack(policyP(k), PACK_V2);
    const refreshed = await bizP(k)('POST', `/api/v2/decision-packages/${base.packageId}/refresh-currency`, {
      requestId: `rf-${Date.now()}`, tenantId: T1,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));
    for (const d of ['policy', 'credit', 'commerce', 'asset']) {
      const v = refreshed.json.currency.find((x) => x.domain === d);
      assert.equal(v.currency, 'changed', `换版后 v1 域 ${d} 应 changed：${JSON.stringify(v)}`);
      assert.ok(v.reasons.includes('rule_version_changed'), `应报规则换版原因：${JSON.stringify(v.reasons)}`);
    }
    assert.equal(refreshed.json.status, 'draft', '换版后包退出 ready');
    assert.ok(refreshed.json.gaps.some((g) => g.code === 'GATE_STALE_RULES'), `Gate 应失效：${JSON.stringify(refreshed.json.gaps)}`);
    // 无关域不滥重算：commerce 在 v2 下重跑后，其 verdict 恢复 current，且 policy/credit 不因 commerce 更新而被改写
    const s = svc(k);
    const run2 = await s('POST', `/api/v2/customers/${custId}/analysis-runs/start`, {
      requestId: `run2-${Date.now()}`, tenantId: T1, domain: 'commerce',
      deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V2 },
    });
    assert.equal(run2.status, 200, JSON.stringify(run2.json));
    await s('POST', `/api/v2/analysis-runs/${run2.json.runId}/finish`, { requestId: `fin2-${Date.now()}`, tenantId: T1, executionStatus: 'completed' });
    const rr2 = await s('POST', `/api/v2/decision-packages/${base.packageId}/domain-results`, {
      requestId: `dr2-${Date.now()}`, tenantId: T1, domain: 'commerce',
      analysisRun: { runId: run2.json.runId, rulesetVersion: PACK_V2 },
      opinion: { findingType: 'observation', summary: 'commerce v2 意见', domain: 'commerce', authority: 'none' },
      deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V2 },
    });
    assert.equal(rr2.status, 200, `v2 结果登记：${JSON.stringify(rr2.json)}`);
    const got2 = await bizP(k)('GET', `/api/v2/decision-packages/${base.packageId}`);
    const commerce2 = got2.json.currency.find((v) => v.domain === 'commerce');
    assert.equal(commerce2.currency, 'current', `commerce v2 应 current：${JSON.stringify(commerce2)}`);
    const credit2 = got2.json.currency.find((v) => v.domain === 'credit');
    assert.equal(credit2.currency, 'changed', 'credit 域不因 commerce 更新被改写');
  } finally { await k.stop(); }
});

test('K11: 原件被取代后派生截图不增加独立证明；缺口具体可见；失效派生依赖冻结被拒', async () => {
  const k = await startA2Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'k11');
    const biz = bizP(k);
    const orig = await biz('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `orig-${Date.now()}`, tenantId: T1, kind: 'equipment_photo', factKey: 'equipment', content: { px: 1 }, grade: 'unverified',
    });
    assert.equal(orig.status, 200, JSON.stringify(orig.json));
    const shot1 = await biz('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `s1-${Date.now()}`, tenantId: T1, kind: 'scene_render', content: { px: 2 }, grade: 'unverified',
      provenance: { derivedFrom: [orig.json.artifactId], generator: 'render@1', generationKind: 'render' },
    });
    assert.equal(shot1.status, 200, JSON.stringify(shot1.json));
    const shot2 = await biz('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `s2-${Date.now()}`, tenantId: T1, kind: 'scene_render', content: { px: 3 }, grade: 'unverified',
      provenance: { derivedFrom: [orig.json.artifactId], generator: 'render@1', generationKind: 'render' },
    });
    assert.equal(shot2.status, 200, JSON.stringify(shot2.json));
    // 原件被更正版取代
    const fixed = await biz('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: `fix-${Date.now()}`, tenantId: T1, kind: 'equipment_photo', factKey: 'equipment', content: { px: 9 }, grade: 'unverified',
      supersedes: orig.json.artifactId,
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    const list = await biz('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    // 两个派生截图同根（原件已被取代 → 同源失效依赖），独立证明不得按 2 件新增
    const gaps = list.json.derivationGaps ?? [];
    const taintedShots = gaps.filter((g) => [shot1.json.artifactId, shot2.json.artifactId].includes(g.artifactId));
    assert.equal(taintedShots.length, 2, `派生缺口应具体到两个截图：${JSON.stringify(gaps)}`);
    for (const g of taintedShots) assert.match(String(g.reason), /upstream_superseded/);
    // 冻结引用失效派生件 → 拒绝并给出具体缺口
    const insp = await inspectionReadySession(k, custId);
    const gr = await gateReceipt(k, custId, 'CLEAR');
    const created = await biz('POST', `/api/v2/customers/${custId}/decision-packages`, {
      requestId: `pkg-${Date.now()}`, tenantId: T1,
      gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: insp.sessionId },
      domainDeps: DOMAINS.map((domain) => ({ domain, artifactIds: [shot1.json.artifactId], factKeys: [], rulePackVersion: PACK_V1 })),
    });
    assert.equal(created.status, 409, `引用失效派生件冻结应 409：${JSON.stringify(created.json)}`);
    assert.match(String(created.json?.message ?? '') + String(created.json?.error ?? ''), /upstream_superseded|ARTIFACT_SUPERSEDED/);
  } finally { await k.stop(); }
});
