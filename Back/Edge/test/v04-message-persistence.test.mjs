// R2-01 持久化幂等回归（契约：docs/v0.4/results/r2-01-messages/CONTRACT-R2-01.md）：
// 两个独立 SQLite 连接争抢、进程重启（关闭重开）恢复、崩溃遗留 intent 租约收敛、发送后异常
// 持久 unknown 跨重启、旧无作用域回执跨重启失败关闭且不清账、裁剪保护、内存兜底同语义、
// 受众/客户/身份/租户边界与各场景实际出站计数。所有计数均为本地 deliver 替身的实际调用次数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMessageRouter } from '../src/messages.mjs';
import { createMessageStore } from '../src/message-store.mjs';

const session = { principalId: 'p1', tenantId: 't1', roles: ['business'] };
const body = { requestId: 'request-1', audience: 'customer', text: 'synthetic message' };
const input = (changes = {}) => ({ session, customerId: 'c1', body, ...changes });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 文件库 harness：两个完全独立的 store 连接打开同一文件（模拟两个进程/连接），各自配 router。
function fileHarness(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jw-edge-msgpersist-'));
  const file = path.join(dir, 'messages.db');
  const opened = [];
  const sends = [];
  const deliverOf = (impl) => async (message) => {
    sends.push(message);
    return impl ? impl(message) : { messageId: `d-${sends.length}`, state: 'sent_local_sink' };
  };
  const makeStore = () => {
    const store = createMessageStore({ file });
    opened.push(store);
    return store;
  };
  const makeRouter = (store, { deliver, pendingLeaseMs } = {}) => createMessageRouter({
    receiptStore: store,
    auditSink: { append() {} },
    validateTarget: async () => ({ ok: true }),
    ...(pendingLeaseMs !== undefined ? { pendingLeaseMs } : {}),
    deliver: deliverOf(deliver),
  });
  t.after(() => {
    for (const s of opened) s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { file, sends, makeStore, makeRouter };
}

test('两独立 SQLite 连接（同库文件）争抢同 requestId：恰一胜者，败者见 pending；finalize 仅认 owner', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jw-edge-msgrace-'));
  const file = path.join(dir, 'messages.db');
  try {
    const storeA = createMessageStore({ file });
    const storeB = createMessageStore({ file });
    const scope = { customerId: 'c1', principalId: 'p1', tenantId: 't1' };
    const a = storeA.claimReceipt('r-race', 'fp', scope, { ownerToken: 'tok-A' });
    const b = storeB.claimReceipt('r-race', 'fp', scope, { ownerToken: 'tok-B' });
    assert.ok(a.claimed !== b.claimed, '有且仅有一个胜者');
    const loser = a.claimed ? b : a;
    assert.equal(loser.existing.status, 'pending');
    assert.equal(loser.existing.scope.customerId, 'c1');
    const winnerToken = a.claimed ? 'tok-A' : 'tok-B';
    const loserToken = a.claimed ? 'tok-B' : 'tok-A';
    const winnerStore = a.claimed ? storeA : storeB;
    // owner 校验：持败者 token（非 owner）无法把 intent 转 terminal，记录不被覆盖。
    const foreign = winnerStore === storeA ? storeB : storeA;
    assert.equal(foreign.finalizeReceipt('r-race', loserToken, { ok: true }, { state: 'sent' }), false, '非 owner token 不得 finalize');
    assert.equal(foreign.getReceiptRecord('r-race').status, 'pending');
    assert.equal(winnerStore.finalizeReceipt('r-race', winnerToken, { ok: true }, { state: 'sent' }), true, 'owner 可 finalize');
    assert.equal(winnerStore.getReceiptRecord('r-race').status, 'terminal');
    // 他连接读到的记录一致（跨连接可见）。
    assert.equal(foreign.getReceiptRecord('r-race').status, 'terminal');
    storeA.close();
    storeB.close();
  } finally {
    await sleep(20); // Windows：等 WAL 检查点释放文件句柄再清理
    rmSync(dir, { recursive: true, force: true });
  }
});

test('两 router 各持独立连接共享库文件并发同 ID（异客户）：总发送恰 1，败者 409 不披露', async t => {
  const h = fileHarness(t);
  const gate = (() => { let release; const p = new Promise((r) => { release = r; }); p.release = release; return p; })();
  const store1 = h.makeStore();
  const store2 = h.makeStore();
  const blockedDeliver = async () => { await gate; return { messageId: 'winner', state: 'sent_local_sink' }; };
  const first = h.makeRouter(store1, { deliver: blockedDeliver }).handle(input());
  await sleep(2); // 确保 first 已完成 claim（pending 在库）
  const second = await h.makeRouter(store2, { deliver: blockedDeliver }).handle(input({ customerId: 'c2' }));
  assert.equal(second.status, 409, `败者 observed status=${second.status}`);
  assert.equal(second.body.delivery, undefined, '不披露胜者回执');
  gate.release();
  await first;
  assert.equal(h.sends.length, 1, `observed sends=${h.sends.length}`);
  assert.equal(h.sends[0].customerId, 'c1');
});

test('重启（关闭重开）后同 scope 同载荷仍重放原回执，出站不增', async t => {
  const h = fileHarness(t);
  const first = await h.makeRouter(h.makeStore()).handle(input());
  assert.equal(first.status, 200);
  const again = await h.makeRouter(h.makeStore()).handle(input());
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.deepEqual(again.body.delivery, first.body.delivery);
  assert.equal(h.sends.length, 1);
});

test('崩溃遗留 pending intent：默认租约内 409 IN_FLIGHT 零发送；小租约收敛 unknown 后重放仍零发送', async t => {
  const h = fileHarness(t);
  const store = h.makeStore();
  // 模拟"进程在发送中崩溃"：只认领，不 finalize。
  const claim = store.claimReceipt('request-1', JSON.stringify({ audience: 'customer', text: 'synthetic message', threadId: null, internalContent: false }), { customerId: 'c1', principalId: 'p1', tenantId: 't1' }, { ownerToken: 'crashed' });
  assert.equal(claim.claimed, true);
  store.close();
  opened_reopen: {
    const store2 = h.makeStore();
    const inLease = await h.makeRouter(store2).handle(input());
    assert.equal(inLease.status, 409);
    assert.equal(inLease.body.error, 'REQUEST_ID_IN_FLIGHT');
    assert.equal(h.sends.length, 0, '租约内绝不重发');
    await sleep(8); // 越过小租约
    const recovered = await h.makeRouter(store2, { pendingLeaseMs: 4 }).handle(input());
    assert.equal(recovered.status, 200, `租约到期应收敛为 unknown 重放，observed=${recovered.status} ${JSON.stringify(recovered.body)}`);
    assert.equal(recovered.body.replayed, true);
    assert.equal(recovered.body.delivery.state, 'unknown');
    assert.equal(h.sends.length, 0, '收敛为 unknown 也不重发');
    assert.equal(store2.getReceiptRecord('request-1').state, 'unknown');
  }
});

test('崩溃遗留 intent 的异 scope 重试：即使租约已过也不回收、不披露，行保持 pending', async t => {
  const h = fileHarness(t);
  const store = h.makeStore();
  store.claimReceipt('request-1', JSON.stringify({ audience: 'customer', text: 'synthetic message', threadId: null, internalContent: false }), { customerId: 'c1', principalId: 'p1', tenantId: 't1' }, { ownerToken: 'crashed' });
  store.close();
  const store2 = h.makeStore();
  await sleep(8);
  const cross = await h.makeRouter(store2, { pendingLeaseMs: 4 }).handle(input({ customerId: 'c9' }));
  assert.equal(cross.status, 409);
  assert.equal(cross.body.error, 'REQUEST_ID_CONFLICT', '异 scope 见 CONFLICT，不披露在途');
  assert.equal(cross.body.delivery, undefined);
  assert.equal(store2.getReceiptRecord('request-1').status, 'pending', '异 scope 不得回收他人 intent');
  assert.equal(h.sends.length, 0);
});

test('发送后异常：502 DELIVERY_UNKNOWN 持久化；重启后重放 unknown，总发送恰 1', async t => {
  const h = fileHarness(t);
  const boom = async () => { throw new Error('synthetic disconnect after send'); };
  const first = await h.makeRouter(h.makeStore(), { deliver: boom }).handle(input());
  assert.equal(first.status, 502);
  assert.equal(first.body.error, 'DELIVERY_UNKNOWN');
  assert.equal(first.body.delivery.state, 'unknown');
  assert.equal(h.sends.length, 1, '异常前的那次尝试计 1 次出站');
  const again = await h.makeRouter(h.makeStore()).handle(input());
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.delivery.state, 'unknown');
  assert.equal(h.sends.length, 1, '重启后重放零二次发送');
});

test('旧无作用域回执跨重启：持续失败关闭，行保留（不清账），零发送', async t => {
  const h = fileHarness(t);
  const store = h.makeStore();
  store.putReceipt('request-1', JSON.stringify({ audience: 'customer', text: 'synthetic message', threadId: null, internalContent: false }), { ok: true, delivery: { messageId: 'legacy-private' } }, { customerId: 'other' });
  const blocked1 = await h.makeRouter(store).handle(input());
  assert.equal(blocked1.status, 409);
  assert.equal(blocked1.body.delivery, undefined);
  assert.equal(h.sends.length, 0);
  store.close();
  const store2 = h.makeStore();
  assert.ok(store2.getReceipt('request-1'), '不清账：旧回执行保留');
  const blocked2 = await h.makeRouter(store2).handle(input());
  assert.equal(blocked2.status, 409, '重启后仍失败关闭');
  assert.equal(blocked2.body.delivery, undefined);
  assert.equal(h.sends.length, 0);
});

test('裁剪保护：pending 与 unknown 不参与 maxReceipts 裁剪，sent 照旧裁最旧', () => {
  const store = createMessageStore({ maxReceipts: 3 });
  try {
    store.putReceipt('sent-1', 'fp1', { i: 1 });
    store.putReceipt('sent-2', 'fp2', { i: 2 });
    store.claimReceipt('pending-1', 'fpP', { customerId: 'c', principalId: 'p', tenantId: 't' }, { ownerToken: 'o' });
    store.claimReceipt('unknown-1', 'fpU', { customerId: 'c', principalId: 'p', tenantId: 't' }, { ownerToken: 'o' });
    store.finalizeReceipt('unknown-1', 'o', { ok: true, delivery: { messageId: 'unknown', state: 'unknown' } }, { state: 'unknown' });
    store.putReceipt('sent-3', 'fp3', { i: 3 });
    store.putReceipt('sent-4', 'fp4', { i: 4 });
    assert.equal(store.getReceipt('sent-1'), null, '最旧 sent 被裁');
    assert.equal(store.getReceipt('sent-2'), null);
    assert.ok(store.getReceipt('sent-4'), '新 sent 保留');
    assert.equal(store.getReceiptRecord('pending-1').status, 'pending', '在途 intent 不被裁剪遗忘');
    assert.equal(store.getReceiptRecord('unknown-1').state, 'unknown', 'unknown 不被裁剪遗忘');
  } finally {
    store.close();
  }
});

test('作用域边界（文件库跨连接）：customer/principal/tenant 任一不同即冲突；tenant 未配置(null)等值绑定自身', async t => {
  const h = fileHarness(t);
  await h.makeRouter(h.makeStore()).handle(input());
  for (const [name, change] of [
    ['customer', { customerId: 'c2' }],
    ['principal', { session: { ...session, principalId: 'p2' } }],
    ['tenant', { session: { ...session, tenantId: 't2' } }],
  ]) {
    const r = await h.makeRouter(h.makeStore()).handle(input(change));
    assert.equal(r.status, 409, `跨 ${name} 必须 409，observed=${r.status}`);
    assert.equal(r.body.delivery, undefined);
    assert.equal(h.sends.length, 1, `${name} 边界零新增出站`);
  }
  const replayTenantNull = await h.makeRouter(h.makeStore()).handle(input({ session: { ...session, tenantId: null } }));
  assert.equal(replayTenantNull.status, 409, "tenant 't1' ≠ tenant null：不可互重放");
  assert.equal(h.sends.length, 1);

  const h2 = fileHarness(t);
  await h2.makeRouter(h2.makeStore()).handle(input({ session: { ...session, tenantId: null } }));
  const sameNull = await h2.makeRouter(h2.makeStore()).handle(input({ session: { ...session, tenantId: null } }));
  assert.equal(sameNull.status, 200);
  assert.equal(sameNull.body.replayed, true, '同为未配置租户（null）同 scope 可重放');
  assert.equal(h2.sends.length, 1);
});

test('body 伪造 principal/tenant 跨连接不改变可信作用域', async t => {
  const h = fileHarness(t);
  await h.makeRouter(h.makeStore()).handle(input());
  const forged = await h.makeRouter(h.makeStore()).handle(input({ body: { ...body, principalId: 'forged', tenantId: 'forged' } }));
  assert.equal(forged.status, 200);
  assert.equal(forged.body.replayed, true);
  assert.equal(h.sends.length, 1);
});

test('受众边界跨重启：internal 正常发送可重放；external 未确认拒绝不落回执、修正后同 ID 可发送', async t => {
  const h = fileHarness(t);
  const internalBody = { requestId: 'request-int', audience: 'internal', text: 'synthetic message' };
  const internal = await h.makeRouter(h.makeStore()).handle(input({ body: internalBody }));
  assert.equal(internal.status, 200);
  const internalReplay = await h.makeRouter(h.makeStore()).handle(input({ body: internalBody }));
  assert.equal(internalReplay.body.replayed, true);
  assert.equal(h.sends.length, 1);
  // 未确认外发（新 requestId）：403 拒绝且零出站；拒绝不落回执——修正载荷后同 ID 可正常发送。
  const extBody = { requestId: 'request-ext', audience: 'customer', text: 'synthetic message', internalContent: true };
  const denied = await h.makeRouter(h.makeStore()).handle(input({ body: extBody }));
  assert.equal(denied.status, 403);
  assert.equal(h.sends.length, 1, '拒绝零出站');
  const confirmed = await h.makeRouter(h.makeStore()).handle(input({ body: { ...extBody, confirmExternalSend: true } }));
  assert.equal(confirmed.status, 200);
  assert.equal(h.sends.length, 2);
  assert.equal(h.sends[1].requestId, 'request-ext');
  const extReplay = await h.makeRouter(h.makeStore()).handle(input({ body: { ...extBody, confirmExternalSend: true } }));
  assert.equal(extReplay.body.replayed, true, '确认外发的回执可重放');
  assert.equal(h.sends.length, 2);
});

test('内存兜底 ledger（无 receiptStore）同语义：重放/异载荷冲突/在途 IN_FLIGHT/异常 unknown 重放', async t => {
  const sends = [];
  const makeRouter = (impl) => createMessageRouter({
    auditSink: { append() {} },
    deliver: async (m) => { sends.push(m); return impl ? impl(m) : { messageId: `v-${sends.length}`, state: 'sent_local_sink' }; },
  });
  const router = makeRouter();
  await router.handle(input());
  const replay = await router.handle(input());
  assert.equal(replay.body.replayed, true);
  assert.equal(sends.length, 1);
  const conflict = await router.handle(input({ body: { ...body, text: 'changed' } }));
  assert.equal(conflict.status, 409);
  const cross = await router.handle(input({ customerId: 'c2' }));
  assert.equal(cross.status, 409);
  assert.equal(sends.length, 1);
  // 在途：gate 挂起第一次发送期间，同 router 再提交同 ID → IN_FLIGHT，零新增出站。
  let release;
  const gate = new Promise((r) => { release = r; });
  const blocked = makeRouter(async () => { await gate; return { messageId: 'x', state: 'sent_local_sink' }; });
  const first = blocked.handle(input({ body: { ...body, requestId: 'in-flight-1' } }));
  await sleep(2);
  const second = await blocked.handle(input({ body: { ...body, requestId: 'in-flight-1' } }));
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'REQUEST_ID_IN_FLIGHT');
  release();
  await first;
  assert.equal(sends.length, 2);
  const boom = makeRouter(async () => { throw new Error('x'); });
  const failed = await boom.handle(input({ body: { ...body, requestId: 'boom-1' } }));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'DELIVERY_UNKNOWN');
  const boomReplay = await boom.handle(input({ body: { ...body, requestId: 'boom-1' } }));
  assert.equal(boomReplay.body.replayed, true);
  assert.equal(boomReplay.body.delivery.state, 'unknown');
});

test('failed 态回执跨重启原样重放（不重试不重发）', async t => {
  const h = fileHarness(t);
  const first = await h.makeRouter(h.makeStore(), { deliver: async () => ({ messageId: 'f1', state: 'failed' }) }).handle(input());
  assert.equal(first.body.delivery.state, 'failed');
  const again = await h.makeRouter(h.makeStore()).handle(input());
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.delivery.state, 'failed');
  assert.equal(h.sends.length, 1);
});
