// §11 追加（2026-09-19 路B=任务01）验收：检查会话 kind 双形态匹配（IR-03-8④）+ 客户身份线程内应答（IR-03-6）。
// M1 start 材料前置双形态（裸 kind × material.<kind> 登记） M2 晚到材料重开/缺口双形态
// M3 客户线程投影（cit_* 经名册 customer 角色；只读 customer 受众问题） M4 客户回答/提问受众门+presence
// M5 越权面（名册无 customer 角色 404 / next-actions 403 / 小结强制 customer 受众）。
// 基于 utils.mjs 主 harness（bootNonce 指纹 + CREATE DATABASE 护栏）。
// 运行：cd Back/A && JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres' node --test test/inspection-kind-customer-thread.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client } from './utils.mjs';

const T1 = 't1';
const SPEC = [
  'tok-root=root:human:admin:all:all:all',
  'tok-owner=own:human:business:all:t1',
  'tok-finance=fin:human:finance:all:t1',
  'tok-asset=ast:human:asset:all:t1',
  'tok-credit=cre:human:credit:all:t1',
].join(',');

const root = (k) => client(k.base, 'tok-root');
const owner = (k) => client(k.base, 'tok-owner');
const finance = (k) => client(k.base, 'tok-finance');
const asset = (k) => client(k.base, 'tok-asset');
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let seq = 0;
async function mkCustomer(name) {
  seq += 1;
  const r = await root(k)('POST', '/api/v2/customers', {
    requestId: rid('mk'), tenantId: T1, legalEntityRef: `LE-KT-${Date.now()}-${seq}`, displayName: name,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.customerId;
}

async function registerArtifact(c, customerId, kind, extra = {}) {
  const r = await c('POST', `/api/v2/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind, content: { source: 'kind-thread-test', seq: rid('s') }, ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.artifactId;
}

async function redeemCit(customerId, kind) {
  const inv = await owner(k)('POST', `/api/v2/customers/${customerId}/invitations`, {
    requestId: rid('inv'), tenantId: T1, role: 'customer-owner', allowedKinds: [kind],
  });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const red = await client(k.base, null)('POST', '/api/v2/invitations/redeem', { code: inv.json.invitation.code });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  return client(k.base, red.json.credential);
}

/** 建模板+项目+会话（preparing）。roster 默认含 {roleKey:'customer'}（IR-03-6 名册绑定）。 */
async function scaffold(customerId, { items, planSnapshot = {}, withCustomerRole = true, title = 'kind/线程会话' } = {}) {
  const tpl = await root(k)('POST', '/api/v1/templates', {
    requestId: rid('tpl'), name: 'kt-min', industry: null,
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: true },
      { roleKey: 'approver', title: '审批', isHumanRole: true },
    ],
    goals: [{ goalKey: 'g1', title: 'g1', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.json));
  const proj = await root(k)('POST', '/api/v1/projects', { requestId: rid('p'), templateId: tpl.json.templateId, name: 'kt 项目' });
  assert.equal(proj.status, 200, JSON.stringify(proj.json));
  const roster = [
    { roleKey: 'business', kind: 'human' },
    { roleKey: 'finance', kind: 'human' },
    { roleKey: 'credit', kind: 'human' },
    ...(withCustomerRole ? [{ roleKey: 'customer', kind: 'human' }] : []),
  ];
  const ses = await owner(k)('POST', `/api/v1/projects/${proj.json.projectId}/inspections`, {
    requestId: rid('ins'), customerId, title, sceneVersion: 'scene-1',
    roles: roster, ownerRole: 'business',
    items: items ?? [{
      itemKey: 'contract_check', title: '合同核验', required: true,
      responsibleRole: 'credit', targetRole: 'finance', requiresHumanVerification: false,
      expectedEvidenceKinds: ['purchase_contract'], objectRef: null, detail: {},
    }],
    planSnapshot,
  });
  assert.equal(ses.status, 200, JSON.stringify(ses.json));
  return { projectId: proj.json.projectId, sessionId: ses.json.sessionId };
}

async function snapshot(sessionId) {
  const r = await root(k)('GET', `/api/v1/inspections/${sessionId}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.snapshot;
}

async function start(sessionId) {
  const snap = await snapshot(sessionId);
  return owner(k)('POST', `/api/v1/inspections/${sessionId}/start`, {
    requestId: rid('start'), expectedVersion: snap.version, acceptedPlanVersion: snap.planVersion,
  });
}

const k = await startKernel({ principalSpec: SPEC });
test.after(async () => { await k.stop(); });

test('M1 start 材料前置：material.<kind> 登记件满足裸 kind 前置；反向亦通；缺失仍 409', async () => {
  const c1 = await mkCustomer('双形态前置客户');

  // 反例先行：前置 purchase_contract、无任何材料 → NOT_READY + missing 列表
  const s0 = await scaffold(c1, { planSnapshot: { prerequisites: ['purchase_contract'] } });
  const blocked = await start(s0.sessionId);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error, 'NOT_READY');
  assert.deepEqual(blocked.json.missing, ['purchase_contract']);

  // 通道登记形态 material.purchase_contract 满足裸 kind 前置（IR-03-8④ 主案例）
  await registerArtifact(asset(k), c1, 'material.purchase_contract');
  const ok = await start(s0.sessionId);
  assert.equal(ok.status, 200, `material.<kind> 满足裸 kind 前置: ${JSON.stringify(ok.json)}`);

  // 反向：前置带前缀、登记件裸 kind
  const c2 = await mkCustomer('双形态反向客户');
  await registerArtifact(asset(k), c2, 'purchase_contract');
  const s2 = await scaffold(c2, { planSnapshot: { prerequisites: ['material.purchase_contract'] } });
  const ok2 = await start(s2.sessionId);
  assert.equal(ok2.status, 200, `裸 kind 满足 material.<kind> 前置: ${JSON.stringify(ok2.json)}`);
});

test('M2 晚到材料重开与缺口：material.<kind> 登记件解除 waiting_evidence（裸 kind 期望）', async () => {
  const c1 = await mkCustomer('晚到材料客户');
  const s = await scaffold(c1);
  assert.equal((await start(s.sessionId)).status, 200);

  // 财务口述已答、材料未取得 → waiting_evidence（缺 purchase_contract）
  const snap1 = await snapshot(s.sessionId);
  const itemId = snap1.items[0].itemId;
  const q = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'internal', targetRole: 'finance', itemId, question: '请确认合同口径', purpose: 'verify',
  });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const ans = await finance(k)('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, {
    requestId: rid('ans'), answer: { text: '口径已确认' },
  });
  assert.equal(ans.status, 200, JSON.stringify(ans.json));
  const snap2 = await snapshot(s.sessionId);
  assert.equal(snap2.items[0].status, 'waiting_evidence', JSON.stringify(snap2.items));

  // 晚到材料以通道命名空间登记 → 重开命中（裸名匹配），核验项推进 to_verify（无需人工核验=false → verified）
  const artId = await registerArtifact(asset(k), c1, 'material.purchase_contract');
  const late = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/evidence`, {
    requestId: rid('late'), artifactId: artId,
  });
  assert.equal(late.status, 200, `晚到材料重开: ${JSON.stringify(late.json)}`);
  assert.deepEqual(late.json.reopened, [itemId], JSON.stringify(late.json));
  const snap3 = await snapshot(s.sessionId);
  assert.equal(snap3.items[0].status, 'verified', `自动核实（无需人工）: ${JSON.stringify(snap3.items)}`);

  // next-actions 不再显示该材料缺口
  const na = await owner(k)('GET', `/api/v1/inspections/${s.sessionId}/next-actions`);
  assert.equal(na.status, 200);
  const row = na.json.nextActions.find((a) => a.itemId === itemId);
  assert.ok(row === undefined || !(row.blockedReason ?? '').includes('waiting_evidence'), JSON.stringify(na.json));
});

test('M3 客户线程投影：cit_* 经名册 customer 角色读会话，仅见 customer 受众问题', async () => {
  const c1 = await mkCustomer('客户线程客户');
  const s = await scaffold(c1);
  assert.equal((await start(s.sessionId)).status, 200);
  const cit = await redeemCit(c1, 'site_photo');

  // 内部建两类问题：customer 受众（target customer）+ 内部受众（target finance）
  const snap1 = await snapshot(s.sessionId);
  const itemId = snap1.items[0].itemId;
  const qc = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'customer', targetRole: 'customer', itemId,
    question: '请说明合同签署日期', purpose: 'contract_date',
  });
  assert.equal(qc.status, 200, JSON.stringify(qc.json));
  const qi = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'internal', targetRole: 'finance', question: '内部：流水口径', purpose: 'internal_only',
  });
  assert.equal(qi.status, 200, JSON.stringify(qi.json));

  // cit_* 读会话 → 客户线程投影
  const view = await cit('GET', `/api/v1/inspections/${s.sessionId}`);
  assert.equal(view.status, 200, `cit_* 读会话: ${JSON.stringify(view.json)}`);
  const snapC = view.json.snapshot;
  assert.equal(snapC.audience, 'customer');
  assert.equal(snapC.questions.length, 1, '只含 customer 受众问题');
  assert.equal(snapC.questions[0].questionId, qc.json.questionId);
  assert.equal(snapC.roles, undefined, '不含名册');
  assert.equal(snapC.participants, undefined, '不含参与者');
  assert.equal(snapC.followups, undefined, '不含会后待办');
  assert.equal(snapC.outbound, undefined, '不含外发面');
  assert.equal(snapC.planSnapshotHash, undefined, '不含计划快照哈希');
  assert.ok(snapC.items.every((i) => i.itemId === itemId), '只含被 customer 问题引用的核验项');

  // 内部身份仍读完整快照
  const full = await snapshot(s.sessionId);
  assert.equal(full.audience, undefined);
  assert.ok(Array.isArray(full.roles));
});

test('M4 客户在线程内回答/提问：受众门 + presence；内部受众 403', async () => {
  const c1 = await mkCustomer('客户应答客户');
  const s = await scaffold(c1);
  assert.equal((await start(s.sessionId)).status, 200);
  const cit = await redeemCit(c1, 'site_photo');

  const snap1 = await snapshot(s.sessionId);
  const itemId = snap1.items[0].itemId;
  const qc = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'customer', targetRole: 'customer', itemId,
    question: '请说明设备现状', purpose: 'equipment_status',
  });
  assert.equal(qc.status, 200);

  // presence（customer 角色）→ 200
  const pr = await cit('POST', `/api/v1/inspections/${s.sessionId}/presence`, {
    requestId: rid('pr'), role: 'customer', present: true,
  });
  assert.equal(pr.status, 200, `cit_* presence: ${JSON.stringify(pr.json)}`);

  // 回答 customer 受众问题 → 200（材料引用同样接受：invitations 兑换时 allowedKinds 含 site_photo）
  const photo = await cit('POST', `/api/v2/customers/${c1}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'site_photo', content: { takenAt: '2026-09-19T10:00:00Z' },
  });
  assert.equal(photo.status, 200, `cit_* 补材料: ${JSON.stringify(photo.json)}`);
  const ans = await cit('POST', `/api/v1/inspections/${s.sessionId}/questions/${qc.json.questionId}/answer`, {
    requestId: rid('ans'), answer: { text: '设备运转正常', evidenceRefs: [photo.json.artifactId] },
  });
  assert.equal(ans.status, 200, `cit_* 线程内回答: ${JSON.stringify(ans.json)}`);

  // 内部受众问题：回答 403；提问 403
  const qi = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'internal', targetRole: 'finance', question: '内部问题', purpose: 'internal_gate',
  });
  assert.equal(qi.status, 200);
  const ansDenied = await cit('POST', `/api/v1/inspections/${s.sessionId}/questions/${qi.json.questionId}/answer`, {
    requestId: rid('ans'), answer: { text: '尝试越权' },
  });
  assert.equal(ansDenied.status, 403, JSON.stringify(ansDenied.json));
  const askDenied = await cit('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'internal', targetRole: 'finance', question: '客户建内部问题', purpose: 'ask_internal',
  });
  assert.equal(askDenied.status, 403, JSON.stringify(askDenied.json));

  // 客户自建 customer 受众问题 → 200
  const askOk = await cit('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: rid('q'), audience: 'customer', targetRole: 'customer', question: '请问还需要哪些材料？', purpose: 'customer_ask',
  });
  assert.equal(askOk.status, 200, `cit_* 客户受众提问: ${JSON.stringify(askOk.json)}`);

  // next-actions 是内部作业视图 → 403
  const na = await cit('GET', `/api/v1/inspections/${s.sessionId}/next-actions`);
  assert.equal(na.status, 403, JSON.stringify(na.json));
});

test('M5 越权面：名册无 customer 角色 404；小结强制 customer 受众', async () => {
  const c1 = await mkCustomer('越权面对照客户');

  // 名册不含 customer 角色：cit_* 不可见（404 不泄露存在性）
  const sNo = await scaffold(c1, { withCustomerRole: false, title: '无名册客户会话' });
  const citNo = await redeemCit(c1, 'site_photo');
  const denied = await citNo('GET', `/api/v1/inspections/${sNo.sessionId}`);
  assert.equal(denied.status, 404, JSON.stringify(denied.json));

  // 有 customer 名册的会话：跑完 end 生成两受众小结 → cit_* 拿 customer 受众、internal 403
  const s = await scaffold(c1, { title: '小结受众会话' });
  const cit = await redeemCit(c1, 'site_photo');
  assert.equal((await start(s.sessionId)).status, 200);
  let snap = await snapshot(s.sessionId);
  const endRes = await owner(k)('POST', `/api/v1/inspections/${s.sessionId}/end`, {
    requestId: rid('end'), expectedVersion: snap.version,
  });
  assert.equal(endRes.status, 200, JSON.stringify(endRes.json));

  const sumDefault = await cit('GET', `/api/v1/inspections/${s.sessionId}/summary`);
  assert.equal(sumDefault.status, 200, JSON.stringify(sumDefault.json));
  assert.ok(sumDefault.json.summaries.length >= 1, '客户可见 customer 受众小结');
  for (const row of sumDefault.json.summaries) assert.equal(row.audience, 'customer');

  const sumInternal = await cit('GET', `/api/v1/inspections/${s.sessionId}/summary?audience=internal`);
  assert.equal(sumInternal.status, 403, JSON.stringify(sumInternal.json));

  const sumAll = await root(k)('GET', `/api/v1/inspections/${s.sessionId}/summary`);
  assert.equal(sumAll.status, 200);
  assert.ok(sumAll.json.summaries.some((r) => r.audience === 'internal'), '内部身份可见两受众');
});
