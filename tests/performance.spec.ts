import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

declare global {
  interface Window { __m0Frames?: { active:boolean; last:number; gaps:number[] } }
}
const stats=(samples:number[])=>{
  const sorted=[...samples].sort((a,b)=>a-b)
  return {n:samples.length,min:sorted[0]??null,median:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??null,max:sorted.at(-1)??null}
}

test('measure 500 and 2000 procedural props with continuous pointer input',async({page,browser},testInfo)=>{
  test.setTimeout(120_000)
  await page.goto('/#geometry')
  await expect(page.getByText('本地已保存',{exact:true})).toBeVisible()
  const results=[]
  for(const count of [500,2000] as const){
    const cold=await page.evaluate(async count=>{
      const api=(window as any).__sceneweaveDev
      api.resetMetrics()
      const started=performance.now()
      await api.openBenchmark(count)
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)
      return {openAndFirstPaintMs:performance.now()-started,drawSamples:api.getMetrics().paintDurations}
    },count)
    const box=(await page.getByTestId('scene-canvas').boundingBox())!
    const cx=box.x+box.width/2,cy=box.y+box.height/2
    await page.getByRole('button',{name:'平移工具 H',exact:true}).click()
    await page.mouse.move(cx,cy);await page.mouse.down()
    await page.evaluate(async()=>{
      ;(window as any).__sceneweaveDev.resetMetrics()
      window.__m0Frames={active:true,last:0,gaps:[]}
      const frame=(time:number)=>{
        const state=window.__m0Frames!
        if(!state.active)return
        if(state.last)state.gaps.push(time-state.last)
        state.last=time;requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    for(let i=0;i<240;i++){
      await page.evaluate(()=>new Promise(requestAnimationFrame))
      await page.mouse.move(cx+Math.sin(i/15)*65,cy+Math.cos(i/18)*45)
      if(i%40===0)await page.mouse.wheel(0,i%80===0?-45:45)
    }
    await page.mouse.up()
    const pan=await page.evaluate(async()=>{
      window.__m0Frames!.active=false
      const metrics=(window as any).__sceneweaveDev.getMetrics()
      return {frameGaps:window.__m0Frames!.gaps,paintDurations:metrics.paintDurations}
    })
    const edits=await page.evaluate(async()=>{
      const api=(window as any).__sceneweaveDev
      api.resetMetrics()
      const totalTimes:number[]=[]
      for(let i=0;i<30;i++){
        const state=api.store.getState(),prop=state.document.props['b-0'],started=performance.now()
        const success=state.execute([{type:'moveProp',id:prop.id,positionMm:{x:i%2?762:862,y:762}}],'负载位置调整')
        if(!success)throw new Error('负载事务被拒绝')
        totalTimes.push(performance.now()-started)
        await new Promise(requestAnimationFrame)
      }
      await api.flushSave()
      return {intentThroughEnqueueMs:totalTimes,domainCommitMs:api.getMetrics().commitDurations}
    })
    const storage=await page.evaluate(async()=>{
      const ip='/src/io/storage.ts'
      const snapshot=structuredClone((window as any).__sceneweaveDev.store.getState().document)
      const repo=new(await import(ip)).SceneRepository(`sceneweave-perf-${crypto.randomUUID()}`)
      const samples:number[]=[]
      for(let i=0;i<20;i++){
        snapshot.revision=i
        const started=performance.now()
        await repo.save(snapshot,i?i-1:null)
        samples.push(performance.now()-started)
      }
      repo.close();return samples
    })
    const environment=await page.evaluate(()=>({
      userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
      viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,
      canvas:Array.from(document.querySelectorAll('.konvajs-content canvas')).map(c=>({width:(c as HTMLCanvasElement).width,height:(c as HTMLCanvasElement).height})),
      heapSample:(performance as Performance & {memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory?{
        usedJSHeapSize:(performance as any).memory.usedJSHeapSize,totalJSHeapSize:(performance as any).memory.totalJSHeapSize,jsHeapSizeLimit:(performance as any).memory.jsHeapSizeLimit,
      }:null,
    }))
    const result={count,grid:{columns:50,rows:50,gridSizeMm:1524},textures:0,method:'240 real Playwright pointer moves paced by requestAnimationFrame, with 6 wheel events; 30 separate commits; 20 isolated IndexedDB writes',cold,frameGapMs:stats(pan.frameGaps),drawMs:stats(pan.paintDurations),commitMs:stats(edits.domainCommitMs),intentThroughEnqueueMs:stats(edits.intentThroughEnqueueMs),storageMs:stats(storage),environment,raw:{...pan,...edits,storage}}
    results.push(result)
    expect(result.frameGapMs.n).toBeGreaterThan(200)
    expect(result.commitMs.n).toBe(30)
    expect(result.storageMs.n).toBe(20)
    // Performance targets are observations, not correctness assertions tied to one machine.
    await page.screenshot({path:testInfo.outputPath(`workload-${count}.png`)})
  }
  const path=testInfo.outputPath('performance.json')
  await writeFile(path,JSON.stringify({runAt:new Date().toISOString(),browserVersion:browser.version(),results,limitations:['Headless Chrome on one desktop; no texture/asset load.','rAF gaps include automation scheduling and do not alone prove hardware input-to-display latency.','Heap samples are neither full browser memory nor peak export memory.']},null,2))
  await testInfo.attach('performance',{path,contentType:'application/json'})
  console.log(JSON.stringify(results.map(({count,frameGapMs,drawMs,commitMs,intentThroughEnqueueMs,storageMs})=>({count,frameGapMs,drawMs,commitMs,intentThroughEnqueueMs,storageMs}))))
})
