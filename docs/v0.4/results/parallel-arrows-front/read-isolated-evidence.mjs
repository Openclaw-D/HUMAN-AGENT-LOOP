import fs from 'node:fs';
const root='http://127.0.0.1:62032';
const session=await fetch(root+'/api/jw/v2/session',{method:'POST',headers:{'content-type':'application/json',origin:root},body:JSON.stringify({principalId:'arrow-reviewer'})}).then(r=>r.json());
if(!session.session?.sessionId)throw new Error('test login failed');
const headers={'x-jw-session':session.session.sessionId,origin:root,'content-type':'application/json'};
const manifest=await fetch(root+'/api/jw/v2/arrow-cases',{headers}).then(r=>r.json());
const evidence=[];
for(const c of manifest.cases){const r=await fetch(root+`/api/jw/v2/customers/${c.customerId}/advance-rounds`,{headers}).then(r=>r.json());evidence.push({caseId:c.caseId,customerId:c.customerId,...r});}
fs.writeFileSync(new URL(`./${process.argv[2]||'runtime-evidence'}.json`,import.meta.url),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence.map(e=>({case:e.caseId,version:e.version,outcome:e.caseOutcome,domains:e.domains,receipts:e.receipts?.length})),null,2));
