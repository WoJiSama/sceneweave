// Isolated source-component attribution; never imported by the product.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {chromium} from '@playwright/test'
import ts from 'typescript'
import MagicString from 'magic-string'
import {startNativeFixtureTooling} from './prepare-native-m2-fixture.mjs'
import {fingerprintPaths,assertFrozen,contentSha256} from './frozen-input.mjs'

function installContentDiagnostic() {
  let active=null
  const ids=new WeakMap()
  const txid=tx=>{if(!tx||!active)return null;return ids.get(tx)??null}
  const row=name=>active.functions[name]??={count:0,inclusiveMs:0,maxMs:0}
  Reflect.set(globalThis,'__sceneweaveContentDiagnostic',{
    reset(){if(active)throw Error('Diagnostic already active');active={functions:{},marks:{},transactions:[],nextId:1,keys:new Map()}},
    mark(name,tx,n=1){if(!active)return;const key=`${txid(tx)??'outside'}:${name}`;active.marks[key]=(active.marks[key]??0)+n},
    call(name,run){
      if(!active)return run()
      const owner=active,start=performance.now(),finish=()=>{if(active!==owner)return;const r=row(name),ms=performance.now()-start;r.count++;r.inclusiveMs+=ms;r.maxMs=Math.max(r.maxMs,ms)}
      try{const value=run();if(value&&typeof value.then==='function')return value.then(v=>{finish();return v},e=>{finish();throw e});finish();return value}
      catch(e){finish();throw e}
    },
    finish(){const result=active;if(!result)throw Error('No content diagnostic');active=null;result.keys.clear();delete result.keys;delete result.nextId;return result},
  })
  const original=IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction=function(...args){
    const tx=Reflect.apply(original,this,args)
    if(active){const r={id:active.nextId++,mode:tx.mode,startMs:performance.now(),requests:{},uniqueBlockReads:0,repeatedBlockReads:0};ids.set(tx,r.id);active.transactions.push(r);active.keys.set(r.id,new Set())
      tx.addEventListener('complete',()=>{r.durationMs=performance.now()-r.startMs;r.outcome='complete'},{once:true})
      tx.addEventListener('abort',()=>{r.durationMs=performance.now()-r.startMs;r.outcome='abort'},{once:true})}
    return tx
  }
  for(const name of ['get','getAll','getAllKeys','count','openCursor','add','put','delete','clear']){
    for(const proto of [IDBObjectStore.prototype,IDBIndex.prototype]){
      const original=proto[name];if(typeof original!=='function')continue
      proto[name]=function(...args){
        if(active){const store=this instanceof IDBObjectStore?this:this.objectStore,id=txid(store.transaction),r=active.transactions.find(r=>r.id===id)
          if(r){const k=`${store.name}:${name}`;r.requests[k]=(r.requests[k]??0)+1
            if(store.name==='projectContentBlocks'&&name==='get'){
              const keys=active.keys.get(id);if(keys.has(args[0]))r.repeatedBlockReads++;else{keys.add(args[0]);r.uniqueBlockReads++}
            }}
        }
        return Reflect.apply(original,this,args)
      }
    }
  }
}

const targets={
 'content-block-middleware.ts':['rawMany','readBlocks','readRow','writeBlocks'],
 'content-blocks.ts':['checkedContentBlock','validateProjectBlockManifest','materializeProjectContent','partitionEncodedProjectContent'],
 'content-context.ts':['snapshotContentPartition','matchingEncodedSnapshot'],
 'repository.ts':['putResources','addCurrent','assertBudgets','checkedContent'],
}
const diagnostic="Reflect.get(globalThis,'__sceneweaveContentDiagnostic')"
function instrument(code,file){
 code=code.replaceAll('\r\n','\n')
 const names=targets[file],seen=new Set()
 const replace=(a,b)=>{if(code.split(a).length!==2)throw Error(`Unknown/ambiguous diagnostic branch ${file}: ${a}`);code=code.replace(a,b)}
 const mark=(name,tx='trans',n='1')=>`${diagnostic}?.mark('${name}',${tx},${n});`
 if(file==='content-block-middleware.ts'){
  if(code.includes('const read = (hash: string)')){
   replace('if (cached.blocks.has(hash)) return Dexie.Promise.resolve(cached.blocks.get(hash))',`if (cached.blocks.has(hash)) {${mark('block.hit')}return Dexie.Promise.resolve(cached.blocks.get(hash))}`)
   replace('if (pending) return pending\n',`if (pending) {${mark('block.pending')}return pending}\n`)
   replace('const request = store.get(hash)',`${mark('block.native')}const request = store.get(hash)`)
  }else{
   replace('if (cached.blocks.has(hash)) result.set(hash, cached.blocks.get(hash))',`if (cached.blocks.has(hash)) {${mark('block.hit')}result.set(hash, cached.blocks.get(hash))}`)
   replace('if (batch) pending.add(batch)',`if (batch) {${mark('block.pending')}pending.add(batch)}`)
   replace('if (missing.length) {\n        // DBCore',`if (missing.length) {${mark('block.native','trans','missing.length')}${mark('block.batch')}\n        // DBCore`)
  }
  replace('cached.blocks.set(hash, row);',`${mark('block.retained')}cached.blocks.set(hash, row);`)
  replace('if (table === CONTENT_BLOCK_STORE) { reads.delete(trans); return }',`if (table === CONTENT_BLOCK_STORE) {${mark('cache.invalidate.all')}reads.delete(trans); return }`)
  replace('cached.rows.delete(table);',`${mark('cache.invalidate.row')}cached.rows.delete(table);`)
  replace('if (known) return Dexie.Promise.resolve(view(known))',`if (known) {${mark('hydrated.hit')}return Dexie.Promise.resolve(view(known))}`)
  replace('if (pending) return pending.then(view)',`if (pending) {${mark('hydrated.pending')}return pending.then(view)}`)
  replace('return snapshot.encoded.stored',`${mark('hydrated.exactSnapshot')}return snapshot.encoded.stored`)
  replace('return materializeProjectContent(manifest, async hash => blocks.get(hash))',`${mark('hydrated.parse')}return materializeProjectContent(manifest, async hash => blocks.get(hash))`)
 }
 const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true),edits=new MagicString(code)
 function visit(node){
  const name=(ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node))&&node.name?node.name.getText(ast):ts.isArrowFunction(node)&&ts.isVariableDeclaration(node.parent)?node.parent.name.getText(ast):null
  if(node.body&&names.includes(name)){
   if(seen.has(name)||!ts.isBlock(node.body))throw Error(`Ambiguous diagnostic function ${file}#${name}`)
   seen.add(name)
   const async=node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)?'async ':''
   edits.appendLeft(node.body.getStart(ast)+1,`return ${diagnostic}.call('${file}#${name}',${async}()=>{`)
   edits.prependLeft(node.body.end-1,'});')
  }
  ts.forEachChild(node,visit)
 }
 visit(ast);for(const name of names)if(!seen.has(name))throw Error(`Missing diagnostic target ${file}#${name}`)
 return `if(!${diagnostic})(${installContentDiagnostic.toString()})();\n`+edits.toString()
}

const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback
if(args.includes('--help')){console.log('node tools/performance/run-content-transaction-analysis.mjs --source ABS_FROZEN --input ABS_SCENEWEAVE --output ABS_NEW_WORK [--history 20] [--channel chrome]');process.exit(0)}
const source=arg('--source'),inputPath=arg('--input'),output=arg('--output'),history=Number(arg('--history','20'))
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
if(![source,inputPath,output].every(v=>v&&path.isAbsolute(v))||!output.startsWith(path.join(root,'work')+path.sep)||output.startsWith(source+path.sep)||!Number.isSafeInteger(history)||history<0||history>100)throw Error('Use frozen source/input and a new work directory; bounded history')
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Preserve existing evidence')
const roots=['src','public','assets','package.json','package-lock.json'],frozen=await fingerprintPaths(source,roots),input=await fs.readFile(inputPath)
const copy=path.join(output,'diagnostic-source'),report={format:'sceneweave-content-transaction-diagnostic',version:1,status:'running',startedAt:new Date().toISOString(),source,inputSha256:contentSha256(input),history,sourceFingerprint:contentSha256(JSON.stringify(frozen)),runnerSha256:contentSha256(await fs.readFile(fileURLToPath(import.meta.url))),device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},limitations:['Instrumented source component, not production UI or normal timing. Nested/async inclusive spans must not be summed.','Keys exist only in transient page Sets to count same-transaction repeats; no keys/values retained.','Native requests, actual block hashes, resources/licenses, complete project hashes and CAS remain authoritative. No GC forcing or CPU sampling.','No exclusive load guard. Background conditions cannot be inferred from component timing.']}
const write=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2))
await write()
let tooling,browser
try{
 for(const name of roots)await fs.cp(path.join(source,name),path.join(copy,name),{recursive:true,errorOnExist:true,force:false})
 await fs.symlink(path.join(root,'node_modules'),path.join(copy,'node_modules'),process.platform==='win32'?'junction':'dir')
 for(const file of Object.keys(targets)){
  const p=path.join(copy,'src/platform/browser/storage',file),original=await fs.readFile(p,'utf8')
  await fs.writeFile(p,instrument(original,file))
 }
 tooling=await startNativeFixtureTooling({root:copy});browser=await chromium.launch({channel:arg('--channel','chrome'),headless:true});report.browser=browser.version()
 const page=await browser.newPage();await page.addInitScript(installContentDiagnostic);await page.goto(tooling.url)
 report.result=await page.evaluate(async({base64,history})=>{
  const paths=['/src/shared/project/file.ts','/src/shared/project/resources.ts','/src/platform/browser/storage/repository.ts','/src/platform/browser/runtime.ts']
  const [{importProject},{tryDerivedProjectBundle,validateProjectSnapshot},{ProjectRepository},{runtime,validation}]=await Promise.all(paths.map(p=>import(p)))
  const input=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation)
  const name=`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=()=>new ProjectRepository({name,runtime,validation})
  const next=(bundle,title)=>{const derived=tryDerivedProjectBundle({project:{...bundle.project,document:{...bundle.project.document,title,revision:bundle.project.document.revision+1,updatedAt:new Date().toISOString()}},resources:bundle.resources},bundle);if(!derived)throw Error('Missing owned closure');return derived}
  let repo=make(),current=(await repo.importSnapshotArchive({current:input,snapshots:[]})).project
  for(let i=0;i<history;i++){const candidate=next(current,`content setup ${i}`);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
  repo.close();repo=make();current=await validateProjectSnapshot(await repo.load(current.project.document.sceneId),validation)
  const rows=[],api=Reflect.get(globalThis,'__sceneweaveContentDiagnostic')
  for(const stage of ['cold','warm-1','warm-2']){
   const candidate=next(current,`measured ${stage}`);api.reset();const start=performance.now()
   await repo.saveSnapshot(candidate,current.project.document.revision);rows.push({stage,totalMs:performance.now()-start,...api.finish()});current=candidate
  }
  const versions=await repo.database.historyVersions.count();repo.close();repo=make();const restored=await repo.load(current.project.document.sceneId)
  if(JSON.stringify(restored.project)!==JSON.stringify(current.project)||versions!==history+4)throw Error('Complete cold project/version count differs')
  repo.close();return{rows,versions,completeColdEqual:true}
 },{base64:input.toString('base64'),history})
 assertFrozen(frozen,await fingerprintPaths(source,roots),'original source')
 report.diagnosticFingerprint=contentSha256(JSON.stringify(await fingerprintPaths(copy,roots)))
 report.status='complete'
}catch(e){report.status='failed';report.error=e.stack??String(e);process.exitCode=1}
finally{try{await browser?.close();await tooling?.close()}catch(e){report.status='failed';report.cleanupError=String(e);process.exitCode=1}report.endedAt=new Date().toISOString();await write()}
console.log(JSON.stringify({status:report.status,error:report.error,rows:report.result?.rows.map(r=>({stage:r.stage,totalMs:r.totalMs,transactions:r.transactions,marks:r.marks,functions:r.functions}))},null,2))
