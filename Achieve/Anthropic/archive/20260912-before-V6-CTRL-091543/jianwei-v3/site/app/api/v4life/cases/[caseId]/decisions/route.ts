// POST /api/v4life/cases/:caseId/decisions —— 具名 Human Gate 决定（唯一正式状态变化入口之一）。
// 批准/否决产生 Receipt；退回不发 Receipt；accepted → 201 / replayed → 200。

import { resolveV4LifeCaseEngine, v4LifeErrorResponse, v4LifeJsonResponse } from '../../../../../../lib/v4life/http.ts';
import { parseRecordDecisionBody, readJsonBody } from '../../../../../../lib/v4life/http.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const body = await readJsonBody(request);
    const parsed = parseRecordDecisionBody(body);
    if (!parsed.ok) {
      return v4LifeJsonResponse({ error: parsed.code }, 400);
    }
    const result = engine.recordDecision(parsed.command);
    return v4LifeJsonResponse(result, result.status === 'accepted' ? 201 : 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
