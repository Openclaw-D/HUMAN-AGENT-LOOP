// POST 经济性核算尝试（口径未配置→not_configured；测试输入负收益→blocked；不产生可执行建议）。
import { readRemoteJsonBody, remoteErrorResponse, attemptCalculation } from '../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(attemptCalculation(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
