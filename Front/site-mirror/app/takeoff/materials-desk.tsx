import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { WbClient } from '../../lib/workbench/wb-client';
import { base64ToBytes, bytesToBase64, sniffImageMime, summarizeArtifacts, type ArtifactRow } from '../../lib/workbench/wb-logic';
import { UiIcon, ObjectIcon, MaterialObject } from './ui-icons';
import { PdfOriginal } from './pdf-original';
import { materialKindName } from '../../lib/workbench/material-labels';

type Point = { x: number; y: number };
type Material = ArtifactRow & { name: string };
const layouts = new WeakMap<WbClient, Map<string, Record<string, Point>>>();
const originalNames = new WeakMap<WbClient, Map<string, Promise<string | null>>>();
function registeredName(client: WbClient, customerId: string, artifactId: string): Promise<string | null> {
  const cache = originalNames.get(client) ?? new Map<string, Promise<string | null>>();
  originalNames.set(client, cache);
  const key = `${customerId}:${artifactId}`;
  const old = cache.get(key); if (old) return old;
  const pending = (async () => {
    try {
      const value = await client.artifactContent(customerId, artifactId);
      const art = value.artifact as { materialFile?: { name?: string }; content?: { connectorRef?: { customerId?: string; evidenceId?: string } } } | undefined;
      if (art?.materialFile?.name) return art.materialFile.name;
      const ref = art?.content?.connectorRef;
      if (ref?.customerId !== customerId || !ref.evidenceId) return null;
      const preview = await client.channelPreview(ref.evidenceId, customerId);
      // These approved synthetic source groups record the filename. Unknown groups are not filenames.
      const match = /^KS-(?:TEXTILE-200|LASER-500|INJECTION-1000):D\d{2}-(.+\.(?:pdf|csv|txt))$/i.exec(String(preview.sourceGroup ?? ''));
      return match?.[1] ?? null;
    } catch { return null; }
  })();
  cache.set(key, pending);
  void pending.then((name) => { if (!name) cache.delete(key); });
  return pending;
}
function materialName(item: Record<string, unknown>): string {
  const meta = item.materialFileMeta as { name?: string } | null;
  const kind = String(item.kind ?? '').replace(/^material\./, '');
  return meta?.name || (typeof item.displayName === 'string' ? item.displayName : '') || materialKindName(kind);
}
const gridPoint = (index: number): Point => ({ x: 72 + (index % 4) * 310, y: 72 + Math.floor(index / 4) * 245 });

/** 拖动只改变个人阅读摆放，不移动服务端原件、不改变核验或业务归属。 */
export function MaterialsDesk({ wb, customerId, onUpload }: { wb: WbApi; customerId: string; onUpload: () => void }) {
  const client = wb.client;
  const [rows, setRows] = useState<Material[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'current' | 'history' | 'analysis'>('all');
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>(() => client ? layouts.get(client)?.get(customerId) ?? {} : {});
  const [undo, setUndo] = useState<Array<Record<string, Point>>>([]);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('拖叠成组，拖开分离；双击查看原件。');
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; start: Point; point: Point; before: Record<string, Point> } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const positionsRef = useRef(positions); positionsRef.current = positions;

  useEffect(() => {
    let alive = true; setRows(null); setError('');
    if (!client) return;
    void client.read(`/api/jw/v2/customers/${encodeURIComponent(customerId)}/artifacts`).then((j) => {
      if (!alive) return;
      if (!Array.isArray(j.artifacts)) throw new Error('材料清单尚未返回。');
      const raw = j.artifacts as Array<Record<string, unknown>>;
      const list = summarizeArtifacts(raw).rows.map((row, i) => ({ ...row, name: materialName(raw[i]) }));
      setRows(list);
      setPositions((old) => Object.fromEntries(list.map((item, i) => [item.artifactId, old[item.artifactId] ?? gridPoint(i)])));
      void Promise.all(list.map(async (row) => row.name === materialKindName('document')
        ? { ...row, name: await registeredName(client, customerId, row.artifactId) ?? row.name }
        : row)).then((named) => { if (alive) setRows(named); });
    }).catch(() => { if (alive) setError('暂时无法读取材料。请重试；此处不会用空清单替代读取失败。'); });
    return () => { alive = false; };
  }, [client, customerId, reload, wb.snapshotVersion]);
  useEffect(() => {
    if (!client) return;
    const map = layouts.get(client) ?? new Map(); map.set(customerId, positions); layouts.set(client, map);
  }, [client, customerId, positions]);
  const isAnalysis = (row: Material) => row.kind.replace(/^material\./, '') === 'parse_extraction';
  const originals = (rows ?? []).filter((row) => !isAnalysis(row));
  const filtered = (rows ?? []).filter((row) => (filter === 'analysis' ? isAnalysis(row) : !isAnalysis(row) && (filter === 'all' || (filter === 'current' ? row.current : !row.current))) && `${row.name} ${row.period ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups: Material[][] = [];
  for (const row of filtered) {
    const point = positions[row.artifactId]; if (!point) continue;
    const matches = groups.filter(group => group.some(item => { const other = positions[item.artifactId]; return Math.abs(point.x - other.x) < 220 && Math.abs(point.y - other.y) < 160; }));
    if (!matches.length) groups.push([row]);
    else { const joined = [row, ...matches.flat()]; for (const match of matches) groups.splice(groups.indexOf(match), 1); groups.push(joined); }
  }
  const selectedGroup = groups.find(group => group.length > 1 && group.some(row => row.artifactId === selected));
  const height = Math.max(1000, ...Object.values(positions).map((p) => p.y + 260));
  const width = Math.max(1420, ...Object.values(positions).map((p) => p.x + 320));
  function remember(before = positionsRef.current) { setUndo((stack) => [...stack, before].slice(-20)); }
  function move(id: string, point: Point) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    setPositions((old) => ({ ...old, [id]: { x: Math.max(0, Math.min(7000, point.x)), y: Math.max(0, Math.min(7000, point.y)) } }));
  }
  function physicalScale() { const el = viewport.current; const scale = el && el.clientWidth ? el.getBoundingClientRect().width / el.clientWidth : 1; return scale > 0 ? scale : 1; }
  function focusMaterial(id: string) {
    setSelected(id); const p = positions[id]; const el = viewport.current;
    if (p && el) { el.scrollLeft = Math.max(0, p.x * zoom - el.clientWidth / 2 + 145 * zoom); el.scrollTop = Math.max(0, p.y * zoom - el.clientHeight / 2 + 100 * zoom); }
  }
  function changeZoom(next: number) {
    const value = Math.max(0.4, Math.min(1.8, +next.toFixed(2))); const el = viewport.current;
    if (el) { const x = (el.scrollLeft + el.clientWidth / 2) / zoom; const y = (el.scrollTop + el.clientHeight / 2) / zoom; requestAnimationFrame(() => { el.scrollLeft = Math.max(0, x * value - el.clientWidth / 2); el.scrollTop = Math.max(0, y * value - el.clientHeight / 2); }); }
    setZoom(value);
  }
  return <section className={`tk-materials-desk${libraryCollapsed ? ' library-collapsed' : ''}`} aria-label="材料全景工作台">
    <div className="tk-library-container"><button className="tk-edge-toggle" aria-label={libraryCollapsed ? '展开材料清单' : '收起材料清单'} aria-expanded={!libraryCollapsed} onClick={() => setLibraryCollapsed(v => !v)}>{libraryCollapsed ? '›' : '‹'}</button><aside className="tk-material-library" hidden={libraryCollapsed}>
      <div className="tk-library-title"><span className="tk-section-kicker">客户资料</span><h2>材料原件<span>{rows ? originals.length : '—'}</span></h2></div>
      <label className="tk-field-search"><UiIcon name="search" size={20}/><input aria-label="搜索材料" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索材料名称或期间"/></label>
      <div className="tk-segments" aria-label="材料版本筛选">{(['all','current','history','analysis'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({ all: '原件', current: '现行', history: '历史', analysis: '分析记录' })[value]}</button>)}</div>
      <div className="tk-material-list" aria-label="材料清单">
        {error && <div role="alert">{error}<button className="tk-btn" onClick={() => setReload((n) => n + 1)}>重新读取</button></div>}
        {!rows && !error && <p className="tk-empty">正在读取材料…</p>}
        {rows && !filtered.length && <p className="tk-empty">{rows.length ? '没有符合条件的材料' : '还没有材料。上传第一份资料，开始办理。'}</p>}
        {filtered.map((row) => <button className="tk-material-listitem" aria-pressed={selected === row.artifactId} key={row.artifactId} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-jw-artifact', row.artifactId); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => focusMaterial(row.artifactId)}>
          <span className="tk-file-icon"><MaterialObject kind={row.kind} name={row.name} size={44}/></span><span><strong>{row.name}</strong><small>{row.period ?? '期间未标注'} · {row.current ? '现行材料' : '历史材料'}</small></span><UiIcon name="arrow" size={17}/>
        </button>)}
      </div>
      <button className="tk-btn primary tk-upload-entry" onClick={onUpload}><ObjectIcon name="materials" size={34}/>上传与补充材料</button>
    </aside></div>
    <div className="tk-desk-main">
      <header className="tk-desk-toolbar"><div><h2>把资料，放在一起看。</h2><p>拖动卡片自由整理 · 拖动空白处平移</p></div><div className="tk-canvas-controls">
        <button aria-label="缩小材料" onClick={() => changeZoom(zoom - 0.1)}>−</button><output aria-label="材料缩放比例">{Math.round(zoom * 100)}%</output><button aria-label="放大材料" onClick={() => changeZoom(zoom + 0.1)}>＋</button>
        <span className="tk-control-divider"/><button onClick={() => { changeZoom(Math.min(1, (viewport.current?.clientWidth ?? 1300) / width, (viewport.current?.clientHeight ?? 700) / height)); }}>适合窗口</button>
        <button disabled={!undo.length} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { setPositions(previous); setUndo((stack) => stack.slice(0, -1)); setNotice('已撤销上次摆放。'); } }}>撤销</button>
        <button onClick={() => { remember(); setPositions(Object.fromEntries((rows ?? []).map((row, i) => [row.artifactId, gridPoint(i)]))); setZoom(1); if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } setNotice('材料已整齐排列，可撤销。'); }}>整理排列</button>
      </div></header>
      {selectedGroup && <div className="tk-group-tools" aria-label="材料组合"><strong>组合 · {selectedGroup.length} 份材料</strong><button className="tk-btn small" onClick={() => { remember(); const base = positions[selectedGroup[0].artifactId]; selectedGroup.forEach((row, index) => move(row.artifactId, {x:base.x + index * 310, y:base.y})); setNotice('已分离组合，原件保留。'); }}>分离材料</button><span>组合分析待接通指定材料接口</span></div>}
      <div className="tk-desk-viewport" ref={viewport} aria-label="可缩放的材料画布" tabIndex={0}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('application/x-jw-artifact'); if (!rows?.some((r) => r.artifactId === id)) return; const el = viewport.current!; const rect = el.getBoundingClientRect(); const scale = physicalScale(); remember(); move(id, { x: ((e.clientX - rect.left) / scale + el.scrollLeft) / zoom - 140, y: ((e.clientY - rect.top) / scale + el.scrollTop) / zoom - 40 }); setSelected(id); setNotice('已摆放材料，原件及业务状态未改变。'); }}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.tk-paper-card') || e.button !== 0) return; pan.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (!pan.current) return; e.currentTarget.scrollLeft = pan.current.left - (e.clientX - pan.current.x) / physicalScale(); e.currentTarget.scrollTop = pan.current.top - (e.clientY - pan.current.y) / physicalScale(); }}
        onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
        <div style={{ width: width * zoom, height: height * zoom, position: 'relative' }}><div className="tk-desk-world" style={{ width, height, transform: `scale(${zoom})` }}>
          {groups.filter(group => group.length > 1).map(group => { const points = group.map(row => positions[row.artifactId]); const x = Math.min(...points.map(p => p.x)) - 24, y = Math.min(...points.map(p => p.y)) - 24; return <div key={group.map(row => row.artifactId).sort().join(':')} className="tk-material-group" aria-label={`材料组合：${group.map(row => row.name).join('、')}`} style={{left:x,top:y,width:Math.max(...points.map(p => p.x)) - x + 310,height:Math.max(...points.map(p => p.y)) - y + 250}}><span>{group.length} 份材料</span></div>; })}
          {filtered.map((row) => { const p = positions[row.artifactId] ?? gridPoint(0); return <article className={`tk-paper-card${selected === row.artifactId ? ' selected' : ''}`} style={{ left: p.x, top: p.y }} key={row.artifactId} tabIndex={0} aria-label={`材料卡片：${row.name}`} data-x={p.x} data-y={p.y}
            onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button') || e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { id: row.artifactId, start: { x: e.clientX, y: e.clientY }, point: p, before: positionsRef.current }; setSelected(row.artifactId); }}
            onPointerMove={(e) => { const d = drag.current; if (!d || d.id !== row.artifactId) return; move(d.id, { x: d.point.x + (e.clientX - d.start.x) / zoom / physicalScale(), y: d.point.y + (e.clientY - d.start.y) / zoom / physicalScale() }); }}
            onPointerUp={() => { const d = drag.current; if (d) { remember(d.before); setNotice('已摆放材料，原件及业务状态未改变。'); } drag.current = null; }}
            onPointerCancel={() => { if (drag.current) setPositions(drag.current.before); drag.current = null; }}
            onDoubleClick={() => setPreview(row)}
            onKeyDown={(e) => { if (e.target !== e.currentTarget) return; const delta: Record<string, Point> = { ArrowLeft: {x:-20,y:0}, ArrowRight: {x:20,y:0}, ArrowUp: {x:0,y:-20}, ArrowDown: {x:0,y:20} }; if (delta[e.key]) { e.preventDefault(); remember(); move(row.artifactId, { x: p.x + delta[e.key].x, y: p.y + delta[e.key].y }); } if (e.key === 'Enter') setPreview(row); }}>
            <div className="tk-paper-head"><MaterialObject kind={row.kind} name={row.name} size={48}/><span className={`tk-material-version${row.current ? '' : ' historical'}`}>{row.current ? '现行' : '历史'}</span><span className="tk-drag-handle" aria-hidden="true">⠿</span></div>
            <h3>{row.name}</h3><p>{row.period ?? '期间未标注'}<br/>{row.grade === 'verified' ? '核验已记录' : '核验状态以办理记录为准'}</p>
            <footer><button onClick={() => setPreview(row)}>查看原件 <UiIcon name="arrow" size={16}/></button></footer>
          </article>; })}
        </div></div>
      </div>
      <footer className="tk-desk-status"><span role="status">{notice}</span><span>个人阅读布局 · 不改变材料归属或业务状态</span></footer>
    </div>
    {preview && <MaterialPreview key={preview.artifactId} wb={wb} customerId={customerId} material={preview} onClose={() => setPreview(null)}/>}
  </section>;
}

function MaterialPreview({ wb, customerId, material, onClose }: { wb: WbApi; customerId: string; material: Material; onClose: () => void }) {
  const [data, setData] = useState<{ name: string; text?: string; url?: string; mime?: string; bytes?: Uint8Array; imageUrl?: string } | null>(null);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true; let objectUrl: string | null = null;
    const previous = document.activeElement as HTMLElement | null; close.current?.focus();
    void wb.client?.artifactContent(customerId, material.artifactId).then(async (j) => {
      if (!alive) return;
      const art = j.artifact as { materialFile?: { name?: string; mime?: string; data?: string }; content?: unknown } | undefined;
      if (!art) throw new Error('未返回原件。');
      const file = art.materialFile;
      if (file?.data) {
        const bytes = base64ToBytes(file.data); const mime = sniffImageMime(bytes) ?? file.mime ?? 'application/octet-stream';
        const buffer = new Uint8Array(bytes).buffer;
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
        setData({ name: file.name ?? material.name, url: objectUrl, mime, bytes, imageUrl: mime.startsWith('image/') ? `data:${mime};base64,${file.data}` : undefined, ...(mime.startsWith('text/') || mime === 'application/json' ? { text: new TextDecoder().decode(bytes) } : {}) });
      } else {
        const content = art.content as { text?: unknown; connectorRef?: { customerId?: string; evidenceId?: string } } | null;
        const ref = content?.connectorRef;
        if (ref?.evidenceId) {
          if (ref.customerId !== customerId || !wb.client) throw new Error('原件不属于当前客户。');
          const preview = await wb.client.channelPreview(ref.evidenceId, customerId);
          if (!alive) return;
          if (typeof preview.downloadUrl !== 'string' || !preview.downloadUrl) throw new Error('原件暂不可读。');
          const path = preview.downloadUrl.startsWith('/') ? `/api/jw/v2/connectors${preview.downloadUrl}` : preview.downloadUrl;
          const result = await wb.client.fetchChannelObject(path);
          if (!alive) return;
          if (result.status !== 200) throw new Error('原件暂不可读。');
          const formatMime: Record<string, string> = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', tsv: 'text/tab-separated-values', text: 'text/plain', utf8: 'text/plain', json: 'application/json' };
          const mime = sniffImageMime(result.bytes) ?? formatMime[String(preview.format)] ?? result.contentType.split(';')[0];
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes).buffer], { type: mime }));
          setData({ name: material.name, url: objectUrl, mime, bytes: result.bytes, imageUrl: mime.startsWith('image/') ? `data:${mime};base64,${bytesToBase64(result.bytes)}` : undefined, ...(mime.startsWith('text/') || mime === 'application/json' ? { text: new TextDecoder().decode(result.bytes) } : {}) });
        } else setData({ name: material.name, text: typeof content?.text === 'string' ? content.text : '此记录没有可预览的原件文件。' });
      }
    }).catch(() => { if (alive) setError('原件暂时不可读，请核对权限或稍后再试。'); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); previous?.focus(); };
  }, [wb.client, customerId, material.artifactId]);
  return <div className="tk-preview-veil" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const nodes = e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],iframe,summary'); const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}>
    <section className="tk-original-preview" role="dialog" aria-modal="true" aria-label={`原件：${material.name}`}>
      <header><span className="tk-file-icon"><MaterialObject kind={material.kind} name={material.name} size={44}/></span><div><h2>{data?.name ?? material.name}</h2><p>{material.current ? '现行材料' : '历史材料'} · {data?.url ? '原件' : '材料记录'}</p></div><div className="tk-canvas-controls"><button aria-label="缩小原件" onClick={() => setScale((n) => Math.max(0.5, n - 0.2))}>−</button><output>{Math.round(scale * 100)}%</output><button aria-label="放大原件" onClick={() => setScale((n) => Math.min(3, n + 0.2))}>＋</button></div>{data?.url && <a className="tk-btn" href={data.url} download={data.name}>下载</a>}<button ref={close} className="tk-icon-button" aria-label="关闭原件预览" onClick={onClose}><UiIcon name="close"/></button></header>
      <div className="tk-original-content">{error ? <p role="alert">{error}</p> : !data ? <p>正在读取原件…</p> : <div style={{ zoom: scale }}>
        {data.text !== undefined ? <pre>{data.text}</pre> : data.mime && /^image\/(png|jpeg|webp|gif|bmp)$/.test(data.mime) ? <img alt={data.name} src={data.imageUrl}/> : data.mime === 'application/pdf' && data.bytes ? <PdfOriginal bytes={data.bytes} name={data.name}/> : <p>此文件格式请下载后查看；原件保持不变。</p>}
      </div>}</div>
    </section>
  </div>;
}
