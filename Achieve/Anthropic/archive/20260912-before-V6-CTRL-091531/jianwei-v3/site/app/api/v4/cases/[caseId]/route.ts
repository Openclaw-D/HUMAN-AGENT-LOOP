import { readV4CaseProjection } from '../../../../../lib/v4/read-service.ts';
import {
  V4ReadServiceError,
  type V4ReadServiceErrorCode,
} from '../../../../../lib/v4/read-model-types.ts';

type Params = { params: Promise<{ caseId: string }> };

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

function parseCaseId(value: unknown): string {
  if (typeof value !== 'string') {
    return inputFailure();
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return inputFailure();
  }
  const canonical = decoded.trim();
  return canonical.length === 0 ? inputFailure() : canonical;
}

function errorCode(error: unknown): V4ReadServiceErrorCode {
  if (error instanceof V4ReadServiceError && ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return 'PROJECTION_INVALID';
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.searchParams.size !== 0) {
      return inputFailure();
    }
    const sessionId = parseSessionId(request);
    const { caseId: rawCaseId } = await params;
    const caseId = parseCaseId(rawCaseId);
    return jsonResponse({ data: readV4CaseProjection({ sessionId, caseId }) }, 200);
  } catch (error) {
    const code = errorCode(error);
    return jsonResponse({ error: { code } }, ERROR_STATUSES[code]);
  }
}
