// 缓存有效性(R2 修复 Codex 点名"已完成缓存返回不复核当前上下文"):生命周期交错矩阵。
// 覆盖:缓存命中/在飞 join 返回前快照复核、暂停/恢复交错、unknown 不缓存、容量背压、
// 项目隔离、gate 人控边界(仅预处理)、迟到结果回归、冻结与副本隔离。
// 断言纪律:不仅断言结果字符串,同时断言 transport 调用计数与 ledger.totals() 成本占用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, deferred } from '../helpers.mjs';

const okResp = (ev, tokens = 20) => ({ ok: true, output: goodOutput(ev), usage: { totalTokens: tokens } });

// a) 成功 → generation 推进 → 同ID同载荷再调用:stale/GENERATION_CHANGED,旧结果绝不 succeeded
test('a) 缓存命中复核:generation 推进后同ID同载荷 → stale/GENERATION_CHANGED + deduped,数据保留,transport 不重调', async () => {
  const ev = makeEvidence(2);
  let snap = { generation: 1, contextVersion: 'ctx-1', paused: false };
  const { transport, calls } = recordingTransport(async () => okResp(ev));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
  const ctx = { snapshot: () => ({ ...snap }) };

  const r1 = await adapter.analyze(makeRequest({}, { evidence: ev }), ctx);
  assert.equal(r1.status, 'succeeded');
  assert.equal(r1.deduped, false);

  snap = { ...snap, generation: 2 }; // 会话已推进到新代次
  const totalsAfterFirst = ledger.totals();
  const r2 = await adapter.analyze(makeRequest({}, { evidence: ev }), ctx);

  assert.equal(r2.status, 'stale', '旧缓存不得以 succeeded 呈现');
  assert.notEqual(r2.status, 'succeeded');
  assert.equal(r2.error.code, 'GENERATION_CHANGED');
  assert.equal(r2.deduped, true);
  assert.equal(r2.findings.length, 1, 'findings 保留供人工核对');
  assert.equal(r2.evidenceRefs.length, 2, 'evidenceRefs 保留供人工核对');
  assert.equal(calls.length, 1, '缓存命中不得重新调用 transport');
  assert.deepEqual(ledger.totals(), totalsAfterFirst, '缓存命中不得新增任何成本占用');
});

// b) 成功 → contextVersion 变化(证据修订)→ 同ID同载荷再调用:stale/CONTEXT_VERSION_CHANGED
test('b) 缓存命中复核:contextVersion 变化(证据修订)后 → stale/CONTEXT_VERSION_CHANGED', async () => {
  const ev = makeEvidence(1);
  let snap = { generation: 1, contextVersion: 'ctx-1', paused: false };
  const { transport, calls } = recordingTransport(async () => okResp(ev));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
  const ctx = { snapshot: () => ({ ...snap }) };
  const req = makeRequest({}, { evidence: ev });

  const r1 = await adapter.analyze(req, ctx);
  assert.equal(r1.status, 'succeeded');
  const totalsAfterFirst = ledger.totals();

  snap = { ...snap, contextVersion: 'ctx-2' }; // 新证据入库,证据集修订
  const r2 = await adapter.analyze(req, ctx);
  assert.equal(r2.status, 'stale');
  assert.equal(r2.error.code, 'CONTEXT_VERSION_CHANGED');
  assert.equal(r2.deduped, true);
  assert.ok(r2.findings.length >= 1, '数据保留供人工核对');
  assert.equal(calls.length, 1);
  assert.deepEqual(ledger.totals(), totalsAfterFirst);
});

// c) 成功 → pauseSession → 同ID再调用:stale/SESSION_PAUSED
test('c) 缓存命中复核:暂停后同ID再调用 → stale/SESSION_PAUSED(缓存不得越过暂停)', async () => {
  const ev = makeEvidence(1);
  const { transport, calls } = recordingTransport(async () => okResp(ev));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const req = makeRequest({}, { evidence: ev });

  const r1 = await adapter.analyze(req, {});
  assert.equal(r1.status, 'succeeded');

  adapter.pauseSession('sess-demo-1', '风控要求暂停,待实控人现场复核');
  const r2 = await adapter.analyze(req, {});
  assert.equal(r2.status, 'stale', '已暂停会话的缓存结果不得当现行');
  assert.equal(r2.error.code, 'SESSION_PAUSED');
  assert.equal(r2.deduped, true);
  assert.equal(calls.length, 1);
});

// d) 成功 → 快照未变 → 再次调用:succeeded + deduped:true(缓存有效路径不误伤)
test('d) 快照未变化:再次调用保持 succeeded + deduped:true,transport 计数与账本均不变', async () => {
  const ev = makeEvidence(1);
  let snap = { generation: 1, contextVersion: 'ctx-1', paused: false };
  const { transport, calls } = recordingTransport(async () => okResp(ev, 21));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
  const ctx = { snapshot: () => ({ ...snap }) };
  const req = makeRequest({}, { evidence: ev });

  const r1 = await adapter.analyze(req, ctx);
  assert.equal(r1.status, 'succeeded');
  const totalsAfterFirst = ledger.totals();

  const r2 = await adapter.analyze(req, ctx); // 快照未动
  assert.equal(r2.status, 'succeeded', '缓存有效路径不得误伤为 stale');
  assert.equal(r2.deduped, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(ledger.totals(), totalsAfterFirst);
});

// e) 暂停 → 恢复(推进代次)→ 旧响应:迟到结果 stale;此后同ID旧载荷仍 stale
test('e) 暂停→恢复推进代次→旧响应:首次返回即 stale;旧载荷缓存再调用仍 stale,绝不翻回 succeeded', async () => {
  const ev = makeEvidence(1);
  const d = deferred();
  const { transport, calls } = recordingTransport(async () => d.promise);
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 30000 });

  const p1 = adapter.analyze(makeRequest({ generation: 1 }, { evidence: ev }), {});
  adapter.pauseSession('sess-demo-1', '现场复核'); // 在飞期间:暂停后由人工显式恢复并推进代次
  adapter.resumeSession('sess-demo-1', { generation: 2, contextVersion: 'ctx-2' });
  d.resolve(okResp(ev));

  const r1 = await p1;
  assert.equal(r1.status, 'stale', '迟到结果面对已推进的代次必须 stale');
  assert.equal(r1.error.code, 'GENERATION_CHANGED');
  assert.equal(r1.deduped, false);
  assert.equal(r1.costLedger.reservationState, 'committed', '迟到结果同样照实结算');

  const r2 = await adapter.analyze(makeRequest({ generation: 1 }, { evidence: ev }), {});
  assert.equal(r2.status, 'stale', '旧载荷的缓存结果也不得翻转为 succeeded');
  assert.equal(r2.error.code, 'GENERATION_CHANGED');
  assert.equal(r2.deduped, true);
  assert.equal(calls.length, 1, '复核不得引发重新调用');
});

// f) unknown 后快照推进 → 同ID同载荷重试:完整新调用(unknown 不缓存),调用计数 +1
test('f) unknown 不缓存:快照推进后重试产生完整新调用(计数 +1),且新结果按当前快照判定不得当现行', async () => {
  const ev = makeEvidence(1);
  let mode = 'indeterminate';
  const { transport, calls } = recordingTransport(async () => {
    if (mode === 'indeterminate') return { ok: 'indeterminate' };
    return okResp(ev);
  });
  let snap = { generation: 1, contextVersion: 'ctx-1', paused: false };
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const ctx = { snapshot: () => ({ ...snap }) };
  const req = makeRequest({}, { evidence: ev });

  const r1 = await adapter.analyze(req, ctx);
  assert.equal(r1.status, 'unknown');

  snap = { ...snap, generation: 2 };
  mode = 'ok'; // 业务层人工核实后决定重试
  const r2 = await adapter.analyze(req, ctx);
  assert.equal(calls.length, 2, 'unknown 不缓存:重试必须是完整新调用');
  assert.equal(r2.deduped, false);
  assert.equal(r2.status, 'stale', '重跑载荷仍是旧 generation:按当前快照必须 stale,不得当现行');
  assert.equal(r2.error.code, 'GENERATION_CHANGED');
});

// g) maxEntries=2:两个永久在飞 + 第三个新请求 → failed/REGISTRY_AT_CAPACITY;一个在飞完成(cached)后第四个成功
test('g) 容量背压:登记满且全在途 → failed/REGISTRY_AT_CAPACITY,不调 transport、不预留;在飞完成后新请求成功', async () => {
  const ev = makeEvidence(1);
  const dA = deferred();
  const dB = deferred();
  // 按请求身份挂起:A、B 永久在飞由测试显式放行;其余请求(如第四个)立即成功。
  const pending = new Map([['req-cap-A', dA.promise], ['req-cap-B', dB.promise]]);
  const { transport, calls } = recordingTransport(async (call) => pending.get(call.requestId) ?? okResp(ev, 12));
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 30000, maxEntries: 2 });

  const pA = adapter.analyze(makeRequest({ requestId: 'req-cap-A' }, { evidence: ev }), {});
  const pB = adapter.analyze(makeRequest({ requestId: 'req-cap-B' }, { evidence: ev }), {});
  await Promise.resolve(); // 让两个在飞登记完成
  assert.equal(calls.length, 2);

  const totalsBefore = ledger.totals();
  const rC = await adapter.analyze(makeRequest({ requestId: 'req-cap-C' }, { evidence: ev }), {});
  assert.equal(rC.status, 'failed');
  assert.equal(rC.error.code, 'REGISTRY_AT_CAPACITY');
  assert.ok(rC.error.message.includes('maxEntries'), '中文消息须说明可提高 maxEntries');
  assert.equal(rC.error.details.maxEntries, 2);
  assert.equal(rC.costLedger.reservationState, 'none', '背压不得预留预算');
  assert.equal(calls.length, 2, '背压不得调用 transport');
  assert.deepEqual(ledger.totals(), totalsBefore, '背压不得改变任何账本占用');

  // 一个在飞完成(确定性成功 → cached):出现可安全淘汰条目
  dA.resolve(okResp(ev, 10));
  const rA = await pA;
  assert.equal(rA.status, 'succeeded');

  const rD = await adapter.analyze(makeRequest({ requestId: 'req-cap-D' }, { evidence: ev }), {});
  assert.equal(rD.status, 'succeeded', 'cached 条目可被安全淘汰:第四个请求成功');
  assert.equal(calls.length, 3);

  // 在途 B 全程未受容量操作影响(在途零淘汰)
  dB.resolve(okResp(ev, 11));
  const rB = await pB;
  assert.equal(rB.status, 'succeeded');
  assert.equal(calls.length, 3, '在途去重不被容量操作破坏');
});

// h) 不同项目相同文本 → 隔离:各自独立调用;同 requestId 跨项目 → REQUEST_MISMATCH
test('h) 项目隔离:相同文本不同项目各自独立调用;同 requestId 携带不同 projectId → REQUEST_MISMATCH(载荷含 projectId)', async () => {
  const ev = makeEvidence(1);
  const { transport, calls } = recordingTransport(async () => okResp(ev));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });

  const rA = await adapter.analyze(makeRequest({ requestId: 'req-pa', projectId: 'proj-A' }, { evidence: ev }), {});
  const rB = await adapter.analyze(makeRequest({ requestId: 'req-pb', projectId: 'proj-B' }, { evidence: ev }), {});
  assert.equal(calls.length, 2, '相同文本、不同项目必须各自独立调用,绝不跨项目去重');
  assert.equal(rA.status, 'succeeded');
  assert.equal(rB.status, 'succeeded');
  assert.equal(rA.projectId, 'proj-A');
  assert.equal(rB.projectId, 'proj-B');

  const rM = await adapter.analyze(makeRequest({ requestId: 'req-pa', projectId: 'proj-B' }, { evidence: ev }), {});
  assert.equal(rM.status, 'failed');
  assert.equal(rM.error.code, 'REQUEST_MISMATCH', '载荷指纹含 projectId:跨项目复用同ID失败关闭');
  assert.equal(calls.length, 2, 'mismatch 不得触发外部调用');

  const rA2 = await adapter.analyze(makeRequest({ requestId: 'req-pa', projectId: 'proj-A' }, { evidence: ev }), {});
  assert.equal(rA2.status, 'succeeded', '跨项目冲突不得污染原项目缓存');
  assert.equal(rA2.deduped, true);
  assert.equal(calls.length, 2);
});

// i) 专业前序未通过 → 仅预处理:gate=false 成功结果带 scope/scopeNotice;缺省或 true 无 scope
test('i) gate 人控边界:gate=false 成功仍 succeeded 但带 scope=preprocessing_only 与中文 scopeNotice;缺省/true 无 scope', async () => {
  const ev = makeEvidence(1);
  const { transport, calls } = recordingTransport(async () => okResp(ev, 33));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });

  const denied = await adapter.analyze(
    makeRequest({ requestId: 'req-gate-1' }, { evidence: ev }),
    { gate: { professionalReviewPassed: false } },
  );
  assert.equal(denied.status, 'succeeded', 'gate 不改变七状态语义:仍 succeeded,由 scope 区分通道');
  assert.equal(denied.scope, 'preprocessing_only');
  assert.equal(typeof denied.scopeNotice, 'string');
  assert.ok(denied.scopeNotice.includes('专业前序复核未通过'));
  assert.ok(denied.scopeNotice.includes('预处理'));
  assert.ok(denied.scopeNotice.includes('不得作为正式判定依据'));
  assert.equal(calls[0].payload.instructions.preprocessingOnly, true, '提示词层面声明仅预处理');

  const byDefault = await adapter.analyze(makeRequest({ requestId: 'req-gate-2' }, { evidence: ev }), {});
  assert.equal(byDefault.status, 'succeeded');
  assert.equal(byDefault.scope, null, 'gate 缺省:scope 为 null');
  assert.equal(byDefault.scopeNotice, null);
  assert.equal(calls[1].payload.instructions.preprocessingOnly, undefined, '缺省 payload 不含预处理声明');

  const passed = await adapter.analyze(
    makeRequest({ requestId: 'req-gate-3' }, { evidence: ev }),
    { gate: { professionalReviewPassed: true } },
  );
  assert.equal(passed.status, 'succeeded');
  assert.equal(passed.scope, null, 'gate=true:scope 为 null');
  assert.equal(calls.length, 3);
});

// j) 迟到结果回归:transport resolve 前快照推进 → 首次返回即 stale(防 R1 回归)
test('j) 迟到结果回归:resolve 前快照推进 → 首次返回即 stale/GENERATION_CHANGED(非 deduped),成本照实结算', async () => {
  const ev = makeEvidence(1);
  let snap = { generation: 1, contextVersion: 'ctx-1', paused: false };
  const d = deferred();
  const { transport, calls } = recordingTransport(async () => d.promise);
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 30000 });

  const p = adapter.analyze(makeRequest({}, { evidence: ev }), { snapshot: () => ({ ...snap }) });
  snap = { ...snap, generation: 9 };
  d.resolve(okResp(ev));

  const r = await p;
  assert.equal(r.status, 'stale');
  assert.equal(r.error.code, 'GENERATION_CHANGED');
  assert.equal(r.deduped, false);
  assert.equal(calls.length, 1);
  assert.equal(r.costLedger.reservationState, 'committed');
});

// k) 同一缓存结果两次消费:deepFreeze 保护 + 副本隔离,篡改任一份不影响缓存与其他消费
test('k) 冻结与副本隔离:首次结果 deepFreeze;篡改 deduped 副本不得污染缓存,再次消费数据完好', async () => {
  const ev = makeEvidence(1);
  const { transport, calls } = recordingTransport(async () => okResp(ev));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const req = makeRequest({}, { evidence: ev });

  const r1 = await adapter.analyze(req, {});
  assert.ok(Object.isFrozen(r1), '首次结果必须被冻结');

  const r2 = await adapter.analyze(req, {});
  assert.equal(r2.deduped, true);
  assert.throws(() => { r2.status = 'tampered'; }, TypeError, 'deduped 副本顶层同样冻结,不可改写');
  r2.findings.push({ id: 'F-TAMPER', text: '篡改副本', evidenceRefs: [] }); // findings 是副本数组,可变

  const r3 = await adapter.analyze(req, {});
  assert.equal(r3.status, 'succeeded');
  assert.equal(r3.findings.length, 1, '篡改 deduped 副本不得污染缓存');
  assert.equal(r3.findings[0].id, 'F1');
  assert.equal(r1.findings.length, 1, '首次结果同样不受影响');
  assert.equal(calls.length, 1);
});
