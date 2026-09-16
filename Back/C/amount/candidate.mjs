// 任务 03 · S4 金额候选（确定性约束计算，非模型决定）：
// - 候选只来自可审计的确定性约束/计算与人工批准规则；模型只解释、找缺口、提情景。
// - 字段区分：产品上限 / 候选可支持区间 / 已批准额度 / 实际可用额度 / 待满足条件。
// - 任何数字带币种、口径、期限、输入版本（快照水位）与规则版本。
// - 未配置额度模型 → 只报缺口与不可评估，不为演示凑数字。
// - 不利事实（新增负债/现金流下降/资产冲突）可降低候选或 HOLD；材料数量不是输入
//   （构造上没有“文件数”参数），资料更齐 ≠ 机械提额（C07）。

import { stableHash } from '../domains/util.mjs';

export const AMOUNT_MODEL_VERSION = 'sim-amount-model@1';

/**
 * 金额候选计算。
 * @param p.productCap {value,currency,source} 产品上限（演示：用户提出的 1,000 万，非监管限额）
 * @param p.amountModelConfigured 是否已配置额度模型（演示环境 true=使用 sim 公式；false=只报缺口）
 * @param p.facts {monthlyOperatingCashFlow?, monthlyDebtService?, newDebtMonthlyPayment?, assetConflict?}
 *   均为 {value, unit, verificationLevel, materialId} 形状（须达 source_supported 级）
 * @param p.approvedAmount 人工已批准额度（人输入；模型不产生）
 * @param p.thresholds createThresholds 产物（业务阈值包）
 * @param p.inputWatermark / p.rulesetVersion 版本锚
 */
export function computeAmountCandidate({
  productCap,
  amountModelConfigured = true,
  facts = {},
  approvedAmount = null,
  thresholds,
  inputWatermark,
  rulesetVersion,
  currency = 'CNY',
  termMonths = 36,
}) {
  const gaps = [];
  const pendingConditions = [];
  const versionTag = {
    currency, caliber: '月度口径', termMonths,
    inputWatermarkGeneration: inputWatermark?.generation ?? null,
    inputSnapshotHashSuffix: null,
    rulesetVersion,
    formulaVersion: 'sim-linear-amount@1',
  };

  if (!productCap || typeof productCap.value !== 'number' || productCap.value <= 0) {
    return {
      evaluable: false,
      gaps: ['产品上限未配置：不可评估'],
      note: '未配置额度模型时只报告缺口与不可评估，不为演示凑数',
    };
  }

  const cap = {
    kind: 'product_cap', value: productCap.value, currency,
    source: productCap.source ?? 'unspecified',
    note: '产品上限非监管限额、非默认批准金额；资本/集中度/关联/偿债可施加更低限制',
  };

  if (!amountModelConfigured) {
    return {
      evaluable: false,
      gaps: ['额度模型未配置：只报告缺口与不可评估'],
      productCap: cap,
      pendingConditions,
      versionTag,
    };
  }

  const minCov = thresholds.business('sim_min_cash_coverage');
  const op = facts.monthlyOperatingCashFlow ?? null;
  const ds = facts.monthlyDebtService ?? null;
  const newDebt = facts.newDebtMonthlyPayment ?? null;
  const assetConflict = facts.assetConflict === true;

  const usable = (f, name, minLevel = 'source_supported') => {
    if (!f) { gaps.push(`${name} 缺失（unknown）：不可补造`); return null; }
    const rankMap = { unknown: 0, declared: 1, source_supported: 2, verified: 3 };
    if (rankMap[f.verificationLevel] < rankMap[minLevel]) {
      gaps.push(`${name} 核验等级 ${f.verificationLevel} 低于要求 ${minLevel}：不可作为计算输入`);
      return null;
    }
    return f.value;
  };

  const opV = usable(op, '月经营现金流');
  const dsV = usable(ds, '月偿债');
  const ndV = newDebt ? usable(newDebt, '新增债务月付（声明级按 0 计入候选、按实际值计入压力）', 'declared') : null;

  if (opV === null || dsV === null || !minCov) {
    return {
      evaluable: false,
      gaps: minCov ? gaps : [...gaps, '业务阈值 sim_min_cash_coverage 未配置'],
      productCap: cap,
      pendingConditions,
      versionTag,
    };
  }

  // 确定性公式（演示线性式，偿债感知）：
  //   新设施可用月付 = 现金流/最低覆盖 − 既有偿债 − 声明新增债务（负值取 0）
  //   指示额度 = 可用月付 × 期限（不含息上界）；新增不利债务确定性压缩候选（C07）
  const debtTotal = dsV + (typeof ndV === 'number' && ndV > 0 ? ndV : 0);
  const coverage = Number((opV / debtTotal).toFixed(6));
  const maxMonthlyPayment = Math.max(0, Number((opV / minCov.value - debtTotal).toFixed(6)));
  const indicativeAmount = Number((maxMonthlyPayment * termMonths).toFixed(2));
  const cashConstraint = {
    constraintId: 'sim-cash-constraint',
    formula: 'maxMonthlyPayment = max(0, monthlyOperatingCashFlow / sim_min_cash_coverage − monthlyDebtService − newDebtMonthlyPayment); indicativeAmount = maxMonthlyPayment × termMonths',
    formulaVersion: 'sim-linear-amount@1',
    inputs: {
      monthlyOperatingCashFlow: { value: opV, materialId: op.materialId, verificationLevel: op.verificationLevel },
      monthlyDebtService: { value: dsV, materialId: ds.materialId, verificationLevel: ds.verificationLevel },
      newDebtMonthlyPayment: typeof ndV === 'number' && ndV > 0 ? { value: ndV, materialId: newDebt.materialId, verificationLevel: newDebt.verificationLevel } : { value: 0 },
      simMinCoverage: { value: minCov.value, source: minCov.source, version: thresholds.versions.business },
    },
    computedValue: indicativeAmount,
    unit: currency,
  };

  // 不利事实调整（确定性）：资产实质冲突 → 候选降为 0 并 HOLD（不得以材料齐全率对冲）
  let conflictAdjusted = indicativeAmount;
  if (assetConflict) {
    conflictAdjusted = 0;
    pendingConditions.push({ condition: 'asset_conflict_resolved', note: '资产关键事实冲突未解决：候选支持额按 0 报告，解决后重算' });
  }

  const rangeMax = Math.min(cap.value, conflictAdjusted);
  const rangeMin = Number((rangeMax * 0.6).toFixed(2)); // 演示区间下界 60%（确定性，非审批数）
  const available = approvedAmount
    ? Math.min(approvedAmount.value, cap.value)
    : null;

  return {
    evaluable: true,
    coverage,
    adverseSignals: {
      newDebtApplied: typeof ndV === 'number' && ndV > 0 ? ndV : 0,
      assetConflictApplied: assetConflict,
      note: '新增不利债务/资产冲突已确定性降低候选或置零；材料数量不是本模型输入',
    },
    productCap: cap,
    candidateRange: {
      min: rangeMin, max: rangeMax, currency,
      basis: [cashConstraint],
      note: '候选可支持区间是确定性约束结果（演示公式），不是批准、不是报价',
    },
    approvedAmount: approvedAmount ? { ...approvedAmount, note: '人工批准额（人类权威），模型不产生' } : null,
    availableAmount: available === null ? null : {
      value: Number(Math.max(0, available - (approvedAmount.used ?? 0)).toFixed(2)),
      currency,
      note: '实际可用=已批准−已占用（示例口径）',
    },
    pendingConditions,
    gaps,
    versionTag: { ...versionTag, inputSnapshotHashSuffix: stableHash(inputWatermark ?? {}).slice(0, 12) },
  };
}
