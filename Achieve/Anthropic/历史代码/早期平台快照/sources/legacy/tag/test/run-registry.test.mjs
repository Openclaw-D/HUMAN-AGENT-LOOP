import test from 'node:test'
import assert from 'node:assert/strict'
import { RunRegistry } from '../src/index.mjs'

test('lease takeover fences a stale owner from success and failure', () => {
  let now = 100
  const runs = new RunRegistry(() => now)
  const first = runs.reserve({ projectId: 'p1', idempotencyKey: 'k', request: { nested: { b: 2, a: 1 } }, providerId: 'mock', leaseMs: 10 })
  now = 111
  const takeover = runs.reserve({ projectId: 'p1', idempotencyKey: 'k', request: { nested: { a: 1, b: 2 } }, providerId: 'mock', leaseMs: 10 })
  assert.equal(takeover.action, 'owner')
  assert.throws(() => runs.succeed('p1', first.run.id, { ownerToken: first.ownerToken, fencingToken: first.fencingToken, output: {} }), /RUN_FENCE_CONFLICT/)
  assert.throws(() => runs.fail('p1', first.run.id, { ownerToken: first.ownerToken, fencingToken: first.fencingToken, code: 'x', message: 'x' }), /RUN_FENCE_CONFLICT/)
  const done = runs.succeed('p1', takeover.run.id, { ownerToken: takeover.ownerToken, fencingToken: takeover.fencingToken, output: { advisoryOnly: true }, status: 'needs_review' })
  assert.equal(done.status, 'needs_review')
  assert.equal(runs.reserve({ projectId: 'p1', idempotencyKey: 'k', request: { nested: { a: 1, b: 2 } }, providerId: 'mock' }).action, 'replay')
})

test('run requests are project scoped and public records never leak input', () => {
  const runs = new RunRegistry()
  const a = runs.reserve({ projectId: 'p1', idempotencyKey: 'same', request: { secret: 'never' }, providerId: 'mock' })
  assert.throws(() => runs.get('p2', a.run.id), /RUN_NOT_FOUND/)
  assert.equal(runs.reserve({ projectId: 'p2', idempotencyKey: 'same', request: { secret: 'different' }, providerId: 'mock' }).action, 'owner')
  assert.equal(JSON.stringify(a.run).includes('never'), false)
})
