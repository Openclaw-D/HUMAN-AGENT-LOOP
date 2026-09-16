// 内核事件存储（任务三 C2）：把 Back/A 真实内核投影为 Edge 工作台快照 + SSE 事件流。
// 语义与 fixture store（./store.mjs）一致：至少一次投递、eventId 游标补取、游标失效显式 resync；
// 差别是数据全部来自 A 内核（租户越权/角色拒绝由 A 每请求裁决，Edge 不缓存授权结论）。
// 消费面契约见 ../contract/consumed-surface-v1.json；上游漂移时本 store 抛 upstream 错误，
// server 层把状态码/错误码原样回传客户端——不掩盖、不降级伪装。
//
// 一致性边界（C04）：workspace 携带的 eventCursor ≤ 拉取时已见 head；订阅以 after=游标 起步
// 先补历史缓冲再收实时（客户端按 eventId 去重，重复不致命、缺口不允许）。Edge 进程重启后
// 内存缓冲清空 → 旧游标 replayFrom 判 expired → 客户端 resync 重取快照（绝不静默续播）。

const MAX_ENVELOPES = 4000;      // 每客户保留窗口；裁剪后旧游标 → resync
const MAX_DETAIL_REFS = 20;      // 快照回查的评估/申请条数上限（防历史膨胀拖垮快照）
const MAX_POLL_PAGES = 20;       // 单次补取最多页数（500/页）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createKernelStore({
  baseUrl,
  fetchImpl = fetch,
  pollIntervalMs = 600,   // 跨客户端可见性预算（任务书 p95≤1s）：轮询间隔 600ms + A 查询 ≈ 目标内
  upstreamTimeoutMs = 5000,
  log = () => { },
}) {
  const root = baseUrl.replace(/\/$/, '');
  const customers = new Map(); // customerId -> { envelopes:[], byId:Map, lastSeq, subs:Set<cb>, eventsBlocked:reason|null }

  const bucket = (customerId) => {
    let b = customers.get(customerId);
    if (!b) {
      b = { envelopes: [], byId: new Map(), lastSeq: 0, subs: new Set(), eventsBlocked: null };
      customers.set(customerId, b);
    }
    return b;
  };

  // ---- 上游访问：只放行服务端持有的凭据；错误带上游状态/码供 server 透传 ----
  async function kernelFetch(credential, path) {
    let res;
    try {
      res = await fetchImpl(root + path, {
        method: 'GET',
        headers: { 'x-principal-credential': credential },
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? `timeout ${upstreamTimeoutMs}ms` : String(e.cause?.code || e.message);
      const err = new Error(`内核不可达：${reason}`);
      err.upstream = { status: 502, code: 'UPSTREAM_UNAVAILABLE', reason };
      throw err;
    }
    let payload = null;
    try { payload = await res.json(); } catch { /* 非 JSON 按空处理 */ }
    if (res.status === 200 && payload && payload.ok === true) return payload;
    const err = new Error((payload && payload.message) || `内核响应 ${res.status}`);
    err.upstream = { status: res.status, code: (payload && payload.error) || 'UPSTREAM_ERROR' };
    throw err;
  }

  function toEnvelope(aev) {
    return {
      eventId: aev.eventId,
      scope: { tenant: 'kernel', customer: aev.customerId },
      // A 返回 bigint seq 以字符串承载（pg 驱动行为）——统一转数字，游标水位才能单调推进
      aggregateVersion: Number(aev.seq),
      schemaVersion: 'jw.event.v1',
      occurredAt: aev.at,
      payloadRef: { type: aev.eventType, seq: Number(aev.seq) },
      payload: aev.payload,
    };
  }

  // 补取上游事件进缓冲；新事件推给当前所有订阅者。幂等（eventId 去重），可并发调用。
  // 服务端按角色限制事件读取（如 customer 角色 403，A 侧 B13 语义）时：不炸快照，
  // 记录 eventsBlocked 供投影如实标注——权限分发以服务端裁决为准，Edge 不绕道。
  async function pullEvents(customerId, credential) {
    const b = bucket(customerId);
    for (let page = 0; page < MAX_POLL_PAGES; page++) {
      let res;
      try {
        res = await kernelFetch(credential, `/api/v2/customers/${encodeURIComponent(customerId)}/events?after=${b.lastSeq}&limit=500`);
      } catch (e) {
        if (e.upstream && e.upstream.status === 403) {
          if (b.eventsBlocked === null) log(`[kernel-store] 事件读取被服务端拒绝 customer=${customerId}（角色受限，如实标注）`);
          b.eventsBlocked = e.upstream.code;
          return e.upstream.code;
        }
        throw e;
      }
      b.eventsBlocked = null;
      const events = Array.isArray(res.events) ? res.events : [];
      if (events.length === 0) return null;
      for (const aev of events) {
        if (!aev || typeof aev.eventId !== 'string' || b.byId.has(aev.eventId)) continue;
        const env = toEnvelope(aev);
        b.envelopes.push(env);
        b.byId.set(env.eventId, env);
        const seq = Number(aev.seq);
        if (Number.isFinite(seq) && seq > b.lastSeq) b.lastSeq = seq;
        for (const cb of b.subs) {
          try { cb(env); } catch { /* 订阅者异常不影响存储 */ }
        }
      }
      if (events.length < 500) break;
    }
    if (b.envelopes.length > MAX_ENVELOPES) {
      const removed = b.envelopes.splice(0, b.envelopes.length - MAX_ENVELOPES / 2);
      for (const e of removed) b.byId.delete(e.eventId);
    }
  }

  // ---- openItems：只回显服务端状态推导"需要谁行动"，不发明结论 ----
  function deriveOpenItems(snapshot) {
    const items = [];
    for (const a of snapshot.assessments ?? []) {
      if (a.status === 'awaiting_human_review') {
        items.push({ kind: 'assessment_awaiting_review', ref: a.assessmentId, needRole: 'credit', detail: '评估待人工复核（批准/拒绝走额度命令通道）' });
      }
      if (a.stale === true) {
        items.push({ kind: 'assessment_stale', ref: a.assessmentId, needRole: 'credit', detail: '依据已失效（证据取代），须重新评估' });
      }
    }
    for (const f of snapshot.facilities ?? []) {
      if (Array.isArray(f.staleBlockers) && f.staleBlockers.length > 0) {
        items.push({ kind: 'facility_blocker', ref: f.facilityId, needRole: 'credit', blockers: f.staleBlockers, detail: '额度存在阻断位（状态/超限/依据失效）' });
      }
    }
    for (const fr of snapshot.financingRequests ?? []) {
      if (fr.status === 'reserved') {
        items.push({ kind: 'reservation_open', ref: fr.frId, needRole: 'business', detail: `用信预占中${fr.externalState && fr.externalState !== 'none' ? `（外部状态 ${fr.externalState}）` : ''}` });
      }
      if (fr.externalState === 'sent' || fr.externalState === 'unknown') {
        items.push({ kind: 'external_reconcile', ref: fr.frId, needRole: 'credit', detail: '外部结果未知：须对账确认（confirm-external），不可盲重发' });
      }
    }
    return items;
  }

  // 从事件缓冲索引详情引用（最新 INSPECTION_CREATED 的 sessionId 等）
  function collectRefs(b) {
    const assessmentIds = [];
    const frIds = [];
    let sessionId = null;
    for (const env of b.envelopes) {
      const t = env.payloadRef?.type;
      const p = env.payload || {};
      if (p.assessmentId && !assessmentIds.includes(p.assessmentId)) assessmentIds.push(p.assessmentId);
      if (p.frId && !frIds.includes(p.frId)) frIds.push(p.frId);
      if (t === 'INSPECTION_CREATED' && p.sessionId) sessionId = p.sessionId; // 事件序 → 最后一个即最新
    }
    return { assessmentIds: assessmentIds.slice(-MAX_DETAIL_REFS), frIds: frIds.slice(-MAX_DETAIL_REFS), sessionId };
  }

  async function getWorkspace(customerId, opts = {}) {
    const credential = opts.credential;
    if (typeof credential !== 'string' || credential.length === 0) {
      const err = new Error('live 模式 workspace 需要会话');
      err.noCredential = true;
      throw err;
    }
    const enc = encodeURIComponent(customerId);
    const cust = await kernelFetch(credential, `/api/v2/customers/${enc}`);
    const blockedCode = await pullEvents(customerId, credential);
    const b = bucket(customerId);
    const exposure = await kernelFetch(credential, `/api/v2/customers/${enc}/exposure`);
    const refs = collectRefs(b);

    const notes = [];
    if (blockedCode) notes.push(`事件流对本会话受限（服务端 ${blockedCode}）：快照可见，实时事件不投递`);
    const settle = async (label, path) => {
      try {
        const r = await kernelFetch(credential, path);
        return r.assessment ?? r.financingRequest ?? r.snapshot ?? null;
      } catch (e) {
        notes.push(`${label} 回查失败：${e.upstream?.code || e.message}`);
        return null;
      }
    };
    const assessments = (await Promise.all(refs.assessmentIds.map((id) => settle(`评估 ${id}`, `/api/v2/assessments/${encodeURIComponent(id)}`)))).filter(Boolean);
    const financingRequests = (await Promise.all(refs.frIds.map((id) => settle(`申请 ${id}`, `/api/v2/financing-requests/${encodeURIComponent(id)}`)))).filter(Boolean);

    let session = null;
    if (refs.sessionId) {
      try {
        const r = await kernelFetch(credential, `/api/v1/inspections/${encodeURIComponent(refs.sessionId)}`);
        session = r.snapshot ?? null;
      } catch (e) {
        notes.push(`检查会话快照不可用：${e.upstream?.code || e.message}`);
      }
    }

    const snapshot = {
      customer: cust.customer,
      facilities: exposure.facilities ?? [],
      totalsMinor: exposure.totalsMinor ?? null,
      financingRequests,
      assessments,
      session,
      openItems: [],
    };
    snapshot.openItems = deriveOpenItems(snapshot);
    const last = b.envelopes[b.envelopes.length - 1] || null;
    return {
      customerId,
      snapshot,
      snapshotVersion: b.lastSeq,
      eventCursor: last ? last.eventId : null,
      source: 'kernel',
      projection: { notes, at: new Date().toISOString() },
    };
  }

  function replayFrom(customerId, afterEventId) {
    const b = customers.get(customerId);
    if (!b) return { events: [] };
    if (afterEventId == null) return { events: [] };
    const idx = b.envelopes.findIndex((e) => e.eventId === afterEventId);
    if (idx === -1) return { expired: true, reason: 'cursor_unknown_or_edge_restarted' };
    return { events: b.envelopes.slice(idx + 1).map((e) => e) };
  }

  // 订阅：注册回调 + 以调用方凭据起独立补取循环。after 指定"客户端将恢复的游标"
  //（或 workspace 基线游标）：先补缓冲中该游标之后的事件再收实时，杜绝注册窗口缺口；
  // 客户端按 eventId 去重，重复投递安全。
  function subscribe(customerId, cb, opts = {}) {
    const b = bucket(customerId);
    b.subs.add(cb);
    const credential = opts.credential;
    let dead = false;
    const safe = (env) => { try { cb(env); } catch { } };
    const kick = (async () => {
      if (typeof credential !== 'string' || credential.length === 0) return;
      try { await pullEvents(customerId, credential); } catch (e) { log(`[kernel-store] 首轮补取失败 customer=${customerId}: ${e.upstream?.code || e.message}`); }
      if (dead || opts.after == null) return;
      const r = replayFrom(customerId, opts.after);
      if (!r.expired) for (const env of r.events) safe(env);
    })();
    const timer = setInterval(() => {
      if (dead) return;
      pullEvents(customerId, credential).catch((e) => {
        log(`[kernel-store] 轮询失败 customer=${customerId}: ${e.upstream?.code || e.message}（保流不断，readiness 反映内核状态）`);
      });
    }, pollIntervalMs);
    return () => {
      dead = true;
      clearInterval(timer);
      b.subs.delete(cb);
    };
  }

  return {
    mode: 'kernel',
    getWorkspace,
    replayFrom,
    subscribe,
    _stats: (customerId) => {
      const b = customers.get(customerId);
      return b ? { envelopes: b.envelopes.length, lastSeq: b.lastSeq, subs: b.subs.size } : null;
    },
  };
}
