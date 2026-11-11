import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_LICENSE, VEGETATION_DETAIL_LICENSE_REF,
  VEGETATION_DETAIL_VERSION, vegetationDetailAssetId, vegetationDetailDefinitionId } from '../../../shared/visual/vegetation-detail-art.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

export { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_SPECS, VEGETATION_DETAIL_LICENSE,
  vegetationDetailAssetId, vegetationDetailDefinitionId } from '../../../shared/visual/vegetation-detail-art.js'
const origin = { kind: 'original' as const, attribution: 'Sceneweave 植被细节固定变体v1；六件独立原创SVG，三种树冠/两种灌蕨/疏草簇及确切毫米尺寸、显式根锚与占地；不替换既有素材或生成结果', canEmbed: true }
export const VEGETATION_DETAIL_BATCH: VisualArtBatch = Object.freeze({ artwork: VEGETATION_DETAIL_ART,
  licenseText: VEGETATION_DETAIL_LICENSE, assetId: vegetationDetailAssetId })

function records(art: typeof VEGETATION_DETAIL_ART[number]) {
  const assetId = vegetationDetailAssetId(art.key), id = vegetationDetailDefinitionId(art.key)
  return {
    asset: { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png' as const, pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: VEGETATION_DETAIL_LICENSE_REF, origin: cloneJson(origin) },
    definition: { id, catalogId: `prop.sceneweave.vegetation-detail-v1.${art.key}`, version: VEGETATION_DETAIL_VERSION, name: art.name,
      tags: [...art.tags!], licenseRef: VEGETATION_DETAIL_LICENSE_REF, origin: cloneJson(origin),
      defaultAppearance: { kind: 'image' as const, assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.rootPixel.x / 512 * art.widthMm), y: -Math.round(art.rootPixel.y / 512 * art.heightMm), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 },
      defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! },
  }
}
function checked(scene: SceneDocument): SceneDocument {
  const value = validateSceneDocument(scene)
  if (!value.ok) throw new Error(`植被细节元数据无效：${value.errors.map(issue => issue.message).join('；')}`)
  return value.document
}

/** Construction only: append a separate fixed batch, with all-or-nothing ID
 * checks. Existing projects should use ordinary catalogue adoption instead. */
export function appendVegetationDetailDefinitions(input: SceneDocument): SceneDocument {
  const source = checked(input), scene = cloneJson(source)
  const occupied = new Set(Object.values(scene).flatMap(value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []))
  for (const art of VEGETATION_DETAIL_ART) {
    const { asset, definition } = records(art)
    if (occupied.has(asset.id) || occupied.has(definition.id)) throw new Error(`植被细节固定身份已存在，不覆盖：${art.key}。`)
    scene.assets[asset.id] = asset; scene.propDefinitions[definition.id] = definition
  }
  return checked(scene)
}

/** Empty metadata provider. Definitions describe physical footprints separately
 * from canopy image size; explicit image root anchors rotate with top-down artwork. */
export function createVegetationDetailCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-11-10T00:00:00.000Z', floorId = 'vegetation-detail-floor', layerId = 'vegetation-detail-layer'
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: options.sceneId ?? 'vegetation-detail-v1-catalog', revision: 0,
    title: '植被细节 · 原创固定变体', createdAt: now, updatedAt: now,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '目录空白地面', boundsMm: { ...bounds } } },
    userLayers: { [layerId]: { id: layerId, floorId, name: '植被细节目录', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-vegetation-detail', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() })
  return appendVegetationDetailDefinitions(scene)
}

/** Materialize a new scene that already includes this exact fixed batch.
 * Caller-supplied base batches retain their exact source/licence ownership. */
export async function materializeVegetationDetailScene(scene: SceneDocument, baseBatches: readonly VisualArtBatch[] = [], signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  for (const art of VEGETATION_DETAIL_ART) {
    const expected = records(art), actual = scene.assets[expected.asset.id]
    if (canonicalJson(scene.propDefinitions[expected.definition.id] ?? null) !== canonicalJson(expected.definition)
      || !actual || canonicalJson({ ...actual, sha256: expected.asset.sha256 }) !== canonicalJson(expected.asset)) {
      throw new Error(`植被细节固定定义或标定不匹配：${art.key}。`)
    }
  }
  const materialized = await materializeVisualArtBatches(cloneJson(scene), [...baseBatches, VEGETATION_DETAIL_BATCH], signal)
  const project = captureEditableDraft(materialized)
  for (const art of VEGETATION_DETAIL_ART) {
    const definition = project.document.propDefinitions[vegetationDetailDefinitionId(art.key)]
    addPropAppearanceSource(project.appearance, { definitionRef: { id: definition.id, version: definition.version },
      appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, cloneJson(art.presentation))
  }
  return validateEditableProject(project, { ...validation, signal })
}

export async function createVegetationDetailCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVegetationDetailScene(createVegetationDetailCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), [], signal)
}
