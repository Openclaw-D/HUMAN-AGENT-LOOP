import { readBoundedJsonBody } from './bounded-json-body.ts';
import { resolveV3DemoSession } from './v3-demo-backend.ts';
import { NextResponse } from 'next/server';

export const V3_DEMO_SESSION_COOKIE = 'jw_v3_demo_session';

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export async function readV3JsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await readBoundedJsonBody(request);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'REQUEST_BODY_TOO_LARGE' || code === 'REQUEST_BODY_TIMEOUT') throw error;
    throw failure('INVALID_JSON', '请求内容不是有效 JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw failure('INVALID_BODY', '请求内容无效');
  }
  return body as Record<string, unknown>;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

export function resolveV3RequestSession(request: Request) {
  const sessionId = request.headers.get('x-jw-demo-session') ?? cookieValue(request, V3_DEMO_SESSION_COOKIE);
  return resolveV3DemoSession(sessionId);
}

export function assertV3GoldenMutation(caseId: string): void {
  if (caseId === 'FL-DEMO-001') return;
  if (/^FL-BG-\d{3}$/.test(caseId)) throw failure('BACKGROUND_CASE_READ_ONLY', '背景事项只允许读取摘要');
  throw failure('CASE_NOT_FOUND', '事项不存在');
}

export function v3ErrorResponse(error: unknown, requestId = 'unknown') {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : '服务暂时不可用';
  let status = 500;
  if (code === 'REQUEST_BODY_TOO_LARGE') status = 413;
  else if (code === 'REQUEST_BODY_TIMEOUT') status = 408;
  else if (code === 'METHOD_NOT_ALLOWED') status = 405;
  else if (code === 'CASE_NOT_FOUND' || code.endsWith('_NOT_FOUND')) status = 404;
  else if (code.includes('CONFLICT') || code === 'ALREADY_COMMENCED') status = 409;
  else if (
    code.includes('DENIED') ||
    code.includes('MISMATCH') ||
    code === 'DEMO_SESSION_EXPIRED' ||
    code === 'DEMO_SESSION_REQUIRED' ||
    code === 'INVITATION_REQUIRED' ||
    code === 'AUTHORITY_NONE' ||
    code === 'BACKGROUND_CASE_READ_ONLY'
  ) status = 403;
  else if (
    code.startsWith('INVALID_') ||
    code.endsWith('_INVALID') ||
    code === 'UNKNOWN_PRINCIPAL' ||
    code === 'EVIDENCE_REQUIRED' ||
    code === 'INVITATION_EXPIRED' ||
    code === 'INVITATION_SCOPE_DENIED' ||
    code === 'RUN_SUPERSEDED' ||
    code === 'COMMENCEMENT_RECEIPTS_INCOMPLETE' ||
    code === 'GATE_NOT_READY' ||
    code === 'COMMENCEMENT_NOT_READY' ||
    code === 'T2_CREDIT_REGRESSION_REQUIRED'
  ) status = 400;
  return NextResponse.json({ error: { code, message, requestId, retryable: status >= 500 } }, { status });
}

export function v3MethodNotAllowed() {
  return v3ErrorResponse(failure('METHOD_NOT_ALLOWED', '不支持该请求方式'));
}
