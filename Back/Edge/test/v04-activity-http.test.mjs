// V0.4 任务04 · 客户活动只读聚合回归（真实本地 HTTP；契约 docs/v0.4/results/04-activity/CONTRACT.md）。
// 替身边界：Edge 侧全链为真实代码（createKernelStore + createMessageStore + 回执文件落盘 +
// 真实 HTTP 路由/鉴权）；唯一替身是"Back/A 持久数据库"（本文件内可控上游）。回执文件由测试按
// assistant-receipts 落盘形状直接写入（不装配真实模型——GET 前后模型/上传/审批调用为零是结构性的）。
// 本套件不声称真实 A 持久数据库整链通过；真实 A 链的 events-page/messages 面由 V0.3 backend-qa-r2 覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startEdgeServer } from '../src/server.mjs';
import { createKernelStore } from '../src/kernel-store.mjs';
import { createMessageStore } from '../src/message-store.mjs';
import { createMessageRouter } from '../src/messages.mjs';
import { createSessionStore } from '../src/session.mjs';
import { createAuditSink } from '../src/audit.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { encodeActivityCursor } from '../src/customer-activity.mjs';

// ---- 受控身份（Edge verifyCredential 表）：业务 t1 / 客户 t1 / 业务 t2 ----
const IDENTITY = {
  'cred-biz-t1': { ok: true, principalId: 'p-biz-t1', roles: ['business'], tenantId: 't1' },
  'cred-cust-c1': { ok: true, principalId: 'cit-1', roles: ['customer'], tenantId: 't1' },
  'cred-biz-t2': { ok: true, principalId: 'p-biz-t2', roles: ['business'], tenantId: 't2' },
};
// ---- 替身 A 的凭据→客户 ACL（A 是唯一授权裁决方；未列客户一律 404，存在性不泄露） ----
const ACL = {
  'cred-biz-t1': new Set(['cust-1', 'cust-2']),
  'cred-cust-c1': new Set(['cust-1']),
  'cred-biz-t2': new Set(['cust-3']),
};

// 替身 A：只读上游（GET /api/v2/customers/:id 与 /events）；记录全部收到的请求供零副作用断言。
function startStandInA() {
  const received = [];
  const state = { revoked: new Set() };
  const eventsByCustomer = new Map(); // cid -> [{eventId, seq, at?, eventType, payload}]
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://standin-a');
      const cred = req.headers['x-principal-credential'] ?? null;
      received.push({ method: req.method, path: u.pathname, query: u.search, credential: cred });
      const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const m = u.pathname.match(/^\/api\/v2\/customers\/([^/]+)(\/.*)?$/);
      if (!m) return respond(404, { ok: false, error: 'NOT_FOUND' });
      const cid = decodeURIComponent(m[1]);
      if (state.revoked.has(cred)) return respond(403, { ok: false, error: 'PERMISSION_DENIED' });
      if (!ACL[cred] || !ACL[cred].has(cid)) return respond(404, { ok: false, error: 'NOT_FOUND' });
      if (req.method !== 'GET') return respond(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      const sub = m[2] ?? '/';
      if (sub === '/') return respond(200, { ok: true, customer: { customerId: cid, tenantId: IDENTITY[cred]?.tenantId ?? null } });
      if (sub === '/events') {
        const after = BigInt(u.searchParams.get('after') || '0');
        const limit = Math.min(Number(u.searchParams.get('limit') || '500'), 500);
        const page = (eventsByCustomer.get(cid) ?? [])
          .filter((e) => BigInt(e.seq) > after)
          .sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))
          .slice(0, limit);
        return respond(200, { ok: true, events: page });
      }
      return respond(404, { ok: false, error: 'NOT_FOUND' });
    });
  });
  const addEvents = (cid, arr) => eventsByCustomer.set(cid, [...(eventsByCustomer.get(cid) ?? []), ...arr]);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, port: server.address().port, received, state, addEvents,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

// 按 assistant-receipts 落盘形状写回执替身（terminal / intent；文件名 encodeURIComponent(id).json）。
async function writeReceipt(receiptsDir, rec) {
  const dir = path.join(receiptsDir, 'receipts');
  await fs.mkdir(dir, { recursive: true });
  const id = rec.phase === 'intent' ? `${rec.requestId}:intent` : rec.requestId;
  await fs.writeFile(path.join(dir, `${encodeURIComponent(id)}.json`), JSON.stringify(rec));
}

const terminalReceipt = (over = {}) => ({
  requestId: over.requestId ?? 'amq:cust-1:v2-rc1',
  customerId: over.customerId ?? 'cust-1',
  tenantId: over.tenantId ?? 't1',
  assistant: over.assistant ?? 'credit',
  contextVersion: over.contextVersion ?? 'v7',
  receiptVersion: 2,
  contextHash: 'ctxhash-abc',
  configHash: 'cfghash-abc',
  phase: 'terminal',
  at: over.at,
  outcome: {
    status: over.status ?? 'succeeded', sentFlag: over.sentFlag ?? true,
    findings: [], questions: [], evidenceRefs: [], analysisRunId: 'amq:cust-1:run1', usage: { totalTokens: 10 },
  },
});

async function buildEdge({ standInA, ttlMs = null, messageStoreOpts = {}, receiptsDir = null, storeOverride = undefined, omitMessageStore = false } = {}) {
  const sessionStore = createSessionStore(ttlMs ? { ttlMs } : {});
  const verifyCredential = async ({ credential }) => IDENTITY[credential] ?? { ok: false, reason: 'PRINCIPAL_UNTRUSTED' };
  const auditSink = createAuditSink();
  const store = storeOverride !== undefined ? storeOverride
    : createKernelStore({ baseUrl: `http://127.0.0.1:${standInA.port}` });
  const messageStore = omitMessageStore ? null : createMessageStore(messageStoreOpts);
  let deliverCount = 0;
  const deliverLog = [];
  const messages = createMessageRouter({
    deliver: async (msg) => {
      deliverCount += 1;
      const rec = { messageId: `fx-${deliverCount}`, state: 'sent_local_sink' };
      deliverLog.push({ ...msg, ...rec });
      return rec;
    },
    auditSink,
    threadStore: messageStore,
    receiptStore: messageStore,
  });
  const started = await startEdgeServer({
    port: 0,
    seal: { buildId: 'test-v04-activity', capabilities: { note: 'test' } },
    probes: [],
    store,
    auth: async ({ session }) => (session ? { ok: true, principalId: session.principalId } : { ok: false, reason: 'SESSION_REQUIRED' }),
    sessionStore,
    verifyCredential,
    messages,
    messageStore,
    modelReceiptsDir: receiptsDir,
    auditSink,
  });
  return { ...started, kernelStore: store.pageEvents ? store : null, messageStore, auditSink, deliverLog };
}

const exchange = async (port, credential) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  return (await r.json()).session.sessionId;
};
const activityGet = (port, cid, sid, query = '') => fetch(`http://127.0.0.1:${port}/api/jw/v2/customers/${cid}/activity${query ? `?${query}` : ''}`, { headers: { 'x-jw-session': sid } });
const sendMessage = async (base, cid, sid, body) => {
  const r = await fetch(`${base}/api/jw/v2/customers/${cid}/messages`, {
    method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r;
};

async function withTmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-activity-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('全量聚合：三源分列、字段契约、刷新一致（同事件稳定身份/时间/ID）、重复投递不重复出条', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'model-receipts');
    await writeReceipt(receiptsDir, terminalReceipt({ at: '2026-09-21T02:30:00.000Z' }));
    const edge = await buildEdge({ standInA: a, receiptsDir });
    const base = `http://127.0.0.1:${edge.port}`;
    try {
      a.addEvents('cust-1', [
        { eventId: 'evt-1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'ASSESSMENT_CREATED', payload: { assessmentId: 'a1' } },
        { eventId: 'evt-2', seq: '2', at: '2026-09-21T01:30:00.000Z', eventType: 'MESSAGE_SENT', payload: { requestId: 'm-1' } },
      ]);
      const biz = await exchange(edge.port, 'cred-biz-t1');
      await sendMessage(base, 'cust-1', biz, { requestId: 'm-1', audience: 'customer', text: '请补传银行流水' });
      await sendMessage(base, 'cust-1', biz, { requestId: 'm-2', audience: 'internal', text: '内部：负债偏高，重点关注' });

      const r1 = await activityGet(edge.port, 'cust-1', biz);
      assert.equal(r1.status, 200);
      assert.equal(r1.headers.get('cache-control'), 'no-store');
      const b1 = await r1.json();
      assert.equal(b1.ok, true);
      assert.equal(b1.ordering.includes('NOT a global total order'), true, '明确披露不声称总序');
      assert.equal(b1.items.length, 5, '2 kernel + 2 thread + 1 receipt');
      const ids = b1.items.map((i) => i.activityId);
      assert.equal(new Set(ids).size, 5, 'activityId 全局唯一（来源命名空间）');

      const bySrc = Object.groupBy(b1.items, (i) => i.source);
      assert.equal(bySrc.kernel.length, 2);
      assert.equal(bySrc.thread.length, 2);
      assert.equal(bySrc.model_receipt.length, 1);

      const th = bySrc.thread.find((i) => i.requestId === 'm-1');
      assert.equal(th.eventType, 'message.posted');
      assert.equal(th.sourceRecordId, edge.messageStore.list('cust-1').messages[0].messageId, 'sourceRecordId=线程 messageId');
      assert.equal(th.actor.principalId, 'p-biz-t1');
      assert.equal(th.actor.trusted, true, '线程 actor 来自发送时会话落库：可信');
      assert.equal(th.state, 'completed', '仅表示投递成功已留档');
      assert.equal(th.delivery.state, 'sent_local_sink', '投递回执态来自 message_receipts');
      assert.equal(th.tenantId, null, '线程无权威租户：null 不填补');
      const inner = bySrc.thread.find((i) => i.requestId === 'm-2');
      assert.equal(inner.refs.audience, 'internal');

      const k1 = bySrc.kernel.find((i) => i.sourceRecordId === 'evt-1');
      assert.equal(k1.activityId, 'kernel:evt-1');
      assert.equal(k1.occurredAt, '2026-09-21T01:00:00.000Z', 'A 原始 occurredAt');
      assert.equal(k1.eventType, 'ASSESSMENT_CREATED');
      assert.equal(k1.actor.trusted, false, 'kernel 事件无 actor：如实 unknown');
      assert.deepEqual(k1.actor.principalId, null);
      assert.equal(k1.requestId, null);

      const rc = bySrc.model_receipt[0];
      assert.equal(rc.activityId, `model_receipt:amq:cust-1:v2-rc1`);
      assert.equal(rc.state, 'completed', 'succeeded 回执 → completed');
      assert.equal(rc.occurredAt, '2026-09-21T02:30:00.000Z');
      assert.equal(rc.actor.trusted, false, '回执无 principalId：不填当前会话人');
      assert.equal(rc.refs.assistant, 'credit');
      assert.equal(rc.tenantId, 't1', '回执自带权威租户');

      const sources = Object.fromEntries(b1.sources.map((s) => [s.source, s]));
      assert.equal(sources.thread.available, true);
      assert.equal(sources.kernel.available, true);
      assert.equal(sources.model_receipt.available, true);

      // 刷新一致：同数据重复 GET 响应逐字节同构（响应不含任何"当前时间"字段）
      const b2 = await (await activityGet(edge.port, 'cust-1', biz)).json();
      assert.deepEqual(b2, b1, '刷新后同一事件稳定身份/时间/ID');

      // 重复投递：同 requestId 重放不二次入栈；A 重复 eventId（重放）不出重复条
      const replay = await sendMessage(base, 'cust-1', biz, { requestId: 'm-1', audience: 'customer', text: '请补传银行流水' });
      assert.equal((await replay.json()).replayed, true);
      a.addEvents('cust-1', [{ eventId: 'evt-1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'ASSESSMENT_CREATED', payload: { assessmentId: 'a1' } }]);
      const b3 = await (await activityGet(edge.port, 'cust-1', biz)).json();
      assert.deepEqual(b3.items.map((i) => i.activityId), ids, '重复投递后聚合条目不变（去重）');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('分页可续读：limit=2 逐页游标推进，各源升序前缀、不漏不重，读到头 nextCursor=null', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'mr');
    for (const [i, at] of ['2026-09-21T03:00:00.000Z', '2026-09-21T03:10:00.000Z', '2026-09-21T03:20:00.000Z'].entries()) {
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: `amq:cust-1:v2-p${i}`, at }));
    }
    const edge = await buildEdge({ standInA: a, receiptsDir });
    try {
      a.addEvents('cust-1', [
        { eventId: 'e1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'T1', payload: {} },
        { eventId: 'e2', seq: '2', at: '2026-09-21T01:05:00.000Z', eventType: 'T2', payload: {} },
        { eventId: 'e3', seq: '3', at: '2026-09-21T01:10:00.000Z', eventType: 'T3', payload: {} },
      ]);
      const biz = await exchange(edge.port, 'cred-biz-t1');
      const base = `http://127.0.0.1:${edge.port}`;
      for (const i of [1, 2, 3]) {
        await sendMessage(base, 'cust-1', biz, { requestId: `pg-${i}`, audience: 'customer', text: `第${i}条` });
      }
      const seen = [];
      const seqTrace = { thread: [], kernel: [], model_receipt: [] };
      let cursor = null;
      for (let page = 0; page < 10; page += 1) {
        const q = new URLSearchParams({ limit: '2', ...(cursor ? { cursor } : {}) });
        const b = await (await activityGet(edge.port, 'cust-1', biz, q.toString())).json();
        assert.equal(b.ok, true);
        for (const it of b.items) {
          seen.push(it.activityId);
          seqTrace[it.source].push(it.refs.seq ?? `${it.occurredAt}|${it.sourceRecordId}`);
        }
        if (b.nextCursor === null) break;
        cursor = b.nextCursor;
      }
      assert.equal(seen.length, 9, '3+3+3 全部续读到（9 条）');
      assert.equal(new Set(seen).size, 9, '跨页零重复');
      const asc = (arr) => arr.every((v, i) => i === 0 || String(arr[i - 1]) <= String(v));
      assert.equal(asc(seqTrace.thread.map(Number)), true, 'thread 每源升序前缀');
      assert.equal(asc(seqTrace.kernel.map(Number)), true, 'kernel 每源升序前缀');
      assert.equal(asc(seqTrace.model_receipt), true, 'model_receipt 升序前缀');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('相同时间确定性 tiebreak + 晚到事件不漏（不假称总序但绝不跳过）', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a });
  const base = `http://127.0.0.1:${edge.port}`;
  try {
    const biz = await exchange(edge.port, 'cred-biz-t1');
    await sendMessage(base, 'cust-1', biz, { requestId: 'same-1', audience: 'customer', text: '同时刻消息' });
    const msgAt = edge.messageStore.list('cust-1').messages[0].at;
    a.addEvents('cust-1', [
      { eventId: 'same-k', seq: '1', at: msgAt, eventType: 'SAME_TIME', payload: {} },
      { eventId: 'older-k', seq: '2', at: '2020-01-01T00:00:00.000Z', eventType: 'LATE_ARRIVAL', payload: {} },
    ]);
    const b1 = await (await activityGet(edge.port, 'cust-1', biz)).json();
    const pair = b1.items.filter((i) => i.occurredAt === msgAt);
    assert.deepEqual(pair.map((i) => i.source), ['kernel', 'thread'], '同刻 tiebreak：source 字典序，确定性');
    const b2 = await (await activityGet(edge.port, 'cust-1', biz)).json();
    assert.deepEqual(b2.items.map((i) => i.activityId), b1.items.map((i) => i.activityId), '重复 GET 页序稳定');
    assert.equal(b1.nextCursor, null, '全部读到头');

    // 刷新后重读（游标已尽 → 整窗重读语义）：晚到条目（seq 更高、时间更老）必须出现，不被时间序吞掉
    await sendMessage(base, 'cust-1', biz, { requestId: 'late-1', audience: 'customer', text: '晚到消息' });
    const stored = edge.messageStore.list('cust-1', { audience: 'customer' }).messages.at(-1);
    a.addEvents('cust-1', [{ eventId: 'older-k2', seq: '3', at: '2020-01-01T00:00:00.000Z', eventType: 'LATE_ARRIVAL_2', payload: {} }]);
    const b3 = await (await activityGet(edge.port, 'cust-1', biz)).json();
    const gotIds = b3.items.map((i) => i.activityId);
    assert.equal(gotIds.length, 5, '3 kernel + 2 thread 全量返回');
    assert.equal(gotIds.includes(`thread:${stored.messageId}`), true, '晚到消息不丢');
    assert.equal(gotIds.includes('kernel:older-k2'), true, '晚到事件不丢');
    assert.equal(gotIds.includes('kernel:older-k'), true, '首读中的旧时间事件同样在列');
    assert.equal(b3.nextCursor, null);
    assert.equal(b3.ordering.includes('NOT a global total order'), true);
  } finally {
    await edge.close();
    await a.close();
  }
});

test('游标非法/版本不符/形状错 → 400 INVALID_CURSOR；不静默重置', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a });
  try {
    const biz = await exchange(edge.port, 'cred-biz-t1');
    for (const bad of ['garbage!!', Buffer.from(JSON.stringify({ v: 9, c: {} })).toString('base64url'), encodeActivityCursor({ thread: 'abc' }), encodeActivityCursor({ kernel: '1;DROP' }), encodeActivityCursor({ model_receipt: 'no-sep' })]) {
      const r = await activityGet(edge.port, 'cust-1', biz, `cursor=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, `非法游标应 400：${bad.slice(0, 20)}`);
      assert.equal((await r.json()).error, 'INVALID_CURSOR');
    }
  } finally {
    await edge.close();
    await a.close();
  }
});

test('游标过期（线程保留窗口裁剪）：truncated+retentionBase 显式披露，缺失区段不静默', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a, messageStoreOpts: { maxPerCustomer: 3 } });
  try {
    for (const i of [1, 2, 3]) {
      edge.messageStore.append({ customerId: 'cust-1', audience: 'customer', text: `t${i}`, requestId: `r${i}`, senderPrincipalId: 'p-biz-t1' });
    }
    const biz = await exchange(edge.port, 'cred-biz-t1');
    const first = await (await activityGet(edge.port, 'cust-1', biz)).json();
    assert.equal(first.nextCursor, null);
    // 继续追加触发裁剪（base=2），旧游标 thread=1 < base → 过期披露
    for (const i of [4, 5]) {
      edge.messageStore.append({ customerId: 'cust-1', audience: 'customer', text: `t${i}`, requestId: `r${i}`, senderPrincipalId: 'p-biz-t1' });
    }
    const staleCursor = encodeActivityCursor({ thread: '1' });
    const b = await (await activityGet(edge.port, 'cust-1', biz, `cursor=${encodeURIComponent(staleCursor)}`)).json();
    assert.equal(b.ok, true, '过期游标不 500：可续读，缺失区段显式提示');
    const th = b.sources.find((s) => s.source === 'thread');
    assert.equal(th.truncated, true);
    assert.equal(th.retentionBase, 2);
    assert.deepEqual(b.items.map((i) => i.refs.seq), ['3', '4', '5'], '从保留窗口起如实续读（seq≤base 已物理裁剪）');
  } finally {
    await edge.close();
    await a.close();
  }
});

test('缺失身份/时间：occurredAt=null、actor 不可信、intent-only 回执=unknown；不用当前值填补', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'mr');
    await writeReceipt(receiptsDir, { requestId: 'amq:cust-1:v2-intonly', customerId: 'cust-1', tenantId: 't1', assistant: 'credit', contextVersion: 'v1', receiptVersion: 2, phase: 'intent', at: '2026-09-21T05:00:00.000Z' });
    await fs.writeFile(path.join(receiptsDir, 'receipts', encodeURIComponent('amq:cust-1:v2-claimonly') + '.claim'), 'x');
    const edge = await buildEdge({ standInA: a, receiptsDir });
    try {
      a.addEvents('cust-1', [
        { eventId: 'no-at', seq: '1', eventType: 'NO_TIME', payload: {} }, // A 事件缺 at
        { eventId: 'k2', seq: '2', at: '2026-09-21T05:01:00.000Z', eventType: 'OK', payload: {} },
      ]);
      edge.messageStore.append({ customerId: 'cust-1', audience: 'internal', text: '无身份消息', requestId: 'r-x', senderPrincipalId: null });
      const biz = await exchange(edge.port, 'cred-biz-t1');
      const b = await (await activityGet(edge.port, 'cust-1', biz)).json();
      const noAt = b.items.find((i) => i.activityId === 'kernel:no-at');
      assert.equal(noAt.occurredAt, null, '缺时间 → null（不取当前时间）');
      const noActor = b.items.find((i) => i.source === 'thread');
      assert.deepEqual(noActor.actor, { principalId: null, roles: [], trusted: false }, '缺身份 → 不可信空 actor（不填当前会话人）');
      const intOnly = b.items.find((i) => i.activityId === 'model_receipt:amq:cust-1:v2-intonly');
      assert.equal(intOnly.state, 'unknown', '仅 INTENT 回执：发送结果未知，绝不伪装完成');
      assert.equal(intOnly.refs.phase, 'intent');
      assert.equal(b.items.some((i) => i.activityId.includes('claimonly')), false, '纯 claim 残留（无 at 无内容）不入列');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('请求与回执分离：提问不推导模型成功；回执三分状态独立演进', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'mr');
    const edge = await buildEdge({ standInA: a, receiptsDir });
    const base = `http://127.0.0.1:${edge.port}`;
    try {
      const biz = await exchange(edge.port, 'cred-biz-t1');
      const q = await sendMessage(base, 'cust-1', biz, { requestId: 'q-1', audience: 'internal', text: '该客户授信怎么看？' });
      assert.equal(q.status, 200);
      let b = await (await activityGet(edge.port, 'cust-1', biz)).json();
      assert.equal(b.items.length, 1);
      assert.equal(b.items[0].eventType, 'message.posted', '只有提问条目');
      assert.equal(b.items.some((i) => i.eventType === 'model.observe.receipt'), false, '无回执 → 无模型完成条目（提问不推导成功）');

      // 模型被真实调用后 INTENT 先落：未知态
      await writeReceipt(receiptsDir, { requestId: 'amq:cust-1:v2-q1', customerId: 'cust-1', tenantId: 't1', assistant: 'credit', contextVersion: 'v1', receiptVersion: 2, phase: 'intent', at: '2026-09-21T06:00:00.000Z' });
      b = await (await activityGet(edge.port, 'cust-1', biz)).json();
      assert.equal(b.items.find((i) => i.eventType === 'model.observe.receipt').state, 'unknown', 'INTENT 落盘 → unknown，不是 processing 伪装也不是 completed');

      // TERMINAL 落盘：failed 如实 failed
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-1:v2-q1', at: '2026-09-21T06:00:05.000Z', status: 'failed', sentFlag: false }));
      b = await (await activityGet(edge.port, 'cust-1', biz)).json();
      const rc = b.items.find((i) => i.activityId === 'model_receipt:amq:cust-1:v2-q1');
      assert.equal(rc.state, 'failed', 'failed 回执如实 failed');
      assert.equal(rc.requestId.startsWith('amq:'), true, '回执 requestId 与消息 requestId 分属不同命名空间');
      const qItem = b.items.find((i) => i.requestId === 'q-1');
      assert.notEqual(qItem.activityId, rc.activityId, '提问条目与回执条目分离');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('跨客户/租户隔离与内部受众：客户联系人不见内部消息与模型回执；跨客户读不到', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'mr');
    await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-2:v2-other', customerId: 'cust-2', at: '2026-09-21T07:00:00.000Z' }));
    await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-1:v2-mine', at: '2026-09-21T07:05:00.000Z' }));
    const edge = await buildEdge({ standInA: a, receiptsDir });
    const base = `http://127.0.0.1:${edge.port}`;
    try {
      a.addEvents('cust-2', [{ eventId: 'c2-1', seq: '1', at: '2026-09-21T07:00:00.000Z', eventType: 'C2_ONLY', payload: {} }]);
      const biz = await exchange(edge.port, 'cred-biz-t1');
      const cust = await exchange(edge.port, 'cred-cust-c1');
      await sendMessage(base, 'cust-1', biz, { requestId: 'i-1', audience: 'internal', text: '内部协作' });
      await sendMessage(base, 'cust-1', biz, { requestId: 'c-1', audience: 'customer', text: '对客户可见' });

      // 业务会话只见本客户：cust-2 的事件/回执不串入
      const bBiz = await (await activityGet(edge.port, 'cust-1', biz)).json();
      assert.equal(bBiz.items.every((i) => i.customerId === 'cust-1'), true, '全部条目归属请求客户');
      assert.equal(bBiz.items.some((i) => i.source === 'model_receipt'), true, '业务会话可见本客户模型回执');

      // 客户联系人：内部消息不可见；模型回执源排除且显式点名 403
      const bCust = await (await activityGet(edge.port, 'cust-1', cust)).json();
      assert.equal(bCust.items.every((i) => !(i.source === 'thread' && i.refs.audience === 'internal')), true, '内部消息不进客户视图');
      assert.equal(bCust.items.some((i) => i.source === 'thread' && i.requestId === 'c-1'), true, '对客户受众消息可见');
      const srcMap = Object.fromEntries(bCust.sources.map((s) => [s.source, s]));
      assert.equal(srcMap.model_receipt.available, false);
      assert.equal(srcMap.model_receipt.reason, 'AUDIENCE_FORBIDDEN');
      assert.equal(srcMap.model_receipt.excludedByAudience, true, '排除显式披露，不静默');
      const forbiddenAud = await activityGet(edge.port, 'cust-1', cust, 'audience=internal');
      assert.equal(forbiddenAud.status, 403, '客户显式读内部受众 → 403');
      const forbiddenSrc = await activityGet(edge.port, 'cust-1', cust, 'sources=model_receipt');
      assert.equal(forbiddenSrc.status, 403);
      assert.equal((await forbiddenSrc.json()).error, 'ACTIVITY_SOURCE_FORBIDDEN');

      // 跨客户：cust 身份读未授权客户；biz-t1 读 t2 的 cust-3 —— A 裁决拒绝，无条目外泄
      assert.equal((await activityGet(edge.port, 'cust-2', cust)).status, 404, '客户读未授权客户 → A 404');
      const cross = await activityGet(edge.port, 'cust-3', biz);
      assert.equal(cross.status, 404, 'biz-t1 读他租户客户 → A 404（存在性不泄露）');

      // 业务会话显式 audience=internal 只看内部；customer 受众过滤可用
      const bInt = await (await activityGet(edge.port, 'cust-1', biz, 'audience=internal&sources=thread')).json();
      assert.equal(bInt.items.length, 1);
      assert.equal(bInt.items[0].requestId, 'i-1');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('每次读取重验权限：后续页读取中撤权 → 403；会话过期 → 401', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a, ttlMs: 80 });
  try {
    a.addEvents('cust-1', [
      { eventId: 'r1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'A', payload: {} },
      { eventId: 'r2', seq: '2', at: '2026-09-21T01:01:00.000Z', eventType: 'B', payload: {} },
      { eventId: 'r3', seq: '3', at: '2026-09-21T01:02:00.000Z', eventType: 'C', payload: {} },
    ]);
    const biz = await exchange(edge.port, 'cred-biz-t1');
    const p1 = await (await activityGet(edge.port, 'cust-1', biz, 'limit=1&sources=kernel')).json();
    assert.equal(p1.items.length, 1);
    // 翻页前撤权（A 侧拒绝本凭据）→ 下一页 403，绝不返回剩余条目
    a.state.revoked.add('cred-biz-t1');
    const p2 = await activityGet(edge.port, 'cust-1', biz, `limit=1&sources=kernel&cursor=${encodeURIComponent(p1.nextCursor)}`);
    assert.equal(p2.status, 403, '撤权后后续页 403（A 逐请求裁决）');
    assert.equal((await p2.json()).error, 'PERMISSION_DENIED');
    a.state.revoked.delete('cred-biz-t1');

    // 会话 TTL 过期 → 401（含后续页：失效会话不能借旧游标续读）
    const fresh = await exchange(edge.port, 'cred-biz-t1');
    const f1 = await (await activityGet(edge.port, 'cust-1', fresh, 'limit=1&sources=kernel')).json();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await activityGet(edge.port, 'cust-1', fresh)).status, 401, '过期会话首页 401');
    assert.equal((await activityGet(edge.port, 'cust-1', fresh, `cursor=${encodeURIComponent(f1.nextCursor)}`)).status, 401, '失效会话借旧游标续读 → 401');
    const noSession = await activityGet(edge.port, 'cust-1', 'not-a-session');
    assert.equal(noSession.status, 401);
  } finally {
    await edge.close();
    await a.close();
  }
});

test('GET 零副作用：审计/线程存储/回执文件不变；替身 A 只收到白名单只读请求', async () => {
  await withTmp(async (tmp) => {
    const a = await startStandInA();
    const receiptsDir = path.join(tmp, 'mr');
    await writeReceipt(receiptsDir, terminalReceipt({ at: '2026-09-21T08:00:00.000Z' }));
    const edge = await buildEdge({ standInA: a, receiptsDir });
    try {
      a.addEvents('cust-1', [
        { eventId: 'z1', seq: '1', at: '2026-09-21T08:00:00.000Z', eventType: 'A', payload: {} },
        { eventId: 'z2', seq: '2', at: '2026-09-21T08:01:00.000Z', eventType: 'A', payload: {} },
      ]);
      const biz = await exchange(edge.port, 'cred-biz-t1');
      const before = {
        audit: edge.auditSink._size(),
        stats: { ...edge.messageStore.stats() },
        receipts: (await fs.readdir(path.join(receiptsDir, 'receipts'))).length,
        upstream: a.received.length,
      };
      await activityGet(edge.port, 'cust-1', biz);
      await activityGet(edge.port, 'cust-1', biz, 'limit=1');
      const p1 = await (await activityGet(edge.port, 'cust-1', biz, 'limit=1')).json();
      await activityGet(edge.port, 'cust-1', biz, `limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`);
      await activityGet(edge.port, 'cust-1', biz, 'cursor=bad-cursor');
      await activityGet(edge.port, 'cust-1', biz, 'sources=thread,kernel,model_receipt');

      assert.equal(edge.auditSink._size(), before.audit, '审计零新增');
      assert.deepEqual({ ...edge.messageStore.stats() }, before.stats, '线程存储零变化');
      assert.equal((await fs.readdir(path.join(receiptsDir, 'receipts'))).length, before.receipts, '回执文件零变化');
      const delta = a.received.slice(before.upstream);
      assert.equal(delta.every((r) => r.method === 'GET'), true, '替身 A 只收到 GET（无任何写调用）');
      assert.equal(delta.every((r) => /^\/api\/v2\/customers\/[^/]+(\/|\/events)?$/.test(r.path)), true, '只访问客户与事件只读端点');
      assert.equal(delta.some((r) => /assessments|financing|invitations|inspections|originals|upload/.test(r.path)), false, '无评估/申请/邀请/检查/上传调用');
      assert.equal(delta.some((r) => r.path.includes('cust-2') || r.path.includes('cust-3')), false, '只读请求客户自身的上游面');
    } finally {
      await edge.close();
      await a.close();
    }
  });
});

test('降级形态：fixture 无分页事件源 → kernel 如实 NOT_SUPPORTED 不伪造；全未配置 → 501 失败关闭', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a, storeOverride: createFixtureStore() });
  try {
    edge.messageStore.append({ customerId: 'cust-1', audience: 'customer', text: '仅线程', requestId: 'only-1', senderPrincipalId: 'p-biz-t1' });
    const biz = await exchange(edge.port, 'cred-biz-t1');
    const b = await (await activityGet(edge.port, 'cust-1', biz)).json();
    assert.equal(b.ok, true, '其余源照常返回，不整页失败');
    const k = b.sources.find((s) => s.source === 'kernel');
    assert.equal(k.available, false);
    assert.equal(k.reason, 'NOT_SUPPORTED');
    assert.equal(b.items.every((i) => i.source === 'thread'), true);
    assert.equal(b.incomplete.length, 0, '结构性不可用列入 sources，不计入 incomplete');
  } finally {
    await edge.close();
    await a.close();
  }

  const a2 = await startStandInA();
  const edge2 = await buildEdge({ standInA: a2, storeOverride: createFixtureStore(), omitMessageStore: true });
  try {
    const biz2 = await exchange(edge2.port, 'cred-biz-t1');
    const r = await activityGet(edge2.port, 'cust-1', biz2);
    assert.equal(r.status, 501, '无线程存储/无事件源/无回执目录 → 501 失败关闭');
    assert.equal((await r.json()).error, 'NOT_CONFIGURED');
    const anon = await activityGet(edge2.port, 'cust-1', null);
    assert.equal(anon.status, 401, '无会话先于 501：鉴权前置');
  } finally {
    await edge2.close();
    await a2.close();
  }
});

test('POST 到只读聚合面 → 405（读路径方法白名单）', async () => {
  const a = await startStandInA();
  const edge = await buildEdge({ standInA: a });
  try {
    const biz = await exchange(edge.port, 'cred-biz-t1');
    const r = await fetch(`http://127.0.0.1:${edge.port}/api/jw/v2/customers/cust-1/activity`, {
      method: 'POST', headers: { 'x-jw-session': biz, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(r.status, 405);
  } finally {
    await edge.close();
    await a.close();
  }
});
