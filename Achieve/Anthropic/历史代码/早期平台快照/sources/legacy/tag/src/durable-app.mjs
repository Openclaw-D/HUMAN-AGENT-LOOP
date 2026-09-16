import { createHash, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { CoordinationCore } from './coordination-core.mjs'
import { canonicalHash, canonicalize } from './event-log.mjs'
import { projectGraph } from './graph-projector.mjs'

const clone = value => structuredClone(value)
const json = value => JSON.stringify(canonicalize(value))
const parse = value => JSON.parse(value)
const digest = value => createHash('sha256').update(json(value)).digest('hex')
const hashToken = value => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()

/** A small SQLite journal around the frozen deterministic command core. */
export class DurableApp {
  #db; #core = new CoordinationCore(); #listeners = new Set(); #modelAdapter; #modelConnected; #leaseMs; #clock; #tokenFactory

  constructor(path, { advisoryAvailable = true, modelAdapter = null, leaseMs = 30_000, clock = () => Date.now(), tokenFactory = () => randomBytes(32).toString('hex') } = {}) {
    this.#db = new DatabaseSync(path)
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.#migrate()
    this.#verifyEvents()
    this.#rehydrate()
    this.advisoryAvailable = advisoryAvailable
    this.#modelAdapter = modelAdapter
    this.#modelConnected = Boolean(modelAdapter)
    this.#leaseMs = leaseMs; this.#clock = clock; this.#tokenFactory = tokenFactory
  }

  close() { this.#db.close() }
  health() { return { ready: true, schemaVersion: 1, eventSequence: this.#lastSequence() } }

  bootstrapProject(payload, envelope) {
    return this.#execute('createProject', payload.id, payload, envelope, () => this.#core.createProject(payload, envelope))
  }

  command(projectId, command, payload, envelope) {
    if (!COMMANDS.has(command)) throw Object.assign(new Error('COMMAND_NOT_FOUND'), { code: 'COMMAND_NOT_FOUND' })
    if (command === 'requestModelAdvisory') return this.#requestModelAdvisory(projectId, payload, envelope)
    if (command === 'invokeDeterministicAdvisory' && (typeof payload.agentId !== 'string' || !payload.agentId.trim())) throw Object.assign(new Error('AGENT_ID_REQUIRED'), { code: 'AGENT_ID_REQUIRED' })
    if (command === 'invokeDeterministicAdvisory' && !this.advisoryAvailable) throw Object.assign(new Error('ADVISORY_UNAVAILABLE'), { code: 'ADVISORY_UNAVAILABLE' })
    return this.#execute(command, projectId, payload, envelope, () => {
      const args = command === 'invokeDeterministicAdvisory'
        ? { projectId, ...payload, agent: { id: payload.agentId, class: 'agent', projectId } }
        : { projectId, ...payload }
      return this.#core[command](args, envelope)
    })
  }

  async #requestModelAdvisory(projectId, payload, envelope) {
    if (!this.#modelAdapter) throw Object.assign(new Error('ADVISORY_UNAVAILABLE'), { code: 'ADVISORY_UNAVAILABLE' })
    if (typeof payload.agentId !== 'string' || !payload.agentId.trim()) throw Object.assign(new Error('AGENT_ID_REQUIRED'), { code: 'AGENT_ID_REQUIRED' })
    const ownerToken = this.#tokenFactory(); const ownerHash = hashToken(ownerToken); let created = false
    let requested = this.#execute('requestModelAdvisory', projectId, payload, envelope, () => { created = true; return this.#core.requestModelAdvisory({ projectId, ...payload, agent: { id: payload.agentId, class: 'agent', projectId } }, envelope) }, () => { const run = this.#core.snapshot(projectId).advisoryRuns.at(-1); this.#db.prepare('INSERT INTO advisory_run_control(run_id,project_id,request_hash,owner_token_hash,fencing_token,attempt,lease_until,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(run.id, projectId, run.requestHash, ownerHash, run.fencingToken, run.attempt, this.#clock() + this.#leaseMs, 'running', this.#clock()) })
    const run = this.#core.snapshot(projectId).advisoryRuns.find(item => item.id === requested.advisoryRun.id)
    const control = this.#db.prepare('SELECT * FROM advisory_run_control WHERE run_id=?').get(run.id)
    if (!created && run.status !== 'running') return { advisoryRun: run, threadVersion: this.projectVersion(projectId, run.threadId) }
    if (!created && control.lease_until > this.#clock()) return { advisoryRun: run, threadVersion: this.projectVersion(projectId, run.threadId) }
    if (!created) {
      const staleVersion = this.projectVersion(projectId, run.threadId) !== run.expectedCompletionVersion
      const nextToken = this.#tokenFactory(); const nextHash = hashToken(nextToken); let taken = null
      const takeoverPayload = { runId: run.id, attempt: control.attempt + 1, fencingToken: control.fencing_token + 1, agentId: run.agentId }
      const takeoverEnvelope = { actor: { id: run.agentId, class: 'agent', projectId }, idempotencyKey: `model-takeover:${run.id}:${takeoverPayload.fencingToken}`, requestHash: canonicalHash(takeoverPayload) }
      taken = this.#execute('takeoverModelAdvisory', projectId, takeoverPayload, takeoverEnvelope, () => this.#core.takeoverModelAdvisory({ projectId, ...takeoverPayload }), () => this.#db.prepare('UPDATE advisory_run_control SET owner_token_hash=?, fencing_token=?, attempt=?, lease_until=?, updated_at=? WHERE run_id=? AND fencing_token=? AND lease_until<=? AND status=?').run(nextHash, takeoverPayload.fencingToken, takeoverPayload.attempt, this.#clock() + this.#leaseMs, this.#clock(), run.id, control.fencing_token, this.#clock(), 'running'))
      if (!taken) return { advisoryRun: this.#core.snapshot(projectId).advisoryRuns.find(item => item.id === run.id), threadVersion: this.projectVersion(projectId, run.threadId) }
      if (staleVersion) {
        const agent = { id: taken.agentId, class: 'agent', projectId }; const failurePayload = { runId: taken.id, fencingToken: taken.fencingToken, failureCode: 'VERSION_CONFLICT', requestId: null, usage: null, elapsedMs: null, agentId: agent.id }; const failureEnvelope = { actor: agent, idempotencyKey: `model-fail:${taken.id}:${taken.fencingToken}`, requestHash: canonicalHash(failurePayload) }
        return this.#execute('failModelAdvisory', projectId, failurePayload, failureEnvelope, () => { this.#assertOwner(taken, nextToken); return this.#core.failModelAdvisory({ projectId, ...failurePayload, agent }) }, () => this.#db.prepare('UPDATE advisory_run_control SET status=?, updated_at=? WHERE run_id=?').run('failed', this.#clock(), taken.id))
      }
      return this.#invokeRun(projectId, taken, nextToken)
    }
    return this.#invokeRun(projectId, run, ownerToken)
  }

  async #invokeRun(projectId, run, ownerToken) {
    const agent = { id: run.agentId, class: 'agent', projectId }
    try {
      const snapshot = this.#core.snapshot(projectId).snapshots.find(item => item.id === run.snapshotId)
      const result = await this.#modelAdapter.analyze({ promptVersion: run.promptVersion, reasoningEffort: run.reasoningEffort, snapshot, evidence: this.#core.modelContext(projectId, run.threadId, run.snapshotId), citations: run.citations })
      const completionPayload = { runId: run.id, fencingToken: run.fencingToken, expectedCompletionVersion: run.expectedCompletionVersion, draft: result.draft, requestId: result.requestId, usage: result.usage, elapsedMs: result.elapsedMs, agentId: agent.id }
      const completionEnvelope = { actor: agent, idempotencyKey: `model-complete:${run.id}:${run.fencingToken}`, requestHash: canonicalHash(completionPayload) }
      return this.#execute('completeModelAdvisory', projectId, completionPayload, completionEnvelope, () => { this.#assertOwner(run, ownerToken); return this.#core.completeModelAdvisory({ projectId, ...completionPayload, agent }) }, () => this.#db.prepare('UPDATE advisory_run_control SET status=?, updated_at=? WHERE run_id=?').run('succeeded', this.#clock(), run.id))
    } catch (error) {
      if ((error?.code ?? error?.message) === 'ADVISORY_RUN_FENCE_CONFLICT') throw error
      const failurePayload = { runId: run.id, fencingToken: run.fencingToken, failureCode: error?.code ?? (error?.message === 'VERSION_CONFLICT' ? 'VERSION_CONFLICT' : 'ADVISORY_UNAVAILABLE'), requestId: null, usage: null, elapsedMs: null, agentId: agent.id }
      const failureEnvelope = { actor: agent, idempotencyKey: `model-fail:${run.id}:${run.fencingToken}`, requestHash: canonicalHash(failurePayload) }
      try { return this.#execute('failModelAdvisory', projectId, failurePayload, failureEnvelope, () => { this.#assertOwner(run, ownerToken); return this.#core.failModelAdvisory({ projectId, ...failurePayload, agent }) }, () => this.#db.prepare('UPDATE advisory_run_control SET status=?, updated_at=? WHERE run_id=?').run('failed', this.#clock(), run.id)) } catch (failure) { throw failure }
    }
  }

  #assertOwner(run, ownerToken) { const control = this.#db.prepare('SELECT owner_token_hash,fencing_token,status FROM advisory_run_control WHERE run_id=? AND project_id=?').get(run.id, run.projectId); if (!control || control.status !== 'running' || control.fencing_token !== run.fencingToken || control.owner_token_hash !== hashToken(ownerToken)) throw Object.assign(new Error('ADVISORY_RUN_FENCE_CONFLICT'), { code: 'ADVISORY_RUN_FENCE_CONFLICT' }) }

  state(projectId) {
    const state = this.#core.snapshot(projectId)
    state.threads = state.threads.map(thread => ({ ...thread, messages: this.#messages(projectId, thread.id) }))
    return { ...state, projectVersion: state.threads[0]?.version ?? 0, lastEventSequence: this.#lastSequence(projectId) }
  }
  graph(projectId) { return projectGraph(this.state(projectId)) }
  judgment(projectId, threadId) {
    const state = this.state(projectId); if (!state.threads.some(thread => thread.id === threadId)) throw Object.assign(new Error('THREAD_NOT_FOUND'), { code: 'THREAD_NOT_FOUND' })
    const snapshots = state.snapshots.filter(item => item.threadId === threadId); const latest = snapshots.at(-1) ?? null; const attempts = state.precheckAttempts.filter(item => item.threadId === threadId); const round = state.reviewRounds.filter(item => item.threadId === threadId).at(-1) ?? null; const passes = state.reviewPasses.filter(item => item.reviewRoundId === round?.id); const challenges = state.challenges.filter(item => item.reviewRoundId === round?.id); const open = challenges.filter(item => ['open', 'reopened'].includes(item.status)); const answered = challenges.filter(item => item.status === 'answered'); const artifact = state.artifacts.filter(item => item.threadId === threadId && item.snapshotId === latest?.id && item.analysisVersion?.startsWith('glm53-')).at(-1) ?? null; const modelRun = state.advisoryRuns.filter(item => item.threadId === threadId && item.snapshotId === latest?.id).at(-1) ?? null; const decision = state.decisions.filter(item => item.reviewRoundId === round?.id).at(-1) ?? null
    const readiness = latest?.readinessReceipt ?? { outcome: 'manual_review', reasonCodes: ['NO_SNAPSHOT'] }; const missing = latest?.criterionCoverage?.find(item => item.status === 'missing')
    let nextAction
    if (decision) nextAction = { code: 'ENDED', label: '已结束', ownerClass: 'human', reasonCode: decision.outcome, targetId: decision.id }
    else if (open.length) nextAction = { code: 'ANSWER_CHALLENGE', label: '等待补证回答', ownerClass: 'human', command: 'answerChallenge', reasonCode: 'MANDATORY_CHALLENGE_OPEN', targetId: open[0].id }
    else if (answered.length) nextAction = { code: 'RESOLVE_CHALLENGE', label: '等待风控确认补证', ownerClass: 'human', command: 'resolveRiskChallenge', reasonCode: 'CHALLENGE_ANSWERED', targetId: answered[0].id }
    else if (round) nextAction = { code: 'RISK_DECISION', label: '风控查看判断包并作出人类决定', ownerClass: 'human', command: 'recordRiskDecision', reasonCode: artifact ? 'ADVISORY_AVAILABLE' : 'ADVISORY_UNAVAILABLE', targetId: round.id }
    else if (missing && artifact && state.evidence.some(item => item.criterionCode === missing.criterionCode && !latest.evidence.some(ref => ref.evidenceId === item.id))) nextAction = attempts.length >= 3 ? { code: 'SUBMIT_RISK_REVIEW', label: '业务送审／带缺口送人工审查', ownerClass: 'human', command: 'submitForRiskReview', reasonCode: 'PRECHECK_LIMIT_REACHED', targetId: null } : { code: 'CREATE_PRECHECK', label: '创建下一次预审', ownerClass: 'human', command: 'createPrecheckAttempt', reasonCode: 'NEW_EVIDENCE_PENDING', targetId: null }
    else if (missing) nextAction = { code: 'ADD_EVIDENCE', label: '补充首个必需材料', ownerClass: 'human', command: 'addEvidence', reasonCode: `MISSING_${missing.criterionCode.toUpperCase()}`, targetId: missing.criterionCode }
    else if (!latest) nextAction = { code: 'ADD_EVIDENCE', label: '补充首个必需材料', ownerClass: 'human', command: 'addEvidence', reasonCode: 'NO_EVIDENCE', targetId: 'identity' }
    else if (readiness.outcome === 'ready' && !round) nextAction = { code: 'SUBMIT_RISK_REVIEW', label: '业务送审／带缺口送人工审查', ownerClass: 'human', command: 'submitForRiskReview', reasonCode: 'READY_FOR_SUBMISSION', targetId: null }
    else if (attempts.length < 3 && !round) nextAction = { code: 'CREATE_PRECHECK', label: '创建下一次预审', ownerClass: 'human', command: 'createPrecheckAttempt', reasonCode: 'PRECHECK_AVAILABLE', targetId: null }
    else if (!round) nextAction = { code: 'SUBMIT_RISK_REVIEW', label: '业务送审／带缺口送人工审查', ownerClass: 'human', command: 'submitForRiskReview', reasonCode: readiness.outcome, targetId: null }
    else nextAction = { code: 'RISK_DECISION', label: '风控人类作出决定', ownerClass: 'human', command: 'recordRiskDecision', reasonCode: 'HUMAN_AUTHORITY_REQUIRED', targetId: round.id }
    if (!decision && !open.length && !answered.length && this.#modelConnected) {
      if (modelRun?.status === 'running') nextAction = { code: 'WAIT_ADVISORY', label: '模型建议生成中', ownerClass: 'system', reasonCode: 'ADVISORY_RUNNING', targetId: modelRun.id }
      else if (!modelRun && !artifact && latest?.evidence.length) nextAction = { code: 'REQUEST_ADVISORY', label: '请求当前 Snapshot 的模型建议', ownerClass: 'human', command: 'requestModelAdvisory', reasonCode: 'MODEL_CONNECTED', targetId: latest.id }
      else if ((modelRun?.status === 'failed' || modelRun?.status === 'succeeded') && round) nextAction = { code: 'RISK_DECISION', label: '风控查看判断包并作出人类决定', ownerClass: 'human', command: 'recordRiskDecision', reasonCode: modelRun.status === 'failed' ? 'ADVISORY_FAILED' : 'ADVISORY_AVAILABLE', targetId: round.id }
    }
    const snapshotDiffs = snapshots.map((snapshot, index) => { const previous = snapshots[index - 1]; const changes = snapshot.criterionCoverage.filter(item => !previous || previous.criterionCoverage.find(old => old.criterionCode === item.criterionCode)?.status !== item.status).map(item => ({ criterionCode: item.criterionCode, from: previous?.criterionCoverage.find(old => old.criterionCode === item.criterionCode)?.status ?? null, to: item.status })); return { previousSnapshotId: snapshot.previousSnapshotId, snapshotId: snapshot.id, addedEvidenceIds: previous ? snapshot.evidence.filter(ref => !previous.evidence.some(old => old.evidenceId === ref.evidenceId)).map(ref => ref.evidenceId) : snapshot.evidence.map(ref => ref.evidenceId), coverageChanges: changes, challengeChanges: snapshot.challengeState.filter(item => !previous || previous.challengeState.find(old => old.challengeId === item.challengeId)?.status !== item.status).map(item => ({ challengeId: item.challengeId, from: previous?.challengeState.find(old => old.challengeId === item.challengeId)?.status ?? null, to: item.status })), readinessChange: !previous || previous.readinessReceipt.outcome !== snapshot.readinessReceipt.outcome ? { from: previous?.readinessReceipt.outcome ?? null, to: snapshot.readinessReceipt.outcome } : null, artifactChanges: state.artifacts.filter(item => item.snapshotId === snapshot.id).map(item => item.id), decisionChanges: state.decisions.filter(item => item.snapshotId === snapshot.id).map(item => item.id) } })
    const citations = artifact?.citations ?? []; const recommendation = state.artifacts.filter(item => item.threadId === threadId && item.nextBestEvidence).at(-1) ?? null; const recommendationIndex = recommendation ? snapshots.findIndex(snapshot => snapshot.id === recommendation.snapshotId) : -1; const currentEvents = this.events(projectId); const startEvent = currentEvents.find(event => event.aggregateId === round?.id && ['RiskReviewSubmitted', 'RiskDecisionReconsidered'].includes(event.type)); const decisionEvent = currentEvents.find(event => event.type === 'RiskDecisionRecorded' && event.payload?.reviewRoundId === round?.id); const firstSubmit = currentEvents.find(event => event.type === 'RiskReviewSubmitted'); const created = currentEvents.find(event => event.type === 'ProjectCreated'); const duration = (a, b) => a && b ? Date.parse(b) - Date.parse(a) : null; const supplementIds = new Set(snapshotDiffs.slice(1).flatMap(diff => diff.addedEvidenceIds)); const readySequences = new Set(snapshots.filter(snapshot => snapshot.readinessReceipt.outcome === 'ready').map(snapshot => currentEvents.find(event => event.aggregateId === snapshot.id && event.type === 'ContextSnapshotCreated')?.sequence).filter(Boolean)); const metrics = { precheckAttemptCount: attempts.length, formalReviewPassCount: passes.length, challengeCount: challenges.length, supplementCount: supplementIds.size, straightThrough1Plus1: attempts.length === 1 && state.reviewRounds.length === 1 && passes.length === 1 && Boolean(decision) && challenges.length === 0 && supplementIds.size === 0, manualReviewRequired: passes.length >= 2 || readiness.outcome === 'manual_review', falseReadyProxy: currentEvents.some(event => event.type === 'RiskChallengeCommunicated' && event.payload?.mandatory && [...readySequences].some(sequence => sequence < event.sequence)), nextBestEvidenceFollowed: recommendationIndex >= 0 && snapshots.slice(recommendationIndex + 1).some(snapshot => snapshot.criterionCoverage.some(item => item.criterionCode === recommendation.nextBestEvidence.criterionCode && item.status === 'covered')), timeToSubmissionMs: duration(created?.occurredAt, firstSubmit?.occurredAt), formalReviewDurationMs: duration(startEvent?.occurredAt, decisionEvent?.occurredAt), totalDecisionDurationMs: duration(created?.occurredAt, decisionEvent?.occurredAt) }
    const evidenceById = new Map(state.evidence.map(item => [item.id, item])); const disagreements = (latest?.criterionCoverage ?? []).map(item => { const scoped = citations.filter(citation => evidenceById.get(citation.evidenceId)?.criterionCode === item.criterionCode); const modelPosition = scoped.length ? 'support' : (artifact?.evidenceGaps.some(gap => gap.criterionCode === item.criterionCode) ? 'unknown' : 'uncertain'); const humanPosition = decision?.outcome ?? (open.length || answered.length ? 'challenge' : 'not_recorded'); return { criterionCode: item.criterionCode, rulePosition: item.status, modelPosition, humanPosition, status: !artifact ? 'unreviewed' : (item.status === 'covered' && modelPosition === 'support' && ['not_recorded', 'pass'].includes(humanPosition) ? 'aligned' : 'attention_required'), citations: scoped } })
    const modelEvaluation = modelRun ? { status: modelRun.status, connected: this.#modelConnected, provider: modelRun.provider, model: modelRun.model, promptVersion: modelRun.promptVersion, reasoningEffort: modelRun.reasoningEffort, runId: modelRun.id, attempt: modelRun.attempt, usage: modelRun.usage ?? null, elapsedMs: modelRun.elapsedMs ?? null, artifactId: modelRun.artifactId ?? null, failureCode: modelRun.failureCode ?? null, requestIdPresent: Boolean(modelRun.requestIdPresent) } : { status: this.#modelConnected ? 'available' : 'not_connected', connected: this.#modelConnected, provider: null, model: null, promptVersion: null, reasoningEffort: null, runId: null, attempt: null, usage: null, elapsedMs: null, artifactId: null, failureCode: null, requestIdPresent: false }
    return { projectId, threadId, phase: latest?.phase ?? 'precheck', limits: { precheck: { used: attempts.length, max: 3, remaining: Math.max(0, 3 - attempts.length) }, formalReview: { used: passes.length, max: 2, remaining: Math.max(0, 2 - passes.length) } }, readiness, nextAction, snapshotDiffs, reviewPacket: round ? { reviewRound: round, latestReviewPass: passes.at(-1) ?? null, snapshot: latest, recentPrecheck: attempts.at(-1) ?? null, snapshotDiffs, criterionCoverage: latest?.criterionCoverage ?? [], unresolvedChallenges: open.concat(answered), latestArtifact: artifact, nextAction, disagreements, citations, authorityStatement: '仅风险人类可通过／否决', generatedThroughEventSequence: this.#lastSequence(projectId) } : null, disagreements, metrics, modelEvaluation, generatedThroughEventSequence: this.#lastSequence(projectId) }
  }
  projectVersion(projectId, threadId) { return this.state(projectId).threads.find(thread => thread.id === threadId)?.version ?? 0 }
  events(projectId, after = 0) {
    this.#core.snapshot(projectId)
    return this.#db.prepare('SELECT sequence, body FROM events WHERE project_id = ? AND sequence > ? ORDER BY sequence').all(projectId, after).map(row => ({ ...parse(row.body), sequence: row.sequence }))
  }
  eventBounds(projectId) {
    this.#core.snapshot(projectId)
    return this.#db.prepare('SELECT MIN(sequence) AS first, MAX(sequence) AS last FROM events WHERE project_id = ?').get(projectId)
  }
  rebuildProjection(projectId) {
    const projection = this.graph(projectId); const checksum = canonicalHash(projection)
    this.#db.prepare('INSERT INTO projections(project_id, checksum, body, updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET checksum=excluded.checksum, body=excluded.body, updated_at=excluded.updated_at').run(projectId, checksum, json(projection), now())
    return { checksum, projection }
  }
  onEvent(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }

  #migrate() {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, command TEXT NOT NULL, payload TEXT NOT NULL, envelope TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, previous_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, event_sequence INTEGER NOT NULL UNIQUE, project_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(project_id, thread_id, sequence));
      CREATE TABLE IF NOT EXISTS projections(project_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS advisory_run_control(run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_hash TEXT NOT NULL, owner_token_hash TEXT NOT NULL, fencing_token INTEGER NOT NULL, attempt INTEGER NOT NULL, lease_until INTEGER NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL);`)
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
    if (!row) this.#db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version','1')").run()
    else if (row.value !== '1') throw Object.assign(new Error('SCHEMA_VERSION_UNSUPPORTED'), { code: 'SCHEMA_VERSION_UNSUPPORTED' })
  }
  #rehydrate() {
    this.#core = new CoordinationCore()
    for (const row of this.#db.prepare('SELECT project_id, command, payload, envelope FROM commands ORDER BY id').all()) {
      const payload = parse(row.payload); const envelope = parse(row.envelope)
      if (row.command === 'createProject') this.#core.createProject(payload, envelope)
      else if (row.command === 'invokeDeterministicAdvisory' || row.command === 'requestModelAdvisory') this.#core[row.command]({ projectId: row.project_id, ...payload, agent: { id: payload.agentId, class: 'agent', projectId: row.project_id } }, envelope)
      else if (row.command === 'completeModelAdvisory' || row.command === 'failModelAdvisory' || row.command === 'takeoverModelAdvisory') this.#core[row.command]({ projectId: row.project_id, ...payload, agent: { id: payload.agentId, class: 'agent', projectId: row.project_id } })
      else this.#core[row.command]({ projectId: row.project_id, ...payload }, envelope)
    }
  }
  #execute(command, projectId, payload, envelope, operation, persistExtra = null) {
    const expectedHash = canonicalHash(payload)
    if (envelope?.requestHash !== expectedHash) throw Object.assign(new Error('REQUEST_HASH_MISMATCH'), { code: 'REQUEST_HASH_MISMATCH' })
    let committed = false
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      // A second local process may have committed after this instance started.
      // Replaying the durable journal while holding the writer lock makes the DB version authoritative.
      this.#rehydrate()
      const prior = this.#findCommand(projectId, command, envelope?.actor?.id, envelope?.idempotencyKey)
      if (prior) {
        if (prior.requestHash !== expectedHash) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT' })
        this.#db.exec('COMMIT')
        return clone(prior.result)
      }
      const before = this.#core.eventLog.events(projectId).length
      const result = operation()
      const fresh = this.#core.eventLog.events(projectId).slice(before)
      persistExtra?.(); this.#persist(command, projectId, payload, envelope, result, fresh)
      this.#db.exec('COMMIT')
      committed = true
      // Subscribers are observational only; an exception must not negate a committed command.
      for (const event of this.events(projectId, this.#lastSequence(projectId) - fresh.length)) for (const listener of this.#listeners) { try { listener(event) } catch {} }
      return clone(result)
    } catch (error) { if (!committed) { this.#db.exec('ROLLBACK'); this.#rehydrate() }; throw error }
  }
  #persist(command, projectId, payload, envelope, result, events) {
    const requestHash = canonicalHash(payload)
    this.#db.prepare('INSERT INTO commands(project_id,command,payload,envelope,result,created_at) VALUES(?,?,?,?,?,?)').run(projectId, command, json(payload), json(envelope), json(result), now())
    for (const source of events) {
      const previousHash = this.#db.prepare('SELECT hash FROM events ORDER BY sequence DESC LIMIT 1').get()?.hash ?? 'GENESIS'
      const body = { projectId, aggregateId: source.aggregateId, aggregateType: source.aggregateType, type: source.type, actor: source.actor, payload: source.payload, previousHash, occurredAt: now() }
      const hash = digest({ ...body, occurredAt: undefined }); const stored = { ...body, hash }
      const info = this.#db.prepare('INSERT INTO events(project_id,body,hash,previous_hash) VALUES(?,?,?,?)').run(projectId, json(stored), hash, previousHash)
      const sequence = Number(info.lastInsertRowid)
      this.#db.prepare('INSERT INTO outbox(event_sequence,project_id,body,created_at) VALUES(?,?,?,?)').run(sequence, projectId, json(stored), now())
    }
    if (command === 'appendHumanMessage') { const m = result.message; this.#db.prepare('INSERT INTO messages(id,project_id,thread_id,sequence,body) VALUES(?,?,?,?,?)').run(m.id, m.projectId, m.threadId, m.sequence, json(m)) }
  }
  #findCommand(projectId, command, actorId, key) {
    if (!key) throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'), { code: 'IDEMPOTENCY_KEY_REQUIRED' })
    const rows = this.#db.prepare('SELECT payload, envelope, result FROM commands WHERE project_id=? AND command=?').all(projectId, command)
    const row = rows.find(x => parse(x.envelope).actor?.id === actorId && parse(x.envelope).idempotencyKey === key)
    return row && { requestHash: canonicalHash(parse(row.payload)), result: parse(row.result) }
  }
  #messages(projectId, threadId) { return this.#db.prepare('SELECT body FROM messages WHERE project_id=? AND thread_id=? ORDER BY sequence').all(projectId, threadId).map(x => parse(x.body)) }
  #lastSequence(projectId = null) { const row = projectId ? this.#db.prepare('SELECT MAX(sequence) AS n FROM events WHERE project_id=?').get(projectId) : this.#db.prepare('SELECT MAX(sequence) AS n FROM events').get(); return row.n ?? 0 }
  #verifyEvents() { let previous = 'GENESIS'; for (const row of this.#db.prepare('SELECT body, hash, previous_hash FROM events ORDER BY sequence').all()) { const body = parse(row.body); if (row.previous_hash !== previous || body.previousHash !== previous || row.hash !== digest({ ...body, hash: undefined, occurredAt: undefined })) throw Object.assign(new Error('EVENT_LOG_CORRUPT'), { code: 'EVENT_LOG_CORRUPT' }); previous = row.hash } }
}

const COMMANDS = new Set(['appendHumanMessage', 'addEvidence', 'createPrecheckAttempt', 'submitForRiskReview', 'communicateRiskChallenge', 'answerChallenge', 'resolveRiskChallenge', 'invokeDeterministicAdvisory', 'requestModelAdvisory', 'recordRiskDecision', 'reconsiderRiskDecision'])
