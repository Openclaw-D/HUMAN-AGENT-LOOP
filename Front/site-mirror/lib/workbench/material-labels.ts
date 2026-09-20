const labels: Record<string,string> = {
  invoice:'设备发票', bank_statement:'银行流水', equipment_list:'设备清单', entity_register:'主体登记',
  purchase_contract:'采购合同', business_license:'营业执照', financial_statement:'财务报表',
  legal_document:'法律文件', ownership_document:'权属证明', litigation_document:'诉讼材料', parse_extraction:'材料提取结果',
};
export function materialKindName(kind: string) {
  const value = kind.replace(/^material\./,'');
  return labels[value] ?? (/[\u4e00-\u9fff]/.test(value) ? value : '客户材料');
}
