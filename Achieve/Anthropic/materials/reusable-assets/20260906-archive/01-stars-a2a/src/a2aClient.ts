export type AgentId = 'supervisor' | 'business' | 'risk'
export type RiskOutcome = 'approved' | 'conditionally_approved' | 'rejected'

export interface EvidenceItem {
  id: string
  title: string
  source: string
  locator: string
  submittedAt: string
}

export interface A2ATask {
  id: string
  agentId: AgentId
  summary: string
  status: { state: string; timestamp: string }
  artifacts: Array<{ artifactId: string; name: string; description: string }>
}

export interface AuditEvent {
  sequence: number
  eventId: string
  timestamp: string
  actor: string
  action: string
  detail: string
  hash: string
}

export interface RiskDecision {
  id: string
  outcome: RiskOutcome
  note: string
  actor: 'risk-human'
  timestamp: string
  round: number
  yieldScore: number
  immutable: true
}

export interface CoordinationContext {
  id: string
  protocolVersion: '1.0'
  revision: number
  goal: string
  successMetric: string
  constraints: string[]
  minimumYield: number
  evidence: EvidenceItem[]
  round: number
  phase: string
  status: string
  governanceStatus: string
  yield: {
    score: number
    minimum: number
    achieved: boolean
    readyForDecision?: boolean
    components: Record<string, number>
    openChallenges: string[]
  }
  tasks: A2ATask[]
  decisions: RiskDecision[]
  finalDecision?: RiskDecision
  audit: AuditEvent[]
  updatedAt: string
}

export interface GoalInput {
  goal: string
  successMetric: string
  constraints: string[]
  minimumYield: number
  evidence?: Array<{ title: string; source: string; locator: string }>
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `请求失败：HTTP ${response.status}`)
  return data
}

export function listContexts() {
  return request<CoordinationContext[]>('/api/contexts')
}

export function createContext(input: GoalInput) {
  return request<CoordinationContext>('/api/contexts', { method: 'POST', body: JSON.stringify(input) })
}

export function runRound(contextId: string) {
  return request<CoordinationContext>(`/api/contexts/${contextId}/run`, { method: 'POST', body: '{}' })
}

export function addEvidence(contextId: string, evidence: { title: string; source: string; locator: string }) {
  return request<CoordinationContext>(`/api/contexts/${contextId}/evidence`, { method: 'POST', body: JSON.stringify(evidence) })
}

export function recordRiskDecision(contextId: string, decision: { outcome: RiskOutcome; note: string }) {
  return request<CoordinationContext>(`/api/contexts/${contextId}/risk-decision`, { method: 'POST', body: JSON.stringify(decision) })
}

export function reconsiderContext(contextId: string, reason: string) {
  return request<CoordinationContext>(`/api/contexts/${contextId}/reconsider`, { method: 'POST', body: JSON.stringify({ reason }) })
}
