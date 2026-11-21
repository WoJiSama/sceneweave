import { CONNECTION_ROUTE_LIMITS, sampleConnectionRoute, smoothConnectionControls, type ConnectionRoute } from '../../shared/geometry/connection-route'
import { connectionBand, createRouteSupportCheck, distanceToSegment, polylineBand } from '../../shared/geometry/geometry'
import { createSupportQuery } from '../../shared/geometry/support-sample'
import { fitRoadWidth } from '../../shared/geometry/fit-road-width'
import type { RouteWidthSection } from '../../shared/geometry/route-width'
import type { PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene'

export interface RoadDrawingSettings {
  floorId: string
  widthMm: number
  supportRefs: readonly SurfaceRef[]
  visibility: 'public' | 'gm'
  fitWidth?: boolean
}

export interface RoadShapeOptions {
  smooth: boolean
  excavate: boolean
}

export interface RoadStrokeSettings extends RoadShapeOptions {
  automaticSupport: boolean
}

const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const sameSupport = (a: SurfaceRef, b: SurfaceRef) => a.kind === b.kind && a.id === b.id
const MAX_FREEHAND_POINTS = 512
const MAX_PATH_POINTS = 256

/** Keep the shape of a pointer trace while removing redundant samples. */
function simplifyTrace(points: PointMm[], toleranceMm: number): PointMm[] {
  const keep = new Set([0, points.length - 1])
  const spans = [[0, points.length - 1]]
  while (spans.length) {
    const [start, end] = spans.pop()!
    let furthest = start, deviation = toleranceMm
    for (let index = start + 1; index < end; index++) {
      const distance = distanceToSegment(points[index], points[start], points[end])
      if (distance > deviation) { furthest = index; deviation = distance }
    }
    if (furthest !== start) {
      keep.add(furthest)
      spans.push([start, furthest], [furthest, end])
    }
  }
  return points.filter((_, index) => keep.has(index))
}

export function roadSketchShape(points: PointMm[], options: RoadShapeOptions): { centerlineMm: PointMm[]; route?: ConnectionRoute } {
  if (points.length < 2 || points.length > MAX_PATH_POINTS) throw new Error('道路中心线需要 2–256 个点。')
  if (!options.smooth && !options.excavate) return { centerlineMm: points }
  if (points.length > CONNECTION_ROUTE_LIMITS.segments + 1) throw new Error('圆滑或开凿路线最多支持 17 个转折控制点。')
  const controls = options.smooth ? smoothConnectionControls(points) : points.slice(1).map((end, index) => {
    const start = points[index]
    return { start, control1: start, control2: end, end }
  })
  const source = {
    version: 1 as const,
    kind: options.smooth ? 'cubic' as const : 'polyline' as const,
    segments: controls.map((control, index) => ({ ...control, id: `road-draft-segment-${index}` })),
    sampleSpacingMm: options.smooth ? 1000 : 20000,
    toleranceMm: 30,
    stairStyle: 'stone' as const,
    treadDepthMm: 280,
  }
  const centerlineMm = sampleConnectionRoute(source)
  if (options.excavate && centerlineMm.length > 64) throw new Error('开凿路线的实际采样最多 64 点，请减少曲折或缩短笔画。')
  return { centerlineMm, route: { ...source, centerlineMm } }
}

function strokeSupports(scene: SceneDocument, road: RoadDrawingSettings, options: RoadStrokeSettings, start: PointMm): SurfaceRef[] {
  if (!options.automaticSupport) return [...road.supportRefs]
  if (!options.excavate) {
    const root = createSupportQuery(scene, road.floorId).sample(start)?.rootSupportRef
    return root && (root.kind !== 'terrainArea' || road.visibility === 'gm' || scene.terrainAreas[root.id]?.visibility === 'public') ? [root] : []
  }
  return Object.values(scene.terrainAreas).filter(area => area.floorId === road.floorId
    && (road.visibility === 'gm' || area.visibility === 'public')).map(area => ({ kind: 'terrainArea', id: area.id }))
}

export function excavationEndpoints(scene: SceneDocument, road: RoadDrawingSettings, points: PointMm[], automatic: boolean) {
  const query = createSupportQuery(scene, road.floorId)
  const ends = [points[0], points.at(-1)!].map(positionMm => {
    const actual = query.sample(positionMm)
    const surfaceRef = actual?.rootSupportRef
    if (!actual || !surfaceRef || surfaceRef.kind !== 'terrainArea' || actual.sourceConnectionId || actual.sourceRockShellAreaId
      || road.visibility === 'public' && scene.terrainAreas[surfaceRef.id].visibility !== 'public'
      || !automatic && !road.supportRefs.some(ref => sameSupport(ref, surfaceRef))) {
      throw new Error('开凿的两端须落在选定的真实地形平台上。')
    }
    return { surfaceRef, positionMm }
  })
  if (sameSupport(ends[0].surfaceRef, ends[1].surfaceRef)) throw new Error('开凿山路需要连接两个不同高程的地形平台。')
  return { from: ends[0], to: ends[1] }
}

export interface RoadStrokePreview {
  controls: PointMm[]
  centerlineMm: PointMm[]
  band: PointMm[]
  widthSections?: RouteWidthSection[]
  rejected: { point: PointMm; reason: string } | null
}

/** A stroke owns one disposable support query and publishes only accepted points. */
export function beginRoadStroke(scene: SceneDocument, road: RoadDrawingSettings, options: RoadStrokeSettings, start: PointMm) {
  const supportRefs = strokeSupports(scene, road, options, start)
  const support = createRouteSupportCheck(scene, road.floorId, supportRefs)
  const toleranceMm = Math.max(4, Math.min(80, road.widthMm / 12))
  const recorded: PointMm[] = []
  let preview: RoadStrokePreview = { controls: [], centerlineMm: [], band: [], rejected: null }
  const reject = (point: PointMm, reason: string) => (preview = { ...preview, rejected: { point, reason } })
  const extend = (point: PointMm, last = false): RoadStrokePreview => {
    const previous = recorded.at(-1)
    if (previous && samePoint(previous, point)) return preview.rejected ? (preview = { ...preview, rejected: null }) : preview
    if (previous && !last && Math.hypot(point.x - previous.x, point.y - previous.y) < toleranceMm) return preview
    if (recorded.length >= MAX_FREEHAND_POINTS) return reject(point, '笔画超过采样上限。')
    if (!support.point(point)) return reject(point, '这里没有道路支撑面。')
    if (!previous) {
      recorded.push(point)
      return (preview = { controls: [point], centerlineMm: [point], band: [], rejected: null })
    }
    const controls = simplifyTrace([...recorded, point], toleranceMm)
    try {
      const { centerlineMm } = roadSketchShape(controls, options)
      const band = options.excavate ? connectionBand(centerlineMm, road.widthMm) : polylineBand(centerlineMm, road.widthMm, true)
      const shape = !options.excavate && road.fitWidth
        ? fitRoadWidth(centerlineMm, road.widthMm, support.band)
        : support.band(band) ? { band, sections: undefined } : null
      if (!shape) return reject(point, '这一段的路宽或转角超出承托范围。')
      recorded.push(point)
      return (preview = { controls, centerlineMm, band: shape.band, widthSections: shape.sections, rejected: null })
    } catch (error) {
      return reject(point, error instanceof Error ? error.message : String(error))
    }
  }
  extend(start)
  return { get preview() { return preview }, supportRefs, extend, reject }
}
