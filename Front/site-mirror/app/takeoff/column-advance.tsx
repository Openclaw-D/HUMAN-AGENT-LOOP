import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { unsettled, type ColumnReceipt, type RequiredDecision } from '../../lib/workbench/advance-client';
import { UiIcon } from './ui-icons';

const domains=['business','policy','credit','commerce','asset'];
export function nextRequired(rows:ColumnReceipt[],exclude?:string){
 const todo=rows[0]?.needsReselection;
 if(!todo)return undefined;
 return domains.find(d=>d!==exclude&&rows.some(r=>r.domain===d&&r.current&&(r.state==='waiting_evidence'||todo.some(x=>x.domain===d&&x.roundId===r.roundId&&r.state==='awaiting_confirmation'))));
}
const names:Record<string,string>={business:'业务',policy:'政策',credit:'信审',commerce:'商务',asset:'资产'};
export const receiptLabels:Record<string,string>={accepted:'已受理',running:'处理中',completed:'本列完成',waiting_evidence:'等待补证',awaiting_confirmation:'等待人工确认',needs_reassessment:'待重评',rejected:'已拒绝',failed:'失败',unknown:'结果核对中'};
export function columnComplete(r:ColumnReceipt|undefined){return !!r&&r.current===true&&r.state==='completed'&&['materials','analysis','verification','completion'].every(id=>r.columnResults.some(x=>x.itemId===id&&x.state==='completed'));}
function message(e:unknown){const p=e as {status?:number;message?:string};return [404,405,501,503].includes(p.status??0)?'本列服务暂未接通':p.status===403?'当前身份无本列办理权限':p.message||'暂时无法核对服务端结果';}
/** One arrow, one server plan. Recovery only reads the persisted request. */
export function ColumnAdvance({wb,customerId,domain,onDomain,onReceipts}:{wb:WbApi;customerId:string;domain:string;onDomain:(domain:string)=>void;onReceipts:(receipts:ColumnReceipt[])=>void}){
 const api=wb.client?.advance;
 const scope=`${wb.session?.sessionId}:${customerId}`;
 const key=`jw:column-advance:pending:${customerId}`;
 const live=useRef(scope);live.current=scope;
 const mounted=useRef(false),busy=useRef(false),rows=useRef<ColumnReceipt[]>([]),signature=useRef('');
 const latest=useRef({wb,onReceipts,onDomain});latest.current={wb,onReceipts,onDomain};
 const [working,setWorking]=useState(false),[note,setNote]=useState('正在核对办理进度…');
 const [tick,setTick]=useState(0);
 const active=()=>mounted.current&&live.current===scope;
 async function publish(next:ColumnReceipt[]){
  if(!active())return;
  rows.current=next;
  const hash=JSON.stringify(next);
  if(hash!==signature.current){signature.current=hash;latest.current.onReceipts(next);await latest.current.wb.refresh();}
 }
 useEffect(()=>{const changed=(e:Event)=>{const d=(e as CustomEvent).detail;if(d?.customerId===customerId){setTick(n=>n+1);if(d.domain)latest.current.onDomain(d.domain);}};window.addEventListener('jw:round-supplement',changed);return()=>window.removeEventListener('jw:round-supplement',changed);},[customerId]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let cancelled=false;let timer:ReturnType<typeof setTimeout>|undefined;
  if(!api){setNote('本列服务暂未接通');return;}
  async function read(){
   if(cancelled||!active()||!api)return;
   if(busy.current){timer=setTimeout(read,2000);return;}
   try{
    const pending=localStorage.getItem(key);
    const server=await api.active(customerId);
    const recovered=pending?await api.recover(customerId,pending):server;
    if(cancelled||!active())return;
    const history=await api.history(customerId);
    if(cancelled||!active())return;
    if(busy.current){timer=setTimeout(read,2000);return;}
    const merged=new Map(history.map(r=>[r.roundId,r]));if(recovered&&!history.length)merged.set(recovered.roundId,recovered);
    await publish([...merged.values()]);
    if(cancelled||!active())return;
    const decisionPending=localStorage.getItem(`${key}:decision`);
    const selectionReady=!decisionPending||!!(recovered?.selection?.eventId&&recovered.selection.candidateId===JSON.parse(decisionPending).resultId&&recovered.selection.decision===JSON.parse(decisionPending).decision);
    const unresolved=(pending&&(!recovered||unsettled(recovered)||!selectionReady))||(server&&unsettled(server));
    if(pending&&recovered&&!unsettled(recovered)&&selectionReady){localStorage.removeItem(key);localStorage.removeItem(`${key}:decision`);}
    setWorking(!!unresolved);
    const r=[...merged.values()].filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
    setNote(unresolved?'正在核对原办理结果…':r?`${names[domain]}：${receiptLabels[r.state]??r.state}`:`${names[domain]}：待办理`);
    // Read-only refresh also observes external human confirmation and newer receipt versions.
    timer=setTimeout(read,unresolved?2000:15000);
   }catch(e){if(!cancelled&&active()){setNote(message(e));timer=setTimeout(read,5000);}}
  }
  void read();return()=>{cancelled=true;if(timer)clearTimeout(timer);};
 },[api,scope,domain,tick,wb.snapshotVersion]);
 async function right(){
  if(!api||busy.current)return;
  const at=rows.current.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo)[0];
  const decision=at?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
  if(at?.current&&decision?.choices.includes('adopt')&&!working&&!localStorage.getItem(key)){await choose('adopt');return;}
  if(at?.current&&at.state==='waiting_evidence'){setNote(`${names[domain]}：请先补材料或明确拒绝本案`);return;}
  const todo=nextRequired(rows.current,domain);
  if(todo&&at?.current){onDomain(todo);return;}
  const nextDomain=domains[domains.indexOf(domain)+1];
  if(at&&at.current&&nextDomain&&rows.current.some(r=>r.domain===nextDomain&&r.current)){onDomain(nextDomain);return;}
  busy.current=true;setWorking(true);
  try{
   if(localStorage.getItem(key)){setNote('正在核对原办理结果…');return;}
   const server=await api.active(customerId);if(!active())return;
   if(server&&unsettled(server)){setNote('正在核对原办理结果…');return;}
   const history=await api.history(customerId);if(!active())return;
   await publish(history);if(!active())return;
   const latestFor=(d:string)=>history.filter(r=>r.domain===d).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
   if(history.some(r=>r.current===true&&r.state==='rejected')){setNote('已有明确拒绝结果，后续推进已停止');return;}
   const here=latestFor(domain);let target=domain;
   if(columnComplete(here)){
    target=domains[domains.indexOf(domain)+1];if(!target){setNote('已到最后一列');return;}
    latest.current.onDomain(target);
    if(columnComplete(latestFor(target))){setNote(`${names[target]}：已完成`);return;}
   }
   const plan=await api.plan(customerId,target);if(!active())return;
   if(!plan.available){setNote(`${names[target]}：${plan.reason||'尚未具备办理条件'}`);return;}
   if(plan.allowedActions.some(a=>a.requiresHumanConfirmation)){setNote(`${names[target]}：请先完成有权人员确认`);return;}
   const requestId=crypto.randomUUID();localStorage.setItem(key,requestId);
   setNote(`${names[target]}：正在办理…`);
   const receipt=await api.advance(customerId,plan,requestId);
   if(!unsettled(receipt)&&localStorage.getItem(key)===requestId)localStorage.removeItem(key);
   if(!active())return;
   await publish(await api.history(customerId));
   if(active())setNote(`${names[target]}：${receiptLabels[receipt.state]??receipt.state}`);
  }catch(e){if(active())setNote(`${message(e)}；系统将自动核对结果`);}
  finally{busy.current=false;if(active()){setWorking(false);setTick(n=>n+1);}}
 }
 async function choose(decision:'adopt'|'set_aside'|'reject'){
  if(!api||busy.current||localStorage.getItem(key))return;
  const round=rows.current.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
  const required=round?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
  if(!round||!round.current||!required||!required.choices.includes(decision))return;
  busy.current=true;setWorking(true);const requestId=crypto.randomUUID();
  try{
   localStorage.setItem(`${key}:decision`,JSON.stringify({resultId:required.resultId,decision}));localStorage.setItem(key,requestId);
   const r=await api.decide(customerId,round,required,decision,requestId,decision==='adopt'?'明确采用本列专业意见，不代表正式融资批准':decision==='reject'?'根据本轮信审意见明确拒绝本合成案例':'本轮意见暂不采用');
   if(r.selection?.eventId&&r.selection.candidateId===required.resultId&&r.selection.decision===decision){localStorage.removeItem(key);localStorage.removeItem(`${key}:decision`);}
   if(!active())return;
   const history=await api.history(customerId);await publish(history);
   const next=nextRequired(history,domain)??domains[domains.indexOf(domain)+1];
   if(active()&&decision==='adopt'&&next){
    latest.current.onDomain(next);
    // The same explicit arrow finishes this column and starts the next one.
    // New opinions remain unselected until the next human click.
    const nextReceipt=history.filter(x=>x.domain===next).sort((a,b)=>b.roundNo-a.roundNo)[0];
    if(!nextReceipt||!nextReceipt.current){
     const plan=await api.plan(customerId,next);if(!active())return;
     if(!plan.available||plan.allowedActions.some(a=>a.requiresHumanConfirmation)){setNote(`${names[next]}：${plan.reason||'请先完成有权人员确认'}`);return;}
     const nextRequestId=crypto.randomUUID();localStorage.setItem(key,nextRequestId);
     const receipt=await api.advance(customerId,plan,nextRequestId);
     if(!unsettled(receipt)&&localStorage.getItem(key)===nextRequestId)localStorage.removeItem(key);
     if(active())await publish(await api.history(customerId));
    }
   }
  }catch(e){if([400,403,409,422].includes((e as {status?:number}).status??0)){localStorage.removeItem(key);localStorage.removeItem(`${key}:decision`);}if(active())setNote(message(e));}
  finally{busy.current=false;if(active()){setWorking(false);setTick(n=>n+1);}}
 }
 const current=rows.current.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
 const required=current?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
 const candidate=current?.views?.decisions.candidate as {summary?:string}|null|undefined;
 const index=domains.indexOf(domain);
 const previous=domains.slice(0,index).reverse().find(d=>rows.current.some(r=>r.domain===d));
 return <nav className="tk-node-navigation" aria-label="专业列办理">
  <button className="tk-btn small" aria-label="上一专业列" disabled={!previous} onClick={()=>previous&&onDomain(previous)} title="回看上一列结果"><UiIcon name="back" size={20}/></button>
  <span className="tk-column-position" title={note} aria-live="polite">{index+1}/5 {names[domain]} · {working?'处理中':current?.current&&required?.choices.includes('adopt')?'采用本列意见并继续':current?receiptLabels[current.state]??current.state:note.startsWith(`${names[domain]}：`)?note.slice(names[domain].length+1):'待办理'}</span>
  <button className="tk-btn small" aria-label={current?.current&&required?.choices.includes('adopt')&&!working?'采用本列意见并继续':'推进下一专业列'} disabled={busy.current} onClick={()=>void right()} title={note}><UiIcon name="back" size={20} style={{transform:'rotate(180deg)'}}/></button>
 {current?.current&&required&&<div className="tk-column-choice" data-round-id={current.roundId} data-version={current.version}>
   <strong>{names[domain]}意见 · {required.choices.includes('adopt')?'点击右箭头采用并继续':'请补证重评，或明确拒绝本案'}</strong><p>{candidate?.summary??'请结合本轮材料与专业意见选择。'}</p><small>合成演练 · 确定性分析 · 采用不等于正式融资批准</small>
   <div>{required.choices.filter(choice=>choice!=='adopt').map(choice=><button key={choice} disabled={busy.current||!!localStorage.getItem(key)} onClick={()=>void choose(choice)}>{choice==='reject'?'拒绝本案':'暂不采用'}</button>)}</div>
  </div>}
 </nav>;
}
