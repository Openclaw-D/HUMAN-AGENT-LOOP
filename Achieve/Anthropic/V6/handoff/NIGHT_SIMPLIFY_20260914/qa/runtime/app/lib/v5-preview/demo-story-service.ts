// V6 NIGHT_SIMPLIFY · 固定演示主线服务（A 独占；契约 main/CONTRACT.md §5）。
// 与既有 rows service 同纪律：读文件 → 校验 → 同步改写 → 原子落盘，全程无 await 穿插。
// 演示推进 = 演示控制（与 demo/seed 同性质，非业务写入）；不触碰 remote-store；
// 既有 service/store 文件零改动：本文件只调用 store.ts 的读/写/幂等导出与 service.ts 的
// deriveOverallDescription 投影助手。
// 不建工作流引擎：固定步骤表（demo-story-data.ts）+ 每步 ≤3 个确定性后继。

import type { ProjectOverview, OverviewMessage } from './shared-types.ts';
import {
  hashV5Payload,
  readV5StoreState,
  writeV5StoreState,
} from './store.ts';
import { createSeedOverview, deriveOverallDescription, V5PreviewServiceError } from './service.ts';
import {
  DEMO_STORY_STEPS,
  DEMO_STORY_START_STEP_ID,
} from './demo-story-data.ts';
import type { DemoStoryStep, StoryDecisionKind, StoryDecisionOption } from './demo-story-types.ts';
import { overviewSignature, storyStepSignature } from './demo-story-types.ts';

// ---------------------------------------------------------------------------
// 错误（独立命名空间：演示主线错误不进入既有 ApiErrorCode 冻结枚举，避免共享类型变更）
// ---------------------------------------------------------------------------

export type DemoStoryErrorCode =
  | 'INVALID_INPUT'
  | 'VERSION_CONFLICT'
  | 'REQUEST_MISMATCH'
  | 'STORY_STEP_CHANGED'
  | 'STORY_DECISION_REQUIRED';

const ERROR_STATUSES: Record<DemoStoryErrorCode, number> = {
  INVALID_INPUT: 400,
  VERSION_CONFLICT: 409,
  REQUEST_MISMATCH: 409,
  STORY_STEP_CHANGED: 409,
  STORY_DECISION_REQUIRED: 409,
};

/** 路由层统一错误出口：DemoStoryError 按码表；V5PreviewServiceError（请求体解析等）按既有码表；
 *  其他一律 STORE_UNAVAILABLE 失败关闭。 */
export function demoStoryErrorResponse(error: unknown, fallbackJson: (payload: unknown, status: number) => Response): Response {
  if (error instanceof DemoStoryError) {
    const payload: { ok: false; error: string; message: string; serverVersion?: number } = {
      ok: false,
      error: error.code,
      message: error.message,
    };
    if (error.serverVersion !== undefined) payload.serverVersion = error.serverVersion;
    return fallbackJson(payload, ERROR_STATUSES[error.code]);
  }
  if (error instanceof V5PreviewServiceError) {
    const payload: { ok: false; error: string; message: string; serverVersion?: number } = {
      ok: false,
      error: error.code,
      message: error.message,
    };
    if (error.serverVersion !== undefined) payload.serverVersion = error.serverVersion;
    return fallbackJson(payload, ERROR_STATUSES[error.code as DemoStoryErrorCode] ?? 400);
  }
  return fallbackJson({ ok: false, error: 'STORE_UNAVAILABLE', message: '服务内部错误（合成演示存储不可用）' }, 500);
}

export class DemoStoryError extends Error {
  readonly code: DemoStoryErrorCode;
  readonly serverVersion?: number;

  constructor(code: DemoStoryErrorCode, message: string, serverVersion?: number) {
    super(message);
    this.name = 'DemoStoryError';
    this.code = code;
    this.serverVersion = serverVersion;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// 当前步推导（纯读）：overview 内容签名 ↔ 步骤表逐项匹配
// ---------------------------------------------------------------------------

function findStepByOverview(overview: ProjectOverview): DemoStoryStep | null {
  const sig = overviewSignature(overview);
  for (const step of DEMO_STORY_STEPS) {
    if (storyStepSignature(step) === sig) return step;
  }
  return null;
}

export interface DemoStoryStepProjection {
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
    options: readonly { kind: StoryDecisionKind; label: string }[];
  } | null;
}

export interface DemoStoryState {
  ok: true;
  mode: 'story' | 'free';
  version: number;
  step: DemoStoryStepProjection | null;
  /** free 模式的诚实说明（签名无匹配 = 已离开固定路线或尚未按固定路线使用）。 */
  freeNotice: string | null;
}

export function getStoryState(): DemoStoryState {
  const state = readV5StoreState({ seed: () => createSeedOverview('approval') });
  const overview = state.overview;
  const step = findStepByOverview(overview);
  if (step === null) {
    return {
      ok: true,
      mode: 'free',
      version: overview.version,
      step: null,
      freeNotice: '当前状态不在固定演示路线上（可自由使用演示情景）。点击「重新开始」回到固定演示起点。',
    };
  }
  return {
    ok: true,
    mode: 'story',
    version: overview.version,
    step: {
      stepId: step.stepId,
      stepIndex: DEMO_STORY_STEPS.indexOf(step),
      stepsTotal: DEMO_STORY_STEPS.length,
      stageIndex: step.stageIndex,
      stageLabel: step.stageLabel,
      title: step.title,
      hint: step.hint ?? null,
      evidenceRefs: step.evidenceRefs ?? [],
      decision: step.decision
        ? { prompt: step.decision.prompt, options: step.decision.options.map((o) => ({ kind: o.kind, label: o.label })) }
        : null,
    },
    freeNotice: null,
  };
}

// ---------------------------------------------------------------------------
// 写路径：advance（一键推进常规动作）/ decide（人工决定）
// ---------------------------------------------------------------------------

interface StoryCommandInput {
  action?: unknown;
  requestId?: unknown;
  expectedVersion?: unknown;
  fromStepId?: unknown;
  decision?: unknown;
  note?: unknown;
}

function asRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 64 ? value : undefined;
}

function asExpectedVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** 由步骤链构建写入后的 overview：最后一个应用步决定 domains/todo/labels；
 *  全部被应用步的预设消息按顺序追加（id/at 落库时生成）。
 *  （NIGHT_SIMPLIFY 续轮：自动推进链——一次 advance 应用连续的常规自动步，
 *  在人工动作/人工决定步应用后停止；消息逐步入流，与 C 机制 advanceAuto 同语义。） */
function buildOverviewFromSteps(current: ProjectOverview, applied: readonly DemoStoryStep[], requestId: string, extraNote: string | null): ProjectOverview {
  const at = nowIso();
  const last = applied[applied.length - 1];
  const storyMessages: OverviewMessage[] = [];
  applied.forEach((step, si) => {
    step.messages.forEach((m, i) => {
      storyMessages.push({ ...m, id: `msg-story-${step.stepId}-${requestId.slice(0, 12)}-${si}-${i}`, at });
    });
  });
  const noteMessage: OverviewMessage | null =
    extraNote !== null
      ? {
          id: `msg-story-note-${last.stepId}-${requestId.slice(0, 12)}`,
          fromKind: 'business',
          fromName: '业务（演示身份）',
          text: extraNote,
          at,
          marks: ['补充说明'],
        }
      : null;
  const domains = last.domains.map((d) => ({ ...d }));
  const progressLabel = last.progressLabel;
  return {
    ...current,
    scenario: last.scenario ?? 'approval',
    scenarioLabel: last.scenarioLabel,
    version: current.version + applied.length,
    updatedAt: at,
    overall: { progressLabel, description: deriveOverallDescription(domains) },
    domains,
    todo: last.todo === null ? null : { ...last.todo },
    messages: [...current.messages, ...storyMessages, ...(noteMessage !== null ? [noteMessage] : [])],
  };
}

/** 后继定位：显式 nextStepId 优先（分支步回跳）；缺省 = 数组下一项（主线直行）。 */
function nextStepOf(step: DemoStoryStep): DemoStoryStep | null {
  if (step.nextStepId !== undefined) return findStepById(step.nextStepId);
  const idx = DEMO_STORY_STEPS.indexOf(step);
  return DEMO_STORY_STEPS[idx + 1] ?? null;
}

/** 自动推进链（C 机制 advanceAuto 同语义）：从 from 的后继开始依次应用常规自动步；
 *  遇到 人工动作步（holdForHuman）或 人工决定步（decision）时应用该步后停止；
 *  全表走完仍无停止点 = 已到终点；后继链异常（环/断链）失败关闭。 */
function chainFrom(from: DemoStoryStep): readonly DemoStoryStep[] {
  const applied: DemoStoryStep[] = [];
  let cur = from;
  let guard = 0;
  let stopped = false;
  while (guard <= DEMO_STORY_STEPS.length && !stopped) {
    guard += 1;
    const nxt = nextStepOf(cur);
    if (nxt === null) {
      // 走到表尾：常规链以终点步收束。
      stopped = true;
      break;
    }
    cur = nxt;
    applied.push(nxt);
    if (nxt.decision !== undefined || nxt.holdForHuman === true) {
      stopped = true;
    }
  }
  if (applied.length === 0) {
    // from 无后继 = 已在终点。
    return applied;
  }
  if (!stopped) {
    throw new DemoStoryError('STORY_STEP_CHANGED', '演示后继链异常（演示数据缺陷，已失败关闭）');
  }
  return applied;
}

function findStepById(stepId: string): DemoStoryStep | null {
  return DEMO_STORY_STEPS.find((s) => s.stepId === stepId) ?? null;
}

export interface DemoStoryWriteResponse {
  ok: true;
  overview: ProjectOverview;
  step: { stepId: string; stageIndex: number; awaitingDecision: boolean };
  replayed?: boolean;
}

function applyChainAndRespond(
  state: ReturnType<typeof readV5StoreState>,
  requestId: string,
  hash: string,
  applied: readonly DemoStoryStep[],
  extraNote: string | null,
): DemoStoryWriteResponse {
  const landing = applied[applied.length - 1];
  const next = buildOverviewFromSteps(state.overview, applied, requestId, extraNote);
  const response: DemoStoryWriteResponse = {
    ok: true,
    overview: next,
    step: {
      stepId: landing.stepId,
      stageIndex: landing.stageIndex,
      awaitingDecision: landing.decision !== undefined,
    },
  };
  state.idempotency.record({ requestId, hash, response });
  writeV5StoreState({ overview: next, idempotency: state.idempotency });
  return response;
}

/** 推进/决定统一入口（同一幂等/版本门/步骤门语义）。 */
export function runStoryCommand(body: StoryCommandInput): DemoStoryWriteResponse {
  const action = body.action;
  const requestId = asRequestId(body.requestId);
  const expectedVersion = asExpectedVersion(body.expectedVersion);
  const fromStepId = typeof body.fromStepId === 'string' ? body.fromStepId : undefined;
  if (
    (action !== 'advance' && action !== 'decide') ||
    requestId === undefined ||
    expectedVersion === undefined ||
    fromStepId === undefined
  ) {
    throw new DemoStoryError(
      'INVALID_INPUT',
      'story 请求字段非法：action("advance"|"decide")、requestId(1..64)、expectedVersion(整数)、fromStepId 均为必填',
    );
  }
  const note =
    body.note === undefined || body.note === null
      ? null
      : typeof body.note === 'string' && body.note.trim().length > 0 && body.note.trim().length <= 2000
        ? body.note.trim()
        : undefined;
  if (note === undefined) {
    throw new DemoStoryError('INVALID_INPUT', 'note 非法：1..2000 字符（trim 后非空）');
  }

  const state = readV5StoreState({ seed: () => createSeedOverview('approval') });
  const hash = hashV5Payload(
    JSON.stringify({ requestId, expectedVersion, fromStepId, action, decision: body.decision, note: body.note }),
  );
  const cached = state.idempotency.lookup(requestId);
  if (cached !== undefined) {
    if (cached.hash !== hash) {
      throw new DemoStoryError('REQUEST_MISMATCH', '同 requestId 但载荷不同：重试不得更换载荷');
    }
    return { ...(cached.response as DemoStoryWriteResponse), replayed: true };
  }

  const overview = state.overview;
  if (expectedVersion !== overview.version) {
    throw new DemoStoryError(
      'VERSION_CONFLICT',
      `版本已更新：客户端持有 v${expectedVersion}，服务端为 v${overview.version}；请刷新后重试`,
      overview.version,
    );
  }

  const current = findStepByOverview(overview);
  if (current === null || current.stepId !== fromStepId) {
    throw new DemoStoryError(
      'STORY_STEP_CHANGED',
      '固定演示状态已变化（可能已推进或已离开固定路线）：请刷新后按最新状态操作',
      overview.version,
    );
  }

  if (action === 'advance') {
    if (current.decision !== undefined) {
      throw new DemoStoryError('STORY_DECISION_REQUIRED', '当前为人工决定点：必须先做出决定（确认/纠正/退回）才能继续');
    }
    const applied = chainFrom(current);
    if (applied.length === 0) {
      throw new DemoStoryError('STORY_STEP_CHANGED', '固定演示已到达终点（已结清）：可点击「重新开始」');
    }
    return applyChainAndRespond(state, requestId, hash, applied, null);
  }

  // decide：人工决定点三分支，确定性后继。
  const decision = current.decision;
  if (decision === undefined) {
    throw new DemoStoryError('STORY_STEP_CHANGED', '当前步骤不是人工决定点：请使用「推进」');
  }
  const kind = body.decision;
  if (typeof kind !== 'string' || !decision.options.some((o: StoryDecisionOption) => o.kind === kind)) {
    throw new DemoStoryError('INVALID_INPUT', 'decision 非法：必须是 confirm / correct / return 之一');
  }
  const option = decision.options.find((o: StoryDecisionOption) => o.kind === kind) as StoryDecisionOption;
  const target = findStepById(option.nextStepId);
  if (target === null) {
    // 步骤表自洽性由测试保证；运行期防御：不猜测后继。
    throw new DemoStoryError('STORY_STEP_CHANGED', '决定后继步骤不存在（演示数据缺陷，已失败关闭）');
  }
  // 决定路径只应用分支目标步本身（不自动链）：人工决定后的人工动作（如补交材料）保持独立点击边界。
  // 纠正/退回允许附补充说明（留档）；确认时 note 可为空。
  return applyChainAndRespond(state, requestId, hash, [target], kind === 'confirm' ? note : (note ?? null));
}

export const DEMO_STORY_START = DEMO_STORY_START_STEP_ID;
