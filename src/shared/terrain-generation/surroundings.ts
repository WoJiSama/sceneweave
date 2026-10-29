import { getLegacyGeneration } from './composition-contracts.js'
import { z } from 'zod'
import type { BoundsMm, PointMm, Prop, SceneDocument } from '../model/scene.js'
import type { SurroundingsOperation } from './contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { corridor, openingEndpoints, pathPolygon, pointInPolygon, polygonDistance, propFootprint, roomPoints, supportedPolygon } from '../geometry/geometry.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { terrainRandomUnit } from './field.js'
import type { VisualBoundary } from '../visual/types.js'

const id = z.string().min(1).max(128).refine(value => value !== '__proto__')
const mm = z.number().int().safe().min(-1_000_000_000).max(1_000_000_000)
export const surroundingsRequestSchema = z.object({ kind: z.literal('surroundings'), sceneId: id, operationId: id, floorId: id,
  scopeMm: z.object({ x: mm, y: mm, width: mm.positive(), height: mm.positive() }).strict(), linkMode: z.literal('scenery'),
  seed: z.string().min(1).max(128), maxDisplacementMm: mm.min(10).max(1500),
  boundaryIds: z.array(id).min(1).max(32).refine(ids => new Set(ids).size === ids.length), regenerateScenery: z.boolean(),
}).strict()
export type SurroundingsRequest = z.infer<typeof surroundingsRequestSchema>
const hash = (value: unknown) => sha256Text(canonicalJson(value))
const preservedCollections = ['vertices', 'rooms', 'walls', 'openings', 'paths', 'terrainConnections', 'props', 'notes', 'prefabInstances', 'scatterGroups'] as const
const contains = (p: PointMm, b: BoundsMm, margin = 0) => p.x >= b.x + margin && p.y >= b.y + margin && p.x <= b.x + b.width - margin && p.y <= b.y + b.height - margin
const pointRingDistance = (p: PointMm, ring: PointMm[]) => {
  if (pointInPolygon(p, ring)) return 0
  let best = Infinity
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index], b = ring[(index + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1, dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

export function canRegenerateProp(scene: SceneDocument, prop: Prop): boolean {
  const owner = Object.values(getLegacyGeneration(scene)!.ownership).find(row => row.target.kind === 'prop' && row.target.entityId === prop.id)
  if (!owner || owner.state !== 'managed' || owner.manualFields.length || !owner.managedFields.includes('geometry') || !owner.managedFields.includes('source') || prop.editLocked || scene.userLayers[scene.entityLayers[prop.id]]?.editLocked) return false
  const rule = getLegacyGeneration(scene)!.rules[owner.ruleId]
  if (!rule || rule.state !== 'active' || rule.editLocked || scene.userLayers[rule.layerId]?.editLocked) return false
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === prop.id)) return false
  if ([...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(group => Object.values(group.members).some(member => member.propId === prop.id))) return false
  return true
}
export function propVisualPolygon(prop: Prop): PointMm[] {
  const b = prop.visualBoundsMm, angle = prop.rotationDeg * Math.PI / 180
  return [{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p => ({x:prop.positionMm.x+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:prop.positionMm.y+p.x*Math.sin(angle)+p.y*Math.cos(angle)}))
}
/** Fixed geometry is read before generating; it is never pasted onto a replacement map. */
export function surroundingsProtectedPolygons(scene: SceneDocument, floorId: string): PointMm[][] {
  const result = Object.values(scene.rooms).filter(row => row.floorId === floorId).map(room => roomPoints(scene, room))
  for (const wall of Object.values(scene.walls).filter(row => row.floorId === floorId)) {
    const a=scene.vertices[wall.startVertexId],b=scene.vertices[wall.endVertexId]
    result.push(corridor({x:a.xMm,y:a.yMm},{x:b.xMm,y:b.yMm},wall.thicknessMm*2,true))
  }
  for (const path of Object.values(scene.paths).filter(row => row.floorId === floorId)) result.push(pathPolygon(path))
  for (const row of Object.values(scene.terrainConnections).filter(row => row.floorId === floorId)) result.push(corridor(row.from.positionMm,row.to.positionMm,row.widthMm+600,true))
  for (const door of Object.values(scene.openings).filter(row => row.floorId === floorId && row.kind === 'door')) {
    const [a,b]=openingEndpoints(scene,door);result.push(corridor(a,b,2400,true))
  }
  for (const row of Object.values(getLegacyGeneration(scene)!.constraints)) if(row.floorId===floorId) {
    if(row.kind==='activityArea') result.push(row.boundaryMm)
    if(row.kind==='route') for(let i=1;i<row.pointsMm.length;i++)result.push(corridor(row.pointsMm[i-1],row.pointsMm[i],row.minWidthMm+600,true))
  }
  return result.filter(ring=>ring.length>=3)
}
export function captureSurroundingsPreservation(scene: SceneDocument, request: SurroundingsRequest): SurroundingsOperation['preserved'] {
  return preservedCollections.flatMap(collection => Object.values(scene[collection]).filter(row => row.floorId === request.floorId && (collection!=='props' || !request.regenerateScenery || !canRegenerateProp(scene,row as Prop))).map(row=>({collection,entityId:row.id,contentHash:surroundingsEntityHash(scene,collection,row.id)})))
    .sort((a,b)=>a.collection.localeCompare(b.collection)||a.entityId.localeCompare(b.entityId))
}
export function surroundingsEntityHash(scene: SceneDocument, collection: SurroundingsOperation['preserved'][number]['collection'], id: string): string {
  return hash({entity:scene[collection][id]??null,layerId:scene.entityLayers[id]??null})
}
export function surroundingsOutputHash(scene: SceneDocument, row: Pick<SurroundingsOperation,'boundaryIds'|'scopeMm'|'floorId'>): string {
  const base=visualBase(scene)!
  return hash({boundaries:row.boundaryIds.map(id=>base.boundaries[id]??null),
    areas:row.boundaryIds.flatMap(id=>{const curve=base.boundaries[id];return curve?.binding.kind==='terrain'?curve.binding.sides.map(side=>scene.terrainAreas[side.areaId]??null):[]}),
    props:Object.values(scene.props).filter(prop=>prop.floorId===row.floorId&&contains(prop.positionMm,row.scopeMm)).sort((a,b)=>a.id.localeCompare(b.id))})
}
export function surroundingsCurves(scene: SceneDocument, request: SurroundingsRequest): VisualBoundary[] {
  const protectedPolygons = surroundingsProtectedPolygons(scene,request.floorId)
  for(const prop of Object.values(scene.props))if(prop.floorId===request.floorId&&(!request.regenerateScenery||!canRegenerateProp(scene,prop)))protectedPolygons.push(propFootprint(prop),propVisualPolygon(prop))
  return request.boundaryIds.map(id=>{
    const curve=visualBase(scene)!.boundaries[id]
    if(!curve||curve.floorId!==request.floorId||curve.binding.kind!=='terrain')throw new Error('外围重生成需要同Floor的现存地形轮廓。')
    const next=cloneJson(curve), sampled=sampleVisualBoundary(curve)
    const margin=Math.max(300,...Object.values(visualBase(scene)!.edgeLooks).filter(look=>look.boundaryId===id&&look.enabled).map(look=>look.widthMm*3+look.repeatMm))
    const shift=(p:PointMm):PointMm=>{
      if(!contains(p,request.scopeMm,margin+request.maxDisplacementMm)||protectedPolygons.some(ring=>pointRingDistance(p,ring)<request.maxDisplacementMm+margin))return p
      const nearest=sampled.samples.reduce((best,row)=>Math.hypot(row.positionMm.x-p.x,row.positionMm.y-p.y)<Math.hypot(best.positionMm.x-p.x,best.positionMm.y-p.y)?row:best)
      const amount=(terrainRandomUnit(request.seed,`surroundings/${id}/${p.x}/${p.y}`)*2-1)*request.maxDisplacementMm
      return {x:Math.round(p.x+nearest.tangent.y*amount),y:Math.round(p.y-nearest.tangent.x*amount)}
    }
    for(const segment of next.segments)for(const key of ['start','control1','control2','end'] as const)segment[key]=shift(segment[key])
    return next
  })
}
/** Reuses stable live IDs and all non-geometry fields; never revives a deleted output. */
export function regenerateSurroundingsScenery(scene: SceneDocument, before: SceneDocument, request: SurroundingsRequest): void {
  if(!request.regenerateScenery)return
  const protectedPolygons=surroundingsProtectedPolygons(scene,request.floorId)
  const exclusions=Object.values(getLegacyGeneration(scene)!.exclusions).filter(row=>row.floorId===request.floorId).map(row=>row.boundaryMm)
  for(const prop of Object.values(scene.props).sort((a,b)=>a.id.localeCompare(b.id))){
    if(prop.floorId!==request.floorId||!canRegenerateProp(before,prop)||!propVisualPolygon(prop).every(p=>contains(p,request.scopeMm))||!propFootprint(prop).every(p=>contains(p,request.scopeMm)))continue
    const owner=Object.values(getLegacyGeneration(before)!.ownership).find(row=>row.target.entityId===prop.id)!
    const rule=getLegacyGeneration(before)!.rules[owner.ruleId]
    if(rule.editLocked||before.userLayers[rule.layerId]?.editLocked)throw new Error(`外围自动布景规则已锁定：${rule.id}。`)
    const original=cloneJson(prop.positionMm)
    for(let index=0;index<48;index++){
      prop.positionMm={x:Math.round(original.x+(terrainRandomUnit(request.seed,`${owner.outputKey}/${index}/x`)*2-1)*1800),y:Math.round(original.y+(terrainRandomUnit(request.seed,`${owner.outputKey}/${index}/y`)*2-1)*1800)}
      const footprint=propFootprint(prop),visual=propVisualPolygon(prop)
      if(![...footprint,...visual].every(p=>contains(p,request.scopeMm))||!supportedPolygon(scene,footprint,prop.supportRef,prop.floorId))continue
      if(protectedPolygons.some(ring=>polygonDistance(footprint,ring)<300||polygonDistance(visual,ring)<200)||exclusions.some(ring=>polygonDistance(footprint,ring)<1))continue
      if(Object.values(scene.props).some(other=>other.id!==prop.id&&other.floorId===prop.floorId&&polygonDistance(footprint,propFootprint(other))<300))continue
      break
    }
    const footprint=propFootprint(prop),visual=propVisualPolygon(prop)
    if(![...footprint,...visual].every(p=>contains(p,request.scopeMm))||!supportedPolygon(scene,footprint,prop.supportRef,prop.floorId)||protectedPolygons.some(ring=>polygonDistance(footprint,ring)<300||polygonDistance(visual,ring)<200)||exclusions.some(ring=>polygonDistance(footprint,ring)<1)||Object.values(scene.props).some(other=>other.id!==prop.id&&other.floorId===prop.floorId&&polygonDistance(footprint,propFootprint(other))<300))prop.positionMm=original
  }
}
