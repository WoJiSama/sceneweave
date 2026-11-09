import { describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { normalizeStaticSvg, verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { definitionPresentation, presentationSourceId } from '../../../shared/appearance/presentation.js'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import { assertSimpleVisualPolyline } from '../../../shared/visual/geometry.js'
import { listCatalogItems, prepareLibraryEntry, loadLibraryCapsule, adoptLibraryEntries } from '../../../shared/library/content.js'
import { importProject, exportProject } from '../../../shared/project/file.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { toBundle } from '../../../application/workspace/project.js'
import { NEAR_SIDE_ART } from './near-side-art.js'
import { REFINED_ISLAND_ART } from '../../../shared/visual/island-art.js'
import { TERRAIN_VARIANT_ART, TERRAIN_VARIANT_LICENSE, TERRAIN_VARIANT_LICENSE_REF } from '../../../shared/visual/terrain-variant-art.js'
import { TERRAIN_VARIANT_V2_ART, TERRAIN_VARIANT_V2_LICENSE, TERRAIN_VARIANT_V2_LICENSE_REF } from '../../../shared/visual/terrain-variant-v2-art.js'
import { createTerrainVariantCatalogDocument, createTerrainVariantCatalogProject, terrainVariantAssetId, terrainVariantDefinitionId,
  TERRAIN_VARIANT_DEFINITION_IDS, TERRAIN_VARIANT_PRESENTATIONS, TERRAIN_VARIANT_SPECS } from './terrain-variant-catalog.js'
import { createTerrainVariantV2CatalogDocument, createTerrainVariantV2CatalogProject, terrainVariantV2AssetId, terrainVariantV2DefinitionId,
  TERRAIN_VARIANT_V2_SPECS } from './terrain-variant-v2-catalog.js'

const fixturePixels = vi.hoisted(() => ({
  raster(hash: string, width: number, height: number) {
    const pixel = [0, 2, 4].map(index => parseInt(hash.slice(index, index + 2), 16)), rgba = new Uint8ClampedArray(width * height * 4)
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([...pixel, 255], offset)
    return { width, height, rgba }
  },
}))
// Metadata/resource closure ports use real PNG/CRC/hash but signature pixels.
// Actual SVG raster silhouettes, alpha and gallery are checked in Chromium.
vi.mock('../runtime.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `variant-test-${++sequence}` }, clock: { now: () => '2026-10-31T00:00:00.000Z' } },
    validation: { ...artworkValidation(), svg: { processor: CANONICAL_SVG_PROCESSOR, async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
      const normalized = verifyNormalizedStaticSvg(input)
      return fixturePixels.raster(normalized.normalizedSha256, dimensions.width, dimensions.height)
    } } } }
})
vi.mock('../ai/svg-raster.js', async () => {
  const { encodeFixtureRaster } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  return { async rasterizeNormalizedSvg(input: Parameters<typeof verifyNormalizedStaticSvg>[0], options: { longEdgePx: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted()
    const normalized = verifyNormalizedStaticSvg(input), pngBytes = encodeFixtureRaster(fixturePixels.raster(normalized.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: normalized.normalizedSha256, ...CANONICAL_SVG_PROCESSOR }
  } }
})
const validation = { ...artworkValidation(), svg: { processor: CANONICAL_SVG_PROCESSOR, async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
  const normalized = verifyNormalizedStaticSvg(input)
  return fixturePixels.raster(normalized.normalizedSha256, dimensions.width, dimensions.height)
} } }

describe('independent original terrain variant catalogue v1', () => {
  it('defines twelve independent source outlines and keeps all previous batches untouched', () => {
    const previous = canonicalJson([NEAR_SIDE_ART, REFINED_ISLAND_ART]), document = createTerrainVariantCatalogDocument()
    const roles = Object.fromEntries(['tree','rock','shrub','grass','scree'].map(role => [role, TERRAIN_VARIANT_ART.filter(art => art.role === role).length]))
    expect(roles).toEqual({tree:3,rock:3,shrub:2,grass:2,scree:2})
    expect(TERRAIN_VARIANT_DEFINITION_IDS).toHaveLength(12)
    expect(TERRAIN_VARIANT_SPECS).toHaveLength(12)
    expect(new Set(TERRAIN_VARIANT_ART.map(art => normalizeStaticSvg(art.sourceSvg).normalizedSha256)).size).toBe(12)
    expect(new Set(TERRAIN_VARIANT_ART.map(art => art.sourceSvg.match(/<path d="([^"]+)"/)![1])).size).toBe(12)
    const oldSources = new Set([...NEAR_SIDE_ART,...REFINED_ISLAND_ART].map(art => art.sourceSvg))
    for (const art of TERRAIN_VARIANT_ART) {
      expect(oldSources.has(art.sourceSvg)).toBe(false)
      expect(art.sourceSvg).not.toMatch(/<image|data:|<script|<filter|<rect/)
      const definition = document.propDefinitions[terrainVariantDefinitionId(art.key)], asset = document.assets[terrainVariantAssetId(art.key)]
      expect(definition.version).toBe(1)
      expect(definition.catalogId).toBe(`prop.sceneweave.terrain-variants-v1.${art.key}`)
      expect(definition.licenseRef).toBe(TERRAIN_VARIANT_LICENSE_REF)
      expect(asset.licenseRef).toBe(TERRAIN_VARIANT_LICENSE_REF)
      expect(asset.logicalSizeMm).toEqual({width:art.widthMm,height:art.heightMm})
      expect(definition.defaultFootprintMm).toEqual(art.footprintMm)
      expect(definition.defaultVisualBoundsMm).toEqual({x:-Math.round(art.widthMm/2),y:-Math.round(art.heightMm/2),width:art.widthMm,height:art.heightMm})
    }
    expect(document.props).toEqual({}); expect(document.materials).toEqual({})
    expect(canonicalJson([NEAR_SIDE_ART, REFINED_ISLAND_ART])).toBe(previous)
    expect(TERRAIN_VARIANT_LICENSE).toContain('MIT License')
  })

  it('keeps the compact V2 tree in an independent one-item catalogue and licence closure', async () => {
    const document = createTerrainVariantV2CatalogDocument(), art = TERRAIN_VARIANT_V2_ART[0]
    expect(TERRAIN_VARIANT_V2_ART).toHaveLength(1)
    expect(TERRAIN_VARIANT_V2_SPECS).toHaveLength(1)
    expect(terrainVariantV2DefinitionId('tree-highland-copse')).toBe('terrain-variants-v2-prop-tree-highland-copse')
    expect(terrainVariantV2AssetId('tree-highland-copse')).toBe('terrain-variants-v2-art-tree-highland-copse')
    expect(art.widthMm).toBe(1300); expect(art.heightMm).toBe(1450); expect(art.footprintMm).toEqual({ width: 320, height: 320 })
    expect(art.presentation).toMatchObject({ mode: 'nearSide', orientation: 'fixedUpright', fixedRotationDeg: 0, rootAnchorMm: { x: 0 } })
    expect(document.propDefinitions[terrainVariantV2DefinitionId(art.key)]).toMatchObject({
      catalogId: 'prop.sceneweave.terrain-variants-v2.tree-highland-copse', licenseRef: TERRAIN_VARIANT_V2_LICENSE_REF,
    })
    expect(document.assets[terrainVariantV2AssetId(art.key)]).toMatchObject({ licenseRef: TERRAIN_VARIANT_V2_LICENSE_REF, logicalSizeMm: { width: 1300, height: 1450 } })
    expect(TERRAIN_VARIANT_V2_LICENSE).toContain('version 2')
    const project = await createTerrainVariantV2CatalogProject()
    expect(Object.keys(project.document.assets)).toEqual([terrainVariantV2AssetId(art.key)])
    expect(Object.values(project.licenses).map(value => value.text)).toEqual([TERRAIN_VARIANT_V2_LICENSE])
  }, 60000)

  it('keeps roots, footprints and rendering semantics explicit without baked long shadows', () => {
    for (const art of TERRAIN_VARIANT_ART) {
      const presentation = TERRAIN_VARIANT_PRESENTATIONS[terrainVariantDefinitionId(art.key)]
      expect(presentation).toEqual(art.presentation)
      if (art.role === 'grass' || art.role === 'scree') {
        expect(art).toMatchObject({blocksMovement:false,blocksSight:false,renderLayer:'ground',shadowClass:'none'})
        expect(presentation).toEqual({mode:'topDown',rootAnchorMm:{x:0,y:0},orientation:'rotateWithGround',groundShadowMm:null})
      } else {
        expect(presentation).toMatchObject({mode:'nearSide',orientation:'fixedUpright',fixedRotationDeg:0,footprintAxes:'world'})
        expect(presentation.rootAnchorMm.x).toBe(0)
        expect(presentation.rootAnchorMm.y).toBeGreaterThan(0)
        const ring=presentation.groundShadowMm!
        expect(ring).toHaveLength(4);assertSimpleVisualPolyline(ring,true)
        expect(pointInPolygon({x:0,y:0},ring)).toBe(true)
        expect(art.sourceSvg).not.toMatch(/<ellipse|<filter|filter=/)
      }
      if(art.role==='shrub')expect(art.blocksMovement).toBe(false)
    }
  })

  it('preserves all exact source, licence and presentation closures through catalogue capsules and complete offline round trip', async () => {
    const provider = await createTerrainVariantCatalogProject(), bundle = toBundle(provider)
    expect(bundle.project.schemaVersion).toBe(1)
    expect(Object.keys(provider.document.assets)).toHaveLength(12)
    expect(Object.keys(provider.authoringSources)).toHaveLength(12)
    expect(Object.values(provider.licenses).map(value=>value.text)).toEqual([TERRAIN_VARIANT_LICENSE])
    const items = listCatalogItems(bundle), entries=[]
    expect(items).toHaveLength(12)
    for(const item of items) {
      const art=TERRAIN_VARIANT_ART.find(art=>terrainVariantDefinitionId(art.key)===item.selector.definitionId)!
      const entry=await prepareLibraryEntry(bundle,item.selector,validation), capsule=await loadLibraryCapsule(entry,validation)
      entries.push(entry)
      const definition=capsule.project.document.propDefinitions[item.selector.definitionId], ref={id:definition.id,version:definition.version}
      const presentation=definitionPresentation(capsule.project.appearance,ref)
      if(art.presentation.mode==='nearSide')expect(presentation).toEqual(art.presentation)
      else expect(presentation).toBeUndefined()
      const assetId=terrainVariantAssetId(art.key), source=capsule.project.authoringSources[assetId]
      expect(decodeUtf8(await capsule.resources.read(source.sourceSha256))).toBe(art.sourceSvg)
      expect(sha256Bytes(await capsule.resources.read(source.rasterSha256))).toBe(source.rasterSha256)
      const fixed=Object.values(capsule.project.appearance.sources).filter(source=>source.kind==='prop'&&source.snapshot.definitionRef?.id===ref.id)
      if(art.presentation.mode==='nearSide')expect(fixed.length).toBeGreaterThan(0)
      for(const source of fixed)if(source.kind==='prop'&&capsule.project.appearance.presentations?.[source.id]?.mode==='nearSide'){
        expect(source.id).toBe(presentationSourceId(source.snapshot,null,art.presentation))
      }
    }
    const empty=cloneJson(bundle.project)
    empty.document.assets={};empty.document.propDefinitions={};empty.appearance.sources={};empty.appearance.presentations={}
    empty.assets={};empty.licenses={};empty.licenseBindings=[];empty.authoringSources={}
    const adopted=await adoptLibraryEntries({project:empty,resources:createMemoryResources(new Map())},entries,validation)
    expect(adopted.operationCost).toBeLessThanOrEqual(256)
    expect(empty.document.propDefinitions).toEqual({})
    const cold=await importProject(await exportProject(adopted.bundle,validation),validation)
    expect(Object.keys(cold.project.document.propDefinitions)).toHaveLength(12)
    expect(cold.project.authoringSources).toEqual(provider.authoringSources)
    expect(cold.project.appearance.presentations).toEqual(Object.fromEntries(Object.entries(provider.appearance.presentations!).filter(([,value])=>value.mode==='nearSide')))
    expect(cold.project.document.props).toEqual({})
  },60000)

  it('cancels before any raster or partial provider result', async () => {
    const abort = new AbortController();abort.abort()
    await expect(createTerrainVariantCatalogProject(abort.signal)).rejects.toMatchObject({name:'AbortError'})
  })
})
