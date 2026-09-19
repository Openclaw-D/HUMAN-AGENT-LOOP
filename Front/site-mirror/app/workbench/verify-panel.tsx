// goal-03d 核验面板（路径三）：质量问题（findings）登记与有理由复核关闭、检查会话核验项
// （items verify——名册角色由服务端裁决）、对象锚定清单、处理通道人工路线（扫描件人工录入=转录、
// 事实更正修订链、获准复核 verified 唯一来源——IR-02-C）。普通核验操作与正式决定权限分离：
// 本面板不含任何批准/激活动作。
import { useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { DEMO_TENANT, errorText, wbActionRequestId } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

export function VerifyPanel({ wb, customerId }: { wb: WbApi; customerId: string }) {
  const client = wb.client;
  const snap = wb.snapshot;
  const findings = snap?.findings ?? [];
  const objects = snap?.objectInventory ?? [];
  const session = snap?.session ?? null;
  const [newFinding, setNewFinding] = useState('');
  const [severity, setSeverity] = useState('major');
  const act = useAction();
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  // 通道人工路线表单（evidenceId/factId 来自材料页通道回执与问题明细，均为业务可见 ID）
  const [meEvidence, setMeEvidence] = useState('');
  const [meKey, setMeKey] = useState('');
  const [meLocation, setMeLocation] = useState('');
  const [meReason, setMeReason] = useState('');
  const [cfFactId, setCfFactId] = useState('');
  const [cfValue, setCfValue] = useState('');
  const [cfReason, setCfReason] = useState('');

  if (!client) return null;

  const manualEntry = () => {
    // 支持多行批量转录：每行 `factKey,value[,unit]`；单行亦兼容。
    const lines = meKey.split('\n').map((l) => l.trim()).filter(Boolean);
    const facts = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        factKey: parts[0],
        value: parts[1] ?? '',
        ...(parts[2] ? { unit: parts[2] } : {}),
        ...(meLocation.trim() ? { location: meLocation.trim() } : {}),
      };
    }).filter((f) => f.factKey && f.value !== '');
    if (!meEvidence.trim() || facts.length === 0 || !meReason.trim()) { setVerifyErr('人工录入需：通道材料 ID、至少一行「事实键,取值」,录入理由（录入=转录，≠核验）。'); return; }
    const requestId = wbActionRequestId('wb-me', customerId, `me:${Date.now()}`, String(Date.now()));
    act.open(
      {
        title: '人工录入事实（转录）',
        lines: [
          `通道材料：${meEvidence.trim().slice(0, 24)}…`,
          `事实 ${facts.length} 项：${facts.map((f) => f.factKey).join('、').slice(0, 80)}`,
          meLocation.trim() ? `原件定位：${meLocation.trim()}` : '原件定位：未填（建议填写行号/页码）',
          '录入=转录（source_supported+人工标记），核验须走获准复核。',
        ],
        confirmLabel: '录入',
      },
      async () => {
        await client.channelAction('evidence/manual-entry', {
          requestId, tenantId: DEMO_TENANT, customerId,
          evidenceId: meEvidence.trim(),
          facts,
          enteredBy: wb.session?.principalId ?? 'unknown',
          reason: meReason.trim(),
        });
        setMeReason('');
      },
    );
  };

  const correctFact = () => {
    if (!cfFactId.trim() || !cfValue.trim() || !cfReason.trim()) { setVerifyErr('更正需：事实 ID、新取值、更正理由（修订链留痕，历史不改写）。'); return; }
    const requestId = wbActionRequestId('wb-cf', customerId, `cf:${cfFactId}`, String(Date.now()));
    act.open(
      {
        title: '更正事实（修订链）',
        lines: [`事实：${cfFactId.trim().slice(0, 24)}… → 新值 ${cfValue.trim()}`, `理由：${cfReason.trim()}`, '更正≠核验完成；原事实保留不改写。'],
        confirmLabel: '更正',
      },
      async () => {
        await client.channelAction('evidence/correct-fact', {
          requestId, tenantId: DEMO_TENANT, correctsFactId: cfFactId.trim(),
          fact: { value: cfValue.trim() }, reason: cfReason.trim(), correctedBy: wb.session?.principalId ?? 'unknown',
        });
        setCfValue('');
        setCfReason('');
      },
    );
  };

  const registerFinding = () => {
    if (!newFinding.trim()) return;
    act.open(
      {
        title: '登记质量问题（差异）',
        lines: [`描述：${newFinding.trim()}`, `严重度：${severity}`, '登记后进入复核队列；未决差异会阻断后续正式动作（服务端强制）。'],
        confirmLabel: '登记',
      },
      async () => {
        await client.action(`/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/findings`, {
          requestId: `wb-fnd-${customerId}-${Date.now()}`.slice(0, 128),
          tenantId: DEMO_TENANT,
          findingType: 'quality_issue',
          severity,
          summary: newFinding.trim(),
        });
        setNewFinding('');
        await wb.refresh();
      },
    );
  };

  const resolveFinding = (fid: string) => {
    const reason = window.prompt('关闭理由（必填，写入后台审计）：');
    if (!reason || !reason.trim()) return;
    const evidenceRef = window.prompt('引用现行证据工件 artifactId（关闭关键复核必须引用现行证据）：');
    act.open(
      { title: `关闭复核 ${fid}`, lines: [`理由：${reason.trim()}`, evidenceRef ? `引用证据：${evidenceRef.trim()}` : '引用证据：无（仅限非关键差异）'], confirmLabel: '确认关闭' },
      async () => {
        await client.action(`/api/jw/v2/actions/findings/${encodeURIComponent(fid)}/resolve`, {
          requestId: `wb-rsl-${fid}-${Date.now()}`.slice(0, 128),
          tenantId: DEMO_TENANT,
          outcome: 'resolved',
          note: reason.trim(),
          ...(evidenceRef && evidenceRef.trim() ? { evidenceRefs: [evidenceRef.trim()] } : {}),
        });
        await wb.refresh();
      },
    );
  };

  const verifyItem = (itemId: string) => {
    if (!session?.sessionId) return;
    setVerifyErr(null);
    client.action(`/api/jw/v2/actions/inspections/${encodeURIComponent(session.sessionId)}/items/${encodeURIComponent(itemId)}/verify`, {
      requestId: `wb-vfy-${itemId}-${Date.now()}`.slice(0, 128),
    }).then(() => wb.refresh()).catch((e) => setVerifyErr(errorText((e as { code?: string }).code, '核验未成功（角色或状态由服务端裁决）')));
  };

  const items = (session?.items ?? []) as Array<Record<string, unknown>>;

  return (
    <div>
      <h3 className="wb-h2">质量问题与复核队列（服务端 findings）</h3>
      {findings.length === 0 && <p className="wb-note">无未关闭差异。</p>}
      {findings.map((f) => (
        <div key={String(f.findingId)} className={`wb-card ${f.status === 'open' ? 'bad' : 'good'}`}>
          <div className="wb-row">
            <strong>{String(f.findingType ?? 'quality_issue')}</strong>
            <span className={`wb-badge ${f.status === 'open' ? 'off' : 'live'}`}>{f.status === 'open' ? '未决' : '已处理'}</span>
            <span className="wb-sub">严重度：{String(f.severity ?? '—')}</span>
          </div>
          <div>{String(f.summary ?? '')}</div>
          {f.status === 'open' && (
            <div className="wb-actions"><button className="wb-btn small ghost" onClick={() => resolveFinding(String(f.findingId))}>有理由关闭…</button></div>
          )}
        </div>
      ))}
      <div className="wb-card dim">
        <h3 className="wb-h2">登记新质量差异</h3>
        <div className="wb-field"><label>描述</label>
          <textarea className="wb-textarea" rows={2} value={newFinding} onChange={(e) => setNewFinding(e.target.value)} placeholder="与材料/事实矛盾的具体描述" />
        </div>
        <div className="wb-row">
          <div className="wb-field" style={{ width: 140 }}><label>严重度</label>
            <select className="wb-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="critical">关键</option><option value="major">重要</option><option value="minor">一般</option>
            </select>
          </div>
          <button className="wb-btn" onClick={registerFinding}>登记</button>
        </div>
        {act.node}
      </div>

      <h3 className="wb-h2" style={{ marginTop: 14 }}>检查会话核验项（人工核验权在名册角色）</h3>
      {!session && <p className="wb-note">当前窗口内无检查会话：核验项随检查会话创建（问题·补证页可发起）。</p>}
      {session && items.length === 0 && <p className="wb-note">会话尚无核验项。</p>}
      <WbError error={verifyErr} onDismiss={() => setVerifyErr(null)} />
      {items.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>事项</th><th>负责角色</th><th>状态</th><th>需真人</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((it) => {
              const itemId = String(it.itemId ?? it.item_id ?? '');
              const status = String(it.status ?? '');
              return (
                <tr key={itemId}>
                  <td>{String(it.title ?? it.purpose ?? itemId)}</td>
                  <td>{String(it.responsibleRole ?? it.responsible_role ?? '—')}</td>
                  <td>{status === 'verified' ? '已核实' : status === 'to_verify' ? '待人工核实' : status}</td>
                  <td>{it.requiresHumanVerification || it.requires_human_verification ? '是' : '否'}</td>
                  <td>{status === 'to_verify' && <button className="wb-btn small" onClick={() => verifyItem(itemId)}>人工核实</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="wb-h2" style={{ marginTop: 14 }}>处理通道人工路线（扫描件/更正/获准复核 · IR-02-C）</h3>
      <div className="wb-card dim">
        <p className="wb-note">材料 ID（evidenceId）与事实 ID（factId）来自材料页「处理通道」任务回执与问题明细；均为业务可见编号，不需开发者工具。</p>
        <div className="wb-row">
          <div className="wb-field" style={{ width: 200 }}><label>通道材料 ID（evidenceId）</label>
            <input className="wb-input" value={meEvidence} onChange={(e) => setMeEvidence(e.target.value)} placeholder="如 up-xxx" />
          </div>
          <div className="wb-field" style={{ flex: 1 }}><label>事实（每行：事实键,取值[,单位]）</label>
            <textarea className="wb-textarea" rows={3} value={meKey} onChange={(e) => setMeKey(e.target.value)} placeholder={"monthly_operating_cash_flow,437500\nentity_identity_verified,true"} />
          </div>
        </div>
        <div className="wb-row">
          <div className="wb-field" style={{ width: 150 }}><label>原件定位（行/页）</label>
            <input className="wb-input" value={meLocation} onChange={(e) => setMeLocation(e.target.value)} placeholder="如 第3页 第12行" />
          </div>
          <input className="wb-input" style={{ flex: 1 }} value={meReason} onChange={(e) => setMeReason(e.target.value)} placeholder="录入理由（必填，写入留痕）" />
          <button className="wb-btn" onClick={manualEntry}>人工录入（转录）</button>
        </div>
        <div className="wb-row" style={{ marginTop: 6 }}>
          <div className="wb-field" style={{ width: 200 }}><label>被更正事实 ID（factId）</label>
            <input className="wb-input" value={cfFactId} onChange={(e) => setCfFactId(e.target.value)} placeholder="如 fact-xxx" />
          </div>
          <div className="wb-field" style={{ width: 150 }}><label>新取值</label>
            <input className="wb-input" value={cfValue} onChange={(e) => setCfValue(e.target.value)} />
          </div>
          <input className="wb-input" style={{ flex: 1 }} value={cfReason} onChange={(e) => setCfReason(e.target.value)} placeholder="更正理由（必填，修订链留痕）" />
          <button className="wb-btn ghost" onClick={correctFact}>更正事实</button>
        </div>
        <p className="wb-note">获准复核（verified）：在问题·补证页对通道问题的「人工复核」按钮完成——verified 只能由该获准端点产生。</p>
      </div>

      <h3 className="wb-h2" style={{ marginTop: 14 }}>对象锚定清单（设备对象 · 二维保真）</h3>
      {objects.length === 0 && <p className="wb-note">无对象绑定记录。</p>}
      {objects.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>对象</th><th>类型</th><th>场景版本</th><th>锚定状态</th></tr></thead>
          <tbody>
            {objects.map((o, i) => (
              <tr key={String(o.objectId ?? i)}>
                <td>{String(o.objectId ?? '—')}</td>
                <td>{String(o.objectType ?? '—')}</td>
                <td>{String(o.sceneVersion ?? '—')}</td>
                <td>{String(o.linkState ?? '—')}{o.customerSuperseded ? '（客户侧已取代）' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="wb-note">三维场区与视频未接入（D27-S BLOCKED）：本页为二维保真显示，不以随机工厂冒充真实证据。</p>
    </div>
  );
}
