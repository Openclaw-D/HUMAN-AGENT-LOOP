import { confirmCandidateFact } from '@/lib/domain';
import { readBoundedJsonBody } from '@/lib/bounded-json-body';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string; factId: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, { params }: Params) {
  const { caseId, factId } = await params;
  let body: unknown;
  try {
    body = await readBoundedJsonBody(request);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'REQUEST_BODY_TOO_LARGE') {
      return errorResponse('REQUEST_BODY_TOO_LARGE', '请求内容过大', 413);
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'REQUEST_BODY_TIMEOUT') {
      return errorResponse('REQUEST_BODY_TIMEOUT', '请求内容读取超时', 408);
    }
    return errorResponse('INVALID_JSON', '请求内容不是有效 JSON', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', '请求内容无效', 400);
  }

  const raw = body as { actor?: unknown; requestId?: unknown };
  if (typeof raw.actor !== 'string' || typeof raw.requestId !== 'string') {
    return errorResponse('INVALID_BODY', '请求内容无效', 400);
  }

  try {
    const result = await confirmCandidateFact({
      caseId,
      factId,
      actor: raw.actor,
      requestId: raw.requestId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    if (code === 'INVALID_ACTOR') return errorResponse('INVALID_ACTOR', '确认人必须是非空具名人类', 400);
    if (code === 'INVALID_REQUEST_ID') return errorResponse('INVALID_REQUEST_ID', '请求标识无效', 400);
    if (code === 'INVALID_JSON') return errorResponse('INVALID_JSON', '请求内容不是有效 JSON', 400);
    if (code === 'INVALID_BODY') return errorResponse('INVALID_BODY', '请求内容无效', 400);
    if (code === 'CASE_NOT_FOUND') return errorResponse('CASE_NOT_FOUND', '事项不存在', 404);
    if (code === 'FACT_NOT_FOUND') return errorResponse('FACT_NOT_FOUND', '候选事实不存在', 404);
    if (code === 'IDEMPOTENCY_CONFLICT') return errorResponse('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他确认内容', 409);
    if (code === 'FACT_ALREADY_CONFIRMED') return errorResponse('FACT_ALREADY_CONFIRMED', '事实已由其他具名人员确认', 409);
    return errorResponse('INTERNAL_ERROR', '服务暂时不可用', 500);
  }
}

function methodNotAllowed() {
  return errorResponse('METHOD_NOT_ALLOWED', '不支持该请求方式', 405);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function HEAD() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}
