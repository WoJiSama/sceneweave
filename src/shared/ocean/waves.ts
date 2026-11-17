import type { BoundsMm, PointMm } from '../model/scene.js'
import { OCEAN_LIMITS, type WaterSurface } from './contracts.js'

/** World-anchored sampling: editor crop/zoom and PNG resolution cannot re-seed waves. */
export function waveGrid(points: readonly PointMm[], water: WaterSurface) {
  const angle = water.waveDirectionDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const local = points.map(p => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }))
  const step = water.waveSpacingMm
  const x0 = Math.floor(Math.min(...local.map(p => p.x)) / step) - 1, x1 = Math.ceil(Math.max(...local.map(p => p.x)) / step) + 1
  const y0 = Math.floor(Math.min(...local.map(p => p.y)) / step) - 1, y1 = Math.ceil(Math.max(...local.map(p => p.y)) / step) + 1
  return { x0, x1, y0, y1, c, s, step, cells: (x1 - x0 + 1) * (y1 - y0 + 1) }
}
function seedHash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return h >>> 0
}
function random(seed: number, x: number, y: number, salt: number): number {
  let h = Math.imul(seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt, 1274126177)
  h = Math.imul(h ^ h >>> 16, 2246822519)
  return (h ^ h >>> 13) >>> 0
}
export interface OceanWave { start: PointMm; control: PointMm; end: PointMm; strength: number; widthMm: number }
export function oceanWaves(points: readonly PointMm[], water: WaterSurface, crop?: BoundsMm): OceanWave[] {
  const g = waveGrid(points, water)
  if (!Number.isFinite(g.cells) || g.cells > OCEAN_LIMITS.cellsPerSurface) throw new Error('海面浪纹超过单面4096采样格保护值，请增大浪间距。')
  const result: OceanWave[] = [], seed = seedHash(water.seed)
  const world = (x: number, y: number): PointMm => ({ x: x * g.c - y * g.s, y: x * g.s + y * g.c })
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    const noise = (salt: number) => random(seed, x, y, salt) / 4294967296
    if (noise(17) < .27) continue
    const px = (x + noise(23) * .7) * g.step, py = (y + noise(41) * .7) * g.step
    const length = g.step * (.23 + noise(71) * .63), bend = g.step * (.025 + noise(131) * .07)
    const start = world(px, py), end = world(px + length, py + bend * .3), control = world(px + length * .52, py - bend)
    const pad = g.step * .08
    if (crop && (Math.max(start.x, end.x, control.x) + pad < crop.x || Math.min(start.x, end.x, control.x) - pad > crop.x + crop.width || Math.max(start.y, end.y, control.y) + pad < crop.y || Math.min(start.y, end.y, control.y) - pad > crop.y + crop.height)) continue
    result.push({ start, control, end, strength: .25 + noise(173) * .65, widthMm: 12 + noise(211) * 28 })
  }
  return result
}
