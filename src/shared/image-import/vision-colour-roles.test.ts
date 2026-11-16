import { describe, expect, it } from 'vitest'
import { proposeVisionColourRoles } from './vision-colour-roles.js'
import { guidedImageSelection } from './guided-selection.js'
import type { ImagePoint } from './calibration.js'
import type { ImagePixels, PixelBounds } from './pixels.js'

const bounds = { x: 0, y: 0, width: 64, height: 48 }
const boundary: ImagePoint[] = [{ x: 8, y: 6 }, { x: 54, y: 6 }, { x: 54, y: 42 }, { x: 8, y: 42 }]
const ink = [24, 29, 27, 255], red = [181, 55, 48, 255], gold = [221, 160, 61, 255], floor = [170, 160, 130, 255]
const subject = (x: number, y: number) => x >= 12 && x < 50 && y >= 10 && y < 38
const border = (x: number, y: number) => subject(x, y) && (x < 14 || x >= 48 || y < 12 || y >= 36)
function raster(width: number, height: number, pixel: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, data }
}
function fixture() {
  return raster(64, 48, (x, y) => border(x, y) || x >= 57 && x < 61 && y >= 18 && y < 32 ? ink : subject(x, y) ? x < 32 ? red : gold : floor)
}
const propose = (image = fixture(), area = bounds, polygon: readonly ImagePoint[] = boundary) => proposeVisionColourRoles(image, area, polygon)

describe('explicit polygon RGB role proposal v1', () => {
  it('proposes separate paint and ink roles on real pixels and preserves the whole object through unchanged graph-cut2', () => {
    const image = fixture(), before = image.data.slice(), proposal = propose(image)
    expect(proposal).toMatchObject({ algorithmId: 'polygon-rgb-roles', algorithmVersion: 1, diagnostics: { adopted: false, visualQualityPassed: false, manualGuidanceUsed: false, groundTruthRead: false } })
    expect(proposal.foreground.map(p => p.rgb)).toEqual(expect.arrayContaining([ink.slice(0, 3), red.slice(0, 3), gold.slice(0, 3)]))
    expect(proposal.foreground).toHaveLength(3)
    expect(proposal.background.length).toBeGreaterThan(0); expect(proposal.background.length).toBeLessThanOrEqual(4)
    expect(proposal.diagnostics.palette.length).toBeLessThanOrEqual(24)
    for (const stroke of [...proposal.guide.foreground, ...proposal.guide.background]) { expect(stroke.points).toHaveLength(1); expect(stroke.radiusPx).toBe(.5) }
    for (const sample of [...proposal.foreground, ...proposal.background]) {
      const pixel = (Math.floor(sample.point.y) * image.width + Math.floor(sample.point.x)) * 4
      expect(sample.rgb).toEqual([...image.data.slice(pixel, pixel + 3)])
    }
    const selected = guidedImageSelection(image, proposal.guide)
    let intersection = 0, union = 0, retainedInk = 0, inkCount = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const kept = selected.mask.data[y * image.width + x] >= 128, expected = subject(x, y)
      if (kept && expected) intersection++; if (kept || expected) union++
      if (border(x, y)) { inkCount++; if (kept) retainedInk++ }
    }
    expect(intersection / union).toBeGreaterThanOrEqual(.98)
    expect(retainedInk / inkCount).toBeGreaterThanOrEqual(.99)
    expect(selected.mask.data[24 * image.width + 58]).toBe(0)
    expect(image.data).toEqual(before)
    expect(propose(image)).toEqual(proposal)
  })

  it('captures input ownership and preserves exact source coordinates for an inset context and a native byte view', () => {
    const local = fixture(), offset = { x: 7, y: 9 }, image = raster(80, 70, () => floor)
    for (let y = 0; y < local.height; y++) image.data.set(local.data.subarray(y * local.width * 4, (y + 1) * local.width * 4), ((y + offset.y) * image.width + offset.x) * 4)
    const storage = new ArrayBuffer(image.data.length + 23), view = new Uint8ClampedArray(storage, 11, image.data.length); view.set(image.data)
    image.data = view
    const area = { ...bounds, ...offset }, polygon = boundary.map(p => ({ x: p.x + offset.x, y: p.y + offset.y }))
    const expected = propose(local), actual = propose(image, area, polygon)
    expect(actual.diagnostics).toEqual(expected.diagnostics)
    const shift = (samples: typeof expected.foreground) => samples.map(p => ({ ...p, point: { x: p.point.x + offset.x, y: p.point.y + offset.y } }))
    expect(actual.foreground).toEqual(shift(expected.foreground)); expect(actual.background).toEqual(shift(expected.background))
    const captured = structuredClone(actual)
    area.x = 0; polygon[0].x = 0; image.data.fill(0)
    expect(actual).toEqual(captured)
  })

  it('refuses flat color, transparent evidence, a full-context polygon and too little interior rather than inventing roles', () => {
    expect(() => propose(raster(64, 48, () => floor))).toThrow('内外颜色依据')
    expect(() => propose(raster(64, 48, () => [0, 0, 0, 0]))).toThrow('不透明原图像素')
    expect(() => propose(fixture(), bounds, [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 48 }, { x: 0, y: 48 }])).toThrow('外部')
    expect(() => propose(fixture(), bounds, [{ x: 20, y: 20 }, { x: 22, y: 20 }, { x: 20, y: 22 }])).toThrow('内部')
  })

  it.each([
    { x: -1, y: 0, width: 64, height: 48 }, { x: .5, y: 0, width: 64, height: 48 },
    { x: 0, y: 0, width: 0, height: 48 }, { x: 1, y: 0, width: 64, height: 48 },
  ])('refuses invalid integer source bounds %j', area => expect(() => propose(fixture(), area)).toThrow())

  it('checks source and context budgets before allocating or scanning pixels', () => {
    const image = raster(600, 500, () => floor)
    expect(() => propose(image, { x: 0, y: 0, width: 600, height: 500 })).toThrow('25万')
    expect(() => propose({ ...fixture(), width: 8193 })).toThrow()
    expect(() => propose({ ...fixture(), width: 8192, height: 8192 })).toThrow('3200万')
    expect(() => propose({ ...fixture(), data: new Uint8ClampedArray(4) })).toThrow('字节长度')
    expect(() => propose({ ...fixture(), data: new Uint8Array(64 * 48 * 4) as unknown as Uint8ClampedArray })).toThrow('原生Uint8ClampedArray')
    expect(() => propose({ ...fixture(), data: new Proxy(fixture().data, {}) })).toThrow('原生Uint8ClampedArray')
    if (typeof SharedArrayBuffer !== 'undefined') expect(() => propose({ ...fixture(), data: new Uint8ClampedArray(new SharedArrayBuffer(64 * 48 * 4)) })).toThrow('独立缓冲')
  })

  it('rejects JSON accessors, hidden/symbol fields and custom prototypes without invoking getters', () => {
    let reads = 0
    const unsafeBounds = Object.defineProperty({ ...bounds }, 'x', { enumerable: true, get() { reads++; return 0 } })
    const unsafeImage = Object.defineProperty({ ...fixture() }, 'width', { enumerable: true, get() { reads++; return 64 } })
    expect(() => propose(fixture(), unsafeBounds)).toThrow('访问器')
    expect(() => propose(unsafeImage)).toThrow('访问器')
    expect(reads).toBe(0)
    const hidden = Object.defineProperty({ ...bounds }, 'hidden', { value: 0 })
    expect(() => propose(fixture(), hidden)).toThrow('隐藏')
    expect(() => propose(fixture(), { ...bounds, [Symbol('extra')]: 1 })).toThrow('Symbol')
    expect(() => propose(fixture(), Object.assign(Object.create({}), bounds))).toThrow('普通JSON')
    expect(() => propose({ ...fixture(), extra: 1 } as ImagePixels)).toThrow('额外字段')
    expect(() => propose(fixture(), { ...bounds, extra: 1 } as PixelBounds)).toThrow()
  })

  it('refuses out-of-context, nonfinite, malformed and nonsimple polygons', () => {
    for (const polygon of [boundary.slice(0, 2), Array.from({ length: 257 }, (_, i) => ({ x: i % 64, y: i % 48 })),
      [{ x: -1, y: 0 }, ...boundary], [{ x: NaN, y: 1 }, ...boundary],
      [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }],
      [{ x: 10, y: 10 }, { x: 45, y: 35 }, { x: 10, y: 35 }, { x: 40, y: 10 }],
      [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 40, y: 30 }, { x: 10, y: 30 }],
    ]) expect(() => propose(fixture(), bounds, polygon)).toThrow()
    const point = Object.defineProperty({ x: 8, y: 6 }, 'x', { enumerable: true, get() { throw new Error('must not invoke') } })
    expect(() => propose(fixture(), bounds, [point, ...boundary.slice(1)])).toThrow('访问器')
  })
})
