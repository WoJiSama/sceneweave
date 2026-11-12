import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'
import { repairStructuredSurface } from './structure-repair.js'

export interface MaterialRepairOptions {
  kind: 'soft' | 'planks'
  /** The complete declared material, including its hidden portion. */
  surfaceMask?: ImagePixelMask
  protectionMask?: ImagePixelMask
  /** Other furniture, unreviewed inference and contact shadows cannot supply evidence. */
  excludedEvidenceMask?: ImagePixelMask
}
const quantile = (values: number[], q: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * q)]
const contains = (b: PixelBounds, x: number, y: number) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height

/** material-surface-v1. Deterministic local appearance inference, never hidden truth.
 * The caller supplies material and obstruction geometry; no semantic RGB guessing expands it.
 */
export function repairMaterialSurface(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds, options: MaterialRepairOptions): ImagePixels {
  if (options.kind !== 'soft' && options.kind !== 'planks') throw new Error('不支持的单表面补底种类。')
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('单表面补底需要完整RGBA源图。')
  const checkMask = (value: ImagePixelMask | undefined) => {
    if (!value) return
    if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1
      || value.width * value.height > 1_000_000 || !(value.data instanceof Uint8Array) || value.data.length !== value.width * value.height
      || value.boundsPx.width !== value.width || value.boundsPx.height !== value.height
      || !Number.isSafeInteger(value.boundsPx.x) || !Number.isSafeInteger(value.boundsPx.y) || value.boundsPx.x < 0 || value.boundsPx.y < 0
      || value.boundsPx.x + value.width > image.width || value.boundsPx.y + value.height > image.height
      || value.data.some(v => v !== 0 && v !== 255)) throw new Error('单表面范围需要有界二值蒙版。')
  }
  for (const value of [mask, options.surfaceMask, options.protectionMask, options.excludedEvidenceMask]) checkMask(value)
  if (mask.width * mask.height > 250_000 || !mask.data.some(Boolean)) throw new Error('单表面移除图框须为1至25万像素。')
  if (![donor.x, donor.y, donor.width, donor.height].every(Number.isSafeInteger) || donor.x < 0 || donor.y < 0 || donor.width < 3 || donor.height < 3
    || donor.width * donor.height > 1_000_000 || donor.x + donor.width > image.width || donor.y + donor.height > image.height) throw new Error('单表面取样须为原图内3×3至100万像素。')
  const onSurface = (x: number, y: number) => !options.surfaceMask || maskCoverage(options.surfaceMask, x, y) > 0
  const writable = (x: number, y: number) => maskCoverage(mask, x, y) > 0 && onSurface(x, y) && !maskCoverage(options.protectionMask, x, y)
  const trusted = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height && onSurface(x, y)
    && !maskCoverage(mask, x, y) && !maskCoverage(options.protectionMask, x, y) && !maskCoverage(options.excludedEvidenceMask, x, y)
    && image.data[(y * image.width + x) * 4 + 3] === 255
  let writeCount = 0
  for (let y = mask.boundsPx.y; y < mask.boundsPx.y + mask.height; y++) for (let x = mask.boundsPx.x; x < mask.boundsPx.x + mask.width; x++) if (writable(x, y)) writeCount++
  if (!writeCount) throw new Error('单表面移除与可写底材没有交集。')
  const donorChannels: number[][] = [[], [], []]
  for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) {
    if (!trusted(x, y)) throw new Error('单表面取样须全部位于可信、未保护且不透明的同底材。')
    const at = (y * image.width + x) * 4
    for (let c = 0; c < 3; c++) donorChannels[c].push(image.data[at + c])
  }
  const region = options.surfaceMask?.boundsPx ?? {
    x: Math.max(0, Math.min(donor.x, mask.boundsPx.x) - 48), y: Math.max(0, Math.min(donor.y, mask.boundsPx.y) - 48),
    width: 0, height: 0,
  }
  const bounds = options.surfaceMask ? region : { ...region,
    width: Math.min(image.width, Math.max(donor.x + donor.width, mask.boundsPx.x + mask.width) + 48) - region.x,
    height: Math.min(image.height, Math.max(donor.y + donor.height, mask.boundsPx.y + mask.height) + 48) - region.y }
  if (bounds.width * bounds.height > 1_000_000) throw new Error('单表面依据图框最多100万像素。')
  if (options.kind === 'planks') {
    // Opaque trusted evidence is the only source the fixed structure algorithm can see.
    const isolated = image.data.slice(), active = mask.data.slice()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!trusted(x, y)) isolated[(y * image.width + x) * 4 + 3] = 0
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (!writable(x + mask.boundsPx.x, y + mask.boundsPx.y)) active[y * mask.width + x] = 0
    const result = repairStructuredSurface({ ...image, data: isolated }, { ...mask, data: active }, donor)
    const data = image.data.slice()
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (active[y * mask.width + x]) {
      const at = ((y + mask.boundsPx.y) * image.width + x + mask.boundsPx.x) * 4
      data.set(result.data.subarray(at, at + 4), at)
    }
    return { ...image, data }
  }
  const medians = donorChannels.map(v => quantile(v.slice(), .5))
  const spread = donorChannels.map(v => Math.max(12, Math.min(30, (quantile(v.slice(), .9) - quantile(v.slice(), .1)) * 2.5)))
  const centreX = bounds.x + bounds.width / 2, centreY = bounds.y + bounds.height / 2
  const scaleX = Math.max(16, bounds.width / 2), scaleY = Math.max(16, bounds.height / 2)
  const basis = (x: number, y: number) => { const u = (x - centreX) / scaleX, v = (y - centreY) / scaleY; return [1, u, v, u * u, u * v, v * v] }
  const anchors: Array<{ x: number; y: number; rgb: number[] }> = []
  // Cell medians reject narrow ink and texture outliers before fitting broad illumination.
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 6) for (let x = bounds.x; x < bounds.x + bounds.width; x += 6) {
    const samples: number[][] = [[], [], []]
    for (let oy = 0; oy < 6 && y + oy < bounds.y + bounds.height; oy++) for (let ox = 0; ox < 6 && x + ox < bounds.x + bounds.width; ox++) {
      const sx = x + ox, sy = y + oy
      if (!trusted(sx, sy)) continue
      const at = (sy * image.width + sx) * 4
      if ([0, 1, 2].some(c => Math.abs(image.data[at + c] - medians[c]) > spread[c])) continue
      for (let c = 0; c < 3; c++) samples[c].push(image.data[at + c])
    }
    if (samples[0].length >= 6) anchors.push({ x: x + 2.5, y: y + 2.5, rgb: samples.map(v => quantile(v, .6)) })
  }
  if (anchors.length < 8) throw new Error('单表面补底缺少足够的同材质可信依据。')
  const solve = (matrix: number[][], rhs: number[]) => {
    const a = matrix.map((row, i) => [...row, rhs[i]])
    for (let col = 0; col < 6; col++) {
      let pivot = col
      for (let row = col + 1; row < 6; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
      ;[a[col], a[pivot]] = [a[pivot], a[col]]
      const divisor = a[col][col]
      if (Math.abs(divisor) < 1e-8) throw new Error('单表面颜色依据退化，请扩大干净底材。')
      for (let k = col; k <= 6; k++) a[col][k] /= divisor
      for (let row = 0; row < 6; row++) if (row !== col) { const amount = a[row][col]; for (let k = col; k <= 6; k++) a[row][k] -= amount * a[col][k] }
    }
    return a.map(row => row[6])
  }
  let coefficients = [0, 1, 2].map(c => [medians[c], 0, 0, 0, 0, 0])
  const value = (x: number, y: number, c: number) => basis(x, y).reduce((sum, v, i) => sum + v * coefficients[c][i], 0)
  for (let iteration = 0; iteration < 4; iteration++) {
    const matrix = Array.from({ length: 6 }, () => Array(6).fill(0) as number[]), rhs = [0, 1, 2].map(() => Array(6).fill(0) as number[])
    for (const anchor of anchors) {
      const b = basis(anchor.x, anchor.y), error = Math.max(...anchor.rgb.map((v, c) => Math.abs(v - value(anchor.x, anchor.y, c))))
      const weight = iteration ? Math.min(1, 4 / Math.max(1, error)) : 1
      for (let i = 0; i < 6; i++) { for (let j = 0; j < 6; j++) matrix[i][j] += b[i] * b[j] * weight; for (let c = 0; c < 3; c++) rhs[c][i] += b[i] * anchor.rgb[c] * weight }
    }
    // Curvature regularisation prevents unstable extrapolation from a single visible strip.
    for (let i = 0; i < 6; i++) matrix[i][i] += i >= 3 ? anchors.length * .015 : .001
    coefficients = rhs.map(row => solve(matrix, row))
  }
  // Fit broad illumination first, then solve a bounded correction from local clean edges.
  // Excluded neighbours are unknowns, not fixed zeroes or furniture-coloured boundary data.
  const margin = 2, stride = mask.width + margin * 2, rows = mask.height + margin * 2
  const tones = new Float32Array(stride * rows * 3), unknown = new Uint8Array(stride * rows)
  for (let row = 0; row < rows; row++) for (let col = 0; col < stride; col++) {
    const x = mask.boundsPx.x + col - margin, y = mask.boundsPx.y + row - margin, index = row * stride + col
    const values: number[][] = [[], [], []]
    if (trusted(x, y)) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!trusted(x + dx, y + dy)) continue
      const at = ((y + dy) * image.width + x + dx) * 4
      if ([0, 1, 2].some(c => Math.abs(image.data[at + c] - medians[c]) > spread[c] * 1.5)) continue
      for (let c = 0; c < 3; c++) values[c].push(image.data[at + c])
    }
    const fixed = values[0].length >= 3
    unknown[index] = fixed ? 0 : 1
    for (let c = 0; c < 3; c++) tones[index * 3 + c] = fixed ? quantile(values[c], .6) : value(x, y, c)
  }
  const iterations = Math.min(700, 80 + Math.max(mask.width, mask.height) * 5)
  if (stride * rows * iterations > 120_000_000) throw new Error('单表面颜色衔接超过计算预算，请缩小移除范围。')
  for (let iteration = 0; iteration < iterations; iteration++) for (let parity = 0; parity < 2; parity++) {
    for (let row = 1; row < rows - 1; row++) for (let col = 1 + (row + parity) % 2; col < stride - 1; col += 2) {
      const index = row * stride + col
      if (!unknown[index]) continue
      for (let c = 0; c < 3; c++) {
        const at = index * 3 + c, average = (tones[at - 3] + tones[at + 3] + tones[at - stride * 3] + tones[at + stride * 3]) / 4
        tones[at] += (average - tones[at]) * 1.6
      }
    }
  }
  const grain = [0, 1, 2].map(() => new Float32Array(donor.width * donor.height))
  for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) for (let c = 0; c < 3; c++) {
    const local: number[] = []
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (contains(donor, x + dx, y + dy)) local.push(image.data[((y + dy) * image.width + x + dx) * 4 + c])
    grain[c][(y - donor.y) * donor.width + x - donor.x] = Math.max(-2, Math.min(2, image.data[(y * image.width + x) * 4 + c] - quantile(local, .5))) * .7
  }
  const data = image.data.slice()
  for (let y = mask.boundsPx.y; y < mask.boundsPx.y + mask.height; y++) for (let x = mask.boundsPx.x; x < mask.boundsPx.x + mask.width; x++) if (writable(x, y)) {
    const at = (y * image.width + x) * 4, index = ((y - mask.boundsPx.y) % donor.height) * donor.width + (x - mask.boundsPx.x) % donor.width
    const toneAt = ((y - mask.boundsPx.y + margin) * stride + x - mask.boundsPx.x + margin) * 3
    for (let c = 0; c < 3; c++) data[at + c] = tones[toneAt + c] + grain[c][index]
    data[at + 3] = 255
  }
  return { ...image, data }
}
