import { z } from 'zod'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson, inspectJsonInput } from '../validation/json.js'
import { polygonsOverlap, propFootprint, terrainPoints } from '../geometry/geometry.js'
import { buildScatterRegeneration, sha256Text } from '../geometry/scatter.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { Editable, MaterialPaint, PointMm, PrefabInstance, PropOverrideField, Prop, SceneDocument, SizeMm, SurfaceRef, VersionRef, Wall } from '../model/scene.js'

type SurfaceKind = 'room' | 'terrainArea'
export type BaseSceneCommand =
  | { type: 'moveVertex'; id: string; positionMm: PointMm }
  | { type: 'setWallThickness'; id: string; thicknessMm: number }
  | { type: 'reverseWall'; id: string }
  | { type: 'splitWall'; id: string; positionMm: PointMm; newVertexId: string; newWallId: string }
  | { type: 'setSurfaceMaterial'; kind: SurfaceKind | 'wall'; id: string; materialRef: VersionRef }
  | { type: 'setSurfacePaint'; kind: SurfaceKind; id: string; changes: { rotationDeg?: number; originMm?: PointMm; tileSizeMm?: SizeMm } }
  | { type: 'moveTerrainPoint'; areaId: string; pointId: string; positionMm: PointMm }
  | { type: 'setTerrainElevation'; id: string; groundElevationMm: number }
  | { type: 'setConnectionBlocked'; id: string; blocksMovement: boolean }
  | { type: 'removeTerrainConnection'; id: string }
  | { type: 'setOverlayBoundary'; kind: SurfaceKind; id: string; overlayId: string; boundaryMm: PointMm[] }
  | { type: 'regenerateScatter'; id: string; densityFactor?: number }
  | { type: 'addProp'; id: string; floorId: string; definitionRef: VersionRef; positionMm: PointMm; rotationDeg?: number; supportRef?: SurfaceRef }
  | { type: 'copyProp'; id: string; newId: string; offsetMm: PointMm }
  | { type: 'deleteProp'; id: string }
  | { type: 'detachScatterMember'; groupId: string; propId: string }
  | { type: 'setEditLock'; kind: 'prop' | 'prefabInstance' | 'scatterGroup' | 'terrainArea' | 'terrainConnection'; id: string; locked: boolean }
  | { type: 'transformPrefab'; id: string; anchorMm?: PointMm; rotationDeg?: number }
  | { type: 'unpackPrefab'; id: string }
  | { type: 'updateProp'; id: string; changes: { positionMm?: PointMm; rotationDeg?: number } }
  | { type: 'replacePropAppearance'; id: string; definitionRef: VersionRef }

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '不能使用保留 ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '毫米坐标必须是安全整数')
const positive = integer.refine(value => value > 0, '尺寸必须大于零')
const angle = z.number().finite().min(0).lt(360)
const point = z.object({ x: integer, y: integer }).strict()
const size = z.object({ width: positive, height: positive }).strict()
const version = z.object({ id, version: positive }).strict()
const surfaceRef = z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict()
const kind = z.enum(['room', 'terrainArea'])
const commandSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveVertex'), id, positionMm: point }).strict(),
  z.object({ type: z.literal('setWallThickness'), id, thicknessMm: positive }).strict(),
  z.object({ type: z.literal('reverseWall'), id }).strict(),
  z.object({ type: z.literal('splitWall'), id, positionMm: point, newVertexId: id, newWallId: id }).strict(),
  z.object({ type: z.literal('setSurfaceMaterial'), kind: z.enum(['room', 'terrainArea', 'wall']), id, materialRef: version }).strict(),
  z.object({ type: z.literal('setSurfacePaint'), kind, id, changes: z.object({ rotationDeg: angle.optional(), originMm: point.optional(), tileSizeMm: size.optional() }).strict() }).strict(),
  z.object({ type: z.literal('moveTerrainPoint'), areaId: id, pointId: id, positionMm: point }).strict(),
  z.object({ type: z.literal('setTerrainElevation'), id, groundElevationMm: integer }).strict(),
  z.object({ type: z.literal('setConnectionBlocked'), id, blocksMovement: z.boolean() }).strict(),
  z.object({ type: z.literal('removeTerrainConnection'), id }).strict(),
  z.object({ type: z.literal('setOverlayBoundary'), kind, id, overlayId: id, boundaryMm: z.array(point).min(3).max(512) }).strict(),
  z.object({ type: z.literal('regenerateScatter'), id, densityFactor: z.number().finite().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal('addProp'), id, floorId: id, definitionRef: version, positionMm: point, rotationDeg: angle.optional(), supportRef: surfaceRef.optional() }).strict(),
  z.object({ type: z.literal('copyProp'), id, newId: id, offsetMm: point }).strict(),
  z.object({ type: z.literal('deleteProp'), id }).strict(),
  z.object({ type: z.literal('detachScatterMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('setEditLock'), kind: z.enum(['prop', 'prefabInstance', 'scatterGroup', 'terrainArea', 'terrainConnection']), id, locked: z.boolean() }).strict(),
  z.object({ type: z.literal('transformPrefab'), id, anchorMm: point.optional(), rotationDeg: angle.optional() }).strict(),
  z.object({ type: z.literal('unpackPrefab'), id }).strict(),
  z.object({ type: z.literal('updateProp'), id, changes: z.object({ positionMm: point.optional(), rotationDeg: angle.optional() }).strict() }).strict(),
  z.object({ type: z.literal('replacePropAppearance'), id, definitionRef: version }).strict(),
])).max(256, '单次事务最多 256 个操作')
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const requireEntity = <T>(record: Record<string, T>, key: string, label: string): T => {
  const entity = own(record, key)
  if (!entity) throw new Error(`${label}不存在：${key}。`)
  return entity
}
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360
// Explicit edits quantize once, including negative half millimetres away from zero.
export const roundMm = (value: number) => {
  const magnitude = Math.abs(value), half = Math.round(magnitude * 2) / 2
  // Trigonometric evaluations can land a few ulps to either side of an exact half.
  const stable = Math.abs(magnitude - half) <= Number.EPSILON * Math.max(1, magnitude) * 4 ? half : magnitude
  const rounded = Math.round(stable)
  return rounded === 0 ? 0 : value < 0 ? -rounded : rounded
}
const distance2 = (a: PointMm, b: PointMm) => (BigInt(a.x) - BigInt(b.x)) ** 2n + (BigInt(a.y) - BigInt(b.y)) ** 2n

function lockDependants(scene: SceneDocument, entities: Editable[], includeAnchoredNotes = false): Editable[] {
  const affected = new Map(entities.map(entity => [entity.id, entity]))
  if (includeAnchoredNotes) {
    let changed = true
    while (changed) {
      changed = false
      for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && affected.has(note.anchor.entityId) && !affected.has(note.id)) {
        affected.set(note.id, note); changed = true
      }
    }
  }
  // Updating a member also updates its persisted override record in the parent.
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) {
    if (Object.values(group.members).some(member => member.propId !== null && affected.has(member.propId))) affected.set(group.id, group)
  }
  return [...affected.values()]
}
/** Locks cover geometry meaning and anchored dependants, even when their own fields are unchanged. */
function assertUnlocked(scene: SceneDocument, entities: Editable[], includeAnchoredNotes = false) {
  const locked = lockDependants(scene, entities, includeAnchoredNotes).filter(entity => entity.editLocked)
  if (locked.length) throw new Error(`事务涉及已锁定的实体：${locked.map(entity => entity.id).join('、')}。`)
}

function roomOwnsWall(scene: SceneDocument, wall: Wall, roomId: string): boolean {
  const vertices = scene.rooms[roomId].boundaryVertexIds
  return vertices.some((id, i) => id === wall.startVertexId && vertices[(i + 1) % vertices.length] === wall.endVertexId || id === wall.endVertexId && vertices[(i + 1) % vertices.length] === wall.startVertexId)
}
function architecturalDependants(scene: SceneDocument, primary: Wall[]): Editable[] {
  const primaryEndpoints = new Set(primary.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
  // Adjacent wall joins change when a wall direction or thickness changes.
  const walls = Object.values(scene.walls).filter(wall => primaryEndpoints.has(wall.startVertexId) || primaryEndpoints.has(wall.endVertexId))
  const wallIds = new Set(walls.map(wall => wall.id))
  const rooms = Object.values(scene.rooms).filter(room => walls.some(wall => roomOwnsWall(scene, wall, room.id)))
  const roomIds = new Set(rooms.map(room => room.id))
  const openings = Object.values(scene.openings).filter(opening => wallIds.has(opening.wallId)), openingIds = new Set(openings.map(opening => opening.id))
  return [
    ...[...primaryEndpoints].flatMap(id => own(scene.vertices, id) ?? []), ...walls, ...rooms, ...openings,
    ...Object.values(scene.props).filter(prop => prop.supportRef.kind === 'room' && roomIds.has(prop.supportRef.id) || prop.roomId !== undefined && roomIds.has(prop.roomId)),
    ...Object.values(scene.paths).filter(path => path.supportRefs.some(ref => ref.kind === 'room' && roomIds.has(ref.id))),
    ...Object.values(scene.terrainConnections).filter(connection => [connection.from, connection.to].some(end => end.surfaceRef.kind === 'room' && roomIds.has(end.surfaceRef.id)) || connection.openingId !== null && openingIds.has(connection.openingId)),
  ]
}
function terrainDependants(scene: SceneDocument, areaId: string): Editable[] {
  const rooms = Object.values(scene.rooms).filter(room => room.supportRef.kind === 'terrainArea' && room.supportRef.id === areaId), roomIds = new Set(rooms.map(room => room.id))
  const edges = Object.values(scene.terrainEdges).filter(edge => edge.source.areaId === areaId || edge.neighborAreaId === areaId), edgeIds = new Set(edges.map(edge => edge.id))
  const paths = Object.values(scene.paths).filter(path => path.supportRefs.some(ref => ref.kind === 'terrainArea' && ref.id === areaId || ref.kind === 'room' && roomIds.has(ref.id))), pathIds = new Set(paths.map(path => path.id))
  const isSupport = (ref: { kind: string; id: string }) => ref.kind === 'terrainArea' && ref.id === areaId || ref.kind === 'room' && roomIds.has(ref.id)
  const walls = Object.values(scene.walls).filter(wall => rooms.some(room => roomOwnsWall(scene, wall, room.id))), wallIds = new Set(walls.map(wall => wall.id))
  return [
    scene.terrainAreas[areaId], ...rooms, ...edges, ...paths, ...walls,
    ...Object.values(scene.openings).filter(opening => wallIds.has(opening.wallId)),
    ...Object.values(scene.props).filter(prop => isSupport(prop.supportRef)),
    ...Object.values(scene.terrainConnections).filter(connection => isSupport(connection.from.surfaceRef) || isSupport(connection.to.surfaceRef)),
    ...Object.values(scene.scatterGroups).filter(group => group.domain.kind === 'area' && group.domain.areaId === areaId || group.domain.kind === 'path' && pathIds.has(group.domain.pathId) || group.domain.kind === 'edgeBand' && edgeIds.has(group.domain.edgeId)),
  ]
}

/** Read-only selection affordance; commands still check their exact affected set when applied. */
export function isEntityEditLocked(scene: SceneDocument, entityId: string): boolean {
  let affected: Editable[]
  const prop = own(scene.props, entityId), vertex = own(scene.vertices, entityId), wall = own(scene.walls, entityId)
  const prefab = own(scene.prefabInstances, entityId), scatter = own(scene.scatterGroups, entityId)
  const area = own(scene.terrainAreas, entityId) ?? Object.values(scene.terrainAreas).find(item => item.boundaryMm.some(point => point.id === entityId))
  if (prop) affected = [prop]
  else if (prefab || scatter) {
    const group = (prefab ?? scatter)!
    affected = [group, ...Object.values(group.members).flatMap(member => member.propId === null ? [] : own(scene.props, member.propId) ?? [])]
  } else if (vertex) {
    const walls = Object.values(scene.walls).filter(item => item.startVertexId === vertex.id || item.endVertexId === vertex.id)
    affected = [vertex, ...Object.values(scene.rooms).filter(room => room.boundaryVertexIds.includes(vertex.id)), ...architecturalDependants(scene, walls)]
  } else if (wall) affected = architecturalDependants(scene, [wall])
  else if (area) affected = terrainDependants(scene, area.id)
  else {
    const entity = own(scene.openings, entityId) ?? own(scene.rooms, entityId) ?? own(scene.terrainEdges, entityId) ?? own(scene.terrainConnections, entityId) ?? own(scene.paths, entityId) ?? own(scene.regions, entityId) ?? own(scene.notes, entityId)
    if (!entity) return false
    affected = [entity]
  }
  return lockDependants(scene, affected, true).some(entity => entity.editLocked)
}
function memberRecord(scene: SceneDocument, propId: string) {
  for (const group of Object.values(scene.scatterGroups)) {
    const member = Object.values(group.members).find(member => member.propId === propId)
    if (member) return member
  }
  for (const group of Object.values(scene.prefabInstances)) {
    const member = Object.values(group.members).find(member => member.propId === propId)
    if (member) return member
  }
}
function addOverrides(member: { overrideFields: PropOverrideField[] } | undefined, fields: PropOverrideField[]) {
  if (member) {
    member.overrideFields = [...new Set([...member.overrideFields, ...fields])]
    if ('state' in member) member.state = 'manual'
  }
}
function hasId(value: unknown, id: string): boolean {
  if (!value || typeof value !== 'object') return false
  return ('id' in value && value.id === id) || Object.values(value).some(child => hasId(child, id))
}

function assertPlacementSupportUnlocked(scene: SceneDocument, floorId: string, support: SurfaceRef): void {
  requireEntity(scene.floors, floorId, '楼层')
  const supportEntities: Editable[] = []
  const checkSupport = (ref: SurfaceRef): void => {
    if (ref.kind === 'floor') {
      requireEntity(scene.floors, ref.id, '支撑楼层')
      if (ref.id !== floorId) throw new Error('物件与支撑表面必须属于同一楼层。')
      return
    }
    const entity = ref.kind === 'room' ? requireEntity(scene.rooms, ref.id, '支撑房间') : requireEntity(scene.terrainAreas, ref.id, '支撑地形')
    if (entity.floorId !== floorId) throw new Error('物件与支撑表面必须属于同一楼层。')
    supportEntities.push(entity)
    if (ref.kind === 'room') checkSupport(scene.rooms[ref.id].supportRef)
  }
  checkSupport(support)
  assertUnlocked(scene, supportEntities)
}
function nextPropRenderOrder(scene: SceneDocument, floorId: string, layer: Prop['renderLayer']): number {
  // Newly placed objects appear above existing peers within their system render band.
  let renderOrder = 0
  for (const prop of Object.values(scene.props)) if (prop.floorId === floorId && prop.renderLayer === layer) renderOrder = Math.max(renderOrder, prop.renderOrder + 1)
  if (!Number.isSafeInteger(renderOrder)) throw new Error('当前叠放顺序已达到安全上限，不能继续放置。')
  return renderOrder
}
function buildAddedProp(scene: SceneDocument, command: Extract<BaseSceneCommand, { type: 'addProp' }>): Prop {
  if (hasId(scene, command.id)) throw new Error('新物件必须使用工程中未占用的独立 ID。')
  const definition = requireEntity(scene.propDefinitions, command.definitionRef.id, '物件定义')
  if (definition.version !== command.definitionRef.version) throw new Error('物件引用版本与已采用快照不同。')
  const support = command.supportRef ?? { kind: 'floor' as const, id: command.floorId }
  assertPlacementSupportUnlocked(scene, command.floorId, support)
  const renderOrder = nextPropRenderOrder(scene, command.floorId, definition.defaultRenderLayer)
  return {
    id: command.id, floorId: command.floorId, editLocked: false, definitionRef: cloneJson(command.definitionRef),
    appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
    positionMm: cloneJson(command.positionMm), rotationDeg: command.rotationDeg ?? 0,
    footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    visibility: createPublicVisibility(scene).surface(support) ? 'public' : 'gm',
    supportRef: cloneJson(support), ...(support.kind === 'room' ? { roomId: support.id } : {}),
    renderLayer: definition.defaultRenderLayer, renderOrder, shadowClass: definition.defaultShadowClass, shadowOverride: null,
  }
}

function copyProp(scene: SceneDocument, command: Extract<BaseSceneCommand, { type: 'copyProp' }>): Prop {
  const source = requireEntity(scene.props, command.id, '源物件')
  if (hasId(scene, command.newId)) throw new Error('副本必须使用工程中未占用的独立 ID。')
  if (memberRecord(scene, source.id)) throw new Error('此复制入口只支持独立物件；组合或散布成员须先明确拆开或脱离。')
  assertUnlocked(scene, [source], true)
  assertPlacementSupportUnlocked(scene, source.floorId, source.supportRef)
  if (source.roomId !== undefined && (source.supportRef.kind !== 'room' || source.supportRef.id !== source.roomId)) assertPlacementSupportUnlocked(scene, source.floorId, { kind: 'room', id: source.roomId })
  const copy = cloneJson(source)
  copy.id = command.newId
  copy.positionMm = { x: source.positionMm.x + command.offsetMm.x, y: source.positionMm.y + command.offsetMm.y }
  copy.renderOrder = nextPropRenderOrder(scene, source.floorId, source.renderLayer)
  // A source may inherit privacy from its room as well as its explicit support.
  // Keep that effective restriction on the new object, including later re-parenting.
  if (!createPublicVisibility(scene).prop(source)) copy.visibility = 'gm'
  return copy
}

export type BasePlacePropOptions = { id?: string; rotationDeg?: number; supportRef?: SurfaceRef }
const placementOptions = z.object({ id: id.optional(), rotationDeg: angle.optional(), supportRef: surfaceRef.optional() }).strict()

/** Detached preview template from an adopted definition. Acceptance still requires addProp's whole-scene validation. */
export function createBasePlacedProp(scene: SceneDocument, definitionId: string, positionMm: PointMm, context: PreparationContext, options: BasePlacePropOptions = {}): Prop {
  const jsonIssue = inspectJsonInput({ definitionId, positionMm, options })
  if (jsonIssue) throw new Error(`放置参数无效：${jsonIssue.message}`)
  const checked = placementOptions.safeParse(options)
  if (!checked.success) throw new Error(`放置参数无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  const definition = requireEntity(scene.propDefinitions, definitionId, '物件定义'), floorId = Object.keys(scene.floors)[0]
  const command = checkedCommands([{ type: 'addProp', id: checked.data.id ?? context.ids.nextId(), floorId,
    definitionRef: { id: definitionId, version: definition.version }, positionMm,
    ...(checked.data.rotationDeg === undefined ? {} : { rotationDeg: checked.data.rotationDeg }),
    ...(checked.data.supportRef === undefined ? {} : { supportRef: checked.data.supportRef }),
  }])[0] as Extract<BaseSceneCommand, { type: 'addProp' }>
  return buildAddedProp(scene, command)
}

function splitWall(scene: SceneDocument, command: Extract<BaseSceneCommand, { type: 'splitWall' }>) {
  const wall = requireEntity(scene.walls, command.id, '墙'), a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
  const p = command.positionMm, start = { x: a.xMm, y: a.yMm }, end = { x: b.xMm, y: b.yMm }
  const dx = BigInt(end.x) - BigInt(start.x), dy = BigInt(end.y) - BigInt(start.y), px = BigInt(p.x) - BigInt(start.x), py = BigInt(p.y) - BigInt(start.y)
  const length2 = dx * dx + dy * dy, projection = dx * px + dy * py
  if (dx * py !== dy * px || projection <= 0n || projection >= length2) throw new Error('拆分点必须是墙中心线上的整数毫米内点。')
  if (command.newVertexId === command.newWallId || hasId(scene, command.newVertexId) || hasId(scene, command.newWallId)) throw new Error('拆分的新顶点与墙必须使用工程中未占用的独立 ID。')
  assertUnlocked(scene, architecturalDependants(scene, [wall]), true)
  const attached = Object.values(scene.openings).filter(opening => opening.wallId === wall.id)
  for (const opening of attached) {
    const fromStart = opening.offsetReferenceVertexId === a.id, reference = fromStart ? start : end, splitDistance2 = distance2(reference, p)
    const near2 = BigInt(opening.offsetMm) ** 2n, far2 = (BigInt(opening.offsetMm) + BigInt(opening.widthMm)) ** 2n
    if (near2 < splitDistance2 && far2 > splitDistance2) throw new Error(`开口 ${opening.id} 跨越拆分点，不能拆墙。`)
    const staysWithReference = far2 <= splitDistance2
    const onFirst = fromStart === staysWithReference
    opening.wallId = onFirst ? wall.id : command.newWallId
    if (!staysWithReference) {
      opening.offsetReferenceVertexId = command.newVertexId
      opening.offsetMm = roundMm(opening.offsetMm - Math.hypot(p.x - reference.x, p.y - reference.y))
    }
  }
  const originalEnd = wall.endVertexId
  scene.vertices[command.newVertexId] = { id: command.newVertexId, floorId: wall.floorId, editLocked: false, xMm: p.x, yMm: p.y }
  scene.walls[command.newWallId] = { ...cloneJson(wall), id: command.newWallId, startVertexId: command.newVertexId, endVertexId: originalEnd }
  wall.endVertexId = command.newVertexId
  // Surface overlays have global IDs and cannot be duplicated onto both children.
  if (wall.topStyle?.overlays.length) throw new Error('带局部材质覆盖的墙暂不支持拆分，请先明确拆分覆盖范围。')
  for (const room of Object.values(scene.rooms)) {
    const ids = room.boundaryVertexIds, next: string[] = []
    for (let i = 0; i < ids.length; i++) {
      next.push(ids[i])
      const after = ids[(i + 1) % ids.length]
      if (ids[i] === a.id && after === b.id || ids[i] === b.id && after === a.id) next.push(command.newVertexId)
    }
    room.boundaryVertexIds = next
  }
}

function transformPrefab(scene: SceneDocument, command: Extract<BaseSceneCommand, { type: 'transformPrefab' }>, fixedUprightPropIds?: ReadonlySet<string>) {
  const group = requireEntity(scene.prefabInstances, command.id, '组合'), anchor = command.anchorMm ?? group.anchorMm, rotation = command.rotationDeg ?? group.rotationDeg
  if (equal(anchor, group.anchorMm) && rotation === group.rotationDeg) return
  const props = Object.values(group.members).flatMap(member => member.propId === null ? [] : [requireEntity(scene.props, member.propId, '组合成员')])
  assertUnlocked(scene, [group, ...props], true)
  const radians = (rotation - group.rotationDeg) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  for (const prop of props) {
    const x = prop.positionMm.x - group.anchorMm.x, y = prop.positionMm.y - group.anchorMm.y
    prop.positionMm = { x: roundMm(anchor.x + x * cos - y * sin), y: roundMm(anchor.y + x * sin + y * cos) }
    prop.rotationDeg = fixedUprightPropIds?.has(prop.id) ? 0 : normalizeAngle(prop.rotationDeg + rotation - group.rotationDeg)
  }
  group.anchorMm = cloneJson(anchor); group.rotationDeg = rotation
}

function unpackPrefab(scene: SceneDocument, group: PrefabInstance) {
  const props = Object.values(group.members).flatMap(member => member.propId === null ? [] : [requireEntity(scene.props, member.propId, '组合成员')])
  assertUnlocked(scene, [group, ...props], true)
  const anchored = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityKind === 'prefabInstance' && note.anchor.entityId === group.id)
  if (anchored.length) throw new Error(`组合仍被注记引用，暂不能拆开：${anchored.map(note => note.id).join('、')}。`)
  // Group privacy is an upstream constraint. Persist it before removing that relation.
  if (group.visibility === 'gm') for (const prop of props) prop.visibility = 'gm'
  delete scene.prefabInstances[group.id]
}

function assertNoAnchoredNotes(scene: SceneDocument, entityId: string): void {
  const notes = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityId === entityId)
  if (notes.length) throw new Error(`实体仍被注记引用，不能删除：${notes.map(note => note.id).join('、')}。`)
}
function deleteProp(scene: SceneDocument, propId: string): void {
  const prop = requireEntity(scene.props, propId, '物件')
  assertUnlocked(scene, [prop], true); assertNoAnchoredNotes(scene, prop.id)
  for (const group of Object.values(scene.prefabInstances)) {
    const member = Object.values(group.members).find(member => member.propId === prop.id)
    if (member) member.propId = null
  }
  for (const group of Object.values(scene.scatterGroups)) {
    const entry = Object.entries(group.members).find(([, member]) => member.propId === prop.id)
    if (!entry) continue
    const [key, member] = entry, footprint = propFootprint(prop), distance = group.minDistanceMm
    const minX = Math.floor(Math.min(...footprint.map(p => p.x))) - distance, minY = Math.floor(Math.min(...footprint.map(p => p.y))) - distance
    const maxX = Math.ceil(Math.max(...footprint.map(p => p.x))) + distance, maxY = Math.ceil(Math.max(...footprint.map(p => p.y))) + distance
    member.propId = null; member.state = 'deleted'
    group.exclusions.push({ id: `scatter-delete-${sha256Text(JSON.stringify([group.id, key]))}`, reason: 'delete', sourceCandidateKey: key, boundaryMm: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] })
  }
  delete scene.props[prop.id]
}
function regenerateScatter(scene: SceneDocument, command: Extract<BaseSceneCommand, { type: 'regenerateScatter' }>, context: PreparationContext): void {
  const proposal = buildScatterRegeneration(scene, command.id, command.densityFactor, { allocatePropId: () => context.ids.nextId() }), group = scene.scatterGroups[command.id]
  const adoptedIds = new Set(proposal.props.map(prop => prop.id))
  const deletions = proposal.removePropIds.filter(id => !adoptedIds.has(id))
  const changes = proposal.props.filter(prop => !equal(scene.props[prop.id], prop))
  if (equal(group, proposal.group) && !deletions.length && !changes.length) return
  assertUnlocked(scene, [group, ...deletions.map(id => scene.props[id]), ...changes.flatMap(prop => scene.props[prop.id] ?? [])], true)
  for (const id of deletions) assertNoAnchoredNotes(scene, id)
  for (const id of proposal.removePropIds) delete scene.props[id]
  for (const prop of proposal.props) scene.props[prop.id] = prop
  scene.scatterGroups[group.id] = proposal.group
}

function checkedCommands(commands: readonly BaseSceneCommand[]): BaseSceneCommand[] {
  if (!Array.isArray(commands) || commands.length > 256) throw new Error('编辑指令必须是数组，单次事务最多 256 个操作。')
  const jsonIssue = inspectJsonInput(commands)
  if (jsonIssue) throw new Error(`编辑指令无效：${jsonIssue.message}`)
  const checked = commandSchema.safeParse(commands)
  if (!checked.success) throw new Error(`编辑指令无效：${checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  return checked.data as BaseSceneCommand[]
}

/** Internal only: caller owns a detached draft, strict command parsing and final validation. */
export function applyCommandDraft(next: SceneDocument, commands: readonly BaseSceneCommand[], context: PreparationContext, fixedUprightPropIds?: ReadonlySet<string>): SceneDocument {
  for (const command of commands) {
    switch (command.type) {
      case 'moveVertex': {
        const vertex = requireEntity(next.vertices, command.id, '顶点')
        if (vertex.xMm === command.positionMm.x && vertex.yMm === command.positionMm.y) break
        const walls = Object.values(next.walls).filter(wall => [wall.startVertexId, wall.endVertexId].includes(vertex.id))
        const rooms = Object.values(next.rooms).filter(room => room.boundaryVertexIds.includes(vertex.id))
        assertUnlocked(next, [vertex, ...rooms, ...architecturalDependants(next, walls)], true)
        vertex.xMm = command.positionMm.x; vertex.yMm = command.positionMm.y
        break
      }
      case 'setWallThickness': case 'reverseWall': {
        const wall = requireEntity(next.walls, command.id, '墙')
        if (command.type === 'setWallThickness' && wall.thicknessMm === command.thicknessMm) break
        assertUnlocked(next, architecturalDependants(next, [wall]), true)
        if (command.type === 'reverseWall') [wall.startVertexId, wall.endVertexId] = [wall.endVertexId, wall.startVertexId]
        else wall.thicknessMm = command.thicknessMm
        break
      }
      case 'splitWall': splitWall(next, command); break
      case 'moveTerrainPoint': {
        const area = requireEntity(next.terrainAreas, command.areaId, '地形'), point = area.boundaryMm.find(point => point.id === command.pointId)
        if (!point) throw new Error(`地形轮廓点不存在：${command.pointId}。`)
        if (equal(point.positionMm, command.positionMm)) break
        const index = area.boundaryMm.indexOf(point), count = area.boundaryMm.length
        const previous = area.boundaryMm[(index + count - 1) % count].positionMm, following = area.boundaryMm[(index + 1) % count].positionMm
        // A boundary move can change the effective geometry of a lower-priority
        // area without changing that area's stored points. Include that dependency.
        const changedBands = [[previous, point.positionMm, command.positionMm], [following, point.positionMm, command.positionMm]]
        const covered = Object.values(next.terrainAreas).filter(other => other.floorId === area.floorId && other.id !== area.id && other.coveragePriority < area.coveragePriority && changedBands.some(band => polygonsOverlap(band, terrainPoints(other))))
        assertUnlocked(next, [...terrainDependants(next, area.id), ...covered.flatMap(other => terrainDependants(next, other.id))], true)
        point.positionMm = cloneJson(command.positionMm)
        break
      }
      case 'setSurfaceMaterial': case 'setSurfacePaint': {
        const surface = command.kind === 'room' ? requireEntity(next.rooms, command.id, '房间') : command.kind === 'wall' ? requireEntity(next.walls, command.id, '墙') : requireEntity(next.terrainAreas, command.id, '地形')
        const style = 'floorStyle' in surface ? surface.floorStyle : 'topStyle' in surface ? surface.topStyle : surface.surfaceStyle
        if (command.type === 'setSurfacePaint') {
          if (!style) throw new Error('表面尚未设置底材。')
          if (Object.entries(command.changes).every(([key, value]) => equal(style.base[key as keyof MaterialPaint], value))) break
          assertUnlocked(next, [surface])
          Object.assign(style.base, cloneJson(command.changes))
        } else {
          const material = requireEntity(next.materials, command.materialRef.id, '材质定义')
          if (material.version !== command.materialRef.version) throw new Error('材质引用版本与已采用快照不同。')
          if (!material.applicableSurfaces.includes(command.kind === 'room' ? 'room' : command.kind === 'wall' ? 'wall' : 'terrain')) throw new Error('材质不适用于此表面。')
          if (style && equal(style.base.materialRef, command.materialRef)) break
          assertUnlocked(next, [surface])
          if (style) style.base.materialRef = cloneJson(command.materialRef)
          else {
            const created = { base: { materialRef: cloneJson(command.materialRef), tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
            if ('floorStyle' in surface) surface.floorStyle = created
            else if ('topStyle' in surface) surface.topStyle = created
            else surface.surfaceStyle = created
          }
        }
        break
      }
      case 'setTerrainElevation': {
        const area = requireEntity(next.terrainAreas, command.id, '地形')
        if (area.groundElevationMm === command.groundElevationMm) break
        assertUnlocked(next, terrainDependants(next, area.id), true)
        area.groundElevationMm = command.groundElevationMm
        break
      }
      case 'setConnectionBlocked': {
        const connection = requireEntity(next.terrainConnections, command.id, '地形连接')
        if (connection.blocksMovement === command.blocksMovement) break
        assertUnlocked(next, [connection], true); connection.blocksMovement = command.blocksMovement
        break
      }
      case 'removeTerrainConnection': {
        const connection = requireEntity(next.terrainConnections, command.id, '地形连接')
        assertUnlocked(next, [connection], true); assertNoAnchoredNotes(next, connection.id)
        delete next.terrainConnections[connection.id]
        break
      }
      case 'setOverlayBoundary': {
        const surface = command.kind === 'room' ? requireEntity(next.rooms, command.id, '房间') : requireEntity(next.terrainAreas, command.id, '地形')
        const style = 'floorStyle' in surface ? surface.floorStyle : surface.surfaceStyle
        const overlay = style?.overlays.find(item => item.id === command.overlayId)
        if (!overlay) throw new Error(`局部材质覆盖不存在：${command.overlayId}。`)
        if (equal(overlay.boundaryMm, command.boundaryMm)) break
        assertUnlocked(next, [surface]); overlay.boundaryMm = cloneJson(command.boundaryMm)
        break
      }
      case 'regenerateScatter': regenerateScatter(next, command, context); break
      case 'addProp': next.props[command.id] = buildAddedProp(next, command); break
      case 'copyProp': next.props[command.newId] = copyProp(next, command); break
      case 'deleteProp': deleteProp(next, command.id); break
      case 'detachScatterMember': {
        const group = requireEntity(next.scatterGroups, command.groupId, '散布组'), prop = requireEntity(next.props, command.propId, '散布成员')
        const member = Object.values(group.members).find(member => member.propId === prop.id)
        if (!member) throw new Error('该物件不是此散布组的活成员。')
        assertUnlocked(next, [group, prop], true)
        const wasPublic = createPublicVisibility(next).prop(prop)
        member.propId = null; member.state = 'detached'
        if (!wasPublic) prop.visibility = 'gm'
        break
      }
      case 'setEditLock': {
        const collection = command.kind === 'prop' ? next.props : command.kind === 'prefabInstance' ? next.prefabInstances : command.kind === 'scatterGroup' ? next.scatterGroups : command.kind === 'terrainArea' ? next.terrainAreas : next.terrainConnections
        const entity = requireEntity<Editable>(collection, command.id, '可锁定实体')
        if (entity.editLocked === command.locked) break
        if (command.kind === 'prop') {
          const parents = [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)].filter(group => Object.values(group.members).some(member => member.propId === entity.id))
          assertUnlocked(next, parents)
        }
        entity.editLocked = command.locked
        break
      }
      case 'transformPrefab': transformPrefab(next, command, fixedUprightPropIds); break
      case 'unpackPrefab': unpackPrefab(next, requireEntity(next.prefabInstances, command.id, '组合')); break
      case 'updateProp': case 'replacePropAppearance': {
        const prop = requireEntity(next.props, command.id, '物件')
        const member = memberRecord(next, prop.id)
        if (command.type === 'updateProp') {
          const fields = (Object.keys(command.changes) as ('positionMm' | 'rotationDeg')[]).filter(key => !equal(prop[key], command.changes[key]))
          if (!fields.length) break
          assertUnlocked(next, [prop], true)
          Object.assign(prop, cloneJson(command.changes)); addOverrides(member, fields)
        } else {
          const definition = requireEntity(next.propDefinitions, command.definitionRef.id, '物件定义')
          if (definition.version !== command.definitionRef.version) throw new Error('物件引用版本与已采用快照不同。')
          if (equal(prop.definitionRef, command.definitionRef) && equal(prop.appearance, definition.defaultAppearance)) break
          assertUnlocked(next, [prop])
          prop.definitionRef = cloneJson(command.definitionRef); prop.appearance = cloneJson(definition.defaultAppearance)
          addOverrides(member, ['definitionRef', 'appearance'])
        }
        break
      }
    }
  }
  return next
}
