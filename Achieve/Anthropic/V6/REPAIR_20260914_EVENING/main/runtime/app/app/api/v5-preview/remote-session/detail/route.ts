// GET 会话详情（证据含现算复核状态与过期标记；跨会话/跨项目引用拒绝）。
import { getRemoteSessionDetail, remoteErrorResponse, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
    return v5PreviewJsonResponse(getRemoteSessionDetail(sessionId), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
