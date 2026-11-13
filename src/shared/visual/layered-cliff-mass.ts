import type { PointMm } from '../model/scene.js'
import { naturalCliffMass, type NaturalCliffMass } from './natural-cliff-mass.js'

export interface LayeredCliffMass extends NaturalCliffMass {
  benches: { top: PointMm[]; front: PointMm[]; edge: PointMm[]; depth: number; shade: number }[]
}

/** Explicit stratified-rock recipe. The previously saved natural mass remains
 * unchanged; shared height ownership and physical openings are applied later. */
export function layeredCliffMass(lengthMm: number, at: (distance: number, depth: number) => PointMm,
  seed: string, repeatMm: number): LayeredCliffMass {
  const base = naturalCliffMass(lengthMm, at, seed, repeatMm)
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  const anchor = at(0, 0)
  hash ^= Math.imul(Math.round(anchor.x), 73856093) ^ Math.imul(Math.round(anchor.y), 19349663)
  const random = (i: number, channel: number) => {
    let h = hash ^ Math.imul(i + 1, 73856093) ^ Math.imul(channel + 1, 19349663)
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15
    return (h >>> 0) / 4294967296
  }
  const spacing = Math.max(850, repeatMm * 2.8)
  const result: LayeredCliffMass = { ...base, benches: [] }
  result.planes = base.planes.map((plane, i) => ({ ...plane, shade: plane.depth < 0 ? plane.shade : .88 + random(i, 220) * .22 }))
  let plannedPoints = base.planes.reduce((n, a) => n + a.points.length, 0) + base.shelves.reduce((n, a) => n + a.points.length, 0)
    + base.creases.concat(base.lips, base.joints).reduce((n, a) => n + a.length, 0)
  const sample = (s: number, depth: number) => {
    const point = at(s, depth)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('层岩弧长查询返回无效坐标。')
    return point
  }
  // Broad rock benches have their own staggered lengths. A shelf's horizontal
  // top and short recessed front explain volume without turning every depth
  // into one smooth, concentric bevel around the terrain.
  for (let row = 0; row < 4; row++) {
    let station = -spacing * random(row, 201), index = 0
    while (station < lengthMm) {
      const id = row * 4096 + index++, span = spacing * (.82 + random(id, 202) * .9)
      const start = Math.max(0, station), end = Math.min(lengthMm, station + span * (.87 + random(id, 203) * .11))
      station += span
      if (end - start < 50 || random(id, 204) < .24) continue
      const depth = [-.56, -.08, .38, .79][row] + (random(id, 205) - .5) * .12
      const thickness = .035 + random(id, 206) * .045, width = .12 + random(id, 207) * .10
      const segments = Math.max(3, Math.ceil((end - start) / 140))
      plannedPoints += (segments + 1) * 5
      if (plannedPoints > 131072) throw new Error('自然断岩岩台超过有限绘制点预算。')
      const front: PointMm[] = [], back: PointMm[] = [], foot: PointMm[] = []
      for (let k = 0; k <= segments; k++) {
        const t = k / segments, d = start + (end - start) * t
        const wobble = (random(id * 32 + k, 208) - .5) * .032 + Math.sin(t * Math.PI) * (random(id, 209) - .5) * .09
        const inset = (Math.abs(t - .5) * 2) ** 5 * (.05 + random(id, 210) * .06)
        front.push(sample(d, depth + wobble - inset))
        foot.push(sample(d, depth + wobble - inset + thickness))
        back.push(sample(d, depth + wobble - width + inset * .5))
      }
      result.benches.push({ top: [...back, ...[...front].reverse()], front: [...front, ...foot.reverse()], edge: front,
        depth, shade: .94 + random(id, 211) * .11 })
    }
  }
  return result
}
