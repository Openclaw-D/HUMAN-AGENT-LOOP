export const V3_SCENARIO_REF = Object.freeze({
  scenarioId: 'JW-V3-DL-GOLDEN-001',
  scenarioVersion: '1.0.0-macro',
  seed: 'jw-v3-dl-golden-seed-001',
  businessItemType: 'FinancingLeasingCase',
  caseId: 'FL-DEMO-001',
  leaseMode: 'direct-lease',
  dataClass: 'synthetic_deidentified_demo',
} as const);

export const V3_SCENARIO_PROCESS_IDS = Object.freeze([
  'opportunity',
  'policy',
  'credit',
  'commercial',
  'asset',
] as const);

export const V3_SCENARIO_PRINCIPAL_IDS = Object.freeze([
  'collaboration-manager',
  'business-owner',
  'risk-policy',
  'risk-credit',
  'risk-commercial',
  'risk-asset',
  'external-customer',
  'external-supplier',
] as const);

export type V3ScenarioProcessId = (typeof V3_SCENARIO_PROCESS_IDS)[number];
export type V3ScenarioPrincipalId = (typeof V3_SCENARIO_PRINCIPAL_IDS)[number];

export type V3ScenarioCase = {
  businessItemType: 'FinancingLeasingCase';
  caseId: string;
  caseTier: 'golden' | 'background';
  readOnly: boolean;
  backendScope: 'golden-case-authority' | 'background-read-projection';
  title: string;
  counterparty: string;
  industry: string;
  region: string;
  amount: string;
  summary: string;
  phase: string;
  signal: 'normal' | 'attention' | 'elevated';
  nextMilestone: string;
  commencementBand: 0 | 1 | 2 | 3 | 4 | 5;
  lifecycleStatus: 'pre_commencement' | 'material_collection' | 'active_lease' | 'closed';
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const V3_SCENARIO_CASES = deepFreeze<Array<V3ScenarioCase>>([
  {
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-DEMO-001',
    caseTier: 'golden',
    readOnly: false,
    backendScope: 'golden-case-authority',
    title: '智能产线设备直接租赁',
    counterparty: '华东智造科技有限公司',
    industry: '装备制造',
    region: '江苏 · 苏州',
    amount: '2,800 万',
    summary: '固定直接租赁 Golden Case，从商机事实到正式起租。',
    phase: '商机事实待确认',
    signal: 'attention',
    nextMilestone: 'T1 商机事实包确认',
    commencementBand: 0,
    lifecycleStatus: 'pre_commencement',
  },
  {
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-BG-001',
    caseTier: 'background',
    readOnly: true,
    backendScope: 'background-read-projection',
    title: '精密注塑设备扩产租赁',
    counterparty: '科创精密工业有限公司',
    industry: '精密制造',
    region: '浙江 · 宁波',
    amount: '1,650 万',
    summary: '设备扩产商机已建立，正在形成首轮材料清单。',
    phase: '商机导入',
    signal: 'normal',
    nextMilestone: '确认购机动机与交付计划',
    commencementBand: 0,
    lifecycleStatus: 'material_collection',
  },
  {
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-BG-002',
    caseTier: 'background',
    readOnly: true,
    backendScope: 'background-read-projection',
    title: '冷链仓储自动化改造',
    counterparty: '鲜达冷链科技有限公司',
    industry: '冷链物流',
    region: '山东 · 青岛',
    amount: '2,120 万',
    summary: '政策条件已形成，信审仍有关键事实待确认。',
    phase: '信审补件',
    signal: 'elevated',
    nextMilestone: '确认关联方资金往来',
    commencementBand: 2,
    lifecycleStatus: 'pre_commencement',
  },
  {
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-BG-003',
    caseTier: 'background',
    readOnly: true,
    backendScope: 'background-read-projection',
    title: '锂电检测线设备租赁',
    counterparty: '新能检测技术有限公司',
    industry: '新能源',
    region: '安徽 · 合肥',
    amount: '3,400 万',
    summary: '交易已起租，当前保持正常在租并进入资产观察。',
    phase: '正常在租',
    signal: 'normal',
    nextMilestone: '下一期租金回收',
    commencementBand: 5,
    lifecycleStatus: 'active_lease',
  },
  {
    businessItemType: 'FinancingLeasingCase',
    caseId: 'FL-BG-004',
    caseTier: 'background',
    readOnly: true,
    backendScope: 'background-read-projection',
    title: '食品包装产线升级租赁',
    counterparty: '丰源食品工业有限公司',
    industry: '食品加工',
    region: '河南 · 郑州',
    amount: '1,380 万',
    summary: '本金、利息与开票事项均已结清，保留为组合对照摘要。',
    phase: '已关闭',
    signal: 'normal',
    nextMilestone: '无未结事项',
    commencementBand: 5,
    lifecycleStatus: 'closed',
  },
]);

export const V3_SCENARIO_COLLABORATION = deepFreeze({
  objective: {
    title: '补齐关键证据，推动项目具备正式起租条件',
    description: '协同组织推进，专业判断与 Gate 仍由具名专业人员完成。',
    status: 'active' as const,
  },
  thread: {
    threadId: 'FL-DEMO-001-INTERNAL',
    title: '精密零件产线融资租赁协同复核',
    members: [
      { principalId: 'business-owner', processId: 'opportunity', label: '业务', ownerLabel: '陈屿' },
      { principalId: 'risk-policy', processId: 'policy', label: '政策', ownerLabel: '林澄' },
      { principalId: 'risk-credit', processId: 'credit', label: '信审', ownerLabel: '周岚' },
      { principalId: 'risk-commercial', processId: 'commercial', label: '商务', ownerLabel: '顾衡' },
      { principalId: 'risk-asset', processId: 'asset', label: '资产', ownerLabel: '许棠' },
    ] satisfies Array<{
      principalId: V3ScenarioPrincipalId;
      processId: V3ScenarioProcessId;
      label: string;
      ownerLabel: string;
    }>,
    entries: [
      {
        entryId: 'SCENARIO-COLLAB-001',
        actorLabel: '信审 · 周岚',
        processId: 'credit',
        text: '订单稳定性证据仍需补齐，请业务补充最近六个月交付与回款说明。',
        kind: 'scenario' as const,
        contextVersion: 'CTX-0000',
        recordedAt: null,
        authority: 'none' as const,
      },
      {
        entryId: 'SCENARIO-COLLAB-002',
        actorLabel: '商务 · 顾衡',
        processId: 'commercial',
        text: '物流查验检查项已预置，等待设备一致性回执。',
        kind: 'scenario' as const,
        contextVersion: 'CTX-0000',
        recordedAt: null,
        authority: 'none' as const,
      },
      {
        entryId: 'SCENARIO-COLLAB-003',
        actorLabel: '资产 · 许棠',
        processId: 'asset',
        text: '建议设备到货后 48 小时内完成一次现场查验。',
        kind: 'scenario' as const,
        contextVersion: 'CTX-0000',
        recordedAt: null,
        authority: 'none' as const,
      },
    ],
  },
  blockers: [
    {
      blockerId: 'ORDER-STABILITY',
      title: '订单稳定性',
      detail: '补充最近六个月交付、回款与主要客户变化说明。',
      ownerProcessId: 'opportunity',
      status: 'needs-evidence' as const,
    },
    {
      blockerId: 'DEVICE-CONSISTENCY',
      title: '设备一致性',
      detail: '等待设备清单与到货查验范围形成同一口径。',
      ownerProcessId: 'commercial',
      status: 'in-preparation' as const,
    },
    {
      blockerId: 'SITE-INSPECTION',
      title: '现场查验',
      detail: '设备到货后 48 小时内完成一次现场核验。',
      ownerProcessId: 'asset',
      status: 'waiting' as const,
    },
  ] satisfies Array<{
    blockerId: string;
    title: string;
    detail: string;
    ownerProcessId: V3ScenarioProcessId;
    status: 'needs-evidence' | 'in-preparation' | 'waiting';
  }>,
  workItems: [
    { processId: 'opportunity', label: '业务', task: '补充订单与回款说明' },
    { processId: 'policy', label: '政策', task: '核对例外适用条件' },
    { processId: 'credit', label: '信审', task: '复核订单稳定性' },
    { processId: 'commercial', label: '商务', task: '等待设备一致性回执' },
    { processId: 'asset', label: '资产', task: '准备到货现场查验' },
  ] satisfies Array<{ processId: V3ScenarioProcessId; label: string; task: string }>,
});

export type V3ScenarioTransition = {
  transitionCode: 'T1' | 'T2' | 'T3';
  commitPrincipalId: V3ScenarioPrincipalId;
  evidencePrincipalIds: Array<V3ScenarioPrincipalId>;
  invitationId: string | null;
  maxContextCommits: 1;
  triggersProcessIds: Array<V3ScenarioProcessId>;
  creditRegressionRequired: boolean;
};

export const V3_SCENARIO_TRANSITIONS = deepFreeze<Array<V3ScenarioTransition>>([
  {
    transitionCode: 'T1',
    commitPrincipalId: 'business-owner',
    evidencePrincipalIds: ['business-owner'],
    invitationId: null,
    maxContextCommits: 1,
    triggersProcessIds: [...V3_SCENARIO_PROCESS_IDS],
    creditRegressionRequired: false,
  },
  {
    transitionCode: 'T2',
    commitPrincipalId: 'external-customer',
    evidencePrincipalIds: ['external-customer'],
    invitationId: 'INV-CUSTOMER-RISK-001',
    maxContextCommits: 1,
    triggersProcessIds: [...V3_SCENARIO_PROCESS_IDS],
    creditRegressionRequired: true,
  },
  {
    transitionCode: 'T3',
    commitPrincipalId: 'business-owner',
    evidencePrincipalIds: ['external-customer', 'external-supplier'],
    invitationId: null,
    maxContextCommits: 1,
    triggersProcessIds: [...V3_SCENARIO_PROCESS_IDS],
    creditRegressionRequired: false,
  },
]);

const BASELINE = deepFreeze({
  scenarioRef: V3_SCENARIO_REF,
  contextSeq: 0,
  contextVersion: 'CTX-0000',
  transitionCode: 'BASELINE' as const,
  cases: V3_SCENARIO_CASES,
  processRuns: [] as Array<unknown>,
  gates: [] as Array<unknown>,
  receipts: [] as Array<unknown>,
  commencement: {
    band: 0 as 0 | 1 | 2 | 3 | 4 | 5,
    status: 'pre_commencement' as const,
    lifecycleStatus: 'pre_commencement' as const,
  },
});

export function getV3ScenarioBaseline() {
  return structuredClone(BASELINE);
}
