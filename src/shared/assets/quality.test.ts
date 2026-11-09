import { describe, expect, it } from 'vitest'
import type { RasterImage } from '../ports/resources.js'
import { assessAssetQuality, ASSET_QUALITY_POLICY, type AssetQualityContext } from './quality.js'

const prop = (widthMm = 1000, heightMm = 1000): AssetQualityContext => ({ kind: 'prop', widthMm, heightMm })
const material = (widthMm = 1000, heightMm = 1000): AssetQualityContext => ({ kind: 'material', widthMm, heightMm })
function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[] = () => [80, 120, 60, 255]): RasterImage {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, rgba }
}
const codes = (value: ReturnType<typeof assessAssetQuality>) => value.issues.map(issue => issue.code)

describe('actual raster quality screening', () => {
  it('blocks an exactly invisible image even if hidden RGB contains texture', () => {
    const pixels = image(128, 128, (x, y) => [x, y, (x * y) % 256, 0])
    const result = assessAssetQuality(pixels, prop())
    expect(result.status).toBe('blocked')
    expect(result.issues).toEqual([{ code: 'fully-transparent', severity: 'error', message: expect.stringContaining('完全透明') }])
    expect(result.metrics.contentBounds).toBeNull()
    expect(result.metrics.visiblePixels).toBe(0)
  })

  it('does not mistake one off-grid faint visible pixel for an empty image', () => {
    const pixels = image(257, 257, (x, y) => [200, 90, 50, x === 253 && y === 251 ? 1 : 0])
    const result = assessAssetQuality(pixels, prop())
    expect(result.status).toBe('review')
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
    expect(result.metrics.visiblePixels).toBe(1)
    expect(result.metrics.contentBounds).toEqual({ x: 253, y: 251, width: 1, height: 1 })
    expect(codes(result)).toEqual(expect.arrayContaining(['faint-content', 'small-visible-subject', 'large-transparent-padding']))
  })

  it('evaluates physical pixel density from actual dimensions and declared world size', () => {
    const pixels = image(256, 128)
    const enough = assessAssetQuality(pixels, material(2000, 1000))
    expect(enough.metrics.pixelsPerMeter).toEqual({ x: 128, y: 128, minimum: 128 })
    expect(enough.status).toBe('pass')
    const enlarged = assessAssetQuality(pixels, material(4000, 2000))
    expect(enlarged.metrics.pixelsPerMeter.minimum).toBe(64)
    expect(codes(enlarged)).toEqual(['low-resolution'])
    expect(enlarged.issues[0].severity).toBe('warning')
  })

  it('accepts flat materials without treating simple art or low entropy as bad', () => {
    const result = assessAssetQuality(image(256, 256, () => [255, 255, 255, 255]), material())
    expect(result.status).toBe('pass')
    expect(result.issues).toEqual([])
    expect(result.metrics.materialSeam).toEqual({ horizontal: 0, vertical: 0, horizontalLocalDifference: 0, verticalLocalDifference: 0 })
  })

  it('flags rectangle backgrounds only for props without cutting, masking or rewriting pixels', () => {
    const pixels = image(256, 256), before = pixels.rgba.slice()
    const result = assessAssetQuality(pixels, prop())
    expect(result.status).toBe('review')
    expect(codes(result)).toEqual(['opaque-prop-background'])
    expect(pixels.rgba).toEqual(before)
    expect(assessAssetQuality(pixels, material()).status).toBe('pass')
  })

  it('uses bounding-box padding rather than declaring every slender or scattered subject padded', () => {
    const padded = assessAssetQuality(image(256, 256, (x, y) => [90, 70, 50, x >= 96 && x < 160 && y >= 96 && y < 160 ? 255 : 0]), prop())
    expect(padded.metrics.contentBounds).toEqual({ x: 96, y: 96, width: 64, height: 64 })
    expect(padded.metrics.contentBoundsFraction).toBe(1 / 16)
    expect(codes(padded)).toEqual(['large-transparent-padding'])
    const diagonal = assessAssetQuality(image(256, 256, (x, y) => [90, 70, 50, x === y ? 255 : 0]), prop())
    expect(diagonal.metrics.visiblePixels).toBe(256)
    expect(codes(diagonal)).not.toContain('large-transparent-padding')
  })

  it('warns on partly transparent shapes cut across much of the outer frame', () => {
    const result = assessAssetQuality(image(256, 256, (x, y) => [100, 80, 40, x < 240 && y < 240 ? 255 : 0]), prop())
    expect(result.metrics.opaquePerimeterFraction).toBeGreaterThan(0.35)
    expect(codes(result)).toContain('possible-edge-clipping')
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
  })

  it('does not report semitransparent edge antialiasing as clipped opaque content', () => {
    const result = assessAssetQuality(image(256, 256, (x, y) => [100, 80, 40,
      x === 0 || y === 0 || x === 255 || y === 255 ? 1 : x >= 32 && x <= 223 && y >= 32 && y <= 223 ? 255 : 0]), prop())
    expect(result.metrics.opaquePerimeterFraction).toBe(0)
    expect(codes(result)).not.toContain('possible-edge-clipping')
  })

  it('warns about material transparency separately from legal translucent props', () => {
    const pixels = image(256, 256, () => [80, 100, 120, 128])
    expect(codes(assessAssetQuality(pixels, material()))).toEqual(['material-transparency'])
    expect(codes(assessAssetQuality(pixels, prop()))).not.toContain('material-transparency')
  })

  it('compares opposing material edges against the local texture change', () => {
    const gradient = image(256, 256, x => [x, x, x, 255])
    const result = assessAssetQuality(gradient, material())
    expect(codes(result)).toEqual(['possible-material-seam'])
    expect(result.metrics.materialSeam!.horizontal).toBe(0.75)
    expect(result.metrics.materialSeam!.horizontalLocalDifference).toBeCloseTo(0.75 / 255)
    const noisy = image(256, 256, (x, y) => (x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])
    expect(codes(assessAssetQuality(noisy, material()))).not.toContain('possible-material-seam')
  })

  it('ignores RGB hidden behind transparency in the seam estimate', () => {
    const pixels = image(256, 256, (x, y) => [x, y, x ^ y, 0])
    const result = assessAssetQuality(pixels, material())
    expect(result.metrics.materialSeam!.horizontal).toBe(0)
    expect(result.metrics.materialSeam!.vertical).toBe(0)
    expect(codes(result)).toEqual(['fully-transparent'])
  })

  it('returns deterministic owned and deeply frozen reports without freezing caller input', () => {
    const pixels = image(128, 128), context = prop(), result = assessAssetQuality(pixels, context)
    expect(assessAssetQuality(pixels, context)).toEqual(result)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.metrics.contentBounds)).toBe(true)
    expect(Object.isFrozen(result.issues[0])).toBe(true)
    expect(Object.isFrozen(result.context)).toBe(true)
    expect(Object.isFrozen(context)).toBe(false)
    context.widthMm = 9000; pixels.rgba.fill(0)
    expect(result.context.widthMm).toBe(1000)
    expect(result.metrics.visiblePixels).toBe(128 * 128)
    expect(result.policyId).toBe(ASSET_QUALITY_POLICY.id)
    expect(Object.isFrozen(ASSET_QUALITY_POLICY)).toBe(true)
  })

  it('rejects invalid raster dimensions, truncated RGBA and invalid calibration before screening', () => {
    for (const value of [{ width: 0, height: 1, rgba: new Uint8ClampedArray() }, { width: 128, height: 128, rgba: new Uint8ClampedArray(2) },
      { width: 8193, height: 1, rgba: new Uint8ClampedArray(8193 * 4) }, { width: 1, height: 1, rgba: new Uint8Array(4) }]) {
      expect(() => assessAssetQuality(value as RasterImage, prop())).toThrow(/RGBA/)
    }
    for (const context of [prop(0), prop(0.1), prop(1_000_001), { ...prop(), kind: 'unknown' }]) {
      expect(() => assessAssetQuality(image(1, 1), context as AssetQualityContext)).toThrow(/用途|毫米/)
    }
  })

  it('checks cancellation before work and during full alpha traversal', () => {
    const pixels = image(256, 256)
    expect(() => assessAssetQuality(pixels, prop(), { signal: { aborted: true } })).toThrow(/取消/)
    let checks = 0
    expect(() => assessAssetQuality(pixels, prop(), { signal: { get aborted() { return ++checks >= 3 } } })).toThrow(/取消/)
    expect(checks).toBe(3)
  })
})
