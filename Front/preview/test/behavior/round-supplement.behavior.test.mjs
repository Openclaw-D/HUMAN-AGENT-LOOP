import test from 'node:test';import assert from 'node:assert/strict';
import {render,screen,fireEvent,cleanup,act} from './harness.mjs';
const React=(await import('react')).default;const {RoundSupplement}=await import('../../../site-mirror/app/takeoff/round-supplement.tsx');
test('explicit evidence verification uses authoritative customer tenant and immutable supersedes',async t=>{
 t.after(cleanup);localStorage.clear();const calls=[];const wb={session:{tenantId:null},snapshot:{customer:{customerId:'c1',tenantId:'authorized-tenant'}},client:{registerArtifact:async(id,body)=>{calls.push({id,body});return {ok:true}}},refresh:async()=>{}};
 const round={customerId:'c1',roundId:'r1',domain:'credit',caseOutcome:{sourceMode:'synthetic',status:'in_progress'},views:{decisions:{candidate:{evidenceRefs:[{materialId:'original1',location:{field:'monthly_operating_cash_flow'}}]}}}};
 render(React.createElement(RoundSupplement,{wb,round}));
 const submit=screen.getByRole('button',{name:'登记补件并重评'});assert.equal(submit.disabled,true);
 fireEvent.change(screen.getByLabelText('月经营现金流（元）'),{target:{value:'200000'}});fireEvent.change(screen.getByLabelText('核验依据说明'),{target:{value:'synthetic evidence checked'}});assert.equal(submit.disabled,true);
 fireEvent.click(screen.getByRole('checkbox'));await act(async()=>fireEvent.click(submit));assert.equal(calls.length,1);assert.equal(calls[0].body.tenantId,'authorized-tenant');assert.equal(calls[0].body.supersedes,'original1');assert.equal(calls[0].body.content.value,200000);assert.equal(calls[0].body.grade,'confirmed');
});

test('unknown supplement survives remount and explicitly retries identical id and content',async t=>{
 t.after(cleanup);localStorage.clear();const calls=[];let fail=true;
 const wb={session:{tenantId:'t1'},client:{registerArtifact:async(_id,body)=>{calls.push(body);if(fail)throw new Error('lost response');return {ok:true}}},refresh:async()=>{}};
 const round={customerId:'c1',domain:'credit',caseOutcome:{sourceMode:'synthetic',status:'in_progress'},views:{decisions:{candidate:{evidenceRefs:[{materialId:'old',location:{field:'monthly_operating_cash_flow'}}]}}}};
 render(React.createElement(RoundSupplement,{wb,round}));fireEvent.change(screen.getByLabelText('月经营现金流（元）'),{target:{value:'200000'}});fireEvent.change(screen.getByLabelText('核验依据说明'),{target:{value:'confirmed synthetic proof'}});fireEvent.click(screen.getByRole('checkbox'));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'登记补件并重评'})));
 const pending=JSON.parse(localStorage.getItem('jw:round-supplement:c1'));assert.equal(pending.phase,'registering');cleanup();fail=false;
 render(React.createElement(RoundSupplement,{wb,round}));assert.equal(screen.getByLabelText('月经营现金流（元）').disabled,true);assert.equal(calls.length,1);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'继续核对原补证'})));assert.deepEqual(calls[1],calls[0]);assert.equal(localStorage.getItem('jw:round-supplement:c1'),null);
});
