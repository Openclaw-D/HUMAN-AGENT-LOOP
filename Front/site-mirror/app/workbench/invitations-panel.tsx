// goal-03d 受限邀请面板（路径二 · 业务侧）：创建（角色×材料白名单×有效期）→ code 明文仅一次；
// 清单/撤销；页面化撤权（IR-03-7：admin 撤客户 grants 级联停用兑换身份，即刻生效）；
// 过期/撤销由兑换口拒绝（A G2）。仅内部身份可见本页（客户身份走客户视图）。
import { useCallback, useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { InvitationRow } from '../../lib/workbench/wb-client';
import { buildConfirmPlan, DEMO_TENANT, errorText, fmtWhen, wbActionRequestId } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

const ROLES = [
  { v: 'customer-owner', t: '客户·实控人' },
  { v: 'customer-finance', t: '客户·财务' },
  { v: 'customer-plant', t: '客户·厂长' },
];
const KIND_OPTIONS = [
  { v: 'invoice', t: '发票' },
  { v: 'purchase_contract', t: '购销合同' },
  { v: 'equipment_list', t: '设备清单' },
  { v: 'bank_statement', t: '银行流水' },
  { v: 'financial_statement', t: '财务报表' },
];

export function InvitationsPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const [role, setRole] = useState('customer-owner');
  const [kinds, setKinds] = useState<string[]>(['invoice', 'purchase_contract']);
  const [hours, setHours] = useState('168');
  const [note, setNote] = useState('');
  const [list, setList] = useState<InvitationRow[] | null>(null);
  const [onceCode, setOnceCode] = useState<{ code: string; role: string; invitationId: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const act = useAction();

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.listInvitations(customerId);
      setList((j.invitations ?? []) as InvitationRow[]);
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '邀请清单读取失败'));
    }
  }, [client, customerId]);

  useEffect(() => { void load(); }, [load]);

  if (!client) return null;

  const create = () => {
    if (kinds.length === 0) { setLoadErr('至少选择一种允许上传的材料种类'); return; }
    act.open(
      {
        title: '创建受限邀请',
        lines: [
          `受邀角色：${ROLES.find((r) => r.v === role)?.t ?? role}`,
          `允许上传种类：${kinds.join('、')}`,
          `有效期：${hours} 小时（默认 168，上限 720）`,
          note ? `备注：${note}` : '备注：无',
          '邀请码明文只显示一次，请当场复制并通过页面内消息/线下方式交给受邀人。',
        ],
        confirmLabel: '创建邀请',
      },
      async () => {
        const r = await client.createInvitation(customerId, {
          requestId: `wb-inv-${customerId}-${Date.now()}`.slice(0, 128),
          role,
          allowedKinds: kinds,
          expiresInHours: Number(hours) || undefined,
          note: note || undefined,
        });
        setNote('');
        if (r.invitation) setOnceCode({ code: r.invitation.code, role: r.invitation.role, invitationId: r.invitation.invitationId });
        await load();
      },
    );
  };

  const revoke = (inv: InvitationRow) => {
    act.open(
      { title: '撤销邀请', lines: [`对象：${inv.invitationId}`, '撤销即刻生效：未兑换的邀请码立即失效。'], confirmLabel: '确认撤销' },
      async () => {
        await client.revokeInvitation(inv.invitationId, `wb-rvk-${inv.invitationId}-${Date.now()}`.slice(0, 128));
        await load();
      },
    );
  };

  // IR-03-7 页面化撤权：admin 撤该兑换身份的客户 grants（级联停用 customer_identities，重放同样 403）。
  const revokeGrant = (inv: InvitationRow) => {
    const pid = String(inv.usedPrincipalId ?? '');
    const requestId = wbActionRequestId('wb-grv', customerId, `grant:${pid}`, String(Date.now()));
    act.open(
      buildConfirmPlan('grant.revoke', `客户 ${customerId}`, [
        `兑换身份：${pid.slice(0, 22)}…（邀请 ${inv.invitationId.slice(0, 14)}…）`,
        '撤权即刻生效：该客户凭据立即不可认证，门户会话终止且回执重放不借缓存。'], requestId),
      async () => {
        await client.revokeGrant(customerId, pid, requestId);
        await load();
      },
    );
  };

  const isAdmin = (wb.session?.roles ?? []).includes('admin');
  const statusBadge = (s: string) => (s === 'active' ? 'live' : s === 'used' ? '' : 'off');
  const statusText = (s: string) => (s === 'active' ? '有效' : s === 'used' ? '已兑换' : s === 'revoked' ? '已撤销' : s);

  return (
    <div>
      <h3 className="wb-h2">受限邀请（受邀人仅能在授权范围内上传/查看获准披露内容）</h3>
      <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
      {list === null && <p className="wb-note">加载中…</p>}
      {list !== null && list.length === 0 && <p className="wb-note">尚无邀请。用下方表单创建第一条受限邀请。</p>}
      {list !== null && list.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>角色</th><th>允许种类</th><th>状态</th><th>创建/到期</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((inv) => (
              <tr key={inv.invitationId}>
                <td>{ROLES.find((r) => r.v === inv.role)?.t ?? inv.role}</td>
                <td className="wb-sub">{(inv.allowedKinds ?? []).join('、')}</td>
                <td><span className={`wb-badge ${statusBadge(inv.status)}`}>{statusText(inv.status)}</span></td>
                <td className="wb-sub">{fmtWhen(inv.createdAt)}<br />到期 {fmtWhen(inv.expiresAt)}</td>
                <td>
                  {inv.status === 'active' && <button className="wb-btn small danger" onClick={() => revoke(inv)}>撤销</button>}
                  {isAdmin && inv.status === 'used' && inv.usedPrincipalId && (
                    <button className="wb-btn small danger" onClick={() => revokeGrant(inv)} title="级联停用该兑换身份（即刻生效）">撤权客户身份</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="wb-card dim" style={{ marginTop: 10 }}>
        <h3 className="wb-h2">创建新邀请</h3>
        <div className="wb-row">
          <div className="wb-field" style={{ width: 170 }}><label>受邀角色</label>
            <select className="wb-select" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
            </select>
          </div>
          <div className="wb-field" style={{ width: 120 }}><label>有效期（小时）</label>
            <input className="wb-input" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="wb-field" style={{ flex: 1 }}><label>备注（可选）</label>
            <input className="wb-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 补充 7 月发票" />
          </div>
        </div>
        <div className="wb-field"><label>允许上传的材料种类（服务端强制）</label>
          <div className="wb-row">
            {KIND_OPTIONS.map((k) => (
              <label key={k.v} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={kinds.includes(k.v)} onChange={(e) => {
                  setKinds((prev) => (e.target.checked ? [...prev, k.v] : prev.filter((x) => x !== k.v)));
                }} /> {k.t}
              </label>
            ))}
          </div>
        </div>
        <button className="wb-btn" onClick={create}>创建邀请</button>
        {act.node}
      </div>

      {onceCode && (
        <div className="wb-dialog" role="dialog" aria-modal="true" aria-label="邀请码（仅显示一次）">
          <div className="box">
            <h3>邀请码已创建（仅显示这一次）</h3>
            <p className="wb-note">受邀角色：{ROLES.find((r) => r.v === onceCode.role)?.t ?? onceCode.role} · 编号 {onceCode.invitationId}</p>
            <pre className="wb-card" style={{ fontSize: 16, userSelect: 'all', textAlign: 'center' }}>{onceCode.code}</pre>
            <p className="wb-note warn">关闭后无法再次查看：请立即复制并交付受邀人；遗失则撤销后重发新邀请。</p>
            <button className="wb-btn" onClick={() => setOnceCode(null)}>我已复制并保存</button>
          </div>
        </div>
      )}
      <p className="wb-note">演示租户 {DEMO_TENANT}；兑换失败语义（已用 409/撤销与过期 410）由服务端保证并原样展示。</p>
    </div>
  );
}
