// V5 ROWS · 演示服务层（Backend worker 拥有本文件；契约见 V5/handoff/ROWS_FULLSTACK/IMPLEMENTATION.md §2/§3）。
// 全部数据为合成演示：不产生正式 Decision/Receipt；"待复核"不自动变绿；
// 业务 GET 投影只含业务可见字段；演示受控身份：服务端只授权 actorRole === 'business'。
// 命令路径（读文件 → 校验 → 同步改写 → 原子落盘）全程无 await 穿插，单进程内天然串行。

import type {
  ApiError,
  ApiErrorCode,
  DomainId,
  DomainRow,
  MessageRequest,
  NoteRequest,
  OverviewMessage,
  ProjectOverview,
  ScenarioId,
  SegmentState,
  TodoItem,
  WriteResponse,
} from './shared-types.ts';
import {
  hashV5Payload,
  readV5StoreState,
  V5IdempotencyTable,
  V5PreviewStoreError,
  writeV5StoreState,
} from './store.ts';
import { readBoundedJsonBody } from '../bounded-json-body.ts';

// ---------------------------------------------------------------------------
// 错误与 HTTP 映射（错误码/状态严格按 IMPLEMENTATION.md §2 错误码表）
// ---------------------------------------------------------------------------

export class V5PreviewServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly serverVersion?: number;

  constructor(code: ApiErrorCode, message: string, serverVersion?: number) {
    super(message);
    this.name = 'V5PreviewServiceError';
    this.code = code;
    this.serverVersion = serverVersion;
  }
}

const ERROR_STATUSES: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  BAD_SCENARIO: 400,
  ROLE_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  REQUEST_MISMATCH: 409,
  NO_OPEN_TODO: 409,
  STORE_CORRUPT: 500,
  STORE_UNAVAILABLE: 500,
};

export function v5PreviewJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function v5PreviewErrorResponse(error: unknown): Response {
  if (error instanceof V5PreviewServiceError) {
    const payload: ApiError = { ok: false, error: error.code, message: error.message };
    if (error.serverVersion !== undefined) {
      payload.serverVersion = error.serverVersion;
    }
    return v5PreviewJsonResponse(payload, ERROR_STATUSES[error.code]);
  }
  if (error instanceof V5PreviewStoreError) {
    const payload: ApiError = { ok: false, error: error.code, message: error.message };
    return v5PreviewJsonResponse(payload, ERROR_STATUSES[error.code]);
  }
  // 未知内部错误：不泄露细节，按存储不可用失败关闭（错误码表无其他 500 分支）。
  const payload: ApiError = { ok: false, error: 'STORE_UNAVAILABLE', message: '服务内部错误（合成演示存储不可用）' };
  return v5PreviewJsonResponse(payload, 500);
}

/** 请求体安全读取：解析失败/超限 → 400 INVALID_INPUT；非对象 JSON 归一为 {} 由字段校验失败关闭。 */
export async function readV5PreviewJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await readBoundedJsonBody(request);
  } catch {
    throw new V5PreviewServiceError('INVALID_INPUT', '请求体不是合法 JSON 或超出允许大小');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 种子数据（合成，IMPLEMENTATION.md §3；三情景共用同一演示项目抬头）
// ---------------------------------------------------------------------------

const SCENARIO_SEED_VERSIONS: Record<ScenarioId, number> = {
  approval: 7,
  'post-rental': 23,
  settled: 41,
};

const SCENARIO_LABELS: Record<ScenarioId, string> = {
  approval: '演示项目 · 审批推进中',
  'post-rental': '演示项目 · 起租后资产管理',
  settled: '演示项目 · 已结清（演示）',
};

const SCENARIOS: readonly ScenarioId[] = ['approval', 'post-rental', 'settled'];

function asScenario(value: unknown): ScenarioId | undefined {
  return typeof value === 'string' && (SCENARIOS as readonly string[]).includes(value)
    ? (value as ScenarioId)
    : undefined;
}

function row(
  domainId: DomainId,
  name: string,
  segmentLabels: [string, string, string, string],
  segments: [SegmentState, SegmentState, SegmentState, SegmentState],
  judgmentStatus: DomainRow['judgmentStatus'],
  judgmentText: string,
  summary: string,
): DomainRow {
  return { domainId, name, segmentLabels, segments, judgmentStatus, judgmentText, summary };
}

/** 三情景种子（§3 逐项照抄；摘要/详情中未冻结的措辞均标注"合成"）。 */
export function createSeedOverview(scenario: ScenarioId, nowIso?: string): ProjectOverview {
  const at = nowIso ?? new Date().toISOString();
  const base = {
    projectId: 'JW-2026-018',
    customerName: '远山精密制造',
    projectCode: 'JW-2026-018',
    projectName: '新客回租 · JW-2026-018',
    scenario,
    scenarioLabel: SCENARIO_LABELS[scenario],
    version: SCENARIO_SEED_VERSIONS[scenario],
    updatedAt: at,
  };

  if (scenario === 'approval') {
    const domains: DomainRow[] = [
      row('policy', '政策', ['适用条件', '灰区识别', '例外路径', '准出意见'], ['done', 'done', 'done', 'done'], 'green', '已确认', '适用条件已确认（合成）'),
      row('credit', '信审', ['材料齐备性', '一致性核验', '偿付覆盖', '信审意见'], ['done', 'done', 'pending', 'pending'], 'yellow', '待补充', '补充设备清单后继续核验（合成）'),
      row('commerce', '商务', ['条件框架', '价格要素', '期限要素', '起租条件'], ['current', 'pending', 'pending', 'pending'], 'gray', '准备中', '合同要素同步准备（合成；无正式前序被绕过）'),
      row('asset', '资产', ['标的确认', '权属核验', '交付与起租', '巡检与结清'], ['pending', 'pending', 'pending', 'pending'], 'gray', '待启动', '起租后持续管理至结清（合成）'),
    ];
    const messages: OverviewMessage[] = [
      { id: 'msg-seed-approval-1', fromKind: 'system', fromName: '系统', text: '合成演示项目已初始化：本页全部为合成数据，交互预览不产生正式 Decision/Receipt。', at, marks: ['演示情景'] },
      { id: 'msg-seed-approval-2', fromKind: 'domain', fromName: '信审 · 张信审（合成）', text: '请补充设备清单，资料更新后我们同步推进专业判断。', at, marks: ['合成判断'] },
    ];
    return {
      ...base,
      overall: {
        progressLabel: '审批推进中',
        description: '政策已确认，信审待补充设备清单；总项目以资产管理流程结束为终点（合成演示，不使用数字总进度）',
      },
      domains,
      todo: {
        id: 'todo-device-list',
        title: '补充设备清单',
        detail: '资料更新后，同步相关专业判断；提交后信审转入待复核（合成演示）。',
        status: '待补充',
        relatedDomain: 'credit',
      },
      messages,
    };
  }

  if (scenario === 'post-rental') {
    const domains: DomainRow[] = [
      row('policy', '政策', ['适用条件', '灰区识别', '例外路径', '准出意见'], ['done', 'done', 'done', 'done'], 'green', '已确认', '适用条件已确认（合成）'),
      row('credit', '信审', ['材料齐备性', '一致性核验', '偿付覆盖', '信审意见'], ['done', 'done', 'done', 'done'], 'green', '已通过', '设备清单已补充，核验完成（合成）'),
      row('commerce', '商务', ['条件框架', '价格要素', '期限要素', '起租条件'], ['done', 'done', 'done', 'done'], 'green', '已起租', '起租条件已满足，合同已起租（合成）'),
      row('asset', '资产', ['标的确认', '权属核验', '交付与起租', '巡检与结清'], ['done', 'done', 'current', 'pending'], 'yellow', '观察中', '首期巡检待确认（合成）'),
    ];
    const messages: OverviewMessage[] = [
      { id: 'msg-seed-post-rental-1', fromKind: 'system', fromName: '系统', text: '演示时间线已起租：资产域进入持续管理，直至结清（合成数据）。', at, marks: ['演示情景'] },
      { id: 'msg-seed-post-rental-2', fromKind: 'domain', fromName: '资产 · 李资产（合成）', text: '请确认首期巡检安排，确认后我们跟进现场。', at, marks: ['合成判断'] },
    ];
    return {
      ...base,
      overall: {
        progressLabel: '起租后资产管理',
        description: '演示时间线已起租；资产域持续管理至结清（合成演示，起租后总进度不写死）',
      },
      domains,
      todo: {
        id: 'todo-inspection',
        title: '确认首期巡检安排',
        detail: '巡检安排确认后，资产域继续跟进观察（合成演示）。',
        status: '待补充',
        relatedDomain: 'asset',
      },
      messages,
    };
  }

  // settled：全生命周期演示终点，无开放待办（notes → 409 NO_OPEN_TODO；messages 仍可追加留档）。
  const domains: DomainRow[] = [
    row('policy', '政策', ['适用条件', '灰区识别', '例外路径', '准出意见'], ['done', 'done', 'done', 'done'], 'green', '已确认', '适用条件已确认（合成）'),
    row('credit', '信审', ['材料齐备性', '一致性核验', '偿付覆盖', '信审意见'], ['done', 'done', 'done', 'done'], 'green', '已通过', '信审核验已通过（合成）'),
    row('commerce', '商务', ['条件框架', '价格要素', '期限要素', '起租条件'], ['done', 'done', 'done', 'done'], 'green', '已结清', '商务条款已履行完毕（合成）'),
    row('asset', '资产', ['标的确认', '权属核验', '交付与起租', '巡检与结清'], ['done', 'done', 'done', 'done'], 'green', '已结清', '资产管理流程已结束（合成）'),
  ];
  const messages: OverviewMessage[] = [
    { id: 'msg-seed-settled-1', fromKind: 'system', fromName: '系统', text: '全生命周期演示终点：项目已结清（演示）。沟通仍可追加留档，不再产生业务待办。', at, marks: ['演示情景'] },
  ];
  return {
    ...base,
    overall: {
      progressLabel: '已结清（演示）',
      description: '全生命周期演示终点：资产管理流程结束（合成）',
    },
    domains,
    todo: null,
    messages,
  };
}

// ---------------------------------------------------------------------------
// 投影（GET）：业务可见，无任何专业细节字段
// ---------------------------------------------------------------------------

export function getProjectOverview(): ProjectOverview {
  const state = readV5StoreState({ seed: () => createSeedOverview('approval') });
  return state.overview;
}

// ---------------------------------------------------------------------------
// 字段校验（失败关闭；错误语义按 §2 错误码表）
// ---------------------------------------------------------------------------

function asRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 64) {
    return undefined;
  }
  return value;
}

function asExpectedVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** text：trim 后非空且 ≤2000；返回 trim 后的展示文本。 */
function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    return undefined;
  }
  return trimmed;
}

/** 角色值校验（主控裁决 DEFECT-3："缺=400，错值=403"）：
 *  存在性与类型已在结构校验阶段完成（非 string → 400 INVALID_INPUT）；
 *  这里只处理"字段存在但值 ≠ 'business'" → 403 ROLE_FORBIDDEN（自称其他角色不放行）。 */
function requireBusinessActor(value: unknown): void {
  if (value !== 'business') {
    throw new V5PreviewServiceError('ROLE_FORBIDDEN', '演示受控身份：服务端只授权 business 角色（自称其他角色不放行）');
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 幂等查询：同 requestId 同载荷 → 重放原响应；同 requestId 异载荷 → 409 REQUEST_MISMATCH。 */
function resolveIdempotentReplay(
  state: ReturnType<typeof readV5StoreState>,
  requestId: string,
  hash: string,
): WriteResponse | undefined {
  const cached = state.idempotency.lookup(requestId);
  if (cached === undefined) {
    return undefined;
  }
  if (cached.hash !== hash) {
    throw new V5PreviewServiceError('REQUEST_MISMATCH', '同 requestId 但载荷不同：重试不得更换载荷');
  }
  return { ...cached.response, replayed: true };
}

// ---------------------------------------------------------------------------
// notes 命令（验收闭环：黄灯补件 → 提交 → 待复核，不自动变绿）
// ---------------------------------------------------------------------------

export function submitNote(body: Record<string, unknown>): WriteResponse {
  // 第一层：必填字段存在性与类型（含 actorRole；缺失/类型错 → 400，主控裁决 DEFECT-3）。
  const requestId = asRequestId(body.requestId);
  const expectedVersion = asExpectedVersion(body.expectedVersion);
  const todoId = typeof body.todoId === 'string' && body.todoId.trim().length > 0 ? body.todoId : undefined;
  const text = asText(body.text);
  const actorRoleIsString = typeof body.actorRole === 'string';
  if (
    requestId === undefined ||
    expectedVersion === undefined ||
    todoId === undefined ||
    text === undefined ||
    !actorRoleIsString
  ) {
    throw new V5PreviewServiceError(
      'INVALID_INPUT',
      'notes 请求字段非法：requestId(1..64)、expectedVersion(整数)、todoId(非空)、text(1..2000，trim 后非空)、actorRole(string) 均为必填',
    );
  }
  // 第二层：字段存在但角色值错误 → 403。
  requireBusinessActor(body.actorRole);

  const state = readV5StoreState({ seed: () => createSeedOverview('approval') });
  // 哈希覆盖原始语义载荷（含原始 text，未 trim）：同 requestId 重试换载荷即 409。
  const hash = hashV5Payload(
    JSON.stringify({ requestId, expectedVersion, todoId, text: body.text, actorRole: body.actorRole }),
  );
  const replay = resolveIdempotentReplay(state, requestId, hash);
  if (replay !== undefined) {
    return replay;
  }

  const overview = state.overview;
  // 版本门在 todo 状态检查之前：客户端版本过期时一律 409+serverVersion 要求重新 GET
  // （否则待办转入"待复核"后，过期版本的提交会被误判为 NOT_FOUND）。
  if (expectedVersion !== overview.version) {
    throw new V5PreviewServiceError(
      'VERSION_CONFLICT',
      `版本已更新：客户端持有 v${expectedVersion}，服务端为 v${overview.version}；请重新 GET 后再试（草稿已保留）`,
      overview.version,
    );
  }
  if (overview.todo === null) {
    throw new V5PreviewServiceError('NO_OPEN_TODO', '当前情景没有开放待办（如已结清），不能提交补充说明');
  }
  if (todoId !== overview.todo.id || overview.todo.status !== '待补充') {
    throw new V5PreviewServiceError('NOT_FOUND', `待办不存在或已非开放状态：${todoId}`);
  }

  const at = nowIso();
  const next: ProjectOverview = structuredClone(overview);
  next.version = overview.version + 1;
  next.updatedAt = at;
  // overview.todo 已收窄为非空；structuredClone 后 TS 不保留属性收窄，故用浅拷贝显式重建。
  const nextTodo: TodoItem = { ...overview.todo, status: '待复核' };
  next.todo = nextTodo;
  // 相关专业域转入"待复核"但仍为黄灯：不自动变绿，等待真实专业复核（合成演示不产生正式 Decision）。
  const relatedDomain: DomainId | null = nextTodo.relatedDomain;
  if (relatedDomain !== null) {
    const domain = next.domains.find((item) => item.domainId === relatedDomain);
    if (domain !== undefined) {
      domain.judgmentText = '待复核';
    }
  }
  next.messages = [
    ...next.messages,
    { id: `msg-note-${requestId}`, fromKind: 'business', fromName: '业务（演示身份）', text, at, marks: ['补充说明'] },
    {
      id: `msg-note-sys-${requestId}`,
      fromKind: 'system',
      fromName: '系统',
      text: '已记录补充说明：相关域判断转入待复核。合成演示，不产生正式 Decision/Receipt。',
      at,
      marks: ['演示情景'],
    },
  ];

  const response: WriteResponse = { ok: true, overview: next };
  state.idempotency.record({ requestId, hash, response });
  writeV5StoreState({ overview: next, idempotency: state.idempotency });
  return response;
}

// ---------------------------------------------------------------------------
// messages 命令（项目沟通；已结清情景仍可追加留档）
// ---------------------------------------------------------------------------

export function postMessage(body: Record<string, unknown>): WriteResponse {
  // 第一层：必填字段存在性与类型（含 actorRole；缺失/类型错 → 400，主控裁决 DEFECT-3）。
  const requestId = asRequestId(body.requestId);
  const expectedVersion = asExpectedVersion(body.expectedVersion);
  const text = asText(body.text);
  const actorRoleIsString = typeof body.actorRole === 'string';
  if (requestId === undefined || expectedVersion === undefined || text === undefined || !actorRoleIsString) {
    throw new V5PreviewServiceError(
      'INVALID_INPUT',
      'messages 请求字段非法：requestId(1..64)、expectedVersion(整数)、text(1..2000，trim 后非空)、actorRole(string) 均为必填',
    );
  }
  // 第二层：字段存在但角色值错误 → 403。
  requireBusinessActor(body.actorRole);

  const state = readV5StoreState({ seed: () => createSeedOverview('approval') });
  const hash = hashV5Payload(
    JSON.stringify({ requestId, expectedVersion, text: body.text, actorRole: body.actorRole }),
  );
  const replay = resolveIdempotentReplay(state, requestId, hash);
  if (replay !== undefined) {
    return replay;
  }

  const overview = state.overview;
  const at = nowIso();
  const next: ProjectOverview = structuredClone(overview);
  next.version = overview.version + 1;
  next.updatedAt = at;
  next.messages = [
    ...next.messages,
    { id: `msg-biz-${requestId}`, fromKind: 'business', fromName: '业务（演示身份）', text, at, marks: ['项目沟通'] },
  ];

  const response: WriteResponse = { ok: true, overview: next };
  state.idempotency.record({ requestId, hash, response });
  writeV5StoreState({ overview: next, idempotency: state.idempotency });
  return response;
}

// ---------------------------------------------------------------------------
// seed 命令（演示控制·非业务操作）：重置为该情景种子、幂等表清空、version = 种子版本。
// 损坏文件不被 seed 静默掩盖：先读（损坏即 STORE_CORRUPT），再重置。
// ---------------------------------------------------------------------------

export function seedScenario(body: Record<string, unknown>): WriteResponse {
  const scenario = asScenario(body.scenario);
  if (scenario === undefined) {
    throw new V5PreviewServiceError('BAD_SCENARIO', `scenario 非法：必须是 approval / post-rental / settled 之一`);
  }
  // 先读当前状态：文件损坏时失败关闭（不静默重置），与 GET/写入路径一致。
  readV5StoreState({ seed: () => createSeedOverview('approval') });
  const fresh = createSeedOverview(scenario);
  // 幂等表清空：seed 后旧 requestId 不再命中重放/冲突。
  writeV5StoreState({ overview: fresh, idempotency: new V5IdempotencyTable() });
  return { ok: true, overview: fresh };
}

// 请求体类型仅在文档意义上引用，防止未使用告警（NoteRequest/MessageRequest 为消费方契约）。
export type { MessageRequest, NoteRequest };
