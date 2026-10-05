// Explicit real model requests over approved original bytes, using a disposable synthetic HTTP runtime.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRepairRuntime, HUMAN, TENANT } from '../test/api-repair-runtime.mjs';
import { buildZoneSemantic } from '../src/domain/zone-semantic.ts';
import { parseArtifactBytes } from '../../C/src/parse/adapters.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required');
const configPath=arg('model-config'), manifestPath=arg('manifest'), inputsRoot=arg('inputs'), out=arg('output');
if([configPath,manifestPath,inputsRoot,out].some(v=>!v))throw new Error('Explicit config/manifest/inputs/output required');
const selected=(arg('cases')??'lt3-I07,lt3-I12,lt3-I16').split(',');
const cfg=JSON.parse(await readFile(configPath,'utf8'));
if(cfg.transport.mode!=='real'||new URL(cfg.transport.real.endpoint).origin!=='https://api.deepseek.com'||cfg.transport.real.model!=='deepseek-flash')throw new Error('Approved provider mismatch');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const sources=[];
for(const id of selected){const c=manifest.cases.find(c=>c.caseId===id);if(!c)throw new Error('Unapproved case');const files=[];
  for(const f of c.files){const bytes=await readFile(path.join(inputsRoot,id,f.name));const hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==f.sha256||bytes.length!==f.bytes||!cfg.evidencePolicy.allowedHashes.includes(hash))throw new Error('Original authorization mismatch');
    const parsed=parseArtifactBytes(bytes,{fileName:f.name});if(!parsed.ok)throw new Error('Original parse failed');files.push({file:f,hash,bytes,parsed});}
  sources.push({c,files});
}
await mkdir(out,{recursive:true});
const model=buildZoneSemantic({configPath,receiptsDir:path.join(out,'semantic-receipts')});
const modelCalls=[];
const semantic={describe:model.describe,run:async ctx=>{const started=performance.now();const result=await model.run(ctx);
  modelCalls.push({requestId:ctx.requestId,customerId:ctx.customerId,jobId:ctx.jobId,domain:ctx.domain,latencyMs:Math.round(performance.now()-started),receipt:result});return result;}};
const r=await createRepairRuntime({seed:false,semantic});
const results=[];
const report=async()=>writeFile(path.join(out,'REAL_HTTP.json'),JSON.stringify({at:new Date().toISOString(),sourceMode:'approved_original_synthetic',authority:'none',modelCalls,results},null,2));
const until=async pred=>{const deadline=Date.now()+40000;while(!await pred()){if(Date.now()>deadline)throw new Error('HTTP result timeout');await new Promise(r=>setTimeout(r,20));}};
try{
  for(const {c,files} of sources){
    const cred={credential:HUMAN,tenantId:TENANT};
    const customer=await r.kernel.v2.createCustomer({...cred,requestId:randomUUID(),displayName:c.businessName,legalEntityRef:`SYNTHETIC-API-REGRESSION-${c.caseId}`});
    const cid=customer.customerId;
    await r.kernel.v2.registerArtifact({...cred,requestId:randomUUID(),kind:'document',factKey:'transaction_scope',grade:'unverified',
      content:{value:{orgType:'制造业',product:'设备',region:c.region,customerRange:'standard'},sourceMode:'synthetic_fixture_scope'}},cid);
    for(const {file,hash,bytes,parsed} of files){
      const original=await r.kernel.v2.registerArtifact({...cred,requestId:randomUUID(),kind:'document',factKey:`material.original:${hash}`,grade:'unverified',
        content:{rawText:parsed.text??null,originalSha256:hash,bytes:bytes.length,fileName:file.name,sourceMode:'synthetic'}},cid);
      await r.kernel.v2.registerArtifact({...cred,requestId:randomUUID(),kind:'parse_extraction',factKey:`parse:${original.artifactId}`,grade:'unverified',
        content:{originalArtifactId:original.artifactId,originalSha256:hash,parserVersion:parsed.parserVersion,format:parsed.format,
          declaredFactSummaries:parsed.declaredFacts.map(f=>({factKey:f.factKey,value:f.value,unit:f.unit,caliber:f.caliber,level:f.verificationLevel}))}},cid);
    }
    const start=async domain=>{const plan=await r.call('GET',`/customers/${cid}/advance-plan?domain=${domain}`);
      if(plan.status!==200)throw new Error('Plan failed');const body={requestId:randomUUID(),...Object.fromEntries(['domain','planId','planHash','expectedVersion','roundNo','actionIds'].map(k=>[k,plan.body[k]]))};
      const started=performance.now();const posted=await r.call('POST',`/customers/${cid}/advance-rounds`,body);
      if(![200,202].includes(posted.status))throw new Error(`Advance HTTP ${posted.status}`);return {body,started};};
    const first=await start('business');
    await until(async()=>{const rows=await r.pool.query('SELECT j.state FROM arrow_jobs j JOIN arrow_processes p ON p.process_id=j.process_id WHERE p.customer_id=$1',[cid]);return rows.rows.length===5&&rows.rows.every(j=>!['queued','running'].includes(j.state));});
    const deterministicReadyMs=Math.round(performance.now()-first.started);
    await r.advance.drain();
    const elapsedMs=Math.round(performance.now()-first.started);
    const v=await r.call('GET',`/customers/${cid}/advance-rounds`);
    const row={caseId:c.caseId,customerId:cid,sourceHashes:files.map(f=>f.hash),deterministicReadyMs,elapsedMs,initial:v.body,checks:{}};
    const beforeCalls=modelCalls.length;
    const duplicates=await Promise.all(Array.from({length:5},()=>r.call('POST',`/customers/${cid}/advance-rounds`,first.body)));
    await r.advance.drain();row.checks.concurrentAdvanceReplay=duplicates.every(x=>x.status===200&&x.body.reused===true)&&modelCalls.length===beforeCalls;
    const job=v.body.receipts.find(j=>j.domain==='commerce'&&j.state==='awaiting_confirmation');
    if(job){const responses=await Promise.all(Array.from({length:5},()=>r.call('POST',`/customers/${cid}/advance-rounds/${job.roundId}/semantic`,{requestId:randomUUID()})));
      row.checks.concurrentSemanticReplay=responses.every(x=>x.status===200&&x.body.receipt.requestId===job.semantic?.requestId&&x.body.receipt.current===true);
    }
    if(c.caseId==='lt3-I16'){
      const b=v.body.receipts.find(j=>j.domain==='business'&&['awaiting_confirmation','waiting_evidence'].includes(j.state));
      if(!b)row.checks.feedbackReselection='BLOCKED';else{
        const latest=(await r.call('GET',`/customers/${cid}/advance-rounds`)).body.receipts.find(j=>j.domain==='business');
        const chosen=await r.call('POST',`/customers/${cid}/advance-rounds/${b.roundId}/decision`,{requestId:randomUUID(),decision:'set_aside',
          resultId:b.actions[0].result.resultId,expectedVersion:latest.version,rationale:'合成回归：搁置候选，要求重新检查原始证据；不采纳、不审批。'});
        if(chosen.status!==200)throw new Error(`Feedback HTTP ${chosen.status}`);
        await start('business');await r.advance.drain();row.afterFeedback=(await r.call('GET',`/customers/${cid}/advance-rounds`)).body;
        const fresh=row.afterFeedback.receipts.find(j=>j.domain==='business');row.checks.feedbackReselection=fresh.roundId!==b.roundId&&fresh.selection===null&&modelCalls.some(x=>x.jobId===fresh.roundId&&x.requestId.endsWith(':r1'));
      }
    }
    results.push(row);await report();
    console.log(JSON.stringify({caseId:c.caseId,deterministicReadyMs,elapsedMs,domains:v.body.domains.map(d=>({domain:d.domain,state:d.state})),checks:row.checks,
      calls:modelCalls.filter(x=>x.customerId===cid).map(x=>({domain:x.domain,status:x.receipt.status,sent:x.receipt.sent,replayed:x.receipt.replayed,latencyMs:x.latencyMs}))}));
    if(modelCalls.some(x=>['unknown','failed'].includes(x.receipt.status)))break;
  }
}finally{await report();await r.close();}
