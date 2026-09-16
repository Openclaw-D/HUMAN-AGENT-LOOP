// GET /api/v5-preview/demo/shared-state —— 共享尽调事实只读出口（REPAIR evening 新增；INTERFACE §3）。
// 返回专属演示会话指针、每条 fixture 取代链的域/链版本/复核状态、旧结论待复核清单。
// 附带效应（诚实声明）：读取前先执行共享投影同步（崩溃自愈路径），因此可能触发服务端落盘。
// remote 存储不可用 → 200 + facts:[] + sharedWarning（诚实降级）；rows 存储损坏 → 500 STORE_CORRUPT。

import { v5PreviewErrorResponse, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/service.ts';
import { getSharedFactsView } from '../../../../../lib/v5-preview/shared-facts.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse(getSharedFactsView(), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
