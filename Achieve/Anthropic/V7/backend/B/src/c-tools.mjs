// V7-B ⇄ C 集成:C 路 calculation-tool 的 ToolsPort 适配(只读 import C 交付,不改 C 原件)。
// C 接口(来自 C/src/calculation-tool.mjs 源码对账;C/INTERFACES.md 尚未发布,发布后复核):
//   calculateCashFlowCoverage(input) → { ok:true, result:{ toolVersion, formulaVersion, formula,
//     currency, period, ratio, unit, inputs, assumptions, inputHash, numericPrecision } }
//                                    | { ok:false, error:{ code, field, message, toolVersion } }
// B 侧语义映射:
//   ok            → 步 succeeded + 候选片段(纯计算,authority=none)
//   MISSING_INPUT / MISSING_CALIBER → 步 waiting_evidence(缺输入/口径,不得补造数值)
//   INVALID_CURRENCY / NONPOSITIVE_DEBT_SERVICE / INVALID_PERIOD → 步 waiting_evidence
//     (输入质量问题须人工修正证据,不是编排失败;如实记录错误码)
//   未知 toolName → 步 failed(编排配置错误)

// 注入方式(调用方/A assembly 决定加载路径,B 不静态 import C 原件):
//   import { calculateCashFlowCoverage } from '../../C/src/calculation-tool.mjs';
//   const tools = createCToolsAdapter({ calculationTool: { calculateCashFlowCoverage } });

const WAITING_CODES = new Set([
  'MISSING_INPUT', 'MISSING_CALIBER', 'INVALID_CURRENCY',
  'NONPOSITIVE_DEBT_SERVICE', 'INVALID_PERIOD', 'CALIBER_MISMATCH',
]);

const C_TOOL_ID = 'calc:cash-flow-coverage'; // 与 C/src/calculation-tool.mjs TOOL_ID 一致(2026-09-15 对账)

export function createCToolsAdapter({ calculationTool }) {
  if (typeof calculationTool?.calculateCashFlowCoverage !== 'function') {
    throw new Error('C 工具适配:注入模块缺少 calculateCashFlowCoverage(C/src/calculation-tool.mjs)');
  }
  return {
    cToolId: C_TOOL_ID,
    async calculate({ toolName, inputs }) {
      if (toolName !== C_TOOL_ID) {
        return { ok: false, code: 'UNKNOWN_TOOL', messageZh: `未知工具 ${toolName}(本适配只提供 ${C_TOOL_ID})` };
      }
      const r = await calculationTool.calculateCashFlowCoverage(inputs);
      if (r.ok) {
        return {
          ok: true,
          toolVersion: r.result.toolVersion,
          inputHash: r.result.inputHash,
          output: {
            ratio: r.result.ratio,
            unit: r.result.unit,
            formulaVersion: r.result.formulaVersion,
            formula: r.result.formula,
            currency: r.result.currency,
            period: r.result.period,
            numericPrecision: r.result.numericPrecision,
          },
          assumptions: r.result.assumptions,
        };
      }
      const code = r.error?.code ?? 'UNKNOWN_ERROR';
      if (WAITING_CODES.has(code)) {
        return { ok: false, code, messageZh: `${r.error.message}(工具 ${r.error.toolVersion});输入不得补造,需人工补充或修正证据`, field: r.error.field };
      }
      return { ok: false, code, messageZh: r.error?.message ?? '计算工具未知错误' };
    },
  };
}
