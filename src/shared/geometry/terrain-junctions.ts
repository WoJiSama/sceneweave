import type { PointMm } from '../model/scene.js'
import { indexEdges } from './edge-index.js'
import { segmentCuts } from './geometry.js'

type Ring = { id: string; points: PointMm[] }
const onLine = (p: PointMm, a: PointMm, b: PointMm) =>
  (b.x - a.x) * (p.y - a.y) === (b.y - a.y) * (p.x - a.x)

/** Insert exact millimetre junctions into new rings. Existing scene edges are
 * never moved or split by this helper. Nonintegral crossings still go through
 * native topology diagnostics. */
export function splitNewTerrainJunctions(rings: Ring[]): Ring[] {
  if (rings.length < 2) return rings
  const segments = rings.flatMap(row => row.points.map((a, i) =>
    ({ id: row.id, edge: [a, row.points[(i + 1) % row.points.length]] as [PointMm, PointMm] })))
  const index = indexEdges(segments.map(row => row.edge))
  return rings.map(row => ({ ...row, points: row.points.flatMap((a, i) => {
    const b = row.points[(i + 1) % row.points.length], cuts = new Map<number, PointMm>()
    for (const j of index(a, b)) {
      const { id, edge: [c, d] } = segments[j]
      if (id === row.id) continue
      for (const t of segmentCuts(a, b, [[c, d]]).slice(1, -1)) {
        const point = { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }
        if (onLine(point, a, b) && onLine(point, c, d) && (point.x !== a.x || point.y !== a.y) && (point.x !== b.x || point.y !== b.y)) cuts.set(t, point)
      }
    }
    const vertices = new Map<string, PointMm>()
    for (const [, point] of [...cuts].sort(([left], [right]) => left - right)) vertices.set(`${point.x}/${point.y}`, point)
    return [a, ...vertices.values()]
  }) }))
}
