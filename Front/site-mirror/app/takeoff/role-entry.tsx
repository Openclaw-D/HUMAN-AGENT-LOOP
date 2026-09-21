import { useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { RoleLogo, UiIcon } from './ui-icons';

export const WORK_ROLES = [
  { id: 'business', name: '业务', description: '精准识客高效成单' },
  { id: 'policy', name: '政策', description: '厘清准入守住边界' },
  { id: 'credit', name: '信审', description: '识别风险审慎决策' },
  { id: 'commerce', name: '商务', description: '优化方案促成合作' },
  { id: 'asset', name: '资产', description: '核清资产守护价值' },
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
    catch (e) { const code=(e as {code?:string}).code; setError(code === 'PRINCIPAL_UNTRUSTED' ? '办理服务或角色配置尚未就绪，请联系工作台维护人员。' : '暂时连接不上工作台，请稍后重试。'); }
    finally { setBusy(null); }
  };
  return <main className="tk-root tk-entry">
    <header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong><span>客户协作工作台</span></header>
    <section className="tk-role-content">
      <h1>选择你的角色</h1>
      <div className="tk-role-grid">
        {WORK_ROLES.map((role) => {
          const matches = (wb.identities ?? []).filter((p) => p.roles.includes(role.id) && !p.roles.includes('service') && !p.roles.includes('admin'));
          return <div className="tk-role-slot" key={role.id}>
            <button className="tk-role-card" aria-label={`${role.name}：${role.description}${matches.length ? '' : '，暂未开放'}`} disabled={busy !== null || matches.length === 0}
              onClick={() => matches.length === 1 ? void enter(matches[0].principalId) : setChoosing(role.id)}>
              <RoleLogo role={role.id} size={144}/>
              <span className="tk-role-value">{role.description}</span>
              {busy && matches.some((m) => m.principalId === busy) && <small>正在进入…</small>}
            </button>
            {choosing === role.id && matches.length > 1 && <div className="tk-role-people" aria-label="选择工作身份">{matches.map((m) => <button className="tk-btn" key={m.principalId} onClick={() => void enter(m.principalId)} disabled={busy !== null}>{m.label}</button>)}</div>}
          </div>;
        })}
      </div>
      {error && <p role="alert">{error}</p>}
      {wb.identities === null && <p className="tk-entry-hint">正在连接工作台；若长时间未显示，请检查服务后刷新。<button className="tk-btn small ghost" onClick={() => window.location.reload()}>刷新</button></p>}
    </section>
  </main>;
}
