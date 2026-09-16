// R3 任务A · Agent-BRIDGE-FAULT:桥端故障压测 + 定向 mutation(test 17)。
//
// 范围声明(与 01–15 不重复:01–15 无一经过桥;本文件全部用例经 buildAnalyzeRequest
// 构建请求、经 adapter.analyze 端到端执行,或直接面向桥的失败关闭语义):
//   S1 跨会话污染 0:twoSessions 同 op/seq 同文本,LCG 交替并发,证据集/requestId 不相交;
//   S2 容量满:maxEntries=6,8 个桥请求,背压零 transport/零账本占用,在途零淘汰;
//   S3 延迟+取消:送出后 abort → unknown/ABORTED_AFTER_SEND;刷新重放=完整新调用
//      (unknown 不缓存);成功后同载荷重放=缓存命中(deduped),transport 计数不增;
//   S4 版本替换中途:in-flight 翻转可变 storeReader → stale(generation/contextVersion
//      按翻转字段断言)、结果数据保留、usage 照常 committed;新 reader 重建请求不含
//      superseded 的 EV-SYN-001;
//   S5 账本守恒:全部场景共享一个 ledger;occupied = reserved+committed+unknownHold;
//      每笔占用可溯源(known-hold 对应 unknown/失败路径,committed 有 usage 且有已观测
//      结果);release 只出现在确定未送出路径;
//   mutation E1/E2:对 src/bridge/product-bridge.mjs 源码变异(副本写 runtime/bridge-mutants/,
//      相对导入改写到 ../../src,动态 import 自测可解析),断言"正确实现通过、变异实现被抓"。
//
// 固定 seed=20260913(LCG 自实现,数值方法规范常数,与 test/unit/10 同法);零新增依赖;
// 不发网络;除本文件外只写 runtime/bridge-mutants/(可变区,不入冻结)。
// 运行:node --test test/unit/17-bridge-fault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildAnalyzeRequest, bridgeContext } from '../../src/bridge/product-bridge.mjs';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { goodOutput, deferred } from '../helpers.mjs';
import {
  snapshotV7,
  snapshotEvidenceUpgraded,
  snapshotTwoSessions,
  snapshotMissingVersion,
} from '../../fixtures/product-snapshots.mjs';

const SEED = 20260913;
const SESSION_A = 'sess-remote-001';
const SESSION_B = 'sess-remote-002';

/** 固定 seed 的 32 位 LCG(数值方法规范常数):跨平台逐位一致的确定性伪随机。 */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** 有界等待:条件满足即返回;超时则显式失败(不静默挂起)。 */
async function until(cond, label, maxTicks = 5000) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (cond()) return;
    await flush();
  }
  assert.ok(cond(), `等待超时:${label}`);
}

/** 可变 storeReader 闭包:模拟产品 remote-store 的单次一致性读,测试中途原子翻转。 */
function makeReader(initialStore) {
  const state = { current: initialStore, reads: 0 };
  const reader = () => {
    state.reads += 1;
    return state.current;
  };
  reader.set = (next) => {
    state.current = next;
  };
  reader.state = state;
  return reader;
}

/** 建桥:失败即断言失败(带中文原因),返回 ok:true 的桥产物。 */
function buildBridge(storeReader, { sessionId, op, seq, text }) {
  const built = buildAnalyzeRequest({
    storeReader,
    sessionId,
    op,
    seq,
    role: 'credit',
    purpose: 'risk_review',
    text,
  });
  assert.equal(built.ok, true, `建桥必须成功(${sessionId} op=${op} seq=${seq}):${built.message || ''}`);
  return built;
}

/** transport 合法成功响应:输出精确引用本次请求给出的证据(过 validate-provider-output)。 */
const okResult = (request, totalTokens) => ({
  ok: true,
  output: goodOutput(request.evidenceRefs),
  usage: { totalTokens },
});

/**
 * 按 requestId 分闸门的 transport:每个首次见到的 requestId 挂一个 deferred;
 * 测试用 respond() 在恰当时机放行(立即成功/慢调用/永久在飞/未发送证明,全部可控)。
 */
function makeBridgeTransport() {
  const calls = [];
  const gates = new Map();
  const gateOf = (requestId) => {
    if (!gates.has(requestId)) gates.set(requestId, deferred());
    return gates.get(requestId);
  };
  const transport = async (call) => {
    calls.push(call);
    return gateOf(call.requestId).promise;
  };
  return {
    transport,
    calls,
    respond(requestId, value) {
      gateOf(requestId).resolve(value);
    },
  };
}

// ---- 压测统计(场景 × 结果计数表 + 结果溯源,供守恒与分母断言) ----
const STATS = new Map(); // scenario -> { [status]: count, total }
const OUTCOMES = new Map(); // requestId -> [{ scenario, status }](已观测到的结果)
const RESERVATION_OUTCOMES = new Map(); // reservationId -> { scenario, status }(按预留笔逐笔溯源)

function recordResult(scenario, result) {
  const list = OUTCOMES.get(result.requestId) || [];
  list.push({ scenario, status: result.status });
  OUTCOMES.set(result.requestId, list);
  const reservationId = result.costLedger && result.costLedger.reservationId;
  if (reservationId) RESERVATION_OUTCOMES.set(reservationId, { scenario, status: result.status });
  const s = STATS.get(scenario) || { total: 0 };
  s[result.status] = (s[result.status] || 0) + 1;
  s.total += 1;
  STATS.set(scenario, s);
}

// 全部压测场景(1–5)共享一个账本:守恒断言横跨所有场景(S2 的永久在飞保留为 reserved)。
const sharedLedger = createMemoryLedger({ label: '17-shared' });
const PERMANENT_INFLIGHT = []; // S2 中永不 settle 的桥请求 requestId(结束时仍 reserved)

const idsOf = (adapter) => adapter.registrySnapshot().map((e) => e.requestId);
function assertIdsPresent(adapter, ids, checkpoint) {
  const present = new Set(idsOf(adapter));
  for (const id of ids) {
    assert.ok(present.has(id), `检查点[${checkpoint}]:在途条目 ${id} 不得被淘汰或丢失`);
  }
}

// ---------------------------------------------------------------------------
// S1 跨会话污染 0
// ---------------------------------------------------------------------------

test('S1 跨会话污染 0:twoSessions 同 op/seq 同文本,LCG 交替并发各5次,证据集不相交', async () => {
  const reader = makeReader(snapshotTwoSessions());
  const t = makeBridgeTransport();
  const adapter = createModelAdapter({ transport: t.transport, ledger: sharedLedger, timeoutMs: 0 });
  const TEXT = '【合成】跨会话并发压测:两会话同一操作序号与文本,证据与结果必须互不串扰。';
  const sessionIdOf = (s) => (s === 'A' ? SESSION_A : SESSION_B);

  // 先建好全部 10 个桥请求(同 op='analyze',seq=1..5,同 text)
  const builtBy = { A: [], B: [] };
  for (const s of ['A', 'B']) {
    for (let seq = 1; seq <= 5; seq += 1) {
      const built = buildBridge(reader, { sessionId: sessionIdOf(s), op: 'analyze', seq, text: TEXT });
      builtBy[s].push(built);
    }
  }
  // 桥元信息:两会话各自走桥(产品代次偏移与 remoteVersion 独立正确)
  assert.equal(builtBy.A[0].bridgeMeta.productGeneration, 0);
  assert.equal(builtBy.B[0].bridgeMeta.productGeneration, 1);
  assert.equal(builtBy.A[0].bridgeMeta.remoteVersion, 11);
  assert.equal(builtBy.A[0].bridgeMeta.supersededFiltered, 0);

  // LCG 调度:两会话交替发起,请求级并发窗口重叠
  const rand = lcg(SEED);
  const pending = { A: 5, B: 5 };
  const launchOrder = [];
  const expectedReqIds = { A: new Set(), B: new Set() };
  const promises = [];
  while (pending.A + pending.B > 0) {
    const pickB = pending.A === 0 ? true : pending.B === 0 ? false : rand() < 0.5;
    const s = pickB ? 'B' : 'A';
    const idx = 5 - pending[s];
    const built = builtBy[s][idx];
    pending[s] -= 1;
    launchOrder.push(`${s}${idx + 1}`);
    expectedReqIds[s].add(built.request.requestId);
    promises.push(
      adapter.analyze(built.request, bridgeContext(built.snapshot)).then((r) => ({ s, seq: idx + 1, built, r })),
    );
    t.respond(built.request.requestId, okResult(built.request, s === 'A' ? 111 : 222));
    await flush();
  }
  assert.equal(launchOrder.filter((x) => x[0] === 'A').length, 5, 'A 会话恰发起 5 次');
  assert.equal(launchOrder.filter((x) => x[0] === 'B').length, 5, 'B 会话恰发起 5 次');
  const transitions = launchOrder.slice(1).filter((x, i) => x[0] !== launchOrder[i][0]).length;
  assert.ok(transitions >= 2, `LCG(seed=${SEED}) 调度必须产生会话交替,实际切换 ${transitions} 次`);

  const results = await Promise.all(promises);

  // transport 计数:10 次首调,零去重命中(同 op/seq 但 requestId 因 sessionId 不同而独立)
  assert.equal(t.calls.length, 10, '两会话共 10 次首调,transport 不得复用/少调');
  for (const call of t.calls) {
    const owner = call.payload.sessionId === SESSION_A ? 'A' : 'B';
    assert.ok(expectedReqIds[owner].has(call.payload.requestId), 'transport 载荷的 requestId 必须归属其会话');
    assert.equal(call.payload.text, TEXT, '两会话共用同一文本(同文本不构成跨会话复用理由)');
  }
  // requestId 独立:10 个互不相同,且带各自会话前缀(确定性派生含 sessionId)
  const allIds = [...expectedReqIds.A, ...expectedReqIds.B];
  assert.equal(new Set(allIds).size, 10, '10 个 requestId 必须全部独立');
  for (const x of results) {
    assert.ok(x.r.requestId.startsWith(`r${sessionIdOf(x.s)}-g`), `结果 ${x.r.requestId} 必须属于会话 ${x.s}`);
  }
  assert.equal(new Set(results.map((x) => x.r.requestId)).size, 10, '每个结果对应独立 requestId,A 结果绝不顶替 B');

  // 证据集不相交(按 requestId 与 evidenceRefs 双断言):A 的证据绝不进入 B 的结果
  const refsIdsOf = (r) => r.evidenceRefs.map((x) => x.id);
  const idsA = new Set(results.filter((x) => x.s === 'A').flatMap((x) => refsIdsOf(x.r)));
  const idsB = new Set(results.filter((x) => x.s === 'B').flatMap((x) => refsIdsOf(x.r)));
  assert.deepEqual([...idsA].sort(), ['EV-SYN-001', 'EV-SYN-002', 'EV-SYN-003'], 'A 会话证据集');
  assert.deepEqual([...idsB].sort(), ['EV-B-001'], 'B 会话证据集');
  for (const id of idsA) assert.ok(!idsB.has(id), `A 会话证据 ${id} 不得出现在 B 会话结果`);
  for (const id of idsB) assert.ok(!idsA.has(id), `B 会话证据 ${id} 不得出现在 A 会话结果`);
  for (const x of results) {
    assert.equal(x.r.status, 'succeeded', '两会话全部成功(压测分母计 succeeded)');
    assert.deepEqual(x.r.evidenceRefs, x.built.request.evidenceRefs, '结果证据必须与该会话请求证据同源');
    recordResult('S1-跨会话污染', x.r);
  }

  // 账本保留状态:10 笔全部 committed,A/B 按 usage 分账
  const entries = sharedLedger.entries().filter((e) => expectedReqIds.A.has(e.requestId) || expectedReqIds.B.has(e.requestId));
  assert.equal(entries.length, 10, 'S1 在共享账本恰留下 10 笔');
  for (const e of entries) {
    assert.equal(e.state, 'committed', `S1 ${e.requestId} 必须 committed`);
    assert.equal(e.usageTokens, e.requestId.startsWith(`r${SESSION_A}-`) ? 111 : 222, 'usage 按会话独立结算');
  }
});

// ---------------------------------------------------------------------------
// S2 容量满
// ---------------------------------------------------------------------------

test('S2 容量满:maxEntries=6,8 个桥请求,背压零占用零调用,在途零淘汰,释放后重试成功', async () => {
  const reader = makeReader(snapshotV7());
  const t = makeBridgeTransport();
  const adapter = createModelAdapter({ transport: t.transport, ledger: sharedLedger, timeoutMs: 0, maxEntries: 6 });
  const TEXT = '【合成】容量背压压测:同会话 8 个独立 requestId。';
  const builtBySeq = new Map();
  const buildReq = (seq) => {
    const built = buildBridge(reader, { sessionId: SESSION_A, op: 'capacity', seq, text: TEXT });
    builtBySeq.set(seq, built);
    return built;
  };
  const idOf = (seq) => builtBySeq.get(seq).request.requestId;
  const launch = (seq) => adapter.analyze(builtBySeq.get(seq).request, bridgeContext(builtBySeq.get(seq).snapshot));
  const settleOk = (seq) => t.respond(idOf(seq), okResult(builtBySeq.get(seq).request, 200 + seq));

  // 1) 前 6 个并发进registry(部分为永久在飞)
  for (let seq = 1; seq <= 6; seq += 1) buildReq(seq);
  const launched = new Map();
  for (let seq = 1; seq <= 6; seq += 1) launched.set(seq, launch(seq));
  await until(() => t.calls.length === 6, '6 个在途调用全部送出');
  PERMANENT_INFLIGHT.push(idOf(1), idOf(6)); // seq1/seq6 永久在飞:结束时账本必须仍 reserved

  // 2) 第 7、8 个:全部在途、无可安全释放 → failed/REGISTRY_AT_CAPACITY,零调用零占用
  const b7 = buildReq(7);
  const b8 = buildReq(8);
  const r7 = await adapter.analyze(b7.request, bridgeContext(b7.snapshot));
  const r8 = await adapter.analyze(b8.request, bridgeContext(b8.snapshot));
  for (const [r, seq] of [[r7, 7], [r8, 8]]) {
    assert.equal(r.status, 'failed', `请求 ${seq} 必须显式背压失败`);
    assert.equal(r.error.code, 'REGISTRY_AT_CAPACITY', `请求 ${seq} 的错误码必须是 REGISTRY_AT_CAPACITY`);
    recordResult('S2-容量满', r);
  }
  assert.equal(t.calls.length, 6, '背压请求的 transport 计数必须为 0');
  const entriesNow = sharedLedger.entries();
  assert.equal(entriesNow.filter((e) => e.requestId === idOf(7) || e.requestId === idOf(8)).length, 0, '背压请求账本零占用');
  assertIdsPresent(adapter, [1, 2, 3, 4, 5, 6].map(idOf), '背压后全量在途');

  // 3) 释放在飞 → cached;在途 1/3/4/6 必须原样保留
  settleOk(2);
  settleOk(5);
  const res2 = await launched.get(2);
  const res5 = await launched.get(5);
  await flush();
  assert.equal(res2.status, 'succeeded');
  assert.equal(res5.status, 'succeeded');
  recordResult('S2-容量满', res2);
  recordResult('S2-容量满', res5);
  assertIdsPresent(adapter, [idOf(1), idOf(3), idOf(4), idOf(6)], 'settle 后在途保留');
  assert.deepEqual(idsOf(adapter).sort(), [1, 2, 3, 4, 5, 6].map(idOf).sort(), 'settle 不改变registry条目集合');

  // 4) 重试 7、8:淘汰的只能是最老 cached(2 然后 5),在途 1/3/4/6 零淘汰
  settleOk(7);
  const r7b = await launch(7);
  await until(() => t.calls.length === 7, '请求 7 重试产生一次新调用');
  assert.equal(r7b.status, 'succeeded', '释放后重试 7 成功');
  recordResult('S2-容量满', r7b);
  assert.ok(!idsOf(adapter).includes(idOf(2)), '被淘汰的必须是最老 cached 条目(seq2)');
  assertIdsPresent(adapter, [idOf(1), idOf(3), idOf(4), idOf(5), idOf(6)], '重试7后在途零淘汰');

  settleOk(8);
  const r8b = await launch(8);
  await until(() => t.calls.length === 8, '请求 8 重试产生一次新调用');
  assert.equal(r8b.status, 'succeeded', '释放后重试 8 成功');
  recordResult('S2-容量满', r8b);
  assert.ok(!idsOf(adapter).includes(idOf(5)), '第二个被淘汰的必须是 cached 条目(seq5)');
  assertIdsPresent(adapter, [idOf(1), idOf(3), idOf(4), idOf(6)], '重试8后在途零淘汰');

  // 5) 迟到的在飞逐一送达:各自拿到自己的结果(证明在途从未被淘汰/替换/顶替)
  for (const seq of [3, 4]) settleOk(seq);
  const res3 = await launched.get(3);
  const res4 = await launched.get(4);
  assert.equal(res3.requestId, idOf(3), '在飞 3 必须收到自己的结果');
  assert.equal(res4.requestId, idOf(4), '在飞 4 必须收到自己的结果');
  assert.equal(res3.status, 'succeeded');
  assert.equal(res4.status, 'succeeded');
  recordResult('S2-容量满', res3);
  recordResult('S2-容量满', res4);

  // 6) 终局registry行为断言:在册 {1,3,4,6,7,8};被淘汰者恰为 {2,5}(淘汰时均已 cached);
  //    永久在飞 1/6 仍 in-flight(cached:false),从未被容量淘汰
  const finalIds = idsOf(adapter).sort();
  assert.deepEqual(finalIds, [1, 3, 4, 6, 7, 8].map(idOf).sort(), '最终在册集合:淘汰恰为 cached 的 2、5');
  const snapById = new Map(adapter.registrySnapshot().map((e) => [e.requestId, e]));
  for (const seq of [1, 6]) {
    assert.equal(snapById.get(idOf(seq)).cached, false, `永久在飞 seq${seq} 不得被 settle 为 cached(仍挂起)`);
  }
  for (const seq of [3, 4, 7, 8]) {
    assert.equal(snapById.get(idOf(seq)).cached, true, `已成功条目 seq${seq} 应为 cached`);
  }

  // 账本保留状态:已成功的 6 笔 committed;永久在飞 2 笔 reserved;背压 2 笔不存在
  const entries = sharedLedger.entries();
  for (const seq of [2, 3, 4, 5, 7, 8]) {
    const e = entries.find((x) => x.requestId === idOf(seq));
    assert.equal(e.state, 'committed', `seq${seq} 应 committed`);
    assert.equal(e.usageTokens, 200 + seq, `seq${seq} usage 独立结算`);
  }
  for (const seq of [1, 6]) {
    const e = entries.find((x) => x.requestId === idOf(seq));
    assert.equal(e.state, 'reserved', `永久在飞 seq${seq} 的预留必须保留(不释放、不记 0)`);
    assert.equal(e.estimateTokens, 1000);
  }
  assert.equal(entries.filter((e) => e.requestId === idOf(7) || e.requestId === idOf(8)).length, 2, '背压请求仅在重试成功后才产生账目');
});

// ---------------------------------------------------------------------------
// S3 延迟 + 取消 + 刷新重放
// ---------------------------------------------------------------------------

test('S3 延迟+取消:送出后 abort → unknown/unknown_hold;刷新重放=完整新调用;成功后命中缓存', async () => {
  const reader = makeReader(snapshotV7());
  const t = makeBridgeTransport();
  const adapter = createModelAdapter({ transport: t.transport, ledger: sharedLedger, timeoutMs: 0 });
  const TEXT = '【合成】慢通道取消与刷新重放压测。';
  const build = () => buildBridge(reader, { sessionId: SESSION_A, op: 'delay', seq: 1, text: TEXT });

  // 1) 慢 transport + AbortController:送出后取消 → unknown(不是 cancelled、不是 failed)
  const b1 = build();
  const ac = new AbortController();
  const p1 = adapter.analyze(b1.request, bridgeContext(b1.snapshot, { signal: ac.signal }));
  await until(() => t.calls.length === 1, '慢调用已送出');
  ac.abort();
  const r1 = await p1;
  assert.equal(r1.status, 'unknown', '送出后取消必须 unknown(外部状态不可知)');
  assert.equal(r1.error.code, 'ABORTED_AFTER_SEND');
  assert.equal(r1.usageUnknown, true, 'usage 未知必须显式标记');
  assert.equal(r1.costLedger.reservationState, 'unknown_hold');
  const holdsAfterAbort = sharedLedger.entries().filter((e) => e.requestId === b1.request.requestId);
  assert.equal(holdsAfterAbort.length, 1);
  assert.equal(holdsAfterAbort[0].state, 'unknown_hold', '账本必须保留 unknown_hold(不释放、不记 0)');
  assert.equal(holdsAfterAbort[0].estimateTokens, 1000, 'unknown_hold>0:按预留额占用');
  recordResult('S3-延迟取消重放', r1);
  const snap1 = adapter.registrySnapshot().find((e) => e.requestId === b1.request.requestId);
  assert.equal(snap1.cached, false, 'unknown 不缓存:registry 条目必须为 uncached');

  // 2) 刷新重放:同 requestId 同载荷(同 op/seq 同快照,reader 未变)→ 完整新调用
  const b2 = build();
  assert.equal(b2.request.requestId, b1.request.requestId, '重放派生同一 requestId');
  assert.equal(b2.payloadHash, b1.payloadHash, '同快照同 op/seq 必须得到同一载荷指纹');
  t.respond(b1.request.requestId, okResult(b2.request, 333)); // 人工核实后放行
  const r2 = await adapter.analyze(b2.request, bridgeContext(b2.snapshot));
  await until(() => t.calls.length === 2, 'unknown 之后的重试必须产生完整新调用');
  assert.equal(r2.status, 'succeeded', '重试成功');
  assert.equal(r2.deduped, false, '重试是新调用,不是缓存命中');
  assert.equal(r2.costLedger.reservationState, 'committed', '重试按自身 usage 结算');
  const entriesAfterRetry = sharedLedger.entries().filter((e) => e.requestId === b1.request.requestId);
  assert.equal(entriesAfterRetry.filter((e) => e.state === 'unknown_hold').length, 1, '第一次的 unknown_hold 仍保留(未知不抵消)');
  assert.equal(entriesAfterRetry.filter((e) => e.state === 'committed' && e.usageTokens === 333).length, 1, '新调用独立 committed');
  recordResult('S3-延迟取消重放', r2);

  // 3) 成功后同载荷重放 → 缓存命中 deduped:true,transport 计数不增
  const b3 = build();
  assert.equal(b3.payloadHash, b1.payloadHash);
  const r3 = await adapter.analyze(b3.request, bridgeContext(b3.snapshot));
  assert.equal(r3.status, 'succeeded');
  assert.equal(r3.deduped, true, '确定性结果同载荷重放必须命中缓存');
  assert.equal(t.calls.length, 2, '缓存命中不得再次调用 transport');
  assert.equal(r3.evidenceRefs.length, 3, '命中结果携带原证据引用');
  recordResult('S3-延迟取消重放', r3);
});

// ---------------------------------------------------------------------------
// S4 版本替换中途
// ---------------------------------------------------------------------------

test('S4 版本替换中途:in-flight 翻转 reader → stale 按翻转字段断言、数据保留照常结算;重建不含 superseded', async () => {
  const reader = makeReader(snapshotV7()); // 初版 V7:remoteVersion 7、generation 0、EV-SYN-001..003
  const t = makeBridgeTransport();
  const adapter = createModelAdapter({ transport: t.transport, ledger: sharedLedger, timeoutMs: 0 });
  const build = (op) => buildBridge(reader, { sessionId: SESSION_A, op, seq: 1, text: '【合成】in-flight 期间版本替换压测。' });

  // 4a) 整版翻转(V7 → upgraded:remoteVersion 7→10、generation 0→2、EV-SYN-001 被取代)
  const b1 = build('stale-gen');
  assert.equal(b1.request.generation, 1, '产品 0 经桥偏移为协议代次 1');
  assert.equal(b1.request.contextVersion, 'rv7');
  const p1 = adapter.analyze(b1.request, bridgeContext(b1.snapshot));
  await until(() => t.calls.length === 1, '4a 调用已送出');
  reader.set(snapshotEvidenceUpgraded()); // in-flight 期间原子翻转
  t.respond(b1.request.requestId, okResult(b1.request, 411));
  const r1 = await p1;
  // generation 与 contextVersion 同时翻转:stalenessOf 先核对 generation → 断言命中 GENERATION_CHANGED
  assert.equal(r1.status, 'stale', '在途结果遇上下文推进必须 stale,不得冒充现行');
  assert.equal(r1.error.code, 'GENERATION_CHANGED', '翻转含 generation 时按核对了 generation 断言');
  assert.equal(r1.findings.length, 1, '结果数据保留(findings 供人工核对)');
  assert.deepEqual(r1.evidenceRefs, b1.request.evidenceRefs, '结果数据保留(旧证据引用原样)');
  assert.equal(r1.usage.totalTokens, 411, 'usage 照常取回');
  assert.equal(r1.usageUnknown, false);
  assert.equal(r1.costLedger.reservationState, 'committed', '外部调用已发生:usage 照常结算,不释放');
  recordResult('S4-版本替换', r1);
  assert.equal(sharedLedger.entries().find((e) => e.requestId === b1.request.requestId).state, 'committed');

  // 4b) 只翻 remoteVersion(generation 不变)→ CONTEXT_VERSION_CHANGED(按翻转字段精确断言)
  reader.set(snapshotV7()); // 先复位到基准 V7,使 b2 建于 rv7,再在途翻转仅 version 字段
  const b2 = build('stale-cv');
  assert.equal(b2.request.generation, 1);
  assert.equal(b2.request.contextVersion, 'rv7');
  const p2 = adapter.analyze(b2.request, bridgeContext(b2.snapshot));
  await until(() => t.calls.length === 2, '4b 调用已送出');
  reader.set({ ...snapshotV7(), version: 8 }); // 仅 version 7→8,generation/evidence 不变
  t.respond(b2.request.requestId, okResult(b2.request, 412));
  const r2 = await p2;
  assert.equal(r2.status, 'stale');
  assert.equal(r2.error.code, 'CONTEXT_VERSION_CHANGED', '仅 version 翻转时必须命中 contextVersion 路径');
  assert.equal(r2.costLedger.reservationState, 'committed', 'stale 同样照常结算');
  assert.equal(r2.usage.totalTokens, 412);
  recordResult('S4-版本替换', r2);

  // 4c) 旧证据引用的请求在新 reader 下重新构建(同 op/seq 的重试语义)
  reader.set(snapshotEvidenceUpgraded());
  const b3 = build('stale-gen');
  assert.equal(b3.ok, true, '新 reader 下重建必须成功(superseded 显式过滤,非静默)');
  assert.notEqual(b3.request.requestId, b1.request.requestId, '上下文推进 → requestId 随 generation 变化');
  assert.equal(b3.request.generation, 3, '新协议代次 = 产品 2 + 1');
  assert.equal(b3.request.contextVersion, 'rv10', '新上下文版本 = rv10');
  const refIds = b3.request.evidenceRefs.map((r) => r.id);
  assert.ok(!refIds.includes('EV-SYN-001'), '新请求证据不得含被取代的 EV-SYN-001');
  assert.ok(refIds.includes('EV-SYN-004'), '新请求证据必须含取代者 EV-SYN-004');
  assert.equal(b3.bridgeMeta.supersededFiltered, 1, 'superseded 过滤必须显式计数(可审计)');
  assert.deepEqual(refIds.sort(), ['EV-SYN-002', 'EV-SYN-003', 'EV-SYN-004']);
  // 重建请求端到端可成功:旧 stale 结果不得污染新上下文的调用
  t.respond(b3.request.requestId, okResult(b3.request, 413));
  const r3 = await adapter.analyze(b3.request, bridgeContext(b3.snapshot));
  await until(() => t.calls.length === 3, '4c 重建请求产生一次新调用');
  assert.equal(r3.status, 'succeeded', '新 reader 下的重建请求应成功');
  assert.equal(r3.costLedger.reservationState, 'committed');
  recordResult('S4-版本替换', r3);
});

// ---------------------------------------------------------------------------
// S5 确定未送出路径 + 全场景账本守恒
// ---------------------------------------------------------------------------

test('S5a 确定未送出:transport 证明未发送 → cancelled + release(唯一的合法释放路径)', async () => {
  const reader = makeReader(snapshotV7());
  const t = makeBridgeTransport();
  const adapter = createModelAdapter({ transport: t.transport, ledger: sharedLedger, timeoutMs: 0 });
  const b = buildBridge(reader, { sessionId: SESSION_A, op: 'notsent', seq: 1, text: '【合成】确定未送出路径压测。' });
  t.respond(b.request.requestId, { ok: false, sent: false, error: { code: 'QUEUE_FULL', message: '发送前被 provider 拒绝(合成)' } });
  const r = await adapter.analyze(b.request, bridgeContext(b.snapshot));
  assert.equal(r.status, 'cancelled', 'transport 证明未发送 → cancelled(不是 unknown)');
  assert.equal(r.error.code, 'CANCELLED_BEFORE_SEND');
  assert.equal(r.usageUnknown, false, '确定未送出不存在未知费用');
  assert.equal(r.costLedger.reservationState, 'released', '只有该路径允许 release');
  const e = sharedLedger.entries().find((x) => x.requestId === b.request.requestId);
  assert.equal(e.state, 'released');
  assert.equal(e.settleNote, 'TRANSPORT_REPORTED_NOT_SENT', '释放留痕必须指向确定未送出路径');
  recordResult('S5-确定未送出', r);
});

test('S5b 账本守恒:occupied=reserved+committed+unknownHold;每笔占用可溯源;未知费用释放为 0', async () => {
  const totals = sharedLedger.totals();
  const entries = sharedLedger.entries();

  // 恒等式 + 独立重算(从条目重算占用,与 totals() 交叉核对)
  assert.equal(totals.occupiedTokens, totals.reservedTokens + totals.committedTokens + totals.unknownHoldTokens);
  const recomputed = entries.reduce((sum, e) => {
    if (e.state === 'reserved' || e.state === 'unknown_hold') return sum + e.estimateTokens;
    if (e.state === 'committed') return sum + e.usageTokens;
    return sum;
  }, 0);
  assert.equal(totals.occupiedTokens, recomputed, 'occupiedTokens 必须与逐条重算一致');

  // 全场景固定金额核算(S1:10×(111|222);S2:6 笔 202..208;S3:333;S4:411+412+413)
  assert.equal(totals.reservedTokens, 2000, '恰为 S2 两条永久在飞的预留(2×1000)');
  assert.equal(totals.unknownHoldTokens, 1000, '恰为 S3 abort 的 unknown_hold');
  assert.equal(totals.committedTokens, 1665 + 1229 + 333 + 1236, 'committed 逐场景金额守恒');
  assert.equal(totals.releasedTokens, 1000, 'release 恰一笔:S5a 确定未送出(不计占用)');
  assert.equal(totals.rejectedCount, 0, '容量背压不触账本:零预算拒绝记录');
  assert.equal(entries.length, 24, '全部场景恰 24 笔账目(10+8+2+3+1)');

  // known-hold 溯源:每笔 unknown_hold 按预留笔对准一次 unknown/失败结果,留痕为送出后不可知码
  const UNKNOWN_PATH_NOTES = new Set(['ABORTED_AFTER_SEND', 'TIMEOUT', 'TRANSPORT_INDETERMINATE', 'USAGE_MISSING', 'TRANSPORT_THROWN', 'TRANSPORT_ERROR']);
  for (const e of entries.filter((x) => x.state === 'unknown_hold')) {
    const via = RESERVATION_OUTCOMES.get(e.id);
    assert.ok(via, `unknown_hold ${e.requestId}(${e.id}) 缺少按预留笔的结果溯源`);
    assert.ok(via.status === 'unknown' || via.status === 'failed', `unknown_hold ${e.id} 对应的结果必须是 unknown/failed,实得 ${via.status}`);
    assert.ok(UNKNOWN_PATH_NOTES.has(e.settleNote), `unknown_hold 留痕必须指向送出后不可知路径,实得 ${e.settleNote}`);
  }
  // committed 溯源:每笔 committed 按预留笔对准一次有 usage 的已观测结果,unknown 不得冒充 commit
  const COMMITTED_STATUSES = new Set(['succeeded', 'stale', 'failed']);
  for (const e of entries.filter((x) => x.state === 'committed')) {
    assert.ok(Number.isInteger(e.usageTokens) && e.usageTokens >= 0, `committed ${e.requestId} 必须有非负整数 usage`);
    const via = RESERVATION_OUTCOMES.get(e.id);
    assert.ok(via, `committed ${e.requestId}(${e.id}) 缺少按预留笔的结果溯源`);
    assert.ok(COMMITTED_STATUSES.has(via.status), `committed ${e.id} 对应的结果必须是 ${[...COMMITTED_STATUSES].join('/')},实得 ${via.status}`);
  }
  // reserved 溯源:恰为仍挂起的永久在飞(从未有结果被观测)
  const reservedIds = entries.filter((e) => e.state === 'reserved').map((e) => e.requestId).sort();
  assert.deepEqual(reservedIds, [...PERMANENT_INFLIGHT].sort(), 'reserved 必须恰为 S2 永久在飞两条');
  for (const id of PERMANENT_INFLIGHT) {
    assert.equal(OUTCOMES.get(id), undefined, '永久在飞不得有任何已观测结果');
  }
  // release 纪律:释放只出现在确定未送出路径;任何 unknown 费用的释放为 0
  const NOT_SENT_NOTES = new Set(['TRANSPORT_REPORTED_NOT_SENT', 'TRANSPORT_REFUSED_BEFORE_SEND']);
  for (const e of entries.filter((x) => x.state === 'released')) {
    assert.ok(NOT_SENT_NOTES.has(e.settleNote), `release 留痕必须是确定未送出路径,实得 ${e.settleNote}`);
    const via = RESERVATION_OUTCOMES.get(e.id);
    assert.ok(via && via.status === 'cancelled', `released ${e.id} 的按预留笔结果必须是 cancelled`);
    const outs = OUTCOMES.get(e.requestId) || [];
    assert.ok(!outs.some((o) => o.status === 'unknown'), '未知费用不得出现任何释放');
  }
});

// ---------------------------------------------------------------------------
// 定向 mutation(报告分母固定为 2:E1 + E2)
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const deliverRoot = path.resolve(here, '..', '..');
// 变异副本写 runtime/bridge-mutants/bridge/(可变区,不入冻结);相对导入按该位置
// 改写回交付根 src/(runtime/bridge-mutants/bridge → ../../../src),写完即动态 import 自测可解析。
const mutantsDir = path.join(deliverRoot, 'runtime', 'bridge-mutants', 'bridge');
const relSrc = path.relative(mutantsDir, path.join(deliverRoot, 'src')).split(path.sep).join('/');
mkdirSync(mutantsDir, { recursive: true });

const MUTATION_REPORT = { injected: 2, caught: 0, e1: { caught: false, via: null }, e2: { caught: false, via: null } };

/** 锚点计数校验式替换:出现次数≠1 视为锚点漂移,直接失败(不静默)。 */
function replaceOnce(src, from, to, label) {
  const count = src.split(from).length - 1;
  assert.equal(count, 1, `变异锚点漂移(${label}):「${from}」出现 ${count} 次,预期恰 1 次;测试需随源码演进而更新`);
  return src.replace(from, to);
}

/** 读源码 → (变异) → 改写相对导入 → 写 runtime/bridge-mutants/bridge/ → 动态 import。 */
async function loadBridgeVariant(name, mutateFn) {
  const src = readFileSync(path.join(deliverRoot, 'src', 'bridge', 'product-bridge.mjs'), 'utf8');
  let out = mutateFn ? mutateFn(src) : src;
  out = out
    .split(`from '../integration/product-mapping.mjs'`).join(`from '${relSrc}/integration/product-mapping.mjs'`)
    .split(`from '../dedupe.mjs'`).join(`from '${relSrc}/dedupe.mjs'`);
  assert.ok(out.includes(`from '${relSrc}/integration/product-mapping.mjs'`), 'product-mapping 导入必须改写');
  assert.ok(out.includes(`from '${relSrc}/dedupe.mjs'`), 'dedupe 导入必须改写');
  assert.ok(!out.includes(`from '../integration/product-mapping.mjs'`), '不得残留指向 runtime/ 的旧导入');
  assert.ok(!out.includes(`from '../dedupe.mjs'`), '不得残留指向 runtime/ 的旧导入');
  const file = path.join(mutantsDir, `product-bridge.${name}.mjs`);
  writeFileSync(file, out, 'utf8');
  return import(pathToFileURL(file).href); // import 本身即"可解析"自测
}

test('mutation 机制自检:仅改写导入的无变异副本必须与真桥行为一致(防止"抓错原因")', async () => {
  const copy = await loadBridgeVariant('rewire-check', null);
  const reader = () => snapshotV7();
  const args = { storeReader: reader, sessionId: SESSION_A, op: 'rewire-check', seq: 1, role: 'credit', purpose: 'risk_review', text: '【合成】rewire 自检。' };
  const real = buildAnalyzeRequest(args);
  const twin = copy.buildAnalyzeRequest(args);
  assert.equal(twin.ok, true);
  assert.equal(twin.request.requestId, real.request.requestId, 'requestId 必须与真桥一致');
  assert.equal(twin.request.generation, 1);
  assert.equal(twin.request.contextVersion, 'rv7');
  assert.equal(twin.payloadHash, real.payloadHash, '载荷指纹必须与真桥一致');
  assert.deepEqual(twin.snapshot(), real.snapshot(), '快照回调必须与真桥一致');
});

test('mutation-E1:删除 +1 偏移(产品 0 直接透传)→ 适配器请求校验拒绝(偏移必要性)', async () => {
  const mutant = await loadBridgeVariant('mutant-E1-no-offset', (src) => replaceOnce(
    src,
    '\n    generation: protocolGeneration,\n', // 行锚定:避免命中 canonicalRequestId 行内的同名参数
    '\n    generation: productGeneration, /* MUTANT-E1: +1 偏移被删除,产品 0 直接透传 */\n',
    'E1',
  ));

  // 端到端对照(独立 ledger/transport,不进共享守恒账本)
  const runEndToEnd = async (bridgeMod, tag) => {
    const calls = [];
    const ledger = createMemoryLedger({ label: `mutation-${tag}` });
    const adapter = createModelAdapter({
      transport: async (call) => {
        calls.push(call);
        return { ok: true, output: goodOutput(call.payload.evidenceRefs), usage: { totalTokens: 50 } };
      },
      ledger,
      timeoutMs: 0,
    });
    const built = bridgeMod.buildAnalyzeRequest({
      storeReader: () => snapshotV7(), // 产品 generation 初始 0:偏移存在的唯一理由
      sessionId: SESSION_A,
      op: 'mutation-e1',
      seq: 1,
      role: 'credit',
      purpose: 'risk_review',
      text: '【合成】mutation E1:generation 偏移必要性。',
    });
    const result = await adapter.analyze(built.request, bridgeContext(built.snapshot));
    return { built, result, transportCalls: calls.length };
  };

  // 正确实现:产品 0 → 协议 1,端到端成功(对照不误伤)
  const good = await runEndToEnd(await import(pathToFileURL(path.join(deliverRoot, 'src', 'bridge', 'product-bridge.mjs')).href), 'good');
  assert.equal(good.built.ok, true);
  assert.equal(good.built.request.generation, 1, '正确桥必须应用 +1 偏移');
  assert.equal(good.built.bridgeMeta.productGeneration, 0);
  assert.equal(good.result.status, 'succeeded', '正确实现端到端必须通过');
  assert.equal(good.transportCalls, 1);

  // 变异实现:generation 直接透传产品 0 → 适配器请求校验拒(generation 0 非正整数)
  const bad = await runEndToEnd(mutant, 'e1');
  assert.equal(bad.built.ok, true, '变异桥自身不设防:建桥仍成功(缺口在协议层被拦)');
  assert.equal(bad.built.request.generation, 0, '变异后产品 0 直接透传为协议代次');
  assert.equal(bad.result.status, 'failed', '变异实现必须端到端失败');
  assert.equal(bad.result.error.code, 'REQUEST_INVALID', '必须被适配器请求校验(generation 非正整数)拒绝');
  assert.equal(bad.transportCalls, 0, '被拒请求不得触达 transport');

  MUTATION_REPORT.e1 = { caught: true, via: 'adapter REQUEST_INVALID(generation=0)' };
});

test('mutation-E2:remoteVersion 缺失补默认常数 0 → 失败关闭被破坏(missingVersion 放行)', async () => {
  const mutant = await loadBridgeVariant('mutant-E2-default-version', (src) => replaceOnce(
    src,
    'if (!Number.isInteger(store.version)) {',
    // 平衡变异:原块改为"注入默认常数 0 后照常放行";原 return 挂到永不触发的 else if 分支(花括号守恒)
    'if (!Number.isInteger(store.version)) { store = { ...store, version: 0 }; } else if (false) { // MUTANT-E2: 缺失补默认常数 0,失败关闭被破坏',
    'E2',
  ));
  const buildArgs = {
    storeReader: () => snapshotMissingVersion(), // version 缺失的负样本(16 的失败关闭语义输入)
    sessionId: SESSION_A,
    op: 'mutation-e2',
    seq: 1,
    role: 'credit',
    purpose: 'risk_review',
    text: '【合成】mutation E2:remoteVersion 失败关闭。',
  };

  // 正确实现:失败关闭,不用默认常数补齐
  const goodBuilt = buildAnalyzeRequest(buildArgs);
  assert.equal(goodBuilt.ok, false, '正确桥对 missingVersion 必须拒绝');
  assert.equal(goodBuilt.code, 'MAPPING_MISSING_FIELDS');
  assert.equal(goodBuilt.details.field, 'version');

  // 变异实现:静默补 rv0 → ok:true,且一路送到 transport(16 的失败关闭语义被破坏)
  const badBuilt = mutant.buildAnalyzeRequest(buildArgs);
  assert.equal(badBuilt.ok, true, '变异桥必须把缺 version 的快照放行(缺陷复现)');
  assert.equal(badBuilt.bridgeMeta.remoteVersion, 0, '默认常数 0 被注入 bridgeMeta');
  assert.equal(badBuilt.request.contextVersion, 'rv0', '默认常数 0 被注入 contextVersion(rv0)');
  const calls = [];
  const adapter = createModelAdapter({
    transport: async (call) => {
      calls.push(call);
      return { ok: true, output: goodOutput(call.payload.evidenceRefs), usage: { totalTokens: 50 } };
    },
    ledger: createMemoryLedger({ label: 'mutation-e2' }),
    timeoutMs: 0,
  });
  const badResult = await adapter.analyze(badBuilt.request, bridgeContext(badBuilt.snapshot));
  assert.equal(badResult.status, 'succeeded', '变异版把静默默认请求一路送到模型(危险行为坐实)');
  assert.equal(calls.length, 1, 'transport 恰被调用一次');

  MUTATION_REPORT.e2 = { caught: true, via: 'missingVersion:正确 ok:false,变异 ok:true + rv0 透传' };
});

test('mutation 汇总:分母固定 2,全部被抓(报告输出 + 断言)', () => {
  MUTATION_REPORT.caught = (MUTATION_REPORT.e1.caught ? 1 : 0) + (MUTATION_REPORT.e2.caught ? 1 : 0);
  const summary = { injected: MUTATION_REPORT.injected, caught: MUTATION_REPORT.caught, ratio: `${MUTATION_REPORT.caught}/2` };
  console.log('[17] mutation 汇总:', JSON.stringify({ ...summary, details: { e1: MUTATION_REPORT.e1, e2: MUTATION_REPORT.e2 } }));
  console.log(`[17] 变异副本目录(可变区):${mutantsDir}`);
  assert.equal(summary.injected, 2, '分母固定为 2(禁止用测试总数代替)');
  assert.equal(summary.caught, 2, `两个注入缺陷必须全部被抓,实际 ${summary.caught}/2:${JSON.stringify({ e1: MUTATION_REPORT.e1, e2: MUTATION_REPORT.e2 })}`);
});

// ---------------------------------------------------------------------------
// 压测分母统计(场景 × 结果计数表)
// ---------------------------------------------------------------------------

test('压测分母统计:场景×结果计数表(固定 seed)输出与断言', () => {
  const scenarios = ['S1-跨会话污染', 'S2-容量满', 'S3-延迟取消重放', 'S4-版本替换', 'S5-确定未送出'];
  const statuses = ['succeeded', 'stale', 'cancelled', 'failed', 'unknown'];
  const lines = [];
  let colTotal = 0;
  const colByStatus = Object.fromEntries(statuses.map((s) => [s, 0]));
  lines.push('场景'.padEnd(20, '　') + statuses.map((s) => s.padEnd(11)).join('') + '合计');
  for (const sc of scenarios) {
    const s = STATS.get(sc) || { total: 0 };
    const row = statuses.map((st) => String(s[st] || 0).padEnd(11)).join('');
    colTotal += s.total;
    for (const st of statuses) colByStatus[st] += s[st] || 0;
    lines.push(sc.padEnd(20, '　') + row + String(s.total));
  }
  lines.push('合计'.padEnd(20, '　') + statuses.map((st) => String(colByStatus[st]).padEnd(11)).join('') + String(colTotal));
  console.log(`[17] 压测分母(场景×结果,seed=${SEED},全部经桥发起):`);
  for (const line of lines) console.log(`     ${line}`);

  // 分母自检:每个场景的关键计数必须与场景设计一致
  assert.equal(STATS.get('S1-跨会话污染').succeeded, 10);
  assert.equal(STATS.get('S2-容量满').failed, 2, '恰 2 笔 REGISTRY_AT_CAPACITY 背压');
  assert.equal(STATS.get('S2-容量满').succeeded, 6, 'S2 观测成功 6 笔(2 永久在飞不产生结果)');
  assert.deepEqual([STATS.get('S3-延迟取消重放').unknown, STATS.get('S3-延迟取消重放').succeeded], [1, 2]);
  assert.deepEqual([STATS.get('S4-版本替换').stale, STATS.get('S4-版本替换').succeeded], [2, 1]);
  assert.deepEqual([STATS.get('S5-确定未送出').cancelled], [1]);
  assert.equal(colTotal, 25, '观测结果总计 25(不含 2 条永久在飞与 1 条缓存命中外的未发起调用)');
  assert.deepEqual(colByStatus, { succeeded: 19, stale: 2, cancelled: 1, failed: 2, unknown: 1 }, '七状态分布与设计一致');
});
