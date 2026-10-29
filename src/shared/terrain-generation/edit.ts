import { getLegacyGeneration, legacyTerrainView } from './composition-contracts.js'
import { z } from 'zod'
import { surroundingsRequestSchema, surroundingsCurves, captureSurroundingsPreservation, surroundingsEntityHash, surroundingsOutputHash, regenerateSurroundingsScenery, type SurroundingsRequest } from './surroundings.js'
import type { BoundsMm, PointMm, SceneDocument, SurfaceOverlay } from '../model/scene.js'
import type { VisualBoundary } from '../visual/types.js'
import { visualBoundarySchema } from '../visual/schema.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary, visualSampleAtDistance } from '../visual/geometry.js'
import { applyTerrainBoundaryShape } from '../visual/commands.js'
import { polygonDistance, propFootprint, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { sha256Text } from '../geometry/scatter.js'
import { cloneJson, canonicalJson, inspectJsonInput } from '../validation/json.js'
import { sceneDocument3Schema, validateSceneDocument } from '../validation/scene.js'
import { terrainCommandCost } from './cost.js'
import { constraintInputHash, generationInputHash, managedOutputHash, materializedBoundaryHash, resolveGenerationEntity, resolveGenerationTarget } from './integrity.js'
import { terrainTopologyRequestSchema, type GenerationReference, type GenerationSystem2, type GenerationSystem3, type GenerationSystem4, type TerrainTopologyRequest } from './contracts.js'
import { applyTerrainTopology } from './topology.js'
import { normalizeTerrainStroke, terrainStrokePolygon } from './stroke.js'
export { normalizeTerrainStroke } from './stroke.js'

const id = z.string().min(1).max(128).refine(value => value !== '__proto__')
const mm = z.number().int().safe().min(-1_000_000_000).max(1_000_000_000)
const point = z.object({ x: mm, y: mm }).strict()
const bounds = z.object({ x: mm, y: mm, width: mm.positive(), height: mm.positive() }).strict()
const ref = z.object({ id, version: z.number().int().positive() }).strict()
const common = { sceneId: id, operationId: id, floorId: id, scopeMm: bounds, linkMode: z.enum(['contour', 'transitions', 'scenery']) }
const brushSchema = z.object({ ...common, kind: z.literal('brush'), mode: z.enum(['addLand', 'digWater', 'paintGrass', 'clearArea']), targetAreaId: id,
  materialRef: ref.nullable(), elevationMm: mm.nullable(), strokes: z.array(z.object({ pointsMm: z.array(point).min(1).max(512), radiusMm: mm.min(100).max(10000) }).strict()).min(1).max(32) }).strict()
const contourSchema = z.object({ ...common, kind: z.literal('contour'), boundary: visualBoundarySchema }).strict()
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
export const terrainEditRequestSchema = z.discriminatedUnion('kind', [brushSchema, contourSchema, surroundingsRequestSchema, terrainTopologyRequestSchema]).transform(value => value.kind === 'brush'
  ? { ...value, strokes: value.strokes.map(stroke => ({ ...stroke, pointsMm: normalizeTerrainStroke(stroke.pointsMm) })) } : value)
export type TerrainEditRequest = z.infer<typeof terrainEditRequestSchema>
const costSchema = z.object({ items: z.record(z.string(), z.number().int().nonnegative().safe()), total: z.number().int().min(1).max(256), limit: z.literal(256) }).strict().superRefine((cost,ctx)=>{
  if(Object.values(cost.items).reduce((sum,value)=>sum+value,0)!==cost.total)ctx.addIssue({code:'custom',message:'逐项成本与合计不一致。'})
})
const impactSchema = z.object({ writeIds: z.array(z.string()), preservedIds: z.array(z.string()), readIds: z.array(z.string()),
  conflicts: z.array(z.object({ code: z.string(), message: z.string(), entityId: z.string().nullable() }).strict()), writeBoundsMm: bounds, readBoundsMm: bounds }).strict()
export const terrainEditResultSchema = z.object({ request: terrainEditRequestSchema, document: sceneDocument3Schema, cost: costSchema,
  impact: impactSchema, steps: z.array(z.object({ index: z.number().int().nonnegative(), cost: costSchema }).strict()), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().superRefine((result,ctx)=>{
    const expected=result.request.kind==='brush'?result.request.strokes.length:1,cumulative:Record<string,number>={}
    if(result.steps.length!==expected||result.steps.some((step,index)=>step.index!==index))ctx.addIssue({code:'custom',path:['steps'],message:'逐步回执须与本次笔画数量、连续序号一致。'})
    for(const step of result.steps)for(const [key,value]of Object.entries(step.cost.items))cumulative[key]=(cumulative[key]??0)+value
    if(!same(cumulative,result.cost.items)||result.steps.reduce((sum,step)=>sum+step.cost.total,0)!==result.cost.total)ctx.addIssue({code:'custom',path:['cost'],message:'逐步成本累计与最终回执不一致。'})
  })
export type TerrainEditResult = Omit<z.infer<typeof terrainEditResultSchema>, 'document'> & {document:SceneDocument}
export type TerrainEditImpact = z.infer<typeof impactSchema>
const hash = (value: unknown) => sha256Text(canonicalJson(value))
function fail(message: string): never { throw new Error(message) }
const boundsContain=(p:PointMm,b:BoundsMm)=>p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height
function assertWritable(scene: SceneDocument, entityId: string) {
  const visual = visualBase(scene), row = scene.terrainAreas[entityId] ?? scene.props[entityId] ?? scene.terrainConnections[entityId]
    ?? scene.scatterGroups[entityId] ?? scene.prefabInstances[entityId] ?? scene.notes[entityId]
    ?? visual?.boundaries[entityId] ?? visual?.edgeLooks[entityId] ?? getLegacyGeneration(scene)?.rules[entityId]
    ?? (scene.visual?.version === 2 ? scene.visual.materializedEdges[entityId] : undefined)
  const layerId = row && 'layerId' in row && typeof row.layerId==='string' ? row.layerId : scene.entityLayers[entityId]
  if (row && ('editLocked' in row && row.editLocked || scene.userLayers[layerId]?.editLocked)) fail(`对象或图层已锁定，不能联动：${entityId}。`)
}
function assertManaged(scene: SceneDocument, entityId: string, field: GenerationReference['fieldGroup'], explicit = false) {
  const owners = Object.values(getLegacyGeneration(scene)!.ownership).filter(owner => owner.target.entityId === entityId)
  if (!owners.length && !explicit) fail(`人工内容没有自动联动授权：${entityId}。`)
  for (const owner of owners) {
    if (owner.state === 'deleted' || owner.state === 'detached' || owner.manualFields.includes(field)) {
      if (!explicit) fail(`人工、已删除或退出管理的${field}保持，不能自动重做：${entityId}。`)
    }
    assertWritable(scene, owner.ruleId)
  }
  assertWritable(scene, entityId)
}
function generatedId(operationId: string, suffix: string) { return `terrain-edit-${hash(operationId).slice(0, 20)}-${suffix}` }
function allEntityIds(scene: SceneDocument): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown) => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') { const row = value as Record<string, unknown>; if (typeof row.id === 'string') ids.add(row.id); Object.values(row).forEach(walk) } }
  walk(scene); return ids
}
function makeIds(scene: SceneDocument, operationId: string) {
  const used = allEntityIds(scene); let index = 0
  return () => { const id = generatedId(operationId, `geometry-${index++}`); if (used.has(id)) fail('本次操作身份已存在；请建立新的操作。'); used.add(id); return id }
}
function expand(bounds: BoundsMm, distance: number): BoundsMm { return { x: bounds.x - distance, y: bounds.y - distance, width: bounds.width + distance * 2, height: bounds.height + distance * 2 } }
function nearest(p: PointMm, points: readonly PointMm[]): { distance: number; point: PointMm } {
  let best = { distance: Infinity, point: points[0] }
  if (points.length === 1) return { distance: Math.hypot(p.x - points[0].x, p.y - points[0].y), point: points[0] }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
    const at = { x: a.x + dx * t, y: a.y + dy * t }, distance = Math.hypot(p.x - at.x, p.y - at.y)
    if (distance < best.distance) best = { distance, point: at }
  }
  return best
}
function assertScope(points: readonly PointMm[], scope: BoundsMm) { if (points.some(p => !boundsContain(p, scope))) fail('实际写入超出冻结范围；请扩大范围后重新预览。') }
function entityChanges(before: SceneDocument, after: SceneDocument) {
  const records = (scene: SceneDocument) => {
    const generation = getLegacyGeneration(scene)!
    return new Map<string, unknown>([
    ...['terrainAreas','terrainEdges','terrainConnections','paths','props','scatterGroups','regions','notes'].flatMap(key => Object.values(scene[key as 'props'])),
    ...Object.values(visualBase(scene)!.boundaries), ...Object.values(visualBase(scene)!.edgeLooks),
    ...Object.values(scene.visual?.version === 2 ? scene.visual.materializedEdges : {}),
    ...Object.values(generation.recipes),...Object.values(generation.intents),...Object.values(generation.rules),...Object.values(generation.ownership),...Object.values(generation.exclusions),...Object.values(generation.constraints),...Object.values(generation.checks),...Object.values(generation.sourceLinks),...Object.values(generation.version!==1?generation.strokes:{}),
    ...Object.values(generation.version===3||generation.version===4?generation.surroundings:{}),
    ...Object.values(generation.version===4?generation.topology:{}),
  ].map(row => [row.id, row])) }
  const a = records(before), b = records(after)
  return { writeIds: [...new Set([...a.keys(), ...b.keys()])].filter(id => !same(a.get(id) ?? null, b.get(id) ?? null)).sort(), removedIds: [...a.keys()].filter(id => !b.has(id)) }
}
/** Supported rules are refreshed on explicit adoption only. Imports never call this function. */
export function finalizeTerrainEditDocument(scene: SceneDocument, before: SceneDocument): void {
  for (const rule of Object.values(getLegacyGeneration(scene)!.rules)) {
    const inputHash=generationInputHash(scene,rule),outputHash=managedOutputHash(scene,rule)
    if(inputHash===rule.inputHash&&outputHash===rule.managedOutputHash)continue
    assertWritable(before,rule.id)
    const recipe=getLegacyGeneration(scene)!.recipes[rule.recipeRef.id]
    // Refreshing a hash is not an implementation of an arbitrary dependent algorithm.
    const supportedTerrainAlgorithm = (recipe.algorithmId === 'terrain-scene' || recipe.algorithmId === 'terrain-scene-t3') && recipe.algorithmVersion === 1
    if(inputHash!==rule.inputHash||rule.kind!=='terrain'||!supportedTerrainAlgorithm)fail(`相关规则须独立重算，当前局部编辑不支持：${rule.id}。`)
    rule.managedOutputHash=outputHash
  }
  for (const check of Object.values(getLegacyGeneration(scene)!.checks)) if (check.inputHash !== constraintInputHash(scene, check.constraintId)) check.state = 'unchecked'
}
function assertLocalGeometry(before: SceneDocument, next: SceneDocument, scope: BoundsMm): void {
  for (const area of Object.values(next.terrainAreas)) {
    const prior = before.terrainAreas[area.id]
    if (!prior) { assertScope(terrainPoints(area), scope); continue }
    const old = new Map(prior.boundaryMm.map(p => [p.id, p.positionMm])), fresh = new Map(area.boundaryMm.map(p => [p.id, p.positionMm]))
    for (const id of new Set([...old.keys(), ...fresh.keys()])) if (!same(old.get(id) ?? null, fresh.get(id) ?? null)) assertScope([old.get(id), fresh.get(id)].filter((p): p is PointMm => !!p), scope)
  }
  for (const boundary of Object.values(visualBase(next)!.boundaries)) {
    const old = visualBase(before)!.boundaries[boundary.id]
    const looks=Object.values(visualBase(next)!.edgeLooks).filter(look=>look.boundaryId===boundary.id&&look.enabled)
    // All currently drawn edge bands follow the boundary, even in contour mode.
    // Stable arc-length decoration can shift downstream; conservatively cover
    // the full old/new drawn curve rather than claiming the control-point box.
    if(old&&!same(old,boundary)&&looks.length){
      const margin=Math.max(...looks.map(look=>look.widthMm*3+look.repeatMm))
      for(const p of [...sampleVisualBoundary(old).points,...sampleVisualBoundary(boundary).points])assertScope([{x:Math.floor(p.x-margin),y:Math.floor(p.y-margin)},{x:Math.ceil(p.x+margin),y:Math.ceil(p.y+margin)}],scope)
    }
    for (const segment of boundary.segments) {
      const previous = old?.segments.find(row => row.id === segment.id)
      for (const key of ['start', 'control1', 'control2', 'end'] as const) if (!previous || !same(previous[key], segment[key])) assertScope([...(previous ? [previous[key]] : []), segment[key]], scope)
    }
  }
}
function deformBoundary(scene: SceneDocument, request: Extract<TerrainEditRequest, { kind: 'brush' }>, stroke: { pointsMm: PointMm[]; radiusMm: number }): VisualBoundary {
  const area = scene.terrainAreas[request.targetAreaId], matches = Object.values(visualBase(scene)!.boundaries).filter(boundary => boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => side.areaId === area.id))
  if (!matches.length) fail('目标地形还没有可编辑共享曲线，请使用轮廓工具建立明确边界。')
  const candidates = matches.map(boundary => ({ boundary, distance: Math.min(...sampleVisualBoundary(boundary).points.map(p => nearest(p, stroke.pointsMm).distance)) })).sort((a, b) => a.distance - b.distance || a.boundary.id.localeCompare(b.boundary.id))
  const selected = candidates[0]
  if (selected.distance >= stroke.radiusMm) fail('笔画没有碰到目标岸线；请在岸线附近落笔。')
  const next = cloneJson(selected.boundary), samples = sampleVisualBoundary(selected.boundary), side = next.binding.kind === 'terrain' ? next.binding.sides.find(side => side.areaId === area.id)! : fail('目标不是地形共享曲线。')
  const sign = (request.mode === 'addLand' ? 1 : -1) * (side.reverse ? -1 : 1)
  const shift = (p: PointMm): PointMm => {
    const distance = nearest(p, stroke.pointsMm).distance
    if (distance >= stroke.radiusMm) return p
    const at = samples.samples.reduce((best, value) => Math.hypot(p.x - value.positionMm.x, p.y - value.positionMm.y) < Math.hypot(p.x - best.positionMm.x, p.y - best.positionMm.y) ? value : best)
    const amount = Math.round(stroke.radiusMm * .3 * (1 - distance / stroke.radiusMm)) * sign
    return { x: Math.round(p.x + at.tangent.y * amount), y: Math.round(p.y - at.tangent.x * amount) }
  }
  for (const segment of next.segments) for (const key of ['start','control1','control2','end'] as const) segment[key] = shift(segment[key])
  if (same(next, selected.boundary)) fail('笔画范围内没有曲线控制点；请增大半径或使用轮廓拖动。')
  return next
}
function syncMaterializedEdges(before: SceneDocument, next: SceneDocument, boundary: VisualBoundary, scope: BoundsMm): void {
  if (next.visual?.version !== 2 || before.visual?.version !== 2) return
  const previous = visualBase(before)!.boundaries[boundary.id]
  const parts=(curve:VisualBoundary)=>curve.segments.map(segment=>sampleVisualBoundary({...curve,closed:false,segments:[segment]}))
  const oldParts=parts(previous),newParts=parts(boundary)
  for (const edge of Object.values(next.visual.materializedEdges).filter(row => row.boundaryId === boundary.id)) {
    assertManaged(before, edge.id, 'geometry'); assertWritable(before, edge.id)
    const remap = (p: PointMm) => {
      let selected=0,oldAt=nearest(p,oldParts[0].points)
      for(let index=1;index<oldParts.length;index++){const at=nearest(p,oldParts[index].points);if(at.distance<oldAt.distance){selected=index;oldAt=at}}
      if(same(previous.segments[selected],boundary.segments[selected]))return p
      const old=oldParts[selected],fresh=newParts[selected]
      let best=0,distance=Infinity
      for(let index=0;index<old.samples.length;index++){const d=Math.hypot(oldAt.point.x-old.samples[index].positionMm.x,oldAt.point.y-old.samples[index].positionMm.y);if(d<distance){best=index;distance=d}}
      const at=visualSampleAtDistance(fresh,old.samples[best].distanceMm/old.lengthMm*fresh.lengthMm)
      const value = {x:Math.round(p.x+at.positionMm.x-old.samples[best].positionMm.x),y:Math.round(p.y+at.positionMm.y-old.samples[best].positionMm.y)}
      if(!same(p,value))assertScope([p,value],scope)
      return value
    }
    edge.polygons=edge.polygons.map(ring=>ring.map(remap));edge.strokes=edge.strokes.map(stroke=>({...stroke,pointsMm:stroke.pointsMm.map(remap)}));edge.inputHash=materializedBoundaryHash(boundary)
  }
}
function preserveSupport(before: SceneDocument, next: SceneDocument, request: TerrainEditRequest, changedAreaIds: string[]): void {
  const moved: string[] = []
  for (const prop of Object.values(next.props)) {
    if (supportedPolygon(next, propFootprint(prop), prop.supportRef, prop.floorId)) continue
    if (request.kind === 'surroundings' && !request.regenerateScenery) fail(`本次未授权调整自动布景，必须保持物件支撑：${prop.id}。`)
    if (request.linkMode !== 'scenery') fail(`地形将使物件失去支撑：${prop.id}。请保留此段地形或选择连同自动布景重做。`)
    const owner = Object.values(getLegacyGeneration(before)!.ownership).find(owner => owner.target.kind === 'prop' && owner.target.entityId === prop.id)
    if (!owner || !owner.managedFields.includes('geometry') || !owner.managedFields.includes('source') || owner.state === 'deleted' || owner.state === 'detached') fail(`人工物件必须保留原位置与支撑：${prop.id}。`)
    assertManaged(before, prop.id, 'geometry'); assertManaged(before, prop.id, 'source')
    if (Object.values(next.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === prop.id)
      || [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)].some(group => Object.values(group.members).some(member => member.propId === prop.id))) {
      fail(`自动布景仍有注记、组合或散布依赖，请先明确处理：${prop.id}。`)
    }
    const original = cloneJson(prop.positionMm), candidates: PointMm[] = []
    for (const distance of [250,500,750,1000,1500,2000]) for (let direction=0;direction<16;direction++)candidates.push({x:Math.round(original.x+Math.cos(direction*Math.PI/8)*distance),y:Math.round(original.y+Math.sin(direction*Math.PI/8)*distance)})
    let found=false
    for(const position of candidates){
      prop.positionMm=position
      const footprint=propFootprint(prop)
      if(!footprint.every(p=>boundsContain(p,request.scopeMm))||!supportedPolygon(next,footprint,prop.supportRef,prop.floorId))continue
      if(Object.values(next.props).some(other=>other.id!==prop.id&&polygonDistance(footprint,propFootprint(other))<100))continue
      if(Object.values(getLegacyGeneration(next)!.exclusions).some(exclusion=>exclusion.floorId===prop.floorId&&polygonDistance(footprint,exclusion.boundaryMm)<1))continue
      if(Object.values(getLegacyGeneration(next)!.constraints).some(constraint=>constraint.kind==='activityArea'&&constraint.floorId===prop.floorId&&polygonDistance(footprint,constraint.boundaryMm)<constraint.clearanceMm+1))continue
      found=true;break
    }
    if(!found){prop.positionMm=original;fail(`自动布景在冻结范围内没有合法支撑位置：${prop.id}。`)}
    assertScope(propFootprint(before.props[prop.id]),request.scopeMm);moved.push(prop.id)
  }
  // Rooms, routes and connections are physical dependencies; validation below rejects broken support.
  for(const room of Object.values(next.rooms))if(!supportedPolygon(next,room.boundaryVertexIds.map(id=>({x:next.vertices[id].xMm,y:next.vertices[id].yMm})),room.supportRef,room.floorId))fail(`建筑支撑冲突：${room.id}。`)
  void changedAreaIds;void moved
}
function preserveHardActivityAreas(before: SceneDocument, next: SceneDocument): void {
  for (const constraint of Object.values(getLegacyGeneration(next)!.constraints)) {
    if (constraint.strength !== 'hard') continue
    if (constraint.kind === 'preserveGeometry' || constraint.kind === 'preserveEntity') {
      const value = (scene: SceneDocument) => constraint.kind === 'preserveGeometry'
        ? resolveGenerationTarget(scene, { ...constraint.target, fieldGroup: 'geometry' }) : resolveGenerationEntity(scene, constraint.target)
      if (!same(value(before), value(next))) fail(`必须保留明确指定的内容：${constraint.id}。`)
      continue
    }
    if (constraint.kind === 'route') {
      const checked = checkTerrainRoute(next, { floorId: constraint.floorId, pointsMm: constraint.pointsMm, widthMm: constraint.minWidthMm })
      if (!checked.ok) fail(`必须保留路线的完整净宽、转角和真实通行：${constraint.id}。${checked.issues.map(issue => issue.message).join('；')}`)
      const groundOnly = Object.values(getLegacyGeneration(next)!.checks).some(check => check.constraintId === constraint.id && check.algorithmId === 'terrain-route-ground' && check.algorithmVersion === 1)
      if (groundOnly && checked.supportRefs.some(ref => ref.id === 'terrain-shallow')) fail(`必须保留路线只走地面的明确要求：${constraint.id}。`)
      for (const check of Object.values(getLegacyGeneration(next)!.checks)) if (check.constraintId === constraint.id && (check.algorithmId === 'terrain-route' || check.algorithmId === 'terrain-route-ground') && check.algorithmVersion === 1) {
        check.state = 'passed'; check.inputHash = constraintInputHash(next, constraint.id); check.issues = []
      }
      continue
    }
    if (constraint.kind !== 'activityArea') {
      if (constraintInputHash(before, constraint.id) !== constraintInputHash(next, constraint.id)) fail(`路线或端口约束需要完整重验，当前局部编辑不能自动确认：${constraint.id}。`)
      continue
    }
    const support = Object.values(before.terrainAreas).filter(area => area.floorId === constraint.floorId && !area.blocksMovement
      && supportedPolygon(before, constraint.boundaryMm, { kind: 'terrainArea', id: area.id }, area.floorId))
      .sort((a, b) => b.groundElevationMm - a.groundElevationMm || a.id.localeCompare(b.id))[0]
    if (!support || !supportedPolygon(next, constraint.boundaryMm, { kind: 'terrainArea', id: support.id }, constraint.floorId)) {
      fail(`必须保留活动空地的实际地形支撑：${constraint.id}。`)
    }
    for (const prop of Object.values(next.props)) if (prop.floorId === constraint.floorId
      && polygonDistance(propFootprint(prop), constraint.boundaryMm) < constraint.clearanceMm + 1) fail(`活动空地与物件冲突：${constraint.id}/${prop.id}。`)
  }
}
function applyContour(scene: SceneDocument, request: TerrainEditRequest, boundary: VisualBoundary, nextId: () => string): void {
  const before=cloneJson(scene),previous=visualBase(scene)!.boundaries[boundary.id]
  if(!previous||boundary.binding.kind!=='terrain'||previous.binding.kind!=='terrain')fail('仅支持现有地形共享轮廓的有限拖动。')
  if(previous.floorId!==request.floorId)fail('轮廓必须属于本次选择的Floor。')
  if(!same(previous.binding,boundary.binding)||previous.closed!==boundary.closed||!same(previous.segments.map(s=>s.id),boundary.segments.map(s=>s.id)))fail('此操作改变曲线拓扑或绑定；请分步创建新的明确拓扑。')
  assertManaged(scene,boundary.id,'geometry',request.kind==='contour')
  for(const side of previous.binding.sides)assertManaged(scene,side.areaId,'geometry',request.kind==='contour')
  const roots = new Set([boundary.id, ...previous.binding.sides.map(side => side.areaId)])
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && roots.has(note.anchor.entityId))) fail('轮廓有附着注记，请先明确处理附着范围后编辑。')
  // Existing visual edge looks are pure derived bands; contour edits therefore update their real drawn shape.
  for(const look of Object.values(visualBase(scene)!.edgeLooks).filter(row=>row.boundaryId===boundary.id))assertManaged(scene,look.id,'source')
  applyTerrainBoundaryShape(scene,boundary,{ids:{nextId},clock:{now:()=>scene.updatedAt}})
  assertLocalGeometry(before,scene,request.scopeMm)
  syncMaterializedEdges(before,scene,boundary,request.scopeMm)
  preserveSupport(before,scene,request,previous.binding.sides.map(side=>side.areaId))
  if(request.linkMode==='contour')for(const edge of Object.values(scene.visual?.version===2?scene.visual.materializedEdges:{}))if(edge.boundaryId===boundary.id&&!same(before.visual?.version===2?before.visual.materializedEdges[edge.id]:null,edge))fail('只改轮廓不能隐式重写物化过渡，请选择相关过渡。')
}
function deleteManagedProp(scene:SceneDocument,propId:string):void{
  const prop=scene.props[propId],owner=Object.values(getLegacyGeneration(scene)!.ownership).find(owner=>owner.target.kind==='prop'&&owner.target.entityId===propId)
  if(!owner||owner.state!=='managed'||owner.manualFields.length||!owner.managedFields.includes('geometry'))return
  assertWritable(scene,propId);assertWritable(scene,owner.ruleId)
  if(Object.values(scene.notes).some(note=>note.anchor.type==='entity'&&note.anchor.entityId===propId)||Object.values(scene.prefabInstances).some(group=>Object.values(group.members).some(member=>member.propId===propId)))fail(`自动物件仍有注记或组合依赖：${propId}。`)
  for(const group of Object.values(scene.scatterGroups))for(const member of Object.values(group.members))if(member.propId===propId){assertWritable(scene,group.id);member.propId=null;member.state='deleted';member.overrideFields=[]}
  const exclusionId=generatedId(owner.outputKey,'deleted')
  getLegacyGeneration(scene)!.exclusions[exclusionId]={id:exclusionId,key:owner.outputKey,floorId:prop.floorId,visibility:prop.visibility,boundaryMm:propFootprint(prop).map(p=>({x:Math.round(p.x),y:Math.round(p.y)})),reason:'delete',candidateKey:owner.outputKey,birthToken:owner.birthToken}
  owner.state='deleted';owner.managedFields=[];delete scene.props[propId];delete scene.entityLayers[propId]
}
function applyBrush(scene:SceneDocument,request:Extract<TerrainEditRequest,{kind:'brush'}>,stroke:{pointsMm:PointMm[];radiusMm:number},index:number,nextId:()=>string):void{
  const area=scene.terrainAreas[request.targetAreaId]
  if(!area||area.floorId!==request.floorId)fail('请选择同Floor现存目标地形。')
  assertManaged(scene,area.id,'exclusions',true)
  const polygon=terrainStrokePolygon(stroke)
  assertScope(polygon,request.scopeMm)
  if(polygon.some(p=>!boundsContain(p,scene.floors[request.floorId].boundsMm)))fail('笔刷实际范围超出Floor。')
  if(request.mode==='addLand'||request.mode==='digWater'){
    if(area.blocksMovement)fail('添陆/挖水请选择陆地侧地形，水域将沿同一共享岸线更新。')
    if(request.elevationMm!==null&&request.elevationMm!==area.groundElevationMm)fail('局部推岸不能同时暗改整块地形高程，请保持目标高程。')
    if(request.materialRef&&!same(request.materialRef,area.surfaceStyle?.base.materialRef??null))fail('局部推岸保留目标材质，请另用铺草覆盖修改局部外观。')
    applyContour(scene,request,deformBoundary(scene,request,stroke),nextId)
  }else if(request.mode==='paintGrass'){
    assertManaged(scene,area.id,'surface',true)
    const material=request.materialRef&&scene.materials[request.materialRef.id]
    if(!material||material.version!==request.materialRef!.version||!material.applicableSurfaces.includes('terrain'))fail('铺草需要工程中同版本、可用于地形的固定材质。')
    if(!area.surfaceStyle)fail('目标地形没有明确底材。')
    if(!supportedPolygon(scene,polygon,{kind:'terrainArea',id:area.id},area.floorId))fail('铺草范围必须完整位于目标地形内，请缩小半径或分步铺设。')
    const overlay:SurfaceOverlay={id:generatedId(request.operationId,`overlay-${index}`),boundaryMm:polygon,paint:{...cloneJson(area.surfaceStyle.base),materialRef:cloneJson(request.materialRef!),tileSizeMm:cloneJson(material.defaultTileSizeMm),alignment:'world',originMm:{x:0,y:0}},blendWidthMm:Math.min(120,Math.floor(stroke.radiusMm/8)),renderOrder:Math.max(-1,...area.surfaceStyle.overlays.map(row=>row.renderOrder))+1}
    area.surfaceStyle.overlays.push(overlay)
  }else{
    const exclusionId=generatedId(request.operationId,`clear-${index}`)
    getLegacyGeneration(scene)!.exclusions[exclusionId]={id:exclusionId,key:exclusionId,floorId:request.floorId,visibility:area.visibility,boundaryMm:polygon,reason:'manual',candidateKey:null,birthToken:null}
    for(const prop of Object.values(scene.props))if(prop.floorId===request.floorId&&polygonDistance(propFootprint(prop),polygon)<1){
      const footprint=propFootprint(prop),owner=Object.values(getLegacyGeneration(scene)!.ownership).find(owner=>owner.target.kind==='prop'&&owner.target.entityId===prop.id)
      if(owner?.state==='managed'&&!owner.manualFields.length&&!prop.editLocked&&!scene.userLayers[scene.entityLayers[prop.id]]?.editLocked){assertScope(footprint,request.scopeMm);deleteManagedProp(scene,prop.id)}
    }
  }
  const system=scene.generation as GenerationSystem2,strokeId=generatedId(request.operationId,`stroke-${index}`)
  system.strokes[strokeId]={id:strokeId,operationId:request.operationId,strokeIndex:index,floorId:request.floorId,visibility:area.visibility,brush:request.mode,targetAreaId:request.targetAreaId,pointsMm:cloneJson(stroke.pointsMm),radiusMm:stroke.radiusMm,scopeMm:cloneJson(request.scopeMm),linkMode:request.linkMode,materialRef:cloneJson(request.materialRef),elevationMm:request.elevationMm,algorithmId:'terrain-edit',algorithmVersion:1}
}
function applySurroundings(scene:SceneDocument,request:SurroundingsRequest,nextId:()=>string):void {
  const before=cloneJson(scene),preserved=captureSurroundingsPreservation(before,request)
  if(preserved.length>256)fail('外围保全内容超过256项；请缩小独立工程，不隐式省略依赖。')
  const curves=surroundingsCurves(before,request)
  for(const boundary of curves)if(!same(boundary,visualBase(scene)!.boundaries[boundary.id]))applyContour(scene,request,boundary,nextId)
  regenerateSurroundingsScenery(scene,before,request)
  for(const row of preserved)if(surroundingsEntityHash(scene,row.collection,row.entityId)!==row.contentHash)fail(`外围重生成必须保持既有建筑、院路和人工内容：${row.entityId}。`)
  if(same(scene.terrainAreas,before.terrainAreas)&&same(scene.props,before.props))fail('当前范围内没有可重生成的自动内容；请扩大范围或选择另一条轮廓。')
  if(scene.generation!.version===2)scene.generation={...scene.generation!,version:3,surroundings:{}}
  const generation=scene.generation as GenerationSystem3
  for(const row of Object.values(generation.surroundings))row.state='historical'
  const id=generatedId(request.operationId,'surroundings')
  const row={id,operationId:request.operationId,floorId:request.floorId,visibility:'gm' as const,algorithmId:'terrain-surroundings' as const,algorithmVersion:1 as const,seed:request.seed,scopeMm:cloneJson(request.scopeMm),maxDisplacementMm:request.maxDisplacementMm,boundaryIds:cloneJson(request.boundaryIds),regenerateScenery:request.regenerateScenery,preserved,state:'current' as const,inputHash:hash({request,preserved}),outputHash:''}
  row.outputHash=surroundingsOutputHash(scene,row);generation.surroundings[id]=row
}
function applyTopology(scene: SceneDocument, request: TerrainTopologyRequest): void {
  const before = cloneJson(scene)
  const result = applyTerrainTopology(scene, request)
  const base = getLegacyGeneration(scene)!
  const generation: GenerationSystem4 = base.version === 4 ? base : base.version === 3 ? { ...base, version: 4, topology: {} } : { ...base, version: 4, strokes: base.version === 1 ? {} : base.strokes, surroundings: {}, topology: {} }
  scene.generation = generation
  for (const row of Object.values(generation.surroundings)) row.state = 'historical'
  for (const row of Object.values(generation.topology)) row.state = 'historical'
  const id = generatedId(request.operationId, 'topology')
  generation.topology[id] = { id, floorId: request.floorId, visibility: 'gm', algorithmId: 'terrain-boolean', algorithmVersion: 1, request: cloneJson(request), inputs: request.areaIds.map(entityId => ({ entityId, contentHash: hash(before.terrainAreas[entityId]), boundaryMm: terrainPoints(before.terrainAreas[entityId]) })), outputAreaIds: result.outputAreaIds, componentCount: result.componentCount, holeCount: result.holeCount, state: 'current', inputHash: result.inputHash, outputHash: result.outputHash }
}
/** Current materialized geometry is authoritative. Never regenerates from the original seed. */
export function prepareTerrainEdit(base:SceneDocument,input:TerrainEditRequest):TerrainEditResult{
  const jsonIssue=inspectJsonInput(input);if(jsonIssue)fail(jsonIssue.message)
  const request=terrainEditRequestSchema.parse(input),valid=validateSceneDocument(base)
  if(!valid.ok)fail(`地形编辑基线无效：${valid.errors.map(error=>error.message).join('；')}`)
  if(base.schemaVersion!==3||base.mapMode!=='scene'||base.visual?.version!==2||!base.generation)fail('地形编辑需要完整v3场景地图。')
  if(request.sceneId!==base.sceneId||!base.floors[request.floorId])fail('地形编辑绑定的工程或Floor已变化。')
  if(![request.scopeMm.x,request.scopeMm.y,request.scopeMm.x+request.scopeMm.width,request.scopeMm.y+request.scopeMm.height].every(Number.isSafeInteger))fail('冻结范围不是安全整数。')
  const existingIds=allEntityIds(base)
  if([...existingIds].some(id=>id.startsWith(`terrain-edit-${hash(request.operationId).slice(0,20)}-`)))fail('本次操作派生身份已存在，请重新开始操作。')
  // The v3-only guard above precedes this compatibility typing; a native-v4
  // view is never installed or saved by the legacy editing entry point.
  const scene=cloneJson(legacyTerrainView(base)),nextId=makeIds(base,request.operationId),steps:TerrainEditResult['steps']=[],items:Record<string,number>={}
  if(scene.generation!.version===1)scene.generation={...scene.generation!,version:2,strokes:{}}
  if(Object.values(scene.generation!.strokes).some(stroke=>stroke.operationId===request.operationId))fail('本次笔画身份已经采用，请重新开始操作。')
  const run=(index:number,apply:()=>void)=>{
    const before=index===0?base:cloneJson(scene)
    if(scene.generation!.version>=3)for(const row of Object.values((scene.generation as GenerationSystem3|GenerationSystem4).surroundings))row.state='historical'
    apply();preserveHardActivityAreas(before,scene);finalizeTerrainEditDocument(scene,before)
    const cost=terrainCommandCost(before,scene)
    if(!cost.total){cost.items.noOp=1;cost.total=1}
    steps.push({index,cost:{...cost,limit:256}})
    for(const [key,value]of Object.entries(cost.items))items[key]=(items[key]??0)+value
    const total=Object.values(items).reduce((a,b)=>a+b,0)
    if(total>256)fail(`本次逐笔累计展开${total}，超过256；请缩短笔画或减少细节。`)
    const check=validateSceneDocument(scene);if(!check.ok)fail(`地形候选冲突：${check.errors.map(error=>`${error.code} ${error.message}`).join('；')}`)
  }
  if(request.kind==='contour')run(0,()=>applyContour(scene,request,request.boundary,nextId))
  else if(request.kind==='surroundings')run(0,()=>applySurroundings(scene,request,nextId))
  else if(request.kind==='topology')run(0,()=>applyTopology(scene,request))
  else request.strokes.forEach((stroke,index)=>run(index,()=>applyBrush(scene,request,stroke,index,nextId)))
  const changes=entityChanges(base,scene),preservedIds=['vertices','rooms','walls','openings','paths','terrainConnections','props','notes','prefabInstances','scatterGroups'].flatMap(key=>Object.values(base[key as 'props']).filter(row=>same(row,scene[key as 'props'][row.id]??null)).map(row=>row.id)).sort()
  const readIds=[...new Set([...allEntityIds(base),...changes.writeIds,...Object.values(base.terrainConnections).map(connection=>connection.id),...Object.values(base.props).map(prop=>prop.id),...Object.values(getLegacyGeneration(base)!.rules).map(rule=>rule.id)])].sort()
  const floorBounds=Object.values(base.floors).map(floor=>floor.boundsMm),left=Math.min(...floorBounds.map(bounds=>bounds.x)),top=Math.min(...floorBounds.map(bounds=>bounds.y)),right=Math.max(...floorBounds.map(bounds=>bounds.x+bounds.width)),bottom=Math.max(...floorBounds.map(bounds=>bounds.y+bounds.height))
  const impact={writeIds:changes.writeIds,preservedIds,readIds,conflicts:[],writeBoundsMm:cloneJson(request.scopeMm),readBoundsMm:expand({x:left,y:top,width:right-left,height:bottom-top},Math.max(2000,...Object.values(visualBase(base)!.edgeLooks).map(look=>look.widthMm),...Object.values(base.props).map(prop=>Math.max(Math.abs(prop.visualBoundsMm.x),Math.abs(prop.visualBoundsMm.y),Math.abs(prop.visualBoundsMm.x+prop.visualBoundsMm.width),Math.abs(prop.visualBoundsMm.y+prop.visualBoundsMm.height))+(prop.shadowOverride?.offsetMm??0)+(prop.shadowOverride?.blurMm??0)),...(request.kind==='brush'?request.strokes.map(stroke=>stroke.radiusMm):[0])))}
  const cost={items,total:Object.values(items).reduce((a,b)=>a+b,0),limit:256 as const}
  return {request,document:scene,cost,impact,steps,hash:hash({request,document:scene,cost,impact,steps})}
}
