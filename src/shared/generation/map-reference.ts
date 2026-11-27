import { distanceToSegment, pointInPolygon, polygonInside, polygonValid, polygonsOverlap } from '../geometry/geometry.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { simplifyRing, traceIndexedContours } from '../image-import/vector.js'
import type { PointMm } from '../model/scene.js'
import { signedVisualArea } from '../visual/geometry.js'
import { MAP_LANDSCAPE_LIMITS, MAP_REFERENCE_DEFAULTS, parseMapGenerate, parseMapReference, type MapLandscapeRecipe } from './map-authoring.js'
import { narrowReferenceJoins } from './map-reference-review.js'
import { inferReferenceGround } from './map-reference-ground.js'
import { landformStructureIssue } from './landform-structure.js'
import { extendReferenceShallows, inferReferenceShallows, openReferenceWater, referenceShallowIssue, referenceWaterColors } from './map-reference-coast.js'
import { fitReferenceLandforms } from './map-reference-landforms.js'

const ANALYSIS_EDGE = 640
const tolerances = { coarse: 2.9, balanced: 1.65, fine: .9 }
type Guide = ReturnType<typeof parseMapReference>
type ReferenceBoundaries = {
  regions: { id: string; boundary: PointMm[] }[]
  lakes: { areaId: string; boundary: PointMm[] }[]
}
export type ReferenceCorrection = Guide['corrections'][number]
export type MapReferenceIssue = { at: PointMm; message: string; kind: 'sample' | 'gap' | 'boundary' | 'interior' | 'design'; correction?: ReferenceCorrection; id?: string }

function pixelColor(image: ImagePixels, x: number, y: number) {
  const offset = (Math.min(image.height - 1, Math.floor(y)) * image.width + Math.min(image.width - 1, Math.floor(x))) * 4
  const [r, g, b, alpha] = image.data.subarray(offset, offset + 4)
  // Water and ink can have similar lightness. Give chroma more weight while
  // allowing a sampled surface to vary under shading or a printed grid.
  return [g - r, b - g, (r + g + b) * .11, alpha]
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]

function sampleColor(image: ImagePixels, point: PointMm) {
  const samples: number[][] = []
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    samples.push(pixelColor(image, Math.max(0, point.x + x), Math.max(0, point.y + y)))
  }
  return [0, 1, 2, 3].map(channel => median(samples.map(row => row[channel])))
}

function nearestColor(r: number, g: number, b: number, palette: readonly number[][]) {
  let best = Infinity
  for (const value of palette) best = Math.min(best, (r - value[0]) ** 2 + (g - value[1]) ** 2 + (b - value[2]) ** 2)
  return best
}

function referencePalette(image: ImagePixels, guide: Guide, issues: MapReferenceIssue[]) {
  const backgrounds = guide.background.map(at => ({ at, color: sampleColor(image, at) }))
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const radius = guide.tolerance * 1.45
  // A small number of mislabeled samples should not recolor every similarly
  // shaded boundary. Keep multiple color families when there is no consensus.
  const core = backgrounds.map(row => backgrounds.filter(other => distance(row.color, other.color) <= radius))
    .reduce<typeof backgrounds>((best, group) => group.length > best.length ? group : best, [])
  const center = backgrounds.length >= 4 && core.length >= Math.ceil(backgrounds.length * .7)
    ? [0, 1, 2].map(channel => median(core.map(row => row.color[channel]))) : undefined
  const backdrop = backgrounds.filter(row => {
    // Compare with the consensus center. A darker in-family sample can sit
    // next to a land color without pulling that color into the global palette.
    if (!center || distance(row.color, center) <= radius) return true
    issues.push({ kind: 'sample', at: row.at, message: '该背景样点和主要背景色差异过大。需要去掉这块时，可在此处擦成背景。' })
    return false
  })
  const land = guide.foreground.flatMap(at => {
    const color = sampleColor(image, at)
    if (backdrop.every(row => distance(row.color, color) > guide.tolerance * .55)) return [{ at, color }]
    issues.push({ kind: 'sample', at, message: '该陆地色和背景太接近。可用保留地块或补陆地，仅影响此处。' })
    return []
  })
  return { backdrop, land }
}

/** Flood one label without allocating per pixel or allowing corner-only joins. */
function component(mask: Uint8Array, width: number, first: number, label: number, queue: Int32Array) {
  let size = 1, touchesFrame = false
  mask[first] = 2
  queue[0] = first
  const enqueue = (neighbor: number) => {
    if (mask[neighbor] === label) {
      mask[neighbor] = 2
      queue[size++] = neighbor
    }
  }
  for (let i = 0; i < size; i++) {
    const p = queue[i], x = p % width
    if (x) enqueue(p - 1)
    if (x < width - 1) enqueue(p + 1)
    enqueue(p - width)
    enqueue(p + width)
    touchesFrame ||= x === 0 || x === width - 1 || p < width || p >= mask.length - width
  }
  return { size, touchesFrame }
}

function denoise(mask: Uint8Array, width: number, height: number, reach: number) {
  return mask.map((value, i) => {
    const x = i % width, y = Math.floor(i / width)
    if (!x || !y || x === width - 1 || y === height - 1) return value
    let land = 0, count = 0
    for (let dy = Math.max(-reach, -y); dy <= Math.min(reach, height - 1 - y); dy++) {
      for (let dx = Math.max(-reach, -x); dx <= Math.min(reach, width - 1 - x); dx++) {
        land += mask[i + dy * width + dx]
        count++
      }
    }
    return land * 2 >= count ? 1 : 0
  })
}

function fitRing(ring: PointMm[], tolerance: number, limit: number, fits: (points: PointMm[]) => boolean) {
  for (const distance of [tolerance, tolerance * 1.45, tolerance * .65, tolerance * 1.9, tolerance * 2.6, tolerance * 3.4,
    tolerance * 4.2, tolerance * .35, 0]) {
    const candidate = simplifyRing(ring, distance)
    if (candidate.length <= limit && polygonValid(candidate, true) && fits(candidate)) return candidate
  }
  return null
}

function applyReferenceCorrections(mask: Uint8Array, width: number, height: number, sx: number, sy: number,
  strokes: Guide['corrections']) {
  let work = 0
  for (const { points, kind, radiusPx } of strokes) {
    const segments = points.map((point, i) => [points[Math.max(0, i - 1)], point] as const)
    for (const [a, b] of segments) {
      const x1 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radiusPx) / sx))
      const y1 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radiusPx) / sy))
      const x2 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + radiusPx) / sx))
      const y2 = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + radiusPx) / sy))
      work += (x2 - x1 + 1) * (y2 - y1 + 1)
      if (work > 8_000_000) throw new Error('轮廓修正的覆盖面积过大。可减小画笔或减少重复笔画。')
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
        if (distanceToSegment({ x: (x + .5) * sx, y: (y + .5) * sy }, a, b) <= radiusPx) mask[y * width + x] = kind === 'land' ? 1 : 0
      }
    }
  }
}

export function referenceLandAt(outline: ReferenceBoundaries, at: PointMm) {
  return outline.regions.find(row => pointInPolygon(at, row.boundary, false)
    && !outline.lakes.some(lake => lake.areaId === row.id && pointInPolygon(at, lake.boundary)))?.id
}

function referenceDesign(guide: Guide, source: ImagePixels, outline: ReferenceBoundaries) {
  const design = guide.design
  if (!design) return {}
  const longEdge = Math.max(source.width, source.height), radius = (fraction: number) => {
    const size = Math.max(2, Math.round(longEdge * fraction))
    return { x: size, y: size }
  }
  const issues: MapReferenceIssue[] = []
  const warn = (id: string, at: PointMm, message: string) => issues.push({ kind: 'design', at, id, message: `「${id}」${message}` })
  const marks = design.landforms.flatMap(row => {
    const areaId = referenceLandAt(outline, row.at)
    if (!areaId || row.areaId !== undefined && row.areaId !== areaId) {
      warn(row.id, row.at, '地貌标记须在叠图上的指定陆地内。可移动标记或修正此处轮廓。')
      return []
    }
    const form = { ...row, areaId, radius: row.radius ?? radius(.10) }
    if (form.structure) {
      const issue = landformStructureIssue(form.structure, form.at, form.radius, outline.regions.find(region => region.id === areaId)!.boundary,
        outline.lakes.filter(lake => lake.areaId === areaId).map(lake => lake.boundary))
      if (issue) { warn(row.id, row.at, issue); return [] }
    }
    return [form]
  })
  const coast = guide.environment === 'coast' && guide.shorelineFromReference ? {
    mmPerPixel: (design.longEdgeMm ?? MAP_REFERENCE_DEFAULTS.longEdgeMm) / longEdge,
    starts: design.ascents.map(row => ({ at: row.from, radius: row.radius ?? radius(.055) })),
    reservedIds: [...design.ascents, ...(design.shallows ?? [])].map(row => row.id),
  } : undefined
  const { marked, outcrops, cliffs } = guide.structureFromReference ? fitReferenceLandforms(source, outline, marks, coast)
    : { marked: marks, outcrops: [], cliffs: [] }
  const landforms = [...marked, ...outcrops, ...cliffs]
  const routes = design.ascents.flatMap(row => {
    const target = marked.find(form => form.id === row.to)
    const areaId = referenceLandAt(outline, row.from)
    if (!areaId || areaId !== target?.areaId || target.shape === 'lowland') {
      warn(row.id, row.from, '登高的出发区和终点须在同一块陆地上。请核对目标地标和叠图。')
      return []
    }
    const route: MapLandscapeRecipe['routes'][number] = { id: row.id, areaId, style: row.style, widthMm: row.widthMm,
      ascent: { from: { at: row.from, radius: row.radius ?? radius(.055) }, toLandmarkId: row.to,
        minRiseMm: row.minRiseMm, staircase: row.staircase,
        ...(row.minWidthMm === undefined ? {} : { minWidthMm: row.minWidthMm }) },
      ...(row.around ? { around: { landmarkId: row.to, side: row.around } } : {}) }
    return [route]
  })
  const dimensions = design.longEdgeMm === undefined ? {}
    : source.width >= source.height ? { widthMm: design.longEdgeMm } : { heightMm: design.longEdgeMm }
  return { dimensions, seed: design.seed, landforms, routes, outcrops, cliffs, designIssues: issues }
}

/** Suggest native terrain from local pixels and a few editable sample
 * points. References remain review input, separate from generated assets. */
export function traceMapReference(image: ImagePixels, raw: unknown) {
  const guide = parseMapReference(raw)
  const referenceSizePx = { width: image.width, height: image.height }
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 3 || image.height < 3
    || image.width > 8192 || image.height > 8192 || image.width * image.height > 32_000_000
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('参考图需要完整的静态 RGBA 像素。')
  const points = [...guide.background, ...guide.foreground, ...guide.keep, ...guide.shallow, ...guide.omit, ...guide.corrections.flatMap(stroke => stroke.points),
    ...(guide.design?.landforms.map(row => row.at) ?? []), ...(guide.design?.ascents.map(row => row.from) ?? [])]
  if (points.some(p => p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height)) throw new Error('取样点须在原图像素范围内。')

  const ratio = Math.min(1, ANALYSIS_EDGE / Math.max(image.width, image.height))
  const width = Math.max(3, Math.round(image.width * ratio)), height = Math.max(3, Math.round(image.height * ratio))
  const sx = image.width / width, sy = image.height / height
  const cell = (p: PointMm) => Math.floor(p.y / sy) * width + Math.floor(p.x / sx)
  const at = (i: number) => ({ x: Math.floor((i % width + .5) * sx), y: Math.floor((Math.floor(i / width) + .5) * sy) })
  const issues: MapReferenceIssue[] = []
  const palette = referencePalette(image, guide, issues)
  const colors = palette.backdrop.map(row => row.color)
  const mask = new Uint8Array(width * height), certainty = new Uint8Array(mask.length)
  const coast = guide.environment === 'coast' && guide.shorelineFromReference
  const waterColors = coast ? referenceWaterColors(colors) : undefined
  const localLand = waterColors ? palette.land.filter(row => waterColors.sharedHue(row.color)) : []
  const solid = palette.land.filter(row => !localLand.includes(row)).map(row => row.color)
  const waterCandidates = waterColors && { open: new Uint8Array(mask.length), nearshore: new Uint8Array(mask.length) }
  const localRadius = Math.max(sx, sy) * Math.max(3, Math.round(Math.max(width, height) * .016))
  const toleranceSquared = guide.tolerance ** 2
  for (let i = 0; i < mask.length; i++) {
    const x = (i % width + .5) * sx, y = (Math.floor(i / width) + .5) * sy
    const pixel = pixelColor(image, x, y), [a, b, l, alpha] = pixel
    if (alpha < 128) continue
    const backdrop = nearestColor(a, b, l, colors)
    const foreground = nearestColor(a, b, l, solid)
    if (localLand.some(row => Math.abs(x - row.at.x) <= localRadius && Math.abs(y - row.at.y) <= localRadius
      && Math.hypot(x - row.at.x, y - row.at.y) <= localRadius
      && (a - row.color[0]) ** 2 + (b - row.color[1]) ** 2 + (l - row.color[2]) ** 2 <= toleranceSquared * .36)) {
      mask[i] = 1
      continue
    }
    mask[i] = backdrop < toleranceSquared && backdrop < foreground ? 0 : 1
    certainty[i] = backdrop < toleranceSquared * .32 && backdrop < foreground ? 2
      : backdrop < toleranceSquared * 1.7 && backdrop < foreground * 1.25 ? 1 : 0
    if (waterCandidates && waterColors) {
      const distinct = foreground > toleranceSquared * .50, shallow = distinct && waterColors.shallow(pixel)
      waterCandidates.open[i] = Number(!mask[i] || shallow || distinct && waterColors.shadow(pixel))
      waterCandidates.nearshore[i] = shallow ? 2 : Number(distinct && waterColors.paleShallow(pixel))
    }
  }
  if (waterCandidates) {
    for (const point of [...guide.foreground, ...guide.keep]) {
      const i = cell(point)
      waterCandidates.open[i] = 0
      waterCandidates.nearshore[i] = 0
    }
    const connected = extendReferenceShallows(openReferenceWater(waterCandidates.open, width), waterCandidates.nearshore, width)
    for (let i = 0; i < mask.length; i++) if (connected[i] && mask[i]) {
      mask[i] = 0; certainty[i] = Math.max(1, certainty[i])
    }
  }
  const clean = denoise(denoise(mask, width, height, guide.detail === 'fine' ? 1 : 2), width, height, 1)
  // Preserve a coherent narrow strip of confidently sampled water through the
  // majority filter, while isolated ink flecks still go through denoising.
  for (let i = width; i < clean.length - width; i++) {
    const x = i % width
    if (clean[i] && certainty[i] === 2 && (certainty[i - width] === 2 && certainty[i + width] === 2
      || x > 0 && x < width - 1 && certainty[i - 1] === 2 && certainty[i + 1] === 2)) clean[i] = 0
  }
  const backgroundSamples = new Map(palette.backdrop.map(({ at }) => [cell(at), at]))
  const foregroundSamples = new Map([...palette.land.map(row => row.at), ...guide.keep].map(p => [cell(p), p]))
  const allBackground = new Set(guide.background.map(cell))
  const allForeground = [...guide.foreground, ...guide.keep].map(cell)
  const omit = new Set(guide.omit.map(cell))
  const shallowCells = new Set(guide.shallow.map(cell))
  if (allForeground.some(i => allBackground.has(i) || shallowCells.has(i) || omit.has(i))) throw new Error('同一位置不能同时标为地面和背景、浅水或忽略。')
  for (const i of backgroundSamples.keys()) clean[i] = 0
  for (const i of foregroundSamples.keys()) clean[i] = 1
  applyReferenceCorrections(clean, width, height, sx, sy, guide.corrections)
  for (const { kind, points } of guide.corrections) {
    const [samples, label] = kind === 'land' ? [foregroundSamples, 1] as const : [backgroundSamples, 0] as const
    for (const p of points) if (clean[cell(p)] === label) samples.set(cell(p), p)
  }
  for (const i of foregroundSamples.keys()) if (!clean[i]) foregroundSamples.delete(i)
  for (const i of backgroundSamples.keys()) if (clean[i]) backgroundSamples.delete(i)

  const queue = new Int32Array(clean.length), waterMask = clean.slice()
  const minimumArea = Math.max(5, Math.ceil(clean.length * ({ coarse: .0015, balanced: .00058, fine: .00023 }[guide.detail])))
  const inland = new Set<number>()
  for (let i = 0; i < clean.length; i++) if (waterMask[i] === 0) {
    const { size, touchesFrame } = component(waterMask, width, i, 0, queue)
    if (touchesFrame) continue
    const explicit = queue.subarray(0, size).filter(p => backgroundSamples.has(p))
    // Interior strokes and shadows are common. An enclosed body needs a
    // sample before it can cut a hole in the editable terrain.
    if (!explicit.length) {
      if (size >= minimumArea * 2 && issues.filter(issue => issue.kind === 'interior').length < 3) {
        const center = at(queue[Math.floor(size / 2)])
        issues.push({ kind: 'interior', at: center, message: '陆地内有一片类似背景的颜色。若实际为内水，可在这里取背景色或局部涂水。' })
      }
      for (let j = 0; j < size; j++) clean[queue[j]] = 1
    }
    else for (const p of explicit) inland.add(p)
  }

  const openWater = coast || guide.shallow.length ? openReferenceWater(clean.map(value => Number(!value)), width) : undefined
  if (openWater) for (const at of guide.shallow) if (!openWater[cell(at)]) {
    issues.push({ kind: 'sample', at, message: '该浅水标记未接到外海。可修正岸线，或画出所需的浅水范围。' })
  }
  const labels = new Int16Array(clean.length).fill(-1)
  issues.push(...narrowReferenceJoins(clean, certainty, width, minimumArea, at, Math.max(sx, sy)))
  const blobs: { index: number; size: number; kept: boolean; seeds: PointMm[] }[] = []
  let discardedSmall = 0, discardedOmitted = 0
  for (let i = 0; i < clean.length; i++) if (clean[i] === 1) {
    const { size } = component(clean, width, i, 1, queue)
    const members = queue.subarray(0, size)
    const seeds: PointMm[] = []
    for (const member of members) {
      const sample = foregroundSamples.get(member)
      if (sample) seeds.push(sample)
    }
    if (members.some(p => omit.has(p)) && !seeds.length) { discardedOmitted++; continue }
    if (size < minimumArea && !seeds.length) { discardedSmall++; continue }
    if (blobs.length >= 32767) throw new Error('图中分离色块太多，请提高简化程度或补充背景取样。')
    blobs.push({ index: i, size, kept: seeds.length > 0, seeds })
  }
  blobs.sort((a, b) => b.size - a.size || a.index - b.index)
  const largest = blobs[0]
  if (!largest || largest.size >= clean.length * .995) throw new Error('未能区分地面和背景。请重新取样或调节颜色容差。')
  const selected = [largest, ...blobs.slice(1).sort((a, b) => Number(b.kept) - Number(a.kept))].slice(0, MAP_LANDSCAPE_LIMITS.land)
  const landMask = Uint8Array.from(clean, value => value === 2 ? 1 : 0)
  for (const [label, blob] of selected.entries()) {
    const { size } = component(landMask, width, blob.index, 1, queue)
    for (let j = 0; j < size; j++) labels[queue[j]] = label
  }
  const contours = traceIndexedContours({ width, height }, labels)
  const toSource = (ring: PointMm[]) => ring.map(p => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy) }))
  const tolerance = Math.max(sx, sy) * tolerances[guide.detail]
  const fitted: { id: string; label: number; boundary: PointMm[]; pixels: number; rawPoints: number; kept: boolean; holes: PointMm[][] }[] = []
  const notes: string[] = []
  for (const [label, blob] of selected.entries()) {
    const rings = (contours.get(label) ?? []).map(toSource).sort((a, b) => signedVisualArea(b) - signedVisualArea(a))
    const raw = rings[0], id = label === 0 ? 'main' : `land-${label + 1}`
    const holes = rings.slice(1).filter(ring => signedVisualArea(ring) < 0
      && [...inland].some(i => pointInPolygon(backgroundSamples.get(i)!, ring)))
    const fits = (candidate: PointMm[]) => blob.seeds.every(p => pointInPolygon(p, candidate))
      && fitted.every(other => !polygonsOverlap(other.boundary, candidate) || other.holes.some(hole => polygonInside(candidate, hole)))
    const preferred = label ? 55 : guide.detail === 'fine' ? 220 : 135
    const boundary = raw && (fitRing(raw, tolerance, preferred, fits) ?? fitRing(raw, tolerance, label ? 112 : 420, fits))
    if (!boundary) {
      if (label === 0 || blob.kept) throw new Error(`无法为「${id}」拟合无交叠轮廓。请补充边缘取样或提高简化程度。`)
      notes.push(`「${id}」的轮廓不稳定，叠图中未采用。`)
      continue
    }
    fitted.push({ id, label, boundary, pixels: Math.round(blob.size * sx * sy), rawPoints: raw.length, kept: blob.kept, holes })
  }
  const lakes = fitted.flatMap(row => row.holes.flatMap((ring, index) => {
    if (guide.environment !== 'coast') {
      notes.push('陆地配方检测到标记的内部背景。若是湖面，可切到水岸环境。')
      return []
    }
    const boundary = fitRing([...ring].reverse(), tolerance, 160, points => polygonInside(points, row.boundary)
      && fitted.filter(other => other !== row && polygonInside(other.boundary, ring)).every(other => polygonInside(other.boundary, points)))
    if (!boundary) { notes.push(`「${row.id}」内有一处水面轮廓需手工核对。`); return [] }
    return [{ id: `${row.id}-lake-${index + 1}`, areaId: row.id, boundary }]
  }))
  const land = fitted.map(({ id, boundary, pixels }) => {
    const reef = guide.environment === 'coast' && id !== 'main' && pixels < image.width * image.height * .007
    return { id, boundary, outline: 'traced' as const, form: reef ? 'reef' as const : 'natural' as const,
      ...(reef && coast ? { cover: 'rock' as const, elevationMm: Math.max(420, Math.min(3500, Math.round(Math.sqrt(pixels / (image.width * image.height)) * 37_000))) } : {}) }
  })
  if (blobs.length > MAP_LANDSCAPE_LIMITS.land || lakes.length > MAP_LANDSCAPE_LIMITS.lakes) notes.push('部分小块超出单图候选容量。可标记要保留的地块或提高简化程度。')
  const includedLakes = lakes.slice(0, MAP_LANDSCAPE_LIMITS.lakes)
  const regions = fitted.map(({ holes: _holes, label: _label, ...row }) => row)
  const { dimensions, seed, landforms, routes, outcrops = [], cliffs = [], designIssues = [] } = referenceDesign(guide, image, { regions, lakes: includedLakes })
  issues.push(...designIssues)
  const ground = guide.surfaceFromReference ? inferReferenceGround(image, labels, width, fitted, coast ? openWater : undefined) : undefined
  const manualShallows = (guide.design?.shallows ?? []).filter(zone => {
    const problem = guide.environment !== 'coast' ? '浅水范围使用水岸环境。' : referenceShallowIssue(zone.boundary, referenceSizePx, regions)
    if (!problem) return true
    const first = zone.boundary[0]
    const at = { x: Math.max(0, Math.min(image.width - 1, first.x)), y: Math.max(0, Math.min(image.height - 1, first.y)) }
    issues.push({ kind: 'design', id: zone.id, at, message: `「${zone.id}」${problem}` })
    return false
  })
  const autoShallows = openWater && guide.environment === 'coast' ? inferReferenceShallows(referenceSizePx, openWater, width, coast ? colors : [],
    guide.shallow, (x, y) => pixelColor(image, x, y), p => sampleColor(image, p))
    .filter(zone => !regions.some(region => polygonInside(zone.boundary, region.boundary))
      && !manualShallows.some(manual => polygonsOverlap(manual.boundary, zone.boundary))) : []
  const ids = new Set([...(landforms ?? []), ...(routes ?? []), ...manualShallows].map(row => row.id))
  for (const zone of [...(ground?.covers ?? []), ...(ground?.scenery ?? []), ...autoShallows]) {
    while (ids.has(zone.id)) zone.id += '-auto'
    ids.add(zone.id)
  }
  const shallows = [...manualShallows, ...autoShallows.slice(0, MAP_LANDSCAPE_LIMITS.shallows - manualShallows.length)]
  const request = parseMapGenerate({ title: guide.title, referenceSizePx, ...dimensions, ...(seed ? { seed } : {}),
    recipe: { kind: 'landscape', environment: guide.environment, land, ...(ground ? { covers: ground.covers, scenery: ground.scenery } : {}),
      ...(landforms ? { landforms, routes } : {}), ...(shallows.length ? { shallows } : {}),
      ...(includedLakes.length ? { lakes: includedLakes } : {}), finish: 'natural' } })
  return { request, guide, referenceSizePx,
    regions, lakes: includedLakes, issues, notes, discardedSmall, discardedOmitted,
    automaticSurface: { grassPatches: ground?.grassCount ?? 0, groves: ground?.scenery.length ?? 0 },
    coastFeatures: { shallows, dryStrands: ground?.strandCount ?? 0,
      reefs: land.filter(row => row.form === 'reef').map(row => row.id), outcrops: outcrops.map(row => row.id), cliffs: cliffs.map(row => row.id) } }
}

export type MapReferenceResult = ReturnType<typeof traceMapReference>
