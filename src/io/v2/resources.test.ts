import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectImageBytes, normalizeImageAsset, sha256Bytes, validateImageAssetRecord } from './resources'
import { imageRecord, pixelPng, pngChunk } from './test-fixtures'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('v2 static bitmap normalization and validation', () => {
  it('hashes actual bytes and checks PNG header/CRC before browser decode', async () => {
    const record = await imageRecord()
    const close = vi.fn(), decode = vi.fn(async () => ({ width: 1, height: 1, close }))
    vi.stubGlobal('createImageBitmap', decode)
    await validateImageAssetRecord(record)
    expect(await sha256Bytes(new Uint8Array(await record.blob.arrayBuffer()))).toBe(record.sha256)
    expect(decode).toHaveBeenCalledWith(record.blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
    expect(close).toHaveBeenCalledOnce()
    const damaged = pixelPng(); damaged[20] ^= 1
    await expect(validateImageAssetRecord(await imageRecord(damaged))).rejects.toThrow('CRC')
    expect(decode).toHaveBeenCalledOnce()
  })

  it('rejects animation, metadata, wrong MIME, excessive dimensions and corrupt bytes', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
    expect(() => inspectImageBytes(pixelPng([pngChunk('acTL', new Uint8Array(8))]))).toThrow('APNG')
    expect(() => inspectImageBytes(pixelPng([pngChunk('tEXt', new TextEncoder().encode('secret\0private'))]))).toThrow('元数据')
    expect(() => inspectImageBytes(pixelPng([], 8193, 1))).toThrow('尺寸')
    expect(() => inspectImageBytes(new TextEncoder().encode('<svg/>'))).toThrow('实际格式')
    const record = await imageRecord()
    await expect(validateImageAssetRecord({ ...record, mimeType: 'image/jpeg' })).rejects.toThrow('MIME')
    await expect(validateImageAssetRecord({ ...record, sha256: '0'.repeat(64) })).rejects.toThrow('SHA-256')
    expect(decode).not.toHaveBeenCalled()
  })

  it('requires real decode support and rejects decoder errors or inconsistent dimensions', async () => {
    const record = await imageRecord()
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(validateImageAssetRecord(record)).rejects.toThrow('真实位图解码')
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad image') }))
    await expect(validateImageAssetRecord(record)).rejects.toThrow('实际解码失败')
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 1, close })))
    await expect(validateImageAssetRecord(record)).rejects.toThrow('解码尺寸')
    expect(close).toHaveBeenCalledOnce()
  })

  it('serializes concurrent browser decodes and releases bitmaps on cancellation', async () => {
    const record = await imageRecord(), controller = new AbortController()
    let active = 0, peak = 0
    const close = vi.fn(() => { active-- })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      return { width: 1, height: 1, close }
    }))
    await Promise.all([validateImageAssetRecord(record), validateImageAssetRecord(record)])
    expect(peak).toBe(1); expect(active).toBe(0)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { controller.abort(); return { width: 1, height: 1, close: vi.fn() } }))
    await expect(validateImageAssetRecord(record, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('normalizes source metadata to newly hashed sRGB PNG and releases its canvas', async () => {
    // This unit test stubs browser primitives; real browser normalization is integration-tested.
    const source = pixelPng([pngChunk('tEXt', new TextEncoder().encode('author\0test fixture'))])
    const close = vi.fn(), drawImage = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })))
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob: (callback: BlobCallback) => callback(new Blob([source.slice().buffer], { type: 'image/png' })) }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
    const record = await normalizeImageAsset(new Blob([source.slice().buffer], { type: 'image/png' }))
    expect(record.sha256).not.toBe(await sha256Bytes(source))
    const result = new Uint8Array(await record.blob.arrayBuffer())
    expect(inspectImageBytes(result)).toEqual({ mimeType: 'image/png', width: 1, height: 1 })
    expect(new TextDecoder().decode(result)).not.toContain('author')
    expect(canvas.getContext).toHaveBeenCalledWith('2d', { colorSpace: 'srgb' })
    expect(drawImage).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0)
  })
})
