"use client";

// V5 ROWS · 业务角色 · 新客回租单项目 · 四域横条总览（前后端联动）。
// 事实源 = 后端 /api/v5-preview/**（FROZEN 契约）；sessionStorage 只承载"客户端待确认命令"
//（完整原载荷恢复记录），不是业务事实源。数据获取：挂载 GET → 写入后用响应 overview →
// 每 4s 轮询 → visibilitychange/focus 重新 GET（第二视口一致性）。
// 409 VERSION_CONFLICT：保留草稿、横幅提示版本已更新并自动重新 GET。
// V6 BATCH_2 rework-1：R1 刷新后按完整原载荷恢复/确认未知请求；R2 说明与消息两条独立
// 恢复通道（互不误清，同类第二次提交不静默覆盖）；R3 回执按 requestId 所有权与草稿修订
// 标识生效，旧回执不清后来编辑的新草稿、不挂上新情景。
// V6 SE_REBUILD（sub-agent A）：渲染层重组为紧凑连续面板（100dvh，无整页滚动，仅消息列表
// 内部滚动）。所有 hooks/回调/存储键/版本门/恢复通道原样保留；演示情景切换/技术说明/版本
// 信息收进客户行右缘二级下拉（demoControls 槽位传入 RowsView），不占主操作行。
// 页面不出现任何真实审批/放款/结清业务按钮；情景切换仅是演示控制·非业务操作。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectOverview, ScenarioId } from '../../lib/v5-preview/shared-types';
import RowsView from './rows-view';
import TodoCard from './todo-card';
import ChatPanel from './chat-panel';
import { ApiFailure, fetchOverview, postMessageBody, postNoteBody, postSeed, writeOutcome } from './api-client';
import {
  buildMessageBody,
  buildNoteBody,
  decideRepeatSubmit,
  formatMessageTime,
  isSameRequestOwner,
  isStaleRecordScenario,
  keepRequestIdForRetry,
  messageBodyFromRecord,
  newRequestId,
  noteBodyFromRecord,
  parseStoredMessageRequest,
  parseStoredNoteRequest,
  pendingRequestBlockMessage,
  recoveryConflictNotice,
  recoveryLimitedNotice,
  shouldApplyOverview,
  shouldApplyWriteResponse,
  staleRecordNotice,
  staleRequestMessage,
  userFacingErrorMessage,
  userFacingLoadError,
  type MessageBody,
  type MessageRecoverySlot,
  type NoteBody,
  type NoteRecoverySlot,
  type ResolveOutcome,
  type StoredMessageRequest,
  type StoredNoteRequest,
  type SubmitOutcome,
} from './rows-logic';
import styles from './se-overview.module.css';

const SCENARIO_OPTIONS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'approval', label: '审批推进中' },
  { id: 'post-rental', label: '起租后资产管理' },
  { id: 'settled', label: '已结清（演示）' },
];

const POLL_MS = 4000;

/** 恢复记录存储键（R1/R2：两条独立通道；旧版共享哨兵键仅做迁移清理）。 */
const NOTE_REQUEST_KEY = 'jw:v5-preview:pending-note-request';
const MESSAGE_REQUEST_KEY = 'jw:v5-preview:pending-message-request';
const LEGACY_PENDING_NOTE_KEY = 'jw:v5-preview:pending-note';

interface ConflictNotice {
  text: string;
  toVersion: number;
}

function readStorageItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorageItem(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 存储不可用：恢复记录仅存活于当前会话内存。
  }
}

export default function V5PreviewPage() {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictNotice | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  // CP2-5：情景切换确认流——记录待切换目标；取消不发写入。
  const [pendingScenario, setPendingScenario] = useState<ScenarioId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const overviewRef = useRef<ProjectOverview | null>(null);
  // R1/R2：两条恢复通道（说明/消息各一条，至多一条未知请求）。状态驱动渲染，ref 供
  // 异步回执同步做所有权判定（不经过渲染周期）。
  const [noteRecovery, setNoteRecovery] = useState<NoteRecoverySlot>(null);
  const [messageRecovery, setMessageRecovery] = useState<MessageRecoverySlot>(null);
  const noteRecoveryRef = useRef<NoteRecoverySlot>(null);
  const messageRecoveryRef = useRef<MessageRecoverySlot>(null);
  // 恢复记录写入 sessionStorage 失败：确认仍可用（内存记录），但刷新后可能无法恢复——如实提示。
  const [recoveryPersistFailed, setRecoveryPersistFailed] = useState(false);
  // 确认动作的结果提示（重放冲突/确定性失败/恢复受限迁移），页面级软提示。
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  // 确认动作进行中：禁用两个恢复按钮（连续点击不重复重放）。
  const [resolving, setResolving] = useState<'note' | 'message' | null>(null);

  const setNoteRecoverySafe = useCallback((slot: NoteRecoverySlot) => {
    noteRecoveryRef.current = slot;
    setNoteRecovery(slot);
    if (slot === null || slot.status === 'limited') {
      removeStorageItem(NOTE_REQUEST_KEY);
      return;
    }
    setRecoveryPersistFailed(!writeStorageItem(NOTE_REQUEST_KEY, JSON.stringify(slot.record)));
  }, []);

  const setMessageRecoverySafe = useCallback((slot: MessageRecoverySlot) => {
    messageRecoveryRef.current = slot;
    setMessageRecovery(slot);
    if (slot === null || slot.status === 'limited') {
      removeStorageItem(MESSAGE_REQUEST_KEY);
      return;
    }
    setRecoveryPersistFailed(!writeStorageItem(MESSAGE_REQUEST_KEY, JSON.stringify(slot.record)));
  }, []);

  // 挂载恢复（R1）：读取两条通道的完整记录。记录缺失 = 无未知请求；损坏/类型变形/旧版
  // 哨兵 = 恢复受限（明确提示，不提供虚假确认按钮，不猜测"已提交"）。
  useEffect(() => {
    const t = window.setTimeout(() => {
      const noteRaw = readStorageItem(NOTE_REQUEST_KEY);
      if (noteRaw !== null) {
        const parsed = parseStoredNoteRequest(noteRaw);
        if (parsed.status === 'valid') {
          setNoteRecoverySafe({ status: 'valid', record: parsed.value });
        } else {
          setNoteRecoverySafe({ status: 'limited', reason: 'corrupt' });
          setRecoveryNotice(recoveryLimitedNotice('note', 'corrupt'));
        }
      }
      const messageRaw = readStorageItem(MESSAGE_REQUEST_KEY);
      if (messageRaw !== null) {
        const parsed = parseStoredMessageRequest(messageRaw);
        if (parsed.status === 'valid') {
          setMessageRecoverySafe({ status: 'valid', record: parsed.value });
        } else {
          setMessageRecoverySafe({ status: 'limited', reason: 'corrupt' });
          setRecoveryNotice(recoveryLimitedNotice('message', 'corrupt'));
        }
      }
      // 旧版布尔哨兵迁移：只有 '1'、没有完整载荷 → 不得当作完整请求恢复成功。
      if (readStorageItem(LEGACY_PENDING_NOTE_KEY) !== null) {
        removeStorageItem(LEGACY_PENDING_NOTE_KEY);
        if (noteRecoveryRef.current === null) {
          setNoteRecoverySafe({ status: 'limited', reason: 'legacy' });
          setRecoveryNotice(recoveryLimitedNotice('note', 'legacy'));
        }
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [setNoteRecoverySafe, setMessageRecoverySafe]);

  const applyOverview = useCallback((next: ProjectOverview) => {
    overviewRef.current = next;
    setOverview(next);
    setPhase('ready');
    setPollError(null);
    setConflict(null);
    // R3：情景归属失效检查（静默清理；seed 成功路径有自己的整体提示）。
    const noteSlot = noteRecoveryRef.current;
    if (noteSlot?.status === 'valid' && isStaleRecordScenario(noteSlot.record, next.scenario)) {
      setNoteRecoverySafe(null);
    }
    const messageSlot = messageRecoveryRef.current;
    if (messageSlot?.status === 'valid' && isStaleRecordScenario(messageSlot.record, next.scenario)) {
      setMessageRecoverySafe(null);
    }
  }, [setNoteRecoverySafe, setMessageRecoverySafe]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchOverview();
      // V6 BATCH_2 CP2-1：GET（首载/轮询/焦点/冲突刷新）统一经版本门——旧 GET 晚到不得回退页面。
      const current = overviewRef.current;
      if (current !== null && !shouldApplyOverview(data.version, current.version)) {
        return;
      }
      overviewRef.current = data;
      setOverview(data);
      setPhase('ready');
      setLoadError(null);
      setPollError(null);
      // 本视口已追上冲突目标版本 → 撤下横幅。
      setConflict((prev) => (prev !== null && data.version >= prev.toVersion ? null : prev));
      // R3：跨视口情景变化时旧记录失效（带提示——用户此前看到的恢复条被移除的原因）。
      const noteSlot = noteRecoveryRef.current;
      if (noteSlot?.status === 'valid' && isStaleRecordScenario(noteSlot.record, data.scenario)) {
        setNoteRecoverySafe(null);
        setRecoveryNotice(staleRecordNotice('note'));
      }
      const messageSlot = messageRecoveryRef.current;
      if (messageSlot?.status === 'valid' && isStaleRecordScenario(messageSlot.record, data.scenario)) {
        setMessageRecoverySafe(null);
        setRecoveryNotice(staleRecordNotice('message'));
      }
    } catch (error) {
      // V6 BATCH_2 CP2-4：用户可见错误统一中文，不透传内部字段/原始异常。
      const failure = error instanceof ApiFailure ? error : null;
      if (overviewRef.current === null) {
        setPhase('error');
        setLoadError(userFacingLoadError(failure?.code ?? 'UNKNOWN', failure?.message));
      } else {
        // 已有数据时轮询失败不清空画面：保留当前显示并提示。
        setPollError('自动刷新失败（已保留当前显示）：请检查演示服务是否可用');
      }
    }
  }, [setNoteRecoverySafe, setMessageRecoverySafe]);

  /** 写入/重放路径（V6-CTRL C + BATCH_2 CP2-1 + rework-2 F2）：旧版本响应不回退；
   *  情景上下文门比对**页面当前情景**（overviewRef.current.scenario）与回执情景——
   *  不是发送时快照（旧回执与发送时情景本来就相同，比对快照永远放行，F2）；
   *  同名情景往返（A→B→A 生命周期）由服务端全局单调版本区分，版本门保留。
   *  GET 响应不经此门（全局真相）。 */
  const applyWriteResponse = useCallback((next: ProjectOverview) => {
    const current = overviewRef.current;
    if (current !== null) {
      if (!shouldApplyWriteResponse(next.scenario, current.scenario)) {
        void refresh();
        return;
      }
      if (!shouldApplyOverview(next.version, current.version)) {
        void refresh();
        return;
      }
    }
    applyOverview(next);
  }, [applyOverview, refresh]);

  // 挂载 GET + 每 4s 轮询：首次与后续都经定时器回调触发（不在 effect 体内同步 setState）。
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // visibilitychange / focus 时重新 GET（第二视口一致性）。
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [refresh]);

  const submitNote = useCallback(async (todoId: string, text: string): Promise<SubmitOutcome> => {
    const current = overviewRef.current;
    if (current === null || current.todo === null) {
      return { outcome: 'error', code: 'NO_OVERVIEW', message: '总览尚未加载或无开放待办（合成演示）' };
    }
    // R2：同类型已有未知结果 → 同内容重放完整原请求；内容已改 → 明确阻断（不静默覆盖旧记录）。
    const existing = noteRecoveryRef.current?.status === 'valid' ? noteRecoveryRef.current.record : null;
    const decision = decideRepeatSubmit(existing, { kind: 'note', todoId, text });
    if (decision === 'block') {
      return { outcome: 'error', code: 'PENDING_REQUEST_EXISTS', message: pendingRequestBlockMessage('note') };
    }
    const body: NoteBody =
      decision === 'replay' && existing !== null
        ? noteBodyFromRecord(existing)
        : buildNoteBody(todoId, text, current.version, newRequestId());
    // R1：发送前建立恢复记录（覆盖发送中发生刷新的窗口），含 requestId/expectedVersion/
    // todoId/原文本/情景归属；确认与重试都复用该记录原样重放。
    setNoteRecoverySafe({
      status: 'valid',
      record: {
        kind: 'note',
        requestId: body.requestId,
        expectedVersion: body.expectedVersion,
        todoId: body.todoId,
        text: body.text,
        scenario: current.scenario,
        savedAt: Date.now(),
      },
    });
    try {
      const res = await postNoteBody(body);
      // R2/R3 所有权：仅当本请求仍是当前记录时清理（被取代/已作废的回执不触碰新状态）。
      if (isSameRequestOwner(noteRecoveryRef.current, body.requestId)) setNoteRecoverySafe(null);
      // 重放返回的旧 overview 不回退覆盖页面已获得的更新版本（V6-CTRL C）；
      // 旧情景回执不得应用（F2 情景上下文门比对当前上下文）。
      applyWriteResponse(res.overview);
      // requestId 随结果返回：组件据此建立"草稿-请求关联"（F1——被阻断提交不携带，不改写关联）。
      return { outcome: 'ok', replayed: res.replayed === true, requestId: body.requestId };
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : 'NETWORK';
      // F2：先判定所有权，再产生任何副作用（横幅/记录清理/刷新）。
      const owner = isSameRequestOwner(noteRecoveryRef.current, body.requestId);
      // 仅"结果未知"（NETWORK）保留恢复记录供确认入口重试；确定性响应清记录（若仍是所有者）。
      if (!keepRequestIdForRetry(code) && owner) setNoteRecoverySafe(null);
      // 陈旧回执不设置冲突横幅（onConflict 以所有权为前提）。
      const result = writeOutcome(error, body.expectedVersion, owner ? (banner, toVersion) => setConflict({ text: banner, toVersion }) : () => {});
      if (result.outcome === 'conflict') {
        // 陈旧回执的 409 不显示为新冲突（旧请求已随情景切换作废），也不改写新操作的反馈。
        if (!owner) return { outcome: 'error', code: 'STALE_REQUEST', message: staleRequestMessage(), requestId: body.requestId };
        // 409 冲突：横幅已显示、草稿保留，自动重新 GET 用服务端最新版本重试。
        void refresh();
        return { ...result, requestId: body.requestId };
      }
      if (result.outcome === 'error') {
        // requestId 仅在请求结果未知（记录保留、确认入口可用）时返回，供组件建立关联。
        return { ...result, requestId: keepRequestIdForRetry(code) ? body.requestId : undefined };
      }
      return result;
    }
  }, [applyWriteResponse, refresh, setNoteRecoverySafe]);

  const sendMessage = useCallback(async (text: string): Promise<SubmitOutcome> => {
    const current = overviewRef.current;
    if (current === null) {
      return { outcome: 'error', code: 'NO_OVERVIEW', message: '总览尚未加载（合成演示）' };
    }
    // R2：消息通道独立决策（与说明互不影响）。
    const existing = messageRecoveryRef.current?.status === 'valid' ? messageRecoveryRef.current.record : null;
    const decision = decideRepeatSubmit(existing, { kind: 'message', text });
    if (decision === 'block') {
      return { outcome: 'error', code: 'PENDING_REQUEST_EXISTS', message: pendingRequestBlockMessage('message') };
    }
    const body: MessageBody =
      decision === 'replay' && existing !== null
        ? messageBodyFromRecord(existing)
        : buildMessageBody(text, current.version, newRequestId());
    setMessageRecoverySafe({
      status: 'valid',
      record: {
        kind: 'message',
        requestId: body.requestId,
        expectedVersion: body.expectedVersion,
        text: body.text,
        scenario: current.scenario,
        savedAt: Date.now(),
      },
    });
    try {
      const res = await postMessageBody(body);
      if (isSameRequestOwner(messageRecoveryRef.current, body.requestId)) setMessageRecoverySafe(null);
      applyWriteResponse(res.overview);
      return { outcome: 'ok', replayed: res.replayed === true, requestId: body.requestId };
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : 'NETWORK';
      // F2：先判定所有权，再产生任何副作用（横幅/记录清理/刷新）。
      const owner = isSameRequestOwner(messageRecoveryRef.current, body.requestId);
      if (!keepRequestIdForRetry(code) && owner) setMessageRecoverySafe(null);
      const result = writeOutcome(error, body.expectedVersion, owner ? (banner, toVersion) => setConflict({ text: banner, toVersion }) : () => {});
      if (result.outcome === 'conflict') {
        if (!owner) return { outcome: 'error', code: 'STALE_REQUEST', message: staleRequestMessage(), requestId: body.requestId };
        // 409 冲突：横幅已显示、输入保留，自动重新 GET。
        void refresh();
        return { ...result, requestId: body.requestId };
      }
      if (result.outcome === 'error') {
        return { ...result, requestId: keepRequestIdForRetry(code) ? body.requestId : undefined };
      }
      return result;
    }
  }, [applyWriteResponse, refresh, setMessageRecoverySafe]);

  /** 确认动作（R1）：对未知请求按完整原载荷重放一次（幂等安全）。
   *  真正收到该请求的成功/幂等回执才算确认；冲突/确定性失败显示相应结果并清记录；
   *  NETWORK 再次失败保留记录，用户可重试。GET 当前状态不能替代请求级确认。
   *  rework-2 F2：响应到达时重新判定所有权——非所有者（请求已被情景切换作废/取代）
   *  一律返回 stale 并跳过全部反馈副作用（不清理、不出提示、不改忙碌语义之外的状态）。 */
  const resolveRequest = useCallback(async (kind: 'note' | 'message'): Promise<ResolveOutcome> => {
    const slot = kind === 'note' ? noteRecoveryRef.current : messageRecoveryRef.current;
    if (slot === null || slot.status !== 'valid') return { result: 'failed' };
    const record: StoredNoteRequest | StoredMessageRequest = slot.record;
    setResolving(kind);
    try {
      // 按 record.kind 判别 narrowing（record 与 kind 参数的相关性 TS 无法推断）。
      const res =
        record.kind === 'note'
          ? await postNoteBody(noteBodyFromRecord(record))
          : await postMessageBody(messageBodyFromRecord(record));
      const owner =
        kind === 'note'
          ? isSameRequestOwner(noteRecoveryRef.current, record.requestId)
          : isSameRequestOwner(messageRecoveryRef.current, record.requestId);
      if (owner) {
        if (kind === 'note') setNoteRecoverySafe(null);
        else setMessageRecoverySafe(null);
        setRecoveryNotice(null);
      }
      // 版本门 + 情景上下文门（比对当前上下文）兜底：陈旧回执不回退 DOM。
      applyWriteResponse(res.overview);
      return { result: owner ? 'ok' : 'stale', requestId: record.requestId };
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : 'NETWORK';
      const owner =
        kind === 'note'
          ? isSameRequestOwner(noteRecoveryRef.current, record.requestId)
          : isSameRequestOwner(messageRecoveryRef.current, record.requestId);
      if (code !== 'NETWORK' && owner) {
        // 确定性结果：清理记录并如实显示（重放 409 = 未落账，不宣称"必然已落账"）。
        if (kind === 'note') setNoteRecoverySafe(null);
        else setMessageRecoverySafe(null);
        const mapped =
          code === 'VERSION_CONFLICT'
            ? recoveryConflictNotice(kind)
            : userFacingErrorMessage(code, error instanceof ApiFailure ? error.message : undefined);
        setRecoveryNotice(`确认${kind === 'note' ? '说明' : '消息'}结果未完成：${mapped}`);
        void refresh();
      }
      if (!owner) return { result: 'stale', requestId: record.requestId };
      // NETWORK 且仍是所有者：记录保留，恢复行提示"确认未完成，可重试"。
      return { result: 'failed', requestId: record.requestId };
    } finally {
      setResolving(null);
    }
  }, [applyWriteResponse, refresh, setNoteRecoverySafe, setMessageRecoverySafe]);

  const seedScenario = useCallback(async (scenario: ScenarioId) => {
    setSeedBusy(true);
    setSeedError(null);
    setSeedNotice(null);
    try {
      const res = await postSeed(scenario);
      // V6 BATCH_2 CP2-1：seed 响应同样经版本门（旧响应不复活已结束情景）。
      const current = overviewRef.current;
      if (current !== null && !shouldApplyOverview(res.overview.version, current.version)) {
        void refresh();
        return;
      }
      // R3：切换重置演示记录与幂等表——旧恢复记录全部作废；在途回执经所有权检查不再
      // 清理/挂载/覆盖新情景。取消路径不进入此处（不写入）。
      setNoteRecoverySafe(null);
      setMessageRecoverySafe(null);
      applyOverview(res.overview);
      // V6-CTRL D：切换提示必须明确告知记录重置，不伪装成普通业务状态变化。
      setSeedNotice('已切换演示情景；此前演示记录已重置，保留的草稿不会自动提交');
      setRecoveryNotice(null);
    } catch (error) {
      // CP2-4：切换失败统一中文，不透传内部错误码/异常细节。
      const failure = error instanceof ApiFailure ? error : null;
      setSeedError(`演示情景切换失败：${userFacingErrorMessage(failure?.code ?? 'UNKNOWN', failure?.message)}`);
      // 回到服务端真相（情景/版本以服务端为准）。
      void refresh();
    } finally {
      setSeedBusy(false);
    }
  }, [applyOverview, refresh, setNoteRecoverySafe, setMessageRecoverySafe]);

  return (
    <div className={styles.seOverviewRoot}>
      {/* 页面级提示（紧凑单行；出现时沟通区收缩让位，不产生整页滚动）。 */}
      {conflict !== null ? (
        <p className={`${styles.notice} ${styles.noticeWarn}`} role="alert">{conflict.text}</p>
      ) : null}
      {pollError !== null ? <p className={`${styles.notice} ${styles.noticeSoft}`} role="status">{pollError}</p> : null}
      {recoveryNotice !== null ? <p className={`${styles.notice} ${styles.noticeSoft}`} role="status">{recoveryNotice}</p> : null}
      {seedError !== null ? <p className={`${styles.notice} ${styles.noticeDanger}`} role="alert">{seedError}</p> : null}
      {seedNotice !== null ? <p className={`${styles.notice} ${styles.noticeSoft}`} role="status">{seedNotice}</p> : null}

      {phase === 'loading' ? (
        <div className={styles.skeleton} role="status" aria-label="加载中（合成演示）">
          <span className={`${styles.skBlock} ${styles.skTitle}`} />
          <span className={`${styles.skBlock} ${styles.skLine}`} />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`${styles.skBlock} ${styles.skRow}`} />
          ))}
          <span className={styles.srOnly}>加载中（合成演示）…</span>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className={styles.errorCard} role="alert">
          <h1 className={styles.errorTitle}>无法加载项目总览</h1>
          <p className={styles.errorDetail}>{loadError}</p>
          <p className={styles.errorHint}>合成演示数据暂不可用；可点击重试。</p>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => {
              setPhase('loading');
              void refresh();
            }}
          >
            重试
          </button>
        </div>
      ) : null}

      {phase === 'ready' && overview !== null ? (
        <>
          <RowsView
            overview={overview}
            demoControls={(
              /* 二级收纳：演示情景切换（确认流在 page 层）+ 技术说明 + 版本信息；合成标记即 chip 本身。 */
              <details className={styles.demoDetails}>
                <summary className={styles.demoSummary}>合成演示·控制</summary>
                <div className={styles.demoMenu} role="region" aria-label="预览控制（合成演示）">
                  <label className={styles.demoField} htmlFor="v5-rows-scenario">
                    演示情景
                    <select
                      id="v5-rows-scenario"
                      className={styles.demoSelect}
                      value={overview.scenario}
                      disabled={seedBusy}
                      onChange={(e) => {
                        const nextScenario = e.target.value as ScenarioId;
                        // CP2-5：切换会重置此前演示记录——重置前明确说明影响并提供取消；取消不发写入。
                        // 有未确认请求或草稿时同样提示（旧请求不得悄悄提交给新待办）。
                        setPendingScenario(nextScenario);
                        setConfirmOpen(true);
                        e.target.value = overview.scenario;
                      }}
                    >
                      {SCENARIO_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.demoHint}>演示控制·非业务操作</p>
                  <p className={styles.demoNote}>合成演示数据，不执行正式审批。</p>
                  <p className={styles.demoVersion}>
                    版本 v{overview.version} · 更新于 {formatMessageTime(overview.updatedAt)} · {overview.scenarioLabel}
                  </p>
                </div>
              </details>
            )}
          >
            <TodoCard
              todo={overview.todo}
              onSubmitNote={submitNote}
              pendingNote={noteRecovery}
              resolvingPending={resolving === 'note'}
              recoveryPersistFailed={recoveryPersistFailed}
              onResolvePendingNote={() => resolveRequest('note')}
              onDismissPendingNote={() => {
                setNoteRecoverySafe(null);
                setRecoveryNotice(null);
              }}
            />
          </RowsView>
          {/* 沟通区 flex:1 常驻置底（外框固定，仅消息列表内部滚动）；尽调访谈入口在其工具行。 */}
          <ChatPanel
            messages={overview.messages}
            onSendMessage={sendMessage}
            pendingMessage={messageRecovery}
            resolvingPending={resolving === 'message'}
            recoveryPersistFailed={recoveryPersistFailed}
            onResolvePendingMessage={() => resolveRequest('message')}
            onDismissPendingMessage={() => {
              setMessageRecoverySafe(null);
              setRecoveryNotice(null);
            }}
          />
        </>
      ) : null}

      {confirmOpen && pendingScenario !== null ? (
        <div className={styles.confirmCard} role="alertdialog" aria-label="确认切换演示情景">
          <p className={styles.confirmTitle}>切换到「{SCENARIO_OPTIONS.find((s) => s.id === pendingScenario)?.label}」？</p>
          <p className={styles.confirmDetail}>
            切换会重置演示记录：此前的补充说明与项目沟通记录不会保留；未发送的请求将被取消，已填写的草稿保留在本页且不会自动提交。
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={seedBusy}
              onClick={() => {
                // 取消：不发任何写入；select 由受控 value 自动回当前情景。
                setConfirmOpen(false);
                setPendingScenario(null);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={seedBusy}
              onClick={() => {
                setConfirmOpen(false);
                const target = pendingScenario;
                setPendingScenario(null);
                if (target !== null) void seedScenario(target);
              }}
            >
              确认切换
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
