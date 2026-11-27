import { polygonInside, polygonValid } from '../geometry/geometry.js'
import { simplifyRing, traceIndexedContours } from '../image-import/vector.js'
import type { PointMm } from '../model/scene.js'
import { signedVisualArea } from '../visual/geometry.js'
import { MAP_LANDSCAPE_LIMITS, MAP_SHALLOW_POINTS, type MapShallowZone } from './map-authoring.js'

type Color = readonly number[]
type Pixel = (x: number, y: number) => Color
const colorDistance = (a: Color, b: Color) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] - b[2]) * .70)
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]

export function referenceWaterColors(background: Color[]) {
  const samples = background.filter(([a, b]) => a >= 18 && b >= -a * .34)
  if (!samples.length || samples.length < Math.ceil(background.length * .65)) return undefined
  const green = median(samples.map(row => row[0])), blue = median(samples.map(row => row[1]))
  const light = median(samples.map(row => row[2]))
  return {
    // Dark water retains more of the sampled water's chroma than blue-grey
    // cliff faces. Similar foreground samples are applied only near the mark.
    shadow: ([a, b, l]: Color) => a >= Math.max(18, green * (l >= light * .76 ? .50 : .77))
      && b >= Math.min(-5, blue - 14) && b <= blue + Math.max(28, a * .48),
    sharedHue: ([a, b]: Color) => a >= 8 && b >= -Math.max(9, a * .38),
    shallow: ([a, b]: Color) => a >= Math.max(22, green * .48)
      && b >= -a * .43 && b <= Math.min(-2, blue - 8),
    paleShallow: ([a, b, l]: Color) => a >= Math.max(10, green * .12)
      && b >= -Math.max(22, a * .51) && b <= -5 && l >= light * .80,
  }
}

/** Propagate from the supplied seeds through a four-connected candidate
 * mask. A zero distance identifies the seed itself. */
function flood(mask: Uint8Array, width: number, seeds: Iterable<number>, maxDistance = 65534) {
  const distance = new Uint16Array(mask.length).fill(65535), queue = new Int32Array(mask.length)
  let end = 0
  const add = (index: number, step: number) => {
    if (mask[index] && distance[index] === 65535) { distance[index] = step; queue[end++] = index }
  }
  for (const seed of seeds) add(seed, 0)
  for (let start = 0; start < end; start++) {
    const index = queue[start], x = index % width, step = distance[index] + 1
    if (step > maxDistance) continue
    if (x) add(index - 1, step)
    if (x < width - 1) add(index + 1, step)
    add(index - width, step); add(index + width, step)
  }
  return distance
}

export function openReferenceWater(candidate: Uint8Array, width: number) {
  const last = candidate.length - width, seeds: number[] = []
  for (let x = 0; x < width; x++) seeds.push(x, last + x)
  for (let i = width; i < last; i += width) seeds.push(i, i + width - 1)
  return Uint8Array.from(flood(candidate, width, seeds), distance => Number(distance !== 65535))
}

/** A pale tidal shelf can match dry sand locally. Follow that color only
 * a short distance from connected shallow water and keep warmer rock dry. */
export function extendReferenceShallows(open: Uint8Array, nearshore: Uint8Array, width: number) {
  const seeds: number[] = []
  const traversable = open.map((value, i) => {
    if (value && nearshore[i] === 2) seeds.push(i)
    return Number(!!value || !!nearshore[i])
  })
  if (!seeds.length) return open
  const reach = Math.round(Math.max(width, open.length / width) * .068)
  const reached = flood(traversable, width, seeds, reach)
  return open.map((value, i) => Number(!!value || reached[i] !== 65535))
}

export function referenceShallowIssue(boundary: PointMm[], source: { width: number; height: number }, regions: { boundary: PointMm[] }[]) {
  if (boundary.some(p => p.x < 0 || p.x > source.width || p.y < 0 || p.y > source.height) || !polygonValid(boundary, false)
    || regions.some(region => polygonInside(boundary, region.boundary))) return '浅水范围须是原图内的有效轮廓，并覆盖一部分外海。'
}

export function inferReferenceShallows(source: { width: number; height: number }, water: Uint8Array, waterWidth: number,
  background: Color[], marked: readonly PointMm[], pixel: Pixel, sample: (p: PointMm) => Color): MapShallowZone[] {
  const color = referenceWaterColors(background)
  if (!color && !marked.length) return []
  const ratio = Math.min(1, 220 / Math.max(source.width, source.height))
  const width = Math.max(3, Math.round(source.width * ratio)), height = Math.max(3, Math.round(source.height * ratio))
  const sx = source.width / width, sy = source.height / height, waterHeight = water.length / waterWidth
  const open = new Uint8Array(width * height)
  const dry: number[] = []
  const samples = marked.map(at => ({ at, color: sample(at) }))
  const markCell = marked.map(p => Math.floor(p.x / sx) + Math.floor(p.y / sy) * width)
  const colors: Color[] = []
  for (let i = 0; i < open.length; i++) {
    const x = i % width, y = Math.floor(i / width)
    open[i] = water[Math.floor((y + .5) * waterHeight / height) * waterWidth + Math.floor((x + .5) * waterWidth / width)]
    if (!open[i]) dry.push(i)
    colors.push(pixel((x + .5) * sx, (y + .5) * sy))
  }
  if (!dry.length) return []
  const distance = flood(new Uint8Array(open.length).fill(1), width, dry, Math.max(6, Math.round(Math.max(width, height) * .154)))
  const shallows = open.map((value, i) => {
    if (!value || distance[i] === 65535) return 0
    const p = { x: (i % width + .5) * sx, y: (Math.floor(i / width) + .5) * sy }
    return Number(color?.shallow(colors[i]) || color?.paleShallow(colors[i]) || samples.some(row => Math.hypot(row.at.x - p.x, row.at.y - p.y) <= Math.max(source.width, source.height) * .13
      && colorDistance(row.color, colors[i]) < 25))
  })
  for (const seed of markCell) if (open[seed]) shallows[seed] = 1
  // Small interruptions in water color are often ink and grid strokes.
  const filled = shallows.map((value, i) => {
    if (value || !open[i]) return value
    const x = i % width, first = x > 0 && x < width - 1 && shallows[i - 1] && shallows[i + 1]
    return Number(first || shallows[i - width] && shallows[i + width] || false)
  })
  const rings = (traceIndexedContours({ width, height }, Int16Array.from(filled, value => value ? 0 : -1)).get(0) ?? [])
    .map(ring => ({ ring, area: signedVisualArea(ring) }))
    .filter(row => row.area >= Math.max(8, width * height * .00040) && row.area < width * height * .18)
    .sort((a, b) => b.area - a.area)
  return rings.flatMap(({ ring }) => {
    for (const error of [1.0, 1.7, 2.6]) {
      const boundary = simplifyRing(ring, error).map(({ x, y }) => ({ x: Math.round(x * sx), y: Math.round(y * sy) }))
      if (boundary.length <= MAP_SHALLOW_POINTS && polygonValid(boundary, true)) return [boundary]
    }
    return []
  }).slice(0, MAP_LANDSCAPE_LIMITS.shallows).map((boundary, i) => ({ id: `reference-shallows-${i + 1}`, boundary }))
}
