import type { ImagePixelMask, ImagePixels, PixelBounds } from '../image-import/pixels.js'
import { maskCoverage } from '../image-import/repair-scope.js'
import type { CancellationSignal } from '../ports/resources.js'

export interface ImageSubjectReferences {
  foreground: ImagePixelMask
  background: ImagePixelMask
  mixed: ImagePixelMask
}
export interface ImageSubjectReferenceOptions extends ImageSubjectReferences {
  bandPx: 1 | 2
  strength: 'gentle' | 'balanced' | 'strong'
  foregroundProtectionMask?: ImagePixelMask
  excludedEvidenceMask?: ImagePixelMask
  removalMask?: ImagePixelMask
}
type Reason = 'unconfirmed-role' | 'reference-residual' | 'reference-distance' | 'reference-excluded'
export interface ImageSubjectReferenceResult {
  method: 'subject-reference-v1'
  pixels: ImagePixels & { boundsPx: PixelBounds }
  coveragePixels: ImagePixels & { boundsPx: PixelBounds }
  uncertaintyMask: ImagePixelMask
  metrics: { candidatePixels: number; alphaChangedPixels: number; rgbChangedPixels: number; estimatedPixels: number;
    uncertainPixels: number; protectedPixels: number; unconfirmedPixels: number; stableForegroundPixels: number;
    stableBackgroundPixels: number; coverageIsEstimated: true; foregroundIsEstimated: true; colorSpace: 'captured-srgb' }
  issues: Array<{ boundsPx: PixelBounds; reason: Reason; message: string }>
  referenceEvidence: { foreground: { x: number; y: number }[]; background: { x: number; y: number }[]; foregroundRgb: number[]; backgroundRgb: number[] }
}
const messages: Record<Reason, string> = {
  'unconfirmed-role': '尚未确认为可处理混色边；真实饰边、暗部与捕获混色均有可能，保留当前像素。',
  'reference-residual': '此处与给定主体／背景颜色的混合不符，或接近实心主体；保留当前像素，核对材质与阴影角色。',
  'reference-distance': '此处距明确参考超过64原像素；请在同一局部补充可信参考。',
  'reference-excluded': '保护、邻物、取证排除、孔洞或非不透明捕获限制此处处理；保留当前像素。',
}
const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]

/** Explicit role guidance grants only a local write scope, never a truth label.
 * Analysis/derived RGB does not supply references. Unmarked pixels keep baseline
 * RGBA; the host may explicitly choose geometric coverage as that baseline. */
export function refineImageSubjectReferences(source: ImagePixels, selection: ImagePixelMask,
  baseline: ImagePixels & { boundsPx: PixelBounds }, options: ImageSubjectReferenceOptions,
  signal?: CancellationSignal): ImageSubjectReferenceResult {
  const cancel = () => { if (signal?.aborted) { const error = new Error('局部参考精修已取消。'); error.name = 'AbortError'; throw error } }
  cancel()
  if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width > 8192 || source.height > 8192 || source.width * source.height > 32_000_000
    || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) throw new Error('局部参考需要完整原图RGBA。')
  const check = (mask: ImagePixelMask, reference = false) => {
    const b = mask?.boundsPx
    if (!b || ![b.x, b.y, b.width, b.height, mask.width, mask.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0
      || b.width < 1 || b.height < 1 || b.width !== mask.width || b.height !== mask.height || b.x + b.width > source.width || b.y + b.height > source.height
      || b.width * b.height > (reference ? 4096 : 1_000_000) || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) throw new Error('局部参考蒙版范围或尺寸无效。')
  }
  check(selection); check(options.foreground, true); check(options.background, true); check(options.mixed)
  for (const mask of [options.foregroundProtectionMask, options.excludedEvidenceMask, options.removalMask]) if (mask) check(mask)
  for (const mask of [options.foreground, options.background, options.mixed]) if (!mask.data.some(Boolean) || mask.data.some(a => a !== 0 && a !== 255)) throw new Error('角色参考须为非空二值蒙版。')
  if (![1, 2].includes(options.bandPx) || !['gentle', 'balanced', 'strong'].includes(options.strength)) throw new Error('局部参考需要1或2像素边带及明确强度。')
  const b = baseline.boundsPx, width = baseline.width, height = baseline.height, size = width * height
  if (!b || ![b.x, b.y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || b.width !== width || b.height !== height
    || b.x < 0 || b.y < 0 || b.x + width > source.width || b.y + height > source.height || size > 1_100_000
    || !(baseline.data instanceof Uint8ClampedArray) || baseline.data.length !== size * 4) throw new Error('局部参考需要同原图坐标的完整基线裁片。')
  const excluded = (x: number, y: number) => !!(maskCoverage(options.excludedEvidenceMask, x, y) || maskCoverage(options.foregroundProtectionMask, x, y))
  const points = (mask: ImagePixelMask, foreground: boolean) => {
    const found: Array<{ x: number; y: number }> = []
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) {
      const sx = x + mask.boundsPx.x, sy = y + mask.boundsPx.y, alpha = maskCoverage(selection, sx, sy)
      if (excluded(sx, sy) || source.data[(sy * source.width + sx) * 4 + 3] !== 255
        || (foreground ? alpha !== 255 : alpha !== 0 || maskCoverage(options.removalMask, sx, sy) > 0)) throw new Error(foreground
          ? '主体色参考须全部位于未保护、未排除的原选中实心像素。' : '背景色参考须全部位于选区与移除范围外的可信原图。')
      found.push({ x: sx, y: sy })
      if (found.length > 64) throw new Error('每类颜色参考最多64个原图像素，请画短笔迹。')
    }
    if (found.length < 3) throw new Error('每类颜色参考至少需要3个原图像素，请画一小段同色笔迹。')
    return found
  }
  const fg = points(options.foreground, true), bg = points(options.background, false)
  const rgb = (p: { x: number; y: number }, c: number) => source.data[(p.y * source.width + p.x) * 4 + c]
  const colour = (samples: typeof fg) => [0, 1, 2].map(c => {
    const values = samples.map(p => rgb(p, c))
    if (Math.max(...values) - Math.min(...values) > 18) throw new Error('颜色参考变化过大，请缩短到同材质同色笔迹。')
    return median(values)
  })
  const F = colour(fg), B = colour(bg), v = F.map((f, c) => f - B[c]), square = v.reduce((sum, a) => sum + a * a, 0)
  if (square < 36 ** 2) throw new Error('主体与背景参考颜色过近，无法稳定估计；请保留未决。')
  const pixels = { ...baseline, data: baseline.data.slice(), boundsPx: { ...b } }, coveragePixels = { ...pixels, data: pixels.data.slice() }
  const uncertainty = new Uint8Array(size), issues: ImageSubjectReferenceResult['issues'] = [], keys = new Map<string, number>()
  const metrics: ImageSubjectReferenceResult['metrics'] = { candidatePixels: 0, alphaChangedPixels: 0, rgbChangedPixels: 0, estimatedPixels: 0,
    uncertainPixels: 0, protectedPixels: 0, unconfirmedPixels: 0, stableForegroundPixels: fg.length, stableBackgroundPixels: bg.length,
    coverageIsEstimated: true, foregroundIsEstimated: true, colorSpace: 'captured-srgb' }
  const mark = (x: number, y: number, reason: Reason) => {
    const i = (y - b.y) * width + x - b.x
    if (!uncertainty[i]) { uncertainty[i] = 255; metrics.uncertainPixels++ }
    const key = reason + ':' + Math.floor(x / 12) + ':' + Math.floor(y / 12), at = keys.get(key)
    if (at !== undefined) { const r = issues[at].boundsPx, right = Math.max(r.x + r.width, x + 1), bottom = Math.max(r.y + r.height, y + 1)
      r.x = Math.min(r.x, x); r.y = Math.min(r.y, y); r.width = right - r.x; r.height = bottom - r.y }
    else if (issues.length < 32) { keys.set(key, issues.length); issues.push({ boundsPx: { x, y, width: 1, height: 1 }, reason, message: messages[reason] }) }
  }
  // Flood exterior zeros using geometry only; inner holes and their edge bands remain intact.
  const sw = selection.width + 2, sh = selection.height + 2, exterior = new Uint8Array(sw * sh), queue = new Uint32Array(sw * sh)
  let head = 0, tail = 1; exterior[0] = 1
  while (head < tail) {
    if (!(head % 4096)) cancel()
    const i = queue[head++], x = i % sw, y = Math.floor(i / sw)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, n = ny * sw + nx
      if (nx < 0 || ny < 0 || nx >= sw || ny >= sh || exterior[n]) continue
      if (nx > 0 && ny > 0 && nx < sw - 1 && ny < sh - 1 && selection.data[(ny - 1) * selection.width + nx - 1]) continue
      exterior[n] = 1; queue[tail++] = n
    }
  }
  const isExterior = (x: number, y: number) => x < selection.boundsPx.x || y < selection.boundsPx.y
    || x >= selection.boundsPx.x + selection.width || y >= selection.boundsPx.y + selection.height
    || exterior[(y - selection.boundsPx.y + 1) * sw + x - selection.boundsPx.x + 1] > 0
  const mix = { gentle: .45, balanced: .7, strong: 1 }[options.strength], refs = new Set([...fg, ...bg].map(p => p.y * source.width + p.x))
  let comparisons = 0
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) {
      const sx = b.x + x, sy = b.y + y, i = y * width + x, to = i * 4, from = (sy * source.width + sx) * 4
      if (!maskCoverage(selection, sx, sy) || !baseline.data[to + 3]) continue
      let outside = false, hole = false
      for (let dy = -options.bandPx; dy <= options.bandPx; dy++) for (let dx = -options.bandPx; dx <= options.bandPx; dx++) {
        if (maskCoverage(selection, sx + dx, sy + dy)) continue
        if (isExterior(sx + dx, sy + dy)) outside = true; else hole = true
      }
      if (!outside) continue
      metrics.candidatePixels++
      if (maskCoverage(options.foregroundProtectionMask, sx, sy)) { metrics.protectedPixels++; continue }
      if (!maskCoverage(options.mixed, sx, sy)) {
        metrics.unconfirmedPixels++
        // Retaining the rest of the item is expected, not hundreds of new
        // questions. Only neighbouring gaps in this local guidance are issues.
        const local = options.mixed.boundsPx
        if (sx >= local.x - 2 && sy >= local.y - 2 && sx < local.x + local.width + 2 && sy < local.y + local.height + 2) mark(sx, sy, 'unconfirmed-role')
        continue
      }
      if (excluded(sx, sy) || hole || source.data[from + 3] !== 255 || refs.has(sy * source.width + sx)) { mark(sx, sy, 'reference-excluded'); continue }
      let core = false
      for (let dy = -3; dy <= 3 && !core; dy++) for (let dx = -3; dx <= 3 && !core; dx++) {
        let solid = true
        for (let yy = -1; yy <= 1 && solid; yy++) for (let xx = -1; xx <= 1; xx++) {
          if (++comparisons > 45_000_000) throw new Error('局部参考超过4500万次比较预算，请缩小混色边范围。')
          if (maskCoverage(selection, sx + dx + xx, sy + dy + yy) !== 255) { solid = false; break }
        }
        // A nearby body across a transparent slit is not support for a thin rod.
        const steps = Math.max(Math.abs(dx), Math.abs(dy))
        for (let step = 1; step <= steps && solid; step++) if (maskCoverage(selection, sx + Math.round(dx * step / steps), sy + Math.round(dy * step / steps)) !== 255) solid = false
        core = solid
      }
      if (!core) { mark(sx, sy, 'reference-excluded'); continue }
      if ([fg, bg].some(samples => !samples.some(p => Math.hypot(p.x - sx, p.y - sy) <= 64))) { mark(sx, sy, 'reference-distance'); continue }
      const C = [0, 1, 2].map(c => source.data[from + c]), beta = C.reduce((sum, c, k) => sum + (c - B[k]) * v[k], 0) / square
      const residual = Math.max(...C.map((c, k) => Math.abs(c - (B[k] + beta * v[k]))))
      if (beta < .12 || beta >= .97 || residual > 6) { mark(sx, sy, 'reference-residual'); continue }
      const a = Math.max(1, Math.round(baseline.data[to + 3] + (beta * 255 - baseline.data[to + 3]) * mix)), alpha = a / 255
      const front = C.map((c, k) => (c - (1 - alpha) * B[k]) / alpha)
      if (front.some(c => c < -2 || c > 257)) { mark(sx, sy, 'reference-residual'); continue }
      pixels.data[to + 3] = coveragePixels.data[to + 3] = a
      for (let k = 0; k < 3; k++) pixels.data[to + k] = Math.max(0, Math.min(255, Math.round(front[k])))
      metrics.estimatedPixels++
      if (a !== baseline.data[to + 3]) metrics.alphaChangedPixels++
      if (front.some((_, k) => pixels.data[to + k] !== baseline.data[to + k])) metrics.rgbChangedPixels++
    }
  }
  cancel()
  return { method: 'subject-reference-v1', pixels, coveragePixels,
    uncertaintyMask: { width, height, boundsPx: { ...b }, data: uncertainty }, metrics, issues,
    referenceEvidence: { foreground: fg, background: bg, foregroundRgb: F, backgroundRgb: B } }
}
