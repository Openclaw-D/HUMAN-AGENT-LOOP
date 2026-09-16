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
import { ApiFailure, fetchOverview, postMessage, postNote, postSeed, writeOutcome } from './api-client';
import { keepRequestIdForRetry, newRequestId, type SubmitOutcome } from './rows-logic';
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

/** 最近一次写入尝试：网络错误后原样重试时复用同一 requestId（服务端幂等，不重复记账）。 */
interface PendingAttempt {
  requestId: string;
  text: string;
}

export default function V5PreviewPage() {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictNotice | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const overviewRef = useRef<ProjectOverview | null>(null);
  const noteAttemptRef = useRef<PendingAttempt | null>(null);
  const messageAttemptRef = useRef<PendingAttempt | null>(null);

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
      overviewRef.current = data;
      setOverview(data);
      setPhase('ready');
      setLoadError(null);
      setPollError(null);
      // 本视口已追上冲突目标版本 → 撤下横幅。
      setConflict((prev) => (prev !== null && data.version >= prev.toVersion ? null : prev));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (overviewRef.current === null) {
        setPhase('error');
        setLoadError(message);
      } else {
        // 已有数据时轮询失败不清空画面：保留当前显示并提示。
        setPollError(`自动刷新失败（保留当前显示）：${message}`);
      }
    }
  }, []);

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
    const expectedVersion = current.version;
    const previous = noteAttemptRef.current;
    const requestId = previous !== null && previous.text === text ? previous.requestId : newRequestId();
    noteAttemptRef.current = { requestId, text };
    try {
      const res = await postNote(expectedVersion, todoId, text, requestId);
      // 确定性成功：清空幂等引用，下一次提交用新 requestId（避免同 requestId 换载荷误判 REQUEST_MISMATCH）。
      noteAttemptRef.current = null;
      applyOverview(res.overview);
      return { outcome: 'ok', replayed: res.replayed === true };
    } catch (error) {
      // 仅"结果未知"（NETWORK）保留原 requestId 供原样重试；任何 HTTP 确定性响应立即清空。
      if (!keepRequestIdForRetry(error instanceof ApiFailure ? error.code : 'NETWORK')) {
        noteAttemptRef.current = null;
      }
      const result = writeOutcome(error, expectedVersion, (banner, toVersion) => setConflict({ text: banner, toVersion }));
      // 409 冲突：横幅已显示、草稿保留，自动重新 GET 用服务端最新版本重试。
      if (result.outcome === 'conflict') void refresh();
      return result;
    }
  }, [applyOverview, refresh]);

  const sendMessage = useCallback(async (text: string): Promise<SubmitOutcome> => {
    const current = overviewRef.current;
    if (current === null) {
      return { outcome: 'error', code: 'NO_OVERVIEW', message: '总览尚未加载（合成演示）' };
    }
    const expectedVersion = current.version;
    const previous = messageAttemptRef.current;
    const requestId = previous !== null && previous.text === text ? previous.requestId : newRequestId();
    messageAttemptRef.current = { requestId, text };
    try {
      const res = await postMessage(expectedVersion, text, requestId);
      // 确定性成功：清空幂等引用（P1-2），下一次发言用新 requestId。
      messageAttemptRef.current = null;
      applyOverview(res.overview);
      return { outcome: 'ok', replayed: res.replayed === true };
    } catch (error) {
      // 仅"结果未知"（NETWORK）保留原 requestId 供原样重试；任何 HTTP 确定性响应立即清空。
      if (!keepRequestIdForRetry(error instanceof ApiFailure ? error.code : 'NETWORK')) {
        messageAttemptRef.current = null;
      }
      const result = writeOutcome(error, expectedVersion, (banner, toVersion) => setConflict({ text: banner, toVersion }));
      // 409 冲突：横幅已显示、输入保留，自动重新 GET。
      if (result.outcome === 'conflict') void refresh();
      return result;
    }
  }, [applyOverview, refresh]);

  const seedScenario = useCallback(async (scenario: ScenarioId) => {
    setSeedBusy(true);
    setSeedError(null);
    try {
      const res = await postSeed(scenario);
      applyOverview(res.overview);
    } catch (error) {
      const detail = error instanceof ApiFailure ? `${error.code}：${error.message}` : error instanceof Error ? error.message : String(error);
      setSeedError(`演示情景切换失败：${detail}`);
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
        <span className={styles.previewBarNote}>不产生正式 Decision/Receipt；正式审批禁用</span>
        <label className={styles.barField} htmlFor="v5-rows-scenario">
          演示情景
          <select
            id="v5-rows-scenario"
            value={overview?.scenario ?? ''}
            disabled={seedBusy || phase !== 'ready'}
            onChange={(e) => {
              void seedScenario(e.target.value as ScenarioId);
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

      {conflict !== null ? (
        <p className={styles.conflictBanner} role="alert">
          {conflict.text}
        </p>
      ) : null}
      {pollError !== null ? <p className={styles.softNotice} role="status">{pollError}</p> : null}
      {seedError !== null ? <p className={styles.formError} role="alert">{seedError}</p> : null}

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
          <TodoCard todo={overview.todo} onSubmitNote={submitNote} />
          <ChatPanel messages={overview.messages} onSendMessage={sendMessage} />
        </RowsView>
      ) : null}
    </div>
  );
}
