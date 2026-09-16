"use client";

// V6 SE_REBUILD · 业务↔实控人访谈 · 数据接线层。
// V6 REPAIR evening（A · C 候选集成）：渲染层改用 C 候选 RemoteInterviewStagePage
//（现场为主/紧凑工具/下部进度-操作-聊天；F1 字段折叠与 F2 问题唯一主呈现为默认行为）。
// 本层职责（方式1，C candidate/README §二）：数据获取（GET / shared-state 专属会话优先）、
// 不可变原请求注册（RequestRegistry）、草稿 sessionStorage 持久（受控 drafts）、全部写回调。
// 组件零 fetch、零注册表、零存储；一切业务事实以服务端 detail 为唯一来源。
// 底线不变：视频/语音未接入如实显示；模型输出显式 SIMULATION/REAL、authority=none；
// 暂停为服务端执行门；"返回项目"=导航，不冒称结束通话。
import { useCallback, useEffect, useRef, useState } from 'react';
import CameraPanel from './camera-panel';
import RemoteInterviewStagePage from './RemoteInterviewStagePage';
import { buildDomainsFromOverview, mapDetailToProps } from './session-adapter';
import type { RivDrafts } from './remote-interview.types';
import { RequestRegistry, type RegistryEntry } from '../../../lib/v5-preview/remote-request-registry';

// ---------------------------------------------------------------------------
// API 客户端 + F1 不可变请求注册（沿用返修版语义）
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
  if (code === 'MODEL_NOT_CONFIGURED') return '模型服务未配置：真实调用未发起（接线就绪，等待端点/模型名/密钥配置）';
  if (code === 'MODEL_CALL_FAILED' || code === 'MODEL_RESULT_STALE' || code === 'MODEL_BUDGET_EXHAUSTED') return message ?? '真实模型调用未成功，未写入任何结论';
  return message ?? '服务暂不可用，请稍后重试';
}

// R2：多请求注册表（sessionStorage 持久化，不可用时退化内存）——
// 多条未知请求并存不覆盖；同 op 同载荷原样重试复用冻结 requestId；草稿关联 requestId+修订。
const registry = new RequestRegistry({
  storage: {
    get: () => {
      try { return window.sessionStorage.getItem('jw:v5-preview:remote-request-registry'); } catch { return null; }
    },
    set: (value: string) => {
      try { window.sessionStorage.setItem('jw:v5-preview:remote-request-registry', value); } catch { /* 不可用：退化内存 */ }
    },
    remove: () => {
      try { window.sessionStorage.removeItem('jw:v5-preview:remote-request-registry'); } catch { /* 忽略 */ }
    },
  },
});

// ---------------------------------------------------------------------------
// 类型
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
  calculations: { calcId: string; status: string; stale?: boolean; reasons: string[]; inputs: { label: string; value: number | null; unit: string; source: string }[]; result: { kind: string }; at: string }[];
  ruleConfig: { status: string; layers: Record<string, unknown> };
}

const VOICE_NOTE_NO_API = '语音输入未接入：当前环境无浏览器语音识别接口，产品也未集成 ASR 服务。可先用下方文字输入（语音接口已冻结，接入另行授权）。';
const VOICE_NOTE_API_PRESENT = '浏览器具备语音识别接口（Web Speech），但产品尚未接入：为不以未验证能力冒充已支持，语音录入暂不可用，请先用文字输入。';

// 真实模型配置状态（API_OVERNIGHT 20260913 CONTRACT §4；服务端只报布尔与模式，无秘密值）。
interface ModelStatusInfo {
  mode: 'real' | 'simulation';
  configured: boolean;
  missing: string[];
  keyConfigured: boolean;
  baseUrlConfigured: boolean;
  modelConfigured: boolean;
  modeConfigured: string;
  callsUsed: number;
  callBudget: number;
  timeoutMs: number;
}

export default function RemoteSessionPage() {
  const [phase, setPhase] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [unknowns, setUnknowns] = useState<RegistryEntry[]>([]);
  const [simulationOn, setSimulationOn] = useState(false);
  // 受控草稿（C 候选 drafts 契约）：sessionStorage 持久语义与旧版一致（D-04），组件零存储。
  const [drafts, setDrafts] = useState<RivDrafts>(() => {
    try {
      const raw = window.sessionStorage.getItem('jw:v5-preview:draft:fields');
      const fields = raw !== null ? (JSON.parse(raw) as { deviceCount?: unknown; quote?: unknown }) : {};
      return {
        answer: window.sessionStorage.getItem('jw:v5-preview:draft:answer') ?? '',
        ask: window.sessionStorage.getItem('jw:v5-preview:draft:ask') ?? '',
        fields: {
          deviceCount: typeof fields.deviceCount === 'string' ? fields.deviceCount : '',
          quote: typeof fields.quote === 'string' ? fields.quote : '',
        },
      };
    } catch {
      return { answer: '', ask: '', fields: { deviceCount: '', quote: '' } };
    }
  });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceCaps, setVoiceCaps] = useState<'unknown' | 'no_api' | 'api_present'>('unknown');
  const [calcResult, setCalcResult] = useState<SessionDetail['calculations'] | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusInfo | null>(null);
  const [viewMode, setViewMode] = useState<'business' | 'customer'>('business');
  // 四域提示（业务侧）：数据来自既有 /api/v5-preview/project 总览（只读；与主线四域一致）。
  const [domainTips, setDomainTips] = useState<{ domainId: string; name: string; judgmentStatus: string; judgmentText: string }[]>([]);
  const [transcript, setTranscript] = useState<{ at: string; who: string; text: string }[]>([]); // 合成转写事件（非真实 ASR）
  const transcriptSeq = useRef(0);
  const askPendingRef = useRef(false);
  const answerRevisionRef = useRef(0);
  const draftAssocRef = useRef<{ requestId: string; revision: number } | null>(null);

  const session = detail?.session ?? null;
  const paused = session?.status === 'paused';

  /** 受控草稿变更：组件 → page 持久（键与旧版一致；损坏/缺失如实回退空值）。 */
  const onDraftsChange = useCallback((patch: Partial<RivDrafts>) => {
    setDrafts((prev) => {
      const next: RivDrafts = {
        answer: patch.answer ?? prev.answer,
        ask: patch.ask ?? prev.ask,
        fields: patch.fields ?? prev.fields,
      };
      try {
        if (patch.answer !== undefined) window.sessionStorage.setItem('jw:v5-preview:draft:answer', patch.answer);
        if (patch.ask !== undefined) window.sessionStorage.setItem('jw:v5-preview:draft:ask', patch.ask);
        if (patch.fields !== undefined) window.sessionStorage.setItem('jw:v5-preview:draft:fields', JSON.stringify(next.fields));
      } catch { /* 忽略：持久化失败不阻断输入 */ }
      return next;
    });
  }, []);

  const loadDetail = useCallback(async (sessionId: string): Promise<void> => {
    const data = await getRemote<SessionDetail>(`detail?sessionId=${encodeURIComponent(sessionId)}`);
    setDetail(data);
    setRemoteVersion(data.remoteVersion);
    setPhase('ready');
    // R2：会话确定后按真实 owner 刷新未知请求恢复条（挂载时 owner 为空查不到会话内记录）。
    setUnknowns(registry.listUnknown(sessionId));
  }, []);

  // 四域提示：只读拉取主线总览并映射为紧凑提示（失败如实留空，不臆造）。
  const loadDomainTips = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/v5-preview/project', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { domains?: { domainId: string; name: string; judgmentStatus: string; judgmentText: string }[] };
      if (Array.isArray(data.domains)) {
        setDomainTips(data.domains.map((d) => ({ domainId: d.domainId, name: d.name, judgmentStatus: d.judgmentStatus, judgmentText: d.judgmentText })));
      }
    } catch { /* 只读增强：失败保持当前值 */ }
  }, []);

  const loadState = useCallback(async (): Promise<void> => {
    // V6 REPAIR evening（INTERFACE §3）：优先使用专属演示会话（首页固定演示与尽调页同一事实）；
    // shared-state 读取会触发服务端共享投影同步（诚实声明的自愈路径）。失败回退既有 sessions[0] 逻辑。
    try {
      const response = await fetch('/api/v5-preview/demo/shared-state', { cache: 'no-store' });
      if (response.ok) {
        const shared = (await response.json()) as { demoSessionId?: string | null };
        if (typeof shared.demoSessionId === 'string' && shared.demoSessionId.length > 0) {
          await loadDetail(shared.demoSessionId);
          return;
        }
      }
    } catch { /* 只读增强：失败回退既有逻辑 */ }
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
      setUnknowns(registry.listUnknown(''));
      // 真实模型配置状态（CONTRACT §4）：失败置 null（按钮按"状态未知"降级，不假设已配置）。
      getRemote<{ ok: boolean; model: ModelStatusInfo }>('model-status')
        .then((d) => setModelStatus(d.model ?? null))
        .catch(() => setModelStatus(null));
      loadState().catch((e) => {
        setPhase('error');
        setLoadError(typeof (e as RemoteApiFailure).code === 'string' ? userFacing((e as RemoteApiFailure).code, (e as RemoteApiFailure).message) : '服务暂不可用');
      });
      void loadDomainTips();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadState, loadDomainTips]);

  /** F1：不可变原请求写路径（同载荷原样重试；发送前落盘；确定性结果清记录）。
   *  D-01 修复：注册表 resolve 用注册表条目键（req-* 前缀），不是载荷内 requestId。 */
  const runWrite = useCallback(async (path: string, body: Record<string, unknown>, op: string, done: (data: Record<string, unknown>) => void, sessionId: string, draftRevision: number | null = null) => {
    setBusy(true);
    setNotice(null);
    setWriteError(null);
    const retryEntry = registry.findRetry(op, { ...body, sessionId }, sessionId);
    const requestId = retryEntry !== null ? retryEntry.requestId : newRequestId();
    const fullBody = retryEntry !== null ? { ...retryEntry.body, sessionId } : { ...body, requestId, sessionId };
    let registryKey: string;
    if (retryEntry !== null) {
      registryKey = retryEntry.requestId;
    } else {
      const began = registry.begin({ op, path, body: fullBody, ownerSessionId: sessionId, draftRevision: op === 'reply-annotation' ? draftRevision : null });
      if (!began.ok) {
        setBusy(false);
        setWriteError(`存在 ${began.unknownCount} 条未确认请求已达演示上限：请先原样重试或放弃（在途请求不被覆盖）。`);
        return;
      }
      registryKey = began.entry.requestId;
    }
    if (op === 'reply-annotation' && draftRevision !== null) draftAssocRef.current = { requestId, revision: draftRevision };
    try {
      const data = await postRemote(path, fullBody);
      registry.resolve(registryKey, 'confirmed');
      setUnknowns(registry.listUnknown(sessionId));
      if (op === 'reply-annotation') {
        const assoc = draftAssocRef.current;
        if (assoc !== null && assoc.requestId === requestId && assoc.revision === draftRevision && answerRevisionRef.current === draftRevision) {
          onDraftsChange({ answer: '' });
          answerRevisionRef.current = 0;
          draftAssocRef.current = null;
        }
      }
      if (typeof data.remoteVersion === 'number') setRemoteVersion(data.remoteVersion);
      done(data);
      if (session !== null && sessionId === session.sessionId) await loadDetail(sessionId).catch(() => undefined);
      void loadDomainTips();
    } catch (e) {
      const f = e as RemoteApiFailure;
      if (f.code === 'NETWORK') {
        setUnknowns(registry.listUnknown(sessionId));
        setNotice('网络异常：未收到服务端确认。可点击「原样重试」（同一请求，幂等安全）或「放弃该请求」。');
      } else {
        registry.resolve(registryKey, 'dropped');
        setUnknowns(registry.listUnknown(sessionId));
        setWriteError(userFacing(f.code, f.message));
        if (f.code === 'VERSION_CONFLICT') {
          if (session !== null && sessionId === session.sessionId) await loadDetail(sessionId).catch(() => undefined);
          else await loadState().catch(() => undefined);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadState, session, loadDomainTips, onDraftsChange]);

  const retryPending = useCallback(async (requestId: string): Promise<void> => {
    const record = registry.getByRequest(requestId);
    if (record === null) { setUnknowns(registry.listUnknown(session?.sessionId ?? '')); return; }
    if (session === null || record.ownerSessionId !== session.sessionId) {
      setNotice('该未知请求属于其他会话或会话已变化：请先「放弃该请求」或返回对应会话处理。');
      return;
    }
    await runWrite(record.path, record.body, record.op, () => setNotice('原样重试成功：同一请求已确认。'), record.ownerSessionId, record.draftRevision);
  }, [runWrite, session]);

  function discardPendingById(requestId: string): void {
    registry.abandon(requestId);
    setUnknowns(registry.listUnknown(session?.sessionId ?? ''));
    setNotice('已放弃该未知请求（不产生任何写入）。');
  }

  async function createSession(): Promise<void> {
    await runWrite('', { title: 'JW-2026-018 · 远程尽调访谈（合成演示）', expectedVersion: remoteVersion }, 'create-session', (data) => {
      const created = data.session as SessionDetail['session'];
      if (created !== undefined) void loadDetail(created.sessionId);
    }, '');
  }

  /** 提交访谈记录（C 回调 onSubmitRecord）：回答当前关键问题（业务身份），附关键字段人工核对值。 */
  const submitRecord = useCallback((text: string, fields: { deviceCount: string; quote: string }): void => {
    if (session === null || detail === null) return;
    const activeQuestion = detail.annotations.find((a) => !a.expired && a.status === 'open') ?? null;
    if (activeQuestion === null || text.trim() === '') return;
    const revision = answerRevisionRef.current;
    const fieldNote = fields.deviceCount.trim() !== '' || fields.quote.trim() !== ''
      ? `（人工核对字段：设备数量 ${fields.deviceCount.trim() || '—'} 台；报价 ${fields.quote.trim() || '—'} 万元）`
      : '';
    void runWrite('annotations/replies', {
      annotationId: activeQuestion.annotationId,
      kind: 'business',
      text: `${text.trim()}${fieldNote}`,
      expectedVersion: remoteVersion,
    }, 'reply-annotation', () => setNotice('访谈记录已提交（合成演示）'), session.sessionId, revision);
  }, [session, detail, remoteVersion, runWrite]);

  const pauseRound = useCallback((): void => {
    if (session === null || detail === null) return;
    const activeQuestion = detail.annotations.find((a) => !a.expired && a.status === 'open') ?? null;
    if (activeQuestion === null) return;
    void runWrite('reviews', {
      targetType: 'annotation',
      targetId: activeQuestion.annotationId,
      targetVersion: activeQuestion.version,
      action: 'pause_round',
      opinion: '本轮判断暂停（关键问题待闭环，合成演示）',
      expectedVersion: remoteVersion,
    }, 'create-review', () => setNotice('本轮判断已暂停（服务端已阻断模型/确认类动作）'), session.sessionId);
  }, [session, detail, remoteVersion, runWrite]);

  /** 恢复本轮（显式）：仅会话处于暂停时可用；与暂停同为服务端复核动作，失败如实反馈。 */
  const resumeRound = useCallback((): void => {
    if (session === null || detail === null) return;
    const activeQuestion = detail.annotations.find((a) => !a.expired && a.status === 'open') ?? null;
    if (activeQuestion === null) return;
    void runWrite('reviews', {
      targetType: 'annotation',
      targetId: activeQuestion.annotationId,
      targetVersion: activeQuestion.version,
      action: 'resume_round',
      opinion: '演示恢复（合成）',
      expectedVersion: remoteVersion,
    }, 'create-review', () => setNotice('已显式恢复本轮'), session.sessionId);
  }, [session, detail, remoteVersion, runWrite]);

  /** 转人工（escalate_human）：走同一人工复核写路径；暂停中被服务端阻断。 */
  const escalateHuman = useCallback((): void => {
    if (session === null || detail === null) return;
    const activeQuestion = detail.annotations.find((a) => !a.expired && a.status === 'open') ?? null;
    if (activeQuestion === null) return;
    void runWrite('reviews', {
      targetType: 'annotation',
      targetId: activeQuestion.annotationId,
      targetVersion: activeQuestion.version,
      action: 'escalate_human',
      opinion: '关键问题转人工处理（合成演示）',
      expectedVersion: remoteVersion,
    }, 'create-review', () => setNotice('已提交转人工复核（合成演示；模型无审批权）'), session.sessionId);
  }, [session, detail, remoteVersion, runWrite]);

  /** 业务发起关键问题（C 回调 onAskQuestion）：证据未就绪先附着（同一后端），再发起标注。
   *  D-02 修复语义保留：两分支统一"重新读 detail 取最新证据 → 发起标注"，不静默失败。 */
  const askQuestion = useCallback((text: string): void => {
    if (session === null || text.trim() === '') return;
    askPendingRef.current = true;
    const ensure = detail !== null && detail.evidence.length > 0
      ? Promise.resolve()
      : runWrite('evidence', { fixtureId: 'fixture-inspection', expectedVersion: remoteVersion }, 'attach-evidence', () => undefined, session.sessionId);
    void Promise.resolve(ensure).then(() => {
      return getRemote<SessionDetail>(`detail?sessionId=${session.sessionId}`).then((d) => {
        const latest = d.evidence[d.evidence.length - 1];
        if (latest === undefined) throw new Error('证据尚未就绪');
        return runWrite('annotations', {
          evidenceId: latest.evidenceId,
          evidenceVersion: latest.version,
          question: text.trim(),
          rect: { x: 0, y: 0, w: 1, h: 1 },
          expectedVersion: d.remoteVersion,
        }, 'annotation', () => { onDraftsChange({ ask: '' }); askPendingRef.current = false; setNotice('关键问题已发起（绑定现场证据）'); }, session.sessionId);
      });
    }).catch(() => { askPendingRef.current = false; setWriteError('发起关键问题未完成：请重试（证据与问题可能已部分写入，重试安全）'); });
  }, [session, detail, remoteVersion, runWrite, onDraftsChange]);

  /** 语音能力如实检测：仅在用户点击语音按钮时执行；不申请麦克风权限。 */
  const toggleVoiceNote = useCallback((): void => {
    setVoiceOpen((open) => {
      const next = !open;
      if (next && voiceCaps === 'unknown') {
        const hasApi = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
        setVoiceCaps(hasApi ? 'api_present' : 'no_api');
      }
      return next;
    });
  }, [voiceCaps]);

  const addTranscriptDemo = useCallback((): void => {
    transcriptSeq.current += 1;
    const n = transcriptSeq.current;
    setTranscript((prev) => [...prev, {
      at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      who: n % 2 === 1 ? '实控人（合成）' : '业务（合成）',
      text: n % 2 === 1 ? `（合成转写事件 ${n}）设备运行正常，共三台。` : `（合成转写事件 ${n}）追问：检修计划请书面确认。`,
    }]);
  }, []);

  // ---------------------------------------------------------------------------
  // 渲染：C 候选组件（全四态）
  // ---------------------------------------------------------------------------

  const voiceNote = voiceOpen
    ? `${voiceCaps === 'no_api' ? VOICE_NOTE_NO_API : voiceCaps === 'api_present' ? VOICE_NOTE_API_PRESENT : '正在检测语音能力…'} 语音接口已冻结：接入需媒体权限与 ASR 服务授权（另行 Gate）。`
    : null;

  const techNote = detail !== null
    ? `会话 ${session?.sessionId.slice(0, 12)}… · 项目 ${session?.projectId} · 远端 v${remoteVersion} · 视频 ${session?.video.state}（provider: ${session?.video.provider}）`
    : null;

  const modelStatusLine = modelStatus === null
    ? null
    : modelStatus.mode === 'real'
      ? `真实模型通道：已启用（mode=real · 超时 ${Math.round(modelStatus.timeoutMs / 1000)}s · 真实调用 ${modelStatus.callsUsed}/${modelStatus.callBudget} 次）`
      : `真实模型通道：未启用真实调用（mode=${modelStatus.mode}${modelStatus.configured ? `，JIANWEI_MODEL_MODE=${modelStatus.modeConfigured}` : `，缺少 ${modelStatus.missing.join('、')}`}）——接线就绪，模拟入口照常可用`;

  const adapterProps =
    detail !== null
      ? mapDetailToProps(detail as never, {
          viewMode,
          simulationOn,
          modelStatus: modelStatus === null ? null : { mode: modelStatus.mode, configured: modelStatus.configured, missing: modelStatus.missing, modeConfigured: modelStatus.modeConfigured },
          busy,
          notice,
          actionError: writeError,
          voiceNote,
          pendingRequests: unknowns.map((u) => ({ requestId: u.requestId, op: u.op, savedAtLabel: new Date(u.savedAt).toLocaleTimeString() })),
          domains: buildDomainsFromOverview(domainTips),
          cameraSlot: <CameraPanel />,
          techNote,
          drafts,
          humanPendingCount: detail.reviews.some((r) => r.action === 'escalate_human' || r.action === 'pause_round') ? 1 : 0,
        })
      : null;

  if (adapterProps === null) {
    // loading/empty/error：C 组件四态渲染（数据位为空态值）。
    return (
      <RemoteInterviewStagePage
        title="远程尽调访谈"
        backHref="/v5-preview"
        phase={phase}
        viewMode={viewMode}
        onViewModeChange={(m) => setViewMode(m)}
        loadError={loadError}
        live={false}
        paused={false}
        currentQuestion={null}
        openQuestionCount={0}
        domains={buildDomainsFromOverview(domainTips)}
        evidence={[]}
        questions={[]}
        participants={[]}
        progress={{ answered: 0, total: 0, round: 0 }}
        reviews={[]}
        pendingRequests={unknowns.map((u) => ({ requestId: u.requestId, op: u.op, savedAtLabel: new Date(u.savedAt).toLocaleTimeString() }))}
        transcript={transcript}
        humanPendingCount={0}
        supersededEvidenceCount={0}
        expiredOpinionCount={0}
        simulationOn={simulationOn}
        modelAnalysisAvailable={false}
        busy={busy}
        notice={notice}
        actionError={writeError}
        voiceNote={voiceNote}
        cameraSlot={<CameraPanel />}
        onRetryLoad={() => { setPhase('loading'); void loadState(); }}
        onCreateSession={() => { void createSession(); }}
        onRetryPending={(requestId) => { void retryPending(requestId); }}
        onDiscardPending={discardPendingById}
      />
    );
  }

  return (
    <RemoteInterviewStagePage
      {...adapterProps}
      onViewModeChange={(m) => setViewMode(m)}
      busy={busy}
      notice={notice}
      actionError={writeError}
      voiceNote={voiceNote}
      cameraSlot={<CameraPanel />}
      drafts={drafts}
      onDraftsChange={onDraftsChange}
      simulationOn={simulationOn}
      modelStatusLine={modelStatusLine}
      calculations={calcResult ?? detail?.calculations ?? []}
      transcript={transcript}
      pendingRequests={unknowns.map((u) => ({ requestId: u.requestId, op: u.op, savedAtLabel: new Date(u.savedAt).toLocaleTimeString() }))}
      onRetryLoad={() => { setPhase('loading'); void loadState(); }}
      onCreateSession={() => { void createSession(); }}
      onSubmitRecord={submitRecord}
      onPauseRound={pauseRound}
      onResumeRound={resumeRound}
      onEscalateHuman={escalateHuman}
      onAskQuestion={askQuestion}
      onAttachEvidence={(fixtureId) => {
        if (session === null) return;
        void runWrite('evidence', { fixtureId, expectedVersion: remoteVersion }, 'attach-evidence', () => setNotice('证据已附着（合成）'), session.sessionId);
      }}
      onSimulateToggle={(on) => setSimulationOn(on)}
      onToggleVoiceNote={toggleVoiceNote}
      onAnalyzeQuestion={(annotationId) => {
        if (session === null) return;
        void runWrite('annotations/analyze', { annotationId, expectedVersion: remoteVersion }, 'analyze-annotation', () => setNotice('真实模型辅助分析完成（REAL · 结果仅疑点线索，须人工复核）'), session.sessionId);
      }}
      onSimulateFollowups={(annotationId) => {
        if (session === null) return;
        void runWrite('annotations/simulate', { annotationId, expectedVersion: remoteVersion }, 'simulate-followups', () => setNotice('模拟追问已生成（SIMULATION）'), session.sessionId);
      }}
      onRetryPending={(requestId) => { void retryPending(requestId); }}
      onDiscardPending={discardPendingById}
      onAddTranscriptDemo={addTranscriptDemo}
      onAttemptCalculation={() => {
        if (session === null) return;
        void runWrite('calculation', { expectedVersion: remoteVersion }, 'attempt-calculation', (data) => { setCalcResult([data.calculation as SessionDetail['calculations'][0]]); }, session.sessionId);
      }}
    />
  );
}
