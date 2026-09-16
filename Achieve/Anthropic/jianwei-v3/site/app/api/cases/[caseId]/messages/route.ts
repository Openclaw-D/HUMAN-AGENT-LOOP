import { handleCandidateMessage } from '@/lib/domain';
import { readBoundedJsonBody } from '@/lib/bounded-json-body';
import { NextResponse } from 'next/server';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
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

  const raw = body as { message?: unknown; requestId?: unknown; stageId?: unknown; flowId?: unknown };
  if ([raw.message, raw.requestId, raw.stageId, raw.flowId].some((value) => typeof value !== 'string')) {
    return errorResponse('INVALID_BODY', '请求内容无效', 400);
  }

  try {
    const response = await handleCandidateMessage({
      caseId,
      message: raw.message as string,
      requestId: raw.requestId as string,
      stageId: raw.stageId as string,
      flowId: raw.flowId as string,
    });
    return NextResponse.json(response);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    if (code === 'CASE_NOT_FOUND') return errorResponse('CASE_NOT_FOUND', '事项不存在', 404);
    if (code === 'INVALID_STAGE') return errorResponse('INVALID_STAGE', '板块无效', 400);
    if (code === 'INVALID_FLOW') return errorResponse('INVALID_FLOW', '当前流程无效', 400);
    if (code === 'INVALID_REQUEST_ID') return errorResponse('INVALID_REQUEST_ID', '请求标识无效', 400);
    if (code === 'IDEMPOTENCY_CONFLICT') return errorResponse('IDEMPOTENCY_CONFLICT', '同一请求标识已绑定其他内容', 409);
    if (code === 'EMPTY_MESSAGE') return errorResponse('EMPTY_MESSAGE', '请输入内容', 400);
    if (code === 'MESSAGE_TOO_LONG') return errorResponse('MESSAGE_TOO_LONG', '内容过长', 400);
    if (code === 'ADAPTER_TIMEOUT') return errorResponse('ADAPTER_TIMEOUT', '处理超时，请稍后重试', 504);
    if (code === 'ADAPTER_FAILURE') return errorResponse('ADAPTER_FAILURE', '处理失败，已安全停止', 500);
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
