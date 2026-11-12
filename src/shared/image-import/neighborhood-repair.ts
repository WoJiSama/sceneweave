import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

export type NeighborhoodPattern = 'soft' | 'planks'
export interface NeighborhoodRepairOptions {
  surfaceMask: ImagePixelMask
  protectionMask?: ImagePixelMask
  excludedEvidenceMask?: ImagePixelMask
  /** Zero is captured source. Any other value is unreviewed inference, never reference evidence. */
  priorInference?: Uint8Array
  pattern: NeighborhoodPattern
  signal?: { readonly aborted: boolean; throwIfAborted?: () => void }
}
export interface NeighborhoodCandidateMetrics {
  colorError: number; gradientError: number; textureDifference: number; structureError: number; distancePx: number
}
export interface NeighborhoodRepairConflict {
  id: string
  kind: 'insufficient-evidence' | 'unsupported-structure' | 'material-difference' | 'too-flat' | 'repeated-source' | 'edge-discontinuity' | 'ambiguous-source'
  severity: 'attention' | 'uncertain'
  boundsPx: PixelBounds
  message: string
  action: 'choose-sample' | 'exclude-evidence' | 'mark-material' | 'confirm-structure'
  instruction: string
}
export interface NeighborhoodRepairReport {
  algorithm: 'neighborhood-surface-v1'
  /** These scores rank this candidate set; they are not probabilities or visual acceptance. */
  scoreMeaning: 'lower-is-better-diagnostic-not-probability'
  analysisMode: 'repair' | 'assessment'
  pattern: NeighborhoodPattern
  boundsPx: PixelBounds
  summary: string[]
  limitations: string[]
  status: 'needs-review' | 'needs-guidance'
  sites: Array<{
    boundsPx: PixelBounds
    targetEvidencePixels: number
    chosenSourceBoundsPx: PixelBounds
    chosenMetrics: NeighborhoodCandidateMetrics
    candidates: Array<{ sourceBoundsPx: PixelBounds; score: number; neighborCompatibilityError: number; metrics: NeighborhoodCandidateMetrics; reasons: string[]; conflicts: string[] }>
  }>
  conflicts: NeighborhoodRepairConflict[]
  counts: { repairPixels: number; trustedPixels: number; candidatePatches: number; excludedInferencePixels: number; analyzedSites: number; reportedSites: number }
}

interface Features { mean: number[]; gx: number; gy: number; deviation: number }
interface Patch { bounds: PixelBounds; features: Features }
interface Candidate { patch: Patch; score: number; metrics: NeighborhoodCandidateMetrics; offset: number[] }
interface Site { bounds: PixelBounds; patchBounds: PixelBounds; candidates: Candidate[]; chosen: number; known: Array<{ x: number; y: number }>; neighbors: number[] }
type EvidenceCounts = Pick<NeighborhoodRepairReport['counts'], 'repairPixels' | 'trustedPixels' | 'candidatePatches' | 'excludedInferencePixels'>
class NeighborhoodEvidenceError extends Error {
  constructor(message: string, readonly boundsPx: PixelBounds, readonly counts: EvidenceCounts) { super(message) }
}
const round = (value: number) => Math.round(value * 1000) / 1000
const inside = (b: PixelBounds, x: number, y: number) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height
const distance = (a: PixelBounds, b: PixelBounds) => Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2)
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const

/** Build all observations before synthesis. No original RGB in a removal, excluded,
 * protected or previously inferred pixel is consulted by any feature or score. */
function prepare(image: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: NeighborhoodRepairOptions) {
  const cancel = () => {
    options?.signal?.throwIfAborted?.()
    if (options?.signal?.aborted) throw new Error('同组邻域分析已取消，原图保持。')
  }
  cancel()
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('同组邻域分析需要完整有界RGBA原图。')
  const validBounds = (b: PixelBounds) => b && [b.x, b.y, b.width, b.height].every(Number.isSafeInteger) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= image.width && b.y + b.height <= image.height
  if (!options || options.pattern !== 'soft' && options.pattern !== 'planks' || !options.surfaceMask) throw new Error('同组邻域分析需要明确的底材范围与种类。')
  for (const mask of [removal, options.surfaceMask, options.protectionMask, options.excludedEvidenceMask]) if (mask) {
    if (!validBounds(mask.boundsPx) || mask.width !== mask.boundsPx.width || mask.height !== mask.boundsPx.height || mask.width * mask.height > 1_000_000
      || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height || mask.data.some(value => value !== 0 && value !== 255)) throw new Error('同组邻域范围须为原图内、最多100万像素的二值蒙版。')
  }
  if (removal.width * removal.height > 250_000 || !removal.data.some(Boolean)) throw new Error('同组邻域移除图框须为1至25万像素。')
  if (!validBounds(donor) || donor.width < 4 || donor.height < 4 || donor.width * donor.height > 1_000_000) throw new Error('同组参考须为原图内至少4×4、最多100万像素的干净底材。')
  if (options.priorInference && (!(options.priorInference instanceof Uint8Array) || options.priorInference.length !== image.width * image.height)) throw new Error('前序推断范围必须逐原图像素绑定。')
  const surface = options.surfaceMask.boundsPx
  const writable = (x: number, y: number) => maskCoverage(removal, x, y) > 0 && maskCoverage(options.surfaceMask, x, y) > 0 && !maskCoverage(options.protectionMask, x, y)
  const trusted = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height && maskCoverage(options.surfaceMask, x, y) > 0
    && !maskCoverage(removal, x, y) && !maskCoverage(options.protectionMask, x, y) && !maskCoverage(options.excludedEvidenceMask, x, y)
    && !options.priorInference?.[y * image.width + x] && image.data[(y * image.width + x) * 4 + 3] === 255
  const rgb = (x: number, y: number, c: number) => image.data[(y * image.width + x) * 4 + c]
  const lum = (x: number, y: number) => (rgb(x, y, 0) + rgb(x, y, 1) + rgb(x, y, 2)) / 3
  let trustedPixels = 0, excludedInferencePixels = 0, repairPixels = 0, comparisons = 0
  const budget = (amount: number) => { comparisons += amount; if (comparisons > 45_000_000) throw new Error('同组比较超过计算预算，请缩小移除或底材范围。') }
  const pitch = surface.width + 1, integral = new Uint32Array(pitch * (surface.height + 1))
  for (let y = 0; y < surface.height; y++) {
    cancel(); let row = 0
    for (let x = 0; x < surface.width; x++) {
      const sx = x + surface.x, sy = y + surface.y, valid = trusted(sx, sy)
      if (valid) trustedPixels++
      if (maskCoverage(options.surfaceMask, sx, sy) && options.priorInference?.[sy * image.width + sx]) excludedInferencePixels++
      if (writable(sx, sy)) repairPixels++
      row += valid ? 0 : 1
      integral[(y + 1) * pitch + x + 1] = integral[y * pitch + x + 1] + row
    }
  }
  if (!repairPixels) throw new Error('同组邻域分析没有可写底材，请检查材质与保护范围。')
  const allTrusted = (b: PixelBounds) => {
    if (b.x < surface.x || b.y < surface.y || b.x + b.width > surface.x + surface.width || b.y + b.height > surface.y + surface.height) return false
    const x = b.x - surface.x, y = b.y - surface.y, x1 = x + b.width, y1 = y + b.height
    return integral[y1 * pitch + x1] - integral[y * pitch + x1] - integral[y1 * pitch + x] + integral[y * pitch + x] === 0
  }
  if (!allTrusted(donor)) {
    // Invalid masks/bounds above still reject as malformed input. Evidence gaps
    // instead identify one small piece for the operator to correct.
    for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) if (!trusted(x, y)) {
      throw new NeighborhoodEvidenceError('同组参考含有移除／保护／排除区域、前序推断或非不透明底材，不能作可信样本。',
        { x, y, width: Math.min(12, donor.x + donor.width - x), height: Math.min(12, donor.y + donor.height - y) },
        { repairPixels, trustedPixels, excludedInferencePixels, candidatePatches: 0 })
    }
  }
  const features = (b: PixelBounds): Features => {
    const mean = [0, 0, 0]; let gx = 0, gy = 0, square = 0, count = 0
    const stride = Math.max(1, Math.ceil(Math.sqrt(b.width * b.height / 100)))
    for (let y = b.y; y < b.y + b.height; y += stride) for (let x = b.x; x < b.x + b.width; x += stride) {
      // Full source footprints were checked. Target descriptors include only observed original pixels.
      if (!trusted(x, y)) continue
      for (let c = 0; c < 3; c++) mean[c] += rgb(x, y, c)
      const value = lum(x, y); square += value * value; count++
      if (trusted(x + 1, y)) gx += Math.abs(value - lum(x + 1, y))
      if (trusted(x, y + 1)) gy += Math.abs(value - lum(x, y + 1))
    }
    budget(Math.ceil(b.width / stride) * Math.ceil(b.height / stride))
    if (!count) return { mean, gx: 0, gy: 0, deviation: 0 }
    for (let c = 0; c < 3; c++) mean[c] /= count
    return { mean, gx: gx / count, gy: gy / count, deviation: Math.sqrt(Math.max(0, square / count - (mean.reduce((a, b) => a + b, 0) / 3) ** 2)) }
  }
  const anchor = features(donor), tile = Math.min(16, donor.width - 2, donor.height - 2), halo = Math.min(2, Math.floor(tile / 2)), step = Math.max(2, tile - halo * 2)
  const columns = Math.ceil(removal.width / step), rows = Math.ceil(removal.height / step)
  if (columns * rows > 1400) throw new Error('同组小块超过1400处，请扩大干净参考或拆小移除范围。')
  const libraries = new Map<string, Patch[]>()
  let candidatePatches = 0
  const library = (width: number, height: number): Patch[] => {
    const key = width + ':' + height, old = libraries.get(key)
    if (old) return old
    const found: Patch[] = [], seen = new Set<string>()
    const add = (x: number, y: number) => {
      const k = x + ':' + y; if (seen.has(k)) return; seen.add(k)
      const b = { x, y, width, height }
      if (allTrusted(b)) found.push({ bounds: b, features: features(b) })
    }
    const scan = (b: PixelBounds, limit: number) => {
      if (b.width < width || b.height < height) return
      const stride = Math.max(1, Math.ceil(Math.sqrt((b.width - width + 1) * (b.height - height + 1) / limit)))
      for (let y = b.y; y <= b.y + b.height - height; y += stride) {
        cancel(); for (let x = b.x; x <= b.x + b.width - width; x += stride) add(x, y)
      }
      add(b.x + b.width - width, b.y + b.height - height)
    }
    scan(surface, 2048); scan(donor, 512)
    if (!found.length) throw new NeighborhoodEvidenceError('没有完整可信的同组参考小块，请在高亮区域附近选择更宽的干净底材。',
      { ...removal.boundsPx, width: Math.min(16, removal.width), height: Math.min(16, removal.height) },
      { repairPixels, trustedPixels, excludedInferencePixels, candidatePatches })
    candidatePatches += found.length; libraries.set(key, found); return found
  }
  const sites: Site[] = [], grid = new Map<string, number>()
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    cancel()
    const b = { x: removal.boundsPx.x + col * step, y: removal.boundsPx.y + row * step, width: Math.min(step, removal.width - col * step), height: Math.min(step, removal.height - row * step) }
    let hasWrite = false
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) hasWrite ||= writable(x, y)
    if (!hasWrite) continue
    const pb = { x: Math.max(0, b.x - halo), y: Math.max(0, b.y - halo), width: 0, height: 0 }
    pb.width = Math.min(image.width, b.x + b.width + halo) - pb.x; pb.height = Math.min(image.height, b.y + b.height + halo) - pb.y
    const all = library(pb.width, pb.height), known: Array<{ x: number; y: number }> = []
    for (let y = pb.y; y < pb.y + pb.height; y++) for (let x = pb.x; x < pb.x + pb.width; x++) if (trusted(x, y)) known.push({ x, y })
    const samples = known.length <= 80 ? known : Array.from({ length: 80 }, (_, i) => known[Math.floor(i * known.length / 80)])
    const context = known.length ? features(pb) : anchor
    const descriptor = (p: Patch) => p.features.mean.reduce((sum, v, c) => sum + Math.abs(v - context.mean[c]), 0) / 3
      + Math.abs(p.features.gx - context.gx) + Math.abs(p.features.gy - context.gy) + Math.abs(p.features.deviation - anchor.deviation) * .15
    // Quantized appearance buckets shortlist related patches; proximity remains a separate pool,
    // so a matching board seam is not discarded merely because its mean includes dark ink.
    const bucket = (f: Features) => f.mean.map(v => Math.floor(v / 24)).join(':')
    const wanted = bucket(context), related = all.filter(p => bucket(p.features) === wanted)
    const ranked = (related.length >= 12 ? related : all).map(p => ({ p, score: descriptor(p) })).sort((a, b) => a.score - b.score || a.p.bounds.y - b.p.bounds.y || a.p.bounds.x - b.p.bounds.x).slice(0, 28).map(v => v.p)
    const nearest = all.map(p => ({ p, d: distance(pb, p.bounds) })).sort((a, b) => a.d - b.d || a.p.bounds.y - b.p.bounds.y || a.p.bounds.x - b.p.bounds.x).slice(0, 28).map(v => v.p)
    const pool = [...new Set([...ranked, ...nearest])]
    const candidates: Candidate[] = pool.map(patch => {
      let color = 0, gradient = 0, structure = 0, gradientCount = 0, structureCount = 0, coarse = 0, coarseCount = 0
      const deltas = [0, 0, 0]
      for (const point of samples) {
        const sx = patch.bounds.x + point.x - pb.x, sy = patch.bounds.y + point.y - pb.y
        for (let c = 0; c < 3; c++) deltas[c] += rgb(point.x, point.y, c) - rgb(sx, sy, c)
      }
      const offset = deltas.map(v => samples.length ? Math.max(-10, Math.min(10, v / samples.length)) : 0)
      for (const point of samples) {
        const sx = patch.bounds.x + point.x - pb.x, sy = patch.bounds.y + point.y - pb.y
        for (let c = 0; c < 3; c++) color += Math.abs(rgb(point.x, point.y, c) - rgb(sx, sy, c) - offset[c])
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          if (!trusted(point.x + dx, point.y + dy) || !inside(patch.bounds, sx + dx, sy + dy)) continue
          const targetGradient = lum(point.x + dx, point.y + dy) - lum(point.x, point.y), sourceGradient = lum(sx + dx, sy + dy) - lum(sx, sy)
          gradient += Math.abs(targetGradient - sourceGradient); gradientCount++
          if (Math.abs(targetGradient) >= 8 || Math.abs(sourceGradient) >= 8) { structure += Math.abs(targetGradient - sourceGradient); structureCount++ }
        }
        // Compare only corresponding observed pixels at two coarser distances. Unknown
        // targets never supply a statistic and all source reads stay inside the trusted patch.
        for (const radius of [2, 4]) {
          let target = 0, source = 0, count = 0
          for (const [dx, dy] of [[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius]] as const) {
            if (!trusted(point.x + dx, point.y + dy) || !inside(patch.bounds, sx + dx, sy + dy)) continue
            target += lum(point.x + dx, point.y + dy); source += lum(sx + dx, sy + dy); count++
          }
          if (count >= 2) { coarse += Math.abs(target / count - source / count - offset.reduce((a, b) => a + b, 0) / 3); coarseCount++ }
        }
      }
      budget(samples.length * 14 + 1)
      const anchorColor = patch.features.mean.reduce((sum, v, c) => sum + Math.abs(v - anchor.mean[c]), 0) / 3
      const metrics: NeighborhoodCandidateMetrics = { colorError: samples.length ? color / (samples.length * 3) : anchorColor,
        gradientError: gradient / Math.max(1, gradientCount), textureDifference: Math.abs(patch.features.gx + patch.features.gy - anchor.gx - anchor.gy),
        structureError: structure / Math.max(1, structureCount), distancePx: distance(pb, patch.bounds) }
      const score = metrics.colorError * .6 + metrics.gradientError * .4 + metrics.textureDifference * .35
        + metrics.structureError * (options.pattern === 'planks' ? .9 : .2) + coarse / Math.max(1, coarseCount) * .3 + anchorColor * .12 + Math.min(1.5, metrics.distancePx * .002)
      return { patch, score, metrics, offset }
    }).sort((a, b) => a.score - b.score || a.patch.bounds.y - b.patch.bounds.y || a.patch.bounds.x - b.patch.bounds.x).slice(0, 7)
    const index = sites.length; grid.set(row + ':' + col, index)
    sites.push({ bounds: b, patchBounds: pb, candidates, chosen: 0, known, neighbors: [] })
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const index = grid.get(row + ':' + col); if (index === undefined) continue
    for (const [dx, dy] of directions) { const n = grid.get(row + dy + ':' + (col + dx)); if (n !== undefined) sites[index].neighbors.push(n) }
  }
  const candidateRGB = (site: Site, c: Candidate, x: number, y: number, channel: number) => rgb(c.patch.bounds.x + x - site.patchBounds.x, c.patch.bounds.y + y - site.patchBounds.y, channel) + c.offset[channel]
  const pair = (a: Site, ca: Candidate, b: Site, cb: Candidate) => {
    const horizontal = a.bounds.y === b.bounds.y, left = horizontal ? a.bounds.x < b.bounds.x : a.bounds.y < b.bounds.y
    const first = left ? a : b, cf = left ? ca : cb, last = left ? b : a, cl = left ? cb : ca
    let error = 0, count = 0
    const length = horizontal ? Math.min(first.bounds.height, last.bounds.height) : Math.min(first.bounds.width, last.bounds.width)
    for (let k = 0; k < length; k += 2) {
      const x = horizontal ? first.bounds.x + first.bounds.width - 1 : first.bounds.x + k
      const y = horizontal ? first.bounds.y + k : first.bounds.y + first.bounds.height - 1
      const nx = x + (horizontal ? 1 : 0), ny = y + (horizontal ? 0 : 1)
      if (!writable(x, y) || !writable(nx, ny)) continue
      for (let c = 0; c < 3; c++) {
        const delta = candidateRGB(last, cl, nx, ny, c) - candidateRGB(first, cf, x, y, c)
        const expected = candidateRGB(first, cf, nx, ny, c) - candidateRGB(first, cf, x, y, c)
        error += Math.min(40, Math.abs(delta - expected)); count++
      }
    }
    const ax = ca.patch.bounds.x - a.patchBounds.x, ay = ca.patch.bounds.y - a.patchBounds.y, bx = cb.patch.bounds.x - b.patchBounds.x, by = cb.patch.bounds.y - b.patchBounds.y
    const displacement = Math.min(18, Math.hypot(ax - bx, ay - by)) * .16
    const repeated = ca.patch.bounds.x === cb.patch.bounds.x && ca.patch.bounds.y === cb.patch.bounds.y ? 2 : 0
    budget(count + 1)
    return error / Math.max(1, count) * .65 + displacement + repeated
  }
  // Joint coordinate descent uses generated candidates as optimization variables, never
  // as captured evidence. A changed neighbor affects the choice on the next pass.
  for (let pass = 0; pass < 6; pass++) {
    cancel()
    for (let turn = 0; turn < sites.length; turn++) {
      const index = pass % 2 ? sites.length - 1 - turn : turn, site = sites[index]
      let best = site.chosen, bestScore = Infinity
      for (let k = 0; k < site.candidates.length; k++) {
        let score = site.candidates[k].score
        for (const n of site.neighbors) score += pair(site, site.candidates[k], sites[n], sites[n].candidates[sites[n].chosen])
        if (score < bestScore) { bestScore = score; best = k }
      }
      site.chosen = best
    }
  }
  return { image, removal, donor, options, cancel, writable, trusted, rgb, lum, anchor, sites, candidateRGB, pair,
    counts: { repairPixels, trustedPixels, candidatePatches, excludedInferencePixels } }
}

type Prepared = ReturnType<typeof prepare>

function synthesize(p: Prepared): ImagePixels {
  const { image, removal, writable, trusted, sites, candidateRGB, cancel } = p
  const data = image.data.slice(), b = removal.boundsPx, sourceX = new Int16Array(removal.width * removal.height).fill(-1), sourceY = new Int16Array(sourceX.length).fill(-1)
  for (const site of sites) {
    cancel(); const candidate = site.candidates[site.chosen]
    for (let y = site.bounds.y; y < site.bounds.y + site.bounds.height; y++) for (let x = site.bounds.x; x < site.bounds.x + site.bounds.width; x++) if (writable(x, y)) {
      const index = (y - b.y) * removal.width + x - b.x, at = (y * image.width + x) * 4
      sourceX[index] = candidate.patch.bounds.x + x - site.patchBounds.x; sourceY[index] = candidate.patch.bounds.y + y - site.patchBounds.y
      for (let c = 0; c < 3; c++) data[at + c] = candidateRGB(site, candidate, x, y, c)
      data[at + 3] = 255
    }
  }
  // Only repair variables are solved. Desired gradients come from original trusted
  // samples; fixed boundary values are original trusted pixels, not prior repairs.
  const initial = data.slice(), correction = new Float32Array(removal.width * removal.height * 3), divergence = new Float32Array(correction.length), degree = new Uint8Array(sourceX.length)
  for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) if (writable(x, y)) {
    const index = (y - b.y) * removal.width + x - b.x, at = (y * image.width + x) * 4
    if (sourceX[index] < 0) throw new Error('同组候选未覆盖全部可写区域，原任务保持。')
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, missing = writable(nx, ny)
      if (!missing && !trusted(nx, ny)) continue
      degree[index]++
      const ni = (ny - b.y) * removal.width + nx - b.x, nat = (ny * image.width + nx) * 4
      for (let c = 0; c < 3; c++) {
        const sx = sourceX[index], sy = sourceY[index]
        let gradient = trusted(sx + dx, sy + dy) ? p.rgb(sx, sy, c) - p.rgb(sx + dx, sy + dy, c) : 0
        if (missing) {
          const tx = sourceX[ni], ty = sourceY[ni]
          const reverse = trusted(tx - dx, ty - dy) ? p.rgb(tx, ty, c) - p.rgb(tx - dx, ty - dy, c) : -gradient
          gradient = (gradient - reverse) / 2
        }
        divergence[index * 3 + c] += gradient - initial[at + c] + initial[nat + c]
      }
    }
  }
  const iterations = Math.min(240, Math.max(24, Math.floor(18_000_000 / sourceX.length)))
  for (let pass = 0; pass < iterations; pass++) {
    cancel()
    for (let parity = 0; parity < 2; parity++) for (let y = 0; y < removal.height; y++) for (let x = (y + parity) % 2; x < removal.width; x += 2) {
      const index = y * removal.width + x
      if (sourceX[index] < 0 || !degree[index]) continue
      for (let c = 0; c < 3; c++) {
        let sum = divergence[index * 3 + c]
        for (const [dx, dy] of directions) {
          const nx = x + dx, ny = y + dy, n = ny * removal.width + nx
          if (nx >= 0 && ny >= 0 && nx < removal.width && ny < removal.height && sourceX[n] >= 0) sum += correction[n * 3 + c]
        }
        const at = index * 3 + c
        correction[at] += 1.3 * (sum / (degree[index] + .04) - correction[at])
      }
    }
  }
  for (let y = 0; y < removal.height; y++) for (let x = 0; x < removal.width; x++) {
    const i = y * removal.width + x; if (sourceX[i] < 0) continue
    const at = ((y + b.y) * image.width + x + b.x) * 4
    for (let c = 0; c < 3; c++) data[at + c] = initial[at + c] + Math.max(-18, Math.min(18, correction[i * 3 + c]))
  }
  cancel(); return { width: image.width, height: image.height, data }
}

function describe(p: Prepared, repaired: ImagePixels, mode: NeighborhoodRepairReport['analysisMode']): NeighborhoodRepairReport {
  if (repaired.width !== p.image.width || repaired.height !== p.image.height || !(repaired.data instanceof Uint8ClampedArray) || repaired.data.length !== p.image.data.length) throw new Error('待比较补底必须对应同一完整原图。')
  const conflicts: NeighborhoodRepairConflict[] = []
  const add = (kind: NeighborhoodRepairConflict['kind'], boundsPx: PixelBounds, message: string, action: NeighborhoodRepairConflict['action'], instruction: string, severity: NeighborhoodRepairConflict['severity'] = 'attention') => {
    if (conflicts.length >= 96 || conflicts.some(c => c.kind === kind && distance(c.boundsPx, boundsPx) < Math.max(boundsPx.width, boundsPx.height) * 2)) return
    conflicts.push({ id: 'neighbor-' + (conflicts.length + 1), kind, severity, boundsPx: { ...boundsPx }, message, action, instruction })
  }
  const color = (x: number, y: number, c: number) => p.writable(x, y) ? repaired.data[(y * repaired.width + x) * 4 + c] : p.rgb(x, y, c)
  const usage = new Map<string, number>()
  for (const site of p.sites) {
    const b = site.candidates[site.chosen].patch.bounds, key = b.x + ':' + b.y + ':' + b.width + ':' + b.height
    usage.set(key, (usage.get(key) ?? 0) + 1)
  }
  for (const site of p.sites) {
    p.cancel(); const chosen = site.candidates[site.chosen]
    if (site.known.length < 4) add(p.options.pattern === 'planks' ? 'unsupported-structure' : 'insufficient-evidence', site.bounds,
      p.options.pattern === 'planks' ? '这块内部没有足够的原图板缝依据，相似木纹不能证明隐藏板头位置。' : '这块内部缺少直接可见的同底材边界，颜色主要依赖同组参考。',
      p.options.pattern === 'planks' ? 'confirm-structure' : 'choose-sample',
      p.options.pattern === 'planks' ? '请在此处附近标出一段确实应延续的板缝；看不清时保留未决，不补画未知板头。' : '请在高亮位置附近框一小块干净的同材质，避开阴影和其他家具。', 'uncertain')
    const difference = chosen.patch.features.mean.reduce((sum, v, c) => sum + Math.abs(v - p.anchor.mean[c]), 0) / 3
    if (difference > 24 && site.known.length >= 8) add('material-difference', site.bounds, '附近匹配与指定参考的色调差异较大，可能跨了材质或阴影。', 'mark-material', '请只确认这小块属于哪种底材，必要时缩紧表面范围，不扩大补底许可。')
    let energy = 0, count = 0, edge = 0, edges = 0
    for (let y = site.bounds.y; y < site.bounds.y + site.bounds.height; y++) for (let x = site.bounds.x; x < site.bounds.x + site.bounds.width; x++) if (p.writable(x, y)) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy
        if (!p.writable(nx, ny) && !p.trusted(nx, ny)) continue
        const d = [0, 1, 2].reduce((sum, c) => sum + Math.abs(color(x, y, c) - color(nx, ny, c)), 0) / 3
        if (p.writable(nx, ny)) { energy += d; count++ } else { edge += d; edges++ }
      }
    }
    const referenceEnergy = chosen.patch.features.gx + chosen.patch.features.gy, observed = energy / Math.max(1, count) * 2
    if (referenceEnergy > 2 && count >= 16 && observed < referenceEnergy * .35) add('too-flat', site.bounds, '补区的细微变化明显少于同组参考，可能出现平色补块。', 'choose-sample', '请换选此处附近仍有自然细纹的干净同材质，保留当前候选作对照。')
    if (edges >= 4 && edge / edges > Math.max(13, referenceEnergy * 2.5 + 6)) add('edge-discontinuity', site.bounds, '补区与可见原图交界有较大色阶或结构跳变。', 'choose-sample', '请沿这段交界核对同底材取样；若实际跨材质，只修正这一小段表面归属。')
    const source = chosen.patch.bounds, key = source.x + ':' + source.y + ':' + source.width + ':' + source.height
    if ((usage.get(key) ?? 0) >= 3 && referenceEnergy > 3) add('repeated-source', site.bounds, '同一参考小块在多处被重复使用，可能重复黑线或纹理。', 'choose-sample', '请补充另一小块干净同组参考，避免把同一条短线重复铺开。')
    const first = site.candidates[0], second = site.candidates[1]
    if (second && second.score - first.score < .4 && Math.abs(second.patch.features.gx - first.patch.features.gx) + Math.abs(second.patch.features.gy - first.patch.features.gy) > 3) add('ambiguous-source', site.bounds,
      '两块参考同样接近，但纹向不同，自动排序不能确定真实结构。', 'confirm-structure', '请在高亮小块确认应沿哪一侧纹向延续；不要仅按候选分数采用。', 'uncertain')
    // Evaluate actual internal joins as well as the captured outside boundary.
    // Two individually plausible patches can still interrupt the same board seam.
    for (const n of site.neighbors) {
      const neighbor = p.sites[n]
      if (neighbor.bounds.x < site.bounds.x || neighbor.bounds.y < site.bounds.y) continue
      const horizontal = neighbor.bounds.x > site.bounds.x, other = neighbor.candidates[neighbor.chosen]
      const length = horizontal ? Math.min(site.bounds.height, neighbor.bounds.height) : Math.min(site.bounds.width, neighbor.bounds.width)
      let mismatch = 0, seamCount = 0
      for (let k = 0; k < length; k++) {
        const x = horizontal ? site.bounds.x + site.bounds.width - 1 : site.bounds.x + k
        const y = horizontal ? site.bounds.y + k : site.bounds.y + site.bounds.height - 1
        const nx = x + (horizontal ? 1 : 0), ny = y + (horizontal ? 0 : 1)
        if (!p.writable(x, y) || !p.writable(nx, ny)) continue
        for (let c = 0; c < 3; c++) {
          const actual = color(nx, ny, c) - color(x, y, c)
          const expectedHere = p.candidateRGB(site, chosen, nx, ny, c) - p.candidateRGB(site, chosen, x, y, c)
          const expectedThere = p.candidateRGB(neighbor, other, nx, ny, c) - p.candidateRGB(neighbor, other, x, y, c)
          mismatch += Math.min(Math.abs(actual - expectedHere), Math.abs(actual - expectedThere)); seamCount++
        }
      }
      if (seamCount >= 12 && mismatch / seamCount > 10) add('edge-discontinuity', horizontal
        ? { x: neighbor.bounds.x - 1, y: neighbor.bounds.y, width: 2, height: length }
        : { x: neighbor.bounds.x, y: neighbor.bounds.y - 1, width: length, height: 2 },
      '两块各自相似的补片在拼接处仍有明暗或板缝冲突。', 'confirm-structure', '请只核对这条高亮接缝应如何延续；必要时补充接缝同侧的一小块干净参考。')
    }
  }
  const sampleStep = Math.max(1, Math.ceil(p.sites.length / 96))
  // Keep actual detected conflicts visible even when many interior tiles need
  // original evidence. The external report stays small enough for a model/UI.
  const reportedConflicts = conflicts.sort((a, b) => Number(a.severity === 'uncertain') - Number(b.severity === 'uncertain')).slice(0, 24)
  const sites = p.sites.filter((_, i) => i % sampleStep === 0).map(site => {
    const chosen = site.candidates[site.chosen]
    const candidates = [...site.candidates].sort((a, b) => (a === chosen ? -1 : b === chosen ? 1 : a.score - b.score)).slice(0, 3).map(candidate => {
      const m = candidate.metrics
      const neighborError = site.neighbors.reduce((sum, n) => sum + p.pair(site, candidate, p.sites[n], p.sites[n].candidates[p.sites[n].chosen]), 0)
      return { sourceBoundsPx: { ...candidate.patch.bounds }, score: round(candidate.score + neighborError), neighborCompatibilityError: round(neighborError), metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)])) as unknown as NeighborhoodCandidateMetrics,
        reasons: [`整块参考均来自同一声明底材的可信原像素。`, `距此处约${Math.round(m.distancePx)}像素；比较${site.known.length}个可见边界像素。`,
          `颜色差${round(m.colorError)}，梯度差${round(m.gradientError)}，细纹差${round(m.textureDifference)}，结构差${round(m.structureError)}；相邻拼接差${round(neighborError)}。`,
          ...(candidate === chosen ? ['与相邻候选共同比较后选取，避免只按单块相似度独立拼接。'] : [])],
        conflicts: [...(site.known.length < 4 ? ['缺少此处直接可见依据。'] : []), ...(m.structureError > 12 ? ['板缝或明暗边的方向／强度仍冲突。'] : []), ...(m.colorError > 12 ? ['与可见边界仍有色差。'] : [])] }
    })
    return { boundsPx: { ...site.bounds }, targetEvidencePixels: site.known.length, chosenSourceBoundsPx: { ...chosen.patch.bounds }, chosenMetrics: { ...chosen.metrics }, candidates }
  })
  return { algorithm: 'neighborhood-surface-v1', scoreMeaning: 'lower-is-better-diagnostic-not-probability', analysisMode: mode, pattern: p.options.pattern, boundsPx: { ...p.removal.boundsPx },
    status: reportedConflicts.length ? 'needs-guidance' : 'needs-review',
    summary: [`比较${p.counts.candidatePatches}块完整可信的同组参考，联合检查${p.sites.length}处相邻小块。`,
      `${p.counts.trustedPixels}个原图像素可供取证，排除${p.counts.excludedInferencePixels}个前序推断像素。`,
      reportedConflicts.length ? `定位${reportedConflicts.length}处需要复核的冲突或证据缺口；请按高亮位置做小范围辅助。` : '当前规则未发现明显冲突，仍需换底、移开和原尺寸视觉审核。'],
    limitations: ['同组来自明确底材范围，不是自动语义识别。', '相似参考、数值低差异与规则未报警都不能证明隐藏原貌或视觉通过。',
      '没有可见结构时不能恢复未知板头；未审核补片始终不作可信原图样本。', '分数越低只表示本次启发式比较更接近，不是成功概率、质量分或采用阈值。',
      '局部建议只引导人工判断，不自行扩大移除、保护或取证权限。'],
    sites, conflicts: reportedConflicts, counts: { ...p.counts, analyzedSites: p.sites.length, reportedSites: sites.length } }
}

/** New opt-in algorithm. Existing material/structure/exemplar recipes are untouched. */
export function repairImageNeighborhood(image: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: NeighborhoodRepairOptions): { pixels: ImagePixels; report: NeighborhoodRepairReport } {
  const prepared = prepare(image, removal, donor, options), pixels = synthesize(prepared), report = describe(prepared, pixels, 'repair')
  prepared.cancel(); return { pixels, report }
}

/** Evaluate an existing repair with the same independent original-only references. */
export function analyzeImageRepairNeighborhood(image: ImagePixels, repaired: ImagePixels, removal: ImagePixelMask, donor: PixelBounds, options: NeighborhoodRepairOptions): NeighborhoodRepairReport {
  if (repaired.width !== image.width || repaired.height !== image.height || !(repaired.data instanceof Uint8ClampedArray) || repaired.data.length !== image.data.length) throw new Error('待比较补底必须对应同一完整原图。')
  try {
    const prepared = prepare(image, removal, donor, options), report = describe(prepared, repaired, 'assessment')
    prepared.cancel(); return report
  } catch (error) {
    if (!(error instanceof NeighborhoodEvidenceError)) throw error
    return { algorithm: 'neighborhood-surface-v1', scoreMeaning: 'lower-is-better-diagnostic-not-probability', analysisMode: 'assessment', pattern: options.pattern,
      boundsPx: { ...removal.boundsPx }, status: 'needs-guidance', sites: [],
      summary: ['当前可信依据不足，尚未形成可比较的完整候选。', error.message],
      limitations: ['没有依据时不生成虚假的匹配分数，也不把当前补底当作原图证据。', '诊断不能证明隐藏原貌或视觉通过；补充可信依据后须重新分析。'],
      conflicts: [{ id: 'neighbor-1', kind: 'insufficient-evidence', severity: 'uncertain', boundsPx: { ...error.boundsPx }, message: error.message,
        action: 'choose-sample', instruction: '请在此高亮小块附近重新框选干净的同底材参考，避开家具、阴影、保护区和已补画区域。' }],
      counts: { ...error.counts, analyzedSites: 0, reportedSites: 0 } }
  }
}
