import type { ImagePoint } from './calibration.js'
import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'

export interface ImageSelectionStroke {
  readonly points: readonly ImagePoint[]
  readonly radiusPx: number
  readonly mode: 'keep' | 'remove'
}

const MAX_SELECTION_PIXELS = 1_000_000
const MAX_POINTS = 4096
const MAX_PAINT_WORK = 16_000_000
const MAX_SNAP_WORK = 8_000_000

function checkImage(image: ImagePixels): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('选区需要完整RGBA原图，边长不超过8192且总量不超过3200万像素。')
  }
}

function checkPoints(image: ImagePixels, points: readonly ImagePoint[], minimum = 1): void {
  if (!Array.isArray(points) || points.length < minimum || points.length > MAX_POINTS) throw new Error(`笔迹需要${minimum}至4096个点。`)
  for (const point of points) if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) throw new Error('笔迹点超出原图范围。')
}

function checkMask(image: ImagePixels, mask: ImagePixelMask): void {
  const bounds = mask.boundsPx
  if (!bounds || ![mask.width, mask.height, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)
    || mask.width < 1 || mask.height < 1 || mask.width !== bounds.width || mask.height !== bounds.height
    || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height
    || mask.width * mask.height > MAX_SELECTION_PIXELS || !(mask.data instanceof Uint8Array)
    || mask.data.length !== mask.width * mask.height) throw new Error('像素选区无效或超过100万像素，请缩小编辑范围。')
}

function distanceToSegment(x: number, y: number, a: ImagePoint, b: ImagePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / squared)) : 0
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy)
}

/** Continuous capsule strokes change coverage only. RGB, original masks and earlier undo states are untouched. */
export function paintImageSelection(image: ImagePixels, mask: ImagePixelMask, stroke: ImageSelectionStroke): ImagePixelMask {
  checkImage(image); checkMask(image, mask); checkPoints(image, stroke.points)
  if (!Number.isFinite(stroke.radiusPx) || stroke.radiusPx < .5 || stroke.radiusPx > 128
    || stroke.mode !== 'keep' && stroke.mode !== 'remove') throw new Error('选区画笔需要0.5至128像素半径及保留或排除模式。')
  const radius = stroke.radiusPx, points = stroke.points
  const strokeBounds = {
    x: Math.max(0, Math.floor(Math.min(...points.map(point => point.x)) - radius - .5)),
    y: Math.max(0, Math.floor(Math.min(...points.map(point => point.y)) - radius - .5)),
    right: Math.min(image.width, Math.ceil(Math.max(...points.map(point => point.x)) + radius + .5)),
    bottom: Math.min(image.height, Math.ceil(Math.max(...points.map(point => point.y)) + radius + .5)),
  }
  const previous = mask.boundsPx, hasPixels = mask.data.some(value => value !== 0)
  const bounds: PixelBounds = stroke.mode === 'remove' ? { ...previous } : {
    x: hasPixels ? Math.min(previous.x, strokeBounds.x) : strokeBounds.x,
    y: hasPixels ? Math.min(previous.y, strokeBounds.y) : strokeBounds.y,
    width: 0, height: 0,
  }
  if (stroke.mode === 'keep') {
    bounds.width = Math.max(hasPixels ? previous.x + previous.width : 0, strokeBounds.right) - bounds.x
    bounds.height = Math.max(hasPixels ? previous.y + previous.height : 0, strokeBounds.bottom) - bounds.y
  }
  if (bounds.width * bounds.height > MAX_SELECTION_PIXELS) throw new Error('画笔后的选区超过100万像素，请缩小范围。')
  const data = new Uint8Array(bounds.width * bounds.height)
  if (hasPixels) for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    data[(previous.y + y - bounds.y) * bounds.width + previous.x + x - bounds.x] = mask.data[y * mask.width + x]
  }
  let work = 0
  const capsule = (a: ImagePoint, b: ImagePoint) => {
    const left = Math.max(bounds.x, Math.floor(Math.min(a.x, b.x) - radius - .5))
    const top = Math.max(bounds.y, Math.floor(Math.min(a.y, b.y) - radius - .5))
    const right = Math.min(bounds.x + bounds.width, Math.ceil(Math.max(a.x, b.x) + radius + .5))
    const bottom = Math.min(bounds.y + bounds.height, Math.ceil(Math.max(a.y, b.y) + radius + .5))
    work += Math.max(0, right - left) * Math.max(0, bottom - top)
    if (work > MAX_PAINT_WORK) throw new Error('笔迹计算超过本次预算，请分成较短的笔画。')
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const coverage = Math.round(Math.max(0, Math.min(1, radius + .5 - distanceToSegment(x + .5, y + .5, a, b))) * 255)
      const index = (y - bounds.y) * bounds.width + x - bounds.x
      data[index] = stroke.mode === 'keep' ? Math.max(data[index], coverage) : Math.min(data[index], 255 - coverage)
    }
  }
  if (points.length === 1) capsule(points[0], points[0])
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], length = Math.hypot(b.x - a.x, b.y - a.y)
    // Short capsules avoid scanning the large empty rectangle of a diagonal drag.
    const steps = Math.max(1, Math.ceil(length / Math.max(8, radius * 2)))
    for (let step = 0; step < steps; step++) capsule(
      { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps },
      { x: a.x + (b.x - a.x) * (step + 1) / steps, y: a.y + (b.y - a.y) * (step + 1) / steps })
  }
  return { width: bounds.width, height: bounds.height, boundsPx: bounds, data }
}

function resample(points: readonly ImagePoint[], closed: boolean): ImagePoint[] {
  const vertices = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  if (closed && vertices.length > 1 && vertices[0].x === vertices.at(-1)!.x && vertices[0].y === vertices.at(-1)!.y) vertices.pop()
  const lengths: number[] = [], cumulative = [0]
  const segments = closed ? vertices.length : vertices.length - 1
  for (let index = 0; index < segments; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    lengths.push(length); cumulative.push(cumulative.at(-1)! + length)
  }
  const total = cumulative.at(-1)!
  if (!total || vertices.length < (closed ? 3 : 2)) throw new Error('磁性轮廓需要不同的有效取点。')
  if (total > 50_000) throw new Error('轮廓笔迹过长，请收窄物件范围。')
  const count = Math.min(MAX_POINTS, Math.max(closed ? 3 : 2, Math.ceil(total / 1.25) + (closed ? 0 : 1)))
  let segment = 0
  return Array.from({ length: count }, (_, index) => {
    const distance = total * index / (closed ? count : count - 1)
    while (segment < segments - 1 && cumulative[segment + 1] < distance) segment++
    const a = vertices[segment], b = vertices[(segment + 1) % vertices.length]
    const t = Math.min(1, (distance - cumulative[segment]) / lengths[segment])
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  })
}

function sample(image: ImagePixels, x: number, y: number, channel: number): number {
  const px = Math.max(0, Math.min(image.width - 1, x - .5)), py = Math.max(0, Math.min(image.height - 1, y - .5))
  const left = Math.floor(px), top = Math.floor(py), right = Math.min(image.width - 1, left + 1), bottom = Math.min(image.height - 1, top + 1)
  const fx = px - left, fy = py - top, pixel = (column: number, row: number) => image.data[(row * image.width + column) * 4 + channel]
  return (pixel(left, top) * (1 - fx) + pixel(right, top) * fx) * (1 - fy)
    + (pixel(left, bottom) * (1 - fx) + pixel(right, bottom) * fx) * fy
}

/** A local magnetic band: source colour edges compete with distance and continuity, never a full-image line search. */
export function snapImageContour(image: ImagePixels, points: readonly ImagePoint[], options: { radiusPx?: number; closed?: boolean } = {}): ImagePoint[] {
  checkImage(image)
  const closed = options.closed ?? true, radius = options.radiusPx ?? 6
  checkPoints(image, points, closed ? 3 : 2)
  if (!Number.isInteger(radius) || radius < 1 || radius > 32) throw new Error('磁性吸附半径须为1至32个原图像素。')
  const path = resample(points, closed), width = radius * 2 + 1, count = path.length
  // Three possible seam starts, seven neighbours per candidate, all bounded before allocation/work.
  if (count * width * 7 * 3 > MAX_SNAP_WORK) throw new Error('磁性轮廓计算超过预算，请缩小吸附半径或选区。')
  const normals = path.map((point, index) => {
    const before = path[index ? index - 1 : closed ? count - 1 : 0]
    const after = path[index + 1 < count ? index + 1 : closed ? 0 : count - 1]
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1
    return { x: -(after.y - before.y) / length, y: (after.x - before.x) / length }
  })
  const costs = new Float64Array(count * width), valid = new Uint8Array(count * width)
  let maximumEdge = 0
  for (let index = 0; index < count; index++) for (let column = 0; column < width; column++) {
    const offset = column - radius, normal = normals[index], x = path[index].x + normal.x * offset, y = path[index].y + normal.y * offset
    const cell = index * width + column
    if (x < 0 || y < 0 || x > image.width || y > image.height) { costs[cell] = Infinity; continue }
    valid[cell] = 1
    let difference = 0
    for (let channel = 0; channel < 4; channel++) {
      const delta = (sample(image, x + normal.x * .8, y + normal.y * .8, channel)
        - sample(image, x - normal.x * .8, y - normal.y * .8, channel)) / 255
      difference += delta * delta * (channel === 3 ? 1 : 1 / 3)
    }
    const contrast = Math.sqrt(difference), edge = Math.max(0, Math.min(1, (contrast - .06) / .24))
    maximumEdge = Math.max(maximumEdge, edge)
    // Saturation prevents a distant black furniture detail from winning solely by being darker.
    costs[cell] = Math.abs(offset) * .1 + .4 * (offset / radius) ** 2 - edge * 2
  }
  if (maximumEdge < .01) return points.map(point => ({ x: point.x, y: point.y }))
  const starts = [...Array(width).keys()].filter(column => valid[column])
    .sort((a, b) => costs[a] - costs[b] || Math.abs(a - radius) - Math.abs(b - radius) || a - b).slice(0, 2)
  if (valid[radius] && !starts.includes(radius)) starts.push(radius)
  let bestScore = Infinity, bestColumns: number[] | null = null
  for (const start of starts) {
    let previous = new Float64Array(width).fill(Infinity)
    previous[start] = costs[start]
    const parents = new Int16Array(count * width).fill(-1)
    for (let index = 1; index < count; index++) {
      const next = new Float64Array(width).fill(Infinity)
      for (let column = 0; column < width; column++) {
        if (!valid[index * width + column]) continue
        for (let candidate = Math.max(0, column - 3); candidate <= Math.min(width - 1, column + 3); candidate++) {
          const score = previous[candidate] + .12 * (column - candidate) ** 2 + costs[index * width + column]
          if (score < next[column]) { next[column] = score; parents[index * width + column] = candidate }
        }
      }
      previous = next
    }
    let end = -1, score = Infinity
    for (let column = 0; column < width; column++) {
      if (closed && Math.abs(column - start) > 3) continue
      const candidate = previous[column] + (closed ? .12 * (column - start) ** 2 : 0)
      if (candidate < score) { score = candidate; end = column }
    }
    if (end < 0 || score >= bestScore) continue
    const columns = new Array<number>(count)
    columns[count - 1] = end
    for (let index = count - 1; index > 0; index--) columns[index - 1] = parents[index * width + columns[index]]
    bestScore = score; bestColumns = columns
  }
  if (!bestColumns) throw new Error('当前吸附范围无法形成连续轮廓，请缩小半径或补充取点。')
  return path.map((point, index) => ({ x: point.x + normals[index].x * (bestColumns[index] - radius),
    y: point.y + normals[index].y * (bestColumns[index] - radius) }))
}
