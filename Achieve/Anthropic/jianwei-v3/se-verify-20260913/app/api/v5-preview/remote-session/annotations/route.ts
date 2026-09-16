// POST 圈选标疑+提问（归一化坐标 0..1，绑定 evidenceId+version；悬空标疑拒绝）。
import { readRemoteJsonBody, remoteErrorResponse, createAnnotation } from '../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(createAnnotation(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
