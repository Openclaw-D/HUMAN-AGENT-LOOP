import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActorClass, DurableApp, startHttpServer } from '../src/index.mjs'
import { canonicalHash, canonicalize } from '../src/event-log.mjs'

const business = { id: 'business', class: ActorClass.HUMAN }
const risk = { id: 'risk', class: ActorClass.HUMAN }
const env = (actor, capability, key, expectedVersion, payload) => ({ actor, capability, idempotencyKey: key, expectedVersion, requestHash: canonicalHash(payload) })
const fresh = async () => join(await mkdtemp(join(tmpdir(), 'tag-p0-2-')), 'tag.sqlite')
function boot(app, id = 'p1') {
  const payload = { id, title: 'Synthetic risk review', memberships: [
    { principalId: 'business', capabilities: ['message', 'addEvidence', 'submit', 'answer', 'invoke', 'reconsider'] },
    { principalId: 'risk', capabilities: ['message', 'communicate', 'resolve', 'decide', 'invoke', 'reconsider'] },
  ] }
  return app.bootstrapProject(payload, env(business, undefined, 'bootstrap', undefined, payload))
}

test('SQLite WAL restart keeps commands, immutable events, idempotency and rebuild checksum', async () => {
  const path = await fresh(); let app = new DurableApp(path); const { thread } = boot(app)
  const message = { threadId: thread.id, content: 'Please review', replyToMessageId: null, citations: [] }
  const first = app.command('p1', 'appendHumanMessage', message, env(business, 'message', 'message-1', 1, message))
  const replay = app.command('p1', 'appendHumanMessage', message, env(business, 'message', 'message-1', 1, message))
  assert.deepEqual(replay, first); const before = app.rebuildProjection('p1').checksum; app.close()
  app = new DurableApp(path); assert.equal(app.state('p1').threads[0].messages.length, 1); assert.equal(app.rebuildProjection('p1').checksum, before)
  assert.throws(() => app.command('p1', 'appendHumanMessage', { ...message, content: 'changed' }, env(business, 'message', 'message-1', 2, { ...message, content: 'changed' })), /IDEMPOTENCY_CONFLICT/)
  app.close()
})

test('project isolation, stale concurrency and advisory authority survive durable commands', async () => {
  const app = new DurableApp(await fresh()); const a = boot(app, 'p1'); boot(app, 'p2')
  const payload = { threadId: a.thread.id }
  const one = app.command('p1', 'submitForRiskReview', payload, env(business, 'submit', 's1', 1, payload))
  assert.throws(() => app.command('p1', 'submitForRiskReview', payload, env(business, 'submit', 's2', 1, payload)), /VERSION_CONFLICT/)
  assert.throws(() => app.command('p2', 'recordRiskDecision', { threadId: 'thread-p1', reviewRoundId: one.reviewRound.id, snapshotId: one.snapshot.id, outcome: 'pass', rationale: 'x' }, env(risk, 'decide', 'cross', 1, { threadId: 'thread-p1', reviewRoundId: one.reviewRound.id, snapshotId: one.snapshot.id, outcome: 'pass', rationale: 'x' })), /THREAD_NOT_FOUND/)
  assert.equal(app.events('p2').length, 1); app.close()
})

test('two concurrent same-version command attempts accept exactly one durable write', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); const payload = { threadId: thread.id, content: 'same version', replyToMessageId: null, citations: [] }
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => app.command('p1', 'appendHumanMessage', payload, env(business, 'message', 'concurrent-a', 1, payload))),
    Promise.resolve().then(() => app.command('p1', 'appendHumanMessage', payload, env(business, 'message', 'concurrent-b', 1, payload))),
  ])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1); assert.equal(attempts.filter(item => item.status === 'rejected' && /VERSION_CONFLICT/.test(item.reason.message)).length, 1)
  assert.equal(app.state('p1').threads[0].messages.length, 1); app.close()
})

test('advisory unavailable leaves the backend-governed human review usable', async () => {
  const app = new DurableApp(await fresh(), { advisoryAvailable: false }); const { thread } = boot(app); let version = 1
  const submittedPayload = { threadId: thread.id }; const submitted = app.command('p1', 'submitForRiskReview', submittedPayload, env(business, 'submit', 'submit', version, submittedPayload)); version = submitted.threadVersion
  const challengePayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, prompt: 'Evidence', mandatory: true, challengeId: null }; const challenge = app.command('p1', 'communicateRiskChallenge', challengePayload, env(risk, 'communicate', 'challenge', version, challengePayload)); version = challenge.threadVersion
  const answerPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, challengeId: challenge.challenge.id, answer: 'Provided', evidence: [{ title: 'proof', locator: 'p:1', content: 'synthetic' }], messageRefs: [] }; const answered = app.command('p1', 'answerChallenge', answerPayload, env(business, 'answer', 'answer', version, answerPayload)); version = answered.threadVersion
  const before = app.state('p1'); const advisoryPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'x', citations: [], agentId: 'agent' }
  assert.throws(() => app.command('p1', 'invokeDeterministicAdvisory', advisoryPayload, env(business, 'invoke', 'down', version, advisoryPayload)), /ADVISORY_UNAVAILABLE/); assert.deepEqual(app.state('p1'), before)
  const decisionPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, outcome: 'pass', rationale: 'human review continues' }; assert.equal(app.command('p1', 'recordRiskDecision', decisionPayload, env(risk, 'decide', 'decision', version, decisionPayload)).outcome, 'pass'); app.close()
})

test('SSE-style replay after the last durable event has no duplicate events and projection rebuild replaces a missing checkpoint', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); const first = app.events('p1'); const after = first.at(-1).sequence
  const payload = { threadId: thread.id, content: 'synthetic message', replyToMessageId: null, citations: [] }; app.command('p1', 'appendHumanMessage', payload, env(business, 'message', 'm', 1, payload))
  const replay = app.events('p1', after); assert.equal(replay.length, 1); assert.equal(replay[0].sequence > after, true); assert.equal(app.events('p1', replay[0].sequence).length, 0)
  const one = app.rebuildProjection('p1'); const two = app.rebuildProjection('p1'); assert.equal(one.checksum, two.checksum); app.close()
})

test('HTTP health, command error redaction and SSE cursor reset are local and project scoped', async () => {
  const app = new DurableApp(await fresh()); boot(app); const service = await startHttpServer(app, { port: 0 }); const port = service.server.address().port
  const health = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(health.status, 200)
  const missing = await fetch(`http://127.0.0.1:${port}/api/projects/nope/state`); assert.equal(missing.status, 404); assert.equal((await missing.text()).includes('sqlite'), false)
  const stream = await fetch(`http://127.0.0.1:${port}/api/projects/p1/events/stream`, { headers: { 'Last-Event-ID': '9999' } }); const reader = stream.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value); assert.match(first, /event: reset/); reader.cancel()
  await service.close(); app.close()
})

test('corrupt durable event chain fails closed on next startup', async () => {
  const path = await fresh(); const app = new DurableApp(path); boot(app); app.close()
  const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path); db.prepare('UPDATE events SET hash = ? WHERE sequence = 1').run('bad'); db.close()
  assert.throws(() => new DurableApp(path), /EVENT_LOG_CORRUPT/)
})

test('durable model advisory calls an injected adapter outside the request transaction and restores its public result', async () => {
  const path = await fresh(); let calls = 0
  const adapter = { analyze: async ({ snapshot, evidence, citations }) => { calls++; assert.equal(evidence[0].content, 'private evidence'); return { draft: { modelConfidence: .6, judgmentClaims: [{ criterionCode: 'identity', position: 'support', rationale: 'cited', citationEvidenceIds: [citations[0].evidenceId] }], evidenceGaps: [{ criterionCode: 'business_reality' }], nextBestEvidence: { criterionCode: 'business_reality' } }, requestId: 'offline-r1', usage: { total_tokens: 2 }, elapsedMs: 1 } } }
  let app = new DurableApp(path, { modelAdapter: adapter }); const { thread } = boot(app); const evidence = { threadId: thread.id, title: 'identity', locator: 'p:1', content: 'private evidence', criterionCode: 'identity' }
  app.command('p1', 'addEvidence', evidence, env(business, 'addEvidence', 'e', 1, evidence)); const submit = { threadId: thread.id }; const review = app.command('p1', 'submitForRiskReview', submit, env(business, 'submit', 's', 2, submit)); const payload = { threadId: thread.id, reviewRoundId: review.reviewRound.id, snapshotId: review.snapshot.id, provider: 'glm53', promptVersion: 'evidence_first_v1', reasoningEffort: 'low', citations: review.snapshot.evidence, agentId: 'glm-agent' }
  const result = await app.command('p1', 'requestModelAdvisory', payload, env(business, 'invoke', 'model', review.threadVersion, payload)); assert.equal(calls, 1); assert.equal(result.advisoryRun.status, 'succeeded'); assert.equal(app.state('p1').artifacts.length, 1); assert.equal(JSON.stringify(app.state('p1')).includes('private evidence'), false); app.close()
  app = new DurableApp(path, { modelAdapter: adapter }); assert.equal(app.state('p1').advisoryRuns[0].status, 'succeeded'); const replay = await app.command('p1', 'requestModelAdvisory', payload, env(business, 'invoke', 'model', review.threadVersion, payload)); assert.equal(calls, 1); assert.equal(replay.advisoryRun.status, 'succeeded'); app.close()
})

test('two DurableApp instances serialize one same-version write and restart can replay it', async () => {
  const path = await fresh(); const first = new DurableApp(path); const { thread } = boot(first); const second = new DurableApp(path)
  const payload = { threadId: thread.id }
  assert.equal(first.command('p1', 'submitForRiskReview', payload, env(business, 'submit', 'instance-a', 1, payload)).threadVersion, 2)
  assert.throws(() => second.command('p1', 'submitForRiskReview', payload, env(business, 'submit', 'instance-b', 1, payload)), /VERSION_CONFLICT/)
  first.close(); second.close(); const reopened = new DurableApp(path); assert.equal(reopened.state('p1').reviewRounds.length, 1); reopened.close()
})

test('durable advisory accepts frozen agentId over HTTP and every command reports its committed thread version', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); let version = 1
  const evidencePayload = { threadId: thread.id, title: 'synthetic', locator: 'p:1', content: 'proof' }; app.command('p1', 'addEvidence', evidencePayload, env(business, 'addEvidence', 'e', version, evidencePayload)); assert.equal(app.projectVersion('p1', thread.id), ++version)
  const submitPayload = { threadId: thread.id }; const submitted = app.command('p1', 'submitForRiskReview', submitPayload, env(business, 'submit', 's', version, submitPayload)); assert.equal(submitted.threadVersion, ++version)
  const challengePayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, prompt: 'check', mandatory: true, challengeId: null }; const opened = app.command('p1', 'communicateRiskChallenge', challengePayload, env(risk, 'communicate', 'c', version, challengePayload)); assert.equal(opened.threadVersion, ++version)
  const answerPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, challengeId: opened.challenge.id, answer: 'done', evidence: [], messageRefs: [] }; const answered = app.command('p1', 'answerChallenge', answerPayload, env(business, 'answer', 'a', version, answerPayload)); assert.equal(answered.threadVersion, ++version)
  const reference = answered.snapshot.evidence[0]; const advisoryPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'review', citations: [reference], agentId: 'synthetic-agent' }
  const service = await startHttpServer(app, { port: 0 }); const port = service.server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/p1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'invokeDeterministicAdvisory', payload: advisoryPayload, envelope: env(business, 'invoke', 'advisory', version, advisoryPayload) }) })
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.artifact.advisoryOnly, true); assert.equal(body.projectVersion, ++version)
  assert.throws(() => app.command('p1', 'recordRiskDecision', { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, outcome: 'pass', rationale: 'x' }, env({ id: 'synthetic-agent', class: ActorClass.AGENT }, 'decide', 'agent-decision', version, { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, outcome: 'pass', rationale: 'x' })), /HUMAN_AUTHORITY_REQUIRED/)
  await service.close(); app.close()
})

test('CORS preflight permits only configured local origin', async () => {
  const app = new DurableApp(await fresh()); boot(app); const service = await startHttpServer(app, { port: 0, origins: ['http://127.0.0.1:5173'] }); const url = `http://127.0.0.1:${service.server.address().port}/api/projects/p1/commands`
  const accepted = await fetch(url, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }); assert.equal(accepted.status, 204); assert.equal(accepted.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173'); assert.match(accepted.headers.get('access-control-allow-methods'), /POST/); assert.match(accepted.headers.get('access-control-allow-headers'), /content-type/)
  const rejected = await fetch(url, { method: 'OPTIONS', headers: { origin: 'http://evil.invalid' } }); assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('access-control-allow-origin'), null)
  await service.close(); app.close()
})

test('derived graph contains P0 review semantics, scoped edges and object citations', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); let version = 1
  const evidencePayload = { threadId: thread.id, title: 'proof', locator: 'p:1', content: 'synthetic' }; const evidence = app.command('p1', 'addEvidence', evidencePayload, env(business, 'addEvidence', 'e', version, evidencePayload)); version = app.projectVersion('p1', thread.id)
  const messagePayload = { threadId: thread.id, content: 'cited', replyToMessageId: null, citations: [{ evidenceId: evidence.id, locator: evidence.locator, contentHash: evidence.contentHash }] }; app.command('p1', 'appendHumanMessage', messagePayload, env(business, 'message', 'm', version, messagePayload)); version++
  const submitPayload = { threadId: thread.id }; const submitted = app.command('p1', 'submitForRiskReview', submitPayload, env(business, 'submit', 's', version, submitPayload)); version = submitted.threadVersion
  const challengePayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, prompt: 'why', mandatory: true, challengeId: null }; const challenge = app.command('p1', 'communicateRiskChallenge', challengePayload, env(risk, 'communicate', 'c', version, challengePayload)); version = challenge.threadVersion
  const answerPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, challengeId: challenge.challenge.id, answer: 'yes', evidence: [], messageRefs: [] }; const answered = app.command('p1', 'answerChallenge', answerPayload, env(business, 'answer', 'a', version, answerPayload)); version = answered.threadVersion
  const advisoryPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'x', citations: [answered.snapshot.evidence[0]], agentId: 'synthetic-agent' }; const advisory = app.command('p1', 'invokeDeterministicAdvisory', advisoryPayload, env(business, 'invoke', 'i', version, advisoryPayload)); version = advisory.threadVersion
  const decisionPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, outcome: 'veto', rationale: 'human' }; app.command('p1', 'recordRiskDecision', decisionPayload, env(risk, 'decide', 'd', version, decisionPayload))
  const graph = app.graph('p1'); for (const type of ['review_round', 'snapshot', 'challenge', 'artifact', 'decision']) assert.ok(graph.nodes.some(node => node.type === type)); assert.equal(graph.layout, null); assert.ok(graph.edges.some(edge => edge.type === 'cites' && edge.source === 'message:message-1' && edge.target === `evidence:${evidence.id}`)); assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target))); app.close()
})

test('an unapproved Origin is rejected before a simple mutation body can write state', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); const service = await startHttpServer(app, { port: 0, origins: ['http://127.0.0.1:5173'] }); const payload = { threadId: thread.id, content: 'must not persist', replyToMessageId: null, citations: [] }
  const response = await fetch(`http://127.0.0.1:${service.server.address().port}/api/projects/p1/commands`, { method: 'POST', headers: { origin: 'http://evil.invalid', 'content-type': 'text/plain' }, body: JSON.stringify({ command: 'appendHumanMessage', payload, envelope: env(business, 'message', 'evil', 1, payload) }) })
  assert.equal(response.status, 403); assert.equal(app.state('p1').threads[0].messages.length, 0); await service.close(); app.close()
})

test('Decision command data remains byte-identical to the immutable state record while HTTP exposes current projectVersion', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); const submitPayload = { threadId: thread.id }; const submitted = app.command('p1', 'submitForRiskReview', submitPayload, env(business, 'submit', 's', 1, submitPayload))
  const decisionPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: submitted.snapshot.id, outcome: 'pass', rationale: 'human' }; const decision = app.command('p1', 'recordRiskDecision', decisionPayload, env(risk, 'decide', 'd', 2, decisionPayload))
  assert.equal(JSON.stringify(canonicalize(decision)), JSON.stringify(canonicalize(app.state('p1').decisions[0]))); const replay = app.command('p1', 'recordRiskDecision', decisionPayload, env(risk, 'decide', 'd', 2, decisionPayload)); assert.equal(JSON.stringify(canonicalize(replay)), JSON.stringify(canonicalize(decision)))
  const service = await startHttpServer(app, { port: 0 }); const addPayload = { threadId: thread.id, title: 'proof', locator: 'p:1', content: 'synthetic' }; const response = await fetch(`http://127.0.0.1:${service.server.address().port}/api/projects/p1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'addEvidence', payload: addPayload, envelope: env(business, 'addEvidence', 'e', 3, addPayload) }) }); const responseBody = await response.json()
  assert.equal(response.status, 200); assert.equal(responseBody.projectVersion, 4); assert.equal(responseBody.data.threadVersion, undefined); await service.close(); app.close()
})

test('missing Agent id is a stable zero-write error and subscriber failure cannot roll back a committed event', async () => {
  const app = new DurableApp(await fresh()); const { thread } = boot(app); const submitPayload = { threadId: thread.id }; const submitted = app.command('p1', 'submitForRiskReview', submitPayload, env(business, 'submit', 's', 1, submitPayload)); const before = app.state('p1')
  const advisoryPayload = { threadId: thread.id, reviewRoundId: submitted.reviewRound.id, snapshotId: submitted.snapshot.id, instruction: 'x', citations: [], agentId: '' }; assert.throws(() => app.command('p1', 'invokeDeterministicAdvisory', advisoryPayload, env(business, 'invoke', 'bad-agent', 2, advisoryPayload)), /AGENT_ID_REQUIRED/); assert.deepEqual(app.state('p1'), before)
  app.onEvent(() => { throw new Error('subscriber down') }); const messagePayload = { threadId: thread.id, content: 'committed', replyToMessageId: null, citations: [] }; assert.equal(app.command('p1', 'appendHumanMessage', messagePayload, env(business, 'message', 'm', 2, messagePayload)).threadVersion, 3); assert.equal(app.state('p1').threads[0].messages.length, 1); app.close()
})
