import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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

test('connection landings blend each real support material inside the corridor and leave its physical projection untouched', async ({ page }) => {
  await page.goto('/')
  const sources = await Promise.all(['sand', 'grass'].map(async name => {
    const bytes = await readFile(resolve(`public/assets/sceneweave-handdrawn-outdoor/${name}.png`))
    return { name, base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }
  }))
  const result = await page.evaluate(async ({ sources }) => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath)
    const png = new Map(sources.map(source => [source.name, Uint8Array.from(atob(source.base64), char => char.charCodeAt(0))]))
    const assetRefs = Object.fromEntries(sources.map(source => [source.name, { id: source.name, sha256: source.sha256, mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'fixture', origin: { kind: 'original', attribution: 'test fixture', canEmbed: true } }]))
    const assets = Object.fromEntries(sources.map(source => [source.sha256, { sha256: source.sha256, mimeType: 'image/png', sizeBytes: source.sizeBytes, pixelWidth: 1024, pixelHeight: 1024 }]))
    const material = (id: string) => ({ materialRef: { id, version: 1 }, tileSizeMm: { width: 700, height: 700 }, rotationDeg: 0,
      alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
    const style = (id: string) => ({ base: material(id), overlays: [] })
    const rect = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const connection = { id: 'stairs', kind: 'stairs' as const, start: { x: 2000, y: 3000 }, end: { x: 10000, y: 3000 }, widthMm: 1500,
      fromElevationMm: 400, toElevationMm: 1800, blocksMovement: false, style: null, surfaceIds: ['low', 'high'] as [string, string],
      route: { centerlineMm: [{ x: 2000, y: 3000 }, { x: 10000, y: 3000 }], stairStyle: 'stone' as const, treadDepthMm: 500 } }
    const projection: Projection = { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 12000, height: 6000 }, gridSizeMm: null,
      rooms: [], terrain: [
        { id: 'low', points: rect(0, 0, 6000, 6000), style: style('sand'), elevationMm: 400, priority: 0 },
        { id: 'high', points: rect(6000, 0, 12000, 6000), style: style('grass'), elevationMm: 1800, priority: 1 },
      ], walls: [], props: [], edges: [], paths: [], connections: [connection], notes: [], regions: [], masks: [], theme: null,
      materials: { sand: { id: 'sand', version: 1, textureAssetId: 'sand' }, grass: { id: 'grass', version: 1, textureAssetId: 'grass' } }, assetIds: ['grass', 'sand'], limitations: [], diagnostics: [] }
    const before = JSON.stringify(projection)
    const rasterSources = { assetRefs, assets, resources: { read: async (hash: string) => new Uint8Array(png.get(sources.find(source => source.sha256 === hash)!.name)!) } }
    const withBlend = await renderRasterProjection(rasterSources, projection, { audience: 'gm', longEdgePx: 1200 })
    const afterRender = JSON.stringify(projection)
    projection.connections[0] = { ...connection, surfaceIds: undefined }
    const withoutBlend = await renderRasterProjection(rasterSources, projection, { audience: 'gm', longEdgePx: 1200 })
    const get = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round(x / 10), Math.round(y / 10), 1, 1).data]
    const points = { start: [2180, 3000], end: [9820, 3000], outside: [2180, 3900], middle: [6000, 3000] }
    return { before, after: afterRender,
      diff: Object.fromEntries(Object.entries(points).map(([key, point]) => [key, JSON.stringify(get(withBlend, point[0], point[1])) !== JSON.stringify(get(withoutBlend, point[0], point[1]))])),
      pixels: Object.fromEntries(Object.entries(points).map(([key, point]) => [key, { with: get(withBlend, point[0], point[1]), without: get(withoutBlend, point[0], point[1]) }])) }
  }, { sources })
  expect(result.diff.start, JSON.stringify(result.pixels)).toBe(true)
  expect(result.diff.end, JSON.stringify(result.pixels)).toBe(true)
  expect(result.diff.middle, JSON.stringify(result.pixels)).toBe(false)
  expect(result.diff.outside, JSON.stringify(result.pixels)).toBe(false)
  expect(result.before).toBe(result.after)
})

test('bent routed landing opacity follows uneven arc stations and survives endpoint reversal', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath)
    const sources = await Promise.all([['low', '#1544D9'], ['high', '#E73383']].map(async ([id, color]) => {
      const image = document.createElement('canvas'); image.width = image.height = 4
      const ctx = image.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 4, 4)
      const bytes = new Uint8Array(await (await new Promise<Blob>(resolve => image.toBlob(blob => resolve(blob!)))).arrayBuffer())
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      return { id, bytes, sha256 }
    }))
    const raster = {
      assetRefs: Object.fromEntries(sources.map(source => [source.id, { id: source.id, sha256: source.sha256, mimeType: 'image/png', pixelWidth: 4, pixelHeight: 4,
        logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'fixture', origin: { kind: 'original', attribution: 'solid pixel fixture', canEmbed: true } }])),
      assets: Object.fromEntries(sources.map(source => [source.sha256, { sha256: source.sha256, mimeType: 'image/png', sizeBytes: source.bytes.length, pixelWidth: 4, pixelHeight: 4 }])),
      resources: { read: async (hash: string) => new Uint8Array(sources.find(source => source.sha256 === hash)!.bytes) },
    }
    const style = (id: string) => ({ base: { materialRef: { id, version: 1 }, tileSizeMm: { width: 700, height: 700 }, rotationDeg: 0,
      alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })
    const rect = (x: number, right: number) => [{ x, y: 0 }, { x: right, y: 0 }, { x: right, y: 3000 }, { x, y: 3000 }]
    const centerlineMm = [{ x: 1000, y: 1000 }, { x: 4500, y: 1000 }, { x: 4500, y: 1300 }, { x: 4700, y: 1300 }]
    const connection = { id: 'bent-stairs', kind: 'stairs' as const, start: centerlineMm[0], end: centerlineMm.at(-1)!, widthMm: 120,
      fromElevationMm: 400, toElevationMm: 1800, blocksMovement: false, style: null, surfaceIds: ['low', 'high'] as [string, string],
      route: { centerlineMm, stairStyle: 'stone' as const, treadDepthMm: 250 } }
    const projection: Projection = { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 6000, height: 3000 }, gridSizeMm: null,
      rooms: [], terrain: [{ id: 'low', points: rect(0, 3000), style: style('low'), elevationMm: 400, priority: 0 },
        { id: 'high', points: rect(3000, 6000), style: style('high'), elevationMm: 1800, priority: 1 }], walls: [], props: [], edges: [], paths: [], connections: [connection],
      notes: [], regions: [], masks: [], theme: null, materials: { low: { id: 'low', version: 1, textureAssetId: 'low' }, high: { id: 'high', version: 1, textureAssetId: 'high' } },
      assetIds: ['low', 'high'], limitations: [], diagnostics: [] }
    const before = JSON.stringify(projection), options = { audience: 'gm' as const, longEdgePx: 1200 }
    const merged = await renderRasterProjection(raster, projection, options)
    const unmerged = await renderRasterProjection(raster, { ...projection, connections: [{ ...connection, surfaceIds: undefined }] }, options)
    const ground = await renderRasterProjection(raster, { ...projection, connections: [] }, options)
    const reversed = await renderRasterProjection(raster, { ...projection, connections: [{ ...connection, start: connection.end, end: connection.start,
      fromElevationMm: connection.toElevationMm, toElevationMm: connection.fromElevationMm, surfaceIds: ['high', 'low'],
      route: { ...connection.route, centerlineMm: [...centerlineMm].reverse() } }] }, options)
    const get = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x / 5, y / 5, 1, 1).data]
    const distance = (a: number[], b: number[]) => a.slice(0, 3).reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
    const sample = (x: number, y: number) => {
      const withMerge = get(merged, x, y), without = get(unmerged, x, y), support = get(ground, x, y)
      return { withMerge, without, weight: 1 - distance(withMerge, support) / Math.max(1, distance(without, support)) }
    }
    const a = merged.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, merged.width, merged.height).data
    const b = reversed.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, reversed.width, reversed.height).data
    let reversedDifferences = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) reversedDifferences++
    return { unchanged: before === JSON.stringify(projection), reversedDifferences,
      across: [sample(4600, 1270), sample(4600, 1330)], join: [sample(4515, 1285), sample(4475, 1325)],
      afterBend: sample(4500, 1230), outside: sample(4600, 1400), middle: sample(3000, 1000) }
  })
  expect(result.unchanged).toBe(true)
  expect(result.reversedDifferences).toBe(0)
  expect(Math.abs(result.across[0].weight - result.across[1].weight), JSON.stringify(result.across)).toBeLessThan(.07)
  for (const sample of result.across) expect(sample.weight).toBeCloseTo(1 - 100 / 360, 1)
  for (const sample of result.join) expect(sample.weight, JSON.stringify(result.join)).toBeCloseTo(1 - 200 / 360, 1)
  expect(result.afterBend.weight).toBeCloseTo(1 - 270 / 360, 1)
  expect(result.outside.withMerge).toEqual(result.outside.without)
  expect(result.middle.withMerge).toEqual(result.middle.without)
})

test('natural-rock landings break the slab edge with real endpoint ground along straight and curved routes', async ({ page }, info) => {
  await page.goto('/')
  const sources = await Promise.all(['sand', 'grass'].map(async name => {
    const bytes = await readFile(resolve(`public/assets/sceneweave-handdrawn-outdoor/${name}.png`))
    return { name, base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }
  }))
  const rows = await page.evaluate(async ({ sources }) => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts', routePath = '/src/shared/geometry/connection-route.ts'
    const { renderRasterProjection } = await import(rendererPath), { connectionArcFrame, sampleConnectionRoute } = await import(routePath)
    const bytes = new Map(sources.map(source => [source.sha256, Uint8Array.from(atob(source.base64), char => char.charCodeAt(0))]))
    const assetRefs = Object.fromEntries(sources.map(source => [source.name, { id: source.name, sha256: source.sha256, mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'fixture', origin: { kind: 'original', attribution: 'test fixture', canEmbed: true } }]))
    const assets = Object.fromEntries(sources.map(source => [source.sha256, { sha256: source.sha256, mimeType: 'image/png', sizeBytes: source.sizeBytes, pixelWidth: 1024, pixelHeight: 1024 }]))
    const style = (id: string) => ({ base: { materialRef: { id, version: 1 }, tileSizeMm: { width: 700, height: 700 }, rotationDeg: 0,
      alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })
    const rect = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const start = { x: 1800, y: 2400 }, end = { x: 10200, y: 2400 }
    const curved = sampleConnectionRoute({ kind: 'cubic', segments: [{ id: 'curve', start, control1: { x: 1800, y: 5200 }, control2: { x: 10200, y: 5200 }, end }], sampleSpacingMm: 120, toleranceMm: 10 })
    const output = []
    for (const [kind, centerlineMm] of [['straight', [start, end]], ['curved', curved]] as const) {
      const connection = { id: `natural-rock-${kind}`, kind: 'stairs' as const, start, end, widthMm: 1200, fromElevationMm: 400, toElevationMm: 1800,
        blocksMovement: false, style: null, surfaceIds: ['low', 'high'] as [string, string], route: { centerlineMm: [...centerlineMm], stairStyle: 'naturalRock' as const, treadDepthMm: 400 } }
      const projection: Projection = { audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 12000, height: 7000 }, gridSizeMm: null,
        rooms: [], terrain: [{ id: 'low', points: rect(0, 0, 6000, 7000), style: style('sand'), elevationMm: 400, priority: 0 },
          { id: 'high', points: rect(6000, 0, 12000, 7000), style: style('grass'), elevationMm: 1800, priority: 1 }], walls: [], props: [], edges: [], paths: [],
        connections: [connection], notes: [], regions: [], masks: [], theme: null, materials: { sand: { id: 'sand', version: 1, textureAssetId: 'sand' },
          grass: { id: 'grass', version: 1, textureAssetId: 'grass' } }, assetIds: ['grass', 'sand'], limitations: [], diagnostics: [] }
      const before = JSON.stringify(projection), raster = { assetRefs, assets, resources: { read: async (hash: string) => new Uint8Array(bytes.get(hash)!) } }
      const merged = await renderRasterProjection(raster, projection, { audience: 'gm', longEdgePx: 1200 })
      const unchanged = before === JSON.stringify(projection)
      const unmerged = await renderRasterProjection(raster, { ...projection, connections: [{ ...connection, surfaceIds: undefined }] }, { audience: 'gm', longEdgePx: 1200 })
      const ground = await renderRasterProjection(raster, { ...projection, connections: [] }, { audience: 'gm', longEdgePx: 1200 })
      const frame = connectionArcFrame(centerlineMm), inward = [frame, connectionArcFrame([...centerlineMm].reverse())], depth = 864
      const get = (canvas: HTMLCanvasElement, point: { x: number; y: number }) => [...canvas.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round(point.x / 10), Math.round(point.y / 10), 1, 1).data]
      const distance = (a: number[], b: number[]) => a.slice(0, 3).reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
      const samples = inward.map(frame => {
        const sample = (along: number, lateral = 0) => {
          const point = frame.at(along, lateral), withMerge = get(merged, point), without = get(unmerged, point), support = get(ground, point)
          return { withMerge, without, support, weight: 1 - distance(withMerge, support) / Math.max(1, distance(without, support)) }
        }
        return { root: sample(depth * .15), center: sample(depth * .9), side: sample(depth * .9, 480), beyond: sample(depth * 1.3), outside: sample(depth * .5, 850) }
      })
      output.push({ kind, unchanged, samples, middleWith: get(merged, frame.at(frame.length / 2)), middleWithout: get(unmerged, frame.at(frame.length / 2)), image: merged.toDataURL('image/png').split(',')[1] })
    }
    return output
  }, { sources })
  for (const row of rows) {
    expect(row.unchanged, row.kind).toBe(true)
    for (const sample of row.samples) {
      expect(sample.root.weight, `${row.kind} uses the endpoint's own ground`).toBeGreaterThan(.5)
      expect(sample.side.weight, `${row.kind} breaks the landing's straight slab edge`).toBeGreaterThan(sample.center.weight + .1)
      expect(sample.beyond.withMerge, `${row.kind} leaves later route stations unchanged`).toEqual(sample.beyond.without)
      expect(sample.outside.withMerge, `${row.kind} stays inside the physical corridor`).toEqual(sample.outside.without)
    }
    expect(row.middleWith, `${row.kind} keeps the central treads`).toEqual(row.middleWithout)
    await info.attach(`${row.kind}-natural-rock-landings`, { body: Buffer.from(row.image, 'base64'), contentType: 'image/png' })
  }
})

test('the production cliff boundary pass paints deterministic stratified relief across curved ledges', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const paths = { renderer: '/src/platform/browser/render/visual-renderer.ts', geometry: '/src/shared/visual/geometry.ts', relief: '/src/platform/browser/render/cliff-relief.ts', types: '/src/shared/visual/types.ts' }
    const { drawVisualBoundaries } = await import(paths.renderer), { sampleVisualBoundary } = await import(paths.geometry)
    const { cliffRelief } = await import(paths.relief), { emptyVisualSystem } = await import(paths.types)
    const rectangle = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const bounds = { x: 0, y: 0, width: 12000, height: 6000 }, look = {
      id: 'layered-cliff-look', boundaryId: 'layered-cliff', floorId: 'floor', layerId: 'ground', visibility: 'public' as const, editLocked: false,
      kind: 'cliff' as const, side: 'left' as const, widthMm: 1800, color: '#897D66', accentColor: '#E0C997', opacity: .92, intensity: .75,
      seed: 'fixed-curved-cliff', repeatMm: 900, enabled: true,
    }
    const cases = [
      { id: 'straight', closed: false, sampleSpacingMm: 250, toleranceMm: 10, segments: [{ id: 'straight-line', start: { x: 1000, y: 2000 }, control1: { x: 4300, y: 2000 }, control2: { x: 7700, y: 2000 }, end: { x: 11000, y: 2000 } }], terrainAreaIds: ['high'] },
      { id: 'curved', closed: false, sampleSpacingMm: 200, toleranceMm: 12, segments: [{ id: 'curved-line', start: { x: 1000, y: 2000 }, control1: { x: 3800, y: 1200 }, control2: { x: 7600, y: 2850 }, end: { x: 11000, y: 2000 } }], terrainAreaIds: ['high'] },
    ]
    const rows = []
    for (const source of cases) {
      const sampled = sampleVisualBoundary(source), boundary = { id: source.id, ...sampled, terrainAreaIds: source.terrainAreaIds }
      const activeLook = { ...look, id: `look-${source.id}`, boundaryId: boundary.id }
      const relief = cliffRelief(boundary, activeLook, 1)
      const base = emptyVisualSystem(), visual = { environment: base.environment, boundsMm: bounds, boundaries: [boundary], edgeLooks: [activeLook],
        materializedEdges: [], transitions: [], lights: [], fogs: [], filters: [], occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [] }
      const projection = { audience: 'gm' as const, sourceRevision: 0, bounds, gridSizeMm: null, rooms: [], terrain: [
        { id: 'high', points: rectangle(0, 0, 12000, 2000), elevationMm: 2600, style: null, priority: 1 },
      ], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [], visual }
      const render = () => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.scale(.1, .1); context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, bounds.width, bounds.height)
        drawVisualBoundaries(context, projection as never)
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const first = render(), second = render(), samples = []
      const middle = Math.floor((relief.strata[0].upper.length - 1) * .57)
      for (const stratum of relief.strata) {
        const a = stratum.upper[middle], b = stratum.upper[middle + 1], c = stratum.lower[middle], d = stratum.lower[middle + 1]
        const x = Math.round((a.x + b.x + c.x + d.x) * .025), y = Math.round((a.y + b.y + c.y + d.y) * .025)
        const index = (y * 1200 + x) * 4
        samples.push([...first.slice(index, index + 3)])
      }
      rows.push({ id: source.id, stable: first.every((value, index) => value === second[index]), layers: new Set(samples.map(color => color.join(','))).size, samples })
    }
    return rows
  })
  for (const row of result) {
    expect(row.stable, `${row.id} relief is deterministic at fixed world coordinates`).toBe(true)
    expect(row.layers, `${row.id} output contains visible cross-face strata`).toBeGreaterThanOrEqual(3)
  }
})

test('derived cliff faces use layered mid-tone rock instead of a flat dark band', async ({ page }) => {
  await page.goto('/')
  const pixels = await page.evaluate(async () => {
    const rendererPath = '/src/platform/browser/render/canvas-renderer.ts'
    const { renderRasterProjection } = await import(rendererPath)
    const rect = (x: number, y: number, right: number, bottom: number) => [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
    const projection: Projection = {
      audience: 'gm', sourceRevision: 0, bounds: { x: 0, y: 0, width: 8000, height: 6000 }, gridSizeMm: null,
      rooms: [], terrain: [
        { id: 'low', points: rect(0, 0, 8000, 6000), style: null, elevationMm: 800, priority: 0 },
        { id: 'high', points: rect(2000, 2000, 6000, 6000), style: null, elevationMm: 2600, priority: 1 },
      ], walls: [], props: [], edges: [{ id: 'cliff', kind: 'cliff', start: { x: 2000, y: 2000 }, end: { x: 6000, y: 2000 },
        sourceAreaId: 'high', neighborAreaId: 'low', elevationMm: 2600, neighborElevationMm: 800, surfaceStyle: null,
        style: { strokeWidthMm: 0, color: '#39443E', bandWidthMm: 1000 }, shoreline: false }],
      paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [],
    }
    const resources = { assetRefs: {}, assets: {}, resources: { read: async () => { throw new Error('No image expected') } } }
    const canvas = await renderRasterProjection(resources, projection, { audience: 'gm', longEdgePx: 800 })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const pixel = (x: number, y: number) => [...ctx.getImageData(Math.round(x / 10), Math.round(y / 10), 1, 1).data]
    return { upper: pixel(4000, 1980), middle: pixel(4000, 1890), lower: pixel(4000, 1740), outside: pixel(4000, 1600) }
  })
  expect(pixels.upper).not.toEqual(pixels.middle)
  expect(pixels.middle).not.toEqual(pixels.lower)
  expect(pixels.middle[0] + pixels.middle[1] + pixels.middle[2]).toBeGreaterThan(300)
  expect(pixels.outside).not.toEqual(pixels.lower)
})
