import { test, expect } from '@playwright/test'
import type { Projection } from '../src/shared/projection/types.js'

test('all native cliff representations leave the same exact supported stair opening', async ({ page }) => {
  await page.goto('/')
  const pixels = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/visual-renderer.ts', geometryPath = '/src/shared/visual/geometry.ts', typesPath = '/src/shared/visual/types.ts'
    const { drawVisualBoundaries } = await import(rendererPath)
    const { sampleVisualBoundary } = await import(geometryPath), { emptyVisualSystem } = await import(typesPath)
    const rectangle = (x:number,y:number,right:number,bottom:number) => [{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}]
    const common={floorId:'floor',layerId:'ground',visibility:'public',editLocked:false}
    const boundary={...common,id:'cliff',closed:false,sampleSpacingMm:200,toleranceMm:10,binding:{kind:'decoration'},segments:[{id:'line',start:{x:2000,y:500},control1:{x:2000,y:1000},control2:{x:2000,y:2000},end:{x:2000,y:2500}}]}
    const result=[]
    for(const kind of ['edgeLook','materializedEdge','transition']) for(const variant of ['single','unrelated','overlap']) {
      const unrelated=variant==='unrelated'
      const projection={audience:'player',sourceRevision:0,bounds:{x:0,y:0,width:4000,height:3000},gridSizeMm:null,rooms:[],terrain:[{id:'low',points:rectangle(0,0,4000,3000),elevationMm:800,style:null},{id:'high',points:rectangle(2000,0,4000,3000),elevationMm:2600,style:null}],walls:[],props:[],edges:[],paths:[],connections:[{id:'stairs',kind:'stairs',start:{x:1000,y:1500},end:{x:3000,y:1500},widthMm:600,fromElevationMm:800,toElevationMm:2600,blocksMovement:false,style:null,surfaceIds:unrelated?['other-low','other-high']:['low','high']}],notes:[],regions:[],masks:[],theme:null,materials:{},assetIds:[],limitations:[],diagnostics:[],visual:{environment:emptyVisualSystem().environment,boundsMm:{x:0,y:0,width:4000,height:3000},boundaries:[{id:'cliff',...sampleVisualBoundary(boundary),terrainAreaIds:['low','high']}],edgeLooks:[],materializedEdges:[],transitions:[],lights:[],fogs:[],filters:[],suppressedTerrainEdgeIds:[],occluderRings:[],contactRings:[]}}
      const ring=rectangle(1600,500,2000,2500)
      if(variant==='overlap')projection.connections.push({...projection.connections[0],id:'second-stairs',start:{x:1000,y:1700},end:{x:3000,y:1700}})
      if(kind==='edgeLook')projection.visual.edgeLooks.push({...common,id:'look',boundaryId:'cliff',kind:'cliff',side:'left',widthMm:400,color:'#FF0000',accentColor:'#FF0000',opacity:1,intensity:0,seed:'fixed',repeatMm:200,enabled:true} as never)
      if(kind==='materializedEdge')projection.visual.materializedEdges.push({id:'edge',boundaryId:'cliff',kind:'cliff',polygons:[ring],strokes:[],fillColor:'#FF0000',opacity:1} as never)
      if(kind==='transition')projection.visual.transitions.push({...common,id:'transition',boundaryId:'cliff',kind:'cliff',side:'left',polygons:[{pointsMm:ring,fillColor:'#FF0000',opacity:1}],strokes:[],widthMm:400,enabled:true} as never)
      const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,800,600);ctx.scale(.2,.2)
      drawVisualBoundaries(ctx,projection)
      const pixel=(x:number,y:number)=>[...ctx.getImageData(x*.2,y*.2,1,1).data]
      result.push({kind,unrelated,variant,inside:pixel(1800,1500),outside:pixel(1800,1100),nearSide:pixel(1800,1180)})
    }
    return result
  })
  for(const row of pixels){
    expect(row.outside[0],`${row.kind} retains the cliff outside the opening`).toBeGreaterThan(row.outside[1])
    if(row.unrelated)expect(row.inside,`${row.kind} cannot cut an unrelated cliff`).not.toEqual([255,255,255,255])
    else expect(row.inside,`${row.kind} clears the full physical channel`).toEqual([255,255,255,255])
    expect(row.nearSide,`${row.kind} does not widen the 600 mm opening`).not.toEqual([255,255,255,255])
  }
})

test('native stairs retain uphill shading when endpoints reverse and a formal crop uses the same world pixel density', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const path='/src/platform/browser/render/canvas-renderer.ts'
    const {renderRasterProjection}=await import(path)
    const rows=[]
    const rectangle=(x:number,y:number,right:number,bottom:number)=>[{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}]
    for(const angle of [0,Math.PI/2,Math.PI/4]){
      const dx=Math.cos(angle),dy=Math.sin(angle),start={x:3000-dx*2000,y:3000-dy*2000},end={x:3000+dx*2000,y:3000+dy*2000}
      const projection:Projection={audience:'gm',sourceRevision:0,bounds:{x:0,y:0,width:6000,height:6000},gridSizeMm:null,rooms:[],terrain:[{id:'ground',points:rectangle(0,0,6000,6000),style:null,elevationMm:800,priority:0}],walls:[],props:[],edges:[],paths:[],connections:[{id:'stairs',kind:'stairs',start,end,widthMm:1500,fromElevationMm:800,toElevationMm:2600,blocksMovement:false,style:null,surfaceIds:['low','high']}],notes:[],regions:[],masks:[],theme:null,materials:{},assetIds:[],limitations:[],diagnostics:[]}
      const resources={assetRefs:{},assets:{},resources:{read:async()=>{throw new Error('No image expected')}}},options={audience:'gm',longEdgePx:750}
      const forward=await renderRasterProjection(resources,projection,options),a=forward.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,750,750).data
      const c=projection.connections[0];projection.connections=[{...c,start:end,end:start,fromElevationMm:2600,toElevationMm:800}]
      const reverse=await renderRasterProjection(resources,projection,options),b=reverse.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,750,750).data
      let reversedDifferences=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])reversedDifferences++
      projection.connections=[c]
      const crop=await renderRasterProjection(resources,projection,{...options,longEdgePx:500},undefined,undefined,{x:1000,y:1000,width:4000,height:4000})
      const pixels=crop.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,500,500).data
      let cropDifferences=0;for(let y=0;y<500;y++)for(let x=0;x<500;x++)for(let channel=0;channel<4;channel++)if(a[((y+125)*750+x+125)*4+channel]!==pixels[(y*500+x)*4+channel])cropDifferences++
      const exterior=[...a.slice((50*750+50)*4,(50*750+50)*4+4)]
      rows.push({angle,reversedDifferences,cropDifferences,exterior})
    }
    return rows
  })
  for(const row of results){expect(row.reversedDifferences,`endpoint reversal at ${row.angle}`).toBe(0);expect(row.cropDifferences,`world crop at ${row.angle}`).toBe(0);expect(row.exterior).toEqual([195,190,168,255])}
})
