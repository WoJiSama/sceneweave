import type { Issue, PointMm, Prop, SurfaceRef } from '../model/scene.js'
import { pointInPolygon, polygonInside, propFootprint, roomPoints, supportedPolygon } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { attachmentHash, type AttachmentScene } from './topology.js'
import type { AttachmentOwner, AttachmentSurface, PropAttachment } from './contracts.js'

const EPS = 1e-6
const same = (a: unknown, b: unknown) => attachmentHash(a) === attachmentHash(b)
export const normalizeAttachmentAngle = (angle: number): number => ((angle % 360) + 360) % 360
export const roundAttachmentMm = (value: number): number => {
  const n = Math.round(Math.abs(value) + Number.EPSILON * Math.max(1, Math.abs(value)) * 4)
  return n === 0 ? 0 : value < 0 ? -n : n
}
export function transformAttachmentPoint(point: PointMm, origin: PointMm, angle: number): PointMm {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return { x: origin.x + point.x * c - point.y * s, y: origin.y + point.x * s + point.y * c }
}
export function attachmentLocalPoint(point: PointMm, host: Prop): PointMm {
  const local = transformAttachmentPoint({ x: point.x - host.positionMm.x, y: point.y - host.positionMm.y }, { x: 0, y: 0 }, -host.rotationDeg)
  return { x: roundAttachmentMm(local.x), y: roundAttachmentMm(local.y) }
}
export function attachmentOwner(scene: AttachmentScene, ref: AttachmentOwner) {
  const entity = ref.kind === 'prop' ? scene.props[ref.id] : ref.kind === 'wall' ? scene.walls[ref.id] : ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : scene.terrainConnections[ref.id]
  if (!entity) throw new Error(`附着表面宿主不存在：${ref.id}。`)
  return entity
}
function rootElevation(scene: AttachmentScene, ref: SurfaceRef): number {
  const value = ref.kind === 'floor' ? scene.floors[ref.id] && 0 : ref.kind === 'room' ? scene.rooms[ref.id]?.groundElevationMm : scene.terrainAreas[ref.id]?.groundElevationMm
  if (value === undefined) throw new Error('附着根基不存在。')
  return value
}
function relationFor(scene: AttachmentScene, childId: string): PropAttachment | undefined {
  const rows = Object.values(scene.attachments ?? {}).filter((row): row is PropAttachment => row.mode !== 'embed' && row.child.id === childId)
  if (rows.length > 1) throw new Error('同一子物件不能有多条附着关系。')
  return rows[0]
}
/** Completeness includes concave edges, not only footprint corners. */
export function assertAttachmentPolygon(points: PointMm[]): void {
  if (points.length < 3 || new Set(points.map(p => `${p.x}:${p.y}`)).size !== points.length) throw new Error('承托面须为无重复点的完整多边形。')
  const signed = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - p.y * points[(i + 1) % points.length].x, 0)
  if (!signed) throw new Error('承托面不能为零面积。')
  const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const touch = (p: PointMm, a: PointMm, b: PointMm) => cross(a, b, p) === 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length]
    if (!cross(a, b, c) && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) throw new Error('承托面不能折返。')
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      const c = points[j], d = points[(j + 1) % points.length]
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || touch(a, c, d) || touch(b, c, d) || touch(c, a, b) || touch(d, a, b)) throw new Error('承托面不能自交或自接触。')
    }
  }
}
export function wallAttachmentFrame(scene: AttachmentScene, surface: AttachmentSurface) {
  if (surface.owner.kind !== 'wall' || surface.feature.kind !== 'wallSide') throw new Error('悬挂必须明确选择真实墙侧面。')
  const wall = scene.walls[surface.owner.id], f = surface.feature
  if (!wall || ![wall.startVertexId, wall.endVertexId].includes(f.referenceVertexId)) throw new Error('墙面稳定计量端点已不存在。')
  const a = scene.vertices[f.referenceVertexId], other = f.referenceVertexId === wall.startVertexId ? wall.endVertexId : wall.startVertexId, b = scene.vertices[other]
  if (!a || !b) throw new Error('墙面端点缺失。')
  const length = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm)
  if (!length || f.endMm > length + EPS) throw new Error('墙侧面超出实际墙长。')
  const u = { x: (b.xMm - a.xMm) / length, y: (b.yMm - a.yMm) / length }
  // Side is measured against the stable reference direction, even if wall storage reverses.
  const sign = f.side === 'left' ? 1 : -1, n = { x: -u.y * sign, y: u.x * sign }
  return { wall, feature: f, a: { x: a.xMm, y: a.yMm }, u, n, length, angleDeg: normalizeAttachmentAngle(Math.atan2(u.y, u.x) * 180 / Math.PI) }
}
export function attachmentOwnerPublic(scene: AttachmentScene, owner: AttachmentOwner, seen = new Set<string>()): boolean {
  const visible = createPublicVisibility(scene)
  if (owner.kind === 'prop') {
    const prop = scene.props[owner.id]
    if (!prop || !visible.prop(prop) || seen.has(prop.id)) return false
    const row = relationFor(scene, prop.id)
    if (!row) return true
    const surface = scene.attachmentSurfaces?.[row.surfaceId]
    return !!surface && attachmentOwnerPublic(scene, surface.owner, new Set([...seen, prop.id]))
  }
  return owner.kind === 'wall' ? visible.wall(owner.id) : owner.kind === 'terrainArea' ? visible.terrainArea(owner.id) : visible.terrainConnection(owner.id)
}
function wallRoot(scene: AttachmentScene, surface: AttachmentSurface, child: Prop): SurfaceRef {
  const wall = scene.walls[surface.owner.id]
  const related = Object.values(scene.rooms).filter(room => room.floorId === child.floorId && room.boundaryVertexIds.some((v, i) => {
    const other = room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length]
    return v === wall.startVertexId && other === wall.endVertexId || v === wall.endVertexId && other === wall.startVertexId
  }))
  const root = child.supportRef
  if (root.kind === 'room') {
    const room = related.find(room => room.id === root.id)
    if (!room || !pointInPolygon(child.positionMm, roomPoints(scene, room))) throw new Error('悬挂根基房间必须与所选墙的实际一侧相容。')
  } else if (root.kind === 'terrainArea' && !scene.terrainAreas[root.id] || root.kind === 'floor' && root.id !== child.floorId) throw new Error('悬挂根基不属于当前Floor。')
  return root
}
export interface PropContact { propId: string; actualSurfaceId: string | null; rootSupportRef: SurfaceRef; contactElevationMm: number; footprintMm: PointMm[]; childGeometryHash: string; surfaceGeometryHash: string | null }
export function propContactGeometryHash(prop: Prop): string { return attachmentHash({ floorId: prop.floorId, positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, footprintMm: prop.footprintMm, footprintOffsetMm: prop.footprintOffsetMm, supportRef: prop.supportRef, roomId: prop.roomId ?? null }) }
export function surfaceGeometry(scene: AttachmentScene, surface: AttachmentSurface): unknown {
  const owner = attachmentOwner(scene, surface.owner)
  if (surface.feature.kind === 'propTop' && surface.owner.kind === 'prop') {
    const prop = scene.props[surface.owner.id]
    return { feature: surface.feature, floorId: owner.floorId, positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, supportRef: prop.supportRef, elevationMm: propElevation(scene, prop.id, new Set()) }
  }
  if (surface.feature.kind === 'wallSide') {
    const frame = wallAttachmentFrame(scene, surface)
    return { feature: surface.feature, floorId: owner.floorId, a: frame.a, u: frame.u, thicknessMm: frame.wall.thicknessMm,
      openings: Object.values(scene.openings).filter(o => o.wallId === owner.id).map(o => [o.id, o.offsetReferenceVertexId, o.offsetMm, o.widthMm]) }
  }
  if (surface.owner.kind === 'terrainArea') {
    const area = scene.terrainAreas[surface.owner.id]
    return { feature: surface.feature, floorId: area.floorId, boundaryMm: area.boundaryMm, groundElevationMm: area.groundElevationMm, rockBody: area.rockBody ?? null }
  }
  if (surface.owner.kind === 'terrainConnection') return { feature: surface.feature, connection: scene.terrainConnections[surface.owner.id] }
  throw new Error('表面功能与宿主种类不相容。')
}
function propElevation(scene: AttachmentScene, propId: string, seen: Set<string>): number {
  if (seen.has(propId)) throw new Error('附着链不能成环。')
  const prop = scene.props[propId]
  if (!prop) throw new Error('附着链子物件已不存在。')
  const row = relationFor(scene, propId)
  if (!row) return rootElevation(scene, prop.supportRef)
  return evaluatePropAttachment(scene, row, new Set([...seen, propId])).contactElevationMm
}
export function evaluatePropAttachment(scene: AttachmentScene, row: PropAttachment, seen = new Set<string>()): PropContact {
  const child = scene.props[row.child.id], surface = scene.attachmentSurfaces?.[row.surfaceId]
  if (!child || !surface) throw new Error('附着物件或明确表面不存在。')
  const owner = attachmentOwner(scene, surface.owner)
  if (owner.id === child.id || owner.floorId !== child.floorId) throw new Error('不能自附着或跨Floor附着。')
  if (!surface.capabilities.includes(row.mode)) throw new Error('所选表面没有该附着能力。')
  if (!attachmentOwnerPublic(scene, surface.owner)) {
    // This candidate relationship cannot hide the child first and then use
    // that inherited privacy as permission for an otherwise public binding.
    // Existing group/root privacy still applies before the candidate relation.
    const withoutRelation = { ...scene, attachments: Object.fromEntries(Object.entries(scene.attachments ?? {}).filter(([id]) => id !== row.id)) }
    if (createPublicVisibility(withoutRelation).prop(child)) throw new Error('公开子物件不能依赖私密宿主或附着链。')
  }
  const footprint = propFootprint(child)
  let root: SurfaceRef, elevation: number, surfaceHash: string
  if (row.mode === 'support') {
    if (surface.owner.kind !== 'prop' || surface.feature.kind !== 'propTop' || row.anchor.kind !== 'horizontal') throw new Error('承托须选择物件真实水平面和局部锚点。')
    if (row.anchor.heightOffsetMm !== 0) throw new Error('承托接触不能留悬空高度偏移。')
    const host = scene.props[surface.owner.id], f = surface.feature
    assertAttachmentPolygon(f.polygonLocalMm)
    const localFootprint = propFootprint({ ...host, positionMm: { x: 0, y: 0 }, rotationDeg: 0 })
    if (!polygonInside(f.polygonLocalMm, localFootprint)) throw new Error('声明承托面超出宿主真实占地。')
    const polygon = f.polygonLocalMm.map(p => transformAttachmentPoint(p, host.positionMm, host.rotationDeg))
    if (!polygonInside(footprint, polygon)) throw new Error('完整旋转占地超出所选承托面。')
    const expected = transformAttachmentPoint(row.anchor.localMm, host.positionMm, host.rotationDeg)
    if (child.positionMm.x !== roundAttachmentMm(expected.x) || child.positionMm.y !== roundAttachmentMm(expected.y)
      || Math.abs(normalizeAttachmentAngle(host.rotationDeg + row.anchor.rotationOffsetDeg) - child.rotationDeg) > EPS) throw new Error('实际位置/旋转与承托局部锚点不一致。')
    const hostContact = resolvePropContact(scene, host.id, seen)
    root = hostContact.rootSupportRef
    elevation = hostContact.contactElevationMm + f.heightLocalMm
    surfaceHash = attachmentHash({ feature: surface.feature, floorId: host.floorId, positionMm: host.positionMm, rotationDeg: host.rotationDeg, supportRef: host.supportRef,
      elevationMm: hostContact.contactElevationMm })
  } else {
    if (row.anchor.kind !== 'vertical') throw new Error('悬挂须有明确垂直锚点。')
    const frame = wallAttachmentFrame(scene, surface), a = row.anchor, f = frame.feature
    if (a.referenceVertexId !== f.referenceVertexId) throw new Error('悬挂与墙面使用不同稳定端点。')
    const expected = { x: frame.a.x + frame.u.x * a.alongMm + frame.n.x * (frame.wall.thicknessMm / 2 + a.normalOffsetMm),
      y: frame.a.y + frame.u.y * a.alongMm + frame.n.y * (frame.wall.thicknessMm / 2 + a.normalOffsetMm) }
    if (child.positionMm.x !== roundAttachmentMm(expected.x) || child.positionMm.y !== roundAttachmentMm(expected.y)
      || Math.abs(normalizeAttachmentAngle(frame.angleDeg + a.rotationOffsetDeg) - child.rotationDeg) > EPS) throw new Error('悬挂实际位置/旋转与墙侧锚点不一致。')
    const along = footprint.map(p => (p.x - frame.a.x) * frame.u.x + (p.y - frame.a.y) * frame.u.y)
    const normal = footprint.map(p => (p.x - frame.a.x) * frame.n.x + (p.y - frame.a.y) * frame.n.y)
    if (Math.min(...normal) < frame.wall.thicknessMm / 2 - EPS) throw new Error('悬挂物件完整占地穿入墙体或落在错误墙侧。')
    // Its nearest physical edge must contact this wall face; hovering is rejected.
    if (Math.abs(Math.min(...normal) - frame.wall.thicknessMm / 2) > 0.75) throw new Error('悬挂物件未真实接触墙侧。')
    const low = a.heightMm, high = low + a.heightExtentMm
    if (Math.min(...along) < f.startMm - EPS || Math.max(...along) > f.endMm + EPS || low < f.lowMm || high > f.highMm) throw new Error('悬挂完整接触范围超出墙面区间或高度。')
    for (const opening of Object.values(scene.openings).filter(o => o.wallId === frame.wall.id)) {
      const start = opening.offsetReferenceVertexId === f.referenceVertexId ? opening.offsetMm : frame.length - opening.offsetMm - opening.widthMm
      if (Math.min(...along) < start + opening.widthMm - EPS && Math.max(...along) > start + EPS) throw new Error('悬挂接触范围与门窗开口相交；当前模型没有可忽略开口的高度证明。')
    }
    root = wallRoot(scene, surface, child); elevation = low
    if (!supportedPolygon(scene, footprint, root, child.floorId)) throw new Error('悬挂完整占地不在声明根基内。')
    surfaceHash = attachmentHash(surfaceGeometry(scene, surface))
  }
  if (!same(root, child.supportRef)) throw new Error('附着根基必须与宿主递归根基一致，不能暗改支撑。')
  if (!Number.isSafeInteger(elevation)) throw new Error('持久接触高程必须为安全整数毫米。')
  return { propId: child.id, actualSurfaceId: surface.id, rootSupportRef: root, contactElevationMm: elevation, footprintMm: footprint,
    childGeometryHash: propContactGeometryHash(child), surfaceGeometryHash: surfaceHash }
}
export function resolvePropContact(scene: AttachmentScene, propId: string, seen = new Set<string>()): PropContact {
  if (seen.has(propId)) throw new Error('附着链不能成环。')
  const child = scene.props[propId]
  if (!child) throw new Error(`物件不存在：${propId}。`)
  const row = relationFor(scene, propId)
  if (row) return evaluatePropAttachment(scene, row, new Set([...seen, propId]))
  const footprint = propFootprint(child)
  if (!supportedPolygon(scene, footprint, child.supportRef, child.floorId)) throw new Error('根基完整占地无有效支撑。')
  return { propId, actualSurfaceId: null, rootSupportRef: child.supportRef, contactElevationMm: rootElevation(scene, child.supportRef), footprintMm: footprint,
    childGeometryHash: propContactGeometryHash(child), surfaceGeometryHash: null }
}
export function propAttachmentMaterialized(scene: AttachmentScene, row: PropAttachment): PropAttachment['materialized'] {
  const value = evaluatePropAttachment(scene, row)
  return { contactElevationMm: value.contactElevationMm, childGeometryHash: value.childGeometryHash, surfaceGeometryHash: value.surfaceGeometryHash! }
}
export function attachmentContactIssues(scene: AttachmentScene): Issue[] {
  const result: Issue[] = []
  for (const row of Object.values(scene.attachments ?? {})) if (row.mode !== 'embed') try {
    if (!same(propAttachmentMaterialized(scene, row), row.materialized)) throw new Error('持久接触结果或当前实际几何摘要不一致。')
  } catch (error) { result.push({ code: 'ATTACHMENT_CONTACT', entityId: row.id, message: error instanceof Error ? error.message : String(error) }) }
  return result
}
