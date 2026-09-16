// POST /api/v5-preview/demo/seed —— 演示情景切换/重置（演示控制·非业务操作，不是批准/放款/结清按钮）。
// body = { scenario: 'approval' | 'post-rental' | 'settled' } → 重置该情景种子状态、清空幂等表、
// version = 种子版本。scenario 非法 → 400 BAD_SCENARIO；存储损坏 → 500 STORE_CORRUPT（不静默重置）。
// 契约：V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §2/§3。

import {
  readV5PreviewJsonBody,
  seedScenario,
  v5PreviewErrorResponse,
  v5PreviewJsonResponse,
} from '../../../../../lib/v5-preview/service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readV5PreviewJsonBody(request);
    return v5PreviewJsonResponse(seedScenario(body), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
