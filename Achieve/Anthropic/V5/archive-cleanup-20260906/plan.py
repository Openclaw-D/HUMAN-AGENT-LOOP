import json, collections
from pathlib import Path

OUT=Path(__file__).parent
rows=json.loads((OUT/'inventory.json').read_text(encoding='utf-8'))
generated={'node_modules','.git','.venv','venv','__pycache__','.pytest_cache','.next','.vite','.cache','library','temp','obj','logs','dist','builds','usersettings','coverage','.stars-data','runtime'}
selected_root='TAG-sources-20260821/'
def classify(r):
    p=r['path']; parts=p.split('/'); low=[s.lower() for s in parts]; name=low[-1]
    if '.codex-remote-attachments' in low: return 'protected','attachment',None
    if p.startswith(selected_root+'Material/record/'): return 'discard','recording-user-has-backup',None
    if any(s in generated or s.startswith('.pytest-tmp') or s.startswith('.ppt-build') for s in low): return 'discard','generated-or-local-state',None
    if name in {'.env','.env.local','auth.json','credentials.json'} or name.endswith(('.db','.db-wal','.db-shm','.sqlite','.sqlite3','.log','.pyc','.pfx','.key','.pem')): return 'discard','local-state-or-sensitive',None
    if p.startswith(selected_root+'Stars/'):
        return 'retain','a2a-reference','01-stars-a2a/'+p[len(selected_root+'Stars/'):]
    prefix=selected_root+'JW/Compare/Back/'
    if p.startswith(prefix):
        return 'retain','backend-and-evals','02-jw-backend/'+p[len(prefix):]
    prefix='Compare-Material-Archive-20260814/native-material-packs/'
    if p.startswith(prefix) and (parts[2] in ('project-01','project-02','project-03','package-index.json')):
        return 'retain','synthetic-fixture','03-synthetic-cases/'+p[len(prefix):]
    if p in [selected_root+'Race/'+n for n in ('见微-比赛路演-v4.pptx','见微-比赛路演-手稿版-v4.pptx','见微-比赛路演-5分钟提示卡-v3.txt')]:
        return 'retain','presentation','04-presentation/'+parts[-1]
    if p.startswith(selected_root+'TQ/') and len(parts)==3:
        return 'retain','interaction-reference','05-tq-demo/'+parts[-1]
    return 'archive','historical-source-or-asset',None

for r in rows:
    r['action'],r['reason'],r['destination']=classify(r)
(OUT/'plan.json').write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
groups=collections.defaultdict(lambda:[0,0]); cold=[]
for r in rows:
    groups[r['action']][0]+=1;groups[r['action']][1]+=r['size']
    if r['action']=='archive': cold.append(r)
ext=collections.defaultdict(lambda:[0,0])
for r in cold:
    k=Path(r['path']).suffix.lower();ext[k][0]+=1;ext[k][1]+=r['size']
summary={'actions':groups,'archive_extensions':dict(sorted(ext.items(),key=lambda x:x[1][1],reverse=True)[:22]),'largest_archive':sorted(cold,key=lambda x:x['size'],reverse=True)[:10]}
(OUT/'plan-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
