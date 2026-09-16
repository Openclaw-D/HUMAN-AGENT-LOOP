// POST 真实模型信审辅助分析（API_OVERNIGHT 20260913 CONTRACT §5；与 annotations/simulate 严格分开：
// 只走已配置真实通道，未配置返回 MODEL_NOT_CONFIGURED，失败不回退模拟）。
import { analyzeAnnotation, readRemoteJsonBody, remoteErrorResponse, v5PreviewJsonResponse } from '../../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(await analyzeAnnotation(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
