import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArtifactBytesAsync,ASYNC_PARSE_VERSION} from '../src/parse/adapters-async.mjs';
const root=new URL('../../../docs/materials/kashgar-demo-v1/',import.meta.url);
const index=JSON.parse(await fs.readFile(new URL('case-index.json',root),'utf8'));
for(const c of index.cases)for(const file of ['D02-主体登记资料','D09-销售合同与交付凭据']){
 test('03B: original '+c.id+'/'+file+' restores text and exact source',async()=>{
  const bytes=await fs.readFile(new URL(c.id+'/originals/'+file+'.pdf',root));
  const md=await fs.readFile(new URL(c.id+'/originals/'+file+'.md',root),'utf8');
  const r=await parseArtifactBytesAsync(bytes);
  assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.text.includes(c.name));assert.equal(r.parserVersion,ASYNC_PARSE_VERSION);
  if(file.startsWith('D09')){
   const amount=/价税合计([^。]+)。/.exec(md)[1];assert.ok(r.text.includes(amount),amount);
   assert.ok(r.text.includes('未支付余额保留为应收'));
  }
  assert.equal(r.artifactHash,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(r.pages.length>0);assert.ok(r.pages.every((p,i)=>p.page===i+1&&p.locator.start===i+1&&p.artifactHash===r.artifactHash));
 });
}
test('03B: malformed, encrypted marker and resource bounds fail closed',async()=>{
 const bytes=await fs.readFile(new URL(index.cases[0].id+'/originals/D02-主体登记资料.pdf',root));
 for(const [b,opts] of [[Buffer.from('%PDF-broken'),{}],[Buffer.from('%PDF-1.4\n/Encrypt 1 0 R'),{}],[bytes,{maxBytes:1}],[bytes,{maxPages:0}],[bytes,{maxTextChars:1}],[bytes,{timeoutMs:1}]]){
  const r=await parseArtifactBytesAsync(b,{},opts);assert.equal(r.ok,false);assert.equal(r.manualEntry,true);
 }
});
test('03B: valid empty page is unsupported, never phantom font text',async()=>{
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources <<>> >>'];
 let raw='%PDF-1.4\n';const offsets=[0];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(raw));raw+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const xref=Buffer.byteLength(raw);raw+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 const r=await parseArtifactBytesAsync(Buffer.from(raw));assert.equal(r.ok,false);assert.equal(r.code,'FORMAT_UNSUPPORTED');assert.equal(r.manualEntry,true);
});
test('03B: nonPDF async adapter preserves synchronous behavior',async()=>{
 const r=await parseArtifactBytesAsync(Buffer.from('日期,收入元,支出元\n2026-01-01,10,1'));
 assert.equal(r.format,'bank_statement_csv');assert.equal(r.aggregates.inflowTotal,10);
});
