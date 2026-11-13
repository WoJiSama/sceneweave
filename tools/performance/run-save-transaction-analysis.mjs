import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback
if(args.includes('--help')){
  console.log('node tools/performance/run-save-transaction-analysis.mjs --before-source ABS --after-source ABS --input ABS_SCENEWEAVE --output ABS_NEW_JSON [--rounds 2] [--history 20] [--channel chrome]')
  console.log('Source component only: alternates independent browsers, prepares actual title history, then measures a cold and two warm generic saves plus native transaction lifetimes. No editor local receipt, profiler, product hooks, user DB access or automatic retry.')
  process.exit(0)
}
const sources={before:arg('--before-source'),after:arg('--after-source')},inputPath=arg('--input'),output=arg('--output')
const rounds=Number(arg('--rounds','2')),history=Number(arg('--history','20'))
if(![...Object.values(sources),inputPath,output].every(v=>v&&path.isAbsolute(v))||!Number.isSafeInteger(rounds)||rounds<1||rounds>10||!Number.isSafeInteger(history)||history<0||history>100)throw new Error('Use absolute paths and bounded rounds/history')
if(Object.values(sources).some(source=>output.startsWith(source+path.sep)))throw new Error('Output must stay outside frozen sources')
const input=await fs.readFile(inputPath),sha=b=>createHash('sha256').update(b).digest('hex')
const report={format:'sceneweave-save-native-transaction-analysis',version:1,status:'running',inputSha256:sha(input),runnerSha256:sha(await fs.readFile(new URL(import.meta.url))),startedAt:new Date().toISOString(),config:{sources,rounds,history},device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},rows:[],limitations:['Source component, no editor local receipt; low sample count, nonexclusive background load.','Actual native final readwrite lifetime is measured separately from whole save; no stage sums.']}
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx'})
for(let round=0;round<rounds;round++)for(const side of (round%2===0?['before','after']:['after','before'])){
  const source=sources[side],frozen=await fingerprintPaths(source,['src','public','assets','package.json','package-lock.json'])
  let tooling,browser
  try{
    tooling=await startNativeFixtureTooling({root:source});browser=await chromium.launch({channel:arg('--channel','chrome'),headless:true})
    const page=await browser.newPage();await page.goto(tooling.url)
    const row=await page.evaluate(async ({base64,history})=>{
      const states={stage:'setup',transactions:[],workers:[]},transact=IDBDatabase.prototype.transaction,NativeWorker=Worker
      IDBDatabase.prototype.transaction=function(...args){
        const tx=transact.apply(this,args)
        if(states.stage!=='setup'){
          const row={stage:states.stage,mode:tx.mode,stores:[...tx.objectStoreNames],start:performance.now()};states.transactions.push(row)
          tx.addEventListener('complete',()=>{row.ms=performance.now()-row.start});tx.addEventListener('abort',()=>{row.aborted=true;row.ms=performance.now()-row.start})
        }
        return tx
      }
      window.Worker=class extends NativeWorker{
        constructor(...args){super(...args);if(String(args[0]).includes('history-audit-worker')){
          const row={stage:states.stage,start:performance.now()};states.workers.push(row)
          this.addEventListener('message',()=>{row.ms=performance.now()-row.start})
        }}
      }
      const paths=['/src/shared/project/file.ts','/src/shared/project/resources.ts','/src/platform/browser/storage/repository.ts','/src/platform/browser/runtime.ts']
      const [{importProject},{tryDerivedProjectBundle,validateProjectSnapshot},{ProjectRepository},{runtime,validation}]=await Promise.all(paths.map(p=>import(p)))
      const input=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation)
      const name=`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=()=>new ProjectRepository({name,runtime,validation})
      const next=(bundle,title)=>{
        const derived=tryDerivedProjectBundle({project:{...bundle.project,document:{...bundle.project.document,title,revision:bundle.project.document.revision+1,updatedAt:new Date().toISOString()}},resources:bundle.resources},bundle)
        if(!derived)throw new Error('Owned closure missing');return derived
      }
      let repo=make(),current=(await repo.importSnapshotArchive({current:input,snapshots:[]})).project
      for(let i=0;i<history;i++){const candidate=next(current,`warm tx setup ${i}`);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
      repo.close();repo=make();current=await validateProjectSnapshot(await repo.load(current.project.document.sceneId),validation)
      const saves=[]
      for(const stage of ['cold','warm-1','warm-2']){
        const candidate=next(current,`measured ${stage}`);states.stage=stage
        const start=performance.now();await repo.saveSnapshot(candidate,current.project.document.revision)
        saves.push({stage,totalMs:performance.now()-start});current=candidate;states.stage='setup'
      }
      const versions=await repo.database.historyVersions.count();repo.close();repo=make()
      const restored=await repo.load(current.project.document.sceneId)
      if(JSON.stringify(restored.project)!==JSON.stringify(current.project)||versions!==history+4)throw new Error('Complete cold project or version count differs')
      repo.close();return {saves,transactions:states.transactions,workers:states.workers,versions,completeColdEqual:true}
    },{base64:input.toString('base64'),history})
    assertFrozen(frozen,await fingerprintPaths(source,['src','public','assets','package.json','package-lock.json']),'warm transaction source')
    report.rows.push({round:round+1,side,browser:browser.version(),sourceFingerprint:sha(JSON.stringify(frozen)),...row})
    await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({round:round+1,side,saves:row.saves}))
  }catch(error){report.status='failed';report.error=error.stack??String(error);await fs.writeFile(output,JSON.stringify(report,null,2));throw error}
  finally{await browser?.close();await tooling?.close()}
}
report.status='complete';report.endedAt=new Date().toISOString();await fs.writeFile(output,JSON.stringify(report,null,2))
