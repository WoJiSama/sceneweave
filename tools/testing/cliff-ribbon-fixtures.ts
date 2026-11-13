import { createVisualBlankDocument } from '../../src/platform/browser/content/visual-samples.js'
import type { PointMm, SceneDocument, TerrainArea } from '../../src/shared/model/scene.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { sampleVisualBoundary } from '../../src/shared/visual/geometry.js'
import type { VisualBoundary, VisualEdgeLook } from '../../src/shared/visual/types.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'

/** Held-out shapes and seeds; independent of the reference island recipe. */
export function cliffRibbonFixture(kind: 'headland' | 'crater'): SceneDocument {
  const scene = createVisualBlankDocument({ title: `连续崖面独立检查 · ${kind}`, widthMm: 20000, heightMm: 16000,
    preset: 'narrative', sceneId: `ribbon-held-out-${kind}`, now: '2026-11-12T00:00:00.000Z', gridVisible: false })
  const floorId = 'visual-floor', layerId = 'visual-layer-details', visual = visualBase(scene)!
  const p = (x: number, y: number) => ({ x, y })
  const rect = (x: number, y: number, w: number, h: number) => [p(x,y),p(x+w,y),p(x+w,y+h),p(x,y+h)]
  const material = Object.values(scene.materials)[0]
  const style = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm },
    rotationDeg: 0, alignment: 'world' as const, originMm: p(0,0), tint: null, opacity: 1 }, overlays: [] }
  const area = (id: string, points: PointMm[], elevation: number, priority: number): TerrainArea => {
    const value: TerrainArea = { id, floorId, editLocked: false, visibility: 'public',
      boundaryMm: points.map((positionMm,i)=>({ id:`${id}-p-${i}`, segmentId:`${id}-s-${i}`, positionMm })),
      groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: structuredClone(style),
      blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainAreas[id] = value; scene.entityLayers[id] = 'visual-layer-ground'; return value
  }
  const add = (id: string, points: PointMm[], bound: TerrainArea, side: 'left' | 'right', closed: boolean) => {
    const boundary: VisualBoundary = { id, floorId, layerId, editLocked: false, visibility: 'public', closed,
      segments: points.slice(0,closed?undefined:-1).map((start,i)=>{const end=points[(i+1)%points.length];return {id:`${id}-c-${i}`,start,control1:start,control2:end,end}}),
      sampleSpacingMm: 800, toleranceMm: 20, binding: { kind: 'decoration' } }
    const samples = sampleVisualBoundary(boundary)
    // The saved terrain uses the identical quantized polyline, not a visual
    // approximation that could hide an unsupported crossing.
    if (closed) bound.boundaryMm = samples.points.map((positionMm,i)=>({id:`${bound.id}-p-${i}`,segmentId:`${bound.id}-s-${i}`,positionMm}))
    visual.boundaries[id] = boundary
    const look: VisualEdgeLook = { id:`${id}-cliff`, floorId, layerId, editLocked:false,visibility:'public',boundaryId:id,
      kind:'cliff',side,widthMm:1200,color:'#788493',accentColor:'#dec69b',opacity:1,intensity:1,
      repeatMm:370,seed:`held-out-${kind}-651`,renderProfile:'rockRelief5',enabled:true }
    visual.edgeLooks[look.id] = look
    return boundary
  }
  area('substrate',rect(0,0,20000,16000),kind==='crater'?4000:0,0)
  if (kind==='headland') {
    const points=[p(3500,3500),p(9800,2600),p(14700,3900),p(15500,6500),p(12300,6800),p(15100,9100),p(14000,12100),p(9000,11200),p(7100,12800),p(4200,10500),p(5300,7600)]
    const land=area('independent-headland',points,2700,1), whole=add('whole-source',points,land,'right',true)
    delete visual.boundaries[whole.id];delete visual.edgeLooks[`${whole.id}-cliff`]
    const sampled=sampleVisualBoundary(whole).points, cut=sampled.findIndex(a=>a.x===15100&&a.y===9100)
    const first=add('part-a',[...points.slice(0,6)],land,'right',false)
    const second=add('part-b',[...points.slice(5),points[0]],land,'right',false)
    first.binding={kind:'terrain',sides:[{areaId:land.id,startPointId:land.boundaryMm[0].id,endPointId:land.boundaryMm[cut].id,reverse:false}]}
    second.binding={kind:'terrain',sides:[{areaId:land.id,startPointId:land.boundaryMm[cut].id,endPointId:land.boundaryMm[0].id,reverse:false}]}
    // Deliberately interleaved by the production projection's stable paint sort.
    for(const b of [first,second]){const {renderProfile:_profile,...source}=visual.edgeLooks[`${b.id}-cliff`];visual.edgeLooks[`${b.id}-shore`]={...source,id:`${b.id}-shore`,kind:'shore',widthMm:100,color:'#ccd8c7',accentColor:'#f1efd2',opacity:.45}}
    scene.terrainConnections['actual-stair']={id:'actual-stair',floorId,visibility:'public',editLocked:false,kind:'stairs',
      from:{surfaceRef:{kind:'terrainArea',id:'substrate'},positionMm:p(17500,5200)},to:{surfaceRef:{kind:'terrainArea',id:land.id},positionMm:p(13600,5200)},
      widthMm:1500,openingId:null,blocksMovement:false,movementCostMultiplier:1,surfaceStyle:structuredClone(style)}
    scene.entityLayers['actual-stair']=layerId
  } else {
    const low=area('positive-crater', [p(5200,4700),p(12700,4100),p(14100,8000),p(10700,7600),p(11900,11200),p(5900,10700)],1800,1)
    const b=add('crater-inner-face',low.boundaryMm.map(p=>p.positionMm),low,'left',true)
    b.binding={kind:'terrain',sides:[{areaId:low.id,startPointId:low.boundaryMm[0].id,endPointId:low.boundaryMm[0].id,reverse:false}]}
  }
  const checked=validateSceneDocument(scene)
  if(!checked.ok)throw new Error(JSON.stringify(checked.errors))
  return checked.document
}
