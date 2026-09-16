import json, hashlib, zipfile, collections
from pathlib import Path

OUT=Path(__file__).parent
ROOT=Path(r'C:\Users\22673\Desktop\Archive')
STAGE=Path(r'C:\Users\22673\Desktop\Archive-transfer-20260906')
REPO=STAGE/'repo'; PACK=STAGE/'release'
REPO.mkdir(parents=True,exist_ok=True);PACK.mkdir(exist_ok=True)
assert not list(PACK.iterdir()),'Release staging is not empty'
rows=json.loads((OUT/'plan.json').read_text(encoding='utf-8'))
archive=[r for r in rows if r['action']=='archive']
unique={}
for r in archive:unique.setdefault(r['sha256'],r)
parts=[]; assignments={}; batch=[];size=0
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def emit(batch):
    name=f'archive-part-{len(parts)+1:03d}.zip';dest=PACK/name
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:
        for r in batch:
            source=ROOT/r['path']
            assert digest(source)==r['sha256'],r['path']
            z.write(source, 'blobs/'+r['sha256'])
            assignments[r['sha256']]=name
    parts.append({'name':name,'size':dest.stat().st_size,'sha256':digest(dest),'blobs':len(batch)})
    print(json.dumps(parts[-1]),flush=True)
for r in unique.values():
    if batch and size+r['size']>128*1024*1024:
        emit(batch);batch=[];size=0
    batch.append(r);size+=r['size']
if batch:emit(batch)
manifest=[{'path':r['path'],'size':r['size'],'sha256':r['sha256'],'part':assignments[r['sha256']]} for r in archive]
(REPO/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(REPO/'release-parts.json').write_text(json.dumps(parts,indent=2),encoding='utf-8')
(OUT/'release-parts.json').write_text(json.dumps(parts,indent=2),encoding='utf-8')
summary=collections.defaultdict(lambda:{'files':0,'bytes':0})
for r in rows:summary[r['action']]['files']+=1;summary[r['action']]['bytes']+=r['size']
(REPO/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({'archive_files':len(archive),'unique_blobs':len(unique),'parts':len(parts),'upload_bytes':sum(p['size'] for p in parts)}),flush=True)
