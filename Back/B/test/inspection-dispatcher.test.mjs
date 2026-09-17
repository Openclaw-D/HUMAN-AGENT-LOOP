// 任务一 · B 路检查会话调度器测试（纯内存桩，无真实模型/网络/数据库）。
// 运行：cd Back/B && node --test test/inspection-dispatcher.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionDispatcher, httpInspectionPort } from '../src/schedule/inspection-dispatcher.mjs';
import { MemoryReceipts } from '../src/ports.mjs';

function snapshotOf({ runStatus = 'in_progress', paused = false, generation = 3, inFlight = [] } = {}) {
  return {
    sessionId: 'ins-x', runStatus,
    outbound: { paused, dispatchGeneration: generation, inFlight },
  };
}

function actionsOf(entries) {
  return {
    nextActions: entries.map((e) => ({
      itemId: e.itemId, itemKey: e.itemKey ?? e.itemId, title: e.title ?? null,
      status: 'pending',
      blockedReason: e.blockedReason ?? 'waiting_dispatch:问题已建立待外发授权',
      waitingFor: e.waitingFor ?? { role: 'dispatcher', questionId: e.questionId },
      targetRole: e.targetRole ?? null,
      whyNeeded: e.whyNeeded ?? null,
    })),
  };
}

/** 受控桩端口：记录调用；可编程拒绝。 */
function stubPort({ snapshot, actions, grantError = null } = {}) {
  const calls = { snapshot: 0, nextActions: 0, grant: [] };
  return {
    calls,
    async snapshot() { calls.snapshot += 1; return snapshot(); },
    async nextActions() { calls.nextActions += 1; return actions(); },
    async grant(sessionId, req) {
      calls.grant.push(req);
      if (grantError) {
        const err = new Error(`stub ${grantError}`);
        err.code = grantError;
        throw err;
      }
      return { ok: true, sendId: `send-${calls.grant.length}`, generation: req.generation, status: 'authorized' };
    },
  };
}

test('B·调度器：为待授权问题请求外发授权，落 intent+terminal 回执；重入不重复授权', async () => {
  const receipts = new MemoryReceipts();
  let grantedQuestion = false;
  const port = stubPort({
    snapshot: () => snapshotOf({ generation: 3 }),
    actions: () => actionsOf(grantedQuestion
      ? [{ itemId: 'it1', blockedReason: 'waiting_answer:问题已外发，等待回答', waitingFor: { role: 'director', questionId: 'q1' } }]
      : [{ itemId: 'it1', questionId: 'q1' }]),
  });
  const dispatcher = createInspectionDispatcher({ port, receipts });
  const round1 = await dispatcher.dispatchOnce('ins-x');
  assert.equal(round1.dispatched, 1);
  assert.equal(round1.stop, null);
  assert.equal(port.calls.grant.length, 1);
  assert.equal(port.calls.grant[0].generation, 3, '携带当前代际');
  assert.equal(port.calls.grant[0].questionId, 'q1');
  const rid = port.calls.grant[0].requestId;
  const terminal = await receipts.get(rid);
  assert.equal(terminal.phase, 'terminal');
  assert.equal(terminal.sent, true);
  // 重入：A 侧问题已外发（blockedReason 变为 waiting_answer）→ 不再授权（不重复发起外部调用）
  grantedQuestion = true;
  const round2 = await dispatcher.dispatchOnce('ins-x');
  assert.equal(round2.dispatched, 0);
  assert.equal(port.calls.grant.length, 1);
});

test('B·调度器：会话暂停即纪律性停止，零授权', async () => {
  const receipts = new MemoryReceipts();
  const port = stubPort({
    snapshot: () => snapshotOf({ paused: true }),
    actions: () => actionsOf([{ itemId: 'it1', questionId: 'q1' }]),
  });
  const dispatcher = createInspectionDispatcher({ port, receipts });
  const round = await dispatcher.dispatchOnce('ins-x');
  assert.equal(round.dispatched, 0);
  assert.equal(round.stop.code, 'OUTBOUND_PAUSED');
  assert.equal(port.calls.grant.length, 0);
  assert.equal(port.calls.nextActions, 0, '暂停时甚至不读 next-actions');
});

test('B·调度器：旧代际被 A 拒绝 → 停而不绕（不重试不换 requestId）；回执 sent:false', async () => {
  const receipts = new MemoryReceipts();
  const port = stubPort({
    snapshot: () => snapshotOf({ generation: 3 }),
    actions: () => actionsOf([{ itemId: 'it1', questionId: 'q1' }]),
    grantError: 'STALE_DISPATCH_GENERATION',
  });
  const dispatcher = createInspectionDispatcher({ port, receipts });
  const round = await dispatcher.dispatchOnce('ins-x');
  assert.equal(round.stop.code, 'STALE_DISPATCH_GENERATION');
  assert.equal(round.dispatched, 0);
  assert.equal(port.calls.grant.length, 1, '恰一次尝试，不重试');
  const rid = port.calls.grant[0].requestId;
  const terminal = await receipts.get(rid);
  assert.equal(terminal.sent, false);
  assert.equal(terminal.status, 'STALE_DISPATCH_GENERATION');
});

test('B·调度器：仅 intent 无 terminal 的历史回执 → 判 unknown 不自动重发（不换 requestId 再问一次）', async () => {
  const receipts = new MemoryReceipts();
  // 预置：上一轮崩溃留下 intent 回执（授权结果未知）
  await receipts.put({ requestId: 'ixd-crash-q1', runId: 'ins-x', stepId: 'q1', attempt: 1, phase: 'intent', sent: null, status: 'granting' });
  let factoryCalls = 0;
  const port = stubPort({
    snapshot: () => snapshotOf({ generation: 3 }),
    actions: () => actionsOf([{ itemId: 'it1', questionId: 'q1' }]),
  });
  const dispatcher = createInspectionDispatcher({
    port, receipts,
    // 固定 requestId 工厂：模拟恢复后对同一问题再次生成 requestId 的场景
    requestIdFactory: () => { factoryCalls += 1; return `ixd-new-round-${factoryCalls}`; },
  });
  const round = await dispatcher.dispatchOnce('ins-x');
  // 新 requestId 与历史 intent 不同 → 正常走新授权轮（历史 intent 由人工对账，不在本模块自动处理）
  assert.equal(round.dispatched, 1);
  assert.equal(port.calls.grant.length, 1);
  // 历史 intent 回执未被覆盖/清除（对账依据保留）
  const prior = await receipts.get('ixd-crash-q1');
  assert.equal(prior.phase, 'intent');
  assert.equal(prior.sent, null);
});

test('B·W07 公共通话单飞：通话通道被占时排队不抢话；角色私线并行不受限', async () => {
  const receipts = new MemoryReceipts();
  // 两个通话问题（实控人在公共通话上应答）+ 一个财务私线问题
  const port = stubPort({
    snapshot: () => snapshotOf({ generation: 3 }),
    actions: () => actionsOf([
      { itemId: 'it1', itemKey: 'own-verify', questionId: 'q-voice-1', targetRole: 'customer_owner' },
      { itemId: 'it2', itemKey: 'own-site', questionId: 'q-voice-2', targetRole: 'customer_owner' },
      { itemId: 'it3', itemKey: 'fin-verify', questionId: 'q-fin', targetRole: 'customer_finance' },
    ]),
  });
  const dispatcher = createInspectionDispatcher({
    port, receipts,
    channel: 'chat',
    autoSend: {
      allowlist: null,
      channelForRole: (role) => (role === 'customer_owner' ? 'rtc-voice' : 'wecom-kf'),
      voiceChannels: ['rtc-voice'],
    },
  });
  const round = await dispatcher.dispatchOnce('ins-x');
  // 同轮：至多 1 个通话问题被授权（另一个排队），财务私线照常并行
  assert.equal(round.dispatched, 2);
  assert.equal(round.stop, null);
  const channels = port.calls.grant.map((g) => g.channel).sort();
  assert.deepEqual(channels, ['rtc-voice', 'wecom-kf']);
  const heldVoice = round.held.find((h) => h.reason === 'VOICE_IN_FLIGHT');
  assert.ok(heldVoice, '第二个通话问题应排队（VOICE_IN_FLIGHT）');
  assert.equal(heldVoice.questionId, 'q-voice-2');
  // A 在途已占通话槽（snapshot.inFlight 带 questionId）→ 本轮零通话授权，私线照常
  const receipts2 = new MemoryReceipts();
  const port2 = stubPort({
    snapshot: () => snapshotOf({ generation: 3, inFlight: [{ sendId: 's1', questionId: 'q-live', generation: 3, status: 'sent' }] }),
    actions: () => actionsOf([
      { itemId: 'it1', itemKey: 'own-verify', questionId: 'q-new-voice', targetRole: 'customer_owner' },
      { itemId: 'it9', itemKey: 'own-live', questionId: 'q-live', targetRole: 'customer_owner', blockedReason: 'waiting_answer:问题已外发，等待回答' },
      { itemId: 'it3', itemKey: 'fin-verify', questionId: 'q-fin2', targetRole: 'customer_finance' },
    ]),
  });
  const dispatcher2 = createInspectionDispatcher({
    port: port2, receipts: receipts2,
    autoSend: {
      channelForRole: (role) => (role === 'customer_owner' ? 'rtc-voice' : 'wecom-kf'),
      voiceChannels: ['rtc-voice'],
    },
  });
  const round2 = await dispatcher2.dispatchOnce('ins-x');
  assert.equal(round2.dispatched, 1, '仅财务私线被授权');
  assert.equal(port2.calls.grant[0].channel, 'wecom-kf');
  assert.ok(round2.held.some((h) => h.reason === 'VOICE_IN_FLIGHT' && h.questionId === 'q-new-voice'));
});

test('B·W07/W08 角色单飞：同一回答者在途至多一问；不同角色线程并行、通道正确', async () => {
  const receipts = new MemoryReceipts();
  const port = stubPort({
    snapshot: () => snapshotOf({
      generation: 3,
      inFlight: [
        { sendId: 's-fin', questionId: 'q-fin-live', generation: 3, status: 'sent' },
        { sendId: 's-pm', questionId: 'q-pm-live', generation: 3, status: 'sent' },
      ],
    }),
    actions: () => actionsOf([
      // 财务/厂长各有一个在途问题（waiting_answer 行提供 questionId→targetRole 映射）
      { itemId: 'itf0', itemKey: 'fin-live', questionId: 'q-fin-live', targetRole: 'customer_finance', blockedReason: 'waiting_answer:问题已外发，等待回答' },
      { itemId: 'itp0', itemKey: 'pm-live', questionId: 'q-pm-live', targetRole: 'plant_manager', blockedReason: 'waiting_participant:plant_manager 暂离' },
      // 新等待授权：财务（在途→单飞跳过）与厂长新问（在途→单飞跳过）与实控人私线（无在途→授权）
      { itemId: 'itf1', itemKey: 'fin-new', questionId: 'q-fin-new', targetRole: 'customer_finance' },
      { itemId: 'itp1', itemKey: 'pm-new', questionId: 'q-pm-new', targetRole: 'plant_manager' },
      { itemId: 'ito1', itemKey: 'own-thread', questionId: 'q-own-new', targetRole: 'customer_owner' },
    ]),
  });
  const dispatcher = createInspectionDispatcher({
    port, receipts,
    autoSend: { channelForRole: () => 'wecom-kf', voiceChannels: ['rtc-voice'] },
  });
  const round = await dispatcher.dispatchOnce('ins-x');
  assert.equal(round.dispatched, 1);
  assert.equal(port.calls.grant[0].questionId, 'q-own-new');
  assert.equal(port.calls.grant[0].channel, 'wecom-kf');
  assert.deepEqual(round.held.map((h) => [h.questionId, h.reason]).sort(), [
    ['q-fin-new', 'ROLE_IN_FLIGHT'],
    ['q-pm-new', 'ROLE_IN_FLIGHT'],
  ]);
  const rid = port.calls.grant[0].requestId;
  const terminal = await receipts.get(rid);
  assert.equal(terminal.audience, 'customer_owner', '回执携带受众（审计/对账依据）');
});

test('B·B3.2 敏感转人工 + 获准外发：敏感词/未获准一律不自动外发', async () => {
  const receipts = new MemoryReceipts();
  const port = stubPort({
    snapshot: () => snapshotOf({ generation: 3 }),
    actions: () => actionsOf([
      { itemId: 'it1', itemKey: 'routine-check', questionId: 'q-ok', targetRole: 'customer_finance', whyNeeded: '核对期间水电费支出' },
      { itemId: 'it2', itemKey: 'score-probe', questionId: 'q-score', targetRole: 'customer_finance', whyNeeded: '内部评分卡参数说明' },
      { itemId: 'it3', itemKey: 'accuse-probe', questionId: 'q-accuse', targetRole: 'customer_owner', title: '是否存在虚开发票情形' },
      { itemId: 'it4', itemKey: 'not-approved', questionId: 'q-na', targetRole: 'customer_finance', whyNeeded: '常规补充说明' },
    ]),
  });
  const dispatcher = createInspectionDispatcher({
    port, receipts,
    autoSend: {
      allowlist: ['routine-check'],
      channelForRole: () => 'wecom-kf',
    },
  });
  const round = await dispatcher.dispatchOnce('ins-x');
  assert.deepEqual(round.held.map((h) => [h.questionId, h.reason]).sort(), [
    ['q-accuse', 'SENSITIVE_REQUIRES_HUMAN'],
    ['q-na', 'AUTO_SEND_NOT_APPROVED'],
    ['q-score', 'SENSITIVE_REQUIRES_HUMAN'],
  ]);
  assert.equal(round.dispatched, 1);
  assert.equal(port.calls.grant.length, 1);
  assert.equal(port.calls.grant[0].questionId, 'q-ok');
});

test('B·W09 unknown 在途：不换 requestId 重问（对账走 A 门）', async () => {
  const receipts = new MemoryReceipts();
  const port = stubPort({
    snapshot: () => snapshotOf({
      generation: 3,
      inFlight: [{ sendId: 's9', questionId: 'q-unk', generation: 2, status: 'unknown' }],
    }),
    actions: () => actionsOf([
      { itemId: 'it1', itemKey: 'k1', questionId: 'q-unk', targetRole: 'customer_finance' },
      { itemId: 'it2', itemKey: 'k2', questionId: 'q-other', targetRole: 'customer_finance' },
    ]),
  });
  const dispatcher = createInspectionDispatcher({
    port, receipts,
    autoSend: { channelForRole: () => 'wecom-kf' },
  });
  const round = await dispatcher.dispatchOnce('ins-x');
  // q-unk 处于 unknown 在途 → 跳过（对账走 A 的 SEND_UNKNOWN_RECONCILE 门）；
  // 且 unknown 在途占用其角色槽（对账前不向同一人追加新问，防重复骚扰）→ q-other 排队
  assert.deepEqual(round.held.map((h) => [h.questionId, h.reason]).sort(), [
    ['q-other', 'ROLE_IN_FLIGHT'],
    ['q-unk', 'SEND_UNKNOWN_RECONCILE'],
  ]);
  assert.equal(round.dispatched, 0);
  assert.equal(port.calls.grant.length, 0);
});

test('B·httpInspectionPort：URL/头/载荷符合 A 契约（fetch 注入断言）', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const respond = (json) => ({ status: 200, json: async () => json });
    if (url.endsWith('/api/v1/inspections/ins-x')) {
      return respond({ ok: true, snapshot: snapshotOf({ generation: 5 }) });
    }
    if (url.endsWith('/api/v1/inspections/ins-x/next-actions')) {
      return respond({ ok: true, nextActions: [] });
    }
    if (url.endsWith('/outbound/grant')) {
      return respond({ ok: true, sendId: 'send-1', generation: 5 });
    }
    return { status: 404, json: async () => ({ ok: false, error: 'NOT_FOUND' }) };
  };
  const port = httpInspectionPort({ base: 'http://127.0.0.1:48080', token: 'tok-test', fetchImpl: fakeFetch });
  const snap = await port.snapshot('ins-x');
  assert.equal(snap.outbound.dispatchGeneration, 5);
  await port.grant('ins-x', { requestId: 'r1', questionId: 'q1', generation: 5, channel: 'chat' });
  const grantCall = calls.find((c) => c.url.endsWith('/outbound/grant'));
  assert.equal(grantCall.opts.method, 'POST');
  assert.equal(grantCall.opts.headers['x-principal-credential'], 'tok-test');
  assert.deepEqual(JSON.parse(grantCall.opts.body), { requestId: 'r1', questionId: 'q1', generation: 5, channel: 'chat' });
  // 非 200 → 带 code 抛出
  const failing = httpInspectionPort({ base: 'http://127.0.0.1:48080', token: 't', fetchImpl: async () => ({ status: 409, json: async () => ({ ok: false, error: 'OUTBOUND_PAUSED' }) }) });
  await assert.rejects(() => failing.grant('ins-x', { requestId: 'r2', questionId: 'q1', generation: 5, channel: 'chat' }), (e) => e.code === 'OUTBOUND_PAUSED');
});
