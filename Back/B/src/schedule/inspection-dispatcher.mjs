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
//
// 任务 02 · B3/W07/W08/W09 调度纪律（PR#3 审核后任务02）：
//   - 受众分流：问题按 nextActions 行的 targetRole 经 channelForRole 映射到授权通道；
//     不同角色的私线（如财务/厂长各自企微线程）可并行推进，互不阻塞。
//   - 公共通话单飞（W07）：映射到公共通话通道（voiceChannels）的问题在同一时刻至多一个
//     在途——占用判定 = A 快照 outbound.inFlight（含 authorized/sent/unknown）∪ 本轮已授权；
//     被占时其余通话问题排队（留在 A 的 open 态），不抢话、不重复骚扰。
//   - 角色单飞：同一 targetRole 至多一个在途提问（不同角色并行），防止对同一人重复追问。
//   - 敏感转人工（B3.2）：title/whyNeeded 命中敏感类别（内部评分参数、正式授信承诺、
//     指控性表述）→ 永不自动外发（held:SENSITIVE_REQUIRES_HUMAN），无论是否获准。
//   - 获准外发（B3.2）：autoSend.allowlist 配置（按 itemKey）= 人工批准可自动外发的常规
//     核验项；allowlist 为数组时未列事项一律不自动外发（held:AUTO_SEND_NOT_APPROVED）；
//     缺省 null = 兼容旧行为（全部放行，敏感守卫仍生效）。
//   - unknown 不重发（W09）：A 快照 inFlight 中 status='unknown' 的问题跳过
//     （held:SEND_UNKNOWN_RECONCILE）——对账走 A 的 SEND_UNKNOWN_RECONCILE 门，禁止换 requestId 重问。

import { randomBytes } from 'node:crypto';

function defaultRequestIdFactory() {
  return `ixd-${process.pid}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

const STOP_CODES = new Set(['OUTBOUND_PAUSED', 'STALE_DISPATCH_GENERATION', 'SESSION_NOT_RUNNING', 'INSPECTION_CLOSED']);

/** 敏感类别守卫默认词表：命中即转人工，结构性不允许自动外发（可被配置替换，不可被配置关闭为空跑）。 */
const DEFAULT_SENSITIVE_PATTERNS = [
  /欺诈|造假|虚开|洗钱|指控|犯罪的?嫌疑/,
  /承诺授信|批准额度|保证获批|利率承诺/,
  /内部评分|评分卡|内部参数|风控模型参数/,
];

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
 * @param p.channel 缺省外发渠道标识（targetRole 无映射时的兜底）
 * @param p.requestIdFactory 每次授权生成唯一 requestId（重试=新 requestId，由人工显式触发）
 * @param p.autoSend 自动外发策略（任务02/B3）：
 *   - allowlist: string[]|null —— 获准自动外发的 itemKey 清单；null=兼容旧行为全放行（敏感守卫仍生效）
 *   - sensitivePatterns: RegExp[] —— 命中 title/whyNeeded 即转人工（缺省 DEFAULT_SENSITIVE_PATTERNS）
 *   - channelForRole: (role) => string —— 角色→授权通道映射（缺省全部走 p.channel）
 *   - voiceChannels: string[] —— 视为"公共通话"的通道（这些通道全局单飞；缺省 ['rtc-voice']）
 */
export function createInspectionDispatcher({
  port, receipts, channel = 'chat', requestIdFactory = defaultRequestIdFactory, logger = () => {},
  autoSend = {},
}) {
  const {
    allowlist = null,
    sensitivePatterns = DEFAULT_SENSITIVE_PATTERNS,
    channelForRole = () => channel,
    voiceChannels = ['rtc-voice'],
  } = autoSend;
  const voiceSet = new Set(voiceChannels);

  /** 单轮调度：读快照 → 过滤"待外发授权"事项 → 逐条守卫 → 授权（receipt 三分记录）。
   *  返回 {dispatched, skipped, held:[{questionId,itemId,reason}], stop}。
   *  stop 非空 = A 侧纪律性停止；held = 本轮不外发（排队/转人工），留待下轮或人工。 */
  async function dispatchOnce(sessionId) {
    const snap = await port.snapshot(sessionId);
    if (snap.runStatus !== 'in_progress' || snap.outbound?.paused === true) {
      return { dispatched: 0, skipped: 0, held: [], stop: { code: snap.outbound?.paused === true ? 'OUTBOUND_PAUSED' : 'SESSION_NOT_RUNNING', questionId: null } };
    }
    const generation = Number(snap.outbound.dispatchGeneration);
    const nx = await port.nextActions(sessionId);
    const rows = nx.nextActions ?? [];
    const waiting = rows.filter(
      (a) => typeof a.blockedReason === 'string' && a.blockedReason.startsWith('waiting_dispatch') && a.waitingFor?.questionId,
    );
    // 在途占用表：A 快照 inFlight（authorized/sent/unknown）∪ 本轮新授权。
    // questionId → targetRole 的映射来自本轮 nextActions 全量行（waiting_answer/waiting_participant
    // 行同时携带 questionId 与 targetRole）；映射不到的角色记 null（不占用角色槽，仅可占通话槽）。
    const roleByQuestion = new Map();
    for (const r of rows) {
      const qid = r.waitingFor?.questionId;
      if (typeof qid === 'string' && r.targetRole) roleByQuestion.set(qid, r.targetRole);
    }
    const inFlight = Array.isArray(snap.outbound?.inFlight) ? snap.outbound.inFlight : [];
    const inflightRoles = new Set();
    let voiceOccupied = false;
    const unknownSendQuestions = new Set();
    for (const o of inFlight) {
      if (o?.status === 'unknown' && o.questionId) unknownSendQuestions.add(o.questionId);
      const role = roleByQuestion.get(o?.questionId) ?? null;
      if (role) inflightRoles.add(role);
      const ch = role !== null ? channelForRole(role) : null;
      if (ch === null || voiceSet.has(ch)) voiceOccupied = true; // 通道未知时保守按占通话槽处理
    }

    let dispatched = 0;
    let skipped = 0;
    const held = [];
    for (const action of waiting) {
      const questionId = action.waitingFor.questionId;
      const audience = action.targetRole ?? null;
      const hold = (reason) => held.push({ questionId, itemId: action.itemId, reason });

      // W09：unknown 在途（对账未完成）——绝不换 requestId 重问
      if (unknownSendQuestions.has(questionId)) { hold('SEND_UNKNOWN_RECONCILE'); skipped += 1; continue; }
      // B3.2 敏感守卫：命中即转人工，结构性不可外发
      const text = `${action.title ?? ''}|${action.whyNeeded ?? ''}`;
      if (sensitivePatterns.some((re) => re.test(text))) { hold('SENSITIVE_REQUIRES_HUMAN'); skipped += 1; continue; }
      // B3.2 获准外发：allowlist 配置时未列事项不自动外发（排队留 A，待人批准）
      if (Array.isArray(allowlist) && !allowlist.includes(action.itemKey)) { hold('AUTO_SEND_NOT_APPROVED'); skipped += 1; continue; }
      const ch = audience !== null ? channelForRole(audience) : channel;
      // W07 公共通话单飞：通话通道被占（A 在途 ∪ 本轮）→ 排队不抢话
      if (voiceSet.has(ch) && voiceOccupied) { hold('VOICE_IN_FLIGHT'); skipped += 1; continue; }
      // 角色单飞：同一回答者在途至多一问（不同角色并行不受限）
      if (audience !== null && inflightRoles.has(audience)) { hold('ROLE_IN_FLIGHT'); skipped += 1; continue; }

      // 授权 requestId = 每次调度轮次生成；同轮内恢复重入先查 terminal 回执，已有终态不重复发起
      const requestId = requestIdFactory(sessionId, questionId, generation);
      const prior = await receipts.get(requestId);
      if (prior?.phase === 'terminal') { skipped += 1; continue; }
      await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'intent', sent: null, status: 'granting', channel: ch, audience, at: new Date().toISOString() });
      try {
        const granted = await port.grant(sessionId, { requestId, questionId, generation, channel: ch });
        await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'terminal', sent: true, status: 'authorized', sendId: granted.sendId, channel: ch, audience, at: new Date().toISOString() });
        dispatched += 1;
        if (audience !== null) inflightRoles.add(audience);
        if (voiceSet.has(ch)) voiceOccupied = true;
        logger(`granted ${questionId} (gen=${generation}, ch=${ch}, to=${audience ?? 'n/a'}, send=${granted.sendId})`);
      } catch (error) {
        const code = error?.code ?? 'UNKNOWN';
        await receipts.put({ requestId, runId: sessionId, stepId: questionId, attempt: 1, phase: 'terminal', sent: false, status: code, channel: ch, audience, at: new Date().toISOString() });
        if (STOP_CODES.has(code)) {
          // 纪律性停止：暂停/旧代际/未运行——不绕过、不重试、不换 requestId
          logger(`stop on ${code} at ${questionId}`);
          return { dispatched, skipped, held, stop: { code, questionId } };
        }
        // 非纪律性错误（网络等）：如实记录并继续本轮其余事项（A 未授权该问，不产生副作用）
        logger(`grant error ${code} at ${questionId}`);
        skipped += 1;
      }
    }
    return { dispatched, skipped, held, stop: null };
  }

  return { dispatchOnce };
}
