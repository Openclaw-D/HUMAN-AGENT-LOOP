// V6 R2 夜间 · 请求注册表回归（真实逻辑执行；内存注入存储）。
// 运行：node --experimental-strip-types --test test/v5-preview-remote-registry.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as rr from '../lib/v5-preview/remote-request-registry.ts';

let seq = 0;

function memStorage() {
  let data = null;
  return {
    get: () => data,
    set: (v) => { data = v; },
    remove: () => { data = null; },
  };
}
function makeRegistry(opts) {
  return new rr.RequestRegistry({ storage: memStorage(), idFactory: () => `rid-${++seq}`, ...opts });
}

const BODY_A = { evidenceId: 'ev-1', evidenceVersion: 1, question: '问题A（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, expectedVersion: 5 };
const BODY_A_SAME = { evidenceId: 'ev-1', evidenceVersion: 1, question: '问题A（合成）', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, expectedVersion: 5 };

test('G1：多请求并存——新操作不覆盖旧未知记录', () => {
  const reg = makeRegistry();
  const a = reg.begin({ op: 'annotation', path: 'annotations', body: BODY_A, ownerSessionId: 's1' });
  const b = reg.begin({ op: 'reply-annotation', path: 'annotations/replies', body: { annotationId: 'an-1', kind: 'business', text: 'B（合成）' }, ownerSessionId: 's1' });
  assert.equal(a.ok && b.ok, true);
  const unknown = reg.listUnknown('s1');
  assert.equal(unknown.length, 2, '两条未知记录并存');
  assert.ok(unknown.some((e) => e.requestId === a.entry.requestId));
  assert.ok(unknown.some((e) => e.requestId === b.entry.requestId));
});

test('G2：原样重试——同 op 同载荷复用冻结 requestId；载荷变化生成新 ID', () => {
  const reg = makeRegistry();
  const beginBody = { ...BODY_A };
  const first = reg.begin({ op: 'annotation', path: 'annotations', body: beginBody, ownerSessionId: 's1' });
  // 同载荷查找 → 复用
  const retry = reg.findRetry('annotation', BODY_A_SAME, 's1');
  assert.equal(retry === null ? null : retry.requestId, first.entry.requestId, '同载荷必须复用冻结 requestId');
  // 载荷变化 → 不复用
  const changed = reg.findRetry('annotation', { ...BODY_A, question: '改过的问题' }, 's1');
  assert.equal(changed, null, '载荷变化不得复用旧 requestId');
});

test('G3：容量背压——unknown 满时拒绝新请求，已终结项可被淘汰', () => {
  const reg = makeRegistry({ capacity: 2 });
  reg.begin({ op: 'a', path: 'x', body: {}, ownerSessionId: 's' });
  reg.begin({ op: 'b', path: 'x', body: {}, ownerSessionId: 's' });
  const third = reg.begin({ op: 'c', path: 'x', body: {}, ownerSessionId: 's' });
  assert.equal(third.ok, false, 'unknown 满必须背压拒绝');
  assert.equal(third.reason, 'backpressure');
  // 确认一条后可继续
  reg.resolve(reg.listUnknown('s')[0].requestId, 'confirmed');
  const fourth = reg.begin({ op: 'd', path: 'x', body: {}, ownerSessionId: 's' });
  assert.equal(fourth.ok, true, '有已终结项时可腾出容量');
});

test('G4：resolve/abandon——确定性结果清理；跨会话不串', () => {
  const reg = makeRegistry();
  reg.begin({ op: 'annotation', path: 'annotations', body: BODY_A, ownerSessionId: 's1' });
  reg.begin({ op: 'annotation', path: 'annotations', body: { ...BODY_A, question: '问题B（合成）' }, ownerSessionId: 's2' });
  const s1Unknown = reg.listUnknown('s1');
  reg.resolve(s1Unknown[0].requestId, 'confirmed');
  assert.equal(reg.listUnknown('s1').length, 0, 's1 已确认清空');
  assert.equal(reg.listUnknown('s2').length, 1, 's2 不受影响（跨会话不串）');
  const s2Unknown = reg.listUnknown('s2');
  reg.abandon(s2Unknown[0].requestId);
  assert.equal(reg.listUnknown('s2').length, 0, '显式放弃生效');
});

test('G5：草稿关联——requestId+修订双判定；A→B→A 不清；刷新后关联可读', () => {
  const assocStore = new Map();
  const reg = makeRegistry({ draftStorage: { get: (k) => assocStore.get(k) ?? null, set: (k, v) => assocStore.set(k, v) } });
  reg.associateDraft('s1', 'rid-A', 0);
  const assoc = reg.readDraftAssociation('s1');
  assert.equal(assoc.requestId, 'rid-A');
  assert.equal(rr.shouldClearDraftForRequest(assoc, 'rid-A', 0), true, '同请求同修订 → 清');
  assert.equal(rr.shouldClearDraftForRequest(assoc, 'rid-A', 2), false, 'A→B→A 修订前进 → 不清');
  assert.equal(rr.shouldClearDraftForRequest(assoc, 'rid-B', 0), false, '确认别的请求 → 不清');
  assert.equal(rr.shouldClearDraftForRequest(null, 'rid-A', 0), false, '无关联 → 不清');
});

test('G6：create-session 失联——session=null 仍可列出与重试', () => {
  const reg = makeRegistry();
  reg.begin({ op: 'create-session', path: '', body: { title: '失联会话（合成）', expectedVersion: 1 }, ownerSessionId: '' });
  const pending = reg.listUndefinedOwner();
  assert.equal(pending.length, 1, 'owner 为空（会话尚不存在）的请求可列出');
  assert.equal(pending[0].op, 'create-session');
});

test('G7：存储往返——持久化注入后新实例可读（刷新恢复语义）', () => {
  const storage = memStorage();
  const reg1 = new rr.RequestRegistry({ storage, idFactory: () => `g7-${++seq}` });
  reg1.begin({ op: 'annotation', path: 'annotations', body: BODY_A, ownerSessionId: 's1' });
  const reg2 = new rr.RequestRegistry({ storage, idFactory: () => `g7-${++seq}` });
  assert.equal(reg2.listUnknown('s1').length, 1, '新实例（模拟刷新）读到同一记录');
});
