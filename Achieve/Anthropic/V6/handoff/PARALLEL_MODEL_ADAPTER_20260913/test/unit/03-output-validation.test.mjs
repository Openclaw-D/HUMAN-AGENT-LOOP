// 输出守门:缺字段/空输出、悬空引用、无来源事实、越权批准、部分失败(整体 failed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, hasCJK } from '../helpers.mjs';

function adapterWith(outputFactory, { usage, ledger = createMemoryLedger({}) } = {}) {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: outputFactory(), usage }));
  return { adapter: createModelAdapter({ transport, ledger, timeoutMs: 5000 }), calls, ledger };
}

test('空输出:findings 与 questions 全空 → failed/EMPTY_OUTPUT,不伪装成功', async () => {
  const { adapter } = adapterWith(() => ({ findings: [], questions: [], evidenceRefs: [] }));
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EMPTY_OUTPUT');
  assert.ok(hasCJK(r.error.message));
});

test('缺字段:输出缺 findings 数组 → failed/MALFORMED_OUTPUT', async () => {
  const { adapter } = adapterWith(() => ({ questions: [] }));
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'MALFORMED_OUTPUT');
});

test('transport 返回非对象 → failed(外部调用已发生,预留保留不释放)', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ transport: async () => 'not-an-object', ledger, timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'MALFORMED_OUTPUT');
  assert.equal(r.costLedger.reservationState, 'unknown_hold');
  assert.equal(r.usageUnknown, true);
});

test('悬空引用:finding 引用输入中不存在的证据 → failed/EVIDENCE_DANGLING,details 指明具体 id', async () => {
  const ev = makeEvidence(1);
  const { adapter } = adapterWith(() => goodOutput(ev, {
    findings: [{ id: 'F1', text: '示例发现文本。', evidenceRefs: [{ id: 'EV-999', version: 'v1', hash: 'beef' }] }],
  }));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  const dangling = r.error.details.violations.find((v) => v.code === 'EVIDENCE_DANGLING');
  assert.equal(dangling.detail.id, 'EV-999');
});

test('版本不匹配:同 id 同 version 但 hash 不同 → 拒绝(三元组必须精确匹配)', async () => {
  const ev = makeEvidence(1);
  const bad = goodOutput(ev);
  bad.findings[0].evidenceRefs = [{ id: ev[0].id, version: ev[0].version, hash: `${ev[0].hash.slice(0, -1)}0` }];
  const { adapter } = adapterWith(() => bad);
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
});

test('无来源事实:输入证据清单为空而 findings 非空 → 全部拒为 UNSOURCED/EVIDENCE_DANGLING', async () => {
  const { adapter } = adapterWith(() => goodOutput([]));
  const r = await adapter.analyze(makeRequest({}, { evidence: [] }), {});
  assert.equal(r.status, 'failed');
  const codes = r.error.details.violations.map((v) => v.code);
  assert.ok(codes.includes('UNSOURCED_FINDING'), `应含 UNSOURCED_FINDING,实际:${codes.join(',')}`);
});

test('question 可以不带引用(问句不是事实断言),但带引用时必须合法', async () => {
  const ev = makeEvidence(1);
  const { adapter } = adapterWith(() => ({
    findings: [{ id: 'F1', text: '示例发现:台账与流水一致。', evidenceRefs: ev.map((r) => ({ ...r })) }],
    questions: [{ id: 'Q1', text: '请补充说明回款安排。', evidenceRefs: [] }],
    evidenceRefs: [],
  }));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'succeeded');

  const { adapter: a2 } = adapterWith(() => ({
    findings: [{ id: 'F1', text: '示例发现。', evidenceRefs: ev.map((r) => ({ ...r })) }],
    questions: [{ id: 'Q1', text: '追问。', evidenceRefs: [{ id: 'EV-404', version: 'v1', hash: 'x' }] }],
    evidenceRefs: [],
  }));
  const r2 = await a2.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r2.status, 'failed');
  assert.equal(r2.error.code, 'EVIDENCE_DANGLING');
});

test('越权批准:决定性表述「审批通过,同意放款」→ failed/UNAUTHORIZED_OUTPUT', async () => {
  const ev = makeEvidence(1);
  const { adapter } = adapterWith(() => goodOutput(ev, {
    findings: [{ id: 'F1', text: '审批通过,同意放款。', evidenceRefs: ev.map((r) => ({ ...r })) }],
  }));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'UNAUTHORIZED_OUTPUT');
  assert.ok(hasCJK(r.error.message));
});

test('越权批准:顶层保留字段 decision → 拒绝', async () => {
  const ev = makeEvidence(1);
  const out = goodOutput(ev);
  out.decision = 'approved';
  const { adapter } = adapterWith(() => out);
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'UNAUTHORIZED_OUTPUT');
  assert.ok(r.error.message.includes('decision'));
});

test('部分失败:一条 finding 合法、一条悬空 → 整体 failed,不得输出部分成功', async () => {
  const ev = makeEvidence(2);
  const { adapter } = adapterWith(() => ({
    findings: [
      { id: 'F1', text: '合法发现:引用 EV-001。', evidenceRefs: [ev[0]] },
      { id: 'F2', text: '悬空发现:引用不存在的 EV-777。', evidenceRefs: [{ id: 'EV-777', version: 'v1', hash: 'dd' }] },
    ],
    questions: [],
    evidenceRefs: [],
  }));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.findings, [], '失败结果不得携带部分 findings 冒充可用输出');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  const codes = r.error.details.violations.map((v) => v.code);
  assert.ok(codes.includes('EVIDENCE_DANGLING'));
});

test('部分失败:输出校验失败但 provider 报告了 usage → 按实际用量结算(调用已发生)', async () => {
  const ev = makeEvidence(1);
  const ledger = createMemoryLedger({});
  const { adapter } = adapterWith(() => ({ findings: [], questions: [], evidenceRefs: [] }), { usage: { totalTokens: 33 }, ledger });
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(ledger.totals().committedTokens, 33);
});
