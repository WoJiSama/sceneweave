import { describe, expect, it } from 'vitest'
import { guidedImageSelection, guidedSelectionSchema, type GuidedSelectionInput } from './guided-selection.js'
import type { ImagePixels } from './pixels.js'

function raster(width: number, height: number, pixel: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const stroke = (x: number, y: number, radiusPx = .5) => ({ points: [{ x: x + .5, y: y + .5 }], radiusPx })
function input(width: number, height: number, foreground = [stroke(8, 8)], background = [stroke(1, 1)]): GuidedSelectionInput {
  return { bounds: { x: 0, y: 0, width, height }, foreground, background }
}
function intersectionOverUnion(data: Uint8Array, width: number, truth: (x: number, y: number) => boolean): number {
  let intersection = 0, union = 0
  for (let index = 0; index < data.length; index++) {
    const expected = truth(index % width, Math.floor(index / width)), actual = data[index] >= 128
    if (expected && actual) intersection++
    if (expected || actual) union++
  }
  return intersection / union
}

describe('local foreground/background assisted source selection', () => {
  it('keeps opaque interior shades out of boundary alpha without changing old saved candidates or hard hints', () => {
    const width = 40, height = 26
    const source = raster(width, height, (x) => {
      const fraction = Math.max(0, Math.min(1, (x - 10) / 9))
      return [Math.round(35 + 140 * fraction), Math.round(45 + 80 * fraction), Math.round(65 + 30 * fraction), 255]
    })
    const options: GuidedSelectionInput = { ...input(width, height, [stroke(4, 13)], [stroke(32, 13)]), algorithmVersion: 2, edgeRadiusPx: 3 }
    const before = source.data.slice(), legacy = guidedImageSelection(source, options)
    const result = guidedImageSelection(source, { ...options, edgeCoverage: 'boundary' })
    const interiorFractionals = (data: Uint8Array) => {
      let count = 0
      for (let y = 1; y + 1 < height; y++) for (let x = 1; x + 1 < width; x++) {
        const at = y * width + x
        if (!data[at] || data[at] === 255) continue
        let zero = false
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!data[at + dy * width + dx]) zero = true
        if (!zero) count++
      }
      return count
    }
    expect(interiorFractionals(legacy.mask.data)).toBeGreaterThan(0)
    expect(interiorFractionals(result.mask.data)).toBe(0)
    expect(result.diagnostics.fractionalPixels).toBeGreaterThan(0)
    expect(result.mask.data[13 * width + 4]).toBe(255)
    expect(result.mask.data[13 * width + 32]).toBe(0)
    expect(source.data).toEqual(before)
    expect(guidedImageSelection(source, options)).toEqual(legacy)
    expect(guidedImageSelection(source, { ...options, edgeCoverage: 'boundary' })).toEqual(result)
    expect(() => guidedSelectionSchema.parse({ ...options, algorithmVersion: 1, edgeCoverage: 'boundary' })).toThrow('算法2')
  })

  it('optionally retains a narrow dark furniture outline when black room structures also belong to the background model', () => {
    const width = 50, height = 38
    const source = raster(width, height, (x, y) => {
      if (x >= 8 && x < 28 && y >= 7 && y < 29) return x >= 10 && x < 26 && y >= 9 && y < 27 ? [130, 145, 155, 255] : [25, 29, 32, 255]
      if (x >= 39 && x < 46 && y >= 6 && y < 32 || y === 18 && x >= 28 && x < 40) return [25, 29, 32, 255]
      return [160, 130, 105, 255]
    })
    const options: GuidedSelectionInput = { ...input(width, height, [stroke(18, 17, 1)], [stroke(2, 2), stroke(42, 18)]), algorithmVersion: 2, edgeRadiusPx: 0 }
    const original = guidedImageSelection(source, options), zero = guidedImageSelection(source, { ...options, outlineRadiusPx: 0 })
    expect(zero).toEqual(original)
    const retained = guidedImageSelection(source, { ...options, outlineRadiusPx: 2 })
    const outline = (data: Uint8Array) => data.reduce((total, alpha, pixel) => total + (alpha > 0 && source.data[pixel * 4] === 25 ? 1 : 0), 0)
    expect(outline(retained.mask.data)).toBeGreaterThan(outline(original.mask.data))
    expect(retained.mask.data[17 * width + 8]).toBe(255)
    expect(retained.mask.data[18 * width + 35]).toBe(0)
    expect(retained.mask.data[18 * width + 42]).toBe(0)
    expect(retained.uncertainMask.data[17 * width + 8]).toBe(255)
    expect(guidedImageSelection(source, { ...options, outlineRadiusPx: 2 })).toEqual(retained)
    expect(() => guidedImageSelection(source, { ...options, algorithmVersion: 1, outlineRadiusPx: 2 })).toThrow('算法2')
  })

  it('keeps missing-version replay byte-identical to explicit algorithm 1', () => {
    const source = raster(32, 20, (x) => x < 16 ? [155, 70, 30, 255] : [40, 90, 150, 255])
    const options = input(32, 20, [stroke(5, 10)], [stroke(25, 10)])
    const legacy = guidedImageSelection(source, options), explicit = guidedImageSelection(source, { ...options, algorithmVersion: 1 })
    expect(legacy.mask).toEqual(explicit.mask)
    expect(legacy.uncertainMask).toEqual(explicit.uncertainMask)
    expect(legacy.diagnostics).toEqual(explicit.diagnostics)
    expect(legacy.diagnostics.algorithmVersion).toBe(1)
  })

  it('warns when a coarse envelope truncates the selected body so a novice can widen the scope before refining', () => {
    const source = raster(30, 30, (x, y) => x >= 5 && x < 25 && y >= 5 && y < 25 ? [40, 55, 65, 255] : [150, 120, 90, 255])
    const result = guidedImageSelection(source, { ...input(30, 30, [stroke(15, 15)], [stroke(2, 2)]), algorithmVersion: 2,
      boundaryPx: [{ x: 8, y: 3 }, { x: 27, y: 3 }, { x: 27, y: 27 }, { x: 8, y: 27 }] })
    expect(result.diagnostics.touchesCoarseBoundary).toBe(true)
    expect(result.diagnostics.warnings.some(warning => warning.includes('粗轮廓上限'))).toBe(true)
  })
  it('selects a multicolour outlined object and its one-pixel branches while preserving a background hole', () => {
    const width = 48, height = 36
    const shape = (x: number, y: number) => x >= 10 && x < 34 && y >= 7 && y < 29 && !(x >= 18 && x < 25 && y >= 14 && y < 22)
      || y === 17 && x >= 6 && x < 10 || x === 27 && y >= 3 && y < 7
    const source = raster(width, height, (x, y) => shape(x, y) ? x < 22 ? [165, 54, 32, 255] : [47, 100, 56, 255] : [40, 85, 150, 255])
    const before = source.data.slice()
    const result = guidedImageSelection(source, input(width, height, [stroke(13, 11), stroke(29, 11)], [stroke(1, 1), stroke(21, 18)]))
    expect(intersectionOverUnion(result.mask.data, width, shape)).toBeGreaterThan(.98)
    expect(result.mask.data[18 * width + 21]).toBe(0)
    expect(result.mask.data[17 * width + 7]).toBe(255)
    expect(result.mask.data[4 * width + 27]).toBe(255)
    expect(source.data).toEqual(before)
    expect(result.diagnostics.foregroundSeedPixels).toBe(2)
    expect(result.diagnostics.backgroundSeedPixels).toBe(2)
    expect(result.diagnostics.touchesBounds).toBe(false)
  })

  it('uses intervening edges and spatial paths to reject a separate same-colour distractor', () => {
    const width = 50, height = 30
    const shape = (x: number, y: number) => x >= 6 && x < 20 && y >= 6 && y < 24
    const distractor = (x: number, y: number) => x >= 32 && x < 44 && y >= 6 && y < 24
    const source = raster(width, height, (x, y) => shape(x, y) || distractor(x, y) ? [155, 80, 38, 255] : [45, 95, 148, 255])
    const result = guidedImageSelection(source, input(width, height, [stroke(13, 15)], [stroke(26, 15), stroke(38, 15)]))
    expect(intersectionOverUnion(result.mask.data, width, shape)).toBeGreaterThan(.98)
    expect(result.mask.data[15 * width + 38]).toBe(0)
    expect(result.mask.data[15 * width + 13]).toBe(255)
  })

  it('keeps a dark hand-drawn outline and textured interior across a contrasting floor', () => {
    const width = 64, height = 48
    const shape = (x: number, y: number) => ((x - 32) / 18) ** 2 + ((y - 24) / 14) ** 2 <= 1
    const inner = (x: number, y: number) => ((x - 32) / 16) ** 2 + ((y - 24) / 12) ** 2 <= 1
    const source = raster(width, height, (x, y) => {
      const grain = (x * 7 + y * 3) % 9 - 4
      if (!shape(x, y)) return [50 + grain, 97 + grain, 155 + grain, 255]
      if (!inner(x, y)) return [23 + grain, 26 + grain, 24 + grain, 255]
      return x < 31 ? [170 + grain, 78 + grain, 37 + grain, 255] : [70 + grain, 125 + grain, 55 + grain, 255]
    })
    const options = input(width, height,
      [{ points: [{ x: 23.5, y: 24.5 }, { x: 39.5, y: 24.5 }], radiusPx: 1 }],
      [stroke(5, 5), stroke(57, 39)])
    const result = guidedImageSelection(source, options)
    expect(intersectionOverUnion(result.mask.data, width, shape)).toBeGreaterThan(.97)
    expect(result.mask.data[24 * width + 14]).toBe(255)
    expect(result.mask.data[10 * width + 32]).toBe(255)
  })

  it('algorithm 2 excludes a separate black wall without needing a precise contour or a background hint on the wall', () => {
    const width = 90, height = 64
    const shape = (x: number, y: number) => ((x - 31) / 16) ** 2 + ((y - 34) / 15) ** 2 <= 1
    const wall = (x: number, y: number) => x >= 55 && x < 86 && y >= 10 && y < 54
    const source = raster(width, height, (x, y) => shape(x, y) || wall(x, y) ? [24, 25, 27, 255]
      : Math.floor(x / 5) % 2 ? [170, 135, 93, 255] : [78, 109, 141, 255])
    const options = input(width, height, [stroke(31, 34)], [stroke(4, 3), stroke(7, 58)])
    const old = guidedImageSelection(source, options)
    const result = guidedImageSelection(source, { ...options, algorithmVersion: 2 })
    const oldIou = intersectionOverUnion(old.mask.data, width, shape), newIou = intersectionOverUnion(result.mask.data, width, shape)
    expect(newIou).toBeGreaterThan(.97)
    expect(newIou - oldIou).toBeGreaterThan(.4)
    expect(result.mask.data[32 * width + 75]).toBe(0)
    expect(result.diagnostics.algorithmVersion).toBe(2)
    expect(result.diagnostics.unseededComponentPixels).toBeGreaterThan(0)
    expect(result.uncertainMask.data[32 * width + 75]).toBe(255)
  })

  it('algorithm 2 retains two colours, an internal hole, thin stems, and a deliberately hinted disconnected detail', () => {
    const width = 48, height = 36
    const shape = (x: number, y: number) => x >= 10 && x < 34 && y >= 7 && y < 29 && !(x >= 18 && x < 25 && y >= 14 && y < 22)
      || y === 17 && x >= 6 && x < 10 || x === 27 && y >= 3 && y < 7 || x === 39 && y === 26
    const source = raster(width, height, (x, y) => shape(x, y) ? x < 22 ? [165, 54, 32, 255] : [47, 100, 56, 255] : [40, 85, 150, 255])
    const options = { ...input(width, height, [stroke(13, 11), stroke(29, 11), stroke(39, 26)], [stroke(1, 1), stroke(21, 18)]), algorithmVersion: 2 as const }
    const result = guidedImageSelection(source, options)
    expect(intersectionOverUnion(result.mask.data, width, shape)).toBeGreaterThan(.98)
    expect(result.mask.data[18 * width + 21]).toBe(0)
    expect(result.mask.data[17 * width + 7]).toBe(255)
    expect(result.mask.data[4 * width + 27]).toBe(255)
    expect(result.mask.data[26 * width + 39]).toBe(255)
  })

  it('algorithm 2 keeps source RGB, deterministic narrow-band antialiasing and honest uncertainty on a weak boundary', () => {
    const source = raster(30, 20, (x) => x < 10 ? [180, 40, 30, 255] : x === 10 ? [110, 60, 90, 255] : [40, 80, 150, 255])
    const before = source.data.slice(), options = { ...input(30, 20, [stroke(5, 10)], [stroke(20, 10)]), algorithmVersion: 2 as const }
    const result = guidedImageSelection(source, options), repeated = guidedImageSelection(source, options)
    expect(result.mask).toEqual(repeated.mask)
    expect(result.uncertainMask).toEqual(repeated.uncertainMask)
    expect(result.mask.data[10 * 30 + 9]).toBe(255)
    expect(result.mask.data[10 * 30 + 10]).toBeGreaterThan(110)
    expect(result.mask.data[10 * 30 + 10]).toBeLessThan(145)
    expect(result.mask.data[10 * 30 + 11]).toBe(0)
    expect(source.data).toEqual(before)
    const weak = raster(30, 20, () => [105, 105, 105, 255]), weakResult = guidedImageSelection(weak, options)
    expect(weakResult.diagnostics.uncertainPixels).toBeGreaterThan(550)
    expect(weakResult.mask.data[10 * 30 + 5]).toBe(255)
    expect(weakResult.mask.data[10 * 30 + 20]).toBe(0)
    expect(weakResult.diagnostics).not.toHaveProperty('passed')
  })

  it('uses a coarse concave envelope to stop connected same-colour environment lines while still discovering the interior shape', () => {
    const width = 70, height = 44
    const shape = (x: number, y: number) => x >= 12 && x < 32 && y >= 12 && y < 32 && !(x >= 18 && x < 25 && y >= 18 && y < 25)
      || x === 26 && y >= 8 && y < 12
    const environment = (x: number, y: number) => x >= 32 && x < 64 && y === 30 || x >= 55 && x < 64 && y >= 5 && y < 39
    const source = raster(width, height, (x, y) => shape(x, y) || environment(x, y) ? [25, 26, 28, 255] : [145, 102, 66, 255])
    const before = source.data.slice()
    const options: GuidedSelectionInput = { ...input(width, height, [stroke(15, 15)], [stroke(3, 3), stroke(21, 21)]), algorithmVersion: 2,
      boundaryPx: [{ x: 10, y: 6 }, { x: 35, y: 6 }, { x: 35, y: 26 }, { x: 32, y: 26 }, { x: 32, y: 35 }, { x: 10, y: 35 }] }
    const result = guidedImageSelection(source, options), repeated = guidedImageSelection(source, options)
    expect(intersectionOverUnion(result.mask.data, width, shape)).toBeGreaterThan(.98)
    expect(result.mask.data[30 * width + 40]).toBe(0)
    expect(result.mask.data[14 * width + 34]).toBe(0) // inside rough envelope, outside real shape
    expect(result.mask.data[21 * width + 21]).toBe(0) // actual internal hole
    expect(result.mask.data[9 * width + 26]).toBe(255) // one-pixel stem
    expect(result.mask).toEqual(repeated.mask)
    expect(result.uncertainMask).toEqual(repeated.uncertainMask)
    expect(result.diagnostics).toEqual(repeated.diagnostics)
    expect(source.data).toEqual(before)
  })

  it('rejects rough-envelope misuse and foreground outside it, while permitting background hints outside', () => {
    const source = raster(30, 20, () => [100, 80, 50, 255])
    const options: GuidedSelectionInput = { ...input(30, 20, [stroke(10, 10)], [stroke(1, 1)]), algorithmVersion: 2,
      boundaryPx: [{ x: 5, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 16 }, { x: 5, y: 16 }] }
    expect(() => guidedImageSelection(source, options)).not.toThrow()
    expect(() => guidedImageSelection(source, { ...options, foreground: [stroke(2, 10)] })).toThrow('粗范围外部')
    expect(() => guidedImageSelection(source, { ...options, foreground: [stroke(5, 10, 2)] })).toThrow('粗范围外部')
    expect(() => guidedSelectionSchema.parse({ ...options, algorithmVersion: undefined })).toThrow('只支持显式辅助算法2')
    expect(() => guidedSelectionSchema.parse({ ...options, algorithmVersion: 1 })).toThrow('只支持显式辅助算法2')
    expect(() => guidedSelectionSchema.parse({ ...options, boundaryPx: [{ x: -1, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 16 }] })).toThrow('顶点超出')
    expect(() => guidedSelectionSchema.parse({ ...options, boundaryPx: [{ x: 5, y: 5 }, { x: 20, y: 5 }] })).toThrow()
    expect(() => guidedImageSelection(source, { ...options, boundaryPx: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 15, y: 5 }] })).toThrow('没有覆盖')
    expect(() => guidedSelectionSchema.parse({ ...options, boundaryPx: Array.from({ length: 257 }, () => ({ x: 5, y: 5 })) })).toThrow()
  })

  it('keeps explicitly marked foreground and background, reports weak-boundary uncertainty instead of claiming quality', () => {
    const source = raster(32, 20, () => [105, 105, 105, 255])
    const options = input(32, 20, [stroke(8, 10)], [stroke(24, 10)])
    const result = guidedImageSelection(source, options)
    expect(result.mask.data[10 * 32 + 8]).toBe(255)
    expect(result.mask.data[10 * 32 + 24]).toBe(0)
    expect(result.diagnostics.uncertainPixels).toBeGreaterThan(600)
    expect(result.diagnostics.warnings.some(value => value.includes('缺少确定边界证据'))).toBe(true)
    expect(result.diagnostics).not.toHaveProperty('passed')
    expect(result.diagnostics).not.toHaveProperty('confidence')
  })

  it('estimates only a narrow mixed edge from local colour endpoints without global blur or erosion', () => {
    const source = raster(30, 20, (x) => x < 10 ? [180, 40, 30, 255] : x === 10 ? [110, 60, 90, 255] : [40, 80, 150, 255])
    const result = guidedImageSelection(source, input(30, 20, [stroke(5, 10)], [stroke(20, 10)]))
    expect(result.mask.data[10 * 30 + 5]).toBe(255)
    expect(result.mask.data[10 * 30 + 9]).toBe(255)
    expect(result.mask.data[10 * 30 + 10]).toBeGreaterThan(110)
    expect(result.mask.data[10 * 30 + 10]).toBeLessThan(145)
    expect(result.mask.data[10 * 30 + 11]).toBe(0)
    expect(result.diagnostics.fractionalPixels).toBeGreaterThan(0)
    expect(source.data[10 * 4]).toBe(110)
    const hard = guidedImageSelection(source, { ...input(30, 20, [stroke(5, 10)], [stroke(20, 10)]), edgeRadiusPx: 0 })
    expect(hard.diagnostics.fractionalPixels).toBe(0)
  })

  it('retains nonzero crop coordinates and produces deterministic, independent results', () => {
    const source = raster(32, 32, (x, y) => x >= 12 && x < 20 && y >= 12 && y < 20 ? [210, 40, 30, 255] : [30, 90, 160, 255])
    const options = { bounds: { x: 8, y: 8, width: 16, height: 16 }, foreground: [stroke(15, 15)], background: [stroke(9, 9)] }
    const before = JSON.stringify(options), first = guidedImageSelection(source, options), second = guidedImageSelection(source, options)
    expect(first.mask.boundsPx).toEqual(options.bounds)
    expect(first.mask.data[7 * 16 + 7]).toBe(255)
    expect(first.mask.data).toEqual(second.mask.data)
    expect(first.uncertainMask.data).toEqual(second.uncertainMask.data)
    expect(first.mask.data).not.toBe(second.mask.data)
    expect(JSON.stringify(options)).toBe(before)
  })

  it('excludes genuinely transparent source pixels and refuses transparent foreground hints', () => {
    const source = raster(20, 20, (x) => x < 10 ? [200, 20, 20, 255] : [200, 20, 20, 0])
    const result = guidedImageSelection(source, input(20, 20, [stroke(5, 5)], [stroke(15, 15)]))
    expect(result.mask.data[5 * 20 + 15]).toBe(0)
    expect(() => guidedImageSelection(source, input(20, 20, [stroke(15, 5)], [stroke(15, 15)]))).toThrow('完全透明')
  })

  it('rejects conflicting labels, empty/malformed/outside marks, unknown fields, and excessive local work', () => {
    const source = raster(32, 32, () => [10, 20, 30, 255]), options = input(32, 32)
    expect(() => guidedImageSelection(source, { ...options, foreground: [stroke(5, 5)], background: [stroke(5, 5)] })).toThrow('冲突')
    expect(() => guidedImageSelection(source, { ...options, foreground: [stroke(35, 5)] })).toThrow('超出')
    expect(() => guidedImageSelection(source, { ...options, foreground: [] })).toThrow()
    expect(() => guidedImageSelection(source, { ...options, foreground: [{ points: [{ x: NaN, y: 0 }], radiusPx: 1 }] })).toThrow()
    expect(() => guidedImageSelection(source, { ...options, bounds: { x: 0, y: 0, width: 33, height: 32 } })).toThrow('超出原图')
    expect(() => guidedSelectionSchema.parse({ ...options, tuning: 10 })).toThrow()
    expect(() => guidedSelectionSchema.parse({ ...options, bounds: { x: 0, y: 0, width: 501, height: 500 } })).toThrow('25万')
    const large = raster(256, 256, () => [10, 20, 30, 255])
    expect(() => guidedImageSelection(large, { ...input(256, 256), foreground: [{ points: Array.from({ length: 512 }, () => ({ x: 128, y: 128 })), radiusPx: 64 }] })).toThrow('预算')
    expect(() => guidedImageSelection({ ...source, data: new Uint8ClampedArray(1) }, options)).toThrow('完整RGBA')
  })
})
