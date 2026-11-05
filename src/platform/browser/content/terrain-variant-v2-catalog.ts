import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { TERRAIN_VARIANT_V2_ART, TERRAIN_VARIANT_V2_LICENSE, TERRAIN_VARIANT_V2_LICENSE_REF } from '../../../shared/visual/terrain-variant-v2-art.js'
import { terrainVariantV2AssetId, terrainVariantV2DefinitionId } from '../../../shared/visual/terrain-variant-v2-specs.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArt } from './visual-art-project.js'

export { terrainVariantV2AssetId, terrainVariantV2DefinitionId, TERRAIN_VARIANT_V2_SPECS } from '../../../shared/visual/terrain-variant-v2-specs.js'
const origin = { kind: 'original' as const, attribution: 'Sceneweave 地形物件变体v2；单件紧凑高台树原创SVG，独立固定尺寸/根锚/占地/许可；不改写v1或旧生成结果', canEmbed: true }

/** Independent one-item catalogue. V1 remains an exact, separate fixed batch. */
export function createTerrainVariantV2CatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-11-04T00:00:00.000Z', floorId = 'terrain-variants-v2-floor', layerId = 'terrain-variants-v2-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene: SceneDocument = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: options.sceneId ?? 'terrain-variants-v2-catalog', revision: 0,
    title: '地形物件变体 v2 · 高台紧凑树', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '地形物件变体 v2', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-terrain-variants-v2', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() })
  for (const art of TERRAIN_VARIANT_V2_ART) {
    const assetId = terrainVariantV2AssetId(art.key), id = terrainVariantV2DefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: TERRAIN_VARIANT_V2_LICENSE_REF, origin: cloneJson(origin) }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.terrain-variants-v2.${art.key}`, version: 1, name: art.name,
      tags: [...art.tags!], licenseRef: TERRAIN_VARIANT_V2_LICENSE_REF, origin: cloneJson(origin),
      defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: cloneJson(art.footprintMm!), defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`地形变体v2目录元数据无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

/** Materialize raw/normalized SVG, actual PNG and exact V2 licence together. */
export async function createTerrainVariantV2CatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const document = createTerrainVariantV2CatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const materialized = await materializeVisualArt(document, TERRAIN_VARIANT_V2_ART, TERRAIN_VARIANT_V2_LICENSE, terrainVariantV2AssetId, signal)
  const upgraded = materialized
  const project = captureEditableDraft(upgraded)
  project.document.title = '地形物件变体 v2 · 高台紧凑树'
  for (const art of TERRAIN_VARIANT_V2_ART) {
    const definition = project.document.propDefinitions[terrainVariantV2DefinitionId(art.key)]
    addPropAppearanceSource(project.appearance, { definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, art.presentation)
  }
  return validateEditableProject(project, { ...validation, signal })
}
