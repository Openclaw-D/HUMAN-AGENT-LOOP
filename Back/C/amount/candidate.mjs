// 任务 03 · S4 金额候选（确定性约束计算，非模型决定）：
// - 候选只来自可审计的确定性约束/计算与人工批准规则；模型只解释、找缺口、提情景。
// - 字段区分：产品上限 / 候选可支持区间 / 已批准额度 / 实际可用额度 / 待满足条件。
// - 任何数字带币种、口径、期限、输入版本（快照水位）与规则版本。
// - 未配置额度模型 → 只报缺口与不可评估，不为演示凑数字。
// - 不利事实（新增负债/现金流下降/资产冲突）可降低候选或 HOLD；材料数量不是输入
//   （构造上没有“文件数”参数），资料更齐 ≠ 机械提额（C07）。
// TAKEOFF-FA-1.0.0（03路）v2 加法扩展（PROTOCOL.md §5）：
// - suggestedTerm / referencePrice：来自规则包合成配置（termPolicy/pricePolicy，标明非机构政策）；
//   未配置=null+缺口，不编造期限与价格。
// - frozen/frozenReasons：来自 Gate（HOLD_FOR_REVIEW/HARD_BLOCK → 冻结）；解除只随对应证据
//   被取代/核验后新收口产生，无一键解除。
// - tendency/changeReason/previousRef/basedOn：同版协议锚（相对前版方向可增可减可冻结；
//   旧运行不能覆盖新版本由收口键 inputHash+规则版本保证，本层只如实产出方向与引用）。
// 全部新字段为加法输出；既有字段与公式（sim-linear-amount@1）行为不变，旧调用零破坏。

import { stableHash } from '../domains/util.mjs';

export const AMOUNT_MODEL_VERSION = 'sim-amount-model@1';
export const AMOUNT_CANDIDATE_SCHEMA = 'amount-candidate@2';
const FORMULA_VERSION = 'sim-linear-amount@1';

/** Gate 结果 → 冻结投影（确定性）：HOLD_FOR_REVIEW/HARD_BLOCK=冻结；理由=ruleIds+reasonCodes 去重。 */
function freezeProjection(gate) {
  const result = gate?.result ?? null;
  const frozen = result === 'HOLD_FOR_REVIEW' || result === 'HARD_BLOCK';
  const reasons = [
    ...new Set([
      ...(Array.isArray(gate?.ruleIds) ? gate.ruleIds : []),
      ...(Array.isArray(gate?.reasonCodes) ? gate.reasonCodes : []),
    ].filter((x) => typeof x === 'string' && x.length > 0)),
  ];
  return { frozen, frozenReasons: frozen ? reasons : [], gateResult: result };
}

/** 相对前版方向（确定性）：候选上界比较；冻结优先于涨跌；无前版=null（不猜方向）。 */
function tendencyOf({ evaluable, rangeMax, frozen }, previous) {
  if (frozen) return 'hold';
  const prevMax = previous?.maxValue;
  if (!previous?.evaluable || typeof prevMax !== 'number' || !evaluable || typeof rangeMax !== 'number') return null;
  if (rangeMax > prevMax) return 'increase';
  if (rangeMax < prevMax) return 'decrease';
  return 'unchanged';
}

/**
 * 金额候选计算。
 * @param p.productCap {value,currency,source} 产品上限（演示：用户提出的 1,000 万，非监管限额）
 * @param p.amountModelConfigured 是否已配置额度模型（演示环境 true=使用 sim 公式；false=只报缺口）
 * @param p.facts {monthlyOperatingCashFlow?, monthlyDebtService?, newDebtMonthlyPayment?, assetConflict?}
 *   均为 {value, unit, verificationLevel, materialId} 形状（须达 source_supported 级）
 * @param p.approvedAmount 人工已批准额度（人输入；模型不产生）
 * @param p.thresholds createThresholds 产物（业务阈值包）
 * @param p.inputWatermark / p.rulesetVersion 版本锚
 * @param p.termPolicy {defaultMonths,minMonths,maxMonths,unit,basis,source} 合成期限政策（可缺）
 * @param p.pricePolicy {referenceRateAnnual,caliber,basis,source} 合成参考价格口径（可缺）
 * @param p.assetCapPolicy {ltv,basis,source} 合成资产价值上限策略（售后回租：候选受可回租资产值约束；可缺）
 * @param p.assetValue {value,verificationLevel,materialId} 设备净值合计（declared 级即可用，如实标注）
 * @param p.gate C Gate 收口结果 {result,ruleIds,reasonCodes}（可缺=不冻结）
 * @param p.previous 前版摘要 {evaluable,maxValue,finId,inputHash,inputWatermarkGeneration,rulesetVersion}（可缺=null）
 * @param p.materialIds 参与材料清单（basedOn 引用；可缺=[]）
 * @param p.runRefs 域运行引用 {domain:runId}（可缺={}）
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
  termPolicy = null,
  pricePolicy = null,
  assetCapPolicy = null,
  assetValue = null,
  gate = null,
  previous = null,
  materialIds = [],
  runRefs = {},
}) {
  const gaps = [];
  const pendingConditions = [];
  const versionTag = {
    currency, caliber: '月度口径', termMonths,
    inputWatermarkGeneration: inputWatermark?.generation ?? null,
    inputSnapshotHashSuffix: null,
    rulesetVersion,
    formulaVersion: FORMULA_VERSION,
  };

  // 冻结与方向投影在任何分支都如实产出（不可评估≠不冻结；失败不假完成）
  const { frozen, frozenReasons, gateResult } = freezeProjection(gate);

  // 期限候选（确定性）：合成政策存在时生效；缺配置=null+缺口（unknown≠0）
  let suggestedTerm = null;
  let effectiveTermMonths = termMonths;
  if (termPolicy && Number.isFinite(termPolicy.defaultMonths) && termPolicy.defaultMonths > 0) {
    const min = Number.isFinite(termPolicy.minMonths) ? termPolicy.minMonths : termPolicy.defaultMonths;
    const max = Number.isFinite(termPolicy.maxMonths) ? termPolicy.maxMonths : termPolicy.defaultMonths;
    effectiveTermMonths = Math.min(max, Math.max(min, termPolicy.defaultMonths));
    suggestedTerm = {
      value: effectiveTermMonths,
      unit: termPolicy.unit ?? 'month',
      basis: termPolicy.basis ?? null,
      source: termPolicy.source ?? 'unspecified',
      note: '合成演示期限政策，非机构制度；正式期限由人工确认',
    };
  } else {
    gaps.push('期限政策未配置：期限候选不可评（null，不编造）');
  }

  const frame = {
    evaluable: false,
    tendency: tendencyOf({ evaluable: false, rangeMax: null, frozen }, previous),
    suggestedTerm,
    referencePrice: null,
    frozen,
    frozenReasons,
    gateResult,
    changeReason: previous ? '本轮不可评估：只报告缺口，不覆盖前版' : null,
    previousRef: previous?.finId || previous?.inputHash
      ? { finId: previous.finId ?? null, inputHash: previous.inputHash ?? null }
      : null,
    basedOn: {
      materialIds: [...materialIds],
      runRefs: { ...runRefs },
      inputSnapshotHash: inputWatermark ? stableHash(inputWatermark).slice(0, 16) : null,
    },
    pendingConditions,
    gaps,
    versionTag,
    candidateSchema: AMOUNT_CANDIDATE_SCHEMA,
  };

  if (!productCap || typeof productCap.value !== 'number' || productCap.value <= 0) {
    return { ...frame, gaps: [...frame.gaps, '产品上限未配置：不可评估'], note: '未配置额度模型时只报告缺口与不可评估，不为演示凑数' };
  }

  const cap = {
    kind: 'product_cap', value: productCap.value, currency,
    source: productCap.source ?? 'unspecified',
    note: '产品上限非监管限额、非默认批准金额；资本/集中度/关联/偿债可施加更低限制',
  };

  if (!amountModelConfigured) {
    return {
      ...frame,
      gaps: [...frame.gaps, '额度模型未配置：只报告缺口与不可评估'],
      productCap: cap,
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
      ...frame,
      gaps: minCov ? [...gaps] : [...gaps, '业务阈值 sim_min_cash_coverage 未配置'],
      productCap: cap,
    };
  }

  // 确定性公式（演示线性式，偿债感知）：
  //   新设施可用月付 = 现金流/最低覆盖 − 既有偿债 − 声明新增债务（负值取 0）
  //   指示额度 = 可用月付 × 期限（不含息上界）；新增不利债务确定性压缩候选（C07）
  //   期限取合成政策夹取值（无政策时维持调用方 termMonths，模型行为不变）
  const debtTotal = dsV + (typeof ndV === 'number' && ndV > 0 ? ndV : 0);
  const coverage = Number((opV / debtTotal).toFixed(6));
  const maxMonthlyPayment = Math.max(0, Number((opV / minCov.value - debtTotal).toFixed(6)));
  const indicativeAmount = Number((maxMonthlyPayment * effectiveTermMonths).toFixed(2));
  const cashConstraint = {
    constraintId: 'sim-cash-constraint',
    formula: 'maxMonthlyPayment = max(0, monthlyOperatingCashFlow / sim_min_cash_coverage − monthlyDebtService − newDebtMonthlyPayment); indicativeAmount = maxMonthlyPayment × termMonths',
    formulaVersion: FORMULA_VERSION,
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

  // 资产价值约束（TAKEOFF 售后回租语义，确定性）：可回租资产净值 × 合成 LTV 为候选上界之一；
  // 无策略/无净值=不施加（unknown≠编造），缺口如实标注。净值纠正（下调）确定性压缩候选。
  // 单位归一：声明单位 wan/万元 → ×10000 折算为币种主单位（元）；其余单位按原值（调用方保证口径）。
  let assetCapApplied = null;
  if (assetCapPolicy && Number.isFinite(assetCapPolicy.ltv) && assetCapPolicy.ltv > 0 && assetValue) {
    const rankMap = { unknown: 0, declared: 1, source_supported: 2, verified: 3 };
    if (assetValue.value != null && Number.isFinite(Number(assetValue.value)) && rankMap[assetValue.verificationLevel] >= rankMap.declared) {
      const raw = Number(assetValue.value);
      const unit = String(assetValue.unit ?? '').trim().toLowerCase();
      const wanFactor = (unit === 'wan' || unit === '万元') ? 10000 : 1;
      const normalized = raw * wanFactor;
      const assetCap = Number((Math.max(0, normalized) * assetCapPolicy.ltv).toFixed(2));
      assetCapApplied = assetCap;
      conflictAdjusted = Math.min(conflictAdjusted, assetCap);
      pendingConditions.push({
        condition: 'asset_value_recheck',
        note: `资产价值约束已应用：净值 ${raw}${wanFactor > 1 ? '万（折 ' + normalized + '）' : ''}（${assetValue.verificationLevel} 级，来源 ${assetValue.materialId ?? 'unknown'}）× LTV ${assetCapPolicy.ltv} = ${assetCap}；净值声明下调会确定性压低候选，核验后重算`,
      });
    }
  }

  const rangeMax = Math.min(cap.value, conflictAdjusted);
  const rangeMin = Number((rangeMax * 0.6).toFixed(2)); // 演示区间下界 60%（确定性，非审批数）
  const available = approvedAmount
    ? Math.min(approvedAmount.value, cap.value)
    : null;

  // 参考价格（确定性合成口径）：含息平均月租 = 候选上界 × (1 + 年名义利率 × 期限/12) / 期限；
  // 缺价格口径配置=null+缺口（不为演示编价格）。基于候选上界（含资产约束后），非指示额度原值。
  let referencePrice = null;
  if (pricePolicy && Number.isFinite(pricePolicy.referenceRateAnnual) && pricePolicy.referenceRateAnnual >= 0) {
    const monthlyRent = rangeMax > 0
      ? Number((rangeMax * (1 + pricePolicy.referenceRateAnnual * effectiveTermMonths / 12) / effectiveTermMonths).toFixed(2))
      : 0;
    referencePrice = {
      value: monthlyRent, currency,
      basis: pricePolicy.basis ?? null,
      caliber: pricePolicy.caliber ?? '含息平均月租（合成名义口径）',
      source: pricePolicy.source ?? 'unspecified',
      note: '合成演示参考口径，非报价、非机构定价；正式价格由人工确认',
    };
  } else {
    gaps.push('参考价格口径未配置：价格候选不可评（null，不编造）');
  }

  const tendency = tendencyOf({ evaluable: true, rangeMax, frozen }, previous);
  let changeReason = null;
  if (previous && previous.evaluable === true && typeof previous.maxValue === 'number') {
    const dir = tendency === 'increase' ? '上调' : tendency === 'decrease' ? '下调' : tendency === 'hold' ? '冻结（方向不适用）' : '持平';
    changeReason = `候选上界 ${previous.maxValue} → ${rangeMax}（${dir}）；输入水位 gen ${previous.inputWatermarkGeneration ?? '?'}→${inputWatermark?.generation ?? '?'}，规则版本 ${previous.rulesetVersion ?? '?'}→${rulesetVersion}${assetConflict ? '；资产冲突置零调整已应用' : ''}`;
  }

  return {
    evaluable: true,
    coverage,
    tendency,
    suggestedTerm,
    referencePrice,
    frozen,
    frozenReasons,
    gateResult,
    changeReason,
    previousRef: previous?.finId || previous?.inputHash
      ? { finId: previous.finId ?? null, inputHash: previous.inputHash ?? null }
      : null,
    basedOn: {
      materialIds: [...materialIds],
      runRefs: { ...runRefs },
      inputSnapshotHash: inputWatermark ? stableHash(inputWatermark).slice(0, 16) : null,
    },
    adverseSignals: {
      newDebtApplied: typeof ndV === 'number' && ndV > 0 ? ndV : 0,
      assetConflictApplied: assetConflict,
      assetCapApplied,
      note: '新增不利债务/资产冲突/资产价值约束已确定性降低候选或置零；材料数量不是本模型输入',
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
    versionTag: { ...versionTag, termMonths: effectiveTermMonths, inputSnapshotHashSuffix: stableHash(inputWatermark ?? {}).slice(0, 12) },
    candidateSchema: AMOUNT_CANDIDATE_SCHEMA,
  };
}
