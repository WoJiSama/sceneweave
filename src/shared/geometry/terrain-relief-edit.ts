import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { BoundsMm, PointMm, SceneDocument, TerrainArea, TerrainConnection } from '../model/scene.js'
import { carvedStripCenterline, carvedStripCutFootprints } from '../carved-rock/index.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { isCanvasGround } from '../model/canvas-ground.js'
import { bridgeDeckIds } from '../path-assembly/contracts.js'
import { terrainInlayCenterline, terrainInlayFootprint } from '../terrain-inlay/scene.js'
import { connectionCenterline } from './connection-route.js'
import { connectionFootprint, corridor, distanceToSegment, pathPolygon, pointInPolygon, polygonDistance, roomPoints, segmentCuts, terrainPoints } from './geometry.js'
import { buildRoadSurface } from './road-surface.js'
import { createTerrainRelief, reliefBounds, reliefGridPoint, type TerrainRelief } from './terrain-relief.js'
import { createPublicVisibility } from './visibility.js'
import { defaultStaircase } from '../stairs/contracts.js'
import { planStaircase } from '../stairs/geometry.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { isShoreWaterTerrain } from '../visual/shore-surfaces.js'

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
interface ReliefRing { polygon: PointMm[]; bounds: BoundsMm }
interface FixedSupport extends ReliefRing { public: boolean }
type Spend = (checks: number) => void
const reliefRing = (polygon: PointMm[]): ReliefRing => ({ polygon, bounds: reliefBounds(polygon) })
const meets = (a: BoundsMm, b: BoundsMm, padding = 0) => a.x <= b.x + b.width + padding && b.x <= a.x + a.width + padding
  && a.y <= b.y + b.height + padding && b.y <= a.y + a.height + padding

function connectionBearingRings(connection: TerrainConnection): PointMm[][] {
  const { widthMm, carvedStrip, terrainInlay } = connection
  const line = carvedStrip ? carvedStripCenterline(carvedStrip) : terrainInlay ? terrainInlayCenterline(connection) : connectionCenterline(connection)
  const approaches = [[line[0], line[1]], [line.at(-1)!, line.at(-2)!]].map(([end, next]) => {
    const scale = widthMm / (2 * Math.hypot(end.x - next.x, end.y - next.y))
    return corridor(end, { x: end.x + (end.x - next.x) * scale, y: end.y + (end.y - next.y) * scale }, widthMm)
  })
  if (carvedStrip) return [...carvedStripCutFootprints(carvedStrip), ...approaches]
  if (terrainInlay) return [terrainInlayFootprint(connection), ...approaches]
  const stair = connection.staircase ?? (connection.kind === 'stairs' ? { ...defaultStaircase(),
    layout: { kind: 'repeat' as const, treadDepthMm: connection.route?.treadDepthMm ?? 300 } } : undefined)
  const bearing = stair ? planStaircase(line, widthMm, stair).treads.map(tread => tread.polygonMm) : [connectionFootprint(connection)]
  return [...bearing, ...approaches]
}

function strokeDistance(p: PointMm, points: ReliefStroke['points']) {
  let nearest = Math.hypot(p.x - points[0].x, p.y - points[0].y)
  for (let i = 1; i < points.length; i++) nearest = Math.min(nearest, distanceToSegment(p, points[i - 1], points[i]))
  return nearest
}

function touchedReliefRings<T extends ReliefRing>(stroke: ReliefStroke, rings: readonly T[], outline?: PointMm[], spend: Spend = brushBudget): T[] {
  if (!stroke.points.length) return []
  const strokeBounds = reliefBounds(stroke.points), radius = stroke.radiusMm
  const inside = (p: PointMm) => !outline || pointInPolygon(p, outline)
  const outlineEdges = outline?.map((p, i): [PointMm, PointMm] => [p, outline[(i + 1) % outline.length]]) ?? []
  return rings.filter(({ polygon, bounds }) => {
    if (!meets(strokeBounds, bounds, radius)) return false
    spend((polygon.length + outlineEdges.length) * stroke.points.length + polygon.length * outlineEdges.length)
    if (stroke.points.some(p => inside(p) && pointInPolygon(p, polygon))
      || outline?.some(p => pointInPolygon(p, polygon) && strokeDistance(p, stroke.points) < radius)) return true
    return polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length]
      const cuts = segmentCuts(a, b, outlineEdges)
      spend((cuts.length - 1) * (outlineEdges.length + 4 * stroke.points.length))
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
  })
}

export function touchedReliefTreads(stroke: ReliefStroke, rings: readonly ReliefRing[], outline?: PointMm[]): PointMm[][] {
  return touchedReliefRings(stroke, rings, outline).map(row => row.polygon)
}

interface ReliefSculptOptions { outerRings?: PointMm[][]; pinRim?: boolean; edgeWidthMm?: number; spend?: Spend }
const reliefGrid = (bounds: BoundsMm, original: TerrainRelief | undefined, radiusMm: number) =>
  original ?? createTerrainRelief(bounds, () => 0, Math.max(100, radiusMm / 8))
const cellDiagonal = (grid: TerrainRelief, bounds: BoundsMm) => Math.hypot(bounds.width / (grid.columns - 1), bounds.height / (grid.rows - 1))
function brushBudget(work: number) {
  if (work > MAX_RELIEF_BRUSH_DISTANCE_CHECKS) {
    throw new OperationRejected('operation_budget', '这笔涉及的边与格点太多，请缩短笔画或减小地形范围。')
  }
}

export function sculptTerrainRelief(outline: PointMm[], original: TerrainRelief | undefined, input: ReliefStroke,
  protectedPolygons: PointMm[][] = [], { outerRings = [outline], pinRim = false, edgeWidthMm, spend = brushBudget }: ReliefSculptOptions = {}) {
  const { points, radiusMm, amountMm } = input
  if (!points.length || points.length > 512 || !Number.isSafeInteger(radiusMm) || radiusMm < 100 || radiusMm > 100_000
    || !Number.isSafeInteger(amountMm) || Math.abs(amountMm) > 20_000 || !amountMm) throw new Error('起伏笔刷需要有效的整数毫米半径、强度和笔画。')
  const bounds = reliefBounds(outline)
  const grid = reliefGrid(bounds, original, radiusMm)
  const cell = cellDiagonal(grid, bounds), strokeBounds = reliefBounds(points)
  const taper = Math.max(edgeWidthMm ?? cell, radiusMm * .15)
  const shared = !pinRim && (outerRings.length > 1 || outerRings[0] !== outline)
  const protection = protectedPolygons.map(reliefRing)
  const outerEdges = outerRings.reduce((sum, ring) => sum + ring.length, 0)
  const vertexChecks = outline.length + outerEdges + (pinRim || shared ? outline.length : 0) + (shared ? outerEdges : 0)
  spend(grid.offsetsMm.length)
  const offsetsMm = grid.offsetsMm.map((height, index) => {
    const p = reliefGridPoint(grid, bounds, index % grid.columns, Math.floor(index / grid.columns))
    if (!meets(strokeBounds, { ...p, width: 0, height: 0 }, radiusMm)) return height
    spend(points.length)
    const distance = strokeDistance(p, points)
    if (distance >= radiusMm) return height
    spend(vertexChecks + protection.length)
    // A triangle can straddle the shared edge even when one lattice vertex is
    // outside its own polygon. Sample the same field there, inside the union.
    if (!pointInPolygon(p, outline) && (!shared || boundaryDistance(p, outline) > cell
      || outerRings.filter(ring => pointInPolygon(p, ring)).length % 2 === 0)) return height
    // A collar spanning a grid diagonal keeps every triangle directly under
    // the original tread intact, including corners between sampled grid points.
    const safe = protection.reduce((factor, item) => {
      if (p.x < item.bounds.x - cell * 2 || p.x > item.bounds.x + item.bounds.width + cell * 2
        || p.y < item.bounds.y - cell * 2 || p.y > item.bounds.y + item.bounds.height + cell * 2) return factor
      spend(item.polygon.length * 2)
      const distance = pointInPolygon(p, item.polygon) ? 0 : boundaryDistance(p, item.polygon)
      return Math.min(factor, smooth((distance - cell) / cell))
    }, 1)
    const outer = outerRings.reduce((nearest, ring) => Math.min(nearest, boundaryDistance(p, ring)), Infinity)
    const edge = smooth(outer / taper)
    const rim = pinRim ? smooth((boundaryDistance(p, outline) - cell) / cell) : 1
    return Math.max(-500_000, Math.min(500_000, Math.round(height + amountMm * smooth(1 - distance / radiusMm) * safe * edge * rim)))
  })
  return { ...grid, offsetsMm }
}

/** One world-space stroke. Saved route, support and rim geometry are held in place
 * while exposed ground on either side of a shared edge receives the same brush. */
export function createReliefBrush(scene: SceneDocument, floorId: string, areaId: string | undefined, hiddenLayers: ReadonlySet<string> = new Set()) {
  const decks = bridgeDeckIds(scene), visibility = createPublicVisibility(scene)
  const floorTerrain = Object.values(scene.terrainAreas).filter(area => area.floorId === floorId && !isCanvasGround(area))
    .sort((a, b) => b.coveragePriority - a.coveragePriority || a.id.localeCompare(b.id))
    .map(area => ({ area, ...reliefRing(terrainPoints(area)) }))
  const areas = floorTerrain.filter(({ area }) => !area.facade && !isShoreWaterTerrain(scene, area)
    && !decks.has(area.id) && !hiddenLayers.has(scene.entityLayers[area.id]))
  const selected = areaId ? areas.find(row => row.area.id === areaId) : undefined
  const selectionIssue = areaId && (!selected || effectiveEditLocked(scene, areaId)) ? '请选择可编辑的陆地或岩体顶部。' : ''
  const supports = new Map<string, FixedSupport[]>()
  const add = (ids: readonly string[], polygons: PointMm[][], isPublic: boolean) => {
    const records = polygons.filter(polygon => polygon.length >= 3).map(polygon => ({ ...reliefRing(polygon), public: isPublic }))
    for (const id of new Set(ids)) {
      const rows = supports.get(id)
      if (rows) rows.push(...records)
      else supports.set(id, [...records])
    }
  }
  const areaIds = new Set(areas.map(row => row.area.id))
  for (const connection of Object.values(scene.terrainConnections)) if (connection.floorId === floorId) {
    const ids = [connection.from.surfaceRef.id, connection.to.surfaceRef.id, connection.carvedStrip?.hostAreaId,
      ...(connection.terrainInlay?.geometry.sources.map(source => source.id) ?? [])].filter((id): id is string => !!id && areaIds.has(id))
    if (ids.length) add(ids, connectionBearingRings(connection), visibility.terrainConnection(connection.id))
  }
  for (const path of Object.values(scene.paths)) if (path.floorId === floorId) {
    const ids = path.supportRefs.map(ref => ref.id).filter(id => areaIds.has(id))
    if (ids.length) add(ids, [path.roadSurface ? buildRoadSurface(path, path.roadSurface).footprintMm : pathPolygon(path)], visibility.path(path.id))
  }
  for (const room of Object.values(scene.rooms)) if (room.floorId === floorId && areaIds.has(room.supportRef.id)) {
    add([room.supportRef.id], [roomPoints(scene, room)], visibility.room(room.id))
  }

  const createMeter = (): Spend => {
    let cost = 0
    return work => brushBudget(cost += work)
  }
  function targets(stroke: ReliefStroke, spend: Spend) {
    if (!stroke.points.length || selectionIssue) return []
    const { points, radiusMm } = stroke
    const strokeBounds = reliefBounds(points)
    const candidates = areas.filter(row => meets(strokeBounds, row.bounds, radiusMm))
    spend(candidates.reduce((sum, row) => sum + row.polygon.length, 0))
    const origin = selected ?? candidates.find(row => pointInPolygon(points[0], row.polygon))
    if (!origin) return []
    const nearby = candidates.filter(row => row.area.visibility === origin.area.visibility)
    const hit = touchedReliefRings(stroke, nearby, undefined, spend)
    if (!hit.includes(origin)) return []
    const component = [origin], waiting = new Set(hit.filter(row => row !== origin))
    for (const row of component) for (const other of waiting) {
      if (!meets(row.bounds, other.bounds)) continue
      spend(row.polygon.length * other.polygon.length)
      if (polygonDistance(row.polygon, other.polygon) < 1e-7) { component.push(other); waiting.delete(other) }
    }
    return component
  }
  const publicMarks = (stroke: ReliefStroke, rows: ReturnType<typeof targets>, spend: Spend) =>
    [...new Set(rows.flatMap(row => touchedReliefRings(stroke, (supports.get(row.area.id) ?? [])
      .filter(mark => mark.public || row.area.visibility === 'gm'), row.polygon, spend)))]

  return {
    selectionIssue,
    marks(stroke: ReliefStroke) {
      const spend = createMeter()
      return publicMarks(stroke, targets(stroke, spend), spend).map(row => row.polygon)
    },
    plan(stroke: ReliefStroke, retainSupports: boolean): { area: TerrainArea; relief: TerrainRelief }[] {
      if (selectionIssue) throw new Error(selectionIssue)
      const spend = createMeter(), rows = targets(stroke, spend)
      if (!rows.length) {
        if (selected) throw new Error('笔画需要经过所选地形。')
        if (touchedReliefRings(stroke, floorTerrain, undefined, spend).length) throw new Error('请从当前楼层的可编辑陆地内起笔。')
        return []
      }
      if (rows.some(({ area }) => effectiveEditLocked(scene, area.id))) throw new Error('笔画跨入已锁定的地形，请缩小范围或调整笔势。')
      if (!retainSupports && publicMarks(stroke, rows, spend).length) throw new Error('这笔接触固定承托，请先选择保留承托地形。')
      const polygon = ({ polygon }: ReliefRing): Polygon => [polygon.map(({ x, y }) => [x, y])]
      const outerRings = rows.length === 1 ? [rows[0].polygon] : polygonClipping.union(polygon(rows[0]), ...rows.slice(1).map(polygon))
        .flatMap(region => region.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
      const grids = rows.map(row => {
        const grid = reliefGrid(row.bounds, row.area.relief, stroke.radiusMm)
        return { row, grid, diagonal: cellDiagonal(grid, row.bounds) }
      })
      const edgeWidthMm = grids.reduce((width, row) => Math.max(width, row.diagonal), 0)
      const updates = grids.flatMap(({ row, grid, diagonal }) => {
        const { area } = row
        const radiusMm = stroke.radiusMm + 2 * diagonal
        const near = touchedReliefRings({ ...stroke, radiusMm }, supports.get(area.id) ?? [], row.polygon, spend)
        if (area.visibility === 'public' && near.some(mark => !mark.public)) {
          throw new Error('这笔接近私密承托，无法安全修改公开地形。请缩小范围或调整笔势。')
        }
        const relief = sculptTerrainRelief(row.polygon, grid, stroke, near.map(mark => mark.polygon), {
          outerRings, pinRim: !!area.rockBody, edgeWidthMm, spend,
        })
        return grid.offsetsMm.some((height, i) => height !== relief.offsetsMm[i]) ? [{ area, relief }] : []
      })
      if (!updates.length) throw new Error('这笔没有改变可编辑地面。请调整位置、半径或强度。')
      return updates
    },
  }
}
