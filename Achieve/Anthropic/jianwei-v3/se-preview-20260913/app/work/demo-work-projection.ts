export const DEMO_WORK_PROJECTION = {
  projection: {
    label: '演示只读投影',
    readOnly: true,
    notice: '以下内容均为合成演示，不代表真实客户、生产数据或已执行的正式动作。',
  },
  identity: {
    caseId: 'V4-DEMO-DIRECT-EX-001',
    attemptId: 'ATTEMPT-DEMO-02',
    contextVersion: 'ctx-demo-004',
    businessMode: '直租',
    reviewPath: '非标例外',
  },
  origin: {
    channel: '供应商推荐',
    collectedBy: '业务人员收集',
    statement: '直租事项由供应商推荐进入，业务人员完成初始材料收集后提交信审。',
  },
  summary: {
    title: '设备采购方案触发信审例外',
    happened:
      '规则筛查发现设备回购安排与现行适用条件不完全一致，无法自动覆盖。事项已补充关键材料，并由具名信审人员完成演示确认。',
    currentState: '信审确认已形成演示凭证，等待商务承接；资产准备和起租均未开始。',
  },
  storyline: [
    {
      id: 'origin',
      label: '从哪里来',
      title: '供应商推荐',
      detail: '业务人员收集直租初始材料',
      state: 'done',
    },
    {
      id: 'credit',
      label: '走到哪里',
      title: '进入信审',
      detail: '规则筛查后转例外审查',
      state: 'done',
    },
    {
      id: 'rule-stop',
      label: '为什么停住',
      title: '规则未覆盖',
      detail: '回购安排含附加条件',
      state: 'exception',
    },
    {
      id: 'evidence',
      label: '依据是什么',
      title: '证据已补齐',
      detail: '采购清单、补充说明、尽调纪要',
      state: 'done',
    },
    {
      id: 'candidate',
      label: '智能做什么',
      title: '只提供建议',
      detail: '无正式决定权',
      state: 'support',
    },
    {
      id: 'human',
      label: '谁来决定',
      title: '具名人工确认',
      detail: '周予安（演示姓名）',
      state: 'done',
    },
    {
      id: 'receipt',
      label: '形成什么',
      title: '结果凭证',
      detail: '仅信审通过',
      state: 'done',
    },
    {
      id: 'handoff',
      label: '交给谁',
      title: '商务承接',
      detail: '再转资产；起租未开始',
      state: 'current',
    },
  ],
  ruleException: {
    ruleVersion: 'credit-rule-demo-v2.4',
    title: '为什么规则不能自动覆盖',
    reason:
      '回购安排包含附加条件，超过确定性规则的适用范围；规则只能标记例外并转人工，不能据此自动通过或否决。',
    outcome: '转具名人工确认',
  },
  evidence: [
    {
      id: 'EVD-DEMO-101',
      title: '设备采购清单',
      source: '业务提交 · 合成材料',
      status: '已核对',
      detail: '设备型号、数量与报价口径一致。',
    },
    {
      id: 'EVD-DEMO-102',
      title: '回购安排补充说明',
      source: '业务补证 · 合成材料',
      status: '已补充',
      detail: '补充触发条件、责任主体与有效期。',
    },
    {
      id: 'EVD-DEMO-103',
      title: '现场尽调纪要',
      source: '业务尽调 · 去标识演示',
      status: '已接收',
      detail: '生产场地与设备用途已形成演示记录。',
    },
  ],
  gaps: [
    {
      label: '信审缺口',
      status: '已补齐',
      detail: '回购附加条件已形成补充说明，并保留原材料关系。',
    },
    {
      label: '后续缺口',
      status: '待商务核验',
      detail: '商务条款、资产交付条件尚未确认，因此不能进入起租。',
    },
  ],
  candidate: {
    title: '智能建议：可在限定条件下继续信审',
    modelVersion: 'candidate-demo-v1.2',
    authority: 'none',
    rationale:
      '已补材料能够解释规则例外来源；建议人工核对回购责任主体，并把商务条款核验列为后续条件。',
    boundary: '模型只提供建议，不作正式决定。',
  },
  humanGate: {
    actorId: 'actor-demo-credit-01',
    actorName: '周予安（演示姓名）',
    roleLabel: '具名信审复核人',
    policyVersion: 'human-credit-policy-demo-v0.3',
    confirmation: '已确认：本次信审通过，并保留商务条款核验条件。',
    permissionBoundary: '具体岗位到动作的权限仍以组织确认后的规则为准，本页不硬编码。',
  },
  receipt: {
    receiptId: 'RCT-DEMO-CREDIT-204',
    status: '演示链路已记录',
    action: '具名人工确认信审通过',
    result: '仅信审通过，待商务/资产',
    notice: '这是演示结果凭证的只读投影，不代表后端动作成功。',
  },
  lifecycle: {
    credit: '信审通过（人工）',
    commercial: '待承接',
    asset: '未开始',
    commencement: '未开始',
  },
  handoff: {
    owner: '商务承接人（待分配），完成后转资产准备',
    nextAction: '核验商务条款与交付条件',
    guardrail: '商务、资产分别就绪且收到可验证凭证前，起租保持未开始。',
  },
  decisionSemantics: [
    {
      code: 'return_for_supplement',
      label: '退回补证',
      confirmation: '当前具名复核人确认补证清单、责任人和截止时间',
      result: '非终止；补齐后继续同一事项、同一次审查',
      tone: 'return',
    },
    {
      code: 'reject_current_attempt',
      label: '驳回本次',
      confirmation: '终止本次审查前再次确认，并保留原决定关系',
      result: '终止当前审查；符合组织规则时可新建一次审查',
      tone: 'reject',
    },
    {
      code: 'veto_final',
      label: '终局否决',
      confirmation: '仅限高权威终局确认；本演示页面无权发起',
      result: '事项终局；模型、普通规则和普通页面按钮均不能产生',
      tone: 'veto',
    },
  ],
  safeStates: [
    { label: '加载中', detail: '只等待最新只读投影，不乐观显示成功。' },
    { label: '空结果', detail: '筛选未命中时不伪造事项。' },
    { label: '读取失败 / 重试', detail: '保留错误并允许重新读取。' },
    { label: '上下文已过期', detail: '停止确认，刷新后再核对。' },
    { label: '已完成', detail: '只以可验证结果凭证驱动状态。' },
    { label: '动作已停用', detail: '本演示只读投影不提供正式动作。' },
  ],
} as const;

export type DemoWorkProjection = typeof DEMO_WORK_PROJECTION;
