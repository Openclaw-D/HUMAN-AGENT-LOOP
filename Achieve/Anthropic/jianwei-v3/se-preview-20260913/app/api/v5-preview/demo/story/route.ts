// GET/POST /api/v5-preview/demo/story —— 固定演示主线（演示控制·非业务操作）。
// GET：按 rows-store overview 内容签名推导当前步（纯读，不写）。
// POST body = { action:'advance'|'decide', requestId, expectedVersion, fromStepId, decision?, note? }
// 幂等 + 乐观并发 + 步骤门（契约：V6/handoff/NIGHT_SIMPLIFY_20260914/main/CONTRACT.md §5）。
// 不触碰 remote-store；既有共享 service/store 零改动。

import { readV5PreviewJsonBody, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/service.ts';
import { demoStoryErrorResponse, getStoryState, runStoryCommand } from '../../../../../lib/v5-preview/demo-story-service.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse(getStoryState(), 200);
  } catch (error) {
    return demoStoryErrorResponse(error, v5PreviewJsonResponse);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readV5PreviewJsonBody(request);
    return v5PreviewJsonResponse(runStoryCommand(body), 200);
  } catch (error) {
    return demoStoryErrorResponse(error, v5PreviewJsonResponse);
  }
}
