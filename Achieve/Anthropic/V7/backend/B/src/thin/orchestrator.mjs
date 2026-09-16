// V7-B 候选1:直接薄编排(零框架)。
// checkpoint 真实落盘 = 每运行一个 journal.jsonl(追加事件)+ snapshot.json(原子重写)。
// 崩溃恢复:重放 journal;仅 intent 无回执的模型步判为发送后未知(不自动重发);
// 显式人工 resume 校验身份/授权动作/事实版本;系统可继续的未执行工作不依赖浏览器连接。

import {
  RUN_STATE, STEP_STATE, HUMAN_ACTION, ERROR_CODES,
} from '../codes.mjs';
import {
  selectSteps, computeReadiness, decideRunTerminal, aggregateCandidates,
  stableJson,
} from '../graph-def.mjs';
import { buildModelRequest, bridgeAdapterResult, toolOutcomeToCandidate } from '../adapter-bridge.mjs';
import { validateResumeAccess, validateResumeCommand, computeResumeEffects, evidenceWaitingStepIds } from '../resume-core.mjs';
import { atomicWriteJson } from '../ports.mjs';
import { fs } from '../deps.mjs';

export function createThinOrchestrator(opts) {
  return new ThinOrchestrator(opts);
}

class ThinOrchestrator {
  constructor({ ports, adapter, dataDir, sinks = [], principalVerifier, authorizer, clock = { now: () => new Date().toISOString() }, logger = () => {} }) {
    if (!ports?.factStore || !ports?.receipts || !ports?.tools) throw new Error('缺少端口:factStore/receipts/tools');
    if (!adapter) throw new Error('缺少模型适配器(V6 契约 v1)');
    this.ports = ports;
    this.adapter = adapter;
    this.dataDir = dataDir;
    this.sinks = sinks;
    // D-9 可信恢复身份:未注入验证器 = 所有 resume 失败关闭(缺省无身份源);
    // authorizer 可选(业务策略注入点,缺省=已验证 human 放行,不暗设岗位制度)
    this.principalVerifier = principalVerifier ?? null;
    this.authorizer = authorizer ?? null;
    this.clock = clock;
    this.logger = logger;
    this.runsDir = `${dataDir}/runs`;
    this.inflight = new Map();
  }

  // ---------- journal 基元 ----------

  #runDir(runId) { return `${this.runsDir}/${encodeURIComponent(runId)}`; }

  async #appendEvent(runId, event) {
    const dir = this.#runDir(runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(`${dir}/journal.jsonl`, `${JSON.stringify({ ...event, at: this.clock.now() })}\n`, 'utf8');
  }

  /** 重放 journal 折叠为运行视图;尾部撕裂行丢弃并记录,中部损坏硬错误(不静默重置)。 */
  async #replay(runId) {
    let raw;
    try {
      raw = await fs.readFile(`${this.#runDir(runId)}/journal.jsonl`, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const tornTail = [];
    while (lines.length > 0) {
      try { JSON.parse(lines[lines.length - 1]); break; } catch { tornTail.unshift(lines.pop()); }
    }
    if (lines.length === 0) throw new Error(`JOURNAL_CORRUPT: ${runId} 无可解析事件,失败关闭`);
    const snap = foldJournal(runId, lines.map((l, i) => { try { return JSON.parse(l); } catch (e) { throw new Error(`JOURNAL_CORRUPT: ${runId} 第 ${i + 1} 行无法解析`); } }));
    if (tornTail.length > 0) {
      snap.events.push({ type: 'RECOVERY_TRUNCATED_TAIL', count: tornTail.length, at: this.clock.now() });
      this.logger(`[recover] ${runId}: 丢弃撕裂尾行 ${tornTail.length} 条`);
    }
    return snap;
  }

  async #saveSnapshot(runId, snap) {
    await atomicWriteJson(`${this.#runDir(runId)}/snapshot.json`, snap);
  }

  async #load(runId) {
    return this.#replay(runId);
  }

  async #view(runId) {
    const snap = await this.#load(runId);
    return snap ? publicView(snap) : null;
  }

  // ---------- 执行 ----------

  async start(input) {
    const inputHash = stableJson({
      projectId: input.projectId, eventType: input.eventType,
      evidenceRefs: input.evidenceRefs ?? [], toolInputs: input.toolInputs ?? null,
    });
    const existing = await this.#load(input.runId);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        const err = new Error(`REQUEST_MISMATCH: runId ${input.runId} 已存在但输入不同`);
        err.code = 'REQUEST_MISMATCH';
        throw err;
      }
      return { ...publicView(existing), deduped: true };
    }
    // 事实版本以事实源端口读数为准(单一真相),不信任调用方声称值;缺记录失败关闭
    const current = await this.ports.factStore.currentVersions(input.projectId);
    const selection = selectSteps(input.eventType);
    const snap = {
      runId: input.runId, projectId: input.projectId, eventType: input.eventType,
      inputHash,
      label: selection?.label ?? null,
      generation: 1,
      evidenceRefs: input.evidenceRefs ?? [],
      toolInputs: input.toolInputs ?? null,
      requiredVersions: { ...current },
      steps: (selection?.steps ?? []).map((s) => ({ ...s, state: STEP_STATE.PENDING, attempt: 0, error: null, candidate: null, requestId: null })),
      deps: selection?.deps ?? {},
      terminal: selection ? null : { kind: RUN_STATE.HUMAN_REQUIRED, reasonZh: `未知事件类型 ${input.eventType},需人工定义编排策略` },
      humanActions: [],
      events: [],
    };
    await this.#appendEvent(input.runId, { type: 'RUN_INTENT', projectId: input.projectId, eventType: input.eventType, inputHash, requiredVersions: snap.requiredVersions, evidenceRefs: snap.evidenceRefs, toolInputs: snap.toolInputs, label: snap.label, deps: snap.deps, steps: selection?.steps ?? [] });
    await this.#saveSnapshot(input.runId, snap);
    this.logger(`[start] ${input.runId}: ${input.eventType}, 步数 ${snap.steps.length}`);
    if (snap.terminal) { await this.#appendEvent(input.runId, { type: 'TERMINAL', ...snap.terminal }); await this.#saveSnapshot(input.runId, snap); }
    else await this.#drive(input.runId, snap);
    return { ...publicView(await this.#load(input.runId)), deduped: false };
  }

  async #drive(runId, snap) {
    let progressed = true;
    while (!snap.terminal && progressed) {
      progressed = false;
      const readiness = computeReadiness(snap.steps, snap.deps);
      for (const s of snap.steps) {
        if (readiness[s.id] === 'blocked' && s.state === STEP_STATE.PENDING) {
          s.state = STEP_STATE.BLOCKED; // 正式前序未成功:显式标记,不越过
          await this.#appendEvent(runId, { type: 'STEP_BLOCKED', stepId: s.id });
        }
      }
      const readyIds = snap.steps.filter((s) => readiness[s.id] === 'ready').map((s) => s.id);
      if (readyIds.length > 0) {
        progressed = true;
        // 依赖允许的步并发执行
        await Promise.all(readyIds.map((id) => this.#executeStep(runId, snap, id)));
      }
      const verdict = decideRunTerminal(snap.steps);
      if (verdict) {
        snap.terminal = { ...verdict, at: this.clock.now() };
        await this.#appendEvent(runId, { type: 'TERMINAL', ...verdict });
        await this.#runTerminalSinks(runId, snap);
      }
    }
    await this.#saveSnapshot(runId, snap);
  }

  async #executeStep(runId, snap, stepId) {
    const step = snap.steps.find((s) => s.id === stepId);
    if (step.kind === 'tool') return this.#executeToolStep(runId, snap, step);
    return this.#executeModelStep(runId, snap, step);
  }

  async #executeModelStep(runId, snap, step) {
    const { request, payloadHash } = buildModelRequest({
      runId: snap.runId, stepId: step.id, attempt: step.attempt,
      role: step.role, purpose: step.purpose, projectId: snap.projectId,
      eventType: snap.eventType, eventLabel: snap.label,
      factVersion: snap.requiredVersions.factVersion,
      evidenceRefs: snap.evidenceRefs,
      generation: snap.generation,
    });

    step.requestId = request.requestId;

    const prior = await this.ports.receipts.get(request.requestId);
    if (prior?.phase === 'terminal') {
      // 幂等重放:已有终态回执 → 不再发起外部调用,直接复用结果
      applyOutcome(snap, step, prior.outcome);
      await this.#appendEvent(runId, { type: 'STEP_REPLAYED', stepId: step.id, requestId: request.requestId, state: step.state });
      this.logger(`[replay] ${request.requestId} → ${step.state}(回执复用,零外部调用)`);
      return;
    }
    if (prior?.phase === 'intent') {
      // 意图无终态回执:此前进程可能已在发送后中断 → 发送状态不可判定,判 unknown,不自动重发
      step.state = STEP_STATE.UNKNOWN;
      step.error = { code: 'RECOVERED_INTENT_WITHOUT_RECEIPT', messageZh: '恢复时发现已记录发送意图但无回执:外部调用可能已发生,结果不可知,需人工核实' };
      await this.#appendEvent(runId, { type: 'STEP_MARKED_UNKNOWN', stepId: step.id, requestId: request.requestId });
      this.logger(`[recover] ${request.requestId} → unknown(意图无回执)`);
      return;
    }

    await this.#appendEvent(runId, { type: 'STEP_INTENT', stepId: step.id, requestId: request.requestId, attempt: step.attempt, payloadHash });
    await this.ports.receipts.put({ requestId: request.requestId, runId: snap.runId, stepId: step.id, attempt: step.attempt, phase: 'intent', sent: null, status: 'intent', payloadHash, at: this.clock.now() });

    const result = await this.adapter.analyze(request, {
      snapshot: () => ({
        generation: snap.generation,
        contextVersion: snap.requiredVersions.factVersion,
        paused: false,
      }),
    });
    const outcome = bridgeAdapterResult(result);
    applyOutcome(snap, step, outcome);
    await this.ports.receipts.put({
      requestId: request.requestId, runId: snap.runId, stepId: step.id, attempt: step.attempt,
      phase: 'terminal', sent: outcome.sentFlag, status: outcome.state, payloadHash,
      outcome, at: this.clock.now(),
    });
    await this.#appendEvent(runId, { type: 'STEP_RECEIPT', stepId: step.id, requestId: request.requestId, attempt: step.attempt, state: outcome.state, sentFlag: outcome.sentFlag, outcome });
    this.logger(`[step] ${request.requestId} → ${outcome.state}(sent=${outcome.sentFlag})`);
    await this.#runSinks(runId, snap, step);
  }

  async #executeToolStep(runId, snap, step) {
    const toolResult = await this.ports.tools.calculate({ toolName: step.toolName, inputs: snap.toolInputs });
    if (toolResult.ok) {
      step.state = STEP_STATE.SUCCEEDED;
      step.candidate = toolOutcomeToCandidate(toolResult, step.id);
      step.toolVersion = toolResult.toolVersion;
      step.inputHash = toolResult.inputHash;
      step.toolOutput = toolResult.output;
    } else if (toolResult.code === 'MISSING_INPUT') {
      step.state = STEP_STATE.WAITING_EVIDENCE;
      step.error = { code: toolResult.code, messageZh: toolResult.messageZh };
    } else {
      step.state = STEP_STATE.FAILED;
      step.error = { code: toolResult.code, messageZh: toolResult.messageZh };
    }
    await this.#appendEvent(runId, { type: 'STEP_RECEIPT', stepId: step.id, state: step.state, tool: true, outcome: { candidate: step.candidate, error: step.error, sentFlag: null }, toolVersion: step.toolVersion, inputHash: step.inputHash, toolOutput: step.toolOutput });
    this.logger(`[tool] ${snap.runId}:${step.id} → ${step.state}`);
    await this.#runSinks(runId, snap, step);
  }

  /** sink 调用(A 事实源同步):失败不回滚编排(journal 权威),留 SINK_ERROR 事件,可人工重放。 */
  async #runSinks(runId, snap, step) {
    for (const sink of this.sinks) {
      try {
        await sink.onStepOutcome(publicView(snap), publicStep(snap, step));
      } catch (e) {
        this.logger(`[sink-error] ${runId}:${step.id}: ${e.code ?? ''} ${e.message}`);
        await this.#appendEvent(runId, { type: 'SINK_ERROR', stepId: step.id, code: e.code ?? 'UNKNOWN', message: String(e.message) });
      }
    }
  }

  async #runTerminalSinks(runId, snap) {
    for (const sink of this.sinks) {
      try {
        await sink.onTerminal(publicView(snap));
      } catch (e) {
        this.logger(`[sink-error] ${runId} terminal: ${e.code ?? ''} ${e.message}`);
        await this.#appendEvent(runId, { type: 'SINK_ERROR', stepId: null, code: e.code ?? 'UNKNOWN', message: String(e.message) });
      }
    }
  }

  // ---------- 恢复与继续 ----------

  /** 崩溃恢复:重放(fold 时 intent 无回执步已判 unknown)+ 终态裁决 + 从回执存储补水候选。 */
  async recover(runId) {
    const snap = await this.#load(runId);
    if (!snap) return null;
    // snapshot.json 可能已丢失:从回执存储(receipts)补回各步 candidate/error,保持视图完整
    for (const step of snap.steps) {
      if (step.requestId && !step.candidate && step.state !== STEP_STATE.UNKNOWN) {
        const receipt = await this.ports.receipts.get(step.requestId);
        if (receipt?.phase === 'terminal' && receipt.outcome) {
          step.candidate = receipt.outcome.candidate ?? null;
          step.sentFlag = receipt.outcome.sentFlag ?? null;
          step.error = receipt.outcome.error ?? null;
        }
      }
    }
    if (!snap.terminal) {
      const verdict = decideRunTerminal(snap.steps);
      if (verdict) {
        snap.terminal = { ...verdict, at: this.clock.now() };
        await this.#appendEvent(runId, { type: 'TERMINAL', ...verdict });
        await this.#saveSnapshot(runId, snap);
      }
    }
    const view = publicView(snap);
    view.systemContinuable = view.terminal === null && snap.steps.some((s) => s.state === STEP_STATE.PENDING || s.state === STEP_STATE.BLOCKED);
    return view;
  }

  /** 系统续跑:仅当无 unknown 步且运行未终局;不需要人工身份(不涉及已发送工作)。 */
  async continueRun(runId) {
    const snap = await this.#load(runId);
    if (!snap) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${runId} 不存在`);
    if (snap.terminal) return { ...publicView(snap), continued: false };
    if (snap.steps.some((s) => s.state === STEP_STATE.UNKNOWN)) {
      throw errCode(ERROR_CODES.RUN_NOT_RESUMABLE, '存在发送后未知步骤,续跑必须经显式人工核实');
    }
    await this.#drive(runId, snap);
    return { ...publicView(await this.#load(runId)), continued: true };
  }

  // ---------- 人工 resume(D-9 可信身份门 + 命令校验;两候选共用 resume-core,失败关闭) ----------

  async resume(runId, command) {
    const snap = await this.#load(runId);
    if (!snap) throw errCode(ERROR_CODES.RUN_NOT_FOUND, `运行 ${runId} 不存在`);
    const { action, stepId, payload = {} } = command ?? {};

    // D-9 身份门(边界,先于任何状态变更):身份只来自注入验证器;command.actor 不构成授权;
    // 凭据只在本次调用内使用,不落 journal/snapshot(入档的是 verdict.principalId)
    const access = validateResumeAccess({
      principalVerifier: this.principalVerifier,
      authorizer: this.authorizer,
      command,
      ctx: { runId, projectId: snap.projectId, action, stepId: stepId ?? null },
    });
    if (!access.ok) throw errCode(access.code, access.messageZh);
    const trustedPrincipal = { principalId: access.principalId, role: access.role };

    const current = await this.ports.factStore.currentVersions(snap.projectId);
    const verdict = validateResumeCommand({
      command, terminalKind: snap.terminal?.kind ?? null,
      requiredVersions: snap.requiredVersions, currentVersions: current,
      steps: snap.steps, trustedPrincipal,
    });
    if (!verdict.ok) throw errCode(verdict.code, verdict.messageZh);

    const effects = computeResumeEffects({ action, stepId, payload, currentVersions: current });
    if (effects.evidenceRefs) snap.evidenceRefs = effects.evidenceRefs;
    if (effects.requiredVersions) snap.requiredVersions = effects.requiredVersions;
    if (effects.generationBump) snap.generation += 1;
    if (action === HUMAN_ACTION.PROVIDE_EVIDENCE) {
      for (const id of evidenceWaitingStepIds(snap.steps)) {
        const step = snap.steps.find((s) => s.id === id);
        step.state = STEP_STATE.PENDING;
        step.error = null;
        step.attempt += 1;
      }
    }
    for (const [id, delta] of Object.entries(effects.stepsDelta)) {
      const step = snap.steps.find((s) => s.id === id);
      step.state = delta.state;
      step.error = delta.error ?? null;
      if (delta.attemptDelta) step.attempt += delta.attemptDelta;
    }
    if (effects.terminal) snap.terminal = { ...effects.terminal, at: this.clock.now() };
    else if (action === HUMAN_ACTION.PROVIDE_EVIDENCE || action === HUMAN_ACTION.RETRY_STEP) snap.terminal = null; // 清除旧终局,继续工作后由 drive 重新裁决

    snap.humanActions.push({
      principal: { principalId: trustedPrincipal.principalId, role: trustedPrincipal.role },
      action, stepId: stepId ?? null,
      actorName: payload.actorName ?? null, // 展示名(自声明,非授权依据;可为空)
      note: payload.note ?? null,
      newFactVersion: payload.newFactVersion ?? null,
      newEvidenceRefCount: Array.isArray(payload.newEvidenceRefs) ? payload.newEvidenceRefs.length : null,
      at: this.clock.now(), generationBumped: effects.generationBump,
    });
    // journal 只记 principalId 与动作要素,绝不记 principalCredential
    await this.#appendEvent(runId, { type: 'HUMAN_ACTION', principalId: trustedPrincipal.principalId, principalRole: trustedPrincipal.role, action, stepId: stepId ?? null, generationBumped: effects.generationBump });
    await this.#saveSnapshot(runId, snap);

    if (action === HUMAN_ACTION.PROVIDE_EVIDENCE || action === HUMAN_ACTION.RETRY_STEP) {
      await this.#drive(runId, snap);
    }
    return publicView(await this.#load(runId));
  }

  async view(runId) { return this.#view(runId); }
}

// ---------- 纯函数:journal 折叠与视图 ----------

function foldJournal(runId, events) {
  const snap = {
    runId, projectId: null, eventType: null, inputHash: null, label: null,
    generation: 1, evidenceRefs: [], toolInputs: null,
    requiredVersions: { factVersion: null, ruleVersion: null },
    steps: [], deps: {}, terminal: null, humanActions: [], events: [],
  };
  const stepIndex = new Map();
  for (const e of events) {
    snap.events.push(e);
    switch (e.type) {
      case 'RUN_INTENT':
        snap.projectId = e.projectId; snap.eventType = e.eventType; snap.inputHash = e.inputHash;
        snap.requiredVersions = { ...e.requiredVersions };
        snap.evidenceRefs = e.evidenceRefs ?? [];
        snap.toolInputs = e.toolInputs ?? null;
        snap.label = e.label ?? null;
        snap.deps = e.deps ?? {};
        {
          const selection = selectSteps(e.eventType);
          if (selection) {
            snap.steps = (e.steps?.length ? e.steps : selection.steps).map((s) => ({ ...s, state: STEP_STATE.PENDING, attempt: 0, error: null, candidate: null, requestId: null }));
            snap.steps.forEach((s) => stepIndex.set(s.id, s));
          }
        }
        break;
      case 'STEP_INTENT': {
        const step = stepIndex.get(e.stepId);
        if (step) { step.state = STEP_STATE.INTENT; step.requestId = e.requestId; step.attempt = e.attempt; }
        break;
      }
      case 'STEP_RECEIPT': {
        const step = stepIndex.get(e.stepId);
        if (step) {
          step.state = e.state;
          if (e.attempt !== undefined) step.attempt = e.attempt;
          if (e.sentFlag !== undefined) step.sentFlag = e.sentFlag;
          if (e.outcome) {
            step.candidate = e.outcome.candidate ?? null;
            step.error = e.outcome.error ?? null;
          }
          if (e.toolVersion) step.toolVersion = e.toolVersion;
          if (e.inputHash) step.inputHash = e.inputHash;
          if (e.toolOutput) step.toolOutput = e.toolOutput;
        }
        break;
      }
      case 'STEP_BLOCKED': {
        const step = stepIndex.get(e.stepId);
        if (step && step.state === STEP_STATE.PENDING) step.state = STEP_STATE.BLOCKED;
        break;
      }
      case 'STEP_MARKED_UNKNOWN': {
        const step = stepIndex.get(e.stepId);
        if (step) {
          step.state = STEP_STATE.UNKNOWN;
          step.error = { code: 'RECOVERED_INTENT_WITHOUT_RECEIPT', messageZh: '恢复时发现发送意图无回执:结果不可知,需人工核实' };
        }
        break;
      }
      case 'STEP_REPLAYED': {
        const step = stepIndex.get(e.stepId);
        if (step) step.state = e.state;
        break;
      }
      case 'HUMAN_ACTION':
        if (e.generationBumped) snap.generation += 1;
        snap.humanActions.push({
          principal: { principalId: e.principalId, role: e.principalRole },
          action: e.action, stepId: e.stepId ?? null, at: e.at,
        });
        break;
      case 'TERMINAL':
        snap.terminal = { kind: e.kind, reasonZh: e.reasonZh, at: e.at };
        break;
      default:
        break; // RECOVERY_TRUNCATED_TAIL 等仅留痕
    }
  }
  // intent 无 receipt 的步:fold 时状态已是 INTENT → 恢复语义判 unknown
  for (const step of snap.steps) {
    if (step.state === STEP_STATE.INTENT) {
      step.state = STEP_STATE.UNKNOWN;
      step.error = { code: 'RECOVERED_INTENT_WITHOUT_RECEIPT', messageZh: '恢复:发送意图无回执,结果不可知,需人工核实' };
    }
  }
  return snap;
}

function applyOutcome(snap, step, outcome) {
  step.state = outcome.state;
  step.candidate = outcome.candidate;
  step.sentFlag = outcome.sentFlag;
  step.error = outcome.error;
}

function publicView(snap) {
  return {
    runId: snap.runId,
    projectId: snap.projectId,
    eventType: snap.eventType,
    generation: snap.generation,
    requiredVersions: { ...snap.requiredVersions },
    evidenceRefs: (snap.evidenceRefs ?? []).map((e) => ({ ...e })),
    state: snap.terminal ? snap.terminal.kind : RUN_STATE.RUNNING,
    terminal: snap.terminal ? { ...snap.terminal } : null,
    steps: snap.steps.map((s) => publicStep(snap, s)),
    candidate: snap.terminal?.kind === RUN_STATE.COMPLETED ? aggregateCandidates(snap.steps) : null,
    humanActions: snap.humanActions.map((h) => ({ principal: h.principal ?? null, action: h.action, stepId: h.stepId ?? null, actorName: h.actorName ?? null, at: h.at ?? null })),
  };
}

/** 完整步视图(供 sink/集成;含 candidate 与工具输出)。 */
function publicStep(snap, s) {
  return {
    id: s.id, kind: s.kind, role: s.role ?? null, purpose: s.purpose ?? null, toolName: s.toolName ?? null,
    state: s.state, attempt: s.attempt, requestId: s.requestId ?? null,
    sentFlag: s.sentFlag ?? null,
    error: s.error ?? null,
    hasCandidate: !!s.candidate,
    candidate: s.candidate ?? null,
    toolVersion: s.toolVersion ?? null,
    inputHash: s.inputHash ?? null,
    toolOutput: s.toolOutput ?? null,
  };
}

function errCode(code, messageZh) {
  const e = new Error(messageZh);
  e.code = code;
  return e;
}
