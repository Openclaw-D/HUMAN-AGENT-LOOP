// 任务一 · B 路检查会话调度器：消费 A 的会话快照与 next-actions，为"待外发授权"的问题
// 请求 A 的外发授权（A 是唯一事实源；B 不复制业务状态、不做业务判定）。
// 纪律（与 A 契约 docs/INSPECTION_SESSION_V1.md §1 对应）：
//   - 代际：每次授权携带快照中的 dispatchGeneration；A 侧 pause 事务推进代际后，
//     旧调度者凭旧代际被 STALE_DISPATCH_GENERATION 拒——本模块停而不绕，不重试、不换 requestId。
//   - 暂停：OUTBOUND_PAUSED / SESSION_NOT_RUNNING = 确定未授权，立即停止本轮。
//   - 三分发送（沿用 ports.mjs ReceiptsPort）：授权请求前落 intent（sent:null）；授权成功落 terminal
//     （sent:true）；被拒落 terminal（sent:false, code）。恢复时仅 intent 无 terminal → 判 unknown，
//     不自动重发；只有人工显式重试（新 requestId）才再次发起。
//   - 本模块只负责"授权"，不做真正的模型/渠道外发，也不回写业务事实。

import { randomBytes } from 'node:crypto';

function defaultRequestIdFactory() {
  return `ixd-${process.pid}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

const STOP_CODES = new Set(['OUTBOUND_PAUSED', 'STALE_DISPATCH_GENERATION', 'SESSION_NOT_RUNNING', 'INSPECTION_CLOSED']);

/** A 的检查会话 HTTP 端口（Back/A /api/v1/inspections/*）。 */
export function httpInspectionPort({ base, token, fetchImpl = fetch }) {
  const call = async (method, path, body) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-principal-credential'] = token;
    const res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (res.status !== 200) {
      const err = new Error(`A ${method} ${path} → ${res.status}: ${json?.error ?? 'UNKNOWN'}`);
      err.code = json?.error ?? 'UNKNOWN';
      throw err;
    }
    return json;
  };
  return {
    async snapshot(sessionId) {
      return (await call('GET', `/api/v1/inspections/${sessionId}`)).snapshot;
    },
    async nextActions(sessionId) {
      return call('GET', `/api/v1/inspections/${sessionId}/next-actions`);
    },
    async grant(sessionId, { requestId, questionId, generation, channel }) {
      return call('POST', `/api/v1/inspections/${sessionId}/outbound/grant`, { requestId, questionId, generation, channel });
    },
  };
}

/**
 * 创建调度器。
 * @param p.port InspectionPort（httpInspectionPort 或测试桩）
 * @param p.receipts ReceiptsPort 兼容 {get, put}
 * @param p.channel 外发渠道标识
 * @param p.requestIdFactory 每次授权生成唯一 requestId（重试=新 requestId，由人工显式触发）
 */
export function createInspectionDispatcher({ port, receipts, channel = 'chat', requestIdFactory = defaultRequestIdFactory, logger = () => {} }) {
  /** 单轮调度：读快照 → 过滤"待外发授权"事项 → 逐条授权（receipt 三分记录）。
   *  返回 {dispatched, skipped, stop:null|{code,questionId}}。stop 非空 = 本轮纪律性停止。 */
  async function dispatchOnce(sessionId) {
    const snap = await port.snapshot(sessionId);
    if (snap.runStatus !== 'in_progress' || snap.outbound?.paused === true) {
      return { dispatched: 0, skipped: 0, stop: { code: snap.outbound?.paused === true ? 'OUTBOUND_PAUSED' : 'SESSION_NOT_RUNNING', questionId: null } };
    }
    const generation = Number(snap.outbound.dispatchGeneration);
    const nx = await port.nextActions(sessionId);
    const waiting = (nx.nextActions ?? []).filter(
      (a) => typeof a.blockedReason === 'string' && a.blockedReason.startsWith('waiting_dispatch') && a.waitingFor?.questionId,
    );
    let dispatched = 0;
    let skipped = 0;
    for (const action of waiting) {
      const questionId = action.waitingFor.questionId;
      // 授权 requestId = 每次调度轮次生成；同轮内恢复重入先查 terminal 回执，已有终态不重复发起
      const requestId = requestIdFactory(sessionId, questionId, generation);
      const prior = await receipts.get(requestId);
      if (prior?.phase === 'terminal') { skipped += 1; continue; }
      await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'intent', sent: null, status: 'granting', at: new Date().toISOString() });
      try {
        const granted = await port.grant(sessionId, { requestId, questionId, generation, channel });
        await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'terminal', sent: true, status: 'authorized', sendId: granted.sendId, at: new Date().toISOString() });
        dispatched += 1;
        logger(`granted ${questionId} (gen=${generation}, send=${granted.sendId})`);
      } catch (error) {
        const code = error?.code ?? 'UNKNOWN';
        await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'terminal', sent: false, status: code, at: new Date().toISOString() });
        if (STOP_CODES.has(code)) {
          // 纪律性停止：暂停/旧代际/未运行——不绕过、不重试、不换 requestId
          logger(`stop on ${code} at ${questionId}`);
          return { dispatched, skipped, stop: { code, questionId } };
        }
        // 非纪律性错误（网络等）：如实记录并继续本轮其余事项（A 未授权该问，不产生副作用）
        logger(`grant error ${code} at ${questionId}`);
        skipped += 1;
      }
    }
    return { dispatched, skipped, stop: null };
  }

  return { dispatchOnce };
}
