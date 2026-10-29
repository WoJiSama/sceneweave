import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { prepareTerrainUpgrade } from '../../../application/workspace/terrain.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import type { FixedPresentation } from '../../../shared/terrain-generation/contracts.js'
import { cloneJson, freezeJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime, validation } from '../runtime.js'
import { NEAR_SIDE_ART, NEAR_SIDE_LICENSE, type NearSideArt } from './near-side-art.js'
import { materializeVisualArt } from './visual-art-project.js'

/** A new fixed-size recipe over the exact original T4 drawings; no old asset is redefined. */
export const TERRAIN_DRESSING_ART: readonly NearSideArt[] = freezeJson(NEAR_SIDE_ART.map(source => {
  const tree = source.renderLayer === 'canopy', scale = tree ? .72 : .8, presentation = cloneJson(source.presentation)
  presentation.rootAnchorMm = { x: Math.round(presentation.rootAnchorMm.x * scale), y: Math.round(presentation.rootAnchorMm.y * scale) }
  const shadow = presentation.groundShadowMm
  // This unpublished compact recipe saves its own four-corner silhouette;
  // the original T4 source keeps all eight vertices and the exact SVG pixels.
  presentation.groundShadowMm = shadow ? [0, 2, 4, 6].map(index => shadow[index])
    .map(point => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) })) : null
  return { ...cloneJson(source), key: `${source.key}-compact-v1`, name: `${source.name.replace(' · 近侧视', '')} · 地形布景`,
    widthMm: Math.round(source.widthMm * scale), heightMm: Math.round(source.heightMm * scale),
    footprintMm: tree ? { width: 520, height: 520 } : { width: 800, height: 600 },
    tags: [...(source.tags ?? []), '地形布景', '固定紧凑尺寸'], presentation }
}))
export const terrainDressingAssetId = (key: string): string => `terrain-dressing-art-${key}`
export const terrainDressingDefinitionId = (key: string): string => `terrain-dressing-prop-${key}`
export const DRESSING_DEFINITION_IDS: readonly string[] = freezeJson(TERRAIN_DRESSING_ART.map(art => terrainDressingDefinitionId(art.key)))
export const DRESSING_TREE_KEYS: readonly string[] = freezeJson(TERRAIN_DRESSING_ART.filter(art => art.renderLayer === 'canopy').map(art => art.key))
export const DRESSING_ROCK_KEYS: readonly string[] = freezeJson(TERRAIN_DRESSING_ART.filter(art => art.renderLayer === 'object').map(art => art.key))
export const DRESSING_PRESENTATIONS: Readonly<Record<string, FixedPresentation>> = freezeJson(Object.fromEntries(
  TERRAIN_DRESSING_ART.map(art => [terrainDressingDefinitionId(art.key), cloneJson(art.presentation)])))
const licenseRef = 'Sceneweave-T4-near-side-MIT-v1'
const origin = { kind: 'original' as const, attribution: 'Sceneweave 地形布景固定尺寸配方v1；复用T4独立近侧视原创SVG，树图像0.72/岩图像0.8及同比根锚与四点斜向地影配方；原T4八点地影、作品及确切MIT许可保全', canEmbed: true }

/** Metadata only until materialization: exactly six fixed props, with no sample entities or inherited palette. */
export function createTerrainDressingCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-10-29T00:00:00.000Z', floorId = 'terrain-dressing-floor', layerId = 'terrain-dressing-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene: SceneDocument = { format: 'sceneweave-scene', schemaVersion: 2, sceneId: options.sceneId ?? 'terrain-dressing-catalog-v1', revision: 0,
    title: '地形布景 · 紧凑固定目录', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '地形布景', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-terrain-dressing', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] }, visual: emptyVisualSystem() }
  for (const art of TERRAIN_DRESSING_ART) {
    const assetId = terrainDressingAssetId(art.key), id = terrainDressingDefinitionId(art.key)
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef, origin: cloneJson(origin) }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.terrain-dressing.${art.key}`, version: 1, name: art.name, tags: [...art.tags!],
      licenseRef, origin: cloneJson(origin), defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!,
      defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`地形布景目录元数据无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

/** Actual SVG/PNG/source/licence closure with complete3 fixed presentation roots; no instances are placed. */
export async function createTerrainDressingCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const document = createTerrainDressingCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  const materialized = await materializeVisualArt(document, TERRAIN_DRESSING_ART, NEAR_SIDE_LICENSE, terrainDressingAssetId, signal)
  const upgraded = await prepareTerrainUpgrade(materialized, { runtime, validation: { ...validation, signal } })
  const project = captureEditableDraft(upgraded)
  project.document.title = '地形布景 · 紧凑固定目录'
  for (const art of TERRAIN_DRESSING_ART) {
    const definition = project.document.propDefinitions[terrainDressingDefinitionId(art.key)]
    addPropAppearanceSource(project.appearance, { definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, art.presentation)
  }
  return validateEditableProject(project, { ...validation, signal })
}
