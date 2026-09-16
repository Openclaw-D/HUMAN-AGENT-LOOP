// 协议断言套件:对"任意 buildAdapter(deps) 实现"运行十类协议场景,
// 返回违规列表。好实现必须零违规;刻意注入的坏实现(adversarial 测试)
// 必须在对应场景被抓。这保证测试抓的是行为契约,不是某个固定成功断言。
import { createMemoryLedger } from '../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, deferred } from './helpers.mjs';

const TIMEOUT = 5000;

function depsWith(transport, { ledger = createMemoryLedger({}), timeoutMs = TIMEOUT } = {}) {
  return { transport, ledger, timeoutMs };
}

export async function runProtocolSuite(buildAdapter) {
  const violations = [];
  const add = (scenario, rule, detail) => violations.push({ scenario, rule, detail: detail ?? null });

  // S1 正常路径:succeeded + 结构完整 + usage 已结算。
  {
    const ev = makeEvidence(1);
    let calls = 0;
    const ledger = createMemoryLedger({});
    const adapter = buildAdapter(depsWith(async () => {
      calls += 1;
      return { ok: true, output: goodOutput(ev), usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 } };
    }, { ledger }));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'succeeded' && r.status !== 'simulated') add('S1', '正常输出必须 succeeded(或 simulated)', { status: r.status, code: r.error && r.error.code });
    if (!Array.isArray(r.findings) || r.findings.length === 0) add('S1', 'findings 必须是非空数组', r.findings);
    if (!Array.isArray(r.questions)) add('S1', 'questions 必须是数组', r.questions);
    if (r.costLedger.reservationState !== 'committed') add('S1', 'usage 存在时必须按实际用量 committed', r.costLedger);
    if (calls !== 1) add('S1', '正常路径 transport 恰好调用一次', calls);
  }

  // S1b simulated 标记必须区分于 succeeded。
  {
    const ev = makeEvidence(1);
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, simulated: true, output: goodOutput(ev) })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'simulated') add('S1b', 'simulated:true 必须产生 simulated 状态,不得标 succeeded', { status: r.status });
  }

  // S2 空输出必须 failed,不得伪装成功。
  {
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } })));
    const r = await adapter.analyze(makeRequest(), {});
    if (r.status !== 'failed') add('S2', '空输出必须 failed', { status: r.status, code: r.error && r.error.code });
  }

  // S3 悬空引用必须 failed 且错误码为 EVIDENCE_DANGLING。
  {
    const ev = makeEvidence(1);
    const bad = goodOutput(ev);
    bad.findings[0].evidenceRefs = [{ id: 'EV-999', version: 'vX', hash: 'ff' }];
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: bad, usage: { totalTokens: 10 } })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'failed') add('S3', '悬空引用必须 failed', { status: r.status });
    if (r.error && r.error.code !== 'EVIDENCE_DANGLING') add('S3', '悬空引用错误码必须 EVIDENCE_DANGLING', r.error.code);
  }

  // S4 越权批准输出必须 failed/UNAUTHORIZED_OUTPUT。
  {
    const ev = makeEvidence(1);
    const out = goodOutput(ev, { findings: [{ id: 'F1', text: '审批通过,同意放款。', evidenceRefs: ev.map((r) => ({ ...r })) }] });
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: out })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'failed' || (r.error && r.error.code !== 'UNAUTHORIZED_OUTPUT')) {
      add('S4', '越权批准输出必须 failed/UNAUTHORIZED_OUTPUT', { status: r.status, code: r.error && r.error.code });
    }
  }

  // S5 非法角色必须 failed 且零外部调用。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: true, output: goodOutput([]) }; }));
    const r = await adapter.analyze(makeRequest({ role: 'boss' }), {});
    if (r.status !== 'failed' || (r.error && r.error.code !== 'UNKNOWN_ROLE')) add('S5', '非法角色必须 UNKNOWN_ROLE', { status: r.status, code: r.error && r.error.code });
    if (calls !== 0) add('S5', '非法角色不得发起外部调用', calls);
  }

  // S6 同ID变载荷必须 REQUEST_MISMATCH,且不得发起调用。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: true, output: goodOutput([]) }; }));
    await adapter.analyze(makeRequest(), {});
    const r2 = await adapter.analyze(makeRequest({ text: '【合成】同一 requestId,载荷被改过的文本' }), {});
    if (r2.status !== 'failed' || (r2.error && r2.error.code !== 'REQUEST_MISMATCH')) {
      add('S6', '同ID变载荷必须 REQUEST_MISMATCH', { status: r2.status, code: r2.error && r2.error.code });
    }
    if (calls !== 1) add('S6', '变载荷冲突不得发起新的外部调用', calls);
  }

  // S7 送出后取消必须 unknown,且账本保留预留(不释放、不清零)。
  {
    const d = deferred();
    const controller = new AbortController();
    const ledger = createMemoryLedger({});
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return d.promise; }, { ledger, timeoutMs: 30000 }));
    const p = adapter.analyze(makeRequest(), { signal: controller.signal });
    controller.abort();
    const r = await p;
    if (r.status !== 'unknown') add('S7', '送出后取消必须 unknown(不得标 cancelled/succeeded)', { status: r.status, code: r.error && r.error.code });
    if (ledger.totals().unknownHoldTokens <= 0) add('S7', '送出后取消必须保留预留(unknown_hold)', ledger.totals());
    if (calls !== 1) add('S7', '取消场景 transport 恰好调用一次', calls);
  }

  // S8 generation 推进后的在途结果必须 stale。
  {
    const d = deferred();
    let gen = 1;
    const adapter = buildAdapter(depsWith(async () => d.promise, { timeoutMs: 30000 }));
    const p = adapter.analyze(makeRequest({ generation: 1 }), { snapshot: () => ({ generation: gen, contextVersion: 'ctx-1', paused: false }) });
    gen = 2;
    d.resolve({ ok: true, output: goodOutput(makeEvidence(2)) });
    const r = await p;
    if (r.status !== 'stale') add('S8', 'generation 变化后在途结果必须 stale', { status: r.status, code: r.error && r.error.code });
  }

  // S9 indeterminate 必须 unknown,且未知状态禁止自动重试(transport 恰好一次)。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: 'indeterminate' }; }));
    const r = await adapter.analyze(makeRequest(), {});
    if (r.status !== 'unknown') add('S9', 'indeterminate 必须 unknown', { status: r.status });
    if (calls !== 1) add('S9', 'unknown 状态禁止自动重试:transport 必须恰好调用一次', calls);
  }

  // S10 缺 usage:必须 usageUnknown,保留预留;不得记 0、不得释放。
  {
    const ev = makeEvidence(1);
    const ledger = createMemoryLedger({});
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: goodOutput(ev) }), { ledger }));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    const t = ledger.totals();
    if (r.usageUnknown !== true) add('S10', '缺 usage 必须标 usageUnknown:true', r.usageUnknown);
    if (t.unknownHoldTokens <= 0) add('S10', '缺 usage 必须保留预留(unknown_hold>0)', t);
    if (r.usage !== null) add('S10', '未报告 usage 时结果不得伪造 usage', r.usage);
    if (r.costLedger.reservationState !== 'unknown_hold') add('S10', '账本状态必须 unknown_hold', r.costLedger);
  }

  return violations;
}
