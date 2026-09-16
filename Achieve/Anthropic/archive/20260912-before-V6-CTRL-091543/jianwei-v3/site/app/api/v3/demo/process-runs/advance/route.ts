import { advanceV3DemoProcessRun } from '@/lib/v3-demo-backend';
import { readV3JsonObject, resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let requestId = 'unknown';
  try {
    const session = resolveV3RequestSession(request);
    if (session.principalId !== 'collaboration-manager') {
      throw Object.assign(new Error('只有协同演示控制账号可以推进合成 run'), { code: 'ACTION_SCOPE_DENIED' });
    }
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '');
    const run = advanceV3DemoProcessRun({
      requestId,
      runId: String(body.runId ?? ''),
      phase: body.phase as 'start' | 'result',
    });
    return NextResponse.json({ run });
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
