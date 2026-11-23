import { routeWidthFrame } from '../geometry/route-width.js'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { TERRAIN_FACADES } from '../appearance/terrain-facade.js'
import { corridor, pointInPolygon, polygonDistance, segmentCuts } from '../geometry/geometry.js'
import type { BoundsMm, Path, PointMm } from '../model/scene.js'
import { bridgeSideOffset } from '../path-assembly/profiles.js'
import type { ProjectedBridgeEntrance, ProjectedPath, ProjectedSurface } from './types.js'

const EPS = 1e-6
const subtract = (a: PointMm, b: PointMm) => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: PointMm, b: PointMm) => a.x * b.x + a.y * b.y
const move = (p: PointMm, dir: PointMm, distance: number) => ({ x: p.x + dir.x * distance, y: p.y + dir.y * distance })
const mix = (a: PointMm, b: PointMm, t: number) => move(a, subtract(b, a), t)
const left = (dir: PointMm) => ({ x: dir.y, y: -dir.x })
const ends = ['start', 'end'] as const
export type PathEnd = typeof ends[number]
type Section = [PointMm, PointMm]
type Regions = NonNullable<ProjectedSurface['regionsMm']>

const ringEdges = (ring: PointMm[]): Section[] => ring.map((p, i) => [p, ring[(i + 1) % ring.length]])
const regionPolygon = (ring: PointMm[]): MultiPolygon => [[ring.map(({ x, y }) => [x, y])]]
const fromPolygons = (polygons: MultiPolygon): Regions => polygons.map(([outer, ...holes]) => ({
  outerMm: outer.slice(0, -1).map(([x, y]) => ({ x, y })), holesMm: holes.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))),
}))
const regionsOf = (surface: ProjectedSurface): Regions => surface.regionsMm ?? [{ outerMm: surface.points, holesMm: [] }]
const polygonsOf = (surface: ProjectedSurface): MultiPolygon => regionsOf(surface).map(region => [region.outerMm, ...region.holesMm].map(ring => ring.map(({ x, y }) => [x, y])))
const contains = (surface: ProjectedSurface, point: PointMm) => regionsOf(surface).some(region => pointInPolygon(point, region.outerMm, false)
  && !region.holesMm.some(hole => pointInPolygon(point, hole)))

/** Trim a paint edge at the same opening used by the bridge and platform sides. */
export function exposedEdgeSegments(edges: Section[], cuts: Regions): Section[] {
  if (!cuts.length) return edges
  const boundaries = cuts.flatMap(region => [region.outerMm, ...region.holesMm].flatMap(ringEdges))
  return edges.flatMap(([a, b]) => {
    const stations = segmentCuts(a, b, boundaries)
    return stations.slice(1).flatMap((to, i): Section[] => {
      const from = stations[i], middle = mix(a, b, (from + to) / 2)
      return cuts.some(region => pointInPolygon(middle, region.outerMm)
        && !region.holesMm.some(hole => pointInPolygon(middle, hole, false))) ? [] : [[mix(a, b, from), mix(a, b, to)]]
    })
  })
}

function terminal(points: PointMm[], end: PathEnd) {
  const i = end === 'start' ? 0 : points.length - 1
  const origin = points[i], delta = subtract(origin, points[i + (i === 0 ? 1 : -1)])
  const length = Math.hypot(delta.x, delta.y)
  return { origin, direction: { x: delta.x / length, y: delta.y / length }, length }
}
const section = (p: PointMm, direction: PointMm, halfWidth: number): Section => [move(p, left(direction), -halfWidth), move(p, left(direction), halfWidth)]
const same = (p: PointMm, q: PointMm) => Math.hypot(p.x - q.x, p.y - q.y) < EPS

export function bridgeWalkCap(bridge: NonNullable<ProjectedPath['bridge']>, end: PathEnd): Section {
  const { origin, direction } = terminal(bridge.centerlineMm, end)
  return section(origin, { x: -direction.x, y: -direction.y }, bridge.widthMm / 2)
}

/** Replace a square end cap with the two sides of its join. The saved hit and
 * support polygon remains available to every physical consumer. */
export function replacePathCaps(points: PointMm[], caps: readonly { cap: Section; sides: [PointMm[], PointMm[]] }[]): PointMm[] {
  const result: PointMm[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const prior = points[(i + points.length - 1) % points.length]
    const join = caps.find(row => same(a, row.cap[0]) && same(b, row.cap[1]))
    if (join) result.push(...join.sides[0].slice().reverse(), ...join.sides[1])
    else if (!caps.some(row => same(prior, row.cap[0]) && same(a, row.cap[1]))) result.push(a)
  }
  return result
}

function tangentCurve(a: PointMm, b: PointMm, from: PointMm, to: PointMm, length: number): PointMm[] {
  const c = move(a, from, length), d = move(b, to, -length)
  return Array.from({ length: 9 }, (_, i) => {
    const t = i / 8
    return mix(mix(mix(a, c, t), mix(c, d, t), t), mix(mix(c, d, t), mix(d, b, t), t), t)
  })
}

interface BridgePathRow { projected: ProjectedPath; source: Path; elevationMm: number }

/** A cut derives from a real deck entering the exposed, same-height top.
 * Nearby or overlapping different-height tops keep their own silhouettes. */
export function planBridgeEntrances(rows: readonly BridgePathRow[], terrain: readonly ProjectedSurface[], rooms: readonly ProjectedSurface[], floor?: { id: string; boundsMm: BoundsMm }): ProjectedBridgeEntrance[] {
  if (!rows.some(row => row.projected.bridge) || rows.length > 128 || terrain.length > 256) return []
  const supports = new Map([...terrain, ...rooms].map(area => [area.id, area]))
  const platforms = terrain.filter(area => !area.bridgeSupport)
  let ground: MultiPolygon | undefined
  const exposedGround = () => {
    if (!floor) return []
    const { x, y, width, height } = floor.boundsMm
    return ground ??= polygonClipping.difference(regionPolygon([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]),
      ...[...platforms, ...rooms].map(polygonsOf))
  }
  const entrances: ProjectedBridgeEntrance[] = []
  const candidates: { entrance: ProjectedBridgeEntrance; approach: NonNullable<ProjectedBridgeEntrance['approach']>; score: number; linked: boolean }[] = []
  for (const { source, projected, elevationMm } of rows) {
    const bridge = projected.bridge
    if (!bridge?.outline.length) continue
    const outline = bridge.outline, deckPolygon = regionPolygon(outline), halfCount = outline.length / 2
    const { shoulderMm, structure } = source.assembly!.recipe
    for (const end of ends) {
      const frame = terminal(bridge.centerlineMm, end), { origin, direction } = frame
      const head = structure?.bridgehead
      const landing = head && (head.ends === 'both' || head.ends === end) ? head : undefined
      const reach = landing?.lengthMm ?? 0, half = bridge.widthMm / 2
      const at = (distance: number) => move(origin, direction, distance)
      const outer = half + shoulderMm + (landing?.wideningMm ?? 0) + 4
      const before = -Math.min(frame.length * .9, outer * 2.5 + reach)
      // The structural cap can abut a platform without overlapping it.
      // Probe beyond the actual rounded deck edge, then prove the full lane.
      const capCenter = end === 'start' ? mix(outline.at(-1)!, outline[0], .5) : mix(outline[halfCount - 1], outline[halfCount], .5)
      const outsideCap = move(capCenter, direction, 1)
      const insideCap = at(reach - .01)
      const outwardPlatform = platforms.findLast(area => contains(area, outsideCap))
      const platform = outwardPlatform ?? platforms.findLast(area => contains(area, insideCap))
      const tip = outwardPlatform ? outsideCap : insideCap
      const entrance: ProjectedBridgeEntrance = { bridgeId: source.id, end }
      const link = source.assembly!.bridge!.roadLinks?.[end]
      if (platform?.elevationMm === elevationMm) {
        const platformPolygon = polygonsOf(platform)
        const boundaries = regionsOf(platform).flatMap(region => [region.outerMm, ...region.holesMm].flatMap(ringEdges))
        const a = at(before), stations = segmentCuts(a, tip, boundaries)
        const contact = stations.findLast((to, i) => i > 0 && to < 1 - EPS && !contains(platform, mix(a, tip, (stations[i - 1] + to) / 2)))
        const mouth = regionPolygon(corridor(at(reach - 2), tip, bridge.widthMm))
        if (contact !== undefined && !polygonClipping.difference(mouth, deckPolygon, platformPolygon).length) {
          const terminalSpan = regionPolygon(corridor(a, at(reach + 4), outer * 2))
          entrance.platform = { id: platform.id, contactMm: mix(a, tip, contact),
            shoulderCut: fromPolygons(polygonClipping.intersection(terminalSpan, platformPolygon)),
            edgeOpening: fromPolygons(polygonClipping.intersection(terminalSpan, deckPolygon)),
            ...(reach > 0 && { laneReachMm: reach - 2 }),
          }
        }
      }
      const start = at(-Math.min(64, frame.length * .1)), from = section(start, direction, half)
      const deckId = source.assembly!.bridge!.deckId
      for (const road of rows) {
        if (road.projected.bridge || road.elevationMm !== elevationMm) continue
        const supportIds = road.source.supportRefs.map(ref => ref.id)
        const hasGround = elevationMm === 0 && road.source.supportRefs.some(ref => ref.kind === 'floor' && ref.id === floor?.id)
        if (!hasGround && !supportIds.includes(deckId) && (!entrance.platform || !supportIds.includes(entrance.platform.id)) && road.source.id !== link?.pathId) continue
        const widths = road.source.widthSections ? routeWidthFrame(road.source.centerlineMm, road.source.widthMm, road.source.widthSections) : null
        for (const roadEnd of ends) {
          if (road.projected.doorThresholds?.some(threshold => threshold.end === roadEnd)) continue
          const widthAt = (advance: number) => widths
            ? widths.widthAt(roadEnd === 'start' ? advance : widths.distances.at(-1)! - advance)
            : road.source.widthMm
          const roadHalf = widthAt(0) / 2
          const terminalRoad = terminal(road.source.centerlineMm, roadEnd), delta = subtract(terminalRoad.origin, origin)
          const inward = { x: -terminalRoad.direction.x, y: -terminalRoad.direction.y }
          const forward = dot(direction, inward), along = dot(delta, direction), side = dot(delta, left(direction))
          const linked = link?.pathId === road.source.id && link.end === roadEnd
          if (forward < .55 || along < -Math.max(half, roadHalf) || along > reach + roadHalf + (linked ? 5 : 0) || Math.abs(side) > Math.max(half, roadHalf)) continue
          const advance = Math.min(terminalRoad.length * .44, Math.max(0, (reach + Math.min(1200, roadHalf * .6) - along) / forward))
          const finish = move(terminalRoad.origin, inward, advance), length = dot(subtract(finish, start), direction)
          if (length < 120 + roadHalf * Math.abs(dot(inward, left(direction)))) continue
          // At the far station the section follows the new road's local normal.
          const roadSection = section(finish, inward, widthAt(advance) / 2)
          const handle = Math.min(length * .37, ...roadSection.map((point, i) => dot(subtract(point, from[i]), direction) * .46))
          const sides: [PointMm[], PointMm[]] = [tangentCurve(from[0], roadSection[0], direction, inward, handle),
            tangentCurve(from[1], roadSection[1], direction, inward, handle)]
          const transition = [...sides[0], ...sides[1].slice().reverse()]
          const cap = section(move(terminalRoad.origin, terminalRoad.direction, roadHalf), inward, roadHalf)
          const attached = ringEdges(road.projected.points).some(([a, b]) => same(a, cap[0]) && same(b, cap[1]))
          if (!attached) continue
          const carriers = [deckPolygon, ...supportIds.flatMap(id => {
            const surface = supports.get(id)
            return surface && id !== deckId && surface.elevationMm === elevationMm ? [polygonsOf(surface)] : []
          })]
          if (hasGround) carriers.push(exposedGround())
          if (polygonClipping.difference(regionPolygon(transition), ...carriers).length) continue
          candidates.push({ entrance, linked, score: Math.hypot(along - reach * .5, side) + (1 - forward) * roadHalf,
            approach: { pathId: road.source.id, end: roadEnd, cap, sides, from: start, to: finish,
              ...(linked && !structure && { deckEdgeMm: origin }) } })
        }
      }
      entrances.push(entrance)
    }
  }
  candidates.sort((a, b) => Number(b.linked) - Number(a.linked) || a.score - b.score)
  const usedEnds = new Set<string>()
  for (const { entrance, approach } of candidates) {
    const key = JSON.stringify([approach.pathId, approach.end])
    if (entrance.approach || usedEnds.has(key)) continue
    entrance.approach = approach
    usedEnds.add(key)
  }
  return entrances.filter(entrance => entrance.platform || entrance.approach)
}

/** Derive the steel section at each landing and fill in an unstyled platform. */
export function fitSteelLandingFacades(
  terrain: readonly ProjectedSurface[], paths: readonly ProjectedPath[], entrances: readonly ProjectedBridgeEntrance[], masks: PointMm[][] = [],
): void {
  const bridges = new Map(paths.flatMap(({ id, bridge }) => bridge ? [[id, bridge] as const] : []))
  const landings = new Map<string, { platform: NonNullable<ProjectedBridgeEntrance['platform']>; offsetMm: PointMm }[]>()
  for (const { bridgeId, platform } of entrances) {
    if (!platform?.edgeOpening.length) continue
    const bridge = bridges.get(bridgeId)
    if (bridge?.finish !== 'steel' || !bridge.structure) continue
    if (!bridge.relief && masks.some(mask => polygonDistance(bridge.outline, mask) < EPS)) continue
    const row = { platform, offsetMm: bridgeSideOffset(bridge.relief?.depthMm ?? 0) }
    const others = landings.get(platform.id)
    if (others) others.push(row)
    else landings.set(platform.id, [row])
  }
  for (const area of terrain) {
    const attached = landings.get(area.id)
    if (!attached || area.waterSurface || area.boundaryBlendMm || area.regionsMm
      || masks.some(mask => polygonDistance(area.points, mask) < EPS)) continue
    const raised = attached.map(({ offsetMm }) => offsetMm.y).filter(depth => depth > 0)
    if (!area.facade && raised.length) area.facade = { ...TERRAIN_FACADES['girder-v1'], depthMm: Math.round(Math.min(...raised)) }
    for (const { platform, offsetMm } of attached) platform.girderOffsetMm = offsetMm
  }
}
