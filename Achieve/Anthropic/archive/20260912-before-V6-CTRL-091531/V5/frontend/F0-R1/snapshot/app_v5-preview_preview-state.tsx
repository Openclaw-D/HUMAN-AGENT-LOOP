"use client";

// V5 PREVIEW · 合成预览状态层（F0）。
// 全部数据为合成演示：不接真实接口、不写正式 runtime、不产生 Decision/Receipt。
// 纯逻辑标记区间（V5-PREVIEW-PURE-LOGIC）由 test/v5-preview.test.mjs 切取后动态 import 真实执行，
// 区间内保持纯 TS：无 JSX、无外部导入、无 React 依赖。

import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { Dispatch } from 'react';

// ---------- V5-PREVIEW-PURE-LOGIC-START ----------
export type DomainKey = 'policy' | 'credit' | 'commerce' | 'asset';
export type RoleKey = 'business' | DomainKey;

/** 演示工作状态词：显示待处理/进行中/等待输入/退回需复核/候选就绪的区别；不构成制度定义。 */
export type WorkState = 'todo' | 'working' | 'awaiting' | 'returned' | 'ready';

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  todo: '待处理',
  working: '进行中',
  awaiting: '等待输入',
  returned: '退回/需复核',
  ready: '候选就绪（模拟）',
};

export interface PreviewBlock {
  id: string;
  label: string;
  state: WorkState;
}

export interface PreviewDomain {
  key: DomainKey;
  name: string;
  icon: 'ruler' | 'shield' | 'contract' | 'diamond';
  status: WorkState;
  /** 卡点/待办短句（合成示例，避免纯图标猜测）。 */
  blocker: string;
  blocks: PreviewBlock[];
}

export interface PreviewMessage {
  id: number;
  fromKind: 'human' | 'agent' | 'system';
  fromName: string;
  to: 'all' | RoleKey;
  text: string;
  marks: string[];
}

/** 合成闭环阶段：信审起草 → 已提要求 → 业务已回应 → 信审接续完成。 */
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

/** 手机总览顺时针四域（任务书 §2）：右上政策、右下信审、左下商务、左上资产。 */
export const MOBILE_QUADRANTS: Record<'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', DomainKey> = {
  topLeft: 'asset',
  topRight: 'policy',
  bottomRight: 'credit',
  bottomLeft: 'commerce',
};

/** 横屏总览列序（任务书 §3）：政策/信审/商务/资产四列，纵向四行。 */
export const LANDSCAPE_COLUMN_ORDER: DomainKey[] = ['policy', 'credit', 'commerce', 'asset'];

export const FORMAL_NOTICE = '正式审批待权限及对象约定——预览禁用，不产生 Decision/Receipt。';

/**
 * 模拟回复文案（合成数据，逐域固定）。needsHuman 表示该点需人工确认，
 * 仅提示"建议人工接手"，不改变任何正式状态。
 */
const AGENT_CANNED: Record<DomainKey, string> = {
  policy: '政策（模拟回复）：已记录该问题。当前准入硬管控未命中，灰区复议条件仍在梳理（合成数据）。',
  credit: '信审（模拟回复）：已对照材料复核该点。合同金额与营收口径存在张力，测算框架待更新（合成数据）。',
  commerce: '商务（模拟回复）：已纳入条件草案考虑。正式条件依赖信审/政策的有效人工决定（合成数据）。',
  asset: '资产（模拟回复）：已记录。设备采购凭证与权属链仍在核对（合成数据）。',
};

export function deriveAgentReply(text: string, domain: DomainKey): { text: string; needsHuman: boolean } {
  const t = text.trim();
  const asksFacts = t.includes('？') || t.includes('?') || t.includes('依据') || t.includes('确认') || t.includes('如何');
  if (asksFacts) {
    return { text: `${AGENT_CANNED[domain]} 此点需人工确认——建议由具名同事接手（模拟提示）。`, needsHuman: true };
  }
  return { text: AGENT_CANNED[domain], needsHuman: false };
}

function buildInitialDomains(): Record<DomainKey, PreviewDomain> {
  return {
    policy: {
      key: 'policy', name: '政策', icon: 'ruler', status: 'working',
      blocker: '灰区复议条件待明确（合成）',
      blocks: [
        { id: 'policy-1', label: '事实引用', state: 'working' },
        { id: 'policy-2', label: '准入意见', state: 'working' },
        { id: 'policy-3', label: '灰区复议', state: 'todo' },
        { id: 'policy-4', label: '补件清单', state: 'todo' },
      ],
    },
    credit: {
      key: 'credit', name: '信审', icon: 'shield', status: 'awaiting',
      blocker: '等待业务确认定价依据（合成）',
      blocks: [
        { id: 'credit-1', label: '材料互证', state: 'returned' },
        { id: 'credit-2', label: '测算框架', state: 'working' },
        { id: 'credit-3', label: '矛盾图', state: 'working' },
        { id: 'credit-4', label: '核验问题清单', state: 'todo' },
      ],
    },
    commerce: {
      key: 'commerce', name: '商务', icon: 'contract', status: 'todo',
      blocker: '条件草案准备中；正式化需有效人工决定（合成）',
      blocks: [
        { id: 'commerce-1', label: '条件草案', state: 'working' },
        { id: 'commerce-2', label: '担保结构', state: 'todo' },
        { id: 'commerce-3', label: '起租条件', state: 'todo' },
        { id: 'commerce-4', label: '风险定价', state: 'todo' },
      ],
    },
    asset: {
      key: 'asset', name: '资产', icon: 'diamond', status: 'working',
      blocker: '设备采购凭证待补充（合成）',
      blocks: [
        { id: 'asset-1', label: '权属链核对', state: 'working' },
        { id: 'asset-2', label: '采购真实性', state: 'working' },
        { id: 'asset-3', label: '价值核对', state: 'todo' },
        { id: 'asset-4', label: '回租结构', state: 'todo' },
      ],
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
    progressNote: '进度口径仅为演示：四刻度为项目里程碑标记，非四域各25%，100%不等于风险消失或全生命周期结束。',
    domains: buildInitialDomains(),
    messages: [
      { id: 1, fromKind: 'system', fromName: '系统', to: 'all', text: '交互预览 · 合成数据——不产生正式 Decision/Receipt；正式审批禁用。', marks: [] },
      { id: 2, fromKind: 'agent', fromName: 'Agent·信审', to: 'all', text: '信审（合成示例）：合同金额 500 万与营收下滑口径存在张力，需业务确认定价依据。', marks: ['模拟回复'] },
    ],
    nextId: 3,
    loop: { stage: 'credit-drafting', creditDraft: '', supplementRequest: null, businessResponse: null },
    formalNotice: null,
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
  | { type: 'reset' };

export const PREVIEW_ACTION_TYPES = [
  'set-role', 'save-credit-draft', 'send-supplement-request', 'send-business-response',
  'continue-credit', 'chat-send', 'chat-agent-reply', 'chat-human-takeover',
  'formal-attempt', 'hydrate', 'reset',
] as const;

function withMessage(state: PreviewState, message: Omit<PreviewMessage, 'id'>): PreviewState {
  return { ...state, nextId: state.nextId + 1, messages: [...state.messages, { ...message, id: state.nextId }] };
}

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'set-role':
      return { ...state, role: action.role };
    case 'save-credit-draft':
      return { ...state, loop: { ...state.loop, creditDraft: action.text } };
    case 'send-supplement-request': {
      if (state.loop.stage !== 'credit-drafting' || action.text.trim() === '') return state;
      const withMsg = withMessage(state, {
        fromKind: 'human', fromName: '张信审', to: 'business',
        text: `[模拟补充要求] 请业务确认定价依据：${action.text}`, marks: ['模拟人动作'],
      });
      return { ...withMsg, loop: { ...withMsg.loop, stage: 'request-sent', supplementRequest: action.text } };
    }
    case 'send-business-response': {
      if (state.loop.stage !== 'request-sent' || action.text.trim() === '') return state;
      const withMsg = withMessage(state, {
        fromKind: 'human', fromName: '张业务', to: 'credit',
        text: `[模拟回应] 定价依据说明：${action.text}`, marks: ['模拟人动作'],
      });
      return { ...withMsg, loop: { ...withMsg.loop, stage: 'business-responded', businessResponse: action.text } };
    }
    case 'continue-credit': {
      if (state.loop.stage !== 'business-responded') return state;
      const domains: Record<DomainKey, PreviewDomain> = {
        ...state.domains,
        credit: {
          ...state.domains.credit,
          status: 'ready',
          blocker: '意见候选就绪（模拟）；待人工复核',
        },
      };
      const withMsg = withMessage({ ...state, domains }, {
        fromKind: 'system', fromName: '系统', to: 'all',
        text: '信审意见候选已更新（模拟）——总览状态同步；本预览不产生正式结果。', marks: [],
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
    case 'reset':
      return initialPreviewState();
    default:
      // 未知动作失败关闭：原样返回，不猜测语义。
      return state;
  }
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
      detail: '信审意见候选已就绪（模拟）。', state: 'resolved', simulated: true,
    });
  }
  todos.push(
    { id: 'demo-asset', title: '转达资产补件请求：设备采购凭证', detail: '（合成示例）资产域待办转达。', state: 'working', simulated: true },
    { id: 'demo-commerce', title: '商务条件草案进度提醒', detail: '（合成示例）正式条件依赖有效人工决定。', state: 'todo', simulated: true },
  );
  return todos;
}

export interface CreditTodo { title: string; detail: string; state: WorkState }

export function deriveCreditTodo(state: PreviewState): CreditTodo {
  switch (state.loop.stage) {
    case 'credit-drafting':
      return { title: '营收下滑与合同金额矛盾——需定价依据', detail: '可先保存意见草稿，或向业务提出补充要求。', state: 'awaiting' };
    case 'request-sent':
      return { title: '已向业务提出补充要求（模拟）', detail: '等待业务回应中。', state: 'awaiting' };
    case 'business-responded':
      return { title: '业务已回应——可接续更新意见草稿', detail: state.loop.businessResponse ?? '', state: 'working' };
    case 'credit-continued':
      return { title: '意见候选就绪（模拟）', detail: '待人工复核；本预览不产生正式结果。', state: 'ready' };
  }
}

export function serializePreviewState(state: PreviewState): string {
  return JSON.stringify(state);
}

/** 损坏/不匹配一律返回 null（失败关闭，回退初始状态），不猜测。 */
export function parsePreviewState(raw: string): PreviewState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const v = value as Partial<PreviewState>;
    if (v.version !== 1) return null;
    if (!v.domains || typeof v.domains !== 'object') return null;
    if (!v.loop || typeof v.loop !== 'object') return null;
    if (!Array.isArray(v.messages)) return null;
    if (typeof v.nextId !== 'number') return null;
    return value as PreviewState;
  } catch {
    return null;
  }
}
// ---------- V5-PREVIEW-PURE-LOGIC-END ----------

// ---------- React 接线（预览壳内使用，不属于纯逻辑区） ----------

interface PreviewContextValue {
  state: PreviewState;
  dispatch: Dispatch<PreviewAction>;
  /** 发送聊天：目标是四域时调度一条模拟 Agent 回复（明确标记）。 */
  sendChatMessage: (text: string, to: 'all' | RoleKey) => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

const STORAGE_KEY = 'jw:v5-preview:state:v1';

export function PreviewStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(previewReducer, null, initialPreviewState);
  const hydratedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw === null ? null : parsePreviewState(raw);
      // 一次性水合：SSR 首帧必须与服务器输出一致，storage 只能在挂载后读取。
      if (parsed !== null) dispatch({ type: 'hydrate', state: parsed });
    } catch {
      // 存储不可用时回退初始合成状态，不阻塞预览。
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

  const sendChatMessage = useCallback((text: string, to: 'all' | RoleKey) => {
    dispatch({ type: 'chat-send', text, to });
    if (to !== 'all' && to !== 'business') {
      const reply = deriveAgentReply(text, to);
      const timer = window.setTimeout(() => {
        dispatch({ type: 'chat-agent-reply', text: reply.text, domain: to });
      }, 700);
      timersRef.current.push(timer);
    }
  }, []);

  const value: PreviewContextValue = { state, dispatch, sendChatMessage };
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewContextValue {
  const value = useContext(PreviewContext);
  if (value === null) throw new Error('usePreview 必须在 PreviewStateProvider 内使用');
  return value;
}
