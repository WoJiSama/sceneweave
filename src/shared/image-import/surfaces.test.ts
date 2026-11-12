import { describe, expect, it } from 'vitest'
import { extractImageLayer, type ImagePixelMask, type ImagePixels } from './pixels.js'
import { encodeSelectionMask } from './selection-mask.js'
import { imageRepairSurfaceSchema, repairImageSurfaces, validateImageRepairSurfaces, type ImageRepairSurface } from './surfaces.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({
  width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255),
})
const polygon = (x: number, y: number, width: number, height: number) =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
function source(): ImagePixels {
  const width = 72, height = 60, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([95 + x / 12 + y / 18, 123 + x / 12 + y / 18, 131 + x / 12 + y / 18, 255], (y * width + x) * 4)
  return { width, height, data }
}
function surface(id = 'floor', mask = box(0, 0, 72, 60)): ImageRepairSurface {
  return { id, name: id, kind: 'soft', mask: encodeSelectionMask(mask), donor: { x: 2, y: 2, width: 12, height: 18 } }
}

describe('explicit repair surfaces', () => {
  it('checks protection only for surfaces used by this repair and still rejects a used protected donor', () => {
    const image = source(), selection = box(28, 24, 8, 8), first = surface(), unused = surface('remote', box(50, 0, 22, 60))
    unused.donor = { x: 54, y: 4, width: 12, height: 18 }
    const options = { repair: 'surfaces' as const, repairSurfaces: [first, unused], selectionMask: encodeSelectionMask(selection), protectionMask: encodeSelectionMask(box(54, 4, 12, 18)) }
    expect(() => extractImageLayer(image, polygon(28, 24, 8, 8), first.donor, options)).not.toThrow()
    expect(() => extractImageLayer(image, polygon(28, 24, 8, 8), first.donor, { ...options, protectionMask: encodeSelectionMask(box(2, 2, 12, 18)) })).toThrow(/可信|保护/)
  })
  it('requires every donor pixel to be inside its binary material and outside excluded evidence', () => {
    const image = source(), valid = surface()
    expect(() => validateImageRepairSurfaces(image, [valid])).not.toThrow()
    const perforated = box(0, 0, 72, 60)
    perforated.data[5 * 72 + 5] = 0
    expect(() => validateImageRepairSurfaces(image, [{ ...valid, mask: encodeSelectionMask(perforated) }])).toThrow(/可信同材质/)
    expect(() => validateImageRepairSurfaces(image, [{ ...valid, excludedEvidenceMask: encodeSelectionMask(box(5, 5, 1, 1)) }])).toThrow(/可信同材质/)
    expect(() => validateImageRepairSurfaces(image, [{ ...valid, donor: { x: 70, y: 0, width: 3, height: 3 } }])).toThrow(/超出原图/)
  })

  it.each(['mask', 'excludedEvidenceMask'] as const)('rejects partial coverage in %s at the schema and direct validator boundaries', field => {
    const invalid = { ...surface(), [field]: { x: 0, y: 0, width: 72, height: 60, runs: [72 * 60, 128] } }
    expect(() => imageRepairSurfaceSchema.parse(invalid)).toThrow(/二值/)
    expect(() => validateImageRepairSurfaces(source(), [invalid])).toThrow(/二值/)
  })

  it('repairs only the actual removal pixels and preserves protected neighbours and the source bytes', () => {
    const image = source(), selection = box(28, 24, 8, 8), removal = box(24, 20, 18, 18), protection = box(38, 20, 4, 18)
    for (let y = 20; y < 38; y++) for (let x = 24; x < 42; x++) image.data.set([240, 30, 220, 255], (y * image.width + x) * 4)
    const before = image.data.slice(), declared = surface()
    const result = extractImageLayer(image, polygon(28, 24, 8, 8), declared.donor, {
      repair: 'surfaces', repairSurfaces: [declared], selectionMask: encodeSelectionMask(selection),
      removalMask: encodeSelectionMask(removal), protectionMask: encodeSelectionMask(protection),
    })
    let changed = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (x >= 24 && x < 38 && y >= 20 && y < 38) {
        expect(rgba(result.remaining, x, y)).not.toEqual(rgba(image, x, y)); changed++
      } else expect(rgba(result.remaining, x, y)).toEqual(rgba(image, x, y))
    }
    expect(changed).toBe(14 * 18)
    expect(result.repairMask.data.filter(Boolean)).toHaveLength(changed)
    expect(rgba(result.layer, 0, 0)).toEqual([240, 30, 220, 255])
    expect(image.data).toEqual(before)
  })

  it('rejects an uncovered removal pixel without changing the captured source', () => {
    const image = source(), before = image.data.slice(), repair = box(28, 24, 12, 10)
    const incomplete = surface('floor', box(0, 0, 36, 60))
    expect(() => repairImageSurfaces(image, repair, [incomplete])).toThrow(/没有覆盖全部实际移除像素/)
    expect(image.data).toEqual(before)
  })

  it('reads the same input for all surfaces even when their evidence regions overlap', () => {
    const image = source(), whole = box(26, 22, 20, 16), left = box(26, 22, 20, 16), right = box(26, 22, 20, 16)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 20; x++) {
      left.data[y * 20 + x] = x < 10 ? 255 : 0
      right.data[y * 20 + x] = x < 10 ? 0 : 255
    }
    for (let y = 22; y < 38; y++) for (let x = 26; x < 46; x++) image.data.set([113, 140, 148, 255], (y * image.width + x) * 4)
    const first = surface('left', box(0, 0, 36, 60))
    const second = { ...surface('right'), donor: { x: 54, y: 4, width: 12, height: 18 } }
    const expectedLeft = repairImageSurfaces(image, left, [first]), expectedRight = repairImageSurfaces(image, right, [second])
    const together = repairImageSurfaces(image, whole, [first, second])
    const chained = repairImageSurfaces(expectedLeft, right, [second])
    let chainingWouldChangePixels = 0
    for (let y = 22; y < 38; y++) for (let x = 26; x < 46; x++) {
      expect(rgba(together, x, y)).toEqual(rgba(x < 36 ? expectedLeft : expectedRight, x, y))
      if (x >= 36 && rgba(chained, x, y).some((v, c) => v !== rgba(expectedRight, x, y)[c])) chainingWouldChangePixels++
    }
    // Ensure this fixture would catch feeding the first surface's output into the next.
    expect(chainingWouldChangePixels).toBeGreaterThan(0)
  })

  it('keeps excluded furniture colours out of surface inference', () => {
    const a = source(), b = source(), repair = box(28, 24, 12, 10), excluded = box(16, 20, 8, 18)
    for (let y = 20; y < 38; y++) for (let x = 16; x < 24; x++) {
      a.data.set([255, 0, 255, 255], (y * a.width + x) * 4)
      b.data.set([0, 255, 0, 255], (y * b.width + x) * 4)
    }
    const declared = { ...surface(), excludedEvidenceMask: encodeSelectionMask(excluded) }
    const repairedA = repairImageSurfaces(a, repair, [declared]), repairedB = repairImageSurfaces(b, repair, [declared])
    for (let y = 24; y < 34; y++) for (let x = 28; x < 40; x++) expect(rgba(repairedA, x, y)).toEqual(rgba(repairedB, x, y))
  })

  it('rejects duplicate identities, surface count, donor size and aggregate mask budgets', () => {
    const declared = surface(), image = source()
    expect(() => validateImageRepairSurfaces(image, [declared, declared])).toThrow(/身份不能重复/)
    expect(() => validateImageRepairSurfaces(image, Array.from({ length: 17 }, (_, i) => ({ ...declared, id: `surface-${i}` })))).toThrow(/最多16/)
    const large = { ...declared, mask: { x: 0, y: 0, width: 1000, height: 1000, runs: [1_000_000, 255] }, donor: { x: 0, y: 0, width: 1001, height: 1000 } }
    expect(() => validateImageRepairSurfaces({ width: 1001, height: 1000 }, [large])).toThrow(/取样最多100万/)
    const surfaces = Array.from({ length: 9 }, (_, i) => ({ ...large, id: `surface-${i}`, donor: { x: 0, y: 0, width: 3, height: 3 } }))
    expect(() => validateImageRepairSurfaces({ width: 1000, height: 1000 }, surfaces)).toThrow(/累计超过800万/)
  })
})
