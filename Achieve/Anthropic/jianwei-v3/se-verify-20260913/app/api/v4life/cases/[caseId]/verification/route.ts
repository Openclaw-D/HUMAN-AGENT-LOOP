// POST /api/v4life/cases/:caseId/verification —— ENG01 冻结接口：材料核验最小闭环（P1）。
// 失败关闭：仅 NODE_ENV 非 production 且 caseId 为已知合成 demo case（V4LIFE_DEMO_CASE_ID）时可达；
// production 一律伪装 404 { error: 'CASE_NOT_FOUND' }，非 demo caseId 一律 404，不暴露路由存在。
// 核验是候选岗位语义（CANDIDATE）：本命令不代表正式审批岗位已接受，也不产生 Receipt。
// 请求体经既有 parseChangeVerificationBody 解析；引擎结果原样返回（accepted → 201 / replayed → 200）；
// 直接调用 engine.changeVerification，不在路由内新建引擎、不传任何 mode 选项、不旁路 candidate 闸门
// （默认 strict 引擎因 candidate 闸门抛 INVALID_ENGINE_INPUT 属期望行为）；错误统一交 v4LifeErrorResponse。

import {
  parseChangeVerificationBody,
  readJsonBody,
  resolveV4LifeCaseEngine,
  v4LifeErrorResponse,
  v4LifeJsonResponse,
} from '../../../../../../lib/v4life/http.ts';
import { V4LIFE_DEMO_CASE_ID } from '../../../../../../lib/v4life/runtime.ts';

type Params = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  // 守卫 1（失败关闭）：production 一律 404 伪装，不做任何其他事（不读 params/body、不触碰 runtime）。
  if (process.env.NODE_ENV === 'production') {
    return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
  }
  try {
    const { caseId } = await params;
    // 守卫 2（失败关闭）：仅已知合成 demo case 允许；非 demo caseId 一律 404 CASE_NOT_FOUND。
    if (caseId !== V4LIFE_DEMO_CASE_ID) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    // 守卫 3：引擎解析（已注册优先，demo case 懒创建）；undefined → 404 CASE_NOT_FOUND。
    const engine = resolveV4LifeCaseEngine(caseId);
    if (engine === undefined) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const body = await readJsonBody(request);
    const parsed = parseChangeVerificationBody(body);
    if (!parsed.ok) {
      return v4LifeJsonResponse({ error: parsed.code }, 400);
    }
    // 守卫 4：原样调用引擎命令；核验目标状态、幂等、expectedRev、角色与 candidate 闸门全部由引擎裁决。
    const result = engine.changeVerification(parsed.command);
    return v4LifeJsonResponse(result, result.status === 'accepted' ? 201 : 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}
