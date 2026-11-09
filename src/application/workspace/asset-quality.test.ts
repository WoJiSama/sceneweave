import { describe, expect, it, vi } from 'vitest'
import { artworkValidation, ARTWORK_SVG, encodeFixtureRaster } from '../../../tests/helpers/m24-artwork-fixtures.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { normalizePngChunks } from '../../shared/project/image-bytes.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { assessAddedCatalogQuality, assessImportedAssetQuality } from './asset-quality.js'
import { prepareAssetBatchImport, AssetBatchImportError, type AssetImportRequest } from './asset-batch.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject } from './project.js'
import { fixture, pixelPng, runtime } from './test-fixtures.js'

// Keep PNG normalization deterministic in Node. Real fixture byte/CRC/pixel
// validation and quality assessment remain enabled; browser tests cover Canvas.
vi.mock('../../platform/browser/images/index.js', async () => {
  const { inspectImageBytes, normalizePngChunks } = await import('../../shared/project/image-bytes.js')
  const { sha256Bytes } = await import('../../shared/project/binary.js')
  return { normalizeBrowserImage: vi.fn(async (bytes: Uint8Array, mime: string) => {
    const before = inspectImageBytes(bytes, false)
    if (mime && mime !== 'application/octet-stream' && mime !== before.mimeType) throw new Error('MIME mismatch')
    const normalized = normalizePngChunks(bytes), header = inspectImageBytes(normalized)
    return { bytes: normalized, record: { sha256: sha256Bytes(normalized), mimeType: header.mimeType,
      sizeBytes: normalized.length, pixelWidth: header.width, pixelHeight: header.height } }
  }) }
})

const validation = artworkValidation()
const png = () => encodeFixtureRaster({ width: 128, height: 128,
  rgba: new Uint8ClampedArray(Array.from({ length: 128 * 128 }, () => [40, 80, 120, 255]).flat()) })
const request = (overrides: Partial<AssetImportRequest> = {}): AssetImportRequest => ({
  file: new Blob([new Uint8Array(png())], { type: 'image/png' }), name: '  保留木桌_02 🌲  ', kind: 'prop',
  widthMm: 1000, heightMm: 1000, footprintWidthMm: 600, footprintHeightMm: 600,
  licenseText: 'Complete original fixture grant for embedding', attribution: 'Original fixture artist', canEmbed: true, ...overrides,
})
const blank = () => fromBundle(fixture({ image: true }), validation)

describe('asset quality preparation boundary', () => {
  it('screens actual normalized PNG and SVG through one report contract without changing names or adopted pixels', async () => {
    const before = await blank(), beforeJson = canonicalJson(toBundle(before).project)
    const requests = [request(), request({ name: 'SVG source', file: new Blob([ARTWORK_SVG], { type: 'image/svg+xml' }) })]
    const result = await prepareAssetBatchImport(before, requests, { runtime, validation })
    expect(result.items).toHaveLength(2)
    for (const [index, item] of result.items.entries()) {
      expect(item.quality.name).toBe(requests[index].name)
      expect(item.quality.sha256).toBe(item.sha256)
      expect(item.quality.report).toMatchObject({ format: 'sceneweave-asset-quality', version: 1, policyId: 'asset-quality-v1',
        status: 'review', context: { kind: 'prop', widthMm: 1000, heightMm: 1000 } })
      expect(item.quality.report.pixelWidth).toBe(index ? 512 : 128)
      expect(item.quality.report.pixelHeight).toBe(index ? 512 : 128)
      expect(item.quality.report.issues.map(issue => issue.code)).toContain('opaque-prop-background')
      expect(sha256Bytes(await result.project.resources.read(item.sha256))).toBe(item.sha256)
      expect(Object.isFrozen(item.quality.report)).toBe(true)
    }
    expect(await result.project.resources.read(result.items[0].sha256)).toEqual(normalizePngChunks(png()))
    expect(result.items[1].sourceKind).toBe('svg')
    expect(result.project.authoringSources[result.items[1].assetId].rasterSha256).toBe(result.items[1].sha256)
    expect(canonicalJson(toBundle(before).project)).toBe(beforeJson)
  })

  it('rejects a fully transparent last image atomically and leaves the input valid with its original resource closure', async () => {
    const before = await blank(), original = canonicalJson(toBundle(before).project)
    const resources = await Promise.all(Object.keys(before.assets).map(async hash => [hash, await before.resources.read(hash)] as const))
    const invisible = request({ name: 'Invisible final image', file: new Blob([new Uint8Array(pixelPng([0, 0, 0, 0]))], { type: 'image/png' }) })
    try {
      await prepareAssetBatchImport(before, [request(), invisible], { runtime, validation })
      throw new Error('Expected transparent image rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AssetBatchImportError)
      expect(error).toMatchObject({ itemIndex: 1, assetName: 'Invisible final image' })
      expect(String(error)).toMatch(/完全透明/)
      expect(error).not.toHaveProperty('project'); expect(error).not.toHaveProperty('items')
    }
    expect(canonicalJson(toBundle(await validateEditableProject(before, validation)).project)).toBe(original)
    for (const [hash, bytes] of resources) expect(await before.resources.read(hash)).toEqual(bytes)
  })

  it('honors cancellation after actual decoding without returning a usable report or staged project', async () => {
    const before = await blank(), original = canonicalJson(toBundle(before).project), signal = { aborted: false }
    const bytes = normalizePngChunks(png()), record = { sha256: sha256Bytes(bytes), mimeType: 'image/png' as const,
      sizeBytes: bytes.length, pixelWidth: 128, pixelHeight: 128 }
    let decodes = 0
    const cancelled: CompleteValidationOptions = { ...validation, signal, images: { ...validation.images,
      async decode(...args) { decodes++; const pixels = await validation.images.decode(...args); signal.aborted = true; return pixels } } }
    await expect(assessImportedAssetQuality('Cancelled', bytes, record, { kind: 'prop', widthMm: 1000, heightMm: 1000 }, cancelled))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(decodes).toBe(1)
    signal.aborted = true
    await expect(prepareAssetBatchImport(before, [request()], { runtime, validation, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(canonicalJson(toBundle(before).project)).toBe(original)
  })

  it('screens new definitions that reuse an existing image using their new world calibration', async () => {
    const base = await blank(), imported = await prepareAssetBatchImport(base, [request()], { runtime, validation })
    const before = imported.project, after = captureEditableDraft(before), source = before.document.propDefinitions[imported.items[0].definitionId]
    const id = 'larger-same-pixels'
    after.document.propDefinitions[id] = { ...structuredClone(source), id, catalogId: id, name: 'Reused image at eight metres',
      defaultVisualBoundsMm: { ...source.defaultVisualBoundsMm, width: 8000, height: 8000 } }
    const license = after.licenseBindings.find(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === source.id)!
    after.licenseBindings.push({ ...license, subjectId: id })
    expect(Object.keys(after.assets)).toEqual(Object.keys(before.assets))
    const beforeJson = canonicalJson(toBundle(before).project), afterJson = canonicalJson(toBundle(after).project)
    const [assessment] = await assessAddedCatalogQuality(before, after, validation)
    expect(assessment.name).toBe('Reused image at eight metres')
    expect(assessment.sha256).toBe(imported.items[0].sha256)
    expect(assessment.report.context).toEqual({ kind: 'prop', widthMm: 8000, heightMm: 8000 })
    expect(assessment.report.metrics.pixelsPerMeter.minimum).toBe(16)
    expect(assessment.report.issues.map(issue => issue.code)).toContain('low-resolution')
    expect(assessment.key).not.toBe(imported.items[0].quality.key)
    expect(canonicalJson(toBundle(before).project)).toBe(beforeJson)
    expect(canonicalJson(toBundle(after).project)).toBe(afterJson)
  })

  it('does not retroactively reject existing transparent content while checking an unrelated new material', async () => {
    const bundle = fixture({ image: true }), asset = bundle.project.document.assets.image
    const invisible = pixelPng([0, 0, 0, 0]), hash = sha256Bytes(invisible)
    const oldHash = asset.sha256
    asset.sha256 = hash
    const record = bundle.project.assets[oldHash]
    delete bundle.project.assets[oldHash]
    bundle.project.assets[hash] = { ...record, sha256: hash, sizeBytes: invisible.length }
    const originalResources = bundle.resources
    bundle.resources = { read: async requested => requested === hash ? invisible.slice() : originalResources.read(requested) }
    const before = await fromBundle(bundle, validation)
    expect(await assessAddedCatalogQuality(before, before, validation)).toEqual([])
    const tile = request({ kind: 'material', name: 'New solid floor' })
    delete tile.footprintWidthMm; delete tile.footprintHeightMm
    const added = await prepareAssetBatchImport(before, [tile], { runtime, validation })
    expect(added.items[0].quality.report.status).toBe('pass')
    const reports = await assessAddedCatalogQuality(before, added.project, validation)
    expect(reports).toHaveLength(1); expect(reports[0].name).toBe('New solid floor')
    expect(added.project.document.assets.image.sha256).toBe(hash)
    expect(await added.project.resources.read(hash)).toEqual(invisible)
  })
})
