// Adapter-only dependency contract; C's rules/assessors remain unchanged.
import { readFileSync } from 'node:fs';
import { stableHash } from '../../../C/domains/util.mjs';
import { perceptionStage } from '../../../C/domains/pipeline.mjs';
export const DEPENDENCY_VERSION='column-deps-v1';
export const valueOf=f=>f?.value&&typeof f.value==='object'&&Object.hasOwn(f.value,'value')?f.value.value:f?.value;
export const loadColumnRules=()=>JSON.parse(readFileSync(new URL('../../../C/rules/four-domain-rule-pack-v1.json',import.meta.url),'utf8'));
export function candidateMaterials(materials,facts){
  const levels={confirmed:'verified',source_supported:'source_supported',unverified:'declared',inference:'unknown',unknown:'unknown'};
  return materials.filter(a=>!a.superseded_by&&!a.duplicate_of).map(a=>({
    materialId:a.artifact_id,kind:String(a.kind).replace(/^material\./,''),content:JSON.stringify(a.content),
    sourceRef:{channel:'A.evidence_artifacts',field:a.fact_key??'registered_fact_assertions',capturedAt:new Date(a.created_at).toISOString(),
      ...(a.material_meta?.page?{page:a.material_meta.page}:{}),...(a.material_meta?.timeSpan?{timeSpan:a.material_meta.timeSpan}:{})},
    quality:a.content?.quality??{},
    declaredFacts:facts.filter(f=>f.artifact_id===a.artifact_id).map(f=>({factKey:f.fact_key,value:valueOf(f),verificationLevel:levels[f.grade]??'unknown',
      unit:a.material_meta?.unit??undefined,caliber:a.material_meta?.caliber??undefined})),
  }));
}
const KEYSETS={
  business:['revenue_annual_declared','new_order_amount_declared','litigation_pending_declared','total_assets_declared','total_liabilities_declared'],
  credit:['monthly_operating_cash_flow','monthly_debt_service','new_debt_monthly_payment','top1_customer_revenue_share','video_liveliness','material_page_count'],
  commerce:['lease_term_months','proposed_monthly_rent','funding_cost_annual','fees_known'],
  asset:['equipment_ownership_verified','equipment_exists_observed','equipment_deal_amount','nameplate_serial','equipment_model'],
};
const derived={cash_coverage_ratio:['monthly_operating_cash_flow','monthly_debt_service'],
  cash_coverage_ratio_stressed:['monthly_operating_cash_flow','monthly_debt_service','new_debt_monthly_payment'],materials_freshness_ok:[]};
function ruleKeys(pack){
  const keys=new Set();const visit=x=>{if(!x||typeof x!=='object')return;if(typeof x.fact==='string')keys.add(x.fact);Object.values(x).forEach(v=>{if(typeof v==='object')visit(v);});};
  for(const rule of pack.rules){for(const f of rule.requiredFacts??[])keys.add(f.factKey);visit(rule.condition);}
  for(const key of [...keys]){if(derived[key]){keys.delete(key);derived[key].forEach(k=>keys.add(k));}}
  return [...keys];
}
export function describeColumnDependencies({customer,materials,facts,ruleVersion,asOf=new Date().toISOString().slice(0,10)}){
  const pack=loadColumnRules();const rows=candidateMaterials(materials,facts);
  const perception=rows.length?perceptionStage({tenantId:customer.tenant_id,customerId:customer.customer_id,materials:rows,rulePack:pack}):{ok:false,problems:['materials empty']};
  const unreadable=perception.snapshot?.unreadable??[];
  const items=perception.snapshot?.items??[];
  // C deriveFacts consumes freshness of every readable fact, but fresh unrelated values do not affect it.
  const stale=[...new Set(items.filter(i=>i.capturedAt&&Number.isFinite(Date.parse(i.capturedAt))&&
    (Date.parse(asOf)-Date.parse(i.capturedAt))/86400000>365).map(i=>i.materialId))].sort();
  const global={unreadable,invalid:perception.ok?[]:perception.problems??[],loadedRules:stableHash(pack)};
  return Object.fromEntries(['business','policy','credit','commerce','asset'].map(domain=>{
    const factKeys=[...new Set([...(domain==='policy'?ruleKeys(pack):KEYSETS[domain]),'transaction_scope'])].sort();
    const selected=facts.filter(f=>factKeys.includes(f.fact_key));
    const artifactIds=[...new Set([...selected.map(f=>f.artifact_id),...unreadable.map(u=>u.materialId),...(domain==='policy'?stale:[])])].sort();
    const semantic={version:DEPENDENCY_VERSION,domain,ruleVersion,global,
      facts:selected,materials:materials.filter(m=>artifactIds.includes(m.artifact_id)),missing:factKeys.filter(k=>!selected.some(f=>f.fact_key===k)),
      ...(domain==='policy'?{asOf,freshness:{hasCapturedFacts:items.some(i=>i.capturedAt),staleMaterialIds:stale}}:{})};
    return [domain,{version:DEPENDENCY_VERSION,deps:{artifactIds,factKeys,rulePackVersion:ruleVersion},semanticHash:stableHash(JSON.parse(JSON.stringify(semantic)))}];
  }));
}
