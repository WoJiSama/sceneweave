import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateSceneV3 } from '../../core/v3/schema'
import { createCompositionContentV6, syncAppearanceGraphV6 } from '../../core/v6/graph'
import { inspectImageBytes } from '../../io/v6/resources'
import { createOutdoorBlankDocument, createOutdoorBlankProject } from './blank-project'
import { appendThemedCatalogDocument, extendBuiltinCatalogProject, THEMED_CATALOG, THEMED_CATALOG_ENTRIES } from './themed-catalog'

const options = { title: '目录检查', widthMm: 20_000, heightMm: 20_000, preset: 'investigation' as const, sceneId: 'themed-catalog-test', now: '2026-10-23T00:00:00.000Z' }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('append-only thematic and refined fixed catalogs', () => {
  it('adds semantic fixed IDs while preserving all37 previous entries and the original blank preload', () => {
    const scene = createOutdoorBlankDocument(options), before = structuredClone(scene)
    appendThemedCatalogDocument(scene)
    expect(validateSceneV3(scene).ok).toBe(true)
    expect(Object.keys(scene.assets)).toHaveLength(34 + THEMED_CATALOG_ENTRIES.length)
    for (const collection of ['assets', 'propDefinitions', 'materials', 'prefabDefinitions', 'styleThemes'] as const) {
      for (const [id, value] of Object.entries(before[collection])) expect(scene[collection][id]).toEqual(value)
    }
    expect(scene.styleThemes).toEqual(before.styleThemes)
    expect(scene.props).toEqual({}); expect(scene.rooms).toEqual({}); expect(scene.revision).toBe(0)
    expect(Object.keys(createOutdoorBlankDocument(options).assets)).toHaveLength(34)
    const repeated = structuredClone(scene); appendThemedCatalogDocument(scene); expect(scene).toEqual(repeated)
    scene.propDefinitions[THEMED_CATALOG.props.headstone].name = '同身份不同内容'
    expect(() => appendThemedCatalogDocument(scene)).toThrow('固定身份冲突')
  })
  it('keeps all six refined sources, dimensions, footprints and physical rules distinct from the originals', () => {
    const scene = createOutdoorBlankDocument(options)
    appendThemedCatalogDocument(scene)
    const refined = THEMED_CATALOG_ENTRIES.filter(entry => entry.refines)
    expect(refined).toHaveLength(6)
    for (const entry of refined) {
      const collection = entry.kind === 'prop' ? scene.propDefinitions : scene.materials
      const old = Object.values(collection).find(value => value.catalogId === entry.refines!.catalogId && value.version === entry.refines!.version)!
      expect(old).toBeDefined()
      const assetId = entry.kind === 'prop' ? scene.propDefinitions[old.id].defaultAppearance : null
      const oldAsset = scene.assets[assetId?.kind === 'image' ? assetId.assetId : scene.materials[old.id].textureAssetId]
      expect(oldAsset.sha256).toBe(entry.refines!.assetSha256)
      expect(entry.sha256).not.toBe(oldAsset.sha256)
      expect(entry.logicalSizeMm).toEqual(oldAsset.logicalSizeMm)
      expect([entry.pixelWidth, entry.pixelHeight]).toEqual([oldAsset.pixelWidth, oldAsset.pixelHeight])
      if (entry.kind === 'prop') {
        const previous = scene.propDefinitions[old.id], next = scene.propDefinitions[THEMED_CATALOG.props[entry.key]]
        for (const field of ['defaultVisualBoundsMm', 'defaultFootprintMm', 'defaultFootprintOffsetMm', 'defaultBlocksMovement', 'defaultBlocksSight', 'defaultRenderLayer', 'defaultShadowClass'] as const) expect(next[field]).toEqual(previous[field])
      } else {
        const previous = scene.materials[old.id], next = scene.materials[THEMED_CATALOG.materials[entry.key]]
        expect(next.defaultTileSizeMm).toEqual(previous.defaultTileSizeMm)
        expect(next.applicableSurfaces).toEqual(previous.applicableSurfaces)
      }
    }
  })
  it('adds public fixed prefab source templates without rewriting any old source or private template', () => {
    const content = createCompositionContentV6(createOutdoorBlankDocument(options))
    content.appearance.prefabAppearanceTemplates['b2-pf-01'].visibility = 'gm'
    const before = structuredClone(content)
    appendThemedCatalogDocument(content.document)
    const next = syncAppearanceGraphV6(content)
    for (const [id, source] of Object.entries(before.appearance.sources)) expect(next.appearance.sources[id]).toEqual(source)
    for (const [id, template] of Object.entries(before.appearance.prefabAppearanceTemplates)) expect(next.appearance.prefabAppearanceTemplates[id]).toEqual(template)
    expect(next.historyIdentity).toEqual(before.historyIdentity)
    for (const id of Object.values(THEMED_CATALOG.prefabs)) {
      const definition = next.document.prefabDefinitions[id], template = next.appearance.prefabAppearanceTemplates[id]
      expect(template.visibility).toBe('public')
      expect(Object.keys(template.members)).toEqual(definition.members.map(member => member.key))
      for (const member of definition.members) expect(next.appearance.sources[template.members[member.key].sourceId]).toMatchObject({ kind: 'prop', snapshot: { definitionRef: member.propTemplate.definitionRef, appearance: member.propTemplate.appearance } })
    }
  })
  it('checks real byte closures and license bindings; failed or cancelled fetches preserve the input provider', async () => {
    // Header/dimension decode double only; the index generator separately uses native Chrome decoding of these exact PNGs.
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => { const header = inspectImageBytes(new Uint8Array(await blob.arrayBuffer())); return { width: header.width, height: header.height, close: vi.fn() } }))
    const fetchFile = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), 'http://localhost').pathname
      const bytes = await readFile(new URL(`../../../public${path}`, import.meta.url))
      return new Response(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    })
    vi.stubGlobal('fetch', fetchFile)
    const input = await createOutdoorBlankProject(options), before = structuredClone(input), complete = await extendBuiltinCatalogProject(input)
    expect(input).toEqual(before)
    expect(Object.keys(complete.assets)).toHaveLength(34 + THEMED_CATALOG_ENTRIES.length)
    for (const entry of THEMED_CATALOG_ENTRIES) expect(complete.licenseBindings).toContainEqual(expect.objectContaining({ subjectKind: 'asset', subjectId: THEMED_CATALOG.assets[entry.key], licenseRef: 'MIT', embedding: 'allowed' }))
    expect(complete.historyIdentity).toEqual(input.historyIdentity)
    fetchFile.mockImplementation(async () => new Response('missing', { status: 404 }))
    await expect(extendBuiltinCatalogProject(input)).rejects.toThrow('读取失败')
    await expect(extendBuiltinCatalogProject(input, AbortSignal.abort())).rejects.toThrow()
    expect(input).toEqual(before)
  })
})
