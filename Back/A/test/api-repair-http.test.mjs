import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRepairRuntime, HUMAN, TENANT } from './api-repair-runtime.mjs';

const until = async predicate => {
  const deadline = Date.now() + 12000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error('fixture progress timeout'); await new Promise(r => setTimeout(r, 20)); }
};

test('HTTP publishes all five results before slow model work, fences stale feedback and reselects', async t => {
  let active = 0, maxActive = 0, hold = true;
  const pending = [], calls = [];
  const semantic = { describe: () => ({ configured: true }), run: async ctx => {
    calls.push(ctx); active++; maxActive = Math.max(maxActive, active);
    if (hold) await new Promise(resolve => pending.push(resolve));
    active--; return { status: 'simulated', authority: 'none', decisions: [], inputDigest: 'fixture-only' };
  } };
  const r = await createRepairRuntime({ semantic });
  t.after(async () => { hold = false; pending.splice(0).forEach(f => f()); await r.close(); });
  const c = r.cases.find(c => c.id === 'good');
  const view = async () => (await r.call('GET', `/customers/${c.customerId}/advance-rounds`)).body;
  const start = async domain => {
    const plan = await r.call('GET', `/customers/${c.customerId}/advance-plan?domain=${domain}`);
    assert.equal(plan.status, 200);
    const frame = { ...Object.fromEntries(['domain', 'planId', 'planHash', 'expectedVersion', 'roundNo', 'actionIds'].map(k => [k, plan.body[k]])), requestId: randomUUID() };
    const res = await r.call('POST', `/customers/${c.customerId}/advance-rounds`, frame);
    assert.ok([200, 202].includes(res.status), JSON.stringify(res)); return { frame, res };
  };
  const first = await start('business');
  await until(() => calls.length === 4);
  const before = await view();
  assert.equal(before.receipts.length, 5);
  assert.ok(before.domains.every(d => d.state === 'awaiting_confirmation'), JSON.stringify(before.domains));
  assert.equal(maxActive, 4);
  const job = before.receipts.find(j => j.domain === 'business');
  const choice = await r.call('POST', `/customers/${c.customerId}/advance-rounds/${job.roundId}/decision`, {
    requestId: randomUUID(), decision: 'set_aside', resultId: job.actions[0].result.resultId,
    expectedVersion: job.version, rationale: 'Synthetic fixture: recheck evidence, no adoption',
  });
  assert.equal(choice.status, 200, JSON.stringify(choice));
  await r.kernel.v2.registerArtifact({ credential: HUMAN, tenantId: TENANT, requestId: randomUUID(), kind: 'financial_statement',
    factKey: 'monthly_operating_cash_flow', grade: 'unverified', content: { value: 40000 }, materialMeta: { unit: 'CNY' } }, c.customerId);
  hold = false; pending.splice(0).forEach(f => f()); await r.advance.drain();
  const oldRows = (await r.pool.query('SELECT domain,semantic FROM arrow_jobs WHERE process_id=$1', [before.processId])).rows;
  assert.equal(oldRows.find(j => j.domain === 'business').semantic, null);
  assert.equal(oldRows.find(j => j.domain === 'credit').semantic, null);
  const retry = await start('business'); await r.advance.drain();
  const after = await view();
  const newBusiness = after.receipts.find(j => j.domain === 'business');
  assert.notEqual(newBusiness.roundId, job.roundId, 'set-aside creates a new attempt even with unchanged business facts');
  assert.ok(calls.some(ctx => ctx.jobId === newBusiness.roundId && ctx.feedback.some(f => f.decision === 'set_aside')));
  const count = Number((await r.pool.query('SELECT count(*) n FROM arrow_jobs')).rows[0].n);
  await r.call('POST', `/customers/${c.customerId}/advance-rounds`, retry.frame);
  await r.advance.drain();
  assert.equal(Number((await r.pool.query('SELECT count(*) n FROM arrow_jobs')).rows[0].n), count);
  assert.equal(first.res.body.ok, true);
});

test('HTTP reconciles a stored unknown from the same durable semantic receipt without sending again', async t => {
  const durable = new Map();
  let lateUnknown = false;
  const semantic = { describe: () => ({ configured: true }), run: async ctx => {
    if (!durable.has(ctx.requestId)) durable.set(ctx.requestId, { status: ctx.domain === 'business' ? 'unknown' : 'simulated', authority: 'none', sent: ctx.domain === 'business' ? null : true });
    return lateUnknown ? { status: 'unknown', authority: 'none', sent: null } : { ...durable.get(ctx.requestId), requestId: ctx.requestId, replayed: true };
  } };
  const r = await createRepairRuntime({ semantic });
  t.after(() => r.close());
  const c = r.cases.find(c => c.id === 'good');
  const plan = await r.call('GET', `/customers/${c.customerId}/advance-plan?domain=business`);
  const frame = { ...Object.fromEntries(['domain', 'planId', 'planHash', 'expectedVersion', 'roundNo', 'actionIds'].map(k => [k, plan.body[k]])), requestId: randomUUID() };
  assert.ok([200, 202].includes((await r.call('POST', `/customers/${c.customerId}/advance-rounds`, frame)).status));
  await r.advance.drain();
  const before = (await r.call('GET', `/customers/${c.customerId}/advance-rounds`)).body;
  const job = before.receipts.find(j => j.domain === 'business');
  assert.equal(job.semantic.status, 'unknown');
  const requestCount = durable.size;
  // The original owner has now recorded a terminal under the original request ID.
  durable.set(job.semantic.requestId, { status: 'succeeded', sent: true, authority: 'none', decisions: [], replayed: true });
  const endpoint = `/customers/${c.customerId}/advance-rounds/${job.roundId}/semantic`;
  const reconciled = await r.call('POST', endpoint, { requestId: randomUUID() });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.body.receipt.status, 'succeeded');
  assert.equal(reconciled.body.receipt.requestId, job.semantic.requestId);
  assert.equal(durable.size, requestCount, 'read-back must reuse the existing request');
  const version = Number((await r.call('GET', `/customers/${c.customerId}/advance-rounds`)).body.version);
  lateUnknown = true;
  const delayed = await r.call('POST', endpoint, { requestId: randomUUID() });
  assert.equal(delayed.body.receipt.status, 'succeeded', 'late unknown cannot overwrite a known terminal');
  assert.equal(delayed.body.receipt.replayed, true);
  assert.equal(Number((await r.call('GET', `/customers/${c.customerId}/advance-rounds`)).body.version), version, 'stable replay emits no extra semantic event');
});
