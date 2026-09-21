// R2-04 · 隔离恢复与一致性验收（任务书：docs/v0.4/tasks/ZCODE_R2_04.md）。
// 被验收对象：V0.4 持久来源在 Edge 进程重启后的可重复性——thread（message-store sqlite）、
// model_receipt（assistant-receipts 落盘 JSON）、kernel（A 事件，经替身 A 复用真实 kernel-store 读链）。
//
// 方法：父测试进程持有替身 A（A 是独立持久服务，Edge 重启时 A 不重启）；Edge 以真实代码
// （src/server.mjs startEdgeServer + 真实 kernel-store/message-store/messages/session/audit）
// 装配进**自有子进程**（edge-child.mjs），监听随机端口、持久化文件落在 .local/v04-r2-04；
// 重启 = 结束子进程后以同一批持久化文件重新 fork（优雅 IPC 关停与硬杀两种模式）。
//
// 替身边界（诚实声明，详见报告）：
//   真实代码 = Edge 全链（含 sqlite 落盘与回执文件读取）；
//   替身 A   = 本目录 back-a-standin.mjs（只替代 Back/A 持久数据库的只读面）；
//   合成文件 = 模型回执按 assistant-receipts 落盘形状**手工写入**（存储读取测试，不冒充真实模型执行恢复）。
// 本套件不声称真实 A 数据库、生产实例或真实模型整链通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { encodeActivityCursor } from '../../src/customer-activity.mjs';
import { startStandInA } from './back-a-standin.mjs';

const HERE = import.meta.dirname;
const EDGE_ROOT = path.resolve(HERE, '..', '..');      // Back/Edge
const JW_ROOT = path.resolve(EDGE_ROOT, '..', '..');   // JW 仓库根
const TMP = path.join(JW_ROOT, '.local', 'v04-r2-04'); // 任务书指定的本任务临时资源区

// ---- 子进程 Edge 实例管理 ----
async function forkEdge({ runDir, upstreamPort, receiptsDir, messagesFile, maxPerCustomer = null }) {
  const readyFile = path.join(runDir, `ready-${randomUUID()}.json`);
  const args = ['--port', '0', '--messages-file', messagesFile, '--receipts-dir', receiptsDir,
    '--upstream', `http://127.0.0.1:${upstreamPort}`, '--ready-file', readyFile];
  if (maxPerCustomer) args.push('--max-per-customer', String(maxPerCustomer));
  const proc = fork(path.join(HERE, 'edge-child.mjs'), args, {
    cwd: EDGE_ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
  const info = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      if (proc.exitCode !== null || proc.signalCode) {
        return reject(new Error(`edge 子进程提前退出 code=${proc.exitCode} signal=${proc.signalCode}\n${stderr.slice(-2000)}`));
      }
      try { return resolve(JSON.parse(readFileSync(readyFile, 'utf8'))); } catch { /* 未就绪 */ }
      if (Date.now() > deadline) {
        proc.kill('SIGKILL');
        return reject(new Error(`edge 子进程就绪超时\n${stderr.slice(-2000)}`));
      }
      setTimeout(poll, 50);
    };
    proc.once('error', reject);
    poll();
  });
  const untilExit = () => new Promise((resolve) => proc.once('exit', resolve));
  return {
    proc, port: info.port, pid: info.pid,
    /** 优雅关停：IPC {cmd:'shutdown'} → 子进程 close sqlite → exit 0。 */
    shutdown: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* 已退出 */ } reject(new Error('优雅关停超时')); }, 8000);
      proc.once('exit', (code) => { clearTimeout(timer); resolve(code); });
      try { proc.send({ cmd: 'shutdown' }); } catch (e) { clearTimeout(timer); reject(e); }
    }),
    /** 硬杀（Windows=TerminateProcess）：模拟崩溃，验证已提交持久记录可恢复。 */
    hardKill: async () => { const gone = untilExit(); proc.kill('SIGKILL'); await gone; },
  };
}

// ---- 模型回执 fixture（assistant-receipts 落盘形状；明确是存储读取测试，非真实模型执行） ----
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

// ---- HTTP 助手 ----
const exchange = async (port, credential) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/jw/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  return (await r.json()).session.sessionId;
};
const activityGet = (port, cid, sid, query = '') => fetch(`http://127.0.0.1:${port}/api/jw/v2/customers/${cid}/activity${query ? `?${query}` : ''}`, { headers: { 'x-jw-session': sid } });
const activityJson = async (...a) => await (await activityGet(...a)).json();
const sendMessage = async (port, cid, sid, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/jw/v2/customers/${cid}/messages`, {
    method: 'POST', headers: { 'x-jw-session': sid, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r;
};
const seqTraceOf = (items) => {
  const t = { thread: [], kernel: [], model_receipt: [] };
  for (const it of items) t[it.source].push(it.refs.seq ?? `${it.occurredAt}|${it.sourceRecordId}`);
  return t;
};
const isAscending = (arr) => arr.every((v, i) => i === 0 || String(arr[i - 1]) <= String(v));
// 零模型调用断言：替身 A 只允许收到这两个只读端点的 GET；模型/上传/审批面在本装配中结构性不存在。
const READ_WHITELIST = /^\/api\/v2\/customers\/[^/]+(\/events)?$/;
const assertZeroModelCalls = (received, note) => {
  assert.equal(received.every((r) => r.method === 'GET'), true, `${note}：替身 A 只收到 GET`);
  assert.equal(received.every((r) => READ_WHITELIST.test(r.path)), true,
    `${note}：只访问客户与事件只读端点（模型/上传/审批零调用），实际=${JSON.stringify(received.map((r) => `${r.method} ${r.path}`))}`);
};

async function withRunDir(fn) {
  await fs.mkdir(TMP, { recursive: true });
  const dir = await fs.mkdtemp(path.join(TMP, 'run-'));
  try {
    return await fn(dir);
  } finally {
    // Windows：子进程退出事件后文件锁可能延迟释放 → 小步重试删除
    for (let i = 0; i < 6; i += 1) {
      try { await fs.rm(dir, { recursive: true, force: true }); break; } catch (e) {
        if (i === 5) throw e;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
}

/** 测试收尾硬杀子进程并等其退出（幂等：null/已退出直接返回）。 */
const slay = (proc) => new Promise((resolve) => {
  if (!proc || proc.exitCode !== null || proc.signalCode) return resolve();
  proc.once('exit', resolve);
  try { proc.kill('SIGKILL'); } catch { resolve(); }
});

// ---------------------------------------------------------------------------
test('优雅重启主链：ID/原始时间/actor/状态逐字段不变；进程#1游标进程#2可续读不漏不重；重复不重复出条；unknown 仍 unknown；零模型调用', async () => {
  await withRunDir(async (runDir) => {
    const a = await startStandInA();
    let e1 = null; let e2 = null;
    try {
      const receiptsDir = path.join(runDir, 'model-receipts');
      const messagesFile = path.join(runDir, 'thread', 'thread.sqlite');
      // 合成持久记录：kernel 事件入替身 A；回执 fixture 直接落盘；线程消息经真实 HTTP 发送入 sqlite。
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-1:v2-rc1', at: '2026-09-21T02:30:00.000Z' }));
      await writeReceipt(receiptsDir, {
        requestId: 'amq:cust-1:v2-intonly', customerId: 'cust-1', tenantId: 't1', assistant: 'credit',
        contextVersion: 'v1', receiptVersion: 2, phase: 'intent', at: '2026-09-21T02:35:00.000Z',
      });
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-2:v2-other', customerId: 'cust-2', at: '2026-09-21T02:40:00.000Z' }));
      a.addEvents('cust-1', [
        { eventId: 'evt-k1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'ASSESSMENT_CREATED', payload: { assessmentId: 'a1' } },
        { eventId: 'evt-k2', seq: '2', at: '2026-09-21T01:30:00.000Z', eventType: 'MESSAGE_SENT', payload: { requestId: 'm-1' } },
      ]);

      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s1 = await exchange(e1.port, 'cred-biz-t1');
      const send1 = await sendMessage(e1.port, 'cust-1', s1, { requestId: 'm-1', audience: 'customer', text: '请补传银行流水' });
      assert.equal(send1.status, 200);
      const send2 = await sendMessage(e1.port, 'cust-1', s1, { requestId: 'm-2', audience: 'internal', text: '内部：负债偏高' });
      assert.equal(send2.status, 200);

      // 重启前基线：全量页 + 进程#1 签发的续读游标（limit=2）
      const b1 = await activityJson(e1.port, 'cust-1', s1);
      assert.equal(b1.ok, true);
      assert.equal(b1.items.length, 6, '2 kernel + 2 thread + 2 receipt（terminal+intent-only 各 1；cust-2 回执不入列）');
      const page1 = await activityJson(e1.port, 'cust-1', s1, 'limit=2');
      assert.equal(page1.items.length, 2);
      assert.notEqual(page1.nextCursor, null);
      assert.deepEqual(page1.items.map((i) => i.activityId), b1.items.slice(0, 2).map((i) => i.activityId), 'limit 页=全量页前缀');
      const unknownPre = b1.items.find((i) => i.activityId === 'model_receipt:amq:cust-1:v2-intonly');
      assert.equal(unknownPre.state, 'unknown', '重启前：仅 INTENT → unknown');

      // 优雅重启（同一批持久化文件 + 同一替身 A）
      assert.equal(await e1.shutdown(), 0, '子进程优雅退出（exit 0）');
      e2 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      // 会话存储是进程内存：旧会话失效（重启语义如实披露），换新会话读同一批数据
      assert.equal((await activityGet(e2.port, 'cust-1', s1)).status, 401, '重启后旧 sessionId 失效（401）');
      const s2 = await exchange(e2.port, 'cred-biz-t1');

      // ① ID/原始时间/actor/状态不变：重启后全量页与重启前逐字段一致
      const b2 = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(b2, b1, '重启后整页响应逐字段一致（ID/occurredAt/actor/tenantId/state/refs/cursor）');
      assert.equal(b2.items.find((i) => i.activityId === 'model_receipt:amq:cust-1:v2-intonly').state, 'unknown',
        '② unknown 重启后仍不是成功（不翻 completed）');

      // ③ 游标可续读：进程#1 签发的 cursor 在进程#2 继续，不漏不重
      const seen = [...page1.items.map((i) => i.activityId)];
      const trace = seqTraceOf(page1.items);
      let cursor = page1.nextCursor;
      for (let p = 0; p < 10 && cursor; p += 1) {
        const q = new URLSearchParams({ limit: '2', cursor });
        const page = await activityJson(e2.port, 'cust-1', s2, q.toString());
        assert.equal(page.ok, true, '跨进程旧游标不被拒绝（不静默重置也不 400）');
        const same = await activityJson(e2.port, 'cust-1', s2, q.toString());
        assert.deepEqual(same.items, page.items, '同游标重复读幂等');
        for (const it of page.items) seen.push(it.activityId);
        for (const k of Object.keys(trace)) trace[k].push(...seqTraceOf(page.items)[k]);
        cursor = page.nextCursor;
      }
      assert.equal(new Set(seen).size, seen.length, '跨重启续读零重复');
      assert.deepEqual(seen, b2.items.map((i) => i.activityId), '跨重启续读恰好覆盖全量且有序（前缀性质）');
      assert.equal(isAscending(trace.thread.map(Number)), true, 'thread 每源升序前缀');
      assert.equal(isAscending(trace.kernel.map(Number)), true, 'kernel 每源升序前缀');
      assert.equal(isAscending(trace.model_receipt), true, 'model_receipt 升序前缀');

      // ④ 重复不重复显示：requestId 重放（重启后重放重启前的发送）与 A eventId 重放
      const replay = await sendMessage(e2.port, 'cust-1', s2, { requestId: 'm-1', audience: 'customer', text: '请补传银行流水' });
      assert.equal((await replay.json()).replayed, true, '重启后幂等回执仍命中（持久回执）');
      a.addEvents('cust-1', [{ eventId: 'evt-k1', seq: '1', at: '2026-09-21T01:00:00.000Z', eventType: 'ASSESSMENT_CREATED', payload: { assessmentId: 'a1' } }]);
      const b3 = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(b3.items, b2.items, '重放后聚合条目不变（去重）');

      // ⑤ 跨客户隔离（重启后）：cust-2 的记录不串入 cust-1
      assert.equal(b3.items.every((i) => i.customerId === 'cust-1'), true, '全部条目归属请求客户');
      assert.equal(b3.items.some((i) => i.activityId === 'model_receipt:amq:cust-2:v2-other'), false, '他客户回执不入列');

      // ⑥ 读取面零模型调用（重启前后全程）
      assertZeroModelCalls(a.received, '优雅重启全程');
    } finally {
      await slay(e2?.proc);
      await slay(e1?.proc);
      await a.close();
    }
  });
});

test('硬杀重启（模拟崩溃）：已提交 sqlite 线程与回执文件完好，ID/原始时间/actor 不变，kernel 经替身 A 复读', async () => {
  await withRunDir(async (runDir) => {
    const a = await startStandInA();
    let e1 = null; let e2 = null;
    try {
      const receiptsDir = path.join(runDir, 'mr');
      const messagesFile = path.join(runDir, 'thread', 'thread.sqlite');
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-1:v2-crash', at: '2026-09-21T04:00:00.000Z' }));
      a.addEvents('cust-1', [{ eventId: 'evt-cr1', seq: '1', at: '2026-09-21T03:30:00.000Z', eventType: 'X', payload: {} }]);

      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s1 = await exchange(e1.port, 'cred-biz-t1');
      for (const [i, aud] of [['1', 'customer'], ['2', 'internal']]) {
        assert.equal((await sendMessage(e1.port, 'cust-1', s1, { requestId: `cr-${i}`, audience: aud, text: `崩溃前消息${i}` })).status, 200);
      }
      const before = await activityJson(e1.port, 'cust-1', s1);
      assert.equal(before.items.length, 4, '重启前：1 kernel + 2 thread + 1 receipt');
      await e1.hardKill(); // TerminateProcess：无优雅关停、无 checkpoint 机会（WAL+synchronous=FULL 兜底）

      e2 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s2 = await exchange(e2.port, 'cred-biz-t1');
      const after = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(after, before, '硬杀后整页逐字段恢复（已提交记录零丢失、ID/时间/actor 不变）');
      assertZeroModelCalls(a.received, '硬杀重启全程');
    } finally {
      await slay(e2?.proc);
      await slay(e1?.proc);
      await a.close();
    }
  });
});

test('重启后缺失/裁剪明确：保留窗口裁剪过期游标 truncated+retentionBase；损坏回执跳过并计数；纯 claim 不入列；旧格式回执 unknown', async () => {
  await withRunDir(async (runDir) => {
    const a = await startStandInA();
    let e1 = null; let e2 = null;
    try {
      const receiptsDir = path.join(runDir, 'mr');
      const messagesFile = path.join(runDir, 'thread', 'thread.sqlite');
      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile, maxPerCustomer: 3 });
      const s1 = await exchange(e1.port, 'cred-biz-t1');
      for (const i of [1, 2, 3]) {
        assert.equal((await sendMessage(e1.port, 'cust-1', s1, { requestId: `tr-${i}`, audience: 'customer', text: `裁剪前${i}` })).status, 200);
      }
      // 进程#1 内的旧游标：thread=1（limit=1 首条）
      const staleCursor = (await activityJson(e1.port, 'cust-1', s1, 'limit=1&sources=thread')).nextCursor;
      assert.equal(typeof staleCursor, 'string');
      assert.equal(await e1.shutdown(), 0);

      // 重启后：继续追加触发物理裁剪；同时投入损坏回执 / 纯 claim / 旧格式（缺 phase）回执
      e2 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile, maxPerCustomer: 3 });
      const s2 = await exchange(e2.port, 'cred-biz-t1');
      for (const i of [4, 5]) {
        assert.equal((await sendMessage(e2.port, 'cust-1', s2, { requestId: `tr-${i}`, audience: 'customer', text: `裁剪后${i}` })).status, 200);
      }
      await fs.mkdir(path.join(receiptsDir, 'receipts'), { recursive: true });
      await fs.writeFile(path.join(receiptsDir, 'receipts', 'broken.json'), 'not-json{{{');
      await fs.writeFile(path.join(receiptsDir, 'receipts', encodeURIComponent('amq:cust-1:v2-claimonly') + '.claim'), 'x');
      await writeReceipt(receiptsDir, {
        requestId: 'amq:cust-1:v2-oldfmt', customerId: 'cust-1', tenantId: 't1', assistant: 'credit',
        contextVersion: 'v1', receiptVersion: 1, at: '2026-09-21T05:30:00.000Z', // 旧格式：无 phase 字段
      });

      const b = await activityJson(e2.port, 'cust-1', s2, `cursor=${encodeURIComponent(staleCursor)}`);
      assert.equal(b.ok, true, '过期游标不 500：可续读，缺失区段显式提示');
      const th = b.sources.find((s) => s.source === 'thread');
      assert.equal(th.truncated, true, '裁剪显式披露');
      assert.equal(th.retentionBase, 2, 'retentionBase=2（seq≤2 已物理裁剪）');
      assert.deepEqual(b.items.filter((i) => i.source === 'thread').map((i) => i.refs.seq), ['3', '4', '5'], '从保留窗口起如实续读');
      const mr = b.sources.find((s) => s.source === 'model_receipt');
      assert.equal(typeof mr.note, 'string', '损坏回执计数披露存在');
      assert.equal(mr.note.includes('1'), true, '损坏回执计数如实披露');
      assert.equal(b.items.some((i) => i.activityId.includes('claimonly')), false, '纯 claim 残留不入列');
      const oldfmt = b.items.find((i) => i.activityId === 'model_receipt:amq:cust-1:v2-oldfmt');
      assert.notEqual(oldfmt, undefined);
      assert.equal(oldfmt.state, 'unknown', '旧格式（缺 phase）回执 → unknown，绝不伪装 completed');

      const b2 = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(b2.items, b.items, '全量读与游标续读一致（裁剪语义刷新稳定）');
      assertZeroModelCalls(a.received, '裁剪披露全程');
    } finally {
      await slay(e2?.proc);
      await slay(e1?.proc);
      await a.close();
    }
  });
});

test('重启后越权面：跨客户 404、客户受众强制排除内部消息与模型回执（显式点名 403）、翻页中撤权 403', async () => {
  await withRunDir(async (runDir) => {
    const a = await startStandInA();
    let e1 = null; let e2 = null;
    try {
      const receiptsDir = path.join(runDir, 'mr');
      const messagesFile = path.join(runDir, 'thread', 'thread.sqlite');
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-2:v2-leak', customerId: 'cust-2', at: '2026-09-21T07:00:00.000Z' }));
      a.addEvents('cust-2', [{ eventId: 'c2-1', seq: '1', at: '2026-09-21T07:00:00.000Z', eventType: 'C2_ONLY', payload: {} }]);
      a.addEvents('cust-1', [
        { eventId: 'c1-1', seq: '1', at: '2026-09-21T07:01:00.000Z', eventType: 'A', payload: {} },
        { eventId: 'c1-2', seq: '2', at: '2026-09-21T07:02:00.000Z', eventType: 'B', payload: {} },
      ]);

      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const sbiz1 = await exchange(e1.port, 'cred-biz-t1');
      assert.equal((await sendMessage(e1.port, 'cust-1', sbiz1, { requestId: 'az-i', audience: 'internal', text: '内部协作' })).status, 200);
      assert.equal((await sendMessage(e1.port, 'cust-1', sbiz1, { requestId: 'az-c', audience: 'customer', text: '对客户可见' })).status, 200);
      const p1 = await activityJson(e1.port, 'cust-1', sbiz1, 'limit=1&sources=kernel');
      assert.equal(await e1.shutdown(), 0);

      e2 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const sbiz = await exchange(e2.port, 'cred-biz-t1');
      const scust = await exchange(e2.port, 'cred-cust-c1');

      // 客户联系人：内部消息不可见；model_receipt 排除显式披露；显式点名 → 403
      const bc = await activityJson(e2.port, 'cust-1', scust);
      assert.equal(bc.ok, true);
      assert.equal(bc.items.some((i) => i.source === 'thread' && i.refs.audience === 'internal'), false, '内部消息不进客户视图');
      assert.equal(bc.items.some((i) => i.source === 'thread' && i.requestId === 'az-c'), true, 'customer 受众消息可见');
      const srcMap = Object.fromEntries(bc.sources.map((s) => [s.source, s]));
      assert.equal(srcMap.model_receipt.available, false);
      assert.equal(srcMap.model_receipt.reason, 'AUDIENCE_FORBIDDEN');
      assert.equal(srcMap.model_receipt.excludedByAudience, true, '排除显式披露，不静默');
      assert.equal((await activityGet(e2.port, 'cust-1', scust, 'audience=internal')).status, 403);
      assert.equal((await activityGet(e2.port, 'cust-1', scust, 'sources=model_receipt')).status, 403);

      // 跨客户：A 逐请求裁决，存在性不泄露
      assert.equal((await activityGet(e2.port, 'cust-2', scust)).status, 404, '客户读未授权客户 → 404');
      assert.equal((await activityGet(e2.port, 'cust-3', sbiz)).status, 404, '业务读他租户客户 → 404');
      const bb = await activityJson(e2.port, 'cust-1', sbiz);
      assert.equal(bb.items.every((i) => i.customerId === 'cust-1'), true, 'cust-2 的事件/回执不串入 cust-1');

      // 翻页中撤权（重启后的后续页同样逐请求重验）
      a.state.revoked.add('cred-biz-t1');
      const p2 = await activityGet(e2.port, 'cust-1', sbiz, `limit=1&sources=kernel&cursor=${encodeURIComponent(p1.nextCursor)}`);
      assert.equal(p2.status, 403, '撤权后借进程#1 游标续读 → 403');
      assert.equal((await p2.json()).error, 'PERMISSION_DENIED');
      a.state.revoked.delete('cred-biz-t1');
      assert.equal((await activityJson(e2.port, 'cust-1', sbiz, `limit=1&sources=kernel&cursor=${encodeURIComponent(p1.nextCursor)}`)).ok, true, '恢复授权后同游标可读');
      assertZeroModelCalls(a.received, '越权面全程');
    } finally {
      await slay(e2?.proc);
      await slay(e1?.proc);
      await a.close();
    }
  });
});

test('旧格式库迁移重启：R2-01 之前老 schema + 旧无作用域回执 → 线程记录完好可读；旧回执重放失败关闭 409 零重发；迁移跨重启持久', async () => {
  await withRunDir(async (runDir) => {
    const a = await startStandInA();
    let e1 = null; let e2 = null;
    try {
      const receiptsDir = path.join(runDir, 'mr');
      const messagesFile = path.join(runDir, 'thread', 'thread.sqlite');
      // 手工构造 R2-01 集成之前的旧格式库（老 message_receipts 无作用域/状态列；合成文件，边界见报告）：
      // 1 条线程消息 + 1 条旧无作用域 terminal 回执（老响应体形状）。
      await fs.mkdir(path.dirname(messagesFile), { recursive: true });
      const db = new DatabaseSync(messagesFile);
      db.exec(`
        CREATE TABLE messages (customer_id TEXT NOT NULL, seq INTEGER NOT NULL, message_id TEXT NOT NULL UNIQUE,
          audience TEXT NOT NULL, text TEXT NOT NULL, request_id TEXT NOT NULL, sender_principal_id TEXT NOT NULL,
          sender_roles TEXT NOT NULL, thread_id TEXT, at TEXT NOT NULL, PRIMARY KEY (customer_id, seq));
        CREATE TABLE thread_state (customer_id TEXT PRIMARY KEY, base INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
        CREATE TABLE message_receipts (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response_json TEXT NOT NULL,
          customer_id TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_receipts_created ON message_receipts (created_at);
      `);
      db.prepare(`INSERT INTO messages (customer_id, seq, message_id, audience, text, request_id, sender_principal_id, sender_roles, thread_id, at)
        VALUES ('cust-1', 1, 'msg-legacy', 'customer', '旧库消息', 'legacy-1', 'p-biz-t1', '["business"]', NULL, '2026-09-21T09:00:00.000Z')`).run();
      const legacyBody = { ok: true, requestId: 'legacy-1', audience: 'customer', delivery: { messageId: 'fx-legacy', state: 'sent_local_sink' }, note: '送达未知时不标已读；客户端以服务端状态为准' };
      db.prepare(`INSERT INTO message_receipts (request_id, fingerprint, response_json, customer_id, created_at)
        VALUES ('legacy-1', ?, ?, 'cust-1', '2026-09-21T09:00:00.000Z')`)
        .run(JSON.stringify({ audience: 'customer', text: '旧库消息', threadId: null, internalContent: false }), JSON.stringify(legacyBody));
      db.close();

      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s1 = await exchange(e1.port, 'cred-biz-t1');
      const b1 = await activityJson(e1.port, 'cust-1', s1);
      const th = b1.items.find((i) => i.activityId === 'thread:msg-legacy');
      assert.notEqual(th, undefined, '旧库线程消息迁移后可读');
      assert.equal(th.occurredAt, '2026-09-21T09:00:00.000Z', '原始时间不变');
      assert.deepEqual(th.actor, { principalId: 'p-biz-t1', roles: ['business'], trusted: true }, 'actor 不变');
      assert.equal(th.delivery.state, 'sent_local_sink', '旧回执的投递态仍如实呈现（存储读取）');

      // 旧无作用域回执重放：失败关闭 409，零二次发送（threadStore 只在投递成功后入栈 → 条目不变）
      const replay = await sendMessage(e1.port, 'cust-1', s1, { requestId: 'legacy-1', audience: 'customer', text: '旧库消息' });
      assert.equal(replay.status, 409, '旧无作用域回执重放 → 409 失败关闭');
      assert.equal((await replay.json()).error, 'REQUEST_ID_CONFLICT');
      const b2 = await activityJson(e1.port, 'cust-1', s1);
      assert.equal(b2.items.filter((i) => i.source === 'thread').length, 1, '重放未产生新线程条目（零二次发送）');

      // 迁移后新写入可用（新作用域回执），再经第二次重启验证迁移与数据均持久
      assert.equal((await sendMessage(e1.port, 'cust-1', s1, { requestId: 'post-mig-1', audience: 'customer', text: '迁移后新消息' })).status, 200);
      const b2b = await activityJson(e1.port, 'cust-1', s1); // 重启前基线（含迁移期新消息）
      assert.equal(await e1.shutdown(), 0);
      e2 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s2 = await exchange(e2.port, 'cred-biz-t1');
      const b3 = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(b3.items.map((i) => i.activityId), b2b.items.map((i) => i.activityId), '二次重启后条目集合不变（含迁移期新消息）');
      const again = await sendMessage(e2.port, 'cust-1', s2, { requestId: 'post-mig-1', audience: 'customer', text: '迁移后新消息' });
      assert.equal((await again.json()).replayed, true, '迁移期新回执跨重启仍幂等重放');
      const b4 = await activityJson(e2.port, 'cust-1', s2);
      assert.deepEqual(b4.items, b3.items, '重放后条目不变');
      assertZeroModelCalls(a.received, '旧格式库迁移全程');
    } finally {
      await slay(e2?.proc);
      await slay(e1?.proc);
      await a.close();
    }
  });
});

test('负例：events 源断连单源 incomplete 不拖垮整页；A 全断连 502 失败关闭；缺失路径不崩溃；非法/旧格式游标 400', async () => {
  await withRunDir(async (runDir) => {
    let e1 = null; let e2 = null; let e3 = null;
    let a = null; let a3 = null;
    try {
      // --- events 端点断连：customer 校验通、事件源 503 → 单源 incomplete，其余源照常 ---
      a = await startStandInA();
      const receiptsDir = path.join(runDir, 'mr-a');
      const messagesFile = path.join(runDir, 'thread-a', 'thread.sqlite');
      await writeReceipt(receiptsDir, terminalReceipt({ requestId: 'amq:cust-1:v2-dc', at: '2026-09-21T08:00:00.000Z' }));
      e1 = await forkEdge({ runDir, upstreamPort: a.port, receiptsDir, messagesFile });
      const s1 = await exchange(e1.port, 'cred-biz-t1');
      assert.equal((await sendMessage(e1.port, 'cust-1', s1, { requestId: 'dc-1', audience: 'customer', text: '断连前消息' })).status, 200);
      a.addEvents('cust-1', [{ eventId: 'dc-k1', seq: '1', at: '2026-09-21T08:05:00.000Z', eventType: 'DC', payload: {} }]);

      a.state.failEvents = true; // 模拟 A 事件源故障（customer 端点正常）
      const bd = await activityJson(e1.port, 'cust-1', s1);
      assert.equal(bd.ok, true, '单源失败不拖垮整页');
      assert.equal(bd.items.some((i) => i.source === 'kernel'), false);
      assert.equal(bd.items.some((i) => i.source === 'thread'), true, 'thread 照常返回');
      assert.equal(bd.items.some((i) => i.source === 'model_receipt'), true, '回执照常返回');
      assert.equal(bd.incomplete.length, 1, '失败如实列示，不伪装空页');
      assert.equal(bd.incomplete[0].source, 'kernel');
      assert.equal(bd.incomplete[0].code, 'EVENTS_SOURCE_DOWN', '上游错误码原样保留');
      assert.equal(bd.sources.find((s) => s.source === 'kernel').available, false);
      a.state.failEvents = false; // 恢复：同进程立即恢复可读
      const br = await activityJson(e1.port, 'cust-1', s1);
      assert.equal(br.items.some((i) => i.source === 'kernel'), true, '断连恢复后 kernel 源恢复');
      assert.equal(await e1.shutdown(), 0);
      await a.close();
      a = null;

      // --- A 全断连（重启后指向已关闭端口）：目标校验失败关闭，整请求 502，不返回活动 ---
      const a2 = await startStandInA();
      const deadPort = a2.port; // 先借端口号再关停，构造确定性"不可达"
      await a2.close();
      e2 = await forkEdge({
        runDir, upstreamPort: deadPort, receiptsDir: path.join(runDir, 'mr-b'), messagesFile: path.join(runDir, 'thread-b', 'thread.sqlite'),
      });
      const s2 = await exchange(e2.port, 'cred-biz-t1');
      const r = await activityGet(e2.port, 'cust-1', s2);
      assert.equal(r.status, 502, 'A 不可达：目标校验失败关闭（不静默返回纯本地数据）');
      assert.equal((await r.json()).error, 'UPSTREAM_UNAVAILABLE');
      await slay(e2.proc);
      e2 = null;

      // --- 缺失路径：回执目录不存在 → 空集不崩溃；消息文件目录不存在 → 自动创建可用 ---
      a3 = await startStandInA();
      e3 = await forkEdge({
        runDir, upstreamPort: a3.port, receiptsDir: path.join(runDir, 'no-such-receipts'),
        messagesFile: path.join(runDir, 'no-such-dir', 'thread.sqlite'),
      });
      const s3 = await exchange(e3.port, 'cred-biz-t1');
      const b3 = await activityJson(e3.port, 'cust-1', s3);
      assert.equal(b3.ok, true, '缺失回执路径不崩溃');
      assert.equal(b3.items.filter((i) => i.source === 'model_receipt').length, 0, '缺失路径 → 空集（读取面把 ENOENT 视作空目录，如实记录）');
      assert.equal((await sendMessage(e3.port, 'cust-1', s3, { requestId: 'mp-1', audience: 'customer', text: '缺失路径消息' })).status, 200, '消息文件目录自动创建');
      const b4 = await activityJson(e3.port, 'cust-1', s3);
      assert.equal(b4.items.some((i) => i.requestId === 'mp-1'), true);

      // --- 非法/旧格式游标 → 400 INVALID_CURSOR，不静默重置 ---
      const badCursors = [
        'garbage!!', 'thread=12',
        Buffer.from(JSON.stringify({ v: 9, c: {} })).toString('base64url'),
        Buffer.from(JSON.stringify({ v: 0, c: { thread: '1' } })).toString('base64url'),
        Buffer.from(JSON.stringify({ v: 1 })).toString('base64url'),
        Buffer.from(JSON.stringify({ v: 1, c: { nosuch: '1' } })).toString('base64url'),
        Buffer.from(JSON.stringify({ v: 1, c: { thread: 12 } })).toString('base64url'),
        encodeActivityCursor({ thread: 'abc' }),
        encodeActivityCursor({ kernel: '1;DROP' }),
        encodeActivityCursor({ model_receipt: 'no-sep' }),
      ];
      for (const bad of badCursors) {
        const badRes = await activityGet(e3.port, 'cust-1', s3, `cursor=${encodeURIComponent(bad)}`);
        assert.equal(badRes.status, 400, `非法/旧格式游标应 400：${bad.slice(0, 24)}`);
        assert.equal((await badRes.json()).error, 'INVALID_CURSOR');
      }
      assertZeroModelCalls(a3.received, '缺失路径与游标负例全程');
    } finally {
      await slay(e3?.proc);
      await slay(e2?.proc);
      await slay(e1?.proc);
      if (a) await a.close();
      if (a3) await a3.close();
    }
  });
});
