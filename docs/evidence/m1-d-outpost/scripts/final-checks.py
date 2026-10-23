# -*- coding: utf-8 -*-
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re,subprocess,urllib.parse,gzip,tarfile,zipfile,io,base64
ROOT=Path.cwd(); W=ROOT/'work/m1d-outpost-20261023'; OUT=ROOT/'docs/evidence/m1-d-outpost'
sha=lambda b:hashlib.sha256(b).hexdigest()
checks={'capturedAt':datetime.now(timezone.utc).isoformat()}
for n in ['final-checks.json','archive-verification.json']:(OUT/n).touch(exist_ok=True)
base=json.loads((W/'baseline.json').read_text());frozen=json.loads((W/'frozen-application.json').read_text())
checks['protected']={'files':len(base['protected']),'mismatches':[p for p,h in base['protected'].items() if not (ROOT/p).is_file() or sha((ROOT/p).read_bytes())!=h]}
checks['frozen']={'files':len(frozen['applicationFiles']),'mismatches':[p for p,h in frozen['applicationFiles'].items() if sha((ROOT/p).read_bytes())!=h]}
checks['todoPreserved']=sha((ROOT/'todo.md').read_bytes())==base['todoSha256'];checks['headUnchanged']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head']
checks['indexUnchanged']=not subprocess.check_output(['git','diff','--cached','--name-only'],text=True).strip()
checks['version']=json.loads((ROOT/'package.json').read_text())['version']
def lines(p):
 fenced=False
 for n,l in enumerate(p.read_text().splitlines(),1):
  if re.match(r'^\s*(```|~~~)',l):fenced=not fenced;continue
  if not fenced:yield n,l
def anchors(p):
 found=set();counts={}
 for _,l in lines(p):
  m=re.match(r'^#{1,6}\s+(.+?)\s*#*$',l)
  if not m:continue
  title=re.sub(r'!?\[([^\]]+)\]\([^)]*\)',r'\1',m[1]);title=re.sub(r'<[^>]+>','',title).replace('`','');value=re.sub(r'[^\w\-\s]','',title.lower());value=re.sub(r'\s','-',value);n=counts.get(value,0);counts[value]=n+1;found.add(value if not n else value+'-'+str(n))
 return found
documents=[ROOT/p for p in ['README.md','AGENTS.md','CONTRIBUTING.md','task_plan.md','findings.md','progress.md']]+sorted((ROOT/'docs').glob('*.md'))+[OUT/'README.md',ROOT/'assets/sceneweave-handdrawn-outpost/README.md']
broken=[];refs=0;anchorrefs=0;tables=0;tableissues=[]
def cells(l):
 # Inline code can contain a literal pipe.
 found=[];cell='';code=0
 for m in re.finditer(r'`+|\\.|\||[^`\\|]+|\\',l.strip()):
  t=m[0]
  if t.startswith('`'):code=0 if code==len(t) else len(t) if code==0 else code;cell+=t
  elif t=='|' and not code:found.append(cell.strip());cell=''
  else:cell+=t
 found.append(cell.strip())
 if found and not found[0]:found=found[1:]
 if found and not found[-1]:found=found[:-1]
 return found
for p in documents:
 table=[]
 for n,l in list(lines(p))+[(0,'')]:
  for m in re.finditer(r'\]\(([^)]+)\)',l):
   r=m[1].strip();r=r[1:r.index('>')] if r.startswith('<') and '>' in r else r.split(' "')[0].split(" '")[0]
   if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',r):continue
   path,_,frag=r.partition('#');path=urllib.parse.unquote(path);frag=urllib.parse.unquote(frag);target=(p.parent/path if path else p);refs+=1
   if not target.exists():broken.append({'file':str(p.relative_to(ROOT)),'line':n,'target':r})
   elif frag and target.suffix=='.md':
    anchorrefs+=1
    if frag not in anchors(target):broken.append({'file':str(p.relative_to(ROOT)),'line':n,'target':r,'reason':'anchor'})
  if l.strip().startswith('|'):table.append((n,cells(l)));continue
  if len(table)>=2 and all(re.match(r'^:?-+:?$',x.replace(' ','')) for x in table[1][1]):
   tables+=1;width=len(table[0][1])
   for row,c in table:
    if len(c)!=width:tableissues.append({'file':str(p.relative_to(ROOT)),'line':row,'cells':len(c),'expected':width})
  table=[]
checks['links']={'documents':len(documents),'references':refs,'anchorReferences':anchorrefs,'broken':broken};checks['tables']={'count':tables,'issues':tableissues}
quality=(ROOT/'docs/09-quality-plan.md').read_text();definitions=set()
for l in quality.splitlines():
 m=re.match(r'^\|\s*(QA-[A-Z]+-\d{2}(?:/\d{2})*)\s*\|',l)
 if m:
  first,*other=m[1].split('/');definitions.add(first);definitions.update(first[:-2]+x for x in other)
used=set().union(*(set(re.findall(r'\bQA-[A-Z]+-\d{2}\b',p.read_text())) for p in documents));checks['qa']={'defined':len(definitions),'referenced':len(used),'undefined':sorted(used-definitions)}
# Exact evidence/archive bytes, including original reporter bytes and frozen application/dist.
index=json.loads((OUT/'index.json').read_text());archivechecks=0
for p,meta in index['files'].items():
 b=(OUT/p).read_bytes();assert len(b)==meta['bytes'] and sha(b)==meta['sha256'],p;archivechecks+=1
for p,meta in index['originalReporters'].items():
 b=gzip.decompress((OUT/(p+'.gz')).read_bytes());assert len(b)==meta['bytes'] and sha(b)==meta['sha256'],p;json.loads(b);archivechecks+=1
for name,entries in [('application.tar.gz',frozen['applicationFiles']),('normal-dist.tar.gz',json.loads((W/'production-serving.json').read_text())['distFiles'])]:
 with tarfile.open(OUT/name,'r:gz') as t:
  assert set(t.getnames())==set(entries),name
  for p,h in entries.items():assert sha(t.extractfile(p).read())==h,p;archivechecks+=1
archivefacts={'passed':True,'checks':archivechecks,'originalReporters':len(index['originalReporters']),'indexedFiles':len(index['files'])};(OUT/'archive-verification.json').write_text(json.dumps(archivefacts,indent=2)+'\n');checks['archive']=archivefacts
# Scan only the task changes and new independent evidence, including compressed and nested package text.
tracked=[p for p in subprocess.check_output(['git','diff','--name-only'],text=True).splitlines() if p!='todo.md']
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()
owned={ROOT/p for p in tracked+new if p!='todo.md'}
patterns={'credential':re.compile(r'sk-[A-Za-z0-9_-]{24,}|(?:API_KEY|SECRET_KEY|ACCESS_TOKEN)\s*[:=]\s*[\'\"][A-Za-z0-9_/-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),'credential-provider':re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b')}
hits=[];scanned=0;containers=0
textsuffix={'.json','.md','.ts','.tsx','.js','.mjs','.py','.css','.txt','.log','.svg','.html','.yaml','.yml'}
def scan(name,b,depth=0):
 global scanned,containers
 if depth>5:raise AssertionError('nested evidence depth '+name)
 if b[:2]==b'\x1f\x8b':
  containers+=1;raw=gzip.decompress(b)
  try:
   with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as t:
    for m in t.getmembers():
     if m.isfile():scan(name+':'+m.name,t.extractfile(m).read(),depth+1)
  except tarfile.ReadError:scan(name+':uncompressed',raw,depth+1)
  return
 if b[:4] in [b'PK\x03\x04',b'PK\x05\x06']:
  containers+=1
  with zipfile.ZipFile(io.BytesIO(b)) as z:
   for p in z.namelist():
    if not p.endswith('/'):scan(name+':'+p,z.read(p),depth+1)
  return
 try:s=b.decode('utf-8')
 except UnicodeDecodeError:return
 scanned+=1
 for n,l in enumerate(s.splitlines(),1):
  for label,pattern in patterns.items():
   if pattern.search(l):hits.append({'path':name,'line':n,'pattern':label})
 # Playwright JSON attachments carry actual content, including project ZIP/PNG and JSON.
 if 'browser-' in name and s.lstrip().startswith('{'):
  try:data=json.loads(s)
  except ValueError:return
  def attachments(value):
   if isinstance(value,dict):
    for a in value.get('attachments',[]):
     if isinstance(a,dict) and a.get('body'):scan(name+':attachment:'+a.get('name','unknown'),base64.b64decode(a['body']),depth+1)
    for k,v in value.items():
     if k!='attachments':attachments(v)
   elif isinstance(value,list):
    for x in value:attachments(x)
  attachments(data)
for p in sorted(owned):
 if p.is_file() and p.name not in ['final-checks.json','archive-verification.json','index.json']:scan(str(p.relative_to(ROOT)),p.read_bytes())
checks['scan']={'textPayloads':scanned,'containers':containers,'hits':hits,'scope':'Task changes and new independent evidence. Target credential patterns; not a universal PII classifier. Workspace paths and fictional original GM fixture text are deliberate context.'}
r=subprocess.run(['git','diff','--check','--','.',':!todo.md'],text=True,capture_output=True);untrackedws=[]
for p in sorted({ROOT/p for p in new}):
 if p.suffix in textsuffix:
  for n,l in enumerate(p.read_text().splitlines(),1):
   if l.endswith((' ','\t')):untrackedws.append({'file':str(p.relative_to(ROOT)),'line':n})
checks['whitespace']={'exitCode':r.returncode,'output':r.stdout+r.stderr,'untracked':untrackedws,'todo':'Excluded; pre-existing edit preserved exactly.'}
checks['evidencePassed']=json.loads((OUT/'verification.json').read_text())['passed']
checks['allPassed']=all([not checks['protected']['mismatches'],not checks['frozen']['mismatches'],checks['todoPreserved'],checks['headUnchanged'],checks['indexUnchanged'],checks['version']=='0.2.0-m1-d-outpost',not broken,not tableissues,not checks['qa']['undefined'],not hits,not untrackedws,r.returncode==0,checks['evidencePassed']])
(OUT/'final-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n');print(json.dumps(checks,ensure_ascii=False,indent=2));assert checks['allPassed'],'See final-checks.json'
