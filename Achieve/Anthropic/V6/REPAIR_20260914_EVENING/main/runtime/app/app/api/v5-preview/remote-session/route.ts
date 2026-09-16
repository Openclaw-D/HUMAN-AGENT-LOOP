// GET 远程尽调状态（会话/证据/标注/复核/计算/规则）；POST 创建会话（requestId 幂等 + expectedVersion OCC）。
import { createRemoteSession, getRemoteState, readRemoteJsonBody, remoteErrorResponse, v5PreviewJsonResponse } from '../../../../lib/v5-preview/remote-service.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse(getRemoteState(), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(createRemoteSession(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
