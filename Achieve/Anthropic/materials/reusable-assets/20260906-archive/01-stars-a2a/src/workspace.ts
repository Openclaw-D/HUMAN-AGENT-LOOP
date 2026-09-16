import { createAssignments, runSpecialists, synthesize } from './agentEngine'
import type {
  DecisionRecord,
  ProjectInput,
  Workspace,
  WorkRound,
} from './domain'

export const STORAGE_KEY = 'stars-war-room-workspace-v1'

function makeId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${suffix}`
}

function now() {
  return new Date().toISOString()
}

export function createWorkspace(input: ProjectInput): Workspace {
  const createdAt = now()
  return {
    schemaVersion: 1,
    project: {
      ...input,
      id: makeId('project'),
      createdAt,
    },
    state: {
      version: 1,
      phase: '目标定义',
      currentConclusion: '项目已创建，等待启动第一轮 Agent 协作。',
      updatedAt: createdAt,
    },
    requirementDoc: input.requirements,
    rounds: [],
    decisions: [],
  }
}

export function runWorkRound(workspace: Workspace, focus: string): Workspace {
  if (workspace.rounds.some((round) => round.stage === 'human_review')) {
    throw new Error('当前已有一轮等待人工审批。')
  }

  const reports = runSpecialists(workspace, focus)
  const round: WorkRound = {
    id: makeId('round'),
    number: workspace.rounds.length + 1,
    focus,
    snapshotVersion: workspace.state.version,
    createdAt: now(),
    stage: 'human_review',
    assignments: createAssignments(focus),
    reports,
    synthesis: synthesize(workspace, reports),
  }

  return { ...workspace, rounds: [round, ...workspace.rounds] }
}

function reviewRound(
  workspace: Workspace,
  roundId: string,
  result: DecisionRecord['result'],
  note: string,
): Workspace {
  const target = workspace.rounds.find((round) => round.id === roundId)
  if (!target || target.stage !== 'human_review') {
    throw new Error('该轮次不存在或已完成审批。')
  }

  const reviewedAt = now()
  const nextVersion = workspace.state.version + 1
  const decision: DecisionRecord = {
    id: makeId('decision'),
    roundId,
    roundNumber: target.number,
    result,
    title: result === 'approved' ? `批准第 ${target.number} 轮结论` : `退回第 ${target.number} 轮`,
    note: note.trim() || (result === 'approved' ? '按协调结论推进。' : '需要补充材料后重新评估。'),
    createdAt: reviewedAt,
    stateVersion: nextVersion,
  }

  return {
    ...workspace,
    state: {
      version: nextVersion,
      phase: result === 'approved' ? '执行中' : '待修订',
      currentConclusion:
        result === 'approved'
          ? target.synthesis.conclusion
          : `第 ${target.number} 轮已退回：${decision.note}`,
      updatedAt: reviewedAt,
    },
    rounds: workspace.rounds.map((round) =>
      round.id === roundId
        ? {
            ...round,
            stage: result,
            reviewNote: decision.note,
            reviewedAt,
          }
        : round,
    ),
    decisions: [decision, ...workspace.decisions],
  }
}

export function approveRound(workspace: Workspace, roundId: string, note: string) {
  return reviewRound(workspace, roundId, 'approved', note)
}

export function requestRevision(workspace: Workspace, roundId: string, note: string) {
  return reviewRound(workspace, roundId, 'revision_requested', note)
}

export function updateRequirementDoc(workspace: Workspace, value: string): Workspace {
  const updatedAt = now()
  return {
    ...workspace,
    project: { ...workspace.project, requirements: value },
    requirementDoc: value,
    state: {
      ...workspace.state,
      version: workspace.state.version + 1,
      phase: '需求已更新',
      currentConclusion: '需求文档已由人类负责人更新，后续轮次将读取新版本。',
      updatedAt,
    },
  }
}

export function demoProject(): ProjectInput {
  const deadline = new Date()
  deadline.setDate(deadline.getDate() + 45)
  return {
    name: '企业知识助手 MVP',
    owner: '项目负责人',
    goal: '用六周验证一线团队能否通过统一知识入口，更快找到可信答案并减少重复咨询。',
    budget: 80000,
    deadline: deadline.toISOString().slice(0, 10),
    successMetric: '5 名真实用户连续两周使用，常见问题查找时间降低 30%',
    requirements:
      '首版只支持一个团队、一个知识库和文字问答。必须显示答案来源、允许用户反馈错误，并保留管理员修订记录。不做外部客户开放、自动发信、支付和复杂权限。',
  }
}

export function loadWorkspace(): Workspace | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) return null
    const workspace = JSON.parse(value) as Workspace
    return workspace.schemaVersion === 1 ? workspace : null
  } catch {
    return null
  }
}

export function persistWorkspace(workspace: Workspace | null) {
  if (!workspace) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
}
