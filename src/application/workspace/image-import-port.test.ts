import { describe, expect, it, vi } from 'vitest'
import { artworkValidation, encodeFixtureRaster } from '../../../tests/helpers/m24-artwork-fixtures.js'
import { crc32, sha256Bytes } from '../../shared/project/binary.js'
import { inspectImageBytes, normalizePngChunks } from '../../shared/project/image-bytes.js'
import { encodeUtf8 } from '../../shared/validation/json.js'
import { fixture, pixelPng, runtime } from './test-fixtures.js'
import { fromBundle, toBundle } from './project.js'
import { prepareAssetImport, type AssetImportRequest } from './prepare.js'

const png = pixelPng([12, 34, 56, 255])
const request = (bytes = png): AssetImportRequest => ({
  file: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name: 'Portable image', kind: 'prop',
  widthMm: 1200, heightMm: 1800, footprintWidthMm: 300, footprintHeightMm: 200,
  licenseText: 'Original MIT test artwork', attribution: 'Fixture author', canEmbed: true,
})
function ancillary(bytes: Uint8Array, type: string): Uint8Array {
  const data = new Uint8Array([1, 2, 3, 4]), chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer)
  view.setUint32(0, data.length); chunk.set(encodeUtf8(type), 4); chunk.set(data, 8)
  view.setUint32(data.length + 8, crc32(chunk.subarray(4, data.length + 8)))
  const output = new Uint8Array(bytes.length + chunk.length)
  output.set(bytes.subarray(0, 33)); output.set(chunk, 33); output.set(bytes.subarray(33), 33 + chunk.length)
  return output
}

describe('portable external-image preparation', () => {
  it('imports a strict PNG through the injected real decode/encode port without browser normalization', async () => {
    const validation = artworkValidation(), base = await fromBundle(fixture(), validation)
    const encode = vi.spyOn(validation.images, 'encodePng')
    const result = await prepareAssetImport(base, request(), { runtime, validation })
    const definition = Object.values(result.document.propDefinitions).find(row => row.name === 'Portable image')!
    expect(definition.defaultAppearance.kind).toBe('image')
    if (definition.defaultAppearance.kind !== 'image') throw new Error('Expected imported image')
    const asset = result.document.assets[definition.defaultAppearance.assetId]
    const bytes = await result.resources.read(asset.sha256)
    expect(encode).toHaveBeenCalledOnce()
    expect(inspectImageBytes(bytes)).toMatchObject({ width: 1, height: 1, mimeType: 'image/png' })
    expect((await validation.images.decode(bytes, result.assets[asset.sha256])).rgba).toEqual(new Uint8ClampedArray([12, 34, 56, 255]))
    expect(toBundle(base).project.document.propDefinitions).not.toHaveProperty(definition.id)
  })

  it.each(['eXIf', 'iCCP'])('requires a normalization capability for %s metadata before using the generic decoder', async type => {
    const validation = artworkValidation(), base = await fromBundle(fixture(), validation)
    const decode = vi.spyOn(validation.images, 'decode')
    await expect(prepareAssetImport(base, request(ancillary(png, type)), { runtime, validation })).rejects.toThrow(/缺少真实图片解码/)
    expect(decode).not.toHaveBeenCalled()
  })

  it('checks the real pixels of encoded output instead of trusting its dimensions and hash', async () => {
    const validation = artworkValidation(), base = await fromBundle(fixture(), validation)
    validation.images.encodePng = async image => {
      const rgba = image.rgba.slice(); rgba[0] ^= 255
      return encodeFixtureRaster({ ...image, rgba })
    }
    await expect(prepareAssetImport(base, request(), { runtime, validation })).rejects.toThrow(/实际像素与来源解码结果不一致/)
  })

  it('preserves cancellation from decoding and never encodes a cancelled result', async () => {
    const validation = artworkValidation(), base = await fromBundle(fixture(), validation)
    const signal = { aborted: false }, originalDecode = validation.images.decode
    validation.images.decode = async (...args) => { const image = await originalDecode(...args); signal.aborted = true; return image }
    const encode = vi.spyOn(validation.images, 'encodePng')
    await expect(prepareAssetImport(base, request(), { runtime, validation, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(encode).not.toHaveBeenCalled()
  })

  it('passes original metadata to the explicit normalization adapter and accepts its oriented dimensions', async () => {
    const validation = artworkValidation(), base = await fromBundle(fixture(), validation)
    const rgba = new Uint8ClampedArray([12, 34, 56, 255, 78, 90, 12, 255])
    const raw = ancillary(encodeFixtureRaster({ width: 2, height: 1, rgba }), 'eXIf')
    const output = normalizePngChunks(encodeFixtureRaster({ width: 1, height: 2, rgba }))
    // This verifies capability delegation, not a browser's EXIF implementation.
    const normalizeImport = vi.fn(async () => ({ bytes: output,
      record: { sha256: sha256Bytes(output), mimeType: 'image/png' as const, sizeBytes: output.length, pixelWidth: 1, pixelHeight: 2 } }))
    validation.images.normalizeImport = normalizeImport
    const result = await prepareAssetImport(base, request(raw), { runtime, validation })
    expect(normalizeImport).toHaveBeenCalledWith(raw, 'image/png', expect.any(Object))
    expect(result.assets[sha256Bytes(output)]).toMatchObject({ pixelWidth: 1, pixelHeight: 2 })
    expect(await result.resources.read(sha256Bytes(output))).toEqual(output)
  })
})
