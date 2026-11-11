import { describe, expect, it, vi } from 'vitest'
import { THEME_PACK_ART, THEME_PACK_ART_V1, THEME_PACK_LICENSE } from '../../../shared/visual/theme-pack-art.js'
import { THEME_PACK_PLANS, selectThemePacks } from '../../../shared/assets/theme-packs.js'
import { assessThemePackPublication } from '../../../shared/assets/review.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { normalizeStaticSvg, verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { pathPolygon, propFootprint, polygonsOverlap, openingEndpoints, corridor } from '../../../shared/geometry/geometry.js'
import { checkTerrainRoute } from '../../../shared/geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
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
  const { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } = await import('../../../shared/ai/svg.js')
  let sequence = 0
  return { runtime: { ids: { nextId: () => `theme-provider-test-${++sequence}` }, clock: { now: () => '2026-11-09T00:00:00.000Z' } },
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
    const normalized = verifyNormalizedStaticSvg(input), pngBytes = encodeFixtureRaster(pixels.raster(normalized.normalizedSha256, options.longEdgePx, options.longEdgePx))
    return { mimeType: 'image/png', pngBytes, sha256: sha256Bytes(pngBytes), pixelWidth: options.longEdgePx, pixelHeight: options.longEdgePx,
      normalizedSha256: normalized.normalizedSha256, ...CANONICAL_SVG_PROCESSOR }
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
    expect(allAssets.size).toBe(128)
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
        if (pack.id === 'wilderness') expect(Object.keys(document.rooms)).toHaveLength(variant === 0 ? 2 : 0)
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
    expect(Object.keys(reopened.project.document.prefabInstances)).toHaveLength(3)
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

const unchangedThemeHashes = {
  "investigation": [
    "dc121afaa28c4900c2e4f6f60cd94797b20eec4bd5b21d8e5dc58c7500cdf305",
    "e83dd40a38b4149a40eef62bb2e2410709c01469e22b3284987a206c47fea4f8",
    "a49366cce4f4d9b9eb222efb8428801321b71a1b6eba61881518c45d265b8973"
  ],
  "modern": [
    "9e73553488868b540cfe84bf948f3cb830a25429905deca25ad99393a805ab36",
    "e077b664fbbfd6c43109dd1cdc745f56780cd872c8209b0166c2b86ccb2b69af",
    "305343fe4d0ae16bac302544b5f193573812423d809367e7b088c50d1a8ec443"
  ],
  "fantasy": [
    "be98bd773e56f9adc5bf9a5ca3d80db3f798613d0dcd3642f1cd583d6cc38d7a",
    "de7bc7b10039a2cf9202d1f03dc8fccb6e4eb2aafa98d44e57089a498e6619e9",
    "672eab41ab5aa4251b6b18b29d94a234f86374942f1a333c4e905b92ec623eb1"
  ],
  "ruins": [
    "3783b3a3493507dc4003fd2a5afbf3ae569a3fe762e5ee9a120628dc9eac2961",
    "70487281613599986fd84a8b4cff67c0cdf54aa0c384fa488bdcb2205adcb8bb",
    "0bc142181f1d0890e2ae21c6cfcc2c8e04caac82e59bede22988a8b541674477"
  ],
  "coast": [
    "eb86bc67ffc340426e99536ca88284c0c5d05c5c1903a73fee8de00ebf656c78",
    "85692c619bc102e44ffb934ff15131ebf70756c062603525242464c81deb44b0",
    "6c916d4ad99ed7d44d5acf81baabad38335339a2b1f5266022d7b0ff6155991e"
  ]
} as const
it('preserves the exact five other catalogs and layouts while retaining all v1 art sources', () => {
  for (const id of Object.keys(unchangedThemeHashes) as (keyof typeof unchangedThemeHashes)[]) {
    const values = [createThemePackCatalogDocument(id), createThemePackSampleDocument(id, 0), createThemePackSampleDocument(id, 1)]
    expect(values.map(value => sha256Bytes(new TextEncoder().encode(canonicalJson(value))))).toEqual(unchangedThemeHashes[id])
    expect(THEME_PACK_ART[id]).toEqual(THEME_PACK_ART_V1[id])
    expect(THEME_PACK_CATALOGS.find(pack => pack.id === id)?.fixedVersion).toBe(1)
  }
  expect(THEME_PACK_ART_V1.wilderness).toHaveLength(20)
  expect(THEME_PACK_ART.wilderness).toHaveLength(28)
})

it('binds the revised wilderness to v2 definitions and provides real watch rooms, abandoned camp and mountain access', () => {
  const catalog = createThemePackCatalogDocument('wilderness')
  expect(THEME_PACK_CATALOGS.find(pack => pack.id === 'wilderness')).toMatchObject({ fixedVersion: 2, counts: { materials: 7, props: 21, prefabs: 5 } })
  for (const collection of ['materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) for (const definition of Object.values(catalog[collection])) {
    expect(definition.id).toMatch(/-v2$/); expect(definition.version).toBe(2)
  }
  for (const definition of Object.values(catalog.prefabDefinitions)) for (const member of definition.members) {
    expect(member.propTemplate.definitionRef?.version).toBe(2)
    expect(catalog.propDefinitions[member.propTemplate.definitionRef!.id]).toBeTruthy()
  }
  const watch = createThemePackSampleDocument('wilderness', 0)
  expect(watch.constraints.entranceOpeningIds).toEqual(['watch-entrance'])
  expect(Object.keys(watch.rooms)).toHaveLength(2)
  expect(Object.values(watch.props).filter(prop => prop.renderLayer === 'canopy').length).toBeGreaterThan(10)
  const originalOverlays = watch.terrainAreas['sample-ground'].surfaceStyle!.overlays.filter(overlay => !overlay.id.startsWith('outpost-transition-'))
  expect(originalOverlays).toHaveLength(4)
  for (const overlay of originalOverlays) {
    expect(overlay.paint.opacity).toBe(1); expect(overlay.blendWidthMm).toBe(450)
    expect(overlay.boundaryMm.length).toBeGreaterThanOrEqual(14)
  }
  for (const key of ['sample-camp', 'sample-abandoned-camp']) expect(watch.terrainAreas[key].boundaryMm).toHaveLength(20)

  expect(watch.openings['watch-inner-door'].wallId).toBe('watch-partition')
  expect(watch.prefabDefinitions[themePackDefinitionId('wilderness', 'prefab', 'abandoned-camp-group')].members.some(member => member.propTemplate.definitionRef?.id === themePackDefinitionId('wilderness', 'prop', 'torn-tent'))).toBe(true)
  expect(Object.values(watch.prefabInstances).some(instance => instance.definitionRef.id === themePackDefinitionId('wilderness', 'prefab', 'abandoned-camp-group'))).toBe(true)
  const mountain = createThemePackSampleDocument('wilderness', 1)
  expect(mountain.terrainAreas['sample-mountain'].groundElevationMm).toBe(1800)
  expect(Object.values(mountain.terrainEdges).filter(edge => edge.kind === 'cliff').every(edge => edge.blocksMovement)).toBe(true)
  expect(mountain.terrainConnections['sample-mountain-ramp']).toMatchObject({ widthMm: 1800, from: { surfaceRef: { id: 'sample-ground' } }, to: { surfaceRef: { id: 'sample-mountain' } } })
  expect(mountain.terrainAreas['sample-river'].blocksMovement).toBe(true)
  for (const sample of [watch, mountain]) {
    expect(Object.values(sample.paths).every(path => path.centerlineMm.length > 2)).toBe(true)
    expect(Object.values(sample.notes).some(note => note.visibility === 'gm')).toBe(true)
    expect(validateSceneDocument(sample).ok).toBe(true)
  }
})

it('builds a separate outpost layout from its real door with persisted density choices and unchanged fixed sources', () => {
  const catalog = createThemePackCatalogDocument('wilderness'), counts = []
  for (const outpostVegetation of ['sparse', 'balanced', 'dense'] as const) {
    const scene = createThemePackSampleDocument('wilderness', 0, { outpostVegetation })
    expect(scene.sceneId).toBe(`theme-pack-wilderness-outpost-layout-1-${outpostVegetation}`)
    expect(scene.presetSnapshot).toMatchObject({ presetId: 'sceneweave-outpost-layout', presetVersion: 1 })
    expect(scene.materials).toEqual(catalog.materials); expect(scene.propDefinitions).toEqual(catalog.propDefinitions)
    expect(scene.prefabDefinitions).toEqual(catalog.prefabDefinitions); expect(scene.styleThemes).toEqual(catalog.styleThemes)
    const path = scene.paths['theme-sample-path-2'], port = resolveBuildingEntrancePort(scene, 'watch-entrance', path.widthMm)
    expect(path.centerlineMm[0]).toEqual(port.outsideMm)
    expect(path.supportRefs).toContainEqual(port.supportRef)
    expect(checkTerrainRoute(scene, { floorId: port.floorId, pointsMm: [port.insideMm, ...path.centerlineMm], widthMm: path.widthMm }).ok).toBe(true)
    for (const path of Object.values(scene.paths)) {
      const result = checkTerrainRoute(scene, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm })
      expect(result.issues).toEqual([])
    }
    const groups = Object.values(scene.scatterGroups)
    expect(groups).toHaveLength(3)
    expect(groups.every(group => group.algorithmVersion === 'scatter-cell-v2' && Object.keys(group.members).length > 0)).toBe(true)
    counts.push(groups.map(group => Object.keys(group.members).length))
  }
  for (let index = 0; index < 3; index++) {
    expect(counts[0][index]).toBeLessThan(counts[1][index])
    expect(counts[1][index]).toBeLessThan(counts[2][index])
  }
  expect(() => createThemePackSampleDocument('wilderness', 1, { outpostVegetation: 'dense' })).toThrow('仅适用于')
  expect(() => createThemePackSampleDocument('modern', 0, { outpostVegetation: 'dense' })).toThrow('仅适用于')
})

it('keeps the inherited physical semantics and the two explicit wilderness routes clear', () => {
  for (const original of THEME_PACK_ART_V1.wilderness) {
    const current = THEME_PACK_ART.wilderness.find(art => art.key === original.key)!
    for (const field of ['widthMm', 'heightMm', 'footprintMm', 'blocksMovement', 'blocksSight', 'renderLayer', 'shadowClass'] as const) expect(current[field]).toEqual(original[field])
  }
  for (const variant of [0, 1] as const) {
    const scene = createThemePackSampleDocument('wilderness', variant)
    const overlaps = Object.values(scene.paths).flatMap(path => Object.values(scene.props).filter(prop => prop.blocksMovement && polygonsOverlap(pathPolygon(path), propFootprint(prop))).map(prop => ({ variant, path: path.id, pathPoints: path.centerlineMm, prop: prop.id, definition: prop.definitionRef?.id, at: prop.positionMm })))
    expect(overlaps).toEqual([])
    for (const opening of Object.values(scene.openings).filter(opening => opening.kind === 'door')) {
      const [a, b] = openingEndpoints(scene, opening)
      expect(Object.values(scene.props).filter(prop => prop.blocksMovement && polygonsOverlap(corridor(a, b, 2200), propFootprint(prop))).map(prop => prop.id)).toEqual([])
    }
  }
})
