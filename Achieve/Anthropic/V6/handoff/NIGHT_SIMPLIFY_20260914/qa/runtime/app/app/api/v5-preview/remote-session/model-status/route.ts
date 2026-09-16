// GET 模型服务配置状态（CONTRACT §4：只报存在性与模式，不返回任何秘密值）。
import { getModelConfigStatus, remoteErrorResponse, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse({ ok: true, model: getModelConfigStatus() }, 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
