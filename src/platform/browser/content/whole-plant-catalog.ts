import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { WHOLE_PLANT_ART, WHOLE_PLANT_LICENSE, WHOLE_PLANT_LICENSE_REF, WHOLE_PLANT_SPECS } from '../../../shared/visual/whole-plant-art.js'
import { wholePlantAssetId } from '../../../shared/visual/whole-plant-art.js'
import { runtime, validation } from '../runtime.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

const origin = { kind: 'original' as const, attribution: 'Sceneweave 整株植物v1；十二件独立原创俯视SVG，整棵树／整丛灌木／完整草本及真实毫米标定；保留既有固定源，未经用户P3签收', canEmbed: true }
export const WHOLE_PLANT_BATCH: VisualArtBatch = Object.freeze({ artwork: WHOLE_PLANT_ART, licenseText: WHOLE_PLANT_LICENSE, assetId: wholePlantAssetId, rasterLongEdgePx: 1024 })
function records(index: number) {
  const art = WHOLE_PLANT_ART[index], spec = WHOLE_PLANT_SPECS[index]
  return {
    asset: { id: spec.assetId, sha256: '0'.repeat(64), mimeType: 'image/png' as const, pixelWidth: 1024, pixelHeight: 1024,
      logicalSizeMm: { width: spec.widthMm, height: spec.heightMm }, licenseRef: WHOLE_PLANT_LICENSE_REF, origin: cloneJson(origin) },
    definition: { id: spec.definitionId, catalogId: spec.catalogId, version: spec.version, name: art.name, tags: [...art.tags!], licenseRef: WHOLE_PLANT_LICENSE_REF, origin: cloneJson(origin),
      defaultAppearance: { kind: 'image' as const, assetId: spec.assetId, tint: null, opacity: 1 }, defaultVisualBoundsMm: cloneJson(spec.visualBoundsMm),
      defaultFootprintMm: cloneJson(spec.footprintMm), defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!,
      defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! },
  }
}
function checked(input: SceneDocument): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`整株植物目录无效：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}
/** Construction only. Existing projects adopt an explicit catalogue selection. */
export function appendWholePlantDefinitions(input: SceneDocument): SceneDocument {
  const source = checked(input), scene = cloneJson(source), occupied = geometryIdentityIds(source)
  for (const spec of WHOLE_PLANT_SPECS) for (const id of [spec.assetId, spec.definitionId]) {
    if (occupied.has(id) || source.userLayers[id]) throw new Error('整株植物固定身份已占用，不覆盖现有内容。')
  }
  for (let i = 0; i < WHOLE_PLANT_ART.length; i++) {
    const fixed = records(i); scene.assets[fixed.asset.id] = fixed.asset; scene.propDefinitions[fixed.definition.id] = fixed.definition
  }
  return checked(scene)
}
export function createWholePlantCatalogDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const now = options.now ?? '2026-11-13T00:00:00.000Z', floorId = 'whole-plants-floor', layerId = 'whole-plants-layer', bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  return appendWholePlantDefinitions(toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: options.sceneId ?? 'whole-plants-v1-catalog', revision: 0,
    title: '整株植物 · 林地与河岸', createdAt: now, updatedAt: now, units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { ...bounds },
    floors: { [floorId]: { id: floorId, name: '植物目录空白地面', boundsMm: { ...bounds } } }, userLayers: { [layerId]: { id: layerId, floorId, name: '整株植物目录', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {},
    assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'sceneweave-whole-plants', presetVersion: 1, distanceMode: 'metric', source: origin.attribution, gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }, visual: emptyVisualSystem() }))
}
export async function materializeWholePlantScene(scene: SceneDocument, baseBatches: readonly VisualArtBatch[] = [], signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  for (let i = 0; i < WHOLE_PLANT_ART.length; i++) {
    const fixed = records(i), actual = scene.assets[fixed.asset.id]
    if (canonicalJson(scene.propDefinitions[fixed.definition.id] ?? null) !== canonicalJson(fixed.definition) || !actual || canonicalJson({ ...actual, sha256: fixed.asset.sha256 }) !== canonicalJson(fixed.asset)) {
      throw new Error('整株植物固定定义或标定不匹配。')
    }
  }
  const materialized = await materializeVisualArtBatches(cloneJson(scene), [...baseBatches, WHOLE_PLANT_BATCH], signal), project = captureEditableDraft(materialized)
  for (const spec of WHOLE_PLANT_SPECS) {
    const definition = project.document.propDefinitions[spec.definitionId]
    addPropAppearanceSource(project.appearance, { definitionRef: { id: definition.id, version: definition.version }, appearance: cloneJson(definition.defaultAppearance),
      visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, cloneJson(spec.presentation))
  }
  return validateEditableProject(project, { ...validation, signal })
}
export async function createWholePlantCatalogProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeWholePlantScene(createWholePlantCatalogDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), [], signal)
}
