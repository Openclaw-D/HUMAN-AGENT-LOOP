import { assertV3DemoResetSession, getV3SharedRuntime } from '@/lib/v3-runtime';
import { resolveV3RequestSession } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

import {
  readSharedJsonObject,
  sharedErrorResponse,
  sharedMethodNotAllowed,
} from '../http';

export async function POST(request: Request) {
  let requestId = 'unknown';
  try {
    const body = await readSharedJsonObject(request);
    requestId = String(body.requestId ?? '').trim();
    const session = resolveV3RequestSession(request);
    assertV3DemoResetSession(session);
    const result = getV3SharedRuntime().demoReset({
      requestId,
      actorRole: 'leadership',
      confirmation: String(body.confirmation ?? ''),
    });
    return NextResponse.json(result);
  } catch (error) {
    return sharedErrorResponse(error, requestId);
  }
}

export const GET = sharedMethodNotAllowed;
export const PUT = sharedMethodNotAllowed;
export const PATCH = sharedMethodNotAllowed;
export const DELETE = sharedMethodNotAllowed;
