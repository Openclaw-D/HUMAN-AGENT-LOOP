"use client";

// V5 PREVIEW · 独立预览路由壳：/v5-preview
// 布局（手机/横屏）与视图（总览/详情）切换；视图与窗口断点经 useSyncExternalStore
// 从浏览器环境读取（SSR 快照给安全默认值，不产生水合不一致）。
// 页面始终明确「交互预览 · 合成数据」；角色切换仅为预览视角，非身份认证。
import { useMemo, useState, useSyncExternalStore } from 'react';
import styles from './preview.module.css';
import { PreviewStateProvider, usePreview, type DomainKey, type RoleKey } from './preview-state';
import OverviewMobile from './overview-mobile';
import OverviewLandscape from './overview-landscape';
import DetailWorkspace from './detail-workspace';

type LayoutMode = 'auto' | 'mobile' | 'landscape';
type View = { screen: 'overview' } | { screen: 'detail'; domain: DomainKey | 'business' };

function viewToQuery(view: View): string {
  return view.screen === 'overview' ? 'view=overview' : `view=detail&domain=${view.domain}`;
}

function queryToView(search: string): View {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'detail') {
    const domain = params.get('domain');
    if (domain === 'business' || domain === 'policy' || domain === 'credit' || domain === 'commerce' || domain === 'asset') {
      return { screen: 'detail', domain };
    }
  }
  return { screen: 'overview' };
}

/** 视图外部源 = location.search。pushState 不触发 popstate，导航后需手动通知订阅者。 */
const viewListeners = new Set<() => void>();

function subscribeView(onChange: () => void): () => void {
  const pop = () => onChange();
  window.addEventListener('popstate', pop);
  viewListeners.add(onChange);
  return () => {
    window.removeEventListener('popstate', pop);
    viewListeners.delete(onChange);
  };
}

function navigate(next: View) {
  window.history.pushState(null, '', `/v5-preview?${viewToQuery(next)}`);
  for (const notify of viewListeners) notify();
}

const LANDSCAPE_QUERY = '(min-width: 900px)';

function subscribeLandscape(onChange: () => void): () => void {
  const mq = window.matchMedia(LANDSCAPE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const ROLE_OPTIONS: RoleKey[] = ['business', 'policy', 'credit', 'commerce', 'asset'];
const ROLE_OPTION_LABELS: Record<RoleKey, string> = {
  business: '业务（协调）', policy: '政策', credit: '信审', commerce: '商务', asset: '资产',
};

function PreviewInner() {
  const { state, dispatch } = usePreview();
  const [mode, setMode] = useState<LayoutMode>('auto');

  const search = useSyncExternalStore(
    subscribeView,
    () => window.location.search,
    () => '',
  );
  const view = useMemo(() => queryToView(search), [search]);

  const mediaLandscape = useSyncExternalStore(
    subscribeLandscape,
    () => window.matchMedia(LANDSCAPE_QUERY).matches,
    () => true,
  );

  const effectiveLayout: 'mobile' | 'landscape' = mode === 'auto' ? (mediaLandscape ? 'landscape' : 'mobile') : mode;
  const forcedClass = mode === 'auto' ? '' : mode === 'mobile' ? styles.forceMobile : styles.forceLandscape;

  return (
    <div className={`${styles.previewRoot} ${forcedClass}`}>
      <div className={styles.previewBar} role="toolbar" aria-label="预览控制">
        <b className={styles.previewBadge}>交互预览 · 合成数据</b>
        <span className={styles.previewBarNote}>不产生正式 Decision/Receipt；正式审批禁用</span>
        <label className={styles.barField}>
          视角（非认证）
          <select value={state.role} onChange={(e) => dispatch({ type: 'set-role', role: e.target.value as RoleKey })}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{ROLE_OPTION_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label className={styles.barField}>
          布局
          <select value={mode} onChange={(e) => setMode(e.target.value as LayoutMode)}>
            <option value="auto">自动（按窗口宽度）</option>
            <option value="mobile">手机 390×844</option>
            <option value="landscape">横屏/桌面</option>
          </select>
        </label>
        <button type="button" className={styles.ghostBtn} onClick={() => { dispatch({ type: 'reset' }); navigate({ screen: 'overview' }); }}>
          重置演示
        </button>
      </div>

      {view.screen === 'overview' ? (
        effectiveLayout === 'mobile' ? (
          <OverviewMobile
            onOpenDomain={(d) => navigate({ screen: 'detail', domain: d })}
            onOpenBusiness={() => navigate({ screen: 'detail', domain: 'business' })}
          />
        ) : (
          <OverviewLandscape
            onOpenDomain={(d) => navigate({ screen: 'detail', domain: d })}
            onOpenBusiness={() => navigate({ screen: 'detail', domain: 'business' })}
          />
        )
      ) : (
        <DetailWorkspace
          domain={view.domain}
          chatDefaultOpen={effectiveLayout === 'landscape'}
          onBack={() => navigate({ screen: 'overview' })}
        />
      )}
    </div>
  );
}

export default function V5PreviewPage() {
  return (
    <PreviewStateProvider>
      <PreviewInner />
    </PreviewStateProvider>
  );
}
