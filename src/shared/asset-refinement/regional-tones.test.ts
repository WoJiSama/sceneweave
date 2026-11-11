import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeCanonicalSvgRasterizer, rasterizeCanonicalSvgPixels } from '../../platform/browser/ai/svg-raster.js'
import { normalizeStaticSvg } from '../ai/svg.js'
import type { ImagePixels } from '../image-import/pixels.js'
import { refineImageRegionsToVector } from './regional-tones.js'
import { refineImageToVector, vectorRefinementOptionsSchema } from './vector.js'

beforeAll(async () => {
  await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm'))))
})

const options = vectorRefinementOptionsSchema.parse({ colors: 8, curveTolerancePx: .45 })
function image(width: number, height: number, colour: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4)
  return { width, height, data }
}

/** Analytic ramp with an observed thin mark, a two-pixel hole and a separate small part. */
function tonalPanel(alpha: number): ImagePixels {
  return image(96, 72, (x, y) => {
    if (x >= 86 && x < 90 && y >= 10 && y < 14) return [210, 70, 25, alpha]
    if (x < 8 || x >= 80 || y < 8 || y >= 64 || x >= 28 && x < 30 && y >= 28 && y < 44) return [0, 0, 0, 0]
    if (x === 48 && y >= 16 && y < 56) return [10, 11, 12, alpha]
    return [Math.round(45 + (x - 8) * 1.4), Math.round(70 + (x - 8) * .8), Math.round(95 + (x - 8) * .4), alpha]
  })
}

const rgba = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
async function canonicalPaintPixel(colour: string, alpha: number): Promise<number[]> {
  // Independent SVG paint reference accounts for the rasterizer's premultiplied RGB rounding.
  const source = normalizeStaticSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="${colour}" opacity="${alpha / 255}"/></svg>`)
  const rendered = await rasterizeCanonicalSvgPixels(source, { width: 4, height: 4 })
  return rgba(rendered.rgba, 4, 2, 2)
}
function rampRmse(source: ImagePixels, rendered: Uint8ClampedArray): number {
  let squared = 0, channels = 0
  // Exclude the analytic mark/hole and one pixel around boundaries, where curve coverage is being tested separately.
  for (let y = 10; y < 62; y++) for (let x = 10; x < 78; x++) {
    if (x >= 47 && x <= 49 && y >= 15 && y <= 56 || x >= 27 && x <= 30 && y >= 27 && y <= 44) continue
    const offset = (y * source.width + x) * 4
    for (let c = 0; c < 3; c++) { squared += (source.data[offset + c] - rendered[offset + c]) ** 2; channels++ }
  }
  return Math.sqrt(squared / channels)
}

describe('regional vector tones against an analytic source', () => {
  it.each([255, 128])('reconstructs a linear colour ramp more accurately than flat palette tracing at alpha %i', async alpha => {
    const source = tonalPanel(alpha), before = source.data.slice()
    const current = refineImageRegionsToVector(source, options), legacy = refineImageToVector(source, options)
    expect(current.sourceSvg).toContain('<linearGradient')
    expect(current.sourceSvg).not.toMatch(/<image\b|\bhref\s*=|<filter\b/)
    const dimensions = { width: source.width, height: source.height }
    const rendered = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(current.sourceSvg), dimensions)
    const old = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(legacy.sourceSvg), dimensions)
    const currentError = rampRmse(source, rendered.rgba), legacyError = rampRmse(source, old.rgba)
    expect(currentError, `regional ramp RMSE ${currentError}; legacy RMSE ${legacyError}`).toBeLessThanOrEqual(2)
    expect(currentError, `regional ramp RMSE ${currentError}; legacy RMSE ${legacyError}`).toBeLessThanOrEqual(legacyError * .7)
    const linePixel = await canonicalPaintPixel('#0a0b0c', alpha)
    expect(linePixel[3]).toBe(alpha)
    for (let y = 20; y < 52; y++) {
      expect(rgba(rendered.rgba, source.width, 48, y)).toEqual(linePixel)
      for (const x of [47, 49]) {
        const neighbor = rgba(rendered.rgba, source.width, x, y)
        expect(neighbor[3]).toBe(alpha)
        expect(Math.min(...neighbor.slice(0, 3))).toBeGreaterThan(40)
      }
    }
    for (let y = 30; y < 42; y++) for (const x of [28, 29]) expect(rgba(rendered.rgba, source.width, x, y)[3]).toBe(0)
    const smallPartPixel = await canonicalPaintPixel('#d24619', alpha)
    expect(smallPartPixel[3]).toBe(alpha)
    expect(rgba(rendered.rgba, source.width, 87, 11)).toEqual(smallPartPixel)
    expect(rgba(rendered.rgba, source.width, 84, 11)[3]).toBe(0)
    expect(rgba(rendered.rgba, source.width, 2, 2)[3]).toBe(0)
    expect(rgba(rendered.rgba, source.width, 40, 20)[3]).toBe(alpha)
    expect(source.data).toEqual(before)
    expect(refineImageRegionsToVector(source, options)).toEqual(current)
  })

  it.each([255, 128])('renders a uniform region without an empty gradient definition at alpha %i', async alpha => {
    const source = image(32, 24, () => [70, 100, 130, alpha]), result = refineImageRegionsToVector(source, options)
    expect(result.sourceSvg).not.toContain('<linearGradient')
    expect(result.sourceSvg).not.toMatch(/<defs\s*\/>|<defs>\s*<\/defs>/)
    const rendered = await rasterizeCanonicalSvgPixels(normalizeStaticSvg(result.sourceSvg), { width: source.width, height: source.height })
    const expected = await canonicalPaintPixel('#466482', alpha)
    expect(expected[3]).toBe(alpha)
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) expect(rgba(rendered.rgba, source.width, x, y)).toEqual(expected)
  })

  it('does not reinterpret unknown options or execute option accessors', () => {
    const source = tonalPanel(255)
    expect(() => refineImageRegionsToVector(source, { colors: 8, curveTolerancePx: .5 })).toThrow()
    expect(() => refineImageRegionsToVector(source, { ...options, extra: true } as typeof options)).toThrow()
    let accessed = false
    const unsafe = { colors: 8, get curveTolerancePx() { accessed = true; return .45 } }
    expect(() => refineImageRegionsToVector(source, unsafe)).toThrow('访问器')
    expect(accessed).toBe(false)
  })

  it('rejects unsupported source and actual disconnected-region budgets instead of deleting detail, and honours cancellation', () => {
    const source = tonalPanel(255)
    expect(() => refineImageRegionsToVector({ ...source, data: source.data.subarray(4) }, options)).toThrow('完整RGBA')
    expect(() => refineImageRegionsToVector({ ...source, width: 8193 }, options)).toThrow('完整RGBA')
    expect(() => refineImageRegionsToVector(image(8, 8, () => [0, 0, 0, 0]), options)).toThrow('没有可见像素')
    const disconnected = image(130, 130, (x, y) => (x + y) % 2 ? [20, 30, 40, 255] : [150, 160, 170, 255])
    expect(() => refineImageRegionsToVector(disconnected, options)).toThrow('16384，未丢弃细节')
    expect(() => refineImageRegionsToVector(source, options, { aborted: true })).toThrow('取消')
    let checks = 0
    expect(() => refineImageRegionsToVector(source, options, { get aborted() { return ++checks > 5 } })).toThrow('取消')
    expect(checks).toBeGreaterThan(5)
  })
})
