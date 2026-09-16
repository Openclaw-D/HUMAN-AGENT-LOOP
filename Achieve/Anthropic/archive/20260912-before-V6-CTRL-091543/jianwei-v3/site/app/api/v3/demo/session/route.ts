import { createV3DemoSession } from '@/lib/v3-demo-backend';
import { readV3JsonObject, V3_DEMO_SESSION_COOKIE, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await readV3JsonObject(request);
    const session = createV3DemoSession(String(body.principalId ?? '') as Parameters<typeof createV3DemoSession>[0]);
    const response = NextResponse.json({ session });
    response.cookies.set(V3_DEMO_SESSION_COOKIE, session.sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/',
    });
    return response;
  } catch (error) {
    return v3ErrorResponse(error);
  }
}

export const GET = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
