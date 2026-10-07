// 任务 03 · S1 四域评估器（确定性）：政策/信审/商务/资产各按职责边界产出候选意见。
// 域不能做（结构层强制，任务书 §3 表格）：
// - 政策：不凭模型记忆新造公司红线（只引用激活规则包条目）；疑似适用≠确定命中。
// - 信审：不从视频热闹程度推全年收入（输入只来自带来源的事实条目）；不用资料页数提额。
// - 商务：不用提高价格抵消欺诈；成本未知时不产出净收益数值。
// - 资产：不把看见设备等同所有权；不因“辅助域”忽略真实性硬门。
// 全部输出经 validateDomainAnalysis 校验：authority=none、发现可定位、无 confidence 字段。

import { validateDomainAnalysis } from './schema.mjs';
import { readFact, independentSourceCount } from './perception.mjs';
import { stableHash } from './util.mjs';

const ASSESSOR_VERSION = 'deterministic-assessor@0.3';

function baseRun({ domain, snapshot, rulesetVersion, now }) {
  const t = now();
  return {
    runId: `run-${domain}-${stableHash({ snapshot: snapshot.snapshotId, ruleset: rulesetVersion, t }).slice(0, 12)}`,
    customerId: snapshot.customerId,
    sessionId: `sess-${snapshot.tenantId}-${snapshot.customerId}`,
    domain,
    providerMode: 'deterministic',
    modelVersion: ASSESSOR_VERSION,
    promptHash: stableHash({ assessor: ASSESSOR_VERSION, logic: `${domain}-v3` }),
    rulesetVersion,
    inputSnapshotId: snapshot.snapshotId,
    inputHash: snapshot.inputHash,
    inputWatermark: snapshot.watermark,
    startedAt: t,
    completedAt: t,
    usage: { externalCalls: 0 },
    executionStatus: 'completed',
  };
}

function emptyAssessment(domain) {
  return {
    domain,
    findingType: '',
    summary: '',
    evidenceRefs: [],
    ruleRefs: [],
    knownFacts: [],
    unknowns: [],
    contradictions: [],
    proposedQuestions: [],
    proposedActions: [],
    findingsSuspicion: [],
    stale: false,
    authority: 'none',
  };
}

function factRef(it) { return { materialId: it.materialId, location: it.sourceRef ?? null }; }

/** 从投影读单值事实（取核验等级最高的一条；无 → null）。 */
function topFact(projection, factKey, { caliber = null } = {}) {
  const all = readFact(projection, factKey, { caliber });
  if (all.length === 0) return null;
  const rank = { unknown: 0, declared: 1, source_supported: 2, verified: 3 };
  return all.reduce((a, b) => (rank[b.verificationLevel] >= rank[a.verificationLevel] ? b : a));
}

// [A1候选v3] 年报事实键→中文名（年度事实参考贯通；不推月度、不提确认等级、不作放行依据）
const ANNUAL_FACT_DEFS = [
  ['revenue_annual_declared', '年度营业收入'],
  ['total_assets_declared', '年度总资产'],
  ['total_liabilities_declared', '年度总负债'],
  ['net_profit_annual_declared', '年度净利润'],
  ['operating_cash_flow_annual_declared', '年度经营现金流'],
  ['gross_margin_declared', '年度毛利率申报'],
];
const annualLvOk = (f) => ['source_supported', 'verified'].includes(f.verificationLevel);
// 单位族判定：未申报 → null（绝不默认 CNY）；cny/wan 同族才可比较
const annualUnitFamily = (f) => { const u = f.unit; if (u === undefined || u === null || u === '') return null;
  if (['CNY', '元', '人民币'].includes(u)) return 'cny';
  if (['wan', '万元'].includes(u)) return 'wan';
  return 'other:' + String(u); };
const annualUnitText = (f) => ((f.unit === undefined || f.unit === null || f.unit === '') ? '单位未申报' : String(f.unit));
// 口径查找按【factKey+materialId+值+核验级】精确绑定（R1 FAIL 整改：禁止跨 factKey 同金额错取）；
// 命中多条且口径不一致=歧义（ambiguous），歧义/缺证一律转 UNKNOWN 保留来源
const annualCaliberOf = (projection, f, factKey) => {
  const cals = [...new Set(projection.items
    .filter(x => x.factKey === factKey && x.materialId === f.materialId && x.value === f.value && x.verificationLevel === f.verificationLevel)
    .map(x => (x.caliber === undefined || x.caliber === null || x.caliber === '') ? null : x.caliber))];
  if (cals.length === 0) return { caliber: null, ambiguous: false };
  if (cals.length > 1) return { caliber: null, ambiguous: true, cals };
  return { caliber: cals[0], ambiguous: false };
};

// ---------------------------------------------------------------- 政策域

export function assessPolicy({ snapshot, projection, ruleEvaluation, now = () => new Date().toISOString() }) {
  const a = emptyAssessment('policy');
  a.findingType = 'rule_applicability';
  const hits = [];
  const missing = [];
  const notApplicable = [];
  for (const r of ruleEvaluation.results) {
    if (!r.activated) continue;
    if (!r.scopeApplied) { notApplicable.push(r.ruleId); continue; }
    if (r.outcome === 'hit') hits.push(r.ruleId);
    if (r.outcome === 'precondition_missing') {
      missing.push(r.ruleId);
      for (const mf of r.missingFacts ?? []) {
        a.proposedQuestions.push({
          questionId: `pq-policy-${r.ruleId}-${mf.factKey}`,
          whyNeeded: `规则 ${r.ruleId} 前提事实未达核验等级（需 ${mf.minLevel}）`,
          expectedEvidence: { kind: 'document', factKey: mf.factKey, minLevel: mf.minLevel },
          targetFact: mf.factKey,
          priority: 'high',
          optional: false,
          customerBurden: 'medium',
          stopCondition: `fact_verified:${mf.factKey}`,
        });
      }
    }
  }
  a.ruleRefs = ruleEvaluation.results.filter((r) => r.activated && r.scopeApplied).map((r) => r.ruleId);
  a.summary = ruleEvaluation.policyPending
    ? `存在相关但未批准/适用性不明的规则（policy_pending）：不自行推断适用后放行；已激活规则中命中 ${hits.length} 项、前提缺失 ${missing.length} 项`
    : `已激活且适用规则中：命中 ${hits.length} 项、前提缺失 ${missing.length} 项、不适用 ${notApplicable.length} 项（规则版本 ${ruleEvaluation.rulesetVersion}，asOf ${ruleEvaluation.asOf}）`;
  a.knownFacts = [
    `规则包版本 ${ruleEvaluation.rulesetVersion}；评估基准日 ${ruleEvaluation.asOf}`,
    ...hits.map((id) => `规则 ${id} 前提满足且条件成立（确定命中，依据=激活规则包，非模型记忆）`),
  ];
  for (const r of ruleEvaluation.results) {
    if (r.activated && r.scopeApplied && r.outcome === null) continue;
  }
  if (ruleEvaluation.policyPending) {
    a.unknowns.push('存在 scope 相关但未批准（approval_pending）或来源未确认的规则：其适用性未知，不得据此放行或阻断');
  }
  a.evidenceRefs = ruleEvaluation.results
    .filter((r) => r.activated && r.scopeApplied && r.evidenceRefs)
    .flatMap((r) => r.evidenceRefs).map(factRef);
  const run = baseRun({ domain: 'policy', snapshot, rulesetVersion: ruleEvaluation.rulesetVersion, now });
  const v = validateDomainAnalysis({ analysisRun: run, assessment: a }, snapshot);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  return { ok: true, analysisRun: run, assessment: a };
}

// ---------------------------------------------------------------- 信审域

export function assessCredit({ snapshot, projection, thresholds, coverageRuleApplied = true, now = () => new Date().toISOString() }) {
  const a = emptyAssessment('credit');
  a.findingType = 'risk_opinion';
  const rulesetNote = `阈值包 ${thresholds.versions.business}`;
  const minCov = thresholds.business('sim_min_cash_coverage');

  const op = topFact(projection, 'monthly_operating_cash_flow');
  const ds = topFact(projection, 'monthly_debt_service');
  const newDebt = topFact(projection, 'new_debt_monthly_payment');
  const top1 = topFact(projection, 'top1_customer_revenue_share');

  const notes = [];
  let coverage = null;
  if (op && ds && typeof op.value === 'number' && typeof ds.value === 'number' && ds.value > 0
    && ['source_supported', 'verified'].includes(op.verificationLevel)
    && ['source_supported', 'verified'].includes(ds.verificationLevel)) {
    coverage = Number((op.value / ds.value).toFixed(6));
    notes.push(`现金流覆盖率 ${coverage} = 月经营现金流 ${op.value}${op.unit ?? ''} / 月偿债 ${ds.value}${ds.unit ?? ''}（公式 sim-cf-coverage@1，输入来源 ${op.materialId}/${ds.materialId}）`);
    a.knownFacts.push(notes[0]);
    // 覆盖率提示尊重规则适用面：规则不适用于本交易（如经营租赁）时只记算术事实，不触发风险标记
    if (minCov && coverageRuleApplied && coverage < minCov.value) {
      a.findingsSuspicion.push({
        note: `覆盖率 ${coverage} 低于演示阈值 ${minCov.value}${minCov.unit}（来源 ${minCov.source}，版本 ${thresholds.versions.business}）：需人工风险复核`,
        evidenceRefs: [factRef(op), factRef(ds)],
      });
    } else if (minCov && !coverageRuleApplied) {
      a.knownFacts.push(`覆盖率阈值标记不适用（覆盖率规则对本交易范围不适用）：仅记录算术事实 ${coverage}`);
    }
    // 压力情景（确定性重算）：新债务按声明值叠加
    if (newDebt && typeof newDebt.value === 'number' && newDebt.verificationLevel !== 'unknown') {
      const stressed = Number((op.value / (ds.value + newDebt.value)).toFixed(6));
      a.knownFacts.push(`压力情景（叠加声明新增债务月付 ${newDebt.value}）：覆盖率降至 ${stressed}（口径=声明值，未核验）`);
      a.unknowns.push(`新增债务 ${newDebt.value}${newDebt.unit ?? ''} 为声明级（${newDebt.verificationLevel}）：确认前覆盖结论按待核验处理`);
    }
  } else {
    if (!op) a.unknowns.push('月经营现金流缺失（unknown）：不补造数值');
    if (!ds) a.unknowns.push('月偿债缺失（unknown）：不补造数值');
    if (op && !['source_supported', 'verified'].includes(op.verificationLevel)) a.unknowns.push(`月经营现金流仅 ${op.verificationLevel} 级：不足以计算覆盖结论`);
    if (ds && !['source_supported', 'verified'].includes(ds.verificationLevel)) a.unknowns.push(`月偿债仅 ${ds.verificationLevel} 级：不足以计算覆盖结论`);
    a.proposedQuestions.push({
      questionId: 'pq-credit-cashflow',
      whyNeeded: '偿债覆盖计算缺关键输入（现金流/偿债缺失或等级不足）',
      expectedEvidence: { kind: 'document', factKey: 'monthly_operating_cash_flow', minLevel: 'source_supported' },
      targetFact: 'monthly_operating_cash_flow',
      priority: 'high',
      optional: false,
      customerBurden: 'medium',
      stopCondition: 'fact_verified:monthly_operating_cash_flow',
    });
  }

  if (top1 && typeof top1.value === 'number') {
    a.knownFacts.push(`第一大客户收入占比 ${top1.value}${top1.unit ?? '%'}（来源 ${top1.materialId}）；集中度风险提示属解释性意见，非结论`);
  }

  // 经营真实性：只接受带来源事实；视频/资料页数等不作为收入依据（结构上无此输入通道）
  const liveliness = projection.items.find((it) => it.factKey === 'video_liveliness' || it.factKey === 'material_page_count');
  if (liveliness) {
    a.unknowns.push(`输入含非事实类观察（${liveliness.factKey}）：按纪律不用于收入/额度推断，仅留档`);
  }

  a.summary = coverage !== null
    ? `信审解释性意见（${rulesetNote}）：覆盖率 ${coverage}；未知项 ${a.unknowns.length} 条；意见为候选，不构成结论`
    : `信审解释性意见（${rulesetNote}）：关键现金流输入缺失或等级不足，覆盖结论不可计算（不补数）；未知项 ${a.unknowns.length} 条`;
  // [A1候选v3] 年度事实参考：有即记 knownFacts；单位/口径如实显示（缺=「未申报」/「口径歧义」），绝不默认 CNY
  const annualRefs = [];
  for (const [annualKey, annualLabel] of ANNUAL_FACT_DEFS) {
    const f = topFact(projection, annualKey);
    if (!f || typeof f.value !== 'number') continue;
    const c = annualCaliberOf(projection, f, annualKey);
    const caliberText = c.ambiguous ? '口径歧义（同事实多口径）' : (c.caliber !== null ? `口径 ${c.caliber}` : '口径未申报');
    a.knownFacts.push(`年度事实参考：${annualLabel} ${f.value} ${annualUnitText(f)}（${f.verificationLevel}，来源 ${f.materialId}，${caliberText}；年度口径，不推月度，不作放行依据）`);
    annualRefs.push(f);
  }
  // [A1候选v3] 年度风险信号——仅口径证据充分（同 factKey 精确绑定、非歧义、双方已申报且一致）时判定；缺口转 UNKNOWN 保留来源
  {
    const ta = topFact(projection, 'total_assets_declared');
    const tl = topFact(projection, 'total_liabilities_declared');
    if (ta && tl && typeof ta.value === 'number' && typeof tl.value === 'number' && annualLvOk(ta) && annualLvOk(tl)) {
      const ca = annualCaliberOf(projection, ta, 'total_assets_declared');
      const cl = annualCaliberOf(projection, tl, 'total_liabilities_declared');
      const fa = annualUnitFamily(ta); const fl = annualUnitFamily(tl);
      const srcNote = `（来源 ${ta.materialId}/${tl.materialId}）`;
      if (ca.ambiguous || cl.ambiguous) {
        a.unknowns.push(`年度资产负债口径歧义（${ca.ambiguous ? `总资产多口径 ${JSON.stringify(ca.cals ?? [])}` : ''}${ca.ambiguous && cl.ambiguous ? '；' : ''}${cl.ambiguous ? `总负债多口径 ${JSON.stringify(cl.cals ?? [])}` : ''}）：资不抵债判定转 UNKNOWN，保留来源${srcNote}`);
      } else if (fa === null || fl === null) {
        a.unknowns.push(`年度资产负债单位缺证（总资产${annualUnitText(ta)}，总负债${annualUnitText(tl)}）：资不抵债判定转 UNKNOWN，不默认币种${srcNote}`);
      } else if (ca.caliber !== null && cl.caliber !== null && ca.caliber !== cl.caliber) {
        a.unknowns.push(`年度资产负债口径不一致（${ca.caliber} vs ${cl.caliber}）：不做资不抵债比较，需同口径复核${srcNote}`);
      } else if (ca.caliber === null || cl.caliber === null) {
        a.unknowns.push(`年度资产负债口径/年度缺证（${ca.caliber === null ? '总资产口径未申报' : ''}${cl.caliber === null ? '总负债口径未申报' : ''}）：资不抵债判定转 UNKNOWN，保留来源${srcNote}`);
      } else if (fa !== fl) {
        a.unknowns.push(`年度资产负债单位族不一致（${ta.unit} vs ${tl.unit}）：不做资不抵债比较，需同口径复核${srcNote}`);
      } else if (ta.value > 0 && tl.value > ta.value) {
        a.findingsSuspicion.push({ note: `年度口径资不抵债信号：总负债 ${tl.value}${tl.unit} 严格大于总资产 ${ta.value}${ta.unit}（申报值待核验，口径 ${ca.caliber}）：需人工风险复核`, evidenceRefs: [factRef(ta), factRef(tl)] });
      } else if (ta.value > 0 && tl.value === ta.value) {
        a.knownFacts.push(`年度口径：总负债 ${tl.value}${tl.unit} 与总资产 ${ta.value}${ta.unit} 相等（口径 ${ca.caliber}）——不构成资不抵债判定，是否需其他口径复核待人工判断`);
      }
    }
    const np = topFact(projection, 'net_profit_annual_declared');
    if (np && typeof np.value === 'number' && np.value < 0 && annualLvOk(np)) {
      a.findingsSuspicion.push({ note: `年度净利润为负（亏损申报 ${np.value} ${annualUnitText(np)}）：需人工风险复核（亏损幅度/行业口径未核，不作\"巨亏\"定性）`, evidenceRefs: [factRef(np)] });
    }
    const gm = topFact(projection, 'gross_margin_declared');
    if (gm && typeof gm.value === 'number' && gm.value < 0 && annualLvOk(gm)) {
      a.findingsSuspicion.push({ note: `年度毛利率申报为负（负毛利 ${gm.value}${gm.unit ?? ''}）：需人工风险复核（申报值待核验）`, evidenceRefs: [factRef(gm)] });
    }
    const cf = topFact(projection, 'operating_cash_flow_annual_declared');
    if (cf && typeof cf.value === 'number' && cf.value < 0 && annualLvOk(cf)) {
      a.findingsSuspicion.push({ note: `年度经营现金流为负 ${cf.value} ${annualUnitText(cf)}（申报值待核验）：需人工风险复核`, evidenceRefs: [factRef(cf)] });
    }
  }
  a.evidenceRefs = [op, ds, newDebt, top1, ...annualRefs].filter(Boolean).map(factRef);
  const run = baseRun({ domain: 'credit', snapshot, rulesetVersion: thresholds.versions.business, now });
  const v = validateDomainAnalysis({ analysisRun: run, assessment: a }, snapshot);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  return { ok: true, analysisRun: run, assessment: a };
}

// ---------------------------------------------------------------- 商务域

export function assessCommerce({ snapshot, projection, thresholds, now = () => new Date().toISOString() }) {
  const a = emptyAssessment('commerce');
  a.findingType = 'plan_comparison';
  const term = topFact(projection, 'lease_term_months');
  const rent = topFact(projection, 'proposed_monthly_rent');
  const fundCost = topFact(projection, 'funding_cost_annual');
  const feeKnown = topFact(projection, 'fees_known');
  const plans = projection.items.filter((it) => it.factKey === 'proposed_monthly_rent');
  const moneyUnits = { CNY: { label: '元', factor: 1 }, '元': { label: '元', factor: 1 },
    '人民币': { label: '元', factor: 1 }, wan: { label: '万元', factor: 10000 }, '万元': { label: '万元', factor: 10000 } };
  const termValid = Number.isInteger(term?.value) && term.value > 0;

  const rows = plans.map((p, i) => ({
    planId: `plan-${i + 1}`,
    monthlyRent: p.value,
    unit: moneyUnits[p.unit]?.label ?? '（单位未知）',
    comparableCny: typeof p.value === 'number' && Number.isFinite(p.value) && p.value > 0 && moneyUnits[p.unit]
      ? p.value * moneyUnits[p.unit].factor : null,
    termMonths: term?.value ?? null,
    caliber: p.caliber,
    source: p.materialId,
    totalRent: (typeof p.value === 'number' && Number.isFinite(p.value) && p.value > 0 && moneyUnits[p.unit] && termValid)
      ? Number((p.value * term.value).toFixed(6)) : null,
    netIncome: null, // 结构性：缺成本时绝不编净收益
    costUnknownItems: [],
  }));
  for (const r of rows) {
    if (r.comparableCny === null) a.unknowns.push(`方案 ${r.planId}：月租金数值或货币单位未知，不计算总额、不跨单位排序`);
    if (!termValid) a.unknowns.push(`方案 ${r.planId}：期限缺失或不是正整数月数，不计算总额`);
  }
  if (fundCost === null || fundCost.verificationLevel === 'unknown') {
    for (const r of rows) r.costUnknownItems.push('资金成本（unknown：不编净收益）');
  }
  if (feeKnown === null || feeKnown.value !== true || feeKnown.verificationLevel === 'unknown') {
    for (const r of rows) r.costUnknownItems.push('费用结构（未知项：未确认）');
  }
  a.knownFacts = rows.map((r) => `方案 ${r.planId}：月租金 ${r.monthlyRent}${r.unit} × 期限 ${r.termMonths ?? '未知'} 月 → 租金总额 ${r.totalRent === null ? '不可计算（数值、单位或期限缺失）' : `${r.totalRent}${r.unit}`}（来源 ${r.source}）`);
  for (const r of rows) {
    if (r.costUnknownItems.length > 0) a.unknowns.push(`方案 ${r.planId}：${r.costUnknownItems.join('；')}——净收益不可计算，不产出数值`);
  }
  // 结构边界：本域输出没有“提高价格对冲风险”的字段；对高定价方案仅提示成本核验
  const maxRow = rows.length > 1 && rows.every(r => r.comparableCny !== null) && new Set(rows.map(r=>r.comparableCny)).size > 1
    ? rows.reduce((x, y) => y.comparableCny > x.comparableCny ? y : x) : null;
  if (maxRow) {
    a.knownFacts.push(`方案 ${maxRow.planId} 为最高定价方案：定价差异须以成本核验解释；不得以高收益对冲真实性/欺诈风险（用户约束 high_interest_not_risk_coverage）`);
  }
  a.summary = rows.length > 0
    ? `商务交易条件（候选）：${rows.length} 条租金记录；多份声明不等于独立报价方案，成本未知项按来源标注；尚未完成净收益测算`
    : '商务：未提供租金/期限等交易条件事实，无可比较方案（不编造）';
  if (rows.length === 0) {
    a.unknowns.push('缺少租赁交易条件（月租金/期限）：等待商务条件材料');
  }
  a.evidenceRefs = [...plans, term, fundCost, feeKnown].filter(Boolean).map(factRef);
  const run = baseRun({ domain: 'commerce', snapshot, rulesetVersion: thresholds.versions.business, now });
  const v = validateDomainAnalysis({ analysisRun: run, assessment: a }, snapshot);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  return { ok: true, analysisRun: run, assessment: a };
}

// ---------------------------------------------------------------- 资产域

export function assessAsset({ snapshot, projection, ruleEvaluation, now = () => new Date().toISOString() }) {
  const a = emptyAssessment('asset');
  a.findingType = 'asset_condition';
  const ownership = topFact(projection, 'equipment_ownership_verified');
  const existsObserved = topFact(projection, 'equipment_exists_observed');
  const dealAmount = readFact(projection, 'equipment_deal_amount');
  const nameplate = readFact(projection, 'nameplate_serial');

  // 看见设备 ≠ 所有权（C04）：存在性观察只进存在性事实
  if (existsObserved) {
    a.knownFacts.push(`设备存在性记录：${existsObserved.value}（等级 ${existsObserved.verificationLevel}，来源 ${existsObserved.materialId}）：按原来源记录，不推定为远程画面或已核实，不证明权属`);
  }
  if (ownership) {
    a.knownFacts.push(`权属事实：${ownership.value}（等级 ${ownership.verificationLevel}，来源 ${ownership.materialId}）`);
    if (ownership.verificationLevel !== 'verified') {
      a.unknowns.push(`权属未达 verified 级（当前 ${ownership.verificationLevel}）：不得标“权属已核实”`);
    }
  } else {
    a.unknowns.push('权属文件缺失：权属状态 unknown，不得标“权属已核实”');
    a.proposedActions.push({ action: 'verify_registration', note: '向登记机关核验设备权属（动产融资统一登记）', targetFact: 'equipment_ownership_verified' });
  }

  // 冲突保留（C05）：交易对价/型号/铭牌各自定位，不合并、不取平均
  const assetConflicts = snapshot.conflicts.filter((c) => ['equipment_deal_amount', 'equipment_model', 'nameplate_serial'].includes(c.factKey));
  a.contradictions = assetConflicts.map((c) => ({ factKey: c.factKey, values: c.values }));
  if (assetConflicts.length > 0) {
    a.findingsSuspicion.push({
      note: '资产关键事实存在来源冲突（交易对价/型号/铭牌不一致）：保留冲突与各自定位，升级人工核验',
      evidenceRefs: assetConflicts.flatMap((c) => c.values.map((v) => ({ materialId: v.materialId, location: v.sourceRef ?? null }))),
    });
    a.proposedActions.push({ action: 'third_party_check', note: '对冲突凭证做第三方核验（原厂/登记记录）', targetFact: assetConflicts[0].factKey });
  }
  if (dealAmount.length === 0 && nameplate.length === 0 && !existsObserved && !ownership) {
    a.unknowns.push('无资产相关材料：存在性/权属/型号全部未知');
  }
  a.summary = `资产域意见（候选）：存在性${existsObserved ? '已观察（非权属）' : '未观察'}、权属${ownership ? `等级 ${ownership.verificationLevel}` : '未知'}；来源冲突 ${assetConflicts.length} 项（保留各自定位）`;
  a.evidenceRefs = [ownership, existsObserved, ...dealAmount, ...nameplate].filter(Boolean).map(factRef);
  const rulesetVersion = ruleEvaluation?.rulesetVersion ?? 'none';
  const run = baseRun({ domain: 'asset', snapshot, rulesetVersion, now });
  const v = validateDomainAnalysis({ analysisRun: run, assessment: a }, snapshot);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  return { ok: true, analysisRun: run, assessment: a };
}

/** 独立佐证说明（C01 消费点）：资产/信审意见附“独立来源数”，重复组不叠加。 */
export function corroborationNote(projection, factKey) {
  return `事实 ${factKey} 的独立来源数=${independentSourceCount(projection, factKey)}（重复内容材料只计一次）`;
}

// ---------------------------------------------------------------- 商机域（TAKEOFF-FA-1.0.0 五列扩展）

/**
 * 商机域评估（确定性）：需求与经营动向，为“首次售后回租准入”提供商机面候选意见。
 * 边界（结构对齐全域纪律）：
 * - 不用资料页数/材料数量提额（材料数量不是输入，只有带来源的事实条目）；
 * - 订单/收入为 declared 级声明时如实标声明，不得当作已核验经营表现；
 * - 未决诉讼等不利动向只作为风险线索（转核验/冲突结构），不作诚信结论。
 */
export function assessBusiness({ snapshot, projection, ruleEvaluation, now = () => new Date().toISOString() }) {
  const a = emptyAssessment('business');
  a.findingType = 'demand_trajectory';
  const revenue = topFact(projection, 'revenue_annual_declared');
  const newOrder = topFact(projection, 'new_order_amount_declared');
  const litigation = topFact(projection, 'litigation_pending_declared');
  const totalAssets = topFact(projection, 'total_assets_declared');
  const totalLiabilities = topFact(projection, 'total_liabilities_declared');

  if (revenue) {
    a.knownFacts.push(`年收入声明 ${revenue.value}${revenue.unit ? ` ${revenue.unit}` : ''}（等级 ${revenue.verificationLevel}，来源 ${revenue.materialId}）：声明≠已核验经营表现`);
    if (revenue.verificationLevel !== 'verified') {
      a.unknowns.push(`收入未达 verified 级（当前 ${revenue.verificationLevel}）：经营动向判断保留为假设`);
    }
  } else {
    a.unknowns.push('收入声明缺失：经营规模 unknown，不推断、不补数');
  }
  if (newOrder) {
    a.knownFacts.push(`新订单金额声明 ${newOrder.value}${newOrder.unit ? ` ${newOrder.unit}` : ''}（等级 ${newOrder.verificationLevel}，来源 ${newOrder.materialId}）：需求改善线索，须以合同/回款核验为准`);
    a.proposedActions.push({ action: 'verify_order', note: '核验订单真实性与执行前景（合同要件/买方资信/回款记录）', targetFact: 'new_order_amount_declared' });
  } else {
    a.unknowns.push('新订单信息缺失：需求动向 unknown');
  }
  if (totalAssets && totalLiabilities) {
    a.knownFacts.push(`资产/负债声明：${totalAssets.value} / ${totalLiabilities.value}（等级 declared）：仅作规模参考，偿债判断归信审域`);
  }
  if (litigation && litigation.value === true) {
    a.findingsSuspicion.push({
      note: '存在未决诉讼声明：与经营向好线索构成方向性冲突线索（不自行裁决），转政策/信审域与人工复核',
      evidenceRefs: [factRef(litigation)],
    });
    a.proposedQuestions.push({
      questionId: 'pq-business-litigation-impact',
      whyNeeded: '未决诉讼对经营与回租标的的可能影响未核验',
      expectedEvidence: { kind: 'document', factKey: 'litigation_resolution_evidence', minLevel: 'source_supported' },
      targetFact: 'litigation_resolution_evidence',
      priority: 'high',
      optional: false,
      customerBurden: 'medium',
      stopCondition: 'fact_verified:litigation_resolution_evidence',
    });
  }
  // 商机域冲突保留：同键取值不一致时逐条定位，不合并
  const businessKeys = ['revenue_annual_declared', 'new_order_amount_declared', 'litigation_pending_declared'];
  const bizConflicts = snapshot.conflicts.filter((c) => businessKeys.includes(c.factKey));
  a.contradictions = bizConflicts.map((c) => ({ factKey: c.factKey, values: c.values }));
  if (revenue === null && newOrder === null && litigation === null) {
    a.unknowns.push('无商机面材料：需求/订单/涉诉全部未知（首次回租需求合理性暂不可评）');
  }
  a.summary = `商机域意见（候选）：收入${revenue ? `声明 ${revenue.verificationLevel} 级` : '未知'}、订单${newOrder ? '有声明线索' : '未知'}、涉诉${litigation ? (litigation.value === true ? '有未决声明（待核验）' : '声明为无') : '未知'}；材料数量不参与判断`;
  a.evidenceRefs = [revenue, newOrder, litigation, totalAssets, totalLiabilities].filter(Boolean).map(factRef);
  const rulesetVersion = ruleEvaluation?.rulesetVersion ?? 'none';
  const run = baseRun({ domain: 'business', snapshot, rulesetVersion, now });
  const v = validateDomainAnalysis({ analysisRun: run, assessment: a }, snapshot);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  return { ok: true, analysisRun: run, assessment: a };
}

export const ASSESSORS = Object.freeze({
  business: assessBusiness,
  policy: assessPolicy,
  credit: assessCredit,
  commerce: assessCommerce,
  asset: assessAsset,
});
