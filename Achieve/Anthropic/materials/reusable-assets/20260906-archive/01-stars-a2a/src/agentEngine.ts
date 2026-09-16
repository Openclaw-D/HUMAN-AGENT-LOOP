import {
  AGENTS,
  type AgentId,
  type AgentReport,
  type AgentTask,
  type Assignment,
  type ConflictItem,
  type CoordinatorSynthesis,
  type ProjectBrief,
  type RiskItem,
  type Workspace,
} from './domain'

const specialistIds = ['business', 'product', 'project', 'finance'] as const

function makeId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${suffix}`
}

function task(
  owner: AgentTask['owner'],
  title: string,
  detail: string,
): AgentTask {
  return { id: makeId('task'), owner, title, detail }
}

function risk(
  owner: RiskItem['owner'],
  level: RiskItem['level'],
  title: string,
  detail: string,
): RiskItem {
  return { id: makeId('risk'), owner, level, title, detail }
}

function daysUntil(deadline: string) {
  const deadlineTime = new Date(`${deadline}T23:59:59`).getTime()
  return Math.ceil((deadlineTime - Date.now()) / 86_400_000)
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value)
}

export function createAssignments(focus: string): Assignment[] {
  return [
    {
      agentId: 'business',
      task: `判断“${focus}”是否对应真实客户价值，并给出验证动作。`,
    },
    {
      agentId: 'product',
      task: `把“${focus}”收敛为最小范围、明确验收标准。`,
    },
    {
      agentId: 'project',
      task: `核对“${focus}”的期限、依赖与最短交付路径。`,
    },
    {
      agentId: 'finance',
      task: `核对“${focus}”的预算边界、投入节奏与停止条件。`,
    },
  ]
}

function businessReport(project: ProjectBrief, focus: string): AgentReport {
  const hasMetric = project.successMetric.trim().length >= 8
  return {
    agentId: 'business',
    stance: hasMetric ? '可验证' : '需补证',
    conclusion: hasMetric
      ? `围绕“${focus}”先验证目标用户与使用意愿，成功口径以“${project.successMetric}”为准。`
      : `目标方向成立，但“${focus}”缺少可量化的客户验证口径，暂不能承诺商业结果。`,
    evidence: [
      `项目目标：${project.goal}`,
      hasMetric ? `成功标准：${project.successMetric}` : '成功标准尚不充分',
    ],
    todos: [
      task('business', '完成首批用户验证', '访谈或测试至少 3 个真实目标用户，记录原话与反例。'),
      task('business', '定义价值证据', '明确谁因为什么问题愿意持续使用或付费。'),
    ],
    risks: [
      risk('business', 'medium', '需求仍待真实验证', '当前材料来自项目设想，不能替代真实用户反馈。'),
      ...(!hasMetric
        ? [risk('human', 'high', '成功标准不够具体', '无法判断本轮是否完成，也容易造成角色结论漂移。')]
        : []),
    ],
    confirmations: ['确认首批目标用户及可接触名单。'],
  }
}

function productReport(project: ProjectBrief, focus: string): AgentReport {
  const docIsDetailed = project.requirements.trim().length >= 40
  return {
    agentId: 'product',
    stance: docIsDetailed ? '范围可控' : '边界待补',
    conclusion: `本轮产品目标只解决“${focus}”，所有不直接支撑该闭环的能力进入后续清单。`,
    evidence: [
      docIsDetailed ? '需求文档已描述首版边界' : '需求文档信息量偏少',
      'MVP 只服务一个项目和一个人类负责人',
    ],
    todos: [
      task('product', '冻结本轮范围', '整理必须有、明确不做、验收条件三栏清单。'),
      task('product', '准备闭环验收脚本', '按创建、协作、汇总、审批的顺序写一条完整演示路径。'),
    ],
    risks: [
      risk(
        'product',
        docIsDetailed ? 'medium' : 'high',
        '需求边界可能扩张',
        '新想法必须进入候选清单，不能在本轮中途改变验收标准。',
      ),
    ],
    confirmations: ['确认本轮唯一核心场景，其他需求默认延期。'],
  }
}

function projectReport(project: ProjectBrief, focus: string): AgentReport {
  const days = daysUntil(project.deadline)
  const urgent = days < 30
  const expired = days < 0
  return {
    agentId: 'project',
    stance: expired ? '期限异常' : urgent ? '进度承压' : '节奏可控',
    conclusion: expired
      ? `期限已过去，必须先重设日期，再安排“${focus}”的执行计划。`
      : `距期限约 ${days} 天，按“定义—执行—复盘—审批”四段推进，每段只接受明确产物。`,
    evidence: [`截止日期：${project.deadline}`, `当前测算：${expired ? '已逾期' : `剩余约 ${days} 天`}`],
    todos: [
      task('project', '建立四段里程碑', '为定义、执行、复盘、审批设置负责人和完成证据。'),
      task('project', '登记关键依赖', '未明确负责人或日期的依赖一律标红。'),
    ],
    risks: [
      risk(
        'project',
        expired || urgent ? 'high' : 'medium',
        expired ? '项目期限已经失效' : urgent ? '缓冲时间不足' : '跨角色依赖未实证',
        expired
          ? '旧日期不能继续作为计划依据。'
          : urgent
            ? '若连续两轮未形成批准结论，需主动缩减范围。'
            : '共享状态中尚无真实完成记录。',
      ),
    ],
    confirmations: expired ? ['批准新的项目截止日期。'] : ['确认关键里程碑是否允许调整范围。'],
  }
}

function financeReport(project: ProjectBrief, focus: string): AgentReport {
  const reserve = Math.round(project.budget * 0.15)
  const executionCap = project.budget - reserve
  const budgetValid = project.budget > 0
  return {
    agentId: 'finance',
    stance: budgetValid ? '设限可行' : '禁止投入',
    conclusion: budgetValid
      ? `总预算 ${money(project.budget)} 不变；建议预留 ${money(reserve)}，执行上限为 ${money(executionCap)}。本轮只给建议，不产生支出。`
      : `预算未建立，在人类负责人补充并批准前，“${focus}”不得产生支出。`,
    evidence: [
      `已登记预算：${money(project.budget)}`,
      budgetValid ? '内部规则：至少保留 15% 风险准备金' : '未检测到有效预算',
    ],
    todos: [
      task('finance', '建立费用台账', '每项拟投入记录用途、上限、负责人和停止条件。'),
      task('finance', '定义投入产出检查点', '未达到阶段证据时，不建议进入下一笔投入。'),
    ],
    risks: [
      risk(
        'finance',
        budgetValid ? 'medium' : 'high',
        budgetValid ? '投入产出尚无事实数据' : '预算缺失',
        budgetValid ? '当前只能设置边界，不能证明回报。' : '无法形成任何合规的投入建议。',
      ),
    ],
    confirmations: [
      budgetValid
        ? `确认首阶段建议支出上限不超过 ${money(Math.round(executionCap * 0.25))}。`
        : '补充预算并由人类负责人批准。',
    ],
  }
}

export function runSpecialists(workspace: Workspace, focus: string): AgentReport[] {
  const project = {
    ...workspace.project,
    requirements: workspace.requirementDoc,
  }
  return [
    businessReport(project, focus),
    productReport(project, focus),
    projectReport(project, focus),
    financeReport(project, focus),
  ]
}

function buildConflicts(project: ProjectBrief, reports: AgentReport[]): ConflictItem[] {
  const product = reports.find((report) => report.agentId === 'product')!
  const business = reports.find((report) => report.agentId === 'business')!
  const finance = reports.find((report) => report.agentId === 'finance')!
  return [
    {
      id: makeId('conflict'),
      topic: '速度与范围',
      views: [
        `业务希望尽快拿到真实反馈：${business.stance}`,
        `产品要求先冻结边界：${product.stance}`,
      ],
      recommendation: '先冻结一条可演示闭环，再用真实用户反馈决定是否扩展。',
    },
    {
      id: makeId('conflict'),
      topic: '投入与证据',
      views: [
        `项目预算为 ${money(project.budget)}`,
        `财务判断：${finance.stance}，当前没有真实投入产出数据`,
      ],
      recommendation: '本轮只批准验证额度，不批准完整预算释放。',
    },
  ]
}

export function synthesize(
  workspace: Workspace,
  reports: AgentReport[],
): CoordinatorSynthesis {
  const risks = reports.flatMap((report) => report.risks)
  const highRisks = risks.filter((item) => item.level === 'high').length
  const readiness = Math.max(35, Math.min(88, 82 - highRisks * 14 - risks.length * 2))
  const confirmations = [...new Set(reports.flatMap((report) => report.confirmations))]
  const primaryTodos = specialistIds.map((agentId) => {
    const report = reports.find((item) => item.agentId === agentId)!
    return report.todos[0]
  })

  return {
    conclusion:
      highRisks > 0
        ? `建议有条件推进：先关闭 ${highRisks} 个高风险项，再进入下一阶段。任何支出和对外承诺仍需人类负责人单独批准。`
        : '建议推进本轮验证：当前边界可控，但结论只对本轮项目快照有效。任何支出和对外承诺仍需人类负责人单独批准。',
    readiness,
    conflicts: buildConflicts(workspace.project, reports),
    todos: primaryTodos,
    risks: risks.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.level] - order[b.level]
    }),
    confirmations: [...confirmations, '批准本轮结论，或写明退回修改意见。'],
  }
}

export function agentName(id: AgentId | 'human') {
  return id === 'human' ? '人类负责人' : AGENTS[id].name
}
