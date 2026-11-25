import { z } from 'zod'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { AssetRecord, ProjectData, SvgAuthoringSource } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { createImageCalibration, assertImagePoint, imageDistanceToMm, imagePointToWorldMm, type ImageCalibrationInput, type ImagePoint } from '../../../shared/image-import/calibration.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { LIBRARY_LIMITS } from '../../../shared/library/types.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'
import { visualBase } from '../../../shared/visual/base.js'
import { id as idSchema } from '../../../shared/validation/primitives.js'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { runtime, validation } from '../runtime.js'
import { createVisualBlankDocument } from './visual-samples.js'
import type { ImageRoomRaster } from './image-room-sample.js'
import type { PixelBounds } from '../../../shared/image-import/pixels.js'
import { IMAGE_IMPORT_VECTOR_LONG_EDGE, materializeImageImportSvg } from './image-import-vector.js'
import { prepareSourceBuildingArt, SOURCE_BUILDING_ART_ID } from './image-import-source-art.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { wallEnvelopePolygons } from '../../../shared/geometry/doorway-clearance.js'

export interface ImageImportRaster extends ImageRoomRaster {
  sourceSvg?: string
  targetLongEdgePx?: number
}
export interface ImageImportLayer extends ImageImportRaster {
  id: string
  name: string
  renderLayer: 'ground' | 'object'
  blocksMovement: boolean
  footprintPx?: PixelBounds
  /** Original visual bounds used only to keep the implicit physical footprint
   * fixed when an appearance derivative needs an extra raster edge pixel. */
  footprintBasisPx?: PixelBounds
}
export interface ImageImportProjectInput {
  title: string
  calibration: ImageCalibrationInput
  roomPointsPx: ImagePoint[]
  floor: ImageImportRaster
  layers: ImageImportLayer[]
  licenseText: string
  attribution: string
  sceneId?: string
  now?: string
  sourceArtwork?: { kind: 'preserve-original'; roomBoundaryPx: ImagePoint[] }
}
export const IMAGE_IMPORT_IDS = { room: 'image-import-room', floor: 'visual-floor' } as const
const GROUND = 'visual-layer-ground', PROPS = 'visual-layer-props'
const hashJson = (value: unknown) => sha256Bytes(encodeUtf8(canonicalJson(value)))
function imageImportSource(input: ImageImportProjectInput) {
  const licenseHash = sha256Bytes(encodeUtf8(input.licenseText))
  return { licenseHash, licenseRef: `image-import-source-${licenseHash}`,
    origin: { kind: 'imported' as const, attribution: input.attribution, canEmbed: true } }
}
function rasterAssetId(sha256: string, logicalSizeMm: { width: number; height: number },
  { licenseRef, origin }: ReturnType<typeof imageImportSource>, sourceSvg?: string): string {
  const identity = { logicalSizeMm, licenseRef, origin, ...(sourceSvg && { sourceSha256: normalizeStaticSvg(sourceSvg).sourceSha256 }) }
  return `image-import-art-${sha256}-${hashJson(identity)}`
}
const pixelBoundsSchema = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(), height: z.number().finite().positive() }).strict()

function captureRaster(input: ImageImportRaster): ImageImportRaster {
  const boundsPx = pixelBoundsSchema.parse(captureJson(input.boundsPx))
  if (input.sourceSvg !== undefined) {
    const sourceSvg = normalizeStaticSvg(input.sourceSvg).sourceSvg
    const targetLongEdgePx = z.number().int().min(1).max(STATIC_SVG_LIMITS.rasterSide).parse(input.targetLongEdgePx ?? IMAGE_IMPORT_VECTOR_LONG_EDGE)
    return { boundsPx, pngBytes: new Uint8Array(), pixelWidth: 1, pixelHeight: 1, sourceSvg, targetLongEdgePx }
  }
  const pixelWidth = z.number().int().positive().max(PACKAGE_LIMITS.imageSide).parse(input.pixelWidth)
  const pixelHeight = z.number().int().positive().max(PACKAGE_LIMITS.imageSide).parse(input.pixelHeight)
  if (!(input.pngBytes instanceof Uint8Array) || input.pngBytes.byteLength > PACKAGE_LIMITS.imageBytes || pixelWidth * pixelHeight > PACKAGE_LIMITS.imagePixels) throw new Error('拆解图层超过图片保护范围。')
  const pngBytes = new Uint8Array(input.pngBytes)
  if (pngBytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => pngBytes[index] !== byte)) throw new Error('拆解图层须为PNG。')
  return { pngBytes, pixelWidth, pixelHeight, boundsPx }
}

function captureInput(input: ImageImportProjectInput): ImageImportProjectInput {
  if (!Array.isArray(input.layers) || input.layers.length + (input.sourceArtwork || input.floor.sourceSvg !== undefined ? 1 : 0) > LIBRARY_LIMITS.batch) throw new Error('一次图片拆解的物件与地板合计最多64项。')
  const sourceArtwork = input.sourceArtwork === undefined ? undefined : z.object({ kind: z.literal('preserve-original'),
    roomBoundaryPx: z.array(z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict()).min(3).max(257) }).strict().parse(captureJson(input.sourceArtwork))
  if (sourceArtwork && canonicalJson(sourceArtwork.roomBoundaryPx) !== canonicalJson(input.roomPointsPx)) throw new Error('源建筑外观必须关联当前真实房间轮廓。')
  const layers = input.layers.map(layer => ({ ...captureRaster(layer),
    ...z.object({ id: idSchema, name: z.string().trim().min(1).max(120), renderLayer: z.enum(['ground', 'object']), blocksMovement: z.boolean(), footprintPx: pixelBoundsSchema.optional(), footprintBasisPx: pixelBoundsSchema.optional() }).strict()
      .parse({ id: layer.id, name: layer.name, renderLayer: layer.renderLayer, blocksMovement: layer.blocksMovement,
        ...(layer.footprintPx !== undefined ? { footprintPx: captureJson(layer.footprintPx) } : {}),
        ...(layer.footprintBasisPx !== undefined ? { footprintBasisPx: captureJson(layer.footprintBasisPx) } : {}) }) }))
  if (new Set(layers.map(layer => layer.id)).size !== layers.length) throw new Error('图片物件身份重复。')
  return { ...z.object({ title: z.string().trim().min(1).max(120), licenseText: z.string().min(1).refine(value => value.trim().length > 0), attribution: z.string().trim().min(1),
    sceneId: idSchema.optional(), now: z.string().datetime().optional() }).strict()
    .parse({ title: input.title, licenseText: input.licenseText, attribution: input.attribution, ...(input.sceneId ? { sceneId: input.sceneId } : {}), ...(input.now ? { now: input.now } : {}) }),
    calibration: captureJson(input.calibration) as unknown as ImageCalibrationInput,
    roomPointsPx: captureJson(input.roomPointsPx) as unknown as ImagePoint[], floor: captureRaster(input.floor), layers,
    ...(sourceArtwork ? { sourceArtwork } : {}) }
}

function buildDocument(input: ImageImportProjectInput, source: ReturnType<typeof imageImportSource>, sourceArt?: ImageImportRaster): SceneDocument {
  const calibration = createImageCalibration(input.calibration)
  if (!Array.isArray(input.roomPointsPx) || input.roomPointsPx.length > 257) throw new Error('房间轮廓需要3–256个顶点。')
  const points = input.roomPointsPx.map(point => imagePointToWorldMm(calibration, point))
  if (points.length) {
    const first = points[0], last = points.at(-1)!
    if (first.x === last.x && first.y === last.y) points.pop()
    if (points.length < 3 || points.length > 256) throw new Error('房间轮廓需要3–256个顶点。')
  }
  if (signedVisualArea(points) < 0) points.reverse()
  const topLeft = imagePointToWorldMm(calibration, { x: 0, y: 0 })
  const bottomRight = imagePointToWorldMm(calibration, { x: calibration.pixelWidth, y: calibration.pixelHeight })
  const width = Math.max(1000, bottomRight.x - topLeft.x, imageDistanceToMm(calibration, calibration.pixelWidth))
  const height = Math.max(1000, bottomRight.y - topLeft.y, imageDistanceToMm(calibration, calibration.pixelHeight))
  const scene = createVisualBlankDocument({ title: input.title, widthMm: width, heightMm: height, preset: 'narrative', gridVisible: false,
    sceneId: input.sceneId ?? runtime.ids.nextId(), now: input.now ?? runtime.clock.now() })
  scene.floors[IMAGE_IMPORT_IDS.floor].boundsMm = { ...topLeft, width, height }
  const visualLayers = sourceArt ? [...input.layers, { ...sourceArt, id: SOURCE_BUILDING_ART_ID, name: '原图建筑墙沿', renderLayer: 'ground' as const, blocksMovement: false }] : input.layers
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}; scene.styleThemes = {}; scene.activeStyleThemeRef = null
  scene.outputBackground = points.length ? { mode: 'solid', color: '#E9E5DC' } : { mode: 'transparent' }
  scene.presetSnapshot = { presetId: 'image-import-manual', presetVersion: 1, distanceMode: 'metric', gridSizeMm: 1000,
    source: `本地图片拆解；两点标定${calibration.distanceMm}毫米；${points.length ? '轮廓人工确认' : '以原图为底图'}；遮挡补底属于推断。` }
  const { licenseRef, origin } = source
  const addAsset = (raster: ImageImportRaster): string => {
    assertImagePoint(calibration, { x: raster.boundsPx.x, y: raster.boundsPx.y })
    assertImagePoint(calibration, { x: raster.boundsPx.x + raster.boundsPx.width, y: raster.boundsPx.y + raster.boundsPx.height })
    const sha256 = sha256Bytes(raster.pngBytes)
    const logicalSizeMm = { width: imageDistanceToMm(calibration, raster.boundsPx.width), height: imageDistanceToMm(calibration, raster.boundsPx.height) }
    // Identical pixels can carry distinct scale or provenance while sharing stored bytes.
    const id = rasterAssetId(sha256, logicalSizeMm, source, raster.sourceSvg)
    scene.assets[id] = { id, sha256, mimeType: 'image/png', pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight, logicalSizeMm, licenseRef, origin: { ...origin } }
    return id
  }
  const floorAsset = addAsset(input.floor), floorSize = scene.assets[floorAsset].logicalSizeMm
  const floorHash = hashJson({ floorAsset, preservesSource: !!sourceArt }), floorMaterial = `image-import-floor-material-${floorHash}`
  if (points.length) {
    const visiblePoints = [...points, ...visualLayers.flatMap(layer => [
      imagePointToWorldMm(calibration, { x: layer.boundsPx.x, y: layer.boundsPx.y }),
      imagePointToWorldMm(calibration, { x: layer.boundsPx.x + layer.boundsPx.width, y: layer.boundsPx.y + layer.boundsPx.height }),
    ])]
    const left = Math.min(...visiblePoints.map(point => point.x)) - 250, top = Math.min(...visiblePoints.map(point => point.y)) - 250
    scene.exportBoundsMm = { x: left, y: top, width: Math.max(1000, Math.max(...visiblePoints.map(point => point.x)) + 250 - left),
      height: Math.max(1000, Math.max(...visiblePoints.map(point => point.y)) + 250 - top) }
    scene.materials[floorMaterial] = { id: floorMaterial,
      catalogId: `material.image-import.${floorHash}`, version: 1, licenseRef, origin: { ...origin },
      name: '图片地板 · 遮挡补全', tags: ['图片拆解', '补全', ...(sourceArt ? ['原图保真'] : [])], textureAssetId: floorAsset, defaultTileSizeMm: { ...floorSize }, applicableSurfaces: sourceArt ? ['room', 'wall'] : ['room'] }
    const vertexIds = points.map((point, index) => {
      const id = `image-import-vertex-${index}`
      scene.vertices[id] = { id, floorId: IMAGE_IMPORT_IDS.floor, editLocked: false, xMm: point.x, yMm: point.y }; scene.entityLayers[id] = GROUND
      return id
    })
    for (const [index, startVertexId] of vertexIds.entries()) {
      const id = `image-import-wall-${index}`
      scene.walls[id] = { id, floorId: IMAGE_IMPORT_IDS.floor, editLocked: false, startVertexId, endVertexId: vertexIds[(index + 1) % vertexIds.length],
        thicknessMm: Math.max(1, imageDistanceToMm(calibration, 5)), blocksMovement: true, blocksSight: true, topStyle: null }
      scene.entityLayers[id] = GROUND
    }
    // A room can reach the image edge. Its wall bodies and joins still need a
    // flat physical Floor around their centre lines, independent of output crop.
    const wallPoints = wallEnvelopePolygons(scene).flatMap(wall => wall.polygon)
    const floorLeft = Math.floor(Math.min(topLeft.x, ...wallPoints.map(point => point.x)))
    const floorTop = Math.floor(Math.min(topLeft.y, ...wallPoints.map(point => point.y)))
    const floorRight = Math.ceil(Math.max(topLeft.x + width, ...wallPoints.map(point => point.x)))
    const floorBottom = Math.ceil(Math.max(topLeft.y + height, ...wallPoints.map(point => point.y)))
    scene.floors[IMAGE_IMPORT_IDS.floor].boundsMm = { x: floorLeft, y: floorTop, width: floorRight - floorLeft, height: floorBottom - floorTop }
    scene.rooms[IMAGE_IMPORT_IDS.room] = { id: IMAGE_IMPORT_IDS.room, floorId: IMAGE_IMPORT_IDS.floor, editLocked: false, visibility: 'public',
      purpose: '图片拆解房间', accessExpectation: 'intentionalIsolation', boundaryVertexIds: vertexIds,
      supportRef: { kind: 'floor', id: IMAGE_IMPORT_IDS.floor }, groundElevationMm: 0,
      floorStyle: { base: { materialRef: { id: floorMaterial, version: 1 }, tileSizeMm: { ...floorSize }, rotationDeg: 0, alignment: 'world',
        originMm: imagePointToWorldMm(calibration, { x: input.floor.boundsPx.x, y: input.floor.boundsPx.y }), tint: null, opacity: 1 }, overlays: [] } }
    scene.entityLayers[IMAGE_IMPORT_IDS.room] = GROUND
  } else {
    const { x, y, width: pixelWidth, height: pixelHeight } = input.floor.boundsPx
    const start = imagePointToWorldMm(calibration, { x, y })
    const end = imagePointToWorldMm(calibration, { x: x + pixelWidth, y: y + pixelHeight })
    const boundsMm = { ...start, width: end.x - start.x, height: end.y - start.y }
    scene.floors[IMAGE_IMPORT_IDS.floor].artwork = { assetId: floorAsset, boundsMm }
    scene.exportBoundsMm = { ...boundsMm }
  }
  const supportRef = points.length ? { kind: 'room' as const, id: IMAGE_IMPORT_IDS.room } : { kind: 'floor' as const, id: IMAGE_IMPORT_IDS.floor }
  for (const [index, layer] of visualLayers.entries()) {
    if (Object.hasOwn(scene.entityLayers, layer.id) || Object.hasOwn(scene.floors, layer.id) || Object.hasOwn(scene.userLayers, layer.id)) throw new Error('图片物件身份与工程实体冲突。')
    const assetId = addAsset(layer), size = scene.assets[assetId].logicalSizeMm
    const visualBoundsMm = { x: -Math.round(size.width / 2), y: -Math.round(size.height / 2), ...size }
    const positionMm = imagePointToWorldMm(calibration, { x: layer.boundsPx.x + layer.boundsPx.width / 2, y: layer.boundsPx.y + layer.boundsPx.height / 2 })
    const basis = layer.footprintBasisPx ?? layer.boundsPx
    assertImagePoint(calibration, { x: basis.x, y: basis.y })
    assertImagePoint(calibration, { x: basis.x + basis.width, y: basis.y + basis.height })
    const basisCenter = imagePointToWorldMm(calibration, { x: basis.x + basis.width / 2, y: basis.y + basis.height / 2 })
    let footprintMm = { width: Math.max(1, Math.round(imageDistanceToMm(calibration, basis.width) * .8)), height: Math.max(1, Math.round(imageDistanceToMm(calibration, basis.height) * .8)) }
    let footprintOffsetMm = { x: basisCenter.x - positionMm.x, y: basisCenter.y - positionMm.y }
    if (layer.footprintPx) {
      assertImagePoint(calibration, { x: layer.footprintPx.x, y: layer.footprintPx.y })
      assertImagePoint(calibration, { x: layer.footprintPx.x + layer.footprintPx.width, y: layer.footprintPx.y + layer.footprintPx.height })
      footprintMm = { width: imageDistanceToMm(calibration, layer.footprintPx.width), height: imageDistanceToMm(calibration, layer.footprintPx.height) }
      const center = imagePointToWorldMm(calibration, { x: layer.footprintPx.x + layer.footprintPx.width / 2, y: layer.footprintPx.y + layer.footprintPx.height / 2 })
      footprintOffsetMm = { x: center.x - positionMm.x, y: center.y - positionMm.y }
    }
    const buildingArt = sourceArt !== undefined && layer.id === SOURCE_BUILDING_ART_ID
    if (buildingArt) {
      // Drawn wall ink may extend beyond the wall body. It grants no physical
      // footprint or passage: the ordinary walls retain their actual thickness.
      let anchor: { x: number; y: number } | undefined
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
      const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
      for (let y = 1; y < 32 && !anchor; y++) for (let x = 1; x < 32 && !anchor; x++) {
        const p = { x: Math.round(minX + (maxX - minX) * x / 32), y: Math.round(minY + (maxY - minY) * y / 32) }
        if ([-1, 1].every(dx => [-1, 1].every(dy => pointInPolygon({ x: p.x + dx, y: p.y + dy }, points, false)))) anchor = p
      }
      if (!anchor) throw new Error('原图墙沿需要可验证的房间内部支撑点。')
      footprintMm = { width: 1, height: 1 }; footprintOffsetMm = { x: anchor.x - positionMm.x, y: anchor.y - positionMm.y }
    }
    const appearance = { kind: 'image' as const, assetId, tint: null, opacity: 1 }
    const defaultFields = { name: layer.name, tags: ['图片拆解', ...(buildingArt ? ['source-building-art'] : [])], defaultAppearance: appearance, defaultVisualBoundsMm: visualBoundsMm, defaultFootprintMm: footprintMm,
      defaultFootprintOffsetMm: footprintOffsetMm, defaultVolume: { kind: 'flat' as const, heightMm: 0 },
      defaultBlocksMovement: layer.blocksMovement, defaultBlocksSight: false, defaultRenderLayer: layer.renderLayer, defaultShadowClass: 'none' as const }
    const definitionHash = hashJson({ ...defaultFields, origin, licenseRef }), definitionId = `image-import-definition-${definitionHash}`
    scene.propDefinitions[definitionId] = { id: definitionId, catalogId: `prop.image-import.${definitionHash}`,
      version: 1, licenseRef, origin: { ...origin }, ...defaultFields }
    scene.props[layer.id] = { id: layer.id, floorId: IMAGE_IMPORT_IDS.floor, editLocked: buildingArt, visibility: 'public', definitionRef: { id: definitionId, version: 1 },
      appearance: { ...appearance }, visualBoundsMm: { ...visualBoundsMm }, footprintMm: { ...footprintMm }, footprintOffsetMm: { ...footprintOffsetMm },
      positionMm, rotationDeg: 0,
      blocksMovement: layer.blocksMovement, blocksSight: false, supportRef: { ...supportRef },
      ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}),
      renderLayer: layer.renderLayer, renderOrder: index, shadowClass: 'none', shadowOverride: null }
    scene.entityLayers[layer.id] = PROPS
  }
  if (sourceArt) {
    const paint = scene.rooms[IMAGE_IMPORT_IDS.room].floorStyle!
    for (const wall of Object.values(scene.walls)) wall.topStyle = structuredClone(paint)
    const themeId = `image-import-source-preserving-theme-${floorHash}`
    const zeroShadow = () => ({ directionDeg: 0, offsetMm: 0, blurMm: 0, opacity: 0, color: '#000000' })
    const zeroEdge = () => ({ strokeWidthMm: 0, bandWidthMm: 0, color: '#000000' })
    scene.styleThemes[themeId] = { id: themeId, catalogId: `theme.image-import.${floorHash}`, version: 1,
      licenseRef, origin: { ...origin }, name: '原图外观保留', materialSuggestions: [], propSuggestions: [], prefabSuggestions: [],
      outline: { widthMm: 0, color: '#000000' }, openingStyle: { doorStrokeWidthMm: 0, windowStrokeWidthMm: 0, frameWidthMm: 0, doorFill: '#000000', windowFill: '#000000' },
      edgeStyles: { shore: zeroEdge(), cliff: zeroEdge(), materialTransition: zeroEdge(), path: zeroEdge() },
      shadowPresets: { none: zeroShadow(), furniture: zeroShadow(), vegetation: zeroShadow(), wall: zeroShadow() },
      terrainCliff: { directionDeg: 0, offsetFactor: 0, maxOffsetMm: 0, blurMm: 0, opacity: 0, color: '#000000' } }
    scene.activeStyleThemeRef = { id: themeId, version: 1 }
  }
  visualBase(scene)!.environment = { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 1, lightDirectionDeg: 45, contactShadowMm: 0, contactShadowOpacity: 0 }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`图片工程无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.message}`).join('；')}`)
  return checked.document
}

export function createImageImportDocument(input: ImageImportProjectInput): SceneDocument {
  const captured = captureInput(input)
  if (captured.sourceArtwork || [captured.floor, ...captured.layers].some(raster => raster.sourceSvg !== undefined)) throw new Error('SVG或原图建筑外观请使用异步工程准备入口。')
  return buildDocument(captured, imageImportSource(captured))
}

/** Pure preparation. Persistence and automatic library installation happen after user adoption. */
export async function createImageImportProject(input: ImageImportProjectInput, signal?: AbortSignal, capabilities: CompleteValidationOptions = validation): Promise<EditableProject> {
  signal?.throwIfAborted()
  const captured = captureInput(input), bytes = new Map<string, Uint8Array>(), assets: Record<string, AssetRecord> = {}
  const svgSources = new Map<string, SvgAuthoringSource>()
  const materialize = async <T extends ImageImportRaster>(raster: T): Promise<T> => {
    signal?.throwIfAborted()
    if (raster.sourceSvg === undefined) return raster
    const output = await materializeImageImportSvg(raster.sourceSvg, raster.targetLongEdgePx, signal)
    for (const [hash, resource] of output.resourceBytes) bytes.set(hash, resource)
    svgSources.set(output.authoringSource.sourceSha256, output.authoringSource)
    return { ...raster, pngBytes: output.pngBytes, pixelWidth: output.pixelWidth, pixelHeight: output.pixelHeight }
  }
  captured.floor = await materialize(captured.floor)
  for (let index = 0; index < captured.layers.length; index++) captured.layers[index] = await materialize(captured.layers[index])
  if (captured.sourceArtwork && captured.layers.some(layer => layer.id === SOURCE_BUILDING_ART_ID)) throw new Error('图片物件身份与源建筑外观冲突。')
  const sourceArt = captured.sourceArtwork ? await prepareSourceBuildingArt(captured.floor, captured.sourceArtwork.roomBoundaryPx, capabilities, signal) : undefined
  const source = imageImportSource(captured), { licenseHash } = source
  const scene = buildDocument(captured, source, sourceArt), authoringSources: Record<string, SvgAuthoringSource> = {}
  const calibration = createImageCalibration(captured.calibration)
  for (const raster of [captured.floor, ...captured.layers, ...(sourceArt ? [sourceArt] : [])]) {
    if (raster.sourceSvg === undefined) continue
    const svgSource = svgSources.get(normalizeStaticSvg(raster.sourceSvg).sourceSha256)!
    const size = { width: imageDistanceToMm(calibration, raster.boundsPx.width), height: imageDistanceToMm(calibration, raster.boundsPx.height) }
    authoringSources[rasterAssetId(svgSource.rasterSha256, size, source, raster.sourceSvg)] = svgSource
  }
  for (const raster of [captured.floor, ...captured.layers, ...(sourceArt ? [sourceArt] : [])]) {
    const sha256 = sha256Bytes(raster.pngBytes)
    bytes.set(sha256, raster.pngBytes); assets[sha256] = { sha256, mimeType: 'image/png', sizeBytes: raster.pngBytes.length, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight }
  }
  const content = createCompositionContent(scene, runtime)
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets,
    licenses: { [licenseHash]: { sha256: licenseHash, text: captured.licenseText } }, authoringSources,
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }
  signal?.throwIfAborted()
  return fromBundle({ project, resources: createMemoryResources(bytes) }, { ...capabilities, signal })
}
