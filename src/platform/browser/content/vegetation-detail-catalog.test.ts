import { describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { listCatalogItems, prepareLibraryEntry, adoptLibraryEntries } from '../../../shared/library/content.js'
import { importProject, exportProject } from '../../../shared/project/file.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { toBundle } from '../../../application/workspace/project.js'
import { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_LICENSE, VEGETATION_DETAIL_SPECS,
  vegetationDetailAssetId, vegetationDetailDefinitionId } from '../../../shared/visual/vegetation-detail-art.js'
import { createVegetationDetailCatalogDocument, createVegetationDetailCatalogProject,
  appendVegetationDetailDefinitions, materializeVegetationDetailScene } from './vegetation-detail-catalog.js'
import { createTerrainDressingCatalogDocument, TERRAIN_DRESSING_ART, terrainDressingAssetId } from './terrain-dressing-catalog.js'
import { NEAR_SIDE_LICENSE } from './near-side-art.js'

const fixturePixels = vi.hoisted(() => ({ raster(hash: string, width: number, height: number) {
  const pixel = [0, 2, 4].map(index => parseInt(hash.slice(index, index + 2), 16)), rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) rgba.set([...pixel, 255], (y * width + x) * 4)
  return { width, height, rgba }
} }))
// Explicit deterministic signature-pixel ports test byte/source/licence closure;
// they are not a visual rasterization or transparency acceptance of the artwork.
vi.mock('../runtime.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `vegetation-test-${++sequence}` }, clock: { now: () => '2026-11-10T00:00:00.000Z' } },
    validation: { ...artworkValidation(), svg: { processor: CANONICAL_SVG_PROCESSOR, async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
      const source = verifyNormalizedStaticSvg(input); return fixturePixels.raster(source.normalizedSha256, dimensions.width, dimensions.height)
    } } } }
})
vi.mock('../ai/svg-raster.js', async () => {
  const { encodeFixtureRaster } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  return { async rasterizeNormalizedSvg(input: Parameters<typeof verifyNormalizedStaticSvg>[0], options: { longEdgePx: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted(); const source = verifyNormalizedStaticSvg(input)
    const pngBytes = encodeFixtureRaster(fixturePixels.raster(source.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: source.normalizedSha256, ...CANONICAL_SVG_PROCESSOR }
  } }
})
const validation = { ...artworkValidation(), svg: { processor: CANONICAL_SVG_PROCESSOR, async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
  const source = verifyNormalizedStaticSvg(input); return fixturePixels.raster(source.normalizedSha256, dimensions.width, dimensions.height)
} } }

describe('vegetation detail fixed catalogue and materialization', () => {
  it('publishes exactly six calibrated definitions on a genuinely empty current-v1 document', () => {
    const document = createVegetationDetailCatalogDocument({ sceneId: 'six-plants' })
    expect(validateSceneDocument(document).ok).toBe(true); expect(document.sceneId).toBe('six-plants')
    expect(Object.keys(document.assets)).toHaveLength(6); expect(Object.keys(document.propDefinitions)).toHaveLength(6)
    for (const key of ['props','rooms','walls','openings','vertices','notes','regions','terrainAreas','terrainEdges','terrainConnections','paths','scatterGroups','materials','styleThemes','entityLayers'] as const) expect(document[key]).toEqual({})
    expect(document.activeStyleThemeRef).toBeNull()
    for (const spec of VEGETATION_DETAIL_SPECS) {
      const definition = document.propDefinitions[spec.definitionId], asset = document.assets[spec.assetId]
      expect(definition.defaultAppearance).toEqual({ kind: 'image', assetId: spec.assetId, tint: null, opacity: 1 })
      expect(definition.version).toBe(1); expect(definition.defaultFootprintMm).toEqual(spec.footprintMm)
      expect(definition.defaultVisualBoundsMm).toEqual(spec.visualBoundsMm)
      expect(Math.abs(spec.visualBoundsMm.x + spec.rootPixel.x / 512 * spec.widthMm)).toBeLessThanOrEqual(.5)
      expect(Math.abs(spec.visualBoundsMm.y + spec.rootPixel.y / 512 * spec.heightMm)).toBeLessThanOrEqual(.5)
      expect(asset.logicalSizeMm).toEqual({ width: spec.widthMm, height: spec.heightMm })
      expect(asset.origin.canEmbed).toBe(true)
    }
    Object.values(document.propDefinitions)[0].name = 'caller changed'
    expect(Object.values(createVegetationDetailCatalogDocument().propDefinitions)[0].name).not.toBe('caller changed')
  })

  it('appends only new records and refuses duplicate or cross-kind occupation atomically', () => {
    const source = createTerrainDressingCatalogDocument(), before = canonicalJson(source)
    const appended = appendVegetationDetailDefinitions(source)
    for (const [id, asset] of Object.entries(source.assets)) expect(appended.assets[id]).toEqual(asset)
    for (const [id, definition] of Object.entries(source.propDefinitions)) expect(appended.propDefinitions[id]).toEqual(definition)
    expect(canonicalJson(source)).toBe(before)
    expect(() => appendVegetationDetailDefinitions(appended)).toThrow('不覆盖')
    const occupied = cloneJson(source), floorId = Object.keys(occupied.floors)[0], id = vegetationDetailDefinitionId(VEGETATION_DETAIL_ART[5].key)
    occupied.userLayers[id] = { id, floorId, order: 1, name: '用户同名图层', editLocked: false }
    const occupiedBefore = canonicalJson(occupied)
    expect(() => appendVegetationDetailDefinitions(occupied)).toThrow('不覆盖')
    expect(canonicalJson(occupied)).toBe(occupiedBefore)
  })

  it('retains original SVG, actual byte hashes, exact licences and catalogue identities through adopt/export/cold import', async () => {
    const provider = await createVegetationDetailCatalogProject(), bundle = toBundle(provider), items = listCatalogItems(bundle)
    expect(items).toHaveLength(6); expect(Object.keys(provider.assets)).toHaveLength(6)
    expect(Object.values(provider.licenses).map(record => record.text)).toEqual([VEGETATION_DETAIL_LICENSE])
    for (const art of VEGETATION_DETAIL_ART) {
      const assetId = vegetationDetailAssetId(art.key), source = provider.authoringSources[assetId]
      expect(decodeUtf8(await provider.resources.read(source.sourceSha256))).toBe(art.sourceSvg)
      expect(sha256Bytes(await provider.resources.read(source.rasterSha256))).toBe(source.rasterSha256)
    }
    const entries = await Promise.all(items.map(item => prepareLibraryEntry(bundle, item.selector, validation)))
    const target = cloneJson(bundle.project)
    target.document.assets = {}; target.document.propDefinitions = {}; target.appearance.sources = {}; target.appearance.presentations = {}
    target.assets = {}; target.authoringSources = {}; target.licenses = {}; target.licenseBindings = []
    const adopted = await adoptLibraryEntries({ project: target, resources: createMemoryResources(new Map()) }, entries, validation)
    expect(adopted.operationCost).toBeLessThanOrEqual(256)
    const cold = await importProject(await exportProject(adopted.bundle, validation), validation)
    expect(cold.project.document.propDefinitions).toEqual(provider.document.propDefinitions)
    expect(cold.project.authoringSources).toEqual(provider.authoringSources)
    expect(listCatalogItems(cold).map(item => item.identity.key).sort()).toEqual(items.map(item => item.identity.key).sort())
    expect(cold.project.document.props).toEqual({})
  }, 30000)

  it('keeps two source batches bound to their original licence and rejects fixed-definition edits before materialization', async () => {
    const base = createTerrainDressingCatalogDocument(), source = appendVegetationDetailDefinitions(base), before = canonicalJson(source)
    const project = await materializeVegetationDetailScene(source, [{ artwork: TERRAIN_DRESSING_ART, licenseText: NEAR_SIDE_LICENSE, assetId: terrainDressingAssetId }])
    const oldHash = sha256Bytes(encodeUtf8(NEAR_SIDE_LICENSE)), newHash = sha256Bytes(encodeUtf8(VEGETATION_DETAIL_LICENSE))
    expect(Object.keys(project.licenses).sort()).toEqual([oldHash,newHash].sort())
    for (const art of TERRAIN_DRESSING_ART) expect(project.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === terrainDressingAssetId(art.key))!.licensePath).toBe(`licenses/${oldHash}.txt`)
    for (const art of VEGETATION_DETAIL_ART) expect(project.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === vegetationDetailAssetId(art.key))!.licensePath).toBe(`licenses/${newHash}.txt`)
    expect(canonicalJson(source)).toBe(before)
    const changed = cloneJson(source); changed.propDefinitions[vegetationDetailDefinitionId(VEGETATION_DETAIL_ART[0].key)].defaultFootprintMm.width++
    await expect(materializeVegetationDetailScene(changed, [])).rejects.toThrow('固定定义或标定不匹配')
    const controller = new AbortController(); controller.abort()
    await expect(createVegetationDetailCatalogProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  }, 30000)
})
