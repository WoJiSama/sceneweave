import { describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { bitmapVariant, createCompositionContent } from '../appearance/graph.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { applyImageEnhancement } from '../image-enhancement/pixels.js'
import { expandImageEnhancementScopeMask, inspectImageEnhancementAssets } from '../image-enhancement/metadata.js'
import type { ImageEnhancementRecipe } from '../image-enhancement/schema.js'
import { tryDecodeDecontaminationSource } from '../image-enhancement/source-pixels.js'
import type { ImageSelectionMask } from '../image-import/selection-mask.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { loadLibraryCapsule, prepareLibraryEntry } from '../library/content.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { AssetRecord, ProjectBundle, ProjectData } from '../model/project.js'
import type { AssetRef, SceneDocument } from '../model/scene.js'
import type { ImageProcessingPort } from '../ports/resources.js'
import { cloneJson } from '../validation/json.js'
import { crc32, sha256Bytes } from './binary.js'
import { bitmapVariantPixelPipeline } from './bitmap-pixels.js'
import { exportProject, importProject } from './file.js'
import { decodeCanonicalPng, encodeCanonicalPng } from './png-rgba.js'
import { transformRgba } from './pixels.js'
import { createMemoryResources, validateProjectBundle } from './resources.js'
import { validateProjectData } from './validate.js'

const recipe: ImageEnhancementRecipe = { version: 1, direction: 'clarity', strength: 'balanced', scale: 1 }
const scopeMask: ImageSelectionMask = { x: 1, y: 1, width: 1, height: 1, runs: [1, 255] }
const pixels: ImagePixels = { width: 3, height: 3, data: Uint8ClampedArray.from([
  120, 80, 40, 255, 10, 20, 40, 128, 110, 80, 40, 255,
  120, 80, 40, 255, 30, 40, 60, 255, 130, 80, 40, 255,
  120, 80, 40, 255, 20, 20, 40, 128, 130, 80, 40, 0,
]) }
const images: ImageProcessingPort = {
  async decode(bytes) { return decodeCanonicalPng(bytes) },
  async encodePng(image) { return encodeCanonicalPng(image) },
  async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
}
function fixture(depth = 1, scope?: ImageSelectionMask, selectedRecipe = recipe, sourcePixels = pixels) {
  const document: SceneDocument = toCurrentSceneDocument({ ...layerSceneV3(), format: 'sceneweave-scene' })
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const bytes = new Map<string, Uint8Array>(), records: ProjectData['assets'] = {}
  const origin = { kind: 'imported' as const, attribution: 'Image enhancement test fixture', canEmbed: true }
  let current = sourcePixels
  const addAsset = (id: string, image: ImagePixels, sourceId?: string) => {
    const png = encodeCanonicalPng({ width: image.width, height: image.height, rgba: image.data }), hash = sha256Bytes(png)
    bytes.set(hash, png); records[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: image.width, pixelHeight: image.height }
    document.assets[id] = { id, sha256: hash, mimeType: 'image/png', pixelWidth: image.width, pixelHeight: image.height,
      logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'enhancement-test-license', origin: cloneJson(origin),
      ...(sourceId ? { imageEnhancement: { version: 1 as const, sourceAssetId: sourceId, originalAssetId: 'source', recipe: selectedRecipe,
        ...(scope ? { scopeMask: scope } : {}) } } : {}) }
  }
  addAsset('source', current)
  let lastId = 'source'
  for (let index = 1; index <= depth; index++) {
    current = applyImageEnhancement(current, selectedRecipe, expandImageEnhancementScopeMask(scope, current.width, current.height))
    const id = `enhanced-${index}`
    addAsset(id, current, lastId); lastId = id
  }
  const prop = document.props.item
  document.propDefinitions.definition = { id: 'definition', catalogId: 'test.enhanced-item', version: 1, licenseRef: 'enhancement-test-license', origin,
    name: '增强物件', tags: [], defaultAppearance: { kind: 'image', assetId: lastId, tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
    defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  prop.definitionRef = { id: 'definition', version: 1 }; prop.appearance = cloneJson(document.propDefinitions.definition.defaultAppearance)
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `enhancement-token-${++sequence}` }, clock: { now: () => '2026-11-11T00:00:00.000Z' } })
  const text = 'Sceneweave enhancement test license', licenseHash = sha256Bytes(new TextEncoder().encode(text))
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: records, authoringSources: {},
    licenses: { [licenseHash]: { sha256: licenseHash, text } },
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })) }
  const bundle: ProjectBundle = { project, resources: createMemoryResources(bytes) }
  return { bundle, bytes, lastId }
}

describe('image enhancement provenance and actual resource closure', () => {
  it('retains source-only ancestors and recipes across full export and independent cold import', async () => {
    const { bundle, lastId } = fixture(2, scopeMask)
    expect(inspectDependencies(bundle.project.document).assetIds).toEqual(['enhanced-1', 'enhanced-2', 'source'])
    expect(inspectDependencies(bundle.project.document).errors).toEqual([])
    const encoded = await exportProject(bundle, { images }), reopened = await importProject(encoded.slice(), { images })
    expect(reopened.project.document.assets).toEqual(bundle.project.document.assets)
    const output = reopened.project.document.assets[lastId]
    expect(decodeCanonicalPng(await reopened.resources.read(output.sha256)).rgba).toEqual(decodeCanonicalPng(await bundle.resources.read(output.sha256)).rgba)
  })

  it('keeps a standalone library item editable without inventing ancestor definitions', async () => {
    const { bundle } = fixture(2)
    const entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'definition' }, { images })
    const reopened = await loadLibraryCapsule(entry, { images })
    expect(Object.keys(reopened.project.document.propDefinitions)).toEqual(['definition'])
    expect(Object.keys(reopened.project.document.assets).sort()).toEqual(['enhanced-1', 'enhanced-2', 'source'])
    expect(reopened.project.licenseBindings.filter(binding => binding.subjectKind === 'asset')).toHaveLength(3)
  })

  it.each(['clarity', 'edge', 'denoise', 'decontaminate'] as const)('cold-replays 2x %s using masks on each immediate source grid', async direction => {
    const { bundle, lastId } = fixture(2, scopeMask, { ...recipe, direction, scale: 2 })
    const encoded = await exportProject(bundle, { images }), reopened = await importProject(encoded.slice(), { images })
    const source = reopened.project.document.assets.source, output = reopened.project.document.assets[lastId]
    expect([output.pixelWidth, output.pixelHeight]).toEqual([12, 12])
    expect(output.logicalSizeMm).toEqual(source.logicalSizeMm)
    expect(reopened.project.document.assets['enhanced-1'].imageEnhancement?.scopeMask).toEqual(scopeMask)
    expect(output.imageEnhancement?.scopeMask).toEqual(scopeMask)
    expect(decodeCanonicalPng(await reopened.resources.read(output.sha256)).rgba).toEqual(decodeCanonicalPng(await bundle.resources.read(output.sha256)).rgba)
  })

  it('cold-replays changed colour-fringe pixels and retains the source and exact permission closure', async () => {
    const data = new Uint8ClampedArray(17 * 17 * 4)
    for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) {
      data.set(x < 4 || x > 12 || y < 4 || y > 12 ? [50, 75, 100, 128] : [40, 40, 40, 255], (y * 17 + x) * 4)
    }
    const input: ImagePixels = { width: 17, height: 17, data }, selectedRecipe = { ...recipe, direction: 'decontaminate' as const }
    const { bundle, lastId } = fixture(1, undefined, selectedRecipe, input)
    const encoded = await exportProject(bundle, { images }), reopened = await importProject(encoded.slice(), { images })
    const output = reopened.project.document.assets[lastId], source = reopened.project.document.assets.source
    const decoded = decodeCanonicalPng(await reopened.resources.read(output.sha256))
    expect(decoded.rgba).not.toEqual(data)
    expect(decoded.rgba).toEqual(applyImageEnhancement(input, selectedRecipe).data)
    for (let at = 3; at < data.length; at += 4) expect(decoded.rgba[at]).toBe(data[at])
    expect(output.imageEnhancement?.recipe).toEqual(selectedRecipe)
    expect(output.licenseRef).toBe(source.licenseRef)
    expect(output.origin).toEqual(source.origin)
    expect(decodeCanonicalPng(await reopened.resources.read(source.sha256)).rgba).toEqual(data)
  })

  it('uses exact decontamination source PNG pixels despite native fractional-alpha RGB rounding', async () => {
    const decode = vi.fn(async (bytes: Uint8Array) => {
      const image = decodeCanonicalPng(bytes)
      for (let at = 0; at < image.rgba.length; at += 4) if (image.rgba[at + 3] > 0 && image.rgba[at + 3] < 255) {
        image.rgba[at] += 7; image.rgba[at + 1] -= 5; image.rgba[at + 2] += 3
      }
      return image
    })
    const selectedRecipe = { ...recipe, direction: 'decontaminate' as const }, { bundle, lastId } = fixture(1, undefined, selectedRecipe)
    const adapter = { ...images, decode }
    await expect(validateProjectBundle(bundle, { images: adapter })).resolves.toBeDefined()
    const encoded = await exportProject(bundle, { images: adapter }), reopened = await importProject(encoded, { images: adapter })
    const output = reopened.project.document.assets[lastId]
    expect(decodeCanonicalPng(await reopened.resources.read(output.sha256)).rgba).toEqual(applyImageEnhancement(pixels, selectedRecipe).data)
    expect(decode).toHaveBeenCalled() // Actual image adapter validation still executes for every resource.
    // Existing recipes keep their native source semantics; the new direction does not redefine them.
    await expect(validateProjectBundle(fixture().bundle, { images: adapter })).rejects.toThrow('画质增强真实像素')
  })

  it('treats exact source decoding as optional and keeps damaged or unsupported data on the full validation path', async () => {
    const bytes = encodeCanonicalPng({ width: pixels.width, height: pixels.height, rgba: pixels.data })
    expect(tryDecodeDecontaminationSource(bytes, 'image/png')?.rgba).toEqual(pixels.data)
    expect(tryDecodeDecontaminationSource(bytes, 'image/jpeg')).toBeUndefined()
    const text = new TextEncoder().encode('note\0source'), chunk = new Uint8Array(text.length + 12), view = new DataView(chunk.buffer)
    view.setUint32(0, text.length); chunk.set(new TextEncoder().encode('tEXt'), 4); chunk.set(text, 8)
    view.setUint32(text.length + 8, crc32(chunk.subarray(4, text.length + 8)))
    const unsupported = new Uint8Array(bytes.length + chunk.length)
    unsupported.set(bytes.subarray(0, bytes.length - 12)); unsupported.set(chunk, bytes.length - 12)
    unsupported.set(bytes.subarray(bytes.length - 12), bytes.length - 12 + chunk.length)
    expect(tryDecodeDecontaminationSource(unsupported, 'image/png')).toBeUndefined()
    const damaged = bytes.slice(); damaged[damaged.length - 1] ^= 1
    expect(tryDecodeDecontaminationSource(damaged, 'image/png')).toBeUndefined()
    const { bundle } = fixture(1, undefined, { ...recipe, direction: 'decontaminate' })
    const decode = vi.fn(async () => { throw new Error('actual image decode failed') })
    await expect(validateProjectBundle(bundle, { images: { ...images, decode } })).rejects.toThrow('actual image decode failed')
  })

  it('rejects forged output pixels despite matching declared bytes, hash and dimensions', async () => {
    const { bundle, bytes, lastId } = fixture(1, scopeMask), project = cloneJson(bundle.project)
    const asset = project.document.assets[lastId], oldHash = asset.sha256, image = decodeCanonicalPng(bytes.get(oldHash)!)
    image.rgba[0] ^= 1 // outside the persisted scope
    const forged = encodeCanonicalPng(image), hash = sha256Bytes(forged)
    asset.sha256 = hash
    project.assets[hash] = { ...project.assets[oldHash], sha256: hash, sizeBytes: forged.length }
    if (!Object.values(project.document.assets).some(value => value.sha256 === oldHash)) delete project.assets[oldHash]
    bytes.set(hash, forged)
    await expect(validateProjectBundle({ project, resources: createMemoryResources(bytes) }, { images })).rejects.toThrow('画质增强真实像素')
  })

  it.each([
    ['missing source', (assets: Record<string, AssetRef>) => { delete assets.source }],
    ['cycle', (assets: Record<string, AssetRef>) => { assets['enhanced-1'].imageEnhancement!.sourceAssetId = 'enhanced-2' }],
    ['false original', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].imageEnhancement!.originalAssetId = 'enhanced-1' }],
    ['world size', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].logicalSizeMm.width++ }],
    ['recipe scale', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].imageEnhancement!.recipe = { ...recipe, scale: 2 } }],
    ['license', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].licenseRef = 'replacement-license' }],
    ['origin', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].origin.kind = 'original' }],
    ['scope bounds', (assets: Record<string, AssetRef>) => { assets['enhanced-2'].imageEnhancement!.scopeMask = { ...scopeMask, x: 3 } }],
  ])('rejects invalid %s metadata', (_label, mutate) => {
    const { bundle } = fixture(2)
    mutate(bundle.project.document.assets)
    expect(inspectImageEnhancementAssets(bundle.project.document.assets).length).toBeGreaterThan(0)
    expect(() => validateProjectData(bundle.project)).toThrow()
  })

  it('bounds source chain depth and strictly rejects unknown recipe fields', () => {
    const { bundle } = fixture(1), assets = bundle.project.document.assets
    for (let index = 2; index <= 17; index++) assets[`enhanced-${index}`] = { ...cloneJson(assets['enhanced-1']), id: `enhanced-${index}`,
      imageEnhancement: { ...assets['enhanced-1'].imageEnhancement!, sourceAssetId: `enhanced-${index - 1}` } }
    expect(inspectImageEnhancementAssets(assets).some(issue => issue.message.includes('16层'))).toBe(true)
    const plain = fixture().bundle.project
    Object.assign(plain.document.assets['enhanced-1'].imageEnhancement!.recipe, { fidelityPass: true })
    expect(() => validateProjectData(plain)).toThrow()
  })

  it('rejects a second pixel-authoring owner for an enhancement output', () => {
    const { bundle, lastId } = fixture(), output = bundle.project.document.assets[lastId]
    bundle.project.authoringSources[lastId] = { kind: 'svg', sourceSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64),
      sourceSizeBytes: 100, normalizedSizeBytes: 100, rasterSha256: output.sha256, processorId: 'sceneweave-static-svg', processorVersion: 1 }
    expect(() => validateProjectData(bundle.project)).toThrow('不能同时属于')
  })

  it('uses canonical RGBA for enhanced sources and later appearance descendants', async () => {
    const { bundle } = fixture(2), sourceHash = bundle.project.document.assets.source.sha256
    const decode = vi.fn(async (bytes: Uint8Array, record: AssetRecord) => {
      const result = decodeCanonicalPng(bytes)
      if (record.sha256 !== sourceHash) result.rgba[3] = 0 // native premultiplication cannot alter replay of enhanced sources
      return result
    })
    await expect(validateProjectBundle(bundle, { images: { ...images, decode } })).resolves.toBeDefined()
    const provenance = cloneJson(bundle.project)
    provenance.appearance.variants.fake = { id: 'fake', sourceAssetId: 'enhanced-2', outputAssetId: 'tinted', tint: '#abcdef', brightness: 1 }
    expect(bitmapVariantPixelPipeline(provenance, 'source')).toBe('native')
    expect(bitmapVariantPixelPipeline(provenance, 'enhanced-2')).toBe('svg-rgba8-v1')
    expect(bitmapVariantPixelPipeline(provenance, 'tinted')).toBe('svg-rgba8-v1')
  })

  it('replays later tint adjustments in canonical pixels without a second native transform', async () => {
    const { bundle, bytes, lastId } = fixture(), project = bundle.project, source = project.document.assets[lastId]
    const variant = bitmapVariant(lastId, '#ABCDEF', .8)!, original = decodeCanonicalPng(bytes.get(source.sha256)!)
    const png = encodeCanonicalPng({ ...original, rgba: transformRgba(original.rgba, variant.tint, variant.brightness) }), hash = sha256Bytes(png)
    const { imageEnhancement: _enhancement, ...sourceMetadata } = source
    project.document.assets[variant.outputAssetId] = { ...sourceMetadata, id: variant.outputAssetId, sha256: hash }
    project.assets[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: original.width, pixelHeight: original.height }
    project.appearance.variants[variant.id] = variant
    project.document.propDefinitions.tinted = { ...cloneJson(project.document.propDefinitions.definition), id: 'tinted', catalogId: 'test.tinted-item',
      defaultAppearance: { kind: 'image', assetId: variant.outputAssetId, tint: null, opacity: 1 } }
    const license = project.licenseBindings[0]
    project.licenseBindings.push({ ...license, subjectKind: 'asset', subjectId: variant.outputAssetId }, { ...license, subjectKind: 'propDefinition', subjectId: 'tinted' })
    bytes.set(hash, png)
    const transform = vi.fn(async () => { throw new Error('Enhanced descendants must not be transformed natively') })
    await expect(validateProjectBundle({ project, resources: createMemoryResources(bytes) }, { images: { ...images, transform } })).resolves.toBeDefined()
    expect(transform).not.toHaveBeenCalled()
  })

  it('cancels without issuing a verified result', async () => {
    await expect(validateProjectBundle(fixture().bundle, { images, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
