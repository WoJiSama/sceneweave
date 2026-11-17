import { applyCommands } from '../../../shared/commands/commands.js'
import { FURNITURE_CATEGORIES, FURNITURE_STYLES, furnitureAssetId, furnitureDefinitionId, furnitureKey, type FurnitureCategory } from '../../../shared/assets/furniture-collection.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { FURNITURE_COLLECTION_ART, FURNITURE_COLLECTION_LICENSE, FURNITURE_COLLECTION_LICENSE_REF } from '../../../shared/visual/furniture-collection-art.js'
import { HANDDRAWN_SURFACE_ART, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { runtime } from '../runtime.js'
import { appendHanddrawnSurfaceDefinitions, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { materializeVisualArtBatches } from './visual-art-project.js'

const origin = { kind: 'original' as const, attribution: 'Sceneweave家具系列v1；原创静态SVG，24种设计风格×床桌椅柜；代码辅助创作，未取得用户美术签收', canEmbed: true }
const floorId = 'furniture-collection-floor', layerId = 'furniture-collection-props', structureLayer = 'furniture-collection-structure'
const checked = (scene: SceneDocument) => {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`家具目录无效：${result.errors.map(row => `${row.entityId ?? ''}:${row.code}:${row.message}`).join('；')}`)
  return result.document
}
function blank(sceneId: string, now: string): SceneDocument {
  const bounds = { x: 0, y: 0, width: 16000, height: 12000 }
  return toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId, revision: 0, title: '床桌椅柜 · 中世纪、西幻与1920年代', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '家具展示地面', boundsMm: { ...bounds } } },
    userLayers: { [structureLayer]: { id: structureLayer, floorId, name: '房间', order: 0, editLocked: false }, [layerId]: { id: layerId, floorId, name: '家具', order: 1, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-furniture-collection', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() })
}

/** Each request is at most one explicit category (24), or one style (4).
 * No 96-entry adoption request is split to bypass the 64-entry batch limit. */
export function createFurnitureCollectionDocument(options: { category?: FurnitureCategory; styleId?: string; sceneId?: string; now?: string } = {}): SceneDocument {
  if (!options.category && !options.styleId) throw new Error('请明确选择家具类别或配套风格。')
  if (options.category && !FURNITURE_CATEGORIES.some(row => row.id === options.category)) throw new Error('未知家具类别。')
  if (options.styleId && !FURNITURE_STYLES.some(row => row.id === options.styleId)) throw new Error('未知家具风格。')
  const scene = blank(options.sceneId ?? 'furniture-collection-catalog-v1', options.now ?? '2026-11-16T00:00:00.000Z')
  for (const art of FURNITURE_COLLECTION_ART.filter(row => (!options.category || row.key.startsWith(`${options.category}-`)) && (!options.styleId || row.key.endsWith(`-${options.styleId}`)))) {
    const assetId = furnitureAssetId(art.key), id = furnitureDefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: FURNITURE_COLLECTION_LICENSE_REF, origin: cloneJson(origin) }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.furniture-collection.${art.key}`, version: 1, name: art.name, tags: [...art.tags!],
      licenseRef: FURNITURE_COLLECTION_LICENSE_REF, origin: cloneJson(origin), defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.floor(art.widthMm / 2), y: -Math.floor(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: cloneJson(art.footprintMm!), defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false,
      defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
  }
  return checked(scene)
}
export async function createFurnitureCollectionProject(options: { category?: FurnitureCategory; styleId?: string }, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createFurnitureCollectionDocument({ ...options, sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const artwork = FURNITURE_COLLECTION_ART.filter(row => !!scene.assets[furnitureAssetId(row.key)])
  return materializeVisualArtBatches(scene, [{ artwork, assetId: furnitureAssetId, licenseText: FURNITURE_COLLECTION_LICENSE, rasterLongEdgePx: 1024 }], signal)
}

/** One real editable room with four coordinated designs. Image pixels never
 * create support or passage; structure, opening and props remain independent. */
export function createFurnitureStyleRoomDocument(styleId: string, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const style = FURNITURE_STYLES.find(row => row.id === styleId)
  if (!style) throw new Error('未知家具风格。')
  let scene = appendHanddrawnSurfaceDefinitions(createFurnitureCollectionDocument({ styleId, ...options }))
  scene.title = `${style.name} · 配套客房与书桌`
  let serial = 0
  const stamp = { ids: { nextId: () => `furniture-room-structure-${++serial}` }, clock: { now: () => scene.updatedAt } }
  const roomId = 'furniture-style-room', material = HANDDRAWN_SURFACE_ART.find(row => row.key.includes('plank')) ?? HANDDRAWN_SURFACE_ART[0]
  scene = applyCommands(scene, [{ type: 'createRoom', id: roomId, floorId, layerId: structureLayer, purpose: `${style.name}客房`, thicknessMm: 250,
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 10000 }, { x: 2000, y: 10000 }], materialRef: { id: handdrawnSurfaceDefinitionId(material.key), version: 1 } }], stamp)
  const walls = Object.values(scene.walls), bottom = walls.find(wall => scene.vertices[wall.startVertexId].yMm === 10000 && scene.vertices[wall.endVertexId].yMm === 10000)!
  const top = walls.find(wall => scene.vertices[wall.startVertexId].yMm === 2000 && scene.vertices[wall.endVertexId].yMm === 2000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'furniture-style-door', wallId: bottom.id, offsetReferenceVertexId: bottom.startVertexId,
    offsetMm: 5400, widthMm: 1200, kind: 'door', state: 'open', layerId: structureLayer },
  { type: 'addOpening', id: 'furniture-style-window', wallId: top.id, offsetReferenceVertexId: top.startVertexId, offsetMm: 7500, widthMm: 1600, kind: 'window', layerId: structureLayer }], stamp)
  const placements = [ ['bed', 4200, 4700, 0], ['cabinet', 11300, 3000, 0], ['table', 10700, 6100, 0], ['chair', 10700, 7950, 0] ] as const
  for (const [category, x, y, rotation] of placements) {
    const prop = createBasePlacedProp(scene, furnitureDefinitionId(furnitureKey(category, styleId)), { x, y }, { ids: { nextId: () => `furniture-room-${category}` }, clock: stamp.clock }, { floorId, supportRef: { kind: 'room', id: roomId } })
    prop.rotationDeg = rotation; prop.roomId = roomId
    scene.props[prop.id] = prop; scene.entityLayers[prop.id] = layerId
  }
  const selected = handdrawnSurfaceDefinitionId(material.key)
  scene.materials = Object.fromEntries(Object.entries(scene.materials).filter(([id]) => id === selected))
  const used = new Set([...Object.values(scene.propDefinitions).flatMap(row => row.defaultAppearance.kind === 'image' ? [row.defaultAppearance.assetId] : []), ...Object.values(scene.materials).map(row => row.textureAssetId)])
  scene.assets = Object.fromEntries(Object.entries(scene.assets).filter(([id]) => used.has(id)))
  scene.revision = 0
  return checked(scene)
}
export async function createFurnitureStyleRoomProject(styleId: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createFurnitureStyleRoomDocument(styleId, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [
    { ...HANDDRAWN_SURFACES_BATCH, artwork: HANDDRAWN_SURFACE_ART.filter(row => !!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(row.key)]) },
    { artwork: FURNITURE_COLLECTION_ART.filter(row => !!scene.assets[furnitureAssetId(row.key)]), assetId: furnitureAssetId, licenseText: FURNITURE_COLLECTION_LICENSE, rasterLongEdgePx: 1024 },
  ], signal)
}
