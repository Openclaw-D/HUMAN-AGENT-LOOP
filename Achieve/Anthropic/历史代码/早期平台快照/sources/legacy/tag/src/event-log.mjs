import { createHash } from 'node:crypto'

const clone = value => structuredClone(value)

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  return value
}

export const canonicalHash = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')

export class EventLog {
  #events = []
  #idempotency = new Map()

  append({ projectId, aggregateId, aggregateType, type, actor, payload = {} }) {
    const previousHash = this.#events.at(-1)?.hash ?? 'GENESIS'
    const body = {
      id: `evt-${this.#events.length + 1}`,
      sequence: this.#events.length + 1,
      projectId,
      aggregateId,
      aggregateType,
      type,
      actor: clone(actor),
      payload: clone(payload),
      previousHash,
    }
    const hash = canonicalHash(body)
    const event = Object.freeze({ ...body, hash })
    this.#events.push(event)
    return clone(event)
  }

  events(projectId) {
    return clone(this.#events.filter(event => event.projectId === projectId))
  }

  executeOnce({ projectId, actorId, action, key, request }, operation) {
    if (!key) throw new Error('IDEMPOTENCY_KEY_REQUIRED')
    const scopedKey = `${projectId}:${actorId}:${action}:${key}`
    const requestHash = canonicalHash(request)
    const existing = this.#idempotency.get(scopedKey)
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT')
      return clone(existing.result)
    }
    const result = operation()
    this.#idempotency.set(scopedKey, { requestHash, result: clone(result) })
    return clone(result)
  }

  verify() {
    let previousHash = 'GENESIS'
    for (const event of this.#events) {
      const { hash, ...body } = event
      const expected = canonicalHash(body)
      if (event.previousHash !== previousHash || hash !== expected) return false
      previousHash = hash
    }
    return true
  }
}
