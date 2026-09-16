import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/22673/Desktop/Anthropic';
const omit = new Set(['node_modules','.git','.next','.vinext','.wrangler','.venv','venv','__pycache__','.vite','.pytest_cache','.mypy_cache','Binaries','Intermediate','DerivedDataCache','Library']);
const groups = new Map();
const large=[]; const links=[]; let count=0;
function walk(dir) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,e.name), rel=path.relative(root,file).replaceAll('\\','/');
    if (e.isSymbolicLink()) {links.push(rel);continue;}
    if(e.isDirectory()){if(!omit.has(e.name)&&rel!=='.codex-remote-attachments')walk(file);continue;}
    const stat=fs.statSync(file);count++;
    const group=rel.split('/')[0]; const row=groups.get(group)||{files:0,bytes:0,markdown:0,markdownBytes:0};
    row.files++;row.bytes+=stat.size;
    if(/\.md$/i.test(e.name)){row.markdown++;row.markdownBytes+=stat.size;}
    groups.set(group,row);
    if(stat.size>2*1024*1024)large.push({file:rel,bytes:stat.size});
  }
}
walk(root);
console.log(JSON.stringify({count,groups:Object.fromEntries(groups),large:large.sort((a,b)=>b.bytes-a.bytes).slice(0,55),links},null,2));
