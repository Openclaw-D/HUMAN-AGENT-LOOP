"use client";

// V5 PREVIEW · 合成预览状态层（F0-R1）。
// R1 修订：四域共用四阶段（材料合规→模型校验→人工复核→正式通过，2026-09-07 决定），
// 格子/域摘要/详情由同一阶段对象派生；reducer 按角色守卫本域动作；
// 缓存深度校验失败关闭；模拟回复带代际门（reset 取消未决回复）。
// 全部数据为合成演示：不接真实接口、不写正式 runtime、不产生 Decision/Receipt。
// 纯逻辑标记区间（V5-PREVIEW-PURE-LOGIC）由 test/v5-preview.test.mjs 切取后动态 import 真实执行，
// 区间内保持纯 TS：无 JSX、无外部导入、无 React 依赖。

import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { Dispatch } from 'react';

// ---------- V5-PREVIEW-PURE-LOGIC-START ----------
export type DomainKey = 'policy' | 'credit' | 'commerce' | 'asset';
export type RoleKey = 'business' | DomainKey;

/** 四域共用四阶段（2026-09-07 用户决定）：固定共同 stageId；专业细项下沉详情，不据此删除必经制度流程。 */
export type StageId = 'material' | 'model' | 'review' | 'formal';
export const STAGE_ORDER: StageId[] = ['material', 'model', 'review', 'formal'];
export const STAGE_LABELS: Record<StageId, string> = {
  material: '材料合规',
  model: '模型校验',
  review: '人工复核',
  formal: '正式通过',
};

/** 演示工作状态词。locked 专用于正式通过（权限未约定，预览禁用）。 */
export type WorkState = 'todo' | 'working' | 'awaiting' | 'returned' | 'ready' | 'done' | 'locked';

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  todo: '待处理',
  working: '进行中',
  awaiting: '等待输入',
  returned: '退回/需复核',
  ready: '候选就绪（模拟）',
  done: '已完成（演示）',
  locked: '正式通过（禁用·待权限约定）',
};

export function isWorkState(value: unknown): value is WorkState {
  return value === 'todo' || value === 'working' || value === 'awaiting' || value === 'returned'
    || value === 'ready' || value === 'done' || value === 'locked';
}

export interface StageInfo {
  state: WorkState;
  note: string;
}

export interface PreviewDomain {
  key: DomainKey;
  name: string;
  icon: 'ruler' | 'shield' | 'contract' | 'diamond';
  stages: Record<StageId, StageInfo>;
}

export interface PreviewBlock {
  id: string;
  stageId: StageId;
  label: string;
  state: WorkState;
  note: string;
}

export interface PreviewMessage {
  id: number;
  fromKind: 'human' | 'agent' | 'system';
  fromName: string;
  to: 'all' | RoleKey;
  text: string;
  marks: string[];
}

/** 合成闭环阶段：信审起草 → 已提要求 → 业务已回应 → 信审接续完成（仅信审域材料阶段依托此流程演示）。 */
export type LoopStage = 'credit-drafting' | 'request-sent' | 'business-responded' | 'credit-continued';

export interface PreviewState {
  version: 1;
  caseId: string;
  projectNo: string;
  role: RoleKey;
  progressPercent: number;
  progressNote: string;
  domains: Record<DomainKey, PreviewDomain>;
  messages: PreviewMessage[];
  nextId: number;
  loop: {
    stage: LoopStage;
    creditDraft: string;
    supplementRequest: string | null;
    businessResponse: string | null;
  };
  formalNotice: string | null;
  /** 深度校验拒绝本地缓存后的明确提示；null 表示无提示。 */
  cacheNotice: string | null;
}

/** 合成人名仅用于预览叙事，不是真实身份认证。 */
export const ROLE_NAMES: Record<RoleKey, string> = {
  business: '张业务',
  policy: '张政策',
  credit: '张信审',
  commerce: '张商务',
  asset: '张资产',
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  business: '业务（协调）',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

export const DOMAIN_NAMES: Record<DomainKey, string> = {
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
};

/** 手机总览顺时针四域（F0 任务书 §2；2026-09-07 四列方案仅为候选，未替代本决定）。 */
export const MOBILE_QUADRANTS: Record<'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', DomainKey> = {
  topLeft: 'asset',
  topRight: 'policy',
  bottomRight: 'credit',
  bottomLeft: 'commerce',
};

/** 横屏/四列矩阵列序：政策/信审/商务/资产。 */
export const LANDSCAPE_COLUMN_ORDER: DomainKey[] = ['policy', 'credit', 'commerce', 'asset'];

export const FORMAL_NOTICE = '正式审批待权限及对象约定——预览禁用，不产生 Decision/Receipt。';
export const CACHE_NOTICE = '检测到无法识别的本地缓存，已重置为初始演示状态（合成预览）。';

/**
 * 派生：四格（格子/域摘要共用同一来源）。专业细项（如具体材料清单）在详情内表达。
 */
export function deriveStageBlocks(domain: PreviewDomain): PreviewBlock[] {
  return STAGE_ORDER.map((id) => ({
    id: `${domain.key}-${id}`,
    stageId: id,
    label: STAGE_LABELS[id],
    state: domain.stages[id].state,
    note: domain.stages[id].note,
  }));
}

/** 派生：域状态 = 第一个未完成阶段的状态（全部完成则看正式阶段——其为 locked/disabled）。 */
export function deriveDomainStatus(domain: PreviewDomain): WorkState {
  for (const id of STAGE_ORDER) {
    if (domain.stages[id].state !== 'done') return domain.stages[id].state;
  }
  return 'locked';
}

/** 派生：卡点短句 = 第一个未完成阶段的注记。 */
export function deriveDomainBlocker(domain: PreviewDomain): string {
  for (const id of STAGE_ORDER) {
    if (domain.stages[id].state !== 'done') return domain.stages[id].note;
  }
  return domain.stages.formal.note;
}

const LOCKED_FORMAL_NOTE = '正式通过需有效人工决定；预览禁用（待权限及对象约定）';

function buildInitialDomains(): Record<DomainKey, PreviewDomain> {
  return {
    policy: {
      key: 'policy', name: '政策', icon: 'ruler',
      stages: {
        material: { state: 'working', note: '准入硬管控未命中；灰区复议条件梳理中（合成）' },
        model: { state: 'todo', note: '等待材料齐备（合成）' },
        review: { state: 'todo', note: '待模型校验完成（合成）' },
        formal: { state: 'locked', note: LOCKED_FORMAL_NOTE },
      },
    },
    credit: {
      key: 'credit', name: '信审', icon: 'shield',
      stages: {
        material: { state: 'awaiting', note: '等待业务确认定价依据（合成）' },
        model: { state: 'todo', note: '等待材料合规（合成）' },
        review: { state: 'todo', note: '待模型校验完成（合成）' },
        formal: { state: 'locked', note: LOCKED_FORMAL_NOTE },
      },
    },
    commerce: {
      key: 'commerce', name: '商务', icon: 'contract',
      stages: {
        material: { state: 'working', note: '条件草案准备中（合成）' },
        model: { state: 'todo', note: '等待材料齐备（合成）' },
        review: { state: 'todo', note: '待模型校验完成（合成）' },
        formal: { state: 'locked', note: '依赖信审/政策有效人工决定；预览禁用（合成）' },
      },
    },
    asset: {
      key: 'asset', name: '资产', icon: 'diamond',
      stages: {
        material: { state: 'returned', note: '设备采购凭证待补充（合成）——材料待补充情景' },
        model: { state: 'todo', note: '等待材料合规（合成）' },
        review: { state: 'todo', note: '待模型校验完成（合成）' },
        formal: { state: 'locked', note: LOCKED_FORMAL_NOTE },
      },
    },
  };
}

export function initialPreviewState(): PreviewState {
  return {
    version: 1,
    caseId: 'demo-sme-robot-500w',
    projectNo: '2026PA21001',
    role: 'business',
    progressPercent: 50,
    progressNote: '进度口径仅为演示：顶部进度表达整个项目，四刻度为里程碑标记、非四域各25%。业务完成指项目主体结束，其判定与进度算法未冻结；100%不等于风险消失或全生命周期结束。',
    domains: buildInitialDomains(),
    messages: [
      { id: 1, fromKind: 'system', fromName: '系统', to: 'all', text: '交互预览 · 合成数据——不产生正式 Decision/Receipt；正式审批禁用。', marks: [] },
      { id: 2, fromKind: 'agent', fromName: 'Agent·信审', to: 'all', text: '信审（合成示例）：合同金额 500 万与营收下滑口径存在张力，需业务确认定价依据。', marks: ['模拟回复'] },
    ],
    nextId: 3,
    loop: { stage: 'credit-drafting', creditDraft: '', supplementRequest: null, businessResponse: null },
    formalNotice: null,
    cacheNotice: null,
  };
}

export type PreviewAction =
  | { type: 'set-role'; role: RoleKey }
  | { type: 'save-credit-draft'; text: string }
  | { type: 'send-supplement-request'; text: string }
  | { type: 'send-business-response'; text: string }
  | { type: 'continue-credit' }
  | { type: 'chat-send'; text: string; to: 'all' | RoleKey }
  | { type: 'chat-agent-reply'; text: string; domain: DomainKey }
  | { type: 'chat-human-takeover'; text: string }
  /** 显式守卫动作：任何正式审批意图只设置提示，不产生任何正式状态。 */
  | { type: 'formal-attempt'; kind: 'approve' | 'veto' }
  | { type: 'hydrate'; state: PreviewState }
  | { type: 'cache-rejected' }
  | { type: 'reset' };

export const PREVIEW_ACTION_TYPES = [
  'set-role', 'save-credit-draft', 'send-supplement-request', 'send-business-response',
  'continue-credit', 'chat-send', 'chat-agent-reply', 'chat-human-takeover',
  'formal-attempt', 'hydrate', 'cache-rejected', 'reset',
] as const;

function withMessage(state: PreviewState, message: Omit<PreviewMessage, 'id'>): PreviewState {
  return { ...state, nextId: state.nextId + 1, messages: [...state.messages, { ...message, id: state.nextId }] };
}

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'set-role':
      return { ...state, role: action.role };
    case 'save-credit-draft':
      // 角色守卫：信审草稿只能由信审视角保存（预览行为一致性；非生产认证）。
      if (state.role !== 'credit') return state;
      return { ...state, loop: { ...state.loop, creditDraft: action.text } };
    case 'send-supplement-request':
      // 角色守卫：补充要求只能由信审视角发起。
      if (state.role !== 'credit') return state;
      if (state.loop.stage !== 'credit-drafting' || action.text.trim() === '') return state;
      {
        const withMsg = withMessage(state, {
          fromKind: 'human', fromName: '张信审', to: 'business',
          text: `[模拟补充要求] 请业务确认定价依据：${action.text}`, marks: ['模拟人动作'],
        });
        return { ...withMsg, loop: { ...withMsg.loop, stage: 'request-sent', supplementRequest: action.text } };
      }
    case 'send-business-response':
      // 角色守卫：回应只能由业务视角提交。
      if (state.role !== 'business') return state;
      if (state.loop.stage !== 'request-sent' || action.text.trim() === '') return state;
      {
        const withMsg = withMessage(state, {
          fromKind: 'human', fromName: '张业务', to: 'credit',
          text: `[模拟回应] 定价依据说明：${action.text}`, marks: ['模拟人动作'],
        });
        return { ...withMsg, loop: { ...withMsg.loop, stage: 'business-responded', businessResponse: action.text } };
      }
    case 'continue-credit': {
      // 角色守卫：接续只能由信审视角执行。
      if (state.role !== 'credit') return state;
      if (state.loop.stage !== 'business-responded') return state;
      // 四阶段同步推进：材料合规完成 → 模型校验完成（可含问题）→ 人工复核候选就绪 → 正式通过仍禁用。
      const credit: PreviewDomain = {
        ...state.domains.credit,
        stages: {
          material: { state: 'done', note: '定价依据已由业务回应补齐（合成）' },
          model: { state: 'done', note: '校验完成：营收口径张力仍待人工判断（合成问题注记）' },
          review: { state: 'ready', note: '候选就绪；待人工复核（模拟）' },
          formal: { state: 'locked', note: LOCKED_FORMAL_NOTE },
        },
      };
      const domains: Record<DomainKey, PreviewDomain> = { ...state.domains, credit };
      const withMsg = withMessage({ ...state, domains }, {
        fromKind: 'system', fromName: '系统', to: 'all',
        text: '信审人工复核候选已就绪（模拟）——总览状态同步；正式通过仍禁用，本预览不产生正式结果。', marks: [],
      });
      return {
        ...withMsg,
        progressPercent: 60,
        loop: { ...withMsg.loop, stage: 'credit-continued', creditDraft: `（已接续业务回应：${withMsg.loop.businessResponse ?? ''}）${withMsg.loop.creditDraft}` },
      };
    }
    case 'chat-send':
      if (action.text.trim() === '') return state;
      return withMessage(state, {
        fromKind: 'human', fromName: ROLE_NAMES[state.role], to: action.to, text: action.text, marks: [],
      });
    case 'chat-agent-reply':
      return withMessage(state, {
        fromKind: 'agent', fromName: `Agent·${DOMAIN_NAMES[action.domain]}`, to: 'all',
        text: action.text, marks: ['模拟回复'],
      });
    case 'chat-human-takeover':
      if (action.text.trim() === '') return state;
      return withMessage(state, {
        fromKind: 'human', fromName: ROLE_NAMES[state.role], to: 'all',
        text: action.text, marks: ['模拟人接手'],
      });
    case 'formal-attempt':
      return { ...state, formalNotice: FORMAL_NOTICE };
    case 'hydrate':
      return action.state;
    case 'cache-rejected':
      return { ...initialPreviewState(), cacheNotice: CACHE_NOTICE };
    case 'reset':
      return initialPreviewState();
    default:
      // 未知动作失败关闭：原样返回，不猜测语义。
      return state;
  }
}

/**
 * 模拟回复代际门：reset 使此前调度的未决回复全部失效（含已排程未触发的 setTimeout）。
 * 纯逻辑，供行为测试与 provider 共用。
 */
export interface ReplyGate {
  schedule(fn: () => void): () => void;
  reset(): void;
}

export function createReplyGate(): ReplyGate {
  let generation = 0;
  return {
    schedule(fn: () => void) {
      const atSchedule = generation;
      return () => {
        if (atSchedule === generation) fn();
      };
    },
    reset() {
      generation += 1;
    },
  };
}

/** 草稿单一编辑源：editing 为 null 表示未初始化（回显已存值）；'' 表示有意清空；保存提交当前显示内容。 */
export function resolveEditingValue(editing: string | null, saved: string): string {
  return editing === null ? saved : editing;
}

export interface BusinessTodo {
  id: string;
  title: string;
  detail: string;
  state: WorkState | 'resolved';
  simulated: boolean;
}

export function deriveBusinessTodos(state: PreviewState): BusinessTodo[] {
  const todos: BusinessTodo[] = [];
  const { stage } = state.loop;
  if (stage === 'request-sent') {
    todos.push({
      id: 'loop-credit', title: '信审补充要求：定价依据确认',
      detail: state.loop.supplementRequest ?? '', state: 'awaiting', simulated: true,
    });
  } else if (stage === 'business-responded') {
    todos.push({
      id: 'loop-credit', title: '信审补充要求：已回应（模拟）',
      detail: `已回应：${state.loop.businessResponse ?? ''}`, state: 'working', simulated: true,
    });
  } else if (stage === 'credit-continued') {
    todos.push({
      id: 'loop-credit', title: '信审补充要求：已接续（模拟闭环完成）',
      detail: '信审人工复核候选已就绪（模拟）；正式通过待有效人工决定。', state: 'resolved', simulated: true,
    });
  } else if (state.domains.credit.stages.material.state === 'awaiting') {
    todos.push({
      id: 'loop-credit', title: '信审材料合规受阻：定价依据待说明',
      detail: '信审尚未发起补充要求；可先在信审详情中起草意见。', state: 'awaiting', simulated: true,
    });
  }
  todos.push(
    { id: 'demo-asset', title: '资产材料待补充：设备采购凭证', detail: '（合成示例）资产域材料合规退回，待补件转达。', state: 'returned', simulated: true },
    { id: 'demo-commerce', title: '商务条件草案进度提醒', detail: '（合成示例）正式条件依赖有效人工决定。', state: 'todo', simulated: true },
  );
  return todos;
}

export interface CreditTodo { title: string; detail: string; state: WorkState }

export function deriveCreditTodo(state: PreviewState): CreditTodo {
  switch (state.loop.stage) {
    case 'credit-drafting':
      return { title: '材料合规受阻：营收下滑与合同金额矛盾——需定价依据', detail: '可先保存意见草稿，或向业务提出补充要求。', state: 'awaiting' };
    case 'request-sent':
      return { title: '已向业务提出补充要求（模拟）', detail: '等待业务回应中。', state: 'awaiting' };
    case 'business-responded':
      return { title: '业务已回应——可接续推进模型校验与人工复核', detail: state.loop.businessResponse ?? '', state: 'working' };
    case 'credit-continued':
      return { title: '人工复核候选就绪（模拟）', detail: '待人工复核；正式通过禁用，本预览不产生正式结果。', state: 'ready' };
  }
}

export function serializePreviewState(state: PreviewState): string {
  return JSON.stringify(state);
}

function isRoleKey(value: unknown): value is RoleKey {
  return value === 'business' || value === 'policy' || value === 'credit' || value === 'commerce' || value === 'asset';
}

function isStageId(value: unknown): value is StageId {
  return value === 'material' || value === 'model' || value === 'review' || value === 'formal';
}

function isStageInfo(value: unknown): value is StageInfo {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return isWorkState(s.state) && typeof s.note === 'string';
}

function isPreviewDomain(key: DomainKey, value: unknown): value is PreviewDomain {
  if (value === null || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (d.key !== key || typeof d.name !== 'string') return false;
  if (d.icon !== 'ruler' && d.icon !== 'shield' && d.icon !== 'contract' && d.icon !== 'diamond') return false;
  if (d.stages === null || typeof d.stages !== 'object') return false;
  const stages = d.stages as Record<string, unknown>;
  for (const id of STAGE_ORDER) {
    if (!isStageInfo(stages[id])) return false;
  }
  return true;
}

function isMessage(value: unknown): value is PreviewMessage {
  if (value === null || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  if (m.fromKind !== 'human' && m.fromKind !== 'agent' && m.fromKind !== 'system') return false;
  if (typeof m.fromName !== 'string' || typeof m.text !== 'string') return false;
  if (m.to !== 'all' && !isRoleKey(m.to)) return false;
  if (!Array.isArray(m.marks) || !m.marks.every((x) => typeof x === 'string')) return false;
  return typeof m.id === 'number' && Number.isInteger(m.id);
}

function isLoop(value: unknown): value is PreviewState['loop'] {
  if (value === null || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  if (l.stage !== 'credit-drafting' && l.stage !== 'request-sent' && l.stage !== 'business-responded' && l.stage !== 'credit-continued') return false;
  if (typeof l.creditDraft !== 'string') return false;
  if (l.supplementRequest !== null && typeof l.supplementRequest !== 'string') return false;
  if (l.businessResponse !== null && typeof l.businessResponse !== 'string') return false;
  return true;
}

/**
 * 深度校验（失败关闭）：验证全部必要嵌套字段、枚举与数值范围；任何非法输入返回 null，
 * 由调用方回退初始状态并给出明确提示。不做浅校验。
 */
export function parsePreviewState(raw: string): PreviewState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (o.version !== 1) return null;
    if (typeof o.caseId !== 'string' || typeof o.projectNo !== 'string') return null;
    if (!isRoleKey(o.role)) return null;
    if (typeof o.progressPercent !== 'number' || !Number.isFinite(o.progressPercent) || o.progressPercent < 0 || o.progressPercent > 100) return null;
    if (typeof o.progressNote !== 'string') return null;
    if (o.formalNotice !== null && typeof o.formalNotice !== 'string') return null;
    if (o.cacheNotice !== null && typeof o.cacheNotice !== 'string') return null;
    if (o.domains === null || typeof o.domains !== 'object') return null;
    const domains = o.domains as Record<string, unknown>;
    for (const key of ['policy', 'credit', 'commerce', 'asset'] as DomainKey[]) {
      if (!isPreviewDomain(key, domains[key])) return null;
    }
    if (!Array.isArray(o.messages) || !o.messages.every(isMessage)) return null;
    if (typeof o.nextId !== 'number' || !Number.isInteger(o.nextId) || o.nextId < 0) return null;
    if (!isLoop(o.loop)) return null;
    return value as PreviewState;
  } catch {
    return null;
  }
}

// ---------- 视图/阶段导航助手（URL 携带域与阶段；纯逻辑供测试） ----------

export type PreviewView = { screen: 'overview' } | { screen: 'detail'; domain: RoleKey; stage?: StageId };

export function viewToQuery(view: PreviewView): string {
  if (view.screen === 'overview') return 'view=overview';
  const params = new URLSearchParams();
  params.set('view', 'detail');
  params.set('domain', view.domain);
  if (view.stage !== undefined) params.set('stage', view.stage);
  return params.toString();
}

export function queryToView(search: string): PreviewView {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'detail') {
    const domain = params.get('domain');
    if (isRoleKey(domain)) {
      const stage = params.get('stage');
      if (isStageId(stage)) return { screen: 'detail', domain, stage };
      return { screen: 'detail', domain };
    }
  }
  return { screen: 'overview' };
}

// ---------- 模拟回复文案与判定（合成数据，逐域固定） ----------

const AGENT_CANNED: Record<DomainKey, string> = {
  policy: '政策（模拟回复）：已记录该问题。当前材料合规阶段在梳理灰区复议条件（合成数据）。',
  credit: '信审（模拟回复）：已对照材料复核该点。合同金额与营收口径存在张力，材料合规阶段待定价依据（合成数据）。',
  commerce: '商务（模拟回复）：已纳入条件草案考虑。正式通过依赖有效人工决定（合成数据）。',
  asset: '资产（模拟回复）：已记录。材料合规阶段待补充设备采购凭证（合成数据）。',
};

export function deriveAgentReply(text: string, domain: DomainKey): { text: string; needsHuman: boolean } {
  const t = text.trim();
  const asksFacts = t.includes('？') || t.includes('?') || t.includes('依据') || t.includes('确认') || t.includes('如何');
  if (asksFacts) {
    return { text: `${AGENT_CANNED[domain]} 此点需人工确认——建议由具名同事接手（模拟提示）。`, needsHuman: true };
  }
  return { text: AGENT_CANNED[domain], needsHuman: false };
}
// ---------- V5-PREVIEW-PURE-LOGIC-END ----------

// ---------- React 接线（预览壳内使用，不属于纯逻辑区） ----------

interface PreviewContextValue {
  state: PreviewState;
  dispatch: Dispatch<PreviewAction>;
  /** 发送聊天：目标是四域时调度一条模拟 Agent 回复（明确标记；reset 经代际门取消未决回复）。 */
  sendChatMessage: (text: string, to: 'all' | RoleKey) => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

const STORAGE_KEY = 'jw:v5-preview:state:v1';

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(previewReducer, null, initialPreviewState);
  const hydratedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const gateRef = useRef<ReturnType<typeof createReplyGate> | null>(null);
  if (gateRef.current === null) gateRef.current = createReplyGate();
  const gate = gateRef.current;

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const parsed = parsePreviewState(raw);
      // 一次性水合：SSR 首帧必须与服务器输出一致，storage 只能在挂载后读取。
      // 深度校验失败 → 明确提示并回退初始状态（不静默）。
      if (parsed !== null) dispatch({ type: 'hydrate', state: parsed });
      else dispatch({ type: 'cache-rejected' });
    } catch {
      dispatch({ type: 'cache-rejected' });
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, serializePreviewState(state));
    } catch {
      // 忽略持久化失败：预览状态仍在内存中可用。
    }
  }, [state]);

  useEffect(() => () => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  const guardedDispatch = useCallback<Dispatch<PreviewAction>>((action) => {
    if (action.type === 'reset') {
      // 重置使所有未决模拟回复失效（代际门 + 兜底清定时器）。
      gate.reset();
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
    }
    dispatch(action);
  }, [gate]);

  const sendChatMessage = useCallback((text: string, to: 'all' | RoleKey) => {
    guardedDispatch({ type: 'chat-send', text, to });
    if (to !== 'all' && to !== 'business') {
      const reply = deriveAgentReply(text, to);
      const deliver = gate.schedule(() => {
        guardedDispatch({ type: 'chat-agent-reply', text: reply.text, domain: to });
      });
      const timer = window.setTimeout(deliver, 700);
      timersRef.current.push(timer);
    }
  }, [gate, guardedDispatch]);

  const value: PreviewContextValue = { state, dispatch: guardedDispatch, sendChatMessage };
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewContextValue {
  const value = useContext(PreviewContext);
  if (value === null) throw new Error('usePreview 必须在 PreviewStateProvider 内使用');
  return value;
}
