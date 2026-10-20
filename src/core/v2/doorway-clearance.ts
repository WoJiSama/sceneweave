import { openingEndpointsV2, propFootprintV2 } from './geometry'
import type { PointMm, SceneDocumentV2, WallV2 } from './types'

export interface DoorwayFixtureV2 {
  openingId: string
  minWidthMm: number
  /** Reserved distance from the wall centreline on each side of this doorway. */
  approachDepthMm: number
}
type WallShape = { wall: WallV2; start: PointMm; end: PointMm; polygons: PointMm[][] }
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const at = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
/** Every shape here is convex. SAT avoids roundoff turning a shared slanted edge into an overlap. */
function overlaps(a: PointMm[], b: PointMm[]): boolean {
  if (a.length < 3 || b.length < 3) return false
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], length = Math.hypot(q.x - p.x, q.y - p.y)
    if (!length) continue
    const nx = -(q.y - p.y) / length, ny = (q.x - p.x) / length
    const first = a.map(point => point.x * nx + point.y * ny), second = b.map(point => point.x * nx + point.y * ny)
    if (Math.min(Math.max(...first), Math.max(...second)) - Math.max(Math.min(...first), Math.min(...second)) <= 1e-7) return false
  }
  return true
}
function band(start: PointMm, end: PointMm, thicknessMm: number): PointMm[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (!length) return []
  const nx = -(end.y - start.y) / length * thicknessMm / 2, ny = (end.x - start.x) / length * thicknessMm / 2
  return [{ x: start.x + nx, y: start.y + ny }, { x: end.x + nx, y: end.y + ny }, { x: end.x - nx, y: end.y - ny }, { x: start.x - nx, y: start.y - ny }]
}

/** Real blocking bands with structural door apertures removed; windows remain solid. */
function wallShapes(scene: SceneDocumentV2, current = false): WallShape[] {
  return Object.values(scene.walls).filter(wall => wall.blocksMovement).map(wall => {
    const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId)
    if (!a || !b) throw new Error(`门前检查缺少墙端点：${wall.id}。`)
    const start = { x: a.xMm, y: a.yMm }, end = { x: b.xMm, y: b.yMm }, length = Math.hypot(end.x - start.x, end.y - start.y)
    if (!length) throw new Error(`门前检查遇到零长墙：${wall.id}。`)
    const gaps = Object.values(scene.openings).filter(opening => opening.wallId === wall.id && opening.kind === 'door' && (!current || opening.state === 'open' && !opening.locked)).map(opening => {
      const offset = opening.offsetReferenceVertexId === wall.startVertexId ? opening.offsetMm : length - opening.offsetMm - opening.widthMm
      return [offset, offset + opening.widthMm]
    }).sort(([a], [b]) => a - b)
    const solids: [number, number][] = []
    let cursor = 0
    for (const [near, far] of gaps) { if (near > cursor) solids.push([cursor, near]); cursor = Math.max(cursor, far) }
    if (cursor < length) solids.push([cursor, length])
    return { wall, start, end, polygons: solids.map(([near, far]) => band(at(start, end, near / length), at(start, end, far / length), wall.thicknessMm)) }
  })
}

/** The same centreline miterLimit=2 / bevel geometry used by scene validation. */
function wallJoins(shapes: WallShape[]): { wallIds: string[]; floorId: string; polygon: PointMm[] }[] {
  const result: { wallIds: string[]; floorId: string; polygon: PointMm[] }[] = []
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i], b = shapes[j]
    if (a.wall.floorId !== b.wall.floorId) continue
    const shared = [a.wall.startVertexId, a.wall.endVertexId].find(id => [b.wall.startVertexId, b.wall.endVertexId].includes(id))
    if (!shared) continue
    const point = a.wall.startVertexId === shared ? a.start : a.end, endA = a.wall.startVertexId === shared ? a.end : a.start, endB = b.wall.startVertexId === shared ? b.end : b.start
    const lengthA = Math.hypot(endA.x - point.x, endA.y - point.y), lengthB = Math.hypot(endB.x - point.x, endB.y - point.y)
    const u = { x: (endA.x - point.x) / lengthA, y: (endA.y - point.y) / lengthA }, v = { x: (endB.x - point.x) / lengthB, y: (endB.y - point.y) / lengthB }
    const determinant = u.x * v.y - u.y * v.x
    if (Math.abs(determinant) < 1e-12) continue
    const rA = a.wall.thicknessMm / 2, rB = b.wall.thicknessMm / 2
    for (const sign of [-1, 1]) {
      const p = { x: point.x + u.y * rA * sign, y: point.y - u.x * rA * sign }, q = { x: point.x - v.y * rB * sign, y: point.y + v.x * rB * sign }
      const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / determinant, miter = { x: p.x + u.x * t, y: p.y + u.y * t }
      const polygon = Math.hypot(miter.x - point.x, miter.y - point.y) <= 2 * Math.max(rA, rB) + 1e-7 ? [point, p, miter, q] : [point, p, q]
      result.push({ wallIds: [a.wall.id, b.wall.id], floorId: a.wall.floorId, polygon })
    }
  }
  return result
}

/** Shared actual solid bands and miter/bevel joins. Current mode keeps closed/locked doors solid. */
export function wallMovementPolygonsV2(scene: SceneDocumentV2, current = false): { floorId: string; entityId: string; polygon: PointMm[] }[] {
  const shapes = wallShapes(scene, current)
  return [...shapes.flatMap(shape => shape.polygons.map(polygon => ({ floorId: shape.wall.floorId, entityId: shape.wall.id, polygon }))), ...wallJoins(shapes).map(join => ({ floorId: join.floorId, entityId: join.wallIds.join('、'), polygon: join.polygon }))]
}

/**
 * Finite structural clearance at explicitly named doors in an already-valid scene.
 * Corridors follow current opening endpoints and use the full declared net width.
 * This checks blocking prop footprints and actual solid wall bands/joins, independent
 * of appearance, audience or group centres. Door leaf/lock state, general routes,
 * terrain traversal and furniture collisions outside these corridors are not solved.
 */
export function assertDoorwayClearancesV2(scene: SceneDocumentV2, fixtures: readonly DoorwayFixtureV2[]): void {
  if (fixtures.length > 64) throw new Error('单次门前检查最多指定 64 个门口。')
  const ids = new Set<string>()
  for (const fixture of fixtures) {
    if (!fixture.openingId || ids.has(fixture.openingId) || !Number.isSafeInteger(fixture.minWidthMm) || fixture.minWidthMm <= 0 || !Number.isSafeInteger(fixture.approachDepthMm) || fixture.approachDepthMm <= 0) throw new Error('门前检查配置无效：门口不能重复，净宽和两侧深度必须为正整数毫米。')
    ids.add(fixture.openingId)
  }
  if (!fixtures.length) return
  const walls = wallShapes(scene), joins = wallJoins(walls)
  for (const fixture of fixtures) {
    const opening = own(scene.openings, fixture.openingId)
    if (!opening || opening.kind !== 'door') throw new Error(`门前检查需要现存的门：${fixture.openingId}。`)
    if (opening.widthMm < fixture.minWidthMm) throw new Error(`门口 ${opening.id} 净宽不足 ${fixture.minWidthMm} mm。`)
    const [start, end] = openingEndpointsV2(scene, opening), corridor = band(start, end, fixture.approachDepthMm * 2)
    const floor = own(scene.floors, opening.floorId)
    if (!floor || corridor.some(point => point.x < floor.boundsMm.x - 1e-7 || point.x > floor.boundsMm.x + floor.boundsMm.width + 1e-7 || point.y < floor.boundsMm.y - 1e-7 || point.y > floor.boundsMm.y + floor.boundsMm.height + 1e-7)) throw new Error(`门口 ${opening.id} 的两侧预留区越过 Floor 世界边界。`)
    const props = Object.values(scene.props).filter(prop => prop.floorId === opening.floorId && prop.blocksMovement && overlaps(propFootprintV2(prop), corridor)).map(prop => prop.id)
    const blockers = walls.filter(shape => shape.wall.floorId === opening.floorId && shape.polygons.some(polygon => overlaps(polygon, corridor))).map(shape => shape.wall.id)
    for (const join of joins) if (join.floorId === opening.floorId && overlaps(join.polygon, corridor)) blockers.push(...join.wallIds)
    if (props.length || blockers.length) throw new Error(`门口 ${opening.id} 的 ${opening.widthMm} mm 净宽及两侧 ${fixture.approachDepthMm} mm 预留区被阻挡：${[...new Set([...props, ...blockers])].sort().join('、')}。`)
  }
}
