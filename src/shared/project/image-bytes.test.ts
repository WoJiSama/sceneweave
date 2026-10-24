import { expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { crc32 } from './binary.js'
import { inspectImageBytes, normalizePngChunks } from './image-bytes.js'
import { PACKAGE_LIMITS } from './limits.js'

it('keeps the default 20 MiB asset limit while allowing an explicitly bounded large Canvas PNG to be normalized', () => {
  const chunk = (name: string, value: Uint8Array) => {
    const bytes = new Uint8Array(value.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, value.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(value, 8)
    view.setUint32(value.length + 8, crc32(bytes.subarray(4, value.length + 8))); return bytes
  }
  const width = 2304, height = 2304, header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  // A real, losslessly decodable RGBA8 PNG; stored deflate avoids a tiny fixture
  // being mistaken for evidence that a complete map remains below the asset cap.
  const scanlines = new Uint8Array((width * 4 + 1) * height)
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('eXIf', new TextEncoder().encode('private-exif')), chunk('IDAT', zlibSync(scanlines, { level: 0 })), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0; for (const item of chunks) { bytes.set(item, offset); offset += item.length }
  expect(bytes.length).toBeGreaterThan(PACKAGE_LIMITS.imageBytes)
  expect(() => normalizePngChunks(bytes)).toThrow('字节保护值')
  expect(() => inspectImageBytes(bytes, false)).toThrow('20 MiB')
  expect(() => normalizePngChunks(bytes, bytes.length - 1)).toThrow('字节保护值')
  const normalized = normalizePngChunks(bytes, bytes.length)
  expect(normalized.length).toBeLessThan(bytes.length)
  const data = new DataView(normalized.buffer); expect(data.getUint32(16)).toBe(width); expect(data.getUint32(20)).toBe(height)
  expect(() => inspectImageBytes(normalized)).toThrow('20 MiB')
  const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1
  expect(() => normalizePngChunks(corrupt, corrupt.length)).toThrow('CRC')
})

it('enforces the output byte bound after adding the normalized sRGB chunk', () => {
  const chunk = (name: string, value: Uint8Array) => {
    const bytes = new Uint8Array(value.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, value.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(value, 8)
    view.setUint32(value.length + 8, crc32(bytes.subarray(4, value.length + 8))); return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', new Uint8Array([120, 1, 1, 0, 0, 255, 255])), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0; for (const item of chunks) { bytes.set(item, offset); offset += item.length }
  expect(() => normalizePngChunks(bytes, bytes.length)).toThrow('字节保护值')
})
