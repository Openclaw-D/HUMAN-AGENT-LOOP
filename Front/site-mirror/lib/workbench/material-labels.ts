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
