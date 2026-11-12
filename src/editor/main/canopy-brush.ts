import type { PointMm, SceneDocument, SurfaceRuleRegion } from '../../shared/model/scene.js'
import { polygonInside } from '../../shared/geometry/geometry.js'
import { polygonBoolean } from '../../shared/geometry/polygon-boolean.js'
import { terrainTransitionStrokePolygon } from '../../shared/visual/transition.js'
import { clipSurfaceRegions } from '../../shared/surface-rules/regions.js'

function pointBrush(point: PointMm, radiusMm: number): PointMm[] {
  return Array.from({ length: 24 }, (_, index) => {
    const angle = index * Math.PI / 12
    return { x: Math.round(point.x + Math.cos(angle) * radiusMm), y: Math.round(point.y + Math.sin(angle) * radiusMm) }
  })
}

export function canopyRegionsFromStroke(points: readonly PointMm[], radiusMm: number, support: readonly PointMm[]): PointMm[][] {
  if (!Number.isSafeInteger(radiusMm) || radiusMm < 100 || radiusMm > 10_000) throw new Error('树木画笔半径须为100–10000毫米。')
  if (!points.length || points.length > 512 || support.length < 3) throw new Error('树木画笔缺少有效落笔或支撑表面。')
  const clean = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  const stroke = clean.length === 1 ? pointBrush(clean[0], radiusMm) : terrainTransitionStrokePolygon(clean, radiusMm * 2)
  if (stroke.length < 3) throw new Error('树木画笔笔迹无效，请重新绘制。')
  const clipped = polygonBoolean({ operation: 'intersection', subject: [stroke], clip: [support as PointMm[]] })
  if (!clipped.polygons.length) throw new Error('笔迹没有覆盖选定的地形表面。')
  if (clipped.polygons.some(polygon => polygon.holes.length || polygon.outer.length > 512)) throw new Error('笔迹裁切后形成孔洞或过复杂边界；请缩短笔画并分成多块实心区域。')
  const regions = clipped.polygons.map(polygon => polygon.outer)
  if (regions.some(region => !polygonInside(region, support as PointMm[]))) throw new Error('树木区域未能完整裁切到选定地形表面。')
  return regions
}

/** Versioned surface rules retain clipped holes and disconnected strokes exactly. */
export function surfaceRegionsFromStroke(points: readonly PointMm[], radiusMm: number, support: readonly PointMm[]): SurfaceRuleRegion[] {
  if (!Number.isSafeInteger(radiusMm) || radiusMm < 100 || radiusMm > 10_000) throw new Error('地表画笔半径须为100–10000毫米。')
  if (!points.length || points.length > 512 || support.length < 3) throw new Error('地表画笔缺少有效落笔或支撑表面。')
  const clean = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  const stroke = clean.length === 1 ? pointBrush(clean[0], radiusMm) : terrainTransitionStrokePolygon(clean, radiusMm * 2)
  if (stroke.length < 3) throw new Error('地表画笔笔迹无效，请重新绘制。')
  const clipped = clipSurfaceRegions([{ outerMm: stroke, holesMm: [] }], support)
  if (!clipped.length) throw new Error('笔迹没有覆盖选定的地形表面。')
  return clipped
}

/** Explicit expansion follows shared boundary segments and actual terrain links. */
export function connectedTerrainAreaIds(scene: SceneDocument, startId: string): string[] {
  const start = scene.terrainAreas[startId]
  if (!start) return []
  const adjacent = new Map<string, Set<string>>(Object.keys(scene.terrainAreas).map(id => [id, new Set()]))
  const segmentKey = (a: PointMm, b: PointMm) => [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join('|')
  const edges = new Map<string, string[]>()
  for (const area of Object.values(scene.terrainAreas).filter(row => row.floorId === start.floorId)) for (let index = 0; index < area.boundaryMm.length; index++) {
    const a = area.boundaryMm[index].positionMm, b = area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, key = segmentKey(a, b)
    edges.set(key, [...(edges.get(key) ?? []), area.id])
  }
  for (const ids of edges.values()) for (const a of ids) for (const b of ids) if (a !== b) adjacent.get(a)?.add(b)
  for (const connection of Object.values(scene.terrainConnections)) if (connection.floorId === start.floorId
    && connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea') {
    adjacent.get(connection.from.surfaceRef.id)?.add(connection.to.surfaceRef.id)
    adjacent.get(connection.to.surfaceRef.id)?.add(connection.from.surfaceRef.id)
  }
  const result = new Set<string>([startId]), queue = [startId]
  for (let index = 0; index < queue.length; index++) for (const id of adjacent.get(queue[index]) ?? []) if (!result.has(id)) { result.add(id); queue.push(id) }
  return [...result].sort()
}
