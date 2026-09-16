import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'Achieve/Migration');
const gitRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
if(fs.realpathSync(gitRoot)!==fs.realpathSync(root))throw new Error('Git root differs from JW root');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
const lines=execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
const index=new Map(lines.map(l=>{const tab=l.indexOf('\t');return [l.slice(tab+1),l.slice(0,tab).split(' ')[1]];}));
const nonRegularEntries=lines.filter(l=>!/^100(?:644|755) /.test(l)).map(l=>l.slice(l.indexOf('\t')+1));
if(nonRegularEntries.length)throw new Error('Non-regular Git entries: '+JSON.stringify(nonRegularEntries));
const mismatches=[],forbidden=[],missing=[],credentialFindings=[],reviewedFalsePositives=[];
function reviewedEmbeddedImage(data,text,kind,match){
 if(kind!=='google'||match.index!==18209063||match[0].length!==49)return false;
 if(createHash('sha256').update(data).digest('hex')!=='9ab42b7c7cca5de8731ca6f8b4fb3f1296f797c953515a8b7c29c3b28f452c6d')return false;
 // Independently inspected: the match is random PNG base64, not a config key.
 const begin=text.lastIndexOf('data:image/png;base64,',match.index);
 if(begin!==16471112)return false;
 const comma=text.indexOf(',',begin), end=text.indexOf('"',comma);
 return end===22754956&&match.index+match[0].length<end&&Buffer.from(text.slice(comma+1,comma+17),'base64').subarray(0,8).toString('hex')==='89504e470d0a1a0a';
}
let bytes=0;
for(const [rel,blob] of index){
 const resolved=fs.realpathSync(path.join(root,rel));
 const relative=path.relative(fs.realpathSync(root),resolved);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('File outside JW: '+rel);
 const data=fs.readFileSync(path.join(root,rel));bytes+=data.length;
 const text=data.toString('utf8');
 const patterns=[['github',/gh[pousr]_[A-Za-z0-9]{30,}/],['openai',/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}/],['aws',/AKIA[0-9A-Z]{16}/],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['google',/AIza[0-9A-Za-z_-]{30,}/]];
 for(const [kind,re] of patterns)for(const match of text.matchAll(new RegExp(re.source,'g'))){
  if(reviewedEmbeddedImage(data,text,kind,match))reviewedFalsePositives.push({file:rel,kind,offset:match.index,reason:'verified-PNG-base64-coincidence-exact-file-hash'});
  else credentialFindings.push({file:rel,kind});
 }
 const expected=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
 if(blob!==expected)mismatches.push(rel);
 if((/(?:^|\/)(node_modules|pgdata)(?:\/|$)|\.env(?:\.|$)|\.(pem|key|sqlite|db|log)$/.test(rel) && !/(\.env\.(example|sample)$)/.test(rel)) || (/(?:^|\/)dist(?:\/|$)/.test(rel)&&!rel.startsWith('Front/dist/')))forbidden.push(rel);
 if(rel.startsWith('Achieve/Migration/Local-Test-State/'))forbidden.push(rel);
}
for(const f of manifest.files)if(f.publish!==false&&!index.has(f.destination))missing.push(f.destination);
const result={time:new Date().toISOString(),gitRoot,allRealPathsWithinRoot:true,nonRegularEntries,stagedFiles:index.size,stagedBytes:bytes,rawBlobMismatches:mismatches,forbiddenPaths:forbidden,highConfidenceCredentialFindings:credentialFindings,reviewedFalsePositives,missingPublishableCopies:missing,localOnlyCopies:manifest.files.filter(f=>f.publish===false).length,commit:false,push:false};
fs.writeFileSync(path.join(out,'staged-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(mismatches.length||forbidden.length||missing.length||credentialFindings.length)process.exitCode=1;
