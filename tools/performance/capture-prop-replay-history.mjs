// Synthetic, fully validated repository history. No product source mutation.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'

const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback
if(args.includes('--help')){
 console.log('node tools/performance/capture-prop-replay-history.mjs --source ABS --input ABS --output ABS_NEW [--edit prop|metadata|group-translate|group-rotate|mixed-translate] [--history 20] [--members 32] [--channel chrome]')
 console.log('Creates real strictly validated repository history, a genuine composition-command group identity, captures the actual-read audit graph on a cold save and strictly cold-reads its result. Group transforms change the sole local frame and decode all world members; this diagnostic is not a production group editing command or formal performance.')
 process.exit(0)
}
const source=arg('--source'),input=arg('--input'),output=arg('--output'),edit=arg('--edit','prop'),history=Number(arg('--history','20')),members=Number(arg('--members','32'))
if(![source,input,output].every(v=>v&&path.isAbsolute(v))||!['prop','metadata','group-translate','group-rotate','mixed-translate'].includes(edit)
 ||!Number.isSafeInteger(history)||history<1||history>100||!Number.isSafeInteger(members)||members<1||members>128)throw Error('Invalid paths/edit/bounded counts; see --help')
if([source,input].some(v=>output===v||output.startsWith(v+path.sep)))throw Error('Output must be separate from inputs')
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty output directory')
const sha=b=>createHash('sha256').update(b).digest('hex'),bytes=await fs.readFile(input),frozen=await fingerprintPaths(source,['src','package.json','package-lock.json'])
const report={format:'sceneweave-finite-prop-history-capture',version:1,status:'running',startedAt:new Date().toISOString(),source,input:{path:input,sha256:sha(bytes),bytes:bytes.length},edit,history,members,frozen,
 device:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),platform:os.platform(),node:process.version},
 limitations:['Synthetic source-module repository edits, not normal production UI or a new group editing capability.',
 'No exclusive-system-load proof; cold save wall time is diagnostic. Graph contains every actual owner/version/branch/pin/block sent for this audit.',
 'Group internal local member bytes are checked exactly. New world support/connection/appearance is still fully validated when preparing each revision.']}
const write=()=>fs.writeFile(path.join(output,'capture.json'),JSON.stringify(report,null,2));await write()
let tooling,browser
try{
 tooling=await startNativeFixtureTooling({root:source});browser=await chromium.launch({channel:arg('--channel','chrome'),headless:true})
 report.browser=browser.version();const page=await browser.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});await page.goto(tooling.url)
 const result=await page.evaluate(async({base64,edit,history,members})=>{
  const [{importProject},{tryDerivedProjectBundle,validateProjectSnapshot},{ProjectRepository},{runtime,validation},{applyCompositionDraftCommands},coords,{canonicalJson},{selectManualTransactionBudget},{inspectAggregateDomain}]=await Promise.all([
   import('/src/shared/project/file.ts'),import('/src/shared/project/resources.ts'),import('/src/platform/browser/storage/repository.ts'),import('/src/platform/browser/runtime.ts'),
   import('/src/shared/appearance/commands.ts'),import('/src/shared/aggregates/scene-coordinates.ts'),import('/src/shared/validation/json.ts'),
   import('/src/shared/budget/command-budget.ts'),import('/src/shared/aggregates/domain-adapters.ts')])
  let original=await importProject(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),validation)
  const grouped=edit.startsWith('group-'),groupId='performance-replay-props',propId='capacity-mixed-remote-0000'
  let ids=[]
  if(grouped){
   ids=Object.keys(original.project.document.props).filter(id=>id.startsWith('capacity-mixed-remote-')).slice(0,members)
   if(ids.length!==members)throw Error(`Only ${ids.length}/${members} remote full Props available`)
   const p=original.project,content=applyCompositionDraftCommands({document:p.document,historyIdentity:p.historyIdentity,appearance:p.appearance},[{type:'createAggregateGroup',group:{
    id:groupId,floorId:p.document.props[ids[0]].floorId,parentId:null,frame:{translationMm:{x:153000,y:153000},quarterTurns:0},members:ids.map(id=>({kind:'prop',id})),editLocked:false}}],runtime)
   original=await validateProjectSnapshot({project:{...p,...content},resources:original.resources},validation)
  }
  const originalLocal=grouped?coords.encodeProjectCoordinates(original.project):null
  const localMembers=p=>canonicalJson(ids.map(id=>p.document.props[id]))
  const next=bundle=>{
   let project={...bundle.project,document:{...bundle.project.document}}
   if(grouped){
    const local=coords.encodeProjectCoordinates(bundle.project),frame=local.document.aggregateCoordinates.groups[groupId].frame
    if(edit==='group-translate')frame.translationMm.x++
    else frame.quarterTurns=(frame.quarterTurns+1)%4
    if(localMembers(local)!==localMembers(originalLocal))throw Error('Local member bytes changed during a core-only transform')
    project={...bundle.project,document:coords.decodeProjectCoordinates(local).document}
   }else if(edit==='mixed-translate'){
    const p=bundle.project,id='capacity-mixed-group',scope=inspectAggregateDomain(p.document,id,'natural')
    const content=applyCompositionDraftCommands({document:p.document,historyIdentity:p.historyIdentity,appearance:p.appearance},
     [{type:'transformAggregateNatural',id,offsetMm:{x:1,y:0},pivotMm:scope.frame.translationMm,quarterTurns:0}],runtime,
     {budget:selectManualTransactionBudget(p.document,1,scope.members.length)})
    project={...p,...content}
   }else if(edit==='prop'){
    const p=project.document.props[propId];if(!p)throw Error('Missing remote Prop')
    project.document.props={...project.document.props,[propId]:{...p,positionMm:{...p.positionMm,x:p.positionMm.x+1}}}
   }
   project.document={...project.document,title:`${edit} revision ${bundle.project.document.revision+1}`,revision:bundle.project.document.revision+1,updatedAt:new Date().toISOString()}
   const result=tryDerivedProjectBundle({project,resources:bundle.resources},bundle)
   if(!result)throw Error('Resource closure proof unavailable')
   return result
  }
  const name=`sceneweave-projects-dev-v1-${crypto.randomUUID().replaceAll('-','')}`,make=()=>new ProjectRepository({name,runtime,validation})
  let repo=make(),current=(await repo.importSnapshotArchive({current:original,snapshots:[]})).project
  for(let i=0;i<history;i++){const candidate=next(current);await repo.saveSnapshot(candidate,current.project.document.revision);current=candidate}
  repo.close();repo=make();current=await validateProjectSnapshot(await repo.load(current.project.document.sceneId),validation)
  let graph;const NativeWorker=globalThis.Worker
  globalThis.Worker=class extends NativeWorker{postMessage(value,...rest){if(value?.kind==='captured-history')graph=structuredClone(value);super.postMessage(value,...rest)}}
  const candidate=next(current),start=performance.now();await repo.saveSnapshot(candidate,current.project.document.revision);const coldSaveMs=performance.now()-start
  if(!graph)throw Error('No actual-read Worker graph captured')
  repo.close();repo=make();const cold=await validateProjectSnapshot(await repo.load(candidate.project.document.sceneId),validation)
  if(canonicalJson(cold.project)!==canonicalJson(candidate.project))throw Error('Strict cold-read project differs')
  const localPreserved=!grouped||localMembers(coords.encodeProjectCoordinates(cold.project))===localMembers(originalLocal)
  if(!localPreserved)throw Error('Cold-read local members differ')
  repo.close();globalThis.Worker=NativeWorker
  return {coldSaveMs,localPreserved:grouped?localPreserved:null,coldReadEqual:true,props:grouped?ids.length:edit==='prop'?1:0,
   fullPropCount:Object.keys(cold.project.document.props).length,decorationCount:Object.keys(cold.project.document.decorations).length,
   versions:graph.versions.length,pins:graph.pins.length,owners:graph.heads.length,blocks:graph.blocks.length,graphJson:JSON.stringify(graph)}
 },{base64:bytes.toString('base64'),edit,history,members})
 const {graphJson,...metrics}=result;await fs.writeFile(path.join(output,'actual-read-graph.json'),graphJson,{flag:'wx'})
 report.metrics=metrics;report.graph={sha256:sha(graphJson),bytes:Buffer.byteLength(graphJson)}
 if(errors.length)throw Error(errors.join('\n'))
 assertFrozen(frozen,await fingerprintPaths(source,['src','package.json','package-lock.json']),'captured source')
 if(sha(await fs.readFile(input))!==report.input.sha256)throw Error('Input package changed')
 report.status='complete';console.log(JSON.stringify(metrics))
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;console.error(error)}
finally{await browser?.close();await tooling?.close();report.endedAt=new Date().toISOString();await write()}
