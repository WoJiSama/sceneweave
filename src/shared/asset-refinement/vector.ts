import { z } from 'zod'
import { normalizeStaticSvg } from '../ai/svg.js'
import { imageVectorOptionsSchema, vectorizeImageLayer } from '../image-import/vector.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { captureJson } from '../validation/json.js'

export const vectorRefinementOptionsSchema = z.strictObject({
  colors: z.number().int().min(8).max(48).default(24),
  // Two nonincident source-grid edges are at least one pixel apart. Staying
  // strictly below half a pixel prevents their fitted curves crossing.
  curveTolerancePx: z.number().min(0).max(0.49).default(0.45),
})
export type VectorRefinementOptions = z.infer<typeof vectorRefinementOptionsSchema>

interface Point { x: number; y: number }
interface Ring { points: Point[]; edges: DirectedEdge[] }
interface Edge { a: number; b: number; rings: number[]; chain: number; ordinal: number }
interface DirectedEdge { edge: Edge; from: number; to: number }
interface Segment { from: Point; to: Point; control?: Point }
interface Chain { vertices: number[]; edges: Edge[]; segments: Segment[] }
export interface VectorRefinementResult {
  sourceSvg: string
  stats: {
    pathCount: number; pathCommandCount: number; sourcePathCommandCount: number
    width: number; height: number; paletteColors: number; visiblePixels: number
    ringCount: number; boundaryEdgeCount: number; chainCount: number; sharedChainCount: number
    quadraticCurveCount: number; lineCount: number; protectedCornerCount: number; protectedRingCount: number
    maxCurveDeviationPx: number; sourceBytes: number
    tonalRegionCount?: number; mergedRegionCount?: number; gradientCount?: number; maxGradientChannelError?: number
  }
}

const MAX_UNIT_EDGES = 200_000
const MAX_FIT_EDGES = 32
const round = (value: number) => Math.round(value * 1000) / 1000
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const number = (value: number) => String(Object.is(value, -0) ? 0 : value)
const coordinates = (point: Point) => `${number(point.x)} ${number(point.y)}`
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const quadratic = (a: Point, c: Point, b: Point, t: number): Point => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
})

/** Only consumes the owned M/L/Z output of the existing exact-grid tracer. */
function readRings(d: string): Ring[] {
  const tokens = d.trim().split(/\s+/), rings: Ring[] = []
  let points: Point[] | undefined
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++]
    if (command === 'Z') {
      if (!points || points.length < 3) throw new Error('矢量初稿包含无效闭环。')
      rings.push({ points, edges: [] }); points = undefined; continue
    }
    if (command !== 'M' && command !== 'L') throw new Error('矢量初稿不是确切的源网格路径。')
    const point = { x: Number(tokens[index++]), y: Number(tokens[index++]) }
    if (![point.x, point.y].every(Number.isSafeInteger)) throw new Error('矢量初稿包含非整数源网格点。')
    if (command === 'M') {
      if (points) throw new Error('矢量初稿含未闭合路径。')
      points = [point]
    } else {
      if (!points) throw new Error('矢量初稿缺少起点。')
      points.push(point)
    }
  }
  if (points) throw new Error('矢量初稿含未闭合路径。')
  return rings
}

function smallFeature(ring: Ring): boolean {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, twiceArea = 0
  for (let index = 0; index < ring.points.length; index++) {
    const point = ring.points[index], next = ring.points[(index + 1) % ring.points.length]
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
    twiceArea += point.x * next.y - next.x * point.y
  }
  // Do not reinterpret one/two-pixel keys, gaps, tips or tiny detached details.
  return Math.min(right - left, bottom - top) <= 2 || Math.abs(twiceArea) <= 8
}

/**
 * Bounds the *entire* fitted curve against the matching source polyline, not
 * just vertices or a raster sample. For each unit source edge, the difference
 * is a quadratic Bezier. Its three control vectors bound its norm by convexity.
 * The correspondence is continuous in both directions, so this is also a
 * conservative two-way Hausdorff bound. Rounded output controls are checked.
 */
function curveBound(points: readonly Point[], control: Point): { error: number; split: number } {
  const a = points[0], b = points.at(-1)!, count = points.length - 1
  let error = 0, split = 1
  for (let index = 0; index < count; index++) {
    const t = index / count, u = (index + 1) / count
    const start = quadratic(a, control, b, t), end = quadratic(a, control, b, u)
    const tangent = { x: 2 * ((1 - t) * (control.x - a.x) + t * (b.x - control.x)),
      y: 2 * ((1 - t) * (control.y - a.y) + t * (b.y - control.y)) }
    const middle = { x: start.x + tangent.x / count / 2, y: start.y + tangent.y / count / 2 }
    const value = Math.max(distance(start, points[index]), distance(end, points[index + 1]),
      distance(middle, lerp(points[index], points[index + 1], .5)))
    if (value > error) { error = value; split = Math.max(1, Math.min(count - 1, index + 1)) }
  }
  return { error, split }
}

function fit(points: Point[], tolerance: number, signal: CancellationSignal | undefined,
  observe: (error: number) => void): Segment[] {
  checkCancelled(signal)
  const a = points[0], b = points.at(-1)!, count = points.length - 1
  if (count === 1) return [{ from: a, to: b }]
  let lineError = 0
  for (let index = 1; index < count; index++) lineError = Math.max(lineError, distance(points[index], lerp(a, b, index / count)))
  if (lineError <= tolerance) { observe(lineError); return [{ from: a, to: b }] }
  if (!tolerance) return points.slice(1).map((point, index) => ({ from: points[index], to: point }))
  let denominator = 0, x = 0, y = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (let index = 0; index <= count; index++) {
    const point = points[index], t = index / count, weight = 2 * t * (1 - t)
    denominator += weight * weight
    x += weight * (point.x - (1 - t) ** 2 * a.x - t * t * b.x)
    y += weight * (point.y - (1 - t) ** 2 * a.y - t * t * b.y)
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
  }
  // Bounded least-squares control: no handle may overshoot the observed box.
  const control = { x: round(Math.max(left, Math.min(right, x / denominator))),
    y: round(Math.max(top, Math.min(bottom, y / denominator))) }
  const bound = curveBound(points, control)
  const start = points[1], previous = points.at(-2)!
  const startDot = (control.x - a.x) * (start.x - a.x) + (control.y - a.y) * (start.y - a.y)
  const endDot = (b.x - control.x) * (b.x - previous.x) + (b.y - control.y) * (b.y - previous.y)
  if (bound.error <= tolerance && startDot >= 0 && endDot >= 0 && distance(a, b) > 0) {
    observe(bound.error); return [{ from: a, to: b, control }]
  }
  // Splitting exactly at every raster stair corner merely recreates the
  // original M/L trace. Prefer an adjacent straight sample, leaving that turn
  // inside one bounded quadratic. True supported corners were pinned earlier.
  const turns = (index: number) => (points[index].x - points[index - 1].x) * (points[index + 1].y - points[index].y)
    !== (points[index].y - points[index - 1].y) * (points[index + 1].x - points[index].x)
  const preferred = [bound.split - 1, bound.split + 1].find(index => index > 0 && index < count && !turns(index))
  const split = preferred ?? (bound.split > 0 && bound.split < count ? bound.split : Math.floor(count / 2))
  return [...fit(points.slice(0, split + 1), tolerance, signal, observe), ...fit(points.slice(split), tolerance, signal, observe)]
}

/**
 * Rebuilds shared boundaries rather than independently smoothing colour rings.
 * The existing tracer supplies palette, alpha grouping, holes and exact-grid
 * topology only (no pre-smoothing or simplification). Each maximal shared chain
 * is fitted once; every incident ring uses the identical curve, reversed when
 * necessary. Junctions, supported right-angle corners and thin rings stay put.
 * No object recognition or evidence-free reconstruction of keys/details occurs.
 */
export function refineImageToVector(pixels: ImagePixels, input: VectorRefinementOptions, signal?: CancellationSignal): VectorRefinementResult {
  checkCancelled(signal)
  const options = vectorRefinementOptionsSchema.parse(captureJson(input))
  if (!pixels || !Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height)
    || pixels.width < 1 || pixels.height < 1 || pixels.width > 8192 || pixels.height > 8192
    || pixels.width * pixels.height > 1_000_000 || !(pixels.data instanceof Uint8ClampedArray)
    || pixels.data.length !== pixels.width * pixels.height * 4) throw new Error('矢量结构重建需要完整RGBA，最多100万像素且边长不超过8192。')
  const image = { width: pixels.width, height: pixels.height, data: pixels.data.slice() }
  const draft = vectorizeImageLayer(image, imageVectorOptionsSchema.parse({ kind: 'trace', colors: options.colors, simplifyPx: 0, smoothingRadius: 0 }))
  return fitVectorDraft(image, draft, options, signal)
}

/** Geometry-only stage. Legacy paint selection and new tonal paints keep separate identities. */
export function fitVectorDraft(image: ImagePixels, draft: { sourceSvg: string; stats: { pathCount: number; pathCommandCount: number; paletteColors: number; visiblePixels: number } },
  options: VectorRefinementOptions, signal?: CancellationSignal): VectorRefinementResult {
  checkCancelled(signal)
  const paths: Ring[][] = []
  draft.sourceSvg.replace(/<path\b[^>]*\bd="([^"]*)"[^>]*>/g, (_tag, d: string) => { paths.push(readRings(d)); return '' })
  if (paths.length !== draft.stats.pathCount) throw new Error('矢量初稿路径数量不符。')
  const rings = paths.flat(), stride = image.width + 1
  const vertex = (point: Point) => point.y * stride + point.x
  const point = (id: number): Point => ({ x: id % stride, y: Math.floor(id / stride) })
  const edgeMap = new Map<string, Edge>(), adjacency = new Map<number, Edge[]>(), protectedVertices = new Set<number>()
  let protectedRingCount = 0, unitUses = 0
  const addAdjacency = (id: number, edge: Edge) => { const list = adjacency.get(id); if (list) list.push(edge); else adjacency.set(id, [edge]) }
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    checkCancelled(signal)
    const ring = rings[ringIndex], protect = smallFeature(ring)
    if (protect) protectedRingCount++
    for (let index = 0; index < ring.points.length; index++) {
      const from = ring.points[index], to = ring.points[(index + 1) % ring.points.length]
      if (from.x !== to.x && from.y !== to.y) throw new Error('矢量初稿不在确切源网格上。')
      const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
      if (!length) throw new Error('矢量初稿含退化网格边。')
      const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y)
      for (let step = 0; step < length; step++) {
        if (++unitUses > MAX_UNIT_EDGES * 3) throw new Error('矢量结构边界展开超过保护预算，未丢弃细节。')
        if (!(unitUses % 1024)) checkCancelled(signal)
        const start = vertex({ x: from.x + step * dx, y: from.y + step * dy }), end = start + dx + dy * stride
        const a = Math.min(start, end), b = Math.max(start, end), key = `${a}:${b}`
        let edge = edgeMap.get(key)
        if (!edge) {
          if (edgeMap.size >= MAX_UNIT_EDGES) throw new Error('矢量结构边界超过20万条源网格边，未丢弃细节。')
          edge = { a, b, rings: [], chain: -1, ordinal: -1 }; edgeMap.set(key, edge)
          addAdjacency(a, edge); addAdjacency(b, edge)
        }
        if (edge.rings.at(-1) === ringIndex) throw new Error('矢量初稿环重复经过同一条边。')
        edge.rings.push(ringIndex); ring.edges.push({ edge, from: start, to: end })
        if (protect) { protectedVertices.add(start); protectedVertices.add(end) }
      }
    }
  }
  const other = (edge: Edge, id: number) => edge.a === id ? edge.b : edge.a
  const sameMembership = (a: Edge, b: Edge) => a.rings.length === b.rings.length && a.rings.every((value, index) => value === b.rings[index])
  const stops = new Set<number>(), cornerVertices = new Set<number>()
  const straightSupport = (id: number, first: Edge): number => {
    const origin = point(id), secondId = other(first, id), second = point(secondId)
    const dx = second.x - origin.x, dy = second.y - origin.y
    let count = 1, at = secondId, previous = first
    // Two-pixel runs commonly come from a 2× source, so they do not alone
    // establish a genuine corner. Require four observed pixels on both arms.
    while (count < 4) {
      const incident = adjacency.get(at)!
      if (incident.length !== 2) break
      const next = incident[0] === previous ? incident[1] : incident[0]
      if (!sameMembership(first, next)) break
      const destination = other(next, at), p = point(destination), current = point(at)
      if (p.x - current.x !== dx || p.y - current.y !== dy) break
      count++; previous = next; at = destination
    }
    return count
  }
  for (const [id, incident] of adjacency) {
    if (incident.length !== 2 || !sameMembership(incident[0], incident[1]) || protectedVertices.has(id)) { stops.add(id); continue }
    const a = point(other(incident[0], id)), b = point(other(incident[1], id)), at = point(id)
    if ((a.x - at.x) * (b.x - at.x) + (a.y - at.y) * (b.y - at.y) === 0
      && straightSupport(id, incident[0]) >= 4 && straightSupport(id, incident[1]) >= 4) {
      stops.add(id); cornerVertices.add(id)
    }
  }
  const chains: Chain[] = []
  const buildChain = (start: number, first: Edge) => {
    const chain: Chain = { vertices: [start], edges: [], segments: [] }, chainId = chains.length
    chains.push(chain)
    let at = start, edge = first
    while (edge.chain < 0) {
      edge.chain = chainId; edge.ordinal = chain.edges.length; chain.edges.push(edge)
      at = other(edge, at); chain.vertices.push(at)
      if (stops.has(at) || at === start) break
      const incident = adjacency.get(at)!
      edge = incident[0] === edge ? incident[1] : incident[0]
    }
  }
  for (const id of stops) for (const edge of adjacency.get(id)!) if (edge.chain < 0) buildChain(id, edge)
  for (const edge of edgeMap.values()) if (edge.chain < 0) buildChain(edge.a, edge)
  let maxCurveDeviationPx = 0
  for (const chain of chains) {
    checkCancelled(signal)
    // Chunks bound fitting work. They are shared by every incident ring too.
    for (let index = 0; index < chain.vertices.length - 1; index += MAX_FIT_EDGES) {
      const points = chain.vertices.slice(index, index + MAX_FIT_EDGES + 1).map(point)
      chain.segments.push(...fit(points, options.curveTolerancePx, signal, error => { maxCurveDeviationPx = Math.max(maxCurveDeviationPx, error) }))
    }
  }
  let quadraticCurveCount = 0, lineCount = 0
  const serializeRing = (ring: Ring): string => {
    // Move the ring start to a whole-chain boundary, without altering winding.
    let start = ring.edges.findIndex((value, index) => value.edge.chain !== ring.edges[(index + ring.edges.length - 1) % ring.edges.length].edge.chain)
    if (start < 0) start = ring.edges.findIndex(value => value.edge.ordinal === 0 && value.from === chains[value.edge.chain].vertices[0]
      || value.edge.ordinal === chains[value.edge.chain].edges.length - 1 && value.from === chains[value.edge.chain].vertices.at(-1))
    if (start < 0) throw new Error('矢量共享边界无法定位闭环起点。')
    const ordered = [...ring.edges.slice(start), ...ring.edges.slice(0, start)]
    const rebuilt: Segment[] = []
    let index = 0
    while (index < ordered.length) {
      const current = ordered[index], chain = chains[current.edge.chain], forward = current.edge.ordinal === 0 && current.from === chain.vertices[0]
      const segments = forward ? chain.segments : chain.segments.slice().reverse()
      for (const segment of segments) {
        const value = forward ? segment : { from: segment.to, to: segment.from, control: segment.control }
        const previous = rebuilt.at(-1)
        // Protected pixel-edge chains can still share one *exact* straight
        // command; retaining thin details must not inflate long straight runs.
        if (previous && !previous.control && !value.control
          && (previous.to.x - previous.from.x) * (value.to.y - value.from.y) === (previous.to.y - previous.from.y) * (value.to.x - value.from.x)
          && (previous.to.x - previous.from.x) * (value.to.x - value.from.x) + (previous.to.y - previous.from.y) * (value.to.y - value.from.y) > 0) previous.to = value.to
        else rebuilt.push({ ...value })
      }
      let consumed = 0
      while (index < ordered.length && ordered[index].edge.chain === current.edge.chain) { index++; consumed++ }
      if (consumed !== chain.edges.length) throw new Error('矢量闭环未完整复用共享边界。')
    }
    const startPoint = point(ordered[0].from)
    let d = `M${coordinates(startPoint)}`
    for (let index = 0; index < rebuilt.length; index++) {
      const segment = rebuilt[index]
      if (segment.control) { d += `Q${coordinates(segment.control)} ${coordinates(segment.to)}`; quadraticCurveCount++ }
      else if (index !== rebuilt.length - 1 || distance(segment.to, startPoint) > 0) { d += `L${coordinates(segment.to)}`; lineCount++ }
    }
    return `${d}Z`
  }
  let pathIndex = 0
  const source = draft.sourceSvg.replace(/(<path\b[^>]*\bd=")[^"]*("[^>]*>)/g,
    (_tag, before: string, after: string) => `${before}${paths[pathIndex++].map(serializeRing).join('')}${after}`)
  checkCancelled(signal)
  const normalized = normalizeStaticSvg(source)
  if (normalized.pathCount !== draft.stats.pathCount) throw new Error('矢量重建丢失源色块路径。')
  return { sourceSvg: normalized.normalizedSource, stats: {
    pathCount: normalized.pathCount, pathCommandCount: normalized.pathCommandCount,
    sourcePathCommandCount: draft.stats.pathCommandCount,
    width: image.width, height: image.height, paletteColors: draft.stats.paletteColors, visiblePixels: draft.stats.visiblePixels,
    ringCount: rings.length, boundaryEdgeCount: edgeMap.size, chainCount: chains.length,
    sharedChainCount: chains.filter(chain => chain.edges[0].rings.length > 1).length,
    quadraticCurveCount, lineCount, protectedCornerCount: cornerVertices.size, protectedRingCount,
    maxCurveDeviationPx, sourceBytes: normalized.normalizedSizeBytes,
  } }
}
