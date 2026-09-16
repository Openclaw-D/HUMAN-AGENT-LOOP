// V7 Lane C · 案例运行器：规则包 + 合成用例 + 注入 provider → 判断记录与预期比对。
// provider 经工厂注入（测试用 SIMULATION 桩；A/B 集成时可注入真实网关——接口同一）。
// 运行器不重试、不改写结果；比对基于 status/reason/providerPhase/providerCalls 四元组。
import { runModelJudgment } from './model-judgment.mjs';
import { calculateCashFlowCoverage } from './calculation-tool.mjs';
import { createMockProvider } from './mock-provider.mjs';

/**
 * 运行单个用例。
 * @param {object} rulePack
 * @param {object} caseDef cases-v1.json 的 case 条目
 * @param {{ createProvider?: (script:object) => { provider:Function, calls:Array } }} [deps] 依赖注入点
 * @returns {Promise<CaseRecord>}
 */
export async function runCase(rulePack, caseDef, deps = {}) {
  const facts = { factVersion: caseDef.factVersion, evidence: caseDef.evidence };
  const calc = calculateCashFlowCoverage(caseDef.calcInput);
  const script = caseDef.providerScript ?? null;
  const factory = deps.createProvider ?? ((s) => createMockProvider({ script: s }));
  const { provider, calls } = factory(script);

  const judgment = await runModelJudgment({ rulePack, facts, calc, provider, requestId: `${caseDef.caseId}-${Date.now()}` });

  const actual = {
    status: judgment.status,
    reason: judgment.reason,
    providerPhase: judgment.providerPhase,
    providerCalls: calls.length,
    calcOk: calc.ok === true,
    calcRefusalCode: calc.ok === true ? null : calc.error.code,
  };
  const expected = caseDef.expected;
  const diffs = [];
  for (const key of ['status', 'reason', 'providerPhase', 'providerCalls']) {
    if (actual[key] !== expected[key]) diffs.push(`${key}: 期望 ${JSON.stringify(expected[key])}，实际 ${JSON.stringify(actual[key])}`);
  }

  return {
    caseId: caseDef.caseId,
    category: caseDef.category,
    title: caseDef.title,
    pass: diffs.length === 0,
    diffs,
    expected,
    actual,
    checks: judgment.checks,
    requestId: judgment.requestId,
    requestReceipt: judgment.requestReceipt ?? null,
  };
}

/**
 * 运行整组用例。
 * @returns {Promise<{ caseSetId:string, version:string, ranAt:string, records:CaseRecord[], passed:number, failed:number }>}
 */
export async function runCaseSet(rulePack, caseSet, deps = {}) {
  const records = [];
  for (const c of caseSet.cases) {
    records.push(await runCase(rulePack, c, deps));
  }
  return {
    caseSetId: caseSet.caseSetId,
    version: caseSet.version,
    ranAt: new Date().toISOString(),
    records,
    passed: records.filter((r) => r.pass).length,
    failed: records.filter((r) => !r.pass).length,
  };
}
