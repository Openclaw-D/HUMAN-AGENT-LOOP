// 客户目录（2026-09-30-final · 01-front 十案例收口）：
// 默认＝服务端显式演示目录（GET /api/jw/v2/arrow-cases，只读）：差→中→好横向滚动展列（不挤一屏），
// 卡片显示案例名称/要点/当前阶段/下一动作，五区进度为真实回执投影；无搜索/新建/验收视图/测试开关在业务流。
// 完整客户目录（验收数据）保留：仅 ?acceptance=1 工程入口或演示目录未接通时显示（诚实回退，不冒充演示目录）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { DirectoryCustomer } from '../../lib/workbench/wb-client';
import { DEMO_CASES_FIXTURE, caseGradeClass, caseStageText, readArrowCases, readCaseProgress, sortCasesForDisplay, type ArrowCase, type ArrowCasesResult, type CaseProgress } from '../../lib/workbench/arrow-cases';
import { workRoleName } from '../takeoff/role-entry';
import { RoleLogo, UiIcon } from '../takeoff/ui-icons';
import { businessCopy } from '../../lib/workbench/business-copy';

interface DemoState {
  phase: 'loading' | 'ok' | 'unavailable';
  cases: ArrowCase[];
  manifestVersion: string | null;
  fixture: boolean;
  status: number;
  code: string;
}

const demoInitialState: DemoState = { phase: 'loading', cases: [], manifestVersion: null, fixture: false, status: 0, code: '' };

export function CustomerDirectory({ wb, onOpen }: { wb: WbApi; onOpen: (id: string) => void }) {
  const [demo, setDemo] = useState<DemoState>(demoInitialState);
  const [progress, setProgress] = useState<Record<string, CaseProgress>>({});
  const acceptanceParam = new URLSearchParams(window.location.search).get('acceptance') === '1';
  const [acceptance, setAcceptance] = useState(false);
  const demoSeq = useRef(0);
  const loadDemo = useCallback(async () => {
    const seq = ++demoSeq.current;
    setDemo(demoInitialState);
    const client = wb.client;
    if (!client || typeof client.read !== 'function') {
      setDemo({ ...demoInitialState, phase: 'unavailable', code: 'NO_CLIENT' });
      return;
    }
    const fixture = new URLSearchParams(window.location.search).get('demoFixture') === '1';
    const result: ArrowCasesResult = fixture
      ? { kind: 'ok', manifestVersion: 'dev-fixture', cases: DEMO_CASES_FIXTURE }
      : await readArrowCases(client);
    if (seq !== demoSeq.current) return;
    if (result.kind !== 'ok') {
      setDemo({ ...demoInitialState, phase: 'unavailable', status: result.status, code: result.code });
      return;
    }
    setDemo({ phase: 'ok', cases: sortCasesForDisplay(result.cases), manifestVersion: result.manifestVersion, fixture, status: 0, code: '' });
    for (const c of result.cases) {
      if (typeof client.advance?.history !== 'function') break;
      const p = await readCaseProgress(client, c.customerId);
      if (seq !== demoSeq.current) return;
      setProgress((old) => ({ ...old, [c.customerId]: p }));
    }
  }, [wb.client]);
  useEffect(() => { void loadDemo(); return () => { demoSeq.current += 1; }; }, [loadDemo]);

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
    if (!wb.client?.directory) return;
    const seq = ++request.current;
    setLoading(true); setError('');
    try {
      const r = await wb.client.directory(query, next);
      if (seq !== request.current) return; // 旧响应晚到：不写回（防串页/串客户）
      if (r.kind !== 'ok') throw new Error();
      setRows((old) => next ? [...old, ...r.customers] : r.customers);
      setCursor(r.nextCursor ?? null);
    } catch { if (seq === request.current) setError('暂时无法读取客户，请重试。'); }
    finally { if (seq === request.current) setLoading(false); }
  }, [wb.client]);
  // Only load the full directory when it is actually requested or needed.
  useEffect(() => { if(acceptanceParam || acceptance || demo.phase==='unavailable') void load(''); return () => { request.current++; }; }, [load, acceptanceParam, acceptance, demo.phase]);
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

  const brand = <header className="tk-entry-brand"><UiIcon name="jianwei" size={30}/><strong>见微</strong><span>首次回租 · 准入预评估</span><button className="tk-picker-role" aria-label="切换角色" title={`${workRoleName(wb.session?.roles)} · 切换角色`} onClick={wb.logout}><RoleLogo role={wb.session?.roles.find((r) => ['business','policy','credit','commerce','asset'].includes(r)) ?? 'business'} size={54}/></button></header>;

  if (demo.phase === 'ok' && !acceptance) {
    return <main className="tk-root tk-directory tk-case-picker">
      {brand}
      <section className="tk-picker-content tk-cases-strip" aria-label="模拟案例目录">
        <div className="tk-demo-intro"><h1>开始体验</h1><p>十个模拟案例由差到好排列，材料已备好；点击卡片进入办理，横向滚动查看全部案例。</p></div>
        <CaseStrip cases={demo.cases} progress={progress} onOpen={onOpen}/>
        {demo.fixture && <p className="tk-inline-error" role="note">当前为开发夹具布局预览（demoFixture=1）：案例与客户编号不是真实服务端数据，不作联调验收。</p>}
        <span className="tk-picker-caption">全部案例均为模拟案例（合成材料与受控外部事件）；分析、规则、办理记录与进度来自真实服务端。结果由材料与规则计算，不按案例分类预设。</span>
      </section>
    </main>;
  }

  return <main className="tk-root tk-directory">
    {brand}
    <section className="tk-directory-content">
      {demo.phase === 'ok' && acceptance && <button className="tk-acceptance-entry" onClick={() => setAcceptance(false)}>← 返回演示案例目录</button>}
      {demo.phase === 'loading' && <p className="tk-demo-loading">正在读取演示案例目录…</p>}
      {demo.phase === 'unavailable' && <p className="tk-inline-error" role="note">
        演示案例目录未接通（{demo.code === 'NO_CLIENT' ? '工作台尚未连接' : `服务端未返回案例清单 · ${demo.code || demo.status || '网络错误'}`}）——以下为完整客户目录（验收视图），不冒充演示目录。
        <button className="tk-btn small" onClick={() => void loadDemo()}>重试演示目录</button>
      </p>}
      {(acceptanceParam || acceptance || demo.phase === 'unavailable') && <>
        <div className="tk-directory-title"><div><span className="tk-eyebrow">客户工作台{demo.phase === 'ok' ? ' · 验收视图' : ''}</span><h1>从一位客户开始</h1></div>{canCreate && <button className="tk-btn primary" onClick={() => setCreating(!creating)}>{creating ? '收起' : '＋ 新建客户'}</button>}</div>
        <FullDirectoryBody {...{ wb, onOpen, search, setSearch, rows, cursor, loading, error, creating, setCreating, name, setName, code, setCode, saving, create, load, canCreate }} />
      </>}
    </section>
  </main>;
}

/** 横向案例条：一行滚动，左右步进按钮；每卡固定宽度，不把十卡挤进一屏。 */
function CaseStrip({ cases, progress, onOpen }: { cases: ArrowCase[]; progress: Record<string, CaseProgress>; onOpen: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const step = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el && typeof el.scrollBy === 'function') el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.75), behavior: 'smooth' });
  };
  return <div className="tk-strip-wrap">
    <button className="tk-strip-arrow" aria-label="向左滚动案例" onClick={() => step(-1)}>‹</button>
    <div className="tk-strip" ref={scroller} role="list" aria-label="案例列表（横向滚动）">
      {cases.map((c) => {
        const p = progress[c.customerId];
        return <div role="listitem" key={c.caseId} className="tk-strip-item">
          <div role="button" tabIndex={0} className={`tk-picker-card tk-case-card ${caseGradeClass(c.scenarioLabel)}`}
            aria-label={`${c.scenarioLabel ?? '案例'}例：${c.displayName}（模拟案例）`}
            onClick={() => onOpen(c.customerId)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.customerId); } }}>
            <div className="tk-case-head"><span className="tk-case-grade">{c.scenarioLabel ?? '案例'}</span><span className="tk-demo-badge">模拟案例</span></div>
            <span className="tk-picker-name">{c.displayName}</span>
            <span className="tk-case-summary">{businessCopy(c.summary ?? c.industry ?? '案例材料已就绪')}</span>
            <div className="tk-case-stage"><small>当前阶段</small><span>{businessCopy(caseStageText(c, p))}</span></div>
            <div className="tk-case-next"><small>下一动作</small><span>{businessCopy(c.nextAction ?? '进入案例按页面提示办理')}</span></div>
            <div className="tk-case-progress" aria-label="五区办理进度">
              {(p?.domains ?? []).map((d) => <span key={d.domain} data-state={d.state}>{d.name}·{d.text}</span>)}
              {!p && <span>正在读取办理进度…</span>}
              {p?.readError && <span data-state="unknown">办理进度暂时无法读取</span>}
            </div>
          </div>
        </div>;
      })}
    </div>
    <button className="tk-strip-arrow" aria-label="向右滚动案例" onClick={() => step(1)}>›</button>
  </div>;
}

interface FullDirectoryProps {
  wb: WbApi; onOpen: (id: string) => void;
  search: string; setSearch: (v: string) => void;
  rows: DirectoryCustomer[]; cursor: string | null; loading: boolean; error: string;
  creating: boolean; setCreating: (v: boolean) => void;
  name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void;
  saving: boolean; create: (e: React.FormEvent) => Promise<void>; load: (query: string, next?: string) => Promise<void>;
  canCreate: boolean;
}

/** 完整客户目录（验收视图共享体）：搜索/新建/分页列表，语义与 03-live-front 轮一致。 */
function FullDirectoryBody(p: FullDirectoryProps) {
  return <>
    <form className="tk-search" onSubmit={(e) => { e.preventDefault(); void p.load(p.search.trim()); }}><input aria-label="搜索客户" placeholder="搜索客户名称" value={p.search} onChange={(e) => p.setSearch(e.target.value)} /><button className="tk-btn" disabled={p.loading}>搜索</button></form>
    {(p.error || p.wb.error) && <p className="tk-inline-error" role="alert">{p.error || p.wb.error} <button className="tk-btn small" onClick={() => { p.wb.setError(null); void p.load(p.search.trim()); }}>重试</button></p>}
    {p.creating && p.canCreate && <form className="tk-new-customer" onSubmit={p.create}><label>客户全称<input required value={p.name} onChange={(e) => p.setName(e.target.value)} /></label><label>统一社会信用代码<input required value={p.code} onChange={(e) => p.setCode(e.target.value)} /></label><button className="tk-btn primary" disabled={p.saving}>{p.saving ? '创建中…' : '创建并进入'}</button></form>}
    <div className="tk-customer-list" aria-label="客户列表" aria-busy={p.loading}>
      {p.loading && !p.rows.length && <p>正在读取客户…</p>}
      {!p.loading && !p.error && p.rows.length === 0 && <div className="tk-directory-empty"><strong>{p.search ? '没有找到这位客户' : '还没有客户'}</strong><p>{p.search ? '换个名称试试。' : '新建客户后，就可以上传材料、开始协作。'}</p></div>}
      {p.rows.map((c) => <button className="tk-customer-row" key={c.customerId} onClick={() => p.onOpen(c.customerId)} title={`客户编号：${c.customerId}`}><span className="tk-customer-monogram" aria-hidden="true">{(c.displayName || '客').slice(0, 1)}</span><span className="tk-customer-copy"><strong>{c.displayName || '未命名客户'}</strong><small>首次回租预评估 · 编号 {c.customerId.slice(-6)}</small></span><span className="tk-customer-enter">进入工作台 →</span></button>)}
    </div>
    {p.cursor && <button className="tk-btn" disabled={p.loading} onClick={() => void p.load(p.search.trim(), p.cursor!)}>加载更多</button>}
  </>;
}
