import type { MultiPolygon } from 'polygon-clipping'
import type { BoundsMm, PointMm } from '../model/scene.js'

type Pair = [number, number]
type Segment = [Pair, Pair]
export interface TerrainPartitionSurface {
  id: string; priority: number; elevationMm: number
  points?: readonly (PointMm | Pair)[]; regions?: MultiPolygon
  color?: string; kind?: 'terrain' | 'tread'
}
export interface TerrainPartitionStair {
  id: string; centerlineMm: readonly PointMm[]; footprintMm: readonly (PointMm | Pair)[]
  widthMm: number; treadDepthMm: number; fromElevationMm: number; toElevationMm: number
}
export interface TerrainPartitionInput {
  bounds: BoundsMm; surfaces: readonly TerrainPartitionSurface[]; connections?: readonly TerrainPartitionStair[]
}
export interface TerrainPartitionTop {
  id: string; sourceId: string; z: number; regions: MultiPolygon; color?: string; kind: 'terrain' | 'tread'
}
export interface TerrainPartitionWall {
  a: Pair; b: Pair; normal: Pair; highId: string; lowId: string; low: number; high: number
}
interface RouteFrame { p: Pair; tangent: Pair }
interface PreparedStair {
  connection: TerrainPartitionStair; footprint: MultiPolygon; cuts: RouteFrame[]; cutSegments: Segment[]
  indexAt: (point: Pair) => number; from: number; to: number; count: number; length: number
}
interface SourceLine { start: number; end: number; cuts: Set<number> }
interface HalfEdge { a: number; b: number; twin: number; cycle: number; next: number }
interface Owner { id: string; sourceId: string; z: number; color?: string; kind: 'terrain' | 'tread'; ambiguous: boolean }
interface FaceCycle { ids: number[]; ring: Pair[]; area: number; sample: Pair; owner: Owner | null; holes: Pair[][]; parent: FaceCycle | null }

/** A single shared planar arrangement for audience/Floor-filtered geometry.
 * Paint derivation only: caller owns complete domain/resource validation; this
 * module never edits source coordinates, identities, supports or passage.
 * Its output does not select a product observation or rendering style. */
const EPS = 1e-7
const cross = (a: Pair, b: Pair) => a[0] * b[1] - a[1] * b[0]
const sub = (a: Pair, b: Pair): Pair => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Pair, b: Pair) => a[0] * b[0] + a[1] * b[1]
const distance = (a: Pair, b: Pair) => Math.hypot(...sub(a, b))
const signedArea = (ring: Pair[]) => {
  const origin = ring[0]
  return ring.reduce((sum, a, i) => sum + cross(sub(a, origin), sub(ring[(i + 1) % ring.length], origin)), 0) / 2
}
const inRing = (ring: Pair[], p: Pair) => {
  let inside = false
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const contains = (regions: MultiPolygon, p: Pair) => regions.some(poly => poly.reduce((inside, ring) => inRing(ring, p) ? !inside : inside, false))
const pair = (p: PointMm | Pair): Pair => Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]
const shape = (s: TerrainPartitionSurface): MultiPolygon => s.regions ?? (s.points ? [[s.points.map(pair)]] : (() => { throw new Error('Terrain surface has no boundary') })())
const segments = (regions: MultiPolygon): Segment[] => regions.flatMap(poly => poly.flatMap(ring => ring.map((a, i): Segment => [a, ring[(i + 1) % ring.length]]).filter(([a, b]) => distance(a, b) > EPS)))
const polygonArea = (poly: Pair[][]) => Math.abs(signedArea(poly[0])) - poly.slice(1).reduce((sum, r) => sum + Math.abs(signedArea(r)), 0)
export const terrainPartitionArea = (regions: MultiPolygon) => regions.reduce((sum, p) => sum + polygonArea(p), 0)

function prepareStair(connection: TerrainPartitionStair): PreparedStair {
  if (![connection.widthMm, connection.treadDepthMm, connection.fromElevationMm, connection.toElevationMm].every(Number.isFinite)
    || connection.widthMm <= 0 || connection.treadDepthMm <= 0) throw Error('Invalid stair dimensions')
  let points = connection.centerlineMm.map(pair), from = connection.fromElevationMm, to = connection.toElevationMm
  if (to < from) { points.reverse(); [from, to] = [to, from] }
  if (!(to > from) || points.length < 2) throw Error('Stairs require distinct endpoint heights and a route')
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]); if (length <= EPS) throw Error('Repeated route point')
    distances.push(distances.at(-1)! + length)
  }
  const length = distances.at(-1)!, count = Math.ceil(length / connection.treadDepthMm)
  if (count < 1 || count > 128) throw Error('Tread work budget exceeded')
  const at = (station: number): RouteFrame => {
    let i = 1; while (i < distances.length - 1 && distances[i] < station) i++
    const a = points[i - 1], b = points[i], l = distances[i] - distances[i - 1], t = (station - distances[i - 1]) / l
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], tangent: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] }
  }
  const footprint: MultiPolygon = [[connection.footprintMm.map(pair)]], border = segments(footprint), cuts: RouteFrame[] = [], cutSegments: Segment[] = []
  for (let i = 1; i < count; i++) {
    const frame = at(length * i / count), normal: Pair = [-frame.tangent[1], frame.tangent[0]], intersections: Pair[] = []
    for (const [a, b] of border) {
      const da = dot(sub(a, frame.p), frame.tangent), db = dot(sub(b, frame.p), frame.tangent)
      if (Math.abs(da) <= EPS) intersections.push(a)
      if (da * db < 0) {
        const t = da / (da - db); intersections.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
    intersections.sort((a, b) => dot(sub(a, frame.p), normal) - dot(sub(b, frame.p), normal))
    const unique = intersections.filter((p, i) => !i || distance(p, intersections[i - 1]) > EPS)
    for (let j = 1; j < unique.length; j++) {
      const a = unique[j - 1], b = unique[j], mid: Pair = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (contains(footprint, mid)) cutSegments.push([a, b])
    }
    cuts.push(frame)
  }
  const indexAt = (p: Pair) => { const i = cuts.findIndex(c => dot(sub(p, c.p), c.tangent) < 0); return i < 0 ? count - 1 : i }
  for (let i = 0; i < count; i++) if (indexAt(at(length * (i + .5) / count).p) !== i) throw Error('Unsupported stair turn: cross-sections do not follow route stationing')
  return { connection, footprint, cuts, cutSegments, indexAt, from, to, count, length }
}

export function composeTerrainMassPartition(input: TerrainPartitionInput) {
  if (input.surfaces.length > 256 || (input.connections?.length ?? 0) > 16) throw Error('Shared arrangement source budget exceeded')
  if (![input.bounds.x, input.bounds.y, input.bounds.width, input.bounds.height].every(Number.isFinite)
    || input.bounds.width <= 0 || input.bounds.height <= 0) throw Error('Invalid arrangement bounds')
  const identities = new Set<string>()
  for (const item of [...input.surfaces, ...(input.connections ?? [])]) {
    if (!item.id || item.id === '$floor' || identities.has(item.id)) throw Error('Duplicate or reserved arrangement identity')
    identities.add(item.id)
  }
  for (const source of input.surfaces) if (!Number.isFinite(source.elevationMm) || !Number.isFinite(source.priority)) throw Error('Invalid terrain height or coverage priority')
  let inputPoints = 0
  const checkPoint = (point: Pair) => {
    if (++inputPoints > 16384 || !point.every(Number.isFinite)) throw Error('Invalid or excessive arrangement coordinates')
  }
  for (const source of input.surfaces) for (const polygon of shape(source)) for (const ring of polygon) for (const point of ring) checkPoint(point)
  for (const stair of input.connections ?? []) for (const point of [...stair.centerlineMm, ...stair.footprintMm]) checkPoint(pair(point))
  const bounds = { ...input.bounds }, origin: Pair = [bounds.x, bounds.y], local = (p: Pair): Pair => [p[0] - origin[0], p[1] - origin[1]], world = (p: Pair): Pair => [p[0] + origin[0], p[1] + origin[1]]
  const sources = input.surfaces.map(s => ({ ...s, regions: shape(s).map(poly => poly.map(r => r.map(local))) })).sort((a, b) => b.priority - a.priority)
  const stairs = (input.connections ?? []).map(c => prepareStair({ ...c, centerlineMm: c.centerlineMm.map(p => { const a = local(pair(p)); return { x: a[0], y: a[1] } }), footprintMm: c.footprintMm.map(p => local(pair(p))) }))
  const box: Pair[][] = [[[0, 0], [bounds.width, 0], [bounds.width, bounds.height], [0, bounds.height]]]
  const raw = [...segments([box]), ...sources.flatMap(s => segments(s.regions)), ...stairs.flatMap(s => [...segments(s.footprint), ...s.cutSegments])]
  if (raw.length > 8192 || raw.length * raw.length > 32_000_000) throw Error('Shared arrangement segment budget exceeded')
  const nodes: Pair[] = [], buckets = new Map<string, number[]>(); let maxSharedNodeShiftMm = 0
  const node = (p: Pair): number => {
    const bx = Math.floor(p[0] / EPS), by = Math.floor(p[1] / EPS)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
      const delta = distance(nodes[id], p)
      if (delta <= EPS) { maxSharedNodeShiftMm = Math.max(maxSharedNodeShiftMm, delta); return id }
    }
    if (nodes.length >= 16384) throw Error('Shared arrangement node budget exceeded')
    const id = nodes.length, key = `${bx},${by}`; nodes.push(p); buckets.set(key, [...(buckets.get(key) ?? []), id]); return id
  }
  const lines: SourceLine[] = raw.map(([a, b]) => { const start = node(a), end = node(b); return { start, end, cuts: new Set([start, end]) } }).filter(line => line.start !== line.end)
  const on = (p: Pair, a: Pair, b: Pair) => {
    const d = sub(b, a), l = Math.hypot(...d), t = dot(sub(p, a), d) / (l * l)
    return t >= -EPS / l && t <= 1 + EPS / l && Math.abs(cross(d, sub(p, a))) <= EPS * l
  }
  let pairChecks = 0, intersections = 0
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    pairChecks++
    const left = lines[i], right = lines[j], a = nodes[left.start], b = nodes[left.end], c = nodes[right.start], d = nodes[right.end]
    if (Math.max(a[0], b[0]) + EPS < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + EPS < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) + EPS < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + EPS < Math.min(a[1], b[1])) continue
    const u = sub(b, a), v = sub(d, c), denominator = cross(u, v), lengths = Math.hypot(...u) * Math.hypot(...v)
    if (Math.abs(denominator) <= lengths * 1e-12) {
      for (const id of [left.start, left.end]) if (on(nodes[id], c, d)) right.cuts.add(id)
      for (const id of [right.start, right.end]) if (on(nodes[id], a, b)) left.cuts.add(id)
      continue
    }
    const offset = sub(c, a), t = cross(offset, v) / denominator, s = cross(offset, u) / denominator
    if (t < -EPS / Math.hypot(...u) || t > 1 + EPS / Math.hypot(...u) || s < -EPS / Math.hypot(...v) || s > 1 + EPS / Math.hypot(...v)) continue
    const id = node([a[0] + u[0] * t, a[1] + u[1] * t]); left.cuts.add(id); right.cuts.add(id); intersections++
  }
  const edgeKeys = new Set<string>(), edges: [number, number][] = []
  for (const line of lines) {
    const a = nodes[line.start], direction = sub(nodes[line.end], a), cuts = [...line.cuts].sort((i, j) => dot(sub(nodes[i], a), direction) - dot(sub(nodes[j], a), direction))
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], key = a < b ? `${a},${b}` : `${b},${a}`
      if (a === b || edgeKeys.has(key)) continue
      if (edges.length >= 32768) throw Error('Shared arrangement output edge budget exceeded')
      edgeKeys.add(key); edges.push([a, b])
    }
  }
  const half: HalfEdge[] = [], outgoing = nodes.map((): number[] => [])
  for (const [a, b] of edges) {
    const i = half.length; half.push({ a, b, twin: i + 1, cycle: -1, next: -1 }, { a: b, b: a, twin: i, cycle: -1, next: -1 }); outgoing[a].push(i); outgoing[b].push(i + 1)
  }
  for (let i = 0; i < outgoing.length; i++) outgoing[i].sort((a, b) => Math.atan2(nodes[half[a].b][1] - nodes[i][1], nodes[half[a].b][0] - nodes[i][0]) - Math.atan2(nodes[half[b].b][1] - nodes[i][1], nodes[half[b].b][0] - nodes[i][0]))
  for (const h of half) { const next = outgoing[h.b], at = next.indexOf(h.twin); h.next = next[(at - 1 + next.length) % next.length] }
  const pointDistance = (p: Pair, a: Pair, b: Pair) => { const d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d))); return distance(p, [a[0] + d[0] * t, a[1] + d[1] * t]) }
  let witnessChecks = 0
  let classificationChecks = 0
  const chargeClassification = (points: number) => {
    classificationChecks += points
    if (classificationChecks > 32_000_000) throw Error('Shared arrangement face classification budget exceeded')
  }
  const witness = (ids: number[]): Pair => {
    const id = ids.reduce((best, id) => distance(nodes[half[id].a], nodes[half[id].b]) > distance(nodes[half[best].a], nodes[half[best].b]) ? id : best, ids[0])
    const h = half[id], a = nodes[h.a], b = nodes[h.b], d = sub(b, a), length = Math.hypot(...d), mid: Pair = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    let nearest = length / 2
    for (const [u, v] of edges) if (!(u === h.a && v === h.b || u === h.b && v === h.a)) {
      if (++witnessChecks > 32_000_000) throw Error('Shared arrangement witness budget exceeded')
      nearest = Math.min(nearest, pointDistance(mid, nodes[u], nodes[v]))
    }
    const offset = Math.min(.0001, nearest * .1)
    if (offset < 1e-11) throw Error('Unresolved arrangement sliver')
    return [mid[0] - d[1] / length * offset, mid[1] + d[0] / length * offset]
  }
  const ownerAt = (point: Pair): Owner | null => {
    chargeClassification(inputPoints + 4)
    if (!inRing(box[0], point)) return null
    const matches = sources.filter(s => contains(s.regions, point)), source = matches[0]
    const ambiguous = matches.some((s, i) => matches.slice(i + 1).some(t => t.priority === s.priority))
    const active = stairs.filter(s => contains(s.footprint, point))
    if (active.length > 1) throw Error('Intersecting stair footprints are not supported')
    if (active.length) {
      const s = active[0], i = s.indexAt(point)
      return { id: `${s.connection.id}-tread-${i}`, sourceId: s.connection.id, z: s.from + (s.to - s.from) * (i + 1) / s.count, kind: 'tread', color: '#eedcba', ambiguous }
    }
    return source ? { id: source.id, sourceId: source.id, z: source.elevationMm, color: source.color, kind: source.kind ?? 'terrain', ambiguous } : { id: '$floor', sourceId: '$floor', z: 0, color: '#c8e9ec', kind: 'terrain', ambiguous: false }
  }
  const cycles: FaceCycle[] = []
  for (let start = 0; start < half.length; start++) if (half[start].cycle < 0) {
    const ids = [], index = cycles.length; let at = start
    do {
      if (half[at].cycle >= 0) throw Error('Arrangement face walk did not close')
      ids.push(at); half[at].cycle = index; at = half[at].next
    } while (at !== start)
    const ring = ids.map(id => nodes[half[id].a]), area = signedArea(ring), sample = witness(ids)
    cycles.push({ ids, ring, area, sample, owner: ownerAt(sample), holes: [], parent: null })
  }
  const positive = cycles.filter(c => c.area > 1e-9)
  for (const cycle of cycles.filter(c => c.area < -1e-9)) {
    const parent = positive.filter(p => { chargeClassification(p.ring.length); return inRing(p.ring, cycle.sample) }).sort((a, b) => a.area - b.area)[0]
    if (parent) { parent.holes.push(cycle.ring); cycle.parent = parent }
  }
  let ambiguousArea = 0
  const grouped = new Map<string, TerrainPartitionTop>()
  for (const cycle of positive) if (cycle.owner) {
    const regions: MultiPolygon = [[cycle.ring, ...cycle.holes]], a = terrainPartitionArea(regions)
    if (cycle.owner.ambiguous) ambiguousArea += a
    const { ambiguous, ...owner } = cycle.owner, entry = grouped.get(owner.id) ?? { ...owner, regions: [] }
    entry.regions.push(...regions.map(poly => poly.map(r => r.map(world)))); grouped.set(owner.id, entry)
  }
  if (ambiguousArea > 1e-5) throw Error('Ambiguous equal-priority overlap: ' + ambiguousArea)
  const walls: TerrainPartitionWall[] = []
  for (let i = 0; i < half.length; i += 2) {
    const left = cycles[half[i].cycle].owner, right = cycles[half[i + 1].cycle].owner
    if (!left || !right || Math.abs(left.z - right.z) < 1e-8) continue
    const forward = left.z > right.z, high = forward ? left : right, low = forward ? right : left, h = half[forward ? i : i + 1], a = world(nodes[h.a]), b = world(nodes[h.b]), d = sub(b, a), length = Math.hypot(...d)
    walls.push({ a, b, normal: [d[1] / length, -d[0] / length], highId: high.id, lowId: low.id, low: low.z, high: high.z })
  }
  const tops = [...grouped.values()], covered = tops.reduce((sum, t) => sum + terrainPartitionArea(t.regions), 0)
  if (Math.abs(covered - bounds.width * bounds.height) > .001) throw Error('Shared partition did not cover world frame: ' + (covered - bounds.width * bounds.height))
  return { bounds, tops, walls, slabs: [], levels: [...new Set(tops.map(t => t.z))].sort((a, b) => a - b), metrics: {
    algorithm: 'single-noded-planar-arrangement', nodePrecisionMm: EPS, sourceCoordinatesSnapped: false, rawSegments: raw.length, nodes: nodes.length, atomicEdges: edges.length, faceCycles: cycles.length, pairChecks, witnessChecks, classificationChecks, intersections, maxSharedNodeShiftMm, wallCount: walls.length,
    coveredAreaMm2: covered, wallAreaMm2: walls.reduce((sum, w) => sum + distance(w.a, w.b) * (w.high - w.low), 0),
    stairs: stairs.map(s => ({ id: s.connection.id, lengthMm: s.length, treads: s.count, widthMm: s.connection.widthMm, riseMm: s.to - s.from, nativeFootprintAreaMm2: terrainPartitionArea(s.footprint) })),
  } }
}
