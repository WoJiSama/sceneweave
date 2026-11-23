import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { connectionCenterline } from './connection-route.js'
import { connectionFootprint, distanceToSegment, pointInPolygon, polygonDistance, segmentCuts, terrainPoints } from './geometry.js'
import { createTerrainRelief, reliefBounds, reliefGridPoint, sampleTerrainRelief, type TerrainRelief } from './terrain-relief.js'
import { defaultStaircase } from '../stairs/contracts.js'
import { planStaircase } from '../stairs/geometry.js'
import { OperationRejected } from '../validation/operation-rejection.js'

const MAX_RELIEF_BRUSH_DISTANCE_CHECKS = 6_000_000

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const boundaryDistance = (p: PointMm, ring: PointMm[]) =>
  ring.reduce((result, a, i) => Math.min(result, distanceToSegment(p, a, ring[(i + 1) % ring.length])), Infinity)

export function mountainRelief(outline: PointMm[], peakMm: number) {
  const bounds = reliefBounds(outline), radius = Math.min(bounds.width, bounds.height) * .43
  return createTerrainRelief(bounds, p => pointInPolygon(p, outline) ? peakMm * smooth(boundaryDistance(p, outline) / radius) : 0)
}

interface ReliefStroke { points: readonly PointMm[]; radiusMm: number; amountMm: number }
interface ProtectedTread { polygon: PointMm[]; bounds: BoundsMm }

export function fixedReliefTreads(scene: SceneDocument, areaId: string): ProtectedTread[] {
  const area = scene.terrainAreas[areaId]
  if (!area) return []
  const outline = terrainPoints(area)
  return Object.values(scene.terrainConnections).flatMap(connection => {
    if (connection.floorId !== area.floorId || connection.terrainInlay || connection.carvedStrip
      || ![connection.from, connection.to].some(end => end.surfaceRef.kind === 'terrainArea' && end.surfaceRef.id === areaId)) return []
    const band = connectionFootprint(connection)
    if (polygonDistance(band, outline) > 0) return []
    const stair = connection.staircase ?? (connection.kind === 'stairs' ? { ...defaultStaircase(),
      layout: { kind: 'repeat' as const, treadDepthMm: connection.route?.treadDepthMm ?? 300 } } : undefined)
    const geometry = stair && planStaircase(connectionCenterline(connection), connection.widthMm, stair)
    const treads = geometry?.treads.map(tread => tread.polygonMm) ?? [band]
    return treads.map(polygon => ({ polygon, bounds: reliefBounds(polygon) }))
  })
}

function strokeDistance(p: PointMm, points: ReliefStroke['points']) {
  let nearest = Math.hypot(p.x - points[0].x, p.y - points[0].y)
  for (let i = 1; i < points.length; i++) nearest = Math.min(nearest, distanceToSegment(p, points[i - 1], points[i]))
  return nearest
}

export function touchedReliefTreads(stroke: ReliefStroke, treads: ProtectedTread[], outline?: PointMm[]): PointMm[][] {
  if (!stroke.points.length) return []
  const strokeBounds = reliefBounds(stroke.points), radius = stroke.radiusMm
  return treads.filter(({ polygon, bounds }) => {
    if (bounds.x > strokeBounds.x + strokeBounds.width + radius || bounds.x + bounds.width < strokeBounds.x - radius
      || bounds.y > strokeBounds.y + strokeBounds.height + radius || bounds.y + bounds.height < strokeBounds.y - radius) return false
    const inside = (p: PointMm) => !outline || pointInPolygon(p, outline)
    if (stroke.points.some(p => inside(p) && pointInPolygon(p, polygon))) return true
    const outlineEdges = outline?.map((p, i): [PointMm, PointMm] => [p, outline[(i + 1) % outline.length]]) ?? []
    return polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length]
      const cuts = segmentCuts(a, b, outlineEdges)
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      for (let j = 1; j < cuts.length; j++) {
        if (!inside(at((cuts[j - 1] + cuts[j]) / 2))) continue
        const start = at(cuts[j - 1]), end = at(cuts[j])
        if (strokeDistance(start, stroke.points) < radius || strokeDistance(end, stroke.points) < radius
          || stroke.points.some(p => distanceToSegment(p, start, end) < radius)) return true
        for (let k = 1; k < stroke.points.length; k++) if (segmentCuts(start, end, [[stroke.points[k - 1], stroke.points[k]]]).length > 2) return true
      }
      return false
    })
  }).map(row => row.polygon)
}

export function sculptTerrainRelief(outline: PointMm[], original: TerrainRelief | undefined, input: ReliefStroke, protectedPolygons: PointMm[][] = []) {
  const { points, radiusMm, amountMm } = input
  if (!points.length || points.length > 512 || !Number.isSafeInteger(radiusMm) || radiusMm < 100 || radiusMm > 100_000
    || !Number.isSafeInteger(amountMm) || Math.abs(amountMm) > 20_000 || !amountMm) throw new Error('起伏笔刷需要有效的整数毫米半径、强度和笔画。')
  const bounds = reliefBounds(outline)
  const grid = original ?? createTerrainRelief(bounds, () => 0, Math.max(100, radiusMm / 8))
  if (grid.offsetsMm.length * (points.length + outline.length * 2 + protectedPolygons.reduce((sum, polygon) => sum + polygon.length, 0)) > MAX_RELIEF_BRUSH_DISTANCE_CHECKS) {
    throw new OperationRejected('operation_budget', '这笔涉及的边与格点太多，请缩短笔画或减小地形范围。')
  }
  const cell = Math.hypot(bounds.width / (grid.columns - 1), bounds.height / (grid.rows - 1))
  const protection = protectedPolygons.map(polygon => ({ polygon, bounds: reliefBounds(polygon) }))
  const offsetsMm = grid.offsetsMm.map((height, index) => {
    const p = reliefGridPoint(grid, bounds, index % grid.columns, Math.floor(index / grid.columns))
    if (!pointInPolygon(p, outline)) return height
    const distance = strokeDistance(p, points)
    if (distance >= radiusMm) return height
    // A collar spanning a grid diagonal keeps every triangle directly under
    // the original tread intact, including corners between sampled grid points.
    const safe = protection.reduce((factor, item) => {
      if (p.x < item.bounds.x - cell * 2 || p.x > item.bounds.x + item.bounds.width + cell * 2
        || p.y < item.bounds.y - cell * 2 || p.y > item.bounds.y + item.bounds.height + cell * 2) return factor
      const distance = pointInPolygon(p, item.polygon) ? 0 : boundaryDistance(p, item.polygon)
      return Math.min(factor, smooth((distance - cell) / cell))
    }, 1)
    const edge = smooth(boundaryDistance(p, outline) / Math.max(cell, radiusMm * .15))
    return Math.max(-500_000, Math.min(500_000, Math.round(height + amountMm * smooth(1 - distance / radiusMm) * safe * edge)))
  })
  return { ...grid, offsetsMm }
}

/** Used by the shared command boundary for non-brush updates too. Multiple
 * accepted strokes cannot gradually remove a fixed tread's original contact. */
export function assertReliefKeepsStairLandings(scene: SceneDocument, areaId: string, after: TerrainRelief) {
  const area = scene.terrainAreas[areaId], outline = terrainPoints(area), bounds = reliefBounds(outline)
  for (const tread of fixedReliefTreads(scene, areaId)) {
    const p = { x: tread.bounds.x + tread.bounds.width / 2, y: tread.bounds.y + tread.bounds.height / 2 }
    if (!pointInPolygon(p, outline, false)) continue
    const base = area.relief ? sampleTerrainRelief(area.relief, bounds, p).offsetMm : 0
    const next = sampleTerrainRelief(after, bounds, p).offsetMm
    if (next < base - 25) throw new Error('这笔会挖走固定台阶下的承托。请先保留阶下岩土或调整笔势。')
  }
}
