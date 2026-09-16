import { getProjection } from '@/lib/domain';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string }> };

function methodNotAllowed() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持该请求方式' } },
    { status: 405 },
  );
}

export async function GET(_request: Request, { params }: Params) {
  const { caseId } = await params;
  try {
    const projection = getProjection(caseId);
    return NextResponse.json(projection);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    if (code === 'CASE_NOT_FOUND') {
      return NextResponse.json({ error: { code: 'CASE_NOT_FOUND', message: '事项不存在' } }, { status: 404 });
    }
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, { status: 500 });
  }
}

export async function POST() {
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
