// POST /api/v5-preview/notes —— 提交合成补充说明（业务受控身份；requestId 幂等 + expectedVersion 乐观并发）。
// 接受 → 200 WriteResponse（version+1、todo.status=待复核、相关域 judgmentText=待复核 仍黄灯、
// 追加业务补充说明 + 系统记录；不产生正式 Decision/Receipt；不自动变绿）。
// 幂等重放 → 200 + replayed:true；同 requestId 换载荷 → 409 REQUEST_MISMATCH；
// 版本过期 → 409 VERSION_CONFLICT + serverVersion；已结清 → 409 NO_OPEN_TODO；越权 → 403。
// 契约：V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §2。

import {
  readV5PreviewJsonBody,
  submitNote,
  v5PreviewErrorResponse,
  v5PreviewJsonResponse,
} from '../../../../lib/v5-preview/service.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readV5PreviewJsonBody(request);
    return v5PreviewJsonResponse(submitNote(body), 200);
  } catch (error) {
    return v5PreviewErrorResponse(error);
  }
}
