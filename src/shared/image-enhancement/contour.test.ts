import { describe, expect, it } from 'vitest'
import type { ImagePixels } from '../image-import/pixels.js'
import { applyImageEnhancement, generateImageEnhancementCandidates } from './pixels.js'

function image(covered: (x: number, y: number) => number): ImagePixels {
  const width = 19, height = 19, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([20 + x, 40 + y, 90, covered(x, y)], (y * width + x) * 4)
  return { width, height, data }
}
const diagonal = () => image((x, y) => x >= 2 && y >= 2 && x <= 16 && y <= 16 && x + y >= 11 ? 255 : 0)
const alpha = (value: ImagePixels, x: number, y: number) => value.data[(y * value.width + x) * 4 + 3]
const recipe = { version: 1 as const, direction: 'contour' as const, strength: 'balanced' as const, scale: 1 as const }

describe('explicit supported binary contour coverage', () => {
  it('offers distinct estimates on diagonal steps while keeping RGB, support, solid core and input exact', () => {
    const source = diagonal(), before = source.data.slice()
    const candidates = generateImageEnhancementCandidates(source, { direction: 'contour', count: 3 })
    expect(candidates.map(candidate => alpha(candidate.pixels, 5, 6))).toEqual([224, 192, 160])
    expect(candidates.every(candidate => candidate.recipe.scale === 1 && candidate.metrics.alphaChangedPixels > 0 && !candidate.duplicateOf)).toBe(true)
    for (const candidate of candidates) {
      expect(alpha(candidate.pixels, 10, 10)).toBe(255)
      expect(applyImageEnhancement(source, candidate.recipe).data).toEqual(candidate.pixels.data)
      for (let index = 0; index < source.data.length; index += 4) {
        expect(candidate.pixels.data.slice(index, index + 3)).toEqual(source.data.slice(index, index + 3))
        expect(candidate.pixels.data[index + 3] > 0).toBe(source.data[index + 3] > 0)
      }
    }
    expect(source.data).toEqual(before)
  })

  it('does not infer smoothing for straight rectangles, thin rods, isolated tips or existing fractional coverage', () => {
    const rectangle = image((x, y) => x >= 3 && x <= 15 && y >= 3 && y <= 15 ? 255 : 0)
    const rods = image((x, y) => x === 9 || y === 9 || x === 2 && y === 2 ? 255 : 0)
    const diagonalRod = image((x, y) => Math.abs(x - y) <= 1 ? 255 : 0)
    for (const source of [rectangle, rods, diagonalRod]) expect(applyImageEnhancement(source, recipe).data).toEqual(source.data)
    const mixed = diagonal()
    mixed.data[(6 * mixed.width + 5) * 4 + 3] = 128
    mixed.data[(12 * mixed.width + 12) * 4 + 3] = 0
    const result = applyImageEnhancement(mixed, recipe)
    expect(alpha(result, 5, 6)).toBe(128)
    expect(alpha(result, 12, 12)).toBe(0)
    expect(alpha(result, 12, 11)).toBe(255)
    expect(alpha(result, 16, 16)).toBe(255)
  })

  it('keeps the unselected region exact and never publishes work after cancellation', () => {
    const source = diagonal(), scope = new Uint8Array(source.width * source.height)
    scope[6 * source.width + 5] = 255
    const before = source.data.slice(), result = applyImageEnhancement(source, recipe, scope)
    expect(alpha(result, 5, 6)).toBe(192)
    for (let index = 0; index < scope.length; index++) if (!scope[index]) expect(result.data.slice(index * 4, index * 4 + 4)).toEqual(before.slice(index * 4, index * 4 + 4))
    expect(() => applyImageEnhancement(source, recipe, undefined, { aborted: true })).toThrow('取消')
    expect(source.data).toEqual(before)
  })
})
