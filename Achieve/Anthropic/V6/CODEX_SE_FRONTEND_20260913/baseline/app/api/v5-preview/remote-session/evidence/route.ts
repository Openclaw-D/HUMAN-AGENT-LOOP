// POST 附着合成 fixture 证据（仅白名单 fixtureId；requestId 幂等 + OCC）。
import { readRemoteJsonBody, remoteErrorResponse, attachEvidence } from '../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(attachEvidence(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
