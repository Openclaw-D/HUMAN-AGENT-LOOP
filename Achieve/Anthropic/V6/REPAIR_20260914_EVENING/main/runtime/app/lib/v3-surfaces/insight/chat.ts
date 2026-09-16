import type {
  InsightChatContext,
  InsightChatReply,
  InsightChatRequest,
} from './contracts.ts';

export class InsightChatServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(code: string, message: string, retryable = false, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'InsightChatServiceError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

type CandidateResponderInput = {
  question: string;
  context: InsightChatContext;
};

type InsightChatServiceOptions = {
  contextProvider: (caseId: string) => Promise<InsightChatContext> | InsightChatContext;
  responder?: (input: CandidateResponderInput) => Promise<string> | string;
  retryAfterMs?: number;
};

type CacheEntry = {
  fingerprint: string;
  promise: Promise<InsightChatReply>;
};

function required(value: unknown, code: string, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InsightChatServiceError(code, message);
  }
  return value.trim();
}

function normalizeRequest(input: InsightChatRequest): InsightChatRequest {
  const requestId = required(input?.requestId, 'INVALID_REQUEST_ID', 'requestId 无效');
  const caseId = required(input?.caseId, 'INVALID_CASE_ID', 'caseId 无效');
  const message = required(input?.message, 'INVALID_MESSAGE', '消息不能为空');
  if (message.length > 600) throw new InsightChatServiceError('INVALID_MESSAGE', '消息不能超过 600 字符');
  if (!/@JW(?:\s|[，,。.!！?？:：]|$)/i.test(message)) {
    throw new InsightChatServiceError('JW_MENTION_REQUIRED', '请使用 @JW 发起候选分析');
  }
  return { requestId, caseId, message };
}

function validateContext(context: InsightChatContext, caseId: string): InsightChatContext {
  if (!context || typeof context !== 'object' || context.caseId !== caseId) {
    throw new InsightChatServiceError('SHARED_CHAT_CONTEXT_INVALID', '共享群聊 Context 无效', true, 1000);
  }
  required(context.contextVersion, 'SHARED_CHAT_CONTEXT_INVALID', '共享群聊 Context Version 缺失');
  required(context.runtimeEpoch, 'SHARED_CHAT_CONTEXT_INVALID', '共享 Runtime Epoch 缺失');
  required(context.threadId, 'SHARED_CHAT_CONTEXT_INVALID', '共享群聊 threadId 缺失');
  if (!Array.isArray(context.entries) || context.entries.some((entry) => entry.authority !== 'none')) {
    throw new InsightChatServiceError('SHARED_CHAT_CONTEXT_INVALID', '共享群聊 authority 无效', false);
  }
  return structuredClone(context);
}

function questionFrom(message: string): string {
  const question = message.replace(/@JW/ig, '').trim();
  if (!question) throw new InsightChatServiceError('INVALID_MESSAGE', '@JW 后需要提供问题');
  return question;
}

function defaultResponder({ question, context }: CandidateResponderInput): string {
  return `候选分析（authority=none）：已读取 ${context.entries.length} 条共享群聊 Context。关于“${question}”，当前仅整理可见上下文；正式 event、decision 与 task 状态仍以 shared runtime 和具名 Human Gate 为准。`;
}

function normalizedFailure(error: unknown): InsightChatServiceError {
  if (error instanceof InsightChatServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown; retryAfterMs?: unknown };
    const code = String(candidate.code ?? 'JW_CONTEXT_UNAVAILABLE');
    const nonRetryable = code === 'ACTION_SCOPE_DENIED' || code.endsWith('_INVALID') || code.endsWith('_NOT_FOUND');
    return new InsightChatServiceError(
      code,
      typeof candidate.message === 'string' ? candidate.message : '共享群聊 Context 暂时不可用',
      candidate.retryable === undefined ? !nonRetryable : Boolean(candidate.retryable),
      nonRetryable ? null : typeof candidate.retryAfterMs === 'number' ? candidate.retryAfterMs : 1000,
    );
  }
  return new InsightChatServiceError('JW_CONTEXT_UNAVAILABLE', '共享群聊 Context 暂时不可用', true, 1000);
}

export function createInsightChatService(options: InsightChatServiceOptions) {
  const retryAfterMs = options.retryAfterMs ?? 1000;
  const responder = options.responder ?? defaultResponder;
  const cache = new Map<string, CacheEntry>();
  const busyCases = new Set<string>();

  async function ask(raw: InsightChatRequest): Promise<InsightChatReply> {
    const input = normalizeRequest(raw);
    const question = questionFrom(input.message);
    let context: InsightChatContext;
    try {
      context = validateContext(await options.contextProvider(input.caseId), input.caseId);
    } catch (error) {
      throw normalizedFailure(error);
    }
    const key = `${context.runtimeEpoch}:${input.caseId}:${input.requestId}`;
    const busyKey = `${context.runtimeEpoch}:${input.caseId}`;
    const fingerprint = JSON.stringify({ caseId: input.caseId, message: input.message });
    const cached = cache.get(key);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw new InsightChatServiceError('IDEMPOTENCY_CONFLICT', '同一 requestId 的载荷不一致');
      }
      const replay = await cached.promise;
      return structuredClone({ ...replay, idempotency: { ...replay.idempotency, replayed: true } });
    }
    if (busyCases.has(busyKey)) {
      throw new InsightChatServiceError('JW_BUSY', '@JW 正在处理同一 Case 的候选请求', true, retryAfterMs);
    }

    busyCases.add(busyKey);
    const operation = (async () => {
      try {
        const text = required(
          await responder({ question, context }),
          'JW_EMPTY_REPLY',
          '@JW 未返回候选内容',
        );
        return structuredClone({
          requestId: input.requestId,
          caseId: input.caseId,
          contextVersion: context.contextVersion,
          reply: {
            actorId: '@JW' as const,
            actorKind: 'agent' as const,
            authorityType: 'candidate' as const,
            authority: 'none' as const,
            persistence: 'non_persistent_candidate' as const,
            text,
          },
          source: {
            sourceType: 'shared-chat' as const,
            sourceMode: 'in_memory_demo' as const,
            system: context.threadId,
            refs: context.entries.map((entry) => entry.entryId).sort(),
          },
          provenance: {
            derivedBy: 'v3-insight-jw-candidate-v1',
            runtimeEpoch: context.runtimeEpoch,
            contextVersion: context.contextVersion,
          },
          asOf: context.asOf,
          idempotency: { key, replayed: false },
        });
      } catch (error) {
        cache.delete(key);
        throw normalizedFailure(error);
      } finally {
        busyCases.delete(busyKey);
      }
    })();
    cache.set(key, { fingerprint, promise: operation });
    return operation;
  }

  return { ask };
}
