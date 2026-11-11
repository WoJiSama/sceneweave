import { z } from 'zod'
import type { BoundsMm, PointMm, SceneDocument } from '../../../shared/model/scene.js'
import type { AssetRecord, ProjectData } from '../../../shared/model/project.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { createImageCalibration, imageDistanceToMm, imagePointToWorldMm } from '../../../shared/image-import/calibration.js'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { runtime, validation } from '../runtime.js'
import { createVisualBlankDocument } from './visual-samples.js'

export const IMAGE_ROOM_SAMPLE_NAME = '蓝毯琴房 · 图片分层样板'
export const IMAGE_ROOM_IDS = {
  room: 'image-room', piano: 'image-room-piano', rug: 'image-room-rug',
  floorMaterial: 'image-room-floor-material', floor: 'visual-floor',
} as const

/** Placement is in original reference-image pixels, independently of PNG resolution. */
export interface ImageRoomRaster {
  pngBytes: Uint8Array
  pixelWidth: number
  pixelHeight: number
  boundsPx: BoundsMm
}

export interface ImageRoomSampleInput {
  floor: ImageRoomRaster
  piano: ImageRoomRaster
  rug: ImageRoomRaster
  licenseText: string
  attribution: string
  sceneId?: string
  now?: string
}

export const IMAGE_ROOM_CALIBRATION = createImageCalibration({ pixelWidth: 1280, pixelHeight: 840,
  first: { x: 710, y: 85 }, second: { x: 750, y: 85 }, distanceMm: 1000, originPx: { x: 710, y: 85 } })
const GROUND = 'visual-layer-ground', PROPS = 'visual-layer-props'
const LICENSE = 'image-room-local-sample'
const ROOM_POINTS = [[738, 179], [793, 179], [847, 109], [1045, 109], [1100, 179], [1167, 179], [1167, 493], [738, 493]]
const keySchema = z.enum(['floor', 'piano', 'rug'])
type RasterKey = z.infer<typeof keySchema>
const keys: RasterKey[] = ['floor', 'piano', 'rug']
const imageBounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().max(1280), height: z.number().positive().max(840) }).strict()
const imageSize = z.number().int().positive().max(8192)
const assetId = (key: RasterKey) => `image-room-art-${key}`
const definitionId = (key: 'piano' | 'rug') => `image-room-definition-${key}`
const position = (x: number, y: number): PointMm => imagePointToWorldMm(IMAGE_ROOM_CALIBRATION, { x, y })

function captureRaster(input: ImageRoomRaster): ImageRoomRaster {
  const boundsPx = imageBounds.parse(input.boundsPx)
  const pixelWidth = imageSize.parse(input.pixelWidth), pixelHeight = imageSize.parse(input.pixelHeight)
  const bytes = new Uint8Array(input.pngBytes)
  if (bytes.length > 20 * 1024 * 1024 || bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) {
    throw new Error('琴房分层素材须为20 MiB以内的PNG。')
  }
  return { pngBytes: bytes, pixelWidth, pixelHeight, boundsPx }
}

/** The sample deliberately uses a declared 25 mm/px scale until a user calibrates it. */
export function createImageRoomSampleDocument(input: ImageRoomSampleInput): SceneDocument {
  const scene = createVisualBlankDocument({ title: IMAGE_ROOM_SAMPLE_NAME, widthMm: 12250, heightMm: 11000,
    preset: 'narrative', gridVisible: false, sceneId: input.sceneId ?? 'image-room-sample', now: input.now ?? '2026-11-10T00:00:00.000Z' })
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}; scene.styleThemes = {}; scene.activeStyleThemeRef = null
  scene.outputBackground = { mode: 'solid', color: '#E9E5DC' }
  scene.presetSnapshot = { presetId: 'image-room-manual-sample', presetVersion: 1, distanceMode: 'metric', gridSizeMm: 1000,
    source: '图片分层人工样板；声明标尺25mm/px；钢琴、地毯与地板独立，遮挡处为固定补全；实际比例待用户标定' }
  const origin = { kind: 'imported' as const, attribution: z.string().trim().min(1).parse(input.attribution), canEmbed: true }
  for (const key of keys) {
    const raster = captureRaster(input[key]), id = assetId(key)
    scene.assets[id] = { id, sha256: sha256Bytes(raster.pngBytes), mimeType: 'image/png', pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight,
      logicalSizeMm: { width: imageDistanceToMm(IMAGE_ROOM_CALIBRATION, raster.boundsPx.width), height: imageDistanceToMm(IMAGE_ROOM_CALIBRATION, raster.boundsPx.height) }, licenseRef: LICENSE, origin: { ...origin } }
  }
  const floorRaster = input.floor, floorSize = scene.assets[assetId('floor')].logicalSizeMm
  scene.materials[IMAGE_ROOM_IDS.floorMaterial] = { id: IMAGE_ROOM_IDS.floorMaterial, catalogId: 'material.sceneweave.image-room.floor', version: 1,
    licenseRef: LICENSE, origin: { ...origin }, name: '琴房木板 · 遮挡补全', tags: ['图片分层', '木板', '补全'], textureAssetId: assetId('floor'),
    defaultTileSizeMm: { ...floorSize }, applicableSurfaces: ['room'] }
  const vertices = ROOM_POINTS.map(([x, y], index) => {
    const id = `image-room-vertex-${index}`, p = position(x, y)
    scene.vertices[id] = { id, floorId: IMAGE_ROOM_IDS.floor, editLocked: false, xMm: p.x, yMm: p.y }; scene.entityLayers[id] = GROUND
    return id
  })
  for (const [index, id] of vertices.entries()) {
    const wallId = `image-room-wall-${index}`
    scene.walls[wallId] = { id: wallId, floorId: IMAGE_ROOM_IDS.floor, editLocked: false, startVertexId: id, endVertexId: vertices[(index + 1) % vertices.length],
      thicknessMm: 225, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[wallId] = GROUND
  }
  scene.rooms[IMAGE_ROOM_IDS.room] = { id: IMAGE_ROOM_IDS.room, floorId: IMAGE_ROOM_IDS.floor, editLocked: false, visibility: 'public',
    boundaryVertexIds: vertices, purpose: '琴房 · 斜墙、蓝毯与钢琴分层样板', accessExpectation: 'intentionalIsolation',
    supportRef: { kind: 'floor', id: IMAGE_ROOM_IDS.floor }, groundElevationMm: 0,
    floorStyle: { base: { materialRef: { id: IMAGE_ROOM_IDS.floorMaterial, version: 1 }, tileSizeMm: { ...floorSize }, rotationDeg: 0,
      alignment: 'world', originMm: position(floorRaster.boundsPx.x, floorRaster.boundsPx.y), tint: null, opacity: 1 }, overlays: [] } }
  scene.entityLayers[IMAGE_ROOM_IDS.room] = GROUND
  for (const key of ['rug', 'piano'] as const) {
    const raster = input[key], size = scene.assets[assetId(key)].logicalSizeMm, id = IMAGE_ROOM_IDS[key]
    const visualBoundsMm = { x: -Math.round(size.width / 2), y: -Math.round(size.height / 2), ...size }
    const footprintMm = key === 'piano' ? { width: Math.round(size.width * .78), height: Math.round(size.height * .72) } : { ...size }
    const definition = { id: definitionId(key), catalogId: `prop.sceneweave.image-room.${key}`, version: 1, licenseRef: LICENSE, origin: { ...origin },
      name: key === 'piano' ? '钢琴 · 可独立移动' : '蓝地毯 · 可独立移动', tags: ['图片分层', key === 'piano' ? '钢琴' : '地毯'],
      defaultAppearance: { kind: 'image' as const, assetId: assetId(key), tint: null, opacity: 1 }, defaultVisualBoundsMm: visualBoundsMm,
      defaultFootprintMm: footprintMm, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: key === 'piano', defaultBlocksSight: false,
      defaultRenderLayer: key === 'rug' ? 'ground' as const : 'object' as const, defaultShadowClass: 'none' as const }
    scene.propDefinitions[definition.id] = definition
    scene.props[id] = { id, floorId: IMAGE_ROOM_IDS.floor, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: 1 },
      appearance: { ...definition.defaultAppearance }, visualBoundsMm: { ...visualBoundsMm }, footprintMm: { ...footprintMm }, footprintOffsetMm: { x: 0, y: 0 },
      positionMm: position(raster.boundsPx.x + raster.boundsPx.width / 2, raster.boundsPx.y + raster.boundsPx.height / 2), rotationDeg: 0,
      blocksMovement: definition.defaultBlocksMovement, blocksSight: false, supportRef: { kind: 'room', id: IMAGE_ROOM_IDS.room }, roomId: IMAGE_ROOM_IDS.room,
      renderLayer: definition.defaultRenderLayer, renderOrder: key === 'rug' ? 0 : 10, shadowClass: 'none', shadowOverride: null }
    scene.entityLayers[id] = PROPS
  }
  visualBase(scene)!.environment = { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 1, lightDirectionDeg: 45, contactShadowMm: 0, contactShadowOpacity: 0 }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`琴房样板无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  return checked.document
}

/** Every PNG byte, dimension and license binding is checked before a sample can be adopted. */
export async function createImageRoomSampleProject(input: ImageRoomSampleInput, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const captured = { ...input, floor: captureRaster(input.floor), piano: captureRaster(input.piano), rug: captureRaster(input.rug),
    sceneId: input.sceneId ?? runtime.ids.nextId(), now: input.now ?? runtime.clock.now() }
  const scene = createImageRoomSampleDocument(captured), bytes = new Map<string, Uint8Array>(), assets: Record<string, AssetRecord> = {}
  for (const key of keys) {
    const raster = captured[key], sha256 = scene.assets[assetId(key)].sha256
    bytes.set(sha256, raster.pngBytes)
    assets[sha256] = { sha256, mimeType: 'image/png', sizeBytes: raster.pngBytes.length, pixelWidth: raster.pixelWidth, pixelHeight: raster.pixelHeight }
  }
  const licenseText = z.string().trim().min(1).parse(captured.licenseText), licenseHash = sha256Bytes(encodeUtf8(licenseText)), licensePath = `licenses/${licenseHash}.txt`
  const content = createCompositionContent(scene, runtime)
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets,
    licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath, embedding: 'allowed' as const })), authoringSources: {} }
  signal?.throwIfAborted()
  return fromBundle({ project, resources: createMemoryResources(bytes) }, { ...validation, signal })
}
