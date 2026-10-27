import { detachChangedOutputs } from '../terrain-generation/integrity.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { z } from 'zod'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson, inspectJsonInput } from '../validation/json.js'
import { applyCommandDraft, type BaseSceneCommand } from './base.js'
import { polygonDistance, propFootprint, roomPoints, supportSurfaceAt, terrainPoints } from '../geometry/geometry.js'
import { buildScatterRegeneration } from '../geometry/scatter.js'
import { sceneSchema } from '../validation/scene.js'
import type { Editable, MaterialPaint, PointMm, SurfaceStyle, TerrainArea, TerrainEdge, VersionRef } from '../model/scene.js'
import { geometryDocumentForValidation, geometryIdentityIds } from './domain.js'
import { orderedLayers } from './layers.js'
import { validateSceneDocument } from '../validation/scene.js'
import { COMMAND_LIMIT, LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '必须是整数毫米')
const positive = integer.refine(value => value > 0, '必须大于零')
const point = z.object({ x: integer, y: integer }).strict()
const version = z.object({ id, version: positive }).strict()
const visibility = z.enum(['public', 'gm'])
const base = { id, floorId: id, layerId: id.optional() }
const areaFields = sceneSchema.shape.terrainAreas.valueType.omit({ id: true, floorId: true, editLocked: true })
const edgeFields = sceneSchema.shape.terrainEdges.valueType.omit({ id: true, floorId: true, editLocked: true })
const connectionFields = sceneSchema.shape.terrainConnections.valueType.omit({ id: true, floorId: true, editLocked: true })
const pathFields = sceneSchema.shape.paths.valueType.omit({ id: true, floorId: true, editLocked: true })
const scatterFields = sceneSchema.shape.scatterGroups.valueType.omit({ id: true, floorId: true, editLocked: true, members: true, exclusions: true, algorithmVersion: true })
const regionFields = sceneSchema.shape.regions.valueType.omit({ id: true, floorId: true, editLocked: true }).extend({ kind: z.enum(['terrain', 'hazard']) })

/** Finite native scene operations; no arbitrary project or entity JSON patch. */
export const outdoorCommandSchemas = [
  z.object({ type: z.literal('createTerrainArea'), ...base, ...areaFields.omit({ boundaryMm: true }).partial().shape, boundaryMm: z.array(point).min(3).max(2048), materialRef: version.optional() }).strict(),
  z.object({ type: z.literal('updateTerrainArea'), id, changes: areaFields.partial().strict() }).strict(),
  z.object({ type: z.literal('createTerrainEdge'), id, layerId: id.optional(), ...edgeFields.omit({ source: true, neighborAreaId: true }).partial().shape, source: edgeFields.shape.source }).strict(),
  z.object({ type: z.literal('updateTerrainEdge'), id, changes: edgeFields.partial().strict() }).strict(),
  z.object({ type: z.literal('createTerrainConnection'), ...base, ...connectionFields.omit({ visibility: true, openingId: true, blocksMovement: true, movementCostMultiplier: true, surfaceStyle: true }).shape,
    ...connectionFields.pick({ visibility: true, openingId: true, blocksMovement: true, movementCostMultiplier: true, surfaceStyle: true }).partial().shape }).strict(),
  z.object({ type: z.literal('updateTerrainConnection'), id, changes: connectionFields.partial().strict() }).strict(),
  z.object({ type: z.literal('createPath'), ...base, ...pathFields.omit({ visibility: true, surfaceStyle: true, movementCostMultiplier: true, renderOrder: true }).shape,
    ...pathFields.pick({ visibility: true, surfaceStyle: true, movementCostMultiplier: true, renderOrder: true }).partial().shape, materialRef: version.optional() }).strict(),
  z.object({ type: z.literal('updatePath'), id, changes: pathFields.partial().strict() }).strict(),
  z.object({ type: z.literal('createRegion'), ...base, boundaryMm: z.array(point).min(3).max(512), kind: z.enum(['terrain', 'hazard']), visibility: visibility.optional(), blocksMovement: z.boolean().optional(), movementCostMultiplier: z.number().finite().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('updateRegion'), id, changes: regionFields.partial().strict() }).strict(),
  z.object({ type: z.literal('createScatter'), ...base, ...scatterFields.omit({ visibility: true, gridOriginMm: true, densityFactor: true, minDistanceMm: true, rotationRangeDeg: true }).shape,
    ...scatterFields.pick({ visibility: true, gridOriginMm: true, densityFactor: true, minDistanceMm: true, rotationRangeDeg: true }).partial().shape }).strict(),
  z.object({ type: z.literal('configureScatter'), id, changes: scatterFields.partial().strict() }).strict(),
  z.object({ type: z.literal('upsertScatterExclusion'), groupId: id, exclusion: z.object({ id, boundaryMm: z.array(point).min(3).max(512), reason: z.enum(['manual', 'entrance']) }).strict() }).strict(),
  z.object({ type: z.literal('removeScatterExclusion'), groupId: id, exclusionId: id }).strict(),
  z.object({ type: z.literal('deleteOutdoorEntity'), kind: z.enum(['terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'region', 'scatterGroup']), id }).strict(),
] as const
const baseSchemas = [
  z.object({ type: z.literal('moveTerrainPoint'), areaId: id, pointId: id, positionMm: point }).strict(),
  z.object({ type: z.literal('setTerrainElevation'), id, groundElevationMm: integer }).strict(),
  z.object({ type: z.literal('setConnectionBlocked'), id, blocksMovement: z.boolean() }).strict(),
  z.object({ type: z.literal('removeTerrainConnection'), id }).strict(),
  z.object({ type: z.literal('regenerateScatter'), id, densityFactor: z.number().finite().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal('detachScatterMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('deleteProp'), id }).strict(),
  z.object({ type: z.literal('updateProp'), id, changes: z.object({ positionMm: point.optional(), rotationDeg: z.number().finite().min(0).lt(360).optional() }).strict() }).strict(),
  z.object({ type: z.literal('replacePropAppearance'), id, definitionRef: version }).strict(),
] as const
export const outdoorCommandSchema = z.discriminatedUnion('type', [...outdoorCommandSchemas, ...baseSchemas])
export type OutdoorCommand = z.infer<typeof outdoorCommandSchema>
const outdoorTypes = new Set<string>([...outdoorCommandSchemas, ...baseSchemas].map(schema => schema.shape.type.value))
export const isOutdoorCommand = (command: { type: string }): command is OutdoorCommand => outdoorTypes.has(command.type)
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const required = <T>(record: Record<string, T>, key: string, label: string): T => { const value = own(record, key); if (!value) throw new Error(`${label}不存在：${key}。`); return value }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const entities = (scene: SceneDocument) => new Map<string, Editable>(LAYER_ENTITY_COLLECTIONS.flatMap(collection => Object.values(scene[collection]) as Editable[]).map(entity => [entity.id, entity]))
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const collections = { terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths', region: 'regions', scatterGroup: 'scatterGroups' } as const

const pointKey = (point: PointMm) => `${point.x}\0${point.y}`
const ringIndex = (index: number, length: number) => (index % length + length) % length

function assertCyclicSubsequence(indices: readonly number[], ringLength: number): void {
  if (indices.length < 3 || new Set(indices).size !== indices.length) throw new Error('轮廓点无法唯一对应旧身份；请分步编辑后再预览。')
  const forward = indices.reduce((sum, value, index) => sum + ringIndex(indices[(index + 1) % indices.length] - value, ringLength), 0)
  const reverse = indices.reduce((sum, value, index) => sum + ringIndex(value - indices[(index + 1) % indices.length], ringLength), 0)
  if ((forward === ringLength) === (reverse === ringLength)) throw new Error('轮廓点顺序存在歧义；请保持原有循环或反向顺序后再预览。')
}

/** Preserve vertex identity only where coordinates or one unique ring mapping proves continuity. */
export function reconcileTerrainBoundary(
  previous: TerrainArea['boundaryMm'],
  input: readonly PointMm[],
  context: PreparationContext,
  allocateId: (kind: 'point' | 'segment') => string = () => context.ids.nextId(),
): TerrainArea['boundaryMm'] {
  // Native scene requires positive winding, so reverse-only row order is normalized first.
  const positions = boundary(input.map(point => ({ ...point })))
  if (positions.length < 3) throw new Error('地形轮廓至少需要三个不同坐标。')

  const oldIndexByPosition = new Map<string, number>()
  for (const [index, point] of previous.entries()) {
    const key = pointKey(point.positionMm)
    if (oldIndexByPosition.has(key)) throw new Error('旧地形轮廓含重复坐标，无法安全保留点身份。')
    oldIndexByPosition.set(key, index)
  }
  const seenPositions = new Set<string>(), exactMatches: (number | null)[] = []
  for (const point of positions) {
    const key = pointKey(point)
    if (seenPositions.has(key)) throw new Error('地形轮廓坐标不能重复。')
    seenPositions.add(key)
    exactMatches.push(oldIndexByPosition.get(key) ?? null)
  }

  const matchCount = exactMatches.filter(index => index !== null).length
  let pointMapping: (number | null)[]
  if (positions.length !== previous.length) {
    const pureInsertion = positions.length > previous.length && matchCount === previous.length
    const pureDeletion = positions.length < previous.length && matchCount === positions.length
    if (!pureInsertion && !pureDeletion) throw new Error('插入/删除与移动混在同一次轮廓编辑中，旧点身份无法唯一判断；请分步预览。')
    assertCyclicSubsequence(exactMatches.filter((index): index is number => index !== null), previous.length)
    pointMapping = exactMatches
  } else if (matchCount === 0) {
    // Without an exact coordinate anchor, the input order is the only stated identity mapping.
    pointMapping = positions.map((_point, index) => index)
  } else if (matchCount === 1) {
    const newIndex = exactMatches.findIndex(index => index !== null), oldIndex = exactMatches[newIndex]!
    if (newIndex !== oldIndex) throw new Error('仅凭一个匹配点无法判断轮廓旋转或反向；请保持原行序或提供更多未移动点。')
    pointMapping = positions.map((_point, index) => index)
  } else {
    const candidates: number[][] = []
    const anchorIndex = exactMatches.findIndex(index => index !== null), anchorOldIndex = exactMatches[anchorIndex]!
    for (const direction of [1, -1]) {
      const offset = anchorOldIndex - direction * anchorIndex
      const candidate = positions.map((_point, index) => ringIndex(offset + direction * index, previous.length))
      if (exactMatches.every((oldIndex, index) => oldIndex === null || candidate[index] === oldIndex)) candidates.push(candidate)
    }
    if (candidates.length !== 1) throw new Error('轮廓点身份无法通过唯一的循环或反向映射确认；请分步预览。')
    pointMapping = candidates[0]
  }

  const usedIds = new Set(previous.flatMap(point => [point.id, point.segmentId]))
  const allocate = (kind: 'point' | 'segment') => {
    const id = allocateId(kind)
    if (!id || usedIds.has(id)) throw new Error('新轮廓身份 ID 必须唯一且未使用。')
    usedIds.add(id)
    return id
  }
  const next = positions.map((positionMm, index) => ({
    id: pointMapping[index] === null ? allocate('point') : previous[pointMapping[index]!].id,
    segmentId: '',
    positionMm,
  }))
  const oldSegmentByDirectedEndpoints = new Map(previous.map((point, index) => [
    `${point.id}\0${previous[(index + 1) % previous.length].id}`,
    point.segmentId,
  ]))
  next.forEach((point, index) => {
    const nextPoint = next[(index + 1) % next.length]
    point.segmentId = oldSegmentByDirectedEndpoints.get(`${point.id}\0${nextPoint.id}`) ?? allocate('segment')
  })
  return next
}

/** Real geometric and referential closure, including unchanged support dependants. */
export function outdoorDependencies(scene: SceneDocument, roots: readonly string[]): string[] {
  const result = new Set(roots), areas = new Set(roots.filter(id => own(scene.terrainAreas, id)))
  for (const area of Object.values(scene.terrainAreas)) if (area.boundaryMm.some(p => roots.includes(p.id) || roots.includes(p.segmentId))) { areas.add(area.id); result.add(area.id) }
  for (const areaId of [...areas]) {
    const area = scene.terrainAreas[areaId], shape = terrainPoints(area)
    for (const other of Object.values(scene.terrainAreas)) if (other.floorId === area.floorId && polygonDistance(shape, terrainPoints(other)) < 1e-7) { areas.add(other.id); result.add(other.id) }
    // Floor-supported content can lose effective support under a new/expanded area.
    for (const prop of Object.values(scene.props)) if (prop.floorId === area.floorId && polygonDistance(shape, propFootprint(prop)) < 1e-7) result.add(prop.id)
    const domain = geometryDocumentForValidation(scene)
    for (const room of Object.values(scene.rooms)) if (room.floorId === area.floorId && polygonDistance(shape, roomPoints(domain, room)) < 1e-7) result.add(room.id)
  }
  for (const edge of Object.values(scene.terrainEdges)) if (areas.has(edge.source.areaId) || edge.neighborAreaId !== null && areas.has(edge.neighborAreaId) || result.has(edge.id)) {
    result.add(edge.id); result.add(edge.source.areaId); if (edge.neighborAreaId !== null) result.add(edge.neighborAreaId)
  }
  for (const room of Object.values(scene.rooms)) if (room.supportRef.kind === 'terrainArea' && areas.has(room.supportRef.id)) result.add(room.id)
  const rooms = Object.values(scene.rooms).filter(room => result.has(room.id))
  for (const wall of Object.values(scene.walls)) if (rooms.some(room => room.boundaryVertexIds.some((id, i, all) => id === wall.startVertexId && all[(i + 1) % all.length] === wall.endVertexId || id === wall.endVertexId && all[(i + 1) % all.length] === wall.startVertexId))) result.add(wall.id)
  for (const opening of Object.values(scene.openings)) if (result.has(opening.wallId)) result.add(opening.id)
  for (const connection of Object.values(scene.terrainConnections)) if (result.has(connection.id) || [connection.from, connection.to].some(end => result.has(end.surfaceRef.id)) || connection.openingId !== null && result.has(connection.openingId)) {
    result.add(connection.id); for (const end of [connection.from, connection.to]) if (end.surfaceRef.kind !== 'floor') result.add(end.surfaceRef.id)
    if (connection.openingId !== null) result.add(connection.openingId)
  }
  for (const path of Object.values(scene.paths)) if (result.has(path.id) || path.supportRefs.some(ref => result.has(ref.id))) {
    result.add(path.id); for (const ref of path.supportRefs) if (ref.kind !== 'floor') result.add(ref.id)
  }
  for (const prop of Object.values(scene.props)) if (result.has(prop.id) || result.has(prop.supportRef.id) || prop.roomId && result.has(prop.roomId)) {
    result.add(prop.id)
  }
  let expanded = true
  while (expanded) {
    expanded = false
    const add = (id: string) => { if (!result.has(id)) { result.add(id); expanded = true } }
    for (const group of Object.values(scene.scatterGroups)) {
      const domain = group.domain.kind === 'area' ? group.domain.areaId : group.domain.kind === 'path' ? group.domain.pathId : group.domain.edgeId
      if (result.has(group.id) || result.has(domain) || Object.values(group.members).some(member => member.propId !== null && result.has(member.propId))) {
        add(group.id); add(domain); for (const member of Object.values(group.members)) if (member.propId !== null) add(member.propId)
      }
    }
    for (const group of Object.values(scene.prefabInstances)) if (result.has(group.id) || Object.values(group.members).some(member => member.propId !== null && result.has(member.propId))) {
      add(group.id); for (const member of Object.values(group.members)) if (member.propId !== null) add(member.propId)
    }
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && result.has(note.anchor.entityId)) add(note.id)
  }
  return [...result].sort()
}

export interface OutdoorImpact {
  rootIds: string[]; affectedIds: string[]; createdIds: string[]; changedIds: string[]; removedIds: string[]; layerIds: string[]; commandCost: number; reason: string | null
}
const emptyImpact = (): OutdoorImpact => ({ rootIds: [], affectedIds: [], createdIds: [], changedIds: [], removedIds: [], layerIds: [], commandCost: 0, reason: null })
function recordsCost(before: Record<string, unknown>, after: Record<string, unknown>): number {
  return new Set([...Object.keys(before), ...Object.keys(after)]).size === 0 ? 0 : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !equal(before[key], after[key])).length
}
function diffImpact(before: SceneDocument, after: SceneDocument, roots: readonly string[]): OutdoorImpact {
  const left = entities(before), right = entities(after)
  const createdIds = [...right.keys()].filter(id => !left.has(id)), removedIds = [...left.keys()].filter(id => !right.has(id))
  const changedIds = [...left.keys()].filter(id => right.has(id) && (!equal(left.get(id), right.get(id)) || before.entityLayers[id] !== after.entityLayers[id]))
  let commandCost = createdIds.length + changedIds.length + removedIds.length
  for (const areaId of new Set([...Object.keys(before.terrainAreas), ...Object.keys(after.terrainAreas)])) {
    const a = before.terrainAreas[areaId], b = after.terrainAreas[areaId]
    const points = (area?: TerrainArea) => Object.fromEntries((area?.boundaryMm ?? []).map(p => [p.id, p.positionMm]))
    const segments = (area?: TerrainArea) => Object.fromEntries((area?.boundaryMm ?? []).map((p, i, all) => [p.segmentId, [p.id, all[(i + 1) % all.length].id]]))
    commandCost += recordsCost(points(a), points(b)) + recordsCost(segments(a), segments(b))
  }
  for (const groupId of new Set([...Object.keys(before.scatterGroups), ...Object.keys(after.scatterGroups)])) {
    const a = before.scatterGroups[groupId], b = after.scatterGroups[groupId]
    commandCost += recordsCost(a?.members ?? {}, b?.members ?? {})
    commandCost += recordsCost(Object.fromEntries((a?.exclusions ?? []).map(value => [value.id, value])), Object.fromEntries((b?.exclusions ?? []).map(value => [value.id, value])))
  }
  const affectedIds = [...new Set([...outdoorDependencies(before, roots), ...outdoorDependencies(after, roots), ...createdIds, ...changedIds, ...removedIds])].sort()
  return { rootIds: [...new Set(roots)].sort(), affectedIds, createdIds: createdIds.sort(), changedIds: changedIds.sort(), removedIds: removedIds.sort(),
    layerIds: [...new Set(affectedIds.flatMap(id => [before.entityLayers[id], after.entityLayers[id]]).filter((id): id is string => !!id))].sort(), commandCost, reason: null }
}
/** Scope of the exact prepared bytes; never regenerate random candidate births to inspect them. */
export function inspectOutdoorChanges(before: SceneDocument, after: SceneDocument, roots: readonly string[]): OutdoorImpact {
  return diffImpact(before, after, roots)
}
function assertUnlocked(scene: SceneDocument, ids: Iterable<string>) {
  const byId = entities(scene), locked = [...new Set(ids)].filter(id => byId.get(id)?.editLocked || byId.has(id) && scene.userLayers[scene.entityLayers[id]]?.editLocked)
  if (locked.length) throw new Error(`室外事务涉及锁定实体、图层或真实依赖：${locked.join('、')}。`)
}
function anchoredNoteIds(scene: SceneDocument, roots: readonly string[]): string[] {
  const ids = new Set(roots)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && ids.has(note.anchor.entityId) && !ids.has(note.id)) { ids.add(note.id); expanded = true }
  }
  return [...ids]
}
function targetLayer(scene: SceneDocument, floorId: string, layerId?: string): string {
  required(scene.floors, floorId, 'Floor')
  const layer = layerId === undefined ? orderedLayers(scene, floorId)[0] : own(scene.userLayers, layerId)
  if (!layer || layer.floorId !== floorId || layer.editLocked) throw new Error('新增室外对象须选择同Floor且未锁定的用户图层。')
  return layer.id
}
function fresh(scene: SceneDocument, value: string) {
  if (value.length > 256 || value === '__proto__' || geometryIdentityIds(scene).has(value) || own(scene.userLayers, value)) throw new Error(`新室外身份已占用或无效：${value}。`)
}
function styleFor(scene: SceneDocument, ref: VersionRef | undefined, kind: 'terrain' | 'path'): SurfaceStyle | null {
  if (!ref) return null
  const material = required(scene.materials, ref.id, '固定材质')
  if (material.version !== ref.version || !material.applicableSurfaces.includes(kind)) throw new Error('材质版本或适用表面不匹配。')
  const paint: MaterialPaint = { materialRef: cloneJson(ref), tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
  return { base: paint, overlays: [] }
}
function boundary(input: PointMm[]): PointMm[] {
  const value = cloneJson(input)
  if (value.length > 3 && same(value[0], value.at(-1)!)) value.pop()
  let signed = 0n
  value.forEach((p, i) => { const q = value[(i + 1) % value.length]; signed += BigInt(p.x) * BigInt(q.y) - BigInt(q.x) * BigInt(p.y) })
  return signed < 0n ? value.reverse() : value
}
/** Canonical exposed source; callers see the exact remap before adopting. */
export function canonicalTerrainEdge(scene: SceneDocument, source: TerrainEdge['source']): { source: TerrainEdge['source']; neighborAreaId: string | null; requiresCliff: boolean } {
  const area = required(scene.terrainAreas, source.areaId, '来源地形'), index = area.boundaryMm.findIndex(p => p.segmentId === source.segmentId)
  if (index < 0) throw new Error('来源段不存在。')
  const a = area.boundaryMm[index].positionMm, b = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!length) throw new Error('来源段不得为零长。')
  const domain = geometryDocumentForValidation(scene), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  let offset = Math.min(.1, length / 100)
  for (const candidate of Object.values(scene.terrainAreas)) for (let i = 0; i < candidate.boundaryMm.length; i++) {
    const c = candidate.boundaryMm[i].positionMm, d = candidate.boundaryMm[(i + 1) % candidate.boundaryMm.length].positionMm
    const dx = d.x - c.x, dy = d.y - c.y, square = dx * dx + dy * dy
    const t = square ? Math.max(0, Math.min(1, ((mid.x - c.x) * dx + (mid.y - c.y) * dy) / square)) : 0
    const distance = Math.hypot(mid.x - c.x - t * dx, mid.y - c.y - t * dy)
    if (distance > 1e-7) offset = Math.min(offset, distance / 4)
  }
  const inside = supportSurfaceAt(domain, { x: mid.x - (b.y - a.y) / length * offset, y: mid.y + (b.x - a.x) / length * offset }, area.floorId)
  const outside = supportSurfaceAt(domain, { x: mid.x + (b.y - a.y) / length * offset, y: mid.y - (b.x - a.x) / length * offset }, area.floorId)
  if (inside?.kind !== 'terrainArea' || inside.id !== area.id || !outside || outside.kind === 'terrainArea' && outside.id === area.id) throw new Error('来源段不是暴露的有效支撑边界。')
  const neighbor = outside.kind === 'terrainArea' ? scene.terrainAreas[outside.id] : undefined
  if (neighbor && area.id > neighbor.id) {
    const other = neighbor.boundaryMm.find((p, i, all) => same(p.positionMm, b) && same(all[(i + 1) % all.length].positionMm, a))
    if (other) return canonicalTerrainEdge(scene, { areaId: neighbor.id, segmentId: other.segmentId })
  }
  return { source: cloneJson(source), neighborAreaId: neighbor?.id ?? null, requiresCliff: area.groundElevationMm !== (neighbor?.groundElevationMm ?? 0) }
}
function referenced(scene: SceneDocument, value: string): string[] {
  const refs = new Set<string>()
  for (const item of Object.values(scene.terrainEdges)) if (item.source.areaId === value || item.neighborAreaId === value) refs.add(item.id)
  for (const item of Object.values(scene.terrainConnections)) if ([item.from, item.to].some(end => end.surfaceRef.id === value) || item.openingId === value) refs.add(item.id)
  for (const item of Object.values(scene.paths)) if (item.supportRefs.some(ref => ref.id === value)) refs.add(item.id)
  for (const item of Object.values(scene.rooms)) if (item.supportRef.id === value) refs.add(item.id)
  for (const item of Object.values(scene.props)) if (item.supportRef.id === value || item.roomId === value) refs.add(item.id)
  for (const item of Object.values(scene.scatterGroups)) if (Object.values(item.members).some(member => member.propId === value) || (item.domain.kind === 'area' ? item.domain.areaId : item.domain.kind === 'path' ? item.domain.pathId : item.domain.edgeId) === value) refs.add(item.id)
  for (const item of Object.values(scene.notes)) if (item.anchor.type === 'entity' && item.anchor.entityId === value) refs.add(item.id)
  for (const item of scene.constraints.pathChecks) if ([item.from, item.to].some(anchor => anchor.type === 'entity' && anchor.entityId === value)) refs.add(item.id)
  return [...refs].sort()
}
function rootsFor(command: OutdoorCommand): string[] {
  if (command.type === 'moveTerrainPoint') return [command.areaId]
  if (command.type === 'detachScatterMember') return [command.groupId, command.propId]
  if (command.type === 'upsertScatterExclusion' || command.type === 'removeScatterExclusion') return [command.groupId]
  return [command.id]
}

function mutate(scene: SceneDocument, command: OutdoorCommand, context: PreparationContext) {
  switch (command.type) {
    case 'createTerrainArea': {
      fresh(scene, command.id)
      if (command.materialRef && command.surfaceStyle !== undefined) throw new Error('请明确选择固定材质或完整表面样式，不能同时提供两者。')
      const layer = targetLayer(scene, command.floorId, command.layerId), points = boundary(command.boundaryMm)
      const ids = new Set<string>()
      const boundaryMm = points.map((positionMm, i) => {
        const pointId = `${command.id}:point:${i}`, segmentId = `${command.id}:segment:${i}`
        for (const value of [pointId, segmentId]) { fresh(scene, value); if (ids.has(value)) throw new Error('点/段ID重复。'); ids.add(value) }
        return { id: pointId, segmentId, positionMm }
      })
      scene.terrainAreas[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, boundaryMm, visibility: command.visibility ?? 'public', groundElevationMm: command.groundElevationMm ?? 0,
        coveragePriority: command.coveragePriority ?? 1, surfaceStyle: cloneJson(command.surfaceStyle === undefined ? styleFor(scene, command.materialRef, 'terrain') : command.surfaceStyle), blocksMovement: command.blocksMovement ?? false, blocksSight: command.blocksSight ?? false, movementCostMultiplier: command.movementCostMultiplier ?? 1 }
      scene.entityLayers[command.id] = layer; break
    }
    case 'updateTerrainArea': Object.assign(required(scene.terrainAreas, command.id, '地形'), cloneJson(command.changes)); break
    case 'createTerrainEdge': {
      fresh(scene, command.id)
      const relation = canonicalTerrainEdge(scene, command.source), area = scene.terrainAreas[relation.source.areaId]
      const layer = targetLayer(scene, area.floorId, command.layerId ?? scene.entityLayers[area.id])
      scene.terrainEdges[command.id] = { id: command.id, floorId: area.floorId, editLocked: false, ...relation, kind: command.kind ?? (relation.requiresCliff ? 'cliff' : 'materialTransition'),
        visibility: command.visibility ?? area.visibility, shoreline: command.shoreline ?? false, blocksMovement: command.blocksMovement ?? relation.requiresCliff, blocksSight: command.blocksSight ?? false, surfaceStyle: command.surfaceStyle ?? null, styleOverride: command.styleOverride ?? null }
      delete (scene.terrainEdges[command.id] as TerrainEdge & { requiresCliff?: boolean }).requiresCliff
      scene.entityLayers[command.id] = layer; break
    }
    case 'updateTerrainEdge': Object.assign(required(scene.terrainEdges, command.id, '来源边缘'), cloneJson(command.changes)); break
    case 'createTerrainConnection': {
      fresh(scene, command.id); const layer = targetLayer(scene, command.floorId, command.layerId)
      scene.terrainConnections[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, kind: command.kind, from: cloneJson(command.from), to: cloneJson(command.to), widthMm: command.widthMm,
        visibility: command.visibility ?? 'public', openingId: command.openingId ?? null, blocksMovement: command.blocksMovement ?? false, movementCostMultiplier: command.movementCostMultiplier ?? 1, surfaceStyle: command.surfaceStyle ?? null }
      scene.entityLayers[command.id] = layer; break
    }
    case 'updateTerrainConnection': Object.assign(required(scene.terrainConnections, command.id, '高差连接'), cloneJson(command.changes)); break
    case 'createPath': {
      fresh(scene, command.id); const layer = targetLayer(scene, command.floorId, command.layerId)
      if (command.materialRef && command.surfaceStyle !== undefined) throw new Error('请明确选择固定材质或完整表面样式，不能同时提供两者。')
      scene.paths[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, centerlineMm: cloneJson(command.centerlineMm), widthMm: command.widthMm, supportRefs: cloneJson(command.supportRefs), visibility: command.visibility ?? 'public',
        surfaceStyle: cloneJson(command.surfaceStyle === undefined ? styleFor(scene, command.materialRef, 'path') : command.surfaceStyle), movementCostMultiplier: command.movementCostMultiplier ?? 1, renderOrder: command.renderOrder ?? 0 }
      scene.entityLayers[command.id] = layer; break
    }
    case 'updatePath': Object.assign(required(scene.paths, command.id, '道路'), cloneJson(command.changes)); break
    case 'createRegion': {
      fresh(scene, command.id); const layer = targetLayer(scene, command.floorId, command.layerId)
      scene.regions[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, boundaryMm: boundary(command.boundaryMm), kind: command.kind, visibility: command.visibility ?? 'public', blocksMovement: command.blocksMovement ?? false, movementCostMultiplier: command.movementCostMultiplier ?? 1 }
      scene.entityLayers[command.id] = layer; break
    }
    case 'updateRegion': {
      const region = required(scene.regions, command.id, '用途/危险区域')
      if (region.kind === 'manualMask') throw new Error('秘密遮罩继续使用固定遮罩专用入口。')
      Object.assign(region, cloneJson(command.changes)); break
    }
    case 'createScatter': {
      fresh(scene, command.id); const layer = targetLayer(scene, command.floorId, command.layerId)
      scene.scatterGroups[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, domain: cloneJson(command.domain), palette: cloneJson(command.palette), seed: command.seed, algorithmVersion: 'scatter-cell-v1',
        visibility: command.visibility ?? 'public', gridOriginMm: cloneJson(command.gridOriginMm ?? { x: 0, y: 0 }), cellSizeMm: command.cellSizeMm, densityFactor: command.densityFactor ?? .25, minDistanceMm: command.minDistanceMm ?? 1, rotationRangeDeg: cloneJson(command.rotationRangeDeg ?? { min: 0, max: 359 }), members: {}, exclusions: [] }
      scene.entityLayers[command.id] = layer; break
    }
    case 'configureScatter': Object.assign(required(scene.scatterGroups, command.id, '散布组'), cloneJson(command.changes)); break
    case 'upsertScatterExclusion': {
      const group = required(scene.scatterGroups, command.groupId, '散布组'), previous = group.exclusions.find(item => item.id === command.exclusion.id)
      if (previous && (previous.reason === 'delete' || previous.sourceCandidateKey !== null)) throw new Error('人工删除抑制记录只能通过显式历史成员恢复修改。')
      if (!previous) fresh(scene, command.exclusion.id)
      const value = { ...cloneJson(command.exclusion), sourceCandidateKey: null }
      if (previous) Object.assign(previous, value); else group.exclusions.push(value)
      break
    }
    case 'removeScatterExclusion': {
      const group = required(scene.scatterGroups, command.groupId, '散布组'), value = group.exclusions.find(item => item.id === command.exclusionId)
      if (!value) throw new Error('排除区不存在。')
      if (value.reason === 'delete' || value.sourceCandidateKey !== null) throw new Error('不能通过普通配置清除人工删除记录。')
      group.exclusions = group.exclusions.filter(item => item.id !== value.id); break
    }
    case 'regenerateScatter': {
      const source = required(scene.scatterGroups, command.id, '散布组')
      const domain = geometryDocumentForValidation(scene, true)
      const proposal = buildScatterRegeneration(domain, command.id, command.densityFactor, { allocatePropId: () => context.ids.nextId(), preserveManagedAppearance: true })
      const present = new Set(proposal.props.map(prop => prop.id))
      for (const value of proposal.removePropIds) if (!present.has(value)) {
        const refs = referenced(scene, value).filter(id => id !== source.id)
        if (refs.length) throw new Error(`散布成员仍有引用，不能移除：${value} → ${refs.join('、')}。`)
        delete scene.props[value]; delete scene.entityLayers[value]
      }
      for (const prop of proposal.props) { scene.props[prop.id] = prop; scene.entityLayers[prop.id] = scene.entityLayers[source.id] }
      scene.scatterGroups[source.id] = proposal.group; break
    }
    case 'deleteOutdoorEntity': {
      const collection = collections[command.kind], value = required<Editable>(scene[collection], command.id, '室外对象')
      const refs = referenced(scene, value.id)
      if (command.kind === 'scatterGroup') {
        const group = scene.scatterGroups[value.id]
        if (Object.values(group.members).some(member => member.propId !== null)) throw new Error('删除散布组前须显式删除或退出全部活成员；不隐式级联。')
      }
      if (refs.length) throw new Error(`室外对象仍被引用，须先明确处理：${refs.join('、')}。`)
      delete scene[collection][value.id]; delete scene.entityLayers[value.id]; break
    }
    case 'moveTerrainPoint': {
      const area = required(scene.terrainAreas, command.areaId, '地形'), vertex = area.boundaryMm.find(p => p.id === command.pointId)
      if (!vertex) throw new Error('地形控制点不存在。')
      vertex.positionMm = cloneJson(command.positionMm); break
    }
    case 'setTerrainElevation': required(scene.terrainAreas, command.id, '地形').groundElevationMm = command.groundElevationMm; break
    case 'setConnectionBlocked': required(scene.terrainConnections, command.id, '连接').blocksMovement = command.blocksMovement; break
    case 'removeTerrainConnection': mutate(scene, { type: 'deleteOutdoorEntity', kind: 'terrainConnection', id: command.id }, context); break
    case 'detachScatterMember': case 'deleteProp': case 'updateProp': case 'replacePropAppearance': {
      const actualLocks = new Map([...entities(scene)].map(([id, entity]) => [id, entity.editLocked]))
      const domain = applyCommandDraft(cloneJson(geometryDocumentForValidation(scene, true)), [command as BaseSceneCommand], context)
      scene.props = domain.props; scene.scatterGroups = domain.scatterGroups; scene.prefabInstances = domain.prefabInstances
      for (const entity of [...Object.values(scene.props), ...Object.values(scene.scatterGroups), ...Object.values(scene.prefabInstances)]) if (actualLocks.has(entity.id)) entity.editLocked = actualLocks.get(entity.id)!
      for (const value of Object.keys(scene.entityLayers)) if (!entities(scene).has(value)) delete scene.entityLayers[value]
      // Domain effective locks are ephemeral and must not become entity locks.
      break
    }
  }
}

/** Detached draft mutation; the native command entry validates the complete batch once. */
export function applyOutdoorCommand(scene: SceneDocument, command: OutdoorCommand, context: PreparationContext): OutdoorImpact {
  const before = cloneJson(scene), roots = rootsFor(command)
  mutate(scene, command, context)
  const impact = diffImpact(before, scene, roots)
  if (!impact.commandCost) return impact
  // Locked retained/manual scatter members are read-only obstacles, not edits.
  const memberCommand = command.type === 'detachScatterMember' || command.type === 'deleteProp' || command.type === 'updateProp' || command.type === 'replacePropAppearance'
  const memberParents = memberCommand ? Object.values(before.scatterGroups).filter(group => Object.values(group.members).some(member => member.propId !== null && roots.includes(member.propId))).map(group => group.id) : []
  const lockIds = command.type === 'regenerateScatter'
    ? [...anchoredNoteIds(before, [command.id, ...impact.changedIds, ...impact.removedIds]), ...[...impact.createdIds, ...impact.changedIds].flatMap(id => scene.props[id] ? [scene.props[id].supportRef.id] : [])]
    : memberCommand ? anchoredNoteIds(before, [...roots, ...memberParents, ...impact.changedIds, ...impact.removedIds])
    : impact.affectedIds
  assertUnlocked(before, lockIds)
  if (impact.commandCost > COMMAND_LIMIT) throw new Error('展开后的室外事务超过256条操作预算，不能拆批绕过。')
  return impact
}

/** Preview includes geometry-dependent and cross-layer scope, even for unchanged JSON. */
export function previewOutdoorCommands(input: SceneDocument, commands: readonly OutdoorCommand[], context: PreparationContext): OutdoorImpact {
  const impact = emptyImpact(), validated = validateSceneDocument(input)
  if (!validated.ok) { impact.reason = `当前场景无效：${validated.errors.map(issue => issue.message).join('；')}`; return impact }
  const issue = inspectJsonInput(commands), parsed = issue ? null : z.array(outdoorCommandSchema).max(COMMAND_LIMIT).safeParse(commands)
  if (issue || !parsed?.success) { impact.reason = `室外指令无效：${issue?.message ?? (parsed && !parsed.success ? parsed.error.issues.map(issue => issue.message).join('；') : '')}`; return impact }
  const next = cloneJson(validated.document), roots = parsed.data.flatMap(rootsFor)
  let cost = 0
  try {
    for (const command of parsed.data) {
      const before = cloneJson(next)
      try {
        const physicalCost = applyOutdoorCommand(next, command, context).commandCost
        detachChangedOutputs(before, next)
        const expanded = terrainCommandCost(before, next)
        cost += physicalCost + expanded.total - expanded.items.physicalAndVisual
      }
      catch (error) { cost += diffImpact(before, next, rootsFor(command)).commandCost; throw error }
    }
    if (cost > COMMAND_LIMIT) throw new Error('展开后的整体室外事务超过256条操作预算，不能拆批绕过。')
    const result = validateSceneDocument(next)
    if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  } catch (error) { impact.reason = error instanceof Error ? error.message : String(error) }
  return { ...diffImpact(validated.document, next, roots), commandCost: cost, reason: impact.reason }
}
