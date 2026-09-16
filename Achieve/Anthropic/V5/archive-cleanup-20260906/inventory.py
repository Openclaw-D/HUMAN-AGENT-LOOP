import os, json, collections, stat
from pathlib import Path

ROOT = Path(r'C:\Users\22673\Desktop\Archive')
OUT = Path(__file__).parent
rows, links = [], []
for base, dirs, files in os.walk(ROOT, followlinks=False):
    for name in list(dirs):
        p = Path(base) / name
        if p.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            links.append(str(p.relative_to(ROOT)))
            dirs.remove(name)
    for name in files:
        p = Path(base) / name
        if p.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            links.append(str(p.relative_to(ROOT)))
            continue
        s = p.stat()
        rows.append({'path':p.relative_to(ROOT).as_posix(), 'size':s.st_size, 'mtime_ns':s.st_mtime_ns})
(OUT/'inventory.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
groups=collections.defaultdict(lambda:[0,0])
for r in rows:
    k='/'.join(r['path'].split('/')[:2]); groups[k][0]+=1; groups[k][1]+=r['size']
summary={'files':len(rows),'bytes':sum(r['size'] for r in rows),'groups':groups,'links':links,
         'largest':sorted(rows,key=lambda r:r['size'],reverse=True)[:22],
         'protected':[r for r in rows if '.codex-remote-attachments' in r['path'].split('/')],
         'potential_secrets':[r['path'] for r in rows if Path(r['path']).name in ('.env','.env.local','credentials.json','auth.json') or Path(r['path']).suffix in ('.pem','.key','.pfx')]}
(OUT/'inventory-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
