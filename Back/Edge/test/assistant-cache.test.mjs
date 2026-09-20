import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';
import os from 'node:os';
const own=os.tmpdir();
async function fixture(id){
 const dir=await fs.mkdtemp(path.join(own,'repro-'+id+'-'));let hits=0; const control={delay:0,onHit:null};
 const server=http.createServer((req,res)=>{req.resume();req.on('end',async()=>{hits++;await control.onHit?.();if(control.delay)await new Promise(r=>setTimeout(r,control.delay));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({observations:['synthetic response '+hits],questions:[],evidenceRefs:[]})}}],usage:{prompt_tokens:10,completion_tokens:5}}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const configPath=path.join(dir,'synthetic-config.json');
 await fs.writeFile(configPath,JSON.stringify({transport:{mode:'mock',mock:{baseUrl:`http://127.0.0.1:${server.address().port}`,model:'offline-fixture',timeoutMs:1000}},budget:{maxTotalCost:1,perCallEstimate:0.01}}));
 const args={configPath,receiptsDir:path.join(dir,'receipts'),costLedgerPath:path.join(dir,'ledger.jsonl')};
 const model=await createAssistantModel(args);
 const base={customerId:'eval-synthetic-customer',tenantId:'eval-tenant-A',assistant:'credit',question:'请核对当前候选方案',context:{customerName:'合成样本',contextVersion:'0',assessmentState:'awaiting_human_review',candidate:{version:1,suggestedAmount:1000000,suggestedTermMonths:36,tendency:'cautious_do'},blockersCount:1,materialsByDomain:{credit:1},evidenceRefs:[]}};
 return{model,base,control,hits:()=>hits,restart:()=>createAssistantModel(args),args,configPath,dir,close:async()=>{await new Promise(r=>{server.closeAllConnections();server.close(r);});await fs.rm(dir,{recursive:true,force:true});}};
}
async function record() {}

test('EVAL-CACHE-01: changed candidate at identical input version must not replay stale observation',async()=>{
 const f=await fixture('candidate');try{const a=await f.model.observe(f.base);const changed=structuredClone(f.base);changed.context.candidate.version=2;changed.context.candidate.suggestedAmount=2000000;const b=await f.model.observe(changed);await record(f,'cache-candidate',a,b);assert.notEqual(b.payloadHash,a.payloadHash);assert.equal(b.replayed,false,'changed payload incorrectly replays old terminal receipt');}finally{await f.close();}
});
test('EVAL-CACHE-02: tenant change with colliding customer ID must not reuse other tenant receipt',async()=>{
 const f=await fixture('tenant');try{const a=await f.model.observe(f.base);const b=await f.model.observe({...f.base,tenantId:'eval-tenant-B'});await record(f,'cache-tenant',a,b);assert.equal(b.replayed,false,'tenant B received tenant A terminal receipt');}finally{await f.close();}
});
test('EVAL-CACHE-03: input version change creates independent receipt',async()=>{
 const f=await fixture('version');try{const a=await f.model.observe(f.base);const changed=structuredClone(f.base);changed.context.contextVersion='1';const b=await f.model.observe(changed);await record(f,'cache-version',a,b);assert.equal(b.replayed,false);assert.notEqual(a.requestId,b.requestId);assert.equal(f.hits(),2);}finally{await f.close();}
});
test('EVAL-CACHE-04: identical request replay after fresh model instance sends no new request',async()=>{
 const f=await fixture('restart');try{const a=await f.model.observe(f.base);const restarted=await f.restart();const b=await restarted.observe(f.base);await record(f,'cache-restart',a,b);assert.equal(b.replayed,true);assert.equal(f.hits(),1);assert.deepEqual(a.observations,b.observations);}finally{await f.close();}
});
test('EVAL-CACHE-05: actual Edge HTTP route must refresh observation after candidate revision',async()=>{
 const f=await fixture('route');const store=createFixtureStore();
 const snapshot={customer:{name:'合成样本'},admission:{inputVersion:0,scope:{revision:4,tenantId:'eval-tenant-A'},assessmentState:'awaiting_human_review',candidate:{version:1,suggestedAmount:1000000,suggestedTermMonths:36,tendency:'cautious_do'},cells:[],blockers:[]}};
 store.upsertCustomer(f.base.customerId,snapshot);
 const edge=await startEdgeServer({port:0,seal:{buildId:'eval-isolated'},probes:[],store,sessionStore:createSessionStore({}),verifyCredential:async()=>({ok:true,principalId:'synthetic-reviewer',roles:['admin'],tenantId:'eval-tenant-A'}),auth:async({session})=>({ok:!!session}),assistantModel:f.model});
 try{
 const base=`http://127.0.0.1:${edge.port}`;
 const sr=await fetch(base+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:'synthetic-only'})});const sid=(await sr.json()).session.sessionId;
 const ask=async()=>{const r=await fetch(base+`/api/jw/v2/actions/customers/${f.base.customerId}/assistant/observe`,{method:'POST',headers:{'content-type':'application/json','x-jw-session':sid},body:JSON.stringify({assistant:'credit',question:f.base.question})});assert.equal(r.status,200);return r.json();};
 const a=await ask();snapshot.admission.scope.revision=5;snapshot.admission.candidate.version=2;snapshot.admission.candidate.suggestedAmount=2000000;store.upsertCustomer(f.base.customerId,snapshot);const b=await ask();await record(f,'cache-route',a,b);
 assert.equal(a.authority,'none');assert.equal(b.model.replayed,false,'Edge returned stale observation after authoritative projection changed');
 }finally{await f.close();edge.server.closeAllConnections();await new Promise(r=>edge.server.close(r));}
});

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const receiptPath = (f,id) => path.join(f.args.receiptsDir,'receipts',encodeURIComponent(id)+'.json');
const oldId = b => {
 const hash = s => createHash('sha256').update(s).digest('hex');
 return `amq:${b.customerId}:${hash(String(b.context.contextVersion)).slice(0,8)}::obs:${b.assistant}:${hash(b.assistant+'\n'+b.question.trim()).slice(0,12)}::a1`;
};

test('request, assessment revision and complete candidate fields invalidate independently',async t=>{
 const f=await fixture('request');t.after(f.close);
 const first=await f.model.observe(f.base);
 for(const change of [
  {request:{requestedAmount:123,purpose:'new request'}},
  {scope:{assessmentId:'other',revision:9}},
  {candidate:{...f.base.context.candidate,conditions:['new condition']}},
 ]) {
  const next=await f.model.observe({...f.base,context:{...f.base.context,...change}});
  assert.equal(next.replayed,false);assert.notEqual(next.contextHash,first.contextHash);
 }
 assert.equal(f.hits(),4);
});

test('same origin model/path/output config changes invalidate; secret-only rotation does not',async t=>{
 const f=await fixture('config');t.after(f.close);
 const a=await f.model.observe(f.base);
 const config=JSON.parse(await fs.readFile(f.configPath,'utf8'));
 config.transport.mock.model='different-model';
 await fs.writeFile(f.configPath,JSON.stringify(config));
 const b=await (await f.restart()).observe(f.base);
 assert.notEqual(a.configHash,b.configHash);assert.equal(b.replayed,false);
 config.transport.mock.baseUrl+='/other';
 await fs.writeFile(f.configPath,JSON.stringify(config));
 const c=await (await f.restart()).observe(f.base);
 assert.notEqual(b.configHash,c.configHash);
 config.transport.mock.apiKey='synthetic-secret-never-persist';
 await fs.writeFile(f.configPath,JSON.stringify(config));
 const d=await (await f.restart()).observe(f.base);
 assert.equal(d.replayed,true);assert.equal(f.hits(),3);
 assert.ok(!(await fs.readFile(receiptPath(f,d.requestId),'utf8')).includes(config.transport.mock.apiKey));
});

test('same process concurrent instances share one flight and preserve immutable intent',async t=>{
 const f=await fixture('concurrent');t.after(f.close);f.control.delay=80;
 const other=await f.restart();
 const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?other:f.model).observe(f.base)));
 assert.equal(f.hits(),1);assert.ok(results.every(x=>x.status==='simulated'));
 assert.equal(new Set(results.map(x=>x.requestId)).size,1);
 const id=results[0].requestId;
 assert.equal(JSON.parse(await fs.readFile(receiptPath(f,id+':intent'),'utf8')).phase,'intent');
 assert.equal(JSON.parse(await fs.readFile(receiptPath(f,id),'utf8')).phase,'terminal');
});

test('two OS processes claim atomically; fresh process replays durable terminal',async t=>{
 const f=await fixture('process');t.after(f.close);f.control.delay=180;
 const moduleUrl=new URL('../src/assistant-model.mjs',import.meta.url).href;
 const script=`import {createAssistantModel} from ${JSON.stringify(moduleUrl)};
 const model=await createAssistantModel(${JSON.stringify(f.args)});
 console.log(JSON.stringify(await model.observe(${JSON.stringify(f.base)})));`;
 const run=async()=>JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:10000})).stdout.trim());
 const results=await Promise.all([run(),run()]);
 assert.equal(f.hits(),1);assert.ok(results.some(r=>r.status==='simulated'));
 assert.ok(results.every(r=>['simulated','unknown'].includes(r.status)));
 assert.equal((await run()).replayed,true);assert.equal(f.hits(),1);
});

for (const kind of ['intent','unknown','corrupt','success']) test('legacy '+kind+' stays historical, uncertain blocks',async t=>{
 const f=await fixture('legacy');t.after(f.close);
 const id=oldId(f.base);await fs.mkdir(path.dirname(receiptPath(f,id)),{recursive:true});
 const record=kind==='intent'?{phase:'intent'}:{phase:'terminal',outcome:{status:kind==='success'?'simulated':'unknown',sentFlag:kind==='success'?true:null}};
 const raw=kind==='corrupt'?'{broken':JSON.stringify(record);
 await fs.writeFile(receiptPath(f,id),raw);
 const r=await f.model.observe(f.base);
 assert.equal(f.hits(),kind==='success'?1:0);assert.equal(r.status,kind==='success'?'simulated':'unknown');
 assert.equal(await fs.readFile(receiptPath(f,id),'utf8'),raw);
});

for (const kind of ['identity','corrupt','null','intent','claim']) test('durable '+kind+' never blindly resends',async t=>{
 const f=await fixture('durable');t.after(f.close);
 const r=await f.model.observe(f.base);const file=receiptPath(f,r.requestId);
 if(kind==='identity'){
  const record=JSON.parse(await fs.readFile(file,'utf8'));record.identity.tenantId='wrong';
  await fs.writeFile(file,JSON.stringify(record));
 } else if(kind==='corrupt') await fs.writeFile(file,'{broken');
 else if(kind==='null') await fs.writeFile(file,'null');
 else {
  await fs.unlink(file);
  if(kind==='claim') await fs.unlink(receiptPath(f,r.requestId+':intent'));
 }
 const after=await (await f.restart()).observe(f.base);
 assert.equal(after.status,'unknown');assert.equal(after.current,false);assert.equal(f.hits(),1);
});

for(const change of ['context','revoke','session','unavailable']) test('Edge rechecks after model wait: '+change,async t=>{
 const f=await fixture('wait');t.after(f.close);
 const store=createFixtureStore();const sessions=createSessionStore({});
 const snapshot={customer:{name:'synthetic'},admission:{inputVersion:0,scope:{revision:1,tenantId:f.base.tenantId},candidate:{version:1},cells:[],blockers:[]}};
 store.upsertCustomer(f.base.customerId,snapshot);
 let allowed=true;let sid;
 const originalRead=store.getWorkspace.bind(store);
 f.control.onHit=async()=>{
  if(change==='context'){snapshot.admission.scope.revision++;store.upsertCustomer(f.base.customerId,snapshot);}
  if(change==='revoke')allowed=false;
  if(change==='session')sessions.revoke(sid);
  if(change==='unavailable')store.getWorkspace=async()=>{throw new Error('synthetic read failure');};
 };
 const edge=await startEdgeServer({port:0,seal:{buildId:'test'},probes:[],store,sessionStore:sessions,
 verifyCredential:async()=>({ok:true,principalId:'tester',roles:['admin'],tenantId:f.base.tenantId}),
 auth:async({session})=>({ok:!!session&&allowed}),assistantModel:f.model});
 t.after(async()=>{edge.server.closeAllConnections();await new Promise(r=>edge.server.close(r));});
 const origin=`http://127.0.0.1:${edge.port}`;
 const sr=await fetch(origin+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:'synthetic'})});
 sid=(await sr.json()).session.sessionId;
 const ask=()=>fetch(origin+`/api/jw/v2/actions/customers/${f.base.customerId}/assistant/observe`,{method:'POST',headers:{'content-type':'application/json','x-jw-session':sid},body:JSON.stringify({assistant:'credit',question:'test'})});
 const response=await ask();const body=await response.json();
 if(['context','unavailable'].includes(change)){
  assert.equal(response.status,200);assert.equal(body.model.current,false);assert.deepEqual(body.observations,[]);
  assert.ok(body.model.usage);assert.equal(body.model.receiptVersion,2);
 }else{
  assert.equal(response.status,change==='session'?401:403);assert.equal(body.observations,undefined);
  const again=await ask();assert.equal(again.status,response.status);assert.equal(f.hits(),1);
 }
 const files=await fs.readdir(path.join(f.args.receiptsDir,'receipts'));
 const terminal=files.filter(n=>n.endsWith('.json')&&!n.includes('%3Aintent'));
 assert.equal(terminal.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(f.args.receiptsDir,'receipts',terminal[0]),'utf8')).outcome.status,'simulated');
 store.getWorkspace=originalRead;
});

test('stable key order and projection clock do not cause a new send',async t=>{
 const f=await fixture('stable');t.after(f.close);
 const a=await f.model.observe(f.base);
 const reordered={...f.base,context:Object.fromEntries(Object.entries(f.base.context).reverse())};
 assert.equal((await f.model.observe(reordered)).requestId,a.requestId);assert.equal(f.hits(),1);
 const {workspaceContext,contextHash}=await import('../src/assistant-receipts.mjs');
 const snapshot={admission:{scope:{assessmentId:'a',revision:1,asOf:'one'}}};
 const before=contextHash(workspaceContext(snapshot,'credit'));
 snapshot.admission.scope.asOf='two';
 assert.equal(contextHash(workspaceContext(snapshot,'credit')),before);
});

test('output cap change creates independent configuration identity',async t=>{
 const f=await fixture('limit');t.after(f.close);
 const a=await f.model.observe(f.base);
 const c=JSON.parse(await fs.readFile(f.configPath,'utf8'));c.transport.mock.maxOutputTokens=250;
 await fs.writeFile(f.configPath,JSON.stringify(c));
 const b=await (await f.restart()).observe(f.base);
 assert.notEqual(a.configHash,b.configHash);assert.equal(b.replayed,false);assert.equal(f.hits(),2);
});
