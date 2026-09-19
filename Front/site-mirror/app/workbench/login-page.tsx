// goal-03c 受控登录页（路径一）：受控身份目录选择（明确标"训练/演示"）+ 手输凭据（真实身份）。
// 无角色下拉、无提权输入：角色由服务端目录裁决并在登录后只读展示。
import { useState } from 'react';
import { errorText } from '../../lib/workbench/wb-logic';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { WbError } from './wb-parts';

export function LoginPage({ wb, onLoggedIn }: { wb: WbApi; onLoggedIn: () => void }) {
  const [credential, setCredential] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [redeemNote, setRedeemNote] = useState<string | null>(null);
  const identities = wb.identities;

  const pick = async (principalId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await wb.loginWithIdentity(principalId);
      onLoggedIn();
    } catch {
      setErr(wb.error ?? '受控登录失败');
    } finally {
      setBusy(false);
    }
  };

  const manual = async () => {
    if (!credential.trim()) { setErr('请输入凭据'); return; }
    setBusy(true);
    setErr(null);
    try {
      await wb.loginWithCredential(credential.trim());
      setCredential('');
      onLoggedIn();
    } catch {
      setErr(wb.error ?? '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    const code = inviteCode.trim();
    if (!code) { setErr('请输入邀请码'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await wb.redeemCode(code);
      if (r.replayed === true) {
        setRedeemNote(r.note ?? '该邀请已兑换过：凭据已随首次响应发出，请使用已保存的凭据登录。');
        return;
      }
      if (!r.credential || !r.customerId) throw new Error('兑换响应缺少凭据/客户标识');
      setInviteCode('');
      setRedeemNote(null);
      await wb.loginWithCredential(r.credential);
      wb.enterCustomerPortal(r.customerId);
      onLoggedIn();
    } catch (e) {
      setErr(errorText((e as { code?: string }).code, (e as Error).message || '兑换失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wb-root">
      <header className="wb-top">
        <h1>JW 客户授信工作本</h1>
        <span className="wb-spacer" />
        <span className="wb-sub">真实办理 · 凭据仅用于服务端换取会话，不落浏览器存储</span>
      </header>
      <WbError error={err ?? wb.error} onDismiss={() => { setErr(null); wb.setError(null); }} />
      <div className="wb-login">
        <div className="wb-panel">
          <h3 className="wb-h2">受控身份选择（演示环境部署目录）</h3>
          {identities === null && <p className="wb-note">受控身份目录未配置：请使用下方凭据登录。</p>}
          {identities !== null && identities.length === 0 && <p className="wb-note">目录为空：请使用凭据登录。</p>}
          {identities !== null && identities.map((it) => (
            <div key={it.principalId} className="wb-card">
              <div className="wb-row">
                <strong>{it.label}</strong>
                {it.demo && <span className="wb-badge demo">训练/演示身份</span>}
              </div>
              <div className="wb-sub">角色：{it.roles.join('/') || '—'}（服务端裁决，只读展示）</div>
              <div className="wb-actions">
                <button className="wb-btn" disabled={busy} onClick={() => void pick(it.principalId)}>以此身份登录</button>
              </div>
            </div>
          ))}
        </div>
        <div className="wb-panel" style={{ marginTop: 12 }}>
          <h3 className="wb-h2">凭据登录（真实身份）</h3>
          <div className="wb-field"><label>凭据（X-Principal-Credential 目录令牌）</label>
            <input className="wb-input" type="password" value={credential} onChange={(e) => setCredential(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void manual(); }} placeholder="部署方发放；不提供任何角色自选/提权" />
          </div>
          <button className="wb-btn" disabled={busy} onClick={() => void manual()}>登录</button>
          <h3 className="wb-h2" style={{ marginTop: 12 }}>邀请码兑换（受邀客户人员）</h3>
          {redeemNote && <p className="wb-note warn">{redeemNote}</p>}
          <div className="wb-row">
            <input className="wb-input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void redeem(); }}
              placeholder="粘贴办理人提供的邀请码" aria-label="邀请码" />
            <button className="wb-btn ghost" disabled={busy} onClick={() => void redeem()}>兑换并进入</button>
          </div>
          <p className="wb-note">兑换后即以受限客户身份进入本客户材料门户；只能查看获准披露内容、在授权范围内上传。已兑换/已撤销/过期的邀请码会被明确拒绝。</p>
          <p className="wb-note">正式权威属于人；本页面不提供角色下拉提权，越权操作由后台逐请求拒绝。</p>
        </div>
      </div>
    </div>
  );
}
