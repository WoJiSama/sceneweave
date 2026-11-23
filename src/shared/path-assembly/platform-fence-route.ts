import polygonClipping, { type Ring } from 'polygon-clipping'
import { polygonValid } from '../geometry/geometry.js'
import type { PointMm, TerrainArea } from '../model/scene.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import type { PlatformFenceBinding } from './contracts.js'

type Outline = Pick<TerrainArea, 'boundaryMm'>
type Gap = { side: 'both'; fromMm: number; toMm: number }

interface PlatformFenceRoute {
  segmentIds: string[]
  centerlineMm: PointMm[]
  closed: boolean
  gaps: Gap[]
}

const SEGMENT_LIMIT = 32
const EPS = 1e-7
const reject = (message: string): never => { throw new OperationRejected('invalid_geometry', message) }

/** Terrain sequence determines direction. Adjacent selected edges share an actual corner. */
export function planPlatformFenceRoutes({ boundaryMm }: Outline, selection: PlatformFenceBinding['selection']): PlatformFenceRoute[] {
  const points = boundaryMm.map(row => row.positionMm)
  const ids = boundaryMm.map(row => row.segmentId)
  if (points.some(({ x, y }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(y))
    || new Set(ids).size !== ids.length || !polygonValid(points, true)) {
    return reject('平台护栏需要有效的整数毫米轮廓及唯一边段。')
  }
  const selected = new Set(selection.kind === 'all' ? ids : selection.segmentIds)
  if (!selected.size || selection.kind === 'segments' && selected.size !== selection.segmentIds.length
    || [...selected].some(id => !ids.includes(id))) return reject('所选平台边段必须存在且互不重复，请重新选择。')
  const all = selected.size === ids.length
  if (all && ids.length <= SEGMENT_LIMIT) return [{ segmentIds: ids, centerlineMm: points.map(point => ({ ...point })), closed: true, gaps: [] }]

  const starts = all ? [0] : ids.flatMap((id, index) =>
    selected.has(id) && !selected.has(ids[(index + ids.length - 1) % ids.length]) ? [index] : [])
  const next = (index: number) => (index + 1) % ids.length
  const routes: PlatformFenceRoute[] = []
  for (const start of starts) {
    let segmentIds: string[] = [], centerlineMm: PointMm[] = [{ ...points[start] }]
    for (let index = start; selected.has(ids[index]); index = next(index)) {
      segmentIds.push(ids[index])
      centerlineMm.push({ ...points[next(index)] })
      if (segmentIds.length === SEGMENT_LIMIT || next(index) === start || !selected.has(ids[next(index)])) {
        routes.push({ segmentIds, centerlineMm, closed: false, gaps: [] })
        segmentIds = []
        centerlineMm = [{ ...points[next(index)] }]
      }
      if (next(index) === start) break
    }
  }
  return routes
}

/** Intersect each passage with the full rail sweep. The local x bounds of each
 * clipped component are the rail stations it actually touches. */
export function platformFenceBandGaps(route: Pick<PlatformFenceRoute, 'centerlineMm' | 'closed'>, bands: readonly PointMm[][], sideReachMm: number): Gap[] {
  if (!bands.length) return []
  const points = route.closed ? [...route.centerlineMm, route.centerlineMm[0]] : route.centerlineMm
  const paddingMm = 2, reach = sideReachMm + paddingMm
  const intervals: [number, number][] = []
  let station = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    const ux = dx / length, uy = dy / length
    const strip: Ring = [[0, -reach], [length, -reach], [length, reach], [0, reach]]
    for (const band of bands) {
      const local: Ring = band.map(({ x, y }) => [(x - a.x) * ux + (y - a.y) * uy, -(x - a.x) * uy + (y - a.y) * ux])
      for (const [outer] of polygonClipping.intersection([local], [strip])) {
        const stations = outer.map(([x]) => x)
        intervals.push([Math.floor(station + Math.min(...stations) + EPS) - paddingMm,
          Math.ceil(station + Math.max(...stations) - EPS) + paddingMm])
      }
    }
    station += length
  }
  const end = Math.ceil(station)
  const gaps: Gap[] = []
  for (const [from, to] of intervals) {
    if (route.closed && to - from >= end) return [{ side: 'both', fromMm: 0, toMm: end }]
    gaps.push({ side: 'both', fromMm: Math.max(0, from), toMm: Math.min(end, to) })
    if (route.closed && from < 0) gaps.push({ side: 'both', fromMm: end + from, toMm: end })
    if (route.closed && to > end) gaps.push({ side: 'both', fromMm: 0, toMm: to - end })
  }
  const merged: Gap[] = []
  for (const gap of gaps.sort((a, b) => a.fromMm - b.fromMm || a.toMm - b.toMm)) {
    if (gap.toMm <= gap.fromMm) continue
    const prior = merged.at(-1)
    if (prior && gap.fromMm <= prior.toMm) prior.toMm = Math.max(prior.toMm, gap.toMm)
    else merged.push(gap)
  }
  return merged
}
