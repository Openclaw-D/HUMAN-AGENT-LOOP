import { resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { buildOpportunityReadModel, opportunityReadyState } from '@/lib/v3-surfaces/opportunity';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ opportunityId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { opportunityId } = await params;
    const projection = buildOpportunityReadModel(resolveV3RequestSession(request), opportunityId);
    return NextResponse.json(opportunityReadyState(projection));
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
