import { getV3DemoRuntime } from '@/lib/v3-demo-backend';
import { resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId } = await params;
    if (caseId !== 'FL-DEMO-001') throw Object.assign(new Error('事项不存在'), { code: 'CASE_NOT_FOUND' });
    const session = resolveV3RequestSession(request);
    const url = new URL(request.url);
    const afterSequence = Number(url.searchParams.get('afterSequence') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (session.roleApplicationId === 'external') {
      if (!Number.isInteger(afterSequence) || afterSequence < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw Object.assign(new Error('Event pagination 无效'), { code: 'INVALID_PAGINATION' });
      }
      const visible = getV3DemoRuntime().snapshot().events.filter((event) =>
        event.sequence > afterSequence && event.actor.principalId === session.principalId);
      const items = visible.slice(0, limit);
      return NextResponse.json({
        items,
        nextSequence: items.length === limit && visible.length > items.length ? items.at(-1)!.sequence : null,
        hasMore: visible.length > items.length,
      });
    }
    const page = getV3DemoRuntime().listEvents(afterSequence, limit);
    return NextResponse.json(page);
  } catch (error) {
    return v3ErrorResponse(error);
  }
}

export const POST = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
