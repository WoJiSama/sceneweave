import { describe, expect, it } from 'vitest'
import { blurWhiteMask } from './mask-blur.js'

const image = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData
describe('software white-mask Gaussian fallback', () => {
  it('softens a boundary symmetrically while preserving opaque interior and transparent exterior', () => {
    const mask = image(101, 101)
    for (let y = 0; y < 101; y++) for (let x = 50; x < 101; x++) mask.data[(y * 101 + x) * 4 + 3] = 255
    blurWhiteMask(mask, 4)
    const alpha = (x: number) => mask.data[(50 * 101 + x) * 4 + 3]
    expect(alpha(25)).toBe(0); expect(alpha(75)).toBe(255)
    expect(alpha(49) + alpha(50)).toBe(255)
    const levels = new Set(Array.from({ length: 25 }, (_, i) => alpha(38 + i)))
    expect(levels.size).toBeGreaterThan(12)
    for (let x = 25; x < 75; x++) expect(alpha(x + 1)).toBeGreaterThanOrEqual(alpha(x))
  })
  it('preserves crop results when input includes the finite blur envelope, including a hole', () => {
    const full = image(160, 120), crop = image(100, 100)
    const populate = (target: ImageData, ox: number, oy: number) => {
      for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
        const wx = x + ox, wy = y + oy
        target.data[(y * target.width + x) * 4 + 3] = wx >= 20 && wx < 140 && wy >= 15 && wy < 105 && !(wx > 60 && wx < 90 && wy > 40 && wy < 80) ? 255 : 0
      }
    }
    populate(full, 0, 0); populate(crop, 30, 10); blurWhiteMask(full, 5); blurWhiteMask(crop, 5)
    for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) {
      expect(crop.data[(y * 100 + x) * 4 + 3]).toBe(full.data[((y + 10) * 160 + x + 30) * 4 + 3])
    }
  })
})
