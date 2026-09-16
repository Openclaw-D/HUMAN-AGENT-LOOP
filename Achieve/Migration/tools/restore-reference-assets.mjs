// Supplement the original snapshot without rewriting or deleting any source.
// The user clarified that tens-of-MB references should be preserved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'Achieve/Migration');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
const excluded=JSON.parse(fs.readFileSync(path.join(out,'excluded.json'),'utf8'));
const apply=process.argv.includes('--apply');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const known=new Map(manifest.files.map(f=>[f.destination,f]));
const files=[],keptAtSource=[];
const realSource=fs.realpathSync(excluded.source);
for(const e of excluded.exclusions){
 if(!['large-reference-kept-at-source','binary-or-nonessential-kept-at-source'].includes(e.reason))continue;
 const src=path.resolve(realSource,e.path);
 const stat=fs.lstatSync(src);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unexpected source type: '+e.path);
 const relative=path.relative(realSource,fs.realpathSync(src));
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Source escaped: '+e.path);
 let reason=null;
 if(/node_modules[.]restore[.]zip$/.test(e.path))reason='rebuildable-dependency-bundle';
 else if(/site-package(?:-incremental)?[.]tar[.]gz$/.test(e.path))reason='generated-site-deployment-bundle';
 else if(/audit-evidence[.]zip$/.test(e.path))reason='duplicate-bundle-of-preserved-audit-files';
 else if(/[.](?:tmp|lnk|out|data-orig)$/.test(e.path))reason='temporary-state-or-machine-local-shortcut';
 else if(stat.size>=300*1024*1024)reason='large-reference-needs-individual-review';
 // Ordinary Git upload has a separate per-file limit; do not silently use LFS.
 else if(stat.size>=100*1024*1024)reason='individual-upload-routing-review';
 if(reason){keptAtSource.push({source:e.path,bytes:stat.size,reason});continue;}
 const destination='Achieve/Anthropic/'+e.path;
 const entry={source:e.path,destination,kind:'historical-original',bytes:stat.size,sha256:sha(fs.readFileSync(src)),exception:'restored-after-size-policy-clarification'};
 files.push(entry);
 if(!apply)continue;
 const dst=path.resolve(root,destination);
 if(!dst.startsWith(root+path.sep))throw new Error('Destination escaped');
 fs.mkdirSync(path.dirname(dst),{recursive:true});
 if(fs.existsSync(dst)){
  if(sha(fs.readFileSync(dst))!==entry.sha256)throw new Error('Existing copy differs: '+destination);
 }else fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
 if(sha(fs.readFileSync(src))!==entry.sha256||sha(fs.readFileSync(dst))!==entry.sha256)throw new Error('Copy mismatch or source drift');
 if(!known.has(destination)){manifest.files.push(entry);known.set(destination,entry);}
}
const unique=new Map(files.map(f=>[f.sha256,f.bytes]));
const report={time:new Date().toISOString(),apply,source:realSource,destination:root,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),uniqueContentFiles:unique.size,uniqueContentBytes:[...unique.values()].reduce((a,b)=>a+b,0),largestBytes:Math.max(0,...files.map(f=>f.bytes)),copied:files,keptAtSource};
if(apply){
 manifest.summary.planned=manifest.files.length;
 manifest.summary.bytes=manifest.files.reduce((n,f)=>n+f.bytes,0);
 manifest.summary.markdown=manifest.files.filter(f=>f.source.endsWith('.md')).length;
 manifest.summary.byKind={};
 for(const f of manifest.files){const k=manifest.summary.byKind[f.kind]??={files:0,bytes:0};k.files++;k.bytes+=f.bytes;}
 manifest.sizePolicyUpdatedAt=report.time;
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(out,'size-policy-supplement.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({...report,copied:undefined},null,2));
