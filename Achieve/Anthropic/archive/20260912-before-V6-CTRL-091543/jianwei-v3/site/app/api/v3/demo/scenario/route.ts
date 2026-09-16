import { getV3DemoScenario } from '@/lib/v3-demo-backend';
import { v3MethodNotAllowed } from '@/lib/v3-api';
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(getV3DemoScenario());
}

export const POST = v3MethodNotAllowed;
export const DELETE = v3MethodNotAllowed;
export const PATCH = v3MethodNotAllowed;
export const PUT = v3MethodNotAllowed;
export const HEAD = v3MethodNotAllowed;
export const OPTIONS = v3MethodNotAllowed;
