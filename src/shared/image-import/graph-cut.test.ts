import { describe, expect, it } from 'vitest'
import { cutImageGrid } from './graph-cut.js'

/** Exhaustive enumeration is independent of the flow implementation. */
function energy(bits: number, width: number, height: number, foreground: Float64Array, background: Float64Array,
  horizontal: Float64Array, vertical: Float64Array, seeds: Int8Array): number {
  let total = 0
  for (let pixel = 0; pixel < width * height; pixel++) {
    const selected = !!(bits & 1 << pixel)
    if (seeds[pixel] === 1 && !selected || seeds[pixel] === -1 && selected) return Infinity
    total += selected ? foreground[pixel] : background[pixel]
    if (pixel % width + 1 < width && selected !== !!(bits & 1 << (pixel + 1))) total += horizontal[pixel]
    if (pixel + width < width * height && selected !== !!(bits & 1 << (pixel + width))) total += vertical[pixel]
  }
  return total
}

describe('finite source-grid minimum cut', () => {
  it('finds the true global minimum with hard hints across independent small exhaustive graphs', () => {
    for (let trial = 1; trial <= 20; trial++) {
      const width = 3, height = 3, size = width * height
      const foreground = Float64Array.from({ length: size }, (_, index) => ((index * 23 + trial * 13) % 29) / 7)
      const background = Float64Array.from({ length: size }, (_, index) => ((index * 17 + trial * 7) % 31) / 9)
      const horizontal = Float64Array.from({ length: size }, (_, index) => ((index * 11 + trial * 19) % 23) / 13)
      const vertical = Float64Array.from({ length: size }, (_, index) => ((index * 7 + trial * 5) % 19) / 11)
      const seeds = new Int8Array(size); seeds[trial % size] = 1; seeds[(trial + 4) % size] = -1
      const cut = cutImageGrid(width, height, foreground, background, horizontal, vertical, seeds)
      let bits = 0, minimum = Infinity
      for (let index = 0; index < size; index++) if (cut[index]) bits |= 1 << index
      for (let candidate = 0; candidate < 1 << size; candidate++) minimum = Math.min(minimum, energy(candidate, width, height, foreground, background, horizontal, vertical, seeds))
      expect(energy(bits, width, height, foreground, background, horizontal, vertical, seeds)).toBeCloseTo(minimum, 8)
    }
  })

  it('keeps hard labels against every finite unary and neighbour preference', () => {
    const foreground = new Float64Array([100, 0]), background = new Float64Array([0, 100]), weights = new Float64Array([100, 100])
    expect(cutImageGrid(2, 1, foreground, background, weights, weights, new Int8Array([1, -1]))).toEqual(new Uint8Array([255, 0]))
    expect(() => cutImageGrid(2, 1, new Float64Array([NaN, 0]), background, weights, weights, new Int8Array([1, -1]))).toThrow('无效')
  })
})
