// V7 backend-next Lane C · 通用确定性比值工具（行业无关；供订单集中度/价格基准等使用）。
// 与 calculation-tool.mjs 同一纪律：
// - 输入必须带：数值、口径（caliber）、来源（evidenceId+version）；缺口径不得补造。
// - 输出确定可重放：ratio、formulaVersion、toolVersion、assumptions、inputHash；同输入同 hash。
// - 结果仅是计算：不含批准/拒绝/额度/定价等风险结论；authority=none。
// - 显式结构化拒绝；绝不默认值兜底。
// 零依赖（node:crypto）。
import { createHash } from 'node:crypto';

export const RATIO_TOOL_ID = 'calc:ratio';
export const RATIO_TOOL_VERSION = `${RATIO_TOOL_ID}@1`;
export const RATIO_FORMULA_VERSION = 'named-ratio-div@1';

/**
 * 计算两个具名数的比值 ratio = numerator.value / denominator.value。
 * @param {object} input
 * @param {{ value:number, caliber:string, source:{evidenceId:string, version:number} }} input.numerator
 * @param {{ value:number, caliber:string, source:{evidenceId:string, version:number} }} input.denominator （必须为正）
 * @param {string} [input.label] 指标名（如 order_concentration / price_benchmark），仅进入输出与 hash
 * @param {string} [input.currency] 可选；两侧若都声明必须一致
 * @returns {{ ok:true, result:object } | { ok:false, error:object }}
 */
export function calculateRatio(input) {
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: rerr('MISSING_INPUT', 'input', '输入对象缺失') };
  }
  const missing = [];
  for (const key of ['numerator', 'denominator']) {
    if (input[key] === undefined || input[key] === null) missing.push(key);
  }
  if (missing.length > 0) {
    return { ok: false, error: rerr('MISSING_INPUT', missing.join(','), `缺少必填输入：${missing.join('、')}`) };
  }

  for (const key of ['numerator', 'denominator']) {
    const bad = checkNamedNumber(key, input[key]);
    if (bad !== null) return { ok: false, error: bad };
  }
  if (!(input.denominator.value > 0)) {
    return { ok: false, error: rerr('NONPOSITIVE_DENOMINATOR', 'denominator', '分母必须为正数（否则比值无定义）') };
  }
  if (input.currency !== undefined) {
    if (typeof input.currency !== 'string' || input.currency.trim() === '') {
      return { ok: false, error: rerr('INVALID_CURRENCY', 'currency', 'currency 声明后不得为空') };
    }
    for (const key of ['numerator', 'denominator']) {
      const cur = input[key].currency;
      if (cur !== undefined && cur !== input.currency) {
        return { ok: false, error: rerr('INVALID_CURRENCY', `${key}.currency`, `${key} 币种与声明币种不一致`) };
      }
    }
  }

  const { numerator, denominator } = input;
  const label = typeof input.label === 'string' && input.label.trim() !== '' ? input.label : 'unnamed_ratio';
  const assumptions = [
    `分子口径：${numerator.caliber}`,
    `分母口径：${denominator.caliber}`,
    numerator.caliber === denominator.caliber
      ? '分子分母口径相同：比率可直接解释为同口径比值。'
      : '分子分母口径不同：比率含义取决于口径差异，不得作为同口径结论引用。',
    '本工具只做除法，不做期间折算、加权或年化。',
  ];

  const ratio = Number((numerator.value / denominator.value).toFixed(12));
  const canonical = canonicalJson({
    tool: RATIO_TOOL_VERSION,
    formula: RATIO_FORMULA_VERSION,
    label,
    currency: input.currency,
    numerator,
    denominator,
  });
  const inputHash = createHash('sha256').update(canonical).digest('hex');

  return {
    ok: true,
    result: {
      toolVersion: RATIO_TOOL_VERSION,
      formulaVersion: RATIO_FORMULA_VERSION,
      formula: 'ratio = numerator.value / denominator.value',
      label,
      currency: input.currency ?? null,
      ratio,
      unit: 'dimensionless',
      inputs: {
        numerator: { value: numerator.value, caliber: numerator.caliber, source: numerator.source },
        denominator: { value: denominator.value, caliber: denominator.caliber, source: denominator.source },
      },
      assumptions,
      inputHash,
      numericPrecision: { rounding: 'decimal-12', replayTolerance: 0 },
    },
  };
}

function checkNamedNumber(key, v) {
  if (typeof v !== 'object' || v === null) return rerr('MISSING_INPUT', key, `${key} 必须为 { value, caliber, source } 对象`);
  if (typeof v.value !== 'number' || !Number.isFinite(v.value)) return rerr('MISSING_INPUT', `${key}.value`, `${key}.value 缺失或非有限数值（不得补造）`);
  if (typeof v.caliber !== 'string' || v.caliber.trim() === '') return rerr('MISSING_CALIBER', `${key}.caliber`, `${key} 未声明口径（缺口径不得计算）`);
  const src = v.source;
  if (typeof src !== 'object' || src === null || typeof src.evidenceId !== 'string' || src.evidenceId === '' || !Number.isInteger(src.version)) {
    return rerr('MISSING_INPUT', `${key}.source`, `${key}.source 必须为 { evidenceId, version }（输入来源可追溯）`);
  }
  return null;
}

function rerr(code, field, message) {
  return { code, field, message, toolVersion: RATIO_TOOL_VERSION };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
