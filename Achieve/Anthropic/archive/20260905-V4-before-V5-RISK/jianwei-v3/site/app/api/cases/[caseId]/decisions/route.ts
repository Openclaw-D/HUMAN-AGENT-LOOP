import { recordHumanDecision } from '@/lib/decision-runtime';
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

  const raw = body as Record<string, unknown>;
  if (['stageId', 'flowId', 'action', 'actor', 'requestId'].some((key) => typeof raw[key] !== 'string')) {
    return errorResponse('INVALID_BODY', '请求内容无效', 400);
  }

  try {
    const receipt = recordHumanDecision({
      caseId,
      stageId: String(raw.stageId),
      flowId: String(raw.flowId),
      action: String(raw.action),
      actor: String(raw.actor),
      requestId: String(raw.requestId),
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    if (code === 'CASE_NOT_FOUND') return errorResponse(code, '事项不存在', 404);
    if (code === 'IDEMPOTENCY_CONFLICT') return errorResponse(code, '同一请求标识已绑定其他操作', 409);
    if (code === 'FLOW_LOCKED') return errorResponse(code, '当前流程已锁定', 409);
    if (['INVALID_STAGE', 'INVALID_FLOW', 'INVALID_ACTION', 'INVALID_ACTOR', 'INVALID_REQUEST_ID'].includes(code)) {
      return errorResponse(code, error instanceof Error ? error.message : '请求内容无效', 400);
    }
    return errorResponse('INTERNAL_ERROR', '服务暂时不可用', 500);
  }
}

function methodNotAllowed() {
  return errorResponse('METHOD_NOT_ALLOWED', '不支持该请求方式', 405);
}

export async function GET() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }
export async function PATCH() { return methodNotAllowed(); }
export async function PUT() { return methodNotAllowed(); }
export async function HEAD() { return methodNotAllowed(); }
export async function OPTIONS() { return methodNotAllowed(); }
