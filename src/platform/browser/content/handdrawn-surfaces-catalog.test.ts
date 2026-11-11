import { describe, expect, it, vi } from 'vitest'
import { toBundle } from '../../../application/workspace/project.js'
import { adoptLibraryEntries, listCatalogItems, prepareLibraryEntry } from '../../../shared/library/content.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { HANDDRAWN_SURFACE_ART, HANDDRAWN_SURFACE_LICENSE, HANDDRAWN_SURFACE_LICENSE_REF,
  handdrawnSurfaceAssetId, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { createThemePackCatalogDocument } from './theme-pack-catalog.js'
import { appendHanddrawnSurfaceDefinitions, createHanddrawnSurfacesCatalogDocument,
  createHanddrawnSurfacesCatalogProject, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'

const pixels = vi.hoisted(() => ({
  rasters: 0,
  raster(hash: string, width: number, height: number) {
    const rgba = new Uint8ClampedArray(width * height * 4)
    const rgb = [0, 2, 4].map(index => parseInt(hash.slice(index, index + 2), 16))
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([...rgb, 255], offset)
    return { width, height, rgba }
  },
}))

// Signature pixels exercise actual PNG/source/licence closure. Browser raster
// quality, seamlessness and user visual acceptance are separate observations.
vi.mock('../runtime.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `handdrawn-surfaces-test-${++sequence}` }, clock: { now: () => '2026-11-11T00:00:00.000Z' } },
    validation: { ...artworkValidation(), svg: { processor: CANONICAL_SVG_PROCESSOR,
      async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
        return pixels.raster(verifyNormalizedStaticSvg(input).normalizedSha256, dimensions.width, dimensions.height)
      } } } }
})
vi.mock('../ai/svg-raster.js', async () => {
  const { encodeFixtureRaster } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  return { async rasterizeNormalizedSvg(input: Parameters<typeof verifyNormalizedStaticSvg>[0], options: { longEdgePx: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted(); pixels.rasters++
    const source = verifyNormalizedStaticSvg(input)
    const pngBytes = encodeFixtureRaster(pixels.raster(source.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: source.normalizedSha256, ...CANONICAL_SVG_PROCESSOR }
  } }
})
import { validation } from '../runtime.js'

const expected = [
  ['weathered-oak', 6400], ['old-limestone-flags', 4800], ['dark-basalt-flags', 4800], ['warm-plaster', 3600],
] as const

describe('independent handdrawn material catalog', () => {
  it('defines four independent fixed materials with their actual tile sizes and no placed content', () => {
    const scene = createHanddrawnSurfacesCatalogDocument()
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(HANDDRAWN_SURFACE_ART.map(art => art.key)).toEqual(expected.map(([key]) => key))
    expect(Object.keys(scene.assets)).toHaveLength(4); expect(Object.keys(scene.materials)).toHaveLength(4)
    for (const collection of ['props', 'rooms', 'walls', 'terrainAreas', 'paths', 'propDefinitions', 'prefabDefinitions', 'scatterGroups', 'styleThemes', 'entityLayers'] as const) {
      expect(scene[collection]).toEqual({})
    }
    for (const [key, size] of expected) {
      const assetId = handdrawnSurfaceAssetId(key), definitionId = handdrawnSurfaceDefinitionId(key)
      const art = HANDDRAWN_SURFACE_ART.find(art => art.key === key)!
      expect(assetId).toBe(`handdrawn-surfaces-v1-art-${key}`)
      expect(definitionId).toBe(`handdrawn-surfaces-v1-material-${key}`)
      expect([art.widthMm, art.heightMm]).toEqual([size, size])
      expect(scene.assets[assetId]).toMatchObject({ id: assetId, pixelWidth: 1024, pixelHeight: 1024,
        logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: HANDDRAWN_SURFACE_LICENSE_REF })
      expect(scene.materials[definitionId]).toMatchObject({ id: definitionId, version: 1, name: art.name,
        catalogId: `material.sceneweave.handdrawn-surfaces.${key}`, textureAssetId: assetId,
        defaultTileSizeMm: { width: art.widthMm, height: art.heightMm }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] })
    }
    expect(HANDDRAWN_SURFACES_BATCH).toEqual({ artwork: HANDDRAWN_SURFACE_ART, licenseText: HANDDRAWN_SURFACE_LICENSE,
      assetId: handdrawnSurfaceAssetId, rasterLongEdgePx: 1024 })
  })

  it('appends only new definitions without changing old fixed sources and rejects occupied identities atomically', () => {
    const old = createThemePackCatalogDocument('fantasy'), before = canonicalJson(old)
    const appended = appendHanddrawnSurfaceDefinitions(old)
    expect(canonicalJson(old)).toBe(before)
    for (const collection of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) {
      for (const [id, value] of Object.entries(old[collection])) expect(appended[collection][id]).toEqual(value)
    }
    expect(() => appendHanddrawnSurfaceDefinitions(appended)).toThrow(/不覆盖/)
    const occupied = cloneJson(old), layerId = handdrawnSurfaceAssetId(expected[0][0]), floorId = Object.keys(old.floors)[0]
    const order = Object.values(occupied.userLayers).filter(layer => layer.floorId === floorId).length
    occupied.userLayers[layerId] = { id: layerId, floorId, name: '独立用户图层', order, editLocked: false }
    const occupiedBefore = canonicalJson(occupied)
    expect(() => appendHanddrawnSurfaceDefinitions(occupied)).toThrow(/不覆盖/)
    expect(canonicalJson(occupied)).toBe(occupiedBefore)
  })

  it('keeps exact source, byte hashes and licence through normal material adoption and cold editable file import', async () => {
    const project = await createHanddrawnSurfacesCatalogProject(), bundle = toBundle(project), items = listCatalogItems(bundle)
    const licenseHash = sha256Bytes(encodeUtf8(HANDDRAWN_SURFACE_LICENSE)), licensePath = `licenses/${licenseHash}.txt`
    expect(items).toHaveLength(4); expect(items.every(item => item.selector.kind === 'material')).toBe(true)
    expect(Object.keys(project.assets)).toHaveLength(4)
    expect(Object.values(project.licenses).map(record => record.text)).toEqual([HANDDRAWN_SURFACE_LICENSE])
    for (const art of HANDDRAWN_SURFACE_ART) {
      const id = handdrawnSurfaceAssetId(art.key), source = project.authoringSources[id]
      expect(project.document.assets[id]).toMatchObject({ pixelWidth: 1024, pixelHeight: 1024 })
      expect(project.assets[source.rasterSha256]).toMatchObject({ pixelWidth: 1024, pixelHeight: 1024 })
      expect(decodeUtf8(await project.resources.read(source.sourceSha256))).toBe(art.sourceSvg)
      expect(sha256Bytes(await project.resources.read(source.rasterSha256))).toBe(source.rasterSha256)
      for (const [subjectKind, subjectId] of [['asset', id], ['material', handdrawnSurfaceDefinitionId(art.key)]] as const) {
        expect(project.licenseBindings.find(binding => binding.subjectKind === subjectKind && binding.subjectId === subjectId)?.licensePath).toBe(licensePath)
      }
    }
    const entries = []
    for (const item of items) entries.push(await prepareLibraryEntry(bundle, item.selector, validation))
    const target = cloneJson(bundle.project)
    target.document.title = '保留当前工程'
    target.document.assets = {}; target.document.materials = {}
    target.assets = {}; target.authoringSources = {}; target.licenses = {}; target.licenseBindings = []
    const adopted = await adoptLibraryEntries({ project: target, resources: createMemoryResources(new Map()) }, entries, validation)
    expect(adopted.bundle.project.document.title).toBe('保留当前工程')
    const cold = await importProject(await exportProject(adopted.bundle, validation), validation)
    expect(cold.project.document.materials).toEqual(project.document.materials)
    expect(cold.project.authoringSources).toEqual(project.authoringSources)
    expect(listCatalogItems(cold).map(item => item.identity.key).sort()).toEqual(items.map(item => item.identity.key).sort())
    expect(cold.project.document.props).toEqual({})
  }, 30_000)

  it('cancels before source rasterization', async () => {
    const controller = new AbortController(), before = pixels.rasters
    controller.abort()
    await expect(createHanddrawnSurfacesCatalogProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(pixels.rasters).toBe(before)
  })
})
