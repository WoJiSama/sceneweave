// Separate CPU and native-event attribution. Never imported by the product.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {chromium} from '@playwright/test'
import {startNativeFixtureTooling} from './prepare-native-m2-fixture.mjs'
import {fingerprintPaths,assertFrozen,contentSha256} from './frozen-input.mjs'
import {saveCostTargets,instrumentSaveCost,installSaveBoundaryDiagnostic,hookCopyTargets,instrumentHookCopies} from './instrument-save-cost.mjs'

function installNativeCostDiagnostic(){
 let active=null
 const requests=new WeakMap(),transactions=new WeakMap(),handlers=new WeakMap()
 const metric=(owner,name)=>owner.metrics[name]??={count:0,totalMs:0,maxMs:0}
 const record=(owner,name,ms)=>{const r=metric(owner,name);r.count++;r.totalMs+=ms;r.maxMs=Math.max(r.maxMs,ms)}
 Reflect.set(globalThis,'__sceneweaveNativeCost',{
  reset(){if(active)throw Error('Already active');active={metrics:{},transactions:[],nextId:1}},
  finish(){if(!active)throw Error('No diagnostic');const result=active;active=null;delete result.nextId;return result},
 })
 const transaction=IDBDatabase.prototype.transaction
 IDBDatabase.prototype.transaction=function(...args){
  const start=performance.now(),tx=Reflect.apply(transaction,this,args)
  if(active){const owner=active,r={id:owner.nextId++,mode:tx.mode,startMs:start,requests:0,successEvents:0};transactions.set(tx,r);owner.transactions.push(r)
   record(owner,'native.transaction.submit',performance.now()-start)
   for(const event of ['complete','abort'])tx.addEventListener(event,()=>{r.durationMs=performance.now()-start;r.outcome=event},{once:true})
  }return tx
 }
 for(const name of ['get','getAll','getAllKeys','count','openCursor','add','put','delete','clear'])for(const proto of [IDBObjectStore.prototype,IDBIndex.prototype]){
  const original=proto[name];if(typeof original!=='function')continue
  proto[name]=function(...args){
   const owner=active;if(!owner)return Reflect.apply(original,this,args)
   const store=this instanceof IDBObjectStore?this:this.objectStore,tx=transactions.get(store.transaction),key=`${store.name}.${name}`,start=performance.now()
   const request=Reflect.apply(original,this,args);record(owner,`${key}.submit`,performance.now()-start)
   if(tx)tx.requests++
   const meta={owner,key,start,firstResult:true};requests.set(request,meta)
   request.addEventListener('success',()=>{record(owner,`${key}.submitToEvent`,performance.now()-start);if(tx)tx.successEvents++})
   return request
  }
 }
 const result=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'result')
 Object.defineProperty(IDBRequest.prototype,'result',{...result,get(){
  const meta=requests.get(this);if(!meta)return Reflect.apply(result.get,this,[])
  const start=performance.now();try{return Reflect.apply(result.get,this,[])}finally{
   record(meta.owner,`${meta.key}.${meta.firstResult?'firstResult':'laterResult'}`,performance.now()-start);meta.firstResult=false
  }
 }})
 const success=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')
 Object.defineProperty(IDBRequest.prototype,'onsuccess',{...success,
  get(){const value=Reflect.apply(success.get,this,[]);return handlers.get(value)??value},
  set(callback){
   if(typeof callback!=='function')return Reflect.apply(success.set,this,[callback])
   const wrapped=function(...args){const meta=requests.get(this);if(!meta)return Reflect.apply(callback,this,args);const start=performance.now();try{return Reflect.apply(callback,this,args)}finally{record(meta.owner,`${meta.key}.onsuccess`,performance.now()-start)}}
   handlers.set(wrapped,callback);return Reflect.apply(success.set,this,[wrapped])
  },
 })
 const clone=globalThis.structuredClone
 globalThis.structuredClone=function(...args){const owner=active;if(!owner)return Reflect.apply(clone,this,args);const start=performance.now();try{return Reflect.apply(clone,this,args)}finally{record(owner,'structuredClone',performance.now()-start)}}
}

export function summarizeCpu(profile){
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),functions=new Map(),files=new Map(),parents=new Map(),attribution=new Map()
 for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id)
 const anchors=['rowCost','prepareEncodedSnapshot','putResources','matchingEncodedSnapshot','append','readRow','tryDerivedProjectBundle']
 for(let i=0;i<(profile.samples?.length??0);i++){
  const frame=nodes.get(profile.samples[i]).callFrame,ms=profile.timeDeltas[i]/1000,file=frame.url.replace(/^https?:\/\/[^/]+/,''),key=JSON.stringify([file,frame.functionName])
  const row=functions.get(key)??{file,name:frame.functionName,selfMs:0,samples:0};row.selfMs+=ms;row.samples++;functions.set(key,row);files.set(file,(files.get(file)??0)+ms)
  const stack=[];let node=nodes.get(profile.samples[i])
  while(node){stack.push(node.callFrame);node=nodes.get(parents.get(node.id))}
  const anchor=anchors.map(name=>stack.find(f=>f.functionName===name)).find(Boolean)
  const owner=anchor?`${anchor.url.replace(/^https?:\/\/[^/]+/,'')}#${anchor.functionName}`:`unattributed#${frame.url?'other JS':frame.functionName||'native/unknown'}`
  attribution.set(owner,(attribution.get(owner)??0)+ms)
 }
 return{wallMs:(profile.endTime-profile.startTime)/1000,sampledMs:(profile.timeDeltas??[]).reduce((a,b)=>a+b,0)/1000,functions:[...functions.values()].sort((a,b)=>b.selfMs-a.selfMs),files:[...files].map(([file,selfMs])=>({file,selfMs})).sort((a,b)=>b.selfMs-a.selfMs),attribution:[...attribution].map(([owner,selfMs])=>({owner,selfMs})).sort((a,b)=>b.selfMs-a.selfMs),attributionRule:'Each leaf sample once; first present ancestor from priority list '+anchors.join(',')+'. Other/native/idle/GC retained.'}
}

async function main(){
 const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback
 if(args.includes('--help')){console.log('node tools/performance/run-save-cost-analysis.mjs --source ABS_FROZEN --input ABS_SCENEWEAVE --output ABS_NEW_WORK [--mode profile|native|boundaries|hooks] [--history 20] [--channel chrome]');return}
 const source=arg('--source'),inputPath=arg('--input'),output=arg('--output'),mode=arg('--mode','profile'),history=Number(arg('--history','20'))
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
 if(![source,inputPath,output].every(v=>v&&path.isAbsolute(v))||!output.startsWith(path.join(root,'work')+path.sep)||output.startsWith(source+path.sep)||!['profile','native','boundaries','hooks'].includes(mode)||!Number.isSafeInteger(history)||history<0||history>100)throw Error('Use frozen absolute paths, bounded history and a new work directory')
 await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Preserve existing evidence')
 const paths=['src','public','assets','package.json','package-lock.json'],toolPaths=['tools/performance/run-save-cost-analysis.mjs','tools/performance/instrument-save-cost.mjs','tools/performance/prepare-native-m2-fixture.mjs','tools/performance/frozen-input.mjs']
 const fingerprint=async()=>({source:await fingerprintPaths(source,paths),tools:await fingerprintPaths(root,toolPaths),input:contentSha256(await fs.readFile(inputPath))})
 const frozen=await fingerprint(),input=await fs.readFile(inputPath),report={format:'sceneweave-save-cost-diagnostic',version:1,status:'running',mode,startedAt:new Date().toISOString(),source,inputSha256:frozen.input,history,frozen,device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},rows:[],events:[],limitations:[
  `${mode==='boundaries'||mode==='hooks'?'Instrumented isolated source copy':'Unmodified source modules'}, title edits, separate from normal production UI and timings. No exclusive load guard; not a formal performance distribution.`,
  'CPU profiles sample only the target page main thread. Worker/database/native threads are excluded. Idle, GC and unknown/native frames retained; sampling perturbs scheduling.',
  'Profile start/stop also surround candidate creation and CDP transport, while totalMs covers only saveSnapshot. CPU samples cannot be divided by totalMs as exact percentages.',
  'Native mode wraps native APIs only in this isolated page. Submission-to-event latencies overlap and cannot be summed. First result access is not all browser deserialization cost.',
  'Synchronous onsuccess includes result access and nested application work, excludes later Promise continuations. Metrics may overlap; timer resolution and wrappers perturb short calls.',
  'No keys/values retained, additional diagnostic database reads, forced GC, skipped actual bytes/hash/licenses/budgets or CAS.',
 ]}
 const write=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await write()
 let tooling,browser
 try{
  let served=source
  if(mode==='boundaries'||mode==='hooks'){
   served=path.join(output,'diagnostic-source')
   for(const name of paths)await fs.cp(path.join(source,name),path.join(served,name),{recursive:true,errorOnExist:true,force:false})
   await fs.symlink(path.join(root,'node_modules'),path.join(served,'node_modules'),process.platform==='win32'?'junction':'dir')
   for(const file of Object.keys(saveCostTargets)){const target=path.join(served,file);await fs.writeFile(target,instrumentSaveCost(await fs.readFile(target,'utf8'),file))}
   if(mode==='hooks')for(const file of hookCopyTargets){const target=path.join(served,file);await fs.writeFile(target,instrumentHookCopies(await fs.readFile(target,'utf8'),file))}
   report.diagnosticFingerprint=contentSha256(JSON.stringify(await fingerprintPaths(served,paths)))
  }
  tooling=await startNativeFixtureTooling({root:served});browser=await chromium.launch({channel:arg('--channel','chrome'),headless:true});report.browser=browser.version()
  const page=await browser.newPage();page.on('pageerror',e=>report.events.push({type:'pageerror',message:e.message}));page.on('console',e=>{if(e.type()==='error')report.events.push({type:'console-error',message:e.text()})})
  if(mode==='native')await page.addInitScript(installNativeCostDiagnostic)
  if(mode==='boundaries'||mode==='hooks')await page.addInitScript(installSaveBoundaryDiagnostic)
  await page.goto(tooling.url)
  await page.evaluate(async({base64,history})=>{
   const paths=['/src/shared/project/file.ts','/src/shared/project/resources.ts','/src/platform/browser/storage/repository.ts','/src/platform/browser/runtime.ts']
   const [{importProject},{tryDerivedProjectBundle,validateProjectSnapshot},{ProjectRepository},{runtime,validation}]=await Promise.all(paths.map(p=>import(p)))
   const input=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation),name=`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=()=>new ProjectRepository({name,runtime,validation})
   const next=(bundle,title)=>{const derived=tryDerivedProjectBundle({project:{...bundle.project,document:{...bundle.project.document,title,revision:bundle.project.document.revision+1,updatedAt:new Date().toISOString()}},resources:bundle.resources},bundle);if(!derived)throw Error('Missing owned closure');return derived}
   let repo=make(),current=(await repo.importSnapshotArchive({current:input,snapshots:[]})).project
   for(let i=0;i<history;i++){const candidate=next(current,`save cost setup ${i}`);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
   repo.close();repo=make();current=await validateProjectSnapshot(await repo.load(current.project.document.sceneId),validation)
   Reflect.set(globalThis,'__sceneweaveSaveCost',{repo,current,next,make})
  },{base64:input.toString('base64'),history})
  const cdp=mode==='profile'?await page.context().newCDPSession(page):null
  if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000})}
  for(const stage of ['cold','warm-1','warm-2']){
   console.log(`Save cost ${mode}: ${stage}`)
   if(cdp)await cdp.send('Profiler.start')
   const row=await page.evaluate(async stage=>{
    const state=Reflect.get(globalThis,'__sceneweaveSaveCost'),api=Reflect.get(globalThis,'__sceneweaveNativeCost')??Reflect.get(globalThis,'__sceneweaveSaveBoundaries'),candidate=state.next(state.current,`save cost measured ${stage}`)
    api?.reset();const start=performance.now();await state.repo.saveSnapshot(candidate,state.current.project.document.revision)
    const totalMs=performance.now()-start,native=api?.finish();state.current=candidate;return{stage,totalMs,...(native?{native}:{})}
   },stage)
   if(cdp){const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(path.join(output,`${stage}.cpuprofile`),JSON.stringify(profile),{flag:'wx'});row.cpu=summarizeCpu(profile)}
   report.rows.push(row);await write()
  }
  report.consistency=await page.evaluate(async history=>{
   const state=Reflect.get(globalThis,'__sceneweaveSaveCost'),versions=await state.repo.database.historyVersions.count();state.repo.close();state.repo=state.make()
   const restored=await state.repo.load(state.current.project.document.sceneId)
   if(JSON.stringify(restored.project)!==JSON.stringify(state.current.project)||versions!==history+4)throw Error('Complete cold project/version count differs')
   state.repo.close();return{versions,completeColdEqual:true}
  },history)
  if(report.events.length)throw Error('Unexpected page errors; retained in report')
  assertFrozen(frozen,await fingerprint(),'source/input/tools after save cost diagnostic');report.status='complete'
 }catch(e){report.status='failed';report.error=e.stack??String(e);process.exitCode=1}
 finally{try{await browser?.close();await tooling?.close()}catch(e){report.status='failed';report.cleanupError=String(e);process.exitCode=1}report.endedAt=new Date().toISOString();await write()}
 console.log(JSON.stringify({status:report.status,error:report.error,rows:report.rows.map(r=>({stage:r.stage,totalMs:r.totalMs,functions:r.cpu?.functions.slice(0,12)??r.native?.functions,shapes:r.native?.shapes,transactions:r.native?.transactions}))},null,2))
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
