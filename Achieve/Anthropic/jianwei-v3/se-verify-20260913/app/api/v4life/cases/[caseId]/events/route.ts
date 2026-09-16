// GET /api/v4life/cases/:caseId/events?afterSeq=&limit= —— 追加式事件账本分页读取。
// afterSeq 非负整数、limit 非负整数 ≤500；非法 → 400 { error: 'INVALID_ENGINE_INPUT' }。

import { resolveV4LifeCaseEngine, v4LifeErrorResponse, v4LifeJsonResponse } from '../../../../../../lib/v4life/http.ts';

type Params = { params: Promise<{ caseId: string }> };

const MAX_EVENT_LIMIT = 500;

/** 查询参数仅接受十进制非负整数字面量（拒绝空串、负号、小数、科学计数法与超大数值）。 */
function parseNonNegativeIntParam(raw: string | null): number | undefined | null {
  if (raw === null) {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const url = new URL(request.url);
    const parsedAfterSeq = parseNonNegativeIntParam(url.searchParams.get('afterSeq'));
    if (parsedAfterSeq === null) {
      return v4LifeJsonResponse({ error: 'INVALID_ENGINE_INPUT' }, 400);
    }
    const afterSeq = parsedAfterSeq ?? 0;
    const limit = parseNonNegativeIntParam(url.searchParams.get('limit'));
    if (limit === null || (limit !== undefined && limit > MAX_EVENT_LIMIT)) {
      return v4LifeJsonResponse({ error: 'INVALID_ENGINE_INPUT' }, 400);
    }
    return v4LifeJsonResponse(engine.getEvents(afterSeq, limit), 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
