// goal-03c 客户视图（受邀客户联系人身份）：只呈现获准披露内容——我的材料（处理阶段/失败原因/
// 下一动作白名单投影）、受限上传（allowedKinds 服务端强制）、对内消息。不含内部评估/额度/报告。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { buildOriginalEnvelope, errorText, fmtWhen, mergeThread, type PendingSend, type RemoteThreadMsg } from '../../lib/workbench/wb-logic';
import { WbError, useAction } from './wb-parts';

interface MyMaterial {
  artifactId: string; kind: string; createdAt?: string; duplicateOf?: string | null;
  stage?: string; failureReason?: string | null; nextAction?: string | null;
}

const KINDS = ['invoice', 'purchase_contract', 'equipment_list', 'bank_statement', 'financial_statement'];

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
  const [kind, setKind] = useState(KINDS[0]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
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

  const submit = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setFileMsg('请先选择文件'); return; }
    void f.arrayBuffer().then(async (buf) => {
      const pre = buildOriginalEnvelope({ name: f.name, mime: f.type, bytes: new Uint8Array(buf) });
      if (!pre.ok) { setFileMsg(pre.message); return; }
      setFileMsg(null);
      act.open(
        {
          title: '提交材料（受限范围内）',
          lines: [
            `文件：${pre.envelope.name}（${pre.envelope.size} 字节）`,
            `种类：${kind}（须在邀请授权白名单内，服务端强制）`,
            '客户申报不产生核验等级；处理进度将在"我的材料"中可见。',
          ],
          confirmLabel: '确认提交',
        },
        async () => {
          await client.uploadOriginal(customerId, {
            requestId: `wb-cup-${customerId}-${Date.now()}`.slice(0, 128),
            kind,
            file: { name: pre.envelope.name, mime: pre.envelope.mime, dataBase64: pre.envelope.data },
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
          <h3 className="wb-h2">提交材料（≤512KB 受限通道）</h3>
          <div className="wb-row">
            <div className="wb-field" style={{ width: 200 }}><label>材料种类（邀请授权范围）</label>
              <select className="wb-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <div className="wb-row">
            <input type="file" ref={fileRef} aria-label="选择文件" />
            <button className="wb-btn" onClick={submit}>提交</button>
          </div>
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
