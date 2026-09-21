import {useRef,useState} from 'react';
import type {ColumnReceipt} from '../../lib/workbench/advance-client';
import type {WbApi} from '../../lib/workbench/use-workbench';
type Pending={customerId:string;old:string;body:Record<string,unknown>;phase:'registering'|'registered'|'advancing';advanceRequestId?:string;domain?:string};
export function RoundSupplement({wb,round}:{wb:WbApi;round?:ColumnReceipt}){
 const key=`jw:round-supplement:${round?.customerId}`;
 const pending=useRef<Pending|null>((()=>{try{const p=JSON.parse(localStorage.getItem(key)??'null');return p?.customerId===round?.customerId?p:null;}catch{return null;}})());
 const initial=pending.current?.body.content as {value?:number;verificationDocument?:string}|undefined;
 const [value,setValue]=useState(String(initial?.value??'')),[proof,setProof]=useState(initial?.verificationDocument??''),[verified,setVerified]=useState(!!pending.current),[busy,setBusy]=useState(false),[note,setNote]=useState(pending.current?'发现未确认补证，继续核对将复用原请求和原内容。':''),[saved,setSaved]=useState(false);
 const candidate=round?.views?.decisions.candidate as {evidenceRefs?:Array<{materialId:string;location?:{field?:string}}> }|undefined;
 const matches=candidate?.evidenceRefs?.filter(r=>r.location?.field==='monthly_operating_cash_flow')??[];
 if(!round||round.domain!=='credit'||round.caseOutcome?.sourceMode!=='synthetic'||round.caseOutcome.status!=='in_progress'||(!pending.current&&matches.length!==1))return null;
 const old=pending.current?.old??matches[0].materialId;
 const persist=(p:Pending)=>{localStorage.setItem(key,JSON.stringify(p));pending.current=p;};
 async function submit(){
  if(!round||busy||saved||!wb.client||!verified||!proof.trim()||!value.trim()||!Number.isFinite(Number(value)))return;
  setBusy(true);setNote('正在核对补证与重评…');
  try{
   const customer=wb.snapshot?.customer as {customerId?:string;tenantId?:string}|undefined;
   const tenantId=wb.session?.tenantId??(customer?.customerId===round.customerId?customer.tenantId:null);
   if(!tenantId)throw new Error('客户工作本未提供租户，不能提交补证');
   let p=pending.current;
   if(!p){p={customerId:round.customerId,old,phase:'registering',body:{tenantId,requestId:crypto.randomUUID(),kind:'financial_statement',factKey:'monthly_operating_cash_flow',grade:'confirmed',supersedes:old,content:{value:Number(value),sourceMode:'synthetic',verificationDocument:proof.trim()},materialMeta:{unit:'CNY'}}};persist(p);}
   if(p.phase==='registering'){
    // Existing artifact.register command is idempotent by requestId. Explicit retry retains the entire body.
    const result=await wb.client.registerArtifact(round.customerId,p.body);
    if(result.ok!==true)throw new Error('登记结果尚未确认');
    p={...p,phase:'registered'};persist(p);
   }
   const api=wb.client.advance;
   if(api){
    const advanceKey=`jw:column-advance:pending:${round.customerId}`;
    if(p.phase==='advancing'){
     const recovered=await api.recover(round.customerId,p.advanceRequestId!);
     if(!recovered)throw new Error('原重评请求尚未确认，保留请求标识继续核对');
    }else{
     if(localStorage.getItem(advanceKey))throw new Error('另一办理请求尚待核对，请先关闭面板等待结果');
     const plan=await api.plan(round.customerId,'credit');
     if(!plan.available||plan.allowedActions.some(a=>a.requiresHumanConfirmation))throw new Error(plan.reason??'当前重评计划不可执行');
     p={...p,phase:'advancing',advanceRequestId:crypto.randomUUID(),domain:plan.affectedDomains?.[0]??'credit'};persist(p);
     localStorage.setItem(advanceKey,p.advanceRequestId!);
     await api.advance(round.customerId,plan,p.advanceRequestId!);
    }
   }
   localStorage.removeItem(key);pending.current=null;setSaved(true);
   setNote('补证已登记并已发起受影响专业重评；关闭面板后查看新意见。');await wb.refresh();
   window.dispatchEvent(new CustomEvent('jw:round-supplement',{detail:{customerId:round.customerId,domain:p.domain??'credit'}}));
  }catch(e){setNote(`结果未确认：${(e as Error).message}。原请求已保留，继续核对不会换ID重复登记。`);}
  finally{setBusy(false);}
 }
 return <section className="wb-card" aria-label="本轮信审补证"><h3>现金流核验更正版</h3><p>仅用于隔离合成演练。旧原件与历史选择保留，提交后重评实际受影响的专业。</p>
 <label>月经营现金流（元）<input aria-label="月经营现金流（元）" type="number" value={value} disabled={busy||!!pending.current} onChange={e=>setValue(e.target.value)}/></label>
 <label>核验依据说明<textarea aria-label="核验依据说明" value={proof} disabled={busy||!!pending.current} onChange={e=>setProof(e.target.value)}/></label>
 <label><input type="checkbox" checked={verified} disabled={!!pending.current} onChange={e=>setVerified(e.target.checked)}/>我已核对上述合成材料及金额，明确登记为已核验</label>
 <button className="tk-btn" disabled={busy||saved||!verified||!proof.trim()||!value.trim()} onClick={()=>void submit()}>{pending.current?'继续核对原补证':'登记补件并重评'}</button><p role="status">{note}</p></section>;
}
