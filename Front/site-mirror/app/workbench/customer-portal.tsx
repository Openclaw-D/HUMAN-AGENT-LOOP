// goal-03c 客户视图（受邀客户联系人身份）：只呈现获准披露内容——我的材料（处理阶段/失败原因/
// 下一动作白名单投影）、受限上传（allowedKinds 服务端强制）、对内消息。
// board-round-02 任务01（方案R 统一链）：提交只有一个入口——通道面上传，处理推进与 A 档案登记
// 由后台自动完成；无通道绑定时如实阻断并引导一次性绑定，不降级走档案直传、不重复上传。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { bytesToBase64, errorText, fmtWhen, MAX_ORIGINAL_BYTES, mergeThread, wbActionRequestId, type PendingSend, type RemoteThreadMsg } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

interface MyMaterial {
  artifactId: string; kind: string; createdAt?: string; duplicateOf?: string | null;
  stage?: string; failureReason?: string | null; nextAction?: string | null;
}

const KINDS = [
  { v: 'invoice', t: '发票' },
  { v: 'purchase_contract', t: '购销合同' },
  { v: 'bank_statement', t: '银行流水' },
  { v: 'ledger_book', t: '账表' },
  { v: 'entity_register', t: '主体登记' },
  { v: 'device_photo', t: '设备照片' },
  { v: 'site_photo', t: '现场照片' },
  { v: 'document_sample', t: '其他文件' },
];

const STAGE_LABEL: Record<string, { tone: string; text: string }> = {
  registered: { tone: 'off', text: '已登记（待处理）' },
  received: { tone: 'blue', text: '已接收' },
  parsed: { tone: 'blue', text: '解析完成' },
  analyzed: { tone: 'green', text: '分析完成' },
  needs_review: { tone: 'yellow', text: '待人工复核' },
  failed: { tone: 'red', text: '处理失败' },
};

export function CustomerPortal({ wb, customerId, onLogout }: { wb: WbApi; customerId: string; onLogout: () => void }) {
  const client = wb.client;
  const [mats, setMats] = useState<MyMaterial[] | null>(null);
  const [kind, setKind] = useState(KINDS[0].v);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [remote, setRemote] = useState<RemoteThreadMsg[]>([]);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const threadCursorRef = useRef<string | null>(null);
  const act = useAction();

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const j = await client.myMaterials();
      setMats((j.materials ?? []) as MyMaterial[]);
      setLoadErr(null);
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401 || err.status === 403) {
        // 撤权/会话失效=终态：清会话回登录页，不以本地状态伪装仍在线
        wb.logout();
        wb.setError('本会话已被终止（权限被撤销或会话失效）：请重新登录或联系办理人');
        return;
      }
      setLoadErr(errorText((e as { code?: string }).code, '我的材料读取失败'));
    }
  }, [client]);

  useEffect(() => { void load(); }, [load, wb.snapshotVersion]);

  // 与办理方双向消息（DEF-G04N-05 修复）：客户会话只可见 customer 受众（服务端强制过滤），
  // 轮询增量拉取；会话失效/撤权=终态回登录，与材料读取同一处置。
  const pollThread = useCallback(async () => {
    if (!client || !client.session) return;
    try {
      const j = await client.listMessages(customerId, {
        audience: 'customer',
        ...(threadCursorRef.current ? { after: threadCursorRef.current } : { limit: 200 }),
      });
      const items = (Array.isArray(j.messages) ? j.messages : []) as RemoteThreadMsg[];
      if (typeof j.cursor === 'string' && j.cursor) threadCursorRef.current = j.cursor;
      if (items.length > 0) {
        setRemote((prev) => {
          const seen = new Set(prev.map((m) => m.messageId));
          return [...prev, ...items.filter((m) => !seen.has(m.messageId))];
        });
      }
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401 || err.status === 403) {
        wb.logout();
        wb.setError('本会话已被终止（权限被撤销或会话失效）：请重新登录或联系办理人');
      }
      // 其余轮询失败静默：下一轮重试，不以本地状态伪装失败
    }
  }, [client, customerId, wb]);

  useEffect(() => {
    setRemote([]);
    threadCursorRef.current = null;
    void pollThread();
    const t = window.setInterval(() => void pollThread(), 4000);
    return () => window.clearInterval(t);
  }, [pollThread]);

  if (!client) return null;

  const myPrincipalId = wb.session?.principalId ?? '';
  const thread = mergeThread(pending, remote, myPrincipalId).customer;

  // 一次性通道绑定（方案R）：把办理人提供的通道令牌换成上传绑定。绑定后本门户所有提交
  // 都走通道面（处理推进与 A 档案登记由后台自动完成）；无绑定时提交如实阻断。
  const acceptBinding = () => {
    if (!tokenInput.trim()) { setFileMsg('请先粘贴办理人提供的通道令牌'); return; }
    const requestId = wbActionRequestId('wb-cbind', customerId, 'bind', String(Date.now()));
    act.open(
      {
        title: '关联处理通道（一次性绑定）',
        lines: ['粘贴的通道令牌将换取本材料的上传绑定（一次有效）。绑定后提交的材料直接进入常驻处理链，处理结果由后台自动登记回"我的材料"。'],
        confirmLabel: '确认绑定',
        requestId,
      },
      async () => {
        const r = await client.channelAction<{ invitationId?: string; bindingId?: string; existed?: boolean }>('intake/accept', {
          requestId, tenantId: 't1', token: tokenInput.trim(), provider: 'portal',
          providerUserId: `portal:${customerId}:${wb.session?.principalId ?? 'contact'}:${Date.now().toString(36)}`,
        });
        if (r.invitationId) setInvitationId(r.invitationId);
        setTokenInput('');
        setFileMsg(r.existed === true ? '该绑定已存在（幂等接受）——可直接提交材料。' : null);
      },
    );
  };

  const submit = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setFileMsg('请先选择文件'); return; }
    if (!invitationId) { setFileMsg('尚未关联处理通道：请向办理人索取通道令牌并在上方完成一次性绑定。提交入口只有一个（处理链），不会让你重复上传或另走档案通道。'); return; }
    void f.arrayBuffer().then(async (buf) => {
      const bytes = new Uint8Array(buf);
      if (bytes.length === 0) { setFileMsg('文件内容为空'); return; }
      if (bytes.length > MAX_ORIGINAL_BYTES) { setFileMsg(`提交当前受限 ${Math.floor(MAX_ORIGINAL_BYTES / 1024)}KB（受限上传通道）`); return; }
      setFileMsg(null);
      // requestId 在确认框打开时固定：确认失败/结果未知后重试仍用同一编号（服务端幂等吸收），不换号盲重。
      const requestId = wbActionRequestId('wb-cup', customerId, 'upload', String(Date.now()));
      act.open(
        {
          title: '提交材料（一次提交 · 自动登记）',
          lines: [
            `文件：${f.name}（${bytes.length} 字节）`,
            `种类：${KINDS.find((k) => k.v === kind)?.t ?? kind}（实际可传范围以邀请授权白名单为准，服务端强制）`,
            '提交后进入常驻处理链（解压→解析→事实→分析），登记与处理进度自动回写"我的材料"——不需要重复提交或另走其他通道。客户申报不产生核验等级，扫描件走人工路线，不伪装 OCR。',
          ],
          confirmLabel: '确认提交',
          requestId,
        },
        async () => {
          await client.channelAction('evidence/upload', {
            requestId, tenantId: 't1', customerId, invitationId, kind,
            contentBase64: bytesToBase64(bytes), contentType: f.type || 'application/octet-stream',
            periodFrom: null, periodTo: null,
          });
          if (fileRef.current) fileRef.current.value = '';
          await load();
        },
      );
    });
  };

  const send = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setText('');
    const localId = `cm-${Date.now()}`;
    const requestId = `wb-cmsg-${customerId}-${Date.now()}`.slice(0, 128);
    setPending((prev) => [...prev, { id: localId, requestId, audience: 'customer', text: body, at: new Date().toISOString(), state: '发送中' }]);
    try {
      await client.sendMessage(customerId, { requestId, audience: 'customer', text: body });
      setPending((prev) => prev.map((m) => (m.id === localId ? { ...m, state: '已送达（服务端回执）' } : m)));
      await pollThread();
    } catch (e) {
      setPending((prev) => prev.map((m) => (m.id === localId ? { ...m, state: `发送失败：${(e as { code?: string }).code ?? ''}` } : m)));
    }
  };

  return (
    <div className="wb-root">
      <header className="wb-top">
        <h1>客户材料门户 <span className="wb-sub">{customerId}</span></h1>
        <span className="wb-badge demo">客户联系人视图（仅获准披露内容）</span>
        <span className="wb-spacer" />
        <button className="wb-btn small ghost" onClick={onLogout}>退出</button>
      </header>
      <WbError error={wb.error ?? loadErr} onDismiss={() => wb.setError(null)} />
      <div className="wb-main" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <section className="wb-panel" aria-label="我的材料">
          <h3 className="wb-h2">我的材料（处理进度 · 失败原因与下一动作）</h3>
          {mats === null && <p className="wb-note">加载中…</p>}
          {mats !== null && mats.length === 0 && <p className="wb-note">尚无材料。用右侧表单提交第一份。</p>}
          {mats !== null && mats.map((m) => {
            const st = STAGE_LABEL[m.stage ?? 'registered'] ?? { tone: 'gray', text: m.stage ?? '未知' };
            return (
              <div key={m.artifactId} className={`wb-card ${m.stage === 'failed' ? 'bad' : ''}`}>
                <div className="wb-row">
                  <strong>{m.kind}</strong>
                  <span className={`wb-badge ${st.tone}`}><span className={`wb-dot ${st.tone}`} />{st.text}</span>
                  <span className="wb-sub">{fmtWhen(m.createdAt)}</span>
                </div>
                {m.failureReason && <div className="wb-note">失败原因：{m.failureReason}</div>}
                {m.nextAction && <div className="wb-note">下一动作：{m.nextAction}</div>}
              </div>
            );
          })}
        </section>
        <section className="wb-panel" aria-label="提交材料">
          <h3 className="wb-h2">提交材料（一次提交 · 自动登记回"我的材料"）</h3>
          {invitationId
            ? <p className="wb-note"><span className="wb-badge live">处理通道已关联</span> 提交后自动进入处理链，进度见左侧"我的材料"。</p>
            : <div className="wb-card dim">
                <h3 className="wb-h2">第一步：关联处理通道（一次性）</h3>
                <p className="wb-note">向办理人索取通道令牌，粘贴后绑定。未绑定时提交不可用（如实阻断）——不会让你把材料登记到无人处理的通道外。</p>
                <div className="wb-row">
                  <input className="wb-input" style={{ flex: 1 }} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="粘贴办理人提供的通道令牌" aria-label="通道令牌" />
                  <button className="wb-btn" onClick={acceptBinding}>关联通道</button>
                </div>
              </div>}
          <div className="wb-row">
            <div className="wb-field" style={{ width: 200 }}><label>材料种类（邀请授权范围）</label>
              <select className="wb-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
              </select>
            </div>
          </div>
          <div className="wb-row">
            <input type="file" ref={fileRef} aria-label="选择文件" />
            <button className="wb-btn" onClick={submit} disabled={!invitationId} title={invitationId ? '' : '先关联处理通道（第一步）'}>提交</button>
          </div>
          {!invitationId && <p className="wb-note warn">提交按钮暂不可用：先完成上方一次性通道绑定。</p>}
          <WbError error={fileMsg} onDismiss={() => setFileMsg(null)} />
          {act.node}
          <h3 className="wb-h2" style={{ marginTop: 14 }}>与办理方沟通（双向 · 服务端线程为准）</h3>
          <div className="wb-chat-list" aria-label="消息">
            {thread.length === 0 && <span className="wb-note">（暂无消息：办理人回复后将在此显示）</span>}
            {thread.map((m) => (
              <div key={m.key} className="wb-msg">
                <div>{m.text}</div>
                <div className="meta">
                  {m.senderLabel} · {new Date(m.at).toLocaleTimeString('zh-CN', { hour12: false })} ·{' '}
                  {m.state.startsWith('发送中') ? <span><span className="wb-dot blue" aria-hidden="true" />{m.state}</span>
                    : m.state.startsWith('发送失败') ? <span><span className="wb-dot red" aria-hidden="true" />{m.state}</span>
                    : <span><span className="wb-dot green" aria-hidden="true" />{m.state}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="wb-row" style={{ marginTop: 6 }}>
            <input className="wb-input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="向办理方留言…" aria-label="消息输入" />
            <button className="wb-btn" onClick={() => void send()} disabled={!text.trim()}>发送</button>
          </div>
        </section>
      </div>
      <footer className="wb-sub" style={{ padding: '2px 16px 8px' }}>
        客户视图不包含内部评估/额度/报告（服务端结构隔离）；处理进度为获准披露白名单投影。
      </footer>
    </div>
  );
}
