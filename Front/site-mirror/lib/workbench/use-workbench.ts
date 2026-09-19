// goal-03c 客户工作本·React hook：登录会话生命周期 + 客户打开/切换 + 快照/事件。
// 复用 use-edge-live 的纪律（代际守卫/终态不复活/事件去重/退避重连），但连接流不同：
// 先登录（会话先于客户），后打开客户；切换客户不换会话。动作类操作由面板直接调 client，
// 未知结果（502）的对账入口统一在结果面板（requestId 查询），hook 不代重发业务命令。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EdgeHttpError, type EdgeSessionInfo } from '../v5-preview/edge/edge-client';
import { createWbClient, type WbClient, type IdentityMeta } from './wb-client';
import { clearRecent } from './recent-store';
import { type EdgePhase, type EdgeSnapshotShapes } from '../v5-preview/edge/edge-logic';

const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 30_000;
const MAX_SEEN_EVENTS = 5000;

export interface WbState {
  phase: EdgePhase;
  session: EdgeSessionInfo | null;
  identities: IdentityMeta[] | null;
  buildId: string | null;
  customerId: string | null;
  snapshot: EdgeSnapshotShapes | null;
  snapshotVersion: number | string;
  notes: string[];
  error: string | null;
  lastEvent: { type: string; at: string } | null;
}

export interface WbApi extends WbState {
  client: WbClient | null;
  loginWithIdentity(principalId: string): Promise<void>;
  loginWithCredential(credential: string): Promise<void>;
  redeemCode(code: string): Promise<{ ok: boolean; credential?: string; customerId?: string; customerName?: string | null; replayed?: boolean; note?: string; role?: string; allowedKinds?: string[] }>;
  enterCustomerPortal(customerId: string): void;
  logout(): void;
  openCustomer(customerId: string): Promise<boolean>;
  closeCustomer(): void;
  refresh(): Promise<void>;
  setError(msg: string | null): void;
}

export function useWorkbench(baseUrl: string): WbApi {
  const [phase, setPhase] = useState<EdgePhase>('off');
  const [session, setSession] = useState<EdgeSessionInfo | null>(null);
  const [identities, setIdentities] = useState<IdentityMeta[] | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EdgeSnapshotShapes | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<number | string>(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<WbState['lastEvent']>(null);

  const clientRef = useRef<WbClient | null>(null);
  const apiSelfRef = useRef<WbApi | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const epochRef = useRef(0);
  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customerId;
  const sessionRef = useRef<EdgeSessionInfo | null>(null);
  sessionRef.current = session;
  const phaseRef = useRef<EdgePhase>('off');
  phaseRef.current = phase;
  const backoffRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) { window.clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (refreshTimerRef.current !== null) { window.clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void apiSelfRef.current?.refresh();
    }, 200);
  }, []);

  const stopStream = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  function subscribe(c: WbClient, cid: string, myEpoch: number) {
    const alive = () => epochRef.current === myEpoch && clientRef.current === c;
    stopStream();
    stopRef.current = c.openEvents(cid, cursorRef.current, {
      onEvent: (env) => {
        if (!alive()) return;
        if (seenRef.current.has(env.eventId)) return;
        seenRef.current.add(env.eventId);
        if (seenRef.current.size > MAX_SEEN_EVENTS) {
          const oldest = seenRef.current.values().next().value;
          if (oldest !== undefined) seenRef.current.delete(oldest);
        }
        setLastEvent({ type: env.payloadRef?.type ?? 'unknown', at: new Date().toISOString() });
        scheduleRefresh();
      },
      onCursor: (cur) => { if (alive()) cursorRef.current = cur; },
      onOpen: () => {
        if (!alive()) return;
        backoffRef.current = 0;
        setPhase('live');
        setError((prev) => (prev !== null && prev.startsWith('事件流断开') ? null : prev));
      },
      onResync: () => {
        if (!alive()) return;
        cursorRef.current = null;
        void apiSelfRef.current?.refresh();
        stopStream();
        setPhase('reconnecting');
        scheduleResubscribe(c, cid, myEpoch, 5000);
      },
      onAuth: (info) => {
        if (!alive()) return;
        // 撤权/会话过期：终态——清会话回登录，不自动复活（真实模式失败状态不转模拟成功）
        epochRef.current += 1;
        clearTimers();
        stopStream();
        c.endSession();
        clientRef.current = null;
        setPhase('off');
        setSession(null);
        setSnapshot(null);
        setCustomerId(null);
        setError(`后台终止了本会话订阅（${info?.code ?? 'AUTH'}）：${info?.note || '权限变更或会话失效'}，请重新登录`);
      },
      onDrop: (reason, status) => {
        if (!alive()) return;
        if (phaseRef.current === 'off' || phaseRef.current === 'ended') return;
        if (status === 401 || status === 403) {
          epochRef.current += 1;
          clearTimers();
          stopStream();
          c.endSession();
          clientRef.current = null;
          setPhase('off');
          setSession(null);
          setError('会话已失效（服务端 401/403）：请重新登录');
          return;
        }
        stopStream();
        setPhase('reconnecting');
        setError(`事件流断开（${reason}）；正在退避重连，不做本地状态补写`);
        scheduleResubscribe(c, cid, myEpoch, RECONNECT_MAX_MS);
      },
    });
  }

  const scheduleResubscribe = useCallback((c: WbClient, cid: string, myEpoch: number, maxMs: number) => {
    if (reconnectTimerRef.current !== null) { window.clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    const attempt = backoffRef.current;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, maxMs);
    backoffRef.current = attempt + 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (epochRef.current === myEpoch && clientRef.current === c && customerIdRef.current === cid && phaseRef.current !== 'off') {
        subscribe(c, cid, myEpoch);
      }
    }, delay);
  }, [clearTimers, stopStream]);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    const cid = customerIdRef.current;
    const myEpoch = epochRef.current;
    if (!c || !cid || !c.session) return;
    try {
      const ws = await c.workspace(cid);
      if (epochRef.current !== myEpoch) return;
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
    } catch (e) {
      if (epochRef.current !== myEpoch) return;
      const err = e as EdgeHttpError;
      if (err.status === 401 || err.status === 403) {
        epochRef.current += 1;
        clearTimers();
        stopStream();
        c.endSession();
        clientRef.current = null;
        setPhase('off');
        setSession(null);
        setError(`后台拒绝本会话（${err.code}）：请重新登录`);
      } else if (err.status === 404) {
        epochRef.current += 1;
        clearTimers();
        stopStream();
        setPhase('off');
        setSnapshot(null);
        setCustomerId(null);
        setError(`客户 ${cid} 已不可读（可能已撤权或被删除）`);
      } else {
        setError(`工作台刷新失败：${err.code}`);
      }
    }
  }, [clearTimers, stopStream]);

  const doLogin = useCallback(async (login: (c: WbClient) => Promise<EdgeSessionInfo>) => {
    epochRef.current += 1;
    clearTimers();
    stopStream();
    setError(null);
    const c = createWbClient({ baseUrl });
    try {
      const s = await login(c);
      clientRef.current = c;
      setSession(s);
      setPhase('connecting');
      const vz = await c.versionz().catch(() => ({ buildId: undefined }));
      setBuildId(vz.buildId ?? null);
    } catch (e) {
      clientRef.current = null;
      setPhase('off');
      const err = e as EdgeHttpError;
      setError(err instanceof EdgeHttpError ? `登录失败：${err.code}（${err.message}）` : `登录失败：${String(e)}`);
      throw e;
    }
  }, [baseUrl, clearTimers, stopStream]);

  const loginWithIdentity = useCallback(async (principalId: string) => {
    await doLogin((c) => c.exchangeByPrincipal(principalId));
  }, [doLogin]);

  const loginWithCredential = useCallback(async (credential: string) => {
    await doLogin((c) => c.exchangeCredential(credential));
  }, [doLogin]);

  // 邀请码兑换是匿名口（尚未有任何会话）：用一次性客户端调用，不依赖登录态。
  const redeemCode = useCallback(async (code: string) => {
    const c = createWbClient({ baseUrl });
    return c.redeemInvitation(code);
  }, [baseUrl]);

  // 客户联系人视图：不打开内部工作本快照（A 对客户身份禁内部聚合面），仅登记客户上下文。
  const enterCustomerPortal = useCallback((cid: string) => {
    epochRef.current += 1;
    clearTimers();
    stopStream();
    setError(null);
    setSnapshot(null);
    setCustomerId(cid);
    setPhase('live');
  }, [clearTimers, stopStream]);

  // 登录页加载受控身份目录（无凭据明文；未配置 → null）
  useEffect(() => {
    let dead = false;
    const c = createWbClient({ baseUrl });
    void c.identities().then((list) => { if (!dead) setIdentities(list); }).catch(() => { if (!dead) setIdentities(null); });
    return () => { dead = true; };
  }, [baseUrl]);

  const openCustomer = useCallback(async (cid: string) => {
    const c = clientRef.current;
    if (!c || !c.session) { setError('请先登录'); return false; }
    epochRef.current += 1;
    const myEpoch = epochRef.current;
    clearTimers();
    stopStream();
    setError(null);
    setPhase('connecting');
    setSnapshot(null);
    setCustomerId(cid);
    cursorRef.current = null;
    seenRef.current = new Set();
    try {
      const ws = await c.workspace(cid);
      if (epochRef.current !== myEpoch) return false;
      setSnapshot(ws.snapshot);
      setSnapshotVersion(ws.snapshotVersion);
      setNotes(ws.projection?.notes ?? []);
      if (ws.eventCursor) cursorRef.current = ws.eventCursor;
      setPhase('live');
      subscribe(c, cid, myEpoch);
      return true;
    } catch (e) {
      if (epochRef.current !== myEpoch) return false;
      setPhase('off');
      setCustomerId(null);
      const err = e as EdgeHttpError;
      setError(err.status === 404 ? `客户 ${cid} 不存在或当前身份无权查看` : `打开客户失败：${err.code}（${err.message}）`);
      return false;
    }
  }, [clearTimers, stopStream]);

  const closeCustomer = useCallback(() => {
    epochRef.current += 1;
    clearTimers();
    stopStream();
    setCustomerId(null);
    setSnapshot(null);
    setPhase(session ? 'connecting' : 'off');
  }, [clearTimers, session, stopStream]);

  const logout = useCallback(() => {
    const s = sessionRef.current;
    // 退出清理当前身份的最近访问桶（最近访问按身份分区，见 recent-store）
    if (s) clearRecent(s.principalId);
    epochRef.current += 1;
    clearTimers();
    stopStream();
    clientRef.current?.endSession();
    clientRef.current = null;
    setSession(null);
    setCustomerId(null);
    setSnapshot(null);
    setPhase('off');
    setError(null);
  }, [clearTimers, stopStream]);

  useEffect(() => () => {
    epochRef.current += 1;
    stopRef.current?.();
    clearTimers();
  }, [clearTimers]);

  const api: WbApi = useMemo(() => ({
    phase, session, identities, buildId, customerId, snapshot, snapshotVersion, notes, error, lastEvent,
    client: clientRef.current,
    loginWithIdentity, loginWithCredential, redeemCode, enterCustomerPortal, logout, openCustomer, closeCustomer, refresh,
    setError,
  }), [phase, session, identities, buildId, customerId, snapshot, snapshotVersion, notes, error, lastEvent, loginWithIdentity, loginWithCredential, redeemCode, enterCustomerPortal, logout, openCustomer, closeCustomer, refresh]);

  apiSelfRef.current = api;
  return api;
}
