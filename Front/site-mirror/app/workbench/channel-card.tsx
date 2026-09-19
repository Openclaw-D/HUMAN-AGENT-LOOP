// goal-03d 处理通道卡（材料·原件页）：Connectors IR-02-C 消费面页面化——
// 通道邀请/绑定/上传（真实字节进常驻处理链）、分段进度、逐任务回执（阶段留痕+A 侧登记留痕）、
// 原件预览（短时签名 URL）。纪律：通道与 A 档案是两条真实链路，页面分列显示、不互相冒充；
// 上游状态/回执引用原样展示（Gate 回执/运行引用供方案页冻结依据包与域结果登记引用）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import {
  buildConfirmPlan, bytesToBase64, channelCursorSummary, channelOpRows, channelStageText, channelTaskRows,
  envelopeDataUrl, errorText, fmtWhen, MAX_ORIGINAL_BYTES, previewKind, sniffImageMime, wbActionRequestId,
  type ChannelOpRow, type ChannelTaskRow, type PreviewKind,
} from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

interface ChannelPreview {
  phase: 'ready';
  kind: PreviewKind;
  mime: string;
  size: number;
  dataUrl?: string;
  text?: string;
  bytes?: Uint8Array;
}

const CHANNEL_KINDS = [
  { v: 'bank_statement', t: '银行流水' },
  { v: 'purchase_contract', t: '购销合同' },
  { v: 'ledger_book', t: '账表' },
  { v: 'entity_register', t: '主体登记' },
  { v: 'device_photo', t: '设备照片' },
  { v: 'site_photo', t: '现场照片' },
  { v: 'invoice', t: '发票' },
  { v: 'document_sample', t: '其他文件' },
];

export function ChannelCard({ wb, customerId, onChanged }: { wb: WbApi; customerId: string; onChanged?: () => void }) {
  const client = wb.client;
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ taskId: string; stages: Array<Record<string, unknown>>; ops: ChannelOpRow[] } | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitationId, setInvitationId] = useState<string>('');
  const [tokenInput, setTokenInput] = useState('');
  const [inviteRole, setInviteRole] = useState('customer_owner');
  const [upKind, setUpKind] = useState('bank_statement');
  const [upPeriodFrom, setUpPeriodFrom] = useState('');
  const [upPeriodTo, setUpPeriodTo] = useState('');
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChannelPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.channelStatus(customerId);
      setStatus(j);
      setLoadErr(null);
    } catch (e) {
      setStatus(null);
      setLoadErr(errorText((e as { code?: string }).code, '处理通道读取失败（通道未接入或服务未启动——如实显示，不以档案状态冒充解析进度）'));
    }
  }, [client, customerId]);

  useEffect(() => { void load(); }, [load]);

  if (!client) return null;
  const tasks: ChannelTaskRow[] = status ? channelTaskRows((status.tasks ?? []) as Array<Record<string, unknown>>) : [];
  const paused = (status?.pause as { paused?: boolean } | null)?.paused === true;
  const rulesetVersion = status ? String((status as { rulesetVersion?: string }).rulesetVersion ?? '') : '';

  const openTask = async (taskId: string) => {
    try {
      const res = await client.channelTask(taskId);
      const j = ((res.task ?? res) as Record<string, unknown>);
      setDetail({ taskId, stages: (j.stages ?? []) as Array<Record<string, unknown>>, ops: channelOpRows((j.aOps ?? []) as Array<Record<string, unknown>>) });
    } catch (e) {
      setLoadErr(errorText((e as { code?: string }).code, '任务回执读取失败'));
    }
  };

  const issueInvite = () => {
    const requestId = wbActionRequestId('wb-chinv', customerId, 'invite', String(Date.now()));
    act.open(buildConfirmPlan('channel.invite', `客户 ${customerId}`, [
      `通道角色：${inviteRole}`, '用途：允许该客户人员把原件字节送进常驻解析链（通道内授权面，与 A 档案权限分立）。'], requestId),
      async () => {
        const r = await client.channelAction<{ invitationId?: string; token?: string }>('intake/invitations', {
          requestId, tenantId: 't1', customerId, role: inviteRole,
          allowedEvidenceKinds: CHANNEL_KINDS.map((k) => k.v), ttlSec: 3600 * 24,
        });
        setInviteToken(r.token ?? null);
        if (r.invitationId) setInvitationId(r.invitationId);
        await load();
      });
  };

  const acceptInvite = () => {
    if (!tokenInput.trim()) { setFileMsg('请粘贴通道令牌'); return; }
    const requestId = wbActionRequestId('wb-chacc', customerId, 'accept', String(Date.now()));
    act.open(buildConfirmPlan('channel.accept', `客户 ${customerId}`, ['以通道令牌建立上传绑定（一次有效）。'], requestId),
      async () => {
        // providerUserId 标识外部联系人本人（客户侧），不以操作者身份冒充；令牌本身即客户主张的凭据。
        // 每次接受=一次新的联系人会话（绑定幂等键含会话序），避免"既有绑定使后续邀请永远无法 accepted"。
        const r = await client.channelAction<{ invitationId?: string; bindingId?: string; existed?: boolean }>('intake/accept', {
          requestId, tenantId: 't1', token: tokenInput.trim(), provider: 'portal',
          providerUserId: `portal:${customerId}:${inviteRole}:${Date.now().toString(36)}`,
        });
        if (r.invitationId) setInvitationId(r.invitationId);
        setTokenInput('');
        setFileMsg(r.existed === true ? '该联系人绑定已存在（幂等接受，邀请状态不二次推进）——请用该联系人既有绑定上传。' : null);
        await load();
      });
  };

  const uploadToChannel = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setFileMsg('请先选择文件'); return; }
    if (!invitationId) { setFileMsg('尚无已接受的通道绑定：先发起并接受通道邀请'); return; }
    void f.arrayBuffer().then(async (buf) => {
      const bytes = new Uint8Array(buf);
      if (bytes.length === 0) { setFileMsg('文件内容为空'); return; }
      if (bytes.length > MAX_ORIGINAL_BYTES) { setFileMsg(`通道上传当前同样受限 ${Math.floor(MAX_ORIGINAL_BYTES / 1024)}KB（Edge 信封转发上限）`); return; }
      setFileMsg(null);
      const requestId = wbActionRequestId('wb-chup', customerId, `up:${f.name}`, String(Date.now()));
      act.open(buildConfirmPlan('channel.upload', `客户 ${customerId}`, [
        `文件：${f.name}（${bytes.length} 字节）`,
        `种类：${CHANNEL_KINDS.find((k) => k.v === upKind)?.t ?? upKind}`,
        upPeriodFrom ? `期间：${upPeriodFrom} ~ ${upPeriodTo || '?'}` : '期间：未填',
        '说明：字节进常驻处理链（解压→解析→事实→四域分析→A 结果登记）；传输完成≠解析完成。'], requestId),
        async () => {
          await client.channelAction('evidence/upload', {
            requestId, tenantId: 't1', customerId, invitationId, kind: upKind,
            contentBase64: bytesToBase64(bytes), contentType: f.type || 'application/octet-stream',
            periodFrom: upPeriodFrom || null, periodTo: upPeriodTo || null,
          });
          if (fileRef.current) fileRef.current.value = '';
          await load();
          onChanged?.();
        });
    });
  };

  const togglePause = () => {
    const requestId = wbActionRequestId('wb-chpause', customerId, 'pause', String(Date.now()));
    act.open(buildConfirmPlan('channel.pause', `客户 ${customerId}`, [paused ? '恢复处理调度（按服务代际推进）。' : '暂停后零新外发；在途任务按代际收束。'], requestId),
      async () => {
        await client.channelAction('processing/pause', { requestId, tenantId: 't1', customerId, paused: !paused });
        await load();
      });
  };

  // 原件预览（goal-03e 修复）：签名 URL 归一到 Edge 受控代理后，面内取回字节——image/text 内联
  // 渲染、其余提供下载；签名与有效期仍由 Connectors 验证。不弹外部窗、不伪造内容。
  const openPreview = async (evidenceId: string) => {
    setPreviewMsg(null);
    setPreview(null);
    try {
      const j = await client.channelPreview(evidenceId, customerId);
      let url = (j as { downloadUrl?: string }).downloadUrl;
      if (!url) { setPreviewMsg('预览未返回下载地址（如实显示）'); return; }
      if (url.startsWith('/')) url = `/api/jw/v2/connectors${url}`;
      const res = await client.fetchChannelObject(url);
      if (res.status !== 200) {
        setPreviewMsg(`预览未取得字节（HTTP ${res.status}，如实显示）`);
        return;
      }
      const imgMime = sniffImageMime(res.bytes);
      const mime = imgMime ?? res.contentType;
      const kind: PreviewKind = imgMime ? 'image' : previewKind(res.contentType, null);
      const base = { phase: 'ready' as const, kind, mime, size: res.bytes.length };
      if (kind === 'image') {
        setPreview({ ...base, dataUrl: envelopeDataUrl(mime, bytesToBase64(res.bytes)) });
      } else if (kind === 'text') {
        setPreview({ ...base, text: new TextDecoder().decode(res.bytes).slice(0, 20000) });
      } else {
        setPreview({ ...base, bytes: res.bytes });
      }
    } catch (e) {
      setPreviewMsg(errorText((e as { code?: string }).code, '预览失败'));
    }
  };

  const downloadPreview = () => {
    if (!preview?.bytes) return;
    const url = URL.createObjectURL(new Blob([preview.bytes as BlobPart], { type: preview.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'channel-original';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div className="wb-card dim" style={{ marginTop: 12 }}>
      <h3 className="wb-h2">处理通道（常驻解析链 · IR-02-C 消费面）</h3>
      <p className="wb-note">通道与 A 档案分列：档案登记=权威材料清单（上方表）；通道=字节解析/事实提取/四域分析与 A 侧结果登记。两者不互相冒充。</p>
      <div className="wb-actions">
        <button className="wb-btn small ghost" onClick={() => void load()}>刷新通道状态</button>
        <button className="wb-btn small ghost" onClick={togglePause}>{paused ? '恢复通道调度' : '暂停通道调度'}</button>
        {rulesetVersion && <span className="wb-sub">通道规则包：{rulesetVersion}</span>}
        {paused && <span className="wb-badge off">已暂停（零新外发）</span>}
      </div>
      <WbError error={loadErr} onDismiss={() => setLoadErr(null)} />
      {status && tasks.length === 0 && <p className="wb-note">通道内暂无该客户的处理任务。可经下方「发起通道邀请 → 接受绑定 → 上传」送入原件。</p>}
      {tasks.length > 0 && (
        <table className="wb-table">
          <thead><tr><th>任务</th><th>种类</th><th>状态</th><th>当前段</th><th>尝试</th><th>失败码</th><th>更新时间</th><th>回执</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.taskId}>
                <td title={t.taskId}>{t.taskId.slice(0, 18)}…</td>
                <td>{t.kind}</td>
                <td><span className={`wb-dot ${t.tone}`} aria-hidden="true" /> {t.statusText}</td>
                <td>{channelCursorSummary(t.cursor)}</td>
                <td>{t.attempts}</td>
                <td>{t.failureCode ?? '—'}</td>
                <td>{fmtWhen(t.updatedAt)}</td>
                <td><button className="wb-btn small ghost" onClick={() => void openTask(t.taskId)}>查看回执</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail && (
        <div className="wb-card" style={{ marginTop: 8 }}>
          <div className="wb-row"><strong>任务回执 {detail.taskId.slice(0, 18)}…</strong>
            <button className="wb-btn small ghost" onClick={() => setDetail(null)}>收起</button>
            <button className="wb-btn small ghost" onClick={() => void openPreview((tasks.find((t) => t.taskId === detail.taskId) ?? { evidenceId: '' }).evidenceId)}>原件预览（签名 URL）</button>
          </div>
          <WbError error={previewMsg} onDismiss={() => setPreviewMsg(null)} />
          {preview && preview.phase === 'ready' && (
            <div className="wb-card dim" aria-label="通道原件预览">
              <div className="wb-row wb-sub">
                <span>通道原件预览（签名 URL · Edge 受控代理）</span>
                <span>{preview.mime}</span>
                <span>{preview.size} 字节</span>
                <button className="wb-btn small ghost" onClick={() => setPreview(null)}>收起预览</button>
              </div>
              {preview.kind === 'image' && preview.dataUrl && (
                <img src={preview.dataUrl} alt="通道原件预览" style={{ maxWidth: '100%', maxHeight: 320, border: '1px solid #ddd' }} />
              )}
              {preview.kind === 'text' && preview.text != null && (
                <pre className="wb-note" style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{preview.text}</pre>
              )}
              {preview.kind === 'download' && (
                <div className="wb-row">
                  <button className="wb-btn small" onClick={downloadPreview}>下载原件（该类型不内联展示）</button>
                </div>
              )}
            </div>
          )}
          <h3 className="wb-h2">阶段留痕（传输完成≠解析完成）</h3>
          {detail.stages.length === 0 && <p className="wb-note">尚无阶段记录。</p>}
          {detail.stages.length > 0 && (
            <ul className="wb-note" style={{ paddingLeft: 18 }}>
              {detail.stages.map((s, i) => (
                <li key={i}>{channelStageText(String(s.stage ?? s))}：{String(s.status ?? '')}{s.detail ? `（${typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail).slice(0, 160)}）` : ''}</li>
              ))}
            </ul>
          )}
          <h3 className="wb-h2">A 侧登记留痕（同一原件可追溯：运行/Gate 回执/差异复核项）</h3>
          {detail.ops.length === 0 && <p className="wb-note">无 A 侧登记（未链接 A 客户或尚未推进到登记段——原因见阶段留痕）。</p>}
          {detail.ops.length > 0 && (
            <table className="wb-table">
              <thead><tr><th>类型</th><th>引用（a_ref）</th><th>状态</th><th>对账编号</th></tr></thead>
              <tbody>
                {detail.ops.map((o, i) => (
                  <tr key={i}>
                    <td>{o.entityTypeText}</td>
                    <td title={o.aRef ?? ''}>{o.aRef ? o.aRef.slice(0, 26) : '—'}</td>
                    <td>{o.statusText}</td>
                    <td title={o.requestId}>{o.requestId.slice(0, 24)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="wb-row" style={{ marginTop: 10 }}>
        <div className="wb-field" style={{ width: 150 }}><label>通道角色</label>
          <select className="wb-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="customer_owner">实控人</option>
            <option value="customer_finance">财务</option>
            <option value="plant_manager">厂长</option>
            <option value="customer_contact">联系人</option>
          </select>
        </div>
        <button className="wb-btn small" onClick={issueInvite}>发起通道邀请</button>
        {inviteToken && (
          <span className="wb-note warn">通道令牌（仅此一次显示，请复制给客户人员）：
            <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{inviteToken}</code>
            <button className="wb-btn small ghost" onClick={() => { void navigator.clipboard?.writeText(inviteToken).catch(() => { }); }}>复制</button>
            <button className="wb-btn small ghost" onClick={() => setInviteToken(null)}>我已保存</button>
          </span>
        )}
      </div>
      <div className="wb-row">
        <input className="wb-input" style={{ width: 260 }} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
          placeholder="粘贴通道令牌以接受绑定" aria-label="通道令牌" />
        <button className="wb-btn small ghost" onClick={acceptInvite}>接受绑定</button>
        {invitationId && <span className="wb-sub">已用绑定：<code style={{ userSelect: 'all' }}>{invitationId}</code></span>}
      </div>
      <div className="wb-row">
        <div className="wb-field" style={{ width: 150 }}><label>通道材料种类</label>
          <select className="wb-select" value={upKind} onChange={(e) => setUpKind(e.target.value)}>
            {CHANNEL_KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
          </select>
        </div>
        <div className="wb-field" style={{ width: 130 }}><label>期间起</label>
          <input className="wb-input" value={upPeriodFrom} onChange={(e) => setUpPeriodFrom(e.target.value)} placeholder="2025-07-01" />
        </div>
        <div className="wb-field" style={{ width: 130 }}><label>期间止</label>
          <input className="wb-input" value={upPeriodTo} onChange={(e) => setUpPeriodTo(e.target.value)} placeholder="2025-09-30" />
        </div>
      </div>
      <div className="wb-row">
        <input type="file" ref={fileRef} aria-label="选择送入通道的原件" />
        <button className="wb-btn" onClick={uploadToChannel}>上传进通道（≤512KB）</button>
      </div>
      <WbError error={fileMsg} onDismiss={() => setFileMsg(null)} />
      {act.node}
    </div>
  );
}
