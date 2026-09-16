// POST /api/v4life/cases/:caseId/evidence —— 提交 Evidence（commandId 幂等，重放返回 replayed）。
// accepted → 201 / replayed → 200；Evidence 载荷问题 → 400 EVIDENCE_INVALID，其余字段问题 → 400 INVALID_ENGINE_INPUT。

import { resolveV4LifeCaseEngine, v4LifeErrorResponse, v4LifeJsonResponse } from '../../../../../../lib/v4life/http.ts';
import { parseAppendEvidenceBody, readJsonBody } from '../../../../../../lib/v4life/http.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  try {
    const { caseId } = await params;
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const body = await readJsonBody(request);
    const parsed = parseAppendEvidenceBody(body);
    if (!parsed.ok) {
      return v4LifeJsonResponse({ error: parsed.code }, 400);
    }
    const result = engine.appendEvidence(parsed.command);
    return v4LifeJsonResponse(result, result.status === 'accepted' ? 201 : 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
