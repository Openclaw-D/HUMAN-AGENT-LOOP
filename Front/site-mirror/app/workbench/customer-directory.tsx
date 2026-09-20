import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { DirectoryCustomer } from '../../lib/workbench/wb-client';
import { workRoleName } from '../takeoff/role-entry';
import { RoleLogo, UiIcon } from '../takeoff/ui-icons';
import { DEMO_CASES } from '../../lib/workbench/demo-cases';

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
  const [cases, setCases] = useState<Record<string, { customer?: DirectoryCustomer; note?: string }>>({});
  const [caseReload, setCaseReload] = useState(0);
  useEffect(() => {
    let active = true; setCases({});
    for (const item of DEMO_CASES) {
      void wb.client?.directory(item.name).then((result) => {
        if (!active) return;
        const matches = result.kind === 'ok' ? result.customers.filter((customer) => customer.displayName === item.name) : [];
        const entry = result.kind !== 'ok' ? { note: '暂时无法读取' } : matches.length === 1 && !result.nextCursor ? { customer: matches[0] } : { note: matches.length > 1 || result.nextCursor ? '客户记录需核对' : '尚未接入' };
        setCases((old) => ({ ...old, [item.name]: entry }));
      }).catch(() => { if (active) setCases((old) => ({ ...old, [item.name]: { note: '暂时无法读取' } })); });
    }
    return () => { active = false; };
  }, [wb.client, caseReload]);
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
    <header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong><span>客户协作工作台</span><button className="tk-btn ghost tk-role-switch" onClick={wb.logout}><RoleLogo role={wb.session?.roles[0] ?? 'business'} size={22}/>{workRoleName(wb.session?.roles)} · 切换角色</button></header>
    <section className="tk-directory-content">
      <div className="tk-directory-title"><div><span className="tk-eyebrow">{workRoleName(wb.session?.roles)}工作台</span><h1>今天，跟进哪位客户？</h1><p>打开客户，继续上次的工作。</p></div>{canCreate && <button className="tk-btn primary" onClick={() => setCreating(!creating)}>{creating ? '收起' : '＋ 新建客户'}</button>}</div>
      <section className="tk-demo-cases" aria-label="好中差三客户">
        <div className="tk-case-heading"><span>三位客户 · 合成演练</span><button className="tk-btn small ghost" onClick={() => setCaseReload((n) => n + 1)}>刷新客户</button></div>
        <div className="tk-case-grid">{DEMO_CASES.map((item) => {
          const entry = cases[item.name];
          return <button key={item.name} className="tk-case-card" disabled={!entry?.customer} onClick={() => entry?.customer && onOpen(entry.customer.customerId)}>
            <span className="tk-case-scenario">{item.scenario}<small>{item.description}</small></span><h2>{item.name}</h2>
            <p>{item.industry} · 申请 {item.amount}</p><span className="tk-case-action">{entry?.customer ? '进入办理 →' : entry?.note ?? '正在连接…'}</span>
          </button>;
        })}</div><p className="tk-case-caption">好、中、差为演练设定；实际分析与办理结论由材料和人工核验得出。</p>
      </section>
      {(error || wb.error) && <p className="tk-inline-error" role="alert">{error || '客户暂时无法打开，请重试或切换角色。'} <button className="tk-btn small" onClick={() => { wb.setError(null); void load(search.trim()); }}>重试</button></p>}
      {creating && <form className="tk-new-customer" onSubmit={create}><label>客户全称<input required value={name} onChange={(e) => setName(e.target.value)} /></label><label>统一社会信用代码<input required value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="tk-btn primary" disabled={saving}>{saving ? '创建中…' : '创建并进入'}</button></form>}
      <details className="tk-other-customers"><summary>其他客户</summary>
      <form className="tk-search" onSubmit={(e) => { e.preventDefault(); void load(search.trim()); }}><input aria-label="搜索客户" placeholder="搜索客户名称" value={search} onChange={(e) => setSearch(e.target.value)} /><button className="tk-btn" disabled={loading}>搜索</button></form>
      <div className="tk-customer-list tk-other-customer-list" aria-label="客户列表" aria-busy={loading}>
        {loading && !rows.length && <p>正在读取客户…</p>}
        {!loading && !error && rows.length === 0 && <div className="tk-directory-empty"><strong>{search ? '没有找到这位客户' : '还没有客户'}</strong><p>{search ? '换个名称试试。' : '新建客户后，就可以上传材料、开始协作。'}</p></div>}
        {rows.map((c) => <button className="tk-customer-row" key={c.customerId} onClick={() => onOpen(c.customerId)}><span className="tk-customer-monogram" aria-hidden="true">{(c.displayName || '客').slice(0, 1)}</span><span className="tk-customer-copy"><strong>{c.displayName || '未命名客户'}</strong><small>首次回租预评估</small></span><span className="tk-customer-enter">进入工作台 →</span></button>)}
      </div>
      {cursor && <button className="tk-btn" disabled={loading} onClick={() => void load(search.trim(), cursor)}>加载更多</button>}
      </details>
    </section>
  </main>;
}
