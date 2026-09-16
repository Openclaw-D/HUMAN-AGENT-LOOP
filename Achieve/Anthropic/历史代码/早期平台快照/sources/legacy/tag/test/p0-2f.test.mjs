import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActorClass, DurableApp, startHttpServer } from '../src/index.mjs'
import { canonicalHash } from '../src/event-log.mjs'

const business = { id: 'business', class: ActorClass.HUMAN }; const risk = { id: 'risk', class: ActorClass.HUMAN }
const env = (actor, capability, key, expectedVersion, payload) => ({ actor, capability, idempotencyKey: key, expectedVersion, requestHash: canonicalHash(payload) })
async function setup() { const app = new DurableApp(join(await mkdtemp(join(tmpdir(), 'tag-p0-2f-')), 'state.sqlite')); const payload = { id: 'p', title: 'synthetic', memberships: [{ principalId: 'business', capabilities: ['addEvidence', 'precheck', 'submit', 'answer', 'invoke'] }, { principalId: 'risk', capabilities: ['communicate', 'resolve', 'decide', 'invoke'] }] }; const result = app.bootstrapProject(payload, env(business, undefined, 'boot', undefined, payload)); return { app, threadId: result.thread.id } }

test('precheck is capped at three and formal review at two without automatic veto', async () => {
  const { app, threadId } = await setup(); let version = 1; let latest
  for (let i = 1; i <= 3; i++) { const payload = { threadId }; latest = app.command('p', 'createPrecheckAttempt', payload, env(business, 'precheck', `p${i}`, version, payload)); version++ }
  const before = app.state('p'); const fourth = { threadId }; assert.throws(() => app.command('p', 'createPrecheckAttempt', fourth, env(business, 'precheck', 'p4', version, fourth)), /PRECHECK_ATTEMPT_LIMIT_REACHED/); assert.deepEqual(app.state('p'), before)
  const submit = { threadId }; const round = app.command('p', 'submitForRiskReview', submit, env(business, 'submit', 'submit', version, submit)); version++
  const challenge = { threadId, reviewRoundId: round.reviewRound.id, prompt: 'synthetic', mandatory: true, challengeId: null }; const opened = app.command('p', 'communicateRiskChallenge', challenge, env(risk, 'communicate', 'c', version, challenge)); version++
  const answer = { threadId, reviewRoundId: round.reviewRound.id, challengeId: opened.challenge.id, answer: 'synthetic', evidence: [], messageRefs: [] }; app.command('p', 'answerChallenge', answer, env(business, 'answer', 'a', version, answer)); version++
  const state = app.state('p'); const blocked = { ...challenge, challengeId: null }; assert.throws(() => app.command('p', 'communicateRiskChallenge', blocked, env(risk, 'communicate', 'blocked', version, blocked)), /FORMAL_REVIEW_PASS_LIMIT_REACHED/); assert.equal(app.state('p').decisions.length, 0); assert.equal(state.reviewPasses.length, 2); app.close()
})

test('judgment read model, occurredAt and graph are durable derived records', async t => {
  const { app, threadId } = await setup(); t.after(() => app.close()); const payload = { threadId }; app.command('p', 'createPrecheckAttempt', payload, env(business, 'precheck', 'p', 1, payload)); const judgment = app.judgment('p', threadId); assert.equal(judgment.nextAction.code, 'ADD_EVIDENCE'); assert.equal(judgment.limits.precheck.used, 1); assert.equal(judgment.metrics.timeToSubmissionMs, null)
  assert.ok(app.events('p').every(event => typeof event.occurredAt === 'string')); const graph = app.graph('p'); assert.ok(graph.nodes.some(node => node.type === 'precheck_attempt')); assert.equal(graph.layout, null)
  const service = await startHttpServer(app, { port: 0 }); t.after(() => service.close()); const response = await fetch(`http://127.0.0.1:${service.server.address().port}/api/projects/p/judgment?threadId=${threadId}`); assert.equal(response.status, 200); assert.equal((await response.json()).nextAction.code, 'ADD_EVIDENCE')
})

test('judgment scopes thread and current round, with answered challenges requiring risk resolution', async () => {
  const { app, threadId } = await setup(); assert.throws(() => app.judgment('p', 'thread-foreign'), /THREAD_NOT_FOUND/); assert.equal(app.judgment('p', threadId).nextAction.code, 'ADD_EVIDENCE')
  const submit = { threadId }; const round = app.command('p', 'submitForRiskReview', submit, env(business, 'submit', 's', 1, submit)); const precheck = { threadId }; const before = app.state('p'); assert.throws(() => app.command('p', 'createPrecheckAttempt', precheck, env(business, 'precheck', 'late', 2, precheck)), /STATE_TRANSITION_INVALID/); assert.deepEqual(app.state('p'), before)
  const challenge = { threadId, reviewRoundId: round.reviewRound.id, prompt: 'x', mandatory: true, challengeId: null }; const opened = app.command('p', 'communicateRiskChallenge', challenge, env(risk, 'communicate', 'c', 2, challenge)); const answer = { threadId, reviewRoundId: round.reviewRound.id, challengeId: opened.challenge.id, answer: 'x', evidence: [], messageRefs: [] }; app.command('p', 'answerChallenge', answer, env(business, 'answer', 'a', 3, answer)); assert.equal(app.judgment('p', threadId).nextAction.code, 'RESOLVE_CHALLENGE')
  const stale = { threadId, reviewRoundId: round.reviewRound.id, snapshotId: round.snapshot.id, outcome: 'pass', rationale: 'old' }; assert.throws(() => app.command('p', 'recordRiskDecision', stale, env(risk, 'decide', 'old', 4, stale)), /STATE_TRANSITION_INVALID/); app.close()
})

test('next best evidence is followed only after its recommendation snapshot', async () => {
  const { app, threadId } = await setup(); let version = 1
  for (const code of ['identity', 'business_reality', 'purpose']) { const payload = { threadId, title: code, locator: code, content: code, criterionCode: code }; app.command('p', 'addEvidence', payload, env(business, 'addEvidence', `e-${code}`, version++, payload)) }
  const first = { threadId }; const attempt = app.command('p', 'createPrecheckAttempt', first, env(business, 'precheck', 'p1', version++, first)); const advisoryPayload = { threadId, snapshotId: attempt.snapshot.id, precheckAttemptId: attempt.precheckAttempt.id, instruction: 'x', citations: attempt.snapshot.evidence, agentId: 'agent' }; const artifact = app.command('p', 'invokeDeterministicAdvisory', advisoryPayload, env(business, 'invoke', 'a1', version++, advisoryPayload)); assert.equal(artifact.artifact.nextBestEvidence.criterionCode, 'repayment'); assert.equal(app.judgment('p', threadId).metrics.nextBestEvidenceFollowed, false)
  const repayment = { threadId, title: 'repayment', locator: 'repayment', content: 'repayment', criterionCode: 'repayment' }; app.command('p', 'addEvidence', repayment, env(business, 'addEvidence', 'e-repayment', version++, repayment)); const second = { threadId }; app.command('p', 'createPrecheckAttempt', second, env(business, 'precheck', 'p2', version++, second)); assert.equal(app.judgment('p', threadId).metrics.nextBestEvidenceFollowed, true); app.close()
})
