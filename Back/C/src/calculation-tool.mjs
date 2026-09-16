// V7 Lane C · 可验证计算工具：现金流覆盖（合成场景，无行业审批含义）。
// 设计约束（LONG_RUN_GOALS §C）：
// - 输入必须带：数值、币种、期间、口径（caliber）、来源（evidenceId+version）；缺口径不得补造。
// - 输出确定可重放：ratio、unit、formulaVersion、toolVersion、assumptions、inputHash；同输入同 hash。
// - 结果仅是计算：不含批准/拒绝/额度/定价等风险结论。
// - 显式结构化拒绝：MISSING_INPUT / INVALID_CURRENCY / NONPOSITIVE_DEBT_SERVICE / MISSING_CALIBER /
//   CALIBER_MISMATCH / INVALID_PERIOD —— 绝不默认值兜底。
// 零依赖（node:crypto）；provider/存储无关；A 集成时映射到 ExperimentRecord.calculation。
import { createHash } from 'node:crypto';

export const TOOL_ID = 'calc:cash-flow-coverage';
export const TOOL_VERSION = `${TOOL_ID}@1`;
export const FORMULA_VERSION = 'cf-coverage-div@1';

/** 币种白名单（与 rule-pack scope.currencyAllowList 一致；此处自包含便于独立调用）。 */
const CURRENCY_ALLOW = new Set(['CNY', 'USD']);

/** 期间上限（月）。 */
const PERIOD = { unit: 'month', min: 1, max: 36 };

/**
 * 计算现金流覆盖率。
 * @param {object} input
 * @param {{ value:number, caliber:string, source:{ evidenceId:string, version:number } }} input.monthlyOperatingCashFlow 月度经营现金流（币种主单位/月）
 * @param {{ value:number, caliber:string, source:{ evidenceId:string, version:number } }} input.monthlyDebtService 月度债务偿付（同上；必须为正）
 * @param {string} input.currency 币种（CNY|USD）；两输入必须同币种
 * @param {number} [input.periodMonths=1] 覆盖期间（月，1..36）
 * @returns {{ ok:true, result: CalculationResult } | { ok:false, error: CalculationError }}
 */
export function calculateCashFlowCoverage(input) {
  const missing = [];
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: err('MISSING_INPUT', 'input', '输入对象缺失') };
  }
  for (const key of ['monthlyOperatingCashFlow', 'monthlyDebtService']) {
    if (input[key] === undefined || input[key] === null) missing.push(key);
  }
  if (input.currency === undefined || input.currency === null || input.currency === '') missing.push('currency');
  if (missing.length > 0) {
    return { ok: false, error: err('MISSING_INPUT', missing.join(','), `缺少必填输入：${missing.join('、')}`) };
  }

  if (!CURRENCY_ALLOW.has(input.currency)) {
    return { ok: false, error: err('INVALID_CURRENCY', 'currency', `不支持的币种：${String(input.currency)}（允许：${[...CURRENCY_ALLOW].join('/')}）`) };
  }
  const periodMonths = input.periodMonths === undefined ? 1 : input.periodMonths;
  if (!Number.isInteger(periodMonths) || periodMonths < PERIOD.min || periodMonths > PERIOD.max) {
    return { ok: false, error: err('INVALID_PERIOD', 'periodMonths', `期间必须为 ${PERIOD.min}..${PERIOD.max} 的整数月`) };
  }

  const checks = [];
  for (const key of ['monthlyOperatingCashFlow', 'monthlyDebtService']) {
    const v = input[key];
    checks.push(checkNamedNumber(key, v));
  }
  const bad = checks.find((c) => c !== null);
  if (bad !== undefined) return { ok: false, error: bad };

  const op = input.monthlyOperatingCashFlow;
  const ds = input.monthlyDebtService;
  if (!(ds.value > 0)) {
    return { ok: false, error: err('NONPOSITIVE_DEBT_SERVICE', 'monthlyDebtService', '月度债务偿付必须为正数（否则覆盖率无定义）') };
  }

  const assumptions = [];
  if (op.currency !== undefined && op.currency !== input.currency) {
    return { ok: false, error: err('INVALID_CURRENCY', 'monthlyOperatingCashFlow.currency', '输入币种与声明币种不一致') };
  }
  // 口径：两输入各自必须声明；口径不同属合法（分子分母口径本可不同），但必须留假设，
  // 且由调用方/规则层决定是否触发 caliber_change 升级——工具不替规则做判断。
  assumptions.push(`分子口径：${op.caliber}`);
  assumptions.push(`分母口径：${ds.caliber}`);
  if (op.caliber === ds.caliber) assumptions.push('分子分母口径相同：比率可直接解释为同口径覆盖倍数。');
  else assumptions.push('分子分母口径不同：比率含义取决于口径差异，不得作为同口径结论引用。');
  assumptions.push(`期间：${periodMonths} 个月；输入为月度值，本工具不做跨期折算或年化。`);
  if (op.value < 0) assumptions.push('分子为负：结果为负值，仅表示当期经营现金流为负的算术事实。');

  // 确定性：ratio 保留 12 位小数（IEEE754 内部全精度计算后定点化），同输入恒同输出。
  const ratio = Number((op.value / ds.value).toFixed(12));

  const canonical = canonicalJson({
    tool: TOOL_VERSION,
    formula: FORMULA_VERSION,
    currency: input.currency,
    periodMonths,
    monthlyOperatingCashFlow: op,
    monthlyDebtService: ds,
  });
  const inputHash = createHash('sha256').update(canonical).digest('hex');

  return {
    ok: true,
    result: {
      toolVersion: TOOL_VERSION,
      formulaVersion: FORMULA_VERSION,
      formula: 'ratio = monthlyOperatingCashFlow.value / monthlyDebtService.value',
      currency: input.currency,
      period: { unit: PERIOD.unit, months: periodMonths },
      ratio,
      unit: 'dimensionless',
      inputs: {
        monthlyOperatingCashFlow: { value: op.value, caliber: op.caliber, source: op.source },
        monthlyDebtService: { value: ds.value, caliber: ds.caliber, source: ds.source },
      },
      assumptions,
      inputHash,
      numericPrecision: { rounding: 'decimal-12', replayTolerance: 0 },
    },
  };
}

/** 数值项校验：value 必须有限数字；caliber 非空；source 必须带 evidenceId+version。 */
function checkNamedNumber(key, v) {
  if (typeof v !== 'object' || v === null) return err('MISSING_INPUT', key, `${key} 必须为 { value, caliber, source } 对象`);
  if (typeof v.value !== 'number' || !Number.isFinite(v.value)) return err('MISSING_INPUT', `${key}.value`, `${key}.value 缺失或非有限数值（不得补造）`);
  if (typeof v.caliber !== 'string' || v.caliber.trim() === '') return err('MISSING_CALIBER', `${key}.caliber`, `${key} 未声明口径（缺口径不得计算）`);
  const src = v.source;
  if (typeof src !== 'object' || src === null || typeof src.evidenceId !== 'string' || src.evidenceId === '' || !Number.isInteger(src.version)) {
    return err('MISSING_INPUT', `${key}.source`, `${key}.source 必须为 { evidenceId, version }（输入来源可追溯）`);
  }
  return null;
}

function err(code, field, message) {
  return { code, field, message, toolVersion: TOOL_VERSION };
}

/** 稳定规范化 JSON（键排序；不含 undefined），保证 inputHash 可重放。 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
