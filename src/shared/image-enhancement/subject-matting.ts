import type { ImagePixelMask, ImagePixels, PixelBounds } from '../image-import/pixels.js'
import { maskCoverage } from '../image-import/repair-scope.js'
import type { CancellationSignal } from '../ports/resources.js'

export interface ImageSubjectMatteOptions {
  bandPx: 1 | 2
  strength: 'gentle' | 'balanced' | 'strong'
  excludedEvidenceMask?: ImagePixelMask
  foregroundProtectionMask?: ImagePixelMask
}
export type ImageSubjectMatteIssueReason = 'low-contrast' | 'unstable-foreground' | 'unstable-background' | 'model-residual' | 'thin-feature' | 'excluded-evidence'
export interface ImageSubjectMatteMetrics {
  candidatePixels: number
  alphaChangedPixels: number
  rgbChangedPixels: number
  uncertainPixels: number
  protectedPixels: number
  stableForegroundPixels: number
  stableBackgroundPixels: number
  binaryBoundaryPixels: number
  fractionalBoundaryPixels: number
  estimatedPixels: number
  coreChangedPixels: 0
  outsideSupportChangedPixels: 0
  holeChangedPixels: 0
  coverageIsEstimated: true
  foregroundIsEstimated: true
  colorSpace: 'captured-srgb'
}
export interface ImageSubjectMatteResult {
  method: 'subject-matte-v1'
  pixels: ImagePixels & { boundsPx: PixelBounds }
  /** Captured original RGB, with only accepted inner-band alpha estimates. */
  coveragePixels: ImagePixels & { boundsPx: PixelBounds }
  uncertaintyMask: ImagePixelMask
  metrics: ImageSubjectMatteMetrics
  issues: Array<{ boundsPx: PixelBounds; reason: ImageSubjectMatteIssueReason; message: string }>
}
interface Sample { x: number; y: number; rgb: number[]; distance: number }
interface StableSamples { rgb: number[]; samples: Sample[] }
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v))
const messages: Record<ImageSubjectMatteIssueReason, string> = {
  'low-contrast': '内外颜色过近，无法可靠区分覆盖率；保留原裁片。',
  'unstable-foreground': '内侧没有足够稳定的同色主体依据，可能是描边或饰边；保留原色与覆盖率。',
  'unstable-background': '外侧底材不稳定或可见依据不足，无法可靠估计混色；保留原裁片。',
  'model-residual': '当前边色不能由可信内外颜色解释，可能是真实饰边、压缩误差或其他材质；保留未决。',
  'thin-feature': '细杆、尖端或窄边没有独立的实心内侧依据；保持几何与原色。',
  'excluded-evidence': '局部取证被排除或保护范围挡住；不读取这些颜色作推断。',
}

/** Estimate a subject's existing inner edge from original straight RGBA only.
 * Binary selections may contain captured antialiasing in RGB. Stable local F/B
 * must explain C in C=alpha F+(1-alpha)B before either alpha or RGB can change.
 * This never expands/erases support, edits a core/hole, or recovers hidden truth. */
export function refineImageSubject(source: ImagePixels, selection: ImagePixelMask, options: ImageSubjectMatteOptions,
  signal?: CancellationSignal): ImageSubjectMatteResult {
  const cancel = () => { if (signal?.aborted) { const error = new Error('主体精细抠图已取消。'); error.name = 'AbortError'; throw error } }
  cancel()
  if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width > 8192 || source.height > 8192 || source.width * source.height > 32_000_000 || !(source.data instanceof Uint8ClampedArray)
    || source.data.length !== source.width * source.height * 4) throw new Error('主体抠图需要完整原图RGBA，最多3200万像素。')
  const checkMask = (mask: ImagePixelMask | undefined, required = false) => {
    if (!mask) { if (required) throw new Error('主体抠图缺少选区。'); return }
    const b = mask.boundsPx
    if (!b || ![b.x, b.y, b.width, b.height, mask.width, mask.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1
      || b.width !== mask.width || b.height !== mask.height || b.x + b.width > source.width || b.y + b.height > source.height || b.width * b.height > 1_000_000
      || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) throw new Error('主体选区和证据范围须位于原图内且最多100万像素。')
  }
  checkMask(selection, true)
  if (!options || options.bandPx !== 1 && options.bandPx !== 2 || !['gentle', 'balanced', 'strong'].includes(options.strength)) throw new Error('主体抠图需要1或2像素边带及明确强度。')
  checkMask(options.excludedEvidenceMask); checkMask(options.foregroundProtectionMask)
  const { width, height, boundsPx: b } = selection, size = width * height, band = options.bandPx
  const pixels = new Uint8ClampedArray(size * 4), coveragePixels = new Uint8ClampedArray(size * 4), uncertainty = new Uint8Array(size)
  const metrics: ImageSubjectMatteMetrics = { candidatePixels: 0, alphaChangedPixels: 0, rgbChangedPixels: 0, uncertainPixels: 0, protectedPixels: 0,
    stableForegroundPixels: 0, stableBackgroundPixels: 0, binaryBoundaryPixels: 0, fractionalBoundaryPixels: 0, estimatedPixels: 0,
    coreChangedPixels: 0, outsideSupportChangedPixels: 0, holeChangedPixels: 0, coverageIsEstimated: true, foregroundIsEstimated: true, colorSpace: 'captured-srgb' }
  const issues: ImageSubjectMatteResult['issues'] = [], issueKeys = new Map<string, number>()
  const mark = (x: number, y: number, reason: ImageSubjectMatteIssueReason) => {
    const i = y * width + x
    if (!uncertainty[i]) { uncertainty[i] = 255; metrics.uncertainPixels++ }
    const sx = x + b.x, sy = y + b.y, key = reason + ':' + Math.floor(sx / 12) + ':' + Math.floor(sy / 12), old = issueKeys.get(key)
    if (old !== undefined) {
      const bounds = issues[old].boundsPx, right = Math.max(bounds.x + bounds.width, sx + 1), bottom = Math.max(bounds.y + bounds.height, sy + 1)
      bounds.x = Math.min(bounds.x, sx); bounds.y = Math.min(bounds.y, sy); bounds.width = right - bounds.x; bounds.height = bottom - bounds.y
    } else if (issues.length < 32) { issueKeys.set(key, issues.length); issues.push({ boundsPx: { x: sx, y: sy, width: 1, height: 1 }, reason, message: messages[reason] }) }
  }
  const atSource = (x: number, y: number) => (y * source.width + x) * 4
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < source.width && y < source.height
  const coverage = (x: number, y: number) => x >= b.x && y >= b.y && x < b.x + width && y < b.y + height ? selection.data[(y - b.y) * width + x - b.x] : 0
  const blocked = (x: number, y: number) => maskCoverage(options.excludedEvidenceMask, x, y) > 0 || maskCoverage(options.foregroundProtectionMask, x, y) > 0
  let comparisons = 0
  const budget = (amount: number) => { comparisons += amount; if (comparisons > 45_000_000) throw new Error('主体边带估计超过比较预算，请缩小选区或拆开处理。') }
  // Zero coverage connected to the outside only. Enclosed holes remain exactly
  // as captured, including their surrounding narrow contours.
  const ew = width + 2, eh = height + 2, exterior = new Uint8Array(ew * eh), queue = new Uint32Array(ew * eh)
  let head = 0, tail = 1; exterior[0] = 1; queue[0] = 0
  while (head < tail) {
    if (!(head % 4096)) cancel()
    const i = queue[head++], x = i % ew, y = Math.floor(i / ew)
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, n = ny * ew + nx
      if (nx < 0 || ny < 0 || nx >= ew || ny >= eh || exterior[n]) continue
      if (nx > 0 && ny > 0 && nx <= width && ny <= height && selection.data[(ny - 1) * width + nx - 1]) continue
      exterior[n] = 1; queue[tail++] = n
    }
  }
  const outerClear = (x: number, y: number) => x < b.x || y < b.y || x >= b.x + width || y >= b.y + height
    ? true : exterior[(y - b.y + 1) * ew + x - b.x + 1] > 0
  // Chebyshev distance from all zero coverage establishes a strict 1–2 px band
  // and a distinct full-opacity interior. No original colours enter geometry.
  const depth = new Uint8Array(size).fill(8)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (!selection.data[i]) depth[i] = 0
    else depth[i] = Math.min(8, x + 1, y + 1, width - x, height - y)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (x) depth[i] = Math.min(depth[i], depth[i - 1] + 1)
    if (y) { depth[i] = Math.min(depth[i], depth[i - width] + 1); if (x) depth[i] = Math.min(depth[i], depth[i - width - 1] + 1); if (x + 1 < width) depth[i] = Math.min(depth[i], depth[i - width + 1] + 1) }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x
    if (x + 1 < width) depth[i] = Math.min(depth[i], depth[i + 1] + 1)
    if (y + 1 < height) { depth[i] = Math.min(depth[i], depth[i + width] + 1); if (x) depth[i] = Math.min(depth[i], depth[i + width - 1] + 1); if (x + 1 < width) depth[i] = Math.min(depth[i], depth[i + width + 1] + 1) }
  }
  const clusters = (samples: Sample[], minimum: number, tolerance: number): StableSamples[] => {
    const remaining = [...samples].sort((a, z) => a.distance - z.distance || a.y - z.y || a.x - z.x), found: StableSamples[] = []
    while (remaining.length >= minimum && found.length < 6) {
      let best: Sample[] = []
      for (const seed of remaining) {
        const group = remaining.filter(p => p.rgb.every((v, c) => Math.abs(v - seed.rgb[c]) <= tolerance))
        if (group.length > best.length) best = group
      }
      budget(remaining.length * remaining.length)
      if (best.length < minimum) break
      const rgb = [0, 1, 2].map(c => median(best.map(p => p.rgb[c])))
      const tight = best.filter(p => p.rgb.every((v, c) => Math.abs(v - rgb[c]) <= tolerance))
      if (tight.length >= minimum) found.push({ rgb, samples: tight })
      const members = new Set(best)
      for (let i = remaining.length - 1; i >= 0; i--) if (members.has(remaining[i])) remaining.splice(i, 1)
    }
    return found
  }
  const foregroundUsed = new Set<number>(), backgroundUsed = new Set<number>(), amount = { gentle: .45, balanced: .7, strong: 1 }[options.strength]
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) {
      const i = y * width + x, a = selection.data[i], sx = b.x + x, sy = b.y + y, to = i * 4, from = atSource(sx, sy)
      if (!a) continue
      for (let c = 0; c < 3; c++) pixels[to + c] = coveragePixels[to + c] = source.data[from + c]
      pixels[to + 3] = coveragePixels[to + 3] = Math.round(source.data[from + 3] * a / 255)
      if (maskCoverage(options.foregroundProtectionMask, sx, sy)) { metrics.protectedPixels++; continue }
      if (depth[i] > band || !pixels[to + 3]) continue
      let nx = 0, ny = 0, nearest = Infinity, holeNearby = false
      for (let dy = -band; dy <= band; dy++) for (let dx = -band; dx <= band; dx++) {
        if (!dx && !dy || coverage(sx + dx, sy + dy)) continue
        if (!outerClear(sx + dx, sy + dy)) { holeNearby = true; continue }
        const distance = Math.hypot(dx, dy)
        if (distance < nearest - .01) { nearest = distance; nx = dx / distance; ny = dy / distance }
        else if (Math.abs(distance - nearest) < .01) { nx += dx / distance; ny += dy / distance }
      }
      if (!Number.isFinite(nearest) || holeNearby) continue
      metrics.candidatePixels++
      if (a === 255) metrics.binaryBoundaryPixels++; else metrics.fractionalBoundaryPixels++
      if (blocked(sx, sy)) { mark(x, y, 'excluded-evidence'); continue }
      if (source.data[from + 3] !== 255) { mark(x, y, 'model-residual'); continue }
      const normal = Math.hypot(nx, ny)
      if (normal < .2) { mark(x, y, 'thin-feature'); continue }
      nx /= normal; ny /= normal
      const inner: Sample[] = [], outer: Sample[] = []; let hasGeometricCore = false, blockedSamples = 0
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const distance = Math.hypot(dx, dy), px = sx + dx, py = sy + dy
        if (distance < .9 || distance > 5 || !valid(px, py)) continue
        const projection = (dx * nx + dy * ny) / distance, alpha = coverage(px, py), sourceAt = atSource(px, py)
        let role: 'inner' | 'outer' | undefined
        if (projection < .25 && alpha === 255) {
          const localX = px - b.x, localY = py - b.y, pi = localY * width + localX
          // Geometry witnesses the thick subject independently of colour. F may
          // lie on its thin ink outline rather than in a differently coloured fill.
          let connected = true
          for (let step = 1; step <= Math.ceil(distance); step++) if (!coverage(Math.round(sx + dx * step / Math.ceil(distance)), Math.round(sy + dy * step / Math.ceil(distance)))) { connected = false; break }
          if (connected) {
            if (depth[pi] >= band + 2 && projection < -.35) hasGeometricCore = true
            role = 'inner'
          }
        } else if (projection > .2 && !alpha && outerClear(px, py)) role = 'outer'
        if (!role) continue
        if (blocked(px, py)) { blockedSamples++; continue }
        if (source.data[sourceAt + 3] !== 255) continue
        const sample = { x: px, y: py, distance, rgb: [source.data[sourceAt], source.data[sourceAt + 1], source.data[sourceAt + 2]] }
        if (role === 'inner') inner.push(sample); else outer.push(sample)
      }
      budget(121 + inner.length * 3 + outer.length * 3)
      if (!hasGeometricCore) { mark(x, y, 'thin-feature'); continue }
      const coherentForeground = (f: StableSamples) => f.samples.some(p => (p.x - sx) * nx + (p.y - sy) * ny <= -.75)
      const allForegrounds = clusters(inner, 3, 7), backCandidates = clusters(outer, 5, 5)
      let foreCandidates = allForegrounds.filter(coherentForeground)
      if (!foreCandidates.length) { mark(x, y, blockedSamples && inner.length < 3 ? 'excluded-evidence' : 'unstable-foreground'); continue }
      if (!backCandidates.length) { mark(x, y, blockedSamples && outer.length < 5 ? 'excluded-evidence' : 'unstable-background'); continue }
      const color = [source.data[from], source.data[from + 1], source.data[from + 2]]
      // A partially captured next row can form a stable colour cluster too. If
      // it lies on the same F/B line as a deeper opaque cluster, it is evidence
      // of coverage rather than a second foreground material.
      foreCandidates = foreCandidates.filter(f => !foreCandidates.some(other => other !== f && backCandidates.some(background => {
        const v = other.rgb.map((t, c) => t - background.rgb[c]), square = v.reduce((s, t) => s + t * t, 0)
        if (square < 36 * 36) return false
        const alpha = v.reduce((s, t, c) => s + t * (f.rgb[c] - background.rgb[c]), 0) / square
        const residual = Math.sqrt(f.rgb.reduce((s, t, c) => s + (t - background.rgb[c] - alpha * v[c]) ** 2, 0) / 3)
        return alpha > .08 && alpha < .96 && residual < 2.5 && other.samples.some(p => (p.x - sx) * nx + (p.y - sy) * ny <= -1.75)
      })))
      // A true sampled trim colour is already a foreground explanation. Never
      // replace it with an equally plausible mixture of a different material.
      const contrastPossible = foreCandidates.some(f => backCandidates.some(background => Math.hypot(...f.rgb.map((v, c) => v - background.rgb[c])) >= 36))
      if (!contrastPossible) { mark(x, y, 'low-contrast'); continue }
      if (a === 255 && foreCandidates.some(f => f.samples.some(p => p.distance <= 3) && f.rgb.every((v, c) => Math.abs(v - color[c]) <= 3))) continue
      const pairs: Array<{ f: StableSamples; background: StableSamples; estimate: number; residual: number; score: number }> = []
      let strongContrast = false
      for (const f of foreCandidates) for (const background of backCandidates) {
        const vector = f.rgb.map((v, c) => v - background.rgb[c]), square = vector.reduce((sum, v) => sum + v * v, 0)
        // Weak separation magnifies even 1-level JPEG/rounding noise into alpha.
        if (square < 36 * 36) continue
        strongContrast = true
        const estimate = vector.reduce((sum, v, c) => sum + v * (color[c] - background.rgb[c]), 0) / square
        const residual = Math.sqrt(color.reduce((sum, v, c) => sum + (v - background.rgb[c] - estimate * vector[c]) ** 2, 0) / 3)
        if (estimate < .08 || estimate > 1.025 || residual > { gentle: 2.5, balanced: 3.5, strong: 4.5 }[options.strength]) continue
        const nearestF = Math.min(...f.samples.map(p => p.distance)), nearestB = Math.min(...background.samples.map(p => p.distance))
        const tangentSpan = f.samples.map(p => (p.x - sx) * -ny + (p.y - sy) * nx)
        const tangentWitness = Math.min(...tangentSpan) <= -.5 && Math.max(...tangentSpan) >= .5
        const inwardWitness = f.samples.some(p => (p.x - sx) * nx + (p.y - sy) * ny <= -.75)
        if (!inwardWitness || !tangentWitness || nearestF > 3 || nearestB > 3) continue
        // Reject competing distant background groups: the nearest side must
        // actually support this B, not just a remote colour in the same disc.
        const nearestOutside = outer.filter(p => p.distance <= nearestB + .8)
        if (nearestOutside.length && nearestOutside.filter(p => p.rgb.every((v, c) => Math.abs(v - background.rgb[c]) <= 8)).length < nearestOutside.length * .6) continue
        pairs.push({ f, background, estimate, residual, score: residual + nearestF * .3 + nearestB * .3 + 2 / Math.sqrt(f.samples.length) + 2 / Math.sqrt(background.samples.length) })
      }
      pairs.sort((a, z) => a.score - z.score)
      if (!pairs.length) { mark(x, y, backCandidates.length > 1 ? 'unstable-background' : strongContrast ? 'model-residual' : 'low-contrast'); continue }
      const best = pairs[0], alternative = pairs.find(p => p !== best && p.score - best.score < 1 && Math.abs(p.estimate - best.estimate) > .12)
      if (alternative) { mark(x, y, 'model-residual'); continue }
      const { f, background, estimate } = best
      for (const p of f.samples) foregroundUsed.add(p.y * source.width + p.x)
      for (const p of background.samples) backgroundUsed.add(p.y * source.width + p.x)
      // An opaque captured edge that is already consistent with the stable
      // foreground is a hard/true border, not an antialiasing defect.
      if (a === 255 && estimate >= .985) continue
      const newAlpha = Math.max(1, Math.round(a + (clamp(estimate, 1 / 255, 1) * 255 - a) * amount)), alpha = newAlpha / 255
      const foreground = color.map((v, c) => (v - (1 - alpha) * background.rgb[c]) / alpha)
      const fitForeground = color.map((v, c) => (v - (1 - clamp(estimate, .08, 1)) * background.rgb[c]) / clamp(estimate, .08, 1))
      if (foreground.some(v => v < -2 || v > 257) || fitForeground.some((v, c) => Math.abs(v - f.rgb[c]) > 16)) { mark(x, y, 'model-residual'); continue }
      let rgbChanged = false
      for (let c = 0; c < 3; c++) { pixels[to + c] = clamp(foreground[c], 0, 255); rgbChanged ||= pixels[to + c] !== color[c] }
      pixels[to + 3] = coveragePixels[to + 3] = newAlpha
      metrics.estimatedPixels++
      if (newAlpha !== a) metrics.alphaChangedPixels++
      if (rgbChanged) metrics.rgbChangedPixels++
    }
  }
  metrics.stableForegroundPixels = foregroundUsed.size; metrics.stableBackgroundPixels = backgroundUsed.size
  // Do not pepper an otherwise opaque outline with isolated estimated notches.
  // A local colour fit is necessary but a change also needs neighbouring edge
  // coverage support; this rejects isolated JPEG/model accidents deterministically.
  const accepted = new Uint8Array(size)
  for (let i = 0; i < size; i++) accepted[i] = Number(selection.data[i] > 0 && pixels[i * 4 + 3] !== Math.round(source.data[atSource(b.x + i % width, b.y + Math.floor(i / width)) + 3] * selection.data[i] / 255))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (!accepted[i]) continue
    let consistentNeighbors = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy || Math.abs(dx) + Math.abs(dy) > 3) continue
      const px = x + dx, py = y + dy, pi = py * width + px
      if (px < 0 || py < 0 || px >= width || py >= height || !accepted[pi]) continue
      if (Math.abs(pixels[pi * 4 + 3] - pixels[i * 4 + 3]) <= 72) consistentNeighbors++
    }
    if (consistentNeighbors >= 2) continue
    const from = atSource(x + b.x, y + b.y), to = i * 4, originalAlpha = Math.round(source.data[from + 3] * selection.data[i] / 255)
    if (pixels[to + 3] !== originalAlpha) metrics.alphaChangedPixels--
    if ([0, 1, 2].some(c => pixels[to + c] !== source.data[from + c])) metrics.rgbChangedPixels--
    for (let c = 0; c < 3; c++) pixels[to + c] = coveragePixels[to + c] = source.data[from + c]
    pixels[to + 3] = coveragePixels[to + 3] = originalAlpha
    metrics.estimatedPixels--; mark(x, y, 'model-residual')
  }
  cancel()
  return { method: 'subject-matte-v1', pixels: { width, height, data: pixels, boundsPx: { ...b } }, coveragePixels: { width, height, data: coveragePixels, boundsPx: { ...b } },
    uncertaintyMask: { width, height, data: uncertainty, boundsPx: { ...b } }, metrics, issues }
}
