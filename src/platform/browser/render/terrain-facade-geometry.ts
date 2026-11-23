import { pointInPolygon, segmentCuts } from '../../../shared/geometry/geometry.js'
import { terrainFacadeOffset, type TerrainFacade } from '../../../shared/appearance/terrain-facade.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedBridgeEntrance, ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import { mixPoints, terrainEdgeRuns, type TerrainEdgeRun } from './terrain-edge-bands.js'

type Regions = NonNullable<ProjectedSurface['regionsMm']>
export type FacadeOpenings = Regions
type Landing = NonNullable<ProjectedBridgeEntrance['platform']>
export interface FacadeFace {
  start: PointMm
  end: PointMm
  offsetsMm: [PointMm, PointMm]
  lengthMm: number
  facing: number
  endCaps: [boolean, boolean]
  /** The visible piece starts at this station of the whole straight wall. */
  wall: { fromMm: number; lengthMm: number }
}

type DirectedEdge = TerrainEdgeRun['edges'][number]
interface Wall { a: PointMm; b: PointMm; direction: PointMm; lengthMm: number }
interface Section {
  wall: Wall
  fromMm: number
  toMm: number
  receivingLimit: number
  opening: boolean
  girderOffsetMm?: PointMm
}
interface OffsetSpan { fromMm: number; toMm: number; offsetsMm: [PointMm, PointMm] }

const EPS = 1e-6
const sameDirection = (a: DirectedEdge, b: DirectedEdge) =>
  Math.abs(a.direction.x - b.direction.x) < EPS && Math.abs(a.direction.y - b.direction.y) < EPS
const sameOffset = (a: PointMm | undefined, b: PointMm | undefined) =>
  a === b || (!!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < EPS)

function straightWalls(run: TerrainEdgeRun): DirectedEdge[][] {
  const edges = run.edges
  const firstTurn = run.closed ? edges.findIndex((edge, i) => !sameDirection(edges[(i + edges.length - 1) % edges.length], edge)) : 0
  const ordered = firstTurn > 0 ? [...edges.slice(firstTurn), ...edges.slice(0, firstTurn)] : edges
  const walls: DirectedEdge[][] = []
  for (const edge of ordered) {
    const wall = walls.at(-1)
    if (wall && sameDirection(wall[0], edge)) wall.push(edge)
    else walls.push([edge])
  }
  return walls
}

function capDepth(offset: PointMm, limit: number): PointMm {
  return offset.y <= limit ? offset : { x: offset.x * limit / offset.y, y: limit }
}

function landingTransition(lengthMm: number, pitchMm: number, base: PointMm, start: PointMm, end: PointMm): OffsetSpan[] {
  const transitionLength = (to: PointMm) => sameOffset(base, to) ? 0
    : Math.max(pitchMm * .75, Math.hypot(base.x - to.x, base.y - to.y) * 2)
  const first = transitionLength(start), last = transitionLength(end)
  if (first + last >= lengthMm) return [{ fromMm: 0, toMm: lengthMm, offsetsMm: [start, end] }]
  const spans: OffsetSpan[] = []
  if (first) spans.push({ fromMm: 0, toMm: first, offsetsMm: [start, base] })
  spans.push({ fromMm: first, toMm: lengthMm - last, offsetsMm: [base, base] })
  if (last) spans.push({ fromMm: lengthMm - last, toMm: lengthMm, offsetsMm: [base, end] })
  return spans
}

function visibleFace(wall: Wall, fromMm: number, toMm: number, a: PointMm, b: PointMm, caps: [boolean, boolean]): FacadeFace | undefined {
  const { direction, lengthMm } = wall
  const outward = (offset: PointMm) => direction.y * offset.x - direction.x * offset.y
  const near = outward(a), far = outward(b)
  if (near <= EPS && far <= EPS) return
  let startOffset = a, endOffset = b
  const endCaps = [...caps] as [boolean, boolean]
  if (near < 0 || far < 0) {
    const fraction = near / (near - far)
    const at = fromMm + (toMm - fromMm) * fraction
    const offset = mixPoints(a, b, fraction)
    if (near < 0) { fromMm = at; startOffset = offset; endCaps[0] = false }
    else { toMm = at; endOffset = offset; endCaps[1] = false }
  }
  if (toMm - fromMm < EPS) return
  const middle = mixPoints(startOffset, endOffset, .5)
  const facing = outward(middle) / Math.hypot(middle.x, middle.y)
  if (sameOffset(a, b) && facing < .035) return
  return { start: mixPoints(wall.a, wall.b, fromMm / lengthMm), end: mixPoints(wall.a, wall.b, toMm / lengthMm),
    offsetsMm: [startOffset, endOffset], lengthMm: toMm - fromMm, facing, endCaps, wall: { fromMm, lengthMm } }
}

/** Lay out bays once per wall and interpolate steel feet along the exposed outline. */
export function planFacadeFaces(projection: Pick<Projection, 'edges'>, carrier: Pick<ProjectedSurface, 'id' | 'facade'>,
  openings: FacadeOpenings, landings: readonly Landing[] = []): FacadeFace[] {
  if (!carrier.facade) return []
  const facade = carrier.facade, offset = terrainFacadeOffset(facade)
  // Keep the wall beneath the deck. Only a matching steel section replaces fascia at the joint.
  const bridgeOpenings = facade.profile === 'girder-v1' ? landings.flatMap(({ edgeOpening, girderOffsetMm }) =>
    girderOffsetMm ? edgeOpening.map(region => ({ region, offset: girderOffsetMm })) : []) : []
  const allOpenings = [...openings, ...bridgeOpenings.map(({ region }) => region)]
  const bounds = allOpenings.flatMap(({ outerMm, holesMm }) => [outerMm, ...holesMm].flatMap(ring =>
    ring.map((a, i): [PointMm, PointMm] => [a, ring[(i + 1) % ring.length]])))
  const contains = (region: Regions[number], point: PointMm) => pointInPolygon(point, region.outerMm)
    && !region.holesMm.some(hole => pointInPolygon(point, hole, false))
  const maxDepth = Math.max(offset.y, ...bridgeOpenings.map(row => row.offset.y))
  const edges = projection.edges.filter(edge => edge.kind === 'cliff' && edge.elevationMm !== edge.neighborElevationMm
    && (edge.neighborElevationMm > edge.elevationMm ? edge.neighborAreaId : edge.sourceAreaId) === carrier.id)
  const faces: FacadeFace[] = []
  for (const run of terrainEdgeRuns(edges)) {
    const sections: Section[] = []
    for (const straight of straightWalls(run)) {
      const { a, direction } = straight[0], b = straight.at(-1)!.b
      const wall = { a, b, direction, lengthMm: Math.hypot(b.x - a.x, b.y - a.y) }
      for (const piece of straight) {
        const startMm = Math.hypot(piece.a.x - a.x, piece.a.y - a.y)
        const receivingLimit = piece.edge.neighborAreaId === null ? maxDepth
          : Math.min(maxDepth, Math.abs(piece.edge.elevationMm - piece.edge.neighborElevationMm))
        const cuts = segmentCuts(piece.a, piece.b, bounds)
        for (let i = 1; i < cuts.length; i++) {
          const from = cuts[i - 1], to = cuts[i], midpoint = mixPoints(piece.a, piece.b, (from + to) / 2)
          const opening = allOpenings.some(region => contains(region, midpoint))
          const landing = opening ? bridgeOpenings.reduce<PointMm | undefined>((best, row) =>
            (!best || row.offset.y > best.y) && contains(row.region, midpoint) ? row.offset : best, undefined) : undefined
          const fromMm = startMm + from * piece.length
          const toMm = piece.b === b && to === 1 ? wall.lengthMm : startMm + to * piece.length
          const previous = sections.at(-1)
          if (previous?.wall === wall && previous.receivingLimit === receivingLimit
            && previous.opening === opening && sameOffset(previous.girderOffsetMm, landing)) previous.toMm = toMm
          else sections.push({ wall, fromMm, toMm, receivingLimit, opening, girderOffsetMm: landing })
        }
      }
    }
    appendSolidFaces(faces, sections, run.closed, offset, facade.pitchMm)
  }
  return faces.sort((a, b) => Math.min(a.start.y, a.end.y) - Math.min(b.start.y, b.end.y))
}

function appendSolidFaces(faces: FacadeFace[], sections: Section[], closed: boolean, offset: PointMm, pitchMm: number): void {
  // Start a closed run at a break so a transition can pass through its last vertex.
  const first = closed ? sections.findIndex((section, i) => {
    const previous = sections[i - 1] ?? sections.at(-1)
    return !section.opening && !!previous && (previous.opening || previous.receivingLimit !== section.receivingLimit)
  }) : 0
  const ordered = first > 0 ? [...sections.slice(first), ...sections.slice(0, first)] : sections
  let i = 0
  while (i < ordered.length) {
    if (ordered[i].opening) { i++; continue }
    const start = i, { receivingLimit } = ordered[i]
    let length = 0
    while (i < ordered.length && !ordered[i].opening && ordered[i].receivingLimit === receivingLimit) {
      length += ordered[i].toMm - ordered[i].fromMm
      i++
    }
    if (length < EPS) continue
    const previous = ordered[start - 1] ?? (closed ? ordered.at(-1) : undefined)
    const next = ordered[i] ?? (closed ? ordered[0] : undefined)
    const base = capDepth(offset, receivingLimit)
    const spans = landingTransition(length, pitchMm, base, capDepth(previous?.girderOffsetMm ?? base, receivingLimit),
      capDepth(next?.girderOffsetMm ?? base, receivingLimit))
    let station = 0
    for (const { wall, fromMm, toMm } of ordered.slice(start, i)) {
      const end = station + toMm - fromMm
      for (const span of spans) {
        const from = Math.max(station, span.fromMm), to = Math.min(end, span.toMm)
        if (to - from < EPS) continue
        const at = (value: number) => mixPoints(...span.offsetsMm, (value - span.fromMm) / (span.toMm - span.fromMm))
        const face = visibleFace(wall, fromMm + from - station, fromMm + to - station, at(from), at(to),
          [from < EPS && !!previous?.opening, length - to < EPS && !!next?.opening])
        if (face) faces.push(face)
      }
      station = end
    }
  }
}

export function facadeBayCount(lengthMm: number, facade: Pick<TerrainFacade, 'pitchMm'>): number {
  return Math.min(24, Math.max(1, Math.round(lengthMm / facade.pitchMm)))
}
