import { getV3SharedRuntime } from '@/lib/v3-runtime';
import { createV3SurfaceProjection } from '@/lib/v3-surfaces/leadership/projections';
import { NextResponse } from 'next/server';

import {
  parseContextFromUrl,
  parseSharedRole,
  sharedErrorResponse,
  sharedMethodNotAllowed,
} from '../../shared/http';

export async function GET(request: Request) {
  try {
    return NextResponse.json(createV3SurfaceProjection({
      store: getV3SharedRuntime().store,
      surface: 'collaboration',
      role: parseSharedRole(new URL(request.url).searchParams.get('role')),
      context: parseContextFromUrl(request),
    }));
  } catch (error) {
    return sharedErrorResponse(error);
  }
}

export const POST = sharedMethodNotAllowed;
export const PUT = sharedMethodNotAllowed;
export const PATCH = sharedMethodNotAllowed;
export const DELETE = sharedMethodNotAllowed;
