import { sculptedCliffMass } from './sculpted-cliff-mass.js'
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import { naturalCliffMass, type NaturalCliffMass } from './natural-cliff-mass.js'
import { layeredCliffMass, type LayeredCliffMass } from './layered-cliff-mass.js'
import { pointInPolygon } from '../geometry/geometry.js'
import type { PointMm } from '../model/scene.js'
import type { ProjectedSurface, Projection } from '../projection/types.js'
import type { VisualEdgeLook } from './types.js'

export const TERRAIN_CLIFF_PROFILE = 'rockRelief6' as const
export const NATURAL_TERRAIN_CLIFF_PROFILE = 'rockRelief7' as const
export const SCULPTED_TERRAIN_CLIFF_PROFILE = 'rockRelief9' as const
export const LAYERED_TERRAIN_CLIFF_PROFILE = 'rockRelief8' as const
export interface TerrainCliffCell {
  polygon: PointMm[]
  inner: [PointMm, PointMm]
  crest: [PointMm, PointMm]
  foot: [PointMm, PointMm]
  normal: PointMm
  stationMm: number
}
export interface TerrainCliffFace {
  look: VisualEdgeLook
  highId: string | null
  lowId: string | null
  highMm: number
  lowMm: number
  /** Disjoint owned footprint, including the upper rocky shoulder. */
  rings: PointMm[][]
  cells: TerrainCliffCell[]
  shadowRings: PointMm[][]
  facets: { points: PointMm[]; shade: number; depth: number }[]
  layers: PointMm[][]
  cracks: PointMm[][]
  natural?: NaturalCliffMass | LayeredCliffMass
}
interface Run {
  points: PointMm[]; closed: boolean; look: VisualEdgeLook; side: 1 | -1
  high: ProjectedSurface | null; low: ProjectedSurface | null
}
const p = (x: number, y: number): PointMm => ({ x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 })
const mix = (a: PointMm, b: PointMm, t: number) => p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const add = (a: PointMm, n: PointMm, d: number) => p(a.x + n.x * d, a.y + n.y * d)
const ring = (points: PointMm[]): Ring => points.map(a => [a.x, a.y])
const poly = (points: PointMm[]): Polygon => [ring(points)]
const unpack = (polygons: MultiPolygon) => polygons.flatMap(a => a.map(b => b.slice(0, -1).map(([x, y]) => p(x, y))))
/** Bounded paint-only precision for the new shelf recipe. Boolean intersections
 * can retain 1e-12 mm endpoint disagreements; never apply this to saved terrain
 * or silently change earlier recipes' raster path. */
const snapPaint = (polygons: MultiPolygon): MultiPolygon => polygons.flatMap(polygon => {
  const rings = polygon.map(ring => {
    const points = ring.map(([x, y]) => p(x, y)).filter((a, i, all) => i === 0 || a.x !== all[i - 1].x || a.y !== all[i - 1].y)
    if (points.length && (points[0].x !== points.at(-1)!.x || points[0].y !== points.at(-1)!.y)) points.push({ ...points[0] })
    return points
  })
  if (rings[0].length < 4 || Math.abs(area(rings[0])) < 1e-8) return []
  return [rings.filter(r => r.length >= 4 && Math.abs(area(r)) > 1e-8).map(ring => ring.map(a => [a.x, a.y] as [number, number]))]
})
const same = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y) < .001
const area = (points: PointMm[]) => points.reduce((s, a, i) => { const b = points[(i + 1) % points.length]; return s + a.x * b.y - a.y * b.x }, 0) / 2
const key = (run: Run) => JSON.stringify([run.high?.id, run.low?.id, run.side, run.look.floorId, run.look.layerId,
  run.look.visibility, run.look.widthMm, run.look.color, run.look.accentColor, run.look.seed, run.look.repeatMm,
  run.look.opacity, run.look.intensity, run.look.renderProfile])

/** All ownership is derived from this audience's visible surface order. The
 * source document, editing viewport and hidden surfaces are never consulted. */
export function planTerrainCliffs(projection: Pick<Projection, 'terrain' | 'visual'>): TerrainCliffFace[] {
  const visual = projection.visual
  if (!visual) return []
  const looks = visual.edgeLooks.filter(a => a.kind === 'cliff' && (a.renderProfile === TERRAIN_CLIFF_PROFILE || a.renderProfile === NATURAL_TERRAIN_CLIFF_PROFILE || a.renderProfile === LAYERED_TERRAIN_CLIFF_PROFILE || a.renderProfile === SCULPTED_TERRAIN_CLIFF_PROFILE) && a.opacity > 0)
  if (!looks.length) return []
  if (looks.length > 128 || projection.terrain.length > 4096) throw new Error('高差岩面超过有限规划预算。')
  const surfaces = projection.terrain.map((surface, index) => ({ surface, index }))
    .sort((a, b) => a.surface.priority - b.surface.priority || a.index - b.index).map(a => a.surface)
  const visible = (point: PointMm) => {
    for (let i = surfaces.length - 1; i >= 0; i--) if (pointInPolygon(point, surfaces[i].points, false)) return surfaces[i]
    return null
  }
  const boundaries = new Map(visual.boundaries.map(a => [a.id, a])), runs: Run[] = []
  let tested = 0
  for (const look of looks) {
    const boundary = boundaries.get(look.boundaryId)
    if (!boundary?.terrainAreaIds.length) continue // Decorative lines have no invented height.
    let active: Run | undefined
    for (let i = 0; i < boundary.points.length - (boundary.closed ? 0 : 1); i++) {
      const a = boundary.points[i], b = boundary.points[(i + 1) % boundary.points.length]
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      if (!length) continue
      const cuts = [0, 1], cross = (x: number, y: number, u: number, v: number) => x * v - y * u
      for (const surface of surfaces) for (let j = 0; j < surface.points.length; j++) {
        if (++tested > 16_777_216) throw new Error('高差岩面地表交点超过有限预算。')
        const c = surface.points[j], d = surface.points[(j + 1) % surface.points.length], ex = d.x - c.x, ey = d.y - c.y
        const determinant = cross(dx, dy, ex, ey)
        if (Math.abs(determinant) < 1e-7) {
          if (Math.abs(cross(c.x - a.x, c.y - a.y, dx, dy)) < .001) for (const q of [c, d]) {
            const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / length ** 2
            if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t)
          }
        } else {
          const t = cross(c.x - a.x, c.y - a.y, ex, ey) / determinant, u = cross(c.x - a.x, c.y - a.y, dx, dy) / determinant
          if (t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1) cuts.push(t)
        }
      }
      cuts.sort((x, y) => x - y)
      for (let j = 0; j < cuts.length - 1; j++) {
        if ((cuts[j + 1] - cuts[j]) * length < .001) continue
        const middle = mix(a, b, (cuts[j] + cuts[j + 1]) / 2), n = { x: -dy / length, y: dx / length }
        const epsilon = Math.min(.2, (cuts[j + 1] - cuts[j]) * length / 8)
        const left = visible(add(middle, n, epsilon)), right = visible(add(middle, n, -epsilon))
        const le = left?.elevationMm ?? 0, re = right?.elevationMm ?? 0
        if (le === re || ![left?.id, right?.id].some(id => id && boundary.terrainAreaIds.includes(id))) { active = undefined; continue }
        const side = (le > re ? -1 : 1) as 1 | -1
        if (look.side !== 'both' && (look.side === 'left' ? 1 : -1) !== side) { active = undefined; continue }
        const from = mix(a, b, cuts[j]), to = mix(a, b, cuts[j + 1])
        const current: Run = { points: [from, to], closed: false, look, side, high: le > re ? left : right, low: le > re ? right : left }
        if (active && key(current) === key(active) && same(active.points.at(-1)!, from)) active.points.push(to)
        else { runs.push(current); active = current }
      }
    }
  }
  // Join only equal actual height relationships and paint, including across
  // source boundary records. An ambiguous branch terminates the chain.
  const joined: Run[] = [], used = new Set<Run>()
  for (const run of runs) {
    if (used.has(run)) continue
    used.add(run); const result = { ...run, points: [...run.points] }, signature = key(run)
    for (const forward of [true, false]) for (;;) {
      const end = forward ? result.points.at(-1)! : result.points[0]
      const next = runs.filter(a => key(a) === signature && same(forward ? a.points[0] : a.points.at(-1)!, end))
      const prior = runs.filter(a => key(a) === signature && same(forward ? a.points.at(-1)! : a.points[0], end))
      if (next.length !== 1 || prior.length !== 1 || used.has(next[0])) break
      used.add(next[0]); result.points = forward ? [...result.points, ...next[0].points.slice(1)] : [...next[0].points.slice(0, -1), ...result.points]
    }
    result.closed = same(result.points[0], result.points.at(-1)!)
    if (result.closed) result.points.pop()
    joined.push(result)
  }
  // Derive complete visible top regions once, using priority rather than height.
  const coverage = new Map<string | null, MultiPolygon>()
  for (let i = 0; i < surfaces.length; i++) coverage.set(surfaces[i].id,
    i === surfaces.length - 1 ? [poly(surfaces[i].points)] : polygonClipping.difference(poly(surfaces[i].points), ...surfaces.slice(i + 1).map(a => poly(a.points))))
  const bounds = visual.boundsMm, margin = 30_000
  const floor = poly([{ x: bounds.x - margin, y: bounds.y - margin }, { x: bounds.x + bounds.width + margin, y: bounds.y - margin },
    { x: bounds.x + bounds.width + margin, y: bounds.y + bounds.height + margin }, { x: bounds.x - margin, y: bounds.y + bounds.height + margin }])
  coverage.set(null, surfaces.length ? polygonClipping.difference(floor, ...surfaces.map(a => poly(a.points))) : [floor])
  const shoulderCoverage = new Map<string | null, MultiPolygon>()
  for (const surface of surfaces) {
    // Saved surface patches remain above the rocky shoulder. A cliff drawing
    // must not erase authored grass, sand, or other top paint when widened.
    const overlays: Polygon[] = (surface.style?.overlays ?? []).map(a => poly(a.boundaryMm))
    for (const patch of surface.materialPatches ?? []) for (const region of patch.regionsMm) overlays.push([ring(region.outerMm), ...region.holesMm.map(ring)])
    const top = coverage.get(surface.id) ?? []
    shoulderCoverage.set(surface.id, overlays.length ? polygonClipping.difference(top, ...overlays) : top)
  }
  shoulderCoverage.set(null, coverage.get(null)!)
  // A change of the lower surface must not restart the upper crest's tangent.
  // Share its vertex normal across actual high-owner runs, including a coast
  // joining an inner terrace. Opposite high owners remain separate.
  const normalKey = (run: Run, point: PointMm) => `${run.high?.id ?? 'floor'}:${run.side}:${point.x},${point.y}`
  const vertexNormals = new Map<string, PointMm[]>()
  const vertexDrops = new Map<string, number>()
  for (const run of joined) for (let i = 0; i < run.points.length - (run.closed ? 0 : 1); i++) {
    const a = run.points[i], b = run.points[(i + 1) % run.points.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    const normal = { x: -dy / length * run.side, y: dx / length * run.side }
    for (const point of [a, b]) {
      const key = normalKey(run, point), values = vertexNormals.get(key) ?? []
      values.push(normal); vertexNormals.set(key, values)
      const drop = (run.high?.elevationMm ?? 0) - (run.low?.elevationMm ?? 0)
      vertexDrops.set(key, Math.min(vertexDrops.get(key) ?? drop, drop))
    }
  }
  const normalAt = (run: Run, point: PointMm) => {
    const values = vertexNormals.get(normalKey(run, point)) ?? [], sum = values.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), { x: 0, y: 0 })
    const length = Math.hypot(sum.x, sum.y); return length > .1 ? { x: sum.x / length, y: sum.y / length } : undefined
  }
  const paintOrder = new Map((visual.edgePaintOrder ?? visual.edgeLooks.map(look => ({ kind: 'edgeLook', id: look.id })))
    .map((entry, index) => [entry.id, index]))
  const drafts = joined.map(run => makeFace(run, point => normalAt(run, point), point => vertexDrops.get(normalKey(run, point))!)).sort((a, b) => b.highMm - a.highMm || b.lowMm - a.lowMm
    || (paintOrder.get(b.look.id) ?? 0) - (paintOrder.get(a.look.id) ?? 0))
  const result: TerrainCliffFace[] = [], occupied: MultiPolygon[] = []
  let pointsUsed = 0
  for (const face of drafts) {
    if (!face.rings.length) continue
    const allowed = polygonClipping.union(shoulderCoverage.get(face.highId) ?? [], coverage.get(face.lowId) ?? [])
    const pieces = face.cells.map(cell => poly(cell.polygon))
    const footprint = polygonClipping.union(pieces[0], ...pieces.slice(1))
    let owned = polygonClipping.intersection(footprint, allowed)
    if (owned.length && occupied.length) owned = polygonClipping.difference(owned, ...occupied)
    if (!owned.length) continue
    face.rings = unpack(owned); pointsUsed += face.rings.reduce((s, a) => s + a.length, 0) + face.cells.length * 12
    if (pointsUsed > 131072) throw new Error('高差岩面输出超过有限绘制点预算。')
    occupied.push(owned); result.push(face)
  }
  // Cast only onto the actual lower visible surface, beyond the owned rock
  // faces. One union/ownership pass prevents multiplying dark junctions.
  const shadowOwned: MultiPolygon[] = []
  const angle = visual.environment.lightDirectionDeg * Math.PI / 180
  for (const face of result) {
    const layered = face.look.renderProfile === LAYERED_TERRAIN_CLIFF_PROFILE || face.look.renderProfile === SCULPTED_TERRAIN_CLIFF_PROFILE
    const exactPaint = (polygons: MultiPolygon) => layered ? snapPaint(polygons) : polygons
    const reach = Math.min(face.look.widthMm * .6, (face.highMm - face.lowMm) * .18)
    const dx = -Math.cos(angle) * reach, dy = -Math.sin(angle) * reach
    const shifted = face.rings.map(points => [points.map(a => [a.x + dx, a.y + dy] as [number, number])] as Polygon)
    let shadow = exactPaint(polygonClipping.xor(shifted[0], ...shifted.slice(1)))
    shadow = exactPaint(polygonClipping.intersection(shadow, coverage.get(face.lowId) ?? []))
    if (shadow.length) {
      if (layered) for (const taken of occupied.concat(shadowOwned)) {
        if (!shadow.length) break
        shadow = snapPaint(polygonClipping.difference(shadow, snapPaint(taken)))
      }
      else shadow = polygonClipping.difference(shadow, ...occupied, ...shadowOwned)
    }
    face.shadowRings = unpack(shadow); if (shadow.length) shadowOwned.push(shadow)
  }
  const outputPoints = result.reduce((sum, face) => sum + face.rings.concat(face.shadowRings, face.layers, face.cracks).reduce((n, a) => n + a.length, 0)
    + face.cells.length * 12 + face.facets.reduce((n, a) => n + a.points.length, 0)
    + (face.natural ? face.natural.planes.reduce((n, a) => n + a.points.length, 0) + face.natural.shelves.reduce((n, a) => n + a.points.length, 0)
      + face.natural.creases.concat(face.natural.lips, face.natural.joints).reduce((n, a) => n + a.length, 0)
      + ('benches' in face.natural ? face.natural.benches.reduce((n, a) => n + a.top.length + a.front.length + a.edge.length, 0) : 0) : 0), 0)
  if (outputPoints > 131072) throw new Error('高差岩面完整绘制计划超过有限点预算。')
  return result
}

function makeFace(run: Run, sharedNormal: (point: PointMm) => PointMm | undefined, sharedDrop: (point: PointMm) => number): TerrainCliffFace {
  const { look, side, points, closed } = run, highMm = run.high?.elevationMm ?? 0, lowMm = run.low?.elevationMm ?? 0, drop = highMm - lowMm
  let seed = 2166136261
  for (let i = 0; i < look.seed.length; i++) seed = Math.imul(seed ^ look.seed.charCodeAt(i), 16777619)
  const phase = (seed >>> 0) / 4294967296 * Math.PI * 2
  const cells: TerrainCliffCell[] = [], polygons: Polygon[] = [], layers: PointMm[][] = [], cracks: PointMm[][] = [], facets: TerrainCliffFace['facets'] = []
  const count = points.length - (closed ? 0 : 1), normals: PointMm[] = [], distances = [0]
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    normals.push({ x: -dy / length * side, y: dx / length * side }); distances.push(distances[i] + length)
  }
  const normalsAt = points.map((point, i) => {
    const shared = sharedNormal(point)
    if (shared) return shared
    const a = normals[(i - 1 + count) % count], b = normals[i % count]
    if (!closed && i === 0) return b
    if (!closed && i === points.length - 1) return a
    const length = Math.hypot(a.x + b.x, a.y + b.y)
    return length > .1 ? { x: (a.x + b.x) / length, y: (a.y + b.y) / length } : b
  })
  const dropAt = (i: number) => {
    if (closed) return drop
    const start = sharedDrop(points[0]), end = sharedDrop(points.at(-1)!), blend = Math.max(500, look.widthMm)
    return Math.min(drop, start + (drop - start) * Math.min(1, distances[i] / blend),
      end + (drop - end) * Math.min(1, (distances.at(-1)! - distances[i]) / blend))
  }
  const natural = look.renderProfile === NATURAL_TERRAIN_CLIFF_PROFILE || look.renderProfile === LAYERED_TERRAIN_CLIFF_PROFILE || look.renderProfile === SCULPTED_TERRAIN_CLIFF_PROFILE
  const layered = look.renderProfile === LAYERED_TERRAIN_CLIFF_PROFILE || look.renderProfile === SCULPTED_TERRAIN_CLIFF_PROFILE
  // Height controls both the shoulder and exposed face; look.widthMm is a
  // bounded artistic maximum, not an invented physical terrace or elevation.
  const inner = points.map((a, i) => {
    const variation = layered
      ? .86 + .17 * Math.sin(a.x / 850 + a.y / 1200 + phase) + .07 * Math.sin(a.x / 240 - a.y / 330 + phase)
      : .91 + .08 * Math.sin(a.x / 850 + a.y / 1200 + phase) + .04 * Math.sin(a.x / 240 - a.y / 330 + phase)
    return add(a, normalsAt[i], -Math.min(look.widthMm * 1.65, dropAt(i) * (natural ? .94 : .58)) * variation)
  })
  const feet = points.map((a, i) => {
    const n = normalsAt[i], facing = .26 + .74 * (.5 + .5 * n.y)
    const variation = layered
      ? .80 + .16 * Math.sin(a.x / 700 + a.y / 1100 + phase) + .08 * Math.cos(a.x / 230 - a.y / 380 + phase)
      : .88 + .08 * Math.sin(a.x / 700 + a.y / 1100 + phase) + .06 * Math.cos(a.x / 230 - a.y / 380 + phase)
    return add(a, n, Math.min(look.widthMm, dropAt(i) * (natural ? .85 : .48)) * facing * variation)
  })
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % points.length, polygon = [inner[i], inner[j], feet[j], feet[i]]
    if (Math.abs(area(polygon)) < 1e-5) continue
    polygons.push(poly(polygon)); cells.push({ polygon, inner: [inner[i], inner[j]], crest: [points[i], points[j]],
      foot: [feet[i], feet[j]], normal: normals[i], stationMm: distances[i] })
  }
  const total = distances.at(-1)!, at = (distance: number, fraction: number) => {
    const d = closed ? (distance % total + total) % total : Math.max(0, Math.min(total, distance))
    let i = 0; while (i < count - 1 && distances[i + 1] < d) i++
    const t = (d - distances[i]) / (distances[i + 1] - distances[i]), j = (i + 1) % points.length
    const top = mix(inner[i], inner[j], t), crest = mix(points[i], points[j], t), foot = mix(feet[i], feet[j], t)
    return fraction < 0 ? mix(crest, top, -fraction) : mix(crest, foot, fraction)
  }
  // Long broken strata follow the mass, while wider spaced cross fractures
  // bridge its shoulder and face. Stations use millimetres, never pixel zoom.
  const spacing = Math.max(650, look.repeatMm * 2.4)
  for (let d = 0; d < total; d += spacing) {
    if (cracks.length > 4096) throw new Error('高差岩面岩层超过有限预算。')
    const wobble = Math.sin(d / 410 + points[0].x / 800 + phase) * .12
    cracks.push([at(d + spacing * .18, -.91), at(d + spacing * (.27 + wobble), -.48),
      at(d + spacing * .20, -.07), at(d + spacing * (.32 - wobble), .45), at(d + spacing * .4, .98)])
    for (const [layer, f] of [-.70, -.33, .37, .72].entries()) {
      if (Math.sin(d / 810 + layer * 2.1 + phase) < -.55) continue
      layers.push(Array.from({ length: 9 }, (_, i) => at(d + spacing * (i / 11 + .08), f + Math.sin(i * .9 + d / 500 + phase) * .035)))
    }
    for (const [layer, from, to] of [[0, -.96, -.44], [1, -.44, .02], [2, .02, .46], [3, .46, .98]]) {
      const wave = Math.sin(d / 610 + layer * 2.1) * .08
      // Broad broken rock planes, rather than a repeated tile per curve vertex.
      const points = [at(d, from + wave), at(d + spacing * .56, from - .035), at(d + spacing, from + wave * .6),
        at(d + spacing, to + wave * .6), at(d + spacing * .4, to + .025), at(d, to + wave)]
      facets.push({ points, shade: .92 + Math.sin(d / 440 + layer * 1.7) * .10, depth: (from + to) / 2 })
    }
  }
  return { look, highId: run.high?.id ?? null, lowId: run.low?.id ?? null, highMm, lowMm,
    rings: polygons.length ? unpack(polygonClipping.union(polygons[0], ...polygons.slice(1))) : [], cells, shadowRings: [], facets, layers, cracks,
    ...(look.renderProfile === SCULPTED_TERRAIN_CLIFF_PROFILE ? { natural: sculptedCliffMass(total, at, look.seed, look.repeatMm) }
      : look.renderProfile === LAYERED_TERRAIN_CLIFF_PROFILE ? { natural: layeredCliffMass(total, at, look.seed, look.repeatMm) }
      : look.renderProfile === NATURAL_TERRAIN_CLIFF_PROFILE ? { natural: naturalCliffMass(total, at, look.seed, look.repeatMm) } : {}) }
}
