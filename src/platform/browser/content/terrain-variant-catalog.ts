import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { prepareTerrainUpgrade } from '../../../application/workspace/terrain.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { TERRAIN_VARIANT_ART, TERRAIN_VARIANT_LICENSE, TERRAIN_VARIANT_LICENSE_REF } from '../../../shared/visual/terrain-variant-art.js'
import { terrainVariantAssetId, terrainVariantDefinitionId } from '../../../shared/visual/terrain-variant-specs.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArt } from './visual-art-project.js'

export { terrainVariantAssetId, terrainVariantDefinitionId, TERRAIN_VARIANT_DEFINITION_IDS,
  TERRAIN_VARIANT_PRESENTATIONS, TERRAIN_VARIANT_SPECS } from '../../../shared/visual/terrain-variant-specs.js'
const origin = { kind: 'original' as const, attribution: 'Sceneweave 地形物件变体v1；独立原创树岩、灌丛、草缘和碎石SVG，固定尺寸/根锚/占地；不替换旧素材或生成结果', canEmbed: true }

/** A new fixed catalogue, not a map and not a modification of any old art batch. */
export function createTerrainVariantCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-10-31T00:00:00.000Z', floorId = 'terrain-variants-v1-floor', layerId = 'terrain-variants-v1-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 2, sceneId: options.sceneId ?? 'terrain-variants-v1-catalog', revision: 0,
    title: '地形物件变体 · 原创固定目录', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '地形物件变体', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-terrain-variants', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() }
  for (const art of TERRAIN_VARIANT_ART) {
    const assetId = terrainVariantAssetId(art.key), id = terrainVariantDefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: TERRAIN_VARIANT_LICENSE_REF, origin: cloneJson(origin) }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.terrain-variants-v1.${art.key}`, version: 1, name: art.name,
      tags: [...art.tags!], licenseRef: TERRAIN_VARIANT_LICENSE_REF, origin: cloneJson(origin),
      defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: cloneJson(art.footprintMm!), defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`地形变体目录元数据无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

/** Real raw/normalized SVG, PNG, exact licence and fixed roots travel together. */
export async function createTerrainVariantCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const document = createTerrainVariantCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const materialized = await materializeVisualArt(document, TERRAIN_VARIANT_ART, TERRAIN_VARIANT_LICENSE, terrainVariantAssetId, signal)
  const upgraded = await prepareTerrainUpgrade(materialized, { runtime, validation: { ...validation, signal } })
  const project = captureEditableDraft(upgraded)
  project.document.title = '地形物件变体 · 原创固定目录'
  for (const art of TERRAIN_VARIANT_ART) {
    const definition = project.document.propDefinitions[terrainVariantDefinitionId(art.key)]
    addPropAppearanceSource(project.appearance, { definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, art.presentation)
  }
  return validateEditableProject(project, { ...validation, signal })
}
