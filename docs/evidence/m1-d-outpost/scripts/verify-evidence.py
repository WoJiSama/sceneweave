# -*- coding: utf-8 -*-
"""Read-only byte/contract checks. Browser evidence is never synthesized here."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,struct,zlib,zipfile,subprocess,re,sys
ROOT=Path.cwd()
W=ROOT/'work/m1d-outpost-20261023'
checks=[]
def check(ok,label):
 checks.append({'check':label,'passed':bool(ok)})
 if not ok: raise AssertionError(label)
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def png(data,label):
 check(data[:8]==b'\x89PNG\r\n\x1a\n',label+' signature')
 pos=8; chunks=[];dims=None
 while pos<len(data):
  length=struct.unpack_from('>I',data,pos)[0]; kind=data[pos+4:pos+8]; end=pos+12+length
  check(end<=len(data),label+' chunk bounds')
  check(zlib.crc32(data[pos+4:pos+8+length])&0xffffffff==struct.unpack_from('>I',data,pos+8+length)[0],label+' CRC')
  if kind==b'IHDR':dims=list(struct.unpack_from('>II',data,pos+8))
  chunks.append(kind.decode('ascii'));pos=end
 check(pos==len(data) and chunks[-1]=='IEND',label+' end')
 check(not any(c in chunks for c in ['tEXt','iTXt','zTXt','eXIf']),label+' no text/exif')
 return {'width':dims[0],'height':dims[1],'chunks':sorted(set(chunks)),'sha256':sha(data),'bytes':len(data)}
def project(p):
 with zipfile.ZipFile(p) as z:
  check(z.testzip() is None,p.name+' ZIP CRC')
  m=json.loads(z.read('manifest.json'));check((m['containerVersion'],m['documentSchemaVersion'],m['profile'])==(6,3,'m1-outdoor'),p.name+' v6 format')
  check(set(z.namelist())=={'manifest.json'}|{e['path'] for e in m['entries']},p.name+' exact entries')
  for e in m['entries']:
   b=z.read(e['path']);check(len(b)==e['sizeBytes'] and sha(b)==e['sha256'],p.name+' '+e['path']+' hash/size')
   if e['role']=='asset':png(b,p.name+' '+e['path'])
   if e['role']=='license':check('MIT License' in b.decode('utf-8') and 'Permission is hereby granted' in b.decode('utf-8'),p.name+' full MIT')
  doc=json.loads(z.read('scene.json'));identity=json.loads(z.read('identity.json'));appearance=json.loads(z.read('appearance.json'))
  check((doc['schemaVersion'],identity['version'],appearance['version'])==(3,3,1),p.name+' document/identity/appearance')
  check(not any('migration' in n or 'original' in n for n in z.namelist()),p.name+' native creation no fabricated migration')
  assets={e['sha256']:e for e in m['entries'] if e['role']=='asset'}
  for a in doc['assets'].values():
   e=assets[a['sha256']];info=png(z.read(e['path']),p.name+' native asset '+a['id']);check([info['width'],info['height']]==[a['pixelWidth'],a['pixelHeight']],p.name+' declared image dimensions')
  for b in m['licenseBindings']:check(b['licensePath'] in z.namelist() and b['embedding']=='allowed',p.name+' license binding '+b['subjectId'])
  for id in doc['props']:check(id in identity['propTokens'] and id in appearance['propSources'],p.name+' live prop identity/source '+id)
  return {'file':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes()),'entries':len(m['entries']),'assets':len(assets),'mode':m['packageMode'],'revision':doc['revision'],'snapshots':len(json.loads(z.read('history.json'))['snapshots']) if 'history.json' in z.namelist() else 0}
def tests():
 unit=read(W/'unit-final.json');check(unit['success'] and unit['numTotalTests']==unit['numPassedTests'] and unit['numFailedTests']==0 and unit['numPendingTests']==0,'final unit all passed')
 report=read(W/'browser-final.json');check(report['stats']['unexpected']==0 and report['stats']['flaky']==0 and report['stats']['skipped']==0,'final Chrome all passed')
 corrected=read(W/'browser-corrected.json');check(corrected['stats']['expected']==4 and corrected['stats']['unexpected']==0,'corrected four tests passed')
 initial=read(W/'browser-initial.json');check(initial['stats']['expected']==1 and initial['stats']['unexpected']==3,'initial failures preserved')
 return {'unitFiles':len(unit['testResults']),'unitTests':unit['numTotalTests'],'unitDurationMs':max(t['endTime'] for t in unit['testResults'])-unit['startTime'],'browser':report['stats'],'corrected':corrected['stats'],'initial':initial['stats']}
try:
 baseline=read(W/'baseline.json')
 for p,h in baseline['protected'].items():check((ROOT/p).is_file() and sha((ROOT/p).read_bytes())==h,'protected '+p)
 check(sha((ROOT/'todo.md').read_bytes())==baseline['todoSha256'],'todo preserved')
 frozen=read(W/'frozen-application.json')
 for p,h in frozen['applicationFiles'].items():check(sha((ROOT/p).read_bytes())==h,'frozen '+p)
 facts=tests()
 A=W/'corrected-attachments'; privacy=read(A/'m1d-fixed-mask-4k-privacy.json'); obs={o['name']:o for o in privacy['observations']}
 check(privacy['maskA']==privacy['maskB'],'fixed privacy masks match')
 check(obs['a-player']['rgbaHash']==obs['b-player']['rgbaHash']==obs['reference-player']['rgbaHash'],'players equal independent reference RGBA')
 check(obs['a-gm']['rgbaHash']!=obs['b-gm']['rgbaHash'],'GM RGBA differs')
 pngs=[]
 for name,o in obs.items():
  check(o['width']==4096 and o['height']==3186 and o['metadata']==[] and o['sourceUnchanged'] and not o['limitations'],name+' actual 4K/source/metadata')
  check(o['actualDecodeHashes']==o['expectedDecodeHashes'] and o['closed']==len(o['actualDecodeHashes']),name+' real decode closure/close')
  if name!='reference-player':
   info=png((A/('m1d-'+name+'-4k.png')).read_bytes(),name);check(info['sha256']==o['byteHash'] and info['bytes']==o['bytes'],name+' actual bytes');pngs.append({'name':name,**info,'rgbaHash':o['rgbaHash']})
 packages=[project(p) for p in sorted(A.glob('*.sceneweave'))]
 prodRoots=sorted((W/'production-ui').glob('run-*'))
 check(bool(prodRoots),'normal production run exists')
 prod=read(prodRoots[-1]/'report.json');check(prod['status']=='passed','normal production UI passed')
 for p in prodRoots[-1].glob('*.sceneweave'):packages.append(project(p))
 for p in prodRoots[-1].glob('*.png'):png(p.read_bytes(),p.name)
 serving=read(W/'production-serving.json')
 for p,h in serving['distFiles'].items():check(sha((ROOT/p).read_bytes())==h,'frozen production '+p)
 out={'passed':True,'checkedAt':datetime.now(timezone.utc).isoformat(),'checks':len(checks),'protectedFiles':len(baseline['protected']),'frozenFiles':len(frozen['applicationFiles']),'todoPreserved':True,'tests':facts,'pngs':pngs,'packages':packages,'production':{'status':prod['status'],'output':prod['output']},'performanceGatePassed':False,'performanceWorkDeferred':True}
 (W/'verification.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False,indent=2))
except Exception as e:
 (W/'verification-failed.json').write_text(json.dumps({'passed':False,'error':str(e),'checks':len(checks),'last':checks[-1:]},ensure_ascii=False,indent=2)+'\n');raise
