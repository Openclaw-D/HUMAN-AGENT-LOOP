// F 轮 · 六角色种子案例 ×4（合成假设；行业/地区/金额均为案例变量，非真实制度或客户）。
// 形状对齐 six-role-v1；C 包（V7/backend/C/scenarios/six-role-v1.json）就绪后按版本复制接入，
// 种子版本如实标注来源=本文件（F6：不冒充 C 包、不跨目录写）。
// 业务口径：中国大陆商业融资租赁（非银行系金融租赁），小微制造业客群；经营目标=可理解、
// 可定价、可控制风险下的收益质量；倾向是模型/模拟候选，不是正式审批；authority=none。
import type { CaseScenario } from './role-contract';

export const SEED_SCHEMA_VERSION = 'six-role-v1';

// ---------------------------------------------------------------------------
// 案例 1：金属加工 · 成熟设备直租（基线：机制清晰、条件可控）
// ---------------------------------------------------------------------------

const c1: CaseScenario = {
  schemaVersion: SEED_SCHEMA_VERSION,
  id: 'seed-metal-direct',
  code: 'SL-2026-101',
  title: '金属加工直租',
  industry: '金属加工（CNC 精密零件）',
  region: '江苏苏州（合成）',
  leaseMode: '直租',
  customerContext: '经营 9 年小微企业，年营收约 2600 万（申报口径），为下游汽车零部件二级供应商；拟直租 2 台 CNC 走心机，供应商为品牌授权经销商。',
  facts: [
    { id: 'rev', label: '年营业收入（申报）', value: '约 2600 万元', evidenceVersion: 1, status: 'supported' },
    { id: 'flows', label: '对公流水（近 12 个月）', value: '入账约 2900 万元，波动与订单季一致', evidenceVersion: 1, status: 'supported' },
    { id: 'equip', label: '拟租设备', value: 'CNC 走心机 ×2，报价合计 386 万元', evidenceVersion: 1, status: 'unverified' },
    { id: 'debt', label: '对外负债', value: '银行抵押贷款 480 万（月供 5.1 万），无其他已知融资', evidenceVersion: 1, status: 'supported' },
  ],
  unknowns: ['设备最终成交价与交付周期（待供应商合同）', '发票开具时间与金额'],
  roleViews: {
    jianwei: {
      summary: '经营与流水基本吻合、负债结构清晰；当前全局缺口集中在设备价格与权属凭证，属可补证范围，无跨域矛盾。',
      questions: ['设备成交价是否与市场价一致？', '交付周期是否影响租金起算？'],
      tasks: [
        { id: 'jw-1', title: '跟踪设备发票与购销合同登记', status: 'open', evidenceKey: 'invoice', domain: 'asset' },
        { id: 'jw-2', title: '汇总各域意见并给出下一步', status: 'open' },
      ],
      tendency: '谨慎做',
      conditions: ['发票与购销合同到位且价格合理', '首付款比例不低于两成'],
    },
    business: {
      summary: '客户配合度高，经营事实清楚；已取得报价单，等待供应商签约后补发票。',
      questions: ['客户期望的起租时点？'],
      tasks: [
        { id: 'bz-1', title: '催收设备增值税发票', status: 'open', evidenceKey: 'invoice' },
        { id: 'bz-2', title: '确认交付与安装计划', status: 'open' },
      ],
      tendency: '做',
      conditions: ['供应商按期交付'],
    },
    policy: {
      summary: '金属加工设备属于可租赁范围，直租模式适用；未触及禁止类清单。',
      questions: [],
      tasks: [{ id: 'zc-1', title: '复核供应商资质与设备来源合规', status: 'open' }],
      tendency: '做',
      conditions: ['设备非禁止类、来源合法'],
    },
    credit: {
      summary: '申报收入与流水方向一致，负债集中且月供可控；偿债覆盖需在合同价确定后复算。',
      questions: ['是否有对外担保？'],
      tasks: [{ id: 'xd-1', title: '合同价确定后复算偿债覆盖', status: 'open', evidenceKey: 'contract' }],
      tendency: '谨慎做',
      conditions: ['覆盖倍数不低于 1.2'],
    },
    commerce: {
      summary: '报价处于市场常见区间；租期、保证金与利率需按合同价定价。',
      questions: [],
      tasks: [{ id: 'sw-1', title: '按成交价出具租金方案', status: 'open', evidenceKey: 'contract' }],
      tendency: '做',
      conditions: ['报价异常上浮时重议条件'],
    },
    asset: {
      summary: '设备通用性强、二手流通较好；权属与价格凭证未到位前不作确认。',
      questions: ['是否指定二手处置渠道？'],
      tasks: [
        { id: 'zc-a-1', title: '核验设备发票（权属与价格）', status: 'open', evidenceKey: 'invoice' },
        { id: 'zc-a-2', title: '核对购销合同与交付清单', status: 'open', evidenceKey: 'contract' },
      ],
      tendency: '做',
      conditions: ['发票开具方与供应商一致'],
    },
  },
  turns: [
    {
      id: 't-invoice',
      key: 'invoice',
      keywords: ['发票'],
      missingLabel: '设备增值税发票',
      effects: [
        { factId: 'equip', newValue: 'CNC 走心机 ×2，发票金额合计 372 万元（含税）', version: 2, status: 'confirmed' },
      ],
      replies: [
        { roleId: 'asset', text: '发票已核：开票方与供应商一致，金额 372 万略低于报价，权属与价格凭证到位（v2，已确认）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：设备价格与权属已闭环；剩余缺口为购销合同（交付与付款节点），补齐后商务与信审可出候选。', origin: 'model' },
      ],
    },
    {
      id: 't-contract',
      key: 'contract',
      keywords: ['购销合同', '合同'],
      missingLabel: '供应商购销合同',
      effects: [
        { factId: 'equip', newValue: '合同价 372 万，交付期 45 天，预付 30%', version: 3, status: 'confirmed' },
      ],
      replies: [
        { roleId: 'commerce', text: '合同到位：按 372 万出具三年期租金方案，保证金两成；覆盖倍数复算后随附（模拟候选）。', origin: 'preset' },
        { roleId: 'credit', text: '按合同价复算偿债覆盖约 1.35，满足条件；未见新增对外担保（模拟候选，非正式审批）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：缺证全部闭环，各域候选倾向一致（谨慎做，条件=发票合同一致+首付两成+覆盖≥1.2）。下一步：进入正式人工审批流程。', origin: 'model' },
      ],
    },
  ],
  expectedChecks: ['发票-供应商一致', '合同价与报价偏差可解释', '覆盖倍数≥1.2'],
  sourceRefs: ['seed://six-role-20260915/case-metal-direct'],
  domains: [
    { domainId: 'policy', name: '政策', judgmentStatus: 'green', judgmentText: '范围内', segments: ['done', 'done', 'done', 'done'], summary: '直租模式与设备类型均在适用范围（合成）。' },
    { domainId: 'credit', name: '信审', judgmentStatus: 'yellow', judgmentText: '待复算', segments: ['done', 'done', 'current', 'pending'], summary: '待合同价后复算偿债覆盖（合成）。' },
    { domainId: 'commerce', name: '商务', judgmentStatus: 'gray', judgmentText: '准备中', segments: ['current', 'pending', 'pending', 'pending'], summary: '租金方案待合同价（合成）。' },
    { domainId: 'asset', name: '资产', judgmentStatus: 'yellow', judgmentText: '待核验', segments: ['done', 'current', 'pending', 'pending'], summary: '发票与合同为权属前提（合成）。' },
  ],
};

// ---------------------------------------------------------------------------
// 案例 2：印刷 · 老客回租（还款历史好；缺口=流水与所有权凭证）
// ---------------------------------------------------------------------------

const c2: CaseScenario = {
  schemaVersion: SEED_SCHEMA_VERSION,
  id: 'seed-print-saleleaseback',
  code: 'SL-2026-102',
  title: '印刷老客回租',
  industry: '印刷包装（商务印刷）',
  region: '广东东莞（合成）',
  leaseMode: '回租',
  customerContext: '合作 4 年老客户，历史 3 笔租约均正常结清；年营收约 1800 万，拟以 2019 年购入的四色胶印机做售后回租，补充流动资金。',
  facts: [
    { id: 'history', label: '历史履约', value: '3 笔租约正常结清，无逾期记录', evidenceVersion: 1, status: 'confirmed' },
    { id: 'equip', label: '回租设备', value: '四色胶印机 1 台，2019 年购入，评估值 210 万', evidenceVersion: 1, status: 'unverified' },
    { id: 'title', label: '设备所有权', value: '客户自述全款购入、无抵押', evidenceVersion: 1, status: 'unverified' },
    { id: 'flows', label: '对公流水（近 6 个月）', value: '待补充', evidenceVersion: 0, status: 'unknown' },
  ],
  unknowns: ['设备当前是否存在二次抵押', '近 6 个月真实流水'],
  roleViews: {
    jianwei: {
      summary: '老客履约记录是主要正面事实；全局缺口=流水与所有权凭证，两项都影响回租合法性与偿债判断，优先级最高。',
      questions: ['设备是否存在二次融资？', '回租款项用途是否明确？'],
      tasks: [
        { id: 'jw-1', title: '跟踪流水与所有权凭证双缺口', status: 'open' },
      ],
      tendency: '谨慎做',
      conditions: ['所有权清晰且无二次抵押', '流水与申报收入方向一致'],
    },
    business: {
      summary: '客户关系稳定、配合意愿强；用途为旺季备料流动资金，合理性初步成立。',
      questions: ['资金用途能否对应订单？'],
      tasks: [
        { id: 'bz-1', title: '收集近 6 个月对公流水', status: 'open', evidenceKey: 'flows' },
        { id: 'bz-2', title: '取得设备购买合同与付款凭证', status: 'open', evidenceKey: 'title' },
      ],
      tendency: '做',
      conditions: ['用途留档'],
    },
    policy: {
      summary: '存量客户售后回租适用；需确认租赁物非禁租类且客户对其有处分权。',
      questions: [],
      tasks: [{ id: 'zc-1', title: '售后回租适用性复核', status: 'open' }],
      tendency: '做',
      conditions: ['处分权成立'],
    },
    credit: {
      summary: '履约记录良好但收入口径老化；缺流水期间不作偿债结论。',
      questions: ['淡旺季波动幅度？'],
      tasks: [{ id: 'xd-1', title: '流水到位后更新偿债判断', status: 'open', evidenceKey: 'flows' }],
      tendency: '谨慎做',
      conditions: ['流水可验证经营收入'],
    },
    commerce: {
      summary: '老客可沿用历史定价框架；成数按评估值打折，留风险缓冲。',
      questions: [],
      tasks: [{ id: 'sw-1', title: '按评估值与成数出方案', status: 'open' }],
      tendency: '做',
      conditions: ['成数不高于评估值七成'],
    },
    asset: {
      summary: '胶印机流通性一般但本地产业链消化能力可；所有权凭证未核前不放款口径。',
      questions: ['设备所在地点与使用状态？'],
      tasks: [
        { id: 'zc-a-1', title: '核验购买合同与付款凭证（所有权）', status: 'open', evidenceKey: 'title' },
        { id: 'zc-a-2', title: '现场核对铭牌与序列号', status: 'open' },
      ],
      tendency: '谨慎做',
      conditions: ['所有权链清晰'],
    },
  },
  turns: [
    {
      id: 't-flows',
      key: 'flows',
      keywords: ['流水', '银行流水'],
      missingLabel: '近 6 个月对公流水',
      effects: [
        { factId: 'flows', newValue: '入账约 980 万，旺季月均明显高于淡季，与印刷订单季一致', version: 1, status: 'supported' },
      ],
      replies: [
        { roleId: 'credit', text: '流水已核：收入方向与申报一致，季节波动可解释；偿债判断更新为可支持（v1，来源支持）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：流水缺口闭环；剩余关键缺口=设备所有权凭证，权属清晰即可出候选。', origin: 'model' },
      ],
    },
    {
      id: 't-title',
      key: 'title',
      keywords: ['所有权', '购买合同', '付款凭证'],
      missingLabel: '设备购买合同与付款凭证（所有权证明）',
      effects: [
        { factId: 'title', newValue: '2019 年购销合同+全额付款凭证齐备，无二次抵押登记', version: 2, status: 'confirmed' },
      ],
      replies: [
        { roleId: 'asset', text: '所有权链核验通过：合同、付款凭证、无二次抵押登记一致（v2，已确认）；建议现场铭牌核对照常执行。', origin: 'preset' },
        { roleId: 'policy', text: '售后回租适用性维持：客户对设备有处分权，未触及禁止类（模拟候选）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：两项缺口闭环，候选倾向=谨慎做（成数≤七成、用途留档、现场铭牌核对）。下一步：提交正式人工审批。', origin: 'model' },
      ],
    },
  ],
  expectedChecks: ['无二次抵押', '流水与申报方向一致', '成数≤七成'],
  sourceRefs: ['seed://six-role-20260915/case-print-saleleaseback'],
  domains: [
    { domainId: 'policy', name: '政策', judgmentStatus: 'green', judgmentText: '适用', segments: ['done', 'done', 'done', 'done'], summary: '存量客户售后回租适用（合成）。' },
    { domainId: 'credit', name: '信审', judgmentStatus: 'yellow', judgmentText: '缺流水', segments: ['done', 'current', 'pending', 'pending'], summary: '履约好但缺流水（合成）。' },
    { domainId: 'commerce', name: '商务', judgmentStatus: 'green', judgmentText: '框架就绪', segments: ['done', 'done', 'current', 'done'], summary: '老客定价框架沿用（合成）。' },
    { domainId: 'asset', name: '资产', judgmentStatus: 'red', judgmentText: '权属未核', segments: ['done', 'current', 'pending', 'pending'], summary: '所有权凭证未核（合成）。' },
  ],
};

// ---------------------------------------------------------------------------
// 案例 3：注塑 · 权属疑点（风险机制=隐性共有/二次融资；补证后解除或升级）
// ---------------------------------------------------------------------------

const c3: CaseScenario = {
  schemaVersion: SEED_SCHEMA_VERSION,
  id: 'seed-molding-title-dispute',
  code: 'SL-2026-103',
  title: '注塑权属疑点',
  industry: '塑料注塑（家电配件）',
  region: '浙江宁波（合成）',
  leaseMode: '直租',
  customerContext: '经营 5 年注塑厂，年营收约 1200 万；拟直租注塑机 1 台 96 万。初核发现设备可能存在经销商融资留存（隐性共有）。',
  facts: [
    { id: 'rev', label: '年营业收入', value: '约 1200 万元', evidenceVersion: 1, status: 'supported' },
    { id: 'equip', label: '拟租设备', value: '注塑机 1 台，报价 96 万；经销商提示可能存在尾款融资', evidenceVersion: 1, status: 'unverified' },
    { id: 'title', label: '设备权属', value: '存疑：可能登记在经销商融资池', evidenceVersion: 1, status: 'unknown' },
    { id: 'debt', label: '对外负债', value: '两笔租赁月供合计 3.2 万', evidenceVersion: 1, status: 'supported' },
  ],
  unknowns: ['经销商融资池是否包含本设备', '尾款结清凭证'],
  roleViews: {
    jianwei: {
      summary: '全局阻塞点唯一且明确：设备权属。权属不解除，其余各域推进都没有意义；这是跨域依赖的根。',
      questions: ['经销商融资池清单能否取得？', '尾款由谁支付、何时结清？'],
      tasks: [
        { id: 'jw-1', title: '权属疑点为全局阻塞项，跟踪解除', status: 'open', evidenceKey: 'title-clear' },
      ],
      tendency: '调整条件后做',
      conditions: ['权属疑点书面解除前不推进签约'],
    },
    business: {
      summary: '客户解释为经销商尾款融资、已计划结清；需要书面凭证而非口头说明。',
      questions: ['结清计划的时间表？'],
      tasks: [{ id: 'bz-1', title: '取得结清证明与经销商确权函', status: 'open', evidenceKey: 'title-clear' }],
      tendency: '调整条件后做',
      conditions: ['确权函原件'],
    },
    policy: {
      summary: '直租适用性无障碍；但权属争议设备不得入租赁物清单。',
      questions: [],
      tasks: [{ id: 'zc-1', title: '确权后复核租赁物清单', status: 'open', evidenceKey: 'title-clear' }],
      tendency: '谨慎做',
      conditions: ['租赁物权属清晰'],
    },
    credit: {
      summary: '偿债能力本身不弱（月供 3.2 万 vs 收入 1200 万）；风险集中在或有负债与权属连带。',
      questions: ['两笔存量租赁是否含本设备？'],
      tasks: [{ id: 'xd-1', title: '排除存量租赁与本设备的重合', status: 'open' }],
      tendency: '调整条件后做',
      conditions: ['无重合融资'],
    },
    commerce: {
      summary: '报价 96 万处于常见区间；权属未明前不出正式报价，可给条件式意向。',
      questions: [],
      tasks: [{ id: 'sw-1', title: '确权后出正式方案', status: 'open', evidenceKey: 'title-clear' }],
      tendency: '调整条件后做',
      conditions: ['确权为定价前提'],
    },
    asset: {
      summary: '注塑机流通性尚可；权属疑点是本域红线——融资池设备不得直租，必须确权或更换标的。',
      questions: ['能否更换为无争议设备？'],
      tasks: [{ id: 'zc-a-1', title: '取得经销商确权函/融资池清单', status: 'open', evidenceKey: 'title-clear' }],
      tendency: '不做（现状）',
      conditions: ['确权解除疑点后重评'],
    },
  },
  turns: [
    {
      id: 't-title-clear',
      key: 'title-clear',
      keywords: ['确权', '结清证明', '融资池', '确权函'],
      missingLabel: '经销商确权函/尾款结清证明',
      effects: [
        { factId: 'title', newValue: '经销商确权函+结清证明齐备：设备不在融资池，权属清晰可直租', version: 2, status: 'confirmed' },
      ],
      replies: [
        { roleId: 'asset', text: '确权函与结清证明已核：权属疑点解除（v2，已确认）；直租可推进，建议交付时铭牌复核。', origin: 'preset' },
        { roleId: 'policy', text: '租赁物清单复核通过：权属清晰、非禁租类（模拟候选）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：全局阻塞项解除，各域从"调整条件后做"恢复推进；下一步=商务出正式方案+信审复算。', origin: 'model' },
      ],
    },
    {
      id: 't-quote',
      key: 'quote',
      keywords: ['方案', '报价', '正式方案'],
      missingLabel: '商务正式方案（确权后）',
      effects: [
        { factId: 'equip', newValue: '成交价 94 万（含运输安装），三年期方案已出具', version: 2, status: 'supported' },
      ],
      replies: [
        { roleId: 'commerce', text: '正式方案已出：94 万三年期、保证金 15%，覆盖倍数按客户流水口径可支持（模拟候选）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：全链路闭环（权属→方案）。候选倾向=做（条件：交付铭牌复核、确权函原件归档）。', origin: 'model' },
      ],
    },
  ],
  expectedChecks: ['确权函原件归档', '排除重合融资', '交付铭牌复核'],
  sourceRefs: ['seed://six-role-20260915/case-molding-title-dispute'],
  domains: [
    { domainId: 'policy', name: '政策', judgmentStatus: 'gray', judgmentText: '待确权', segments: ['done', 'current', 'pending', 'pending'], summary: '确权后复核清单（合成）。' },
    { domainId: 'credit', name: '信审', judgmentStatus: 'yellow', judgmentText: '排查重合', segments: ['done', 'done', 'current', 'pending'], summary: '排除重合融资（合成）。' },
    { domainId: 'commerce', name: '商务', judgmentStatus: 'gray', judgmentText: '条件式意向', segments: ['done', 'pending', 'pending', 'pending'], summary: '确权为定价前提（合成）。' },
    { domainId: 'asset', name: '资产', judgmentStatus: 'red', judgmentText: '权属红线', segments: ['current', 'pending', 'pending', 'pending'], summary: '融资池疑点未解除（合成）。' },
  ],
};

// ---------------------------------------------------------------------------
// 案例 4：包装 · 现金流口径变化（风险机制=申报口径与流水口径差异，非造假即解释）
// ---------------------------------------------------------------------------

const c4: CaseScenario = {
  schemaVersion: SEED_SCHEMA_VERSION,
  id: 'seed-packaging-caliber',
  code: 'SL-2026-104',
  title: '包装现金流口径变化',
  industry: '纸品包装（食品外包装）',
  region: '湖南长沙（合成）',
  leaseMode: '回租',
  customerContext: '经营 7 年包装厂，年营收申报约 3000 万，但本年申报口径剔除了一块贸易性收入；拟回租模切机 1 台 150 万。',
  facts: [
    { id: 'rev', label: '年营业收入（申报）', value: '约 3000 万（本年口径剔除贸易收入，上年约 4200 万）', evidenceVersion: 1, status: 'supported' },
    { id: 'flows', label: '对公流水', value: '全年入账约 4100 万，含贸易往来', evidenceVersion: 1, status: 'supported' },
    { id: 'caliber', label: '口径差异解释', value: '待补充：贸易收入剥离的合同与结算方式', evidenceVersion: 0, status: 'unknown' },
    { id: 'equip', label: '回租设备', value: '模切机 1 台，评估值 150 万', evidenceVersion: 1, status: 'unverified' },
  ],
  unknowns: ['剥离的贸易业务是否真实独立结算', '核心制造收入稳定性'],
  roleViews: {
    jianwei: {
      summary: '全局矛盾=两套口径（申报 3000 万 vs 流水 4100 万）；是解释问题还是收入虚增，取决于贸易剥离证据，属跨域核对事项。',
      questions: ['贸易剥离是否有独立合同与发票流？', '制造收入近 3 年趋势？'],
      tasks: [{ id: 'jw-1', title: '推动口径差异书面解释并交叉核对', status: 'open', evidenceKey: 'caliber' }],
      tendency: '调整条件后做',
      conditions: ['口径差异取得可核证据前不作收入结论'],
    },
    business: {
      summary: '客户主动说明口径变化（剥离低毛利贸易），态度配合；需把口头解释转成凭证。',
      questions: ['剥离后贸易客户是否仍有往来？'],
      tasks: [{ id: 'bz-1', title: '取得贸易剥离的合同与结算说明', status: 'open', evidenceKey: 'caliber' }],
      tendency: '做',
      conditions: ['解释留档'],
    },
    policy: {
      summary: '回租适用性无障碍；口径问题不涉准入，属核验范畴。',
      questions: [],
      tasks: [{ id: 'zc-1', title: '维持适用性结论', status: 'open' }],
      tendency: '做',
      conditions: [],
    },
    credit: {
      summary: '按制造口径测算偿债覆盖是关键：混入口径会高估收入，剥离后覆盖待复算。',
      questions: ['剥离部分的应收是否已回款？'],
      tasks: [{ id: 'xd-1', title: '剥离后复算偿债覆盖', status: 'open', evidenceKey: 'caliber' }],
      tendency: '谨慎做',
      conditions: ['按制造口径覆盖≥1.2'],
    },
    commerce: {
      summary: '包装行业利薄，定价需按真实制造收入对应现金流设计，不按名义流水。',
      questions: [],
      tasks: [{ id: 'sw-1', title: '按剥离口径出租金方案', status: 'open', evidenceKey: 'caliber' }],
      tendency: '调整条件后做',
      conditions: ['按可验证经营现金流定价'],
    },
    asset: {
      summary: '模切机本地流通良好；本案例风险不在设备，权属与评估正常推进。',
      questions: ['设备使用年限与保养记录？'],
      tasks: [{ id: 'zc-a-1', title: '常规核验：评估报告与现场', status: 'open' }],
      tendency: '做',
      conditions: [],
    },
  },
  turns: [
    {
      id: 't-caliber',
      key: 'caliber',
      keywords: ['口径', '剥离', '贸易'],
      missingLabel: '贸易剥离的合同与结算说明',
      effects: [
        { factId: 'caliber', newValue: '贸易剥离有独立购销合同与对公结算，2026 年起终止；制造收入约 2950 万且三年平稳', version: 1, status: 'supported' },
      ],
      replies: [
        { roleId: 'credit', text: '口径差异取得书面解释：制造口径收入约 2950 万，覆盖复算≈1.3（v1，来源支持）；申报与流水矛盾可解释，非虚增信号。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：跨域矛盾解除——两套口径已有凭证级解释；剩余=按制造口径出方案并完成常规设备核验。', origin: 'model' },
      ],
    },
    {
      id: 't-plan',
      key: 'plan',
      keywords: ['方案', '租金'],
      missingLabel: '按制造口径的租金方案',
      effects: [
        { factId: 'equip', newValue: '回租方案：成数六成（90 万）、两年期，租金按制造现金流设计', version: 2, status: 'supported' },
      ],
      replies: [
        { roleId: 'commerce', text: '方案已出：按制造口径现金流设计，成数主动降到六成留缓冲（模拟候选，非正式审批）。', origin: 'preset' },
        { roleId: 'jianwei', text: '见微汇总：闭环。候选倾向=调整条件后做（口径解释留档+成数六成+按季度核对流水）。下一步：正式人工审批。', origin: 'model' },
      ],
    },
  ],
  expectedChecks: ['口径解释有合同与发票流', '按制造口径覆盖≥1.2', '成数≤六成'],
  sourceRefs: ['seed://six-role-20260915/case-packaging-caliber'],
  domains: [
    { domainId: 'policy', name: '政策', judgmentStatus: 'green', judgmentText: '适用', segments: ['done', 'done', 'done', 'done'], summary: '回租适用（合成）。' },
    { domainId: 'credit', name: '信审', judgmentStatus: 'yellow', judgmentText: '口径核对', segments: ['done', 'done', 'current', 'pending'], summary: '剥离后复算覆盖（合成）。' },
    { domainId: 'commerce', name: '商务', judgmentStatus: 'yellow', judgmentText: '待口径', segments: ['done', 'current', 'pending', 'pending'], summary: '按真实现金流定价（合成）。' },
    { domainId: 'asset', name: '资产', judgmentStatus: 'green', judgmentText: '常规核验', segments: ['done', 'done', 'current', 'pending'], summary: '设备风险不高（合成）。' },
  ],
};

export const SEED_SCENARIOS: readonly CaseScenario[] = [c1, c2, c3, c4];

export function findSeedScenario(id: string): CaseScenario | null {
  return SEED_SCENARIOS.find((s) => s.id === id) ?? null;
}
