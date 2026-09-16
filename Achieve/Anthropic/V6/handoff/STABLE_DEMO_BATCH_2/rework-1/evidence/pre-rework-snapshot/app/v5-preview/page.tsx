"use client";

// V5 ROWS · 业务角色 · 新客回租单项目 · 四域横条总览（前后端联动）。
// 事实源 = 后端 /api/v5-preview/**（FROZEN 契约）；localStorage/sessionStorage 不承载业务事实。
// 数据获取：挂载 GET → 写入后用响应 overview → 每 4s 轮询 → visibilitychange/focus 重新 GET
//（第二视口一致性）。409 VERSION_CONFLICT：保留草稿、横幅提示版本已更新并自动重新 GET。
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
  keepRequestIdForRetry,
  newRequestId,
  reuseAttemptBody,
  shouldApplyOverview,
  userFacingErrorMessage,
  userFacingLoadError,
  type MessageBody,
  type NoteBody,
  type SubmitOutcome,
} from './rows-logic';
import styles from './preview.module.css';

const SCENARIO_OPTIONS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'approval', label: '审批推进中' },
  { id: 'post-rental', label: '起租后资产管理' },
  { id: 'settled', label: '已结清（演示）' },
];

const POLL_MS = 4000;

interface ConflictNotice {
  text: string;
  toVersion: number;
}

/** 最近一次写入尝试：V6-CTRL C——网络结果未知后重放"完整原请求"（含首次发送时的
 *  expectedVersion、todoId 与原始文本），而不是只保留 requestId + text；否则轮询更新
 *  版本后重试会命中 409 REQUEST_MISMATCH。 */
interface PendingNoteAttempt {
  requestId: string;
  text: string;
  body: NoteBody;
}

interface PendingMessageAttempt {
  requestId: string;
  text: string;
  body: MessageBody;
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
  const noteAttemptRef = useRef<PendingNoteAttempt | null>(null);
  const messageAttemptRef = useRef<PendingMessageAttempt | null>(null);
  // CP2-2：未确认（结果未知）请求的可见状态——驱动待办卡"确认结果"恢复条。
  // 刷新后恢复：标记持久 sessionStorage（失败关闭：不可用/损坏即不显示恢复条，不影响事实源）。
  const [pendingNoteVisible, setPendingNoteVisible] = useState(false);

  const setPendingNoteVisibleSafe = useCallback((visible: boolean) => {
    setPendingNoteVisible(visible);
    try {
      if (visible) window.sessionStorage.setItem('jw:v5-preview:pending-note', '1');
      else window.sessionStorage.removeItem('jw:v5-preview:pending-note');
    } catch {
      // 存储不可用：仅恢复条不可见，业务状态不受影响。
    }
  }, []);

  // 刷新后若存在未确认标记，恢复显示（真相以轮询为准；确认动作幂等安全）。
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (window.sessionStorage.getItem('jw:v5-preview:pending-note') === '1') {
          setPendingNoteVisibleSafe(true);
        }
      } catch {
        // 忽略：无恢复条不影响任何业务状态。
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [setPendingNoteVisibleSafe]);

  const applyOverview = useCallback((next: ProjectOverview) => {
    overviewRef.current = next;
    setOverview(next);
    setPhase('ready');
    setPollError(null);
    setConflict(null);
  }, []);

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
  }, []);

  /** 写入/重放路径（V6-CTRL C + BATCH_2 CP2-1）：旧版本响应不回退，并立即刷新取服务端真相。 */
  const applyWriteResponse = useCallback((next: ProjectOverview) => {
    const current = overviewRef.current;
    if (current !== null && !shouldApplyOverview(next.version, current.version)) {
      void refresh();
      return;
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
    // V6-CTRL C：网络结果未知时保留"完整原请求"重放——requestId、expectedVersion、todoId、
    // 原始文本缺一不可；文本已被修改则原请求作废，按新请求（当前版本 + 新 requestId）发送。
    const previous = noteAttemptRef.current;
    const reusable = reuseAttemptBody(previous, text);
    const requestId = reusable !== null ? reusable.requestId : newRequestId();
    const body = reusable ?? buildNoteBody(todoId, text, current.version, requestId);
    noteAttemptRef.current = { requestId, text, body };
    try {
      const res = await postNoteBody(body);
      // 确定性成功：清空幂等引用与未确认标记，下一次提交用新 requestId（避免换载荷误判）。
      noteAttemptRef.current = null;
      setPendingNoteVisibleSafe(false);
      // 重放返回的旧 overview 不回退覆盖页面已获得的更新版本（V6-CTRL C）。
      applyWriteResponse(res.overview);
      return { outcome: 'ok', replayed: res.replayed === true };
    } catch (error) {
      // 仅"结果未知"（NETWORK）保留完整原请求供原样重试；任何 HTTP 确定性响应立即清空。
      if (!keepRequestIdForRetry(error instanceof ApiFailure ? error.code : 'NETWORK')) {
        noteAttemptRef.current = null;
        setPendingNoteVisibleSafe(false);
      } else {
        // CP2-2：结果未知 → 待办卡出现"确认结果"恢复条（待办转待复核后仍可达）。
        setPendingNoteVisibleSafe(true);
      }
      const result = writeOutcome(error, body.expectedVersion, (banner, toVersion) => setConflict({ text: banner, toVersion }));
      // 409 冲突：横幅已显示、草稿保留，自动重新 GET 用服务端最新版本重试。
      if (result.outcome === 'conflict') void refresh();
      return result;
    }
  }, [applyWriteResponse, refresh, setPendingNoteVisibleSafe]);

  const sendMessage = useCallback(async (text: string): Promise<SubmitOutcome> => {
    const current = overviewRef.current;
    if (current === null) {
      return { outcome: 'error', code: 'NO_OVERVIEW', message: '总览尚未加载（合成演示）' };
    }
    // V6-CTRL C：同 submitNote——完整原请求重放。
    const previous = messageAttemptRef.current;
    const reusable = reuseAttemptBody(previous, text);
    const requestId = reusable !== null ? reusable.requestId : newRequestId();
    const body = reusable ?? buildMessageBody(text, current.version, requestId);
    messageAttemptRef.current = { requestId, text, body };
    try {
      const res = await postMessageBody(body);
      // 确定性成功：清空幂等引用（P1-2），下一次发言用新 requestId。
      messageAttemptRef.current = null;
      applyWriteResponse(res.overview);
      return { outcome: 'ok', replayed: res.replayed === true };
    } catch (error) {
      // 仅"结果未知"（NETWORK）保留完整原请求供原样重试；任何 HTTP 确定性响应立即清空。
      if (!keepRequestIdForRetry(error instanceof ApiFailure ? error.code : 'NETWORK')) {
        messageAttemptRef.current = null;
      } else if (noteAttemptRef.current === null) {
        // 消息结果未知且无未确认说明时，也允许经待办恢复条确认（刷新+重放均幂等安全）。
        setPendingNoteVisibleSafe(true);
      }
      const result = writeOutcome(error, body.expectedVersion, (banner, toVersion) => setConflict({ text: banner, toVersion }));
      // 409 冲突：横幅已显示、输入保留，自动重新 GET。
      if (result.outcome === 'conflict') void refresh();
      return result;
    }
  }, [applyWriteResponse, refresh, setPendingNoteVisibleSafe]);

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
      applyOverview(res.overview);
      // V6-CTRL D：切换提示必须明确告知记录重置，不伪装成普通业务状态变化。
      setSeedNotice('已切换演示情景；此前演示记录已重置');
      // CP2-5：切换后未确认请求作废（旧请求不得提交给新情景），草稿保留由用户重新编辑。
      noteAttemptRef.current = null;
      messageAttemptRef.current = null;
    } catch (error) {
      // CP2-4：切换失败统一中文，不透传内部错误码/异常细节。
      const failure = error instanceof ApiFailure ? error : null;
      setSeedError(`演示情景切换失败：${userFacingErrorMessage(failure?.code ?? 'UNKNOWN', failure?.message)}`);
      // 回到服务端真相（情景/版本以服务端为准）。
      void refresh();
    } finally {
      setSeedBusy(false);
    }
  }, [applyOverview, refresh]);

  return (
    <div className={styles.previewRoot}>
      <header className={styles.previewBar} role="region" aria-label="预览控制（合成演示）">
        <b className={styles.previewBadge}>交互预览 · 合成数据</b>
        <span className={styles.previewBarNote}>合成演示数据，不执行正式审批</span>
        <label className={styles.barField} htmlFor="v5-rows-scenario">
          演示情景
          <select
            id="v5-rows-scenario"
            value={overview?.scenario ?? ''}
            disabled={seedBusy || phase !== 'ready'}
            onChange={(e) => {
              const nextScenario = e.target.value as ScenarioId;
              // CP2-5：切换会重置此前演示记录——重置前明确说明影响并提供取消；取消不发写入。
              // 有未确认请求或草稿时同样提示（旧请求不得悄悄提交给新待办）。
              setPendingScenario(nextScenario);
              setConfirmOpen(true);
              e.target.value = overview?.scenario ?? '';
            }}
          >
            {overview === null ? <option value="">加载中…</option> : null}
            {SCENARIO_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <span className={styles.barHint}>演示控制·非业务操作</span>
      </header>

      {confirmOpen && pendingScenario !== null ? (
        <div className={styles.confirmCard} role="alertdialog" aria-label="确认切换演示情景">
          <p className={styles.confirmTitle}>切换到「{SCENARIO_OPTIONS.find((s) => s.id === pendingScenario)?.label}」？</p>
          <p className={styles.confirmDetail}>
            切换会重置演示记录：此前的补充说明与项目沟通记录不会保留；未发送的请求将被取消，已填写的草稿保留在本页。
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.primaryBtn}
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
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={seedBusy}
              onClick={() => {
                // 取消：不发任何写入；select 由受控 value 自动回当前情景。
                setConfirmOpen(false);
                setPendingScenario(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      {conflict !== null ? (
        <p className={styles.conflictBanner} role="alert">
          {conflict.text}
        </p>
      ) : null}
      {pollError !== null ? <p className={styles.softNotice} role="status">{pollError}</p> : null}
      {seedError !== null ? <p className={styles.formError} role="alert">{seedError}</p> : null}
      {seedNotice !== null ? <p className={styles.softNotice} role="status">{seedNotice}</p> : null}

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
            className={styles.primaryBtn}
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
        <RowsView overview={overview}>
          <TodoCard
            todo={overview.todo}
            onSubmitNote={submitNote}
            hasPendingNote={pendingNoteVisible}
            onResolvePendingNote={async () => {
              // CP2-2 确认动作：刷新取服务端真相；若说明尚未落账则按完整原载荷重放一次（幂等安全）。
              await refresh();
              const attempt = noteAttemptRef.current;
              if (attempt !== null) {
                try {
                  const res = await postNoteBody(attempt.body);
                  noteAttemptRef.current = null;
                  setPendingNoteVisibleSafe(false);
                  applyWriteResponse(res.overview);
                } catch (error) {
                  if (!keepRequestIdForRetry(error instanceof ApiFailure ? error.code : 'NETWORK')) {
                    noteAttemptRef.current = null;
                    setPendingNoteVisibleSafe(false);
                  }
                  const failure = error instanceof ApiFailure ? error : null;
                  if (failure !== null && failure.code === 'VERSION_CONFLICT') {
                    // 已落账且被后续写入推进：刷新即见真相，无需用户处理。
                    await refresh();
                    noteAttemptRef.current = null;
                    setPendingNoteVisibleSafe(false);
                  }
                }
              }
            }}
          />
          <ChatPanel messages={overview.messages} onSendMessage={sendMessage} />
        </RowsView>
      ) : null}
    </div>
  );
}
