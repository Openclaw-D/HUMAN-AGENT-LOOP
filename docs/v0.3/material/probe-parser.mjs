// Read-only offline compatibility probe. Never reads heldout fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArtifactBytes,PARSE_ADAPTERS_VERSION} from '../../../Back/C/src/parse/adapters.mjs';
import {projectSemanticFacts,SEMANTIC_FACTS_VERSION} from '../../../Back/C/src/parse/semantic-facts.mjs';
const root=process.cwd();
const sha=b=>createHash('sha256').update(b).digest('hex');
const index=JSON.parse(await fs.readFile('docs/materials/kashgar-demo-v1/case-index.json','utf8'));
const picks=[['originals/接口财务2025.csv','financial_statement'],['originals/接口设备.csv','equipment_list'],['originals/银行流水.csv','statement'],['originals/D02-主体登记资料.pdf','legal_document'],['originals/D09-销售合同与交付凭据.pdf','order_contract'],['originals/D02-主体登记资料.md','legal_document'],['originals/工艺示意.svg','site_evidence'],['经营台账.xlsx','financial_statement']];
const results=[];
for(const c of index.cases)for(const [name,kind] of picks){
 const file=`docs/materials/kashgar-demo-v1/${c.id}/${name}`,bytes=await fs.readFile(file);
 const out=parseArtifactBytes(bytes,{fileName:path.basename(name),currency:'CNY',unit:name.includes('接口')?'wan':'yuan',subjectId:c.id});
 const sem=projectSemanticFacts({kind,parseResult:out});
 const exactName=kind==='legal_document'?(out.text??'').includes(c.name):null;
 results.push({file,sha256:sha(bytes),kind,ok:out.ok,code:out.code??null,format:out.format??null,manualEntry:out.manualEntry??false,textLength:(out.text??'').length,exactCustomerNameRecovered:exactName,rowCount:out.rows?.length??null,aggregates:out.aggregates??null,rawFactCount:out.declaredFacts?.length??0,semanticFacts:sem.facts,qualityFlags:[...(out.qualityFlags??[]),...sem.qualityFlags],note:out.note??out.detail??null});
}
const sources=[];
for(const file of ['Back/C/src/parse/adapters.mjs','Back/C/src/parse/semantic-facts.mjs'])sources.push({file,sha256:sha(await fs.readFile(file))});
await fs.writeFile('docs/v0.3/material/PARSER_PROBE.json',JSON.stringify({offlineOnly:true,heldoutRead:false,parserVersion:PARSE_ADAPTERS_VERSION,semanticVersion:SEMANTIC_FACTS_VERSION,sources,results},null,2));
console.log(JSON.stringify(results.map(x=>({file:x.file.split('/').slice(-2).join('/'),ok:x.ok,format:x.format,code:x.code,name:x.exactCustomerNameRecovered,rows:x.rowCount,semantic:x.semanticFacts.map(y=>y.factKey)})),null,2));
