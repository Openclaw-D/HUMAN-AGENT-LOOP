import test from 'node:test';
import assert from 'node:assert/strict';
import {render,screen,fireEvent,waitFor,cleanup,act} from './harness.mjs';
const React=(await import('react')).default;
const {ColumnAdvance}=await import('../../../site-mirror/app/takeoff/column-advance.tsx');
const makeReceipt=(state='awaiting_confirmation')=>({customerId:'c1',requestId:'q1',roundId:'r1',domain:'business',current:true,version:2,roundNo:1,state,updatedAt:'2026-09-21T10:00:00Z',columnResults:['materials','analysis','verification','completion'].map(itemId=>({itemId,state:state==='completed'?'completed':'blocked'})),downstream:[]});
const plan={customerId:'c1',domain:'business',available:true,planId:'p1',planHash:'h1',roundNo:1,expectedVersion:{customerRevision:1},summary:'真实业务计划',allowedActions:[{actionId:'a1',commandKind:'report.generate'}]};
test('waiting credit can explicitly reject without offering adoption or duplicating the decision',async t=>{
 t.after(cleanup);localStorage.clear();let posts=0,finish;let history=[{...makeReceipt('waiting_evidence'),domain:'credit',views:{decisions:{requiredDecision:{roundId:'r1',resultId:'risk1',choices:['reject']}}}}];
 const api={active:async()=>null,history:async()=>history,decide:async(_c,_r,_d,decision)=>{assert.equal(decision,'reject');posts++;return new Promise(resolve=>finish=()=>{history=[{...history[0],state:'rejected',views:{decisions:{requiredDecision:null}},selection:{candidateId:'risk1',eventId:'rejection1',decision:'reject'}}];resolve(history[0]);});}};
 await act(async()=>render(React.createElement(ColumnAdvance,{wb:{client:{advance:api},session:{sessionId:'s1'},refresh:async()=>{}},customerId:'c1',domain:'credit',onDomain:()=>{},onReceipts:()=>{}})));
 assert.equal(screen.queryByRole('button',{name:'采用本列意见并继续'}),null);
 const reject=screen.getByRole('button',{name:'拒绝本案'});fireEvent.click(reject);fireEvent.click(reject);
 await waitFor(()=>assert.equal(posts,1));await act(async()=>finish());assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),null);
});
function setup(api){let refresh=0;let rows=[];let selected=[];const wb={client:{advance:api},session:{sessionId:'s1'},refresh:async()=>{refresh++}};render(React.createElement(ColumnAdvance,{wb,customerId:'c1',domain:'business',onDomain:d=>selected.push(d),onReceipts:r=>rows=r}));return {get refresh(){return refresh},get rows(){return rows},selected};}
test('right submits once, auto publishes server receipt and refreshes without extra controls',async t=>{
 t.after(cleanup);localStorage.clear();let finish;let posts=0;let history=[];
 const api={active:async()=>null,history:async()=>history,plan:async()=>plan,advance:async(_c,_p,q)=>{posts++;return new Promise(resolve=>finish=()=>{history=[{...makeReceipt(),requestId:q}];resolve(history[0])})}};
 let state;await act(async()=>{state=setup(api)});
 const button=screen.getByRole('button',{name:'推进下一专业列'});
 fireEvent.click(button);fireEvent.click(button);await waitFor(()=>assert.equal(posts,1));assert.equal(button.disabled,true);
 await act(async()=>finish());await waitFor(()=>assert.equal(state.rows[0]?.version,2));assert.ok(state.refresh>=2);
 assert.equal(screen.queryByText('执行本列计划'),null);assert.equal(screen.queryByText('刷新列结果'),null);
 assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),null);assert.equal(state.selected.length,0);
});
test('unknown remount recovers original request without POST or a user refresh',async t=>{
 t.after(cleanup);localStorage.clear();localStorage.setItem('jw:column-advance:pending:c1','q1');let posts=0;let recovered=[];
 const api={active:async()=>null,history:async()=>[],recover:async(_c,q)=>{recovered.push(q);return makeReceipt()},advance:async()=>{posts++}};
 let state;await act(async()=>{state=setup(api)});await waitFor(()=>assert.equal(state.rows.length,1));assert.deepEqual(recovered,['q1']);assert.equal(posts,0);assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),null);
});
test('right reuses already completed next column without executing again',async t=>{
 t.after(cleanup);localStorage.clear();let posts=0;const history=[makeReceipt('completed'),{...makeReceipt('completed'),roundId:'r2',domain:'policy'}];
 const api={active:async()=>null,history:async()=>history,advance:async()=>{posts++}};let state;
 await act(async()=>{state=setup(api)});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'推进下一专业列'})));
 assert.deepEqual(state.selected,['policy']);assert.equal(posts,0);
});

test('partial reports cannot paint a complete column; current server results can',async()=>{
 const {projectColumnReceipts}=await import('../../../site-mirror/app/takeoff/column-projection.ts');
 const cells=['input','analysis','human','closure'].map(row=>({domain:'opportunity',row,completed:false,running:false,displayBucket:null,needsReview:false,frozen:false,allowedActions:[],items:[],basis:'',responsible:null}));
 const partial=makeReceipt();assert.equal(projectColumnReceipts(cells,[partial],'c1').some(c=>c.completed),false);
 const complete=makeReceipt('completed');assert.equal(projectColumnReceipts(cells,[complete],'c1').every(c=>c.completed),true);
 assert.equal(projectColumnReceipts(cells,[{...complete,current:false}],'c1').some(c=>c.completed),false);
 assert.equal(projectColumnReceipts(cells,[complete],'other').some(c=>c.completed),false);
});

test('unknown POST is automatically reconciled with the same request and never resent',async t=>{
 t.after(cleanup);localStorage.clear();let posts=0,reads=0,requestId='';let history=[];
 const api={active:async()=>null,history:async()=>history,plan:async()=>plan,
  advance:async(_c,_p,q)=>{posts++;requestId=q;throw new Error('network result unknown')},
  recover:async(_c,q)=>{assert.equal(q,requestId);reads++;const r={...makeReceipt(reads===1?'unknown':'awaiting_confirmation'),requestId:q};if(reads>1)history=[r];return r;}};
 let state;await act(async()=>{state=setup(api)});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'推进下一专业列'})));
 await waitFor(()=>assert.ok(reads>=2),{timeout:3500});
 assert.equal(posts,1);assert.equal(state.rows[0].state,'awaiting_confirmation');assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),null);
});

test('processing still permits read-only previous recorded column',async t=>{
 t.after(cleanup);localStorage.clear();let selected=[];let posts=0;
 const r={...makeReceipt('unknown'),domain:'policy',roundId:'r2'};
 const wb={client:{advance:{active:async()=>r,history:async()=>[makeReceipt(),r],advance:async()=>{posts++}}},session:{sessionId:'s1'},refresh:async()=>{}};
 await act(async()=>render(React.createElement(ColumnAdvance,{wb,customerId:'c1',domain:'policy',onDomain:d=>selected.push(d),onReceipts:()=>{}})));
 assert.equal(screen.getByRole('button',{name:'推进下一专业列'}).disabled,false);
 fireEvent.click(screen.getByRole('button',{name:'上一专业列'}));assert.deepEqual(selected,['business']);assert.equal(posts,0);
});
test('parallel non-current receipt updates publish without changing viewed domain',async t=>{
 t.after(cleanup);localStorage.clear();let reads=0;
 const policy={...makeReceipt('unknown'),domain:'policy',roundId:'r2',version:1};
 const api={active:async()=>policy,history:async()=>{reads++;return [makeReceipt(),{...policy,version:reads>1?2:1,state:reads>1?'completed':'unknown'}]}};
 let state;await act(async()=>{state=setup(api)});
 await waitFor(()=>assert.equal(state.rows.find(r=>r.domain==='policy')?.version,2),{timeout:3500});
 assert.equal(state.rows.find(r=>r.domain==='policy').state,'completed');assert.deepEqual(state.selected,[]);
});


test('late old-customer response cannot publish into the new customer',async t=>{
 t.after(cleanup);localStorage.clear();let resolveOld;let oldRows=[],newRows=[];
 const oldApi={active:async()=>null,history:()=>new Promise(resolve=>resolveOld=resolve)};
 const oldWb={client:{advance:oldApi},session:{sessionId:'s1'},refresh:async()=>{}};
 let view;await act(async()=>{view=render(React.createElement(ColumnAdvance,{wb:oldWb,customerId:'c1',domain:'business',onDomain:()=>{},onReceipts:r=>oldRows=r}))});
 view.unmount();
 const newWb={client:{advance:{active:async()=>null,history:async()=>[]}},session:{sessionId:'s2'},refresh:async()=>{}};
 await act(async()=>render(React.createElement(ColumnAdvance,{wb:newWb,customerId:'c2',domain:'business',onDomain:()=>{},onReceipts:r=>newRows=r})));
 await act(async()=>resolveOld([makeReceipt()]));assert.deepEqual(oldRows,[]);assert.deepEqual(newRows,[]);
});

test('core right arrow explicitly adopts shown result, not just browsing past confirmation',async t=>{
 t.after(cleanup);localStorage.clear();let commands=[];let history=[{...makeReceipt(),views:{decisions:{candidate:{summary:'本轮实际意见'},requiredDecision:{roundId:'r1',resultId:'result1',choices:['adopt','set_aside']}}}},{...makeReceipt(),domain:'policy',roundId:'r2'}];
 const api={active:async()=>null,history:async()=>history,decide:async(cid,r,required,decision,requestId)=>{commands.push({cid,round:r.roundId,required,decision});history=[{...makeReceipt('completed'),selection:{candidateId:'result1',eventId:'event1',decision:'adopt'}},history[1]];return history[0];}};
 let state;await act(async()=>{state=setup(api)});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'采用本列意见并继续'})));
 assert.equal(commands.length,1);assert.equal(commands[0].decision,'adopt');assert.deepEqual(state.selected,['policy']);assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),null);
});
test('ambiguous human selection stays fenced when recovery lacks selection event',async t=>{
 t.after(cleanup);localStorage.clear();localStorage.setItem('jw:column-advance:pending:c1','q1');localStorage.setItem('jw:column-advance:pending:c1:decision',JSON.stringify({resultId:'result1',decision:'adopt'}));
 const api={active:async()=>null,history:async()=>[makeReceipt()],recover:async()=>makeReceipt()};await act(async()=>setup(api));
 assert.equal(localStorage.getItem('jw:column-advance:pending:c1'),'q1');assert.ok(screen.getByText(/处理中/));localStorage.clear();
});

test('persisted reject selection distinguishes credit rejection from stopped downstream',async()=>{
 const {projectColumnReceipts}=await import('../../../site-mirror/app/takeoff/column-projection.ts');
 const {cellStatus}=await import('../../../site-mirror/app/takeoff/cell-status.ts');
 const makeCell=domain=>({domain,row:'closure',completed:false,running:false,displayBucket:null,needsReview:false,frozen:false,items:[],allowedActions:[],basis:'',responsible:null});
 const rejected={...makeReceipt('rejected'),domain:'credit',caseOutcome:{status:'rejected',archiveRef:'archive'},selection:{decision:'reject',eventId:'human-event'},columnResults:[{itemId:'completion',state:'rejected'}]};
 const stopped={...rejected,domain:'commerce',roundId:'r2',selection:null};
 const cells=projectColumnReceipts([makeCell('credit'),makeCell('commerce')],[rejected,stopped],'c1');
 assert.equal(cellStatus(cells[0],cells).icon,'cross');assert.equal(cellStatus(cells[1],cells).icon,'lock');
});

test('server pending list routes back to affected policy and keeps evidence wait visible',async()=>{
 const {nextRequired}=await import('../../../site-mirror/app/takeoff/column-advance.tsx');
 const policy={...makeReceipt(),domain:'policy',roundId:'p2',needsReselection:[{domain:'policy',roundId:'p2'}]};
 const credit={...makeReceipt('waiting_evidence'),domain:'credit',roundId:'c1'};
 assert.equal(nextRequired([policy,credit],'asset'),'policy');assert.equal(nextRequired([policy,credit],'policy'),'credit');
 assert.equal(nextRequired([{...policy,current:false},credit],'credit'),undefined);
});

test('one adoption arrow starts only the next unstarted column without auto adopting its result',async t=>{
 t.after(cleanup);localStorage.clear();let starts=[],choices=[];
 let history=[{...makeReceipt(),views:{decisions:{requiredDecision:{roundId:'r1',resultId:'result1',choices:['adopt']}}}}];
 const api={active:async()=>null,history:async()=>history,decide:async(_c,_r,_req,decision)=>{choices.push(decision);history=[{...makeReceipt('completed'),selection:{candidateId:'result1',eventId:'event1',decision}}];return history[0];},plan:async(_c,d)=>({...plan,domain:d}),advance:async(_c,p,q)=>{starts.push(p.domain);const r={...makeReceipt(),domain:p.domain,roundId:'r2',requestId:q};history.push(r);return r;}};
 let state;await act(async()=>{state=setup(api)});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'采用本列意见并继续'})));
 assert.deepEqual(choices,['adopt']);assert.deepEqual(starts,['policy']);assert.deepEqual(state.selected,['policy']);assert.equal(history[1].state,'awaiting_confirmation');
});
