import { canonicalHash } from './event-log.mjs'

const clone = value => structuredClone(value)

export class RunRegistry {
  #runs = new Map()
  #keys = new Map()
  #clock

  constructor(clock = () => Date.now()) {
    this.#clock = clock
  }

  reserve({ projectId, idempotencyKey, request, providerId, leaseMs = 30_000 }) {
    if (!projectId || !idempotencyKey) throw new Error('RUN_SCOPE_REQUIRED')
    const key = `${projectId}:${idempotencyKey}`
    const requestFingerprint = canonicalHash(request)
    const existingId = this.#keys.get(key)
    if (existingId) {
      const existing = this.#runs.get(existingId)
      if (existing.requestFingerprint !== requestFingerprint) throw new Error('IDEMPOTENCY_CONFLICT')
      if (existing.status === 'succeeded' || existing.status === 'needs_review') return { action: 'replay', run: this.#public(existing) }
      if (existing.status === 'failed') return { action: 'failure', run: this.#public(existing) }
      if (existing.leaseUntil <= this.#clock()) {
        existing.attemptCount += 1
        existing.ownerToken = `owner-${existing.id}-${existing.attemptCount}`
        existing.fencingToken = existing.attemptCount
        existing.leaseUntil = this.#clock() + leaseMs
        return { action: 'owner', ownerToken: existing.ownerToken, fencingToken: existing.fencingToken, run: this.#public(existing) }
      }
      return { action: 'wait', run: this.#public(existing) }
    }

    const id = `run-${this.#runs.size + 1}`
    const run = {
      id,
      projectId,
      providerId,
      requestFingerprint,
      status: 'running',
      leaseUntil: this.#clock() + leaseMs,
      attemptCount: 1,
      ownerToken: `owner-${id}-1`,
      fencingToken: 1,
      output: null,
      error: null,
    }
    this.#runs.set(id, run)
    this.#keys.set(key, id)
    return { action: 'owner', ownerToken: run.ownerToken, fencingToken: run.fencingToken, run: this.#public(run) }
  }

  succeed(projectId, runId, { ownerToken, fencingToken, output, status = 'succeeded' }) {
    if (!['succeeded', 'needs_review'].includes(status)) throw new Error('RUN_TERMINAL_STATUS_INVALID')
    const run = this.#writable(projectId, runId, ownerToken, fencingToken)
    run.status = status
    run.output = clone(output)
    run.leaseUntil = 0
    return this.#public(run)
  }

  fail(projectId, runId, { ownerToken, fencingToken, code, message, retryable = false }) {
    const run = this.#writable(projectId, runId, ownerToken, fencingToken)
    run.status = 'failed'
    run.error = { code, message, retryable }
    run.leaseUntil = 0
    return this.#public(run)
  }

  get(projectId, runId) {
    const run = this.#runs.get(runId)
    if (!run || run.projectId !== projectId) throw new Error('RUN_NOT_FOUND')
    return this.#public(run)
  }

  #writable(projectId, runId, ownerToken, fencingToken) {
    const run = this.#runs.get(runId)
    if (!run || run.projectId !== projectId) throw new Error('RUN_NOT_FOUND')
    if (run.status !== 'running') throw new Error('RUN_NOT_WRITABLE')
    if (run.ownerToken !== ownerToken || run.fencingToken !== fencingToken) throw new Error('RUN_FENCE_CONFLICT')
    return run
  }

  #public(run) {
    return clone({
      id: run.id,
      projectId: run.projectId,
      providerId: run.providerId,
      status: run.status,
      attemptCount: run.attemptCount,
      output: run.output,
      error: run.error,
    })
  }
}
