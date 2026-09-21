import { TakeoffBoard } from '../takeoff/takeoff-board';
import { deriveTakeoffCells, type TakeoffSource } from '../../lib/workbench/takeoff-projection';
import { readTakeoffSource } from '../../lib/workbench/takeoff-source';
import { useEffect, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import type { DirectoryCustomer } from '../../lib/workbench/wb-client';
import { RoleLogo, UiIcon } from '../takeoff/ui-icons';
import { projectColumnReceipts } from '../takeoff/column-projection';
import type { ColumnReceipt } from '../../lib/workbench/advance-client';
import { DEMO_CASES } from '../../lib/workbench/demo-cases';

export function CustomerDirectory({ wb, onOpen }: { wb: WbApi; onOpen: (id: string) => void }) {
  const [cases, setCases] = useState<Record<string, { customer?: DirectoryCustomer; note?: string; source?: TakeoffSource; rounds?:ColumnReceipt[]; progressError?: boolean }>>({});
  const [items,setItems]=useState<Array<{name:string;scenario:string;runtimeDisplayName:string}>>(DEMO_CASES.map(c=>({name:c.name,scenario:c.scenario,runtimeDisplayName:c.runtimeDisplayName})));
  const [caseReload, setCaseReload] = useState(0);
  useEffect(() => {
    let active = true; setCases({});
    async function load(){
    if(wb.client){
      try{
        const manifest=await wb.client.read('/api/jw/v2/arrow-cases');
        if(!Array.isArray(manifest.cases))throw new Error('案例映射无效');
        const entries=manifest.cases as Array<{caseId:string;customerId:string;displayName:string;scenarioLabel:string;sourceMode:string}>;
        const keys=['parallel-v1-good','parallel-v1-medium','parallel-v1-bad'];
        const ordered=keys.map(key=>entries.find(e=>e.caseId===key));
        if(ordered.some(e=>!e?.customerId||e.sourceMode!=='synthetic'))throw new Error('案例映射缺失');
        if(!active)return;
        setItems(ordered.map(e=>({name:e!.displayName,scenario:e!.scenarioLabel as '好'|'中'|'差',runtimeDisplayName:e!.displayName})));
        for(const e of ordered){
          const entry={customer:{customerId:e!.customerId,displayName:e!.displayName}};
          setCases(old=>({...old,[e!.displayName]:entry}));
          try{const snapshot=(await wb.client.workspace(e!.customerId)).snapshot as TakeoffSource['snapshot'];
            const source=await readTakeoffSource(wb.client,e!.customerId,snapshot);
            const rounds=await wb.client.advance.history(e!.customerId);
            if(active)setCases(old=>({...old,[e!.displayName]:{...entry,source,rounds}}));
          }catch{if(active)setCases(old=>({...old,[e!.displayName]:{...entry,progressError:true}}));}
        }
        return;
      }catch(e){if((e as {status?:number}).status!==404){if(active)setCases({manifest:{note:'案例映射读取失败'}});return;}}
    }
    for (const item of DEMO_CASES) {
      void wb.client?.directory(item.name).then(async (result) => {
        if (!active) return;
        const matches = result.kind === 'ok' ? result.customers.filter((customer) =>
          customer.displayName === item.name || customer.displayName === item.runtimeDisplayName) : [];
        const entry = result.kind !== 'ok' ? { note: '暂时无法读取' } : matches.length === 1 && !result.nextCursor ? { customer: matches[0] } : { note: matches.length > 1 || result.nextCursor ? '客户记录需核对' : '尚未接入' };
        setCases((old) => ({ ...old, [item.name]: entry }));
        if ('customer' in entry && entry.customer && wb.client) {
          try {
            const value = await wb.client.workspace(entry.customer.customerId);
            const snapshot = value.snapshot as TakeoffSource['snapshot'];
            if (snapshot?.customer?.customerId !== entry.customer.customerId) throw new Error('Customer mismatch');
            const source = await readTakeoffSource(wb.client, entry.customer.customerId, snapshot);
            if (active) setCases(old => ({...old,[item.name]:{...entry,source}}));
          } catch { if (active) setCases(old => ({...old,[item.name]:{...entry,progressError:true}})); }
        }
      }).catch(() => { if (active) setCases((old) => ({ ...old, [item.name]: { note: '暂时无法读取' } })); });
    }
    }
    void load();
    return () => { active = false; };
  }, [wb.client, caseReload]);
  const failed = Object.values(cases).some(entry => entry.note || entry.progressError);
  return <main className="tk-root tk-directory tk-case-picker">
    <header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong>
      <button className="tk-picker-role" aria-label="切换角色" title="切换角色" onClick={wb.logout}><RoleLogo role={wb.session?.roles[0] ?? 'business'} size={54}/></button>
    </header>
    <section className="tk-picker-content" aria-label="好中差三客户">
      <div className="tk-picker-grid">{items.map((item,index) => {
        const entry = cases[item.name];
        return <div role="button" tabIndex={entry?.customer ? 0 : -1} key={item.name} className={`tk-picker-card ${['good','middle','poor'][index]}`} aria-label={`${item.scenario}客户：${item.name}${entry?.customer ? '' : `，${entry?.note ?? '正在连接'}`}`} aria-disabled={!entry?.customer} onKeyDown={e=>{if(entry?.customer && (e.key==='Enter'||e.key===' ')){e.preventDefault();onOpen(entry.customer.customerId);}}} onClick={() => entry?.customer && onOpen(entry.customer.customerId)}>
          <span className="tk-picker-grade">{item.scenario}</span>
          <div className="tk-picker-board">{entry?.source ? <TakeoffBoard cells={projectColumnReceipts(deriveTakeoffCells(entry.source),entry.rounds??[],entry.customer?.customerId??'')} selected={null} readOnly onSelect={()=>{}}/> : <span className="tk-picker-note">{entry?.progressError ? '进度暂时不可读' : '正在读取进度…'}</span>}</div>
          <span className="tk-picker-name">{item.name}</span>
          {!entry?.customer && <span className="tk-picker-note">{entry?.note ?? '正在连接…'}</span>}
        </div>;
      })}</div>
      <span className="tk-picker-caption">合成演练</span>
      {(failed || wb.error) && <p role="alert">客户暂时无法打开。<button className="tk-btn small ghost" onClick={()=>{wb.setError(null);setCaseReload(n=>n+1);}}>重试</button></p>}
    </section>
  </main>;
}

