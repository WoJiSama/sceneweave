import { describe, expect, it } from 'vitest'
import { artworkValidation } from '../../../tests/helpers/m24-artwork-fixtures.js'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { bitmapVariant, createCompositionContent } from '../appearance/graph.js'
import { inspectDependencies } from '../geometry/dependencies.js'
import { applyImageEnhancement } from '../image-enhancement/pixels.js'
import type { ImageEnhancementRecipe } from '../image-enhancement/schema.js'
import { exportProject, importProject } from '../project/file.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../project/png-rgba.js'
import { sha256Bytes } from '../project/binary.js'
import { transformRgba } from '../project/pixels.js'
import { createMemoryResources } from '../project/resources.js'
import { projectResourceHashes } from '../project/source-resources.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { adoptLibraryEntries, loadLibraryCapsule, prepareLibraryEntry } from './content.js'

function enhancedSvgItem(strength: ImageEnhancementRecipe['strength'] = 'balanced') {
  const { bundle, bytes } = svgProjectFixture(), project = bundle.project, document = project.document
  const source = document.assets.image, raster = decodeCanonicalPng(bytes.get(source.sha256)!)
  const recipe: ImageEnhancementRecipe = { version: 1, direction: 'clarity', strength, scale: 2 }
  const enhanced = applyImageEnhancement({ width: raster.width, height: raster.height, data: raster.rgba }, recipe)
  const png = encodeCanonicalPng({ width: enhanced.width, height: enhanced.height, rgba: enhanced.data }), hash = sha256Bytes(png)
  document.assets.enhanced = { ...cloneJson(source), id: 'enhanced', sha256: hash, pixelWidth: enhanced.width, pixelHeight: enhanced.height,
    imageEnhancement: { version: 1, sourceAssetId: source.id, originalAssetId: source.id, recipe } }
  project.assets[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: enhanced.width, pixelHeight: enhanced.height }
  bytes.set(hash, png)
  document.propDefinitions.enhancedDefinition = { ...cloneJson(document.propDefinitions.definition), id: 'enhancedDefinition', catalogId: 'test.enhanced-svg',
    defaultAppearance: { kind: 'image', assetId: 'enhanced', tint: null, opacity: 1 } }

  const variant = bitmapVariant('enhanced', '#ABCDEF', .8)!
  const tinted = encodeCanonicalPng({ width: enhanced.width, height: enhanced.height, rgba: transformRgba(enhanced.data, variant.tint, variant.brightness) })
  const tintedHash = sha256Bytes(tinted)
  document.assets[variant.outputAssetId] = { ...cloneJson(source), id: variant.outputAssetId, sha256: tintedHash, pixelWidth: enhanced.width, pixelHeight: enhanced.height }
  project.assets[tintedHash] = { sha256: tintedHash, mimeType: 'image/png', sizeBytes: tinted.length, pixelWidth: enhanced.width, pixelHeight: enhanced.height }
  bytes.set(tintedHash, tinted)
  document.propDefinitions.tintedDefinition = { ...cloneJson(document.propDefinitions.definition), id: 'tintedDefinition', catalogId: 'test.tinted-enhanced-svg',
    defaultAppearance: { kind: 'image', assetId: variant.outputAssetId, tint: null, opacity: 1 } }
  Object.assign(project, createCompositionContent(document, runtime))
  project.appearance.variants[variant.id] = variant
  const licensePath = project.licenseBindings[0].licensePath
  project.licenseBindings = inspectDependencies(project.document).subjects.map(subject => ({ ...subject, licensePath, embedding: 'allowed' }))
  bundle.resources = createMemoryResources(bytes)
  return { bundle, variant }
}

describe('enhancement library source closure across appearance and project IO', () => {
  it('keeps original SVG, enhancement recipe and tint bytes through standalone installation, idempotence and cold project import', async () => {
    const { bundle, variant } = enhancedSvgItem(), validation = artworkValidation()
    const entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'tintedDefinition' }, validation)
    const capsule = await loadLibraryCapsule(entry, validation)
    expect(capsule.project.document.props).toEqual({})
    expect(Object.keys(capsule.project.document.assets).sort()).toEqual(['image', 'enhanced', variant.outputAssetId].sort())
    expect(Object.keys(capsule.project.document.propDefinitions).sort()).toEqual(['enhancedDefinition', 'tintedDefinition'])
    expect(capsule.project.authoringSources).toEqual(bundle.project.authoringSources)
    expect(capsule.project.document.assets.enhanced.imageEnhancement).toEqual(bundle.project.document.assets.enhanced.imageEnhancement)
    expect(capsule.project.appearance.variants).toEqual({ [variant.id]: variant })
    expect(capsule.project.document.assets[variant.outputAssetId].imageEnhancement).toBeUndefined()
    expect(capsule.project.licenseBindings.filter(binding => binding.subjectKind === 'asset')).toHaveLength(3)

    const target = fixture(), before = canonicalJson(target.project)
    const adopted = await adoptLibraryEntries(target, [entry], validation)
    expect(canonicalJson(target.project)).toBe(before)
    expect(adopted.bundle.project.document.props).toEqual(target.project.document.props)
    expect(adopted.bundle.project.historyIdentity).toEqual(target.project.historyIdentity)
    expect((await adoptLibraryEntries(adopted.bundle, [entry], validation)).operationCost).toBe(0)
    const cold = await importProject(await exportProject(adopted.bundle, validation), validation)
    for (const hash of projectResourceHashes(capsule.project)) expect(await cold.resources.read(hash)).toEqual(await capsule.resources.read(hash))
    expect(cold.project.document.assets.enhanced).toEqual(capsule.project.document.assets.enhanced)
  })

  it('binds the actual enhancement recipe into fixed identity even when uniform pixels are equal', async () => {
    const validation = artworkValidation(), first = enhancedSvgItem('gentle'), second = enhancedSvgItem('strong')
    expect(first.bundle.project.assets).toEqual(second.bundle.project.assets)
    const a = await prepareLibraryEntry(first.bundle, { kind: 'prop', definitionId: 'tintedDefinition' }, validation)
    const b = await prepareLibraryEntry(second.bundle, { kind: 'prop', definitionId: 'tintedDefinition' }, validation)
    expect(a.item.identity.logicalKey).toBe(b.item.identity.logicalKey)
    expect(a.item.identity.contentHash).not.toBe(b.item.identity.contentHash)
    await expect(adoptLibraryEntries(fixture(), [a, b], validation)).rejects.toThrow('逻辑素材身份')
  })
})
