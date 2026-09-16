// V5 ROWS · 前后端共享契约类型（FROZEN by 主 Agent，2026-09-11 Rev2）。
// 本文件是前端（app/v5-preview/**）与后端（lib/v5-preview 服务、app/api/v5-preview/**）共用的
// 唯一类型事实源；由主 Agent 独占修改，worker 不得改写，接口变更须经主 Agent 通知所有消费方。
// 全部数据为合成演示；不产生正式 Decision/Receipt；演示身份 ≠ 生产鉴权。

export type DomainId = 'policy' | 'credit' | 'commerce' | 'asset';

/** 域内分段灰度状态：done=深灰（已完成）/ current=中灰（进行中）/ pending=浅灰（未到）。不折算数字进度。 */
export type SegmentState = 'done' | 'current' | 'pending';

/** 判断状态灯：红黄绿仅用于判断状态；未开始/未知=灰色+文字，不得默认绿灯。 */
export type JudgmentStatus = 'green' | 'yellow' | 'red' | 'gray';

/** 生命周期合成情景（演示控制切换，不是业务操作）。 */
export type ScenarioId = 'approval' | 'post-rental' | 'settled';

export interface DomainRow {
  domainId: DomainId;
  name: string;
  /** 恰好 4 段；含义按域与情景配置（segmentLabels），不跨域强行同名。 */
  segmentLabels: [string, string, string, string];
  segments: [SegmentState, SegmentState, SegmentState, SegmentState];
  judgmentStatus: JudgmentStatus;
  /** 状态灯文字：已确认/待补充/待复核/准备中/待启动/观察中/已结清（演示）等。 */
  judgmentText: string;
  /** 业务可见一句话说明（不含专业细节）。 */
  summary: string;
}

export type TodoStatus = '待补充' | '待复核' | '已完成（演示）' | '已结清（演示）';

export interface TodoItem {
  id: string;
  title: string;
  detail: string;
  status: TodoStatus;
  relatedDomain: DomainId | null;
}

export interface OverviewMessage {
  id: string;
  fromKind: 'business' | 'domain' | 'system';
  fromName: string;
  text: string;
  /** ISO 时间字符串 */
  at: string;
  /** 标记：如 ['合成判断']、['演示情景'] */
  marks: string[];
}

export interface ProjectOverview {
  projectId: string;
  /** 客户/项目抬头（合成）：客户名、项目编号、模式 */
  customerName: string;
  projectCode: string;
  projectName: string;
  scenario: ScenarioId;
  scenarioLabel: string;
  /** 每次被接受的写入递增；seed 重置为该情景种子版本。 */
  version: number;
  updatedAt: string;
  /** 整体里程碑：文字表达（如 审批推进中），不发明数字总进度。 */
  overall: { progressLabel: string; description: string };
  /** 恒 4 条，顺序 政策/信审/商务/资产。 */
  domains: DomainRow[];
  todo: TodoItem | null;
  /** 业务可见消息，时间正序。 */
  messages: OverviewMessage[];
}

/** POST /api/v5-preview/notes 请求体。requestId 幂等；expectedVersion 乐观并发。 */
export interface NoteRequest {
  requestId: string;
  expectedVersion: number;
  todoId: string;
  /** 1..2000 字符（trim 后非空）。 */
  text: string;
  /** 演示受控身份：服务端只接受 'business'；其他值 403（不因自称其他角色而放行）。 */
  actorRole: 'business';
}

/** POST /api/v5-preview/messages 请求体。 */
export interface MessageRequest {
  requestId: string;
  expectedVersion: number;
  text: string;
  actorRole: 'business';
}

/** POST /api/v5-preview/demo/seed 请求体（演示控制，非业务操作）。 */
export interface SeedRequest {
  scenario: ScenarioId;
}

/** 写入成功响应（含重放）。overview 为写入后的最新业务视图。 */
export interface WriteResponse {
  ok: true;
  overview: ProjectOverview;
  /** true=同 requestId 同载荷的幂等重放，未重复记账。 */
  replayed?: boolean;
}

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'ROLE_FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'REQUEST_MISMATCH'
  | 'NO_OPEN_TODO'
  | 'BAD_SCENARIO'
  | 'STORE_CORRUPT'
  | 'STORE_UNAVAILABLE';

export interface ApiError {
  ok: false;
  error: ApiErrorCode;
  message: string;
  /** VERSION_CONFLICT 时返回服务端当前版本，便于重新获取。 */
  serverVersion?: number;
}
