import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const KEY_NAME = 'JIANWEI_MODEL_API_KEY';
const MODEL_NAME = 'JIANWEI_MODEL_NAME';
const OFFLINE_KEY = 'dummy-response-cap-key';
const OFFLINE_MODEL = 'offline-response-cap-model';
const MAX_RESPONSE_BYTES = 256 * 1024;
const RAW_RESPONSE_MARKER = 'OVERSIZE_RAW_RESPONSE_DO_NOT_LEAK';

const unhandledRejections = [];
function onUnhandledRejection(reason) {
  unhandledRejections.push(reason);
}
process.on('unhandledRejection', onUnhandledRejection);

after(() => {
  process.off('unhandledRejection', onUnhandledRejection);
  assert.deepEqual(unhandledRejections, []);
});

async function runOffline(action) {
  const hadKey = Object.hasOwn(process.env, KEY_NAME);
  const originalKey = process.env[KEY_NAME];
  const originalModel = process.env[MODEL_NAME];
  const originalFetch = globalThis.fetch;

  process.env[KEY_NAME] = OFFLINE_KEY;
  process.env[MODEL_NAME] = OFFLINE_MODEL;
  globalThis.fetch = async () => {
    throw new Error('offline test did not install its fetch stub');
  };

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

function oversizedBody() {
  const marker = new TextEncoder().encode(RAW_RESPONSE_MARKER);
  const padding = new Uint8Array(MAX_RESPONSE_BYTES + 1 - marker.byteLength);
  const bytes = new Uint8Array(marker.byteLength + padding.byteLength);
  bytes.set(marker);
  bytes.set(padding, marker.byteLength);
  return bytes;
}

test('declared oversized response fails closed, is cancelled, and unlocks its body', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    let networkCalls = 0;
    let cancelCalls = 0;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedBody());
      },
      cancel() {
        cancelCalls += 1;
      },
    }), {
      status: 200,
      headers: {
        'content-length': String(MAX_RESPONSE_BYTES + 1),
      },
    });

    globalThis.fetch = async () => {
      networkCalls += 1;
      return response;
    };

    let error;
    await assert.rejects(
      completeProductCandidate({ message: 'declared-oversized', context: offlineContext() }),
      (caught) => {
        error = caught;
        return caught?.code === 'ADAPTER_FAILURE';
      },
    );

    assert.equal(networkCalls, 1);
    assert.equal(cancelCalls, 1);
    assert.equal(response.body.locked, false);
    assert.equal(error.code, 'ADAPTER_FAILURE');
    assert.notEqual(error.code, 'ADAPTER_TIMEOUT');
    assert.equal(error.message.includes(RAW_RESPONSE_MARKER), false);
  });
});

test('chunked oversized response fails closed, is cancelled, and unlocks its body', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    let networkCalls = 0;
    let cancelCalls = 0;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedBody());
      },
      cancel() {
        cancelCalls += 1;
      },
    }), { status: 200 });

    globalThis.fetch = async () => {
      networkCalls += 1;
      return response;
    };

    let error;
    await assert.rejects(
      completeProductCandidate({ message: 'chunked-oversized', context: offlineContext() }),
      (caught) => {
        error = caught;
        return caught?.code === 'ADAPTER_FAILURE';
      },
    );

    assert.equal(networkCalls, 1);
    assert.equal(cancelCalls, 1);
    assert.equal(response.body.locked, false);
    assert.equal(error.code, 'ADAPTER_FAILURE');
    assert.notEqual(error.code, 'ADAPTER_TIMEOUT');
    assert.equal(error.message.includes(RAW_RESPONSE_MARKER), false);
  });
});

test('normal response below the cap still returns trimmed answer and model', async () => {
  await runOffline(async () => {
    const { completeProductCandidate } = await import('../lib/product-model.ts');
    let networkCalls = 0;
    let authorization;
    let requestedModel;

    globalThis.fetch = async (_input, init) => {
      networkCalls += 1;
      authorization = init.headers.authorization;
      const request = JSON.parse(init.body);
      requestedModel = request.model;
      return Response.json({
        choices: [{ message: { content: `  ${RAW_RESPONSE_MARKER}-normal  ` } }],
      });
    };

    const result = await completeProductCandidate({
      message: '小于上限的正常响应',
      context: offlineContext(),
    });

    assert.equal(networkCalls, 1);
    assert.equal(authorization, `Bearer ${OFFLINE_KEY}`);
    assert.equal(requestedModel, OFFLINE_MODEL);
    assert.equal(result.answer, `${RAW_RESPONSE_MARKER}-normal`);
    assert.equal(result.model, OFFLINE_MODEL);
  });
});

function offlineContext() {
  return {
    caseId: 'FL-RESPONSE-CAP-001',
    caseTitle: '响应上限离线回归',
    contextVersion: 'CTX-RESPONSE-CAP',
    evidenceEventId: 'evidence-response-cap',
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
