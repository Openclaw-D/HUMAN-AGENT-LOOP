// 任务03（权威查询与授权支撑）· 五项待复验风险的真实 PG 反例复验。
// 原则（任务书）：先建真实数据库反例，再判断是否需要修改；不把旧版本缺陷自动当成现版本仍有；
// 不用历史全绿关闭；测试预期全部来自当前有效契约（Back/CONTRACT.md §9/§10/§11/§12、
// DECISION_LOOP_V1、INSPECTION_SESSION_V1），不为让测试通过放宽规则。
//
// R1 Gate 回执绑定：规则版本必须=当前激活版本（§9 A2.3）；输入绑定现状=自报 inputDigest 不经
//    A 侧校验（反例如实断言；是否收紧=待裁决/接口缺口登记，不在本轮单方改动）。
// R2 冻结会话后回退/新增：closure_revision 推进后旧包不失效是有效契约（INSPECTION_SESSION_V1 §7.4
//    "晚到材料推进 closure_revision 后，旧包引用不失效（历史冻结）……需新收口请发新修订"）；
//    closed 终态不可写（INSPECTION_CLOSED）；包内冻结引用可见（消费方可察觉漂移）。
// R3 豁免：登记点拒绝 撤销/过期/跨客户（§10 G1）；冻结后撤销不追溯改写已冻结包（契约文字
//    "只阻断新引用，历史冻结包不改写"——提交点是否应收紧=政策澄清项登记）。
// R4 晚到分析：域结果摘要=运行开始盖章 digest（§9 A2.6）；旧 run 晚登记 → 域读时判 changed，
//    不成为当前依据（DECISION_LOOP_V1 §2.3；package.ts recordDomainResult 注释口径）。
// R5 撤权与正式批准：撤权后重放不借缓存（§9 A1/K02）；service 身份不得作出正式批准（requireHuman，
//    A18/A19）；DB 签发 service 身份停用后即刻不可认证（§11.1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const CAP = 1_000_000_000;
const POLICY_VERSION = 'domreq-t03-1';
const PACK_V1 = 'sim-pack-t03-v1';
const PACK_V2 = 'sim-pack-t03-v2';
const DOMAIN_LIST = ['policy', 'credit', 'commerce', 'asset'];

const SPEC = [
  'tok-root=root:human:admin:all:all:all',
  'tok-policy=paul:human:policy:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-approver=carol:human:approver:all:t1',
  'tok-biz=bob:human:business:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
  'tok-gb=gb:human:business:all:all:grant',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const policyP = (k) => client(k.base, 'tok-policy');
const creditP = (k) => client(k.base, 'tok-credit');
const approver = (k) => client(k.base, 'tok-approver');
const bizP = (k) => client(k.base, 'tok-biz');
const svc = (k) => client(k.base, 'tok-svc');
const gb = (k) => client(k.base, 'tok-gb');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function startT03Kernel(extra = []) {
  const k = await startKernel({
    extraArgs: ['--credit-matrix', 'm03', '--credit-concentration', 'c03', '--required-domains-policy', POLICY_VERSION, ...extra],
    principalSpec: SPEC,
  });
  await k.pool.query(
    `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
       ('m03','approver','facility.approve',true,$1),
       ('m03','approver','facility.activate',true,$1),
       ('m03','approver','domain-exemption.grant',true,NULL),
       ('m03','business','fr.confirm-external',true,$1)
     ON CONFLICT DO NOTHING`, [CAP]);
  await k.pool.query(
    `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
       ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
     ON CONFLICT DO NOTHING`, [POLICY_VERSION]);
  return k;
}

async function mkCustomer(c, name) {
  const r = await c('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId: T1, legalEntityRef: `LE-T03-${name}-${Date.now()}`, displayName: `T03客户${name}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function activatePack(c, version) {
  const r = await c('POST', '/api/v2/rule-pack-versions/activate', { requestId: rid('rp'), tenantId: T1, version });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

async function gateReceipt(k, customerId, result, version = PACK_V1, patch = {}) {
  return svc(k)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result, rulesetVersion: version, ...patch,
  });
}

async function registerArtifact(k, customerId, kind, extra = {}) {
  const r = await creditP(k)('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind, factKey: kind, content: { v: Date.now() }, grade: 'unverified', ...extra,
  });
  assert.equal(r.status, 200, `登记工件 ${kind}: ${JSON.stringify(r.json)}`);
  return r.json.artifactId;
}

/** 最小真实检查会话走到 ready_for_assessment。
 *  it1：required，问答完成 → verified（refreshItems 自动核实口径）。
 *  withNonRequiredInvoiceItem=true 时附 it2（required=false、期望 invoice、无材料 → waiting_evidence）：
 *  非必需事项不阻断收口（recomputeClosure 只看 required），但保留一个可被晚到材料重开的柄
 *  （addLateEvidence 命中 waiting_evidence/deferred/answered → 重开 + closure_revision+1）。 */
async function inspectionSession(k, customerId, { withNonRequiredInvoiceItem = false } = {}) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: rid('tpl'), name: 'tpl-t03',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await a('POST', '/api/v1/projects', { requestId: rid('proj'), templateId: tpl.json.templateId, name: 'proj-t03' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const projectId = proj.json.projectId;
  const items = [
    { itemKey: 'it1', title: '核验一', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] },
  ];
  if (withNonRequiredInvoiceItem) {
    items.push({ itemKey: 'it2', title: '发票补充（非必需）', required: false, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: ['invoice'] });
  }
  const s = await bizP(k)('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: rid('sess'), customerId, title: 'T03 会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business', items,
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const sessionId = s.json.sessionId;
  const st = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: 1 });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const snap = await bizP(k)('GET', `/api/v1/inspections/${sessionId}`);
  const byKey = new Map(snap.json.snapshot.items.map((i) => [i.itemKey, i]));
  for (const key of ['it1', ...(withNonRequiredInvoiceItem ? ['it2'] : [])]) {
    const it = byKey.get(key);
    assert.ok(it, `事项 ${key} 存在`);
    const q = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions`, {
      requestId: rid('q'), audience: 'internal', targetRole: 'business', question: `确认 ${key}?`, purpose: 'verify', itemId: it.itemId,
    });
    assert.equal(q.status, 200, JSON.stringify(q.json));
    const ans = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, {
      requestId: rid('ans'), answer: { text: '确认无误' },
    });
    assert.equal(ans.status, 200, JSON.stringify(ans.json));
  }
  // 会话乐观版本：以 end 前的实时快照为准（问答次数可变，不硬编码）
  const beforeEnd = await bizP(k)('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(beforeEnd.status, 200, JSON.stringify(beforeEnd.json));
  const end = await bizP(k)('POST', `/api/v1/inspections/${sessionId}/end`, {
    requestId: rid('end'), expectedVersion: beforeEnd.json.snapshot.version,
  });
  assert.equal(end.status, 200, `结束: ${JSON.stringify(end.json)}`);
  assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));
  return { sessionId, closureRevision: end.json.closureRevision ?? 1 };
}

/** 冻结一个"可就绪"的包：Gate CLEAR + 收口引用 + 各域依赖声明；required 域结果由调用方决定补齐方式。 */
async function freezePackage(k, customerId, { deps, exemptions = [], gateResult = 'CLEAR', packVersion = PACK_V1, inspection = null } = {}) {
  const gr = await gateReceipt(k, customerId, gateResult, packVersion);
  assert.equal(gr.status, 200, `Gate 回执: ${JSON.stringify(gr.json)}`);
  const created = await bizP(k)('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1,
    domainDeps: deps, gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: inspection.sessionId },
    ...(exemptions.length > 0 ? { exemptions } : {}),
  });
  return { created, receiptId: gr.json.receiptId };
}

async function startRun(k, customerId, domain, deps, packVersion = PACK_V1) {
  const run = await svc(k)('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
    requestId: rid('run'), tenantId: T1, domain,
    deps: { ...deps, rulePackVersion: deps.rulePackVersion ?? packVersion },
  });
  assert.equal(run.status, 200, `运行开始 ${domain}: ${JSON.stringify(run.json)}`);
  return { runId: run.json.runId, inputDigest: run.json.inputDigest };
}

async function finishAndRecord(k, customerId, packageId, domain, runId, deps, packVersion = PACK_V1) {
  const fin = await svc(k)('POST', `/api/v2/analysis-runs/${runId}/finish`, {
    requestId: rid('fin'), tenantId: T1, executionStatus: 'completed',
  });
  assert.equal(fin.status, 200, JSON.stringify(fin.json));
  const rr = await svc(k)('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
    requestId: rid('dr'), tenantId: T1, domain,
    analysisRun: { runId, rulesetVersion: deps.rulePackVersion ?? packVersion },
    opinion: { findingType: 'observation', summary: `${domain} 意见`, domain, authority: 'none' },
    deps: { ...deps, rulePackVersion: deps.rulePackVersion ?? packVersion },
  });
  return { recorded: rr };
}

async function runAndRecord(k, customerId, packageId, domain, deps, packVersion = PACK_V1) {
  const { runId } = await startRun(k, customerId, domain, deps, packVersion);
  const { recorded } = await finishAndRecord(k, customerId, packageId, domain, runId, deps, packVersion);
  return { runId, recorded };
}

/** 完整就绪链：四域（credit 可带工件依赖）+ Gate + 收口 → ready 的 packageId。 */
async function readyPackage(k, customerId, { creditArtifactId = null, packVersion = PACK_V1, withNonRequiredInvoiceItem = false } = {}) {
  const inspection = await inspectionSession(k, customerId, { withNonRequiredInvoiceItem });
  const deps = DOMAIN_LIST.map((d) => ({
    domain: d,
    artifactIds: d === 'credit' && creditArtifactId !== null ? [creditArtifactId] : [],
    factKeys: [], rulePackVersion: packVersion,
  }));
  const { created } = await freezePackage(k, customerId, { deps, inspection, packVersion });
  assert.equal(created.status, 200, `冻结: ${JSON.stringify(created.json)}`);
  const packageId = created.json.packageId;
  for (const d of DOMAIN_LIST) {
    const deps1 = { artifactIds: d === 'credit' && creditArtifactId !== null ? [creditArtifactId] : [], factKeys: [] };
    const { recorded } = await runAndRecord(k, customerId, packageId, d, deps1, packVersion);
    assert.equal(recorded.status, 200, `域结果 ${d}: ${JSON.stringify(recorded.json)}`);
  }
  const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.decisionReadiness, true, `包应就绪: ${JSON.stringify(got.json.gaps)}`);
  return { packageId, inspection, deps };
}

/** 评估→候选→待审→带包提案→批准，返回 {assessmentId, facilityId}。 */
async function facilityThroughPackage(k, customerId, packageId) {
  const credit = creditP(k);
  const artId = await registerArtifact(k, customerId, 'customer_profile');
  const ass = await credit('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: rid('ass'), tenantId: T1, ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: artId }],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const cand = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: rid('cand'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: 100000, producedBy: 't03' },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const rev = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: rid('rev'), tenantId: T1 });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const prop = await credit('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: rid('prop'), tenantId: T1, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: 100000, currency: 'CNY', packageId,
  });
  assert.equal(prop.status, 200, `提案: ${JSON.stringify(prop.json)}`);
  const apr = await approver(k)('POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, {
    requestId: rid('apr'), tenantId: T1, rationale: 't03',
  });
  return { assessmentId: ass.json.assessmentId, facilityId: prop.json.facilityId, approve: apr };
}

// ---------------------------------------------------------------------------

test('R1a Gate 回执：rulesetVersion 必须=当前激活版本；人类身份不可登记', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r1a');
    // 未激活版本 → 拒（STALE_BASIS）
    const wrong = await gateReceipt(k, custId, 'CLEAR', 'never-activated-vX');
    assert.equal(wrong.status, 409, JSON.stringify(wrong.json));
    assert.match(String(wrong.json?.error ?? ''), /STALE_BASIS/);
    // 当前激活版本 → 通过
    const ok = await gateReceipt(k, custId, 'CLEAR', PACK_V1);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    // 人类身份（即使持 policy 角色）不可登记 Gate 回执（§9 A2.3：仅 kind=service）
    const human = await policyP(k)('POST', `/api/v2/customers/${custId}/rule-gate-receipts`, {
      requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1,
    });
    assert.equal(human.status, 403, JSON.stringify(human.json));
  } finally { await k.stop(); }
});

test('R1b Gate 回执跨客户引用被冻结点拒绝（回执绑定客户）', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custA = await mkCustomer(root(k), 'r1b-a');
    const custB = await mkCustomer(root(k), 'r1b-b');
    const ok = await gateReceipt(k, custA, 'CLEAR');
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const insp = await inspectionSession(k, custB);
    const misuse = await bizP(k)('POST', `/api/v2/customers/${custB}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1,
      domainDeps: DOMAIN_LIST.map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
      gateReceiptId: ok.json.receiptId, inspectionRevision: { sessionId: insp.sessionId },
    });
    assert.equal(misuse.status, 404, `A 的回执用于 B 应 404：${JSON.stringify(misuse.json)}`);
  } finally { await k.stop(); }
});

test('R1c 提交点 Gate 规则失效：换版后旧 Gate 不得放行（GATE_STALE_RULES → 提交点 STALE_BASIS）', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r1c');
    const { packageId } = await readyPackage(k, custId);
    // 换版正式激活
    await activatePack(policyP(k), PACK_V2);
    const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.ok(got.json.gaps.some((g) => g.code === 'GATE_STALE_RULES'), `应有 GATE_STALE_RULES 缺口：${JSON.stringify(got.json.gaps)}`);
    // 提交点：批准被拒（机械复查不放过旧 Gate）
    const chain = await facilityThroughPackage(k, custId, packageId);
    assert.equal(chain.approve.status, 409, `换版后批准应 409：${JSON.stringify(chain.approve.json)}`);
    assert.match(String(chain.approve.json?.error ?? ''), /STALE_BASIS|GATE_BLOCKED/);
  } finally { await k.stop(); }
});

test('R1d 反例（如实断言，非缺陷声明）：Gate 回执 inputDigest 为自报字段，不经 A 侧输入校验', async () => {
  // 当前有效契约（§9 A2.3）只要求 kind=service + rulesetVersion=激活版本；未要求 A 校验回执
  // 与"实际分析输入"的绑定（区别于分析运行：A2.6 的 run 由 A 盖章 input_digest）。
  // 本反例证明：任意自报 inputDigest/evidenceRefs 可登记成功。是否收紧（如 Gate 也走运行盖章）
  // 属接口/制度裁决项 → 已登记 CONTRACT §12 与 task-03 POLICY_PENDING，本轮不单方改门。
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r1d');
    const selfDeclared = await gateReceipt(k, custId, 'CLEAR', PACK_V1, {
      inputDigest: 'deadbeef-not-verified-by-a', evidenceRefs: ['unrelated-ref-1'],
    });
    assert.equal(selfDeclared.status, 200, `自报 inputDigest 现状可登记：${JSON.stringify(selfDeclared.json)}`);
  } finally { await k.stop(); }
});

test('R2 冻结会话后晚到材料推进 closure_revision：旧包引用不失效（契约 §7.4），冻结值可见', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r2');
    const { packageId, inspection } = await readyPackage(k, custId, { withNonRequiredInvoiceItem: true });
    assert.equal(inspection.closureRevision, 1, '冻结时会话收口修订=1');
    // 晚到新材料（invoice → 重开 it2）→ closure_revision 1→2
    const artId = await registerArtifact(k, custId, 'invoice');
    const le = await bizP(k)('POST', `/api/v1/inspections/${inspection.sessionId}/evidence`, {
      requestId: rid('late2'), artifactId: artId,
    });
    assert.equal(le.status, 200, `晚到材料: ${JSON.stringify(le.json)}`);
    const snap = await bizP(k)('GET', `/api/v1/inspections/${inspection.sessionId}`);
    assert.equal(snap.json.snapshot.closureRevision, 2, `会话修订应推进到 2：${JSON.stringify(snap.json.snapshot.closureRevision)}`);
    // 契约行为：旧包不失效——就绪判定按包内冻结引用
    const got = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.equal(got.json.decisionReadiness, true, `晚到材料后旧包仍就绪（契约 §7.4）：${JSON.stringify(got.json.gaps)}`);
    assert.ok(!got.json.gaps.some((g) => g.code.startsWith('INSPECTION_')), `不得出现收口缺口：${JSON.stringify(got.json.gaps)}`);
    // 冻结引用可见：包内 closureRevision 仍是冻结时点值（消费方可察觉会话已推进 → 需新收口时发新修订）
    const frozenRev = got.json.package.inspectionRevision.closureRevision;
    assert.equal(frozenRev, 1, `包内冻结 closureRevision 应为冻结时点值 1：${JSON.stringify(got.json.package.inspectionRevision)}`);
    // closed 终态不可写（回退/新增必要项在 closed 会话上被拒绝）
    const close = await bizP(k)('POST', `/api/v1/inspections/${inspection.sessionId}/close`, { requestId: rid('close'), expectedVersion: snap.json.snapshot.version });
    assert.equal(close.status, 200, `收口 closed: ${JSON.stringify(close.json)}`);
    const addItemAfterClose = await bizP(k)('POST', `/api/v1/inspections/${inspection.sessionId}/items`, {
      requestId: rid('additem'), itemKey: 'it3', title: '事后增项', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [],
    });
    assert.equal(addItemAfterClose.status, 409, `closed 后增项应 409：${JSON.stringify(addItemAfterClose.json)}`);
    assert.match(String(addItemAfterClose.json?.error ?? ''), /INSPECTION_CLOSED/);
    const lateAfterClose = await bizP(k)('POST', `/api/v1/inspections/${inspection.sessionId}/evidence`, {
      requestId: rid('late3'), artifactId: artId,
    });
    assert.equal(lateAfterClose.status, 409, `closed 后晚到材料应 409：${JSON.stringify(lateAfterClose.json)}`);
  } finally { await k.stop(); }
});

test('R3a 豁免登记点：撤销/过期/跨客户引用被拒绝（§10 G1）', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custA = await mkCustomer(root(k), 'r3a-a');
    const custB = await mkCustomer(root(k), 'r3a-b');
    // 豁免登记（approver 持矩阵动作 domain-exemption.grant）
    const reg = await approver(k)('POST', `/api/v2/customers/${custA}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'policy', scope: 'package', reason: 'T03 复验',
    });
    assert.equal(reg.status, 200, JSON.stringify(reg.json));
    const exemptionId = reg.json.exemptionId;
    // 跨客户引用 → 404
    const inspB = await inspectionSession(k, custB);
    const cross = await bizP(k)('POST', `/api/v2/customers/${custB}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1,
      domainDeps: DOMAIN_LIST.filter((d) => d !== 'policy').map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
      inspectionRevision: { sessionId: inspB.sessionId },
      exemptions: [{ exemptionId }],
    });
    assert.equal(cross.status, 404, `跨客户豁免引用应 404：${JSON.stringify(cross.json)}`);
    // 撤销后新引用 → 409 POLICY_PENDING
    const rv = await approver(k)('DELETE', `/api/v2/domain-exemptions/${exemptionId}`, { requestId: rid('rv'), tenantId: T1 });
    assert.equal(rv.status, 200, JSON.stringify(rv.json));
    const inspA = await inspectionSession(k, custA);
    const afterRevoke = await bizP(k)('POST', `/api/v2/customers/${custA}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1,
      domainDeps: DOMAIN_LIST.filter((d) => d !== 'policy').map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
      inspectionRevision: { sessionId: inspA.sessionId },
      exemptions: [{ exemptionId }],
    });
    assert.equal(afterRevoke.status, 409, `撤销后引用应 409：${JSON.stringify(afterRevoke.json)}`);
    assert.match(String(afterRevoke.json?.error ?? ''), /POLICY_PENDING/);
    // 过期豁免：登记 validUntil=now+1.2s → 等待过期 → 引用 409 POLICY_PENDING
    const reg2 = await approver(k)('POST', `/api/v2/customers/${custA}/domain-exemptions`, {
      requestId: rid('exm2'), tenantId: T1, domain: 'policy', scope: 'package', reason: 'T03 过期复验',
      validUntil: new Date(Date.now() + 1200).toISOString(),
    });
    assert.equal(reg2.status, 200, JSON.stringify(reg2.json));
    await new Promise((r) => setTimeout(r, 1500));
    const afterExpire = await bizP(k)('POST', `/api/v2/customers/${custA}/decision-packages`, {
      requestId: rid('pkg'), tenantId: T1,
      domainDeps: DOMAIN_LIST.filter((d) => d !== 'policy').map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
      inspectionRevision: { sessionId: inspA.sessionId },
      exemptions: [{ exemptionId: reg2.json.exemptionId }],
    });
    assert.equal(afterExpire.status, 409, `过期豁免引用应 409：${JSON.stringify(afterExpire.json)}`);
  } finally { await k.stop(); }
});

test('R3b 反例（如实断言）：冻结包豁免在撤销后不追溯失效——提交点按契约仍放行，澄清项已登记', async () => {
  // 契约文字（§10 G1）：撤销"即刻生效只阻断新引用，历史冻结包不改写"。反例证明提交点行为：
  // 冻结时豁免有效 → 冻结后撤销 → 包仍就绪、批准仍通过。是否应把"提交点复验豁免有效性"
  // 收紧为机械门，属经营政策裁决（本轮不改）。
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r3b');
    const reg = await approver(k)('POST', `/api/v2/customers/${custId}/domain-exemptions`, {
      requestId: rid('exm'), tenantId: T1, domain: 'policy', scope: 'package', reason: 'T03 冻结后撤销复验',
    });
    assert.equal(reg.status, 200, JSON.stringify(reg.json));
    const exemptionId = reg.json.exemptionId;
    const inspection = await inspectionSession(k, custId, { withNonRequiredInvoiceItem: true });
    const { created } = await freezePackage(k, custId, {
      inspection,
      exemptions: [{ exemptionId }],
      deps: DOMAIN_LIST.filter((d) => d !== 'policy').map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const packageId = created.json.packageId;
    for (const d of DOMAIN_LIST.filter((x) => x !== 'policy')) {
      const { recorded } = await runAndRecord(k, custId, packageId, d, { artifactIds: [], factKeys: [] });
      assert.equal(recorded.status, 200, JSON.stringify(recorded.json));
    }
    const got1 = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got1.json.decisionReadiness, true, `豁免冻结后应就绪：${JSON.stringify(got1.json.gaps)}`);
    // 撤销 → 既有冻结包行为
    const rv = await approver(k)('DELETE', `/api/v2/domain-exemptions/${exemptionId}`, { requestId: rid('rv'), tenantId: T1 });
    assert.equal(rv.status, 200, JSON.stringify(rv.json));
    const got2 = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got2.json.decisionReadiness, true, `撤销后既有冻结包仍就绪（契约：不追溯改写）：${JSON.stringify(got2.json.gaps)}`);
    const chain = await facilityThroughPackage(k, custId, packageId);
    assert.equal(chain.approve.status, 200, `撤销后提交点仍放行（反例如实断言）：${JSON.stringify(chain.approve.json)}`);
  } finally { await k.stop(); }
});

test('R4 晚到分析：旧 run 盖章摘要 ≠ 当前摘要 → 域判 changed，不成为当前依据；更晚的旧 run 复登也不回 current', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r4');
    // 冻结前先登记 art1，credit 域声明依赖 art1
    const art1 = await registerArtifact(k, custId, 'financial_statement');
    const { packageId, inspection } = await readyPackage(k, custId, { creditArtifactId: art1 });
    const got1 = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    assert.equal(got1.json.decisionReadiness, true, JSON.stringify(got1.json.gaps));
    // 场景 A：run 在 art1 仍现行时启动（盖章 D1）→ 材料取代先落地 → 运行才 finish+record
    // → 登记摘要=盖章 D1 ≠ 当前摘要 → 域 changed（晚到结果不按当前 DB 重新盖章为 current，§9 A2.6）
    const run1 = await startRun(k, custId, 'credit', { artifactIds: [art1], factKeys: [] });
    const sup = await creditP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
      requestId: rid('art'), tenantId: T1, kind: 'financial_statement', factKey: 'financial_statement',
      content: { v: 'superseding' }, grade: 'unverified', supersedes: art1,
    });
    assert.equal(sup.status, 200, JSON.stringify(sup.json));
    const late = await finishAndRecord(k, custId, packageId, 'credit', run1.runId, { artifactIds: [art1], factKeys: [] });
    assert.equal(late.recorded.status, 200, `旧 run 晚登记应成功（登记与当前性分离）：${JSON.stringify(late.recorded.json)}`);
    const got2 = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    const credit2 = got2.json.currency.find((c) => c.domain === 'credit');
    assert.equal(credit2.currency, 'changed', `晚到旧分析不得成为当前依据：${JSON.stringify(credit2)}`);
    assert.ok(credit2.reasons.includes('deps_changed'), `原因=deps_changed：${JSON.stringify(credit2.reasons)}`);
    assert.equal(got2.json.decisionReadiness, false, '包整体退出就绪');
    // 场景 C：在旧包上复登"旧 run1"（更晚的旧分析）→ 域保持 changed（fail-closed，不静默回 current）
    const oldAgain = await svc(k)('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: rid('dr'), tenantId: T1, domain: 'credit',
      analysisRun: { runId: run1.runId, rulesetVersion: PACK_V1 },
      opinion: { findingType: 'observation', summary: '旧 run 复登', domain: 'credit', authority: 'none' },
      deps: { artifactIds: [art1], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(oldAgain.status, 200, JSON.stringify(oldAgain.json));
    const got4 = await bizP(k)('GET', `/api/v2/decision-packages/${packageId}`);
    const credit4 = got4.json.currency.find((c) => c.domain === 'credit');
    assert.equal(credit4.currency, 'changed', `旧 run 复登 → changed（不变成当前依据）：${JSON.stringify(credit4)}`);
    // 场景 B（契约路径）：依赖材料变了 → 发布新修订（同包登记不同依赖集被拒——上面 finishAndRecord 的
    // 同包变体已由 400 契约门覆盖：deps.artifactIds 必须与冻结声明一致）
    const samePackB = await svc(k)('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: rid('dr'), tenantId: T1, domain: 'credit',
      analysisRun: { runId: run1.runId, rulesetVersion: PACK_V1 },
      opinion: { findingType: 'observation', summary: '换依赖集登记', domain: 'credit', authority: 'none' },
      deps: { artifactIds: [sup.json.artifactId], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(samePackB.status, 400, `同包换依赖集应 400：${JSON.stringify(samePackB.json)}`);
    const gr2 = await gateReceipt(k, custId, 'CLEAR');
    assert.equal(gr2.status, 200, JSON.stringify(gr2.json));
    const revised = await bizP(k)('POST', `/api/v2/decision-packages/${packageId}/revisions`, {
      requestId: rid('rev'), tenantId: T1,
      domainDeps: DOMAIN_LIST.map((d) => ({
        domain: d,
        artifactIds: d === 'credit' ? [sup.json.artifactId] : [],
        factKeys: [], rulePackVersion: PACK_V1,
      })),
      gateReceiptId: gr2.json.receiptId, inspectionRevision: { sessionId: inspection.sessionId },
    });
    assert.equal(revised.status, 200, `新修订: ${JSON.stringify(revised.json)}`);
    const pkg2 = revised.json.packageId;
    for (const d of DOMAIN_LIST) {
      const deps1 = { artifactIds: d === 'credit' ? [sup.json.artifactId] : [], factKeys: [] };
      const { recorded } = await runAndRecord(k, custId, pkg2, d, deps1);
      assert.equal(recorded.status, 200, `新修订域结果 ${d}: ${JSON.stringify(recorded.json)}`);
    }
    const got5 = await bizP(k)('GET', `/api/v2/decision-packages/${pkg2}`);
    const credit5 = got5.json.currency.find((c) => c.domain === 'credit');
    assert.equal(credit5.currency, 'current', `按当前材料的新修订应 current：${JSON.stringify(credit5)}`);
    assert.equal(got5.json.decisionReadiness, true, `新修订应就绪：${JSON.stringify(got5.json.gaps)}`);
  } finally { await k.stop(); }
});

test('R5a 撤权后回执重放不借缓存：同 requestId 重放被当前授权拒绝', async () => {
  const k = await startT03Kernel();
  try {
    const custId = await mkCustomer(root(k), 'r5a');
    await root(k)('POST', `/api/v2/customers/${custId}/grants`, { requestId: rid('gr'), tenantId: T1, principalId: 'gb' });
    const replayBody = {
      requestId: 'replay-t03-r5a', tenantId: T1, kind: 'customer_profile', factKey: 'profile',
      content: { v: 1 }, grade: 'unverified',
    };
    const first = await gb(k)('POST', `/api/v2/customers/${custId}/artifacts`, replayBody);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const rv = await root(k)('DELETE', `/api/v2/customers/${custId}/grants/gb`, { requestId: rid('rv'), tenantId: T1 });
    assert.equal(rv.status, 200, JSON.stringify(rv.json));
    const replay = await gb(k)('POST', `/api/v2/customers/${custId}/artifacts`, replayBody);
    assert.equal(replay.status, 404, `撤权后重放应被当前授权拒绝：${JSON.stringify(replay.json)}`);
    assert.notEqual(replay.json?.replayed, true, '不得以缓存回执放行');
  } finally { await k.stop(); }
});

test('R5b service 身份不得作出正式批准/支付（requireHuman；A18/A19）', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r5b');
    const { packageId } = await readyPackage(k, custId);
    const chain = await facilityThroughPackage(k, custId, packageId);
    assert.equal(chain.approve.status, 200, JSON.stringify(chain.approve.json));
    // service 尝试正式批准设施
    const apr = await svc(k)('POST', `/api/v2/facilities/${chain.facilityId}/approve`, {
      requestId: rid('apr'), tenantId: T1, rationale: 'svc 尝试',
    });
    assert.equal(apr.status, 403, `service 批准应 403：${JSON.stringify(apr.json)}`);
    // service 尝试正式出账（先建一条 FR）
    const fr = await bizP(k)('POST', `/api/v2/customers/${custId}/financing-requests`, {
      requestId: rid('fr'), tenantId: T1, facilityId: chain.facilityId,
      productType: 'direct_lease', amountMinor: 1000, currency: 'CNY',
    });
    assert.equal(fr.status, 200, JSON.stringify(fr.json));
    const dis = await svc(k)('POST', `/api/v2/financing-requests/${fr.json.frId}/disburse`, {
      requestId: rid('dis'), tenantId: T1,
    });
    assert.equal(dis.status, 403, `service 出账应 403：${JSON.stringify(dis.json)}`);
  } finally { await k.stop(); }
});

test('R5c DB 签发 service 身份：停用后即刻不可认证，回执重放同样 403（§11.1）', async () => {
  const k = await startT03Kernel();
  try {
    await activatePack(policyP(k), PACK_V1);
    const custId = await mkCustomer(root(k), 'r5c');
    const created = await root(k)('POST', '/api/v2/service-identities', {
      requestId: rid('svc'), tenantId: T1, displayName: 't03-svc',
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const svc2 = client(k.base, created.json.credential);
    const body = { requestId: 'replay-t03-r5c', tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1 };
    const first = await svc2('POST', `/api/v2/customers/${custId}/rule-gate-receipts`, body);
    assert.equal(first.status, 200, `签发身份可登记回执：${JSON.stringify(first.json)}`);
    const disable = await root(k)('POST', `/api/v2/service-identities/${created.json.principalId}/disable`, {
      requestId: rid('dis'), tenantId: T1,
    });
    assert.equal(disable.status, 200, JSON.stringify(disable.json));
    const replay = await svc2('POST', `/api/v2/customers/${custId}/rule-gate-receipts`, body);
    assert.equal(replay.status, 403, `停用后重放应 403（即刻不可认证）：${JSON.stringify(replay.json)}`);
  } finally { await k.stop(); }
});
