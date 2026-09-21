import {useEffect,useMemo,useRef,useState} from 'react';
import {MaterialsDesk} from './materials-desk';
import {RoleFlow} from './role-flow';
import {WorkTimeline} from './work-timeline';
import type {WbApi} from '../../lib/workbench/use-workbench';
import type {DecisionResponse} from '../../lib/workbench/decision-feedback';
import {TakeoffBoard} from './takeoff-board';
import {WORK_ROLES} from './role-entry';
import {RoleLogo,UiIcon,ObjectIcon} from './ui-icons';
import type {TakeoffCellView} from '../../lib/workbench/takeoff-projection';
import './compact-workspace.css';
import './virtual-workbench.css';

const domains=['opportunity','policy','credit','commerce','asset'] as const;
const names=['业务','政策','信审','商务','资产'];
const rows=['input','analysis','human','closure'] as const;
const cases=[{id:'good',name:'合成制造业 · 好客户',label:'好',cash:'20万元',coverage:'2.0'}, {id:'medium',name:'合成制造业 · 补证客户',label:'中',cash:'待核验 → 20万元',coverage:'补证后2.0'}, {id:'bad',name:'合成制造业 · 风险客户',label:'差',cash:'4万元',coverage:'0.4'}];
type Entry={id:number;column:number;at:string;text:string};
type State={done:number;waiting:boolean;rejected:boolean;events:Entry[]};
const empty=():State=>({done:-1,waiting:false,rejected:false,events:[]});
const branchNames=['采用意见并继续','补充材料后复核','拒绝并归档'];
function confidence(id:string,column:number,waiting:boolean){return id==='bad'&&column===2?[8,12,80]:id==='medium'&&column===2&&waiting?[30,65,5]:[[88,9,3],[86,11,3],[90,8,2],[85,12,3],[94,4,2]][column]}
const summaries=(id:string)=>['年收入2200万元，订单300万元；制造业客户资料已整理。','收入未超过5000万元演示边界；回租范围与准入材料已核对。',id==='bad'?'月经营现金流4万元、偿债10万元，覆盖率0.4；本次演示拒绝并归档。':id==='medium'?'已补充现金流核验材料，覆盖率2.0；演示信审意见通过。':'月经营现金流20万元、偿债10万元，覆盖率2.0；演示信审意见通过。','租期36个月、拟月租1万元；商务方案已整理。','设备存在、权属与铭牌已核对；本次演示流程办结。'];
function storageKey(id:string){return `jw:virtual-click-v1:${new URLSearchParams(window.location.search).has('demoTest')?'test':'user'}:${id}`}
function readState(id:string):State{try{const s=JSON.parse(localStorage.getItem(storageKey(id))||'null');return s&&Number.isInteger(s.done)&&s.done>=-1&&s.done<=4&&Array.isArray(s.events)?s:empty()}catch{return empty()}}
function virtualCells(state:State,working:number|null=null):TakeoffCellView[]{
 return domains.flatMap((domain,index)=>rows.map((row,r)=>{
  const rejected=state.rejected&&index===2&&(r===2||r===3);
  const done=index<=state.done&&!rejected;
  const partial=index===state.done+1&&state.done>=0&&!(state.done===4||state.rejected)&&r===0;
  const running=working===index||(!(state.done===4||state.rejected)&&index===state.done+1&&state.done>=0&&r===1&&!state.waiting);
  return {domain,row,completed:working===index?false:done||partial,running,displayBucket:done?100:null,needsReview:false,frozen:false,items:rejected?[{key:'gate',tone:'red' as const,label:'虚拟信审拒绝'}]:[],allowedActions:[],basis:'虚拟数据 · 点击事件',responsible:null};
 }));
}
function VirtualDirectory({role,onRole,onOpen}:{role:string;onRole:()=>void;onOpen:(id:string)=>void}){
 return <main className="tk-root tk-directory tk-case-picker"><header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong><small>虚拟演示</small><button className="tk-picker-role" aria-label="切换角色" onClick={onRole}><RoleLogo role={role} size={54}/></button></header><section className="tk-picker-content" aria-label="好中差三客户"><div className="tk-picker-grid">{cases.map((c,i)=>{const state=readState(c.id);return <div role="button" tabIndex={0} key={c.id} className={`tk-picker-card ${['good','middle','poor'][i]}`} aria-label={`${c.label}客户：${c.name}`} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(c.id)}}}><span className="tk-picker-grade">{c.label}</span><div className="tk-picker-board"><TakeoffBoard cells={virtualCells(state)} selected={null} readOnly onSelect={()=>{}}/></div><span className="tk-picker-name">{c.name}</span><small>{state.rejected?'信审拒绝 · 已归档':state.done===4?'已办结':state.waiting?'待补材料':state.done<0?'尚未开始':`已完成${state.done+1}/5列`}</small></div>})}</div><span className="tk-picker-caption">虚拟数据 · 点击卡片进入，左右箭头逐列办理</span></section></main>;
}
export function VirtualWorkbench(){
 const [role,setRole]=useState('');const [selected,setSelected]=useState('');
 return !role?<main className="tk-root tk-entry"><header className="tk-entry-brand"><UiIcon name="jianwei" size={32}/><strong>见微</strong><span>虚拟交互演示</span></header><section className="tk-role-content"><h1>选择你的角色</h1><div className="tk-role-grid">{WORK_ROLES.map(r=><button key={r.id} className="tk-role-card" aria-label={r.name} onClick={()=>setRole(r.id)}><RoleLogo role={r.id} size={144}/><span>{r.description}</span></button>)}</div></section></main>:!selected?<VirtualDirectory role={role} onRole={()=>setRole('')} onOpen={setSelected}/>:<VirtualProject key={selected} id={selected} role={role} onBack={()=>setSelected('')} onRole={()=>{setSelected('');setRole('')}}/>;
}
function VirtualProject({id,role,onBack,onRole}:{id:string;role:string;onBack:()=>void;onRole:()=>void}){
 const storage=storageKey(id);
 const [state,setState]=useState<State>(()=>readState(id));
 const [column,setColumn]=useState(Math.max(0,state.done));const [page,setPage]=useState('平台');const [working,setWorking]=useState<number|null>(null);
 const busy=useRef(false);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const [ending,setEnding]=useState(false);
 useEffect(()=>{
  if(!ending)return;
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setEnding(false)}};
  window.addEventListener('keydown',escape);
  return()=>window.removeEventListener('keydown',escape);
 },[ending]);
 const [draft,setDraft]=useState('');const [messages,setMessages]=useState<Entry[]>([]);const [assistant,setAssistant]=useState(role);const [picks,setPicks]=useState<Record<number,number>>({});
 useEffect(()=>{localStorage.setItem(storage,JSON.stringify(state))},[state,storage]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 const customer=cases.find(c=>c.id===id)!;const text=summaries(id);const terminal=state.done===4||state.rejected;
 function right(){
  if(busy.current)return;
  if(column<state.done){setColumn(column+1);return;}
  if(terminal){setEnding(true);return;}
  const next=state.waiting?2:state.done+1;busy.current=true;setWorking(next);setColumn(next);setAssistant(WORK_ROLES[next].id);
  timer.current=setTimeout(()=>{
   const waiting=id==='medium'&&next===2&&!state.waiting;
   const rejected=id==='bad'&&next===2;
   const scores=confidence(id,next,waiting);setPicks(p=>({...p,[next]:scores.indexOf(Math.max(...scores))}));
   const detail=waiting?'信审需要补充现金流材料。再点右箭头，演示补件并重新核验。':text[next];
   const event={id:state.events.length+1,column:next,at:new Date().toISOString(),text:`${detail} 三分叉：${branchNames.map((n,i)=>`${n} ${scores[i]}%`).join('；')}（虚拟置信度）。`};
   setState({...state,done:waiting?1:next,waiting,rejected,events:[...state.events,event]});
   setWorking(null);busy.current=false;if(rejected||next===4)setEnding(true);
  },480);
 }
 const cells=virtualCells(state,working);
 const visibleEvents=state.events.filter(e=>e.column===column);const last=visibleEvents.at(-1);
 const materials=[['企业经营资料','年收入2200万元；订单300万元'],['准入核对表','制造业；首次回租；演示收入上限5000万元'],['现金流与偿债表',`月现金流${customer.cash}；月偿债10万元；覆盖率${customer.coverage}`],['商务测算表','36个月；拟月租1万元'],['设备核验表','设备存在；权属清晰；铭牌一致']];
 const localData=useRef({materials,events:state.events});localData.current={materials,events:state.events};
 const demoClient=useMemo(()=>({
  read:async()=>({artifacts:localData.current.materials.map((m,i)=>({artifactId:`${id}-material-${i}`,kind:'financial_statement',current:true,displayName:m[0],status:'ready'}))}),
  artifactContent:async(_customer:string,artifactId:string)=>{const index=Number(artifactId.split('-').at(-1));return {artifact:{content:{sourceMode:'virtual',text:localData.current.materials[index]?.[1]??'虚拟补充材料'}}}},
  eventsPage:async()=>({events:localData.current.events.map(e=>({eventId:`virtual-${id}-${e.id}`,aggregateVersion:String(e.id),occurredAt:e.at,payloadRef:{type:'domain_result_recorded'},payload:{summary:e.text,actor:'虚拟演示',actorRole:names[e.column]}})),hasMore:false,nextAfterSeq:String(localData.current.events.length)})
 }),[id]);
 const demoWb=useMemo(()=>({client:demoClient,customerId:id,session:{sessionId:`virtual-${id}`,roles:[role]},snapshotVersion:state.events.length}) as unknown as WbApi,[demoClient,id,role,state.events.length]);
 const demoSets:Record<string,DecisionResponse['latest']>=Object.fromEntries(domains.map((_d,i)=>{
  const event=state.events.filter(e=>e.column===i).at(-1);const values=confidence(id,i,state.waiting);const chosen=picks[i]??values.indexOf(Math.max(...values));
  return [WORK_ROLES[i].id,event?{id:`virtual-${id}-${i}`,question:`${names[i]}演示决策`,current:true,valid:true,at:event.at,candidates:branchNames.map((label,k)=>({id:`virtual-${id}-${i}-${k}`,label,confidence:values[k]/100,impact:k===0?'沿当前意见继续办理':k===1?'补齐材料后重新核验':'结束本次办理并归档',evidenceRefIds:[],confidenceKind:'model_estimate_uncalibrated' as const})),evidenceRefs:[],omitted:[],feedback:{action:'select' as const,candidateId:`virtual-${id}-${i}-${chosen}`,label:branchNames[chosen],reason:'虚拟演示选择',eventId:`virtual-choice-${event.id}`,at:event.at},feedbackUsed:null,model:{status:'completed',contextVersion:String(event.id),source:{mode:'virtual'}}}:null];
 }));
 function selectBranch(domain:string,candidateId:string){const i=WORK_ROLES.findIndex(r=>r.id===domain);const k=Number(candidateId.split('-').at(-1));if(i<0||k<0||k>2)return;setColumn(i);setPicks(p=>({...p,[i]:k}));setMessages(m=>[...m,{id:Date.now(),column:i,at:new Date().toISOString(),text:`已选中${names[i]}的“${branchNames[k]}”分支，虚拟置信度${confidence(id,i,state.waiting)[k]}%；黑色实线已同步。`}])}
 return <div className="tk-root tk-workspace vd-workspace">
  <header className="tk-top tk-compact-top"><button className="tk-back-client" aria-label="切换客户" onClick={onBack}><UiIcon name="back" size={20}/></button><strong className="tk-cust-name">{customer.name}</strong><nav className="tk-mainnav" aria-label="客户工作区">{([['平台','board'],['材料','materials'],['决策','flow'],['流程','timeline']] as const).map(([p,icon])=><button key={p} aria-current={page===p?'page':undefined} onClick={()=>setPage(p)}>{icon==='materials'?<ObjectIcon name="materials" size={25}/>:<UiIcon name={icon} size={22}/>}<span>{p}</span></button>)}</nav><small className="vd-label">虚拟演示</small><nav className="tk-node-navigation" aria-label="专业列办理"><button className="tk-btn small" aria-label="上一专业列" disabled={column===0||working!==null} onClick={()=>setColumn(column-1)}>←</button><span className="tk-column-position">{column+1}/5 {names[column]} · {working!==null?'处理中':state.waiting&&column===2?'补件待演示':column<=state.done?'已记录':'未开始'}</span><button className="tk-btn small" aria-label="推进下一专业列" disabled={working!==null} onClick={right}>→</button></nav><button className="tk-btn small" onClick={onRole}>切换角色</button><button className="tk-btn small" disabled={working!==null} onClick={()=>{setState(empty());setColumn(0);setMessages([]);setPicks({});setEnding(false)}}>重新演示</button></header>
  <div className="vd-layout"><main className="vd-main">
   {page==='平台'&&<TakeoffBoard cells={cells} selected={null} activeDomain={domains[column]} onSelect={c=>{setColumn(domains.indexOf(c.domain));setPage(c.row==='input'?'材料':'决策')}}/>}
   {page==='材料'&&<MaterialsDesk wb={demoWb} customerId={id} activeDomain={domains[column]} onUpload={()=>setMessages(m=>[...m,{id:Date.now(),column,at:new Date().toISOString(),text:'虚拟材料补充：点击右箭头演示补件并继续。'}])}/>}
   {page==='决策'&&<RoleFlow cells={cells} top={{changedDomains:[],gateResult:null}} activeDomain={domains[column]} demoSets={demoSets} onDemoSelect={selectBranch} onSelect={c=>{setColumn(domains.indexOf(c.domain));if(c.row==='input')setPage('材料')}}/>}
   {page==='流程'&&<WorkTimeline wb={demoWb} customerId={id} activeDomain={domains[column]}/>}

  </main><aside className="vd-chat" aria-label="常驻助手"><div className="tk-asst-tabs" role="tablist" aria-label="聊天助手">{WORK_ROLES.map(r=><button className="tk-asst-tab" role="tab" aria-selected={assistant===r.id} aria-label={r.name} key={r.id} onClick={()=>setAssistant(r.id)}><RoleLogo role={r.id} size={32}/></button>)}</div><small>虚拟助手 · 与点击事件同步</small><div className="vd-execution"><span>执行进度 {Math.round((state.done+1)/5*100)}%</span><div role="progressbar" aria-label="执行进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.done+1)/5*100)}><i style={{width:`${(state.done+1)/5*100}%`}}/></div></div><div className="vd-messages" role="log" aria-label="助手对话"><p className="vd-bubble">已准备好{customer.name}的虚拟材料。点击右箭头逐列办理；左箭头回看。</p>{state.events.concat(messages).sort((a,b)=>a.at.localeCompare(b.at)).map((e,i)=><article className="vd-bubble" key={`${e.id}-${i}`}><small>{names[e.column]} · {new Date(e.at).toLocaleTimeString()}</small><p>{e.text}</p></article>)}{working!==null&&<p>正在更新{names[working]}列及关联材料…</p>}</div><form className="vd-compose" onSubmit={e=>{e.preventDefault();if(!draft.trim())return;const at=new Date().toISOString();setMessages(m=>[...m,{id:Date.now(),column,at,text:`你：${draft}`},{id:Date.now()+1,column,at,text:`虚拟助手：当前是${names[column]}列。${last?.text||'尚未开始，请点右箭头。'}`}]);setDraft('')}}><input aria-label="聊天消息" placeholder="输入消息…" value={draft} onChange={e=>setDraft(e.target.value)}/><button className="tk-btn" disabled={!draft.trim()} aria-label="发送消息">↑</button></form></aside></div>
  {ending&&<div className={`tk-case-ending${state.rejected?' rejected':''}`} role="dialog" aria-label="虚拟演示结果"><div className="tk-case-ending-symbol">{state.rejected?'✕':<img src="/objects/asset-v1.png" alt="钻石"/>}</div>{state.rejected&&<h1>信审拒绝 · 演示归档</h1>}<button className="tk-btn" onClick={()=>setEnding(false)}>返回工作台</button></div>}
 </div>;
}

