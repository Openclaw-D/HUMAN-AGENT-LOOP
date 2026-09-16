// V5 ROWS · 纯逻辑层（整体为纯逻辑区：无 import、无 JSX、无 React 依赖）。
// test/v5-preview.test.mjs 直接以 --experimental-strip-types 动态 import 本文件真实执行，
// 因此本文件不得引入任何依赖；参数只使用可独立表达的基本类型。
// 全部数据为合成演示；不执行正式审批。

/** 顶部"项目进展"灰度示意填充宽度（0..100）。按演示情景固定示意：
 *  approval≈1/3、post-rental≈3/4、settled=满；不显示数字、不代表任何计算口径。
 *  未知情景失败关闭返回 0（不猜测、不默认满格）。 */
export function scenarioProgressWidth(scenario: string): number {
  if (scenario === 'approval') return 34;
  if (scenario === 'post-rental') return 75;
  if (scenario === 'settled') return 100;
  return 0;
}

/** 冲突横幅文案：v旧 → v新。 */
export function formatVersionBanner(fromVersion: number, toVersion: number): string {
  return `状态已更新（v${fromVersion}→v${toVersion}），草稿已保留`;
}

export interface ConflictResolution {
  /** 409 时草稿一律保留（不丢弃用户已输入内容）。字面量 true，便于测试断言。 */
  keepDraft: true;
  /** 客户端必须立即重新 GET，用服务端最新版本重试。 */
  refresh: true;
  fromVersion: number;
  toVersion: number;
  banner: string;
}

/** 409 VERSION_CONFLICT 处理决策：保留草稿 + 生成横幅 + 重新 GET。
 *  serverVersion 缺失（异常响应）时退化为不带具体版本的横幅（不展示可能从未存在的版本号，
 *  P3-7）；toVersion 仍按 expectedVersion+1 兜底供"追上后撤横幅"判断。 */
export function resolveWriteConflict(expectedVersion: number, serverVersion: number | undefined): ConflictResolution {
  const valid = typeof serverVersion === 'number' && Number.isFinite(serverVersion);
  const toVersion = valid ? (serverVersion as number) : expectedVersion + 1;
  return {
    keepDraft: true,
    refresh: true,
    fromVersion: expectedVersion,
    toVersion,
    banner: valid
      ? formatVersionBanner(expectedVersion, toVersion)
      : '版本已更新，草稿已保留，可直接重试',
  };
}

/** requestId 引用生命周期（P1-2）：仅"结果未知"（NETWORK——未收到任何 HTTP 响应）时保留原
 *  requestId 供原样重试（服务端幂等，不重复记账）；任何确定性结果（成功 / 400 / 403 / 404 /
 *  409 / 5xx）都必须清空引用，下一次动作用新 requestId——否则同 requestId 携带新 expectedVersion
 *  会被服务端按换载荷误判 409 REQUEST_MISMATCH。未知异常一律按结果未知处理（保守可重放）。 */
export function keepRequestIdForRetry(errorCode: string): boolean {
  return errorCode === 'NETWORK';
}

// ---------------------------------------------------------------------------
// V6-CTRL C：网络结果未知后重放"完整原请求"，而非只保留 requestId + text。
// 原请求 = 首次发送时的 requestId + expectedVersion + todoId（notes）+ 原始文本的完整请求体。
// 轮询/刷新获得新版本后，同内容重试仍命中服务端幂等重放（不产生 REQUEST_MISMATCH）；
// 重放返回的旧 overview 是否应用由 shouldApplyOverview 决定（页面不回退）。
// ---------------------------------------------------------------------------

export interface PendingAttemptBody {
  requestId: string;
  expectedVersion: number;
  text: string;
}

/** 仅当本次输入与待重试请求的原始文本完全一致时，才复用完整原请求体；
 *  文本已被用户修改则返回 null（旧请求内容已被取代，按新请求发送）。 */
export function reuseAttemptBody<T extends PendingAttemptBody>(
  attempt: { text: string; body: T } | null,
  text: string,
): T | null {
  return attempt !== null && attempt.text === text ? attempt.body : null;
}

/** 重放返回的旧 overview 不得覆盖页面已获得的更新版本：仅当版本不低于当前页面事实源时应用。 */
export function shouldApplyOverview(nextVersion: number, currentVersion: number): boolean {
  return nextVersion >= currentVersion;
}

/** 写入/重放回执的情景上下文检查（R3/F2）：回执情景与**页面当前情景**
 *  （overviewRef.current.scenario，即真实当前上下文）不一致（情景已切换）→
 *  不得应用该回执的 overview——即使版本恰好相同或更高（seed 重置后版本可能碰撞），
 *  改为刷新取服务端真相。调用方必须传当前上下文；传"发送时情景快照"是接线错误
 *  （旧回执的 next.scenario 与发送时情景本来就相同，永远放行）。GET 响应是全局真相，不做此检查。 */
export function shouldApplyWriteResponse(nextScenario: string, currentScenario: string | null): boolean {
  return currentScenario === null || nextScenario === currentScenario;
}

// ---------------------------------------------------------------------------
// V6 BATCH_2 CP2-4：用户可见错误统一中文（不透传内部字段/堆栈/路径/内部错误码原文）。
// 服务端 message 仅在"安全白名单"场景透传；其余映射为固定中文话术。内部错误码仍保留在
// ApiFailure.code 供测试与协议使用，不进入用户可见文案。
// ---------------------------------------------------------------------------

/** 用户可见的服务端消息白名单：不含内部字段名/路径/异常细节的业务话术。 */
export function isSafeServerMessage(message: string): boolean {
  if (typeof message !== 'string' || message.length === 0 || message.length > 120) return false;
  if (/[{}<>]|at\s+\w+\s*\(|\.ts|\.js|node_modules|process\.|v5-preview|stack/i.test(message)) return false;
  // 含内部标识形态（如 "xxx：todo-device-list"、连字符英文 ID、路径片段）一律不透传。
  if (/[：:]\s*[A-Za-z0-9][A-Za-z0-9-]*$/.test(message.trim())) return false;
  if (/[a-z]+-[a-z]+-[a-z0-9]+/i.test(message)) return false;
  return /^[一-龥A-Za-z0-9（）()：:，,。；;、\s]+$/.test(message);
}

/** 写入/加载失败 → 用户可见中文文案。内部错误码映射固定话术；未知一律"服务暂不可用"。 */
export function userFacingErrorMessage(code: string, serverMessage: string | undefined): string {
  const safe = serverMessage !== undefined && isSafeServerMessage(serverMessage) ? serverMessage : undefined;
  switch (code) {
    case 'NETWORK':
      return '网络异常：无法连接演示服务，请稍后重试（内容已保留）';
    case 'VERSION_CONFLICT':
      return '状态已被其他窗口更新，请重试（草稿已保留）';
    case 'ROLE_FORBIDDEN':
      return safe ?? '当前演示身份无权执行该操作';
    case 'NOT_FOUND':
      return '该待办已不在可提交状态，请刷新后查看最新状态';
    case 'NO_OPEN_TODO':
      return safe ?? '当前情景没有开放待办';
    case 'REQUEST_MISMATCH':
      return safe ?? '请求状态不一致，请刷新后重试';
    case 'INVALID_INPUT':
      return '提交内容不符合要求，请检查后重试';
    case 'STORE_CORRUPT':
    case 'STORE_UNAVAILABLE':
      return '演示数据暂不可用，请稍后重试';
    default:
      return safe ?? '服务暂不可用，请稍后重试';
  }
}

/** 加载失败（首屏 GET）的固定中文文案。 */
export function userFacingLoadError(code: string, serverMessage: string | undefined): string {
  if (code === 'NETWORK') return '无法连接演示服务：请确认本地演示服务已启动，然后点击重试。';
  const safe = serverMessage !== undefined && isSafeServerMessage(serverMessage) ? serverMessage : undefined;
  return safe ?? '演示数据暂不可用，请稍后重试。';
}

export interface NoteBody {
  requestId: string;
  expectedVersion: number;
  todoId: string;
  text: string;
  /** 演示受控身份：前端固定以 business 提交；服务端只授权该角色，其他值 403。 */
  actorRole: 'business';
}

export interface MessageBody {
  requestId: string;
  expectedVersion: number;
  text: string;
  actorRole: 'business';
}

/** POST /api/v5-preview/notes 请求体构造（requestId 幂等；expectedVersion 乐观并发）。 */
export function buildNoteBody(todoId: string, text: string, expectedVersion: number, requestId: string): NoteBody {
  return { requestId, expectedVersion, todoId, text, actorRole: 'business' };
}

/** POST /api/v5-preview/messages 请求体构造。 */
export function buildMessageBody(text: string, expectedVersion: number, requestId: string): MessageBody {
  return { requestId, expectedVersion, text, actorRole: 'business' };
}

/** 请求幂等键：优先 crypto.randomUUID；不可用时降级为时间+随机串（合成演示仍全局唯一）。 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 抬头项目行：projectName 已含编号时只显示一次；未含编号时以 " · " 追加；编号为空则原样。 */
export function projectLine(projectName: string, projectCode: string): string {
  if (projectCode === '') return projectName;
  if (projectName.includes(projectCode)) return projectName;
  return `${projectName} · ${projectCode}`;
}

/** fromKind → 界面标签；未知值失败关闭原样显示，不猜测。 */
export function fromKindLabel(kind: string): string {
  if (kind === 'business') return '业务';
  if (kind === 'domain') return '专业域';
  if (kind === 'system') return '系统';
  return kind;
}

/** 段状态 → 中文说明（供 aria 文本与 title）；未知状态显式标"未知"，不自动视为完成。 */
export function segmentStateLabel(state: string): string {
  if (state === 'done') return '已完成';
  if (state === 'current') return '进行中';
  if (state === 'pending') return '未开始';
  return '未知';
}

/** 消息时间显示 HH:MM:SS（本地时区，合成演示）；非法时间原样返回，不抛错。 */
export function formatMessageTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 写入提交结果契约：todo-card / chat-panel 据此决定是否清空输入。
 *  只有 ok 才允许清空（且经草稿-请求关联判定）；conflict/error 一律保留草稿。
 *  requestId：请求真正发出（新建或重放）时携带——组件据此建立"草稿-请求关联"；
 *  被阻断的新提交（PENDING_REQUEST_EXISTS）不携带，阻断不得改写旧请求的关联（F1）。 */
export type SubmitOutcome =
  | { outcome: 'ok'; replayed: boolean; requestId: string }
  | { outcome: 'conflict'; fromVersion: number; toVersion: number; requestId: string }
  | { outcome: 'error'; code: string; message: string; requestId?: string };

/** writeOutcome 的中间结果（page 依据所有权与请求身份附加 requestId 后成为 SubmitOutcome）。 */
export type WriteOutcomePending =
  | { outcome: 'conflict'; fromVersion: number; toVersion: number }
  | { outcome: 'error'; code: string; message: string };

// ---------------------------------------------------------------------------
// V6 BATCH_2 rework-1：R1/R2/R3 交互恢复。
// 恢复记录 = "客户端待确认命令"（完整原载荷 + 上下文归属），仅存于 sessionStorage，
// 不是业务事实源；服务端幂等表 + 版本门仍是唯一真相。
// R1：刷新后按记录原样重放/确认，不再依赖内存引用或布尔哨兵。
// R2：说明与消息两条独立通道；同类第二次提交不静默覆盖旧记录。
// R3：回执按 requestId 所有权与草稿修订标识生效，不清后来编辑的新草稿。
// ---------------------------------------------------------------------------

/** 说明的恢复记录（首次发送前冻结的完整原载荷 + 情景归属）。 */
export interface StoredNoteRequest {
  kind: 'note';
  requestId: string;
  expectedVersion: number;
  todoId: string;
  text: string;
  /** 记录建立时的演示情景：情景变更即失效，旧回执不得挂上新情景。 */
  scenario: string;
  savedAt: number;
}

/** 消息的恢复记录（与说明互不混用）。 */
export interface StoredMessageRequest {
  kind: 'message';
  requestId: string;
  expectedVersion: number;
  text: string;
  scenario: string;
  savedAt: number;
}

export type StoredRequest = StoredNoteRequest | StoredMessageRequest;

/** 说明恢复槽位：valid=可确认的未知请求；limited=恢复受限（损坏/旧版哨兵，仅提示+显式清除）。 */
export type NoteRecoverySlot =
  | { status: 'valid'; record: StoredNoteRequest }
  | { status: 'limited'; reason: 'corrupt' | 'legacy' }
  | null;

/** 消息恢复槽位（与说明独立）。 */
export type MessageRecoverySlot =
  | { status: 'valid'; record: StoredMessageRequest }
  | { status: 'limited'; reason: 'corrupt' | 'legacy' }
  | null;

/** 恢复入口确认结果：ok=收到该请求的成功/幂等回执（可按关联清草稿）；
 *  failed=未完成（NETWORK 且请求仍被跟踪，可重试）；stale=陈旧确认（所有权已失效，
 *  静默——不产生任何新反馈）。requestId = 确认动作针对的请求。 */
export type ResolveResult = 'ok' | 'failed' | 'stale';

export interface ResolveOutcome {
  result: ResolveResult;
  requestId?: string;
}

/** 草稿-请求关联（F1）：请求真正发出（新建或重放）时冻结；被阻断的新提交不得改写。 */
export interface DraftRequestAssociation {
  requestId: string;
  revision: number;
}

/** F1：清空草稿的资格属于"确定的请求 + 其发送时草稿修订"。
 *  关联缺失、确认的 requestId 与关联不符（例如确认的是旧请求、期间被阻断的新草稿
 *  从未建立自己的关联）或草稿已被后续编辑（修订变化）→ 一律不清。
 *  这使"确认 A"永远不能用被阻断 B 的修订号授权清空。 */
export function shouldClearDraftForRequest(
  association: DraftRequestAssociation | null,
  confirmedRequestId: string | undefined,
  currentRevision: number,
): boolean {
  if (association === null || confirmedRequestId === undefined) return false;
  if (association.requestId !== confirmedRequestId) return false;
  return association.revision === currentRevision;
}

export type StoredParseStatus = 'not-json' | 'bad-shape' | 'bad-fields';

export type StoredParse<T> = { status: 'valid'; value: T } | { status: 'invalid'; reason: StoredParseStatus };

const STORED_SCENARIOS: readonly string[] = ['approval', 'post-rental', 'settled'];

/** 字段校验失败关闭：非法/缺失/超界一律拒绝恢复（不得当作有效请求）。 */
function storedString(o: Record<string, unknown>, key: string, maxLen: number): string | null {
  const v = o[key];
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) return null;
  return v;
}

function storedFieldsValid(o: Record<string, unknown>): boolean {
  if (typeof o.requestId !== 'string' || o.requestId.trim().length === 0 || o.requestId.length > 64) return false;
  if (typeof o.expectedVersion !== 'number' || !Number.isInteger(o.expectedVersion) || o.expectedVersion < 0) return false;
  if (typeof o.text !== 'string') return false;
  const trimmed = o.text.trim();
  if (trimmed.length === 0 || o.text.length > 2000) return false;
  if (typeof o.scenario !== 'string' || !STORED_SCENARIOS.includes(o.scenario)) return false;
  if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return false;
  return true;
}

function parseStoredRequest<T extends StoredRequest>(raw: string, kind: T['kind'], build: (o: Record<string, unknown>) => T | null): StoredParse<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'not-json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'invalid', reason: 'bad-shape' };
  }
  const o = parsed as Record<string, unknown>;
  // 类型不匹配（含旧版哨兵 '1'、另一通道的记录）一律 bad-shape，不得混用。
  if (o.kind !== kind) return { status: 'invalid', reason: 'bad-shape' };
  if (!storedFieldsValid(o)) return { status: 'invalid', reason: 'bad-fields' };
  const record = build(o);
  if (record === null) return { status: 'invalid', reason: 'bad-fields' };
  return { status: 'valid', value: record };
}

/** 解析说明恢复记录：合法 → 逐字段原样恢复；否则给出失败关闭原因（R1）。 */
export function parseStoredNoteRequest(raw: string): StoredParse<StoredNoteRequest> {
  return parseStoredRequest(raw, 'note', (o) => {
    const todoId = storedString(o, 'todoId', 200);
    if (todoId === null) return null;
    return {
      kind: 'note',
      requestId: o.requestId as string,
      expectedVersion: o.expectedVersion as number,
      todoId,
      text: o.text as string,
      scenario: o.scenario as string,
      savedAt: o.savedAt as number,
    };
  });
}

/** 解析消息恢复记录（R2：与说明独立）。 */
export function parseStoredMessageRequest(raw: string): StoredParse<StoredMessageRequest> {
  return parseStoredRequest(raw, 'message', (o) => ({
    kind: 'message',
    requestId: o.requestId as string,
    expectedVersion: o.expectedVersion as number,
    text: o.text as string,
    scenario: o.scenario as string,
    savedAt: o.savedAt as number,
  }));
}

/** 确认/重试的唯一依据：逐字重建首次发送的原载荷（expectedVersion 保持首次值，不得用当前版本重建）。 */
export function noteBodyFromRecord(record: StoredNoteRequest): NoteBody {
  return {
    requestId: record.requestId,
    expectedVersion: record.expectedVersion,
    todoId: record.todoId,
    text: record.text,
    actorRole: 'business',
  };
}

/** 同上（消息通道）。 */
export function messageBodyFromRecord(record: StoredMessageRequest): MessageBody {
  return { requestId: record.requestId, expectedVersion: record.expectedVersion, text: record.text, actorRole: 'business' };
}

export type RepeatSubmitVerdict = 'new' | 'replay' | 'block';

/** 同类型已有未知记录时的重复提交决策（R2）：
 *  new = 无未知记录，按新请求发送；replay = 同通道同内容，重放完整原请求（幂等安全）；
 *  block = 内容已被编辑 → 阻断并提示先确认旧请求（不静默覆盖旧恢复记录）。 */
export function decideRepeatSubmit(
  existing: StoredRequest | null,
  next: { kind: 'note'; todoId: string; text: string } | { kind: 'message'; text: string },
): RepeatSubmitVerdict {
  if (existing === null || existing.kind !== next.kind) return 'new';
  if (next.kind === 'note' && existing.kind === 'note') {
    return existing.todoId === next.todoId && existing.text === next.text ? 'replay' : 'block';
  }
  if (next.kind === 'message' && existing.kind === 'message') {
    return existing.text === next.text ? 'replay' : 'block';
  }
  return 'new';
}

/** 回执所有权（R2/R3）：只有当前记录仍是本请求时，回执才允许清理记录/影响草稿。
 *  接受恢复槽位（valid 才持有 requestId）或裸记录两种形状。 */
export function isSameRequestOwner(
  current: { requestId: string } | { status: 'valid'; record: StoredRequest } | { status: 'limited' } | null | undefined,
  requestId: string,
): boolean {
  if (current === null || current === undefined) return false;
  if ('status' in current) {
    return current.status === 'valid' && current.record.requestId === requestId;
  }
  return current.requestId === requestId;
}

/** 情景归属校验（R3）：记录建立时的情景与当前不一致 → 失效。 */
export function isStaleRecordScenario(record: StoredRequest, scenario: string): boolean {
  return record.scenario !== scenario;
}

/** 草稿清空判定（R3）：以提交时冻结的修订标识判定，不仅比较字符串——
 *  A→B→A 序列中最终 A 与已发送 A 字符串相同但修订号不同 → 不清。
 *  revisionAtSubmit = null（刷新后恢复的记录，无在会话修订关联）→ 不清。 */
export function shouldClearDraftAfterConfirmation(revisionAtSubmit: number | null, currentRevision: number): boolean {
  return revisionAtSubmit !== null && revisionAtSubmit === currentRevision;
}

/** 恢复行文案按类型区分（R2：消息不得再借说明的名义）。 */
export function pendingRequestRowText(kind: 'note' | 'message'): string {
  return kind === 'note'
    ? '有一条补充说明尚未确认结果（网络未收到回执）。'
    : '有一条项目沟通消息尚未确认结果（网络未收到回执）。';
}

/** 确认按钮文案按类型区分。 */
export function recoveryResolveLabel(kind: 'note' | 'message'): string {
  return kind === 'note' ? '确认说明结果' : '确认消息结果';
}

/** 同类型第二次提交被阻断时的明确提示（新草稿保留，旧记录不被覆盖）。 */
export function pendingRequestBlockMessage(kind: 'note' | 'message'): string {
  return kind === 'note'
    ? '已有一条补充说明尚未确认结果，请先点击“确认说明结果”核实后再提交新内容（本次未发送；草稿已保留）'
    : '已有一条项目沟通消息尚未确认结果，请先点击“确认消息结果”核实后再发送新内容（本次未发送；内容已保留）';
}

/** 恢复受限提示（R1）：记录损坏或旧版哨兵——明确不能自动确认，无虚假按钮、不猜测结果。 */
export function recoveryLimitedNotice(kind: 'note' | 'message', reason: 'corrupt' | 'legacy'): string {
  const noun = kind === 'note' ? '补充说明' : '项目沟通消息';
  if (reason === 'corrupt') {
    return `有一条${noun}的恢复信息已损坏，无法自动确认其结果；当前状态以服务端为准（可能包含或不包含该条内容）。`;
  }
  return `有一条${noun}的未确认结果来自旧版本标记，缺少完整请求信息，无法自动确认；当前状态以服务端为准。`;
}

/** 情景切换后旧记录失效的提示（R3）。 */
export function staleRecordNotice(kind: 'note' | 'message'): string {
  const noun = kind === 'note' ? '补充说明' : '项目沟通消息';
  return `演示情景已切换：此前情景的未确认${noun}已失效，不会在新情景中重放（合成演示）。`;
}

/** 陈旧回执（所属请求已被情景切换/新请求取代）不参与当前流程的提示。 */
export function staleRequestMessage(): string {
  return '该请求已随演示情景切换失效，未影响当前情景（合成演示）';
}

/** 确认动作遇到 VERSION_CONFLICT 的诚实结果（R1）：
 *  服务端幂等表查询先于版本门——重放 409 ⇒ 该 requestId 未落账 ⇒ 当前记录不含该条内容；
 *  不把冲突解释为"必然已落账"。 */
export function recoveryConflictNotice(kind: 'note' | 'message'): string {
  const verb = kind === 'note' ? '提交' : '发送';
  const noun = kind === 'note' ? '补充说明' : '项目沟通消息';
  return `该${noun}未能在原版本落账（当前演示记录不包含该条内容）；状态已更新，如仍需要请重新填写后${verb}（合成演示）。`;
}
