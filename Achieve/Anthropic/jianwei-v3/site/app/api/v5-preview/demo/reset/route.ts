// POST /api/v5-preview/demo/reset —— 重开：仅重置当前专属演示（REPAIR evening 新增；INTERFACE §2）。
// 作用域 = 主线回 approval 种子起点（version 单调 +1、幂等表清空、游标→s00）
//       + 清除专属演示会话（rs-demo-run）及其证据/标注/复核/核算记录；
// **其他会话与其记录一律不动**。非事务：先清 remote 后重置 rows（失败重试安全，见 shared-facts.ts）。
// 存储损坏 → 500 失败关闭（rows 损坏 STORE_CORRUPT / remote 损坏按未知错误映射 STORE_UNAVAILABLE）。

import { readV5PreviewJsonBody, v5PreviewErrorResponse, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/service.ts';
import { resetDemoRun } from '../../../../../lib/v5-preview/shared-facts.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    await readV5PreviewJsonBody(request);
    return v5PreviewJsonResponse(resetDemoRun(), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
