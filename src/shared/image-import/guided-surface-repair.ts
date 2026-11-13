import type { NeighborhoodRepairOptions } from './neighborhood-repair.js'
import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'
import { prepareImageSurfaceDetailPatches, applyImageSurfaceDetailPatches, replaceImageSurfaceDetailInk, type ImageSurfaceDetailPatch } from './guided-detail-patches.js'
import { prepareOriginalSurfaceStroke, rasterOriginalSurfaceStroke } from './guided-original-stroke.js'

export interface ImageSurfaceStructureGuide {
  points: Array<{ x: number; y: number }>
  reference: PixelBounds
  axis: 'horizontal' | 'vertical'
  stroke?: 'original-segment'
  /** Estimate reference paper from both sides; only for original-segment. */
  paper?: 'two-sided'
  /** An explicit human inference, not a claim to recover the hidden source. */
  reason: string
}
export interface GuidedSurfaceRepairOptions extends NeighborhoodRepairOptions {
  orientation?: 'horizontal' | 'vertical' | 'soft'
  guides?: ImageSurfaceStructureGuide[]
  detailPatches?: ImageSurfaceDetailPatch[]
}
export interface GuidedToneObservation {
  boundsPx: PixelBounds
  /** Mean of every paper sample actually used, not merely the displayed subset. */
  rgb: number[]
  usedPixels: number
  samples: Array<{ x: number; y: number; rgb: number[] }>
}
export interface GuidedToneReport {
  algorithm: 'guided-tone-observations-v1'
  /** Fixed diagnostic gates; these are neither material classification nor confidence. */
  gates: { channelDifference: 18; luminanceDifference: 12; radiusPx: 24 }
  observations: Array<{
    source: GuidedToneObservation
    neighbor: GuidedToneObservation
    channelDifference: number
    luminanceDifference: number
  }>
}
interface ToneGrid { width: number; height: number; known: Uint8Array; rgb: Float32Array }
interface Profile { centre: number; values: number[][]; radius: number }
interface Stroke { points: Array<{ x: number; y: number }>; profile: Profile; endProfile?: Profile; explicit: boolean; axis: 'horizontal' | 'vertical' }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const quantile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]
const steps = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
const hash = (x: number, y: number, salt: number) => {
  let value = Math.imul(x + 0x6d2b79f5, 0x1b873593) ^ Math.imul(y + salt, 0x85ebca6b)
  value = Math.imul(value ^ value >>> 16, 0x7feb352d)
  return (value ^ value >>> 15) >>> 0
}

/** guided-surface-v1: original-only tone and texture synthesis with optional
 * explicitly inferred structure. All source observations are captured before
 * synthesis. This opt-in algorithm does not change older recipe meanings. */
export function repairGuidedImageSurface(image: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: GuidedSurfaceRepairOptions): ImagePixels {
  return solveGuidedImageSurface(image, removal, donor, options, false).pixels
}

/** Same solve and permissions, with at most eight read-only original-observation
 * comparisons. No callback can inspect or mutate intermediate computation. */
export function inspectGuidedImageSurfaceTone(image: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: GuidedSurfaceRepairOptions): { pixels: ImagePixels; report: GuidedToneReport } {
  const result = solveGuidedImageSurface(image, removal, donor, options, true)
  return { pixels: result.pixels, report: result.report! }
}

function solveGuidedImageSurface(image: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: GuidedSurfaceRepairOptions, collectTone: boolean): { pixels: ImagePixels; report?: GuidedToneReport } {
  const cancel = () => {
    options?.signal?.throwIfAborted?.()
    if (options?.signal?.aborted) throw new Error('辅助结构补底已取消，原图保持。')
  }
  cancel()
  if (!image || ![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('辅助结构补底需要完整有界RGBA原图。')
  const validBounds = (b: PixelBounds) => b && [b.x, b.y, b.width, b.height].every(Number.isSafeInteger) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= image.width && b.y + b.height <= image.height
  if (!options || !options.surfaceMask || options.pattern !== 'soft' && options.pattern !== 'planks'
    || options.orientation !== undefined && !['horizontal', 'vertical', 'soft'].includes(options.orientation)) throw new Error('辅助结构补底需要明确表面与受支持纹向。')
  for (const mask of [removal, options.surfaceMask, options.protectionMask, options.excludedEvidenceMask]) if (mask) {
    if (!validBounds(mask.boundsPx) || mask.width !== mask.boundsPx.width || mask.height !== mask.boundsPx.height || mask.width * mask.height > 1_000_000
      || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height || mask.data.some(v => v !== 0 && v !== 255)) throw new Error('辅助结构范围须为原图内最多100万像素的二值蒙版。')
  }
  if (!removal || removal.width * removal.height > 250_000 || !removal.data.some(Boolean)) throw new Error('辅助结构移除图框须为1至25万像素。')
  if (!validBounds(donor) || donor.width < 5 || donor.height < 5 || donor.width * donor.height > 1_000_000) throw new Error('辅助结构取样须为原图内至少5×5、最多100万像素的底材。')
  if (options.priorInference && (!(options.priorInference instanceof Uint8Array) || options.priorInference.length !== image.width * image.height)) throw new Error('前序推断范围须逐原图像素绑定。')
  const guides = options.guides ?? []
  if (!Array.isArray(guides) || guides.length > 32) throw new Error('辅助结构最多32条标注。')
  if (!Array.isArray(options.detailPatches ?? []) || guides.length + (options.detailPatches?.length ?? 0) > 32) throw new Error('路径与二维笔迹合计最多32项。')
  let structureWork = 0
  for (const guide of guides) {
    if (!guide || guide.axis !== 'horizontal' && guide.axis !== 'vertical' || typeof guide.reason !== 'string' || !guide.reason.trim() || guide.reason.length > 400
      || !Array.isArray(guide.points) || guide.points.length < 2 || guide.points.length > 16 || guide.points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height)
      || !validBounds(guide.reference) || guide.reference.width * guide.reference.height > 4096
      || (guide.axis === 'horizontal' ? guide.reference.width < 3 || guide.reference.height < 5 : guide.reference.height < 3 || guide.reference.width < 5)) throw new Error('结构标注须含2至16个原图内点、明确理由及至少3×5的有界线参考。')
    if (guide.stroke !== undefined && guide.stroke !== 'original-segment') throw new Error('结构笔触仅支持显式original-segment，缺省保持原截面方法。')
    if (guide.paper !== undefined && (guide.paper !== 'two-sided' || guide.stroke !== 'original-segment'
      || (guide.axis === 'horizontal' ? guide.reference.height : guide.reference.width) < 9)) throw new Error('两侧底色须显式用于原尺寸接缝，参考横跨至少9px。')
    let length = 0
    for (let i = 1; i < guide.points.length; i++) {
      const a = guide.points[i - 1], b = guide.points[i]
      length += Math.hypot(b.x - a.x, b.y - a.y)
      structureWork += Math.max(0, Math.min(removal.boundsPx.x + removal.width, Math.max(a.x, b.x) + 10) - Math.max(removal.boundsPx.x, Math.min(a.x, b.x) - 10))
        * Math.max(0, Math.min(removal.boundsPx.y + removal.height, Math.max(a.y, b.y) + 10) - Math.max(removal.boundsPx.y, Math.min(a.y, b.y) - 10))
    }
    if (length < 1 || length > 8192) throw new Error('结构标注长度须为1至8192像素。')
  }
  if (structureWork > 12_000_000) throw new Error('结构标注超过栅格计算预算，请减少长折线或拆小移除范围。')
  let work = 0
  const budget = (amount: number) => { work += amount; if (work > 140_000_000) throw new Error('辅助结构补底超过计算预算，请缩小表面、移除或结构标注。') }
  const surface = options.surfaceMask.boundsPx, sw = surface.width, sh = surface.height, size = sw * sh
  const index = (x: number, y: number) => (y - surface.y) * sw + x - surface.x
  const inSurfaceBox = (x: number, y: number) => x >= surface.x && y >= surface.y && x < surface.x + sw && y < surface.y + sh
  const trustedMap = new Uint8Array(size), writeMap = new Uint8Array(removal.width * removal.height)
  const trusted = (x: number, y: number) => inSurfaceBox(x, y) && trustedMap[index(x, y)] > 0
  const writable = (x: number, y: number) => x >= removal.boundsPx.x && y >= removal.boundsPx.y && x < removal.boundsPx.x + removal.width && y < removal.boundsPx.y + removal.height && writeMap[(y - removal.boundsPx.y) * removal.width + x - removal.boundsPx.x] > 0
  const rgb = (x: number, y: number, c: number) => image.data[(y * image.width + x) * 4 + c]
  const luminance = (x: number, y: number) => (rgb(x, y, 0) + rgb(x, y, 1) + rgb(x, y, 2)) / 3
  let writes = 0, observations = 0
  for (let y = surface.y; y < surface.y + sh; y++) {
    cancel()
    for (let x = surface.x; x < surface.x + sw; x++) {
      if (!maskCoverage(options.surfaceMask, x, y)) continue
      if (maskCoverage(removal, x, y) && !maskCoverage(options.protectionMask, x, y)) { writeMap[(y - removal.boundsPx.y) * removal.width + x - removal.boundsPx.x] = 1; writes++ }
      if (!maskCoverage(removal, x, y) && !maskCoverage(options.protectionMask, x, y) && !maskCoverage(options.excludedEvidenceMask, x, y)
        && !options.priorInference?.[y * image.width + x] && rgb(x, y, 3) === 255) { trustedMap[index(x, y)] = 1; observations++ }
    }
  }
  if (!writes || observations < 25) throw new Error('辅助结构补底没有可写区域或足够可信依据。')
  const verifyReference = (bounds: PixelBounds) => {
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) if (!trusted(x, y)) throw new Error('取样和线参考整块必须属于可信原图，不能含移除、保护、排除、前序推断或透明像素。')
  }
  verifyReference(donor)
  for (const guide of guides) verifyReference(guide.reference)
  const detailPatches = prepareImageSurfaceDetailPatches(image, options.detailPatches ?? [], trusted,
    (x, y) => !!maskCoverage(options.surfaceMask, x, y), cancel)
  // Each patch scans at most 49 source + 49 inferred-paper samples per pixel.
  budget(detailPatches.reduce((sum, patch) => sum + patch.target.width * patch.target.height * (patch.blendPx ? 108 : 98), 0))

  // Quantile observations remove narrow ink before fitting the broad paper tone.
  // A shared luminance ordering preserves channel relationships of actual pixels.
  const cell = 4, gw = Math.ceil(sw / cell), gh = Math.ceil(sh / cell)
  const grid: ToneGrid = { width: gw, height: gh, known: new Uint8Array(gw * gh), rgb: new Float32Array(gw * gh * 3) }
  // Optional compact evidence capture: < 66,000 cells, four original indexes
  // per cell. Normal repair allocates none and performs no diagnostic scan.
  const toneSamples = collectTone ? new Uint32Array(gw * gh * 4) : undefined
  const toneSampleCounts = collectTone ? new Uint8Array(gw * gh) : undefined
  const toneUsedCounts = collectTone ? new Uint8Array(gw * gh) : undefined
  const donorColors: number[][] = [[], [], []]
  for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) for (let c = 0; c < 3; c++) donorColors[c].push(rgb(x, y, c))
  const base = donorColors.map(v => quantile(v, .65))
  const centers: Array<{ x: number; y: number; color: number[] }> = []
  for (let gy = 0; gy < gh; gy++) {
    cancel()
    for (let gx = 0; gx < gw; gx++) {
      const pixels: Array<{ x: number; y: number; lum: number }> = []
      for (let dy = -2; dy < cell + 2; dy++) for (let dx = -2; dx < cell + 2; dx++) {
        const x = surface.x + gx * cell + dx, y = surface.y + gy * cell + dy
        if (trusted(x, y)) pixels.push({ x, y, lum: luminance(x, y) })
      }
      if (pixels.length < 4) continue
      pixels.sort((a, b) => a.lum - b.lum)
      const chosen = pixels[Math.floor((pixels.length - 1) * .65)], at = gy * gw + gx
      // A bright quantile identifies paper beside ink, but is not itself the
      // paper colour: copying it makes every repair a brighter rectangle.
      const paper = pixels.filter(p => p.lum >= chosen.lum - 8 && p.lum <= chosen.lum + 8)
      const color = [0, 1, 2].map(c => paper.reduce((sum, p) => sum + rgb(p.x, p.y, c), 0) / paper.length)
      if (toneSamples && toneSampleCounts && toneUsedCounts) {
        const count = Math.min(4, paper.length)
        toneSampleCounts[at] = count; toneUsedCounts[at] = paper.length
        for (let sample = 0; sample < count; sample++) {
          const pixel = paper[Math.floor(sample * paper.length / count)]
          toneSamples[at * 4 + sample] = pixel.y * image.width + pixel.x
        }
      }
      grid.known[at] = 1; grid.rgb.set(color, at * 3)
      centers.push({ x: gx, y: gy, color })
    }
  }
  if (centers.length < 4) throw new Error('辅助结构补底缺少去墨后可信底色，请重新选择干净同底材。')
  // Robust affine initialization avoids a constant-colour interior even before
  // the coarse-to-fine harmonic boundary solve has converged.
  const coefficients = [0, 1, 2].map(c => [base[c], 0, 0])
  const basis = (x: number, y: number) => [1, (x - gw / 2) / Math.max(1, gw), (y - gh / 2) / Math.max(1, gh)]
  for (let pass = 0; pass < 3; pass++) {
    const matrix = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = [0, 1, 2].map(() => [0, 0, 0])
    for (const sample of centers) {
      const b = basis(sample.x, sample.y), error = Math.max(...sample.color.map((v, c) => Math.abs(v - b.reduce((sum, t, i) => sum + t * coefficients[c][i], 0))))
      const weight = pass ? Math.min(1, 6 / Math.max(1, error)) : 1
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) matrix[i][j] += b[i] * b[j] * weight; for (let c = 0; c < 3; c++) rhs[c][i] += b[i] * sample.color[c] * weight }
    }
    for (let c = 0; c < 3; c++) {
      const a = matrix.map((row, i) => [...row, rhs[c][i]])
      for (let i = 0; i < 3; i++) {
        a[i][i] += .0001
        let pivot = i
        for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j
        ;[a[i], a[pivot]] = [a[pivot], a[i]]
        const d = a[i][i]
        if (Math.abs(d) < 1e-10) throw new Error('辅助结构底色依据退化，请扩大干净取样。')
        for (let k = i; k < 4; k++) a[i][k] /= d
        for (let j = 0; j < 3; j++) if (j !== i) { const m = a[j][i]; for (let k = i; k < 4; k++) a[j][k] -= m * a[i][k] }
      }
      coefficients[c] = a.map(row => row[3])
    }
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (!grid.known[y * gw + x]) for (let c = 0; c < 3; c++) grid.rgb[(y * gw + x) * 3 + c] = clamp(basis(x, y).reduce((sum, v, i) => sum + v * coefficients[c][i], 0), base[c] - 35, base[c] + 35)
  const levels = [grid]
  while (levels.at(-1)!.width > 12 || levels.at(-1)!.height > 12) {
    const previous = levels.at(-1)!, width = Math.ceil(previous.width / 2), height = Math.ceil(previous.height / 2)
    const coarse: ToneGrid = { width, height, known: new Uint8Array(width * height), rgb: new Float32Array(width * height * 3) }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let n = 0, fixed = 0
      const observed = [0, 0, 0], initial = [0, 0, 0]
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const px = x * 2 + dx, py = y * 2 + dy
        if (px >= previous.width || py >= previous.height) continue
        const i = py * previous.width + px; n++
        if (previous.known[i]) fixed++
        for (let c = 0; c < 3; c++) { initial[c] += previous.rgb[i * 3 + c]; if (previous.known[i]) observed[c] += previous.rgb[i * 3 + c] }
      }
      const i = y * width + x; coarse.known[i] = fixed ? 1 : 0
      for (let c = 0; c < 3; c++) coarse.rgb[i * 3 + c] = fixed ? observed[c] / fixed : initial[c] / n
    }
    levels.push(coarse)
  }
  const interpolate = (g: ToneGrid, x: number, y: number, c: number) => {
    const cx = clamp(x, 0, g.width - 1), cy = clamp(y, 0, g.height - 1), x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1), u = cx - x0, v = cy - y0
    return (g.rgb[(y0 * g.width + x0) * 3 + c] * (1 - u) + g.rgb[(y0 * g.width + x1) * 3 + c] * u) * (1 - v)
      + (g.rgb[(y1 * g.width + x0) * 3 + c] * (1 - u) + g.rgb[(y1 * g.width + x1) * 3 + c] * u) * v
  }
  for (let level = levels.length - 1; level >= 0; level--) {
    const g = levels[level]
    if (level < levels.length - 1) for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (!g.known[y * g.width + x]) for (let c = 0; c < 3; c++) g.rgb[(y * g.width + x) * 3 + c] = interpolate(levels[level + 1], (x - .5) / 2, (y - .5) / 2, c)
    const iterations = level === levels.length - 1 ? 180 : 70
    budget(g.width * g.height * iterations)
    for (let pass = 0; pass < iterations; pass++) {
      cancel()
      for (let parity = 0; parity < 2; parity++) for (let y = 0; y < g.height; y++) for (let x = (y + parity) % 2; x < g.width; x += 2) {
        const i = y * g.width + x
        if (g.known[i]) continue
        let count = 0; const sum = [0, 0, 0]
        for (const [dx, dy] of steps) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue
          count++; for (let c = 0; c < 3; c++) sum[c] += g.rgb[(ny * g.width + nx) * 3 + c]
        }
        if (count) for (let c = 0; c < 3; c++) { const at = i * 3 + c; g.rgb[at] += 1.45 * (sum[c] / count - g.rgb[at]) }
      }
    }
  }
  const tone = (x: number, y: number, c: number) => interpolate(grid, (x - surface.x + .5) / cell - .5, (y - surface.y + .5) / cell - .5, c)
  // Integral means ignore ink and every forbidden source. Broad colour belongs
  // to the harmonic field; randomizing its residual would create embossed stains.
  const pitch = sw + 1, integralCount = new Uint32Array(pitch * (sh + 1)), integralTrusted = new Uint32Array(integralCount.length)
  const sums = [0, 1, 2].map(() => new Float64Array(integralCount.length)), clean = new Uint8Array(size)
  for (let y = 0; y < sh; y++) {
    cancel(); let count = 0, known = 0; const sum = [0, 0, 0]
    for (let x = 0; x < sw; x++) {
      const sx = surface.x + x, sy = surface.y + y, good = trusted(sx, sy)
      if (good) known++
      if (good && luminance(sx, sy) >= [0, 1, 2].reduce((v, c) => v + tone(sx, sy, c), 0) / 3 - 10) {
        clean[y * sw + x] = 1; count++; for (let c = 0; c < 3; c++) sum[c] += rgb(sx, sy, c)
      }
      const at = (y + 1) * pitch + x + 1, above = y * pitch + x + 1
      integralCount[at] = integralCount[above] + count; integralTrusted[at] = integralTrusted[above] + known
      for (let c = 0; c < 3; c++) sums[c][at] = sums[c][above] + sum[c]
    }
  }
  const rect = (array: Uint32Array | Float64Array, x: number, y: number, width: number, height: number) => {
    const x0 = clamp(x - surface.x, 0, sw), y0 = clamp(y - surface.y, 0, sh), x1 = clamp(x - surface.x + width, 0, sw), y1 = clamp(y - surface.y + height, 0, sh)
    return array[y1 * pitch + x1] - array[y0 * pitch + x1] - array[y1 * pitch + x0] + array[y0 * pitch + x0]
  }
  const mean = (x: number, y: number, radius: number, c: number) => {
    const n = rect(integralCount, x - radius, y - radius, radius * 2 + 1, radius * 2 + 1)
    return n ? rect(sums[c], x - radius, y - radius, radius * 2 + 1, radius * 2 + 1) / n : tone(x, y, c)
  }
  const fine = new Float32Array(size * 3), donorResiduals: number[][] = [[], [], []]
  for (let y = surface.y; y < surface.y + sh; y++) {
    cancel()
    for (let x = surface.x; x < surface.x + sw; x++) if (trusted(x, y)) for (let c = 0; c < 3; c++) {
      const small = mean(x, y, 2, c), at = index(x, y) * 3 + c
      fine[at] = clean[index(x, y)] ? clamp(rgb(x, y, c) - small, -10, 10) : 0
      if (clean[index(x, y)] && x >= donor.x && y >= donor.y && x < donor.x + donor.width && y < donor.y + donor.height) donorResiduals[c].push(Math.abs(fine[at]))
    }
  }
  budget(size * 12)
  if (donorResiduals.some(values => !values.length)) throw new Error('辅助结构取样缺少真正去墨的底材像素。')
  // The declared donor sets the scale, including almost smooth source paintings.
  // Never import stronger grain from a different visible board or amplify noise
  // merely to compensate for overlap averaging.
  const grainLimit = donorResiduals.map(values => Math.min(10, quantile(values, .9)))
  for (let i = 0; i < size; i++) for (let c = 0; c < 3; c++) fine[i * 3 + c] = clamp(fine[i * 3 + c], -grainLimit[c], grainLimit[c])
  let orientation = options.orientation ?? (options.pattern === 'soft' ? 'soft' : undefined)
  if (!orientation) {
    let gx = 0, gy = 0
    for (let y = donor.y; y < donor.y + donor.height - 1; y++) for (let x = donor.x; x < donor.x + donor.width - 1; x++) { gx += Math.abs(luminance(x + 1, y) - luminance(x, y)); gy += Math.abs(luminance(x, y + 1) - luminance(x, y)) }
    orientation = gy >= gx ? 'horizontal' : 'vertical'
  }
  let pw = Math.min(donor.width, orientation === 'vertical' ? 10 : 22), ph = Math.min(donor.height, orientation === 'horizontal' ? 10 : 22)
  const patches: Array<{ x: number; y: number; fineMean: number[] }> = [], seen = new Set<string>()
  const addPatch = (x: number, y: number) => {
    const key = x + ':' + y
    if (seen.has(key) || patches.length >= 4096) return
    seen.add(key)
    if (!inSurfaceBox(x, y) || !inSurfaceBox(x + pw - 1, y + ph - 1) || rect(integralTrusted, x, y, pw, ph) !== pw * ph || rect(integralCount, x, y, pw, ph) !== pw * ph) return
    const fm = [0, 0, 0]
    for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) for (let c = 0; c < 3; c++) { const at = index(x + dx, y + dy) * 3 + c; fm[c] += fine[at] }
    patches.push({ x, y, fineMean: fm.map(v => v / (pw * ph)) })
  }
  // Include several donor phases, then use spatially distributed original areas.
  const donorStep = Math.max(1, Math.ceil(Math.sqrt(donor.width * donor.height / 256)))
  for (let y = donor.y; y <= donor.y + donor.height - ph; y += donorStep) for (let x = donor.x; x <= donor.x + donor.width - pw; x += donorStep) addPatch(x, y)
  const patchStep = Math.max(2, Math.ceil(Math.sqrt(size / 3000)))
  for (let y = surface.y; y <= surface.y + sh - ph; y += patchStep) for (let x = surface.x; x <= surface.x + sw - pw; x += patchStep) addPatch(x, y)
  // A small but valid donor can be crossed by ink. Reduce only the texture
  // footprint, never the removal permission, until genuinely clean pixels fit.
  while (!patches.length && (pw > 3 || ph > 3)) {
    pw = Math.max(3, Math.floor(pw / 2)); ph = Math.max(3, Math.floor(ph / 2)); seen.clear()
    for (let y = surface.y; y <= surface.y + sh - ph; y += Math.max(1, Math.floor(patchStep / 2))) for (let x = surface.x; x <= surface.x + sw - pw; x += Math.max(1, Math.floor(patchStep / 2))) addPatch(x, y)
  }
  if (!patches.length) throw new Error('辅助结构补底没有完整可信的去墨纹理块，请扩大干净取样。')
  budget(patches.length * pw * ph * 3)
  const texture = new Float32Array(writeMap.length * 3), weights = new Float32Array(writeMap.length)
  const jumpX = Math.max(2, Math.floor(pw / 2)), jumpY = Math.max(2, Math.floor(ph / 2)), b = removal.boundsPx
  for (let by = -ph; by < removal.height; by += jumpY) {
    cancel()
    for (let bx = -pw; bx < removal.width; bx += jumpX) {
      const patch = patches[hash(b.x + bx, b.y + by, 137) % patches.length]
      for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) {
        const x = b.x + bx + dx, y = b.y + by + dy
        if (!writable(x, y)) continue
        const i = (y - b.y) * removal.width + x - b.x, source = index(patch.x + dx, patch.y + dy) * 3
        const w = Math.sin(Math.PI * (dx + .5) / pw) ** 2 * Math.sin(Math.PI * (dy + .5) / ph) ** 2
        weights[i] += w
        for (let c = 0; c < 3; c++) texture[i * 3 + c] += (fine[source + c] - patch.fineMean[c]) * w
      }
    }
  }
  // Match de-inked original colours at the real hole edge at full resolution.
  // This correction only consumes captured clean neighbours; excluded objects,
  // protected pixels and preceding repairs cannot become fixed boundary values.
  const correction = new Float32Array(writeMap.length * 3), fixed = new Uint8Array(writeMap.length)
  for (let y = 0; y < removal.height; y++) for (let x = 0; x < removal.width; x++) {
    const i = y * removal.width + x
    if (!writeMap[i]) continue
    let count = 0; const value = [0, 0, 0]
    for (const [dx, dy] of steps) {
      const sx = b.x + x + dx, sy = b.y + y + dy
      if (!trusted(sx, sy) || !clean[index(sx, sy)]) continue
      count++; for (let c = 0; c < 3; c++) value[c] += mean(sx, sy, 2, c) - tone(sx, sy, c)
    }
    if (count) { fixed[i] = 1; for (let c = 0; c < 3; c++) correction[i * 3 + c] = clamp(value[c] / count, -12, 12) }
  }
  // Initialize each actual connected hole from its own observed edge, rather
  // than leaving the centre at zero and forming a rectangle with a narrow halo.
  const visited = new Uint8Array(writeMap.length), queue = new Uint32Array(writeMap.length)
  for (let start = 0; start < writeMap.length; start++) if (writeMap[start] && !visited[start]) {
    let head = 0, tail = 1, fixedCount = 0; const sum = [0, 0, 0]
    queue[0] = start; visited[start] = 1
    while (head < tail) {
      const i = queue[head++], x = i % removal.width, y = Math.floor(i / removal.width)
      if (fixed[i]) { fixedCount++; for (let c = 0; c < 3; c++) sum[c] += correction[i * 3 + c] }
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy, n = ny * removal.width + nx
        if (nx < 0 || ny < 0 || nx >= removal.width || ny >= removal.height || !writeMap[n] || visited[n]) continue
        visited[n] = 1; queue[tail++] = n
      }
    }
    if (fixedCount) for (let j = 0; j < tail; j++) if (!fixed[queue[j]]) for (let c = 0; c < 3; c++) correction[queue[j] * 3 + c] = sum[c] / fixedCount
  }
  const correctionPasses = Math.min(160, Math.max(50, Math.floor(20_000_000 / writeMap.length)))
  budget(writeMap.length * correctionPasses)
  for (let pass = 0; pass < correctionPasses; pass++) {
    cancel()
    for (let parity = 0; parity < 2; parity++) for (let y = 0; y < removal.height; y++) for (let x = (y + parity) % 2; x < removal.width; x += 2) {
      const i = y * removal.width + x
      if (!writeMap[i] || fixed[i]) continue
      let count = 0; const values = [0, 0, 0]
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= removal.width || ny >= removal.height || !writeMap[ny * removal.width + nx]) continue
        count++; for (let c = 0; c < 3; c++) values[c] += correction[(ny * removal.width + nx) * 3 + c]
      }
      if (count) for (let c = 0; c < 3; c++) correction[i * 3 + c] += 1.4 * (values[c] / (count + .002) - correction[i * 3 + c])
    }
  }
  const profileFromColors = (colors: number[][]): Profile | undefined => {
    const n = colors.length, background = [0, 1, 2].map(c => quantile(colors.map(v => v[c]), .8))
    const depths = colors.map(v => Math.max(0, background.reduce((sum, t, c) => sum + t - v[c], 0) / 3))
    let peak = 0
    for (let i = 1; i < n; i++) if (depths[i] > depths[peak]) peak = i
    if (depths[peak] < 5) return undefined
    let first = peak, last = peak
    while (first > 0 && depths[first - 1] > Math.max(2.5, depths[peak] * .09)) first--
    while (last + 1 < n && depths[last + 1] > Math.max(2.5, depths[peak] * .09)) last++
    if (first === 0 || last === n - 1 || last - first > 10) return undefined
    let total = 0, position = 0
    for (let i = first; i <= last; i++) { total += depths[i]; position += depths[i] * i }
    const centre = position / total
    return { centre, radius: Math.min(9, Math.max(centre - first, last - centre) + 1.5), values: colors.map((v, i) => v.map((t, c) => i >= first - 1 && i <= last + 1 ? clamp(background[c] - t, 0, 180) : 0)) }
  }
  const strokes: Stroke[] = []
  for (const guide of guides) {
    if (guide.stroke === 'original-segment') continue
    const r = guide.reference, horizontal = guide.axis === 'horizontal', n = horizontal ? r.height : r.width, length = horizontal ? r.width : r.height, colors: number[][] = []
    for (let v = 0; v < n; v++) {
      const channels: number[][] = [[], [], []]
      for (let u = 0; u < length; u++) for (let c = 0; c < 3; c++) channels[c].push(rgb(r.x + (horizontal ? u : v), r.y + (horizontal ? v : u), c))
      colors.push(channels.map(values => quantile(values, .5)))
    }
    const profile = profileFromColors(colors)
    if (!profile) throw new Error('结构线参考中没有独立窄线及两侧底色，不能把平色或宽阴影当作板缝。')
    strokes.push({ points: guide.points.map(p => ({ ...p })), profile, explicit: true, axis: guide.axis })
  }
  // Only paired visible narrow strokes may bridge automatically. No hidden
  // board heads, unilateral long extensions or regular board-spacing invention.
  if (orientation !== 'soft') {
    const horizontal = orientation === 'horizontal', across = horizontal ? removal.height : removal.width, along = horizontal ? removal.width : removal.height
    const sideColors: Array<Array<number[] | undefined>> = [[], []]
    const ends: Array<Array<{ x: number; y: number } | undefined>> = [[], []]
    for (let row = 0; row < across; row++) {
      let first = -1, last = -1
      for (let col = 0; col < along; col++) { const x = b.x + (horizontal ? col : row), y = b.y + (horizontal ? row : col); if (writable(x, y)) { if (first < 0) first = col; last = col } }
      for (const side of [0, 1]) {
        const col = side ? last + 1 : first - 1, x = b.x + (horizontal ? col : row), y = b.y + (horizontal ? row : col), colors: number[][] = [[], [], []]
        if (first >= 0) for (let k = 0; k < 3; k++) {
          const sx = x + (horizontal ? (side ? k : -k) : 0), sy = y + (horizontal ? 0 : side ? k : -k)
          if (!trusted(sx, sy)) break
          for (let c = 0; c < 3; c++) colors[c].push(rgb(sx, sy, c))
        }
        sideColors[side].push(colors[0].length === 3 ? colors.map(v => quantile(v, .5)) : undefined)
        ends[side].push(first >= 0 ? { x, y } : undefined)
      }
    }
    const detected: Array<Array<{ position: number; point: { x: number; y: number }; profile: Profile }>> = [[], []]
    for (const side of [0, 1]) for (let row = 2; row < across - 2; row++) {
      const values = sideColors[side].slice(Math.max(0, row - 5), Math.min(across, row + 6))
      if (values.length < 7 || values.some(v => !v)) continue
      const profile = profileFromColors(values as number[][])
      if (!profile || Math.abs(profile.centre - Math.min(5, row)) > 1 || !ends[side][row]) continue
      const position = row + profile.centre - Math.min(5, row), previous = detected[side].at(-1)
      if (previous && position - previous.position < 5) continue
      const point = { ...ends[side][row]! }; if (horizontal) point.y = b.y + position; else point.x = b.x + position
      detected[side].push({ position, point, profile })
    }
    const used = new Set<number>()
    for (const left of detected[0]) {
      const right = detected[1].map((v, i) => ({ v, i })).filter(({ v, i }) => !used.has(i) && Math.abs(v.position - left.position) <= 4).sort((a, c) => Math.abs(a.v.position - left.position) - Math.abs(c.v.position - left.position))[0]
      if (!right) continue
      used.add(right.i)
      const mid = { x: (left.point.x + right.v.point.x) / 2, y: (left.point.y + right.v.point.y) / 2 }
      if (strokes.some(stroke => stroke.explicit && stroke.points.some((point, i) => i > 0 && segmentDistance(mid.x, mid.y, stroke.points[i - 1], point).distance < Math.max(7, stroke.profile.radius + 2)))
        || guides.some(guide => guide.stroke === 'original-segment' && guide.points.some((point, i) => i > 0 && segmentDistance(mid.x, mid.y, guide.points[i - 1], point).distance < 9))) continue
      strokes.push({ points: [left.point, right.v.point], profile: left.profile, endProfile: right.v.profile, explicit: false, axis: orientation })
      if (strokes.length >= 96) break
    }
  }
  const ink = new Float32Array(writeMap.length * 3)
  for (const guide of guides) if (guide.stroke === 'original-segment') {
    const reference = prepareOriginalSurfaceStroke(image, guide.reference, guide.axis, cancel, guide.paper)
    budget(guide.reference.width * guide.reference.height * (guide.paper ? 9 : 6))
    rasterOriginalSurfaceStroke(reference, guide.points, b, writable, (x, y, c) => trusted(x, y) ? Math.max(0, tone(x, y, c) - rgb(x, y, c)) : undefined, ink, budget, cancel)
  }
  const profileAt = (profile: Profile, offset: number, c: number) => {
    const position = profile.centre + offset, first = Math.floor(position), t = position - first
    return (profile.values[first]?.[c] ?? 0) * (1 - t) + (profile.values[first + 1]?.[c] ?? 0) * t
  }
  for (const stroke of strokes) {
    cancel()
    for (let segment = 1; segment < stroke.points.length; segment++) {
      const a = stroke.points[segment - 1], z = stroke.points[segment], radius = Math.max(stroke.profile.radius, stroke.endProfile?.radius ?? 0)
      const x0 = Math.max(b.x, Math.floor(Math.min(a.x, z.x) - radius)), y0 = Math.max(b.y, Math.floor(Math.min(a.y, z.y) - radius))
      const x1 = Math.min(b.x + b.width - 1, Math.ceil(Math.max(a.x, z.x) + radius)), y1 = Math.min(b.y + b.height - 1, Math.ceil(Math.max(a.y, z.y) + radius))
      budget(Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (writable(x, y)) {
        const position = segmentDistance(x, y, a, z)
        if (position.distance > radius) continue
        const signed = position.signed * (stroke.axis === 'horizontal' ? Math.sign(z.x - a.x) || 1 : -(Math.sign(z.y - a.y) || 1))
        const endFade = position.outside ? Math.max(0, 1 - position.outside) : 1
        const at = ((y - b.y) * removal.width + x - b.x) * 3
        for (let c = 0; c < 3; c++) {
          const value = stroke.endProfile ? profileAt(stroke.profile, signed, c) * (1 - position.t) + profileAt(stroke.endProfile, signed, c) * position.t : profileAt(stroke.profile, signed, c)
          ink[at + c] = Math.max(ink[at + c], value * endFade)
        }
      }
    }
  }
  replaceImageSurfaceDetailInk(ink, b, detailPatches, writable, cancel)
  const data = image.data.slice()
  for (let y = 0; y < removal.height; y++) {
    cancel()
    for (let x = 0; x < removal.width; x++) {
      const i = y * removal.width + x
      if (!writeMap[i]) continue
      const at = ((y + b.y) * image.width + x + b.x) * 4
      for (let c = 0; c < 3; c++) data[at + c] = tone(x + b.x, y + b.y, c) + correction[i * 3 + c] + texture[i * 3 + c] / Math.max(.001, weights[i]) - ink[i * 3 + c]
      data[at + 3] = 255
    }
  }
  cancel()
  const pixels = applyImageSurfaceDetailPatches({ width: image.width, height: image.height, data }, detailPatches, writable, trusted, cancel)
  if (!toneSamples || !toneSampleCounts || !toneUsedCounts) return { pixels }
  // Capture comparison colours from the original observations, never from the
  // subsequently solved grid or any generated pixel. Fixed 24px neighbors,
  // <= 25 write-membership probes per cell and <= 20 comparison probes bound
  // diagnostics independently of texture/guide work, with no extra RGB scan.
  const observed = new Map(centers.map(sample => [sample.y * gw + sample.x, sample]))
  type TonePair = { source: number; neighbor: number; channel: number; luminance: number }
  const selected: TonePair[] = []
  const nearWrite = (gx: number, gy: number) => {
    for (let dy = -8; dy <= 8; dy += 4) for (let dx = -8; dx <= 8; dx += 4) if (writable(surface.x + gx * cell + 1 + dx, surface.y + gy * cell + 1 + dy)) return true
    return false
  }
  for (const sample of centers) {
    cancel()
    if (!nearWrite(sample.x, sample.y)) continue
    const source = sample.y * gw + sample.x
    let best: TonePair | undefined
    for (let radius = 2; radius <= 6; radius++) for (const [dx, dy] of steps) {
      const x = sample.x + dx * radius, y = sample.y + dy * radius
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue
      const other = observed.get(y * gw + x)
      if (!other) continue
      const channel = Math.max(...other.color.map((value, c) => Math.abs(value - sample.color[c])))
      const luminance = other.color.reduce((sum, value, c) => sum + value - sample.color[c], 0) / 3
      if (channel < 18 || luminance < 12) continue
      if (!best || channel > best.channel) best = { source, neighbor: y * gw + x, channel, luminance }
    }
    if (!best) continue
    // Keep eight separated sites, preferring the strongest observed conflict.
    // This does not classify any dark original line or shadow as removable.
    const nearby = selected.findIndex(pair => Math.hypot(pair.source % gw - sample.x, Math.floor(pair.source / gw) - sample.y) < 3)
    if (nearby >= 0) { if (best.channel > selected[nearby].channel) selected[nearby] = best }
    else selected.push(best)
    selected.sort((a, b) => b.channel - a.channel || a.source - b.source)
    if (selected.length > 8) selected.pop()
  }
  const describe = (at: number): GuidedToneObservation => {
    const sample = observed.get(at)!, samples: GuidedToneObservation['samples'] = []
    for (let i = 0; i < toneSampleCounts[at]; i++) {
      const source = toneSamples[at * 4 + i], x = source % image.width, y = Math.floor(source / image.width)
      samples.push({ x, y, rgb: [0, 1, 2].map(c => rgb(x, y, c)) })
    }
    const x = Math.max(surface.x, surface.x + sample.x * cell - 2), y = Math.max(surface.y, surface.y + sample.y * cell - 2)
    return { boundsPx: { x, y, width: Math.min(surface.x + sw, surface.x + sample.x * cell + 6) - x, height: Math.min(surface.y + sh, surface.y + sample.y * cell + 6) - y }, rgb: [...sample.color], usedPixels: toneUsedCounts[at], samples }
  }
  const report: GuidedToneReport = { algorithm: 'guided-tone-observations-v1', gates: { channelDifference: 18, luminanceDifference: 12, radiusPx: 24 },
    observations: selected.map(pair => ({ source: describe(pair.source), neighbor: describe(pair.neighbor), channelDifference: pair.channel, luminanceDifference: pair.luminance })) }
  cancel(); return { pixels, report }
}

function segmentDistance(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy, length = Math.sqrt(square)
  const raw = square ? ((x - a.x) * dx + (y - a.y) * dy) / square : 0, t = clamp(raw, 0, 1)
  return { t, distance: Math.hypot(x - a.x - dx * t, y - a.y - dy * t), signed: length ? ((x - a.x) * -dy + (y - a.y) * dx) / length : 0,
    outside: raw < 0 ? -raw * length : raw > 1 ? (raw - 1) * length : 0 }
}
