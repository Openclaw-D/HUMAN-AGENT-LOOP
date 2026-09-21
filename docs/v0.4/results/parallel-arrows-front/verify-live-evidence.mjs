import fs from 'node:fs';import assert from 'node:assert/strict';
import {readColumnReceipt} from '../../../../Front/site-mirror/lib/workbench/advance-client.ts';
const snapshots=JSON.parse(fs.readFileSync(new URL('./final-three-cases.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const checks=[];
for(const s of snapshots){for(const r of s.receipts){readColumnReceipt(r,s.customerId);assert.equal(r.version,s.version);assert.equal(r.caseOutcome.terminalEventId,s.caseOutcome.terminalEventId);}
 const latest=s.receipts.filter(r=>r.current);const executions=latest.map(r=>r.candidate?.execution).filter(Boolean);
 const overlaps=executions.some((a,i)=>executions.slice(i+1).some(b=>Date.parse(a.startedAt)<Date.parse(b.finishedAt)&&Date.parse(b.startedAt)<Date.parse(a.finishedAt)));
 checks.push({caseId:s.caseId,processId:s.processId,version:s.version,receipts:s.receipts.length,currentRounds:latest.map(r=>({domain:r.domain,roundNo:r.roundNo,version:r.version,selectionEvent:r.selection?.eventId,materialHashes:r.views.materials.items.map(m=>m.hash)})),ending:s.caseOutcome.ending,terminalEventId:s.caseOutcome.terminalEventId,archiveRef:s.caseOutcome.archiveRef,workerThreadIds:executions.map(e=>e.threadId),workerIntervalsOverlap:overlaps});}
fs.writeFileSync(new URL('./verified-associations.json',import.meta.url),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks.map(({currentRounds,...rest})=>rest),null,2));
