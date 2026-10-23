import { applyCommandsV3 } from '../v3/commands'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3, symbolPropV3 } from '../v3/test-fixtures'
import { createCompositionContentV6, listRequiredVariantsV6, resolveAppearanceV6 } from './graph'
import { validateCompositionContentV6 } from './schema'
import type { CompositionContentV6 } from './types'

export function compositionFixtureV6(): CompositionContentV6 {
  const document = layerSceneV3()
  document.props.other = symbolPropV3('other', 7000, 4000)
  document.entityLayers.other = document.entityLayers.item
  return createCompositionContentV6(document)
}
export function imageFixtureV6(): CompositionContentV6 {
  const document = applyCommandsV3(compositionFixtureV6().document, [{ type: 'replacePropAppearance', id: 'item', definitionRef: { id: 'b2-p-03', version: 1 } }])
  return createCompositionContentV6(document)
}
export function prefabFixtureV6(): CompositionContentV6 { return createCompositionContentV6(groupLayerSceneV3()) }
export function surfaceFixtureV6(): CompositionContentV6 {
  const document = scatterLayerSceneV3(0), asset = Object.values(document.assets)[0]
  delete document.scatterGroups.scatter; delete document.entityLayers.scatter
  document.materials.material = { id: 'material', catalogId: 'test.material', version: 1, licenseRef: asset.licenseRef, origin: asset.origin,
    name: 'Test material', tags: [], textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
  const paint = { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
    alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
  document.terrainAreas.domain.surfaceStyle = { base: paint, overlays: [{ id: 'overlay', paint: { ...paint, opacity: .4 },
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 4000, y: 2000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }], blendWidthMm: 0, renderOrder: 0 }] }
  return createCompositionContentV6(document)
}
/** Pure-domain metadata fixture. Real transformed bytes and pixel equivalence are tested by IO/browser suites. */
export function resolveMetadataOnlyV6(input: CompositionContentV6): CompositionContentV6 {
  const content = structuredClone(input)
  for (const variant of listRequiredVariantsV6(content)) {
    content.appearance.variants[variant.id] = variant
    content.document.assets[variant.outputAssetId] = { ...structuredClone(content.document.assets[variant.sourceAssetId]), id: variant.outputAssetId, mimeType: 'image/png', sha256: 'e'.repeat(64) }
  }
  return validateCompositionContentV6(resolveAppearanceV6(content))
}
