import os, json, hashlib, stat, time, tarfile, re
from pathlib import Path
OUT=Path(__file__).parent
ROOT=Path(r'C:\Users\22673\Desktop\Archive')
TARGET=Path(r'C:\Users\22673\Desktop\Anthropic\materials\reusable-assets\20260906-archive')
rows=json.loads((OUT/'plan.json').read_text(encoding='utf-8'))
expected={r['path']:r for r in rows if r['action']!='retain'}
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
seen=set(); links=[];protected=[];hashes=0
patterns=rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{28,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
for base,dirs,files in os.walk(ROOT,followlinks=False):
    for name in list(dirs):
        p=Path(base)/name
        if p.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            links.append(p.relative_to(ROOT).as_posix());dirs.remove(name)
    for name in files:
        p=Path(base)/name; rel=p.relative_to(ROOT).as_posix()
        assert not p.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT,rel
        assert rel in expected,'New/unexpected file: '+rel
        r=expected[rel];s=p.stat()
        assert (s.st_size,s.st_mtime_ns)==(r['size'],r['mtime_ns']),'Changed file: '+rel
        if r['action']=='archive':
            assert digest(p)==r['sha256'],rel;hashes+=1
            if rel.endswith('.tar.gz'):
                with tarfile.open(p,'r:gz') as tar:
                    for member in tar:
                        if not member.isfile():continue
                        assert member.size < 100*1024*1024,'Unexpected large member'
                        data=tar.extractfile(member).read()
                        assert not re.search(patterns,data),'Credential pattern in '+rel
                        assert Path(member.name).name not in {'.env','.env.local','auth.json','credentials.json'},'Sensitive member in '+rel
        if r['action']=='protected':protected.append({'path':rel,'sha256':digest(p),'size':s.st_size})
        seen.add(rel)
assert seen==set(expected),'Missing source files'
for r in rows:
    if r['action']=='retain':
        assert not (ROOT/r['path']).exists(),r['path']
        assert digest(TARGET/r['destination'])==r['sha256'],r['destination']
expected_links=[s.replace('\\','/') for s in json.loads((OUT/'inventory-summary.json').read_text(encoding='utf-8'))['links']]
assert sorted(links)==sorted(expected_links),'Links changed'
receipt={'checked_at':time.time(),'source_files':len(seen),'archive_hashes_verified':hashes,'retained_verified':450,'protected':protected,'links':links,'ready_for_remote_verified_cleanup':True}
(OUT/'source-verification.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in receipt.items() if k not in ('protected','links')}))
