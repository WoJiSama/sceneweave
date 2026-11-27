import type { EditableProject } from '../../../application/workspace/project.js'
import { addBuiltinPropVolumes } from './builtin-prop-volumes.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { REFINED_COAST_ART, REFINED_COAST_LICENSE } from '../../../shared/visual/coast-art.js'
import { SHORE_ART, SHORE_LICENSE, SHORE_LICENSE_REF, shoreAssetId, shoreMaterialId } from '../../../shared/visual/shore-art.js'
import { TERRAIN_VARIANT_ART, TERRAIN_VARIANT_LICENSE } from '../../../shared/visual/terrain-variant-art.js'
import { terrainVariantAssetId } from '../../../shared/visual/terrain-variant-specs.js'
import { TERRAIN_VARIANT_V2_ART, TERRAIN_VARIANT_V2_LICENSE } from '../../../shared/visual/terrain-variant-v2-art.js'
import { NATURAL_STONE_ART, NATURAL_STONE_LICENSE, NATURAL_STONE_LICENSE_REF } from '../../../shared/visual/natural-stone-art.js'
import { naturalStoneAssetId, naturalStoneDefinitionId, type NaturalStoneKey } from '../../../shared/visual/natural-stone-shapes.js'
import { terrainVariantV2AssetId } from '../../../shared/visual/terrain-variant-v2-specs.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { newMapArtStyle } from '../../../shared/visual/art-style.js'
import { visualBase } from '../../../shared/visual/base.js'
import { createTerrainVariantCatalogDocument } from './terrain-variant-catalog.js'
import { createTerrainVariantV2CatalogDocument } from './terrain-variant-v2-catalog.js'
import type { BlankOptions } from './factories.js'
import { createRefinedBlankDocument } from './refined-blank.js'
import { addRefinedIslandArt, coastalScrubAssetId, COASTAL_SCRUB_ART } from './refined-island.js'
import { materializeVisualArtBatches, type VisualArtBatch } from './visual-art-project.js'

export type ShoreVisualPalette = 'island' | 'coast'
type CoastalDressing = boolean | 'naturalStone'
const original = { kind: 'original' as const, attribution: 'Sceneweave原创岸崖表面第1版；保留独立SVG、规范化源、实际PNG与确切MIT许可；未嵌入或描摹参考图片', canEmbed: true }

function addNaturalStoneDefinitions(scene: SceneDocument) {
  const origin = { kind: 'original' as const, attribution: 'Sceneweave 原创自然石头 v1，含固定 SVG、实际 PNG 及许可。', canEmbed: true }
  for (const art of NATURAL_STONE_ART) {
    const { key, name, tags, widthMm, heightMm } = art, assetId = naturalStoneAssetId(key), id = naturalStoneDefinitionId(key as NaturalStoneKey)
    if (scene.assets[assetId] || scene.propDefinitions[id]) throw new Error('自然石头固定素材身份已被占用。')
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: widthMm, height: heightMm }, licenseRef: NATURAL_STONE_LICENSE_REF, origin: { ...origin } }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.${id}`, version: 1, name, tags: [...tags!], licenseRef: NATURAL_STONE_LICENSE_REF, origin: { ...origin },
      defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -Math.round(widthMm / 2), y: -Math.round(heightMm / 2), width: widthMm, height: heightMm },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!,
      defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
}

/** New generation palette only. Old fixed material, prop and theme snapshots
 * remain present and unchanged; no saved project is rewritten by this factory. */
export function createShoreBlankDocument(palette: ShoreVisualPalette, options: BlankOptions, includeTerrainVariants = false, includeTerrainVariantV2 = false,
  coastalDressing: CoastalDressing = false): SceneDocument {
  if (palette !== 'island' && palette !== 'coast') throw new Error('岸崖表面仅支持岩岛或海岸素材库。')
  const scene = createRefinedBlankDocument(palette, options)
  if (palette === 'coast' && coastalDressing) addRefinedIslandArt(scene, COASTAL_SCRUB_ART, true)
  if (coastalDressing === 'naturalStone') addNaturalStoneDefinitions(scene)
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

const campMaterial = (key: string) => ({ id: `theme-pack-wilderness-material-${key}-v2`, version: 2 })
export const FOREST_CAMP_FINISH = {
  kind: 'woodland-v2', mossMaterialRef: { id: 'refined-material-island-material-moss', version: 1 },
  soilMaterialRef: campMaterial('forest-loam'), meadowMaterialRef: campMaterial('meadow-grass'), gravelMaterialRef: campMaterial('river-gravel'),
  stoneDefinitionRef: { id: 'refined-prop-island-debris-scree', version: 1 },
} as const

async function createShoreBlankContent(palette: ShoreVisualPalette, options: BlankOptions, signal?: AbortSignal, includeTerrainVariants = false,
  includeTerrainVariantV2 = false, woodland?: ReadonlySet<string> | { plants: ReadonlySet<string>; campFinish: true },
  coastalDressing: CoastalDressing = false) {
  signal?.throwIfAborted()
  let scene = createShoreBlankDocument(palette, options, includeTerrainVariants, includeTerrainVariantV2, coastalDressing)
  scene.artStyle = newMapArtStyle()
  const base = palette === 'island' ? { artwork: REFINED_ISLAND_ART, licenseText: REFINED_ISLAND_LICENSE }
    : { artwork: REFINED_COAST_ART, licenseText: REFINED_COAST_LICENSE }
  const refinedAssetId = (key: string) => `refined-art-${key}`
  const batches: VisualArtBatch[] = [{ ...base, assetId: refinedAssetId },
    { artwork: SHORE_ART, licenseText: SHORE_LICENSE, assetId: shoreAssetId },
    ...(palette === 'coast' && coastalDressing ? [{ artwork: COASTAL_SCRUB_ART, licenseText: REFINED_ISLAND_LICENSE, assetId: coastalScrubAssetId }] : []),
    ...(coastalDressing === 'naturalStone' ? [{ artwork: NATURAL_STONE_ART, licenseText: NATURAL_STONE_LICENSE, assetId: naturalStoneAssetId }] : []),
    ...(includeTerrainVariants ? [{ artwork: TERRAIN_VARIANT_ART, licenseText: TERRAIN_VARIANT_LICENSE, assetId: terrainVariantAssetId }] : []),
    ...(includeTerrainVariantV2 ? [{ artwork: TERRAIN_VARIANT_V2_ART, licenseText: TERRAIN_VARIANT_V2_LICENSE, assetId: terrainVariantV2AssetId }] : [])]
  if (woodland) {
    const { appendWholePlantDefinitions, WHOLE_PLANT_BATCH } = await import('./whole-plant-catalog.js')
    const woodlandPlants = 'plants' in woodland ? woodland.plants : woodland
    scene = appendWholePlantDefinitions(scene, woodlandPlants)
    addBuiltinPropVolumes(scene)
    Object.values(scene.floors)[0].environment = { ...visualBase(scene)!.environment, lightDirectionDeg: 42,
      directionalLight: { kind: 'sun', elevationDeg: 49, color: '#fff0ce', intensity: .58, softness: .65 } }
    batches.push({ ...WHOLE_PLANT_BATCH, artwork: WHOLE_PLANT_BATCH.artwork.filter(art => woodlandPlants.has(art.key)) })
    if ('campFinish' in woodland) {
      const [{ createThemePackCatalogDocument, themePackAssetId, themePackDefinitionId }, { THEME_PACK_ART, THEME_PACK_LICENSE }] = await Promise.all([
        import('./theme-pack-catalog.js'), import('../../../shared/visual/theme-pack-art.js'),
      ])
      const catalog = createThemePackCatalogDocument('wilderness'), assetId = (key: string) => themePackAssetId('wilderness', key)
      const materials = [FOREST_CAMP_FINISH.soilMaterialRef, FOREST_CAMP_FINISH.meadowMaterialRef, FOREST_CAMP_FINISH.gravelMaterialRef]
      for (const ref of materials) {
        const material = catalog.materials[ref.id]
        if (!material || material.version !== ref.version) throw new Error('森林营地缺少固定地表材质。')
        scene.materials[material.id] = material
        scene.assets[material.textureAssetId] = catalog.assets[material.textureAssetId]
      }
      const artwork = THEME_PACK_ART.wilderness.filter(art => art.kind === 'material' && materials.some(ref => ref.id === themePackDefinitionId('wilderness', 'material', art.key)))
      batches.push({ artwork, licenseText: THEME_PACK_LICENSE, assetId })
    }
  }
  return { scene, batches }
}

export async function createShoreBlankProject(...args: Parameters<typeof createShoreBlankContent>): Promise<EditableProject> {
  const { scene, batches } = await createShoreBlankContent(...args)
  return materializeVisualArtBatches(scene, batches, args[2])
}

export function createCoastalAscentBlankProject(palette: ShoreVisualPalette, options: BlankOptions, signal?: AbortSignal) {
  return createShoreBlankProject(palette, options, signal, false, false, undefined, 'naturalStone')
}

export function createLandscapeBlankContent(options: BlankOptions, signal?: AbortSignal) {
  return createShoreBlankContent('coast', options, signal, false, false,
    new Set(['pine-branched', 'oak-spreading', 'hazel-bush']), 'naturalStone')
}

const forestPlants = ['oak-spreading', 'pine-branched', 'hazel-bush', 'bramble-fruiting', 'fern-full-crown', 'wildflower-whole-clump']

export function createForestBlankProject(options: BlankOptions, signal?: AbortSignal) {
  return createShoreBlankProject('island', options, signal, true, true, new Set(forestPlants))
}

export function createForestCampBlankProject(options: BlankOptions, signal?: AbortSignal) {
  return createShoreBlankProject('island', options, signal, false, false, {
    plants: new Set([...forestPlants, 'sedge-tussock']), campFinish: true,
  })
}
