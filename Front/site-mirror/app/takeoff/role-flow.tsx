import type { ColumnReceipt } from '../../lib/workbench/advance-client';
import { RoundDecision } from './round-decision';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { TAKEOFF_DOMAINS, type TakeoffCellView, type TakeoffTopSummary } from '../../lib/workbench/takeoff-projection';
import type { DecisionResponse } from '../../lib/workbench/decision-feedback';
import type { ModelAssistant } from '../../lib/workbench/takeoff-actions';
import { DecisionFeedbackPanel, type DecisionPanelActions } from './decision-feedback-panel';
import { RoleLogo, ObjectIcon } from './ui-icons';
import { StatusObject } from './status-object';
import { ConfidenceMeter } from './confidence-meter';
import { cellStatus } from './cell-status';
import './decision-tree.css';

type FlowTop = Pick<TakeoffTopSummary,'changedDomains'|'gateResult'>;
type Stage = 'input'|'analysis'|'human'|'closure';
const stages = [{id:'input',name:'材料',icon:'materials'},{id:'analysis',name:'分析',icon:'analysis'},{id:'human',name:'核验',icon:'verify'},{id:'closure',name:'办结',icon:'closure'}] as const;
const roleOf = (id:string):ModelAssistant => (id==='opportunity'?'business':id) as ModelAssistant;
type SetValue = DecisionResponse['latest'];

/** User controls the canvas position; server updates never pan or zoom it. */
export function RoleFlow({wb,cells,onSelect,stage='input',navigation=0,activeNodeId=null,activeDomain,round,demoSets,onDemoSelect}:{demoSets?:Record<string,SetValue>;onDemoSelect?:(domain:string,candidateId:string)=>void;round?:ColumnReceipt;activeDomain?:string;wb?:WbApi;cells:TakeoffCellView[];top:FlowTop;onSelect?:(cell:TakeoffCellView)=>void;stage?:Stage;navigation?:number;activeNodeId?:string|null}) {
 const [zoom,setZoom]=useState(.7), [role,setRole]=useState<ModelAssistant>(()=>roleOf(wb?.session?.roles.find(r=>['business','policy','credit','commerce','asset'].includes(r))??'business'));
 useEffect(()=>{if(activeDomain)setRole(roleOf(activeDomain));},[activeDomain]);
 const [remoteSets,setSets]=useState<Record<string,SetValue>>({});const sets=demoSets??remoteSets;
 const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
 const [inspected,setInspected]=useState<string|null>(null);
 const [offsets,setOffsets]=useState<Record<string,{x:number;y:number}>>({});
 const [portal,setPortal]=useState<HTMLElement|null>(null);
 const viewport=useRef<HTMLDivElement>(null);
 const drag=useRef<{id:string;x:number;y:number;ox:number;oy:number}|null>(null);
 const pan=useRef<{x:number;y:number;left:number;top:number}|null>(null);
 const actions=useRef<Partial<Record<ModelAssistant,DecisionPanelActions|null>>>({});
 useEffect(()=>{setPortal(document.getElementById('tk-decision-detail-slot'));const fit=()=>{const el=viewport.current;if(el?.clientWidth)setZoom(Math.min(.7,el.clientWidth/2580))};fit();window.addEventListener('resize',fit);return()=>window.removeEventListener('resize',fit);},[]);
 const receive=useCallback((id:string,value:SetValue)=>setSets(old=>old[id]===value?old:{...old,[id]:value}),[]);
 const scale=()=>{const el=viewport.current;return zoom*(el?.clientWidth?el.getBoundingClientRect().width/el.clientWidth:1);};
 const height=1800,width=2580;
 const point=(id:string,x:number,y:number)=>({x:x+(offsets[id]?.x??0),y:y+(offsets[id]?.y??0)});
 const edge=(x:number,y:number,tx:number,ty:number,dashed=false,key='',selected=false)=><path key={key} className={selected?'tk-path-selected':undefined} strokeDasharray={dashed&&!selected?'6 6':undefined} d={`M${x} ${y} C${x+80} ${y},${tx-80} ${ty},${tx} ${ty}`}/>;
 const grip=(id:string)=><span className="tk-tree-grip" aria-label="拖动节点" onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.currentTarget.setPointerCapture?.(e.pointerId);drag.current={id,x:e.clientX,y:e.clientY,ox:offsets[id]?.x??0,oy:offsets[id]?.y??0};}} onPointerMove={e=>{const d=drag.current;if(!d)return;setOffsets(old=>({...old,[d.id]:{x:Math.max(-35,Math.min(120,d.ox+(e.clientX-d.x)/scale())),y:Math.max(-30,Math.min(30,d.oy+(e.clientY-d.y)/scale()))}}));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>⠿</span>;
 const detail=sets[role]?.candidates.find(c=>c.id===inspected);
 const readingRound=!!round&&role===round.domain;
 const readers=demoSets?<div className="tk-unified-decision-detail"><strong>{detail?.label??'虚拟决策路径'}</strong><p>{detail?.impact??'点击分叉选择路径；黑色节点和实线表示已选择，灰色虚线表示未选择。'}</p><small>虚拟置信度 · 预设演示值，未经校准</small>{detail&&<ConfidenceMeter confidence={detail.confidence}/>}</div>:readingRound?<RoundDecision round={round}/>:<div className="tk-unified-decision-detail"><strong>{detail?.label??'当前决策'}</strong>{detail&&<><p>{detail.impact}</p><small>置信度为未校准模型估计，不是客户反应概率。</small></>}{wb&&TAKEOFF_DOMAINS.map(d=><DecisionReader key={d.id} wb={wb} role={roleOf(d.id)} active={role===roleOf(d.id)} receive={receive} actions={actions}/>)}</div>;
 return <section className="tk-flow-page tk-one-canvas" aria-label="横向决策树" data-active-domain={activeDomain}>
  <div className="tk-tree-tools"><span>当前{activeDomain==='opportunity'?'业务':TAKEOFF_DOMAINS.find(d=>d.id===activeDomain)?.name??'专业'}列 · 四阶段 · 拖动空白处平移</span></div>
  <div className="tk-tree-scroll" ref={viewport} aria-label="项目四阶段连续画布" onWheel={e=>{e.preventDefault();const el=e.currentTarget,rect=el.getBoundingClientRect(),displayScale=rect.width/el.clientWidth||1;const px=(e.clientX-rect.left)/displayScale,py=(e.clientY-rect.top)/displayScale;const x=(el.scrollLeft+px)/zoom,y=(el.scrollTop+py)/zoom;const next=Math.max(.3,Math.min(1.5,+(zoom+(e.deltaY<0?.1:-.1)).toFixed(1)));if(next===zoom)return;setZoom(next);requestAnimationFrame(()=>{el.scrollLeft=Math.max(0,x*next-px);el.scrollTop=Math.max(0,y*next-py);});}} onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button,article'))return;pan.current={x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};e.currentTarget.setPointerCapture?.(e.pointerId);}} onPointerMove={e=>{const p=pan.current;if(p){const s=scale()/zoom;e.currentTarget.scrollLeft=p.left-(e.clientX-p.x)/s;e.currentTarget.scrollTop=p.top-(e.clientY-p.y)/s;}}} onPointerUp={()=>{pan.current=null;}} onPointerCancel={()=>{pan.current=null;}}>
   <div style={{width:width*zoom,height:height*zoom}}><div className="tk-tree-world" style={{width,height,transform:`scale(${zoom})`}}>
    {stages.map((s,i)=><div className="tk-stage-band" key={s.id} style={{left:210+i*560,height}}><ObjectIcon name={s.icon} size={32}/><strong>{s.name}</strong></div>)}
    <article className="tk-project-origin" style={{left:20,top:770}}><ObjectIcon name="materials" size={42}/><strong>项目开始</strong></article>
    <svg className="tk-tree-lines" width={width} height={height} aria-label="项目起点与五专业四阶段分支"><g>{TAKEOFF_DOMAINS.map((d,lane)=>{
     const y=100+lane*320;const domainCells=stages.map(s=>cells.find(c=>c.domain===d.id&&c.row===s.id));const currentIndex=domainCells.findIndex(c=>!c?.completed);const index=demoSets?2:currentIndex<0?3:currentIndex;
     const set=round?.domain===roleOf(d.id)?null:sets[roleOf(d.id)];const candidates=set?.current&&set.valid&&!collapsed[d.id]?set.candidates.slice(0,3):[];
     return <g key={d.id}>{edge(130,810,230,y+90,false)}{stages.map((s,i)=>{const p=point(`${d.id}:${s.id}`,230+i*560,y+50);const prev=i?point(`${d.id}:${stages[i-1].id}`,230+(i-1)*560,y+50):null;return <g key={s.id}>{prev&&!((demoSets?!!domainCells[i-1]?.completed:i-1===index)&&candidates.length)&&edge(prev.x+145,prev.y+40,p.x,p.y+40,!domainCells[i-1]?.completed,'',!!domainCells[i-1]?.completed)}{prev&&(demoSets?!!domainCells[i-1]?.completed:i-1===index)&&candidates.map((c,k)=>{if(set?.feedback?.action!=='select'||!set.feedback.eventId||c.id!==set.feedback.candidateId)return null;const q=point(`${c.id}:${i-1}`,420+(i-1)*560,y+k*102);return edge(q.x+285,q.y+50,p.x,p.y+40,false,`chosen:${c.id}`,true);})}{(demoSets?!!domainCells[i]?.completed:i===index)&&candidates.map((c,k)=>{const q=point(`${c.id}:${i}`,p.x+190,y+k*102);return edge(p.x+145,p.y+40,q.x,q.y+50,true,c.id,!!set?.feedback?.eventId&&set.feedback.candidateId===c.id);})}</g>;})}</g>;
    })}</g></svg>
    {TAKEOFF_DOMAINS.map((d,lane)=>{const y=100+lane*320;const domainCells=stages.map(s=>cells.find(c=>c.domain===d.id&&c.row===s.id));const first=domainCells.findIndex(c=>!c?.completed);const index=demoSets?2:first<0?3:first;const r=roleOf(d.id),set=round?.domain===r?null:sets[r];const candidates=set?.current&&set.valid?set.candidates.slice(0,3):[];
     return <div key={d.id} className="tk-professional-branch" aria-label={`${d.name==='商机'?'业务':d.name}专业分支`}>
      <button className="tk-branch-role" style={{left:230,top:y-25}} onClick={()=>{setRole(r);setInspected(null);}} aria-pressed={role===r}><RoleLogo role={d.id} size={32}/>{d.name==='商机'?'业务':d.name}</button>
      {stages.map((s,i)=>{const p=point(`${d.id}:${s.id}`,230+i*560,y+50),cell=domainCells[i];return <article className={`tk-phase-node${activeNodeId===`${d.id}:${s.id}`?' tk-node-current':''}`} data-node-id={`${d.id}:${s.id}`} key={s.id} style={{left:p.x,top:p.y}}>{grip(`${d.id}:${s.id}`)}<button aria-label={`${d.name} · ${s.name}`} onClick={()=>{setRole(r);setInspected(null);if(cell)onSelect?.(cell);}}><StatusObject kind={cell?cellStatus(cell,cells).icon:'lock'} size={40}/><span>{s.name}</span>{activeNodeId===`${d.id}:${s.id}`&&<small>{cell?cellStatus(cell,cells).label:'尚未开始'}</small>}</button>{i===index&&<button className="tk-branch-toggle" aria-label={`${collapsed[d.id]?'展开':'收起'}${d.name}候选分支`} aria-expanded={!collapsed[d.id]} onClick={()=>setCollapsed(old=>({...old,[d.id]:!old[d.id]}))}>{collapsed[d.id]?'＋':'−'}</button>}</article>;})}
      {!collapsed[d.id]&&(candidates.length?(demoSets?stages.map((_,i)=>i).filter(i=>domainCells[i]?.completed):[index]).flatMap(branchIndex=>candidates.map((c,k)=>{const branchKey=`${c.id}:${branchIndex}`;const p=point(branchKey,420+branchIndex*560,y+k*102);const tied=c.confidence!==null&&candidates.some(other=>other.id!==c.id&&other.confidence!==null&&Math.round(other.confidence*100)===Math.round(c.confidence!*100));return <article key={branchKey} data-decision-stage={stages[branchIndex].id} className={`tk-branch-choice${set?.feedback?.action==='select'&&!!set.feedback.eventId&&set.feedback.candidateId===c.id?' recorded':''}`} style={{left:p.x,top:p.y}}>{grip(branchKey)}<button aria-pressed={set?.feedback?.action==='select'&&!!set.feedback.eventId&&set.feedback.candidateId===c.id} onClick={()=>{setRole(r);setInspected(c.id);onDemoSelect?.(r,c.id);}} onDoubleClick={()=>actions.current[r]?.selectCandidate(c.id)}><strong>{String.fromCharCode(65+k)} · {c.label}</strong><span className="tk-confidence-logic">{c.impact}</span><ConfidenceMeter confidence={c.confidence} tied={tied}/>{set?.feedback?.action==='select'&&!!set.feedback.eventId&&set.feedback.candidateId===c.id&&<small>已选择</small>}</button></article>;})):<span className="tk-branch-pending" style={{left:425+index*560,top:y+70}}>等待有效候选</span>)}
     </div>;
    })}
   </div></div>
  </div>
  {portal?createPortal(readers,portal):readers}
 </section>;
}
function DecisionReader({wb,role,active,receive,actions}:{wb:WbApi;role:ModelAssistant;active:boolean;receive:(role:string,value:SetValue)=>void;actions:React.MutableRefObject<Partial<Record<ModelAssistant,DecisionPanelActions|null>>>}) {
 const callback=useCallback((value:SetValue)=>receive(role,value),[role,receive]);
 return <div hidden={!active}><DecisionFeedbackPanel wb={wb} assistant={role} onStateChange={callback} actionsRef={value=>{actions.current[role]=value;}}/></div>;
}
