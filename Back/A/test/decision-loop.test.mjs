// 任务02 · 决策闭环 B01–B14 集成测试（E1：隔离 PG + 真实 HTTP）。
// 运行前提：JW_A_ADMIN_DB_URL 指向隔离容器（jw-cc-kernel-pg@15444）。
// 纪律：测试金额/冷却值/规则全部为显式合成配置（matrix-dev-synthetic-1 / sim-pack-1），
// 不注册为正式制度；冷却秒数只在显式传参的用例中启用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { client, createTestDb, dropTestDb, newId, startKernel } from './utils.mjs';

const T1 = 't1';
const CAP = 1_000_000_000;
const wan = (n) => n * 1_000_000;

const V2_SPEC = [
  'tok-root=root:human:admin:all:all',
  'tok-biz1=biz1:human:business:all:t1',
  'tok-biz3=biz3:human:business:all:t1',
  'tok-cred1=cred1:human:credit:all:t1',
  'tok-cred2=cred2:human:credit:all:t1',
  'tok-app1=app1:human:approver:all:t1',
  'tok-app2=app2:human:approver:all:t1',
  'tok-agent1=agent1:agent:business:all:t1',
  'tok-cust1=cust1:human:customer:all:t1',
  'tok-policy=paul:human:policy:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
].join(',');

const POLICY_VERSION = 'domreq-loop-synthetic';
const PACK = 'sim-pack-1';

async function startLoopKernel(opts = {}) {
  const extra = ['--credit-matrix', 'matrix-dev-synthetic-1', '--credit-concentration', 'conc-dev-synthetic-1',
    '--required-domains-policy', POLICY_VERSION, '--allow-legacy-basis'];
  if (opts.cooling !== undefined) extra.push('--credit-cooling-seconds', String(opts.cooling));
  const k = await startKernel({ extraArgs: extra, principalSpec: V2_SPEC, dbUrl: opts.dbUrl ?? null, keepDb: opts.keepDb ?? false });
  await seedMatrix(k.pool);
  // 合成必需域政策（四域必需；A2 后必需域来自政策，不由调用者关闭）
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
       ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
     ON CONFLICT DO NOTHING`, [POLICY_VERSION]);
  return k;
}

async function seedMatrix(pool) {
  // 合成开发矩阵：仅证明机制，非公司制度
  await pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
       ('matrix-dev-synthetic-1','approver','facility.approve',true,$1),
       ('matrix-dev-synthetic-1','approver','facility.activate',true,$1),
       ('matrix-dev-synthetic-1','approver','facility.suspend',true,NULL),
       ('matrix-dev-synthetic-1','approver','facility.reduce',true,NULL),
       ('matrix-dev-synthetic-1','business','fr.confirm-external',true,$1)
     ON CONFLICT (matrix_version, role, action) DO NOTHING`, [CAP]);
}

function biz(k) { return client(k.base, 'tok-biz1'); }
function biz3(k) { return client(k.base, 'tok-biz3'); }
function cred(k) { return client(k.base, 'tok-cred1'); }
function cred2(k) { return client(k.base, 'tok-cred2'); }
function app1(k) { return client(k.base, 'tok-app1'); }
function app2(k) { return client(k.base, 'tok-app2'); }
function agent1(k) { return client(k.base, 'tok-agent1'); }
function cust1(k) { return client(k.base, 'tok-cust1'); }
function root(k) { return client(k.base, 'tok-root'); }
function policyP(k) { return client(k.base, 'tok-policy'); }
function svc(k) { return client(k.base, 'tok-svc'); }

async function makeCustomer(b, tenantId = T1) {
  const r = await b('POST', '/api/v2/customers', {
    requestId: newId('r'), tenantId, legalEntityRef: `LE-${newId('le')}`, displayName: '合成制造有限公司',
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function reg(b, customerId, payload) {
  const r = await b('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: newId('r'), tenantId: T1, ...payload,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

const GATE_CLEAR = { result: 'CLEAR', reasonCodes: [], ruleIds: [], rulePackVersion: PACK, evaluatedAt: '2026-09-17T08:00:00Z', blockedActions: [] };

/** 激活合成规则版本（A2：规则当前性的服务端事实源）。 */
async function activatePack(k, version = PACK) {
  const r = await policyP(k)('POST', '/api/v2/rule-pack-versions/activate', { requestId: newId('r'), tenantId: T1, version });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

/** 真实检查会话走到 ready_for_assessment（A2：收口引用由服务端解析，假会话 404）。 */
async function inspectionReadySession(k, customerId) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: newId('tpl'), name: 'tpl-loop',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await a('POST', '/api/v1/projects', { requestId: newId('proj'), templateId: tpl.json.templateId, name: 'proj-loop' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const s = await biz(k)('POST', `/api/v1/projects/${proj.json.projectId}/inspections`, {
    requestId: newId('sess'), customerId, title: '收口会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const sessionId = s.json.sessionId;
  const st = await biz(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: newId('st'), expectedVersion: 1 });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const snap = await biz(k)('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(snap.status, 200, JSON.stringify(snap.json));
  const itemId = snap.json.snapshot.items[0].itemId;
  const q = await biz(k)('POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: newId('q'), audience: 'internal', targetRole: 'business', question: '确认?', purpose: 'verify', itemId,
  });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const ans = await biz(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: newId('ans'), answer: { text: '确认无误' },
  });
  assert.equal(ans.status, 200, JSON.stringify(ans.json));
  const end = await biz(k)('POST', `/api/v1/inspections/${sessionId}/end`, { requestId: newId('end'), expectedVersion: 3 });
  assert.equal(end.status, 200, JSON.stringify(end.json));
  assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));
  return { sessionId, closureRevision: end.json.closureRevision ?? 1 };
}

/** 登记可信 Gate 回执（service 身份）。 */
async function gateReceiptId(k, customerId, { result = 'CLEAR', ruleIds = [], reasonCodes = [], version = PACK } = {}) {
  const r = await svc(k)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: newId('gr'), tenantId: T1, result, rulesetVersion: version, ruleIds, reasonCodes,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.receiptId;
}

/** 服务身份完成一次域分析运行并登记结果（A2：运行开始即盖章输入摘要）。 */
async function runAndRecord(k, customerId, packageId, domain, { artifactIds = [], factKeys = [], version = PACK } = {}) {
  const run = await svc(k)('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
    requestId: newId('run'), tenantId: T1, domain, deps: { artifactIds, factKeys, rulePackVersion: version },
  });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  const fin = await svc(k)('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, {
    requestId: newId('fin'), tenantId: T1, executionStatus: 'completed',
  });
  assert.equal(fin.status, 200, JSON.stringify(fin.json));
  const rr = await svc(k)('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
    requestId: newId('dr'), tenantId: T1, domain,
    analysisRun: { runId: run.json.runId, rulesetVersion: version },
    opinion: { findingType: 'observation', summary: `${domain} 域合成意见`, domain, authority: 'none' },
    deps: { artifactIds, factKeys, rulePackVersion: version },
  });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));
}

/** 冻结依据包（A2 机器：可信 Gate 回执 + 服务端解析收口引用）。 */
async function freezePackage(k, customerId, { assessmentId, domainDeps = [], candidate, gateResult = 'CLEAR', gatePatch = {} } = {}) {
  await activatePack(k);
  const receiptId = await gateReceiptId(k, customerId, { result: gateResult, ...gatePatch });
  const insp = await inspectionReadySession(k, customerId);
  const deps = domainDeps.map((d) => ({
    domain: d.domain, artifactIds: d.artifactIds ?? [], factKeys: d.factKeys ?? [],
    rulePackVersion: d.rulePackVersion ?? PACK,
  }));
  const created = await biz(k)('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: newId('r'), tenantId: T1, assessmentId, domainDeps: deps, gateReceiptId: receiptId,
    inspectionRevision: { sessionId: insp.sessionId }, candidate,
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return { packageId: created.json.packageId, receiptId, insp };
}

/** 评估走到 awaiting_human_review（候选 tendency=do）。 */
async function assessmentAwaiting(c, customerId, artifactIds, amountMinor = wan(50)) {
  const ass = await c('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: newId('r'), tenantId: T1, ruleVersion: 'rules-dev-1',
    evidenceSnapshot: artifactIds.map((artifactId) => ({ artifactId })),
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const assessmentId = ass.json.assessmentId;
  const cand = await c('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: amountMinor, currency: 'CNY', rationale: '', producedBy: 'test-harness', conditions: [], warnings: [] },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const sub = await c('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  return assessmentId;
}

/** 冻结依据包并为全部必需域登记结果（A2 机器：Gate 回执 + 服务身份运行登记）。 */
async function packageReady(k, customerId, { assessmentId, domainDeps, gate, inspection, candidate } = {}) {
  void gate; void inspection; // 旧签名兼容：Gate 一律走可信回执；收口一律服务端解析（假收口在 A2 下不可自证）
  const { packageId } = await freezePackage(k, customerId, { assessmentId, domainDeps, candidate });
  const depsByDomain = new Map((domainDeps ?? []).map((d) => [d.domain, d]));
  for (const domain of ['policy', 'credit', 'commerce', 'asset']) {
    const d = depsByDomain.get(domain) ?? {};
    await runAndRecord(k, customerId, packageId, domain, { artifactIds: d.artifactIds ?? [], factKeys: d.factKeys ?? [] });
  }
  const got = await biz(k)('GET', `/api/v2/decision-packages/${packageId}`);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.decisionReadiness, true, `包应就绪：${JSON.stringify(got.json.gaps)}`);
  return { packageId, basisVersion: got.json.package.basisVersion, revision: got.json.package.revision };
}

async function activeFacility(k, customerId, amountMinor, { packageId } = {}) {
  const b = biz(k); const c = cred(k); const a = app1(k);
  const art = await reg(b, customerId, { kind: 'customer_profile', factKey: 'profile', content: { rev: 1 }, grade: 'source_supported' });
  const assessmentId = await assessmentAwaiting(c, customerId, [art.artifactId], amountMinor);
  const prop = await c('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: newId('r'), tenantId: T1, assessmentId, approvedAmountMinor: amountMinor, currency: 'CNY',
    ...(packageId ? { packageId } : {}),
  });
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  const facilityId = prop.json.facilityId;
  const ap = await a('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'dev-matrix' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const ac = await a('POST', `/api/v2/facilities/${facilityId}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'dev-matrix' });
  assert.equal(ac.status, 200, JSON.stringify(ac.json));
  return { facilityId, assessmentId };
}

async function makeFR(b, customerId, facilityId, amountMinor) {
  const r = await b('POST', `/api/v2/customers/${customerId}/financing-requests`, {
    requestId: newId('r'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor, currency: 'CNY',
    equipmentRefs: ['eq-1'], contractRefs: ['ct-1'],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.frId;
}

async function reserve(b, frId) {
  return b('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: newId('r'), tenantId: T1 });
}

/** 意见差异（默认阻断 approve/use）。 */
async function addFinding(b, customerId, patch = {}) {
  const r = await b('POST', `/api/v2/customers/${customerId}/findings`, {
    requestId: newId('r'), tenantId: T1,
    findingType: 'verification_gap', assertion: '关键事实未经核验',
    responsibleRole: 'credit',
    impactScope: { actions: ['approve_facility', 'use_of_funds'], domains: ['credit'], blocking: true },
    requiredAction: { kind: 'verify', requiredEvidenceKinds: ['site_verification'], minGrade: 'confirmed' },
    ...patch,
  });
  return r;
}

// ---------------------------------------------------------------------------

test('B01 材料、生成场景及截图同源：不增加独立证明；真实核验缺口仍在', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    const decl = await reg(b, custId, { kind: 'equipment_declaration', factKey: 'equipment_list', content: { lines: 3 }, grade: 'unverified' });
    const scene = await reg(b, custId, {
      kind: 'scene_snapshot', factKey: null, content: { scene: 'gen' }, grade: 'unverified',
      provenance: { derivedFrom: [decl.artifactId], generator: 'scene-gen@1', generationKind: 'scene_build' },
    });
    // 派生链核验等级封顶：截图不得高于上游（上游 unverified → confirmed 被拒）
    const bad = await b('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: newId('r'), tenantId: T1, kind: 'scene_render', factKey: null, content: { px: 1 }, grade: 'confirmed',
      provenance: { derivedFrom: [scene.artifactId], generator: 'render@1', generationKind: 'render' },
    });
    assert.equal(bad.status, 400, '派生材料核验等级不得高于上游');
    const render = await reg(b, custId, {
      kind: 'scene_render', factKey: null, content: { px: 1 }, grade: 'unverified',
      provenance: { derivedFrom: [scene.artifactId], generator: 'render@1', generationKind: 'render' },
    });
    const list = await b('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.equal(list.json.independentProofs, 1, '同源三件只计一个独立证明');
    assert.equal(list.json.artifacts.length, 3, '三件并存且可各自追溯');

    const c = cred(k);
    const assessmentId = await assessmentAwaiting(c, custId, [decl.artifactId, scene.artifactId, render.artifactId]);
    const { packageId } = await freezePackage(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'asset', artifactIds: [decl.artifactId, scene.artifactId, render.artifactId], factKeys: [] }],
    });
    const got = await c('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.json.package.independentProofs, 1, '包层独立证明同样按根归并');

    // 真实核验缺口仍在：unverified 截图不能关闭"需 confirmed 现场核验"的差异
    const f = await addFinding(b, custId);
    assert.equal(f.status, 200);
    const deny = await c('POST', `/api/v2/findings/${f.json.findingId}/resolve`, {
      requestId: newId('r'), tenantId: T1, resolution: 'explained_verified', rationale: '截图齐全', expectedVersion: 1,
      evidenceRefs: [{ artifactId: render.artifactId }],
    });
    assert.equal(deny.status, 409, JSON.stringify(deny.json));
    assert.equal(deny.json.error, 'REVIEW_EVIDENCE_REQUIRED');
    const got2 = await c('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got2.json.decisionReadiness, false, '关键复核未关闭：包不得就绪');
    assert.ok(got2.json.gaps.some((g) => g.code === 'OPEN_BLOCKING_REVIEW'));
  } finally { await k.stop(); }
});

test('B02 发票/合同/付款/铭牌不一致：原件并存、逐项定位、后上传不覆盖前者', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    const inv = await reg(b, custId, { kind: 'invoice', factKey: 'equipment_price', content: { amountMinor: wan(372) }, grade: 'confirmed', materialMeta: { subjectRef: ' synth-mfg', periodFrom: '2026-08-01', page: 'p1' } });
    const con = await reg(b, custId, { kind: 'purchase_contract', factKey: 'equipment_price', content: { amountMinor: wan(380) }, grade: 'confirmed', materialMeta: { subjectRef: 'synth-mfg', periodFrom: '2026-08-01', page: 'amount-field' } });
    const pay = await reg(b, custId, { kind: 'payment_record', factKey: 'equipment_price', content: { amountMinor: wan(365) }, grade: 'confirmed', materialMeta: { periodFrom: '2026-08-10' } });
    const plate = await reg(b, custId, { kind: 'nameplate', factKey: 'equipment_price', content: { amountMinor: wan(379) }, grade: 'source_supported', materialMeta: { page: 'tag' } });
    const list = await b('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.equal(list.json.artifacts.filter((a) => a.current).length, 4, '四件原件并存');
    const conflict = list.json.factConflicts.find((x) => x.factKey === 'equipment_price');
    assert.ok(conflict && conflict.assertionCount === 4, '同键 4 断言显式冲突');

    const f = await b('POST', `/api/v2/customers/${custId}/findings`, {
      requestId: newId('r'), tenantId: T1, findingType: 'material_conflict',
      assertion: '设备价格四份材料不一致（发票/合同/付款/铭牌）',
      sideA: { artifactId: inv.artifactId, locator: 'p1', value: wan(372) },
      sideB: { artifactId: con.artifactId, locator: 'amount-field', value: wan(380) },
      responsibleRole: 'credit',
      impactScope: { actions: ['approve_facility'], domains: ['credit'], blocking: true },
      requiredAction: { kind: 'verify', requiredEvidenceKinds: ['price_reconciliation'], minGrade: 'confirmed' },
    });
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const got = await b('GET', `/api/v2/findings/${f.json.findingId}`);
    assert.equal(got.json.finding.sideA.artifactId, inv.artifactId, '冲突两侧出处逐项定位');
    assert.equal(got.json.finding.sideB.artifactId, con.artifactId);
    // 后上传不覆盖前者：即使再传同键新材料，四件依然各自现行
    await reg(b, custId, { kind: 'invoice', factKey: 'equipment_price', content: { amountMinor: wan(999), note: 'late' }, grade: 'confirmed' });
    const list2 = await b('GET', `/api/v2/customers/${custId}/artifacts`);
    for (const id of [inv.artifactId, con.artifactId, pay.artifactId, plate.artifactId]) {
      const row = list2.json.artifacts.find((a) => a.artifactId === id);
      assert.equal(row.current, true, `${id} 不得被后上传覆盖`);
    }
  } finally { await k.stop(); }
});

test('B03 主体/期间/口径不同：先标口径待解释，不造欺诈结论', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    await reg(b, custId, { kind: 'income_statement', factKey: 'revenue', content: { amountMinor: wan(1200) }, grade: 'source_supported', materialMeta: { subjectRef: 'synth-mfg', periodFrom: '2025-01-01', periodTo: '2025-12-31', unit: 'CNY-minor', caliber: 'tax_included' } });
    await reg(b, custId, { kind: 'bank_statement', factKey: 'revenue', content: { amountMinor: wan(980) }, grade: 'source_supported', materialMeta: { subjectRef: 'synth-mfg-sales', periodFrom: '2025-07-01', periodTo: '2026-06-30', unit: 'CNY-minor', caliber: 'cash_received' } });
    const f = await b('POST', `/api/v2/customers/${custId}/findings`, {
      requestId: newId('r'), tenantId: T1, findingType: 'caliber_difference',
      assertion: '收入材料主体/期间/含税与收付口径不一致：需先统一口径解释',
      sideA: { subjectRef: 'synth-mfg', period: 'FY2025', caliber: 'tax_included' },
      sideB: { subjectRef: 'synth-mfg-sales', period: '2025-07..2026-06', caliber: 'cash_received' },
      responsibleRole: 'business',
      impactScope: { actions: ['approve_facility'], domains: ['credit'], blocking: true },
      requiredAction: { kind: 'decision', requiredEvidenceKinds: ['caliber_statement'], minGrade: 'source_supported' },
    });
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const got = await b('GET', `/api/v2/findings/${f.json.findingId}`);
    assert.equal(got.json.finding.status, 'open', '口径差异保持待解释');
    assert.equal(got.json.finding.resolution, null, '服务端不自动给结论');
    const raw = JSON.stringify(got.json).toLowerCase();
    assert.ok(!raw.includes('fraud') && !raw.includes('欺诈'), '不得自动生成欺诈结论');
  } finally { await k.stop(); }
});

test('B04 客户说"没有问题"/顾问点"已知悉"：无所需证据不能关闭关键复核；硬门不能被 ack 绕过', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    const f = await addFinding(b, custId, {
      findingType: 'adverse_fact', assertion: '主体身份核验存疑（合成硬门场景）',
      ruleRef: { ruleId: 'SIM-ENTITY-IDENTITY-01', nonWaivable: true },
    });
    assert.equal(f.status, 200);
    const fid = f.json.findingId;
    const ack1 = await cred(k)('POST', `/api/v2/findings/${fid}/resolve`, {
      requestId: newId('r'), tenantId: T1, resolution: 'explained_verified', ackNote: '客户说没有问题，顾问已点已知悉', expectedVersion: 1,
    });
    assert.equal(ack1.status, 409, JSON.stringify(ack1.json));
    assert.equal(ack1.json.error, 'REVIEW_EVIDENCE_REQUIRED', 'ack/口述不能替代核验');
    const ack2 = await cred(k)('POST', `/api/v2/findings/${fid}/resolve`, {
      requestId: newId('r'), tenantId: T1, resolution: 'not_applicable', rationale: '管理员确认无关', expectedVersion: 1,
      waiverRef: { policyApproved: true, approvedBy: 'someone', validUntil: '2027-01-01' },
    });
    assert.equal(ack2.status, 409, JSON.stringify(ack2.json));
    assert.equal(ack2.json.error, 'POLICY_PENDING', '不可豁免规则无通用豁免（即便伪造 waiverRef）');
    // 提供满足声明的核验证据后才能关闭
    const ev = await reg(b, custId, { kind: 'site_verification', factKey: null, content: { verifiedBy: 'human-inspector' }, grade: 'confirmed' });
    const ok = await cred(k)('POST', `/api/v2/findings/${fid}/resolve`, {
      requestId: newId('r'), tenantId: T1, resolution: 'explained_verified', rationale: '现场人工核验成立', expectedVersion: 1,
      evidenceRefs: [{ artifactId: ev.artifactId }],
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  } finally { await k.stop(); }
});

test('B05 某域依赖已变：该域必须更新，未变域允许复用，不强迫全量重跑', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const own = await reg(b, custId, { kind: 'nameplate', factKey: 'ownership', content: { owner: 'synth-mfg' }, grade: 'confirmed' });
    const { packageId, revision } = await packageReady(k, custId, {
      domainDeps: [
        { domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true },
        { domain: 'asset', artifactIds: [own.artifactId], factKeys: ['ownership'], required: true },
      ],
    });
    // 相关新证据进入 credit 域依赖的事实键
    await reg(b, custId, { kind: 'bank_statement', factKey: 'revenue_2025', content: { amountMinor: wan(900) }, grade: 'source_supported' });
    const refreshed = await c('POST', `/api/v2/decision-packages/${packageId}/refresh-currency`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));
    const cur = Object.fromEntries(refreshed.json.currency.map((v) => [v.domain, v]));
    assert.equal(cur.credit.currency, 'changed', '依赖已变域必须更新');
    assert.equal(cur.credit.reusable, false);
    assert.equal(cur.asset.currency, 'current', '依赖未变域保持复用');
    assert.equal(cur.asset.reusable, true, '不为水位一致强迫重跑');
    assert.equal(refreshed.json.status, 'draft', '包退出就绪');
    assert.ok(refreshed.json.gaps.some((g) => g.code === 'DOMAIN_DEPS_CHANGED' && g.domain === 'credit'));
    // credit 域更新后包复就绪；asset 结果版本不变（未重跑、未混入新判断）
    const assetBefore = await c('GET', `/api/v2/decision-packages/${packageId}`);
    const assetVer = assetBefore.json.domainResults.find((r) => r.domain === 'asset').opinionVersion;
    await runAndRecord(k, custId, packageId, 'credit', { artifactIds: [rev.artifactId], factKeys: ['revenue_2025'] });
    const after = await c('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(after.json.decisionReadiness, true, '仅更新了变化的域即可复就绪');
    assert.equal(after.json.package.status, 'ready');
    const assetAfter = after.json.domainResults.find((r) => r.domain === 'asset').opinionVersion;
    assert.equal(assetAfter, assetVer, 'asset 域意见未被改写/重跑');
    assert.equal(after.json.package.revision, revision, '复就绪不产生新修订');
  } finally { await k.stop(); }
});

test('B06 无关留言不全量重算；相关不利材料只影响真实依赖与相应动作', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const own = await reg(b, custId, { kind: 'nameplate', factKey: 'ownership', content: { owner: 'synth-mfg' }, grade: 'confirmed' });
    const { packageId } = await packageReady(k, custId, {
      domainDeps: [
        { domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true },
        { domain: 'asset', artifactIds: [own.artifactId], factKeys: ['ownership'], required: true },
      ],
    });
    // 无关留言：不入任何域依赖
    await reg(b, custId, { kind: 'chat_message', factKey: null, content: { text: '（合成）会话寒暄' }, grade: 'unverified' });
    const r1 = await c('POST', `/api/v2/decision-packages/${packageId}/refresh-currency`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(r1.status, 200);
    assert.equal(r1.json.status, 'ready', '无关留言不触发重算');
    assert.ok(r1.json.currency.every((v) => v.currency === 'current'));
    // 相关不利材料：命中 asset 域依赖的事实键
    await reg(b, custId, { kind: 'court_record', factKey: 'ownership', content: { dispute: 'ownership-dispute' }, grade: 'source_supported' });
    const r2 = await c('POST', `/api/v2/decision-packages/${packageId}/refresh-currency`, { requestId: newId('r'), tenantId: T1 });
    const cur = Object.fromEntries(r2.json.currency.map((v) => [v.domain, v]));
    assert.equal(cur.asset.currency, 'changed', '不利材料只影响真实依赖域');
    assert.equal(cur.credit.currency, 'current', '无关域不受牵连');
    assert.equal(r2.json.decisionReadiness, false);
    assert.ok(r2.json.blockedActions.includes('submit_package'));
    // 事件面：ReviewRequired 已发布
    const evs = await b('GET', `/api/v2/customers/${custId}/events?after=0&limit=100`);
    const types = evs.json.events.map((e) => e.eventType);
    assert.ok(types.includes('REVIEW_REQUIRED'), 'ReviewRequired 事件必须发布');
  } finally { await k.stop(); }
});

test('B07 新证据先提交、旧审批随后提交：正式命令失败，零不合法正式效果', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k); const a = app1(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const assessmentId = await assessmentAwaiting(c, custId, [rev.artifactId]);
    const { packageId } = await packageReady(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true }],
      candidate: { producedBy: 'test-harness', amountMinor: wan(50), currency: 'CNY' },
    });
    const prop = await c('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId, approvedAmountMinor: wan(50), currency: 'CNY', packageId,
    });
    assert.equal(prop.status, 200, JSON.stringify(prop.json));
    const facilityId = prop.json.facilityId;
    // 不利新证据先入库（命中依赖事实键）
    await reg(b, custId, { kind: 'tax_overdue_notice', factKey: 'revenue_2025', content: { overdue: true }, grade: 'source_supported' });
    // 旧依据的批准随后提交 → 必须失败或进入复核
    const ap = await a('POST', `/api/v2/facilities/${facilityId}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'dev-matrix' });
    assert.equal(ap.status, 409, JSON.stringify(ap.json));
    assert.equal(ap.json.error, 'STALE_BASIS', '依赖已变 → STALE_BASIS');
    // 零不合法正式效果
    const got = await a('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(got.json.facility.status, 'proposed', '设施状态未被推进');
    const evs = await b('GET', `/api/v2/customers/${custId}/events?after=0&limit=200`);
    assert.ok(!evs.json.events.map((e) => e.eventType).includes('FACILITY_APPROVED'), '无批准事件');
    assert.ok(!evs.json.events.map((e) => e.eventType).includes('FORMAL_DECISION_RECORDED'), '无正式决定事件');
  } finally { await k.stop(); }
});

test('B08 批准先完成、随后不利证据：历史不变；新用信按当前依据阻断，不沿用旧 CLEAR', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const own = await reg(b, custId, { kind: 'nameplate', factKey: 'ownership', content: { owner: 'synth-mfg' }, grade: 'confirmed' });
    const assessmentId = await assessmentAwaiting(c, custId, [rev.artifactId, own.artifactId]);
    const { packageId } = await packageReady(k, custId, {
      assessmentId,
      domainDeps: [
        { domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true },
        { domain: 'asset', artifactIds: [own.artifactId], factKeys: ['ownership'], required: true },
      ],
    });
    const { facilityId } = await activeFacility(k, custId, wan(50), { packageId });
    const frId = await makeFR(b, custId, facilityId, wan(20));
    const r0 = await reserve(b, frId);
    assert.equal(r0.status, 200, JSON.stringify(r0.json));
    await b('POST', `/api/v2/financing-requests/${frId}/release`, { requestId: newId('r'), tenantId: T1 });
    // 批准完成后出现不利证据（命中 asset 域依赖）
    await reg(b, custId, { kind: 'court_record', factKey: 'ownership', content: { dispute: 'ownership-dispute' }, grade: 'source_supported' });
    // 历史决定不变
    const fac = await b('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(fac.json.facility.status, 'active', '已完成批准不改写');
    // 新用信按当前依据阻断（不能沿用旧 CLEAR）
    const fr2 = await makeFR(b, custId, facilityId, wan(10));
    const r2 = await reserve(b, fr2);
    assert.equal(r2.status, 409, JSON.stringify(r2.json));
    assert.equal(r2.json.error, 'STALE_BASIS', '依据已变：新用信不得沿用旧批准');
    // 用信准备视图如实给出阻断与原因
    const ur = await b('GET', `/api/v2/financing-requests/${fr2}/use-readiness`);
    assert.equal(ur.status, 200);
    assert.equal(ur.json.canProceed, false);
    assert.ok(ur.json.blockers.some((x) => x.code === 'STALE_BASIS'));
  } finally { await k.stop(); }
});

test('B09 两主体同时复核/批准同一版本：版本与权限保护成立，不静默互覆', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k); const b3 = biz3(k);
    const custId = await makeCustomer(b);
    const ev = await reg(b, custId, { kind: 'site_verification', factKey: null, content: { by: 'inspector' }, grade: 'confirmed' });
    const f = await addFinding(b, custId);
    assert.equal(f.status, 200);
    // 两个主体对同一版本同时给出不同处理
    const [r1, r2] = await Promise.all([
      c('POST', `/api/v2/findings/${f.json.findingId}/resolve`, {
        requestId: newId('r'), tenantId: T1, resolution: 'explained_verified', rationale: 'cred1 核验成立', expectedVersion: 1,
        evidenceRefs: [{ artifactId: ev.artifactId }],
      }),
      cred2(k)('POST', `/api/v2/findings/${f.json.findingId}/resolve`, {
        requestId: newId('r'), tenantId: T1, resolution: 'adverse_confirmed', rationale: 'cred2 确认不利', expectedVersion: 1,
      }),
    ]);
    const codes = [r1.status, r2.status].sort();
    assert.deepEqual(codes, [200, 409], '恰好一人成功，另一人版本冲突');
    const loser = r1.status === 409 ? r1 : r2;
    assert.equal(loser.json.error, 'VERSION_CONFLICT');
    const got = await b('GET', `/api/v2/findings/${f.json.findingId}`);
    const expectedOutcome = r1.status === 200 ? 'explained_verified' : 'adverse_confirmed';
    assert.equal(got.json.finding.resolution.outcome, expectedOutcome, '最终处理结果=胜出方，未被静默覆盖');
    assert.equal(got.json.finding.version, 2, '版本推进一次');
    // 并发批准同一设施
    const cust2 = await makeCustomer(b);
    const { facilityId } = await activeFacility(k, cust2, wan(30));
    const prop = await cred(k)('POST', `/api/v2/customers/${cust2}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId: (await assessmentAwaiting(cred(k), cust2, [(await reg(b, cust2, { kind: 'customer_profile', factKey: 'profile', content: { rev: 1 }, grade: 'source_supported' })).artifactId])), approvedAmountMinor: wan(40), currency: 'CNY',
    });
    assert.equal(prop.status, 200);
    const fac2 = prop.json.facilityId;
    const [p1, p2] = await Promise.all([
      app1(k)('POST', `/api/v2/facilities/${fac2}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'a' }),
      app2(k)('POST', `/api/v2/facilities/${fac2}/approve`, { requestId: newId('r'), tenantId: T1, rationale: 'b' }),
    ]);
    const approveCodes = [p1.status, p2.status].sort();
    assert.deepEqual(approveCodes, [200, 409], '并发批准恰好一人成功');
    const evs = await b('GET', `/api/v2/customers/${cust2}/events?after=0&limit=200`);
    assert.equal(evs.json.events.filter((e) => e.eventType === 'FACILITY_APPROVED' && e.payload.facilityId === fac2).length, 1,
      '该设施仅一次批准效果');
  } finally { await k.stop(); }
});

test('B10 同一客户不同申请并发预占：共享同一额度约束，新项目/重试不重复占用', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    const { facilityId } = await activeFacility(k, custId, wan(100));
    const frA = await makeFR(b, custId, facilityId, wan(60));
    const frB = await makeFR(b, custId, facilityId, wan(60));
    const [rA, rB] = await Promise.all([reserve(b, frA), reserve(b, frB)]);
    const codes = [rA.status, rB.status].sort();
    assert.deepEqual(codes, [200, 409], '超额并发恰好一预占成功');
    assert.equal((rA.status === 409 ? rA : rB).json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');
    const expo = await b('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(expo.json.facilities[0].reservedMinor, wan(60), '账本只有一笔预占');
    // 容量内并发：剩余 40 万由两笔各 20 并发填满，共享同一 100 上限
    const frC = await makeFR(b, custId, facilityId, wan(20));
    const frD = await makeFR(b, custId, facilityId, wan(20));
    const [rC, rD] = await Promise.all([reserve(b, frC), reserve(b, frD)]);
    assert.equal(rC.status, 200);
    assert.equal(rD.status, 200, '容量内并发都成功（客户锁串行记账）');
    // 新项目 + 重试不能绕过约束
    const frE = await b('POST', `/api/v2/customers/${custId}/financing-requests`, {
      requestId: newId('r'), tenantId: T1, facilityId, productType: 'sale_leaseback', amountMinor: wan(50), currency: 'CNY',
      equipmentRefs: ['eq-2'], contractRefs: ['ct-2'],
    });
    assert.equal(frE.status, 200);
    const rE = await reserve(b, frE.json.frId);
    assert.equal(rE.status, 409, '新交易方式/新申请不得放大总额');
    const expo2 = await b('GET', `/api/v2/customers/${custId}/exposure`);
    assert.equal(expo2.json.facilities[0].exposureNowMinor, wan(100), '有效占用=预占推导，无可乘之机');
  } finally { await k.stop(); }
});

test('B11 提额冷却期内发现关键矛盾：复核与新动作立即阻断，不等待冷却', async () => {
  const k = await startLoopKernel({ cooling: 3600 });
  try {
    const b = biz(k); const c = cred(k); const a = app1(k);
    const custId = await makeCustomer(b);
    // 首额度 50 万：不触发冷却
    await activeFacility(k, custId, wan(50));
    // 提额到 80 万：批准进入冷却
    const art = await reg(b, custId, { kind: 'customer_profile', factKey: 'profile2', content: { rev: 2 }, grade: 'source_supported' });
    const assessmentId = await assessmentAwaiting(c, custId, [art.artifactId], wan(80));
    const prop = await c('POST', `/api/v2/customers/${custId}/facilities`, {
      requestId: newId('r'), tenantId: T1, assessmentId, approvedAmountMinor: wan(80), currency: 'CNY',
    });
    assert.equal(prop.status, 200);
    const fac2 = prop.json.facilityId;
    const ap = await a('POST', `/api/v2/facilities/${fac2}/approve`, { requestId: newId('r'), tenantId: T1, rationale: '提额' });
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    const view = await a('GET', `/api/v2/facilities/${fac2}`);
    assert.ok(view.json.exposure.staleBlockers.includes('cooling_active'), '提额进入冷却');
    // 冷却期内发现关键矛盾
    const f = await addFinding(b, custId, {
      findingType: 'adverse_fact', assertion: '（合成）关键不利事实',
      ruleRef: { ruleId: 'SIM-ADVERSE-DEMO', nonWaivable: false },
      impactScope: { actions: ['approve_facility', 'activate_facility', 'use_of_funds'], domains: ['credit'], blocking: true },
    });
    assert.equal(f.status, 200);
    // 激活先被差异阻断（REVIEW_REQUIRED，而不是等冷却结束）
    const act1 = await a('POST', `/api/v2/facilities/${fac2}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(act1.status, 409, JSON.stringify(act1.json));
    assert.equal(act1.json.error, 'REVIEW_REQUIRED', '差异复核不等待冷却');
    // 差异复核本身不受冷却影响：补证据后可关闭
    const ev = await reg(b, custId, { kind: 'site_verification', factKey: null, content: { by: 'inspector' }, grade: 'confirmed' });
    const rs = await c('POST', `/api/v2/findings/${f.json.findingId}/resolve`, {
      requestId: newId('r'), tenantId: T1, resolution: 'explained_verified', rationale: '核验成立', expectedVersion: 1,
      evidenceRefs: [{ artifactId: ev.artifactId }],
    });
    assert.equal(rs.status, 200, '冷却不阻断复核');
    // 差异关闭后，冷却仍未到期 → 激活仍被冷却阻断
    const act2 = await a('POST', `/api/v2/facilities/${fac2}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(act2.status, 409);
    assert.equal(act2.json.error, 'COOLING_ACTIVE', '冷却期未到不得生效');
    // 冷却到期（白盒时钟推进）后激活成功
    await k.pool.query(`UPDATE credit_facilities SET cooling_until = now() - interval '1 second' WHERE facility_id=$1`, [fac2]);
    const act3 = await a('POST', `/api/v2/facilities/${fac2}/activate`, { requestId: newId('r'), tenantId: T1, rationale: 'x' });
    assert.equal(act3.status, 200, JSON.stringify(act3.json));
  } finally { await k.stop(); }
});

test('B12 预占/批准响应丢失：幂等查回执恢复；报告重复生成不重做业务', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k);
    const custId = await makeCustomer(b);
    const { facilityId } = await activeFacility(k, custId, wan(100));
    const frId = await makeFR(b, custId, facilityId, wan(30));
    // 响应丢失：同 requestId 原样重发
    const rid = newId('r');
    const first = await b('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: rid, tenantId: T1 });
    assert.equal(first.status, 200);
    const again = await b('POST', `/api/v2/financing-requests/${frId}/reserve`, { requestId: rid, tenantId: T1 });
    assert.equal(again.status, 200);
    assert.equal(again.json.replayed, true, '重放返回原响应');
    assert.equal(again.json.exposure.reservedMinor, wan(30), '账本不重复占用');
    const receipt = await b('GET', `/api/v2/receipts/${rid}`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.json.found, true, '回执可查');
    // 报告重复生成：同状态 → 同一行；不触发任何批准/预占
    const facBefore = await b('GET', `/api/v2/facilities/${facilityId}`);
    const rep1 = await b('POST', `/api/v2/customers/${custId}/reports`, {
      requestId: newId('r'), tenantId: T1, kind: 'use_prep_sheet', subjectId: frId,
    });
    assert.equal(rep1.status, 200, JSON.stringify(rep1.json));
    assert.equal(rep1.json.regenerated, false);
    const rep2 = await b('POST', `/api/v2/customers/${custId}/reports`, {
      requestId: newId('r'), tenantId: T1, kind: 'use_prep_sheet', subjectId: frId,
    });
    assert.equal(rep2.status, 200);
    assert.equal(rep2.json.regenerated, true, '重复生成返回既有报告');
    assert.equal(rep2.json.reportId, rep1.json.reportId);
    assert.equal(rep2.json.version, rep1.json.version);
    const facAfter = await b('GET', `/api/v2/facilities/${facilityId}`);
    assert.equal(facAfter.json.facility.version, facBefore.json.facility.version, '报告生成不改变业务版本');
    // 缺正式交易条件（无租赁物/合同引用）→ 不得输出"已可支付"
    const frBare = await b('POST', `/api/v2/customers/${custId}/financing-requests`, {
      requestId: newId('r'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(5), currency: 'CNY',
    });
    assert.equal(frBare.status, 200);
    const urBare = await b('GET', `/api/v2/financing-requests/${frBare.json.frId}/use-readiness`);
    assert.equal(urBare.json.canProceed, false);
    assert.ok(urBare.json.blockers.some((x) => x.code === 'TRANSACTION_TERMS_MISSING'), '缺要件不得可支付');
    // 报告可导出 JSON 与 Markdown
    const md = await b('GET', `/api/v2/reports/${rep1.json.reportId}?format=markdown`);
    assert.equal(md.status, 200);
    assert.ok(md.json.report.markdown.includes('# 逐笔用信准备单'));
  } finally { await k.stop(); }
});

test('B13 客户请求内部报告/事件/证据地址：服务端拒绝，元数据与阈值不泄漏', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k); const cu = cust1(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const assessmentId = await assessmentAwaiting(c, custId, [rev.artifactId]);
    const { packageId } = await packageReady(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true }],
      gatePatch: { ruleIds: ['SIM-CASH-COVERAGE-01'], reasonCodes: ['INTERNAL_REASON'] },
    });
    const rep = await b('POST', `/api/v2/customers/${custId}/reports`, {
      requestId: newId('r'), tenantId: T1, kind: 'internal_summary', subjectId: packageId,
    });
    assert.equal(rep.status, 200, JSON.stringify(rep.json));
    // 客户 principal 打内部地址 → 统一拒绝且无内部元数据
    const denyReport = await cu('GET', `/api/v2/reports/${rep.json.reportId}`);
    assert.equal(denyReport.status, 403, JSON.stringify(denyReport.json));
    assert.ok(!JSON.stringify(denyReport.json).includes('SIM-CASH-COVERAGE-01'), '阈值/规则 id 不泄漏');
    const denyEvents = await cu('GET', `/api/v2/customers/${custId}/events?after=0&limit=50`);
    assert.equal(denyEvents.status, 403, '内部事件流对客户关闭');
    const denyArtifacts = await cu('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.equal(denyArtifacts.status, 403, '证据清单地址对客户关闭');
    for (const r of [denyReport, denyEvents, denyArtifacts]) {
      assert.equal(r.json.ok, false);
      assert.ok(!('gate' in r.json) && !('thresholds' in r.json), '错误响应不携带内部结构');
    }
    // 客户可见补证说明（customer audience）对客户开放，且为白名单投影
    const sup = await b('POST', `/api/v2/customers/${custId}/reports`, {
      requestId: newId('r'), tenantId: T1, kind: 'customer_supplement', subjectId: custId,
    });
    assert.equal(sup.status, 200, JSON.stringify(sup.json));
    const seen = await cu('GET', `/api/v2/reports/${sup.json.reportId}`);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const contentStr = JSON.stringify(seen.json.report.content) + seen.json.report.markdown;
    for (const leak of ['SIM-', 'ruleIds', 'gate', 'authority', 'producedBy', 'amountMinor']) {
      assert.ok(!contentStr.includes(leak), `客户投影不得包含内部字段：${leak}`);
    }
  } finally { await k.stop(); }
});

test('B14 场景对象重命名/重新导入：旧依据可追溯；显式重关联才能转移，不悄悄继承', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k);
    const custId = await makeCustomer(b);
    const press = await reg(b, custId, {
      kind: 'nameplate', factKey: 'ownership', content: { owner: 'synth-mfg' }, grade: 'confirmed',
      objectRef: { objectId: 'obj-press-A', sceneVersion: 'v1' },
    });
    const assessmentId = await assessmentAwaiting(c, custId, [press.artifactId]);
    const { packageId } = await packageReady(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'asset', artifactIds: [press.artifactId], factKeys: ['ownership'], required: true }],
    });
    // 场景重建：压机以新对象重新导入
    const press2 = await reg(b, custId, {
      kind: 'nameplate', factKey: null, content: { owner: 'synth-mfg', reimported: true }, grade: 'confirmed',
      objectRef: { objectId: 'obj-press-B', sceneVersion: 'v2' },
    });
    // 旧证据仍绑定原始 objectId+sceneVersion；旧包依据可追溯且依赖未变（不悄悄转移到新对象）
    const list = await b('GET', `/api/v2/customers/${custId}/artifacts`);
    const oldRow = list.json.artifacts.find((a) => a.artifactId === press.artifactId);
    assert.deepEqual(oldRow.objectRef, { objectId: 'obj-press-A', sceneVersion: 'v1', sceneId: null }, '历史绑定不被改写');
    const inv = await b('GET', `/api/v2/customers/${custId}/object-inventory`);
    const objA = inv.json.objects.find((o) => o.objectId === 'obj-press-A');
    const objB = inv.json.objects.find((o) => o.objectId === 'obj-press-B');
    assert.ok(objA && objA.relinkRequired === true, '未映射对象待重新关联');
    assert.ok(objB && objB.artifactIds.includes(press2.artifactId));
    assert.ok(!objB.artifactIds.includes(press.artifactId), '新对象不悄悄继承旧核验对象');
    const pkgState = await c('POST', `/api/v2/decision-packages/${packageId}/refresh-currency`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(pkgState.json.status, 'ready', '旧对象依据未变：包不因重建而失真');
    // 显式人工重关联：双方 id 可追溯；历史行仍不改写
    const rl = await b('POST', `/api/v2/customers/${custId}/object-relinks`, {
      requestId: newId('r'), tenantId: T1,
      mappings: [{ fromObjectId: 'obj-press-A', toObjectId: 'obj-press-B', toSceneVersion: 'v2', rationale: '现场确认同一台压机重新导入' }],
    });
    assert.equal(rl.status, 200, JSON.stringify(rl.json));
    const inv2 = await b('GET', `/api/v2/customers/${custId}/object-inventory`);
    const objA2 = inv2.json.objects.find((o) => o.objectId === 'obj-press-A');
    assert.equal(objA2.relinkRequired, false);
    assert.equal(objA2.relinkedTo.toObjectId, 'obj-press-B');
    const list2 = await b('GET', `/api/v2/customers/${custId}/artifacts`);
    assert.deepEqual(list2.json.artifacts.find((a) => a.artifactId === press.artifactId).objectRef.objectId, 'obj-press-A', '原始绑定永不改写');
  } finally { await k.stop(); }
});

test('B-EX 事件契约：五类决策闭环事件齐备（AssessmentBasisRevised/ReviewRequired/PackageReady/FormalDecision/UseReadiness）', async () => {
  const k = await startLoopKernel();
  try {
    const b = biz(k); const c = cred(k);
    const custId = await makeCustomer(b);
    const rev = await reg(b, custId, { kind: 'income_statement', factKey: 'revenue_2025', content: { amountMinor: wan(1200) }, grade: 'source_supported' });
    const assessmentId = await assessmentAwaiting(c, custId, [rev.artifactId]);
    const { packageId } = await packageReady(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'], required: true }],
    });
    const { facilityId } = await activeFacility(k, custId, wan(50), { packageId });
    const frId = await makeFR(b, custId, facilityId, wan(20));
    assert.equal((await reserve(b, frId)).status, 200);
    // 依据修订（显式新修订：A2 机器下同样走可信 Gate 回执 + 服务端解析收口）+ 未决差异
    const rev2p = await freezePackage(k, custId, {
      assessmentId,
      domainDeps: [{ domain: 'credit', artifactIds: [rev.artifactId], factKeys: ['revenue_2025'] }],
    });
    const pkg2 = rev2p.packageId;
    await addFinding(b, custId);
    // §4 消费面直接断言：candidate / approved / available / reportRefs / reviewQueue
    const rep = await b('POST', `/api/v2/customers/${custId}/reports`, {
      requestId: newId('r'), tenantId: T1, kind: 'internal_summary', subjectId: pkg2,
    });
    assert.equal(rep.status, 200, JSON.stringify(rep.json));
    const st = await b('GET', `/api/v2/customers/${custId}/decision-status`);
    assert.equal(st.status, 200, JSON.stringify(st.json));
    assert.equal(st.json.basis.basisVersion, `${pkg2}:2`, '指向最新修订');
    assert.equal(st.json.basis.status, 'draft', '域未更新+未决差异 → 未就绪');
    assert.equal(st.json.basis.decisionReadiness, false);
    assert.ok(st.json.basis.gaps.some((g) => g.code === 'OPEN_BLOCKING_REVIEW'));
    assert.equal(st.json.basis.candidate.authority, 'none', 'candidate 输出且 authority=none');
    assert.equal(st.json.facilityTotalsMinor.active, wan(50), 'approved/active 面');
    assert.equal(st.json.facilityTotalsMinor.available, wan(30), '可用额=批准-预占（同一账本推导）');
    assert.equal(st.json.reviewQueue.length, 1, '未决差异入 reviewQueue');
    assert.equal(st.json.reviewQueue[0].findingType, 'verification_gap');
    assert.ok(st.json.reportRefs.some((r) => r.kind === 'internal_summary' && r.subjectId === pkg2), '报告引用可追溯');
    const evs = await b('GET', `/api/v2/customers/${custId}/events?after=0&limit=500`);
    const types = new Set(evs.json.events.map((e) => e.eventType));
    for (const expected of ['ASSESSMENT_BASIS_REVISED', 'REVIEW_REQUIRED', 'DECISION_PACKAGE_READY', 'FORMAL_DECISION_RECORDED', 'USE_READINESS_CHANGED']) {
      assert.ok(types.has(expected), `缺少事件 ${expected}`);
    }
  } finally { await k.stop(); }
});
