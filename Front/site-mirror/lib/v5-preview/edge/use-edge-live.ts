// Edge 接线·React hook（任务三 C2；任务03 C3 收紧；goal-03 C2/C3 修复轮）：
// 连接生命周期 + 快照/事件游标管理。
// 纪律：成功勾/警报只由"新业务事件到达"触发；重连与回放不重复提示（按 eventId 去重，集合有界）；
// 关键命令返回未知 → 显示"对账中"并以同 requestId 幂等重发对账（一次），不以本地状态冒充成功；
// 快照以服务端为准（事件到达→防抖重取）。
// 撤权/会话失效（auth 帧、HTTP 401/403）为终止性——清会话转 off 并要求重认证，绝不自动重连复活旧会话。
// goal-03 修复：连接代际（epoch）守卫——晚到旧响应/旧流回调不得污染新连接或新客户上下文（P1-3/
// 切换客户原子性）；重连成功（SSE 200/open）→ 回 live 态并重置退避（P1-2）；指数退避 1.5s→30s
//（resync 同样有退避）；重连/resync 定时器统一登记，卸载/断开/终态一律清理；refresh 携带代际，
// 跨客户晚到快照直接丢弃。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEdgeClient, EdgeHttpError, type EdgeClient, type EdgeSessionInfo, type ReadyzResponse } from './edge-client';
import { type EdgeLiveMessage, type EdgePhase, type EdgeSnapshotShapes } from './edge-logic';

const MAX_SEEN_EVENTS = 5000;          // 去重集上限（FIFO 淘汰），防长会话无界内存
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 30_000;
const RESYNC_MAX_MS = 5000;
const RECONCILE_DELAY_MS = 4000;       // unknown 消息的自动对账（同 requestId 幂等重发）延迟

export interface EdgeLiveState {
  phase: EdgePhase;
  session: EdgeSessionInfo | null;
  buildId: string | null;
  capabilities: Record<string, unknown> | null;
  readiness: ReadyzResponse | null;
  customerId: string | null;
  snapshot: EdgeSnapshotShapes | null;
  snapshotVersion: number | string;
  eventWindow: { buffered: number; oldestSeq: string | null; newestSeq: string | null; gap: boolean; truncated: boolean } | null;
  freshness: Record<string, { ok: boolean; at: string; code?: string; note?: string; cached?: boolean }> | null;
  notes: string[];
  lastEvent: { eventId: string; type: string; at: string } | null;
  error: string | null;
  reconciling: boolean; // 关键命令未知（502 UPSTREAM_UNKNOWN）→ true，直到回执/快照确认
  liveMessages: EdgeLiveMessage[];
}

export interface EdgeLiveApi extends EdgeLiveState {
  client: EdgeClient | null;
  connect(baseUrl: string, credential: string, customerId: string): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  setReconciling(v: boolean): void;
  /** live 聊天：经 Edge 消息受众路由投递；状态只来自服务端回执，失败不回退本地模拟。 */
  sendLiveMessage(text: string, audience: 'customer' | 'internal'): Promise<{ ok: boolean; requestId?: string; code?: string; message?: string }>;
}

export function useEdgeLive(): EdgeLiveApi {
  const [phase, setPhase] = useState<EdgePhase>('off');
  const [session, setSession] = useState<EdgeSessionInfo | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<ReadyzResponse | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EdgeSnapshotShapes | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<number | string>(0);
  const [eventWindow, setEventWindow] = useState<EdgeLiveState['eventWindow']>(null);
  const [freshness, setFreshness] = useState<EdgeLiveState['freshness']>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [lastEvent, setLastEvent] = useState<EdgeLiveState['lastEvent']>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [liveMessages, setLiveMessages] = useState<EdgeLiveMessage[]>([]);

  const clientRef = useRef<EdgeClient | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cursorRef = useRef<string | null>(null);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  // 连接代际：connect/disconnect/终态各 +1；一切异步回调应用状态前先核对代际，
  // 晚到的旧流/旧响应（可能属于已切换的客户或已终止的会话）一律丢弃（goal-03 P1-3/切换客户原子性）。
  const epochRef = useRef(0);
  const reconcilesRef = useRef<Set<string>>(new Set()); // 已排程对账的 requestId（每 ID 一次）
  const phaseRef = useRef<EdgePhase>('off');
  phaseRef.current = phase;
  const liveRef = useRef<boolean>(false);
  liveRef.current = phase === 'live' || phase === 'reconnecting';

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const rememberSeen = useCallback((eventId: string) => {
    const seen = seenEventsRef.current;
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > MAX_SEEN_EVENTS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest); // Set 保持插入序：淘汰最早
    }
    return true;
  }, []);

  const scheduleRefresh = useCallback((_customerIdArg: string) => {
    if (refreshTimerRef.current !== null) return; // 防抖：事件风暴下最多 ~200ms 一次快照重取
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void apiRef.current?.refresh();
    }, 200);
  }, []);

  // 终态：撤权/会话失效——清会话转 off，要求重新认证；旧会话不复活（任务03 C1.2）
  const terminateForAuth = useCallback((c: EdgeClient, detail: string) => {
    epochRef.current += 1;
    clearReconnectTimer();
    stopRef.current?.();
    stopRef.current = null;
    c.endSession();
    clientRef.current = null;
    setPhase('off');
    setSession(null);
    setError(detail);
  }, [clearReconnectTimer]);

  // 重连排程：指数退避（1.5s 起步，30s 封顶），成功回 live 后由 onOpen 重置；定时器统一登记。
  const scheduleResubscribe = useCallback((c: EdgeClient, customerIdArg: string, myEpoch: number, maxMs: number) => {
    clearReconnectTimer();
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, maxMs);
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (epochRef.current === myEpoch && clientRef.current === c && phaseRef.current !== 'off' && phaseRef.current !== 'ended') {
        subscribeEvents(c, customerIdArg, myEpoch);
      }
    }, delay);
    // eslint 由构建期 tsc 把关；subscribeEvents 在下方以函数声明提升可用
  }, [clearReconnectTimer]);

  function subscribeEvents(c: EdgeClient, customerIdArg: string, myEpoch: number) {
    const alive = () => epochRef.current === myEpoch && clientRef.current === c;
    stopRef.current?.();
    stopRef.current = c.openEvents(customerIdArg, cursorRef.current, {
      onOpen: () => {
        if (!alive()) return;
        // 重连成功（含首连）：回 live、重置退避、清除"断开"类错误提示（P1-2 修复）
        reconnectAttemptRef.current = 0;
        setPhase('live');
        setError((prev) => (prev !== null && (prev.startsWith('事件流断开') || prev.startsWith('工作台刷新失败')) ? null : prev));
      },
      onCursor: (cur) => { if (alive()) cursorRef.current = cur; },
      onEvent: (env) => {
        if (!alive()) return;
        if (!rememberSeen(env.eventId)) return; // 至少一次投递 → 客户端去重（重连不重复提示）
        setLastEvent({ eventId: env.eventId, type: env.payloadRef?.type ?? 'unknown', at: new Date().toISOString() });
        setReconciling(false);
        scheduleRefresh(customerIdArg);
      },
      onResync: () => {
        if (!alive()) return;
        // 游标过期（Edge 重启/窗口裁剪/慢客户端）：清游标 → 权威重取快照 → 退避后以新基线重订。
        cursorRef.current = null;
        void apiRef.current?.refresh();
        stopRef.current?.();
        stopRef.current = null;
        setPhase('reconnecting');
        scheduleResubscribe(c, customerIdArg, myEpoch, RESYNC_MAX_MS);
      },
      onAuth: (info) => {
        if (!alive()) return;
        terminateForAuth(c, `真实后台订阅已终止（${info?.code ?? 'AUTH'}）：${info?.note || '权限变更或会话失效'}，请重新连接`);
      },
      onDrop: (reason, status) => {
        if (!alive()) return; // 旧流回调（代际已更替）：不得污染新连接
        if (phaseRef.current === 'off' || phaseRef.current === 'ended') return;
        if (status === 401 || status === 403) {
          // 会话失效（TTL 过期/权限变更）：终态，不退避不重连
          terminateForAuth(c, '会话已失效（服务端 401/403）：请重新连接换取新会话');
          return;
        }
        stopRef.current?.();
        stopRef.current = null;
        setPhase('reconnecting');
        setError(`事件流断开（${reason}）；正在退避重连，不做本地状态补写`);
        scheduleResubscribe(c, customerIdArg, myEpoch, RECONNECT_MAX_MS);
      },
    });
  }

  const apiRef = useRef<EdgeLiveApi | null>(null);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    const myEpoch = epochRef.current;
    const cid = customerIdRef.current;
    if (!c || !cid || !c.session) return;
    try {
      const ws = await c.workspace(cid);
      if (epochRef.current !== myEpoch) return; // 代际更替（切换客户/断开/终态）：晚到响应丢弃
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
      setFreshness(ws.projection?.freshness ?? null);
      setEventWindow(ws.eventWindow ?? null);
      setReconciling(false);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
    } catch (e) {
      if (epochRef.current !== myEpoch) return;
      const err = e as EdgeHttpError;
      if (err.status === 502) { setReconciling(true); setError('后端暂不可达：显示"对账/滞后"状态，不冒充成功'); }
      else if (err.status === 401 || err.status === 403) {
        // 快照面被拒（撤权/过期）：与 SSE auth 同语义，终止而非重试
        terminateForAuth(c, `真实后台拒绝本会话（${err.code}）：请重新连接`);
      }
      else if (err.status === 404) {
        // 已连接会话中客户面 404 = 被撤权/删除（A 越权统一 404，不泄露存在性；首连即 404 走 connect
        // 失败路径，不会进这里）：终止而非重试循环
        terminateForAuth(c, `客户 ${cid} 已不可读（可能已撤权或被删除）：请重新连接并确认授权范围`);
      }
      else setError(`工作台刷新失败：${err.code}`);
      if (liveRef.current && clientRef.current === c) setPhase('reconnecting');
    }
  }, [terminateForAuth]);

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customerId;

  const applyWorkspace = useCallback((ws: NonNullable<Awaited<ReturnType<EdgeClient['workspace']>>>) => {
    setSnapshot(ws.snapshot);
    setSnapshotVersion(ws.snapshotVersion);
    setNotes(ws.projection?.notes ?? []);
    setFreshness(ws.projection?.freshness ?? null);
    setEventWindow(ws.eventWindow ?? null);
    if (ws.eventCursor) cursorRef.current = ws.eventCursor;
  }, []);

  const connect = useCallback(async (baseUrl: string, credential: string, customerIdArg: string) => {
    // 新连接 = 新代际：先停旧流/旧定时器，旧流此后的一切回调因代际不符被丢弃（P1-3 修复）。
    epochRef.current += 1;
    const myEpoch = epochRef.current;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    stopRef.current?.();
    stopRef.current = null;
    setError(null);
    setPhase('connecting');
    const c = createEdgeClient({ baseUrl });
    clientRef.current = c;
    const ok = () => epochRef.current === myEpoch;
    try {
      const s = await c.exchange(credential);
      if (!ok()) return;
      setSession(s);
      const vz = await c.versionz().catch(() => ({ buildId: undefined, capabilities: undefined }));
      if (!ok()) return;
      setBuildId(vz.buildId ?? null);
      setCapabilities((vz.capabilities as Record<string, unknown> | undefined) ?? null);
      const rz = await c.readyz().catch(() => null);
      if (!ok()) return;
      setReadiness(rz);
      setCustomerId(customerIdArg);
      cursorRef.current = null;
      seenEventsRef.current = new Set();
      reconcilesRef.current = new Set();
      setLiveMessages([]);
      const ws = await c.workspace(customerIdArg);
      if (!ok()) return;
      applyWorkspace(ws);
      setPhase('live');
      subscribeEvents(c, customerIdArg, myEpoch);
    } catch (e) {
      if (!ok()) return; // 旧连接的失败不得覆盖新连接状态
      setPhase('off');
      clientRef.current = null;
      const err = e as EdgeHttpError;
      setError(err instanceof EdgeHttpError ? `连接失败：${err.code}（${err.message}）` : `连接失败：${String(e)}`);
    }
  }, [applyWorkspace, clearReconnectTimer, subscribeEvents]);

  const disconnect = useCallback(() => {
    epochRef.current += 1;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    stopRef.current?.();
    stopRef.current = null;
    clientRef.current?.endSession();
    clientRef.current = null;
    setPhase('off');
    setSession(null);
    setSnapshot(null);
    setCustomerId(null);
    setReconciling(false);
    setError(null);
  }, [clearReconnectTimer]);

  const sendLiveMessage = useCallback(async (text: string, audience: 'customer' | 'internal') => {
    const c = clientRef.current;
    const cid = customerIdRef.current;
    const myEpoch = epochRef.current;
    if (!c || !cid || !c.session) return { ok: false, code: 'NO_SESSION', message: '未连接真实后台' };
    const requestId = `ui-msg-${cid}-${Date.now()}`.slice(0, 128);
    const localId = `${requestId}-m`;
    const optimistic: EdgeLiveMessage = { id: localId, requestId, at: new Date().toISOString(), audience, text, state: 'sending' };
    setLiveMessages((prev) => [...prev, optimistic]);
    // 结果未知（502）→ 一次性自动对账：同 requestId 幂等重发（服务端同载荷 replayed/新回执裁决，
    // 不产生重复投递、不换新 ID）。只排程一次；代际更替则放弃。
    const scheduleReconcile = () => {
      if (reconcilesRef.current.has(requestId)) return;
      reconcilesRef.current.add(requestId);
      window.setTimeout(() => {
        if (epochRef.current !== myEpoch || clientRef.current !== c) return;
        void c.sendMessage(cid, { requestId, audience, text }).then((r2) => {
          if (epochRef.current !== myEpoch) return;
          setLiveMessages((prev) => prev.map((m) => (m.requestId === requestId
            ? { ...m, state: 'sent' as const, replayed: true }
            : m)));
          setReconciling(false);
          void apiRef.current?.refresh();
          void r2;
        }).catch(() => {
          // 对账仍未知：保持 unknown/对账中（不标成功也不标失败），等下一条事件或快照确认
        });
      }, RECONCILE_DELAY_MS);
    };
    try {
      const r = await c.sendMessage(cid, { requestId, audience, text });
      if (epochRef.current !== myEpoch) return { ok: true, requestId };
      setLiveMessages((prev) => prev.map((m) => (m.id === localId
        ? { ...m, state: 'sent' as const, replayed: r.replayed === true }
        : m)));
      return { ok: true, requestId };
    } catch (e) {
      if (epochRef.current !== myEpoch) return { ok: false, requestId };
      const err = e as EdgeHttpError;
      if (err.status === 502) {
        // 结果未知：不标成功也不标失败，进入对账态；同 requestId 幂等对账已排程
        setLiveMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, state: 'unknown' as const } : m)));
        setReconciling(true);
        setError('消息投递结果未知：对账中（同请求幂等对账，不自动换 ID 重发）');
        scheduleReconcile();
        return { ok: false, requestId, code: 'UPSTREAM_UNKNOWN', message: '投递结果未知，对账中' };
      }
      setLiveMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, state: 'failed' as const, code: err.code } : m)));
      return { ok: false, requestId, code: err.code, message: err.message };
    }
  }, []);

  // 卸载清理：停流 + 全部已登记定时器（复核 P2：卸载不清 1500ms 重连定时器 → 已修）
  useEffect(() => () => {
    epochRef.current += 1;
    stopRef.current?.();
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
  }, []);

  const api: EdgeLiveApi = useMemo(() => ({
    phase, session, buildId, capabilities, readiness, customerId, snapshot, snapshotVersion, eventWindow, freshness,
    notes, lastEvent, error, reconciling, liveMessages,
    client: clientRef.current,
    connect,
    disconnect,
    refresh,
    setReconciling,
    sendLiveMessage,
  }), [phase, session, buildId, capabilities, readiness, customerId, snapshot, snapshotVersion, eventWindow, freshness, notes, lastEvent, error, reconciling, liveMessages, connect, disconnect, refresh, sendLiveMessage]);

  apiRef.current = api;
  return api;
}
