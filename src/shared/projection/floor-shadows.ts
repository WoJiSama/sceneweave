import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { BoundsMm, PointMm } from '../model/scene.js'
import { polygonDistance } from '../geometry/geometry.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { pointsBounds } from './projection.js'
import type { ProjectedFloorShadow, ProjectedSurface, Projection } from './types.js'
import { directionalShadowReach } from '../visual/directional-light.js'

type Regions = NonNullable<ProjectedSurface['regionsMm']>
const MAX_REACH_MM = 7000
const MAX_BLUR_MM = 620
const ring = (points: PointMm[]) => points.map(({ x, y }): [number, number] => [x, y])
const rectangle = ({ x, y, width, height }: BoundsMm): MultiPolygon => [[[[x, y], [x + width, y], [x + width, y + height], [x, y + height]]]]
const toRegions = (polygons: MultiPolygon): Regions => polygons.map(([outer, ...holes]) => ({
  outerMm: outer.slice(0, -1).map(([x, y]) => ({ x, y })),
  holesMm: holes.map(points => points.slice(0, -1).map(([x, y]) => ({ x, y }))),
}))
const union = (polygons: MultiPolygon[]) => polygons.length ? polygonClipping.union(polygons[0], ...polygons.slice(1)) : []

function overlap(a: BoundsMm, b: BoundsMm): BoundsMm | undefined {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}

interface Receiver {
  outer: PointMm[]
  holes: PointMm[][]
  bounds: BoundsMm
  elevationMm?: number
}

function orderedReceivers(floor: Projection): Receiver[] {
  const receiver = (outer: PointMm[], holes: PointMm[][], elevationMm?: number): Receiver => ({
    outer, holes, bounds: pointsBounds(outer), elevationMm,
  })
  // Opaque player masks occlude the shadow as well as all lower surfaces.
  return [
    ...(floor.audience === 'player' ? floor.masks.map((mask, index) => receiver(mask, floor.maskPublicRooms?.[index] ?? [])) : []),
    ...[...floor.rooms].reverse().concat([...floor.terrain].reverse()).flatMap(surface =>
      (surface.regionsMm ?? [{ outerMm: surface.points, holesMm: [] }]).map(({ outerMm, holesMm }) => receiver(outerMm, holesMm, surface.elevationMm))),
  ]
}

function visibleReceivers(floors: { bounds: BoundsMm; receivers: Receiver[] }[], area: BoundsMm): Map<number, MultiPolygon[]> {
  const candidates = floors.flatMap(({ bounds, receivers }) => {
    const clip = overlap(bounds, area)
    return clip ? receivers.filter(receiver => overlap(receiver.bounds, clip)).map(receiver => ({ receiver, clip })) : []
  })
  const groups = new Map<number, MultiPolygon[]>()
  const vertexCount = candidates.reduce((count, { receiver }) =>
    count + receiver.outer.length + receiver.holes.reduce((sum, hole) => sum + hole.length, 0), 0)
  if (candidates.length > 256 || vertexCount > 16384) return groups
  let covered: MultiPolygon = []
  for (const { receiver, clip } of candidates) {
    const trimmed = polygonClipping.intersection([[ring(receiver.outer)]], rectangle(clip))
    if (!trimmed.length) continue
    const holes = receiver.holes.filter(hole => overlap(pointsBounds(hole), clip)).map(hole => [[ring(hole)]] as MultiPolygon)
    const visible = polygonClipping.difference(trimmed, covered, ...holes)
    if (!visible.length) continue
    if (receiver.elevationMm !== undefined) {
      const group = groups.get(receiver.elevationMm) ?? []
      group.push(visible)
      groups.set(receiver.elevationMm, group)
    }
    covered = union([covered, visible])
  }
  return groups
}

/** Cast onto actual lower surfaces. Background artwork has no receiver elevation. */
export function planFloorShadows(source: Projection, lower: readonly Projection[], view = source.bounds, signal?: CancellationSignal): ProjectedFloorShadow[] {
  const visible = overlap(source.bounds, view)
  if (!lower.length || !visible) return []
  const casters = source.paths.flatMap(({ bridge }) => bridge?.relief?.shadowOpacity ? [{
    polygons: [[ring(bridge.outline)]] as MultiPolygon, elevationMm: bridge.relief.elevationMm, opacity: bridge.relief.shadowOpacity,
  }] : [])
  const directional = source.visual?.environment.directionalLight
  const opacity = directional?.intensity ? Math.min(.6, directional.intensity * .42)
    : (source.visual?.environment.contactShadowOpacity ?? 0) * .88
  const facades = source.terrain.filter(area => area.facade)
  if (opacity > 0 && facades.length <= 128) for (const top of facades) {
    checkCancelled(signal)
    const regions = top.regionsMm ?? [{ outerMm: top.points, holesMm: [] }]
    if (source.audience === 'player' && regions.some(region => source.masks.some(mask => polygonDistance(region.outerMm, mask) < 1e-6))) continue
    const polygons = regions.map(({ outerMm, holesMm }) => [ring(outerMm), ...holesMm.map(ring)])
    casters.push({ polygons, elevationMm: top.elevationMm, opacity })
  }
  if (!casters.length) return []
  const floors = [...lower].reverse().filter(floor => overlap(floor.bounds, visible)).map(floor => ({
    bounds: floor.bounds, receivers: orderedReceivers(floor),
  }))
  if (!floors.length) return []
  const angle = (source.visual?.environment.lightDirectionDeg ?? 315) * Math.PI / 180
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const furthest = { x: direction.x * MAX_REACH_MM, y: direction.y * MAX_REACH_MM }
  const sourceClip = rectangle(source.bounds)
  return casters.flatMap(({ polygons: outline, elevationMm, opacity }) => {
    checkCancelled(signal)
    const caster = toRegions(polygonClipping.intersection(outline, sourceClip))
    if (!caster.length) return []
    const { x, y, width, height } = pointsBounds(caster.flatMap(region => region.outerMm))
    const pad = MAX_BLUR_MM * 4
    const area = overlap(visible, {
      x: x + Math.min(0, furthest.x) - pad, y: y + Math.min(0, furthest.y) - pad,
      width: width + Math.abs(furthest.x) + 2 * pad, height: height + Math.abs(furthest.y) + 2 * pad,
    })
    if (!area) return []
    return [...visibleReceivers(floors, area)].flatMap(([receiverHeight, polygons]) => {
      const drop = elevationMm - receiverHeight
      if (drop <= 0) return []
      const reach = directional?.intensity ? directionalShadowReach(directional, drop, MAX_REACH_MM) : Math.min(MAX_REACH_MM, drop * .60)
      const blurMm = Math.min(MAX_BLUR_MM, directional?.intensity ? 32 + directional.softness * (100 + reach * .13) : 85 + drop * .09)
      const offsetMm = { x: direction.x * reach, y: direction.y * reach }
      const receiver = toRegions(polygonClipping.intersection(union(polygons),
        rectangle({ x: x + offsetMm.x - blurMm * 4, y: y + offsetMm.y - blurMm * 4, width: width + blurMm * 8, height: height + blurMm * 8 })))
      return receiver.length ? [{ caster, receiver, offsetMm, blurMm, opacity }] : []
    })
  })
}
