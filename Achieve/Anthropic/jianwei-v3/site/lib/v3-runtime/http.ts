import { NextResponse } from 'next/server';

import { v3ErrorResponse } from '../v3-api.ts';

export function v3KernelErrorResponse(error: unknown, requestId = 'unknown') {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code === 'SQLITE_BUSY_RETRYABLE') {
    const message = error instanceof Error ? error.message : 'SQLite 暂时不可用';
    return NextResponse.json(
      { error: { code, message, requestId, retryable: true } },
      { status: 503 },
    );
  }
  return v3ErrorResponse(error, requestId);
}
