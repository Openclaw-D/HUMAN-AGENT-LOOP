import {
  readV3JsonObject,
  resolveV3RequestSession,
  v3ErrorResponse,
  v3MethodNotAllowed,
} from '../../v3-api.ts';
import { NextResponse } from 'next/server';
import {
  classifyWorkbenchError,
  getWorkbenchErrorCode,
} from './errors.ts';
import { getDefaultWorkbenchService } from './service.ts';
import type {
  WorkbenchActionRequest,
  WorkbenchPerspective,
  WorkbenchSession,
} from './types.ts';

function sessionForWorkbench(request: Request): WorkbenchSession {
  const session = resolveV3RequestSession(request);
  return {
    sessionId: session.sessionId,
    principalId: session.principalId,
    roleApplicationId: session.roleApplicationId,
  };
}

export function workbenchErrorResponse(error: unknown, requestId = 'unknown') {
  const classification = classifyWorkbenchError(error);
  if (classification.status !== null) {
    const code = getWorkbenchErrorCode(error);
    const message = error instanceof Error ? error.message : 'Workbench dependency 暂时不可用';
    return NextResponse.json(
      { error: { code, message, requestId, retryable: classification.retryable } },
      { status: classification.status },
    );
  }
  return v3ErrorResponse(error, requestId);
}

export async function handleWorkbenchGet(
  request: Request,
  caseId: string,
  perspective: WorkbenchPerspective,
) {
  try {
    const model = await getDefaultWorkbenchService().read(
      sessionForWorkbench(request),
      caseId,
      perspective,
    );
    return NextResponse.json(model);
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}

export async function handleWorkbenchAction(
  request: Request,
  caseId: string,
  perspective: WorkbenchPerspective,
) {
  let requestId = 'unknown';
  try {
    const body = await readV3JsonObject(request);
    requestId = String(body.requestId ?? '');
    const result = await getDefaultWorkbenchService().act(
      sessionForWorkbench(request),
      caseId,
      perspective,
      {
        requestId,
        expectedContextVersion: String(body.expectedContextVersion ?? ''),
        actionType: String(body.actionType ?? '') as WorkbenchActionRequest['actionType'],
        targetPrincipalId: body.targetPrincipalId === undefined ? undefined : String(body.targetPrincipalId),
        message: body.message === undefined ? undefined : String(body.message),
        rationale: body.rationale === undefined ? undefined : String(body.rationale),
        evidenceReceiptIds: Array.isArray(body.evidenceReceiptIds)
          ? body.evidenceReceiptIds.map(String)
          : undefined,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return workbenchErrorResponse(error, requestId);
  }
}

export const workbenchMethodNotAllowed = v3MethodNotAllowed;
