import type { ProjectBundle } from '../../../shared/model/project.js'
import { defaultDisplayFloorId, floorDisplayStack } from '../../../shared/floors/output.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { validateProjectBundle, validateProjectSnapshot } from '../../../shared/project/resources.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import type { Audience, Projection } from '../../../shared/projection/types.js'
import { browserProjectValidation } from '../project-validation'
import { decodeRequired, encodePng, PNG_MAX_LONG_EDGE, renderRasterProjection, type RasterSources } from './canvas-renderer'
import { mountObliqueMesh, ObliqueMesh, rectangle, type SpatialPoint } from './oblique-mesh'
import { DEFAULT_OBLIQUE_CAMERA, type ObliqueCamera } from './oblique-camera'
import { addWorldSurfaces, addWorldWalls, colorRgb, projectGround, spatialPrivacyMask } from './oblique-surfaces'
import { addSpatialProps } from './oblique-props'

export { DEFAULT_OBLIQUE_CAMERA, type ObliqueCamera } from './oblique-camera'
interface ObliqueOptions {
  audience: Audience
  floorId?: string
  signal?: AbortSignal
  hiddenLayerIds?: ReadonlySet<string>
}

function frameCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function cameraSettings(input: ObliqueCamera): ObliqueCamera {
  const { azimuthDeg, elevationDeg, zoom, targetMm, fadeCanopy } = input
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg) || !Number.isFinite(zoom)
    || elevationDeg < 30 || elevationDeg > 90 || zoom < .65 || zoom > 4
    || (targetMm && (!Number.isFinite(targetMm.x) || !Number.isFinite(targetMm.y)))) throw new Error('3D 取景参数不合法。')
  return { azimuthDeg, elevationDeg, zoom, targetMm: targetMm && { ...targetMm }, fadeCanopy }
}

async function prepare(input: ProjectBundle, options: ObliqueOptions, preview: boolean, textureSize: number) {
  const { signal, audience } = options
  checkCancelled(signal)
  const hidden = audience === 'gm' ? new Set(options.hiddenLayerIds) : undefined
  const validation = { ...browserProjectValidation, signal }
  const bundle = await (preview ? validateProjectSnapshot(input, validation) : validateProjectBundle(input, validation))
  checkCancelled(signal)
  const { document: scene, appearance, assets, authoringSources } = bundle.project
  const floorId = options.floorId ?? defaultDisplayFloorId(scene)
  if (!floorId) throw new Error('请先选择要取景的楼层。')
  const stack = floorDisplayStack(scene, floorId)
  const projections = stack.map(floor => {
    const options = { floorId: floor.id, spatial: true }
    return hidden?.size ? projectEditorScene(scene, { ...options, hiddenLayerIds: hidden }, appearance) : projectScene(scene, audience, appearance, options)
  })
  const projection = projections.at(-1)!
  const bounds = projection.bounds
  const sources: RasterSources = { assetRefs: scene.assets, assets, resources: bundle.resources, vectorSources: authoringSources }
  const mesh = new ObliqueMesh()
  const ownedCanvases = new Set<HTMLCanvasElement>(), ownedImages = new Set<ImageBitmap>()
  const release = () => {
    for (const image of ownedImages) image.close()
    for (const canvas of ownedCanvases) canvas.width = canvas.height = 0
    ownedCanvases.clear()
    ownedImages.clear()
    mesh.batches.clear()
  }
  const temporaryCanvas = (width: number, height: number) => {
    const canvas = frameCanvas(width, height)
    ownedCanvases.add(canvas)
    return canvas
  }
  const environment = projection.visual?.environment
  const azimuth = ((environment?.lightDirectionDeg ?? 135) + 180) * Math.PI / 180
  const elevation = (environment?.directionalLight?.elevationDeg ?? 42) * Math.PI / 180
  const sun: SpatialPoint = [Math.sin(azimuth) * Math.cos(elevation), -Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)]
  const background = colorRgb(projection.rooms.length && !projection.terrain.length ? '#272c2b' : projection.outputBackground?.mode === 'solid' ? projection.outputBackground.color : '#272d31')
  try {
    for (const [index, projected] of projections.entries()) {
      checkCancelled(signal)
      if (projected.limitations.length) throw new Error(projected.limitations.join(' '))
      const first = index === 0, local = projected.bounds
      const floorGround = first && (!projected.rooms.length || projected.terrain.length > 0 || !!projected.floorArtwork)
      const base: Projection = {
        ...projected, gridSizeMm: null, notes: [], regions: [], walls: [],
        props: [], decorations: [], spritePaintOrder: [],
        outputBackground: floorGround ? projected.outputBackground : { mode: 'transparent' },
      }
      const texture = await renderRasterProjection(sources, base, { audience, floorId: projected.floorId, longEdgePx: textureSize, signal })
      ownedCanvases.add(texture)
      const raster = await decodeRequired(sources, projected, signal)
      for (const bitmap of raster.bitmaps.values()) ownedImages.add(bitmap)
      const zOffset = 0
      const ground = projectGround(projected, zOffset)
      const privacy = spatialPrivacyMask(projected, temporaryCanvas)
      const surfaces = { mesh, projection: projected, texture, images: raster.byAssetId, privacy, zOffset, blankGround: floorGround, temporaryCanvas, ground }
      addWorldSurfaces(surfaces)
      addWorldWalls(surfaces)
      addSpatialProps(surfaces, signal)
      if (projected.masks.length && !floorGround) {
        // Paint the fixed mask into the actual scene. Geometry is already
        // filtered and the same opaque mask also clips raised model fragments.
        const [a, b, c, d] = rectangle(local).map(({ x, y }): SpatialPoint => [x, y, zOffset + 1])
        mesh.quad({ image: texture, unlit: true, coverage: privacy }, [a, b, c, d])
      }
    }
    checkCancelled(signal)
    return { mesh, sun, background, bounds, release }
  } catch (failure) {
    release()
    throw failure
  }
}

function mount(canvas: HTMLCanvasElement, built: Awaited<ReturnType<typeof prepare>>) {
  try {
    const view = mountObliqueMesh(canvas, built.mesh, built.bounds, built.sun, built.background)
    return { bounds: built.bounds, draw: (camera: ObliqueCamera) => view.draw(cameraSettings(camera)), dispose: view.dispose }
  } finally {
    // Upload is synchronous. Camera changes need only the resident GPU data.
    built.release()
  }
}

export async function prepareObliquePreview(canvas: HTMLCanvasElement, input: ProjectBundle, options: ObliqueOptions) {
  return mount(canvas, await prepare(input, options, true, 1536))
}

export async function renderObliqueProject(input: ProjectBundle, options: ObliqueOptions & { longEdgePx: number; aspectRatio?: number; camera?: ObliqueCamera }) {
  const { longEdgePx, aspectRatio = 1.28, signal } = options
  const camera = cameraSettings(options.camera ?? DEFAULT_OBLIQUE_CAMERA)
  if (!Number.isInteger(longEdgePx) || longEdgePx < 256 || longEdgePx > PNG_MAX_LONG_EDGE || !Number.isFinite(aspectRatio) || aspectRatio < .3 || aspectRatio > 4) {
    throw new Error('3D 图片尺寸或画幅不合法。')
  }
  const width = Math.round(longEdgePx * Math.min(1, aspectRatio)), height = Math.round(longEdgePx * Math.min(1, 1 / aspectRatio))
  const viewport = frameCanvas(width, height)
  const view = mount(viewport, await prepare(input, options, false, Math.max(1536, Math.min(longEdgePx, 2560))))
  try {
    checkCancelled(signal)
    view.draw(camera)
    const output = frameCanvas(width, height)
    output.getContext('2d', { willReadFrequently: true })!.drawImage(viewport, 0, 0)
    return output
  } finally {
    view.dispose()
    viewport.width = viewport.height = 0
  }
}

export async function exportObliquePng(input: ProjectBundle, options: Parameters<typeof renderObliqueProject>[1]) {
  return encodePng(await renderObliqueProject(input, options), options.signal)
}
