import { validateSceneV2 } from '../../core/v2/schema'
import type { BoundsMm, MaterialPaint, PointMm, PropV2, ShadowStyle, SurfaceStyle } from '../../core/v2/types'
import { checkCancelled, PROJECT_LIMITS_V2 } from '../../io/v2/limits'
import { inspectImageBytes, sha256Bytes } from '../../io/v2/resources'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { orderedPropsV2, pointsBoundsV2, projectSceneV2 } from './projection'
import type { AudienceV2, ProjectedConnectionV2, ProjectedOpeningV2, ProjectedTerrainEdgeV2, ProjectedWallV2, ProjectionV2 } from './projection'

export interface RenderOptionsV2 { audience: AudienceV2; longEdgePx: number; signal?: AbortSignal }
export const PNG_MAX_LONG_EDGE_V2 = 4096
export const PNG_MAX_PIXELS_V2 = 16_777_216
export interface WallGeometryV2 { wall: ProjectedWallV2; polygons: PointMm[][] }
const EPS = 1e-6
const point = (x: number, y: number): PointMm => ({ x, y })
const same = (a: PointMm, b: PointMm) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const signedArea = (points: PointMm[]) => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)
const positiveRing = (points: PointMm[]) => signedArea(points) < 0 ? [...points].reverse() : points
function wallBand(start: PointMm, end: PointMm, thickness: number): PointMm[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y), nx = -(end.y - start.y) / length * thickness / 2, ny = (end.x - start.x) / length * thickness / 2
  return positiveRing([point(start.x + nx, start.y + ny), point(start.x - nx, start.y - ny), point(end.x - nx, end.y - ny), point(end.x + nx, end.y + ny)])
}
/** The same centerline bands/miterLimit=2/bevel rule as the domain; no coordinates are written back. */
export function wallGeometryV2(walls: ProjectedWallV2[]): WallGeometryV2[] {
  const result = walls.map(wall => {
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length
    if (!(length > 0)) throw new Error('墙长必须大于零。')
    const position = (p: PointMm) => (p.x - wall.start.x) * ux + (p.y - wall.start.y) * uy
    const intervals = wall.openings.map(o => [Math.min(position(o.start), position(o.end)), Math.max(position(o.start), position(o.end))]).sort((a, b) => a[0] - b[0])
    const solids: [number, number][] = []; let from = 0
    for (const [near, far] of intervals) { if (near > from + EPS) solids.push([from, near]); from = Math.max(from, far) }
    if (from < length - EPS) solids.push([from, length])
    return { wall, polygons: solids.map(([a, b]) => wallBand(point(wall.start.x + ux * a, wall.start.y + uy * a), point(wall.start.x + ux * b, wall.start.y + uy * b), wall.thicknessMm)) }
  })
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j], shared = [a.start, a.end].find(p => same(p, b.start) || same(p, b.end))
    if (!shared) continue
    const endA = same(shared, a.start) ? a.end : a.start, endB = same(shared, b.start) ? b.end : b.start
    const la = Math.hypot(endA.x - shared.x, endA.y - shared.y), lb = Math.hypot(endB.x - shared.x, endB.y - shared.y)
    const u = point((endA.x - shared.x) / la, (endA.y - shared.y) / la), v = point((endB.x - shared.x) / lb, (endB.y - shared.y) / lb), determinant = u.x * v.y - u.y * v.x
    if (Math.abs(determinant) < 1e-12) continue
    const ra = a.thicknessMm / 2, rb = b.thicknessMm / 2
    for (const sign of [-1, 1]) {
      const p = point(shared.x + u.y * ra * sign, shared.y - u.x * ra * sign), q = point(shared.x - v.y * rb * sign, shared.y + v.x * rb * sign)
      const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / determinant, miter = point(p.x + u.x * t, p.y + u.y * t)
      const ring = Math.hypot(miter.x - shared.x, miter.y - shared.y) <= 2 * Math.max(ra, rb) + EPS ? [shared, p, miter, q] : [shared, p, q]
      if (Math.abs(signedArea(ring)) > EPS) result[i].polygons.push(positiveRing(ring))
    }
  }
  return result
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result
}
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!ctx) throw new Error('无法分配 sRGB Canvas；请降低输出尺寸后重试。')
  return ctx
}
const disposeCanvas = (value: HTMLCanvasElement) => { value.width = 0; value.height = 0 }
function addRing(path: Path2D, points: PointMm[]): void {
  positiveRing(points).forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath()
}
function polygonPath(points: PointMm[]): Path2D { const path = new Path2D(); addRing(path, points); return path }
function worldTransform(ctx: CanvasRenderingContext2D, bounds: BoundsMm, scaleX: number, scaleY: number) { ctx.setTransform(scaleX, 0, 0, scaleY, -bounds.x * scaleX, -bounds.y * scaleY) }

interface RasterSetV2 { bitmaps: Map<string, ImageBitmap>; byAssetId: Map<string, ImageBitmap>; paintCache?: { key: string; image: HTMLCanvasElement } }
async function decodeRequired(project: CompleteProjectV2, projection: ProjectionV2, signal?: AbortSignal): Promise<RasterSetV2> {
  const bitmaps = new Map<string, ImageBitmap>(), byAssetId = new Map<string, ImageBitmap>(); let totalPixels = 0
  try {
    for (const id of projection.assetIds) {
      checkCancelled(signal)
      const ref = project.document.assets[id], resource = ref && project.assets[ref.sha256]
      if (!ref || !resource || !(resource.blob instanceof Blob)) throw new Error(`绘制所需素材 ${id} 缺失，无法生成完整图片。`)
      if (ref.sha256 !== resource.sha256 || ref.mimeType !== resource.mimeType || ref.pixelWidth !== resource.pixelWidth || ref.pixelHeight !== resource.pixelHeight || resource.blob.size !== resource.sizeBytes || resource.blob.type && resource.blob.type !== ref.mimeType) throw new Error(`素材 ${id} 的字节记录与工程不一致。`)
      const cached = bitmaps.get(ref.sha256)
      if (cached) { byAssetId.set(id, cached); continue }
      const bytes = new Uint8Array(await resource.blob.arrayBuffer()); checkCancelled(signal)
      const header = inspectImageBytes(bytes)
      if (header.mimeType !== ref.mimeType || header.width !== ref.pixelWidth || header.height !== ref.pixelHeight || await sha256Bytes(bytes) !== ref.sha256) throw new Error(`素材 ${id} 的实际格式、尺寸或 hash 不匹配。`)
      checkCancelled(signal)
      totalPixels += header.width * header.height
      if (bitmaps.size >= PROJECT_LIMITS_V2.uniqueImages || totalPixels > PROJECT_LIMITS_V2.totalImagePixels) throw new Error('绘制素材超过候选解码预算。')
      let bitmap: ImageBitmap
      try { bitmap = await createImageBitmap(resource.blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' }) }
      catch { throw new Error(`素材 ${id} 实际解码失败，已停止出图。`) }
      if (signal?.aborted) { bitmap.close(); checkCancelled(signal) }
      if (bitmap.width !== ref.pixelWidth || bitmap.height !== ref.pixelHeight) { bitmap.close(); throw new Error(`素材 ${id} 的实际解码尺寸不符。`) }
      bitmaps.set(ref.sha256, bitmap); byAssetId.set(id, bitmap)
    }
    return { bitmaps, byAssetId }
  } catch (error) { bitmaps.forEach(bitmap => bitmap.close()); throw error }
}

function paintImage(ctx: CanvasRenderingContext2D, paint: MaterialPaint, projection: ProjectionV2, raster: RasterSetV2): HTMLCanvasElement {
  const material = projection.materials[paint.materialRef.id], bitmap = material && raster.byAssetId.get(material.textureAssetId)
  if (!bitmap) throw new Error('铺装所需位图没有完成解码。')
  const key = JSON.stringify([paint, ctx.canvas.width, ctx.canvas.height])
  if (raster.paintCache?.key !== key) {
    if (raster.paintCache) disposeCanvas(raster.paintCache.image)
    const image = canvas(ctx.canvas.width, ctx.canvas.height), imageCtx = context(image), pattern = imageCtx.createPattern(bitmap, 'repeat')
    if (!pattern) { disposeCanvas(image); throw new Error('无法建立重复材质。') }
    // Full fixed-view rasterization keeps texture phase independent of clipping and mutable bounds.
    const b = projection.bounds
    worldTransform(imageCtx, b, image.width / b.width, image.height / b.height)
    pattern.setTransform(new DOMMatrix().translate(paint.originMm.x, paint.originMm.y).rotate(paint.rotationDeg).scale(paint.tileSizeMm.width / bitmap.width, paint.tileSizeMm.height / bitmap.height))
    imageCtx.fillStyle = pattern; imageCtx.fillRect(b.x, b.y, b.width, b.height)
    if (paint.tint) { imageCtx.globalCompositeOperation = 'multiply'; imageCtx.fillStyle = paint.tint; imageCtx.fillRect(b.x, b.y, b.width, b.height); imageCtx.globalCompositeOperation = 'source-over' }
    raster.paintCache = { key, image }
  }
  return raster.paintCache.image
}
function fillSurface(ctx: CanvasRenderingContext2D, path: Path2D, style: SurfaceStyle | null, projection: ProjectionV2, raster: RasterSetV2, fallback: string): void {
  ctx.save(); ctx.clip(path); ctx.fillStyle = fallback
  const b = projection.bounds; ctx.fillRect(b.x, b.y, b.width, b.height)
  if (style) {
    ctx.save(); ctx.resetTransform(); ctx.globalAlpha = style.base.opacity; ctx.drawImage(paintImage(ctx, style.base, projection, raster), 0, 0); ctx.restore()
    for (const overlay of [...style.overlays].sort((a, b) => a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))) {
      const layer = canvas(ctx.canvas.width, ctx.canvas.height), mask = canvas(ctx.canvas.width, ctx.canvas.height)
      try {
        const layerCtx = context(layer), maskCtx = context(mask), sx = mask.width / b.width, sy = mask.height / b.height
        worldTransform(maskCtx, b, sx, sy); maskCtx.fillStyle = '#fff'
        // A deterministic world-size feather; the owner clip remains authoritative.
        if (overlay.blendWidthMm) maskCtx.filter = `blur(${overlay.blendWidthMm * .5 * Math.max(sx, sy)}px)`
        maskCtx.fill(polygonPath(overlay.boundaryMm)); maskCtx.filter = 'none'
        layerCtx.drawImage(paintImage(ctx, overlay.paint, projection, raster), 0, 0); layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(mask, 0, 0)
        ctx.save(); ctx.resetTransform(); ctx.globalAlpha = overlay.paint.opacity; ctx.drawImage(layer, 0, 0); ctx.restore()
      } finally { disposeCanvas(layer); disposeCanvas(mask) }
    }
  }
  ctx.restore()
}

function drawWallBody(ctx: CanvasRenderingContext2D, projection: ProjectionV2, raster: RasterSetV2, scaleX: number, scaleY: number): void {
  if (!projection.walls.length) return
  const width = ctx.canvas.width, height = ctx.canvas.height, mask = canvas(width, height), color = canvas(width, height), interior = canvas(width, height)
  try {
    const maskCtx = context(mask), colorCtx = context(color), interiorCtx = context(interior), geometry = wallGeometryV2(projection.walls)
    worldTransform(maskCtx, projection.bounds, scaleX, scaleY); worldTransform(colorCtx, projection.bounds, scaleX, scaleY)
    const union = new Path2D()
    for (const item of geometry) {
      const path = new Path2D(); item.polygons.forEach(p => { addRing(path, p); addRing(union, p) })
      fillSurface(colorCtx, path, item.wall.style, projection, raster, '#899087')
    }
    maskCtx.fillStyle = '#fff'; maskCtx.fill(union)
    const shadow = projection.theme?.shadowPresets.wall
    ctx.save(); ctx.resetTransform()
    if (shadow && shadow.opacity > 0) {
      interiorCtx.drawImage(mask, 0, 0); interiorCtx.globalCompositeOperation = 'source-in'; interiorCtx.fillStyle = shadow.color; interiorCtx.fillRect(0, 0, width, height)
      ctx.save(); ctx.globalAlpha = shadow.opacity; ctx.filter = `blur(${shadow.blurMm * Math.max(scaleX, scaleY)}px)`
      const angle = shadow.directionDeg * Math.PI / 180
      ctx.drawImage(interior, Math.cos(angle) * shadow.offsetMm * scaleX, Math.sin(angle) * shadow.offsetMm * scaleY); ctx.restore()
      interiorCtx.globalCompositeOperation = 'source-over'; interiorCtx.clearRect(0, 0, width, height)
    }
    // Erode one union silhouette, so joins and shared-wall pieces have no internal outline seams.
    interiorCtx.drawImage(mask, 0, 0); interiorCtx.globalCompositeOperation = 'destination-in'
    const outline = projection.theme?.outline ?? { widthMm: 24, color: '#39443E' }, radius = outline.widthMm * Math.max(scaleX, scaleY) / 2
    if (radius > 0) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; interiorCtx.drawImage(mask, Math.cos(a) * radius, Math.sin(a) * radius) }
    const outlineCtx = maskCtx; outlineCtx.resetTransform(); outlineCtx.globalCompositeOperation = 'source-in'; outlineCtx.fillStyle = outline.color; outlineCtx.fillRect(0, 0, width, height)
    ctx.drawImage(mask, 0, 0)
    colorCtx.resetTransform(); colorCtx.globalCompositeOperation = 'destination-in'; colorCtx.drawImage(interior, 0, 0); ctx.drawImage(color, 0, 0)
    ctx.restore()
  } finally { disposeCanvas(mask); disposeCanvas(color); disposeCanvas(interior) }
}

function drawOpening(ctx: CanvasRenderingContext2D, opening: ProjectedOpeningV2, wall: ProjectedWallV2, projection: ProjectionV2): void {
  const style = projection.theme?.openingStyle ?? { doorStrokeWidthMm: 24, windowStrokeWidthMm: 18, frameWidthMm: 60, doorFill: '#8B7355', windowFill: '#B2CBCC' }, outline = projection.theme?.outline.color ?? '#39443E'
  ctx.save(); ctx.translate(opening.start.x, opening.start.y); ctx.rotate(Math.atan2(opening.end.y - opening.start.y, opening.end.x - opening.start.x))
  const width = opening.widthMm, half = wall.thicknessMm / 2
  ctx.fillStyle = opening.kind === 'window' ? style.windowFill : style.doorFill; ctx.strokeStyle = outline; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
  // Frames sit on solid wall outside the declared net opening interval.
  if (style.frameWidthMm > 0) { ctx.fillRect(-style.frameWidthMm, -half, style.frameWidthMm, wall.thicknessMm); ctx.fillRect(width, -half, style.frameWidthMm, wall.thicknessMm) }
  if (opening.kind === 'window') {
    ctx.fillRect(0, -half * .58, width, wall.thicknessMm * .58); ctx.lineWidth = style.windowStrokeWidthMm
    ctx.strokeRect(0, -half * .58, width, wall.thicknessMm * .58); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(width, 0); ctx.moveTo(width / 2, -half * .58); ctx.lineTo(width / 2, half * .58); ctx.stroke()
  } else {
    ctx.lineWidth = style.doorStrokeWidthMm
    if (opening.state === 'closed') { ctx.fillRect(0, -style.doorStrokeWidthMm, width, style.doorStrokeWidthMm * 2); ctx.strokeRect(0, -style.doorStrokeWidthMm, width, style.doorStrokeWidthMm * 2) }
    else {
      ctx.fillRect(-style.doorStrokeWidthMm, -width, style.doorStrokeWidthMm * 2, width); ctx.strokeRect(-style.doorStrokeWidthMm, -width, style.doorStrokeWidthMm * 2, width)
      ctx.save(); ctx.globalAlpha = .55; ctx.lineWidth = Math.max(10, style.doorStrokeWidthMm * .6); ctx.setLineDash([55, 45]); ctx.beginPath(); ctx.arc(0, 0, width, -Math.PI / 2, 0); ctx.stroke(); ctx.restore()
    }
    if (opening.secret) { ctx.strokeStyle = '#AD7A42'; ctx.setLineDash([50, 35]); ctx.lineWidth = Math.max(24, style.doorStrokeWidthMm); ctx.beginPath(); ctx.moveTo(0, half + 65); ctx.lineTo(width, half + 65); ctx.stroke() }
  }
  ctx.restore()
}

function symbol(ctx: CanvasRenderingContext2D, prop: PropV2) {
  if (prop.appearance.kind !== 'symbol') return
  const v = prop.visualBoundsMm, kind = prop.appearance.symbol
  ctx.fillStyle = kind === 'rug' ? '#946755' : kind === 'chair' ? '#71865A' : '#8B7355'; ctx.strokeStyle = '#39443E'; ctx.lineWidth = 24
  ctx.fillRect(v.x, v.y, v.width, v.height); ctx.strokeRect(v.x, v.y, v.width, v.height)
  if (kind === 'shelf') for (let x = v.x + 140; x < v.x + v.width - 80; x += 140) { ctx.beginPath(); ctx.moveTo(x, v.y + 60); ctx.lineTo(x, v.y + v.height - 60); ctx.stroke() }
  if (kind === 'crate') { ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + v.width, v.y + v.height); ctx.moveTo(v.x + v.width, v.y); ctx.lineTo(v.x, v.y + v.height); ctx.stroke() }
}
function shadowColor(shadow: ShadowStyle): string { const color = shadow.color; return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${shadow.opacity})` }
function drawProp(ctx: CanvasRenderingContext2D, prop: PropV2, projection: ProjectionV2, raster: RasterSetV2, scaleX: number, scaleY: number): void {
  ctx.save(); ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate(prop.rotationDeg * Math.PI / 180); ctx.globalAlpha = prop.appearance.opacity
  const shadow = prop.shadowOverride ?? projection.theme?.shadowPresets[prop.shadowClass]
  if (shadow && shadow.opacity > 0) {
    const angle = shadow.directionDeg * Math.PI / 180
    // Canvas shadow offsets are device coordinates: rotation affects only the body alpha, never the light direction.
    ctx.shadowColor = shadowColor(shadow); ctx.shadowOffsetX = Math.cos(angle) * shadow.offsetMm * scaleX; ctx.shadowOffsetY = Math.sin(angle) * shadow.offsetMm * scaleY; ctx.shadowBlur = shadow.blurMm * Math.max(scaleX, scaleY)
  }
  const v = prop.visualBoundsMm
  if (prop.appearance.kind === 'image') {
    const bitmap = raster.byAssetId.get(prop.appearance.assetId)
    if (!bitmap) throw new Error('物件所需位图没有完成解码。')
    ctx.drawImage(bitmap, v.x, v.y, v.width, v.height)
  } else symbol(ctx, prop)
  ctx.restore()
}
export function connectionPolygonV2(connection: Pick<ProjectedConnectionV2, 'start' | 'end' | 'widthMm'>): PointMm[] {
  return wallBand(connection.start, connection.end, connection.widthMm)
}
function linePath(a: PointMm, b: PointMm): Path2D { const path = new Path2D(); path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); return path }
function excludeRing(ctx: CanvasRenderingContext2D, ring: PointMm[], bounds: BoundsMm): void {
  const path = new Path2D(); path.rect(bounds.x - 10000, bounds.y - 10000, bounds.width + 20000, bounds.height + 20000); addRing(path, ring); ctx.clip(path, 'evenodd')
}
/** Face thickness follows the real lower side, including canonical sources that are the lower area.
 * This surface decoration is distinct from the independently controlled world-direction shadow. */
export function terrainFaceV2(edge: ProjectedTerrainEdgeV2, projection: Pick<ProjectionV2, 'theme'>): PointMm[] {
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm)
  if (!delta || edge.kind !== 'cliff') return []
  const a = edge.start, b = edge.end, length = Math.hypot(b.x - a.x, b.y - a.y), sign = edge.elevationMm > edge.neighborElevationMm ? 1 : -1
  const cliff = projection.theme?.terrainCliff, width = Math.min(edge.style.bandWidthMm, cliff?.maxOffsetMm ?? 600, Math.round((cliff?.offsetFactor ?? .18) * delta))
  const dx = (b.y - a.y) / length * sign * width, dy = -(b.x - a.x) / length * sign * width
  return width ? [a, b, point(b.x + dx, b.y + dy), point(a.x + dx, a.y + dy)] : []
}
/** A swept edge silhouette, displaced once toward world SE; face-normal offset is not added. */
export function terrainShadowV2(edge: ProjectedTerrainEdgeV2, projection: Pick<ProjectionV2, 'theme'>): PointMm[] {
  const cliff = projection.theme?.terrainCliff
  if (edge.kind !== 'cliff' || !cliff?.opacity) return []
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm), offset = Math.round(Math.min(cliff.maxOffsetMm, cliff.offsetFactor * delta)), angle = cliff.directionDeg * Math.PI / 180
  const dx = Math.cos(angle) * offset, dy = Math.sin(angle) * offset
  return offset ? [edge.start, edge.end, point(edge.end.x + dx, edge.end.y + dy), point(edge.start.x + dx, edge.start.y + dy)] : []
}
function clipConnections(ctx: CanvasRenderingContext2D, projection: ProjectionV2): void {
  for (const c of projection.connections) excludeRing(ctx, connectionPolygonV2(c), projection.bounds)
}
function drawTerrainEdges(ctx: CanvasRenderingContext2D, projection: ProjectionV2, raster: RasterSetV2, sx: number, sy: number): void {
  for (const edge of projection.edges) {
    const path = linePath(edge.start, edge.end), face = terrainFaceV2(edge, projection), shadow = terrainShadowV2(edge, projection), cliff = projection.theme?.terrainCliff
    ctx.save(); clipConnections(ctx, projection)
    if (face.length || shadow.length) {
      const highId = edge.elevationMm > edge.neighborElevationMm ? edge.sourceAreaId : edge.neighborAreaId
      const high = projection.terrain.find(a => a.id === highId)
      ctx.save(); if (high) excludeRing(ctx, high.points, projection.bounds)
      if (cliff && shadow.length) {
        ctx.save(); ctx.filter = `blur(${cliff.blurMm * Math.max(sx, sy)}px)`; ctx.globalAlpha = cliff.opacity; ctx.fillStyle = cliff.color; ctx.fill(polygonPath(shadow)); ctx.restore()
      }
      if (face.length) {
        fillSurface(ctx, polygonPath(face), edge.surfaceStyle, projection, raster, '#525E55')
        ctx.save(); ctx.strokeStyle = '#39443E'; ctx.globalAlpha = .28; ctx.lineWidth = 18; ctx.stroke(linePath(face[3], face[2])); ctx.restore()
      }
      ctx.restore()
    }
    if (edge.kind === 'materialTransition' && edge.style.bandWidthMm > 0) {
      ctx.save(); ctx.globalAlpha = .22; ctx.filter = `blur(${edge.style.bandWidthMm * .3 * Math.max(sx, sy)}px)`; ctx.strokeStyle = edge.style.color; ctx.lineWidth = edge.style.bandWidthMm; ctx.stroke(path); ctx.restore()
      if (edge.surfaceStyle) fillSurface(ctx, polygonPath(wallBand(edge.start, edge.end, edge.style.bandWidthMm)), edge.surfaceStyle, projection, raster, edge.style.color)
    }
    if (edge.style.strokeWidthMm) { ctx.strokeStyle = edge.style.color; ctx.lineWidth = edge.style.strokeWidthMm; ctx.lineCap = 'butt'; ctx.stroke(path) }
    if (edge.shoreline || edge.kind === 'shore') {
      const shore = projection.theme?.edgeStyles.shore ?? { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 }
      const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y, length = Math.hypot(dx, dy)
      const shift = Math.min(shore.bandWidthMm, 180) * .65, nx = dy / length * shift, ny = -dx / length * shift
      ctx.save(); ctx.strokeStyle = shore.color; ctx.lineWidth = shore.strokeWidthMm; ctx.lineCap = 'round'; ctx.setLineDash([145, 90, 65, 115]); ctx.lineDashOffset = -(edge.start.x + edge.start.y) % 415; ctx.stroke(linePath(point(edge.start.x + nx, edge.start.y + ny), point(edge.end.x + nx, edge.end.y + ny))); ctx.restore()
    }
    ctx.restore()
  }
}
function drawConnections(ctx: CanvasRenderingContext2D, projection: ProjectionV2, raster: RasterSetV2): void {
  for (const c of projection.connections) {
    const polygon = connectionPolygonV2(c), path = polygonPath(polygon), length = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y)
    if (!(length > 0)) throw new Error('连接长度必须大于零。')
    ctx.save(); fillSurface(ctx, path, c.style, projection, raster, '#919180'); ctx.clip(path)
    const gradient = ctx.createLinearGradient(c.start.x, c.start.y, c.end.x, c.end.y)
    gradient.addColorStop(0, c.toElevationMm > c.fromElevationMm ? '#24313A44' : '#F2EAD420'); gradient.addColorStop(1, c.toElevationMm > c.fromElevationMm ? '#F2EAD420' : '#24313A44')
    ctx.fillStyle = gradient; ctx.fill(path)
    const dx = (c.end.x - c.start.x) / length, dy = (c.end.y - c.start.y) / length, nx = -dy * c.widthMm / 2, ny = dx * c.widthMm / 2
    ctx.strokeStyle = '#39443E'; ctx.lineWidth = 25; ctx.lineCap = 'butt'; ctx.globalAlpha = .8
    if (c.kind === 'stairs') {
      const count = Math.max(2, Math.min(40, Math.ceil(Math.abs(c.toElevationMm - c.fromElevationMm) / 180)))
      for (let i = 1; i < count; i++) { const x = c.start.x + dx * length * i / count, y = c.start.y + dy * length * i / count; ctx.stroke(linePath(point(x - nx, y - ny), point(x + nx, y + ny))) }
    } else { ctx.setLineDash([110, 85]); ctx.stroke(linePath(c.start, c.end)); ctx.setLineDash([]) }
    ctx.globalAlpha = 1
    if (c.blocksMovement) { const mid = point((c.start.x + c.end.x) / 2, (c.start.y + c.end.y) / 2); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 85; ctx.stroke(linePath(point(mid.x - nx, mid.y - ny), point(mid.x + nx, mid.y + ny))) }
    ctx.restore(); ctx.save(); ctx.strokeStyle = '#39443E'; ctx.lineWidth = 24; ctx.stroke(linePath(polygon[0], polygon[3])); ctx.stroke(linePath(polygon[1], polygon[2])); ctx.restore()
  }
}
function drawProjection(ctx: CanvasRenderingContext2D, projection: ProjectionV2, raster: RasterSetV2, signal?: AbortSignal) {
  const bounds = projection.bounds, sx = ctx.canvas.width / bounds.width, sy = ctx.canvas.height / bounds.height
  ctx.fillStyle = '#D8D5C5'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  worldTransform(ctx, bounds, sx, sy)
  for (const area of projection.terrain) fillSurface(ctx, polygonPath(area.points), area.style, projection, raster, '#C3BEA8')
  drawTerrainEdges(ctx, projection, raster, sx, sy)
  drawConnections(ctx, projection, raster)
  for (const room of projection.rooms) fillSurface(ctx, polygonPath(room.points), room.style, projection, raster, '#B9AA88')
  for (const prop of orderedPropsV2(projection.props).filter(p => p.renderLayer === 'ground')) drawProp(ctx, prop, projection, raster, sx, sy)
  checkCancelled(signal)
  drawWallBody(ctx, projection, raster, sx, sy)
  for (const wall of projection.walls) for (const opening of wall.openings) drawOpening(ctx, opening, wall, projection)
  for (const prop of orderedPropsV2(projection.props).filter(p => p.renderLayer !== 'ground')) drawProp(ctx, prop, projection, raster, sx, sy)
  for (const region of projection.regions) {
    ctx.save(); ctx.strokeStyle = region.kind === 'hazard' ? '#9A674A' : '#71865A'; ctx.lineWidth = 18; ctx.setLineDash([85, 65]); ctx.stroke(polygonPath(region.points)); ctx.restore()
  }
  if (projection.gridSizeMm) {
    const grid = projection.gridSizeMm, lines = bounds.width / grid + bounds.height / grid
    if (lines > 12_000) throw new Error('格线密度超过绘制预算，请关闭格线或增大网格。')
    ctx.save(); ctx.strokeStyle = '#39443E'; ctx.globalAlpha = .13; ctx.lineWidth = 1 / Math.max(sx, sy); ctx.beginPath()
    for (let x = Math.ceil(bounds.x / grid) * grid; x <= bounds.x + bounds.width; x += grid) { ctx.moveTo(x, bounds.y); ctx.lineTo(x, bounds.y + bounds.height) }
    for (let y = Math.ceil(bounds.y / grid) * grid; y <= bounds.y + bounds.height; y += grid) { ctx.moveTo(bounds.x, y); ctx.lineTo(bounds.x + bounds.width, y) }
    ctx.stroke(); ctx.restore()
  }
  for (const note of projection.notes) {
    ctx.save(); ctx.translate(note.positionMm.x, note.positionMm.y); ctx.font = '500 155px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const text = [...note.text].slice(0, note.kind === 'label' ? 50 : 36).join(''), textWidth = Math.min(4600, ctx.measureText(text).width)
    ctx.fillStyle = '#F2EAD4'; ctx.globalAlpha = .94; ctx.fillRect(-textWidth / 2 - 75, -110, textWidth + 150, 220); ctx.globalAlpha = 1; ctx.fillStyle = note.visibility === 'gm' ? '#8B683F' : '#39443E'; ctx.fillText(text, 0, 0, 4600); ctx.restore()
  }
  checkCancelled(signal)
  // Fixed opaque masks are the last operation, covering labels, grid, image alpha and every derived shadow.
  if (projection.audience === 'player') { ctx.save(); ctx.fillStyle = '#D8D5C5'; for (const mask of projection.masks) { const b = pointsBoundsV2(mask); ctx.fillRect(b.x, b.y, b.width, b.height) } ctx.restore() }
  ctx.resetTransform()
}

/** Preview and PNG share this projection and renderer; each call owns and closes its decoded bitmaps. */
export async function renderProjectV2(project: CompleteProjectV2, options: RenderOptionsV2): Promise<HTMLCanvasElement> {
  options = { ...options }
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE_V2) throw new Error('图片长边须为 256–4096 整数像素。')
  const validated = validateSceneV2(project.document)
  if (!validated.ok) throw new Error(`场景不能绘制：${validated.errors[0]?.message ?? '结构不合法。'}`)
  const snapshot: CompleteProjectV2 = { ...project, document: validated.document, assets: Object.fromEntries(Object.entries(project.assets).map(([hash, resource]) => [hash, { ...resource }])) }
  const projection = projectSceneV2(snapshot.document, options.audience)
  if (projection.limitations.length) throw new Error(projection.limitations.join(' '))
  const ratio = options.longEdgePx / Math.max(projection.bounds.width, projection.bounds.height), width = Math.max(1, Math.round(projection.bounds.width * ratio)), height = Math.max(1, Math.round(projection.bounds.height * ratio))
  if (width * height > PNG_MAX_PIXELS_V2) throw new Error('图片超过 16M 像素预算。')
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('图片绘制需要支持真实位图解码与 Canvas 的浏览器。')
  const raster = await decodeRequired(snapshot, projection, options.signal)
  let output: HTMLCanvasElement | undefined
  try {
    checkCancelled(options.signal); output = canvas(width, height); drawProjection(context(output), projection, raster, options.signal); checkCancelled(options.signal); return output
  } catch (error) { if (output) disposeCanvas(output); throw error }
  finally { raster.bitmaps.forEach(bitmap => bitmap.close()); if (raster.paintCache) disposeCanvas(raster.paintCache.image) }
}

export async function exportPngV2(project: CompleteProjectV2, options: RenderOptionsV2): Promise<Blob> {
  options = { ...options }
  const output = await renderProjectV2(project, options)
  try {
    checkCancelled(options.signal)
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(result => result ? resolve(result) : reject(new Error('PNG 编码失败，请降低输出尺寸。')), 'image/png'))
    checkCancelled(options.signal)
    return blob
  } finally { disposeCanvas(output) }
}
