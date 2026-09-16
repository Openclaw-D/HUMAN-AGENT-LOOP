import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const source='C:/Users/22673/Desktop/Anthropic/V7/backend-next';
const omitted=new Set(['node_modules','.git','.run','.tmp','.data','runtime','checkpoints','receipts','registry','evidence','spike','dist','build']);
const files=[],excluded=[];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function walk(dir,rel=''){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const r=rel?rel+'/'+e.name:e.name,p=path.join(dir,e.name);
  if(e.isSymbolicLink())throw new Error('Source link requires review: '+r);
  if(e.isDirectory()){
   if(omitted.has(e.name)||/^\.(?:b-final|assembly|runtime)/.test(e.name)){excluded.push({path:r+'/',reason:'dependency-runtime-evidence-or-isolated-spike'});continue;}
   walk(p,r);continue;
  }
  if(e.name==='b-config.json'||/^\.(?:b-final|assembly|runtime)/.test(e.name)||/^\.env(?!\.(?:example|sample)$)/.test(e.name)||/[.](?:log|jsonl|sqlite|db|tsbuildinfo)$/.test(e.name)){excluded.push({path:r,reason:'local-config-runtime-or-generated'});continue;}
  const dst=path.join(root,'Back',r);
  files.push({source:r,destination:'Back/'+r,sha256:hash(p),exists:fs.existsSync(dst),equal:fs.existsSync(dst)&&hash(p)===hash(dst)});
 }
}
walk(source);
const result={time:new Date().toISOString(),source,destination:path.join(root,'Back'),checked:files.length,missing:files.filter(f=>!f.exists).map(f=>f.source),different:files.filter(f=>f.exists&&!f.equal).map(f=>f.source),excluded,files};
fs.writeFileSync(path.join(root,'Achieve/Migration/latest-backend-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,files:undefined,excluded:undefined},null,2));
if(result.missing.length||result.different.length)process.exitCode=1;
