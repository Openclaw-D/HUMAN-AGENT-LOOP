export type AgentId =
  | 'coordinator'
  | 'business'
  | 'product'
  | 'project'
  | 'finance'

export type RiskLevel = 'high' | 'medium' | 'low'
export type RoundStage = 'human_review' | 'approved' | 'revision_requested'

export interface ProjectInput {
  name: string
  owner: string
  goal: string
  budget: number
  deadline: string
  successMetric: string
  requirements: string
}

export interface ProjectBrief extends ProjectInput {
  id: string
  createdAt: string
}

export interface SharedState {
  version: number
  phase: string
  currentConclusion: string
  updatedAt: string
}

export interface AgentTask {
  id: string
  title: string
  detail: string
  owner: AgentId | 'human'
}

export interface RiskItem {
  id: string
  level: RiskLevel
  title: string
  detail: string
  owner: AgentId | 'human'
}

export interface AgentReport {
  agentId: Exclude<AgentId, 'coordinator'>
  stance: string
  conclusion: string
  evidence: string[]
  todos: AgentTask[]
  risks: RiskItem[]
  confirmations: string[]
}

export interface ConflictItem {
  id: string
  topic: string
  views: string[]
  recommendation: string
}

export interface CoordinatorSynthesis {
  conclusion: string
  readiness: number
  conflicts: ConflictItem[]
  todos: AgentTask[]
  risks: RiskItem[]
  confirmations: string[]
}

export interface Assignment {
  agentId: Exclude<AgentId, 'coordinator'>
  task: string
}

export interface WorkRound {
  id: string
  number: number
  focus: string
  snapshotVersion: number
  createdAt: string
  stage: RoundStage
  assignments: Assignment[]
  reports: AgentReport[]
  synthesis: CoordinatorSynthesis
  reviewNote?: string
  reviewedAt?: string
}

export interface DecisionRecord {
  id: string
  roundId: string
  roundNumber: number
  result: 'approved' | 'revision_requested'
  title: string
  note: string
  createdAt: string
  stateVersion: number
}

export interface Workspace {
  schemaVersion: 1
  project: ProjectBrief
  state: SharedState
  requirementDoc: string
  rounds: WorkRound[]
  decisions: DecisionRecord[]
}

export const AGENTS: Record<
  AgentId,
  { name: string; shortName: string; remit: string; color: string }
> = {
  coordinator: {
    name: '总协调 Agent',
    shortName: '协调',
    remit: '统一术语、分派任务、保留冲突并形成审批建议',
    color: '#7367f0',
  },
  business: {
    name: '业务 Agent',
    shortName: '业务',
    remit: '客户、需求、价值与商业结果',
    color: '#e76f51',
  },
  product: {
    name: '产品 Agent',
    shortName: '产品',
    remit: '范围、体验、验收标准与需求边界',
    color: '#2a9d8f',
  },
  project: {
    name: '项目 Agent',
    shortName: '项目',
    remit: '里程碑、依赖、进度与交付节奏',
    color: '#3a86ff',
  },
  finance: {
    name: '财务 Agent',
    shortName: '财务',
    remit: '预算边界、成本、现金与投入产出',
    color: '#d39b2a',
  },
}
