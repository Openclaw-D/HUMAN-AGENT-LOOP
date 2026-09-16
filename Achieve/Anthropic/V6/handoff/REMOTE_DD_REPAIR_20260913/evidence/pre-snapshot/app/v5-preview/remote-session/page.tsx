"use client";

// V6 远程尽调 · 会议视图（REMOTE_DD_LONG_RUN）。同一 Web，mobile/desktop 仅布局差异。
// 底线：视频未接入如实显示（not_configured；模拟开关显式）；实控人现场"自报/已确认"分开；
// 证据=合成 fixture（显著标记），圈选为归一化坐标（缩放不变），问题绑定原图版本；
// 人工复核针对特定版本，证据更新/重拍后旧确认显示过期；模型输出显式标注（authority=none）；
// 规则阈值与经济性口径未配置 → 待配置；负收益测试输入阻断推荐（标"测试输入，非实际核算"）；
// 全部写请求 requestId 幂等 + expectedVersion OCC；网络未知保留请求可原样重试。
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../preview.module.css';

// ---------------------------------------------------------------------------
// 轻量远端 API 客户端（幂等重试模式与 rows-logic 一致：未知时保留完整原请求）
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

async function postRemote(path: string, body: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/v5-preview/remote-session/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, requestId }),
    });
  } catch {
    throw toFailure({ error: 'NETWORK', message: '网络异常：未收到服务端确认，可原样重试' }, 0);
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
  if (code === 'NETWORK') return '网络异常：未收到服务端确认，可原样重试';
  if (code === 'VERSION_CONFLICT') return '状态已被其他窗口更新，请重试（内容已保留）';
  if (code === 'REQUEST_MISMATCH') return '请求状态不一致，请刷新后重试';
  if (code === 'NOT_FOUND') return '目标不存在（跨会话/跨项目资源不可访问）';
  if (code === 'INVALID_INPUT') return message ?? '输入不符合要求，请检查后重试';
  if (code === 'REMOTE_STORE_CORRUPT' || code === 'REMOTE_STORE_UNAVAILABLE') return '远程尽调数据暂不可用，请稍后重试';
  return message ?? '服务暂不可用，请稍后重试';
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

interface SessionDetail {
  ok: boolean;
  remoteVersion: number;
  session: {
    sessionId: string; projectId: string; title: string; status: string;
    participants: { participantId: string; displayName: string; kind: string; domainRole: string; attendance: string; attendanceVerified: boolean; joined: boolean }[];
    video: { provider: string; state: string; message: string };
  };
  evidence: { evidenceId: string; fixtureId: string; title: string; version: number; verificationStatus: string; expired: boolean; sha256: string; supersededBy: string | null; capturedAt: string }[];
  annotations: { annotationId: string; evidenceId: string; evidenceVersion: number; rect: { x: number; y: number; w: number; h: number }; question: string; author: string; status: string; version: number; replies: { replyId: string; kind: string; author: string; text: string; at: string }[] }[];
  reviews: { reviewId: string; targetType: string; targetId: string; targetVersion: number; action: string; opinion: string; reviewer: string; at: string }[];
  calculations: { calcId: string; status: string; reasons: string[]; inputs: { label: string; value: number | null; unit: string; source: string }[]; result: { kind: string; net?: number; totalCashFlow?: number; totalCost?: number }; at: string }[];
  ruleConfig: { status: string; layers: Record<string, unknown> };
}

const FIXTURE_OPTIONS = [
  { id: 'fixture-inspection', label: '现场巡检（合成）' },
  { id: 'fixture-equipment', label: '设备清单（合成）' },
  { id: 'fixture-contract', label: '合同要素（合成）' },
];

const ATTENDANCE_LABEL: Record<string, string> = {
  on_site_declared: '自报在现场',
  on_site_confirmed: '现场已确认',
  live_only: '仅实时入会',
  pending: '待入会',
  absent: '缺席',
};

const REVIEW_ACTIONS = ['confirm', 'correct', 'request_resupply', 'request_retake', 'pause_round', 'escalate_human'];
const REVIEW_ACTION_LABEL: Record<string, string> = {
  confirm: '确认可见内容', correct: '纠正', request_resupply: '要求补充',
  request_retake: '要求重拍', pause_round: '暂停本轮判断', escalate_human: '转人工',
};

export default function RemoteSessionPage() {
  const [phase, setPhase] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [simulationOn, setSimulationOn] = useState(false); // 模拟会议显式开关（仅本地视图标注，不伪装真实连接）
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [question, setQuestion] = useState('');
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [reviewDraft, setReviewDraft] = useState<Record<string, { action: string; opinion: string }>>({});
  const [calcResult, setCalcResult] = useState<SessionDetail['calculations'] | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const attemptRef = useRef<string | null>(null); // 网络未知时可原样重试的 requestId
  const [attemptPending, setAttemptPending] = useState(false);

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
    const timer = window.setTimeout(() => {
      loadState().catch((e) => {
        setPhase('error');
        setLoadError(typeof (e as RemoteApiFailure).code === 'string' ? userFacing((e as RemoteApiFailure).code, (e as RemoteApiFailure).message) : '服务暂不可用');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadState]);

  /** 统一写动作：attemptRef 未完成且动作相同 → 原样重试（requestId 幂等）；确定性响应后清空。 */
  const runWrite = useCallback(async (path: string, body: Record<string, unknown>, retry: boolean, done: (data: Record<string, unknown>) => void, sessionId: string) => {
    setBusy(true);
    setNotice(null);
    const requestId = retry && attemptRef.current !== null ? attemptRef.current : newRequestId();
    attemptRef.current = requestId;
    setAttemptPending(true);
    try {
      const data = await postRemote(path, { ...body, sessionId }, requestId);
      attemptRef.current = null;
      setAttemptPending(false);
      done(data);
      if (typeof data.remoteVersion === 'number') setRemoteVersion(data.remoteVersion);
      if (session !== null) await loadDetail(session.sessionId).catch(() => undefined);
    } catch (e) {
      const f = e as RemoteApiFailure;
      if (f.code === 'VERSION_CONFLICT') {
        // 无会话（空态）也必须刷新远端版本，否则重试持续携带过期 expectedVersion。
        if (session !== null) await loadDetail(session.sessionId).catch(() => undefined);
        else await loadState().catch(() => undefined);
        setNotice(`版本已更新（服务端 v${f.serverVersion ?? '?'}），已刷新，请重试`);
      } else if (f.code === 'NETWORK') {
        setNotice('网络异常：未收到服务端确认，可点击重试（原请求幂等）');
      } else {
        attemptRef.current = null;
        setAttemptPending(false);
        setNotice(userFacing(f.code, f.message));
      }
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadState, session]);

  async function createSession(): Promise<void> {
    await runWrite('', { title: 'JW-2026-018 · 远程尽调（合成演示）', expectedVersion: remoteVersion }, false, (data) => {
      const created = data.session as SessionDetail['session'];
      if (created !== undefined) void loadDetail(created.sessionId);
    }, '');
  }

  if (phase === 'loading' || phase === 'error') {
    return (
      <div className={styles.remoteRoot}>
        <Link className={styles.remoteBack} href="/v5-preview">← 返回项目总览</Link>
        <div className={styles.remoteCard} role={phase === 'error' ? 'alert' : 'status'}>
          {phase === 'error' ? `远程尽调加载失败：${loadError}` : '远程尽调加载中（合成演示）…'}
          {phase === 'error' ? <button type="button" className={styles.remoteBtn} onClick={() => { setPhase('loading'); void loadState(); }}>重试</button> : null}
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
          <button type="button" className={styles.remoteBtn} disabled={busy} onClick={() => { void createSession(); }}>创建远程尽调会话</button>
          {notice !== null ? <p className={styles.remoteError} role="alert">{notice}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.remoteRoot}>
      <header className={styles.remoteHeader}>
        <Link className={styles.remoteBack} href="/v5-preview">← 返回项目总览（总览状态与草稿保留）</Link>
        <b className={styles.remoteBadge}>远程尽调 · 合成演示</b>
        <span className={styles.remoteVersion}>会话 {session?.sessionId} · 项目 {session?.projectId} · 远端状态 v{remoteVersion}{session?.status === 'paused' ? ' · 本轮判断已暂停' : ''}</span>
      </header>
      {notice !== null ? <p className={styles.remoteNotice} role="status">{notice} {attemptPending ? <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { setNotice('请重复上一次操作以原样重试（幂等）；当前实现保留原请求。'); }}>重试说明</button> : null}</p> : null}

      <div className={styles.remoteGrid}>
        {/* 左列：会议/视频/参会人 */}
        <section className={styles.remoteCard} aria-label="会议与参会人">
          <h2 className={styles.remoteH2}>会议 · {session?.title}</h2>
          <div className={styles.remoteVideo} data-simulation={simulationOn ? 'on' : 'off'}>
            <p className={styles.remoteVideoState}>视频状态：{session?.video.state === 'not_configured' ? '未接入' : session?.video.state}</p>
            <p className={styles.remoteVideoNote}>{session?.video.message}</p>
            {simulationOn ? <p className={styles.remoteSimTag}>模拟会议视图（未接入真实视频，非现场画面）</p> : null}
            <label className={styles.remoteSimToggle}>
              <input type="checkbox" checked={simulationOn} onChange={(e) => setSimulationOn(e.target.checked)} />
              显式开启模拟会议视图（不申请摄像头/麦克风，不采集，不上传）
            </label>
          </div>
          <ul className={styles.remoteParticipants}>
            {(session?.participants ?? []).map((p) => (
              <li key={p.participantId} className={styles.remoteParticipant}>
                <span className={styles.remotePName}>{p.displayName}</span>
                <span className={styles.remotePRole}>{p.domainRole}</span>
                <span className={styles.remotePAttend} data-verified={p.attendanceVerified ? 'yes' : 'no'}>
                  {ATTENDANCE_LABEL[p.attendance] ?? p.attendance}{p.attendance === 'on_site_confirmed' ? ' ✓' : ''}
                </span>
                {p.attendance === 'on_site_declared' ? (
                  <button
                    type="button"
                    className={styles.remoteBtnSmall}
                    disabled={busy}
                    onClick={() => { void runWrite('attendance', { participantId: p.participantId, expectedVersion: remoteVersion }, false, () => setNotice(`已按本轮依据确认：${p.displayName}`), session?.sessionId ?? ''); }}
                  >
                    按本轮依据确认现场
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* 中列：证据与标疑 */}
        <section className={styles.remoteCard} aria-label="证据与标疑">
          <h2 className={styles.remoteH2}>证据（合成测试图形）</h2>
          <div className={styles.remoteFixtures}>
            {FIXTURE_OPTIONS.map((f) => (
              <button key={f.id} type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { void runWrite('evidence', { fixtureId: f.id, expectedVersion: remoteVersion }, false, () => setNotice(`证据已附着：${f.label}`), session?.sessionId ?? ''); }}>
                附着{f.label}
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
                  v{e.version} · {e.verificationStatus === 'human_verified' ? '人工已核实' : e.verificationStatus === 'contested' ? '有争议' : '未核实'}
                  {e.expired ? ' · 已过期（存在重拍/补充）' : ''}
                </span>
              </li>
            ))}
            {(detail?.evidence.length ?? 0) === 0 ? <li className={styles.remoteNote}>尚无证据；点击上方按钮附着合成测试图形。</li> : null}
          </ul>

          {activeEvidence !== null ? (
            <div className={styles.remoteAnnotate}>
              <h3 className={styles.remoteH3}>圈选标疑 · {activeEvidence.title}（v{activeEvidence.version}）</h3>
              <p className={styles.remoteNote}>在图上拖拽圈选 → 填写问题 → 提交。圈选为归一化坐标，缩放/横竖屏不改变所指区域。</p>
              <div
                className={styles.remoteImgWrap}
                onMouseDown={(e) => {
                  const rect0 = imageRef.current?.getBoundingClientRect();
                  if (rect0 === undefined) return;
                  dragStartRef.current = { x: (e.clientX - rect0.left) / rect0.width, y: (e.clientY - rect0.top) / rect0.height };
                  setRect(null);
                }}
                onMouseMove={(e) => {
                  const start = dragStartRef.current;
                  const rect0 = imageRef.current?.getBoundingClientRect();
                  if (start === null || rect0 === undefined) return;
                  setRect({ x: Math.min(start.x, (e.clientX - rect0.left) / rect0.width), y: Math.min(start.y, (e.clientY - rect0.top) / rect0.height), w: Math.abs((e.clientX - rect0.left) / rect0.width - start.x), h: Math.abs((e.clientY - rect0.top) / rect0.height - start.y) });
                }}
                onMouseUp={() => { dragStartRef.current = null; }}
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
              <textarea
                className={styles.remoteTextarea}
                value={question}
                rows={2}
                maxLength={2000}
                placeholder="针对圈选区域的问题（合成演示）"
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                type="button"
                className={styles.remoteBtn}
                disabled={busy || rect === null || question.trim() === ''}
                onClick={() => {
                  if (rect === null) return;
                  void runWrite('annotations', { evidenceId: activeEvidence.evidenceId, evidenceVersion: activeEvidence.version, question: question.trim(), rect, expectedVersion: remoteVersion }, false, () => { setQuestion(''); setRect(null); setNotice('问题已绑定原图版本提交'); }, session?.sessionId ?? '');
                }}
              >
                提交问题（绑定原图 v{activeEvidence.version}）
              </button>
            </div>
          ) : null}
        </section>

        {/* 右列：问题/回复/复核/核算 */}
        <section className={styles.remoteCard} aria-label="问题、复核与核算">
          <h2 className={styles.remoteH2}>问题与回复（模型输出为模拟，authority=none）</h2>
          <ul className={styles.remoteAnnotations}>
            {(detail?.annotations ?? []).map((a) => (
              <li key={a.annotationId} className={styles.remoteAnnotation}>
                <p className={styles.remoteQuestion}>【证据 v{a.evidenceVersion}】{a.question}</p>
                {a.replies.map((r) => (
                  <p key={r.replyId} className={styles.remoteReply} data-kind={r.kind}>
                    <b>{r.kind === 'model_simulation' ? '模型（模拟）' : r.kind === 'business' ? '业务' : '专业域'}</b>：{r.text}
                  </p>
                ))}
                <div className={styles.remoteReplyRow}>
                  <button type="button" className={styles.remoteBtnSmall} disabled={busy} onClick={() => { void runWrite('annotations/simulate', { annotationId: a.annotationId, expectedVersion: remoteVersion }, false, () => setNotice('模拟模型后续追问已生成（SIMULATION）'), session?.sessionId ?? ''); }}>
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
                      void runWrite('annotations/replies', { annotationId: a.annotationId, kind: 'business', text, expectedVersion: remoteVersion }, false, () => setReplyDraft((prev) => ({ ...prev, [a.annotationId]: '' })), session?.sessionId ?? '');
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
              return (
                <li key={e.evidenceId} className={styles.remoteReviewRow}>
                  <span className={styles.remoteReviewTarget}>{e.title}（v{e.version}）</span>
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
                    disabled={busy || draft.opinion.trim() === ''}
                    onClick={() => { void runWrite('reviews', { targetType: 'evidence', targetId: e.evidenceId, targetVersion: e.version, action: draft.action, opinion: draft.opinion.trim(), expectedVersion: remoteVersion }, false, () => setReviewDraft((prev) => ({ ...prev, [e.evidenceId]: { action: 'confirm', opinion: '' } })), session?.sessionId ?? ''); }}
                  >
                    提交复核
                  </button>
                </li>
              );
            })}
          </ul>
          <ul className={styles.remoteReviewLog}>
            {(detail?.reviews ?? []).slice(-5).reverse().map((r) => (
              <li key={r.reviewId}>{REVIEW_ACTION_LABEL[r.action] ?? r.action} · {r.targetType} {r.targetId.slice(0, 10)}…（针对 v{r.targetVersion}）· {r.opinion.slice(0, 30)}</li>
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
            onClick={() => { void runWrite('calculation', { expectedVersion: remoteVersion }, false, (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
          >
            尝试核算（口径未配置 → 如实显示）
          </button>
          <div className={styles.remoteCalcRow}>
            <button
              type="button"
              className={styles.remoteBtnSmall}
              disabled={busy}
              onClick={() => { void runWrite('calculation', { expectedVersion: remoteVersion, inputs: [
                { label: '方案金额', value: 500, unit: '万元', source: 'test_fixture' },
                { label: '期限', value: 24, unit: '月', source: 'test_fixture' },
                { label: '租金现金流合计（测试口径）', value: 520, unit: '万元', source: 'test_fixture' },
                { label: '资金成本（测试口径）', value: 430, unit: '万元', source: 'test_fixture' },
                { label: '预期信用损失（测试口径）', value: 15, unit: '万元', source: 'test_fixture' },
                { label: '运营及核验成本（测试口径）', value: 12, unit: '万元', source: 'test_fixture' },
              ] }, false, (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
            >
              正收益测试输入（非实际核算）
            </button>
            <button
              type="button"
              className={styles.remoteBtnSmall}
              disabled={busy}
              onClick={() => { void runWrite('calculation', { expectedVersion: remoteVersion, inputs: [
                { label: '方案金额', value: 500, unit: '万元', source: 'test_fixture' },
                { label: '期限', value: 24, unit: '月', source: 'test_fixture' },
                { label: '租金现金流合计（测试口径）', value: 430, unit: '万元', source: 'test_fixture' },
                { label: '资金成本（测试口径）', value: 420, unit: '万元', source: 'test_fixture' },
                { label: '预期信用损失（测试口径）', value: 15, unit: '万元', source: 'test_fixture' },
                { label: '运营及核验成本（测试口径）', value: 12, unit: '万元', source: 'test_fixture' },
              ] }, false, (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session?.sessionId ?? ''); }}
            >
              负收益测试输入（非实际核算）
            </button>
          </div>
          <ul className={styles.remoteCalcList}>
            {(calcResult ?? detail?.calculations ?? []).slice(-2).reverse().map((c) => (
              <li key={c.calcId} className={styles.remoteCalcItem} data-status={c.status}>
                <b>{c.status}</b>
                <ul>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {c.status === 'not_configured' ? <span>所需输入：{c.inputs.map((i) => `${i.label}(${i.unit})`).join('、')}</span> : null}
              </li>
            ))}
          </ul>
          <p className={styles.remoteNote}>不显示绿色盈利、不用 0 填缺失值、不自动建议降价；正收益不表示风险可接受；方案/资料/参数变更使原核算失效。</p>
        </section>
      </div>
    </div>
  );
}
