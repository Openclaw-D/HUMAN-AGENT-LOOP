import { useCallback, useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { UiIcon, ObjectIcon } from './ui-icons';

const eventNames: Record<string,string> = { artifact_processing_updated:'材料处理进展已更新', assessment_basis_revised:'评估依据已更新', assessment_candidate_ready:'建议方案已生成', assessment_submitted_for_review:'已提交人工复核', customer_created:'客户已建档', customer_grant_created:'客户授权已登记', relationship_declared:'客户关系已登记', artifact_registered:'收到一份材料', artifact_superseded:'材料已更新', assessment_created:'开始预评估', assessment_candidate:'建议方案已更新', assessment_submitted:'提交人工复核', assessment_decided:'预评估已结束', domain_result_recorded:'专业意见已登记', package_frozen:'本轮依据已保留', ADMISSION_REQUEST_UPDATED:'客户需求已更新', admission_request_updated:'客户需求已更新', preassessment_confirmed:'预评估结论已确认' };
interface TimelineEvent { id:string; type:string; at:string|null; seq:string; summary:string|null; actor:string|null }
function category(type:string): 'materials'|'analysis'|'human'|'other' { return /artifact|evidence|material/i.test(type) ? 'materials' : /analysis|candidate|model|domain_result|package/i.test(type) ? 'analysis' : /confirm|decid|review|admission|grant/i.test(type) ? 'human' : 'other'; }
const icons: Record<string,string> = { materials:'materials',analysis:'analysis',human:'verify',other:'business' };

export function WorkTimeline({ wb, customerId }: { wb:WbApi; customerId:string }) {
  const [events,setEvents]=useState<TimelineEvent[]>([]);
  const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [cursor,setCursor]=useState<string|null>('0'); const [hasMore,setHasMore]=useState(false);
  const [filter,setFilter]=useState('all'); const [query,setQuery]=useState('');
  const epoch=useRef(0); const lock=useRef(false); const end=useRef<HTMLDivElement>(null);
  const load=useCallback(async (after:string,append:boolean,untilLatest=false) => {
    if (!wb.client || lock.current) return;
    const generation=epoch.current; lock.current=true; setLoading(true); setError('');
    try {
      let next:string|null=after; let more=false; let received:TimelineEvent[]=[]; let pages=0;
      do {
        const page=await wb.client.eventsPage(customerId,next ?? '0',200);
        if (generation!==epoch.current) return;
        const batch=(page.events ?? []).map((e) => { const p=(e.payload && typeof e.payload==='object' ? e.payload : {}) as Record<string,unknown>; return { id:e.eventId,type:(e.payloadRef?.type ?? 'unknown').toLowerCase(),at:typeof e.occurredAt==='string'?e.occurredAt:typeof p.at==='string'?p.at:typeof p.occurredAt==='string'?p.occurredAt:null,seq:e.aggregateVersion,summary:typeof p.summary==='string'?p.summary:null,actor:typeof p.actorRole==='string'?p.actorRole:null }; });
        received=[...received,...batch]; more=page.hasMore;
        if(more && (!page.nextAfterSeq || page.nextAfterSeq===next)) throw new Error('记录游标未前移，请稍后重试。');
        next=page.nextAfterSeq; pages++;
      } while(untilLatest && more && pages<20);
      setEvents((old) => { const map=new Map((append?old:[]).map((e)=>[e.id,e])); received.forEach((e)=>map.set(e.id,e)); return [...map.values()]; });
      setCursor(next);setHasMore(more);
      if(untilLatest && more) setError('已继续加载 4000 条记录；点击继续加载可查看剩余记录。');
      if(untilLatest) requestAnimationFrame(()=>end.current?.scrollIntoView({block:'end',behavior:'smooth'}));
    } catch(e) { if(generation===epoch.current)setError((e as Error).message || '办理记录暂时不可读，请重试。'); }
    finally{ if(generation===epoch.current){lock.current=false;setLoading(false);} }
  },[wb.client,customerId]);
  useEffect(()=>{ epoch.current++;lock.current=false;setEvents([]);setCursor('0');setHasMore(false);void load('0',false);return()=>{epoch.current++;};},[load]);
  const visible=events.filter((e)=>(filter==='all'||category(e.type)===filter)&&`${eventNames[e.type]??e.type} ${e.summary??''}`.includes(query.trim()));
  return <section className="tk-timeline-page" aria-label="记录（从早到晚时间轴）">
    <header className="tk-view-heading"><div><span className="tk-section-kicker">办理记录</span><h1>每一步，都有来处。</h1><p>从最早到最新，沿时间查看材料、专业意见与人工决定。</p></div><button className="tk-btn" disabled={loading} onClick={()=>hasMore&&cursor?void load(cursor,true,true):end.current?.scrollIntoView({block:'nearest',behavior:'smooth'})}>定位最新 <UiIcon name="timeline" size={20}/></button></header>
    <div className="tk-timeline-layout"><aside className="tk-timeline-filter"><h3>查看哪些记录</h3>{[['all','全部记录'],['materials','材料与证据'],['analysis','分析与方案'],['human','人工办理']].map(([id,name])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{id === 'all' ? <UiIcon name="timeline" size={23}/> : <ObjectIcon name={icons[id]} size={32}/>}{name}<span>{id==='all'?events.length:events.filter(e=>category(e.type)===id).length}</span></button>)}<p>数量仅包含已加载记录。<br/>历史不被下一次办理覆盖。</p></aside>
      <div className="tk-timeline-stream"><label className="tk-field-search"><UiIcon name="search" size={20}/><input aria-label="搜索办理记录" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索材料、方案或办理事项"/></label>
        {error&&<p role="alert">{error} <button className="tk-btn small" onClick={()=>void load(cursor??'0',events.length>0)}>重试</button></p>}
        {!visible.length&&!error&&<div className="tk-empty"><UiIcon name="timeline" size={40}/><h3>{loading?'正在读取办理记录…':'暂无符合条件的记录'}</h3><p>{events.length?'试试其他关键词，或切换到全部记录。':'实际办理发生后，服务端记录会在这里出现。'}</p></div>}
        <ol className="tk-timeline-events">{visible.map((event,i)=>{const validDate=event.at && !Number.isNaN(Date.parse(event.at));const day=validDate?new Date(event.at!).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'}):'日期未记录';const prior=visible[i-1]?.at;const sameDay=validDate&&prior&&new Date(prior).toDateString()===new Date(event.at!).toDateString();return <li key={event.id}>
          {!sameDay&&<div className="tk-timeline-date">{day}</div>}
          <div className="tk-timeline-event"><time>{validDate?new Date(event.at!).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'时间未知'}</time><span className="tk-timeline-dot"><ObjectIcon name={icons[category(event.type)]} size={32}/></span><article><span className="tk-event-category">{({materials:'材料与证据',analysis:'分析与方案',human:'人工办理',other:'客户协作'})[category(event.type)]}</span><h3>{eventNames[event.type]??'办理事件已记录'}</h3>{event.summary&&<p>{event.summary}</p>}{event.actor&&<p>办理角色：{({business:'业务',policy:'政策',credit:'信审',commerce:'商务',asset:'资产',customer:'客户'} as Record<string,string>)[event.actor] ?? '协作成员'}</p>}</article></div>
        </li>;})}</ol>
        {hasMore&&<button className="tk-btn tk-load-history" disabled={loading} onClick={()=>cursor&&void load(cursor,true)}>{loading?'正在读取…':'继续加载记录'}</button>}
        {!!events.length&&!hasMore&&<div className="tk-timeline-end">已到本次读取的最新记录</div>}<div ref={end}/>
      </div>
    </div>
  </section>;
}
