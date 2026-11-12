// Research runner: isolated native DBs and source overlays, never app source.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'
import { startResourceSampling } from './resources.mjs'
import { closeMeasuredBrowser } from './close-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback
if (args.includes('--help')) {
  console.log('node tools/performance/research-history-boundaries.mjs --source ABS_FROZEN --input ABS_SYNTHETIC_SCENEWEAVE --output ABS_NEW_WORK [--history 20] [--history-edit title|geometry] [--rounds 3] [--save-rounds 2] [--prop-id capacity-mixed-remote-0000]')
  console.log('Research only: isolated 4-arm history materialization/worker comparison, 3-arm warm fallback save experiment and limited corruption/CAS/cancellation/local-path checks. Never modifies app source, production dist or user DBs. Results do not establish formal performance, visual output or full acceptance.')
  process.exit(0)
}
const source = arg('--source'), input = arg('--input'), output = arg('--output')
const history = Number(arg('--history','20')), rounds = Number(arg('--rounds','3')), saveRounds = Number(arg('--save-rounds','2'))
const historyEdit = arg('--history-edit','title'), propId = arg('--prop-id','capacity-mixed-remote-0000')
if (![source,input,output].every(v => v && path.isAbsolute(v))) throw new Error('Use absolute --source, --input and --output')
if (!Number.isSafeInteger(history) || history < 1 || history > 100 || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10 || !Number.isSafeInteger(saveRounds) || saveRounds < 0 || saveRounds > 10 || !['title','geometry'].includes(historyEdit)) throw new Error('Invalid research settings')
if (!output.startsWith(path.join(root, 'work')+path.sep)) throw new Error('Use an ignored work output')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Use a new empty output')
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), bytes = await fs.readFile(input)
const frozen = await fingerprintPaths(source, ['src','package.json','package-lock.json'])
const toolPaths=['tools/performance/research-history-boundaries.mjs','tools/performance/research-history-kernel.ts','tools/performance/prepare-native-m2-fixture.mjs','tools/performance/frozen-input.mjs','tools/performance/resources.mjs','tools/performance/windows-process-sampler.mjs','tools/performance/close-browser.mjs']
const tools=await fingerprintPaths(root,toolPaths)
const report = { format:'sceneweave-history-boundary-research', status:'preparing', startedAt:new Date().toISOString(), source, input:{sha256:sha(bytes),byteLength:bytes.length},frozen,tools,
  config:{history,historyEdit,rounds,saveRounds,propId},
  device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},
  limitations:['Source-module research prototypes, not normal production or full acceptance. No exclusive load guard.','History boundary scope excludes current-row/resource accounting and final confirmation.','Alternating rounds on the same graph; in-process caches and allocator/GC remain warm.','Working Set is process-tree sampled, may double count shared pages. Private commitment and target page heap are separate.','Save experiment changes only isolated source copies; full original resource, DB freshness, protection, budget, CAS, hooks and append remain.'],
  boundary:[],saves:[],events:[] }
const write=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2))
await write()
const diagnostic=path.join(output,'source');await fs.mkdir(diagnostic)
await fs.cp(path.join(source,'src'),path.join(diagnostic,'src'),{recursive:true})
for(const name of ['package.json','package-lock.json'])await fs.copyFile(path.join(source,name),path.join(diagnostic,name))
await fs.symlink(path.join(root,'node_modules'),path.join(diagnostic,'node_modules'),'junction')
await fs.symlink(path.join(source,'public'),path.join(diagnostic,'public'),'junction')
await fs.mkdir(path.join(diagnostic,'research'))
await fs.copyFile(path.join(root,'tools/performance/research-history-kernel.ts'),path.join(diagnostic,'research/kernel.ts'))
await fs.writeFile(path.join(diagnostic,'research/worker.ts'),`import {workerJob} from './kernel.ts';self.onmessage=async event=>{try{self.postMessage({ok:true,value:await workerJob(event.data)})}catch(error){self.postMessage({ok:false,error:String(error)})}};`)
// Explicit source-only observation hook. No application option or global ships.
const repositoryFile=path.join(diagnostic,'src/platform/browser/storage/repository.ts')
let code=await fs.readFile(repositoryFile,'utf8')
const match='const encodedSnapshot = prepareEncodedSnapshot(bundle, localInput, baseline)'
if(!code.includes(match))throw new Error('Repository hook context changed')
code=code.replace(match,match+'\n    globalThis.__researchPrepareDelta?.(this, baseline, encodedSnapshot)')
await fs.writeFile(repositoryFile,code)
const historyFile=path.join(diagnostic,'src/platform/browser/storage/incremental-history.ts')
code=await fs.readFile(historyFile,'utf8')
const deltaMatch='?? createProjectDelta(parent.project, current.project)'
if(!code.includes(deltaMatch))throw new Error('History hook context changed')
code=code.replace(deltaMatch,'?? globalThis.__researchConsumeDelta?.(parent.project, current.project) ?? createProjectDelta(parent.project, current.project)')
await fs.writeFile(historyFile,code)
report.prototypeFiles=await fingerprintPaths(diagnostic,['src','research']);await write()
let server,browser,owned,sampler,cdp
try {
  server=await startNativeFixtureTooling({root:diagnostic})
  owned=await chromium.launchServer({channel:'chrome',headless:true});browser=await chromium.connect(owned.wsEndpoint());report.browser=browser.version()
  const context=await browser.newContext(),page=await context.newPage()
  page.on('console',e=>{if(e.type()==='error')report.events.push({type:'console',message:e.text()})});page.on('pageerror',e=>report.events.push({type:'pageerror',message:e.message}))
  await page.goto(server.url)
  await page.evaluate(()=>{
    const original=IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);const state=globalThis.__study;if(state?.phase==='save-measured'&&tx.mode==='readwrite'&&tx.objectStoreNames.contains('projects')){const row={start:performance.now()};state.transactions.push(row);tx.addEventListener('complete',()=>row.ms=performance.now()-row.start);tx.addEventListener('abort',()=>row.aborted=true)}return tx}
  })
  console.log(`Preparing actual native history: ${history} ${historyEdit} saves`)
  report.setup=await page.evaluate(async({base64,history,historyEdit,propId})=>{
    const [kernel,resources,{ProjectRepository},{runtime,validation},{importProject},coordinates,models]=await Promise.all([
      import('/research/kernel.ts'),import('/src/shared/project/resources.ts'),import('/src/platform/browser/storage/repository.ts'),import('/src/platform/browser/runtime.ts'),import('/src/shared/project/file.ts'),import('/src/shared/aggregates/scene-coordinates.ts'),import('/src/shared/project/validate.ts')])
    const original=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation)
    if (!original.project.document.props[propId] || original.project.document.props[propId].visibility !== 'public') throw new Error('Select an existing explicit public Prop for this research input')
    const name=()=>`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=n=>new ProjectRepository({name:n??name(),runtime,validation})
    const next=(bundle,kind)=>{
      let project={...bundle.project,document:{...bundle.project.document,title:kind==='title'?`prepared ${bundle.project.document.revision+1}`:bundle.project.document.title,revision:bundle.project.document.revision+1,updatedAt:'2026-11-12T10:00:00.000Z'}}
      if(kind==='geometry'){const id=propId,prop=project.document.props[id];project.document={...project.document,props:{...project.document.props,[id]:{...prop,positionMm:{...prop.positionMm,x:prop.positionMm.x+1}}}}}
      const result=resources.tryDerivedProjectBundle({project,resources:bundle.resources},bundle);if(!result)throw new Error('Exact resource closure missing');return result
    }
    let repo=make(),current=(await repo.importSnapshotArchive({current:original,snapshots:[]})).project
    for(let i=0;i<history;i++){const candidate=next(current,historyEdit);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
    const native=repo.database.backendDB(),names=[...native.objectStoreNames]
    const snapshot=await new Promise((resolve,reject)=>{const tx=native.transaction(names,'readonly'),rows={};for(const n of names){const r=tx.objectStore(n).getAll();r.onsuccess=()=>rows[n]=r.result;r.onerror=()=>reject(r.error)}tx.oncomplete=()=>resolve(rows);tx.onabort=()=>reject(tx.error)})
    const owner=current.project.document.sceneId,raw={owner,head:snapshot.historyHeads.find(h=>h.ownerSceneId===owner),versions:snapshot.historyVersions.filter(r=>r.ownerSceneId===owner),pins:snapshot.historyPins.filter(p=>p.ownerSceneId===owner),blocks:snapshot.projectContentBlocks}
    const blockHash=()=>kernel.digest(raw.blocks.map(b=>({sha256:b.sha256,actual:kernel.hashBytes(b.bytes)})))
    globalThis.__study={kernel,resources,ProjectRepository,runtime,validation,make,next,repo,current,snapshot,raw,phase:'idle',transactions:[],models,coordinates,history,propId,originalBlockHash:blockHash()}
    return {owner,revision:current.project.document.revision,versions:raw.versions.length,checkpoints:raw.versions.filter(v=>v.checkpoint).length,blocks:raw.blocks.length,blockPayloadBytes:raw.blocks.reduce((n,b)=>n+b.bytes.length,0),physicalVersionsJsonBytes:new TextEncoder().encode(JSON.stringify(raw.versions)).length}
  },{base64:bytes.toString('base64'),history,historyEdit,propId})
  console.log('Checking materialization ownership, corruption, budgets, aliases and zero-cache fallback')
  report.materializationChecks=await page.evaluate(()=>__study.kernel.probeMaterialization(__study.raw));await write()
  cdp=await context.newCDPSession(page);await cdp.send('Performance.enable')
  sampler=startResourceSampling({rootPid:owned.process().pid,cdp,intervalMs:500,heapIntervalMs:200})
  const arms=['original','shared-page','compact-clone','compact-transfer']
  report.status='measuring-boundary';await write()
  for(let round=0;round<rounds;round++){
    const order=round%2?[...arms].reverse():arms
    for(const arm of order){
      console.log(`Boundary round ${round+1}: ${arm}`);sampler.setPhase(`boundary-${round+1}-${arm}`)
      const row=await page.evaluate(arm=>__study.kernel.measureBoundary(__study.raw,arm),arm)
      report.boundary.push({round:round+1,...row});sampler.setPhase('between-runs');await write()
    }
  }
  if(new Set(report.boundary.map(r=>r.worker.result.documentBytes)).size!==1)throw new Error('History audit result differs')
  console.log('Comparing actual saves: original, move-only preparation, owned-endpoint reuse')
  report.status='measuring-saves';await write()
  for(const kind of ['title','geometry'])for(let round=0;round<saveRounds;round++)for(const arm of round%2?['reuse','move-only','original']:['original','move-only','reuse']){
    console.log(`Save ${kind} round ${round+1}: ${arm}`);sampler.setPhase(`save-setup-${kind}-${round+1}-${arm}`)
    await page.evaluate(async({kind,arm})=>{
      const s=__study; s.phase='setup';s.arm=arm;s.prepared=null;s.preparationMs=0;s.consumeMs=0;s.consumeHits=0;s.transactions=[]
      const repo=s.make();await repo.open();s.measuredRepo=repo
      const native=repo.database.backendDB(),names=[...native.objectStoreNames]
      await new Promise((resolve,reject)=>{const tx=native.transaction(names,'readwrite');for(const n of names)for(const row of s.snapshot[n])tx.objectStore(n).put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})
      let bundle=await s.resources.validateProjectSnapshot(await repo.load(s.raw.owner),s.validation)
      // Warm accounting and establish the same retained baseline in every arm.
      const seed=s.next(bundle,kind);await repo.saveSnapshot(seed,bundle.project.document.revision);bundle=seed
      s.measureCandidate=s.next(bundle,kind);s.measurePrevious=bundle;s.expectedRevision=bundle.project.document.revision
      globalThis.__researchPrepareDelta=(own,before,after)=>{
        if(own!==s.measuredRepo||s.phase!=='save-measured'||s.arm==='original')return
        const start=performance.now();s.prepared=s.kernel.prepareDelta(before,after,s.arm);s.preparationMs+=performance.now()-start
      }
      globalThis.__researchConsumeDelta=(before,after)=>{
        if(s.phase!=='save-measured'||!s.prepared)return
        const start=performance.now();try{const delta=s.prepared.consume(before,after);if(delta)s.consumeHits++;return delta}finally{s.consumeMs+=performance.now()-start}
      }
      const append=repo.history.append;s.appendMs=0
      repo.history.append=function(...args){const start=performance.now();return append.apply(this,args).then(value=>{s.appendMs+=performance.now()-start;return value})}
    },{kind,arm})
    sampler.setPhase(`save-${kind}-${round+1}-${arm}`)
    const row=await page.evaluate(async()=>{
      const s=__study;s.phase='save-measured';const start=performance.now()
      await s.measuredRepo.saveSnapshot(s.measureCandidate,s.expectedRevision)
      const totalMs=performance.now()-start;s.phase='verify'
      return {totalMs,preparationMs:s.preparationMs,consumeMs:s.consumeMs,consumeHits:s.consumeHits,appendMs:s.appendMs,transactions:s.transactions}
    })
    sampler.setPhase('verification')
    row.verification=await page.evaluate(async()=>{
      const s=__study,repo=s.measuredRepo,expected=s.coordinates.canonicalProjectCoordinates(s.measureCandidate.project)
            // Cold load verifies actual persisted blocks and complete resource bytes.
      const options=repo.options;repo.close();const cold=new s.ProjectRepository(options)
      const loaded=await cold.load(s.raw.owner)
      if(!loaded||s.coordinates.canonicalProjectCoordinates(loaded.project)!==expected)throw new Error('Actual saved complete content differs')
      const versions=await cold.database.historyVersions.where('ownerSceneId').equals(s.raw.owner).count(),hash=loaded.project.document.sceneId+':'+loaded.project.document.revision+':'+loaded.project.document.props[s.propId].positionMm.x
      if(versions!==s.history+3)throw new Error('History count differs')
      cold.close();s.prepared=null;s.measuredRepo=null
      return {completeProjectEqual:true,versions,identityRevisionPosition:hash}
    })
    report.saves.push({kind,round:round+1,arm,...row});await write()
  }
  sampler.setPhase('correctness-checks')
  console.log('Checking preparation conflicts and original-vs-prepared delta equality')
  report.deltaChecks=await page.evaluate(async()=>{
    const s=__study,repo=s.repo;let bundle=s.current
    const results=[]
    globalThis.__researchPrepareDelta=(own,before,after)=>{if(own===repo&&before)results.push(s.kernel.probeDeltaOwnership(before,after))}
    s.phase='check';const seed=s.next(bundle,'title');await repo.saveSnapshot(seed,bundle.project.document.revision);bundle=seed
    for(const kind of ['title','geometry']){const next=s.next(bundle,kind);await repo.saveSnapshot(next,bundle.project.document.revision);bundle=next}
    globalThis.__researchPrepareDelta=null;globalThis.__researchConsumeDelta=null
    return results
  })
  console.log('Checking real concurrent CAS, actual bad blocks, cancellation and local editor path')
  report.additionalChecks = await page.evaluate(async () => {
    const s=__study, repo=s.repo, owner=s.raw.owner
    const {validateProjectSnapshot}=s.resources
    let current=await validateProjectSnapshot(await repo.load(owner),s.validation)
    const results={}
    // Prepare from the last committed private baseline, then allow another
    // repository connection to commit before this save starts its write tx.
    const other=new s.ProjectRepository({name:repo.database.name,runtime:s.runtime,validation:s.validation})
    await other.open()
    const expected=current.project.document.revision,target=s.next(current,'title'),competitor=s.next(current,'geometry')
    let plan=null,prepared=false,switched=false
    globalThis.__researchPrepareDelta=(own,before,after)=>{if(own===repo){plan=s.kernel.prepareDelta(before,after,'reuse');prepared=!!plan}}
    globalThis.__researchConsumeDelta=(a,b)=>plan?.consume(a,b)
    const ensure=repo.ensureHistory
    repo.ensureHistory=async function(...args){if(!switched){switched=true;await other.saveSnapshot(competitor,expected)}return ensure.apply(this,args)}
    let conflict
    try{await repo.saveSnapshot(target,expected)}catch(error){conflict=error.name}
    repo.ensureHistory=ensure;globalThis.__researchPrepareDelta=null;globalThis.__researchConsumeDelta=null;other.close()
    const winner=await repo.load(owner)
    if(!prepared||conflict!=='ProjectConflictError'||s.coordinates.canonicalProjectCoordinates(winner.project)!==s.coordinates.canonicalProjectCoordinates(competitor.project))throw new Error('Concurrent prepared save overwrote winner')
    results.realCAS={prepared,conflict,winningCompleteContentPreserved:true}
    current=await validateProjectSnapshot(winner,s.validation)
    // Reestablish an owned baseline after the foreign commit.
    const seed=s.next(current,'title');await repo.saveSnapshot(seed,current.project.document.revision);current=seed
    let corrupted=false,storedBlock
    const native=repo.database.backendDB(),writeBlock=block=>new Promise((resolve,reject)=>{const tx=native.transaction(['projectContentBlocks'],'readwrite');tx.objectStore('projectContentBlocks').put(block);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})
    globalThis.__researchPrepareDelta=(own,before,after)=>{if(own===repo)plan=s.kernel.prepareDelta(before,after,'reuse')}
    globalThis.__researchConsumeDelta=(a,b)=>plan?.consume(a,b)
    repo.ensureHistory=async function(...args){if(!corrupted){corrupted=true;storedBlock=await new Promise((resolve,reject)=>{const tx=native.transaction(['projects','projectContentBlocks'],'readonly'),r=tx.objectStore('projects').get(owner);r.onsuccess=()=>{const ref=r.result.project.fields[0].blocks[0],b=tx.objectStore('projectContentBlocks').get(ref.sha256);b.onsuccess=()=>resolve(b.result);b.onerror=()=>reject(b.error)};r.onerror=()=>reject(r.error)});await writeBlock({...storedBlock,bytes:storedBlock.bytes.map((x,i)=>i===0?x^1:x)})}return ensure.apply(this,args)}
    const versionsBefore=await repo.database.historyVersions.count()
    let failure
    try{await repo.saveSnapshot(s.next(current,'title'),current.project.document.revision)}catch(error){failure=String(error)}
    repo.ensureHistory=ensure;await writeBlock(storedBlock);globalThis.__researchPrepareDelta=null;globalThis.__researchConsumeDelta=null
    if(!failure||!failure.includes('hash')||await repo.database.historyVersions.count()!==versionsBefore)throw new Error('Prepared save accepted actual corrupt DB block')
    results.actualBadBlock={rejected:true,noHistoryAppend:true,originalBytesRestored:true}
    // Cancellation after preparation but before any business mutation.
    const controller=new AbortController()
    globalThis.__researchPrepareDelta=(own,before,after)=>{if(own===repo){plan=s.kernel.prepareDelta(before,after,'reuse');controller.abort()}}
    let canceled
    try{await repo.saveSnapshot(s.next(current,'title'),current.project.document.revision,{signal:controller.signal})}catch(error){canceled=error.name}
    globalThis.__researchPrepareDelta=null
    if(!canceled||await repo.database.historyVersions.count()!==versionsBefore)throw new Error('Canceled prepared save appended history')
    results.cancellation={errorName:canceled,noHistoryAppend:true}
    // Normal Workspace command path, not a browser gesture measurement. Trace
    // whether its existing local proof already prevents generic-delta work.
    const [{Workspace},editable] = await Promise.all([import('/src/application/workspace/workspace.ts'),import('/src/application/workspace/project.ts')])
    const workspace=new Workspace(repo,{runtime:s.runtime,validation:s.validation})
    await workspace.openPersisted(await editable.fromBundle(await repo.load(owner),s.validation))
    let localSource=false,preparedButUnused=false,localConsume=0
    globalThis.__researchPrepareDelta=(own,before,after)=>{if(own===repo){localSource=!!(s.models.getProjectLocalTransaction(after.project)||s.models.getProjectTransactionReceipt(after.project));plan=s.kernel.prepareDelta(before,after,'reuse');preparedButUnused=!!plan}}
    globalThis.__researchConsumeDelta=(a,b)=>{localConsume++;return plan?.consume(a,b)}
    const id=s.propId,x=workspace.getState().project.document.props[id].positionMm.x,start=performance.now()
    await workspace.updateProp(id,{positionMm:{...workspace.getState().project.document.props[id].positionMm,x:x+1}});await workspace.flush()
    const ms=performance.now()-start
    globalThis.__researchPrepareDelta=null;globalThis.__researchConsumeDelta=null
    const loaded=await repo.load(owner)
    if(loaded.project.document.props[id].positionMm.x!==x+1)throw new Error('Local path failed to persist')
    results.existingLocalPath={hasLocalSource:localSource,preparedButUnused,preparedConsumeCalls:localConsume,commandThroughSaveMs:ms,actualPositionPreserved:true}
    await workspace.close()
    return results
  })
  report.rawUnchanged=await page.evaluate(()=>__study.kernel.digest(__study.raw.blocks.map(b=>({sha256:b.sha256,actual:__study.kernel.hashBytes(b.bytes)})))===__study.originalBlockHash)
  if(!report.rawUnchanged)throw new Error('Original confirmation bytes changed')
  report.resources=await sampler.stop();sampler=null
  if(report.resources.errors.length)throw new Error('Resource sampling failed')
  await fs.writeFile(path.join(output,'resources.json'),JSON.stringify(report.resources,null,2));report.resources=report.resources.summary
  assertFrozen(tools,await fingerprintPaths(root,toolPaths),'research tools after run')
  if(sha(await fs.readFile(input))!==report.input.sha256)throw new Error('Input changed during research')
  assertFrozen(frozen,await fingerprintPaths(source,['src','package.json','package-lock.json']),'source after research')
  assertFrozen(report.prototypeFiles,await fingerprintPaths(diagnostic,['src','research']),'prototype after research')
  if(report.events.length)throw new Error('Unexpected browser error')
  await page.evaluate(()=>__study.repo.close());await context.close();report.status='complete'
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;console.error(error)}
finally{if(sampler)report.resourcesOnFailure=await sampler.stop();await closeMeasuredBrowser(owned,browser);await server?.close();report.endedAt=new Date().toISOString();await write()}
