import { getV3SharedRuntime } from '@/lib/v3-runtime';
import { resolveV3RequestSession } from '@/lib/v3-api';
import { NextResponse } from 'next/server';
import type { V3RoleProjectionId } from '@/lib/v3-surfaces/shared/contracts';

import {
  readSharedJsonObject,
  sharedErrorResponse,
  sharedMethodNotAllowed,
} from '../../http';

function sessionRole(session: ReturnType<typeof resolveV3RequestSession>): V3RoleProjectionId {
  const roles: Record<string, V3RoleProjectionId> = {
    'collaboration-manager': 'leadership', 'business-owner': 'business', 'risk-policy': 'policy',
    'risk-credit': 'credit', 'risk-commercial': 'commercial', 'risk-asset': 'asset',
    'external-customer': 'customer', 'external-supplier': 'supplier',
  };
  return roles[session.principalId];
}

export async function POST(request: Request) {
  let requestId = 'unknown';
  try {
    const body = await readSharedJsonObject(request);
    requestId = String(body.requestId ?? '');
    const session = resolveV3RequestSession(request);
    const result = await getV3SharedRuntime().retryMessage({
      requestId,
      actorRole: sessionRole(session),
      originalMessageId: String(body.originalMessageId ?? ''),
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
