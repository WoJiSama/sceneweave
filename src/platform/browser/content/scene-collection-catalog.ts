import { applyCommands } from '../../../shared/commands/commands.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { SCENE_COLLECTION_AVAILABLE_CATEGORIES, SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { STORAGE_DESIGNS, storageAssetId, storageDefinitionId } from '../../../shared/assets/storage-collection.js'
import { TRADE_DESIGNS, tradeAssetId, tradeDefinitionId } from '../../../shared/assets/trade-collection.js'
import { kitchenAssetId, kitchenDefinitionId } from '../../../shared/assets/kitchen-collection.js'
import { washAssetId, washDefinitionId } from '../../../shared/assets/wash-collection.js'
import { lightingAssetId, lightingDefinitionId } from '../../../shared/assets/lighting-collection.js'
import { farmAssetId, farmDefinitionId } from '../../../shared/assets/farm-collection.js'
import { workshopAssetId, workshopDefinitionId } from '../../../shared/assets/workshop-collection.js'
import { adventureAssetId, adventureDefinitionId } from '../../../shared/assets/adventure-collection.js'
import { ritualAssetId, ritualDefinitionId } from '../../../shared/assets/ritual-collection.js'
import { furnishingDetailsAssetId, furnishingDetailsDefinitionId } from '../../../shared/assets/furnishing-details-collection.js'
import { periodEquipmentAssetId, periodEquipmentDefinitionId } from '../../../shared/assets/period-equipment-collection.js'
import { architectureAssetId, architectureDefinitionId } from '../../../shared/assets/architecture-collection.js'
import { natureAssetId, natureDefinitionId } from '../../../shared/assets/nature-collection.js'
import { transportAssetId, transportDefinitionId } from '../../../shared/assets/transport-collection.js'
import { surfacesTracesAssetId, surfacesTracesDefinitionId } from '../../../shared/assets/surfaces-traces-collection.js'
import { furnitureAssetId, furnitureDefinitionId, FURNITURE_CATEGORIES } from '../../../shared/assets/furniture-collection.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument, SurfaceRef } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { STORAGE_COLLECTION_ART, STORAGE_COLLECTION_LICENSE, STORAGE_COLLECTION_LICENSE_REF } from '../../../shared/visual/storage-collection-art.js'
import { TRADE_COLLECTION_ART, TRADE_COLLECTION_LICENSE, TRADE_COLLECTION_LICENSE_REF } from '../../../shared/visual/trade-collection-art.js'
import { KITCHEN_COLLECTION_ART, KITCHEN_COLLECTION_LICENSE, KITCHEN_COLLECTION_LICENSE_REF } from '../../../shared/visual/kitchen-collection-art.js'
import { WASH_COLLECTION_ART, WASH_COLLECTION_LICENSE, WASH_COLLECTION_LICENSE_REF } from '../../../shared/visual/wash-collection-art.js'
import { LIGHTING_COLLECTION_ART, LIGHTING_COLLECTION_LICENSE, LIGHTING_COLLECTION_LICENSE_REF } from '../../../shared/visual/lighting-collection-art.js'
import { FARM_COLLECTION_ART, FARM_COLLECTION_LICENSE, FARM_COLLECTION_LICENSE_REF } from '../../../shared/visual/farm-collection-art.js'
import { WORKSHOP_COLLECTION_ART, WORKSHOP_COLLECTION_LICENSE, WORKSHOP_COLLECTION_LICENSE_REF } from '../../../shared/visual/workshop-collection-art.js'
import { ADVENTURE_COLLECTION_ART, ADVENTURE_COLLECTION_LICENSE, ADVENTURE_COLLECTION_LICENSE_REF } from '../../../shared/visual/adventure-collection-art.js'
import { RITUAL_COLLECTION_ART, RITUAL_COLLECTION_LICENSE, RITUAL_COLLECTION_LICENSE_REF } from '../../../shared/visual/ritual-collection-art.js'
import { FURNISHING_DETAILS_ART, FURNISHING_DETAILS_LICENSE, FURNISHING_DETAILS_LICENSE_REF } from '../../../shared/visual/furnishing-details-collection-art.js'
import { PERIOD_EQUIPMENT_COLLECTION_ART, PERIOD_EQUIPMENT_COLLECTION_LICENSE, PERIOD_EQUIPMENT_COLLECTION_LICENSE_REF } from '../../../shared/visual/period-equipment-collection-art.js'
import { ARCHITECTURE_ART, ARCHITECTURE_LICENSE, ARCHITECTURE_LICENSE_REF } from '../../../shared/visual/architecture-collection-art.js'
import { NATURE_COLLECTION_ART, NATURE_COLLECTION_LICENSE, NATURE_COLLECTION_LICENSE_REF } from '../../../shared/visual/nature-collection-art.js'
import { TRANSPORT_COLLECTION_ART, TRANSPORT_COLLECTION_LICENSE, TRANSPORT_COLLECTION_LICENSE_REF } from '../../../shared/visual/transport-collection-art.js'
import { SURFACES_TRACES_ART, SURFACES_TRACES_LICENSE, SURFACES_TRACES_LICENSE_REF } from '../../../shared/visual/surfaces-traces-collection-art.js'
import { FURNITURE_COLLECTION_ART, FURNITURE_COLLECTION_LICENSE, FURNITURE_COLLECTION_LICENSE_REF } from '../../../shared/visual/furniture-collection-art.js'
import type { VisualSampleArt } from '../../../shared/visual/sample-art.js'
import { HANDDRAWN_SURFACE_ART, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime } from '../runtime.js'
import { appendHanddrawnSurfaceDefinitions, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'

const origin = { kind: 'original' as const, attribution: 'Sceneweave储物系列v1；原创静态SVG；代码辅助创作，用户美术签收独立', canEmbed: true }
const floorId = 'collection-floor', layerId = 'collection-props', structureLayer = 'collection-structure'
const checked = (scene: SceneDocument) => {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`素材场景无效：${result.errors.map(row => `${row.entityId ?? ''}:${row.code}:${row.message}`).join('；')}`)
  return result.document
}
function blank(sceneId: string, now: string): SceneDocument {
  const bounds = { x: 0, y: 0, width: 16000, height: 12000 }
  return toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId, revision: 0, title: '全场景素材 · 仓储与生活', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '展示地面', boundsMm: { ...bounds } } },
    userLayers: { [structureLayer]: { id: structureLayer, floorId, name: '房间', order: 0, editLocked: false }, [layerId]: { id: layerId, floorId, name: '物件', order: 1, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-scene-collection', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() })
}
function appendArt(scene: SceneDocument, artwork: readonly VisualSampleArt[], keys: readonly string[], assetKey: (key: string) => string, definitionKey: (key: string) => string, licenseRef: string, sourceFamily: string) {
  // Discovery can share one entrance without redefining already delivered sources.
  if (sourceFamily === 'furniture') {
    for (const category of FURNITURE_CATEGORIES) {
      const selected = keys.filter(key => key.startsWith(`${category.id}-`))
      if (!selected.length) continue
      const fixed = createFurnitureCollectionDocument({ category: category.id })
      for (const key of selected) {
        scene.assets[assetKey(key)] = cloneJson(fixed.assets[assetKey(key)])
        scene.propDefinitions[definitionKey(key)] = cloneJson(fixed.propDefinitions[definitionKey(key)])
      }
    }
    return scene
  }
  const names: Record<string, string> = { trade: '商贸', kitchen: '厨房', wash: '卫浴', lighting: '照明', farm: '农牧', workshop:'工坊', adventure:'军营地牢野营', ritual:'祭仪', 'furnishing-details':'家具细类', 'period-equipment':'1920年代设备', architecture:'建筑构件', nature:'自然', transport:'交通与公共设施', 'surfaces-traces':'地材与痕迹' }
  const sourceOrigin = sourceFamily === 'storage' ? origin : { ...origin, attribution: `Sceneweave${names[sourceFamily] ?? sourceFamily}系列v1；原创静态SVG；代码辅助创作，用户美术签收独立` }
  for (const art of artwork.filter(row => keys.includes(row.key))) {
    const assetId = assetKey(art.key), id = definitionKey(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef, origin: cloneJson(sourceOrigin) }
    if (art.kind === 'material') {
      scene.materials[id] = { id, catalogId: `material.sceneweave.${sourceFamily}-collection.${art.key}`, version: 1,
        name: art.name, tags: [...(art.tags ?? [])], licenseRef, origin: cloneJson(sourceOrigin), textureAssetId: assetId,
        defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
      continue
    }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.${sourceFamily}-collection.${art.key}`, version: 1, name: art.name, tags: [...art.tags!],
      licenseRef, origin: cloneJson(sourceOrigin), defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.floor(art.widthMm / 2), y: -Math.floor(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: cloneJson(art.footprintMm!), defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!,
      defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  return scene
}
const appendStorage = (scene: SceneDocument, keys: readonly string[]) => appendArt(scene, STORAGE_COLLECTION_ART, keys, storageAssetId, storageDefinitionId, STORAGE_COLLECTION_LICENSE_REF, 'storage')
const appendTrade = (scene: SceneDocument, keys: readonly string[]) => appendArt(scene, TRADE_COLLECTION_ART, keys, tradeAssetId, tradeDefinitionId, TRADE_COLLECTION_LICENSE_REF, 'trade')
const families = [
  { id:'furniture',artwork:FURNITURE_COLLECTION_ART,assetId:furnitureAssetId,definitionId:furnitureDefinitionId,licenseRef:FURNITURE_COLLECTION_LICENSE_REF,licenseText:FURNITURE_COLLECTION_LICENSE },
  { id: 'storage', artwork: STORAGE_COLLECTION_ART, assetId: storageAssetId, definitionId: storageDefinitionId, licenseRef: STORAGE_COLLECTION_LICENSE_REF, licenseText: STORAGE_COLLECTION_LICENSE },
  { id: 'trade', artwork: TRADE_COLLECTION_ART, assetId: tradeAssetId, definitionId: tradeDefinitionId, licenseRef: TRADE_COLLECTION_LICENSE_REF, licenseText: TRADE_COLLECTION_LICENSE },
  { id: 'kitchen', artwork: KITCHEN_COLLECTION_ART, assetId: kitchenAssetId, definitionId: kitchenDefinitionId, licenseRef: KITCHEN_COLLECTION_LICENSE_REF, licenseText: KITCHEN_COLLECTION_LICENSE },
  { id: 'wash', artwork: WASH_COLLECTION_ART, assetId: washAssetId, definitionId: washDefinitionId, licenseRef: WASH_COLLECTION_LICENSE_REF, licenseText: WASH_COLLECTION_LICENSE },
  { id: 'lighting', artwork: LIGHTING_COLLECTION_ART, assetId: lightingAssetId, definitionId: lightingDefinitionId, licenseRef: LIGHTING_COLLECTION_LICENSE_REF, licenseText: LIGHTING_COLLECTION_LICENSE },
  { id:'farm',artwork:FARM_COLLECTION_ART,assetId:farmAssetId,definitionId:farmDefinitionId,licenseRef:FARM_COLLECTION_LICENSE_REF,licenseText:FARM_COLLECTION_LICENSE },
  { id:'workshop',artwork:WORKSHOP_COLLECTION_ART,assetId:workshopAssetId,definitionId:workshopDefinitionId,licenseRef:WORKSHOP_COLLECTION_LICENSE_REF,licenseText:WORKSHOP_COLLECTION_LICENSE },
  { id:'adventure',artwork:ADVENTURE_COLLECTION_ART,assetId:adventureAssetId,definitionId:adventureDefinitionId,licenseRef:ADVENTURE_COLLECTION_LICENSE_REF,licenseText:ADVENTURE_COLLECTION_LICENSE },
  { id:'ritual',artwork:RITUAL_COLLECTION_ART,assetId:ritualAssetId,definitionId:ritualDefinitionId,licenseRef:RITUAL_COLLECTION_LICENSE_REF,licenseText:RITUAL_COLLECTION_LICENSE },
  { id:'furnishing-details',artwork:FURNISHING_DETAILS_ART,assetId:furnishingDetailsAssetId,definitionId:furnishingDetailsDefinitionId,licenseRef:FURNISHING_DETAILS_LICENSE_REF,licenseText:FURNISHING_DETAILS_LICENSE },
  { id:'period-equipment',artwork:PERIOD_EQUIPMENT_COLLECTION_ART,assetId:periodEquipmentAssetId,definitionId:periodEquipmentDefinitionId,licenseRef:PERIOD_EQUIPMENT_COLLECTION_LICENSE_REF,licenseText:PERIOD_EQUIPMENT_COLLECTION_LICENSE },
  { id:'architecture',artwork:ARCHITECTURE_ART,assetId:architectureAssetId,definitionId:architectureDefinitionId,licenseRef:ARCHITECTURE_LICENSE_REF,licenseText:ARCHITECTURE_LICENSE },
  { id:'nature',artwork:NATURE_COLLECTION_ART,assetId:natureAssetId,definitionId:natureDefinitionId,licenseRef:NATURE_COLLECTION_LICENSE_REF,licenseText:NATURE_COLLECTION_LICENSE },
  { id:'transport',artwork:TRANSPORT_COLLECTION_ART,assetId:transportAssetId,definitionId:transportDefinitionId,licenseRef:TRANSPORT_COLLECTION_LICENSE_REF,licenseText:TRANSPORT_COLLECTION_LICENSE },
  { id:'surfaces-traces',artwork:SURFACES_TRACES_ART,assetId:surfacesTracesAssetId,definitionId:surfacesTracesDefinitionId,licenseRef:SURFACES_TRACES_LICENSE_REF,licenseText:SURFACES_TRACES_LICENSE },
]
export const SCENE_COLLECTION_ARTWORK = families.flatMap(family => family.artwork)
/** Explicit category only; never silently splits an oversized adoption batch. */
export function createSceneCollectionDocument(category: string, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const selected = SCENE_COLLECTION_AVAILABLE_CATEGORIES.find(row => row.id === category)
  if (!selected) throw new Error('该类别尚无可加载素材。')
  const scene = blank(options.sceneId ?? 'scene-collection-catalog-v1', options.now ?? '2026-11-16T00:00:00.000Z'), keys = SCENE_COLLECTION_ITEMS.filter(row => row.category === category).map(row => row.key)
  const family = families.find(row => row.id === SCENE_COLLECTION_ITEMS.find(row => row.category === category)?.sourceFamily)
  if (!family) throw new Error('素材来源未注册。')
  return checked(appendArt(scene, family.artwork, keys, family.assetId, family.definitionId, family.licenseRef, family.id))
}
/** Exact fixed selection used by authored scenes; never a prefix or tag guess. */
export function createSceneCollectionSelectionDocument(definitionIds: readonly string[], options: { sceneId?: string; now?: string } = {}): SceneDocument {
  if (!definitionIds.length || new Set(definitionIds).size !== definitionIds.length) throw new Error('场景素材需要非空且不重复的固定定义选择。')
  const rows = definitionIds.map(id => {
    const row = SCENE_COLLECTION_ITEMS.find(item => item.definitionId === id)
    if (!row) throw new Error(`场景素材未注册：${id}`)
    return row
  })
  let scene = blank(options.sceneId ?? 'scene-collection-selection-v1', options.now ?? '2026-11-17T00:00:00.000Z')
  for (const family of families) {
    const keys = rows.filter(row => row.sourceFamily === family.id).map(row => row.key)
    if (keys.length) scene = appendArt(scene, family.artwork, keys, family.assetId, family.definitionId, family.licenseRef, family.id)
  }
  return checked(scene)
}
const storageBatch = (scene: SceneDocument) => ({ artwork: STORAGE_COLLECTION_ART.filter(row => !!scene.assets[storageAssetId(row.key)]), assetId: storageAssetId, licenseText: STORAGE_COLLECTION_LICENSE, rasterLongEdgePx: 1024 as const })
const tradeBatch = (scene: SceneDocument) => ({ artwork: TRADE_COLLECTION_ART.filter(row => !!scene.assets[tradeAssetId(row.key)]), assetId: tradeAssetId, licenseText: TRADE_COLLECTION_LICENSE, rasterLongEdgePx: 1024 as const })
export async function createSceneCollectionProject(category: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createSceneCollectionDocument(category, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, families.map(family => ({ artwork: family.artwork.filter(row => !!scene.assets[family.assetId(row.key)]), assetId: family.assetId, licenseText: family.licenseText, rasterLongEdgePx: 1024 as const })).filter(batch => batch.artwork.length), signal)
}
export function materializeSceneCollectionDocument(scene: SceneDocument, additional: readonly VisualArtBatch[] = [], signal?: AbortSignal) {
  const selected = families.map(family => ({ artwork: family.artwork.filter(row => !!scene.assets[family.assetId(row.key)]), assetId: family.assetId, licenseText: family.licenseText, rasterLongEdgePx: 1024 as const })).filter(batch => batch.artwork.length)
  return materializeVisualArtBatches(scene, [...additional, ...selected], signal)
}

export const SCENE_COLLECTION_STORAGE_ROOMS = [
  { id: 'medieval-store', name: '中世纪商队仓房', era: 'medieval', index: 0 },
  { id: 'fantasy-store', name: '西幻遗物保管室', era: 'fantasy', index: 8 },
  { id: 'period-store', name: '1920年代旅行货栈', era: '1920s', index: 16 },
] as const

/** Shelved wall storage, central cargo islands and a continuous broad door approach.
 * Twelve props retain independent definitions, source closures and room support. */
export function createSceneCollectionStorageRoomDocument(id: string, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const room = SCENE_COLLECTION_STORAGE_ROOMS.find(row => row.id === id)
  if (!room) throw new Error('未知仓储场景。')
  const categories = ['chest', 'barrel', 'basket', 'sack'] as const
  const designs = categories.flatMap(category => STORAGE_DESIGNS.filter(row => row.category === category).slice(room.index, room.index + 3))
  let scene = appendHanddrawnSurfaceDefinitions(appendStorage(blank(options.sceneId ?? `collection-${id}`, options.now ?? '2026-11-16T00:00:00.000Z'), designs.map(row => row.key)))
  scene.title = room.name
  let serial = 0
  const stamp = { ids: { nextId: () => `collection-room-structure-${++serial}` }, clock: { now: () => scene.updatedAt } }
  const roomId = 'collection-storage-room', material = HANDDRAWN_SURFACE_ART.find(row => row.key.includes('plank')) ?? HANDDRAWN_SURFACE_ART[0]
  scene = applyCommands(scene, [{ type: 'createRoom', id: roomId, floorId, layerId: structureLayer, purpose: room.name, thicknessMm: 250,
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 10000 }, { x: 2000, y: 10000 }], materialRef: { id: handdrawnSurfaceDefinitionId(material.key), version: 1 } }], stamp)
  const walls = Object.values(scene.walls), bottom = walls.find(wall => scene.vertices[wall.startVertexId].yMm === 10000 && scene.vertices[wall.endVertexId].yMm === 10000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'collection-storage-door', wallId: bottom.id, offsetReferenceVertexId: bottom.startVertexId,
    offsetMm: 5000, widthMm: 2000, kind: 'door', state: 'open', layerId: structureLayer }], stamp)
  const positions = [[3500, 3400, 0], [5300, 3400, 0], [3500, 5500, 90], [11000, 3500, 0], [12500, 3500, 0], [11800, 5200, 0], [10900, 7700, 0], [12400, 7700, 90], [11700, 9000, 0], [3500, 7600, 0], [5100, 7700, 30], [4000, 9000, -20]]
  designs.forEach((design, index) => {
    const [x, y, rotation] = positions[index]
    const prop = createBasePlacedProp(scene, storageDefinitionId(design.key), { x, y }, { ids: { nextId: () => `collection-room-${design.key}` }, clock: stamp.clock }, { floorId, supportRef: { kind: 'room', id: roomId } })
    prop.rotationDeg = (rotation + 360) % 360; prop.roomId = roomId; scene.props[prop.id] = prop; scene.entityLayers[prop.id] = layerId
  })
  // A composite illustration never substitutes for independent members.
  const grouped = [0, 1, 2].map(index => scene.props[`collection-room-${designs[index].key}`])
  const anchor = { x: 4200, y: 4200 }, prefabId = `storage-collection-v1-prefab-${id}`
  scene.prefabDefinitions[prefabId] = { id: prefabId, catalogId: `prefab.sceneweave.storage-collection.${id}`, version: 1,
    name: `${room.name}箱组`, tags: ['可拆组合', '箱', room.era], licenseRef: STORAGE_COLLECTION_LICENSE_REF, origin: cloneJson(origin),
    members: grouped.map((prop, index) => ({ key: `cargo-${index}`, propTemplate: {
      definitionRef: cloneJson(prop.definitionRef), appearance: cloneJson(prop.appearance), positionMm: { x: prop.positionMm.x - anchor.x, y: prop.positionMm.y - anchor.y }, rotationDeg: prop.rotationDeg,
      visualBoundsMm: cloneJson(prop.visualBoundsMm), footprintMm: cloneJson(prop.footprintMm), footprintOffsetMm: cloneJson(prop.footprintOffsetMm),
      blocksMovement: prop.blocksMovement, blocksSight: prop.blocksSight, renderLayer: prop.renderLayer, renderOrder: prop.renderOrder, shadowClass: prop.shadowClass, shadowOverride: null,
    } })) }
  const groupId = 'collection-cargo-group'
  scene.prefabInstances[groupId] = { id: groupId, floorId, editLocked: false, visibility: 'public', definitionRef: { id: prefabId, version: 1 }, anchorMm: anchor, rotationDeg: 0,
    members: Object.fromEntries(grouped.map((prop, index) => [`cargo-${index}`, { propId: prop.id, overrideFields: [] }])) }
  scene.entityLayers[groupId] = layerId
  const selected = handdrawnSurfaceDefinitionId(material.key)
  scene.materials = Object.fromEntries(Object.entries(scene.materials).filter(([key]) => key === selected))
  const used = new Set([...Object.values(scene.propDefinitions).flatMap(row => row.defaultAppearance.kind === 'image' ? [row.defaultAppearance.assetId] : []), ...Object.values(scene.materials).map(row => row.textureAssetId)])
  scene.assets = Object.fromEntries(Object.entries(scene.assets).filter(([key]) => used.has(key)))
  scene.revision = 0
  return checked(scene)
}
export async function createSceneCollectionStorageRoomProject(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createSceneCollectionStorageRoomDocument(id, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [
    storageBatch(scene), { ...HANDDRAWN_SURFACES_BATCH, artwork: HANDDRAWN_SURFACE_ART.filter(row => !!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(row.key)]) },
  ], signal)
}

export const SCENE_COLLECTION_TRADE_SCENES = [
  { id: 'medieval-market', name: '中世纪集市与仓房', era: 'medieval', index: 0 },
  { id: 'fantasy-market', name: '西幻药材与矿货集市', era: 'fantasy', index: 8 },
  { id: 'period-wholesale', name: '1920年代货行与路摊', era: '1920s', index: 16 },
] as const

/** A real store room and independently supported yard. Roof illustrations are
 * solid decorative props: they confer no walkable interior or upper support. */
export function createSceneCollectionTradeSceneDocument(id: string, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const layout = SCENE_COLLECTION_TRADE_SCENES.find(row => row.id === id)
  if (!layout) throw new Error('未知商贸场景。')
  let scene = blank(options.sceneId ?? `collection-${id}`, options.now ?? '2026-11-17T00:00:00.000Z')
  const storage = ['chest', 'barrel', 'basket', 'sack'].flatMap(category => STORAGE_DESIGNS.filter(row => row.category === category).slice(layout.index, layout.index + 2))
  const trade = ['shelf', 'shop-counter', 'market-stall'].flatMap(category => TRADE_DESIGNS.filter(row => row.category === category).slice(layout.index, layout.index + 2))
  const details = ['merchandise', 'trade-scale', 'cargo-label', 'packing'].flatMap(category => {
    const era = TRADE_DESIGNS.filter(row => row.category === category && row.era === layout.era)
    return era.slice(0, 2)
  })
  scene = appendHanddrawnSurfaceDefinitions(appendTrade(appendStorage(scene, storage.map(row => row.key)), [...trade, ...details].map(row => row.key)))
  scene.title = layout.name
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  scene.floors[floorId].boundsMm = bounds; scene.exportBoundsMm = { ...bounds }
  const stoneMaterial = handdrawnSurfaceDefinitionId('old-limestone-flags'), woodMaterial = handdrawnSurfaceDefinitionId('weathered-oak')
  const yardId = 'collection-trade-yard', roomId = 'collection-trade-store'
  const material = scene.materials[stoneMaterial]
  scene.terrainAreas[yardId] = { id: yardId, floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 1000, y: 1000 }, { x: 23000, y: 1000 }, { x: 23000, y: 17000 }, { x: 1000, y: 17000 }].map((positionMm, index) => ({ id: `yard-point-${index}`, segmentId: `yard-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 0, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
    surfaceStyle: { base: { materialRef: { id: stoneMaterial, version: 1 }, tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] } }
  scene.entityLayers[yardId] = structureLayer
  let serial = 0
  const stamp = { ids: { nextId: () => `trade-scene-structure-${++serial}` }, clock: { now: () => scene.updatedAt } }
  scene = applyCommands(scene, [{ type: 'createRoom', id: roomId, floorId, layerId: structureLayer, purpose: '仓储与交接', thicknessMm: 250,
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 11500, y: 2000 }, { x: 11500, y: 16000 }, { x: 2000, y: 16000 }], materialRef: { id: woodMaterial, version: 1 }, supportRef: { kind: 'terrainArea', id: yardId } }], stamp)
  const east = Object.values(scene.walls).find(wall => scene.vertices[wall.startVertexId].xMm === 11500 && scene.vertices[wall.endVertexId].xMm === 11500)!
  const north = Object.values(scene.walls).find(wall => scene.vertices[wall.startVertexId].yMm === 2000 && scene.vertices[wall.endVertexId].yMm === 2000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'collection-trade-door', wallId: east.id, offsetReferenceVertexId: east.startVertexId, offsetMm: 7800, widthMm: 2000, kind: 'door', state: 'open', layerId: structureLayer },
    { type: 'addOpening', id: 'collection-trade-window', wallId: north.id, offsetReferenceVertexId: north.startVertexId, offsetMm: 3300, widthMm: 2000, kind: 'window', layerId: structureLayer }], stamp)
  const place = (definitionId: string, x: number, y: number, rotation: number, support: SurfaceRef, suffix = '') => {
    const propId = `trade-scene-${definitionId}${suffix}`
    const prop = createBasePlacedProp(scene, definitionId, { x, y }, { ids: { nextId: () => propId }, clock: stamp.clock }, { floorId, supportRef: support })
    prop.rotationDeg = (rotation + 360) % 360
    if (support.kind === 'room') prop.roomId = support.id
    scene.props[prop.id] = prop; scene.entityLayers[prop.id] = layerId
    return prop
  }
  const roomSupport: SurfaceRef = { kind: 'room', id: roomId }, yardSupport: SurfaceRef = { kind: 'terrainArea', id: yardId }
  const positions = [[4300, 4300, 0], [8100, 4300, 0], [4500, 13300, 0], [8100, 13300, 0], [16300, 15100, 0], [18700, 15100, 30], [4050, 10900, 0], [5600, 10900, 330]]
  storage.forEach((design, index) => { const [x,y,rotation] = positions[index]; place(storageDefinitionId(design.key), x, y, rotation, index < 4 || index > 5 ? roomSupport : yardSupport) })
  const tradePositions = [[3150, 7800, 90], [10200, 7000, 90], [7000, 7600, 0], [7100, 14300, 0], [16900, 4200, 0], [16900, 10300, 0]]
  trade.forEach((design, index) => { const [x,y,rotation] = tradePositions[index]; place(tradeDefinitionId(design.key), x, y, rotation, index < 4 ? roomSupport : yardSupport) })
  const detailPositions = [[15900, 6400, 0], [18000, 6400, 0], [16400, 12600, 0], [18200, 12600, 0], [8000, 11400, 20], [8900, 11400, 330], [7500, 11600, 0], [9300, 13400, 0]]
  details.forEach((design, index) => { const [x,y,rotation] = detailPositions[index]; place(tradeDefinitionId(design.key), x, y, rotation, index < 4 ? yardSupport : roomSupport) })
  scene.materials = Object.fromEntries(Object.entries(scene.materials).filter(([key]) => key === stoneMaterial || key === woodMaterial))
  const used = new Set([...Object.values(scene.propDefinitions).flatMap(row => row.defaultAppearance.kind === 'image' ? [row.defaultAppearance.assetId] : []), ...Object.values(scene.materials).map(row => row.textureAssetId)])
  scene.assets = Object.fromEntries(Object.entries(scene.assets).filter(([key]) => used.has(key)))
  const themeId = 'trade-collection-v1-theme'
  const themeOrigin = { kind: 'original' as const, attribution: 'Sceneweave商贸场景v1；原创主题参数，未签收', canEmbed: true }
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 50, offsetMm, blurMm, opacity, color: '#3E4437' })
  scene.styleThemes[themeId] = { id: themeId, catalogId: 'theme.sceneweave.trade-collection', version: 1, name: '商贸暖石与旧木', licenseRef: TRADE_COLLECTION_LICENSE_REF, origin: themeOrigin,
    materialSuggestions: Object.keys(scene.materials).map(key => ({ id: key, version: 1 })), propSuggestions: [], prefabSuggestions: [], outline: { widthMm: 24, color: '#554C3A' },
    openingStyle: { doorStrokeWidthMm: 18, windowStrokeWidthMm: 14, frameWidthMm: 60, doorFill: '#9F8B64', windowFill: '#A4B5A0' },
    edgeStyles: { shore: { strokeWidthMm: 10, bandWidthMm: 80, color: '#D1C7A5' }, cliff: { strokeWidthMm: 18, bandWidthMm: 180, color: '#59644E' }, materialTransition: { strokeWidthMm: 0, bandWidthMm: 0, color: '#A7AE8D' }, path: { strokeWidthMm: 8, bandWidthMm: 0, color: '#766E56' } },
    shadowPresets: { none: shadow(0,0,0), furniture: shadow(65,50,.23), vegetation: shadow(150,80,.18), wall: shadow(110,70,.25) }, terrainCliff: { directionDeg: 50, offsetFactor: .15, maxOffsetMm: 400, blurMm: 70, opacity: .2, color: '#4F5D46' } }
  scene.activeStyleThemeRef = { id: themeId, version: 1 }
  scene.revision = 0
  return checked(scene)
}
export async function createSceneCollectionTradeSceneProject(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createSceneCollectionTradeSceneDocument(id, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [tradeBatch(scene), storageBatch(scene),
    { ...HANDDRAWN_SURFACES_BATCH, artwork: HANDDRAWN_SURFACE_ART.filter(row => !!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(row.key)]) },
  ], signal)
}
