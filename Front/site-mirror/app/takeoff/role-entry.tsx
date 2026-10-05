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
  if (WORK_ROLES.every(r => roles.includes(r.id))) return '协作评审';
  return WORK_ROLES.find((r) => roles.includes(r.id))?.name ?? (roles.includes('customer') ? '客户' : '协作');
}
/** 多身份选择展示：服务端中文职责名直接用；纯内部代号（biz1/adv1 等）不外显，改用角色+序号。 */
function identityDisplayName(label: string | undefined, principalId: string, roleName: string, index: number): string {
  const clean = (label ?? '').trim();
  if (clean && clean !== principalId && /[\u4e00-\u9fff]/.test(clean)) return clean;
  return `${roleName}身份 ${index + 1}`;
}

/** 登录失败分类（连接提示修复 · 2026-09-30-final）：区分数据库/上游不可用、角色配置、权限与网络问题，给出恢复路径。 */
export function describeLoginFailure(e: unknown): string {
  const err = e as { status?: number; code?: string; message?: string };
  const code = err?.code ?? '';
  if (code === 'PRINCIPAL_UNTRUSTED') return '该角色尚未在服务端身份目录登记（角色配置未就绪）：请联系工作台维护人员补齐配置。';
  if (code === 'CREDENTIAL_VERIFICATION_UNAVAILABLE' || (err?.status === 503 && /verif|upstream|db|database/i.test(`${code} ${err?.message ?? ''}`)))
    return '后台身份核验服务暂不可用（通常是数据库或上游服务未启动）：请启动服务后重试；恢复后无需改配置，直接重新选择角色即可。';
  if (err?.status === 503 || err?.status === 502 || err?.status === 504) return `工作台上游暂不可用（${code || err?.status}）：请确认数据库与办理服务已启动，再重试。`;
  if (err?.status === 401 || err?.status === 403) return '当前身份未通过服务端校验（权限或凭据问题）：请换角色重试或联系维护人员。';
  if (err?.status === 404) return '工作台登录接口不存在（服务版本不匹配）：请联系维护人员核对部署。';
  if (!err?.status) return '连接不上工作台服务（网络不可达）：请确认服务已启动、地址正确后重试。';
  return `登录未成功（${code || err?.status}）：请稍后重试；持续失败请联系维护人员。`;
}

export function RoleEntry({ wb }: { wb: WbApi }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const coordinators = (wb.identities ?? []).filter(p => WORK_ROLES.every(r => p.roles.includes(r.id)) && !p.roles.includes('admin') && !p.roles.includes('service'));
  const enter = async (id: string) => {
    setBusy(id); setError('');
    try { await wb.loginWithIdentity(id); }
    catch (e) { setError(describeLoginFailure(e)); }
    finally { setBusy(null); }
  };
  return <main className="tk-root tk-entry">
    <header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong><span>客户协作工作台</span></header>
    <section className="tk-role-content">
      <h1>选择你的角色</h1>
      <div className="tk-role-grid">
        {WORK_ROLES.map((role) => {
          const matches = (wb.identities ?? []).filter((p) => p.roles.includes(role.id) && !p.roles.includes('service') && !p.roles.includes('admin'));
          // 隐藏多余工程身份选择：该角色下有且仅有一个"只含本角色"的身份时直接进入
          // （跨专业协调身份如 adv1 不挡在业务入口前；服务端权限不变）。
          const exact = matches.filter((m) => m.roles.length === 1 && m.roles[0] === role.id);
          const auto = exact.length === 1 ? exact[0] : null;
          return <div className="tk-role-slot" key={role.id}>
            <button className="tk-role-card" aria-label={`${role.name}：${role.description}${matches.length ? '' : '，暂未开放'}`} disabled={busy !== null || matches.length === 0}
              onClick={() => auto ? void enter(auto.principalId) : matches.length === 1 ? void enter(matches[0].principalId) : setChoosing(role.id)}>
              <RoleLogo role={role.id} size={144}/>
              <strong className="tk-role-title">{role.name}</strong>
              <span className="tk-role-value">{role.description}</span>
              {busy && matches.some((m) => m.principalId === busy) && <small>正在进入…</small>}
            </button>
            {choosing === role.id && matches.length > 1 && <div className="tk-role-people" aria-label="选择工作身份">{matches.map((m, i) => <button className="tk-btn" key={m.principalId} title={`进入${role.name}办理`} onClick={() => void enter(m.principalId)} disabled={busy !== null}>{identityDisplayName(m.label, m.principalId, role.name, i)}</button>)}</div>}
          </div>;
        })}
      </div>
      {coordinators.length > 0 && <div className="tk-coordinator-entry">{coordinators.map(p => <button className="tk-btn" key={p.principalId} disabled={busy !== null} onClick={() => void enter(p.principalId)}>协作评审 · 查看五区进度{busy===p.principalId?'（正在进入）':''}</button>)}<p>由已授权的跨专业身份查看当前客户的完整办理记录。</p></div>}
      {error && <p role="alert">{error}</p>}
      {wb.identities === null && <p className="tk-entry-hint">正在连接工作台；若长时间未显示，请检查服务后刷新。<button className="tk-btn small ghost" onClick={() => window.location.reload()}>刷新</button></p>}
    </section>
  </main>;
}
