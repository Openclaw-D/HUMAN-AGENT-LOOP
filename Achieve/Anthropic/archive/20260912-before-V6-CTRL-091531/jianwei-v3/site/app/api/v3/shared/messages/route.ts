import { getV3SharedRuntime } from '@/lib/v3-runtime';
import { resolveV3RequestSession } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

import {
  parseContextFromUrl,
  parseContextSelector,
  readSharedJsonObject,
  sharedErrorResponse,
  sharedMethodNotAllowed,
} from '../http';
import type { V3RoleProjectionId } from '@/lib/v3-surfaces/shared/contracts';
import { assertV3ExternalInvitationScope, projectV3SharedConversation } from '@/lib/v3-surfaces/shared/role-policies';

function sessionRole(session: ReturnType<typeof resolveV3RequestSession>): V3RoleProjectionId {
  const roles: Record<string, V3RoleProjectionId> = {
    'collaboration-manager': 'leadership',
    'business-owner': 'business',
    'risk-policy': 'policy',
    'risk-credit': 'credit',
    'risk-commercial': 'commercial',
    'risk-asset': 'asset',
    'external-customer': 'customer',
    'external-supplier': 'supplier',
  };
  return roles[session.principalId];
}

function assertInvitationScope(session: ReturnType<typeof resolveV3RequestSession>, caseId: string | null): void {
  assertV3ExternalInvitationScope(sessionRole(session), session.invitation?.caseId, caseId);
}

export async function GET(request: Request) {
  try {
    const runtime = getV3SharedRuntime();
    const session = resolveV3RequestSession(request);
    const role = sessionRole(session);
    const selector = parseContextFromUrl(request);
    assertInvitationScope(session, selector.caseId);
    const context = runtime.store.resolveContext(selector);
    const projected = projectV3SharedConversation(
      role,
      runtime.store.listMessages(context.contextId),
      runtime.store.listReceipts().filter((receipt) => receipt.contextId === context.contextId),
    );
    const { messages, receipts } = projected;
    return NextResponse.json({
      runtimeEpoch: runtime.store.getRuntimeEpoch(),
      context,
      role,
      messages,
      candidates: messages.filter((message) => message.actorKind === 'agent'),
      receipts,
      provenance: {
        source: 'shared-v3-sqlite',
        dataClass: context.scenarioRef.dataClass,
        asOf: [...messages.map((message) => message.createdAt), ...receipts.map((receipt) => receipt.createdAt)].sort().at(-1) ?? null,
      },
    });
  } catch (error) {
    return sharedErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let requestId = 'unknown';
  try {
    const body = await readSharedJsonObject(request);
    requestId = String(body.requestId ?? '');
    const session = resolveV3RequestSession(request);
    const selector = parseContextSelector(body.context);
    assertInvitationScope(session, selector.caseId);
    const result = await getV3SharedRuntime().sendMessage({
      requestId,
      actorRole: sessionRole(session),
      context: selector,
      text: String(body.text ?? ''),
    });
    return NextResponse.json(result);
  } catch (error) {
    return sharedErrorResponse(error, requestId);
  }
}

export const PUT = sharedMethodNotAllowed;
export const PATCH = sharedMethodNotAllowed;
export const DELETE = sharedMethodNotAllowed;
