// 可替换模型适配器 · 主入口(接口 v1)。
//
// 设计边界:
// - 公开接口 analyze(request, context);provider 一律通过注入的 transport 提供,
//   单一外部 provider 实例服务所有角色——role 只是请求字段,适配器不按角色拆分端点,
//   也没有任何"逐事件轮转六角色"的内置逻辑(六角色职责仅通过 roles 配置表约束)。
// - 七状态显式区分:见 src/codes.mjs STATUS。
// - 取消语义:无法证明"请求未送达外部"时一律 unknown,绝不声称取消等于未计费;
//   unknown 不做任何自动重试(重试是业务层的显式人工/持久化决策)。
// - 持久化幂等与跨进程恰好一次不在本模块保证范围:本模块只做实例内存内去重,
//   持久请求记录由主业务层负责。
// - R2 缓存有效性(修复 Codex 点名"已完成缓存返回不复核当前上下文"):缓存命中与在飞
//   join 在返回前必须重新核对当前会话快照;快照已变化 → 以 stale 呈现(保留数据供人工
//   核对),绝不让旧结果冒充现行(MUTATION-ANCHOR:CACHE-REVALIDATE)。
// - R2 容量背压:请求登记满且无可安全释放的在途 → 显式 failed/REGISTRY_AT_CAPACITY,
//   不淘汰在途、不静默、不挂起;maxEntries 可配置(缺省 512)。
// - R2 人控边界(Goal 工作包3·生命周期交错):context.gate.professionalReviewPassed=false
//   → 成功类结果附加 scope='preprocessing_only',业务层据此把结果挡在正式判定通道外;
//   适配器不改变七状态语义与执行本身。
import { validateAnalyzeRequest, DEFAULT_ROLES } from '../../../src/validate-request.mjs';
import { validateProviderOutput } from '../../../src/validate-response.mjs';
import { createMemoryLedger } from '../../../src/ledger.mjs';
import { RequestRegistry, payloadHash, cloneResult } from './dedupe.mutant-C.mjs';
import { systemClock } from '../../../src/clock.mjs';
import { CONTRACT_VERSION, STATUS, ERROR_CODES, RESERVATION_STATE } from '../../../src/codes.mjs';

const SIMULATION_NOTICE = '本结果由受控模拟生成(SIMULATED),不来自真实模型,不构成任何审批意见或业务决定。';

// 人控边界(Goal 工作包3):专业前序复核未通过时的结果范围标记(英文协议标识 + 中文提示)。
const SCOPE_PREPROCESSING_ONLY = 'preprocessing_only';
const SCOPE_NOTICE_PREPROCESSING_ONLY = '专业前序复核未通过:本结果仅可用于预处理,不得作为正式判定依据';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

/** 从 provider 报告的 usage 中取计费 token 数;缺失返回 null(绝不折算为 0)。 */
function usageTokensOf(usage) {
  if (!isPlainObject(usage)) return null;
  if (Number.isInteger(usage.totalTokens) && usage.totalTokens >= 0) return usage.totalTokens;
  if (Number.isInteger(usage.promptTokens) && Number.isInteger(usage.completionTokens)) {
    return usage.promptTokens + usage.completionTokens;
  }
  return null;
}

function normalizeUsage(usage) {
  if (!isPlainObject(usage)) return null;
  return {
    promptTokens: Number.isInteger(usage.promptTokens) ? usage.promptTokens : null,
    completionTokens: Number.isInteger(usage.completionTokens) ? usage.completionTokens : null,
    totalTokens: Number.isInteger(usage.totalTokens) ? usage.totalTokens : null,
    providerReported: true,
  };
}

/**
 * 竞速:transport 完成 / 注入时钟超时 / 外部取消,谁先到算谁。
 * 未触发的计时器与监听器必须清理,transport 的迟到结果不再采信。
 */
function raceCall({ promise, timeoutMs, clock, signal }) {
  return new Promise((resolve) => {
    let settled = false;
    let timerId = null;
    let abortHandler = null;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (timerId !== null) clock.clearTimeout(timerId);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      resolve(v);
    };
    if (signal) {
      if (signal.aborted) {
        finish({ kind: 'abort' });
        return;
      }
      abortHandler = () => finish({ kind: 'abort' });
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    if (timeoutMs > 0) {
      timerId = clock.setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    }
    promise.then(
      (value) => finish({ kind: 'resolved', value }),
      (error) => finish({ kind: 'rejected', error }),
    );
  });
}

export function createModelAdapter(deps = {}) {
  const {
    transport = null,
    mode = transport ? 'custom' : 'none',
    clock = systemClock,
    ledger: ledgerDep = null,
    roles = DEFAULT_ROLES,
    timeoutMs = 30000,
    estimateTokens = 1000,
    maxEntries = 512, // 请求登记容量上限;满且无可安全释放的在途时明确背压(见 REGISTRY_AT_CAPACITY)
    forbiddenPatterns, // 可选:收严/替换越权批准词表
  } = deps;

  const ledger = ledgerDep || createMemoryLedger({});
  const registry = new RequestRegistry({ maxEntries });
  const sessionStates = new Map(); // sessionId -> { generation, contextVersion, paused, note }

  function getSessionSnapshot(sessionId, context) {
    if (context && typeof context.snapshot === 'function') return context.snapshot();
    return sessionStates.get(sessionId) || null;
  }

  /** 人控边界(Goal 工作包3):读取 context.gate;缺省视为专业前序复核已通过(不改变现有行为)。 */
  function professionalReviewDenied(context) {
    return Boolean(context && isPlainObject(context.gate) && context.gate.professionalReviewPassed === false);
  }

  function baseResult(request, warnings, startedAt) {
    return {
      contractVersion: CONTRACT_VERSION,
      requestId: isPlainObject(request) ? request.requestId ?? null : null,
      projectId: isPlainObject(request) ? request.projectId ?? null : null,
      sessionId: isPlainObject(request) ? request.sessionId ?? null : null,
      generation: isPlainObject(request) ? request.generation ?? null : null,
      contextVersion: isPlainObject(request) ? request.contextVersion ?? null : null,
      role: isPlainObject(request) ? request.role ?? null : null,
      purpose: isPlainObject(request) ? request.purpose ?? null : null,
      mode,
      status: null,
      deduped: false,
      warnings,
      findings: [],
      questions: [],
      evidenceRefs: [],
      error: null,
      usage: null,
      usageUnknown: false,
      costLedger: { reservationState: 'none' },
      simulation: null,
      scope: null,       // 人控边界:成功类结果在 gate 未通过时为 'preprocessing_only',其余为 null
      scopeNotice: null, // 与 scope 配套的中文提示
      timings: { startedAt, finishedAt: clock.now() },
    };
  }

  function quickResult(request, warnings, startedAt, patch) {
    return deepFreeze(Object.assign(baseResult(request, warnings, startedAt), patch));
  }

  function buildPayload(request, roleConf, { preprocessingOnly = false } = {}) {
    return {
      protocol: `jianwei.dd.analyze/${CONTRACT_VERSION}`,
      requestId: request.requestId,
      projectId: request.projectId,
      sessionId: request.sessionId,
      generation: request.generation,
      contextVersion: request.contextVersion,
      role: request.role,
      roleLabel: roleConf.label,
      purpose: request.purpose,
      text: request.text,
      evidenceRefs: request.evidenceRefs.map((r) => ({ ...r })),
      instructions: {
        authority: 'none',
        outputLanguage: 'zh-CN',
        onlyUseListedEvidence: true,
        requireEvidenceRefs: true,
        forbidApprovalOutput: true,
        // 人控边界:专业前序复核未通过 → 提示词层面声明"仅预处理"(载荷指纹随之变化,
        // 同ID不同 gate 状态按变载荷拒绝,防止预处理结果与正式结果混用同一请求身份)。
        ...(preprocessingOnly ? { preprocessingOnly: true } : {}),
      },
    };
  }

  /** 外部调用已发生后的成本结算:usage 可用则 commit,缺失则保留为 unknown_hold。 */
  function settleCost(reservationId, usage, note) {
    const tokens = usageTokensOf(usage);
    if (tokens !== null) {
      ledger.commit({ reservationId, usageTokens: tokens, note });
      return { reservationState: RESERVATION_STATE.COMMITTED };
    }
    ledger.holdUnknown({ reservationId, note: note || 'USAGE_MISSING' });
    return { reservationState: RESERVATION_STATE.UNKNOWN_HOLD };
  }

  /** 返回结果时的会话状态核对:generation/contextVersion 变化或会话暂停 → stale。 */
  function stalenessOf(request, context) {
    const snap = getSessionSnapshot(request.sessionId, context);
    if (!snap) return null;
    if (snap.generation !== undefined && snap.generation !== request.generation) {
      return { code: 'GENERATION_CHANGED', message: '会话已推进到新的 generation,该在途结果已过期(stale),不得作为现行结论' };
    }
    if (snap.contextVersion !== undefined && snap.contextVersion !== request.contextVersion) {
      return { code: 'CONTEXT_VERSION_CHANGED', message: '上下文版本已变化,该在途结果已过期(stale),不得作为现行结论' };
    }
    if (snap.paused) {
      return { code: 'SESSION_PAUSED', message: '会话处于暂停状态,该在途结果不得越过暂停代次作为现行结论' };
    }
    return null;
  }

  /**
   * 缓存/在飞共享结果返回前的复核(R2 修复 Codex 点名:已完成缓存返回不复核当前上下文):
   * 以当前快照重新执行 staleness 判定。快照已变化 → 保留缓存数据(findings/questions/
   * evidenceRefs)供人工核对,但以 stale + 对应 error.code 呈现,deduped:true,绝不让
   * 旧结果以 succeeded/simulated 冒充现行;快照未变化 → 现行为不变(deduped 命中)。
   */
  function revalidateCached(cached, request, context) {
    // MUTATION-ANCHOR:CACHE-REVALIDATE
    const stale = stalenessOf(request, context);
    if (!stale) return Object.freeze({ ...cloneResult(cached), deduped: true });
    return Object.freeze({
      ...cloneResult(cached),
      status: STATUS.STALE,
      error: { code: stale.code, message: stale.message },
      deduped: true,
    });
  }

  async function executeRequest(request, roleConf, context, warnings, startedAt) {
    let result = baseResult(request, warnings, startedAt);

    // 1) 发起前检查:暂停 → 拒绝(未送出,不预留)。
    const entrySnap = getSessionSnapshot(request.sessionId, context);
    if (entrySnap && entrySnap.paused) {
      result.error = { code: ERROR_CODES.SESSION_PAUSED, message: '会话处于暂停状态,已拒绝发起新的模型调用;恢复须由业务层显式人工动作' };
      result.status = STATUS.CANCELLED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    // 2) 发起前检查:调用方 signal 已取消 → 取消(未送出,不预留)。
    if (context.signal && context.signal.aborted) {
      result.error = { code: ERROR_CODES.CANCELLED_BEFORE_SEND, message: '请求在送出前已被取消,未发生任何外部调用' };
      result.status = STATUS.CANCELLED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    // 3) 预算预留;不足则拒绝(未送出)。
    const reserveResult = ledger.reserve({
      requestId: request.requestId, role: request.role, purpose: request.purpose, estimateTokens,
    });
    if (!reserveResult.ok) {
      result.error = { code: ERROR_CODES.BUDGET_EXCEEDED, message: '成本预算不足,已拒绝发起新的模型调用', details: reserveResult };
      result.status = STATUS.FAILED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    const reservationId = reserveResult.reservationId;
    result.costLedger = { reservationState: RESERVATION_STATE.RESERVED, reservationId };

    // 4) 送出。外部调用从这里开始可能发生。
    const call = {
      payload: buildPayload(request, roleConf, { preprocessingOnly: professionalReviewDenied(context) }),
      signal: context.signal || null,
      deadlineMs: timeoutMs,
      requestId: request.requestId,
      role: request.role,
      purpose: request.purpose,
    };
    let transportPromise;
    try {
      transportPromise = Promise.resolve().then(() => transport(call));
    } catch (err) {
      // 同步抛出:默认按"可能已送出"保守处理,除非 transport 显式声明未发送
      if (err && err.notSent === true) {
        ledger.release({ reservationId, note: 'TRANSPORT_REFUSED_BEFORE_SEND' });
        result.costLedger = { reservationState: RESERVATION_STATE.RELEASED, reservationId };
        result.error = { code: ERROR_CODES.CANCELLED_BEFORE_SEND, message: 'transport 在发送前拒绝请求,未发生外部调用', details: { reason: String(err && err.message) } };
        result.status = STATUS.CANCELLED;
      } else {
        Object.assign(result.costLedger, settleCost(reservationId, err && err.usage, 'TRANSPORT_THROWN'));
        result.usageUnknown = result.costLedger.reservationState === RESERVATION_STATE.UNKNOWN_HOLD;
        result.error = { code: ERROR_CODES.TRANSPORT_THROWN, message: 'transport 调用抛出异常,外部调用状态不可确认', details: { reason: String(err && err.message) } };
        result.status = STATUS.FAILED;
      }
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    const outcome = await raceCall({ promise: transportPromise, timeoutMs, clock, signal: context.signal });

    // 5) 取消/超时:请求已送出,外部状态不可知 → unknown(不是 cancelled、不是 failed),
    //    预留保留(不声称取消等于未计费);迟到的 transport 结果不采信。
    if (outcome.kind === 'abort' || outcome.kind === 'timeout') {
      transportPromise.then(() => {}, () => {}); // 防 unhandled rejection;结果丢弃
      const code = outcome.kind === 'abort' ? ERROR_CODES.ABORTED_AFTER_SEND : ERROR_CODES.TIMEOUT;
      const message = outcome.kind === 'abort'
        ? '请求送出后被取消:外部调用可能已经发生,结果不可知。请人工核实后决定是否重试,本模块不会自动重试'
        : '等待外部响应超时:外部调用可能已经发生,结果不可知。请人工核实后决定是否重试,本模块不会自动重试';
      ledger.holdUnknown({ reservationId, note: code });
      result.costLedger = { reservationState: RESERVATION_STATE.UNKNOWN_HOLD, reservationId };
      result.usageUnknown = true;
      result.error = { code, message };
      result.status = STATUS.UNKNOWN;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    // 6) transport 抛出(异步)
    if (outcome.kind === 'rejected') {
      const err = outcome.error;
      if (err && err.notSent === true) {
        ledger.release({ reservationId, note: 'TRANSPORT_REFUSED_BEFORE_SEND' });
        result.costLedger = { reservationState: RESERVATION_STATE.RELEASED, reservationId };
        result.error = { code: ERROR_CODES.CANCELLED_BEFORE_SEND, message: 'transport 在发送前拒绝请求,未发生外部调用', details: { reason: String(err && err.message) } };
        result.status = STATUS.CANCELLED;
      } else {
        Object.assign(result.costLedger, settleCost(reservationId, err && err.usage, 'TRANSPORT_THROWN'));
        result.usage = normalizeUsage(err && err.usage);
        result.usageUnknown = result.costLedger.reservationState === RESERVATION_STATE.UNKNOWN_HOLD;
        result.error = { code: ERROR_CODES.TRANSPORT_THROWN, message: 'transport 调用抛出异常,外部调用状态不可确认', details: { reason: String(err && err.message) } };
        result.status = STATUS.FAILED;
      }
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    // 7) transport 返回结果
    const t = outcome.value;
    if (!isPlainObject(t)) {
      Object.assign(result.costLedger, settleCost(reservationId, null, 'MALFORMED_TRANSPORT_RESULT'));
      result.usageUnknown = true;
      result.error = { code: ERROR_CODES.MALFORMED_OUTPUT, message: 'transport 返回了非对象结果' };
      result.status = STATUS.FAILED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    if (t.ok === 'indeterminate') {
      ledger.holdUnknown({ reservationId, note: ERROR_CODES.TRANSPORT_INDETERMINATE });
      result.costLedger = { reservationState: RESERVATION_STATE.UNKNOWN_HOLD, reservationId };
      result.usageUnknown = true;
      result.error = { code: ERROR_CODES.TRANSPORT_INDETERMINATE, message: 'transport 无法判定外部调用是否发生,结果不可知;请人工核实,本模块不会自动重试' };
      result.status = STATUS.UNKNOWN;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    if (t.ok === false) {
      if (t.sent === false) {
        ledger.release({ reservationId, note: 'TRANSPORT_REPORTED_NOT_SENT' });
        result.costLedger = { reservationState: RESERVATION_STATE.RELEASED, reservationId };
        result.error = { code: ERROR_CODES.CANCELLED_BEFORE_SEND, message: 'transport 证明请求未发送,未发生外部调用', details: t.error || null };
        result.status = STATUS.CANCELLED;
        result.timings.finishedAt = clock.now();
        return deepFreeze(result);
      }
      Object.assign(result.costLedger, settleCost(reservationId, t.usage, 'TRANSPORT_ERROR'));
      result.usage = normalizeUsage(t.usage);
      result.usageUnknown = result.costLedger.reservationState === RESERVATION_STATE.UNKNOWN_HOLD;
      result.error = {
        code: ERROR_CODES.TRANSPORT_ERROR,
        message: (t.error && t.error.message) || '外部服务返回错误,该次调用不构成有效结果',
        details: t.error ? { code: t.error.code ?? null } : null,
      };
      result.status = STATUS.FAILED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }
    if (t.ok !== true || !isPlainObject(t.output)) {
      Object.assign(result.costLedger, settleCost(reservationId, t.usage, 'MALFORMED_TRANSPORT_RESULT'));
      result.usage = normalizeUsage(t.usage);
      result.usageUnknown = result.costLedger.reservationState === RESERVATION_STATE.UNKNOWN_HOLD;
      result.error = { code: ERROR_CODES.MALFORMED_OUTPUT, message: 'transport 返回缺少 ok:true 与 output 对象' };
      result.status = STATUS.FAILED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    // 8) 输出守门:结构、证据引用、越权内容。验证失败不伪装成功。
    const validation = validateProviderOutput({ output: t.output, request, forbiddenPatterns });
    result.usage = normalizeUsage(t.usage);
    Object.assign(result.costLedger, settleCost(reservationId, t.usage, validation.ok ? 'OK' : 'VALIDATION_FAILED'));
    result.usageUnknown = result.costLedger.reservationState === RESERVATION_STATE.UNKNOWN_HOLD;
    if (!validation.ok) {
      result.error = {
        code: ERROR_CODES.MALFORMED_OUTPUT,
        message: '模型输出未通过结构/引用/越权校验,已拒绝;该次调用不构成有效结果',
        details: { violations: validation.violations },
      };
      const first = validation.violations[0];
      if (first) {
        result.error = { ...result.error, code: first.code, message: `${first.message}`, details: { violations: validation.violations } };
      }
      result.status = STATUS.FAILED;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    result.findings = validation.normalized.findings;
    result.questions = validation.normalized.questions;
    result.evidenceRefs = validation.normalized.evidenceRefs;

    // 9) 返回时核对会话快照:generation/contextVersion 变化或已暂停 → stale(结果已取回、成本已发生)。
    const stale = stalenessOf(request, context);
    if (stale) {
      result.error = { code: stale.code, message: stale.message };
      result.status = STATUS.STALE;
      result.timings.finishedAt = clock.now();
      return deepFreeze(result);
    }

    result.status = t.simulated === true ? STATUS.SIMULATED : STATUS.SUCCEEDED;
    if (t.simulated === true) {
      result.mode = 'simulated';
      result.simulation = { notice: SIMULATION_NOTICE };
    }
    // 人控边界(Goal 工作包3):专业前序复核未通过 → 成功类结果(succeeded/simulated)
    // 附加"仅预处理"范围标记;status 语义不变,由业务层据此挡在正式判定通道外。
    if (professionalReviewDenied(context)) {
      result.scope = SCOPE_PREPROCESSING_ONLY;
      result.scopeNotice = SCOPE_NOTICE_PREPROCESSING_ONLY;
    }
    result.timings.finishedAt = clock.now();
    return deepFreeze(result);
  }

  async function analyze(request, context = {}) {
    const startedAt = clock.now();

    // 1) 请求校验(结构与角色/用途授权)。
    const v = validateAnalyzeRequest(request, { roles });
    if (!v.ok) {
      return quickResult(request, [], startedAt, {
        status: STATUS.FAILED,
        error: { code: v.code, message: v.message, details: v.details || null },
      });
    }

    // 2) provider 未配置:显式 not_configured,绝不伪装,绝不调用。
    if (typeof transport !== 'function') {
      return quickResult(request, v.warnings, startedAt, {
        mode: 'none',
        status: STATUS.NOT_CONFIGURED,
        error: { code: ERROR_CODES.TRANSPORT_NOT_CONFIGURED, message: '未配置模型 provider:未执行任何外部调用;请先注入 transport 或明确使用模拟通道' },
      });
    }

    // 3) 实例内去重/冲突(内存级;持久幂等由业务层负责)。
    const payload = buildPayload(request, v.roleConf, { preprocessingOnly: professionalReviewDenied(context) });
    const hash = payloadHash(payload);
    const reg = registry.lookup(request.requestId, hash);
    if (reg.kind === 'mismatch') {
      return quickResult(request, v.warnings, startedAt, {
        status: STATUS.FAILED,
        error: {
          code: ERROR_CODES.REQUEST_MISMATCH,
          message: '同一 requestId 携带了不同载荷:拒绝执行以防止旧回执污染新草稿;请换用新的 requestId',
          details: { registeredPayloadHash: reg.registeredHash },
        },
      });
    }
    if (reg.kind === 'capacity') {
      // 明确背压:登记满且无可安全释放的在途 → 不调用 transport、不预留预算,失败关闭。
      return quickResult(request, v.warnings, startedAt, {
        status: STATUS.FAILED,
        error: {
          code: ERROR_CODES.REGISTRY_AT_CAPACITY,
          message: '适配器请求登记已满且无在途请求可释放:为保护在途去重不新增请求;请稍后重试或提高 maxEntries',
          details: { maxEntries },
        },
      });
    }
    if (reg.kind === 'cache-hit') {
      // R2:缓存命中也必须复核当前快照,不得把已完成缓存的旧结果当现行(见 revalidateCached)。
      return revalidateCached(reg.result, request, context);
    }
    if (reg.kind === 'in-flight') {
      // R2:在飞 join 同样在拿到结果后先复核当前快照,再决定 succeeded 还是 stale。
      const shared = await reg.promise;
      return revalidateCached(shared, request, context);
    }

    const execPromise = executeRequest(request, v.roleConf, context, v.warnings, startedAt);
    const tracked = registry.track(request.requestId, hash, execPromise);
    if (tracked.kind === 'capacity' || tracked.kind === 'mismatch') {
      // 防御:lookup 与 track 之间无异步间隙,此分支按构造不可达;失败关闭,
      // 不让未登记的执行以正常结果呈现(协议契约变化时在此显式暴露)。
      return quickResult(request, v.warnings, startedAt, {
        status: STATUS.FAILED,
        error: tracked.kind === 'capacity'
          ? {
            code: ERROR_CODES.REGISTRY_AT_CAPACITY,
            message: '适配器请求登记已满且无在途请求可释放:为保护在途去重不新增请求;请稍后重试或提高 maxEntries',
            details: { maxEntries },
          }
          : {
            code: ERROR_CODES.REQUEST_MISMATCH,
            message: '同一 requestId 携带了不同载荷:拒绝执行以防止旧回执污染新草稿;请换用新的 requestId',
            details: { registeredPayloadHash: tracked.registeredHash },
          },
      });
    }
    return execPromise;
  }

  /** 实例内会话状态登记(context.snapshot 未提供时作为默认快照来源)。 */
  function markSession(sessionId, state) {
    const prev = sessionStates.get(sessionId) || { generation: undefined, contextVersion: undefined, paused: false, note: null };
    sessionStates.set(sessionId, { ...prev, ...state });
  }

  /** 暂停:阻断本实例对该会话的新调用;在途结果返回时标记 stale。恢复必须显式调用 resumeSession。 */
  function pauseSession(sessionId, note = null) {
    markSession(sessionId, { paused: true, note });
  }

  /** 恢复:显式人工动作(留痕由业务层负责);通常应同时推进 generation。 */
  function resumeSession(sessionId, { generation, contextVersion, note = null } = {}) {
    markSession(sessionId, { paused: false, generation, contextVersion, note });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    analyze,
    ledger,
    markSession,
    pauseSession,
    resumeSession,
    registrySnapshot() {
      return [...registry.map.entries()].map(([requestId, e]) => ({ requestId, payloadHash: e.payloadHash, cached: Boolean(e.result) }));
    },
  };
}

/**
 * 便捷工厂:把"provider 纯映射函数 + 注入的 fetch 实现"组装成 transport。
 * 适配器自身从不发起网络请求;真实部署由业务层注入其可信的 fetch 实现。
 * parseResponse 契约:(raw) => { output?, usage?, error? } —— HTTP 层成功但 provider
 * 业务失败(如 Dify data.status=failed、错误码体)时返回 { error:{ code, message } }。
 */
export function createProviderTransport({ buildRequest, parseResponse, modeName, fetchImpl, simulated = false } = {}) {
  if (typeof buildRequest !== 'function' || typeof parseResponse !== 'function') {
    throw new TypeError('createProviderTransport 需要 buildRequest 与 parseResponse 纯映射函数');
  }
  return async function transport(call) {
    if (typeof fetchImpl !== 'function') {
      const err = new Error('未注入 fetchImpl:provider transport 无法发送请求(这是部署配置缺失,不是模型失败)');
      err.notSent = true;
      err.code = 'FETCH_IMPL_MISSING';
      throw err;
    }
    const req = buildRequest(call.payload);
    let raw;
    try {
      const res = await fetchImpl(req.url, {
        method: req.method || 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: call.signal,
      });
      raw = await res.json();
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) throw err;
      throw Object.assign(new Error(`provider 请求失败:${(err && err.message) || 'unknown'}`), { cause: err });
    }
    const parsed = parseResponse(raw);
    if (parsed.indeterminate) {
      return { ok: 'indeterminate' };
    }
    if (parsed.error) {
      return { ok: false, sent: true, error: parsed.error, usage: parsed.usage };
    }
    return { ok: true, simulated, modeName, output: parsed.output, usage: parsed.usage };
  };
}
