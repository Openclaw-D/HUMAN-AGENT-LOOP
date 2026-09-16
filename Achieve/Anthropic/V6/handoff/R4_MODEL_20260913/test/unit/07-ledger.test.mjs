// 成本账本:预算不足、并发预留、usage 缺失保留(不记0/不释放)、非法迁移
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport } from '../helpers.mjs';

test('预算不足:预留失败 → failed/BUDGET_EXCEEDED,零调用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput([]) }));
  const ledger = createMemoryLedger({ maxReservedTokens: 500 });
  const adapter = createModelAdapter({ transport, ledger, estimateTokens: 600, timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'BUDGET_EXCEEDED');
  assert.equal(calls.length, 0);
  assert.equal(r.costLedger.reservationState, 'none');
});

test('并发预留受预算约束:10k 预算下三个 4k 并发请求,只有两个能送出', async () => {
  const ev = makeEvidence(1);
  let calls = 0;
  const ledger = createMemoryLedger({ maxReservedTokens: 10000 });
  const adapter = createModelAdapter({
    transport: async () => { calls += 1; return { ok: true, output: goodOutput(ev), usage: { totalTokens: 4000 } }; },
    ledger,
    estimateTokens: 4000,
    timeoutMs: 5000,
  });
  const results = await Promise.all([
    adapter.analyze(makeRequest({ requestId: 'r1' }, { evidence: ev }), {}),
    adapter.analyze(makeRequest({ requestId: 'r2' }, { evidence: ev }), {}),
    adapter.analyze(makeRequest({ requestId: 'r3' }, { evidence: ev }), {}),
  ]);
  assert.equal(calls, 2, '预算只够两个请求');
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, ['failed', 'succeeded', 'succeeded']);
  const rejected = results.find((r) => r.status === 'failed');
  assert.equal(rejected.error.code, 'BUDGET_EXCEEDED');
});

test('usage 缺失:succeeded 但预留转 unknown_hold——不记 0、不释放、标 usageUnknown', async () => {
  const ev = makeEvidence(1);
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport: async () => ({ ok: true, output: goodOutput(ev) }), ledger, timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'succeeded');
  assert.equal(r.usage, null);
  assert.equal(r.usageUnknown, true);
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
  const t = ledger.totals();
  assert.equal(t.unknownHoldTokens > 0, true);
  assert.equal(t.committedTokens, 0);
});

test('usage 缺失不得释放所有预留:后续请求被占用额度约束(unknown_hold 占预算)', async () => {
  const ev = makeEvidence(1);
  const ledger = createMemoryLedger({ maxReservedTokens: 1000 });
  let calls = 0;
  const adapter = createModelAdapter({
    transport: async () => { calls += 1; return { ok: true, output: goodOutput(ev) }; },
    ledger,
    estimateTokens: 1000,
    timeoutMs: 5000,
  });
  const r1 = await adapter.analyze(makeRequest({ requestId: 'r1' }, { evidence: ev }), {});
  assert.equal(r1.status, 'succeeded');
  assert.equal(r1.costLedger.reservationState, 'unknown_hold');
  assert.equal(ledger.totals().unknownHoldTokens, 1000, '预留保留为 unknown_hold');

  const r2 = await adapter.analyze(makeRequest({ requestId: 'r2' }, { evidence: ev }), {});
  assert.equal(r2.error.code, 'BUDGET_EXCEEDED', 'unknown_hold 占用预算:后续请求不得再送出');
  assert.equal(calls, 1);
});

test('prompt+completion 之和可作计费依据;仅部分字段不可折算', async () => {
  const ev = makeEvidence(1);
  const ledger = createMemoryLedger({});
  let usage = { promptTokens: 10, completionTokens: 5 };
  const adapter = createModelAdapter({
    transport: async () => ({ ok: true, output: goodOutput(ev), usage }),
    ledger,
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest({ requestId: 'r-a' }), {});
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(ledger.totals().committedTokens, 15);

  const adapter2 = createModelAdapter({
    transport: async () => ({ ok: true, output: goodOutput(ev), usage: { promptTokens: 10 } }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r2 = await adapter2.analyze(makeRequest({ requestId: 'r-b' }), {});
  assert.equal(r2.costLedger.reservationState, 'unknown_hold', '只有 promptTokens 无法折算:保留预留');
});

test('账本非法迁移:committed/unknown_hold 不得 release;未知不得当未发生', async () => {
  const ledger = createMemoryLedger({});
  const res = ledger.reserve({ requestId: 'x', role: 'credit', purpose: 'risk_review', estimateTokens: 100 });
  assert.equal(res.ok, true);
  assert.equal(ledger.commit({ reservationId: res.reservationId, usageTokens: 40 }).ok, true);
  const releaseCommitted = ledger.release({ reservationId: res.reservationId, note: '试图反悔' });
  assert.equal(releaseCommitted.ok, false);
  assert.equal(releaseCommitted.code, 'INVALID_TRANSITION');

  const res2 = ledger.reserve({ requestId: 'y', role: 'credit', purpose: 'risk_review', estimateTokens: 100 });
  ledger.holdUnknown({ reservationId: res2.reservationId });
  const releaseHold = ledger.release({ reservationId: res2.reservationId, note: '试图把未知当未发生' });
  assert.equal(releaseHold.ok, false, 'unknown_hold 不得释放:缺 usage 不能记 0 或释放');
  // 对账补录后可以 commit
  assert.equal(ledger.commit({ reservationId: res2.reservationId, usageTokens: 88, note: '对账补录' }).ok, true);
});

test('released 释放预算:确定未发生的调用不占预算', async () => {
  const ledger = createMemoryLedger({ maxReservedTokens: 1000 });
  const res = ledger.reserve({ requestId: 'x', role: 'credit', purpose: 'risk_review', estimateTokens: 1000 });
  ledger.release({ reservationId: res.reservationId, note: 'transport 未发送' });
  assert.equal(ledger.totals().occupiedTokens, 0);
  const res2 = ledger.reserve({ requestId: 'y', role: 'credit', purpose: 'risk_review', estimateTokens: 1000 });
  assert.equal(res2.ok, true, '释放后预算可用');
});

test('预算不足时账本记录 rejected 条目(可审计)', async () => {
  const ledger = createMemoryLedger({ maxReservedTokens: 100 });
  const res = ledger.reserve({ requestId: 'x', role: 'credit', purpose: 'risk_review', estimateTokens: 500 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'BUDGET_EXCEEDED');
  assert.equal(ledger.totals().rejectedCount, 1);
  assert.equal(ledger.totals().occupiedTokens, 0);
});
