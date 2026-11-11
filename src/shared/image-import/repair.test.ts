import { describe, expect, it } from 'vitest'
import { extractImageLayer, type ImagePixelMask, type ImagePixels, type PixelBounds } from './pixels.js'
import { repairImageRegion } from './repair.js'

function image(width: number, height: number, color: (x: number, y: number) => number[]): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4)
  return { width, height, data }
}
const polygon = (bounds: PixelBounds) => [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
const rectangleMask = (boundsPx: PixelBounds): ImagePixelMask => ({ width: boundsPx.width, height: boundsPx.height,
  data: new Uint8Array(boundsPx.width * boundsPx.height).fill(255), boundsPx })
const rgba = (input: ImagePixels, x: number, y: number) => [...input.data.subarray((y * input.width + x) * 4, (y * input.width + x) * 4 + 4)]

function seamError(input: ImagePixels, bounds: PixelBounds): number {
  let sum = 0, count = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (const x of [bounds.x, bounds.x + bounds.width - 1]) {
      const outside = x === bounds.x ? x - 1 : x + 1
      for (let channel = 0; channel < 3; channel++) sum += Math.abs(input.data[(y * input.width + x) * 4 + channel] - input.data[(y * input.width + outside) * 4 + channel])
      count += 3
    }
  }
  for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    for (const y of [bounds.y, bounds.y + bounds.height - 1]) {
      const outside = y === bounds.y ? y - 1 : y + 1
      for (let channel = 0; channel < 3; channel++) sum += Math.abs(input.data[(y * input.width + x) * 4 + channel] - input.data[(outside * input.width + x) * 4 + channel])
      count += 3
    }
  }
  return sum / count
}

describe('donor-guided multiscale image-region repair', () => {
  it('reduces a donor brightness seam while retaining texture and exact exterior bytes', () => {
    const bounds = { x: 24, y: 16, width: 40, height: 32 }, donor = { x: 0, y: 0, width: 8, height: 8 }
    const source = image(96, 64, (x, y) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
      ? [220, 0, 220, 255] : [80 + x / 2, 100 + y / 2, 90 + (x + y) % 2 * 8, 255])
    const before = source.data.slice(), plain = extractImageLayer(source, polygon(bounds), donor)
    const repaired = repairImageRegion(source, plain.mask, donor)
    expect(seamError(repaired, bounds)).toBeLessThan(seamError(plain.remaining, bounds) * .5)
    let textureContrast = 0
    for (let x = bounds.x + 8; x < bounds.x + bounds.width - 8; x++) textureContrast += Math.abs(rgba(repaired, x, 32)[2] - rgba(repaired, x + 1, 32)[2])
    expect(textureContrast / (bounds.width - 16)).toBeGreaterThan(4)
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) expect(rgba(repaired, x, y)).toEqual(rgba(source, x, y))
    }
    expect(source.data).toEqual(before)
    expect(repaired.data).not.toBe(source.data)
  })

  it('never uses removed object colors, including partially covered boundary pixels', () => {
    const bounds = { x: 20, y: 15, width: 32, height: 24 }, donor = { x: 0, y: 0, width: 8, height: 8 }, mask = rectangleMask(bounds)
    mask.data[0] = 1
    const source = (object: number[]) => image(80, 60, (x, y) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
      ? object : [90 + x / 2, 100 + y / 2, 110, 255])
    expect(repairImageRegion(source([250, 0, 250, 255]), mask, donor).data)
      .toEqual(repairImageRegion(source([0, 250, 0, 40]), mask, donor).data)
  })

  it('rejects a narrow dark outline as a background-color estimate instead of spreading it through the fill', () => {
    const bounds = { x: 20, y: 15, width: 32, height: 24 }, donor = { x: 0, y: 0, width: 8, height: 8 }
    const source = image(80, 60, (x, y) => {
      if (x >= 20 && x < 52 && y >= 15 && y < 39) return [180, 0, 180, 255]
      if (x >= 19 && x <= 52 && y >= 14 && y <= 39) return [20, 20, 20, 255]
      return [90, 110, 140, 255]
    })
    const repaired = repairImageRegion(source, rectangleMask(bounds), donor)
    expect(rgba(repaired, 36, 27)).toEqual([90, 110, 140, 255])
    expect(rgba(repaired, 19, 27)).toEqual([20, 20, 20, 255])
  })

  it('confines a genuine wide boundary shadow near its edge instead of carrying it across the removed area', () => {
    const bounds = { x: 24, y: 16, width: 48, height: 32 }, donor = { x: 0, y: 0, width: 8, height: 8 }
    const source = image(96, 64, (x, y) => {
      if (x >= 24 && x < 72 && y >= 16 && y < 48) return [220, 0, 220, 255]
      if (x >= 12 && x < 24 && y >= 12 && y < 52) return [30, 35, 40, 255]
      return [90, 110, 140, 255]
    })
    const repaired = repairImageRegion(source, rectangleMask(bounds), donor)
    expect(rgba(repaired, 48, 32)[0]).toBeGreaterThan(85)
    expect(rgba(repaired, 24, 32)[0]).toBeLessThan(60)
    expect(rgba(repaired, 23, 32)).toEqual([30, 35, 40, 255])
  })

  it('preserves an explicit rug-to-wood split under a single removed object', () => {
    const blue = [50, 100, 140, 255], wood = [130, 100, 70, 255]
    const main = rectangleMask({ x: 32, y: 16, width: 32, height: 32 })
    const region = rectangleMask({ x: 48, y: 0, width: 48, height: 64 })
    const source = image(96, 64, (x, y) => x >= 32 && x < 64 && y >= 16 && y < 48 ? [220, 0, 220, 255] : x < 48 ? blue : wood)
    const repaired = repairImageRegion(source, main, { x: 8, y: 8, width: 8, height: 8 },
      { regions: [{ mask: region, donor: { x: 80, y: 8, width: 8, height: 8 } }] })
    for (let y = 16; y < 48; y++) for (let x = 32; x < 64; x++) expect(rgba(repaired, x, y)).toEqual(x < 48 ? blue : wood)
    expect(rgba(repaired, 20, 20)).toEqual(blue)
    expect(rgba(repaired, 80, 20)).toEqual(wood)
  })

  it('automatically extends material labels from an object-only zone through cleanup and exterior evidence', () => {
    const blue = [50, 110, 150, 255], wood = [130, 100, 70, 255]
    const base = rectangleMask({ x: 180, y: 80, width: 40, height: 60 })
    const main = rectangleMask({ x: 177, y: 77, width: 46, height: 66 })
    const zone = rectangleMask({ x: 200, y: 80, width: 20, height: 60 })
    const source = image(320, 200, (x, y) => x >= 180 && x < 220 && y >= 80 && y < 140 ? [220, 0, 220, 255] : x < 200 ? blue : wood)
    const repaired = repairImageRegion(source, main, { x: 80, y: 40, width: 40, height: 20 },
      { baseMask: base, regions: [{ mask: zone, donor: { x: 280, y: 40, width: 40, height: 20 } }] })
    expect(rgba(repaired, 190, 110)).toEqual(blue)
    expect(rgba(repaired, 210, 110)).toEqual(wood)
    expect(rgba(repaired, 178, 110)).toEqual(blue)
    expect(rgba(repaired, 222, 110)).toEqual(wood)
    expect(rgba(repaired, 176, 110)).toEqual(blue)
    expect(rgba(repaired, 223, 110)).toEqual(wood)
  })

  it('keeps transparent donor colors premultiplied and leaves excluded holes unchanged', () => {
    const source = image(12, 12, (x, y) => x >= 4 && x < 8 && y >= 4 && y < 8 ? [250, 0, 0, 255] : [30, 40, 50, 0])
    const mask = rectangleMask({ x: 4, y: 4, width: 4, height: 4 })
    mask.data[5] = 0
    const repaired = repairImageRegion(source, mask, { x: 0, y: 0, width: 2, height: 2 })
    // An excluded visible pixel is genuine boundary evidence and remains byte-identical.
    expect(rgba(repaired, 5, 5)).toEqual(rgba(source, 5, 5))
    const full = repairImageRegion(source, rectangleMask(mask.boundsPx), { x: 0, y: 0, width: 2, height: 2 })
    expect(rgba(full, 5, 5)).toEqual([0, 0, 0, 0])
    expect(rgba(full, 0, 0)).toEqual([30, 40, 50, 0])
  })

  it('runs a deterministic coarse-to-fine solve within its declared budget', () => {
    const bounds = { x: 24, y: 24, width: 128, height: 96 }, donor = { x: 0, y: 0, width: 12, height: 12 }, mask = rectangleMask(bounds)
    const source = image(180, 144, (x, y) => x >= 24 && x < 152 && y >= 24 && y < 120 ? [0, 0, 0, 255] : [90 + x / 3, 100 + y / 4, 120, 255])
    const first = repairImageRegion(source, mask, donor)
    expect(repairImageRegion(source, mask, donor).data).toEqual(first.data)
    expect(seamError(first, bounds)).toBeLessThan(seamError(extractImageLayer(source, polygon(bounds), donor).remaining, bounds) * .2)
    expect(() => repairImageRegion(source, mask, donor, { maxWork: 1 })).toThrow('计算预算')
    expect(() => repairImageRegion(source, mask, donor, { iterations: 129 })).toThrow('迭代')
  })

  it('rejects malformed masks and every donor intersecting the entire main removal mask', () => {
    const source = image(20, 20, () => [90, 100, 110, 255]), mask = rectangleMask({ x: 5, y: 5, width: 10, height: 10 })
    const donor = { x: 0, y: 0, width: 3, height: 3 }
    expect(() => repairImageRegion(source, { ...mask, width: 2 }, donor)).toThrow('尺寸')
    expect(() => repairImageRegion(source, mask, { x: 6, y: 6, width: 2, height: 2 })).toThrow('相交')
    expect(() => repairImageRegion(source, mask, donor, { regions: [{ mask: rectangleMask({ x: 10, y: 0, width: 10, height: 20 }),
      donor: { x: 6, y: 6, width: 2, height: 2 } }] })).toThrow('相交')
    expect(() => repairImageRegion(source, { ...mask, data: new Uint8Array(mask.data.length) }, donor)).toThrow('没有覆盖')
  })
})
