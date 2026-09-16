import test from 'node:test'
import assert from 'node:assert/strict'
import { ActorClass, CoordinationCore } from '../src/index.mjs'
import { canonicalHash } from '../src/event-log.mjs'

const business = { id: 'business', class: ActorClass.HUMAN }
const risk = { id: 'risk', class: ActorClass.HUMAN }
const control = { id: 'control', class: ActorClass.CONTROL }
const agent = { id: 'agent', class: ActorClass.AGENT, projectId: 'p1' }
const env = (actor, capability, key, expectedVersion, payload) => ({ actor, capability, idempotencyKey: key, expectedVersion, requestHash: canonicalHash(payload) })

function setup() {
  const core = new CoordinationCore()
  const { thread } = core.createProject({ id: 'p1', title: 'risk', memberships: [
    { principalId: 'business', capabilities: ['addEvidence', 'precheck', 'submit', 'answer', 'invoke', 'reconsider'] },
    { principalId: 'risk', capabilities: ['communicate', 'resolve', 'decide', 'invoke', 'reconsider'] },
    { principalId: 'control', capabilities: ['decide'] },
  ] }, { actor: business, idempotencyKey: 'create' })
  return { core, threadId: thread.id }
}

test('business can submit incomplete material; risk challenge, answer, advisory and pass complete the loop', () => {
  const { core, threadId } = setup()
  let v = 1
  const submittedPayload = { threadId }
  const submitted = core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 'submit', v, submittedPayload)); v = submitted.threadVersion
  assert.equal(submitted.reviewRound.status, 'submitted')
  const challengePayload = { threadId, reviewRoundId: submitted.reviewRound.id, prompt: 'Need signed evidence', mandatory: true, challengeId: null }
  const opened = core.communicateRiskChallenge({ projectId: 'p1', ...challengePayload }, env(risk, 'communicate', 'challenge', v, challengePayload)); v = opened.threadVersion
  assert.equal(opened.challenge.status, 'open')
  const answerPayload = { threadId, reviewRoundId: submitted.reviewRound.id, challengeId: opened.challenge.id, answer: 'Attached.', evidence: [{ title: 'signed', locator: 'p:2', content: 'proof' }], messageRefs: [] }
  const answered = core.answerChallenge({ projectId: 'p1', ...answerPayload }, env(business, 'answer', 'answer', v, answerPayload)); v = answered.threadVersion
  assert.equal(answered.snapshot.id, 'snapshot-2')
  const ref = answered.snapshot.evidence[0]
  const advisoryPayload = { threadId, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'assess', citations: [{ ...ref }], agentId: agent.id }
  const advisory = core.invokeDeterministicAdvisory({ projectId: 'p1', threadId, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'assess', citations: [{ ...ref }], agent }, env(business, 'invoke', 'advice', v, advisoryPayload)); v = advisory.threadVersion
  assert.equal(advisory.artifact.advisoryOnly, true)
  const decisionPayload = { threadId, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, outcome: 'pass', rationale: 'risk judgment' }
  const decision = core.recordRiskDecision({ projectId: 'p1', ...decisionPayload }, env(risk, 'decide', 'decision', v, decisionPayload))
  assert.equal(decision.outcome, 'pass')
  assert.equal(core.eventLog.verify(), true)
})

test('capability, citation, cross-project, stale-version and hash failures have zero side effects', () => {
  const { core, threadId } = setup()
  const before = core.snapshot('p1')
  const payload = { threadId }
  assert.throws(() => core.submitForRiskReview({ projectId: 'p1', threadId }, { ...env(business, 'submit', 'bad-hash', 1, payload), requestHash: 'bad' }), /REQUEST_HASH_MISMATCH/)
  assert.throws(() => core.recordRiskDecision({ projectId: 'p1', threadId, reviewRoundId: 'review-x', snapshotId: 'snapshot-x', outcome: 'pass', rationale: 'x' }, env(business, 'decide', 'business-decide', 1, { threadId, reviewRoundId: 'review-x', snapshotId: 'snapshot-x', outcome: 'pass', rationale: 'x' })), /CAPABILITY_REQUIRED/)
  assert.throws(() => core.submitForRiskReview({ projectId: 'p1', threadId }, env(control, 'submit', 'control-submit', 1, payload)), /HUMAN_AUTHORITY_REQUIRED/)
  assert.throws(() => core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 'stale', 2, payload)), /VERSION_CONFLICT/)
  assert.deepEqual(core.snapshot('p1'), before)
  assert.throws(() => core.snapshot('foreign'), /PROJECT_NOT_FOUND/)
})

test('deep canonical retries replay once and changed requests conflict', () => {
  const { core, threadId } = setup(); const payload = { threadId }
  const first = core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 'same', 1, payload))
  const replay = core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 'same', 1, { threadId }))
  assert.deepEqual(replay, first)
  const changed = { threadId: 'thread-other' }
  assert.throws(() => core.submitForRiskReview({ projectId: 'p1', ...changed }, env(business, 'submit', 'same', 1, changed)), /IDEMPOTENCY_CONFLICT/)
  assert.equal(core.snapshot('p1').reviewRounds.length, 1)
})

test('reconsideration preserves prior decision and starts a new linked review', () => {
  const { core, threadId } = setup(); const s = core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 's', 1, { threadId }))
  const decisionPayload = { threadId, reviewRoundId: s.reviewRound.id, snapshotId: s.snapshot.id, outcome: 'veto', rationale: 'human' }
  const d = core.recordRiskDecision({ projectId: 'p1', ...decisionPayload }, env(risk, 'decide', 'd', s.threadVersion, decisionPayload))
  const reconsiderPayload = { threadId, decisionId: d.id }
  const next = core.reconsiderRiskDecision({ projectId: 'p1', ...reconsiderPayload }, env(business, 'reconsider', 'r', s.threadVersion + 1, reconsiderPayload))
  const state = core.snapshot('p1')
  assert.equal(next.reviewRound.supersedesDecisionId, d.id)
  assert.equal(state.decisions[0].outcome, 'veto')
  assert.equal(state.snapshots.length, 2)
})

test('risk can reopen during first pass, but second pass rejects further challenges with zero writes', () => {
  const { core, threadId } = setup(); let v = 1
  const submitted = core.submitForRiskReview({ projectId: 'p1', threadId }, env(business, 'submit', 's', v, { threadId })); v = submitted.threadVersion
  const challenge = { threadId, reviewRoundId: submitted.reviewRound.id, prompt: 'first', mandatory: true, challengeId: null }
  const opened = core.communicateRiskChallenge({ projectId: 'p1', ...challenge }, env(risk, 'communicate', 'c1', v, challenge)); v = opened.threadVersion
  const resolve = { threadId, reviewRoundId: submitted.reviewRound.id, challengeId: opened.challenge.id }
  const resolved = core.resolveRiskChallenge({ projectId: 'p1', ...resolve }, env(risk, 'resolve', 'r1', v, resolve)); v = resolved.threadVersion
  const reopen = { ...challenge, challengeId: opened.challenge.id, prompt: 'second' }
  const reopened = core.communicateRiskChallenge({ projectId: 'p1', ...reopen }, env(risk, 'communicate', 'c2', v, reopen)); v = reopened.threadVersion
  assert.equal(reopened.challenge.status, 'reopened')
  const answer = { threadId, reviewRoundId: submitted.reviewRound.id, challengeId: opened.challenge.id, answer: 'answer', evidence: [{ title: 'a', locator: 'l:1', content: 'one' }], messageRefs: [] }
  const answered = core.answerChallenge({ projectId: 'p1', ...answer }, env(business, 'answer', 'a1', v, answer)); v = answered.threadVersion
  const before = core.snapshot('p1')
  assert.throws(() => core.communicateRiskChallenge({ projectId: 'p1', ...reopen }, env(risk, 'communicate', 'c3', v, reopen)), /FORMAL_REVIEW_PASS_LIMIT_REACHED/)
  const invoke = { threadId, reviewRoundId: submitted.reviewRound.id, snapshotId: answered.snapshot.id, instruction: 'x', citations: [{ evidenceId: 'evidence-foreign', locator: 'x', contentHash: 'x' }], agentId: agent.id }
  assert.throws(() => core.invokeDeterministicAdvisory({ projectId: 'p1', ...invoke, agent }, env(business, 'invoke', 'bad-cite', v, invoke)), /CITATION_INVALID/)
  assert.deepEqual(core.snapshot('p1'), before)
})

test('model advisory runs keep Evidence content private and only an Agent can finish an advisory artifact', () => {
  const { core, threadId } = setup()
  const evidencePayload = { threadId, title: 'identity', locator: 'p:1', content: 'private-proof', criterionCode: 'identity' }
  core.addEvidence({ projectId: 'p1', ...evidencePayload }, env(business, 'addEvidence', 'evidence', 1, evidencePayload))
  const precheckPayload = { threadId }
  const precheck = core.createPrecheckAttempt({ projectId: 'p1', threadId }, env(business, 'precheck', 'precheck', 2, precheckPayload))
  const citation = precheck.snapshot.evidence[0]
  assert.deepEqual(core.modelContext('p1', threadId, precheck.snapshot.id), [{ id: citation.evidenceId, title: 'identity', criterionCode: 'identity', locator: 'p:1', content: 'private-proof' }])
  assert.throws(() => core.modelContext('p1', 'thread-other', precheck.snapshot.id), /SNAPSHOT_NOT_FOUND/)
  const requestPayload = { threadId, snapshotId: precheck.snapshot.id, reviewRoundId: undefined, precheckAttemptId: precheck.precheckAttempt.id, provider: 'glm53', promptVersion: 'evidence_first_v1', reasoningEffort: 'low', citations: [citation], agentId: agent.id, runId: undefined, attempt: 1, fencingToken: 1 }
  const requested = core.requestModelAdvisory({ projectId: 'p1', ...requestPayload, agent }, env(business, 'invoke', 'model-request', precheck.threadVersion, requestPayload))
  assert.equal(requested.advisoryRun.status, 'running'); assert.equal(requested.advisoryRun.model, 'glm-5.3'); assert.equal(requested.advisoryRun.expectedCompletionVersion, requested.threadVersion)
  const publicJson = JSON.stringify(core.snapshot('p1')); assert.equal(publicJson.includes('private-proof'), false); assert.equal(publicJson.includes('ownerToken'), false); assert.equal(publicJson.includes('secret-key'), false)
  const draft = { modelConfidence: .6, judgmentClaims: [{ criterionCode: 'identity', position: 'support', rationale: 'cited', citationEvidenceIds: [citation.evidenceId] }], evidenceGaps: [{ criterionCode: 'business_reality' }], nextBestEvidence: { criterionCode: 'business_reality' } }
  const completed = core.completeModelAdvisory({ projectId: 'p1', runId: requested.advisoryRun.id, fencingToken: 1, expectedCompletionVersion: requested.threadVersion, draft, requestId: 'r1', usage: { total_tokens: 9, secret: 'no' }, elapsedMs: 12, agent })
  assert.equal(completed.advisoryRun.status, 'succeeded'); assert.equal(completed.artifact.advisoryOnly, true); assert.deepEqual(completed.artifact.judgmentClaims[0].citations, [citation]); assert.equal(completed.threadVersion, requested.threadVersion + 1)
  assert.deepEqual(core.snapshot('p1').events.slice(-2).map(event => event.type), ['AdvisoryArtifactCreated', 'AdvisoryRunSucceeded'])
  const before = core.snapshot('p1'); assert.throws(() => core.completeModelAdvisory({ projectId: 'p1', runId: requested.advisoryRun.id, fencingToken: 1, expectedCompletionVersion: completed.threadVersion, draft, agent }), /ADVISORY_RUN_FENCE_CONFLICT/); assert.deepEqual(core.snapshot('p1'), before)
})

test('deterministic advisory skips unclassified Evidence claims', () => {
  const { core, threadId } = setup(); const add = { threadId, title: 'misc', locator: 'p:1', content: 'private', criterionCode: undefined }
  core.addEvidence({ projectId: 'p1', ...add }, env(business, 'addEvidence', 'misc', 1, add)); const pre = core.createPrecheckAttempt({ projectId: 'p1', threadId }, env(business, 'precheck', 'pre', 2, { threadId })); const payload = { threadId, snapshotId: pre.snapshot.id, precheckAttemptId: pre.precheckAttempt.id, instruction: 'x', citations: pre.snapshot.evidence, agentId: agent.id }
  const result = core.invokeDeterministicAdvisory({ projectId: 'p1', ...payload, agent }, env(business, 'invoke', 'det', pre.threadVersion, payload)); assert.deepEqual(result.artifact.judgmentClaims, [])
})

test('model advisory request replay, fencing and failure preserve human decision authority', () => {
  const { core, threadId } = setup(); const add = { threadId, title: 'identity', locator: 'p:1', content: 'private', criterionCode: 'identity' }
  core.addEvidence({ projectId: 'p1', ...add }, env(business, 'addEvidence', 'e', 1, add)); const pre = core.createPrecheckAttempt({ projectId: 'p1', threadId }, env(business, 'precheck', 'p', 2, { threadId })); const citation = pre.snapshot.evidence[0]
  const payload = { threadId, snapshotId: pre.snapshot.id, reviewRoundId: undefined, precheckAttemptId: pre.precheckAttempt.id, provider: 'glm53', promptVersion: 'evidence_first_v1', reasoningEffort: 'low', citations: [citation], agentId: agent.id, runId: 'run-a', attempt: 1, fencingToken: 1 }
  const first = core.requestModelAdvisory({ projectId: 'p1', ...payload, agent }, env(business, 'invoke', 'same-run', pre.threadVersion, payload)); const replay = core.requestModelAdvisory({ projectId: 'p1', ...payload, agent }, env(business, 'invoke', 'same-run', pre.threadVersion, payload)); assert.deepEqual(replay, first)
  assert.throws(() => core.requestModelAdvisory({ projectId: 'p1', ...payload, runId: 'run-b', agent }, env(business, 'invoke', 'same-run', pre.threadVersion, { ...payload, runId: 'run-b' })), /IDEMPOTENCY_CONFLICT/)
  const draft = { modelConfidence: .5, judgmentClaims: [{ criterionCode: 'identity', position: 'support', rationale: 'cited', citationEvidenceIds: [citation.evidenceId] }], evidenceGaps: [{ criterionCode: 'business_reality' }], nextBestEvidence: { criterionCode: 'business_reality' } }
  const before = core.snapshot('p1'); assert.throws(() => core.completeModelAdvisory({ projectId: 'p1', runId: 'run-a', fencingToken: 1, expectedCompletionVersion: first.threadVersion + 1, draft, agent }), /VERSION_CONFLICT/); assert.deepEqual(core.snapshot('p1'), before)
  assert.throws(() => core.failModelAdvisory({ projectId: 'p1', runId: 'run-a', fencingToken: 2, failureCode: 'ADVISORY_UNAVAILABLE', agent }), /ADVISORY_RUN_FENCE_CONFLICT/); assert.deepEqual(core.snapshot('p1'), before)
  assert.throws(() => core.requestModelAdvisory({ projectId: 'p1', ...payload, runId: 'old-version', agent }, env(business, 'invoke', 'old-version', 1, { ...payload, runId: 'old-version' })), /VERSION_CONFLICT/)
  assert.throws(() => core.requestModelAdvisory({ projectId: 'foreign', ...payload, agent }, env(business, 'invoke', 'foreign', first.threadVersion, payload)), /PROJECT_NOT_FOUND/)
  const failed = core.failModelAdvisory({ projectId: 'p1', runId: 'run-a', fencingToken: 1, failureCode: 'ADVISORY_UNAVAILABLE', agent }); assert.equal(failed.advisoryRun.status, 'failed'); assert.equal(core.snapshot('p1').artifacts.length, 0); assert.equal(core.snapshot('p1').decisions.length, 0)
  assert.throws(() => core.requestModelAdvisory({ projectId: 'p1', ...payload, agent }, env(agent, 'invoke', 'agent-request', first.threadVersion, payload)), /HUMAN_AUTHORITY_REQUIRED/)
  assert.throws(() => core.recordRiskDecision({ projectId: 'p1', threadId, reviewRoundId: 'none', snapshotId: 'none', outcome: 'pass', rationale: 'x' }, env(agent, 'decide', 'agent-decision', first.threadVersion, { threadId, reviewRoundId: 'none', snapshotId: 'none', outcome: 'pass', rationale: 'x' })), /HUMAN_AUTHORITY_REQUIRED/)
})
