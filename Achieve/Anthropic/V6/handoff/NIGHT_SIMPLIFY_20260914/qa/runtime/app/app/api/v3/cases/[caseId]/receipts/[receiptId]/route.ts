import { getV3Receipt } from '@/lib/v3-demo-backend';
import { resolveV3RequestSession, v3ErrorResponse, v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ caseId: string; receiptId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { caseId, receiptId } = await params;
    return NextResponse.json({ receipt: getV3Receipt(resolveV3RequestSession(request), caseId, receiptId) });
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
