// 暂停与版本过期:迟到结果 stale、发起时暂停拒绝、显式恢复、contextVersion 变化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, deferred } from '../helpers.mjs';

test('暂停后返回:实例登记 pauseSession,在途结果返回时标 stale,不得越过暂停代次', async () => {
  const d = deferred();
  const { transport, calls } = recordingTransport(async () => d.promise);
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 30000 });

  const p = adapter.analyze(makeRequest({ generation: 3 }), {});
  adapter.pauseSession('sess-demo-1', '风控要求暂停,待实控人现场复核');
  d.resolve({ ok: true, output: goodOutput(makeEvidence(2)), usage: { totalTokens: 50 } });
  const r = await p;

  assert.equal(r.status, 'stale');
  assert.equal(r.error.code, 'SESSION_PAUSED');
  assert.ok(r.error.message.includes('暂停'));
  // 外部调用已发生:结果与 usage 都要如实呈现,供人工核对,不得当现行
  assert.equal(r.findings.length, 1);
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(ledger.totals().committedTokens, 50);
  assert.equal(calls.length, 1);
});

test('发起时已暂停:拒绝发起新调用(cancelled/SESSION_PAUSED),零调用、零占用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput([]) }));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
  adapter.pauseSession('sess-demo-1');
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'cancelled');
  assert.equal(r.error.code, 'SESSION_PAUSED');
  assert.ok(r.error.message.includes('显式人工'), '恢复必须显式人工动作');
  assert.equal(calls.length, 0);
  assert.equal(ledger.totals().occupiedTokens, 0);
});

test('context.snapshot 优先于实例登记:业务层权威快照生效', async () => {
  const d = deferred();
  const adapter = createModelAdapter({
    transport: async () => d.promise,
    ledger: createMemoryLedger({}),
    timeoutMs: 30000,
  });
  let paused = false;
  const p = adapter.analyze(makeRequest(), { snapshot: () => ({ generation: 1, contextVersion: 'ctx-1', paused }) });
  paused = true;
  d.resolve({ ok: true, output: goodOutput(makeEvidence(1)) });
  const r = await p;
  assert.equal(r.status, 'stale');
  assert.equal(r.error.code, 'SESSION_PAUSED');
});

test('generation 推进(暂停恢复后):旧代次在途结果 stale,不得冒充新代次结论', async () => {
  const d = deferred();
  let nowGen = 3;
  const adapter = createModelAdapter({
    transport: async () => d.promise,
    ledger: createMemoryLedger({}),
    timeoutMs: 30000,
  });
  const p = adapter.analyze(makeRequest({ generation: 3 }), { snapshot: () => ({ generation: nowGen, contextVersion: 'ctx-2', paused: false }) });
  nowGen = 4; // 业务层显式 resume 并推进代次
  d.resolve({ ok: true, output: goodOutput(makeEvidence(1)), usage: { totalTokens: 12 } });
  const r = await p;
  assert.equal(r.status, 'stale');
  assert.equal(r.error.code, 'GENERATION_CHANGED');
  assert.equal(r.costLedger.reservationState, 'committed', 'stale 也是真实发生的调用,成本照常结算');
});

test('contextVersion 变化:证据集更新后,旧上下文的在途结果 stale/CONTEXT_VERSION_CHANGED', async () => {
  const d = deferred();
  let nowCv = 'ctx-1';
  const adapter = createModelAdapter({
    transport: async () => d.promise,
    ledger: createMemoryLedger({}),
    timeoutMs: 30000,
  });
  const p = adapter.analyze(makeRequest({ contextVersion: 'ctx-1' }), { snapshot: () => ({ generation: 1, contextVersion: nowCv, paused: false }) });
  nowCv = 'ctx-2'; // 新证据入库,版本已变
  d.resolve({ ok: true, output: goodOutput(makeEvidence(1)) });
  const r = await p;
  assert.equal(r.status, 'stale');
  assert.equal(r.error.code, 'CONTEXT_VERSION_CHANGED');
});

test('快照未变化:结果保持 succeeded(stale 只在真实变化时触发)', async () => {
  const adapter = createModelAdapter({
    transport: async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), { snapshot: () => ({ generation: 1, contextVersion: 'ctx-1', paused: false }) });
  assert.equal(r.status, 'succeeded');
});

test('恢复后同会话可再次调用:resumeSession 清除暂停并登记新代次', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  adapter.pauseSession('sess-demo-1');
  const blocked = await adapter.analyze(makeRequest({ generation: 5 }), {});
  assert.equal(blocked.status, 'cancelled');

  adapter.resumeSession('sess-demo-1', { generation: 6, contextVersion: 'ctx-6' });
  // 恢复是显式人工动作、推进了 generation:按协议应以新的 requestId 携带新载荷
  const ok = await adapter.analyze(makeRequest({ requestId: 'req-0002', generation: 6, contextVersion: 'ctx-6' }), {});
  assert.equal(ok.status, 'succeeded');
  assert.equal(calls.length, 1);
});

test('暂停拒绝与送出前取消在 stale 判定之前:失败结果不受暂停影响(错误更具体)', async () => {
  // 校验失败发生在送出前:即使之后暂停,failed 保持 failed(错误信息更具体,不掩盖)
  const adapter = createModelAdapter({
    transport: async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EMPTY_OUTPUT');
});
