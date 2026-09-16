import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const processProblems = [];

function handleUnhandledRejection(reason) {
  processProblems.push({ kind: 'unhandledRejection', reason });
}

function handleUncaughtException(reason) {
  processProblems.push({ kind: 'uncaughtException', reason });
}

before(() => {
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);
});

after(async () => {
  await delay(20);
  process.off('unhandledRejection', handleUnhandledRejection);
  process.off('uncaughtException', handleUncaughtException);
  assert.deepEqual(processProblems, []);
});

test('body timeout cancels and releases when cleanup never settles', async () => {
  await assertTimeoutWithCleanup(() => new Promise(() => {}));
});

test('body timeout cancels and releases when cleanup rejects', async () => {
  await assertTimeoutWithCleanup(() => Promise.reject(new Error('cleanup failed')));
});

test('a rejected reader read propagates and releases its lock', async () => {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  const readError = new Error('client read interrupted');
  readError.name = 'ClientReadInterrupt';
  let cancelCalls = 0;
  const stream = new ReadableStream({
    start() {},
    pull(controller) {
      controller.error(readError);
    },
    cancel() {
      cancelCalls += 1;
    },
  });
  const request = createRequestBody(stream);

  const startedAt = performance.now();
  const outcome = await rejectWithin(readBoundedJsonBody(request), 75);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(outcome.settled, 'rejected');
  assert.equal(outcome.error, readError);
  assert.equal(request.body.locked, false);
  assert.equal(cancelCalls, 0);
  assert.ok(elapsedMs < 75, `client read rejection took ${elapsedMs}ms`);
});

async function assertTimeoutWithCleanup(cancelImplementation) {
  const { readBoundedJsonBody } = await import('../lib/bounded-json-body.ts');
  let cancelCalls = 0;
  const stream = new ReadableStream({
    start() {},
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelCalls += 1;
      return cancelImplementation();
    },
  });
  const request = createRequestBody(stream);

  const startedAt = performance.now();
  const outcome = await rejectWithin(
    readBoundedJsonBody(request, 16 * 1024, 8),
    75,
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(outcome.settled, 'rejected');
  assert.equal(outcome.error?.code, 'REQUEST_BODY_TIMEOUT');
  assert.equal(cancelCalls, 1);
  assert.equal(request.body.locked, false);
  assert.ok(elapsedMs < 75, `body timeout took ${elapsedMs}ms`);
}

function createRequestBody(stream) {
  return new Request('http://local.test/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
}

async function rejectWithin(promise, limitMs) {
  let timer;
  const observed = promise.then(
    () => ({ settled: 'resolved', error: undefined }),
    (error) => ({ settled: 'rejected', error }),
  );
  try {
    return await Promise.race([
      observed,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ settled: 'pending' }), limitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
