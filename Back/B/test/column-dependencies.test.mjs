import test from 'node:test';
import assert from 'node:assert/strict';
import { describeColumnDependencies } from '../src/worker/column-dependencies.mjs';
import { runDomainCandidate } from '../src/worker/column-runner.mjs';
const domains=['business','policy','credit','commerce','asset'];
const seed=()=>{
  const values={transaction_scope:{orgType:'commercial_leasing',product:'sale_leaseback',region:'新疆喀什',customerRange:'standard'},
    revenue_annual_declared:22000000,new_order_amount_declared:3000000,litigation_pending_declared:false,total_assets_declared:15000000,total_liabilities_declared:6000000,
    monthly_operating_cash_flow:200000,monthly_debt_service:100000,top1_customer_revenue_share:30,
    equipment_ownership_verified:true,entity_identity_verified:true,equipment_exists_observed:true,nameplate_serial:'SYNTHETIC-1',equipment_deal_amount:3000000,
    lease_term_months:36,proposed_monthly_rent:10000,funding_cost_annual:0.03,fees_known:true};
  const input={customer:{customer_id:'c',tenant_id:'t',legal_entity_ref:'SYNTHETIC-deps'},materials:[],facts:[],ruleVersion:'1.0.0'};
  for(const [key,value] of Object.entries(values))add(input,key,value);
  return input;
};
function add(input,key,value,grade='confirmed',quality){
  const id=`${key}-${input.materials.length}`;const content={value,...(quality?{quality}:{})};
  input.materials.push({artifact_id:id,kind:'financial_statement',fact_key:key,content,sha256:JSON.stringify(content),created_at:new Date().toISOString(),material_meta:{unit:'CNY'}});
  input.facts.push({assertion_id:`f-${id}`,artifact_id:id,fact_key:key,value:content,grade});
}
const diff=(a,b)=>{const x=describeColumnDependencies(a),y=describeColumnDependencies(b);return domains.filter(d=>x[d].semanticHash!==y[d].semanticHash);};
const semantic=(input,d)=>{const r=runDomainCandidate({...input,domain:d});return {ok:r.ok,assessment:r.assessment,ruleEvaluation:r.ruleEvaluation,unreadable:r.unreadable};};
test('cashflow changes policy and credit only; unaffected actual C outputs remain identical',()=>{
  const before=seed(),after=structuredClone(before);const f=after.facts.find(f=>f.fact_key==='monthly_operating_cash_flow');
  f.value.value=40000;after.materials.find(m=>m.artifact_id===f.artifact_id).content.value=40000;
  assert.deepEqual(diff(before,after),['policy','credit']);
  for(const d of ['business','commerce','asset'])assert.deepEqual(semantic(before,d),semantic(after,d));
  assert.notDeepEqual(semantic(before,'credit'),semantic(after,'credit'));
  assert.notDeepEqual(semantic(before,'policy'),semantic(after,'policy'));
});
test('unrelated fresh fact is not a dependency or a changed result',()=>{
  const before=seed(),after=structuredClone(before);add(after,'unrelated_archive_note','note');
  assert.deepEqual(diff(before,after),[]);for(const d of domains)assert.deepEqual(semantic(before,d),semantic(after,d));
});
test('missing future facts, asset conflicts, scope and global unreadability are covered',()=>{
  const before=seed();let after=structuredClone(before);add(after,'new_debt_monthly_payment',20000,'unverified');assert.deepEqual(diff(before,after),['policy','credit']);
  after=structuredClone(before);add(after,'nameplate_serial','different');assert.deepEqual(diff(before,after),['asset']);
  after=structuredClone(before);after.facts.find(f=>f.fact_key==='transaction_scope').value.value.region='华东';assert.deepEqual(diff(before,after),domains);
  after=structuredClone(before);add(after,'unrelated_video','unreadable','unknown',{connection:'interrupted'});assert.deepEqual(diff(before,after),domains);
  after=structuredClone(before);after.ruleVersion='v2';assert.deepEqual(diff(before,after),domains);
});
test('source grade and global freshness expiry cannot be hidden',()=>{
  const before=seed(),after=structuredClone(before);after.facts.find(f=>f.fact_key==='monthly_operating_cash_flow').grade='unverified';
  assert.deepEqual(diff(before,after),['policy','credit']);
  const withOld=structuredClone(before);add(withOld,'unrelated_old_archive_note','old');withOld.materials.at(-1).created_at='2020-01-01T00:00:00.000Z';
  assert.deepEqual(diff(before,withOld),['policy']);assert.notDeepEqual(semantic(before,'policy'),semantic(withOld,'policy'));
});
