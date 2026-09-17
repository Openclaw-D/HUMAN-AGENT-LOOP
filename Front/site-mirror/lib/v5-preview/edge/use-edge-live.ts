// Edge 接线·React hook（任务三 C2；任务03 C3 收紧）：连接生命周期 + 快照/事件游标管理。
// 纪律：成功勾/警报只由"新业务事件到达"触发；重连与回放不重复提示（按 eventId 去重）；
// 关键命令返回未知 → 显示"对账中"，不以本地状态冒充成功；快照以服务端为准（事件到达→重取）。
// 任务03：撤权/会话失效（auth 帧、HTTP 401/403）为终止性——转未连接态并要求重认证，绝不自动重连
// 复活旧会话；live 聊天只追加服务端回执状态（sending→sent/unknown/failed），失败不回退本地模拟。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEdgeClient, EdgeHttpError, type EdgeClient, type EdgeSessionInfo, type ReadyzResponse } from './edge-client';
import { type EdgeLiveMessage, type EdgePhase, type EdgeSnapshotShapes } from './edge-logic';

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
  freshness: Record<string, { ok: boolean; at: string; code?: string; note?: string }> | null;
  notes: string[];
  lastEvent: { eventId: string; type: string; at: string } | null;
  error: string | null;
  reconciling: boolean; // 关键命令未知（502 UPSTREAM_UNKNOWN）→ true，直到快照确认
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
  const phaseRef = useRef<EdgePhase>('off');
  phaseRef.current = phase;
  const liveRef = useRef<boolean>(false);
  liveRef.current = phase === 'live' || phase === 'reconnecting';

  const scheduleRefresh = useCallback((customerIdArg: string) => {
    if (refreshTimerRef.current !== null) return; // 防抖：事件风暴下最多 ~200ms 一次快照重取
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void apiRef.current?.refresh();
    }, 200);
  }, []);

  // 终态：撤权/会话失效——清会话转 off，要求重新认证；旧会话不复活（任务03 C1.2）
  const terminateForAuth = useCallback((c: EdgeClient, detail: string) => {
    stopRef.current?.();
    stopRef.current = null;
    c.endSession();
    clientRef.current = null;
    setPhase('off');
    setSession(null);
    setError(detail);
  }, []);

  const subscribeEvents = useCallback((c: EdgeClient, customerIdArg: string) => {
    stopRef.current?.();
    stopRef.current = c.openEvents(customerIdArg, cursorRef.current, {
      onCursor: (cur) => { cursorRef.current = cur; },
      onEvent: (env) => {
        if (seenEventsRef.current.has(env.eventId)) return; // 至少一次投递 → 客户端去重（重连不重复提示）
        seenEventsRef.current.add(env.eventId);
        setLastEvent({ eventId: env.eventId, type: env.payloadRef?.type ?? 'unknown', at: new Date().toISOString() });
        setReconciling(false);
        scheduleRefresh(customerIdArg);
      },
      onResync: () => {
        cursorRef.current = null;
        void apiRef.current?.refresh();
        stopRef.current?.();
        if (liveRef.current) subscribeEvents(c, customerIdArg);
      },
      onAuth: (info) => {
        terminateForAuth(c, `真实后台订阅已终止（${info?.code ?? 'AUTH'}）：${info?.note || '权限变更或会话失效'}，请重新连接`);
      },
      onDrop: (reason, status) => {
        if (phaseRef.current === 'off' || phaseRef.current === 'ended') return;
        if (status === 401 || status === 403) {
          // 会话失效（TTL 过期/权限变更）：终态，不无限重连（复核 P3④）
          terminateForAuth(c, '会话已失效（服务端 401/403）：请重新连接换取新会话');
          return;
        }
        stopRef.current?.();
        stopRef.current = null;
        setPhase('reconnecting');
        setError(`事件流断开（${reason}）；正在重连，不做本地状态补写`);
        window.setTimeout(() => {
          if (phaseRef.current === 'reconnecting') subscribeEvents(c, customerIdArg);
        }, 1500);
      },
    });
  }, [scheduleRefresh, terminateForAuth]);

  const apiRef = useRef<EdgeLiveApi | null>(null);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    const cid = customerId;
    if (!c || !cid || !c.session) return;
    try {
      const ws = await c.workspace(cid);
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
      setFreshness(ws.projection?.freshness ?? null);
      setEventWindow(ws.eventWindow ?? null);
      setReconciling(false);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
    } catch (e) {
      const err = e as EdgeHttpError;
      if (err.status === 502) { setReconciling(true); setError('后端暂不可达：显示"对账/滞后"状态，不冒充成功'); }
      else if (err.status === 401 || err.status === 403) {
        // 快照面被拒（撤权/过期）：与 SSE auth 同语义，终止而非重试
        terminateForAuth(c, `真实后台拒绝本会话（${err.code}）：请重新连接`);
      }
      else setError(`工作台刷新失败：${err.code}`);
      if (liveRef.current && clientRef.current) setPhase('reconnecting');
    }
  }, [customerId, terminateForAuth]);

  const connect = useCallback(async (baseUrl: string, credential: string, customerIdArg: string) => {
    setError(null);
    setPhase('connecting');
    const c = createEdgeClient({ baseUrl });
    clientRef.current = c;
    try {
      const s = await c.exchange(credential);
      setSession(s);
      const vz = await c.versionz().catch(() => ({ buildId: undefined, capabilities: undefined }));
      setBuildId(vz.buildId ?? null);
      setCapabilities((vz.capabilities as Record<string, unknown> | undefined) ?? null);
      const rz = await c.readyz().catch(() => null);
      setReadiness(rz);
      setCustomerId(customerIdArg);
      cursorRef.current = null;
      seenEventsRef.current = new Set();
      setLiveMessages([]);
      const ws = await c.workspace(customerIdArg);
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
      setFreshness(ws.projection?.freshness ?? null);
      setEventWindow(ws.eventWindow ?? null);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
      setPhase('live');
      subscribeEvents(c, customerIdArg);
    } catch (e) {
      setPhase('off');
      clientRef.current = null;
      const err = e as EdgeHttpError;
      setError(err instanceof EdgeHttpError ? `连接失败：${err.code}（${err.message}）` : `连接失败：${String(e)}`);
    }
  }, [subscribeEvents]);

  const disconnect = useCallback(() => {
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
  }, []);

  const sendLiveMessage = useCallback(async (text: string, audience: 'customer' | 'internal') => {
    const c = clientRef.current;
    const cid = customerId;
    if (!c || !cid || !c.session) return { ok: false, code: 'NO_SESSION', message: '未连接真实后台' };
    const requestId = `ui-msg-${cid}-${Date.now()}`.slice(0, 128);
    const localId = `${requestId}-m`;
    const optimistic: EdgeLiveMessage = { id: localId, requestId, at: new Date().toISOString(), audience, text, state: 'sending' };
    setLiveMessages((prev) => [...prev, optimistic]);
    try {
      const r = await c.sendMessage(cid, { requestId, audience, text });
      setLiveMessages((prev) => prev.map((m) => (m.id === localId
        ? { ...m, state: 'sent' as const, replayed: r.replayed === true }
        : m)));
      return { ok: true, requestId };
    } catch (e) {
      const err = e as EdgeHttpError;
      if (err.status === 502) {
        // 结果未知：不标成功也不标失败，进入对账态；可用同 requestId 查回执
        setLiveMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, state: 'unknown' as const } : m)));
        setReconciling(true);
        setError('消息投递结果未知：对账中（以回执/快照为准，不自动重发）');
        return { ok: false, requestId, code: 'UPSTREAM_UNKNOWN', message: '投递结果未知，对账中' };
      }
      setLiveMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, state: 'failed' as const, code: err.code } : m)));
      return { ok: false, requestId, code: err.code, message: err.message };
    }
  }, [customerId]);

  useEffect(() => () => {
    stopRef.current?.();
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
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
