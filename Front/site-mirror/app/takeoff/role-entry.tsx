import { useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';

export const WORK_ROLES = [
  { id: 'business', name: '业务', mark: '↗', description: '了解客户，推进办理' },
  { id: 'policy', name: '政策', mark: '≡', description: '核对准入，明确边界' },
  { id: 'credit', name: '信审', mark: '◎', description: '判断风险，确认结论' },
  { id: 'commerce', name: '商务', mark: '⇄', description: '组合方案，协商条件' },
  { id: 'asset', name: '资产', mark: '◇', description: '核验设备、权属与价值' },
];
export function workRoleName(roles: string[] = []) {
  return WORK_ROLES.find((r) => roles.includes(r.id))?.name ?? (roles.includes('customer') ? '客户' : '协作');
}
export function RoleEntry({ wb }: { wb: WbApi }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const enter = async (id: string) => {
    setBusy(id); setError('');
    try { await wb.loginWithIdentity(id); }
    catch { setError('暂时无法进入，请稍后重试。'); }
    finally { setBusy(null); }
  };
  return <main className="tk-root tk-entry">
    <header className="tk-entry-brand"><strong>见微</strong><span>首次回租 · 准入预评估</span></header>
    <section className="tk-role-content">
      <span className="tk-eyebrow">开始协作</span>
      <h1>今天，你从哪个角色开始？</h1>
      <p>选择角色，进入你的客户工作台。</p>
      <div className="tk-role-grid">
        {WORK_ROLES.map((role) => {
          const matches = (wb.identities ?? []).filter((p) => p.roles.includes(role.id) && !p.roles.includes('service') && !p.roles.includes('admin'));
          return <div className="tk-role-slot" key={role.id}>
            <button className="tk-role-card" disabled={busy !== null || matches.length === 0}
              onClick={() => matches.length === 1 ? void enter(matches[0].principalId) : setChoosing(role.id)}>
              <span className="tk-role-symbol" aria-hidden="true">{role.mark}</span>
              <strong>{role.name}</strong><span>{role.description}</span>
              <small>{busy && matches.some((m) => m.principalId === busy) ? '正在进入…' : matches.length ? '进入工作台 ↗' : wb.identities === null ? '连接中…' : '暂未开放'}</small>
            </button>
            {choosing === role.id && matches.length > 1 && <div className="tk-role-people" aria-label="选择工作身份">{matches.map((m) => <button className="tk-btn" key={m.principalId} onClick={() => void enter(m.principalId)} disabled={busy !== null}>{m.label}</button>)}</div>}
          </div>;
        })}
      </div>
      {error && <p role="alert">{error}</p>}
      {wb.identities === null && <p className="tk-entry-hint">正在连接工作台；若长时间未显示，请检查服务后刷新。<button className="tk-btn small ghost" onClick={() => window.location.reload()}>刷新</button></p>}
    </section>
    <footer className="tk-entry-footer">同一份客户材料，让每一位专业伙伴接着往下做。</footer>
  </main>;
}
