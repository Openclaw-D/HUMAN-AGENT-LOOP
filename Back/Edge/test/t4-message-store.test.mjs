// 任务04 §四·消息与恢复测试：分页/增量/裁剪/游标语义 + node:sqlite 持久化 + 幂等回执重启恢复。
// 重点回归本轮已复现的分页缺陷：写入1至5、after=0、limit=2 曾返回4和5且cursor=5，续读为空、
// 1至3被永久跳过——修复后增量必须返回连续可续读窗口（最早优先），游标绝不越过未返回区段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMessageStore } from '../src/message-store.mjs';

const seed = (store, n, customerId = 'c1') => {
  for (let i = 1; i <= n; i++) {
    store.append({ customerId, audience: 'customer', text: `t${i}`, requestId: `r-${customerId}-${i}`, senderPrincipalId: 'p-biz' });
  }
};

test('分页缺陷回归：after=0、limit=2 → 返回1和2、cursor=2；逐页续读到5，不漏不重', () => {
  const store = createMessageStore({});
  seed(store, 5);
  const p1 = store.list('c1', { afterSeq: 0, limit: 2 });
  assert.deepEqual(p1.messages.map((m) => m.text), ['t1', 't2'], '增量必须从最早开始（此前返回4和5）');
  assert.equal(p1.cursor, '2');
  const p2 = store.list('c1', { afterSeq: Number(p1.cursor), limit: 2 });
  assert.deepEqual(p2.messages.map((m) => m.text), ['t3', 't4']);
  assert.equal(p2.cursor, '4');
  const p3 = store.list('c1', { afterSeq: Number(p2.cursor), limit: 2 });
  assert.deepEqual(p3.messages.map((m) => m.text), ['t5']);
  assert.equal(p3.cursor, '5');
  const p4 = store.list('c1', { afterSeq: Number(p3.cursor), limit: 2 });
  assert.deepEqual(p4.messages, [], '追平后为空');
  assert.equal(p4.cursor, '5', '空页游标不前进（绝不跳到未读区段之后）');
});

test('首次历史读取（不带 after）= 最新一页（升序），cursor=本页最后一条', () => {
  const store = createMessageStore({});
  seed(store, 5);
  const tail = store.list('c1', { limit: 2 });
  assert.deepEqual(tail.messages.map((m) => m.text), ['t4', 't5']);
  assert.equal(tail.cursor, '5');
  const inc = store.list('c1', { afterSeq: Number(tail.cursor), limit: 10 });
  assert.deepEqual(inc.messages, [], '从 cursor 续拉不重');
});

test('受众过滤：游标按最后一条返回记录推进，被过滤区段不造成漏读', () => {
  const store = createMessageStore({});
  store.append({ customerId: 'c1', audience: 'internal', text: 'i1', requestId: 'ri1', senderPrincipalId: 'p' });
  store.append({ customerId: 'c1', audience: 'customer', text: 'c1', requestId: 'rc1', senderPrincipalId: 'p' });
  store.append({ customerId: 'c1', audience: 'internal', text: 'i2', requestId: 'ri2', senderPrincipalId: 'p' });
  store.append({ customerId: 'c1', audience: 'customer', text: 'c2', requestId: 'rc2', senderPrincipalId: 'p' });
  const onlyCustomer = store.list('c1', { audience: 'customer', afterSeq: 0, limit: 1 });
  assert.deepEqual(onlyCustomer.messages.map((m) => m.text), ['c1']);
  assert.equal(onlyCustomer.cursor, '2', 'cursor=本页最后一条返回记录（非全局最大）');
  const next = store.list('c1', { audience: 'customer', afterSeq: Number(onlyCustomer.cursor), limit: 10 });
  assert.deepEqual(next.messages.map((m) => m.text), ['c2'], '客户受众读者续拉不漏');
  const internal = store.list('c1', { audience: 'internal', afterSeq: 0, limit: 10 });
  assert.deepEqual(internal.messages.map((m) => m.text), ['i1', 'i2']);
});

test('保留窗口：超出上限裁最旧；after 落入已裁区段 → truncated:true + retentionBase 显式提示', () => {
  const store = createMessageStore({ maxPerCustomer: 3 });
  seed(store, 5);
  const tail = store.list('c1', {});
  assert.deepEqual(tail.messages.map((m) => m.text), ['t3', 't4', 't5']);
  assert.equal(tail.truncated, true, '历史被裁剪必须显式提示（不静默漏消息）');
  assert.equal(tail.retentionBase, 2);
  const stale = store.list('c1', { afterSeq: 1, limit: 10 });
  assert.equal(stale.truncated, true, '游标落在已裁区段 → truncated 标注');
  assert.deepEqual(stale.messages.map((m) => m.text), ['t3', 't4', 't5'], '从保留窗口最早处续读');
  assert.equal(stale.retentionBase, 2);
});

test('客户隔离：互不串桶；stats 不回传内容', () => {
  const store = createMessageStore({});
  seed(store, 2, 'c1');
  seed(store, 1, 'c2');
  assert.equal(store.list('c1', {}).messages.length, 2);
  assert.equal(store.list('c2', {}).messages.length, 1);
  assert.deepEqual(store.list('cX', {}).messages, []);
  const s = store.stats();
  assert.equal(s.threads, 2);
  assert.equal(s.messages, 3);
  assert.ok(!JSON.stringify(s).includes('t1'), 'stats 不回传消息内容');
});

test('持久化与重启恢复：文件库关闭重开后，消息与幂等回执仍在', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jw-edge-msgstore-'));
  const file = path.join(dir, 'messages.db');
  try {
    const store1 = createMessageStore({ file });
    const rec = store1.append({ customerId: 'c1', audience: 'customer', text: '重启前消息', requestId: 'r-pre', senderPrincipalId: 'p-biz' });
    store1.putReceipt('r-pre', 'fp-pre', { ok: true, requestId: 'r-pre' }, { customerId: 'c1' });
    assert.equal(store1.stats().persistence, 'sqlite');
    store1.close();

    const store2 = createMessageStore({ file });
    const all = store2.list('c1', {});
    assert.equal(all.messages.length, 1);
    assert.equal(all.messages[0].text, '重启前消息');
    assert.equal(all.messages[0].messageId, rec.messageId, 'messageId 跨重启稳定（去重锚点不换）');
    const receipt = store2.getReceipt('r-pre');
    assert.ok(receipt, '幂等回执跨重启可查');
    assert.deepEqual(receipt.result, { ok: true, requestId: 'r-pre' });
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('幂等回执有界：超出 maxReceipts 裁最旧，最新回执保留', () => {
  const store = createMessageStore({ maxReceipts: 3 });
  for (let i = 1; i <= 5; i++) store.putReceipt(`rid-${i}`, `fp-${i}`, { i });
  assert.equal(store.getReceipt('rid-5')?.result.i, 5, '最新保留');
  assert.equal(store.getReceipt('rid-1'), null, '最旧被裁');
  assert.equal(store.getReceipt('rid-2'), null);
  assert.ok(store.getReceipt('rid-3'));
});
