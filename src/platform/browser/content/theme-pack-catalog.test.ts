import { describe, expect, it, vi } from 'vitest'
import { THEME_PACK_ART, THEME_PACK_LICENSE } from '../../../shared/visual/theme-pack-art.js'
import { THEME_PACK_PLANS, selectThemePacks } from '../../../shared/assets/theme-packs.js'
import { assessThemePackPublication } from '../../../shared/assets/review.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { normalizeStaticSvg, verifyNormalizedStaticSvg } from '../../../shared/ai/svg.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { listCatalogItems, prepareLibraryEntry, loadLibraryCapsule } from '../../../shared/library/content.js'
import { toBundle } from '../../../application/workspace/project.js'
import { THEME_PACK_CATALOGS, createThemePackCatalogDocument, createThemePackSampleDocument,
  createThemePackCatalogProject, createThemePackSampleProject, loadThemePack, themePackAssetId, themePackDefinitionId } from './theme-pack-catalog.js'

const pixels = vi.hoisted(() => ({
  rasters: 0,
  raster(hash: string, width: number, height: number) {
    const color = [0, 2, 4].map(index => parseInt(hash.slice(index, index + 2), 16)), rgba = new Uint8ClampedArray(width * height * 4)
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([...color, 255], offset)
    return { width, height, rgba }
  },
}))
// Explicit unit raster ports verify real PNG/hash/source closure, using signature
// pixels. These tests do not establish browser rendering, art quality or P3.
vi.mock('../runtime.js', async () => {
  const { artworkValidation } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `theme-provider-test-${++sequence}` }, clock: { now: () => '2026-11-09T00:00:00.000Z' } },
    validation: { ...artworkValidation(), svg: {
      async rasterize(input: Parameters<typeof verifyNormalizedStaticSvg>[0], dimensions: { width: number; height: number }) {
        return pixels.raster(verifyNormalizedStaticSvg(input).normalizedSha256, dimensions.width, dimensions.height)
      } } } }
})
vi.mock('../ai/svg-raster.js', async () => {
  const { encodeFixtureRaster } = await import('../../../../tests/helpers/m24-artwork-fixtures.js')
  const { verifyNormalizedStaticSvg } = await import('../../../shared/ai/svg.js')
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  return { async rasterizeNormalizedSvg(input: Parameters<typeof verifyNormalizedStaticSvg>[0], options: { longEdgePx: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted(); pixels.rasters++
    const normalized = verifyNormalizedStaticSvg(input), pngBytes = encodeFixtureRaster(pixels.raster(normalized.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: normalized.normalizedSha256, processorId: normalized.processorId, processorVersion: normalized.processorVersion }
  } }
})
import { validation } from '../runtime.js'

describe('independent candidate theme pack providers', () => {
  it('keeps six independent exact-name catalogs with real source members, three editable compositions and separate themes', () => {
    const allAssets = new Set<string>(), allDefinitions = new Set<string>(), before = canonicalJson(THEME_PACK_ART)
    expect(THEME_PACK_CATALOGS).toHaveLength(6)
    expect(Object.isFrozen(THEME_PACK_CATALOGS[0].axes)).toBe(true)
    expect(selectThemePacks(THEME_PACK_CATALOGS, { style: ['natural-watercolor'] }).map(value => value.id)).toEqual(['wilderness'])
    for (const pack of THEME_PACK_CATALOGS) {
      const document = createThemePackCatalogDocument(pack.id)
      expect(pack.availability).toBe('candidate')
      expect(pack.scenarios).toHaveLength(2)
      expect(Object.keys(document.materials)).toHaveLength(pack.counts.materials)
      expect(Object.keys(document.propDefinitions)).toHaveLength(pack.counts.props)
      expect(Object.keys(document.prefabDefinitions)).toHaveLength(pack.counts.prefabs)
      expect(Object.keys(document.styleThemes)).toHaveLength(1)
      expect(document.props).toEqual({}); expect(document.terrainAreas).toEqual({}); expect(document.rooms).toEqual({})
      for (const art of THEME_PACK_ART[pack.id]) {
        expect(() => normalizeStaticSvg(art.sourceSvg)).not.toThrow()
        const assetId = themePackAssetId(pack.id, art.key), definitionId = themePackDefinitionId(pack.id, art.kind, art.key)
        expect(allAssets.has(assetId)).toBe(false); allAssets.add(assetId)
        expect(allDefinitions.has(definitionId)).toBe(false); allDefinitions.add(definitionId)
        const definition = art.kind === 'material' ? document.materials[definitionId] : document.propDefinitions[definitionId]
        expect(definition.name).toBe(art.name)
        expect(definition.origin.attribution).toContain('未取得美术或用户P3签收')
      }
      for (const definition of Object.values(document.prefabDefinitions)) {
        expect(definition.members.length).toBeGreaterThan(1)
        expect(definition.members.every(member => member.propTemplate.definitionRef && document.propDefinitions[member.propTemplate.definitionRef.id])).toBe(true)
      }
      Object.values(document.propDefinitions)[0].name = 'caller edit'
      expect(Object.values(createThemePackCatalogDocument(pack.id).propDefinitions)[0].name).not.toBe('caller edit')
    }
    expect(allAssets.size).toBe(120)
    expect(canonicalJson(THEME_PACK_ART)).toBe(before)
  })

  it('stores twelve distinct editable layouts with valid declared supports, real rooms/terrain and independently editable prefab members', () => {
    for (const pack of THEME_PACK_CATALOGS) {
      const variants = [0, 1].map(variant => createThemePackSampleDocument(pack.id, variant as 0 | 1))
      expect(canonicalJson(variants[0].props)).not.toBe(canonicalJson(variants[1].props))
      for (const [variant, document] of variants.entries()) {
        const checked = validateSceneDocument(document)
        expect(checked.ok ? [] : checked.errors).toEqual([])
        expect(document.title).toContain(pack.scenarios[variant].name)
        expect(Object.keys(document.props).length).toBeGreaterThan(0)
        expect(Object.keys(document.prefabInstances).length).toBeGreaterThan(0)
        expect(Object.keys(document.terrainAreas).length).toBeGreaterThan(0)
        expect(Object.keys(document.paths).length).toBeGreaterThan(0)
        expect(document.schemaVersion).toBe(1)
        expect(document.generationMetadata).toBeUndefined()
        for (const group of Object.values(document.prefabInstances)) for (const member of Object.values(group.members)) {
          expect(member.propId && document.props[member.propId]).toBeTruthy()
          expect(document.entityLayers[member.propId!]).toBe(document.entityLayers[group.id])
        }
        if (pack.id === 'wilderness') expect(document.rooms).toEqual({})
      }
    }
  })

  it('binds exact algorithm2 entries and complete review descriptors to verified SVG/PNG/license closures without creating acceptance', async () => {
    const loaded = await loadThemePack('investigation'), { project, items } = loaded
    expect(pixels.rasters).toBeGreaterThanOrEqual(20)
    expect(items).toHaveLength(23)
    expect(items.every(item => JSON.parse(item.identity.key)[0] === 2)).toBe(true)
    expect(loaded.registration.catalogKeys).toEqual(items.map(item => item.identity.key))
    expect(loaded.registration.availability).toBe('candidate')
    expect(loaded.coverage).toMatchObject({ materials: 6, props: 14, prefabs: 3, scenarios: 2, status: 'candidate' })
    expect(loaded.coverage.unverifiedRequirementIds).toEqual(THEME_PACK_PLANS[0].requirements.map(value => value.id))
    expect(loaded.registration.coverage?.requiredRequirementIds).toEqual(loaded.coverage.unverifiedRequirementIds)
    expect(loaded.registration.coverage?.scenarios.map(value => value.summary.props)).toEqual([0, 1].map(variant => Object.keys(createThemePackSampleDocument('investigation', variant as 0 | 1).props).length))
    expect(assessThemePackPublication(loaded.registration, loaded.reviewContent, []).reviewReady).toBe(false)
    expect(loaded.wholePackReviewContent.members).toEqual(loaded.reviewContent.slice().sort((a, b) => a.catalogKey < b.catalogKey ? -1 : a.catalogKey > b.catalogKey ? 1 : 0))
    expect(Object.values(project.licenses).map(value => value.text)).toEqual([THEME_PACK_LICENSE])
    for (const art of THEME_PACK_ART.investigation) {
      const id = themePackAssetId('investigation', art.key), source = project.authoringSources[id]
      expect(decodeUtf8(await project.resources.read(source.sourceSha256))).toBe(art.sourceSvg)
      expect(sha256Bytes(await project.resources.read(source.rasterSha256))).toBe(project.document.assets[id].sha256)
    }
    const prefab = items.find(item => item.selector.kind === 'prefab')!
    const entry = await prepareLibraryEntry(toBundle(project), prefab.selector, validation), capsule = await loadLibraryCapsule(entry, validation)
    const descriptor = loaded.reviewContent.find(value => value.catalogKey === prefab.identity.key)!
    expect(descriptor.resourceHashes).toEqual(projectResourceHashes(capsule.project).sort())
    expect(descriptor.dependencyKeys).toEqual(listCatalogItems(capsule).filter(value => value.selector.kind === 'prop').map(value => value.identity.key).sort())
    expect(capsule.project.document.props).toEqual({})
    expect(capsule.project.document.prefabDefinitions[prefab.selector.definitionId].name).toBe(prefab.name)
  }, 30_000)

  it('cold reopens a real editable sample with saved members, resources, identities, names and license text', async () => {
    const project = await createThemePackSampleProject('wilderness', 0), bundle = toBundle(project)
    const reopened = await importProject(await exportProject(bundle, validation), validation)
    expect(reopened.project).toEqual(bundle.project)
    expect(Object.keys(reopened.project.document.prefabInstances)).toHaveLength(2)
    expect(Object.values(reopened.project.document.props).some(prop => prop.definitionRef?.id === themePackDefinitionId('wilderness', 'prop', 'canvas-tent'))).toBe(true)
    for (const hash of projectResourceHashes(bundle.project)) expect(await reopened.resources.read(hash)).toEqual(await bundle.resources.read(hash))
    expect(Object.values(reopened.project.licenses).map(value => value.text)).toEqual([THEME_PACK_LICENSE])
  }, 30_000)

  it('rejects unknown packs/variants and cancels before rasterization or partial provider publication', async () => {
    expect(() => createThemePackCatalogDocument('unknown' as 'modern')).toThrow('未知主题包')
    expect(() => createThemePackSampleDocument('modern', 2 as 0)).toThrow('两个明确样板')
    const controller = new AbortController(); controller.abort()
    const before = pixels.rasters
    await expect(createThemePackCatalogProject('modern', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(createThemePackSampleProject('modern', 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(loadThemePack('modern', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(pixels.rasters).toBe(before)
  })
})
