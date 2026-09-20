// TAKEOFF-FA-1.0.0 v2.6 · 首次回租准入预评估确认 定向测试（PA-01..PA-14）。
// 契约：docs/takeoff/first-admission-v1/implementation/01/CONTRACT-PREASSESSMENT.md；登记：Back/CONTRACT.md §13。
// 运行前提：JW_A_ADMIN_DB_URL 指向本任务登记的隔离容器（jw-cc-kernel-pg@15444）。
// 合成身份/合成客户/合成数据；不使用真实客户数据，不调用收费模型。
// 机器断言核心：确认命令前后 credit_facilities / financing_requests / exposure_entries 整表零新增零变化。
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { client, createTestDb, dropTestDb, newId, sleep, startKernel } from './utils.mjs';

const T1 = 't1';
const RULE = 'rules-synth-takeoff-1'; // 合成测试规则版本标记，非公司制度

// 合成身份（第5段=租户范围）：credit=信审确认权（服务端目录）；business 默认无确认权。
const SPEC = [
  'tok-admin=admin:human:admin:all:t1',
  'tok-credit=cindy:human:credit:all:t1',
  'tok-credit2=cred2:human:credit:all:t1',
  'tok-biz=bob:human:business:all:t1',
  'tok-agent=agent1:agent:business:all:t1',
  'tok-t2=user-t2:human:credit:all:t2',
].join(',');

let k;
let credit;   // 信审确认人客户端
let biz;      // 业务客户端（角色门反例）
let agent;    // agent 客户端（候选产出 + 权限反例）
let admin;

test.before(async () => {
  k = await startKernel({ principalSpec: SPEC });
  credit = client(k.base, 'tok-credit');
  biz = client(k.base, 'tok-biz');
  agent = client(k.base, 'tok-agent');
  admin = client(k.base, 'tok-admin');
});

test.after(async () => { await k.stop(); });

// ---------- 夹具：合成客户 + 材料 + 评估链（全部走正常服务入口与真实持久化） ----------

async function makeCustomer(who = credit) {
  const r = await who('POST', '/api/v2/customers', {
    requestId: newId('r'), tenantId: T1,
    legalEntityRef: `SYNTH-${newId('le').slice(3)}`, displayName: `合成制造客户-${Date.now() % 100000}`,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function addArtifact(customerId, factKey, rev, opts = {}) {
  const r = await credit('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: newId('r'), tenantId: T1,
    kind: opts.kind ?? 'financial_statement', factKey,
    // 内容默认含唯一标记：不同材料不因同内容被判重复件（A04）；supersede 场景同理内容必异
    content: opts.content ?? { v: rev ?? 1, factKey, u: newId('u') },
    grade: opts.grade ?? 'source_supported',
    ...(opts.supersedes ? { supersedes: opts.supersedes } : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.artifactId;
}

/** 标准链：客户 → 2 件材料 → 评估（快照）→ 候选 → 待人工审阅。返回全部句柄。 */
async function buildChain({ customerId = null, withCandidate = true, candidateBody = null, producer = 'agent', withGate = true } = {}) {
  const cust = customerId ?? await makeCustomer();
  const art1 = await addArtifact(cust, 'operating_cash_flow', 1);
  const art2 = await addArtifact(cust, 'equipment_ownership', 1, { kind: 'equipment_proof' });
  const ass = await credit('POST', `/api/v2/customers/${cust}/assessments`, {
    requestId: newId('r'), tenantId: T1, ruleVersion: RULE,
    evidenceSnapshot: [{ artifactId: art1 }, { artifactId: art2 }],
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  const assessmentId = ass.json.assessmentId;
  let revision = null;
  if (withCandidate) {
    const cand = await (producer === 'agent' ? agent : credit)('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
      requestId: newId('r'), tenantId: T1,
      candidate: candidateBody ?? {
        tendency: 'do', supportableAmountMinor: 2_000_000_00, currency: 'CNY',
        suggestedTermMonths: 36, referencePriceMinor: 7_50, priceUnit: 'per_annum_rate_bps', priceBasis: '合成试算口径（测试）',
        conditions: ['设备保险第一受益人变更'], rationale: '合成候选：现金流覆盖 + 权属清晰', producedBy: 'synthesizer-v1',
        warnings: [], basisRefs: [art1, art2], runRefs: ['run-synth-001'],
      },
    });
    assert.equal(cand.status, 200, JSON.stringify(cand.json));
    revision = cand.json.revision;
    const rev = await credit('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
    assert.equal(rev.status, 200, JSON.stringify(rev.json));
  }
  if (withGate) await clearGate(k.base, cust, [art1, art2]);
  return { customerId: cust, art1, art2, assessmentId, revision };
}

async function clearGate(base, customerId, evidenceRefs, version = RULE) {
  const a = client(base, 'tok-admin');
  const active = await a('POST', '/api/v2/rule-pack-versions/activate', { requestId: newId('r'), tenantId: T1, version });
  assert.equal(active.status, 200, JSON.stringify(active.json));
  const svc = await a('POST', '/api/v2/service-identities', { requestId: newId('r'), tenantId: T1, displayName: 'synthetic-gate-fixture' });
  assert.equal(svc.status, 200, JSON.stringify(svc.json));
  const r = await client(base, svc.json.credential)('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: newId('r'), tenantId: T1, result: 'CLEAR', rulesetVersion: version, evidenceRefs,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

function confirmBody(assessmentId, over = {}) {
  return { requestId: newId('r'), tenantId: T1, assessmentVersion: over.assessmentVersion ?? 4,
    ...(over.candidateRevision !== undefined ? { candidateRevision: over.candidateRevision } : {}),
    outcome: over.outcome ?? 'support',
    ...(over.conditions !== undefined ? { conditions: over.conditions } : {}),
    rationale: over.rationale ?? '合成确认依据：现金流覆盖、权属清晰', ...Object.fromEntries(Object.entries(over).filter(([k2]) => !['assessmentVersion', 'candidateRevision', 'outcome', 'conditions', 'rationale'].includes(k2))),
  };
}

/** 账本整表快照（白盒直连；三张业务表逐行 JSON 序列化比对）。 */
async function ledgerSnapshot() {
  const out = {};
  for (const t of ['credit_facilities', 'financing_requests', 'exposure_entries']) {
    const r = await k.pool.query(`SELECT * FROM ${t} ORDER BY 1`);
    out[t] = { count: r.rows.length, rows: JSON.stringify(r.rows) };
  }
  return out;
}

// ---------- PA-01 正面人工确认：服务端校验 + 只产生预评估结果 ----------

test('PA-01 正面确认：绑定版本/修订；scope=preassessment_only；GET 可重读', async () => {
  const ch = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  assert.equal(cur.json.assessment.status, 'awaiting_human_review');
  const version = cur.json.assessment.version;
  const revision = cur.json.assessment.candidateRevision;
  assert.equal(revision, 1);

  const before = await ledgerSnapshot();
  const r = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: version, candidateRevision: revision }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.scope, 'preassessment_only');
  assert.equal(r.json.status, 'preassessment_confirmed');
  assert.equal(r.json.outcome, 'support');
  assert.equal(r.json.assessmentVersion, version + 1);
  assert.equal(r.json.candidateRevision, revision);
  assert.ok(r.json.confirmationId.startsWith('pac-'));
  const after = await ledgerSnapshot();
  assert.deepEqual(after, before, '确认动作不得改变任何账本/设施/申请行');

  const back = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  assert.equal(back.json.assessment.status, 'preassessment_confirmed');
  assert.equal(back.json.assessment.preassessment.outcome, 'support');
  assert.equal(back.json.assessment.preassessment.scope, 'preassessment_only');
  assert.equal(back.json.assessment.preassessment.needsReview, false);
  assert.equal(back.json.assessment.inputVersion, 0);
});

// ---------- PA-02 附条件支持：conditions 纪律 ----------

test('PA-02 附条件支持：条件必填；support/not_support 不得携带条件', async () => {
  const ch = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const v = cur.json.assessment.version;
  const ok = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1, outcome: 'support_with_conditions', conditions: ['补齐纳税申报表后放款前复核'], rationale: '负债线索未完全核实' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.outcome, 'support_with_conditions');
  assert.deepEqual(ok.json.conditions, ['补齐纳税申报表后放款前复核']);

  // 附条件为空 → 400
  const ch2 = await buildChain();
  const bad1 = await credit('POST', `/api/v2/assessments/${ch2.assessmentId}/confirm-preassessment`,
    confirmBody(ch2.assessmentId, { outcome: 'support_with_conditions', conditions: [] }));
  assert.equal(bad1.status, 400);
  // support 携带条件 → 400
  const bad2 = await credit('POST', `/api/v2/assessments/${ch2.assessmentId}/confirm-preassessment`,
    confirmBody(ch2.assessmentId, { conditions: ['多余条件'] }));
  assert.equal(bad2.status, 400);
  // 未知字段 → 400（严格 Schema）
  const bad3 = await credit('POST', `/api/v2/assessments/${ch2.assessmentId}/confirm-preassessment`,
    confirmBody(ch2.assessmentId, { approvedAmountMinor: 100 }));
  assert.equal(bad3.status, 400);
});

// ---------- PA-03 负面结论：无候选可终结；客户档案保留 ----------

test('PA-03 负面结论（not_support）：无候选/collecting 可记录；客户不删除', async () => {
  const ch = await buildChain({ withCandidate: false });
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const r = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, outcome: 'not_support',
      rationale: '政策硬条件不满足已核实（合成测试政策），其余分析不再需要' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outcome, 'not_support');
  assert.equal(r.json.candidateRevision, null);
  // 客户档案仍在（负面终结 ≠ 删除客户）
  const cust = await credit('GET', `/api/v2/customers/${ch.customerId}`);
  assert.equal(cust.status, 200);
});

// ---------- PA-04 冲突按结果区分：阻断正面，不阻止有依据的负面 ----------

test('PA-04 快照事实冲突：正面 409 REVIEW_REQUIRED；负面可记录', async () => {
  const cust = await makeCustomer();
  await addArtifact(cust, 'equipment_price', 1);           // 同一事实键两份现行断言（两件都入快照）
  const b = await addArtifact(cust, 'equipment_price', 2);
  void b;
  // 快照必须同时包含两份冲突断言
  const ass2 = await credit('POST', `/api/v2/customers/${cust}/assessments`, {
    requestId: newId('r'), tenantId: T1, ruleVersion: RULE,
    evidenceSnapshot: await (async () => {
      const arts = await credit('GET', `/api/v2/customers/${cust}/artifacts`);
      return arts.json.artifacts.filter((a) => a.current).map((a) => ({ artifactId: a.artifactId }));
    })(),
  });
  const assessmentId = ass2.json.assessmentId;
  const gateBasis = await credit('GET', `/api/v2/assessments/${assessmentId}`);
  await clearGate(k.base, cust, gateBasis.json.assessment.evidenceSnapshot.map((ref) => ref.artifactId));
  await agent('POST', `/api/v2/assessments/${assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: 100_00, producedBy: 'synthesizer-v1' },
  });
  await credit('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
  const cur = await credit('GET', `/api/v2/assessments/${assessmentId}`);
  const v = cur.json.assessment.version;
  const blocked = await credit('POST', `/api/v2/assessments/${assessmentId}/confirm-preassessment`,
    confirmBody(assessmentId, { assessmentVersion: v, candidateRevision: 1 }));
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error, 'REVIEW_REQUIRED');
  assert.ok(blocked.json.conflicts.length >= 1);
  const neg = await credit('POST', `/api/v2/assessments/${assessmentId}/confirm-preassessment`,
    confirmBody(assessmentId, { assessmentVersion: v, candidateRevision: 1, outcome: 'not_support',
      rationale: '设备价格两份现行材料互相矛盾且无法核实——依据冲突记录负面' }));
  assert.equal(neg.status, 200, JSON.stringify(neg.json));
});

// ---------- PA-05 行政撤回与结论互相排斥（语义区分） ----------

test('PA-05 撤回区分：withdraw 后不可确认；确认后不可 decide', async () => {
  const ch = await buildChain();
  const wd = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/decide`,
    { requestId: newId('r'), tenantId: T1, decision: 'withdraw_assessment', rationale: '客户主动撤回（行政结束，非风险拒绝）' });
  assert.equal(wd.status, 200, JSON.stringify(wd.json));
  assert.equal(wd.json.status, 'superseded');
  const after = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const cf = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: after.json.assessment.version, candidateRevision: 1 }));
  assert.equal(cf.status, 409);
  assert.equal(cf.json.error, 'NOT_READY');

  // 反向：确认后再 decide 同样 NOT_READY
  const ch2 = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${ch2.assessmentId}`);
  await credit('POST', `/api/v2/assessments/${ch2.assessmentId}/confirm-preassessment`,
    confirmBody(ch2.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1 }));
  const dec = await credit('POST', `/api/v2/assessments/${ch2.assessmentId}/decide`,
    { requestId: newId('r'), tenantId: T1, decision: 'withdraw_assessment' });
  assert.equal(dec.status, 409);
});

// ---------- PA-06 幂等：同号同载荷单效果；同号异载荷冲突 ----------

test('PA-06 幂等：同号同载荷重放单效果；同号异载荷 409', async () => {
  const ch = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const body = { requestId: 'req-confirm-idem-1', tenantId: T1, assessmentVersion: cur.json.assessment.version,
    candidateRevision: 1, outcome: 'support', rationale: '幂等样例' };
  const r1 = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`, body);
  assert.equal(r1.status, 200);
  const r2 = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`, body);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.confirmationId, r1.json.confirmationId, '同号同载荷返回原回执');
  const dbRows = await k.pool.query(`SELECT COUNT(*)::int AS n FROM preassessment_confirmations WHERE assessment_id=$1`, [ch.assessmentId]);
  assert.equal(dbRows.rows[0].n, 1, '单效果：确认记录至多一条');
  const r3 = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`, { ...body, outcome: 'not_support', rationale: '同号异载荷' });
  assert.equal(r3.status, 409);
  assert.equal(r3.json.error, 'IDEMPOTENCY_REPLAY_CONFLICT');
});

// ---------- PA-07 过期版本：评估版本/候选修订前移 ----------

test('PA-07 过期版本：VERSION_CONFLICT 附服务端当前值', async () => {
  const ch = await buildChain();
  const cur0 = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const vNow = cur0.json.assessment.version;
  const stale = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: vNow + 10, candidateRevision: 1 }));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'VERSION_CONFLICT');
  assert.equal(stale.json.serverVersion, vNow);

  // 候选修订前移：r2 提交后仍绑 r1 → VERSION_CONFLICT(scope=candidate)
  const r2 = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1,
    candidate: { tendency: 'do_with_adjusted_terms', supportableAmountMinor: 1_500_000_00, suggestedTermMonths: 24,
      referencePriceMinor: 8_20, priceUnit: 'per_annum_rate_bps', priceBasis: '合成试算口径（修订）',
      conditions: ['降低敞口后复核'], rationale: '不利证据后修订', producedBy: 'synthesizer-v1', changeReason: '新增负债线索', runRefs: ['run-synth-002'] },
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal(r2.json.revision, 2);
  assert.equal(r2.json.status, 'awaiting_human_review', '待审中的候选修订不回退状态');
  const cur1 = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const conflict = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: cur1.json.assessment.version, candidateRevision: 1 }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, 'VERSION_CONFLICT');
  assert.equal(conflict.json.serverCandidateRevision, 2);
});

// ---------- PA-08 跨客户/跨租户：越权统一 404 ----------

test('PA-08 跨租户确认：404 不泄露存在性', async () => {
  const ch = await buildChain();
  const t2 = client(k.base, 'tok-t2');
  const r = await t2('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { tenantId: 't2', candidateRevision: 1 }));
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'NOT_FOUND');
});

// ---------- PA-09 假身份：403 ----------

test('PA-09 假身份确认：403 拒绝', async () => {
  const ch = await buildChain();
  const fake = client(k.base, 'tok-not-a-real-credential');
  const r = await fake('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { candidateRevision: 1 }));
  assert.equal(r.status, 403);
});

// ---------- PA-10 权限目录：业务/agent/service 无确认权（不默认给业务人信审权限） ----------

test('PA-10 角色门：business/agent/service 均 403；agent 可产出候选但不可确认', async () => {
  const ch = await buildChain({ producer: 'credit' });
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const v = cur.json.assessment.version;

  const asBiz = await biz('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1 }));
  assert.equal(asBiz.status, 403);
  assert.equal(asBiz.json.error, 'PERMISSION_DENIED');

  const asAgent = await agent('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1 }));
  assert.equal(asAgent.status, 403);

  // service 身份（admin 签发）同样 403
  const svc = await admin('POST', '/api/v2/service-identities', { requestId: newId('r'), tenantId: T1, displayName: 'svc-test' });
  assert.equal(svc.status, 200, JSON.stringify(svc.json));
  const asSvc = client(k.base, svc.json.credential);
  const r3 = await asSvc('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1 }));
  assert.equal(r3.status, 403);
});

// ---------- PA-11 重要新证据：确认前 STALE_BASIS；确认后仅标需复核（历史不覆盖） ----------

test('PA-11 新证据失效投影：前置取代阻断正面；后置取代只标 needsReview', async () => {
  // (a) 确认前：快照工件被取代 → stale → 正面确认 STALE_BASIS
  const chA = await buildChain();
  await addArtifact(chA.customerId, 'operating_cash_flow', 2, { supersedes: chA.art1 });
  const a1 = await credit('GET', `/api/v2/assessments/${chA.assessmentId}`);
  assert.equal(a1.json.assessment.stale, true);
  assert.equal(a1.json.assessment.inputVersion, 1, '快照受影响取代事件使输入版本前移');
  const blocked = await credit('POST', `/api/v2/assessments/${chA.assessmentId}/confirm-preassessment`,
    confirmBody(chA.assessmentId, { assessmentVersion: a1.json.assessment.version, candidateRevision: 1 }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'STALE_BASIS');

  // (b) 确认后：重要新证据 → 旧确认保留 + needsReview 投影 + 事件
  const chB = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${chB.assessmentId}`);
  const ok = await credit('POST', `/api/v2/assessments/${chB.assessmentId}/confirm-preassessment`,
    confirmBody(chB.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1 }));
  assert.equal(ok.status, 200);
  const confirmedAt = ok.json.confirmedAt;
  await sleep(20);
  const sup = await addArtifact(chB.customerId, 'equipment_ownership', 2, { kind: 'equipment_proof', supersedes: chB.art2 });
  const back = await credit('GET', `/api/v2/assessments/${chB.assessmentId}`);
  assert.equal(back.json.assessment.status, 'preassessment_confirmed', '状态不被新证据改写');
  assert.equal(back.json.assessment.stale, true);
  assert.equal(back.json.assessment.preassessment.outcome, 'support', '历史结论保留');
  assert.equal(back.json.assessment.preassessment.confirmedAt, confirmedAt, '确认本体不被覆盖');
  assert.equal(back.json.assessment.preassessment.needsReview, true, '只显示需复核');
  assert.ok(String(back.json.assessment.preassessment.reviewReason).includes('superseded'));
  const evs = await credit('GET', `/api/v2/customers/${chB.customerId}/events?after=0&limit=200`);
  const flagged = evs.json.events.filter((e) => e.eventType === 'PREASSESSMENT_REVIEW_FLAGGED');
  assert.equal(flagged.length, 1, 'PREASSESSMENT_REVIEW_FLAGGED 恰一次');
  assert.equal(flagged[0].payload.superseded, chB.art2);
  assert.equal(flagged[0].payload.newArtifactId, sup);
  void sup;
});

// ---------- PA-12 账本零变化（机器断言核心）：全部确认变体前后整表一致 ----------

test('PA-12 账本零变化：正/负/失败确认前后三表逐行一致', async () => {
  const ch = await buildChain();
  const chNeg = await buildChain({ withCandidate: false });
  const before = await ledgerSnapshot();
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1 }));
  const curNeg = await credit('GET', `/api/v2/assessments/${chNeg.assessmentId}`);
  await credit('POST', `/api/v2/assessments/${chNeg.assessmentId}/confirm-preassessment`,
    confirmBody(chNeg.assessmentId, { assessmentVersion: curNeg.json.assessment.version, outcome: 'not_support', rationale: '合成负面' }));
  // 失败确认（版本冲突/重复确认）同样零写入
  await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { candidateRevision: 1 }));
  await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: 1, candidateRevision: 1 }));
  const after = await ledgerSnapshot();
  assert.deepEqual(after, before, 'credit_facilities/financing_requests/exposure_entries 零新增零变化');
  // 存量设施/申请数为 0 也如实断言（本链从未调用正式授信接口）
  assert.equal(after.credit_facilities.count, 0);
  assert.equal(after.financing_requests.count, 0);
  assert.equal(after.exposure_entries.count, 0);
});

// ---------- PA-13 候选修订历史与同版绑定 ----------

test('PA-13 候选历史：修订追加、字段齐备、GET 读回；确认绑定当前修订', async () => {
  const ch = await buildChain(); // r1（agent 产出，含新字段）
  const r2 = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: 2_200_000_00, suggestedTermMonths: 48,
      referencePriceMinor: 7_10, priceUnit: 'per_annum_rate_bps', priceBasis: '合成口径 v2',
      rationale: '改善证据后上调', producedBy: 'synthesizer-v1', changeReason: '客户补充订单簿', basisRefs: [ch.art1] },
  });
  assert.equal(r2.status, 200);
  const his = await credit('GET', `/api/v2/assessments/${ch.assessmentId}/candidates`);
  assert.equal(his.status, 200, JSON.stringify(his.json));
  assert.equal(his.json.candidates.length, 2);
  assert.equal(his.json.currentRevision, 2);
  assert.equal(his.json.candidates[0].isCurrent, false);
  assert.equal(his.json.candidates[1].isCurrent, true);
  assert.equal(his.json.candidates[1].suggestedTermMonths, 48);
  assert.equal(his.json.candidates[1].referencePriceMinor, 7_10);
  assert.equal(his.json.candidates[1].priceUnit, 'per_annum_rate_bps');
  assert.equal(his.json.candidates[1].changeReason, '客户补充订单簿');
  assert.deepEqual(his.json.candidates[1].runRefs, []);
  // 服务端盖章：修订与输入版本由服务端决定
  assert.equal(his.json.candidates[1].inputVersion, 0);

  // 确认绑定 r2 成功；GET 单件投影 candidateRevision=2
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  assert.equal(cur.json.assessment.candidateRevision, 2);
  const ok = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 2 }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  // 按客户清单投影加法字段
  const list = await credit('GET', `/api/v2/customers/${ch.customerId}/assessments`);
  const mine = list.json.assessments.find((a) => a.assessmentId === ch.assessmentId);
  assert.equal(mine.preassessment.scope, 'preassessment_only');
  assert.equal(mine.candidateRevision, 2);
});

// ---------- PA-15 显式期望不符：inputVersion/ruleVersion/snapshotHash → STALE_BASIS ----------

test('PA-15 显式期望：传入 inputVersion/ruleVersion/snapshotHash 与服务端不符即拒（防调用方持旧上下文确认）', async () => {
  const ch = await buildChain();
  const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
  const v = cur.json.assessment.version;
  const badInput = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1, inputVersion: 3 }));
  assert.equal(badInput.status, 409);
  assert.equal(badInput.json.error, 'STALE_BASIS');
  assert.equal(badInput.json.serverInputVersion, 0);
  const badRule = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1, ruleVersion: 'rules-old-0.9' }));
  assert.equal(badRule.status, 409);
  assert.equal(badRule.json.error, 'STALE_BASIS');
  assert.equal(badRule.json.serverRuleVersion, RULE);
  const badSnap = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1, snapshotHash: 'deadbeef' }));
  assert.equal(badSnap.status, 409);
  assert.equal(badSnap.json.error, 'STALE_BASIS');
  // 一致的期望放行：显式传入正确 inputVersion/ruleVersion/snapshotHash 后确认成功
  const ok = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
    confirmBody(ch.assessmentId, { assessmentVersion: v, candidateRevision: 1, inputVersion: 0, ruleVersion: RULE,
      snapshotHash: cur.json.assessment.snapshotHash }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.ruleVersion, RULE);
});


// ---------- PA-14 重启恢复：退出/重启后确认与历史可重读 ----------

test('PA-14 重启恢复：确认、候选历史、需复核投影重启后仍在', async () => {
  const keep = await startKernel({ principalSpec: SPEC, keepDb: true });
  try {
    const c1 = client(keep.base, 'tok-credit');
    const a1 = client(keep.base, 'tok-agent');
    const mk = await c1('POST', '/api/v2/customers', { requestId: newId('r'), tenantId: T1, legalEntityRef: `SYNTH-R${Date.now()}`, displayName: '重启恢复合成客户' });
    const cust = mk.json.customerId;
    const art = await (async () => {
      const r = await c1('POST', `/api/v2/customers/${cust}/artifacts`, { requestId: newId('r'), tenantId: T1, kind: 'customer_profile', factKey: 'profile', content: { v: 1 }, grade: 'source_supported' });
      return r.json.artifactId;
    })();
    const ass = await c1('POST', `/api/v2/customers/${cust}/assessments`, { requestId: newId('r'), tenantId: T1, ruleVersion: RULE, evidenceSnapshot: [{ artifactId: art }] });
    const assessmentId = ass.json.assessmentId;
    await a1('POST', `/api/v2/assessments/${assessmentId}/candidate`, { requestId: newId('r'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: 50_00, producedBy: 'synthesizer-v1' } });
    await c1('POST', `/api/v2/assessments/${assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
    const cur = await c1('GET', `/api/v2/assessments/${assessmentId}`);
    await clearGate(keep.base, cust, [art]);
    const conf = await c1('POST', `/api/v2/assessments/${assessmentId}/confirm-preassessment`,
      { requestId: newId('r'), tenantId: T1, assessmentVersion: cur.json.assessment.version, candidateRevision: 1, outcome: 'support', rationale: '重启前确认' });
    assert.equal(conf.status, 200);

    await keep.stop(); // keepDb=true：不删库
    const again = await startKernel({ dbUrl: keep.dbUrl, principalSpec: SPEC });
    try {
      const c2 = client(again.base, 'tok-credit');
      const back = await c2('GET', `/api/v2/assessments/${assessmentId}`);
      assert.equal(back.json.assessment.status, 'preassessment_confirmed');
      assert.equal(back.json.assessment.preassessment.confirmationId, conf.json.confirmationId);
      const his = await c2('GET', `/api/v2/assessments/${assessmentId}/candidates`);
      assert.equal(his.json.currentRevision, 1);
    } finally {
      await again.stop();
    }
  } finally {
    if (keep.dbName !== null) await dropTestDb(keep.dbName);
  }
});

// ---------- PA-16 Gate 回执硬门（D-03 修复）：非 CLEAR 阻断正面确认；换版失效；负面不受阻断 ----------

test('PA-16 Gate 硬门：HARD_BLOCK/NEEDS_EVIDENCE/HOLD 阻断正面；CLEAR 放行；换版须重新收口；负面不受阻断', async () => {
  // 合成规则版本登记 + 服务身份（03 链同型回执通道）
  const v1 = 'rules-synth-takeoff-1', v2 = 'rules-synth-takeoff-2';
  const act1 = await admin('POST', '/api/v2/rule-pack-versions/activate', { requestId: newId('r'), tenantId: T1, version: v1 });
  assert.equal(act1.status, 200, JSON.stringify(act1.json));
  const svc = await admin('POST', '/api/v2/service-identities', { requestId: newId('r'), tenantId: T1, displayName: 'gate-svc-pa16' });
  assert.equal(svc.status, 200, JSON.stringify(svc.json));
  const service = client(k.base, svc.json.credential);
  const registerGate = (customerId, result, rulesetVersion, extra = {}) => service('POST', `/api/v2/customers/${customerId}/rule-gate-receipts`, {
    requestId: newId('r'), tenantId: T1, result, rulesetVersion,
    reasonCodes: extra.reasonCodes ?? [`SIM-TEST-${result}`], ruleIds: extra.ruleIds ?? ['RULE-TEST-1'],
    ...extra,
  });

  // (a) CLEAR → 正面确认放行
  const chA = await buildChain();
  const curA = await credit('GET', `/api/v2/assessments/${chA.assessmentId}`);
  const clear = await registerGate(chA.customerId, 'CLEAR', v1, { evidenceRefs: [chA.art1, chA.art2] });
  assert.equal(clear.status, 200, JSON.stringify(clear.json));
  const okA = await credit('POST', `/api/v2/assessments/${chA.assessmentId}/confirm-preassessment`,
    confirmBody(chA.assessmentId, { assessmentVersion: curA.json.assessment.version, candidateRevision: 1 }));
  assert.equal(okA.status, 200, JSON.stringify(okA.json));

  // (b) HARD_BLOCK → 正面 409 GATE_BLOCKED（附回执与规则明细）；负面结论不受阻断
  const chB = await buildChain();
  await registerGate(chB.customerId, 'HARD_BLOCK', v1, { ruleIds: ['SIM-LITIGATION-PENDING-01'] });
  const curB = await credit('GET', `/api/v2/assessments/${chB.assessmentId}`);
  const blocked = await credit('POST', `/api/v2/assessments/${chB.assessmentId}/confirm-preassessment`,
    confirmBody(chB.assessmentId, { assessmentVersion: curB.json.assessment.version, candidateRevision: 1 }));
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error, 'GATE_BLOCKED');
  assert.equal(blocked.json.gateResult, 'HARD_BLOCK');
  assert.ok(blocked.json.ruleIds.includes('SIM-LITIGATION-PENDING-01'));
  // 状态未被改写：仍 awaiting_human_review，候选历史不被改写
  const backB = await credit('GET', `/api/v2/assessments/${chB.assessmentId}`);
  assert.equal(backB.json.assessment.status, 'awaiting_human_review');
  assert.equal(backB.json.assessment.candidateRevision, 1);
  const negB = await credit('POST', `/api/v2/assessments/${chB.assessmentId}/confirm-preassessment`,
    confirmBody(chB.assessmentId, { assessmentVersion: curB.json.assessment.version, candidateRevision: 1, outcome: 'not_support',
      rationale: '涉诉硬阻断下依据记录负面终结（负面不受正面硬门约束）' }));
  assert.equal(negB.status, 200, JSON.stringify(negB.json));

  // (c) NEEDS_EVIDENCE / HOLD_FOR_REVIEW 同判据阻断（与决策闭环 evaluateReadiness 一致）
  for (const result of ['NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW']) {
    const ch = await buildChain();
    await registerGate(ch.customerId, result, v1);
    const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
    const r = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
      confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1 }));
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.error, 'GATE_BLOCKED');
    assert.equal(r.json.gateResult, result);
  }

  // (d) CLEAR 但规则已换版 → 回执失效：STALE_BASIS（解冻只随新收口产生）；按新版本重收口后放行
  const chD = await buildChain();
  await registerGate(chD.customerId, 'CLEAR', v1, { evidenceRefs: [chD.art1, chD.art2] });
  const act2 = await admin('POST', '/api/v2/rule-pack-versions/activate', { requestId: newId('r'), tenantId: T1, version: v2 });
  assert.equal(act2.status, 200, JSON.stringify(act2.json));
  const curD = await credit('GET', `/api/v2/assessments/${chD.assessmentId}`);
  const staleGate = await credit('POST', `/api/v2/assessments/${chD.assessmentId}/confirm-preassessment`,
    confirmBody(chD.assessmentId, { assessmentVersion: curD.json.assessment.version, candidateRevision: 1 }));
  assert.equal(staleGate.status, 409, JSON.stringify(staleGate.json));
  assert.equal(staleGate.json.error, 'STALE_BASIS');
  assert.equal(staleGate.json.activeRulePackVersion, v2);
  await registerGate(chD.customerId, 'CLEAR', v2, { evidenceRefs: [chD.art1, chD.art2] });
  const oldCandidate = await credit('POST', `/api/v2/assessments/${chD.assessmentId}/confirm-preassessment`,
    confirmBody(chD.assessmentId, { assessmentVersion: curD.json.assessment.version, candidateRevision: 1 }));
  assert.equal(oldCandidate.status, 409, JSON.stringify(oldCandidate.json));
  assert.equal(oldCandidate.json.error, 'STALE_BASIS');
  const revised = await credit('POST', `/api/v2/assessments/${chD.assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: 2_000_000_00,
      producedBy: 'synthesizer-v1', basisRefs: [chD.art1, chD.art2], ruleVersion: v2, changeReason: '按新规则重新评估' },
  });
  assert.equal(revised.status, 200, JSON.stringify(revised.json));
  const refreshed = await credit('GET', `/api/v2/assessments/${chD.assessmentId}`);
  const okD = await credit('POST', `/api/v2/assessments/${chD.assessmentId}/confirm-preassessment`,
    confirmBody(chD.assessmentId, { assessmentVersion: refreshed.json.assessment.version, candidateRevision: revised.json.revision }));
  assert.equal(okD.status, 200, JSON.stringify(okD.json));
});

// ---------- PA-17 五域词表（OBS-03-01）：business 域分析运行可登记；四域不受影响 ----------

test('PA-19 Gate 缺失、空依据、部分/同客户其他快照、无激活规则均失败关闭且零业务写入', async () => {
  for (const scenario of ['missing', 'empty', 'partial', 'other_snapshot', 'no_active_rule']) {
    const ch = await buildChain({ withGate: false });
    if (scenario !== 'missing') {
      const refs = scenario === 'empty' ? [] : scenario === 'partial' ? [ch.art1]
        : scenario === 'other_snapshot' ? [await addArtifact(ch.customerId, 'other_input', 1), ch.art2] : [ch.art1, ch.art2];
      await clearGate(k.base, ch.customerId, refs);
      if (scenario === 'no_active_rule') await k.pool.query(`UPDATE rule_pack_versions SET status='retired' WHERE status='active'`);
    }
    const cur = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
    const before = await ledgerSnapshot();
    const r = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
      confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1 }));
    assert.equal(r.status, 409, `${scenario}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, scenario === 'missing' ? 'GATE_BLOCKED' : 'STALE_BASIS', scenario);
    const after = await credit('GET', `/api/v2/assessments/${ch.assessmentId}`);
    assert.equal(after.json.assessment.version, cur.json.assessment.version, scenario);
    assert.equal(after.json.assessment.status, 'awaiting_human_review', scenario);
    assert.equal((await k.pool.query('SELECT 1 FROM preassessment_confirmations WHERE assessment_id=$1', [ch.assessmentId])).rowCount, 0, scenario);
    assert.deepEqual(await ledgerSnapshot(), before, scenario);
    // 负面结论可以如实终结；没有 Gate 不等于系统替客户做出拒绝。
    const negative = await credit('POST', `/api/v2/assessments/${ch.assessmentId}/confirm-preassessment`,
      confirmBody(ch.assessmentId, { assessmentVersion: cur.json.assessment.version, candidateRevision: 1, outcome: 'not_support' }));
    assert.equal(negative.status, 200, `${scenario}: ${JSON.stringify(negative.json)}`);
  }
});

test('PA-17 五域词表：business（商机）域分析运行登记 200；domain 枚举含五域', async () => {
  // 本用例自持规则版本（不依赖 PA-16 留下的激活状态）
  const actR = await admin('POST', '/api/v2/rule-pack-versions/activate', { requestId: newId('r'), tenantId: T1, version: RULE });
  assert.equal(actR.status, 200, JSON.stringify(actR.json));
  const ch = await buildChain({ withCandidate: false });
  const svc2 = await admin('POST', '/api/v2/service-identities', { requestId: newId('r'), tenantId: T1, displayName: 'run-svc-pa17' });
  assert.equal(svc2.status, 200, JSON.stringify(svc2.json));
  const service = client(k.base, svc2.json.credential);
  // business（商机）域：此前 400 拒绝（四域枚举），OBS-03-01 修复后 200
  const bizRun = await service('POST', `/api/v2/customers/${ch.customerId}/analysis-runs/start`, {
    requestId: newId('r'), tenantId: T1, domain: 'business',
    deps: { artifactIds: [ch.art1], rulePackVersion: RULE }, ruleVersion: RULE,
  });
  assert.equal(bizRun.status, 200, JSON.stringify(bizRun.json));
  assert.ok(String(bizRun.json.runId).startsWith('run-'));
  // 既有四域仍可登记（词表扩展是加法）
  const polRun = await service('POST', `/api/v2/customers/${ch.customerId}/analysis-runs/start`, {
    requestId: newId('r'), tenantId: T1, domain: 'policy',
    deps: { artifactIds: [ch.art1], rulePackVersion: RULE }, ruleVersion: RULE,
  });
  assert.equal(polRun.status, 200, JSON.stringify(polRun.json));
  // 词表外域仍拒绝
  const bad = await service('POST', `/api/v2/customers/${ch.customerId}/analysis-runs/start`, {
    requestId: newId('r'), tenantId: T1, domain: 'marketing',
    deps: { artifactIds: [ch.art1], rulePackVersion: RULE }, ruleVersion: RULE,
  });
  assert.equal(bad.status, 400);
  assert.ok(String(bad.json.message).includes('business'), '错误文案应列出完整五域词表');
});

// ---------- PA-18 首次回租需求登记（契约 §12）：创建携带/修正版本锁/角色门/账本零变化 ----------

test('PA-18 首次回租需求：创建可携带；修正走 business/credit+版本锁；绝不产生融资申请', async () => {
  const before = await ledgerSnapshot();
  // (a) 创建时携带需求（客户表述）
  const cust = await makeCustomer();
  const art = await addArtifact(cust, 'leaseback_request', 1, { kind: 'leaseback_request' });
  const ass = await credit('POST', `/api/v2/customers/${cust}/assessments`, {
    requestId: newId('r'), tenantId: T1, ruleVersion: RULE, evidenceSnapshot: [{ artifactId: art }],
    request: { productType: 'sale_leaseback', requestedAmountMinor: 3_000_000_00, currency: 'CNY',
      requestedTermMonths: 36, purpose: '新购设备回租融资（合成测试）',
      equipmentScope: ['CNC 加工中心×2', '数控铣床×1'] },
  });
  assert.equal(ass.status, 200, JSON.stringify(ass.json));
  let cur = await credit('GET', `/api/v2/assessments/${ass.json.assessmentId}`);
  assert.equal(cur.json.assessment.request.productType, 'sale_leaseback');
  assert.equal(cur.json.assessment.request.requestedAmountMinor, 3_000_000_00);
  assert.equal(cur.json.assessment.request.revision, 1);
  assert.equal(cur.json.assessment.requestedAmountMinor, 3_000_000_00, '顶部镜像字段供既有投影读取');
  assert.deepEqual(cur.json.assessment.request.equipmentScope, ['CNC 加工中心×2', '数控铣床×1']);

  // (b) 修正：business 角色 + 版本锁；revision 前移、declaredAt 保留首次
  const declaredAt = cur.json.assessment.request.declaredAt;
  const upd = await biz('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`, {
    requestId: newId('r'), tenantId: T1, assessmentVersion: cur.json.assessment.version,
    request: { productType: 'sale_leaseback', requestedAmountMinor: 2_500_000_00, purpose: '客户修正金额' },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.revision, 2);
  assert.equal(upd.json.request.requestedAmountMinor, 2_500_000_00);
  assert.deepEqual(upd.json.request.equipmentScope, [], '修正为整块替换（快照式），不与旧版合并');
  cur = await credit('GET', `/api/v2/assessments/${ass.json.assessmentId}`);
  assert.equal(cur.json.assessment.request.revision, 2);
  assert.equal(cur.json.assessment.request.declaredAt, declaredAt, '首次表述时间保留');
  assert.equal(cur.json.assessment.requestedAmountMinor, 2_500_000_00);
  assert.equal(cur.json.assessment.version, upd.json.assessmentVersion, '需求修订同样前移评估版本');

  // (c) 版本门/角色门/Schema 门
  const stale = await biz('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: 1, request: { productType: 'sale_leaseback' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'VERSION_CONFLICT');
  const asAgent = await agent('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: cur.json.assessment.version, request: { productType: 'sale_leaseback' } });
  assert.equal(asAgent.status, 403);
  const badProduct = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: cur.json.assessment.version, request: { productType: 'direct_lease' } });
  assert.equal(badProduct.status, 400, '本轮仅回租：直租等其他产品 400');
  const unknownField = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: cur.json.assessment.version, request: { productType: 'sale_leaseback', approvedAmountMinor: 1 } });
  assert.equal(unknownField.status, 400, '严格 Schema：未知字段拒绝');

  // (d) 确认后需求冻结
  await agent('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, {
    requestId: newId('r'), tenantId: T1, candidate: { tendency: 'do', supportableAmountMinor: 2_000_000_00, producedBy: 'synthesizer-v1' },
  });
  await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: newId('r'), tenantId: T1 });
  const cur2 = await credit('GET', `/api/v2/assessments/${ass.json.assessmentId}`);
  await clearGate(k.base, cust, [art]);
  const conf = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/confirm-preassessment`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: cur2.json.assessment.version, candidateRevision: 1, outcome: 'support', rationale: '需求冻结后确认（合成）' });
  assert.equal(conf.status, 200, JSON.stringify(conf.json));
  const afterConfirm = await credit('POST', `/api/v2/assessments/${ass.json.assessmentId}/admission-request`,
    { requestId: newId('r'), tenantId: T1, assessmentVersion: conf.json.assessmentVersion, request: { productType: 'sale_leaseback' } });
  assert.equal(afterConfirm.status, 409);
  assert.equal(afterConfirm.json.error, 'NOT_READY');

  // (e) 全程账本零变化：需求登记/修正/确认均不触碰三张业务表
  const after = await ledgerSnapshot();
  assert.deepEqual(after, before, '需求登记不产生任何设施/申请/账目行');
});
