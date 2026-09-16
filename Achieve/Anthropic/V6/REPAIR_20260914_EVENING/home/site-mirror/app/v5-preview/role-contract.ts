// F 轮（V7 六角色商租预览）· 角色与案例契约（类型层，纯类型无依赖）。
// 六角色交互契约（V7/SIX_ROLE_COMMERCIAL_LEASING_20260915.md §六角色）：roleId 固定六个；
// 角色选择只是"演示视角"，不是登录身份授权；所有角色共享同一项目事实；切换不重开项目、
// 不清消息、不跳过正式前序、不自动批准；见微不是上级或超级审批人。
// 形状对齐 C 路 six-role-v1（schemaVersion/scenarios/roleViews/turns/expectedChecks/sourceRefs）；
// C 包（V7/backend/C/scenarios/six-role-v1.json）就绪前由本目录种子案例先行（F6 授权）。

export type RoleId = 'jianwei' | 'business' | 'policy' | 'credit' | 'commerce' | 'asset';

export const ROLE_IDS: readonly RoleId[] = ['jianwei', 'business', 'policy', 'credit', 'commerce', 'asset'];

export const ROLE_LABEL: Record<RoleId, string> = {
  jianwei: '见微',
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

/** 事实证据分级（用户业务说明）：已确认/来源支持/经验推断/未验证/未知。 */
export type FactStatus = 'confirmed' | 'supported' | 'inferred' | 'unverified' | 'unknown';

export const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  confirmed: '已确认',
  supported: '来源支持',
  inferred: '经验推断',
  unverified: '未验证',
  unknown: '未知',
};

/** 候选倾向：模型/模拟候选，不是正式审批。 */
export type Tendency = '做' | '谨慎做' | '调整条件后做' | '不做' | '不做（现状）';

export interface RoleTask {
  id: string;
  title: string;
  /** open=待办中；updated=补证后该域已更新；done=闭环。 */
  status: 'open' | 'updated' | 'done';
  /** 关联证据要求（adapter 命中后更新状态）。 */
  evidenceKey?: string;
  domain?: RoleId;
}

/** 六角色视角（对齐 six-role-v1 roleViews：summary/questions≤3/tasks/tendency/conditions）。 */
export interface RoleView {
  summary: string;
  questions: string[];
  tasks: RoleTask[];
  tendency: Tendency;
  conditions: string[];
}

/** 案例事实（带证据版本：补证后版本 +1，旧值留档于消息流）。 */
export interface CaseFact {
  id: string;
  label: string;
  value: string;
  evidenceVersion: number;
  status: FactStatus;
}

/** 域矩阵行（复用首页四域格子结构；states 对齐 SegmentState）。 */
export interface CaseDomainRow {
  domainId: 'policy' | 'credit' | 'commerce' | 'asset';
  name: string;
  judgmentStatus: 'green' | 'yellow' | 'red' | 'gray';
  judgmentText: string;
  segments: [string, string, string, string];
  summary: string;
}

/** 可推进模拟对话脚本（输入敏感，非固定顺序播放）：用户输入命中 keywords 之一即触发 effects。
 *  未命中任何脚本 → 待澄清（不假装模型理解）。 */
export interface CaseTurnScript {
  id: string;
  /** 任务联动键：roleViews.tasks.evidenceKey 与此相等时，命中后任务状态置 updated。 */
  key: string;
  /** 命中关键词（任一包含即命中；选词足够特异）。 */
  keywords: string[];
  /** 本步待补证据名（待办/提示文案引用）。 */
  missingLabel: string;
  effects: {
    factId: string;
    newValue: string;
    /** 新证据版本（旧版本 +1）。 */
    version: number;
    status: FactStatus;
  }[];
  /** 命中后各角色回复（origin 恒为 preset/model——本地模拟，不冒充真人或真实模型）。 */
  replies: { roleId: RoleId; text: string; origin: 'preset' | 'model' }[];
}

/** 案例场景（对齐 six-role-v1 顶层字段）。 */
export interface CaseScenario {
  schemaVersion: 'six-role-v1';
  id: string;
  code: string;
  title: string;
  industry: string;
  region: string;
  leaseMode: '直租' | '回租';
  customerContext: string;
  facts: CaseFact[];
  unknowns: string[];
  roleViews: Record<RoleId, RoleView>;
  turns: CaseTurnScript[];
  expectedChecks: string[];
  sourceRefs: string[];
  /** 首页四域矩阵呈现（种子案例内联；C 包接入时由 facts 投影）。 */
  domains: CaseDomainRow[];
}

/** 案例运行态（项目间隔离：每案例独立 messages/facts/turns；切换案例互不清空）。 */
export interface CaseState {
  scenarioId: string;
  facts: CaseFact[];
  messages: CaseMessage[];
  completedTurns: string[];
  taskStatus: Record<string, RoleTask['status']>;
}

export interface CaseMessage {
  id: string;
  /** 发言角色（user 输入 = 当前所选视角；replies = 模拟域角色）。 */
  roleId: RoleId | 'system';
  fromName: string;
  /** 来源：human=演示视角下的用户输入；preset/model=本地模拟生成，不冒充真人/真实模型。 */
  origin: 'human' | 'preset' | 'model';
  text: string;
  at: string;
  marks: string[];
}

/** 角色名→首页四域 roleKey（复用域图标映射）。 */
export function isRoleId(v: string): v is RoleId {
  return (ROLE_IDS as readonly string[]).includes(v);
}
