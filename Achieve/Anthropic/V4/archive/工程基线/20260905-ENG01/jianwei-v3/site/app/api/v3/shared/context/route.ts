import { getV3SharedRuntime } from '@/lib/v3-runtime';
import { getV3RolePolicy } from '@/lib/v3-surfaces/shared/role-policies';
import { NextResponse } from 'next/server';

import {
  parseContextFromUrl,
  parseSharedRole,
  sharedErrorResponse,
  sharedMethodNotAllowed,
} from '../http';

export async function GET(request: Request) {
  try {
    const role = parseSharedRole(new URL(request.url).searchParams.get('role'));
    const runtime = getV3SharedRuntime();
    const selector = parseContextFromUrl(request);
    const roleProjection = getV3RolePolicy(role);
    if (!roleProjection.visibleGrains.includes(selector.grain)) {
      throw Object.assign(new Error('当前 Role Projection 不可读取该粒度'), {
        code: 'CONTEXT_SCOPE_DENIED',
      });
    }
    const current = runtime.store.resolveContext(selector);
    return NextResponse.json({
      runtimeEpoch: runtime.store.getRuntimeEpoch(),
      current,
      hierarchy: roleProjection.visibleGrains.includes('portfolio')
        ? runtime.store.listContexts()
        : [current],
      roleProjection,
    });
  } catch (error) {
    return sharedErrorResponse(error);
  }
}

export const POST = sharedMethodNotAllowed;
export const PUT = sharedMethodNotAllowed;
export const PATCH = sharedMethodNotAllowed;
export const DELETE = sharedMethodNotAllowed;
