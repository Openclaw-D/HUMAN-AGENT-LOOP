// R3 接入一致性测试(桥层):generation 产品0→协议1 偏移、多次暂停恢复、证据升级、
// 原子读取失败关闭、原始意见/异议/人定分离、回执协议、提醒授权与去重。
// 每条一致性断言同时覆盖请求侧与快照侧;快照全部来自 fixtures/product-snapshots.mjs
// (冻结产品形状,源码定位 remote-types.ts:44-81 / remote-store.ts:44-56)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeRequest, bridgeContext } from '../../src/bridge/product-bridge.mjs';
import { buildReceipt, isIntegratedReady, RECEIPT_SCHEMA } from '../../src/bridge/receipt-protocol.mjs';
import { aggregateResults } from '../../src/aggregate.mjs';
import { planReminders } from '../../src/reminders.mjs';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import {
  snapshotV7, snapshotPausedGen2, snapshotEvidenceUpgraded, snapshotMissingVersion, snapshotLegacyNoGeneration,
} from '../../fixtures/product-snapshots.mjs';
import { goodOutput, makeEvidence } from '../helpers.mjs';

const SESSION = 'sess-remote-001';
const COMMON = { sessionId: SESSION, op: 'risk_review', seq: 1, role: 'credit', purpose: 'risk_review', text: '【合成】访谈文本' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('generation0→协议1:请求侧与快照侧一致(+1 偏移、rv 前缀、证据计数、零过滤)', () => {
  const r = buildAnalyzeRequest({ ...COMMON, storeReader: snapshotV7 });
  assert.equal(r.ok, true, `建桥应成功:${JSON.stringify(r.message || '')}`);
  assert.equal(r.request.generation, 1, '产品 generation 0 必须映射为协议 1');
  assert.equal(r.request.contextVersion, 'rv7');
  assert.equal(r.request.requestId, `r${SESSION}-g1-risk_review-1`);
  assert.equal(r.request.evidenceRefs.length, 3);
  assert.ok(r.request.evidenceRefs.every((ref) => /^EV-SYN-00\d$/.test(ref.id) && ref.version === '1' && ref.hash.length > 0));
  assert.equal(r.snapshot().generation, 1, '快照侧同源偏移');
  assert.equal(r.snapshot().contextVersion, 'rv7');
  assert.equal(r.snapshot().paused, false);
  assert.equal(r.bridgeMeta.productGeneration, 0);
  assert.equal(r.bridgeMeta.supersededFiltered, 0);
  assert.equal(r.bridgeMeta.evidenceCount, 3);
  assert.equal(r.bridgeMeta.remoteVersion, 7);
});

test('generation2→协议3:偏移全链一致(请求/requestId/快照)', () => {
  const r = buildAnalyzeRequest({ ...COMMON, seq: 2, storeReader: snapshotPausedGen2 });
  assert.equal(r.ok, true);
  assert.equal(r.request.generation, 3);
  assert.equal(r.request.requestId, `r${SESSION}-g3-risk_review-2`);
  assert.equal(r.snapshot().generation, 3);
  assert.equal(r.snapshot().paused, true, 'status=paused 必须反映在快照');
  assert.equal(r.snapshot().contextVersion, 'rv9');
});

test('多次暂停恢复:旧代次请求在新快照下 stale,恢复后新代次请求成功(端到端,含 transport 计数)', async () => {
  let store = snapshotV7(); // gen0 / rv7
  const storeReader = () => store;
  const ledger = createMemoryLedger({});
  let calls = 0;
  const adapter = createModelAdapter({
    transport: async (call) => {
      calls += 1;
      // 输出引用本次请求实际携带的证据清单(桥请求随 store 版本演进,清单会变)
      const refs = call.payload.evidenceRefs.map((r) => ({ ...r }));
      return { ok: true, output: goodOutput(refs), usage: { totalTokens: 20 } };
    },
    ledger,
    timeoutMs: 5000,
  });

  // gen0(rv7)发起:慢 transport(在途)。输出必须引用请求实际携带的产品证据清单
  const built1 = buildAnalyzeRequest({ ...COMMON, seq: 1, storeReader });
  assert.equal(built1.ok, true);
  const refs1 = built1.request.evidenceRefs.map((r) => ({ ...r }));
  const p1 = adapter.analyze(built1.request, bridgeContext(built1.snapshot));

  // 暂停两次(generation 0→1→2,rv 7→8→9)后返回:在途结果必须 stale,不得越代
  store = snapshotPausedGen2();
  const r1 = await p1;
  assert.equal(r1.status, 'stale');
  assert.equal(r1.error.code, 'GENERATION_CHANGED');
  assert.ok(r1.error.message.includes('generation') || r1.error.message.includes('代次'), 'stale 提示必须指明代次');

  // 显式人工恢复(generation 2→3,rv10):旧载荷重发 → 快照已推进,仍 stale;transport 不增(缓存)
  store = { version: 10, sessions: [{ ...store.sessions[0], status: 'live', generation: 3 }], evidence: snapshotEvidenceUpgraded().evidence };
  const r2 = await adapter.analyze(built1.request, bridgeContext(built1.snapshot));
  assert.equal(r2.status, 'stale');
  assert.equal(r2.deduped, true, '缓存复核产生的 stale 命中缓存,transport 计数不增');
  assert.equal(calls, 1);

  // 新代次新载荷(op/seq=2):完整新调用成功,账本 committed
  const built2 = buildAnalyzeRequest({ ...COMMON, seq: 2, storeReader });
  assert.equal(built2.ok, true);
  assert.equal(built2.request.generation, 4, '产品 3 → 协议 4(偏移持续一致)');
  const r3 = await adapter.analyze(built2.request, bridgeContext(built2.snapshot));
  assert.equal(r3.status, 'succeeded');
  assert.equal(calls, 2);
  assert.equal(r3.costLedger.reservationState, 'committed');
  const t = ledger.totals();
  assert.equal(t.occupiedTokens, t.reservedTokens + t.committedTokens + t.unknownHoldTokens, '账本恒等式');
});

test('证据升级:superseded 证据显式过滤(EV-001 出、EV-004 进)+ contextVersion 推进 + 旧载荷 mismatch', () => {
  const rOld = buildAnalyzeRequest({ ...COMMON, seq: 1, storeReader: snapshotV7 });
  assert.equal(rOld.ok, true);
  const idsOld = rOld.request.evidenceRefs.map((x) => x.id).sort();
  assert.deepEqual(idsOld, ['EV-SYN-001', 'EV-SYN-002', 'EV-SYN-003']);

  const rNew = buildAnalyzeRequest({ ...COMMON, seq: 3, storeReader: snapshotEvidenceUpgraded });
  assert.equal(rNew.ok, true);
  assert.equal(rNew.request.contextVersion, 'rv10');
  assert.equal(rNew.bridgeMeta.supersededFiltered, 1, '被取代证据必须显式计数,不得静默');
  const idsNew = rNew.request.evidenceRefs.map((x) => x.id).sort();
  assert.deepEqual(idsNew, ['EV-SYN-002', 'EV-SYN-003', 'EV-SYN-004'], 'EV-SYN-001 出、EV-SYN-004(重拍)进');
  assert.equal(rNew.snapshot().contextVersion, 'rv10');

  // 旧证据集的旧请求(op/seq 复用 1)在新 reader 下:载荷不同(证据清单+contextVersion)→ 同ID变载荷保护
  const rOldAgain = buildAnalyzeRequest({ ...COMMON, seq: 1, storeReader: snapshotEvidenceUpgraded });
  assert.equal(rOldAgain.ok, true);
  assert.notEqual(rOldAgain.payloadHash, rOld.payloadHash, '证据升级后同ID载荷指纹必须不同');
});

test('原子读取失败关闭:缺 version / 缺 generation / reader 非函数 / reader 抛错 → 拒绝且无默认常数补齐', () => {
  const r1 = buildAnalyzeRequest({ ...COMMON, storeReader: snapshotMissingVersion });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'MAPPING_MISSING_FIELDS');
  assert.ok(r1.message.includes('version'));

  const r2 = buildAnalyzeRequest({ ...COMMON, storeReader: snapshotLegacyNoGeneration });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'MAPPING_MISSING_FIELDS');
  assert.ok(r2.message.includes('generation'), 'legacy 缺 generation 由读侧先补;桥拒绝,不用 0/1 补齐');

  const r3 = buildAnalyzeRequest({ ...COMMON, storeReader: 'not-a-function' });
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'BRIDGE_READER_REQUIRED');

  const r4 = buildAnalyzeRequest({ ...COMMON, storeReader: () => { throw new Error('store locked(合成)'); } });
  assert.equal(r4.ok, false);
  assert.equal(r4.code, 'BRIDGE_READER_THROWN');
});

test('快照回调的保守停摆:reader 后续失败 → generation0+paused,旧结果必 stale 绝不放行', async () => {
  let broken = false;
  const storeReader = () => {
    if (broken) throw new Error('store unavailable(合成)');
    return snapshotV7();
  };
  const built = buildAnalyzeRequest({ ...COMMON, seq: 9, storeReader });
  assert.equal(built.ok, true);
  const refs9 = built.request.evidenceRefs.map((r) => ({ ...r }));
  const d = deferred();
  const adapter = createModelAdapter({ transport: async () => d.promise, ledger: createMemoryLedger({}), timeoutMs: 30000 });
  const p = adapter.analyze(built.request, bridgeContext(built.snapshot));
  broken = true; // 返回前 store 读取不可用
  d.resolve({ ok: true, output: goodOutput(refs9) });
  const r = await p;
  assert.equal(r.status, 'stale', '快照不可得必须保守停摆:在途结果 stale,绝不以 succeeded 放行');
  assert.equal(r.error.code, 'GENERATION_CHANGED');
});

test('原始意见/异议/待人决定三者分离:去重不吞不同观点', async () => {
  const ev = makeEvidence(1);
  const adapterA = createModelAdapter({
    transport: async () => ({
      ok: true,
      output: {
        findings: [{ id: 'F1', text: '示例发现:回款周期异常,建议核对流水。', evidenceRefs: ev.map((r) => ({ ...r })) }],
        questions: [{ id: 'Q1', text: '请补充主要欠款方对账单。', evidenceRefs: [] }],
        dissent: [{ position: 'dissenting', text: '不同结论:回款周期属季节性波动,依据同一证据。', evidenceRefs: ev.map((r) => ({ ...r })), conflictsWith: ['F1'] }],
        evidenceRefs: ev.map((r) => ({ ...r })),
      },
    }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const rA = await adapterA.analyze({ requestId: 'r-dissent-1', projectId: 'p1', sessionId: 's1', generation: 1, contextVersion: 'c1', role: 'credit', purpose: 'risk_review', text: '', evidenceRefs: ev.map((r) => ({ ...r })) }, {});
  assert.equal(rA.status, 'succeeded');
  const adapterB = createModelAdapter({
    transport: async () => ({
      ok: true,
      output: {
        findings: [{ id: 'F2', text: '另一意见:建议直接追问欠款方结算条款。', evidenceRefs: ev.map((r) => ({ ...r })) }],
        questions: [{ id: 'Q1', text: '请补充主要欠款方对账单。', evidenceRefs: [] }],
        dissent: [],
        evidenceRefs: ev.map((r) => ({ ...r })),
      },
    }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const rB = await adapterB.analyze({ requestId: 'r-dissent-2', projectId: 'p1', sessionId: 's1', generation: 1, contextVersion: 'c1', role: 'credit', purpose: 'risk_review', text: '', evidenceRefs: ev.map((r) => ({ ...r })) }, {});

  const agg = aggregateResults([rA, rB]);
  assert.equal(agg.findings.length, 2, '两条原始意见都保留');
  assert.equal(agg.dissent.length, 1, '异议全量保留(丢失 0)');
  assert.equal(agg.questions.length, 1, '完全相同 text 的问题合并,sources 合并');
  assert.deepEqual(agg.questions[0].sources, ['r-dissent-1', 'r-dissent-2']);
  assert.ok(agg.pendingDecisions.length >= 1, '冲突进入待人决定');
  for (const pd of agg.pendingDecisions) {
    const keys = Object.keys(pd);
    assert.ok(keys.every((k) => ['id', 'sides', 'sourceRequestIds'].includes(k)), `pendingDecisions 不得含决定性字段:${keys.join(',')}`);
  }
  // 不同观点的 findings 不被去重吞掉:两条 finding 文本不同 → 两条都在
  assert.notEqual(agg.findings[0].text, agg.findings[1].text);
});

test('回执协议:succeeded/unknown 可判 integrated;篡改与缺自验被拒;回执是投影不含业务文本', async () => {
  const storeReader = snapshotV7;
  const built = buildAnalyzeRequest({ ...COMMON, storeReader });
  assert.equal(built.ok, true);
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({
    transport: async () => ({ ok: true, output: goodOutput(makeEvidence(3)), usage: { totalTokens: 30 } }),
    ledger,
    timeoutMs: 5000,
  });
  const result = await adapter.analyze(built.request, bridgeContext(built.snapshot));
  const receipt = buildReceipt({ result, request: built.request, bridgeMeta: built.bridgeMeta, ledgerTotals: ledger.totals() });
  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.bridgeMeta.productGeneration, 0, '回执同时记录产品口径代次');
  assert.equal(receipt.requestEcho.protocolGeneration, 1, '回执记录协议口径代次(=产品+1)');
  assert.equal(isIntegratedReady(receipt).ok, true);

  const bad1 = { ...receipt, schema: 'R3_BRIDGE_RECEIPT@9' };
  assert.equal(isIntegratedReady(bad1).ok, false);
  const bad2 = { ...receipt, checks: { ...receipt.checks, viaBridge: false } };
  const j2 = isIntegratedReady(bad2);
  assert.equal(j2.ok, false);
  assert.ok(j2.reason.includes('viaBridge'));
  // unknown 回执必须带 mustHumanVerify
  const unknownReceipt = { ...receipt, outcome: { ...receipt.outcome, status: 'unknown', errorCode: 'TIMEOUT' }, uiAction: { uiAction: 'show', zh: 'x', allowRetry: true, mustHumanVerify: false } };
  const j3 = isIntegratedReady(unknownReceipt);
  assert.equal(j3.ok, false);
  assert.ok(j3.reason.includes('mustHumanVerify') || j3.reason.includes('人工'));
  // 投影不含业务文本
  assert.ok(!JSON.stringify(receipt.outcome).includes('示例发现'), '回执不得复制 findings 文本(业务状态唯一来源是产品 store)');
});

test('提醒授权与去重:未授权上下文空计划;同 key 重复重要事件合并为一条(不重复打断)', () => {
  const events = [
    { kind: 'evidence_version_changed', key: 'ev-EV-SYN-001', importance: 'important', at: 1 },
    { kind: 'session_paused', key: 'pause-1', importance: 'important', at: 2 },
    { kind: 'evidence_version_changed', key: 'ev-EV-SYN-001', importance: 'important', at: 3 },
    { kind: 'result_unknown', key: 'unknown-1', importance: 'normal', at: 4 }, // normal 非 mention → 不进
    { kind: 'human_mention', key: 'mention-1', importance: 'normal', at: 5 }, // 点名例外 → 进
  ];
  const plan = planReminders({ events, authorizedContext: { sessionId: SESSION, roles: ['credit'] } });
  assert.ok(plan.items.length >= 2, '授权上下文:重要事件+点名进计划');
  const evItem = plan.items.find((i) => i.key === 'ev-EV-SYN-001');
  assert.ok(evItem && evItem.occurrences === 2, `同 key 重复事件必须合并计数:${JSON.stringify(evItem)}`);
  assert.ok(!plan.items.some((i) => i.key === 'unknown-1'), '普通事件不打断');
  assert.ok(plan.items.some((i) => i.key === 'mention-1'), '点名例外进计划');
  assert.ok(plan.items.every((i) => i.action === 'notify_human'), '动作白名单仅 notify_human,不产生批准/自动动作');
  const empty = planReminders({ events, authorizedContext: null });
  assert.deepEqual(empty.items, [], '未授权上下文 → 空计划(只读已授权上下文)');
});
