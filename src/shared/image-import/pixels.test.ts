import { describe, expect, it } from 'vitest'
import { cropImageRegion, extractImageLayer, suggestImageRegion, type ImagePixels } from './pixels.js'

function image(width: number, height: number, pixel: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const box = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y },
  { x: x + width, y: y + height }, { x, y: y + height }]
const rgba = (input: ImagePixels, x: number, y: number) => [...input.data.subarray((y * input.width + x) * 4, (y * input.width + x) * 4 + 4)]

describe('image layer extraction and local texture completion', () => {
  it('crops a room for vector reconstruction while preserving its offset, alpha and source pixels', () => {
    const source = image(8, 6, (x, y) => [x * 20, y * 30, 80, 200]), before = source.data.slice()
    const region = cropImageRegion(source, [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 2, y: 5 }])
    expect(region.boundsPx).toEqual({ x: 2, y: 1, width: 4, height: 4 })
    expect(rgba(region, 0, 0)).toEqual(rgba(source, 2, 1))
    expect(rgba(region, 3, 3)[3]).toBe(0)
    expect(rgba(region, 3, 0)[3]).toBeGreaterThan(0)
    expect(rgba(region, 3, 0)[3]).toBeLessThan(200)
    expect(source.data).toEqual(before)
  })
  it('extracts independent RGBA and changes only the polygon while tiling the explicit donor with world-aligned phase', () => {
    const source = image(8, 5, (x, y) => [x * 20, y * 20, x + y, 255])
    const original = source.data.slice()
    const result = extractImageLayer(source, box(3, 1, 3, 3), { x: 0, y: 0, width: 2, height: 2 })
    expect(result.layer.boundsPx).toEqual({ x: 3, y: 1, width: 3, height: 3 })
    expect(rgba(result.layer, 0, 0)).toEqual(rgba(source, 3, 1))
    expect(rgba(result.remaining, 3, 1)).toEqual(rgba(source, 1, 1))
    expect(rgba(result.remaining, 5, 3)).toEqual(rgba(source, 1, 1))
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (x < 3 || x >= 6 || y < 1 || y >= 4) expect(rgba(result.remaining, x, y)).toEqual(rgba(source, x, y))
    }
    expect(source.data).toEqual(original)
    result.layer.data.fill(0)
    expect(source.data).toEqual(original)
  })

  it('keeps concave cutout pixels transparent and antialiases diagonal boundary pixels', () => {
    const source = image(6, 6, () => [120, 80, 40, 200])
    const triangle = extractImageLayer(source, [{ x: 2, y: 1 }, { x: 5, y: 1 }, { x: 2, y: 4 }], { x: 0, y: 0, width: 1, height: 1 })
    expect(rgba(triangle.layer, 2, 2)).toEqual([0, 0, 0, 0])
    expect(rgba(triangle.layer, 0, 0)[3]).toBe(200)
    expect(rgba(triangle.layer, 2, 0)[3]).toBeGreaterThan(0)
    expect(rgba(triangle.layer, 2, 0)[3]).toBeLessThan(200)
    const concave = extractImageLayer(source, [{ x: 2, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 },
      { x: 3, y: 2 }, { x: 3, y: 4 }, { x: 2, y: 4 }], { x: 0, y: 0, width: 1, height: 1 })
    expect(rgba(concave.layer, 2, 2)).toEqual([0, 0, 0, 0])
    expect(rgba(concave.remaining, 4, 3)).toEqual(rgba(source, 4, 3))
  })

  it('processes piano then rug from the remaining image so the rug contains the reconstructed lower texture', () => {
    const wood = [90, 60, 30, 255], rug = [40, 100, 130, 255], piano = [15, 20, 25, 255]
    const source = image(8, 6, (x, y) => x >= 2 && x < 7 && y >= 1 && y < 5 ? (x >= 4 && x < 6 && y >= 2 && y < 4 ? piano : rug) : wood)
    const pianoLayer = extractImageLayer(source, box(4, 2, 2, 2), { x: 2, y: 1, width: 2, height: 2 })
    expect(rgba(pianoLayer.remaining, 4, 2)).toEqual(rug)
    const rugLayer = extractImageLayer(pianoLayer.remaining, box(2, 1, 5, 4), { x: 0, y: 0, width: 2, height: 6 })
    expect(rgba(rugLayer.layer, 2, 1)).toEqual(rug)
    expect(rgba(rugLayer.remaining, 4, 2)).toEqual(wood)
    expect(rgba(pianoLayer.layer, 0, 0)).toEqual(piano)
  })

  it('repairs an object across two materials and an explicit shadow halo without expanding the extracted item', () => {
    const blue = [50, 100, 130, 255], wood = [130, 95, 60, 255]
    const source = image(24, 14, (x, y) => x >= 7 && x < 17 && y >= 4 && y < 10 ? [10, 10, 10, 255] : x < 12 ? blue : wood)
    const before = source.data.slice()
    const result = extractImageLayer(source, box(8, 5, 8, 4), { x: 2, y: 2, width: 3, height: 9 }, {
      repair: 'seamless', cleanupPx: 1,
      fills: [{ polygon: box(12, 0, 12, 14), donor: { x: 20, y: 2, width: 3, height: 9 } }],
    })
    expect(result.layer.boundsPx).toEqual({ x: 8, y: 5, width: 8, height: 4 })
    expect(result.repairMask.boundsPx).toEqual({ x: 7, y: 4, width: 10, height: 6 })
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      expect(rgba(result.remaining, x, y)).toEqual(x < 12 ? blue : wood)
    }
    expect(source.data).toEqual(before)
    expect(() => extractImageLayer(source, box(8, 5, 8, 4), { x: 7, y: 4, width: 1, height: 1 }, { cleanupPx: 1 })).toThrow('残影')
  })

  it('rejects overlapping or out-of-image donors, malformed RGBA and empty selections before producing a result', () => {
    const source = image(6, 6, () => [1, 2, 3, 255])
    expect(() => extractImageLayer(source, box(2, 2, 2, 2), { x: 3, y: 3, width: 2, height: 2 })).toThrow('重叠')
    expect(() => extractImageLayer(source, box(2, 2, 2, 2), { x: 0, y: 0, width: 7, height: 1 })).toThrow('取样范围')
    expect(() => extractImageLayer({ ...source, data: new Uint8ClampedArray(4) }, box(2, 2, 2, 2), { x: 0, y: 0, width: 1, height: 1 })).toThrow('完整RGBA')
    expect(() => extractImageLayer(source, box(7, 0, 1, 1), { x: 0, y: 0, width: 1, height: 1 })).toThrow('超出原图')
    expect(() => extractImageLayer(source, box(2, 2, 0, 0), { x: 0, y: 0, width: 1, height: 1 })).toThrow('面积')
  })
})

describe('seed-color region suggestions', () => {
  it('finds only the four-connected same-color region and reports its exact grid contour', () => {
    const source = image(7, 6, (x, y) => x >= 2 && x <= 4 && y >= 1 && y <= 3 || x === 5 && y === 4 ? [40, 100, 120, 255] : [100, 70, 50, 255])
    const result = suggestImageRegion(source, { seed: { x: 3, y: 2 }, tolerance: 0 })
    expect(result.pixelCount).toBe(9)
    expect(result.mask.boundsPx).toEqual({ x: 2, y: 1, width: 3, height: 3 })
    expect(result.polygon).toEqual(box(2, 1, 3, 3))
    expect(result.holes).toEqual([])
    expect(result.mask.data.every(value => value === 255)).toBe(true)
  })

  it('preserves holes as explicit exclusion contours and allows tolerance without color drift from the seed', () => {
    const ring = image(5, 5, (x, y) => x === 2 && y === 2 ? [200, 0, 0, 255] : [20, 30, 40, 255])
    const result = suggestImageRegion(ring, { seed: { x: 0, y: 0 }, tolerance: 0 })
    expect(result.pixelCount).toBe(24)
    expect(result.holes).toHaveLength(1)
    expect(result.mask.data[12]).toBe(0)
    const gradient = image(5, 1, x => [x * 10, 0, 0, 255])
    expect(suggestImageRegion(gradient, { seed: { x: 0, y: 0 }, tolerance: 15 }).pixelCount).toBe(2)
  })

  it('refuses transparent seeds, invalid settings and budget overflow rather than silently truncating the region', () => {
    const source = image(5, 5, () => [1, 2, 3, 255])
    expect(() => suggestImageRegion(source, { seed: { x: 2, y: 2 }, tolerance: 0, maxPixels: 10 })).toThrow('像素预算')
    expect(() => suggestImageRegion(source, { seed: { x: 5, y: 0 }, tolerance: 0 })).toThrow('种子')
    expect(() => suggestImageRegion(source, { seed: { x: 0, y: 0 }, tolerance: NaN })).toThrow('颜色容差')
    source.data[3] = 0
    expect(() => suggestImageRegion(source, { seed: { x: 0, y: 0 }, tolerance: 0 })).toThrow('可见物件')
  })
})
