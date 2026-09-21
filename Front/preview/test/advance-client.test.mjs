import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdvanceClient} from '../../site-mirror/lib/workbench/advance-client.ts';
const receipt={customerId:'c1',requestId:'q1',roundId:'r1',domain:'business',version:2,roundNo:1,state:'needs_reassessment',updatedAt:null,columnResults:[{itemId:'analysis',state:'blocked',reason:'COLUMN_ANALYSIS_NOT_CONNECTED'}],downstream:[{domain:'policy',state:'waiting_dependency'}]};
test('real receipt shape, history and same-round newer version',async()=>{
 let version=2;
 const api=createAdvanceClient('',()=>({}),async url=>new Response(JSON.stringify(url.endsWith('/advance-rounds')?{receipts:[receipt]}:{receipt:{...receipt,version}})));
 assert.equal((await api.history('c1'))[0].columnResults[0].state,'blocked');
 assert.equal((await api.receipt('c1','r1')).version,2);version=3;
 assert.equal((await api.receipt('c1','r1')).version,3);
 await assert.rejects(api.receipt('c2','r1'),/核对/);
});
test('POST uses exact server plan and rejects mismatched request',async()=>{
 let sent;const plan={customerId:'c1',available:true,domain:'business',planId:'p',planHash:'h',expectedVersion:{customerRevision:1},roundNo:1,summary:'report',allowedActions:[{actionId:'report.customer_supplement',commandKind:'report.generate'}]};
 const api=createAdvanceClient('',()=>({}),async(url,init)=>{sent={url,...init};return new Response(JSON.stringify({receipt}));});
 await api.advance('c1',plan,'q1');assert.equal(sent.method,'POST');assert.equal(JSON.parse(sent.body).planHash,'h');assert.deepEqual(JSON.parse(sent.body).actionIds,['report.customer_supplement']);
 await assert.rejects(api.advance('c1',plan,'q2'),/核对/);
});
