import type { PointMm } from '../../shared/model/scene.js'

export interface CompareRect { x: number; y: number; width: number; height: number }
export interface ArtStyleDivider { x: number; y: number; angle: number }
export const INITIAL_ART_STYLE_DIVIDER: ArtStyleDivider = { x: .5, y: .5, angle: 0 }

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))
export function moveArtStyleDivider(line: ArtStyleDivider, x: number, y: number, area: CompareRect): ArtStyleDivider {
  const marginX = Math.min(.2, 20 / area.width), marginY = Math.min(.2, 20 / area.height)
  return { ...line, x: clamp(x, marginX, 1 - marginX), y: clamp(y, marginY, 1 - marginY) }
}

export function artStyleDividerGeometry(line: ArtStyleDivider, area: CompareRect) {
  const pivot = { x: area.x + area.width * line.x, y: area.y + area.height * line.y }
  const radians = line.angle * Math.PI / 180, normal = { x: Math.cos(radians), y: Math.sin(radians) }
  const tangent = { x: -normal.y, y: normal.x }
  const distance = (point: PointMm) => (point.x - pivot.x) * normal.x + (point.y - pivot.y) * normal.y
  const extent = (direction: PointMm) => Math.min(
    Math.abs(direction.x) <= 1e-9 ? Infinity : ((direction.x < 0 ? area.x : area.x + area.width) - pivot.x) / direction.x,
    Math.abs(direction.y) <= 1e-9 ? Infinity : ((direction.y < 0 ? area.y : area.y + area.height) - pivot.y) / direction.y,
  )
  const ends = [-1, 1].map(side => {
    const d = extent({ x: tangent.x * side, y: tangent.y * side })
    return { x: pivot.x + side * tangent.x * d, y: pivot.y + side * tangent.y * d, distance: d }
  })
  const at = (steps: number) => ({ x: pivot.x + tangent.x * steps, y: pivot.y + tangent.y * steps })
  const inset = (length: number) => Math.min(22, length * .4)
  const handles = [at(inset(ends[0].distance) - ends[0].distance), at(ends[1].distance - inset(ends[1].distance))]
  return { pivot, normal, distance, ends, handles }
}

export function artStyleClip(line: ArtStyleDivider, area: CompareRect, image: CompareRect, before: boolean): string {
  const { distance } = artStyleDividerGeometry(line, area)
  const corners = [{ x: image.x, y: image.y }, { x: image.x + image.width, y: image.y }, { x: image.x + image.width, y: image.y + image.height }, { x: image.x, y: image.y + image.height }]
  const points: PointMm[] = []
  for (const [index, start] of corners.entries()) {
    const end = corners[(index + 1) % corners.length], side = before ? 1 : -1, a = distance(start) * side, b = distance(end) * side
    if (a <= 0) points.push(start)
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const t = a / (a - b)
      points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t })
    }
  }
  return points.length < 3 ? 'inset(0 100% 0 0)' : `polygon(${points.map(p => `${(p.x - image.x) / image.width * 100}% ${(p.y - image.y) / image.height * 100}%`).join(', ')})`
}
