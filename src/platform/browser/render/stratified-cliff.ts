import type { PointMm } from '../../../shared/model/scene.js'
import { terrainRandomUnit, terrainValueNoise } from '../../../shared/terrain-generation/field.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'

type Quad = [PointMm, PointMm, PointMm, PointMm]
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Jointed slabs run from crest to toe. Their inclined fractures persist
 * through several beds, while the exposed ledges stop against the fractures. */
export function cliffStrata(look: VisualEdgeLook, a: PointMm, b: PointMm, riseMm: number) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const material = (key: string) => terrainRandomUnit(look.seed, `${a.x},${a.y}/${key}`)
  const count = Math.min(16, Math.max(1, Math.round(length / (340 + material('spacing') * 340))))
  const joints = Array.from({ length: count + 1 }, (_, i) => {
    const u = i === 0 || i === count ? i / count : (i + (material(`cut/${i}`) - .5) * .55) / count
    const x = mix(a.x, b.x, u), y = mix(a.y, b.y, u)
    const dip = terrainValueNoise(look.seed, 'fault direction', x / 2300, y / 1800)
    const shift = i === 0 || i === count ? 0 : (.24 * dip + .38 * (material(`tilt/${i}`) - .5)) / count
    const mid = .47 + .32 * terrainValueNoise(look.seed, 'broken beds', x / 490, y / 880)
    return [{ x: u, y: 0 }, { x: u + shift, y: mid }, { x: u + shift * .48, y: 1 }]
  })
  const pieces: { corners: Quad; tone: number; seam: boolean }[] = []
  const between = (l: PointMm, r: PointMm, t: number) => ({ x: mix(l.x, r.x, t), y: mix(l.y, r.y, t) })
  for (let i = 0; i < count; i++) {
    const l = joints[i], r = joints[i + 1], tone = .26 + .26 * material(`slab/${i}`)
    const exposesBed = material(`shelf/${i}`) < Math.min(.72, riseMm / 3500)
    for (let row = 0; row < 2; row++) {
      const j = row + 1, dark = .04 + material(`shadow/${i}/${row}`) * .13
      const top = between(l[row], r[row], .64 + material(`edge/${i}`) * .28)
      const bottom = between(l[j], r[j], row ? .93 : .63 + material(`kink/${i}`) * .18)
      const faceTone = tone + row * (exposesBed ? .29 : .09)
      pieces.push({ corners: [l[row], top, bottom, l[j]], tone: faceTone, seam: false },
        { corners: [top, r[row], r[j], bottom], tone: faceTone + dark, seam: true })
      // Short mineral veins and spalled corners interrupt the larger planes.
      // Keep their ends inside this slab so a change of face breaks the line.
      const rockPoint = (along: number, down: number) => between(between(l[row], r[row], along), between(l[j], r[j], along), down)
      for (let k = 0; k < 3; k++) {
        const u = .04 + material(`vein/${i}/${row}/${k}`) * .41
        const v = .15 + .28 * k, span = .16 + .35 * material(`chip/${i}/${row}/${k}`)
        pieces.push({ corners: [rockPoint(u, v), rockPoint(u + span * .66, v - .08), rockPoint(u + span, v - .044),
          rockPoint(u + span * .48, v + (k === 1 ? .10 : .028))], tone: faceTone + (k === 1 ? -.11 : .14), seam: false })
      }
    }
  }
  return pieces
}

export function strataColor(look: VisualEdgeLook, tone: number, shade: number) {
  const depth = Math.max(0, Math.min(1, tone)), channel = (offset: number) => {
    const pale = Number.parseInt(look.accentColor.slice(offset, offset + 2), 16)
    const dark = Number.parseInt(look.color.slice(offset, offset + 2), 16)
    return Math.max(0, Math.min(255, Math.round(mix(pale, dark, depth) * shade)))
  }
  return [1, 3, 5].map(offset => channel(offset).toString(16).padStart(2, '0')).reduce((value, digit) => value + digit, '#')
}
