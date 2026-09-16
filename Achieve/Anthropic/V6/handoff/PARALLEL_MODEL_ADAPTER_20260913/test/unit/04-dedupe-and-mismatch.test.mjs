// 重复请求(同ID同载荷去重,in-flight 共享)/ 同ID变载荷冲突
// 范围声明:这里是实例内存内去重;持久化幂等与跨进程恰好一次由业务层负责。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, deferred } from '../helpers.mjs';

test('重复请求:同ID同载荷第二次调用命中缓存,transport 只调用一次,结果标 deduped', async () => {
  const ev = makeEvidence(2);
  const { transport, calls } = recordingTransport(async () => ({
    ok: true, output: goodOutput(ev), usage: { totalTokens: 20 },
  }));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });

  const r1 = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  const r2 = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(calls.length, 1, '相同载荷不得重复发起外部调用');
  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(r2.status, r1.status);
  assert.equal(r2.requestId, r1.requestId);
  // 缓存返回必须是副本:篡改返回值不影响后续缓存
  r2.findings.push({ id: 'X', text: 'x', evidenceRefs: [] });
  const r3 = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r3.findings.length, 1);
});

test('并发去重:第二个同ID同载荷调用共享在飞 promise,transport 只调用一次', async () => {
  const ev = makeEvidence(1);
  const d = deferred();
  const { transport, calls } = recordingTransport(async () => d.promise);
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });

  const p1 = adapter.analyze(makeRequest({}, { evidence: ev }), {});
  const p2 = adapter.analyze(makeRequest({}, { evidence: ev }), {});
  d.resolve({ ok: true, output: goodOutput(ev), usage: { totalTokens: 11 } });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 1);
  assert.equal(r1.status, 'succeeded');
  assert.equal(r2.deduped, true);
  assert.equal(r2.status, 'succeeded');
});

test('确定性失败同样缓存:空输出 failed 后同载荷重放不重复调用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r1 = await adapter.analyze(makeRequest(), {});
  const r2 = await adapter.analyze(makeRequest(), {});
  assert.equal(r1.status, 'failed');
  assert.equal(r2.status, 'failed');
  assert.equal(r2.deduped, true);
  assert.equal(calls.length, 1);
});

test('非确定性结果不缓存:unknown 后业务层人工重试同ID同载荷会完整重跑(仍一次/次)', async () => {
  let mode = 'indeterminate';
  const { transport, calls } = recordingTransport(async () => {
    if (mode === 'indeterminate') return { ok: 'indeterminate' };
    return { ok: true, output: goodOutput(makeEvidence(1)), usage: { totalTokens: 9 } };
  });
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r1 = await adapter.analyze(makeRequest(), {});
  assert.equal(r1.status, 'unknown');
  assert.equal(r1.usageUnknown, true);
  assert.equal(adapter.registrySnapshot().length, 1, 'requestId 的载荷指纹仍保留,变载荷保护持续有效');

  mode = 'ok'; // 业务层人工核实后决定重试
  const r2 = await adapter.analyze(makeRequest(), {});
  assert.equal(r2.status, 'succeeded');
  assert.equal(r2.deduped, false, 'unknown 不缓存:重试是新的完整调用');
  assert.equal(calls.length, 2);
});

test('同ID变载荷:改 text → REQUEST_MISMATCH,不调用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  await adapter.analyze(makeRequest(), {});
  const r = await adapter.analyze(makeRequest({ text: '【合成】被篡改过的载荷文本' }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'REQUEST_MISMATCH');
  assert.ok(r.error.message.includes('requestId'));
  assert.equal(calls.length, 1);
});

test('同ID变载荷:改 evidenceRefs(hash 不同)→ REQUEST_MISMATCH', async () => {
  const adapter = createModelAdapter({ transport: async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  await adapter.analyze(makeRequest(), {});
  const tampered = makeRequest({ evidenceRefs: [{ id: 'EV-001', version: 'v1', hash: 'tampered-hash' }] });
  const r = await adapter.analyze(tampered, {});
  assert.equal(r.error.code, 'REQUEST_MISMATCH');
});

test('同ID变载荷:改 generation → REQUEST_MISMATCH(旧回执不得清新代次)', async () => {
  const adapter = createModelAdapter({ transport: async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  await adapter.analyze(makeRequest({ generation: 1 }), {});
  const r = await adapter.analyze(makeRequest({ generation: 2 }), {});
  assert.equal(r.error.code, 'REQUEST_MISMATCH');
});

test('不同 requestId 携带相同载荷:不去重(请求身份由 requestId 决定)', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: goodOutput(makeEvidence(1)) }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  await adapter.analyze(makeRequest(), {});
  const r2 = await adapter.analyze(makeRequest({ requestId: 'req-0002' }), {});
  assert.equal(r2.deduped, false);
  assert.equal(calls.length, 2);
});
