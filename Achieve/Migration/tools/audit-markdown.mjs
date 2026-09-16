import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const dir=path.join(root,'Achieve/Migration');
const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const known=new Set(m.files.filter(x=>x.kind==='historical-original').map(x=>x.source));
const hashes=new Set(m.files.filter(x=>x.source.endsWith('.md')).map(x=>x.sha256));
const args=['--files','--hidden','--no-ignore','-g','*.md','-g','!**/node_modules/**','-g','!**/.git/**','-g','!.codex-remote-attachments/**','-g','!**/.next*/**','-g','!**/.venv/**','-g','!**/venv/**','-g','!**/.openai/**'];
const r=spawnSync('rg',args,{cwd:m.summary.source,encoding:'utf8',maxBuffer:1024*1024*8});
if(r.status!==0)throw new Error(r.stderr);
const duplicates=[],uniqueMissing=[];
for(const f of r.stdout.trim().split(/\r?\n/)){
 const rel=f.replaceAll('\\','/');if(known.has(rel))continue;
 const sha=createHash('sha256').update(fs.readFileSync(path.join(m.summary.source,rel))).digest('hex');
 (hashes.has(sha)?duplicates:uniqueMissing).push(rel);
}
const result={sourceMarkdownFiles:r.stdout.trim().split(/\r?\n/).length,preservedOriginals:m.files.filter(x=>x.kind==='historical-original'&&x.source.endsWith('.md')).length,omittedIdenticalCopies:duplicates,uniqueMissing};
if(process.argv.includes('--preserve')){
 for(const rel of [...duplicates,...uniqueMissing]){
  const from=path.join(m.summary.source,rel), dest=`Achieve/Anthropic/${rel}`, to=path.join(root,dest);
  if(!to.startsWith(root+path.sep)||!rel.endsWith('.md'))throw new Error('Unexpected target');
  const bytes=fs.readFileSync(from); const sha256=createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
  if(createHash('sha256').update(fs.readFileSync(to)).digest('hex')!==sha256)throw new Error('Copy mismatch');
  m.files.push({source:rel,destination:dest,kind:'historical-original',bytes:bytes.length,sha256,exception:'preserve-small-markdown-from-excluded-test-snapshot'});
 }
 m.summary.planned=m.files.length;m.summary.bytes=m.files.reduce((n,f)=>n+f.bytes,0);m.summary.markdown=m.files.filter(f=>f.source.endsWith('.md')).length;
 m.summary.byKind={};for(const f of m.files){const v=m.summary.byKind[f.kind]??={files:0,bytes:0};v.files++;v.bytes+=f.bytes;}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(m,null,2)+'\n');
 result.preservedOriginals=m.files.filter(x=>x.kind==='historical-original'&&x.source.endsWith('.md')).length;
 result.additionallyPreserved=[...duplicates,...uniqueMissing];result.omittedIdenticalCopies=[];result.uniqueMissing=[];
}
fs.writeFileSync(path.join(dir,'markdown-coverage.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.uniqueMissing.length)process.exitCode=1;
