// GET /api/v4life/cases/:caseId —— 四域共享 Projection（大屏、桌面、手机读取同一权威状态）。
// 非 demo 且未注册的 caseId → 404 { error: 'CASE_NOT_FOUND' }（契约 §10 / §12）。

import { resolveV4LifeCaseEngine, v4LifeErrorResponse, v4LifeJsonResponse } from '../../../../../lib/v4life/http.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    return v4LifeJsonResponse(engine.getProjection(), 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
