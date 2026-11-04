import type { PointMm } from '../model/scene.js'
import { terrainRandomUnit } from './field.js'

const point = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })

/** A broad upper shoulder and a second activity shelf are joined by an offset
 * neck. Unlike a radial profile, the east inlet can turn behind its shoulder.
 * All positions are owned by this version, not reconstructed from a bitmap. */
export function islandSkeletonV3(input: { seed: string; widthMm: number; heightMm: number }, variant: number) {
  const { seed, widthMm: width, heightMm: height } = input
  const mirrorX = variant === 1 || variant === 3, mirrorY = variant === 2 || variant === 4
  const transform = (x: number, y: number) => point((mirrorX ? 1 - x : x) * width, (mirrorY ? 1 - y : y) * height)
  const anchors = [[.21, .16], [.38, .09], [.48, .19], [.63, .12], [.82, .22], [.85, .40], [.68, .50], [.56, .44], [.51, .35], [.43, .39],
    [.39, .51], [.49, .63], [.57, .75], [.45, .89], [.27, .82], [.21, .66], [.30, .52], [.24, .42], [.12, .33]]
  const ring = anchors.map(([x, y], index) => transform(x + (terrainRandomUnit(seed, `shore-v3/main/${index}/x`) - .5) * .018,
    y + (terrainRandomUnit(seed, `shore-v3/main/${index}/y`) - .5) * .018))
  const field = (x: number, y: number): number => {
    let inside = false, distance = Infinity
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i], dx = b.x - a.x, dy = b.y - a.y
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
      distance = Math.min(distance, Math.hypot(x - a.x - dx * t, y - a.y - dy * t))
    }
    return (inside ? 1 : -1) * distance
  }
  const scale = Math.min(width / 24000, height / 18000)
  const plateauCenter = transform(.35, .28)
  const ridge = [[.285, .275, 1600], [.35, .28, 2200], [.42, .29, 1500]].map(([x, y, radius]) => ({ ...transform(x, y), radius: radius * scale }))
  const reefs = [[.12, .12, .034, .038], [.85, .68, .048, .055]].map(([x, y, rx, ry], reefIndex) => {
    const phase = terrainRandomUnit(seed, `shore-v3/reef/${reefIndex}/phase`) * Math.PI * 2
    return Array.from({ length: 5 }, (_, index) => {
      const angle = phase + index * Math.PI * 2 / 5, radius = .86 + terrainRandomUnit(seed, `shore-v3/reef/${reefIndex}/${index}`) * .24
      return transform(x + Math.cos(angle) * rx * radius, y + Math.sin(angle) * ry * radius)
    })
  })
  const bayLength = Math.hypot(1, .15)
  const bayDirection = { x: (mirrorX ? -1 : 1) / bayLength, y: (mirrorY ? -.15 : .15) / bayLength }
  return { field, plateauCenter, ridge, reefs, bayDirection,
    name: `${mirrorY ? '南' : '北'}肩${mirrorX ? '西' : '东'}湾岩岛` }
}
