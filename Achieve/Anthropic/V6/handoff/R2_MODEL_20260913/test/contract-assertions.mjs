// 协议断言套件:对"任意 buildAdapter(deps) 实现"运行 S1–S14 十四类协议场景,
// 返回违规列表。好实现必须零违规;刻意注入的坏实现(adversarial 测试)
// 必须在对应场景被抓。这保证测试抓的是行为契约,不是某个固定成功断言。
// R2 新增(INTERFACE_R2 §5):S11 容量淘汰 / S12 缓存复核 / S13 明确背压 / S14 unknown 不缓存。
// S11/S13 通过 deps.maxEntries 构造小容量 registry(要求 createModelAdapter 透传 maxEntries)。
import { createMemoryLedger } from '../src/ledger.mjs';
import { makeEvidence, makeRequest, goodOutput, deferred } from './helpers.mjs';

const TIMEOUT = 5000;

function depsWith(transport, { ledger = createMemoryLedger({}), timeoutMs = TIMEOUT, ...extraDeps } = {}) {
  return { transport, ledger, timeoutMs, ...extraDeps };
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
    // 审计补强:首次调用不得虚报去重标记(防"无条件 deduped:true"逃逸)
    if (r.deduped !== false) add('S1', '首次调用 deduped 必须为 false,不得虚报去重', r.deduped);
  }

  // S1b simulated 标记必须区分于 succeeded,且显著声明不得缺失(审计补强:只断言状态字符串会被"删标记"坏实现逃逸)。
  {
    const ev = makeEvidence(1);
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, simulated: true, output: goodOutput(ev) })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'simulated') add('S1b', 'simulated:true 必须产生 simulated 状态,不得标 succeeded', { status: r.status });
    if (r.mode !== 'simulated') add('S1b', 'simulated 结果 mode 必须显式为 simulated', r.mode);
    const notice = r.simulation && r.simulation.notice;
    if (typeof notice !== 'string' || !notice.includes('SIMULATED')) {
      add('S1b', 'simulated 结果必须携带含 SIMULATED 字样的显著中文声明,不得删除', r.simulation);
    }
  }

  // S2 空输出必须 failed,不得伪装成功。
  {
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } })));
    const r = await adapter.analyze(makeRequest(), {});
    if (r.status !== 'failed') add('S2', '空输出必须 failed', { status: r.status, code: r.error && r.error.code });
  }

  // 辅助:无守卫式错误码断言——error 缺失/null 直接判违规(审计补强:守卫式 `r.error && ...`
  // 会被"failed 但 error 置 null"的坏实现绕过)。
  const expectErrorCode = (r, code, scenario, rule) => {
    if (!r.error || r.error.code !== code) add(scenario, rule, { status: r.status, error: r.error });
  };

  // S3 悬空引用必须 failed 且错误码为 EVIDENCE_DANGLING。
  {
    const ev = makeEvidence(1);
    const bad = goodOutput(ev);
    bad.findings[0].evidenceRefs = [{ id: 'EV-999', version: 'vX', hash: 'ff' }];
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: bad, usage: { totalTokens: 10 } })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'failed') add('S3', '悬空引用必须 failed', { status: r.status });
    expectErrorCode(r, 'EVIDENCE_DANGLING', 'S3', '悬空引用错误码必须 EVIDENCE_DANGLING,且 error 不得为空');
  }

  // S4 越权批准输出必须 failed/UNAUTHORIZED_OUTPUT。
  {
    const ev = makeEvidence(1);
    const out = goodOutput(ev, { findings: [{ id: 'F1', text: '审批通过,同意放款。', evidenceRefs: ev.map((r) => ({ ...r })) }] });
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: out })));
    const r = await adapter.analyze(makeRequest({}, { evidence: ev }), {});
    if (r.status !== 'failed') add('S4', '越权批准输出必须 failed', { status: r.status });
    expectErrorCode(r, 'UNAUTHORIZED_OUTPUT', 'S4', '越权批准错误码必须 UNAUTHORIZED_OUTPUT,且 error 不得为空');
  }

  // S5 非法角色必须 failed 且零外部调用。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: true, output: goodOutput([]) }; }));
    const r = await adapter.analyze(makeRequest({ role: 'boss' }), {});
    if (r.status !== 'failed') add('S5', '非法角色必须 failed', { status: r.status });
    expectErrorCode(r, 'UNKNOWN_ROLE', 'S5', '非法角色必须 UNKNOWN_ROLE,且 error 不得为空');
    if (calls !== 0) add('S5', '非法角色不得发起外部调用', calls);
  }

  // S6 同ID变载荷必须 REQUEST_MISMATCH,且不得发起调用。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: true, output: goodOutput([]) }; }));
    await adapter.analyze(makeRequest(), {});
    const r2 = await adapter.analyze(makeRequest({ text: '【合成】同一 requestId,载荷被改过的文本' }), {});
    if (r2.status !== 'failed') add('S6', '同ID变载荷必须 failed', { status: r2.status });
    expectErrorCode(r2, 'REQUEST_MISMATCH', 'S6', '同ID变载荷必须 REQUEST_MISMATCH,且 error 不得为空');
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
    // 审计补强:stale 必须显式错误码,且结果数据保留供人工核对(清空数据 = 逃逸"留痕"契约)
    if (!r.error || r.error.code !== 'GENERATION_CHANGED') add('S8', 'stale 必须携带 GENERATION_CHANGED 错误码且 error 非空', r.error);
    if (!Array.isArray(r.findings) || r.findings.length === 0) add('S8', 'stale 结果必须保留 findings 数据供人工核对,不得清空', r.findings);
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

  // S11 容量淘汰(INTERFACE_R2 §5):maxEntries=2 下在途条目零淘汰,同ID并发 transport 恰 1。
  // a 在途(慢 transport)期间顺序发起 b、c(快速完成);b/c 完成后 a 同ID同载荷仍 join
  // (transport 对 a 恰好 1 次),a 同ID变载荷 → REQUEST_MISMATCH。
  // 依赖 createModelAdapter 把 deps.maxEntries 透传给 RequestRegistry(INTERFACE_R2 §2.0)。
  {
    const ev = makeEvidence(2);
    const calls = { a: 0, b: 0, c: 0, other: 0 };
    const slowA = deferred();
    const fastOk = (tokens) => ({ ok: true, output: goodOutput(ev), usage: { totalTokens: tokens } });
    const adapter = buildAdapter(depsWith(async (call) => {
      if (call.requestId === 'cap-S11-a') { calls.a += 1; return slowA.promise; }
      if (call.requestId === 'cap-S11-b') { calls.b += 1; return fastOk(5); }
      if (call.requestId === 'cap-S11-c') { calls.c += 1; return fastOk(6); }
      calls.other += 1;
      return fastOk(1);
    }, { maxEntries: 2 }));

    const pa = adapter.analyze(makeRequest({ requestId: 'cap-S11-a' }, { evidence: ev }), {});
    const rb = await adapter.analyze(makeRequest({ requestId: 'cap-S11-b', text: '【合成】S11 载荷 b' }, { evidence: ev }), {});
    const rc = await adapter.analyze(makeRequest({ requestId: 'cap-S11-c', text: '【合成】S11 载荷 c' }, { evidence: ev }), {});
    if (rb.status !== 'succeeded' && rb.status !== 'simulated') {
      add('S11', '容量压力下 b 必须成功完成(容量策略不得拒绝可登记请求)', { status: rb.status, code: rb.error && rb.error.code });
    }
    if (rc.status !== 'succeeded' && rc.status !== 'simulated') {
      add('S11', '容量压力下 c 必须成功完成(应淘汰可安全终结条目腾位,而不是拒绝或淘汰在途)', { status: rc.status, code: rc.error && rc.error.code });
    }
    slowA.resolve({ ok: true, output: goodOutput(ev), usage: { totalTokens: 9 } });
    const ra = await pa;
    if (ra.status !== 'succeeded' && ra.status !== 'simulated') {
      add('S11', '在途请求 a 必须正常完成(在途条目不得被容量淘汰)', { status: ra.status, code: ra.error && ra.error.code });
    }
    // a 完成后同ID同载荷再次调用:必须命中同一 transport 调用(条目未被淘汰)。
    const ra2 = await adapter.analyze(makeRequest({ requestId: 'cap-S11-a' }, { evidence: ev }), {});
    if (calls.a !== 1) {
      add('S11', '在途/已缓存条目不得被容量淘汰:同ID同载荷必须 join 或命中缓存,transport 对 a 恰好 1 次', calls);
    }
    if ((ra2.status !== 'succeeded' && ra2.status !== 'simulated') || ra2.deduped !== true) {
      add('S11', '同ID同载荷复用必须 succeeded/simulated 且 deduped:true', { status: ra2.status, deduped: ra2.deduped });
    }
    // 同ID变载荷必须 mismatch:载荷指纹不得随条目淘汰丢失。
    const ra3 = await adapter.analyze(makeRequest({ requestId: 'cap-S11-a', text: '【合成】S11 同ID变载荷' }, { evidence: ev }), {});
    if (ra3.status !== 'failed' || (ra3.error && ra3.error.code) !== 'REQUEST_MISMATCH') {
      add('S11', '同ID变载荷必须 REQUEST_MISMATCH(指纹不得因淘汰丢失)', { status: ra3.status, code: ra3.error && ra3.error.code });
    }
  }

  // S12 缓存复核(INTERFACE_R2 §2.2/§5):成功结果缓存后,快照未变时再调用仍 succeeded+deduped;
  // 快照推进 generation 后同ID同载荷再调用必须 stale(不得以 succeeded 呈现旧结果)。
  {
    const ev = makeEvidence(1);
    let gen = 1;
    const snapshot = () => ({ generation: gen, contextVersion: 'ctx-1', paused: false });
    const adapter = buildAdapter(depsWith(async () => ({ ok: true, output: goodOutput(ev), usage: { totalTokens: 7 } })));
    const req = makeRequest({ requestId: 'cache-S12' }, { evidence: ev });
    const r1 = await adapter.analyze(req, { snapshot });
    if (r1.status !== 'succeeded' && r1.status !== 'simulated') {
      add('S12', '首次调用必须成功完成', { status: r1.status, code: r1.error && r1.error.code });
    }
    // 快照未变:第二次调用必须缓存命中(succeeded + deduped:true),不得误判 stale。
    const r2 = await adapter.analyze(req, { snapshot });
    if (r2.status !== 'succeeded' && r2.status !== 'simulated') {
      add('S12', '快照未变时缓存命中必须 succeeded(不得误判 stale)', { status: r2.status, code: r2.error && r2.error.code });
    }
    if (r2.deduped !== true) add('S12', '快照未变时缓存命中必须 deduped:true', r2.deduped);
    // 快照推进 generation:同ID同载荷再调用必须 stale + GENERATION_CHANGED + deduped:true。
    gen = 2;
    const r3 = await adapter.analyze(req, { snapshot });
    if (r3.status !== 'stale') {
      add('S12', '快照推进后缓存命中必须 stale,不得以 succeeded 呈现旧结果', { status: r3.status, code: r3.error && r3.error.code });
    } else {
      if (r3.deduped !== true) add('S12', '缓存复核产生的 stale 必须 deduped:true', r3.deduped);
      if (!r3.error || r3.error.code !== 'GENERATION_CHANGED') {
        add('S12', '缓存复核 stale 必须携带 GENERATION_CHANGED 且 error 非空(审计补强)', r3.error);
      }
      // 审计补强:缓存复核产生的 stale 同样必须保留结果数据供人工核对
      if (!Array.isArray(r3.findings) || r3.findings.length === 0) add('S12', '缓存复核 stale 必须保留 findings 数据,不得清空', r3.findings);
    }
  }

  // S13 明确背压(INTERFACE_R2 §1/§5):maxEntries=2,两个永久 in-flight 占满容量,
  // 第三个新请求 → failed/REGISTRY_AT_CAPACITY 且 transport 计数不增;任一在飞完成后重试成功。
  {
    const ev = makeEvidence(1);
    let calls = 0;
    const slowA = deferred();
    const slowB = deferred();
    const adapter = buildAdapter(depsWith(async (call) => {
      calls += 1;
      if (call.requestId === 'cap-S13-a') return slowA.promise;
      if (call.requestId === 'cap-S13-b') return slowB.promise;
      return { ok: true, output: goodOutput(ev), usage: { totalTokens: 3 } };
    }, { maxEntries: 2 }));

    const pa = adapter.analyze(makeRequest({ requestId: 'cap-S13-a' }, { evidence: ev }), {});
    const pb = adapter.analyze(makeRequest({ requestId: 'cap-S13-b', text: '【合成】S13 载荷 b' }, { evidence: ev }), {});
    const reqC = () => makeRequest({ requestId: 'cap-S13-c', text: '【合成】S13 载荷 c' }, { evidence: ev });
    const rc = await adapter.analyze(reqC(), {});
    if (rc.status !== 'failed' || (rc.error && rc.error.code) !== 'REGISTRY_AT_CAPACITY') {
      add('S13', '容量满且无可安全淘汰条目必须明确背压 failed/REGISTRY_AT_CAPACITY', { status: rc.status, code: rc.error && rc.error.code });
    }
    if (calls !== 2) add('S13', '背压请求不得调用 transport(计数不增)', calls);

    // 任一在飞完成后:原请求成功,容量释放,第三个请求重试成功。
    slowA.resolve({ ok: true, output: goodOutput(ev), usage: { totalTokens: 4 } });
    const ra = await pa;
    if (ra.status !== 'succeeded' && ra.status !== 'simulated') {
      add('S13', '在飞请求完成后必须正常成功', { status: ra.status, code: ra.error && ra.error.code });
    }
    const rc2 = await adapter.analyze(reqC(), {});
    if (rc2.status !== 'succeeded' && rc2.status !== 'simulated') {
      add('S13', '容量释放后重试必须成功(不得在仍有可淘汰条目时持续背压)', { status: rc2.status, code: rc2.error && rc2.error.code });
    }
    slowB.resolve({ ok: true, output: goodOutput(ev), usage: { totalTokens: 4 } });
    await pb; // 收尾:不留悬挂在途(清理用,不断言)
  }

  // S14 unknown 不缓存(R1 语义回归保护):indeterminate 后同ID同载荷重试必须产生
  // 新的完整 transport 调用(恰好 2 次),不得把 unknown 结果当确定性结果缓存。
  {
    let calls = 0;
    const adapter = buildAdapter(depsWith(async () => { calls += 1; return { ok: 'indeterminate' }; }));
    const req = makeRequest({ requestId: 'unk-S14' }, {});
    const r1 = await adapter.analyze(req, {});
    const r2 = await adapter.analyze(req, {});
    if (r1.status !== 'unknown' || r2.status !== 'unknown') {
      add('S14', 'indeterminate 两次调用都必须 unknown', { s1: r1.status, s2: r2.status });
    }
    if (calls !== 2) add('S14', 'unknown 结果不得缓存:同ID同载荷重试必须产生新的完整 transport 调用(恰好 2 次)', calls);
  }

  return violations;
}
