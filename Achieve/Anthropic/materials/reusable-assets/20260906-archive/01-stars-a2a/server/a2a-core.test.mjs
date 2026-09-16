import { describe, expect, it } from 'vitest'
import { A2ACoordinationEngine, createAgentCards } from './a2a-core.mjs'

const validInput = {
  goal: '让设备融资首轮审查在完整证据下形成可执行结论',
  successMetric: '所有硬门槛有证据且风险裁决可追溯',
  constraints: ['风控否决不可被领导覆盖'],
  minimumYield: 80,
  evidence: [
    { title: '租赁合同', source: '业务材料', locator: '合同第 4 页' },
    { title: '设备发票', source: '发票系统', locator: 'invoice-001' },
    { title: '回款流水', source: '银行回单', locator: '流水第 8 行' },
  ],
}

describe('A2A three-agent governance engine', () => {
  it('publishes three A2A 1.0 agent cards with separate endpoints', () => {
    const cards = createAgentCards('http://127.0.0.1:8787')
    expect(Object.keys(cards)).toEqual(['supervisor', 'business', 'risk'])
    expect(cards.risk.supportedInterfaces[0]).toMatchObject({ protocolVersion: '1.0', protocolBinding: 'JSONRPC' })
  })

  it('runs supervisor, business and risk tasks against one context', () => {
    const engine = new A2ACoordinationEngine()
    const context = engine.createContext(validInput)
    const result = engine.runRound(context.id)
    expect(result.tasks.map((task) => task.agentId)).toEqual(['supervisor', 'business', 'risk'])
    expect(result.yield.score).toBeGreaterThanOrEqual(80)
    expect(result.phase).toBe('等待风控裁决')
    expect(result.status).toBe('TASK_STATE_INPUT_REQUIRED')
  })

  it('returns an evidence challenge instead of claiming convergence', () => {
    const engine = new A2ACoordinationEngine()
    const context = engine.createContext({ ...validInput, evidence: [] })
    const result = engine.runRound(context.id)
    expect(result.phase).toBe('风控质询·业务补证')
    expect(result.yield.achieved).toBe(false)
    expect(result.yield.openChallenges.length).toBeGreaterThan(0)
  })

  it('preserves risk veto and immutable audit evidence', () => {
    const engine = new A2ACoordinationEngine()
    const context = engine.runRound(engine.createContext(validInput).id)
    const rejected = engine.recordRiskDecision(context.id, { outcome: 'rejected', note: '交易真实性仍存在重大疑点。' })
    expect(rejected.status).toBe('TASK_STATE_COMPLETED')
    expect(rejected.governanceStatus).toBe('REJECTED')
    expect(rejected.yield.achieved).toBe(false)
    expect(rejected.finalDecision.actor).toBe('risk-human')
    expect(rejected.audit.at(-1).previousHash).toBe(rejected.audit.at(-2).hash)
  })

  it('creates a new revision for reconsideration without rewriting the veto', () => {
    const engine = new A2ACoordinationEngine()
    const reviewed = engine.runRound(engine.createContext(validInput).id)
    const rejected = engine.recordRiskDecision(reviewed.id, { outcome: 'rejected', note: '关键交易背景无法确认。' })
    const next = engine.reconsiderContext(rejected.id, {
      reason: '已取得新的第三方验真材料。',
      evidence: { title: '第三方验真报告', source: '核验机构', locator: '报告第 2 页' },
    })
    expect(next.id).not.toBe(rejected.id)
    expect(next.revision).toBe(2)
    expect(next.supersedesContextId).toBe(rejected.id)
    expect(engine.getContext(rejected.id).finalDecision).toEqual(rejected.finalDecision)
  })

  it('supports A2A SendMessage, GetTask and ListTasks methods', () => {
    const engine = new A2ACoordinationEngine()
    const response = engine.handleRpc('supervisor', {
      jsonrpc: '2.0', id: 'rpc-1', method: 'SendMessage', params: {
        message: { role: 'ROLE_USER', messageId: 'm-1', parts: [{ data: { action: 'start', input: validInput } }] },
      },
    })
    expect(response.result.task.agentId).toBe('supervisor')
    const listed = engine.handleRpc('supervisor', { jsonrpc: '2.0', id: 'rpc-2', method: 'ListTasks', params: {} })
    expect(listed.result.tasks).toHaveLength(1)
    const fetched = engine.handleRpc('supervisor', { jsonrpc: '2.0', id: 'rpc-3', method: 'GetTask', params: { id: response.result.task.id } })
    expect(fetched.result.task.id).toBe(response.result.task.id)
    const repeated = engine.handleRpc('supervisor', {
      jsonrpc: '2.0', id: 'rpc-repeat', method: 'SendMessage', params: {
        message: { role: 'ROLE_USER', messageId: 'm-1', parts: [{ data: { action: 'start', input: validInput } }] },
      },
    })
    expect(repeated.result.task.id).toBe(response.result.task.id)
    expect(engine.listContexts()).toHaveLength(1)
  })
})
