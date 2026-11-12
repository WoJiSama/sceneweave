import { describe, expect, it } from 'vitest'
import { refineImageMatte } from './matting.js'
import type { ImagePixelMask, ImagePixels } from '../image-import/pixels.js'

function fixture(foreground = [28, 55, 84], background = [180, 165, 140]) {
  const width = 28, height = 28, data = new Uint8ClampedArray(width * height * 4), mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = x >= 6 && x <= 21 && y >= 6 && y <= 21 ? x === 6 || x === 21 || y === 6 || y === 21 ? 144 : 255 : 0
    const at = (y * width + x) * 4; mask[y * width + x] = a
    data.set([...foreground.map((v, c) => Math.round(v * a / 255 + background[c] * (1 - a / 255))), 255], at)
  }
  return { image: { width, height, data } satisfies ImagePixels, mask: { width, height, data: mask, boundsPx: { x: 0, y: 0, width, height } } satisfies ImagePixelMask }
}
describe('explicit foreground colour inference on fractional edge coverage', () => {
  it('separates edge colour over visible flat background without changing alpha, core, holes or input', () => {
    const { image, mask } = fixture(), before = image.data.slice(), result = refineImageMatte(image, mask, { strength: 'strong' })
    expect(result.metrics.rgbChangedPixels).toBeGreaterThan(40)
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const i = y * mask.width + x, at = i * 4
      expect(result.pixels.data[at + 3]).toBe(mask.data[i])
      if (mask.data[i] === 255) expect(result.pixels.data.slice(at, at + 3)).toEqual(image.data.slice(at, at + 3))
      if (mask.data[i] === 144) for (const [c, value] of [28, 55, 84].entries()) expect(Math.abs(result.pixels.data[at + c] - value)).toBeLessThanOrEqual(1)
    }
    expect(image.data).toEqual(before)
    expect(refineImageMatte(image, mask, { strength: 'strong' }).pixels).toEqual(result.pixels)
  })
  it('keeps binary outlines, thin rods and coloured border geometry intact instead of inventing coverage', () => {
    const { image, mask } = fixture()
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) mask.data[i] = 255
    const result = refineImageMatte(image, mask, { strength: 'strong' })
    expect(result.metrics).toMatchObject({ rgbChangedPixels: 0, alphaChangedPixels: 0, binaryBoundaryPixels: 60 })
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) expect(result.pixels.data.slice(i * 4, i * 4 + 3)).toEqual(image.data.slice(i * 4, i * 4 + 3))
  })
  it('preserves dark ink and true blue border colour when fractional coverage and background support it', () => {
    for (const foreground of [[12, 13, 15], [18, 104, 214]]) {
      const { image, mask } = fixture(foreground), result = refineImageMatte(image, mask, { strength: 'strong' })
      const at = (6 * 28 + 12) * 4
      for (let c = 0; c < 3; c++) expect(Math.abs(result.pixels.data[at + c] - foreground[c])).toBeLessThanOrEqual(1)
      expect(result.pixels.data[at + 3]).toBe(144)
    }
  })
  it('leaves unstable outside material, low coverage and same-colour weak evidence unresolved', () => {
    const { image, mask } = fixture()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!mask.data[y * image.width + x]) image.data.set(x % 2 ? [10, 240, 10, 255] : [240, 10, 240, 255], (y * image.width + x) * 4)
    const unstable = refineImageMatte(image, mask, { strength: 'strong' })
    expect(unstable.metrics.rgbChangedPixels).toBe(0); expect(unstable.metrics.uncertainPixels).toBe(60)
    const same = fixture([100, 100, 100], [105, 105, 105]), result = refineImageMatte(same.image, same.mask)
    expect(result.metrics.rgbChangedPixels).toBe(0)
    mask.data[6 * 28 + 12] = 32
    expect(refineImageMatte(image, mask).pixels.data[(6 * 28 + 12) * 4 + 3]).toBe(32)
  })
  it('labels explicit background as an estimate and rejects mismatched grids and cancellation', () => {
    const { image, mask } = fixture()
    const background = { ...image, data: image.data.slice() }
    for (let i = 0; i < background.data.length; i += 4) background.data.set([180, 165, 140, 255], i)
    expect(refineImageMatte(image, mask, { background }).metrics.backgroundEvidence).toBe('explicit-estimate')
    expect(() => refineImageMatte(image, mask, { background: { width: 1, height: 1, data: new Uint8ClampedArray(4) } })).toThrow('同坐标')
    expect(() => refineImageMatte(image, mask, {}, { aborted: true })).toThrow('取消')
  })
  it('keeps fractional interior pixels and translucent captured source outside the reconstruction evidence', () => {
    const { image, mask } = fixture()
    mask.data[12 * 28 + 12] = 150
    image.data[(6 * 28 + 12) * 4 + 3] = 120
    const result = refineImageMatte(image, mask, { strength: 'strong', bandPx: 2 })
    for (const [x, y] of [[12, 12], [12, 6]]) {
      const at = (y * 28 + x) * 4
      expect(result.pixels.data.slice(at, at + 3)).toEqual(image.data.slice(at, at + 3))
    }
    expect(result.pixels.data[(6 * 28 + 12) * 4 + 3]).toBe(Math.round(120 * 144 / 255))
  })
  it('rejects malformed pixel grids or mask budgets before producing a candidate', () => {
    const { image, mask } = fixture()
    expect(() => refineImageMatte({ ...image, data: new Uint8ClampedArray(4) }, mask)).toThrow('完整源RGBA')
    expect(() => refineImageMatte(image, { ...mask, boundsPx: { ...mask.boundsPx, x: -1 } })).toThrow('选区')
    expect(() => refineImageMatte(image, { ...mask, data: new Uint8Array(1) })).toThrow('选区')
    expect(() => refineImageMatte(image, mask, { bandPx: 3 as 1 })).toThrow('范围')
  })
})
