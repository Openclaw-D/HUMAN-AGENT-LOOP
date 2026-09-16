// POST /api/v4life/cases/:caseId/work —— 四域专业工作提交（进入 awaiting_gate 或直接完成无 Gate 项）。
// 角色不符 → 403 ROLE_MISMATCH；状态不允许 → 409 WORK_ITEM_NOT_ACTIVE；未知项 → 404 WORK_ITEM_NOT_FOUND。

import { resolveV4LifeCaseEngine, v4LifeErrorResponse, v4LifeJsonResponse } from '../../../../../../lib/v4life/http.ts';
import { parseSubmitWorkBody, readJsonBody } from '../../../../../../lib/v4life/http.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const body = await readJsonBody(request);
    const parsed = parseSubmitWorkBody(body);
    if (!parsed.ok) {
      return v4LifeJsonResponse({ error: parsed.code }, 400);
    }
    const result = engine.submitWork(parsed.command);
    return v4LifeJsonResponse(result, 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
