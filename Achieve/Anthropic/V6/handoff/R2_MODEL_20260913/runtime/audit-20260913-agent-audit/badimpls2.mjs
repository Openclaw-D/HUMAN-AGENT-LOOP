// AUDIT 探针(第二轮):针对疑似"最弱断言"的定向坏实现,验证套件是否真的抓不住。
import { runProtocolSuite } from '../../test/contract-assertions.mjs';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';

function report(id, desc, violations) {
  console.log(JSON.stringify({
    id, desc,
    violationCount: violations.length,
    caughtBy: [...new Set(violations.map((v) => v.scenario))],
  }));
}

// BAD-6:simulated 保留 status 字符串,但删除 simulation.notice 与 mode='simulated'
// (契约:模拟结果"必须显著标记")。S1b 只断言 status==='simulated'。
function buildBad6(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      if (r.status === 'simulated') return { ...r, simulation: null, mode: r.mode === 'simulated' ? 'custom' : r.mode };
      return r;
    },
  };
}

// BAD-7:stale 保留状态与错误码,但清空 findings/evidenceRefs
// (契约:stale"保留数据供人工核对")。S8/S12 只断言 status/code/deduped。
function buildBad7(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      if (r.status === 'stale') return { ...r, findings: [], questions: [], evidenceRefs: [] };
      return r;
    },
  };
}

// BAD-8(对照):failed 但 error 置 null —— 检验 `r.error &&` 守卫式错误码断言是否可被绕过
// (status 断言仍应抓住,预期 caught 非空,验证逃逸只发生在错误码层面)。
function buildBad8(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      if (r.status === 'failed') return { ...r, error: null };
      return r;
    },
  };
}

for (const [id, desc, build] of [
  ['AUDIT-BAD-6', 'simulated 删显著标记(仅留 status 字符串)', buildBad6],
  ['AUDIT-BAD-7', 'stale 清空保留数据(status/code 不变)', buildBad7],
  ['AUDIT-BAD-8', 'failed 结果 error 置 null(错误码断言守卫式绕过)', buildBad8],
]) {
  report(id, desc, await runProtocolSuite(build));
}
