// 正常结构 / simulated 区分 / not_configured / 输出语言
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createSimulatedTransport } from '../../src/simulated.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, recordingTransport, hasCJK } from '../helpers.mjs';

test('正常结构:succeeded、字段完整、usage 按 provider 报告结算、输出为中文', async () => {
  const ev = makeEvidence(2);
  const ledger = createMemoryLedger({});
  const { transport, calls } = recordingTransport(async (call) => ({
    ok: true,
    output: goodOutput(ev),
    usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 },
  }));
  const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });

  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.contractVersion, 'v1');
  assert.equal(r.status, 'succeeded');
  assert.equal(r.requestId, 'req-0001');
  assert.equal(r.role, 'credit');
  assert.equal(r.error, null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.questions.length, 1);
  assert.ok(hasCJK(r.findings[0].text), 'finding 文本必须是中文');
  assert.ok(hasCJK(r.questions[0].text), 'question 文本必须是中文');
  // 引用必须真实存在于本次输入(精确三元组)
  for (const ref of r.findings[0].evidenceRefs) {
    assert.ok(ev.some((e) => e.id === ref.id && e.version === ref.version && e.hash === ref.hash));
  }
  assert.deepEqual(r.usage, { promptTokens: 30, completionTokens: 12, totalTokens: 42, providerReported: true });
  assert.equal(r.usageUnknown, false);
  assert.equal(r.costLedger.reservationState, 'committed');
  assert.equal(ledger.totals().committedTokens, 42);
  assert.equal(r.simulation, null);
  // transport 收到的载荷必须携带协议边界指令
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.instructions.authority, 'none');
  assert.equal(calls[0].payload.role, 'credit');
});

test('simulated 通道:状态为 simulated(非 succeeded),并显著携带模拟声明', async () => {
  const ev = makeEvidence(1);
  const adapter = createModelAdapter({
    transport: createSimulatedTransport({}),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'simulated');
  assert.equal(r.mode, 'simulated');
  assert.ok(r.simulation && hasCJK(r.simulation.notice), '必须带中文模拟声明');
  assert.ok(r.simulation.notice.includes('SIMULATED'));
  assert.notEqual(r.status, 'succeeded');
});

test('未配置 transport:显式 not_configured,零外部调用,不预留预算', async () => {
  const ledger = createMemoryLedger({});
  const adapter = createModelAdapter({ ledger, timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest(), {});
  assert.equal(r.status, 'not_configured');
  assert.equal(r.mode, 'none');
  assert.equal(r.error.code, 'TRANSPORT_NOT_CONFIGURED');
  assert.ok(hasCJK(r.error.message));
  assert.equal(ledger.totals().occupiedTokens, 0);
});

test('模拟输出同样必须通过输出守门:引用悬空时 simulated 也判 failed', async () => {
  const ev = makeEvidence(1);
  const adapter = createModelAdapter({
    transport: createSimulatedTransport({
      script: (call) => ({
        findings: [{ id: 'F1', text: '【模拟】引用了不存在的证据。', evidenceRefs: [{ id: 'EV-777', version: 'v9', hash: 'zz' }] }],
        questions: [],
        evidenceRefs: [],
      }),
    }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'EVIDENCE_DANGLING');
});
