import { describe, expect, it } from 'vitest'
import { inspectGuidedImageSurfaceTone, repairGuidedImageSurface, type GuidedSurfaceRepairOptions, type ImageSurfaceStructureGuide } from './guided-surface-repair.js'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { maskCoverage } from './repair-scope.js'

const box = (x: number, y: number, width: number, height: number): ImagePixelMask => ({ width, height, boundsPx: { x, y, width, height }, data: new Uint8Array(width * height).fill(255) })
function fixture(width = 100, height = 84): ImagePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = ((x * 13 + y * 7) % 11 - 5) * .65, broad = Math.sin(x * .19) * Math.sin(y * .11) * 2
    data.set([122 + x * .06 + grain + broad, 107 + x * .06 + grain + broad, 89 + x * .06 + grain + broad, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}
function addReferenceLine(image: ImagePixels, y = 10, axis: 'horizontal' | 'vertical' = 'horizontal') {
  // Deliberately asymmetric and coloured: using a generic black vector cannot
  // satisfy the expected reference profile below.
  const profile = [[3, 4, 2], [17, 23, 12], [38, 52, 27], [9, 14, 7]]
  for (let row = 0; row < 4; row++) for (let along = 64; along < 92; along++) {
    const x = axis === 'horizontal' ? along : y + row, sy = axis === 'horizontal' ? y + row : along
    const at = (sy * image.width + x) * 4
    for (let c = 0; c < 3; c++) image.data[at + c] -= profile[row][c]
  }
}
const removal = box(24, 26, 31, 34), donor = { x: 64, y: 24, width: 28, height: 48 }, surfaceMask = box(4, 4, 92, 76)
const guide: ImageSurfaceStructureGuide = { points: [{ x: 22, y: 42 }, { x: 57, y: 42 }], reference: { x: 66, y: 7, width: 20, height: 12 }, axis: 'horizontal', reason: '人工判断两侧板缝应相接，隐藏板头位置仍属推断。' }
const rgba = (image: ImagePixels, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]

describe('guided original-only surface synthesis', () => {
  it('explains actual nearby tone observations without changing synthesis or authorizing writes', () => {
    const image = fixture(), options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'soft', orientation: 'soft' }
    // A visible dark material edge beside the hole is legal original evidence,
    // but differs strongly from the nearby material. It is not hidden truth.
    for (let y = 28; y < 56; y++) for (let x = 55; x < 62; x++) image.data.set([35, 37, 40, 255], (y * image.width + x) * 4)
    const before = image.data.slice(), plain = repairGuidedImageSurface(image, removal, donor, options)
    const inspected = inspectGuidedImageSurfaceTone(image, removal, donor, options)
    expect(inspected.pixels).toEqual(plain)
    expect(inspected.report.observations.length).toBeGreaterThan(0)
    expect(inspected.report.observations.length).toBeLessThanOrEqual(8)
    for (const pair of inspected.report.observations) {
      expect(pair.source.samples.length + pair.neighbor.samples.length).toBeLessThanOrEqual(8)
      expect(pair.channelDifference).toBeGreaterThanOrEqual(18)
      for (const observation of [pair.source, pair.neighbor]) {
        expect(observation.usedPixels).toBeGreaterThanOrEqual(observation.samples.length)
        expect(observation.boundsPx.width).toBeLessThanOrEqual(8)
        expect(observation.boundsPx.height).toBeLessThanOrEqual(8)
        for (const sample of observation.samples) {
          expect(sample.rgb).toEqual(rgba(image, sample.x, sample.y).slice(0, 3))
          expect(maskCoverage(surfaceMask, sample.x, sample.y)).toBe(255)
          expect(maskCoverage(removal, sample.x, sample.y)).toBe(0)
        }
      }
    }
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!maskCoverage(removal, x, y)) expect(rgba(inspected.pixels, x, y)).toEqual(rgba(image, x, y))
    expect(image.data).toEqual(before)
    inspected.report.observations[0].source.samples[0].rgb[0] = 255
    expect(repairGuidedImageSurface(image, removal, donor, options)).toEqual(plain)
    expect(inspectGuidedImageSurfaceTone(image, removal, donor, options).report).not.toEqual(inspected.report)
  })

  it('isolates generated colours and tone reports from unknown, protected, excluded and inferred RGB', () => {
    const a = fixture(), b = fixture(), protectionMask = box(40, 33, 3, 8), excludedEvidenceMask = box(56, 30, 5, 24), priorInference = new Uint8Array(a.width * a.height)
    for (let y = 15; y < 26; y++) for (let x = 24; x < 32; x++) { a.data.set([35, 37, 40, 255], (y * a.width + x) * 4); b.data.set([35, 37, 40, 255], (y * b.width + x) * 4) }
    for (let y = 20; y < 29; y++) for (let x = 18; x < 22; x++) priorInference[y * a.width + x] = 1
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (!maskCoverage(surfaceMask, x, y) || maskCoverage(removal, x, y) || maskCoverage(protectionMask, x, y) || maskCoverage(excludedEvidenceMask, x, y) || priorInference[y * a.width + x]) {
      a.data.set([255, 0, 255, 255], (y * a.width + x) * 4); b.data.set([0, 255, 0, 255], (y * b.width + x) * 4)
    }
    const options: GuidedSurfaceRepairOptions = { surfaceMask, protectionMask, excludedEvidenceMask, priorInference, pattern: 'soft', orientation: 'soft' }
    const left = inspectGuidedImageSurfaceTone(a, removal, donor, options), right = inspectGuidedImageSurfaceTone(b, removal, donor, options)
    expect(left.report.observations.length).toBeGreaterThan(0)
    expect(left.report).toEqual(right.report)
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (maskCoverage(removal, x, y) && !maskCoverage(protectionMask, x, y)) expect(rgba(left.pixels, x, y)).toEqual(rgba(right.pixels, x, y))
    else expect(rgba(left.pixels, x, y)).toEqual(rgba(a, x, y))
    for (const pair of left.report.observations) for (const observation of [pair.source, pair.neighbor]) for (const sample of observation.samples) {
      expect(maskCoverage(removal, sample.x, sample.y) || maskCoverage(protectionMask, sample.x, sample.y) || maskCoverage(excludedEvidenceMask, sample.x, sample.y) || priorInference[sample.y * a.width + sample.x]).toBe(0)
    }
  })

  it('treats genuine steep material gradients as a diagnostic uncertainty without flattening them', () => {
    const image = fixture(), options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'soft', orientation: 'soft' }
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) image.data.set([20 + x * 2, 25 + x * 2, 30 + x * 2, 255], (y * image.width + x) * 4)
    const before = image.data.slice(), plain = repairGuidedImageSurface(image, removal, donor, options), inspected = inspectGuidedImageSurfaceTone(image, removal, donor, options)
    expect(inspected.report.observations.length).toBeGreaterThan(0)
    expect(inspected.pixels).toEqual(plain)
    expect(rgba(inspected.pixels, 50, 40)[0] - rgba(inspected.pixels, 28, 40)[0]).toBeGreaterThan(35)
    expect(image.data).toEqual(before)
  })

  it('retains hard guards and cancellation during optional report collection without returning a partial result', () => {
    const image = fixture(), before = image.data.slice(), options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'soft', orientation: 'soft' }
    let normalChecks = 0
    repairGuidedImageSurface(image, removal, donor, { ...options, signal: { aborted: false, throwIfAborted() { normalChecks++ } } })
    let diagnosticChecks = 0
    expect(() => inspectGuidedImageSurfaceTone(image, removal, donor, { ...options, signal: { aborted: false, throwIfAborted() { if (++diagnosticChecks > normalChecks + 2) throw new Error('diagnostic aborted') } } })).toThrow('diagnostic aborted')
    expect(diagnosticChecks).toBeGreaterThan(normalChecks)
    const large = fixture(600, 520)
    expect(() => inspectGuidedImageSurfaceTone(large, box(0, 0, 501, 500), { x: 550, y: 10, width: 20, height: 20 }, { surfaceMask: box(0, 0, 600, 520), pattern: 'soft' })).toThrow('25万')
    expect(() => inspectGuidedImageSurfaceTone(image, removal, donor, { ...options, guides: Array(33).fill(guide) })).toThrow('最多32')
    expect(image.data).toEqual(before)
  })

  it('keeps every forbidden source out of tone, texture and line evidence and writes only the permitted material', () => {
    const a = fixture(), b = fixture(), protectionMask = box(48, 30, 7, 15), excludedEvidenceMask = box(10, 28, 7, 31), priorInference = new Uint8Array(a.width * a.height)
    addReferenceLine(a); addReferenceLine(b)
    for (let y = 20; y < 30; y++) for (let x = 18; x < 22; x++) priorInference[y * a.width + x] = 2
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (!maskCoverage(surfaceMask, x, y) || maskCoverage(removal, x, y) || maskCoverage(excludedEvidenceMask, x, y) || priorInference[y * a.width + x]) {
      a.data.set([255, 0, 255, 1], (y * a.width + x) * 4); b.data.set([0, 255, 0, 255], (y * b.width + x) * 4)
    }
    const before = a.data.slice(), options: GuidedSurfaceRepairOptions = { surfaceMask, protectionMask, excludedEvidenceMask, priorInference, pattern: 'planks', orientation: 'horizontal', guides: [guide] }
    const left = repairGuidedImageSurface(a, removal, donor, options), right = repairGuidedImageSurface(b, removal, donor, options)
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (maskCoverage(removal, x, y) && !maskCoverage(protectionMask, x, y)) expect(rgba(left, x, y)).toEqual(rgba(right, x, y))
      else expect(rgba(left, x, y)).toEqual(rgba(a, x, y))
    }
    expect(a.data).toEqual(before)
    expect(repairGuidedImageSurface(a, removal, donor, options)).toEqual(left)
  })

  it('uses the actual coloured line profile with the same result for a reversed path', () => {
    const image = fixture(); addReferenceLine(image)
    const options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'planks', orientation: 'soft' }
    const plain = repairGuidedImageSurface(image, removal, donor, options)
    const lined = repairGuidedImageSurface(image, removal, donor, { ...options, guides: [guide] })
    const reversed = repairGuidedImageSurface(image, removal, donor, { ...options, guides: [{ ...guide, points: [...guide.points].reverse() }] })
    expect(lined).toEqual(reversed)
    const differences: number[][] = []
    for (let y = 37; y <= 47; y++) differences.push([0, 1, 2].map(c => rgba(plain, 40, y)[c] - rgba(lined, 40, y)[c]))
    const peak = differences.reduce((best, value) => value[1] > best[1] ? value : best, [0, 0, 0])
    expect(peak[1]).toBeGreaterThan(35)
    expect(peak[1]).toBeGreaterThan(peak[0] * 1.15)
    expect(peak[0]).toBeGreaterThan(peak[2] * 1.15)
    expect(differences.filter(value => value[1] >= 10).length).toBeLessThanOrEqual(5)
    expect(rgba(lined, 40, 32)).toEqual(rgba(plain, 40, 32))
  })

  it('keeps soft material textured while removing source ink, without inventing a regular board grid', () => {
    const image = fixture()
    for (let y = 4; y < 80; y++) for (let x = 4; x < 96; x++) if (y % 17 < 2) {
      const at = (y * image.width + x) * 4; for (let c = 0; c < 3; c++) image.data[at + c] -= 54
    }
    const result = repairGuidedImageSurface(image, removal, donor, { surfaceMask, pattern: 'soft', orientation: 'soft' })
    const values: number[] = []
    for (let y = 30; y < 56; y++) for (let x = 28; x < 51; x++) values.push(rgba(result, x, y)[0])
    const average = values.reduce((a, b) => a + b, 0) / values.length
    const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length)
    expect(deviation).toBeGreaterThan(.7)
    expect(Math.min(...values)).toBeGreaterThan(105)
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(28)
  })

  it('preserves vertical cross-section direction for inferred board heads', () => {
    const image = fixture(100, 100); addReferenceLine(image, 10, 'vertical')
    const hole = box(24, 26, 31, 34), options: GuidedSurfaceRepairOptions = { surfaceMask: box(4, 4, 92, 92), pattern: 'planks', orientation: 'soft' }
    const vertical: ImageSurfaceStructureGuide = { points: [{ x: 40, y: 25 }, { x: 40, y: 61 }], axis: 'vertical', reference: { x: 7, y: 66, width: 12, height: 20 }, reason: '人工推断短板头位置，按可信原线复制横截色深。' }
    const plain = repairGuidedImageSurface(image, hole, donor, options), result = repairGuidedImageSurface(image, hole, donor, { ...options, guides: [vertical] })
    expect(result).toEqual(repairGuidedImageSurface(image, hole, donor, { ...options, guides: [{ ...vertical, points: [...vertical.points].reverse() }] }))
    const difference = Array.from({ length: 11 }, (_, i) => rgba(plain, 35 + i, 45)[1] - rgba(result, 35 + i, 45)[1])
    expect(Math.max(...difference)).toBeGreaterThan(35)
    expect(difference.filter(value => value > 10).length).toBeLessThanOrEqual(5)
  })

  it('keeps a smooth donor smooth even when other trusted regions have stronger grain', () => {
    const image = fixture()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const tone = x * .03 + Math.sin(y * .1) * 2, grain = x < 22 ? ((x * 5 + y * 3) % 13 - 6) : ((x + y) % 3 - 1) * .12
      image.data.set([112 + tone + grain, 103 + tone + grain, 91 + tone + grain, 255], (y * image.width + x) * 4)
    }
    const result = repairGuidedImageSurface(image, removal, donor, { surfaceMask, pattern: 'soft', orientation: 'soft' })
    let maximumError = 0, generatedGradient = 0, donorGradient = 0, generatedCount = 0, donorCount = 0
    for (let y = 28; y < 58; y++) for (let x = 26; x < 53; x++) {
      maximumError = Math.max(maximumError, Math.abs(rgba(result, x, y)[0] - rgba(image, x, y)[0]))
      generatedGradient += Math.abs(rgba(result, x + 1, y)[0] - rgba(result, x, y)[0]) + Math.abs(rgba(result, x, y + 1)[0] - rgba(result, x, y)[0]); generatedCount += 2
    }
    for (let y = donor.y; y < donor.y + donor.height - 1; y++) for (let x = donor.x; x < donor.x + donor.width - 1; x++) {
      donorGradient += Math.abs(rgba(image, x + 1, y)[0] - rgba(image, x, y)[0]) + Math.abs(rgba(image, x, y + 1)[0] - rgba(image, x, y)[0]); donorCount += 2
    }
    expect(maximumError).toBeLessThanOrEqual(3)
    expect(generatedGradient / generatedCount).toBeLessThanOrEqual(donorGradient / donorCount * 1.8 + .1)
  })

  it('fits the real clean boundary without copying a nearby black source line into soft repairs', () => {
    const image = fixture()
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const tone = x * .08 + y * .04
      image.data.set([110 + tone, 99 + tone, 87 + tone, 255], (y * image.width + x) * 4)
      if (x < 20 && y % 13 < 2) for (let c = 0; c < 3; c++) image.data[(y * image.width + x) * 4 + c] -= 55
    }
    const result = repairGuidedImageSurface(image, removal, donor, { surfaceMask, pattern: 'soft', orientation: 'soft' })
    let boundaryError = 0, count = 0
    for (let y = removal.boundsPx.y; y < removal.boundsPx.y + removal.height; y++) for (let x = removal.boundsPx.x; x < removal.boundsPx.x + removal.width; x++) {
      expect(rgba(result, x, y)[0]).toBeGreaterThan(107)
      if (x === removal.boundsPx.x || y === removal.boundsPx.y || x === removal.boundsPx.x + removal.width - 1 || y === removal.boundsPx.y + removal.height - 1) {
        boundaryError += Math.abs(rgba(result, x, y)[0] - rgba(image, x, y)[0]); count++
      }
    }
    expect(boundaryError / count).toBeLessThan(1.2)
  })

  it('does not let dark original outliers turn a large smooth material repair into a dark rectangle', () => {
    const image = fixture(130, 110), hole = box(35, 28, 60, 54), sample = { x: 101, y: 20, width: 20, height: 70 }
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const shade = x < 30 ? -25 : 0
      image.data.set([113 + shade, 102 + shade, 90 + shade, 255], (y * image.width + x) * 4)
    }
    const repaired = repairGuidedImageSurface(image, hole, sample, { surfaceMask: box(4, 4, 122, 102), pattern: 'soft', orientation: 'soft' })
    for (let y = 30; y < 80; y++) for (let x = 37; x < 93; x++) expect(Math.abs(rgba(repaired, x, y)[0] - 113)).toBeLessThanOrEqual(2)
  })

  it('extends a two-sided visible seam but does not invent a long unilateral seam', () => {
    const image = fixture(), unilateral = fixture()
    for (let x = 4; x < 96; x++) for (let dy = 0; dy < 2; dy++) {
      const at = ((41 + dy) * image.width + x) * 4
      for (let c = 0; c < 3; c++) { image.data[at + c] -= 45; if (x < 24) unilateral.data[at + c] -= 45 }
    }
    const options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'planks', orientation: 'horizontal' }
    const paired = repairGuidedImageSurface(image, removal, donor, options), single = repairGuidedImageSurface(unilateral, removal, donor, options)
    expect(rgba(paired, 40, 41)[0]).toBeLessThan(110)
    expect(rgba(single, 40, 41)[0]).toBeGreaterThan(112)
  })

  it('requires fully trusted donor and line references and rejects a flat or broad-shadow reference', () => {
    const image = fixture(); addReferenceLine(image)
    const before = image.data.slice(), options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'planks', guides: [guide] }
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, excludedEvidenceMask: box(guide.reference.x + 1, guide.reference.y + 1, 1, 1) })).toThrow('可信原图')
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, protectionMask: box(67, 8, 1, 1) })).toThrow('可信原图')
    const inferred = new Uint8Array(image.width * image.height); inferred[8 * image.width + 67] = 1
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, priorInference: inferred })).toThrow('可信原图')
    expect(() => repairGuidedImageSurface(image, removal, { ...donor, x: 30 }, options)).toThrow('可信原图')
    const flat = fixture()
    expect(() => repairGuidedImageSurface(flat, removal, donor, options)).toThrow('没有独立窄线')
    expect(image.data).toEqual(before)
  })

  it('preserves an irregular mask and rejects malformed, oversized, unexplained and expensive guidance before synthesis', () => {
    const image = fixture(), irregular = box(20, 20, 36, 40)
    for (let y = 0; y < irregular.height; y++) for (let x = 0; x < irregular.width; x++) if ((x - 18) ** 2 + (y - 20) ** 2 > 18 ** 2) irregular.data[y * irregular.width + x] = 0
    const before = image.data.slice(), options: GuidedSurfaceRepairOptions = { surfaceMask, pattern: 'soft', orientation: 'soft' }
    const result = repairGuidedImageSurface(image, irregular, donor, options)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!maskCoverage(irregular, x, y)) expect(rgba(result, x, y)).toEqual(rgba(image, x, y))
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, guides: [{ ...guide, reason: ' ' }] })).toThrow('明确理由')
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, guides: Array(33).fill(guide) })).toThrow('最多32')
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, guides: [{ ...guide, points: [{ x: NaN, y: 5 }, { x: 5, y: 8 }] }] })).toThrow('原图内点')
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, surfaceMask: { ...surfaceMask, data: new Uint8Array(1) } })).toThrow('二值')
    expect(() => repairGuidedImageSurface(image, removal, donor, { ...options, signal: { aborted: true } })).toThrow('已取消')
    const large = fixture(420, 420), longGuide = { ...guide, points: Array.from({ length: 16 }, (_, i) => i % 2 ? { x: 385, y: 385 } : { x: 20, y: 20 }), reference: { x: 5, y: 5, width: 8, height: 9 } }
    expect(() => repairGuidedImageSurface(large, box(20, 20, 366, 366), { x: 390, y: 10, width: 20, height: 400 }, { surfaceMask: box(0, 0, 420, 420), pattern: 'planks', guides: Array(8).fill(longGuide) })).toThrow('计算预算')
    expect(image.data).toEqual(before)
  })
})
