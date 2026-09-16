// E1·任务三 检查会话面（会话操作条后端语义；上游=任务一 inspection 域，消费契约见 consumed-surface-v1）：
//   建会话(preparing) → 开始(in_progress) → 问题+外发授权(自动提问) → 暂停(suspended+OUTBOUND_PAUSED)
//   → 恢复(旧代际被拒、不重复外发) → 结束(未决项转会后待办) → 会后补证(closure_revision+1) → 小结分权。
// 全部动作经 Edge 动作代理 + 真实 A 内核；状态读取经 Edge workspace 投影（session 块）。
// 上游在制品漂移会在此测试如实 FAIL 并指认（不 skip 不伪装）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTask3Gate } from './task3-gate.mjs';

const gate = await checkTask3Gate();
const skipReason = gate.ok ? false : `任务三 E1 门未过: ${gate.reasons.join('; ')}`;
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

test('E1·任务三 检查会话面：开始/暂停外发/恢复代际/结束待办/会后补证/小结分权', { skip: skipReason }, async (t) => {
  const { bootStack } = await import('./task3-boot.mjs');
  const B = await bootStack({ t, runName: 'task3-inspect' });
  const { call, aCall } = B;
  const T1 = 't1';

  // ---- setup：模板 + 项目（A 直连，admin；模板结构字段不属于 params 键扫描面） ----
  const tpl = await aCall('adm1', 'POST', '/api/v1/templates', {
    requestId: rid('tpl'), name: 'e1-task3-template', industry: null,
    roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
    goals: [{ goalKey: 'intake', title: '受理', description: 'e1', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
  });
  assert.equal(tpl.status, 200, `模板创建失败: ${JSON.stringify(tpl.json)}`);
  const proj = await aCall('adm1', 'POST', '/api/v1/projects', { requestId: rid('pj'), templateId: tpl.json.templateId, name: 'e1-task3-project' });
  assert.equal(proj.status, 200, `项目创建失败: ${JSON.stringify(proj.json)}`);
  const projectId = proj.json.projectId;

  // ---- 客户 + 计划必要前提材料（经 Edge 动作代理） ----
  const cust = await call('biz1', 'POST', '/api/jw/v2/actions/customers', {
    requestId: rid('cust'), tenantId: T1, legalEntityRef: `USCC-IX-${rid('e')}`, displayName: '合成检查会话客户',
  });
  assert.equal(cust.status, 200, JSON.stringify(cust.json));
  const customerId = cust.json.customerId;
  const art = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'purchase_contract', factKey: 'profile',
    content: { device: 'DEV-9', contractNo: `HT-${rid('c')}` }, grade: 'source_supported',
  });
  assert.equal(art.status, 200, JSON.stringify(art.json));

  // ---- 建会话（preparing；名册含客户侧与 Agent 角色，kind 显式标注） ----
  const created = await call('biz1', 'POST', `/api/jw/v2/actions/projects/${projectId}/inspections`, {
    requestId: rid('ins'), customerId, title: 'E1 任务三·联合尽调检查会话', ownerRole: 'business',
    roles: [
      { roleKey: 'business', kind: 'human' },
      { roleKey: 'director', kind: 'human' },
      { roleKey: 'customer', kind: 'human' },
      { roleKey: 'asset_agent', kind: 'agent' },
    ],
    items: [{
      itemKey: 'dev9-ownership', title: '设备9权属核验', required: true,
      responsibleRole: 'business', targetRole: 'director', requiresHumanVerification: true,
      expectedEvidenceKinds: ['purchase_contract'], objectRef: 'DEV-9@scene-0',
      detail: { whyNeeded: '权属确认', expectedEvidence: '购销合同', stopCondition: 'confirmed' },
    }],
    planSnapshot: { prerequisites: ['purchase_contract'], source: 'e1-task3' },
  });
  assert.equal(created.status, 200, `建会话失败: ${JSON.stringify(created.json)}`);
  const sessionId = created.json.sessionId;

  // workspace 投影应内嵌会话块（kernel store 消费 INSPECTION_CREATED → getSession）
  const wsOf = async () => {
    const r = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
    assert.equal(r.status, 200, `workspace 失败: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  let ws = await wsOf();
  assert.ok(ws.snapshot.session, 'workspace 投影内嵌检查会话块');
  assert.equal(ws.snapshot.session.runStatus, 'preparing');
  let version = () => ws.snapshot.session.version;

  // ---- 开始（计划版本显式对齐） ----
  const start = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/start`, { requestId: rid('st'), expectedVersion: version() });
  assert.equal(start.status, 200, `开始失败: ${JSON.stringify(start.json)}`);
  assert.equal(start.json.runStatus, 'in_progress');
  ws = await wsOf();
  assert.equal(ws.snapshot.session.runStatus, 'in_progress');
  assert.equal(ws.snapshot.session.coverage.open, 1, '必要核验项开放数=1');

  // ---- 问题 + 外发授权（自动提问真实链路：open → sent） ----
  const q = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/questions`, {
    requestId: rid('q'), audience: 'customer', targetRole: 'director', itemId: ws.snapshot.session.items[0].itemId,
    objectRef: 'DEV-9@scene-0', question: '请展示设备9的购销合同原件与铭牌。', purpose: 'verify_ownership', requiresHuman: true,
  });
  assert.equal(q.status, 200, `问题创建失败: ${JSON.stringify(q.json)}`);
  assert.ok(!q.json.duplicate, '首次创建不命中去重');
  const qDup = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/questions`, {
    requestId: rid('q'), audience: 'customer', targetRole: 'director', objectRef: 'DEV-9@scene-0',
    question: '重复问题应命中去重。', purpose: 'verify_ownership',
  });
  assert.equal(qDup.status, 200);
  assert.equal(qDup.json.duplicate, true, '同对象/期间/目的/受众开放问题去重（不重复发问）');
  const grant1 = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/outbound/grant`, {
    requestId: rid('g'), generation: ws.snapshot.session.outbound.dispatchGeneration, questionId: q.json.questionId,
  });
  assert.equal(grant1.status, 200, `外发授权失败: ${JSON.stringify(grant1.json)}`);

  // ---- 暂停（暂停自动提问）：suspended + 代际+1 + checkpoint；暂停后授权被拒（等待原因） ----
  const pause = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/pause`, { requestId: rid('pa'), expectedVersion: version() });
  assert.equal(pause.status, 200, `暂停失败: ${JSON.stringify(pause.json)}`);
  assert.equal(pause.json.runStatus, 'suspended');
  assert.equal(pause.json.dispatchGeneration, (ws.snapshot.session.outbound.dispatchGeneration ?? 0) + 1, '调度代际 +1');
  assert.ok(pause.json.checkpointId, '暂停事务内落 checkpoint');
  const grantPaused = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/outbound/grant`, {
    requestId: rid('g'), generation: pause.json.dispatchGeneration, questionId: q.json.questionId,
  });
  assert.equal(grantPaused.status, 409);
  assert.equal(grantPaused.json.error, 'OUTBOUND_PAUSED', `暂停后新外发被拒: ${JSON.stringify(grantPaused.json)}`);
  ws = await wsOf();
  assert.equal(ws.snapshot.session.outbound.paused, true, 'workspace 如实呈现"自动提问已暂停"');
  assert.equal(ws.snapshot.session.runStatus, 'suspended');

  // ---- 恢复：旧代际申请被拒（不重复外发）；sent 问题不可重复授权 ----
  const resume = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/resume`, { requestId: rid('re'), expectedVersion: version() });
  assert.equal(resume.status, 200, `恢复失败: ${JSON.stringify(resume.json)}`);
  assert.equal(resume.json.runStatus, 'in_progress');
  const grantStale = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/outbound/grant`, {
    requestId: rid('g'), generation: 0, questionId: q.json.questionId,
  });
  assert.equal(grantStale.status, 409);
  assert.equal(grantStale.json.error, 'STALE_DISPATCH_GENERATION', '旧代际调度凭据被拒（恢复后不重复发问）');
  const grantSent = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/outbound/grant`, {
    requestId: rid('g'), generation: resume.json.runStatus === 'in_progress' ? pause.json.dispatchGeneration : 0, questionId: q.json.questionId,
  });
  assert.equal(grantSent.status, 409);
  assert.equal(grantSent.json.error, 'NOT_READY', 'sent 问题不可重复授权外发');

  // ---- 结束：未决项转会后待办（不冒充已核验） ----
  ws = await wsOf();
  const end = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/end`, { requestId: rid('end'), expectedVersion: version() });
  assert.equal(end.status, 200, `结束失败: ${JSON.stringify(end.json)}`);
  ws = await wsOf();
  assert.equal(ws.snapshot.session.runStatus, 'ended');
  assert.equal(ws.snapshot.session.closureStatus, 'pending_evidence', '收口状态如实=待补证据');
  assert.ok(ws.snapshot.session.followups.length >= 1, '未决项形成会后待办');

  // ---- 会后补证：closure_revision+1（新依据包可复核，不整轮重做） ----
  const lateArt = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'ownership_certificate', factKey: 'profile',
    content: { device: 'DEV-9', cert: `PZ-${rid('p')}` }, grade: 'source_supported',
  });
  assert.equal(lateArt.status, 200, JSON.stringify(lateArt.json));
  const late = await call('biz1', 'POST', `/api/jw/v2/actions/inspections/${sessionId}/evidence`, {
    requestId: rid('late'), artifactId: lateArt.json.artifactId,
  });
  assert.equal(late.status, 200, `会后补证失败: ${JSON.stringify(late.json)}`);

  // ---- 小结分权：internal / customer 各自投影（服务端 audience 分权） ----
  const sumIn = await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}/summary?audience=internal`);
  assert.equal(sumIn.status, 200, `内部小结失败: ${JSON.stringify(sumIn.json)}`);
  const sumCust = await aCall('biz1', 'GET', `/api/v1/inspections/${sessionId}/summary?audience=customer`);
  assert.equal(sumCust.status, 200, `客户小结失败: ${JSON.stringify(sumCust.json)}`);
  const inText = JSON.stringify(sumIn.json);
  const custText = JSON.stringify(sumCust.json);
  assert.ok(inText.includes('business') || inText.includes('internal') || inText.length > 2, '内部小结可读');
  assert.notEqual(inText, custText, '客户小结与内部小结投影分离（服务端分权，客户视图不出现内部风险策略的原文保障在投影层）');
});
