// V7-B ⇄ A 集成:A 合同 v0.1 HTTP 客户端(零依赖 fetch;D/测试可注入 fetchImpl)。
// 对账来源:V7/backend/CONTRACT.md v0.1(2026-09-15;含 D-6 可信 principal 边界/意见状态门/引用失败关闭)。
// 语义:全部写命令带 requestId + expectedVersion;同 requestId 同载荷 → replayed:true;
// 异载荷 → 409 REQUEST_MISMATCH;版本过期 → 409 VERSION_CONFLICT(ICR-4 裁决:escalate
// 维持严格幂等,本 sink 以载荷缓存满足;缓存丢失=换新 requestId 重试)。
// 本模块只做传输与错误归一,不做任何业务重试(unknown/冲突一律上抛,由编排层/人工决定)。
// 凭据纪律:v0.1 正式人工动作需 principalCredential;凭据只在调用体内与 sink 内存载荷缓存
// 出现,不落日志、不落 checkpoint/journal、不进模型载荷(adapter 注入与业务凭据物理分离)。

export function createAClient({ baseUrl, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!baseUrl) throw new Error('A 客户端:缺少 baseUrl');
  const base = baseUrl.replace(/\/$/, '');

  async function call(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      const err = new Error(`A 服务不可达(${method} ${path}):${e.cause?.code ?? e.message}`);
      err.code = 'A_UNAVAILABLE';
      err.notSent = true; // 连接未建立即失败 → 请求未发出
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.ok !== true) {
      const err = new Error(`A ${method} ${path} 失败(${res.status}):${payload?.error ?? 'UNKNOWN'} ${payload?.message ?? ''}`);
      err.code = payload?.error ?? `HTTP_${res.status}`;
      err.status = res.status;
      err.serverVersion = payload?.serverVersion;
      err.notSent = false; // 已送达 A 但被拒:A 有记录(幂等表),按失败语义处理
      throw err;
    }
    return payload;
  }

  return {
    async health() { return call('GET', '/api/v7/health'); },
    async getProject(projectId) { return call('GET', `/api/v7/projects/${encodeURIComponent(projectId)}`); },
    async listRules() { return call('GET', '/api/v7/rules'); },
    async getRun(runId) { return call('GET', `/api/v7/runs/${encodeURIComponent(runId)}`); },
    async createProject(body) { return call('POST', '/api/v7/projects', body); },
    async attachEvidence(projectId, body) { return call('POST', `/api/v7/projects/${encodeURIComponent(projectId)}/evidence`, body); },
    async publishRule(body) { return call('POST', '/api/v7/rules', body); },
    async createRun(projectId, body) { return call('POST', `/api/v7/projects/${encodeURIComponent(projectId)}/runs`, body); },
    async addOpinion(runId, body) { return call('POST', `/api/v7/runs/${encodeURIComponent(runId)}/opinions`, body); },
    async setCalculation(runId, body) { return call('POST', `/api/v7/runs/${encodeURIComponent(runId)}/calculation`, body); },
    async escalate(runId, body) { return call('POST', `/api/v7/runs/${encodeURIComponent(runId)}/state`, body); },
    async addHumanAction(runId, body) { return call('POST', `/api/v7/runs/${encodeURIComponent(runId)}/human-actions`, body); },
    async getReceipt(requestId, store) { return call('GET', `/api/v7/receipts/${encodeURIComponent(requestId)}?store=${store}`); },
  };
}

import { toACandidate } from './adapter-bridge.mjs';

/**
 * B 编排产物 → A 事实源同步(sink)。B 的 journal/checkpoint 是编排权威;A 的 run 是业务事实源
 * (合同 §6:checkpoint 不替代事实源)。每次落库用确定性 requestId 保证幂等:
 *   意见 = `${orchRunId}::op:${stepId}:a${attempt}`;计算 = `...::calc:...`;
 *   升级 = `...::esc:${kind}`;人工动作 = `...::ha:${action}`。
 * expectedVersion 用 A run.version(sink 内缓存,冲突上抛不自动重试)。
 */
export function createARunSink({ aClient, aRunId, logger = () => {} }) {
  if (!aClient) throw new Error('A sink:缺少 aClient');
  if (!aRunId) throw new Error('A sink:缺少 aRunId(A run 须由 assembly/调用方先创建)');
  let knownRunVersion = null;
  // 合同 §3:同 requestId 必须同载荷才 replay;重放时重发缓存的原始载荷(含原 expectedVersion)。
  // 凭据纪律:缓存仅在内存(幂等重放需要同载荷);不落日志/checkpoint。
  const sentBodies = new Map();

  async function runVersion() {
    if (knownRunVersion === null) {
      const r = await aClient.getRun(aRunId);
      knownRunVersion = r.run.version;
    }
    return knownRunVersion;
  }
  function absorb(resp) {
    // 单调保护:replay 响应携带的是历史 runVersion,不得把缓存回退(否则后续
    // expectedVersion 过期 → 409 VERSION_CONFLICT)
    if (typeof resp.runVersion === 'number'
        && (knownRunVersion === null || resp.runVersion > knownRunVersion)) {
      knownRunVersion = resp.runVersion;
    }
    return resp;
  }

  const DISPATCH = {
    opinions: (b) => aClient.addOpinion(aRunId, b),
    calculation: (b) => aClient.setCalculation(aRunId, b),
    escalate: (b) => aClient.escalate(aRunId, b),
    'human-action': (b) => aClient.addHumanAction(aRunId, b),
  };

  /**
   * 统一发送:同 requestId 重放缓存载荷(严格幂等,ICR-4 裁决维持);
   * 400/403 = 服务端确定性拒绝且未写任何回执 → 逐出缓存,让修正后的重试
   * (如换上合法 principalCredential)可复用同一 requestId;
   * 409/网络错误保持缓存不动,由调用方显式决策。
   */
  async function send(path, requestId, buildBody) {
    const invoke = DISPATCH[path];
    if (!invoke) throw new Error(`未知同步路径 ${path}`);
    let body = sentBodies.get(requestId);
    if (!body) {
      body = buildBody(await runVersion());
      sentBodies.set(requestId, body);
    }
    try {
      return await invoke(body);
    } catch (e) {
      if (e?.status === 400 || e?.status === 403) sentBodies.delete(requestId);
      throw e;
    }
  }

  return {
    aRunId,
    /** 模型步成功/模拟 → opinions;工具步成功 → calculation。 */
    async onStepOutcome(view, step) {
      if (step.kind === 'model' && (step.state === 'succeeded' || step.state === 'simulated')) {
        const requestId = `${view.runId}::op:${step.id}:a${step.attempt}`;
        const resp = await send('opinions', requestId, (expectedVersion) => ({
          requestId,
          expectedVersion,
          provider: step.state === 'simulated' ? 'simulation' : 'real_http',
          requestReceipt: step.requestId, // B 网关请求标识(合同 §6 回执语义)
          candidate: toACandidate(step.candidate),
          basedOnEvidence: (view.evidenceRefs ?? []).map((e) => ({ evidenceId: e.id, version: Number(e.version) })),
        }));
        absorb(resp);
        logger(`[a-sync] opinion ${requestId} → runVersion ${knownRunVersion}`);
        return resp;
      }
      if (step.kind === 'tool' && step.state === 'succeeded') {
        const requestId = `${view.runId}::calc:${step.id}:a${step.attempt}`;
        const resp = await send('calculation', requestId, (expectedVersion) => ({
          requestId,
          expectedVersion,
          toolVersion: step.toolVersion,
          inputHash: step.inputHash,
          output: { summary: step.candidate?.observations?.[0] ?? '', ratio: step.toolOutput?.ratio ?? null },
          assumptions: [...(step.candidate?.assumptions ?? [])],
        }));
        absorb(resp);
        logger(`[a-sync] calculation ${requestId} → runVersion ${knownRunVersion}`);
        return resp;
      }
      return null;
    },
    /** 运行终态同步:waiting_evidence→human_required;unknown→unknown;failed→failed;completed 不动(正式决定留人工)。 */
    async onTerminal(view) {
      const kind = view.terminal?.kind;
      if (!kind || kind === 'completed') return null;
      const aState = kind === 'waiting_evidence' ? 'human_required' : kind;
      const requestId = `${view.runId}::esc:${kind}`;
      const resp = await send('escalate', requestId, (expectedVersion) => ({
        requestId,
        expectedVersion,
        state: aState,
        reason: view.terminal.reasonZh ?? kind,
      }));
      absorb(resp);
      logger(`[a-sync] escalate ${requestId} → ${aState}`);
      return resp;
    },
    /**
     * 正式人工动作提交(A 合同 v0.1 D-6:principalCredential 经服务端 principalVerifier 验证,
     * 未配置身份源=默认失败关闭)。凭据由调用方(人/assembly)显式传入;只进本次请求体与
     * sink 内存缓存(幂等重放需要同载荷),不落日志/checkpoint,不进任何模型载荷。
     * 403(凭据无效)后缓存自动逐出:修正凭据后可复用同一 requestId 重试。
     * 注意意见状态门(D-4):resolved 后不可再追加;escalation 期间意见落库会被 409 闭门。
     */
    async submitHumanAction(view, { action, actorName, note, principalCredential }) {
      const requestId = `${view.runId}::ha:${action}`;
      const resp = await send('human-action', requestId, (expectedVersion) => ({
        requestId,
        expectedVersion,
        action,
        actorRole: 'human',
        actorName,
        note,
        principalCredential,
      }));
      absorb(resp);
      logger(`[a-sync] human-action ${requestId} → ${resp.runState}`);
      return resp;
    },
  };
}
