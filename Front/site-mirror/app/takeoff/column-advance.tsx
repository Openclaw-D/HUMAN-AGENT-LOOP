import { useEffect, useRef, useState } from 'react';
import type { WbApi } from '../../lib/workbench/use-workbench';
import { businessCopy } from '../../lib/workbench/business-copy';
import { unsettled, type AdvanceClient, type ColumnReceipt, type RequiredDecision } from '../../lib/workbench/advance-client';

const domains=['business','policy','credit','commerce','asset'];
export function nextRequired(rows:ColumnReceipt[],exclude?:string){
 const todo=rows[0]?.needsReselection;
 if(!todo)return undefined;
 return domains.find(d=>d!==exclude&&rows.some(r=>r.domain===d&&r.current&&(r.state==='waiting_evidence'||todo.some(x=>x.domain===d&&x.roundId===r.roundId&&r.state==='awaiting_confirmation'))));
}
const names:Record<string,string>={business:'业务',policy:'政策',credit:'信审',commerce:'商务',asset:'资产'};
export const receiptLabels:Record<string,string>={accepted:'已受理',running:'处理中',completed:'本列完成',waiting_evidence:'等待补证',awaiting_confirmation:'等待人工确认',needs_reassessment:'待重评',rejected:'已拒绝',failed:'失败',unknown:'结果核对中'};
export function columnComplete(r:ColumnReceipt|undefined){return !!r&&r.current===true&&r.state==='completed'&&['materials','analysis','verification','completion'].every(id=>r.columnResults.some(x=>x.itemId===id&&x.state==='completed'));}
function message(e:unknown){const p=e as {status?:number;message?:string};return [404,405,501,503].includes(p.status??0)?'本列服务暂未接通：请确认办理服务已启动后重试':p.status===403?'当前身份无本列办理权限：请在右上角切换到对应专业角色后重试（不借用其他身份）':p.message||'暂时无法核对服务端结果';}
// LONG-02：计划面（advance-plan available:false）原因的业务可读映射。红线=确定性阻断，
// 补件不能放行；唯一解除路径=人工核验原件后显式登记更正版事实（更正留痕），文字声明不解除。
// NIGHT-FF2：升为 {text,next,short} 单一来源并导出——text=完整规则句（原有），
// next=下一步完整句，short=简报条顶部短句；takeoff-screen 静态投影复用本表，不改门禁。
export const PLAN_REASON_CN:Record<string,{text:string;next:string;short:string}>={
 CUSTOMER_REVENUE_REDLINE:{
  text:'客户年收入超过5000万元准入红线：本次按规则不能推进，补件不能放行；仅人工核验原件后在材料页显式登记更正版收入事实（更正留痕，不覆盖历史），才能重新评估解除',
  next:'按准入规则本次不能推进：人工核验原件后，在材料页显式登记更正版收入事实（更正留痕，不覆盖历史），才能重新评估解除',
  short:'收入超5000万红线：本次不能推进，需登记更正版收入事实',
 },
};
// NIGHT-GATE-FF2：从计划读面结果提取静态阻断（纯函数供测试）。
// available:false 且原因在共享映射内→阻断块；available:true/未知原因/读不到→null（不冒充可用，
// 按钮保持既有路径，错误在点击时由既有服务错误路径如实显示）。
export function planBlockOf(p:{available:boolean;reason?:string|null}|null|undefined, domain:string){
 if(!p||p.available!==false||!p.reason)return null;
 const mapped=PLAN_REASON_CN[p.reason];
 return mapped?{domain,reason:p.reason,...mapped}:null;
}
function planUnavailableText(domain:string,reason:string|null){const cn=reason?PLAN_REASON_CN[reason]:undefined;return cn?cn.text:`${names[domain]}：${reason||'尚未具备办理条件，请先完成前序事项'}`;}

// 2026-09-29 契约：左右箭头=纯浏览（不执行任何业务）；每次业务执行由一个明确命名的按钮提交。
type EventView =
 | {kind:'disabled';label:string;title:string}
 | {kind:'blocked';label:string;title:string}
 | {kind:'adopt';label:string;title:string}
 | {kind:'advance';label:string;title:string}
 | {kind:'goto';label:string;title:string;target:string}
 | {kind:'materials';label:string;title:string}
 | {kind:'finish';label:string;title:string};

export function eventView(args:{
  api: AdvanceClient | undefined;
  working: boolean; domain: string; rows: ColumnReceipt[]; canFinish?: boolean;
  planBlock?: {domain?:string|null;reason?:string|null;text:string;next:string;short:string}|null;
}):EventView{
 const {api,working,domain,rows,planBlock}=args;
 if(!api)return {kind:'disabled',label:'本列服务暂未接通',title:'推进服务未连接，只读浏览不受影响'};
 // NIGHT-GATE-FF2：已获计划面确定性阻断→按钮不再引导“提交材料并分析”，与简报同原因同下一步
 // （完整规则句在 title）。未知原因/读取失败不到达此分支（planBlock=null），保持既有路径不冒充可用。
 if(planBlock&&(planBlock.domain??'business')===domain)return {kind:'blocked',label:'按办理规则暂不能推进',title:planBlock.text};
 if(working)return {kind:'disabled',label:'处理中：正在核对服务端结果…',title:'上一事件尚未收敛；先查回执，不盲目重发'};
 const rejected=rows.find(r=>r.current===true&&r.state==='rejected');
 if(rejected)return {kind:'disabled',label:'办理已拒绝，后续推进已停止',title:`${names[rejected.domain]??rejected.domain}列有明确拒绝结果`};
 if(args.canFinish&&domains.every(d=>rows.some(r=>r.domain===d&&columnComplete(r))))return {kind:'finish',label:'查看后续办理',title:'五区评审已完成：继续预评估确认或查看履约周期'};
 const at=rows.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
 const required=at?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
 if(at?.current){
  if(at.state==='awaiting_confirmation'){
   if(required?.choices.includes('adopt'))return {kind:'adopt',label:'确认本次选择',title:`人工确认${names[domain]}列专业意见并继续；采用≠正式融资批准`};
   if(required)return {kind:'disabled',label:'等待人工选择（见下方意见卡）',title:'本列需要补证后重评或明确拒绝，不能默认通过'};
   return {kind:'disabled',label:'等待人工确认',title:'服务端尚未给出可执行的下一步'};
  }
  if(at.state==='waiting_evidence')return {kind:'materials',label:domain==='credit'?'补充现金流材料并重评':'补充材料并重评',title:'在材料面板登记补充材料并重评（明确事件，不自动推进）'};
  if(at.state==='unknown')return {kind:'disabled',label:'结果核对中',title:'未知结果先查回执，不盲目重发'};
  if(columnComplete(at)){
   const next=domains[domains.indexOf(domain)+1];
   if(next)return {kind:'goto',label:`前往${names[next]}办理`,title:'本列已完成；浏览按钮也可直接查看',target:next};
   return {kind:'disabled',label:'五列已全部办理',title:'可到流程页查看完整记录'};
  }
  if(at.state==='completed'){
   const next=domains[domains.indexOf(domain)+1];
   return next?{kind:'goto',label:`查看${names[next]}`,title:'本列本轮完成',target:next}:{kind:'disabled',label:'已到最后一列',title:'可到流程页查看完整记录'};
  }
  if(['running','accepted'].includes(at.state))return {kind:'disabled',label:'处理中：服务端执行未收敛',title:'等待服务端回执；刷新只读'};
  if(at.state==='failed')return {kind:'advance',label:'重新推进',title:`上次执行失败：以新请求标识重排${names[domain]}列`};
  if(at.state==='needs_reassessment')return {kind:'advance',label:'重新核验',title:`${names[domain]}列依据已变化：按当前证据重评`};
  if(at.state==='rejected')return {kind:'disabled',label:'本列未通过',title:'拒绝结果不刷绿；依据见流程页'};
 }
 const todo=nextRequired(rows,domain);
 if(todo&&todo!==domain&&at?.current)return {kind:'goto',label:`前往${names[todo]}处理待办`,title:'服务端待办需要先处理',target:todo};
 return {kind:'advance',label:'提交材料并分析',title:`一次事件：提交${names[domain]}列并执行当前可运行步骤`};
}

/** One explicit event, one server plan. Arrows only browse. Recovery only reads the persisted request. */
export function ColumnAdvance({wb,customerId,domain,onDomain,onReceipts,onOpenMaterials,onFinished,planBlock}:{wb:WbApi;customerId:string;domain:string;onDomain:(domain:string)=>void;onReceipts:(receipts:ColumnReceipt[])=>void;onOpenMaterials?:()=>void;onFinished?:()=>void;planBlock?:{domain?:string|null;reason?:string|null;text:string;next:string;short:string}|null}){
 const api=wb.client?.advance;
 const scope=`${wb.session?.sessionId}:${customerId}`;
 const key=`jw:column-advance:pending:${customerId}`;
 const live=useRef(scope);live.current=scope;
 const mounted=useRef(false),busy=useRef(false),rows=useRef<ColumnReceipt[]>([]),signature=useRef('');
 const latest=useRef({wb,onReceipts,onDomain});latest.current={wb,onReceipts,onDomain};
 const [working,setWorking]=useState(false),[note,setNote]=useState('正在核对办理进度…');
 const [loaded,setLoaded]=useState(false);
 const [actionError,setActionError]=useState('');
 const [tick,setTick]=useState(0);
 const active=()=>mounted.current&&live.current===scope;
 async function publish(next:ColumnReceipt[]){
  if(!active())return;
  rows.current=next;
  setLoaded(true);
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
 // 显式事件一：提交本列（plan→advance；不导航）。same requestId 同载荷单次生效由 pending 键守护。
 async function startEvent(){
  if(!api||busy.current)return;
  busy.current=true;setWorking(true);
  setActionError('');
  try{
   if(localStorage.getItem(key)){setNote('正在核对原办理结果…');return;}
   const server=await api.active(customerId);if(!active())return;
   if(server&&unsettled(server)){setNote('正在核对原办理结果…');return;}
   const history=await api.history(customerId);if(!active())return;
   await publish(history);if(!active())return;
   if(history.some(r=>r.current===true&&r.state==='rejected')){setNote('已有明确拒绝结果，后续推进已停止');return;}
   const plan=await api.plan(customerId,domain);if(!active())return;
   if(!plan.available){setActionError(planUnavailableText(domain,plan.reason??null));return;}
   if(plan.allowedActions.some(a=>a.requiresHumanConfirmation)){setActionError(`${names[domain]}：请先完成有权人员确认`);return;}
   const requestId=crypto.randomUUID();localStorage.setItem(key,requestId);
   setNote(`${names[domain]}：正在办理…`);
   const receipt=await api.advance(customerId,plan,requestId);
   if(!unsettled(receipt)&&localStorage.getItem(key)===requestId)localStorage.removeItem(key);
   if(!active())return;
   await publish(await api.history(customerId));
   if(active())setNote(`${names[domain]}：${receiptLabels[receipt.state]??receipt.state}`);
  }catch(e){if(active())setActionError(`${message(e)}；系统将自动核对结果`);}
  finally{busy.current=false;if(active()){setWorking(false);setTick(n=>n+1);}}
 }
 async function choose(decision:'adopt'|'set_aside'|'reject'){
  if(!api||busy.current||localStorage.getItem(key))return;
  const round=rows.current.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
  const required=round?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
  if(!round||!round.current||!required||!required.choices.includes(decision))return;
  busy.current=true;setWorking(true);const requestId=crypto.randomUUID();
  setActionError('');
  try{
   localStorage.setItem(`${key}:decision`,JSON.stringify({resultId:required.resultId,decision}));localStorage.setItem(key,requestId);
   const r=await api.decide(customerId,round,required,decision,requestId,decision==='adopt'?'明确采用本列专业意见，不代表正式融资批准':decision==='reject'?'根据本轮信审意见明确拒绝本合成案例':'本轮意见暂不采用');
   if(r.selection?.eventId&&r.selection.candidateId===required.resultId&&r.selection.decision===decision){localStorage.removeItem(key);localStorage.removeItem(`${key}:decision`);}
   if(!active())return;
   const history=await api.history(customerId);await publish(history);
   const next=nextRequired(history,domain)??domains[domains.indexOf(domain)+1];
   if(active()&&decision==='adopt'&&next){
    latest.current.onDomain(next);
    // The same explicit confirmation finishes this column and starts the next one.
    // New opinions remain unselected until the next human click.
    const nextReceipt=history.filter(x=>x.domain===next).sort((a,b)=>b.roundNo-a.roundNo)[0];
    if(!nextReceipt||!nextReceipt.current){
     const plan=await api.plan(customerId,next);if(!active())return;
     if(!plan.available){setActionError(planUnavailableText(next,plan.reason??null));return;}
     if(plan.allowedActions.some(a=>a.requiresHumanConfirmation)){setActionError(`${names[next]}：请先完成有权人员确认`);return;}
     const nextRequestId=crypto.randomUUID();localStorage.setItem(key,nextRequestId);
     const receipt=await api.advance(customerId,plan,nextRequestId);
     if(!unsettled(receipt)&&localStorage.getItem(key)===nextRequestId)localStorage.removeItem(key);
     if(active())await publish(await api.history(customerId));
    }
   }
  }catch(e){if([400,403,409,422].includes((e as {status?:number}).status??0)){localStorage.removeItem(key);localStorage.removeItem(`${key}:decision`);}if(active())setActionError(message(e));}
  finally{busy.current=false;if(active()){setWorking(false);setTick(n=>n+1);}}
 }
 const current=rows.current.filter(r=>r.domain===domain).sort((a,b)=>b.roundNo-a.roundNo||b.version-a.version)[0];
 const required=current?.views?.decisions.requiredDecision as RequiredDecision|null|undefined;
 const candidate=current?.views?.decisions.candidate as {summary?:string}|null|undefined;
 const index=domains.indexOf(domain);
 const ev=eventView({api,working:working||!loaded,domain,rows:rows.current,canFinish:!!onFinished,planBlock});
 const statusText=working?'处理中':current?.current&&required?.choices.includes('adopt')?'等待人工确认':current?receiptLabels[current.state]??current.state:note.startsWith(`${names[domain]}：`)?note.slice(names[domain].length+1):'待办理';
 const onEvent=()=>{
  if(ev.kind==='disabled'||busy.current)return;
  if(ev.kind==='adopt')return void choose('adopt');
  if(ev.kind==='advance')return void startEvent();
  if(ev.kind==='goto')return onDomain(ev.target);
  if(ev.kind==='materials')return onOpenMaterials?.();
  if(ev.kind==='finish')return onFinished?.();
 };
 return <nav className="tk-node-navigation" aria-label="专业列办理">
  <span className="tk-column-position" title={note} aria-live="polite">{ev.kind==='finish'?'五区评审完成':`${index+1}/5 ${names[domain]} · ${statusText}`}</span>
  <button className="tk-btn small tk-next-event" data-event-kind={ev.kind} disabled={ev.kind==='disabled'||ev.kind==='blocked'||busy.current} onClick={onEvent} title={ev.title}>{ev.label}</button>
  {actionError&&<span role="alert" className="tk-action-error">{actionError}</span>}
 {current?.current&&required&&<details className="tk-column-opinion"><summary>查看专业意见</summary><div className="tk-column-choice" data-round-id={current.roundId} data-version={current.version}>
   <strong>{names[domain]}意见 · {required.choices.includes('adopt')?'点上方按钮确认采用并继续':'请补证重评，或明确拒绝本案'}</strong><p>{businessCopy(candidate?.summary??'请结合本轮材料与专业意见选择。')}</p><small>分析供参考 · 采用不等于正式融资批准</small>
   {required.choices.includes('reject')&&!(wb.session?.roles??[]).includes('credit')&&<small>「拒绝本案」需信审角色：请切换角色后办理（页面不代借其他身份）。</small>}
   <div>{required.choices.filter(choice=>choice!=='adopt').map(choice=><button key={choice} disabled={busy.current||!!localStorage.getItem(key)} onClick={()=>void choose(choice)}>{choice==='reject'?'拒绝本案':'暂不采用'}</button>)}</div>
 </div></details>}
 </nav>;
}
