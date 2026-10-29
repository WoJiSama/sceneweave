import type { BoundsMm, GroundSurfaceRef, Issue, Opening, Path, PointMm, Prop, Room, SceneDocument, SurfaceRef, SurfaceStyle, TerrainArea, Wall } from '../model/scene.js'
import { isSupportedScatterAlgorithm } from './scatter-algorithm.js'

const EPS = 1e-7
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const cross = (a: PointMm, b: PointMm, c: PointMm): number => {
  if ([a.x, a.y, b.x, b.y, c.x, c.y].every(Number.isSafeInteger)) return Number((BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(a.y)) - (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(a.x)))
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
const area = (points: PointMm[]): number => {
  if (points.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))) {
    let sum = 0n
    for (let i = 0; i < points.length; i++) sum += BigInt(points[i].x) * BigInt(points[(i + 1) % points.length].y) - BigInt(points[(i + 1) % points.length].x) * BigInt(points[i].y)
    return Number(sum) / 2
  }
  return points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2
}
const onSegment = (p: PointMm, a: PointMm, b: PointMm): boolean => {
  const value = cross(a, b, p)
  const tolerance = [p.x, p.y, a.x, a.y, b.x, b.y].every(Number.isSafeInteger) ? 0 : EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  return Math.abs(value) <= tolerance && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
}
const properCross = (a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean => {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b)
  return ((ac < 0 && ad > 0) || (ac > 0 && ad < 0)) && ((ca < 0 && cb > 0) || (ca > 0 && cb < 0))
}
const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean => properCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
const edges = (polygon: PointMm[]): [PointMm, PointMm][] => polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]])
const at = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const boundsContain = (p: PointMm, b: BoundsMm): boolean => p.x >= b.x - EPS && p.y >= b.y - EPS && p.x <= b.x + b.width + EPS && p.y <= b.y + b.height + EPS
const boundsPolygon = (b: BoundsMm): PointMm[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
const edgeKey = (a: string, b: string): string => [a, b].sort().join('\0')
export const terrainPoints = (area: TerrainArea): PointMm[] => area.boundaryMm.map(vertex => vertex.positionMm)
export function roomPoints(scene: Pick<SceneDocument, 'vertices'>, room: Room): PointMm[] {
  return room.boundaryVertexIds.flatMap(id => { const v = own(scene.vertices, id); return v ? [{ x: v.xMm, y: v.yMm }] : [] })
}
export function pointInPolygon(p: PointMm, polygon: PointMm[], includeBoundary = true): boolean {
  let inside = false
  for (const [a, b] of edges(polygon)) {
    if (onSegment(p, a, b)) return includeBoundary
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function polygonValid(points: PointMm[], positive: boolean): boolean {
  if (points.length < 3 || new Set(points.map(p => `${p.x}\0${p.y}`)).size !== points.length || (positive ? area(points) <= 0 : area(points) === 0)) return false
  const segments = edges(points)
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i], c = points[(i + 2) % points.length]
    if (same(a, b) || (cross(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0)) return false
    for (let j = i + 1; j < segments.length; j++) if (j !== i + 1 && !(i === 0 && j === segments.length - 1) && meet(a, b, ...segments[j])) return false
  }
  return true
}
const scanIntervals = (polygon: PointMm[], y: number): [number, number][] => {
  const xs = edges(polygon).flatMap(([a, b]) => (a.y > y) !== (b.y > y) ? [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)] : []).sort((a, b) => a - b)
  return xs.filter((_x, i) => i % 2 === 0).map((x, i) => [x, xs[i * 2 + 1]])
}
/** Positive area overlap includes coincident/contained polygons; boundary touching is allowed. */
export function polygonsOverlap(a: PointMm[], b: PointMm[]): boolean {
  if (!a.length || !b.length) return false
  if (Math.max(...a.map(p => p.x)) <= Math.min(...b.map(p => p.x)) || Math.max(...b.map(p => p.x)) <= Math.min(...a.map(p => p.x)) || Math.max(...a.map(p => p.y)) <= Math.min(...b.map(p => p.y)) || Math.max(...b.map(p => p.y)) <= Math.min(...a.map(p => p.y))) return false
  for (const [a1, a2] of edges(a)) for (const [b1, b2] of edges(b)) if (properCross(a1, a2, b1, b2)) return true
  const ys = [...new Set([...a, ...b].map(p => p.y))].sort((x, y) => x - y)
  for (let i = 1; i < ys.length; i++) {
    const y = (ys[i - 1] + ys[i]) / 2
    for (const [x1, x2] of scanIntervals(a, y)) for (const [z1, z2] of scanIntervals(b, y)) if (Math.min(x2, z2) > Math.max(x1, z1) + EPS) return true
  }
  return false
}
export function segmentCuts(a: PointMm, b: PointMm, boundaries: [PointMm, PointMm][]): number[] {
  const result = [0, 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  if (!length2) return result
  for (const [c, d] of boundaries) {
    const ex = d.x - c.x, ey = d.y - c.y, determinant = dx * ey - dy * ex
    if (determinant !== 0) {
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant
      if (t > 0 && t < 1 && u >= 0 && u <= 1) result.push(t)
    } else if (cross(a, b, c) === 0) for (const p of [c, d]) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2
      if (t > 0 && t < 1) result.push(t)
    }
  }
  return [...new Set(result)].sort((x, y) => x - y)
}
export function polygonInside(subject: PointMm[], container: PointMm[]): boolean {
  if (!subject.length || container.length < 3 || subject.some(p => !pointInPolygon(p, container))) return false
  const boundary = edges(container)
  for (const [a, b] of edges(subject)) {
    const cuts = segmentCuts(a, b, boundary)
    for (let i = 1; i < cuts.length; i++) if (!pointInPolygon(at(a, b, (cuts[i - 1] + cuts[i]) / 2), container)) return false
  }
  return true
}
export function propFootprint(prop: Prop): PointMm[] {
  const b = { x: prop.footprintOffsetMm.x - prop.footprintMm.width / 2, y: prop.footprintOffsetMm.y - prop.footprintMm.height / 2, ...prop.footprintMm }
  return transformBounds(b, prop.positionMm, prop.rotationDeg)
}
const transformBounds = (bounds: BoundsMm, position: PointMm, rotation: number): PointMm[] => {
  const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  return boundsPolygon(bounds).map(p => ({ x: position.x + p.x * cos - p.y * sin, y: position.y + p.x * sin + p.y * cos }))
}
export function openingEndpoints(scene: Pick<SceneDocument, 'vertices' | 'walls'>, opening: Opening): [PointMm, PointMm] {
  const wall = own(scene.walls, opening.wallId)
  if (!wall || ![wall.startVertexId, wall.endVertexId].includes(opening.offsetReferenceVertexId)) throw new Error('开口缺少有效的附着墙/稳定计量端点。')
  const reference = own(scene.vertices, opening.offsetReferenceVertexId), other = own(scene.vertices, wall.startVertexId === opening.offsetReferenceVertexId ? wall.endVertexId : wall.startVertexId)
  if (!reference || !other) throw new Error('开口附着墙缺少顶点。')
  const a = { x: reference.xMm, y: reference.yMm }, b = { x: other.xMm, y: other.yMm }, length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!length) throw new Error('开口附着墙不能为零长。')
  return [at(a, b, opening.offsetMm / length), at(a, b, (opening.offsetMm + opening.widthMm) / length)]
}
export function supportSurfaceAt(scene: SceneDocument, point: PointMm, floorId: string): GroundSurfaceRef | null {
  const floor = own(scene.floors, floorId)
  if (!floor || !boundsContain(point, floor.boundsMm)) return null
  const areas = Object.values(scene.terrainAreas).filter(item => item.floorId === floorId && pointInPolygon(point, terrainPoints(item)))
  areas.sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id))
  return areas.length ? { kind: 'terrainArea', id: areas[0].id } : { kind: 'floor', id: floorId }
}
const elevation = (scene: SceneDocument, ref: SurfaceRef): number | undefined => ref.kind === 'floor' ? own(scene.floors, ref.id) && 0 : ref.kind === 'terrainArea' ? own(scene.terrainAreas, ref.id)?.groundElevationMm : own(scene.rooms, ref.id)?.groundElevationMm
const refEqual = (a: SurfaceRef, b: SurfaceRef): boolean => a.kind === b.kind && a.id === b.id
export function pointOnSurface(scene: SceneDocument, p: PointMm, ref: SurfaceRef, floorId: string): boolean {
  const floor = own(scene.floors, floorId)
  if (!floor || !boundsContain(p, floor.boundsMm)) return false
  if (ref.kind === 'room') {
    const room = own(scene.rooms, ref.id)
    return !!room && room.floorId === floorId && pointInPolygon(p, roomPoints(scene, room)) && pointOnSurface(scene, p, room.supportRef, floorId)
  }
  const candidate = ref.kind === 'terrainArea' ? own(scene.terrainAreas, ref.id) : undefined
  if (ref.kind === 'floor' ? ref.id !== floorId : !candidate || candidate.floorId !== floorId || !pointInPolygon(p, terrainPoints(candidate))) return false
  return !Object.values(scene.terrainAreas).some(item => item.floorId === floorId && (candidate ? item.coveragePriority > candidate.coveragePriority : true) && pointInPolygon(p, terrainPoints(item), false))
}
export function supportedPolygon(scene: SceneDocument, polygon: PointMm[], ref: SurfaceRef, floorId: string): boolean {
  if (ref.kind === 'room') {
    const room = own(scene.rooms, ref.id)
    return !!room && polygonInside(polygon, roomPoints(scene, room)) && supportedPolygon(scene, polygon, room.supportRef, floorId)
  }
  const floor = own(scene.floors, floorId), candidate = ref.kind === 'terrainArea' ? own(scene.terrainAreas, ref.id) : undefined
  if (!floor || polygon.some(p => !boundsContain(p, floor.boundsMm))) return false
  if (ref.kind === 'floor' ? ref.id !== floorId : !candidate || candidate.floorId !== floorId || !polygonInside(polygon, terrainPoints(candidate))) return false
  return !Object.values(scene.terrainAreas).some(item => item.floorId === floorId && (candidate ? item.coveragePriority > candidate.coveragePriority : true) && polygonsOverlap(polygon, terrainPoints(item)))
}
export function corridor(a: PointMm, b: PointMm, width: number, squareCaps = false): PointMm[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!length) return []
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, r = width / 2, extension = squareCaps ? r : 0
  return [{ x: a.x - ux * extension - uy * r, y: a.y - uy * extension + ux * r }, { x: a.x - ux * extension + uy * r, y: a.y - uy * extension - ux * r }, { x: b.x + ux * extension + uy * r, y: b.y + uy * extension - ux * r }, { x: b.x + ux * extension - uy * r, y: b.y + uy * extension + ux * r }]
}
/** Square caps, miter joins capped at twice half-width, then bevel. No stored second contour. */
export function pathPolygon(path: Path): PointMm[] {
  const p = path.centerlineMm, r = path.widthMm / 2
  if (p.length < 2 || p.some((point, i) => i > 0 && same(point, p[i - 1]))) return []
  const directions = p.slice(1).map((point, i) => { const length = Math.hypot(point.x - p[i].x, point.y - p[i].y); return { x: (point.x - p[i].x) / length, y: (point.y - p[i].y) / length } })
  const side = (sign: number): PointMm[] => {
    const first = directions[0], last = directions.at(-1)!
    const result: PointMm[] = [{ x: p[0].x - first.x * r - first.y * r * sign, y: p[0].y - first.y * r + first.x * r * sign }]
    for (let i = 1; i < p.length - 1; i++) {
      const before = directions[i - 1], after = directions[i]
      const a = { x: p[i].x - before.y * r * sign, y: p[i].y + before.x * r * sign }, b = { x: p[i].x - after.y * r * sign, y: p[i].y + after.x * r * sign }
      const determinant = before.x * after.y - before.y * after.x
      if (Math.abs(determinant) < 1e-12) { if (before.x * after.x + before.y * after.y < 0) return []; result.push(a); continue }
      const t = ((b.x - a.x) * after.y - (b.y - a.y) * after.x) / determinant
      const intersection = { x: a.x + before.x * t, y: a.y + before.y * t }
      if (Math.hypot(intersection.x - p[i].x, intersection.y - p[i].y) <= 2 * r + EPS) result.push(intersection)
      else result.push(a, b)
    }
    result.push({ x: p.at(-1)!.x + last.x * r - last.y * r * sign, y: p.at(-1)!.y + last.y * r + last.x * r * sign })
    return result
  }
  const left = side(-1), right = side(1)
  if (!left.length || !right.length) return []
  const polygon = [...left, ...right.reverse()]
  return area(polygon) < 0 ? polygon.reverse() : polygon
}
function distanceToSegment(p: PointMm, a: PointMm, b: PointMm): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  const q = at(a, b, t)
  return Math.hypot(q.x - p.x, q.y - p.y)
}
export function polygonDistance(a: PointMm[], b: PointMm[]): number {
  if (polygonsOverlap(a, b)) return 0
  let distance = Infinity
  for (const [a1, a2] of edges(a)) for (const [b1, b2] of edges(b)) {
    if (meet(a1, a2, b1, b2)) return 0
    distance = Math.min(distance, distanceToSegment(a1, b1, b2), distanceToSegment(a2, b1, b2), distanceToSegment(b1, a1, a2), distanceToSegment(b2, a1, a2))
  }
  return distance
}
/** Every face of the segment arrangement is sampled on both sides of its split edges. */
export function coveredEverywhere(polygon: PointMm[], boundaries: PointMm[][], predicate: (p: PointMm) => boolean): boolean {
  if (!polygon.length) return false
  const allEdges = [...edges(polygon), ...boundaries.flatMap(edges)]
  if (polygon.some(p => !predicate(p))) return false
  for (const [a, b] of allEdges) {
    const cuts = segmentCuts(a, b, allEdges), length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    for (let i = 1; i < cuts.length; i++) {
      const midpoint = at(a, b, (cuts[i - 1] + cuts[i]) / 2)
      let offset = Math.min(0.1, length * (cuts[i] - cuts[i - 1]) / 10)
      for (const [c, d] of allEdges) { const distance = distanceToSegment(midpoint, c, d); if (distance > EPS) offset = Math.min(offset, distance / 4) }
      for (const sign of [-1, 1]) {
        const p = { x: midpoint.x - (b.y - a.y) / length * offset * sign, y: midpoint.y + (b.x - a.x) / length * offset * sign }
        if (pointInPolygon(p, polygon, false) && !predicate(p)) return false
      }
    }
  }
  return true
}

/** Hard geometry validity only. This deliberately does not claim a general movement/path solver. */
export function validateGeometry(scene: SceneDocument): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [], warnings: Issue[] = []
  const error = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId ? { entityId } : {}) })
  const polygon = (points: PointMm[], id: string, positive = true) => {
    if (!polygonValid(points, positive)) { error('INVALID_POLYGON', '轮廓必须是非零面积的简单多边形，无重复点、自接触或折返；地形/房间须正方向。', id); return false }
    return true
  }
  const withinFloor = (points: PointMm[], floorId: string, id: string) => {
    const floor = own(scene.floors, floorId)
    if (floor && points.some(p => !boundsContain(p, floor.boundsMm))) error('OUTSIDE_FLOOR', '实际几何越过 Floor 世界边界。', id)
  }
  const validBounds = (bounds: BoundsMm, id: string) => {
    if (!Number.isSafeInteger(bounds.x + bounds.width) || !Number.isSafeInteger(bounds.y + bounds.height)) error('UNSAFE_BOUNDS', '边界端点超出安全整数范围。', id)
  }
  if (Object.keys(scene.floors).length !== 1) error('UNSUPPORTED_FLOORS', 'M1 恰好支持一个 Floor。')
  validBounds(scene.exportBoundsMm, scene.sceneId)
  for (const floor of Object.values(scene.floors)) validBounds(floor.boundsMm, floor.id)
  for (const definition of Object.values(scene.propDefinitions)) validBounds(definition.defaultVisualBoundsMm, definition.id)
  for (const definition of Object.values(scene.prefabDefinitions)) for (const member of definition.members) validBounds(member.propTemplate.visualBoundsMm, definition.id)
  if (scene.constraints.pathChecks.length) error('UNSUPPORTED_PATH_CHECK', 'B1 尚未实现通用占地/门状态路径求解，不能接受 pathChecks 硬声明。')
  if (scene.constraints.minPathWidthMm !== undefined) error('UNSUPPORTED_PATH_CLEARANCE', 'B1 尚未实现全图通行净宽求解，不能接受 minPathWidthMm 硬声明。')
  const styleGeometry = (style: SurfaceStyle | null) => { if (style) for (const overlay of style.overlays) polygon(overlay.boundaryMm, overlay.id, false) }
  const areas = Object.values(scene.terrainAreas), validAreas: TerrainArea[] = []
  for (const item of areas) { if (polygon(terrainPoints(item), item.id)) validAreas.push(item); withinFloor(terrainPoints(item), item.floorId, item.id); styleGeometry(item.surfaceStyle) }
  for (let i = 0; i < validAreas.length; i++) for (let j = i + 1; j < validAreas.length; j++) {
    const a = validAreas[i], b = validAreas[j], ap = terrainPoints(a), bp = terrainPoints(b)
    if (a.floorId !== b.floorId) continue
    if (a.coveragePriority === b.coveragePriority && polygonsOverlap(ap, bp)) error('TERRAIN_PRIORITY_OVERLAP', '同覆盖优先级地形不可正面积重叠。', b.id)
    for (const [a1, a2] of edges(ap)) for (const [b1, b2] of edges(bp)) {
      if (!meet(a1, a2, b1, b2)) continue
      const sharedFull = (same(a1, b1) && same(a2, b2)) || (same(a1, b2) && same(a2, b1))
      const sharedEndpoint = [a1, a2].some(p => same(p, b1) || same(p, b2))
      const collinear = cross(a1, a2, b1) === 0 && cross(a1, a2, b2) === 0
      const partialOverlap = collinear && !sharedFull && ((onSegment(b1, a1, a2) && !same(b1, a1) && !same(b1, a2)) || (onSegment(b2, a1, a2) && !same(b2, a1) && !same(b2, a2)) || (onSegment(a1, b1, b2) && !same(a1, b1) && !same(a1, b2)))
      if ((!sharedEndpoint && !sharedFull) || partialOverlap) error('UNSPLIT_TERRAIN_INTERSECTION', '地形交点及共边端点必须显式分段，不能靠隐式求交修补。', b.id)
    }
  }
  const terrainBoundaries = validAreas.map(terrainPoints)
  const edgeSources = new Set<string>()
  for (const edge of Object.values(scene.terrainEdges)) {
    styleGeometry(edge.surfaceStyle)
    const source = own(scene.terrainAreas, edge.source.areaId), index = source?.boundaryMm.findIndex(vertex => vertex.segmentId === edge.source.segmentId) ?? -1
    if (!source || index < 0) { error('MISSING_EDGE_SOURCE', '地形边缘必须引用现存轮廓边段。', edge.id); continue }
    if (source.floorId !== edge.floorId) error('CROSS_FLOOR_REFERENCE', '地形边缘来源须同 Floor。', edge.id)
    const key = `${source.id}\0${edge.source.segmentId}`
    if (edgeSources.has(key)) error('DUPLICATE_EDGE_SOURCE', '每条有效源边段至多一个 TerrainEdge。', edge.id)
    edgeSources.add(key)
    const a = source.boundaryMm[index].positionMm, b = source.boundaryMm[(index + 1) % source.boundaryMm.length].positionMm, midpoint = at(a, b, 0.5), length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    let offset = Math.min(0.1, length / 100)
    for (const boundary of terrainBoundaries) for (const [c, d] of edges(boundary)) { const distance = distanceToSegment(midpoint, c, d); if (distance > EPS) offset = Math.min(offset, distance / 4) }
    const inside = supportSurfaceAt(scene, { x: midpoint.x - (b.y - a.y) / length * offset, y: midpoint.y + (b.x - a.x) / length * offset }, edge.floorId)
    const outside = supportSurfaceAt(scene, { x: midpoint.x + (b.y - a.y) / length * offset, y: midpoint.y - (b.x - a.x) / length * offset }, edge.floorId)
    if (inside?.kind !== 'terrainArea' || inside.id !== source.id || !outside || refEqual(inside, outside)) { error('COVERED_EDGE_SOURCE', '源边段必须是暴露的有效支撑面边界，不能保留被覆盖边缘。', edge.id); continue }
    const neighborId = outside.kind === 'terrainArea' ? outside.id : null
    if (edge.neighborAreaId !== neighborId) error('EDGE_NEIGHBOR', '边缘邻接与有效地形覆盖不一致。', edge.id)
    const neighbor = neighborId ? own(scene.terrainAreas, neighborId) : undefined
    if (neighbor && edges(terrainPoints(neighbor)).some(([c, d]) => (same(a, c) && same(b, d)) || (same(a, d) && same(b, c))) && source.id > neighbor.id) error('NONCANONICAL_EDGE_SOURCE', '共边只保存一份，以字典序较小区域的边段为源。', edge.id)
    if (source.groundElevationMm !== elevation(scene, outside) && (edge.kind !== 'cliff' || !edge.blocksMovement)) error('CLIFF_BLOCKING', '高差边界必须为阻挡移动的 cliff；台阶单独连接。', edge.id)
  }
  const wallEdges = new Map<string, Wall[]>(), wallGeometry: { wall: Wall; a: PointMm; b: PointMm; polygon: PointMm[] }[] = []
  for (const vertex of Object.values(scene.vertices)) withinFloor([{ x: vertex.xMm, y: vertex.yMm }], vertex.floorId, vertex.id)
  for (const wall of Object.values(scene.walls)) {
    styleGeometry(wall.topStyle)
    const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId)
    if (!a || !b) { error('MISSING_VERTEX', '墙引用的顶点不存在。', wall.id); continue }
    if (a.floorId !== wall.floorId || b.floorId !== wall.floorId) error('CROSS_FLOOR_REFERENCE', '墙端点须同 Floor。', wall.id)
    const p = { x: a.xMm, y: a.yMm }, q = { x: b.xMm, y: b.yMm }
    if (same(p, q)) { error('ZERO_LENGTH_WALL', '墙不能为零长。', wall.id); continue }
    const key = edgeKey(a.id, b.id), group = wallEdges.get(key) ?? []; group.push(wall); wallEdges.set(key, group)
    wallGeometry.push({ wall, a: p, b: q, polygon: corridor(p, q, wall.thicknessMm) })
  }
  for (let i = 0; i < wallGeometry.length; i++) for (let j = i + 1; j < wallGeometry.length; j++) {
    const a = wallGeometry[i], b = wallGeometry[j]
    if (a.wall.floorId !== b.wall.floorId || !meet(a.a, a.b, b.a, b.b)) continue
    const collinear = cross(a.a, a.b, b.a) === 0 && cross(a.a, a.b, b.b) === 0
    const axis = Math.abs(a.a.x - a.b.x) > Math.abs(a.a.y - a.b.y) ? 'x' : 'y'
    if (collinear && Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis])) > Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]))) error('OVERLAPPING_WALLS', '共享墙只可保存唯一墙段，部分共享须拆分。', b.wall.id)
    else if (![a.wall.startVertexId, a.wall.endVertexId].some(id => [b.wall.startVertexId, b.wall.endVertexId].includes(id))) error('UNSPLIT_INTERSECTION', '墙相交须拆分并共享稳定顶点。', b.wall.id)
  }
  const wallRooms = new Map<string, Room[]>(), validRooms: { room: Room; points: PointMm[] }[] = []
  for (const room of Object.values(scene.rooms)) {
    styleGeometry(room.floorStyle)
    let referencesValid = true
    for (const id of room.boundaryVertexIds) {
      const vertex = own(scene.vertices, id)
      if (!vertex) { error('MISSING_VERTEX', '房间引用的边界顶点不存在。', room.id); referencesValid = false }
      else if (vertex.floorId !== room.floorId) error('CROSS_FLOOR_REFERENCE', '房间顶点须同 Floor。', room.id)
    }
    if (!referencesValid) continue
    const points = roomPoints(scene, room)
    if (polygon(points, room.id)) {
      validRooms.push({ room, points })
      if (!supportedPolygon(scene, points, room.supportRef, room.floorId)) error('ROOM_SUPPORT', '房间完整内部须落在声明的有效支撑面内。', room.id)
    }
    if (room.groundElevationMm !== elevation(scene, room.supportRef)) error('ROOM_ELEVATION', '房间高度须等于支撑面高度。', room.id)
    for (let i = 0; i < room.boundaryVertexIds.length; i++) {
      const candidates = wallEdges.get(edgeKey(room.boundaryVertexIds[i], room.boundaryVertexIds[(i + 1) % room.boundaryVertexIds.length])) ?? []
      if (candidates.length !== 1) error('ROOM_WALL_MISMATCH', '房间每条边必须恰好对应一条共享墙。', room.id)
      else { const group = wallRooms.get(candidates[0].id) ?? []; group.push(room); wallRooms.set(candidates[0].id, group) }
    }
    if (room.accessExpectation === 'unspecified') warnings.push({ code: 'DRAFT_ACCESS', message: '草稿房间尚未声明结构连通要求。', entityId: room.id })
  }
  for (let i = 0; i < validRooms.length; i++) for (let j = i + 1; j < validRooms.length; j++) if (validRooms[i].room.floorId === validRooms[j].room.floorId && polygonsOverlap(validRooms[i].points, validRooms[j].points)) error('ROOM_OVERLAP', '同层房间不能正面积重叠。', validRooms[j].room.id)
  for (const [wallId, rooms] of wallRooms) {
    if (rooms.length > 2) error('WALL_ADJACENCY', '墙不能邻接超过两个 Room。', wallId)
    if (new Set(rooms.map(room => room.groundElevationMm)).size > 1) error('SHARED_WALL_ELEVATION', '共墙两室须在相同高度。', wallId)
  }
  for (const item of wallGeometry) {
    const expected = wallRooms.get(item.wall.id)?.[0]?.groundElevationMm ?? (supportSurfaceAt(scene, at(item.a, item.b, 0.5), item.wall.floorId) ? elevation(scene, supportSurfaceAt(scene, at(item.a, item.b, 0.5), item.wall.floorId)!) : undefined)
    withinFloor(item.polygon, item.wall.floorId, item.wall.id)
    if (expected !== undefined && !coveredEverywhere(item.polygon, terrainBoundaries, p => { const support = supportSurfaceAt(scene, p, item.wall.floorId); return !!support && elevation(scene, support) === expected })) error('WALL_SUPPORT_ELEVATION', '真实厚墙带区不能悬在不同高程地面上。', item.wall.id)
  }
  const wallJoins: { floorId: string; polygon: PointMm[]; wallId: string }[] = []
  for (let i = 0; i < wallGeometry.length; i++) for (let j = i + 1; j < wallGeometry.length; j++) {
    const a = wallGeometry[i], b = wallGeometry[j]
    if (a.wall.floorId !== b.wall.floorId) continue
    const shared = [a.wall.startVertexId, a.wall.endVertexId].find(id => [b.wall.startVertexId, b.wall.endVertexId].includes(id))
    if (!shared) continue
    const vertex = own(scene.vertices, shared)!, point = { x: vertex.xMm, y: vertex.yMm }
    const endA = a.wall.startVertexId === shared ? a.b : a.a, endB = b.wall.startVertexId === shared ? b.b : b.a
    const lengthA = Math.hypot(endA.x - point.x, endA.y - point.y), lengthB = Math.hypot(endB.x - point.x, endB.y - point.y)
    const u = { x: (endA.x - point.x) / lengthA, y: (endA.y - point.y) / lengthA }, v = { x: (endB.x - point.x) / lengthB, y: (endB.y - point.y) / lengthB }
    const determinant = u.x * v.y - u.y * v.x
    if (Math.abs(determinant) < 1e-12) continue
    const rA = a.wall.thicknessMm / 2, rB = b.wall.thicknessMm / 2
    for (const sign of [-1, 1]) {
      const p = { x: point.x + u.y * rA * sign, y: point.y - u.x * rA * sign }, q = { x: point.x - v.y * rB * sign, y: point.y + v.x * rB * sign }
      const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / determinant, miter = { x: p.x + u.x * t, y: p.y + u.y * t }
      const join = Math.hypot(miter.x - point.x, miter.y - point.y) <= 2 * Math.max(rA, rB) + EPS ? [point, p, miter, q] : [point, p, q]
      if (Math.abs(area(join)) <= EPS) continue
      withinFloor(join, a.wall.floorId, a.wall.id)
      const expected = wallRooms.get(a.wall.id)?.[0]?.groundElevationMm ?? (supportSurfaceAt(scene, at(a.a, a.b, 0.5), a.wall.floorId) ? elevation(scene, supportSurfaceAt(scene, at(a.a, a.b, 0.5), a.wall.floorId)!) : undefined)
      if (expected !== undefined && !coveredEverywhere(join, terrainBoundaries, p => { const support = supportSurfaceAt(scene, p, a.wall.floorId); return !!support && elevation(scene, support) === expected })) error('WALL_SUPPORT_ELEVATION', '厚墙转角的 miter/bevel 区域不能悬跨不同高程地面。', a.wall.id)
      wallJoins.push({ floorId: a.wall.floorId, polygon: join, wallId: a.wall.id })
    }
  }
  const openingsByWall = new Map<string, Opening[]>()
  for (const opening of Object.values(scene.openings)) {
    const wall = own(scene.walls, opening.wallId)
    if (!wall) { error('MISSING_WALL', '门窗附着墙不存在。', opening.id); continue }
    if (wall.floorId !== opening.floorId) error('CROSS_FLOOR_REFERENCE', '门窗须与墙同 Floor。', opening.id)
    if (![wall.startVertexId, wall.endVertexId].includes(opening.offsetReferenceVertexId)) { error('OPENING_REFERENCE', '开口稳定基准须为附着墙任一端点。', opening.id); continue }
    const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId)
    if (!a || !b) continue
    const dx = BigInt(b.xMm) - BigInt(a.xMm), dy = BigInt(b.yMm) - BigInt(a.yMm), length2 = dx * dx + dy * dy
    const clearance = scene.constraints.wallEndClearanceMm, far = BigInt(opening.offsetMm) + BigInt(opening.widthMm) + BigInt(clearance)
    if (opening.offsetMm < clearance || far * far > length2) error('OPENING_CLEARANCE', '开口沿真实墙长超界或不满足端部安全间隙。', opening.id)
    if (opening.kind === 'door' && scene.constraints.minDoorWidthMm !== undefined && opening.widthMm < scene.constraints.minDoorWidthMm) error('DOOR_WIDTH', '门净宽小于场景约束。', opening.id)
    const group = openingsByWall.get(wall.id) ?? []
    for (const other of group) {
      let overlap: boolean
      if (other.offsetReferenceVertexId === opening.offsetReferenceVertexId) overlap = BigInt(other.offsetMm) < BigInt(opening.offsetMm) + BigInt(opening.widthMm) && BigInt(opening.offsetMm) < BigInt(other.offsetMm) + BigInt(other.widthMm)
      else { const nearSum = BigInt(other.offsetMm) + BigInt(opening.offsetMm), farSum = nearSum + BigInt(other.widthMm) + BigInt(opening.widthMm); overlap = length2 > nearSum * nearSum && length2 < farSum * farSum }
      if (overlap) error('OPENING_OVERLAP', '同一墙上的开口实际区间不能重叠。', opening.id)
    }
    group.push(opening); openingsByWall.set(wall.id, group)
  }
  const graph = new Map<string, Set<string>>(), reachable = new Set<string>()
  for (const id of scene.constraints.entranceOpeningIds) {
    const opening = own(scene.openings, id), rooms = opening ? wallRooms.get(opening.wallId) ?? [] : []
    if (!opening || opening.kind !== 'door' || rooms.length !== 1) error('INVALID_ENTRANCE', '入口须为恰好一个房间通向外部的真实门。', id)
    else reachable.add(rooms[0].id)
  }
  for (const [wallId, rooms] of wallRooms) if (rooms.length === 2 && (!scene.walls[wallId].blocksMovement || openingsByWall.get(wallId)?.some(item => item.kind === 'door'))) {
    for (let i = 0; i < 2; i++) { const neighbors = graph.get(rooms[i].id) ?? new Set<string>(); neighbors.add(rooms[1 - i].id); graph.set(rooms[i].id, neighbors) }
  }
  const queue = [...reachable]
  for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
  for (const room of Object.values(scene.rooms)) if (room.accessExpectation === 'required' && !reachable.has(room.id)) error('REQUIRED_UNREACHABLE', 'required 房间须结构连接到显式外部入口；这不证明空间寻路。', room.id)
  for (const prop of Object.values(scene.props)) {
    validBounds(prop.visualBoundsMm, prop.id)
    const physical = propFootprint(prop)
    withinFloor(physical, prop.floorId, prop.id); withinFloor(transformBounds(prop.visualBoundsMm, prop.positionMm, prop.rotationDeg), prop.floorId, prop.id)
    if (!supportedPolygon(scene, physical, prop.supportRef, prop.floorId)) error('PROP_SUPPORT', '完整旋转占地须位于声明的有效支撑面内。', prop.id)
  }
  const connectionPolygons = new Map<string, PointMm[]>()
  for (const connection of Object.values(scene.terrainConnections)) {
    styleGeometry(connection.surfaceStyle)
    const { from, to } = connection, band = corridor(from.positionMm, to.positionMm, connection.widthMm)
    connectionPolygons.set(connection.id, band)
    if (!band.length || refEqual(from.surfaceRef, to.surfaceRef) || elevation(scene, from.surfaceRef) === undefined || elevation(scene, from.surfaceRef) === elevation(scene, to.surfaceRef)) error('CONNECTION_HEIGHT', '连接须具有不同有效支撑面、不同高度与非零长度。', connection.id)
    if (!pointOnSurface(scene, from.positionMm, from.surfaceRef, connection.floorId) || !pointOnSurface(scene, to.positionMm, to.surfaceRef, connection.floorId)) error('CONNECTION_ENDPOINT', '连接两端须落在各自的有效支撑面内。', connection.id)
    const refs = [from.surfaceRef, to.surfaceRef]
    if (!coveredEverywhere(band, [...terrainBoundaries, ...validRooms.map(item => item.points)], p => refs.some(ref => pointOnSurface(scene, p, ref, connection.floorId)))) error('CONNECTION_CORRIDOR', '连接矩形净宽带只可跨越声明的两地面，不得侵入第三支撑面。', connection.id)
    const cuts = segmentCuts(from.positionMm, to.positionMm, terrainBoundaries.flatMap(edges)), transitions: string[] = []
    for (let i = 1; i < cuts.length; i++) {
      const p = at(from.positionMm, to.positionMm, (cuts[i - 1] + cuts[i]) / 2), support = supportSurfaceAt(scene, p, connection.floorId), key = support ? `${support.kind}\0${support.id}` : 'outside'
      if (transitions.at(-1) !== key) transitions.push(key)
    }
    if (transitions.length !== 2) error('CONNECTION_TRANSITIONS', '连接必须恰好跨越一条有效地面邻接边。', connection.id)
    const roomEnds = refs.filter(ref => ref.kind === 'room')
    const opening = connection.openingId ? own(scene.openings, connection.openingId) : undefined
    if (roomEnds.length > 1 || (roomEnds.length === 0 && connection.openingId !== null) || (roomEnds.length === 1 && (!opening || opening.kind !== 'door' || !(wallRooms.get(opening.wallId) ?? []).some(room => room.id === roomEnds[0].id) || opening.widthMm < connection.widthMm))) error('CONNECTION_OPENING', '至多一端为 Room，且该端须绑定足够净宽的真实门；无 Room 端时 openingId=null。', connection.id)
    for (const wall of wallGeometry) if (wall.wall.floorId === connection.floorId && polygonsOverlap(band, wall.polygon)) {
      if (opening?.wallId !== wall.wall.id) error('CONNECTION_OBSTACLE', '连接净宽带有未声明墙体侵入。', connection.id)
      else {
        if (![wall.wall.startVertexId, wall.wall.endVertexId].includes(opening.offsetReferenceVertexId)) continue
        const [a, b] = openingEndpoints(scene, opening), portal = corridor(a, b, wall.wall.thicknessMm + 2)
        // Any corridor cross-section in this wall must remain in the actual opening span.
        if (!coveredEverywhere(band, [wall.polygon, portal], p => !pointInPolygon(p, wall.polygon, false) || pointInPolygon(p, portal))) error('CONNECTION_OPENING_CLEARANCE', '台阶/坡道通过墙体的净宽超出真实门区间。', connection.id)
      }
    }
    for (const join of wallJoins) if (join.floorId === connection.floorId && polygonsOverlap(band, join.polygon)) error('CONNECTION_OBSTACLE', '连接净宽带有真实墙转角侵入。', connection.id)
    for (const prop of Object.values(scene.props)) if (prop.floorId === connection.floorId && prop.blocksMovement && polygonsOverlap(band, propFootprint(prop))) error('CONNECTION_OBSTACLE', '连接净宽带被物件占地阻挡。', connection.id)
    for (const region of Object.values(scene.regions)) if (region.floorId === connection.floorId && region.blocksMovement && polygonsOverlap(band, region.boundaryMm)) error('CONNECTION_OBSTACLE', '连接净宽带被 Region 阻挡。', connection.id)
  }
  const pathPolygons = new Map<string, PointMm[]>()
  for (const path of Object.values(scene.paths)) {
    styleGeometry(path.surfaceStyle)
    const band = pathPolygon(path); pathPolygons.set(path.id, band)
    if (!polygon(band, path.id)) continue
    const crossing = path.centerlineMm.slice(1).some((b, i) => path.centerlineMm.slice(i + 3).some((d, k) => meet(path.centerlineMm[i], b, path.centerlineMm[i + 2 + k], d)))
    if (crossing) error('PATH_SELF_OVERLAP', '路径中心线/带区不能自交或折返。', path.id)
    if (!coveredEverywhere(band, [...terrainBoundaries, ...validRooms.map(item => item.points)], p => path.supportRefs.some(ref => pointOnSurface(scene, p, ref, path.floorId)))) error('PATH_SUPPORT', '整条方端帽/转角带区须位于声明支撑面并集内。', path.id)
    let previousPathSurface: SurfaceRef | null = null
    for (let i = 1; i < path.centerlineMm.length; i++) {
      const a = path.centerlineMm[i - 1], b = path.centerlineMm[i], cuts = segmentCuts(a, b, terrainBoundaries.flatMap(edges))
      for (let j = 1; j < cuts.length; j++) {
        const support = supportSurfaceAt(scene, at(a, b, (cuts[j - 1] + cuts[j]) / 2), path.floorId)
        if (support && previousPathSurface && elevation(scene, support) !== elevation(scene, previousPathSurface)) {
          const p = at(a, b, cuts[j - 1])
          if (!Object.values(scene.terrainConnections).some(connection => connection.floorId === path.floorId && connection.widthMm >= path.widthMm && pointInPolygon(p, connectionPolygons.get(connection.id) ?? []))) error('PATH_HEIGHT_TRANSITION', '路径跨高差必须位于独立有效连接的足宽走廊中。', path.id)
        }
        previousPathSurface = support
      }
    }
  }
  for (const region of Object.values(scene.regions)) { polygon(region.boundaryMm, region.id, false); withinFloor(region.boundaryMm, region.floorId, region.id); if (region.kind === 'manualMask' && (region.blocksMovement || region.movementCostMultiplier !== 1)) error('MASK_MOVEMENT', '人工遮罩不能改变物理阻挡/代价。', region.id) }
  for (const group of Object.values(scene.scatterGroups)) {
    if (!isSupportedScatterAlgorithm(group.algorithmVersion)) warnings.push({ code: 'UNSUPPORTED_SCATTER_ALGORITHM', message: '可编辑已采用结果；当前算法版本不可重新生成。', entityId: group.id })
    for (const exclusion of group.exclusions) polygon(exclusion.boundaryMm, exclusion.id, false)
    const domain = group.domain.kind === 'area' ? own(scene.terrainAreas, group.domain.areaId) : undefined
    const edge = group.domain.kind === 'edgeBand' ? own(scene.terrainEdges, group.domain.edgeId) : undefined
    let domainPolygon = domain ? terrainPoints(domain) : group.domain.kind === 'path' ? pathPolygons.get(group.domain.pathId) : undefined
    if (edge && group.domain.kind === 'edgeBand') {
      const area = own(scene.terrainAreas, edge.source.areaId), index = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
      if (area && index >= 0) domainPolygon = corridor(area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, group.domain.widthMm)
    }
    const live: { prop: Prop; state: string; footprint: PointMm[]; minX: number; maxX: number; minY: number; maxY: number }[] = []
    for (const value of Object.values(group.members)) if (value.propId !== null) {
      const prop = own(scene.props, value.propId)
      if (!prop || !domainPolygon) continue
      const footprint = propFootprint(prop), inside = polygonInside(footprint, domainPolygon)
      live.push({ prop, state: value.state, footprint, minX: Math.min(...footprint.map(p => p.x)), maxX: Math.max(...footprint.map(p => p.x)), minY: Math.min(...footprint.map(p => p.y)), maxY: Math.max(...footprint.map(p => p.y)) })
      if (!inside && value.state === 'managed') error('SCATTER_DOMAIN', 'managed 散布成员完整占地须在散布域内。', prop.id)
      if (!inside && value.state === 'manual') warnings.push({ code: 'MANUAL_SCATTER_OUTSIDE_DOMAIN', message: '人工散布成员已移出域；保留其结果且仍校验真实支撑。', entityId: prop.id })
      if (value.state === 'managed' && group.exclusions.some(exclusion => polygonDistance(footprint, exclusion.boundaryMm) === 0)) error('SCATTER_EXCLUSION', 'managed 散布成员占地不可与持久化排除区相交或接触。', prop.id)
    }
    live.sort((a, b) => a.minX - b.minX)
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length && live[j].minX - live[i].maxX < group.minDistanceMm; j++) {
      const a = live[i], b = live[j]
      if (a.state !== 'managed' && b.state !== 'managed') continue
      if (Math.max(a.minY - b.maxY, b.minY - a.maxY) >= group.minDistanceMm) continue
      if (polygonDistance(a.footprint, b.footprint) + EPS < group.minDistanceMm) error('SCATTER_SPACING', '自动管理成员须与人工/锁定成员保持声明的真实矩形净距。', b.prop.id)
    }
  }
  const anchorCollections = { vertex: scene.vertices, room: scene.rooms, wall: scene.walls, opening: scene.openings, prop: scene.props, region: scene.regions, note: scene.notes, terrainArea: scene.terrainAreas, terrainEdge: scene.terrainEdges, terrainConnection: scene.terrainConnections, path: scene.paths, prefabInstance: scene.prefabInstances, scatterGroup: scene.scatterGroups }
  for (const note of Object.values(scene.notes)) {
    if (note.anchor.type === 'point') withinFloor([note.anchor.positionMm], note.floorId, note.id)
    else {
      const target = own<{ floorId: string }>(anchorCollections[note.anchor.entityKind], note.anchor.entityId)
      if (!target) error('MISSING_ANCHOR', '注记锚点实体不存在。', note.id)
      else if (target.floorId !== note.floorId) error('CROSS_FLOOR_REFERENCE', '注记锚点须同 Floor。', note.id)
      const seen = new Set<string>([note.id]); let current = note
      while (current.anchor.type === 'entity' && current.anchor.entityKind === 'note') {
        if (seen.has(current.anchor.entityId)) { error('CYCLIC_ANCHOR', '注记锚点不能循环引用。', note.id); break }
        seen.add(current.anchor.entityId)
        const next = own(scene.notes, current.anchor.entityId)
        if (!next) break
        current = next
      }
    }
  }
  return { errors, warnings }
}
