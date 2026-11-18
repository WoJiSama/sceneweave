import { z } from 'zod'
import type { PointMm, SceneDocument } from '../model/scene.js'
import type { TerrainInlayCommand } from '../commands/terrain-inlay.js'
import { connectionArcFrame, connectionCenterline } from '../geometry/connection-route.js'
import { pointInPolygon } from '../geometry/geometry.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { TERRAIN_INLAY_LIMITS, type TerrainInlayPoint, type TerrainInlayRequest } from './contracts.js'
import { planTerrainInlay } from './geometry.js'
import { terrainInlayHash, terrainInlaySource } from './scene.js'

const bank = z.number().int().min(1).max(20_000)
const optionsSchema = z.object({ bankWidthMm: z.union([bank, z.object({ left: bank, right: bank }).strict()]) }).strict()
/** Bank width is the maximum extra ground outside the guaranteed walk on each
 * side. Banks taper at the two entrances; obstacles never silently shrink them. */
export type TerrainSlopeOptions = z.infer<typeof optionsSchema>

const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const distance = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
function crossingFraction(a: PointMm, b: PointMm, c: PointMm, d: PointMm) {
  const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y, denominator = dx * ey - dy * ex
  if (Math.abs(denominator) < 1e-7) return null
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null
}

/** Creates the complete source-joining slope first, then classifies its inner
 * faces as the guaranteed walk. The shared body has no separately attached
 * road slab: its outer nodes return to the actual visible source elevations.
 *
 * This finite construction follows the complete original XY route. Where an
 * outer segment crosses the old height discontinuity, the existing planner
 * derives the finite remaining wall; this is not a claim of zero side walls.
 * Saved XYZ/faces, rather than these parameters, remain the authoritative result.
 */
export function createTerrainSlopeCommand(scene: SceneDocument, connectionId: string, rawOptions: TerrainSlopeOptions): Extract<TerrainInlayCommand, { type: 'adoptTerrainInlay' }> {
  const options = optionsSchema.parse(captureJson(rawOptions)), connection = scene.terrainConnections[connectionId]
  assert(connection && !connection.terrainInlay && !connection.carvedStrip, '请选择尚未填切的原地形连接，不能覆盖已有人工坡体。')
  assert(connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea', '坡体需要明确的低、高两端地形。')
  const sourceAreas = [connection.from, connection.to].map(end => scene.terrainAreas[end.surfaceRef.id])
  assert(sourceAreas.every(Boolean) && sourceAreas[0].id !== sourceAreas[1].id
    && sourceAreas.every(source => source.floorId === connection.floorId), '坡体须引用两个不同的同Floor源地形。')
  assert(sourceAreas[0].groundElevationMm !== sourceAreas[1].groundElevationMm, '坡体两端必须具有真实高差。')
  const widths = typeof options.bankWidthMm === 'number' ? { left: options.bankWidthMm, right: options.bankWidthMm } : options.bankWidthMm
  const points = connectionCenterline(connection), frame = connectionArcFrame(points)
  assert(points.length >= 2 && points.length <= 64, '坡体首片保留完整2–64点原路线，不抽稀。')
  assert(points.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)), '坡体路线须使用整数毫米。')
  assert(distance(points[0], points[1]) > 16 && distance(points.at(-2)!, points.at(-1)!) > 16,
    '坡体两端路线段须长于16毫米，以保留真实等高接入。')
  const columns = ['outer-left', 'walk-left', 'center', 'walk-right', 'outer-right'] as const
  const checkBudget = (stationCount: number) => assert(stationCount * columns.length <= TERRAIN_INLAY_LIMITS.vertices
    && (stationCount - 1) * 8 <= TERRAIN_INLAY_LIMITS.faces, '完整坡体超过有限点面预算；不能抽稀原路线或分批绕过。')
  checkBudget(points.length + 4)
  const directions = points.slice(1).map((point, i) => {
    const span = distance(points[i], point)
    return { x: (point.x - points[i].x) / span, y: (point.y - points[i].y) / span }
  })
  const visibleSources = [...sourceAreas].sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id))
  const sourceHeight = (p: PointMm) => {
    const source = visibleSources.find(source => pointInPolygon(p, source.boundaryMm.map(row => row.positionMm)))
    assert(source, '完整坡体外缘越出明确双源地形，请缩小或重新明确坡体范围。')
    return source.groundElevationMm
  }
  const walkRadius = Math.ceil(connection.widthMm / 2) + 2
  const lateralDirections = new Map<string, PointMm>()
  const station = (i: number, shiftMm: number, label: string) => {
    const before = directions[Math.max(0, i - 1)], after = directions[Math.min(i, directions.length - 1)]
    const denominator = 1 + before.x * after.x + before.y * after.y
    assert(denominator >= .5, '坡体路线转角超过miter2范围，不能折返。')
    const direction = i === 0 ? directions[0] : i === points.length - 1 ? directions.at(-1)! : { x: 0, y: 0 }
    const center = { x: points[i].x + Math.round(direction.x * shiftMm), y: points[i].y + Math.round(direction.y * shiftMm) }
    const z = Math.round(sourceAreas[0].groundElevationMm + (sourceAreas[1].groundElevationMm - sourceAreas[0].groundElevationMm) * frame.distances[i] / frame.length)
    const laterals = [walkRadius + widths.left, walkRadius, 0, -walkRadius, -walkRadius - widths.right]
    return columns.map((column, k) => {
      const lateral = laterals[k], point = { x: center.x + Math.round((-before.y - after.y) * lateral / denominator),
        y: center.y + Math.round((before.x + after.x) * lateral / denominator) }
      if (k === 0 || k === 4) lateralDirections.set(`${label}-${column}`, {
        x: (-before.y - after.y) / denominator * Math.sign(lateral), y: (before.x + after.x) / denominator * Math.sign(lateral),
      })
      // Outer source height is resolved only after the entrance taper fixes
      // its actual XY; the full-width construction point may be outside land.
      return { id: `${label}-${column}`, point: { ...point, z } }
    })
  }
  // The complete slope grid is constructed before assigning walk membership.
  const originalStations = points.map((_, i) => station(i, 0, `slope-${i}`))
  const ordered = [
    { distance: -3, rows: station(0, -3, 'slope-from-outer') },
    ...originalStations.map((rows, i) => ({ distance: frame.distances[i], rows })),
    { distance: 3, rows: station(0, 3, 'slope-from-inner') },
    { distance: frame.length - 3, rows: station(points.length - 1, -3, 'slope-to-inner') },
    { distance: frame.length + 3, rows: station(points.length - 1, 3, 'slope-to-outer') },
  ]
  const taperLength = Math.min(Math.max(16, widths.left, widths.right), frame.length / 3)
  for (const [label, d] of [['from', taperLength], ['to', frame.length - taperLength]] as const) {
    if (ordered.some(row => Math.abs(row.distance - d) < 2)) continue
    const i = frame.distances.findIndex((end, i) => i > 0 && end >= d), t = (d - frame.distances[i - 1]) / (frame.distances[i] - frame.distances[i - 1])
    const rows = originalStations[i - 1].map((row, k) => {
      const id = `slope-${label}-bank-${columns[k]}`
      if (k === 0 || k === 4) {
        const a = lateralDirections.get(row.id)!, b = lateralDirections.get(originalStations[i][k].id)!
        lateralDirections.set(id, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
      return { id, point: {
        x: Math.round(row.point.x + (originalStations[i][k].point.x - row.point.x) * t),
        y: Math.round(row.point.y + (originalStations[i][k].point.y - row.point.y) * t),
        z: Math.round(row.point.z + (originalStations[i][k].point.z - row.point.z) * t),
      } }
    })
    ordered.push({ distance: d, rows })
  }
  const baseStations = ordered.sort((a, b) => a.distance - b.distance).map(({ distance: d, rows }) => {
    // Only the extra banks taper. Complete walk and level entrance collars
    // stay fixed; a straight full-width bank cap must not cross an old scarp.
    const fraction = Math.max(0, Math.min(1, (d - 3) / (taperLength - 3), (frame.length - 3 - d) / (taperLength - 3)))
    const smooth = fraction * fraction * (3 - 2 * fraction)
    for (const [outer, width] of [[0, widths.left], [4, widths.right]] as const) {
      const center = rows[2].point, direction = lateralDirections.get(rows[outer].id)!
      const extra = Math.min(2, width) + (width - Math.min(2, width)) * smooth
      const p = { x: center.x + Math.round(direction.x * (walkRadius + extra)), y: center.y + Math.round(direction.y * (walkRadius + extra)) }
      rows[outer].point = { ...p, z: sourceHeight(p) }
    }
    return rows
  })
  const stations = [baseStations[0]]
  // A source-height jump must not be interpolated over an entire original
  // route segment. Add local rows on both sides of its outer-edge crossings;
  // integer geometry keeps the genuine remaining return wall within that
  // short transition. Every original route row and endpoint collar survives.
  const sourceEdges = sourceAreas.flatMap(source => source.boundaryMm.map((row, i) => ({
    a: row.positionMm, b: source.boundaryMm[(i + 1) % source.boundaryMm.length].positionMm,
  })))
  for (let i = 1; i < baseStations.length; i++) {
    const before = baseStations[i - 1], after = baseStations[i], span = distance(before[2].point, after[2].point)
    const fractions: number[] = []
    for (const k of [0, 4]) for (const edge of sourceEdges) {
      const t = crossingFraction(before[k].point, after[k].point, edge.a, edge.b)
      if (t !== null) for (const candidate of [t - 3 / span, t + 3 / span]) if (candidate * span >= 2 && (1 - candidate) * span >= 2) fractions.push(candidate)
    }
    let previous = 0
    for (const t of fractions.sort((a, b) => a - b)) {
      if ((t - previous) * span < 2) continue
      const rows = before.map((row, k) => {
        const point = { x: Math.round(row.point.x + (after[k].point.x - row.point.x) * t),
          y: Math.round(row.point.y + (after[k].point.y - row.point.y) * t) }
        return { id: `slope-source-${i}-${stations.length}-${columns[k]}`, point: { ...point,
          z: k === 0 || k === 4 ? sourceHeight(point) : Math.round(row.point.z + (after[k].point.z - row.point.z) * t) } }
      })
      stations.push(rows); previous = t
      checkBudget(stations.length + baseStations.length - i)
    }
    stations.push(after)
  }
  checkBudget(stations.length)
  const geometry: TerrainInlayRequest = { sources: sourceAreas.map(area => cloneJson(terrainInlaySource(area))),
    verticesMm: Object.fromEntries(stations.flatMap(rows => rows.map(row => [row.id, row.point]))), faces: {}, footprintVertexIds: [], walkBoundaryVertexIds: [] }
  const floor = scene.floors[connection.floorId]
  assert(floor && Object.values(geometry.verticesMm).every(p => p.x >= floor.boundsMm.x && p.y >= floor.boundsMm.y
    && p.x <= floor.boundsMm.x + floor.boundsMm.width && p.y <= floor.boundsMm.y + floor.boundsMm.height), '完整坡体越出Floor范围。')
  for (let i = 1; i < points.length; i++) for (const rows of [originalStations[i - 1], originalStations[i]]) {
    const span = distance(points[i - 1], points[i])
    assert(cross(points[i - 1], points[i], rows[1].point) / span >= connection.widthMm / 2
      && -cross(points[i - 1], points[i], rows[3].point) / span >= connection.widthMm / 2, '整数坡体未能保持完整原请求净宽。')
  }
  for (let i = 1; i < stations.length; i++) for (let k = 0; k < columns.length - 1; k++) {
    const a = stations[i - 1][k].id, b = stations[i][k].id, c = stations[i][k + 1].id, d = stations[i - 1][k + 1].id
    for (const raw of [[a, b, c], [a, c, d]] as [string, string, string][]) {
      const points = raw.map(id => geometry.verticesMm[id]) as [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]
      assert(Math.abs(cross(...points)) > 1e-7, '完整坡体分面退化，请调整路线转弯或坡体范围。')
      const id = `slope-face-${Object.keys(geometry.faces).length}`, vertexIds: [string, string, string] = cross(...points) > 0 ? raw : [raw[0], raw[2], raw[1]]
      geometry.faces[id] = { id, vertexIds, kind: k === 1 || k === 2 ? 'walk' : 'apron' }
    }
  }
  // Outer cap rows retain every bank and center node, avoiding T-junctions.
  const boundary = (left: number, right: number) => [
    ...stations[0].slice(left, right + 1).map(row => row.id),
    ...stations.slice(1).map(rows => rows[right].id),
    ...stations.at(-1)!.slice(left, right).reverse().map(row => row.id),
    ...stations.slice(1, -1).reverse().map(rows => rows[left].id),
  ]
  geometry.footprintVertexIds = boundary(0, 4)
  geometry.walkBoundaryVertexIds = boundary(1, 3)
  planTerrainInlay(geometry)
  return { type: 'adoptTerrainInlay', id: connectionId, geometry, centerlineVertexIds: originalStations.map(rows => rows[2].id),
    expectedConnectionHash: terrainInlayHash(connection) }
}
