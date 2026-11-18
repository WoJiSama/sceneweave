import type { PointMm } from '../model/scene.js'
import { staircaseSchema, type StaircaseConfig, type StaircaseCover } from './contracts.js'

const EPS = 1e-7
export const STAIRCASE_LIMITS = Object.freeze({ routePoints: 256, treads: 512, coverVertices: 4096 })
export interface StaircaseSection { distanceMm: number; leftMm: PointMm; rightMm: PointMm }
export interface StaircaseTread {
  index: number
  startMm: number
  endMm: number
  polygonMm: PointMm[]
  /** Low edge when the route ascends from its first to last point. */
  frontMm: [PointMm, PointMm]
  rearMm: [PointMm, PointMm]
}
export interface StaircaseGeometry {
  lengthMm: number
  widthMm: number
  footprintMm: PointMm[]
  sections: StaircaseSection[]
  treads: StaircaseTread[]
  covers: { id: string; kind: StaircaseCover['kind']; polygonMm: PointMm[] }[]
}

const mix = (a: PointMm, b: PointMm, t: number): PointMm => t === 0 ? { ...a } : t === 1 ? { ...b } : ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const cross = (a: PointMm, b: PointMm, c: PointMm) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const same = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS
const area = (p: readonly PointMm[]) => p.reduce((sum, a, i) => sum + cross(p[0], a, p[(i + 1) % p.length]), 0) / 2
function onSegment(p: PointMm, a: PointMm, b: PointMm): boolean {
  return Math.abs(cross(a, b, p)) <= EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
}
function intersects(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  const x = cross(a, b, c), y = cross(a, b, d), u = cross(c, d, a), v = cross(c, d, b)
  return ((x < 0 && y > 0 || x > 0 && y < 0) && (u < 0 && v > 0 || u > 0 && v < 0)) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
}
function assertSimple(p: readonly PointMm[], label: string): void {
  if (p.length < 3 || !Number.isFinite(area(p)) || Math.abs(area(p)) <= EPS) throw new Error(`${label}不能退化。`)
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length]
    if (same(a, b) || Math.abs(cross(a, b, c)) <= EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < -EPS) throw new Error(`${label}含重复或折返边。`)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue
      if (intersects(a, b, p[j], p[(j + 1) % p.length])) throw new Error(`${label}不能自相交或互相折叠。`)
    }
  }
}
function positive(p: PointMm[]): PointMm[] { return area(p) < 0 ? p.reverse() : p }

function sectionsFor(points: readonly PointMm[], widthMm: number): StaircaseSection[] {
  if (points.length < 2 || points.length > STAIRCASE_LIMITS.routePoints || points.some(p => !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y))) throw new Error('阶梯路线须含2–256个整数毫米点。')
  if (!Number.isSafeInteger(widthMm) || widthMm <= 0) throw new Error('阶梯宽度须为正整数毫米。')
  // Saved cubic/polyline samples may contain tiny redundant collinear spans.
  // Removing them does not change arc length or the route, and prevents those
  // spans from falsely folding around the next real miter.
  const reduced: PointMm[] = []
  for (const p of points) {
    if (reduced.length && same(p, reduced.at(-1)!)) throw new Error('阶梯路线不能含零长段。')
    while (reduced.length >= 2) {
      const a = reduced.at(-2)!, b = reduced.at(-1)!
      if (cross(a, b, p) !== 0 || (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) <= 0) break
      reduced.pop()
    }
    reduced.push(p)
  }
  points = reduced
  const directions = points.slice(1).map((p, i) => {
    const length = Math.hypot(p.x - points[i].x, p.y - points[i].y)
    if (length <= EPS) throw new Error('阶梯路线不能含零长段。')
    return { x: (p.x - points[i].x) / length, y: (p.y - points[i].y) / length, length }
  })
  let distanceMm = 0
  return points.map((p, i) => {
    if (i > 0) distanceMm += directions[i - 1].length
    const before = directions[Math.max(0, i - 1)], after = directions[Math.min(i, directions.length - 1)]
    const nx = -before.y - after.y, ny = before.x + after.x, divisor = 1 + before.x * after.x + before.y * after.y
    if (divisor < 0.5 - EPS) throw new Error('阶梯转弯过急，请增加弯曲半径。')
    const offset = { x: nx / divisor * widthMm / 2, y: ny / divisor * widthMm / 2 }
    return { distanceMm, leftMm: { x: p.x + offset.x, y: p.y + offset.y }, rightMm: { x: p.x - offset.x, y: p.y - offset.y } }
  })
}

/** Fraction across width: +0.5 is the route's left edge, −0.5 its right edge. */
export function staircasePointAt(geometry: Pick<StaircaseGeometry, 'sections' | 'lengthMm'>, distanceMm: number, lateralFraction = 0): PointMm {
  const sections = geometry.sections, distance = Math.max(0, Math.min(geometry.lengthMm, distanceMm))
  let i = 1
  while (i < sections.length - 1 && sections[i].distanceMm < distance) i++
  const a = sections[i - 1], b = sections[i], t = (distance - a.distanceMm) / (b.distanceMm - a.distanceMm)
  return mix(mix(a.rightMm, b.rightMm, t), mix(a.leftMm, b.leftMm, t), lateralFraction + 0.5)
}

/** Shared section boundaries partition the entire stair; bends never leave triangular gaps. */
export function staircasePatch(geometry: Pick<StaircaseGeometry, 'sections' | 'lengthMm'>, startMm: number, endMm: number, minLateral = -0.5, maxLateral = 0.5): PointMm[] {
  const stations = [startMm, ...geometry.sections.filter(s => s.distanceMm > startMm + EPS && s.distanceMm < endMm - EPS).map(s => s.distanceMm), endMm]
  return positive([...stations.map(d => staircasePointAt(geometry, d, minLateral)), ...stations.toReversed().map(d => staircasePointAt(geometry, d, maxLateral))])
}

export function staircaseLocalPoint(centerlineMm: readonly PointMm[], widthMm: number, pointPpm: PointMm): PointMm {
  const sections = sectionsFor(centerlineMm, widthMm), lengthMm = sections.at(-1)!.distanceMm
  return staircasePointAt({ sections, lengthMm }, pointPpm.x / 1_000_000 * lengthMm, pointPpm.y / 1_000_000)
}

export function planStaircase(centerlineMm: readonly PointMm[], widthMm: number, rawConfig: StaircaseConfig): StaircaseGeometry {
  const config = staircaseSchema.parse(rawConfig), sections = sectionsFor(centerlineMm, widthMm), lengthMm = sections.at(-1)!.distanceMm
  const count = config.layout.kind === 'repeat' ? Math.ceil(lengthMm / config.layout.treadDepthMm - 1e-10) : config.layout.stepCount
  if (count < 1 || count > STAIRCASE_LIMITS.treads) throw new Error('阶梯须在1–512级预算内；请增加踏深或缩短路线。')
  const footprintMm = positive([...sections.map(s => s.rightMm), ...sections.toReversed().map(s => s.leftMm)])
  assertSimple(footprintMm, '阶梯轮廓')
  // Each offset rail must progress along its segment. Otherwise a tight bend
  // can fold an inner tread even while the outside contour remains simple.
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i], dx = (b.leftMm.x + b.rightMm.x - a.leftMm.x - a.rightMm.x) / 2, dy = (b.leftMm.y + b.rightMm.y - a.leftMm.y - a.rightMm.y) / 2
    for (const side of ['leftMm', 'rightMm'] as const) if ((b[side].x - a[side].x) * dx + (b[side].y - a[side].y) * dy <= EPS) throw new Error('阶梯内侧转弯半径不足，请增大弯曲半径或减小宽度。')
  }
  const geometry: StaircaseGeometry = { lengthMm, widthMm, footprintMm, sections, treads: [], covers: [] }
  const depth = config.layout.kind === 'repeat' ? config.layout.treadDepthMm : lengthMm / count
  for (let index = 0; index < count; index++) {
    const startMm = index * depth, endMm = Math.min(lengthMm, (index + 1) * depth)
    const polygonMm = staircasePatch(geometry, startMm, endMm)
    geometry.treads.push({ index, startMm, endMm, polygonMm, frontMm: [staircasePointAt(geometry, startMm, -0.5), staircasePointAt(geometry, startMm, 0.5)], rearMm: [staircasePointAt(geometry, endMm, -0.5), staircasePointAt(geometry, endMm, 0.5)] })
  }
  let coverVertices = 0
  for (const cover of config.covers) {
    assertSimple(cover.pointsPpm, '阶梯覆盖区')
    const polygonMm: PointMm[] = []
    for (let i = 0; i < cover.pointsPpm.length; i++) {
      const a = cover.pointsPpm[i], b = cover.pointsPpm[(i + 1) % cover.pointsPpm.length]
      const cuts = [0, ...sections.slice(1, -1).flatMap(s => {
        const t = (s.distanceMm / lengthMm * 1_000_000 - a.x) / (b.x - a.x)
        return t > EPS && t < 1 - EPS ? [t] : []
      }).sort((x, y) => x - y), 1]
      for (let j = 0; j < cuts.length - 1; j++) {
        // The map varies bilinearly when an edge changes lateral position.
        // Midpoint subdivision keeps these reversible masks smooth at bends.
        for (const t of a.y === b.y ? [cuts[j]] : [cuts[j], (cuts[j] + cuts[j + 1]) / 2]) {
          const local = mix(a, b, t)
          polygonMm.push(staircasePointAt(geometry, local.x / 1_000_000 * lengthMm, local.y / 1_000_000))
          if (++coverVertices > STAIRCASE_LIMITS.coverVertices) throw new Error('阶梯覆盖区超出4096顶点预算。')
        }
      }
    }
    assertSimple(polygonMm, '阶梯覆盖区')
    geometry.covers.push({ id: cover.id, kind: cover.kind, polygonMm: positive(polygonMm) })
  }
  return geometry
}
