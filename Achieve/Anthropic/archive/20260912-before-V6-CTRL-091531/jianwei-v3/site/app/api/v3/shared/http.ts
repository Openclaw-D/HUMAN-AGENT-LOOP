import { readBoundedJsonBody } from '@/lib/bounded-json-body';
import { V3_SHARED_PORTFOLIO } from '@/lib/v3-surfaces/shared/demo-fixtures';
import type { V3ContextSelector, V3RoleProjectionId } from '@/lib/v3-surfaces/shared/contracts';
import { isV3RoleProjectionId } from '@/lib/v3-surfaces/shared/role-policies';
import { NextResponse } from 'next/server';

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export async function readSharedJsonObject(request: Request): Promise<Record<string, unknown>> {
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

export function parseSharedRole(value: unknown, fallback: V3RoleProjectionId = 'leadership'): V3RoleProjectionId {
  const role = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!isV3RoleProjectionId(role)) throw failure('INVALID_ROLE', 'Role Projection 无效');
  return role;
}

export function parseContextSelector(value: unknown): V3ContextSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      grain: 'portfolio',
      portfolioId: V3_SHARED_PORTFOLIO.portfolioId,
      divisionId: null,
      caseId: null,
    };
  }
  const record = value as Record<string, unknown>;
  const grain = record.grain;
  if (grain !== 'portfolio' && grain !== 'division' && grain !== 'case') {
    throw failure('INVALID_CONTEXT_SELECTOR', 'context grain 无效');
  }
  return {
    grain,
    portfolioId: typeof record.portfolioId === 'string' && record.portfolioId.trim()
      ? record.portfolioId.trim()
      : V3_SHARED_PORTFOLIO.portfolioId,
    divisionId: typeof record.divisionId === 'string' && record.divisionId.trim()
      ? record.divisionId.trim()
      : null,
    caseId: typeof record.caseId === 'string' && record.caseId.trim() ? record.caseId.trim() : null,
  };
}

export function parseContextFromUrl(request: Request): V3ContextSelector {
  const url = new URL(request.url);
  return parseContextSelector({
    grain: url.searchParams.get('grain') ?? 'portfolio',
    portfolioId: url.searchParams.get('portfolioId') ?? V3_SHARED_PORTFOLIO.portfolioId,
    divisionId: url.searchParams.get('divisionId'),
    caseId: url.searchParams.get('caseId'),
  });
}

export function sharedErrorResponse(error: unknown, requestId = 'unknown') {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : '服务暂时不可用';
  let status = 500;
  if (code === 'SQLITE_BUSY_RETRYABLE') status = 503;
  else if (code === 'REQUEST_BODY_TOO_LARGE') status = 413;
  else if (code === 'REQUEST_BODY_TIMEOUT') status = 408;
  else if (code.endsWith('_NOT_FOUND')) status = 404;
  else if (code.includes('CONFLICT')) status = 409;
  else if (
    code.includes('DENIED') ||
    code.includes('MISMATCH') ||
    code === 'DEMO_SESSION_EXPIRED' ||
    code === 'BACKGROUND_CASE_READ_ONLY'
  ) status = 403;
  else if (code.startsWith('INVALID_') || code.endsWith('_REQUIRED') || code === 'MESSAGE_NOT_RETRYABLE') status = 400;
  return NextResponse.json({ error: { code, message, requestId, retryable: status >= 500 } }, { status });
}

export function sharedMethodNotAllowed() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持该请求方式', requestId: 'unknown', retryable: false } },
    { status: 405 },
  );
}
