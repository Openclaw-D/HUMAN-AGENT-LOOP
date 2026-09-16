// V5 ROWS · HTTP 客户端：唯一后端事实源 = /api/v5-preview/**（FROZEN 契约）。
// 仅消费 HTTP；不得 import lib/** 的运行时实现（共享类型经 import type 擦除）。
// localStorage/sessionStorage 不再是业务事实源；每次刷新/写入/轮询都以后端响应为准。

import { buildMessageBody, buildNoteBody, resolveWriteConflict, userFacingErrorMessage } from './rows-logic';
import type { WriteOutcomePending } from './rows-logic';
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
  story: '/api/v5-preview/demo/story',
  demoReset: '/api/v5-preview/demo/reset',
  sharedState: '/api/v5-preview/demo/shared-state',
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

// ---------------------------------------------------------------------------
// V6 NIGHT_SIMPLIFY · 固定演示主线（演示控制·非业务操作；CONTRACT §5）。
// 视图类型在此本地定义（隔离纪律：对 lib 仅允许 shared-types 的 type-only import）。
// ---------------------------------------------------------------------------

export interface StoryStepView {
  stepId: string;
  stepIndex: number;
  stepsTotal: number;
  stageIndex: number;
  stageLabel: string;
  title: string;
  hint: string | null;
  evidenceRefs: readonly string[];
  decision: {
    prompt: string;
    options: readonly { kind: 'confirm' | 'correct' | 'return'; label: string }[];
  } | null;
}

export interface StoryStateView {
  mode: 'story' | 'free';
  version: number;
  step: StoryStepView | null;
  freeNotice: string | null;
  /** REPAIR evening：共享尽调事实同步降级说明（remote 存储不可用时非 null）。 */
  sharedWarning?: string | null;
}

/** GET /api/v5-preview/demo/story → 固定演示状态（服务端签名推导；纯读）。 */
export async function fetchStoryState(): Promise<StoryStateView> {
  let response: Response;
  try {
    response = await fetch(ENDPOINTS.story, { cache: 'no-store' });
  } catch {
    throw new ApiFailure('NETWORK', 0, '网络异常：固定演示状态未加载');
  }
  if (!response.ok) throw await toApiFailure(response);
  const body: unknown = await response.json();
  const o = body as Partial<StoryStateView> & { ok?: unknown };
  if (o.ok !== true || (o.mode !== 'story' && o.mode !== 'free')) {
    throw new ApiFailure('BAD_RESPONSE', response.status, '固定演示状态格式异常（合成演示）');
  }
  return body as StoryStateView;
}

export interface StoryCommandResult {
  overview: ProjectOverview;
}

/** POST /api/v5-preview/demo/story（推进/人工决定；requestId 幂等 + expectedVersion + fromStepId 步骤门）。 */
export function postStoryCommand(body: {
  action: 'advance' | 'decide';
  requestId: string;
  expectedVersion: number;
  fromStepId: string;
  decision?: 'confirm' | 'correct' | 'return';
  note?: string;
}): Promise<StoryCommandResult> {
  return postJson(ENDPOINTS.story, body);
}

// ---------------------------------------------------------------------------
// V6 REPAIR evening · 共享尽调事实（接口冻结：REPAIR_20260914_EVENING/main/INTERFACE.md §2/§3）。
// ---------------------------------------------------------------------------

/** 单条 fixture 取代链的共享事实（domain = 冻结映射表投影）。 */
export interface SharedFactView {
  fixtureId: string;
  domain: string;
  chainVersion: number;
  status: 'unverified' | 'human_verified' | 'contested';
  title: string;
  evidenceId: string;
}

export interface SharedFactsView {
  ok: true;
  projectId: string;
  /** 当前专属演示会话（null = 尚未建立；尽调页优先使用该会话）。 */
  demoSessionId: string | null;
  sessionStatus: string | null;
  facts: SharedFactView[];
  pendingReview: { fixtureId: string; domain: string; reason: string; at: string }[];
  evidenceCount: number;
  reviewCount: number;
  /** remote 存储不可用时的诚实降级说明。 */
  sharedWarning?: string;
}

/** GET /api/v5-preview/demo/shared-state（读取可能触发服务端投影同步——INTERFACE §3 已声明）。 */
export async function fetchSharedFacts(): Promise<SharedFactsView> {
  let response: Response;
  try {
    response = await fetch(ENDPOINTS.sharedState, { cache: 'no-store' });
  } catch {
    throw new ApiFailure('NETWORK', 0, '网络异常：共享尽调事实未加载');
  }
  if (!response.ok) throw await toApiFailure(response);
  const body: unknown = await response.json();
  const o = body as Partial<SharedFactsView> & { ok?: unknown };
  if (o.ok !== true || !Array.isArray(o.facts)) {
    throw new ApiFailure('BAD_RESPONSE', response.status, '共享尽调事实格式异常（合成演示）');
  }
  return body as SharedFactsView;
}

/** POST /api/v5-preview/demo/reset —— 重开当前专属演示（主线回起点 + 清除专属会话数据；
 *  其他会话与真实记录不动）。演示控制·非业务操作。 */
export function postDemoReset(): Promise<WriteResponse> {
  return postJson(ENDPOINTS.demoReset, {});
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

/** 统一把写入异常映射为 SubmitOutcome：conflict 时同步触发横幅与重新 GET（由调用方传入回调）。
 *  V6 CP2-4：用户可见 message 统一经 userFacingErrorMessage 映射为中文，不透传内部字段。 */
export function writeOutcome(
  error: unknown,
  expectedVersion: number,
  onConflict: (banner: string, toVersion: number) => void,
): WriteOutcomePending {
  if (error instanceof ApiFailure) {
    if (error.code === 'VERSION_CONFLICT') {
      const r = resolveWriteConflict(expectedVersion, error.serverVersion);
      onConflict(r.banner, r.toVersion);
      return { outcome: 'conflict', fromVersion: r.fromVersion, toVersion: r.toVersion };
    }
    return { outcome: 'error', code: error.code, message: userFacingErrorMessage(error.code, error.message) };
  }
  return { outcome: 'error', code: 'UNKNOWN', message: userFacingErrorMessage('UNKNOWN', undefined) };
}
