import { describe, expect, it } from 'vitest'
import type { ImagePixels } from '../image-import/pixels.js'
import { sha256Bytes } from '../project/binary.js'
import { applyImageEnhancement, generateImageEnhancementCandidates, parseImageEnhancementRecipe, type ImageEnhancementRecipe } from './index.js'

function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const recipe = (direction: ImageEnhancementRecipe['direction'], strength: ImageEnhancementRecipe['strength'] = 'balanced', scale: 1 | 2 = 1): ImageEnhancementRecipe => ({ version: 1, direction, strength, scale })
const pixelAt = (value: ImagePixels, x: number, y: number) => [...value.data.slice((y * value.width + x) * 4, (y * value.width + x) * 4 + 4)]
const luma = (pixel: number[]) => pixel[0] * .2126 + pixel[1] * .7152 + pixel[2] * .0722
const saturation = (pixel: number[]) => Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3))

function fringedImage(colour: readonly number[] = [40, 40, 40]): ImagePixels {
  return image(17, 17, (x, y) => {
    if (x < 2 || y < 2 || x > 14 || y > 14) return [230, 0, 200, 0]
    const edge = x < 4 || y < 4 || x > 12 || y > 12
    return edge ? [50, 75, 100, x === 2 || y === 2 || x === 14 || y === 14 ? 128 : 255] : [...colour, 255]
  })
}

describe('bounded image enhancement candidates', () => {
  it('keeps a constant original colour exact at 2x and identifies duplicate results instead of inventing texture', () => {
    const source = image(7, 5, () => [101, 91, 85, 255]), before = source.data.slice()
    const candidates = generateImageEnhancementCandidates(source, { direction: 'clarity', count: 3 })
    expect(candidates).toHaveLength(3)
    for (const candidate of candidates) {
      expect([candidate.pixels.width, candidate.pixels.height]).toEqual([14, 10])
      for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) expect(pixelAt(candidate.pixels, x, y)).toEqual([101, 91, 85, 255])
      expect(candidate.metrics.changedPixels).toBe(0)
    }
    expect(candidates[0].duplicateOf).toBeUndefined()
    expect(candidates[1].duplicateOf).toBe(candidates[0].id)
    expect(candidates[2].duplicateOf).toBe(candidates[0].id)
    expect(source.data).toEqual(before)
  })

  it('makes distinct alternatives from the same baseline and exactly replays each selected recipe', () => {
    const source = image(13, 11, (x, y) => x < 3 + y / 2 ? [25, 31, 35, 255] : [90 + x % 3 * 8, 110, 130, 255])
    const before = source.data.slice(), candidates = generateImageEnhancementCandidates(source, { direction: 'clarity', count: 3 })
    expect(new Set(candidates.map(value => value.id)).size).toBe(3)
    expect(candidates.every(value => !value.duplicateOf && value.metrics.changedPixels > 0)).toBe(true)
    for (const candidate of candidates) expect(applyImageEnhancement(source, candidate.recipe).data).toEqual(candidate.pixels.data)
    candidates[0].pixels.data.fill(0)
    expect(candidates[1].pixels.data.some(value => value > 0)).toBe(true)
    expect(source.data).toEqual(before)
  })

  it('prevents black-line ringing and ignores invisible background RGB during 2x interpolation', () => {
    const opaque = image(9, 9, (x, y) => x === y ? [10, 10, 10, 255] : [180, 180, 180, 255])
    const line = applyImageEnhancement(opaque, recipe('clarity', 'strong', 2))
    for (let index = 0; index < line.data.length; index += 4) {
      expect(line.data[index]).toBeGreaterThanOrEqual(10)
      expect(line.data[index]).toBeLessThanOrEqual(180)
      expect(line.data[index + 3]).toBe(255)
    }
    expect(pixelAt(line, 8, 8)[0]).toBeLessThan(110)
    const cutout = image(8, 6, x => x < 4 ? [25, 31, 35, 128] : [255, 0, 255, 0])
    const enlarged = applyImageEnhancement(cutout, recipe('clarity', 'balanced', 2))
    for (let y = 0; y < enlarged.height; y++) for (let x = 0; x < enlarged.width; x++) {
      const pixel = pixelAt(enlarged, x, y)
      if (pixel[3]) expect(pixel.slice(0, 3)).toEqual([25, 31, 35])
      expect(pixel[3]).toBeLessThanOrEqual(128)
    }
  })

  it('refines existing fractional edges without recolouring, filling holes or erasing opaque thin details', () => {
    const source = image(9, 7, (x, y) => [25 + x, 31 + y, 35, x === 2 ? 64 : x >= 3 && x <= 6 ? 255 : 0])
    source.data[(3 * source.width + 4) * 4 + 3] = 0
    source.data[(1 * source.width + 1) * 4 + 3] = 255
    const result = applyImageEnhancement(source, recipe('edge', 'strong'))
    expect(pixelAt(result, 2, 5)[3]).not.toBe(pixelAt(source, 2, 5)[3])
    for (let index = 0; index < source.data.length; index += 4) {
      expect(result.data.slice(index, index + 3)).toEqual(source.data.slice(index, index + 3))
      if (source.data[index + 3] === 0 || source.data[index + 3] === 255) expect(result.data[index + 3]).toBe(source.data[index + 3])
    }
  })

  it('reduces small colour noise but preserves dark one-pixel wood seams and alpha', () => {
    const source = image(11, 9, (x, y) => x === 5 ? [10, 10, 10, 255] : [100 + (x + y) % 2 * 12, 90, 80, 255])
    const result = applyImageEnhancement(source, recipe('denoise', 'strong'))
    expect(pixelAt(result, 3, 4)[0]).toBeLessThan(pixelAt(source, 3, 4)[0])
    expect(pixelAt(result, 3, 3)[0]).toBeGreaterThan(pixelAt(source, 3, 3)[0])
    for (let y = 0; y < 9; y++) expect(pixelAt(result, 5, y)).toEqual([10, 10, 10, 255])
    for (let index = 3; index < source.data.length; index += 4) expect(result.data[index]).toBe(source.data[index])
  })

  it('offers distinct explicit colour-fringe estimates while retaining alpha, luminance, core and original', () => {
    const source = fringedImage()
    source.data.set([5, 5, 5, 255], (4 * source.width + 8) * 4)
    const original = source.data.slice(), candidates = generateImageEnhancementCandidates(source, { direction: 'decontaminate', count: 3 })
    expect(candidates.every(candidate => candidate.recipe.scale === 1 && !candidate.duplicateOf)).toBe(true)
    const baseEdge = pixelAt(source, 2, 8)
    expect(saturation(pixelAt(candidates[0].pixels, 2, 8))).toBeLessThan(saturation(baseEdge))
    expect(saturation(pixelAt(candidates[2].pixels, 2, 8))).toBeLessThan(saturation(pixelAt(candidates[0].pixels, 2, 8)))
    for (const candidate of candidates) {
      expect(candidate.metrics.alphaChangedPixels).toBe(0)
      expect(applyImageEnhancement(source, candidate.recipe).data).toEqual(candidate.pixels.data)
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const originalPixel = pixelAt(source, x, y), result = pixelAt(candidate.pixels, x, y)
        expect(result[3]).toBe(originalPixel[3])
        expect(Math.abs(luma(result) - luma(originalPixel))).toBeLessThanOrEqual(.51)
        if (!originalPixel[3] || x >= 4 && x <= 12 && y >= 4 && y <= 12) expect(result).toEqual(originalPixel)
      }
    }
    expect(source.data).toEqual(original)
  })

  it('preserves genuinely blue and green materials, clear holes and thin details without stable inner evidence', () => {
    for (const colour of [[25, 90, 170], [25, 140, 65]]) {
      const source = image(17, 17, (x, y) => x >= 2 && x <= 14 && y >= 2 && y <= 14
        ? [...colour, x === 2 ? 128 : 255] : [0, 0, 0, 0])
      source.data.set([0, 0, 0, 0], (8 * source.width + 8) * 4)
      expect(applyImageEnhancement(source, recipe('decontaminate', 'strong')).data).toEqual(source.data)
    }
    const thin = image(17, 17, (x, y) => x === 8 || y === 8 ? [25, 90, 170, 255] : [0, 0, 0, 0])
    expect(applyImageEnhancement(thin, recipe('decontaminate', 'strong')).data).toEqual(thin.data)
    const opaque = image(17, 17, (x, y) => x < 2 || y < 2 || x > 14 || y > 14 ? [50, 75, 100, 255] : [40, 40, 40, 255])
    expect(applyImageEnhancement(opaque, recipe('decontaminate', 'strong')).data).toEqual(opaque.data)
    const ambiguous = fringedImage()
    for (let y = 4; y <= 12; y++) for (let x = 4; x <= 12; x++) ambiguous.data.set((x + y) % 2 ? [200, 50, 20, 255] : [20, 180, 180, 255], (y * 17 + x) * 4)
    expect(pixelAt(applyImageEnhancement(ambiguous, recipe('decontaminate', 'strong')), 2, 8)).toEqual(pixelAt(ambiguous, 2, 8))
  })

  it('preserves the fixed outputs of the three existing recipe directions', () => {
    const source = image(13, 11, (x, y) => x < 3 + y / 2 ? [25, 31, 35, x === 0 ? 0 : 128] : [90 + x % 3 * 8, 110, 130, 255])
    const frozen = {
      clarity: ['46e71f9ee24ab98cd74153b5b8cd4482987cde77cd950f56881e604cfd655720', '68a17f26083dc16067451e238c427a8aa1b4a4bcd35ba2dd5e36b843ff73b259'],
      edge: ['6e9ed726e8b0e662b1e3f61b95ef086971393fcc3972517afc504c92fb6e7983', '68a17f26083dc16067451e238c427a8aa1b4a4bcd35ba2dd5e36b843ff73b259'],
      denoise: ['891aae5d91572f631dc8f6f30f798072600fa0ddd30ca1dc6730b7345c1e0006', '290bd92d3af9d6348b9c11e6a2d2f11844a4b5afaabea506df8755c7c88eebdf'],
    }
    for (const direction of ['clarity', 'edge', 'denoise'] as const) for (const scale of [1, 2] as const) {
      const output = applyImageEnhancement(source, recipe(direction, 'balanced', scale)).data
      expect(sha256Bytes(new Uint8Array(output.buffer, output.byteOffset, output.byteLength))).toBe(frozen[direction][scale - 1])
    }
  })

  it.each(['clarity', 'edge', 'denoise', 'decontaminate', 'contour'] as const)('keeps every out-of-scope RGBA exact for %s, including hidden RGB and 2x output', direction => {
    const source = image(9, 7, (x, y) => [25 + x * 9, 31 + y * 8, 99, x === 2 ? 64 : x >= 3 ? 255 : 0])
    const scope = new Uint8Array(source.width * source.height)
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 5; x++) scope[y * source.width + x] = x === 2 ? 96 : 255
    const before = scope.slice()
    for (const scale of [1, 2] as const) {
      const result = applyImageEnhancement(source, recipe(direction, 'strong', scale), scope)
      for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
        const sx = Math.floor(x / scale), sy = Math.floor(y / scale)
        if (!scope[sy * source.width + sx]) expect(pixelAt(result, x, y)).toEqual(pixelAt(source, sx, sy))
      }
    }
    expect(scope).toEqual(before)
  })

  it('validates recipes without evaluating accessors and rejects malformed inputs, scopes and allocation budgets', () => {
    const source = image(4, 4, () => [10, 20, 30, 255]), before = source.data.slice(), getter = { called: false }
    expect(() => parseImageEnhancementRecipe({ ...recipe('clarity'), noise: true })).toThrow()
    expect(() => parseImageEnhancementRecipe({ ...recipe('clarity'), get strength() { getter.called = true; return 'gentle' } })).toThrow('访问器')
    expect(getter.called).toBe(false)
    expect(() => applyImageEnhancement({ ...source, data: new Uint8ClampedArray(0) }, recipe('clarity'))).toThrow('RGBA')
    expect(() => applyImageEnhancement(source, recipe('clarity'), new Uint8Array(15))).toThrow('选区')
    expect(() => applyImageEnhancement(source, recipe('clarity'), new Uint8Array(16))).toThrow('选区')
    expect(() => generateImageEnhancementCandidates(source, { direction: 'clarity', count: 4 as 3 })).toThrow('2或3')
    const large = { width: 1100, height: 1250, data: new Uint8ClampedArray(1100 * 1250 * 4) }
    expect(() => generateImageEnhancementCandidates(large, { direction: 'clarity', count: 3 })).toThrow('整组1600万')
    const wide = image(2049, 1, () => [10, 20, 30, 255])
    expect(() => generateImageEnhancementCandidates(wide, { direction: 'clarity', count: 2 })).toThrow('边长4096')
    expect(() => applyImageEnhancement(wide, recipe('clarity', 'balanced', 2))).toThrow('边长4096')
    expect(source.data).toEqual(before)
  })

  it('rejects pre-cancellation and stops at a bounded checkpoint without mutating source', () => {
    const source = image(40, 40, (x, y) => [x, y, 35, 255]), before = source.data.slice()
    expect(() => generateImageEnhancementCandidates(source, { direction: 'clarity', count: 2 }, { aborted: true })).toThrow('取消')
    let checks = 0
    const signal = { get aborted() { return ++checks > 5 } }
    expect(() => applyImageEnhancement(source, recipe('clarity', 'balanced', 2), undefined, signal)).toThrow('取消')
    expect(source.data).toEqual(before)
  })
})
