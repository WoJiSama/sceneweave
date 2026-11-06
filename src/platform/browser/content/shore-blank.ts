import type { EditableProject } from '../../../application/workspace/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { REFINED_COAST_ART, REFINED_COAST_LICENSE } from '../../../shared/visual/coast-art.js'
import { SHORE_ART, SHORE_LICENSE, SHORE_LICENSE_REF, shoreAssetId, shoreMaterialId } from '../../../shared/visual/shore-art.js'
import { TERRAIN_VARIANT_ART, TERRAIN_VARIANT_LICENSE } from '../../../shared/visual/terrain-variant-art.js'
import { terrainVariantAssetId } from '../../../shared/visual/terrain-variant-specs.js'
import { TERRAIN_VARIANT_V2_ART, TERRAIN_VARIANT_V2_LICENSE } from '../../../shared/visual/terrain-variant-v2-art.js'
import { terrainVariantV2AssetId } from '../../../shared/visual/terrain-variant-v2-specs.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { createTerrainVariantCatalogDocument } from './terrain-variant-catalog.js'
import { createTerrainVariantV2CatalogDocument } from './terrain-variant-v2-catalog.js'
import type { BlankOptions } from './factories.js'
import { createRefinedBlankDocument } from './refined-blank.js'
import { materializeVisualArtBatches } from './visual-art-project.js'

export type ShoreVisualPalette = 'island' | 'coast'
const original = { kind: 'original' as const, attribution: 'Sceneweave原创岸崖表面第1版；保留独立SVG、规范化源、实际PNG与确切MIT许可；未嵌入或描摹参考图片', canEmbed: true }

/** New generation palette only. Old fixed material, prop and theme snapshots
 * remain present and unchanged; no saved project is rewritten by this factory. */
export function createShoreBlankDocument(palette: ShoreVisualPalette, options: BlankOptions, includeTerrainVariants = false, includeTerrainVariantV2 = false): SceneDocument {
  if (palette !== 'island' && palette !== 'coast') throw new Error('岸崖表面仅支持岩岛或海岸素材库。')
  const scene = createRefinedBlankDocument(palette, options)
  for (const art of SHORE_ART) {
    const assetId = shoreAssetId(art.key), id = shoreMaterialId(art.key)
    if (scene.assets[assetId] || scene.materials[id]) throw new Error('新岸崖素材身份与固定来源冲突。')
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: SHORE_LICENSE_REF, origin: { ...original } }
    scene.materials[id] = { id, catalogId: `material.sceneweave.${art.key}`, version: 1, name: art.name, licenseRef: SHORE_LICENSE_REF, origin: { ...original },
      tags: ['原创', '岸崖表面v1', ...(art.tags ?? [])], textureAssetId: assetId, defaultTileSizeMm: { width: art.widthMm, height: art.heightMm },
      applicableSurfaces: ['terrain', 'path', 'room', 'wall'] }
  }
  if (includeTerrainVariants) {
    const catalogue = createTerrainVariantCatalogDocument({ sceneId: 'terrain-variants-v1-catalog', now: options.now })
    for (const [id, asset] of Object.entries(catalogue.assets)) {
      if (scene.assets[id]) throw new Error('地形物件变体素材身份与空白工程冲突。')
      scene.assets[id] = cloneJson(asset)
    }
    for (const [id, definition] of Object.entries(catalogue.propDefinitions)) {
      if (scene.propDefinitions[id]) throw new Error('地形物件变体定义身份与空白工程冲突。')
      scene.propDefinitions[id] = cloneJson(definition)
    }
  }
  if (includeTerrainVariantV2) {
    const catalogue = createTerrainVariantV2CatalogDocument({ sceneId: 'terrain-variants-v2-catalog', now: options.now })
    for (const [id, asset] of Object.entries(catalogue.assets)) {
      if (scene.assets[id]) throw new Error('地形物件变体v2素材身份与空白工程冲突。')
      scene.assets[id] = cloneJson(asset)
    }
    for (const [id, definition] of Object.entries(catalogue.propDefinitions)) {
      if (scene.propDefinitions[id]) throw new Error('地形物件变体v2定义身份与空白工程冲突。')
      scene.propDefinitions[id] = cloneJson(definition)
    }
  }
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: `${scene.presetSnapshot.presetId}-shore-v1`,
    source: `${scene.presetSnapshot.source}；追加独立岸崖表面v1固定来源，旧定义/主题保持；深浅水及干湿表面不授予通行` }
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`岸崖表面空白工程无效：${checked.errors.map(error => error.message).join('；')}`)
  return checked.document
}

export async function createShoreBlankProject(palette: ShoreVisualPalette, options: BlankOptions, signal?: AbortSignal, includeTerrainVariants = false, includeTerrainVariantV2 = false): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createShoreBlankDocument(palette, options, includeTerrainVariants, includeTerrainVariantV2)
  const base = palette === 'island' ? { artwork: REFINED_ISLAND_ART, licenseText: REFINED_ISLAND_LICENSE }
    : { artwork: REFINED_COAST_ART, licenseText: REFINED_COAST_LICENSE }
  return materializeVisualArtBatches(scene, [{ ...base, assetId: key => `refined-art-${key}` },
    { artwork: SHORE_ART, licenseText: SHORE_LICENSE, assetId: shoreAssetId },
    ...(includeTerrainVariants ? [{ artwork: TERRAIN_VARIANT_ART, licenseText: TERRAIN_VARIANT_LICENSE, assetId: terrainVariantAssetId }] : []),
    ...(includeTerrainVariantV2 ? [{ artwork: TERRAIN_VARIANT_V2_ART, licenseText: TERRAIN_VARIANT_V2_LICENSE, assetId: terrainVariantV2AssetId }] : [])], signal)
}
