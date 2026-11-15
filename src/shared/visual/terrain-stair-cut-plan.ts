import type { MultiPolygon } from 'polygon-clipping'
import type { TerrainPartitionStair, TerrainPartitionTop, TerrainPartitionWall } from './terrain-mass-partition.js'

type Pair = [number, number]
export interface TerrainStairCutInput {
  /** Already audience/Floor filtered, with real, shared tread boundaries. */
  tops: readonly TerrainPartitionTop[]
  walls: readonly TerrainPartitionWall[]
  /** Optional real routes identify the bottom riser, without treating the
   * terrain beside a stair as another full-width transverse cut. */
  connections?: readonly TerrainPartitionStair[]
  seed: string
  maxFaceDepthMm: number
  faceDepthPerRise?: number
}
export interface TerrainStairCut {
  highId: string; lowId: string; fromElevationMm: number; toElevationMm: number
  lengthMm: number; depthMm: number
  /** Shared polyline, not a fresh wear pattern per atomic boundary segment. */
  frontMm: Pair[]; backMm: Pair[]
  /** Clip this paint to the true high tread. It never changes stair support. */
  clipRegionsMm: MultiPolygon
  outwardNormal: Pair
}
export interface TerrainStairCutPlan {
  cuts: TerrainStairCut[]
  treads: { id: string; sourceId: string; elevationMm: number; regionsMm: MultiPolygon }[]
  metrics: { atomicFronts: number; continuousFronts: number; paintPoints: number }
}
const distance = (a: Pair, b: Pair) => Math.hypot(a[0] - b[0], a[1] - b[1])
const pointKey = (p: Pair) => `${p[0]},${p[1]}`
const copyRegions = (regions: MultiPolygon): MultiPolygon => regions.map(poly => poly.map(ring => ring.map(p => [p[0], p[1]])))
const finite = (p: Pair) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)

/** Optional paint plan from an existing common partition. No domain, passage,
 * resource or privacy validation is implied; no saved profile is reinterpreted.
 * Tops and the exact high-tread clip keep the original fixed world XY. */
export function planTerrainStairCuts(input: TerrainStairCutInput): TerrainStairCutPlan {
  const ratio = input.faceDepthPerRise ?? .72
  if (!input.seed || typeof input.seed !== 'string' || !Number.isFinite(input.maxFaceDepthMm) || input.maxFaceDepthMm <= 0
    || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1 || input.tops.length > 4096 || input.walls.length > 32768
    || (input.connections?.length ?? 0) > 16) throw Error('Invalid stair cut paint input')
  const tops = new Map<string, TerrainPartitionTop>(), groups = new Map<string, TerrainPartitionWall[]>(); let inputPoints = 0
  for (const top of input.tops) {
    if (!top.id || tops.has(top.id) || !Number.isFinite(top.z)) throw Error('Invalid or duplicate stair partition top')
    tops.set(top.id, top)
    for (const polygon of top.regions) for (const ring of polygon) for (const p of ring) if (++inputPoints > 65536 || !finite(p)) throw Error('Invalid stair partition coordinates')
  }
  const starts = new Map<string, { position: Pair; tangent: Pair; low: number; firstHigh: number }>()
  for (const connection of input.connections ?? []) {
    if (starts.has(connection.id) || !Number.isFinite(connection.fromElevationMm) || !Number.isFinite(connection.toElevationMm)
      || connection.fromElevationMm === connection.toElevationMm || connection.centerlineMm.length < 2 || connection.centerlineMm.length > 256
      || !connection.centerlineMm.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw Error('Invalid bottom stair landing')
    const route = connection.toElevationMm > connection.fromElevationMm ? connection.centerlineMm : [...connection.centerlineMm].reverse()
    const a = route[0], b = route[1], length = Math.hypot(b.x - a.x, b.y - a.y)
    const treadHeights = input.tops.filter(t => t.kind === 'tread' && t.sourceId === connection.id).map(t => t.z)
    if (length <= 1e-8 || !treadHeights.length) throw Error('Missing bottom stair front')
    starts.set(connection.id, { position: [a.x, a.y], tangent: [(b.x - a.x) / length, (b.y - a.y) / length],
      low: Math.min(connection.fromElevationMm, connection.toElevationMm), firstHigh: Math.min(...treadHeights) })
  }
  let atomicFronts = 0
  for (const wall of input.walls) {
    const high = tops.get(wall.highId), low = tops.get(wall.lowId)
    if (high?.kind !== 'tread' || !low) continue
    const start = starts.get(high.sourceId)
    const onStart = (p: Pair) => start && finite(p) && Math.abs((p[0] - start.position[0]) * start.tangent[0] + (p[1] - start.position[1]) * start.tangent[1]) < 1e-6
    const bottomFront = low.kind === 'terrain' && start && wall.low === start.low && high.z === start.firstHigh && onStart(wall.a) && onStart(wall.b)
    if (!(low.kind === 'tread' && high.sourceId === low.sourceId) && !bottomFront) continue
    if (!finite(wall.a) || !finite(wall.b) || !finite(wall.normal) || distance(wall.a, wall.b) < 1e-8
      || !(wall.high > wall.low) || wall.high !== high.z || wall.low !== low.z) throw Error('Invalid real stair riser')
    const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], length = Math.hypot(dx, dy)
    if (Math.abs(wall.normal[0] - dy / length) > 1e-7 || Math.abs(wall.normal[1] + dx / length) > 1e-7) throw Error('Stair front normal disagrees with high side')
    const key = JSON.stringify([wall.highId, wall.lowId]), group = groups.get(key) ?? []
    group.push(wall); groups.set(key, group); atomicFronts++
  }
  let seed = 2166136261
  for (let i = 0; i < input.seed.length; i++) seed = Math.imul(seed ^ input.seed.charCodeAt(i), 16777619)
  const random = (station: number, channel: number, salt: number) => {
    let h = seed ^ Math.imul(station + 1, 73856093) ^ Math.imul(channel + 1, 19349663) ^ salt
    h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296
  }
  const cuts: TerrainStairCut[] = []; let paintPoints = 0
  // Sorting removes source-wall enumeration from the visual seed and plan.
  for (const groupKey of [...groups.keys()].sort()) {
    const walls = groups.get(groupKey)!, outgoing = new Map<string, TerrainPartitionWall>(), incoming = new Map<string, TerrainPartitionWall>()
    for (const wall of walls) {
      const a = pointKey(wall.a), b = pointKey(wall.b)
      if (outgoing.has(a) || incoming.has(b)) throw Error('Ambiguous branched stair front')
      outgoing.set(a, wall); incoming.set(b, wall)
    }
    const used = new Set<TerrainPartitionWall>()
    const starts = walls.filter(w => !incoming.has(pointKey(w.a))).sort((a, b) => a.a[0] - b.a[0] || a.a[1] - b.a[1])
    for (const first of starts) {
      const chain: TerrainPartitionWall[] = []; let wall: TerrainPartitionWall | undefined = first
      while (wall && !used.has(wall)) { used.add(wall); chain.push(wall); wall = outgoing.get(pointKey(wall.b)) }
      if (wall) throw Error('Cyclic stair front')
      const lengths = chain.map(w => distance(w.a, w.b)), accumulated = [0]
      for (const length of lengths) accumulated.push(accumulated.at(-1)! + length)
      const lengthMm = accumulated.at(-1)!, depthMm = Math.min(input.maxFaceDepthMm, (first.high - first.low) * ratio)
      const count = Math.max(4, Math.ceil(lengthMm / 90))
      if (count > 1024 || cuts.length >= 2048 || paintPoints + (count + 1) * 2 > 131072) throw Error('Stair cut paint budget exceeded')
      let salt = 2166136261
      for (let i = 0; i < groupKey.length; i++) salt = Math.imul(salt ^ groupKey.charCodeAt(i), 16777619)
      const frontMm: Pair[] = [], backMm: Pair[] = []
      for (let k = 0; k <= count; k++) {
        const station = lengthMm * k / count, t = k / count
        let i = 0; while (i < chain.length - 1 && accumulated[i + 1] < station) i++
        const segment = chain[i], fraction = (station - accumulated[i]) / lengths[i]
        const x = segment.a[0] + (segment.b[0] - segment.a[0]) * fraction, y = segment.a[1] + (segment.b[1] - segment.a[1]) * fraction
        // Wear is evaluated once over the complete front and vanishes at both
        // endpoints. It cannot reset at a noded crossing or curve subdivision.
        const wear = Math.sin(t * Math.PI) * (random(k, 1, salt) - .5) * Math.min(30, depthMm * .22)
        const p: Pair = [x - segment.normal[0] * wear, y - segment.normal[1] * wear]
        frontMm.push(p); backMm.push([p[0] - segment.normal[0] * depthMm, p[1] - segment.normal[1] * depthMm])
      }
      // Exact source endpoints avoid a sin(pi) rounding displacement.
      frontMm[0] = [...first.a]; frontMm[frontMm.length - 1] = [...chain.at(-1)!.b]
      const average = chain.reduce((a, w, i): Pair => [a[0] + w.normal[0] * lengths[i], a[1] + w.normal[1] * lengths[i]], [0, 0] as Pair)
      const normalLength = Math.hypot(...average)
      cuts.push({ highId: first.highId, lowId: first.lowId, fromElevationMm: first.low, toElevationMm: first.high, lengthMm, depthMm,
        frontMm, backMm, clipRegionsMm: copyRegions(tops.get(first.highId)!.regions), outwardNormal: normalLength > 1e-8 ? [average[0] / normalLength, average[1] / normalLength] : [...first.normal] })
      paintPoints += frontMm.length + backMm.length
    }
    if (used.size !== walls.length) throw Error('Closed or unresolved stair front')
  }
  return { cuts, treads: [...tops.values()].filter(t => t.kind === 'tread').sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
    .map(t => ({ id: t.id, sourceId: t.sourceId, elevationMm: t.z, regionsMm: copyRegions(t.regions) })),
    metrics: { atomicFronts, continuousFronts: cuts.length, paintPoints } }
}
