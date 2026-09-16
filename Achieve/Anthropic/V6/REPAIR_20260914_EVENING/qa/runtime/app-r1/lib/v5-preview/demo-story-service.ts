// V6 NIGHT_SIMPLIFY · 固定演示主线服务（A 独占；契约 main/CONTRACT.md §5 + REPAIR evening INTERFACE.md v1）。
// 与既有 rows service 同纪律：读文件 → 校验 → 同步改写 → 原子落盘，全程无 await 穿插。
// 演示推进 = 演示控制（与 demo/seed 同性质，非业务写入）。
// REPAIR evening 变更（共享状态闭环，接口见 REPAIR_20260914_EVENING/main/INTERFACE.md）：
//  - 当前步以稳定游标（rows-store v2 storyCursor.stepId）定位；展示文案/待办状态变化不再脱离固定路线
//    （@1 旧文件回退签名定位，写入时迁移 @2）；
//  - 演示的现场补充/纠正决定经共享事实层（shared-facts）写真实证据/复核记录（确定性 ID 幂等），
//    不再"另演一套状态"；
//  - 写入响应在步表构建后重放共享投影（受影响域/待办标记与共享尽调消息不因推进丢失）。
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
import { applySharedFacts, applyStoryFactOps, computeSharedFacts, syncSharedProjection, type StoryFactOp } from './shared-facts.ts';
import { readRemoteStoreState } from './remote-store.ts';

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
// 当前步定位：稳定游标优先（@1 旧文件回退签名匹配）
// ---------------------------------------------------------------------------

/** @1 迁移回退：overview 内容签名 ↔ 步骤表匹配（签名不受消息影响，但会被域文案改写破坏——
 *  因此仅作为无游标旧文件的回退，主定位是 storyCursor.stepId）。 */
function findStepByOverview(overview: ProjectOverview): DemoStoryStep | null {
  const sig = overviewSignature(overview);
  for (const step of DEMO_STORY_STEPS) {
    if (storyStepSignature(step) === sig) return step;
  }
  return null;
}

interface LocatedStep {
  step: DemoStoryStep | null;
  /** 定位方式：cursor = 稳定标识；signature = @1 回退；none = 自由态。 */
  via: 'cursor' | 'signature' | 'none';
  /** 游标失效说明（cursor 指向不存在的步 = 演示数据缺陷，诚实降级 free）。 */
  danglingNotice: string | null;
}

function locateCurrentStep(overview: ProjectOverview, cursorStepId: string | null): LocatedStep {
  if (cursorStepId !== null) {
    const step = DEMO_STORY_STEPS.find((s) => s.stepId === cursorStepId) ?? null;
    if (step === null) {
      return { step: null, via: 'none', danglingNotice: '演示进度指针指向的步骤不存在（演示数据异常）。点击「重新开始」回到固定演示起点。' };
    }
    return { step, via: 'cursor', danglingNotice: null };
  }
  const step = findStepByOverview(overview);
  return { step, via: step === null ? 'none' : 'signature', danglingNotice: null };
}

/** 读 rows 并完成 @1→@2 游标迁移：无游标时先用签名回退定位并立即回填稳定游标，
 *  再进行共享投影同步——投影改写域文案不影响已迁移的稳定定位（迁移优先于投影）。 */
function loadRowsLocated(): ReturnType<typeof readV5StoreState> {
  let rows = readV5StoreState({ seed: () => createSeedOverview('approval') });
  if ((rows.storyCursor?.stepId ?? null) === null) {
    const step = findStepByOverview(rows.overview);
    if (step !== null) {
      rows = { ...rows, storyCursor: { stepId: step.stepId, updatedAt: nowIso() } };
      writeV5StoreState(rows);
    }
  }
  return rows;
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
  /** 共享尽调事实同步降级说明（remote 存储不可用时非 null；不阻塞首页只读浏览）。 */
  sharedWarning: string | null;
}

export function getStoryState(): DemoStoryState {
  // 先迁移游标（@1 签名回退 → 稳定标识），再共享投影同步（投影可能改写域文案，
  // 不得让投影先于迁移破坏签名定位）。
  loadRowsLocated();
  const sync = syncSharedProjection();
  const rows = sync.rows;
  const located = locateCurrentStep(rows.overview, rows.storyCursor?.stepId ?? null);
  const step = located.step;
  if (step === null) {
    return {
      ok: true,
      mode: 'free',
      version: rows.overview.version,
      step: null,
      freeNotice: located.danglingNotice ?? '当前状态不在固定演示路线上（可自由使用演示情景）。点击「重新开始」回到固定演示起点。',
      sharedWarning: sync.degraded,
    };
  }
  return {
    ok: true,
    mode: 'story',
    version: rows.overview.version,
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
    sharedWarning: sync.degraded,
  };
}

// ---------------------------------------------------------------------------
// 演示事实操作映射（固定演示经同一命令区写真实证据/复核；INTERFACE §4）
// ---------------------------------------------------------------------------

/** 补充类步 → 证据写入（离步推进时应用：发起访谈建链、现场补充升版、补交/条款材料建链）。 */
const SUPPLEMENT_OPS: Record<string, StoryFactOp> = {
  's03-dd-01': { kind: 'attach', stepToken: 's03dd01', fixtureId: 'fixture-inspection' },
  's05-dd-03': { kind: 'supersede-root', stepToken: 's05dd03', fixtureId: 'fixture-inspection' },
  's10-dd-rt-1': { kind: 'attach', stepToken: 's10drt1', fixtureId: 'fixture-equipment' },
  's14-sg-01': { kind: 'attach', stepToken: 's14sg01', fixtureId: 'fixture-contract' },
  's16-sg-rt': { kind: 'supersede-root', stepToken: 's16sgrt', fixtureId: 'fixture-contract' },
};

/** 纠正决定 → 真实复核记录（correct：旧结论转入待复核）。 */
const CORRECT_OPS: Record<string, StoryFactOp> = {
  's09-dd-07': { kind: 'correct', stepToken: 's09correct', fixtureId: 'fixture-inspection' },
  's12-dd-07b': { kind: 'correct', stepToken: 's12correct', fixtureId: 'fixture-equipment' },
  's15-sg-02': { kind: 'correct', stepToken: 's15correct', fixtureId: 'fixture-contract' },
};

function storyFactOpsFor(applied: readonly DemoStoryStep[], decision: StoryDecisionKind | undefined): StoryFactOp[] {
  const ops: StoryFactOp[] = [];
  for (const step of applied) {
    const supplement = SUPPLEMENT_OPS[step.stepId];
    if (supplement !== undefined) ops.push(supplement);
  }
  if (decision === 'correct' && applied.length > 0) {
    const correct = CORRECT_OPS[applied[applied.length - 1].stepId];
    if (correct !== undefined) ops.push(correct);
  }
  return ops;
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

/** 步表构建后重放共享投影：受影响域/待办标记与共享尽调消息不因演示推进丢失。 */
function projectAfterBuild(built: ProjectOverview, sessionId: string | null): ProjectOverview {
  if (sessionId === null) return built;
  const remote = readRemoteStoreState();
  const facts = computeSharedFacts(remote, sessionId);
  if (facts === null) return built;
  return applySharedFacts(built, facts, remote);
}

function applyChainAndRespond(
  rows: ReturnType<typeof readV5StoreState>,
  requestId: string,
  hash: string,
  applied: readonly DemoStoryStep[],
  extraNote: string | null,
  decision: StoryDecisionKind | undefined,
  sessionId: string | null,
): DemoStoryWriteResponse {
  const landing = applied[applied.length - 1];
  const built = buildOverviewFromSteps(rows.overview, applied, requestId, extraNote);
  const overview = projectAfterBuild(built, sessionId);
  const response: DemoStoryWriteResponse = {
    ok: true,
    overview,
    step: {
      stepId: landing.stepId,
      stageIndex: landing.stageIndex,
      awaitingDecision: landing.decision !== undefined,
    },
  };
  rows.idempotency.record({ requestId, hash, response });
  writeV5StoreState({
    overview,
    idempotency: rows.idempotency,
    storyCursor: { stepId: landing.stepId, updatedAt: nowIso() },
    sharedDemo: rows.sharedDemo,
  });
  return response;
}

/** 推进/决定统一入口（同一幂等/版本门/步骤门语义）。
 *  REPAIR：先同步共享投影（含专属会话懒建），再校验与写入；纠正决定与补充步经
 *  applyStoryFactOps 写真实证据/复核（确定性 ID 幂等；remote 失败→整体中止，rows 未写，
 *  客户端原样重试安全）。 */
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

  loadRowsLocated(); // @1 旧文件：先把签名定位迁移为稳定游标，再同步共享投影。
  const sync = syncSharedProjection();
  const rows = sync.rows;
  const sessionId = rows.sharedDemo.sessionId;
  const hash = hashV5Payload(
    JSON.stringify({ requestId, expectedVersion, fromStepId, action, decision: body.decision, note: body.note }),
  );
  const cached = rows.idempotency.lookup(requestId);
  if (cached !== undefined) {
    if (cached.hash !== hash) {
      throw new DemoStoryError('REQUEST_MISMATCH', '同 requestId 但载荷不同：重试不得更换载荷');
    }
    return { ...(cached.response as DemoStoryWriteResponse), replayed: true };
  }

  const overview = rows.overview;
  if (expectedVersion !== overview.version) {
    throw new DemoStoryError(
      'VERSION_CONFLICT',
      `版本已更新：客户端持有 v${expectedVersion}，服务端为 v${overview.version}；请刷新后重试`,
      overview.version,
    );
  }

  const located = locateCurrentStep(overview, rows.storyCursor?.stepId ?? null);
  const current = located.step;
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
    // 现场补充/补交类步：经共享事实层写真实证据（remote 失败→上抛中止，rows 未写）。
    if (sessionId !== null) {
      applyStoryFactOps(sessionId, storyFactOpsFor(applied, undefined));
    }
    return applyChainAndRespond(rows, requestId, hash, applied, null, undefined, sessionId);
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
  // 纠正决定：写真实复核记录（correct）→ 投影把旧结论标待复核（INTERFACE §4）。
  // 键 = 当前决定步（s09/s12/s15），不是分支目标步。
  if (sessionId !== null) {
    const correctOp = kind === 'correct' ? CORRECT_OPS[current.stepId] : undefined;
    const targetSupplement = SUPPLEMENT_OPS[target.stepId];
    const ops: StoryFactOp[] = [];
    if (targetSupplement !== undefined) ops.push(targetSupplement);
    if (correctOp !== undefined) ops.push(correctOp);
    applyStoryFactOps(sessionId, ops);
  }
  // 决定路径只应用分支目标步本身（不自动链）：人工决定后的人工动作（如补交材料）保持独立点击边界。
  // 纠正/退回允许附补充说明（留档）；确认时 note 可为空。
  // kind 已通过选项成员校验（其类型即 StoryDecisionKind），此处按值收窄。
  const decidedKind = kind as StoryDecisionKind;
  return applyChainAndRespond(rows, requestId, hash, [target], decidedKind === 'confirm' ? note : (note ?? null), decidedKind, sessionId);
}

export const DEMO_STORY_START = DEMO_STORY_START_STEP_ID;
