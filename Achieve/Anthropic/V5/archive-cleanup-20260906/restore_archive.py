"""Restore a verified cold snapshot without overwriting existing files."""
import argparse, json, hashlib, zipfile
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--parts',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--verify-only',action='store_true')
a=p.parse_args()
base=Path(__file__).parent
manifest=json.loads((base/'manifest.json').read_text(encoding='utf-8'))
parts=json.loads((base/'release-parts.json').read_text(encoding='utf-8'))
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
    return h.hexdigest()
for part in parts:
    path=a.parts/part['name']
    assert path.stat().st_size==part['size'],part['name']
    assert digest(path)==part['sha256'],part['name']
root=a.output.resolve()
targets=[]
for r in manifest:
    target=(root/r['path']).resolve()
    assert root in target.parents,r['path']
    if not a.verify_only:assert not target.exists(),str(target)
    targets.append((r,target))
verified=set()
for part in parts:
    with zipfile.ZipFile(a.parts/part['name']) as z:
        for r,target in targets:
            if r['part']!=part['name']:continue
            data=z.read('blobs/'+r['sha256'])
            assert len(data)==r['size'] and hashlib.sha256(data).hexdigest()==r['sha256'],r['path']
            verified.add(r['sha256'])
            if not a.verify_only:
                target.parent.mkdir(parents=True,exist_ok=True)
                with target.open('xb') as f:f.write(data)
print(json.dumps({'verified_paths':len(targets),'verified_blobs':len(verified),'restored':not a.verify_only}))
