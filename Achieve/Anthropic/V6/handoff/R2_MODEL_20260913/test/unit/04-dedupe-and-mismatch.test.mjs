// 重复请求(同ID同载荷去重,in-flight 共享)/ 同ID变载荷冲突
// 范围声明:这里是实例内存内去重;持久化幂等与跨进程恰好一次由业务层负责。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { RequestRegistry, canonicalJson, payloadHash, cloneResult } from '../../src/dedupe.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, deferred } from '../helpers.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));

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

test('送出后失败(TRANSPORT_ERROR)不缓存:人工核实后同ID同载荷重试可成功(审计裁决的新语义)', async () => {
  let mode = 'error';
  const { transport, calls } = recordingTransport(async () => {
    if (mode === 'error') return { ok: false, error: { code: 'PROVIDER_ERROR', message: '外部模型服务返回错误' } };
    return { ok: true, output: goodOutput(makeEvidence(1)), usage: { totalTokens: 5 } };
  });
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r1 = await adapter.analyze(makeRequest(), {});
  assert.equal(r1.status, 'failed');
  assert.equal(r1.error.code, 'TRANSPORT_ERROR');

  mode = 'ok'; // 业务层人工核实后决定重试:送出后失败不得被缓存挡路
  const r2 = await adapter.analyze(makeRequest(), {});
  assert.equal(r2.status, 'succeeded');
  assert.equal(r2.deduped, false, '送出后失败属非确定性,不缓存');
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

// —— R2 追加:registry 直测与导出稳定性(语义只增强、不回退)——

test('registry 直测:lookup 返回枚举形状齐备;uncached 同ID同载荷仍 register 且复用既有条目', async () => {
  const reg = new RequestRegistry({ maxEntries: 4 });
  const h1 = payloadHash({ op: 'demo' });
  const hOther = payloadHash({ op: 'demo-变体' });

  // register:新 ID
  assert.deepEqual(reg.lookup('r1', h1), { kind: 'register', payloadHash: h1 });

  // in-flight:同ID同载荷并发,共享同一 promise
  const d1 = deferred();
  assert.equal(reg.track('r1', h1, d1.promise).kind, 'registered');
  const inf = reg.lookup('r1', h1);
  assert.equal(inf.kind, 'in-flight');
  assert.equal(inf.promise, d1.promise, '必须共享同一在飞 promise');
  assert.equal(inf.payloadHash, h1);

  // mismatch:同ID不同载荷(在途期间同样拒绝)
  assert.deepEqual(reg.lookup('r1', hOther), { kind: 'mismatch', registeredHash: h1, payloadHash: hOther });

  // capacity:容量 1 已满且唯一条目在途 → 新 ID 明确背压
  const tiny = new RequestRegistry({ maxEntries: 1 });
  const tinyD = deferred();
  tiny.track('t1', h1, tinyD.promise);
  assert.deepEqual(tiny.lookup('t2', hOther), { kind: 'capacity', payloadHash: hOther });
  assert.equal(tiny.map.size, 1, '背压不得新增条目');
  tinyD.resolve({ status: 'unknown' });

  // uncached:settle 为 unknown → 同ID同载荷仍 register,复用既有条目(不新增、seq 保留)
  d1.resolve({ status: 'unknown' });
  await flush();
  const before = reg.map.get('r1');
  const seqBefore = before.seq;
  assert.equal(reg.lookup('r1', h1).kind, 'register', 'unknown 不缓存:重试是新的完整调用');
  const d2 = deferred();
  assert.equal(reg.track('r1', h1, d2.promise).kind, 'registered');
  assert.ok(reg.map.get('r1') === before, 'uncached 重试必须复用既有条目,不新增');
  assert.equal(reg.map.size, 1);
  assert.equal(before.seq, seqBefore, '复用条目保留原 seq(年龄不重置)');

  // cache-hit:settle 为确定性成功 → 命中缓存
  d2.resolve({ status: 'succeeded', marker: 'ok' });
  await flush();
  const ch = reg.lookup('r1', h1);
  assert.equal(ch.kind, 'cache-hit');
  assert.equal(ch.result.marker, 'ok');
  assert.equal(ch.payloadHash, h1);
});

test('canonicalJson/payloadHash:undefined 输入稳定不崩,哈希永不抛(含嵌套 undefined/函数/symbol)', () => {
  assert.equal(canonicalJson(undefined), 'undefined');
  const h = payloadHash(undefined);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(payloadHash(undefined), payloadHash(undefined), '同输入必须同哈希');

  // 嵌套不稳定值:降级为稳定占位,不抛、确定、键序无关
  const weird1 = { a: undefined, b: () => 1, c: Symbol('s'), d: [undefined, 1] };
  const weird2 = { c: Symbol('t'), b: () => 2, a: undefined, d: [undefined, 1] };
  assert.equal(canonicalJson(weird1), canonicalJson(weird2));
  assert.equal(payloadHash(weird1), payloadHash(weird2));

  // undefined 与字面缺失语义可区分;字符串 "undefined" 与占位不冲突
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: undefined }));
  assert.notEqual(canonicalJson(undefined), canonicalJson('undefined'));

  // 常规值序列化逐字节不变(validate-request.mjs 依赖该行为)
  assert.equal(canonicalJson({ b: 1, a: [2, { c: 'x' }] }), '{"a":[2,{"c":"x"}],"b":1}');
  assert.equal(canonicalJson(null), 'null');
});

test('cloneResult:深拷贝副本,导出保持不变', () => {
  const src = { status: 'succeeded', findings: [{ id: 'F1', refs: [1] }] };
  const cp = cloneResult(src);
  assert.deepEqual(cp, src);
  assert.notEqual(cp, src);
  assert.notEqual(cp.findings, src.findings);
  cp.findings[0].refs.push(2);
  assert.equal(src.findings[0].refs.length, 1, '改副本不得污染原结果');
});
