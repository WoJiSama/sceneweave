import { repairImageRegion } from './repair.js'
import type { ImagePoint } from './calibration.js'
import { decodeSelectionMask, type ImageSelectionMask } from './selection-mask.js'

export interface ImagePixels { width: number; height: number; data: Uint8ClampedArray }
export interface PixelBounds { x: number; y: number; width: number; height: number }
export interface ImagePixelMask { width: number; height: number; data: Uint8Array; boundsPx: PixelBounds }
export interface ImageRepairFill { polygon: readonly ImagePoint[]; donor: PixelBounds }
export interface ExtractedImageLayer {
  layer: ImagePixels & { boundsPx: PixelBounds }
  remaining: ImagePixels
  mask: ImagePixelMask
  repairMask: ImagePixelMask
}
export interface ImageRegionSuggestion {
  mask: ImagePixelMask
  polygon: ImagePoint[]
  holes: ImagePoint[][]
  pixelCount: number
}

const MAX_PIXELS = 32_000_000
const MAX_EDGE = 8192
const MAX_POLYGON_POINTS = 4096
const REGION_PIXELS = 1_000_000
const MAX_BOUNDARY_EDGES = 200_000
const SAMPLES = 4

function checkImage(image: ImagePixels): void {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || image.width > MAX_EDGE || image.height > MAX_EDGE || image.width * image.height > MAX_PIXELS
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('图片必须是完整RGBA，边长不超过8192像素且总量不超过3200万像素。')
  }
}

function checkPoint(image: ImagePixels, point: ImagePoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) {
    throw new Error('轮廓点超出原图范围。')
  }
}

function checkDonor(image: ImagePixels, bounds: PixelBounds): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) || bounds.x < 0 || bounds.y < 0
    || bounds.width < 1 || bounds.height < 1 || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height) {
    throw new Error('补底取样范围必须是原图内的整数像素矩形。')
  }
}

/** Even-odd polygon coverage with 4×4 subpixel samples, kept in a tightly cropped mask. */
function polygonMask(image: ImagePixels, polygon: readonly ImagePoint[], clip?: PixelBounds): ImagePixelMask {
  if (polygon.length < 3 || polygon.length > MAX_POLYGON_POINTS) throw new Error('轮廓需要3至4096个点。')
  polygon.forEach(point => checkPoint(image, point))
  const x = Math.max(clip?.x ?? 0, Math.floor(Math.min(...polygon.map(point => point.x))))
  const y = Math.max(clip?.y ?? 0, Math.floor(Math.min(...polygon.map(point => point.y))))
  const right = Math.min(clip ? clip.x + clip.width : image.width, Math.ceil(Math.max(...polygon.map(point => point.x))))
  const bottom = Math.min(clip ? clip.y + clip.height : image.height, Math.ceil(Math.max(...polygon.map(point => point.y))))
  const width = right - x, height = bottom - y
  if (width < 1 || height < 1) throw new Error('轮廓没有可提取面积。')
  const data = new Uint8Array(width * height)
  for (let row = 0; row < height * SAMPLES; row++) {
    const sampleY = y + (row + .5) / SAMPLES
    const crossings: number[] = []
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index], end = polygon[(index + 1) % polygon.length]
      if ((start.y > sampleY) !== (end.y > sampleY)) crossings.push(start.x + (sampleY - start.y) * (end.x - start.x) / (end.y - start.y))
    }
    crossings.sort((a, b) => a - b)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const first = Math.max(0, Math.ceil((crossings[index] - x) * SAMPLES - .5))
      const last = Math.min(width * SAMPLES, Math.ceil((crossings[index + 1] - x) * SAMPLES - .5))
      for (let column = first; column < last; column++) data[Math.floor(row / SAMPLES) * width + Math.floor(column / SAMPLES)]++
    }
  }
  if (!data.some(value => value > 0)) throw new Error('轮廓没有覆盖像素。')
  for (let index = 0; index < data.length; index++) data[index] = Math.round(data[index] * 255 / (SAMPLES * SAMPLES))
  return { width, height, data, boundsPx: { x, y, width, height } }
}

/** Shared source-grid coverage for reconstruction and independently reported inference. */
export function imagePolygonMask(image: ImagePixels, polygon: readonly ImagePoint[]): ImagePixelMask {
  checkImage(image)
  return polygonMask(image, polygon)
}

/** Crop to a semantic region without changing source coordinates or opaque neighbours. */
export function cropImageRegion(image: ImagePixels, polygon: readonly ImagePoint[]): ImagePixels & { boundsPx: PixelBounds } {
  checkImage(image)
  const mask = polygonMask(image, polygon), data = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const source = ((mask.boundsPx.y + y) * image.width + mask.boundsPx.x + x) * 4, target = (y * mask.width + x) * 4
    data.set(image.data.subarray(source, source + 3), target)
    data[target + 3] = Math.round(image.data[source + 3] * mask.data[y * mask.width + x] / 255)
  }
  return { width: mask.width, height: mask.height, data, boundsPx: mask.boundsPx }
}

/** The repair mask has an explicit halo while extracted object pixels retain their exact contour. */
function expandedRepairMask(image: ImagePixels, mask: ImagePixelMask, radius: number): ImagePixelMask {
  if (!radius) return mask
  const x = Math.max(0, mask.boundsPx.x - radius), y = Math.max(0, mask.boundsPx.y - radius)
  const right = Math.min(image.width, mask.boundsPx.x + mask.width + radius), bottom = Math.min(image.height, mask.boundsPx.y + mask.height + radius)
  const width = right - x, height = bottom - y, horizontal = new Uint8Array(width * height)
  const original = (column: number, row: number) => {
    const mx = x + column - mask.boundsPx.x, my = y + row - mask.boundsPx.y
    return mx >= 0 && my >= 0 && mx < mask.width && my < mask.height && mask.data[my * mask.width + mx] > 0 ? 1 : 0
  }
  for (let row = 0; row < height; row++) {
    let count = 0
    for (let column = 0; column <= radius && column < width; column++) count += original(column, row)
    for (let column = 0; column < width; column++) {
      horizontal[row * width + column] = count > 0 ? 1 : 0
      if (column - radius >= 0) count -= original(column - radius, row)
      if (column + radius + 1 < width) count += original(column + radius + 1, row)
    }
  }
  const data = new Uint8Array(width * height)
  for (let column = 0; column < width; column++) {
    let count = 0
    for (let row = 0; row <= radius && row < height; row++) count += horizontal[row * width + column]
    for (let row = 0; row < height; row++) {
      data[row * width + column] = count > 0 ? 255 : 0
      if (row - radius >= 0) count -= horizontal[(row - radius) * width + column]
      if (row + radius + 1 < height) count += horizontal[(row + radius + 1) * width + column]
    }
  }
  return { width, height, data, boundsPx: { x, y, width, height } }
}

/** Extract original object pixels, then repair only the declared mask and optional cleanup halo. */
export function extractImageLayer(image: ImagePixels, polygon: readonly ImagePoint[], donorBoundsPx: PixelBounds,
  options: { repair?: 'tile' | 'seamless' | 'aligned'; fills?: readonly ImageRepairFill[]; cleanupPx?: number; selectionMask?: ImageSelectionMask } = {}): ExtractedImageLayer {
  if (options.repair !== undefined && options.repair !== 'tile' && options.repair !== 'seamless' && options.repair !== 'aligned') throw new Error('不支持的补底方式。')
  const cleanupPx = options.cleanupPx ?? 0
  if (!Number.isSafeInteger(cleanupPx) || cleanupPx < 0 || cleanupPx > 8) throw new Error('残影清理范围须为0至8像素。')
  checkImage(image)
  checkDonor(image, donorBoundsPx)
  // A fine mask is authoritative: the rough polygon must not erase holes or leaf tips.
  const mask = options.selectionMask ? decodeSelectionMask(options.selectionMask, image) : polygonMask(image, polygon)
  const repairMask = expandedRepairMask(image, mask, cleanupPx)
  if (options.fills && (!Array.isArray(options.fills) || options.fills.length > 8)) throw new Error('补底分区最多8个。')
  // Region guidance is only consumed around this repair, even if a user marks an entire material plane.
  const contextX = Math.max(0, repairMask.boundsPx.x - 64), contextY = Math.max(0, repairMask.boundsPx.y - 64)
  const context = { x: contextX, y: contextY,
    width: Math.min(image.width, repairMask.boundsPx.x + repairMask.width + 64) - contextX,
    height: Math.min(image.height, repairMask.boundsPx.y + repairMask.height + 64) - contextY }
  const regions = (options.fills ?? []).map(fill => {
    checkDonor(image, fill.donor)
    return { mask: polygonMask(image, fill.polygon, context), donor: fill.donor }
  })
  const donors = [donorBoundsPx, ...regions.map(region => region.donor)]
  const prioritizedRegions = [...regions].reverse()
  const regionCoverage = (region: ImagePixelMask, x: number, y: number): number => {
    const column = x - region.boundsPx.x, row = y - region.boundsPx.y
    return column < 0 || row < 0 || column >= region.width || row >= region.height ? 0 : region.data[row * region.width + column]
  }
  for (const region of regions) {
    if (!mask.data.some((value, index) => value > 0 && regionCoverage(region.mask, mask.boundsPx.x + index % mask.width, mask.boundsPx.y + Math.floor(index / mask.width)) > 0)) {
      throw new Error('补底分区需要覆盖当前物件的选区。')
    }
  }
  const layerData = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let row = 0; row < mask.height; row++) {
    for (let column = 0; column < mask.width; column++) {
      const index = row * mask.width + column, coverage = mask.data[index] / 255
      if (!coverage) continue
      const sourceIndex = ((row + mask.boundsPx.y) * image.width + column + mask.boundsPx.x) * 4
      layerData.set(image.data.subarray(sourceIndex, sourceIndex + 3), index * 4)
      layerData[index * 4 + 3] = Math.round(image.data[sourceIndex + 3] * coverage)
    }
  }
  const remainingData = image.data.slice()
  for (let row = 0; row < repairMask.height; row++) {
    for (let column = 0; column < repairMask.width; column++) {
      const coverage = repairMask.data[row * repairMask.width + column] / 255
      if (!coverage) continue
      const x = repairMask.boundsPx.x + column, y = repairMask.boundsPx.y + row
      if (donors.some(donor => x >= donor.x && x < donor.x + donor.width && y >= donor.y && y < donor.y + donor.height)) throw new Error('补底取样范围与所选物件或残影清理范围重叠，请选择露出的下层纹理。')
      const donor = prioritizedRegions.find(region => regionCoverage(region.mask, x, y) > 0)?.donor ?? donorBoundsPx
      const donorX = donor.x + ((x - donor.x) % donor.width + donor.width) % donor.width
      const donorY = donor.y + ((y - donor.y) % donor.height + donor.height) % donor.height
      const sourceIndex = (y * image.width + x) * 4, donorIndex = (donorY * image.width + donorX) * 4
      for (let channel = 0; channel < 4; channel++) remainingData[sourceIndex + channel] = Math.round(image.data[sourceIndex + channel] * (1 - coverage) + image.data[donorIndex + channel] * coverage)
    }
  }
  return { layer: { width: mask.width, height: mask.height, data: layerData, boundsPx: { ...mask.boundsPx } },
    remaining: options.repair === 'seamless' || options.repair === 'aligned' ? repairImageRegion(image, repairMask, donorBoundsPx,
      { regions, baseMask: mask, ...(options.repair === 'aligned' ? { alignment: 'boundary-phase-v1' as const } : {}) })
      : { width: image.width, height: image.height, data: remainingData }, mask, repairMask }
}

function regionContours(mask: ImagePixelMask): ImagePoint[][] {
  const stride = mask.width + 1, edges = new Set<number>()
  const selected = (x: number, y: number) => x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.data[y * mask.width + x] !== 0
  const add = (x: number, y: number, direction: number) => edges.add((y * stride + x) * 4 + direction)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!selected(x, y)) continue
      if (!selected(x, y - 1)) add(x, y, 0)
      if (!selected(x + 1, y)) add(x + 1, y, 1)
      if (!selected(x, y + 1)) add(x + 1, y + 1, 2)
      if (!selected(x - 1, y)) add(x, y + 1, 3)
      if (edges.size > MAX_BOUNDARY_EDGES) throw new Error('区域边缘过于复杂，请缩小颜色容差或手动描画。')
    }
  }
  const contours: ImagePoint[][] = [], steps = [1, stride, -1, -stride]
  while (edges.size) {
    const first = edges.values().next().value!, startVertex = Math.floor(first / 4)
    let edge = first, previousDirection = -1
    const points: ImagePoint[] = []
    do {
      const vertex = Math.floor(edge / 4), direction = edge % 4
      if (direction !== previousDirection) points.push({ x: vertex % stride + mask.boundsPx.x, y: Math.floor(vertex / stride) + mask.boundsPx.y })
      edges.delete(edge)
      previousDirection = direction
      const nextVertex = vertex + steps[direction]
      if (nextVertex === startVertex) break
      const nextDirection = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4]
        .find(value => edges.has(nextVertex * 4 + value))
      if (nextDirection === undefined) throw new Error('无法闭合区域轮廓，请手动描画。')
      edge = nextVertex * 4 + nextDirection
    } while (edges.size)
    contours.push(points)
  }
  return contours
}

function signedArea(points: readonly ImagePoint[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
}

/** Four-connected seed-color selection; returned contours are suggestions for user review. */
export function suggestImageRegion(image: ImagePixels, options: { seed: ImagePoint; tolerance: number; maxPixels?: number }): ImageRegionSuggestion {
  checkImage(image)
  checkPoint(image, options.seed)
  const seedX = Math.floor(options.seed.x), seedY = Math.floor(options.seed.y)
  const maxPixels = options.maxPixels ?? Math.min(REGION_PIXELS, image.width * image.height)
  if (seedX === image.width || seedY === image.height || !Number.isFinite(options.tolerance) || options.tolerance < 0 || options.tolerance > 255
    || !Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > image.width * image.height) throw new Error('区域种子、颜色容差或像素预算无效。')
  const seed = seedY * image.width + seedX, seedIndex = seed * 4
  if (image.data[seedIndex + 3] === 0) throw new Error('请在可见物件内部点选。')
  const seen = new Uint8Array(image.width * image.height), queue = new Uint32Array(maxPixels)
  let count = 1, head = 0, minX = seedX, maxX = seedX, minY = seedY, maxY = seedY
  queue[0] = seed
  seen[seed] = 1
  while (head < count) {
    const pixel = queue[head++], x = pixel % image.width, y = Math.floor(pixel / image.width)
    const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < image.width ? pixel + 1 : -1,
      y > 0 ? pixel - image.width : -1, y + 1 < image.height ? pixel + image.width : -1]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || seen[neighbor]) continue
      seen[neighbor] = 1
      const index = neighbor * 4
      if (image.data[index + 3] === 0 || [0, 1, 2, 3].some(channel => Math.abs(image.data[index + channel] - image.data[seedIndex + channel]) > options.tolerance)) continue
      if (count === maxPixels) throw new Error('区域超过本次像素预算，请降低颜色容差或缩小选择范围。')
      queue[count++] = neighbor
      const nx = neighbor % image.width, ny = Math.floor(neighbor / image.width)
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx)
      minY = Math.min(minY, ny); maxY = Math.max(maxY, ny)
    }
  }
  const width = maxX - minX + 1, height = maxY - minY + 1
  const mask: ImagePixelMask = { width, height, data: new Uint8Array(width * height), boundsPx: { x: minX, y: minY, width, height } }
  for (let index = 0; index < count; index++) mask.data[(Math.floor(queue[index] / image.width) - minY) * width + queue[index] % image.width - minX] = 255
  const contours = regionContours(mask), outer = contours.filter(points => signedArea(points) > 0)
  if (outer.length !== 1) throw new Error('区域外轮廓存在歧义，请手动描画或选择较小区域。')
  return { mask, polygon: outer[0], holes: contours.filter(points => signedArea(points) < 0), pixelCount: count }
}
