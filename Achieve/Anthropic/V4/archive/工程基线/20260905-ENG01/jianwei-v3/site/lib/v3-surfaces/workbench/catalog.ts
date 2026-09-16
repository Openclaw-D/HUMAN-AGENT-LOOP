import type {
  ProfessionalPerspective,
  WorkbenchProfessionalSpec,
} from './types.ts';

export const PROFESSIONAL_SPECS: Readonly<Record<ProfessionalPerspective, WorkbenchProfessionalSpec>> = Object.freeze({
  policy: {
    perspective: 'policy',
    label: '政策',
    principalId: 'risk-policy',
    quadrant: 'top-right',
    weightPercent: 25,
    evidenceRequirements: [
      { evidenceName: '主体与工商登记材料', expectedSource: '客户提交 / 公开登记信息' },
      { evidenceName: '设备采购与租赁结构材料', expectedSource: '业务尽调 / 交易方案' },
      { evidenceName: '政策例外与适用说明', expectedSource: '政策规则库 / 具名政策人员' },
    ],
    ruleName: '融资租赁准入与政策例外规则',
    rulePurpose: '核验主体、行业、设备与交易结构是否命中准入、禁止或例外边界。',
    modelTask: '形成规则命中、缺口与例外的候选解释。',
    humanGateLabel: '政策例外 / 规则冲突 Human Gate',
  },
  credit: {
    perspective: 'credit',
    label: '信审',
    principalId: 'risk-credit',
    quadrant: 'bottom-right',
    weightPercent: 25,
    evidenceRequirements: [
      { evidenceName: '近两年财务报表', expectedSource: '客户财务材料' },
      { evidenceName: '近六个月订单、交付与回款说明', expectedSource: '客户经营材料 / 业务尽调' },
      { evidenceName: '征信与有息负债清单', expectedSource: '受控征信来源 / 客户确认' },
    ],
    ruleName: '信用风险、偿债能力与现金流核验规则',
    rulePurpose: '核验经营稳定性、负债压力、现金流覆盖与关键事实冲突。',
    modelTask: '形成信用风险候选判断、证据链与待人工问题。',
    humanGateLabel: '最终信审结论 Human Gate',
  },
  commercial: {
    perspective: 'commercial',
    label: '商务',
    principalId: 'risk-commercial',
    quadrant: 'bottom-left',
    weightPercent: 25,
    evidenceRequirements: [
      { evidenceName: '租赁合同与核心交易条件', expectedSource: '商务合同草案' },
      { evidenceName: '设备清单、序列号与物流单据', expectedSource: '供应商 / 物流查验' },
      { evidenceName: '付款条件与收款账户核验', expectedSource: '商务付款材料 / 受控账户核验' },
    ],
    ruleName: '合同、付款与交易执行条件规则',
    rulePurpose: '核验合同义务、信审条件、设备一致性、付款前提与外部回执。',
    modelTask: '形成合同偏差、付款条件与物流缺口的候选清单。',
    humanGateLabel: '合同生效 / 付款 / 起租条件 Human Gate',
  },
  asset: {
    perspective: 'asset',
    label: '资产',
    principalId: 'risk-asset',
    quadrant: 'top-left',
    weightPercent: 25,
    evidenceRequirements: [
      { evidenceName: '设备发票与权属凭证', expectedSource: '供应商 / 资产档案' },
      { evidenceName: '到货、验收与现场查验记录', expectedSource: '现场查验 / 业务与资产人员' },
      { evidenceName: '保险与租后监测材料', expectedSource: '保险凭证 / 资产管理记录' },
    ],
    ruleName: '资产真实性、权属、价值与存续管理规则',
    rulePurpose: '核验设备真实性、权属、交付验收、保险与租后风险信号。',
    modelTask: '形成资产候选档案、异常信号与待处置建议。',
    humanGateLabel: '资产查验 / 催收 / 处置 Human Gate',
  },
});

export const PROFESSIONAL_QUADRANTS = Object.freeze({
  policy: 'top-right',
  credit: 'bottom-right',
  commercial: 'bottom-left',
  asset: 'top-left',
} as const);

export const PROFESSIONAL_PRINCIPALS = Object.freeze({
  policy: 'risk-policy',
  credit: 'risk-credit',
  commercial: 'risk-commercial',
  asset: 'risk-asset',
} as const);
