// V6 远程尽调 · 服务逻辑（REMOTE_DD_LONG_RUN）。
// 与 rows 域（service.ts）模式同构：requestId 幂等（先于版本门）+ expectedVersion 乐观并发 +
// 失败关闭。错误复用 ApiErrorCode 语义（NOT_FOUND/VERSION_CONFLICT/REQUEST_MISMATCH/ROLE_FORBIDDEN/INVALID_INPUT/STORE_*）。
// 底线：模型 authority=none（模拟步骤显式标注）；客户陈述/模型提取/人工核实分开；
// 不产生可执行授信/期限/价格建议；负收益测试输入阻断推荐；证据原件不可覆盖。
import { v5PreviewJsonResponse, V5PreviewServiceError } from './service.ts';
import { hashV5Payload } from './store.ts';
import { readBoundedJsonBody } from '../bounded-json-body.ts';
import {
  readRemoteStoreState,
  persistRemoteStoreState,
  RemoteStoreError,
  type RemoteStoreState,
} from './remote-store.ts';
import {
  type AnnotationRecord,
  type CalculationInput,
  type CalculationRecord,
  type CalculationStatus,
  type EvidenceRecord,
  type RemoteDomainRole,
  type RemoteParticipant,
  type RemoteSessionRecord,
  type RemoteVideoState,
  type ReviewAction,
  type ReviewRecord,
} from './remote-types.ts';
import { appendTimelineEvent, type TimelineEventRecord } from './remote-timeline.ts';

const REVIEW_ACTIONS_EXT: readonly string[] = ['confirm', 'correct', 'request_resupply', 'request_retake', 'pause_round', 'escalate_human', 'resume_round'];
const PAUSE_BLOCKING_ACTIONS: readonly string[] = ['confirm', 'escalate_human'];
/** 判定"当前有效确认"被撤销的动作（F3）：其后旧 confirm 不再是当前有效资格，历史保留。 */
const DISQUALIFYING_ACTIONS: readonly string[] = ['request_retake', 'request_resupply', 'correct', 'escalate_human'];

export { v5PreviewJsonResponse };

const REMOTE_ERROR_STATUSES: Record<string, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  REQUEST_MISMATCH: 409,
  ROLE_FORBIDDEN: 403,
};

/** F2：会话暂停执行门错误（HTTP 409，独立错误码——与 VERSION_CONFLICT 语义分开）。 */
export class RemoteSessionPausedError extends Error {
  readonly code = 'SESSION_PAUSED';
  constructor(message: string) {
    super(message);
    this.name = 'RemoteSessionPausedError';
  }
}

export function remoteErrorResponse(error: unknown): Response {
  if (error instanceof RemoteSessionPausedError) {
    return v5PreviewJsonResponse({ ok: false, error: error.code, message: error.message }, 409);
  }
  if (error instanceof V5PreviewServiceError) {
    const payload: Record<string, unknown> = { ok: false, error: error.code, message: error.message };
    if (error.serverVersion !== undefined) payload.serverVersion = error.serverVersion;
    return v5PreviewJsonResponse(payload, REMOTE_ERROR_STATUSES[error.code] ?? 500);
  }
  if (error instanceof RemoteStoreError) {
    const status = error.code === 'REMOTE_STORE_CORRUPT' ? 500 : 500;
    return v5PreviewJsonResponse({ ok: false, error: error.code, message: error.message }, status);
  }
  return v5PreviewJsonResponse({ ok: false, error: 'STORE_UNAVAILABLE', message: '服务内部错误（合成演示存储不可用）' }, 500);
}

export async function readRemoteJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await readBoundedJsonBody(request);
  } catch {
    throw new V5PreviewServiceError('INVALID_INPUT', '请求体不是合法 JSON 或超出允许大小');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function err(code: Parameters<typeof serviceError>[0], message: string, serverVersion?: number): never {
  throw serviceError(code, message, serverVersion);
}

function serviceError(code: 'INVALID_INPUT' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'REQUEST_MISMATCH' | 'ROLE_FORBIDDEN', message: string, serverVersion?: number) {
  return new V5PreviewServiceError(code, message, serverVersion);
}

function nowIso(): string {
  return new Date().toISOString();
}

function reqString(body: Record<string, unknown>, key: string, maxLen: number): string {
  const v = body[key];
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) {
    err('INVALID_INPUT', `${key} 必须是非空 string（≤${maxLen}）`);
  }
  return v as string;
}

function reqInt(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) err('INVALID_INPUT', `${key} 必须是非负整数`);
  return v;
}

function sha256Of(canonical: string): string {
  return hashV5Payload(canonical);
}

function requireIdempotency(state: RemoteStoreState, requestId: string, payload: unknown): unknown | undefined {
  if (typeof requestId !== 'string' || requestId.trim().length === 0 || requestId.length > 64) {
    err('INVALID_INPUT', 'requestId 必须是非空 string（≤64）');
  }
  const hash = sha256Of(JSON.stringify(payload));
  const cached = state.idempotency.lookup(requestId);
  if (cached !== undefined) {
    if (cached.hash !== hash) err('REQUEST_MISMATCH', '同 requestId 但载荷不同：重试不得更换载荷');
    return cached.response;
  }
  return undefined;
}

/** 版本门（幂等之后、任何写入之前）。 */
function requireVersion(state: RemoteStoreState, expectedVersion: number): void {
  if (expectedVersion !== state.version) {
    err('VERSION_CONFLICT', `版本已更新：客户端持有 v${expectedVersion}，服务端为 v${state.version}；请重新 GET 后再试`, state.version);
  }
}

const PROJECT_ID = 'JW-2026-018'; // 冻结演示项目；跨项目引用一律拒绝（失败关闭）

const REVIEW_ACTIONS: readonly string[] = ['confirm', 'correct', 'request_resupply', 'request_retake', 'pause_round', 'escalate_human'];

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

interface ParticipantSpec {
  displayName: string;
  kind: 'jianwei' | 'business' | 'domain' | 'customer';
  domainRole: RemoteDomainRole;
  attendance: RemoteParticipant['attendance'];
}

const DEFAULT_PARTICIPANTS: ParticipantSpec[] = [
  { displayName: '见微 · 协调（合成）', kind: 'jianwei', domainRole: 'coordinator', attendance: 'live_only' },
  { displayName: '业务 · 王业务（合成）', kind: 'business', domainRole: 'business', attendance: 'live_only' },
  { displayName: '政策 · 楊政策（合成）', kind: 'domain', domainRole: 'policy', attendance: 'live_only' },
  { displayName: '信审 · 张信审（合成）', kind: 'domain', domainRole: 'credit', attendance: 'pending' },
  { displayName: '商务 · 陈商务（合成）', kind: 'domain', domainRole: 'commerce', attendance: 'pending' },
  { displayName: '资产 · 李资产（合成）', kind: 'domain', domainRole: 'asset', attendance: 'pending' },
  { displayName: '客户 · 实控人（合成）', kind: 'customer', domainRole: 'customer-actual-controller', attendance: 'on_site_declared' },
  { displayName: '客户 · 财务负责人（合成）', kind: 'customer', domainRole: 'customer-finance', attendance: 'on_site_declared' },
  { displayName: '客户 · 生产负责人（合成）', kind: 'customer', domainRole: 'customer-production', attendance: 'live_only' },
];

function defaultVideoState(): RemoteVideoState {
  return { provider: 'none', state: 'not_configured', message: '视频服务未接入：可查看会话信息，加入/采集不可用（不申请设备权限、不产生媒体流）' };
}

/** F2：暂停是服务端执行门——阻断模型推进与确认通过类动作；补证/纠正/查看不受限。 */
function requireNotPaused(session: RemoteSessionRecord): void {
  if (session.status === 'paused') {
    throw new RemoteSessionPausedError('本轮判断已暂停：模型推进与确认通过类动作被阻断；补证/纠正类动作仍可用（合成演示）');
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRemoteSession(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const title = reqString(body, 'title', 120);
  const state = readRemoteStoreState();
  const replay = requireIdempotency(state, requestId, { requestId, expectedVersion, title, op: 'create-session' });
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const session: RemoteSessionRecord = {
    sessionId: newId('rs'),
    projectId: PROJECT_ID,
    title,
    status: 'live',
    generation: 0,
    participants: DEFAULT_PARTICIPANTS.map((p) => ({
      participantId: newId('pt'),
      displayName: p.displayName,
      kind: p.kind,
      domainRole: p.domainRole,
      attendance: p.attendance,
      attendanceVerified: false,
      joined: false,
    })),
    video: defaultVideoState(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.sessions.push(session);
  state.version += 1;
  const response = { ok: true, session, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify({ requestId, expectedVersion, title, op: 'create-session' })), response });
  persistRemoteStoreState(state);
  return response;
}

export function getRemoteState(): Record<string, unknown> {
  const state = readRemoteStoreState();
  return {
    ok: true,
    remoteVersion: state.version,
    sessions: state.sessions,
    evidence: state.evidence,
    annotations: state.annotations,
    reviews: state.reviews,
    calculations: state.calculations,
    ruleConfig: state.ruleConfig,
  };
}

export function getRemoteSessionDetail(sessionId: string): Record<string, unknown> {
  const state = readRemoteStoreState();
  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在（跨项目会话不可访问）');
  const evidence = state.evidence.filter((e) => e.sessionId === sessionId);
  const annotations = state.annotations.filter((a) => a.sessionId === sessionId);
  const reviews = state.reviews.filter((r) => r.sessionId === sessionId);
  const calculations = state.calculations.filter((c) => c.sessionId === sessionId);
  // 复核/核实状态现算：最新确认针对当前版本 → human_verified；争议 → contested；否则 unverified。
  const evidenceWithStatus = evidence.map((e) => ({
    ...e,
    digestOf: e.digestOf ?? 'fixture_meta_legacy',
    verificationStatus: evidenceVerificationStatus(e, reviews),
    expired: evidenceExpired(e, evidence),
  }));
  // F4：结果过期现算——basedOn.remoteVersion < 当前 remoteVersion（方案/资料/规则变化）→ stale，历史不改写。
  const calculationsWithStale = calculations.map((c) => ({
    ...c,
    stale: c.basedOn !== undefined && c.basedOn.remoteVersion < state.version,
  }));
  // F3：标注/问题显示过期——所属证据已被取代（关联结果随之过期，不删历史）。
  const annotationsWithExpiry = annotations.map((a) => {
    const owner = evidence.find((e) => e.evidenceId === a.evidenceId);
    return { ...a, expired: owner !== undefined ? evidenceExpired(owner, evidence) : false };
  });
  return { ok: true, remoteVersion: state.version, session, evidence: evidenceWithStatus, annotations: annotationsWithExpiry, reviews, calculations: calculationsWithStale, ruleConfig: state.ruleConfig };
}

function evidenceVerificationStatus(e: EvidenceRecord, reviews: ReviewRecord[]): 'unverified' | 'human_verified' | 'contested' {
  // F3：按时间序判定"当前有效资格"——confirm 之后若发生撤销类动作（retake/resupply/correct/escalate），
  // 旧确认不再是当前有效资格（历史意见保留）；最新动作是 confirm → human_verified；有 correct 未闭合 → contested。
  const relevant = reviews
    .filter((r) => r.targetType === 'evidence' && r.targetId === e.evidenceId && r.targetVersion === e.version)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (relevant.length === 0) return 'unverified';
  const last = relevant[relevant.length - 1];
  if (last.action === 'correct') return 'contested';
  if (last.action === 'confirm') return 'human_verified';
  if (DISQUALIFYING_ACTIONS.includes(last.action)) return 'unverified';
  return 'unverified';
}

/** 过期 = 已被更新证据取代（request_retake/superseded 链）。 */
function evidenceExpired(e: EvidenceRecord, evidence: EvidenceRecord[]): boolean {
  return e.supersededBy !== null || evidence.some((other) => other.supersedes === e.evidenceId);
}

// ---------------------------------------------------------------------------
// 证据（合成 fixture 附着；原件不可覆盖）
// ---------------------------------------------------------------------------

interface FixtureSpec {
  fixtureId: string;
  title: string;
  width: number;
  height: number;
  label: string;
  accent: string;
}

export const FIXTURES: readonly FixtureSpec[] = [
  { fixtureId: 'fixture-inspection', title: '生产现场巡检照片（合成测试图形）', width: 800, height: 600, label: '合成测试证据 01 · 现场巡检', accent: '#5a6472' },
  { fixtureId: 'fixture-equipment', title: '设备清单与序列号（合成测试图形）', width: 800, height: 600, label: '合成测试证据 02 · 设备清单', accent: '#6b7280' },
  { fixtureId: 'fixture-contract', title: '合同要素页（合成测试图形）', width: 800, height: 600, label: '合成测试证据 03 · 合同要素', accent: '#71717a' },
];

export function getFixtureSpec(fixtureId: string): FixtureSpec | undefined {
  return FIXTURES.find((f) => f.fixtureId === fixtureId);
}

/** 确定性合成测试图形（SVG）：显著"合成测试证据"标记 + 网格 + 编号区块，供圈选/标疑演练。 */
export function renderFixtureSvg(fixtureId: string): string | undefined {
  const f = FIXTURES.find((item) => item.fixtureId === fixtureId);
  if (f === undefined) return undefined;
  const cells = [0, 1, 2, 3, 4, 5].map((i) => {
    const x = 40 + (i % 3) * 240;
    const y = 110 + Math.floor(i / 3) * 220;
    return `<rect x="${x}" y="${y}" width="200" height="150" fill="#f6f7f9" stroke="${f.accent}" stroke-width="2"/><text x="${x + 100}" y="${y + 80}" text-anchor="middle" font-size="18" fill="#374151">区块 ${i + 1}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f.width}" height="${f.height}" viewBox="0 0 ${f.width} ${f.height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect width="100%" height="64" fill="${f.accent}"/>
  <text x="24" y="40" font-size="24" fill="#ffffff" font-weight="bold">${f.label} · 合成演示，非真实现场</text>
  ${cells}
  <text x="24" y="${f.height - 20}" font-size="14" fill="#9ca3af">fixtureId: ${f.fixtureId} · 全部内容为确定性生成的测试图形，不含真实企业信息</text>
</svg>`;
}

export function attachEvidence(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const fixtureId = reqString(body, 'fixtureId', 64);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, fixtureId, op: 'attach-evidence' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在（跨项目会话不可访问）');
  if (session.projectId !== PROJECT_ID) err('NOT_FOUND', '跨项目证据不可访问');
  const fixture = FIXTURES.find((f) => f.fixtureId === fixtureId);
  if (fixture === undefined) err('INVALID_INPUT', '未知 fixtureId（仅允许明确标识的合成测试图形）');

  const sameFixtureCount = state.evidence.filter((e) => e.sessionId === sessionId && e.fixtureId === fixtureId).length;
  // F6：摘要 = 服务端实际返回原图字节的 SHA256（同一 fixture 字节确定 → 摘要稳定，不掺历史 ID）。
  const fixtureBytes = renderFixtureSvg(fixtureId) ?? '';
  const evidence: EvidenceRecord = {
    evidenceId: newId('ev'),
    projectId: PROJECT_ID,
    sessionId,
    fixtureId,
    title: `${fixture.title}${sameFixtureCount > 0 ? `（第 ${sameFixtureCount + 1} 次采集）` : ''}`,
    sourceType: 'simulation_fixture',
    capturedAt: nowIso(),
    receivedAt: nowIso(),
    mime: 'image/svg+xml',
    width: fixture.width,
    height: fixture.height,
    sha256: sha256Of(fixtureBytes),
    version: 1,
    supersededBy: null,
    digestOf: 'fixture_bytes',
  };
  state.evidence.push(evidence);
  state.version += 1;
  const response = { ok: true, evidence, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

/** 证据重拍/补充：新证据取代旧证据（旧原件不动，复核按链路显示过期）。 */
export function supersedeEvidence(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const evidenceId = reqString(body, 'evidenceId', 64);
  const fixtureId = reqString(body, 'fixtureId', 64);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, evidenceId, fixtureId, op: 'supersede-evidence' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在');
  const old = state.evidence.find((e) => e.evidenceId === evidenceId);
  if (old === undefined || old.sessionId !== sessionId) err('NOT_FOUND', '证据不存在（跨会话不可访问）');
  if (old.supersededBy !== null) err('INVALID_INPUT', '该证据已被取代');
  const fixture = FIXTURES.find((f) => f.fixtureId === fixtureId);
  if (fixture === undefined) err('INVALID_INPUT', '未知 fixtureId');

  const replacementBytes = renderFixtureSvg(fixtureId) ?? '';
  const replacement: EvidenceRecord = {
    evidenceId: newId('ev'),
    projectId: PROJECT_ID,
    sessionId,
    fixtureId,
    title: `${fixture.title}（重拍/补充，取代 ${evidenceId}）`,
    sourceType: 'simulation_fixture',
    capturedAt: nowIso(),
    receivedAt: nowIso(),
    mime: 'image/svg+xml',
    width: fixture.width,
    height: fixture.height,
    sha256: sha256Of(replacementBytes),
    version: 1,
    supersededBy: null,
    supersedes: evidenceId,
    digestOf: 'fixture_bytes',
  };
  // 建立取代链：旧记录不可变（只写 supersededBy 指针），新证据携带 supersedes 反向指针。
  old.supersededBy = replacement.evidenceId;
  state.evidence.push(replacement);
  state.version += 1;
  const response = { ok: true, evidence: replacement, superseded: evidenceId, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

// ---------------------------------------------------------------------------
// 标注（圈选标疑 + 提问；回复含模拟模型步骤）
// ---------------------------------------------------------------------------

function validateRect(body: Record<string, unknown>): { x: number; y: number; w: number; h: number } {
  const rect = body.rect;
  if (typeof rect !== 'object' || rect === null) err('INVALID_INPUT', 'rect 必须是对象');
  const r = rect as Record<string, unknown>;
  const out = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) };
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v) || v < 0 || v > 1) err('INVALID_INPUT', `rect.${k} 必须在 0..1（归一化坐标）`);
  }
  if (out.w <= 0.001 || out.h <= 0.001) err('INVALID_INPUT', 'rect.w/h 过小（无效圈选）');
  if (out.x + out.w > 1.0001 || out.y + out.h > 1.0001) err('INVALID_INPUT', 'rect 超出原图范围');
  return out;
}

export function createAnnotation(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const evidenceId = reqString(body, 'evidenceId', 64);
  const evidenceVersion = reqInt(body, 'evidenceVersion');
  const question = reqString(body, 'question', 2000);
  const rect = validateRect(body);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, evidenceId, evidenceVersion, question, rect, op: 'create-annotation' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const evidence = state.evidence.find((e) => e.evidenceId === evidenceId);
  if (evidence === undefined || evidence.sessionId !== sessionId) err('NOT_FOUND', '证据不存在（悬空标疑不可创建）');
  if (evidence.version !== evidenceVersion) {
    err('VERSION_CONFLICT', `证据版本已更新：客户端持有 v${evidenceVersion}，服务端为 v${evidence.version}`, state.version);
  }
  if (evidence.supersededBy !== null) err('INVALID_INPUT', '该证据已被重拍版本取代，请新证据上标疑');

  const annotation: AnnotationRecord = {
    annotationId: newId('an'),
    sessionId,
    evidenceId,
    evidenceVersion,
    rect,
    question,
    author: '业务 · 王业务（演示身份）',
    status: 'open',
    version: 1,
    createdAt: nowIso(),
    replies: [],
  };
  state.annotations.push(annotation);
  state.version += 1;
  const response = { ok: true, annotation, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

/** 确定性模拟模型步骤：按标注所属证据 fixture 与六角色轮转生成后续追问。
 *  显式标注 kind='model_simulation'，模型无正式权力、输出仅供参考；无随机、无外部调用。 */
const SIMULATED_FOLLOWUPS: readonly { role: RemoteDomainRole; text: string }[] = [
  { role: 'credit', text: '（模拟）请补充该区域对应的书面凭证编号与出具日期，以便与偿付覆盖口径核对。' },
  { role: 'policy', text: '（模拟）该区域与适用条件清单中的哪一项对应？如属例外路径请注明依据。' },
  { role: 'commerce', text: '（模拟）该区域涉及的价格要素是否有书面报价口径与有效期？' },
  { role: 'asset', text: '（模拟）该区域的设备现状与巡检安排如何对应？请说明拍照时间与设备位置。' },
  { role: 'business', text: '（模拟）请客户实控人在现场对该区域当场说明，并确认是否需要财务负责人补充。' },
];

export function replyAnnotation(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const annotationId = reqString(body, 'annotationId', 64);
  const kind = body.kind;
  const text = reqString(body, 'text', 2000);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, annotationId, kind, text, op: 'reply-annotation' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const annotation = state.annotations.find((a) => a.annotationId === annotationId);
  if (annotation === undefined || annotation.sessionId !== sessionId) err('NOT_FOUND', '标注不存在（跨会话不可访问）');
  const role = kind === 'model_simulation' ? 'model_simulation' : kind === 'business' ? 'business' : kind === 'domain' ? 'domain' : undefined;
  if (role === undefined) err('INVALID_INPUT', 'kind 必须是 model_simulation / business / domain');

  annotation.replies.push({
    replyId: newId('rp'),
    kind: role,
    author: role === 'model_simulation' ? '模型（模拟，authority=none）' : role === 'business' ? '业务 · 王业务（演示身份）' : '相关专业域（演示身份）',
    text,
    at: nowIso(),
  });
  annotation.version += 1;
  state.version += 1;
  const response = { ok: true, annotation, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

/** 确定性模拟：为一条标注生成最多 2 条后续追问（六角色轮转；SIMULATION 显式标注）。
 *  与其他写路径一致：requestId 幂等 + expectedVersion 门（rework-长程 R5 回归发现缺口后补齐）。 */
export function simulateFollowUps(body: Record<string, unknown>): Record<string, unknown> {
  const sessionId = reqString(body, 'sessionId', 64);
  const annotationId = reqString(body, 'annotationId', 64);
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, annotationId, op: 'simulate-followups' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);
  const session = state.sessions.find((sess) => sess.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在');
  // F2：暂停阻断模型推进（服务端门）。
  requireNotPaused(session);
  const annotation = state.annotations.find((a) => a.annotationId === annotationId);
  if (annotation === undefined || annotation.sessionId !== sessionId) err('NOT_FOUND', '标注不存在');
  if (annotation.replies.some((r) => r.kind === 'model_simulation')) {
    return { ok: true, simulated: false, reason: '该标注已有模拟追问（确定性 stub：每条标注只生成一轮）' };
  }
  const offset = state.annotations.indexOf(annotation) % SIMULATED_FOLLOWUPS.length;
  const picks = [SIMULATED_FOLLOWUPS[offset], SIMULATED_FOLLOWUPS[(offset + 2) % SIMULATED_FOLLOWUPS.length]];
  for (const pick of picks) {
    annotation.replies.push({
      replyId: newId('rp'),
      kind: 'model_simulation',
      author: `模型（模拟 · ${pick.role}，authority=none）`,
      text: pick.text,
      at: nowIso(),
    });
  }
  annotation.version += 1;
  state.version += 1;
  const response = { ok: true, simulated: true, annotation, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

// ---------------------------------------------------------------------------
// 人工复核（针对特定版本；更新/争议使旧确认过期）
// ---------------------------------------------------------------------------

export function createReview(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const targetType = body.targetType;
  const targetId = reqString(body, 'targetId', 64);
  const targetVersion = reqInt(body, 'targetVersion');
  const action = body.action;
  const opinion = reqString(body, 'opinion', 2000);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, targetType, targetId, targetVersion, action, opinion, op: 'create-review' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  if (targetType !== 'evidence' && targetType !== 'annotation') err('INVALID_INPUT', 'targetType 必须是 evidence / annotation');
  if (!REVIEW_ACTIONS_EXT.includes(action as string)) err('INVALID_INPUT', 'action 非法');
  const reviewAction = action as string as ReviewAction | 'resume_round';
  // F2：会话级执行门（服务端约束，非前端按钮）。
  const sessionForGate = state.sessions.find((sess) => sess.sessionId === sessionId);
  if (sessionForGate === undefined) err('NOT_FOUND', '会话不存在');
  if (reviewAction === 'resume_round') {
    if (sessionForGate.status !== 'paused') err('INVALID_INPUT', '会话未处于暂停状态，无需恢复');
  } else if (sessionForGate.status === 'paused') {
    // 暂停中：确认通过类（confirm/escalate_human）阻断；补证/纠正/重拍/暂停说明仍可用。
    if (PAUSE_BLOCKING_ACTIONS.includes(reviewAction)) {
      throw new RemoteSessionPausedError('本轮判断已暂停：确认通过类动作被阻断；补证/纠正类动作仍可用（合成演示）');
    }
  }
  if (targetType === 'evidence') {
    const evidence = state.evidence.find((e) => e.evidenceId === targetId);
    if (evidence === undefined || evidence.sessionId !== sessionId) err('NOT_FOUND', '证据不存在');
    if (evidence.version !== targetVersion) err('VERSION_CONFLICT', `复核针对的证据版本已变化：客户端 v${targetVersion}，服务端 v${evidence.version}`, state.version);
    // F3b：已被取代的旧证据不得再新增 confirm（历史确认保留，但不产生新的当前有效确认）。
    if (evidence.supersededBy !== null && reviewAction === 'confirm') {
      err('INVALID_INPUT', '该证据已被重拍/补充版本取代，不再接受新的确认；请对新版本复核（合成演示）');
    }
  } else {
    const annotation = state.annotations.find((a) => a.annotationId === targetId);
    if (annotation === undefined || annotation.sessionId !== sessionId) err('NOT_FOUND', '标注不存在');
    if (annotation.version !== targetVersion) err('VERSION_CONFLICT', `复核针对的标注版本已变化`, state.version);
  }

  const review: ReviewRecord = {
    reviewId: newId('rv'),
    sessionId,
    targetType: targetType as 'evidence' | 'annotation',
    targetId,
    targetVersion,
    action: reviewAction,
    opinion,
    reviewer: '人工复核（演示身份）',
    at: nowIso(),
  };
  state.reviews.push(review);
  // 复核副作用（最小、明确）：pause_round → paused + generation+1（在途结果隔离）；
  // resume_round → live（显式人工留痕）；request_retake 仅提示需要重拍（不自动创建证据）。
  let sessionStatus: RemoteSessionRecord['status'] | undefined;
  let generation = sessionForGate.generation;
  if (reviewAction === 'pause_round' && sessionForGate.status === 'live') {
    sessionForGate.status = 'paused';
    sessionForGate.generation += 1;
    generation = sessionForGate.generation;
    sessionStatus = 'paused';
  } else if (reviewAction === 'resume_round' && sessionForGate.status === 'paused') {
    sessionForGate.status = 'live';
    sessionForGate.generation += 1;
    generation = sessionForGate.generation;
    sessionStatus = 'live';
  }
  state.version += 1;
  const response = { ok: true, review, sessionStatus: sessionStatus ?? null, generation, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

/** 出席/现场状态人工确认：自报（on_site_declared）→ 按本轮依据确认（on_site_confirmed + verified）。
 *  证据/资料更新不会自动提升 attendance——确认由人做出。 */
export function confirmAttendance(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const participantId = reqString(body, 'participantId', 64);
  const state = readRemoteStoreState();
  const payload = { requestId, expectedVersion, sessionId, participantId, op: 'confirm-attendance' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在');
  const participant = session.participants.find((p) => p.participantId === participantId);
  if (participant === undefined) err('NOT_FOUND', '参会人不属于该会话');
  if (participant.attendance !== 'on_site_declared' && participant.attendance !== 'on_site_confirmed') {
    err('INVALID_INPUT', '仅自报现场（on_site_declared）的参会人可按本轮依据确认');
  }
  participant.attendance = 'on_site_confirmed';
  participant.attendanceVerified = true;
  session.updatedAt = nowIso();
  state.version += 1;
  const response = { ok: true, session, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}

// ---------------------------------------------------------------------------
// 规则配置（全部未配置）与经济性核算（不实现未确认公式）
// ---------------------------------------------------------------------------

export function getRuleConfig(): Record<string, unknown> {
  const state = readRemoteStoreState();
  return { ok: true, ruleConfig: state.ruleConfig };
}

const REQUIRED_CALC_INPUTS: readonly { key: string; label: string; unit: string }[] = [
  { key: 'schemeAmount', label: '方案金额', unit: '万元' },
  { key: 'schemeTermMonths', label: '期限', unit: '月' },
  { key: 'totalRent', label: '租金现金流合计（测试口径）', unit: '万元' },
  { key: 'fundingCost', label: '资金成本（测试口径）', unit: '万元' },
  { key: 'expectedCreditLoss', label: '预期信用损失（测试口径）', unit: '万元' },
  { key: 'operationCost', label: '运营及核验成本（测试口径）', unit: '万元' },
];

export function attemptCalculation(body: Record<string, unknown>): Record<string, unknown> {
  const requestId = reqString(body, 'requestId', 64);
  const expectedVersion = reqInt(body, 'expectedVersion');
  const sessionId = reqString(body, 'sessionId', 64);
  const state = readRemoteStoreState();
  // F4：幂等摘要覆盖全部影响结果的规范化业务输入（mode + inputs + 归属）；expectedVersion 不入摘要——
  // 版本合法推进后原样重试仍是同一请求（与 rows 域"完整原载荷重放"教训一致），换输入才 REQUEST_MISMATCH。
  const modeRaw = body.mode;
  const mode = modeRaw === undefined || modeRaw === null ? 'default' : String(modeRaw);
  const inputsRawEarly = Array.isArray(body.inputs) ? body.inputs : [];
  const payload = { requestId, sessionId, mode, inputs: inputsRawEarly, op: 'attempt-calculation' };
  const replay = requireIdempotency(state, requestId, payload);
  if (replay !== undefined) return replay as Record<string, unknown>;
  requireVersion(state, expectedVersion);

  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (session === undefined) err('NOT_FOUND', '会话不存在');
  // 契约 fixture 演示模式（显式）：仅接受 test_fixture 输入，验证"负收益阻断/正收益不放行"状态门，
  // 全程标注"测试输入，非实际核算"；不作为业务核算路径。
  const contractFixture = body.mode === 'contract_fixture';
  // 经济性口径未配置 → not_configured（缺配置不是通过；不编造公式/成本）。
  if (state.ruleConfig.layers.economics === null && !contractFixture) {
    const record = buildCalculationRecord(sessionId, 'not_configured', [
      '经济性口径未配置：收益指标、折现与税口径、风险成本与资本成本是否重复计入，须由业务 owner 确认后才能核算。',
    ], REQUIRED_CALC_INPUTS.map((i) => ({ label: i.label, value: null, unit: i.unit, source: 'unconfigured' as const, version: 0 })), state, { kind: 'none' });
    return respond(state, record, requestId, payload);
  }
  // 未配置路径之外：仅处理显式标注的合成 fixture 输入（测试输入，非实际核算）。
  const inputsRaw = body.inputs;
  if (!Array.isArray(inputsRaw)) err('INVALID_INPUT', 'inputs 必须是数组（test_fixture 输入）');
  const inputs: CalculationInput[] = [];
  for (const [i, raw] of (inputsRaw as unknown[]).entries()) {
    if (typeof raw !== 'object' || raw === null) err('INVALID_INPUT', `inputs[${i}] 必须是对象`);
    const o = raw as Record<string, unknown>;
    const label = reqString(o, 'label', 60);
    const value = o.value;
    const unit = reqString(o, 'unit', 20);
    if (o.source !== 'test_fixture') err('INVALID_INPUT', `inputs[${i}].source 必须是 test_fixture（不接受未经确认口径的真实数值）`);
    if (typeof value !== 'number' || !Number.isFinite(value)) err('INVALID_INPUT', `inputs[${i}].value 必须是有限数`);
    inputs.push({ label, value, unit, source: 'test_fixture', version: 1 });
  }
  const missing = REQUIRED_CALC_INPUTS.filter((req) => !inputs.some((i) => i.label === req.label));
  if (missing.length > 0) {
    const record = buildCalculationRecord(sessionId, 'missing_inputs',
      [`缺少关键输入：${missing.map((m) => m.label).join('、')}。缺失值不补 0、不由模型自填。`], inputs, state, { kind: 'none' });
    return respond(state, record, requestId, payload);
  }
  // 确定性算术观察（测试输入，非实际核算）：现金流合计 − 成本合计（资金成本+预期信用损失+运营成本）。
  const num = (label: string): number => inputs.find((i) => i.label === label)?.value as number;
  const totalCashFlow = num('租金现金流合计（测试口径）');
  const totalCost = num('资金成本（测试口径）') + num('预期信用损失（测试口径）') + num('运营及核验成本（测试口径）');
  const net = totalCashFlow - totalCost;
  const record = buildCalculationRecord(sessionId, net < 0 ? 'blocked' : 'ready_for_review', net < 0
    ? [`测试输入：预计现金流合计（${totalCashFlow}）低于成本合计（${totalCost}）——负收益方案不推荐执行（测试输入，非实际核算）。`]
    : [`测试输入：算术观察为正（${net}）；正收益不表示风险可接受——业务风险/证据充分性阈值未配置，仍不能放行（测试输入，非实际核算）。`],
    inputs, state, { kind: 'test_arithmetic_observation', totalCashFlow, totalCost, net });
  return respond(state, record, requestId, payload);
}

function buildCalculationRecord(
  sessionId: string,
  status: CalculationStatus,
  reasons: string[],
  inputs: CalculationInput[],
  state: RemoteStoreState,
  result: CalculationRecord['result'] = { kind: 'none' },
): CalculationRecord {
  const inputDigest = sha256Of(JSON.stringify(inputs));
  return {
    calcId: newId('calc'),
    sessionId,
    status,
    reasons,
    inputs,
    inputDigest,
    basedOn: { remoteVersion: state.version, ruleConfigStatus: state.ruleConfig.status, generation: currentGeneration(state, sessionId) },
    result,
    at: nowIso(),
    version: 1,
  };
}

function currentGeneration(state: RemoteStoreState, sessionId: string): number {
  return state.sessions.find((s) => s.sessionId === sessionId)?.generation ?? 0;
}

function respond(state: RemoteStoreState, record: CalculationRecord, requestId: string, payload: Record<string, unknown>): Record<string, unknown> {
  state.calculations.push(record);
  state.version += 1;
  const response = { ok: true, calculation: record, remoteVersion: state.version };
  state.idempotency.record({ requestId, hash: sha256Of(JSON.stringify(payload)), response });
  persistRemoteStoreState(state);
  return response;
}


// ---------------------------------------------------------------------------
// B：模型 provider adapter 契约（REMOTE_DD_REPAIR）
// 本期 fixed stub（providerKind='fixed_stub'，输出显式 SIMULATION）；真实适配器未配置 → not_configured。
// 结构化结果：ok / partial / failed / rejected——失败绝不回退生成 model_simulation 冒充成功。
// 注入 handler 为本地可控 fake（测试用），真实 provider 需用户凭证 + 用途确认（另行 Gate）。
// ---------------------------------------------------------------------------

export interface ModelProviderRequest {
  sessionId: string;
  annotationId: string;
  evidenceRef: { fixtureId: string; sha256: string; version: number };
  currentVersion?: number;
  sessionStatus?: string;
  domainRoles: readonly string[];
  purpose: string;
  requestId?: string;
  script?: string;
}

export interface ModelProviderResult {
  providerKind: 'fixed_stub' | 'simulation' | 'real';
  status: 'ok' | 'partial' | 'failed' | 'rejected';
  requestId?: string;
  replies: { kind: 'model_simulation'; domainRole: string; text: string; author: string }[];
  failureReason?: string;
}

const VALID_DOMAIN_ROLES_FOR_MODEL: readonly string[] = ['coordinator', 'business', 'policy', 'credit', 'commerce', 'asset'];

/**
 * 可选状态探测注入（generateFollowUps 第二参；缺省行为不变）：返回 null/undefined 表示无法判定（不阻断）。
 * provider 调用前探测一次（初判，退回请求快照字段）；await 完成后再次探测并以后者为准——
 * 会话在 await 期间变 paused / 证据版本过期时，ok/partial 结果必须改判 rejected，绝不把过期结果当成功返回。
 */
export type FollowUpStateProbe = () => { sessionStatus?: string; currentEvidenceVersion?: number } | null;

export function createModelProviderAdapter(options: {
  provider?: 'fixed_stub' | 'simulation' | 'real';
  handler?: (req: ModelProviderRequest) => Promise<unknown>;
  timeoutMs?: number;
}): {
  providerKind: 'fixed_stub' | 'simulation' | 'real';
  state: () => 'not_configured' | 'ready';
  generateFollowUps: (req: ModelProviderRequest, stateProbe?: FollowUpStateProbe) => Promise<ModelProviderResult>;
} {
  // 归一化：real 之外（fixed_stub/simulation/fake 本地测试替身）都按本地 fixed_stub 呈现；
  // 注入 handler 时为本地可控 fake provider（协议/故障测试通道），结果仍标 model_simulation。
  const providerKind = options.provider === 'real' ? 'real' : 'fixed_stub';
  const timeoutMs = options.timeoutMs ?? 5000;
  const replayCache = new Map<string, ModelProviderResult>();
  // 回放缓存键 = 完整规范化请求身份（requestId + annotationId + 证据引用 + 域/用途/脚本）：
  // 同 requestId 换 annotationId 等任何身份变化都不再命中旧缓存；sessionStatus/currentVersion 是状态
  // 快照而非请求身份，不入键（状态门每次调用现判，见下）。
  const cacheKeyOf = (req: ModelProviderRequest): string | undefined => {
    if (req.requestId === undefined) return undefined;
    return sha256Of(JSON.stringify({
      op: 'model-followups',
      requestId: req.requestId,
      sessionId: req.sessionId,
      annotationId: req.annotationId,
      evidenceRef: req.evidenceRef,
      domainRoles: req.domainRoles,
      purpose: req.purpose,
      script: req.script,
    }));
  };
  return {
    providerKind,
    state: () => (providerKind === 'fixed_stub' ? 'ready' : 'not_configured'),
    async generateFollowUps(req: ModelProviderRequest, stateProbe?: FollowUpStateProbe): Promise<ModelProviderResult> {
      // 初判（provider 调用前）：优先用探测值，无探测注入时退回请求快照字段（缺省行为不变）。
      const initialProbe = stateProbe !== undefined ? stateProbe() : null;
      const snapshotStatus = initialProbe?.sessionStatus ?? req.sessionStatus;
      const snapshotCurrentVersion = initialProbe?.currentEvidenceVersion ?? req.currentVersion;
      // 结构化拒绝（状态门，每次调用现判、不写入回放缓存——缓存只存 provider 原始输出）。
      // 版本过期与暂停同时成立时，以后者（证据版本过期）为准——与结果返回时的再判定同一顺序。
      const stateRejection = (status: string | undefined, currentVersion: number | undefined): ModelProviderResult | undefined => {
        if (currentVersion !== undefined && req.evidenceRef.version !== currentVersion) {
          return { providerKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: `evidence version expired（客户端 v${req.evidenceRef.version}，当前 v${currentVersion}）` };
        }
        if (status === 'paused') {
          return { providerKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: 'session paused（暂停中禁止模型推进）' };
        }
        return undefined;
      };
      const preGate = stateRejection(snapshotStatus, snapshotCurrentVersion);
      if (preGate !== undefined) return preGate;
      if (!req.evidenceRef.fixtureId || req.evidenceRef.fixtureId === 'nope' || !getFixtureSpec(req.evidenceRef.fixtureId)) {
        return { providerKind, status: 'rejected', requestId: req.requestId, replies: [], failureReason: `unknown evidence reference（fixtureId=${req.evidenceRef.fixtureId || 'empty'}）` };
      }
      // 结果返回时的当前状态再判定：ok/partial 必须按"此刻"探测复核后才可返回；
      // 缓存命中同样过此门（拒绝不覆盖缓存，恢复后同身份重试仍能取回 provider 原始输出）。
      const finalize = (result: ModelProviderResult): ModelProviderResult => {
        if (result.status !== 'ok' && result.status !== 'partial') return result;
        const probe = stateProbe !== undefined ? stateProbe() : null;
        if (probe === null || probe === undefined) return result;
        return stateRejection(probe.sessionStatus, probe.currentEvidenceVersion) ?? result;
      };
      // 回放缓存命中：返回 provider 原始输出，但仍过状态再判定与校验。
      const cacheKey = cacheKeyOf(req);
      if (cacheKey !== undefined) {
        const cached = replayCache.get(cacheKey);
        if (cached !== undefined) return finalize(cached);
      }
      const store = (result: ModelProviderResult): ModelProviderResult => {
        if (cacheKey !== undefined) replayCache.set(cacheKey, result);
        return result;
      };
      let raw: unknown;
      try {
        if (options.handler !== undefined) {
          // 本地可控 fake provider（协议/故障测试通道）：经同一契约与超时闸门。
          raw = await Promise.race([
            options.handler(req),
            new Promise((_r, rej) => setTimeout(() => rej(Object.assign(new Error('provider timeout'), { code: 'TIMEOUT' })), timeoutMs)),
          ]);
        } else if (providerKind === 'fixed_stub') {
          // 确定性 stub：无外部调用；按角色轮转固定表（与 simulateFollowUps 同源语义）
          raw = {
            followUps: SIMULATED_FOLLOWUPS.slice(0, 2).map((f) => ({ domainRole: f.role, text: f.text })),
          };
        } else {
          return store({ providerKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: 'provider not configured（not_configured）' });
        }
      } catch (error) {
        // 真实/注入失败：独立 failed，绝不生成 model_simulation 冒充成功
        const reason = (error as { code?: string })?.code === 'TIMEOUT' ? 'provider timeout（超时）' : `provider error（${(error as Error)?.message ?? 'unknown'}）`;
        return store({ providerKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: reason });
      }
      // 畸形/空结果：结构化失败，不冒充
      if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { followUps?: unknown }).followUps)) {
        return store({ providerKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: 'malformed provider response（格式错误：缺少 followUps 数组）' });
      }
      const followUps = (raw as { followUps: unknown[] }).followUps;
      const replies = followUps
        .filter((f): f is { domainRole: string; text: string } =>
          typeof f === 'object' && f !== null
          && VALID_DOMAIN_ROLES_FOR_MODEL.includes((f as { domainRole?: unknown }).domainRole as string)
          && typeof (f as { text?: unknown }).text === 'string')
        .map((f) => ({ kind: 'model_simulation' as const, domainRole: f.domainRole, text: f.text, author: `模型（模拟 · ${f.domainRole}，authority=none）` }));
      if (replies.length === 0) {
        return store({ providerKind, status: 'failed', requestId: req.requestId, replies: [], failureReason: 'empty or all-invalid provider output（空结果/全部无效）' });
      }
      const status = replies.length < followUps.length ? 'partial' : 'ok';
      return finalize(store({ providerKind, status, requestId: req.requestId, replies, ...(status === 'partial' ? { failureReason: '部分结果无效被过滤（partial）' } : {}) }));
    },
  };
}

// ---------------------------------------------------------------------------
// T：事件时间线与项目阶段（SA-R2-B1 · 最小接线）
// 仅追加 re-export 与一个服务端约束入口；不改任何既有函数行为、不改 store schema。
// 纯逻辑见 remote-timeline.ts（零 IO）；时间线是演示侧追加只读数据，由调用方持有（本模块不落盘）。
// ---------------------------------------------------------------------------

export {
  LIFECYCLE_ORDER,
  LIFECYCLE_PROGRESS_DISCLAIMER,
  DOMAIN_COLLABORATION_STEPS,
  projectLifecycle,
  lifecycleStageLabel,
  domainCollaborationSteps,
  collaborationStepLabel,
  appendTimelineEvent,
  formatTimelineEvent,
  predecessorAllows,
  routeConflict,
} from './remote-timeline.ts';
export type { LifecycleStage, CollaborationStep, ProfessionalGateStep, TimelineEventRecord, TimelineState, TimelineEventInput, ProjectLifecycleResult, PredecessorDecision, ConflictRouteResult } from './remote-timeline.ts';

/** 服务端时间线追加入口（INVALID_INPUT 语义）：包装纯逻辑 appendTimelineEvent，做服务端校验与只追加语义。
 *  不读写 store、不改既有行为；events 数组由调用方持有（演示数据）。
 *  level 仅保留申报值（缺失 → 'unknown'），不从身份/文本推断权限或职级。 */
export function appendRemoteTimelineEvent(events: TimelineEventRecord[], input: Record<string, unknown>): { event: TimelineEventRecord } {
  if (!Array.isArray(events)) err('INVALID_INPUT', 'events 必须是数组');
  const sessionId = reqString(input, 'sessionId', 64);
  const actor = reqString(input, 'actor', 80);
  const kind = reqString(input, 'kind', 40);
  const event = reqString(input, 'event', 500);
  const level = input.level;
  if (level !== undefined && (typeof level !== 'string' || level.length > 40)) {
    err('INVALID_INPUT', 'level 必须是非空 string（≤40）或省略（不推断权限/职级）');
  }
  const isOptionalText = (v: unknown): v is string | null | undefined => v === undefined || v === null || typeof v === 'string';
  const before = input.before;
  const after = input.after;
  const impact = input.impact;
  if (!isOptionalText(before) || !isOptionalText(after) || !isOptionalText(impact)) {
    err('INVALID_INPUT', 'before/after/impact 必须是 string / null / 省略');
  }
  const record = appendTimelineEvent({ events }, {
    sessionId,
    actor,
    kind,
    event,
    level: typeof level === 'string' ? level : undefined,
    before,
    after,
    impact,
  });
  return { event: record };
}

// R3-A-INT：R2_MODEL 冻结候选拉通入口（可选桥接，不改变本文件任何既有行为；默认仍为 fixed_stub）。
export { createBridgedModelAdapter } from './remote-model-adapter-bridge.ts';
