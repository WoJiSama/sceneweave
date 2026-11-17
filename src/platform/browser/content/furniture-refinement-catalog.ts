import { FURNITURE_CATEGORIES, furnitureAssetId, furnitureDefinitionId, type FurnitureCategory } from '../../../shared/assets/furniture-collection.js'
import { FURNITURE_COLLECTION_LICENSE } from '../../../shared/visual/furniture-collection-art.js'
import { FURNITURE_COLLECTION_REFINEMENT_CANDIDATES } from '../../../shared/visual/furniture-collection-refinement-art.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'
import { materializeVisualArtBatches } from './visual-art-project.js'
import { runtime } from '../runtime.js'

/** A separately authored fixed SVG edition. Its source contains the complete
 * original drawing followed by interior paint, and names its exact original
 * SVG hash. This never redefines an existing asset or uses a runtime image
 * refinement algorithm. Original editions remain available under their IDs. */
export function createFurnitureRefinementDocument(category: FurnitureCategory, options: { sceneId?: string; now?: string } = {}) {
  if (!FURNITURE_CATEGORIES.some(row => row.id === category)) throw new Error('未知家具类别。')
  const scene = createFurnitureCollectionDocument({ category, ...options })
  scene.title = `${FURNITURE_CATEGORIES.find(row => row.id === category)!.name} · 材质绘制版`
  const oldAssets = scene.assets, oldDefinitions = scene.propDefinitions
  scene.assets = {}; scene.propDefinitions = {}
  for (const candidate of FURNITURE_COLLECTION_REFINEMENT_CANDIDATES.filter(row => row.category === category)) {
    const assetId = furnitureAssetId(candidate.art.key), id = furnitureDefinitionId(candidate.art.key)
    const asset = cloneJson(oldAssets[furnitureAssetId(candidate.sourceKey)])
    const definition = cloneJson(oldDefinitions[furnitureDefinitionId(candidate.sourceKey)])
    const origin = { ...asset.origin, attribution: `${asset.origin.attribution}；材质绘制版1；原绘图${candidate.sourceKey} SVG SHA256 ${candidate.derivation.sourceSvgSha256}；原图保留，基础设计贡献0` }
    scene.assets[assetId] = { ...asset, id: assetId, origin: cloneJson(origin) }
    scene.propDefinitions[id] = { ...definition, id, catalogId: `${definition.catalogId}.material-study-1`, name: candidate.art.name,
      tags: [...candidate.art.tags!], origin, defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 } }
  }
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`家具材质目录无效：${result.errors.map(row => row.message).join('；')}`)
  return result.document
}

export async function createFurnitureRefinementProject(category: FurnitureCategory, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return materializeVisualArtBatches(createFurnitureRefinementDocument(category,{sceneId:runtime.ids.nextId(),now:runtime.clock.now()}), [{
    artwork: FURNITURE_COLLECTION_REFINEMENT_CANDIDATES.filter(row => row.category === category).map(row => row.art),
    licenseText: FURNITURE_COLLECTION_LICENSE, assetId: furnitureAssetId, rasterLongEdgePx: 1024,
  }], signal)
}
