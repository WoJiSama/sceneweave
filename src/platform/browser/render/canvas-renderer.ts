import { wallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
import { drawOceanWaves, drawWaterProp } from './ocean-renderer.js'
import { drawSurfaceRuleMask } from './surface-mask.js'
export { drawSurfaceRuleMask } from './surface-mask.js'
import type { WallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
export { wallGeometry }
export type { WallGeometry }
import { planWallRelief } from '../../../shared/appearance/wall-relief.js'
import { effectivePropShadow, presentationBounds, presentationContact, presentationShadow, propPaintPolygon, propShadowDirection } from '../../../shared/appearance/presentation.js'
import { propPresentationEnvelope } from '../../../shared/projection/presentation-contract.js'
import { wallShadowStyle } from '../../../shared/visual/directional-light.js'
import { projectedWallFootprints } from '../../../shared/visual/projection.js'
import { playerMaskRings } from '../../../shared/projection/player-mask.js'
import { applyVisualFilters, drawDirectionalSpriteShadow, drawVisualAtmosphere, drawVisualBoundaries, drawVisualContacts, drawVisualEntity } from './visual-renderer'
import { pathJunctionOutlines } from './path-junctions.js'
import { bridgeSideOffset } from '../../../shared/path-assembly/profiles.js'
import { drawBridgeBearingSeat, drawBridgeContactShadow, drawBridgeDeckEdge, drawBridgeLandings, drawBridgeSides, drawBridgeStructure, drawBridgeSymbol } from './path-assembly.js'
import { bridgeWalkCap, exposedEdgeSegments, replacePathCaps } from '../../../shared/projection/bridge-entrances.js'
import { joinedPavingPaint } from '../../../shared/projection/route-paving.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import type { BoundsMm, MaterialPaint, PointMm, Prop, ShadowStyle, SurfaceOverlay, SurfaceStyle } from '../../../shared/model/scene.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { drawRegionalProjection } from './regional-renderer.js'
import { inspectImageBytes, normalizePngChunks } from '../../../shared/project/image-bytes.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { withRenderDecoderSlot } from './image-decoder'
import type { AssetRecord, ResourceBytePort, SvgAuthoringSource } from '../../../shared/model/project.js'
import type { AssetRef } from '../../../shared/model/scene.js'
import { pointsBounds } from './geometry'
import type { Audience, ProjectedBridgeEntrance, ProjectedConnection, ProjectedDecoration, ProjectedOpening, ProjectedPath, ProjectedSurface, ProjectedTerrainEdge, ProjectedWall, Projection } from '../../../shared/projection/types.js'
import { decorationPaintBounds } from '../../../shared/decorations/presentation.js'
import { createEditorRenderPlan, editorPaintBounds } from './editor-render-plan'
import type { EditorPropDetail } from './editor-render-plan'
import { boundaryConnections, clipConnectionOpenings, connectionFrame, connectionSideSegments, drawConnectionCheeks } from './connection-geometry'
import { polylineBand, connectionBand, polygonInside } from '../../../shared/geometry/geometry.js'
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
import { noteLabelPositions } from './note-label-layout.js'
import { terrainInlayWallPaint, type InlayWallPaintPiece } from '../../../shared/terrain-inlay/wall-paint.js'
import { drawTerrainSlopeFinish } from './terrain-slope-renderer.js'
import { drawTerrainReliefLight } from './terrain-relief-paint.js'
import { reliefBounds, sampleTerrainRelief } from '../../../shared/geometry/terrain-relief.js'
import { drawStaircase } from './staircase-renderer.js'
import { staircasePatch, staircasePointAt, type StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import { planProjectedShorelines, shorelinePaintPadding } from '../../../shared/projection/shorelines.js'
import { intersectsVisualBounds, variableOffsetPolyline } from './visual-geometry'
import { drawTerrainFacadeFace } from './terrain-facade-renderer.js'
import { planFacadeFaces, type FacadeOpenings } from './terrain-facade-geometry.js'
import { cliffBandWidth, mixPoints, terrainBandCells, terrainEdgeRuns, type TerrainBandCell, type TerrainEdgeRun } from './terrain-edge-bands.js'
import { artStyleArtworkIds, artStyleSource } from '../../../shared/visual/art-style-sources.js'
import { mixVectorArtStyle, paintArtStyleArtwork } from './art-style-artwork.js'
import { applyArtStyleGrades, captureArtStyleTiles, captureArtStyleLineEdges, paintArtStyleMarks, type ArtStyleGradeSource } from './art-style-grade.js'
import { ArtStyleLineGuide } from './art-style-line-guide.js'
import { bitmapLineSamplingPadding } from './bitmap-line-art.js'
import { checkArtStyleSvg, colorArtStyleSvg } from './art-style-svg.js'
import { rasterizeCanonicalSvgInWorker } from '../ai/svg-worker-client.js'
import { activeLineArt, artStyleLightAmount, CURRENT_LINE_ART_PAINT_VERSION, preservesBitmapContours, usesSeparateArtStyle, type ActiveArtStyle, type ActiveArtStyles } from '../../../shared/visual/art-style.js'
import type { NormalizedStaticSvg } from '../../../shared/ai/svg.js'

/** Immutable asset references plus per-call shallow-copied resource records. No SceneDocument is accepted. */
export interface RasterSources {
  assetRefs: Record<string, AssetRef>
  assets: Record<string, AssetRecord>
  resources: ResourceBytePort
  vectorSources?: Readonly<Record<string, SvgAuthoringSource>>
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
  /** Clip formal output to a saved editing partition on the requested floor. */
  partitionId?: string
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
const EPS = 1e-6
const point = (x: number, y: number): PointMm => ({ x, y })
const signedArea = (points: PointMm[]) => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)
const positiveRing = (points: PointMm[]) => signedArea(points) < 0 ? [...points].reverse() : points
function wallBand(start: PointMm, end: PointMm, thickness: number): PointMm[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y), nx = -(end.y - start.y) / length * thickness / 2, ny = (end.x - start.x) / length * thickness / 2
  return positiveRing([point(start.x + nx, start.y + ny), point(start.x - nx, start.y - ny), point(end.x - nx, end.y - ny), point(end.x + nx, end.y + ny)])
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
function regionsPath(regions: NonNullable<ProjectedSurface['regionsMm']>, path = new Path2D()): Path2D {
  for (const region of regions) { addRing(path, region.outerMm); for (const hole of region.holesMm) addRing(path, hole) }
  return path
}
function surfacePath(area: ProjectedSurface): Path2D {
  return area.regionsMm ? regionsPath(area.regionsMm) : polygonPath(area.points)
}
function drawPlayerMasks(ctx: CanvasRenderingContext2D, projection: Projection): void {
  if (!projection.masks.length) return
  const publicRooms = projection.maskPublicRooms
  const path = new Path2D()
  let fillRule: CanvasFillRule = 'nonzero'
  if (publicRooms?.some(rooms => rooms.length > 0)) {
    const rings = playerMaskRings(projection.masks, publicRooms)
    if (!rings.length) return
    for (const ring of rings) addRing(path, ring)
    fillRule = 'evenodd'
  } else {
    for (const box of projection.masks.map(pointsBounds)) path.rect(box.x, box.y, box.width, box.height)
  }
  const bounds = pointsBounds(projection.masks.flat())
  ctx.save(); ctx.fillStyle = '#D8D5C5'
  ctx.clip(path, fillRule)
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  ctx.restore()
}
function worldTransform(ctx: CanvasRenderingContext2D, bounds: BoundsMm, scaleX: number, scaleY: number) { ctx.setTransform(scaleX, 0, 0, scaleY, -bounds.x * scaleX, -bounds.y * scaleY) }

interface RasterSet { bitmaps: Map<string, ImageBitmap>; byAssetId: Map<string, ImageBitmap>; styled?: Map<string, HTMLCanvasElement>;
  paintCache?: { key: string; image: HTMLCanvasElement }; readFrequently?: boolean; bitmapLine?: boolean
  bitmapLineIds?: ReadonlySet<string>; lineGuide?: ArtStyleLineGuide }

function lineBitmapIds(projection: Projection, sources: RasterSources): Set<string> {
  const result = new Set<string>()
  const line = activeLineArt(projection.artStyles)
  if (line?.parameters.paintVersion !== CURRENT_LINE_ART_PAINT_VERSION) return result
  // Classify only the audience-owned image consumers, before viewport culling.
  const add = (id: string) => {
    const asset = sources.assetRefs[id], vector = sources.vectorSources?.[id]
    if (asset?.origin.kind !== 'original' && !(line.filter ? artStyleSource(asset, vector, 3) : vector)) result.add(id)
  }
  for (const prop of projection.props) if (prop.appearance.kind === 'image') add(prop.appearance.assetId)
  for (const decoration of projection.decorations ?? []) add(decoration.assetId)
  return result
}

/** Keep the linking reach proportional when a small source is enlarged. */
function floorBitmapStrokeScale(artwork: NonNullable<Projection['floorArtwork']>, width: number, height: number, sx: number, sy = sx): number {
  return Math.min(4, Math.max(artwork.boundsMm.width * sx / width, artwork.boundsMm.height * sy / height))
}

interface ArtStylePreviewFrame {
  width: number
  height: number
  tiles: ImageData[]
  marks?: ImageData
  lineArtEdges?: Uint8Array
  bitmapLine?: boolean
  themeLineGuide?: ArtStyleGradeSource['themeLineGuide']
}
export interface ArtStylePreviewCache {
  readFrame(): ArtStylePreviewFrame | undefined
  writeFrame(frame: ArtStylePreviewFrame): void
  readSvg(source: SvgAuthoringSource): Promise<NormalizedStaticSvg>
  readVerifiedImage(record: AssetRecord): Promise<Blob>
}

async function readVectorArtStyle(sources: RasterSources, source: SvgAuthoringSource, width: number, height: number, look: ActiveArtStyle,
  signal?: AbortSignal, cache?: ArtStylePreviewCache) {
  const svg = await (cache?.readSvg(source) ?? sources.resources.read(source.normalizedSha256).then(bytes => checkArtStyleSvg(bytes, source)))
  checkCancelled(signal)
  return rasterizeCanonicalSvgInWorker(colorArtStyleSvg(svg, look), { width, height }, signal, 'paint-layer')
}

async function beginArtStyleArtwork(sources: RasterSources, raster: RasterSet, projection: Projection, signal?: AbortSignal, cache?: ArtStylePreviewCache): Promise<void> {
  const [first, ...remaining] = (projection.artStyles ?? []).filter(look =>
    look.preset !== 'lineArt' && look.preset !== 'original'
      && (!look.filter || look.parameters.strength > 0 && (look.parameters.depth > 0 || look.parameters.ink > 0)))
  if (!first) return
  const looks: ActiveArtStyles = [first, ...remaining]
  const vectorLooks = looks.filter(look => look.parameters.paintVersion === 3 && (look.parameters.depth || look.parameters.ink))
  const bySource = new Map<string, HTMLCanvasElement>()
  raster.styled = new Map()
  for (const id of artStyleArtworkIds(projection)) {
    checkCancelled(signal)
    const vector = sources.vectorSources?.[id]
    const source = artStyleSource(sources.assetRefs[id], vector, vectorLooks.length ? 3 : undefined)
    const bitmap = raster.byAssetId.get(id)
    if (!source || !bitmap) continue
    // One paint per verified source bitmap and look, even when a project has many aliases or instances.
    const key = `${source}:${sources.assetRefs[id].sha256}:${source === 'svg' ? vector?.normalizedSha256 : ''}`
    let paint = bySource.get(key)
    if (!paint && source !== 'svg') paint = paintArtStyleArtwork(bitmap, source, looks, signal)
    if (!paint && source === 'svg' && vector) {
      try {
        for (const look of vectorLooks) {
          const colored = await readVectorArtStyle(sources, vector, bitmap.width, bitmap.height, look, signal, cache)
          const next = mixVectorArtStyle(paint ?? bitmap, colored, look.parameters.strength / 100)
          if (paint) disposeCanvas(paint)
          paint = next
        }
      } catch (error) {
        if (paint) disposeCanvas(paint)
        throw error
      }
    }
    if (paint) { bySource.set(key, paint); raster.styled.set(id, paint) }
  }
}
export async function verifiedRenderBlob(resources: ResourceBytePort, record: AssetRecord): Promise<Blob> {
  const bytes = (await resources.read(record.sha256)).slice()
  const header = inspectImageBytes(bytes)
  if (bytes.length !== record.sizeBytes || header.mimeType !== record.mimeType || header.width !== record.pixelWidth
    || header.height !== record.pixelHeight || sha256Bytes(bytes) !== record.sha256) throw new Error(`绘制素材 ${record.sha256} 的实际格式、尺寸或 hash 不匹配。`)
  return new Blob([bytes.buffer], { type: record.mimeType })
}

export async function decodeRequired(sources: RasterSources, projection: Projection, signal?: AbortSignal, metrics?: Pick<RenderMetrics, 'resourceVerificationMs' | 'decoderQueueWaitMs' | 'imageDecodeMs'>, residentAssetIds?: ReadonlySet<string>, cache?: ArtStylePreviewCache): Promise<RasterSet> {
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
      const blob = await (cache ? cache.readVerifiedImage(resource) : verifiedRenderBlob(sources.resources, resource))
      checkCancelled(signal)
      if (!verifiedHashes.has(ref.sha256)) { verifiedHashes.add(ref.sha256); totalPixels += ref.pixelWidth * ref.pixelHeight }
      if (verifiedHashes.size > PACKAGE_LIMITS.uniqueImages || totalPixels > PACKAGE_LIMITS.totalImagePixels) throw new Error('绘制素材超过候选解码预算。')
      if (metrics) metrics.resourceVerificationMs += performance.now() - verificationStarted
      if (residentAssetIds && !residentAssetIds.has(id)) continue
      const queuedStarted = metrics ? performance.now() : 0
      let bitmap: ImageBitmap
      try {
        bitmap = await withRenderDecoderSlot(signal, async () => {
          const decodeStarted = metrics ? performance.now() : 0
          if (metrics) metrics.decoderQueueWaitMs += decodeStarted - queuedStarted
          try { return await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' }) }
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

function repeatMaterial(ctx: CanvasRenderingContext2D, paint: MaterialPaint, projection: Projection, raster: RasterSet): CanvasPattern {
  const material = projection.materials[paint.materialRef.id], bitmap = material && (raster.styled?.get(material.textureAssetId) ?? raster.byAssetId.get(material.textureAssetId))
  if (!bitmap) throw new Error('铺装所需位图没有完成解码。')
  const pattern = ctx.createPattern(bitmap, 'repeat')
  if (!pattern) throw new Error('无法建立重复材质。')
  pattern.setTransform(new DOMMatrix().translate(paint.originMm.x, paint.originMm.y).rotate(paint.rotationDeg).scale(paint.tileSizeMm.width / bitmap.width, paint.tileSizeMm.height / bitmap.height))
  return pattern
}

function paintImage(ctx: CanvasRenderingContext2D, paint: MaterialPaint, projection: Projection, raster: RasterSet): HTMLCanvasElement {
  const key = JSON.stringify([paint, projection.bounds, ctx.canvas.width, ctx.canvas.height])
  if (raster.paintCache?.key !== key) {
    if (raster.paintCache) disposeCanvas(raster.paintCache.image)
    const image = canvas(ctx.canvas.width, ctx.canvas.height)
    // Own the surface before setup; a synchronous paint failure aborts this render and its finally releases it.
    raster.paintCache = { key, image }
    const imageCtx = context(image, raster.readFrequently)
    // Full fixed-view rasterization keeps texture phase independent of clipping and mutable bounds.
    const b = projection.bounds
    worldTransform(imageCtx, b, image.width / b.width, image.height / b.height)
    imageCtx.fillStyle = repeatMaterial(imageCtx, paint, projection, raster)
    imageCtx.fillRect(b.x, b.y, b.width, b.height)
    if (paint.tint) { imageCtx.globalCompositeOperation = 'multiply'; imageCtx.fillStyle = paint.tint; imageCtx.fillRect(b.x, b.y, b.width, b.height); imageCtx.globalCompositeOperation = 'source-over' }
  }
  return raster.paintCache.image
}
function fillSurface(ctx: CanvasRenderingContext2D, path: Path2D | null, style: SurfaceStyle | null, projection: Projection, raster: RasterSet, fallback: string, materialPatches: ProjectedSurface['materialPatches'] = [], baseColor?: string,
  fillBase?: () => void): void {
  ctx.save(); if (path) ctx.clip(path); ctx.fillStyle = fallback
  const b = projection.bounds; ctx.fillRect(b.x, b.y, b.width, b.height)
  if (style && !baseColor) {
    if (fillBase) fillBase()
    else { ctx.save(); ctx.resetTransform(); ctx.globalAlpha = style.base.opacity; ctx.drawImage(paintImage(ctx, style.base, projection, raster), 0, 0); ctx.restore() }
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
          drawSurfaceRuleMask(maskCtx, b, mask.width, mask.height, [{ outerMm: overlay.boundaryMm, holesMm: [] }], overlay.blendWidthMm)
        }
        layerCtx.drawImage(paintImage(ctx, overlay.paint, projection, raster), 0, 0); layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(mask, 0, 0)
        ctx.save(); ctx.resetTransform(); ctx.globalAlpha = overlay.paint.opacity; ctx.drawImage(layer, 0, 0); ctx.restore()
      } finally { disposeCanvas(layer); disposeCanvas(mask) }
    }
  ctx.restore()
}

/** Terrain colors, water colors and material overlays share the same paint and mask. */
function drawTerrainSurface(ctx: CanvasRenderingContext2D, area: ProjectedSurface, projection: Projection, raster: RasterSet): void {
  if (area.bridgeSupport && !area.style && !area.materialPatches?.length) return
  const paint = (target: CanvasRenderingContext2D) => {
    const path = surfacePath(area)
    fillSurface(target, path, area.style, projection, raster, area.waterSurface?.color ?? '#C3BEA8', area.materialPatches, area.waterSurface?.color)
    drawTerrainReliefLight(target, area, path, projection.visual?.environment)
  }
  if (!area.boundaryBlendMm) { paint(ctx); return }
  const layer = canvas(ctx.canvas.width, ctx.canvas.height), mask = canvas(ctx.canvas.width, ctx.canvas.height)
  try {
    const target = context(layer, raster.readFrequently), masking = context(mask, raster.readFrequently)
    target.setTransform(ctx.getTransform()); paint(target)
    drawSurfaceRuleMask(masking, projection.bounds, mask.width, mask.height,
      area.regionsMm ?? [{ outerMm: area.points, holesMm: [] }], area.boundaryBlendMm, true)
    target.resetTransform(); target.globalCompositeOperation = 'destination-in'; target.drawImage(mask, 0, 0)
    ctx.save(); ctx.resetTransform(); ctx.drawImage(layer, 0, 0); ctx.restore()
  } finally { disposeCanvas(layer); disposeCanvas(mask) }
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
    // With calibrated artwork, an unstyled room keeps the underlying paint.
    if (projection.floorArtwork && !room.style) continue
    raster.lineGuide?.cover(polygonPath(room.points))
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
  const environment = projection.visual?.environment
  const shadow = wallShadowStyle(projection.theme?.shadowPresets.wall, environment)
  const directional = !!environment?.directionalLight?.intensity
  if (directional && shadow?.opacity) {
    const angle = shadow.directionDeg * Math.PI / 180, dx = Math.cos(angle) * shadow.offsetMm, dy = Math.sin(angle) * shadow.offsetMm
    const sweep = new Path2D()
    for (const ring of projectedWallFootprints(projection)) {
      const far = ring.map(p => point(p.x + dx, p.y + dy))
      addRing(sweep, ring); addRing(sweep, far)
      ring.forEach((p, index) => {
        const next = (index + 1) % ring.length
        addRing(sweep, [p, ring[next], far[next], far[index]])
      })
    }
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.globalAlpha = shadow.opacity
    ctx.fillStyle = shadow.color
    ctx.filter = `blur(${shadow.blurMm * Math.max(scaleX, scaleY)}px)`
    ctx.fill(sweep)
    ctx.restore()
  }
  const needsSilhouette = outline.widthMm !== 0 || !directional && !!shadow && shadow.opacity > 0
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
    if (!directional && shadow && shadow.opacity > 0) {
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
  if (prop.appearance.bridgeArt) { drawBridgeSymbol(ctx, prop.appearance.bridgeArt, v, prop.appearance.detailPercent); return }
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
  const presentation = projection.propPresentations?.[prop.id], source = effectivePropShadow(prop, presentation,
    projection.theme?.shadowPresets[prop.shadowClass], projection.visual?.environment)
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
  const environment = projection.visual?.environment
  const shadowSource = castShadow && detail === 'full' ? effectivePropShadow(prop, presentation, projection.theme?.shadowPresets[prop.shadowClass], environment) : null
  const shadow = shadowSource ? { ...shadowSource, directionDeg: propShadowDirection(prop, shadowSource, environment?.lightDirectionDeg) } : null
  const stretched = presentation?.mode !== 'nearSide' && !!shadow?.opacity && !!environment?.directionalLight?.intensity && !prop.shadowOverride && prop.shadowClass !== 'none'
  if (stretched) drawDirectionalSpriteShadow(ctx, projection, propPaintPolygon(prop), shadow,
    target => drawPropBody(target, prop, projection, raster, scaleX, scaleY, 'full', false), !!raster.readFrequently)
  if (presentation?.mode === 'nearSide' && castShadow && detail === 'full') drawNearSideShadow(ctx, prop, projection, scaleX, scaleY)
  ctx.save(); ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate((presentation?.mode === 'nearSide' ? 0 : prop.rotationDeg) * Math.PI / 180); ctx.globalAlpha = prop.appearance.opacity * (projection.groundView && presentation?.mode === 'nearSide' && prop.renderLayer === 'canopy' ? .16 : 1)
  if (presentation?.mode !== 'nearSide' && !stretched && shadow?.opacity) {
    const angle = shadow.directionDeg * Math.PI / 180
    // Canvas shadow offsets are device coordinates: rotation affects only the body alpha, never the light direction.
    ctx.shadowColor = shadowColor(shadow); ctx.shadowOffsetX = Math.cos(angle) * shadow.offsetMm * scaleX; ctx.shadowOffsetY = Math.sin(angle) * shadow.offsetMm * scaleY; ctx.shadowBlur = shadow.blurMm * Math.max(scaleX, scaleY)
  }
  const v = presentationBounds(prop, presentation)
  if (detail === 'full' && prop.appearance.mirrorY) { ctx.translate(0, 2 * v.y + v.height); ctx.scale(1, -1) }
  if (detail === 'outline') {
    ctx.strokeStyle = '#55614F'; ctx.fillStyle = '#A79878'; ctx.lineWidth = 1 / Math.max(scaleX, scaleY)
    ctx.globalAlpha = prop.appearance.opacity * .65; ctx.fillRect(v.x, v.y, v.width, v.height)
    ctx.globalAlpha = prop.appearance.opacity; ctx.strokeRect(v.x, v.y, v.width, v.height)
  } else if (prop.appearance.kind === 'image') {
    const bitmap = raster.styled?.get(prop.appearance.assetId) ?? raster.byAssetId.get(prop.appearance.assetId)
    if (!bitmap) throw new Error('物件所需位图没有完成解码。')
    ctx.drawImage(bitmap, v.x, v.y, v.width, v.height)
  } else symbol(ctx, prop)
  ctx.restore()
}
function drawProp(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, raster: RasterSet, scaleX: number, scaleY: number, detail: EditorPropDetail = 'full'): void {
  if (prop.waterAppearance) { drawOceanSprite(ctx, prop, projection, raster, 'over'); return }
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
function drawOceanSprite(ctx: CanvasRenderingContext2D, prop: Prop, projection: Projection, raster: RasterSet, phase: 'under' | 'over'): void {
  if (prop.appearance.kind !== 'image') throw new Error('水中物件需要实际图片。')
  const bitmap = raster.styled?.get(prop.appearance.assetId) ?? raster.byAssetId.get(prop.appearance.assetId)
  if (!bitmap) throw new Error('水中物件所需位图没有完成解码。')
  const envelope = propPresentationEnvelope(projection, prop, { full: false })
  drawVisualEntity(ctx, projection, prop.id, envelope.boundsMm, (target, local) => drawWaterProp(target, prop, local, bitmap, phase), !!raster.readFrequently)
  raster.lineGuide?.sprite(!!raster.bitmapLineIds?.has(prop.appearance.assetId), target => drawWaterProp(target, prop, projection, bitmap, phase, true))
}
function drawDecoration(ctx: CanvasRenderingContext2D, value: ProjectedDecoration, projection: Projection, raster: RasterSet): void {
  const bitmap = raster.styled?.get(value.assetId) ?? raster.byAssetId.get(value.assetId)
  if (!bitmap) throw new Error('轻量装饰所需位图没有完成解码。')
  const draw = (target: CanvasRenderingContext2D) => {
    target.save()
    try {
      target.translate(value.positionMm.x, value.positionMm.y); target.rotate(value.rotationDeg * Math.PI / 180); target.globalAlpha = value.opacity
      const bounds = value.visualBoundsMm; target.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height)
    } finally { target.restore() }
  }
  drawVisualEntity(ctx, projection, value.id, decorationPaintBounds(value), draw, !!raster.readFrequently)
  raster.lineGuide?.sprite(!!raster.bitmapLineIds?.has(value.assetId), draw)
}
export function connectionPolygon(connection: Pick<ProjectedConnection, 'start' | 'end' | 'widthMm' | 'route' | 'carvedFootprintMm' | 'inlayFootprintMm'>): PointMm[] {
  return connection.inlayFootprintMm ?? connection.carvedFootprintMm ?? (connection.route ? connectionBand(connection.route.centerlineMm, connection.widthMm) : wallBand(connection.start, connection.end, connection.widthMm))
}
function linePath(a: PointMm, b: PointMm): Path2D { const path = new Path2D(); path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); return path }
function excludeRing(ctx: CanvasRenderingContext2D, ring: PointMm[], bounds: BoundsMm): void {
  const path = new Path2D(); path.rect(bounds.x - 10000, bounds.y - 10000, bounds.width + 20000, bounds.height + 20000); addRing(path, ring); ctx.clip(path, 'evenodd')
}
function excludeRegions(ctx: CanvasRenderingContext2D, regions: NonNullable<ProjectedSurface['regionsMm']>, bounds: BoundsMm): void {
  const path = new Path2D()
  path.rect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2)
  ctx.clip(regionsPath(regions, path), 'evenodd')
}
/** Face thickness follows the real lower side, including canonical sources that are the lower area.
 * This surface decoration is distinct from the independently controlled world-direction shadow. */
export function terrainFace(edge: ProjectedTerrainEdge, projection: Pick<Projection, 'theme'>): PointMm[] {
  const delta = Math.abs(edge.elevationMm - edge.neighborElevationMm)
  if (!delta || edge.kind !== 'cliff') return []
  const a = edge.start, b = edge.end, length = Math.hypot(b.x - a.x, b.y - a.y), sign = edge.elevationMm > edge.neighborElevationMm ? 1 : -1
  const width = cliffBandWidth(edge, projection.theme)
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
/** Nonzero winding unions overlapping cells and bevels in one raster operation. */
function terrainBandPath(cells: TerrainBandCell[], from = 0, to = 1, variation = 0): Path2D {
  const path = new Path2D()
  const fraction = (p: PointMm, depth: number) => depth + Math.sin(p.x / 740 + p.y / 970) * variation
  const at = (p: PointMm, foot: PointMm, depth: number) => mixPoints(p, foot, fraction(p, depth))
  for (const { top: [a, b], foot: [c, d], bevels } of cells) {
    addRing(path, [at(a, c, from), at(b, d, from), at(b, d, to), at(a, c, to)])
    for (const { anchor, a, b } of bevels) addRing(path, [at(anchor, a, from), at(anchor, b, from), at(anchor, b, to), at(anchor, a, to)])
  }
  return path
}

function paintTerrainBand(ctx: CanvasRenderingContext2D, cells: TerrainBandCell[], path: Path2D, projection: Projection, raster: RasterSet, base?: string): void {
  if (base) { ctx.fillStyle = base; ctx.fill(path) }
  const styles = new Map<string, { style: SurfaceStyle; cells: TerrainBandCell[]; fallback: string }>()
  for (const cell of cells) {
    const style = cell.edge.surfaceStyle
    if (!style) continue
    const fallback = base ?? cell.edge.style.color, key = JSON.stringify([style, fallback]), group = styles.get(key)
    if (group) group.cells.push(cell)
    else styles.set(key, { style, cells: [cell], fallback })
  }
  for (const { style, cells: styled, fallback } of styles.values()) {
    const surface = terrainBandPath(styled)
    if (style.overlays.length || style.base.tint) fillSurface(ctx, surface, style, projection, raster, fallback)
    else {
      ctx.save()
      if (!base) { ctx.fillStyle = fallback; ctx.fill(surface) }
      ctx.fillStyle = repeatMaterial(ctx, style.base, projection, raster); ctx.globalAlpha = style.base.opacity
      ctx.fill(surface); ctx.restore()
    }
  }
}

function strokeTerrainRun(ctx: CanvasRenderingContext2D, run: TerrainEdgeRun, widthFor: (edge: ProjectedTerrainEdge) => number,
  blurScale = 0): void {
  const { edges, closed } = run
  const key = (edge: ProjectedTerrainEdge) => widthFor(edge) + ':' + edge.style.color
  const firstChange = closed ? edges.findIndex((row, i) => key(row.edge) !== key(edges[(i + edges.length - 1) % edges.length].edge)) : 0
  const ordered = firstChange > 0 ? [...edges.slice(firstChange), ...edges.slice(0, firstChange)] : edges
  for (let i = 0; i < ordered.length;) {
    const first = ordered[i], style = key(first.edge), width = widthFor(first.edge)
    const path = new Path2D(); path.moveTo(first.a.x, first.a.y)
    let j = i
    while (j < ordered.length && key(ordered[j].edge) === style) { path.lineTo(ordered[j].b.x, ordered[j].b.y); j++ }
    if (closed && j - i === ordered.length) path.closePath()
    if (width > 0) {
      ctx.save(); ctx.strokeStyle = first.edge.style.color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'butt'
      if (blurScale) { ctx.globalAlpha = .22; ctx.filter = `blur(${width * .3 * blurScale}px)` }
      ctx.stroke(path)
      // Finish a change of width/color at the shared vertex. Real openings keep butt ends.
      if (!blurScale && j - i < ordered.length) {
        const next = ordered[j] ?? (closed ? ordered[0] : undefined)
        const radius = next && Math.min(width, widthFor(next.edge)) / 2
        if (radius) {
          ctx.fillStyle = first.edge.style.color; ctx.beginPath(); ctx.arc(next.a.x, next.a.y, radius, 0, 2 * Math.PI); ctx.fill()
        }
      }
      ctx.restore()
    }
    i = j
  }
}
/** Clip to the visible support. A nested patch of matching water can share
 * its containing body's footprint, avoiding an artificial cut in the shoal. */
function clipShoreSurface(ctx: CanvasRenderingContext2D, projection: Projection, areaId: string | null, paintBounds: BoundsMm, wet = false): boolean {
  const surfaces = projection.terrain
  const sourceIndex = surfaces.findIndex(area => area.id === areaId)
  if (areaId !== null && sourceIndex < 0) return false
  const source = surfaces[sourceIndex], water = wet ? source?.waterSurface : undefined
  const sameWater = (area: ProjectedSurface) => !!water && area.waterSurface?.color === water.color && area.elevationMm === source.elevationMm
  const carrierIndex = water && !source.regionsMm ? surfaces.findIndex((area, i) => i < sourceIndex && sameWater(area) && !area.regionsMm
    && polygonInside(source.points, area.points)) : -1
  const index = carrierIndex < 0 ? sourceIndex : carrierIndex
  if (index >= 0) ctx.clip(surfacePath(surfaces[index]), 'evenodd')
  for (let i = index + 1; i < surfaces.length; i++) {
    const surface = surfaces[i]
    if (carrierIndex >= 0 && sameWater(surface)) continue
    if (!intersectsVisualBounds(paintBounds, pointsBounds(surface.points))) continue
    const outside = new Path2D()
    const { x, y, width, height } = projection.bounds
    outside.rect(x, y, width, height)
    outside.addPath(surfacePath(surface))
    ctx.clip(outside, 'evenodd')
  }
  return true
}

function drawTerrainShorelines(ctx: CanvasRenderingContext2D, projection: Projection, scale: number, signal?: AbortSignal): void {
  const trace = (points: PointMm[], closed: boolean): Path2D => {
    const path = new Path2D()
    points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y))
    if (closed) path.closePath()
    return path
  }
  for (const { points, closed, dryAreaId, wetAreaId, waterInward, style } of planProjectedShorelines(projection)) {
    checkCancelled(signal)
    const width = style.bandWidthMm
    const paintBounds = expandedBounds(points, shorelinePaintPadding(style))
    if (!intersectsVisualBounds(projection.bounds, paintBounds)) continue
    const path = trace(points, closed)
    const connections = boundaryConnections(projection.connections, points, closed, [dryAreaId, wetAreaId].filter((id): id is string => id !== null))
    ctx.save()
    ctx.beginPath(); ctx.rect(paintBounds.x, paintBounds.y, paintBounds.width, paintBounds.height); ctx.clip()
    clipConnectionOpenings(ctx, projection.bounds, connections)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const band = (radius: number, blur: number, color: string, opacity: number) => {
      ctx.lineWidth = width * radius * 2
      ctx.strokeStyle = color; ctx.globalAlpha = opacity
      ctx.filter = `blur(${width * blur * scale}px)`
      ctx.stroke(path)
    }
    ctx.save()
    if (clipShoreSurface(ctx, projection, dryAreaId, paintBounds)) {
      band(.21, .075, '#BE9E70', .27)
      band(.065, .028, '#A9926A', .18)
    }
    ctx.restore()
    if (clipShoreSurface(ctx, projection, wetAreaId, paintBounds, true)) {
      band(.92, .14, '#86C6BE', .29)
      band(.59, .15, '#97CBAC', .32)
      band(.23, .08, '#A6C9AA', .2)
      if (style.strokeWidthMm > 0) {
        ctx.filter = 'none'; ctx.strokeStyle = style.color
        const direction = waterInward ? 1 : -1
        const unit = Math.max(76, Math.min(480, width * .24))
        for (const [distance, opacity, phase] of [[.085, .56, 0], [.25, .26, 1.65]]) {
          const offset = points.map(({ x, y }) => direction * width * (distance + Math.sin(x / 1700 + y / 980 + phase) * distance * .21))
          ctx.globalAlpha = opacity
          ctx.lineWidth = style.strokeWidthMm * (phase ? .72 : 1)
          ctx.setLineDash([unit * 1.55, unit * .89, unit * .7, unit * 1.52, unit * 2.5, unit * 1.8])
          ctx.lineDashOffset = phase * unit
          ctx.stroke(trace(variableOffsetPolyline(points, offset, closed, 1.5), closed))
        }
      }
    }
    ctx.restore()
  }
}

function terrainRunOpenings(projection: Projection, run: TerrainEdgeRun) {
  const surfaceIds = [...new Set(run.edges.flatMap(({ edge }) => [edge.sourceAreaId, edge.neighborAreaId]).filter((id): id is string => id !== null))]
  const connections = boundaryConnections(projection.connections, run.points, run.closed, surfaceIds)
  const clip = (target: CanvasRenderingContext2D) => {
    clipConnectionOpenings(target, projection.bounds, connections)
    for (const { platform } of projection.bridgeEntrances ?? []) if (platform && surfaceIds.includes(platform.id)) {
      excludeRegions(target, platform.edgeOpening, projection.bounds)
    }
  }
  return { connections, clip }
}

/** Clear the whole inward-facing lip at the opening, including flush contacts. */
function terrainEdgePaint(projection: Projection): ProjectedTerrainEdge[] {
  const profiles = new Map(projection.terrain.flatMap(area => area.relief ? [[area.id, { grid: area.relief, bounds: reliefBounds(area.points) }] as const] : []))
  const edges = profiles.size ? projection.edges.flatMap(edge => {
    if (edge.kind !== 'cliff' || edge.customFinish) return [edge]
    const source = profiles.get(edge.sourceAreaId), neighbor = edge.neighborAreaId ? profiles.get(edge.neighborAreaId) : undefined
    if (!source && !neighbor) return [edge]
    const p = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 }
    const elevationMm = edge.elevationMm + (source ? sampleTerrainRelief(source.grid, source.bounds, p).offsetMm : 0)
    const neighborElevationMm = edge.neighborElevationMm + (neighbor ? sampleTerrainRelief(neighbor.grid, neighbor.bounds, p).offsetMm : 0)
    return Math.abs(elevationMm - neighborElevationMm) < 400 ? [] : [{ ...edge, elevationMm, neighborElevationMm }]
  }) : projection.edges
  const cuts = new Map<string, NonNullable<ProjectedSurface['regionsMm']>>()
  for (const { platform } of projection.bridgeEntrances ?? []) {
    if (!platform) continue
    cuts.set(platform.id, [...(cuts.get(platform.id) ?? []), ...platform.edgeOpening])
  }
  if (!cuts.size) return edges
  return edges.flatMap(edge => {
    const carrier = edge.elevationMm > edge.neighborElevationMm ? edge.sourceAreaId : edge.neighborAreaId
    const openings = carrier !== null && edge.kind === 'cliff' ? cuts.get(carrier) : undefined
    if (!openings) return [edge]
    return exposedEdgeSegments([[edge.start, edge.end]], openings).map(([start, end]) => ({ ...edge, start, end }))
  })
}

function drawTerrainLineInk(guide: ArtStyleLineGuide, projection: Projection): void {
  const shores = new Path2D()
  for (const [a, b] of projection.lineArtShorelines ?? []) shores.addPath(linePath(a, b))
  guide.stroke(shores, .64, 58, 1.4)
  // Decorative material bands may replace painted edges, while the physical
  // shoreline or change of level still belongs in the line drawing.
  for (const run of terrainEdgeRuns(projection.edges.filter(edge => edge.kind === 'cliff' || edge.shoreline))) {
    const cliff = run.edges[0].edge.kind === 'cliff'
    const contour = new Path2D()
    run.points.forEach((p, i) => i ? contour.lineTo(p.x, p.y) : contour.moveTo(p.x, p.y))
    if (run.closed) contour.closePath()
    guide.clipped(terrainRunOpenings(projection, run).clip, () => guide.stroke(contour, cliff ? .72 : .64, cliff ? 85 : 58, 1.4))
  }
}

function drawTerrainEdges(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, sx: number, sy: number): void {
  const suppressed = new Set(projection.visual?.suppressedTerrainEdgeIds ?? [])
  const surfaces = new Map(projection.terrain.map(area => [area.id, area]))
  for (const run of terrainEdgeRuns(projection.edges.filter(edge => !suppressed.has(edge.id)))) {
    const { kind } = run.edges[0].edge, cliff = projection.theme?.terrainCliff
    const { connections, clip } = terrainRunOpenings(projection, run)
    ctx.save(); clip(ctx)
    const high = run.highAreaId === null ? undefined : surfaces.get(run.highAreaId)
    if (high?.facade) {
      const cells = terrainBandCells(run, edge => cliffBandWidth(edge, projection.theme), -1)
      if (cells.length) {
        ctx.save(); ctx.clip(surfacePath(high))
        paintTerrainBand(ctx, cells, terrainBandPath(cells), projection, raster, '#303C42')
        ctx.restore()
      }
    } else if (kind === 'cliff') {
      const cells = terrainBandCells(run, edge => cliffBandWidth(edge, projection.theme), 1)
      ctx.save()
      if (high) {
        const outside = new Path2D(), { x, y, width, height } = projection.bounds
        outside.rect(x - 1, y - 1, width + 2, height + 2); outside.addPath(surfacePath(high)); ctx.clip(outside, 'evenodd')
      }
      if (cliff?.opacity) {
        const shadow = new Path2D()
        for (const { edge } of run.edges) {
          const ring = terrainShadow(edge, projection)
          if (ring.length) addRing(shadow, ring)
        }
        ctx.save(); ctx.filter = `blur(${cliff.blurMm * Math.max(sx, sy)}px)`; ctx.globalAlpha = cliff.opacity; ctx.fillStyle = cliff.color; ctx.fill(shadow); ctx.restore()
      }
      if (cells.length) {
        const face = terrainBandPath(cells)
        paintTerrainBand(ctx, cells, face, projection, raster, '#777D72')
        const layers = [
          { from: 0, to: .11, variation: 0, color: 'rgba(220,217,186,.19)' },
          { from: .30, to: .37, variation: .036, color: 'rgba(161,168,145,.18)' },
          { from: .67, to: .75, variation: .032, color: 'rgba(28,41,37,.22)' },
          { from: .90, to: 1, variation: 0, color: 'rgba(20,33,34,.30)' },
        ]
        for (const { from, to, variation, color } of layers) { ctx.fillStyle = color; ctx.fill(terrainBandPath(cells, from, to, variation)) }
        if (connections.length) { ctx.save(); ctx.clip(face); drawConnectionCheeks(ctx, connections, '#39443E', 48, .6); ctx.restore() }
      }
      ctx.restore()
    }
    if (kind === 'materialTransition') {
      strokeTerrainRun(ctx, run, edge => edge.style.bandWidthMm, Math.max(sx, sy))
      if (run.edges.some(({ edge }) => edge.surfaceStyle)) {
        const width = (edge: ProjectedTerrainEdge) => edge.style.bandWidthMm / 2
        const cells = [...terrainBandCells(run, width, 1), ...terrainBandCells(run, width, -1)].filter(cell => cell.edge.surfaceStyle)
        if (cells.length) paintTerrainBand(ctx, cells, terrainBandPath(cells), projection, raster)
      }
    }
    strokeTerrainRun(ctx, run, edge => edge.kind === 'shore' && edge.shorePaint ? 0 : edge.style.strokeWidthMm)
    for (const { edge } of run.edges) if (!edge.shorePaint && (edge.shoreline || kind === 'shore')) {
      const shore = projection.theme?.edgeStyles.shore ?? { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 }
      if (!shore.strokeWidthMm) continue
      const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y, length = Math.hypot(dx, dy)
      const shift = Math.min(shore.bandWidthMm, 180) * .65, nx = dy / length * shift, ny = -dx / length * shift
      ctx.save(); ctx.strokeStyle = shore.color; ctx.lineWidth = shore.strokeWidthMm; ctx.lineCap = 'round'; ctx.setLineDash([145, 90, 65, 115]); ctx.lineDashOffset = -(edge.start.x + edge.start.y) % 415; ctx.stroke(linePath(point(edge.start.x + nx, edge.start.y + ny), point(edge.end.x + nx, edge.end.y + ny))); ctx.restore()
    }
    ctx.restore()
  }
}
const defaultRoadColor = '#B49D77'
const pavementOverlapMm = 55
type Approach = NonNullable<ProjectedBridgeEntrance['approach']>
const approachRing = (approach: Approach) => [...approach.sides[0], ...approach.sides[1].slice().reverse()]
const ringSegments = (points: PointMm[]): [PointMm, PointMm][] => points.map((a, i) => [a, points[(i + 1) % points.length]])
const samePoint = (a: PointMm, b: PointMm) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS
const terminalCourseIndex = (path: ProjectedPath, end: ProjectedBridgeEntrance['end']) => end === 'start' ? 0 : (path.paving?.length ?? 0) - 1
const terminalCourse = (path: ProjectedPath, end: ProjectedBridgeEntrance['end']) => path.paving?.[terminalCourseIndex(path, end)]
const sameBasePaint = (a: ProjectedPath, b: ProjectedPath) => !!a.style && !!b.style && canonicalJson(a.style.base) === canonicalJson(b.style.base)

function extendPavement(path: ProjectedPath, caps: Parameters<typeof replacePathCaps>[1]): ProjectedPath {
  if (!caps.length) return path
  return { ...path, points: replacePathCaps(path.points, caps), ...(path.paving && { paving: path.paving.map((course, i, all) =>
    i === 0 || i === all.length - 1 ? { ...course, points: replacePathCaps(course.points, caps) } : course,
  ) }) }
}

function pavingSplice(ctx: CanvasRenderingContext2D, a: PointMm, b: PointMm, opacity: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.strokeStyle = '#455056'; ctx.lineWidth = 44; ctx.globalAlpha = opacity * .55
  ctx.stroke(linePath(a, b)); ctx.restore()
}

function fillPavement(ctx: CanvasRenderingContext2D, outline: Path2D | null, path: ProjectedPath, projection: Projection, raster: RasterSet): void {
  const courses = path.paving, style = path.style
  if (!courses || courses.length < 2) {
    const base = courses?.[0]?.paint
    fillSurface(ctx, outline, base && style ? { ...style, base } : style, projection, raster, defaultRoadColor)
    return
  }
  fillSurface(ctx, outline, style, projection, raster, defaultRoadColor, [], undefined, () => {
    for (const [index, { points, paint }] of courses.entries()) {
      if (!intersectsVisualBounds(pointsBounds(points), projection.bounds)) continue
      ctx.save()
      const polygon = polygonPath(points)
      ctx.globalAlpha = paint.opacity
      if (paint.tint) {
        ctx.clip(polygon); ctx.resetTransform()
        ctx.drawImage(paintImage(ctx, paint, projection, raster), 0, 0)
      } else {
        ctx.fillStyle = repeatMaterial(ctx, paint, projection, raster); ctx.fill(polygon)
      }
      ctx.restore()
      if (index) pavingSplice(ctx, points[0], points.at(-1)!, paint.opacity)
    }
  })
}

function roadOutline(segments: [PointMm, PointMm][], caps: [PointMm, PointMm][]): Path2D {
  const on = (p: PointMm, a: PointMm, b: PointMm) => Math.abs(Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(b.x - a.x, b.y - a.y)) < EPS
  const kept = segments.filter(([a, b]) => !caps.some(([c, d]) => on(a, c, d) && on(b, c, d)))
  const split = kept.findIndex(([a], i) => !samePoint(kept[(i + kept.length - 1) % kept.length][1], a))
  const ordered = split > 0 ? [...kept.slice(split), ...kept.slice(0, split)] : kept
  const path = new Path2D()
  for (const [i, [a, b]] of ordered.entries()) {
    if (!i || !samePoint(ordered[i - 1][1], a)) path.moveTo(a.x, a.y)
    path.lineTo(b.x, b.y)
  }
  if (split === -1 && kept.length) path.closePath()
  return path
}

function drawPavementLayer(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet,
  points: PointMm[], paint: (target: CanvasRenderingContext2D, local: Projection) => void, outline?: Path2D): void {
  const box = pointsBounds(points), b = projection.bounds
  const sx = ctx.canvas.width / b.width, sy = ctx.canvas.height / b.height
  const x0 = Math.max(0, Math.floor((box.x - b.x) * sx)), y0 = Math.max(0, Math.floor((box.y - b.y) * sy))
  const x1 = Math.min(ctx.canvas.width, Math.ceil((box.x + box.width - b.x) * sx))
  const y1 = Math.min(ctx.canvas.height, Math.ceil((box.y + box.height - b.y) * sy))
  if (x1 <= x0 || y1 <= y0) return
  const layer = canvas(x1 - x0, y1 - y0)
  try {
    const target = context(layer, raster.readFrequently)
    const bounds = { x: b.x + x0 / sx, y: b.y + y0 / sy, width: layer.width / sx, height: layer.height / sy }
    worldTransform(target, bounds, sx, sy)
    paint(target, { ...projection, bounds })
    ctx.save()
    if (outline) ctx.clip(outline)
    ctx.resetTransform(); ctx.drawImage(layer, x0, y0); ctx.restore()
  } finally { disposeCanvas(layer) }
}

/** Join the two finishes over the supported transition. The mask starts
 * inside the bridge so its antialiasing stays clear of the join. */
function blendApproach(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet,
  approach: Approach, bridge: ProjectedPath, road: ProjectedPath, end: ProjectedBridgeEntrance['end']): void {
  const bridgePaint = terminalCourse(bridge, end)?.paint, roadPaint = terminalCourse(road, approach.end)?.paint
  const sharedPaving = !!bridgePaint && !!roadPaint && sameBasePaint(bridge, road)
  if (JSON.stringify(bridge.style) === JSON.stringify(road.style) && bridgePaint === roadPaint) return
  const a = approach.sides[0][0], b = approach.sides[1][0]
  const width = Math.hypot(b.x - a.x, b.y - a.y)
  const upstream = (p: PointMm) => point(p.x + (b.y - a.y) / width * pavementOverlapMm,
    p.y - (b.x - a.x) / width * pavementOverlapMm)
  const points = [upstream(a), ...approachRing(approach), upstream(b)]
  drawPavementLayer(ctx, projection, raster, points, (target, local) => {
    fillSurface(target, null, bridgePaint && bridge.style ? { ...bridge.style, base: bridgePaint } : bridge.style, local, raster, defaultRoadColor)
    target.globalCompositeOperation = 'destination-in'
    if (sharedPaving && bridgePaint !== roadPaint) {
      target.fillStyle = '#000'; target.fill(polygonPath(points))
      return
    }
    const fade = target.createLinearGradient(approach.from.x, approach.from.y, approach.to.x, approach.to.y)
    if (approach.deckEdgeMm) {
      const dx = approach.to.x - approach.from.x, dy = approach.to.y - approach.from.y
      const station = ((approach.deckEdgeMm.x - approach.from.x) * dx + (approach.deckEdgeMm.y - approach.from.y) * dy) / (dx * dx + dy * dy)
      const seam = Math.max(0, Math.min(1, station))
      fade.addColorStop(seam, '#000'); fade.addColorStop(seam, 'transparent')
    } else {
      fade.addColorStop(0, '#000'); fade.addColorStop(.25, '#000'); fade.addColorStop(.87, 'transparent'); fade.addColorStop(1, 'transparent')
    }
    target.fillStyle = fade
    target.fill(polygonPath(points))
  })
}

function bridgePaintCap(bridge: NonNullable<ProjectedPath['bridge']>, end: ProjectedBridgeEntrance['end'],
  approach?: Approach, reachMm = 0): [PointMm, PointMm] {
  const cap = bridgeWalkCap(bridge, end), points = bridge.centerlineMm
  const [a, b] = end === 'start' ? [points[0], points[1]] : [points.at(-1)!, points.at(-2)!]
  const length = Math.hypot(a.x - b.x, a.y - b.y)
  // Both road fills overlap by a short distance where the wearing surface is
  // identical, including the opaque beginning of a two-material transition.
  const reach = approach ? -Math.max(0, Math.hypot(approach.from.x - a.x, approach.from.y - a.y) - pavementOverlapMm) : reachMm
  const shift = (p: PointMm) => point(p.x + (a.x - b.x) / length * reach, p.y + (a.y - b.y) / length * reach)
  return [shift(cap[0]), shift(cap[1])]
}

function drawPaths(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, sx: number, sy: number): void {
  const entrances = projection.bridgeEntrances ?? []
  const byBridge = new Map<string, ProjectedBridgeEntrance[]>(), byRoad = new Map<string, ProjectedBridgeEntrance[]>()
  const append = (groups: Map<string, ProjectedBridgeEntrance[]>, id: string, entrance: ProjectedBridgeEntrance) => {
    const list = groups.get(id)
    if (list) list.push(entrance)
    else groups.set(id, [entrance])
  }
  for (const entrance of entrances) {
    append(byBridge, entrance.bridgeId, entrance)
    if (entrance.approach) append(byRoad, entrance.approach.pathId, entrance)
  }
  const paintPaths = projection.paths.map(path => {
    const road = byRoad.get(path.id)
    const thresholds = path.doorThresholds?.map(({ cap, inside }) => ({ cap, sides: [[inside[0]], [inside[1]]] as [PointMm[], PointMm[]] })) ?? []
    if (road || thresholds.length) return extendPavement(path, [...thresholds, ...(road?.map(entrance => entrance.approach!) ?? [])])
    const bridge = path.bridge
    const extensions = bridge ? (byBridge.get(path.id) ?? []).flatMap(({ end, platform, approach }) => {
      if (!approach && !platform?.laneReachMm) return []
      const cap = bridgeWalkCap(bridge, end)
      const [a, b] = bridgePaintCap(bridge, end, approach, platform?.laneReachMm)
      return [{ cap, sides: [[a], [b]] as [PointMm[], PointMm[]] }]
    }) : []
    return extendPavement(path, extensions)
  })
  const junctions = pathJunctionOutlines({ ...projection, paths: paintPaths }), byId = new Map(paintPaths.map(path => [path.id, path]))
  for (const [roadId, joins] of byRoad) {
    const road = byId.get(roadId)!
    if (!road.paving?.length) continue
    const paving = [...road.paving], matched = new Set<number>()
    for (const { approach, bridgeId, end } of joins) {
      const bridge = byId.get(bridgeId)!, bridgeCourse = terminalCourse(bridge, end)
      const index = terminalCourseIndex(road, approach!.end)
      if (!bridgeCourse || !sameBasePaint(bridge, road) || matched.has(index)) continue
      paving[index] = { ...paving[index], paint: joinedPavingPaint(bridgeCourse, paving[index], approach!.to) }
      matched.add(index)
    }
    byId.set(roadId, { ...road, paving })
  }
  for (const { id } of paintPaths) {
    const path = byId.get(id)!
    const bridge = path.bridge, relief = bridge?.relief
    const offset = relief?.depthMm ? bridgeSideOffset(relief.depthMm) : undefined
    const body = bridge ? [...path.points, ...bridge.outline] : path.points
    const bounds = expandedBounds(offset && bridge ? [...body, ...bridge.outline.map(({ x, y }) => point(x + offset.x, y + offset.y))] : body,
      Math.max(path.edgeStyle.bandWidthMm * 2, offset && !bridge?.structure ? 144 : 0))
    drawVisualEntity(ctx, projection, path.id, bounds, (ctx, projection) => {
      const outline = polygonPath(path.points), edge = path.edgeStyle
      const bridgeEnds = byBridge.get(path.id) ?? [], roadEnds = byRoad.get(path.id) ?? [], caps: [PointMm, PointMm][] = []
      ctx.save()
      if (bridge) {
        const cuts = bridge.structure ? bridgeEnds.flatMap(({ platform }) => platform?.shoulderCut ?? []) : []
        const perimeter = exposedEdgeSegments(ringSegments(bridge.outline), cuts)
        if (offset && relief) {
          ctx.save()
          excludeRing(ctx, bridge.outline, projection.bounds)
          // Raised platforms and room floors occlude the side face. For a
          // compact bridge, same-height ground can receive a contact shadow.
          for (const area of [...projection.terrain, ...projection.rooms]) {
            if (area.elevationMm < relief.elevationMm || !intersectsVisualBounds(pointsBounds(area.points), bounds)) continue
            if (!bridge.structure && area.elevationMm === relief.elevationMm && !projection.rooms.includes(area)) continue
            excludeRegions(ctx, area.regionsMm ?? [{ outerMm: area.points, holesMm: [] }], projection.bounds)
          }
          if (!bridge.structure) {
            for (const { approach, platform } of bridgeEnds) {
              if (approach) excludeRing(ctx, approachRing(approach), projection.bounds)
              if (platform) excludeRegions(ctx, platform.shoulderCut, projection.bounds)
            }
            drawBridgeContactShadow(ctx, bridge, offset)
          }
          drawBridgeSides(ctx, bridge, offset, perimeter, projection.visual?.environment)
          ctx.restore()
        }
        ctx.save()
        // A road and its bridge can occupy different editor layers. Clear the
        // wearing-surface join whichever one happens to be painted first.
        for (const { end, approach } of bridgeEnds) if (approach) {
          excludeRing(ctx, approachRing(approach), projection.bounds)
          caps.push(bridgePaintCap(bridge, end, approach))
        }
        ctx.save()
        for (const { platform } of bridgeEnds) if (platform) excludeRegions(ctx, platform.shoulderCut, projection.bounds)
        drawBridgeStructure(ctx, bridge, cuts.length ? roadOutline(perimeter, []) : undefined)
        ctx.restore()
        for (const { end, platform } of bridgeEnds) if (platform?.shoulderCut.length) {
          ctx.save(); ctx.clip(regionsPath(platform.shoulderCut), 'evenodd')
          drawBridgeBearingSeat(ctx, bridge, end, platform.contactMm)
          ctx.restore()
        }
        drawBridgeLandings(ctx, bridge)
        ctx.restore()
      }
      for (const { approach } of roadEnds) if (approach) caps.push([approach.sides[0][0], approach.sides[1][0]])
      for (const { inside } of path.doorThresholds ?? []) caps.push(inside)
      const segments = junctions.get(path.id)
      const exterior = segments || caps.length ? roadOutline(segments ?? ringSegments(path.points), caps) : outline
      const guide = raster.lineGuide
      if (guide) {
        if (bridge) guide.cover(polygonPath(bridge.outline))
        guide.cover(outline)
        guide.stroke(exterior, bridge ? .82 : .58, bridge ? 99 : 53, bridge ? 1.55 : 1.12)
      }
      if (edge.bandWidthMm) {
        ctx.save(); ctx.globalAlpha = .22; ctx.filter = `blur(${edge.bandWidthMm * .3 * Math.max(sx, sy)}px)`; ctx.strokeStyle = edge.color; ctx.lineWidth = edge.bandWidthMm; ctx.lineJoin = 'round'; ctx.stroke(exterior); ctx.restore()
      }
      if (caps.length || segments || (path.paving?.length ?? 0) > 1) {
        // Apply the final contour once, after all paint is composited. Clipping
        // the underpaint and texture separately leaves a bright hairline in an overlap.
        drawPavementLayer(ctx, projection, raster, path.points, (target, local) => {
          fillPavement(target, null, path, local, raster)
          for (const { approach, bridgeId, end } of roadEnds) if (approach) {
            const linked = byId.get(bridgeId)!
            blendApproach(target, local, raster, approach, linked, path, end)
            const bridgePaint = terminalCourse(linked, end)?.paint, roadPaint = terminalCourse(path, approach.end)?.paint
            if (bridgePaint && roadPaint && bridgePaint !== roadPaint && sameBasePaint(linked, path)) {
              pavingSplice(target, approach.sides[0].at(-1)!, approach.sides[1].at(-1)!, roadPaint.opacity)
            }
          }
        }, outline)
      } else fillPavement(ctx, outline, path, projection, raster)
      const stairs = path.stairs
      if (stairs) {
        const geometry = drawStaircase(ctx, stairs.centerlineMm, stairs.widthMm, stairs.config, { widthSections: stairs.widthSections })
        guide?.treads(geometry, outline)
      }
      if (edge.strokeWidthMm) { ctx.strokeStyle = edge.color; ctx.lineWidth = edge.strokeWidthMm; ctx.lineJoin = 'round'; ctx.stroke(exterior) }
      for (const { approach, bridgeId, end } of roadEnds) if (approach?.deckEdgeMm) {
        const joined = byId.get(bridgeId)!.bridge!
        const cap = bridgeWalkCap(joined, end)
        drawBridgeDeckEdge(ctx, cap, joined.finish)
        guide?.stroke(linePath(...cap), .57, 46)
      }
      for (const { cap: [outer], inside: [a, b] } of path.doorThresholds ?? []) {
        const depth = Math.hypot(a.x - outer.x, a.y - outer.y)
        const inset = Math.min(66, depth * .35) / depth
        const back = (p: PointMm) => point(p.x + (outer.x - a.x) * inset, p.y + (outer.y - a.y) * inset)
        const sill = polygonPath([a, b, back(b), back(a)])
        ctx.fillStyle = 'rgba(11,19,22,.62)'; ctx.fill(sill)
        ctx.strokeStyle = 'rgba(196,190,164,.36)'; ctx.lineWidth = 16; ctx.stroke(linePath(back(a), back(b)))
      }
      if (bridge) {
        ctx.strokeStyle = 'rgba(14,23,25,.65)'; ctx.lineWidth = 66; ctx.lineJoin = 'round'; ctx.stroke(exterior)
        ctx.strokeStyle = 'rgba(170,192,192,.38)'; ctx.lineWidth = 20; ctx.stroke(exterior)
      }
      ctx.restore()
    }, !!raster.readFrequently)
  }
}

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
function drawStoneStairLandings(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet,
  c: ProjectedConnection, stair: StaircaseGeometry, footprint: PointMm[]): void {
  if (c.carvedFootprintMm || c.inlayFootprintMm || !c.surfaceIds) return
  const depth = Math.min(620, c.widthMm * .33, stair.lengthMm * .16)
  const surfaces = [...projection.terrain, ...projection.rooms]
  for (const [index, surfaceId] of c.surfaceIds.entries()) {
    const start = index === 0, range = c.staircase?.range
    if (range && (start ? range.startPpm !== 0 : range.endPpm !== 1_000_000)) continue
    const supportIndex = surfaces.findIndex(area => area.id === surfaceId)
    const support = surfaces[supportIndex]
    if (!support?.style) continue
    const tip = start ? 0 : stair.lengthMm
    const inner = start ? depth : stair.lengthMm - depth
    const patch = staircasePatch(stair, Math.min(inner, tip), Math.max(inner, tip))
    const from = staircasePointAt(stair, tip), to = staircasePointAt(stair, inner)
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) continue
    ctx.save()
    ctx.clip(polygonPath(footprint))
    for (const cover of stair.covers) excludeRing(ctx, cover.polygonMm, projection.bounds)
    drawPavementLayer(ctx, projection, raster, patch, (target, local) => {
      target.save(); target.clip(surfacePath(support), 'evenodd')
      for (const cover of surfaces.slice(supportIndex + 1)) {
        if (cover.bridgeSupport || !intersectsVisualBounds(pointsBounds(cover.points), local.bounds)) continue
        excludeRegions(target, cover.regionsMm ?? [{ outerMm: cover.points, holesMm: [] }], local.bounds)
      }
      fillSurface(target, null, support.style, local, raster, '#C3BEA8', support.materialPatches)
      target.restore()
      const fade = target.createLinearGradient(from.x, from.y, to.x, to.y)
      fade.addColorStop(0, '#000'); fade.addColorStop(.28, '#000B'); fade.addColorStop(1, 'transparent')
      target.globalCompositeOperation = 'destination-in'; target.fillStyle = fade
      target.fill(polygonPath(patch))
    }, polygonPath(patch))
    ctx.restore()
  }
}

function drawConnectionBody(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, c: ProjectedConnection): void {
  if (c.staircase) {
    if (c.staircase.range) {
      const { staircase: _staircase, ...underlay } = c
      drawConnectionBody(ctx, projection, raster, { ...underlay, kind: 'ramp', blocksMovement: false })
    }
    const footprintMm = connectionPolygon(c), rise = c.toElevationMm - c.fromElevationMm
    const stair = drawStaircase(ctx, c.staircaseCenterlineMm ?? c.inlayCenterlineMm ?? c.route?.centerlineMm ?? [c.start, c.end], c.widthMm, c.staircase,
      { footprintMm, ascending: rise >= 0, riseMm: Math.abs(rise) })
    raster.lineGuide?.treads(stair, polygonPath(footprintMm), rise >= 0)
    if (c.staircase.preset === 'carved-rock' || c.staircase.preset === 'rough-stone') drawStoneStairLandings(ctx, projection, raster, c, stair, footprintMm)
    if (c.blocksMovement) { ctx.save(); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 35; ctx.stroke(polygonPath(connectionPolygon(c))); ctx.restore() }
    return
  }
  if (c.inlayFootprintMm) {
    if (c.inlayAppearance !== 'source-ground' && !projection.inlays?.some(inlay => inlay.id === c.id && inlay.finish) && c.style) fillSurface(ctx, polygonPath(c.inlayFootprintMm), c.style, projection, raster, '#B5A281')
    if (c.blocksMovement) { ctx.save(); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 35; ctx.stroke(polygonPath(c.inlayFootprintMm)); ctx.restore() }
    return
  }
  if (c.carvedFootprintMm) {
    if (c.style) fillSurface(ctx, polygonPath(c.carvedFootprintMm), c.style, projection, raster, '#B5A281')
    if (c.blocksMovement) { ctx.save(); ctx.strokeStyle = '#9B493B'; ctx.lineWidth = 35; ctx.stroke(polygonPath(c.carvedFootprintMm)); ctx.restore() }
    return
  }
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
        const lip = linePath(frame.at(distance, -half), frame.at(distance, half))
        target.strokeStyle = '#39443E'; target.lineWidth = 18; target.globalAlpha = .62; target.stroke(lip)
        if (depth * Math.min(sx, sy) >= 1.6) raster.lineGuide?.stroke(lip, .46, 18, .8)
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
  for (const c of projection.connections) {
    const points = connectionPolygon(c)
    const guide = raster.lineGuide
    if (guide) {
      const footprint = polygonPath(points)
      guide.cover(footprint)
      const path = c.inlayFootprintMm || c.carvedFootprintMm ? footprint : roadOutline(connectionSideSegments(c), [])
      guide.stroke(path, c.route?.stairStyle === 'naturalRock' ? .37 : .58, 45, 1.12)
    }
    drawVisualEntity(ctx, projection, c.id, expandedBounds(points, 85), (target, local) => drawConnectionBody(target, local, raster, c), !!raster.readFrequently)
  }
}
function drawRockBody(ctx: CanvasRenderingContext2D, rock: NonNullable<Projection['rocks']>[number]) {
  ctx.save()
  // Cut shoulders use actual affine geometry but grant no walkable width.
  const apron = new Path2D()
  for (const patch of rock.patches) if (patch.kind === 'apron') addRing(apron, patch.pointsMm)
  ctx.fillStyle = '#8E816B'; ctx.fill(apron)
  // A single opaque footprint prevents native antialiasing between actual
  // adjacent triangles from exposing the background as false cracks.
  const base = new Path2D()
  for (const facet of rock.facets) addRing(base, facet.pointsMm)
  ctx.fillStyle = '#756A58'; ctx.fill(base)
  const fills: { fill: string; opacity: number; path: Path2D }[] = []
  for (const facet of rock.facets) {
    let entry = fills.at(-1)
    if (!entry || entry.fill !== facet.fill || entry.opacity !== facet.opacity) { entry = { fill: facet.fill, opacity: facet.opacity, path: new Path2D() }; fills.push(entry) }
    addRing(entry.path, facet.pointsMm)
  }
  for (const entry of fills) { ctx.fillStyle = entry.fill; ctx.globalAlpha = entry.opacity; ctx.fill(entry.path) }
  for (const stroke of rock.strokes) { ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.widthMm; ctx.globalAlpha = stroke.opacity; const path = new Path2D(); stroke.pointsMm.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); ctx.stroke(path) }
  ctx.globalAlpha = 1
  // All walk triangles are filled as one path. Shared diagonals introduce no
  // edge marks, and wall decoration never narrows the actual visible corridor.
  const path = new Path2D()
  for (const patch of rock.patches) if (patch.kind === 'walk') addRing(path, patch.pointsMm)
  ctx.fillStyle = '#B5A281'; ctx.fill(path)
  ctx.restore()
}
/** Height-aware finite after walls. Decorations remain outside the complete
 * actual walk; the geometry is never reconstructed from the inactive route. */
function drawTerrainInlays(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet): void {
  for (const inlay of projection.inlays ?? []) drawVisualEntity(ctx, projection, inlay.id, inlay.paintBoundsMm, (target, local) => {
    const apron = new Path2D(), walk = new Path2D()
    for (const patch of inlay.patches) addRing(patch.kind === 'walk' ? walk : apron, patch.pointsMm)
    target.save()
    try {
      // Actual source ownership supplies the same world-aligned material and
      // authored overlays as the adjacent top; a uniform rock-colored fill
      // would turn even a shallow, continuous opening into a dark board.
      for (const patch of inlay.groundSurfaces ?? inlay.apronSurfaces) {
        const source = local.terrain.find(area => area.id === patch.sourceAreaId)
        if (!source) throw Error('实际开口缺少已过滤的来源材质。')
        const path = new Path2D()
        for (const region of patch.regionsMm) { addRing(path, region.outerMm); for (const hole of region.holesMm) addRing(path, hole) }
        target.save()
        try { target.clip(path, 'evenodd'); fillSurface(target, inlay.groundSurfaces ? polygonPath(inlay.footprintMm) : apron, source.style, local, raster, '#C3BEA8', source.materialPatches) }
        finally { target.restore() }
      }
      const wallGroups = new Map<string | null, InlayWallPaintPiece[]>()
      for (const piece of terrainInlayWallPaint(inlay.walls)) {
        if (Math.hypot(piece.topMm.x - piece.footMm.x, piece.topMm.y - piece.footMm.y) <= EPS) continue
        const group = wallGroups.get(piece.lowSourceAreaId) ?? []
        group.push(piece); wallGroups.set(piece.lowSourceAreaId, group)
      }
      for (const [lowSourceAreaId, pieces] of wallGroups) {
        target.save()
        try {
          // A cut wall may occupy only the nonwalk apron; a fill wall may
          // occupy only its real, untouched lower visible source top.
          if (lowSourceAreaId === null) target.clip(polygonPath(inlay.footprintMm))
          else {
            const low = local.terrain.find(area => area.id === lowSourceAreaId)
            if (!low) throw Error('实际外露壁缺少已过滤的低侧顶面。')
            target.clip(surfacePath(low), 'evenodd')
            const rank = local.terrain.indexOf(low)
            for (const cover of local.terrain.slice(rank + 1)) {
              // Sequential exclusions preserve holes instead of reopening
              // overlapping higher-priority coverage with one even-odd mask.
              const exclude = new Path2D(); exclude.rect(local.bounds.x - 10000, local.bounds.y - 10000, local.bounds.width + 20000, local.bounds.height + 20000)
              exclude.addPath(surfacePath(cover)); target.clip(exclude, 'evenodd')
            }
          }
          excludeRing(target, inlay.walkFootprintMm, local.bounds)
          // One opaque footprint prevents independently antialiased strips
          // from exposing the source top at their shared diagonals/corners.
          const footprint = new Path2D()
          for (const piece of pieces) addRing(footprint, piece.pointsMm)
          target.fillStyle = '#756D5D'; target.fill(footprint)
          for (const piece of pieces) {
            const top = piece.topMm, foot = piece.footMm
            const shade = target.createLinearGradient(top.x, top.y, foot.x, foot.y)
            shade.addColorStop(0, '#AA9A7B'); shade.addColorStop(.4, '#756D5D'); shade.addColorStop(1, '#4E5147')
            target.fillStyle = shade; target.fill(polygonPath(piece.pointsMm))
          }
        } finally { target.restore() }
      }
      if (!inlay.groundSurfaces) {
        const style = inlay.finish && local.connections.find(c => c.id === inlay.id)?.style
        if (style) fillSurface(target, walk, style, local, raster, '#B5A281')
        else { target.fillStyle = '#B5A281'; target.fill(walk) }
      }
      const staircase = local.connections.find(c => c.id === inlay.id)?.staircase
      drawTerrainSlopeFinish(target, inlay, local.visual?.environment.lightDirectionDeg ?? 315, !!staircase && !staircase.range)
      if (inlay.finish && inlay.groundSurfaces && local.visual) {
        // Source-ground keeps authored grass at its exact world position. The
        // slope is painted after old cliffs; restore only its bounded grass
        // portion rather than moving or deleting the existing decoration.
        const grass = local.visual.edgeLooks.filter(look => look.kind === 'grass')
        if (grass.length) {
          const grassIds = new Set(grass.map(look => look.id))
          const edgePaintOrder = local.visual.edgePaintOrder?.filter(entry => entry.kind === 'edgeLook' && grassIds.has(entry.id))
            ?? grass.map(look => ({ kind: 'edgeLook' as const, id: look.id }))
          target.save(); target.clip(polygonPath(inlay.footprintMm))
          drawVisualBoundaries(target, { ...local, visual: { ...local.visual, edgeLooks: grass, transitions: [], materializedEdges: [],
            edgePaintOrder } }, undefined, !!raster.readFrequently)
          target.restore()
        }
      }
    } finally { target.restore() }
  }, !!raster.readFrequently)
}
function drawProjection(ctx: CanvasRenderingContext2D, projection: Projection, raster: RasterSet, signal?: AbortSignal, propDetails?: ReadonlyMap<string, EditorPropDetail>, clipBoundsMm?: BoundsMm,
  captureFrame = false, referenceLongEdge?: number): ArtStylePreviewFrame | undefined {
  const bounds = projection.bounds, sx = ctx.canvas.width / bounds.width, sy = ctx.canvas.height / bounds.height
  const guide = raster.lineGuide
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
      if (sprite.kind === 'prop') {
        const prop = sprite.value, detail = propDetails?.get(prop.id)
        drawProp(ctx, prop, projection, raster, sx, sy, detail)
        if (!prop.waterAppearance) {
          const bitmap = prop.appearance.kind === 'image' && detail !== 'outline' && !!raster.bitmapLineIds?.has(prop.appearance.assetId)
          guide?.sprite(bitmap, target => drawPropBody(target, prop, projection, raster, sx, sy, detail, false))
        }
      } else drawDecoration(ctx, sprite.value, projection, raster)
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
  if (projection.floorArtwork) {
    const { assetId, boundsMm } = projection.floorArtwork
    const image = raster.byAssetId.get(assetId)
    if (!image) throw new Error('缺少底图位图。')
    ctx.drawImage(image, boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height)
    guide?.sprite(true, target => target.drawImage(image, boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height))
  }
  if (projection.regional) drawRegionalProjection(ctx, projection, sx, sy, raster.byAssetId)
  for (const area of projection.terrain) {
    const rock = projection.rocks?.find(rock => rock.id === area.id)
    const openings: FacadeOpenings = []
    const landings = projection.bridgeEntrances?.flatMap(({ platform }) => platform?.id === area.id ? [platform] : []) ?? []
    if (area.facade) {
      for (const connection of boundaryConnections(projection.connections, area.points, true, [area.id])) {
        openings.push({ outerMm: connectionPolygon(connection), holesMm: [] })
      }
    }
    const faces = planFacadeFaces(projection, area, openings, landings)
    if (guide) {
      for (const { start, end, offsetsMm: [a, b] } of faces) {
        const toe: [PointMm, PointMm] = [point(start.x + a.x, start.y + a.y), point(end.x + b.x, end.y + b.y)]
        guide.cover(polygonPath([start, end, toe[1], toe[0]]))
        guide.stroke(linePath(...toe), .40, 35)
      }
      const top = surfacePath(area)
      guide.cover(top)
    }
    const extremities = faces.flatMap(({ start, end, offsetsMm: [a, b] }) => [start, end, point(start.x + a.x, start.y + a.y), point(end.x + b.x, end.y + b.y)])
    const paintBounds = expandedBounds([...area.points, ...extremities, ...(rock?.facets.flatMap(facet => facet.pointsMm) ?? [])], rock ? 1100 : 0)
    drawVisualEntity(ctx, projection, area.id, paintBounds, (target, local) => {
      if (area.facade && faces.length) {
        target.save(); excludeRegions(target, area.regionsMm ?? [{ outerMm: area.points, holesMm: [] }], local.bounds)
        for (const face of faces) drawTerrainFacadeFace(target, face, area.facade, true, local.visual?.environment)
        target.restore()
      }
      drawTerrainSurface(target, area, local, raster)
      if (rock) drawRockBody(target, rock)
    }, !!raster.readFrequently)
  }
  for (const prop of projection.props) if (prop.waterAppearance && prop.waterAppearance.mode !== 'surface') {
    checkCancelled(signal); drawOceanSprite(ctx, prop, projection, raster, 'under')
  }
  for (const area of projection.terrain) if (area.waterSurface) {
    drawVisualEntity(ctx, projection, area.id, expandedBounds(area.points, 0), (target, local) => drawOceanWaves(target, area, local), !!raster.readFrequently)
  }
  drawTerrainShorelines(ctx, projection, Math.max(sx, sy), signal)
  const edgeProjection = { ...projection, edges: terrainEdgePaint(projection) }
  drawTerrainEdges(ctx, edgeProjection, raster, sx, sy)
  if (guide) drawTerrainLineInk(guide, edgeProjection)
  drawVisualBoundaries(ctx, projection, signal, !!raster.readFrequently)
  drawTerrainInlays(ctx, projection, raster)
  if (guide) for (const inlay of projection.inlays ?? []) {
    guide.cover(polygonPath(inlay.footprintMm))
    const cut = new Path2D()
    for (const wall of inlay.walls) cut.addPath(linePath(wall.a, wall.b))
    guide.stroke(cut, .55, 60, 1.2)
  }
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
      for (const prop of projection.props) if (!prop.waterAppearance && prop.renderLayer !== 'ground' && prop.shadowClass !== 'none' && !projection.propPresentations?.[prop.id]) drawPropBody(target, prop, local, raster, sx, sy, 'image', false)
    })
  }
  drawWallBody(ctx, projection, raster, sx, sy, projection.walls.some(wall => wall.edgeProfile) ? planWallRelief(walls).geometry : walls)
  if (guide) for (const wall of walls) for (const polygon of wall.polygons) guide.cover(polygonPath(polygon))
  const symbols = projection.walls.flatMap(wall => wall.openings.map(opening => ({ wall, opening })))
  if (projection.openingPaintOrder) {
    const rank = new Map(projection.openingPaintOrder.map((id, index) => [id, index]))
    symbols.sort((a, b) => (rank.get(a.opening.id) ?? 0) - (rank.get(b.opening.id) ?? 0))
  }
  for (const { wall, opening } of symbols) if (opening.paintSymbol !== false) drawOpening(ctx, opening, wall, projection)
  drawSprites(false)
  const looks = projection.artStyles
  const lineArt = activeLineArt(looks)
  const bitmapLine = !lineArt?.filter && raster.bitmapLine
  const preserveContours = preservesBitmapContours(lineArt)
  const artwork = projection.floorArtwork, floorBitmap = artwork && raster.byAssetId.get(artwork.assetId)
  const strokeScale = preserveContours && artwork && floorBitmap ? floorBitmapStrokeScale(artwork, floorBitmap.width, floorBitmap.height, sx, sy) : 1
  const atmosphereAmount = artStyleLightAmount(looks)
  if (projection.visual && atmosphereAmount > 0) {
    // Light blockers are already captured in the audience-owned projection;
    // the atmosphere helper does not consume reconstructed wall paint rings.
    const atmosphere = () => {
      const separate = usesSeparateArtStyle(looks)
      drawVisualAtmosphere(ctx, projection, signal, !!raster.readFrequently, atmosphereAmount, false)
      if (!separate) applyVisualFilters(ctx, projection, signal, !!raster.readFrequently,
        projection.visual!.filters.filter(filter => !filter.sourceEntityIds && !filter.colorFilter), atmosphereAmount)
    }
    if (projection.outputBackground?.mode === 'transparent') paintWithPreservedAlpha(ctx, atmosphere, signal)
    else atmosphere()
  }
  let marks: ImageData | undefined
  if (looks?.some(look => (look.parameters.paintVersion ?? 0) >= 3) && !clipBoundsMm
    && (projection.gridSizeMm || projection.notes.length || projection.regions.length)) {
    const layer = canvas(ctx.canvas.width, ctx.canvas.height)
    try {
      const markContext = context(layer, true)
      worldTransform(markContext, bounds, sx, sy)
      finishProjection(markContext, projection, signal, true)
      marks = markContext.getImageData(0, 0, layer.width, layer.height)
    } finally { disposeCanvas(layer) }
  }
  if (captureFrame) {
    ctx.resetTransform()
    const tiles = captureArtStyleTiles(ctx, signal)
    const lineArtEdges = lineArt ? captureArtStyleLineEdges(ctx, bounds, signal, { tiles, bitmapLine }) : undefined
    const themeLineGuide = guide?.capture(ctx, signal, undefined, referenceLongEdge, preserveContours, strokeScale)
    return { width: ctx.canvas.width, height: ctx.canvas.height, tiles, marks, lineArtEdges, bitmapLine, themeLineGuide }
  }
  let lineArtEdges: Uint8Array | undefined
  let themeLineGuide: ArtStyleGradeSource['themeLineGuide']
  if (lineArt && projection.audience === 'player' && projection.masks.length) {
    const layer = canvas(ctx.canvas.width, ctx.canvas.height)
    try {
      const mask = context(layer, true)
      worldTransform(mask, bounds, sx, sy)
      drawPlayerMasks(mask, projection)
      lineArtEdges = captureArtStyleLineEdges(ctx, bounds, signal, { mask, bitmapLine, referenceLongEdge })
      themeLineGuide = guide?.capture(ctx, signal, mask, referenceLongEdge, preserveContours, strokeScale)
    } finally { disposeCanvas(layer) }
  } else themeLineGuide = guide?.capture(ctx, signal, undefined, referenceLongEdge, preserveContours, strokeScale)
  finishArtStyle(ctx, projection, signal, { marks, lineArtEdges, bitmapLine, referenceLongEdge, themeLineGuide })
  if (!marks) finishProjection(ctx, projection, signal, !!raster.readFrequently)
  // Mask the already filtered player paint last, including all derived layers.
  if (projection.audience === 'player') drawPlayerMasks(ctx, projection)
  if (clipBoundsMm) ctx.restore()
  ctx.resetTransform()
}

function finishArtStyle(ctx: CanvasRenderingContext2D, projection: Projection, signal: AbortSignal | undefined, grade: ArtStyleGradeSource): void {
  const looks = projection.artStyles
  const separate = usesSeparateArtStyle(looks)
  const filters = projection.visual?.filters.filter(filter => !filter.sourceEntityIds && (separate || filter.colorFilter))
  if (looks) applyArtStyleGrades(ctx, projection.bounds, looks, signal, filters?.length ? { ...grade, marks: undefined } : grade)
  if (!filters?.length) return
  applyVisualFilters(ctx, projection, signal, true, filters)
  if (grade.marks) paintArtStyleMarks(ctx, grade.marks, signal)
}

function gradeArtStyleFrame(frame: ArtStylePreviewFrame, projection: Projection, signal?: AbortSignal): HTMLCanvasElement {
  const output = canvas(frame.width, frame.height)
  try {
    finishArtStyle(context(output, true), projection, signal, frame)
    checkCancelled(signal)
    return output
  } catch (error) { disposeCanvas(output); throw error }
}

function finishProjection(ctx: CanvasRenderingContext2D, projection: Projection, signal?: AbortSignal, readFrequently = false) {
  const bounds = projection.bounds, sx = ctx.canvas.width / bounds.width, sy = ctx.canvas.height / bounds.height
  for (const region of projection.regions) drawVisualEntity(ctx, projection, region.id, expandedBounds(region.points, 20), ctx => {
    ctx.save(); ctx.strokeStyle = region.kind === 'hazard' ? '#9A674A' : '#71865A'; ctx.lineWidth = 18; ctx.setLineDash([85, 65]); ctx.stroke(polygonPath(region.points)); ctx.restore()
  }, readFrequently)
  if (projection.gridSizeMm) {
    const grid = projection.gridSizeMm, lines = bounds.width / grid + bounds.height / grid
    if (lines > 12_000) throw new Error('格线密度超过绘制预算，请关闭格线或增大网格。')
    ctx.save(); ctx.strokeStyle = '#39443E'; ctx.globalAlpha = .13; ctx.lineWidth = 1 / Math.max(sx, sy); ctx.beginPath()
    for (let x = Math.ceil(bounds.x / grid) * grid; x <= bounds.x + bounds.width; x += grid) { ctx.moveTo(x, bounds.y); ctx.lineTo(x, bounds.y + bounds.height) }
    for (let y = Math.ceil(bounds.y / grid) * grid; y <= bounds.y + bounds.height; y += grid) { ctx.moveTo(bounds.x, y); ctx.lineTo(bounds.x + bounds.width, y) }
    ctx.stroke(); ctx.restore()
  }
  const labelPositions = noteLabelPositions(projection.notes)
  for (const note of projection.notes) {
    const labelPosition = labelPositions.get(note.id)!
    ctx.save(); ctx.translate(labelPosition.x, labelPosition.y); ctx.font = '500 155px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const text = [...note.text].slice(0, note.kind === 'label' ? 50 : 36).join(''), textWidth = Math.min(4600, ctx.measureText(text).width)
    ctx.fillStyle = '#F2EAD4'; ctx.globalAlpha = .94; ctx.fillRect(-textWidth / 2 - 75, -110, textWidth + 150, 220); ctx.globalAlpha = 1; ctx.fillStyle = note.visibility === 'gm' ? '#8B683F' : '#39443E'; ctx.fillText(text, 0, 0, 4600); ctx.restore()
  }
  checkCancelled(signal)
}

/**
 * Canvas/resource backend. Receives disposable physical projection and resource
 * records only. Strict version-specific entrypoints own document validation.
 */
export async function renderRasterProjection(sources: RasterSources, projection: Projection, options: RenderOptions, editor?: EditorRenderOptions & { drawingProjection?: Projection }, validationStarted?: number, publicCropMm?: BoundsMm, clipBoundsMm?: BoundsMm, previewCache?: ArtStylePreviewCache): Promise<HTMLCanvasElement> {
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
  const cache = editor && options.audience === 'gm' && !editor.viewBoundsMm && !publicCropMm && !clipBoundsMm && visibleProjection.artStyles ? previewCache : undefined
  const cached = cache?.readFrame()
  if (cached) {
    if (metrics) metrics.validationProjectionMs = performance.now() - started
    const output = gradeArtStyleFrame(cached, visibleProjection, options.signal)
    if (metrics) {
      metrics.width = output.width; metrics.height = output.height
      metrics.totalMs = performance.now() - started
      metrics.drawSubmissionMs = metrics.totalMs - metrics.validationProjectionMs
      try { options.onMetrics?.(metrics) } catch { /* Observer only. */ }
    }
    return output
  }
  const plan = editor ? createEditorRenderPlan(visibleProjection, { viewBoundsMm: editor.viewBoundsMm, screenScalePxPerMm: editor.screenScalePxPerMm ?? options.longEdgePx / Math.max(visibleProjection.bounds.width, visibleProjection.bounds.height) }) : null
  const paintIds = plan ? new Set(plan.surfacePresentations.map(entry => `${entry.kind}:${entry.id}`)) : null
  const bitmapLineIds = lineBitmapIds(visibleProjection, sources)
  const line = activeLineArt(visibleProjection.artStyles)
  const bitmapLine = line?.parameters.paintVersion === CURRENT_LINE_ART_PAINT_VERSION && (!!visibleProjection.floorArtwork || bitmapLineIds.size > 0)
  const outputBounds = publicCropMm ?? plan?.boundsMm ?? projection.bounds
  const ratio = options.longEdgePx / Math.max(outputBounds.width, outputBounds.height)
  const width = Math.max(1, Math.round(outputBounds.width * ratio)), height = Math.max(1, Math.round(outputBounds.height * ratio))
  const mapEdge = Math.max(projection.bounds.width, projection.bounds.height)
  const lineScale = Math.min(ratio, PNG_MAX_LONG_EDGE / mapEdge)
  const floorArtwork = visibleProjection.floorArtwork
  const floorAsset = floorArtwork && sources.assetRefs[floorArtwork.assetId]
  const preserveContours = preservesBitmapContours(line)
  const strokeScale = preserveContours && floorArtwork && floorAsset ? floorBitmapStrokeScale(floorArtwork, floorAsset.pixelWidth, floorAsset.pixelHeight, lineScale) : 1
  const linePadding = bitmapLine ? bitmapLineSamplingPadding(mapEdge * lineScale, preserveContours, strokeScale) / lineScale : 0
  const drawingProjection = publicCropMm ? { ...visibleProjection, bounds: editorPaintBounds(visibleProjection, { boundsMm: publicCropMm, props: visibleProjection.props.map(prop => ({ prop, detail: 'full' as const, screenSizePx: 0, visualBoundsMm: visibleProjection.bounds, paintBoundsMm: visibleProjection.bounds })) }, linePadding) }
    : plan ? { ...visibleProjection, bounds: editorPaintBounds(visibleProjection, plan, linePadding), props: plan.props.map(entry => entry.prop), decorations: plan.decorations,
      // Only paint is culled. Occluders, contacts, supports and boundary facts
      // remain the complete audience-owned dependency closure.
      ...(visibleProjection.visual ? { visual: { ...visibleProjection.visual,
        edgeLooks: visibleProjection.visual.edgeLooks.filter(entry => paintIds!.has(`edgeLook:${entry.id}`)),
        materializedEdges: visibleProjection.visual.materializedEdges?.filter(entry => paintIds!.has(`materializedEdge:${entry.id}`)),
        transitions: visibleProjection.visual.transitions?.filter(entry => paintIds!.has(`transition:${entry.id}`)),
      } } : {}) } : visibleProjection
  const propDetails = plan ? new Map(plan.props.map(entry => [entry.prop.id, entry.detail])) : undefined
  if (width * height > PNG_MAX_PIXELS) throw new Error('图片超过 16M 像素预算。')
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('图片绘制需要支持真实位图解码与 Canvas 的浏览器。')
  if (metrics) { metrics.validationProjectionMs = performance.now() - started; metrics.width = width; metrics.height = height }
  const raster = await decodeRequired(sources, projection, options.signal, metrics, plan ? editorResidentAssetIds(visibleProjection, plan) : undefined, cache)
  raster.bitmapLine = bitmapLine
  raster.bitmapLineIds = bitmapLineIds
  // Formal 4K output is read back for PNG encoding. Keep all of its temporary
  // surfaces on the readback path: WebKit's accelerated material composition
  // can vary by one color level even between two exports of the same input.
  // Interactive/editor canvases retain their existing rendering path.
  raster.readFrequently = !editor && options.longEdgePx === PNG_MAX_LONG_EDGE
  const styleReadback = drawingProjection.artStyles?.some(look => (look.parameters.paintVersion ?? 0) >= 3) ?? false
  let output: HTMLCanvasElement | undefined, padded: HTMLCanvasElement | undefined
  let completed = false
  const paint = (target: CanvasRenderingContext2D, drawing: Projection, clip?: BoundsMm, capture = false, referenceEdge?: number) => {
    if (line?.filter) {
      const structure = !!(drawing.terrain.length || drawing.paths.length || drawing.connections.length)
      if (structure || bitmapLine) raster.lineGuide = new ArtStyleLineGuide(target.canvas.width, target.canvas.height, drawing.bounds, structure, bitmapLine, clip)
    }
    try { return drawProjection(target, drawing, raster, options.signal, propDetails, clip, capture, referenceEdge) }
    finally { raster.lineGuide?.dispose(); raster.lineGuide = undefined }
  }
  try {
    checkCancelled(options.signal)
    if (drawingProjection.artStyles) await beginArtStyleArtwork(sources, raster, drawingProjection, options.signal, cache)
    checkCancelled(options.signal)
    output = canvas(width, height)
    const ctx = context(output, !!raster.readFrequently || styleReadback)
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
      const paintContext = context(padded, !!raster.readFrequently || styleReadback), drawStarted = metrics ? performance.now() : 0
      const referenceLongEdge = Math.min(PNG_MAX_LONG_EDGE, mapEdge * paintRatio)
      paint(paintContext, paintProjection, undefined, false, referenceLongEdge)
      const sx = padded.width / paintBounds.width, sy = padded.height / paintBounds.height
      ctx.drawImage(padded, (outputBounds.x - paintBounds.x) * sx, (outputBounds.y - paintBounds.y) * sy, outputBounds.width * sx, outputBounds.height * sy, 0, 0, width, height)
      if (metrics) metrics.drawSubmissionMs = performance.now() - drawStarted
    } else {
      const drawStarted = metrics ? performance.now() : 0
      const frame = paint(ctx, drawingProjection, clipBoundsMm, !!cache)
      if (frame && cache) {
        disposeCanvas(output)
        output = gradeArtStyleFrame(frame, drawingProjection, options.signal)
        cache.writeFrame(frame)
      }
      if (metrics) metrics.drawSubmissionMs = performance.now() - drawStarted
    }
    checkCancelled(options.signal); completed = true; return output
  } catch (error) { if (output) disposeCanvas(output); throw error }
  finally {
    if (metrics) { metrics.decodedImages = raster.bitmaps.size; metrics.decodedPixels = [...raster.bitmaps.values()].reduce((sum, bitmap) => sum + bitmap.width * bitmap.height, 0) }
    raster.bitmaps.forEach(bitmap => bitmap.close()); if (raster.paintCache) disposeCanvas(raster.paintCache.image)
    if (raster.styled) new Set(raster.styled.values()).forEach(disposeCanvas)
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
