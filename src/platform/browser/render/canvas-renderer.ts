import { effectivePropShadow, presentationBounds, presentationContact, presentationShadow, propShadowDirection } from '../../../shared/appearance/presentation.js'
import { propPresentationEnvelope } from '../../../shared/projection/presentation-contract.js'
import { drawVisualAtmosphere, drawVisualBoundaries, drawVisualContacts, drawVisualEntity } from './visual-renderer'
import { pathJunctionOutlines } from './path-junctions.js'
import type { BoundsMm, MaterialPaint, PointMm, Prop, ShadowStyle, SurfaceOverlay, SurfaceStyle } from '../../../shared/model/scene.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { drawRegionalProjection } from './regional-renderer.js'
import { inspectImageBytes, normalizePngChunks } from '../../../shared/project/image-bytes.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { withRenderDecoderSlot } from './image-decoder'
import type { AssetRecord, ResourceBytePort } from '../../../shared/model/project.js'
import type { AssetRef } from '../../../shared/model/scene.js'
import { pointsBounds } from './geometry'
import type { Audience, ProjectedConnection, ProjectedDecoration, ProjectedOpening, ProjectedSurface, ProjectedTerrainEdge, ProjectedWall, Projection } from '../../../shared/projection/types.js'
import { decorationPaintBounds } from '../../../shared/decorations/presentation.js'
import { createEditorRenderPlan, editorPaintBounds } from './editor-render-plan'
import type { EditorPropDetail } from './editor-render-plan'
import { boundaryConnections, clipConnectionOpenings, connectionFrame, connectionSideSegments, drawConnectionCheeks } from './connection-geometry'
import { polylineBand, connectionBand } from '../../../shared/geometry/geometry.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { connectionLandingBlend, connectionLandingDepthMm } from '../../../shared/geometry/connection-landings.js'
import { naturalRockTreads } from './cliff-relief.js'
import { drawNaturalRockSteps } from './natural-rock-steps.js'
import { drawNaturalRockStepsV4 } from './natural-rock-steps-v4.js'
import { drawTerracedRockSteps } from './terraced-rock-steps.js'
import { planRockStepSideMask } from './rock-step-surface-mask.js'
import { paintConnectionLandingMask } from './connection-landing-mask.js'
import { editorResidentAssetIds } from './aggregate-residency.js'
import { paintWithPreservedAlpha } from './alpha-preservation.js'

/** Immutable asset references plus per-call shallow-copied resource records. No SceneDocument is accepted. */
export interface RasterSources {
  assetRefs: Record<string, AssetRef>
  assets: Record<string, AssetRecord>
  resources: ResourceBytePort
}

/** Monotonic elapsed milliseconds for one successful render, not GPU completion or memory peaks. */
export interface RenderMetrics {
  /** Strict document validation or certified immutable-snapshot reuse, then projection and output/support checks. */
  validationProjectionMs: number
  /** Resource-record checks plus Blob reads, header/CRC inspection and SHA-256; summed across projected assets. */
  resourceVerificationMs: number
  /** Elapsed wait for the shared validation/normalization/render decoder slot. */
  decoderQueueWaitMs: number
  /** Elapsed createImageBitmap calls, summed across unique SHA-256 resources. */
  imageDecodeMs: number
  /** Synchronous drawing only, including editor crop copy; excludes canvas/context allocation. */
  drawSubmissionMs: number
  /** Includes temporary-resource cleanup; excludes observer and PNG encoding. Phases need not sum to this value. */
  totalMs: number
  decodedImages: number
  decodedPixels: number
  width: number
  height: number
  audience: Audience
  floorId?: string
}
export interface RenderOptions {
  audience: Audience; longEdgePx: number; signal?: AbortSignal
  /** Explicit output target; legacy single-Floor calls may omit it. */
  floorId?: string
  /** Called once after a successful render and temporary-resource cleanup; observer errors are ignored. PNG encoding is excluded. */
  onMetrics?: (metrics: RenderMetrics) => void
  /** Native output stages only; observers receive no reusable pixel data. */
  onPngMetrics?: (metrics: PngMetrics) => void
}
export interface PngMetrics { mode: 'native'; encodeMs: number; submitMs: number; callbackWaitMs: number; readBytesMs: number; normalizeMs: number; totalMs: number; byteLength: number }
export interface EditorRenderOptions extends RenderOptions {
  viewBoundsMm?: BoundsMm
  screenScalePxPerMm?: number
  /** GM-only transient ground inspection; never persisted or exported. */
  groundView?: boolean
}
export const EDITOR_MAX_LONG_EDGE = 2048
export const PNG_MAX_LONG_EDGE = 4096
export const PNG_MAX_PIXELS = 16_777_216
// RGBA8 scanlines including their filter bytes, zlib compressBound overhead,
// and 1 MiB for PNG chunks. This exceeds a worst-case 4K Canvas encoding without
// applying the separate 20 MiB per-asset import limit to a complete map export.
const PNG_SCANLINE_BYTES = PNG_MAX_PIXELS * 4 + PNG_MAX_LONG_EDGE
export const PNG_MAX_ENCODED_BYTES = PNG_SCANLINE_BYTES + Math.floor(PNG_SCANLINE_BYTES / 4096)
  + Math.floor(PNG_SCANLINE_BYTES / 16384) + Math.floor(PNG_SCANLINE_BYTES / 33554432) + 13 + 1024 * 1024
export interface WallGeometry { wall: ProjectedWall; polygons: PointMm[][] }
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
export function wallGeometry(walls: ProjectedWall[]): WallGeometry[] {
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
function context(canvas: HTMLCanvasElement, readFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readFrequently ? { colorSpace: 'srgb', willReadFrequently: true } : { colorSpace: 'srgb' })
  if (!ctx) throw new Error('无法分配 sRGB Canvas；请降低输出尺寸后重试。')
  return ctx
}
const disposeCanvas = (value: HTMLCanvasElement) => { value.width = 0; value.height = 0 }
function addRing(path: Path2D, points: PointMm[]): void {
  positiveRing(points).forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath()
}
function polygonPath(points: PointMm[]): Path2D { const path = new Path2D(); addRing(path, points); return path }
function worldTransform(ctx: CanvasRenderingContext2D, bounds: BoundsMm, scaleX: number, scaleY: number) { ctx.setTransform(scaleX, 0, 0, scaleY, -bounds.x * scaleX, -bounds.y * scaleY) }

interface RasterSet { bitmaps: Map<string, ImageBitmap>; byAssetId: Map<string, ImageBitmap>; paintCache?: { key: string; image: HTMLCanvasElement }; readFrequently?: boolean }
async function decodeRequired(sources: RasterSources, projection: Projection, signal?: AbortSignal, metrics?: Pick<RenderMetrics, 'resourceVerificationMs' | 'decoderQueueWaitMs' | 'imageDecodeMs'>, residentAssetIds?: ReadonlySet<string>): Promise<RasterSet> {
  const bitmaps = new Map<string, ImageBitmap>(), byAssetId = new Map<string, ImageBitmap>(); let totalPixels = 0
  const verifiedHashes = new Set<string>()
  try {
    for (const id of projection.assetIds) {
      checkCancelled(signal)
      const verificationStarted = metrics ? performance.now() : 0
      const ref = sources.assetRefs[id], resource = ref && sources.assets[ref.sha256]
      if (!ref || !resource) throw new Error(`绘制所需素材 ${id} 缺失，无法生成完整图片。`)
      if (ref.sha256 !== resource.sha256 || ref.mimeType !== resource.mimeType || ref.pixelWidth !== resource.pixelWidth || ref.pixelHeight !== resource.pixelHeight) throw new Error(`素材 ${id} 的字节记录与工程不一致。`)
      const cached = bitmaps.get(ref.sha256)
      if (cached) { byAssetId.set(id, cached); if (metrics) metrics.resourceVerificationMs += performance.now() - verificationStarted; continue }
      const bytes = (await sources.resources.read(ref.sha256)).slice(); checkCancelled(signal)
      const header = inspectImageBytes(bytes)
      if (bytes.length !== resource.sizeBytes || header.mimeType !== ref.mimeType || header.width !== ref.pixelWidth || header.height !== ref.pixelHeight || await sha256Bytes(bytes) !== ref.sha256) throw new Error(`素材 ${id} 的实际格式、尺寸或 hash 不匹配。`)
      checkCancelled(signal)
      if (!verifiedHashes.has(ref.sha256)) { verifiedHashes.add(ref.sha256); totalPixels += header.width * header.height }
      if (verifiedHashes.size > PACKAGE_LIMITS.uniqueImages || totalPixels > PACKAGE_LIMITS.totalImagePixels) throw new Error('绘制素材超过候选解码预算。')
      if (metrics) metrics.resourceVerificationMs += performance.now() - verificationStarted
      if (residentAssetIds && !residentAssetIds.has(id)) continue
      const queuedStarted = metrics ? performance.now() : 0
      let bitmap: ImageBitmap
      try {
        bitmap = await withRenderDecoderSlot(signal, async () => {
          const decodeStarted = metrics ? performance.now() : 0
          if (metrics) metrics.decoderQueueWaitMs += decodeStarted - queuedStarted
          try { return await createImageBitmap(new Blob([bytes.slice().buffer], { type: resource.mimeType }), { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' }) }
          finally { if (metrics) metrics.imageDecodeMs += performance.now() - decodeStarted }
        })
      } catch { checkCancelled(signal); throw new Error(`素材 ${id} 实际解码失败，已停止出图。`) }
      if (signal?.aborted) { bitmap.close(); checkCancelled(signal) }
      if (bitmap.width !== ref.pixelWidth || bitmap.height !== ref.pixelHeight) { bitmap.close(); throw new Error(`素材 ${id} 的实际解码尺寸不符。`) }
      bitmaps.set(ref.sha256, bitmap); byAssetId.set(id, bitmap)
    }
    return { bitmaps, byAssetId }
  } catch (error) { bitmaps.forEach(bitmap => bitmap.close()); throw error }
}

function paintImage(ctx: CanvasRenderingContext2D, paint: MaterialPaint, projection: Projection, raster: RasterSet): HTMLCanvasElement {
  const material = projection.materials[paint.materialRef.id], bitmap = material && raster.byAssetId.get(material.textureAssetId)
  if (!bitmap) throw new Error('铺装所需位图没有完成解码。')
  const key = JSON.stringify([paint, projection.bounds, ctx.canvas.width, ctx.canvas.height])
  if (raster.paintCache?.key !== key) {
    if (raster.paintCache) disposeCanvas(raster.paintCache.image)
    const image = canvas(ctx.canvas.width, ctx.canvas.height)
    // Own the surface before setup; a synchronous paint failure aborts this render and its finally releases it.
    raster.paintCache = { key, image }
    const imageCtx = context(image, raster.readFrequently), pattern = imageCtx.createPattern(bitmap, 'repeat')
    if (!pattern) throw new Error('无法建立重复材质。')
    // Full fixed-view rasterization keeps texture phase independent of clipping and mutable bounds.
    const b = projection.bounds
    worldTransform(imageCtx, b, image.width / b.width, image.height / b.height)
    pattern.setTransform(new DOMMatrix().translate(paint.originMm.x, paint.originMm.y).rotate(paint.rotationDeg).scale(paint.tileSizeMm.width / bitmap.width, paint.tileSizeMm.height / bitmap.height))
    imageCtx.fillStyle = pattern; imageCtx.fillRect(b.x, b.y, b.width, b.height)
    if (paint.tint) { imageCtx.globalCompositeOperation = 'multiply'; imageCtx.fillStyle = paint.tint; imageCtx.fillRect(b.x, b.y, b.width, b.height); imageCtx.globalCompositeOperation = 'source-over' }
  }
  return raster.paintCache.image
}
/** The same even-odd world-space mask is used for every disconnected patch and hole. */
export function drawSurfaceRuleMask(ctx: CanvasRenderingContext2D, bounds: BoundsMm, widthPx: number, heightPx: number,
  regions: NonNullable<ProjectedSurface['materialPatches']>[number]['regionsMm'], blendWidthMm: number): void {
  const path = new Path2D()
  for (const region of regions) { addRing(path, region.outerMm); for (const hole of region.holesMm) addRing(path, hole) }
  const sx = widthPx / bounds.width, sy = heightPx / bounds.height
  worldTransform(ctx, bounds, sx, sy); ctx.fillStyle = '#fff'
  if (blendWidthMm) ctx.filter = `blur(${blendWidthMm * .5 * Math.max(sx, sy)}px)`
  ctx.fill(path, 'evenodd'); ctx.filter = 'none'
}
function fillSurface(ctx: CanvasRenderingContext2D, path: Path2D, style: SurfaceStyle | null, projection: Projection, raster: RasterSet, fallback: string, materialPatches: ProjectedSurface['materialPatches'] = []): void {
  ctx.save(); ctx.clip(path); ctx.fillStyle = fallback
  const b = projection.bounds; ctx.fillRect(b.x, b.y, b.width, b.height)
  if (style) {
    ctx.save(); ctx.resetTransform(); ctx.globalAlpha = style.base.opacity; ctx.drawImage(paintImage(ctx, style.base, projection, raster), 0, 0); ctx.restore()
  }
    for (const overlay of [...(style?.overlays ?? [])].sort((a, b) => a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))) drawOverlay(overlay)
    for (const overlay of materialPatches) drawOverlay(overlay)
    function drawOverlay(overlay: SurfaceOverlay | NonNullable<ProjectedSurface['materialPatches']>[number]): void {
      const layer = canvas(ctx.canvas.width, ctx.canvas.height), mask = canvas(ctx.canvas.width, ctx.canvas.height)
      try {
        const layerCtx = context(layer, raster.readFrequently), maskCtx = context(mask, raster.readFrequently), sx = mask.width / b.width, sy = mask.height / b.height
        worldTransform(maskCtx, b, sx, sy); maskCtx.fillStyle = '#fff'
        // A deterministic world-size feather; the owner clip remains authoritative.
        if ('regionsMm' in overlay) {
          drawSurfaceRuleMask(maskCtx, b, mask.width, mask.height, overlay.regionsMm, overlay.blendWidthMm)
        } else {
          if (overlay.blendWidthMm) maskCtx.filter = `blur(${overlay.blendWidthMm * .5 * Math.max(sx, sy)}px)`
          maskCtx.fill(polygonPath(overlay.boundaryMm)); maskCtx.filter = 'none'
        }
        layerCtx.drawImage(paintImage(ctx, overlay.paint, projection, raster), 0, 0); layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(mask, 0, 0)
        ctx.save(); ctx.resetTransform(); ctx.globalAlpha = overlay.paint.opacity; ctx.drawImage(layer, 0, 0); ctx.restore()
      } finally { disposeCanvas(layer); disposeCanvas(mask) }
    }
  ctx.restore()
}

/** Equal opaque floor paints share one clip, so a shared edge is covered once.
 * Different paints and per-entity/layer filters keep the projection's order. */
function drawRoomFloors(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet): void {
  const filtered = new Set(projection.visual?.filters.flatMap(filter => filter.sourceEntityIds ?? []) ?? [])
  let batch: ProjectedSurface[] = [], key: string | undefined
  const flush = () => {
    if (batch.length) {
      const path = new Path2D()
      // Even one compound clip can round shared endpoints differently when
      // its subpaths follow random entity IDs. Equal paints have no visual
      // order to preserve inside this batch; use their geometry instead.
      batch.sort((a, b) => JSON.stringify(a.points).localeCompare(JSON.stringify(b.points)))
      for (const room of batch) addRing(path, room.points)
      fillSurface(ctx, path, batch[0].style, projection, raster, '#B9AA88')
    }
    batch = []; key = undefined
  }
  for (const room of projection.rooms) {
    if (filtered.has(room.id)) {
      flush()
      drawVisualEntity(ctx, projection, room.id, expandedBounds(room.points, 0), (target, local) => fillSurface(target, polygonPath(room.points), room.style, local, raster, '#B9AA88'), !!raster.readFrequently)
      continue
    }
    const nextKey = JSON.stringify(room.style)
    if (key !== nextKey) { flush(); key = nextKey }
    batch.push(room)
  }
  flush()
}

function drawWallBody(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, scaleX: number, scaleY: number, geometry: WallGeometry[]): void {
  if (!geometry.length) return
  const outline = projection.theme?.outline ?? { widthMm: 24, color: '#39443E' }
  const shadowSource = projection.theme?.shadowPresets.wall
  const shadow = shadowSource && projection.visual ? { ...shadowSource, directionDeg: projection.visual.environment.lightDirectionDeg } : shadowSource
  const needsSilhouette = outline.widthMm !== 0 || !!shadow && shadow.opacity > 0
  const width = ctx.canvas.width, height = ctx.canvas.height, color = canvas(width, height)
  let mask: HTMLCanvasElement | undefined, interior: HTMLCanvasElement | undefined
  try {
    const colorCtx = context(color, raster.readFrequently)
    worldTransform(colorCtx, projection.bounds, scaleX, scaleY)
    const union = needsSilhouette ? new Path2D() : undefined
    for (const item of geometry) {
      const path = new Path2D(); item.polygons.forEach(p => { addRing(path, p); if (union) addRing(union, p) })
      drawVisualEntity(colorCtx, projection, item.wall.id, expandedBounds(item.polygons.flat(), 0), (target, local) => fillSurface(target, path, item.wall.style, local, raster,
        outline.widthMm === 0 && item.wall.style ? '#00000000' : '#899087'), !!raster.readFrequently)
    }
    // Source-faithful walls need only their color buffer when neither an
    // outline nor a wall shadow consumes the full-canvas silhouette.
    if (!union) { ctx.save(); ctx.resetTransform(); ctx.drawImage(color, 0, 0); ctx.restore(); return }
    mask = canvas(width, height); interior = canvas(width, height)
    const maskCtx = context(mask, raster.readFrequently), interiorCtx = context(interior, raster.readFrequently)
    worldTransform(maskCtx, projection.bounds, scaleX, scaleY)
    maskCtx.fillStyle = '#fff'; maskCtx.fill(union)
    ctx.save(); ctx.resetTransform()
    if (shadow && shadow.opacity > 0) {
      interiorCtx.drawImage(mask, 0, 0); interiorCtx.globalCompositeOperation = 'source-in'; interiorCtx.fillStyle = shadow.color; interiorCtx.fillRect(0, 0, width, height)
      ctx.save(); ctx.globalAlpha = shadow.opacity; ctx.filter = `blur(${shadow.blurMm * Math.max(scaleX, scaleY)}px)`
      const angle = shadow.directionDeg * Math.PI / 180
      ctx.drawImage(interior, Math.cos(angle) * shadow.offsetMm * scaleX, Math.sin(angle) * shadow.offsetMm * scaleY); ctx.restore()
      interiorCtx.globalCompositeOperation = 'source-over'; interiorCtx.clearRect(0, 0, width, height)
    }
    // Zero outline means no silhouette underpaint or second alpha mask. Either
    // would darken antialiased edges even with width zero and change source art.
    if (outline.widthMm === 0) { ctx.drawImage(color, 0, 0); ctx.restore(); return }
    // Erode one union silhouette, so joins and shared-wall pieces have no internal outline seams.
    interiorCtx.drawImage(mask, 0, 0); interiorCtx.globalCompositeOperation = 'destination-in'
    const radius = outline.widthMm * Math.max(scaleX, scaleY) / 2
    if (radius > 0) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; interiorCtx.drawImage(mask, Math.cos(a) * radius, Math.sin(a) * radius) }
    const outlineCtx = maskCtx; outlineCtx.resetTransform(); outlineCtx.globalCompositeOperation = 'source-in'; outlineCtx.fillStyle = outline.color; outlineCtx.fillRect(0, 0, width, height)
    ctx.drawImage(mask, 0, 0)
    colorCtx.resetTransform(); colorCtx.globalCompositeOperation = 'destination-in'; colorCtx.drawImage(interior, 0, 0); ctx.drawImage(color, 0, 0)
    ctx.restore()
  } finally { if (mask) disposeCanvas(mask); disposeCanvas(color); if (interior) disposeCanvas(interior) }
}

function drawOpening(ctx: CanvasRenderingContext2D, opening: ProjectedOpening, wall: ProjectedWall, projection: Projection): void {
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

function symbol(ctx: CanvasRenderingContext2D, prop: Prop) {
  if (prop.appearance.kind !== 'symbol') return
  const v = prop.visualBoundsMm, kind = prop.appearance.symbol
  ctx.fillStyle = kind === 'rug' ? '#946755' : kind === 'chair' ? '#71865A' : '#8B7355'; ctx.strokeStyle = '#39443E'; ctx.lineWidth = 24
  ctx.fillRect(v.x, v.y, v.width, v.height); ctx.strokeRect(v.x, v.y, v.width, v.height)
  if (kind === 'shelf') for (let x = v.x + 140; x < v.x + v.width - 80; x += 140) { ctx.beginPath(); ctx.moveTo(x, v.y + 60); ctx.lineTo(x, v.y + v.height - 60); ctx.stroke() }
  if (kind === 'crate') { ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + v.width, v.y + v.height); ctx.moveTo(v.x + v.width, v.y); ctx.lineTo(v.x, v.y + v.height); ctx.stroke() }
}
function expandedBounds(points: PointMm[], padding: number): BoundsMm {
  const bounds = pointsBounds(points)
  return { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 }
}
function shadowColor(shadow: ShadowStyle): string { const color = shadow.color; return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${shadow.opacity})` }
/** Near-side art casts a dedicated ground shape, never a flattened upright alpha. */
function drawNearSideShadow(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, sx: number, sy: number): void {
  const presentation = projection.propPresentations?.[prop.id], source = effectivePropShadow(prop, presentation, projection.theme?.shadowPresets[prop.shadowClass])
  if (presentation?.mode !== 'nearSide' || !source) return
  ctx.save()
  const direction = propShadowDirection(prop, source, projection.visual?.environment.lightDirectionDeg)
  const ring = presentationShadow(prop, presentation, direction, source.offsetMm)
  if (ring.length && source?.opacity) {
    ctx.globalAlpha = source.opacity * prop.appearance.opacity; ctx.fillStyle = source.color
    ctx.filter = `blur(${source.blurMm * Math.max(sx, sy)}px)`; ctx.fill(polygonPath(ring)); ctx.filter = 'none'
  }
  // A root contact is a physical footprint, independent of the northward canopy.
  const contact = projection.visual?.environment, contactPoints = presentationContact(prop, presentation)
  if (contact?.contactShadowOpacity && contactPoints.length) {
    ctx.globalAlpha = contact.contactShadowOpacity * prop.appearance.opacity; ctx.fillStyle = source?.color ?? '#263C30'
    ctx.filter = `blur(${contact.contactShadowMm * Math.max(sx, sy)}px)`
    ctx.fill(polygonPath(contactPoints)); ctx.filter = 'none'
  }
  ctx.restore()
}
function drawPropBody(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, raster: RasterSet, scaleX: number, scaleY: number, detail: EditorPropDetail = 'full', castShadow = true): void {
  const presentation = projection.propPresentations?.[prop.id]
  if (presentation?.mode === 'nearSide' && castShadow && detail === 'full') drawNearSideShadow(ctx, prop, projection, scaleX, scaleY)
  ctx.save(); ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate((presentation?.mode === 'nearSide' ? 0 : prop.rotationDeg) * Math.PI / 180); ctx.globalAlpha = prop.appearance.opacity * (projection.groundView && presentation?.mode === 'nearSide' && prop.renderLayer === 'canopy' ? .16 : 1)
  const shadowSource = effectivePropShadow(prop, presentation, projection.theme?.shadowPresets[prop.shadowClass])
  const shadow = shadowSource ? { ...shadowSource, directionDeg: propShadowDirection(prop, shadowSource, projection.visual?.environment.lightDirectionDeg) } : null
  if (presentation?.mode !== 'nearSide' && castShadow && detail === 'full' && shadow && shadow.opacity > 0) {
    const angle = shadow.directionDeg * Math.PI / 180
    // Canvas shadow offsets are device coordinates: rotation affects only the body alpha, never the light direction.
    ctx.shadowColor = shadowColor(shadow); ctx.shadowOffsetX = Math.cos(angle) * shadow.offsetMm * scaleX; ctx.shadowOffsetY = Math.sin(angle) * shadow.offsetMm * scaleY; ctx.shadowBlur = shadow.blurMm * Math.max(scaleX, scaleY)
  }
  const v = presentationBounds(prop, presentation)
  if (detail === 'outline') {
    ctx.strokeStyle = '#55614F'; ctx.fillStyle = '#A79878'; ctx.lineWidth = 1 / Math.max(scaleX, scaleY)
    ctx.globalAlpha = prop.appearance.opacity * .65; ctx.fillRect(v.x, v.y, v.width, v.height)
    ctx.globalAlpha = prop.appearance.opacity; ctx.strokeRect(v.x, v.y, v.width, v.height)
  } else if (prop.appearance.kind === 'image') {
    const bitmap = raster.byAssetId.get(prop.appearance.assetId)
    if (!bitmap) throw new Error('物件所需位图没有完成解码。')
    ctx.drawImage(bitmap, v.x, v.y, v.width, v.height)
  } else symbol(ctx, prop)
  ctx.restore()
}
function drawProp(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, raster: RasterSet, scaleX: number, scaleY: number, detail: EditorPropDetail = 'full'): void {
  const clipped = raster.readFrequently && prop.appearance.kind === 'image'
  if (!projection.visual && !clipped) { drawPropBody(ctx, prop, projection, raster, scaleX, scaleY, detail); return }
  const envelope = propPresentationEnvelope(projection, prop, { full: detail === 'full', outlinePaddingMm: detail === 'outline' ? .5 / Math.max(scaleX, scaleY) : 0 })
  // Canvas may defer thousands of blurred sprites until PNG readback. Bound
  // each formal software-raster draw to its complete body/shadow envelope so
  // native shadow processing need not consider the whole output surface.
  // Round outward in device pixels and leave two extra pixels for sampling.
  if (clipped) ctx.save()
  try {
    if (clipped) {
      const b = envelope.boundsMm, origin = projection.bounds
      // Filtered ground polygons must retain the full surface's top-left
      // origin; moving it changes native blur rounding. Crop their far edges
      // only. Ordinary Canvas image shadows can use all four finite edges.
      const nearSide = projection.propPresentations?.[prop.id]?.mode === 'nearSide'
      const left = nearSide ? 0 : Math.floor((b.x - origin.x) * scaleX) - 2, top = nearSide ? 0 : Math.floor((b.y - origin.y) * scaleY) - 2
      const right = Math.ceil((b.x + b.width - origin.x) * scaleX) + 2, bottom = Math.ceil((b.y + b.height - origin.y) * scaleY) + 2
      const transform = ctx.getTransform()
      ctx.resetTransform(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip(); ctx.setTransform(transform)
    }
    if (!projection.visual) drawPropBody(ctx, prop, projection, raster, scaleX, scaleY, detail)
    else drawVisualEntity(ctx, projection, prop.id, envelope.boundsMm, (target, local) => drawPropBody(target, prop, local, raster, scaleX, scaleY, detail), !!raster.readFrequently)
  } finally { if (clipped) ctx.restore() }
}
function drawDecoration(ctx: CanvasRenderingContext2D, value: ProjectedDecoration, projection: Projection, raster: RasterSet): void {
  const bitmap = raster.byAssetId.get(value.assetId)
  if (!bitmap) throw new Error('轻量装饰所需位图没有完成解码。')
  drawVisualEntity(ctx, projection, value.id, decorationPaintBounds(value), target => {
    target.save()
    try {
      target.translate(value.positionMm.x, value.positionMm.y); target.rotate(value.rotationDeg * Math.PI / 180); target.globalAlpha = value.opacity
      const bounds = value.visualBoundsMm; target.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height)
    } finally { target.restore() }
  }, !!raster.readFrequently)
}
export function connectionPolygon(connection: Pick<ProjectedConnection, 'start' | 'end' | 'widthMm' | 'route'>): PointMm[] {
  return connection.route ? connectionBand(connection.route.centerlineMm, connection.widthMm) : wallBand(connection.start, connection.end, connection.widthMm)
}
function linePath(a: PointMm, b: PointMm): Path2D { const path = new Path2D(); path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); return path }
function excludeRing(ctx: CanvasRenderingContext2D, ring: PointMm[], bounds: BoundsMm): void {
  const path = new Path2D(); path.rect(bounds.x - 10000, bounds.y - 10000, bounds.width + 20000, bounds.height + 20000); addRing(path, ring); ctx.clip(path, 'evenodd')
}
/** Face thickness follows the real lower side, including canonical sources that are the lower area.
 * This surface decoration is distinct from the independently controlled world-direction shadow. */
export function terrainFace(edge: ProjectedTerrainEdge, projection: Pick<Projection, 'theme'>): PointMm[] {
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm)
  if (!delta || edge.kind !== 'cliff') return []
  const a = edge.start, b = edge.end, length = Math.hypot(b.x - a.x, b.y - a.y), sign = edge.elevationMm > edge.neighborElevationMm ? 1 : -1
  const cliff = projection.theme?.terrainCliff, width = Math.min(edge.style.bandWidthMm, cliff?.maxOffsetMm ?? 600, Math.round((cliff?.offsetFactor ?? .18) * delta))
  const dx = (b.y - a.y) / length * sign * width, dy = -(b.x - a.x) / length * sign * width
  return width ? [a, b, point(b.x + dx, b.y + dy), point(a.x + dx, a.y + dy)] : []
}
/** A swept edge silhouette, displaced once toward world SE; face-normal offset is not added. */
export function terrainShadow(edge: ProjectedTerrainEdge, projection: Pick<Projection, 'theme' | 'visual'>): PointMm[] {
  const cliff = projection.theme?.terrainCliff
  if (edge.kind !== 'cliff' || !cliff?.opacity) return []
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm), offset = Math.round(Math.min(cliff.maxOffsetMm, cliff.offsetFactor * delta))
  const direction = projection.visual?.environment.lightDirectionDeg ?? cliff.directionDeg
  const dx = Math.cos(direction * Math.PI / 180) * offset, dy = Math.sin(direction * Math.PI / 180) * offset
  return offset ? [edge.start, edge.end, point(edge.end.x + dx, edge.end.y + dy), point(edge.start.x + dx, edge.start.y + dy)] : []
}
function cliffFacePaint(ctx: CanvasRenderingContext2D, face: PointMm[], edge: ProjectedTerrainEdge,
  projection: Projection, raster: RasterSet): void {
  const path = polygonPath(face)
  fillSurface(ctx, path, edge.surfaceStyle, projection, raster, '#777D72')
  if (face.length !== 4) return
  const [topStart, topEnd, footEnd, footStart] = face
  const midpoint = (a: PointMm, b: PointMm): PointMm => point((a.x + b.x) / 2, (a.y + b.y) / 2)
  const top = midpoint(topStart, topEnd), foot = midpoint(footStart, footEnd)
  const gradient = ctx.createLinearGradient(top.x, top.y, foot.x, foot.y)
  gradient.addColorStop(0, 'rgba(220,204,166,0.2)')
  gradient.addColorStop(.22, 'rgba(115,126,109,0.04)')
  gradient.addColorStop(.53, 'rgba(49,62,53,0.13)')
  gradient.addColorStop(.78, 'rgba(191,177,143,0.1)')
  gradient.addColorStop(1, 'rgba(44,56,49,0.2)')
  ctx.save(); ctx.clip(path); ctx.fillStyle = gradient; ctx.fill(path)
  const phase = ((Math.abs(edge.start.x * 31 + edge.start.y * 17 + edge.end.x * 13 + edge.end.y * 7) % 4096) / 4096) * Math.PI * 2
  const depthLine = (fraction: number, row: number) => {
    const line = new Path2D(), length = Math.hypot(topEnd.x - topStart.x, topEnd.y - topStart.y)
    const stations = Math.max(4, Math.min(24, Math.ceil(length / 500)))
    for (let index = 0; index <= stations; index++) {
      const along = index / stations
      const wobble = index === 0 || index === stations ? 0 : Math.sin(along * Math.PI * 6 + phase + row * 1.7) * .035
      const amount = Math.max(.08, Math.min(.92, fraction + wobble))
      const upper = point(topStart.x + (topEnd.x - topStart.x) * along, topStart.y + (topEnd.y - topStart.y) * along)
      const lower = point(footStart.x + (footEnd.x - footStart.x) * along, footStart.y + (footEnd.y - footStart.y) * along)
      const sample = point(upper.x + (lower.x - upper.x) * amount, upper.y + (lower.y - upper.y) * amount)
      if (index) line.lineTo(sample.x, sample.y); else line.moveTo(sample.x, sample.y)
    }
    return line
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([230, 170]); ctx.lineDashOffset = -phase * 60
  ctx.strokeStyle = '#D4C39B'; ctx.globalAlpha = .38; ctx.lineWidth = 34; ctx.stroke(depthLine(.32, 0))
  ctx.strokeStyle = '#35443B'; ctx.globalAlpha = .3; ctx.lineWidth = 55; ctx.stroke(depthLine(.69, 1))
  ctx.setLineDash([])
  ctx.restore()
  ctx.save(); ctx.strokeStyle = '#D9C8A0'; ctx.globalAlpha = .34; ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.stroke(linePath(topStart, topEnd))
  ctx.strokeStyle = '#39443E'; ctx.globalAlpha = .28; ctx.lineWidth = 18; ctx.stroke(linePath(footStart, footEnd)); ctx.restore()
}
function drawTerrainEdges(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, sx: number, sy: number): void {
  const suppressed = new Set(projection.visual?.suppressedTerrainEdgeIds ?? [])
  for (const edge of projection.edges) {
    if (suppressed.has(edge.id)) continue
    const path = linePath(edge.start, edge.end), face = terrainFace(edge, projection), shadow = terrainShadow(edge, projection), cliff = projection.theme?.terrainCliff
    const connections = boundaryConnections(projection.connections, [edge.start, edge.end], false, [edge.sourceAreaId, edge.neighborAreaId].filter((id): id is string => id !== null))
    ctx.save(); clipConnectionOpenings(ctx, projection.bounds, connections)
    if (face.length || shadow.length) {
      const highId = edge.elevationMm > edge.neighborElevationMm ? edge.sourceAreaId : edge.neighborAreaId
      const high = projection.terrain.find(a => a.id === highId)
      ctx.save(); if (high) excludeRing(ctx, high.points, projection.bounds)
      if (cliff && shadow.length) {
        ctx.save(); ctx.filter = `blur(${cliff.blurMm * Math.max(sx, sy)}px)`; ctx.globalAlpha = cliff.opacity; ctx.fillStyle = cliff.color; ctx.fill(polygonPath(shadow)); ctx.restore()
      }
      if (face.length) {
        cliffFacePaint(ctx, face, edge, projection, raster)
        if (connections.length) { ctx.save(); ctx.clip(polygonPath(face)); drawConnectionCheeks(ctx, connections, '#39443E', 48, .6); ctx.restore() }
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
function drawPaths(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, sx: number, sy: number): void {
  const junctions = pathJunctionOutlines(projection)
  for (const path of projection.paths) drawVisualEntity(ctx, projection, path.id, expandedBounds(path.points, path.edgeStyle.bandWidthMm * 2), (ctx, projection) => {
    const outline = polygonPath(path.points), edge = path.edgeStyle
    const segments = junctions.get(path.id), exterior = segments ? new Path2D() : outline
    if (segments) for (let i = 0; i < segments.length; i++) {
      const [a, b] = segments[i], previous = segments[i - 1]?.[1]
      if (!previous || Math.hypot(previous.x - a.x, previous.y - a.y) > EPS) exterior.moveTo(a.x, a.y)
      exterior.lineTo(b.x, b.y)
    }
    ctx.save()
    if (edge.bandWidthMm) {
      ctx.save(); ctx.globalAlpha = .22; ctx.filter = `blur(${edge.bandWidthMm * .3 * Math.max(sx, sy)}px)`; ctx.strokeStyle = edge.color; ctx.lineWidth = edge.bandWidthMm; ctx.lineJoin = 'round'; ctx.stroke(exterior); ctx.restore()
    }
    fillSurface(ctx, outline, path.style, projection, raster, '#B49D77')
    if (edge.strokeWidthMm) { ctx.strokeStyle = edge.color; ctx.lineWidth = edge.strokeWidthMm; ctx.lineJoin = 'round'; ctx.stroke(exterior) }
    ctx.restore()
  }, !!raster.readFrequently)
}
/** A routed connection paints the same complete physical band used by support,
 * travel, masks and hit tests. Tread phase follows cumulative world arc length. */
function drawRoutedConnectionBody(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, c: ProjectedConnection): void {
  const route = c.route!, polygon = connectionPolygon(c), path = polygonPath(polygon)
  const points = c.toElevationMm > c.fromElevationMm ? route.centerlineMm : [...route.centerlineMm].reverse(), frame = connectionArcFrame(points), half = c.widthMm / 2
  const transform = ctx.getTransform(), sx = Math.abs(transform.a), sy = Math.abs(transform.d), bounds = expandedBounds(polygon, 2)
  const left = Math.max(0, Math.floor((bounds.x - projection.bounds.x) * sx)), top = Math.max(0, Math.floor((bounds.y - projection.bounds.y) * sy))
  const right = Math.min(ctx.canvas.width, Math.ceil((bounds.x + bounds.width - projection.bounds.x) * sx)), bottom = Math.min(ctx.canvas.height, Math.ceil((bounds.y + bounds.height - projection.bounds.y) * sy))
  if (right <= left || bottom <= top) return
  if ((right - left) * (bottom - top) > 16777216) throw new Error('连接局部绘制超过16M像素预算。')
  const surface = canvas(right - left, bottom - top)
  let mask: HTMLCanvasElement | undefined
  try {
    mask = canvas(right - left, bottom - top)
    const target = context(surface, raster.readFrequently), maskContext = context(mask, raster.readFrequently)
    const local = { ...projection, bounds: { x: projection.bounds.x + left / sx, y: projection.bounds.y + top / sy, width: surface.width / sx, height: surface.height / sy } }
    worldTransform(target, local.bounds, sx, sy)
    const palette = route.renderProfile === 'naturalRockSteps8' ? { base: '#D8C5A1', dark: '#A89B7E', light: '#EDDCB8' }
      : route.stairStyle === 'wood' ? { base: '#AB9165', dark: '#65523E', light: '#E1C693' }
      : route.stairStyle === 'naturalRock' ? route.renderProfile === 'naturalRockSteps6' || route.renderProfile === 'naturalRockSteps7'
        ? { base: '#D9C9A3', dark: '#998064', light: '#E8DDB7' }
        : route.renderProfile === 'naturalRockSteps5'
        ? { base: '#C4B997', dark: '#9D937C', light: '#E4D4AE' }
        : route.renderProfile === 'naturalRockSteps4'
        ? { base: '#666D67', dark: '#303C36', light: '#9CA396' }
        : route.renderProfile === 'naturalRockSteps3'
        ? { base: '#777B72', dark: '#424B47', light: '#AAA999' }
        : { base: '#B6B094', dark: '#606D5E', light: '#E4D4A9' }
        : { base: '#AAA98E', dark: '#59665D', light: '#E4D9B5' }
    fillSurface(target, path, c.style, local, raster, palette.base)
    if (route.renderProfile === 'naturalRockSteps4' || route.renderProfile === 'naturalRockSteps6' || route.renderProfile === 'naturalRockSteps7' || route.renderProfile === 'naturalRockSteps8') {
      const plan = planRockStepSideMask({ bounds: local.bounds, width: surface.width, height: surface.height,
        centerlineMm: route.centerlineMm, widthMm: c.widthMm })
      const sideMask = canvas(plan.width, plan.height)
      try {
        const maskContext = context(sideMask, raster.readFrequently), image = maskContext.createImageData(plan.width, plan.height)
        image.data.set(plan.data); maskContext.putImageData(image, 0, 0)
        target.save()
        try {
          target.resetTransform(); target.globalCompositeOperation = 'destination-in'; target.globalAlpha = 1; target.filter = 'none'
          target.imageSmoothingEnabled = true; target.drawImage(sideMask, 0, 0, surface.width, surface.height)
        } finally { target.restore() }
      } finally { disposeCanvas(sideMask) }
    }
    target.save(); target.clip(path); target.lineCap = 'butt'
    if (c.kind === 'stairs') {
      const count = Math.max(1, Math.ceil(frame.length / route.treadDepthMm)), depth = frame.length / count
      if (count > 512) throw new Error('连接踏面超过512级预算。')
      for (let i = 1; i < count; i++) {
        if (route.stairStyle === 'naturalRock') continue
        const distance = depth * i, shadeDepth = Math.min(70, depth * .24)
        const a = frame.at(distance - shadeDepth), b = frame.at(distance + 20), shade = target.createLinearGradient(a.x, a.y, b.x, b.y)
        shade.addColorStop(0, '#26312800'); shade.addColorStop(.75, '#26312860'); shade.addColorStop(1, '#26312800')
        target.fillStyle = shade; target.globalAlpha = 1
        target.fill(polygonPath([frame.at(distance - shadeDepth, -half), frame.at(distance - shadeDepth, half), frame.at(distance + 20, half), frame.at(distance + 20, -half)]))
        target.strokeStyle = palette.dark; target.lineWidth = route.stairStyle === 'wood' ? 24 : 18; target.globalAlpha = .72
        target.stroke(linePath(frame.at(distance, -half), frame.at(distance, half)))
        target.strokeStyle = palette.light; target.lineWidth = 14; target.globalAlpha = .56; target.stroke(linePath(frame.at(distance + 28, -half), frame.at(distance + 28, half)))
        if (route.stairStyle === 'wood') {
          target.strokeStyle = palette.dark; target.lineWidth = 10; target.globalAlpha = .42
          for (const side of [-1, 1]) target.stroke(linePath(frame.at(distance - depth * .36, half * .82 * side), frame.at(distance - depth * .16, half * .82 * side)))
        } else if (route.stairStyle === 'stone' && i % 2) {
          target.strokeStyle = palette.dark; target.lineWidth = 12; target.globalAlpha = .32
          target.stroke(linePath(frame.at(distance - depth + 28, 0), frame.at(distance - 12, 0)))
        }
      }
      if (route.stairStyle === 'naturalRock') {
        const seed = `${c.id}/${route.centerlineMm.map(p => `${p.x},${p.y}`).join(';')}`
        if (route.renderProfile === 'naturalRockSteps6' || route.renderProfile === 'naturalRockSteps7' || route.renderProfile === 'naturalRockSteps8') drawTerracedRockSteps(target, { frame, widthMm: c.widthMm, count,
          riseMm: Math.abs(c.toElevationMm - c.fromElevationMm), seed, bandMm: polygon, palette,
          lightDirectionDeg: projection.visual?.environment.lightDirectionDeg, profile: route.renderProfile })
        else if (route.renderProfile === 'naturalRockSteps5') drawTerracedRockSteps(target, { frame, widthMm: c.widthMm, count,
          riseMm: Math.abs(c.toElevationMm - c.fromElevationMm), seed, bandMm: polygon, palette,
          lightDirectionDeg: projection.visual?.environment.lightDirectionDeg })
        else if (route.renderProfile === 'naturalRockSteps4') drawNaturalRockStepsV4(target, { frame, widthMm: c.widthMm, count, seed, bandMm: polygon, palette })
        else if (route.renderProfile === 'naturalRockSteps2' || route.renderProfile === 'naturalRockSteps3') drawNaturalRockSteps(target, { frame, widthMm: c.widthMm, count, seed, bandMm: polygon, palette })
        else {
        const treads = naturalRockTreads(frame, c.widthMm, seed, count)
        for (let i = 0; i < treads.length; i++) {
          const tread = treads[i], factor = tread.shade
          const tint = (color: string, scale: number) => {
            const channels = [1, 3, 5].map(index => Math.max(0, Math.min(255, Math.round(parseInt(color.slice(index, index + 2), 16) * scale))))
            return `rgb(${channels.join(',')})`
          }
          const treadPath = polygonPath(tread.polygon), lowerPath = polygonPath(tread.lowerEdge)
          target.fillStyle = tint(palette.base, factor); target.globalAlpha = .94; target.fill(treadPath)
          target.fillStyle = tint(palette.dark, .88); target.globalAlpha = .4; target.fill(lowerPath)
          target.strokeStyle = tint(palette.dark, .9); target.lineWidth = 16; target.globalAlpha = .45; target.lineJoin = 'round'
          target.stroke(linePath(tread.polygon[0], tread.polygon[1]))
          target.strokeStyle = tint(palette.light, .86 + factor * .12); target.lineWidth = 14; target.globalAlpha = .56
          target.stroke(linePath(tread.upperEdge[0], tread.upperEdge[1]))
          if (i % 2 === 0) {
            const centerLeft = frame.at(tread.fraction * frame.length, -half * .32), centerRight = frame.at(tread.fraction * frame.length, half * .32)
            target.strokeStyle = tint(palette.light, 1.06); target.lineWidth = 10; target.globalAlpha = .3; target.stroke(linePath(centerLeft, centerRight))
          }
        }
        }
      }
    } else {
      const line = new Path2D(); points.forEach((p, i) => i ? line.lineTo(p.x, p.y) : line.moveTo(p.x, p.y))
      target.strokeStyle = palette.dark; target.lineWidth = 25; target.globalAlpha = .65; target.setLineDash([110, 85]); target.stroke(line); target.setLineDash([])
    }
    target.strokeStyle = palette.dark
    if (route.renderProfile === 'naturalRockSteps2' || route.renderProfile === 'naturalRockSteps3' || route.renderProfile === 'naturalRockSteps4' || route.renderProfile === 'naturalRockSteps5' || route.renderProfile === 'naturalRockSteps6' || route.renderProfile === 'naturalRockSteps7' || route.renderProfile === 'naturalRockSteps8') {
      // This profile already paints finite contacts; keep both landings open.
    } else if (route.stairStyle === 'naturalRock') {
      // Short contacts follow each real route leg. No closed frame or end-cap
      // line turns the rock steps into a rectangular slab. The same full-width
      // corridor clips these marks and the existing landing mask fades them.
      target.lineWidth = 45; target.globalAlpha = .12; target.setLineDash([130, 95])
      for (const [a, b] of connectionSideSegments(c)) target.stroke(linePath(a, b))
      target.setLineDash([])
    } else { target.lineWidth = 24; target.globalAlpha = .48; target.stroke(path) }
    target.restore()
    // Fade only the two actual arc-length landing intervals. A global chord
    // gradient would erase unrelated legs of a curved/switchback route.
    maskContext.fillStyle = '#FFFFFF'; maskContext.fillRect(0, 0, mask.width, mask.height); worldTransform(maskContext, local.bounds, sx, sy)
    const landing = connectionLandingDepthMm(c.widthMm, frame.length)
    for (let i = 1; i < points.length; i++) {
      const aDistance = frame.distances[i - 1], bDistance = frame.distances[i]
      for (const [start, end, reverse] of [[0, landing, false], [frame.length - landing, frame.length, true]] as const) {
        const from = Math.max(start, aDistance), to = Math.min(end, bDistance)
        if (to <= from) continue
        const a = frame.at(from), b = frame.at(to), gradient = maskContext.createLinearGradient(a.x, a.y, b.x, b.y)
        const alpha = (d: number) => reverse ? (d - start) / landing : (end - d) / landing
        gradient.addColorStop(0, `rgba(255,255,255,${alpha(from)})`); gradient.addColorStop(1, `rgba(255,255,255,${alpha(to)})`)
        maskContext.globalCompositeOperation = 'destination-out'; maskContext.fillStyle = gradient
        maskContext.fill(polygonPath(polylineBand([a, b], c.widthMm + 2)))
      }
    }
    target.save(); target.resetTransform(); target.globalCompositeOperation = 'destination-in'; target.drawImage(mask, 0, 0); target.restore()
    drawConnectionLandingBlends(target, maskContext, local, raster, c, path)
    ctx.save(); ctx.resetTransform(); ctx.drawImage(surface, left, top); ctx.restore()
  } finally { disposeCanvas(surface); if (mask) disposeCanvas(mask) }
  if (c.blocksMovement) { ctx.save(); ctx.clip(path); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 85; ctx.stroke(linePath(frame.at(frame.length / 2, -half), frame.at(frame.length / 2, half))); ctx.restore() }
}
/** Blend the first/last route stations with their audience-visible terrain styles. */
function drawConnectionLandingBlends(target: CanvasRenderingContext2D, layer: CanvasRenderingContext2D, projection: Projection, raster: RasterSet,
  connection: ProjectedConnection, path: Path2D): void {
  if (!connection.surfaceIds?.length) return
  const bounds = projection.bounds
  for (const end of ['start', 'end'] as const) {
    const blend = connectionLandingBlend(connection, end), support = blend && [...projection.terrain, ...projection.rooms].find(area => area.id === blend.surfaceId)
    if (!blend || !support?.style) continue
    layer.save(); layer.resetTransform(); layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height); layer.restore()
    layer.globalCompositeOperation = 'source-over'; layer.globalAlpha = 1; layer.filter = 'none'
    worldTransform(layer, bounds, layer.canvas.width / bounds.width, layer.canvas.height / bounds.height)
    const landingPath = polygonPath(blend.polygonMm)
    layer.save(); layer.clip(path)
    fillSurface(layer, landingPath, support.style, projection, raster, '#C3BEA8', support.materialPatches)
    layer.restore()
    if (connection.kind === 'stairs' && connection.route?.stairStyle === 'naturalRock') {
      maskNaturalRockLanding(layer, connection, end, blend.depthMm, bounds, path, !!raster.readFrequently)
    } else if (connection.route) {
      maskRoutedLanding(layer, connection, end, blend.depthMm, bounds, path, !!raster.readFrequently)
    } else {
      layer.save(); layer.globalCompositeOperation = 'destination-in'; layer.globalAlpha = 1; layer.filter = 'none'
      const gradient = layer.createLinearGradient(blend.fromMm.x, blend.fromMm.y, blend.toMm.x, blend.toMm.y)
      gradient.addColorStop(0, '#FFFFFF'); gradient.addColorStop(1, '#FFFFFF00')
      layer.fillStyle = gradient; layer.fill(landingPath); layer.restore()
    }
    target.save(); target.resetTransform(); target.globalCompositeOperation = 'source-over'; target.drawImage(layer.canvas, 0, 0); target.restore()
  }
}
/** Apply a routed landing fade one saved station segment at a time. A single
 * endpoint-to-endpoint gradient would cross a bend and fade the wrong pixels. */
function maskRoutedLanding(layer: CanvasRenderingContext2D, connection: ProjectedConnection, end: 'start' | 'end', depthMm: number,
  bounds: BoundsMm, path: Path2D, readFrequently: boolean): void {
  const mask = canvas(layer.canvas.width, layer.canvas.height)
  try {
    const ctx = context(mask, readFrequently)
    paintConnectionLandingMask(ctx, bounds, connection, end, depthMm)
    worldTransform(ctx, bounds, mask.width / bounds.width, mask.height / bounds.height)
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = '#FFFFFF'; ctx.fill(path)
    layer.save(); layer.resetTransform(); layer.globalCompositeOperation = 'destination-in'; layer.globalAlpha = 1; layer.filter = 'none'
    layer.drawImage(mask, 0, 0); layer.restore()
  } finally { disposeCanvas(mask) }
}
/** Reuse the endpoint ground between rock treads with a broken, wider edge fade.
 * Each mask strip follows its own saved-route interval, so a later switchback
 * cannot inherit an endpoint's chord gradient. The physical corridor clips it. */
function maskNaturalRockLanding(layer: CanvasRenderingContext2D, connection: ProjectedConnection, end: 'start' | 'end', depthMm: number,
  bounds: BoundsMm, path: Path2D, readFrequently: boolean): void {
  const mask = canvas(layer.canvas.width, layer.canvas.height)
  try {
    const ctx = context(mask, readFrequently)
    paintConnectionLandingMask(ctx, bounds, connection, end, depthMm, true)
    worldTransform(ctx, bounds, mask.width / bounds.width, mask.height / bounds.height)
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = '#FFFFFF'; ctx.fill(path)
    layer.save(); layer.resetTransform(); layer.globalCompositeOperation = 'destination-in'; layer.globalAlpha = 1; layer.filter = 'none'
    layer.drawImage(mask, 0, 0); layer.restore()
  } finally { disposeCanvas(mask) }
}
function drawConnectionBody(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, c: ProjectedConnection): void {
  if (c.route) return drawRoutedConnectionBody(ctx, projection, raster, c)
  const frame = connectionFrame(c), half = c.widthMm / 2, polygon = [frame.at(0, half), frame.at(0, -half), frame.at(frame.length, -half), frame.at(frame.length, half)], path = polygonPath(polygon)
  // A bounded local surface lets the two landings blend into their real support
  // without fading/narrowing the physical corridor or changing its saved style.
  const transform = ctx.getTransform(), sx = Math.abs(transform.a), sy = Math.abs(transform.d), bounds = expandedBounds(polygon, 2)
  const left = Math.max(0, Math.floor((bounds.x - projection.bounds.x) * sx)), top = Math.max(0, Math.floor((bounds.y - projection.bounds.y) * sy))
  const right = Math.min(ctx.canvas.width, Math.ceil((bounds.x + bounds.width - projection.bounds.x) * sx)), bottom = Math.min(ctx.canvas.height, Math.ceil((bounds.y + bounds.height - projection.bounds.y) * sy))
  if (right <= left || bottom <= top) return
  if ((right - left) * (bottom - top) > 16777216) throw new Error('连接局部绘制超过16M像素预算。')
  const surface = canvas(right - left, bottom - top)
  let landingLayer: HTMLCanvasElement | undefined
  try {
    const target = context(surface, raster.readFrequently)
    landingLayer = canvas(surface.width, surface.height)
    const landingContext = context(landingLayer, raster.readFrequently)
    const local = { ...projection, bounds: { x: projection.bounds.x + left / sx, y: projection.bounds.y + top / sy, width: surface.width / sx, height: surface.height / sy } }
    worldTransform(target, local.bounds, sx, sy); fillSurface(target, path, c.style, local, raster, '#919180'); target.save(); target.clip(path)
    const light = target.createLinearGradient(frame.low.x, frame.low.y, frame.high.x, frame.high.y)
    light.addColorStop(0, '#24313A38'); light.addColorStop(1, '#F2EAD420'); target.fillStyle = light; target.fill(path)
    target.lineCap = 'butt'
    if (c.kind === 'stairs') {
      const count = Math.max(2, Math.min(40, Math.ceil(Math.abs(c.toElevationMm - c.fromElevationMm) / 180))), depth = frame.length / count
      for (let i = 1; i < count; i++) {
        const distance = depth * i, shadeDepth = Math.min(65, depth * .24), a = frame.at(distance - shadeDepth), b = frame.at(distance + 18)
        const shade = target.createLinearGradient(a.x, a.y, b.x, b.y); shade.addColorStop(0, '#26312800'); shade.addColorStop(.75, '#26312860'); shade.addColorStop(1, '#26312800')
        target.fillStyle = shade; target.globalAlpha = 1; target.fill(polygonPath([frame.at(distance - shadeDepth, -half), frame.at(distance - shadeDepth, half), frame.at(distance + 18, half), frame.at(distance + 18, -half)]))
        target.strokeStyle = '#39443E'; target.lineWidth = 18; target.globalAlpha = .62; target.stroke(linePath(frame.at(distance, -half), frame.at(distance, half)))
        target.strokeStyle = '#F2E3BC'; target.lineWidth = 14; target.globalAlpha = .48; target.stroke(linePath(frame.at(distance + 27, -half), frame.at(distance + 27, half)))
      }
    } else { target.strokeStyle = '#39443E'; target.lineWidth = 25; target.globalAlpha = .65; target.setLineDash([110, 85]); target.stroke(linePath(frame.low, frame.high)); target.setLineDash([]) }
    // Contact darkening stays on the two true sides, leaving the entire clear
    // width readable. No outside rectangular drop shadow is introduced.
    target.strokeStyle = '#27382F'; target.lineWidth = 80; target.globalAlpha = .13
    for (const [a, b] of frame.sides) target.stroke(linePath(a, b))
    target.strokeStyle = '#39443E'; target.lineWidth = 20; target.globalAlpha = .45
    for (const [a, b] of frame.sides) target.stroke(linePath(a, b))
    target.restore()
    const landing = connectionLandingDepthMm(c.widthMm, frame.length) / frame.length, mask = target.createLinearGradient(frame.low.x, frame.low.y, frame.high.x, frame.high.y)
    mask.addColorStop(0, '#FFFFFF00'); mask.addColorStop(landing, '#FFFFFFFF'); mask.addColorStop(1 - landing, '#FFFFFFFF'); mask.addColorStop(1, '#FFFFFF00')
    target.globalCompositeOperation = 'destination-in'; target.fillStyle = mask; target.fill(path)
    drawConnectionLandingBlends(target, landingContext, local, raster, c, path)
    ctx.save(); ctx.resetTransform(); ctx.drawImage(surface, left, top); ctx.restore()
  } finally { disposeCanvas(surface); if (landingLayer) disposeCanvas(landingLayer) }
  if (c.blocksMovement) { ctx.save(); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 85; ctx.stroke(linePath(frame.at(frame.length / 2, -half), frame.at(frame.length / 2, half))); ctx.restore() }
}
function drawConnections(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet): void {
  for (const c of projection.connections) drawVisualEntity(ctx, projection, c.id, expandedBounds(connectionPolygon(c), 85), (target, local) => drawConnectionBody(target, local, raster, c), !!raster.readFrequently)
}
function drawProjection(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, signal?: AbortSignal, propDetails?: ReadonlyMap<string, EditorPropDetail>, clipBoundsMm?: BoundsMm) {
  const bounds = projection.bounds, sx = ctx.canvas.width / bounds.width, sy = ctx.canvas.height / bounds.height
  const sprites: ({ kind: 'prop'; value: Prop } | { kind: 'decoration'; value: ProjectedDecoration })[] = [
    ...projection.props.map(value => ({ kind: 'prop' as const, value })), ...(projection.decorations ?? []).map(value => ({ kind: 'decoration' as const, value })),
  ]
  if (projection.spritePaintOrder) {
    const rank = new Map(projection.spritePaintOrder.map((id, index) => [id, index]))
    sprites.sort((a, b) => (rank.get(a.value.id) ?? 0) - (rank.get(b.value.id) ?? 0))
  }
  const drawSprites = (ground: boolean) => {
    for (const sprite of sprites) if ((sprite.value.renderLayer === 'ground') === ground) {
      checkCancelled(signal)
      if (sprite.kind === 'prop') drawProp(ctx, sprite.value, projection, raster, sx, sy, propDetails?.get(sprite.value.id))
      else drawDecoration(ctx, sprite.value, projection, raster)
    }
  }
  if (projection.outputBackground?.mode !== 'transparent') {
    ctx.fillStyle = projection.outputBackground?.mode === 'solid' ? projection.outputBackground.color : '#D8D5C5'
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }
  worldTransform(ctx, bounds, sx, sy)
  // VTT padding aligns the image with the world grid. It must never reveal
  // content beyond the original fixed export rectangle.
  if (clipBoundsMm) { ctx.save(); ctx.beginPath(); ctx.rect(clipBoundsMm.x, clipBoundsMm.y, clipBoundsMm.width, clipBoundsMm.height); ctx.clip() }
  if (projection.regional) drawRegionalProjection(ctx, projection, sx, sy, raster.byAssetId)
  for (const area of projection.terrain) drawVisualEntity(ctx, projection, area.id, expandedBounds(area.points, 0), (target, local) => fillSurface(target, polygonPath(area.points), area.style, local, raster, '#C3BEA8', area.materialPatches), !!raster.readFrequently)
  drawTerrainEdges(ctx, projection, raster, sx, sy)
  drawVisualBoundaries(ctx, projection, signal, !!raster.readFrequently)
  // Keep historical scenes without paths on their old paint order. The
  // audience-owned flag survives temporary hiding of the last editor path.
  const pathsOverRooms = projection.pathPaintOrder !== undefined
  if (!pathsOverRooms) drawConnections(ctx, projection, raster)
  drawRoomFloors(ctx, projection, raster)
  drawPaths(ctx, projection, raster, sx, sy)
  // A road color never conceals the explicit crossing's stair/ramp marks.
  if (pathsOverRooms) drawConnections(ctx, projection, raster)
  // Projection owns the canonical layer/order/id sorting; keep its order through the wall split.
  drawSprites(true)
  checkCancelled(signal)
  const walls = wallGeometry(projection.walls)
  if (projection.visual) {
    const contacts = walls.flatMap(wall => wall.polygons)
    drawVisualContacts(ctx, projection, contacts, !!raster.readFrequently, (target, local) => {
      for (const prop of projection.props) if (prop.renderLayer !== 'ground' && prop.shadowClass !== 'none' && !projection.propPresentations?.[prop.id]) drawPropBody(target, prop, local, raster, sx, sy, 'image', false)
    })
  }
  drawWallBody(ctx, projection, raster, sx, sy, walls)
  const symbols = projection.walls.flatMap(wall => wall.openings.map(opening => ({ wall, opening })))
  if (projection.openingPaintOrder) {
    const rank = new Map(projection.openingPaintOrder.map((id, index) => [id, index]))
    symbols.sort((a, b) => (rank.get(a.opening.id) ?? 0) - (rank.get(b.opening.id) ?? 0))
  }
  for (const { wall, opening } of symbols) if (opening.paintSymbol !== false) drawOpening(ctx, opening, wall, projection)
  drawSprites(false)
  if (projection.visual) {
    // Light blockers are already captured in the audience-owned projection;
    // the atmosphere helper does not consume reconstructed wall paint rings.
    const atmosphere = () => drawVisualAtmosphere(ctx, projection, [], signal, !!raster.readFrequently)
    if (projection.outputBackground?.mode === 'transparent') paintWithPreservedAlpha(ctx, atmosphere, signal)
    else atmosphere()
  }
  for (const region of projection.regions) drawVisualEntity(ctx, projection, region.id, expandedBounds(region.points, 20), ctx => {
    ctx.save(); ctx.strokeStyle = region.kind === 'hazard' ? '#9A674A' : '#71865A'; ctx.lineWidth = 18; ctx.setLineDash([85, 65]); ctx.stroke(polygonPath(region.points)); ctx.restore()
  }, !!raster.readFrequently)
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
  if (projection.audience === 'player') { ctx.save(); ctx.fillStyle = '#D8D5C5'; for (const mask of projection.masks) { const b = pointsBounds(mask); ctx.fillRect(b.x, b.y, b.width, b.height) } ctx.restore() }
  if (clipBoundsMm) ctx.restore()
  ctx.resetTransform()
}

/**
 * Canvas/resource backend. Receives disposable physical projection and resource
 * records only. Strict version-specific entrypoints own document validation.
 */
export async function renderRasterProjection(sources: RasterSources, projection: Projection, options: RenderOptions, editor?: EditorRenderOptions & { drawingProjection?: Projection }, validationStarted?: number, publicCropMm?: BoundsMm, clipBoundsMm?: BoundsMm): Promise<HTMLCanvasElement> {
  options = { ...options }
  const started = options.onMetrics ? validationStarted ?? performance.now() : 0
  const metrics: RenderMetrics | undefined = options.onMetrics ? { validationProjectionMs: 0, resourceVerificationMs: 0, decoderQueueWaitMs: 0, imageDecodeMs: 0, drawSubmissionMs: 0, totalMs: 0, decodedImages: 0, decodedPixels: 0, width: 0, height: 0, audience: options.audience, ...(projection.floorId === undefined ? {} : { floorId: projection.floorId }) } : undefined
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('图片长边须为 256–4096 整数像素。')
  if (projection.audience !== options.audience || options.floorId !== undefined && projection.floorId !== options.floorId) throw new Error('栅格请求与投影的受众或目标Floor不一致。')
  if (projection.limitations.length) throw new Error(projection.limitations.join(' '))
  const visibleProjection = editor?.drawingProjection ?? projection
  if (visibleProjection.audience !== projection.audience || visibleProjection.floorId !== projection.floorId
    || ['x', 'y', 'width', 'height'].some(key => visibleProjection.bounds[key as keyof BoundsMm] !== projection.bounds[key as keyof BoundsMm])) throw new Error('编辑绘制投影的Floor、受众或固定输出范围与完整投影不一致。')
  const plan = editor ? createEditorRenderPlan(visibleProjection, { viewBoundsMm: editor.viewBoundsMm, screenScalePxPerMm: editor.screenScalePxPerMm ?? options.longEdgePx / Math.max(visibleProjection.bounds.width, visibleProjection.bounds.height) }) : null
  const paintIds = plan ? new Set(plan.surfacePresentations.map(entry => `${entry.kind}:${entry.id}`)) : null
  const drawingProjection = publicCropMm ? { ...visibleProjection, bounds: editorPaintBounds(visibleProjection, { boundsMm: publicCropMm, props: visibleProjection.props.map(prop => ({ prop, detail: 'full' as const, screenSizePx: 0, visualBoundsMm: visibleProjection.bounds, paintBoundsMm: visibleProjection.bounds })) }) }
    : plan ? { ...visibleProjection, bounds: editorPaintBounds(visibleProjection, plan), props: plan.props.map(entry => entry.prop), decorations: plan.decorations,
      // Only paint is culled. Occluders, contacts, supports and boundary facts
      // remain the complete audience-owned dependency closure.
      ...(visibleProjection.visual ? { visual: { ...visibleProjection.visual,
        edgeLooks: visibleProjection.visual.edgeLooks.filter(entry => paintIds!.has(`edgeLook:${entry.id}`)),
        materializedEdges: visibleProjection.visual.materializedEdges?.filter(entry => paintIds!.has(`materializedEdge:${entry.id}`)),
        transitions: visibleProjection.visual.transitions?.filter(entry => paintIds!.has(`transition:${entry.id}`)),
      } } : {}) } : visibleProjection
  const propDetails = plan ? new Map(plan.props.map(entry => [entry.prop.id, entry.detail])) : undefined
  const outputBounds = publicCropMm ?? plan?.boundsMm ?? projection.bounds
  const ratio = options.longEdgePx / Math.max(outputBounds.width, outputBounds.height), width = Math.max(1, Math.round(outputBounds.width * ratio)), height = Math.max(1, Math.round(outputBounds.height * ratio))
  if (width * height > PNG_MAX_PIXELS) throw new Error('图片超过 16M 像素预算。')
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('图片绘制需要支持真实位图解码与 Canvas 的浏览器。')
  if (metrics) { metrics.validationProjectionMs = performance.now() - started; metrics.width = width; metrics.height = height }
  const raster = await decodeRequired(sources, projection, options.signal, metrics, plan ? editorResidentAssetIds(visibleProjection, plan) : undefined)
  // Formal 4K output is read back for PNG encoding. Keep all of its temporary
  // surfaces on the readback path: WebKit's accelerated material composition
  // can vary by one color level even between two exports of the same input.
  // Interactive/editor canvases retain their existing rendering path.
  raster.readFrequently = !editor && options.longEdgePx === PNG_MAX_LONG_EDGE
  let output: HTMLCanvasElement | undefined, padded: HTMLCanvasElement | undefined
  let completed = false
  try {
    checkCancelled(options.signal); output = canvas(width, height)
    const ctx = context(output, raster.readFrequently)
    if ((plan || publicCropMm) && (drawingProjection.bounds.x !== outputBounds.x || drawingProjection.bounds.y !== outputBounds.y || drawingProjection.bounds.width !== outputBounds.width || drawingProjection.bounds.height !== outputBounds.height)) {
      // Source silhouettes outside the visible crop must contribute to wall
      // masks, material feathers and shadows before the final view is cut out.
      // Extremely large world shadows reduce this disposable preview's raster
      // density rather than allocating an unbounded intermediate surface.
      let paintBounds = drawingProjection.bounds
      let paintRatio = Math.min(ratio, PNG_MAX_LONG_EDGE / Math.max(paintBounds.width, paintBounds.height))
      let paintWidth = Math.max(1, Math.round(paintBounds.width * paintRatio)), paintHeight = Math.max(1, Math.round(paintBounds.height * paintRatio))
      let paintProjection = drawingProjection
      if (publicCropMm) {
        // Public feedback at an existing output pixel scale must retain that
        // world pixel grid. Rounding a padded canvas size while keeping its old
        // world extent changes scale and resamples every material and cliff.
        // Editor previews deliberately keep their previous allocation policy.
        const sourceBounds = paintBounds, origin = projection.bounds
        const aligned = (scale: number) => {
          const left = Math.floor((sourceBounds.x - origin.x) * scale), top = Math.floor((sourceBounds.y - origin.y) * scale)
          const right = Math.ceil((sourceBounds.x + sourceBounds.width - origin.x) * scale), bottom = Math.ceil((sourceBounds.y + sourceBounds.height - origin.y) * scale)
          return { bounds: { x: origin.x + left / scale, y: origin.y + top / scale, width: (right - left) / scale, height: (bottom - top) / scale },
            width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
        }
        const fullWidth = Math.max(1, Math.round(origin.width * ratio)), fullHeight = Math.max(1, Math.round(origin.height * ratio))
        // A bounded complete frame also preserves Canvas's gradient sampling
        // origin: translated gradients may quantize differently even after
        // their geometry and pixel scale were aligned. At an existing formal
        // output density this gives the exact original frame, then an integer
        // pixel crop. Higher-density small feedback views retain bounded work.
        const completeFrameFits = fullWidth <= PNG_MAX_LONG_EDGE && fullHeight <= PNG_MAX_LONG_EDGE && fullWidth * fullHeight <= PNG_MAX_PIXELS
        let allocation = completeFrameFits ? { bounds: origin, width: fullWidth, height: fullHeight } : aligned(paintRatio)
        if (allocation.width > PNG_MAX_LONG_EDGE || allocation.height > PNG_MAX_LONG_EDGE) {
          // Leave two pixels for outward alignment when the requested density
          // already exhausted the bounded temporary-canvas long edge.
          paintRatio = Math.min(paintRatio, (PNG_MAX_LONG_EDGE - 2) / Math.max(sourceBounds.width, sourceBounds.height))
          allocation = aligned(paintRatio)
        }
        if (allocation.width > PNG_MAX_LONG_EDGE || allocation.height > PNG_MAX_LONG_EDGE || allocation.width * allocation.height > PNG_MAX_PIXELS) throw new Error('公开视口临时缓冲超过有界像素预算。')
        paintBounds = allocation.bounds; paintWidth = allocation.width; paintHeight = allocation.height
        paintProjection = { ...drawingProjection, bounds: paintBounds }
      }
      padded = canvas(paintWidth, paintHeight)
      const paintContext = context(padded, raster.readFrequently), drawStarted = metrics ? performance.now() : 0
      drawProjection(paintContext, paintProjection, raster, options.signal, propDetails)
      const sx = padded.width / paintBounds.width, sy = padded.height / paintBounds.height
      ctx.drawImage(padded, (outputBounds.x - paintBounds.x) * sx, (outputBounds.y - paintBounds.y) * sy, outputBounds.width * sx, outputBounds.height * sy, 0, 0, width, height)
      if (metrics) metrics.drawSubmissionMs = performance.now() - drawStarted
    } else {
      const drawStarted = metrics ? performance.now() : 0
      drawProjection(ctx, drawingProjection, raster, options.signal, propDetails, clipBoundsMm)
      if (metrics) metrics.drawSubmissionMs = performance.now() - drawStarted
    }
    checkCancelled(options.signal); completed = true; return output
  } catch (error) { if (output) disposeCanvas(output); throw error }
  finally {
    if (metrics) { metrics.decodedImages = raster.bitmaps.size; metrics.decodedPixels = [...raster.bitmaps.values()].reduce((sum, bitmap) => sum + bitmap.width * bitmap.height, 0) }
    raster.bitmaps.forEach(bitmap => bitmap.close()); if (raster.paintCache) disposeCanvas(raster.paintCache.image)
    if (padded) disposeCanvas(padded)
    if (completed && metrics) {
      metrics.totalMs = performance.now() - started
      try { options.onMetrics?.(metrics) } catch { /* Observers cannot change the render result or retain temporary resources. */ }
    }
  }
}

/** PNG encoding owns and releases the output surface, including failure/cancel paths. */
export async function encodePng(output: HTMLCanvasElement, signal?: AbortSignal, onMetrics?: (metrics: PngMetrics) => void): Promise<Blob> {
  const started = onMetrics ? performance.now() : 0
  let submitMs = 0
  try {
    checkCancelled(signal)
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob(result => result ? resolve(result) : reject(new Error('PNG 编码失败，请降低输出尺寸。')), 'image/png')
      if (onMetrics) submitMs = performance.now() - started
    })
    const encodedAt = onMetrics ? performance.now() : 0
    checkCancelled(signal)
    if (blob.type !== 'image/png' || !blob.size || blob.size > PNG_MAX_ENCODED_BYTES) throw new Error('PNG 编码格式或字节数超过输出保护值。')
    const encoded = new Uint8Array(await blob.arrayBuffer()), readAt = onMetrics ? performance.now() : 0
    const bytes = normalizePngChunks(encoded, PNG_MAX_ENCODED_BYTES)
    checkCancelled(signal)
    // Normalization already validates the actual PNG container/CRC/dimensions.
    // Its header remains first; avoid reapplying the per-asset 20 MiB budget here.
    const header = new DataView(bytes.buffer, bytes.byteOffset + 16, 8)
    if (header.getUint32(0) !== output.width || header.getUint32(4) !== output.height) throw new Error('PNG 实际编码尺寸与输出画布不一致。')
    const result = new Blob([bytes.slice().buffer], { type: 'image/png' })
    if (onMetrics) try { onMetrics({ mode: 'native', encodeMs: encodedAt - started, submitMs, callbackWaitMs: Math.max(0, encodedAt - started - submitMs), readBytesMs: readAt - encodedAt,
      normalizeMs: performance.now() - readAt, totalMs: performance.now() - started, byteLength: bytes.length }) } catch { /* Observation cannot change output. */ }
    return result
  } finally { disposeCanvas(output) }
}
