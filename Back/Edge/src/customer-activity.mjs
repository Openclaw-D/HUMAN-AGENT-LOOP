// 客户活动只读聚合（V0.4 任务04）：为四页与聊天提供同一客户的最小事件读面。
// 来源（见 docs/v0.4/results/04-activity/CONTRACT.md §1，全部只读复用既有读取接口，零写入）：
//   thread        页内消息线程（message-store.mjs，每客户 seq 单调）
//   kernel        业务事件（经 kernel-store.pageEvents 以会话凭据逐请求拉取 A，A 是授权裁决方）
//   model_receipt 模型回执（assistant-receipts 落盘 JSON；回执含 customerId/tenantId/at/outcome.status）
// 纪律：
//   - 无时间/身份明示 null / trusted:false——不用当前时间或当前会话人填补历史；
//   - 请求/完成/失败/未知分别保留；提问不推导成功（thread 条目的 completed 只表示"投递成功已留档"）；
//   - 跨源无全局序列：页内归并只是展示提示，perSourceCursors 才是续读依据（各源升序前缀，不漏不重）；
//   - activityId = source:sourceRecordId，来源命名空间去重键，跨页稳定。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCES = ['thread', 'kernel', 'model_receipt'];
const SOURCE_KINDS = { thread: 'message', kernel: 'business_event', model_receipt: 'model_receipt' };
const CURSOR_VERSION = 1;
// null 时间排最后（展示提示序），不参与游标语义（游标只按各源自身排序键推进）。
const TIME_SENTINEL = '9999-12-31T23:59:59.999Z';

export function encodeActivityCursor(perSource) {
  const clean = {};
  for (const s of SOURCES) {
    const v = perSource?.[s];
    if (typeof v === 'string' && v.length > 0 && v.length <= 512) clean[s] = v;
  }
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, c: clean }), 'utf8').toString('base64url');
}

export function decodeActivityCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 4096) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== CURSOR_VERSION || typeof parsed.c !== 'object' || parsed.c === null || Array.isArray(parsed.c)) return null;
  const out = {};
  for (const [k, v] of Object.entries(parsed.c)) {
    if (!SOURCE_KINDS[k] || typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
    out[k] = v;
  }
  return out;
}

/** 服务端路由层在 400 之前校验各源游标形状（thread/kernel=十进制 seq；model_receipt=at|requestId）。 */
export function validateActivityCursorShape(decoded) {
  for (const [source, value] of Object.entries(decoded ?? {})) {
    if (source === 'thread' || source === 'kernel') {
      if (!/^\d+$/.test(value)) return false;
    } else if (source === 'model_receipt') {
      const sep = value.indexOf('|');
      if (sep < 1 || sep === value.length - 1) return false;
    }
  }
  return true;
}

const NO_ACTOR = () => ({ principalId: null, roles: [], trusted: false });

function threadItem(customerId, m, receiptStore) {
  const sender = typeof m.senderPrincipalId === 'string' && m.senderPrincipalId.length > 0 && m.senderPrincipalId !== 'unknown'
    ? { principalId: m.senderPrincipalId, roles: Array.isArray(m.senderRoles) ? m.senderRoles : [], trusted: true }
    : NO_ACTOR();
  // 投递回执（message_receipts）：只在有持久回执时给服务端记录的送达态；回执缺失=unknown，不标已读。
  let deliveryState = 'unknown';
  let deliveryMessageId = null;
  try {
    const r = receiptStore?.getReceipt?.(m.requestId) ?? null;
    if (r?.result?.delivery) {
      deliveryState = typeof r.result.delivery.state === 'string' ? r.result.delivery.state : 'unknown';
      deliveryMessageId = r.result.delivery.messageId ?? null;
    }
  } catch { /* 回执读取失败按 unknown 披露 */ }
  return {
    activityId: `thread:${m.messageId}`,
    source: 'thread',
    sourceRecordId: m.messageId,
    eventType: 'message.posted',
    customerId,
    tenantId: null, // 线程存储无权威租户列：null（未知），不以会话租户填补
    occurredAt: typeof m.at === 'string' ? m.at : null,
    actor: sender,
    requestId: m.requestId || null,
    state: 'completed', // 仅指"该消息投递成功并已留档"（threadStore 只在投递成功后入栈）——不代表模型/业务办理完成
    text: m.text,
    delivery: { requestId: m.requestId || null, messageId: deliveryMessageId, state: deliveryState },
    refs: { seq: String(m.seq), audience: m.audience ?? null, threadId: m.threadId ?? null },
    _ck: String(m.seq),
  };
}

function kernelItem(customerId, env) {
  return {
    activityId: `kernel:${env.eventId}`,
    source: 'kernel',
    sourceRecordId: env.eventId,
    eventType: env.payloadRef?.type ?? null,
    customerId,
    tenantId: null, // 信封 scope.tenant 是常量命名空间（非权威租户）；租户隔离由 A 按凭据过滤保证
    occurredAt: typeof env.occurredAt === 'string' ? env.occurredAt : null,
    actor: NO_ACTOR(), // A 事件信封不含 actor：如实 unknown
    requestId: env.payload?.requestId ?? null,
    state: 'completed', // 仅指"A 已记录该事件发生"；业务状态原样留在 payload
    text: null,
    refs: { seq: env.aggregateVersion, payloadRef: env.payloadRef ?? null, payload: env.payload ?? null },
    _ck: String(env.aggregateVersion),
  };
}

function receiptStateOf(rec) {
  if (rec.phase !== 'terminal' || !rec.outcome) return 'unknown'; // 仅 INTENT / 形状不完整：发送结果未知，绝不伪装完成
  return rec.outcome.status === 'succeeded' || rec.outcome.status === 'simulated'
    ? 'completed'
    : rec.outcome.status === 'failed' ? 'failed' : 'unknown';
}

function receiptItem(customerId, rec) {
  return {
    activityId: `model_receipt:${rec.requestId}`,
    source: 'model_receipt',
    sourceRecordId: rec.requestId,
    eventType: 'model.observe.receipt',
    customerId,
    tenantId: typeof rec.tenantId === 'string' && rec.tenantId ? rec.tenantId : null,
    occurredAt: typeof rec.at === 'string' ? rec.at : null,
    actor: NO_ACTOR(), // 回执不含 principalId：如实 unknown，不以当前会话人填补
    requestId: rec.requestId,
    state: receiptStateOf(rec),
    text: null, // 模型输出正文不进活动流；输出只经 observe 响应/回执本身查阅
    refs: {
      assistant: rec.assistant ?? null,
      contextVersion: rec.contextVersion ?? null,
      receiptVersion: rec.receiptVersion ?? null,
      configHash: rec.configHash ?? null,
      contextHash: rec.contextHash ?? null,
      analysisRunId: rec.outcome?.analysisRunId ?? null,
      phase: rec.phase ?? null,
      status: rec.outcome?.status ?? null,
    },
    _ck: `${rec.at}|${rec.requestId}`,
  };
}

/** 读单客户模型回执（assistant-receipts 落盘形状）；损坏/非本客户/缺字段的文件跳过并计数。 */
async function readReceiptRecords(receiptsDir, customerId) {
  const dir = path.join(receiptsDir, 'receipts');
  const names = await readdir(dir).catch((e) => {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  });
  const byRequest = new Map();
  let corrupted = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || name.includes('.tmp')) continue;
    let rec;
    try {
      rec = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    } catch {
      corrupted += 1;
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { corrupted += 1; continue; }
    if (rec.customerId !== customerId) continue; // 客户隔离：只取本客户回执
    if (typeof rec.requestId !== 'string' || rec.requestId.length === 0 || typeof rec.at !== 'string') { corrupted += 1; continue; }
    const prior = byRequest.get(rec.requestId);
    // 同 requestId 的 INTENT 与 TERMINAL 合并为一条：TERMINAL 优先（发送结果以终态为准）。
    if (!prior || (rec.phase === 'terminal' && prior.phase !== 'terminal')) byRequest.set(rec.requestId, rec);
  }
  return { records: [...byRequest.values()], corrupted };
}

function sourceEntry(source, { requested = true, available = true, ...extra } = {}) {
  return { source, kind: SOURCE_KINDS[source], requested, available, ...extra };
}

/**
 * 单页聚合读。只读：store.pageEvents / messageStore.list / 回执文件——零业务写入。
 * 返回 { items, perSourceCursors, nextCursor, exhausted, sources, incomplete }。
 */
export async function listActivityPage(activity, customerId, {
  cursor = null, limit = 50, sources = null, audience = null, customerOnly = false,
} = {}, ctx = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const decoded = cursor ? decodeActivityCursor(cursor) : {};
  if (cursor && !decoded) return { error: { status: 400, body: { ok: false, error: 'INVALID_CURSOR', note: '游标非法（非本接口签发或版本不符）：不静默重置' } } };
  if (!validateActivityCursorShape(decoded)) return { error: { status: 400, body: { ok: false, error: 'INVALID_CURSOR', note: '游标内来源排序键形状非法' } } };
  const requestedSet = new Set(sources && sources.length ? sources.filter((s) => SOURCES.includes(s)) : SOURCES);
  if (requestedSet.size === 0) return { error: { status: 400, body: { ok: false, error: 'INVALID_SOURCES', note: `sources 必须非空且取自 ${SOURCES.join(',')}` } } };

  const lists = []; // { source, items, idx, hasMore }
  const incomplete = [];
  const sourceEntries = [];

  // ---- thread：每客户 seq 升序（messageStore 既有分页语义；裁剪时如实披露 truncated/retentionBase） ----
  const threadRequested = requestedSet.has('thread');
  if (!threadRequested) {
    sourceEntries.push(sourceEntry('thread', { requested: false, available: Boolean(activity.messageStore) }));
  } else if (activity.messageStore) {
    const threadExtra = {};
    try {
      const afterSeq = decoded.thread !== undefined ? Number(decoded.thread) : 0;
      const r = activity.messageStore.list(customerId, {
        audience: customerOnly ? 'customer' : audience,
        afterSeq,
        limit: lim,
      });
      const items = (r.messages ?? []).map((m) => threadItem(customerId, m, activity.messageStore));
      if (r.truncated) {
        threadExtra.truncated = true;
        threadExtra.retentionBase = r.retentionBase;
        threadExtra.note = r.note ?? '历史超出保留窗口已被裁剪：缺失区段显式提示';
      }
      lists.push({ source: 'thread', items, idx: 0, hasMore: items.length === lim });
      sourceEntries.push(sourceEntry('thread', { requested: threadRequested, ...threadExtra }));
    } catch (e) {
      incomplete.push({ source: 'thread', code: 'SOURCE_READ_FAILED', note: String(e?.message ?? e) });
      sourceEntries.push(sourceEntry('thread', { requested: threadRequested, available: false, reason: 'SOURCE_READ_FAILED', ...threadExtra }));
    }
  } else {
    sourceEntries.push(sourceEntry('thread', { requested: threadRequested, available: false, reason: 'NOT_CONFIGURED' }));
  }

  // ---- kernel：A 事件 seq 升序（store.pageEvents 逐请求凭据；fixture 无分页源 → 如实不可用） ----
  const kernelRequested = requestedSet.has('kernel');
  if (!kernelRequested) {
    sourceEntries.push(sourceEntry('kernel', { requested: false, available: typeof activity.store?.pageEvents === 'function' }));
  } else if (typeof activity.store?.pageEvents === 'function') {
    try {
      const r = await activity.store.pageEvents(customerId, {
        afterSeq: decoded.kernel ?? '0',
        limit: lim,
      }, { credential: ctx.credential, principalId: ctx.principalId });
      const items = (r.events ?? []).map((env) => kernelItem(customerId, env));
      lists.push({ source: 'kernel', items, idx: 0, hasMore: r.hasMore === true });
      sourceEntries.push(sourceEntry('kernel', { requested: kernelRequested }));
    } catch (e) {
      // 单源失败不拖垮整页；失败如实列示（错误码原样），不以空页伪装
      incomplete.push({
        source: 'kernel',
        code: e?.upstream?.code ?? 'UPSTREAM_ERROR',
        note: e?.upstream?.reason ?? String(e?.message ?? e),
      });
      sourceEntries.push(sourceEntry('kernel', { requested: kernelRequested, available: false, reason: e?.upstream?.code ?? 'UPSTREAM_ERROR' }));
    }
  } else {
    sourceEntries.push(sourceEntry('kernel', { requested: kernelRequested, available: false, reason: 'NOT_SUPPORTED', note: '存储无分页事件源（fixture 形态）：不伪造历史' }));
  }

  // ---- model_receipt：落盘回执（at|requestId 复合键升序）；customer-only 受众一律排除 ----
  const receiptsRequested = requestedSet.has('model_receipt');
  if (customerOnly) {
    sourceEntries.push(sourceEntry('model_receipt', {
      requested: receiptsRequested, available: false, reason: 'AUDIENCE_FORBIDDEN', excludedByAudience: true,
      note: receiptsRequested ? undefined : '内部辅助观察面：客户联系人受众默认排除',
    }));
  } else if (!receiptsRequested) {
    sourceEntries.push(sourceEntry('model_receipt', { requested: false, available: Boolean(activity.receiptsDir) }));
  } else if (!activity.receiptsDir) {
    sourceEntries.push(sourceEntry('model_receipt', { requested: receiptsRequested, available: false, reason: 'NOT_CONFIGURED' }));
  } else {
    try {
      const { records, corrupted } = await readReceiptRecords(activity.receiptsDir, customerId);
      let items = records.map((rec) => receiptItem(customerId, rec));
      items.sort((a, b) => (a._ck < b._ck ? -1 : a._ck > b._ck ? 1 : 0));
      if (decoded.model_receipt !== undefined) items = items.filter((it) => it._ck > decoded.model_receipt);
      const extra = corrupted > 0 ? { note: `${corrupted} 个回执文件损坏或缺字段：已跳过并如实计数` } : {};
      lists.push({ source: 'model_receipt', items, idx: 0, hasMore: items.length > lim });
      sourceEntries.push(sourceEntry('model_receipt', { requested: receiptsRequested, ...extra }));
    } catch (e) {
      incomplete.push({ source: 'model_receipt', code: 'SOURCE_READ_FAILED', note: String(e?.message ?? e) });
      sourceEntries.push(sourceEntry('model_receipt', { requested: receiptsRequested, available: false, reason: 'SOURCE_READ_FAILED' }));
    }
  }

  // ---- k 路归并：每源只弹自身列表前缀（升序），页序仅是展示提示，不声称全局总序 ----
  // activityId（来源命名空间键）去重：上游重复投递（同 eventId 重放等）只出一次，跨页亦稳定。
  const orderedLists = SOURCES.map((s) => lists.find((l) => l.source === s)).filter(Boolean);
  const items = [];
  const emittedIds = new Set();
  const resumeCursor = { ...decoded }; // 各源续读水位：本页最后弹出的记录排序键（未弹出的源保留原游标）
  for (let n = 0; n < lim; n += 1) {
    let best = null;
    let bestList = null;
    for (const l of orderedLists) {
      while (l.idx < l.items.length && emittedIds.has(l.items[l.idx].activityId)) l.idx += 1;
      if (l.idx >= l.items.length) continue;
      const cand = l.items[l.idx];
      const aAt = cand.occurredAt ?? TIME_SENTINEL;
      const bAt = best ? (best.occurredAt ?? TIME_SENTINEL) : null;
      const better = !best || aAt < bAt
        || (aAt === bAt && (cand.source < best.source
          || (cand.source === best.source && cand.sourceRecordId < best.sourceRecordId)));
      if (better) { best = cand; bestList = l; }
    }
    if (!best) break;
    emittedIds.add(best.activityId);
    items.push(best);
    bestList.idx += 1;
    resumeCursor[best.source] = best._ck;
  }

  const exhausted = {};
  for (const l of orderedLists) exhausted[l.source] = l.hasMore !== true && l.idx >= l.items.length;
  const allExhausted = orderedLists.length > 0 && orderedLists.every((l) => exhausted[l.source]);
  const nextCursor = allExhausted && incomplete.length === 0 ? null : encodeActivityCursor(resumeCursor);

  const perSourceCursors = {};
  for (const s of SOURCES) if (typeof resumeCursor[s] === 'string') perSourceCursors[s] = resumeCursor[s];

  return {
    items,
    perSourceCursors,
    nextCursor,
    exhausted: Object.fromEntries(SOURCES.filter((s) => orderedLists.some((l) => l.source === s)).map((s) => [s, exhausted[s]])),
    sources: sourceEntries,
    ordering: 'per_source_sequence_asc; merged page order is presentation hint, NOT a global total order',
    incomplete,
  };
}

export function createCustomerActivity({ store, messageStore = null, receiptsDir = null, log = () => { } } = {}) {
  return {
    async listPage(customerId, params = {}, ctx = {}) {
      const out = await listActivityPage({ store, messageStore, receiptsDir }, customerId, params, ctx);
      if (out.error) log(`[activity] ${out.error.body.error} customer=${customerId}`);
      return out;
    },
  };
}
