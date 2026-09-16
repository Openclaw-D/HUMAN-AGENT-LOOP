import zipfile, hashlib, json
from pathlib import Path
root=Path(__file__).parent
target=root/'audit-evidence.zip'
files=[p for p in root.iterdir() if p.is_file() and p.name!='audit-evidence.zip']
assert not target.exists()
hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:z.write(p,p.name)
with zipfile.ZipFile(target) as z:
    for name,digest in hashes.items():assert hashlib.sha256(z.read(name)).hexdigest()==digest,name
receipt={'verified':True,'members':len(files),'zip_bytes':target.stat().st_size,'zip_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
(root/'evidence-zip-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps(receipt))
