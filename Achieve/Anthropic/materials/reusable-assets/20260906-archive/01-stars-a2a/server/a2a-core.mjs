import { createHash, randomUUID } from 'node:crypto'

export const A2A_VERSION = '1.0'
export const AGENT_IDS = ['supervisor', 'business', 'risk']

const TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
])

const AGENTS = {
  supervisor: {
    name: 'STARS 监督 Agent',
    description: '承接领导目标，分解任务、推进回合并保留权责边界；无权覆盖风控否决。',
    skill: {
      id: 'governance-orchestration',
      name: '治理编排',
      description: '把共同目标分派给业务与风控，追踪收敛门槛和人工 Gate。',
    },
  },
  business: {
    name: 'STARS 业务 Agent',
    description: '形成业务方案、提交原始证据并响应风控质询。',
    skill: {
      id: 'business-evidence',
      name: '业务证据',
      description: '围绕目标提交可定位、可复核的业务证据。',
    },
  },
  risk: {
    name: 'STARS 风控 Agent',
    description: '独立检查证据与风险，给出建议；最终风险裁决由风控人员确认且不可被领导覆盖。',
    skill: {
      id: 'independent-risk-review',
      name: '独立风险审查',
      description: '质询证据并形成通过、附条件通过或否决建议。',
    },
  },
}

function makeId(prefix) {
  return `${prefix}-${randomUUID()}`
}

function now() {
  return new Date().toISOString()
}

function clone(value) {
  return structuredClone(value)
}

function textPart(text) {
  return { text, mediaType: 'text/plain' }
}

function dataPart(data) {
  return { data, mediaType: 'application/json' }
}

function normalizeEvidence(items = []) {
  return items
    .map((item) => typeof item === 'string' ? { title: item, source: '人工提交' } : item)
    .filter((item) => item?.title?.trim())
    .map((item) => ({
      id: item.id ?? makeId('evidence'),
      title: item.title.trim(),
      source: item.source?.trim() || '人工提交',
      locator: item.locator?.trim() || '待补定位',
      submittedAt: item.submittedAt ?? now(),
    }))
}

function ensureInput(input) {
  if (!input || typeof input !== 'object') throw new Error('目标输入不能为空。')
  if (typeof input.goal !== 'string' || input.goal.trim().length < 8) {
    throw new Error('共同目标至少需要 8 个字符。')
  }
  if (typeof input.successMetric !== 'string' || input.successMetric.trim().length < 6) {
    throw new Error('成功指标至少需要 6 个字符。')
  }
  const minimumYield = Number(input.minimumYield ?? 80)
  if (!Number.isFinite(minimumYield) || minimumYield < 50 || minimumYield > 100) {
    throw new Error('收敛门槛必须在 50 到 100 之间。')
  }
  return {
    goal: input.goal.trim(),
    successMetric: input.successMetric.trim(),
    constraints: Array.isArray(input.constraints)
      ? input.constraints.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    minimumYield,
    evidence: normalizeEvidence(input.evidence),
  }
}

function calculateYield(context) {
  const goalAlignment = context.goal.length >= 16 && context.successMetric.length >= 10 ? 30 : 22
  const evidenceCompleteness = Math.min(40, context.evidence.length * 12)
  const locatedEvidence = context.evidence.filter((item) => item.locator !== '待补定位').length
  const governanceReadiness = Math.min(30, 12 + context.constraints.length * 5 + locatedEvidence * 4)
  const score = Math.min(100, goalAlignment + evidenceCompleteness + governanceReadiness)
  const openChallenges = []
  if (context.evidence.length < 3) openChallenges.push('至少需要 3 项相互独立的证据。')
  if (locatedEvidence < 2) openChallenges.push('至少 2 项证据需要提供页码、字段或系统记录定位。')
  if (context.constraints.length === 0) openChallenges.push('需要登记至少 1 条不可突破的业务或风险约束。')
  if (score < context.minimumYield) openChallenges.push(`当前 ${score} 分，未达到 ${context.minimumYield} 分收敛门槛。`)
  return {
    score,
    minimum: context.minimumYield,
    readyForDecision: openChallenges.length === 0,
    achieved: ['approved', 'conditionally_approved'].includes(context.finalDecision?.outcome),
    components: { goalAlignment, evidenceCompleteness, governanceReadiness },
    openChallenges,
  }
}

function addAudit(context, actor, action, detail, refs = []) {
  const previous = context.audit.at(-1)?.hash ?? 'GENESIS'
  const entry = {
    sequence: context.audit.length + 1,
    eventId: makeId('event'),
    timestamp: now(),
    actor,
    action,
    detail,
    refs,
    previousHash: previous,
  }
  entry.hash = createHash('sha256').update(JSON.stringify(entry)).digest('hex')
  context.audit.push(entry)
  return entry
}

function createMessage(from, to, contextId, text, data = {}) {
  return {
    messageId: makeId('message'),
    contextId,
    role: 'ROLE_AGENT',
    parts: [textPart(text), dataPart({ from, to, ...data })],
  }
}

function createTask(agentId, contextId, summary) {
  const timestamp = now()
  return {
    id: makeId('task'),
    contextId,
    agentId,
    summary,
    status: { state: 'TASK_STATE_SUBMITTED', timestamp },
    artifacts: [],
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function transitionTask(task, state, message) {
  task.status = { state, timestamp: now(), ...(message ? { message } : {}) }
  task.updatedAt = task.status.timestamp
}

function addArtifact(task, name, description, data) {
  const artifact = {
    artifactId: makeId('artifact'),
    name,
    description,
    parts: [dataPart(data)],
  }
  task.artifacts.push(artifact)
  return artifact
}

export function createAgentCards(baseUrl = 'http://127.0.0.1:8787') {
  return Object.fromEntries(AGENT_IDS.map((agentId) => {
    const agent = AGENTS[agentId]
    return [agentId, {
      name: agent.name,
      description: agent.description,
      version: '0.1.0',
      provider: { organization: 'STARS local prototype', url: baseUrl },
      supportedInterfaces: [{
        url: `${baseUrl}/a2a/${agentId}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_VERSION,
      }],
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      skills: [{ ...agent.skill, tags: ['financing-governance', 'human-gate'], inputModes: ['application/json'], outputModes: ['application/json'] }],
      securitySchemes: {},
      security: [],
    }]
  }))
}

export class A2ACoordinationEngine {
  constructor(snapshot) {
    this.contexts = new Map((snapshot?.contexts ?? []).map((context) => [context.id, context]))
    this.inbox = new Map(snapshot?.inbox ?? [])
    this.tasks = new Map()
    for (const context of this.contexts.values()) {
      for (const task of context.tasks ?? []) this.tasks.set(task.id, task)
    }
  }

  exportSnapshot() {
    return { schemaVersion: 1, savedAt: now(), contexts: [...this.contexts.values()], inbox: [...this.inbox.entries()] }
  }

  listContexts() {
    return [...this.contexts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone)
  }

  getContext(id) {
    const context = this.contexts.get(id)
    if (!context) throw new Error('协作上下文不存在。')
    return clone(context)
  }

  createContext(rawInput) {
    const input = ensureInput(rawInput)
    const timestamp = now()
    const context = {
      id: makeId('context'),
      protocolVersion: A2A_VERSION,
      goal: input.goal,
      successMetric: input.successMetric,
      constraints: input.constraints,
      minimumYield: input.minimumYield,
      evidence: input.evidence,
      revision: 1,
      round: 0,
      phase: '目标已登记',
      governanceStatus: 'DIRECTED',
      status: 'TASK_STATE_SUBMITTED',
      yield: { score: 0, minimum: input.minimumYield, achieved: false, components: {}, openChallenges: [] },
      tasks: [],
      messages: [],
      decisions: [],
      audit: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    addAudit(context, 'leader-human', 'goal.created', '领导登记共同目标、成功指标与边界。')
    this.contexts.set(context.id, context)
    return clone(context)
  }

  runRound(id) {
    const context = this.contexts.get(id)
    if (!context) throw new Error('协作上下文不存在。')
    if (context.status === 'TASK_STATE_COMPLETED') throw new Error('该目标已完成，无需重复运行。')
    context.round += 1
    context.phase = '监督编排'
    context.governanceStatus = 'RISK_REVIEW'
    context.status = 'TASK_STATE_WORKING'
    context.finalDecision = undefined

    const supervisorTask = createTask('supervisor', context.id, `编排第 ${context.round} 轮共同目标`)
    transitionTask(supervisorTask, 'TASK_STATE_WORKING')
    context.tasks.push(supervisorTask)
    this.tasks.set(supervisorTask.id, supervisorTask)
    const delegation = createMessage('supervisor', 'business', context.id, '请围绕共同目标提交方案与可定位证据。', { round: context.round, successMetric: context.successMetric })
    const riskBrief = createMessage('supervisor', 'risk', context.id, '请独立审查目标、证据和硬约束；监督 Agent 不参与最终风险裁决。', { round: context.round, minimumYield: context.minimumYield })
    context.messages.push(delegation, riskBrief)
    supervisorTask.history.push(delegation, riskBrief)
    addAudit(context, 'supervisor-agent', 'tasks.delegated', `第 ${context.round} 轮已分别分派业务产出与独立风控审查。`, [supervisorTask.id])

    const businessTask = createTask('business', context.id, '形成业务方案与证据包')
    transitionTask(businessTask, 'TASK_STATE_WORKING')
    const businessArtifact = addArtifact(businessTask, '业务证据包', '业务 Agent 的结构化交付物，不等同于消息。', {
      goal: context.goal,
      successMetric: context.successMetric,
      evidence: context.evidence,
      evidenceOwner: 'business-human + business-agent',
    })
    transitionTask(businessTask, 'TASK_STATE_COMPLETED')
    context.tasks.push(businessTask)
    this.tasks.set(businessTask.id, businessTask)
    const businessMessage = createMessage('business', 'supervisor', context.id, `已提交 ${context.evidence.length} 项证据，等待独立风控复核。`, { artifactId: businessArtifact.artifactId })
    context.messages.push(businessMessage)
    addAudit(context, 'business-agent', 'artifact.submitted', '业务证据包已提交，原始证据所有权保持在业务责任单元。', [businessArtifact.artifactId])

    const riskTask = createTask('risk', context.id, '独立审查业务证据与收敛条件')
    transitionTask(riskTask, 'TASK_STATE_WORKING')
    context.yield = calculateYield(context)
    const recommendation = context.yield.openChallenges.length === 0 ? 'conditional_approve' : 'request_evidence'
    const riskArtifact = addArtifact(riskTask, '独立风险审查', '风控 Agent 的质询与建议；最终决定仍由风控人员确认。', {
      recommendation,
      yield: context.yield,
      vetoAuthority: 'risk-human',
      supervisorCanOverride: false,
    })
    const riskMessage = createMessage(
      'risk',
      'business',
      context.id,
      context.yield.openChallenges.length === 0
        ? '证据已达到机器收敛门槛，提交风控人员作最终裁决。'
        : `本轮仍有 ${context.yield.openChallenges.length} 项质询，退回业务补证。`,
      { artifactId: riskArtifact.artifactId, challenges: context.yield.openChallenges },
    )
    context.messages.push(riskMessage)
    transitionTask(riskTask, 'TASK_STATE_INPUT_REQUIRED', riskMessage)
    if (context.yield.openChallenges.length === 0) {
      context.phase = '等待风控裁决'
      context.governanceStatus = 'RISK_HUMAN_APPROVAL_REQUIRED'
      context.status = 'TASK_STATE_INPUT_REQUIRED'
    } else {
      context.phase = '风控质询·业务补证'
      context.governanceStatus = 'CHANGES_REQUIRED'
      context.status = 'TASK_STATE_INPUT_REQUIRED'
    }
    context.tasks.push(riskTask)
    this.tasks.set(riskTask.id, riskTask)
    transitionTask(supervisorTask, 'TASK_STATE_INPUT_REQUIRED', riskMessage)
    addAudit(context, 'risk-agent', 'review.completed', '独立风险审查已完成；结果进入补证或风控人工裁决 Gate。', [riskArtifact.artifactId])
    context.updatedAt = now()
    return clone(context)
  }

  addEvidence(id, rawEvidence) {
    const context = this.contexts.get(id)
    if (!context) throw new Error('协作上下文不存在。')
    if (context.finalDecision) throw new Error('当前 revision 已有最终裁决；如需继续，请发起重新审议。')
    const [evidence] = normalizeEvidence([rawEvidence])
    if (!evidence) throw new Error('证据标题不能为空。')
    context.evidence.push(evidence)
    context.phase = '业务已补证'
    context.governanceStatus = 'BUSINESS_SUBMITTED'
    context.status = 'TASK_STATE_SUBMITTED'
    context.finalDecision = undefined
    addAudit(context, 'business-human', 'evidence.added', `补充证据：${evidence.title}`, [evidence.id])
    context.updatedAt = now()
    return clone(context)
  }

  recordRiskDecision(id, rawDecision) {
    const context = this.contexts.get(id)
    if (!context) throw new Error('协作上下文不存在。')
    if (context.round === 0 || !context.tasks.some((task) => task.agentId === 'risk')) {
      throw new Error('风控 Agent 尚未完成独立审查。')
    }
    if (context.finalDecision) throw new Error('当前 revision 已存在不可变最终裁决。')
    const outcome = rawDecision?.outcome
    if (!['approved', 'conditionally_approved', 'rejected'].includes(outcome)) {
      throw new Error('风控裁决必须是 approved、conditionally_approved 或 rejected。')
    }
    if (outcome !== 'rejected' && context.yield.openChallenges.length > 0) {
      throw new Error('仍有未关闭质询，风控不能作通过类裁决；可选择否决。')
    }
    if (outcome !== 'rejected' && context.yield.score < context.minimumYield) {
      throw new Error('当前未达到共同收敛门槛，只能补证或否决。')
    }
    const note = String(rawDecision?.note ?? '').trim()
    if (note.length < 4) throw new Error('风控裁决理由至少需要 4 个字符。')
    const decision = {
      id: makeId('decision'),
      outcome,
      note,
      actor: 'risk-human',
      timestamp: now(),
      round: context.round,
      yieldScore: context.yield.score,
      immutable: true,
    }
    context.decisions.push(decision)
    context.finalDecision = decision
    if (outcome === 'rejected') {
      context.status = 'TASK_STATE_COMPLETED'
      context.phase = '风控否决'
      context.governanceStatus = 'REJECTED'
      context.yield.achieved = false
    } else {
      context.status = 'TASK_STATE_COMPLETED'
      context.phase = outcome === 'approved' ? '风控通过' : '附条件通过'
      context.governanceStatus = outcome === 'approved' ? 'APPROVED' : 'CONDITIONALLY_APPROVED'
      context.yield.achieved = true
    }
    for (const task of context.tasks.filter((item) => !TERMINAL_STATES.has(item.status.state))) {
      transitionTask(task, 'TASK_STATE_COMPLETED')
    }
    addAudit(context, 'risk-human', `decision.${outcome}`, note, [decision.id])
    context.updatedAt = now()
    return clone(context)
  }

  reconsiderContext(id, rawInput) {
    const previous = this.contexts.get(id)
    if (!previous) throw new Error('协作上下文不存在。')
    if (previous.finalDecision?.outcome !== 'rejected') throw new Error('只有已被风控否决的 revision 才能重新审议。')
    const reason = String(rawInput?.reason ?? '').trim()
    if (reason.length < 4) throw new Error('重新审议理由至少需要 4 个字符。')
    const extraEvidence = rawInput?.evidence ? normalizeEvidence([rawInput.evidence]) : []
    const next = this.createContext({
      goal: previous.goal,
      successMetric: previous.successMetric,
      constraints: previous.constraints,
      minimumYield: previous.minimumYield,
      evidence: [...previous.evidence, ...extraEvidence],
    })
    const storedNext = this.contexts.get(next.id)
    storedNext.revision = (previous.revision ?? 1) + 1
    storedNext.supersedesContextId = previous.id
    storedNext.reconsiderationReason = reason
    storedNext.phase = '重新审议已登记'
    storedNext.governanceStatus = 'DIRECTED'
    previous.supersededByContextId = storedNext.id
    addAudit(previous, 'leader-human', 'reconsideration.requested', reason, [storedNext.id])
    addAudit(storedNext, 'supervisor-agent', 'reconsideration.opened', `基于被否决的 revision ${previous.revision ?? 1} 创建新 revision。`, [previous.finalDecision.id])
    previous.updatedAt = now()
    storedNext.updatedAt = now()
    return clone(storedNext)
  }

  listTasks({ agentId, contextId, status } = {}) {
    return [...this.tasks.values()]
      .filter((task) => !agentId || task.agentId === agentId)
      .filter((task) => !contextId || task.contextId === contextId)
      .filter((task) => !status || task.status.state === status)
      .map(clone)
  }

  getTask(id, agentId) {
    const task = this.tasks.get(id)
    if (!task || (agentId && task.agentId !== agentId)) throw new Error('A2A task 不存在。')
    return clone(task)
  }

  cancelTask(id, agentId) {
    const task = this.tasks.get(id)
    if (!task || task.agentId !== agentId) throw new Error('A2A task 不存在。')
    if (TERMINAL_STATES.has(task.status.state)) throw new Error('终态 task 不能取消。')
    transitionTask(task, 'TASK_STATE_CANCELED')
    const context = this.contexts.get(task.contextId)
    if (context) {
      addAudit(context, `${agentId}-agent`, 'task.canceled', `取消 task ${task.id}`, [task.id])
      context.updatedAt = now()
    }
    return clone(task)
  }

  handleRpc(agentId, request) {
    if (!AGENT_IDS.includes(agentId)) return rpcError(request?.id ?? null, -32601, 'Agent endpoint not found')
    if (request?.jsonrpc !== '2.0' || request?.id === undefined || typeof request?.method !== 'string') {
      return rpcError(request?.id ?? null, -32600, 'Request payload validation error')
    }
    try {
      let result
      if (request.method === 'GetTask') {
        result = { task: this.getTask(request.params?.id, agentId) }
      } else if (request.method === 'ListTasks') {
        result = { tasks: this.listTasks({ ...request.params, agentId }), nextPageToken: '' }
      } else if (request.method === 'CancelTask') {
        result = { task: this.cancelTask(request.params?.id, agentId) }
      } else if (request.method === 'SendMessage') {
        const messageId = request.params?.message?.messageId
        if (!messageId) return rpcError(request.id, -32602, 'SendMessage 缺少 messageId')
        const inboxKey = `${agentId}:${messageId}`
        const requestHash = createHash('sha256').update(JSON.stringify(request.params)).digest('hex')
        const existing = this.inbox.get(inboxKey)
        if (existing) {
          if (existing.requestHash !== requestHash) return rpcError(request.id, -32602, 'messageId 已用于不同请求')
          return { jsonrpc: '2.0', id: request.id, result: clone(existing.result) }
        }
        result = this.#handleSendMessage(agentId, request.params)
        this.inbox.set(inboxKey, { requestHash, result: clone(result) })
      } else {
        return rpcError(request.id, -32601, 'Method not found')
      }
      return { jsonrpc: '2.0', id: request.id, result }
    } catch (error) {
      return rpcError(request.id, -32602, error instanceof Error ? error.message : 'Invalid parameters')
    }
  }

  #handleSendMessage(agentId, params) {
    const message = params?.message
    if (!message || message.role !== 'ROLE_USER' || !Array.isArray(message.parts)) {
      throw new Error('SendMessage 需要 ROLE_USER message 和 parts。')
    }
    const payload = message.parts.find((part) => part?.data)?.data ?? {}
    if (agentId === 'supervisor' && payload.action === 'start') {
      const created = this.createContext(payload.input)
      const context = this.runRound(created.id)
      return { task: context.tasks.find((task) => task.agentId === 'supervisor' && task.contextId === context.id) }
    }
    if (agentId === 'supervisor' && payload.action === 'run') {
      const context = this.runRound(payload.contextId)
      return { task: context.tasks.filter((task) => task.agentId === 'supervisor').at(-1) }
    }
    if (agentId === 'business' && payload.action === 'submit_evidence') {
      const context = this.addEvidence(payload.contextId, payload.evidence)
      return { message: createMessage('business', 'supervisor', context.id, '证据已登记，等待下一轮。', { evidenceCount: context.evidence.length }) }
    }
    if (agentId === 'risk' && payload.action === 'decide') {
      const context = this.recordRiskDecision(payload.contextId, payload.decision)
      return { message: createMessage('risk', 'supervisor', context.id, '最终风险裁决已写入不可变审计记录。', { decision: context.finalDecision }) }
    }
    throw new Error('该 Agent 不支持请求的 action。')
  }
}

export function rpcError(id, code, message, reason = 'INVALID_REQUEST') {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'stars.local.a2a' }],
    },
  }
}
