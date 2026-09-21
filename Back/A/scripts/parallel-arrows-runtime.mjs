import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadConfig } from '../src/config.ts';
import { tokenDirectoryVerifier } from '../src/domain/principal.ts';
import { Kernel } from '../src/domain/kernel.ts';
import { forbidden } from '../src/domain/errors.ts';
import { buildParallelAdvanceRounds } from '../src/domain/advance-round.ts';
import { migrate } from '../src/db/db.ts';
import { startHttpServer } from '../src/http/server.ts';
import { runReadyDomains } from '../../B/src/worker/column-runner.mjs';
import { startEdgeServer } from '../../Edge/src/server.mjs';
import { createKernelStore } from '../../Edge/src/kernel-store.mjs';
import { createSessionStore } from '../../Edge/src/session.mjs';
import { createUpstreamProxy } from '../../Edge/src/proxy.mjs';
import { createReadProxy } from '../../Edge/src/readproxy.mjs';
import { createStaticHandler } from '../../Edge/src/static.mjs';

export const TENANT='arrow-isolated-v1';
export const HUMAN='arrow-isolated-human-only';
export const SERVICE='arrow-isolated-service-only';
export const DOMAINS=['business','policy','credit','commerce','asset'];
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const ownership='parallel-arrows-back';
export const fixtures = ['good','medium','bad'].map((id,index)=>({id,version:'parallel-case-v1',synthetic:true,
  displayName:`隔离合成制造业-${['好例','补证例','风险例'][index]}`,
  transaction:{orgType:'commercial_leasing',product:'sale_leaseback',region:'新疆喀什',customerRange:'standard'},
  facts:{ entity_identity_verified:true,equipment_ownership_verified:true,equipment_exists_observed:true,
    nameplate_serial:`SYNTHETIC-MACHINE-${id}`,equipment_deal_amount:3000000,
    revenue_annual_declared:22000000,new_order_amount_declared:3000000,litigation_pending_declared:false,
    total_assets_declared:15000000,total_liabilities_declared:6000000,
    monthly_operating_cash_flow:id==='bad'?40000:200000,monthly_debt_service:100000,
    top1_customer_revenue_share:30,proposed_monthly_rent:10000,lease_term_months:36,funding_cost_annual:0.03,fees_known:true },
  // No conclusion field is passed to any evaluator. The different input and grade drive results.
  gradeOverrides:id==='medium'?{monthly_operating_cash_flow:'unverified'}:{},
}));

export async function seedCases(kernel,{suffix='v1'}={}) {
  const cred={credential:HUMAN,tenantId:TENANT};
  const cases=[];
  for(const f of fixtures){
    if(f.facts.revenue_annual_declared>50000000)throw new Error('SYNTHETIC_REVENUE_REDLINE');
    if(f.facts.total_assets_declared<f.facts.total_liabilities_declared)throw new Error('SYNTHETIC_BALANCE_INVALID');
    const c=await kernel.v2.createCustomer({...cred,requestId:`${suffix}:${f.id}:customer`,displayName:f.displayName,legalEntityRef:`SYNTHETIC-ARROW-${suffix}-${f.id}`});
    const artifacts={};
    for(const [key,value] of Object.entries({...f.facts,transaction_scope:f.transaction})){
      const art=await kernel.v2.registerArtifact({...cred,requestId:`${suffix}:${f.id}:${key}`,kind:'financial_statement',
        factKey:key,grade:f.gradeOverrides[key]??'confirmed',content:{value,sourceMode:'synthetic',fixtureVersion:f.version,factKey:key},
        materialMeta:{subjectRef:c.customerId,unit:typeof value==='number'?'CNY':null,caliber:'synthetic_declared'}},c.customerId);
      artifacts[key]=art.artifactId;
    }
    cases.push({...f,customerId:c.customerId,artifacts});
  }
  return cases;
}

export async function createIsolatedArrowRuntime({dbUrl,edgePort=0,aPort=0,seed=true,seedSuffix='v1',runBatch=runReadyDomains,progression='column'}={}) {
  const u=new URL(dbUrl);
  if(u.hostname!=='127.0.0.1'||u.username!=='arrow_test'||u.pathname!=='/arrow_test')throw new Error('Dedicated arrow_test loopback database required');
  const pool=new pg.Pool({connectionString:dbUrl,max:24});
  let a,edge;
  try{
    await migrate(pool);
    const cfg=loadConfig(['--db',dbUrl,'--required-domains-policy','arrow-demo-required-v1','--principal-tokens',[
      `${HUMAN}=arrow-reviewer:human:${DOMAINS.join('+')}:all:${TENANT}`,
      `${SERVICE}=arrow-local-service:service:${DOMAINS.join('+')}:all:${TENANT}`,
      ...DOMAINS.map(d=>`arrow-only-${d}=arrow-${d}:human:${d}:all:${TENANT}`),
      `arrow-cross=cross:human:business:all:other-tenant`,
    ].join(',')]);
    const verifier=tokenDirectoryVerifier(cfg.principals);const kernel=new Kernel(pool,{config:cfg,verifier});
    // Explicit isolated simulation policy; never installed in shared or production DBs.
    for(const d of DOMAINS)await pool.query('INSERT INTO domain_requirement_policies(policy_version,domain,required,min_independent_proofs,created_by) VALUES($1,$2,true,1,$3) ON CONFLICT DO NOTHING',['arrow-demo-required-v1',d,'isolated-seed']);
    await kernel.analysis.activateRulePack({credential:HUMAN,tenantId:TENANT,requestId:'arrow-isolated-rule-v1',version:'1.0.0'});
    const cases=seed?await seedCases(kernel,{suffix:seedSuffix}):[];
    const advance=buildParallelAdvanceRounds(kernel,{serviceCredential:SERVICE,runBatch,progression});
    a=await startHttpServer(kernel,aPort,{advance,cases:async credential=>{
      const identity=await verifier(credential);
      if(!identity||identity.kind!=='human'||!identity.roles.some(role=>DOMAINS.includes(role)))throw forbidden('PERMISSION_DENIED','Internal demo identity required');
      const visible=[];
      for(const c of cases){try{await kernel.v2.getCustomer(credential,c.customerId);
        visible.push({caseId:`parallel-v1-${c.id}`,fixtureVersion:c.version,sourceMode:'synthetic',customerId:c.customerId,
          displayName:c.displayName,scenarioKey:c.id,scenarioLabel:{good:'好',medium:'中',bad:'差'}[c.id],
          scenarioIsOutcome:false,industry:'制造业',annualRevenueCny:c.facts.revenue_annual_declared,
          transaction:c.transaction});}catch{/* Scope is checked per customer; no hidden customer identity leaks. */}}
      return {ok:true,manifestVersion:'parallel-arrows-cases-v1',exerciseId:seedSuffix,dependencyVersion:'column-deps-v1',cases:visible};
    }});const base=`http://127.0.0.1:${a.address().port}`;
    const store=createKernelStore({baseUrl:base});
    const sessionStore=createSessionStore({});
    const entries=[{principalId:'arrow-reviewer',credential:HUMAN,roles:DOMAINS,label:'隔离演练 · 五专业审核员（测试身份）',demo:true},
      ...DOMAINS.map(d=>({principalId:`arrow-${d}`,credential:`arrow-only-${d}`,roles:[d],label:`隔离测试 · ${d}`,demo:true}))];
    edge=await startEdgeServer({port:edgePort,seal:{buildId:'parallel-arrows-isolated',sourceMode:'synthetic'},probes:[],store,sessionStore,
      verifyCredential:async({credential})=>{const p=await verifier(credential);return p?{ok:true,...p}:{ok:false};},
      auth:async({session,customerId})=>{if(!session)return {ok:false,status:401,error:'SESSION_REQUIRED'};
        try{if(customerId)await kernel.v2.getCustomer(session.credential,customerId);return {ok:true};}catch{return {ok:false,status:403,error:'PERMISSION_DENIED'};}},
      identityDirectory:{list:entries.filter(e=>e.principalId==='arrow-reviewer').map(({credential,...e})=>e),byPrincipal:new Map(entries.map(e=>[e.principalId,e]))},
      proxy:createUpstreamProxy({baseUrl:base,credentialFor:s=>s.credential}),readProxy:createReadProxy({baseUrl:base,credentialFor:s=>s.credential}),
      frontHandler:createStaticHandler({rootDir:path.join(repo,'Front/dist'),urlPrefix:''})});
    return {pool,kernel,advance,cases,exerciseId:seedSuffix,baseUrl:`http://127.0.0.1:${edge.port}`,aUrl:base,ownership,
      close:async()=>{await advance.drain();await edge.close();await new Promise(r=>a.close(r));await pool.end();}};
  }catch(error){if(edge)await edge.close();if(a)await new Promise(r=>a.close(r));await pool.end();throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i<0?undefined:process.argv[i+1];};
  const runtime=await createIsolatedArrowRuntime({dbUrl:arg('db'),edgePort:Number(arg('port')??0),seedSuffix:arg('seed-suffix')??'v1'});
  const folder=path.join(repo,'docs/v0.4/results/parallel-arrows-back');await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'RUNTIME.json'),JSON.stringify({owner:ownership,pid:process.pid,baseUrl:runtime.baseUrl,aUrl:runtime.aUrl,
    sourceMode:'synthetic/deterministic',exerciseId:runtime.exerciseId,cases:runtime.cases.map(c=>({id:c.id,customerId:c.customerId,displayName:c.displayName})),
    startedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({owner:ownership,pid:process.pid,url:runtime.baseUrl,cases:runtime.cases.map(c=>({id:c.id,customerId:c.customerId}))}));
  let closing=false;const close=async()=>{if(closing)return;closing=true;await runtime.close();process.exit(0);};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
