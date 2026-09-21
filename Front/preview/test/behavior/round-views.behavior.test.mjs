import test from 'node:test';
import assert from 'node:assert/strict';
import {render,screen,cleanup,act} from './harness.mjs';
const React=(await import('react')).default;
const {readColumnReceipt}=await import('../../../site-mirror/lib/workbench/advance-client.ts');
const {MaterialsDesk}=await import('../../../site-mirror/app/takeoff/materials-desk.tsx');
const {RoleFlow}=await import('../../../site-mirror/app/takeoff/role-flow.tsx');
const {WorkTimeline}=await import('../../../site-mirror/app/takeoff/work-timeline.tsx');
function receipt(){const c={customerId:'c1',processId:'p1',roundId:'r1',domain:'business',version:2,current:true,serverUpdatedAt:'2026-09-21T09:30:00Z'};return {...c,requestId:'q1',roundNo:1,state:'awaiting_confirmation',updatedAt:c.serverUpdatedAt,columnResults:[],downstream:[],views:{platform:{...c,cells:[]},materials:{...c,items:[{artifactId:'a1',hash:'hash1'}]},decisions:{...c,candidate:{assessment:{summary:'同轮合成分析'},sourceMode:'synthetic'},selection:null},flow:{...c,events:[{eventId:'evt1',domain:'business',jobId:'r1',type:'ADVANCE_COLUMN_RESULT',at:c.serverUpdatedAt,actor:'principal-17',version:2}]},history:{...c,actor:{principalId:'principal-17',roles:['business']}}}};}
const wb={session:{sessionId:'s1',roles:['business']},client:{read:async()=>({artifacts:[{artifactId:'a1',kind:'invoice',current:true,displayName:'本轮原件'},{artifactId:'a2',kind:'invoice',current:true,displayName:'其他轮材料'}]}),eventsPage:async()=>({events:[],hasMore:false,nextAfterSeq:null})}};
test('mixed-version or cross-customer views fail closed',()=>{const r=receipt();assert.equal(readColumnReceipt(r,'c1'),r);const bad=structuredClone(r);bad.views.decisions.version=1;assert.throws(()=>readColumnReceipt(bad,'c1'));const other=structuredClone(r);other.views.materials.customerId='c2';assert.throws(()=>readColumnReceipt(other,'c1'));});
test('materials renders only explicit same-round references',async t=>{t.after(cleanup);await act(async()=>render(React.createElement(MaterialsDesk,{wb,customerId:'c1',onUpload:()=>{},round:receipt()})));assert.ok(screen.getByRole('article',{name:'材料卡片：本轮原件'}));assert.equal(screen.queryByRole('article',{name:'材料卡片：其他轮材料'}),null);assert.ok(screen.getByText(/本轮引用 1 份 · v2/));});
test('decision reader consumes round view rather than newer chat candidates',async t=>{t.after(cleanup);await act(async()=>render(React.createElement(RoleFlow,{wb,cells:[],top:{},activeDomain:'opportunity',round:receipt()})));assert.ok(screen.getByText('同轮合成分析'));assert.ok(screen.getByText('synthetic'));assert.equal(document.querySelector('.tk-round-selected'),null);});
test('timeline uses server event timestamp and actual actor, roles remain separate',async t=>{t.after(cleanup);await act(async()=>render(React.createElement(WorkTimeline,{wb,customerId:'c1',rounds:[receipt()]})));assert.ok(screen.getByText(/操作者：principal-17 · 角色：business/));assert.ok(screen.getByText(/v2 · r1/));assert.equal(screen.queryByText(/操作者：business/),null);});

test('missing live artifact still previews immutable round content',async t=>{
 t.after(cleanup);const r=receipt();r.views.materials.items=[{artifactId:'old-only',kind:'financial_statement',content:{value:12345,proof:'frozen-only'}}];
 const local={...wb,client:{...wb.client,read:async()=>({artifacts:[]})}};
 await act(async()=>render(React.createElement(MaterialsDesk,{wb:local,customerId:'c1',onUpload:()=>{},round:r})));
 const card=screen.getByRole('article');await act(async()=>card.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
 assert.ok(screen.getByText(/frozen-only/));
});
