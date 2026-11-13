import { describe, expect, it } from 'vitest'
import { repairGuidedImageSurface, type ImageSurfaceStructureGuide } from './guided-surface-repair.js'
import { prepareOriginalSurfaceStroke, rasterOriginalSurfaceStroke } from './guided-original-stroke.js'
import { imageSurfaceGuidanceSchema } from './surfaces.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
const image = (): ImagePixels => {
  const data = new Uint8ClampedArray(100 * 80 * 4)
  for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) data.set([145, 119, 91, 255], (y * 100 + x) * 4)
  // 32 distinct source columns, including gentle displacement and a real gap.
  for (let x = 4; x < 36; x++) {
    const centre = 11 + (x >= 14 && x < 22 ? 1 : 0)
    if (x === 25 || x === 26) continue
    data.set([70 + x % 5, 59, 44, 255], (centre * 100 + x) * 4)
    data.set([120, 100, 74, 255], ((centre + 1) * 100 + x) * 4)
  }
  return { width: 100, height: 80, data }
}
const guide: ImageSurfaceStructureGuide = { points: [{ x: 42, y: 43 }, { x: 66, y: 43 }], reference: { x: 4, y: 6, width: 32, height: 13 }, axis: 'horizontal', stroke: 'original-segment', reason: '保持原尺寸二维接缝，目标连续性仍为人工推断。' }
const removal = box(43, 35, 22, 18), options = { pattern: 'soft' as const, orientation: 'soft' as const, surfaceMask: box(0, 0, 100, 80), guides: [guide] }, donor = { x: 4, y: 22, width: 20, height: 10 }
const rgba = (im: ImagePixels, x: number, y: number) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)]

describe('finite original surface strokes', () => {
  it('separates a two-sided paper slope from the finite original stroke and preserves native gaps', () => {
    const input = image(), bounds = { x: 4, y: 6, width: 32, height: 13 }
    for (let u = 0; u < bounds.width; u++) for (let v = 0; v < bounds.height; v++) {
      const depth = u === 17 || u === 18 ? 0 : v === 5 + Number(u >= 10 && u < 18) ? 60 : 0
      input.data.set([170 - v * 3 - depth, 145 - v * 2 - depth, 115 - v - depth, 255], ((v + 6) * 100 + u + 4) * 4)
    }
    const before = input.data.slice(), legacy = prepareOriginalSurfaceStroke(input, bounds, 'horizontal', () => {})
    const sided = prepareOriginalSurfaceStroke(input, bounds, 'horizontal', () => {}, 'two-sided')
    for (let u = 0; u < bounds.width; u++) for (let v = 0; v < bounds.height; v++) for (let c = 0; c < 3; c++) {
      const expected = u !== 17 && u !== 18 && v === 5 + Number(u >= 10 && u < 18) ? 60 : 0
      expect(sided.ink[(u * bounds.height + v) * 3 + c]).toBeCloseTo(expected, 4)
    }
    expect(legacy.ink[(17 * 13 + 10) * 3]).toBeGreaterThan(15)
    expect(sided.ink[(17 * 13 + 10) * 3]).toBe(0)
    expect(prepareOriginalSurfaceStroke(input, bounds, 'horizontal', () => {})).toEqual(legacy)
    const transposed: ImagePixels = { width: 80, height: 100, data: new Uint8ClampedArray(input.data.length) }
    for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) transposed.data.set(input.data.subarray((y * 100 + x) * 4, (y * 100 + x + 1) * 4), (x * 80 + y) * 4)
    expect(prepareOriginalSurfaceStroke(transposed, { x: 6, y: 4, width: 13, height: 32 }, 'vertical', () => {}, 'two-sided').ink).toEqual(sided.ink)
    expect(input.data).toEqual(before)
  })

  it('requires explicit native strokes and enough side paper; invalid requests do not return a partial solve', () => {
    const sided = { ...guide, paper: 'two-sided' as const }, input = image(), before = input.data.slice()
    expect(imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [sided] }).guides[0].paper).toBe('two-sided')
    expect(() => imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [{ ...sided, stroke: undefined }] })).toThrow('两侧底色')
    expect(() => imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [{ ...sided, reference: { ...guide.reference, height: 8 } }] })).toThrow('至少9px')
    expect(() => repairGuidedImageSurface(input, removal, donor, { ...options, guides: [{ ...sided, stroke: undefined }] })).toThrow('两侧底色')
    expect(() => prepareOriginalSurfaceStroke(input, { ...guide.reference, height: 8 }, 'horizontal', () => {}, 'two-sided')).toThrow('至少9px')
    let checks = 0
    prepareOriginalSurfaceStroke(input, guide.reference, 'horizontal', () => { checks++ })
    let cancelled = 0
    expect(() => prepareOriginalSurfaceStroke(input, guide.reference, 'horizontal', () => { if (++cancelled > checks) throw new Error('side paper cancelled') }, 'two-sided')).toThrow('side paper cancelled')
    expect(input.data).toEqual(before)
  })

  it('preserves original column variation and gaps instead of extruding a single profile; reversing the path is equivalent', () => {
    const input = image(), before = input.data.slice(), native = repairGuidedImageSurface(input, removal, donor, options)
    const { stroke: _native, ...oldGuide } = guide
    const profile = repairGuidedImageSurface(input, removal, donor, { ...options, guides: [oldGuide] })
    expect(native.data).not.toEqual(profile.data)
    expect(repairGuidedImageSurface(input, removal, donor, { ...options, guides: [{ ...guide, points: [...guide.points].reverse() }] })).toEqual(native)
    const peaks: number[] = [], depths: number[] = []
    for (let x = 43; x < 65; x++) {
      const values = Array.from({ length: 7 }, (_, dy) => rgba(native, x, 40 + dy)[0])
      peaks.push(values.indexOf(Math.min(...values))); depths.push(145 - Math.min(...values))
    }
    expect(new Set(peaks).size).toBeGreaterThan(1)
    expect(depths.some(v => v < 8)).toBe(true)
    expect(depths.some(v => v > 50)).toBe(true)
    for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) if (x < 43 || x >= 65 || y < 35 || y >= 53) expect(rgba(native, x, y)).toEqual(rgba(input, x, y))
    expect(input.data).toEqual(before)
    expect(imageSurfaceGuidanceSchema.parse({ orientation: 'soft', guides: [guide] }).guides[0].stroke).toBe('original-segment')
  })

  it('does not inspect hidden, protected or inferred side RGB and preserves protected pixels', () => {
    const a = image(), b = image(), protectionMask = box(47, 40, 2, 5), priorInference = new Uint8Array(8000)
    priorInference[43 * 100 + 42] = 1
    for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) if (x >= 43 && x < 65 && y >= 35 && y < 53 || priorInference[y * 100 + x]) {
      a.data.set([255, 0, 255, 255], (y * 100 + x) * 4); b.data.set([0, 255, 0, 255], (y * 100 + x) * 4)
    }
    for (const paper of [undefined, 'two-sided'] as const) {
      const extra = { ...options, guides: [{ ...guide, ...(paper ? { paper } : {}) }], protectionMask, priorInference }
      const left = repairGuidedImageSurface(a, removal, donor, extra), right = repairGuidedImageSurface(b, removal, donor, extra)
      for (let y = 35; y < 53; y++) for (let x = 43; x < 65; x++) {
        if (x >= 47 && x < 49 && y >= 40 && y < 45) expect(rgba(left, x, y)).toEqual(rgba(a, x, y))
        else expect(rgba(left, x, y)).toEqual(rgba(right, x, y))
      }
    }
  })

  it('is symmetric for vertical references and bounds work, refuses a short source or folded path atomically', () => {
    const input = image(), ref = prepareOriginalSurfaceStroke(input, guide.reference, 'horizontal', () => {}), bounds = removal.boundsPx
    const transposed: ImagePixels = { width: 80, height: 100, data: new Uint8ClampedArray(input.data.length) }
    for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) transposed.data.set(input.data.subarray((y * 100 + x) * 4, (y * 100 + x + 1) * 4), (x * 80 + y) * 4)
    const vertical = prepareOriginalSurfaceStroke(transposed, { x: 6, y: 4, width: 13, height: 32 }, 'vertical', () => {})
    expect(vertical.ink).toEqual(ref.ink)
    const horizontalInk = new Float32Array(removal.width * removal.height * 3), verticalInk = new Float32Array(horizontalInk.length)
    let work = 0
    const writable = (x: number, y: number) => x >= 43 && x < 65 && y >= 35 && y < 53
    rasterOriginalSurfaceStroke(ref, guide.points, bounds, writable, () => undefined, horizontalInk, n => { work += n }, () => {})
    rasterOriginalSurfaceStroke(vertical, guide.points.map(p => ({ x: p.y, y: p.x })), { x: 35, y: 43, width: 18, height: 22 }, (x, y) => writable(y, x), () => undefined, verticalInk, () => {}, () => {})
    for (let y = 0; y < 18; y++) for (let x = 0; x < 22; x++) for (let c = 0; c < 3; c++) expect(horizontalInk[(y * 22 + x) * 3 + c]).toBe(verticalInk[(x * 18 + y) * 3 + c])
    expect(work).toBeLessThan(10000)
    const before = input.data.slice()
    expect(() => repairGuidedImageSurface(input, box(40, 30, 40, 25), donor, { ...options, guides: [{ ...guide, points: [{ x: 40, y: 43 }, { x: 80, y: 43 }] }] })).toThrow(/超过可信原参考/)
    expect(() => repairGuidedImageSurface(input, removal, donor, { ...options, guides: [{ ...guide, points: [{ x: 42, y: 43 }, { x: 65, y: 43 }, { x: 60, y: 44 }] }] })).toThrow(/单调/)
    expect(input.data).toEqual(before)
  })

  it('registers the source endpoints against original joint observations rather than keeping a displaced source centre', () => {
    const input = image(), reference = prepareOriginalSurfaceStroke(input, { x: 14, y: 6, width: 8, height: 13 }, 'horizontal', () => {})
    const bounds = { x: 42, y: 35, width: 8, height: 18 }, ink = new Float32Array(8 * 18 * 3)
    const writable = (x: number, y: number) => x >= 42 && x < 50 && y >= 35 && y < 53
    // Visible endpoints are two pixels below the manually sketched path.
    rasterOriginalSurfaceStroke(reference, [{ x: 40, y: 43 }, { x: 51, y: 43 }], bounds, writable,
      (x, y, c) => x >= 39 && x < 42 || x >= 50 && x <= 52 ? y === 45 ? [74, 60, 45][c] : 0 : undefined,
      ink, () => {}, () => {})
    for (const x of [0, 7]) {
      const values = Array.from({ length: 18 }, (_, y) => ink[(y * 8 + x) * 3])
      expect(values.indexOf(Math.max(...values)) + 35).toBe(45)
    }
  })
})
