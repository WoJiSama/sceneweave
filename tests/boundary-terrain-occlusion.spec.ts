import { expect, test } from '@playwright/test'

test('bound surface bands respect later terrain coverage without reopening overlapping covers', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const rendererPath='/src/platform/browser/render/visual-renderer.ts',geometryPath='/src/shared/visual/geometry.ts',typesPath='/src/shared/visual/types.ts'
    const { drawVisualBoundaries } = await import(rendererPath) as typeof import('../src/platform/browser/render/visual-renderer.js')
    const { sampleVisualBoundary } = await import(geometryPath) as typeof import('../src/shared/visual/geometry.js')
    const { emptyVisualSystem } = await import(typesPath) as typeof import('../src/shared/visual/types.js')
    const rectangle = (x:number,y:number,width:number,height:number) => [{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}]
    const surface = (id:string,points:ReturnType<typeof rectangle>,priority=0,elevationMm=0) => ({id,points,priority,elevationMm,style:null})
    const source = {closed:false,sampleSpacingMm:100,toleranceMm:1,
      segments:[{id:'line',start:{x:500,y:0},control1:{x:500,y:333},control2:{x:500,y:667},end:{x:500,y:1000}}]}
    const sampled = sampleVisualBoundary(source as never)
    const boundary = {id:'boundary',...sampled,terrainAreaIds:['land','water']}
    const terrain=[surface('land',rectangle(0,0,1000,1000)),surface('water',rectangle(500,0,500,1000),2)]
    const first=surface('first-cover',rectangle(300,300,400,200),3,300),second=surface('second-cover',rectangle(350,400,350,300),4,-100)
    const rows=[]
    const render = (surfaces:typeof terrain,kind:string,bindings:string[],enabled=true) => {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1000
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#5c7762';ctx.fillRect(0,0,1000,1000)
      const projection={audience:'player',sourceRevision:0,bounds:{x:0,y:0,width:1000,height:1000},gridSizeMm:null,rooms:[],terrain:surfaces,walls:[],props:[],edges:[],paths:[],connections:[],notes:[],regions:[],masks:[],theme:null,materials:{},assetIds:[],limitations:[],diagnostics:[],
        visual:{...emptyVisualSystem(),environment:{...emptyVisualSystem().environment},boundsMm:{x:0,y:0,width:1000,height:1000},boundaries:[{...boundary,terrainAreaIds:bindings}],edgeLooks:enabled?[{id:'look',boundaryId:'boundary',kind,side:'both',widthMm:180,repeatMm:140,seed:'occlusion',color:'#ebd3a1',accentColor:'#fdf9e8',opacity:1,intensity:1}]:[],lights:[],fogs:[],filters:[],occluderRings:[],contactRings:[],suppressedTerrainEdgeIds:[]}}
      drawVisualBoundaries(ctx,projection as never)
      return ctx.getImageData(0,0,1000,1000).data
    }
    const changed=(a:Uint8ClampedArray,b:Uint8ClampedArray,box:number[])=>{
      let count=0;for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++){const i=(y*1000+x)*4;if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])count++}return count
    }
    for(const kind of ['shore','grass','path','fence']) {
      const withCovers=render([...terrain,first,second],kind,['land','water']),empty=render([...terrain,first,second],kind,['land','water'],false)
      rows.push({kind,covered:changed(withCovers,empty,[305,305,695,495]),overlap:changed(withCovers,empty,[355,405,695,495]),lowerLaterCover:changed(withCovers,empty,[355,505,695,695]),outside:changed(withCovers,empty,[320,20,680,280])})
    }
    const plain=render(terrain,'shore',['land','water']),lowerBefore=render([first,...terrain],'shore',['land','water'])
    const unbound=render([...terrain,first],'shore',[]),unboundPlain=render(terrain,'shore',[])
    const partialBinding=render([...terrain,first],'shore',['land','water','first-cover'])
    const negativeControls={earlierCoverDifference:changed(plain,lowerBefore,[0,0,1000,1000]),unboundDifference:changed(unbound,unboundPlain,[0,0,1000,1000]),boundCoverDifference:changed(partialBinding,plain,[0,0,1000,1000])}
    return {rows,negativeControls}
  })
  await info.attach('actual-canvas-bands.json',{body:JSON.stringify(report,null,2),contentType:'application/json'})
  for (const row of report.rows) {
    expect(row.covered,row.kind).toBe(0);expect(row.overlap,row.kind).toBe(0);expect(row.lowerLaterCover,row.kind).toBe(0);expect(row.outside,row.kind).toBeGreaterThan(0)
  }
  expect(report.negativeControls).toEqual({earlierCoverDifference:0,unboundDifference:0,boundCoverDifference:0})
})
