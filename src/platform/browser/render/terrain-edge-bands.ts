import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedTerrainEdge, Projection } from '../../../shared/projection/types.js'

interface DirectedEdge {
  edge: ProjectedTerrainEdge
  a: PointMm
  b: PointMm
  direction: PointMm
  length: number
  order: number
}

export interface TerrainEdgeRun {
  highAreaId: string | null
  edges: DirectedEdge[]
  points: PointMm[]
  closed: boolean
}

export interface TerrainBandCell {
  edge: ProjectedTerrainEdge
  top: [PointMm, PointMm]
  foot: [PointMm, PointMm]
  bevels: { anchor: PointMm; a: PointMm; b: PointMm }[]
}

const positionKey = ({ x, y }: PointMm) => `${x},${y}`
const cross = (u: PointMm, v: PointMm) => u.x * v.y - u.y * v.x
const subtract = (a: PointMm, b: PointMm) => ({ x: a.x - b.x, y: a.y - b.y })
const offset = (p: PointMm, direction: PointMm, mm: number) => ({ x: p.x + direction.x * mm, y: p.y + direction.y * mm })
export const mixPoints = (a: PointMm, b: PointMm, t: number) => offset(a, subtract(b, a), t)

/** Trace only unambiguous vertices on the same exposed carrier. For cliffs the
 * high side stays on the left, even when the canonical source is the low area. */
export function terrainEdgeRuns(edges: readonly ProjectedTerrainEdge[]): TerrainEdgeRun[] {
  const groups = new Map<string, { highAreaId: string | null; edges: DirectedEdge[] }>()
  for (const [order, edge] of edges.entries()) {
    const reverse = edge.kind === 'cliff' && edge.neighborElevationMm > edge.elevationMm
    const highAreaId = edge.kind === 'cliff' ? reverse ? edge.neighborAreaId : edge.sourceAreaId : null
    const key = JSON.stringify([edge.kind, highAreaId ?? edge.sourceAreaId, Math.max(edge.elevationMm, edge.neighborElevationMm)])
    const a = reverse ? edge.end : edge.start, b = reverse ? edge.start : edge.end
    const { x, y } = subtract(b, a), length = Math.hypot(x, y)
    if (!length) continue
    const directed = { edge, a, b, direction: { x: x / length, y: y / length }, length, order }
    const group = groups.get(key)
    if (group) group.edges.push(directed)
    else groups.set(key, { highAreaId, edges: [directed] })
  }
  const result: { run: TerrainEdgeRun; order: number }[] = []
  for (const group of groups.values()) {
    const starts = new Map<string, DirectedEdge | null>(), ends = new Map<string, DirectedEdge | null>()
    for (const edge of group.edges) {
      const a = positionKey(edge.a), b = positionKey(edge.b)
      starts.set(a, starts.has(a) ? null : edge)
      ends.set(b, ends.has(b) ? null : edge)
    }
    const hasPrevious = (edge: DirectedEdge) => !!ends.get(positionKey(edge.a)) && starts.get(positionKey(edge.a)) === edge
    const visited = new Set<DirectedEdge>()
    for (const first of [...group.edges.filter(edge => !hasPrevious(edge)), ...group.edges]) {
      if (visited.has(first)) continue
      const chain = [], points = [first.a]
      let edge: DirectedEdge | null | undefined = first, order = first.order
      while (edge && !visited.has(edge)) {
        visited.add(edge); chain.push(edge); points.push(edge.b)
        order = Math.min(order, edge.order)
        const end = positionKey(edge.b)
        edge = ends.get(end) === edge ? starts.get(end) : null
      }
      const closed = edge === first
      if (closed) points.pop()
      result.push({ run: { highAreaId: group.highAreaId, edges: chain, points, closed }, order })
    }
  }
  return result.sort((a, b) => a.order - b.order).map(({ run }) => run)
}

export function cliffBandWidth(edge: ProjectedTerrainEdge, theme: Projection['theme']): number {
  if (edge.kind !== 'cliff') return 0
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm), cliff = theme?.terrainCliff
  if (!delta) return 0
  return edge.customFinish ? edge.style.bandWidthMm : Math.min(edge.style.bandWidthMm, cliff?.maxOffsetMm ?? 600, Math.round((cliff?.offsetFactor ?? .18) * delta))
}

/** A bounded miter shares identical feet on both segments. A sharp exterior
 * turn gets a bevel. At a short inside turn the quads overlap, so the band
 * keeps its coverage without folding either cell back across its own top. */
export function terrainBandCells(run: TerrainEdgeRun, widthAt: (edge: ProjectedTerrainEdge) => number, side: 1 | -1): TerrainBandCell[] {
  const widths = run.edges.map(row => widthAt(row.edge))
  const cells = run.edges.map(({ edge, a, b, direction }, index): TerrainBandCell => {
    const normal = { x: direction.y, y: -direction.x }, width = widths[index] * side
    return { edge, top: [a, b], foot: [offset(a, normal, width), offset(b, normal, width)], bevels: [] }
  })
  for (let i = run.closed ? 0 : 1; i < cells.length; i++) {
    const j = (i + cells.length - 1) % cells.length
    const before = run.edges[j], after = run.edges[i], u = before.direction, v = after.direction
    const left = cells[j], right = cells[i], a = left.foot[1], b = right.foot[0], vertex = after.a
    const turn = cross(u, v), width = Math.max(widths[j], widths[i])
    if (!widths[j] || !widths[i] || Math.abs(turn) < 1e-8) continue
    const gap = subtract(b, a), advance = cross(gap, v) / turn, retreat = cross(gap, u) / turn
    const miter = offset(a, u, advance)
    if (Math.hypot(miter.x - vertex.x, miter.y - vertex.y) <= 1.6 * width
      && advance >= -before.length * .45 && retreat <= after.length * .45) {
      left.foot[1] = right.foot[0] = miter
    } else if (turn * side > 0) {
      const mid = mixPoints(a, b, .5)
      left.bevels.push({ anchor: vertex, a, b: mid })
      right.bevels.push({ anchor: vertex, a: mid, b })
    }
  }
  return cells.filter((_, i) => widths[i] > 0)
}
