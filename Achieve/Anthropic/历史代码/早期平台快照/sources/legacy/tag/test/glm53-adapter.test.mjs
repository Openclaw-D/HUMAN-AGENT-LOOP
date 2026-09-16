import test from 'node:test'
import assert from 'node:assert/strict'
import { Glm53Adapter } from '../src/index.mjs'

const snapshot = { id: 's1', profileVersion: 'risk-v1', phase: 'precheck', challengeState: 'none', evidence: [{ evidenceId: 'e1', locator: 'p:1', contentHash: 'hash-e1' }], criterionCoverage: [{ criterionCode: 'identity', required: true, status: 'covered' }, { criterionCode: 'repayment', label: '还款来源', required: true, status: 'missing' }] }
const citation = { evidenceId: 'e1', locator: 'p:1', contentHash: 'hash-e1' }
const valid = { modelConfidence: .7, judgmentClaims: [{ criterionCode: 'identity', position: 'support', rationale: '已引用', citationEvidenceIds: ['e1'] }], evidenceGaps: [{ criterionCode: 'repayment' }], nextBestEvidence: { criterionCode: 'repayment' } }
const response = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: key => headers[key] ?? null }, json: async () => body })
const input = { promptVersion: 'evidence_first_v1', reasoningEffort: 'low', snapshot, evidence: [{ id: 'e1', title: '身份证明', criterionCode: 'identity', locator: 'p:1', content: 'secret synthetic' }], citations: [citation] }
const adapterFor = fetchImpl => new Glm53Adapter({ env: { ZAI_API_KEY: 'key' }, fetchImpl })

test('GLM adapter sends frozen shape, distinct full prompts and redacts secrets', async () => {
  const seen = []; const adapter = new Glm53Adapter({ env: { TAG_GLM_API_KEY: 'preferred', ZAI_API_KEY: 'fallback' }, clock: (() => { let n = 0; return () => ++n })(), fetchImpl: async (url, init) => { seen.push({ url, init }); return response(200, { request_id: 'payload-request', choices: [{ message: { content: JSON.stringify(valid) } }], usage: { total_tokens: 3, hidden: 'no' } }) } })
  const result = await adapter.analyze(input); await adapter.analyze({ ...input, promptVersion: 'disagreement_first_v1', reasoningEffort: 'high' })
  const body = JSON.parse(seen[0].init.body); const firstPrompt = body.messages[0].content; const secondPrompt = JSON.parse(seen[1].init.body).messages[0].content
  assert.equal(seen[0].url, 'https://api.z.ai/api/paas/v4/chat/completions'); assert.equal(seen[0].init.headers.authorization, 'Bearer preferred'); assert.deepEqual({ model: body.model, stream: body.stream, response_format: body.response_format, thinking: body.thinking, reasoning_effort: body.reasoning_effort }, { model: 'glm-5.3', stream: false, response_format: { type: 'json_object' }, thinking: { type: 'enabled' }, reasoning_effort: 'low' })
  assert.notEqual(firstPrompt, secondPrompt); for (const prompt of [firstPrompt, secondPrompt]) { assert.match(prompt, /advisoryOnly/); assert.match(prompt, /风险人类是唯一终决者/); assert.match(prompt, /identity\|business_reality\|purpose\|repayment/); assert.match(prompt, /support\|uncertain\|unknown/) }
  assert.equal(result.requestId, 'payload-request'); assert.deepEqual(result.usage, { total_tokens: 3 }); assert.equal(JSON.stringify(result).includes('preferred'), false); assert.equal(JSON.stringify(result).includes('secret synthetic'), false)
})

test('GLM adapter rejects invalid input, output and offline failures', async () => {
  for (const promptVersion of ['evidence_first_v1', 'disagreement_first_v1']) for (const reasoningEffort of ['low', 'high']) await adapterFor(async () => response(200, { choices: [{ message: { content: JSON.stringify(valid) } }] })).analyze({ ...input, promptVersion, reasoningEffort })
  await assert.rejects(() => new Glm53Adapter({ env: {} }).analyze(input), /ADVISORY_UNAVAILABLE/)
  for (const [status, code] of [[429, 'ADVISORY_RATE_LIMITED'], [401, 'ADVISORY_UNAVAILABLE']]) await assert.rejects(() => adapterFor(async () => response(status, {})).analyze(input), new RegExp(code))
  await assert.rejects(() => adapterFor(async () => { throw new Error('offline') }).analyze(input), /ADVISORY_UNAVAILABLE/)
  await assert.rejects(() => new Glm53Adapter({ env: { ZAI_API_KEY: 'key' }, timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))) }).analyze(input), /ADVISORY_UNAVAILABLE/)
  await assert.rejects(() => adapterFor(async () => ({ ...response(200, {}), json: async () => { throw new Error('not json') } })).analyze(input), /ADVISORY_INVALID_OUTPUT/)
  for (const draft of [{ ...valid, judgmentClaims: [{ ...valid.judgmentClaims[0], citationEvidenceIds: ['unknown'] }] }, { ...valid, evidenceGaps: [{ criterionCode: 'identity' }] }, { ...valid, extra: true }, { ...valid, judgmentClaims: [{ ...valid.judgmentClaims[0], rationale: '建议通过' }] }, { ...valid, decision: 'pass' }]) await assert.rejects(() => adapterFor(async () => response(200, { choices: [{ message: { content: JSON.stringify(draft) } }] })).analyze(input), /ADVISORY_INVALID_OUTPUT/)
  await assert.rejects(() => adapterFor(async () => response(200, { choices: [{ message: { content: JSON.stringify(valid) } }] })).analyze({ ...input, citations: [{ ...citation, locator: 'wrong' }] }), /ADVISORY_INVALID_OUTPUT/)
  await assert.rejects(() => adapterFor(async () => response(200, { choices: [{ message: { content: JSON.stringify(valid) } }] })).analyze({ ...input, citations: [{ ...citation, contentHash: 'wrong' }] }), /ADVISORY_INVALID_OUTPUT/)
  assert.throws(() => new Glm53Adapter({ baseUrl: 'http://api.z.ai/x' }), /ADVISORY_UNAVAILABLE/)
  assert.equal(new Glm53Adapter({ env: { TAG_GLM_BASE_URL: 'https://api.z.ai/api/paas/v4' } }).baseUrl, 'https://api.z.ai/api/paas/v4/chat/completions')
})
