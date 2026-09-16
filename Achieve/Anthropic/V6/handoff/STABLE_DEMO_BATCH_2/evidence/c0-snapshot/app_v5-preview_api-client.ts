// V5 ROWS · HTTP 客户端：唯一后端事实源 = /api/v5-preview/**（FROZEN 契约）。
// 仅消费 HTTP；不得 import lib/** 的运行时实现（共享类型经 import type 擦除）。
// localStorage/sessionStorage 不再是业务事实源；每次刷新/写入/轮询都以后端响应为准。

import { buildMessageBody, buildNoteBody, resolveWriteConflict } from './rows-logic';
import type { SubmitOutcome } from './rows-logic';
import type {
  MessageRequest,
  NoteRequest,
  ProjectOverview,
  ScenarioId,
  WriteResponse,
} from '../../lib/v5-preview/shared-types';

/** 冻结端点（URL 全部以字面量出现，便于契约测试与检索；不得拼出未冻结 URL）。 */
const ENDPOINTS = {
  project: '/api/v5-preview/project',
  notes: '/api/v5-preview/notes',
  messages: '/api/v5-preview/messages',
  demoSeed: '/api/v5-preview/demo/seed',
} as const;

/** 业务可读的失败对象：HTTP 状态 + 契约错误码 + 服务端消息（+ VERSION_CONFLICT 的 serverVersion）。 */
export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly serverVersion: number | undefined;

  constructor(code: string, status: number, message: string, serverVersion?: number) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
    this.serverVersion = serverVersion;
  }
}

async function toApiFailure(response: Response): Promise<ApiFailure> {
  let code = `HTTP_${response.status}`;
  let message = `请求失败（HTTP ${response.status}）`;
  let serverVersion: number | undefined;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object') {
      const o = body as Record<string, unknown>;
      if (typeof o.error === 'string') code = o.error;
      if (typeof o.message === 'string') message = o.message;
      if (typeof o.serverVersion === 'number') serverVersion = o.serverVersion;
    }
  } catch {
    // 非 JSON 错误体：保留 HTTP 状态信息即可。
  }
  return new ApiFailure(code, response.status, message, serverVersion);
}

async function readWriteResponse(response: Response): Promise<WriteResponse> {
  if (!response.ok) throw await toApiFailure(response);
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object') {
    throw new ApiFailure('BAD_RESPONSE', response.status, '服务端响应格式异常（合成演示）');
  }
  const o = body as Partial<WriteResponse>;
  if (o.ok !== true || o.overview === undefined || o.overview === null) {
    throw new ApiFailure('BAD_RESPONSE', response.status, '服务端响应缺少最新总览（合成演示）');
  }
  return body as WriteResponse;
}

/** GET /api/v5-preview/project → 业务可见总览（无专业细节）。 */
export async function fetchOverview(): Promise<ProjectOverview> {
  let response: Response;
  try {
    response = await fetch(ENDPOINTS.project, { cache: 'no-store' });
  } catch {
    throw new ApiFailure('NETWORK', 0, '网络异常：无法加载项目总览（合成演示）');
  }
  if (!response.ok) throw await toApiFailure(response);
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object') {
    throw new ApiFailure('BAD_RESPONSE', response.status, '服务端总览格式异常（合成演示）');
  }
  const o = body as Partial<ProjectOverview>;
  if (typeof o.projectId !== 'string' || !Array.isArray(o.domains) || o.overall === undefined) {
    throw new ApiFailure('BAD_RESPONSE', response.status, '服务端总览缺少必要字段（合成演示）');
  }
  return body as ProjectOverview;
}

/** POST /api/v5-preview/notes（requestId 幂等；expectedVersion 乐观并发）。 */
export function postNote(expectedVersion: number, todoId: string, text: string, requestId: string): Promise<WriteResponse> {
  const body: NoteRequest = buildNoteBody(todoId, text, expectedVersion, requestId);
  return postJson(ENDPOINTS.notes, body);
}

/** POST /api/v5-preview/messages。 */
export function postMessage(expectedVersion: number, text: string, requestId: string): Promise<WriteResponse> {
  const body: MessageRequest = buildMessageBody(text, expectedVersion, requestId);
  return postJson(ENDPOINTS.messages, body);
}

/** V6-CTRL C：按调用方准备的完整请求体发送（网络结果未知后原样重放原载荷，不重建）。 */
export function postNoteBody(body: NoteRequest): Promise<WriteResponse> {
  return postJson(ENDPOINTS.notes, body);
}

/** V6-CTRL C：按调用方准备的完整请求体发送。 */
export function postMessageBody(body: MessageRequest): Promise<WriteResponse> {
  return postJson(ENDPOINTS.messages, body);
}

/** POST /api/v5-preview/demo/seed（演示控制·非业务操作）。 */
export function postSeed(scenario: ScenarioId): Promise<WriteResponse> {
  return postJson(ENDPOINTS.demoSeed, { scenario });
}

async function postJson(url: string, body: unknown): Promise<WriteResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // 未收到服务端确认：写入可能已达也可能未达；调用方保留草稿，原 requestId 重试幂等安全。
    throw new ApiFailure('NETWORK', 0, '网络异常：未收到服务端确认，内容已保留，可原样重试');
  }
  return readWriteResponse(response);
}

/** 统一把写入异常映射为 SubmitOutcome：conflict 时同步触发横幅与重新 GET（由调用方传入回调）。 */
export function writeOutcome(
  error: unknown,
  expectedVersion: number,
  onConflict: (banner: string, toVersion: number) => void,
): SubmitOutcome {
  if (error instanceof ApiFailure) {
    if (error.code === 'VERSION_CONFLICT') {
      const r = resolveWriteConflict(expectedVersion, error.serverVersion);
      onConflict(r.banner, r.toVersion);
      return { outcome: 'conflict', fromVersion: r.fromVersion, toVersion: r.toVersion };
    }
    return { outcome: 'error', code: error.code, message: error.message };
  }
  return { outcome: 'error', code: 'UNKNOWN', message: error instanceof Error ? error.message : '未知错误（合成演示）' };
}
