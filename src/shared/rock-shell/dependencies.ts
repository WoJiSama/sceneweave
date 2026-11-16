import type { CarvedStrip } from '../carved-rock/contracts.js'
import type { PointMm, TerrainPoint } from '../model/scene.js'

const EPS = 1e-7
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const on = (p: PointMm, a: PointMm, b: PointMm) => Math.abs(cross(a, b, p)) <= EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  || on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b)

/** The finite first shell keeps complete source/entry edges vertical. A later
 * actual shell-cut solver may extend saved apron geometry, but callers cannot
 * infer that opening from a point or silently bury an existing full-width cut. */
export function requiredRockShellExcludedSegments(host: { boundaryMm: TerrainPoint[] }, strips: readonly CarvedStrip[]): string[] {
  const result = new Set(strips.flatMap(strip => strip.sourceSegmentIds))
  for (const [i, row] of host.boundaryMm.entries()) {
    const a = row.positionMm, b = host.boundaryMm[(i + 1) % host.boundaryMm.length].positionMm
    for (const strip of strips) for (const face of Object.values(strip.faces)) {
      const vertices = face.vertexIds.map(id => strip.verticesMm[id])
      if (vertices.some((c, j) => meet(a, b, c, vertices[(j + 1) % vertices.length]))) result.add(row.segmentId)
    }
  }
  return [...result].sort()
}

export function assertRockShellCutClearance(host: { boundaryMm: TerrainPoint[]; rockBody?: { shell?: { recipe: { excludedSegmentIds: string[] } } } }, strips: readonly CarvedStrip[]): void {
  const excluded = host.rockBody?.shell?.recipe.excludedSegmentIds
  if (excluded && requiredRockShellExcludedSegments(host, strips).some(id => !excluded.includes(id))) throw new Error('首片真实侧壳须保留山路源崖及完整入口边为竖直面；当前不支持隐式延长切口穿过新侧壳。')
}
