// V6 远程尽调 · 事件时间线与项目阶段（REMOTE_DD_LONG_RUN · SA-R2-B1）。
// 全部纯逻辑：零 IO、零模块依赖（本文件不 import 任何东西），由 remote-service.ts 在服务端调用——
// 这些是服务端约束（可被服务逻辑/测试直接执行的规则），不是前端装饰。
// 合成演示：所有阶段、进度、依赖与冲突规则均为演示语义，不执行正式审批；模型 authority=none。
//
// 语义总览（本模块四组概念，彼此不混用）：
// 1) 项目生命周期 LifecycleStage：pre_review(预审) → due_diligence(尽调) → signing(签约) → post_rental(租后)；
//    settled(结清) 为完整终点。进度百分比只是阶段标记，非时间/工作量比例，不构成审批依据。
// 2) 四域协作步骤 CollaborationStep：每个专业域内部的协作处理推进状态（接收/处理/协同/核验），
//    与生命周期四段语义不同——类型层分开为两个 union，禁止互相赋值/换算。
// 3) 事件时间线：只追加、不改写。记录字段顺序 = 24 小时制 ISO 时间在先 → 人员 → level → 事件 → 前后变化 → 影响。
//    level 只保留申报值，缺失即为 'unknown'，绝不从人员身份/文本推断权限或职级。
// 4) 前序依赖与冲突路由：失败关闭——未知输入一律不允许；重大新旧冲突交回相关专业域人工裁定，
//    系统不认定新内容天然正确（原意见/分歧/新结论并存留痕）。

// ---------------------------------------------------------------------------
// 1) 项目生命周期（LifecycleStage）
// ---------------------------------------------------------------------------

/** 总生命周期：四段推进 + 结清终点。与 CollaborationStep（四域协作步骤）语义不同，类型上禁止混用。 */
export type LifecycleStage = 'pre_review' | 'due_diligence' | 'signing' | 'post_rental' | 'settled';

/** 生命周期推进序列（四段）。settled 不在序列内：结清是完整终点，可从任一阶段达成，不是第五个"进行中"阶段。 */
export const LIFECYCLE_ORDER: readonly LifecycleStage[] = ['pre_review', 'due_diligence', 'signing', 'post_rental'];

const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  pre_review: '预审',
  due_diligence: '尽调',
  signing: '签约',
  post_rental: '租后',
  settled: '结清',
};

/** 进度百分比映射（仅演示）：起租（post_rental 开始）≈75、结清 = 100。
 *  阶段标记，非时间/工作量比例，不构成审批依据——任何展示必须随行携带 LIFECYCLE_PROGRESS_DISCLAIMER。 */
const LIFECYCLE_PROGRESS: Record<LifecycleStage, number> = {
  pre_review: 15,
  due_diligence: 45,
  signing: 60,
  post_rental: 75,
  settled: 100,
};

export const LIFECYCLE_PROGRESS_DISCLAIMER = '进度百分比为阶段标记，非时间/工作量比例，不构成审批依据（合成演示）。';

/** 生命周期阶段标签；未知输入返回安全回退（不抛错、不猜测）。 */
export function lifecycleStageLabel(stage: string): string {
  return (LIFECYCLE_LABELS as Record<string, string | undefined>)[stage] ?? '未知阶段';
}

export interface ProjectLifecycleInfo {
  ok: true;
  stage: LifecycleStage;
  label: string;
  /** 四段序列中的位置（0..3）；settled 不在序列内 → null（完整终点）。 */
  sequenceIndex: number | null;
  /** settled = true：完整终点，其后无进一步推进。 */
  isTerminal: boolean;
  /** 仅演示的进度百分比（阶段标记）；progressNote 必须随行展示。 */
  progressPercent: number;
  progressNote: string;
}

export type ProjectLifecycleResult = ProjectLifecycleInfo | { ok: false; reason: string };

/** 查询项目生命周期信息。失败关闭：未知 stage → { ok:false }（不猜测、不回退到默认阶段）。 */
export function projectLifecycle(stage: string): ProjectLifecycleResult {
  const label = (LIFECYCLE_LABELS as Record<string, string | undefined>)[stage];
  if (label === undefined) {
    return { ok: false, reason: `未知生命周期阶段：${String(stage)}（失败关闭，不猜测；合成演示）` };
  }
  const known = stage as LifecycleStage;
  const index = LIFECYCLE_ORDER.indexOf(known);
  return {
    ok: true,
    stage: known,
    label,
    sequenceIndex: index === -1 ? null : index,
    isTerminal: known === 'settled',
    progressPercent: LIFECYCLE_PROGRESS[known],
    progressNote: LIFECYCLE_PROGRESS_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 2) 四域协作步骤（CollaborationStep）——与 LifecycleStage 语义不同
// ---------------------------------------------------------------------------

/** 四域点阵语义：单个专业域内部一条协作处理的推进状态（接收/处理/协同/核验）。
 *  注意：这四步描述"域内处理"，不是项目生命周期四段；两者不可互相换算或映射。 */
export type CollaborationStep = 'received' | 'processing' | 'collaborating' | 'verified';

export const DOMAIN_COLLABORATION_STEPS: readonly CollaborationStep[] = ['received', 'processing', 'collaborating', 'verified'];

const COLLABORATION_STEP_LABELS: Record<CollaborationStep, string> = {
  received: '接收',
  processing: '处理',
  collaborating: '协同',
  verified: '核验',
};

export interface CollaborationStepInfo {
  step: CollaborationStep;
  label: string;
  /** 显式区分说明：协作步骤 ≠ 项目生命周期阶段。 */
  note: string;
}

/** 四域协作步骤点阵（每域同构四步）。返回值只读；label/note 供服务端组装响应使用。 */
export function domainCollaborationSteps(): readonly CollaborationStepInfo[] {
  return DOMAIN_COLLABORATION_STEPS.map((step) => ({
    step,
    label: COLLABORATION_STEP_LABELS[step],
    note: '四域协作步骤：域内处理状态，与项目生命周期（预审/尽调/签约/租后）语义不同',
  }));
}

/** 协作步骤标签；未知输入返回安全回退。生命周期阶段值（如 'signing'）不是协作步骤 → 回退。 */
export function collaborationStepLabel(step: string): string {
  return (COLLABORATION_STEP_LABELS as Record<string, string | undefined>)[step] ?? '未知协作步骤';
}

// ---------------------------------------------------------------------------
// 3) 事件时间线（只追加，不改写）
// ---------------------------------------------------------------------------

/** level 为申报值：缺失/为空 → 'unknown'；不从人员姓名、文本或上下文推断权限/职级。 */
export type TimelineLevel = string;

export interface TimelineEventRecord {
  eventId: string;
  sessionId: string;
  /** 24 小时制 ISO 时间（UTC）；展示顺序上时间在先。 */
  at: string;
  /** 24 小时制显示时间（YYYY-MM-DD HH:mm，UTC，由 at 派生；仅供演示展示，不做时区换算）。 */
  atDisplay: string;
  /** 人员（申报身份，原样保留）。 */
  actor: string;
  /** 事件类别（申报值，如 lifecycle_advanced / conflict_routed / chat_confirmed / review / model_simulation）。 */
  kind: string;
  /** 级别（申报值；未知保留 'unknown'，不推断权限/职级）。 */
  level: TimelineLevel;
  /** 事件描述。 */
  event: string;
  /** 前值（可空：无前值的事件为 null）。 */
  before: string | null;
  /** 后值（可空）。 */
  after: string | null;
  /** 影响说明（可空）。 */
  impact: string | null;
}

export interface TimelineState {
  /** 只追加：本模块不提供任何修改/删除既有事件的函数。 */
  events: TimelineEventRecord[];
}

export interface TimelineEventInput {
  sessionId: string;
  actor: string;
  kind: string;
  level?: string;
  event: string;
  before?: string | null;
  after?: string | null;
  impact?: string | null;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`时间线事件字段非法：${field} 必须是非空 string（失败关闭，合成演示）`);
  }
  return value;
}

/** 可空文本：空/缺失/非字符串 → null（缺失不补 0、不编造）。 */
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** 申报 level：省略 → 'unknown'；非字符串 → 抛错（失败关闭）；空串 → 'unknown'。绝不推断。 */
function declaredLevel(value: unknown): TimelineLevel {
  if (value === undefined || value === null) return 'unknown';
  if (typeof value !== 'string') {
    throw new Error('时间线事件字段非法：level 必须是 string 或省略（缺失/为空即为 unknown，不推断权限/职级）');
  }
  return value.trim().length > 0 ? value : 'unknown';
}

/** 24 小时制显示时间（由 ISO 派生：YYYY-MM-DD HH:mm，UTC）。 */
function isoToDisplay(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** 追加一条时间线事件（只追加；不改写 state.events 中既有事件，也无处可改——本模块无更新/删除函数）。
 *  记录字段顺序即展示语义：24 小时制 ISO 时间在先 → 人员 → level → 事件 → 前后变化 → 影响。
 *  字段非法 → 抛错（失败关闭），不产生部分写入。 */
export function appendTimelineEvent(state: TimelineState, input: TimelineEventInput): TimelineEventRecord {
  if (!Array.isArray(state.events)) {
    throw new Error('时间线状态非法：state.events 必须是数组（失败关闭，合成演示）');
  }
  const sessionId = requireNonEmpty(input.sessionId, 'sessionId');
  const actor = requireNonEmpty(input.actor, 'actor');
  const kind = requireNonEmpty(input.kind, 'kind');
  const event = requireNonEmpty(input.event, 'event');
  const at = new Date().toISOString(); // 24 小时制 ISO（UTC）
  const record: TimelineEventRecord = {
    eventId: `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    sessionId,
    at,
    atDisplay: isoToDisplay(at),
    actor,
    kind,
    level: declaredLevel(input.level),
    event,
    before: optionalText(input.before),
    after: optionalText(input.after),
    impact: optionalText(input.impact),
  };
  state.events.push(record); // 只追加
  return record;
}

/** 演示展示行（纯文本拼接）：时间在先 → 人员 → level → 事件 →（前 → 后）→（影响）。 */
export function formatTimelineEvent(record: TimelineEventRecord): string {
  const change = record.before !== null || record.after !== null ? `（前：${record.before ?? '—'} → 后：${record.after ?? '—'}）` : '';
  const impact = record.impact !== null ? `；影响：${record.impact}` : '';
  return `${record.atDisplay} · ${record.actor} · level=${record.level} · ${record.event}${change}${impact}`;
}

// ---------------------------------------------------------------------------
// 4) 前序依赖（示例规则，最小演示集）
// ---------------------------------------------------------------------------

/** 专业步骤（最小演示集）：模型预处理 / 正式核验完成。 */
export type ProfessionalGateStep = 'model_preprocessing' | 'formal_verification';

export interface PredecessorDecision {
  allowed: boolean;
  reason: string;
}

/** 前序依赖示例（服务端可执行的门，非前端按钮）：
 *  - 信审"模型预处理"不依赖政策域结论——政策未结束时即可进行（模型 authority=none，输出仅供参考）；
 *  - 信审"正式核验完成"依赖政策域前序结论——生命周期仍在预审（pre_review，上游 Context 未定）时不可越过；
 *    进入尽调及以后视为前序已具备（演示映射）。settled 为完整终点，仅留痕。
 *  失败关闭：未知步骤 / 未知阶段一律不允许。 */
export function predecessorAllows(professionalStep: string, lifecycleStage: string): PredecessorDecision {
  const lifecycle = projectLifecycle(lifecycleStage);
  if (!lifecycle.ok) return { allowed: false, reason: lifecycle.reason };
  if (professionalStep === 'model_preprocessing') {
    return { allowed: true, reason: '模型预处理不依赖政策域结论：政策未结束时信审可先行（模型 authority=none，输出仅供参考，合成演示）' };
  }
  if (professionalStep === 'formal_verification') {
    if (lifecycle.stage === 'pre_review') {
      return { allowed: false, reason: '信审正式核验完成的前序（政策域结论）尚未完成：预审阶段不得越过前序出具正式核验（失败关闭，合成演示）' };
    }
    const terminalNote = lifecycle.isTerminal ? '（已结清：完整终点，仅留痕）' : '';
    return { allowed: true, reason: `生命周期已进入「${lifecycle.label}」，政策域前序视为已具备，可正式核验${terminalNote}（合成演示）` };
  }
  return { allowed: false, reason: `未知专业步骤：${String(professionalStep)}（失败关闭，不猜测）` };
}

// ---------------------------------------------------------------------------
// 5) 重大新旧冲突路由（系统不认定新内容天然正确）
// ---------------------------------------------------------------------------

export interface ConflictRouteResult {
  /** 是否判定为重大冲突：新旧值同时在场且不一致。 */
  conflict: boolean;
  /** 'domain_professional' = 交回相关专业域人工裁定；'none' = 无冲突、不路由。 */
  route: 'domain_professional' | 'none';
  /** 系统不代裁：冲突分支永远 resolved=false。 */
  resolved: boolean;
  reason: string;
}

/** 重大新旧冲突路由：存量正式结论（oldValue）与新输入（newValue）不一致 → 交回专业域（domain_professional），
 *  resolved=false——系统不认定新内容天然正确，不自动覆盖原意见（原意见/分歧/新结论并存，由人裁定）。
 *  一方缺失（空/null/非字符串）不算分歧：缺失不补齐，也不路由。 */
export function routeConflict(oldValue: unknown, newValue: unknown): ConflictRouteResult {
  const oldText = optionalText(oldValue);
  const newText = optionalText(newValue);
  if (oldText === null || newText === null) {
    return { conflict: false, route: 'none', resolved: true, reason: '新旧值有一方缺失：无重大冲突可路由（缺失不补齐、不猜测）' };
  }
  if (oldText === newText) {
    return { conflict: false, route: 'none', resolved: true, reason: '新旧值一致：无冲突' };
  }
  return {
    conflict: true,
    route: 'domain_professional',
    resolved: false,
    reason: '重大新旧冲突：交回相关专业域人工裁定；原意见、分歧与新结论并存留痕，系统不认定新内容天然正确（合成演示）',
  };
}
