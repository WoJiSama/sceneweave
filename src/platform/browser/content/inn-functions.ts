import type { SceneDocument } from '../../../shared/model/scene.js'
import { INN_FUNCTION_ART, INN_FUNCTION_LICENSE, innAssetId, innDefinitionId, innMaterialId } from '../../../shared/visual/inn-functions-art.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'

/** Independent palette. No room design, coordinates or source ownership is imported. */
export function createInnFunctionCatalogDocument(): SceneDocument {
  const scene = createVisualBlankDocument({ title: '灰橡旅舍功能素材', widthMm: 10000, heightMm: 10000, preset: 'narrative', sceneId: 'inn-function-catalog-v1', now: '2026-11-16T00:00:00.000Z', gridVisible: false })
  scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}; scene.styleThemes = {}; scene.activeStyleThemeRef = null
  const origin = { kind: 'original' as const, attribution: 'Sceneweave原创灰橡旅舍功能素材；选择既有独立原画并增绘备餐、食材、布草、洗漱及床边物件；不携带旧布局', canEmbed: true }, licenseRef = 'sceneweave.inn-function.original.v1'
  for (const art of INN_FUNCTION_ART) {
    const id = innAssetId(art.key)
    scene.assets[id] = { id, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512, logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef, origin }
    if (art.kind === 'material') {
      const id = innMaterialId(art.key)
      scene.materials[id] = { id, catalogId: `sceneweave.inn-function.material.${art.key}`, version: 1, name: art.name, tags: ['灰橡旅舍', ...(art.tags ?? [])], licenseRef, origin,
        textureAssetId: innAssetId(art.key), defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    } else {
      const id = innDefinitionId(art.key)
      scene.propDefinitions[id] = { id, catalogId: `sceneweave.inn-function.prop.${art.key}`, version: 1, name: art.name, tags: [...new Set(['灰橡旅舍', ...(art.tags ?? [])])], licenseRef, origin,
        defaultAppearance: { kind: 'image', assetId: innAssetId(art.key), tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -art.widthMm / 2, y: -art.heightMm / 2, width: art.widthMm, height: art.heightMm },
        defaultFootprintMm: art.footprintMm!, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!, defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
    }
  }
  return scene
}
export async function createInnFunctionCatalogProject(signal?: AbortSignal) {
  const scene = createInnFunctionCatalogDocument()
  scene.sceneId = runtime.ids.nextId(); scene.createdAt = scene.updatedAt = runtime.clock.now()
  return materializeVisualArt(scene, INN_FUNCTION_ART, INN_FUNCTION_LICENSE, innAssetId, signal)
}
