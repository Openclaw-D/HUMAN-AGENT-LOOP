import { ConnError } from '../errors.mjs';

/**
 * goal-02（产品交付·任务二）· A v2 桥接客户端。
 * 硬边界（任务书 §三）：
 * - A 是业务事实与正式收口的权威；本桥只经 A 现有 HTTP API 写入，不直写 A 表、不建第二套授信事实。
 * - 身份分工（A 源码钉死）：材料/派生件登记=人类凭据（客户上传恒 unverified；等级提升=获准人工复核）；
 *   analysis-runs / Gate 回执=kind=service 凭据；findings=agent/service 可建；规则包激活=业务侧行为，本桥不做。
 * - 每操作确定性 requestId（调用方给）；网络失败/超时=A_UNKNOWN（结果未知，调用方保持 unknown 先对账，
 *   绝不换 ID 重试）；4xx 业务拒绝=确定性错误（如实失败，不重试不掩盖）。
 * - 回执对账按 (tenant, principal) 归属过滤：对账必须用原调用凭据。
 * - 载荷只含受控元数据与解析产物引用：无媒体字节、无凭据；禁键（approv|decision|quota|price|rate|reject）
 *   不进入 result/params 通道（A §3.1）；证据 content 按 A 契约可含业务数值（报价单含价格合法）。
 */

export const A_GATE_RESULTS = ['CLEAR', 'NEEDS_EVIDENCE', 'HOLD_FOR_REVIEW', 'HARD_BLOCK'];
const RUN_TERMINAL = ['completed', 'failed', 'timeout', 'not_configured', 'input_invalid'];

export function makeABridge({
  aBaseUrl, tenantId, credentials = {}, fetchImpl = null, defaultTimeoutMs = 5000,
}) {
  if (!aBaseUrl || !tenantId) throw new ConnError('BLOCKED_EXTERNAL', 'A 桥需要 aBaseUrl/tenantId 配置');
  if (!credentials.service) throw new ConnError('BLOCKED_EXTERNAL', 'A 桥需要 credentials.service（kind=service 凭据：运行/Gate 回执专用）');
  const doFetch = fetchImpl ?? fetch;

  function principalOf(kind, role) {
    if (kind === 'upload') {
      return credentials.upload?.[role] ?? credentials.uploadFallback ?? null;
    }
    if (kind === 'registrar') return credentials.registrar ?? null;
    if (kind === 'reviewer') return credentials.reviewer ?? null;
    return credentials.service ?? null;
  }

  /** 统一 A 调用：返回 200 body；网络/超时 → A_UNKNOWN；4xx/5xx → 确定性错误（带 A 错误码）。 */
  async function call(credential, method, path, body, { requestId = null, timeoutMs = 0 } = {}) {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    let res;
    try {
      res = await doFetch(`${aBaseUrl}${path}`, {
        method,
        signal,
        headers: {
          'content-type': 'application/json',
          'x-principal-credential': credential,
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? `A 请求超时（结果未知）：${path}`
        : `A 请求网络失败（结果未知）：${String(e?.message ?? e).slice(0, 120)}`;
      throw Object.assign(new Error(reason), { code: 'A_UNKNOWN', aRequestId: requestId });
    }
    const respBody = await res.json().catch(() => ({}));
    if (res.status === 200 && respBody?.ok !== false) return respBody;
    // A 的错误响应：{ok:false,error,message,...}——确定性业务拒绝（不重试）
    const err = new Error(`A ${path} → ${res.status} ${respBody?.error ?? 'UNKNOWN'}: ${String(respBody?.message ?? '').slice(0, 200)}`);
    err.code = respBody?.error ?? `A_HTTP_${res.status}`;
    err.deterministic = true;
    err.aRequestId = requestId;
    throw err;
  }

  const v2Body = (extra) => ({ tenantId, requestId: extra.requestId, ...extra });

  // ---- 材料（人类凭据；客户上传恒 unverified） ----

  async function registerArtifactOp({
    aCustomerId, kind, factKey = null, content, grade = 'unverified',
    materialMeta = null, objectRef = null, supersedes = null, provenance = null,
    projectId = null, principalToken, requestId, timeoutMs = 0,
  }) {
    if (!principalToken) throw new ConnError('BLOCKED_EXTERNAL', 'A 材料登记缺少映射凭据（a.credentials.upload/registrar）');
    const body = v2Body({
      requestId, kind, content, grade,
      ...(factKey ? { factKey } : {}),
      ...(materialMeta ? { materialMeta } : {}),
      ...(objectRef ? { objectRef } : {}),
      ...(supersedes ? { supersedes } : {}),
      ...(provenance ? { provenance } : {}),
      ...(projectId ? { projectId } : {}),
    });
    const r = await call(principalToken, 'POST', `/api/v2/customers/${encodeURIComponent(aCustomerId)}/artifacts`, body, { requestId, timeoutMs });
    return { aArtifactId: r.artifactId ?? null, duplicateOf: r.duplicateOf ?? null, supersedes: r.supersedes ?? null };
  }

  // ---- 分析运行与 Gate 回执（service 凭据专用） ----

  async function startRun({ aCustomerId, domain, deps, providerMode = 'simulation', requestId, timeoutMs = 0 }) {
    const r = await call(credentials.service, 'POST',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}/analysis-runs/start`,
      v2Body({ requestId, domain, deps, providerMode }), { requestId, timeoutMs });
    return { runId: r.runId, inputDigest: r.inputDigest ?? null };
  }

  async function finishRun({ runId, executionStatus = 'completed', requestId, timeoutMs = 0 }) {
    if (!RUN_TERMINAL.includes(executionStatus)) throw new ConnError('INVALID_INPUT', `executionStatus 必须 ${RUN_TERMINAL.join('/')}`);
    const r = await call(credentials.service, 'POST',
      `/api/v2/analysis-runs/${encodeURIComponent(runId)}/finish`,
      v2Body({ requestId, executionStatus }), { requestId, timeoutMs });
    return { runId: r.runId, status: r.status };
  }

  async function registerGateReceipt({
    aCustomerId, result, rulesetVersion, reasonCodes = [], ruleIds = [], blockedActions = [],
    evidenceRefs = [], inputDigest = null, evaluatedAt = null, requestId, timeoutMs = 0,
  }) {
    if (!A_GATE_RESULTS.includes(result)) throw new ConnError('INVALID_INPUT', `Gate result 必须 ${A_GATE_RESULTS.join('/')}`);
    const r = await call(credentials.service, 'POST',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}/rule-gate-receipts`,
      v2Body({ requestId, result, rulesetVersion, reasonCodes, ruleIds, blockedActions, evidenceRefs, inputDigest, evaluatedAt }),
      { requestId, timeoutMs });
    return { receiptId: r.receiptId, result: r.result, rulesetVersion: r.rulesetVersion };
  }

  // ---- findings（冲突→A 复核队列；处理仅人类） ----

  async function createFinding({
    aCustomerId, findingType, assertion, sideA = {}, sideB = {}, responsibleRole,
    severity = 'major', impactScope, requiredAction, ruleRef = null, requestId, timeoutMs = 0,
  }) {
    const r = await call(credentials.service, 'POST',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}/findings`,
      v2Body({ requestId, findingType, assertion, sideA, sideB, responsibleRole, severity, impactScope, requiredAction, ...(ruleRef ? { ruleRef } : {}) }),
      { requestId, timeoutMs });
    return { findingId: r.findingId };
  }

  // ---- G3 材料处理状态（IR-03-8①；仅 kind=service；A 侧 stage_rank 同 runRef 内严格单调） ----
  // stages[]: [{stage: received|parsed|analyzed|needs_review|failed, runRef, detail?, failureReason?, nextAction?}]
  // 语义：新 runRef=新处理尝试（可从任意 stage 重开）；failed 必须带 failureReason；
  //       failed|needs_review 必须带 nextAction（页面要能解释下一动作）。回执不承载授信语义。

  async function reportProcessingStages({ aCustomerId, aArtifactId, stages, requestId, timeoutMs = 0 }) {
    if (!Array.isArray(stages) || stages.length === 0) throw new ConnError('INVALID_INPUT', 'reportProcessingStages: stages 必须非空数组');
    for (const s of stages) {
      if (!s?.stage || !s.runRef) throw new ConnError('INVALID_INPUT', 'reportProcessingStages: stages[].stage/runRef 必填');
      if (s.stage === 'failed' && (s.failureReason == null || s.failureReason === '')) {
        throw new ConnError('INVALID_INPUT', 'stage=failed 必须给 failureReason（A 契约）');
      }
      if ((s.stage === 'failed' || s.stage === 'needs_review') && (s.nextAction == null || s.nextAction === '')) {
        throw new ConnError('INVALID_INPUT', `stage=${s.stage} 必须给 nextAction（A 契约）`);
      }
    }
    const r = await call(credentials.service, 'POST',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}/artifacts/${encodeURIComponent(aArtifactId)}/processing`,
      v2Body({ requestId, stages: stages.map((s) => ({
        stage: s.stage, runRef: String(s.runRef).slice(0, 128),
        ...(s.detail ? { detail: String(s.detail).slice(0, 512) } : {}),
        ...(s.failureReason ? { failureReason: String(s.failureReason).slice(0, 256) } : {}),
        ...(s.nextAction ? { nextAction: String(s.nextAction).slice(0, 256) } : {}),
      })) }),
      { requestId, timeoutMs });
    return { ok: r.ok === true, current: r.current ?? null, recorded: r.recorded ?? null };
  }

  // ---- 依据包域结果（存在包时；opinion authority 恒 none，A 服务端强制） ----

  async function recordDomainResult({
    packageId, domain, deps, analysisRun, opinion, adoption = null, principalToken, requestId, timeoutMs = 0,
  }) {
    if (!principalToken) throw new ConnError('BLOCKED_EXTERNAL', '域结果登记缺少业务凭据（a.credentials.registrar）');
    const body = v2Body({ requestId, domain, deps, analysisRun, opinion: { authority: 'none', ...opinion }, ...(adoption ? { adoption } : {}) });
    const r = await call(principalToken, 'POST',
      `/api/v2/decision-packages/${encodeURIComponent(packageId)}/domain-results`, body, { requestId, timeoutMs });
    return { ok: true, resultId: r.resultId ?? null };
  }

  // ---- 读：对账 / 客户权威核验 / 依据包发现 ----

  /** 客户权威核验（任务02 受控映射链）：以 human business 凭据（客户范围=租户内 all）读 A 客户主档。
   *  只读；返回 {ok:true, customer:{customerId,tenantId,legalEntityRef,displayName,…}} 或确定性错误
   *  （NOT_FOUND=A 无此客户；其余=网络/凭据问题由调用方按可恢复等待处理）。 */
  async function getCustomer(aCustomerId, { timeoutMs = 0 } = {}) {
    const r = await call(credentials.registrar ?? credentials.service, 'GET',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}`, undefined, { timeoutMs });
    return { ok: true, customer: r.customer ?? null };
  }

  async function getReceipt(requestId, { principalToken, timeoutMs = 0 } = {}) {
    try {
      const r = await call(principalToken ?? credentials.service, 'GET',
        `/api/v2/receipts/${encodeURIComponent(requestId)}`, undefined, { timeoutMs });
      if (r.found === false) return { found: false, requestId };
      // A v2 回执行形态：{requestId, action, response, created_at}——原始响应在 response 内；
      // 兼容平铺形态（测试脚本/未来演进）
      const row = (r.receipt && typeof r.receipt === 'object' && !Array.isArray(r.receipt)) ? r.receipt : null;
      const payload = row
        ? ((row.response && typeof row.response === 'object' && !Array.isArray(row.response)) ? row.response : row)
        : r;
      return { found: true, requestId: (row?.requestId) ?? r.requestId ?? requestId, replayed: r.replayed ?? null, receipt: payload };
    } catch (e) {
      if (e.code === 'NOT_FOUND') return { found: false, requestId };
      throw e;
    }
  }

  async function decisionStatus(aCustomerId, { principalToken, timeoutMs = 0 } = {}) {
    return call(principalToken ?? credentials.registrar ?? credentials.service, 'GET',
      `/api/v2/customers/${encodeURIComponent(aCustomerId)}/decision-status`, undefined, { timeoutMs });
  }

  return {
    tenantId, credentials,
    principalOf,
    registerArtifactOp, startRun, finishRun, registerGateReceipt, createFinding, recordDomainResult,
    reportProcessingStages,
    getCustomer, getReceipt, decisionStatus,
  };
}
