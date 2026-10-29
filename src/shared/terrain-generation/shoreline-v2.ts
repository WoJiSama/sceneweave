import type { PointMm } from '../model/scene.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'
import type { CubicSegment } from '../visual/types.js'

/** A single-valued sand coast uses monotone Hermite tangents: broad extrema
 * stay round and interpolation cannot overshoot the neighbouring shore heights. */
export function sandCoastSegmentsV2(id: string, points: PointMm[]): CubicSegment[] {
  const widths = points.slice(1).map((point, index) => point.x - points[index].x)
  if (widths.some(width => width <= 0)) throw new Error('沙岸骨架必须沿世界X严格递增。')
  const secants = widths.map((width, index) => (points[index + 1].y - points[index].y) / width)
  const slopes = points.map((_, index) => {
    if (index === 0) return secants[0]
    if (index === points.length - 1) return secants.at(-1)!
    const before = secants[index - 1], after = secants[index]
    if (before * after <= 0) return 0
    const a = 2 * widths[index] + widths[index - 1], b = widths[index] + 2 * widths[index - 1]
    return (a + b) / (a / before + b / after)
  })
  const position = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) })
  return widths.map((width, index) => ({ id: `${id}-c${index}`, start: { ...points[index] }, end: { ...points[index + 1] },
    control1: position(points[index].x + width / 3, points[index].y + slopes[index] * width / 3),
    control2: position(points[index + 1].x - width / 3, points[index + 1].y - slopes[index + 1] * width / 3) }))
}

/** Version 2 fixes the broad cape/cove skeleton before adding small rock noise.
 * These anchors are part of the algorithm contract; old recipes keep v1. */
export function shorelineFieldV2(input: { kind: string; seed: string; widthMm: number; heightMm: number }, variant: number, bay: PointMm, radii: { rx: number; ry: number }): (x: number, y: number) => number {
  const { seed, widthMm: width, heightMm: height } = input
  if (input.kind === 'island') {
    // One deep inlet and two shoulders. Avoid many competing teeth, which
    // consume the actual sampling budget without preserving a readable bay.
    const profile = [.52, 1.1, 1, 1.03, 1.06, .97, 1.04, 1.12]
    const radiiAt = profile.map((radius, index) => radius * (.96 + .08 * terrainRandomUnit(seed, `shore-v2/anchor/${index}`)))
    return (x, y) => {
      const dx = (x - width * .5) / (width * radii.rx), dy = (y - height * .5) / (height * radii.ry)
      const along = dx * bay.x + dy * bay.y, across = dx * bay.y - dy * bay.x
      const slot = ((Math.atan2(across, along) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * profile.length
      const index = Math.floor(slot), t = slot - index, start = radiiAt[index], end = radiiAt[(index + 1) % profile.length]
      const noise = terrainValueNoise(seed, 'shore-v2/rock', x / (width * .12), y / (height * .12)) * .018
      return Math.round((start + (end - start) * t - Math.hypot(dx, dy) + noise) * 1000000) / 1000000
    }
  }
  const anchors = [[0, .35], [.12, .39], [.26, .45], [.36, .37], [.47, .38], [.61, .28], [.72, .31], [.84, .37], [1, .32]]
  return (x, y) => {
    const u = x / width
    let index = 0
    while (index + 2 < anchors.length && u > anchors[index + 1][0]) index++
    const a = anchors[index], b = anchors[index + 1], q = (u - a[0]) / (b[0] - a[0]), t = q * q * (3 - 2 * q)
    const shore = height * (a[1] + (b[1] - a[1]) * t + (variant - 2) * .012 + terrainValueNoise(seed, 'shore-v2/sand', u * 9, .37) * .008)
    return Math.round(y - shore)
  }
}
