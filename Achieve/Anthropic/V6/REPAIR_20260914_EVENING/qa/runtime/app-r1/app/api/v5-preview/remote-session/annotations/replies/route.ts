// POST 标注回复（kind=model_simulation/business/domain；模型输出显式标注、authority=none）。
import { readRemoteJsonBody, remoteErrorResponse, replyAnnotation } from '../../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(replyAnnotation(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
