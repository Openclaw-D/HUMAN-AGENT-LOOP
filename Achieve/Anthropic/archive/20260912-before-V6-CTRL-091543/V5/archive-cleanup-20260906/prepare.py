import json, hashlib, re, zipfile, collections
from pathlib import Path

OUT=Path(__file__).parent
ROOT=Path(r'C:\Users\22673\Desktop\Archive')
rows=json.loads((OUT/'plan.json').read_text(encoding='utf-8'))
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
patterns={
 'github-token':rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
 'provider-key':rb'\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{28,}',
 'private-key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'aws-key':rb'\bAKIA[0-9A-Z]{16}\b',
 'jwt':rb'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}'
}
hits=[]
for i,r in enumerate(rows):
    if r['action'] not in ('retain','archive'):continue
    p=ROOT/r['path']; s=p.stat()
    assert (s.st_size,s.st_mtime_ns)==(r['size'],r['mtime_ns']),r['path']
    r['sha256']=digest(p)
    if p.suffix.lower() not in {'.png','.jpg','.jpeg','.mp4','.mp3','.wav','.glb','.zip','.gz','.pdf','.pptx','.xlsx'}:
        data=p.read_bytes()
        for label,pat in patterns.items():
            if re.search(pat,data):hits.append({'path':r['path'],'kind':label})
byhash={r['sha256'] for r in rows if 'sha256' in r and not r['path'].endswith('.zip')}
zip_checks=[]
for r in rows:
    if r['action']!='archive' or not r['path'].endswith('.zip'):continue
    with zipfile.ZipFile(ROOT/r['path']) as z:
        members=[v for v in z.infolist() if not v.is_dir()]
        all_present=True
        for m in members:
            data=z.read(m)
            if hashlib.sha256(data).hexdigest() not in byhash: all_present=False
            for label,pat in patterns.items():
                if re.search(pat,data):hits.append({'path':r['path']+'!'+m.filename,'kind':label})
        zip_checks.append({'path':r['path'],'members':len(members),'all_member_hashes_preserved':all_present})
        if all_present:
            r['action']='discard';r['reason']='duplicate-zip-all-members-hash-preserved'
checks=[]
for n in ('project-01','project-02','project-03'):
    base=ROOT/'Compare-Material-Archive-20260814/native-material-packs'/n
    manifest=json.loads((base/'manifest.json').read_text(encoding='utf-8'))
    for item in manifest['items']:
        assert item['classification']=='synthetic_demo',n
        assert item['material']['isSimulated'] is True,n
        src=(base/item['sourceFile']).resolve()
        assert base.resolve() in src.parents
        assert digest(src)==item['sha256'],str(src)
    checks.append({'case':n,'verified_items':len(manifest['items'])})
(OUT/'security-scan.json').write_text(json.dumps({'high_confidence_pattern_hits':hits,'zip_checks':zip_checks,'synthetic_checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
if hits:
    print(json.dumps({'blocked_hits':hits},ensure_ascii=False));raise SystemExit(2)
(OUT/'plan.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
summary=collections.defaultdict(lambda:[0,0])
for r in rows:summary[r['action']][0]+=1;summary[r['action']][1]+=r['size']
unique={r['sha256']:r['size'] for r in rows if r['action']=='archive'}
print(json.dumps({'actions':summary,'unique_archive_blobs':len(unique),'unique_archive_bytes':sum(unique.values()),'security_hits':len(hits),'synthetic_checks':checks},ensure_ascii=False))
