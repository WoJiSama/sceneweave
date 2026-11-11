import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { traceIndexedContours } from '../image-import/vector.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { captureJson } from '../validation/json.js'
import { fitVectorDraft, vectorRefinementOptionsSchema, type VectorRefinementOptions, type VectorRefinementResult } from './vector.js'

interface Colour { rgba: number[]; count: number }
interface Moments { n: number; x: number; y: number; xx: number; xy: number; yy: number; c: number[]; cc: number[]; xc: number[]; yc: number[] }
interface Region { id: number; pixels: number[]; adjacent: Set<number>; alive: boolean; thin: boolean; alpha: number; moments: Moments }
interface Model { x: number; y: number; dx: number; dy: number; mean: number[]; slope: number[]; squaredError: number }
interface Gradient { x1: number; y1: number; x2: number; y2: number; from: number[]; to: number[]; improvement: number; maximum: number }
interface Paint { rgba: number[]; gradient?: Gradient }
const MAX_REGIONS = 16_384, MAX_MERGE_TRIALS = 200_000, MAX_GRADIENTS = 96
const CHANNEL_RMSE = 4, CHANNEL_ERROR = 12
const round = (v: number) => Math.round(v * 1000) / 1000
const hex = (c: number[]) => `#${c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const distance = (a: number[], b: number[]) => a.reduce((sum, v, c) => sum + (v - b[c]) ** 2, 0)
const empty = (): Moments => ({ n: 0, x: 0, y: 0, xx: 0, xy: 0, yy: 0, c: [0, 0, 0], cc: [0, 0, 0], xc: [0, 0, 0], yc: [0, 0, 0] })
function combine(a: Moments, b: Moments): Moments {
  return { n: a.n + b.n, x: a.x + b.x, y: a.y + b.y, xx: a.xx + b.xx, xy: a.xy + b.xy, yy: a.yy + b.yy,
    c: a.c.map((v, k) => v + b.c[k]), cc: a.cc.map((v, k) => v + b.cc[k]), xc: a.xc.map((v, k) => v + b.xc[k]), yc: a.yc.map((v, k) => v + b.yc[k]) }
}

/** Histogram bins bound fitting work; final assignment uses actual pixel distances, not bin membership. */
function quantize(image: ImagePixels, maximum: number, signal?: CancellationSignal) {
  const bins = new Map<number, Colour>()
  let visiblePixels = 0
  for (let p = 0; p < image.data.length; p += 4) {
    if (!(p % 4096)) checkCancelled(signal)
    if (!image.data[p + 3]) continue
    visiblePixels++
    const key = (image.data[p] >> 3) * 16384 + (image.data[p + 1] >> 3) * 512 + (image.data[p + 2] >> 3) * 16 + Math.round(image.data[p + 3] / 17)
    let bin = bins.get(key)
    if (!bin) { if (bins.size === 65536) throw new Error('源图颜色分布超过矢量计算预算，未丢弃细节。'); bin = { rgba: [0, 0, 0, 0], count: 0 }; bins.set(key, bin) }
    bin.count++
    for (let c = 0; c < 4; c++) bin.rgba[c] += image.data[p + c]
  }
  if (!visiblePixels) throw new Error('源图没有可见像素。')
  const samples = [...bins.entries()].sort(([a], [b]) => a - b).map(([key, b]) => ({ key, rgba: b.rgba.map(v => v / b.count), count: b.count }))
  const first = samples.reduce((a, b) => b.count > a.count ? b : a), centres = [first.rgba.slice()]
  const nearest = new Float64Array(samples.length).fill(Infinity)
  while (centres.length < maximum && centres.length < samples.length) {
    checkCancelled(signal)
    let at = -1, score = 0
    for (let i = 0; i < samples.length; i++) {
      nearest[i] = Math.min(nearest[i], distance(samples[i].rgba, centres.at(-1)!))
      const value = nearest[i] * Math.sqrt(samples[i].count)
      if (value > score) { score = value; at = i }
    }
    if (at < 0) break
    centres.push(samples[at].rgba.slice())
  }
  const assigned = new Int16Array(samples.length).fill(-1)
  for (let iteration = 0; iteration < 12; iteration++) {
    checkCancelled(signal)
    const sums = centres.map(() => ({ rgba: [0, 0, 0, 0], count: 0 })); let changed = false
    for (let i = 0; i < samples.length; i++) {
      let at = 0, best = Infinity
      for (let c = 0; c < centres.length; c++) { const d = distance(samples[i].rgba, centres[c]); if (d < best) { best = d; at = c } }
      if (assigned[i] !== at) { changed = true; assigned[i] = at }
      sums[at].count += samples[i].count
      for (let c = 0; c < 4; c++) sums[at].rgba[c] += samples[i].rgba[c] * samples[i].count
    }
    for (let c = 0; c < centres.length; c++) if (sums[c].count) centres[c] = sums[c].rgba.map(v => v / sums[c].count)
    if (!changed) break
  }
  const colours: Colour[] = [], unique = new Map<string, number>()
  for (const centre of centres) {
    const rgba = centre.map(Math.round); rgba[3] = Math.max(1, rgba[3])
    const key = rgba.join(','); if (!unique.has(key)) { unique.set(key, colours.length); colours.push({ rgba, count: 0 }) }
  }
  const labels = new Int16Array(image.width * image.height).fill(-1)
  for (let p = 0; p < labels.length; p++) {
    if (!(p % 1024)) checkCancelled(signal)
    if (!image.data[p * 4 + 3]) continue
    let at = 0, best = Infinity
    for (let c = 0; c < colours.length; c++) {
      let d = 0; for (let k = 0; k < 4; k++) d += (image.data[p * 4 + k] - colours[c].rgba[k]) ** 2
      if (d < best) { best = d; at = c }
    }
    labels[p] = at; colours[at].count++
  }
  return { colours, labels, visiblePixels }
}

function components(image: ImagePixels, labels: Int16Array, colours: Colour[], signal?: CancellationSignal) {
  const owners = new Int32Array(labels.length).fill(-1), queue = new Uint32Array(labels.length), regions: Region[] = []
  const adjacent = (p: number) => [p % image.width ? p - 1 : -1, p % image.width < image.width - 1 ? p + 1 : -1,
    p >= image.width ? p - image.width : -1, p + image.width < labels.length ? p + image.width : -1]
  for (let p = 0; p < labels.length; p++) {
    if (!(p % 1024)) checkCancelled(signal)
    if (labels[p] < 0 || owners[p] >= 0) continue
    if (regions.length === MAX_REGIONS) throw new Error('矢量连通区域超过16384，未丢弃细节。')
    const region: Region = { id: regions.length, pixels: [], adjacent: new Set(), alive: true, thin: false, alpha: colours[labels[p]].rgba[3], moments: empty() }
    regions.push(region); queue[0] = p; owners[p] = region.id
    let count = 1, left = image.width, top = image.height, right = 0, bottom = 0
    for (let at = 0; at < count; at++) {
      if (!(at % 1024)) checkCancelled(signal)
      const current = queue[at], x = current % image.width + .5, y = Math.floor(current / image.width) + .5, m = region.moments
      region.pixels.push(current); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      m.n++; m.x += x; m.y += y; m.xx += x * x; m.xy += x * y; m.yy += y * y
      for (let c = 0; c < 3; c++) { const v = image.data[current * 4 + c]; m.c[c] += v; m.cc[c] += v * v; m.xc[c] += x * v; m.yc[c] += y * v }
      for (const next of adjacent(current)) if (next >= 0 && owners[next] < 0 && labels[next] === labels[p]) { owners[next] = region.id; queue[count++] = next }
    }
    region.thin = Math.min(right - left + 1, bottom - top + 1) <= 2 || count <= 4
  }
  for (let p = 0; p < labels.length; p++) if (owners[p] >= 0) for (const next of adjacent(p)) {
    if (next >= 0 && owners[next] >= 0 && owners[p] !== owners[next]) regions[owners[p]].adjacent.add(owners[next])
  }
  return regions
}

/** Best one-direction RGB trend from a local affine fit; no source scale change or invented samples. */
function model(m: Moments): Model | undefined {
  const x = m.x / m.n, y = m.y / m.n, xx = m.xx - m.x * x, xy = m.xy - m.x * y, yy = m.yy - m.y * y
  const determinant = xx * yy - xy * xy
  if (determinant <= 1e-8) return
  const mean = m.c.map(v => v / m.n), xc = m.xc.map((v, c) => v - m.x * mean[c]), yc = m.yc.map((v, c) => v - m.y * mean[c])
  const ax = xc.map((v, c) => (v * yy - yc[c] * xy) / determinant), ay = yc.map((v, c) => (v * xx - xc[c] * xy) / determinant)
  const aa = ax.reduce((s, v) => s + v * v, 0), ab = ax.reduce((s, v, c) => s + v * ay[c], 0), bb = ay.reduce((s, v) => s + v * v, 0)
  const angle = .5 * Math.atan2(2 * ab, aa - bb), dx = Math.cos(angle), dy = Math.sin(angle), variance = dx * dx * xx + 2 * dx * dy * xy + dy * dy * yy
  if (variance <= 1e-8) return
  const covariance = xc.map((v, c) => dx * v + dy * yc[c]), slope = covariance.map(v => v / variance)
  const squaredError = Math.max(0, m.cc.reduce((s, v, c) => s + v - m.c[c] * mean[c] - covariance[c] ** 2 / variance, 0))
  return { x, y, dx, dy, mean, slope, squaredError }
}

function fitGradient(region: Region, image: ImagePixels, labels: Int16Array, colours: Colour[], signal?: CancellationSignal): Gradient | undefined {
  if (region.thin || region.pixels.length < 16) return
  const fitted = model(region.moments)
  if (!fitted || fitted.squaredError > region.moments.n * 3 * CHANNEL_RMSE ** 2) return
  let low = Infinity, high = -Infinity
  const minima = [255, 255, 255], maxima = [0, 0, 0]
  let sampled = 0
  for (const p of region.pixels) {
    if (!(sampled++ % 1024)) checkCancelled(signal)
    const d = (p % image.width + .5 - fitted.x) * fitted.dx + (Math.floor(p / image.width) + .5 - fitted.y) * fitted.dy
    low = Math.min(low, d); high = Math.max(high, d)
    for (let c = 0; c < 3; c++) { const value = image.data[p * 4 + c]; minima[c] = Math.min(minima[c], value); maxima[c] = Math.max(maxima[c], value) }
  }
  if (high - low < 1e-6) return
  const endpoint = (d: number) => fitted.mean.map((v, c) => Math.round(Math.max(minima[c], Math.min(maxima[c], v + d * fitted.slope[c]))))
  const from = endpoint(low), to = endpoint(high)
  if (from.every((v, c) => Math.abs(v - to[c]) < 2)) return
  const x1 = round(fitted.x + low * fitted.dx), y1 = round(fitted.y + low * fitted.dy), x2 = round(fitted.x + high * fitted.dx), y2 = round(fitted.y + high * fitted.dy)
  const dx = x2 - x1, dy = y2 - y1, length = dx * dx + dy * dy
  if (length < 1e-8) return
  let squaredError = 0, originalError = 0, maximum = 0, at = 0
  const channelErrors = [0, 0, 0]
  for (const p of region.pixels) {
    if (!(at++ % 1024)) checkCancelled(signal)
    const t = Math.max(0, Math.min(1, ((p % image.width + .5 - x1) * dx + (Math.floor(p / image.width) + .5 - y1) * dy) / length))
    for (let c = 0; c < 3; c++) {
      const actual = image.data[p * 4 + c], error = Math.abs(actual - from[c] - t * (to[c] - from[c]))
      maximum = Math.max(maximum, error); squaredError += error ** 2; channelErrors[c] += error ** 2; originalError += (actual - colours[labels[p]].rgba[c]) ** 2
    }
  }
  if (maximum > CHANNEL_ERROR || channelErrors.some(error => error > region.pixels.length * CHANNEL_RMSE ** 2) || squaredError >= originalError * .9) return
  return { x1, y1, x2, y2, from, to, improvement: originalError - squaredError, maximum }
}

export function refineImageRegionsToVector(pixels: ImagePixels, input: VectorRefinementOptions, signal?: CancellationSignal): VectorRefinementResult {
  checkCancelled(signal)
  const options = vectorRefinementOptionsSchema.parse(captureJson(input))
  if (!pixels || !Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width < 1 || pixels.height < 1
    || pixels.width > 8192 || pixels.height > 8192 || pixels.width * pixels.height > 1_000_000 || !(pixels.data instanceof Uint8ClampedArray)
    || pixels.data.length !== pixels.width * pixels.height * 4) throw new Error('矢量色阶重建需要完整RGBA，最多100万像素且边长不超过8192。')
  const image = { width: pixels.width, height: pixels.height, data: pixels.data.slice() }, sampled = quantize(image, options.colors, signal)
  const regions = components(image, sampled.labels, sampled.colours, signal)
  let trials = 0, mergedRegionCount = 0
  for (const region of regions.slice().sort((a, b) => b.pixels.length - a.pixels.length || a.id - b.id)) {
    checkCancelled(signal)
    if (!region.alive || region.thin) continue
    for (let iteration = 0; iteration < 64; iteration++) {
      let best: { other: Region; moments: Moments; error: number } | undefined
      for (const id of region.adjacent) {
        const other = regions[id]
        if (!other.alive || other.thin || other.alpha !== region.alpha) continue
        if (++trials > MAX_MERGE_TRIALS) throw new Error('矢量渐变合并超过计算预算，未丢弃细节。')
        if (region.moments.c.some((v, c) => Math.abs(v / region.moments.n - other.moments.c[c] / other.moments.n) > 40)) continue
        const moments = combine(region.moments, other.moments), fitted = model(moments)
        if (!fitted || fitted.squaredError > moments.n * 3 * CHANNEL_RMSE ** 2) continue
        const error = fitted.squaredError / moments.n
        if (!best || error < best.error || error === best.error && id < best.other.id) best = { other, moments, error }
      }
      if (!best) break
      best.other.alive = false; region.moments = best.moments; for (const p of best.other.pixels) region.pixels.push(p); best.other.pixels = []; mergedRegionCount++
      for (const id of best.other.adjacent) if (id !== region.id) { region.adjacent.add(id); regions[id].adjacent.delete(best.other.id); regions[id].adjacent.add(region.id) }
      region.adjacent.delete(best.other.id)
    }
  }
  const gradients = regions.filter(r => r.alive).map(region => ({ region, gradient: fitGradient(region, image, sampled.labels, sampled.colours, signal) }))
    .filter((value): value is { region: Region; gradient: Gradient } => !!value.gradient)
    .sort((a, b) => b.gradient.improvement - a.gradient.improvement || a.region.id - b.region.id).slice(0, MAX_GRADIENTS)
  // Regions without an accepted gradient retain all their original palette labels, including thin details.
  const labels = sampled.labels.slice(), paints: Paint[] = sampled.colours.map(c => ({ rgba: c.rgba }))
  for (const { region, gradient } of gradients) { const label = paints.length; paints.push({ rgba: [0, 0, 0, region.alpha], gradient }); for (const p of region.pixels) labels[p] = label }
  const rings = traceIndexedContours(image, labels), alphaLabels = new Int16Array(labels.length).fill(-1), counts = new Uint32Array(paints.length)
  for (let p = 0; p < labels.length; p++) if (labels[p] >= 0) { alphaLabels[p] = paints[labels[p]].rgba[3]; counts[labels[p]]++ }
  const masks = traceIndexedContours(image, alphaLabels)
  let definitions = '', paths = 0, commands = 0
  for (let i = sampled.colours.length; i < paints.length; i++) {
    const g = paints[i].gradient!
    definitions += `<linearGradient id="tone${i}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"><stop offset="0" stop-color="${hex(g.from)}"/><stop offset="1" stop-color="${hex(g.to)}"/></linearGradient>`
  }
  const path = (id: number, outlines: { x: number; y: number }[][]) => {
    if (++paths > STATIC_SVG_LIMITS.paths) throw new Error('矢量路径超过256，未丢弃细节。')
    const d = outlines.map(ring => {
      commands += ring.length + 1
      if (commands > STATIC_SVG_LIMITS.pathCommands) throw new Error('矢量路径命令超过16384，未丢弃细节。')
      return ring.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + 'Z'
    }).join('')
    return `<path d="${d}" fill="${paints[id].gradient ? `url(#tone${id})` : hex(paints[id].rgba)}" fill-rule="evenodd"/>`
  }
  let groups = ''
  for (const [alpha, outlines] of masks) {
    checkCancelled(signal)
    const ids = [...rings.keys()].filter(i => paints[i].rgba[3] === alpha).sort((a, b) => counts[b] - counts[a] || a - b), base = ids[0]
    groups += `<g opacity="${round(alpha / 255)}">${path(base, outlines)}${ids.slice(1).map(id => path(id, rings.get(id)!)).join('')}</g>`
  }
  const normalized = normalizeStaticSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}">${definitions ? `<defs>${definitions}</defs>` : ''}${groups}</svg>`)
  const draft = { sourceSvg: normalized.normalizedSource, stats: { pathCount: normalized.pathCount, pathCommandCount: normalized.pathCommandCount,
    paletteColors: sampled.colours.length, visiblePixels: sampled.visiblePixels } }
  const result = fitVectorDraft(image, draft, options, signal)
  return { ...result, stats: { ...result.stats, tonalRegionCount: regions.length, mergedRegionCount, gradientCount: gradients.length,
    maxGradientChannelError: Math.max(0, ...gradients.map(g => g.gradient.maximum)) } }
}
