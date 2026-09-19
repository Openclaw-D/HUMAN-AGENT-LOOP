// 内核事件存储（任务03 C1 授权修复版）：把 Back/A 真实内核投影为 Edge 工作台快照 + SSE 事件流。
//
// C1.1 授权边界：事件缓冲/订阅/回放一律按 (customerId, principalId, 凭据指纹) 分桶——
//   缓存键与回放边界包含授权上下文，绝不按 customerId 共用缓冲后广播给所有订阅者。
//   每个桶只用自己的凭据向 A 拉事件（A 每请求按租户/角色过滤），分发只到同桶订阅者；
//   A 仍是唯一授权裁决方，Edge 不缓存授权结论。
// C1.2 撤权断流：本桶凭据遇上游 401/403 → 通知 onAuthFail（server 发 auth 帧后终止该 SSE），
//   桶随之销毁；绝不因另一身份仍有权限而继续向旧连接发事件。
// C1.3 快照权威性：customer/exposure/decision-status/findings/object-inventory 全部来自内核
//   权威查询；assessments/financing-requests 因 A 尚无按客户列表端点，仅以事件缓冲提供
//   refs（显式 refsSource='event_buffer'、exhaustive:false，不做"全部当前对象"暗示；
//   权威列表端点需求已提交任务01）。大历史走 pageEvents 分页，不因缓冲窗口悄悄消失。
// C1.4 提交顺序：A outbox 的 seq 是分配号不是提交序——每轮补取从 max(0, lastSeq-RECHECK)
//   重查（eventId 去重），反序提交的事件在窗口内被补齐并按 seq 有序插入；窗口内仍缺号时
//   在 projection 中如实标注 gap。残余风险：晚于窗口提交的极端反序仍需 A 侧提交序修复。
// C1.5 精度与背压：seq 以字符串/BigInt 承载（不无条件 Number 转换，>2^53 不失真）；
//   单桶缓冲上限、单轮补取页数上限，慢客户端由 server 层 writableLength 上限处理。
//
// goal-03 C1 增量（backend-upgrade 轮）：
//   - 明细缓存（桶内）：assessments/financing-requests 明细按 id 缓存于本身份桶；失效=本桶新事件
//     引用该 id（立即）或 TTL（默认 60s，JW_EDGE_DETAIL_CACHE_MS 可调，0=关 TTL）。客户主体/敞口/
//     决策面/清单/会话不缓存、每请求直查权威端点。命中在 projection.freshness 以 cached:true 如实标注。
//   - 同请求合并：同 (客户×身份×凭据) 的在途 getWorkspace 共享同一 Promise；只在途、不跨授权/版本。
//   - 查询计数：kernelFetch 按 snapshot/events/detail/other 计数（_qCounters/_resetQCounters），
//     供"每 workspace 读取的 A 查询数"口径与测试断言。
//
// 一致性边界（C04）：workspace 携带的 eventCursor ≤ 拉取时已见 head；订阅以 after=游标 起步
// 先补历史缓冲再收实时（客户端按 eventId 去重，重复不致命、缺口不允许）。Edge 进程重启后
// 内存缓冲清空 → 旧游标 replayFrom 判 expired → 客户端 resync 重取快照（绝不静默续播）。
// 消费面契约见 ../contract/consumed-surface-v1.json；上游漂移时本 store 抛 upstream 错误，
// server 层把状态码/错误码原样回传客户端——不掩盖、不降级伪装。

import { createHash, randomUUID } from 'node:crypto';

const MAX_ENVELOPES = 4000;      // 每身份桶保留窗口；裁剪后旧游标 → resync
const MAX_DETAIL_REFS = 20;      // 快照回查的评估/申请条数上限（防历史膨胀拖垮快照）
const MAX_POLL_PAGES = 20;       // 单次补取最多页数（500/页）
const MAX_LIST_ITEMS = 50;       // findings / object-inventory 快照内上限（超出以 truncated 标注）
const SEQ_RECHECK_WINDOW = 128n; // 提交滞后重查窗口（见头部 C1.4）
// goal-03 C1：评估/申请明细的桶内缓存 TTL。0=禁用 TTL（事件失效仍生效）。环境变量可调（回退开关）。
const DETAIL_CACHE_TTL_MS = Math.max(0, Number(process.env.JW_EDGE_DETAIL_CACHE_MS ?? 60_000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function credFingerprint(credential) {
  return createHash('sha256').update(String(credential)).digest('hex').slice(0, 10);
}

export function createKernelStore({
  baseUrl,
  fetchImpl = fetch,
  pollIntervalMs = 600,   // 跨客户端可见性预算（任务书 p95≤1s）：轮询间隔 600ms + A 查询 ≈ 目标内
  upstreamTimeoutMs = 5000,
  log = () => { },
}) {
  const root = baseUrl.replace(/\/$/, '');
  // 授权上下文分桶：key = `${customerId}|${principalId}|${credFingerprint}`（C1.1）
  const buckets = new Map();
  // goal-03 C1：上游查询计数（供性能口径与测试断言；不含探测/写面，仅 kernelFetch 读路径）
  const qCounters = { total: 0, snapshot: 0, events: 0, detail: 0, other: 0 };
  // goal-03 C1：同 (桶) 的进行中 getWorkspace 合并（同权限同查询共享同一在途请求；不跨授权/版本）
  const inFlightWs = new Map();

  const bucketKey = (customerId, ctx = {}) =>
    `${customerId}|${ctx.principalId ?? 'unknown'}|${typeof ctx.credential === 'string' && ctx.credential.length > 0 ? credFingerprint(ctx.credential) : 'nocred'}`;

  const bucketOf = (customerId, ctx) => {
    const key = bucketKey(customerId, ctx);
    let b = buckets.get(key);
    if (!b) {
      b = {
        key, customerId, principalId: ctx.principalId ?? null, credential: ctx.credential,
        envelopes: [], byId: new Map(), lastSeq: 0n, subs: new Set(),
        eventsBlocked: null, authDead: null, gap: false, timer: null, pulling: false,
        detailCache: new Map(), // goal-03 C1：id → { kind, data, fetchedAtMs }；事件引用该 id 或 TTL 过期即失效
      };
      buckets.set(key, b);
    }
    return b;
  };

  // ---- 上游访问：只放行服务端持有的凭据；错误带上游状态/码供 server 透传 ----
  async function kernelFetch(credential, path) {
    qCounters.total += 1;
    if (path.includes('/events?')) qCounters.events += 1;
    else if (path.includes('/api/v2/assessments/') || path.includes('/api/v2/financing-requests/')) qCounters.detail += 1;
    else if (path.includes('/api/v2/customers/')) qCounters.snapshot += 1;
    else qCounters.other += 1;
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

  // seq 校验与比较：字符串承载、BigInt 比较（C1.5，不做无条件 Number 转换）
  function seqOf(aev) {
    const s = aev && aev.seq !== undefined && aev.seq !== null ? String(aev.seq) : '';
    if (!/^\d+$/.test(s)) return null;
    return BigInt(s);
  }

  function toEnvelope(aev) {
    return {
      eventId: aev.eventId,
      scope: { tenant: 'kernel', customer: aev.customerId },
      // A 返回 bigint seq 以字符串承载（pg 驱动行为）——保持字符串，游标水位以 BigInt 比较
      aggregateVersion: String(aev.seq),
      schemaVersion: 'jw.event.v1',
      occurredAt: aev.at,
      payloadRef: { type: aev.eventType, seq: String(aev.seq) },
      payload: aev.payload,
    };
  }

  // 按 seq 有序插入（反序提交/重查窗口补齐的事件回到正确位置）
  function insertSorted(b, env, seq) {
    let lo = 0, hi = b.envelopes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (BigInt(b.envelopes[mid].aggregateVersion) < seq) lo = mid + 1; else hi = mid;
    }
    b.envelopes.splice(lo, 0, env);
    b.byId.set(env.eventId, env);
  }

  // 缓冲窗口内是否有缺号（如 3,4,6 → 缺 5：可能仍在别的提交中，重查窗口会补）
  function recomputeGap(b) {
    if (b.envelopes.length === 0) { b.gap = false; return; }
    const min = BigInt(b.envelopes[0].aggregateVersion);
    const max = BigInt(b.envelopes[b.envelopes.length - 1].aggregateVersion);
    b.gap = max - min + 1n > BigInt(b.envelopes.length);
  }

  // 补取上游事件进本桶缓冲；新事件只分发给本桶订阅者。幂等（eventId 去重），可并发调用。
  // 返回：null=已到头；'auth'=凭据被拒（桶已通知并销毁）；其余错误抛出。
  async function pullEvents(b) {
    if (b.pulling) return null;
    b.pulling = true;
    try {
      for (let page = 0; page < MAX_POLL_PAGES; page++) {
        const recheckFrom = b.lastSeq > SEQ_RECHECK_WINDOW ? b.lastSeq - SEQ_RECHECK_WINDOW : 0n;
        let res;
        try {
          res = await kernelFetch(b.credential, `/api/v2/customers/${encodeURIComponent(b.customerId)}/events?after=${recheckFrom}&limit=500`);
        } catch (e) {
          if (e.upstream && (e.upstream.status === 401 || e.upstream.status === 403)) {
            killBucket(b, e.upstream.code);
            return 'auth';
          }
          // goal-03 C1.2 补强：A 对越权/撤权统一 404（不泄露存在性）。对本桶"曾成功读过"的客户，
          // 轮询中出现的 404 是撤权（或客户删除）信号——同样断流销桶，不给旧订阅静默失联。
          if (e.upstream && e.upstream.status === 404 && (b.envelopes.length > 0 || b.lastSeq > 0n)) {
            killBucket(b, 'CUSTOMER_ACCESS_REVOKED');
            return 'auth';
          }
          throw e;
        }
        b.eventsBlocked = null;
        const events = Array.isArray(res.events) ? res.events : [];
        const fresh = [];
        for (const aev of events) {
          const seq = seqOf(aev);
          if (!aev || typeof aev.eventId !== 'string' || seq === null || b.byId.has(aev.eventId)) continue;
          const env = toEnvelope(aev);
          insertSorted(b, env, seq);
          if (seq > b.lastSeq) b.lastSeq = seq;
          fresh.push(env);
        }
        // goal-03 C1 失效钩子：新事件引用某评估/申请 id → 该明细缓存条目立即失效（权威重取）。
        if (b.detailCache.size > 0) {
          for (const env of fresh) {
            const p = env.payload || {};
            if (p.assessmentId) b.detailCache.delete(`ass:${p.assessmentId}`);
            if (p.frId) b.detailCache.delete(`fr:${p.frId}`);
          }
        }
        // 新事件只投给本桶订阅者（同凭据授权上下文，C1.1）；重复事件不重投
        for (const env of fresh) {
          for (const sub of b.subs) {
            try { sub.cb(env); } catch { /* 订阅者异常不影响存储 */ }
          }
        }
        recomputeGap(b);
        if (b.envelopes.length > MAX_ENVELOPES) {
          const removed = b.envelopes.splice(0, b.envelopes.length - MAX_ENVELOPES / 2);
          for (const e of removed) b.byId.delete(e.eventId);
          recomputeGap(b);
        }
        if (events.length < 500) return null; // 本轮已到头
        // 防死循环由三重保证：本行 <500 退出 + byId eventId 去重 + MAX_POLL_PAGES 页上限
        // （增量复核 P2 整改：删除未声明的 maxSeqThisPull 判断——满页全重复时必抛 ReferenceError）
      }
      return null;
    } finally {
      b.pulling = false;
    }
  }

  // 撤权/过期：通知订阅者并销毁桶（C1.2——订阅终止，不留活口）
  function killBucket(b, code) {
    if (b.authDead) return;
    b.authDead = code;
    if (b.timer) { clearInterval(b.timer); b.timer = null; }
    for (const sub of [...b.subs]) {
      try { sub.onAuthFail?.(code); } catch { /* 通知失败不阻断销毁 */ }
    }
    b.subs.clear();
    buckets.delete(b.key);
    log(`[kernel-store] 授权失效，订阅终止 customer=${b.customerId} principal=${b.principalId} code=${code}`);
  }

  // 从事件缓冲索引详情引用（最新 INSPECTION_CREATED 的 sessionId 等）。
  // 注意：这是"本身份桶可见事件的引用"，不是全量当前对象清单（C1.3，A 缺列表端点）。
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
    // goal-03 C1 合并：同 (客户×身份×凭据) 的进行中 workspace 请求共享同一 Promise（重订风暴/多面板
    // 并发刷新不放大上游查询）。合并只在"在途"窗口内——不跨授权上下文、不做结果级缓存（版本时点各取）。
    const ctx = { credential: opts.credential, principalId: opts.principalId };
    if (typeof ctx.credential !== 'string' || ctx.credential.length === 0) return runWorkspace(customerId, opts);
    const key = bucketKey(customerId, ctx);
    const prior = inFlightWs.get(key);
    if (prior) return prior;
    const p = runWorkspace(customerId, opts).finally(() => { inFlightWs.delete(key); });
    inFlightWs.set(key, p);
    return p;
  }

  async function runWorkspace(customerId, opts = {}) {
    const ctx = { credential: opts.credential, principalId: opts.principalId };
    if (typeof ctx.credential !== 'string' || ctx.credential.length === 0) {
      const err = new Error('live 模式 workspace 需要会话');
      err.noCredential = true;
      throw err;
    }
    const enc = encodeURIComponent(customerId);
    const notes = [];
    const freshness = {}; // C1.6：逐组件独立报告，不设 all_ok
    const settle = async (label, path, pick) => {
      try {
        const r = await kernelFetch(ctx.credential, path);
        freshness[label] = { ok: true, at: new Date().toISOString() };
        return pick ? pick(r) : (r.assessment ?? r.financingRequest ?? r.snapshot ?? null);
      } catch (e) {
        freshness[label] = { ok: false, at: new Date().toISOString(), code: e.upstream?.code || e.message };
        notes.push(`${label} 查询失败：${e.upstream?.code || e.message}`);
        return null;
      }
    };

    // 客户主读取不走 settle（T7 修复）：不存在/越权（404）必须原样透传给调用方——
    // 存在性不泄露语义（A10）与 consumed-surface"404 原样透传"契约依赖此行为；
    // 其余辅助查询（exposure/决策面/明细回查）保留 best-effort + freshness.notes。
    let cust = null;
    try {
      const r = await kernelFetch(ctx.credential, `/api/v2/customers/${enc}`);
      cust = r.customer ?? null;
      freshness.customer = { ok: true, at: new Date().toISOString() };
    } catch (e) {
      throw e; // 含 upstream 404/403/502 —— server 层按 T7 前契约原样透传
    }
    // T7 修复补记：settle 无 pick 时默认键（assessment/financingRequest/snapshot）不含 exposure
    // 的响应字段——必须显式 pick，否则恒 null（E1 已拦）。
    const exposure = await settle('exposure', `/api/v2/customers/${enc}/exposure`, (r) => ({ facilities: r.facilities ?? [], totalsMinor: r.totalsMinor ?? null }));
    // 权威决策状态/复核队列/对象清单（任务02 决策闭环 + B14 桥接面）
    const decisionStatus = await settle('decisionStatus', `/api/v2/customers/${enc}/decision-status`, (r) => ({
      basis: r.basis ?? null, facilityTotalsMinor: r.facilityTotalsMinor ?? null,
      reviewQueue: r.reviewQueue ?? [], reportRefs: r.reportRefs ?? [],
    }));
    const findingsRes = await settle('findings', `/api/v2/customers/${enc}/findings`, (r) => r);
    const findingsAll = Array.isArray(findingsRes?.findings) ? findingsRes.findings : [];
    const findings = findingsAll.slice(0, MAX_LIST_ITEMS);
    const inventoryRes = await settle('objectInventory', `/api/v2/customers/${enc}/object-inventory`, (r) => r);
    const objectInventoryAll = Array.isArray(inventoryRes?.objects) ? inventoryRes.objects
      : Array.isArray(inventoryRes?.inventory) ? inventoryRes.inventory : [];
    const objectInventory = objectInventoryAll.slice(0, MAX_LIST_ITEMS);

    // 事件桶：本身份自己的缓冲（不读他人桶）
    const b = bucketOf(customerId, ctx);
    let eventsState = null;
    try {
      const r = await pullEvents(b);
      if (r === 'auth') {
        // 增量复核 P3 整改：此处 throw 会落在自身 try/catch 被吞（死代码）——
        // 改为直接置状态并如实 note（快照以权威查询为准，不伪装成功）。
        eventsState = { ok: false, code: 'EVENTS_UNAUTHORIZED' };
        notes.push('事件流对本会话关闭（凭据被拒/角色受限）：快照以权威查询为准');
      } else {
        eventsState = { ok: true };
      }
    } catch (e) {
      eventsState = { ok: false, code: e.upstream?.code || e.message };
      notes.push(`事件补取失败：${e.upstream?.code || e.message}`);
    }
    freshness.events = {
      ok: eventsState?.ok === true, at: new Date().toISOString(),
      blocked: b.eventsBlocked, gap: b.gap, buffered: b.envelopes.length, lastSeq: b.lastSeq.toString(),
    };
    if (b.eventsBlocked) notes.push(`事件流对本会话受限（服务端 ${b.eventsBlocked}）：快照可见，实时事件不投递`);
    if (b.gap) notes.push('事件窗口内检测到缺号（疑似反序提交中）：重查窗口将自动补齐，快照以权威查询为准');

    const refs = collectRefs(b);
    // goal-03 C1 明细缓存：命中（未被事件失效且未过 TTL）→ 不打上游；freshness 如实标 cached。
    // 缓存只存"本身份桶"内、只用于未变明细；客户主体/敞口/决策面/清单/会话每请求必直查（§1.5）。
    const cachedDetail = async (cacheKey, id, label, pathPrefix) => {
      const hit = b.detailCache.get(cacheKey);
      const ttlOk = DETAIL_CACHE_TTL_MS === 0 || !hit || (Date.now() - hit.fetchedAtMs) < DETAIL_CACHE_TTL_MS;
      if (hit && ttlOk) {
        freshness[label] = { ok: true, at: new Date(hit.fetchedAtMs).toISOString(), cached: true };
        return hit.data;
      }
      const data = await settle(label, `${pathPrefix}/${encodeURIComponent(id)}`);
      if (data !== null && freshness[label]?.ok) {
        b.detailCache.set(cacheKey, { kind: cacheKey.split(':')[0], data, fetchedAtMs: Date.now() });
      }
      return data;
    };
    // 任务04 问题8（IR-03-A② 落地）：评估/融资申请改消费任务三权威清单（CONTRACT §12）——
    // 服务端逐请求鉴权、键集游标稳定；事件窗口引用仅作上游未升级时的回退（如实标注非穷尽）。
    // 清单 limit=100；超过单页 → refsExhaustive=false + note（整页分页走读面路由）。
    const asList = await settle('assessmentList', `/api/v2/customers/${enc}/assessments?limit=100`, (r) => ({ items: r.assessments ?? [], nextCursor: r.nextCursor ?? null }));
    const frList = await settle('financingRequestList', `/api/v2/customers/${enc}/financing-requests?limit=100`, (r) => ({ items: r.financingRequests ?? [], nextCursor: r.nextCursor ?? null }));
    let assessments;
    let financingRequests;
    let refsSource;
    let refsExhaustive;
    if (asList !== null && frList !== null) {
      assessments = asList.items.slice(0, MAX_LIST_ITEMS);
      financingRequests = frList.items.slice(0, MAX_LIST_ITEMS);
      refsSource = 'authoritative_list';
      refsExhaustive = asList.nextCursor === null && frList.nextCursor === null;
      if (!refsExhaustive) notes.push('权威清单超过单页上限（limit=100）：快照非穷尽；整页分页走 /api/jw/v2/customers/:id/{assessments,financing-requests}');
    } else {
      refsSource = 'event_buffer';
      refsExhaustive = false;
      assessments = (await Promise.all(refs.assessmentIds.map((id) => cachedDetail(`ass:${id}`, id, `assessment:${id}`, '/api/v2/assessments')))).filter(Boolean);
      financingRequests = (await Promise.all(refs.frIds.map((id) => cachedDetail(`fr:${id}`, id, `fr:${id}`, '/api/v2/financing-requests')))).filter(Boolean);
      notes.push('权威清单不可用（见 freshness.assessmentList/financingRequestList）：回退事件窗口引用（非穷尽）');
    }

    let session = null;
    if (refs.sessionId) {
      session = await settle('inspectionSession', `/api/v1/inspections/${encodeURIComponent(refs.sessionId)}`, (r) => r.snapshot ?? null);
      if (session === null) notes.push('检查会话快照不可用（见 freshness.inspectionSession）');
    } else {
      freshness.inspectionSession = { ok: true, at: new Date().toISOString(), note: '当前身份窗口内无检查会话事件' };
    }

    const snapshot = {
      customer: cust ?? null,
      facilities: exposure?.facilities ?? [],
      totalsMinor: exposure?.totalsMinor ?? null,
      decisionStatus: decisionStatus ?? null,
      findings,
      listTruncated: {
        findings: findingsAll.length > findings.length,
        objectInventory: objectInventoryAll.length > objectInventory.length,
      },
      objectInventory,
      financingRequests,
      assessments,
      refsSource,
      refsExhaustive,
      session,
      openItems: [],
    };
    snapshot.openItems = deriveOpenItems(snapshot);
    const last = b.envelopes[b.envelopes.length - 1] || null;
    return {
      customerId,
      principalId: ctx.principalId,
      snapshot,
      snapshotVersion: b.lastSeq.toString(),
      eventCursor: last ? last.eventId : null,
      source: 'kernel',
      eventWindow: {
        buffered: b.envelopes.length,
        oldestSeq: b.envelopes.length > 0 ? b.envelopes[0].aggregateVersion : null,
        newestSeq: last ? last.aggregateVersion : null,
        gap: b.gap,
        truncated: b.envelopes.length >= MAX_ENVELOPES,
        note: '缓冲窗口外的历史经 /events-page 分页获取（按凭据授权，逐请求鉴权）',
      },
      projection: { notes, freshness, at: new Date().toISOString() },
    };
  }

  // 分页事件直读（U04 大历史）：A 的 after/limit 逐页透传，每请求以调用方凭据鉴权；
  // 不经缓冲、不回放、不受 MAX_ENVELOPES 限制，也不假装知道总数（A 未提供总数）。
  async function pageEvents(customerId, { afterSeq = '0', limit = 200 } = {}, opts = {}) {
    const credential = opts.credential;
    if (typeof credential !== 'string' || credential.length === 0) {
      const err = new Error('live 模式分页事件需要会话');
      err.noCredential = true;
      throw err;
    }
    const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const after = /^\d+$/.test(String(afterSeq)) ? String(afterSeq) : '0';
    const r = await kernelFetch(credential, `/api/v2/customers/${encodeURIComponent(customerId)}/events?after=${after}&limit=${capped}`);
    const events = (Array.isArray(r.events) ? r.events : []).map(toEnvelope);
    return {
      ok: true,
      events,
      nextAfterSeq: events.length > 0 ? events[events.length - 1].aggregateVersion : after,
      hasMore: events.length === capped,
      limit: capped,
    };
  }

  function replayFrom(customerId, afterEventId, opts = {}) {
    const b = buckets.get(bucketKey(customerId, opts));
    if (!b) return { events: [] };
    if (afterEventId == null) return { events: [] };
    const idx = b.envelopes.findIndex((e) => e.eventId === afterEventId);
    if (idx === -1) return { expired: true, reason: 'cursor_unknown_or_edge_restarted' };
    return { events: b.envelopes.slice(idx + 1).map((e) => e) };
  }

  // 订阅：注册到"本身份桶" + 桶内单轮询循环。after 指定"客户端将恢复的游标"：
  // 先补缓冲中该游标之后的事件再收实时，杜绝注册窗口缺口；客户端按 eventId 去重，
  // 重复投递安全。onAuthFail：本凭据被 A 拒绝（撤权/过期）→ 通知一次，桶随即销毁（C1.2）。
  function subscribe(customerId, cb, opts = {}) {
    const ctx = { credential: opts.credential, principalId: opts.principalId };
    if (typeof ctx.credential !== 'string' || ctx.credential.length === 0) {
      const err = new Error('live 模式订阅需要会话');
      err.noCredential = true;
      throw err;
    }
    const b = bucketOf(customerId, ctx);
    const sub = { cb, onAuthFail: opts.onAuthFail };
    b.subs.add(sub);
    if (!b.timer) {
      b.timer = setInterval(() => {
        if (b.subs.size === 0) { // 最后一个订阅者离开 → 释放缓冲（按身份分桶防泄漏）
          if (b.timer) { clearInterval(b.timer); b.timer = null; }
          if (b.subs.size === 0 && !b.authDead) buckets.delete(b.key);
          return;
        }
        pullEvents(b).catch((e) => {
          log(`[kernel-store] 轮询失败 customer=${customerId}: ${e.upstream?.code || e.message}（保流不断，readiness/freshness 反映内核状态）`);
        });
      }, pollIntervalMs);
      b.timer.unref?.();
    }
    const safe = (env) => { try { cb(env); } catch { } };
    const kick = (async () => {
      await sleep(0);
      try {
        const r = await pullEvents(b);
        if (r === 'auth') return; // 桶已销毁并通知
      } catch (e) {
        log(`[kernel-store] 首轮补取失败 customer=${customerId}: ${e.upstream?.code || e.message}`);
      }
      if (b.subs.size === 0 || opts.after == null) return;
      const replay = replayFrom(customerId, opts.after, ctx);
      if (replay.expired) {
        // T5-1 整改（复核 P3①）：订阅基线游标已不在保留窗口 → 对本订阅显式发
        // EDGE_RESYNC_REQUIRED 信号（前端按事件刷新快照自愈），不静默续播。
        safe({
          eventId: `resync-${randomUUID()}`,
          scope: { tenant: 'kernel', customer: customerId },
          aggregateVersion: b.lastSeq.toString(),
          schemaVersion: 'jw.event.v1',
          occurredAt: new Date().toISOString(),
          payloadRef: { type: 'EDGE_RESYNC_REQUIRED', seq: b.lastSeq.toString() },
          payload: { after: opts.after, reason: r.reason },
        });
        return;
      }
      for (const env of replay.events) safe(env);
    })();
    void kick;
    return () => { b.subs.delete(sub); };
  }

  // 会话目标校验（C2.5）：消息发往的客户必须对该凭据可读（A 逐请求裁决），防错 customerId。
  async function checkCustomer(customerId, opts = {}) {
    const credential = opts.credential;
    if (typeof credential !== 'string' || credential.length === 0) return { ok: false, status: 401, code: 'SESSION_REQUIRED' };
    try {
      await kernelFetch(credential, `/api/v2/customers/${encodeURIComponent(customerId)}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, status: e.upstream?.status ?? 502, code: e.upstream?.code ?? 'UPSTREAM_ERROR' };
    }
  }

  return {
    mode: 'kernel',
    getWorkspace,
    pageEvents,
    replayFrom,
    subscribe,
    checkCustomer,
    _stats: (customerId) => {
      const out = [];
      for (const [key, b] of buckets) {
        if (!customerId || key.startsWith(`${customerId}|`)) {
          out.push({ key, envelopes: b.envelopes.length, lastSeq: b.lastSeq.toString(), subs: b.subs.size, authDead: b.authDead, gap: b.gap, detailCache: b.detailCache.size });
        }
      }
      return out;
    },
    // goal-03 C1：查询计数与缓存控制（测试/性能口径用；不影响对外协议）
    _qCounters: () => ({ ...qCounters }),
    _resetQCounters: () => { for (const k of Object.keys(qCounters)) qCounters[k] = 0; },
    _dropDetailCaches: () => { for (const b of buckets.values()) b.detailCache.clear(); },
  };
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
  for (const q of snapshot.decisionStatus?.reviewQueue ?? []) {
    if (q.status === 'open') {
      items.push({ kind: 'review_queue_open', ref: q.findingId, needRole: 'credit', detail: `决策复核队列开放项（${q.findingType ?? '类型未知'}，严重度 ${q.severity ?? '未知'}）` });
    }
  }
  const blocked = snapshot.decisionStatus?.basis?.blockedActions ?? [];
  if (Array.isArray(blocked) && blocked.length > 0) {
    items.push({ kind: 'decision_blocked_actions', ref: snapshot.decisionStatus?.basis?.packageId ?? null, needRole: 'credit', blockers: blocked, detail: `依据包阻断动作：${blocked.join('、')}（服务端判定）` });
  }
  return items;
}
