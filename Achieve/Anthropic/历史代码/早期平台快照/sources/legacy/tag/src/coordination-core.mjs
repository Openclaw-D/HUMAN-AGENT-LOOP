import { createHash } from 'node:crypto'
import { ActorClass } from './policy.mjs'
import { EventLog, canonicalHash } from './event-log.mjs'

const clone = value => structuredClone(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const publicUsage = usage => usage && typeof usage === 'object' ? Object.fromEntries(Object.entries(usage).filter(([, value]) => typeof value === 'number')) : null

const CRITERIA = Object.freeze({ identity: '主体身份', business_reality: '经营真实性', purpose: '资金用途', repayment: '还款来源' })

export class CoordinationCore {
  #projects = new Map(); #memberships = new Map(); #threads = new Map(); #evidence = new Map(); #evidenceContents = new Map(); #rounds = new Map(); #snapshots = new Map(); #challenges = new Map(); #artifacts = new Map(); #advisoryRuns = new Map(); #decisions = new Map(); #prechecks = new Map(); #passes = new Map()
  constructor(eventLog = new EventLog()) { this.eventLog = eventLog }

  createProject({ id, title, memberships, goal = null }, { actor, idempotencyKey }) {
    return this.eventLog.executeOnce({ projectId: id, actorId: actor?.id, action: 'createProject', key: idempotencyKey, request: { id, title, memberships, goal } }, () => {
      if (actor?.class !== ActorClass.HUMAN) throw new Error('HUMAN_AUTHORITY_REQUIRED')
      if (this.#projects.has(id)) throw new Error('PROJECT_NOT_FOUND')
      const project = Object.freeze({ id, title, version: 1, goal, reviewProfile: { profileVersion: 'p0-finance-v1', criteria: Object.entries(CRITERIA).map(([criterionCode, label]) => ({ criterionCode, label, required: true })) } }); const thread = { id: `thread-${id}`, projectId: id, title, version: 1, status: 'active', messages: [] }
      this.#projects.set(id, project); this.#threads.set(thread.id, thread)
      for (const m of memberships) this.#memberships.set(`${id}:${m.principalId}`, Object.freeze({ ...m, projectId: id, status: 'active' }))
      this.#event(id, id, 'Project', 'ProjectCreated', actor, { threadId: thread.id }); return { project, thread: clone(thread) }
    })
  }

  addEvidence({ projectId, threadId, title, locator, content, criterionCode = undefined }, e) {
    return this.#command('addEvidence', projectId, e, { threadId, title, locator, content, criterionCode }, 'addEvidence', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion)
      const code = criterionCode ?? 'unclassified'; if (code !== 'unclassified' && !CRITERIA[code]) throw new Error('EVIDENCE_CRITERION_INVALID')
      const x = Object.freeze({ id: `evidence-${this.#evidence.size + 1}`, projectId, title, locator, contentHash: hash(content), status: 'pending', criterionCode: code })
      this.#evidence.set(x.id, x); this.#evidenceContents.set(x.id, content); t.version++; this.#event(projectId, x.id, 'Evidence', 'EvidenceAdded', e.actor, { threadId, locator, contentHash: x.contentHash }); return clone(x)
    })
  }

  createPrecheckAttempt({ projectId, threadId }, e) {
    return this.#command('createPrecheckAttempt', projectId, e, { threadId }, 'precheck', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const attempts = this.#prechecksFor(projectId, threadId)
      if ([...this.#rounds.values()].some(round => round.projectId === projectId && round.threadId === threadId)) throw new Error('STATE_TRANSITION_INVALID')
      if (attempts.length >= 3) throw new Error('PRECHECK_ATTEMPT_LIMIT_REACHED')
      const attempt = { id: `precheck-${this.#prechecks.size + 1}`, projectId, threadId, number: attempts.length + 1, snapshotId: null, profileVersion: 'p0-finance-v1', createdBy: e.actor.id, creationEventSequence: this.eventLog.events(projectId).length + 1 }
      const snapshot = this.#newSnapshot({ projectId, threadId, challengeIds: [] }, t, { phase: 'precheck', precheckAttemptId: attempt.id })
      attempt.snapshotId = snapshot.id; this.#prechecks.set(attempt.id, Object.freeze(attempt)); t.version++
      this.#event(projectId, attempt.id, 'PrecheckAttempt', 'PrecheckAttemptCreated', e.actor, { threadId, snapshotId: snapshot.id, number: attempt.number }); this.#snapshotEvent(snapshot, e.actor); return { precheckAttempt: clone(attempt), snapshot: clone(snapshot), threadVersion: t.version }
    })
  }

  appendHumanMessage({ projectId, threadId, content, replyToMessageId = null, citations = [] }, e) {
    return this.#command('appendHumanMessage', projectId, e, { threadId, content, replyToMessageId, citations }, 'message', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion)
      if (replyToMessageId && !t.messages.some(message => message.id === replyToMessageId)) throw new Error('STATE_TRANSITION_INVALID')
      const evidence = [...this.#evidence.values()].filter(item => item.projectId === projectId)
      const refs = new Map(evidence.map(item => [item.id, item]))
      for (const citation of citations) { const item = refs.get(citation.evidenceId); if (!item || item.locator !== citation.locator || item.contentHash !== citation.contentHash) throw new Error('CITATION_INVALID') }
      const message = Object.freeze({ id: `message-${t.messages.length + 1}`, projectId, threadId, sequence: t.messages.length + 1, authorId: e.actor.id, content, replyToMessageId, citations: clone(citations), advisoryOnly: false })
      t.messages.push(message); t.version++; this.#event(projectId, message.id, 'Message', 'HumanMessageAppended', e.actor, { threadId, sequence: message.sequence })
      return { message: clone(message), threadVersion: t.version }
    })
  }

  submitForRiskReview({ projectId, threadId }, e) {
    return this.#command('submitForRiskReview', projectId, e, { threadId }, 'submit', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion)
      const r = { id: `review-${this.#rounds.size + 1}`, projectId, threadId, number: this.#roundNumber(projectId, threadId), status: 'submitted', submittedBy: e.actor.id, snapshotId: null, challengeIds: [], decisionId: null }
      const s = this.#newSnapshot(r, t, { phase: 'formal_review' }); r.snapshotId = s.id; this.#rounds.set(r.id, r); const pass = this.#newPass(r, s, 'initial_submission'); t.version++
      const storedSnapshot = this.#snapshots.get(s.id); this.#event(projectId, r.id, 'ReviewRound', 'RiskReviewSubmitted', e.actor, { threadId, snapshotId: s.id, number: r.number }); this.#snapshotEvent(storedSnapshot, e.actor); this.#passEvent(pass, e.actor); return { reviewRound: clone(r), snapshot: clone(storedSnapshot), reviewPass: clone(pass), threadVersion: t.version }
    })
  }

  communicateRiskChallenge({ projectId, threadId, reviewRoundId, prompt, mandatory = true, challengeId = null }, e) {
    return this.#command('communicateRiskChallenge', projectId, e, { threadId, reviewRoundId, prompt, mandatory, challengeId }, 'communicate', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const r = this.#round(projectId, reviewRoundId, threadId); this.#writable(r)
      if (this.#passesFor(r.id).length >= 2) throw new Error('FORMAL_REVIEW_PASS_LIMIT_REACHED')
      let c
      if (challengeId) { const old = this.#challenge(projectId, challengeId, r.id); if (!['resolved', 'answered'].includes(old.status)) throw new Error('STATE_TRANSITION_INVALID'); c = Object.freeze({ ...old, status: 'reopened', prompt, mandatory, creator: e.actor.id }); this.#challenges.set(c.id, c) }
      else { c = Object.freeze({ id: `challenge-${this.#challenges.size + 1}`, projectId, reviewRoundId: r.id, snapshotId: r.snapshotId, status: 'open', creator: e.actor.id, prompt, mandatory, answerEvidenceIds: [], answerMessageRefs: [] }); this.#challenges.set(c.id, c); r.challengeIds.push(c.id) }
      r.status = 'needs_input'; t.version++; this.#event(projectId, c.id, 'Challenge', 'RiskChallengeCommunicated', e.actor, { reviewRoundId: r.id, status: c.status, mandatory }); return { challenge: clone(c), reviewRound: clone(r), threadVersion: t.version }
    })
  }

  answerChallenge({ projectId, threadId, reviewRoundId, challengeId, answer, evidence = [], messageRefs = [], criterionCode = undefined }, e) {
    return this.#command('answerChallenge', projectId, e, { threadId, reviewRoundId, challengeId, answer, evidence, messageRefs, criterionCode }, 'answer', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const r = this.#round(projectId, reviewRoundId, threadId); this.#writable(r); const old = this.#challenge(projectId, challengeId, r.id)
      if (!['open', 'reopened'].includes(old.status)) throw new Error('STATE_TRANSITION_INVALID')
      if (this.#passesFor(r.id).length >= 2) throw new Error('FORMAL_REVIEW_PASS_LIMIT_REACHED')
      const added = evidence.map(item => { const code = item.criterionCode ?? criterionCode ?? 'unclassified'; if (code !== 'unclassified' && !CRITERIA[code]) throw new Error('EVIDENCE_CRITERION_INVALID'); const x = Object.freeze({ id: `evidence-${this.#evidence.size + 1}`, projectId, title: item.title, locator: item.locator, contentHash: hash(item.content), status: 'pending', criterionCode: code }); this.#evidence.set(x.id, x); this.#evidenceContents.set(x.id, item.content); return x })
      const c = Object.freeze({ ...old, status: 'answered', answer, answerEvidenceIds: added.map(x => x.id), answerMessageRefs: clone(messageRefs) }); this.#challenges.set(c.id, c)
      const s = this.#newSnapshot(r, t, { phase: 'formal_review' }); r.snapshotId = s.id; r.status = 'under_review'; const pass = this.#newPass(r, s, 'challenge_answer'); t.version++; this.#event(projectId, c.id, 'Challenge', 'RiskChallengeAnswered', e.actor, { reviewRoundId: r.id, evidenceIds: c.answerEvidenceIds, messageRefs }); const storedSnapshot = this.#snapshots.get(s.id); this.#snapshotEvent(storedSnapshot, e.actor); this.#passEvent(pass, e.actor); return { challenge: clone(c), snapshot: clone(storedSnapshot), reviewRound: clone(r), reviewPass: clone(pass), threadVersion: t.version }
    })
  }

  resolveRiskChallenge({ projectId, threadId, reviewRoundId, challengeId }, e) {
    return this.#command('resolveRiskChallenge', projectId, e, { threadId, reviewRoundId, challengeId }, 'resolve', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const r = this.#round(projectId, reviewRoundId, threadId); this.#writable(r); const old = this.#challenge(projectId, challengeId, r.id)
      if (!['answered', 'open', 'reopened'].includes(old.status)) throw new Error('STATE_TRANSITION_INVALID'); const c = Object.freeze({ ...old, status: 'resolved' }); this.#challenges.set(c.id, c); r.status = this.#openMandatory(r).length ? 'needs_input' : 'under_review'; t.version++; this.#event(projectId, c.id, 'Challenge', 'RiskChallengeResolved', e.actor, { reviewRoundId: r.id }); return { challenge: clone(c), reviewRound: clone(r), threadVersion: t.version }
    })
  }

  invokeDeterministicAdvisory({ projectId, threadId, reviewRoundId = undefined, precheckAttemptId = undefined, snapshotId, instruction, citations, agent }, e) {
    return this.#command('invokeDeterministicAdvisory', projectId, e, { threadId, reviewRoundId, precheckAttemptId, snapshotId, instruction, citations, agentId: agent?.id }, 'invoke', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const s = this.#snapshotAny(projectId, snapshotId, threadId)
      if ((s.phase === 'formal_review' && (!reviewRoundId || s.reviewRoundId !== reviewRoundId)) || (s.phase === 'precheck' && (!precheckAttemptId || s.precheckAttemptId !== precheckAttemptId))) throw new Error('SNAPSHOT_PHASE_INVALID')
      if (agent?.class !== ActorClass.AGENT || agent.projectId !== projectId) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED'); this.#citations(projectId, s, citations)
      const missing = s.criterionCoverage.find(item => item.status === 'missing'); const claims = citations.filter(citation => CRITERIA[this.#evidence.get(citation.evidenceId).criterionCode]).map(citation => ({ criterionCode: this.#evidence.get(citation.evidenceId).criterionCode, position: 'support', rationale: `已引用 ${citation.evidenceId}`, citations: [clone(citation)] })); const a = Object.freeze({ id: `artifact-${this.#artifacts.size + 1}`, projectId, threadId, reviewRoundId, precheckAttemptId, snapshotId, phase: s.phase, profileVersion: s.profileVersion, analysisVersion: 'deterministic-p0-2f-v1', advisoryOnly: true, citations: clone(citations), modelConfidence: 0.72, judgmentClaims: claims, evidenceGaps: s.criterionCoverage.filter(item => item.status === 'missing').map(item => ({ criterionCode: item.criterionCode, status: 'unknown' })), nextBestEvidence: missing ? { criterionCode: missing.criterionCode, label: missing.label, note: '仅改善解释覆盖，不保证通过' } : null }); this.#artifacts.set(a.id, a); t.version++; this.#event(projectId, a.id, 'Artifact', 'AdvisoryArtifactCreated', agent, { threadId, reviewRoundId, snapshotId, phase: s.phase, analysisVersion: a.analysisVersion, recommendedCriterionCode: missing?.criterionCode ?? null, citationEvidenceIds: citations.map(x => x.evidenceId) }); return { artifact: clone(a), threadVersion: t.version }
    })
  }

  modelContext(projectId, threadId, snapshotId) {
    const snapshot = this.#snapshotAny(projectId, snapshotId, threadId)
    return snapshot.evidence.map(ref => {
      const evidence = this.#evidence.get(ref.evidenceId)
      if (!evidence || !this.#evidenceContents.has(ref.evidenceId)) throw new Error('SNAPSHOT_NOT_FOUND')
      return { id: evidence.id, title: evidence.title, criterionCode: evidence.criterionCode, locator: evidence.locator, content: this.#evidenceContents.get(evidence.id) }
    })
  }

  requestModelAdvisory({ projectId, threadId, snapshotId, reviewRoundId = undefined, precheckAttemptId = undefined, provider, promptVersion, reasoningEffort, citations, agent, runId = undefined, attempt = undefined, fencingToken = undefined }, e) {
    const actualAttempt = attempt ?? 1; const actualFencingToken = fencingToken ?? 1; const payload = { threadId, snapshotId, ...(reviewRoundId === undefined ? {} : { reviewRoundId }), ...(precheckAttemptId === undefined ? {} : { precheckAttemptId }), provider, promptVersion, reasoningEffort, citations, agentId: agent?.id, ...(runId === undefined ? {} : { runId }), ...(attempt === undefined ? {} : { attempt }), ...(fencingToken === undefined ? {} : { fencingToken }) }
    return this.#command('requestModelAdvisory', projectId, e, payload, 'invoke', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const s = this.#snapshotAny(projectId, snapshotId, threadId)
      if ((s.phase === 'formal_review' && (!reviewRoundId || s.reviewRoundId !== reviewRoundId || precheckAttemptId !== undefined)) || (s.phase === 'precheck' && (!precheckAttemptId || s.precheckAttemptId !== precheckAttemptId || reviewRoundId !== undefined))) throw new Error('SNAPSHOT_PHASE_INVALID')
      if (provider !== 'glm53' || !['evidence_first_v1', 'disagreement_first_v1'].includes(promptVersion) || !['low', 'high'].includes(reasoningEffort) || !Number.isInteger(actualAttempt) || actualAttempt < 1 || !Number.isInteger(actualFencingToken) || actualFencingToken < 1) throw new Error('STATE_TRANSITION_INVALID')
      if (agent?.class !== ActorClass.AGENT || agent.projectId !== projectId || !agent.id) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED')
      this.#citations(projectId, s, citations)
      const id = runId ?? `advisory-run-${this.#advisoryRuns.size + 1}`; if (this.#advisoryRuns.has(id)) throw new Error('STATE_TRANSITION_INVALID')
      t.version++
      const requestHash = canonicalHash({ threadId, snapshotId, reviewRoundId: reviewRoundId ?? null, precheckAttemptId: precheckAttemptId ?? null, provider, promptVersion, reasoningEffort, citations, agentId: agent.id })
      const run = Object.freeze({ id, projectId, threadId, snapshotId, reviewRoundId: reviewRoundId ?? null, precheckAttemptId: precheckAttemptId ?? null, phase: s.phase, provider, model: 'glm-5.3', promptVersion, reasoningEffort, agentId: agent.id, citations: clone(citations), requestHash, attempt: actualAttempt, fencingToken: actualFencingToken, expectedCompletionVersion: t.version, status: 'running' })
      this.#advisoryRuns.set(id, run); this.#event(projectId, id, 'AdvisoryRun', 'AdvisoryRunRequested', e.actor, { threadId, snapshotId, reviewRoundId: run.reviewRoundId, precheckAttemptId: run.precheckAttemptId, provider, promptVersion, reasoningEffort, attempt: actualAttempt, fencingToken: actualFencingToken }); return { advisoryRun: clone(run), threadVersion: t.version }
    })
  }

  takeoverModelAdvisory({ projectId, runId, attempt, fencingToken }) {
    const run = this.#advisoryRun(projectId, runId); const thread = this.#thread(projectId, run.threadId)
    if (run.status !== 'running') throw new Error('ADVISORY_RUN_FENCE_CONFLICT')
    if (!Number.isInteger(attempt) || !Number.isInteger(fencingToken) || attempt !== run.attempt + 1 || fencingToken !== run.fencingToken + 1) throw new Error('ADVISORY_RUN_FENCE_CONFLICT')
    const next = Object.freeze({ ...run, attempt, fencingToken, expectedCompletionVersion: thread.version }); this.#advisoryRuns.set(runId, next)
    this.#event(projectId, runId, 'AdvisoryRun', 'AdvisoryRunRequested', { id: run.agentId, class: ActorClass.AGENT, projectId }, { threadId: run.threadId, snapshotId: run.snapshotId, reviewRoundId: run.reviewRoundId, precheckAttemptId: run.precheckAttemptId, provider: run.provider, promptVersion: run.promptVersion, reasoningEffort: run.reasoningEffort, attempt, fencingToken }); return clone(next)
  }

  completeModelAdvisory({ projectId, runId, fencingToken, expectedCompletionVersion, draft, requestId = null, usage = null, elapsedMs = null, agent }) {
    const run = this.#advisoryRun(projectId, runId); const t = this.#thread(projectId, run.threadId)
    if (run.status !== 'running' || run.fencingToken !== fencingToken) throw new Error('ADVISORY_RUN_FENCE_CONFLICT')
    if (t.version !== expectedCompletionVersion || run.expectedCompletionVersion !== expectedCompletionVersion) throw new Error('VERSION_CONFLICT')
    const s = this.#snapshotAny(projectId, run.snapshotId, run.threadId)
    if (s.phase !== run.phase || (s.phase === 'formal_review' ? s.reviewRoundId !== run.reviewRoundId : s.precheckAttemptId !== run.precheckAttemptId)) throw new Error('VERSION_CONFLICT')
    if (agent?.class !== ActorClass.AGENT || agent.projectId !== projectId || agent.id !== run.agentId) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED')
    const artifact = this.#artifactFromDraft({ projectId, run, snapshot: s, draft, agent }); const requestIdPresent = Boolean(requestId); const requestIdHash = requestIdPresent ? hash(requestId) : null; const succeeded = Object.freeze({ ...run, status: 'succeeded', requestIdPresent, requestIdHash, usage: publicUsage(usage), elapsedMs, artifactId: artifact.id })
    this.#artifacts.set(artifact.id, artifact); this.#advisoryRuns.set(run.id, succeeded); t.version++; this.#event(projectId, artifact.id, 'Artifact', 'AdvisoryArtifactCreated', agent, { threadId: run.threadId, reviewRoundId: run.reviewRoundId, snapshotId: run.snapshotId, phase: run.phase, analysisVersion: artifact.analysisVersion, recommendedCriterionCode: artifact.nextBestEvidence?.criterionCode ?? null, citationEvidenceIds: run.citations.map(x => x.evidenceId) }); this.#event(projectId, run.id, 'AdvisoryRun', 'AdvisoryRunSucceeded', agent, { artifactId: artifact.id, requestIdPresent, requestIdHash, elapsedMs }); return { artifact: clone(artifact), advisoryRun: clone(succeeded), threadVersion: t.version }
  }

  failModelAdvisory({ projectId, runId, fencingToken, failureCode, requestId = null, usage = null, elapsedMs = null, agent }) {
    const run = this.#advisoryRun(projectId, runId)
    if (run.status !== 'running' || run.fencingToken !== fencingToken) throw new Error('ADVISORY_RUN_FENCE_CONFLICT')
    if (agent?.class !== ActorClass.AGENT || agent.projectId !== projectId || agent.id !== run.agentId) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED')
    const requestIdPresent = Boolean(requestId); const requestIdHash = requestIdPresent ? hash(requestId) : null; const failed = Object.freeze({ ...run, status: 'failed', failureCode, requestIdPresent, requestIdHash, usage: publicUsage(usage), elapsedMs }); this.#advisoryRuns.set(run.id, failed); this.#event(projectId, run.id, 'AdvisoryRun', 'AdvisoryRunFailed', agent, { failureCode, requestIdPresent, requestIdHash, elapsedMs }); return { advisoryRun: clone(failed) }
  }

  recordRiskDecision({ projectId, threadId, reviewRoundId, snapshotId, outcome, rationale }, e) {
    return this.#command('recordRiskDecision', projectId, e, { threadId, reviewRoundId, snapshotId, outcome, rationale }, 'decide', () => {
      if (!['pass', 'veto'].includes(outcome)) throw new Error('DECISION_OUTCOME_INVALID'); const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const r = this.#round(projectId, reviewRoundId, threadId); this.#writable(r); this.#snapshot(projectId, snapshotId, r.id); if (r.snapshotId !== snapshotId) throw new Error('STATE_TRANSITION_INVALID'); if (this.#openMandatory(r).length) throw new Error('STATE_TRANSITION_INVALID')
      const prior = [...this.#decisions.values()].filter(x => x.projectId === projectId && x.threadId === threadId).at(-1); const d = Object.freeze({ id: `decision-${this.#decisions.size + 1}`, projectId, threadId, reviewRoundId, snapshotId, principalId: e.actor.id, outcome, rationale, threadVersion: t.version, revision: (prior?.revision ?? 0) + 1, supersedesDecisionId: prior?.id ?? null }); this.#decisions.set(d.id, d); r.decisionId = d.id; r.status = 'decided'; t.version++; this.#event(projectId, d.id, 'Decision', 'RiskDecisionRecorded', e.actor, { reviewRoundId, snapshotId, outcome, revision: d.revision }); return clone(d)
    })
  }

  reconsiderRiskDecision({ projectId, threadId, decisionId }, e) {
    return this.#command('reconsiderRiskDecision', projectId, e, { threadId, decisionId }, 'reconsider', () => {
      const t = this.#thread(projectId, threadId); this.#version(t, e.expectedVersion); const old = this.#decision(projectId, decisionId, threadId); const r = { id: `review-${this.#rounds.size + 1}`, projectId, threadId, number: this.#roundNumber(projectId, threadId), status: 'under_review', submittedBy: e.actor.id, snapshotId: null, challengeIds: [], decisionId: null, supersedesDecisionId: old.id }; const s = this.#newSnapshot(r, t, { phase: 'formal_review' }); r.snapshotId = s.id; this.#rounds.set(r.id, r); const pass = this.#newPass(r, s, 'reconsideration'); const storedSnapshot = this.#snapshots.get(s.id); t.version++; this.#event(projectId, r.id, 'ReviewRound', 'RiskDecisionReconsidered', e.actor, { priorDecisionId: old.id, snapshotId: s.id, number: r.number }); this.#snapshotEvent(storedSnapshot, e.actor); this.#passEvent(pass, e.actor); return { reviewRound: clone(r), snapshot: clone(storedSnapshot), reviewPass: clone(pass), priorDecisionId: old.id, threadVersion: t.version }
    })
  }

  snapshot(projectId) { this.#project(projectId); const pick = m => [...m.values()].filter(x => x.projectId === projectId); return clone({ project: this.#projects.get(projectId), threads: pick(this.#threads), evidence: pick(this.#evidence), reviewRounds: pick(this.#rounds), precheckAttempts: pick(this.#prechecks), reviewPasses: pick(this.#passes), snapshots: pick(this.#snapshots), challenges: pick(this.#challenges), artifacts: pick(this.#artifacts), advisoryRuns: pick(this.#advisoryRuns), decisions: pick(this.#decisions), events: this.eventLog.events(projectId) }) }
  #command(command, projectId, e, payload, cap, fn) { if (e?.requestHash !== canonicalHash(payload)) throw new Error('REQUEST_HASH_MISMATCH'); return this.eventLog.executeOnce({ projectId, actorId: e?.actor?.id, action: command, key: e?.idempotencyKey, request: payload }, () => { this.#project(projectId); this.#auth(e?.actor, projectId, cap, e?.capability); return fn() }) }
  #auth(actor, p, cap, declared) { if (actor?.class !== ActorClass.HUMAN) throw new Error('HUMAN_AUTHORITY_REQUIRED'); const m = this.#memberships.get(`${p}:${actor.id}`); if (!m || m.status !== 'active') throw new Error('ACTIVE_MEMBERSHIP_REQUIRED'); if (declared !== cap || !m.capabilities.includes(cap)) throw new Error('CAPABILITY_REQUIRED') }
  #project(p) { const x = this.#projects.get(p); if (!x) throw new Error('PROJECT_NOT_FOUND'); return x }; #thread(p, id) { const x = this.#threads.get(id); if (!x || x.projectId !== p) throw new Error('THREAD_NOT_FOUND'); return x }; #round(p, id, t) { const x = this.#rounds.get(id); if (!x || x.projectId !== p || x.threadId !== t) throw new Error('REVIEW_ROUND_NOT_FOUND'); return x }; #snapshot(p, id, r) { const x = this.#snapshots.get(id); if (!x || x.projectId !== p || x.reviewRoundId !== r) throw new Error('SNAPSHOT_NOT_FOUND'); return x }; #snapshotAny(p, id, t) { const x = this.#snapshots.get(id); if (!x || x.projectId !== p || x.threadId !== t) throw new Error('SNAPSHOT_NOT_FOUND'); return x }; #challenge(p, id, r) { const x = this.#challenges.get(id); if (!x || x.projectId !== p || x.reviewRoundId !== r) throw new Error('CHALLENGE_NOT_FOUND'); return x }; #decision(p, id, t) { const x = this.#decisions.get(id); if (!x || x.projectId !== p || x.threadId !== t) throw new Error('REVIEW_ROUND_NOT_FOUND'); return x }; #advisoryRun(p, id) { const x = this.#advisoryRuns.get(id); if (!x || x.projectId !== p) throw new Error('ADVISORY_RUN_NOT_FOUND'); return x }
  #version(t, n) { if (t.version !== n) throw new Error('VERSION_CONFLICT') }; #writable(r) { if (r.status === 'decided') throw new Error('STATE_TRANSITION_INVALID') }; #roundNumber(p, t) { return [...this.#rounds.values()].filter(x => x.projectId === p && x.threadId === t).length + 1 }; #openMandatory(r) { return r.challengeIds.map(id => this.#challenges.get(id)).filter(x => x.mandatory && ['open', 'reopened'].includes(x.status)) }; #prechecksFor(p, t) { return [...this.#prechecks.values()].filter(x => x.projectId === p && x.threadId === t) }; #passesFor(roundId) { return [...this.#passes.values()].filter(x => x.reviewRoundId === roundId) }
  #newSnapshot(r, t, { phase, precheckAttemptId = null, reviewPassId = null }) { const previousSnapshotId = [...this.#snapshots.values()].filter(x => x.projectId === r.projectId && x.threadId === r.threadId).at(-1)?.id ?? null; const evidence = [...this.#evidence.values()].filter(x => x.projectId === r.projectId).map(x => ({ evidenceId: x.id, locator: x.locator, contentHash: x.contentHash })); const challengeState = (r.challengeIds ?? []).map(id => { const x = this.#challenges.get(id); return { challengeId: x.id, status: x.status, mandatory: x.mandatory } }); const coverage = Object.entries(CRITERIA).map(([criterionCode, label]) => { const evidenceIds = [...this.#evidence.values()].filter(x => x.projectId === r.projectId && x.criterionCode === criterionCode).map(x => x.id); return { criterionCode, label, required: true, status: evidenceIds.length ? 'covered' : 'missing', evidenceIds } }); const missing = coverage.filter(x => x.status === 'missing'); const s = Object.freeze({ id: `snapshot-${this.#snapshots.size + 1}`, projectId: r.projectId, threadId: r.threadId, reviewRoundId: phase === 'formal_review' ? r.id : null, threadVersion: t.version, phase, previousSnapshotId, precheckAttemptId, reviewPassId, profileVersion: 'p0-finance-v1', evidence, challengeState, criterionCoverage: coverage, readinessReceipt: { outcome: missing.length ? 'needs_input' : 'ready', reasonCodes: missing.map(x => `MISSING_${x.criterionCode.toUpperCase()}`) }, evidenceConfidence: Math.min(1, evidence.length * .25), creationEventSequence: this.eventLog.events(r.projectId).length + 2 }); this.#snapshots.set(s.id, s); return s }
  #newPass(r, snapshot, trigger) { const pass = Object.freeze({ id: `review-pass-${this.#passes.size + 1}`, projectId: r.projectId, threadId: r.threadId, reviewRoundId: r.id, number: this.#passesFor(r.id).length + 1, snapshotId: snapshot.id, trigger, creationEventSequence: this.eventLog.events(r.projectId).length + 3 }); this.#passes.set(pass.id, pass); const stored = Object.freeze({ ...snapshot, reviewPassId: pass.id }); this.#snapshots.set(stored.id, stored); return pass }
  #artifactFromDraft({ projectId, run, snapshot, draft, agent }) { if (!draft || typeof draft !== 'object' || !Array.isArray(draft.judgmentClaims) || !Array.isArray(draft.evidenceGaps) || typeof draft.modelConfidence !== 'number' || draft.modelConfidence < 0 || draft.modelConfidence > 1) throw new Error('ADVISORY_INVALID_OUTPUT'); const refs = new Map(run.citations.map(c => [c.evidenceId, c])); const claims = draft.judgmentClaims.map(claim => { if (!CRITERIA[claim.criterionCode] || !['support', 'uncertain', 'unknown'].includes(claim.position) || typeof claim.rationale !== 'string' || !Array.isArray(claim.citationEvidenceIds) || (['support', 'uncertain'].includes(claim.position) && !claim.citationEvidenceIds.length)) throw new Error('ADVISORY_INVALID_OUTPUT'); const citations = claim.citationEvidenceIds.map(id => refs.get(id)); if (citations.some(x => !x)) throw new Error('ADVISORY_INVALID_OUTPUT'); return { criterionCode: claim.criterionCode, position: claim.position, rationale: claim.rationale, citations: clone(citations) } }); const missing = snapshot.criterionCoverage.filter(item => item.required && item.status === 'missing'); const gaps = draft.evidenceGaps.map(gap => { if (!missing.some(item => item.criterionCode === gap.criterionCode)) throw new Error('ADVISORY_INVALID_OUTPUT'); return { criterionCode: gap.criterionCode, status: 'unknown' } }); if (draft.nextBestEvidence !== null && (!missing[0] || draft.nextBestEvidence?.criterionCode !== missing[0].criterionCode)) throw new Error('ADVISORY_INVALID_OUTPUT'); return Object.freeze({ id: `artifact-${this.#artifacts.size + 1}`, projectId, threadId: run.threadId, reviewRoundId: run.reviewRoundId, precheckAttemptId: run.precheckAttemptId, snapshotId: run.snapshotId, phase: run.phase, profileVersion: snapshot.profileVersion, analysisVersion: `glm53-${run.promptVersion}-${run.reasoningEffort}`, advisoryOnly: true, citations: clone(run.citations), modelConfidence: draft.modelConfidence, judgmentClaims: claims, evidenceGaps: gaps, nextBestEvidence: draft.nextBestEvidence === null ? null : { criterionCode: missing[0].criterionCode, label: missing[0].label, note: '仅改善解释覆盖，不保证通过' } }) }
  #snapshotEvent(s, actor) { this.#event(s.projectId, s.id, 'ContextSnapshot', 'ContextSnapshotCreated', actor, { reviewRoundId: s.reviewRoundId, phase: s.phase, precheckAttemptId: s.precheckAttemptId, reviewPassId: s.reviewPassId, previousSnapshotId: s.previousSnapshotId, sourceThreadVersion: s.threadVersion }) }; #passEvent(p, actor) { this.#event(p.projectId, p.id, 'ReviewPass', 'ReviewPassCreated', actor, { reviewRoundId: p.reviewRoundId, snapshotId: p.snapshotId, number: p.number, trigger: p.trigger }) }; #citations(p, s, citations) { if (!Array.isArray(citations) || !citations.length) throw new Error('CITATION_INVALID'); const refs = new Map(s.evidence.map(x => [x.evidenceId, x])); for (const c of citations) { const x = refs.get(c.evidenceId); if (!x || c.locator !== x.locator || c.contentHash !== x.contentHash) throw new Error('CITATION_INVALID') } }; #event(...args) { return this.eventLog.append({ projectId: args[0], aggregateId: args[1], aggregateType: args[2], type: args[3], actor: args[4], payload: args[5] }) }
}
