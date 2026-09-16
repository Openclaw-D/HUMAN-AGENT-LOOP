// AUDIT 独立复演(Agent-AUDIT,2026-09-13):构造交付方未写的坏实现,
// 喂给 runProtocolSuite,验证协议套件能否抓住。
// 只读交付源码;本文件及其输出仅存在于 runtime/audit-20260913-agent-audit/。
import { runProtocolSuite } from '../../test/contract-assertions.mjs';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, deferred } from '../../test/helpers.mjs';

function report(id, desc, violations) {
  const caughtBy = [...new Set(violations.map((v) => v.scenario))];
  console.log(JSON.stringify({
    id,
    desc,
    violationCount: violations.length,
    caughtBy,
    violations: violations.slice(0, 6),
  }));
}

const TIMEOUT = 5000;
function depsWith(transport, { ledger = createMemoryLedger({}), timeoutMs = TIMEOUT, ...extra } = {}) {
  return { transport, ledger, timeoutMs, ...extra };
}

// ---------------------------------------------------------------- BAD-1
// 广谱 stale 改标 succeeded:不限 deduped(比交付方 wrapper-G 更广,
// 覆盖在飞 join 与首跑返回的 stale)。模拟"旧结果一律冒充现行"。
function buildBad1(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      if (r.status === 'stale') return { ...r, status: 'succeeded', error: null };
      return r;
    },
  };
}

// ---------------------------------------------------------------- BAD-2
// 污染账本:holdUnknown(外部调用可能已发生、usage 未知)被偷换成 commit 0
// —— 即"预算未知释放 0"(R1 缺陷类,STATUS.md 第2条)。与交付方 wrapper-F 不同:
// wrapper-F 在结果层包装后主动调 ledger.commit;本例直接给 deps 注入说谎的账本实现,
// 适配器与结果字段完全"正常",只有账本侧说谎。
function poisonLedger(ledger) {
  return {
    ...ledger,
    holdUnknown: ({ reservationId, note }) =>
      ledger.commit({ reservationId, usageTokens: 0, note: `DEFECT:${note || 'UNKNOWN_RELEASED'}` }),
  };
}
function buildBad2(deps) {
  return createModelAdapter({ ...deps, ledger: poisonLedger(deps.ledger || createMemoryLedger({})) });
}

// ---------------------------------------------------------------- BAD-3
// 探针(预期逃逸):无条件 deduped:true。套件从未断言"新调用 deduped 必须 false",
// 若实现层虚报去重(让业务层误以为未发生外部调用),S1–S14 是否能抓?
function buildBad3(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      return { ...r, deduped: true };
    },
  };
}

// ---------------------------------------------------------------- BAD-4
// unknown 谎称 failed:实现层嫌 unknown 状态难处理,把"结果不可知"改标为
// 确定失败(TIMEOUT)。违反七状态显式区分契约(unknown ≠ failed)。
function buildBad4(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const r = await adapter.analyze(req, ctx);
      if (r.status === 'unknown') {
        return { ...r, status: 'failed', error: { code: 'TIMEOUT', message: 'DEFECT: unknown 被谎报为确定失败' } };
      }
      return r;
    },
  };
}

// ---------------------------------------------------------------- BAD-5
// 探针(预期逃逸或被抓待验证):在飞 join/缓存命中复核被 wrapper 侧"冻结快照"绕过
// ——给内层适配器注入恒等快照,使 stalenessOf 永远判定未变化。
// 与 mutant-D(源码短路)不同路径:这是从 context 注入面说谎。
function buildBad5(deps) {
  const adapter = createModelAdapter(deps);
  return {
    ...adapter,
    analyze: async (req, ctx) => {
      const frozen = () => ({ generation: req.generation, contextVersion: req.contextVersion, paused: false });
      const r = await adapter.analyze(req, { ...ctx, snapshot: frozen });
      return r;
    },
  };
}

const drivers = [
  ['AUDIT-BAD-1', '广谱 stale 改标 succeeded(不限 deduped,含在飞/首跑 stale)', buildBad1],
  ['AUDIT-BAD-2', '账本 holdUnknown 偷换为 commit 0(预算未知释放,账本层说谎)', buildBad2],
  ['AUDIT-BAD-3', '探针:无条件虚报 deduped:true(虚报去重,套件无负向断言)', buildBad3],
  ['AUDIT-BAD-4', 'unknown 谎称 failed(破坏七状态显式区分)', buildBad4],
  ['AUDIT-BAD-5', '探针:context.snapshot 恒等伪造(冻结快照绕过复核)', buildBad5],
];

for (const [id, desc, build] of drivers) {
  const violations = await runProtocolSuite(build);
  report(id, desc, violations);
}

// ---------------------------------------------------------------- 对照:好实现零违规(独立复跑)
const goodViolations = await runProtocolSuite((deps) => createModelAdapter(deps));
report('GOOD-IMPL', '对照:未变异好实现必须零违规', goodViolations);
