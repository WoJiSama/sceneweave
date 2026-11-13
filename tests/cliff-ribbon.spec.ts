import { expect, test } from '@playwright/test'
import { openVisualTask } from './workspace-navigation-helpers'
import type { SceneDocument } from '../src/shared/model/scene.js'
import type { VisualEdgeLook } from '../src/shared/visual/types.js'

test('independent headland and positive crater keep native openings, high ground, privacy and crop pixels', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const fixturePath='/tools/testing/cliff-ribbon-fixtures.ts', projectionPath='/src/shared/projection/projection.ts',
      rendererPath='/src/platform/browser/render/visual-renderer.ts', basePath='/src/shared/visual/base.ts', geometryPath='/src/shared/geometry/geometry.ts'
    const { cliffRibbonFixture }=await import(fixturePath), { projectScene }=await import(projectionPath),
      { drawVisualBoundaries }=await import(rendererPath), { visualBase }=await import(basePath), { pointInPolygon, corridor }=await import(geometryPath)
    const reports=[]
    for(const kind of ['headland','crater'] as const){
      const scene: SceneDocument=cliffRibbonFixture(kind), projection=projectScene(scene,'player'), width=800,height=640,scale=.04
      const draw=(p:typeof projection)=>{const canvas=document.createElement('canvas');canvas.width=Math.round(p.bounds.width*scale);canvas.height=Math.round(p.bounds.height*scale)
        const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#a5cdd1';ctx.fillRect(0,0,canvas.width,canvas.height)
        ctx.setTransform(scale,0,0,scale,-p.bounds.x*scale,-p.bounds.y*scale);drawVisualBoundaries(ctx,p)
        return {rgba:ctx.getImageData(0,0,canvas.width,canvas.height).data,png:canvas.toDataURL('image/png').split(',')[1]}}
      // Pixel isolation checks only cliff paint; shore paint has a different,
      // deliberately two-sided envelope. The complete pair is attached below.
      const cliffs=structuredClone(projection);cliffs.visual!.edgeLooks=cliffs.visual!.edgeLooks.filter((l:{kind:string})=>l.kind==='cliff')
      cliffs.visual!.edgePaintOrder=cliffs.visual!.edgeLooks.map((l:{id:string})=>({kind:'edgeLook',id:l.id}))
      const painted=draw(cliffs), earlier=structuredClone(cliffs)
      for(const l of earlier.visual!.edgeLooks)l.renderProfile='rockRelief4'
      const old=draw(earlier), actual=draw(projection)
      let changed=0,escaped=0,highChanges=0,openingChanges=0,oldDifferences=0
      const distance=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
      const land=projection.terrain.find((t:{id:string})=>t.id===(kind==='headland'?'independent-headland':'positive-crater'))!
      const opening=projection.connections[0], openingBand=opening?corridor(opening.start,opening.end,opening.widthMm-100):[]
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*4,p={x:(x+.5)/scale,y:(y+.5)/scale},changedHere=painted.rgba[i]!==165||painted.rgba[i+1]!==205||painted.rgba[i+2]!==209
        if(painted.rgba.slice(i,i+4).some((v:number,c:number)=>v!==old.rgba[i+c]))oldDifferences++
        if(!changedHere)continue;changed++
        const near=Math.min(...cliffs.visual!.boundaries.flatMap((b:{points:{x:number;y:number}[];closed:boolean})=>b.points.slice(0,b.closed?undefined:-1).map((a,j)=>distance(p,a,b.points[(j+1)%b.points.length]))))
        if(near>1250)escaped++
        const inside=pointInPolygon(p,land.points,false)
        if(near>60 && (kind==='headland'?inside:!inside))highChanges++
        if(openingBand.length&&pointInPolygon(p,openingBand,false))openingChanges++
      }
      const secret=structuredClone(scene), v=visualBase(secret)!, b=structuredClone(Object.values(v.boundaries)[0]) as {id:string;visibility:string;binding:unknown;segments:{id:string;start:{x:number};end:{x:number};control1:{x:number};control2:{x:number}}[]}
      b.id='unrelated-private-shape';b.visibility='gm';b.binding={kind:'decoration'}
      for(const [i,s] of b.segments.entries()){s.id=`private-segment-${i}`;for(const p of [s.start,s.control1,s.control2,s.end])p.x+=1200}
      v.boundaries[b.id]=b
      const source=(Object.values(v.edgeLooks) as VisualEdgeLook[]).find((l)=>l.kind==='cliff')!
      v.edgeLooks['private-paint']={...source,id:'private-paint',boundaryId:b.id,visibility:'gm',color:'#ff0000',widthMm:2000}
      const hidden=draw(projectScene(secret,'player')),gm=draw(projectScene(secret,'gm'))
      let privateDifferences=0,gmDifferences=0,cropDifferences=0,cropMaxDelta=0,cropInteriorDifferences=0,cliffCropDifferences=0
      const cropExamples:{x:number;y:number;delta:number;full:number;crop:number}[]=[]
      for(let i=0;i<actual.rgba.length;i++){if(actual.rgba[i]!==hidden.rgba[i])privateDifferences++;if(actual.rgba[i]!==gm.rgba[i])gmDifferences++}
      const cropProjection={...projection,bounds:{x:4000,y:4000,width:10000,height:8000}},crop=draw(cropProjection),cliffCrop=draw({...cliffs,bounds:cropProjection.bounds})
      for(let y=0;y<320;y++)for(let x=0;x<400;x++)for(let c=0;c<4;c++){
        const i=(y*400+x)*4+c,j=((y+160)*800+x+160)*4+c,delta=Math.abs(crop.rgba[i]-actual.rgba[j])
        if(delta){cropDifferences++;if(delta>cropMaxDelta){cropExamples.push({x,y,delta,full:actual.rgba[j],crop:crop.rgba[i]});cropMaxDelta=delta}if(x>3&&y>3&&x<396&&y<316)cropInteriorDifferences++}
        if(cliffCrop.rgba[i]!==painted.rgba[j])cliffCropDifferences++
      }
      reports.push({kind,changed,escaped,highChanges,openingChanges,oldDifferences,privateDifferences,gmDifferences,cropDifferences,cropMaxDelta,cropInteriorDifferences,cliffCropDifferences,cropExamples,png:actual.png,oldPng:old.png})
    }
    return reports
  })
  await info.attach('independent-pixel-results.json',{body:JSON.stringify(result.map(({png:_png,oldPng:_old,...r})=>r),null,2),contentType:'application/json'})
  for(const r of result){
    await info.attach(`${r.kind}-profile5.png`,{body:Buffer.from(r.png,'base64'),contentType:'image/png'})
    await info.attach(`${r.kind}-profile4.png`,{body:Buffer.from(r.oldPng,'base64'),contentType:'image/png'})
    expect(r.changed).toBeGreaterThan(2000);expect(r.oldDifferences).toBeGreaterThan(1000)
    expect(r.escaped).toBe(0);expect(r.highChanges).toBe(0);expect(r.openingChanges).toBe(0)
    expect(r.privateDifferences).toBe(0);expect(r.gmDifferences).toBeGreaterThan(1000)
    // This change guarantees the new cliff pass. The separately recorded
    // complete image also contains the unchanged legacy shore blur/strokes.
    expect(r.cliffCropDifferences).toBe(0)
  }
})

test('ordinary profile selection previews, adopts, undoes, redoes and survives a fresh page', async ({ page, context },info) => {
  test.setTimeout(180000)
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/')
  const archive=await page.evaluate(async()=>{
    const fixtures='/tools/testing/cliff-ribbon-fixtures.ts',art='/src/platform/browser/content/visual-art-project.ts',
      samples='/src/shared/visual/sample-art.ts',base='/src/shared/visual/base.ts',file='/src/shared/project/file.ts',
      project='/src/application/workspace/project.ts',validation='/src/platform/browser/project-validation.ts'
    const {cliffRibbonFixture}=await import(fixtures),{materializeVisualArt}=await import(art),{VISUAL_SAMPLE_ART,VISUAL_SAMPLE_LICENSE}=await import(samples),
      {visualBase}=await import(base),{exportProject}=await import(file),{toBundle}=await import(project),{browserProjectValidation}=await import(validation)
    const scene=cliffRibbonFixture('headland');for(const look of Object.values(visualBase(scene)!.edgeLooks) as {kind:string;renderProfile:string}[])if(look.kind==='cliff')look.renderProfile='rockRelief4'
    const p=await materializeVisualArt(scene,VISUAL_SAMPLE_ART,VISUAL_SAMPLE_LICENSE,(key:string)=>`visual-art-${key}`)
    const bytes:Uint8Array=await exportProject(toBundle(p),browserProjectValidation);return Array.from(bytes)
  })
  await page.getByRole('button',{name:'打开工程文件',exact:true}).click()
  await page.locator('input[type="file"]').last().setInputFiles({name:'独立岬角.sceneweave',mimeType:'application/octet-stream',buffer:Buffer.from(archive)})
  const saved=async(p=page)=>{await expect(p.locator('.asset-save')).toHaveText('本地已保存',{timeout:120000});await expect(p.locator('.asset-map-wrap')).toHaveAttribute('aria-busy','false',{timeout:120000})}
  await saved()
  const read=async(p=page)=>p.evaluate(async()=>{const module='/src/editor/main/Workbench.tsx';const {nativeWorkspace}=await import(module);const s=nativeWorkspace.getState();return {document:s.project.document,canUndo:s.canUndo}})
  const initial=await read(),panel=await openVisualTask(page,'边界')
  await panel.getByLabel('视觉已有曲线',{exact:true}).selectOption('part-a')
  await panel.getByLabel('崖面层次画法',{exact:true}).selectOption('rockRelief5')
  await panel.getByRole('button',{name:'预览曲线与边带',exact:true}).click()
  const adopt=page.getByRole('button',{name:'采用视觉修改',exact:true})
  await expect(adopt).toBeVisible();await expect(adopt).toBeDisabled()
  const pending=await read();expect(pending.document).toEqual(initial.document)
  await page.getByLabel('确认完整影响范围',{exact:true}).check();await adopt.click();await saved()
  const adopted=await read()
  const profile=(d:SceneDocument)=>d.visual!.base.base.edgeLooks['part-a-cliff'].renderProfile
  expect(profile(adopted.document)).toBe('rockRelief5')
  expect(adopted.document.terrainAreas).toEqual(initial.document.terrainAreas);expect(adopted.document.assets).toEqual(initial.document.assets)
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await saved();expect(profile((await read()).document)).toBe('rockRelief4')
  await page.getByRole('button',{name:'重做编辑',exact:true}).click();await saved();const redone=await read();expect(profile(redone.document)).toBe('rockRelief5')
  await page.screenshot({path:info.outputPath('profile-adopted.png'),fullPage:true})
  await page.close();const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));await cold.goto('/#home')
  await cold.locator('.home-project-row').filter({hasText:'连续崖面独立检查 · headland'}).getByRole('button',{name:'打开',exact:true}).click();await saved(cold)
  const reopened=await read(cold);expect(reopened.document).toEqual(redone.document);expect(reopened.canUndo).toBe(false)
  expect(errors).toEqual([])
  await cold.screenshot({path:info.outputPath('profile-cold-open.png'),fullPage:true})
  await info.attach('ui-profile-results.json',{body:JSON.stringify({profile:'rockRelief5',previewPreservedBaseline:true,undo:true,redo:true,coldSameDocument:true,initialRevision:initial.document.revision,finalRevision:reopened.document.revision,errors},null,2),contentType:'application/json'})
})
