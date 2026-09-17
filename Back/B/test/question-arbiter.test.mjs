// 任务 02 · B3/W07–W09 问题绑定与调度规划测试（纯内存，无网络/模型）。
// W07 同一人同时收到四域问题 → 去重合并、无抢话、无重复骚扰；
// W08 财务/厂长分别回答 → 各自线程和受众正确，内部策略不外发；
// W09 暂停 → 零新外发授权；answered ≠ 已核验 语义分立。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindQuestions, planDispatch, classifyOutboundTier, OUTBOUND_TIERS } from '../src/schedule/question-arbiter.mjs';

function candidate(questionId, over = {}) {
  return {
    questionId, purpose: 'fact_verification', audience: 'customer',
    factKey: 'equipment_ownership_verified', period: '2026-07', domain: 'asset',
    ...over,
  };
}

test('W07 同一对象/期间/目的/受众的四域重复问题合并为一条；差异键保留', () => {
  const r = bindQuestions({
    sessionId: 'ins-1', customerId: 'cust-9',
    questions: [
      candidate('q-policy', { domain: 'policy' }),
      candidate('q-credit', { domain: 'credit' }),
      candidate('q-asset', { domain: 'asset' }),
      // 差异：不同期间 → 保留
      candidate('q-june', { questionId: 'q-june', period: '2026-06', domain: 'asset' }),
      // 差异：对象不同 → 保留
      candidate('q-other', { factKey: 'equipment_model', domain: 'asset' }),
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.mergedCount, 2, '三条同键问题：首条建立绑定，后两条合并');
  assert.equal(r.bindings.length, 3, '同键 1 + 差异 2');
  const main = r.bindings.find((b) => b.questionId === 'q-policy');
  assert.ok(main);
  assert.deepEqual([...main.mergedFrom].sort(), ['q-asset', 'q-credit']);
  assert.deepEqual([...new Set(main.domainSources)].sort(), ['asset', 'credit', 'policy']);
  assert.ok(main.questionId === 'q-policy', '合并保留原问');
});

test('W07 单语音仲裁：同一公共通话时刻至多一个 customer 语音问题 active，其余排队不抢话', () => {
  const r = bindQuestions({
    sessionId: 'ins-1', customerId: 'cust-9',
    questions: [
      candidate('q-a', { priority: 'high' }),
      candidate('q-b', { factKey: 'monthly_operating_cash_flow', priority: 'blocking', domain: 'credit' }),
      candidate('q-c', { factKey: 'lease_registration_done', priority: 'normal', domain: 'asset' }),
    ],
  });
  const plan = planDispatch({
    bindings: r.bindings,
    session: { outboundPaused: false, dispatchGeneration: 4 },
    callState: { activeCallId: 'call-1' },
  });
  const voiceActive = plan.plan.outbound.filter((o) => o.dispatchMode === 'voice_active');
  assert.equal(voiceActive.length, 1, '仅一个主动语音问题');
  assert.equal(voiceActive[0].questionId, 'q-b', 'blocking 优先获得语音槽');
  const queued = plan.plan.queued.filter((q) => q.queueReason === 'VOICE_SLOT_BUSY');
  assert.equal(queued.length, 2, '其余语音问题排队（不抢话）');
});

test('W08 财务/厂长并行线程不受语音槽阻塞；内部受众走内部线程', () => {
  const r = bindQuestions({
    sessionId: 'ins-1', customerId: 'cust-9',
    questions: [
      candidate('q-cust-voice', { priority: 'blocking' }),
      // 财务/厂长是客户侧分级角色：audience=customer、targetAnswerer 区分角色、各自授权线程
      candidate('q-finance', { targetAnswerer: 'finance', purpose: 'fact_verification', mode: 'thread', factKey: 'monthly_debt_service', domain: 'credit' }),
      candidate('q-factory', { targetAnswerer: 'factory_manager', purpose: 'site_recheck', mode: 'thread', objectId: 'obj-CNC-01', domain: 'asset' }),
      candidate('q-internal', { audience: 'internal', targetAnswerer: 'staff', purpose: 'clarification', factKey: 'materials_freshness_ok', domain: 'policy' }),
    ],
  });
  assert.equal(r.ok, true);
  const plan = planDispatch({
    bindings: r.bindings,
    session: { outboundPaused: false, dispatchGeneration: 4 },
    callState: { activeCallId: 'call-1' },
  });
  const out = Object.fromEntries(plan.plan.outbound.map((o) => [o.questionId, o]));
  assert.equal(out['q-cust-voice'].dispatchMode, 'voice_active');
  assert.equal(out['q-finance'].dispatchMode, 'customer_thread', '财务线程并行派发');
  assert.equal(out['q-finance'].targetAnswerer, 'finance');
  assert.equal(out['q-factory'].dispatchMode, 'customer_thread');
  assert.equal(out['q-internal'].dispatchMode, 'internal_thread:staff');
  assert.ok(plan.plan.queued.every((q) => !['q-finance', 'q-factory', 'q-internal'].includes(q.questionId)), '并行线程不被语音仲裁阻塞');
});

test('B3.2 外发分级：敏感指控/授信承诺/评分参数/未知目的 → 转人工；常规核验 → 自动', () => {
  const auto = classifyOutboundTier({ purpose: 'fact_verification' });
  assert.equal(auto.tier, OUTBOUND_TIERS.AUTO);
  for (const [name, purpose] of [['敏感指控', 'sensitive_accusation'], ['授信承诺', 'formal_credit_commitment'], ['评分参数', 'internal_score_exposure']]) {
    const t = classifyOutboundTier({ purpose });
    assert.equal(t.tier, OUTBOUND_TIERS.HUMAN, `${name} 必须转人工`);
    assert.equal(t.autoOutboundAllowed, false);
  }
  const unknown = classifyOutboundTier({ purpose: 'something_new' });
  assert.equal(unknown.tier, OUTBOUND_TIERS.HUMAN, '清单外目的失败关闭转人工');
  const flagged = classifyOutboundTier({ purpose: 'fact_verification', sensitivity: 'sensitive' });
  assert.equal(flagged.tier, OUTBOUND_TIERS.HUMAN, '显式敏感标记优先');
});

test('W09 暂停会话：计划零新外发，全部进 blocked（OUTBOUND_PAUSED）', () => {
  const r = bindQuestions({
    sessionId: 'ins-1', customerId: 'cust-9',
    questions: [candidate('q-1'), candidate('q-2', { factKey: 'equipment_model' })],
  });
  const plan = planDispatch({
    bindings: r.bindings,
    session: { outboundPaused: true, dispatchGeneration: 7 },
    callState: { activeCallId: null },
  });
  assert.equal(plan.paused, true);
  assert.equal(plan.plan.outbound.length, 0, '暂停后零新外发授权');
  assert.equal(plan.plan.blocked.length, 2);
  assert.ok(plan.plan.blocked.every((b) => b.blockedCode === 'OUTBOUND_PAUSED'));
});

test('B3.3 推进语义分立：计划明示 answered ≠ 材料取得 ≠ 核验完成', () => {
  const plan = planDispatch({ bindings: [], session: {}, callState: { activeCallId: null } });
  assert.ok(plan.progressionNote.includes('已回答不冒充已核验'));
  assert.ok(plan.progressionNote.includes('仅有某 kind 材料不证明'));
});

test('B3.1 绑定缺锚点/缺 purpose/缺 audience 明确拒绝（不外发无绑定问题）', () => {
  const r = bindQuestions({
    sessionId: 'ins-1', customerId: 'cust-9',
    questions: [
      { questionId: 'q-noanchor', purpose: 'fact_verification', audience: 'customer' },
      { questionId: 'q-nopurpose', audience: 'customer', factKey: 'x' },
      candidate('q-ok', { purpose: 'evidence_request' }),
    ],
  });
  assert.equal(r.ok, false, '存在非法绑定 → 整批拒绝（调用方修复后重绑）');
  assert.equal(r.bindings.length, 1);
  assert.ok(r.problems.some((p) => p.includes('q-noanchor')));
  assert.ok(r.problems.some((p) => p.includes('q-nopurpose')));
});
