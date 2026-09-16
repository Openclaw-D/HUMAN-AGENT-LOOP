// POST 现场/出席状态确认（自报→按本轮依据确认；attendanceVerified 单列）。
import { readRemoteJsonBody, remoteErrorResponse, confirmAttendance } from '../../../../../lib/v5-preview/remote-service.ts';
import { v5PreviewJsonResponse } from '../../../../../lib/v5-preview/remote-service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRemoteJsonBody(request);
    return v5PreviewJsonResponse(confirmAttendance(body), 200);
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
