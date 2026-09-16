import { readV4ManagementProjection } from '../../../../../lib/v4/read-service.ts';
import {
  V4ReadServiceError,
  type V4ReadServiceErrorCode,
} from '../../../../../lib/v4/read-model-types.ts';

const ERROR_STATUSES: Record<V4ReadServiceErrorCode, number> = {
  INVALID_READ_INPUT: 400,
  SESSION_NOT_FOUND: 401,
  READ_DENIED: 403,
  CASE_NOT_FOUND: 404,
  SCOPE_NOT_FOUND: 404,
  PROJECTION_INVALID: 503,
};

const ERROR_CODES = new Set<V4ReadServiceErrorCode>(
  Object.keys(ERROR_STATUSES) as V4ReadServiceErrorCode[],
);

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function inputFailure(): never {
  throw new V4ReadServiceError('INVALID_READ_INPUT');
}

function parseSessionId(request: Request): string {
  const value = request.headers.get('x-v4-session-id');
  if (value === null || value.includes(',')) {
    return inputFailure();
  }
  const canonical = value.trim();
  return canonical.length === 0 ? inputFailure() : canonical;
}

function parseScopeId(request: Request): string {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'scopeId') {
    return inputFailure();
  }
  const canonical = entries[0][1].trim();
  return canonical.length === 0 ? inputFailure() : canonical;
}

function errorCode(error: unknown): V4ReadServiceErrorCode {
  if (error instanceof V4ReadServiceError && ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return 'PROJECTION_INVALID';
}

export async function GET(request: Request): Promise<Response> {
  try {
    const scopeId = parseScopeId(request);
    const sessionId = parseSessionId(request);
    return jsonResponse({ data: readV4ManagementProjection({ sessionId, scopeId }) }, 200);
  } catch (error) {
    const code = errorCode(error);
    return jsonResponse({ error: { code } }, ERROR_STATUSES[code]);
  }
}
