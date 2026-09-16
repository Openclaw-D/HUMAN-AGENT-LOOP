// V7-B 候选2:LangGraph JS 编排(与候选1 thin 完成同一用例,保证对比同口径)。
// 图:START→intake→dispatch→[6 个静态步节点+工具节点]→aggregate→(终局? human_gate/END : dispatch)
// 动态激活:静态图 + 每节点按 state.steps 是否选中/就绪自检;依赖门在节点内用同一
// computeReadiness(正式前序不得越过);无依赖的激活节点在同一 superstep 并发。
// 人工门用原生 interrupt()(FileCheckpointSaver 落盘,进程重启可恢复);
// resume 三重校验与 thin 共用 resume-core;回执端口与 thin 共用(副作用幂等权威)。
// 模型意见 authority=none;unknown/失败不自动重试;checkpoint 不替代 A 事实源(sink 同步)。

import { StateGraph, Annotation, END, START, interrupt, Command } from '@langchain/langgraph';
import {
  RUN_STATE, STEP_STATE, HUMAN_ACTION, ERROR_CODES,
} from '../codes.mjs';
import {
  selectSteps, computeReadiness, decideRunTerminal, aggregateCandidates,
} from '../graph-def.mjs';
import { buildModelRequest, bridgeAdapterResult, toolOutcomeToCandidate } from '../adapter-bridge.mjs';
import { validateResumeAccess, validateResumeCommand, computeResumeEffects, evidenceWaitingStepIds } from '../resume-core.mjs';
import { sha256hex } from '../ports.mjs';

const MAX_ROUNDS = 12;

function mergeSteps(a, b) { return { ...(a ?? {}), ...(b ?? {}) }; }
function lastWins(_a, b) { return b; }
function concatLists(a, b) { return [...(a ?? []), ...(b ?? [])]; }

const LgState = Annotation.Root({
  run: Annotation({ reducer: lastWins, default: () => null }), // {runId,projectId,eventType,label,deps,inputHash}
  evidenceRefs: Annotation({ reducer: lastWins, default: () => [] }),
  toolInputs: Annotation({ reducer: lastWins, default: () => null }),
  generation: Annotation({ reducer: lastWins, default: () => 1 }),
  requiredVersions: Annotation({ reducer: lastWins, default: () => null }),
  steps: Annotation({ reducer: mergeSteps, default: () => ({}) }),
  terminal: Annotation({ reducer: lastWins, default: () => null }),
  humanActions: Annotation({ reducer: concatLists, default: () => [] }),
  round: Annotation({ reducer: lastWins, default: () => 0 }),
  pauseNotice: Annotation({ reducer: lastWins, default: () => null }), // interrupt 拒绝后的人工可见原因
});

export function createLangGraphOrchestrator({ ports, adapter, dataDir, checkpointer, sinks = [], principalVerifier, authorizer, logger = () => {} }) {
  if (!ports?.factStore || !ports?.receipts || !ports?.tools) throw new Error('缺少端口:factStore/receipts/tools');
  if (!adapter) throw new Error('缺少模型适配器(V6 契约 v1)');
  if (!checkpointer) throw new Error('LangGraph 候选:必须注入 checkpointer(FileCheckpointSaver,真实落盘)');
  // D-9 可信恢复身份:未注入验证器 = 所有 resume 失败关闭(缺省无身份源);
  // authorizer 可选(业务策略注入点,缺省=已验证 human 放行,不暗设岗位制度)
  const trustedVerifier = principalVerifier ?? null;
  const trustedAuthorizer = authorizer ?? null;
  const ctx = { ports, adapter, sinks, logger, clock: { now: () => new Date().toISOString() } };

  const graph = buildGraph(ctx);
  const app = graph.compile({ checkpointer });

  function threadConfig(runId) {
    return { configurable: { thread_id: runId, checkpoint_ns: '' } };
  }

  return {
    /** 启动运行:幂等(run 状态已在则只推进不重建)。 */
    async start(input) {
      const cfg = threadConfig(input.runId);
      const current = await ports.factStore.currentVersions(input.projectId);
      const result = await app.invoke({
        run: {
          runId: input.runId, projectId: input.projectId, eventType: input.eventType,
          inputHash: sha256hex(JSON.stringify([input.projectId, input.eventType, input.evidenceRefs ?? [], input.toolInputs ?? null])),
          firstInvoke: true, claimedVersions: current,
        },
        evidenceRefs: input.evidenceRefs ?? [],
        toolInputs: input.toolInputs ?? null,
      }, cfg);
      return publicView(input.runId, result);
    },

    /** 崩溃恢复:新进程以同 checkpointer 打开;读最新 checkpoint 投影视图(不自动续跑)。 */
    async recover(runId) {
      const cfg = threadConfig(runId);
      const state = await app.getState(cfg);
      if (!state?.values?.run) return null;
      const view = publicView(runId, state.values);
      // 节点中断于模型调用(intent 已写、回执未写)时:LangGraph 会重跑该节点,
      // 回执端口把 intent-无-receipt 判为 unknown —— 这里的视图先如实投影
      const steps = Object.values(state.values.steps ?? {});
      const intentStep = steps.find((s) => s.state === STEP_STATE.INTENT);
      if (intentStep) {
        view.recoveryNote = `步 ${intentStep.id} 中断于模型调用后:进程重启续跑时将按回执语义判为 unknown(不自动重发)`;
      }
      return view;
    },

    /** 系统续跑(崩溃重启后无 pending interrupt 时):invoke(null) 重跑未完成节点;
     *  回执端口保证已发送工作不重复(intent-无-receipt 判 unknown,不自动重发)。 */
    async continueRun(runId) {
      const cfg = threadConfig(runId);
      const before = await app.getState(cfg);
      if (!before?.values?.run) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${runId} 不存在`);
      if (before.values.terminal || before.next?.length === 0) {
        return { ...publicView(runId, before.values), continued: false };
      }
      const result = await app.invoke(null, cfg);
      return { ...publicView(runId, result), continued: true };
    },

    /**
     * 人工 resume(D-9):身份门在**包装层**先执行(凭据在此消费,绝不进入图 →
     * 绝不落 checkpoint 的 __resume__ 写集);通过后只向图传入净化载荷
     * {gateStamp:{principalId,role}, action, stepId, payload}。
     * 身份/授权拒绝在边界抛错(不产生任何 checkpoint 写入);
     * 图内 human_gate 仅做命令有效性校验(终态/版本/重试目标)。
     */
    async resume(runId, command) {
      const cfg = threadConfig(runId);
      const state = await app.getState(cfg);
      if (!state?.values?.run) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${runId} 不存在`);
      const access = validateResumeAccess({
        principalVerifier: trustedVerifier,
        authorizer: trustedAuthorizer,
        command,
        ctx: {
          runId,
          projectId: state.values.run.projectId,
          action: command?.action,
          stepId: command?.stepId ?? null,
        },
      });
      if (!access.ok) throw errCode(access.code, access.messageZh);
      const sanitized = {
        gateStamp: { principalId: access.principalId, role: access.role }, // 包装层盖章:边界已验证身份
        action: command.action,
        stepId: command.stepId ?? null,
        payload: command.payload ?? {},
      };
      const result = await app.invoke(new Command({ resume: sanitized }), cfg);
      return publicView(runId, result);
    },

    async view(runId) {
      const state = await app.getState(threadConfig(runId));
      return state?.values?.run ? publicView(runId, state.values) : null;
    },
  };
}

// ---------- 图构造 ----------

function buildGraph(ctx) {
  const stepNodeIds = [
    'model:policy:policy_check',
    'model:credit:credit_review',
    'model:credit:risk_review',
    'model:asset:asset_review',
    'model:commerce:pricing_context',
    'tool:calc:cash-flow-coverage',
  ];
  // LangGraph 节点名不允许 ':';注册名净化,stepId 数据保持原样
  const nodeName = (stepId) => `n_${stepId.replace(/:/g, '__')}`;

  const g = new StateGraph(LgState)
    .addNode('intake', makeIntake(ctx))
    .addNode('dispatch', makeDispatch())
    .addNode('aggregate', makeAggregate(ctx));
  for (const stepId of stepNodeIds) {
    g.addNode(nodeName(stepId), makeStepNode(ctx, stepId));
    g.addEdge('dispatch', nodeName(stepId));
    g.addEdge(nodeName(stepId), 'aggregate');
  }
  g.addNode('human_gate', makeHumanGate(ctx));
  g.addEdge(START, 'intake');
  g.addEdge('intake', 'dispatch');
  g.addConditionalEdges('aggregate', (s) => {
    if (!s.terminal) return 'dispatch';
    if (s.terminal.kind === RUN_STATE.COMPLETED) return END;
    return 'human_gate';
  }, { dispatch: 'dispatch', human_gate: 'human_gate', [END]: END });
  g.addConditionalEdges('human_gate', (s) => (s.terminal && (s.terminal.humanAccepted || s.terminal.humanAborted)) ? END : 'dispatch',
    { dispatch: 'dispatch', [END]: END });
  return g;
}

function makeIntake({ ports, logger }) {
  return async (state) => {
    if (state.run && !state.run.firstInvoke) return {}; // 幂等:重放/续跑不重建
    const { runId, projectId, eventType } = state.run;
    const selection = selectSteps(eventType);
    const current = state.run.claimedVersions ?? await ports.factStore.currentVersions(projectId);
    const steps = {};
    for (const s of selection?.steps ?? []) {
      steps[s.id] = { ...s, state: STEP_STATE.PENDING, attempt: 0, error: null, candidate: null, requestId: null };
    }
    logger(`[lg-start] ${runId}: ${eventType}, 步数 ${Object.keys(steps).length}`);
    return {
      run: {
        ...state.run, firstInvoke: false,
        label: selection?.label ?? null, deps: selection?.deps ?? {},
      },
      requiredVersions: { ...current },
      generation: 1,
      steps,
      terminal: selection ? null : { kind: RUN_STATE.HUMAN_REQUIRED, reasonZh: `未知事件类型 ${eventType},需人工定义编排策略` },
    };
  };
}

function makeDispatch() {
  return async (state) => ({ round: (state.round ?? 0) + 1 });
}

/** 步节点工厂:自检激活 + 就绪门 + 回执幂等 + adapter/工具调用 + 桥接。与 thin 同语义。 */
function makeStepNode(ctx, stepId) {
  return async (state) => {
    const { ports, adapter, sinks, logger } = ctx;
    const snap = state;
    const step = state.steps[stepId];
    if (!step || state.terminal) return {};

    const stepList = Object.values(state.steps);
    const readiness = computeReadiness(stepList, snap.run.deps ?? {});
    if (readiness[stepId] === 'blocked') {
      // 正式前序未成功:显式标记 blocked(暂态;依赖恢复后下一轮变 ready)
      if (step.state === STEP_STATE.PENDING) {
        return { steps: { [stepId]: { ...step, state: STEP_STATE.BLOCKED } } };
      }
      return {};
    }
    if (readiness[stepId] !== 'ready') return {};

    const updated = { ...step };
    if (step.kind === 'tool') {
      const toolResult = await ports.tools.calculate({ toolName: step.toolName, inputs: snap.toolInputs });
      if (toolResult.ok) {
        updated.state = STEP_STATE.SUCCEEDED;
        updated.candidate = toolOutcomeToCandidate(toolResult, stepId);
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
      logger(`[lg-tool] ${snap.run.runId}:${stepId} → ${updated.state}`);
    } else {
      const { request, payloadHash } = buildModelRequest({
        runId: snap.run.runId, stepId, attempt: step.attempt,
        role: step.role, purpose: step.purpose, projectId: snap.run.projectId,
        eventType: snap.run.eventType, eventLabel: snap.run.label,
        factVersion: snap.requiredVersions.factVersion,
        evidenceRefs: snap.evidenceRefs ?? [],
        generation: snap.generation ?? 1,
      });
      updated.requestId = request.requestId;

      const prior = await ports.receipts.get(request.requestId);
      if (prior?.phase === 'terminal') {
        applyOutcome(updated, prior.outcome);
        logger(`[lg-replay] ${request.requestId} → ${updated.state}(回执复用,零外部调用)`);
      } else if (prior?.phase === 'intent') {
        updated.state = STEP_STATE.UNKNOWN;
        updated.error = { code: 'RECOVERED_INTENT_WITHOUT_RECEIPT', messageZh: '恢复:发送意图无回执,结果不可知,需人工核实' };
        logger(`[lg-recover] ${request.requestId} → unknown(意图无回执)`);
      } else {
        await ports.receipts.put({ requestId: request.requestId, runId: snap.run.runId, stepId, attempt: step.attempt, phase: 'intent', sent: null, status: 'intent', payloadHash, at: new Date().toISOString() });
        const result = await adapter.analyze(request, {
          snapshot: () => ({
            generation: snap.generation ?? 1,
            contextVersion: snap.requiredVersions.factVersion,
            paused: false,
          }),
        });
        const outcome = bridgeAdapterResult(result);
        applyOutcome(updated, outcome);
        await ports.receipts.put({ requestId: request.requestId, runId: snap.run.runId, stepId, attempt: step.attempt, phase: 'terminal', sent: outcome.sentFlag, status: outcome.state, payloadHash, outcome, at: new Date().toISOString() });
        logger(`[lg-step] ${request.requestId} → ${outcome.state}(sent=${outcome.sentFlag})`);
      }
    }
    const steps = { [stepId]: updated };
    // sink 失败不阻断编排(checkpoint 仍是本地权威);A 同步错误仅留痕
    for (const sink of sinks) {
      try {
        await sink.onStepOutcome(publicView(snap.run.runId, { ...snap, steps: { ...snap.steps, [stepId]: updated } }), publicStep(updated));
      } catch (e) {
        logger(`[lg-sink-error] ${stepId}: ${e.code ?? ''} ${e.message}`);
      }
    }
    return { steps };
  };
}

function makeAggregate(ctx) {
  return async (state) => {
    const stepList = Object.values(state.steps);
    const verdict = decideRunTerminal(stepList);
    if (verdict) {
      const terminal = { ...verdict, at: new Date().toISOString() };
      if (verdict.kind === RUN_STATE.COMPLETED) terminal.candidate = aggregateCandidates(stepList);
      // 有 pending 且无进展的防御:不应发生(就绪门会阻塞),轮次上限兜底
      if (!verdict.kind && state.round > MAX_ROUNDS) {
        return { terminal: { kind: RUN_STATE.FAILED, reasonZh: '编排轮次超限,失败关闭', at: new Date().toISOString() } };
      }
      for (const sink of ctx.sinks) {
        try { await sink.onTerminal(publicView(state.run.runId, { ...state, terminal })); }
        catch (e) { ctx.logger(`[lg-sink-error] terminal: ${e.code ?? ''} ${e.message}`); }
      }
      return { terminal };
    }
    if (state.round > MAX_ROUNDS) {
      return { terminal: { kind: RUN_STATE.FAILED, reasonZh: '编排轮次超限,失败关闭', at: new Date().toISOString() } };
    }
    return {};
  };
}

/** 人工门:interrupt 暂停(经 FileCheckpointSaver 落盘);resume 校验失败 → 再 interrupt。
 *  D-9:resume 载荷只含包装层盖章的净化命令(gateStamp),凭据在边界已消费、不进 checkpoint。 */
function makeHumanGate({ ports }) {
  return async (state) => {
    const command = await interrupt({
      kind: state.terminal.kind,
      reasonZh: state.terminal.reasonZh,
      projectId: state.run.projectId,
      requiredVersions: state.requiredVersions,
      steps: Object.values(state.steps).map(publicStep),
      humanActions: state.humanActions,
      lastNotice: state.pauseNotice,
    });
    const trustedPrincipal = command?.gateStamp ?? null; // 无盖章 = 未经边界身份门,失败关闭
    const current = await ports.factStore.currentVersions(state.run.projectId);
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
        actorName: payload.actorName ?? null,
        at: new Date().toISOString(), generationBumped: effects.generationBump,
      }],
      pauseNotice: null,
    };
    if (effects.evidenceRefs) patch.evidenceRefs = effects.evidenceRefs;
    if (effects.requiredVersions) patch.requiredVersions = effects.requiredVersions;
    if (effects.generationBump) patch.generation = (state.generation ?? 1) + 1;
    if (effects.terminal) patch.terminal = { ...effects.terminal, at: new Date().toISOString() };
    else patch.terminal = null; // 继续工作:清除旧终局,由 aggregate 重新裁决
    return patch;
  };
}

function applyOutcome(step, outcome) {
  step.state = outcome.state;
  step.candidate = outcome.candidate;
  step.sentFlag = outcome.sentFlag;
  step.error = outcome.error;
}

function publicStep(s) {
  return {
    id: s.id, kind: s.kind, role: s.role ?? null, purpose: s.purpose ?? null, toolName: s.toolName ?? null,
    state: s.state, attempt: s.attempt, requestId: s.requestId ?? null, sentFlag: s.sentFlag ?? null,
    error: s.error ?? null, hasCandidate: !!s.candidate, candidate: s.candidate ?? null,
    toolVersion: s.toolVersion ?? null, inputHash: s.inputHash ?? null, toolOutput: s.toolOutput ?? null,
  };
}

function errCode(code, messageZh) {
  const e = new Error(messageZh);
  e.code = code;
  return e;
}

function publicView(runId, state) {
  const stepList = Object.values(state.steps ?? {});
  const terminal = state.terminal ?? null;
  return {
    runId,
    projectId: state.run?.projectId ?? null,
    eventType: state.run?.eventType ?? null,
    generation: state.generation ?? 1,
    requiredVersions: { ...(state.requiredVersions ?? {}) },
    evidenceRefs: (state.evidenceRefs ?? []).map((e) => ({ ...e })),
    state: terminal ? terminal.kind : RUN_STATE.RUNNING,
    terminal: terminal ? { ...terminal } : null,
    steps: stepList.map(publicStep),
    candidate: terminal?.kind === RUN_STATE.COMPLETED
      ? (terminal.candidate ?? aggregateCandidates(stepList))
      : null,
    humanActions: (state.humanActions ?? []).map((h) => ({ principal: h.principal ?? null, action: h.action, stepId: h.stepId ?? null, actorName: h.actorName ?? null, at: h.at ?? null })),
    pauseNotice: state.pauseNotice ?? null,
  };
}
