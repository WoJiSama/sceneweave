import { describe, expect, it } from 'vitest'
import { refineImageSubject } from './subject-matting.js'
import type { ImagePixelMask, ImagePixels } from '../image-import/pixels.js'

function fixture(foreground = [25, 48, 73], background = [74, 123, 148], edgeAlpha = .55, fractionalMask = false) {
  const width = 36, height = 32, data = new Uint8ClampedArray(width * height * 4), mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const selected = x >= 7 && x <= 28 && y >= 6 && y <= 25, edge = selected && (x === 7 || x === 28 || y === 6 || y === 25), alpha = selected ? edge ? edgeAlpha : 1 : 0
    data.set([...foreground.map((v, c) => Math.round(v * alpha + background[c] * (1 - alpha))), 255], (y * width + x) * 4)
    mask[y * width + x] = selected ? fractionalMask && edge ? Math.round(alpha * 255) : 255 : 0
  }
  return { image: { width, height, data } satisfies ImagePixels, mask: { width, height, data: mask, boundsPx: { x: 0, y: 0, width, height } } satisfies ImagePixelMask, foreground, background }
}
const at = (image: ImagePixels, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })

describe('source-aware subject coverage and edge colour inference', () => {
  it('estimates captured antialiasing inside a binary support and separates coverage from colour without changing inputs', () => {
    const { image, mask, foreground } = fixture(), before = image.data.slice(), maskBefore = mask.data.slice()
    const result = refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' })
    expect(result.method).toBe('subject-matte-v1')
    expect(result.metrics.alphaChangedPixels).toBeGreaterThan(40)
    expect(result.metrics.rgbChangedPixels).toBeGreaterThan(40)
    for (const [x, y] of [[7, 15], [17, 6], [28, 15], [17, 25]]) {
      const alpha = at(result.pixels, x, y)[3]
      expect(Math.abs(alpha - 140)).toBeLessThanOrEqual(3)
      for (let c = 0; c < 3; c++) expect(Math.abs(at(result.pixels, x, y)[c] - foreground[c])).toBeLessThanOrEqual(2)
      expect(at(result.coveragePixels, x, y).slice(0, 3)).toEqual(at(image, x, y).slice(0, 3))
      expect(at(result.coveragePixels, x, y)[3]).toBe(alpha)
    }
    for (let i = 0; i < mask.data.length; i++) {
      if (!mask.data[i]) expect(result.pixels.data[i * 4 + 3]).toBe(0)
      else expect(result.pixels.data[i * 4 + 3]).toBeGreaterThan(0)
      const x = i % mask.width, y = Math.floor(i / mask.width)
      if (x > 7 && x < 28 && y > 6 && y < 25) expect(at(result.pixels, x, y)).toEqual(at(image, x, y))
    }
    expect(image.data).toEqual(before); expect(mask.data).toEqual(maskBefore)
    expect(refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' })).toEqual(result)
  })

  it('uses dark and blue original backgrounds and raises estimation gradually with strength', () => {
    for (const background of [[8, 12, 17], [64, 122, 167]]) {
      const { image, mask, foreground } = fixture([163, 118, 70], background, .65)
      const gentle = refineImageSubject(image, mask, { bandPx: 1, strength: 'gentle' }), balanced = refineImageSubject(image, mask, { bandPx: 1, strength: 'balanced' }), strong = refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' })
      const alphas = [gentle, balanced, strong].map(r => at(r.pixels, 7, 15)[3])
      expect(alphas[0]).toBeGreaterThan(alphas[1]); expect(alphas[1]).toBeGreaterThan(alphas[2])
      expect(Math.abs(alphas[2] - 166)).toBeLessThanOrEqual(2)
      for (let c = 0; c < 3; c++) expect(Math.abs(at(strong.pixels, 7, 15)[c] - foreground[c])).toBeLessThanOrEqual(2)
    }
  })

  it('limits two-pixel estimation to the inner band and preserves real blue material supported on its own inside', () => {
    const { image, mask, foreground, background } = fixture([18, 99, 210], [193, 177, 140], 1)
    for (let y = 6; y <= 25; y++) for (let x = 7; x <= 28; x++) {
      const d = Math.min(x - 7, 28 - x, y - 6, 25 - y), alpha = d === 0 ? .4 : d === 1 ? .8 : 1
      image.data.set([...foreground.map((v, c) => Math.round(v * alpha + background[c] * (1 - alpha))), 255], (y * image.width + x) * 4)
    }
    const one = refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' }), two = refineImageSubject(image, mask, { bandPx: 2, strength: 'strong' })
    expect(at(one.pixels, 8, 15)).toEqual(at(image, 8, 15))
    expect(Math.abs(at(two.pixels, 7, 15)[3] - 102)).toBeLessThanOrEqual(3)
    expect(Math.abs(at(two.pixels, 8, 15)[3] - 204)).toBeLessThanOrEqual(3)
    for (const x of [7, 8]) for (let c = 0; c < 3; c++) expect(Math.abs(at(two.pixels, x, 15)[c] - foreground[c])).toBeLessThanOrEqual(2)
    expect(at(two.pixels, 10, 15)).toEqual(at(image, 10, 15))
    const hardBlue = fixture([18, 99, 210], [193, 177, 140], 1), unchanged = refineImageSubject(hardBlue.image, hardBlue.mask, { bandPx: 2, strength: 'strong' })
    expect(unchanged.metrics.alphaChangedPixels).toBe(0); expect(unchanged.metrics.rgbChangedPixels).toBe(0)
  })

  it('preserves true blue trim, hard opaque outlines, thin rods, enclosed holes and explicit foreground protection', () => {
    const { image, mask } = fixture([95, 83, 69], [126, 135, 143], 1)
    // A one-pixel real blue border cannot be explained as this interior/background mixture.
    for (let y = 8; y < 24; y++) image.data.set([12, 91, 217, 255], (y * image.width + 7) * 4)
    // An enclosed transparent hole and its surrounding contour must remain intact.
    for (let y = 13; y <= 16; y++) for (let x = 16; x <= 19; x++) { mask.data[y * mask.width + x] = 0; image.data.set([126, 135, 143, 255], (y * image.width + x) * 4) }
    const protection = box(7, 6, 22, 2), result = refineImageSubject(image, mask, { bandPx: 2, strength: 'strong', foregroundProtectionMask: protection })
    expect(result.metrics.protectedPixels).toBe(44)
    for (let y = 8; y < 24; y++) expect(at(result.pixels, 7, y)).toEqual(at(image, 7, y))
    for (let y = 12; y <= 17; y++) for (let x = 15; x <= 20; x++) {
      if (mask.data[y * mask.width + x]) expect(at(result.pixels, x, y)).toEqual(at(image, x, y))
      else expect(at(result.pixels, x, y)[3]).toBe(0)
    }
    for (let x = 7; x <= 28; x++) for (const y of [6, 7]) expect(at(result.pixels, x, y)).toEqual(at(image, x, y))
    const thin = fixture([25, 48, 73], [74, 123, 148])
    thin.mask.data.fill(0)
    for (let y = 5; y < 27; y++) for (let x = 16; x <= 18; x++) thin.mask.data[y * thin.mask.width + x] = 255
    const rods = refineImageSubject(thin.image, thin.mask, { bandPx: 2, strength: 'strong' })
    expect(rods.metrics.alphaChangedPixels).toBe(0); expect(rods.metrics.rgbChangedPixels).toBe(0)
    expect(rods.issues.some(issue => issue.reason === 'thin-feature')).toBe(true)
  })

  it('leaves weak, unstable and transparent outside evidence unresolved', () => {
    const same = fixture([100, 101, 103], [106, 106, 107]), low = refineImageSubject(same.image, same.mask, { bandPx: 1, strength: 'strong' })
    expect(low.metrics.estimatedPixels).toBe(0); expect(low.issues.some(issue => issue.reason === 'low-contrast')).toBe(true)
    for (const type of ['unstable', 'transparent'] as const) {
      const { image, mask } = fixture()
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!mask.data[y * mask.width + x]) image.data.set(type === 'transparent' ? [255, 0, 255, 0] : (x + y) % 2 ? [250, 0, 240, 255] : [0, 240, 0, 255], (y * image.width + x) * 4)
      const result = refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' })
      expect(result.metrics.estimatedPixels).toBe(0)
      expect(result.issues.some(issue => issue.reason === 'unstable-background')).toBe(true)
    }
  })

  it('has zero colour dependence on excluded and protected reference regions', () => {
    const a = fixture(), b = fixture(), excluded = box(0, 0, 36, 5), protectedMask = box(7, 10, 4, 10)
    for (let y = 0; y < a.image.height; y++) for (let x = 0; x < a.image.width; x++) if (y < 5 || x >= 7 && x < 11 && y >= 10 && y < 20) {
      a.image.data.set([255, 0, 255, 255], (y * a.image.width + x) * 4); b.image.data.set([0, 255, 0, 255], (y * b.image.width + x) * 4)
    }
    const options = { bandPx: 1 as const, strength: 'strong' as const, excludedEvidenceMask: excluded, foregroundProtectionMask: protectedMask }
    const left = refineImageSubject(a.image, a.mask, options), right = refineImageSubject(b.image, b.mask, options)
    expect(left.metrics).toEqual(right.metrics); expect(left.uncertaintyMask).toEqual(right.uncertaintyMask)
    for (let y = 0; y < a.image.height; y++) for (let x = 0; x < a.image.width; x++) if (!(y < 5 || x >= 7 && x < 11 && y >= 10 && y < 20)) expect(at(left.pixels, x, y)).toEqual(at(right.pixels, x, y))
  })

  it('preserves partial-alpha cores and translucent captured source and returns bounded original-coordinate issues', () => {
    const { image, mask } = fixture([25, 48, 73], [74, 123, 148], .55, true)
    mask.data[15 * mask.width + 16] = 123
    image.data[(6 * image.width + 17) * 4 + 3] = 90
    const result = refineImageSubject(image, mask, { bandPx: 2, strength: 'strong' })
    expect(at(result.pixels, 16, 15)).toEqual([...at(image, 16, 15).slice(0, 3), 123])
    expect(at(result.pixels, 17, 6)).toEqual([...at(image, 17, 6).slice(0, 3), Math.round(90 * 140 / 255)])
    expect(result.issues.length).toBeLessThanOrEqual(32)
    expect(result.issues.every(issue => issue.boundsPx.x >= 0 && issue.boundsPx.y >= 0 && issue.boundsPx.width <= 12 && issue.boundsPx.height <= 12)).toBe(true)
    expect(result.metrics).toMatchObject({ coreChangedPixels: 0, outsideSupportChangedPixels: 0, holeChangedPixels: 0, coverageIsEstimated: true, foregroundIsEstimated: true })
  })

  it('respects cropped absolute source coordinates and rejects malformed masks, options and cancellation', () => {
    const { image, mask } = fixture(), cropped = box(6, 5, 24, 22)
    for (let y = 0; y < cropped.height; y++) for (let x = 0; x < cropped.width; x++) cropped.data[y * cropped.width + x] = mask.data[(y + 5) * mask.width + x + 6]
    const result = refineImageSubject(image, cropped, { bandPx: 1, strength: 'strong' })
    expect(result.pixels.boundsPx).toEqual(cropped.boundsPx)
    expect(at(result.pixels, 1, 10)[3]).toBeLessThan(200)
    expect(() => refineImageSubject({ ...image, data: new Uint8ClampedArray(4) }, mask, { bandPx: 1, strength: 'strong' })).toThrow('完整原图')
    expect(() => refineImageSubject(image, { ...mask, data: new Uint8Array(1) }, { bandPx: 1, strength: 'strong' })).toThrow('选区')
    expect(() => refineImageSubject(image, mask, { bandPx: 3 as 1, strength: 'strong' })).toThrow('1或2')
    expect(() => refineImageSubject(image, mask, { bandPx: 1, strength: 'strong', excludedEvidenceMask: box(35, 30, 3, 3) })).toThrow('原图内')
    expect(() => refineImageSubject(image, mask, { bandPx: 1, strength: 'strong' }, { aborted: true })).toThrow('已取消')
  })

  it('produces identical selected pixels for a tight all-opaque box and a padded mask over the same source', () => {
    const { image, mask } = fixture(), tight = box(7, 6, 22, 20), options = { bandPx: 1 as const, strength: 'strong' as const }
    const padded = refineImageSubject(image, mask, options), cropped = refineImageSubject(image, tight, options)
    expect(cropped.metrics.alphaChangedPixels).toBeGreaterThan(40)
    for (let y = 0; y < tight.height; y++) for (let x = 0; x < tight.width; x++) expect(at(cropped.pixels, x, y)).toEqual(at(padded.pixels, x + tight.boundsPx.x, y + tight.boundsPx.y))
  })

  it('samples a narrow black outline along its tangent instead of borrowing the blue interior as foreground', () => {
    const { image, mask } = fixture([72, 113, 139], [104, 144, 164], 1), ink = [12, 20, 25], background = [104, 144, 164]
    for (let y = 6; y <= 25; y++) for (let x = 7; x <= 28; x++) {
      const d = Math.min(x - 7, 28 - x, y - 6, 25 - y)
      if (d < 2) image.data.set([...ink.map((v, c) => Math.round(d === 0 ? v * .55 + background[c] * .45 : v)), 255], (y * image.width + x) * 4)
    }
    const result = refineImageSubject(image, mask, { bandPx: 2, strength: 'strong' })
    expect(result.metrics.alphaChangedPixels).toBeGreaterThan(30)
    for (const [x, y] of [[7, 15], [18, 6], [28, 15], [18, 25]]) {
      expect(Math.abs(at(result.pixels, x, y)[3] - 140)).toBeLessThanOrEqual(3)
      for (let c = 0; c < 3; c++) expect(Math.abs(at(result.pixels, x, y)[c] - ink[c])).toBeLessThanOrEqual(2)
    }
    expect(at(result.pixels, 8, 15)).toEqual(at(image, 8, 15))
    expect(at(result.pixels, 11, 15)).toEqual(at(image, 11, 15))
  })
})
