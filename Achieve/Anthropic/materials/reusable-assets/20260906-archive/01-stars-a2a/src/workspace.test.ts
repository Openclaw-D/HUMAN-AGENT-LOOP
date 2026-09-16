import { describe, expect, it } from 'vitest'
import {
  approveRound,
  createWorkspace,
  demoProject,
  requestRevision,
  runWorkRound,
  updateRequirementDoc,
} from './workspace'

describe('controlled project workflow', () => {
  it('runs four independent specialists against one snapshot', () => {
    const initial = createWorkspace(demoProject())
    const result = runWorkRound(initial, '验证第一条完整协作闭环')
    const round = result.rounds[0]

    expect(round.snapshotVersion).toBe(initial.state.version)
    expect(round.assignments).toHaveLength(4)
    expect(round.reports.map((report) => report.agentId)).toEqual([
      'business',
      'product',
      'project',
      'finance',
    ])
    expect(round.synthesis.conflicts.length).toBeGreaterThan(0)
    expect(round.synthesis.todos).toHaveLength(4)
    expect(round.stage).toBe('human_review')
  })

  it('does not change the official shared conclusion before human approval', () => {
    const initial = createWorkspace(demoProject())
    const result = runWorkRound(initial, '核对共享状态保护')

    expect(result.state).toEqual(initial.state)
    expect(result.decisions).toHaveLength(0)
  })

  it('writes an approved round into a new shared-state version', () => {
    const initial = createWorkspace(demoProject())
    const withRound = runWorkRound(initial, '批准路径测试')
    const result = approveRound(withRound, withRound.rounds[0].id, '同意按本轮边界推进。')

    expect(result.state.version).toBe(initial.state.version + 1)
    expect(result.state.phase).toBe('执行中')
    expect(result.rounds[0].stage).toBe('approved')
    expect(result.decisions[0].result).toBe('approved')
    expect(result.decisions[0].note).toContain('同意')
  })

  it('records a revision request without losing the specialist reports', () => {
    const initial = createWorkspace(demoProject())
    const withRound = runWorkRound(initial, '退回路径测试')
    const reportCount = withRound.rounds[0].reports.length
    const result = requestRevision(withRound, withRound.rounds[0].id, '补充客户名单。')

    expect(result.state.phase).toBe('待修订')
    expect(result.rounds[0].stage).toBe('revision_requested')
    expect(result.rounds[0].reports).toHaveLength(reportCount)
    expect(result.decisions[0].result).toBe('revision_requested')
  })

  it('versions human edits to the shared requirement document', () => {
    const initial = createWorkspace(demoProject())
    const result = updateRequirementDoc(initial, `${initial.requirementDoc}\n新增：必须显示人工审批人。`)

    expect(result.state.version).toBe(initial.state.version + 1)
    expect(result.requirementDoc).toContain('人工审批人')
  })

  it('blocks a second round while the first is awaiting approval', () => {
    const initial = createWorkspace(demoProject())
    const withRound = runWorkRound(initial, '第一轮')

    expect(() => runWorkRound(withRound, '第二轮')).toThrow('等待人工审批')
  })
})
