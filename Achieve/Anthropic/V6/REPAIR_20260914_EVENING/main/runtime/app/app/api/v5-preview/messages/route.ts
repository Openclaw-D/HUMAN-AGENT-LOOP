// POST /api/v5-preview/messages —— 项目沟通追加（业务受控身份；requestId 幂等 + expectedVersion 乐观并发）。
// 接受 → 200 WriteResponse（version+1、追加业务消息）；已结清情景仍可追加留档。
// 错误语义同 notes（见 IMPLEMENTATION.md §2 错误码表）。

import {
  postMessage,
  readV5PreviewJsonBody,
  v5PreviewErrorResponse,
  v5PreviewJsonResponse,
} from '../../../../lib/v5-preview/service.ts';
import { syncSharedProjection } from '../../../../lib/v5-preview/shared-facts.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readV5PreviewJsonBody(request);
    // REPAIR evening：写入前同步共享投影（受影响域/待办/消息为最新派生状态）。
    syncSharedProjection();
    return v5PreviewJsonResponse(postMessage(body), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
