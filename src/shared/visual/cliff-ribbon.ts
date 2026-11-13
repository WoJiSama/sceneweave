import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import type { ProjectedVisualBoundary } from '../projection/types.js'
import type { VisualEdgeLook } from './types.js'

export const CLIFF_RIBBON_PROFILE = 'rockRelief5' as const
export const CLIFF_RIBBON_LIMITS = Object.freeze({ points: 4096, outputPoints: 65536, cells: 4096 })
export interface CliffRibbonCell {
  polygon: PointMm[]
  crest: [PointMm, PointMm]
  foot: [PointMm, PointMm]
  normal: PointMm
  widthMm: number
}
export interface CliffRibbon {
  rings: PointMm[][]
  cells: CliffRibbonCell[]
  fractures: PointMm[][]
  ledges: PointMm[][]
}
export interface CliffRibbonRun { boundary: ProjectedVisualBoundary; look: VisualEdgeLook; sourceLookIds?: string[] }
const EPS = 1e-7
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const copy = (p: PointMm): PointMm => ({ x: p.x, y: p.y })
const add = (p: PointMm, n: PointMm, width: number): PointMm => ({ x: p.x + n.x * width, y: p.y + n.y * width })
const mix = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const area = (p: readonly PointMm[]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a.x * b.y - b.x * a.y }, 0) / 2
const ring = (p: readonly PointMm[]): Ring => [...p.map(p => [p.x, p.y] as [number, number]), [p[0].x, p[0].y]]
function random(seed: string, x: number, y: number, channel: number): number {
  let h = 2166136261 ^ Math.imul(Math.round(x), 73856093) ^ Math.imul(Math.round(y), 19349663) ^ Math.imul(channel, 83492791)
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function sampled(points: PointMm[], closed: boolean, id: string, terrainAreaIds: string[]): ProjectedVisualBoundary {
  let distance = 0
  const samples = points.map((positionMm, i) => {
    if (i) distance += Math.hypot(positionMm.x - points[i - 1].x, positionMm.y - points[i - 1].y)
    const before = points[i ? i - 1 : closed ? points.length - 1 : 0], after = points[i + 1 < points.length ? i + 1 : closed ? 0 : i]
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1
    const tangent = { x: dx / length, y: dy / length }
    return { positionMm: copy(positionMm), tangent, normal: { x: -tangent.y, y: tangent.x }, distanceMm: distance }
  })
  if (closed) {
    distance += Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y)
    samples.push({ ...samples[0], distanceMm: distance })
  }
  return { id, points, samples, lengthMm: distance, closed, terrainAreaIds: [...terrainAreaIds] }
}

/** Join only exact, unambiguous directed endpoints with equal saved paint and
 * support. All inputs are already audience-filtered. No scene/name/ID pattern
 * is a rule; private or differently styled geometry cannot extend a run. */
export function joinCliffRibbonRuns(input: readonly CliffRibbonRun[]): CliffRibbonRun[] {
  if (input.length > 128) throw new Error('连续崖面超过128条边带预算。')
  const signature = ({ boundary, look }: CliffRibbonRun) => JSON.stringify([
    look.floorId, look.layerId, look.visibility, look.side, look.widthMm, look.color, look.accentColor,
    look.opacity, look.intensity, look.repeatMm, look.seed, look.renderProfile, [...boundary.terrainAreaIds].sort(),
  ])
  const keys = input.map(signature), used = new Set<number>(), result: CliffRibbonRun[] = []
  for (let start = 0; start < input.length; start++) {
    if (used.has(start)) continue
    const source = input[start]
    if (source.boundary.closed) { used.add(start); result.push(source); continue }
    const chain = [start]; used.add(start)
    // A branch or duplicate directed edge is not an instruction to choose one.
    for (const forward of [true, false]) for (;;) {
      const current = input[chain[forward ? chain.length - 1 : 0]].boundary
      const end = forward ? current.points.at(-1)! : current.points[0]
      const outgoing = input.flatMap((run, i) => keys[i] === keys[start] && !run.boundary.closed
        && same(forward ? run.boundary.points[0] : run.boundary.points.at(-1)!, end) ? [i] : [])
      const incoming = input.filter((run, i) => keys[i] === keys[start] && !run.boundary.closed
        && same(forward ? run.boundary.points.at(-1)! : run.boundary.points[0], end))
      if (outgoing.length !== 1 || incoming.length !== 1 || used.has(outgoing[0])) break
      const next = outgoing[0]; used.add(next); if (forward) chain.push(next); else chain.unshift(next)
    }
    if (chain.length === 1) { result.push(source); continue }
    const points = chain.flatMap((i, offset) => input[i].boundary.points.slice(offset ? 1 : 0)).map(copy)
    const closed = same(points[0], points.at(-1)!); if (closed) points.pop()
    if (points.length > CLIFF_RIBBON_LIMITS.points) throw new Error('连续崖面合并超过4096个投影点。')
    result.push({ look: source.look, boundary: sampled(points, closed, source.boundary.id, source.boundary.terrainAreaIds), sourceLookIds: chain.map(i => input[i].look.id) })
  }
  return result
}

/** One-sided segment ribbons with shared vertex feet are unioned as real polygons.
 * There is no self-crossing offset ring, miter spike or artificial end cap.
 * South-facing faces read deeper; this changes paint only, never terrain. */
export function cliffRibbon(boundary: Pick<ProjectedVisualBoundary, 'points' | 'closed'>,
  look: Pick<VisualEdgeLook, 'widthMm' | 'repeatMm' | 'seed'>, side: 1 | -1): CliffRibbon {
  const empty = (): CliffRibbon => ({ rings: [], cells: [], fractures: [], ledges: [] })
  if (!Number.isFinite(look.widthMm) || look.widthMm < 0 || look.widthMm > 5000 || !Number.isFinite(look.repeatMm)
    || look.repeatMm < 20 || !look.seed || (side !== 1 && side !== -1)) throw new Error('连续崖面需要有限宽度、间距和方向。')
  const points = boundary.points.map(copy)
  if (points.length > CLIFF_RIBBON_LIMITS.points || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9)) throw new Error('连续崖面投影坐标无效或超出预算。')
  if (!look.widthMm || points.length < 2) return empty()
  const count = points.length - (boundary.closed ? 0 : 1)
  const normals = Array.from({ length: count }, (_, i) => {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (length < EPS) throw new Error('连续崖面不能含零长边。')
    return { x: -dy / length * side, y: dx / length * side }
  })
  const distances = [0]
  for (let i = 0; i < count; i++) distances.push(distances[i] + Math.hypot(points[(i + 1) % points.length].x - points[i].x, points[(i + 1) % points.length].y - points[i].y))
  const total = distances.at(-1)!
  const atDistance = (distance: number) => {
    const d = boundary.closed ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance))
    let low = 0, high = count
    while (high - low > 1) { const mid = (low + high) >>> 1; if (distances[mid] <= d) low = mid; else high = mid }
    return mix(points[low], points[(low + 1) % points.length], (d - distances[low]) / (distances[low + 1] - distances[low]))
  }
  const radius = Math.max(250, look.widthMm * .65)
  const vertexNormals = points.map((p, i) => {
    const a = atDistance(distances[i] - radius), b = atDistance(distances[i] + radius), dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    return length > EPS ? { x: -dy / length * side, y: dx / length * side } : normals[Math.min(i, normals.length - 1)]
  })
  const phase = random(look.seed, 0, 0, 1) * Math.PI * 2
  const widths = points.map((p, i) => {
    const ny = vertexNormals[i].y
    const facing = .12 + .88 * (.5 + .5 * ny)
    const variation = .79 + .08 * Math.sin(p.x / 1700 + p.y / 2300 + phase)
      + .06 * Math.cos(p.x / 3100 - p.y / 1900 + phase) + .045 * Math.sin(p.x / 260 + p.y / 370 + phase)
    return look.widthMm * facing * variation
  })
  // A single shared foot at every vertex removes the fan's dark wedges and
  // prevents sampling-density changes from creating a row of radial spokes.
  const feet = points.map((p, i) => add(p, vertexNormals[i], widths[i]))
  const cells: CliffRibbonCell[] = [], polygons: Polygon[] = [], fractures: PointMm[][] = [], ledges: PointMm[][] = []
  const addPolygon = (p: PointMm[]) => { if (Math.abs(area(p)) > EPS) polygons.push([ring(p)]) }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % points.length, a = points[i], b = points[j], fa = feet[i], fb = feet[j]
    const nx = vertexNormals[i].x + vertexNormals[j].x, ny = vertexNormals[i].y + vertexNormals[j].y, nl = Math.hypot(nx, ny)
    const normal = nl > EPS ? { x: nx / nl, y: ny / nl } : normals[i]
    const polygon = [copy(a), copy(b), fb, fa]
    addPolygon(polygon); cells.push({ polygon, crest: [copy(a), copy(b)], foot: [fa, fb], normal: { ...normal }, widthMm: (widths[i] + widths[j]) / 2 })
  }
  const onFace = (distance: number, fraction: number): PointMm => {
    const d = boundary.closed ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance))
    let low = 0, high = count
    while (high - low > 1) { const mid = (low + high) >>> 1; if (distances[mid] <= d) low = mid; else high = mid }
    const t = (d - distances[low]) / (distances[low + 1] - distances[low]), next = (low + 1) % points.length
    return mix(mix(points[low], points[next], t), mix(feet[low], feet[next], t), fraction)
  }
  // Arc stations, rather than tessellation vertices, set the scale of rock
  // blocks. Every stratum follows several cells and survives split sources.
  const spacing = Math.max(500, look.repeatMm * 1.8), stations = Math.ceil(total / spacing)
  if (stations > 8192) throw new Error('连续崖面装饰超过有限预算。')
  for (let i = 0; i < stations; i++) {
    const d = i * spacing, p = atDistance(d), noise = random(look.seed, p.x, p.y, 20)
    const start = d + spacing * (.16 + noise * .3)
    fractures.push([onFace(start, .06), onFace(start + spacing * .10, .35),
      onFace(start + spacing * (.02 + noise * .17), .58), onFace(start + spacing * .16, .87)])
    for (let layer = 0; layer < 3; layer++) {
      if (random(look.seed, p.x, p.y, 30 + layer) < .32) continue
      const f = .25 + layer * .24 + (noise - .5) * .06
      ledges.push(Array.from({ length: 7 }, (_, k) => onFace(d + spacing * (.08 + k * .14), f + .017 * Math.sin(k * 1.2 + noise * 6))))
    }
  }
  if (!polygons.length) return empty()
  const union: MultiPolygon = polygonClipping.union(polygons[0], ...polygons.slice(1))
  const rings = union.flatMap(polygon => polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
  const outputPoints = rings.reduce((sum, p) => sum + p.length, 0) + cells.length * 8
    + fractures.reduce((sum, p) => sum + p.length, 0) + ledges.reduce((sum, p) => sum + p.length, 0)
  if (outputPoints > CLIFF_RIBBON_LIMITS.outputPoints) throw new Error('连续崖面输出超过有限点预算。')
  return { rings, cells, fractures, ledges }
}

/** Share endpoint geometry, but return only each original record's own cells.
 * Painting remains in the exact projection order (including intervening shore
 * and materialized paints), with each original support/opening clip intact. */
export function cliffRibbonPaints(input: readonly CliffRibbonRun[], side: 1 | -1): Map<string, CliffRibbon> {
  const byId = new Map(input.map(run => [run.look.id, run])), output = new Map<string, CliffRibbon>()
  const segmentKey = (a: PointMm, b: PointMm) => `${a.x},${a.y}:${b.x},${b.y}`
  for (const joined of joinCliffRibbonRuns(input)) {
    const relief = cliffRibbon(joined.boundary, joined.look, side)
    const ids = joined.sourceLookIds ?? [joined.look.id]
    if (ids.length === 1) { output.set(ids[0], relief); continue }
    for (const id of ids) {
      const boundary = byId.get(id)!.boundary, segments = new Set(boundary.points.slice(0, -1)
        .map((a, i) => segmentKey(a, boundary.points[i + 1])))
      const cells = relief.cells.filter(cell => segments.has(segmentKey(...cell.crest)))
      const polygons = cells.map(cell => [ring(cell.polygon)] as Polygon)
      const union = polygons.length ? polygonClipping.union(polygons[0], ...polygons.slice(1)) : []
      output.set(id, { ...relief, cells, rings: union.flatMap(p => p.map(r => r.slice(0, -1).map(([x, y]) => ({ x, y })))) })
    }
  }
  return output
}
