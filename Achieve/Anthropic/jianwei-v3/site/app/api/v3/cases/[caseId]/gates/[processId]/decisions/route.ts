import { getV3DemoRuntime } from '@/lib/v3-demo-backend';
import { assertV3GoldenMutation, readV3JsonObject, resolveV3RequestSession, v3MethodNotAllowed } from '@/lib/v3-api';
import { v3KernelErrorResponse } from '@/lib/v3-runtime/http';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string; processId: string }> };

export async function POST(request: Request, { params }: Params) {
  let requestId = 'unknown';
  try {
    const { caseId, processId } = await params;
    assertV3GoldenMutation(caseId);
    if (!['policy', 'credit', 'commercial', 'asset'].includes(processId)) {
      throw Object.assign(new Error('processId 无效'), { code: 'INVALID_INPUT' });
    }
    const session = resolveV3RequestSession(request);
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '');
    const receipt = getV3DemoRuntime().recordHumanGate({
      roleApplicationId: session.roleApplicationId,
      principalId: session.principalId,
      requestId,
      expectedContextVersion: String(body.expectedContextVersion ?? ''),
      processId: processId as 'policy' | 'credit' | 'commercial' | 'asset',
      gateMode: body.gateMode as 'HUMAN_CONFIRM' | 'HUMAN_DECIDE',
      decision: body.decision as 'confirm' | 'reject' | 'return_for_evidence',
      rationale: String(body.rationale ?? ''),
      evidenceReceiptIds: Array.isArray(body.evidenceReceiptIds) ? body.evidenceReceiptIds.map(String) : [],
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
