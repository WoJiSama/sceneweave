import type { PointMm } from '../model/scene.js'
import { assertSimpleVisualPolyline, signedVisualArea } from '../visual/geometry.js'

/** Fixed non-cryptographic integer hash for named geometry streams. */
export function terrainHash32(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193)
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b)
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35)
  return (value ^ value >>> 16) >>> 0
}
export const terrainRandomUnit = (seed: string, feature: string): number => terrainHash32(`${seed}\0${feature}`) / 4294967296
const smooth = (value: number) => value * value * (3 - 2 * value)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Integer lattice values, smooth interpolation; no sequential shared PRNG state. */
export function terrainValueNoise(seed: string, feature: string, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy)
  const at = (dx: number, dy: number) => terrainRandomUnit(seed, `${feature}/${ix + dx}/${iy + dy}`) * 2 - 1
  return lerp(lerp(at(0, 0), at(1, 0), fx), lerp(at(0, 1), at(1, 1), fx), fy)
}

export interface TerrainContour { points: PointMm[]; closed: boolean }
export interface TerrainGridOptions { widthMm: number; heightMm: number; columns: number; rows: number }
type ContourNode = { point: PointMm; neighbors: string[] }

/** Bounded marching squares. Saddle ties use the centre mean, then the fixed case table. */
export function extractTerrainContours(options: TerrainGridOptions, field: (x: number, y: number) => number): TerrainContour[] {
  const { columns, rows, widthMm, heightMm } = options
  if (![columns, rows].every(value => Number.isSafeInteger(value) && value >= 2 && value <= 256)
    || ![widthMm, heightMm].every(value => Number.isSafeInteger(value) && value > 0) || (columns + 1) * (rows + 1) > 65536) throw new Error('地形临时格网超过固定65536采样预算。')
  const values = new Float64Array((columns + 1) * (rows + 1)), nodes = new Map<string, ContourNode>()
  const index = (x: number, y: number) => y * (columns + 1) + x
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const value = field(x * widthMm / columns, y * heightMm / rows)
    if (!Number.isFinite(value)) throw new Error('地形场含非有限值。')
    values[index(x, y)] = value
  }
  const edgeNode = (x: number, y: number, edge: number): string => {
    const coordinates = edge === 0 ? [x, y, x + 1, y] : edge === 1 ? [x + 1, y, x + 1, y + 1] : edge === 2 ? [x, y + 1, x + 1, y + 1] : [x, y, x, y + 1]
    const [ax, ay, bx, by] = coordinates, key = `${index(ax, ay)}:${index(bx, by)}`
    if (!nodes.has(key)) {
      const a = values[index(ax, ay)], b = values[index(bx, by)], t = a === b ? .5 : Math.max(0, Math.min(1, a / (a - b)))
      nodes.set(key, { point: { x: Math.round(lerp(ax, bx, t) * widthMm / columns), y: Math.round(lerp(ay, by, t) * heightMm / rows) }, neighbors: [] })
    }
    return key
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const v = [values[index(x, y)], values[index(x + 1, y)], values[index(x + 1, y + 1)], values[index(x, y + 1)]]
    const code = v.reduce((mask, value, corner) => mask | (value >= 0 ? 1 << corner : 0), 0), centrePositive = v.reduce((a, b) => a + b, 0) >= 0
    const table: Record<number, number[][]> = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: centrePositive ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]],
      6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: centrePositive ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]] }
    for (const [edgeA, edgeB] of table[code] ?? []) {
      const a = edgeNode(x, y, edgeA), b = edgeNode(x, y, edgeB)
      nodes.get(a)!.neighbors.push(b); nodes.get(b)!.neighbors.push(a)
    }
  }
  if ([...nodes.values()].some(node => node.neighbors.length < 1 || node.neighbors.length > 2)) throw new Error('地形等值线存在不能唯一解析的分支。')
  const remaining = new Set(nodes.keys()), result: TerrainContour[] = [], compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  while (remaining.size) {
    const keys = [...remaining].sort(compare), start = keys.find(key => nodes.get(key)!.neighbors.length === 1) ?? keys[0]
    const points: PointMm[] = []; let previous = '', current = start, closed = false
    while (true) {
      if (!remaining.delete(current)) { if (current === start) { closed = true; break } throw new Error('地形等值线意外重用分支。') }
      const node = nodes.get(current)!, point = node.point
      if (!points.length || points.at(-1)!.x !== point.x || points.at(-1)!.y !== point.y) points.push({ ...point })
      const next = [...node.neighbors].sort(compare).find(key => key !== previous)
      if (!next) break
      previous = current; current = next
    }
    if (closed && points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop()
    assertSimpleVisualPolyline(points, closed)
    if (closed && signedVisualArea(points) < 0) points.reverse()
    if (!closed && points[0].x > points.at(-1)!.x) points.reverse()
    result.push({ points, closed })
  }
  return result.sort((a, b) => Math.abs(signedVisualArea(b.points)) - Math.abs(signedVisualArea(a.points)))
}

export function distanceToTerrainSegment(point: PointMm, a: PointMm, b: PointMm): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}
function simplifyOpen(points: PointMm[], errorMm: number): PointMm[] {
  if (points.length <= 2) return points.map(point => ({ ...point }))
  let farthest = -1, distance = errorMm
  for (let index = 1; index < points.length - 1; index++) {
    const current = distanceToTerrainSegment(points[index], points[0], points.at(-1)!)
    if (current > distance) { distance = current; farthest = index }
  }
  return farthest < 0 ? [{ ...points[0] }, { ...points.at(-1)! }]
    : [...simplifyOpen(points.slice(0, farthest + 1), errorMm).slice(0, -1), ...simplifyOpen(points.slice(farthest), errorMm)]
}

/** RDP with deterministic extreme anchors. Hard open ports are preserved exactly. */
export function simplifyTerrainContour(contour: TerrainContour, errorMm: number): PointMm[] {
  if (!(errorMm > 0) || !Number.isFinite(errorMm)) throw new Error('轮廓简化误差必须为有限正值。')
  if (!contour.closed) return simplifyOpen(contour.points, errorMm)
  let first = 0
  for (let index = 1; index < contour.points.length; index++) if (contour.points[index].x < contour.points[first].x || contour.points[index].x === contour.points[first].x && contour.points[index].y < contour.points[first].y) first = index
  const ring = [...contour.points.slice(first), ...contour.points.slice(0, first)]
  let farthest = 1, maximum = -1
  for (let index = 1; index < ring.length; index++) {
    const square = (ring[index].x - ring[0].x) ** 2 + (ring[index].y - ring[0].y) ** 2
    if (square > maximum) { maximum = square; farthest = index }
  }
  const result = [...simplifyOpen(ring.slice(0, farthest + 1), errorMm).slice(0, -1), ...simplifyOpen([...ring.slice(farthest), ring[0]], errorMm).slice(0, -1)]
  assertSimpleVisualPolyline(result, true)
  return result
}
