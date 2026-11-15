import { z } from 'zod'
import type { ImagePixels, ImagePixelMask, PixelBounds } from './pixels.js'
import type { ImageReplayLayer } from './layer-replay.js'
import { replayImageLayers } from './layer-replay.js'
import type { ImageRepairSurface } from './surfaces.js'
import { imagePointSchema } from './calibration.js'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'
import { imageNeighborhoodObjectEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { maskCoverage } from './repair-scope.js'

const bounds = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().min(5).max(256), height: z.number().int().min(5).max(256) })
const binary = imageSelectionMaskSchema.refine(m => m.runs.every((v, i) => i % 2 === 0 || v === 0 || v === 255), '表面保护须为二值蒙版。')
export const imageSurfaceRefinementSchema = z.strictObject({
  method: z.literal('cloth-surface-v1'), materialSurfaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), donor: bounds, seed: z.number().int().min(0).max(0xffffffff),
  reason: z.string().trim().min(1).max(400), protectionMask: binary.optional(),
  strokes: z.array(z.strictObject({ role: z.enum(['visible-cloth-seam', 'visible-cloth-stitch']),
    axis: z.enum(['horizontal', 'vertical']), points: z.array(imagePointSchema).min(2).max(16),
    crossPx: z.union([z.literal(11), z.literal(13)]), bridgeMaxPx: z.number().int().min(0).max(48),
    reason: z.string().trim().min(1).max(400) })).max(8),
})
export type ImageSurfaceRefinement = z.infer<typeof imageSurfaceRefinementSchema>
type SurfaceLayer = ImageReplayLayer & { surfaceRefinement?: ImageSurfaceRefinement; subjectRefinement?: unknown; vector?: unknown }
const median = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const hash = (x: number, y: number, seed: number) => {
  let n = Math.imul(x + 1, 0x1b873593) ^ Math.imul(y + 1, 0x85ebca6b) ^ seed
  n = Math.imul(n ^ n >>> 16, 0x7feb352d)
  return (n ^ n >>> 15) >>> 0
}

export function validateImageSurfaceRefinement(image: { width: number; height: number }, value?: ImageSurfaceRefinement): void {
  if (!value) return
  const options = imageSurfaceRefinementSchema.parse(value), d = options.donor
  if (d.x + d.width > image.width || d.y + d.height > image.height || d.width * d.height > 4096) throw new Error('净毯取样须在原图内，至少5×5且最多4096像素。')
  if (options.protectionMask) decodeSelectionMask(options.protectionMask, image)
  assertSelectionMaskBudget([options.protectionMask])
  let length = 0
  for (const stroke of options.strokes) {
    const along = (p: { x: number; y: number }) => stroke.axis === 'horizontal' ? p.x : p.y
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i]
      if (p.x >= image.width || p.y >= image.height) throw new Error('原布缝引导须在原图内。')
      if (i) {
        if (along(p) <= along(stroke.points[i - 1])) throw new Error('原布缝须沿明确方向单调前进，不能折返。')
        length += Math.hypot(p.x - stroke.points[i - 1].x, p.y - stroke.points[i - 1].y)
      }
    }
    if (stroke.role === 'visible-cloth-stitch' && stroke.bridgeMaxPx) throw new Error('原针脚不自动补隐藏连接。')
  }
  if (length > 8192) throw new Error('净毯原笔迹引导合计最多8192像素。')
}

/** An explicit inferred item appearance, separate from removal/repair rights.
 * Paper/grain donors exclude shadows and every declared removal. Explicit
 * visible stroke guides instead observe original shaded cloth outside actual
 * silhouettes; those observations never become clean paper or grain donors.
 * Source-fidelity replay and background provenance remain unchanged. */
export function previewImageImportSurface<T extends SurfaceLayer>(source: ImagePixels, layers: readonly T[], surfaces: readonly ImageRepairSurface[],
  target: string, input: ImageSurfaceRefinement, signal?: ImageNeighborhoodSignal) {
  const options = imageSurfaceRefinementSchema.parse(input)
  validateImageSurfaceRefinement(source, options)
  const index = layers.findIndex(l => l.id === target), layer = layers[index]
  if (index < 0) throw new Error('净毯目标不存在。')
  if (layer.renderLayer !== 'ground' || layer.subjectRefinement || layer.vector) throw new Error('净毯表面处理只用于独立地面item，不能与主体边带或矢量配方同时采用。')
  const replay = replayImageLayers(source, layers.slice(0, index + 1), surfaces, { evidenceLayers: layers, signal })
  const original = replay.layers[index].extracted.layer, selected = replay.layers[index].extracted.mask
  const { width: w, height: h, boundsPx: b } = original
  if (w * h > 250_000 || selected.data.some(v => v !== 0 && v !== 255)) throw new Error('净毯处理需要最多25万像素的明确二值选区。')
  const material = surfaces.find(s => s.id === options.materialSurfaceId)
  if (!material) throw new Error('净毯须明确选择已有的同材质表面，不能借用移毯后的木板取证。')
  const materialMask = decodeSelectionMask(material.mask, source)
  for (let y = 0; y < selected.height; y++) for (let x = 0; x < selected.width; x++) {
    if (selected.data[y * selected.width + x] && maskCoverage(materialMask, selected.boundsPx.x + x, selected.boundsPx.y + y) !== 255) {
      throw new Error('净毯完整选区须位于所声明的同材质表面内，不能将底色应用到其他材质。')
    }
  }
  const protection = [layer.protectionMask, options.protectionMask].filter(v => !!v).map(v => decodeSelectionMask(v, source))
  const others = layers.filter(l => l.id !== target && l.renderLayer !== 'ground')
  const paperBlocked = imageNeighborhoodObjectEvidence(source, others)
  const strokeBlocked = imageNeighborhoodObjectEvidence(source, others.map(other => { const { removalMask: ignored, ...silhouette } = other; return silhouette }))
  for (const other of others) if (other.protectionMask) strokeBlocked.push(decodeSelectionMask(other.protectionMask, source))
  if (material.excludedEvidenceMask) paperBlocked.push(decodeSelectionMask(material.excludedEvidenceMask, source))
  const protectedAt = (x: number, y: number) => protection.some(m => !!maskCoverage(m, x, y))
  const observed = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < source.width && y < source.height
    && maskCoverage(selected, x, y) === 255 && maskCoverage(materialMask, x, y) === 255 && source.data[(y * source.width + x) * 4 + 3] === 255 && !protectedAt(x, y)
  const cleanPaper = (x: number, y: number) => observed(x, y) && !paperBlocked.some(m => !!maskCoverage(m, x, y))
  const visibleStroke = (x: number, y: number) => observed(x, y) && !strokeBlocked.some(m => !!maskCoverage(m, x, y))
  const samples = [[], [], []] as number[][], d = options.donor
  const rgb = (x: number, y: number, c: number) => source.data[(y * source.width + x) * 4 + c]
  for (let y = d.y; y < d.y + d.height; y++) for (let x = d.x; x < d.x + d.width; x++) {
    if (!cleanPaper(x, y)) throw new Error(`净毯底色/细纹取样(${x},${y})含邻物、移除、保护或取证排除，不能使用。`)
    for (let c = 0; c < 3; c++) samples[c].push(rgb(x, y, c))
  }
  const tone = samples.map(median), grain = new Float32Array(d.width * d.height * 3)
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) for (let c = 0; c < 3; c++) {
    let total = 0, count = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < d.width && y + dy < d.height) { total += rgb(d.x + x + dx, d.y + y + dy, c); count++ }
    grain[(y * d.width + x) * 3 + c] = clamp(rgb(d.x + x, d.y + y, c) - total / count, -3, 3)
  }
  const depth = new Uint16Array(w * h), output = { ...original, data: original.data.slice(), boundsPx: { ...b } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (original.data[(y * w + x) * 4 + 3]) depth[y * w + x] = Math.min(x + 1, y + 1, w - x, h - y, x ? depth[y * w + x - 1] + 1 : 1, y ? depth[(y - 1) * w + x] + 1 : 1)
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) if (depth[y * w + x]) depth[y * w + x] = Math.min(depth[y * w + x], x + 1 < w ? depth[y * w + x + 1] + 1 : 1, y + 1 < h ? depth[(y + 1) * w + x] + 1 : 1)
  const writable = (x: number, y: number) => x >= b.x && y >= b.y && x < b.x + w && y < b.y + h
    && depth[(y - b.y) * w + x - b.x] > 3 && !protectedAt(x, y) && original.data[((y - b.y) * w + x - b.x) * 4 + 3] === 255
  for (let y = 0; y < h; y++) {
    signal?.throwIfAborted()
    for (let x = 0; x < w; x++) if (writable(b.x + x, b.y + y)) {
      let u = clamp((depth[y * w + x] - 3) / 8, 0, 1); u = u * u * (3 - 2 * u)
      for (let c = 0; c < 3; c++) {
        let detail = 0, weights = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const weight = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1; detail += grain[(hash(b.x + x + dx, b.y + y + dy, options.seed) % (d.width * d.height)) * 3 + c] * weight; weights += weight }
        const at = (y * w + x) * 4 + c, fill = tone[c] + detail / weights + 1.5 - 3 * y / Math.max(1, h - 1)
        output.data[at] = Math.round(clamp(original.data[at] * (1 - u) + fill * u, 0, 255))
      }
    }
  }
  const ink = new Float32Array(w * h * 3), reports: Array<{ role: string; qualifiedColumns: number; totalColumns: number; inferredRuns: PixelBounds[]; unresolvedRuns: PixelBounds[] }> = []
  let observedPixels = 0, inferredPixels = 0
  const setInk = (x: number, y: number, residual: number[]) => {
    if (!writable(x, y)) return
    const i = ((y - b.y) * w + x - b.x) * 3
    for (let c = 0; c < 3; c++) ink[i + c] = Math.max(ink[i + c], residual[c])
  }
  for (const guide of options.strokes) {
    signal?.throwIfAborted()
    const horizontal = guide.axis === 'horizontal', along = (p: { x: number; y: number }) => horizontal ? p.x : p.y, across = (p: { x: number; y: number }) => horizontal ? p.y : p.x
    const start = Math.ceil(along(guide.points[0])), end = Math.floor(along(guide.points.at(-1)!)), radius = (guide.crossPx - 1) / 2
    const coords = (u: number, v: number): [number, number] => horizontal ? [u, v] : [v, u]
    type Column = { u: number; center: number; mid: number; residual: number[][]; maximum: number }
    const columns: Array<Column | undefined> = [], occluded: boolean[] = []
    for (let u = start; u <= end; u++) {
      let p = 1; while (p < guide.points.length - 1 && along(guide.points[p]) < u) p++
      const a = guide.points[p - 1], z = guide.points[p], t = (u - along(a)) / (along(z) - along(a)), mid = Math.round(across(a) * (1 - t) + across(z) * t)
      const points = Array.from({ length: guide.crossPx }, (_, j) => coords(u, mid + j - radius)), ok = points.map(([x, y]) => visibleStroke(x, y))
      const sides = [points.map((_, j) => j).filter(j => ok[j] && j - radius <= -4), points.map((_, j) => j).filter(j => ok[j] && j - radius >= 4)]
      occluded.push(!ok[radius] || sides.some(s => s.length < 2))
      if (sides.some(s => s.length < 2) || ok.filter(Boolean).length < 7) { columns.push(undefined); continue }
      const paper = sides.map(side => [0, 1, 2].map(c => median(side.map(j => rgb(points[j][0], points[j][1], c)))))
      const residual = points.map(([x, y], j) => [0, 1, 2].map(c => ok[j] && Math.abs(j - radius) <= 3 ? Math.max(0, paper[0][c] * (1 - j / (guide.crossPx - 1)) + paper[1][c] * j / (guide.crossPx - 1) - rgb(x, y, c)) : 0))
      const depths = residual.map(v => v.reduce((s, n) => s + n, 0) / 3), total = depths.reduce((s, n) => s + n, 0), maximum = Math.max(...depths)
      if (total < 12 || maximum < 6) { columns.push(undefined); continue }
      const center = mid + depths.reduce((s, n, j) => s + n * (j - radius), 0) / total
      columns.push({ u, center, mid, residual, maximum })
      points.forEach(([x, y], j) => { if (ok[j] && depths[j] > 0 && writable(x, y)) { setInk(x, y, residual[j]); observedPixels++ } })
    }
    const qualified = columns.filter((v): v is Column => !!v), medianPeak = qualified.length ? median(qualified.map(c => c.maximum)) : 0
    const regular = qualified.filter(c => c.maximum <= medianPeak * 1.7)
    const profile = Array.from({ length: 11 }, (_, j) => [0, 1, 2].map(channel => regular.length ? median(regular.map(col => {
      const v = col.center + j - 5 - col.mid + radius, first = Math.floor(v), t = v - first
      return (col.residual[first]?.[channel] ?? 0) * (1 - t) + (col.residual[first + 1]?.[channel] ?? 0) * t
    })) : 0))
    const inferredRuns: PixelBounds[] = [], unresolvedRuns: PixelBounds[] = []
    for (let j = 0; j < columns.length; j++) {
      if (columns[j]) continue
      const first = j; while (j + 1 < columns.length && !columns[j + 1]) j++
      const last = j, left = columns[first - 1], right = columns[last + 1], length = last - first + 1
      const canBridge = guide.role === 'visible-cloth-seam' && !!left && !!right && length <= guide.bridgeMaxPx && regular.length >= 5 && Math.abs(left.center - right.center) <= 2 && occluded.slice(first, last + 1).every(Boolean)
      const rect = horizontal ? { x: start + first, y: Math.floor(left?.center ?? across(guide.points[0])) - 5, width: length, height: 11 }
        : { x: Math.floor(left?.center ?? across(guide.points[0])) - 5, y: start + first, width: 11, height: length }
      if (!canBridge) { unresolvedRuns.push(rect); continue }
      inferredRuns.push(rect)
      for (let k = first; k <= last; k++) {
        const t = (k - first + 1) / (length + 1), center = left.center * (1 - t) + right.center * t
        for (let v = Math.floor(center - 5); v <= Math.ceil(center + 5); v++) {
          const z = v - center + 5, low = Math.floor(z), fraction = z - low
          const residual = [0, 1, 2].map(c => (profile[low]?.[c] ?? 0) * (1 - fraction) + (profile[low + 1]?.[c] ?? 0) * fraction)
          const [x, y] = coords(start + k, v)
          if (writable(x, y) && residual.some(c => c > .5)) inferredPixels++
          setInk(x, y, residual)
        }
      }
    }
    reports.push({ role: guide.role, qualifiedColumns: qualified.length, totalColumns: columns.length, inferredRuns, unresolvedRuns })
  }
  let changedPixels = 0
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) output.data[i * 4 + c] = Math.round(clamp(output.data[i * 4 + c] - ink[i * 3 + c], 0, 255))
    if ([0, 1, 2].some(c => output.data[i * 4 + c] !== original.data[i * 4 + c])) changedPixels++
  }
  signal?.throwIfAborted()
  return { pixels: output, original, recipe: options, derived: true as const, originalSourcePreserved: true as const, visualQualityPassed: false as const,
    metrics: { changedPixels, alphaChangedPixels: 0, borderKeepPx: 3, toneRgb: tone, observedStrokeWrites: observedPixels, inferredStrokeWrites: inferredPixels },
    reports, sourceRoles: { toneAndGrain: 'original-clean-only', strokes: 'explicit-visible-original-may-be-shaded', hiddenConnections: 'inferred-only' } as const }
}
