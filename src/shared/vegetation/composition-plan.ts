import { z } from 'zod'
import type { AppearanceGraph } from '../model/appearance.js'
import type { Editable, PointMm, Prop, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { assertCommandBudget, MANUAL_TRANSACTION_BUDGET, measureCommandBudget } from '../budget/command-budget.js'
import { definitionPresentation, propPaintPolygon, propPresentation } from '../appearance/presentation.js'
import { connectionFootprint, corridor, openingEndpoints, pathPolygon, polygonDistance, polygonInside, propFootprint, roomPoints, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { wallEnvelopePolygons } from '../geometry/doorway-clearance.js'
import { canonicalJson, captureJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { nativeAppearanceGraphSchema } from '../validation/content.js'
import { validateSceneDocument } from '../validation/scene.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'
import { id, nonnegative, point, positive, versionRef } from '../validation/primitives.js'

export const VEGETATION_COMPOSITION_CHANNELS = ['mainTrees', 'secondaryTrees', 'shrubs', 'grass'] as const
export type VegetationCompositionChannel = typeof VEGETATION_COMPOSITION_CHANNELS[number]
const palette = z.array(z.object({ key: id, propDefinitionRef: versionRef, weight: positive }).strict()).min(1).max(12)
  .refine(rows => new Set(rows.map(row => row.key)).size === rows.length, 'palette key不能重复')
const channel = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), palette, densityFactor: z.number().finite().min(0).max(1), cellSizeMm: positive, minDistanceMm: positive }).strict(),
])
const margins = { footprintMarginMm: nonnegative.max(10_000), paintMarginMm: nonnegative.max(10_000) }
const avoidanceRef = z.object({ kind: z.enum(['terrainArea', 'room', 'wall', 'opening', 'path', 'terrainConnection', 'region', 'prop']), id }).strict()
export const vegetationCompositionRequestSchema = z.object({ version: z.literal(1), operationId: id, floorId: id, areaId: id, layerId: id,
  visibility: z.enum(['public', 'gm']), seed: z.string().min(1).max(128),
  channels: z.object({ mainTrees: channel, secondaryTrees: channel, shrubs: channel, grass: channel }).strict(),
  clearings: z.array(z.object({ boundaryMm: z.array(point).min(3).max(128), ...margins }).strict()).max(16),
  avoidances: z.array(z.object({ ref: avoidanceRef, ...margins }).strict()).max(32),
}).strict()
export type VegetationCompositionRequest = z.infer<typeof vegetationCompositionRequestSchema>
export interface VegetationCompositionContext extends PreparationContext {
  /** Exact fixed paint inputs from the complete project; never an exemption from validation. */
  appearance: AppearanceGraph
  signal?: { readonly aborted: boolean }
}
export interface VegetationCompositionPlan {
  commands: SceneCommand[]
  inputHash: string
  dependencies: { kind: string; id: string }[]
  channelSummary: { key: VegetationCompositionChannel; groupId: string | null; densityFactor: number; exclusionCount: number; createdMembers: number }[]
}
interface Protection { points: PointMm[]; footprintMarginMm: number; paintMarginMm: number }
const rectangle = (left: number, top: number, right: number, bottom: number): PointMm[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
]
function paddedBounds(points: PointMm[], padding: number): PointMm[] {
  const values = [Math.floor(Math.min(...points.map(p => p.x)) - padding), Math.floor(Math.min(...points.map(p => p.y)) - padding),
    Math.ceil(Math.max(...points.map(p => p.x)) + padding), Math.ceil(Math.max(...points.map(p => p.y)) + padding)]
  if (!values.every(Number.isSafeInteger)) throw new Error('群落排除范围超过安全整数毫米。')
  return rectangle(values[0], values[1], values[2], values[3])
}
const cancelled = (context: VegetationCompositionContext) => { if (context.signal?.aborted) throw new Error('群落编排已取消，保留当前工程。') }

/** New groups only. The returned native commands create persisted real members;
 * Workspace still owns complete identity/resource validation, checkpoint and adoption.
 * Existing groups are edited through ordinary configure/regenerate commands. */
export function buildVegetationCompositionPlan(input: SceneDocument, raw: unknown, context: VegetationCompositionContext): VegetationCompositionPlan {
  cancelled(context)
  const request = vegetationCompositionRequestSchema.parse(captureJson(raw)), checked = validateSceneDocument(input)
  if (!checked.ok) throw new Error(`群落基线无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const scene = checked.document, appearance = nativeAppearanceGraphSchema.parse(captureJson(context.appearance)) as AppearanceGraph
  const area = scene.terrainAreas[request.areaId], layer = scene.userLayers[request.layerId]
  if (scene.mapMode !== 'scene' || !area || area.floorId !== request.floorId || !layer || layer.floorId !== request.floorId
    || area.blocksMovement || !scene.floors[request.floorId]) throw new Error('群落须选择同Floor、可步行的明确terrainArea和目标图层。')
  if (layer.editLocked) throw new Error('群落目标图层已锁定。')
  const visibility = createPublicVisibility(scene), dependencies = new Map<string, { kind: string; id: string }>()
  const dependency = (kind: string, value: Editable | { id: string }) => {
    dependencies.set(`${kind}:${value.id}`, { kind, id: value.id })
    if ('floorId' in value && value.floorId !== request.floorId) throw new Error('群落依赖不能跨Floor。')
    if ('editLocked' in value && (value.editLocked || scene.userLayers[scene.entityLayers[value.id]]?.editLocked)) throw new Error(`群落明确支撑或避让依赖已锁定：${value.id}。`)
  }
  const support = (ref: Prop['supportRef']) => {
    if (ref.kind === 'floor') {
      if (ref.id !== request.floorId) throw new Error('群落支撑不能跨Floor。')
      dependency('floor', scene.floors[ref.id]); return
    }
    const row = ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : scene.rooms[ref.id]
    if (!row) throw new Error('群落明确支撑依赖不存在。')
    dependency(ref.kind, row)
    if (request.visibility === 'public' && !visibility.surface(ref)) throw new Error('公开群落不能读取私密支撑。')
    if (ref.kind === 'room') support(scene.rooms[ref.id].supportRef)
  }
  dependency('floor',scene.floors[request.floorId]);dependency('layer', layer); support({ kind: 'terrainArea', id: area.id })
  if (request.visibility === 'public' && !visibility.terrainArea(area.id)) throw new Error('公开群落不能使用私密地形。')
  const ground = terrainPoints(area), protections: Protection[] = []
  for (const clearing of request.clearings) {
    assertSimpleVisualPolyline(clearing.boundaryMm, true)
    if (!polygonInside(clearing.boundaryMm, ground)) throw new Error('活动区须完整位于明确适植地面内。')
    protections.push({ points: clearing.boundaryMm, footprintMarginMm: clearing.footprintMarginMm, paintMarginMm: clearing.paintMarginMm })
  }
  const readWall = (wallId: string) => {
    const wall = scene.walls[wallId]
    if (!wall) throw new Error('群落避让墙不存在。')
    dependency('wall', wall)
    for (const vertexId of [wall.startVertexId, wall.endVertexId]) dependency('vertex', scene.vertices[vertexId])
    return wall
  }
  // Match the audience's actual thick-wall joins; a hidden neighbor must not
  // widen a public exclusion. Only walls participating in these joins are read.
  const visibleWallScene = request.visibility === 'public' ? { ...scene,walls:Object.fromEntries(Object.entries(scene.walls).filter(([wallId])=>visibility.wall(wallId))) } : scene
  let wallEnvelopes: ReturnType<typeof wallEnvelopePolygons> | undefined
  const wallProtection = (wallId: string): PointMm[] => {
    const wall = readWall(wallId), names = new Set([wallId])
    const neighbors = Object.values(visibleWallScene.walls).filter(other=>other.floorId===wall.floorId && other.id!==wallId
      && [other.startVertexId,other.endVertexId].some(vertex=>vertex===wall.startVertexId||vertex===wall.endVertexId))
    for(const other of neighbors) { names.add(`${wallId}、${other.id}`);names.add(`${other.id}、${wallId}`) }
    wallEnvelopes ??= wallEnvelopePolygons(visibleWallScene)
    const shapes = wallEnvelopes.filter(row=>row.floorId===wall.floorId&&names.has(row.entityId))
    for(const other of neighbors) if(shapes.some(row=>row.entityId===`${wallId}、${other.id}`||row.entityId===`${other.id}、${wallId}`)) readWall(other.id)
    return shapes.flatMap(row=>row.polygon)
  }
  const seenAvoidances = new Set<string>()
  for (const avoidance of request.avoidances) {
    const { kind, id: targetId } = avoidance.ref, key = `${kind}:${targetId}`
    if (seenAvoidances.has(key)) throw new Error('群落显式避让引用不能重复。')
    seenAvoidances.add(key)
    const record = kind === 'terrainArea' ? scene.terrainAreas[targetId] : kind === 'room' ? scene.rooms[targetId] : kind === 'wall' ? scene.walls[targetId]
      : kind === 'opening' ? scene.openings[targetId] : kind === 'path' ? scene.paths[targetId] : kind === 'terrainConnection' ? scene.terrainConnections[targetId]
        : kind === 'region' ? scene.regions[targetId] : scene.props[targetId]
    if (!record) throw new Error(`群落明确避让对象不存在：${targetId}。`)
    const publicRecord = kind === 'terrainArea' ? visibility.terrainArea(targetId) : kind === 'room' ? visibility.room(targetId) : kind === 'wall' ? visibility.wall(targetId)
      : kind === 'opening' ? visibility.opening(targetId) : kind === 'path' ? visibility.path(targetId) : kind === 'terrainConnection' ? visibility.terrainConnection(targetId)
        : kind === 'region' ? scene.regions[targetId].visibility === 'public' && scene.regions[targetId].kind !== 'manualMask' : visibility.prop(scene.props[targetId])
    if (request.visibility === 'public' && !publicRecord) throw new Error('公开群落不能读取私密或未揭示的避让对象。')
    dependency(kind, record)
    let points: PointMm[]
    if (kind === 'terrainArea') points = terrainPoints(scene.terrainAreas[targetId])
    else if (kind === 'room') {
      const room = scene.rooms[targetId]; support(room.supportRef)
      for (const vertexId of room.boundaryVertexIds) dependency('vertex', scene.vertices[vertexId])
      const adjacent = Object.values(scene.walls).filter(wall => room.boundaryVertexIds.some((vertexId, index, vertices) =>
        vertexId === wall.startVertexId && vertices[(index + 1) % vertices.length] === wall.endVertexId || vertexId === wall.endVertexId && vertices[(index + 1) % vertices.length] === wall.startVertexId))
      points = [...roomPoints(scene, room),...adjacent.flatMap(wall=>wallProtection(wall.id))]
    } else if (kind === 'wall') {
      points = wallProtection(targetId)
    } else if (kind === 'opening') {
      const opening = scene.openings[targetId]; readWall(opening.wallId)
      const [a,b] = openingEndpoints(scene, opening); points = corridor(a,b,1800,true)
    } else if (kind === 'path') { const path = scene.paths[targetId]; path.supportRefs.forEach(support); points = pathPolygon(path) }
    else if (kind === 'terrainConnection') {
      const connection = scene.terrainConnections[targetId]; support(connection.from.surfaceRef); support(connection.to.surfaceRef)
      if (connection.openingId) { dependency('opening', scene.openings[connection.openingId]); readWall(scene.openings[connection.openingId].wallId) }
      points = connectionFootprint(connection)
    } else if (kind === 'region') points = scene.regions[targetId].boundaryMm
    else { const prop = scene.props[targetId]; support(prop.supportRef); points = [...propFootprint(prop), ...propPaintPolygon(prop,propPresentation(appearance,prop.id))] }
    protections.push({ points, footprintMarginMm: avoidance.footprintMarginMm, paintMarginMm: avoidance.paintMarginMm })
  }
  const occupied = geometryIdentityIds(scene)
  Object.keys(scene.userLayers).forEach(value => occupied.add(value))
  const identity = (key: string) => `vegetation-${sha256Text(canonicalJson([scene.sceneId, request.operationId, key]))}`
  if (VEGETATION_COMPOSITION_CHANNELS.some(key=>occupied.has(identity(`${key}:group`)))) throw new Error('群落操作身份已被占用，不重用或补写旧操作。')
  const fresh = (key: string) => {
    const value = identity(key)
    if (occupied.has(value)) throw new Error('群落操作身份已被占用，不覆盖既有组或记录。')
    occupied.add(value); return value
  }
  const commands: SceneCommand[] = [], groups = new Map<VegetationCompositionChannel,string>()
  let gridNodes = 0
  for (const key of VEGETATION_COMPOSITION_CHANNELS) {
    const config = request.channels[key]
    if (!config.enabled) continue
    cancelled(context)
    let paintRadius = 0, footprintRadius = 0
    for (const item of config.palette) {
      const definition = scene.propDefinitions[item.propDefinitionRef.id]
      if (!definition || definition.version !== item.propDefinitionRef.version || definition.defaultAppearance.kind !== 'image') throw new Error('群落palette须引用已有确切版本图片定义，不自动添加素材。')
      dependency('propDefinition', definition)
      dependency('asset',scene.assets[definition.defaultAppearance.assetId])
      const prototype: Prop = { id: 'vegetation-measure-only', floorId: request.floorId, editLocked: false, visibility: request.visibility,
        definitionRef: item.propDefinitionRef, appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
        footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm), positionMm: { x:0,y:0 },rotationDeg:0,
        supportRef:{kind:'terrainArea',id:area.id},blocksMovement:definition.defaultBlocksMovement,blocksSight:definition.defaultBlocksSight,
        renderLayer:definition.defaultRenderLayer,renderOrder:0,shadowClass:definition.defaultShadowClass,shadowOverride:null }
      paintRadius = Math.max(paintRadius,...propPaintPolygon(prototype,definitionPresentation(appearance,item.propDefinitionRef)).map(p=>Math.hypot(p.x,p.y)))
      footprintRadius = Math.max(footprintRadius,...propFootprint(prototype).map(p=>Math.hypot(p.x,p.y)))
    }
    const columns = Math.floor(Math.max(...ground.map(p=>p.x))/config.cellSizeMm)-Math.floor(Math.min(...ground.map(p=>p.x))/config.cellSizeMm)+1
    const rows = Math.floor(Math.max(...ground.map(p=>p.y))/config.cellSizeMm)-Math.floor(Math.min(...ground.map(p=>p.y))/config.cellSizeMm)+1
    gridNodes += columns*rows
    if (!Number.isSafeInteger(gridNodes) || gridNodes > MANUAL_TRANSACTION_BUDGET.limits.gridNodes) throw new Error('群落候选网格超过compact固定预算。')
    const groupId = fresh(`${key}:group`); groups.set(key,groupId)
    commands.push({ type:'createScatter',id:groupId,floorId:request.floorId,layerId:request.layerId,visibility:request.visibility,
      domain:{kind:'area',areaId:area.id},algorithmVersion:'scatter-cell-v2',palette:cloneJson(config.palette),seed:sha256Text(canonicalJson([request.seed,key])),
      gridOriginMm:{x:0,y:0},cellSizeMm:config.cellSizeMm,minDistanceMm:config.minDistanceMm,densityFactor:config.densityFactor,rotationRangeDeg:{min:0,max:359} })
    const b = scene.floors[request.floorId].boundsMm, edgeMargin = Math.ceil(paintRadius+footprintRadius)+1
    const edgeStrips = [
      rectangle(b.x-edgeMargin,b.y-edgeMargin,b.x+edgeMargin,b.y+b.height+edgeMargin),
      rectangle(b.x+b.width-edgeMargin,b.y-edgeMargin,b.x+b.width+edgeMargin,b.y+b.height+edgeMargin),
      rectangle(b.x-edgeMargin,b.y-edgeMargin,b.x+b.width+edgeMargin,b.y+edgeMargin),
      rectangle(b.x-edgeMargin,b.y+b.height-edgeMargin,b.x+b.width+edgeMargin,b.y+b.height+edgeMargin),
    ]
    for (const [index, boundaryMm] of edgeStrips.entries()) {
      if (boundaryMm.some(p=>!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y))) throw new Error('群落Floor边缘保护超过安全整数。')
      commands.push({type:'upsertScatterExclusion',groupId,exclusion:{id:fresh(`${key}:floor-edge:${index}`),reason:'entrance',boundaryMm}})
    }
    for (const [index, protection] of protections.entries()) {
      // Every possible palette rotation is protected. The additional footprint
      // radius also covers an offset footprint whose root is outside its box.
      const padding = Math.ceil(Math.max(protection.footprintMarginMm,protection.paintMarginMm+paintRadius+footprintRadius))+1
      commands.push({ type:'upsertScatterExclusion',groupId,exclusion:{id:fresh(`${key}:exclusion:${index}`),reason:'entrance',boundaryMm:paddedBounds(protection.points,padding)} })
    }
    commands.push({type:'regenerateScatter',id:groupId})
  }
  if (!groups.size) throw new Error('请至少明确启用一个群落通道。')
  if (commands.length > 256) throw new Error('群落命令展开超过compact256预算。')
  cancelled(context)
  // A private native rehearsal measures actual expanded members and hard
  // geometry. Its disposable IDs are not returned as a certificate or birth map.
  let sequence = 0
  const rehearsal = { clock:context.clock,ids:{nextId:()=>{
    let value: string
    do { value=`vegetation-rehearsal-${sha256Text(canonicalJson([request.operationId,sequence++]))}` } while(occupied.has(value))
    occupied.add(value);return value
  }} }
  const result = applyCommands(scene,commands,rehearsal,{appearance,budget:MANUAL_TRANSACTION_BUDGET})
  const summaries: VegetationCompositionPlan['channelSummary'] = []
  for (const key of VEGETATION_COMPOSITION_CHANNELS) {
    const groupId = groups.get(key), config = request.channels[key]
    if (!groupId || !config.enabled) { summaries.push({key,groupId:null,densityFactor:0,exclusionCount:0,createdMembers:0}); continue }
    const group = result.scatterGroups[groupId], props = Object.values(group.members).flatMap(member=>member.propId ? [result.props[member.propId]] : [])
    for (const prop of props) {
      const footprint = propFootprint(prop), paint = propPaintPolygon(prop,definitionPresentation(appearance,prop.definitionRef))
      if (!polygonInside(paint,rectangle(scene.floors[request.floorId].boundsMm.x,scene.floors[request.floorId].boundsMm.y,
        scene.floors[request.floorId].boundsMm.x+scene.floors[request.floorId].boundsMm.width,scene.floors[request.floorId].boundsMm.y+scene.floors[request.floorId].boundsMm.height))
        || protections.some(protection=>polygonDistance(footprint,protection.points)<protection.footprintMarginMm || polygonDistance(paint,protection.points)<protection.paintMarginMm)) {
        throw new Error('群落真实占地或可见树冠净空未通过；未降低保护或采用部分结果。')
      }
    }
    summaries.push({key,groupId,densityFactor:config.densityFactor,exclusionCount:group.exclusions.length,createdMembers:props.length})
  }
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET,measureCommandBudget(scene,result,undefined,{gridNodes,fieldEvaluations:gridNodes*10,candidateAttempts:groups.size,dependencyRefs:dependencies.size},MANUAL_TRANSACTION_BUDGET))
  cancelled(context)
  return {commands:cloneJson(commands),inputHash:sha256Text(canonicalJson(request)),dependencies:[...dependencies.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)),channelSummary:summaries}
}
