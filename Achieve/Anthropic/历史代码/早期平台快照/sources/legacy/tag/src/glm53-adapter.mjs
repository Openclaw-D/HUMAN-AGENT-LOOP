const CRITERIA = new Set(['identity', 'business_reality', 'purpose', 'repayment'])
const PROMPTS = new Set(['evidence_first_v1', 'disagreement_first_v1'])
const EFFORTS = new Set(['low', 'high'])
const ENDPOINT_PATH = '/api/paas/v4/chat/completions'
const ROOT_PATH = '/api/paas/v4'
const FORBIDDEN_SEMANTICS = /pass|veto|decision|approvalProbability|建议通过|建议否决|批准|否决|拒绝/i
const fail = code => { const error = new Error(code); error.code = code; throw error }

const SYSTEM_PROMPTS = {
  evidence_first_v1: `你是项目治理中的模型顾问，输出仅为 advisoryOnly 建议。风险人类是唯一终决者；你不得作出 pass、veto、批准、否决或拒绝。只能使用当前 ContextSnapshot 的 Evidence，任何事实性 claim 必须逐条精确引用该 Snapshot 中的 Citation。先分析证据覆盖与缺口，再分析可能分歧。只返回 JSON：{"modelConfidence":0到1,"judgmentClaims":[{"criterionCode":"identity|business_reality|purpose|repayment","position":"support|uncertain|unknown","rationale":"string","citationEvidenceIds":["evidenceId"]}],"evidenceGaps":[{"criterionCode":"当前 required missing 维度"}],"nextBestEvidence":null或{"criterionCode":"当前第一个 required missing 维度"}}。support/uncertain 必须至少一个 citation；unknown 可为空。gap 只能是当前 required missing 维度；nextBestEvidence 只能是第一个 required missing 维度，且不保证通过。不得添加任何其他字段。`,
  disagreement_first_v1: `你是项目治理中的模型顾问，输出仅为 advisoryOnly 建议。风险人类是唯一终决者；你不得作出 pass、veto、批准、否决或拒绝。只能使用当前 ContextSnapshot 的 Evidence，任何事实性 claim 必须逐条精确引用该 Snapshot 中的 Citation。先分析规则覆盖和模型不确定性，再分析证据与可能分歧。只返回 JSON：{"modelConfidence":0到1,"judgmentClaims":[{"criterionCode":"identity|business_reality|purpose|repayment","position":"support|uncertain|unknown","rationale":"string","citationEvidenceIds":["evidenceId"]}],"evidenceGaps":[{"criterionCode":"当前 required missing 维度"}],"nextBestEvidence":null或{"criterionCode":"当前第一个 required missing 维度"}}。support/uncertain 必须至少一个 citation；unknown 可为空。gap 只能是当前 required missing 维度；nextBestEvidence 只能是第一个 required missing 维度，且不保证通过。不得添加任何其他字段。`
}

export class Glm53Adapter {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15_000, baseUrl, allowedHosts = ['api.z.ai'], clock = () => Date.now() } = {}) {
    this.env = env; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.clock = clock
    this.baseUrl = normalizeBaseUrl(baseUrl ?? env.TAG_GLM_BASE_URL ?? 'https://api.z.ai/api/paas/v4/chat/completions', allowedHosts)
  }

  async analyze({ promptVersion, reasoningEffort, snapshot, evidence = [], citations = [] }) {
    if (!PROMPTS.has(promptVersion) || !EFFORTS.has(reasoningEffort)) fail('ADVISORY_INVALID_OUTPUT')
    const key = this.env.TAG_GLM_API_KEY || this.env.ZAI_API_KEY
    if (!key) fail('ADVISORY_UNAVAILABLE')
    const verifiedCitations = verifyInputCitations(snapshot, citations)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); const started = this.clock()
    const evidenceIds = new Set(snapshot.evidence.map(item => item.evidenceId))
    const context = evidence.filter(item => evidenceIds.has(item.id)).map(item => ({ id: item.id, title: item.title ?? null, criterionCode: item.criterionCode, locator: item.locator, content: item.content }))
    const userContext = { profileVersion: snapshot.profileVersion ?? null, phase: snapshot.phase ?? null, criterionCoverage: snapshot.criterionCoverage ?? [], challengeState: snapshot.challengeState ?? null, evidence: context, citations }
    try {
      let response
      try { response = await this.fetchImpl(this.baseUrl, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model: 'glm-5.3', stream: false, response_format: { type: 'json_object' }, thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort, messages: [{ role: 'system', content: SYSTEM_PROMPTS[promptVersion] }, { role: 'user', content: JSON.stringify(userContext) }] }) }) } catch { fail('ADVISORY_UNAVAILABLE') }
      if (response.status === 429) fail('ADVISORY_RATE_LIMITED')
      if (response.status === 401 || response.status === 403 || response.status >= 500) fail('ADVISORY_UNAVAILABLE')
      if (!response.ok) fail('ADVISORY_INVALID_OUTPUT')
      let payload; try { payload = await response.json() } catch { fail('ADVISORY_INVALID_OUTPUT') }
      const content = payload?.choices?.[0]?.message?.content; if (typeof content !== 'string') fail('ADVISORY_INVALID_OUTPUT')
      let draft; try { draft = JSON.parse(content) } catch { fail('ADVISORY_INVALID_OUTPUT') }
      return { draft: validateDraft(draft, { snapshot, verifiedCitations }), requestId: payload.request_id ?? response.headers?.get?.('x-request-id') ?? payload.id ?? null, usage: redactUsage(payload.usage), elapsedMs: Math.max(0, this.clock() - started) }
    } finally { clearTimeout(timer) }
  }
}

function normalizeBaseUrl(value, allowedHosts) {
  let url; try { url = new URL(value) } catch { fail('ADVISORY_UNAVAILABLE') }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || ![ROOT_PATH, `${ROOT_PATH}/`, ENDPOINT_PATH, `${ENDPOINT_PATH}/`].includes(url.pathname)) fail('ADVISORY_UNAVAILABLE')
  url.pathname = ENDPOINT_PATH; url.search = ''; url.hash = ''
  return url.toString()
}

function verifyInputCitations(snapshot, citations) {
  if (!Array.isArray(snapshot?.evidence) || !Array.isArray(citations)) fail('ADVISORY_INVALID_OUTPUT')
  const refs = new Map(snapshot.evidence.map(ref => [ref.evidenceId, ref])); const verified = new Set()
  for (const citation of citations) { const ref = refs.get(citation?.evidenceId); if (!ref || citation.locator !== ref.locator || citation.contentHash !== ref.contentHash) fail('ADVISORY_INVALID_OUTPUT'); verified.add(citation.evidenceId) }
  return verified
}

function validateDraft(draft, { snapshot, verifiedCitations }) {
  if (!plainObjectWithOnly(draft, ['modelConfidence', 'judgmentClaims', 'evidenceGaps', 'nextBestEvidence']) || FORBIDDEN_SEMANTICS.test(JSON.stringify(draft))) fail('ADVISORY_INVALID_OUTPUT')
  if (typeof draft.modelConfidence !== 'number' || draft.modelConfidence < 0 || draft.modelConfidence > 1 || !Array.isArray(draft.judgmentClaims) || !Array.isArray(draft.evidenceGaps)) fail('ADVISORY_INVALID_OUTPUT')
  const claims = draft.judgmentClaims.map(claim => {
    if (!plainObjectWithOnly(claim, ['criterionCode', 'position', 'rationale', 'citationEvidenceIds']) || !CRITERIA.has(claim.criterionCode) || !['support', 'uncertain', 'unknown'].includes(claim.position) || typeof claim.rationale !== 'string' || !Array.isArray(claim.citationEvidenceIds)) fail('ADVISORY_INVALID_OUTPUT')
    if (['support', 'uncertain'].includes(claim.position) && !claim.citationEvidenceIds.length) fail('ADVISORY_INVALID_OUTPUT')
    if (!claim.citationEvidenceIds.every(id => typeof id === 'string' && verifiedCitations.has(id))) fail('ADVISORY_INVALID_OUTPUT')
    return { criterionCode: claim.criterionCode, position: claim.position, rationale: claim.rationale, citationEvidenceIds: [...claim.citationEvidenceIds] }
  })
  const missing = (snapshot.criterionCoverage ?? []).filter(item => item.required && item.status === 'missing')
  const gaps = draft.evidenceGaps.map(gap => { if (!plainObjectWithOnly(gap, ['criterionCode']) || !missing.some(item => item.criterionCode === gap.criterionCode)) fail('ADVISORY_INVALID_OUTPUT'); return { criterionCode: gap.criterionCode } })
  const nbe = draft.nextBestEvidence
  if (nbe !== null && (!plainObjectWithOnly(nbe, ['criterionCode']) || !missing[0] || nbe.criterionCode !== missing[0].criterionCode)) fail('ADVISORY_INVALID_OUTPUT')
  return { modelConfidence: draft.modelConfidence, judgmentClaims: claims, evidenceGaps: gaps, nextBestEvidence: nbe === null ? null : { criterionCode: missing[0].criterionCode, label: missing[0].label, note: '仅改善解释覆盖，不保证通过' } }
}

function plainObjectWithOnly(value, keys) { return !!value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value) }
function redactUsage(usage) { if (!usage || typeof usage !== 'object') return null; return Object.fromEntries(Object.entries(usage).filter(([, value]) => typeof value === 'number')) }
