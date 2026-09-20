import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { DirectoryCustomer } from '../../lib/workbench/wb-client';
import { workRoleName } from '../takeoff/role-entry';

export function CustomerDirectory({ wb, onOpen }: { wb: WbApi; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DirectoryCustomer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const load = useCallback(async (query: string, next?: string) => {
    const seq = ++request.current;
    setLoading(true); setError('');
    try {
      const r = await wb.client!.directory(query, next);
      if (seq !== request.current) return;
      if (r.kind !== 'ok') throw new Error();
      setRows((old) => next ? [...old, ...r.customers] : r.customers);
      setCursor(r.nextCursor ?? null);
    } catch { if (seq === request.current) setError('暂时无法读取客户，请重试。'); }
    finally { if (seq === request.current) setLoading(false); }
  }, [wb.client]);
  useEffect(() => { void load(''); return () => { request.current++; }; }, [load]);
  const canCreate = (wb.session?.roles ?? []).some((r) => ['business', 'credit', 'admin'].includes(r));
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); if (saving || !name.trim() || !code.trim()) return;
    setSaving(true); setError('');
    try {
      const result = await wb.client!.createCustomer({ requestId: `customer-${crypto.randomUUID()}`, tenantId: wb.session?.tenantId ?? 't1', legalEntityRef: code.trim(), displayName: name.trim() });
      if (!result.customerId) throw new Error();
      onOpen(result.customerId);
    } catch { setError('未能创建客户，请核对名称、信用代码及当前角色权限后重试。'); }
    finally { setSaving(false); }
  };
  return <main className="tk-root tk-directory">
    <header className="tk-entry-brand"><strong>见微</strong><span>首次回租 · 准入预评估</span><button className="tk-btn ghost tk-role-switch" onClick={wb.logout}>{workRoleName(wb.session?.roles)} · 切换角色</button></header>
    <section className="tk-directory-content">
      <div className="tk-directory-title"><div><span className="tk-eyebrow">客户工作台</span><h1>从一位客户开始</h1></div>{canCreate && <button className="tk-btn primary" onClick={() => setCreating(!creating)}>{creating ? '收起' : '＋ 新建客户'}</button>}</div>
      <form className="tk-search" onSubmit={(e) => { e.preventDefault(); void load(search.trim()); }}><input aria-label="搜索客户" placeholder="搜索客户名称" value={search} onChange={(e) => setSearch(e.target.value)} /><button className="tk-btn" disabled={loading}>搜索</button></form>
      {(error || wb.error) && <p className="tk-inline-error" role="alert">{error || '客户暂时无法打开，请重试或切换角色。'} <button className="tk-btn small" onClick={() => { wb.setError(null); void load(search.trim()); }}>重试</button></p>}
      {creating && <form className="tk-new-customer" onSubmit={create}><label>客户全称<input required value={name} onChange={(e) => setName(e.target.value)} /></label><label>统一社会信用代码<input required value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="tk-btn primary" disabled={saving}>{saving ? '创建中…' : '创建并进入'}</button></form>}
      <div className="tk-customer-list" aria-label="客户列表" aria-busy={loading}>
        {loading && !rows.length && <p>正在读取客户…</p>}
        {!loading && !error && rows.length === 0 && <div className="tk-directory-empty"><strong>{search ? '没有找到这位客户' : '还没有客户'}</strong><p>{search ? '换个名称试试。' : '新建客户后，就可以上传材料、开始协作。'}</p></div>}
        {rows.map((c) => <button className="tk-customer-row" key={c.customerId} onClick={() => onOpen(c.customerId)} title={`客户编号：${c.customerId}`}><span className="tk-customer-monogram" aria-hidden="true">{(c.displayName || '客').slice(0, 1)}</span><span className="tk-customer-copy"><strong>{c.displayName || '未命名客户'}</strong><small>首次回租预评估 · 编号 {c.customerId.slice(-6)}</small></span><span className="tk-customer-enter">进入工作台 →</span></button>)}
      </div>
      {cursor && <button className="tk-btn" disabled={loading} onClick={() => void load(search.trim(), cursor)}>加载更多</button>}
    </section>
  </main>;
}
