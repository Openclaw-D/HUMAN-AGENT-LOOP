import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createV3SharedRuntime } from '../lib/v3-runtime/shared-runtime.ts';

const GOLDEN_CONTEXT = {
  grain: 'case',
  portfolioId: 'PORTFOLIO-JW-DEMO',
  divisionId: 'DIV-EAST',
  caseId: 'FL-DEMO-001',
};

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'jw-v3-shared-'));
  const databasePath = join(directory, 'runtime.sqlite');
  return Promise.resolve(callback(databasePath)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test('persists human messages, events, candidate replies and non-formal receipts across restart', async () => {
  await withDatabase(async (databasePath) => {
    const runtime = createV3SharedRuntime({ databasePath, now: () => '2026-08-30T08:00:00.000Z' });
    const input = {
      requestId: 'chat-001',
      actorRole: 'business',
      context: GOLDEN_CONTEXT,
      text: '@JW 请给出上下文摘要；@信审 请标记待人审问题。',
    };
    const first = await runtime.sendMessage(input);
    assert.equal(first.replayed, false);
    assert.equal(first.status, 'accepted');
    assert.equal(first.completion, 'message_persisted');
    assert.equal(first.authority, 'none');
    assert.equal(first.candidates.length, 2);
    assert.ok(first.candidates.every((candidate) =>
      candidate.kind === 'ai_candidate' && candidate.authority === 'none' &&
      candidate.status === 'candidate' && candidate.completion === 'not_formal_completion' &&
      candidate.result.text === candidate.text));
    assert.ok(first.routes.every((route) => route.status === 'candidate_ready'));

    const eventCount = runtime.store.listEvents().length;
    const receiptCount = runtime.store.listReceipts().length;
    const replay = await runtime.sendMessage(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.message.messageId, first.message.messageId);
    assert.deepEqual(replay.candidates.map((item) => item.candidateId), first.candidates.map((item) => item.candidateId));
    assert.equal(runtime.store.listEvents().length, eventCount);
    assert.equal(runtime.store.listReceipts().length, receiptCount);
    await assert.rejects(
      runtime.sendMessage({ ...input, text: '更改载荷' }),
      (error) => error.code === 'IDEMPOTENCY_CONFLICT',
    );
    const epoch = runtime.store.getRuntimeEpoch();
    runtime.close();

    const reopened = createV3SharedRuntime({ databasePath });
    assert.equal(reopened.store.getRuntimeEpoch(), epoch);
    const restartReplay = await reopened.sendMessage(input);
    assert.equal(restartReplay.replayed, true);
    assert.equal(restartReplay.message.messageId, first.message.messageId);
    const messages = reopened.store.listMessages('CTX-FL-DEMO-001');
    assert.equal(messages.length, 3);
    assert.equal(messages[0].messageId, first.message.messageId);
    assert.equal(messages.filter((message) => message.actorKind === 'agent').length, 2);
    assert.ok(messages.every((message) => message.authority === 'none'));
    assert.ok(reopened.store.listReceipts().every((receipt) => receipt.formal === false && receipt.authority === 'none'));
    assert.ok(reopened.store.listEvents().every((event) => event.authority === 'none'));
    assert.equal(reopened.store.listEvents().some((event) => /GATE|AUTHORITY/.test(event.eventType)), false);
    reopened.close();
  });
});

test('exposes busy/error route states and retries without duplicating the human message', async () => {
  await withDatabase(async (databasePath) => {
    let call = 0;
    const runtime = createV3SharedRuntime({
      databasePath,
      candidateAdapter() {
        call += 1;
        if (call === 1) return { status: 'busy', message: '本地 candidate worker 忙' };
        if (call === 3) return { status: 'error', code: 'LOCAL_CANDIDATE_FAILED', message: '本地 candidate worker 失败', retryable: true };
        return { status: 'candidate', text: '重试后的本地候选，仍需人审。' };
      },
    });
    const first = await runtime.sendMessage({
      requestId: 'busy-001',
      actorRole: 'business',
      context: GOLDEN_CONTEXT,
      text: '@JW 请处理。',
    });
    assert.equal(first.routes[0].status, 'busy');
    assert.equal(first.routes[0].retryable, true);
    assert.equal(first.candidates.length, 0);
    const retry = await runtime.retryMessage({
      requestId: 'retry-001',
      actorRole: 'business',
      originalMessageId: first.message.messageId,
    });
    assert.equal(retry.routes[0].status, 'candidate_ready');
    assert.equal(retry.candidates.length, 1);
    const messages = runtime.store.listMessages('CTX-FL-DEMO-001');
    assert.equal(messages.filter((message) => message.actorKind === 'human').length, 1);
    assert.equal(messages.filter((message) => message.actorKind === 'agent').length, 1);
    const retryReplay = await runtime.retryMessage({
      requestId: 'retry-001',
      actorRole: 'business',
      originalMessageId: first.message.messageId,
    });
    assert.equal(retryReplay.replayed, true);
    assert.equal(call, 2, 'idempotent retry must not invoke candidate adapter again');
    const failed = await runtime.sendMessage({
      requestId: 'error-001',
      actorRole: 'business',
      context: GOLDEN_CONTEXT,
      text: '@信审 请处理。',
    });
    assert.equal(failed.routes[0].status, 'error');
    assert.equal(failed.routes[0].error.code, 'LOCAL_CANDIDATE_FAILED');
    assert.equal(failed.routes[0].retryable, true);
    assert.equal(failed.candidates.length, 0);
    runtime.close();
  });
});

test('Demo Reset is explicit, reproducible and idempotent while keeping one Golden plus four background Cases', async () => {
  await withDatabase(async (databasePath) => {
    const runtime = createV3SharedRuntime({ databasePath });
    await runtime.sendMessage({
      requestId: 'before-reset', actorRole: 'business', context: GOLDEN_CONTEXT, text: '演示消息',
    });
    assert.equal(runtime.store.listCases().filter((item) => item.caseTier === 'golden').length, 1);
    assert.equal(runtime.store.listCases().filter((item) => item.caseTier === 'background').length, 4);
    assert.equal(runtime.store.listContexts().length, 8);

    const resetInput = {
      requestId: 'reset-001', actorRole: 'leadership', confirmation: 'RESET_DEMO',
    };
    const reset = runtime.demoReset(resetInput);
    assert.equal(reset.messageCount, 0);
    assert.equal(reset.caseCount, 5);
    assert.equal(reset.contextCount, 8);
    assert.equal(reset.eventCount, 1);
    assert.equal(reset.receiptCount, 5);
    const replay = runtime.demoReset(resetInput);
    assert.equal(replay.replayed, true);
    assert.equal(replay.runtimeEpoch, reset.runtimeEpoch);
    const next = runtime.demoReset({ ...resetInput, requestId: 'reset-002' });
    assert.notEqual(next.runtimeEpoch, reset.runtimeEpoch);
    assert.equal(next.messageCount, 0);
    assert.equal(next.caseCount, 5);
    assert.throws(
      () => runtime.demoReset({ requestId: 'reset-business', actorRole: 'business', confirmation: 'RESET_DEMO' }),
      (error) => error.code === 'ACTION_SCOPE_DENIED',
    );
    runtime.close();
  });
});

test('drills Portfolio to division and Case while background Cases stay read-only', async () => {
  await withDatabase(async (databasePath) => {
    const runtime = createV3SharedRuntime({ databasePath });
    const portfolio = runtime.store.resolveContext({
      grain: 'portfolio', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: null, caseId: null,
    });
    const division = runtime.store.resolveContext({
      grain: 'division', portfolioId: 'PORTFOLIO-JW-DEMO', divisionId: 'DIV-EAST', caseId: null,
    });
    const caseContext = runtime.store.resolveContext(GOLDEN_CONTEXT);
    assert.equal(division.parentContextId, portfolio.contextId);
    assert.equal(caseContext.parentContextId, division.contextId);
    await assert.rejects(runtime.sendMessage({
      requestId: 'background-write',
      actorRole: 'business',
      context: { ...GOLDEN_CONTEXT, caseId: 'FL-BG-001' },
      text: '不应写入',
    }), (error) => error.code === 'BACKGROUND_CASE_READ_ONLY');
    runtime.close();
  });
});

test('rejects non-Evidence receipts before a professional Human Gate', async () => {
  await withDatabase(async (databasePath) => {
    const runtime = createV3SharedRuntime({ databasePath, now: () => '2026-08-30T09:00:00.000Z' });
    const evidenceReceiptId = runtime.store.listReceipts().find((receipt) =>
      receipt.caseId === 'FL-DEMO-001' && receipt.receiptType === 'scenario_source')?.receiptId;
    assert.ok(evidenceReceiptId);
    const input = {
      requestId: 'gate-asset-001', actorRole: 'asset', principalId: 'risk-asset', processId: 'asset',
      context: GOLDEN_CONTEXT, expectedContextVersion: 'CTX-0000', decision: 'reject',
      rationale: '合成资产证据不足', evidenceReceiptIds: [evidenceReceiptId],
    };
    await assert.rejects(Promise.resolve().then(() => runtime.recordHumanGate(input)),
      (error) => error.code === 'EVIDENCE_RECEIPT_NOT_FOUND');
    assert.equal(runtime.store.listReceipts().filter((receipt) => receipt.receiptType === 'human_gate').length, 0);
    runtime.close();
  });
});
