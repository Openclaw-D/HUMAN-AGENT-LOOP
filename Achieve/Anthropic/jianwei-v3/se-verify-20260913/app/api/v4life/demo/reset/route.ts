// POST /api/v4life/demo/reset —— §14.3 Demo reset（重置合成演示，不是业务回滚）。
// 仅服务固定合成 case demo-sme-robot-500w：丢弃进程内 demo 引擎实例并用种子重建全新引擎，
// 返回全新 canonical Projection。reset 不进入事件账本（无 Reset 事件），旧引擎实例直接丢弃。
// 失败关闭：NODE_ENV === 'production' 时整体伪装为 404 { error: 'CASE_NOT_FOUND' }，不暴露路由存在。

import {
  resetV4LifeDemoRuntime,
  V4LIFE_DEMO_CASE_ID,
} from '../../../../../lib/v4life/runtime.ts';
import {
  asNonEmptyString,
  readJsonBody,
  v4LifeErrorResponse,
  v4LifeJsonResponse,
} from '../../../../../lib/v4life/http.ts';

/** 生产保护（默认失败关闭）：production 环境一律 404，GET/POST 同样对待。 */
function productionGuard(): Response | undefined {
  if (process.env.NODE_ENV === 'production') {
    return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  const guarded = productionGuard();
  if (guarded !== undefined) {
    return guarded;
  }
  try {
    // body 可省略或 {caseId?}。选择：非法 body（非 JSON/非对象/数组）按"省略"处理，而不是
    // 400 INVALID_ENGINE_INPUT —— reset 请求体不含任何可伪造权威状态的命令字段，空对象即合法
    // 语义；lenient 模式只放宽 JSON 解析错误，资源守卫（413/408）仍然显式失败。
    // 仅当显式给出非空 string 的 caseId 且 ≠ demo caseId 时失败关闭为 404 CASE_NOT_FOUND
    // （与 §10 非 demo caseId 语义一致）。
    const body = await readJsonBody(request, { lenient: true });
    const caseId = asNonEmptyString(body.caseId);
    if (caseId !== undefined && caseId !== V4LIFE_DEMO_CASE_ID) {
      return v4LifeJsonResponse({ error: 'CASE_NOT_FOUND' }, 404);
    }
    const engine = resetV4LifeDemoRuntime();
    return v4LifeJsonResponse({ status: 'reset', projection: engine.getProjection() }, 200);
  } catch (error) {
    return v4LifeErrorResponse(error);
  }
}

// GET → 405 Method Not Allowed（选择 405 而非伪装 404：实现最简单，且以 Allow: POST 告知合法方法；
// production 下仍先走失败关闭 404，不暴露路由存在）。无参数：route handler 签名兼容即可。
export async function GET(): Promise<Response> {
  const guarded = productionGuard();
  if (guarded !== undefined) {
    return guarded;
  }
  return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Allow: 'POST',
      'Cache-Control': 'no-store',
    },
  });
}
