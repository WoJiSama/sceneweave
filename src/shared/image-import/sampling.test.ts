import { describe, expect, it } from 'vitest'
import { scaleSourcePixels } from './sampling.js'

describe('source-colour output sampling', () => {
  it.each([1, 2, 4] as const)('keeps every source RGBA and narrow hand-drawn mark at %sx without a new palette', scale => {
    const image = { width: 3, height: 2, data: new Uint8ClampedArray([101,91,85,255, 4,5,6,255, 78,111,129,255, 132,117,103,255, 42,43,44,128, 0,0,0,0]) }
    const before = image.data.slice(), result = scaleSourcePixels(image, scale)
    expect(result.width).toBe(3 * scale); expect(result.height).toBe(2 * scale)
    for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
      const original = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4
      expect(result.data.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)).toEqual(image.data.slice(original, original + 4))
    }
    expect(image.data).toEqual(before)
  })
  it('rejects invalid or excessive output without allocating a partial image', () => {
    expect(() => scaleSourcePixels({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, 3 as 2)).toThrow('整数倍率')
    expect(() => scaleSourcePixels({ width: 4096, height: 1, data: new Uint8ClampedArray(16384) }, 4)).toThrow('8192')
  })
})
