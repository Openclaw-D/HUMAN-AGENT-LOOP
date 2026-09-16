// POST 人工复核（绑定目标类型+版本；版本变化 409；pause_round 为会话级标记）。
import { readRemoteJsonBody, remoteErrorResponse, createReview } from '../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(createReview(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
