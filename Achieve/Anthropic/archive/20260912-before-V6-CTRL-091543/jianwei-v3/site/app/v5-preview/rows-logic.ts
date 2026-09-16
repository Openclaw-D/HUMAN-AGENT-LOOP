// V5 ROWS · 纯逻辑层（整体为纯逻辑区：无 import、无 JSX、无 React 依赖）。
// test/v5-preview.test.mjs 直接以 --experimental-strip-types 动态 import 本文件真实执行，
// 因此本文件不得引入任何依赖；参数只使用可独立表达的基本类型。
// 全部数据为合成演示；不产生正式 Decision/Receipt。

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
 *  只有 ok 才允许清空；conflict/error 一律保留草稿。 */
export type SubmitOutcome =
  | { outcome: 'ok'; replayed: boolean }
  | { outcome: 'conflict'; fromVersion: number; toVersion: number }
  | { outcome: 'error'; code: string; message: string };
