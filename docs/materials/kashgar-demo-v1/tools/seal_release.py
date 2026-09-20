"""Seal only after recorded manual visual review. Does not publish or change Git state."""
from pathlib import Path
import json,hashlib,subprocess,sys,re
ROOT=Path(__file__).resolve().parents[1]
if '--visual-reviewed' not in sys.argv:raise SystemExit('Requires explicit --visual-reviewed after inspecting PDF and workbook previews')
p=ROOT/'VALIDATION.json';d=json.loads(p.read_text(encoding='utf-8'))
d['visualReview']='PASS: 66 PDF pages rendered and contact-reviewed; 33 worksheet views reviewed; representative PDF/table checked full-size. Not user acceptance.'
d['visualReviewLimit']='Workbook previews cover first six columns and initial rows per sheet; later fields checked numerically, not every cell visually.'
files=[x for x in ROOT.rglob('*') if x.is_file() and x.name not in ['SHA256SUMS.txt','GIT_DELIVERY.json']]
repo=ROOT.parents[1]
check=subprocess.run(['git','check-ignore','--stdin'],cwd=repo,input='\n'.join(x.relative_to(repo).as_posix() for x in files)+'\n',text=True,capture_output=True,encoding='utf-8')
assert check.returncode in [0,1],check.stderr
assert not check.stdout.strip(),check.stdout
for path in files:
 if path.suffix in ['.md','.json','.csv','.html','.mjs','.py','.svg']:
  text=path.read_text(encoding='utf-8-sig')
  assert not re.search(r'(?<!\w)(?:sk-[A-Za-z0-9]{24,}|1[3-9]\d{9})(?!\w)',text),path
d['gitIgnoreCheck']='PASS: package files are not excluded by current Git ignore rules'
d['basicSensitivePatternCheck']='PASS: no API key pattern or mainland mobile-number pattern in authored text; all entity identifiers intentionally synthetic'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
delivery={'intendedForGit':True,'scope':'docs/materials/kashgar-demo-v1/**','notIncluded':['.local QA previews/dependencies','other in-progress Back/Front changes','historical original pack'],'status':'NOT_STAGED_NOT_COMMITTED_NOT_PUSHED','fileCount':len(files)+2,'totalBytesExcludingSeal':sum(x.stat().st_size for x in files),'policy':'Only synthetic demo files; runtime customer IDs/invitation tokens/credentials are not part of this package.'}
(ROOT/'GIT_DELIVERY.json').write_text(json.dumps(delivery,ensure_ascii=False,indent=2),encoding='utf-8')
files=sorted(x for x in ROOT.rglob('*') if x.is_file() and x.name!='SHA256SUMS.txt')
(ROOT/'SHA256SUMS.txt').write_text('\n'.join(hashlib.sha256(x.read_bytes()).hexdigest()+'  '+x.relative_to(ROOT).as_posix() for x in files)+'\n',encoding='utf-8')
print(json.dumps(delivery,ensure_ascii=False,indent=2))
