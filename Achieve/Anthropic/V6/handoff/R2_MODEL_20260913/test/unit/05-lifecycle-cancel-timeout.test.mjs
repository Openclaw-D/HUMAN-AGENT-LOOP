// 生命周期:超时前取消、transport 证明未发送、送出后取消→unknown、
// 注入时钟超时→unknown、indeterminate、异常、未知状态禁止自动重试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { createManualClock } from '../../src/clock.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, deferred } from '../helpers.mjs';

test('送出前已取消:signal 预先 aborted → cancelled,零调用、零占用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput([]) }));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
  const controller = new AbortController();
  controller.abort();
  const r = await adapter.analyze(makeRequest(), { signal: controller.signal });
  assert.equal(r.status, 'cancelled');
  assert.equal(r.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(calls.length, 0, '已取消的请求不得送出');
  assert.equal(ledger.totals().occupiedTokens, 0);
});

test('transport 证明未发送(sent:false)→ cancelled,预留释放', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({
    transport: async () => ({ ok: false, sent: false, error: { code: 'LOCAL_DENY', message: 'transport 在发送前拒绝(如配置缺失)' } }),
    ledger,
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'cancelled');
  assert.equal(r.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(r.costLedger.reservationState, 'released');
  assert.equal(ledger.totals().occupiedTokens, 0);
});

test('请求送出后取消:transport 未声明未发送 → unknown(不得标 cancelled),预留保留', async () => {
  const d = deferred();
  const { transport, calls } = recordingTransport(async () => d.promise);
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 30000 });
  const controller = new AbortController();
  const p = adapter.analyze(makeRequest(), { signal: controller.signal });
  await Promise.resolve(); // 确保 transport 已被调用
  controller.abort();
  const r = await p;
  assert.equal(r.status, 'unknown');
  assert.equal(r.error.code, 'ABORTED_AFTER_SEND');
  assert.ok(r.error.message.includes('人工'), 'unknown 提示必须引导人工核实');
  assert.equal(r.usageUnknown, true);
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
  assert.equal(ledger.totals().unknownHoldTokens > 0, true);
  assert.equal(calls.length, 1);
});

test('注入时钟超时:clock.advance 越过 deadline → unknown/TIMEOUT,迟到结果不被采信', async () => {
  const clock = createManualClock(1000);
  const d = deferred();
  const ledger = createMemoryLedger({});
  const { transport, calls } = recordingTransport(async () => d.promise);
  const adapter = createModelAdapter({ transport, ledger, clock, timeoutMs: 1500 });

  const p = adapter.analyze(makeRequest(), {});
  clock.advance(1500); // 触发超时
  const r = await p;
  assert.equal(r.status, 'unknown');
  assert.equal(r.error.code, 'TIMEOUT');
  assert.equal(r.usageUnknown, true);
  assert.equal(ledger.totals().unknownHoldTokens > 0, true);
  assert.equal(clock.pendingCount(), 0, '超时后不得残留计时器');

  // 迟到的外部结果不被采信:即使随后 resolve,也不产生第二个结果
  d.resolve({ ok: true, output: goodOutput(makeEvidence(2)) });
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 1);
});

test('超时前完成:正常 succeeded(计时器被清理,不误伤)', async () => {
  const clock = createManualClock(0);
  const d = deferred();
  const adapter = createModelAdapter({
    transport: async () => d.promise,
    ledger: createMemoryLedger({}),
    clock,
    timeoutMs: 1000,
  });
  const p = adapter.analyze(makeRequest(), {});
  d.resolve({ ok: true, output: goodOutput(makeEvidence(1)), usage: { totalTokens: 7 } });
  const r = await p;
  assert.equal(r.status, 'succeeded');
  clock.advance(5000);
  assert.equal(r.status, 'succeeded', '完成后时钟推进不得改变结果');
});

test('transport 报 indeterminate → unknown/TRANSPORT_INDETERMINATE', async () => {
  const adapter = createModelAdapter({
    transport: async () => ({ ok: 'indeterminate' }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'unknown');
  assert.equal(r.error.code, 'TRANSPORT_INDETERMINATE');
});

test('transport 抛异常:默认视为可能已送出 → failed/TRANSPORT_THROWN + 预留保留', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({
    transport: async () => { throw new Error('ECONNRESET(合成测试)'); },
    ledger,
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'TRANSPORT_THROWN');
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
});

test('transport 异常但声明 notSent → cancelled(确定未发生)', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({
    transport: async () => {
      const err = new Error('配置缺失:未注入 fetchImpl');
      err.notSent = true;
      throw err;
    },
    ledger,
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'cancelled');
  assert.equal(r.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(r.costLedger.reservationState, 'released');
});

test('transport 报错(已应答)→ failed/TRANSPORT_ERROR;错误体带 usage 时按报告结算', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({
    transport: async () => ({ ok: false, error: { code: 'PROVIDER_ERROR', message: '外部模型服务返回错误' }, usage: { totalTokens: 21 } }),
    ledger,
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'TRANSPORT_ERROR');
  assert.ok(r.error.message.includes('外部模型服务'));
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(ledger.totals().committedTokens, 21);
});

test('未知状态禁止自动无限重试:indeterminate 连续多次调用,transport 每次恰好一次', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: 'indeterminate' }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  for (let i = 0; i < 5; i += 1) {
    const r = await adapter.analyze(makeRequest({ requestId: `req-unknown-${i}` }), {});
    assert.equal(r.status, 'unknown');
  }
  assert.equal(calls.length, 5, '每次调用恰好一次外部调用,不得内部自动重试放大');
});
