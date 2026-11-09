import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { crc32 } from './binary.js'
import { decodeCanonicalPng, encodeCanonicalPng } from './png-rgba.js'

function png(raw: number[] | Uint8Array, width = 2, height = 2, alter?: (encoded: Uint8Array) => void): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8)
    view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8))); return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  const encoded = zlibSync(Uint8Array.from(raw)); alter?.(encoded)
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', header), ...chunk('IDAT', encoded), ...chunk('IEND', new Uint8Array())])
}
const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 64, 100, 110, 120, 0])

describe('processor-2 software PNG pixels', () => {
  it.each([
    [0, [10, 20, 30, 255, 40, 50, 60, 128], [70, 80, 90, 64, 100, 110, 120, 0]],
    [1, [10, 20, 30, 255, 30, 30, 30, 129], [70, 80, 90, 64, 30, 30, 30, 192]],
    [2, [10, 20, 30, 255, 40, 50, 60, 128], [60, 60, 60, 65, 60, 60, 60, 128]],
    [3, [10, 20, 30, 255, 35, 40, 45, 1], [65, 70, 75, 193, 45, 45, 45, 160]],
    [4, [10, 20, 30, 255, 30, 30, 30, 129], [60, 60, 60, 65, 30, 30, 30, 192]],
  ] as const)('decodes PNG filter %i without alpha/color quantization', (filter, row1, row2) => {
    expect(decodeCanonicalPng(png([filter, ...row1, filter, ...row2]))).toEqual({ width: 2, height: 2, rgba })
  })

  it('encodes deterministic normalized RGBA8 and retains even fully transparent RGB', () => {
    const image = { width: 2, height: 2, rgba }
    const first = encodeCanonicalPng(image), second = encodeCanonicalPng(image)
    expect(first).toEqual(second)
    expect([first[24], first[25], first[28]]).toEqual([8, 6, 0])
    expect(decodeCanonicalPng(first)).toEqual(image)
  })

  it('rejects valid-CRC streams with false Adler32, wrong output size and invalid filters', () => {
    expect(() => decodeCanonicalPng(png([0, 1, 2, 3, 255], 1, 1, encoded => { encoded[encoded.length - 1] ^= 1 }))).toThrow(/Adler32/)
    expect(() => decodeCanonicalPng(png(new Uint8Array(20_000), 1, 1))).toThrow(/实际解压像素/)
    expect(() => decodeCanonicalPng(png([0, 1], 1, 1))).toThrow(/长度/)
    expect(() => decodeCanonicalPng(png([5, 1, 2, 3, 255], 1, 1))).toThrow(/滤波/)
  })

  it('rejects corrupt chunks, dimension excess and invalid raster lengths', () => {
    const corrupt = encodeCanonicalPng({ width: 2, height: 2, rgba }); corrupt[corrupt.length - 1] ^= 1
    expect(() => decodeCanonicalPng(corrupt)).toThrow(/CRC/)
    expect(() => encodeCanonicalPng({ width: 8192, height: 1, rgba: new Uint8ClampedArray(8192 * 4) })).toThrow(/预算/)
    expect(() => encodeCanonicalPng({ width: 1, height: 1, rgba: new Uint8ClampedArray(3) })).toThrow(/长度/)
  })
})
