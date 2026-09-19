// 任务03（权威查询与授权支撑）· 权威读面验收。
// 契约：Back/CONTRACT.md §12（本轮新增）；沿用 §11 口径：
//   R1 目录搜索统一（名称+标识，任务一前端"按名称/标识搜索"）；授权过滤先行于搜索。
//   R2 按客户权威分页清单 assessments / financing-requests（IR-03-A ②）：
//      租户/grant/角色过滤一致；键集游标仅基于业务 id；重启/长历史/撤权后语义不变。
//   R3 listArtifacts 增补 processing 处理引用（additive）。
//   R4 单件读与清单读同权：客户联系人身份 403（B13 some 口径），越权统一 404（不泄露存在性）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
// FR fixture 所需的政策/规则版本（Gate 回执、分析运行、包冻结都要求已激活版本 + 显式政策）
const POLICY_VERSION = 'domreq-ar-1';
const PACK_V1 = 'sim-pack-ar-1';
const DOMAIN_LIST = ['policy', 'credit', 'commerce', 'asset'];

// tok-t2b 仅租户 t2（租户越权用）；tok-gb grant 模式（客户级授权/撤权用）。
const SPEC = [
  'tok-root=root:human:admin:all:all:all',
  'tok-biz=bob:human:business:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-svc=svc1:service:policy+credit+commerce+asset:all:t1',
  'tok-t2b=tb:human:business:t2:t2',
  'tok-gb=gb:human:business:all:all:grant',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const biz = (k) => client(k.base, 'tok-biz');
const creditP = (k) => client(k.base, 'tok-credit');
const t2b = (k) => client(k.base, 'tok-t2b');
const gb = (k) => client(k.base, 'tok-gb');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const k = await startKernel({ principalSpec: SPEC, extraArgs: ['--required-domains-policy', POLICY_VERSION] });
test.after(async () => { await k.stop(); });
// 必需域政策行（冻结包 fail-closed 要求：启动参数 + 政策行）
await k.pool.query(
  `INSERT INTO domain_requirement_policies (policy_version, domain, required) VALUES
     ($1,'policy',true),($1,'credit',true),($1,'commerce',true),($1,'asset',true)
   ON CONFLICT DO NOTHING`, [POLICY_VERSION]);

let seq = 0;
async function mkCustomer(name, extra = {}) {
  seq += 1;
  const r = await root(k)('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId: T1,
    legalEntityRef: extra.leRef ?? `LE-AR-${Date.now()}-${seq}`, displayName: name,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function mkAssessment(customerId, n) {
  const r = await creditP(k)('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: rid('ass'), tenantId: T1, ruleVersion: `r-${n}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.assessmentId;
}

// FR 清单 fixture：完整最小包（Gate 回执 + 收口会话 + 四域运行结果）→ 提案 → FR。

async function mkFrFixture(customerId) {
  const s = client(k.base, 'tok-svc');
  // Gate 回执/分析运行要求规则版本已正式激活（§9 A2.3/A2.6）
  const act = await root(k)('POST', '/api/v2/rule-pack-versions/activate', {
    requestId: rid('rp'), tenantId: T1, version: PACK_V1,
  });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  const art = await creditP(k)('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
  });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  const ass = await creditP(k)('POST', `/api/v2/customers/${customerId}/assessments`, {
    requestId: rid('ass'), tenantId: T1, ruleVersion: 'r-fr', evidenceSnapshot: [{ artifactId: art.json.artifactId }],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const cand = await creditP(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: rid('cand'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: 100000, producedBy: 'ar-fr' },
  });
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const rev = await creditP(k)('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: rid('rev'), tenantId: T1 });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const gr = await s('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: rid('gr'), tenantId: T1, result: 'CLEAR', rulesetVersion: PACK_V1,
  });
  assert.equal(gr.status, 200, JSON.stringify(gr.json));
  const insp = await inspectionReadySession(customerId);
  const created = await biz(k)('POST', `/api/v2/customers/${customerId}/decision-packages`, {
    requestId: rid('pkg'), tenantId: T1,
    domainDeps: DOMAIN_LIST.map((d) => ({ domain: d, artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 })),
    gateReceiptId: gr.json.receiptId, inspectionRevision: { sessionId: insp.sessionId },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const packageId = created.json.packageId;
  for (const d of DOMAIN_LIST) {
    const run = await s('POST', `/api/v2/customers/${customerId}/analysis-runs/start`, {
      requestId: rid('run'), tenantId: T1, domain: d,
      deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const fin = await s('POST', `/api/v2/analysis-runs/${run.json.runId}/finish`, {
      requestId: rid('fin'), tenantId: T1, executionStatus: 'completed',
    });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    const rr = await s('POST', `/api/v2/decision-packages/${packageId}/domain-results`, {
      requestId: rid('dr'), tenantId: T1, domain: d,
      analysisRun: { runId: run.json.runId, rulesetVersion: PACK_V1 },
      opinion: { findingType: 'observation', summary: `${d} 意见`, domain: d, authority: 'none' },
      deps: { artifactIds: [], factKeys: [], rulePackVersion: PACK_V1 },
    });
    assert.equal(rr.status, 200, JSON.stringify(rr.json));
  }
  const prop = await creditP(k)('POST', `/api/v2/customers/${customerId}/facilities`, {
    requestId: rid('prop'), tenantId: T1, assessmentId: ass.json.assessmentId,
    approvedAmountMinor: 100000, currency: 'CNY', packageId,
  });
  assert.equal(prop.status, 200, `带包提案: ${JSON.stringify(prop.json)}`);
  const frs = [];
  for (let i = 0; i < 3; i++) {
    const fr = await biz(k)('POST', `/api/v2/customers/${customerId}/financing-requests`, {
      requestId: rid('fr'), tenantId: T1, facilityId: prop.json.facilityId,
      productType: 'direct_lease', amountMinor: 1000 + i, currency: 'CNY',
    });
    assert.equal(fr.status, 200, `建FR: ${JSON.stringify(fr.json)}`);
    frs.push(fr.json.frId);
  }
  return { facilityId: prop.json.facilityId, frs, assessmentId: ass.json.assessmentId };
}

/** 最小真实检查会话走到 ready_for_assessment（契约：仅 ready_for_assessment/closed 视为收口）。 */
async function inspectionReadySession(customerId) {
  const a = root(k);
  const tpl = await a('POST', '/api/v1/templates', {
    requestId: rid('tpl'), name: 'tpl-ar',
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'g1', title: 'g', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await a('POST', '/api/v1/projects', { requestId: rid('proj'), templateId: tpl.json.templateId, name: 'proj-ar' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const projectId = proj.json.projectId;
  const s = await biz(k)('POST', `/api/v1/projects/${projectId}/inspections`, {
    requestId: rid('sess'), customerId, title: 'AR 会话',
    roles: [{ roleKey: 'business', kind: 'human' }], ownerRole: 'business',
    items: [{ itemKey: 'it1', title: '核验一', required: true, responsibleRole: 'business', targetRole: 'business', requiresHumanVerification: false, expectedEvidenceKinds: [] }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const sessionId = s.json.sessionId;
  const st = await biz(k)('POST', `/api/v1/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: 1 });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const snap = await biz(k)('GET', `/api/v1/inspections/${sessionId}`);
  const itemId = snap.json.snapshot.items[0].itemId;
  const q = await biz(k)('POST', `/api/v1/inspections/${sessionId}/questions`, {
    requestId: rid('q'), audience: 'internal', targetRole: 'business', question: '确认?', purpose: 'verify', itemId,
  });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const ans = await biz(k)('POST', `/api/v1/inspections/${sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: rid('ans'), answer: { text: '确认无误' },
  });
  assert.equal(ans.status, 200, JSON.stringify(ans.json));
  const end = await biz(k)('POST', `/api/v1/inspections/${sessionId}/end`, { requestId: rid('end'), expectedVersion: 3 });
  assert.equal(end.status, 200, JSON.stringify(end.json));
  assert.equal(end.json.closureStatus, 'ready_for_assessment', JSON.stringify(end.json));
  return { sessionId, closureRevision: end.json.closureRevision ?? 1 };
}

// ---------------------------------------------------------------------------

test('AR1 评估清单：键集分页边界与排序（25 行 × limit 10 → 3 页无重无漏；游标/limit 非法 400）', async () => {
  const custId = await mkCustomer('AR1客户');
  const created = [];
  for (let i = 0; i < 25; i++) created.push(await mkAssessment(custId, i));
  const seen = [];
  let cursor = null;
  for (let page = 0; ; page++) {
    const q = cursor === null ? 'limit=10' : `limit=10&cursor=${encodeURIComponent(cursor)}`;
    const r = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?${q}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.assessments.length <= 10, '单页 ≤ limit');
    for (const a of r.json.assessments) seen.push(a.assessmentId);
    cursor = r.json.nextCursor;
    if (cursor === null) break;
    assert.ok(page < 5, `页数异常：${page}`);
  }
  assert.equal(seen.length, 25, `无重无漏（去重后 ${new Set(seen).size}）`);
  assert.equal(new Set(seen).size, 25);
  assert.deepEqual([...seen].sort().reverse(), seen, '排序 = id 字典序降序（≈创建时间倒序）');
  assert.deepEqual(new Set(created), new Set(seen), '清单恰为已创建集合');
  // 分页参数边界
  const badLimit = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?limit=0`);
  assert.equal(badLimit.status, 400, JSON.stringify(badLimit.json));
  const bigLimit = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?limit=101`);
  assert.equal(bigLimit.status, 400, JSON.stringify(bigLimit.json));
  const badCursor = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?cursor=@@@`);
  assert.equal(badCursor.status, 400, JSON.stringify(badCursor.json));
  // 中途插入不影响既有页游标语义（键集分页的稳定性）：用 cursor=第一页末行 再取，仍是确定性后继
  const again = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?limit=10`);
  const p2 = await creditP(k)('GET', `/api/v2/customers/${custId}/assessments?limit=10&cursor=${encodeURIComponent(again.json.nextCursor)}`);
  assert.equal(p2.status, 200, JSON.stringify(p2.json));
  assert.equal(p2.json.assessments[0].assessmentId, seen[10], '同一游标得到确定后继');
});

test('AR2 融资申请清单：分页与投影（3 行 × limit 2；字段与单件 GET 投影一致）', async () => {
  const custId = await mkCustomer('AR2客户');
  const fx = await mkFrFixture(custId);
  const p1 = await creditP(k)('GET', `/api/v2/customers/${custId}/financing-requests?limit=2`);
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.equal(p1.json.financingRequests.length, 2, '第一页 2 行');
  assert.ok(p1.json.nextCursor, '有下一页游标');
  const p2 = await creditP(k)('GET', `/api/v2/customers/${custId}/financing-requests?limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  assert.equal(p2.status, 200, JSON.stringify(p2.json));
  assert.equal(p2.json.financingRequests.length, 1, '第二页 1 行');
  assert.equal(p2.json.nextCursor, null, '无更多页');
  const ids = [...p1.json.financingRequests, ...p2.json.financingRequests].map((f) => f.frId);
  assert.equal(new Set(ids).size, 3, '无重');
  assert.deepEqual(new Set(ids), new Set(fx.frs), '恰为已创建集合');
  const sortedDesc = [...fx.frs].sort().reverse();
  assert.deepEqual(ids, sortedDesc, '排序 = fr_id 降序');
  // 单件 GET 投影字段一致（同一 projectFr）
  const one = p1.json.financingRequests[0];
  const detail = await creditP(k)('GET', `/api/v2/financing-requests/${one.frId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  for (const field of ['frId', 'facilityId', 'productType', 'amountMinor', 'currency', 'status', 'externalState', 'version']) {
    assert.deepEqual(detail.json.financingRequest[field], one[field], `投影字段一致：${field}`);
  }
  void fx.assessmentId;
});

test('AR3 授权矩阵：匿名 403 / 客户身份 403（单件同权）/ 跨租户与无 grant 404 / 撤权即刻生效', async () => {
  const custId = await mkCustomer('AR3客户');
  const assId = await mkAssessment(custId, 1);
  const fx = await mkFrFixture(custId);
  const frId = fx.frs[0];
  // 匿名（无凭据头）→ 403
  const anon = await client(k.base, null);
  const a1 = await anon('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(a1.status, 403, JSON.stringify(a1.json));
  // 客户联系人身份：邀请→兑换→凭据；清单/单件一律 403（B13 some 口径）
  const inv = await biz(k)('POST', `/api/v2/customers/${custId}/invitations`, {
    requestId: rid('inv'), tenantId: T1, role: 'customer-owner', allowedKinds: ['customer_profile'],
  });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', {
    requestId: rid('red'), code: inv.json.invitation.code,
  });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  const cust = client(k.base, red.json.credential);
  const c1 = await cust('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(c1.status, 403, `客户身份清单应 403：${JSON.stringify(c1.json)}`);
  const c2 = await cust('GET', `/api/v2/customers/${custId}/financing-requests`);
  assert.equal(c2.status, 403, JSON.stringify(c2.json));
  const c3 = await cust('GET', `/api/v2/assessments/${assId}`);
  assert.equal(c3.status, 403, `客户身份单件读应 403（与清单同权）：${JSON.stringify(c3.json)}`);
  const c4 = await cust('GET', `/api/v2/financing-requests/${frId}`);
  assert.equal(c4.status, 403, JSON.stringify(c4.json));
  // 跨租户 → 404（不泄露存在性）
  const t1 = await t2b(k)('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(t1.status, 404, JSON.stringify(t1.json));
  // grant 模式未授权 → 404；授权后 → 200；撤销 → 即刻 404
  const g1 = await gb(k)('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(g1.status, 404, JSON.stringify(g1.json));
  const grant = await root(k)('POST', `/api/v2/customers/${custId}/grants`, {
    requestId: rid('gr'), tenantId: T1, principalId: 'gb',
  });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  const g2 = await gb(k)('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(g2.status, 200, JSON.stringify(g2.json));
  assert.equal(g2.json.customerId, custId);
  const revoke = await root(k)('DELETE', `/api/v2/customers/${custId}/grants/gb`, { requestId: rid('rv'), tenantId: T1 });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.json));
  const g3 = await gb(k)('GET', `/api/v2/customers/${custId}/assessments`);
  assert.equal(g3.status, 404, `撤权后读取应 404：${JSON.stringify(g3.json)}`);
});

test('AR4 目录搜索统一：名称/客户标识/主体标识三路匹配；grants 过滤仍先行', async () => {
  const custA = await mkCustomer('云杉机械租赁', { leRef: 'LE-SEARCH-9182' });
  const custB = await mkCustomer('云杉二期项目');
  // 名称命中两户
  const byName = await creditP(k)('GET', `/api/v2/customers?search=${encodeURIComponent('云杉')}&limit=50`);
  assert.equal(byName.status, 200, JSON.stringify(byName.json));
  const nameIds = byName.json.customers.map((c) => c.customerId);
  assert.ok(nameIds.includes(custA) && nameIds.includes(custB), `名称命中：${JSON.stringify(nameIds)}`);
  // 客户标识（customerId）命中
  const byId = await creditP(k)('GET', `/api/v2/customers?search=${encodeURIComponent(custA)}&limit=50`);
  assert.equal(byId.status, 200, JSON.stringify(byId.json));
  const idHits = byId.json.customers.map((c) => c.customerId);
  assert.ok(idHits.includes(custA), `标识命中：${JSON.stringify(idHits)}`);
  assert.ok(!idHits.includes(custB), '标识命中不串他户');
  // 主体标识（legal_entity_ref）命中
  const byLe = await creditP(k)('GET', `/api/v2/customers?search=${encodeURIComponent('LE-SEARCH-9182')}&limit=50`);
  assert.equal(byLe.status, 200, JSON.stringify(byLe.json));
  assert.ok(byLe.json.customers.some((c) => c.customerId === custA), `主体标识命中：${JSON.stringify(byLe.json.customers)}`);
  // grants 过滤先行：grant 模式只见授权客户（即使搜索词命中更多）
  await root(k)('POST', `/api/v2/customers/${custA}/grants`, { requestId: rid('gr'), tenantId: T1, principalId: 'gb' });
  const gbView = await gb(k)('GET', `/api/v2/customers?search=${encodeURIComponent('云杉')}&limit=50`);
  assert.equal(gbView.status, 200, JSON.stringify(gbView.json));
  const gbIds = gbView.json.customers.map((c) => c.customerId);
  assert.deepEqual(gbIds, [custA], `grant 过滤先行：${JSON.stringify(gbIds)}`);
  // 无 grant 客户对 grant 模式按"不存在"处理
  const gbById = await gb(k)('GET', `/api/v2/customers?search=${encodeURIComponent(custB)}`);
  assert.equal(gbById.status, 200, JSON.stringify(gbById.json));
  assert.equal(gbById.json.customers.length, 0, '未授权客户不可见');
});

test('AR5 listArtifacts 增补处理引用：有记录→processing 投影；无记录→null（additive）', async () => {
  const custId = await mkCustomer('AR5客户');
  const art1 = await creditP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
    requestId: rid('a1'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'unverified',
  });
  assert.equal(art1.status, 200, JSON.stringify(art1.json));
  const art2 = await creditP(k)('POST', `/api/v2/customers/${custId}/artifacts`, {
    requestId: rid('a2'), tenantId: T1, kind: 'invoice', factKey: 'invoice', content: { v: 2 }, grade: 'unverified',
  });
  assert.equal(art2.status, 200, JSON.stringify(art2.json));
  const svc = client(k.base, 'tok-svc');
  const proc = await svc('POST', `/api/v2/customers/${custId}/artifacts/${art1.json.artifactId}/processing`, {
    requestId: rid('pr'), tenantId: T1, stage: 'parsed', runRef: 'run-ar5',
  });
  assert.equal(proc.status, 200, `处理登记需 service 身份：${JSON.stringify(proc.json)}`);
  const list = await creditP(k)('GET', `/api/v2/customers/${custId}/artifacts`);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const byId = new Map(list.json.artifacts.map((a) => [a.artifactId, a]));
  assert.deepEqual(byId.get(art1.json.artifactId).processing, { stage: 'parsed', runRef: 'run-ar5', failureReason: null, nextAction: null }, '有记录→processing');
  assert.equal(byId.get(art2.json.artifactId).processing, null, '无记录→null');
});

test('AR6 单件评估读：内部正常读 200（回归保护：授权对齐不破坏既有内部消费）', async () => {
  const custId = await mkCustomer('AR6客户');
  const assId = await mkAssessment(custId, 9);
  const ok = await creditP(k)('GET', `/api/v2/assessments/${assId}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.assessment.assessmentId, assId);
});
