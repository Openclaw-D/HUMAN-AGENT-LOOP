import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageRouter } from '../src/messages.mjs';
import { createMessageStore } from '../src/message-store.mjs';

const session = { principalId: 'p1', tenantId: 't1', roles: ['business'] };
const body = { requestId: 'request-1', audience: 'customer', text: 'synthetic message' };
const input = (changes = {}) => ({ session, customerId: 'c1', body, ...changes });

function harness(t, deliverResult = { messageId: 'delivery-1', state: 'sent_local_sink' }) {
  const store = createMessageStore();
  t.after(() => store.close());
  const sends = [];
  const makeRouter = (deliver = async () => deliverResult) => createMessageRouter({
    receiptStore: store,
    auditSink: { append() {} },
    validateTarget: async () => ({ ok: true }),
    deliver: async message => { sends.push(message); return deliver(message); },
  });
  return { store, sends, makeRouter, router: makeRouter() };
}

test('same scope and payload replays with one actual send', async t => {
  const h = harness(t);
  await h.router.handle(input());
  const result = await h.makeRouter().handle(input());
  assert.equal(h.sends.length, 1);
  assert.equal(result.body.replayed, true);
});

test('same ID with different payload conflicts without sending', async t => {
  const h = harness(t);
  await h.router.handle(input());
  const result = await h.router.handle(input({ body: { ...body, text: 'changed' } }));
  assert.equal(h.sends.length, 1);
  assert.equal(result.status, 409);
});

for (const [name, change] of [
  ['customer', { customerId: 'c2' }],
  ['principal', { session: { ...session, principalId: 'p2' } }],
  ['trusted tenant', { session: { ...session, tenantId: 't2' } }],
]) {
  test(`same ID across ${name} must not return another scope's receipt`, async t => {
    const h = harness(t);
    await h.router.handle(input());
    const result = await h.makeRouter().handle(input(change));
    assert.equal(h.sends.length, 1);
    assert.equal(result.status, 409, `observed status=${result.status}, replayed=${result.body.replayed}, sends=${h.sends.length}`);
    assert.equal(result.body.delivery, undefined);
  });
}

test('body principal/tenant claims do not change trusted scope', async t => {
  const h = harness(t);
  await h.router.handle(input());
  const result = await h.router.handle(input({ body: { ...body, principalId: 'forged', tenantId: 'forged' } }));
  assert.equal(h.sends.length, 1);
  assert.equal(result.body.replayed, true);
});

test('legacy unscoped receipt fails closed without resend or disclosure', async t => {
  const h = harness(t);
  const fingerprint = JSON.stringify({ audience: body.audience, text: body.text, threadId: null, internalContent: false });
  h.store.putReceipt(body.requestId, fingerprint, { ok: true, delivery: { messageId: 'legacy-private' } }, { customerId: 'other' });
  const result = await h.router.handle(input());
  assert.equal(h.sends.length, 0);
  assert.equal(result.status, 409, `observed status=${result.status}, replayed=${result.body.replayed}, sends=0`);
  assert.equal(result.body.delivery, undefined);
});

test('internal audience remains internal; external content requires explicit confirmation', async t => {
  const h = harness(t);
  const denied = await h.router.handle(input({ body: { ...body, internalContent: true } }));
  assert.equal(denied.status, 403);
  assert.equal(h.sends.length, 0);
  await h.router.handle(input({ body: { ...body, audience: 'internal' } }));
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].audience, 'internal');
});

for (const state of ['failed', 'unknown']) {
  test(`returned ${state} delivery is replayed without a second send`, async t => {
    const h = harness(t, { state });
    await h.router.handle(input());
    const result = await h.makeRouter().handle(input());
    assert.equal(h.sends.length, 1);
    assert.equal(result.body.delivery.state, state);
    assert.equal(result.body.replayed, true);
  });
}

test('concurrent routers sharing receipt storage must not both send one request ID', async t => {
  const h = harness(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const deliver = async () => { await gate; return { messageId: 'concurrent', state: 'sent_local_sink' }; };
  const first = h.makeRouter(deliver).handle(input());
  const second = h.makeRouter(deliver).handle(input({ customerId: 'c2' }));
  await new Promise(resolve => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(h.sends.length, 1, `observed actual sends=${h.sends.length} to ${h.sends.map(m => m.customerId).join(',')}`);
});

test('exception after attempted send must not permit a blind resend', async t => {
  const h = harness(t);
  const make = () => h.makeRouter(async () => { throw new Error('synthetic disconnect after send'); });
  await make().handle(input()).catch(() => {});
  await make().handle(input()).catch(() => {});
  assert.equal(h.sends.length, 1, `observed actual sends=${h.sends.length}; no durable intent protects the first attempt`);
});
