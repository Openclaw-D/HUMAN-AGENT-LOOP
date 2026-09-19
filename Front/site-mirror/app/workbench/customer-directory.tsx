// goal-03c 客户目录（路径一）：授权目录全量清单待上游（IR-03-1 显式标注）；本页提供
// 搜索（按客户标识直查 A，404=无权或不存在）、新建客户、本会话最近访问（本地记录、明确标注）。
// 不要求手填技术 token；演示租户由页面常量显示。
import { useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { DEMO_TENANT, errorText } from '../../lib/workbench/wb-logic';
import { WbError } from './wb-parts';

const RECENT_KEY = 'jw-wb-recent-customers';

function loadRecent(): string[] {
  try { return JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; }
}
function rememberCustomer(id: string) {
  const list = loadRecent().filter((x) => x !== id);
  list.unshift(id);
  try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* 隐私模式忽略 */ }
}

export function CustomerDirectory({ wb, onOpen }: { wb: WbApi; onOpen: (customerId: string) => void }) {
  const [lookup, setLookup] = useState('');
  const [newName, setNewName] = useState('');
  const [newRef, setNewRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [listed, setListed] = useState<Array<{ customerId: string; displayName?: string | null; status?: string }> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dirNote, setDirNote] = useState<string | null>(null);

  useEffect(() => {
    setRecent(loadRecent());
    void loadList('');
    // eslint 由构建期 tsc 把关
  }, []);

  const client = wb.client;
  if (!client) return null;

  const loadList = async (search: string, cursor?: string) => {
    try {
      const r = await client.directory(search, cursor);
      if (r.kind === 'ok') {
        setListed((prev) => (cursor ? [...(prev ?? []), ...r.customers] : r.customers));
        setNextCursor(r.nextCursor ?? null);
        setDirNote(null);
      } else if (r.kind === 'pending') {
        setDirNote(`目录清单待后台提供（${r.interfaceRequest}）：请用客户标识搜索，或新建客户。`);
      } else {
        setDirNote('目录服务暂不可达：请稍后重试或用客户标识搜索。');
      }
    } catch (e) {
      setDirNote(errorText((e as { code?: string }).code, '目录读取失败'));
    }
  };

  const searchList = () => {
    setBusy(true);
    void loadList(lookup.trim()).finally(() => setBusy(false));
  };


  const createCustomer = async () => {
    if (!newName.trim() || !newRef.trim()) { setErr('请填写客户名称与统一社会信用代码（演示合成数据，不使用真实客户信息）'); return; }
    setErr(null);
    setBusy(true);
    try {
      const r = await client.createCustomer({
        tenantId: DEMO_TENANT,
        legalEntityRef: newRef.trim(),
        displayName: newName.trim(),
        requestId: `wb-new-${Date.now()}`.slice(0, 128),
      });
      const cid = r.customerId;
      if (!cid) throw new Error('后台未返回客户标识');
      rememberCustomer(cid);
      setRecent(loadRecent());
      const ok = await wb.openCustomer(cid);
      if (ok) onOpen(cid);
    } catch (e) {
      setErr(errorText((e as { code?: string }).code, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wb-root">
      <header className="wb-top">
        <h1>客户目录 <span className="wb-sub">真实办理</span></h1>
        <span className="wb-badge live">已登录</span>
        <span className="wb-spacer" />
        <span className="wb-sub">身份：{wb.session?.principalId}（角色 {wb.session?.roles.join('/') || '—'}，服务端裁决）</span>
        <button className="wb-btn small ghost" onClick={() => wb.logout()}>退出登录</button>
      </header>
      <WbError error={err ?? wb.error} onDismiss={() => { setErr(null); wb.setError(null); }} />
      <div className="wb-dir">
        <div className="wb-panel">
          <h3 className="wb-h2">授权客户目录（服务端权威 · 按本身份授权过滤）</h3>
          <div className="wb-row">
            <input className="wb-input" style={{ width: 320 }} value={lookup} onChange={(e) => setLookup(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') searchList(); }}
              placeholder="按名称/标识搜索（回车）" />
            <button className="wb-btn" onClick={searchList} disabled={busy}>搜索</button>
          </div>
          <WbError error={dirNote} onDismiss={() => setDirNote(null)} />
          {listed !== null && listed.length === 0 && <p className="wb-note">（目录为空：新建客户后会出现在这里）</p>}
          {listed !== null && listed.length > 0 && (
            <table className="wb-table">
              <thead><tr><th>客户名称</th><th>客户标识</th><th>状态</th><th></th></tr></thead>
              <tbody>
                {listed.map((c) => (
                  <tr key={c.customerId}>
                    <td>{c.displayName ?? '—'}</td>
                    <td className="wb-sub">{c.customerId}</td>
                    <td>{c.status ?? '—'}</td>
                    <td><button className="wb-btn small" onClick={() => { rememberCustomer(c.customerId); onOpen(c.customerId); }}>打开工作本</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {nextCursor && <button className="wb-btn small ghost" style={{ marginTop: 6 }} disabled={busy} onClick={() => void loadList(lookup.trim(), nextCursor)}>加载更多</button>}
        </div>

        <div className="wb-panel" style={{ marginTop: 12 }}>
          <h3 className="wb-h2">新建客户（合成演示数据）</h3>
          <div className="wb-row">
            <div className="wb-field" style={{ flex: 1 }}><label>客户名称</label>
              <input className="wb-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如 演示·青山机械制造（合成）" />
            </div>
            <div className="wb-field" style={{ flex: 1 }}><label>统一社会信用代码（演示编号即可）</label>
              <input className="wb-input" value={newRef} onChange={(e) => setNewRef(e.target.value)} placeholder="如 USCC-DEMO-0001" />
            </div>
            <button className="wb-btn" onClick={() => void createCustomer()} disabled={busy}>建档并进入</button>
          </div>
          <p className="wb-note">演示租户：{DEMO_TENANT}（页面常量显示，不需手填）；建档后直接进入该客户工作本。</p>
        </div>

        <div className="wb-panel" style={{ marginTop: 12 }}>
          <h3 className="wb-h2">本会话最近访问（仅本浏览器会话，非服务端清单）</h3>
          {recent.length === 0 && <p className="wb-note">（空）</p>}
          <div className="wb-row">
            {recent.map((id) => (
              <button key={id} className="wb-btn small ghost" onClick={() => { rememberCustomer(id); onOpen(id); }}>{id}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
