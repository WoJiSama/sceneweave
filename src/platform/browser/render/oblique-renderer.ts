import type { ProjectBundle } from '../../../shared/model/project.js'
import { defaultDisplayFloorId, floorDisplayStack } from '../../../shared/floors/output.js'
import { wallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { getVerifiedProjectBundle, validateProjectBundle, validateProjectSnapshot } from '../../../shared/project/resources.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import type { Audience, Projection } from '../../../shared/projection/types.js'
import { directionToLight } from '../../../shared/visual/directional-light.js'
import { browserProjectValidation } from '../project-validation'
import { decodeRequired, encodePng, PNG_MAX_LONG_EDGE, prepareRasterArtwork, renderRasterProjection, type RasterSources } from './canvas-renderer'
import { mountObliqueMesh, ObliqueMesh, rectangle, type SpatialPoint } from './oblique-mesh'
import { DEFAULT_OBLIQUE_CAMERA, type ObliqueCamera } from './oblique-camera'
import { addMapBase, addWorldSurfaces, addWorldWalls, colorRgb, planSpatialEarthenRoads, spatialPrivacyMask } from './oblique-surfaces'
import { projectGround } from './projected-ground.js'
import { addSpatialProps } from './oblique-props'
import { applyObliqueShadows, bakeObliqueShadows } from './oblique-shadows'

export { DEFAULT_OBLIQUE_CAMERA, type ObliqueCamera } from './oblique-camera'
export type ObliquePreviewMode = 'normal' | 'performance'

interface ObliqueOptions {
  audience: Audience
  floorId?: string
  signal?: AbortSignal
  hiddenLayerIds?: ReadonlySet<string>
  onMetrics?: (metrics: ObliquePreparationMetrics) => void
}

export interface ObliquePreparationMetrics {
  validationMs: number
  projectionMs: number
  resourceVerificationMs: number
  decoderQueueWaitMs: number
  imageDecodeMs: number
  artworkMs: number
  atlasMs: number
  shadowMs: number
  meshMs: number
  gpuUploadMs: number
  totalMs: number
  decodedImages: number
  atlasPixels: number
  triangles: number
  batches: number
}

interface Atlas {
  key: HTMLCanvasElement
  projection: Projection
  longEdgePx: number
  shadow?: HTMLCanvasElement
}
type ObliqueOutput = { longEdgePx: number; aspectRatio?: number; camera?: ObliqueCamera; signal?: AbortSignal }

const ATLAS_PIXEL_BUDGET = 12_000_000
const PERFORMANCE_ATLAS_EDGE = 768
function textureEdge(viewportPx: number, zoom: number, floors: number, maxTextureSize = 4096, detailPixelBudget?: number) {
  const pixels = viewportPx * Math.max(1, zoom)
  const tier = [768, 1024, 1536, 2048, 2560, 3072, 4096].find(size => size >= pixels) ?? 4096
  // All floors remain mounted, so constrain their combined atlas allocation.
  const limit = Math.min(maxTextureSize, Math.floor(Math.sqrt((detailPixelBudget ?? ATLAS_PIXEL_BUDGET) / floors)))
  // When the remaining budget adds less than 2% to this tier, bake the last
  // few texels now to avoid a second full raster and upload on further zoom.
  if (detailPixelBudget !== undefined && limit <= tier * 1.02) return limit
  return Math.min(tier, limit)
}

const letBrowserPaint = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function frameCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function cameraSettings(input: ObliqueCamera): ObliqueCamera {
  const { azimuthDeg, elevationDeg, zoom, targetMm, fadeCanopy, showBase } = input
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg) || !Number.isFinite(zoom)
    || elevationDeg < 30 || elevationDeg > 90 || zoom < .65 || zoom > 4
    || (targetMm && (!Number.isFinite(targetMm.x) || !Number.isFinite(targetMm.y)))) throw new Error('3D 取景参数不合法。')
  return { azimuthDeg, elevationDeg, zoom, targetMm: targetMm && { ...targetMm }, fadeCanopy, showBase }
}

async function prepare(input: ProjectBundle, options: ObliqueOptions,
  { previewMode, textureSize, textureZoom = 1 }: { previewMode?: ObliquePreviewMode; textureSize: number; textureZoom?: number }) {
  const preview = previewMode !== undefined
  const { signal, audience } = options
  const started = performance.now()
  const metrics: ObliquePreparationMetrics = { validationMs: 0, projectionMs: 0, resourceVerificationMs: 0, decoderQueueWaitMs: 0,
    imageDecodeMs: 0, artworkMs: 0, atlasMs: 0, shadowMs: 0, meshMs: 0, gpuUploadMs: 0, totalMs: 0, decodedImages: 0, atlasPixels: 0,
    triangles: 0, batches: 0 }
  checkCancelled(signal)
  const hidden = audience === 'gm' ? new Set(options.hiddenLayerIds) : undefined
  const validation = { ...browserProjectValidation, signal }
  const bundle = await (preview ? validateProjectSnapshot(input, validation) : validateProjectBundle(input, validation))
  metrics.validationMs = performance.now() - started
  checkCancelled(signal)
  const { document: scene, appearance, assets, authoringSources } = bundle.project
  const floorId = options.floorId ?? defaultDisplayFloorId(scene)
  if (!floorId) throw new Error('请先选择要取景的楼层。')
  const stack = floorDisplayStack(scene, floorId)
  const projections = stack.map(floor => {
    const options = { floorId: floor.id, spatial: true }
    return hidden?.size ? projectEditorScene(scene, { ...options, hiddenLayerIds: hidden }, appearance) : projectScene(scene, audience, appearance, options)
  })
  metrics.projectionMs = performance.now() - started - metrics.validationMs
  const projection = projections.at(-1)!
  const bounds = projection.bounds
  const sources: RasterSources = { assetRefs: scene.assets, assets, resources: bundle.resources, vectorSources: authoringSources }
  const mesh = new ObliqueMesh()
  const ownedCanvases = new Set<HTMLCanvasElement>(), bitmaps = new Map<string, ImageBitmap>()
  const atlases: Atlas[] = []
  const maxAtlasEdge = previewMode === 'performance' ? PERFORMANCE_ATLAS_EDGE : preview ? 1536 : PNG_MAX_LONG_EDGE
  const longEdgePx = textureEdge(textureSize, textureZoom, projections.length, maxAtlasEdge)
  const release = (keepShadows = false) => {
    if (keepShadows) for (const atlas of atlases) if (atlas.shadow) ownedCanvases.delete(atlas.shadow)
    for (const image of bitmaps.values()) image.close()
    for (const canvas of ownedCanvases) canvas.width = canvas.height = 0
    ownedCanvases.clear()
    bitmaps.clear()
    mesh.batches.clear()
  }
  const temporaryCanvas = (width: number, height: number) => {
    const canvas = frameCanvas(width, height)
    ownedCanvases.add(canvas)
    return canvas
  }
  const sun = directionToLight(projection.visual?.environment)
  const background = colorRgb(projection.rooms.length && !projection.terrain.length ? '#272c2b' : projection.outputBackground?.mode === 'solid' ? projection.outputBackground.color : '#272d31')
  try {
    for (const [index, projected] of projections.entries()) {
      if (preview) await letBrowserPaint()
      checkCancelled(signal)
      if (projected.limitations.length) throw new Error(projected.limitations.join(' '))
      const first = index === 0, local = projected.bounds
      const floorGround = first && (!projected.rooms.length || projected.terrain.length > 0 || !!projected.floorArtwork)
      const earthenSteps = planSpatialEarthenRoads(projected)
      const zOffset = 0
      const ground = projectGround(projected, zOffset)
      // Paint terrain decals in the surface atlas. A quad at four sampled
      // heights can cut through the relief between those corners.
      const decals = projected.props.filter(prop => {
        if (prop.renderLayer !== 'ground' || prop.waterAppearance || prop.supportRef.kind !== 'terrainArea') return false
        const support = ground.levels.get(prop.supportRef.id), volume = projected.propVolumes?.[prop.id]
        return support?.relief && volume?.kind === 'flat' && volume.baseMm + zOffset === ground.elevation(support, prop.positionMm)
      })
      const decalIds = new Set(decals.map(prop => prop.id))
      const base: Projection = {
        ...projected, gridSizeMm: null, notes: [], regions: [], walls: [],
        props: decals, decorations: [], spritePaintOrder: projected.spritePaintOrder?.filter(id => decalIds.has(id)),
        paths: earthenSteps.size ? projected.paths.map(path => earthenSteps.has(path.id) ? { ...path, stairs: undefined } : path) : projected.paths,
        outputBackground: floorGround ? projected.outputBackground : { mode: 'transparent' },
      }
      const raster = await decodeRequired(sources, projected, signal, { premultiplyAlpha: 'premultiply', sharedBitmaps: bitmaps, metrics })
      const artworkStarted = performance.now()
      try { await prepareRasterArtwork(sources, raster, projected, signal) }
      finally { for (const image of raster.styled?.values() ?? []) ownedCanvases.add(image) }
      metrics.artworkMs += performance.now() - artworkStarted
      const atlasStarted = performance.now()
      const texture = await renderRasterProjection(sources, base, { audience, floorId: projected.floorId, longEdgePx, signal, spatialTexture: 'base', spatialRaster: raster })
      ownedCanvases.add(texture)
      metrics.atlasMs += performance.now() - atlasStarted
      metrics.atlasPixels += texture.width * texture.height
      if (preview) await letBrowserPaint()
      checkCancelled(signal)
      const shadowStarted = performance.now()
      const walls = wallGeometry(projected.walls)
      const privacy = spatialPrivacyMask(projected, temporaryCanvas)
      const shadow = await bakeObliqueShadows(projected, ground, walls, temporaryCanvas, privacy, signal, preview ? letBrowserPaint : undefined)
      applyObliqueShadows(texture, shadow)
      atlases.push({ key: texture, projection: base, longEdgePx, shadow })
      metrics.shadowMs += performance.now() - shadowStarted
      const meshStarted = performance.now()
      mesh.useLight(directionToLight(projected.visual?.environment))
      const images = new Map<string, ImageBitmap | HTMLCanvasElement>(raster.byAssetId)
      for (const [id, image] of raster.styled ?? []) images.set(id, image)
      const surfaces = { mesh, projection: projected, texture, images, privacy, zOffset, blankGround: floorGround, temporaryCanvas, ground, earthenSteps }
      if (first) addMapBase(surfaces)
      addWorldSurfaces(surfaces)
      addWorldWalls(surfaces, walls)
      await addSpatialProps(surfaces, decalIds, signal, preview ? letBrowserPaint : undefined)
      if (projected.masks.length && !floorGround) {
        // Paint the fixed mask into the actual scene. Geometry is already
        // filtered and the same opaque mask also clips raised model fragments.
        const [a, b, c, d] = rectangle(local).map(({ x, y }): SpatialPoint => [x, y, zOffset + 1])
        mesh.quad({ image: texture, unlit: true, coverage: privacy }, [a, b, c, d])
      }
      metrics.meshMs += performance.now() - meshStarted
    }
    checkCancelled(signal)
    metrics.decodedImages = bitmaps.size
    metrics.triangles = mesh.triangleCount
    metrics.batches = mesh.batches.size
    return { mesh, sun, background, bounds, sources, atlases, bundle, metrics, started, release }
  } catch (failure) {
    release()
    throw failure
  }
}

function mount(canvas: HTMLCanvasElement, built: Awaited<ReturnType<typeof prepare>>, options: ObliqueOptions, retainShadows = false) {
  let mounted = false
  try {
    const uploadStarted = performance.now()
    const view = mountObliqueMesh(canvas, built.mesh, built.bounds, built.sun, built.background, !retainShadows)
    built.metrics.batches = view.batchCount
    built.metrics.gpuUploadMs = performance.now() - uploadStarted
    built.metrics.totalMs = performance.now() - built.started
    try { options.onMetrics?.({ ...built.metrics }) } catch { /* Observer only. */ }
    mounted = true
    return view
  } finally {
    // Upload is synchronous. Camera changes need only the resident GPU data.
    built.release(retainShadows && mounted)
  }
}

export async function prepareObliquePreview(canvas: HTMLCanvasElement, input: ProjectBundle,
  { mode: initialMode = 'normal', ...options }: ObliqueOptions & { mode?: ObliquePreviewMode }) {
  options = { ...options, hiddenLayerIds: new Set(options.hiddenLayerIds) }
  const built = await prepare(input, options, { previewMode: initialMode, textureSize: Math.max(canvas.width, canvas.height) })
  const view = mount(canvas, built, options, true)
  const cacheable = getVerifiedProjectBundle(input) === built.bundle
  const lifetime = new AbortController()
  const baseTextureEdge = built.atlases[0].longEdgePx
  let mode = initialMode
  let refinement = new AbortController()
  let camera = DEFAULT_OBLIQUE_CAMERA
  let pendingRefinement: Promise<void> | undefined
  const drawPreview = () => {
    view.setDetailed(mode === 'normal' && (camera.zoom > 1.2 || Math.max(canvas.width, canvas.height) > baseTextureEdge))
    return view.draw(camera)
  }
  const setMode = (next: ObliquePreviewMode) => {
    if (next === mode || lifetime.signal.aborted) return false
    mode = next
    if (mode === 'performance') {
      refinement.abort()
      view.clearColorDetails()
      for (const atlas of built.atlases) atlas.longEdgePx = baseTextureEdge
    } else {
      refinement = new AbortController()
    }
    return true
  }
  const refine = async (viewportPx: number, zoom: number, signal?: AbortSignal) => {
    checkCancelled(lifetime.signal)
    checkCancelled(signal)
    if (mode === 'performance') return
    const active = signal ? AbortSignal.any([signal, refinement.signal]) : refinement.signal
    while (pendingRefinement) {
      try { await pendingRefinement } catch { /* A later request has its own lifetime. */ }
      checkCancelled(active)
    }
    checkCancelled(active)
    const longEdgePx = textureEdge(viewportPx, zoom, built.atlases.length, view.maxTextureSize, ATLAS_PIXEL_BUDGET - built.metrics.atlasPixels)
    if (built.atlases.every(atlas => atlas.longEdgePx >= longEdgePx)) return
    const work = (async () => {
      for (const atlas of built.atlases) {
        if (atlas.longEdgePx >= longEdgePx) continue
        await letBrowserPaint()
        checkCancelled(active)
        const image = await renderRasterProjection(built.sources, atlas.projection, { audience: options.audience,
          floorId: atlas.projection.floorId, longEdgePx, signal: active, spatialTexture: 'detail' })
        try {
          checkCancelled(active)
          applyObliqueShadows(image, atlas.shadow)
          view.replaceColorDetail(atlas.key, image)
          atlas.longEdgePx = longEdgePx
        } finally { image.width = image.height = 0 }
      }
      drawPreview()
    })()
    pendingRefinement = work
    try { await work } finally { if (pendingRefinement === work) pendingRefinement = undefined }
  }
  return {
    bounds: built.bounds,
    cacheable,
    setMode,
    draw: (next: ObliqueCamera) => { camera = cameraSettings(next); return drawPreview() },
    refine: (zoom: number, signal?: AbortSignal) => refine(Math.max(canvas.width, canvas.height), zoom, signal),
    exportPng(output: ObliqueOutput) {
      const signal = output.signal ? AbortSignal.any([output.signal, lifetime.signal]) : lifetime.signal
      // The same output preparation is used by the workbench and standalone export.
      return exportObliquePng(built.bundle, { ...options, ...output, camera: output.camera ?? camera, signal })
    },
    dispose: () => {
      lifetime.abort(); refinement.abort(); view.dispose()
      for (const atlas of built.atlases) if (atlas.shadow) atlas.shadow.width = atlas.shadow.height = 0
    },
  }
}

function outputSize({ longEdgePx, aspectRatio = 1.28 }: ObliqueOutput) {
  if (!Number.isInteger(longEdgePx) || longEdgePx < 256 || longEdgePx > PNG_MAX_LONG_EDGE || !Number.isFinite(aspectRatio) || aspectRatio < .3 || aspectRatio > 4) {
    throw new Error('3D 图片尺寸或画幅不合法。')
  }
  return { width: Math.round(longEdgePx * Math.min(1, aspectRatio)), height: Math.round(longEdgePx * Math.min(1, 1 / aspectRatio)) }
}

export async function renderObliqueProject(input: ProjectBundle, options: ObliqueOptions & ObliqueOutput) {
  const { longEdgePx, signal } = options
  const camera = cameraSettings(options.camera ?? DEFAULT_OBLIQUE_CAMERA)
  const { width, height } = outputSize(options)
  const viewport = frameCanvas(width, height)
  const view = mount(viewport, await prepare(input, options, { textureSize: Math.max(1536, longEdgePx), textureZoom: camera.zoom }), options)
  try {
    checkCancelled(signal)
    view.draw(camera)
    const output = frameCanvas(width, height)
    const context = output.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取 3D 出图缓冲。')
    context.drawImage(viewport, 0, 0)
    // The WebGL output clears to an opaque backdrop. A transparent sample
    // here indicates a failed frame transfer, even if draw() returned.
    if (context.getImageData(0, 0, 1, 1).data[3] !== 255) {
      output.width = output.height = 0
      throw new Error('3D 出图未读到完整画面。可从已保存工程重新生成斜俯视。')
    }
    return output
  } finally {
    view.dispose()
    viewport.width = viewport.height = 0
  }
}

export async function exportObliquePng(input: ProjectBundle, options: Parameters<typeof renderObliqueProject>[1]) {
  return encodePng(await renderObliqueProject(input, options), options.signal)
}
