import type { PointMm } from '../model/scene.js'

export interface InlayPaintWall {
  a: PointMm; b: PointMm; highMm: readonly [number, number]; lowMm: readonly [number, number]
  normal: PointMm; lowSourceAreaId: string | null
}
export interface InlayWallPaintPiece {
  lowSourceAreaId: string | null
  pointsMm: PointMm[]
  topMm: PointMm
  footMm: PointMm
}
const midpoint = (a: PointMm, b: PointMm) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Finite display of already-proven vertical walls, not physical support.
 * Keep original per-wall reaches. At a convex joint their two low endpoints
 * leave a triangular paint gap; fill exactly that convex hull, never a new
 * offset/miter or a widened walk band. Source/height discontinuities don't join.
 * Input is the audience-owned projection, after dependency filtering. */
export function terrainInlayWallPaint(walls: readonly InlayPaintWall[]): InlayWallPaintPiece[] {
  if (walls.length > 4096) throw Error('实际外露壁绘制超过有限线段预算。')
  const result: InlayWallPaintPiece[] = []
  const nodes = new Map<string, { p: PointMm; lower: PointMm; tangent: PointMm; normal: PointMm; source: string | null; high: number; low: number }[]>()
  for (const wall of walls) {
    const lower = [wall.a, wall.b].map((p, i) => {
      const reach = Math.min(600, Math.max(0, wall.highMm[i] - wall.lowMm[i]) * .18)
      return { x: p.x + wall.normal.x * reach, y: p.y + wall.normal.y * reach }
    })
    result.push({ lowSourceAreaId: wall.lowSourceAreaId, pointsMm: [wall.a, wall.b, lower[1], lower[0]], topMm: midpoint(wall.a, wall.b), footMm: midpoint(lower[0], lower[1]) })
    for (const [i, p] of [wall.a, wall.b].entries()) {
      const key = JSON.stringify([p.x, p.y, wall.lowSourceAreaId])
      const other = i ? wall.a : wall.b, rows = nodes.get(key) ?? []
      rows.push({ p, lower: lower[i], tangent: { x: other.x - p.x, y: other.y - p.y }, normal: wall.normal, source: wall.lowSourceAreaId, high: wall.highMm[i], low: wall.lowMm[i] }); nodes.set(key, rows)
    }
  }
  for (const rows of nodes.values()) {
    if (rows.length !== 2) continue
    // Stable geometric ordering makes cold JSON/face ordering irrelevant.
    const [a, b] = rows.sort((a, b) => a.lower.x - b.lower.x || a.lower.y - b.lower.y)
    // Match the physical planner's continuity tolerance, allowing only the
    // residue from independently evaluating a proven common affine surface.
    if (Math.abs(a.high - b.high) > 1e-7 || Math.abs(a.low - b.low) > 1e-7) continue
    if (Math.abs(cross(a.p, a.lower, b.lower)) < 1e-7) continue
    // Both walls must face the same local low-side sector. Opposing normals
    // or a re-entrant corner have overlap/another ownership and need no wedge.
    if (Math.hypot(a.normal.x + b.normal.x, a.normal.y + b.normal.y) < 1e-7) continue
    if (a.tangent.x * (b.lower.x - a.p.x) + a.tangent.y * (b.lower.y - a.p.y) > 1e-7
      || b.tangent.x * (a.lower.x - b.p.x) + b.tangent.y * (a.lower.y - b.p.y) > 1e-7) continue
    result.push({ lowSourceAreaId: a.source, pointsMm: [a.p, a.lower, b.lower], topMm: a.p, footMm: midpoint(a.lower, b.lower) })
  }
  return result
}
