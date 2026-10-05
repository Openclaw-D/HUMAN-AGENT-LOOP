const labels: Record<string,string> = {
  invoice:'设备发票', bank_statement:'银行流水', equipment_list:'设备清单', entity_register:'主体登记',
  purchase_contract:'采购合同', business_license:'营业执照', financial_statement:'财务报表',
  legal_document:'法律文件', ownership_document:'权属证明', litigation_document:'诉讼材料', parse_extraction:'材料提取结果',
};
export function materialKindName(kind: string) {
  const value = kind.replace(/^material\./,'');
  return labels[value] ?? (/[\u4e00-\u9fff]/.test(value) ? value : '客户材料');
}

/** Visual classification only; never changes the server's material type or evidence. */
export function materialObjectName(kind: string, filename = ''): string {
  const value = kind.replace(/^material\./, '');
  const objects: Record<string, string> = {
    bank_statement:'statement', financial_statement:'statement', invoice:'statement',
    purchase_contract:'commerce', legal_document:'commerce',
    entity_register:'license', business_license:'license', ownership_document:'license',
    equipment_list:'equipment', device_photo:'equipment', site_photo:'equipment', ledger_book:'statement', parse_extraction:'analysis',
  };
  if (objects[value]) return objects[value];
  if (/合同|协议/.test(filename)) return 'commerce';
  if (/流水|财务|报表|发票|收支/.test(filename)) return 'statement';
  if (/执照|主体登记|权属|登记资料/.test(filename)) return 'license';
  if (/设备|生产|库存/.test(filename)) return 'equipment';
  return 'materials';
}

// LT-02 UI-A：材料登记名缺失（无 materialFileMeta.name/displayName）时的可读区分标签。
// 事实键→业务事实名（与 Back/B column-dependencies KEYSETS 同键集，键派生自服务端）；
// 未知键返回 null 如实回退类名，不编造名称、不猜日期、不删原件/历史。
const FACT_KEY_LABELS: Record<string, string> = {
  revenue_annual_declared: '年收入申报', new_order_amount_declared: '在手订单申报',
  litigation_pending_declared: '涉诉申报', total_assets_declared: '总资产申报',
  total_liabilities_declared: '总负债申报',
  monthly_operating_cash_flow: '月经营现金流', monthly_debt_service: '月还款额',
  new_debt_monthly_payment: '新增债务月供', top1_customer_revenue_share: '第一大客户收入占比',
  video_liveliness: '视频活体核验', material_page_count: '材料页数',
  lease_term_months: '租赁期限', proposed_monthly_rent: '建议月租',
  funding_cost_annual: '资金成本年化', fees_known: '费用确认',
  equipment_ownership_verified: '设备权属核验', equipment_exists_observed: '设备存在核验',
  equipment_deal_amount: '设备对价', nameplate_serial: '铭牌序列号', equipment_model: '设备型号',
  entity_identity_verified: '主体身份核验', transaction_scope: '交易范围',
};
export function factKeyLabel(factKey: string | null | undefined): string | null {
  if (!factKey) return null;
  return FACT_KEY_LABELS[String(factKey)] ?? null;
}
