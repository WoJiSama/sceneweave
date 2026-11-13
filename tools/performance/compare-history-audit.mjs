// Identical actual-read graph, isolated source modules. Never modifies a user DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, assertFrozen } from './frozen-input.mjs'
import { startResourceSampling } from './resources.mjs'

const args=process.argv.slice(2), arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback
if(args.includes('--help')){
 console.log('node tools/performance/compare-history-audit.mjs --before-source ABS --after-source ABS --graph ABS_ACTUAL_READ_JSON --output ABS_NEW [--rounds 2] [--mode worker|fallback|both]')
 console.log('Serial AB/BA, fresh Chrome per side/mode. Revives captured block bytes; all graph rows remain unchanged. Source component, not normal UI or formal performance.');process.exit(0)
}
const sources={before:arg('--before-source'),after:arg('--after-source')},graph=arg('--graph'),output=arg('--output'),rounds=Number(arg('--rounds','2')),mode=arg('--mode','both')
if(![...Object.values(sources),graph,output].every(v=>v&&path.isAbsolute(v))||!Number.isSafeInteger(rounds)||rounds<1||rounds>10||!['worker','fallback','both'].includes(mode))throw Error('Use absolute paths, rounds 1–10, worker/fallback/both')
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty output')
const sha=b=>createHash('sha256').update(b).digest('hex'),graphText=await fs.readFile(graph,'utf8')
const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const toolPaths=['tools/performance/compare-history-audit.mjs','tools/performance/prepare-native-m2-fixture.mjs','tools/performance/frozen-input.mjs','tools/performance/resources.mjs','tools/performance/windows-process-sampler.mjs']
const frozen={graph:sha(graphText),sources:{},tools:await fingerprintPaths(toolRoot,toolPaths)}
for(const [side,source]of Object.entries(sources))frozen.sources[side]=await fingerprintPaths(source,['src','package.json','package-lock.json'])
const report={format:'sceneweave-identical-history-audit-comparison',version:1,status:'running',startedAt:new Date().toISOString(),sources,graph:{path:graph,sha256:frozen.graph,bytes:Buffer.byteLength(graphText)},frozen,
 runnerSha256:sha(await fs.readFile(new URL(import.meta.url))),device:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version},rounds,mode,rows:[],limitations:[
 'Actual-read synthetic graph; source-module audit only. No database transaction, complete save, resources or rendered UI.',
 'No exclusive load guard. Worker elapsed includes module loading, startup and ordinary structured clone. Page heap excludes Worker/native/GPU.',
 'Long tasks/heartbeat describe this page. Finite process sampling and shared working-set pages are not retained-size or leak evidence.',
 'A fresh browser is used for every side/mode. Timer and resource observation affect scheduling. Outputs must agree, including all owners/branches/pins.'
]}
const write=()=>fs.writeFile(path.join(output,'analysis.json'),JSON.stringify(report,null,2));await write()
try{
for(const runMode of mode==='both'?['worker','fallback']:[mode])for(let round=0;round<rounds;round++)for(const side of round%2?['after','before']:['before','after']){
 let tooling,server,browser,sampler,watchdog
 try{
  tooling=await startNativeFixtureTooling({root:sources[side]})
  server=await chromium.launchServer({channel:arg('--channel','chrome'),headless:true});browser=await chromium.connect(server.wsEndpoint())
  const page=await browser.newPage(),errors=[];watchdog=setTimeout(()=>{void page.close().catch(()=>{})},180_000)
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())})
  await page.goto(tooling.url)
  const setup=await page.evaluate(async({graphText,runMode})=>{
   const g=JSON.parse(graphText)
   if(g.kind==='captured-history')for(const b of g.blocks)b.bytes=Uint8Array.from(Object.values(b.bytes))
   if(runMode==='fallback')globalThis.Worker=undefined
   const client=await import('/src/platform/browser/storage/history-audit-client.ts')
   globalThis.__auditComparison={graph:g,client}
   return {owners:g.heads?.length??1,versions:g.versions.length,pins:g.pins.length,blocks:g.blocks?.length??null}
  },{graphText,runMode})
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
  sampler=startResourceSampling({rootPid:server.process().pid,cdp});sampler.setPhase('audit')
  console.log(`Same-graph ${runMode} round ${round+1} ${side}`)
  const result=await page.evaluate(async()=>{
   const {graph:g,client}=globalThis.__auditComparison,before=JSON.stringify(g),tasks=[],heartbeat=[]
   const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration}))))
   observer.observe({type:'longtask'});await new Promise(resolve=>setTimeout(resolve,30))
   let last=performance.now();const tick=()=>{const now=performance.now();heartbeat.push(now-last);last=now},timer=setInterval(tick,16)
   const start=performance.now()
   try{
    const value=g.kind==='captured-history'?await client.auditCapturedHistoryInWorker(g):await client.auditHistoryInWorker(g.owner,g.head,g.versions,g.pins)
    const end=performance.now();tick();clearInterval(timer)
    await new Promise(resolve=>setTimeout(resolve,50));observer.disconnect()
    if(JSON.stringify(g)!==before)throw Error('Audit mutated the actual-read graph')
    return {ms:end-start,documentBytes:value.documentBytes,maximumHeartbeatGapMs:Math.max(...heartbeat),longTasks:tasks.filter(e=>e.start>=start&&e.start<end),graphUnchanged:true}
   }finally{clearInterval(timer);observer.disconnect();client.disposeHistoryAudits()}
  })
  sampler.setPhase('audit-complete');const resources=await sampler.stop();sampler=undefined
  if(errors.length)throw Error(errors.join('\n'))
  report.rows.push({side,mode:runMode,round:round+1,browser:browser.version(),setup,...result,resources});await write()
 }finally{clearTimeout(watchdog);await sampler?.stop();await browser?.close();await server?.close();await tooling?.close()}
}
if(new Set(report.rows.map(r=>r.documentBytes)).size!==1)throw Error('Validated graph byte counts differ')
for(const[side,source]of Object.entries(sources))assertFrozen(frozen.sources[side],await fingerprintPaths(source,['src','package.json','package-lock.json']),`${side} source`)
assertFrozen(frozen.tools,await fingerprintPaths(toolRoot,toolPaths),'comparison tools')
if(sha(await fs.readFile(graph,'utf8'))!==frozen.graph)throw Error('Input graph changed')
report.status='complete'
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;console.error(error)}
finally{report.endedAt=new Date().toISOString();await write()}
