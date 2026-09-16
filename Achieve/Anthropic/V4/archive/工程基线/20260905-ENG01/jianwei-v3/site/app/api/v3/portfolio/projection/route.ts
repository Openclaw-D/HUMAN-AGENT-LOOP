import { getV3PortfolioProjection } from '@/lib/v3-demo-backend';
import { resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    return NextResponse.json(getV3PortfolioProjection(resolveV3RequestSession(request)));
  } catch (error) {
    return v3ErrorResponse(error);
  }
}

export const POST = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
