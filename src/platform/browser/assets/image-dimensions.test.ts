import { afterEach, describe, expect, it, vi } from 'vitest'
import { STATIC_SVG_LIMITS } from '../../../shared/ai/svg.js'
import { crc32 } from '../../../shared/project/binary.js'
import { encodeFixtureRaster } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { assetImageDimensions } from './image-dimensions.js'

const pixels = () => encodeFixtureRaster({ width: 2, height: 3, rgba: new Uint8ClampedArray(2 * 3 * 4).fill(255) })
const blob = (bytes: Uint8Array, type = '') => new Blob([bytes.slice().buffer as ArrayBuffer], { type })
const svg = (body = '<rect x="0" y="0" width="64" height="32" fill="#123456"/>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32">${body}</svg>`
const bitmap = (width = 2, height = 3) => ({ width, height, close: vi.fn() })

afterEach(() => vi.unstubAllGlobals())

describe('calibration image dimensions', () => {
  it('reads actual oriented dimensions with the same native decode options and closes the bitmap', async () => {
    const decoded = bitmap(3, 2), decode = vi.fn(async () => decoded)
    vi.stubGlobal('createImageBitmap', decode)
    expect(await assetImageDimensions(blob(pixels(), 'image/png'))).toEqual({ width: 3, height: 2 })
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
    expect(decoded.close).toHaveBeenCalledTimes(1)
  })

  it('owns native Blob bytes before awaiting and ignores caller-owned getters and methods', async () => {
    const original = pixels(), file = blob(original)
    let reads = 0, actualBytes: Uint8Array | undefined
    for (const key of ['size', 'type', 'slice', 'arrayBuffer']) Object.defineProperty(file, key, { get() { reads++; throw new Error('caller accessor') } })
    const decoded = bitmap()
    vi.stubGlobal('createImageBitmap', vi.fn(async (owned: Blob) => {
      actualBytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(owned))
      expect(owned.type).toBe('image/png')
      return decoded
    }))
    const pending = assetImageDimensions(file)
    original.fill(0)
    expect(await pending).toEqual({ width: 2, height: 3 })
    expect(actualBytes).toEqual(pixels()); expect(reads).toBe(0); expect(decoded.close).toHaveBeenCalledTimes(1)
  })

  it('releases a decoded bitmap even when its dimensions fail validation', async () => {
    for (const dimensions of [[4, 5], [8193, 3], [0, 3], [2.5, 3]]) {
      const decoded = bitmap(...dimensions as [number, number])
      vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded))
      await expect(assetImageDimensions(blob(pixels()))).rejects.toThrow(/实际方向或尺寸/)
      expect(decoded.close).toHaveBeenCalledTimes(1)
    }
  })

  it('does not create a native bitmap for oversized or corrupt headers, unsupported formats or byte overages', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
    for (const [width, height] of [[8193, 1], [8192, 8192]]) {
      const changed = pixels(), view = new DataView(changed.buffer)
      view.setUint32(16, width); view.setUint32(20, height); view.setUint32(29, crc32(changed.subarray(12, 29)))
      await expect(assetImageDimensions(blob(changed))).rejects.toThrow(/尺寸或像素/)
    }
    const corrupt = pixels(); corrupt[corrupt.length - 1] ^= 1
    await expect(assetImageDimensions(blob(corrupt))).rejects.toThrow(/CRC/)
    await expect(assetImageDimensions(blob(encodeUtf8('GIF89a')))).rejects.toThrow(/仅支持/)
    await expect(assetImageDimensions(new Blob())).rejects.toThrow(/非空/)
    const mebibyte = new Blob([new Uint8Array(1024 * 1024)])
    await expect(assetImageDimensions(new Blob(Array.from({ length: 21 }, () => mebibyte)))).rejects.toThrow(/20 MiB/)
    expect(decode).not.toHaveBeenCalled()
  })

  it('reports decoder failures and missing browser support without retaining anything', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(assetImageDimensions(blob(pixels()))).rejects.toThrow(/不能读取实际图片方向/)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decoder rejected') }))
    await expect(assetImageDimensions(blob(pixels()))).rejects.toThrow(/实际解码失败/)
  })

  it('serializes native hints and does not cache decoded bitmaps across requests', async () => {
    let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), firstStarted = new Promise<void>(resolve => { started = resolve })
    const first = bitmap(), second = bitmap()
    const decode = vi.fn().mockImplementationOnce(async () => { started(); await gate; return first }).mockImplementationOnce(async () => second)
    vi.stubGlobal('createImageBitmap', decode)
    const pending = [assetImageDimensions(blob(pixels())), assetImageDimensions(blob(pixels()))]
    await firstStarted
    try { expect(decode).toHaveBeenCalledTimes(1) } finally { release() }
    expect(await Promise.all(pending)).toEqual([{ width: 2, height: 3 }, { width: 2, height: 3 }])
    expect(decode).toHaveBeenCalledTimes(2)
    expect(first.close).toHaveBeenCalledTimes(1); expect(second.close).toHaveBeenCalledTimes(1)
  })

  it('uses the constrained static SVG viewBox without passing source XML to an image decoder', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
    expect(await assetImageDimensions(blob(encodeUtf8(svg()), 'image/svg+xml'))).toEqual({ width: 64, height: 32 })
    expect(decode).not.toHaveBeenCalled()
  })

  it('rejects active XML, external references, malformed UTF-8, BOM and oversized SVG consistently with preparation', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
    const invalid = [svg('<script/>'), svg('<foreignObject/>'), svg('<image href="https://example.test/image.png"/>'),
      `<!DOCTYPE svg>${svg()}`, `\ufeff${svg()}`, `<?xml version="1.0"?>${svg()}`,
      svg().replace('<rect ', '<rect onclick="alert(1)" ')]
    for (const source of invalid) await expect(assetImageDimensions(blob(encodeUtf8(source)))).rejects.toThrow()
    await expect(assetImageDimensions(blob(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff])))).rejects.toThrow()
    await expect(assetImageDimensions(new Blob([svg(), ' '.repeat(STATIC_SVG_LIMITS.sourceBytes)]))).rejects.toThrow()
    expect(decode).not.toHaveBeenCalled()
  })
})
