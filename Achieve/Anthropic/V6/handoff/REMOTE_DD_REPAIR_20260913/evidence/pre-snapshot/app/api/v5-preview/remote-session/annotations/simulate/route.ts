// POST 确定性模拟：为标注生成后续追问（SIMULATION 显式标注；每条标注一轮；无外部调用）。
import { readRemoteJsonBody, remoteErrorResponse, simulateFollowUps, v5PreviewJsonResponse } from '../../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(simulateFollowUps(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
