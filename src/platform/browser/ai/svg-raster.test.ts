import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { crc32 } from '../../../shared/project/binary.js'
import { rasterizeNormalizedSvg } from './svg-raster.js'

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type), body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes); body.set(data, typeBytes.length)
  const chunk = new Uint8Array(12 + data.length), view = new DataView(chunk.buffer)
  view.setUint32(0, data.length); chunk.set(body, 4); view.setUint32(8 + data.length, crc32(body))
  return chunk
}
function png(width: number, height: number): Uint8Array {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6, 0, 0, 0], 8)
  const raw = new Uint8Array(height * (width * 4 + 1))
  return Uint8Array.from([ ...signature, ...pngChunk('IHDR', header), ...pngChunk('IDAT', deflateSync(raw)), ...pngChunk('IEND', new Uint8Array()) ])
}

class TestOffscreenCanvas {
  width: number
  height: number
  cleared = false
  drawn = false
  constructor(width: number, height: number) { this.width = width; this.height = height }
  getContext(kind: string) {
    if (kind !== '2d') return null
    return { clearRect: () => { this.cleared = true }, drawImage: () => { this.drawn = true } }
  }
  async convertToBlob(options: { type: string }): Promise<Blob> {
    const bytes = png(this.width, this.height)
    return new Blob([bytes.buffer as ArrayBuffer], { type: options.type })
  }
}

describe('browser static SVG rasterization', () => {
  it('uses a bounded owned ImageBitmap/OffscreenCanvas path and returns verified PNG bytes/hash', async () => {
    const close = vi.fn(), decode = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe('image/svg+xml;charset=utf-8')
      const source = await blob.text()
      expect(source).toContain('<svg height="16" width="32"')
      return { width: 32, height: 16, close } as unknown as ImageBitmap
    })
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const normalized = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><circle cx="16" cy="16" r="8" fill="#abc"/></svg>')
      const output = await rasterizeNormalizedSvg(normalized, { longEdgePx: 32 })
      expect(output).toMatchObject({ mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16, processorId: 'sceneweave-static-svg', processorVersion: 1, normalizedSha256: normalized.normalizedSha256 })
      expect(output.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(output.pngBytes.length).toBeGreaterThan(40)
      expect(decode).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects forged sources, unsafe SVG and pixel overages before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const normalized = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect x="0" y="0" width="32" height="16"/></svg>')
      await expect(rasterizeNormalizedSvg({ ...normalized, normalizedSource: '<svg><script/></svg>' }, { longEdgePx: 32 })).rejects.toThrow()
      await expect(rasterizeNormalizedSvg(normalized, { longEdgePx: 8192 })).rejects.toThrow(/保护预算/)
      const aborted = new AbortController(); aborted.abort()
      await expect(rasterizeNormalizedSvg(normalized, { longEdgePx: 32, signal: aborted.signal })).rejects.toThrow(/取消/)
      expect(decode).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('falls back to a detached owned Image Blob URL when createImageBitmap cannot decode SVG', async () => {
    const close = vi.fn(), revoke = vi.fn(), image = { naturalWidth: 32, naturalHeight: 16, onload: null as (() => void) | null, onerror: null as (() => void) | null }
    Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload?.()) } })
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('unsupported SVG bitmap') }))
    vi.stubGlobal('Image', function() { return image })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke })
    try {
      const normalized = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect x="0" y="0" width="32" height="16"/></svg>')
      const output = await rasterizeNormalizedSvg(normalized, { longEdgePx: 32 })
      expect(output.pixelWidth).toBe(32); expect(output.pixelHeight).toBe(16); expect(revoke).toHaveBeenCalledWith('blob:test'); expect(close).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})
