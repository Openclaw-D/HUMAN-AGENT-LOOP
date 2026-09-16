// GET 规则配置（技术质量/证据充分性/业务风险/经济性四层；当前全部 unconfigured）。
import { getRuleConfig, remoteErrorResponse, v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function GET(): Promise<Response> {
  try {
    return v5PreviewJsonResponse(getRuleConfig(), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
