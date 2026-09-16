"use client";

// V6 远程尽调 · 会议视图（REMOTE_DD_REPAIR 返修版）。同一 Web，mobile/desktop 仅布局差异。
// F1：写请求"不可变原请求"——发送前持久化 {path, body(含 requestId), owner, op, 草稿修订}，
// NETWORK 未知后同载荷原样重试（不借新 ID 冒充）；确定性结果（含 409）清记录；
// 刷新/离开返回后恢复记录条（原样重试 / 显式放弃）；提问草稿按 requestId+修订关联清除。
// F2：暂停态的阻断在服务端（SESSION_PAUSED）；前端仅如实呈现。
// F5：圈选 Pointer Events（capture/cancel/钳制，触摸/鼠标/笔统一）+ 数字输入替代标疑；
// 手机首屏优先：会话状态/视频如实提示/证据入口/问题，参会人折叠，角色中文，技术 ID 收进详情。
// C：本地拍照/预览面板（用户主动，仅本地，不上传不入库）。
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CameraPanel from './camera-panel';
import styles from '../preview.module.css';

// ---------------------------------------------------------------------------
// 轻量远端 API 客户端
// ---------------------------------------------------------------------------

interface RemoteApiFailure extends Error {
  code: string;
  serverVersion?: number;
}

function toFailure(payload: unknown, status: number): RemoteApiFailure {
  const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const err = new Error(typeof o.message === 'string' ? o.message : `请求失败（HTTP ${status}）`) as RemoteApiFailure;
  err.code = typeof o.error === 'string' ? o.error : `HTTP_${status}`;
  if (typeof o.serverVersion === 'number') err.serverVersion = o.serverVersion;
  return err;
}

async function postRemote(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/v5-preview/remote-session/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw toFailure({ error: 'NETWORK', message: '网络异常：未收到服务端确认' }, 0);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw toFailure(payload, response.status);
  return (payload ?? {}) as Record<string, unknown>;
}

async function getRemote<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v5-preview/remote-session/${path}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw toFailure(payload, response.status);
  return (payload ?? {}) as T;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function userFacing(code: string, message: string | undefined): string {
  if (code === 'NETWORK') return '网络异常：未收到服务端确认，可原样重试（同一请求）';
  if (code === 'VERSION_CONFLICT') return '状态已被其他窗口更新，请重试（内容已保留）';
  if (code === 'SESSION_PAUSED') return '本轮判断已暂停：该操作被服务端阻断（补证/纠正类仍可用）';
  if (code === 'REQUEST_MISMATCH') return '请求状态不一致，请刷新后重试';
  if (code === 'NOT_FOUND') return '目标不存在（跨会话/跨项目资源不可访问）';
  if (code === 'INVALID_INPUT') return message ?? '输入不符合要求，请检查后重试';
  if (code === 'REMOTE_STORE_CORRUPT' || code === 'REMOTE_STORE_UNAVAILABLE') return '远程尽调数据暂不可用，请稍后重试';
  return message ?? '服务暂不可用，请稍后重试';
}

// ---------------------------------------------------------------------------
// F1：不可变请求记录（sessionStorage 持久化；非业务事实源，服务端仍是真相）
// ---------------------------------------------------------------------------

interface PendingRemoteRequest {
  path: string;
  body: Record<string, unknown>; // 完整原载荷（含 requestId）
  ownerSessionId: string;
  op: string;
  savedAt: number;
  draftRevision: number | null;
}

const PENDING_REQUEST_KEY = 'jw:v5-preview:remote-pending-request';

function readPendingRequest(): PendingRemoteRequest | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_REQUEST_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as PendingRemoteRequest;
    if (typeof parsed.path !== 'string' || typeof parsed.body !== 'object' || parsed.body === null || typeof parsed.ownerSessionId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingRequest(record: PendingRemoteRequest | null): void {
  try {
    if (record === null) window.sessionStorage.removeItem(PENDING_REQUEST_KEY);
    else window.sessionStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(record));
  } catch {
    // 存储不可用：记录仅保留在内存（本次会话重试仍可用），刷新后无法恢复——如实提示。
  }
}

/** 业务载荷同一性：比较去掉 requestId 后的 body（requestId 由记录冻结）。 */
function sameBusinessBody(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (o: Record<string, unknown>) => {
    const { requestId: _r, ...rest } = o;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

interface SessionDetail {
  ok: boolean;
  remoteVersion: number;
  session: {
    sessionId: string; projectId: string; title: string; status: string; generation: number;
    participants: { participantId: string; displayName: string; kind: string; domainRole: string; attendance: string; attendanceVerified: boolean; joined: boolean }[];
    video: { provider: string; state: string; message: string };
  };
  evidence: { evidenceId: string; fixtureId: string; title: string; version: number; verificationStatus: string; expired: boolean; sha256: string; digestOf?: string; supersededBy: string | null; capturedAt: string }[];
  annotations: { annotationId: string; evidenceId: string; evidenceVersion: number; rect: { x: number; y: number; w: number; h: number }; question: string; author: string; status: string; version: number; expired?: boolean; replies: { replyId: string; kind: string; author: string; text: string; at: string }[] }[];
  reviews: { reviewId: string; targetType: string; targetId: string; targetVersion: number; action: string; opinion: string; reviewer: string; at: string }[];
  calculations: { calcId: string; status: string; stale?: boolean; reasons: string[]; inputs: { label: string; value: number | null; unit: string; source: string }[]; result: { kind: string; net?: number; totalCashFlow?: number; totalCost?: number }; at: string }[];
  ruleConfig: { status: string; layers: Record<string, unknown> };
}

const FIXTURE_OPTIONS = [
  { id: 'fixture-inspection', label: '附着现场巡检（合成）' },
  { id: 'fixture-equipment', label: '附着设备清单（合成）' },
  { id: 'fixture-contract', label: '附着合同要素（合成）' },
];

const ATTENDANCE_LABEL: Record<string, string> = {
  on_site_declared: '自报在现场',
  on_site_confirmed: '现场已确认',
  live_only: '仅实时入会',
  pending: '待入会',
  absent: '缺席',
};

const ROLE_LABEL: Record<string, string> = {
  coordinator: '见微协调',
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
  'customer-actual-controller': '客户·实控人',
  'customer-finance': '客户·财务',
  'customer-production': '客户·生产',
};

const REVIEW_ACTIONS = ['confirm', 'correct', 'request_resupply', 'request_retake', 'pause_round', 'resume_round', 'escalate_human'];
const REVIEW_ACTION_LABEL: Record<string, string> = {
  confirm: '确认可见内容', correct: '纠正', request_resupply: '要求补充',
  request_retake: '要求重拍', pause_round: '暂停本轮判断', resume_round: '恢复本轮（显式）', escalate_human: '转人工',
};

export default function RemoteSessionPage() {
  const [phase, setPhase] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null); // F1：确定性失败就近显示
  const [pendingRecord, setPendingRecord] = useState<PendingRemoteRequest | null>(null); // F1：未知请求恢复条
  const [simulationOn, setSimulationOn] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false); // F5：手机首屏折叠
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [manualRect, setManualRect] = useState<Record<'x' | 'y' | 'w' | 'h', string>>({ x: '', y: '', w: '', h: '' }); // F5：数字输入替代标疑
  const [question, setQuestion] = useState('');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [reviewDraft, setReviewDraft] = useState<Record<string, { action: string; opinion: string }>>({});
  const [calcResult, setCalcResult] = useState<SessionDetail['calculations'] | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const questionRevisionRef = useRef(0); // F1：提问草稿修订标识
  const draftAssocRef = useRef<{ requestId: string; revision: number } | null>(null);

  const session = detail?.session ?? null;
  const activeEvidence = detail?.evidence.find((e) => e.evidenceId === activeEvidenceId) ?? null;

  const loadDetail = useCallback(async (sessionId: string): Promise<void> => {
    const data = await getRemote<SessionDetail>(`detail?sessionId=${encodeURIComponent(sessionId)}`);
    setDetail(data);
    setRemoteVersion(data.remoteVersion);
    setPhase('ready');
  }, []);

  const loadState = useCallback(async (): Promise<void> => {
    const data = await getRemote<{ remoteVersion: number; sessions: { sessionId: string }[] }>('');
    setRemoteVersion(data.remoteVersion);
    const existing = data.sessions[0];
    if (existing === undefined) {
      setPhase('empty');
      return;
    }
    await loadDetail(existing.sessionId);
  }, [loadDetail]);

  useEffect(() => {
    // F1：挂载恢复未知请求记录（刷新/离开返回后仍可原样重试或显式放弃）
    const timer = window.setTimeout(() => {
      setPendingRecord(readPendingRequest());
      loadState().catch((e) => {
        setPhase('error');
        setLoadError(typeof (e as RemoteApiFailure).code === 'string' ? userFacing((e as RemoteApiFailure).code, (e as RemoteApiFailure).message) : '服务暂不可用');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadState]);

  /** F1：统一写动作。发送前持久化完整原请求；NETWORK 保留记录（可原样重试/显式放弃）；
   *  确定性结果清记录；409 刷新版本与详情；提问草稿按 requestId+修订关联清除。 */
  const runWrite = useCallback(async (path: string, body: Record<string, unknown>, op: string, done: (data: Record<string, unknown>) => void, sessionId: string, draftRevision: number | null = null) => {
    setBusy(true);
    setNotice(null);
    setWriteError(null);
    // 原样重试判定：存在同 path 同 op 同业务载荷的未知记录 → 复用其 requestId（不借新 ID 冒充重试）。
    const existing = readPendingRequest();
    const isRetry = existing !== null && existing.path === path && existing.op === op && existing.ownerSessionId === sessionId && sameBusinessBody(existing.body, body);
    const requestId = isRetry && existing !== null ? (existing.body.requestId as string) : newRequestId();
    const fullBody = { ...body, requestId, sessionId };
    // 发送前落盘（覆盖发送中刷新窗口）；草稿修订仅对提问类记录有意义。
    writePendingRequest({ path, body: fullBody, ownerSessionId: sessionId, op, savedAt: Date.now(), draftRevision: op === 'annotation' ? draftRevision : null });
    if (op === 'annotation' && draftRevision !== null) draftAssocRef.current = { requestId, revision: draftRevision };
    try {
      const data = await postRemote(path, fullBody);
      // 确定性结果：清记录。
      writePendingRequest(null);
      setPendingRecord(null);
      // F1：提问草稿清空门——本次发出的 requestId + 提交时修订 + 当前修订三者一致才清。
      if (op === 'annotation') {
        const assoc = draftAssocRef.current;
        if (assoc !== null && assoc.requestId === requestId && assoc.revision === draftRevision && questionRevisionRef.current === draftRevision) {
          setQuestion('');
          questionRevisionRef.current = 0;
          draftAssocRef.current = null;
        }
      }
      if (typeof data.remoteVersion === 'number') setRemoteVersion(data.remoteVersion);
      done(data);
      if (session !== null && sessionId === session.sessionId) await loadDetail(sessionId).catch(() => undefined);
    } catch (e) {
      const f = e as RemoteApiFailure;
      if (f.code === 'NETWORK') {
        // 结果未知：记录保留（已落盘），提供原样重试入口。
        setPendingRecord(readPendingRequest());
        setNotice('网络异常：未收到服务端确认。可点击『原样重试』（同一请求，幂等安全）或『放弃该请求』。');
      } else {
        // 确定性失败（含 409 明确未提交）：清记录；409 额外刷新版本与详情。
        writePendingRequest(null);
        setPendingRecord(null);
        setWriteError(userFacing(f.code, f.message));
        if (f.code === 'VERSION_CONFLICT') {
          if (session !== null && sessionId === session.sessionId) await loadDetail(sessionId).catch(() => undefined);
          else await loadState().catch(() => undefined);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadState, session]);

  /** F1：恢复条"原样重试"——按记录的完整原载荷重发（同 requestId）。
   *  归属检查：记录不属于当前会话时不自动重放（提示显式处理）。 */
  const retryPending = useCallback(async (): Promise<void> => {
    const record = readPendingRequest();
    if (record === null) { setPendingRecord(null); return; }
    if (session === null || record.ownerSessionId !== session.sessionId) {
      setNotice('该未知请求属于其他会话或会话已变化：请先"放弃该请求"或返回对应会话处理。');
      return;
    }
    await runWrite(record.path, record.body, record.op, () => setNotice('原样重试成功：同一请求已确认。'), record.ownerSessionId, record.draftRevision);
  }, [runWrite, session]);

  function discardPending(): void {
    writePendingRequest(null);
    setPendingRecord(null);
    setNotice('已放弃该未知请求（不产生任何写入）。');
  }

  async function createSession(): Promise<void> {
    await runWrite('', { title: 'JW-2026-018 · 远程尽调（合成演示）', expectedVersion: remoteVersion }, 'create-session', (data) => {
      const created = data.session as SessionDetail['session'];
      if (created !== undefined) void loadDetail(created.sessionId);
    }, '');
  }

  function submitAnnotation(): void {
    if (rect === null || session === null || activeEvidence === null) return;
    const revision = questionRevisionRef.current;
    // F1：提交前建立"草稿-请求关联"（runWrite 成功后按 requestId+修订双判定是否清空提问；
    // 被阻断/内容不同的提交不改写关联——与 rows 域同语义）。
    void runWrite('annotations', {
      evidenceId: activeEvidence.evidenceId,
      evidenceVersion: activeEvidence.version,
      question: question.trim(),
      rect,
      expectedVersion: remoteVersion,
    }, 'annotation', () => {
      setRect(null);
      setNotice('问题已绑定原图版本提交');
    }, session.sessionId, revision);
  }

  if (phase === 'loading' || phase === 'error') {
    return (
      <div className={styles.remoteRoot}>
        <Link className={styles.remoteBack} href="/v5-preview">← 返回项目总览</Link>
        <div className={styles.remoteCard} role={phase === 'error' ? 'alert' : 'status'}>
          {phase === 'error' ? `远程尽调加载失败：${loadError ?? '未知错误'}` : '远程尽调加载中（合成演示）…'}
          {phase === 'error' ? <button type="button" className={styles.remoteBtnSmall} onClick={() => { setPhase('loading'); void loadState(); }}>重试</button> : null}
        </div>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className={styles.remoteRoot}>
        <Link className={styles.remoteBack} href="/v5-preview">← 返回项目总览</Link>
        <div className={styles.remoteCard}>
          <h1 className={styles.remoteTitle}>远程尽调（合成演示）</h1>
          <p className={styles.remoteNote}>尚无远程尽调会话。创建会话后：实控人自报现场→人工按本轮依据确认；证据为显著标记的合成测试图形；视频服务未接入（可显式开启模拟视图）。</p>
          {writeError !== null ? <p className={styles.remoteError} role="alert">{writeError}</p> : null}
          {pendingRecord !== null ? (
            <div className={styles.remotePendingBar} role="status">
              <span>有一条未确认请求（{pendingRecord.op}）：结果未知，可原样重试（幂等）或放弃。</span>
              <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { void retryPending(); }}>原样重试</button>
              <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={discardPending}>放弃该请求</button>
            </div>
          ) : null}
          <button type="button" className={styles.remoteBtn} disabled={busy} onClick={() => { void createSession(); }}>创建远程尽调会话</button>
          {notice !== null ? <p className={styles.remoteError} role="status">{notice}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.remoteRoot}>
      <header className={styles.remoteHeader}>
        <Link className={styles.remoteBack} href="/v5-preview">← 返回项目总览（总览状态与草稿保留）</Link>
        <b className={styles.remoteBadge}>远程尽调 · 合成演示</b>
        <span className={styles.remoteVersion}>
          会话 <details className={styles.remoteIdDetails}><summary>{session?.sessionId.slice(0, 14)}…</summary>{session?.sessionId}</details> · 远端状态 v{remoteVersion}
          {session?.status === 'paused' ? ' · 本轮判断已暂停（模型/确认类被服务端阻断）' : ''}
        </span>
      </header>
      {notice !== null ? <p className={styles.remoteNotice} role="status">{notice}</p> : null}
      {pendingRecord !== null ? (
        <div className={styles.remotePendingBar} role="status">
          <span>有一条未确认请求（{pendingRecord.op}，发送于 {new Date(pendingRecord.savedAt).toLocaleTimeString()}）：结果未知。</span>
          <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { void retryPending(); }}>原样重试（同一请求）</button>
          <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={discardPending}>放弃该请求</button>
        </div>
      ) : null}
      {writeError !== null ? <p className={styles.remoteError} role="alert">{writeError}</p> : null}

      <div className={styles.remoteGrid}>
        {/* 手机首屏第一优先：会话状态 + 视频如实提示 */}
        <section className={`${styles.remoteCard} ${styles.remoteOrderTop}`} aria-label="会话状态">
          <h2 className={styles.remoteH2}>会议状态 · {session?.title}</h2>
          <p className={styles.remoteSessionStatus}>
            状态：{session?.status === 'paused' ? '本轮判断已暂停' : session?.status} · 远端 v{remoteVersion}
          </p>
          <div className={styles.remoteVideo} data-simulation={simulationOn ? 'on' : 'off'}>
            <p className={styles.remoteVideoState}>视频状态：{session?.video.state === 'not_configured' ? '未接入' : session?.video.state}</p>
            <p className={styles.remoteVideoNote}>{session?.video.message}</p>
            {simulationOn ? <p className={styles.remoteSimTag}>模拟会议视图（未接入真实视频，非现场画面）</p> : null}
            <label className={styles.remoteSimToggle}>
              <input type="checkbox" checked={simulationOn} onChange={(e) => setSimulationOn(e.target.checked)} />
              显式开启模拟会议视图（不申请摄像头/麦克风，不采集，不上传）
            </label>
          </div>
        </section>

        {/* 证据/问题/拍照 */}
        <section className={`${styles.remoteCard} ${styles.remoteOrderMid}`} aria-label="证据与标疑">
          <h2 className={styles.remoteH2}>证据（合成测试图形）与本地拍照</h2>
          <div className={styles.remoteFixtures}>
            {FIXTURE_OPTIONS.map((f) => (
              <button key={f.id} type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { void runWrite('evidence', { fixtureId: f.id, expectedVersion: remoteVersion }, 'attach-evidence', () => setNotice(`证据已附着：${f.label}`), session?.sessionId ?? ''); }}>
                {f.label}
              </button>
            ))}
          </div>
          <ul className={styles.remoteEvidenceList}>
            {(detail?.evidence ?? []).map((e) => (
              <li key={e.evidenceId} className={styles.remoteEvidenceItem} data-active={e.evidenceId === activeEvidenceId ? 'yes' : 'no'}>
                <button type="button" className={styles.remoteEvidenceBtn} onClick={() => { setActiveEvidenceId(e.evidenceId); setRect(null); }}>
                  {e.title}
                </button>
                <span className={styles.remoteEvidenceMeta} data-status={e.verificationStatus}>
                  {e.verificationStatus === 'human_verified' ? '人工已核实' : e.verificationStatus === 'contested' ? '有争议' : '未核实'}
                  {e.expired ? ' · 已过期（存在重拍/补充，不再接受新确认）' : ''}
                  {' · '}
                  <details className={styles.remoteIdDetails}>
                    <summary>详情</summary>
                    v{e.version} · sha256({e.digestOf === 'fixture_meta_legacy' ? '旧语义legacy' : '原图字节'})={e.sha256.slice(0, 16)}…
                  </details>
                </span>
              </li>
            ))}
            {(detail?.evidence.length ?? 0) === 0 ? <li className={styles.remoteNote}>尚无证据；点击上方按钮附着合成测试图形。</li> : null}
          </ul>

          {activeEvidence !== null ? (
            <div className={styles.remoteAnnotate}>
              <h3 className={styles.remoteH3}>圈选标疑 · {activeEvidence.title}（v{activeEvidence.version}）{activeEvidence.expired ? '（已过期：仅供查看）' : ''}</h3>
              <p className={styles.remoteNote}>在图上拖拽圈选（触摸/鼠标/笔统一 Pointer Events），或用『数字输入精确标注』。圈选为归一化坐标，缩放/横竖屏不改变所指区域。</p>
              <div
                className={styles.remoteImgWrap}
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  const rect0 = imageRef.current?.getBoundingClientRect();
                  if (rect0 === undefined) return;
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成/无活动指针时忽略（真实触摸/鼠标不受影响） */ }
                  dragStartRef.current = { x: clamp01((e.clientX - rect0.left) / rect0.width), y: clamp01((e.clientY - rect0.top) / rect0.height), pointerId: e.pointerId };
                  setRect(null);
                }}
                onPointerMove={(e) => {
                  const start = dragStartRef.current;
                  const rect0 = imageRef.current?.getBoundingClientRect();
                  if (start === null || rect0 === undefined || e.pointerId !== start.pointerId) return;
                  const cx = clamp01((e.clientX - rect0.left) / rect0.width);
                  const cy = clamp01((e.clientY - rect0.top) / rect0.height);
                  setRect({ x: Math.min(start.x, cx), y: Math.min(start.y, cy), w: Math.abs(cx - start.x), h: Math.abs(cy - start.y) });
                }}
                onPointerUp={(e) => {
                  if (dragStartRef.current?.pointerId === e.pointerId) {
                    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 同上 */ }
                    dragStartRef.current = null;
                  }
                }}
                onPointerCancel={() => { dragStartRef.current = null; setRect(null); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageRef}
                  src={`/api/v5-preview/remote-session/fixture/${activeEvidence.fixtureId}`}
                  alt={`${activeEvidence.title}（合成测试证据）`}
                  className={styles.remoteImg}
                  draggable={false}
                />
                {rect !== null ? (
                  <div
                    className={styles.remoteRect}
                    style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
                  />
                ) : null}
                {(detail?.annotations ?? []).filter((a) => a.evidenceId === activeEvidence.evidenceId).map((a) => (
                  <div
                    key={a.annotationId}
                    className={styles.remoteRectDone}
                    style={{ left: `${a.rect.x * 100}%`, top: `${a.rect.y * 100}%`, width: `${a.rect.w * 100}%`, height: `${a.rect.h * 100}%` }}
                    title={a.question}
                  />
                ))}
              </div>
              {/* F5：数字输入替代标疑（无拖拽/辅助技术可用） */}
              <details className={styles.remoteManualRect}>
                <summary>不用拖拽：数字输入精确标注（无障碍替代）</summary>
                <div className={styles.remoteManualRectRow}>
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <label key={k} className={styles.remoteManualRectField}>
                      {k}（0–100）
                      <input
                        type="number" min={0} max={100} inputMode="decimal"
                        value={manualRect[k]}
                        onChange={(e) => setManualRect((prev) => ({ ...prev, [k]: e.target.value }) as Record<'x' | 'y' | 'w' | 'h', string>)}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className={styles.remoteBtnSmall}
                    onClick={() => {
                      const keys: Array<'x' | 'y' | 'w' | 'h'> = ['x', 'y', 'w', 'h'];
                      const nums = keys.map((k) => Number.parseFloat(manualRect[k]));
                      if (nums.some((n) => !Number.isFinite(n))) { setWriteError('数字标注：请填写全部 4 个数值（0–100）。'); return; }
                      const [x, y, w, h] = nums.map((n) => n / 100);
                      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) { setWriteError('数字标注：区域必须在原图范围内且宽高大于 0。'); return; }
                      setRect({ x, y, w, h });
                      setWriteError(null);
                    }}
                  >
                    应用区域
                  </button>
                </div>
              </details>
              <textarea
                className={styles.remoteTextarea}
                value={question}
                rows={2}
                maxLength={2000}
                placeholder="针对圈选区域的问题（合成演示）"
                onChange={(e) => { setQuestion(e.target.value); questionRevisionRef.current += 1; }}
              />
              <button
                type="button"
                className={styles.remoteBtn}
                disabled={busy || rect === null || question.trim() === ''}
                onClick={submitAnnotation}
              >
                提交问题（绑定原图 v{activeEvidence.version}）
              </button>
            </div>
          ) : null}
          <CameraPanel />
        </section>

        {/* 问题/回复/复核/核算 */}
        <section className={`${styles.remoteCard} ${styles.remoteOrderEnd}`} aria-label="问题、复核与核算">
          <h2 className={styles.remoteH2}>问题与回复（模型输出为模拟，authority=none）</h2>
          <ul className={styles.remoteAnnotations}>
            {(detail?.annotations ?? []).map((a) => (
              <li key={a.annotationId} className={styles.remoteAnnotation} data-expired={a.expired ? 'yes' : 'no'}>
                <p className={styles.remoteQuestion}>【证据 v{a.evidenceVersion}{a.expired ? ' · 所属证据已过期' : ''}】{a.question}</p>
                {a.replies.map((r) => (
                  <p key={r.replyId} className={styles.remoteReply} data-kind={r.kind}>
                    <b>{r.kind === 'model_simulation' ? '模型（模拟）' : r.kind === 'business' ? '业务' : '专业域'}</b>：{r.text}
                  </p>
                ))}
                <div className={styles.remoteReplyRow}>
                  <button type="button" className={styles.remoteBtnSmall} disabled={busy || session?.status === 'paused'} title={session?.status === 'paused' ? '本轮判断已暂停：模型推进被服务端阻断' : undefined} onClick={() => { void runWrite('annotations/simulate', { annotationId: a.annotationId, expectedVersion: remoteVersion }, 'simulate-followups', () => setNotice('模拟模型后续追问已生成（SIMULATION）'), session?.sessionId ?? ''); }}>
                    生成模拟追问（SIMULATION）
                  </button>
                </div>
                <div className={styles.remoteReplyRow}>
                  <input
                    className={styles.remoteInput}
                    value={replyDraft[a.annotationId] ?? ''}
                    placeholder="以业务身份回复（合成演示）"
                    onChange={(e) => setReplyDraft((prev) => ({ ...prev, [a.annotationId]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className={styles.remoteBtnSmall}
                    disabled={busy || (replyDraft[a.annotationId] ?? '').trim() === ''}
                    onClick={() => {
                      const text = (replyDraft[a.annotationId] ?? '').trim();
                      if (text === '') return;
                      void runWrite('annotations/replies', { annotationId: a.annotationId, kind: 'business', text, expectedVersion: remoteVersion }, 'reply-annotation', () => setReplyDraft((prev) => ({ ...prev, [a.annotationId]: '' })), session?.sessionId ?? '');
                    }}
                  >
                    回复
                  </button>
                </div>
              </li>
            ))}
            {(detail?.annotations.length ?? 0) === 0 ? <li className={styles.remoteNote}>尚无标疑问题。</li> : null}
          </ul>

          <h2 className={styles.remoteH2}>人工复核（针对特定版本）</h2>
          <ul className={styles.remoteReviews}>
            {(detail?.evidence ?? []).map((e) => {
              const draft = reviewDraft[e.evidenceId] ?? { action: 'confirm', opinion: '' };
              const confirmBlocked = session?.status === 'paused' && draft.action === 'confirm';
              return (
                <li key={e.evidenceId} className={styles.remoteReviewRow}>
                  <span className={styles.remoteReviewTarget}>{e.title}（v{e.version}{e.expired ? ' · 已过期' : ''}）</span>
                  <select
                    className={styles.remoteInput}
                    value={draft.action}
                    aria-label={`复核动作：${e.title}`}
                    onChange={(ev) => setReviewDraft((prev) => ({ ...prev, [e.evidenceId]: { ...draft, action: ev.target.value } }))}
                  >
                    {REVIEW_ACTIONS.map((a) => <option key={a} value={a}>{REVIEW_ACTION_LABEL[a]}</option>)}
                  </select>
                  <input
                    className={styles.remoteInput}
                    value={draft.opinion}
                    placeholder="意见（合成演示）"
                    onChange={(ev) => setReviewDraft((prev) => ({ ...prev, [e.evidenceId]: { ...draft, opinion: ev.target.value } }))}
                  />
                  <button
                    type="button"
                    className={styles.remoteBtnSmall}
                    disabled={busy || draft.opinion.trim() === '' || e.expired || confirmBlocked}
                    title={e.expired ? '该证据已被取代：不再接受新的确认，请对新版本复核' : confirmBlocked ? '本轮判断已暂停：确认类动作被服务端阻断' : undefined}
                    onClick={() => { void runWrite('reviews', { targetType: 'evidence', targetId: e.evidenceId, targetVersion: e.version, action: draft.action, opinion: draft.opinion.trim(), expectedVersion: remoteVersion }, 'create-review', () => setReviewDraft((prev) => ({ ...prev, [e.evidenceId]: { action: 'confirm', opinion: '' } })), session?.sessionId ?? ''); }}
                  >
                    提交复核
                  </button>
                </li>
              );
            })}
          </ul>
          <ul className={styles.remoteReviewLog}>
            {(detail?.reviews ?? []).slice(-5).reverse().map((r) => (
              <li key={r.reviewId}>{REVIEW_ACTION_LABEL[r.action] ?? r.action} · 针对 v{r.targetVersion} · {r.opinion.slice(0, 30)}</li>
            ))}
            {(detail?.reviews.length ?? 0) === 0 ? <li className={styles.remoteNote}>尚无复核记录。</li> : null}
          </ul>

          <h2 className={styles.remoteH2}>风险阈值与经济性核算</h2>
          <p className={styles.remoteNote}>
            规则配置状态：{detail?.ruleConfig.status === 'unconfigured' ? '全部未配置（技术质量/证据充分性/业务风险/经济性）——待配置，未知值不是 0，缺配置不是通过' : '已配置'}。
          </p>
          <button
            type="button"
            className={styles.remoteBtnSmall}
            disabled={busy}
            onClick={() => { void runWrite('calculation', { expectedVersion: remoteVersion }, 'attempt-calculation', (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
          >
            尝试核算（口径未配置 → 如实显示）
          </button>
          <div className={styles.remoteCalcRow}>
            <button
              type="button"
              className={styles.remoteBtnSmall}
              disabled={busy}
              onClick={() => { void runWrite('calculation', { mode: 'contract_fixture', inputs: fixtureInputs(520), expectedVersion: remoteVersion }, 'attempt-calculation', (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
            >
              正收益测试输入（非实际核算）
            </button>
            <button
              type="button"
              className={styles.remoteBtnSmall}
              disabled={busy}
              onClick={() => { void runWrite('calculation', { mode: 'contract_fixture', inputs: fixtureInputs(430), expectedVersion: remoteVersion }, 'attempt-calculation', (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
            >
              负收益测试输入（非实际核算）
            </button>
          </div>
          <ul className={styles.remoteCalcList}>
            {(calcResult ?? detail?.calculations ?? []).slice(-2).reverse().map((c) => (
              <li key={c.calcId} className={styles.remoteCalcItem} data-status={c.status} data-stale={c.stale ? 'yes' : 'no'}>
                <b>{c.status}{c.stale ? '（已过期：方案/资料/规则已变化，不得继续作为现行结果）' : ''}</b>
                <ul>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {c.status === 'not_configured' ? <span>所需输入：{c.inputs.map((i) => `${i.label}(${i.unit})`).join('、')}</span> : null}
              </li>
            ))}
          </ul>
          <p className={styles.remoteNote}>不显示绿色盈利、不用 0 填缺失值、不自动建议降价；正收益不表示风险可接受；方案/资料/参数变更使原核算失效。</p>
        </section>

        {/* 参会人：手机折叠（默认收起），桌面展开 */}
        <section className={`${styles.remoteCard} ${styles.remoteOrderParticipants}`} aria-label="参会人（折叠/展开）">
          <button type="button" className={styles.remoteParticipantsToggle} aria-expanded={participantsOpen} onClick={() => setParticipantsOpen((v) => !v)}>
            参会人（{session?.participants.length ?? 0}）{participantsOpen ? '▲' : '▼'}
          </button>
          {participantsOpen ? (
            <ul className={styles.remoteParticipants}>
              {(session?.participants ?? []).map((p) => (
                <li key={p.participantId} className={styles.remoteParticipant}>
                  <span className={styles.remotePName}>{p.displayName}</span>
                  <span className={styles.remotePRole}>{ROLE_LABEL[p.domainRole] ?? p.domainRole}</span>
                  <span className={styles.remotePAttend} data-verified={p.attendanceVerified ? 'yes' : 'no'}>
                    {ATTENDANCE_LABEL[p.attendance] ?? p.attendance}{p.attendance === 'on_site_confirmed' ? ' ✓' : ''}
                  </span>
                  {p.attendance === 'on_site_declared' ? (
                    <button
                      type="button"
                      className={styles.remoteBtnSmall}
                      disabled={busy}
                      onClick={() => { void runWrite('attendance', { participantId: p.participantId, expectedVersion: remoteVersion }, 'confirm-attendance', () => setNotice(`已按本轮依据确认：${p.displayName}`), session?.sessionId ?? ''); }}
                    >
                      按本轮依据确认现场
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function fixtureInputs(rent: number) {
  return [
    { label: '方案金额', value: 500, unit: '万元', source: 'test_fixture' },
    { label: '期限', value: 24, unit: '月', source: 'test_fixture' },
    { label: '租金现金流合计（测试口径）', value: rent, unit: '万元', source: 'test_fixture' },
    { label: '资金成本（测试口径）', value: 420, unit: '万元', source: 'test_fixture' },
    { label: '预期信用损失（测试口径）', value: 15, unit: '万元', source: 'test_fixture' },
    { label: '运营及核验成本（测试口径）', value: 12, unit: '万元', source: 'test_fixture' },
  ];
}
