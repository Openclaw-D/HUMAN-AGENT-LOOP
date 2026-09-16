import {
  readV3JsonObject,
  resolveV3RequestSession,
  v3ErrorResponse,
  v3MethodNotAllowed,
} from '@/lib/v3-api';
import {
  createInsightChatService,
  InsightChatServiceError,
} from '@/lib/v3-surfaces/insight/chat';
import { readSharedInsightChatContext } from '@/lib/v3-surfaces/insight/shared-adapter';
import { NextResponse } from 'next/server';

const services = new Map<string, ReturnType<typeof createInsightChatService>>();

function serviceForSession(session: ReturnType<typeof resolveV3RequestSession>) {
  const existing = services.get(session.sessionId);
  if (existing) return existing;
  const service = createInsightChatService({
    contextProvider: (caseId) => readSharedInsightChatContext(session, caseId),
  });
  services.set(session.sessionId, service);
  return service;
}

function insightChatErrorResponse(error: unknown, requestId: string) {
  const candidate = error instanceof InsightChatServiceError
    ? error
    : new InsightChatServiceError('INTERNAL_ERROR', '服务暂时不可用', true, 1000);
  let status = 500;
  if (candidate.code === 'JW_BUSY') status = 503;
  else if (candidate.code === 'JW_CONTEXT_UNAVAILABLE' || candidate.code === 'SHARED_CHAT_CONTEXT_UNAVAILABLE') status = 503;
  else if (candidate.code === 'JW_EMPTY_REPLY') status = 502;
  else if (candidate.code === 'IDEMPOTENCY_CONFLICT') status = 409;
  else if (candidate.code === 'ACTION_SCOPE_DENIED') status = 403;
  else if (candidate.code.endsWith('_NOT_FOUND')) status = 404;
  else if (candidate.code.startsWith('INVALID_') || candidate.code.endsWith('_INVALID') || candidate.code === 'JW_MENTION_REQUIRED') status = 400;
  return NextResponse.json({
    error: {
      code: candidate.code,
      message: candidate.message,
      requestId,
      retryable: candidate.retryable,
      retryAfterMs: candidate.retryAfterMs,
    },
  }, { status });
}

export async function POST(request: Request) {
  let requestId = 'unknown';
  try {
    const session = resolveV3RequestSession(request);
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '').trim();
    const result = await serviceForSession(session).ask({
      requestId,
      caseId: String(body.caseId ?? 'FL-DEMO-001'),
      message: String(body.message ?? ''),
    });
    return NextResponse.json(result);
  } catch (error) {
    return error instanceof InsightChatServiceError
      ? insightChatErrorResponse(error, requestId)
      : v3ErrorResponse(error, requestId);
  }
}

export const GET = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
