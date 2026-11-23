import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import type { Audience, ProjectedSurface, ProjectedWall, Projection } from '../projection/types.js'
import { openingEndpoints, pointInPolygon, polygonDistance, polylineSides, roomPoints, segmentCuts, terrainPoints } from '../geometry/geometry.js'
import { connectionArcFrame } from '../geometry/connection-route.js'
import { routeWidthFrame } from '../geometry/route-width.js'
import { playerMaskContains } from '../projection/player-mask.js'
import type { LightBeam } from '../validation/primitives.js'
import type { DirectionalLight, LightShape, VisualLight } from './types.js'

export const DEFAULT_LIGHT_BEAM: LightBeam = { directionDeg: 0, apertureDeg: 55, softness: .35 }
export const DIRECTIONAL_LIGHT_PRESETS = {
  sun: { kind: 'sun', elevationDeg: 34, color: '#FFE6B8', intensity: .8, softness: .36 },
  moon: { kind: 'moon', elevationDeg: 28, color: '#9CBDEB', intensity: .56, softness: .65 },
} as const satisfies Record<string, DirectionalLight>
export const LIGHT_LABELS = { point: '点光', spot: '聚光', window: '窗光', line: '线光', area: '面光' } as const
export const normalizeLightDirection = (degrees: number) => (degrees % 360 + 360) % 360

type WindowShape = Extract<LightShape, { kind: 'window' }>
type Regions = NonNullable<ProjectedSurface['regionsMm']>
const midpoint = (a: PointMm, b: PointMm): PointMm => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** A receiving room gives the window a stable inward side even if a wall's
 * stored vertex order is reversed or the opening is transferred to a split. */
export function windowReceivers(scene: SceneDocument, openingId: string): SceneDocument['rooms'][string][] {
  const opening = Object.hasOwn(scene.openings, openingId) ? scene.openings[openingId] : undefined
  const wall = opening && scene.walls[opening.wallId]
  if (opening?.kind !== 'window' || !wall) return []
  return Object.values(scene.rooms).filter(room => room.floorId === opening.floorId && room.boundaryVertexIds.some((id, index, ring) => {
    const next = ring[(index + 1) % ring.length]
    return id === wall.startVertexId && next === wall.endVertexId || id === wall.endVertexId && next === wall.startVertexId
  }))
}

function windowGeometry(aperture: [PointMm, PointMm], room: Pick<ProjectedSurface, 'points'>, thicknessMm: number) {
  const [first, last] = aperture
  const [a, b] = first.x < last.x || first.x === last.x && first.y <= last.y ? aperture : [last, first]
  const center = midpoint(a, b), length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length <= 0) return
  const side = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
  const probe = { x: center.x + side.x * .5, y: center.y + side.y * .5 }
  const sign = pointInPolygon(probe, room.points, false) ? 1 : -1
  const normal = { x: side.x * sign, y: side.y * sign }
  const inset = thicknessMm / 2 + 2
  return { points: [a, b].map(p => ({ x: p.x + normal.x * inset, y: p.y + normal.y * inset })), normal }
}

function pathLightRuns(path: SceneDocument['paths'][string], side: 'center' | 'left' | 'right'): PointMm[][] {
  if (side === 'center') return [path.centerlineMm.map(p => ({ ...p }))]
  const { centerlineMm, widthMm, widthSections, assembly } = path
  if (centerlineMm.length < 2 || centerlineMm.some((p, i) => i > 0 && p.x === centerlineMm[i - 1].x && p.y === centerlineMm[i - 1].y)) return []
  const route = connectionArcFrame(centerlineMm), width = widthSections ? routeWidthFrame(centerlineMm, widthMm, widthSections) : undefined
  const stations = width?.stations.map(station => station.distanceMm) ?? route.distances
  const recipe = assembly?.recipe
  const hasRail = recipe && recipe.section.kind !== 'none' && (recipe.sides === side || recipe.sides === 'both')
  const clearance = hasRail ? recipe.endClearanceMm : 0
  const spans: [number, number][] = []
  let start = clearance
  const end = route.length - clearance
  for (const gap of (hasRail ? [...recipe.gaps ?? []].sort((a, b) => a.fromMm - b.fromMm) : [])) {
    if (gap.side !== side && gap.side !== 'both' || gap.toMm <= start || gap.fromMm >= end) continue
    if (gap.fromMm > start) spans.push([start, gap.fromMm])
    start = gap.toMm
  }
  if (end > start) spans.push([start, end])
  return spans.map(([from, to]) => {
    const distances = [from, ...stations.filter(station => station > from + 1e-6 && station < to - 1e-6), to]
    return polylineSides(distances.map(value => route.at(value)), distances.map(value => (width?.widthAt(value) ?? widthMm) + (recipe?.shoulderMm ?? 0)))[side]
  }).filter(points => points.length > 1)
}

function lineLightRuns(scene: SceneDocument, light: VisualLight, source: Extract<LightShape, { kind: 'line' }>['source']): PointMm[][] {
  if (source.kind === 'segment') return [[light.positionMm, source.endMm]]
  const path = Object.hasOwn(scene.paths, source.pathId) ? scene.paths[source.pathId] : undefined
  return path?.floorId === light.floorId ? pathLightRuns(path, source.side) : []
}

/** Geometry for authoring validation and dependency bounds. Rendering resolves
 * the same host through the already-filtered audience projection. */
export function lightSourcePoints(scene: SceneDocument, light: VisualLight): PointMm[] {
  const shape = light.shape
  if (!shape || shape.kind === 'spot') return [light.positionMm]
  if (shape.kind === 'window') {
    const opening = scene.openings[shape.openingId]
    const wall = opening && scene.walls[opening.wallId]
    return opening?.kind === 'window' && opening.floorId === light.floorId && wall
      && Object.hasOwn(scene.vertices, wall.startVertexId) && Object.hasOwn(scene.vertices, wall.endVertexId)
      && windowReceivers(scene, opening.id).some(room => room.id === shape.roomId) ? openingEndpoints(scene, opening) : []
  }
  if (shape.kind === 'area') {
    const { source } = shape
    if (source.kind === 'terrainArea') {
      const area = Object.hasOwn(scene.terrainAreas, source.id) ? scene.terrainAreas[source.id] : undefined
      return area?.floorId === light.floorId ? terrainPoints(area) : []
    }
    const room = Object.hasOwn(scene.rooms, source.id) ? scene.rooms[source.id] : undefined
    return room?.floorId === light.floorId ? roomPoints(scene, room) : []
  }
  return lineLightRuns(scene, light, shape.source).flat()
}

export function lightHostIds(scene: SceneDocument, light: Pick<VisualLight, 'shape'>): string[] {
  const shape = light.shape
  if (!shape || shape.kind === 'spot') return []
  if (shape.kind === 'window') {
    const opening = Object.hasOwn(scene.openings, shape.openingId) ? scene.openings[shape.openingId] : undefined
    return [shape.openingId, shape.roomId, ...(opening ? [opening.wallId] : [])]
  }
  if (shape.kind === 'area') return [shape.source.id]
  return shape.source.kind === 'path' ? [shape.source.pathId] : []
}

export type ProjectedLightShape =
  | ({ kind: 'spot' } & LightBeam)
  | { kind: 'window'; aperture: [PointMm, PointMm]; beam: PointMm[]; receiver: PointMm[]; softness: number }
  | { kind: 'line'; runs: PointMm[][]; softness: number }
  | { kind: 'area'; regions: Regions; surfaceIntensity: number; softness: number }
export type ProjectedLight = Omit<VisualLight, 'shape'> & { shape?: ProjectedLightShape }

/** Position/width come from the public aperture; a room clip keeps the light
 * within the deliberately selected side of a shared window. */
function projectWindow(shape: WindowShape, radiusMm: number, aperture: [PointMm, PointMm], room: Pick<ProjectedSurface, 'points'>, thicknessMm: number): Extract<ProjectedLightShape, { kind: 'window' }> | undefined {
  const geometry = windowGeometry(aperture, room, thicknessMm)
  if (!geometry) return
  const [a, b] = geometry.points, center = midpoint(a, b)
  const direction = Math.atan2(geometry.normal.y, geometry.normal.x) + shape.angleOffsetDeg * Math.PI / 180
  const spread = Math.tan(shape.spreadDeg * Math.PI / 180) * radiusMm
  const width = Math.hypot(b.x - a.x, b.y - a.y), tx = (b.x - a.x) / width, ty = (b.y - a.y) / width
  const end = { x: center.x + Math.cos(direction) * radiusMm, y: center.y + Math.sin(direction) * radiusMm }
  return { kind: 'window', aperture: [a, b], beam: [a, b, { x: end.x + tx * (width / 2 + spread), y: end.y + ty * (width / 2 + spread) },
    { x: end.x - tx * (width / 2 + spread), y: end.y - ty * (width / 2 + spread) }], receiver: room.points, softness: shape.softness }
}

/** Conservatively includes the swept corners of an angled or spreading beam. */
export function lightPaintFootprint(scene: SceneDocument, light: VisualLight): { points: PointMm[]; padding: number } {
  const points = lightSourcePoints(scene, light), shape = light.shape
  if (shape?.kind !== 'window' || points.length !== 2) return { points, padding: light.radiusMm }
  const wall = scene.walls[scene.openings[shape.openingId].wallId]
  const resolved = projectWindow(shape, light.radiusMm, [points[0], points[1]], { points: roomPoints(scene, scene.rooms[shape.roomId]) }, wall.thicknessMm)
  return { points: resolved ? [...points, ...resolved.beam] : points, padding: 0 }
}

/** Never expose source IDs or geometry for a light attached to hidden hosts. */
export function projectLight(scene: SceneDocument, projection: Projection, light: VisualLight, audience: Audience,
  apertureWalls: readonly ProjectedWall[] = projection.walls): ProjectedLight | undefined {
  const { shape, ...plain } = light, player = audience === 'player'
  const masked = (p: PointMm) => player && playerMaskContains(p, projection.masks, projection.maskPublicRooms)
  const touchesMask = (points: PointMm[]) => player && projection.masks.some(mask => polygonDistance(points, mask) < 1e-6)
  const hidesLine = (runs: readonly PointMm[][]) => {
    if (!player || !projection.masks.length) return false
    const boundaries = [...projection.masks, ...(projection.maskPublicRooms ?? []).flat()].flatMap(ring =>
      ring.map((p, index) => [p, ring[(index + 1) % ring.length]] as [PointMm, PointMm]))
    return runs.some(points => points.some(masked) || points.slice(1).some((b, index) => {
      const a = points[index], cuts = segmentCuts(a, b, boundaries)
      return cuts.slice(1).some((t, k) => {
        const middle = (t + cuts[k]) / 2
        return masked({ x: a.x + (b.x - a.x) * middle, y: a.y + (b.y - a.y) * middle })
      })
    }))
  }
  if (!shape || shape.kind === 'spot') return masked(light.positionMm) ? undefined : { ...plain, ...(shape && { shape }) }
  if (shape.kind === 'window') {
    const wall = apertureWalls.find(wall => wall.openings.some(opening => opening.id === shape.openingId))
    const opening = wall?.openings.find(opening => opening.id === shape.openingId)
    const room = projection.rooms.find(room => room.id === shape.roomId)
    if (!wall || !opening || opening.kind !== 'window' || opening.paintSymbol === false || !room
      || !windowReceivers(scene, shape.openingId).some(receiver => receiver.id === room.id)
      || touchesMask([opening.start, opening.end])) return
    const resolved = projectWindow(shape, light.radiusMm, [opening.start, opening.end], room, wall.thicknessMm)
    if (!resolved || hidesLine([resolved.aperture])) return
    const positionMm = midpoint(...resolved.aperture)
    return masked(positionMm) ? undefined : { ...plain, positionMm, shape: resolved }
  }
  if (shape.kind === 'line') {
    const { source } = shape
    if (source.kind === 'path' && !projection.paths.some(path => path.id === source.pathId)) return
    const runs = lineLightRuns(scene, light, source)
    if (!runs.length || hidesLine(runs)) return
    return { ...plain, positionMm: runs[0][0], shape: { kind: 'line', runs, softness: shape.softness } }
  }
  const surface = (shape.source.kind === 'room' ? projection.rooms : projection.terrain).find(row => row.id === shape.source.id)
  if (!surface) return
  const regions = surface.regionsMm ?? [{ outerMm: surface.points, holesMm: [] }]
  if (!regions.length || touchesMask(surface.points) || regions.some(region => touchesMask(region.outerMm))) return
  return { ...plain, positionMm: surface.points[0], shape: { kind: 'area', regions, surfaceIntensity: shape.surfaceIntensity, softness: shape.softness } }
}

export function lightSourceBounds(points: readonly PointMm[], padding: number): BoundsMm {
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs) - padding, y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + 2 * padding, height: Math.max(...ys) - Math.min(...ys) + 2 * padding }
}
