import { describe, expect, it } from 'vitest'
import { extractImageLayer, type ImagePixelMask, type ImagePixels, type PixelBounds } from './pixels.js'
import { repairImageRegion, repairImageTexture } from './repair.js'
import { imageImportLayerSchema } from './recipe.js'
import { createHash } from 'node:crypto'

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

function phaseFixture(object = [240, 0, 220, 255]) {
  const bounds = { x: 34, y: 20, width: 30, height: 32 }, donor = { x: 2, y: 2, width: 12, height: 10 }
  const mirrored = (value: number, length: number) => {
    const position = ((value % (length * 2)) + length * 2) % (length * 2)
    return position < length ? position : length * 2 - 1 - position
  }
  const texture = (x: number, y: number) => {
    const grain = mirrored(x, 12) % 3, plank = mirrored(y, 10)
    return plank === 2 ? [42, 33, 24, 255] : [122 + grain * 3, 90 + grain * 2, 62 + grain, 255]
  }
  const truth = image(96, 72, (x, y) => texture(x + 4, y + 5))
  const source = image(96, 72, (x, y) => x >= 34 && x < 64 && y >= 20 && y < 52 ? object
    : x >= 2 && x < 14 && y >= 2 && y < 12 ? texture(x - 2, y - 2) : texture(x + 4, y + 5))
  return { source, truth, bounds, donor, mask: rectangleMask(bounds) }
}

describe('explicit donor boundary-phase alignment', () => {
  it('retains the original seamless replay and only changes the explicitly selected strategy', () => {
    const { source, mask, donor } = phaseFixture()
    const old = repairImageRegion(source, mask, donor)
    expect(createHash('sha256').update(old.data).digest('hex')).toBe('d46b3cc5fc5d7c4d33d36131ef339e555c307d6a10d3c6c7e887613aa2dfae13')
    expect(extractImageLayer(source, polygon(mask.boundsPx), donor, { repair: 'seamless' }).remaining.data).toEqual(old.data)
    expect(extractImageLayer(source, polygon(mask.boundsPx), donor, { repair: 'tile' }).remaining.data)
      .toEqual(extractImageLayer(source, polygon(mask.boundsPx), donor).remaining.data)
  })

  it('aligns shifted plank joints and grain from the selected donor without changing any exterior pixel', () => {
    const { source, truth, mask, donor, bounds } = phaseFixture(), before = source.data.slice()
    const old = repairImageRegion(source, mask, donor)
    const repaired = extractImageLayer(source, polygon(bounds), donor, { repair: 'aligned' }).remaining
    let beforeError = 0, afterError = 0
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (x >= 34 && x < 64 && y >= 20 && y < 52) {
        for (let channel = 0; channel < 3; channel++) {
          const at = (y * source.width + x) * 4 + channel
          beforeError += Math.abs(old.data[at] - truth.data[at]); afterError += Math.abs(repaired.data[at] - truth.data[at])
        }
      } else expect(rgba(repaired, x, y)).toEqual(rgba(source, x, y))
    }
    expect(beforeError).toBeGreaterThan(10000)
    expect(afterError).toBe(0)
    expect(source.data).toEqual(before)
    expect(repaired.data).toEqual(repairImageRegion(source, mask, donor, { alignment: 'boundary-phase-v1' }).data)
  })

  it('does not infer phase from removed object colors and preserves excluded holes', () => {
    const first = phaseFixture(), second = phaseFixture([0, 255, 0, 40])
    expect(repairImageRegion(first.source, first.mask, first.donor, { alignment: 'boundary-phase-v1' }).data)
      .toEqual(repairImageRegion(second.source, second.mask, second.donor, { alignment: 'boundary-phase-v1' }).data)
    first.mask.data[10 * first.mask.width + 10] = 0
    const repaired = repairImageRegion(first.source, first.mask, first.donor, { alignment: 'boundary-phase-v1' })
    expect(rgba(repaired, 44, 30)).toEqual(rgba(first.source, 44, 30))
  })

  it('keeps material donors isolated and extends their labels through the explicit cleanup halo', () => {
    const blue = [50, 110, 150, 255], wood = [130, 100, 70, 255]
    const base = rectangleMask({ x: 180, y: 80, width: 40, height: 60 }), main = rectangleMask({ x: 177, y: 77, width: 46, height: 66 })
    const zone = rectangleMask({ x: 200, y: 80, width: 20, height: 60 })
    const source = image(320, 200, (x, y) => x >= 180 && x < 220 && y >= 80 && y < 140 ? [220, 0, 220, 255] : x < 200 ? blue : wood)
    const repaired = repairImageRegion(source, main, { x: 80, y: 40, width: 40, height: 20 },
      { alignment: 'boundary-phase-v1', baseMask: base, regions: [{ mask: zone, donor: { x: 280, y: 40, width: 40, height: 20 } }] })
    for (let y = 77; y < 143; y++) for (let x = 177; x < 223; x++) expect(rgba(repaired, x, y)).toEqual(x < 200 ? blue : wood)
    expect(rgba(repaired, 176, 110)).toEqual(blue)
    expect(rgba(repaired, 223, 110)).toEqual(wood)
  })

  it('admits matching work before computation and rejects overlapping donors without mutating source', () => {
    const { source, mask, donor } = phaseFixture(), before = source.data.slice()
    expect(() => repairImageRegion(source, mask, donor, { alignment: 'boundary-phase-v1', maxWork: 1_000_000 })).toThrow('计算预算')
    expect(() => repairImageRegion(source, mask, { x: 34, y: 20, width: 2, height: 2 }, { alignment: 'boundary-phase-v1' })).toThrow('相交')
    expect(source.data).toEqual(before)
  })
})

describe('explicit source-sized texture patch repair', () => {
  const texture = (x: number, y: number) => {
    const row = ((y % 13) + 13) % 13, column = ((x % 17) + 17) % 17
    if (row === 0 || column === 0 && row < 7) return [32, 26, 18, 255]
    return [116 + column % 3 * 9, 82 + row % 3 * 6, 50 + (column + row) % 4 * 3, 255]
  }
  const fixture = () => {
    const bounds = { x: 49, y: 30, width: 29, height: 26 }, donor = { x: 2, y: 2, width: 36, height: 28 }
    const truth = image(110, 82, texture), source = image(110, 82, (x, y) => x >= 49 && x < 78 && y >= 30 && y < 56 ? [245, 0, 230, 255] : texture(x, y))
    return { bounds, donor, truth, source, mask: rectangleMask(bounds) }
  }

  it('continues known plank lines and fine grain using real donor colours without smooth object-shaped patches', () => {
    const { source, truth, bounds, donor, mask } = fixture(), before = source.data.slice()
    const repaired = repairImageTexture(source, mask, donor), palette = new Set<string>()
    for (let y = donor.y; y < donor.y + donor.height; y++) for (let x = donor.x; x < donor.x + donor.width; x++) palette.add(rgba(source, x, y).join(','))
    let error = 0, selectedPixels = 0, truthDark = 0, recoveredDark = 0
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) {
        selectedPixels++
        expect(palette.has(rgba(repaired, x, y).join(','))).toBe(true)
        for (let channel = 0; channel < 3; channel++) error += Math.abs(rgba(repaired, x, y)[channel] - rgba(truth, x, y)[channel])
        if (rgba(truth, x, y)[0] < 40) truthDark++
        if (rgba(repaired, x, y)[0] < 40) recoveredDark++
      } else expect(rgba(repaired, x, y)).toEqual(rgba(source, x, y))
    }
    expect(error / selectedPixels / 3).toBeLessThan(6)
    expect(recoveredDark / truthDark).toBeGreaterThan(.8)
    expect(recoveredDark / truthDark).toBeLessThan(1.2)
    expect(repairImageTexture(source, mask, donor).data).toEqual(repaired.data)
    expect(extractImageLayer(source, polygon(bounds), donor, { repair: 'texture' }).remaining.data).toEqual(repaired.data)
    expect(source.data).toEqual(before)
  })

  it('does not sample removed object colours and preserves excluded visible holes byte for byte', () => {
    const first = fixture(), second = fixture()
    for (let y = first.bounds.y; y < first.bounds.y + first.bounds.height; y++) for (let x = first.bounds.x; x < first.bounds.x + first.bounds.width; x++) second.source.data.set([0, 255, 0, 40], (y * second.source.width + x) * 4)
    expect(repairImageTexture(first.source, first.mask, first.donor).data).toEqual(repairImageTexture(second.source, second.mask, second.donor).data)
    first.mask.data[12 * first.mask.width + 14] = 0
    const repaired = repairImageTexture(first.source, first.mask, first.donor)
    expect(rgba(repaired, first.bounds.x + 14, first.bounds.y + 12)).toEqual([245, 0, 230, 255])
  })

  it('isolates two material donors and carries explicit zones through the cleanup halo', () => {
    const blue = [40, 90, 150, 255], wood = [140, 100, 60, 255]
    const source = image(80, 60, (x, y) => x >= 30 && x < 50 && y >= 20 && y < 40 ? [250, 0, 250, 255] : x < 40 ? blue : wood)
    const base = rectangleMask({ x: 30, y: 20, width: 20, height: 20 }), mask = rectangleMask({ x: 28, y: 18, width: 24, height: 24 })
    const repaired = repairImageTexture(source, mask, { x: 5, y: 5, width: 15, height: 15 },
      { baseMask: base, regions: [{ mask: rectangleMask({ x: 40, y: 20, width: 10, height: 20 }), donor: { x: 60, y: 5, width: 15, height: 15 } }] })
    for (let y = 18; y < 42; y++) for (let x = 28; x < 52; x++) expect(rgba(repaired, x, y)).toEqual(x < 40 ? blue : wood)
    expect(rgba(repaired, 27, 30)).toEqual(blue)
    expect(rgba(repaired, 52, 30)).toEqual(wood)
  })

  it('admits the new strict replay mode and rejects insufficient budgets or invalid donors without mutating input', () => {
    const { source, mask, donor, bounds } = fixture(), before = source.data.slice()
    expect(imageImportLayerSchema.parse({ id: 'texture', name: 'texture', polygon: polygon(bounds), donor, renderLayer: 'object', blocksMovement: false, repair: 'texture' }).repair).toBe('texture')
    expect(() => repairImageTexture(source, mask, donor, { maxWork: 1 })).toThrow('计算预算')
    expect(() => repairImageTexture(source, mask, { x: 0, y: 0, width: 2, height: 2 })).toThrow('至少3×3')
    expect(() => repairImageTexture(source, mask, { ...bounds, width: 5, height: 5 })).toThrow('相交')
    expect(() => repairImageTexture(source, { ...mask, data: new Uint8Array(mask.data.length) }, donor)).toThrow('没有覆盖')
    expect(source.data).toEqual(before)
  })
})
