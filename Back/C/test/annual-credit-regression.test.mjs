// Annual fact provenance and conservative risk regression; synthetic data, loopback transport only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../../../', import.meta.url));
const OUT=fs.mkdtempSync(path.join(tmpdir(),'jw-annual-credit-'));
const fingerprints=[];
const deps=await import(pathToFileURL(path.join(ROOT,'Back/B/src/worker/column-dependencies.mjs')));
const assess=await import(pathToFileURL(path.join(ROOT,'Back/C/domains/assessors.mjs')));
const pipe=await import(pathToFileURL(ROOT+'/Back/C/domains/pipeline.mjs'));
const percept=await import(pathToFileURL(ROOT+'/Back/C/domains/perception.mjs'));
const {createThresholds}=await import(pathToFileURL(ROOT+'/Back/C/rules/thresholds.mjs'));
const rulePack=deps.loadColumnRules();
const thresholds=createThresholds({business:rulePack.businessThresholds,system:rulePack.systemThresholds});
const check=[];
const f=(key,value,caliber='FY2025/consolidated',unit='CNY')=>({key,value,caliber,unit});
const mk=(tag,items)=>{
 const materials=[{artifact_id:'mat-r2',kind:'financial_statement',content:{quality:{}},created_at:'2026-10-01T00:00:00Z',superseded_by:null,duplicate_of:null},{artifact_id:'mat-scope',kind:'document',content:{quality:{}},created_at:'2026-10-01T00:00:00Z',superseded_by:null,duplicate_of:null}];
 const facts=items.map((x,i)=>({assertion_id:'r2-f'+i,artifact_id:'mat-r2',fact_key:x.key,value:{value:x.value,...(x.unit!==null?{unit:x.unit}:{}),...(x.caliber!==null?{caliber:x.caliber}:{})},grade:x.grade??'source_supported'}));
 facts.push({assertion_id:'r2-scope',artifact_id:'mat-scope',fact_key:'transaction_scope',value:{value:{orgType:'制造业',product:'设备',region:'测试',customerRange:'standard'}},grade:'confirmed'});
 const built=pipe.perceptionStage({tenantId:'t1',customerId:'r2-'+tag,materials:deps.candidateMaterials(materials,facts),rulePack});
 if(!built.ok)throw new Error('perception '+JSON.stringify(built.reasons));
 const projection=percept.projectForDomain(built.snapshot,'credit').projection;
 const result=assess.assessCredit({snapshot:built.snapshot,projection,thresholds,coverageRuleApplied:true});
 if(!result.ok)throw new Error('assessment '+JSON.stringify(result.reasons));
 return {assessment:result.assessment,projection,materials,facts};
};
function record(name,ok,detail){check.push({name,pass:!!ok,detail});test(name,()=>assert.ok(ok,JSON.stringify(detail)));}
const base=[f('revenue_annual_declared',12000000),f('total_assets_declared',8000000),f('total_liabilities_declared',2000000),f('net_profit_annual_declared',800000),f('operating_cash_flow_annual_declared',1500000),f('gross_margin_declared',22,'FY2025/consolidated','%')];
const healthy=mk('healthy',base);
record('healthy',healthy.assessment.findingsSuspicion.length===0&&healthy.assessment.knownFacts.filter(s=>s.includes('年度事实参考')).length===6,'six annual facts, no risk signals');
const risk=mk('risk',[f('revenue_annual_declared',9000000),f('total_assets_declared',3000000),f('total_liabilities_declared',3500000),f('net_profit_annual_declared',-200000),f('operating_cash_flow_annual_declared',-150000),f('gross_margin_declared',-9.85,'FY2025/consolidated','%')]);
record('risk_and_monthly_gate',risk.assessment.findingsSuspicion.length===4&&risk.assessment.unknowns.some(s=>s.includes('月经营现金流缺失'))&&risk.assessment.authority==='none','four signals, missing monthly preserved, authority none');
const negatives=[
 ['same_value_different_fact_cross_year',[f('revenue_annual_declared',6000000),f('total_assets_declared',5000000),f('total_liabilities_declared',6000000,'FY2024/consolidated')],'口径不一致'],
 ['different_scope',[f('total_assets_declared',5000000),f('total_liabilities_declared',6000000,'FY2025/parent')],'口径不一致'],
 ['missing_caliber',[f('total_assets_declared',5000000,null),f('total_liabilities_declared',6000000,null)],'缺证'],
 ['missing_unit',[f('total_assets_declared',5000000),f('total_liabilities_declared',6000000,'FY2025/consolidated',null)],'单位缺证'],
 ['ambiguous',[f('total_assets_declared',5000000),f('total_liabilities_declared',6000000),f('total_liabilities_declared',6000000,'FY2024/consolidated')],'口径歧义']
];
for(const [name,items,needle] of negatives){const r=mk(name,items).assessment;record(name,r.unknowns.some(s=>s.includes(needle))&&!r.findingsSuspicion.some(x=>x.note.includes('资不抵债')),r.unknowns.filter(s=>s.includes(needle)));}
const eq=mk('equal',[f('total_assets_declared',5000000),f('total_liabilities_declared',5000000)]).assessment;
record('equal_not_insolvent',!eq.findingsSuspicion.some(x=>x.note.includes('资不抵债'))&&eq.knownFacts.some(s=>s.includes('相等')),'equality is not insolvency');
let raw='';
const mock=http.createServer((req,res)=>{const c=[];req.on('data',b=>c.push(b));req.on('end',()=>{raw=Buffer.concat(c).toString();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({model:'offline-root',choices:[{message:{content:JSON.stringify({decisions:[]})}}],usage:{prompt_tokens:1,completion_tokens:1}}));});});
function findBrief(o){if(typeof o==='string'){const i=o.lastIndexOf('{"domain"');if(i>=0){try{return JSON.parse(o.slice(i,o.lastIndexOf('}')+1));}catch{}}return null;}if(o&&typeof o==='object'){for(const v of Object.values(o)){const b=findBrief(v);if(b)return b;}}return null;}
try{
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const cfg=OUT+'/mock-config.json';fs.writeFileSync(cfg,JSON.stringify({transport:{mode:'mock',mock:{baseUrl:'http://127.0.0.1:'+mock.address().port,timeoutMs:800,model:'offline-root'}},budget:{maxTotalCost:1,perCallEstimate:.01,currency:'CNY'}}));
 const {buildZoneSemantic}=await import(pathToFileURL(path.join(ROOT,'Back/A/src/domain/zone-semantic.ts')));
 const zs=buildZoneSemantic({configPath:cfg,receiptsDir:OUT+'/receipts'});
 const observed=risk.projection.items.filter(x=>base.some(f=>f.key===x.factKey)).map(x=>({factKey:x.factKey,value:x.value,unit:x.unit,verificationLevel:x.verificationLevel,materialId:x.materialId}));
 for(const shape of ['flat','nested']){
  const candidate=shape==='flat'?{...risk.assessment,observedFacts:observed,unreadable:[],zoneCandidates:{options:[]}}:{assessment:risk.assessment,observedFacts:observed,unreadable:[],zoneCandidates:{options:[]}};
  const run=await zs.run({tenantId:'t1',customerId:'root-r2-'+shape,jobId:'root-r2-'+shape+'-'+Date.now(),domain:'credit',requestId:'root-r2-'+shape+'-'+Date.now(),candidate,feedback:[]});
  const b=findBrief(JSON.parse(raw));
  record('actual_mock_brief_'+shape,b?.candidate?.knownFacts?.length===6&&b?.observedFacts?.length===6&&b?.candidate?.findingsSuspicion?.length===4&&b?.candidate?.unknowns?.some(s=>s.includes('月经营现金流缺失')),{runStatus:run.status,annualFacts:b?.candidate?.knownFacts?.length,observed:b?.observedFacts?.length,signals:b?.candidate?.findingsSuspicion?.length});
 }
}finally{mock.closeAllConnections();await new Promise(r=>mock.close(r));}
const result={owner:'Codex Root',at:new Date().toISOString(),scope:'installed-source annual risk and flat/nested actual brief; loopback mock only, zero real API/DB/product writes',fingerprints,checks:check,passed:check.filter(x=>x.pass).length,total:check.length,allPass:check.every(x=>x.pass),limits:['caliber is existing free-text metadata; this does not prove arbitrary annual period/whole-company source validation','no real model correctness, production latency, install or visual acceptance']};
console.log(JSON.stringify({passed:result.passed,total:result.total,scope:result.scope,limits:result.limits}));if(!result.allPass)process.exitCode=1;
const tmpBase=path.resolve(tmpdir());
if(path.dirname(path.resolve(OUT))!==tmpBase||!path.basename(OUT).startsWith('jw-annual-credit-'))throw Error('Temporary fixture cleanup boundary');
fs.rmSync(OUT,{recursive:true,force:true});
