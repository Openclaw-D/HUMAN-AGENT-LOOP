// 收尾02 · 十案例 fixtures（唯一事实源：材料生成脚本与种子器共用）。
// 纪律：facts 只是输入（值/单位/核验等级），不携带结论；好中差是案例分类，
// 结果由 C 激活规则包与评估器从材料计算（EXPECTED.json 为手工独立推导，另行对照）。
export const BASE_FACTS = {
  entity_identity_verified: { value: true, unit: null, grade: 'confirmed', source: '主体登记核验（合成）' },
  equipment_ownership_verified: { value: true, unit: null, grade: 'confirmed', source: '权属登记核验（合成）' },
  equipment_exists_observed: { value: true, unit: null, grade: 'confirmed', source: '现场盘点（合成）' },
  nameplate_serial: { value: null, unit: null, grade: 'confirmed', source: '铭牌照片编号（合成）' }, // value 由案例注入
  equipment_deal_amount: { value: 3000000, unit: 'CNY', grade: 'confirmed', source: '购置合同价（合成）' },
  revenue_annual_declared: { value: 22000000, unit: 'CNY', grade: 'confirmed', source: '企业年报摘要（合成）' },
  new_order_amount_declared: { value: 3000000, unit: 'CNY', grade: 'confirmed', source: '在手订单台账（合成）' },
  litigation_pending_declared: { value: false, unit: null, grade: 'confirmed', source: '涉诉查询（合成）' },
  total_assets_declared: { value: 15000000, unit: 'CNY', grade: 'confirmed', source: '资产负债表（合成）' },
  total_liabilities_declared: { value: 6000000, unit: 'CNY', grade: 'confirmed', source: '资产负债表（合成）' },
  monthly_operating_cash_flow: { value: 200000, unit: 'CNY', grade: 'confirmed', source: '银行流水月均（合成）' },
  monthly_debt_service: { value: 100000, unit: 'CNY', grade: 'confirmed', source: '还款计划表（合成）' },
  top1_customer_revenue_share: { value: 30, unit: '%', grade: 'confirmed', source: '收入构成明细（合成）' },
  proposed_monthly_rent: { value: 10000, unit: 'CNY', grade: 'confirmed', source: '租金方案（合成）' },
  lease_term_months: { value: 36, unit: '月', grade: 'confirmed', source: '租赁方案（合成）' },
  funding_cost_annual: { value: 0.03, unit: '比率', grade: 'confirmed', source: '资金成本口径（合成）' },
  fees_known: { value: true, unit: null, grade: 'confirmed', source: '费用清单（合成）' },
};
const TRANSACTION = { orgType: 'commercial_leasing', product: 'sale_leaseback', region: '新疆喀什', customerRange: 'standard' };

/** 十案例差异只用 {覆盖值, 覆盖等级, 缺件键, 冲突件} 表达；标签不进执行面。 */
export const CASES = [
  { caseId: 'case-01', displayOrder: 1, category: '差', businessName: '喀什河谷新材料加工厂',
    summary: '年收入超5000万准入红线：推进被确定性红线检查阻断，不可强制通过',
    overrides: { revenue_annual_declared: { value: 56000000 }, monthly_operating_cash_flow: { value: 260000 }, monthly_debt_service: { value: 110000 },
      total_assets_declared: { value: 18000000 }, total_liabilities_declared: { value: 7000000 } },
    serial: 'SYNTHETIC-MACHINE-c01', recipe: { advance: false } },
  { caseId: 'case-02', displayOrder: 2, category: '差', businessName: '天山南麓农机装备公司',
    summary: '资产权属冲突：申报称自有，核验登记不通过 → 不可豁免硬阻断，采用被拒并留痕',
    overrides: { revenue_annual_declared: { value: 18000000 }, monthly_operating_cash_flow: { value: 180000 }, monthly_debt_service: { value: 90000 },
      equipment_deal_amount: { value: 2600000 }, equipment_ownership_verified: { value: true, grade: 'source_supported' },
      total_assets_declared: { value: 12000000 }, total_liabilities_declared: { value: 5100000 } },
    serial: 'SYNTHETIC-MACHINE-c02',
    recipe: { advance: true, verificationRegistrations: [
      { factKey: 'equipment_ownership_verified', value: false, grade: 'confirmed', note: '权属核验：登记簿比对不一致（合成核验结论=不通过）' }],
      postAdvance: 'readvance' } },
  { caseId: 'case-03', displayOrder: 3, category: '差', businessName: '准噶尔包装制品厂',
    summary: '偿债能力不足：覆盖率 55000/100000=0.55 低于演示阈值 1.0，风险意见待信审决定',
    overrides: { revenue_annual_declared: { value: 15000000 }, monthly_operating_cash_flow: { value: 55000 }, monthly_debt_service: { value: 100000 },
      equipment_deal_amount: { value: 2200000 }, total_assets_declared: { value: 9000000 }, total_liabilities_declared: { value: 4300000 } },
    serial: 'SYNTHETIC-MACHINE-c03', recipe: { advance: true } },
  { caseId: 'case-04', displayOrder: 4, category: '中', businessName: '伊犁河谷食品加工合作社',
    summary: '现金流缺件：月经营现金流仅申报未核验（unknown），信审待补件；补件后仅相关域重算',
    overrides: { revenue_annual_declared: { value: 20000000 }, monthly_operating_cash_flow: { value: 200000, grade: 'unverified' },
      monthly_debt_service: { value: 95000 }, equipment_deal_amount: { value: 2400000 },
      total_assets_declared: { value: 13000000 }, total_liabilities_declared: { value: 5500000 } },
    serial: 'SYNTHETIC-MACHINE-c04',
    recipe: { advance: true, supplement: { factKey: 'monthly_operating_cash_flow', value: 200000, grade: 'confirmed',
      note: '补件：银行对账单核验月均现金流（合成核验件，supersedes 旧申报）' } } },
  { caseId: 'case-05', displayOrder: 5, category: '中', businessName: '阿克苏果业冷链公司',
    summary: '金额口径冲突：设备对价两份来源 2,980,000 与 3,350,000 同级冲突，核实后按版本重算',
    overrides: { revenue_annual_declared: { value: 24000000 }, monthly_operating_cash_flow: { value: 220000 }, monthly_debt_service: { value: 105000 },
      equipment_deal_amount: { value: 2980000 },
      total_assets_declared: { value: 16500000 }, total_liabilities_declared: { value: 6800000 } },
    serial: 'SYNTHETIC-MACHINE-c05', extraConflict: { factKey: 'equipment_deal_amount', value: 3350000, grade: 'confirmed',
      source: '设备采购发票（合成）', fileName: 'purchase_invoice.csv' },
    recipe: { advance: true } },
  { caseId: 'case-06', displayOrder: 6, category: '中', businessName: '吐鲁番纺织印染厂',
    summary: '核验未完成：收入·主体·权属仅申报未核验，人工核验待办（页面完成登记后重算）',
    overrides: { revenue_annual_declared: { value: 16000000, grade: 'source_supported' }, entity_identity_verified: { value: true, grade: 'source_supported' },
      equipment_ownership_verified: { value: true, grade: 'source_supported' }, monthly_operating_cash_flow: { value: 170000 },
      monthly_debt_service: { value: 88000 }, equipment_deal_amount: { value: 2100000 },
      total_assets_declared: { value: 10500000 }, total_liabilities_declared: { value: 4600000 } },
    serial: 'SYNTHETIC-MACHINE-c06',
    recipe: { advance: true, demoVerifications: [
      { factKey: 'revenue_annual_declared', value: 16000000, grade: 'confirmed', note: '收入核验：年报原件与税务申报一致（合成）' },
      { factKey: 'entity_identity_verified', value: true, grade: 'confirmed', note: '主体核验：营业执照与实名核验一致（合成）' },
      { factKey: 'equipment_ownership_verified', value: true, grade: 'confirmed', note: '权属核验：登记簿权属清晰（合成）' }] } },
  { caseId: 'case-07', displayOrder: 7, category: '中', businessName: '塔城农机维修连锁',
    summary: '新证据使旧结论复核：设备对价补证（280万→320万）晚于已采用结果，旧候选标陈旧',
    overrides: { revenue_annual_declared: { value: 21000000 }, monthly_operating_cash_flow: { value: 190000 }, monthly_debt_service: { value: 96000 },
      equipment_deal_amount: { value: 2800000 }, total_assets_declared: { value: 14000000 }, total_liabilities_declared: { value: 5900000 } },
    serial: 'SYNTHETIC-MACHINE-c07',
    recipe: { advance: true, adoptDomains: ['business', 'policy', 'credit', 'commerce'],
      supplement: { factKey: 'equipment_deal_amount', value: 3200000, grade: 'confirmed',
        note: '补证：更正版购置合同（合成，supersedes 旧件）' } } },
  { caseId: 'case-08', displayOrder: 8, category: '好', businessName: '昌吉精密模具制造',
    summary: '首次预评估收口：五区已协同并采用，预评估结论待最终人类确认（不批准正式额度）',
    overrides: { revenue_annual_declared: { value: 25000000 }, monthly_operating_cash_flow: { value: 230000 }, monthly_debt_service: { value: 112000 },
      equipment_deal_amount: { value: 3100000 }, total_assets_declared: { value: 17000000 }, total_liabilities_declared: { value: 7200000 } },
    serial: 'SYNTHETIC-MACHINE-c08',
    recipe: { advance: true, adoptDomains: 'all', preassessment: { outcome: 'support', candidateTendency: 'do' } } },
  { caseId: 'case-09', displayOrder: 9, category: '好', businessName: '克拉玛依建材租赁',
    summary: '履约等待外部回执：内部义务完成后如实停靠；模拟回执来源明确，未确认不可结清',
    overrides: { revenue_annual_declared: { value: 19000000 }, monthly_operating_cash_flow: { value: 185000 }, monthly_debt_service: { value: 92000 },
      equipment_deal_amount: { value: 2600000 }, total_assets_declared: { value: 12500000 }, total_liabilities_declared: { value: 5200000 } },
    serial: 'SYNTHETIC-MACHINE-c09',
    recipe: { advance: true, adoptDomains: 'all', cycle: { fulfill: true } } },
  { caseId: 'case-10', displayOrder: 10, category: '好', businessName: '博乐葡萄酒庄设备回租',
    summary: '已结清可返单：完整周期（履约→回执确认→结清→关闭）留痕；返单开启独立新周期',
    overrides: { revenue_annual_declared: { value: 23000000 }, monthly_operating_cash_flow: { value: 215000 }, monthly_debt_service: { value: 104000 },
      equipment_deal_amount: { value: 2900000 }, total_assets_declared: { value: 15500000 }, total_liabilities_declared: { value: 6400000 } },
    serial: 'SYNTHETIC-MACHINE-c10',
    recipe: { advance: true, adoptDomains: 'all', cycle: { fulfill: true, externalReceipt: { ref: 'SIM-WIRE-c10-0001', source: 'manual-attestation' }, settle: true, close: true } } },
];

export const caseFacts = (c) => {
  const out = {};
  for (const [k, base] of Object.entries(BASE_FACTS)) {
    const o = c.overrides?.[k] ?? {};
    out[k] = { ...base, ...o, value: k === 'nameplate_serial' ? c.serial : (o.value ?? base.value) };
  }
  return out;
};
export const TRANSACTION_SCOPE = TRANSACTION;

/** 材料文件划分：financial_summary.csv / equipment_list.csv（case-05 另有 purchase_invoice.csv 冲突件）。 */
export const FINANCIAL_KEYS = ['revenue_annual_declared', 'new_order_amount_declared', 'litigation_pending_declared',
  'total_assets_declared', 'total_liabilities_declared', 'monthly_operating_cash_flow', 'monthly_debt_service',
  'top1_customer_revenue_share', 'proposed_monthly_rent', 'lease_term_months', 'funding_cost_annual', 'fees_known'];
export const EQUIPMENT_KEYS = ['entity_identity_verified', 'equipment_ownership_verified', 'equipment_exists_observed', 'nameplate_serial', 'equipment_deal_amount'];

export function renderCsv(keys, facts) {
  const rows = ['fact_key,value,unit,grade,source_note'];
  for (const k of keys) {
    const f = facts[k];
    const esc = (v) => v === null || v === undefined ? '' : String(v).includes(',') ? `"${String(v)}"` : String(v);
    rows.push([esc(k), esc(f.value), esc(f.unit), esc(f.grade), esc(f.source)].join(','));
  }
  return rows.join('\n') + '\n';
}
