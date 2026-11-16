import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm, TerrainPoint } from '../model/scene.js'
import type { RockShell, RockShellPoint, RockShellSection } from './contracts.js'

export const EPS = 1e-6
export const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
export const length = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
export const polygon = (points: readonly PointMm[]): MultiPolygon => [[points.map(p => [p.x, p.y])]]
export const area = (regions: MultiPolygon) => regions.reduce((sum, p) => sum + p.reduce((part, ring, i) => {
  let value = 0
  const [ox, oy] = ring[0]
  for (let n = 0; n < ring.length; n++) value += (ring[n][0] - ox) * (ring[(n + 1) % ring.length][1] - oy) - (ring[(n + 1) % ring.length][0] - ox) * (ring[n][1] - oy)
  return part + (i ? -1 : 1) * Math.abs(value / 2)
}, 0), 0)
export const union = (parts: MultiPolygon[]): MultiPolygon => parts.length ? polygonClipping.union(parts[0], ...parts.slice(1)) : []
export const signedArea = (p: readonly PointMm[]) => p.reduce((n, a, i) => n + (a.x - p[0].x) * (p[(i + 1) % p.length].y - p[0].y) - (p[(i + 1) % p.length].x - p[0].x) * (a.y - p[0].y), 0) / 2
export const xyzKey = (p: RockShellPoint) => `${p.x},${p.y},${p.z}`
export const faceNormal = ([a, b, c]: readonly RockShellPoint[]) => {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const x = u.y * v.z - u.z * v.y, y = u.z * v.x - u.x * v.z, z = u.x * v.y - u.y * v.x
  const magnitude = Math.hypot(x, y, z)
  return { x: x / (magnitude || 1) || 0, y: y / (magnitude || 1) || 0, z: z / (magnitude || 1) || 0, magnitude }
}
export const segmentNormal = (boundary: readonly TerrainPoint[], index: number) => {
  const a = boundary[index].positionMm, b = boundary[(index + 1) % boundary.length].positionMm, size = length(a, b)
  const direction = signedArea(boundary.map(v => v.positionMm)) > 0 ? 1 : -1
  return { x: (b.y - a.y) / size * direction || 0, y: -(b.x - a.x) / size * direction || 0 }
}
export const interpolate = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { const r = a % b; a = b; b = r } return a }
export const isOrthogonalBoundary = (boundary: readonly TerrainPoint[]) => boundary.every((v, i) => {
  const b = boundary[(i + 1) % boundary.length].positionMm; return v.positionMm.x === b.x || v.positionMm.y === b.y
})

/** Exact integer points on a source line, rather than rounded points beside it.
 * A primitive lattice segment has no legal interior top station. */
export function sourceLattice(boundary: readonly TerrainPoint[], edge: number) {
  const a = boundary[edge].positionMm, b = boundary[(edge + 1) % boundary.length].positionMm
  const dx = b.x - a.x, dy = b.y - a.y, steps = gcd(dx, dy), size = length(a, b)
  return { steps, size, at: (k: number) => ({ x: a.x + dx / steps * k, y: a.y + dy / steps * k }),
    offset: (k: number) => Math.round(size * k / steps) }
}

/** Intersect adjacent equal-offset support lines. This is normal addition only
 * at a right angle. Very acute corners require a different explicit topology. */
export function cornerMiter(boundary: readonly TerrainPoint[], edge: number): PointMm {
  const a = segmentNormal(boundary, (edge + boundary.length - 1) % boundary.length), b = segmentNormal(boundary, edge)
  const denominator = 1 + a.x * b.x + a.y * b.y
  if (denominator <= EPS) throw Error('侧壳转角折返或miter超过2的有限范围。')
  const result = { x: (a.x + b.x) / denominator, y: (a.y + b.y) / denominator }
  if (Math.hypot(result.x, result.y) > 2 + EPS) throw Error('侧壳转角miter超过2；须显式改真实顶缘，不能隐式倒角。')
  return result
}

/** Extend only the formerly rejected miter domain. A vertical joint keeps the
 * true source corner and every actual section level at that exact same XY.
 * Its bisector partitions neighbouring bands; it never displaces geometry. */
export function cornerJoin(boundary: readonly TerrainPoint[], edge: number): { kind: 'miter' | 'vertical'; radial: PointMm } {
  const a = segmentNormal(boundary, (edge + boundary.length - 1) % boundary.length), b = segmentNormal(boundary, edge)
  const denominator = 1 + a.x * b.x + a.y * b.y
  if (denominator > EPS) {
    const radial = { x: (a.x + b.x) / denominator, y: (a.y + b.y) / denominator }
    if (Math.hypot(radial.x, radial.y) <= 2 + EPS) return { kind: 'miter', radial }
  }
  const x = a.x + b.x, y = a.y + b.y, magnitude = Math.hypot(x, y)
  if (!Number.isFinite(magnitude) || magnitude === 0) throw Error('侧壳顶缘不能折返，无法建立共同竖直转角。')
  return { kind: 'vertical', radial: { x: x / magnitude || 0, y: y / magnitude || 0 } }
}

/** One integer direction owns every level of an actual radial section. */
export function integerRay(radial: PointMm): PointMm {
  const scale = 32 / Math.max(Math.abs(radial.x), Math.abs(radial.y))
  const x = Math.round(radial.x * scale), y = Math.round(radial.y * scale), divisor = gcd(x, y)
  if (!divisor) throw Error('侧壳不能量化零径向。')
  return { x: x / divisor || 0, y: y / divisor || 0 }
}

/** Ray/half-plane intersection against a real common concave-corner ray. */
export function radialSectorLimit(point: PointMm, ray: PointMm, corner: PointMm, cornerRay: PointMm): number {
  const origin = { x: 0, y: 0 }, delta = { x: point.x - corner.x, y: point.y - corner.y }
  const side = cross(origin, cornerRay, delta), rate = cross(origin, cornerRay, ray)
  if (Math.abs(side) <= EPS) return 0
  if (side * rate >= 0 || Math.abs(rate) <= EPS) return Infinity
  // Stay a millimetre inside the common half-plane, including quantisation.
  return Math.max(0, -side / rate - 1 / Math.hypot(ray.x, ray.y))
}
export const sectionVertices = (s: RockShellSection) => [s.topVertexId, s.shoulderVertexId, s.kneeVertexId, s.footVertexId]
export const zones = ['shoulder', 'wall', 'foot'] as const
export const field = (p: PointMm, seed: string, salt: number, scale: number) => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  const phase = ((h >>> 0) / 0xffffffff + salt * .381966) * Math.PI * 2
  return Math.max(0, Math.min(1, .5 + .28 * Math.sin((p.x * .83 + p.y * .47) / scale + phase)
    + .22 * Math.cos((p.x * -.39 + p.y * .91) / (scale * .81) + phase * 1.37)))
}
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export function expectedFaces(shell: RockShell) {
  const expected: { vertexIds: [string, string, string]; sourceSegmentId: string; sectionIds: [string, string]; zone: typeof zones[number] }[] = []
  for (let i = 0; i < shell.sections.length; i++) {
    const a = shell.sections[i], b = shell.sections[(i + 1) % shell.sections.length], av = sectionVertices(a), bv = sectionVertices(b)
    const edge = shell.sourceBoundaryMm.findIndex(v => v.segmentId === a.sourceSegmentId), outward = segmentNormal(shell.sourceBoundaryMm, edge)
    for (let z = 0; z < 3; z++) for (const row of [[av[z], bv[z], bv[z + 1]], [av[z], bv[z + 1], av[z + 1]]]) {
      if (new Set(row).size !== 3) continue
      const points = row.map(v => shell.verticesMm[v]), normal = faceNormal(points)
      if (normal.magnitude <= EPS) continue
      if (normal.z < -EPS || (Math.abs(normal.z) <= EPS && normal.x * outward.x + normal.y * outward.y < 0)) [row[1], row[2]] = [row[2], row[1]]
      expected.push({ vertexIds: row as [string, string, string], sourceSegmentId: a.sourceSegmentId, sectionIds: [a.id, b.id], zone: zones[z] })
    }
  }
  return expected
}

export function validateBoundary(boundary: readonly TerrainPoint[]) {
  const points = boundary.map(v => v.positionMm)
  if (new Set(boundary.map(v => v.id)).size !== boundary.length || new Set(boundary.map(v => v.segmentId)).size !== boundary.length) throw Error('侧壳源顶缘稳定点/边ID须唯一。')
  if (Math.abs(signedArea(points)) <= EPS) throw Error('侧壳顶缘不能退化。')
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (length(a, b) <= EPS) throw Error('侧壳顶缘不能含退化边。')
    const c = points[(i + 2) % points.length]
    if (cross(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) throw Error('侧壳顶缘不能折返。')
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      const c0 = points[j], d = points[(j + 1) % points.length]
      const overlap = Math.max(Math.min(a.x, b.x), Math.min(c0.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c0.x, d.x))
        && Math.max(Math.min(a.y, b.y), Math.min(c0.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c0.y, d.y))
      if (overlap && cross(a, b, c0) * cross(a, b, d) <= 0 && cross(c0, d, a) * cross(c0, d, b) <= 0) throw Error('侧壳顶缘自交或自接触。')
    }
  }
}
