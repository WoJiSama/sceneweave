import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { BoundsMm, PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { CARVED_ROCK_LIMITS, type CarvedRockPlan, type CarvedRockWall } from './contracts.js'
import { carvedArea, carvedPolygon, carvedUnion } from './geometry.js'

export interface CarvedRockPaintFacet {
  id: string; pointsMm: PointMm[]; fill: string; opacity: number; kind: 'wall' | 'stratum' | 'joint'
}
export interface CarvedRockPaintStroke { id: string; pointsMm: PointMm[]; color: string; widthMm: number; opacity: number }
export interface CarvedRockPaintPlan { facets: CarvedRockPaintFacet[]; strokes: CarvedRockPaintStroke[]; boundsMm: BoundsMm | null }
export interface CarvedRockPaintOptions { seed: string; topColor?: string; rockColor?: string; pathColor?: string }
const EPS = 1e-7
const key = (p: PointMm) => `${p.x},${p.y}`
const sample = (seed: string, label: string) => {
  let h = 2166136261
  const text = seed + '|' + label
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 0xffffffff
}
const color = (input: string | undefined, fallback: string, factor: number) => {
  const value = input ?? fallback
  if (!/^#[a-fA-F0-9]{6}$/.test(value)) throw Error('岩壁绘制颜色须为完整六位HEX。')
  const channels = [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(value.slice(i, i + 2), 16) * factor))))
  return '#' + channels.map(v => v.toString(16).padStart(2, '0')).join('')
}
const ring = (regions: MultiPolygon): PointMm[][] => regions.flatMap(polygon => polygon.map(values => {
  const result = values.map(([x, y]) => ({ x, y }))
  if (result.length > 1 && key(result[0]) === key(result.at(-1)!)) result.pop()
  return result
}))

/** Initial dynamic wall paint, not a naturalness/acceptance claim. It consumes
 * real high/low cut faces and keeps physics, sprite roots and world XY intact.
 * Decorative envelopes never become support, and never cover walkable width. */
export function createCarvedRockPaintPlan(input: CarvedRockPlan, rawOptions: CarvedRockPaintOptions): CarvedRockPaintPlan {
  const plan = captureJson(input), options = captureJson(rawOptions)
  if (typeof options.seed !== 'string' || options.seed.length > 1024) throw Error('岩壁绘制须使用有限固定种子。')
  if (plan.walls.length > CARVED_ROCK_LIMITS.rawSegments || plan.patches.length > CARVED_ROCK_LIMITS.faces * CARVED_ROCK_LIMITS.strips) throw Error('岩壁绘制超过完整面预算。')
  const all = [...plan.footprintMm, ...plan.walls.flatMap(w => [w.a, w.b])]
  if (all.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || plan.walls.some(w => [...w.highMm, ...w.lowMm, w.normal.x, w.normal.y].some(v => !Number.isFinite(v)))) throw Error('岩壁实际绘制几何须为有限值。')
  const host = carvedPolygon(plan.footprintMm)
  const walk = carvedUnion(plan.patches.filter(p => p.kind === 'walk').map(p => carvedPolygon(p.verticesMm)))
  // Only low-side cut/apron regions may receive an internal wall face. Top
  // regions remain exact; outer walls may extend a finite distance off-host.
  const outside = polygonClipping.difference(carvedPolygon([
    { x: Math.min(...all.map(p => p.x)) - 1000, y: Math.min(...all.map(p => p.y)) - 1000 },
    { x: Math.max(...all.map(p => p.x)) + 1000, y: Math.min(...all.map(p => p.y)) - 1000 },
    { x: Math.max(...all.map(p => p.x)) + 1000, y: Math.max(...all.map(p => p.y)) + 1000 },
    { x: Math.min(...all.map(p => p.x)) - 1000, y: Math.max(...all.map(p => p.y)) + 1000 },
  ]), host)
  const cut = carvedUnion(plan.cutFootprintsMm.map(carvedPolygon))
  const permitted = polygonClipping.difference(carvedUnion([outside, cut]), walk)
  interface Node { p: PointMm; nx: number; ny: number; depth: number; count: number }
  const nodes = new Map<string, Node>()
  const depth = (wall: CarvedRockWall, i: number) => Math.min(900, Math.max(0, wall.highMm[i] - wall.lowMm[i]) * .24)
  for (const wall of plan.walls) for (const [i, p] of [wall.a, wall.b].entries()) {
    const k = key(p), value = nodes.get(k) ?? { p, nx: 0, ny: 0, depth: 0, count: 0 }
    value.nx += wall.normal.x; value.ny += wall.normal.y; value.depth += depth(wall, i); value.count++; nodes.set(k, value)
  }
  const displacement = (p: PointMm, fraction: number) => {
    const n = nodes.get(key(p))!, magnitude = Math.hypot(n.nx, n.ny), divisor = magnitude > .1 ? magnitude : 1
    const amount = n.depth / n.count * (.88 + .24 * sample(options.seed, 'node-depth|' + key(p))) * fraction
    return { x: p.x + n.nx / divisor * amount, y: p.y + n.ny / divisor * amount }
  }
  const facets: CarvedRockPaintFacet[] = [], strokes: CarvedRockPaintStroke[] = []
  const emit = (id: string, points: PointMm[], kind: CarvedRockPaintFacet['kind'], fill: string, opacity: number) => {
    const clipped = polygonClipping.intersection(carvedPolygon(points), permitted)
    for (let i = 0; i < clipped.length; i++) {
      // A cut-out that acquires a hole is split by per-wall seam pieces. Do not
      // flatten the holes into filled rings and paint over a hidden walk strip.
      const polygon = clipped[i]
      if (polygon.length > 1) continue
      const p = ring([polygon])[0]
      if (p.length >= 3 && carvedArea([polygon]) > EPS) facets.push({ id: `${id}:${i}`, pointsMm: p, kind, fill, opacity })
    }
  }
  // Shared level fractions are host stable; node perturbation is reused on all
  // adjoining walls so rock strata terminate at the same seam, not tile edges.
  const levels = [0, .2 + .08 * sample(options.seed, 'stratum1'), .51 + .08 * sample(options.seed, 'stratum2'), .8 + .06 * sample(options.seed, 'stratum3'), 1]
  for (let index = 0; index < plan.walls.length; index++) {
    const wall = plan.walls[index], label = [key(wall.a), key(wall.b)].sort().join('|')
    const a = wall.a, b = wall.b, width = Math.hypot(b.x - a.x, b.y - a.y)
    if (width <= EPS) continue
    const maxHeight = Math.max(...wall.highMm.map((z, i) => z - wall.lowMm[i]))
    if (maxHeight <= EPS) continue
    const shade = .69 + .17 * sample(options.seed, 'mass|' + label) + .08 * Math.max(-1, Math.min(1, wall.normal.x * -.6 + wall.normal.y * -.8))
    emit(`wall:${label}`, [a, b, displacement(b, 1), displacement(a, 1)], 'wall', color(options.rockColor, '#827561', shade), 1)
    for (let j = 1; j < levels.length; j++) {
      const lower = levels[j - 1], upper = levels[j]
      const stagger = (sample(options.seed, `layer:${j}|${label}`) - .5) * .08
      emit(`stratum:${label}:${j}`, [displacement(a, lower), displacement(b, Math.max(0, lower + stagger)), displacement(b, Math.min(1, upper + stagger)), displacement(a, upper)],
        'stratum', color(options.rockColor, '#827561', shade + (j % 2 ? .06 : -.04)), .65)
    }
    // A bounded nonuniform joint fan comes from the face's real end heights.
    // It is a narrow fracture facet, not transverse walkable staircase treads.
    const jointCount = Math.min(3, Math.floor(width / 1400))
    for (let j = 0; j < jointCount; j++) {
      const t = (j + .25 + .5 * sample(options.seed, `joint:${label}:${j}`)) / jointCount
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const q = { x: a.x + (b.x - a.x) * Math.min(1, t + .018), y: a.y + (b.y - a.y) * Math.min(1, t + .018) }
      const da = displacement(a, .8), db = displacement(b, .8), end = { x: da.x + (db.x - da.x) * t, y: da.y + (db.y - da.y) * t }
      emit(`joint:${label}:${j}`, [p, q, end], 'joint', color(options.rockColor, '#827561', .47), .58)
    }
  }
  const points = facets.flatMap(f => f.pointsMm)
  const boundsMm = points.length ? { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
    width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) } : null
  return freezeJson({ facets, strokes, boundsMm })
}
