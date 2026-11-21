import { pointInPolygon, segmentCuts } from '../../../shared/geometry/geometry.js'
import { terrainFacadeOffset, type TerrainFacade } from '../../../shared/appearance/terrain-facade.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import { mixPoints, terrainEdgeRuns, type TerrainEdgeRun } from './terrain-edge-bands.js'

export type FacadeOpenings = NonNullable<ProjectedSurface['regionsMm']>
export interface FacadeFace {
  start: PointMm
  end: PointMm
  offset: PointMm
  lengthMm: number
  facing: number
  endCaps: [boolean, boolean]
  /** The visible piece starts at this station of the whole straight wall. */
  wall: { fromMm: number; lengthMm: number }
}

type DirectedEdge = TerrainEdgeRun['edges'][number]
const EPS = 1e-6
const sameDirection = (a: DirectedEdge, b: DirectedEdge) =>
  Math.abs(a.direction.x - b.direction.x) < EPS && Math.abs(a.direction.y - b.direction.y) < EPS

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

/** Lay out bays once per straight wall. A lower receiving top clips the
 * bottom of the wall; a crossing clips its width and adds a jamb. */
export function planFacadeFaces(projection: Pick<Projection, 'edges'>, carrier: Pick<ProjectedSurface, 'id' | 'facade'>, openings: FacadeOpenings): FacadeFace[] {
  if (!carrier.facade) return []
  const facade = carrier.facade, offset = terrainFacadeOffset(facade), offsetLength = Math.hypot(offset.x, offset.y)
  const bounds = openings.flatMap(({ outerMm, holesMm }) => [outerMm, ...holesMm].flatMap(ring =>
    ring.map((a, i): [PointMm, PointMm] => [a, ring[(i + 1) % ring.length]])))
  const isOpening = (p: PointMm) => openings.some(region => pointInPolygon(p, region.outerMm)
    && !region.holesMm.some(hole => pointInPolygon(p, hole, false)))
  const edges = projection.edges.filter(edge => edge.kind === 'cliff' && edge.elevationMm !== edge.neighborElevationMm
    && (edge.neighborElevationMm > edge.elevationMm ? edge.neighborAreaId : edge.sourceAreaId) === carrier.id)
  const faces: FacadeFace[] = []
  for (const run of terrainEdgeRuns(edges)) for (const wall of straightWalls(run)) {
    const { a, direction } = wall[0], b = wall.at(-1)!.b, length = Math.hypot(b.x - a.x, b.y - a.y)
    const facing = (direction.y * offset.x - direction.x * offset.y) / offsetLength
    if (facing < .035 || length < 1) continue
    const depths: { from: number; to: number; depthMm: number }[] = []
    for (const { edge, b: end } of wall) {
      const from = depths.at(-1)?.to ?? 0, to = end === b ? 1 : Math.hypot(end.x - a.x, end.y - a.y) / length
      const depthMm = edge.neighborAreaId === null ? facade.depthMm : Math.min(facade.depthMm, Math.abs(edge.elevationMm - edge.neighborElevationMm))
      const previous = depths.at(-1)
      if (previous?.depthMm === depthMm) previous.to = to
      else depths.push({ from, to, depthMm })
    }
    const cuts = segmentCuts(a, b, bounds)
    const sections = cuts.slice(1).map((to, i) => ({ from: cuts[i], to, opening: isOpening(mixPoints(a, b, (cuts[i] + to) / 2)) }))
    for (const [i, section] of sections.entries()) if (!section.opening) for (const depth of depths) {
      const from = Math.max(section.from, depth.from), to = Math.min(section.to, depth.to), lengthMm = (to - from) * length
      if (lengthMm < EPS) continue
      faces.push({ start: mixPoints(a, b, from), end: mixPoints(a, b, to), offset: { x: offset.x * depth.depthMm / facade.depthMm, y: depth.depthMm },
        lengthMm, facing, endCaps: [from === section.from && !!sections[i - 1]?.opening, to === section.to && !!sections[i + 1]?.opening],
        wall: { fromMm: from * length, lengthMm: length } })
    }
  }
  return faces.sort((a, b) => Math.min(a.start.y, a.end.y) - Math.min(b.start.y, b.end.y))
}

export function facadeBayCount(lengthMm: number, facade: Pick<TerrainFacade, 'pitchMm'>): number {
  return Math.min(24, Math.max(1, Math.round(lengthMm / facade.pitchMm)))
}
