import { distanceToSegment, pointInPolygon, polygonValid, polygonsOverlap } from '../geometry/geometry.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { simplifyOpenPolyline, simplifyRing, traceIndexedContours } from '../image-import/vector.js'
import type { PointMm } from '../model/scene.js'
import { signedVisualArea } from '../visual/geometry.js'
import { MAP_LANDSCAPE_LIMITS, MAP_STRUCTURE_POINTS, type MapLandform, type MapLandformStructure } from './map-authoring.js'
import { landformStructureIssue } from './landform-structure.js'

const point = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) })
type ReferenceLand = {
  regions: { id: string; boundary: PointMm[] }[]
  lakes: { areaId: string; boundary: PointMm[] }[]
}

function colorAt(image: ImagePixels, p: PointMm) {
  const channels = [[], [], []] as [number[], number[], number[]]
  for (const dx of [-2, 0, 2]) for (const dy of [-2, 0, 2]) {
    const x = Math.max(0, Math.min(image.width - 1, p.x + dx)), y = Math.max(0, Math.min(image.height - 1, p.y + dy))
    const index = (y * image.width + x) * 4
    const r = image.data[index], g = image.data[index + 1], b = image.data[index + 2]
    channels[0].push(g - r); channels[1].push(b - g); channels[2].push((r + g + b) / 3)
  }
  return channels.map(channel => channel.sort((a, b) => a - b)[4])
}

function fitRidge(pixels: PointMm[], at: PointMm, step: number) {
  const mean = pixels.reduce((sum, p) => ({ x: sum.x + p.x / pixels.length, y: sum.y + p.y / pixels.length }), { x: 0, y: 0 })
  let xx = 0, xy = 0, yy = 0
  for (const p of pixels) {
    const x = p.x - mean.x, y = p.y - mean.y
    xx += x * x; xy += x * y; yy += y * y
  }
  const angle = .5 * Math.atan2(2 * xy, xx - yy), x = Math.cos(angle), y = Math.sin(angle)
  const variance = (x: number, y: number) => xx * x * x + 2 * xy * x * y + yy * y * y
  if (variance(x, y) < variance(-y, x) * 2.4) return []
  const stations = pixels.map(p => (p.x - at.x) * x + (p.y - at.y) * y).sort((a, b) => a - b)
  const low = stations[Math.floor(stations.length * .14)], high = stations[Math.floor(stations.length * .86)]
  if (high < step * 2 || low > -step * 2) return []
  return [.92, .70, .48].map(scale => [point(at.x + low * x * scale, at.y + low * y * scale), at,
    point(at.x + high * x * scale, at.y + high * y * scale)])
}

function visibleBreakline(boundary: PointMm[], image: ImagePixels, step: number) {
  const rim = boundary.map((a, i) => {
    const b = boundary[(i + 1) % boundary.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x = (b.y - a.y) / length, y = (a.x - b.x) / length
    const inner = colorAt(image, point(center.x - x * step * 1.2, center.y - y * step * 1.2))
    const outer = colorAt(image, point(center.x + x * step * 2.5, center.y + y * step * 2.5))
    return { length, steep: inner[2] - outer[2] > 19 }
  })
  const count = rim.length, first = rim.findIndex(edge => !edge.steep)
  if (first < 0) return undefined
  let run: number[] = [], best: number[] = [], score = 0, longest = 0
  for (let step = 1; step <= count; step++) {
    const index = (first + step) % count, edge = rim[index]
    if (!edge.steep) { run = []; score = 0; continue }
    run.push(index); score += edge.length
    if (score > longest) { longest = score; best = [...run] }
  }
  return longest >= step * 4 && best.length < MAP_STRUCTURE_POINTS
    ? [...best.map(i => boundary[i]), boundary[(best.at(-1)! + 1) % count]] : undefined
}

function formSamples(image: ImagePixels, form: MapLandform, land: PointMm[], lakes: PointMm[][]) {
  const { at, radius } = form
  const step = Math.max(2, Math.ceil(Math.max(radius.x, radius.y) / 23))
  const count = Math.ceil(Math.max(radius.x, radius.y) * .88 / step), width = count * 2 + 1
  const origin = { x: at.x - count * step - Math.floor(step / 2), y: at.y - count * step - Math.floor(step / 2) }
  const cellAt = (i: number) => point(origin.x + (i % width + .5) * step, origin.y + (Math.floor(i / width) + .5) * step)
  const angle = form.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const colors = Array.from({ length: width * width }, (_, i) => {
    const p = cellAt(i), dx = p.x - at.x, dy = p.y - at.y
    if (p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height
      || Math.hypot((dx * cos + dy * sin) / radius.x, (dy * cos - dx * sin) / radius.y) > .84
      || !pointInPolygon(p, land, false) || lakes.some(lake => pointInPolygon(p, lake))) return undefined
    return colorAt(image, p)
  })
  return { step, width, origin, cellAt, colors, mark: width * count + count }
}

const bridgeInk = (fill: Int8Array, colors: (number[] | undefined)[], width: number) => fill.map((value, i) => {
  if (value || !colors[i]) return value
  const x = i % width
  return x > 0 && x < width - 1 && fill[i - 1] && fill[i + 1] || fill[i - width] && fill[i + width] ? 1 : 0
})

/** Suggest a high/low core from coherent local surface color near a marked
 * height. Elevation comes from the mark. Image tones only locate its shape. */
function suggestStructure(image: ImagePixels, form: MapLandform, land: PointMm[], lakes: PointMm[][]): MapLandformStructure | undefined {
  const { at, radius } = form
  if (form.shape === 'hill') return undefined
  const { step, width, origin, cellAt, colors, mark } = formSamples(image, form, land, lakes)
  const [a, b, light] = colorAt(image, at)
  const eligible = colors.filter(Boolean).length
  const fill = Int8Array.from(colors, color => Number(!!color
    && Math.hypot(color[0] - a, color[1] - b, (color[2] - light) * .85) < 32))
  if (!fill[mark]) return undefined
  const closed = bridgeInk(fill, colors, width)
  const queue = [mark]
  closed[mark] = 2
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], x = cell % width
    const neighbors = [cell - width, cell + width, ...(x > 0 ? [cell - 1] : []), ...(x + 1 < width ? [cell + 1] : [])]
    for (const next of neighbors) if (closed[next] === 1) { closed[next] = 2; queue.push(next) }
  }
  // A uniform field, or a few isolated pixels, supplies no useful outline.
  if (queue.length < Math.max(14, eligible * .12) || queue.length > eligible * .91) return undefined
  const allowed = (structure: MapLandformStructure) => !landformStructureIssue(structure, at, radius, land, lakes)
  if (form.shape === 'ridge') {
    for (const centerline of fitRidge(queue.map(cellAt), at, step)) {
      const structure = { kind: 'ridge', centerline } as const
      if (allowed(structure)) return structure
    }
    return undefined
  }
  const rings = traceIndexedContours({ width, height: width }, Int16Array.from(closed, value => value === 2 ? 0 : -1)).get(0) ?? []
  const ring = rings.filter(row => signedVisualArea(row) > 0).sort((a, b) => signedVisualArea(b) - signedVisualArea(a))[0]
  if (!ring) return undefined
  for (const tolerance of [1.38, 2.1]) {
    const boundary = simplifyRing(ring, tolerance).map(p => point(origin.x + p.x * step, origin.y + p.y * step))
    if (boundary.length > MAP_STRUCTURE_POINTS || !polygonValid(boundary, true)) continue
    const structure = { kind: 'area', boundary } as const
    if (!allowed(structure)) continue
    const breakline = form.shape === 'plateau' ? visibleBreakline(boundary, image, step) : undefined
    return breakline && allowed({ ...structure, breakline }) ? { ...structure, breakline } : structure
  }
}

function suggestReferenceLandforms(image: ImagePixels, outline: ReferenceLand, forms: MapLandform[]): MapLandform[] {
  return forms.map(form => {
    if (form.structure) return form
    const carrier = outline.regions.find(row => row.id === form.areaId)
    const structure = carrier && suggestStructure(image, form, carrier.boundary, outline.lakes.filter(row => row.areaId === form.areaId).map(row => row.boundary))
    return structure ? { ...form, structure } : form
  })
}

/** Find compact exposed stone in a marked low shelf. A lighter or cooler bed
 * must surround the stone on most sides before it becomes editable relief. */
function suggestReferenceOutcrops(image: ImagePixels, outline: ReferenceLand, forms: MapLandform[], mmPerPixel: number,
  reservedIds: readonly string[] = []): MapLandform[] {
  const limit = Math.min(6, MAP_LANDSCAPE_LIMITS.landforms - forms.length)
  if (limit <= 0 || !Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return []
  const candidates = forms.filter(row => row.shape === 'lowland' && row.elevationMm <= 2200).flatMap(low => {
    const carrier = outline.regions.find(row => row.id === low.areaId)
    if (!carrier) return []
    const lakes = outline.lakes.filter(row => row.areaId === low.areaId).map(row => row.boundary)
    const { step, colors, width, origin, cellAt } = formSamples(image, low, carrier.boundary, lakes)
    const lowMarks = forms.filter(form => form.areaId === low.areaId && form.shape === 'lowland').map(form => form.at)
    const pinRadius = Math.max(step * 2.25, 850 / mmPerPixel)
    const clearsLowMarks = (at: PointMm, gap: number) => lowMarks.every(mark => Math.hypot(mark.x - at.x, mark.y - at.y) >= gap)
    const warmRock = (color: number[] | undefined) => !!color && color[0] <= -7 && color[1] <= -13 && color[2] >= 89 && color[2] <= 186
    const mask = bridgeInk(Int8Array.from(colors, (color, i) => Number(warmRock(color) && clearsLowMarks(cellAt(i), pinRadius))), colors, width)
    const rings = traceIndexedContours({ width, height: width }, Int16Array.from(mask, value => value ? 0 : -1)).get(0) ?? []
    return rings.flatMap(ring => {
      const area = signedVisualArea(ring)
      if (area < 11) return []
      const left = Math.min(...ring.map(p => p.x)), top = Math.min(...ring.map(p => p.y))
      const w = Math.max(...ring.map(p => p.x)) - left, h = Math.max(...ring.map(p => p.y)) - top, short = Math.min(w, h)
      if (short < 3 || Math.max(w, h) / short > 2.55 || area < w * h * .48
        || area * step ** 2 > low.radius.x * low.radius.y * .46) return []
      const radius = point(w * step * .55, h * step * .55)
      const middle = point(origin.x + (left + w / 2) * step, origin.y + (top + h / 2) * step)
      const boundary = simplifyRing(ring, .94).map(p => point(origin.x + p.x * step, origin.y + p.y * step))
      if (boundary.length > MAP_STRUCTURE_POINTS || forms.some(form => form.areaId === low.areaId
        && form.shape !== 'lowland' && pointInPolygon(form.at, boundary))) return []
      let at: PointMm | undefined, nearest = Infinity
      for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
        const index = y * width + x, sample = cellAt(index)
        if (!warmRock(colors[index]) || !clearsLowMarks(sample, Math.min(radius.x, radius.y) * .68)
          || !pointInPolygon(sample, boundary, false)) continue
        const distance = Math.hypot(sample.x - middle.x, sample.y - middle.y)
        if (distance < nearest) { at = sample; nearest = distance }
      }
      if (!at) return []
      const crest = at
      const structure = [1, .88, .73].map(scale => ({ kind: 'area' as const,
        boundary: boundary.map(p => point(crest.x + (p.x - crest.x) * scale, crest.y + (p.y - crest.y) * scale)),
      })).find(shape => !lowMarks.some(mark => pointInPolygon(mark, shape.boundary))
        && !landformStructureIssue(shape, crest, radius, carrier.boundary, lakes))
      if (!structure) return []
      const core = colorAt(image, crest)
      const rim = Array.from({ length: 12 }, (_, i) => {
        const angle = i * Math.PI / 6
        return point(middle.x + Math.cos(angle) * (w / 2 + 1.7) * step, middle.y + Math.sin(angle) * (h / 2 + 1.7) * step)
      })
      const contrast = rim.filter(p => {
        if (p.x < 0 || p.x >= image.width || p.y < 0 || p.y >= image.height) return false
        if (!outline.regions.some(region => pointInPolygon(p, region.boundary)) || lakes.some(lake => pointInPolygon(p, lake))) return true
        const [a, b, light] = colorAt(image, p)
        return (a >= -4 || b - core[1] > 18) && light >= core[2] + 12
      }).length
      if (contrast < 6 || short * step * mmPerPixel < 1150) return []
      return [{ area, form: { areaId: low.areaId, at: crest, radius, structure, rotationDeg: 0, shape: 'hill' as const, cover: 'rock' as const,
        elevationMm: low.elevationMm + Math.round(Math.min(3600, Math.max(520, short * step * mmPerPixel * .48))), preserveRelief: true as const } }]
    })
  })
  const selected: MapLandform[] = [], ids = new Set([...forms.map(row => row.id), ...reservedIds])
  let next = 1
  for (const { form } of candidates.sort((a, b) => b.area - a.area)) {
    if (selected.some(row => row.structure?.kind === 'area' && polygonsOverlap(row.structure.boundary, form.structure.boundary))) continue
    while (ids.has(`reference-outcrop-${next}`)) next++
    selected.push({ ...form, id: `reference-outcrop-${next++}`, name: '露岩' })
    if (selected.length === limit) break
  }
  return selected
}

type RimSample = { crest: PointMm; lower: PointMm; depth: number }

function coastalRimSamples(image: ImagePixels, boundary: PointMm[], excluded: Pick<MapLandform, 'at' | 'radius'>[]) {
  const edge = Math.max(image.width, image.height), step = Math.max(5, edge * .011)
  const runs: RimSample[][] = []
  let run: RimSample[] = []
  const flush = () => { if (run.length >= 4) runs.push(run); run = [] }
  for (const [i, a] of boundary.entries()) {
    const b = boundary[(i + 1) % boundary.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    const count = Math.ceil(length / step)
    for (let j = 0; j < count; j++) {
      const t = (j + .5) / count, x = a.x + dx * t, y = a.y + dy * t
      const atDepth = (depth: number) => point(x - dy / length * depth * edge, y + dx / length * depth * edge)
      let sample: RimSample | undefined
      if (x > 3 && x < image.width - 3 && y > 3 && y < image.height - 3) {
        for (const lowerDepth of [.010, .020, .030, .042]) {
          const lower = atDepth(lowerDepth)
          if (!pointInPolygon(lower, boundary, false)) break
          const [a, b, light] = colorAt(image, lower)
          if (light < 50 || light > 144 || b < 1 || a < -12 || a + b < 15) continue
          for (const extra of [.018, .030, .043, .058, .075]) {
            const crest = atDepth(lowerDepth + extra)
            if (!pointInPolygon(crest, boundary, false)) break
            const [, blue, top] = colorAt(image, crest)
            if (blue > -12 || top < light + 40) continue
            if (!excluded.some(({ at, radius }) => Math.hypot((at.x - crest.x) / radius.x, (at.y - crest.y) / radius.y) < .76)) {
              sample = { crest, lower, depth: (lowerDepth + extra) * edge }
            }
            break
          }
          if (sample) break
        }
      }
      if (!sample) { flush(); continue }
      const last = run.at(-1)?.crest
      if (last && Math.hypot(last.x - sample.crest.x, last.y - sample.crest.y) > step * 3.5) flush()
      run.push(sample)
    }
  }
  flush()
  return runs
}

/** A rock face followed by a brighter dry surface gives a localized crest.
 * Keep coherent cliff spans and leave the authored high and low marks alone. */
function suggestCoastalCliffs(image: ImagePixels, outline: ReferenceLand, forms: MapLandform[], mmPerPixel: number,
  starts: Pick<MapLandform, 'at' | 'radius'>[], reservedIds: readonly string[]): MapLandform[] {
  const limit = Math.min(4, MAP_LANDSCAPE_LIMITS.landforms - forms.length)
  const carrier = outline.regions[0]
  if (!carrier || limit <= 0 || !forms.length) return []
  const edge = Math.max(image.width, image.height)
  const { boundary, id: areaId } = carrier, lakes = outline.lakes.filter(row => row.areaId === areaId).map(row => row.boundary)
  const excluded = [...forms.filter(row => row.areaId === areaId), ...starts]
  const candidates = coastalRimSamples(image, boundary, excluded).flatMap(run => {
    const crests = run.map(row => row.crest)
    const centerline = simplifyOpenPolyline(crests, Math.max(2, edge * .011))
    const span = Math.hypot(centerline[0].x - centerline.at(-1)!.x, centerline[0].y - centerline.at(-1)!.y)
    if (centerline.length > MAP_STRUCTURE_POINTS || span < edge * .052) return []
    const depth = run.map(row => row.depth).sort((a, b) => a - b)[Math.floor(run.length / 2)]
    const size = Math.round(Math.max(5, Math.min(edge * .056, depth * .69)))
    const radius = point(size, size)
    const at = centerline.length === 2 ? point((centerline[0].x + centerline[1].x) / 2, (centerline[0].y + centerline[1].y) / 2)
      : centerline[Math.floor(centerline.length / 2)]
    const ridge = { kind: 'ridge', centerline } as const
    if (landformStructureIssue(ridge, at, radius, boundary, lakes)) return []
    const breakline = simplifyOpenPolyline(run.map(row => row.lower), Math.max(2, edge * .006))
    const structure = breakline.length <= MAP_STRUCTURE_POINTS
      && !landformStructureIssue({ ...ridge, breakline }, at, radius, boundary, lakes) ? { ...ridge, breakline } : ridge
    const elevationMm = Math.round(Math.min(4200, Math.max(1450, depth * mmPerPixel * .49)))
    return [{ span, form: { areaId, at, radius, structure, rotationDeg: 0, shape: 'ridge' as const, elevationMm } }]
  })
  const selected: typeof candidates = [], ids = new Set([...forms.map(row => row.id), ...reservedIds])
  for (const row of candidates.sort((a, b) => b.span - a.span)) {
    const { form } = row
    if (selected.some(other => form.structure.centerline.some(p => other.form.structure.centerline.slice(1).some((end, i) =>
      distanceToSegment(p, other.form.structure.centerline[i], end) < edge * .064)))) continue
    selected.push(row)
    if (selected.length === limit) break
  }
  let next = 1
  return selected.map(({ form }) => {
    while (ids.has(`reference-cliff-${next}`)) next++
    return { ...form, id: `reference-cliff-${next++}`, name: '海岸崖脊' }
  })
}

export function fitReferenceLandforms(image: ImagePixels, outline: ReferenceLand, forms: MapLandform[],
  coast?: { mmPerPixel: number; starts?: Pick<MapLandform, 'at' | 'radius'>[]; reservedIds?: string[] }) {
  const marked = suggestReferenceLandforms(image, outline, forms)
  if (!coast || !Number.isFinite(coast.mmPerPixel) || coast.mmPerPixel <= 0) return { marked, outcrops: [], cliffs: [] }
  const outcrops = suggestReferenceOutcrops(image, outline, marked, coast.mmPerPixel, coast.reservedIds)
  const cliffs = suggestCoastalCliffs(image, outline, [...marked, ...outcrops], coast.mmPerPixel, coast.starts ?? [], coast.reservedIds ?? [])
  return { marked, outcrops, cliffs }
}
