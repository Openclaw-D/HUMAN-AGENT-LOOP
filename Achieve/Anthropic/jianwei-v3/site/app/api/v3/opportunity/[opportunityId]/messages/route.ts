import {
  readV3JsonObject,
  resolveV3RequestSession,
  v3ErrorResponse,
  v3MethodNotAllowed,
} from '@/lib/v3-api';
import { sendOpportunityChatMessage } from '@/lib/v3-surfaces/opportunity';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ opportunityId: string }> };

export async function POST(request: Request, { params }: Params) {
  let requestId = 'unknown';
  try {
    const { opportunityId } = await params;
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '');
    const result = await sendOpportunityChatMessage({
      session: resolveV3RequestSession(request),
      opportunityId,
      requestId,
      message: String(body.message ?? ''),
    });
    return NextResponse.json(result);
  } catch (error) {
    return v3ErrorResponse(error, requestId);
  }
}

export const GET = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
