import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import { lightSourceBounds, type ProjectedLightShape } from '../../../shared/visual/light-geometry.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'
import { intersectsVisualBounds, lightVisibilityPolygon, polygonSegments, windowVisibilityPolygon, type VisualSegment } from './visual-geometry'

export interface ShapedLightPaint {
  shape: ProjectedLightShape
  positionMm: PointMm
  radiusMm: number
  color: string
  intensity: number
}

const areaRings = (shape: Extract<ProjectedLightShape, { kind: 'area' }>) => shape.regions.flatMap(region => [region.outerMm, ...region.holesMm])
const DISTRIBUTED_LIGHT_BANDS = 48
export const distributedLightBlurMm = (radiusMm: number) => radiusMm * .73 / DISTRIBUTED_LIGHT_BANDS
const colorAt = (color: string, alpha: number) => `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
const addContour = (path: Path2D, points: readonly PointMm[], closed: boolean) => {
  points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y))
  if (closed) path.closePath()
}
const contour = (points: readonly PointMm[]) => { const path = new Path2D(); addContour(path, points, true); return path }
const paintBounds = (ctx: CanvasRenderingContext2D, b: BoundsMm) => ctx.fillRect(b.x, b.y, b.width, b.height)

export function shapedLightBounds({ shape, positionMm, radiusMm }: ShapedLightPaint): BoundsMm {
  if (shape.kind === 'window') return lightSourceBounds(shape.beam, 0)
  const points = shape.kind === 'area' ? shape.regions.flatMap(region => region.outerMm) : shape.kind === 'line' ? shape.runs.flat() : [positionMm]
  return lightSourceBounds(points, radiusMm)
}

export function withoutEmitterBlockers(blockers: readonly VisualSegment[], points: readonly PointMm[]): VisualSegment[] {
  const emitter = points.length === 2 ? [{ start: points[0], end: points[1] }] : polygonSegments(points)
  const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
  const details = [...blockers]
  // Remove one occurrence per edge. An overlapping wall retains its authority.
  for (const edge of emitter) {
    const index = details.findLastIndex(other => same(edge.start, other.start) && same(edge.end, other.end)
      || same(edge.start, other.end) && same(edge.end, other.start))
    if (index >= 0) details.splice(index, 1)
  }
  return details
}

function paintSpot(ctx: CanvasRenderingContext2D, light: ShapedLightPaint, shape: Extract<ProjectedLightShape, { kind: 'spot' }>,
  b: BoundsMm, blockers: readonly VisualSegment[]) {
  const p = light.positionMm, r = light.radiusMm, start = (shape.directionDeg - shape.apertureDeg / 2) * Math.PI / 180, sweep = shape.apertureDeg * Math.PI / 180
  if (blockers.length) ctx.clip(contour(lightVisibilityPolygon(p, r, blockers)))
  if (shape.softness === 0) {
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, r, start, start + sweep); ctx.closePath(); ctx.clip()
  }
  const depth = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r), peak = Math.min(1, light.intensity * .9)
  depth.addColorStop(0, colorAt(light.color, peak))
  depth.addColorStop(.25, colorAt(light.color, peak * .76))
  depth.addColorStop(.68, colorAt(light.color, peak * .32))
  depth.addColorStop(1, colorAt(light.color, 0))
  ctx.fillStyle = depth; paintBounds(ctx, b)
  if (shape.softness > 0) {
    const angle = ctx.createConicGradient(start, p.x, p.y), span = shape.apertureDeg / 360, feather = span * shape.softness * .48
    angle.addColorStop(0, '#0000'); angle.addColorStop(feather, '#000')
    angle.addColorStop(span - feather, '#000'); angle.addColorStop(span, '#0000'); angle.addColorStop(1, '#0000')
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = angle; paintBounds(ctx, b)
  }
}

function paintWindow(ctx: CanvasRenderingContext2D, light: ShapedLightPaint, shape: Extract<ProjectedLightShape, { kind: 'window' }>,
  b: BoundsMm, blockers: readonly VisualSegment[]) {
  const [a, edge, farEdge, farA] = shape.beam
  const width = Math.hypot(edge.x - a.x, edge.y - a.y)
  const nx = (a.y - edge.y) / width, ny = (edge.x - a.x) / width
  const depth = (farA.x - a.x) * nx + (farA.y - a.y) * ny
  const gradient = ctx.createLinearGradient(a.x, a.y, a.x + nx * depth, a.y + ny * depth), peak = Math.min(1, light.intensity * .88)
  const entry = Math.min(.002, .5 / Math.abs(depth))
  gradient.addColorStop(0, colorAt(light.color, 0))
  gradient.addColorStop(entry, colorAt(light.color, peak))
  gradient.addColorStop(.34, colorAt(light.color, peak * .80))
  gradient.addColorStop(.74, colorAt(light.color, peak * .32))
  gradient.addColorStop(1, colorAt(light.color, 0))
  ctx.clip(contour(shape.receiver))
  if (blockers.length) ctx.clip(contour(windowVisibilityPolygon(shape.beam, blockers)))
  const feather = Math.min(width * .40, Math.abs(depth) * .22) * shape.softness
  ctx.fillStyle = gradient
  if (feather <= 0) { ctx.fill(contour(shape.beam)); return }
  paintBounds(ctx, b)
  ctx.globalCompositeOperation = 'destination-in'
  const center = shape.beam.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), { x: 0, y: 0 })
  for (const [start, end] of [[a, farA], [edge, farEdge]]) {
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    const sign = (center.x - start.x) * -dy + (center.y - start.y) * dx > 0 ? 1 : -1
    const fade = ctx.createLinearGradient(start.x, start.y, start.x - dy * feather * sign / length, start.y + dx * feather * sign / length)
    fade.addColorStop(0, '#0000'); fade.addColorStop(.5, '#0008'); fade.addColorStop(1, '#000')
    ctx.fillStyle = fade; paintBounds(ctx, b)
  }
}

/** A source segment lights the strip along its length. Its vertices light the
 * rounded joins and ends. All visibility contours are unioned before painting. */
function clipDistributedLight(ctx: CanvasRenderingContext2D, sources: readonly PointMm[][], closed: boolean, radius: number, blockers: readonly VisualSegment[]) {
  const visibility = new Path2D(), bounds = blockers.map(segment => lightSourceBounds([segment.start, segment.end], 0))
  let work = 0
  const localBlockers = (points: PointMm[], radial: boolean) => {
    const range = lightSourceBounds(points, radius)
    const local = blockers.filter((_, i) => intersectsVisualBounds(range, bounds[i]))
    work += (radial ? 128 + 6 * local.length : 194 + 12 * local.length) * local.length
    if (work > 4_000_000) throw new Error('线光或面光超出局部遮挡预算，请缩短发光范围。')
    return local
  }
  const add = (ring: PointMm[]) => addContour(visibility, signedVisualArea(ring) < 0 ? ring.reverse() : ring, true)
  for (const points of sources) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      add(lightVisibilityPolygon(a, radius, localBlockers([a], true)))
      if (!closed && i === points.length - 1) continue
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (!length) continue
      const local = localBlockers([a, b], false)
      for (const side of [-1, 1]) {
        const x = (a.y - b.y) * radius * side / length, y = (b.x - a.x) * radius * side / length
        const strip = [a, b, { x: b.x + x, y: b.y + y }, { x: a.x + x, y: a.y + y }]
        add(local.length ? windowVisibilityPolygon(strip, local) : strip)
      }
    }
  }
  ctx.clip(visibility)
}

function paintDistributed(ctx: CanvasRenderingContext2D, light: ShapedLightPaint, shape: Extract<ProjectedLightShape, { kind: 'line' | 'area' }>,
  b: BoundsMm, blockers: readonly VisualSegment[]) {
  const area = shape.kind === 'area', sources = area ? areaRings(shape) : shape.runs
  const path = new Path2D()
  for (const points of sources) addContour(path, points, area)
  if (light.intensity) {
    ctx.save()
    if (area) {
      const outside = new Path2D(path)
      outside.rect(b.x, b.y, b.width, b.height)
      ctx.clip(outside, 'evenodd')
    }
    if (blockers.length) clipDistributedLight(ctx, sources, area, light.radiusMm, blockers)
    ctx.strokeStyle = light.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const peak = Math.min(.97, light.intensity * .84), bands = DISTRIBUTED_LIGHT_BANDS
    let previous = 0
    // One stroke per distance band keeps the strength at joints and overlapping
    // edge segments. A single blur blends the bands inside the visibility clip.
    for (let step = bands; step >= 1; step--) {
      const opacity = peak * (1 - (step - .5) / bands) ** (.65 + shape.softness * 2.5)
      ctx.lineWidth = light.radiusMm * 2 * step / bands
      ctx.globalAlpha = (opacity - previous) / (1 - previous)
      ctx.stroke(path)
      previous = opacity
    }
    const transform = ctx.getTransform()
    const blurPx = distributedLightBlurMm(light.radiusMm) * Math.max(transform.a, transform.d)
    if (blurPx >= .65 && typeof ctx.filter === 'string') {
      ctx.resetTransform()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'copy'
      ctx.filter = `blur(${blurPx}px)`
      ctx.drawImage(ctx.canvas, 0, 0)
    }
    ctx.restore()
  }
  if (area && shape.surfaceIntensity > 0) {
    ctx.fillStyle = colorAt(light.color, Math.min(1, shape.surfaceIntensity * .64))
    ctx.fill(path, 'evenodd')
  }
}

/** Paint one resolved light into a transparent, world-aligned local buffer. */
export function paintShapedLight(ctx: CanvasRenderingContext2D, light: ShapedLightPaint, bounds: BoundsMm, blockers: readonly VisualSegment[]) {
  ctx.save()
  try {
    const { shape } = light
    if (shape.kind === 'spot') paintSpot(ctx, light, shape, bounds, blockers)
    else if (shape.kind === 'window') paintWindow(ctx, light, shape, bounds, blockers)
    else paintDistributed(ctx, light, shape, bounds, blockers)
  } finally { ctx.restore() }
}
