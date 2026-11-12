import { describe, expect, it } from 'vitest'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { VOLCANIC_SURFACE_ART, VOLCANIC_SURFACE_LICENSE, VOLCANIC_SURFACE_LICENSE_REF,
  volcanicSurfaceAssetId, volcanicSurfaceDefinitionId } from '../../../shared/visual/volcanic-surfaces.js'
import { appendVolcanicSurfaceDefinitions, createVolcanicSurfacesCatalogDocument, VOLCANIC_SURFACES_BATCH } from './volcanic-surfaces-catalog.js'

describe('independent volcanic material definitions', () => {
  it('keeps opaque source identities, complete physical tile sizes and no placed content', () => {
    const document = createVolcanicSurfacesCatalogDocument()
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(Object.keys(document.materials)).toHaveLength(5)
    expect(Object.keys(document.assets)).toHaveLength(5)
    for (const art of VOLCANIC_SURFACE_ART) {
      const assetId = volcanicSurfaceAssetId(art.key), id = volcanicSurfaceDefinitionId(art.key)
      expect(document.materials[id]).toMatchObject({ id, version: 1, textureAssetId: assetId,
        applicableSurfaces: ['terrain', 'path'], defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: VOLCANIC_SURFACE_LICENSE_REF })
      expect(document.assets[assetId]).toMatchObject({ logicalSizeMm: { width: art.widthMm, height: art.heightMm }, pixelWidth: 1024, pixelHeight: 1024 })
    }
    for (const collection of ['props', 'rooms', 'walls', 'terrainAreas', 'paths', 'regions', 'styleThemes', 'entityLayers'] as const) expect(document[collection]).toEqual({})
    expect(VOLCANIC_SURFACES_BATCH).toEqual({ artwork: VOLCANIC_SURFACE_ART, licenseText: VOLCANIC_SURFACE_LICENSE, assetId: volcanicSurfaceAssetId, rasterLongEdgePx: 1024 })
  })
  it('refuses identity collisions without mutating existing source data', () => {
    const document = createVolcanicSurfacesCatalogDocument(), before = canonicalJson(document)
    expect(() => appendVolcanicSurfaceDefinitions(document)).toThrow(/不覆盖/)
    expect(canonicalJson(document)).toBe(before)
    const vacant = cloneJson(document); vacant.assets = {}; vacant.materials = {}
    const id = volcanicSurfaceAssetId(VOLCANIC_SURFACE_ART[0].key), floorId = Object.keys(vacant.floors)[0]
    vacant.userLayers[id] = { id, floorId, name: '独立用户图层', order: 1, editLocked: false }
    const previous = canonicalJson(vacant)
    expect(() => appendVolcanicSurfaceDefinitions(vacant)).toThrow(/不覆盖/)
    expect(canonicalJson(vacant)).toBe(previous)
  })
})
