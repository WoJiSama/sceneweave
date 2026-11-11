import type { Editable, PointMm, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { coveredEverywhere, pathPolygon, pointOnSurface, roomPoints, supportedPolygon, terrainPoints } from '../../shared/geometry/geometry.js'
import { createPublicVisibility, publicTerrainView } from '../../shared/geometry/visibility.js'
import { resolveBuildingEntrancePort } from '../../shared/generation/building-port.js'
import { snapBuildingPoint } from './building-session.js'

export interface RoadSnapOptions {
  floorId: string
  widthMm: number
  /** The tool's explicit supports. Preparing or resolving never changes them. */
  supportRefs: readonly SurfaceRef[]
  excludedEntityIds?: ReadonlySet<string>
  audience?: 'gm' | 'player'
}

export interface RoadSnapMatch {
  id: string
  entityId: string
  kind: 'door' | 'endpoint' | 'centerline'
  label: string
  directionDeg: number
}
export type RoadSnapTarget = Readonly<RoadSnapMatch> & (
  | { readonly kind: 'door' | 'endpoint'; readonly point: Readonly<PointMm> }
  | { readonly kind: 'centerline'; readonly start: Readonly<PointMm>; readonly end: Readonly<PointMm> }
)
export interface RoadSnapSources {
  readonly targets: readonly RoadSnapTarget[]
  /** General support limits only: no counts or diagnostics about hidden sources. */
  readonly notices: readonly string[]
}
export interface RoadSnapResult { point: PointMm; target: RoadSnapMatch | null }

const CAPTURE_PX = 12, RELEASE_PX = 18
const notices = Object.freeze(['门前吸附仅支持公开、已打开且未上锁的正交外门，并须满足门净宽和同一地形支撑；吸附不证明整条道路可通行。'])
const sameRef = (a: SurfaceRef, b: SurfaceRef) => a.kind === b.kind && a.id === b.id
const integerPoint = (point: PointMm) => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
const direction = (a: PointMm, b: PointMm) => (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360
const rank = (kind: RoadSnapMatch['kind']) => kind === 'door' ? 0 : kind === 'endpoint' ? 1 : 2
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const roundedRatio = (numerator: bigint, denominator: bigint): number => {
  const negative = numerator < 0n, magnitude = negative ? -numerator : numerator
  const rounded = (2n * magnitude + denominator) / (2n * denominator)
  return Number(negative ? -rounded : rounded)
}

/** Prepare once for the current document/tool parameters/visibility. Rebuild on
 * changes to any of those inputs. No scene or geometry validation runs on move. */
export function prepareRoadSnapTargets(document: SceneDocument, options: RoadSnapOptions): RoadSnapSources {
  const { floorId, widthMm, supportRefs } = options
  if (!Number.isSafeInteger(widthMm) || widthMm <= 0) throw new Error('道路吸附净宽须为正整数毫米。')
  if (!document.floors[floorId]) throw new Error('道路吸附须选择实际 Floor。')
  const visible = createPublicVisibility(document), player = options.audience === 'player'
  const scene = player ? publicTerrainView(document, visible) : document
  const excluded = options.excludedEntityIds, targets: RoadSnapTarget[] = []
  const editable = (entity: Editable | undefined): boolean => !!entity && entity.floorId === floorId && !entity.editLocked
    && !excluded?.has(entity.id) && !document.userLayers[document.entityLayers[entity.id]]?.editLocked
  const supportElevation = (ref: SurfaceRef): number | undefined => {
    if (excluded?.has(ref.id)) return undefined
    if (ref.kind === 'floor') return ref.id === floorId && !!scene.floors[ref.id] ? 0 : undefined
    if (ref.kind === 'terrainArea') {
      const area = scene.terrainAreas[ref.id]
      return editable(area) && !area.blocksMovement && (!player || visible.terrainArea(ref.id)) ? area.groundElevationMm : undefined
    }
    const room = scene.rooms[ref.id]
    return editable(room) && (!player || visible.room(ref.id)) && supportElevation(room.supportRef) === room.groundElevationMm ? room.groundElevationMm : undefined
  }
  const elevations = supportRefs.map(supportElevation), elevationMm = elevations[0]
  // An incompatible or unavailable support cannot silently become another one.
  if (!supportRefs.length || elevationMm === undefined || elevations.some(value => value !== elevationMm)) return Object.freeze({ targets: Object.freeze(targets), notices })
  const boundaries = [
    ...Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).map(terrainPoints),
    ...supportRefs.flatMap(ref => ref.kind === 'room' ? [roomPoints(scene, scene.rooms[ref.id])] : []),
  ]
  const supportedBand = (polygon: PointMm[]) => polygon.length >= 3 && (supportRefs.some(ref => supportedPolygon(scene, polygon, ref, floorId))
    || supportRefs.length > 1 && coveredEverywhere(polygon, boundaries, point => supportRefs.some(ref => pointOnSurface(scene, point, ref, floorId))))

  for (const path of Object.values(scene.paths)) {
    if (!editable(path) || player && !visible.path(path.id) || !Number.isSafeInteger(path.widthMm) || path.widthMm < widthMm
      || path.centerlineMm.length < 2 || path.centerlineMm.some(point => !integerPoint(point))
      || !path.supportRefs.length || path.supportRefs.some(ref => !supportRefs.some(selected => sameRef(ref, selected)) || supportElevation(ref) !== elevationMm)) continue
    const polygon = pathPolygon(path)
    if (!supportedBand(polygon)) continue
    const points = path.centerlineMm, start = points[0], end = points.at(-1)!
    targets.push(Object.freeze({ id: `path:${path.id}:start`, entityId: path.id, kind: 'endpoint', label: `道路 ${path.id} · 起点`, directionDeg: direction(points[1], start), point: Object.freeze({ ...start }) }),
      Object.freeze({ id: `path:${path.id}:end`, entityId: path.id, kind: 'endpoint', label: `道路 ${path.id} · 终点`, directionDeg: direction(points.at(-2)!, end), point: Object.freeze({ ...end }) }))
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index]
      if (a.x === b.x && a.y === b.y) continue
      targets.push(Object.freeze({ id: `path:${path.id}:segment:${index - 1}`, entityId: path.id, kind: 'centerline', label: `道路 ${path.id} · 中心线`, directionDeg: direction(a, b), start: Object.freeze({ ...a }), end: Object.freeze({ ...b }) }))
    }
  }

  for (const opening of Object.values(document.openings)) {
    // Filter before invoking the finite public-port adapter or exposing any
    // feedback. GM-visible secrets do not expand that adapter's support scope.
    if (!editable(opening) || opening.kind !== 'door' || !visible.opening(opening.id)) continue
    const wall = document.walls[opening.wallId]
    if (!editable(wall) || [wall.startVertexId, wall.endVertexId].some(id => !editable(document.vertices[id]))) continue
    try {
      const port = resolveBuildingEntrancePort(document, opening.id, widthMm)
      if (!editable(document.rooms[port.roomId]) || !supportRefs.some(ref => sameRef(ref, port.supportRef)) || supportElevation(port.supportRef) !== port.elevationMm || port.elevationMm !== elevationMm) continue
      targets.push(Object.freeze({ id: `door:${opening.id}`, entityId: opening.id, kind: 'door', label: `门 ${opening.id} · 门前接入`, directionDeg: port.directionDeg, point: Object.freeze({ ...port.outsideMm }) }))
    } catch {
      // Unsupported public doorways have the same general policy notice as
      // absent/private ones. A specific door action may report its own refusal.
    }
  }
  targets.sort((a, b) => compareIds(a.id, b.id))
  return Object.freeze({ targets: Object.freeze(targets), notices })
}

/** Pixel tolerance is converted at resolution time so zoom never invalidates
 * prepared geometry. Shift bypasses both semantic and grid assistance. */
export function resolveRoadSnap(rawPoint: PointMm, targets: readonly RoadSnapTarget[], worldMmPerPixel: number,
  previousTargetId?: string | null, disabled = false, gridSnapMm = 1): RoadSnapResult {
  const freePoint = snapBuildingPoint(rawPoint, 1)
  if (!Number.isFinite(worldMmPerPixel) || worldMmPerPixel <= 0) throw new Error('道路吸附缩放须为有限正毫米/像素。')
  if (disabled) return { point: freePoint, target: null }
  const fallback = snapBuildingPoint(rawPoint, gridSnapMm)
  let best: { source: RoadSnapTarget; point: PointMm; distancePx: number } | undefined
  let previous: typeof best
  for (const source of targets) {
    let point: PointMm
    if (source.kind === 'centerline') {
      const dx = source.end.x - source.start.x, dy = source.end.y - source.start.y, length2 = dx * dx + dy * dy
      if (!length2) continue
      if (integerPoint(rawPoint) && integerPoint(source.start) && integerPoint(source.end)) {
        // Preserve exact half-millimetre decisions on an integer line instead
        // of rounding 500.49999999999994 after a floating-point projection.
        const x = BigInt(source.end.x) - BigInt(source.start.x), y = BigInt(source.end.y) - BigInt(source.start.y), denominator = x * x + y * y
        const dot = (BigInt(rawPoint.x) - BigInt(source.start.x)) * x + (BigInt(rawPoint.y) - BigInt(source.start.y)) * y
        const numerator = dot < 0n ? 0n : dot > denominator ? denominator : dot
        point = { x: roundedRatio(BigInt(source.start.x) * denominator + x * numerator, denominator), y: roundedRatio(BigInt(source.start.y) * denominator + y * numerator, denominator) }
      } else {
        const dot = (rawPoint.x - source.start.x) * dx + (rawPoint.y - source.start.y) * dy
        const numerator = Math.max(0, Math.min(length2, dot))
        point = snapBuildingPoint({ x: source.start.x + dx * numerator / length2, y: source.start.y + dy * numerator / length2 }, 1)
      }
    } else point = { ...source.point }
    const distancePx = Math.hypot(rawPoint.x - point.x, rawPoint.y - point.y) / worldMmPerPixel
    const candidate = { source, point, distancePx }
    if (source.id === previousTargetId && distancePx <= RELEASE_PX) previous = candidate
    if (distancePx > CAPTURE_PX) continue
    if (!best || rank(source.kind) < rank(best.source.kind) || rank(source.kind) === rank(best.source.kind)
      && (distancePx < best.distancePx || distancePx === best.distancePx && compareIds(source.id, best.source.id) < 0)) best = candidate
  }
  const selected = previous && (!best || rank(previous.source.kind) <= rank(best.source.kind)) ? previous : best
  if (!selected) return { point: fallback, target: null }
  const { id, entityId, kind, label, directionDeg } = selected.source
  return { point: selected.point, target: { id, entityId, kind, label, directionDeg } }
}
