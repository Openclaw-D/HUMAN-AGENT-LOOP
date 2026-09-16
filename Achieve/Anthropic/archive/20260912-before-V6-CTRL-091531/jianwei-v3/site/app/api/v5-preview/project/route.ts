// GET /api/v5-preview/project —— 业务可见项目总览投影（四域横条数据，无任何专业细节字段）。
// 成功 → 200 ProjectOverview；存储文件损坏 → 500 STORE_CORRUPT（不静默重置）；全部响应 no-store。
// 契约：V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §2。

import {
  getProjectOverview,
  v5PreviewErrorResponse,
  v5PreviewJsonResponse,
} from '../../../../lib/v5-preview/service.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse(getProjectOverview(), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
