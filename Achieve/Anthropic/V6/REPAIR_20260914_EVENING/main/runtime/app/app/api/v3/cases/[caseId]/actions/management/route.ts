import { getV3DemoRuntime } from '@/lib/v3-demo-backend';
import { assertV3GoldenMutation, readV3JsonObject, resolveV3RequestSession, v3MethodNotAllowed } from '@/lib/v3-api';
import { v3KernelErrorResponse } from '@/lib/v3-runtime/http';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params) {
  let requestId = 'unknown';
  try {
    const { caseId } = await params;
    assertV3GoldenMutation(caseId);
    const session = resolveV3RequestSession(request);
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '');
    const receipt = getV3DemoRuntime().recordManagementAction({
      roleApplicationId: session.roleApplicationId,
      principalId: session.principalId,
      requestId,
      expectedContextVersion: String(body.expectedContextVersion ?? ''),
      actionCode: String(body.actionCode ?? ''),
      targetPrincipalIds: Array.isArray(body.targetPrincipalIds) ? body.targetPrincipalIds.map(String) : [],
      rationale: String(body.rationale ?? ''),
      evidenceOrProjectionRefs: Array.isArray(body.evidenceOrProjectionRefs) ? body.evidenceOrProjectionRefs.map(String) : [],
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    return v3KernelErrorResponse(error, requestId);
  }
}

export const GET = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
