// Edge 接线·React hook（任务三 C2）：连接生命周期 + 快照/事件游标管理。
// 纪律：成功勾/警报只由"新业务事件到达"触发；重连与回放不重复提示（按 eventId 去重）；
// 关键命令返回未知 → 显示"对账中"，不以本地状态冒充成功；快照以服务端为准（事件到达→重取）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEdgeClient, EdgeHttpError, type EdgeClient, type EdgeSessionInfo } from './edge-client';
import { type EdgePhase, type EdgeSnapshotShapes } from './edge-logic';

export interface EdgeLiveState {
  phase: EdgePhase;
  session: EdgeSessionInfo | null;
  buildId: string | null;
  customerId: string | null;
  snapshot: EdgeSnapshotShapes | null;
  snapshotVersion: number;
  notes: string[];
  lastEvent: { eventId: string; type: string; at: string } | null;
  error: string | null;
  reconciling: boolean; // 关键命令未知（502 UPSTREAM_UNKNOWN）→ true，直到快照确认
}

export interface EdgeLiveApi extends EdgeLiveState {
  client: EdgeClient | null;
  connect(baseUrl: string, credential: string, customerId: string): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  setReconciling(v: boolean): void;
}

export function useEdgeLive(): EdgeLiveApi {
  const [phase, setPhase] = useState<EdgePhase>('off');
  const [session, setSession] = useState<EdgeSessionInfo | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EdgeSnapshotShapes | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [lastEvent, setLastEvent] = useState<EdgeLiveState['lastEvent']>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const clientRef = useRef<EdgeClient | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cursorRef = useRef<string | null>(null);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);
  const phaseRef = useRef<EdgePhase>('off');
  phaseRef.current = phase;

  const scheduleRefresh = useCallback((customerIdArg: string) => {
    if (refreshTimerRef.current !== null) return; // 防抖：事件风暴下最多 ~200ms 一次快照重取
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void apiRef.current?.refresh();
    }, 200);
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
        if (phaseRef.current === 'live') subscribeEvents(c, customerIdArg);
      },
      onDrop: (reason) => {
        stopRef.current?.();
        stopRef.current = null;
        if (phaseRef.current === 'off' || phaseRef.current === 'ended') return;
        setPhase('reconnecting');
        setError(`事件流断开（${reason}）；正在重连，不做本地状态补写`);
        window.setTimeout(() => {
          if (phaseRef.current === 'reconnecting') subscribeEvents(c, customerIdArg);
        }, 1500);
      },
    });
  }, [scheduleRefresh]);

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
      setReconciling(false);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
    } catch (e) {
      const err = e as EdgeHttpError;
      if (err.status === 502) { setReconciling(true); setError('后端暂不可达：显示"对账/滞后"状态，不冒充成功'); }
      else setError(`工作台刷新失败：${err.code}`);
      if (phaseRef.current === 'live') setPhase('reconnecting');
    }
  }, [customerId]);

  const connect = useCallback(async (baseUrl: string, credential: string, customerIdArg: string) => {
    setError(null);
    setPhase('connecting');
    const c = createEdgeClient({ baseUrl });
    clientRef.current = c;
    try {
      const s = await c.exchange(credential);
      setSession(s);
      const vz = await c.versionz().catch(() => ({ buildId: undefined }));
      setBuildId(vz.buildId ?? null);
      setCustomerId(customerIdArg);
      cursorRef.current = null;
      seenEventsRef.current = new Set();
      const ws = await c.workspace(customerIdArg);
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
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

  useEffect(() => () => {
    stopRef.current?.();
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  const api: EdgeLiveApi = useMemo(() => ({
    phase, session, buildId, customerId, snapshot, snapshotVersion, notes, lastEvent, error, reconciling,
    client: clientRef.current,
    connect,
    disconnect,
    refresh,
    setReconciling,
  }), [phase, session, buildId, customerId, snapshot, snapshotVersion, notes, lastEvent, error, reconciling, connect, disconnect, refresh]);

  apiRef.current = api;
  return api;
}
