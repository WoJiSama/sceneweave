import { describe, expect, it, vi } from 'vitest'
import { SHORE_ART, SHORE_LICENSE, SHORE_LICENSE_REF, SHORE_MATERIAL_IDS, shoreAssetId } from '../../../shared/visual/shore-art.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { REFINED_COAST_LICENSE } from '../../../shared/visual/coast-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { createRefinedBlankDocument } from './refined-blank.js'
import { createShoreBlankDocument, createShoreBlankProject } from './shore-blank.js'
import { materializeVisualArt, materializeVisualArtBatches } from './visual-art-project.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { terrainVariantAssetId, terrainVariantDefinitionId } from '../../../shared/visual/terrain-variant-specs.js'

// These mocks only exercise source/metadata propagation and exact licence
// ownership. PNG raster, decoding and pixels are verified in the real browser.
vi.mock('../ai/svg-raster.js', () => ({ rasterizeNormalizedSvg: vi.fn(async (source: { sourceSha256: string }) => {
  const bytes = encodeUtf8(`metadata-only raster fixture ${source.sourceSha256}`)
  return { pngBytes: bytes, sha256: sha256Bytes(bytes), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
    processorId: 'sceneweave-static-svg', processorVersion: 1 }
}) }))
vi.mock('../../../application/workspace/project.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../application/workspace/project.js')>(),
  fromBundle: vi.fn(async (bundle: { project: object; resources: object }) => ({ ...bundle.project, resources: bundle.resources })),
}))

const options = { title: '新岸崖素材空白', sceneId: 'shore-blank-fixture', now: '2026-10-30T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' as const }
const licensePath = (text: string) => `licenses/${sha256Bytes(encodeUtf8(text))}.txt`

describe('independent shore surface palette', () => {
  it('retains seven distinct supported opaque periodic SVG sources and exact material roles', () => {
    expect(SHORE_ART).toHaveLength(7)
    expect(new Set(SHORE_ART.map(art => art.sourceSvg)).size).toBe(7)
    expect(new Set(SHORE_ART.map(art => shoreAssetId(art.key))).size).toBe(7)
    expect(Object.values(SHORE_MATERIAL_IDS)).toHaveLength(7)
    for (const art of SHORE_ART) {
      const normalized = normalizeStaticSvg(art.sourceSvg)
      expect(normalized.viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
      expect(normalized.pathCount).toBeLessThanOrEqual(256)
      expect(art.sourceSvg).toMatch(/<rect x="0" y="0" width="512" height="512" fill="#[0-9A-Fa-f]{6}"\/>/)
      expect(art.tags).toContain(art.key.includes('water') ? 'water' : art.key.includes('rock') ? 'rock' : art.key.includes('sand') ? 'sand' : 'grass')
    }
    expect(SHORE_LICENSE).toContain('No reference-map pixels')
    expect(SHORE_LICENSE).toContain('Permission is hereby granted, free of charge')
  })

  it.each(['island', 'coast'] as const)('appends new %s materials while preserving every old fixed definition, theme and empty entity set', palette => {
    const old = createRefinedBlankDocument(palette, options), next = createShoreBlankDocument(palette, options)
    for (const key of ['assets', 'materials'] as const) for (const [id, row] of Object.entries(old[key])) expect(next[key][id]).toEqual(row)
    for (const key of ['propDefinitions', 'prefabDefinitions', 'styleThemes', 'activeStyleThemeRef', 'terrainAreas', 'props', 'terrainEdges', 'terrainConnections', 'paths', 'entityLayers'] as const) expect(next[key]).toEqual(old[key])
    expect(Object.keys(next.assets)).toHaveLength(Object.keys(old.assets).length + 7)
    expect(Object.keys(next.materials)).toHaveLength(Object.keys(old.materials).length + 7)
    for (const id of Object.values(SHORE_MATERIAL_IDS)) expect(next.materials[id]).toMatchObject({ id, version: 1, origin: { kind: 'original', canEmbed: true } })
    next.materials[SHORE_MATERIAL_IDS.rockDry].name = 'separate copy'
    expect(createShoreBlankDocument(palette, options).materials[SHORE_MATERIAL_IDS.rockDry].name).not.toBe('separate copy')
    expect(createRefinedBlankDocument(palette, options)).toEqual(old)
  })

  it.each(['island', 'coast'] as const)('keeps the exact old and new %s source licences distinct in metadata assembly', async palette => {
    const old = createRefinedBlankDocument(palette, options), project = await createShoreBlankProject(palette, options)
    const oldPath = licensePath(palette === 'island' ? REFINED_ISLAND_LICENSE : REFINED_COAST_LICENSE), newPath = licensePath(SHORE_LICENSE)
    expect(Object.values(project.licenses).map(row => row.text)).toEqual([palette === 'island' ? REFINED_ISLAND_LICENSE : REFINED_COAST_LICENSE, SHORE_LICENSE])
    for (const binding of project.licenseBindings) {
      const isNew = binding.subjectId.startsWith('shore-v1-')
      expect(binding.licensePath).toBe(isNew ? newPath : oldPath)
      expect(binding.licenseRef).toBe(isNew ? SHORE_LICENSE_REF : 'MIT')
    }
    for (const [id, asset] of Object.entries(project.document.assets)) {
      expect(project.authoringSources[id].kind).toBe('svg')
      const source = project.authoringSources[id]
      if (source.kind !== 'svg') throw new Error('fixture')
      expect(source.rasterSha256).toBe(asset.sha256)
      expect(await project.resources.read(source.sourceSha256)).toBeInstanceOf(Uint8Array)
      expect(await project.resources.read(asset.sha256)).toBeInstanceOf(Uint8Array)
    }
    expect(Object.keys(project.document.assets)).toHaveLength(Object.keys(old.assets).length + 7)
    // Exercise the actual strict metadata validator: one licence reference
    // cannot represent two different exact licence texts in a complete project.
    // The raster mock above is not a substitute for this validation boundary.
    const { resources: _resources, ...metadata } = project
    expect(validateProjectData(metadata).licenses).toEqual(project.licenses)
  })

  it('includes the three automatic surface-rule variants and image resources when requested', async () => {
    const project = await createShoreBlankProject('island', options, undefined, true)
    for (const key of ['tree-wind-oak', 'shrub-heath-mound', 'grass-sedge-fan']) {
      const definitionId = terrainVariantDefinitionId(key), assetId = terrainVariantAssetId(key)
      expect(project.document.propDefinitions[definitionId]).toMatchObject({
        id: definitionId,
        defaultAppearance: { kind: 'image', assetId },
      })
      const asset = project.document.assets[assetId]
      expect(asset).toMatchObject({ id: assetId, mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512 })
      expect(await project.resources.read(asset.sha256)).toBeInstanceOf(Uint8Array)
    }
  })

  it('retains the old one-batch licence mapping and rejects duplicate fixed batch identities', async () => {
    const scene = createRefinedBlankDocument('island', options)
    const project = await materializeVisualArt(scene, REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE, key => `refined-art-${key}`)
    expect(Object.keys(project.licenses)).toHaveLength(1)
    expect(project.licenseBindings.every(binding => binding.licensePath === licensePath(REFINED_ISLAND_LICENSE))).toBe(true)
    const batch = { artwork: REFINED_ISLAND_ART, licenseText: REFINED_ISLAND_LICENSE, assetId: (key: string) => `refined-art-${key}` }
    await expect(materializeVisualArtBatches(createRefinedBlankDocument('island', options), [batch, batch])).rejects.toThrow('固定身份重复')
  })

  it('rejects unsupported palette and cancellation before any raster work', async () => {
    expect(() => createShoreBlankDocument('interior' as 'island', options)).toThrow('仅支持岩岛或海岸')
    const controller = new AbortController(); controller.abort()
    await expect(createShoreBlankProject('island', options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
