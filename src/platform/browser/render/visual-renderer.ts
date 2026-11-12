import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import type { ProjectedVisualBoundary, ProjectedVisualFilter, Projection } from '../../../shared/projection/types.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { bandRings, intersectsVisualBounds, lightVisibilityPolygon, offsetPolyline, polygonSegments, visualRandom } from './visual-geometry'
import type { VisualSegment } from './visual-geometry'
import { visualSampleAtDistance } from '../../../shared/visual/geometry.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { cliffRelief } from './cliff-relief.js'
import { cliffReliefV2 } from './cliff-relief-v2.js'
import { cliffReliefV3 } from './cliff-relief-v3.js'
import { cliffReliefV4 } from './cliff-relief-v4.js'
import { connectionBand, corridor } from '../../../shared/geometry/geometry.js'
import { grassEdgeRings } from './grass-edge.js'
import { terrainTransitionStrokePolygon } from '../../../shared/visual/transition.js'
import { edgeLookPaintPadding } from '../../../shared/visual/paint-envelopes.js'
import { boundaryConnections, clipConnectionOpenings, drawConnectionCheeks } from './connection-geometry'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { cliffHighGround, type CliffHighGround } from './cliff-high-ground.js'

const TAU = Math.PI * 2
const minMaxBounds = (points: PointMm[], padding = 0): BoundsMm => { const x = Math.min(...points.map(p => p.x)) - padding, y = Math.min(...points.map(p => p.y)) - padding; return { x, y, width: Math.max(...points.map(p => p.x)) + padding - x, height: Math.max(...points.map(p => p.y)) + padding - y } }
const intersection = (a: BoundsMm, b: BoundsMm): BoundsMm | null => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height); return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null }
function addRing(path: Path2D, points: readonly PointMm[]): void { points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath() }
function ringsPath(rings: readonly PointMm[][]): Path2D { const path = new Path2D(); for (const ring of rings) addRing(path, ring); return path }
function linePath(points: readonly PointMm[], closed = false): Path2D { const path = new Path2D(); points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); if (closed) path.closePath(); return path }
function ctx2d(surface: HTMLCanvasElement, readFrequently = false): CanvasRenderingContext2D { const ctx = surface.getContext('2d', { colorSpace: 'srgb', ...(readFrequently ? { willReadFrequently: true } : {}) }); if (!ctx) throw new Error('无法分配视觉效果缓冲，请降低输出尺寸。'); return ctx }
const makeCanvas = (width: number, height: number) => { const value = document.createElement('canvas'); value.width = width; value.height = height; return value }
const release = (surface: HTMLCanvasElement) => { surface.width = 0; surface.height = 0 }
const colorRgb = (color: string) => [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
const rgba = (color: string, opacity: number) => `rgba(${colorRgb(color).join(',')},${opacity})`

/** Smoothstep alpha falls inward only, with phase fixed in world coordinates. */
function featherInward(ctx: CanvasRenderingContext2D, rings: readonly PointMm[][], featherMm: number): void {
  if (!(featherMm > 0)) return
  const edge = ringsPath(rings), smooth = (value: number) => value * value * (3 - 2 * value)
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  for (let i = 24; i > 0; i--) { ctx.lineWidth = featherMm * 2 * i / 24; ctx.globalAlpha = 1 - smooth((i - 1) / 24) / smooth(i / 24); ctx.stroke(edge) }
  ctx.restore()
}

interface LocalBuffer { surface: HTMLCanvasElement; ctx: CanvasRenderingContext2D; bounds: BoundsMm; left: number; top: number; sx: number; sy: number }
/** At most one locally clipped RGBA surface per effect; no per-light full-map stacks. */
function localBuffer(ctx: CanvasRenderingContext2D, projection: Projection, requested: BoundsMm, readFrequently = false): LocalBuffer | null {
  const b = intersection(projection.bounds, requested)
  if (!b) return null
  const sx = ctx.canvas.width / projection.bounds.width, sy = ctx.canvas.height / projection.bounds.height
  const left = Math.max(0, Math.floor((b.x - projection.bounds.x) * sx)), top = Math.max(0, Math.floor((b.y - projection.bounds.y) * sy)), right = Math.min(ctx.canvas.width, Math.ceil((b.x + b.width - projection.bounds.x) * sx)), bottom = Math.min(ctx.canvas.height, Math.ceil((b.y + b.height - projection.bounds.y) * sy))
  if (right <= left || bottom <= top) return null
  if ((right - left) * (bottom - top) > 16777216) throw new Error('视觉效果超过16M局部像素预算。')
  const surface = makeCanvas(right - left, bottom - top), local = ctx2d(surface, readFrequently), bounds = { x: projection.bounds.x + left / sx, y: projection.bounds.y + top / sy, width: surface.width / sx, height: surface.height / sy }
  local.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
  return { surface, ctx: local, bounds, left, top, sx, sy }
}
function copyBuffer(ctx: CanvasRenderingContext2D, buffer: LocalBuffer, opacity = 1, composition: GlobalCompositeOperation = 'source-over'): void { ctx.save(); ctx.resetTransform(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = composition; ctx.drawImage(buffer.surface, buffer.left, buffer.top); ctx.restore() }
function band(ctx: CanvasRenderingContext2D, boundary: ProjectedVisualBoundary, from: number, to: number, color: string, opacity: number, featherMm = 0): void {
  const rings = bandRings(boundary.points, from, to, boundary.closed)
  if (!rings.length || opacity <= 0) return
  ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = opacity
  if (featherMm) { const transform = ctx.getTransform(); ctx.filter = `blur(${featherMm * Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))}px)` }
  ctx.fill(ringsPath(rings), 'evenodd'); ctx.restore()
}
function excludeHighGround(ctx: CanvasRenderingContext2D, projection: Projection, high: CliffHighGround): void {
  if (!high.excludedRings.length) return
  const path = new Path2D()
  path.rect(projection.bounds.x - 100000, projection.bounds.y - 100000, projection.bounds.width + 200000, projection.bounds.height + 200000)
  for (const points of high.excludedRings) addRing(path, points)
  ctx.clip(path, 'evenodd')
}
function connectionsFor(projection: Projection, boundary: ProjectedVisualBoundary): ProjectedConnection[] {
  return boundaryConnections(projection.connections, boundary.points, boundary.closed, boundary.terrainAreaIds)
}
const sides = (look: VisualEdgeLook) => look.side === 'both' ? [-1, 1] : [look.side === 'left' ? 1 : -1]

/** Deterministic edge detail along one cumulative arc, independent of zoom, crop and output resolution. */
function edgeDetails(ctx: CanvasRenderingContext2D, boundary: ProjectedVisualBoundary, look: VisualEdgeLook): void {
  const total = boundary.lengthMm
  if (!total || look.intensity === 0) return
  const spacing = look.repeatMm, count = Math.ceil(total / spacing)
  if (count > 1024) throw new Error('连续边带超过1024个装饰预算，请增大重复间距。')
  for (const sign of sides(look)) for (let i = 0; i < count; i++) {
    const d = (i + .15 + visualRandom(look.seed, i, 1) * .6) * spacing
    if (d >= total) continue
    const sample = visualSampleAtDistance(boundary, d), p = { ...sample.positionMm, normal: sample.normal, tangent: sample.tangent }
    const random = visualRandom(look.seed, i, 2), size = spacing * (.28 + random * .27), shift = look.widthMm * sign * (.28 + .22 * visualRandom(look.seed, i, 3))
    const x = p.x + p.normal.x * shift, y = p.y + p.normal.y * shift
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(p.tangent.y, p.tangent.x)); ctx.strokeStyle = look.accentColor; ctx.fillStyle = look.accentColor; ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * (.45 + random * .5)
    if (look.kind === 'shore') {
      ctx.lineWidth = Math.max(12, look.widthMm * .045); ctx.lineCap = 'round'; ctx.beginPath(); ctx.ellipse(0, 0, size, Math.max(8, look.widthMm * .09), 0, Math.PI * .08, Math.PI * .92); ctx.stroke()
      if (random > .5) { ctx.beginPath(); ctx.arc(size * .8, look.widthMm * .12, Math.max(5, look.widthMm * .02), 0, TAU); ctx.fill() }
    } else if (look.kind === 'grass') {
      ctx.globalAlpha *= .55; ctx.lineWidth = Math.max(6, look.widthMm * .016); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-size * .18, 0); ctx.quadraticCurveTo(-size * .08, -sign * look.widthMm * .1, size * .06, -sign * look.widthMm * .18); ctx.moveTo(0, 0); ctx.quadraticCurveTo(size * .12, -sign * look.widthMm * .08, size * .22, -sign * look.widthMm * .12); ctx.stroke()
    } else if (look.kind === 'fence') {
      ctx.rotate(-Math.atan2(p.tangent.y, p.tangent.x)); ctx.lineWidth = Math.max(18, look.widthMm * .12); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -look.widthMm * .36); ctx.lineTo(0, look.widthMm * .36); ctx.stroke()
      ctx.fillStyle = look.color; ctx.beginPath(); ctx.arc(0, 0, Math.max(16, look.widthMm * .13), 0, TAU); ctx.fill()
    } else if (look.kind === 'cliff') {
      ctx.lineWidth = Math.max(8, look.widthMm * .025); ctx.beginPath(); ctx.moveTo(-size * .2, -look.widthMm * .22); ctx.lineTo(size * .1, look.widthMm * .25); ctx.lineTo(size * .35, look.widthMm * .38); ctx.stroke()
    } else {
      ctx.globalAlpha *= .35; ctx.beginPath(); ctx.ellipse(0, 0, Math.max(8, size * .12), Math.max(6, size * .055), random * 2, 0, TAU); ctx.fill()
    }
    ctx.restore()
  }
}

/** One joined face with variable ledges and broken strata, rather than repeated cliff stickers. */
function drawCliffFace(ctx: CanvasRenderingContext2D, boundary: ProjectedVisualBoundary, look: VisualEdgeLook, directionDeg: number, connections: ProjectedConnection[], dropMm?: number): void {
  const angle = directionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }, reliefRgb = colorRgb(look.color)
  const shade = (normal: PointMm, variation: number) => {
    const facing = normal.x * light.x + normal.y * light.y
    const factor = Math.max(.66, Math.min(1.12, .91 + Math.max(0, facing) * .16 - Math.max(0, -facing) * .13 + variation))
    return `rgb(${reliefRgb.map(channel => Math.round(Math.max(0, Math.min(255, channel * factor)))).join(',')})`
  }
  for (const sign of sides(look)) {
    if (look.renderProfile === 'rockRelief2' || look.renderProfile === 'rockRelief3' || look.renderProfile === 'rockRelief4') {
      const openingPolygons = connections.map(connection => connection.route
        ? connectionBand(connection.route.centerlineMm, connection.widthMm)
        : corridor(connection.start, connection.end, connection.widthMm))
      const options = { openingPolygons, ...(dropMm === undefined ? {} : { dropMm }) }
      const relief = look.renderProfile === 'rockRelief4' ? cliffReliefV4(boundary, look, sign, { ...options, lightDirectionDeg: directionDeg })
        : (look.renderProfile === 'rockRelief3' ? cliffReliefV3 : cliffReliefV2)(boundary, look, sign, options)
      if (!relief.faceRings.length) continue
      const face = ringsPath(relief.faceRings)
      ctx.fillStyle = look.color; ctx.globalAlpha = look.opacity * relief.baseOpacity; ctx.fill(face, 'evenodd')
      ctx.save(); ctx.clip(face, 'evenodd')
      try {
        if (relief.version === 4) {
          const transform = ctx.getTransform(), sx = Math.hypot(transform.a, transform.b), sy = Math.hypot(transform.c, transform.d)
          const planned = relief.shadeCells.map(cell => { const bounds = minMaxBounds(cell.rings.flat(), 2)
            return { cell, bounds, width: Math.max(1, Math.ceil(bounds.width * sx)), height: Math.max(1, Math.ceil(bounds.height * sy)) } })
          const width = Math.max(1, ...planned.map(row => row.width)), height = Math.max(1, ...planned.map(row => row.height))
          if (width * height > 16777216) throw new Error('第四版崖面受光缓冲超过16M局部像素预算。')
          const scratch = makeCanvas(width, height), target = ctx2d(scratch)
          try { for (const { cell, bounds, width: usedWidth, height: usedHeight } of planned) {
          target.resetTransform(); target.clearRect(0, 0, width, height); target.globalCompositeOperation = 'source-over'
          target.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
          const gradient = target.createLinearGradient(cell.fromMm.x, cell.fromMm.y, cell.toMm.x, cell.toMm.y)
          for (const stop of cell.stops) {
            const accent = colorRgb(look.accentColor)
            const channels = reliefRgb.map((value, index) => Math.round(Math.max(0, Math.min(255,
              value * stop.shade * (1 - stop.accent) + accent[index] * stop.accent))))
            gradient.addColorStop(stop.offset, `rgba(${channels.join(',')},${stop.opacity})`)
          }
          target.fillStyle = gradient; target.fill(ringsPath(cell.rings), 'evenodd')
          const feather = target.createLinearGradient(cell.featherFromMm.x, cell.featherFromMm.y, cell.featherToMm.x, cell.featherToMm.y)
          feather.addColorStop(0, '#FFFFFF00'); feather.addColorStop(.24, '#FFFFFF'); feather.addColorStop(.76, '#FFFFFF'); feather.addColorStop(1, '#FFFFFF00')
          target.globalCompositeOperation = 'destination-in'; target.fillStyle = feather
          target.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
          ctx.globalAlpha = look.opacity; ctx.drawImage(scratch, 0, 0, usedWidth, usedHeight, bounds.x, bounds.y, usedWidth / sx, usedHeight / sy)
          } } finally { release(scratch) }
        }
        for (const facet of relief.facets) {
          ctx.fillStyle = shade(facet.normal, (facet.shade - 1) * .55)
          ctx.globalAlpha = look.opacity * facet.opacity; ctx.fill(ringsPath([facet.polygon]))
        }
        for (const mark of relief.erosion) {
          ctx.fillStyle = '#33483F'; ctx.globalAlpha = look.opacity * mark.shade; ctx.fill(ringsPath([mark.polygon]))
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([])
        for (const stroke of [...relief.ledges, ...relief.crestRuns, ...relief.footRuns, ...relief.fractures]) {
          ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.widthMm; ctx.globalAlpha = look.opacity * stroke.opacity
          ctx.stroke(linePath(stroke.points))
        }
        if (connections.length) drawConnectionCheeks(ctx, connections, '#32463B', Math.max(24, look.widthMm * .10), look.opacity * .45)
      } finally { ctx.restore() }
      continue
    }
    const relief = cliffRelief(boundary, look, sign)
    const face = ringsPath(relief.faceRings)
    ctx.fillStyle = look.color; ctx.globalAlpha = look.opacity * .82; ctx.fill(face, 'evenodd')
    ctx.save(); ctx.clip(face, 'evenodd')
    for (let row = 0; row < relief.strata.length; row++) {
      const stratum = relief.strata[row]
      for (let i = 0; i + 1 < stratum.upper.length; i++) {
        const polygon = [stratum.upper[i], stratum.upper[i + 1], stratum.lower[i + 1], stratum.lower[i]]
        const sample = visualSampleAtDistance(boundary, boundary.lengthMm * (i + .5) / (stratum.upper.length - 1))
        ctx.fillStyle = shade({ x: sample.normal.x * sign, y: sample.normal.y * sign }, (stratum.shade - 1) * .34 + (row % 2 ? -.025 : .025))
        ctx.globalAlpha = look.opacity * (row === 0 ? .56 : .78)
        ctx.fill(ringsPath([polygon]))
      }
      const line = linePath(stratum.lower, boundary.closed)
      ctx.strokeStyle = row === relief.strata.length - 1 ? look.accentColor : '#34463E'
      ctx.globalAlpha = look.opacity * (row === relief.strata.length - 1 ? .2 : .15)
      ctx.lineWidth = Math.max(9, look.widthMm * (row === relief.strata.length - 1 ? .028 : .018))
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.setLineDash([look.repeatMm * (1.2 + row * .4), look.repeatMm * (.8 + row * .3)])
      ctx.lineDashOffset = visualRandom(look.seed, row, 100) * look.repeatMm * 3; ctx.stroke(line); ctx.setLineDash([])
    }
    for (const facet of relief.facets) {
      ctx.fillStyle = shade({ x: facet.normal.x * sign, y: facet.normal.y * sign }, (facet.shade - 1) * .4)
      ctx.globalAlpha = look.opacity * .28; ctx.fill(ringsPath([facet.polygon]))
    }
    for (let index = 0; index < relief.erosion.length; index++) {
      const mark = relief.erosion[index]
      ctx.fillStyle = index % 2 ? '#33483F' : look.accentColor; ctx.globalAlpha = look.opacity * mark.shade
      ctx.fill(ringsPath([mark.polygon]))
    }
    for (let index = 0; index < relief.fractures.length; index++) {
      const fracture = relief.fractures[index]
      ctx.strokeStyle = '#293A34'; ctx.globalAlpha = look.opacity * (.18 + visualRandom(look.seed, index, 91) * .14)
      ctx.lineWidth = Math.max(10, look.widthMm * .016); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.stroke(linePath(fracture))
      if (index % 3 === 0) {
        ctx.strokeStyle = look.accentColor; ctx.globalAlpha = look.opacity * .16; ctx.lineWidth = Math.max(7, look.widthMm * .009)
        ctx.stroke(linePath(fracture.map(point => ({ x: point.x - 13, y: point.y - 9 }))))
      }
    }
    ctx.strokeStyle = look.accentColor; ctx.globalAlpha = look.opacity * .3; ctx.lineWidth = Math.max(12, look.widthMm * .035); ctx.stroke(linePath(boundary.points, boundary.closed))
    ctx.strokeStyle = '#32463B'; ctx.globalAlpha = look.opacity * .22; ctx.lineWidth = Math.max(10, look.widthMm * .025)
    ctx.setLineDash([look.repeatMm * 1.8, look.repeatMm * 1.2]); ctx.stroke(linePath(relief.outer, boundary.closed)); ctx.setLineDash([])
    if (connections.length) { ctx.save(); ctx.clip(face, 'evenodd'); drawConnectionCheeks(ctx, connections, '#32463B', Math.max(24, look.widthMm * .10), look.opacity * .65); ctx.restore() }
    ctx.restore()
  }
}

/** Surface pass: continuous bands precede furniture and walls. */
export function drawVisualBoundaries(ctx: CanvasRenderingContext2D, projection: Projection, signal?: AbortSignal, readFrequently = false): void {
  const visual = projection.visual
  if (!visual) return
  const byId = new Map(visual.boundaries.map(boundary => [boundary.id, boundary]))
  const highGroundCache = new Map<string, CliffHighGround>()
  const highGround = (boundary: ProjectedVisualBoundary) => {
    let high = highGroundCache.get(boundary.id)
    if (!high) {
      const padding = Math.max(1, ...visual.edgeLooks.filter(look => look.kind === 'cliff' && look.boundaryId === boundary.id).map(edgeLookPaintPadding))
      high = cliffHighGround(projection, boundary, padding); highGroundCache.set(boundary.id, high)
    }
    return high
  }
  const cliffs = visual.edgeLooks.filter(look => look.kind === 'cliff' && look.opacity > 0)
  if (cliffs.length) {
    const allPoints = cliffs.flatMap(look => byId.get(look.boundaryId)?.points ?? []), padding = Math.max(...cliffs.map(edgeLookPaintPadding))
    const buffer = allPoints.length ? localBuffer(ctx, projection, minMaxBounds(allPoints, padding), readFrequently) : null
    if (buffer) try {
      const direction = visual.environment.lightDirectionDeg * Math.PI / 180
      buffer.ctx.fillStyle = '#FFFFFF'; buffer.ctx.fillRect(buffer.bounds.x, buffer.bounds.y, buffer.bounds.width, buffer.bounds.height)
      buffer.ctx.globalCompositeOperation = 'darken'
      for (const look of cliffs) {
        const boundary = byId.get(look.boundaryId)
        if (!boundary) continue
        buffer.ctx.save(); buffer.ctx.fillStyle = `rgb(${Math.round(255 * (1 - look.opacity * .23))},${Math.round(255 * (1 - look.opacity * .21))},${Math.round(255 * (1 - look.opacity * .21))})`; excludeHighGround(buffer.ctx, projection, highGround(boundary)); clipConnectionOpenings(buffer.ctx, projection.bounds, connectionsFor(projection, boundary))
        const shift = look.widthMm * .85, dx = Math.cos(direction) * shift, dy = Math.sin(direction) * shift
        // A neutral-white darken mask takes the maximum shadow at joins, then multiplies once.
        for (let i = 0; i < boundary.points.length - (boundary.closed ? 0 : 1); i++) {
          const a = boundary.points[i], b = boundary.points[(i + 1) % boundary.points.length]
          buffer.ctx.fill(ringsPath([[a, b, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }]]))
        }
        buffer.ctx.restore()
      }
      copyBuffer(ctx, buffer, 1, 'multiply')
    } finally { release(buffer.surface) }
  }
  for (const transition of visual.transitions ?? []) {
    checkCancelled(signal)
    const boundary = byId.get(transition.boundaryId)
    ctx.save(); if (boundary) clipConnectionOpenings(ctx, projection.bounds, connectionsFor(projection, boundary))
    drawTerrainTransition(ctx, transition); ctx.restore()
  }
  const looksById = new Map(visual.edgeLooks.map(look => [look.id, look]))
  const materializedById = new Map((visual.materializedEdges ?? []).map(edge => [edge.id, edge]))
  const paintOrder = visual.edgePaintOrder ?? [
    ...visual.edgeLooks.map(look => ({ kind: 'edgeLook' as const, id: look.id })),
    ...(visual.materializedEdges ?? []).map(edge => ({ kind: 'materializedEdge' as const, id: edge.id })),
  ]
  for (const entry of paintOrder) {
    checkCancelled(signal)
    if (entry.kind === 'materializedEdge') {
      const edge = materializedById.get(entry.id)
      if (edge) {
        const boundary = edge.boundaryId ? byId.get(edge.boundaryId) : undefined
        ctx.save(); if (boundary) clipConnectionOpenings(ctx, projection.bounds, connectionsFor(projection, boundary))
        drawMaterializedEdge(ctx, edge); ctx.restore()
      }
      continue
    }
    const look = looksById.get(entry.id)
    if (!look) continue
    const boundary = byId.get(look.boundaryId)
    if (!boundary || !intersectsVisualBounds(minMaxBounds(boundary.points, edgeLookPaintPadding(look)), projection.bounds)) continue
    const connections = connectionsFor(projection, boundary)
    ctx.save()
    try {
    clipConnectionOpenings(ctx, projection.bounds, connections)
    if (look.kind === 'cliff') excludeHighGround(ctx, projection, highGround(boundary))
    if (look.kind === 'cliff') {
      // Only elevations already visible to this audience may affect pixels.
      const { dropMm } = highGround(boundary)
      drawCliffFace(ctx, boundary, look, visual.environment.lightDirectionDeg, connections, dropMm)
      continue
    }
    for (const sign of sides(look)) {
      if (look.kind === 'shore') {
        band(ctx, boundary, -sign * look.widthMm * .5, 0, look.color, look.opacity * .22, look.widthMm * .1)
        band(ctx, boundary, 0, sign * look.widthMm, look.color, look.opacity * .45, look.widthMm * .12)
        band(ctx, boundary, 0, sign * look.widthMm * .3, look.accentColor, look.opacity * .22, look.widthMm * .04)
      } else if (look.kind === 'grass') {
        for (const [fraction, opacity] of [[.85, .15], [.55, .22], [.24, .3]]) {
          ctx.fillStyle = look.color; ctx.globalAlpha = look.opacity * opacity
          ctx.fill(ringsPath(grassEdgeRings(boundary, look, sign, fraction)), 'evenodd')
        }
      } else if (look.kind === 'path') {
        band(ctx, boundary, 0, sign * look.widthMm * .5, look.color, look.opacity)
        ctx.strokeStyle = look.accentColor; ctx.globalAlpha = look.opacity * .5; ctx.lineWidth = Math.max(10, look.widthMm * .025); ctx.stroke(linePath(offsetPolyline(boundary.points, sign * look.widthMm * .5, boundary.closed), boundary.closed))
      } else {
        for (const fraction of [.25, .7]) { ctx.strokeStyle = look.color; ctx.globalAlpha = look.opacity; ctx.lineWidth = Math.max(18, look.widthMm * .09); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(linePath(offsetPolyline(boundary.points, sign * look.widthMm * fraction, boundary.closed), boundary.closed)) }
      }
    }
    edgeDetails(ctx, boundary, look)
    } finally { ctx.restore() }
  }
}

/** Contacts are one audience-owned silhouette union, so overlapping props do not multiply darkness. */
export function drawVisualContacts(ctx: CanvasRenderingContext2D, projection: Projection, rings: PointMm[][], readFrequently = false, paintSourceAlpha?: (context: CanvasRenderingContext2D, projection: Projection) => void): void {
  const environment = projection.visual?.environment
  const boundsRings = [...rings, ...(projection.visual?.contactRings ?? [])]
  if (!environment?.contactShadowOpacity || !environment.contactShadowMm || !boundsRings.length) return
  const buffer = localBuffer(ctx, projection, minMaxBounds(boundsRings.flat(), environment.contactShadowMm * 4), readFrequently)
  if (!buffer) return
  try {
    buffer.ctx.fillStyle = '#18201D'; buffer.ctx.fill(ringsPath(rings))
    // Actual transparent bitmap alpha contributes to the union. Visual bounds
    // only constrain allocation; they must never cast rectangular tree shadows.
    paintSourceAlpha?.(buffer.ctx, { ...projection, bounds: buffer.bounds })
    buffer.ctx.globalCompositeOperation = 'source-in'; buffer.ctx.fillStyle = '#18201D'; buffer.ctx.fillRect(buffer.bounds.x, buffer.bounds.y, buffer.bounds.width, buffer.bounds.height)
    ctx.save(); ctx.resetTransform(); ctx.filter = `blur(${environment.contactShadowMm * Math.max(buffer.sx, buffer.sy)}px)`; ctx.globalAlpha = environment.contactShadowOpacity; ctx.drawImage(buffer.surface, buffer.left, buffer.top); ctx.restore()
  } finally { release(buffer.surface) }
}

/** Wall gaps are real apertures; a closed door seals its gap. Windows transmit this static light. */
export function projectedLightBlockers(projection: Projection, _wallRings: PointMm[][] = []): VisualSegment[] {
  return projection.visual?.occluderRings.flatMap(polygonSegments) ?? []
}

function applyExposure(ctx: CanvasRenderingContext2D, projection: Projection, exposure: number, readFrequently: boolean): void {
  if (exposure === 1) return
  const buffer = localBuffer(ctx, projection, projection.bounds, readFrequently)
  if (!buffer) return
  try { buffer.ctx.resetTransform(); buffer.ctx.filter = `brightness(${exposure})`; buffer.ctx.drawImage(ctx.canvas, 0, 0); ctx.save(); ctx.resetTransform(); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(buffer.surface, 0, 0); ctx.restore() } finally { release(buffer.surface) }
}

/** Atmosphere only sees the audience-filtered projection. Final opaque masks run afterwards. */
export function drawVisualAtmosphere(ctx: CanvasRenderingContext2D, projection: Projection, wallRings: PointMm[][], signal?: AbortSignal, readFrequently = false): void {
  const visual = projection.visual
  if (!visual) return
  const b = projection.bounds, env = visual.environment
  if (env.ambientOpacity > 0) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = env.ambientOpacity; ctx.fillStyle = env.ambientColor; ctx.fillRect(b.x, b.y, b.width, b.height); ctx.restore() }
  applyExposure(ctx, projection, env.exposure, readFrequently)
  const blockers = visual.lights.some(light => light.wallOcclusion) ? projectedLightBlockers(projection, wallRings) : []
  for (const light of visual.lights) {
    checkCancelled(signal)
    if (!light.intensity) continue
    const radius = light.radiusMm, p = light.positionMm
    if (!intersectsVisualBounds({ x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2 }, b)) continue
    ctx.save()
    if (light.wallOcclusion) ctx.clip(ringsPath([lightVisibilityPolygon(p, radius, blockers)]))
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
    gradient.addColorStop(0, rgba(light.color, Math.min(1, light.intensity * .8))); gradient.addColorStop(.35, rgba(light.color, Math.min(1, light.intensity * .38))); gradient.addColorStop(1, rgba(light.color, 0))
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gradient; ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2); ctx.restore()
  }
  for (const fog of visual.fogs) {
    checkCancelled(signal)
    if (!fog.opacity || !intersectsVisualBounds(minMaxBounds(fog.boundaryMm), b)) continue
    const fogBounds = minMaxBounds(fog.boundaryMm), buffer = localBuffer(ctx, projection, fogBounds, readFrequently)
    if (!buffer) continue
    const target = buffer.ctx
    try {
    target.save(); target.clip(ringsPath([fog.boundaryMm])); target.fillStyle = fog.color; target.globalAlpha = fog.opacity * .38; target.fillRect(b.x, b.y, b.width, b.height)
    const f = intersection(fogBounds, b)!, size = fog.scaleMm, angle = fog.directionDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    const startX = Math.floor(f.x / size) - 3, endX = Math.ceil((f.x + f.width) / size) + 3, startY = Math.floor(f.y / size) - 3, endY = Math.ceil((f.y + f.height) / size) + 3
    if ((endX - startX + 1) * (endY - startY + 1) > 16384) throw new Error('薄雾世界噪声超过16384个局部单元预算，请增大纹理尺度。')
    for (let y = startY; y <= endY; y++) for (let x = startX; x <= endX; x++) {
      const index = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) | 0, random = visualRandom(fog.seed, index)
      const cx = (x + .2 + visualRandom(fog.seed, index, 1) * .6) * size, cy = (y + .2 + visualRandom(fog.seed, index, 2) * .6) * size
      target.save(); target.translate(cx, cy); target.transform(cos * 1.8, sin * 1.8, -sin * .65, cos * .65, 0, 0)
      const gradient = target.createRadialGradient(0, 0, 0, 0, 0, size)
      gradient.addColorStop(0, rgba(fog.color, fog.opacity * (.25 + random * .35))); gradient.addColorStop(1, rgba(fog.color, 0)); target.fillStyle = gradient; target.globalAlpha = 1; target.fillRect(-size, -size, size * 2, size * 2); target.restore()
    }
    target.restore()
    // A world-sized inward feather keeps the selected region closed while
    // removing the hard rectangular edge of a painted fog patch. Nested
    // destination-out strokes approximate smoothstep without another RGBA mask.
    const feather = Math.min(size * .8, Math.min(fogBounds.width, fogBounds.height) / 4)
    featherInward(target, [fog.boundaryMm], feather); copyBuffer(ctx, buffer)
    } finally { release(buffer.surface) }
  }
  applyVisualFilters(ctx, projection, signal, readFrequently)
}

const presetColors: Record<ProjectedVisualFilter['preset'], [number, number, number, number]> = { neutral: [255, 255, 255, 0], warm: [224, 157, 87, .09], cool: [105, 155, 207, .09], aged: [187, 157, 101, .15], moonlight: [71, 101, 155, .19] }

/** Tile readback bounds CPU/RGBA working memory; filter seeds use world positions, not output pixel indices. */
export function applyVisualFilters(ctx: CanvasRenderingContext2D, projection: Projection, signal?: AbortSignal, readFrequently = false, selectedFilters?: ProjectedVisualFilter[]): void {
  const visual = projection.visual
  if (!visual) return
  const sx = ctx.canvas.width / projection.bounds.width, sy = ctx.canvas.height / projection.bounds.height
  for (const filter of selectedFilters ?? visual.filters.filter(filter => !filter.sourceEntityIds)) {
    checkCancelled(signal)
    if (filter.preset === 'neutral' && filter.exposure === 1 && filter.saturation === 1 && filter.contrast === 1 && !filter.vignette && !filter.grain) continue
    const crop = intersection(projection.bounds, filter.targetBoundsMm)
    if (!crop) continue
    const left = Math.max(0, Math.floor((crop.x - projection.bounds.x) * sx)), top = Math.max(0, Math.floor((crop.y - projection.bounds.y) * sy)), right = Math.min(ctx.canvas.width, Math.ceil((crop.x + crop.width - projection.bounds.x) * sx)), bottom = Math.min(ctx.canvas.height, Math.ceil((crop.y + crop.height - projection.bounds.y) * sy)), width = right - left
    if (width <= 0 || bottom <= top) continue
    // One 128-row mask/readback tile at a time, even for a 4K scene filter.
    const mask = filter.targetRings ? makeCanvas(width, Math.min(128, bottom - top)) : null
    try {
      const maskCtx = mask ? ctx2d(mask, true) : null, [pr, pg, pb, mix] = presetColors[filter.preset], target = filter.targetBoundsMm
      for (let y = top; y < bottom; y += 128) {
        checkCancelled(signal)
        const height = Math.min(128, bottom - y), image = ctx.getImageData(left, y, width, height), data = image.data
        let maskPixels: Uint8ClampedArray | undefined
        if (mask && maskCtx) {
          maskCtx.resetTransform(); maskCtx.clearRect(0, 0, width, mask.height); maskCtx.setTransform(sx, 0, 0, sy, -projection.bounds.x * sx - left, -projection.bounds.y * sy - y); maskCtx.fillStyle = '#fff'
          for (const ring of filter.targetRings!) maskCtx.fill(ringsPath([ring]))
          if (filter.regionFeatherMm) featherInward(maskCtx, filter.targetRings!, filter.regionFeatherMm)
          maskPixels = maskCtx.getImageData(0, 0, width, height).data
        }
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          const i = (row * width + column) * 4, alpha = maskPixels ? maskPixels[i + 3] / 255 : 1
          if (!alpha || !data[i + 3]) continue
          const wx = projection.bounds.x + (left + column + .5) / sx, wy = projection.bounds.y + (y + row + .5) / sy
          const luma = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722
          const grainIndex = (Math.imul(Math.floor(wx / 18), 73856093) ^ Math.imul(Math.floor(wy / 18), 19349663)) | 0
          const grain = filter.grain ? (visualRandom(filter.seed, grainIndex) - .5) * filter.grain * 42 : 0
          const nx = (wx - target.x - target.width / 2) / Math.max(1, target.width / 2), ny = (wy - target.y - target.height / 2) / Math.max(1, target.height / 2), vignette = 1 - filter.vignette * Math.min(1, Math.max(0, (nx * nx + ny * ny - .15) / 1.85)) * .65
          for (let channel = 0; channel < 3; channel++) {
            const source = data[i + channel], tint = channel === 0 ? pr : channel === 1 ? pg : pb
            const saturation = luma + (source - luma) * filter.saturation, contrast = (saturation - 127.5) * filter.contrast + 127.5
            const result = ((contrast * filter.exposure) * (1 - mix) + tint * mix + grain) * vignette
            data[i + channel] = Math.round(source * (1 - alpha) + Math.max(0, Math.min(255, result)) * alpha)
          }
        }
        ctx.putImageData(image, left, y)
      }
    } finally { if (mask) release(mask) }
  }
  // Keep the parameter in this public helper so all its allocations use the
  // same software-readback policy when additional effect types are introduced.
  void readFrequently
}

/** Object/layer filters operate on the primitive's transparent source before it covers the scene. */
export function drawVisualEntity(ctx: CanvasRenderingContext2D, projection: Projection, entityId: string, paintBounds: BoundsMm, draw: (context: CanvasRenderingContext2D, projection: Projection) => void, readFrequently = false): void {
  const filters = projection.visual?.filters.filter(filter => filter.sourceEntityIds?.includes(entityId)) ?? []
  if (!filters.length) { draw(ctx, projection); return }
  const buffer = localBuffer(ctx, projection, paintBounds, true)
  if (!buffer) return
  try {
    const localProjection = { ...projection, bounds: buffer.bounds }
    draw(buffer.ctx, localProjection)
    applyVisualFilters(buffer.ctx, localProjection, undefined, readFrequently, filters)
    copyBuffer(ctx, buffer)
  } finally { release(buffer.surface) }
}

type ProjectedMaterializedEdge = NonNullable<NonNullable<Projection['visual']>['materializedEdges']>[number]
type ProjectedTransition = NonNullable<NonNullable<Projection['visual']>['transitions']>[number]
/** The native pass consumes the saved discrete geometry, never a second field. */
export function drawTerrainTransition(ctx: CanvasRenderingContext2D, transition: ProjectedTransition): void {
  if (!transition.enabled) return
  ctx.save()
  for (const polygon of transition.polygons) {
    ctx.fillStyle = polygon.fillColor; ctx.globalAlpha = polygon.opacity
    ctx.fill(ringsPath([polygon.pointsMm]))
  }
  for (const stroke of transition.strokes) {
    ctx.fillStyle = stroke.color; ctx.globalAlpha = stroke.opacity
    const ring = terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm)
    if (ring.length) ctx.fill(ringsPath([ring]))
  }
  ctx.restore()
}
/** Native visual2 geometry; the shared surface pass owns its audience-filtered order. */
function drawMaterializedEdge(ctx: CanvasRenderingContext2D, edge: ProjectedMaterializedEdge): void {
  ctx.save(); ctx.globalAlpha = edge.opacity; ctx.fillStyle = edge.fillColor
  for (const ring of edge.polygons) ctx.fill(ringsPath([ring]))
  for (const stroke of edge.strokes) {
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.widthMm; ctx.globalAlpha = edge.opacity * stroke.opacity
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.stroke(linePath(stroke.pointsMm))
  }
  ctx.restore()
}
