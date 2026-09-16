import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import test from 'node:test';

const KEY_NAME = 'JIANWEI_MODEL_API_KEY';
const MODEL_NAME = 'JIANWEI_MODEL_NAME';
const OFFLINE_KEY = 'offline-test-placeholder';

async function runOffline(action, { configured = true } = {}) {
  const hadKey = Object.hasOwn(process.env, KEY_NAME);
  const originalKey = process.env[KEY_NAME];
  const originalModel = process.env[MODEL_NAME];
  const originalFetch = globalThis.fetch;
  if (configured) process.env[KEY_NAME] = OFFLINE_KEY;
  else delete process.env[KEY_NAME];
  process.env[MODEL_NAME] = 'offline-test-model';
  try {
    return await action();
  } finally {
    if (hadKey) process.env[KEY_NAME] = originalKey;
    else delete process.env[KEY_NAME];
    if (originalModel === undefined) delete process.env[MODEL_NAME];
    else process.env[MODEL_NAME] = originalModel;
    globalThis.fetch = originalFetch;
  }
}

test('missing product credential fails closed without attempting network', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      return new Response('{}');
    };
    await assert.rejects(
      completeProductCandidate({ message: '问题', context: offlineContext() }),
      { code: 'MODEL_NOT_CONFIGURED' },
    );
    assert.equal(networkCalls, 0);
  }, { configured: false });
});

test('live adapter trims non-empty answer and does not retain caller context mutation', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    const context = offlineContext();
    globalThis.fetch = async (_input, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, `Bearer ${OFFLINE_KEY}`);
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'offline-test-model');
      assert.equal(request.stream, false);
      const packet = JSON.parse(request.messages[1].content).contextPacket;
      packet.confirmedFacts.push('污染');
      packet.evidenceGaps.push('污染');
      return Response.json({ choices: [{ message: { content: '  候选答案  ' } }] });
    };
    const result = await completeProductCandidate({ message: '问题', context });
    assert.equal(result.answer, '候选答案');
    assert.equal(result.model, 'offline-test-model');
    assert.deepEqual(context.confirmedFacts, ['已确认事实']);
    assert.deepEqual(context.evidenceGaps, ['待补充证据']);
  });
});

test('non-2xx responses map 504 to timeout and other statuses to failure', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    const context = offlineContext();
    for (const [status, expected] of [[504, 'ADAPTER_TIMEOUT'], [408, 'ADAPTER_TIMEOUT'], [500, 'ADAPTER_FAILURE']]) {
      globalThis.fetch = async () => new Response('adapter offline', { status });
      await assert.rejects(
        completeProductCandidate({ message: '问题', context }),
        { code: expected },
      );
    }
  });
});

test('invalid JSON and empty content fail closed as adapter failures', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    const context = offlineContext();
    globalThis.fetch = async () => new Response('{not-json', { status: 200 });
    await assert.rejects(completeProductCandidate({ message: 'invalid-json', context }), { code: 'ADAPTER_FAILURE' });
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '   ' } }] });
    await assert.rejects(completeProductCandidate({ message: 'empty-content', context }), { code: 'ADAPTER_FAILURE' });
  });
});

test('timeout aborts the request and clears its timer', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    let requestSignal;
    mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.fetch = async (_input, init) => {
      requestSignal = init.signal;
      return new Promise((resolve, reject) => {
        if (requestSignal.aborted) rejectTimeout(reject);
        requestSignal.addEventListener('abort', () => rejectTimeout(reject), { once: true });
      });
    };
    const pending = completeProductCandidate({ message: '问题', context: offlineContext() });
    try {
      mock.timers.tick(25_000);
      await assert.rejects(pending, { code: 'ADAPTER_TIMEOUT' });
      assert.equal(requestSignal.aborted, true);
    } finally {
      mock.timers.reset();
    }
  });
});

test('a completed request clears its timeout resource', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerToken = { id: 'offline-timer' };
    let clearedToken;
    try {
      globalThis.setTimeout = (_callback, milliseconds) => {
        assert.equal(milliseconds, 25_000);
        return timerToken;
      };
      globalThis.clearTimeout = (token) => {
        clearedToken = token;
      };
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '候选答案' } }] });
      await completeProductCandidate({ message: '问题', context: offlineContext() });
      assert.equal(clearedToken, timerToken);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('the deadline remains active while a successful response body is still pending', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timerToken = { id: 'body-deadline' };
    let deadlineCallback;
    let clearedToken;
    let requestSignal;
    let bodyCancelled = false;
    try {
      globalThis.setTimeout = (callback, milliseconds) => {
        assert.equal(milliseconds, 25_000);
        deadlineCallback = callback;
        return timerToken;
      };
      globalThis.clearTimeout = (token) => {
        clearedToken = token;
      };
      globalThis.fetch = async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
          body: { cancel: async () => { bodyCancelled = true; } },
        };
      };
      const pending = completeProductCandidate({ message: '问题', context: offlineContext() });
      await Promise.resolve();
      deadlineCallback();
      await assert.rejects(pending, { code: 'ADAPTER_TIMEOUT' });
      assert.equal(requestSignal.aborted, true);
      assert.equal(bodyCancelled, true);
      assert.equal(clearedToken, timerToken);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('messages route keeps object/string validation and stable fail-closed mapping', async () => {
  const source = await readFile(
    new URL('../app/api/cases/[caseId]/messages/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /typeof body !== 'object' \|\| Array\.isArray\(body\)/);
  assert.match(source, /raw\.message, raw\.requestId, raw\.stageId, raw\.flowId\]\.some\(\(value\) => typeof value !== 'string'\)/);
  assert.match(source, /INVALID_JSON[\s\S]*IDEMPOTENCY_CONFLICT[\s\S]*ADAPTER_TIMEOUT[\s\S]*ADAPTER_FAILURE/);
  assert.match(source, /readBoundedJsonBody/);
  assert.match(source, /REQUEST_BODY_TOO_LARGE[\s\S]*413/);
  assert.doesNotMatch(source, /ZAI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
});

test('bounded JSON reader rejects declared and chunked oversized bodies before parsing', async () => {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  const declared = new Request('http://local.test/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(16 * 1024 + 1) },
    body: '{}',
  });
  await assert.rejects(readBoundedJsonBody(declared), { code: 'REQUEST_BODY_TOO_LARGE' });

  let cancelled = false;
  const chunked = new Request('http://local.test/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
    duplex: 'half',
  });
  await assert.rejects(readBoundedJsonBody(chunked), { code: 'REQUEST_BODY_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('oversized chunked body rejects promptly when cancellation never settles and releases its lock', async () => {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  let cancelCalled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16 * 1024 + 1));
    },
    cancel() {
      cancelCalled = true;
      return new Promise(() => {});
    },
  });
  const request = new Request('http://local.test/messages', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  });
  const outcome = await settleWithin(readBoundedJsonBody(request));
  assert.deepEqual(outcome, { settled: 'rejected', code: 'REQUEST_BODY_TOO_LARGE' });
  assert.equal(cancelCalled, true);
  assert.equal(request.body.locked, false);
});

test('declared oversized body cancellation cannot delay or replace the 413 error', async () => {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  for (const [label, cancelResult] of [
    ['never', () => new Promise(() => {})],
    ['reject', () => Promise.reject(new Error('cleanup failed'))],
  ]) {
    let cancelCalled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
      },
      cancel() {
        cancelCalled = true;
        return cancelResult();
      },
    });
    const request = new Request(`http://local.test/messages?case=${label}`, {
      method: 'POST',
      headers: { 'content-length': String(16 * 1024 + 1) },
      body: stream,
      duplex: 'half',
    });
    assert.deepEqual(
      await settleWithin(readBoundedJsonBody(request)),
      { settled: 'rejected', code: 'REQUEST_BODY_TOO_LARGE' },
    );
    assert.equal(cancelCalled, true);
  }
  await Promise.resolve();
});

test('bounded JSON reader preserves normal JSON, invalid JSON and 600-character messages', async () => {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  const message = '甲'.repeat(600);
  const payload = { message, requestId: 'bounded-normal', stageId: 'policy', flowId: 'policy-material' };
  const normal = new Request('http://local.test/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.deepEqual(await readBoundedJsonBody(normal), payload);

  const invalid = new Request('http://local.test/messages', { method: 'POST', body: '{' });
  await assert.rejects(readBoundedJsonBody(invalid), SyntaxError);
});

function offlineContext() {
  return {
    caseId: 'FL-DEMO-001',
    caseTitle: '离线稳定性上下文',
    contextVersion: 'CTX-OFFLINE',
    evidenceEventId: 'evidence-offline',
    stageId: 'credit',
    stageLabel: '信审',
    flowId: 'credit-review',
    flowLabel: '人工复核',
    from: '前序候选',
    previousResult: '前序候选',
    ruleVersion: 'OFFLINE-RULES-v1',
    confirmedFacts: ['已确认事实'],
    evidenceGaps: ['待补充证据'],
    automatedWork: ['候选整理'],
    humanDecision: '具名人工复核',
    handoffTo: '商务接续',
  };
}

function rejectTimeout(reject) {
  const error = new Error('offline timeout');
  error.name = 'TimeoutError';
  reject(error);
}

async function settleWithin(promise) {
  return Promise.race([
    promise.then(
      () => ({ settled: 'resolved' }),
      (error) => ({ settled: 'rejected', code: error?.code }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ settled: 'sentinel_pending' }), 75)),
  ]);
}
