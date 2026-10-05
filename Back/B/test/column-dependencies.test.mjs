import test from 'node:test';
import assert from 'node:assert/strict';
import { describeColumnDependencies, candidateMaterials } from '../src/worker/column-dependencies.mjs';
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

test('parsed facts are actual domain dependencies and legacy boolean envelopes stay usable',()=>{
  const input=seed();
  const rent=input.facts.find(f=>f.fact_key==='proposed_monthly_rent');
  const fees=input.facts.find(f=>f.fact_key==='fees_known');
  const rentMaterial=input.materials.find(m=>m.artifact_id===rent.artifact_id);
  rent.fact_key='parse:rent';rent.value={declaredFactSummaries:[{factKey:'proposed_monthly_rent',value:10000,level:'declared',unit:'CNY'}]};
  rentMaterial.content=structuredClone(rent.value);rentMaterial.kind='parse_extraction';
  fees.fact_key='parse:fees';fees.value={declaredFactSummaries:[{factKey:'fees_known',value:'true',level:'declared'}]};
  const deps=describeColumnDependencies(input);
  assert.ok(deps.commerce.deps.artifactIds.includes(rent.artifact_id));
  assert.ok(deps.commerce.deps.artifactIds.includes(fees.artifact_id));
  const after=structuredClone(input);after.facts.find(f=>f.fact_key==='parse:rent').value.declaredFactSummaries[0].value=20000;
  assert.ok(diff(input,after).includes('commerce'), 'a changed parse envelope invalidates its candidate');
  const rows=candidateMaterials(input.materials,input.facts);
  assert.equal(rows.flatMap(m=>m.declaredFacts).find(f=>f.factKey==='fees_known').value,true);
});

test('commerce never guesses missing currency and compares known mixed scales in CNY',()=>{
  const input=seed();
  const rent=input.facts.find(f=>f.fact_key==='proposed_monthly_rent');
  input.materials.find(m=>m.artifact_id===rent.artifact_id).material_meta.unit=null;
  const missing=runDomainCandidate({...input,domain:'commerce'});
  assert.equal(missing.ok,true,JSON.stringify(missing));
  assert.ok(missing.assessment.unknowns.some(s=>s.includes('单位')));
  assert.ok(!missing.assessment.knownFacts.some(s=>s.includes('10000万元')));
  assert.ok(missing.assessment.knownFacts.some(s=>s.includes('不可计算')));
  const mixed=seed();add(mixed,'proposed_monthly_rent',2);
  mixed.materials.at(-1).material_meta.unit='wan';
  const result=runDomainCandidate({...mixed,domain:'commerce'});
  assert.ok(result.assessment.knownFacts.some(s=>s.includes('plan-2 为最高')));
  assert.ok(result.assessment.evidenceRefs.some(ref=>ref.materialId===mixed.materials.at(-1).artifact_id));
});

test('scalar fact metadata preserves its explicitly declared unit',()=>{
  const input=seed();const f=input.facts.find(f=>f.fact_key==='proposed_monthly_rent');
  input.materials.find(m=>m.artifact_id===f.artifact_id).material_meta=null;
  f.value.unit='CNY';
  assert.equal(candidateMaterials(input.materials,input.facts).flatMap(m=>m.declaredFacts).find(row=>row.factKey===f.fact_key).unit,'CNY');
});

test('declared inputs stay visible to review and existence declarations cannot become video evidence',()=>{
  const input=seed();input.facts.find(f=>f.fact_key==='equipment_exists_observed').value.value=false;
  const asset=runDomainCandidate({...input,domain:'asset'});
  assert.ok(asset.assessment.knownFacts.some(s=>s.includes('存在性记录：false')));
  assert.ok(!asset.assessment.knownFacts.some(s=>s.includes('远程画面观察到设备存在')));
  const cf=input.facts.find(f=>f.fact_key==='monthly_operating_cash_flow');cf.grade='unverified';
  const credit=runDomainCandidate({...input,domain:'credit'});
  assert.ok(credit.observedFacts.some(f=>f.factKey===cf.fact_key&&f.value===200000&&f.verificationLevel==='declared'));
  assert.ok(!credit.observedFacts.some(f=>f.factKey==='proposed_monthly_rent'),'semantic facts cannot exceed the domain dependency basis');
  const commerce=runDomainCandidate({...input,domain:'commerce'});
  assert.ok(!commerce.assessment.knownFacts.some(s=>s.includes('为最高定价方案')),'single record is not a comparison');
});
