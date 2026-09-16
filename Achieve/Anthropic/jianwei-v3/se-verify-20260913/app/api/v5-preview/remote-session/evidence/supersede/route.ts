// POST 重拍/补充：新证据取代旧证据（旧原件不可变，取代链维护过期）。
import { readRemoteJsonBody, remoteErrorResponse, supersedeEvidence } from '../../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(supersedeEvidence(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
