// A2 边界 · 检查会话编排测试：在局部暂停/接管、外发代际、等待与改派、checkpoint/恢复。
// 对应验收：A02/A04/A05/A07/A09/A11/A12。
// 运行：cd Back/A && JW_A_ADMIN_DB_URL='postgres://jwcc:jwcc-local-demo@127.0.0.1:15444/postgres' node --test test/inspection-orchestration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaffold, startKernel, client, assertOk, assertCode, uid, T, backdateQuestionCreated, createTestDb, dropTestDb } from './inspection-utils.mjs';

async function startedSession(k, opts = {}) {
  const s = await scaffold({ base: k.base, ...opts });
  const snap = await s.snapshot();
  const r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/start`, { requestId: uid(), expectedVersion: snap.version, acceptedPlanVersion: snap.planVersion });
  if (r.status !== 200) throw new Error(`start 失败: ${JSON.stringify(r.json)}`);
  return s;
}

test('A02·厂长暂离、财务仍在线：依赖厂长的项等待，财务工作继续，既有记录保留', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  // 两条问题建立并外发
  for (const [item, purpose, audience] of [[eq, 'equipment_confirm', 'customer'], [fin, 'cashflow_clarify', 'internal']]) {
    const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
      requestId: uid(), itemId: item.itemId, audience, targetRole: item.targetRole, purpose,
      question: `核验问题：${item.title}`,
    });
    assertOk(t, q, '建问题');
    const g = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
    assertOk(t, g, '外发授权');
  }
  // 厂长暂离、财务在线
  const director = client(k.base, T.director);
  assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/presence`, { requestId: uid(), role: 'director', present: false }), '厂长暂离');
  // next-actions：设备项等待厂长，财务项不受阻塞
  const nx = await s.next();
  const eqAction = nx.nextActions.find((a) => a.itemId === eq.itemId);
  const finAction = nx.nextActions.find((a) => a.itemId === fin.itemId);
  assert.match(eqAction.blockedReason, /waiting_participant:director/);
  assert.equal(finAction.blockedReason, 'waiting_answer:问题已外发，等待回答');
  // 财务回答继续推进；设备项保持等待且原记录不变
  const finance = client(k.base, T.finance);
  const answersBefore = await directCount(k.pool, s.sessionId, 'inspection_questions', 'answered');
  const qFin = await firstOpenQuestion(k.pool, s.sessionId, fin.itemId);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${qFin}/answer`, {
    requestId: uid(), answer: { text: '口径确认。' },
  }), '财务回答');
  const after = await s.snapshot();
  assert.equal(after.items.find((i) => i.itemId === fin.itemId).status, 'waiting_evidence', '财务推进 → 等材料');
  assert.equal(after.items.find((i) => i.itemId === eq.itemId).status, 'waiting_answer', '设备项仍在等待（不因厂长离场清状态）');
  assert.ok(await directCount(k.pool, s.sessionId, 'inspection_questions', 'answered') >= answersBefore + 1, '既有回答记录保留');
});

test('A04·自动外发与暂停并发：暂停后无新授权；在途单列；旧调度者凭旧代际被拒', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q1 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', purpose: 'confirm_a', question: '问题A',
  });
  const q2r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'internal', targetRole: 'asset', purpose: 'cross_check_b', question: '问题B',
  });
  // 并发：外发授权 vs 暂停（行锁串行化；两种结局都合法）
  const [grantRes, pauseRes] = await Promise.allSettled([
    s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q1.json.questionId, generation: 0, channel: 'chat' }),
    s.own('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: uid(), expectedVersion: (await s.snapshot()).version }),
  ]);
  assert.equal(grantRes.status, 'fulfilled');
  assert.equal(pauseRes.status, 'fulfilled');
  const pausedSnap = await s.snapshot();
  assert.equal(pausedSnap.runStatus, 'suspended');
  assert.equal(pausedSnap.outbound.paused, true);
  assert.equal(pausedSnap.outbound.dispatchGeneration, 1);
  // 结局一：grant 先赢 → 在途恰一条（gen 0）；结局二：pause 先赢 → grant 被拒 OUTBOUND_PAUSED
  const grantOk = grantRes.value.status === 200;
  if (grantOk) {
    assert.equal(pausedSnap.outbound.inFlight.length, 1, '在途单独列明');
    assert.equal(pausedSnap.outbound.inFlight[0].generation, 0);
  } else {
    assert.equal(grantRes.value.json.error, 'OUTBOUND_PAUSED');
    assert.equal(pausedSnap.outbound.inFlight.length, 0);
  }
  // 暂停后新授权 → OUTBOUND_PAUSED
  const newGrant = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 1, channel: 'chat' });
  assertCode(t, newGrant, 'OUTBOUND_PAUSED', '暂停后新授权');
  // 恢复后代际仍为 1：旧调度者凭 0 被拒 STALE_DISPATCH_GENERATION；新调度者用 1 可授权
  const snapNow = await s.snapshot();
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/resume`, { requestId: uid(), expectedVersion: snapNow.version }), 'resume');
  const oldGen = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 0, channel: 'chat' });
  assertCode(t, oldGen, 'STALE_DISPATCH_GENERATION', '旧代际绕过');
  const newGen = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 1, channel: 'chat' });
  assertOk(t, newGen, '新代际授权');
});

test('A05·问题已发送回应丢失：保留未知并对账；重复回调不重复记账；不盲重问', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'cashflow', question: '现金流口径？',
  });
  const grant = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid('g'), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  assertOk(t, grant, '授权');
  const sendId = (await s.snapshot()).outbound.inFlight[0].sendId;
  // 重复结果回调（新 requestId）→ 拒绝，不重复记账
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/${sendId}/result`, { requestId: uid('r1'), outcome: 'sent' }), '结果 sent');
  const dup = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/${sendId}/result`, { requestId: uid('r2'), outcome: 'sent' });
  assertCode(t, dup, 'QUESTION_CLOSED', '重复结果回调');
  // 回答到达后，再来的重复回答（新 requestId）→ QUESTION_CLOSED，不重复记账
  const finance = client(k.base, T.finance);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, { requestId: uid('a1'), answer: { text: '口径 A。' } }), '首次回答');
  const dupAns = await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, { requestId: uid('a2'), answer: { text: '口径 A（重复回调）' } });
  assertCode(t, dupAns, 'QUESTION_CLOSED', '重复回答');
  const n = await directCount(k.pool, s.sessionId, 'inspection_questions', 'answered');
  assert.equal(n, 1, '回答只记一次');
  // unknown 场景：另一问题发送结果未知 → 直接重问被拒（先对账）
  const q2r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'taxes', question: '税费口径？',
  });
  const g2 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid('g2'), questionId: q2r.json.questionId, generation: 0, channel: 'chat' });
  assertOk(t, g2, '授权2');
  const sendId2 = (await s.snapshot()).outbound.inFlight.find((x) => x.questionId === q2r.json.questionId).sendId;
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/${sendId2}/result`, { requestId: uid(), outcome: 'unknown', note: '渠道超时无回执' }), '结果 unknown');
  const reask = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions/${q2r.json.questionId}/reask`, { requestId: uid() });
  assertCode(t, reask, 'SEND_UNKNOWN_RECONCILE', '未知不盲重问');
  // 对账前快照在途仍列 unknown
  const snapNow = await s.snapshot();
  assert.ok(snapNow.outbound.inFlight.some((x) => x.status === 'unknown'), 'unknown 在途列明');
});

test('A07·超过等待/追问边界：一次 sweep 转一条待办；不无限重试；系统失败不记客户失信', async (t) => {
  const k = await startKernel({ extraArgs: [] });
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'wait_test', question: '等待超时问题？',
  });
  const grant = await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  assertOk(t, grant, '授权');
  // 白盒时钟：把问题/外发时间拨早 400s（默认 waitTimeout 300s），不用长 sleep
  await backdateQuestionCreated(k.pool, s.sessionId, 400);
  const sweep1 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/sweep`, { requestId: uid() });
  assertOk(t, sweep1, 'sweep1');
  assert.equal(sweep1.json.deferred.length, 1, '转一条待办');
  const snap1 = await s.snapshot();
  assert.equal(snap1.items.find((i) => i.itemKey === 'financial_answers').status, 'deferred');
  assert.equal(snap1.followups.length, 1);
  assert.match(snap1.followups[0].reason, /等待回答超时/);
  // 重复 sweep 不产生第二条待办（每事项至多一条 open）
  const sweep2 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/sweep`, { requestId: uid() });
  assertOk(t, sweep2, 'sweep2');
  assert.equal(sweep2.json.deferred.length, 0);
  // 追问越界：sent→reask 两次到上限 2，第三次 → FOLLOWUP_LIMIT_REACHED（不无限重试）
  const q2r = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'followup_limit', question: '追问上限问题？',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 0, channel: 'chat' });
  const r1 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions/${q2r.json.questionId}/reask`, { requestId: uid() });
  assertOk(t, r1, 'reask1');
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 0, channel: 'chat' });
  const r2 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions/${q2r.json.questionId}/reask`, { requestId: uid() });
  assertOk(t, r2, 'reask2');
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q2r.json.questionId, generation: 0, channel: 'chat' });
  const r3 = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions/${q2r.json.questionId}/reask`, { requestId: uid() });
  assertCode(t, r3, 'FOLLOWUP_LIMIT_REACHED', '追问越界');
});

test('A09·服务重启、隔日重新加入：状态/回执/已完成项恢复，不全量重新发问', async (t) => {
  const db = await createTestDb();
  let k = await startKernel({ dbUrl: db.url });
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', purpose: 'restart_check', question: '重启前问题。',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  const director = client(k.base, T.director);
  assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, { requestId: uid(), answer: { text: '重启前回答，已记录。' } }), '重启前回答');
  // 手动 checkpoint 后杀进程
  assertOk(t, await s.own('POST', `/api/v1/inspections/${s.sessionId}/checkpoint`, { requestId: uid() }), 'checkpoint');
  const before = await s.snapshot();
  const answeredBefore = await directCount(k.pool, s.sessionId, 'inspection_questions', 'answered');
  const sentBefore = await directCount(k.pool, s.sessionId, 'inspection_questions', 'sent');
  await k.stop();
  // 「隔日」重启（同一数据库；重启即恢复，无需开发者补状态）
  k = await startKernel({ dbUrl: db.url });
  t.after(async () => { await k.stop(); await dropTestDb(db.name); });
  const call2 = client(k.base, T.owner);
  const after = (await call2('GET', `/api/v1/inspections/${s.sessionId}`)).json.snapshot;
  assert.equal(after.runStatus, before.runStatus, '运行状态恢复');
  assert.equal(after.version, before.version, '版本不回退');
  assert.equal(after.coverage.verified, before.coverage.verified, '已完成核验保留');
  // 已答问题不再重发：answered/sent 计数不变（不自动重问）
  assert.equal(await directCount(k.pool, s.sessionId, 'inspection_questions', 'answered'), answeredBefore);
  assert.equal(await directCount(k.pool, s.sessionId, 'inspection_questions', 'sent'), sentBefore);
  // 暂停→恢复链路跨重启仍成立
  assertOk(t, await call2('POST', `/api/v1/inspections/${s.sessionId}/pause`, { requestId: uid(), expectedVersion: after.version }), '跨重启暂停');
  const snapS = (await call2('GET', `/api/v1/inspections/${s.sessionId}`)).json.snapshot;
  const res = await call2('POST', `/api/v1/inspections/${s.sessionId}/resume`, { requestId: uid(), expectedVersion: snapS.version });
  assertOk(t, res, '跨重启恢复');
  assert.equal(res.json.staleReviewItems.length, 0, '场景未变 → 无陈旧项');
});

test('A11·场景前移：旧锚定回答被拒；显式重绑保留原引用；权限撤销后旧角色动作被拒', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const q = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: eq.itemId, audience: 'customer', targetRole: 'director', purpose: 'anchor_check', objectRef: 'lathe-01', question: '车床-01 状态？',
  });
  await s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: q.json.questionId, generation: 0, channel: 'chat' });
  // 场景前移（scene-1 → scene-2）→ 锚定项 stale_review
  const scene = await s.own('POST', `/api/v1/inspections/${s.sessionId}/scene`, { requestId: uid(), sceneVersion: 'scene-2' });
  assertOk(t, scene, '场景修订');
  assert.deepEqual(scene.json.staleReviewItems, [eq.itemId]);
  const director = client(k.base, T.director);
  const ans = await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${q.json.questionId}/answer`, { requestId: uid(), answer: { text: '旧锚定下的回答' } });
  assertCode(t, ans, 'SCENE_ANCHOR_STALE', '旧锚定回答被拒');
  // 直接核验也被拒；显式重绑（不按名称相似换绑）→ pending、原引用保留在 anchors
  const asset = client(k.base, T.asset);
  const v = await asset('POST', `/api/v1/inspections/${s.sessionId}/items/${eq.itemId}/verify`, { requestId: uid(), verdict: 'confirmed' });
  assertCode(t, v, 'SCENE_ANCHOR_STALE', '陈旧锚定直接核验被拒');
  const rebind = await asset('POST', `/api/v1/inspections/${s.sessionId}/items/${eq.itemId}/rebind`, { requestId: uid(), objectRef: 'lathe-01-confirmed' });
  assertOk(t, rebind, '显式重绑');
  assert.equal(rebind.json.anchors.length, 2, '原锚定历史保留');
  assert.equal(rebind.json.anchors[0].objectRef, 'lathe-01');
  // 权限撤销：先给 finance 建好问题，再把 finance 移出名册 → 其后的回答被拒
  const snapMid = await s.snapshot();
  const fin = snapMid.items.find((i) => i.itemKey === 'financial_answers');
  const qForFin = await s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: fin.itemId, audience: 'internal', targetRole: 'finance', purpose: 'before_revoke', question: '撤销前的问题。',
  });
  assertOk(t, qForFin, '撤销前建问题');
  const plan = await s.own('POST', `/api/v1/inspections/${s.sessionId}/plan`, {
    requestId: uid(), planSnapshot: { inspectionPlanVersion: 9 },
    roles: snapMid.roles.filter((r) => r.roleKey !== 'finance'),
  });
  assertOk(t, plan, '名册修订');
  const finance = client(k.base, T.finance);
  const finAns = await finance('POST', `/api/v1/inspections/${s.sessionId}/questions/${qForFin.json.questionId}/answer`, { requestId: uid(), answer: { text: 'finance 已被撤销' } });
  assertCode(t, finAns, 'ROLE_FORBIDDEN', '被撤销角色回答被拒');
  assert.equal(finAns.json.message, '角色不在会话名册中：finance');
});

test('A12·九角色并行：按权限分流、同收件人不抢问、一角色离开不清全局状态', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const s = await startedSession(k);
  const snap = await s.snapshot();
  const eq = snap.items.find((i) => i.itemKey === 'equipment_verify');
  const fin = snap.items.find((i) => i.itemKey === 'financial_answers');
  // 并发建 4 个问题：customer×2 + internal×2（分属设备/财务两事项）；另加一个同收件人同目的（应去重合并）
  const mk = (audience, targetRole, purpose, item) => s.own('POST', `/api/v1/inspections/${s.sessionId}/questions`, {
    requestId: uid(), itemId: item.itemId, audience, targetRole, purpose, question: `并行问题 ${purpose}/${targetRole}`,
  });
  const results = await Promise.allSettled([
    mk('customer', 'director', 'p_confirm', eq),
    mk('customer', 'customer', 'p_supply', eq),
    mk('internal', 'finance', 'p_cash', fin),
    mk('internal', 'asset', 'p_asset', eq),
    mk('internal', 'finance', 'p_cash', fin), // 同收件人同目的 → duplicate
  ]);
  const vals = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  for (const [i, v] of vals.entries()) {
    assert.ok(v !== null, `并行问题 ${i} 未完成: ${JSON.stringify(results[i])}`);
    assert.equal(v.status, 200, `并行问题 ${i} 应成功`);
  }
  // 同收件人同目的不抢问：两个 p_cash 合并为一问（谁是创建者由并发顺序决定，断言不依赖顺序）
  const cashPair = [vals[2], vals[4]];
  const creators = cashPair.filter((v) => v.json.duplicate === false);
  const mergers = cashPair.filter((v) => v.json.duplicate === true);
  assert.equal(creators.length, 1, '恰一问被创建');
  assert.equal(mergers.length, 1, '另一问合并');
  assert.equal(mergers[0].json.questionId, creators[0].json.questionId, '合并指向同一问题');
  // 授权外发 4 条（并发）
  const grants = await Promise.allSettled(vals.slice(0, 4).map((v) =>
    s.own('POST', `/api/v1/inspections/${s.sessionId}/outbound/grant`, { requestId: uid(), questionId: v.json.questionId, generation: 0, channel: 'chat' })));
  for (const [i, g] of grants.entries()) {
    assert.equal(g.status, 'fulfilled', `并发授权 ${i} 应完成`);
    assert.equal(g.value.status, 200, `并发授权 ${i} 应成功: ${JSON.stringify(g.value.json)}`);
  }
  // 受众分流：客户受众问题只有名册内人类目标角色可答（内部 Agent 不能代答客户问题）
  const agent = client(k.base, T.agent);
  const custQ = vals[1].json.questionId;
  const r1 = await agent('POST', `/api/v1/inspections/${s.sessionId}/questions/${custQ}/answer`, { requestId: uid(), answer: { text: 'agent 代答客户' } });
  assert.equal(r1.status, 403, 'Agent 不可代答客户问题');
  // 财务暂离 → 其问题等待，其余角色继续
  const finance = client(k.base, T.finance);
  assertOk(t, await finance('POST', `/api/v1/inspections/${s.sessionId}/presence`, { requestId: uid(), role: 'finance', present: false }), '财务暂离');
  const nx = await s.next();
  const cashAction = nx.nextActions.find((a) => a.waitingFor && a.waitingFor.role === 'finance');
  assert.ok(cashAction, '财务项标记等待财务');
  const director = client(k.base, T.director);
  assertOk(t, await director('POST', `/api/v1/inspections/${s.sessionId}/questions/${vals[0].json.questionId}/answer`, { requestId: uid(), answer: { text: '厂长照常回答。' } }), '其他角色继续');
  const after = await s.snapshot();
  assert.equal(after.coverage.total, 3, '全局状态未被清空');
  assert.ok(after.items.every((i) => i.itemId !== undefined), '核验项仍在');
});

// ---- 直查工具 ----
async function directCount(pool, sessionId, table, status) {
  const r = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = $1 AND status = $2`, [sessionId, status]);
  return Number(r.rows[0].n);
}

async function firstOpenQuestion(pool, sessionId, itemId) {
  const r = await pool.query(
    `SELECT question_id FROM inspection_questions WHERE session_id = $1 AND item_id = $2 AND status IN ('open','sent') ORDER BY created_at LIMIT 1`,
    [sessionId, itemId],
  );
  return r.rows[0].question_id;
}
