import { z } from 'zod'
import { inspectJsonInput } from '../schema'
import { polygonsOverlapV2, propFootprintV2, terrainPointsV2 } from './geometry'
import { buildScatterRegenerationV2, sha256TextV2 } from './scatter'
import { validateSceneV2 } from './schema'
import { validateSceneSnapshotV2 } from './snapshots'
import { createPublicVisibilityV2 } from './visibility'
import type { Editable, MaterialPaint, PointMm, PrefabInstance, PropOverrideField, SceneDocumentV2, SizeMm, VersionRef, WallV2 } from './types'

type SurfaceKind = 'room' | 'terrainArea'
export type SceneCommandV2 =
  | { type: 'moveVertex'; id: string; positionMm: PointMm }
  | { type: 'setWallThickness'; id: string; thicknessMm: number }
  | { type: 'reverseWall'; id: string }
  | { type: 'splitWall'; id: string; positionMm: PointMm; newVertexId: string; newWallId: string }
  | { type: 'setSurfaceMaterial'; kind: SurfaceKind; id: string; materialRef: VersionRef }
  | { type: 'setSurfacePaint'; kind: SurfaceKind; id: string; changes: { rotationDeg?: number; originMm?: PointMm; tileSizeMm?: SizeMm } }
  | { type: 'moveTerrainPoint'; areaId: string; pointId: string; positionMm: PointMm }
  | { type: 'setTerrainElevation'; id: string; groundElevationMm: number }
  | { type: 'setConnectionBlocked'; id: string; blocksMovement: boolean }
  | { type: 'removeTerrainConnection'; id: string }
  | { type: 'setOverlayBoundary'; kind: SurfaceKind; id: string; overlayId: string; boundaryMm: PointMm[] }
  | { type: 'regenerateScatter'; id: string; densityFactor?: number }
  | { type: 'deleteProp'; id: string }
  | { type: 'detachScatterMember'; groupId: string; propId: string }
  | { type: 'setEditLock'; kind: 'prop' | 'scatterGroup' | 'terrainArea' | 'terrainConnection'; id: string; locked: boolean }
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
const kind = z.enum(['room', 'terrainArea'])
const commandSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveVertex'), id, positionMm: point }).strict(),
  z.object({ type: z.literal('setWallThickness'), id, thicknessMm: positive }).strict(),
  z.object({ type: z.literal('reverseWall'), id }).strict(),
  z.object({ type: z.literal('splitWall'), id, positionMm: point, newVertexId: id, newWallId: id }).strict(),
  z.object({ type: z.literal('setSurfaceMaterial'), kind, id, materialRef: version }).strict(),
  z.object({ type: z.literal('setSurfacePaint'), kind, id, changes: z.object({ rotationDeg: angle.optional(), originMm: point.optional(), tileSizeMm: size.optional() }).strict() }).strict(),
  z.object({ type: z.literal('moveTerrainPoint'), areaId: id, pointId: id, positionMm: point }).strict(),
  z.object({ type: z.literal('setTerrainElevation'), id, groundElevationMm: integer }).strict(),
  z.object({ type: z.literal('setConnectionBlocked'), id, blocksMovement: z.boolean() }).strict(),
  z.object({ type: z.literal('removeTerrainConnection'), id }).strict(),
  z.object({ type: z.literal('setOverlayBoundary'), kind, id, overlayId: id, boundaryMm: z.array(point).min(3).max(512) }).strict(),
  z.object({ type: z.literal('regenerateScatter'), id, densityFactor: z.number().finite().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal('deleteProp'), id }).strict(),
  z.object({ type: z.literal('detachScatterMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('setEditLock'), kind: z.enum(['prop', 'scatterGroup', 'terrainArea', 'terrainConnection']), id, locked: z.boolean() }).strict(),
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
const roundMm = (value: number) => {
  const magnitude = Math.abs(value), half = Math.round(magnitude * 2) / 2
  // Trigonometric evaluations can land a few ulps to either side of an exact half.
  const stable = Math.abs(magnitude - half) <= Number.EPSILON * Math.max(1, magnitude) * 4 ? half : magnitude
  const rounded = Math.round(stable)
  return rounded === 0 ? 0 : value < 0 ? -rounded : rounded
}
const distance2 = (a: PointMm, b: PointMm) => (BigInt(a.x) - BigInt(b.x)) ** 2n + (BigInt(a.y) - BigInt(b.y)) ** 2n

/** Locks cover geometry meaning and anchored dependants, even when their own fields are unchanged. */
function assertUnlocked(scene: SceneDocumentV2, entities: Editable[], includeAnchoredNotes = false) {
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
  const locked = [...affected.values()].filter(entity => entity.editLocked)
  if (locked.length) throw new Error(`事务涉及已锁定的实体：${locked.map(entity => entity.id).join('、')}。`)
}

function roomOwnsWall(scene: SceneDocumentV2, wall: WallV2, roomId: string): boolean {
  const vertices = scene.rooms[roomId].boundaryVertexIds
  return vertices.some((id, i) => id === wall.startVertexId && vertices[(i + 1) % vertices.length] === wall.endVertexId || id === wall.endVertexId && vertices[(i + 1) % vertices.length] === wall.startVertexId)
}
function architecturalDependants(scene: SceneDocumentV2, primary: WallV2[]): Editable[] {
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
function terrainDependants(scene: SceneDocumentV2, areaId: string): Editable[] {
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
function memberRecord(scene: SceneDocumentV2, propId: string) {
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

function splitWall(scene: SceneDocumentV2, command: Extract<SceneCommandV2, { type: 'splitWall' }>) {
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
  scene.walls[command.newWallId] = { ...structuredClone(wall), id: command.newWallId, startVertexId: command.newVertexId, endVertexId: originalEnd }
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

function transformPrefab(scene: SceneDocumentV2, command: Extract<SceneCommandV2, { type: 'transformPrefab' }>) {
  const group = requireEntity(scene.prefabInstances, command.id, '组合'), anchor = command.anchorMm ?? group.anchorMm, rotation = command.rotationDeg ?? group.rotationDeg
  if (equal(anchor, group.anchorMm) && rotation === group.rotationDeg) return
  const props = Object.values(group.members).flatMap(member => member.propId === null ? [] : [requireEntity(scene.props, member.propId, '组合成员')])
  assertUnlocked(scene, [group, ...props], true)
  const radians = (rotation - group.rotationDeg) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  for (const prop of props) {
    const x = prop.positionMm.x - group.anchorMm.x, y = prop.positionMm.y - group.anchorMm.y
    prop.positionMm = { x: roundMm(anchor.x + x * cos - y * sin), y: roundMm(anchor.y + x * sin + y * cos) }
    prop.rotationDeg = normalizeAngle(prop.rotationDeg + rotation - group.rotationDeg)
  }
  group.anchorMm = structuredClone(anchor); group.rotationDeg = rotation
}

function unpackPrefab(scene: SceneDocumentV2, group: PrefabInstance) {
  const props = Object.values(group.members).flatMap(member => member.propId === null ? [] : [requireEntity(scene.props, member.propId, '组合成员')])
  assertUnlocked(scene, [group, ...props], true)
  const anchored = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityKind === 'prefabInstance' && note.anchor.entityId === group.id)
  if (anchored.length) throw new Error(`组合仍被注记引用，暂不能拆开：${anchored.map(note => note.id).join('、')}。`)
  // Group privacy is an upstream constraint. Persist it before removing that relation.
  if (group.visibility === 'gm') for (const prop of props) prop.visibility = 'gm'
  delete scene.prefabInstances[group.id]
}

function assertNoAnchoredNotes(scene: SceneDocumentV2, entityId: string): void {
  const notes = Object.values(scene.notes).filter(note => note.anchor.type === 'entity' && note.anchor.entityId === entityId)
  if (notes.length) throw new Error(`实体仍被注记引用，不能删除：${notes.map(note => note.id).join('、')}。`)
}
function deleteProp(scene: SceneDocumentV2, propId: string): void {
  const prop = requireEntity(scene.props, propId, '物件')
  assertUnlocked(scene, [prop], true); assertNoAnchoredNotes(scene, prop.id)
  for (const group of Object.values(scene.prefabInstances)) {
    const member = Object.values(group.members).find(member => member.propId === prop.id)
    if (member) member.propId = null
  }
  for (const group of Object.values(scene.scatterGroups)) {
    const entry = Object.entries(group.members).find(([, member]) => member.propId === prop.id)
    if (!entry) continue
    const [key, member] = entry, footprint = propFootprintV2(prop), distance = group.minDistanceMm
    const minX = Math.floor(Math.min(...footprint.map(p => p.x))) - distance, minY = Math.floor(Math.min(...footprint.map(p => p.y))) - distance
    const maxX = Math.ceil(Math.max(...footprint.map(p => p.x))) + distance, maxY = Math.ceil(Math.max(...footprint.map(p => p.y))) + distance
    member.propId = null; member.state = 'deleted'
    group.exclusions.push({ id: `scatter-delete-${sha256TextV2(JSON.stringify([group.id, key]))}`, reason: 'delete', sourceCandidateKey: key, boundaryMm: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] })
  }
  delete scene.props[prop.id]
}
function regenerateScatter(scene: SceneDocumentV2, command: Extract<SceneCommandV2, { type: 'regenerateScatter' }>): void {
  const proposal = buildScatterRegenerationV2(scene, command.id, command.densityFactor), group = scene.scatterGroups[command.id]
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

function checkedCommandsV2(commands: readonly SceneCommandV2[]): SceneCommandV2[] {
  if (!Array.isArray(commands) || commands.length > 256) throw new Error('编辑指令必须是数组，单次事务最多 256 个操作。')
  const jsonIssue = inspectJsonInput(commands)
  if (jsonIssue) throw new Error(`编辑指令无效：${jsonIssue.message}`)
  const checked = commandSchema.safeParse(commands)
  if (!checked.success) throw new Error(`编辑指令无效：${checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；')}`)
  return checked.data as SceneCommandV2[]
}

function applyCommandDraftV2(next: SceneDocumentV2, commands: readonly SceneCommandV2[]): SceneDocumentV2 {
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
        const covered = Object.values(next.terrainAreas).filter(other => other.floorId === area.floorId && other.id !== area.id && other.coveragePriority < area.coveragePriority && changedBands.some(band => polygonsOverlapV2(band, terrainPointsV2(other))))
        assertUnlocked(next, [...terrainDependants(next, area.id), ...covered.flatMap(other => terrainDependants(next, other.id))], true)
        point.positionMm = structuredClone(command.positionMm)
        break
      }
      case 'setSurfaceMaterial': case 'setSurfacePaint': {
        const surface = command.kind === 'room' ? requireEntity(next.rooms, command.id, '房间') : requireEntity(next.terrainAreas, command.id, '地形')
        const style = 'floorStyle' in surface ? surface.floorStyle : surface.surfaceStyle
        if (command.type === 'setSurfacePaint') {
          if (!style) throw new Error('表面尚未设置底材。')
          if (Object.entries(command.changes).every(([key, value]) => equal(style.base[key as keyof MaterialPaint], value))) break
          assertUnlocked(next, [surface])
          Object.assign(style.base, structuredClone(command.changes))
        } else {
          const material = requireEntity(next.materials, command.materialRef.id, '材质定义')
          if (material.version !== command.materialRef.version) throw new Error('材质引用版本与已采用快照不同。')
          if (!material.applicableSurfaces.includes(command.kind === 'room' ? 'room' : 'terrain')) throw new Error('材质不适用于此表面。')
          if (style && equal(style.base.materialRef, command.materialRef)) break
          assertUnlocked(next, [surface])
          if (style) style.base.materialRef = structuredClone(command.materialRef)
          else {
            const created = { base: { materialRef: structuredClone(command.materialRef), tileSizeMm: structuredClone(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
            if ('floorStyle' in surface) surface.floorStyle = created
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
        assertUnlocked(next, [surface]); overlay.boundaryMm = structuredClone(command.boundaryMm)
        break
      }
      case 'regenerateScatter': regenerateScatter(next, command); break
      case 'deleteProp': deleteProp(next, command.id); break
      case 'detachScatterMember': {
        const group = requireEntity(next.scatterGroups, command.groupId, '散布组'), prop = requireEntity(next.props, command.propId, '散布成员')
        const member = Object.values(group.members).find(member => member.propId === prop.id)
        if (!member) throw new Error('该物件不是此散布组的活成员。')
        assertUnlocked(next, [group, prop], true)
        const wasPublic = createPublicVisibilityV2(next).prop(prop)
        member.propId = null; member.state = 'detached'
        if (!wasPublic) prop.visibility = 'gm'
        break
      }
      case 'setEditLock': {
        const collection = command.kind === 'prop' ? next.props : command.kind === 'scatterGroup' ? next.scatterGroups : command.kind === 'terrainArea' ? next.terrainAreas : next.terrainConnections
        const entity = requireEntity<Editable>(collection, command.id, '可锁定实体')
        if (entity.editLocked === command.locked) break
        if (command.kind === 'prop') {
          const parents = [...Object.values(next.prefabInstances), ...Object.values(next.scatterGroups)].filter(group => Object.values(group.members).some(member => member.propId === entity.id))
          assertUnlocked(next, parents)
        }
        entity.editLocked = command.locked
        break
      }
      case 'transformPrefab': transformPrefab(next, command); break
      case 'unpackPrefab': unpackPrefab(next, requireEntity(next.prefabInstances, command.id, '组合')); break
      case 'updateProp': case 'replacePropAppearance': {
        const prop = requireEntity(next.props, command.id, '物件')
        const member = memberRecord(next, prop.id)
        if (command.type === 'updateProp') {
          const fields = (Object.keys(command.changes) as ('positionMm' | 'rotationDeg')[]).filter(key => !equal(prop[key], command.changes[key]))
          if (!fields.length) break
          assertUnlocked(next, [prop], true)
          Object.assign(prop, structuredClone(command.changes)); addOverrides(member, fields)
        } else {
          const definition = requireEntity(next.propDefinitions, command.definitionRef.id, '物件定义')
          if (definition.version !== command.definitionRef.version) throw new Error('物件引用版本与已采用快照不同。')
          if (equal(prop.definitionRef, command.definitionRef) && equal(prop.appearance, definition.defaultAppearance)) break
          assertUnlocked(next, [prop])
          prop.definitionRef = structuredClone(command.definitionRef); prop.appearance = structuredClone(definition.defaultAppearance)
          addOverrides(member, ['definitionRef', 'appearance'])
        }
        break
      }
    }
  }
  return next
}

const transactionError = (result: Extract<ReturnType<typeof validateSceneV2>, { ok: false }>) => new Error(`事务未采用：${result.errors.map(error => `${error.entityId ? `${error.entityId}：` : ''}${error.message}`).join('；')}`)

// Scene snapshots contain plain, bounded JSON only. Compare values without
// allocating full-document JSON strings; an exactly reversed batch is a no-op.
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a), bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key, index) => key === bKeys[index] && sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/** Atomic finite command set shared by manual edits and future adopted proposals. */
export function applyCommandsV2(scene: SceneDocumentV2, commands: readonly SceneCommandV2[]): SceneDocumentV2 {
  const input = validateSceneV2(scene)
  if (!input.ok) throw new Error(`当前场景无效：${input.errors.map(error => error.message).join('；')}`)
  const checked = checkedCommandsV2(commands)
  const next = applyCommandDraftV2(structuredClone(scene), checked)
  const result = validateSceneV2(next)
  if (!result.ok) throw transactionError(result)
  // Preserve the general API's independently mutable candidate and JSON order.
  return next
}

/** Immutable editor path; external inputs and every changed result stay strict. */
export function applySnapshotCommandsV2(scene: SceneDocumentV2, commands: readonly SceneCommandV2[]): SceneDocumentV2 {
  const input = validateSceneSnapshotV2(scene)
  if (!input.ok) throw new Error(`当前场景无效：${input.errors.map(error => error.message).join('；')}`)
  const checked = checkedCommandsV2(commands)
  if (!checked.length) return input.document
  const next = applyCommandDraftV2(structuredClone(input.document), checked)
  if (sameJsonValue(next, input.document)) return input.document
  const result = validateSceneSnapshotV2(next)
  if (!result.ok) throw transactionError(result)
  return result.document
}
