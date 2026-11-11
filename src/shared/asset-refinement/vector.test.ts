import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeCanonicalSvgRasterizer, rasterizeCanonicalSvgPixels } from '../../platform/browser/ai/svg-raster.js'
import { normalizeStaticSvg } from '../ai/svg.js'
import { refineImageToVector, vectorRefinementOptionsSchema } from './vector.js'
import type { ImagePixels } from '../image-import/pixels.js'

beforeAll(async () => { await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm')))) })
const options = (changes = {}) => vectorRefinementOptionsSchema.parse(changes)
function image(width: number, height: number, color: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const rgba = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]

describe('shared-boundary vector reconstruction', () => {
  it('fits genuine quadratic curves within a conservative two-way source-grid error while preserving holes and the source', async () => {
    const source = image(72, 64, (x, y) => {
      const radius = Math.hypot(x - 35.5, y - 31.5)
      return radius < 27 && radius > 8 ? [40, 90, 150, 255] : [13, 99, 19, 0]
    })
    const before = source.data.slice(), result = refineImageToVector(source, options())
    expect(result.sourceSvg).toMatch(/\bQ\b/)
    expect(result.stats.quadraticCurveCount).toBeGreaterThan(4)
    expect(result.stats.pathCommandCount).toBeLessThan(result.stats.sourcePathCommandCount)
    expect(result.stats.maxCurveDeviationPx).toBeLessThanOrEqual(.45)
    expect(result.stats.ringCount).toBe(2)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 144, height: 128 })
    expect(rgba(raster.rgba, 144, 72, 64)[3]).toBe(0)
    expect(rgba(raster.rgba, 144, 72, 22)).toEqual([40, 90, 150, 255])
    expect(rgba(raster.rgba, 144, 2, 2)[3]).toBe(0)
    expect(source.data).toEqual(before)
    expect(refineImageToVector(source, options())).toEqual(result)
  })

  it.each([255, 128])('shares curved colour boundaries with no alpha cracks at uniform alpha %i', async alpha => {
    const source = image(64, 48, (x, y) => {
      if (x < 3 || x >= 61 || y < 3 || y >= 45) return [0, 0, 0, 0]
      const edge = 32 + Math.round(Math.sin(y / 7) * 9)
      return x < edge ? [25, 65, 130, alpha] : [160, 90, 35, alpha]
    })
    const result = refineImageToVector(source, options())
    expect(result.stats.sharedChainCount).toBeGreaterThan(0)
    expect(result.stats.quadraticCurveCount).toBeGreaterThan(0)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 128, height: 96 })
    for (let y = 8; y < 88; y++) for (let x = 8; x < 120; x++) expect(rgba(raster.rgba, 128, x, y)[3]).toBe(alpha)
  })

  it('retains true right-angle corners, one-pixel strokes and narrow holes instead of rounding or deleting them', async () => {
    const source = image(48, 40, (x, y) => {
      if (x === 2 && y >= 4 && y < 36) return [20, 20, 20, 255]
      if (x < 8 || x >= 44 || y < 4 || y >= 36 || x >= 24 && x < 26 && y >= 12 && y < 28) return [0, 0, 0, 0]
      return x < 20 ? [50, 90, 130, 255] : [170, 100, 40, 255]
    })
    const result = refineImageToVector(source, options({ curveTolerancePx: .49 }))
    expect(result.stats.protectedCornerCount).toBeGreaterThan(0)
    expect(result.stats.protectedRingCount).toBeGreaterThanOrEqual(2)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 96, height: 80 })
    for (let y = 0; y < 40; y++) for (let x = 0; x < 48; x++) {
      const original = rgba(source.data, 48, x, y)
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expect(rgba(raster.rgba, 96, x * 2 + dx, y * 2 + dy)).toEqual(original)
    }
  })

  it('keeps zero-tolerance geometry exact and accepts no unknown option or accessor', async () => {
    const source = image(24, 24, (x, y) => Math.hypot(x - 11.5, y - 11.5) < 9 ? [80, 110, 130, 255] : [0, 0, 0, 0])
    const result = refineImageToVector(source, options({ curveTolerancePx: 0 }))
    expect(result.stats.quadraticCurveCount).toBe(0)
    const raster = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: 24, height: 24 })
    expect(raster.rgba).toEqual(source.data)
    expect(() => refineImageToVector(source, { colors: 24, curveTolerancePx: .5 })).toThrow()
    expect(() => refineImageToVector(source, { ...options(), extra: true } as ReturnType<typeof options>)).toThrow()
    let accessed = false
    const unsafe = { colors: 24, get curveTolerancePx() { accessed = true; return .45 } }
    expect(() => refineImageToVector(source, unsafe)).toThrow('访问器')
    expect(accessed).toBe(false)
  })

  it('rejects unsupported inputs and actual trace budgets without discarding details, and honours cancellation', () => {
    const source = image(32, 32, () => [60, 70, 80, 255])
    expect(() => refineImageToVector({ ...source, data: source.data.subarray(4) }, options())).toThrow('完整RGBA')
    expect(() => refineImageToVector({ ...source, width: 8193 }, options())).toThrow('完整RGBA')
    expect(() => refineImageToVector(image(8, 8, () => [0, 0, 0, 0]), options())).toThrow('没有可见像素')
    const noisy = image(100, 100, (x, y) => (x + y) % 2 ? [20, 30, 40, 255] : [150, 160, 170, 255])
    expect(() => refineImageToVector(noisy, options())).toThrow('未丢弃细节')
    expect(() => refineImageToVector(source, options(), { aborted: true })).toThrow('取消')
    let checks = 0
    expect(() => refineImageToVector(source, options(), { get aborted() { return ++checks > 3 } })).toThrow('取消')
    expect(checks).toBeGreaterThan(3)
  })
})
