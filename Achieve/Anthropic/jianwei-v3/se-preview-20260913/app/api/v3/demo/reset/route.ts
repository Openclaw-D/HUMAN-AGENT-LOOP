import { resetV3DemoRuntime } from '@/lib/v3-demo-backend';
import { resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const session = resolveV3RequestSession(request);
    if (session.principalId !== 'collaboration-manager') {
      throw Object.assign(new Error('只有协同演示控制账号可以 reset'), { code: 'ACTION_SCOPE_DENIED' });
    }
    const snapshot = resetV3DemoRuntime();
    return NextResponse.json({
      scenarioRef: snapshot.scenarioRef,
      runtimeEpoch: snapshot.runtimeEpoch,
      currentContext: snapshot.currentContext,
      eventCount: snapshot.events.length,
      receiptCount: snapshot.receipts.length,
      processRunCount: snapshot.processRuns.length,
    });
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
