# -*- coding: utf-8 -*-
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,gzip,tarfile,shutil,io
ROOT=Path.cwd(); W=ROOT/'work/m1d-outpost-20261023'; OUT=ROOT/'docs/evidence/m1-d-outpost'
OUT.mkdir(parents=True,exist_ok=True); (OUT/'scripts').mkdir(exist_ok=True)
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def copy(src,name=None):
 src=Path(src);dst=OUT/(name or src.name);shutil.copyfile(src,dst)
def gz(src):
 p=Path(src)
 with (OUT/(p.name+'.gz')).open('wb') as fp:
  with gzip.GzipFile(filename='',fileobj=fp,mode='wb',mtime=0) as z:z.write(p.read_bytes())
def archive(name,paths):
 with (OUT/name).open('wb') as fp:
  with gzip.GzipFile(filename='',fileobj=fp,mode='wb',mtime=0) as g:
   with tarfile.open(fileobj=g,mode='w') as t:
    for p,arcname in sorted(paths,key=lambda x:x[1]):t.add(p,arcname=arcname,recursive=False)
for name in ['baseline.json','environment.json','frozen-application.json','production-serving.json','verification.json']:
 copy(W/name)
copy(ROOT/'work/m1d-outpost-art-generation.log','art-generation.log');copy(ROOT/'work/m1d-outpost-art-verification.json','art-verification.json');copy(ROOT/'work/m1d-outpost-art-review.png','art-contact-sheet.png')
for name in ['browser-initial.json','browser-corrected.json','browser-final.json','unit-final.json']:gz(W/name)
logpaths=[(p,str(p.relative_to(W))) for p in W.glob('*.log')]+[(p,str(p.relative_to(W))) for p in W.glob('*.stderr.log')]
archive('validation-logs.tar.gz',list(dict.fromkeys(logpaths)))
failed=[(p,str(p.relative_to(W/'browser-initial'))) for p in (W/'browser-initial').rglob('*') if p.is_file()]
archive('browser-initial-failures.tar.gz',failed)
archive('corrected-attachments.tar.gz',[(p,p.name) for p in (W/'corrected-attachments').iterdir() if p.is_file()])
production=sorted((W/'production-ui').glob('run-*'))[-1]
archive('production-ui.tar.gz',[(p,str(p.relative_to(production))) for p in production.rglob('*') if p.is_file()])
for source,target in [('outpost-baseline.sceneweave','outpost-editable.sceneweave'),('gm-4k.png','outpost-gm-4k.png'),('player-4k.png','outpost-player-4k.png'),('outpost-open-gm-desktop.png','outpost-desktop.png'),('outpost-reopened-player-390.png','outpost-player-390.png'),('report.json','production-report.json')]:copy(production/source,target)
frozen=json.loads((W/'frozen-application.json').read_text());archive('application.tar.gz',[(ROOT/p,p) for p in frozen['applicationFiles']])
serving=json.loads((W/'production-serving.json').read_text());archive('normal-dist.tar.gz',[(ROOT/p,p) for p in serving['distFiles']])
for name in ['production-runner.mjs','verify-evidence.py','archive-evidence.py','final-checks.py']:
 if (W/name).exists():copy(W/name,'scripts/'+name)
# Index the exact original inputs separately from derived summaries. Exclude index/final checks for stable reruns.
raw={}
for name in ['browser-initial.json','browser-corrected.json','browser-final.json','unit-final.json']:
 b=(W/name).read_bytes();raw[name]={'sha256':sha(b),'bytes':len(b)}
files={str(p.relative_to(OUT)):{'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size} for p in sorted(OUT.rglob('*')) if p.is_file() and p.name not in ['index.json','final-checks.json','archive-verification.json']}
(OUT/'index.json').write_text(json.dumps({'createdAt':datetime.now(timezone.utc).isoformat(),'version':'0.2.0-m1-d-outpost','originalReporters':raw,'files':files,'limits':'Original raw evidence is preserved by batch; no performance sample or full SCN/P3 acceptance is claimed.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':len(files),'bytes':sum(v['bytes'] for v in files.values())},indent=2))
