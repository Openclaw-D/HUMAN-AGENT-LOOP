// V4-LIFE 事件流 SSE 端点测试（契约 §10 / §12；进程内读流，node --test）。
// 直接 import route handler GET，以 new Request（带 AbortController signal）+ { params: Promise }
// 进程内调用；不启动网络服务、不发起真实网络请求。
//
// 挂死防护：
//   - 每个测试设置 node:test timeout；每次 readFrame 用超时竞争，流不产出即抛错而非永久等待；
//   - 每个流式测试 finally 中 abort 控制器，保证路由清理定时器并 close，测试进程正常退出（无泄漏）。

import assert from 'node:assert/strict';
import test from 'node:test';

import { V4LIFE_DEMO_CASE_ID, getOrCreateV4LifeDemoEngine, resetV4LifeRuntime } from '../lib/v4life/runtime.ts';
import { GET as getEventStream } from '../app/api/v4life/cases/[caseId]/events/stream/route.ts';

const CASE = V4LIFE_DEMO_CASE_ID;
const READ_TIMEOUT_MS = 3000;
const TEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// SSE 进程内读流辅助
// ---------------------------------------------------------------------------

class SseReader {
  constructor(response) {
    this.reader = response.body.getReader();
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.done = false;
  }

  /** 底层读一个 chunk；done 返回 null；超过 timeoutMs 未产出抛错（防止测试挂死）。 */
  async readChunk(timeoutMs = READ_TIMEOUT_MS) {
    if (this.done) {
      return null;
    }
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const readPromise = this.reader.read();
    readPromise.catch(() => {}); // 竞速败者的 rejection（如 abort 触发的流错误）不成为 unhandled
    const settled = await Promise.race([readPromise, timeoutPromise]);
    clearTimeout(timer);
    if (settled !== undefined && settled.timedOut === true) {
      throw new Error(`SSE 读流超时（>${timeoutMs}ms）：未在限定时间内收到流数据`);
    }
    if (settled.done) {
      this.done = true;
      return null;
    }
    return settled.value;
  }

  /** 读下一条完整 SSE 帧（以空行 \n\n 分隔）；流终止返回 null（残留不足一帧时丢弃）。 */
  async nextFrame(timeoutMs = READ_TIMEOUT_MS) {
    let index = this.buffer.indexOf('\n\n');
    while (index === -1) {
      const chunk = await this.readChunk(timeoutMs);
      if (chunk === null) {
        this.buffer = '';
        return null;
      }
      this.buffer += this.decoder.decode(chunk, { stream: true });
      index = this.buffer.indexOf('\n\n');
    }
    const frame = this.buffer.slice(0, index);
    this.buffer = this.buffer.slice(index + 2);
    return frame;
  }
}

/** 校验帧格式 `id: <seq>\ndata: <JSON>` 完整两行，解析出 seq 与事件对象。 */
function parseEventFrame(frame) {
  const match = /^id: (\d+)\ndata: (.+)$/.exec(frame);
  assert.ok(match, `帧必须是完整的 id: + data: 两行，实际：${JSON.stringify(frame)}`);
  const event = JSON.parse(match[2]);
  assert.equal(Number(match[1]), event.seq, 'id 行必须等于事件 seq');
  return event;
}

/** 打开 SSE 流（进程内调用 route handler），返回 response 与 abort 句柄。 */
async function openStream(caseId, { afterSeq } = {}) {
  const controller = new AbortController();
  const query = afterSeq === undefined ? '' : `?afterSeq=${afterSeq}`;
  const response = await getEventStream(
    new Request(`http://localhost/api/v4life/cases/${caseId}/events/stream${query}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    }),
    { params: Promise.resolve({ caseId }) },
  );
  return { response, controller };
}

let evidenceCounter = 0;

/** 合成财务证据命令（expectedRev 取当前引擎 rev，保证 accepted）。 */
function evidenceCommand(overrides = {}) {
  evidenceCounter += 1;
  return {
    commandId: `cmd-stream-ev-${evidenceCounter}`,
    expectedRev: getOrCreateV4LifeDemoEngine().rev,
    evidenceId: `ev-stream-synthetic-${evidenceCounter}`,
    kind: 'financial_statement',
    title: `SSE 推送联测合成证据 ${evidenceCounter}`,
    submittedBy: 'actor-business-chen',
    payload: {
      summary: '大屏 live 镜像联测用的合成财务证据摘要。',
      tags: ['synthetic'],
      amountCny: 1_000,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ① 响应头
// ---------------------------------------------------------------------------

test('GET events/stream：200 且 content-type / cache-control 头正确', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const { response, controller } = await openStream(CASE);
  try {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store', 'no-store 是规避 vinext 生产 ISR 缓冲的关键头');
  } finally {
    controller.abort();
  }
});

// ---------------------------------------------------------------------------
// ② 404 路径（流开始之前）
// ---------------------------------------------------------------------------

test('GET events/stream：未注册 caseId → 404 CASE_NOT_FOUND JSON（不开始流）', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const { response, controller } = await openStream('no-such-case');
  try {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), { error: 'CASE_NOT_FOUND' });
  } finally {
    controller.abort();
  }
});

test('GET events/stream：非法 afterSeq → 400 INVALID_ENGINE_INPUT JSON', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  for (const query of ['?afterSeq=-1', '?afterSeq=abc', '?afterSeq=1.5', '?afterSeq=']) {
    const controller = new AbortController();
    const response = await getEventStream(
      new Request(`http://localhost/api/v4life/cases/${CASE}/events/stream${query}`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      }),
      { params: Promise.resolve({ caseId: CASE }) },
    );
    try {
      assert.equal(response.status, 400, `query=${query} 应返回 400`);
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.deepEqual(await response.json(), { error: 'INVALID_ENGINE_INPUT' });
    } finally {
      controller.abort();
    }
  }
});

// ---------------------------------------------------------------------------
// ③ 连接即回放既有事件
// ---------------------------------------------------------------------------

test('GET events/stream：连接即逐条回放既有事件帧（id/data 完整、seq 单调连续）', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const total = engine.rev;
  assert.ok(total >= 3, 'demo 初始化事件数应 ≥3');

  const { response, controller } = await openStream(CASE, { afterSeq: 0 });
  try {
    const sse = new SseReader(response);
    let lastSeq = 0;
    let count = 0;
    while (count < total) {
      const frame = await sse.nextFrame();
      assert.ok(frame !== null, `流提前结束：只读到 ${count}/${total} 帧`);
      const event = parseEventFrame(frame);
      assert.equal(event.seq, lastSeq + 1, '回放帧必须从 afterSeq 之后单调连续');
      assert.equal(typeof event.payload.type, 'string', 'data 必须是完整事件 JSON（含 payload.type）');
      lastSeq = event.seq;
      count += 1;
    }
    assert.equal(lastSeq, total, '回放应覆盖到引擎当前最新事件');
  } finally {
    controller.abort();
  }
});

test('GET events/stream：afterSeq 续传只回放该序号之后的帧', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const total = engine.rev;

  const { response, controller } = await openStream(CASE, { afterSeq: total - 1 });
  try {
    const sse = new SseReader(response);
    const event = parseEventFrame(await sse.nextFrame());
    assert.equal(event.seq, total, '只回放 afterSeq 之后那一条');
    // 给轮询窗口一点时间，确认没有多余帧后流保持空闲（此处仅验证无残留帧可立即读出——
    // 下一帧只有心跳/新事件，readChunk 超时抛错即证明不再回放旧事件）
    await assert.rejects(() => sse.nextFrame(300), (error) => /超时/.test(error.message));
  } finally {
    controller.abort();
  }
});

// ---------------------------------------------------------------------------
// ④ 连接后新事件在轮询窗口内推送
// ---------------------------------------------------------------------------

test('GET events/stream：连接后向引擎 append evidence，新事件帧在 500ms 轮询窗口内到达', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const tail = engine.rev;

  const { response, controller } = await openStream(CASE, { afterSeq: tail });
  try {
    const sse = new SseReader(response);
    const command = evidenceCommand();
    const result = engine.appendEvidence(command);
    assert.equal(result.status, 'accepted', '联测 evidence 命令必须被接受');
    const targetRev = engine.rev;
    assert.ok(targetRev > tail, 'append 后引擎 rev 必须推进');

    // 轮询间隔 500ms；读帧超时 3s 覆盖多个轮询窗口，超时即测试失败而非挂死
    const startedAt = Date.now();
    let lastSeq = tail;
    while (lastSeq < targetRev) {
      const frame = await sse.nextFrame();
      assert.ok(frame !== null, '流提前结束，未收到全部新事件帧');
      if (frame.startsWith(':')) {
        continue; // 心跳注释帧，跳过
      }
      const event = parseEventFrame(frame);
      assert.equal(event.seq, lastSeq + 1, '新事件帧必须按 seq 连续推送');
      lastSeq = event.seq;
    }
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < READ_TIMEOUT_MS, `新帧应在轮询窗口内到达（实际 ${elapsed}ms）`);
    assert.equal(lastSeq, targetRev, '最新事件必须推送到流上');
  } finally {
    controller.abort();
  }
});

// ---------------------------------------------------------------------------
// ⑤ abort 终止流、无泄漏
// ---------------------------------------------------------------------------

test('GET events/stream：request.signal abort 后流终止（最终 read 得 done），测试进程可正常退出', { timeout: TEST_TIMEOUT_MS }, async () => {
  resetV4LifeRuntime();
  const engine = getOrCreateV4LifeDemoEngine();
  const totalAtOpen = engine.rev;
  const { response, controller } = await openStream(CASE);
  const sse = new SseReader(response);

  const frame = await sse.nextFrame();
  assert.ok(frame !== null && frame.startsWith('id: '), 'abort 前流应有回放帧');

  controller.abort();
  // ReadableStream close 语义：close 前已入队的 chunk 仍会被读出，done 在队列排空后到达。
  // 关键断言：读必须在超时保护内终止（若清理失败、定时器仍在推送，nextFrame 会超时抛错），
  // 且残留帧只能是 abort 前已回放入队的旧事件，不得出现 abort 之后新推送的帧。
  let drained = 0;
  while (true) {
    const remaining = await sse.nextFrame();
    if (remaining === null) {
      break;
    }
    if (!remaining.startsWith(':')) {
      const event = parseEventFrame(remaining);
      assert.ok(event.seq <= totalAtOpen, `abort 后不得再推送新事件（收到 seq=${event.seq}）`);
    }
    drained += 1;
    assert.ok(drained < totalAtOpen + 10, '残留帧数量异常');
  }
  assert.ok(sse.done, '读流应进入 done 状态，无残留定时器阻塞性泄漏');
});
