// V7 backend-next B 模型 transport(GLM 真实接入 + C mock 接入)。
// 2026-09-20 TAKEOFF:real 模式按本文件既有纪律显式配置后可真实出站
// (endpoint/model/apiKey/费率/预算全部显式注入;未配置仍 = not_configured)。
// 本轮硬边界:
//   - 真实 GLM-5.2 只预留配置形态:endpoint/model/apiKey 全部显式注入,不从环境读取
//     任何真实密钥;未配置 = not_configured(确定未发送),绝不静默改走 mock 成功。
//   - mock 模式必须显式 opt-in,且走 C 的独立 loopback 假 API(真实 socket);所有 mock
//     响应强标记 source.mode='mock' + status='simulated',不与真实混写。
//   - 出站允许策略:real 端点必须命中 outboundAllow 列表,否则拒绝(未发送)。
//   - 成本记录:usage/耗时/估算费用落 costLedger(JSONL 追加),不含密钥。
//   - 三分发送语义(不可破坏):
//       未发送(not_configured/cancelled/连接未建立即失败)
//       ≠ 确定失败(对端明确返回 4xx/5xx)
//       ≠ 发送后未知(请求已发出、响应未完整取得:超时/中途断连/主动中止)。
//   - 凭据卫生:apiKey 只在调用时进 Authorization 头;任何错误/日志经 redact 脱敏。
// 本文件无 @langchain 依赖;fetch 用全局(Node 22)。

import { redactText, safeError } from '../redact.mjs';
import { stableJson } from '../graph/decision.mjs';

/** 合成上下文标签:隔离 project/goal/role;C 的跨项目串线探针按此核对。 */
function contextTags({ projectId, goalId, runId, role }) {
  return { projectId: String(projectId), goalId: goalId == null ? null : String(goalId), runId: String(runId), role: String(role) };
}

/**
 * 构造模型请求(最小上下文纪律):
 *   - 只含当前目标标签 + 证据引用三元组 + 角色指令文本;
 *   - 不含仓库路径、聊天历史、其他项目数据(构造上不可能带入);
 *   - text 只含合成/去标识内容。
 * 确定性:同 (runId, stepId, attempt, 捕获输入) → 逐字节同载荷(payloadHash 稳定),
 * 保证恢复重入时回执对账可用。
 */
export function buildModelRequest({ runId, stepId, attempt, role, purpose, projectId, goalId, goalLabel, factVersion, evidenceRefs, generation = 1, contextBrief, routeClass }) {
  // 可选最小上下文(TAKEOFF Edge 助手链):调用方在服务端组装的必要内容摘要;
  // 缺省不传时与旧版逐字节一致(payloadHash 稳定性不受影响)。仍受 maxRequestChars 上限约束。
  const brief = typeof contextBrief === 'string' ? contextBrief.trim() : '';
  const text = [
    `[${goalLabel ?? 'goal'}] 项目 ${projectId}`,
    `证据版本 ${factVersion}。`,
    `请以 ${role} 角色做 ${purpose} 复核:只依据给定证据清单提出观察与问题;`,
    `不输出审批、额度、价格、批准结论(模型意见 authority=none)。`,
  ].join('') + (brief.length > 0 ? `\n${brief}` : '');
  const request = {
    requestId: `${runId}::${stepId}::a${attempt}`,
    projectId,
    sessionId: runId,           // 编排运行即会话;代次/暂停由编排层 checkpoint 管
    generation,
    contextVersion: String(factVersion),
    role, purpose, text,
    contextTags: contextTags({ projectId, goalId, runId, role }),
    evidenceRefs: (evidenceRefs ?? []).map((e) => ({ id: String(e.id), version: String(e.version), hash: String(e.hash) })),
    ...(routeClass ? { routeClass } : {}),
  };
  return { request, payloadHash: stableJson(request) };
}

/**
 * 创建 transport。
 * @param p.mode 'real'|'mock'|undefined(缺省未配置)
 * @param p.real  { endpoint, model, apiKey, timeoutMs?, maxConcurrent?, outboundAllow: [origin] , cost: {per1kInput, per1kOutput, currency} }
 *   apiKey 显式注入;本模块不读取 process.env。
 * @param p.mock  { baseUrl, timeoutMs? }  C 的 loopback 假 API 地址。
 * @param p.costLogPath 成本 JSONL 落盘路径(缺省不落盘,仅内存)。
 */
export function createModelTransport(p = {}) {
  const mode = p.mode; // undefined = 未配置
  if (mode !== undefined && mode !== 'real' && mode !== 'mock') {
    throw new Error('transport.mode 只能是 real|mock|未配置');
  }
  if (mode === 'real' && !p.real?.endpoint) throw new Error('real transport 缺少 endpoint');
  if (mode === 'real' && !p.real?.model) throw new Error('real transport 缺少 model');
  if (mode === 'mock' && !p.mock?.baseUrl) throw new Error('mock transport 缺少 baseUrl(C 假 API 地址)');
  const costLedgerMem = [];
  const costLogPath = p.costLogPath ?? null;
  const thinkingType = p.real?.thinkingType;
  if (thinkingType !== undefined && !['enabled', 'disabled'].includes(thinkingType)) throw new Error('real.thinkingType 必须为enabled或disabled');
  const routeStrategy = p.real?.routing?.strategy;
  const deepseekRouting = routeStrategy === 'deepseek-flash-pro-v1' || routeStrategy === 'deepseek-flash-only-v1';
  if (p.real?.routing && !deepseekRouting) throw new Error('real.routing.strategy 不支持');
  if (deepseekRouting && (new URL(p.real.endpoint).origin !== 'https://api.deepseek.com' ||
      p.real.routing.flashModel !== 'deepseek-flash' ||
      (routeStrategy === 'deepseek-flash-pro-v1' && p.real.routing.proModel !== 'deepseek-v4-pro') ||
      (routeStrategy === 'deepseek-flash-only-v1' && p.real.model !== 'deepseek-flash'))) {
    throw new Error('DeepSeek route endpoint/model 配置非法');
  }
  // D-25 预算上限(05:00 评审重写;mock/real 同一记账面):
  //   budget 段(maxTotalCost/perCallEstimate,须为正有限数,缺一或非法 = 创建即抛错失败关闭)。
  //   账本语义:reserve = 出站前按 perCallEstimate 的保守预占,永久入账不冲销(失败/崩溃也保留,
  //   只会偏高绝不偏低);actual = 完成后真实用量(mock=名义值,real=费率估算或占位),补充不冲销;
  //   预算求和 = 账本全部条目 amount 之和 → 重启不绕过(持久),并发/跨进程不绕过(budget.lock 互斥)。
  //   并发安全 = budget.lock 文件 wx 独占创建做跨进程互斥,临界区内【严格读账→判定→预占】;
  //   任何账本 I/O 错误/坏行/目录路径 → 失败关闭(BUDGET_LEDGER_*),绝不吞 I/O 错误后出站。
  const budget = (() => {
    const b = p.budget;
    if (!b) return null;
    if (b.unlimitedTotalCost !== undefined && typeof b.unlimitedTotalCost !== 'boolean') throw new Error('budget.unlimitedTotalCost 必须为布尔值');
    if (b.unlimitedTotalCost === true && b.maxTotalCost != null) throw new Error('无限累计金额与有限maxTotalCost不能同时配置');
    for (const k of (b.unlimitedTotalCost === true ? ['perCallEstimate'] : ['maxTotalCost', 'perCallEstimate'])) {
      if (typeof b[k] !== 'number' || !Number.isFinite(b[k]) || b[k] <= 0) {
        throw new Error(`budget.${k} 必须为正有限数(收到 ${String(b[k])});预算配置不完整或非法 = 失败关闭`);
      }
    }
    // 任务 03(S3 多粒度预算):可选客户/会话子限额与调用次数上限;非法即抛错失败关闭。
    // 未配置子限额时行为与旧版完全一致(仅全局)。
    for (const k of ['maxCalls', 'maxCallsPerSession']) {
      if (b[k] !== undefined && !(Number.isInteger(b[k]) && b[k] > 0)) {
        throw new Error(`budget.${k} 必须为正整数(收到 ${String(b[k])})`);
      }
    }
    const sub = (v, name) => {
      if (v === undefined) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(`budget.${name} 必须为正有限数(收到 ${String(v)})`);
      }
      return v;
    };
    return {
      maxTotalCost: b.unlimitedTotalCost === true ? null : b.maxTotalCost,
      perCallEstimate: b.perCallEstimate,
      currency: b.currency ?? 'CNY',
      customerMax: sub(b.customer?.maxTotalCost ?? b.customerMax, 'customer.maxTotalCost'),
      sessionMax: sub(b.session?.maxTotalCost ?? b.sessionMax, 'session.maxTotalCost'),
      maxCalls: b.maxCalls ?? null,
      maxCallsPerSession: b.maxCallsPerSession ?? null,
    };
  })();
  const ledgerDir = costLogPath ? costLogPath.replace(/[/\\][^/\\]+$/, '') : null;
  const lockPath = costLogPath ? `${ledgerDir}/budget.lock` : null;

  /** 跨进程互斥:委托 fs-lock.mjs 的 withFileLock（任务02/W13 加固协议：死锁回收=
   *  rename 原子替换+动手前复核+持有期看门狗，绝不 unlink 非本人创建的锁）。
   *  预算侧语义:
   *   - LOCK_TIMEOUT / LOCK_STOLEN → 返回 blocked(调用未发送,失败关闭);
   *     STOLEN 单列 BUDGET_LOCK_LOST(临界区互斥不可证,预算判定作废);
   *   - LOCK_IO → 抛 BUDGET_LEDGER_IO(与账本 I/O 同类,由 budgetGate 兜底失败关闭)。 */
  async function withBudgetLock(fn) {
    const { withFileLock } = await import('../fs-lock.mjs');
    const res = await withFileLock({ lockPath, fn, timeoutMs: 8000, staleMs: 10000, watchdogMs: 500 });
    if (res.ok) return res.value;
    const { code, messageZh } = res.blocked;
    if (code === 'LOCK_IO') throw Object.assign(new Error(messageZh), { code: 'BUDGET_LEDGER_IO' });
    return {
      blocked: {
        code: code === 'LOCK_STOLEN' ? 'BUDGET_LOCK_LOST' : 'BUDGET_LOCK_TIMEOUT',
        messageZh,
      },
    };
  }

  /** 严格读账:ENOENT(新账本)=空表;目录/权限等其他读错误或任何坏行 → 抛错失败关闭,不跳过。 */
  async function ledgerEntriesStrict() {
    const { fs } = await import('../deps.mjs');
    if (!costLogPath) {
      throw Object.assign(new Error('预算已启用但账本路径未配置:失败关闭'), { code: 'BUDGET_LEDGER_UNREADABLE' });
    }
    let text;
    try {
      text = await fs.readFile(costLogPath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return []; // 全新账本
      throw Object.assign(new Error(`账本不可读(${e.code},路径可能是目录或权限不足):失败关闭`), { code: 'BUDGET_LEDGER_UNREADABLE' });
    }
    const entries = [];
    for (const [i, line] of text.split('\n').entries()) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch {
        throw Object.assign(new Error(`账本第 ${i + 1} 行损坏(非 JSON):失败关闭`), { code: 'BUDGET_LEDGER_CORRUPT' });
      }
      if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount < 0) {
        throw Object.assign(new Error(`账本第 ${i + 1} 行损坏(amount 非有限数值):失败关闭`), { code: 'BUDGET_LEDGER_CORRUPT' });
      }
      entries.push(e);
    }
    return entries;
  }

  async function ledgerAppendStrict(entry) {
    const { fs } = await import('../deps.mjs');
    // 不吞错:预占写失败必须失败关闭(调用不出站)
    await fs.appendFile(costLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  /** 出站前预算门(互斥临界区):全局 + 可选客户/会话子限额与调用次数上限;
   *  超限/账本异常/锁超时 → 确定未发送(fail-closed);通过 → 记 reserve(保守预占)。
   *  保守原则:无 scope 标注的旧条目计入所有作用域合计(不因升级放松约束)。
   *  任何错误都以 failed/notSent 结果返回,绝不吞错后出站。 */
  async function budgetGate(request) {
    const requestId = request.requestId;
    if (!budget) return null;
    if (!lockPath) {
      return {
        status: 'failed', sentFlag: false, deduped: false, source: { mode: mode ?? 'none' },
        error: { code: 'BUDGET_LEDGER_UNREADABLE', messageZh: '预算已启用但账本路径未配置:失败关闭,调用未发送' },
      };
    }
    const customerKey = request.contextTags?.projectId ?? null; // 客户/项目隔离键(同项目内共享预算面)
    const sessionKey = request.contextTags?.runId ?? null;
    try {
      const res = await withBudgetLock(async () => {
        const entries = await ledgerEntriesStrict();
        const sumAll = entries.filter((e) => e.type === 'reserve').reduce((a, e) => a + e.amount, 0);
        const sumFor = (scopeField, scopeVal) => entries
          .filter((e) => e.type === 'reserve' && (scopeVal === null || e[scopeField] === undefined || e[scopeField] === scopeVal))
          .reduce((a, e) => a + e.amount, 0);
        const countFor = (scopeField, scopeVal) => entries
          .filter((e) => e.type === 'reserve' && (scopeVal === null || e[scopeField] === undefined || e[scopeField] === scopeVal))
          .length;
        const usedCustomer = sumFor('customerKey', customerKey);
        const usedSession = sumFor('sessionKey', sessionKey);
        if (usedAllCheck(sumAll)) {
          return {
            blocked: {
              code: 'BUDGET_EXCEEDED',
              messageZh: `预算上限失败关闭:全局已入账 ${sumAll} + 本次估算 ${budget.perCallEstimate} > 上限 ${budget.maxTotalCost} ${budget.currency};调用未发送(reserve/actual 语义见 HANDOFF-D §2)`,
            },
          };
        }
        if (budget.customerMax != null && usedCustomer + budget.perCallEstimate > budget.customerMax) {
          return {
            blocked: {
              code: 'BUDGET_CUSTOMER_EXCEEDED',
              messageZh: `客户级预算失败关闭:客户 ${customerKey} 已入账 ${usedCustomer} + 估算 ${budget.perCallEstimate} > 上限 ${budget.customerMax};调用未发送`,
            },
          };
        }
        if (budget.sessionMax != null && usedSession + budget.perCallEstimate > budget.sessionMax) {
          return {
            blocked: {
              code: 'BUDGET_SESSION_EXCEEDED',
              messageZh: `会话级预算失败关闭:会话 ${sessionKey} 已入账 ${usedSession} + 估算 ${budget.perCallEstimate} > 上限 ${budget.sessionMax};调用未发送`,
            },
          };
        }
        if (budget.maxCalls != null && countFor(null, null) + 1 > budget.maxCalls) {
          return {
            blocked: {
              code: 'BUDGET_CALLS_EXCEEDED',
              messageZh: `调用次数上限失败关闭:已 ${countFor(null, null)} 次 + 1 > 上限 ${budget.maxCalls};调用未发送`,
            },
          };
        }
        if (budget.maxCallsPerSession != null && countFor('sessionKey', sessionKey) + 1 > budget.maxCallsPerSession) {
          return {
            blocked: {
              code: 'BUDGET_CALLS_SESSION_EXCEEDED',
              messageZh: `会话调用次数上限失败关闭:已 ${countFor('sessionKey', sessionKey)} 次 + 1 > 上限 ${budget.maxCallsPerSession};调用未发送`,
            },
          };
        }
        await ledgerAppendStrict({
          type: 'reserve', requestId, amount: budget.perCallEstimate, currency: budget.currency,
          customerKey, sessionKey, at: new Date().toISOString(),
        });
        return {};
      });
      if (res?.blocked) {
        return {
          status: 'failed', sentFlag: false, deduped: false, source: { mode: mode ?? 'none' },
          error: { code: res.blocked.code, messageZh: res.blocked.messageZh },
        };
      }
      return null;
    } catch (e) {
      // 临界区内任何账本 I/O/损坏错误:失败关闭,调用不出站(不吞错)
      return {
        status: 'failed', sentFlag: false, deduped: false, source: { mode: mode ?? 'none' },
        error: { code: e.code ?? 'BUDGET_LEDGER_IO', messageZh: `预算账本失败关闭:${e.message}` },
      };
    }
  }

  function usedAllCheck(sumAll) {
    return budget.maxTotalCost !== null && sumAll + budget.perCallEstimate > budget.maxTotalCost;
  }

  async function recordCost(entry) {
    costLedgerMem.push(entry);
    // actual = 观测+超额补记:预算扣减主体是 reserve(已按估算入账);仅当真实用量超过估算
    // (real 费率估算 > perCallEstimate)才补记差额;mock 名义值=估算 → 差额 0,不入账。
    // 记录失败不静默:visible 于 costSnapshot(预算按 reserve 保守扣减,不受影响)。
    try {
      const delta = Math.max(0, (entry.amount ?? 0) - (budget?.perCallEstimate ?? 0));
      // 任务 03:真实账单未知时显式标记 billKnown=false(报告按“未知”呈现,不记为 0 费用)。
      // mock 名义值 / 已注入费率的 real 估算 → billKnown 按来源如实标注。
      const billKnown = entry.mode === 'mock' ? true : entry.cost?.estimated != null;
      await ledgerAppendStrict({ type: 'actual', requestId: entry.requestId, amount: delta, billKnown, at: entry.at });
    } catch (e) {
      costLedgerMem.push({ type: 'actual-unpersisted', requestId: entry.requestId, error: String(e.code ?? e.message) });
    }
  }

  function originOf(url) {
    try { return new URL(url).origin; } catch { return null; }
  }

  /**
   * 出站允许策略:real 模式下 endpoint origin 必须显式在 outboundAllow。
   * 返回 null=允许;否则返回错误结果对象(未发送)。
   */
  function checkOutbound(endpoint) {
    const allow = p.real?.outboundAllow ?? [];
    const origin = originOf(endpoint);
    if (!origin || !allow.includes(origin)) {
      return {
        status: 'failed', sentFlag: false,
        error: { code: 'OUTBOUND_NOT_ALLOWED', messageZh: `出站端点未在允许列表:${redactText(String(endpoint))}(调用未发送)` },
      };
    }
    return null;
  }

  // 任务 03(S3 限额族):请求体大小上限(平台未提供 token 计数时的保守代理;
  // 真实 token 计量属 provider usage 对账,未知时按未知呈现)。超限=确定未发送。
  const maxRequestChars = (() => {
    const v = p.limits?.maxRequestChars ?? p.real?.limits?.maxRequestChars;
    if (v === undefined) return null;
    if (!(Number.isInteger(v) && v > 0)) {
      throw new Error(`limits.maxRequestChars 必须为正整数(收到 ${String(v)})`);
    }
    return v;
  })();

  // TAKEOFF(2026-09-20 真实 GLM 接入):可选输出 token 上限,随 real 请求体 max_tokens 下发,
  // 供费用上限的输出侧硬约束(输入侧由 maxRequestChars 代理)。非法值失败关闭;mock 不下发。
  const maxOutputTokens = (() => {
    const v = p.real?.maxOutputTokens;
    if (v === undefined) return null;
    if (!(Number.isInteger(v) && v > 0)) {
      throw new Error(`real.maxOutputTokens 必须为正整数(收到 ${String(v)})`);
    }
    return v;
  })();
  if (routeStrategy === 'deepseek-flash-pro-v1' && (maxOutputTokens ?? 0) < 2000) {
    throw new Error('DeepSeek Flash/Pro route 需要 real.maxOutputTokens >= 2000（Pro 思考与正式输出共用上限）');
  }
  if (deepseekRouting && p.real.routing.flashMaxOutputTokens !== undefined &&
      (!Number.isInteger(p.real.routing.flashMaxOutputTokens) || p.real.routing.flashMaxOutputTokens < 64 || p.real.routing.flashMaxOutputTokens > 1000)) {
    throw new Error('real.routing.flashMaxOutputTokens 必须为 64..1000');
  }

  /**
   * 单次补全调用(七状态结果,供编排桥接)。
   * @param request buildModelRequest 产物
   */
  async function complete(request) {
    if (maxRequestChars != null && typeof request.text === 'string' && request.text.length > maxRequestChars) {
      return {
        status: 'failed', sentFlag: false, deduped: false, source: { mode: mode ?? 'none' },
        error: { code: 'REQUEST_TOO_LARGE', messageZh: `请求文本 ${request.text.length} 字符超过上限 ${maxRequestChars}:调用未发送(失败关闭)` },
      };
    }
    if (mode === undefined) {
      return {
        status: 'not_configured', sentFlag: false, candidate: null, deduped: false,
        source: { mode: 'none' },
        error: { code: 'PROVIDER_NOT_CONFIGURED', messageZh: '模型服务未配置,调用未发送(not_configured 是如实状态,不静默 mock)' },
      };
    }
    if (mode === 'mock') {
      const gate = await budgetGate(request);
      if (gate) return gate;
      // C mock 接口约定:路径以 /chat/completions 结尾(OpenAI 兼容形状;MOCK_API.md §2)
      return callHttp({ endpoint: `${p.mock.baseUrl.replace(/\/$/, '')}/chat/completions`, apiKey: null, mockMode: true, request });
    }
    // real:出站允许门先于任何网络动作;预算门其次(未发送即失败关闭)
    const blocked = checkOutbound(p.real.endpoint);
    if (blocked) return blocked;
    const gate = await budgetGate(request);
    if (gate) return gate;
    const tier = routeStrategy === 'deepseek-flash-only-v1' || (deepseekRouting && request.routeClass === 'simple') ? 'flash' : 'pro';
    const route = deepseekRouting ? {
      model: tier === 'flash' ? p.real.routing.flashModel : p.real.routing.proModel,
      thinkingType: tier === 'flash' ? 'disabled' : 'enabled',
      jsonObject: tier === 'flash',
      reasoningEffort: tier === 'flash' ? undefined : 'low',
      maxOutputTokens: tier === 'flash' ? (p.real.routing.flashMaxOutputTokens ?? 500) : maxOutputTokens,
    } : null;
    return callHttp({ endpoint: p.real.endpoint, apiKey: p.real.apiKey ?? null, mockMode: false, request, route });
  }

  async function callHttp({ endpoint, apiKey, mockMode, request, route = null }) {
    const timeoutMs = (mockMode ? p.mock?.timeoutMs : p.real?.timeoutMs) ?? 20000;
    const startedAt = Date.now();
    const controller = new AbortController();
    let responseStarted = false; // 是否已收到响应(头)——区分"未送达"与"发送后未知"
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), // 凭据只进请求头
          'x-b-request-id': request.requestId,
          // C mock 隔离/场景锚点(MOCK_API.md §2/§5):x-jw-project 参与 canary 串线探针
          ...(mockMode && p.mock?.scenario ? { 'x-mock-scenario': p.mock.scenario } : {}),
          ...(mockMode && request.contextTags ? { 'x-jw-project': request.contextTags.projectId, 'x-jw-run': request.contextTags.runId } : {}),
        },
        body: JSON.stringify({
          model: mockMode ? (p.mock?.model ?? 'mock-glm-5.2') : (route?.model ?? p.real.model),
          messages: [{ role: 'user', content: request.text }],
          temperature: 0.1,
          ...(!mockMode && route?.jsonObject ? { response_format: { type: 'json_object' } } : {}),
          ...(!mockMode && (route?.thinkingType ?? thinkingType) ? { thinking: { type: route?.thinkingType ?? thinkingType } } : {}),
          ...(!mockMode && route?.reasoningEffort ? { reasoning_effort: route.reasoningEffort } : {}),
          ...(mockMode ? {} : ((route?.maxOutputTokens ?? maxOutputTokens) ? { max_tokens: route?.maxOutputTokens ?? maxOutputTokens } : {})),
          // B 扩展字段:C mock 以 x-jw-* 头承载;real 供应商忽略未知字段由服务端裁决
          b_meta: { requestId: request.requestId, contextTags: request.contextTags, evidenceRefs: request.evidenceRefs, generation: request.generation, contextVersion: request.contextVersion },
        }),
        signal: controller.signal,
      });
      responseStarted = true;
    } catch (e) {
      clearTimeout(timer);
      const causeCode = e?.cause?.code ?? '';
      // 连接未建立即失败(ECONNREFUSED/EHOSTUNREACH/DNS):请求确定未送达 → 确定失败(未发送)
      if (!responseStarted && ['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(causeCode)) {
        return {
          status: 'failed', sentFlag: false, deduped: false,
          source: { mode: mockMode ? 'mock' : 'real' },
          error: { code: 'TRANSPORT_UNREACHABLE', messageZh: `服务不可达,请求未发送:${causeCode}` },
        };
      }
      // 中途主动中止/超时:请求已发出,响应未取得 → 发送后未知(不盲重发)
      const aborted = e?.name === 'AbortError';
      return {
        status: 'unknown', sentFlag: null, deduped: false,
        source: { mode: mockMode ? 'mock' : 'real' },
        error: {
          code: aborted ? 'RESULT_UNKNOWN_TIMEOUT' : 'RESULT_UNKNOWN_INTERRUPTED',
          // Keep only a bounded error code, never network messages, URLs or credentials.
          transportCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(causeCode) ? causeCode : null,
          messageZh: aborted
            ? `等待响应超时(${timeoutMs}ms):请求可能已送达,结果不可知,禁止自动重试`
            : `连接中断:请求可能已送达,结果不可知,禁止自动重试`,
        },
      };
    }
    let rawText = null;
    let bodyReadBroken = false;
    try {
      rawText = await res.text();
    } catch {
      // socket 在 body 中途被切断(partial_response):上游处理状态不可判定 → unknown
      bodyReadBroken = true;
    }
    clearTimeout(timer);
    if (bodyReadBroken) {
      return {
        status: 'unknown', sentFlag: null, deduped: false,
        source: { mode: mockMode ? 'mock' : 'real' },
        error: { code: 'RESULT_UNKNOWN_TRUNCATED', messageZh: '响应体传输中断:结果不可知,禁止自动重试' },
      };
    }
    let body = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      // 连接完整但 body 非 JSON(malformed_response):C 文档 §3——上游已处理,产物损坏,
      // 与 unknown 区分:确定已发送,重试须幂等键(B 不自动重发,人工显式重试走新 attempt)
      return {
        status: 'failed', sentFlag: true, deduped: false,
        source: { mode: mockMode ? 'mock' : 'real' },
        error: { code: 'RESPONSE_CORRUPTED', messageZh: '响应不可解析(上游已处理但产物损坏);不自动重发,需人工核实' },
      };
    }
    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      // [C MOCK_API §3 语义表]
      // 4xx(400/401/413/429)= 请求被拒、未被处理 → 未发送家族(sentFlag=false);
      //   401 invalid_credential → 停止重试,凭据问题人工介入;
      //   429 rate_limited → 退避重试属队列策略,B 默认不自动重试;
      // 5xx = 上游错误,结果倾向失败 → 确定失败(sentFlag=true)。
      const errBody = body && typeof body === 'object' ? body : {};
      const notProcessed = res.status < 500;
      return {
        status: 'failed', sentFlag: !notProcessed, deduped: false,
        source: { mode: mockMode ? 'mock' : 'real', endpointOrigin: originOf(endpoint) },
        error: {
          code: res.status === 429 ? 'RATE_LIMITED' : res.status === 401 ? 'INVALID_CREDENTIAL' : errBody.error ?? `HTTP_${res.status}`,
          messageZh: redactText(`服务返回 ${res.status}:${errBody.message ?? ''}${notProcessed ? '(请求未被处理)' : ''}`),
        },
      };
    }

    // 响应映射:OpenAI chat.completions 形状(real GLM-5.2 与 C mock 同构)
    const mapped = mapCompletionBody(body, request);
    if (!mapped.ok) {
      return {
        status: 'failed', sentFlag: true, deduped: false,
        source: { mode: mockMode ? 'mock' : 'real' },
        error: { code: mapped.code, messageZh: mapped.messageZh, details: mapped.details },
      };
    }

    const usage = body.usage ?? null;
    if (usage) {
      // mock 的记账金额 = perCallEstimate(名义成本,供预算账本累计);real = 费率估算或估算占位
      const cost = mockMode
        ? { currency: budget?.currency ?? 'NONE', estimated: budget?.perCallEstimate ?? 0, notional: true }
        : estimateCost(usage, p.real?.cost);
      await recordCost({
        requestId: request.requestId, at: new Date().toISOString(), durationMs,
        mode: mockMode ? 'mock' : 'real', model: mockMode ? (body.model ?? 'c-mock') : (route?.model ?? p.real.model),
        inputTokens: usage.inputTokens ?? usage.prompt_tokens ?? null,
        outputTokens: usage.outputTokens ?? usage.completion_tokens ?? null,
        cost,
        amount: mockMode ? (budget?.perCallEstimate ?? 0) : (cost.estimated ?? budget?.perCallEstimate ?? 0),
      });
    }

    return {
      status: mockMode ? 'simulated' : 'succeeded',
      sentFlag: true,
      deduped: body.deduped === true,
      source: {
        mode: mockMode ? 'mock' : 'real',
        endpointOrigin: originOf(endpoint),
        model: body.model ?? (mockMode ? 'c-mock' : (route?.model ?? p.real.model)),
        simulationOnly: body.mock?.simulationOnly === true, // C mock 强标记,消费方可见
        canary: body.mock?.canary ?? null,                  // 串线探针锚点
        credentialAnomaly: body.mock?.credentialAnomaly ?? null, // 凭据异常标记(不回显凭据)
      },
      findings: mapped.findings,
      questions: mapped.questions,
      ...(mapped.decisions !== undefined ? { decisions: mapped.decisions } : {}),
      evidenceRefs: (mapped.evidenceRefs ?? request.evidenceRefs ?? []),
      usage,
      costLedger: { reservationState: 'committed' },
    };
  }

  return {
    mode: mode ?? 'not_configured',
    /** transport 配置指纹(不含密钥):供 evidence/审计核对。 */
    configFingerprint() {
      if (mode === 'real') return { mode, endpointOrigin: originOf(p.real.endpoint), model: p.real.model, outboundAllow: [...(p.real.outboundAllow ?? [])] };
      if (mode === 'mock') return { mode, baseUrl: p.mock.baseUrl };
      return { mode: 'not_configured' };
    },
    complete,
    /** 成本流水读取(内存;含已落盘条数)。 */
    costSnapshot() { return [...costLedgerMem]; },
  };
}

/** usage → 估算成本(费率未注入 = null,不猜价格)。 */
function estimateCost(usage, cost) {
  if (!cost || typeof cost.per1kInput !== 'number' || typeof cost.per1kOutput !== 'number') {
    return { currency: cost?.currency ?? null, estimated: null, note: '费率未注入,不估算' };
  }
  const inTok = Number(usage.inputTokens ?? usage.prompt_tokens ?? 0);
  const outTok = Number(usage.outputTokens ?? usage.completion_tokens ?? 0);
  return {
    currency: cost.currency ?? 'CNY',
    estimated: Number(((inTok / 1000) * cost.per1kInput + (outTok / 1000) * cost.per1kOutput).toFixed(6)),
  };
}

/**
 * OpenAI chat.completions 响应体 → B 内部 findings/questions(七状态)。
 * content 解析:JSON 对象(C MOCK_RESPOND_JSON 脚本化响应)→ {observations|findings,
 * questions, evidenceRefs};纯文本 → 单条观察。空内容/缺 choices → 违规(人工处理)。
 */
export function mapCompletionBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'MALFORMED_OUTPUT', messageZh: '响应不是 JSON 对象,需人工处理' };
  }
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0]?.message || typeof choices[0].message.content !== 'string') {
    return { ok: false, code: 'MALFORMED_OUTPUT', messageZh: '缺少 choices[0].message.content,需人工处理' };
  }
  const content = choices[0].message.content.trim();
  let findings = [];
  let questions = [];
  let evidenceRefs;
  let parsed = null;
  // Accept one enclosing JSON fence; never extract arbitrary embedded prose/code.
  const fenced = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  try { parsed = JSON.parse(fenced ? fenced[1] : content); } catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obs = parsed.observations ?? parsed.findings ?? [];
    const qs = parsed.questions ?? parsed.uncertainty ?? [];
    if (!Array.isArray(obs) || !Array.isArray(qs)) {
      return { ok: false, code: 'MALFORMED_OUTPUT', messageZh: '结构化内容 observations/questions 不是数组,需人工处理' };
    }
    findings = obs.map((t) => ({ text: typeof t === 'string' ? t : String(t?.text ?? ''),
      ...(Array.isArray(t?.evidenceRefIds) ? { evidenceRefIds: t.evidenceRefIds.filter(id => typeof id === 'string') } : {}) })).filter((f) => f.text.length > 0);
    questions = qs.map((t) => ({ text: typeof t === 'string' ? t : String(t?.text ?? '') })).filter((f) => f.text.length > 0);
    evidenceRefs = Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs : undefined;
  } else if (content.length > 0) {
    findings = [{ text: content }];
  }
  if (findings.length === 0 && questions.length === 0 && !Array.isArray(parsed?.decisions)) {
    return { ok: false, code: 'EMPTY_OUTPUT', messageZh: '响应既无观察也无问题,需人工处理' };
  }
  return { ok: true, findings, questions, evidenceRefs, ...(Array.isArray(parsed?.decisions) ? { decisions: parsed.decisions } : {}) };
}

export { safeError };
