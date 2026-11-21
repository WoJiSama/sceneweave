import type { EdgeStyle, PointMm } from '../model/scene.js'
import type { ProjectedTerrainEdge, Projection } from './types.js'

export interface ProjectedShoreline {
  points: PointMm[]
  closed: boolean
  dryAreaId: string | null
  wetAreaId: string | null
  waterInward: boolean
  style: EdgeStyle
}

/** Outer stroke and four blur radii, or the largest offset foam stroke. */
export const shorelinePaintPadding = (style: EdgeStyle): number => Math.max(style.bandWidthMm * 1.5, style.bandWidthMm * .54 + style.strokeWidthMm / 2)

const keyAt = (p: PointMm): string => `${p.x},${p.y}`

/** Join adjacent declarations before painting so dense source samples do not create cap seams. */
export function planProjectedShorelines(projection: Pick<Projection, 'edges' | 'visual'>): ProjectedShoreline[] {
  const suppressed = new Set(projection.visual?.suppressedTerrainEdgeIds)
  const groups = new Map<string, { settings: Omit<ProjectedShoreline, 'points' | 'closed'>; edges: ProjectedTerrainEdge[] }>()
  for (const edge of projection.edges) {
    const paint = edge.shorePaint
    if (!paint || paint.style.bandWidthMm === 0 || suppressed.has(edge.id)) continue
    const waterInward = paint.waterSide === 'source'
    const wetAreaId = waterInward ? edge.sourceAreaId : edge.neighborAreaId
    const dryAreaId = waterInward ? edge.neighborAreaId : edge.sourceAreaId
    const { bandWidthMm, color, strokeWidthMm } = paint.style
    const key = JSON.stringify([edge.sourceAreaId, wetAreaId, dryAreaId, bandWidthMm, color, strokeWidthMm])
    const group = groups.get(key)
    if (group) group.edges.push(edge)
    else groups.set(key, { settings: { dryAreaId, wetAreaId, waterInward, style: paint.style }, edges: [edge] })
  }

  const result: ProjectedShoreline[] = []
  for (const { settings, edges } of groups.values()) {
    const from = new Map(edges.map(edge => [keyAt(edge.start), edge]))
    const ends = new Set(edges.map(edge => keyAt(edge.end)))
    const ordered = [...edges.filter(edge => !ends.has(keyAt(edge.start))), ...edges]
    for (const first of ordered) {
      if (!from.has(keyAt(first.start))) continue
      const points = [first.start]
      let edge: ProjectedTerrainEdge | undefined = first
      while (edge) {
        from.delete(keyAt(edge.start))
        points.push(edge.end)
        edge = from.get(keyAt(edge.end))
      }
      const closed = keyAt(points[0]) === keyAt(points.at(-1)!)
      if (closed) points.pop()
      result.push({ ...settings, points, closed })
    }
  }
  return result
}
