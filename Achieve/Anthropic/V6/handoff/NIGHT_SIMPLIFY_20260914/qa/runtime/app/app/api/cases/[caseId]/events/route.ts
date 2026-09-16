import { listAuthorityEvents } from '@/lib/authority-event-ledger';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: Params) {
  const { caseId } = await params;
  const url = new URL(request.url);
  const afterRaw = url.searchParams.get('afterSequence');
  const limitRaw = url.searchParams.get('limit');
  const afterSequence = afterRaw === null ? undefined : Number(afterRaw);
  const limit = limitRaw === null ? undefined : Number(limitRaw);

  try {
    const page = listAuthorityEvents({ caseId, afterSequence, limit });
    return NextResponse.json({
      caseId,
      persistence: 'in_memory_demo',
      authority: 'server_derived',
      ...page,
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    if (code === 'CASE_NOT_FOUND') return errorResponse(code, '事项不存在', 404);
    if (code === 'INVALID_AFTER_SEQUENCE') return errorResponse(code, '分页起始序号无效', 400);
    if (code === 'INVALID_LIMIT') return errorResponse(code, '分页数量无效', 400);
    return errorResponse('INTERNAL_ERROR', '服务暂时不可用', 500);
  }
}

function methodNotAllowed() {
  return errorResponse('METHOD_NOT_ALLOWED', '不支持该请求方式', 405);
}

export async function POST() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }
export async function PATCH() { return methodNotAllowed(); }
export async function PUT() { return methodNotAllowed(); }
export async function HEAD() { return methodNotAllowed(); }
export async function OPTIONS() { return methodNotAllowed(); }
