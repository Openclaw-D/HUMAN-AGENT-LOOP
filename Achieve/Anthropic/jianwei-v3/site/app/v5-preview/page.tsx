"use client";

// V5 ROWS · 业务角色 · 新客回租单项目 · 四域横条总览（前后端联动）。
// 事实源 = 后端 /api/v5-preview/**（FROZEN 契约）；sessionStorage 只承载"客户端待确认命令"
//（完整原载荷恢复记录），不是业务事实源。数据获取：挂载 GET → 写入后用响应 overview →
// 每 4s 轮询 → visibilitychange/focus 重新 GET（第二视口一致性）。
// 409 VERSION_CONFLICT：保留草稿、横幅提示版本已更新并自动重新 GET。
// V6 BATCH_2 rework-1：R1 刷新后按完整原载荷恢复/确认未知请求；R2 说明与消息两条独立
// 恢复通道（互不误清，同类第二次提交不静默覆盖）；R3 回执按 requestId 所有权与草稿修订
// 标识生效，旧回执不清后来编辑的新草稿、不挂上新情景。
// V6 SE_REBUILD（sub-agent A）：渲染层重组为紧凑连续面板。所有 hooks/回调/存储键/版本门/
// 恢复通道原样保留。
// V6 REPAIR evening（A · B 候选集成）：渲染层改用 B 候选 HomeOverview（页头菜单/重开图标/
// 五阶段/四域矩阵/演示条/待办/沟通；取消硬半屏与合成控制下拉，见 COMMON R-01/R-02）。
// 页面层仅保留数据与写通道（唯一后端事实源不变）；重开走 POST /demo/reset（当前专属演示
// 作用域，确认流在 HomeHeader 内）；共享尽调事实经 fetchSharedFacts 传入 StoryStrip。
// 情景切换 UI 随合成控制下拉移除（用户批注）；/demo/seed API 与 seedScenario 服务保留。
// 页面不出现任何真实审批/放款/结清业务按钮。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectOverview } from '../../lib/v5-preview/shared-types';
import HomeOverview from './home-overview';
import { ApiFailure, fetchOverview, fetchSharedFacts, fetchStoryState, postDemoReset, postMessageBody, postNoteBody, postStoryCommand, writeOutcome, type SharedFactsView } from './api-client';
import type { HomeBanner } from './home-contract';
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
import type { StoryStateView } from './api-client';
import styles from './se-overview.module.css';

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
  // V6 NIGHT_SIMPLIFY · 固定演示主线：story 状态（稳定游标定位）+ 写入忙碌/错误。
  // 重开确认流在 HomeHeader 内（B 候选）；确认后调用本层 restartStory（demo/reset）。
  const [storyState, setStoryState] = useState<StoryStateView | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  // 人工决定结果提示：确认/纠正/退回各有明确不同的结果表述（推进时清除，不与下一步混淆）。
  const [storyNotice, setStoryNotice] = useState<string | null>(null);
  // V6 REPAIR evening · 共享尽调事实（同一演示项目/专属会话的证据版本与待复核投影）。
  const [sharedFacts, setSharedFacts] = useState<SharedFactsView | null>(null);

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

  // V6 NIGHT_SIMPLIFY · story 状态获取（稳定游标定位；失败时演示条隐藏，总览自身错误已如实报告存储状态）。
  // V6 REPAIR evening：同时拉取共享尽调事实（读取可能触发服务端投影同步——INTERFACE §3）。
  const fetchStory = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchStoryState();
      setStoryState(data);
    } catch {
      setStoryState(null);
    }
    try {
      setSharedFacts(await fetchSharedFacts());
    } catch {
      setSharedFacts(null); // 共享事实失败不阻塞演示条（面板按 null 处理）。
    }
  }, []);

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
      // 固定演示条与总览同节奏刷新（挂载/轮询/焦点/写入后）。
      void fetchStory();
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
  }, [setNoteRecoverySafe, setMessageRecoverySafe, fetchStory]);

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

  // V6 NIGHT_SIMPLIFY · 固定演示主线写路径（推进/人工决定）：requestId 幂等 + expectedVersion
  // 乐观并发 + fromStepId 步骤门（服务端）。409 族（步骤已变化/需先决定/版本过期）= 状态已
  // 被推进或他人改变：静默对齐服务端真相，不显示阻断错误（防双击跳步的确定性兜底）。
  const runStoryCommand = useCallback(async (payload: {
    action: 'advance' | 'decide';
    fromStepId: string;
    decision?: 'confirm' | 'correct' | 'return';
  }): Promise<void> => {
    const current = overviewRef.current;
    if (current === null) return;
    setStoryBusy(true);
    setStoryError(null);
    if (payload.action === 'advance') setStoryNotice(null);
    try {
      const res = await postStoryCommand({ ...payload, requestId: newRequestId(), expectedVersion: current.version });
      applyWriteResponse(res.overview);
      if (payload.action === 'decide') {
        // 三分支结果各有一句明确不同的表述（同一状态解释体系：确认=按现意见继续；纠正=意见更新并留档；退回=补材料后再判断）。
        setStoryNotice(
          payload.decision === 'confirm'
            ? '已确认：按当前意见继续推进（人工判断已留档）。'
            : payload.decision === 'correct'
              ? '已纠正：人工纠正意见已更新并入档，相关判断按更正后口径继续。'
              : '已退回：等待按退回意见补充材料，补充后重新进入人工判断。',
        );
      }
      void fetchStory();
      return;
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : 'NETWORK';
      if (code === 'STORY_STEP_CHANGED' || code === 'STORY_DECISION_REQUIRED' || code === 'VERSION_CONFLICT') {
        // 状态已被推进/需先决定/版本过期：静默对齐服务端真相（防双击跳步的确定性兜底）。
        void refresh();
        return;
      }
      if (code === 'NETWORK') {
        setStoryError('网络异常：演示进度未确认；演示控制操作可安全重试，请再点一次');
      } else {
        setStoryError(
          code === 'REQUEST_MISMATCH'
            ? '演示推进请求不一致：已保留状态，请重新操作'
            : userFacingErrorMessage(code, error instanceof ApiFailure ? error.message : undefined),
        );
      }
    } finally {
      setStoryBusy(false);
    }
  }, [applyWriteResponse, fetchStory, refresh]);

  // REPAIR evening · 重开当前专属演示：POST /demo/reset（主线回起点 + 清除专属演示会话数据；
  // 其他会话与真实记录不动）。非 seed（情景切换保留远程数据），作用域见确认框文案。
  const restartStory = useCallback(async (): Promise<void> => {
    setStoryError(null);
    setSeedBusy(true);
    try {
      const res = await postDemoReset();
      const current = overviewRef.current;
      if (current !== null && !shouldApplyOverview(res.overview.version, current.version)) {
        void refresh();
      } else {
        applyOverview(res.overview);
        setSeedNotice('已重新开始固定演示：主线回到起点，当前专属演示会话数据已清除（其他会话不受影响）');
      }
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : null;
      setSeedError(`重新开始失败：${userFacingErrorMessage(failure?.code ?? 'UNKNOWN', failure?.message)}`);
      void refresh();
    } finally {
      setSeedBusy(false);
    }
    void fetchStory();
  }, [applyOverview, fetchStory, refresh]);

  // REPAIR evening：页面级横幅收敛为 HomeBanner（B 候选根组件渲染）。
  const banners: HomeBanner[] = [];
  if (conflict !== null) banners.push({ id: 'conflict', kind: 'warn', text: conflict.text });
  if (pollError !== null) banners.push({ id: 'poll', kind: 'soft', text: pollError });
  if (recoveryNotice !== null) banners.push({ id: 'recovery', kind: 'soft', text: recoveryNotice });
  if (seedError !== null) banners.push({ id: 'seedError', kind: 'danger', text: seedError });
  if (seedNotice !== null) banners.push({ id: 'seedNotice', kind: 'soft', text: seedNotice });

  return (
    <div className={styles.seOverviewRoot}>
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
        <HomeOverview
          overview={overview}
          story={storyState}
          shared={sharedFacts}
          storyBusy={storyBusy}
          storyError={storyError}
          storyNotice={storyNotice}
          onAdvance={(fromStepId) => { void runStoryCommand({ action: 'advance', fromStepId }); }}
          onDecide={(fromStepId, kind) => { void runStoryCommand({ action: 'decide', fromStepId, decision: kind }); }}
          onRestart={() => { void restartStory(); }}
          restarting={seedBusy}
          onSubmitNote={submitNote}
          pendingNote={noteRecovery}
          onResolvePendingNote={() => resolveRequest('note')}
          onDismissPendingNote={() => {
            setNoteRecoverySafe(null);
            setRecoveryNotice(null);
          }}
          resolvingPendingNote={resolving === 'note'}
          onSendMessage={sendMessage}
          pendingMessage={messageRecovery}
          onResolvePendingMessage={() => resolveRequest('message')}
          onDismissPendingMessage={() => {
            setMessageRecoverySafe(null);
            setRecoveryNotice(null);
          }}
          resolvingPendingMessage={resolving === 'message'}
          recoveryPersistFailed={recoveryPersistFailed}
          banners={banners}
          remoteHref="/v5-preview/remote-session"
        />
      ) : null}
    </div>
  );
}
