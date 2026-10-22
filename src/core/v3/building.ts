import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { polygonsOverlapV2, roomPointsV2 } from '../v2/geometry'
import type { Editable, GroundSurfaceRef, OpeningV2, PointMm, RoomV2, SurfaceStyle, VersionRef, WallV2 } from '../v2/types'
import { geometryIdentityIdsV3 } from './domain'
import { orderedLayersV3 } from './layers'
import { validateSceneV3 } from './schema'
import { validateSceneSnapshotV3 } from './snapshots'
import { COMMAND_LIMIT_V3, LAYER_ENTITY_COLLECTIONS_V3, type SceneDocumentV3 } from './types'

export type BuildingCommandV3 =
  | { type: 'createRoom'; id: string; floorId: string; boundaryMm: PointMm[]; thicknessMm: number; layerId?: string; purpose?: string; visibility?: RoomV2['visibility']; accessExpectation?: RoomV2['accessExpectation']; supportRef?: GroundSurfaceRef; materialRef?: VersionRef }
  | { type: 'updateRoom'; id: string; changes: Partial<Pick<RoomV2, 'purpose' | 'visibility' | 'accessExpectation'>> }
  | { type: 'addOpening'; id: string; wallId: string; offsetReferenceVertexId: string; offsetMm: number; widthMm: number; kind: OpeningV2['kind']; state?: OpeningV2['state']; locked?: boolean; secret?: boolean; revealed?: boolean; layerId?: string }
  | { type: 'updateOpening'; id: string; changes: Partial<Pick<OpeningV2, 'wallId' | 'offsetReferenceVertexId' | 'offsetMm' | 'widthMm' | 'kind' | 'state' | 'locked' | 'secret' | 'revealed'>> }
  | { type: 'deleteOpening'; id: string }
  | { type: 'setEntranceOpenings'; ids: string[] }

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '毫米坐标必须是安全整数')
const positive = integer.refine(value => value > 0, '尺寸必须大于零')
const nonnegative = integer.refine(value => value >= 0, '距离不得小于零')
const point = z.object({ x: integer, y: integer }).strict()
const visibility = z.enum(['public', 'gm']), access = z.enum(['unspecified', 'required', 'intentionalIsolation'])
const openingFields = { wallId: id, offsetReferenceVertexId: id, offsetMm: nonnegative, widthMm: positive, kind: z.enum(['door', 'window']), state: z.enum(['open', 'closed']), locked: z.boolean(), secret: z.boolean(), revealed: z.boolean() }
export const buildingCommandSchemasV3 = [
  z.object({ type: z.literal('createRoom'), id, floorId: id, boundaryMm: z.array(point).min(3).max(256), thicknessMm: positive, layerId: id.optional(), purpose: z.string().max(1000).optional(), visibility: visibility.optional(), accessExpectation: access.optional(),
    supportRef: z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict().optional(), materialRef: z.object({ id, version: positive }).strict().optional() }).strict(),
  z.object({ type: z.literal('updateRoom'), id, changes: z.object({ purpose: z.string().max(1000).optional(), visibility: visibility.optional(), accessExpectation: access.optional() }).strict() }).strict(),
  z.object({ type: z.literal('addOpening'), id, ...openingFields, state: openingFields.state.optional(), locked: z.boolean().optional(), secret: z.boolean().optional(), revealed: z.boolean().optional(), layerId: id.optional() }).strict(),
  z.object({ type: z.literal('updateOpening'), id, changes: z.object(openingFields).partial().strict() }).strict(),
  z.object({ type: z.literal('deleteOpening'), id }).strict(),
  z.object({ type: z.literal('setEntranceOpenings'), ids: z.array(id).max(COMMAND_LIMIT_V3).refine(values => new Set(values).size === values.length, '入口 ID 不能重复') }).strict(),
] as const
const commandSchema = z.array(z.discriminatedUnion('type', buildingCommandSchemasV3)).max(COMMAND_LIMIT_V3)
const commandTypes = new Set(buildingCommandSchemasV3.map(schema => schema.shape.type.value))
export const isBuildingCommandV3 = (command: { type: string }): command is BuildingCommandV3 => commandTypes.has(command.type as BuildingCommandV3['type'])
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const requireEntity = <T>(record: Record<string, T>, key: string, label: string): T => {
  const entity = own(record, key)
  if (!entity) throw new Error(`${label}不存在：${key}。`)
  return entity
}
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const coordinateKey = (p: PointMm) => `${p.x}\0${p.y}`
const edgeKey = (a: string, b: string) => [a, b].sort().join('\0')
const position = (scene: SceneDocumentV3, id: string): PointMm => { const v = requireEntity(scene.vertices, id, '顶点'); return { x: v.xMm, y: v.yMm } }
const cross = (a: PointMm, b: PointMm, c: PointMm): bigint => (BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(a.y)) - (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(a.x))
const onSegment = (p: PointMm, a: PointMm, b: PointMm): boolean => cross(a, b, p) === 0n && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
const interior = (p: PointMm, a: PointMm, b: PointMm) => !same(p, a) && !same(p, b) && onSegment(p, a, b)
const projection = (a: PointMm, b: PointMm, p: PointMm) => (BigInt(b.x) - BigInt(a.x)) * (BigInt(p.x) - BigInt(a.x)) + (BigInt(b.y) - BigInt(a.y)) * (BigInt(p.y) - BigInt(a.y))
const squaredDistance = (a: PointMm, b: PointMm) => (BigInt(b.x) - BigInt(a.x)) ** 2n + (BigInt(b.y) - BigInt(a.y)) ** 2n
const exactDistance = (a: PointMm, b: PointMm): number | null => {
  const square = squaredDistance(a, b), root = Math.round(Math.sqrt(Number(square)))
  return Number.isSafeInteger(root) && BigInt(root) ** 2n === square ? root : null
}
const sign = (value: bigint) => value < 0n ? -1 : value > 0n ? 1 : 0
const properCross = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => sign(cross(a, b, c)) * sign(cross(a, b, d)) < 0 && sign(cross(c, d, a)) * sign(cross(c, d, b)) < 0
const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => properCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Accept either drawn direction and retain all intentional collinear vertices. */
function normalizedBoundary(input: PointMm[]): PointMm[] {
  const points = structuredClone(input)
  if (points.length > 3 && same(points[0], points.at(-1)!)) points.pop()
  if (points.length < 3 || new Set(points.map(coordinateKey)).size !== points.length) throw new Error('房间须至少三个不同顶点，不能有重复点。')
  let area = 0n
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length]
    area += BigInt(a.x) * BigInt(b.y) - BigInt(b.x) * BigInt(a.y)
    if (cross(a, b, c) === 0n && (BigInt(b.x) - BigInt(a.x)) * (BigInt(c.x) - BigInt(b.x)) + (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.y) - BigInt(b.y)) < 0n) throw new Error('房间边界不能折返。')
    for (let j = i + 1; j < points.length; j++) if (j !== i + 1 && !(i === 0 && j === points.length - 1) && meet(a, b, points[j], points[(j + 1) % points.length])) throw new Error('房间须为非自交、无自接触的简单多边形。')
  }
  if (!area) throw new Error('房间面积必须大于零。')
  return area < 0n ? points.reverse() : points
}

function roomOwnsWall(room: RoomV2, wall: WallV2): boolean {
  const ids = room.boundaryVertexIds
  return ids.some((id, i) => edgeKey(id, ids[(i + 1) % ids.length]) === edgeKey(wall.startVertexId, wall.endVertexId))
}

/** Explicit lock/preview closure, including joins, room supports and anchored notes. */
export function buildingDependantsV3(scene: SceneDocumentV3, wallIds: readonly string[], additionalIds: readonly string[] = []): string[] {
  const primary = wallIds.flatMap(id => own(scene.walls, id) ?? []), endpoints = new Set(primary.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
  const walls = Object.values(scene.walls).filter(wall => endpoints.has(wall.startVertexId) || endpoints.has(wall.endVertexId))
  const relatedWallIds = new Set(walls.map(wall => wall.id)), rooms = Object.values(scene.rooms).filter(room => walls.some(wall => roomOwnsWall(room, wall)) || additionalIds.includes(room.id))
  const roomIds = new Set(rooms.map(room => room.id)), openings = Object.values(scene.openings).filter(opening => relatedWallIds.has(opening.wallId)), openingIds = new Set(openings.map(opening => opening.id))
  const ids = new Set([...additionalIds, ...endpoints, ...walls.map(wall => wall.id), ...rooms.map(room => room.id), ...openings.map(opening => opening.id)])
  for (const room of rooms) if (room.supportRef.kind === 'terrainArea') ids.add(room.supportRef.id)
  for (const prop of Object.values(scene.props)) if (prop.supportRef.kind === 'room' && roomIds.has(prop.supportRef.id) || prop.roomId !== undefined && roomIds.has(prop.roomId)) ids.add(prop.id)
  for (const path of Object.values(scene.paths)) if (path.supportRefs.some(ref => ref.kind === 'room' && roomIds.has(ref.id))) ids.add(path.id)
  for (const connection of Object.values(scene.terrainConnections)) if ([connection.from, connection.to].some(end => end.surfaceRef.kind === 'room' && roomIds.has(end.surfaceRef.id)) || connection.openingId !== null && openingIds.has(connection.openingId)) ids.add(connection.id)
  let changed = true
  while (changed) {
    changed = false
    for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) if (!ids.has(group.id) && Object.values(group.members).some(member => member.propId !== null && ids.has(member.propId))) { ids.add(group.id); changed = true }
    for (const note of Object.values(scene.notes)) if (!ids.has(note.id) && note.anchor.type === 'entity' && ids.has(note.anchor.entityId)) { ids.add(note.id); changed = true }
  }
  return [...ids].sort()
}

export interface BuildingImpactV3 {
  affectedIds: string[]
  createdIds: string[]
  changedIds: string[]
  removedIds: string[]
  layerIds: string[]
  commandCost: number
  reason: string | null
}
const entities = (scene: SceneDocumentV3): Map<string, Editable> => new Map(LAYER_ENTITY_COLLECTIONS_V3.flatMap(collection => Object.values(scene[collection]) as Editable[]).map(entity => [entity.id, entity]))
const emptyImpact = (): BuildingImpactV3 => ({ affectedIds: [], createdIds: [], changedIds: [], removedIds: [], layerIds: [], commandCost: 0, reason: null })
function diffImpact(before: SceneDocumentV3, after: SceneDocumentV3, affected: Set<string>): BuildingImpactV3 {
  const left = entities(before), right = entities(after), createdIds = [...right.keys()].filter(id => !left.has(id)), removedIds = [...left.keys()].filter(id => !right.has(id)), changedIds = [...left.keys()].filter(id => right.has(id) && (!equal(left.get(id), right.get(id)) || before.entityLayers[id] !== after.entityLayers[id]))
  for (const id of [...createdIds, ...removedIds, ...changedIds]) affected.add(id)
  const affectedIds = [...affected].sort(), layerIds = [...new Set(affectedIds.flatMap(id => [before.entityLayers[id], after.entityLayers[id]]).filter((id): id is string => !!id))].sort()
  return { affectedIds, createdIds: createdIds.sort(), removedIds: removedIds.sort(), changedIds: changedIds.sort(), layerIds, commandCost: createdIds.length + removedIds.length + changedIds.length + Number(!equal(before.constraints, after.constraints)), reason: null }
}

function assertUnlocked(scene: SceneDocumentV3, ids: Iterable<string>, affected: Set<string>, ignoreLocks: boolean) {
  const byId = entities(scene), locked: string[] = []
  for (const id of ids) {
    affected.add(id)
    const entity = byId.get(id)
    if (entity?.editLocked || entity && scene.userLayers[scene.entityLayers[id]]?.editLocked) locked.push(id)
  }
  if (!ignoreLocks && locked.length) throw new Error(`建筑事务涉及已锁定实体、用户图层或依赖：${locked.join('、')}。`)
}
function targetLayer(scene: SceneDocumentV3, floorId: string, layerId: string | undefined, ignoreLocks: boolean) {
  const layer = layerId === undefined ? orderedLayersV3(scene, floorId)[0] : own(scene.userLayers, layerId)
  if (!layer || layer.floorId !== floorId) throw new Error('新增建筑实体须选择同 Floor 的现存用户图层。')
  if (!ignoreLocks && layer.editLocked) throw new Error(`用户图层已锁定：${layer.id}。`)
  return layer.id
}
function reserveId(scene: SceneDocumentV3, id: string, used: Set<string>) {
  if (id.length > 256 || id === '__proto__' || used.has(id) || Object.hasOwn(scene.userLayers, id)) throw new Error(`新增建筑实体须使用未占用且不超过256字的独立 ID：${id}。`)
  used.add(id)
}

function createRoom(scene: SceneDocumentV3, command: Extract<BuildingCommandV3, { type: 'createRoom' }>, affected: Set<string>, ignoreLocks: boolean) {
  requireEntity(scene.floors, command.floorId, 'Floor')
  const layerId = targetLayer(scene, command.floorId, command.layerId, ignoreLocks), used = geometryIdentityIdsV3(scene)
  reserveId(scene, command.id, used)
  const polygon = normalizedBoundary(command.boundaryMm), support = command.supportRef ?? { kind: 'floor', id: command.floorId }
  let elevation = 0
  if (support.kind === 'floor') { if (support.id !== command.floorId) throw new Error('房间与支撑Floor必须相同。') }
  else {
    const area = requireEntity(scene.terrainAreas, support.id, '支撑地形')
    if (area.floorId !== command.floorId) throw new Error('房间与支撑地形须属于同Floor。')
    elevation = area.groundElevationMm
    assertUnlocked(scene, buildingDependantsV3(scene, [], [area.id]), affected, ignoreLocks)
  }
  for (const room of Object.values(scene.rooms)) if (room.floorId === command.floorId && polygonsOverlapV2(polygon, roomPointsV2(scene, room))) throw new Error(`新房间与已有房间 ${room.id} 正面积重叠。`)
  const originalWalls = Object.values(scene.walls).filter(wall => wall.floorId === command.floorId), cuts = new Map<string, PointMm[]>(), expandedEdges: PointMm[][] = []
  const touchedWalls = new Set<string>()
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], points = new Map([[coordinateKey(a), a], [coordinateKey(b), b]])
    for (const wall of originalWalls) {
      const c = position(scene, wall.startVertexId), d = position(scene, wall.endVertexId)
      if (!meet(a, b, c, d)) continue
      if (properCross(a, b, c, d)) throw new Error(`新边界穿过现有墙 ${wall.id}，请先明确拆分。`)
      touchedWalls.add(wall.id)
      for (const p of [c, d]) if (interior(p, a, b)) points.set(coordinateKey(p), p)
      const split = cuts.get(wall.id) ?? []
      for (const p of [a, b]) if (interior(p, c, d) && !split.some(existing => same(existing, p))) split.push(p)
      cuts.set(wall.id, split)
    }
    expandedEdges.push([...points.values()].sort((p, q) => { const difference = projection(a, b, p) - projection(a, b, q); return sign(difference) }))
  }
  const boundary = expandedEdges.flatMap(points => points.slice(0, -1))
  if (boundary.length > 256) throw new Error('共墙展开后房间超过256个边界顶点。')
  const coordinates = new Map<string, string>()
  for (const vertex of Object.values(scene.vertices).filter(vertex => vertex.floorId === command.floorId)) {
    const key = coordinateKey({ x: vertex.xMm, y: vertex.yMm })
    if (coordinates.has(key) && coordinates.get(key) !== vertex.id && boundary.some(p => coordinateKey(p) === key)) throw new Error('共点存在多个不同顶点身份，不能隐式合并。')
    coordinates.set(key, vertex.id)
  }
  const reused = boundary.flatMap(p => coordinates.get(coordinateKey(p)) ?? [])
  assertUnlocked(scene, buildingDependantsV3(scene, [...touchedWalls], reused), affected, ignoreLocks)
  let nextVertex = 0, nextWall = 0
  const makeVertex = (p: PointMm, inheritedLayer = layerId): string => {
    const key = coordinateKey(p), existing = coordinates.get(key)
    if (existing) return existing
    const id = `${command.id}:vertex:${nextVertex++}`
    reserveId(scene, id, used)
    scene.vertices[id] = { id, floorId: command.floorId, editLocked: false, xMm: p.x, yMm: p.y }
    scene.entityLayers[id] = inheritedLayer; coordinates.set(key, id)
    return id
  }
  const makeWallId = () => { const id = `${command.id}:wall:${nextWall++}`; reserveId(scene, id, used); return id }
  // Split each original wall once, preserving its original start segment identity.
  for (const wall of originalWalls) {
    const internal = cuts.get(wall.id) ?? []
    if (!internal.length) continue
    if (wall.topStyle?.overlays.length) throw new Error(`墙 ${wall.id} 带局部材质覆盖，须先明确拆分覆盖范围。`)
    const a = position(scene, wall.startVertexId), b = position(scene, wall.endVertexId)
    const points = [a, ...internal.sort((p, q) => sign(projection(a, b, p) - projection(a, b, q))), b], ids = points.map(p => makeVertex(p, scene.entityLayers[wall.id]))
    const children = points.slice(0, -1).map((_p, i): WallV2 => ({ ...structuredClone(wall), id: i === 0 ? wall.id : makeWallId(), startVertexId: ids[i], endVertexId: ids[i + 1] }))
    for (const opening of Object.values(scene.openings).filter(opening => opening.wallId === wall.id)) {
      const fromStart = opening.offsetReferenceVertexId === wall.startVertexId, reference = fromStart ? a : b
      for (const p of internal) {
        const distance = squaredDistance(reference, p), near = BigInt(opening.offsetMm) ** 2n, far = (BigInt(opening.offsetMm) + BigInt(opening.widthMm)) ** 2n
        if (near < distance && far > distance) throw new Error(`开口 ${opening.id} 跨越拆分点，不能拆墙。`)
      }
      const ordered = fromStart ? children : [...children].reverse()
      let target: WallV2 | undefined, offset = 0
      for (const child of ordered) {
        const nearId = fromStart ? child.startVertexId : child.endVertexId, farId = fromStart ? child.endVertexId : child.startVertexId
        const near2 = squaredDistance(reference, position(scene, nearId)), far2 = squaredDistance(reference, position(scene, farId))
        if (BigInt(opening.offsetMm) ** 2n >= near2 && (BigInt(opening.offsetMm) + BigInt(opening.widthMm)) ** 2n <= far2) {
          const distance = exactDistance(position(scene, nearId), reference)
          if (distance === null) throw new Error(`开口 ${opening.id} 拆分后无法保持整数毫米计量，拒绝近似重映射。`)
          target = child; offset = opening.offsetMm - distance
          opening.offsetReferenceVertexId = nearId
          break
        }
      }
      if (!target) throw new Error(`开口 ${opening.id} 不能映射到唯一拆分墙段。`)
      opening.wallId = target.id; opening.offsetMm = offset
    }
    for (const room of Object.values(scene.rooms)) if (roomOwnsWall(room, wall)) {
      room.boundaryVertexIds = room.boundaryVertexIds.flatMap((id, i, source) => {
        const next = source[(i + 1) % source.length]
        if (id === wall.startVertexId && next === wall.endVertexId) return [id, ...ids.slice(1, -1)]
        if (id === wall.endVertexId && next === wall.startVertexId) return [id, ...ids.slice(1, -1).reverse()]
        return [id]
      })
    }
    for (const child of children) { scene.walls[child.id] = child; scene.entityLayers[child.id] = scene.entityLayers[wall.id] }
  }
  const boundaryIds = boundary.map(p => makeVertex(p)), wallByEdge = new Map(Object.values(scene.walls).map(wall => [edgeKey(wall.startVertexId, wall.endVertexId), wall]))
  for (let i = 0; i < boundaryIds.length; i++) {
    const startVertexId = boundaryIds[i], endVertexId = boundaryIds[(i + 1) % boundaryIds.length], existing = wallByEdge.get(edgeKey(startVertexId, endVertexId))
    if (existing) {
      if (existing.thicknessMm !== command.thicknessMm) throw new Error(`共墙 ${existing.id} 的既有厚度为 ${existing.thicknessMm} mm，请明确采用相同厚度。`)
      continue
    }
    const id = makeWallId(), wall: WallV2 = { id, floorId: command.floorId, editLocked: false, startVertexId, endVertexId, thicknessMm: command.thicknessMm, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.walls[id] = wall; scene.entityLayers[id] = layerId; wallByEdge.set(edgeKey(startVertexId, endVertexId), wall)
  }
  let floorStyle: SurfaceStyle | null = null
  if (command.materialRef) {
    const material = requireEntity(scene.materials, command.materialRef.id, '房间材质')
    if (material.version !== command.materialRef.version || !material.applicableSurfaces.includes('room')) throw new Error('房间材质须引用已采用的适用固定版本。')
    floorStyle = { base: { materialRef: structuredClone(command.materialRef), tileSizeMm: structuredClone(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
  }
  scene.rooms[command.id] = { id: command.id, floorId: command.floorId, editLocked: false, boundaryVertexIds: boundaryIds, purpose: command.purpose ?? '房间', visibility: command.visibility ?? 'public', accessExpectation: command.accessExpectation ?? 'unspecified', supportRef: structuredClone(support), groundElevationMm: elevation, floorStyle }
  scene.entityLayers[command.id] = layerId
}

function mutate(scene: SceneDocumentV3, command: BuildingCommandV3, affected: Set<string>, ignoreLocks: boolean) {
  switch (command.type) {
    case 'createRoom': createRoom(scene, command, affected, ignoreLocks); break
    case 'updateRoom': {
      const room = requireEntity(scene.rooms, command.id, '房间')
      if (Object.entries(command.changes).every(([key, value]) => equal(room[key as keyof RoomV2], value))) break
      const walls = Object.values(scene.walls).filter(wall => roomOwnsWall(room, wall))
      assertUnlocked(scene, buildingDependantsV3(scene, walls.map(wall => wall.id), [room.id]), affected, ignoreLocks)
      Object.assign(room, structuredClone(command.changes)); break
    }
    case 'addOpening': {
      reserveId(scene, command.id, geometryIdentityIdsV3(scene))
      const wall = requireEntity(scene.walls, command.wallId, '附着墙'), layerId = targetLayer(scene, wall.floorId, command.layerId ?? scene.entityLayers[wall.id], ignoreLocks)
      assertUnlocked(scene, buildingDependantsV3(scene, [wall.id]), affected, ignoreLocks)
      scene.openings[command.id] = { id: command.id, floorId: wall.floorId, editLocked: false, wallId: wall.id, offsetReferenceVertexId: command.offsetReferenceVertexId, offsetMm: command.offsetMm, widthMm: command.widthMm, kind: command.kind, state: command.state ?? 'closed', locked: command.locked ?? false, secret: command.secret ?? false, revealed: command.revealed ?? false }
      scene.entityLayers[command.id] = layerId; break
    }
    case 'updateOpening': {
      const opening = requireEntity(scene.openings, command.id, '门窗')
      if (Object.entries(command.changes).every(([key, value]) => equal(opening[key as keyof OpeningV2], value))) break
      const wall = requireEntity(scene.walls, command.changes.wallId ?? opening.wallId, '附着墙')
      if (wall.floorId !== opening.floorId) throw new Error('门窗重新附着须保持同Floor。')
      assertUnlocked(scene, buildingDependantsV3(scene, [opening.wallId, wall.id], [opening.id]), affected, ignoreLocks)
      Object.assign(opening, structuredClone(command.changes)); break
    }
    case 'deleteOpening': {
      const opening = requireEntity(scene.openings, command.id, '门窗')
      assertUnlocked(scene, buildingDependantsV3(scene, [opening.wallId], [opening.id]), affected, ignoreLocks)
      const notes = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityId === opening.id)
      if (notes.length || Object.values(scene.terrainConnections).some(connection => connection.openingId === opening.id) || scene.constraints.entranceOpeningIds.includes(opening.id)) throw new Error('门窗仍被注记、地形连接或显式入口引用，请先明确移除引用。')
      delete scene.openings[opening.id]; delete scene.entityLayers[opening.id]; break
    }
    case 'setEntranceOpenings': {
      if (equal(scene.constraints.entranceOpeningIds, command.ids)) break
      const openings = [...new Set([...scene.constraints.entranceOpeningIds, ...command.ids])].map(id => requireEntity(scene.openings, id, '入口门'))
      assertUnlocked(scene, buildingDependantsV3(scene, openings.map(opening => opening.wallId), openings.map(opening => opening.id)), affected, ignoreLocks)
      scene.constraints.entranceOpeningIds = [...command.ids]; break
    }
  }
}

/** Internal detached-candidate operation. The caller validates the whole transaction once. */
export function applyBuildingCommandV3(scene: SceneDocumentV3, command: BuildingCommandV3): BuildingImpactV3 {
  const before = structuredClone(scene), affected = new Set<string>()
  mutate(scene, command, affected, false)
  return diffImpact(before, scene, affected)
}

/** Complete structural scope, including unchanged locked dependants and cross-layer joins. */
export function previewBuildingCommandsV3(scene: SceneDocumentV3, commands: readonly BuildingCommandV3[]): BuildingImpactV3 {
  const impact = emptyImpact(), source = validateSceneSnapshotV3(scene)
  if (!source.ok) { impact.reason = `当前场景无效：${source.errors.map(issue => issue.message).join('；')}`; return impact }
  const issue = inspectJsonInput(commands), checked = issue ? null : commandSchema.safeParse(commands)
  if (issue || !checked?.success) { impact.reason = `建筑指令无效：${issue?.message ?? (checked && !checked.success ? checked.error.issues.map(issue => issue.message).join('；') : '')}`; return impact }
  const next = structuredClone(source.document), affected = new Set<string>(), byId = entities(source.document)
  let cost = 0
  try {
    for (const command of checked.data as BuildingCommandV3[]) {
      const before = structuredClone(next)
      mutate(next, command, affected, true)
      cost += diffImpact(before, next, affected).commandCost
    }
    Object.assign(impact, diffImpact(source.document, next, affected), { commandCost: cost })
    const locked = impact.affectedIds.filter(id => byId.get(id)?.editLocked || byId.has(id) && source.document.userLayers[source.document.entityLayers[id]]?.editLocked)
    const lockedTarget = impact.layerIds.filter(id => source.document.userLayers[id]?.editLocked)
    if (locked.length || lockedTarget.length) throw new Error(`建筑事务涉及已锁定实体、图层或依赖：${locked.join('、')}${lockedTarget.length ? `；图层 ${lockedTarget.join('、')}` : ''}。`)
    if (cost > COMMAND_LIMIT_V3) throw new Error('展开后的整体建筑事务超过256条操作预算，不能拆批绕过。')
    const result = validateSceneV3(next)
    if (!result.ok) throw new Error(`事务未采用：${result.errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；')}`)
  } catch (error) {
    Object.assign(impact, diffImpact(source.document, next, affected), { commandCost: cost })
    impact.reason = error instanceof Error ? error.message : String(error)
  }
  return impact
}
