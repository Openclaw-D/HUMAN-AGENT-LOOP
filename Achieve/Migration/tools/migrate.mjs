import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = 'C:/Users/22673/Desktop/Anthropic';
const apply = process.argv.includes('--apply');
const slash = s => s.replaceAll('\\','/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const pruned = new Set(['node_modules','.git','.next','.vinext','.wrangler','.venv','venv','__pycache__','.vite','.pytest_cache','.mypy_cache','Binaries','Intermediate','DerivedDataCache','Library','pgdata','.run','.data','.v5-preview-data','.v6-runtime','.openai']);
const sourceExt = new Set(['.md','.mdx','.txt','.json','.yaml','.yml','.toml','.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.scss','.html','.svg','.py','.ps1','.sh','.sql','.prisma','.cs','.cpp','.h','.hpp','.ini','.cfg','.xml','.mmd','.csv','.tsv','.sha256','.diff','.patch','.gitignore','.gitattributes']);
const exclusions=[]; const plan=[]; const seen=new Set();
function reason(rel, size) {
  const name=path.posix.basename(rel), ext=path.posix.extname(rel).toLowerCase();
  if ((/^\.env(?:\.|$)/.test(name) && !/(example|sample|template)$/.test(name)) || /\.(pem|key|pfx|p12|sqlite|sqlite3|db|tsbuildinfo|log|jsonl)$/.test(name) || name==='b-config.json') return 'local-data-or-sensitive-config';
  if (rel.split('/').some(p=>/^dist$|^build$|^\.next|^\.b-final|^\.assembly|^\.runtime/.test(p))) return 'generated-output';
  if (ext!=='.md' && rel.split('/').some(p=>p==='runtime'||p==='checkpoints'||p==='receipts'||p==='registry') && !['.mjs','.ts','.js','.py','.sh','.ps1'].includes(ext)) return 'runtime-state';
  if (size>2*1024*1024 && ext!=='.md') return 'large-reference-kept-at-source';
  if (!sourceExt.has(ext) && !['Dockerfile','LICENSE','Makefile','.gitignore','.gitattributes','.dockerignore'].includes(name)) return 'binary-or-nonessential-kept-at-source';
  return null;
}
function add(from,to,kind) {
  if(kind==='historical-original' && to.endsWith('/.gitattributes'))to+='.source';
  if(seen.has(to)) return;
  seen.add(to);
  const size=fs.statSync(path.join(source,from)).size;
  plan.push({source:from,destination:to,kind,bytes:size});
}
function walk(dir, rel='') {
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const r=rel?`${rel}/${e.name}`:e.name, f=path.join(dir,e.name);
    if(e.isSymbolicLink()){exclusions.push({path:r,reason:'link-not-followed'});continue;}
    if(e.isDirectory()){
      if(pruned.has(e.name)||e.name.startsWith('.next')||r==='.codex-remote-attachments'){exclusions.push({path:r+'/',reason:'dependencies-cache-database-or-protected-directory'});continue;}
      walk(f,r);continue;
    }
    const why=reason(r,fs.statSync(f).size);
    if(why){exclusions.push({path:r,reason:why});continue;}
    add(r,`Achieve/Anthropic/${r}`,'historical-original');
    if(r.startsWith('V7/backend-next/')){
      const suffix=r.slice('V7/backend-next/'.length);
      if(!suffix.includes('/evidence/') && !suffix.includes('/spike/') && !suffix.includes('/runtime/') && !suffix.includes('/.tmp/') && !suffix.includes('/assembly/.'))add(r,`Back/${suffix}`,'current-backend');
    }
    const home='V6/REPAIR_20260914_EVENING/home/';
    if(r.startsWith(home+'preview/') || r.startsWith(home+'site-mirror/')){
      if(r.endsWith('vite.config.mjs'))continue;
      // Four old bridge wrappers are replaced by exact copies of their real source.
      const sub=r.slice(home.length);
      if(['site-mirror/app/v5-preview/api-client.ts','site-mirror/app/v5-preview/rows-logic.ts','site-mirror/app/v5-preview/se-icons.tsx','site-mirror/lib/v5-preview/shared-types.ts'].includes(sub))continue;
      add(r,`Front/${sub}`,'current-frontend');
    }
  }
}
walk(source);
// Preserve actual imported modules locally, including their transitive relative imports.
const modules=['app/v5-preview/api-client.ts','app/v5-preview/rows-logic.ts','app/v5-preview/se-icons.tsx','lib/v5-preview/shared-types.ts'];
function includeModule(rel){
  const to=`Front/site-mirror/${rel}`;
  if(seen.has(to))return;
  const from=`jianwei-v3/site/${rel}`;
  if(!fs.existsSync(path.join(source,from)))throw new Error(`Missing source dependency: ${from}`);
  add(from,to,'frontend-localized-dependency');
  const text=fs.readFileSync(path.join(source,from),'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
    if(!match[1].startsWith('.'))continue;
    const base=path.posix.normalize(path.posix.join(path.posix.dirname(rel),match[1]));
    const resolved=[base,...['.ts','.tsx','.mjs','.js','/index.ts','/index.tsx'].map(e=>base+e)].find(p=>fs.existsSync(path.join(source,'jianwei-v3/site',p))&&fs.statSync(path.join(source,'jianwei-v3/site',p)).isFile());
    if(!resolved)throw new Error(`Unresolved dependency ${rel}: ${match[1]}`);
    includeModule(resolved);
  }
}
modules.forEach(includeModule);
const summary={source,destination,planned:plan.length,bytes:plan.reduce((n,x)=>n+x.bytes,0),markdown:plan.filter(x=>x.source.endsWith('.md')).length,byKind:{},excludedEntries:exclusions.length};
for(const e of plan){const s=summary.byKind[e.kind]??={files:0,bytes:0};s.files++;s.bytes+=e.bytes;}
console.log(JSON.stringify(summary,null,2));
if(apply){
  for(const e of plan){
    const src=path.resolve(source,e.source), dst=path.resolve(destination,e.destination);
    if(!dst.startsWith(destination+path.sep))throw new Error('Destination escaped');
    const bytes=fs.readFileSync(src);e.sha256=sha(bytes);
    fs.mkdirSync(path.dirname(dst),{recursive:true});
    if(fs.existsSync(dst)){
      if(sha(fs.readFileSync(dst))!==e.sha256)throw new Error(`Existing destination differs: ${e.destination}`);
    }else fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
    if(sha(fs.readFileSync(dst))!==e.sha256 || sha(fs.readFileSync(src))!==e.sha256)throw new Error(`Copy verification/source drift: ${e.source}`);
  }
  const out=path.join(destination,'Achieve/Migration');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),summary,files:plan},null,2)+'\n');
  fs.writeFileSync(path.join(out,'excluded.json'),JSON.stringify({source,exclusions},null,2)+'\n');
  console.log('COPY_VERIFIED '+plan.length);
}
