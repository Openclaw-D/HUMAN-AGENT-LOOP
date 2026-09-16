import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { simpleTemplate, PRINCIPAL_SPEC } from '../../../Back/A/test/utils.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const a=path.join(root,'Back/A');
const url='postgres://jw:jw-local-demo@127.0.0.1:15442/jw'; // synthetic local migration DB
const steps=[]; let child=null;
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function stop(){if(child && child.exitCode===null){const p=once(child,'exit');child.kill();await p;}child=null;}
async function start(){
 const port=await freePort(); const base=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['src/index.ts','--port',String(port),'--db',url,'--principal-tokens',PRINCIPAL_SPEC],{cwd:a,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<60;i++){if(child.exitCode!==null)throw new Error('Kernel exited '+output);try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(500)});if(r.ok)return base;}catch{}await new Promise(r=>setTimeout(r,200));}
 throw new Error('Health timeout '+output);
}
async function request(base,method,route,body,token='tok-admin'){
 const headers={'content-type':'application/json'};if(token)headers['x-principal-credential']=token;
 const r=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
 return {status:r.status,json:await r.json()};
}
const rid=()=>randomUUID();
try{
 let base=await start();steps.push('fresh PostgreSQL migrations and HTTP health');
 let r=await request(base,'POST','/api/v1/templates',simpleTemplate('jw-v01-migration-'+rid()));assert.equal(r.status,200,JSON.stringify(r.json));const templateId=r.json.templateId;
 const p=await request(base,'POST','/api/v1/projects',{requestId:rid(),templateId,name:'JW migration synthetic'},'tok-business');assert.equal(p.status,200);const id=p.json.projectId;
 const input={requestId:rid(),expectedVersion:1,kind:'doc',content:{text:'synthetic migration evidence'}};
 r=await request(base,'POST',`/api/v1/projects/${id}/evidence`,input,'tok-business');assert.equal(r.status,200);
 r=await request(base,'POST',`/api/v1/projects/${id}/evidence`,input,'tok-business');assert.equal(r.status,200);assert.equal(r.json.replayed,true);steps.push('template project evidence + idempotent replay');
 r=await request(base,'POST',`/api/v1/projects/${id}/goals`,{requestId:rid(),goalKey:'review'},'tok-business');assert.equal(r.status,200);const g=r.json.goal;
 const denied=await request(base,'POST',`/api/v1/goals/${g.goalId}/claim`,{requestId:rid(),expectedVersion:g.version},null);assert.equal(denied.status,403);steps.push('anonymous sensitive write rejected');
 r=await request(base,'POST',`/api/v1/goals/${g.goalId}/claim`,{requestId:rid(),expectedVersion:g.version},'tok-agent');assert.equal(r.status,200);
 r=await request(base,'POST',`/api/v1/goals/${g.goalId}/complete`,{requestId:rid(),expectedVersion:r.json.goalVersion,fencingToken:r.json.fencingToken,result:{provider:'simulation',output:{summary:'migration smoke'}}},'tok-agent');assert.equal(r.status,200);assert.equal(r.json.status,'candidate_ready');steps.push('claim and candidate completion');
 const before=await request(base,'GET',`/api/v1/goals/${g.goalId}`);await stop();base=await start();
 const after=await request(base,'GET',`/api/v1/goals/${g.goalId}`);assert.deepEqual(after.json,before.json);steps.push('kernel restart preserves goal projection');
 const result={time:new Date().toISOString(),status:'PASS',steps,projectId:id,db:'jw-v01-pg:15442/jw',scope:'synthetic HTTP + persistence, not full product acceptance'};
 fs.writeFileSync(path.join(root,'Achieve/Migration/backend-smoke.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{await stop();}
