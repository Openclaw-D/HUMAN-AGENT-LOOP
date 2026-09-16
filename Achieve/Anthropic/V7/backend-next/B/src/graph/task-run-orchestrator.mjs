// V7 backend-next B 任务执行编排器(LangGraph JS,持久化 checkpoint)。
// 一个 thread = 一个 TaskRun(A 领取的一次 TaskAssignment 的执行)。
// 图:START→init→advance(每 superstep 按计划推进一个就绪步)→aggregate→
//    (未终局→advance / completed→END / 其余→human_gate→(END|advance))
// 继承 V7/backend/B 已验证语义并按本轮任务书收紧:
//   - 三分发送:未发送/确定失败/发送后未知,回执门 + unknown 零自动重试;
//   - 恢复时节点重入必须检查业务回执:B 回执(intent/terminal)+ A ExecutionReceipt;
//     工具步是本地确定性计算(无外部副作用),可安全重跑,不走回执门;
//   - 陈旧结果丢弃:completed 前重读 A 事实版本,已变化 → stale,候选不得当现行;
//   - 人工门 interrupt():D-9 身份门在包装层,凭据不进图(零 checkpoint 凭据);
//   - 取消在步边界生效(取消已发出的在途调用属 unknown 域,不由本层谎称 cancelled);
//   - lease/fencing 由 worker 持有;编排器只记录,不自行判定任务归属。
// A 是业务事实权威;B 的 checkpoint 只是执行状态,不替代 A(无第二套审批状态机)。

import { StateGraph, Annotation, END, START, interrupt, Command } from '@langchain/langgraph';
import {
  RUN_STATE, STEP_STATE, HUMAN_ACTION, ERROR_CODES, RECEIPT_PHASE,
} from '../codes.mjs';
import {
  computeReadiness, decideRunTerminal, aggregateCandidates, modelRequestId,
} from './decision.mjs';
import { bridgeTransportResult, toACandidate } from '../transport/bridge.mjs';
import { buildModelRequest } from '../transport/glm.mjs';
import {
  validateResumeAccess, validateResumeCommand, computeResumeEffects, evidenceWaitingStepIds, isResumable,
} from '../resume-core.mjs';
import { sanitizeForCheckpoint } from '../redact.mjs';
import { sha256hex } from '../ports.mjs';

const MAX_ROUNDS = 24;

function mergeSteps(a, b) { return { ...(a ?? {}), ...(b ?? {}) }; }
function lastWins(_a, b) { return b; }
function concatLists(a, b) { return [...(a ?? []), ...(b ?? [])]; }

const RunState = Annotation.Root({
  taskRun: Annotation({ reducer: lastWins, default: () => null }),
  // {taskRunId, taskId, goalId, projectId, workerId, fencingToken, leaseUntil, taskKind, role, purpose}
  plan: Annotation({ reducer: lastWins, default: () => [] }),        // 路由产出的线性执行计划
  ruleId: Annotation({ reducer: lastWins, default: () => null }),    // 命中规则(审计)
  toolInputs: Annotation({ reducer: lastWins, default: () => null }), // 工具步输入(来自 task.inputs)
  deps: Annotation({ reducer: lastWins, default: () => ({}) }),      // 线性顺序展开的前序关系
  steps: Annotation({ reducer: mergeSteps, default: () => ({}) }),
  requiredVersions: Annotation({ reducer: lastWins, default: () => null }),
  evidenceRefs: Annotation({ reducer: lastWins, default: () => [] }),
  generation: Annotation({ reducer: lastWins, default: () => 1 }),
  terminal: Annotation({ reducer: lastWins, default: () => null }),
  humanActions: Annotation({ reducer: concatLists, default: () => [] }),
  round: Annotation({ reducer: lastWins, default: () => 0 }),
  cancelRequested: Annotation({ reducer: lastWins, default: () => false }),
  pauseNotice: Annotation({ reducer: lastWins, default: () => null }),
});

export function createTaskRunOrchestrator({
  ports, contract, transport, router, checkpointer,
  sinks = [], principalVerifier = null, authorizer = null,
  logger = () => {}, now = () => new Date().toISOString(),
}) {
  if (!ports?.receipts || !ports?.factVersions || !ports?.tools) throw new Error('缺少端口:receipts/factVersions/tools');
  if (!contract) throw new Error('缺少契约端口(A 事实权威;stub 或 http)');
  if (!transport) throw new Error('缺少模型 transport');
  if (!router) throw new Error('缺少路由器(规则限定)');
  if (!checkpointer) throw new Error('LangGraph:必须注入 checkpointer(真实落盘)');

  // 取消的进程内通道:updateState 在 invoke 活动期间会分叉出孤儿 checkpoint(对运行中
  // superstep 不可见),故同进程取消用内存集合;updateState 仅用于跨进程(已崩溃)线程。
  const cancelledRuns = new Set();
  const graph = buildGraph({ ports, contract, transport, router, sinks, logger, now, cancelledRuns });
  const app = graph.compile({ checkpointer });
  const cfg = (taskRunId) => ({ configurable: { thread_id: taskRunId, checkpoint_ns: '' } });

  return {
    /** 启动 TaskRun:路由 → 初始化计划 → 推进。幂等:已有计划则不重建(重放保护)。 */
    async start({ taskRunId, taskId, goalId, projectId, assignment, task }) {
      const state = await app.getState(cfg(taskRunId));
      if (state?.values?.plan?.length) {
        return { ...publicView(taskRunId, state.values), replayed: true }; // 重放:不重建
      }
      const route = router.routeTask({ taskId, taskKind: task.taskKind ?? task.goalKey, role: task.role, purpose: task.purpose });
      const current = await ports.factVersions.currentVersions(projectId, goalId);
      const init = {
        taskRun: {
          taskRunId, taskId, goalId, projectId,
          workerId: assignment?.workerId ?? null,
          fencingToken: assignment?.fencingToken ?? null,
          leaseUntil: assignment?.leaseUntil ?? null,
          taskKind: task.taskKind, role: task.role ?? null, purpose: task.purpose ?? null,
        },
        requiredVersions: { factVersion: String(current.factVersion), ruleVersion: String(current.ruleVersion) },
        evidenceRefs: (task.evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: String(e.version), hash: String(e.hash ?? '') })),
        round: 0,
      };
      let first;
      if (!route.ok) {
        // NO_ROUTE:不猜,升级人工(计划为空,terminal 直接 human_required)
        first = {
          ...init,
          plan: [],
          steps: {},
          terminal: { kind: RUN_STATE.HUMAN_REQUIRED, reasonZh: route.messageZh, noRoute: true },
        };
      } else {
        const steps = {};
        const deps = {};
        route.plan.forEach((s, i) => {
          steps[s.stepId] = { id: s.stepId, ...s, state: STEP_STATE.PENDING, attempt: 0, error: null, candidate: null, requestId: null };
          if (i > 0) deps[s.stepId] = [route.plan[i - 1].stepId]; // 线性前序
        });
        first = { ...init, plan: route.plan.map((s) => s.stepId), deps, steps, ruleId: route.ruleId, toolInputs: task.inputs ?? task.params ?? null };
      }
      const result = await app.invoke(first, cfg(taskRunId));
      return { ...publicView(taskRunId, result), replayed: false };
    },

    /** 崩溃恢复:新进程同 checkpointer 打开;投影视图 + 与业务回执对账(不自动续跑)。 */
    async recover(taskRunId) {
      const state = await app.getState(cfg(taskRunId));
      if (!state?.values?.taskRun) return null;
      const view = publicView(taskRunId, state.values);
      // 节点重入业务回执对账:凡计划内模型步,用确定性 requestId 查 B 回执 + A ExecutionReceipt
      const notes = [];
      for (const s of Object.values(state.values.steps ?? {})) {
        if (s.kind !== 'model') continue;
        const rid = requestIdOf(taskRunId, s);
        const local = await ports.receipts.get(rid);
        if (local?.phase === RECEIPT_PHASE.TERMINAL) {
          notes.push(`步 ${s.id}:B 存在 terminal 回执,恢复续跑时将复用(零外部调用)`);
          continue;
        }
        const aReceipt = await contract.getExecutionReceipt(`${taskRunId}::complete`);
        if (aReceipt && aReceipt.state === 'succeeded') {
          notes.push(`步 ${s.id}:A 已有完成回执但 B checkpoint 未及落盘:恢复对账按 A 回执收口`);
        } else {
          notes.push(`步 ${s.id}(模型调用)中断于发送后:B/A 均无 terminal 回执 → 续跑按 unknown(不自动重发)`);
        }
      }
      // worker 提交回执对账:若 A 已记录本 run 的完成回执,如实标注(防重复提交)
      const submitReceipt = await contract.getExecutionReceipt(`${taskRunId}::complete`);
      if (submitReceipt) view.aSubmitReceipt = { state: submitReceipt.state, at: submitReceipt.at ?? null };
      if (notes.length) view.recoveryNotes = notes;
      return view;
    },

    /** 系统统跑(崩溃后无 pending interrupt 时):invoke(null) 重入未完成节点。
     *  步节点重入先查业务回执:模型 intent-无-terminal → unknown(不自动重发);
     *  工具步本地确定性,可安全重跑;terminal 回执 → 复用零调用。 */
    async continueRun(taskRunId) {
      const before = await app.getState(cfg(taskRunId));
      if (!before?.values?.taskRun) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${taskRunId} 不存在`);
      if (before.values.terminal || before.next?.length === 0) {
        return { ...publicView(taskRunId, before.values), continued: false };
      }
      const result = await app.invoke(null, cfg(taskRunId));
      return { ...publicView(taskRunId, result), continued: true };
    },

    /**
     * 人工 resume(D-9):身份门在包装层,凭据绝不进图 → Command 载荷只含盖章净化命令,
     * checkpoint 零凭据。身份/授权拒绝在边界抛错(不产生 checkpoint 写入)。
     */
    async resume(taskRunId, command) {
      const state = await app.getState(cfg(taskRunId));
      if (!state?.values?.taskRun) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${taskRunId} 不存在`);
      // 边界前置检查(零写入零调用):已完成/在途运行不接受 resume;且必须停在人工门
      // (无 interrupt 挂起时 Command{resume} 会重放图,绕过图内命令校验——重复授权的洞)
      const terminalKind = state.values.terminal?.kind ?? null;
      if (!isResumable(terminalKind)) {
        if (terminalKind === RUN_STATE.COMPLETED) throw errCode(ERROR_CODES.TERMINAL_STATE, '运行已完成,无可恢复事项');
        throw errCode(ERROR_CODES.RUN_NOT_RESUMABLE, '运行仍在执行中,不能并发 resume');
      }
      if (!state.next?.includes('human_gate')) {
        throw errCode(ERROR_CODES.RUN_NOT_RESUMABLE, '运行未停在人工门:先经 recover/continueRun 使其到达可恢复挂起点');
      }
      const access = validateResumeAccess({
        principalVerifier, authorizer, command,
        ctx: { runId: taskRunId, projectId: state.values.taskRun.projectId, action: command?.action, stepId: command?.stepId ?? null },
      });
      if (!access.ok) throw errCode(access.code, access.messageZh);
      const sanitized = {
        gateStamp: { principalId: access.principalId, role: access.role }, // 包装层盖章
        action: command.action,
        stepId: command.stepId ?? null,
        payload: command.payload ?? {},
      };
      const result = await app.invoke(new Command({ resume: sanitized }), cfg(taskRunId));
      return publicView(taskRunId, result);
    },

    /** 取消:步边界生效。已发出的在途调用不受本方法支配(其结果按 transport 语义落账)。 */
    async cancel(taskRunId, reasonZh = '人工取消') {
      const state = await app.getState(cfg(taskRunId));
      if (!state?.values?.taskRun) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${taskRunId} 不存在`);
      if (state.values.terminal || state.next?.length === 0) {
        return { ...publicView(taskRunId, state.values), cancelApplied: false };
      }
      cancelledRuns.add(taskRunId);
      // 跨进程通道:线程空闲(崩溃恢复场景)时 updateState 落 checkpoint;活动 invoke 期间
      // 该写会成为孤儿分支(无害),由内存集合兜底
      await app.updateState(cfg(taskRunId), { cancelRequested: true }, 'advance').catch(() => {});
      return { ok: true, mode: 'step-boundary', reasonZh };
    },

    async view(taskRunId) {
      const state = await app.getState(cfg(taskRunId));
      return state?.values?.taskRun ? publicView(taskRunId, state.values) : null;
    },
  };
}

// ---------- 图构造 ----------

function buildGraph(ctx) {
  const g = new StateGraph(RunState)
    .addNode('init', makeInit(ctx))
    .addNode('advance', makeAdvance(ctx))
    .addNode('aggregate', makeAggregate(ctx))
    .addNode('human_gate', makeHumanGate(ctx));
  g.addEdge(START, 'init');
  g.addEdge('init', 'advance');
  g.addEdge('advance', 'aggregate');
  g.addConditionalEdges('aggregate', (s) => {
    if (!s.terminal) return 'advance';
    if (s.terminal.kind === RUN_STATE.COMPLETED) return END;
    if (s.terminal.kind === RUN_STATE.FAILED && s.terminal.humanAborted) return END;
    return 'human_gate';
  }, { advance: 'advance', human_gate: 'human_gate', [END]: END });
  g.addConditionalEdges('human_gate', (s) => (s.terminal && (s.terminal.humanAccepted || s.terminal.humanAborted)) ? END : 'advance',
    { advance: 'advance', [END]: END });
  return g;
}

/** init:幂等守卫 + round 归零(计划由 start 注入,此处只做重放判定)。 */
function makeInit(_ctx) {
  return async (state) => {
    if (state.plan?.length || state.terminal) return {}; // 重放/重入:不重建
    return {};
  };
}

/** 步的确定性 requestId(崩溃时步通道可能尚未写 requestId,用公式回推对账)。 */
function requestIdOf(taskRunId, step) {
  return step.requestId ?? modelRequestId(taskRunId, step.id ?? step.stepId, step.attempt ?? 0);
}

/** advance:每 superstep 推进一个就绪步(线性计划;取消在步边界生效)。 */
function makeAdvance(ctx) {
  const { ports, transport, sinks, logger, now, cancelledRuns } = ctx;
  return async (state) => {
    logger(`[advance] r${state.round} plan=${JSON.stringify(state.plan)} steps=${JSON.stringify(Object.keys(state.steps))} terminal=${state.terminal?.kind ?? '-'}`);
    if (state.terminal) return {};
    const patch = { round: (state.round ?? 0) + 1 };

    // 取消(步边界;双通道:checkpoint 标志或同进程内存集合):
    // 未发送的剩余步 → cancelled(证明未发送);已有发送意图无回执的步 → unknown(不能谎称未送达)
    if (state.cancelRequested || cancelledRuns.has(state.taskRun.taskRunId)) {
      cancelledRuns.delete(state.taskRun.taskRunId); // 应用即清除(内存通道)
      const steps = { ...state.steps };
      for (const [id, s] of Object.entries(steps)) {
        if (s.state === STEP_STATE.PENDING || s.state === STEP_STATE.BLOCKED) {
          let intentPending = false;
          if (s.kind === 'model') {
            const r = await ports.receipts.get(requestIdOf(state.taskRun.taskRunId, s));
            intentPending = r?.phase === RECEIPT_PHASE.INTENT;
          }
          steps[id] = intentPending
            ? { ...s, state: STEP_STATE.UNKNOWN, error: { code: 'CANCELLED_WITH_PENDING_INTENT', messageZh: '取消时存在发送意图且无回执:结果不可知,禁止自动重发' } }
            : { ...s, state: STEP_STATE.CANCELLED, error: { code: 'CANCELLED_BEFORE_SEND', messageZh: '取消于发送前生效(未发送)' } };
        }
      }
      return {
        ...patch, steps,
        terminal: { kind: RUN_STATE.HUMAN_REQUIRED, reasonZh: '人工取消:未发送调用已取消;发送后不可知者按 unknown 留人工核实', cancelled: true },
      };
    }

    const stepList = Object.values(state.steps);
    const readiness = computeReadiness(stepList, state.deps ?? {});
    const stepId = state.plan.find((id) => readiness[id] === 'ready');
    if (!stepId) return patch; // 无就绪步:aggregate 裁决(全 blocked/全终态)

    const step = state.steps[stepId];
    const updated = { ...step };
    const stepsPatch = { [stepId]: updated };

    if (step.kind === 'tool') {
      // 本地确定性计算:无外部副作用,可安全重跑(不走回执门)
      const toolResult = await ports.tools.calculate({ toolName: step.toolName, inputs: state.toolInputs ?? {} });
      if (toolResult.ok) {
        updated.state = STEP_STATE.SUCCEEDED;
        updated.candidate = toolCandidate(toolResult, stepId);
        updated.toolVersion = toolResult.toolVersion;
        updated.inputHash = toolResult.inputHash;
        updated.toolOutput = toolResult.output;
      } else if (toolResult.code === 'MISSING_INPUT') {
        updated.state = STEP_STATE.WAITING_EVIDENCE;
        updated.error = { code: toolResult.code, messageZh: toolResult.messageZh };
      } else {
        updated.state = STEP_STATE.FAILED;
        updated.error = { code: toolResult.code, messageZh: toolResult.messageZh };
      }
      logger(`[tool] ${state.taskRun.taskRunId}:${stepId} → ${updated.state}`);
    } else {
      // 模型步:回执门(重放复用 / intent-无-terminal → unknown / 新调用)
      const { request, payloadHash } = buildModelRequest({
        runId: state.taskRun.taskRunId, stepId, attempt: step.attempt,
        role: step.role, purpose: step.purpose,
        projectId: state.taskRun.projectId, goalId: state.taskRun.goalId,
        goalLabel: state.taskRun.taskKind,
        factVersion: state.requiredVersions.factVersion,
        evidenceRefs: state.evidenceRefs ?? [],
        generation: state.generation ?? 1,
      });
      updated.requestId = request.requestId;
      const prior = await ports.receipts.get(request.requestId);
      if (prior?.phase === RECEIPT_PHASE.TERMINAL) {
        applyOutcome(updated, prior.outcome);
        logger(`[replay] ${request.requestId} → ${updated.state}(回执复用,零外部调用)`);
      } else if (prior?.phase === RECEIPT_PHASE.INTENT) {
        // 节点重入已查 B 回执;intent 无 terminal = 发送后未知(模型调用有外部副作用)
        updated.state = STEP_STATE.UNKNOWN;
        updated.error = { code: 'RECOVERED_INTENT_WITHOUT_RECEIPT', messageZh: '恢复:发送意图无回执,结果不可知,需人工核实' };
        logger(`[recover] ${request.requestId} → unknown(意图无回执,不自动重发)`);
      } else {
        await ports.receipts.put({
          requestId: request.requestId, runId: state.taskRun.taskRunId, stepId,
          attempt: step.attempt, phase: RECEIPT_PHASE.INTENT, sent: null, status: 'intent',
          payloadHash, at: now(),
        });
        const result = await transport.complete(request);
        const outcome = bridgeTransportResult(result);
        applyOutcome(updated, outcome);
        await ports.receipts.put({
          requestId: request.requestId, runId: state.taskRun.taskRunId, stepId,
          attempt: step.attempt, phase: RECEIPT_PHASE.TERMINAL,
          sent: outcome.sentFlag, status: outcome.state, payloadHash, outcome, at: now(),
        });
        logger(`[step] ${request.requestId} → ${outcome.state}(sent=${outcome.sentFlag},mode=${outcome.sourceMode})`);
      }
    }
    // sink 失败不阻断编排(checkpoint 是本地执行权威);A 同步错误留痕
    for (const sink of sinks) {
      try { await sink.onStepOutcome(publicView(state.taskRun.taskRunId, { ...state, steps: { ...state.steps, ...stepsPatch } }), publicStep(updated)); }
      catch (e) { logger(`[sink-error] ${stepId}: ${e.code ?? ''} ${e.message}`); }
    }
    return { ...patch, steps: stepsPatch };
  };
}

/** aggregate:终局裁决 + 完成前新鲜度核对(陈旧结果丢弃)。 */
function makeAggregate(ctx) {
  const { ports, sinks, logger, now } = ctx;
  return async (state) => {
    const stepList = Object.values(state.steps);
    let verdict = decideRunTerminal(stepList);
    if (!verdict) {
      if ((state.round ?? 0) > MAX_ROUNDS) {
        verdict = { kind: RUN_STATE.FAILED, reasonZh: '编排轮次超限,失败关闭' };
      } else {
        return {}; // 仍在运行
      }
    }
    const terminal = { ...verdict, at: now() };
    if (verdict.kind === RUN_STATE.COMPLETED) {
      // 陈旧结果丢弃:completed 前重读 A 事实版本;已变化 → 全部结果按 stale 处理
      const current = await ports.factVersions.currentVersions(state.taskRun.projectId, state.taskRun.goalId);
      if (String(current.factVersion) !== String(state.requiredVersions.factVersion)) {
        const steps = {};
        for (const [id, s] of Object.entries(state.steps)) {
          if (s.state === STEP_STATE.SUCCEEDED || s.state === STEP_STATE.SIMULATED) {
            steps[id] = { ...s, state: STEP_STATE.STALE, error: { code: 'STALE', messageZh: '结果已取回但事实版本已变化,不得当现行' } };
          }
        }
        return {
          terminal: {
            kind: RUN_STATE.HUMAN_REQUIRED, stale: true, at: now(),
            reasonZh: `事实版本已变化(执行时 ${state.requiredVersions.factVersion},当前 ${current.factVersion}):陈旧结果丢弃,需人工核对`,
          },
          ...(Object.keys(steps).length ? { steps } : {}),
        };
      }
      terminal.candidate = aggregateCandidates(stepList);
    }
    for (const sink of sinks) {
      try { await sink.onTerminal(publicView(state.taskRun.taskRunId, { ...state, terminal })); }
      catch (e) { logger(`[sink-error] terminal: ${e.code ?? ''} ${e.message}`); }
    }
    return { terminal };
  };
}

/** 人工门:interrupt 暂停(checkpoint 落盘);resume 校验失败 → 再 interrupt。
 *  resume 载荷只含包装层盖章净化命令(gateStamp);凭据在边界已消费,不进 checkpoint。 */
function makeHumanGate(ctx) {
  const { ports, now, cancelledRuns } = ctx;
  return async (state) => {
    const command = await interrupt({
      kind: state.terminal.kind,
      reasonZh: state.terminal.reasonZh,
      projectId: state.taskRun.projectId,
      goalId: state.taskRun.goalId,
      requiredVersions: state.requiredVersions,
      steps: Object.values(state.steps).map(publicStep),
      humanActions: state.humanActions,
      lastNotice: state.pauseNotice,
    });
    const trustedPrincipal = command?.gateStamp ?? null; // 无盖章 = 未经边界身份门,失败关闭
    const current = await ports.factVersions.currentVersions(state.taskRun.projectId, state.taskRun.goalId);
    const verdict = validateResumeCommand({
      command, terminalKind: state.terminal?.kind ?? null,
      requiredVersions: state.requiredVersions, currentVersions: current,
      steps: Object.values(state.steps), trustedPrincipal,
    });
    if (!verdict.ok) {
      return { pauseNotice: `resume 被拒绝(${verdict.code}):${verdict.messageZh}` };
    }
    const { action, stepId, payload = {} } = command;
    const effects = computeResumeEffects({ action, stepId, payload, currentVersions: current });
    cancelledRuns.delete(state.taskRun.taskRunId); // 显式人工决定优先于先前取消请求
    const steps = { ...state.steps };
    if (action === HUMAN_ACTION.PROVIDE_EVIDENCE) {
      for (const id of evidenceWaitingStepIds(Object.values(steps))) {
        steps[id] = { ...steps[id], state: STEP_STATE.PENDING, error: null, attempt: steps[id].attempt + 1 };
      }
    }
    for (const [id, delta] of Object.entries(effects.stepsDelta)) {
      steps[id] = { ...steps[id], state: delta.state, error: delta.error ?? null, attempt: steps[id].attempt + (delta.attemptDelta ?? 0) };
    }
    const patch = {
      steps,
      humanActions: [{
        principal: { principalId: trustedPrincipal.principalId, role: trustedPrincipal.role },
        action, stepId: stepId ?? null,
        at: now(), generationBumped: effects.generationBump,
      }],
      pauseNotice: null,
      cancelRequested: false,
    };
    if (effects.evidenceRefs) patch.evidenceRefs = effects.evidenceRefs;
    if (effects.requiredVersions) patch.requiredVersions = effects.requiredVersions;
    if (effects.generationBump) patch.generation = (state.generation ?? 1) + 1;
    if (effects.terminal) patch.terminal = { ...effects.terminal, at: now() };
    else patch.terminal = null; // 继续工作:清除旧终局,由 aggregate 重新裁决
    return patch;
  };
}

// ---------- 辅助 ----------

function applyOutcome(step, outcome) {
  step.state = outcome.state;
  step.candidate = outcome.candidate;
  step.sentFlag = outcome.sentFlag;
  step.error = outcome.error;
  step.sourceMode = outcome.sourceMode;
}

function toolCandidate(toolResult, stepId) {
  return {
    observations: [
      `计算结果 ${JSON.stringify(toolResult.output)}(工具版本 ${toolResult.toolVersion},输入指纹 ${toolResult.inputHash})`,
    ],
    evidenceRefs: [],
    assumptions: [...(toolResult.assumptions ?? [])],
    uncertainty: [],
    recommendedHumanAction: 'none',
    _stepId: stepId,
  };
}

function publicStep(s) {
  return {
    id: s.id, kind: s.kind, role: s.role ?? null, purpose: s.purpose ?? null, toolName: s.toolName ?? null,
    state: s.state, attempt: s.attempt, requestId: s.requestId ?? null, sentFlag: s.sentFlag ?? null,
    sourceMode: s.sourceMode ?? null,
    error: s.error ?? null, hasCandidate: !!s.candidate, candidate: s.candidate ?? null,
    toolVersion: s.toolVersion ?? null, inputHash: s.inputHash ?? null, toolOutput: s.toolOutput ?? null,
  };
}

function errCode(code, messageZh) {
  const e = new Error(messageZh);
  e.code = code;
  return e;
}

function publicView(taskRunId, state) {
  const stepList = Object.values(state.steps ?? {});
  const terminal = state.terminal ?? null;
  return {
    taskRunId,
    taskId: state.taskRun?.taskId ?? null,
    goalId: state.taskRun?.goalId ?? null,
    projectId: state.taskRun?.projectId ?? null,
    ruleId: state.plan?.length ? state.ruleId ?? null : null,
    plan: [...(state.plan ?? [])],
    generation: state.generation ?? 1,
    requiredVersions: { ...(state.requiredVersions ?? {}) },
    evidenceRefs: (state.evidenceRefs ?? []).map((e) => ({ ...e })),
    state: terminal ? terminal.kind : RUN_STATE.RUNNING,
    terminal: terminal ? { ...terminal } : null,
    steps: stepList.map(publicStep),
    candidate: terminal?.kind === RUN_STATE.COMPLETED
      ? (terminal.candidate ?? null)
      : null,
    humanActions: (state.humanActions ?? []).map((h) => ({ principal: h.principal ?? null, action: h.action, stepId: h.stepId ?? null, at: h.at ?? null })),
    pauseNotice: state.pauseNotice ?? null,
    cancelRequested: state.cancelRequested ?? false,
  };
}

// 导出给测试/审计:checkpoint 写入前净化(纵深防御;凭据按构造不进图)
export { sanitizeForCheckpoint };
