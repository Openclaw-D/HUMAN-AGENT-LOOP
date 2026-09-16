import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInsightChatService,
  InsightChatServiceError,
} from '../lib/v3-surfaces/insight/chat.ts';

function context() {
  return {
    caseId: 'CASE-1',
    contextVersion: 'CTX-1',
    runtimeEpoch: 'EPOCH-1',
    threadId: 'THREAD-1',
    entries: [{
      entryId: 'ENTRY-1',
      actorLabel: '信审 · 周岚',
      processId: 'credit',
      text: '请补齐订单稳定性证据',
      kind: 'human-message',
      contextVersion: 'CTX-1',
      recordedAt: '2026-08-30T10:00:00.000Z',
      authority: 'none',
    }],
    asOf: '2026-08-30T10:00:00.000Z',
  };
}

test('@JW reply is a non-persistent candidate with shared chat provenance', async () => {
  const service = createInsightChatService({ contextProvider: () => context() });
  const result = await service.ask({ requestId: 'REQ-1', caseId: 'CASE-1', message: '@JW 请整理风险缺口' });

  assert.equal(result.reply.actorId, '@JW');
  assert.equal(result.reply.actorKind, 'agent');
  assert.equal(result.reply.authorityType, 'candidate');
  assert.equal(result.reply.authority, 'none');
  assert.equal(result.reply.persistence, 'non_persistent_candidate');
  assert.deepEqual(result.source.refs, ['ENTRY-1']);
  assert.equal(result.provenance.contextVersion, 'CTX-1');
});

test('replays an idempotent request and rejects a conflicting payload', async () => {
  let responderCalls = 0;
  const service = createInsightChatService({
    contextProvider: () => context(),
    responder: () => {
      responderCalls += 1;
      return '候选结果';
    },
  });
  const input = { requestId: 'REQ-STABLE', caseId: 'CASE-1', message: '@JW 检查' };
  const first = await service.ask(input);
  const replay = await service.ask(input);

  assert.equal(responderCalls, 1);
  assert.equal(first.idempotency.replayed, false);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(replay.reply.text, first.reply.text);
  await assert.rejects(
    service.ask({ ...input, message: '@JW 改变载荷' }),
    (error) => error instanceof InsightChatServiceError && error.code === 'IDEMPOTENCY_CONFLICT' && !error.retryable,
  );
});

test('returns a retryable busy contract for a different request on the same Case', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = createInsightChatService({
    contextProvider: () => context(),
    responder: async () => {
      await blocked;
      return '完成';
    },
    retryAfterMs: 250,
  });
  const first = service.ask({ requestId: 'REQ-1', caseId: 'CASE-1', message: '@JW 第一条' });
  await Promise.resolve();
  await assert.rejects(
    service.ask({ requestId: 'REQ-2', caseId: 'CASE-1', message: '@JW 第二条' }),
    (error) => error instanceof InsightChatServiceError && error.code === 'JW_BUSY' && error.retryable && error.retryAfterMs === 250,
  );
  release();
  await first;
});

test('allows the same requestId to retry after a transient context error', async () => {
  let calls = 0;
  const service = createInsightChatService({
    contextProvider: () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary'), { code: 'JW_CONTEXT_UNAVAILABLE', retryable: true });
      return context();
    },
  });
  const input = { requestId: 'REQ-RETRY', caseId: 'CASE-1', message: '@JW 重试' };

  await assert.rejects(
    service.ask(input),
    (error) => error instanceof InsightChatServiceError && error.code === 'JW_CONTEXT_UNAVAILABLE' && error.retryable,
  );
  const retried = await service.ask(input);
  assert.equal(calls, 2);
  assert.equal(retried.idempotency.replayed, false);
});

test('rejects missing @JW and authority-bearing shared entries before producing a candidate', async () => {
  const service = createInsightChatService({ contextProvider: () => context() });
  await assert.rejects(
    service.ask({ requestId: 'REQ-NO-MENTION', caseId: 'CASE-1', message: '请分析' }),
    (error) => error instanceof InsightChatServiceError && error.code === 'JW_MENTION_REQUIRED',
  );

  const invalid = context();
  invalid.entries[0].authority = 'confirmed';
  await assert.rejects(
    createInsightChatService({ contextProvider: () => invalid }).ask({ requestId: 'REQ-BAD-CONTEXT', caseId: 'CASE-1', message: '@JW 请分析' }),
    (error) => error instanceof InsightChatServiceError && error.code === 'SHARED_CHAT_CONTEXT_INVALID',
  );
});
