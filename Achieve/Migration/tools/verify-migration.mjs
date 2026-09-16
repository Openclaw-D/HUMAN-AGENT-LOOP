import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const mdir=path.join(root,'Achieve/Migration');
const manifestPath=path.join(mdir,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const rename=s=>s.replace(/^history\//,'Achieve/').replace(/^frontend\//,'Front/').replace(/^backend\//,'Back/').replace(/^Back\/B\/test\/\.tmp\//,'Achieve/Migration/Local-Test-State/').replace(/^(Achieve\/Anthropic\/.*)\/\.gitattributes$/,'$1/.gitattributes.source');
const mismatches=[], sourceDrift=[], links=[], unresolved=[], secrets=[], coverage={};
for(const f of manifest.files){
  f.destination=rename(f.destination);
  if(f.destination.startsWith('Achieve/Migration/Local-Test-State/')) { f.kind='local-only-test-state'; f.publish=false; }
  const dst=path.join(root,f.destination);
  if(!fs.existsSync(dst)||hash(fs.readFileSync(dst))!==f.sha256)mismatches.push(f.destination);
  const src=path.join(manifest.summary.source,f.source);
  if(!fs.existsSync(src)||hash(fs.readFileSync(src))!==f.sha256)sourceDrift.push(f.source);
  if(f.kind==='historical-original'&&f.source.endsWith('.md')){
    const top=f.source.split('/')[0];coverage[top]=(coverage[top]||0)+1;
  }
}
manifest.layoutVersion='JW-V0.1-Achieve-Front-Back';
manifest.summary.byKind={};for(const f of manifest.files){const v=manifest.summary.byKind[f.kind]??={files:0,bytes:0};v.files++;v.bytes+=f.bytes;}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const all=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const f=path.join(dir,e.name);
  if(e.isSymbolicLink()){links.push(path.relative(root,f));continue;}
  if(e.isDirectory()){if(!['node_modules','.git','dist','.local','.tmp','runtime','checkpoints','receipts','registry'].includes(e.name))walk(f);}
  else all.push(f);
}}
walk(root);
for(const f of all){
  const rel=path.relative(root,f).replaceAll('\\','/');
  if(f.endsWith('verify-migration.mjs'))continue;
  const text=fs.readFileSync(f,'utf8');
  const high=[['github',/gh[pousr]_[A-Za-z0-9]{30,}/],['openai',/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}/],['aws',/AKIA[0-9A-Z]{16}/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['google',/AIza[0-9A-Za-z_-]{30,}/]];
  for(const [kind,re] of high)if(re.test(text))secrets.push({file:rel,kind});
  if(!/^(Front|Back)\//.test(rel)||!/[.](ts|tsx|mjs|cjs|js|jsx)$/.test(f))continue;
  for(const m of text.matchAll(/(?:from\s*|import\s*\(|import\s*|require\s*\()['"]([^'"]+)['"]/g)){
    if(!m[1].startsWith('.'))continue;
    const base=path.resolve(path.dirname(f),m[1]);
    const variants=[base,...['.ts','.tsx','.mjs','.js','.json','/index.ts','/index.tsx','/index.mjs'].map(e=>base+e)];
    if(!variants.some(v=>fs.existsSync(v)&&fs.statSync(v).isFile()))unresolved.push({file:rel,import:m[1]});
    if(!base.startsWith(root+path.sep))unresolved.push({file:rel,import:m[1],outsideRoot:true});
  }
}
const result={time:new Date().toISOString(),copied:manifest.files.length,mismatches,sourceDrift,links,unresolved,secrets,originalMarkdownByVersion:coverage,originalMarkdownCount:Object.values(coverage).reduce((a,b)=>a+b,0),bytes:manifest.summary.bytes};
fs.writeFileSync(path.join(mdir,'checks.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(mismatches.length||links.length||unresolved.length||secrets.length)process.exitCode=1;
