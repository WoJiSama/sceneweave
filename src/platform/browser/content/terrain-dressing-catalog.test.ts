import { describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { normalizeStaticSvg, verifyNormalizedStaticSvg } from '../../../shared/ai/svg.js'
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
import { NEAR_SIDE_ART, NEAR_SIDE_LICENSE } from './near-side-art.js'
import { TERRAIN_DRESSING_ART, createTerrainDressingCatalogDocument, createTerrainDressingCatalogProject,
  terrainDressingAssetId, terrainDressingDefinitionId, DRESSING_DEFINITION_IDS, DRESSING_TREE_KEYS, DRESSING_ROCK_KEYS, DRESSING_PRESENTATIONS } from './terrain-dressing-catalog.js'

const fixturePixels = vi.hoisted(() => ({
  raster(hash: string, width: number, height: number) {
    const pixel = [0, 2, 4].map(index => parseInt(hash.slice(index, index + 2), 16)), rgba = new Uint8ClampedArray(width * height * 4)
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([...pixel, 255], offset)
    return { width, height, rgba }
  },
}))

// Explicit unit ports: real PNG/CRC/hash and original SVG bytes, with signature
// pixels instead of a browser drawing. This is closure/cold-read evidence only.
vi.mock('../runtime.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `dressing-test-${++sequence}` }, clock: { now: () => '2026-10-29T00:00:00.000Z' } },
    validation: { ...artworkValidation(), svg: { async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
      const normalized = verifyNormalizedStaticSvg(input)
      return fixturePixels.raster(normalized.normalizedSha256, dimensions.width, dimensions.height)
    } } } }
})
vi.mock('../ai/svg-raster.js', async () => {
  const { encodeFixtureRaster } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg } = await import('../../../shared/ai/svg.js')
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  return { async rasterizeNormalizedSvg(input: Parameters<typeof verifyNormalizedStaticSvg>[0], options: { longEdgePx: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted()
    const normalized = verifyNormalizedStaticSvg(input), pngBytes = encodeFixtureRaster(fixturePixels.raster(normalized.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: normalized.normalizedSha256, processorId: normalized.processorId, processorVersion: normalized.processorVersion }
  } }
})
const validation = { ...artworkValidation(), svg: { async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
  const normalized = verifyNormalizedStaticSvg(input)
  return fixturePixels.raster(normalized.normalizedSha256, dimensions.width, dimensions.height)
} } }

describe('independent compact terrain dressing catalogue', () => {
  it('preserves each exact old drawing/license while fixing new sizes, coherent root/shadow scales and separate identities', () => {
    const before = canonicalJson(NEAR_SIDE_ART), document = createTerrainDressingCatalogDocument()
    expect(TERRAIN_DRESSING_ART).toHaveLength(6)
    expect(DRESSING_DEFINITION_IDS).toEqual(TERRAIN_DRESSING_ART.map(art => terrainDressingDefinitionId(art.key)))
    expect(DRESSING_TREE_KEYS).toHaveLength(3); expect(DRESSING_ROCK_KEYS).toHaveLength(3)
    expect(new Set(TERRAIN_DRESSING_ART.map(art => art.sourceSvg)).size).toBe(6)
    for (const [index, art] of TERRAIN_DRESSING_ART.entries()) {
      const old = NEAR_SIDE_ART[index], tree = old.renderLayer === 'canopy', scale = tree ? .72 : .8
      expect(art.sourceSvg).toBe(old.sourceSvg)
      expect(normalizeStaticSvg(art.sourceSvg).normalizedSha256).toBe(normalizeStaticSvg(old.sourceSvg).normalizedSha256)
      expect([art.widthMm, art.heightMm]).toEqual([Math.round(old.widthMm * scale), Math.round(old.heightMm * scale)])
      expect(art.presentation.rootAnchorMm).toEqual({ x: Math.round(old.presentation.rootAnchorMm.x * scale), y: Math.round(old.presentation.rootAnchorMm.y * scale) })
      expect(art.presentation.groundShadowMm).toEqual([0, 2, 4, 6].map(index => old.presentation.groundShadowMm![index]).map(point => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) })))
      expect(art.presentation).toMatchObject({ mode: 'nearSide', orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world' })
      expect(art.footprintMm).toEqual(tree ? { width: 520, height: 520 } : { width: 800, height: 600 })
      const definition = document.propDefinitions[terrainDressingDefinitionId(art.key)]
      expect(definition.catalogId).toContain('sceneweave.terrain-dressing.')
      expect(DRESSING_PRESENTATIONS[definition.id]).toEqual(art.presentation)
      expect(definition.defaultAppearance).toEqual({ kind: 'image', assetId: terrainDressingAssetId(art.key), tint: null, opacity: 1 })
      expect(definition.origin.attribution).toContain('固定尺寸配方')
      expect(definition.origin.attribution).toContain('四点斜向地影')
      expect(definition.id).not.toBe(`near-side-prop-${old.key}`)
    }
    expect(canonicalJson(NEAR_SIDE_ART)).toBe(before)
    expect(NEAR_SIDE_LICENSE).toContain('MIT License')
  })

  it('stores four actual simple shadow vertices enclosing the root while keeping all old eight-point sources intact', () => {
    for (const [index, art] of TERRAIN_DRESSING_ART.entries()) {
      const old = NEAR_SIDE_ART[index], scale = old.renderLayer === 'canopy' ? .72 : .8
      const selected = [0, 2, 4, 6].map(index => old.presentation.groundShadowMm![index]).map(point => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) }))
      // First prove the proposed saved representation itself, independently of
      // the provider's implementation and complete-project root validation.
      expect(() => assertSimpleVisualPolyline(selected, true)).not.toThrow()
      expect(pointInPolygon({ x: 0, y: 0 }, selected, false)).toBe(true)
      expect(old.presentation.groundShadowMm).toHaveLength(8)
      expect(art.presentation.groundShadowMm).toHaveLength(4)
      expect(() => assertSimpleVisualPolyline(art.presentation.groundShadowMm!, true)).not.toThrow()
      expect(pointInPolygon({ x: 0, y: 0 }, art.presentation.groundShadowMm!, false)).toBe(true)
    }
  })

  it('creates a genuinely empty metadata document with exactly six new fixed definitions and no old palette', () => {
    const document = createTerrainDressingCatalogDocument({ sceneId: 'independent-metadata', now: '2026-10-29T01:00:00.000Z' })
    expect(document.sceneId).toBe('independent-metadata')
    expect(Object.keys(document.assets)).toHaveLength(6); expect(Object.keys(document.propDefinitions)).toHaveLength(6)
    for (const collection of ['props', 'rooms', 'walls', 'openings', 'vertices', 'notes', 'regions', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups', 'prefabInstances', 'prefabDefinitions', 'materials', 'styleThemes', 'entityLayers'] as const) expect(document[collection]).toEqual({})
    expect(document.activeStyleThemeRef).toBeNull()
    expect(Object.keys(document.assets).every(id => id.startsWith('terrain-dressing-art-'))).toBe(true)
    Object.values(document.propDefinitions)[0].name = 'caller mutation'
    expect(Object.values(createTerrainDressingCatalogDocument().propDefinitions)[0].name).not.toBe('caller mutation')
  })

  it('keeps complete3 fixed presentations, real byte/source closure and exact MIT text through directory preparation, adoption and cold import', async () => {
    const provider = await createTerrainDressingCatalogProject(), bundle = toBundle(provider), items = listCatalogItems(bundle)
    expect(provider.schemaVersion).toBe(3); expect(provider.appearance.version).toBe(2)
    expect(provider.document.props).toEqual({}); expect(Object.keys(provider.assets)).toHaveLength(6)
    expect(Object.values(provider.licenses).map(license => license.text)).toEqual([NEAR_SIDE_LICENSE])
    expect(items).toHaveLength(6)
    expect(Object.keys(provider.appearance.sources)).toHaveLength(6)
    const entries = []
    for (const item of items) {
      expect(JSON.parse(item.identity.key)[0]).toBe(3)
      const entry = await prepareLibraryEntry(bundle, item.selector, validation), capsule = await loadLibraryCapsule(entry, validation)
      entries.push(entry)
      expect(capsule.project.schemaVersion).toBe(3)
      expect(Object.keys(capsule.project.document.propDefinitions)).toEqual([item.selector.definitionId])
      expect(Object.keys(capsule.project.document.assets)).toHaveLength(1)
      const definition = capsule.project.document.propDefinitions[item.selector.definitionId], presentation = definitionPresentation(capsule.project.appearance, { id: definition.id, version: definition.version })!
      const source = Object.values(capsule.project.appearance.sources)[0]
      if (source.kind !== 'prop') throw new Error('expected prop source')
      expect(source.id).toBe(presentationSourceId(source.snapshot, null, presentation))
      expect(presentation.mode).toBe('nearSide')
      const assetId = item.thumbnailAssetIds[0], svg = capsule.project.authoringSources[assetId], art = TERRAIN_DRESSING_ART.find(art => terrainDressingDefinitionId(art.key) === definition.id)!
      expect(decodeUtf8(await capsule.resources.read(svg.sourceSha256))).toBe(art.sourceSvg)
      expect(sha256Bytes(await capsule.resources.read(svg.rasterSha256))).toBe(svg.rasterSha256)
    }
    const target = cloneJson(bundle.project)
    target.document.assets = {}; target.document.propDefinitions = {}; target.appearance.sources = {}; target.appearance.presentations = {}
    target.assets = {}; target.licenses = {}; target.licenseBindings = []; target.authoringSources = {}
    const adopted = await adoptLibraryEntries({ project: target, resources: createMemoryResources(new Map()) }, entries, validation)
    expect(target.document.propDefinitions).toEqual({})
    expect(adopted.operationCost).toBeLessThanOrEqual(256)
    const reopened = await importProject(await exportProject(adopted.bundle, validation), validation)
    const byIdentity = (a: typeof items[number], b: typeof items[number]) => a.identity.key.localeCompare(b.identity.key)
    expect(listCatalogItems(reopened).sort(byIdentity)).toEqual([...items].sort(byIdentity))
    expect(reopened.project.appearance.presentations).toEqual(provider.appearance.presentations)
    expect(reopened.project.authoringSources).toEqual(provider.authoringSources)
    expect(reopened.project.document.props).toEqual({})
  }, 30_000)

  it('honors cancellation before any rasterization or partial provider publication', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(createTerrainDressingCatalogProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
