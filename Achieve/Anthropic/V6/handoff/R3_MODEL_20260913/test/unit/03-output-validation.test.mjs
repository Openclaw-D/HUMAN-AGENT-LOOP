// 输出守门:缺字段/空输出、悬空引用、无来源事实、越权批准、部分失败(整体 failed)
// R2 追加:可选 dissent(专业原意见/不同结论)校验——合法异议照常通过,违规异议按码拒绝。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { validateProviderOutput } from '../../src/validate-response.mjs';
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
  // R2 修复基线既有笔误:totals 是方法(ledger.mjs `totals()`),原句 `ledger.totals.committedTokens`
  // 恒为 undefined,该断言在基线上从未真正生效。改为按 API 实际形状调用,不弱化断言本身。
  assert.equal(ledger.totals().committedTokens, 33);
});

// ---- R2 追加:可选 dissent 校验(Goal 工作包4:支持专业原意见/不同结论;异议是协作输入,不是错误)----

/** 合法 dissent 输出样例:引用给定证据清单。 */
function outputWithDissent(ev, dissent) {
  return {
    findings: [{ id: 'F1', text: '示例发现:回款周期与台账记录一致。', evidenceRefs: ev.map((r) => ({ ...r })) }],
    questions: [{ id: 'Q1', text: '请补充说明回款安排。', evidenceRefs: [] }],
    evidenceRefs: ev.map((r) => ({ ...r })),
    dissent,
  };
}

test('合法 dissent:存在异议不影响 succeeded 判定(异议是协作输入,不是错误)', async () => {
  const ev = makeEvidence(2);
  const { adapter } = adapterWith(() => outputWithDissent(ev, [
    { id: 'D1', position: 'original', text: '专业原意见:现有证据足以支持该发现。', evidenceRefs: [ev[0]], conflictsWith: [] },
    { id: 'D2', position: 'dissenting', text: '不同结论:回款周期证据不足,结论依据尚不充分。', evidenceRefs: [ev[1]], conflictsWith: ['F1'] },
  ]));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'succeeded', '合法 dissent 绝不把结果拖入 failed');
  assert.deepEqual(r.findings.map((f) => f.id), ['F1']);
});

test('合法 dissent:normalization 保留异议(id 缺省 D+序号、position、text、核查过的引用、conflictsWith)', () => {
  const ev = makeEvidence(2);
  const request = makeRequest({}, { evidence: ev });
  const v = validateProviderOutput({
    output: outputWithDissent(ev, [
      { position: 'original', text: '专业原意见:证据与现场访谈口径一致。', evidenceRefs: [ev[0]] },
      { id: 'DX', position: 'dissenting', text: '不同结论:该凭证日期存疑,结论应缓行。', evidenceRefs: [{ id: ev[1].id, version: ev[1].version, hash: ev[1].hash }], conflictsWith: ['F1', 'Q1'] },
    ]),
    request,
  });
  assert.equal(v.ok, true);
  assert.equal(v.normalized.dissent.length, 2, '异议全保留,聚合前守门层就不得吞掉');
  assert.deepEqual(v.normalized.dissent[0], {
    id: 'D1', // 缺省 id 按序号补齐
    position: 'original',
    text: '专业原意见:证据与现场访谈口径一致。',
    evidenceRefs: [{ id: ev[0].id, version: ev[0].version, hash: ev[0].hash }],
    conflictsWith: [],
  });
  assert.equal(v.normalized.dissent[1].id, 'DX');
  assert.deepEqual(v.normalized.dissent[1].conflictsWith, ['F1', 'Q1']);
  assert.ok(v.normalized.dissent[1].evidenceRefs[0].hash === ev[1].hash, 'evidenceRefs 只保留核查过的三元组');
});

test('dissent position 非法 → failed/MALFORMED_OUTPUT(只允许 original/dissenting)', async () => {
  const ev = makeEvidence(1);
  const request = makeRequest({}, { evidence: ev });
  const v = validateProviderOutput({
    output: outputWithDissent(ev, [{ position: 'approve', text: '意见文本。', evidenceRefs: [ev[0]] }]),
    request,
  });
  assert.equal(v.ok, false);
  const bad = v.violations.find((x) => x.code === 'MALFORMED_OUTPUT' && x.path === 'dissent[0].position');
  assert.ok(bad, `应有 position 非法违规:${JSON.stringify(v.violations)}`);
  assert.ok(hasCJK(bad.message));

  const { adapter } = adapterWith(() => outputWithDissent(ev, [{ position: 'veto', text: '意见文本。', evidenceRefs: [ev[0]] }]));
  const r = await adapter.analyze(request, {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'MALFORMED_OUTPUT');
});

test('dissent 引用悬空 → failed/EVIDENCE_DANGLING(与 findings 同码复用,detail 指明具体 id)', async () => {
  const ev = makeEvidence(1);
  const { adapter } = adapterWith(() => outputWithDissent(ev, [
    { position: 'dissenting', text: '不同结论:依据不足。', evidenceRefs: [{ id: 'EV-888', version: 'v1', hash: 'cafe' }] },
  ]));
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
  const dangling = r.error.details.violations.find((v) => v.path === 'dissent[0].evidenceRefs[0]');
  assert.ok(dangling, '悬空违规应指明 dissent 内的引用路径');
  assert.equal(dangling.detail.id, 'EV-888');
});

test('无 dissent 字段:normalization.dissent 为空数组(前向兼容,旧输出形状不变)', () => {
  const ev = makeEvidence(1);
  const request = makeRequest({}, { evidence: ev });
  const v = validateProviderOutput({ output: goodOutput(ev), request });
  assert.equal(v.ok, true);
  assert.deepEqual(v.normalized.dissent, []);
  const v2 = validateProviderOutput({ output: outputWithDissent(ev, null), request });
  assert.equal(v2.ok, true, 'dissent: null 视为缺省,不拒绝');
  assert.deepEqual(v2.normalized.dissent, []);
});

test('dissent 自身违规按对应码拒绝:文本空/无引用/越权表述/conflictsWith 非法/dissent 非数组', () => {
  const ev = makeEvidence(1);
  const request = makeRequest({}, { evidence: ev });
  const dissentViolations = (dissent) => validateProviderOutput({ output: outputWithDissent(ev, dissent), request });

  const noText = dissentViolations([{ position: 'original', text: '   ', evidenceRefs: [ev[0]] }]);
  assert.ok(noText.violations.some((v) => v.code === 'FINDING_TEXT_MISSING'), '异议文本缺失 → FINDING_TEXT_MISSING');

  const noRefs = dissentViolations([{ position: 'original', text: '意见。', evidenceRefs: [] }]);
  assert.ok(noRefs.violations.some((v) => v.code === 'UNSOURCED_FINDING'), '异议无引用 → UNSOURCED_FINDING(同 findings 规则)');

  const approval = dissentViolations([{ position: 'dissenting', text: '异议:建议批准该笔业务。', evidenceRefs: [ev[0]] }]);
  assert.ok(approval.violations.some((v) => v.code === 'UNAUTHORIZED_OUTPUT'), '异议文本含越权批准表述 → UNAUTHORIZED_OUTPUT');

  const badConflicts = dissentViolations([{ position: 'original', text: '意见。', evidenceRefs: [ev[0]], conflictsWith: [42] }]);
  assert.ok(badConflicts.violations.some((v) => v.code === 'MALFORMED_OUTPUT' && v.path === 'dissent[0].conflictsWith'), 'conflictsWith 元素必须是非空 id 字符串');

  const notArray = validateProviderOutput({ output: { ...outputWithDissent(ev, []), dissent: 'no' }, request });
  assert.ok(notArray.violations.some((v) => v.code === 'MALFORMED_OUTPUT' && v.path === 'dissent'), 'dissent 非数组 → MALFORMED_OUTPUT');
});
