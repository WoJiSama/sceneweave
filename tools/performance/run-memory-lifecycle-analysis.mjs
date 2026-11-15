import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen, contentSha256 as sha } from './frozen-input.mjs'
import { startResourceSampling } from './resources.mjs'
import { startWindowsProcessSampling } from './windows-process-sampler.mjs'

const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined
if(args.includes('--help')){
 console.log('node tools/performance/run-memory-lifecycle-analysis.mjs --config ABS_JSON --output ABS_NEW_WORK')
 console.log('Config: source,input,history (0–44),cycles (1–20),editsPerCycle (1–3),rounds (1–2),idleMs (1000–10000). Fixed-history read-only reopen/audit/release versus real geometry history growth; reverse scenario order, natural idle/switch/close, no forced GC. Windows process closure sampling is explicit.')
 process.exit(0)
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),configPath=arg('--config'),output=arg('--output')
if(![configPath,output].every(v=>v&&path.isAbsolute(v))||!output.startsWith(path.join(root,'work')+path.sep))throw Error('Use absolute config and new ignored work output')
const config=JSON.parse(await fs.readFile(configPath)),{source,input:inputPath,history,cycles,editsPerCycle,rounds,idleMs}=config
if(![source,inputPath].every(v=>v&&path.isAbsolute(v))||output.startsWith(source+path.sep)||process.platform!=='win32'
 ||!Number.isSafeInteger(history)||history<0||history>44||!Number.isSafeInteger(cycles)||cycles<1||cycles>20
 ||!Number.isSafeInteger(editsPerCycle)||editsPerCycle<1||editsPerCycle>3||history+cycles*editsPerCycle>104
 ||!Number.isSafeInteger(rounds)||rounds<1||rounds>2||!Number.isSafeInteger(idleMs)||idleMs<1000||idleMs>10000)throw Error('Invalid bounded Windows lifecycle config')
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Preserve old evidence')
const toolPaths=['tools/performance/run-memory-lifecycle-analysis.mjs','tools/performance/prepare-native-m2-fixture.mjs','tools/performance/frozen-input.mjs','tools/performance/resources.mjs','tools/performance/windows-process-sampler.mjs']
const input=await fs.readFile(inputPath),fingerprint=async()=>({config:sha(await fs.readFile(configPath)),input:sha(await fs.readFile(inputPath)),source:await fingerprintPaths(source,['src','public','assets','package.json','package-lock.json']),tools:await fingerprintPaths(root,toolPaths)})
const frozen=await fingerprint(),report={format:'sceneweave-memory-lifecycle-diagnostic',version:1,status:'running',startedAt:new Date().toISOString(),config,frozen,
 device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},rows:[],limitations:[
  'Unmodified source components, no rendered editor. Fixed-history scenario repeats real read-only open/audit/confirm/release, not saved editing at constant history length.',
  'Growth scenario preserves all new geometry revisions. Necessary history/cache retention differs from a leak; separate browser runs are not matched instantaneous allocation measurements.',
  'Natural idle only, no forced GC or heap snapshots. Finite cycles do not establish hour-scale stability or absence of leaks.',
  'Sampled page heap excludes Worker/native/GPU, process working sets may double-count shared pages. Worker lifecycle counts are actual browser events, not Worker heap bytes.',
  'No exclusive full-machine load guard. Native full-row/byte digests and cold-read audits run outside the memory sampling intervals.',
 ]},write=()=>fs.writeFile(path.join(output,'analysis.json'),JSON.stringify(report,null,2))
await write();let tooling
try{
 tooling=await startNativeFixtureTooling({root:source})
 for(let round=0;round<rounds;round++)for(const mode of round%2?['growth','fixed']:['fixed','growth']){
  const row={round:round+1,mode,status:'running',cycles:[],workers:[],events:[]};report.rows.push(row);await write()
  let server,browser,sampler,watchdog,processSampler,phase='setup'
  try{
   server=await chromium.launchServer({channel:'chrome',headless:true});browser=await chromium.connect(server.wsEndpoint());row.browser=browser.version();const rootPid=server.process().pid
   const page=await browser.newPage();watchdog=setTimeout(()=>{void page.close().catch(()=>{})},600_000)
   page.on('pageerror',e=>row.events.push({type:'pageerror',message:e.message}))
   page.on('console',e=>{if(e.type()==='error')row.events.push({type:'console-error',message:e.text()})})
   page.on('worker',worker=>{const entry={phase,startedAt:Date.now()};row.workers.push(entry);worker.on('close',()=>{entry.closedAt=Date.now();entry.durationMs=entry.closedAt-entry.startedAt})})
   await page.goto(tooling.url);console.log(`Memory lifecycle setup: ${mode} round ${round+1}`)
   row.setup=await page.evaluate(async({base64,history})=>{
    const paths=['/src/shared/project/file.ts','/src/shared/project/resources.ts','/src/platform/browser/storage/repository.ts','/src/platform/browser/runtime.ts','/src/shared/validation/json.ts','/src/shared/validation/hash.ts','/src/shared/project/validate.ts']
    const [{importProject},resources,{ProjectRepository},{runtime,validation},{canonicalJson,encodeUtf8},{sha256Bytes},projectValidation]=await Promise.all(paths.map(p=>import(p)))
    const input=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation),name=`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=()=>new ProjectRepository({name,runtime,validation})
    let repo=make(),current=(await repo.importSnapshotArchive({current:input,snapshots:[]})).project
    const next=bundle=>{const scene=bundle.project.document,prop=scene.props['capacity-mixed-remote-0000'];if(!prop)throw Error('Expected independent Prop')
     const derived=resources.tryDerivedProjectBundle({project:{...bundle.project,document:{...scene,revision:scene.revision+1,updatedAt:new Date().toISOString(),props:{...scene.props,[prop.id]:{...prop,positionMm:{...prop.positionMm,x:prop.positionMm.x+1}}}}},resources:bundle.resources},bundle)
     if(!derived)throw Error('Owned resource closure missing');return derived}
    for(let i=0;i<history;i++){const candidate=next(current);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
    const owner=current.project.document.sceneId,secondary=(await repo.importSnapshotArchive({current:input,snapshots:[]})).project,other=secondary.project.document.sceneId,otherHash=projectValidation.projectContentHash(secondary.project)
    const nativeDigest=async database=>{
     const names=database.tables.map(t=>t.name).sort(),tx=database.backendDB().transaction(names,'readonly'),parts=[]
     const closed=new Promise((resolve,reject)=>{tx.addEventListener('complete',resolve,{once:true});tx.addEventListener('abort',()=>reject(tx.error??Error('Digest aborted')),{once:true})})
     const normal=value=>value instanceof Uint8Array?['bytes',value.length,sha256Bytes(value)]:Array.isArray(value)?['array',value.map(normal)]:value&&typeof value==='object'?['object',Object.keys(value).sort().map(k=>[k,normal(value[k])])]:[typeof value,value]
     const tables=[]
     await Promise.all(names.map(table=>new Promise((resolve,reject)=>{const request=tx.objectStore(table).openCursor(),hashes=[],stats={table,rows:0,jsonBytes:0,binaryBytes:0};request.onerror=()=>reject(request.error);request.onsuccess=()=>{try{const cursor=request.result;if(!cursor){parts.push([table,hashes]);tables.push(stats);resolve();return}stats.rows++;stats.jsonBytes+=encodeUtf8(JSON.stringify(cursor.value,(_key,value)=>value instanceof Uint8Array?null:value)).length;stats.binaryBytes+=cursor.value?.bytes instanceof Uint8Array?cursor.value.bytes.length:0;hashes.push(sha256Bytes(encodeUtf8(JSON.stringify(normal(cursor.value)))));cursor.continue()}catch(e){reject(e)}}})))
     await closed;return{sha256:sha256Bytes(encodeUtf8(JSON.stringify(parts.sort((a,b)=>a[0].localeCompare(b[0]))))),tables:tables.sort((a,b)=>a.table.localeCompare(b.table))}
    }
    const beforeDigest=await nativeDigest(repo.database);repo.close();repo=make();current=await resources.validateProjectSnapshot(await repo.load(owner),validation)
    Reflect.set(globalThis,'__memoryLifecycle',{repo,current,owner,other,otherHash,make,next,resources,validation,canonicalJson,projectValidation,nativeDigest,beforeDigest})
    return{initialVersions:await repo.database.historyVersions.count(),beforeDigest}
   },{base64:input.toString('base64'),history})
   const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');sampler=startResourceSampling({rootPid,cdp})
   const idle=async(label,duration)=>{phase=label;sampler.setPhase(label);await page.waitForTimeout(duration);const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));return{phase:label,idleMs:duration,heapUsedBytes:metrics.JSHeapUsedSize,heapTotalBytes:metrics.JSHeapTotalSize,activeWorkers:page.workers().length}}
   row.initialIdle=await idle('initial-idle',10000)
   for(let cycle=0;cycle<cycles;cycle++){
    phase=`cycle-${cycle+1}-work`;sampler.setPhase(phase)
    const result=await page.evaluate(async({mode,editsPerCycle})=>{
     const s=Reflect.get(globalThis,'__memoryLifecycle'),started=performance.now();s.current=null;s.repo.close();s.repo=s.make()
     s.current=await s.resources.validateProjectSnapshot(await s.repo.load(s.owner),s.validation)
     if(mode==='fixed'){
      const prepared=await s.repo.prepareAccounting({});if(!prepared)throw Error('Fixed audit unexpectedly fell back or reused a receipt')
      try{const tx=s.repo.database.backendDB().transaction(s.repo.database.tables.map(t=>t.name),'readonly')
       const complete=new Promise((resolve,reject)=>{tx.addEventListener('complete',resolve,{once:true});tx.addEventListener('abort',()=>reject(tx.error??Error('Confirmation aborted')),{once:true})})
       await prepared.confirm(tx);await complete
      }finally{prepared.release()}
     }else for(let i=0;i<editsPerCycle;i++){const candidate=s.next(s.current);await s.repo.saveSnapshot(candidate,s.current.project.document.revision);s.current=candidate}
     return{workMs:performance.now()-started,versions:await s.repo.database.historyVersions.count(),revision:s.current.project.document.revision}
    },{mode,editsPerCycle})
    const observation=await idle(`cycle-${cycle+1}-idle`,idleMs);row.cycles.push({cycle:cycle+1,...result,...observation});await write();console.log(`Memory lifecycle: ${mode} round ${round+1} cycle ${cycle+1}/${cycles}`)
   }
   row.finalIdle=await idle('final-idle',15000)
   await page.evaluate(async()=>{const s=Reflect.get(globalThis,'__memoryLifecycle');s.expectedCurrentHash=s.projectValidation.projectContentHash(s.current.project);s.current=null;s.repo.close();s.repo=s.make();s.current=await s.resources.validateProjectSnapshot(await s.repo.load(s.other),s.validation)})
   row.switchedIdle=await idle('switched-idle',10000)
   await page.evaluate(()=>{const s=Reflect.get(globalThis,'__memoryLifecycle');s.current=null;s.repo.close()})
   row.releasedIdle=await idle('released-idle',10000)
   row.resources=await sampler.stop();sampler=undefined
   if(row.resources.errors.length||row.events.length)throw Error('Lifecycle sampling/page error')
   row.consistency=await page.evaluate(async({mode,expectedVersions})=>{
    const s=Reflect.get(globalThis,'__memoryLifecycle');s.repo=s.make();await s.repo.open();const afterDigest=await s.nativeDigest(s.repo.database)
    if(mode==='fixed'&&afterDigest.sha256!==s.beforeDigest.sha256)throw Error('Read-only fixed-history native bytes changed')
    if(await s.repo.database.historyVersions.count()!==expectedVersions)throw Error('Unexpected retained history length')
    const current=await s.repo.load(s.owner),other=await s.repo.load(s.other)
    if(s.projectValidation.projectContentHash(current.project)!==s.expectedCurrentHash)throw Error('Active complete cold project changed')
    if(s.projectValidation.projectContentHash(other.project)!==s.otherHash)throw Error('Untouched second project changed')
    const versions=(await s.repo.database.historyVersions.where('ownerSceneId').equals(s.owner).toArray()).sort((a,b)=>a.revision-b.revision)
    for(const index of new Set([0,Math.floor(versions.length/2),versions.length-1])){const row=versions[index],restored=await s.repo.loadHistoryVersion(s.owner,row.id);if(!restored||s.projectValidation.projectContentHash(restored.project)!==row.contentHash)throw Error('Retained full historical hash differs')}
    const result={completeColdEqual:true,versions:expectedVersions,historyHashesChecked:Math.min(3,versions.length),fixedNativeDigestEqual:mode==='fixed'?afterDigest.sha256===s.beforeDigest.sha256:null,afterDigest,finalRevision:current.project.document.revision}
    s.repo.close();Reflect.deleteProperty(globalThis,'__memoryLifecycle');return result
   },{mode,expectedVersions:history+2+(mode==='growth'?cycles*editsPerCycle:0)})
   phase='page-closed';row.closedProcessSamples=[];row.closedProcessErrors=[]
   await page.close();processSampler=startWindowsProcessSampling({rootPid,intervalMs:500,onSnapshot:snapshot=>row.closedProcessSamples.push(snapshot),onError:error=>row.closedProcessErrors.push(String(error))})
   await new Promise(resolve=>setTimeout(resolve,5000));await processSampler.stop();processSampler=undefined
   if(row.closedProcessErrors.length||!row.closedProcessSamples.length)throw Error('No valid process observations after page close')
   if(row.workers.some(w=>!w.closedAt))throw Error('Actual Worker remains active after page close')
   const child=server.process(),exited=new Promise(resolve=>child.once('exit',resolve));await browser.close();browser=undefined;await server.close();server=undefined;await exited;row.rootExited=true
   row.status='complete';await write()
  }catch(error){row.status='failed';row.error=error.stack??String(error);throw error}
  finally{clearTimeout(watchdog);await sampler?.stop();await processSampler?.stop();await browser?.close();await server?.close();await write()}
 }
 assertFrozen(frozen,await fingerprint(),'lifecycle source/tools/input/config');report.status='complete'
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1}
finally{await tooling?.close();report.endedAt=new Date().toISOString();await write()}
console.log(JSON.stringify({status:report.status,error:report.error,completeRows:report.rows.filter(r=>r.status==='complete').length}))
