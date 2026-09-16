function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function createRoles(prefix, domain) {
  return [
    {
      id: `${prefix}-owner-human`,
      name: `${domain}负责人`,
      type: 'human',
      responsibilities: ['明确工作目标和边界', '复核建议并作出必要的人工决定'],
      authority: '负责目标、关口与结果',
    },
    {
      id: `${prefix}-gate-human`,
      name: `${domain}关口人`,
      type: 'human',
      responsibilities: ['审查证据是否充分', '守住人工关口并记录决定理由'],
      authority: '仅人工关口决定',
    },
    {
      id: `${prefix}-assistant-agent`,
      name: `${domain}协同智能体`,
      type: 'agent',
      responsibilities: ['整理证据和候选方案', '标出不确定性并等待人工复核'],
      authority: '仅建议',
    },
    {
      id: `${prefix}-state-system`,
      name: `${domain}状态连接器`,
      type: 'system',
      responsibilities: ['回传外部执行回执', '同步外部系统状态'],
      authority: '仅回执与外部状态',
    },
  ];
}

function createStages(prefix, names) {
  return names.map((name, index) => ({
    id: `${prefix}-stage-${index + 1}`,
    displayName: name,
    order: index + 1,
    detail: `${name}阶段的输入、输出和人工边界均显式记录。`,
  }));
}

function createMatrix(stages, roles, special) {
  const columns = special
    ? special.columns.map((column) => ({ ...column }))
    : stages.map((stage) => ({ id: stage.id, label: stage.displayName, description: stage.detail }));
  const rows = roles.map((role) => {
    const cells = columns.map((column) => ({
      columnId: column.id,
      responsibility: '不参与',
      state: '未开始',
      label: '不参与',
    }));
    cells.forEach((cell, index) => {
      if (role.type === 'human' && role.id.endsWith('owner-human')) {
        if (special) {
          cell.responsibility = '负责';
          cell.state = '进行中';
          cell.label = special.ownerLabels[index];
        } else {
          cell.responsibility = '负责';
          cell.state = index === 0 ? '进行中' : '未开始';
          cell.label = index === 0 ? '牵头推进' : '对结果负责';
        }
      } else if (role.type === 'human') {
        cell.responsibility = '复核';
        if (special) {
          cell.state = '待复核';
          cell.label = special.gateLabels[index];
        } else {
          cell.state = index >= 1 && index <= 3 ? '待复核' : '未开始';
          cell.label = index >= 1 && index <= 3 ? '审查人工关口' : '需要时介入';
        }
      } else if (role.type === 'agent') {
        cell.responsibility = '建议';
        if (special) {
          cell.state = special.agentStates[index];
          cell.label = special.agentLabels[index];
        } else {
          cell.state = index <= 2 ? '可辅助' : '未开始';
          cell.label = index <= 2 ? '生成候选建议' : '仅提供背景信息';
        }
      } else {
        cell.responsibility = '回执';
        if (special) {
          cell.state = '未知';
          cell.label = special.systemLabels[index];
        } else {
          cell.state = index >= 4 ? '未知' : '未接入';
          cell.label = index >= 4 ? '等待外部回执' : '本阶段无外部动作';
        }
      }
    });
    return { actorId: role.id, cells };
  });
  return { columnKind: special ? 'dimension' : 'stage', columns, rows };
}

function createPack(config) {
  const roles = createRoles(config.id, config.domain);
  const stages = createStages(config.id, config.stageNames);
  return {
    id: config.id,
    displayName: config.displayName,
    scope: config.scope,
    defaultView: config.defaultView,
    display: {
      summary: config.summary,
      boundary: '智能体只整理候选内容，目标、责任、人工关口和外部动作由具名人类决定。',
      typicalLoop: config.loop.reason,
    },
    roles,
    stages,
    loops: [config.loop],
    matrix: createMatrix(stages, roles, config.matrix),
    modelPolicy: {
      authority: 'none',
      allowedActions: ['整理已有材料', '生成候选建议', '解释不确定性', '提出待人工复核的问题'],
      forbiddenActions: [
        '不得改变工作目标',
        '不得改变责任人或责任边界',
        '不得代替人工关口',
        '不得触发或改变外部动作',
      ],
    },
    negativePath: {
      trigger: config.negativeTrigger,
      behavior: '智能体只能标记异常并给出建议，不能自行改目标、换责任人、越过关口或补写成功回执。',
      expectedOutcome: '异常保留在待人工处理状态，外部结果未知时不得判定完成。',
    },
    evidenceScope: config.evidenceScope,
    metrics: config.metrics,
  };
}

const packConfigs = [
  {
    id: 'risk',
    displayName: '风控业务协同',
    domain: '风控',
    scope: '风险识别、证据复核、人工关口与外部处置回执的协同。',
    defaultView: 'progress',
    summary: '面向需要人工审查和外部回执的风险处置协同。',
    stageNames: ['立案录入', '证据收集', '人工复核', '处置授权', '外部执行', '回执归档'],
    loop: {
      id: 'risk-evidence-return',
      trigger: '证据不足或口径冲突时',
      fromStageId: 'risk-stage-3',
      toStageId: 'risk-stage-2',
      reason: '人工复核退回证据收集，智能体仅补充候选证据。',
    },
    evidenceScope: ['交易流水', '规则命中记录', '人工复核记录', '外部处置回执'],
    metrics: [
      { id: 'evidence-return-count', label: '证据退回次数' },
      { id: 'human-gate-latency', label: '人工关口等待时长' },
      { id: 'unknown-receipt-count', label: '未知回执数量' },
    ],
    negativeTrigger: '外部处置结果长时间未回传。',
  },
  {
    id: 'dev',
    displayName: '需求开发协同',
    domain: '需求开发',
    scope: '需求澄清、方案候选、变更影响与交付验收的协同。',
    defaultView: 'progress',
    summary: '面向目标版本化和变更影响显性化的开发协同。',
    stageNames: ['需求接收', '背景澄清', '方案候选', '人工评审', '实现验证', '发布记录'],
    loop: {
      id: 'dev-goal-reopen',
      trigger: '目标变更影响已进入评审的方案时',
      fromStageId: 'dev-stage-4',
      toStageId: 'dev-stage-2',
      reason: '目标变更后重新澄清背景，并标记旧版本候选产物。',
    },
    evidenceScope: ['需求记录', '目标变更记录', '评审结论', '验证结果'],
    metrics: [
      { id: 'goal-version-count', label: '目标版本数' },
      { id: 'review-return-count', label: '评审退回次数' },
      { id: 'candidate-waiting-count', label: '待审候选数' },
    ],
    negativeTrigger: '目标在实现中途发生变化。',
  },
  {
    id: 'interaction',
    displayName: '人机交互协同',
    domain: '人机交互',
    scope: '意图理解、澄清追问、确认边界和任务交接的协同。',
    defaultView: 'relation',
    summary: '面向人与智能体之间责任关系和确认边界的协同。',
    stageNames: ['意图接收', '上下文整理', '澄清确认', '任务执行建议', '结果复核', '会话归档'],
    loop: {
      id: 'interaction-clarify-loop',
      trigger: '用户意图或槽位缺失时',
      fromStageId: 'interaction-stage-3',
      toStageId: 'interaction-stage-2',
      reason: '先补齐上下文，再生成需要用户确认的候选动作。',
    },
    evidenceScope: ['会话记录', '澄清问题', '用户确认记录', '交接说明'],
    metrics: [
      { id: 'clarification-count', label: '澄清轮次' },
      { id: 'confirmation-count', label: '人工确认次数' },
      { id: 'handoff-count', label: '交接次数' },
    ],
    negativeTrigger: '智能体把猜测的高风险意图当作已确认意图。',
  },
  {
    id: 'content',
    displayName: '内容生产协同',
    domain: '内容生产',
    scope: '选题、素材、初稿、审校、发布材料与追溯的协同。',
    defaultView: 'progress',
    summary: '面向候选稿件和人工审校把关的内容协同。',
    stageNames: ['选题登记', '素材整理', '大纲候选', '内容草稿', '人工审校', '发布追溯'],
    loop: {
      id: 'content-review-loop',
      trigger: '审校发现事实、风格或授权问题时',
      fromStageId: 'content-stage-5',
      toStageId: 'content-stage-4',
      reason: '退回草稿修订，修订稿仍需重新审校。',
    },
    evidenceScope: ['素材来源', '授权记录', '审校意见', '发布记录'],
    metrics: [
      { id: 'review-cycle-count', label: '审校轮次' },
      { id: 'source-check-pass-rate', label: '来源核验通过率' },
      { id: 'rework-count', label: '返修次数' },
    ],
    negativeTrigger: '素材来源或授权状态不明确。',
  },
  {
    id: 'growth',
    displayName: '经营增长协同',
    domain: '经营增长',
    scope: '策略假设、实验设计、活动执行和经营结果复盘的协同。',
    defaultView: 'matrix',
    summary: '面向策略、实验与活动三维责任对齐的增长协同。',
    stageNames: ['目标拆解', '策略假设', '实验设计', '活动执行', '结果复盘', '决策归档'],
    loop: {
      id: 'growth-experiment-iterate',
      trigger: '实验结果否定了当前策略假设时',
      fromStageId: 'growth-stage-5',
      toStageId: 'growth-stage-2',
      reason: '回到策略假设并形成下一轮实验，不直接扩大活动。',
    },
    evidenceScope: ['指标定义', '实验分组', '活动记录', '经营结果回传'],
    metrics: [
      { id: 'hypothesis-count', label: '策略假设数' },
      { id: 'experiment-cycle-count', label: '实验迭代轮次' },
      { id: 'activity-unknown-receipt-count', label: '活动未知回执数' },
    ],
    negativeTrigger: '指标回传缺失或实验结果不可解释。',
    matrix: {
      columns: [
        { id: 'strategy', label: '策略', description: '经营目标、假设和取舍。' },
        { id: 'experiment', label: '实验', description: '实验设计、分组和判定规则。' },
        { id: 'campaign', label: '活动', description: '活动配置、执行和外部回执。' },
      ],
      ownerLabels: ['经营目标与策略假设', '实验决策与风险控制', '活动授权与结果确认'],
      gateLabels: ['复核策略边界', '复核实验有效性', '复核活动合规性'],
      agentStates: ['可辅助', '可辅助', '仅建议'],
      agentLabels: ['整理假设与资料', '生成实验设计候选', '生成活动文案候选'],
      systemLabels: ['无外部动作', '回传实验状态', '回传活动执行状态'],
    },
  },
  {
    id: 'embodied',
    displayName: '物理智能协同',
    domain: '物理智能',
    scope: '仅覆盖智能网联汽车的感知、规划候选、人工确认、设备执行与安全回执协同。',
    defaultView: 'relation',
    summary: '面向人、智能体、设备与安全责任关系的协同。',
    stageNames: ['任务接收', '感知状态', '规划候选', '安全确认', '设备执行', '执行回执'],
    loop: {
      id: 'embodied-safety-return',
      trigger: '感知状态与规划前提不一致时',
      fromStageId: 'embodied-stage-4',
      toStageId: 'embodied-stage-2',
      reason: '退回感知状态复核，安全确认未通过前不执行物理动作。',
    },
    evidenceScope: ['智能网联汽车', '设备传感状态', '安全确认记录', '执行回执'],
    metrics: [
      { id: 'safety-return-count', label: '安全退回次数' },
      { id: 'human-override-count', label: '人工接管次数' },
      { id: 'execution-unknown-count', label: '执行未知数量' },
    ],
    negativeTrigger: '传感状态缺失或设备执行结果未回传。',
  },
  {
    id: 'knowledge',
    displayName: '知识办公协同',
    domain: '知识办公',
    scope: '问题定位、资料检索、候选答案、引用核验与知识沉淀的协同。',
    defaultView: 'progress',
    summary: '面向可追溯知识和引用核验的办公协同。',
    stageNames: ['问题登记', '资料检索', '候选整理', '引用核验', '人工确认', '知识归档'],
    loop: {
      id: 'knowledge-citation-loop',
      trigger: '候选答案缺少可验证引用时',
      fromStageId: 'knowledge-stage-4',
      toStageId: 'knowledge-stage-2',
      reason: '重新检索并补齐引用，未经核验不得沉淀为知识。',
    },
    evidenceScope: ['知识库片段', '引用来源', '核验记录', '归档版本'],
    metrics: [
      { id: 'citation-check-count', label: '引用核验次数' },
      { id: 'archive-version-count', label: '归档版本数' },
      { id: 'rejected-candidate-count', label: '驳回候选数' },
    ],
    negativeTrigger: '引用无法追溯到原始资料。',
  },
  {
    id: 'service',
    displayName: '客户服务协同',
    domain: '客户服务',
    scope: '工单理解、服务建议、人工确认、工单操作与回执的协同。',
    defaultView: 'progress',
    summary: '面向客户责任和工单操作边界的服务协同。',
    stageNames: ['工单接入', '历史整理', '方案候选', '人工确认', '工单操作', '回执关闭'],
    loop: {
      id: 'service-customer-callback',
      trigger: '客户补充信息或拒绝建议方案时',
      fromStageId: 'service-stage-4',
      toStageId: 'service-stage-2',
      reason: '补充历史与客户确认信息后重新形成候选方案。',
    },
    evidenceScope: ['工单记录', '客户确认记录', '操作授权记录', '工单回执'],
    metrics: [
      { id: 'callback-count', label: '客户补充轮次' },
      { id: 'human-confirm-count', label: '人工确认次数' },
      { id: 'unknown-ticket-receipt-count', label: '工单未知回执数' },
    ],
    negativeTrigger: '客户确认缺失或工单系统回传失败。',
  },
  {
    id: 'supply-chain',
    displayName: '供应链履约协同',
    domain: '供应链履约',
    scope: '订单承诺、物料齐套、异常处理与履约回执的协同。',
    defaultView: 'matrix',
    summary: '面向订单、物料与异常任务三维对齐的履约协同。',
    stageNames: ['订单接入', '承诺检查', '物料核对', '异常处理', '履约执行', '回执对账'],
    loop: {
      id: 'supply-chain-exception-loop',
      trigger: '物料缺口影响订单承诺时',
      fromStageId: 'supply-chain-stage-4',
      toStageId: 'supply-chain-stage-3',
      reason: '重新核对物料与替代方案，人工确认后更新异常任务。',
    },
    evidenceScope: ['订单快照', '库存与在途物料', '异常任务记录', '履约回执'],
    metrics: [
      { id: 'exception-task-count', label: '异常任务数' },
      { id: 'material-shortage-count', label: '物料缺口次数' },
      { id: 'fulfillment-unknown-count', label: '履约未知数量' },
    ],
    negativeTrigger: '库存、在途或供应商回执口径不一致。',
    matrix: {
      columns: [
        { id: 'order', label: '订单', description: '承诺、优先级和客户边界。' },
        { id: 'material', label: '物料', description: '库存、在途和替代方案。' },
        { id: 'exception-task', label: '异常任务', description: '异常责任、处理和关闭依据。' },
      ],
      ownerLabels: ['订单承诺与优先级', '物料方案取舍', '异常任务决定'],
      gateLabels: ['复核承诺风险', '复核替代方案', '复核异常关闭依据'],
      agentStates: ['可辅助', '可辅助', '可辅助'],
      agentLabels: ['整理订单约束', '生成物料核对候选', '生成异常摘要候选'],
      systemLabels: ['回传订单状态', '回传物料状态', '回传异常任务状态'],
    },
  },
  {
    id: 'healthcare',
    displayName: '医疗服务协同',
    domain: '医疗服务',
    scope: '诊疗辅助、质控、随访与医疗责任边界的协同。',
    defaultView: 'progress',
    summary: '面向医疗安全、人工复核和随访闭环的协同。',
    stageNames: ['服务登记', '资料整理', '辅助建议', '人工复核', '随访计划', '结果归档'],
    loop: {
      id: 'healthcare-followup-return',
      trigger: '随访结果与诊疗辅助前提不一致时',
      fromStageId: 'healthcare-stage-5',
      toStageId: 'healthcare-stage-3',
      reason: '重新生成辅助建议并提交人工复核，随访异常不得自动关闭。',
    },
    evidenceScope: ['诊疗辅助、质控、随访', '医疗记录摘要', '人工复核记录', '随访结果'],
    metrics: [
      { id: 'human-review-count', label: '人工复核次数' },
      { id: 'followup-return-count', label: '随访退回次数' },
      { id: 'assistant-uncertainty-count', label: '辅助不确定性标记数' },
    ],
    negativeTrigger: '医疗记录不完整或随访结果缺失。',
  },
];

const sampleDefinitions = {
  risk: {
    title: '高风险交易复核示例',
    goal: '在人工关口确认后完成一次外部处置，并保留未知回执。',
    outcome: { kind: 'modelRun', status: 'unknown' },
  },
  dev: {
    title: '需求目标变更示例',
    goal: '澄清变更后的目标版本，并让候选方案重新进入人工评审。',
    outcome: { kind: 'modelRun', status: 'completed' },
  },
  interaction: {
    title: '高风险意图澄清示例',
    goal: '补齐用户确认边界后，再决定是否交接执行。',
    outcome: { kind: 'modelRun', status: 'unknown' },
  },
  content: {
    title: '内容审校返修示例',
    goal: '生成带来源的候选稿件，并等待人工审校结论。',
    outcome: { kind: 'modelRun', status: 'completed' },
  },
  growth: {
    title: '增长实验复盘示例',
    goal: '确认策略假设失效后的下一轮实验和活动边界。',
    outcome: { kind: 'receipt', status: 'unknown' },
  },
  embodied: {
    title: '智能网联汽车执行确认示例',
    goal: '在感知前提稳定后，由人工确认是否执行设备动作。',
    outcome: { kind: 'modelRun', status: 'unknown' },
  },
  knowledge: {
    title: '知识引用核验示例',
    goal: '为候选答案补齐可验证引用，并等待人工确认归档。',
    outcome: { kind: 'modelRun', status: 'completed' },
  },
  service: {
    title: '客户工单操作确认示例',
    goal: '取得客户与人工确认后，等待工单系统回执。',
    outcome: { kind: 'receipt', status: 'unknown' },
  },
  'supply-chain': {
    title: '物料缺口异常处理示例',
    goal: '人工确认物料替代方案并跟踪异常任务履约结果。',
    outcome: { kind: 'modelRun', status: 'completed' },
  },
  healthcare: {
    title: '诊疗辅助随访示例',
    goal: '为人工复核提供候选建议，并跟踪随访未知结果。',
    outcome: { kind: 'modelRun', status: 'unknown' },
  },
};

export const scenarioPacks = deepFreeze(packConfigs.map(createPack));

export function getScenarioPack(id) {
  const pack = scenarioPacks.find((item) => item.id === id);
  if (!pack) throw new Error(`未知场景包：${id}`);
  return pack;
}

export function createSampleDefinition(id) {
  const pack = getScenarioPack(id);
  const config = sampleDefinitions[id];
  const workId = `${id}-sample-work-v2`;
  return structuredClone({
    dataOrigin: 'sample',
    workId,
    title: config.title,
    goal: config.goal,
    scenario: {
      id: pack.id,
      displayName: pack.displayName,
      scope: pack.scope,
      defaultView: pack.defaultView,
    },
    actors: pack.roles,
    stages: pack.stages,
    loops: pack.loops,
    relations: [
      {
        id: `${id}-owner-owns-work`,
        source: { kind: 'actor', id: `${id}-owner-human` },
        target: { kind: 'work', id: workId },
        type: 'owns',
        state: 'active',
        label: '负责工作',
      },
      {
        id: `${id}-agent-assists-owner`,
        source: { kind: 'actor', id: `${id}-assistant-agent` },
        target: { kind: 'actor', id: `${id}-owner-human` },
        type: 'assists',
        state: 'active',
        label: '提供候选建议',
      },
      {
        id: `${id}-gate-reviews-owner`,
        source: { kind: 'actor', id: `${id}-gate-human` },
        target: { kind: 'actor', id: `${id}-owner-human` },
        type: 'reviews',
        state: 'active',
        label: '复核人工关口',
      },
      {
        id: `${id}-system-reports-owner`,
        source: { kind: 'actor', id: `${id}-state-system` },
        target: { kind: 'actor', id: `${id}-owner-human` },
        type: 'reports',
        state: 'unknown',
        label: '回传外部状态',
      },
    ],
    matrix: pack.matrix,
    currentActorId: `${id}-owner-human`,
    initialStageId: `${id}-stage-1`,
    sampleSignals: {
      kind: pack.id === 'growth' || pack.id === 'supply-chain' ? 'exception' : 'loop',
      label: pack.loops[0].reason,
      loopId: pack.loops[0].id,
      nextStep: '等待具名人类复核候选内容。',
      unknownOutcome: config.outcome,
      negativePath: pack.negativePath,
      provenance: '以上均为模拟样例，不代表任何客户真实数据。',
    },
  });
}
